const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const API_BASE = 'http://127.0.0.1:8080/api';
const SERVICE_JSON = path.join(os.homedir(), '.config', 'opencode', 'service.json');

let win = null;
let password = '';
let config = null;
let saveTimer = null;

function readPassword() {
  try {
    return JSON.parse(fs.readFileSync(SERVICE_JSON, 'utf8')).password || '';
  } catch {
    return '';
  }
}

function configPath() {
  return path.join(app.getPath('userData'), 'config.json');
}

function cacheDir() {
  return path.join(app.getPath('userData'), 'cache');
}

async function loadConfig() {
  if (config) return config;
  let stored = {};
  try {
    stored = JSON.parse(await fsp.readFile(configPath(), 'utf8'));
  } catch {}
  config = Object.assign(
    {
      sessionId: null,
      model: { providerID: 'opencode-go', id: 'qwen3.8-flash' },
      window: { x: null, y: null, collapsed: false },
      alwaysOnTop: true,
    },
    stored
  );
  if (!config.window || typeof config.window !== 'object') config.window = {};
  return config;
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fsp
      .mkdir(path.dirname(configPath()), { recursive: true })
      .then(() => fsp.writeFile(configPath(), JSON.stringify(config, null, 2)))
      .catch(() => {});
  }, 300);
}

// ---------- IPC: OpenCode API 代理（Basic Auth 留在主进程） ----------
ipcMain.handle('api', async (_e, { method, path: apiPath, body }) => {
  try {
    const headers = {
      Authorization: 'Basic ' + Buffer.from('opencode:' + password).toString('base64'),
    };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await fetch(API_BASE + apiPath, {
      method: method || 'GET',
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {}
    return { ok: res.ok, status: res.status, json };
  } catch (err) {
    return { ok: false, status: 0, error: String((err && err.message) || err) };
  }
});

// ---------- IPC: 配置 ----------
ipcMain.handle('config:get', () => config);

ipcMain.handle('config:patch', (_e, patch) => {
  if (!patch || typeof patch !== 'object') return config;
  const { window: wPatch, ...rest } = patch;
  Object.assign(config, rest);
  if (wPatch && typeof wPatch === 'object') {
    config.window = Object.assign({}, config.window, wPatch);
  }
  scheduleSave();
  return config;
});

// ---------- IPC: 图片 ----------
ipcMain.handle('pick-image', async () => {
  const r = await dialog.showOpenDialog(win, {
    properties: ['openFile'],
    filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }],
  });
  return r.canceled || !r.filePaths.length ? null : r.filePaths[0];
});

async function stageToCache(srcPath) {
  const dir = cacheDir();
  await fsp.mkdir(dir, { recursive: true });
  const ext = path.extname(srcPath) || '.png';
  const dest = path.join(dir, crypto.randomUUID() + ext);
  await fsp.copyFile(srcPath, dest);
  return { path: dest, uri: 'file://' + dest, name: path.basename(srcPath) };
}

ipcMain.handle('stage-image', async (_e, srcPath) => {
  try {
    return await stageToCache(srcPath);
  } catch {
    return null;
  }
});

ipcMain.handle('save-image', async (_e, bytes, mime) => {
  try {
    const dir = cacheDir();
    await fsp.mkdir(dir, { recursive: true });
    const ext = (mime || '').includes('jpeg')
      ? '.jpg'
      : (mime || '').includes('webp')
        ? '.webp'
        : (mime || '').includes('gif')
          ? '.gif'
          : '.png';
    const dest = path.join(dir, crypto.randomUUID() + ext);
    await fsp.writeFile(dest, Buffer.from(bytes));
    return { path: dest, uri: 'file://' + dest, name: path.basename(dest) };
  } catch {
    return null;
  }
});

ipcMain.handle('remove-file', async (_e, p) => {
  const dir = cacheDir();
  if (p && p.startsWith(dir)) await fsp.rm(p, { force: true }).catch(() => {});
});

// ---------- IPC: 窗口 ----------
ipcMain.handle('win:resize', (_e, { h, w }) => {
  if (!win || win.isDestroyed()) return;
  const width = Math.min(560, Math.max(340, w || win.getContentBounds().width));
  const height = Math.min(480, Math.max(120, Math.round(h)));
  win.setContentSize(width, height);
});

ipcMain.handle('win:set-always-on-top', (_e, v) => {
  if (win && !win.isDestroyed()) win.setAlwaysOnTop(!!v);
});

ipcMain.handle('app:quit', () => app.quit());

// ---------- 窗口 ----------
function createWindow() {
  win = new BrowserWindow({
    width: 424,
    height: 170,
    minWidth: 340,
    minHeight: 120,
    maxWidth: 560,
    maxHeight: 480,
    frame: false,
    transparent: true,
    hasShadow: true,
    alwaysOnTop: config.alwaysOnTop !== false,
    skipTaskbar: true,
    resizable: true,
    fullscreenable: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // 悬浮宠：所有空间可见、不进任务栏
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false });

  if (Number.isFinite(config.window.x) && Number.isFinite(config.window.y)) {
    win.setPosition(Math.round(config.window.x), Math.round(config.window.y));
  } else {
    win.center();
  }

  win.once('ready-to-show', () => win.show());

  let moveTimer = null;
  win.on('moved', () => {
    clearTimeout(moveTimer);
    moveTimer = setTimeout(() => {
      if (win && !win.isDestroyed()) {
        const [x, y] = win.getPosition();
        config.window.x = x;
        config.window.y = y;
        scheduleSave();
      }
    }, 400);
  });

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

// 单例：重复启动时聚焦已有窗口而不是再开一个
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win && !win.isDestroyed()) {
      if (win.isMinimized()) win.restore();
      win.show();
    }
  });
}

app.whenReady().then(async () => {
  if (app.dock) app.dock.hide();
  password = readPassword();
  config = await loadConfig();
  createWindow();
});

app.on('window-all-closed', () => app.quit());
