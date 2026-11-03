// Pure gauge geometry shared by the tiny view and tests.
// Sweep is a 180° dial: 0% used = left (-90°), 100% used = right (+90°).
export const gaugeState = (q) => {
  const pct = Number(q?.usedPercentage);
  if (q == null || q.usedPercentage == null || !Number.isFinite(pct)) return { valid: false, angle: -90, left: null, color: '#5b6b67' };
  const used = Math.max(0, Math.min(100, pct));
  const left = 100 - used;
  const color = left > 40 ? '#59c8a2' : left > 15 ? '#e0b04a' : '#e0675a';
  return { valid: true, angle: -90 + used * 1.8, left: Math.round(left), color, stale: !!q.stale };
};
