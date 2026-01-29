# Tiak

A self-hosted video downloader and gallery manager.

> **Note:** This whole project is "Vibe Coded". While I guided the architecture and implementation, a significant portion of the code was generated with AI assistance. I only did some of the work myself!

## Features

- **Queue System**: Add URLs to a download queue (supports TikTok, etc. via yt-dlp).
- **Gallery**: Browse downloaded videos by date with a custom player.
- **History**: View download logs and retry failed jobs.
- **PWA Share Target**: Share videos directly from the TikTok app (or others) to Tiak installed on your phone.
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

See [server/README.md](server/README.md) for API documentation.

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

## Issues

If you face any issues, feel free to create an issue in this repository.

## License

MIT License. See [LICENSE](LICENSE) file.