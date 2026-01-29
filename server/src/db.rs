use sqlx::{sqlite::SqlitePoolOptions, Pool, Sqlite, Row};
use std::path::Path;
use anyhow::Result;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct Job {
    pub id: String,
    pub url: String,
    pub status: String,
    pub progress: i64,
    pub eta: Option<i64>,
    pub filename: Option<String>,
    #[sqlx(rename = "createdAt")]
    pub created_at: i64,
    #[sqlx(rename = "startedAt")]
    pub started_at: Option<i64>,
    #[sqlx(rename = "completedAt")]
    pub completed_at: Option<i64>,
    pub retries: i64,
    pub error: Option<String>,
}

#[derive(Clone)]
pub struct Db {
    pool: Pool<Sqlite>,
}

impl Db {
    pub async fn new(db_path: &str) -> Result<Self> {
        let path = Path::new(db_path);
        if let Some(parent) = path.parent() {
            tokio::fs::create_dir_all(parent).await?;
        }

        if !path.exists() {
             tokio::fs::File::create(path).await?;
        }

        let pool = SqlitePoolOptions::new()
            .max_connections(5)
            .connect(&format!("sqlite://{}", db_path))
            .await?;

        sqlx::query("PRAGMA journal_mode = WAL;")
            .execute(&pool)
            .await?;

        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS jobs (
                id TEXT PRIMARY KEY,
                url TEXT NOT NULL,
                status TEXT NOT NULL,
                progress INTEGER DEFAULT 0,
                eta INTEGER,
                filename TEXT,
                createdAt INTEGER NOT NULL,
                startedAt INTEGER,
                completedAt INTEGER,
                retries INTEGER DEFAULT 0,
                error TEXT
            );

            CREATE INDEX IF NOT EXISTS idx_jobs_createdAt ON jobs(createdAt);
            CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
            "#
        )
        .execute(&pool)
        .await?;

        Ok(Self { pool })
    }

    pub async fn add_job(&self, url: String) -> Result<Job> {
        let id = Uuid::new_v4().to_string();
        let created_at = chrono::Utc::now().timestamp_millis();
        let job = Job {
            id: id.clone(),
            url: url.clone(),
            status: "queued".to_string(),
            progress: 0,
            eta: None,
            filename: None,
            created_at,
            started_at: None,
            completed_at: None,
            retries: 0,
            error: None,
        };

        sqlx::query(
            "INSERT INTO jobs (id, url, status, createdAt) VALUES (?, ?, 'queued', ?)"
        )
        .bind(&job.id)
        .bind(&job.url)
        .bind(job.created_at)
        .execute(&self.pool)
        .await?;

        Ok(job)
    }

    pub async fn get_job(&self, id: &str) -> Result<Option<Job>> {
        let job = sqlx::query_as::<_, Job>("SELECT * FROM jobs WHERE id = ?")
            .bind(id)
            .fetch_optional(&self.pool)
            .await?;
        Ok(job)
    }

    pub async fn get_queued_jobs(&self) -> Result<Vec<Job>> {
        let jobs = sqlx::query_as::<_, Job>("SELECT * FROM jobs WHERE status = 'queued' ORDER BY createdAt ASC")
            .fetch_all(&self.pool)
            .await?;
        Ok(jobs)
    }
    
    pub async fn get_active_jobs(&self) -> Result<Vec<Job>> {
        let jobs = sqlx::query_as::<_, Job>("SELECT * FROM jobs WHERE status = 'downloading' ORDER BY createdAt ASC")
            .fetch_all(&self.pool)
            .await?;
        Ok(jobs)
    }

    pub async fn get_all_jobs(&self) -> Result<Vec<Job>> {
         let jobs = sqlx::query_as::<_, Job>("SELECT * FROM jobs WHERE status IN ('queued', 'downloading', 'failed') ORDER BY createdAt ASC")
            .fetch_all(&self.pool)
            .await?;
        Ok(jobs)
    }

    pub async fn has_active_job(&self, url: &str) -> Result<bool> {
        let count: i64 = sqlx::query_scalar(
            "SELECT count(*) FROM jobs WHERE url = ? AND status IN ('queued', 'downloading')"
        )
        .bind(url)
        .fetch_one(&self.pool)
        .await?;
        Ok(count > 0)
    }

    pub async fn find_done_job_by_url(&self, url: &str) -> Result<Option<Job>> {
        let job = sqlx::query_as::<_, Job>(
            "SELECT * FROM jobs WHERE url = ? AND status = 'done' ORDER BY completedAt DESC LIMIT 1"
        )
        .bind(url)
        .fetch_optional(&self.pool)
        .await?;
        Ok(job)
    }

    pub async fn update_progress(&self, id: &str, progress: i64, eta: Option<i64>) -> Result<()> {
        sqlx::query("UPDATE jobs SET progress = ?, eta = ? WHERE id = ?")
            .bind(progress)
            .bind(eta)
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    pub async fn mark_downloading(&self, id: &str) -> Result<()> {
        let now = chrono::Utc::now().timestamp_millis();
        sqlx::query("UPDATE jobs SET status = 'downloading', startedAt = ? WHERE id = ?")
            .bind(now)
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    pub async fn mark_done(&self, id: &str, filename: &str) -> Result<()> {
        let now = chrono::Utc::now().timestamp_millis();
        sqlx::query("UPDATE jobs SET status = 'done', progress = 100, eta = NULL, filename = ?, completedAt = ? WHERE id = ?")
            .bind(filename)
            .bind(now)
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    pub async fn mark_failed(&self, id: &str, error: &str) -> Result<()> {
        let now = chrono::Utc::now().timestamp_millis();
        sqlx::query("UPDATE jobs SET status = 'failed', error = ?, completedAt = ? WHERE id = ?")
            .bind(error)
            .bind(now)
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    pub async fn increment_retry(&self, id: &str) -> Result<()> {
        sqlx::query(
            "UPDATE jobs SET retries = retries + 1, status = 'queued', error = NULL, progress = 0, eta = NULL, startedAt = NULL, completedAt = NULL WHERE id = ?"
        )
        .bind(id)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn redownload_job(&self, id: &str) -> Result<()> {
         sqlx::query(
            "UPDATE jobs SET status = 'queued', progress = 0, eta = NULL, error = NULL, retries = retries + 1, startedAt = NULL, completedAt = NULL WHERE id = ?"
        )
        .bind(id)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn reset_crashed_jobs(&self) -> Result<()> {
        sqlx::query("UPDATE jobs SET status = 'failed', error = 'crashed' WHERE status = 'downloading'")
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    pub async fn delete_job(&self, id: &str) -> Result<()> {
        sqlx::query("DELETE FROM jobs WHERE id = ?")
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }
    
    pub async fn check_job_exists(&self, id: &str) -> Result<bool> {
        let count: i64 = sqlx::query_scalar("SELECT count(*) FROM jobs WHERE id = ?")
            .bind(id)
            .fetch_one(&self.pool)
            .await?;
        Ok(count > 0)
    }

    pub async fn get_job_history(&self, limit: i64, offset: i64) -> Result<(Vec<Job>, i64)> {
        let items = sqlx::query_as::<_, Job>(
            "SELECT * FROM jobs ORDER BY createdAt DESC LIMIT ? OFFSET ?"
        )
        .bind(limit)
        .bind(offset)
        .fetch_all(&self.pool)
        .await?;

        let total: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM jobs")
            .fetch_one(&self.pool)
            .await?;
            
        Ok((items, total))
    }
    
    pub async fn export_all_jobs(&self) -> Result<Vec<Job>> {
        let jobs = sqlx::query_as::<_, Job>("SELECT * FROM jobs ORDER BY createdAt DESC")
            .fetch_all(&self.pool)
            .await?;
        Ok(jobs)
    }
    
    pub async fn import_job(&self, job: Job) -> Result<()> {
         sqlx::query(
            r#"
            INSERT INTO jobs (id, url, status, progress, eta, filename, createdAt, startedAt, completedAt, retries, error)
            VALUES (?, ?, 'imported', ?, ?, ?, ?, ?, ?, 0, ?)
            "#
        )
        .bind(job.id)
        .bind(job.url)
        .bind(job.progress)
        .bind(job.eta)
        .bind(job.filename)
        .bind(job.created_at)
        .bind(job.started_at)
        .bind(job.completed_at)
        .bind(job.error)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn scan_for_missing_files(&self) -> Result<()> {
        Ok(())
    }
    
     pub async fn mark_missing(&self, id: &str) -> Result<()> {
        sqlx::query("UPDATE jobs SET status = 'missing' WHERE id = ?")
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }
    
    pub async fn get_jobs_for_missing_scan(&self) -> Result<Vec<Job>> {
        let jobs = sqlx::query_as::<_, Job>("SELECT * FROM jobs WHERE status IN ('done', 'imported')")
            .fetch_all(&self.pool)
            .await?;
        Ok(jobs)
    }

    pub async fn delete_old_failed_jobs(&self, cutoff: i64) -> Result<u64> {
        let result = sqlx::query("DELETE FROM jobs WHERE status = 'failed' AND createdAt < ?")
            .bind(cutoff)
            .execute(&self.pool)
            .await?;
        Ok(result.rows_affected())
    }
}