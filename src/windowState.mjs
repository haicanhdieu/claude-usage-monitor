import fs from 'node:fs';

export const DEFAULTS = { mode: 'full', tinyPos: null };

export function loadState(file) {
  try {
    const s = JSON.parse(fs.readFileSync(file, 'utf8'));
    const pos = s?.tinyPos;
    return {
      mode: s?.mode === 'tiny' ? 'tiny' : 'full',
      tinyPos: pos && Number.isFinite(pos.x) && Number.isFinite(pos.y) ? { x: pos.x, y: pos.y } : null,
    };
  } catch { return { ...DEFAULTS }; }
}

export function saveState(file, state) {
  try { fs.writeFileSync(file, JSON.stringify(state)); } catch { /* best effort */ }
}

// Keep a saved position on screen: displays are [{x,y,width,height}] work areas.
export function clampPos(pos, size, displays) {
  if (!pos || !displays?.length) return null;
  const inside = (d) => pos.x + size.width > d.x && pos.x < d.x + d.width && pos.y + size.height > d.y && pos.y < d.y + d.height;
  const d = displays.find(inside);
  if (!d) return null;
  return {
    x: Math.max(d.x, Math.min(pos.x, d.x + d.width - size.width)),
    y: Math.max(d.y, Math.min(pos.y, d.y + d.height - size.height)),
  };
}
