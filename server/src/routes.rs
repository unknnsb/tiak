use axum::{
    extract::{Path, Query, State, Multipart, Json, DefaultBodyLimit},
    response::{IntoResponse, Response},
    http::{StatusCode, HeaderMap, header, HeaderValue},
    routing::{get, post, delete},
    Router, body::Body,
};
use crate::db::{Db, Job};
use crate::queue::DownloadQueue;
use crate::storage::{FileIndex, DATA_ROOT, get_disk_usage};
use std::sync::Arc;
use serde::Deserialize;
use std::path::{Path as StdPath, PathBuf};
use tokio_util::io::ReaderStream;
use zip::write::SimpleFileOptions;
use std::io::Write;
use tokio::fs::File as AsyncFile;

#[derive(Clone)]
pub struct AppState {
    pub db: Db,
    pub queue: Arc<DownloadQueue>,
    pub file_index: Arc<FileIndex>,
}

pub fn create_router(state: AppState) -> Router {
    Router::new()
        .route("/", get(root))
        .route("/api/files", get(list_files).delete(delete_files))
        .route("/api/files/zip", post(zip_files))
        .route("/api/files/download", get(download_file))
        .route("/api/files/stream", get(stream_file))
        .route("/api/queue/:id", delete(delete_job))
        .route("/api/system/usage", get(system_usage))
        .route("/api/settings", get(get_settings).post(set_settings))
        .route("/api/queue/list", get(list_queue))
        .route("/api/queue/add", post(add_to_queue))
        .route("/api/queue/history", get(queue_history))
        .route("/api/queue/export", get(export_queue))
        .route("/api/queue/import", post(import_queue))
        .route("/api/queue/retry/:id", post(retry_job))
        .route("/api/queue/redownload/:id", post(redownload_job))
        .route("/api/files/resolve", post(resolve_url_endpoint))
        .route("/api/sync/run", post(sync_run))
        .route("/api/sync/status", get(sync_status))
        .layer(DefaultBodyLimit::max(10 * 1024 * 1024))
        .with_state(state)
}

async fn root() -> &'static str {
    "Tiak Server is running (Rust)"
}

#[derive(Deserialize)]
struct ResolvePayload {
    url: String,
}

async fn resolve_url_endpoint(Json(payload): Json<ResolvePayload>) -> impl IntoResponse {
    let url = payload.url;
    if !url.starts_with("http") {
        return Json(serde_json::json!({ "url": url })).into_response();
    }

    match resolve_url(&url).await {
        Ok(resolved) => Json(serde_json::json!({ "url": resolved })).into_response(),
        Err(_) => Json(serde_json::json!({ "url": url })).into_response(),
    }
}

async fn resolve_url(url: &str) -> Result<String, anyhow::Error> {
    use tokio::process::Command;
    
    let output = Command::new("curl")
        .arg("-Ls")
        .arg("-o")
        .arg("/dev/null")
        .arg("-w")
        .arg("%{url_effective}")
        .arg(url)
        .output()
        .await?;

    if output.status.success() {
        let resolved = String::from_utf8_lossy(&output.stdout).trim().to_string();
        Ok(resolved)
    } else {
        Err(anyhow::anyhow!("Curl failed"))
    }
}

async fn list_files(State(state): State<AppState>) -> impl IntoResponse {
    Json(state.file_index.get_index())
}

#[derive(Deserialize)]
struct DeleteFilesPayload {
    paths: Vec<String>,
}

async fn delete_files(
    State(state): State<AppState>,
    Json(payload): Json<DeleteFilesPayload>,
) -> impl IntoResponse {
    let mut deleted = Vec::new();
    let mut errors: Vec<serde_json::Value> = Vec::new();

    for p in payload.paths {
        let abs_path = StdPath::new(&p).canonicalize().unwrap_or_else(|_| PathBuf::from(&p));
        let data_root = StdPath::new(DATA_ROOT).canonicalize().unwrap_or_else(|_| PathBuf::from(DATA_ROOT));

        if !abs_path.starts_with(&data_root) {
            errors.push(serde_json::json!({ "path": p, "error": "Access denied" }));
            continue;
        }

        if abs_path.to_string_lossy().contains("jobs.sqlite") {
             errors.push(serde_json::json!({ "path": p, "error": "Cannot delete database files" }));
             continue;
        }

        if abs_path.exists() {
             if let Err(e) = tokio::fs::remove_file(&abs_path).await {
                 errors.push(serde_json::json!({ "path": p, "error": e.to_string() }));
             } else {
                 state.file_index.remove_file(&abs_path.to_string_lossy());
                 deleted.push(p.clone());
                 
                 if let Some(parent) = abs_path.parent() {
                     if parent.starts_with(&data_root) && parent != data_root {
                         let _ = tokio::fs::remove_dir(parent).await;
                     }
                 }
             }
        } else {
             deleted.push(p);
        }
    }
    
    if !deleted.is_empty() {
    }

    Json(serde_json::json!({ "deleted": deleted, "errors": errors }))
}

async fn delete_job(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Response {
    state.queue.cancel_job(&id);
    if let Ok(true) = state.db.check_job_exists(&id).await {
        let _ = state.db.delete_job(&id).await;
        return Json(serde_json::json!({ "success": true, "id": id })).into_response();
    }
    (StatusCode::NOT_FOUND, Json(serde_json::json!({ "error": "Job not found" }))).into_response()
}

async fn system_usage() -> Response {
    match get_disk_usage().await {
        Ok((size, count)) => Json(serde_json::json!({ "totalSize": size, "fileCount": count })).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to get disk usage: {}", e)).into_response()
    }
}

async fn get_settings(State(state): State<AppState>) -> impl IntoResponse {
    let max = state.queue.get_max_concurrent().await;
    let sync_dest = state.queue.get_sync_destination().await;
    Json(serde_json::json!({ "maxConcurrent": max, "syncDestination": sync_dest }))
}

#[derive(Deserialize)]
struct SettingsPayload {
    #[serde(rename = "maxConcurrent")]
    max_concurrent: usize,
    #[serde(rename = "syncDestination", default)]
    sync_destination: Option<String>,
}

async fn set_settings(
    State(state): State<AppState>,
    Json(payload): Json<SettingsPayload>,
) -> impl IntoResponse {
    state.queue.set_max_concurrent(payload.max_concurrent).await;
    if let Some(dest) = payload.sync_destination {
        state.queue.set_sync_destination(dest).await;
    }
    
    let max = state.queue.get_max_concurrent().await;
    let sync_dest = state.queue.get_sync_destination().await;
    Json(serde_json::json!({ "maxConcurrent": max, "syncDestination": sync_dest }))
}

async fn sync_run(State(state): State<AppState>) -> impl IntoResponse {
    match state.queue.run_sync().await {
        Ok(msg) => Json(serde_json::json!({ "success": true, "message": msg })).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({ "success": false, "error": e.to_string() }))).into_response()
    }
}

async fn sync_status(State(state): State<AppState>) -> impl IntoResponse {
    Json(state.queue.get_sync_state().await)
}

#[derive(Deserialize)]
struct ZipPayload {
    paths: Vec<String>,
}

async fn zip_files(
    State(_state): State<AppState>,
    Json(payload): Json<ZipPayload>,
) -> Response {
    let paths = payload.paths;
    if paths.is_empty() {
        return (StatusCode::BAD_REQUEST, "No files to zip").into_response();
    }
    
    let res = tokio::task::spawn_blocking(move || -> Result<Vec<u8>, anyhow::Error> {
        let mut buffer = Vec::new();
        let mut zip = zip::ZipWriter::new(std::io::Cursor::new(&mut buffer));
        let options = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);

        for p in paths {
             let abs_path = StdPath::new(&p).canonicalize().unwrap_or_else(|_| PathBuf::from(&p));
             let data_root = StdPath::new(DATA_ROOT).canonicalize().unwrap_or_else(|_| PathBuf::from(DATA_ROOT));
             
             if !abs_path.starts_with(&data_root) { continue; }
             
             if abs_path.is_file() {
                 let name = abs_path.file_name().unwrap().to_string_lossy();
                 zip.start_file(name, options)?;
                 let content = std::fs::read(&abs_path)?;
                 zip.write_all(&content)?;
             }
        }
        zip.finish()?;
        Ok(buffer)
    }).await;

    match res {
        Ok(Ok(buffer)) => {
            let mut headers = HeaderMap::new();
            headers.insert(header::CONTENT_TYPE, "application/zip".parse().unwrap());
            headers.insert(header::CONTENT_DISPOSITION, "attachment; filename=\"videos.zip\"".parse().unwrap());
            (headers, buffer).into_response()
        }
        _ => (StatusCode::INTERNAL_SERVER_ERROR, "Failed to create zip").into_response(),
    }
}

#[derive(Deserialize)]
struct FileQuery {
    path: String,
}

async fn download_file(
    Query(params): Query<FileQuery>,
) -> Response {
    let p = params.path;
    let abs_path = StdPath::new(&p).canonicalize().unwrap_or_else(|_| PathBuf::from(&p));
    let data_root = StdPath::new(DATA_ROOT).canonicalize().unwrap_or_else(|_| PathBuf::from(DATA_ROOT));

    if !abs_path.starts_with(&data_root) {
        return (StatusCode::FORBIDDEN, "Access denied").into_response();
    }

    if !abs_path.exists() {
        return (StatusCode::NOT_FOUND, "File not found").into_response();
    }
    
    let metadata = match tokio::fs::metadata(&abs_path).await {
        Ok(meta) => meta,
        Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to read metadata: {}", e)).into_response(),
    };

    let file_size = metadata.len();
    let modified = metadata.modified().unwrap_or(std::time::SystemTime::UNIX_EPOCH);
    let last_modified = chrono::DateTime::<chrono::Utc>::from(modified).format("%a, %d %b %Y %H:%M:%S GMT").to_string();
    let etag = format!(r#"{{ "}}"-"{{ "}}""#, file_size, modified.duration_since(std::time::SystemTime::UNIX_EPOCH).unwrap_or_default().as_secs());
    
    match AsyncFile::open(&abs_path).await {
        Ok(file) => {
             let stream = ReaderStream::new(file);
             let body = Body::from_stream(stream);
             let filename = abs_path.file_name().unwrap().to_string_lossy().to_string();
             
             let mut headers = HeaderMap::new();
             headers.insert(header::CONTENT_DISPOSITION, format!("attachment; filename=\"{{}}\"", filename).parse().unwrap());
             headers.insert(header::CONTENT_LENGTH, HeaderValue::from_str(&file_size.to_string()).unwrap());
             headers.insert(header::ETAG, HeaderValue::from_str(&etag).unwrap());
             headers.insert(header::LAST_MODIFIED, HeaderValue::from_str(&last_modified).unwrap());
             headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("public, max-age=3600"));
             
             (headers, body).into_response()
        }
        Err(_) => (StatusCode::INTERNAL_SERVER_ERROR, "Failed to open file").into_response()
    }
}

async fn stream_file(
    Query(params): Query<FileQuery>,
    req: axum::extract::Request,
) -> Response {
    let p = params.path;
    let abs_path = StdPath::new(&p).canonicalize().unwrap_or_else(|_| PathBuf::from(&p));
    let data_root = StdPath::new(DATA_ROOT).canonicalize().unwrap_or_else(|_| PathBuf::from(DATA_ROOT));

    if !abs_path.starts_with(&data_root) {
        return (StatusCode::FORBIDDEN, "Access denied").into_response();
    }

    if !abs_path.exists() {
        return (StatusCode::NOT_FOUND, "File not found").into_response();
    }

    let metadata = match tokio::fs::metadata(&abs_path).await {
        Ok(meta) => meta,
        Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to read metadata: {}", e)).into_response(),
    };

    let file_size = metadata.len();
    let modified = metadata.modified().unwrap_or(std::time::SystemTime::UNIX_EPOCH);
    let last_modified = chrono::DateTime::<chrono::Utc>::from(modified).format("%a, %d %b %Y %H:%M:%S GMT").to_string();
    
    let etag = format!(r#"{{ "}}"-"{{ "}}""#, file_size, modified.duration_since(std::time::SystemTime::UNIX_EPOCH).unwrap_or_default().as_secs());

    if let Some(if_none_match) = req.headers().get(header::IF_NONE_MATCH) {
        if if_none_match.to_str().unwrap_or("") == etag {
            return StatusCode::NOT_MODIFIED.into_response();
        }
    }

    let range_header = req.headers().get(header::RANGE);
    
    if let Some(range) = range_header {
        if let Some((start, end)) = parse_range_header(range.to_str().unwrap_or(""), file_size) {
            use tokio::io::{AsyncReadExt, AsyncSeekExt};
            
            let mut file = match AsyncFile::open(&abs_path).await {
                Ok(f) => f,
                Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to open file: {}", e)).into_response(),
            };

            if let Err(e) = file.seek(std::io::SeekFrom::Start(start)).await {
                return (StatusCode::INTERNAL_SERVER_ERROR, format!("Seek failed: {}", e)).into_response();
            }

            let take_len = end - start + 1;
            let stream = ReaderStream::new(file.take(take_len));
            let body = Body::from_stream(stream);

            let mut response = Response::new(body);
            *response.status_mut() = StatusCode::PARTIAL_CONTENT;
            
            let headers = response.headers_mut();
            headers.insert(header::CONTENT_TYPE, HeaderValue::from_static("video/mp4")); 
            headers.insert(
                header::CONTENT_RANGE,
                HeaderValue::from_str(&format!("bytes {{}}-{{}}/{{}}", start, end, file_size)).unwrap()
            );
            headers.insert(
                header::CONTENT_LENGTH,
                HeaderValue::from_str(&take_len.to_string()).unwrap()
            );
            headers.insert(header::ACCEPT_RANGES, HeaderValue::from_static("bytes"));
            headers.insert(header::ETAG, HeaderValue::from_str(&etag).unwrap());
            headers.insert(header::LAST_MODIFIED, HeaderValue::from_str(&last_modified).unwrap());
            headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("public, max-age=3600"));
            
            return response;
        }
    }

    match AsyncFile::open(&abs_path).await {
        Ok(file) => {
            let stream = ReaderStream::new(file);
            let body = Body::from_stream(stream);
            
            let mut response = Response::new(body);
            let headers = response.headers_mut();
            headers.insert(header::CONTENT_TYPE, HeaderValue::from_static("video/mp4"));
            headers.insert(header::CONTENT_LENGTH, HeaderValue::from_str(&file_size.to_string()).unwrap());
            headers.insert(header::ACCEPT_RANGES, HeaderValue::from_static("bytes"));
            headers.insert(header::ETAG, HeaderValue::from_str(&etag).unwrap());
            headers.insert(header::LAST_MODIFIED, HeaderValue::from_str(&last_modified).unwrap());
            headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("public, max-age=3600"));
            
            response
        }
        Err(_) => (StatusCode::INTERNAL_SERVER_ERROR, "Failed to open file").into_response()
    }
}

fn parse_range_header(range: &str, file_size: u64) -> Option<(u64, u64)> {
    if !range.starts_with("bytes=") {
        return None;
    }
    
    let range_part = &range[6..];
    let parts: Vec<&str> = range_part.split('-').collect();
    
    if parts.len() != 2 {
        return None;
    }
    
    let start = if parts[0].is_empty() {
        0
    } else {
        parts[0].parse::<u64>().ok()?
    };
    
    let end = if parts[1].is_empty() {
        file_size - 1
    } else {
        parts[1].parse::<u64>().ok()?
    };
    
    if start > end || end >= file_size {
        return None;
    }
    
    Some((start, end))
}

async fn list_queue(State(state): State<AppState>) -> Response {
    if let Ok(jobs) = state.db.get_all_jobs().await {
        Json(jobs).into_response()
    } else {
        (StatusCode::INTERNAL_SERVER_ERROR, "Failed to fetch jobs").into_response()
    }
}

#[derive(Deserialize)]
struct AddQueuePayload {
    urls: String,
}

async fn add_to_queue(
    State(state): State<AppState>,
    Json(payload): Json<AddQueuePayload>,
) -> Response {
    let lines = payload.urls.lines();
    let mut added = Vec::new();
    let mut skipped = Vec::new();
    
    for url in lines {
        let url = url.trim();
        if url.is_empty() { continue; }
        
        if state.queue.has_job(url).await {
            skipped.push(serde_json::json!({ "url": url, "reason": "Already in queue" }));
            continue;
        }
        
        if let Ok(Some(done)) = state.db.find_done_job_by_url(url).await {
            skipped.push(serde_json::json!({ "url": url, "reason": "Already downloaded", "jobId": done.id, "finishedAt": done.completed_at }));
            continue;
        }
        
        match state.queue.add_job(url.to_string()).await {
            Ok(job) => added.push(job),
            Err(e) => skipped.push(serde_json::json!({ "url": url, "reason": e.to_string() })),
        }
    }
    
    (StatusCode::CREATED, Json(serde_json::json!({ "added": added, "skipped": skipped }))).into_response()
}

#[derive(Deserialize)]
struct HistoryQuery {
    page: Option<i64>,
    limit: Option<i64>,
}

async fn queue_history(
    State(state): State<AppState>,
    Query(q): Query<HistoryQuery>,
) -> Response {
    let page = q.page.unwrap_or(1).max(1);
    let limit = q.limit.unwrap_or(50).max(1);
    let offset = (page - 1) * limit;
    
    if let Ok((items, total)) = state.db.get_job_history(limit, offset).await {
        Json(serde_json::json!({
            "items": items,
            "total": total,
            "page": page,
            "limit": limit
        })).into_response()
    } else {
        (StatusCode::INTERNAL_SERVER_ERROR, "Failed").into_response()
    }
}

async fn export_queue(State(state): State<AppState>) -> Response {
    if let Ok(jobs) = state.db.export_all_jobs().await {
        let now = chrono::Local::now();
        let filename = format!("jobs-export-{{}}", now.format("%Y-%m-%d"));
        let mut headers = HeaderMap::new();
        headers.insert(header::CONTENT_DISPOSITION, format!("attachment; filename=\"{{}}\"", filename).parse().unwrap());
        (headers, Json(jobs)).into_response()
    } else {
        (StatusCode::INTERNAL_SERVER_ERROR, "Failed").into_response()
    }
}

async fn import_queue(
    State(state): State<AppState>,
    mut multipart: Multipart,
) -> impl IntoResponse {
    let mut imported = 0;
    let mut skipped = 0;

    while let Some(field) = multipart.next_field().await.unwrap_or(None) {
        if field.name() == Some("file") {
            if let Ok(bytes) = field.bytes().await {
                 if let Ok(jobs) = serde_json::from_slice::<Vec<Job>>(&bytes) {
                     for job in jobs {
                         if let Ok(true) = state.db.check_job_exists(&job.id).await {
                             skipped += 1;
                         } else {
                             let mut new_job = job.clone();
                             new_job.status = "imported".to_string();
                             new_job.retries = 0;
                             
                             if let Ok(_) = state.db.import_job(new_job).await {
                                 imported += 1;
                             }
                         }
                     }
                 }
            }
        }
    }
    Json(serde_json::json!({ "imported": imported, "skipped": skipped }))
}

async fn retry_job(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Response {
    if let Some(job) = state.queue.retry_job(&id).await {
        Json(job).into_response()
    } else {
        (StatusCode::NOT_FOUND, "Job not found or cannot retry").into_response()
    }
}

async fn redownload_job(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Response {
    if let Some(job) = state.queue.redownload_job(&id).await {
        Json(job).into_response()
    } else {
        (StatusCode::NOT_FOUND, "Job not found").into_response()
    }
}
