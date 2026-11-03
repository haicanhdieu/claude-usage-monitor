const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';

function parseWindow(w, now) {
  if (w == null) return { entry: null, ok: true };
  if (typeof w !== 'object' || typeof w.utilization !== 'number' || !Number.isFinite(w.utilization)
      || w.utilization < 0 || w.utilization > 100) return { entry: null, ok: false };
  let resetsAt = null;
  if (typeof w.resets_at === 'string') {
    const ms = Date.parse(w.resets_at);
    if (Number.isFinite(ms)) resetsAt = Math.floor(ms / 1000);
  }
  return { entry: { usedPercentage: w.utilization, resetsAt, observedAt: now }, ok: true };
}

export function parseUsage(body, now) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const five = parseWindow(body.five_hour, now);
  const seven = parseWindow(body.seven_day, now);
  if (!five.ok || !seven.ok || (!five.entry && !seven.entry)) return null;
  return { fiveHour: five.entry, sevenDay: seven.entry };
}

export function createPoller({
  getToken, fetch = globalThis.fetch, now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout,
  intervalMs = 60_000, maxBackoffMs = 300_000, minRefreshGapMs = 10_000, rateLimitFloorMs = 120_000,
} = {}) {
  const state = { fiveHour: null, sevenDay: null, status: 'pending', lastAttemptAt: null, lastOkAt: null };
  let failures = 0;
  let cooldownUntil = 0;
  let cooldownMs = 0;
  let inFlight = null;
  let timer = null;
  let running = false;

  async function doRefresh() {
    state.lastAttemptAt = now();
    const tok = await getToken();
    if (!tok.ok) { state.status = tok.reason; return; }
    if (tok.expiresAt != null && tok.expiresAt <= now()) { state.status = 'error'; return; }
    let res;
    try {
      res = await fetch(USAGE_URL, { headers: { Authorization: 'Bearer ' + tok.token, 'anthropic-beta': 'oauth-2025-04-20' } });
    } catch { state.status = 'error'; failures++; return; }
    if (res.status === 401) { state.status = 'error'; return; }
    if (res.status === 429) {
      const ra = Number(res.headers?.get?.('retry-after'));
      cooldownMs = Math.max(rateLimitFloorMs, Number.isFinite(ra) ? ra * 1000 : 0, Math.min(cooldownMs * 2, maxBackoffMs * 3));
      cooldownUntil = now() + cooldownMs;
      state.status = 'rate-limited'; failures++; return;
    }
    if (res.status >= 500 || res.status !== 200) { state.status = 'error'; failures++; return; }
    let body;
    try { body = await res.json(); } catch { body = null; }
    const parsed = parseUsage(body, now());
    if (!parsed) { state.status = 'api-changed'; return; }
    Object.assign(state, parsed, { status: 'ok', lastOkAt: now() });
    failures = 0; cooldownMs = 0; cooldownUntil = 0;
  }

  function refresh() {
    if (inFlight) return inFlight;
    if (now() < cooldownUntil) return Promise.resolve();
    if (state.lastAttemptAt != null && now() - state.lastAttemptAt < minRefreshGapMs) return Promise.resolve();
    inFlight = doRefresh().catch(() => { state.status = 'error'; }).finally(() => { inFlight = null; });
    return inFlight;
  }

  async function cycle() {
    await refresh();
    if (!running) return;
    const delay = cooldownUntil > now() ? cooldownUntil - now() : failures === 0 ? intervalMs : Math.min(intervalMs * 2 ** (failures - 1), maxBackoffMs);
    timer = setTimer(cycle, delay);
  }

  return {
    getQuota: () => ({ ...state }),
    refresh,
    start() { if (running) return; running = true; cycle(); },
    stop() { running = false; if (timer != null) clearTimer(timer); timer = null; },
  };
}
