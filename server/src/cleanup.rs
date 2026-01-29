use crate::db::Db;
use crate::storage::DATA_ROOT;
use std::path::Path;
use chrono::{DateTime, Utc};
use tracing::info;

pub async fn run_cleanup(db: &Db) {
    info!("[Cleanup] Starting cleanup task...");
    
    let cutoff = Utc::now() - chrono::Duration::days(7);
    let cutoff_ts = cutoff.timestamp_millis();
    
    match db.delete_old_failed_jobs(cutoff_ts).await {
        Ok(count) => info!("[Cleanup] Deleted {} old failed jobs", count),
        Err(e) => info!("[Cleanup] Error deleting failed jobs: {}", e),
    }
}

pub async fn scan_for_missing_files(db: &Db) {
    info!("[Cleanup] Scanning for missing files...");
    
    let jobs = match db.get_jobs_for_missing_scan().await {
        Ok(j) => j,
        Err(_) => return,
    };
    
    let mut missing_count = 0;
    
    for job in jobs {
        if let Some(filename) = &job.filename {
            let ts = job.completed_at.or(Some(job.created_at)).unwrap();
            
            let date = DateTime::<Utc>::from_timestamp_millis(ts).unwrap_or(Utc::now());
            let folder_name = date.format("%Y-%m-%d").to_string();
            
            let path = Path::new(DATA_ROOT).join(folder_name).join(filename);
            
            if !path.exists() {
                if let Ok(_) = db.mark_missing(&job.id).await {
                    missing_count += 1;
                }
            }
        }
    }
    
    if missing_count > 0 {
        info!("[Cleanup] Marked {} jobs as missing", missing_count);
    } else {
        info!("[Cleanup] No missing files found");
    }
}