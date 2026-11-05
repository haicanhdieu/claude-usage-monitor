// Pure gauge geometry shared by the tiny view and tests.
// Sweep is a 180° dial: 100% left = right (+90°), 0% left = left (-90°); the needle counts down right-to-left.
export const gaugeState = (q) => {
  const pct = Number(q?.usedPercentage);
  if (q == null || q.usedPercentage == null || !Number.isFinite(pct)) return { valid: false, angle: -90, left: null, color: '#5b6b67' };
  const used = Math.max(0, Math.min(100, pct));
  const left = 100 - used;
  const color = left > 40 ? '#59c8a2' : left > 15 ? '#e0b04a' : '#e0675a';
  return { valid: true, angle: -90 + left * 1.8, left: Math.round(left), color, stale: !!q.stale };
};

// Readout color: same red-orange-green ramp as the arc gradient (anchors at 10/35/75% left), lightened for legibility.
const RAMP = [[10, [224, 103, 90]], [35, [224, 176, 74]], [75, [89, 200, 162]]];
export const valueColor = (left) => {
  const p = Math.max(RAMP[0][0], Math.min(RAMP[2][0], left));
  const i = p <= RAMP[1][0] ? 0 : 1;
  const [p0, c0] = RAMP[i], [p1, c1] = RAMP[i + 1];
  const t = (p - p0) / (p1 - p0);
  const rgb = c0.map((v, k) => Math.round((v + (c1[k] - v) * t) * 0.65 + 255 * 0.35));
  return `rgb(${rgb.join(',')})`;
};
