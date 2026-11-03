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
