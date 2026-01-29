use crate::db::Db;
use crate::storage::{FileIndex, get_today_folder};
use std::collections::VecDeque;
use std::sync::{Arc, Mutex};
use tokio::sync::{RwLock, Notify};
use dashmap::DashMap;
use tokio_util::sync::CancellationToken;
use std::path::Path;
use tokio::process::Command;
use std::process::Stdio;
use tokio::io::{AsyncBufReadExt, BufReader};
use regex::Regex;
use tracing::{info, error};
use serde::Serialize;
use chrono::{DateTime, Utc};
use std::fs::File;

#[derive(Clone, Serialize, Debug)]
pub struct SyncState {
    pub status: String,
    #[serde(rename = "lastRun")]
    pub last_run: Option<DateTime<Utc>>,
    pub logs: Vec<String>,
    pub error: Option<String>,
    #[serde(rename = "unsyncedCount")]
    pub unsynced_count: usize,
}

impl Default for SyncState {
    fn default() -> Self {
        Self {
            status: "idle".to_string(),
            last_run: None,
            logs: Vec::new(),
            error: None,
            unsynced_count: 0,
        }
    }
}

#[derive(Clone)]
pub struct DownloadQueue {
    db: Db,
    file_index: Arc<FileIndex>,
    queue: Arc<Mutex<VecDeque<String>>>,
    active_jobs: Arc<DashMap<String, CancellationToken>>,
    max_concurrent: Arc<RwLock<usize>>,
    sync_destination: Arc<RwLock<String>>,
    sync_state: Arc<RwLock<SyncState>>,
    notify: Arc<Notify>,
}

const SYNC_MARKER_FILE: &str = "data/.last_sync";

impl DownloadQueue {
    pub fn new(db: Db, file_index: Arc<FileIndex>) -> Arc<Self> {
        let queue = Arc::new(DownloadQueue {
            db,
            file_index,
            queue: Arc::new(Mutex::new(VecDeque::new())),
            active_jobs: Arc::new(DashMap::new()),
            max_concurrent: Arc::new(RwLock::new(2)),
            sync_destination: Arc::new(RwLock::new("".to_string())),
            sync_state: Arc::new(RwLock::new(SyncState::default())),
            notify: Arc::new(Notify::new()),
        });
        
        let q = queue.clone();
        tokio::spawn(async move {
            loop {
                q.process_next().await;
                q.notify.notified().await;
            }
        });

        queue
    }

    pub async fn load_initial_state(&self) {
        if let Err(e) = self.db.reset_crashed_jobs().await {
            error!("Failed to reset crashed jobs: {}", e);
        }

        if let Ok(jobs) = self.db.get_queued_jobs().await {
            let mut q = self.queue.lock().unwrap();
            for job in jobs {
                if !q.contains(&job.id) {
                    q.push_back(job.id);
                }
            }
        }
        self.notify.notify_one();
    }

    pub async fn add_job(&self, url: String) -> Result<crate::db::Job, anyhow::Error> {
        let job = self.db.add_job(url).await?;
        {
            let mut q = self.queue.lock().unwrap();
            q.push_back(job.id.clone());
        }
        self.notify.notify_one();
        Ok(job)
    }
    
    pub fn cancel_job(&self, id: &str) {
        if let Some(token) = self.active_jobs.get(id) {
            info!("Cancelling active job {}", id);
            token.cancel();
            return;
        }

        let mut q = self.queue.lock().unwrap();
        if let Some(pos) = q.iter().position(|x| x == id) {
            q.remove(pos);
            info!("Removed job {} from pending queue", id);
        }
    }
    
    pub async fn retry_job(&self, id: &str) -> Option<crate::db::Job> {
        if let Ok(Some(_)) = self.db.get_job(id).await {
            if self.db.increment_retry(id).await.is_ok() {
                 {
                    let mut q = self.queue.lock().unwrap();
                    q.push_back(id.to_string());
                }
                self.notify.notify_one();
                return self.db.get_job(id).await.ok().flatten();
            }
        }
        None
    }

    pub async fn redownload_job(&self, id: &str) -> Option<crate::db::Job> {
        if let Ok(Some(_)) = self.db.get_job(id).await {
            if self.db.redownload_job(id).await.is_ok() {
                 {
                    let mut q = self.queue.lock().unwrap();
                    q.push_back(id.to_string());
                }
                self.notify.notify_one();
                return self.db.get_job(id).await.ok().flatten();
            }
        }
        None
    }

    pub async fn set_max_concurrent(&self, limit: usize) {
        if limit > 0 {
            let mut w = self.max_concurrent.write().await;
            *w = limit;
            self.notify.notify_one();
        }
    }
    
    pub async fn get_max_concurrent(&self) -> usize {
        *self.max_concurrent.read().await
    }

    pub async fn set_sync_destination(&self, dest: String) {
        let mut w = self.sync_destination.write().await;
        *w = dest;
    }

    pub async fn get_sync_destination(&self) -> String {
        self.sync_destination.read().await.clone()
    }
    
    pub async fn get_sync_state(&self) -> SyncState {
        let mut state = self.sync_state.read().await.clone();
        
        if Path::new(SYNC_MARKER_FILE).exists() {
             if let Ok(meta) = std::fs::metadata(SYNC_MARKER_FILE) {
                 if let Ok(modified) = meta.modified() {
                     let modified_utc: DateTime<Utc> = modified.into();
                     state.unsynced_count = self.file_index.count_files_after(modified_utc);
                     state.last_run = Some(modified_utc);
                 }
             }
        } else {
             state.unsynced_count = self.file_index.count_files_after(DateTime::<Utc>::from(std::time::SystemTime::UNIX_EPOCH));
        }
        
        state
    }

    pub async fn run_sync(&self) -> Result<String, anyhow::Error> {
        {
            let state = self.sync_state.read().await;
            if state.status == "running" {
                return Ok("Sync is already running".to_string());
            }
        }

        let dest = self.get_sync_destination().await;
        let cwd = std::env::current_dir()?;
        let data_dir = cwd.join("data"); 
        
        info!("Starting cloud sync to {}", dest);
        
        {
            let mut state = self.sync_state.write().await;
            state.status = "running".to_string();
            state.logs.clear();
            state.logs.push(format!("Starting sync to {}...", dest));
            state.error = None;
        }
        
        let dest_clone = dest.clone();
        let state_clone = self.sync_state.clone();
        
        tokio::spawn(async move {
            let mut child = Command::new("rclone")
                .arg("copy")
                .arg(&data_dir)
                .arg(&dest_clone)
                .arg("--ignore-existing")
                .arg("--transfers=4")
                .arg("--exclude")
                .arg("jobs.sqlite*")
                .arg("--exclude")
                .arg(".last_sync")
                .arg("-v")
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .spawn()
                .expect("Failed to spawn rclone");

            let stdout = child.stdout.take().expect("Failed to open stdout");
            let stderr = child.stderr.take().expect("Failed to open stderr");
            
            let state_logger = state_clone.clone();
            
            let stderr_task = tokio::spawn(async move {
                let mut reader = BufReader::new(stderr).lines();
                while let Ok(Some(line)) = reader.next_line().await {
                    let mut s = state_logger.write().await;
                    if s.logs.len() > 100 { s.logs.remove(0); }
                    s.logs.push(line);
                }
            });
            
            let state_logger_out = state_clone.clone();
             let stdout_task = tokio::spawn(async move {
                let mut reader = BufReader::new(stdout).lines();
                while let Ok(Some(line)) = reader.next_line().await {
                    let mut s = state_logger_out.write().await;
                    if s.logs.len() > 100 { s.logs.remove(0); }
                    s.logs.push(line);
                }
            });

            match child.wait().await {
                Ok(status) => {
                     let _ = stderr_task.await;
                     let _ = stdout_task.await;
                     
                     let mut s = state_clone.write().await;
                     if status.success() {
                         s.status = "idle".to_string();
                         s.logs.push("Sync completed successfully.".to_string());
                         s.unsynced_count = 0;
                         let _ = File::create(SYNC_MARKER_FILE);
                         if let Ok(meta) = std::fs::metadata(SYNC_MARKER_FILE) {
                             if let Ok(mod_time) = meta.modified() {
                                 s.last_run = Some(mod_time.into());
                             }
                         }
                         info!("Cloud sync completed successfully to {}", dest_clone);
                     } else {
                         s.status = "error".to_string();
                         let code = status.code().unwrap_or(-1);
                         let msg = format!("Sync failed with exit code {}", code);
                         s.error = Some(msg.clone());
                         s.logs.push(msg);
                         error!("Cloud sync failed");
                     }
                }
                Err(e) => {
                     let mut s = state_clone.write().await;
                     s.status = "error".to_string();
                     s.error = Some(e.to_string());
                     s.logs.push(format!("Process error: {}", e));
                }
            }
        });

        Ok(format!("Sync started to {}", dest))
    }
    
    pub async fn has_job(&self, url: &str) -> bool {
        self.db.has_active_job(url).await.unwrap_or(false)
    }

    async fn process_next(&self) {
        let max = *self.max_concurrent.read().await;
        
        loop {
            let active_count = self.active_jobs.len();
            if active_count >= max {
                break;
            }

            let next_id = {
                let mut q = self.queue.lock().unwrap();
                q.pop_front()
            };

            if let Some(id) = next_id {
                if let Ok(Some(job)) = self.db.get_job(&id).await {
                     if job.status == "queued" {
                         self.start_download_task(job).await;
                     } else {
                         continue;
                     }
                }
            } else {
                break;
            }
        }
    }

    async fn start_download_task(&self, job: crate::db::Job) {
        let id = job.id.clone();
        let url = job.url.clone();
        let db = self.db.clone();
        let file_index = self.file_index.clone();
        let active_jobs = self.active_jobs.clone();
        let notify = self.notify.clone();
        let token = CancellationToken::new();
        
        active_jobs.insert(id.clone(), token.clone());
        let _ = db.mark_downloading(&id).await;
        info!("Starting job {} for {}", id, url);

        tokio::spawn(async move {
            let result = Self::run_yt_dlp(&id, &url, &db, token.clone()).await;
            
            match result {
                Ok(filename) => {
                     let folder = get_today_folder();
                     let full_path = folder.join(&filename);
                     let _ = db.mark_done(&id, &filename).await;
                     file_index.add_file(&full_path);
                     info!("Job {} completed. File: {}", id, filename);
                }
                Err(e) => {
                    let msg = e.to_string();
                    if msg.contains("cancelled") {
                         if let Ok(true) = db.check_job_exists(&id).await {
                             let _ = db.mark_failed(&id, "Cancelled").await;
                         }
                         info!("Job {} cancelled", id);
                    } else {
                        let _ = db.mark_failed(&id, &msg).await;
                        error!("Job {} failed: {}", id, msg);
                    }
                }
            }
            
            active_jobs.remove(&id);
            notify.notify_one();
        });
    }

    async fn run_yt_dlp(id: &str, url: &str, db: &Db, token: CancellationToken) -> Result<String, anyhow::Error> {
        let cwd = std::env::current_dir()?;
        let python_path = cwd.join("venv_python/bin/python");
        let yt_dlp_path = cwd.join("bin/yt-dlp");
        let output_folder = get_today_folder();
        let template = output_folder.join("%(title)s.%(ext)s");

        let mut child = Command::new("nice")
            .arg("-n")
            .arg("10")
            .arg(python_path)
            .arg(yt_dlp_path)
            .arg("--newline")
            .arg("--impersonate")
            .arg("chrome")
            .arg("--no-check-certificates")
            .arg("--add-header")
            .arg("Referer:https://www.tiktok.com/")
            .arg("-f")
            .arg("bv*+ba/best")
            .arg("--merge-output-format")
            .arg("mp4")
            .arg("--remux-video")
            .arg("mp4")
            .arg("--postprocessor-args")
            .arg("ffmpeg:-movflags +faststart")
            .arg("-o")
            .arg(template)
            .arg(url)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true)
            .spawn()?;

        let stdout = child.stdout.take().expect("Failed to open stdout");
        let stderr = child.stderr.take().expect("Failed to open stderr");
        
        let found_filename = Arc::new(Mutex::new(String::new()));
        let found_filename_clone = found_filename.clone();
        let db_clone = db.clone();
        let id_clone = id.to_string();

        let stdout_task = tokio::spawn(async move {
            let mut reader = BufReader::new(stdout).lines();
            let mut last_progress_update = std::time::Instant::now();
            
            let re_progress = Regex::new(r"[download]\s+(\d+\.?\d*)%").unwrap();
            let re_eta = Regex::new(r"ETA\s+(\d{2}:\d{2}(?:\:\d{2})?)").unwrap();
            let re_dest = Regex::new(r"\b[dD]estination:\s+(.*)").unwrap();
            let re_merge = Regex::new(r#"\b[mM]erger\b.*into\s+"?([^"]*)"?"#).unwrap();
            let re_already = Regex::new(r"\b[dD]ownloaded\s+(.*)\s+has already been downloaded").unwrap();

            while let Ok(Some(line)) = reader.next_line().await {
                 if let Some(caps) = re_progress.captures(&line) {
                    if let Some(m) = caps.get(1) {
                        if let Ok(p) = m.as_str().parse::<f64>() {
                            if last_progress_update.elapsed().as_secs() >= 1 {
                                let eta = if let Some(eta_caps) = re_eta.captures(&line) {
                                    Self::parse_eta(eta_caps.get(1).unwrap().as_str())
                                } else {
                                    None
                                };
                                let _ = db_clone.update_progress(&id_clone, p as i64, eta).await;
                                last_progress_update = std::time::Instant::now();
                            }
                        }
                    }
                }
                
                if let Some(caps) = re_dest.captures(&line) {
                    if let Some(m) = caps.get(1) {
                        let mut w = found_filename_clone.lock().unwrap();
                        *w = m.as_str().trim().to_string();
                    }
                }
                
                if let Some(caps) = re_merge.captures(&line) {
                    if let Some(m) = caps.get(1) {
                         let raw = m.as_str().trim();
                         let mut w = found_filename_clone.lock().unwrap();
                         *w = raw.trim_matches('"').to_string();
                    }
                }
                
                if let Some(caps) = re_already.captures(&line) {
                    if let Some(m) = caps.get(1) {
                        {
                            let mut w = found_filename_clone.lock().unwrap();
                            *w = m.as_str().trim().to_string();
                        }
                        let _ = db_clone.update_progress(&id_clone, 100, Some(0)).await;
                    }
                }
            }
        });

        tokio::spawn(async move {
             let mut reader = BufReader::new(stderr).lines();
             while let Ok(Some(_)) = reader.next_line().await { }
        });

        tokio::select! {
            _ = token.cancelled() => {
                child.kill().await?;
                Err(anyhow::anyhow!("Job cancelled"))
            }
            status = child.wait() => {
                let status = status?;
                let _ = stdout_task.await; 
                
                if status.success() {
                    let name = found_filename.lock().unwrap().clone();
                    if !name.is_empty() {
                         let name = Path::new(&name).file_name().unwrap().to_string_lossy().to_string();
                         Ok(name)
                    } else {
                         Ok("unknown.mp4".to_string())
                    }
                } else {
                    Err(anyhow::anyhow!("Process exited with code {}", status.code().unwrap_or(-1)))
                }
            }
        }
    }

    fn parse_eta(eta_str: &str) -> Option<i64> {
        let parts: Vec<&str> = eta_str.split(':').collect();
        let seconds;
        if parts.len() == 3 {
            seconds = parts[0].parse::<i64>().unwrap_or(0) * 3600 
                + parts[1].parse::<i64>().unwrap_or(0) * 60 
                + parts[2].parse::<i64>().unwrap_or(0);
        } else if parts.len() == 2 {
            seconds = parts[0].parse::<i64>().unwrap_or(0) * 60 
                + parts[1].parse::<i64>().unwrap_or(0);
        } else {
            seconds = parts[0].parse::<i64>().unwrap_or(0);
        }
        Some(seconds)
    }
}
