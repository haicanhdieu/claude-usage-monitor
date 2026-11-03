import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer } from '../src/server.mjs';

function tmpSessions(quota) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cum-'));
  fs.writeFileSync(path.join(dir, 's1.json'), JSON.stringify({ updatedAt: Date.now(), quota }));
  return dir;
}
const fake = { getQuota: () => ({ fiveHour: null, sevenDay: null, status: 'pending' }), refresh: async () => {} };

test('/api/status returns expected shape and hook quota', async () => {
  const sessionsDir = tmpSessions({ fiveHour: { usedPercentage: 40 } });
  const s = await startServer({ port: 0, sessionsDir, quotaSource: fake });
  try {
    const res = await fetch(`http://127.0.0.1:${s.port}/api/status`);
    assert.equal(res.status, 200);
    const body = await res.json();
    for (const k of ['quota', 'sessions', 'live', 'daily', 'now']) assert.ok(k in body, k);
    assert.equal(body.quota.fiveHour.usedPercentage, 40);
  } finally { await s.close(); }
});

test('close() stops accepting connections', async () => {
  const s = await startServer({ port: 0, sessionsDir: tmpSessions({}), quotaSource: fake });
  await s.close();
  await assert.rejects(fetch(`http://127.0.0.1:${s.port}/api/status`));
});

test('account quota wins over hook and is tagged', async () => {
  const now = Date.now();
  const source = { refresh: async () => {}, getQuota: () => ({
    fiveHour: { usedPercentage: 55, resetsAt: Math.floor(now / 1000) + 3600, observedAt: now },
    sevenDay: null, status: 'ok' }) };
  const sessionsDir = tmpSessions({ fiveHour: { usedPercentage: 40 } });
  const s = await startServer({ port: 0, sessionsDir, quotaSource: source });
  try {
    const body = await (await fetch(`http://127.0.0.1:${s.port}/api/status`)).json();
    assert.equal(body.quota.fiveHour.source, 'account');
    assert.equal(body.quota.fiveHour.usedPercentage, 55);
    assert.equal(body.quotaStatus, 'ok');
  } finally { await s.close(); }
});

test('no-credentials falls back to hook and reports quotaStatus', async () => {
  const source = { refresh: async () => {}, getQuota: () => ({ fiveHour: null, sevenDay: null, status: 'no-credentials' }) };
  const sessionsDir = tmpSessions({ fiveHour: { usedPercentage: 40 } });
  const s = await startServer({ port: 0, sessionsDir, quotaSource: source });
  try {
    const body = await (await fetch(`http://127.0.0.1:${s.port}/api/status`)).json();
    assert.equal(body.quota.fiveHour.source, 'hook');
    assert.equal(body.quotaStatus, 'no-credentials');
  } finally { await s.close(); }
});

test('port in use: rejects by default, falls back to a free port when asked', async () => {
  const first = await startServer({ port: 0, sessionsDir: tmpSessions({}), quotaSource: fake });
  try {
    await assert.rejects(startServer({ port: first.port, sessionsDir: tmpSessions({}), quotaSource: fake }), { code: 'EADDRINUSE' });
    const second = await startServer({ port: first.port, fallbackToFreePort: true, sessionsDir: tmpSessions({}), quotaSource: fake });
    try {
      assert.notEqual(second.port, first.port);
      assert.equal((await fetch(`http://127.0.0.1:${second.port}/api/status`)).status, 200);
    } finally { await second.close(); }
  } finally { await first.close(); }
});
