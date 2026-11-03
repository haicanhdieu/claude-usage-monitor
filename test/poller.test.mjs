import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPoller, parseUsage } from '../src/quota/poller.mjs';

const TOKEN = 'sk-ant-oat01-FAKE-SECRET';
const NOW = Date.parse('2026-11-03T00:00:00Z');
const valid = {
  five_hour: { utilization: 42, resets_at: '2026-11-03T05:00:00.123456+00:00' },
  seven_day: { utilization: 18.5, resets_at: '2026-11-06T22:00:00+00:00' },
  extra: null,
};

test('parseUsage: valid → both windows, resets in epoch seconds', () => {
  const r = parseUsage(valid, NOW);
  assert.equal(r.fiveHour.usedPercentage, 42);
  assert.equal(r.fiveHour.resetsAt, Math.floor(Date.parse('2026-11-03T05:00:00.123Z') / 1000));
  assert.equal(r.fiveHour.observedAt, NOW);
  assert.equal(r.sevenDay.usedPercentage, 18.5);
});
test('parseUsage: one window only', () => {
  const r = parseUsage({ five_hour: valid.five_hour, seven_day: null }, NOW);
  assert.equal(r.sevenDay, null);
  assert.equal(r.fiveHour.usedPercentage, 42);
});
test('parseUsage: missing resets_at → null resetsAt', () => {
  assert.equal(parseUsage({ five_hour: { utilization: 5 } }, NOW).fiveHour.resetsAt, null);
});
for (const [name, body] of [
  ['string utilization', { five_hour: { utilization: 'x', resets_at: valid.five_hour.resets_at } }],
  ['utilization 150', { five_hour: { utilization: 150 } }],
  ['negative utilization', { five_hour: { utilization: -1 } }],
  ['one bad window poisons body', { five_hour: valid.five_hour, seven_day: { utilization: 'x' } }],
  ['array', []], ['null', null], ['no windows', {}],
]) test(`parseUsage: ${name} → null`, () => assert.equal(parseUsage(body, NOW), null));

function harness({ tokens, responses, startNow = NOW } = {}) {
  const h = { now: startNow, timers: [], delays: [], fetchCalls: 0, tokenCalls: 0 };
  const tokenQueue = [...(tokens ?? [])];
  const respQueue = [...(responses ?? [])];
  const getToken = async () => { h.tokenCalls++; return tokenQueue.length > 1 ? tokenQueue.shift() : tokenQueue[0] ?? { ok: true, token: TOKEN, expiresAt: null }; };
  const fetch = async (url, init) => {
    h.fetchCalls++; h.lastInit = init; h.lastUrl = url;
    const r = respQueue.length > 1 ? respQueue.shift() : respQueue[0];
    if (r instanceof Error) throw r;
    return { status: r.status, json: async () => r.body };
  };
  h.poller = createPoller({
    getToken, fetch, now: () => h.now,
    setTimer: (fn, d) => { h.delays.push(d); h.timers.push(fn); return h.timers.length; },
    clearTimer: () => { h.cleared = true; },
  });
  return h;
}
const okRes = { status: 200, body: valid };

test('refresh ok → status ok, quota populated, correct request', async () => {
  const h = harness({ responses: [okRes] });
  await h.poller.refresh();
  const q = h.poller.getQuota();
  assert.equal(q.status, 'ok');
  assert.equal(q.fiveHour.usedPercentage, 42);
  assert.equal(q.lastOkAt, NOW);
  assert.equal(h.lastUrl, 'https://api.anthropic.com/api/oauth/usage');
  assert.equal(h.lastInit.headers.Authorization, 'Bearer ' + TOKEN);
  assert.equal(h.lastInit.headers['anthropic-beta'], 'oauth-2025-04-20');
});
for (const reason of ['no-credentials', 'denied', 'error']) {
  test(`token !ok (${reason}) → status, no fetch`, async () => {
    const h = harness({ tokens: [{ ok: false, reason }], responses: [okRes] });
    await h.poller.refresh();
    assert.equal(h.poller.getQuota().status, reason);
    assert.equal(h.fetchCalls, 0);
  });
}
test('expired token → no fetch, status error, keeps last good', async () => {
  const h = harness({ tokens: [{ ok: true, token: TOKEN, expiresAt: null }, { ok: true, token: TOKEN, expiresAt: NOW - 1 }], responses: [okRes] });
  await h.poller.refresh();
  h.now += 20_000;
  await h.poller.refresh();
  assert.equal(h.fetchCalls, 1);
  const q = h.poller.getQuota();
  assert.equal(q.status, 'error');
  assert.equal(q.fiveHour.usedPercentage, 42);
});
test('200 unparseable → api-changed, keeps last good', async () => {
  const h = harness({ responses: [okRes, { status: 200, body: { five_hour: { utilization: 'x' } } }] });
  await h.poller.refresh();
  h.now += 20_000;
  await h.poller.refresh();
  const q = h.poller.getQuota();
  assert.equal(q.status, 'api-changed');
  assert.equal(q.fiveHour.usedPercentage, 42);
});
test('401 → error, keeps last good, no backoff', async () => {
  const h = harness({ responses: [okRes, { status: 401, body: {} }] });
  h.poller.start(); await new Promise(r => setImmediate(r));
  h.now += 20_000;
  await h.poller.refresh();
  assert.equal(h.poller.getQuota().status, 'error');
  assert.equal(h.poller.getQuota().fiveHour.usedPercentage, 42);
  h.timers.shift()(); await new Promise(r => setImmediate(r));
  assert.deepEqual(h.delays.slice(0, 2), [60000, 60000]);
});
test('backoff doubles to cap then resets on success', async () => {
  const bad = { status: 500, body: {} };
  const h = harness({ responses: [bad, bad, bad, bad, bad, okRes] });
  h.poller.start();
  for (let i = 0; i < 6; i++) {
    await new Promise(r => setImmediate(r));
    h.now += 60_000;
    h.timers.shift()();
  }
  await new Promise(r => setImmediate(r));
  assert.deepEqual(h.delays, [60000, 120000, 240000, 300000, 300000, 60000, 60000]);
});
test('network throw and 429 → error with backoff', async () => {
  const h = harness({ responses: [new Error('net ' + TOKEN), { status: 429, body: {} }] });
  h.poller.start(); await new Promise(r => setImmediate(r));
  assert.equal(h.poller.getQuota().status, 'error');
  h.now += 60_000; h.timers.shift()(); await new Promise(r => setImmediate(r));
  assert.deepEqual(h.delays, [60000, 120000]);
});
test('refresh within minRefreshGap is a no-op', async () => {
  const h = harness({ responses: [okRes] });
  await h.poller.refresh();
  h.now += 5_000;
  await h.poller.refresh();
  assert.equal(h.fetchCalls, 1);
});
test('concurrent refresh calls share one request', async () => {
  const h = harness({ responses: [okRes] });
  await Promise.all([h.poller.refresh(), h.poller.refresh()]);
  assert.equal(h.fetchCalls, 1);
});
test('stop clears timer', async () => {
  const h = harness({ responses: [okRes] });
  h.poller.start(); await new Promise(r => setImmediate(r));
  h.poller.stop();
  assert.ok(h.cleared);
});
test('token never appears in snapshot or poller state', async () => {
  const h = harness({ responses: [new Error('net ' + TOKEN)] });
  await h.poller.refresh();
  assert.ok(!JSON.stringify(h.poller.getQuota()).includes(TOKEN));
  assert.ok(!JSON.stringify(Object.entries(h.poller)).includes(TOKEN));
});
