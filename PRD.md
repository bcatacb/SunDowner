# SunDowner - Product Requirements

## Problem Statement

Suno AI users generate hundreds of songs but have no easy way to bulk-download them with proper metadata, lyrics, and organization.

## User Personas

- **Suno Creator** - Has 500+ songs on Suno, wants them locally organized
- **Archivist** - Needs proper ID3 tags and folder structure for music library

## Core Requirements

- [x] Electron desktop app
- [x] Configuration for Suno account
- [x] ID3 metadata tagging
- [ ] Suno API connection and auth
- [ ] Bulk download with progress
- [ ] Folder organization (by genre, date, mood)
- [ ] Lyrics extraction and embedding
- [ ] Incremental sync (only new songs)

## Prioritized Backlog

### P0
- Suno API authentication flow
- Bulk download with progress bar

### P1
- Folder organization rules (configurable)
- Lyrics embedding in ID3 tags
- Incremental sync detection

### P2
- Playlist export (M3U)
- Duplicate detection
- Cloud backup integration

## Tech Stack Summary

Electron | Node.js | node-id3 | electron-builder

## Next Tasks

1. Implement Suno API auth
2. Build download queue with progress UI
3. Add folder organization logic
