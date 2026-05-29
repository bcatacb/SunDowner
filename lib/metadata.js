/**
 * Metadata embedding using node-id3.
 * Handles ID3 tag writing for MP3 files and lyrics saving.
 */

const NodeID3 = require('node-id3');
const https = require('https');
const path = require('path');
const fs = require('fs');

/**
 * Download image from URL and return as Buffer.
 */
function downloadImage(url, timeout = 15000) {
  return new Promise((resolve, reject) => {
    if (!url) { resolve(null); return; }

    const makeRequest = (requestUrl, redirectCount = 0) => {
      if (redirectCount > 5) { resolve(null); return; }

      const parsedUrl = new URL(requestUrl);
      const options = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || 443,
        path: parsedUrl.pathname + parsedUrl.search,
        method: 'GET',
        timeout: timeout
      };

      const protocol = parsedUrl.protocol === 'https:' ? https : require('http');

      const req = protocol.request(options, (res) => {
        // Handle redirects
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          makeRequest(res.headers.location, redirectCount + 1);
          return;
        }

        if (res.statusCode !== 200) { resolve(null); return; }

        const chunks = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => resolve(Buffer.concat(chunks)));
      });

      req.on('error', () => resolve(null));
      req.on('timeout', () => { req.destroy(); resolve(null); });
      req.end();
    };

    makeRequest(url);
  });
}

/**
 * Embed metadata into an MP3 file.
 * @param {string} filePath - Path to the MP3 file
 * @param {object} meta - Metadata object
 * @param {string} meta.title - Song title
 * @param {string} meta.artist - Artist/display name
 * @param {string} meta.genre - Genre/tags
 * @param {string} meta.year - Year (from created_at)
 * @param {string} meta.comment - Comment/prompt
 * @param {string} meta.lyrics - Lyrics text
 * @param {string} meta.uuid - Suno clip UUID
 * @param {Buffer|null} meta.imageBuffer - Cover art buffer
 */
function embedMetadata(filePath, meta) {
  try {
    const ext = path.extname(filePath).toLowerCase();
    if (ext !== '.mp3') {
      // node-id3 only supports MP3 reliably
      return false;
    }

    const tags = {};

    if (meta.title) tags.title = meta.title;
    if (meta.artist) tags.artist = meta.artist;
    if (meta.genre) tags.genre = meta.genre;
    if (meta.year) tags.year = meta.year;

    if (meta.comment) {
      tags.comment = {
        language: 'eng',
        text: meta.comment
      };
    }

    if (meta.lyrics) {
      tags.unsynchronisedLyrics = {
        language: 'eng',
        text: meta.lyrics
      };
    }

    // Custom SUNO_UUID tag
    if (meta.uuid) {
      tags.userDefinedText = [{
        description: 'SUNO_UUID',
        value: meta.uuid
      }];
    }

    // Cover art
    if (meta.imageBuffer) {
      tags.image = {
        mime: 'image/jpeg',
        type: { id: 3, name: 'front cover' },
        description: 'Cover',
        imageBuffer: meta.imageBuffer
      };
    }

    const success = NodeID3.write(tags, filePath);
    return success;
  } catch (err) {
    console.error('Metadata embed error:', err.message);
    return false;
  }
}

/**
 * Save lyrics to a .txt file alongside the audio file.
 */
function saveLyricsFile(audioPath, lyrics) {
  if (!lyrics || !lyrics.trim()) return false;
  try {
    const txtPath = audioPath.replace(/\.[^.]+$/, '.txt');
    fs.writeFileSync(txtPath, lyrics, 'utf-8');
    return true;
  } catch (err) {
    console.error('Failed to save lyrics file:', err.message);
    return false;
  }
}

module.exports = { embedMetadata, downloadImage, saveLyricsFile };
