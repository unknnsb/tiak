# Tiak Server

This is the backend for Tiak, written in Rust using Axum and SQLx. It manages the download queue, file storage, and serves the API for the frontend.

## Configuration

Copy `.env.example` to `.env` and adjust:

- `DB_PATH`: Path to the SQLite database.
- `SERVER_PORT`: Port to listen on (default 4697).
- `ALLOWED_ORIGINS`: Comma-separated list of allowed CORS origins.

## API Endpoints

### General
- `GET /`: Health check.

### Files
- `GET /api/files`: List all files grouped by date.
- `DELETE /api/files`: Delete specific files.
  - Body: `{ "paths": ["data/2024-01-01/video.mp4"] }`
- `POST /api/files/zip`: Create a zip archive of selected files.
  - Body: `{ "paths": [...] }`
- `GET /api/files/download?path=...`: Download a single file.
- `GET /api/files/stream?path=...`: Stream a video file (supports Range headers).
- `POST /api/files/resolve`: Resolve a shortened URL (e.g., TikTok share links).
  - Body: `{ "url": "https://vm.tiktok.com/..." }`

### Queue & Jobs
- `GET /api/queue/list`: List active and queued jobs.
- `POST /api/queue/add`: Add URLs to the download queue.
  - Body: `{ "urls": "url1\nurl2" }`
- `DELETE /api/queue/:id`: Cancel a pending or downloading job / Delete a job from history.
- `GET /api/queue/history`: Get paginated job history.
  - Query: `?page=1&limit=50`
- `POST /api/queue/retry/:id`: Retry a failed job.
- `POST /api/queue/redownload/:id`: Redownload a completed or missing job.
- `GET /api/queue/export`: Export job history as JSON.
- `POST /api/queue/import`: Import job history from JSON.

### System & Settings
- `GET /api/system/usage`: Get disk usage stats.
- `GET /api/settings`: Get current settings.
- `POST /api/settings`: Update settings.
  - Body: `{ "maxConcurrent": 2, "syncDestination": "..." }`

### Sync (Rclone)
- `POST /api/sync/run`: Manually trigger an rclone sync.
- `GET /api/sync/status`: Get the status of the background sync process.
