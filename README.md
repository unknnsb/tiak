# Tiak

A self-hosted video downloader and gallery manager.

## Features

- **Queue System**: Add URLs to a download queue (supports TikTok, etc. via yt-dlp).
- **Gallery**: Browse downloaded videos by date.
- **History**: View download logs and retry failed jobs.
- **PWA**: Installable on mobile devices.
- **Sync**: Optional rclone sync to cloud storage.

## Setup

### Prerequisites

- Node.js 18+
- Rust (latest stable)
- Python 3 + `yt-dlp` (installed automatically or available in path)
- ffmpeg

### Server

1. Navigate to `server/`:
   ```bash
   cd server
   ```
2. Create `.env`:
   ```bash
   cp .env.example .env
   ```
3. Run:
   ```bash
   cargo run --release
   ```

### Web

1. Navigate to `web/`:
   ```bash
   cd web
   ```
2. Create `.env`:
   ```bash
   cp .env.example .env.local
   ```
3. Install dependencies:
   ```bash
   npm install
   # or bun install
   ```
4. Build and start:
   ```bash
   npm run build
   npm start
   ```

## Configuration

- **Server**: Modify `server/.env` to change the port or database path.
- **Web**: Modify `web/.env.local` to point to the server API URL.
