const { app, BrowserWindow } = require('electron');
const { createTray } = require('./tray');

let win = null;
let quitting = false;

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

  const poller = createPoller({ getToken: () => getAccessToken() });
  poller.start();
  const server = await startServer({ port: 4319, fallbackToFreePort: true, quotaSource: poller });
  const base = `http://127.0.0.1:${server.port}`;

  win = new BrowserWindow({
    width: 1100, height: 800, title: 'Claude Usage Monitor',
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  });
  win.loadURL(base);
  win.on('close', (e) => { if (!quitting) { e.preventDefault(); win.hide(); } });
  win.on('focus', () => { poller.refresh(); });

  const tray = createTray({
    onOpen: () => { win.show(); win.focus(); },
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
