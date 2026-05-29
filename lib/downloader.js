/**
 * Downloader Module — mirrors SunoSync's per-song flow exactly.
 * For each song: refetch details → download audio → save lyrics → embed metadata
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const { SunoAPI } = require('./suno-api');
const { embedMetadata, downloadImage, saveLyricsFile } = require('./metadata');

let aborted = false;

const STEM_INDICATORS = [
  '(bass)', '(drums)', '(backing vocal)', '(backing vocals)', '(vocals)',
  '(instrumental)', '(woodwinds)', '(brass)', '(fx)', '(synth)',
  '(strings)', '(percussion)', '(keyboard)', '(guitar)'
];

function sanitize(name, maxLen = 200) {
  return name.replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim().substring(0, maxLen);
}

function isStem(clip) {
  const meta = clip.metadata || {};
  const clipType = meta.type || '';
  const topType = clip.type || '';
  const title = (clip.title || '').toLowerCase();
  return clipType === 'gen_stem' || clipType === 'stem' || topType.includes('stem') ||
    STEM_INDICATORS.some(ind => title.includes(ind));
}

function isSound(clip) {
  const meta = clip.metadata || {};
  return meta.type === 'sound' || meta.type === 'sound_effect';
}

function getBaseSongTitle(title) {
  let clean = title;
  for (const ind of STEM_INDICATORS) {
    clean = clean.replace(new RegExp(ind.replace(/[()]/g, '\\$&'), 'gi'), '');
  }
  return clean.trim();
}

function getSongDir(clip, baseDir, organizeBy, groupName) {
  const title = clip.title || clip.id;
  const safeTitle = sanitize(title);
  const createdAt = clip.created_at || '';

  if (isSound(clip)) return path.join(baseDir, 'Sounds');

  let groupDir = baseDir;
  if (organizeBy === 'month' && createdAt) {
    groupDir = path.join(baseDir, createdAt.substring(0, 7));
  } else if (organizeBy === 'playlist' && groupName) {
    groupDir = path.join(baseDir, sanitize(groupName));
  }

  const songFolderName = isStem(clip) ? sanitize(getBaseSongTitle(title)) : safeTitle;
  return path.join(groupDir, songFolderName);
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const doRequest = (currentUrl, redirects = 0) => {
      if (redirects > 5) { reject(new Error('Too many redirects')); return; }
      if (aborted) { reject(new Error('Aborted')); return; }

      https.get(currentUrl, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          doRequest(res.headers.location, redirects + 1); return;
        }
        if (res.statusCode !== 200) { res.resume(); reject(new Error(`HTTP ${res.statusCode}`)); return; }
        const file = fs.createWriteStream(destPath);
        res.pipe(file);
        file.on('finish', () => { file.close(); resolve(); });
        file.on('error', (err) => { fs.unlink(destPath, () => {}); reject(err); });
      }).on('error', reject);
    };
    doRequest(url);
  });
}

async function downloadWithRetry(url, destPath, retries = 3) {
  for (let i = 1; i <= retries; i++) {
    try { await downloadFile(url, destPath); return true; }
    catch (err) {
      if (err.message === 'Aborted') return false;
      if (i === retries) return false;
      await new Promise(r => setTimeout(r, 2000 * i));
    }
  }
  return false;
}

function applyFilters(clip, filters = {}) {
  if (!clip.id) return false;
  if (!filters.includeTrashed && clip.is_trashed) return false;
  if (filters.likedOnly) {
    const isLiked = clip.is_liked || (clip.reaction && clip.reaction.reaction_type === 'L');
    if (!isLiked) return false;
  }
  if (filters.hideStems && isStem(clip)) return false;
  if (filters.stemsOnly && !isStem(clip)) return false;
  if (filters.publicOnly && !clip.is_public) return false;
  const meta = clip.metadata || {};
  if (filters.hideStudio && (meta.type === 'studio_clip')) return false;
  return true;
}

// ============================================================
// SINGLE SONG DOWNLOAD — mirrors SunoSync exactly
// ============================================================

async function downloadSingleSong(clip, api, options, emit) {
  const { outputDir, formats, organizeBy, groupName, embedMeta, saveLyrics, saveCover } = options;

  const uuid = clip.id;
  const title = clip.title || uuid;
  let metadata = clip.metadata || {};
  let prompt = metadata.prompt || '';

  // --- ALWAYS REFETCH full clip details ---
  // The feed API never returns tags/genre reliably. Always hit the clip endpoint.
  try {
    const detail = await api.requestWithRetry('GET', `https://studio-api.prod.suno.com/api/clip/${uuid}`);
    metadata = detail.metadata || metadata;
    prompt = metadata.prompt || prompt;
    clip.metadata = metadata;
  } catch (e) {
    // Use what we have from the feed
  }

  // Extract all data
  const tags = metadata.tags || '';
  const lyrics = metadata.lyrics || metadata.text || prompt;
  const imageUrl = clip.image_url;
  const displayName = clip.display_name || '';
  const createdAt = clip.created_at || '';
  const year = createdAt ? createdAt.substring(0, 4) : null;

  // Determine output directory
  const songDir = getSongDir(clip, outputDir, organizeBy, groupName);
  const stemsDir = path.join(songDir, 'stems');
  const targetDir = isStem(clip) ? stemsDir : songDir;
  ensureDir(targetDir);

  const safeName = sanitize(title);
  let anySuccess = false;

  // --- Download each format ---
  for (const fmt of formats) {
    if (aborted) break;

    let url, ext;
    if (fmt === 'mp3') {
      url = clip.audio_url || `https://cdn1.suno.ai/${uuid}.mp3`;
      ext = '.mp3';
    } else if (fmt === 'mp4') {
      url = `https://cdn1.suno.ai/${uuid}.mp4`;
      ext = '.mp4';
    } else if (fmt === 'wav') {
      // WAV conversion
      try {
        await api.requestWavConversion(uuid);
        url = await api.pollWavUrl(uuid, 120000, 2000, () => aborted);
        if (!url) continue;
      } catch (e) { continue; }
      ext = '.wav';
    } else { continue; }

    const destPath = path.join(targetDir, `${safeName}${ext}`);
    if (fs.existsSync(destPath)) { anySuccess = true; continue; }

    const success = await downloadWithRetry(url, destPath);
    if (success) {
      anySuccess = true;

      // Embed metadata into MP3 right after download (same as SunoSync)
      if (fmt === 'mp3' && embedMeta) {
        try {
          const imageBuffer = imageUrl ? await downloadImage(imageUrl) : null;
          embedMetadata(destPath, {
            title: title,
            artist: displayName,
            genre: tags,
            year: year,
            comment: prompt,
            lyrics: lyrics,
            uuid: uuid,
            imageBuffer: imageBuffer
          });

          // Save cover.jpg
          if (saveCover && imageBuffer) {
            const coverPath = path.join(songDir, 'cover.jpg');
            if (!fs.existsSync(coverPath)) {
              fs.writeFileSync(coverPath, imageBuffer);
            }
          }
        } catch (e) {}
      }
    }
  }

  // --- Save lyrics .txt (same as SunoSync) ---
  if (saveLyrics && lyrics && lyrics.trim()) {
    const lyricsPath = path.join(songDir, `${safeName}.txt`);
    if (!fs.existsSync(lyricsPath)) {
      try { fs.writeFileSync(lyricsPath, lyrics, 'utf-8'); } catch (e) {}
    }
  }

  return anySuccess;
}

// ============================================================
// MAIN ORCHESTRATOR
// ============================================================

async function startDownload(options, emit) {
  aborted = false;

  const {
    token, outputDir, formats = ['mp3'], organizeBy = 'song',
    groupName = '', concurrent = 3, filters = {},
    smartResume = false, startPage = 1, maxPages = 0,
    embedMeta = true, saveLyrics = true, saveCover = true,
    source = 'library', sourceId = null, songs = null
  } = options;

  const api = new SunoAPI(token);
  let allClips = [];

  // --- Fetch song list ---
  if (songs && songs.length > 0) {
    allClips = songs;
    emit('download-log', { type: 'info', message: `Using ${allClips.length} pre-loaded songs.` });
  } else {
    emit('download-log', { type: 'info', message: 'Fetching song list...' });

    try {
      const fetchOptions = {
        startPage, maxPages, smartResume, existingCount: 0,
        shouldStop: () => aborted,
        onPage: async (clips, page) => {
          const filtered = clips.filter(c => applyFilters(c, filters));
          allClips.push(...filtered);
          emit('download-log', { type: 'info', message: `Page ${page}: ${filtered.length} songs (${allClips.length} total)` });
        }
      };

      if (source === 'workspace' && sourceId) await api.fetchWorkspaceSongs(sourceId, fetchOptions);
      else if (source === 'playlist' && sourceId) await api.fetchPlaylistSongs(sourceId, fetchOptions);
      else await api.fetchLibrary(fetchOptions);
    } catch (err) {
      if (err.message === 'TOKEN_EXPIRED') {
        emit('download-log', { type: 'error', message: 'Token expired. Get a fresh token.' });
        return { completed: 0, failed: 0, skipped: 0, error: 'TOKEN_EXPIRED' };
      }
      if (err.message === 'RATE_LIMITED') {
        emit('download-log', { type: 'error', message: 'Rate limited during scan. Try again in a minute.' });
        return { completed: 0, failed: 0, skipped: 0, error: 'RATE_LIMITED' };
      }
      emit('download-log', { type: 'error', message: `Fetch error: ${err.message}` });
      return { completed: 0, failed: 0, skipped: 0, error: err.message };
    }
  }

  if (allClips.length === 0) {
    emit('download-log', { type: 'info', message: 'No songs found.' });
    return { completed: 0, failed: 0, skipped: 0 };
  }

  const total = allClips.length;
  emit('download-log', { type: 'info', message: `Downloading ${total} songs...` });
  emit('download-total', total);

  let completed = 0;
  let failed = 0;

  // Process songs with concurrency
  let index = 0;

  async function worker() {
    while (index < allClips.length && !aborted) {
      const i = index++;
      const clip = allClips[i];
      const title = clip.title || clip.id;

      try {
        const success = await downloadSingleSong(clip, api, {
          outputDir, formats, organizeBy, groupName, embedMeta, saveLyrics, saveCover
        }, emit);

        if (success) {
          completed++;
          emit('download-progress', { filename: title, status: 'done', completed: completed + failed, total, id: clip.id });
        } else {
          failed++;
          emit('download-progress', { filename: title, status: 'failed', completed: completed + failed, total, id: clip.id });
        }
      } catch (e) {
        failed++;
        emit('download-progress', { filename: title, status: 'failed', completed: completed + failed, total, id: clip.id });
      }

      // Rate limit between songs
      await new Promise(r => setTimeout(r, 500));
    }
  }

  const workers = Array.from({ length: Math.min(concurrent, allClips.length) }, () => worker());
  await Promise.all(workers);

  const result = { completed, failed, skipped: 0, aborted };
  emit('download-log', { type: 'success', message: `Done! ${completed} songs downloaded, ${failed} failed.` });
  emit('download-complete', result);
  return result;
}

function stopDownload() { aborted = true; }

// --- Preload ---

async function preloadList(options, emit) {
  aborted = false;
  const { token, filters = {}, startPage = 1, maxPages = 0, smartResume = false, source = 'library', sourceId = null } = options;
  const api = new SunoAPI(token);
  const allClips = [];

  emit('download-log', { type: 'info', message: 'Scanning library...' });

  try {
    const fetchOptions = {
      startPage, maxPages, smartResume, existingCount: 0,
      shouldStop: () => aborted,
      onPage: async (clips, page) => {
        const filtered = clips.filter(c => applyFilters(c, { ...filters }));
        allClips.push(...filtered);
        emit('preload-progress', { page, total: allClips.length });
      }
    };

    if (source === 'workspace' && sourceId) await api.fetchWorkspaceSongs(sourceId, fetchOptions);
    else if (source === 'playlist' && sourceId) await api.fetchPlaylistSongs(sourceId, fetchOptions);
    else await api.fetchLibrary(fetchOptions);
  } catch (err) {
    emit('download-log', { type: 'error', message: `Scan error: ${err.message}` });
    return { songs: allClips, error: err.message };
  }

  emit('download-log', { type: 'success', message: `Found ${allClips.length} songs.` });
  emit('preload-complete', allClips);
  return { songs: allClips, error: null };
}

async function fetchWorkspaces(token) { return new SunoAPI(token).fetchWorkspaces(); }
async function fetchPlaylists(token) { return new SunoAPI(token).fetchPlaylists(); }

module.exports = { startDownload, stopDownload, preloadList, fetchWorkspaces, fetchPlaylists };
