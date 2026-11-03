import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeQuota } from '../src/quota/merge.mjs';

const now = 1_800_000_000_000;
const future = Math.floor(now / 1000) + 3600;
const polled = (over = {}) => ({ fiveHour: { usedPercentage: 55, resetsAt: future, observedAt: now - 1000, ...over }, sevenDay: null, status: 'ok' });
const hook = (over = {}) => ({ fiveHour: { usedPercentage: 40, resetsAt: future, observedAt: now - 1000, ...over }, sevenDay: null });

test('fresh polled + fresh hook → account wins', () => {
  const m = mergeQuota({ polled: polled(), hook: hook(), now });
  assert.equal(m.fiveHour.source, 'account');
  assert.equal(m.fiveHour.usedPercentage, 55);
  assert.equal(m.fiveHour.stale, false);
});

test('stale polled + fresh hook → hook, not stale', () => {
  const m = mergeQuota({ polled: polled({ observedAt: now - 200_000 }), hook: hook(), now });
  assert.equal(m.fiveHour.source, 'hook');
  assert.equal(m.fiveHour.stale, false);
});

test('both null → null windows', () => {
  const m = mergeQuota({ polled: { fiveHour: null, sevenDay: null, status: 'pending' }, hook: { fiveHour: null, sevenDay: null }, now });
  assert.equal(m.fiveHour, null);
  assert.equal(m.sevenDay, null);
});

test('hook null/undefined object is tolerated', () => {
  const m = mergeQuota({ polled: polled(), hook: null, now });
  assert.equal(m.fiveHour.source, 'account');
});

test('polled past resetsAt and no hook → null', () => {
  const m = mergeQuota({ polled: polled({ resetsAt: Math.floor(now / 1000) - 1 }), hook: { fiveHour: null, sevenDay: null }, now });
  assert.equal(m.fiveHour, null);
});

test('both stale → newer observedAt wins, stale true', () => {
  const m = mergeQuota({
    polled: polled({ observedAt: now - 400_000 }),
    hook: hook({ observedAt: now - 350_000 }), now });
  assert.equal(m.fiveHour.source, 'hook');
  assert.equal(m.fiveHour.stale, true);
});

test('status passes through', () => {
  const m = mergeQuota({ polled: { fiveHour: null, sevenDay: null, status: 'denied' }, hook: null, now });
  assert.equal(m.status, 'denied');
});
