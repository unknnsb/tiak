use dotenv::dotenv;
use std::sync::Arc;
use tracing::{info, Level};
use tracing_subscriber::FmtSubscriber;
use crate::db::Db;
use crate::queue::DownloadQueue;
use crate::storage::FileIndex;
use crate::routes::{create_router, AppState};
use crate::cleanup::{run_cleanup, scan_for_missing_files};
use crate::config::Config;
use tokio::net::TcpListener;
use tower_http::cors::{CorsLayer, Any};
use axum::http::HeaderValue;

mod db;
mod queue;
mod storage;
mod routes;
mod cleanup;
mod config;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    dotenv().ok();

    let config = Config::from_env();

    let subscriber = FmtSubscriber::builder()
        .with_max_level(Level::INFO)
        .finish();
    tracing::subscriber::set_global_default(subscriber).expect("setting default subscriber failed");

    let db = Db::new(&config.db_path).await?;
    info!("Database initialized at {}", config.db_path);

    let file_index = Arc::new(FileIndex::new());
    file_index.build_index().await?;
    info!("File index built");
    
    let index_clone = file_index.clone();
    tokio::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_secs(5 * 60)).await;
        
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(30 * 60));
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        
        loop {
            interval.tick().await;
            info!("Starting scheduled file index rebuild...");
            if let Err(e) = index_clone.build_index().await {
                 info!("Error rebuilding index: {}", e);
            } else {
                info!("File index rebuild completed");
            }
        }
    });

    let queue = DownloadQueue::new(db.clone(), file_index.clone());
    queue.load_initial_state().await;
    info!("Queue initialized");

    let db_clone = db.clone();
    tokio::spawn(async move {
         run_cleanup(&db_clone).await;
         scan_for_missing_files(&db_clone).await;

         let mut interval = tokio::time::interval(std::time::Duration::from_secs(24 * 60 * 60));
         loop {
             interval.tick().await;
             run_cleanup(&db_clone).await;
             scan_for_missing_files(&db_clone).await;
         }
    });

    let app_state = AppState {
        db: db.clone(),
        queue: queue.clone(),
        file_index: file_index.clone(),
    };

    let cors_origins: Vec<HeaderValue> = config.allowed_origins
        .iter()
        .map(|s| s.parse::<HeaderValue>().unwrap())
        .collect();

    let cors = CorsLayer::new()
        .allow_origin(cors_origins)
        .allow_methods(Any)
        .allow_headers(Any);
        
    let app = create_router(app_state).layer(cors);

    let addr = format!("0.0.0.0:{}", config.server_port);
    info!("Server listening on {}", addr);
    
    let listener = TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}