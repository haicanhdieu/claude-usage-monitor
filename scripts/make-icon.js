// Renders build/icon.svg -> build/icon.png (1024) and build/icon.icns. Run: npx electron scripts/make-icon.js
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.join(__dirname, '..', 'build');
app.dock?.hide();
app.whenReady().then(async () => {
  const svg = fs.readFileSync(path.join(root, 'icon.svg'), 'utf8');
  const win = new BrowserWindow({ width: 1024, height: 1024, show: false, transparent: true, frame: false, useContentSize: true, webPreferences: { offscreen: true } });
  await win.loadURL('data:text/html,' + encodeURIComponent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:1024px;height:1024px}</style>${svg}`));
  await new Promise((r) => setTimeout(r, 300));
  const img = await win.webContents.capturePage({ x: 0, y: 0, width: 1024, height: 1024 });
  const png = path.join(root, 'icon.png');
  fs.writeFileSync(png, img.toPNG());
  const set = path.join(root, 'icon.iconset');
  fs.rmSync(set, { recursive: true, force: true });
  fs.mkdirSync(set);
  for (const s of [16, 32, 128, 256, 512]) {
    for (const k of [1, 2]) {
      execFileSync('sips', ['-z', s * k, s * k, png, '--out', path.join(set, `icon_${s}x${s}${k === 2 ? '@2x' : ''}.png`)], { stdio: 'ignore' });
    }
  }
  execFileSync('iconutil', ['-c', 'icns', set, '-o', path.join(root, 'icon.icns')]);
  fs.rmSync(set, { recursive: true, force: true });
  app.quit();
});
