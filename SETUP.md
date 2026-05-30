# SunDowner - Setup

Electron desktop app for downloading your entire Suno AI library with lyrics, genre, metadata, and organized folders.

## Prerequisites

- Node.js 18+

## Install

    npm install

## Run (Development)

    npm start

Launches Electron app.

## Build (Production)

    npm run build

Creates installer via electron-builder.

## Configuration

Edit config.json with your Suno credentials/settings.

## Known Issues

- Requires Electron runtime (npm start launches desktop window)
- SUNOSYNC subfolder contains sync logic
- node-id3 used for MP3 metadata tagging
