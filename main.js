const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow;

const CONFIG_PATH = path.join(__dirname, 'config.json');

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 850,
    minWidth: 900,
    minHeight: 700,
    backgroundColor: '#0f0f1a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    },
    titleBarStyle: 'default',
    title: 'Suno Downloader'
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// --- IPC Handlers ---

ipcMain.handle('select-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory', 'createDirectory']
  });
  if (result.canceled) return null;
  return result.filePaths[0];
});

ipcMain.handle('load-config', () => {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const data = fs.readFileSync(CONFIG_PATH, 'utf-8');
      return JSON.parse(data);
    }
  } catch (e) {
    console.error('Failed to load config:', e.message);
  }
  return null;
});

ipcMain.handle('save-config', (event, config) => {
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
    return true;
  } catch (e) {
    console.error('Failed to save config:', e.message);
    return false;
  }
});

// Forward download operations to the downloader module
const { startDownload, stopDownload, preloadList, fetchWorkspaces, fetchPlaylists } = require('./lib/downloader');

ipcMain.handle('start-download', (event, options) => {
  return startDownload(options, (channel, ...args) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(channel, ...args);
    }
  });
});

ipcMain.handle('stop-download', () => {
  stopDownload();
  return true;
});

ipcMain.handle('preload-list', (event, options) => {
  return preloadList(options, (channel, ...args) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(channel, ...args);
    }
  });
});

ipcMain.handle('fetch-workspaces', (event, token) => {
  return fetchWorkspaces(token);
});

ipcMain.handle('fetch-playlists', (event, token) => {
  return fetchPlaylists(token);
});
