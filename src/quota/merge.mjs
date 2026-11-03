const POLLED_STALE_MS = 180_000;
const HOOK_STALE_MS = 300_000;

function candidate(entry, source, staleMs, now) {
  if (!entry || !Number.isFinite(entry.usedPercentage)) return null;
  if (entry.resetsAt && entry.resetsAt * 1000 <= now) return null;
  const observedAt = entry.observedAt ?? 0;
  return { usedPercentage: entry.usedPercentage, resetsAt: entry.resetsAt ?? null, observedAt, source, stale: now - observedAt > staleMs };
}

function pick(polled, hook, now) {
  const a = candidate(polled, 'account', POLLED_STALE_MS, now);
  const h = candidate(hook, 'hook', HOOK_STALE_MS, now);
  if (!a || !h) return a || h;
  if (a.stale !== h.stale) return a.stale ? h : a;
  if (!a.stale) return a;
  return h.observedAt > a.observedAt ? h : a;
}

export function mergeQuota({ polled, hook, now }) {
  return {
    fiveHour: pick(polled?.fiveHour, hook?.fiveHour, now),
    sevenDay: pick(polled?.sevenDay, hook?.sevenDay, now),
    status: polled?.status ?? 'pending',
  };
}
