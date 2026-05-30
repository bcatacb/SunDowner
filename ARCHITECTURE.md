# SunDowner - Architecture

## Purpose

Desktop application that connects to Suno AI, downloads your entire music library, and organizes files with proper metadata (ID3 tags), lyrics, and folder structure.

## Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Electron |
| Backend | Node.js (main process) |
| Frontend | HTML/CSS/JS (renderer) |
| Metadata | node-id3 (MP3 tagging) |
| Build | electron-builder |

## Directory Structure

    SunDowner/
      main.js         - Electron main process
      preload.js      - Preload script (IPC bridge)
      config.json     - App configuration
      lib/            - Core logic modules
      renderer/       - UI (HTML/CSS/JS)
      dist/           - Built output
      SUNOSYNC/       - Suno sync module

## Features

- Connect to Suno AI account
- Download all songs with metadata
- Apply ID3 tags (title, artist, genre)
- Organize into folders by genre/date
- Sync new songs incrementally

## External Services

| Service | Required |
|---------|----------|
| Suno AI | Yes (source of music) |
| Internet | Yes (download) |

## Feature Status

- [x] Electron app shell
- [x] Config management
- [x] ID3 tagging (node-id3)
- [x] SUNOSYNC module
- [ ] Full Suno API integration
- [ ] Incremental sync
- [ ] Progress UI
