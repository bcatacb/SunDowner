// --- State ---
let config = {};
let songs = [];
let isRunning = false;

// --- Elements ---
const tokenInput = document.getElementById('token-input');
const btnGetToken = document.getElementById('btn-get-token');
const tokenHelp = document.getElementById('token-help');
const btnCopyCode = document.getElementById('btn-copy-code');
const folderDisplay = document.getElementById('folder-display');
const btnFolder = document.getElementById('btn-folder');
const btnPreload = document.getElementById('btn-preload');
const btnDownload = document.getElementById('btn-download');
const btnStop = document.getElementById('btn-stop');
const progressFooter = document.getElementById('progress-footer');
const progressBar = document.getElementById('progress-bar');
const progressText = document.getElementById('progress-text');
const progressPercent = document.getElementById('progress-percent');
const queueList = document.getElementById('queue-list');
const queueCount = document.getElementById('queue-count');
const logOutput = document.getElementById('log-output');
const statusIndicator = document.getElementById('status-indicator');
const organizeSelect = document.getElementById('organize-select');
const concurrentInput = document.getElementById('concurrent-input');
const sourceDetail = document.getElementById('source-detail');
const sourceSelect = document.getElementById('source-select');

// --- Init ---
(async () => {
  config = await window.api.loadConfig() || {};
  if (config.token) tokenInput.value = config.token;
  if (config.outputDir) folderDisplay.value = config.outputDir;
  if (config.organizeBy) organizeSelect.value = config.organizeBy;
  if (config.concurrent) concurrentInput.value = config.concurrent;
})();

// --- Tab Navigation ---
document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
  });
});

// --- Token ---
btnGetToken.addEventListener('click', () => {
  tokenHelp.style.display = tokenHelp.style.display === 'none' ? 'block' : 'none';
});

btnCopyCode.addEventListener('click', () => {
  const code = "window.Clerk.session.getToken().then(t => prompt('Copy this token:', t))";
  navigator.clipboard.writeText(code).then(() => {
    btnCopyCode.textContent = 'Copied!';
    setTimeout(() => { btnCopyCode.textContent = 'Copy'; }, 2000);
  });
});

tokenInput.addEventListener('change', () => {
  config.token = tokenInput.value.trim();
  window.api.saveConfig(config);
});

// --- Folder ---
btnFolder.addEventListener('click', async () => {
  const folder = await window.api.selectFolder();
  if (folder) {
    folderDisplay.value = folder;
    config.outputDir = folder;
    window.api.saveConfig(config);
  }
});

// --- Source Selection ---
document.querySelectorAll('.source-btns .btn').forEach(btn => {
  btn.addEventListener('click', async () => {
    document.querySelectorAll('.source-btns .btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const source = btn.dataset.source;
    config.source = source;

    if (source === 'library') {
      sourceDetail.style.display = 'none';
    } else {
      sourceDetail.style.display = 'block';
      sourceSelect.innerHTML = '<option value="">Loading...</option>';
      const token = tokenInput.value.trim();
      if (!token) { sourceSelect.innerHTML = '<option value="">Enter token first</option>'; return; }

      try {
        let items;
        if (source === 'workspace') {
          items = await window.api.fetchWorkspaces(token);
          sourceSelect.innerHTML = items.map(w =>
            `<option value="${w.id}">${w.name} (${w.clip_count || 0})</option>`
          ).join('');
        } else {
          items = await window.api.fetchPlaylists(token);
          sourceSelect.innerHTML = items.map(p =>
            `<option value="${p.id}">${p.name} (${p.num_total_results || 0})</option>`
          ).join('');
        }
        if (items.length === 0) {
          sourceSelect.innerHTML = '<option value="">None found</option>';
        }
      } catch (err) {
        sourceSelect.innerHTML = `<option value="">Error: ${err.message}</option>`;
      }
    }
  });
});

// --- Get current options ---
function getOptions() {
  const formats = [];
  if (document.getElementById('fmt-mp3').checked) formats.push('mp3');
  if (document.getElementById('fmt-mp4').checked) formats.push('mp4');
  if (document.getElementById('fmt-wav').checked) formats.push('wav');
  if (formats.length === 0) formats.push('mp3');

  const filters = {
    likedOnly: document.getElementById('flt-liked').checked,
    hideStems: document.getElementById('flt-hide-stems').checked,
    stemsOnly: document.getElementById('flt-stems-only').checked,
    publicOnly: document.getElementById('flt-public').checked,
    includeTrashed: document.getElementById('flt-trashed').checked,
    hideStudio: document.getElementById('flt-hide-studio').checked,
  };

  const sourceBtn = document.querySelector('.source-btns .btn.active');
  const source = sourceBtn ? sourceBtn.dataset.source : 'library';
  const sourceId = source !== 'library' ? sourceSelect.value : null;

  return {
    token: tokenInput.value.trim(),
    outputDir: folderDisplay.value || './downloads',
    formats,
    organizeBy: organizeSelect.value,
    groupName: sourceId ? sourceSelect.options[sourceSelect.selectedIndex]?.text : '',
    concurrent: parseInt(concurrentInput.value, 10) || 3,
    filters,
    smartResume: document.getElementById('opt-smart-resume').checked,
    embedMeta: document.getElementById('opt-metadata').checked,
    saveLyrics: document.getElementById('opt-lyrics').checked,
    saveCover: document.getElementById('opt-cover').checked,
    source,
    sourceId,
    startPage: 1,
    maxPages: 0
  };
}

// --- Download Everything (one button) ---
btnDownload.addEventListener('click', async () => {
  const opts = getOptions();
  if (!opts.token) { alert('Paste your token first.'); return; }
  if (!opts.outputDir) { alert('Choose an output folder.'); return; }

  startUI();
  // If we have preloaded songs, use them. Otherwise fetch fresh.
  if (songs.length > 0) {
    opts.songs = songs;
  }
  config.token = opts.token;
  config.outputDir = opts.outputDir;
  config.organizeBy = opts.organizeBy;
  config.concurrent = opts.concurrent;
  window.api.saveConfig(config);

  await window.api.startDownload(opts);
});

// --- Scan (preload) ---
btnPreload.addEventListener('click', async () => {
  const opts = getOptions();
  if (!opts.token) { alert('Paste your token first.'); return; }

  startUI();
  btnDownload.disabled = true;
  setStatus('Scanning...', 'busy');

  config.token = opts.token;
  window.api.saveConfig(config);

  await window.api.preloadList(opts);
});

// --- Stop ---
btnStop.addEventListener('click', () => {
  window.api.stopDownload();
  stopUI();
  setStatus('Stopped', 'error');
});

// --- UI Helpers ---
function startUI() {
  isRunning = true;
  btnPreload.disabled = true;
  btnDownload.disabled = true;
  btnStop.style.display = 'inline-flex';
  progressFooter.style.display = 'block';
  progressBar.style.width = '0%';
  setStatus('Working...', 'busy');
}

function stopUI() {
  isRunning = false;
  btnPreload.disabled = false;
  btnDownload.disabled = songs.length === 0;
  btnStop.style.display = 'none';
}

function setStatus(text, type = 'ready') {
  const dot = statusIndicator.querySelector('.status-dot');
  const label = statusIndicator.querySelector('.status-text');
  label.textContent = text;
  const colors = { ready: '#10b981', busy: '#7c3aed', error: '#ef4444' };
  dot.style.background = colors[type] || colors.ready;
}

function addLog(message, type = 'info') {
  const entry = document.createElement('div');
  entry.className = `log-entry ${type}`;
  entry.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
  logOutput.appendChild(entry);
  logOutput.scrollTop = logOutput.scrollHeight;
}

function renderQueue() {
  if (songs.length === 0) {
    queueList.innerHTML = '<div class="empty-state"><p>No songs loaded.</p><p class="hint">Click "Scan Library" to fetch your songs.</p></div>';
    queueCount.textContent = '0 songs';
    return;
  }

  queueCount.textContent = `${songs.length} songs`;
  queueList.innerHTML = songs.map(s => {
    const meta = s.metadata || {};
    let typeLabel = '';
    const title = (s.title || '').toLowerCase();
    if (STEM_INDICATORS.some(ind => title.includes(ind))) {
      typeLabel = '<span class="q-type stem">STEM</span>';
    } else if (meta.type === 'sound' || meta.type === 'sound_effect') {
      typeLabel = '<span class="q-type sound">SOUND</span>';
    }

    return `<div class="queue-item" id="q-${s.id}">
      <span class="q-status" id="qs-${s.id}">○</span>
      <span class="q-title">${esc(s.title || s.id)}</span>
      <span class="q-tags">${esc(meta.tags || '')}</span>
      ${typeLabel}
    </div>`;
  }).join('');
}

const STEM_INDICATORS = [
  '(bass)', '(drums)', '(backing vocal)', '(backing vocals)', '(vocals)',
  '(instrumental)', '(woodwinds)', '(brass)', '(fx)', '(synth)',
  '(strings)', '(percussion)', '(keyboard)', '(guitar)'
];

function esc(str) {
  return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// --- Clear log ---
document.getElementById('btn-clear-log').addEventListener('click', () => {
  logOutput.innerHTML = '';
});

// --- Events from main process ---
window.api.on('download-log', (data) => {
  addLog(data.message, data.type);
});

window.api.on('download-total', (total) => {
  progressText.textContent = `0 / ${total}`;
});

window.api.on('download-progress', (data) => {
  const pct = Math.round((data.completed / data.total) * 100);
  progressBar.style.width = pct + '%';
  progressText.textContent = `${data.completed} / ${data.total}`;
  progressPercent.textContent = pct + '%';

  // Update queue item status
  const statusEl = document.getElementById(`qs-${data.id}`);
  if (statusEl) {
    if (data.status === 'done') statusEl.textContent = '✓';
    else if (data.status === 'failed') statusEl.textContent = '✕';
    else if (data.status === 'skipped') statusEl.textContent = '⊘';
  }
});

window.api.on('download-complete', (result) => {
  stopUI();
  if (result.aborted) {
    setStatus('Stopped', 'error');
    addLog(`Stopped. ${result.completed} downloaded, ${result.failed} failed.`, 'warning');
  } else if (result.failed === 0) {
    setStatus('Complete', 'ready');
    addLog(`Done! ${result.completed} downloaded, ${result.skipped} skipped.`, 'success');
  } else {
    setStatus('Done (with errors)', 'error');
    addLog(`Done. ${result.completed} downloaded, ${result.failed} failed, ${result.skipped} skipped.`, 'warning');
  }
});

window.api.on('preload-progress', (data) => {
  progressText.textContent = `Page ${data.page} — ${data.total} songs found`;
});

window.api.on('preload-complete', (clips) => {
  songs = clips;
  stopUI();
  btnDownload.disabled = false;
  setStatus(`${songs.length} songs ready`, 'ready');
  addLog(`Scan complete: ${songs.length} songs found.`, 'success');
  renderQueue();

  // Switch to queue tab
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.querySelector('[data-tab="queue"]').classList.add('active');
  document.getElementById('tab-queue').classList.add('active');
});

// --- Enable download button immediately if token exists ---
// The "Download All" button works without preloading — it fetches and downloads in one pass.
btnDownload.disabled = false;
