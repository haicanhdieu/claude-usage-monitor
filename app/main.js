const path = require('node:path');
const { app, BrowserWindow, ipcMain, screen } = require('electron');
const { createTray } = require('./tray');

let win = null;
let mode = 'full';
let tinyPos = null;
let base = '';
let poller = null;
let ws = null; // windowState module
let stateFile = '';
const TINY = { width: 140, height: 62 };
const TINY_OPACITY = 0.55;
let quitting = false;
let clickThrough = false; // tiny view: off by default so it can be dragged; session-only


if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => { if (win) { win.show(); win.focus(); } });
  app.whenReady().then(start).catch((err) => { console.error('startup failed:', err?.message); app.quit(); });
}

async function start() {
  const { startServer } = await import('../src/server.mjs');
  const { createPoller } = await import('../src/quota/poller.mjs');
  const { getAccessToken } = await import('../src/quota/keychain.mjs');
  const { formatTrayTitle } = await import('../src/quota/title.mjs');

  poller = createPoller({ getToken: () => getAccessToken() });
  poller.start();
  const server = await startServer({ port: 4319, fallbackToFreePort: true, quotaSource: poller });
  base = `http://127.0.0.1:${server.port}`;
  ws = await import('../src/windowState.mjs');
  stateFile = path.join(app.getPath('userData'), 'window-state.json');
  ({ mode, tinyPos } = ws.loadState(stateFile));

  createWindow();

  const tray = createTray({
    onOpen: () => { win.show(); win.focus(); },
    onToggleMode: () => setMode(mode === 'tiny' ? 'full' : 'tiny'),
    getClickThrough: () => clickThrough,
    setClickThrough: (v) => { clickThrough = v; if (mode === 'tiny' && win && !win.isDestroyed()) win.setIgnoreMouseEvents(clickThrough); },
    getLoginItem: () => app.getLoginItemSettings().openAtLogin,
    setLoginItem: (openAtLogin) => app.setLoginItemSettings({ openAtLogin }),
    onQuit: () => app.quit(),
  });

  async function updateTitle() {
    try {
      const res = await fetch(`${base}/api/status`);
      const body = await res.json();
      tray.setTitle(formatTrayTitle(body.quota));
    } catch { /* keep previous title */ }
  }
  updateTitle();
  const titleTimer = setInterval(updateTitle, 15_000);

  ipcMain.on('shell:set-mode', (_e, m) => setMode(m === 'tiny' ? 'tiny' : 'full'));
  app.on('activate', () => { win.show(); });
  app.on('before-quit', () => {
    quitting = true;
    clearInterval(titleTimer);
    poller.stop();
    server.close();
  });
}

// Keep running in tray when all windows are hidden/closed.
app.on('window-all-closed', () => {});

function persist() { ws.saveState(stateFile, { mode, tinyPos }); }

function createWindow() {
  const webPreferences = { nodeIntegration: false, contextIsolation: true, preload: path.join(__dirname, 'preload.js') };
  if (mode === 'tiny') {
    const displays = screen.getAllDisplays().map((d) => d.workArea);
    const pos = ws.clampPos(tinyPos, TINY, displays) || (() => {
      const wa = screen.getPrimaryDisplay().workArea;
      return { x: wa.x + wa.width - TINY.width - 20, y: wa.y + 20 };
    })();
    win = new BrowserWindow({
      ...TINY, ...pos, title: 'Claude Usage', frame: false, transparent: true, hasShadow: false,
      resizable: false, maximizable: false, fullscreenable: false, skipTaskbar: true, alwaysOnTop: true, webPreferences,
    });
    win.setAlwaysOnTop(true, 'floating');
    win.setOpacity(TINY_OPACITY);
    win.setIgnoreMouseEvents(clickThrough); // tray menu toggles this
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    win.loadURL(`${base}/tiny.html`);
    win.on('moved', () => { const [x, y] = win.getPosition(); tinyPos = { x, y }; persist(); });
  } else {
    win = new BrowserWindow({ width: 1100, height: 800, title: 'Claude Usage Monitor', webPreferences });
    win.loadURL(base);
  }
  const w = win;
  w.on('close', (e) => { if (!quitting && w === win) { e.preventDefault(); w.hide(); } });
  w.on('focus', () => { poller.refresh(); });
}

function setMode(next) {
  if (next === mode && win && !win.isDestroyed()) { win.show(); return; }
  mode = next;
  persist();
  const old = win;
  createWindow();
  if (old && !old.isDestroyed()) old.destroy();
}
