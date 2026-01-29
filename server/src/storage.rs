use std::path::{Path, PathBuf};
use std::sync::{Arc, RwLock};
use walkdir::WalkDir;
use serde::Serialize;
use anyhow::Result;
use std::time::SystemTime;
use chrono::{DateTime, Utc, Local, Datelike};

pub const DATA_ROOT: &str = "data";

#[derive(Debug, Clone, Serialize)]
pub struct FileItem {
    pub path: String,
    pub name: String,
    pub size: u64,
    #[serde(rename = "createdAt")]
    pub created_at: DateTime<Utc>,
    #[serde(rename = "dateFolder")]
    pub date_folder: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct FileIndexResponse {
    #[serde(rename = "byDate")]
    pub by_date: std::collections::HashMap<String, Vec<FileItem>>,
    #[serde(rename = "lastScan")]
    pub last_scan: i64,
}

#[derive(Clone)]
pub struct FileIndex {
    files: Arc<RwLock<Vec<FileItem>>>,
    last_scan: Arc<RwLock<i64>>,
    cached_index: Arc<RwLock<Option<FileIndexResponse>>>,
}

impl FileIndex {
    pub fn new() -> Self {
        Self {
            files: Arc::new(RwLock::new(Vec::new())),
            last_scan: Arc::new(RwLock::new(0)),
            cached_index: Arc::new(RwLock::new(None)),
        }
    }

    pub async fn build_index(&self) -> Result<()> {
        let root = Path::new(DATA_ROOT);
        let mut files = Vec::new();
        let timestamp = Utc::now().timestamp_millis();
        
        if root.exists() {
             let root_path = root.to_path_buf();
             let entries = tokio::task::spawn_blocking(move || {
                let mut res = Vec::new();
                let walker = WalkDir::new(&root_path)
                    .into_iter()
                    .filter_map(|e| e.ok())
                    .filter(|e| e.file_type().is_file());
                
                for entry in walker {
                    let path = entry.path();
                    let name = entry.file_name().to_string_lossy().to_string();
                    
                    if name.contains("jobs.sqlite") {
                        continue;
                    }

                    if let Ok(meta) = entry.metadata() {
                        let size = meta.len();
                        let created: DateTime<Utc> = meta.created().unwrap_or(SystemTime::now()).into();
                        
                        let relative_path = path.strip_prefix(&root_path).unwrap_or(path);
                        let date_folder = relative_path.components().next()
                            .map(|c| c.as_os_str().to_string_lossy().to_string())
                            .unwrap_or_default();

                        res.push(FileItem {
                            path: path.to_string_lossy().to_string(),
                            name,
                            size,
                            created_at: created,
                            date_folder,
                        });
                    }
                }
                res
            }).await?;
            files = entries;
        }

        {
            let mut w = self.files.write().unwrap();
            *w = files;
        }
        {
            let mut t = self.last_scan.write().unwrap();
            *t = timestamp;
        }
        {
            let mut cache = self.cached_index.write().unwrap();
            *cache = None;
        }
        
        Ok(())
    }

    pub fn get_index(&self) -> FileIndexResponse {
        {
            let cache = self.cached_index.read().unwrap();
            if let Some(ref cached) = *cache {
                return cached.clone();
            }
        }
        
        let files = self.files.read().unwrap();
        let last_scan = *self.last_scan.read().unwrap();
        
        let mut by_date: std::collections::HashMap<String, Vec<FileItem>> = std::collections::HashMap::new();
        
        for file in files.iter() {
            by_date.entry(file.date_folder.clone())
                .or_default()
                .push(file.clone());
        }
        
        for list in by_date.values_mut() {
            list.sort_by(|a, b| b.created_at.cmp(&a.created_at));
        }

        let response = FileIndexResponse {
            by_date,
            last_scan,
        };
        
        {
            let mut cache = self.cached_index.write().unwrap();
            *cache = Some(response.clone());
        }
        
        response
    }

    pub fn add_file(&self, path: &Path) {
        if !path.exists() { return; }
        
        let root = Path::new(DATA_ROOT);
        if let Ok(meta) = path.metadata() {
            let name = path.file_name().unwrap_or_default().to_string_lossy().to_string();
            let size = meta.len();
            let created: DateTime<Utc> = meta.created().unwrap_or(SystemTime::now()).into();
            let relative_path = path.strip_prefix(root).unwrap_or(path);
            let date_folder = relative_path.components().next()
                .map(|c| c.as_os_str().to_string_lossy().to_string())
                .unwrap_or_default();

            let item = FileItem {
                path: path.to_string_lossy().to_string(),
                name,
                size,
                created_at: created,
                date_folder,
            };

            {
                let mut w = self.files.write().unwrap();
                w.push(item);
            }
            
            {
                let mut cache = self.cached_index.write().unwrap();
                *cache = None;
            }
        }
    }

    pub fn remove_file(&self, path_str: &str) {
        {
            let mut w = self.files.write().unwrap();
            if let Some(pos) = w.iter().position(|x| x.path == path_str) {
                w.remove(pos);
            }
        }
        
        {
            let mut cache = self.cached_index.write().unwrap();
            *cache = None;
        }
    }

    pub fn count_files_after(&self, timestamp: DateTime<Utc>) -> usize {
        let files = self.files.read().unwrap();
        files.iter().filter(|f| f.created_at > timestamp).count()
    }
}

pub fn get_today_folder() -> PathBuf {
    let now = Local::now();
    let folder_name = now.format("%Y-%m-%d").to_string();
    let path = Path::new(DATA_ROOT).join(folder_name);
    if !path.exists() {
        let _ = std::fs::create_dir_all(&path);
    }
    path
}

pub async fn get_disk_usage() -> Result<(u64, usize)> {
    let root = Path::new(DATA_ROOT);
    if !root.exists() { return Ok((0, 0)); }
    
    let root_path = root.to_path_buf();
    let result = tokio::task::spawn_blocking(move || {
        let mut total_size = 0;
        let mut count = 0;
        
        for entry in WalkDir::new(&root_path).into_iter().filter_map(|e| e.ok()) {
            if entry.file_type().is_file() {
                 if entry.file_name().to_string_lossy().contains("jobs.sqlite") {
                    continue;
                }
                count += 1;
                total_size += entry.metadata().map(|m| m.len()).unwrap_or(0);
            }
        }
        (total_size, count)
    }).await?;
    
    Ok(result)
}