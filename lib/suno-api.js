/**
 * Suno API Client
 * Handles authentication, pagination, and fetching from various endpoints.
 */

const https = require('https');
const { URL } = require('url');

const API_BASE = 'https://studio-api.prod.suno.com';

class SunoAPI {
  constructor(token) {
    this.token = token;
    this.headers = {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'User-Agent': 'SunoDownloader/1.0'
    };
  }

  /**
   * Make an HTTPS request and return parsed JSON.
   */
  request(method, urlStr, body = null, timeout = 30000) {
    return new Promise((resolve, reject) => {
      const url = new URL(urlStr);
      const options = {
        hostname: url.hostname,
        port: url.port || 443,
        path: url.pathname + url.search,
        method: method,
        headers: { ...this.headers },
        timeout: timeout
      };

      if (body) {
        const bodyStr = JSON.stringify(body);
        options.headers['Content-Length'] = Buffer.byteLength(bodyStr);
      }

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          if (res.statusCode === 401) {
            reject(new Error('TOKEN_EXPIRED'));
            return;
          }
          if (res.statusCode === 404) {
            reject(new Error('NOT_FOUND'));
            return;
          }
          if (res.statusCode === 429) {
            reject(new Error('RATE_LIMITED'));
            return;
          }
          if (res.statusCode >= 400) {
            reject(new Error(`HTTP ${res.statusCode}: ${data.substring(0, 200)}`));
            return;
          }
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error(`Invalid JSON response: ${data.substring(0, 100)}`));
          }
        });
      });

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });

      if (body) {
        req.write(JSON.stringify(body));
      }
      req.end();
    });
  }

  /**
   * Make a request with automatic retry on rate limit (429).
   */
  async requestWithRetry(method, urlStr, body = null, maxRetries = 5) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await this.request(method, urlStr, body);
      } catch (err) {
        if (err.message === 'RATE_LIMITED' && attempt < maxRetries) {
          // Exponential backoff: 3s, 6s, 12s, 24s
          const wait = 3000 * Math.pow(2, attempt - 1);
          await new Promise(r => setTimeout(r, wait));
          continue;
        }
        throw err;
      }
    }
  }

  /**
   * Fetch library feed with pagination.
   * Returns array of clips from a single page.
   */
  async fetchLibraryPage(page) {
    const url = `${API_BASE}/api/feed/?page=${page}`;
    const data = await this.requestWithRetry('GET', url);

    // Response can be an array of clips or {clips: [...]}
    if (Array.isArray(data)) return data;
    if (data && Array.isArray(data.clips)) return data.clips;
    return [];
  }

  /**
   * Fetch all library clips with smart resume support.
   * Yields clips via callback as pages are fetched.
   */
  async fetchLibrary({ startPage = 1, maxPages = 0, smartResume = false, existingCount = 0, onPage, shouldStop }) {
    let page = startPage;
    let consecutiveEmpty = 0;

    // Adaptive threshold based on library size
    let threshold = 3;
    if (smartResume) {
      if (existingCount < 100) threshold = 2;
      else if (existingCount < 1000) threshold = 5;
      else if (existingCount < 5000) threshold = 10;
      else threshold = 20;
    }

    while (true) {
      if (shouldStop && shouldStop()) break;
      if (maxPages > 0 && page > maxPages + startPage - 1) break;

      try {
        const clips = await this.fetchLibraryPage(page);

        if (!clips || clips.length === 0) {
          consecutiveEmpty++;
          if (consecutiveEmpty >= (smartResume ? threshold : 3)) break;
        } else {
          consecutiveEmpty = 0;
          if (onPage) await onPage(clips, page);
        }
      } catch (err) {
        if (err.message === 'TOKEN_EXPIRED') throw err;
        if (err.message === 'RATE_LIMITED') throw err;
        // Network error - count as empty
        consecutiveEmpty++;
        if (consecutiveEmpty >= 3) throw err;
      }

      page++;
      // Delay between pages to avoid rate limiting
      await new Promise(r => setTimeout(r, 1500));
    }
  }

  /**
   * Fetch workspaces (projects) with pagination.
   */
  async fetchWorkspaces() {
    const all = [];
    let page = 1;

    while (true) {
      const url = `${API_BASE}/api/project/me?page=${page}&sort=created_at&show_trashed=false`;
      try {
        const data = await this.requestWithRetry('GET', url);
        const projects = data.projects || [];
        if (projects.length === 0) break;
        all.push(...projects);
        page++;
        await new Promise(r => setTimeout(r, 1000));
      } catch (err) {
        if (err.message === 'NOT_FOUND') break;
        throw err;
      }
    }

    return all;
  }

  /**
   * Fetch songs from a specific workspace.
   */
  async fetchWorkspaceSongs(workspaceId, { startPage = 1, maxPages = 0, onPage, shouldStop }) {
    let page = startPage;
    let consecutiveEmpty = 0;

    while (true) {
      if (shouldStop && shouldStop()) break;
      if (maxPages > 0 && page > maxPages + startPage - 1) break;

      const url = `${API_BASE}/api/project/${workspaceId}?page=${page}`;
      try {
        const data = await this.requestWithRetry('GET', url);
        const projectClips = data.project_clips || [];

        if (projectClips.length === 0) {
          consecutiveEmpty++;
          if (consecutiveEmpty >= 3) break;
        } else {
          consecutiveEmpty = 0;
          // Unwrap clips from {clip: {...}} wrapper
          const clips = projectClips.map(pc => pc.clip || pc).filter(Boolean);
          if (onPage) await onPage(clips, page);
        }
      } catch (err) {
        if (err.message === 'NOT_FOUND') break;
        if (err.message === 'TOKEN_EXPIRED') throw err;
        consecutiveEmpty++;
        if (consecutiveEmpty >= 3) throw err;
      }

      page++;
    }
  }

  /**
   * Fetch playlists with pagination.
   */
  async fetchPlaylists() {
    const all = [];
    let page = 1;

    while (true) {
      const url = `${API_BASE}/api/playlist/me?page=${page}&show_trashed=false&show_sharelist=false`;
      try {
        const data = await this.requestWithRetry('GET', url);
        const playlists = data.playlists || [];
        if (playlists.length === 0) break;
        all.push(...playlists);
        page++;
      } catch (err) {
        if (err.message === 'NOT_FOUND') break;
        throw err;
      }
    }

    return all;
  }

  /**
   * Fetch songs from a specific playlist.
   */
  async fetchPlaylistSongs(playlistId, { onPage, shouldStop }) {
    if (shouldStop && shouldStop()) return;

    const url = `${API_BASE}/api/playlist/${playlistId}/`;
    const data = await this.requestWithRetry('GET', url);
    const playlistClips = data.playlist_clips || [];

    // Unwrap clips
    const clips = playlistClips.map(pc => pc.clip || pc).filter(Boolean);
    if (clips.length > 0 && onPage) {
      await onPage(clips, 1);
    }
  }

  /**
   * Request WAV conversion for a clip.
   */
  async requestWavConversion(clipId) {
    const url = `${API_BASE}/api/gen/${clipId}/convert_wav/`;
    return this.request('POST', url);
  }

  /**
   * Poll for WAV file URL after conversion request.
   */
  async pollWavUrl(clipId, timeout = 120000, interval = 2000, shouldStop) {
    const deadline = Date.now() + timeout;
    const url = `${API_BASE}/api/gen/${clipId}/wav_file/`;

    while (Date.now() < deadline) {
      if (shouldStop && shouldStop()) return null;

      try {
        const data = await this.requestWithRetry('GET', url);
        // Look for a WAV URL in the response
        const wavUrl = this._findWavUrl(data);
        if (wavUrl) return wavUrl;
      } catch (err) {
        if (err.message !== 'NOT_FOUND') {
          // Non-404 errors are unexpected but we keep polling
        }
      }

      await new Promise(r => setTimeout(r, interval));
    }

    return null;
  }

  /**
   * Recursively search for a WAV URL in response data.
   */
  _findWavUrl(data) {
    if (typeof data === 'string') {
      if (data.startsWith('http') && data.toLowerCase().includes('.wav')) return data;
      return null;
    }

    if (Array.isArray(data)) {
      for (const item of data) {
        const found = this._findWavUrl(item);
        if (found) return found;
      }
      return null;
    }

    if (data && typeof data === 'object') {
      // Check prioritized keys first
      const prioritized = ['audio_url_wav', 'wav_url', 'wav_audio_url', 'master_wav_url', 'preview_wav_url', 'url'];
      for (const key of prioritized) {
        if (data[key] && typeof data[key] === 'string' &&
            data[key].startsWith('http') && data[key].toLowerCase().includes('.wav')) {
          return data[key];
        }
      }
      // Recurse into all values
      for (const val of Object.values(data)) {
        const found = this._findWavUrl(val);
        if (found) return found;
      }
    }

    return null;
  }
}

module.exports = { SunoAPI, API_BASE };
