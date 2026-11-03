#!/usr/bin/env node
/** Read-only localhost dashboard. No third-party dependencies, no authentication tokens. */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { getLive } from './live.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dir = path.join(process.env.CLAUDE_USAGE_MONITOR_DIR || path.join(os.homedir(), '.claude-usage-monitor'), 'sessions');
const port = Number(process.env.PORT || 4319);
let usageCache = { at: 0, value: { available: false, reason: 'ccusage not yet queried' } };
let inFlight = null;

const localDate = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const num = (n) => typeof n === 'number' && Number.isFinite(n) ? n : 0;

function readSessions() {
  let filenames = [];
  try { filenames = fs.readdirSync(dir).filter(name => /^[\w-]+\.json$/.test(name)).slice(0, 1500); }
  catch { return []; }
  const snapshots = [];
  for (const filename of filenames) {
    try {
      const record = JSON.parse(fs.readFileSync(path.join(dir, filename), 'utf8'));
      if (record && Number.isFinite(record.updatedAt)) snapshots.push(record);
    } catch { /* skip partially written or incompatible records */ }
  }
  return snapshots.sort((a, b) => b.updatedAt - a.updatedAt);
}

function latestQuota(sessions, name) {
  const now = Date.now();
  for (const session of sessions) {
    const quota = session.quota?.[name];
    if (!quota || !Number.isFinite(quota.usedPercentage)) continue;
    if (now - session.updatedAt > 30 * 60 * 1000) continue; // do not claim old quota is live
    if (quota.resetsAt && quota.resetsAt * 1000 <= now) continue;
    return { ...quota, observedAt: session.updatedAt };
  }
  return null;
}

function getDailyUsage() {
  if (Date.now() - usageCache.at < 60000) return Promise.resolve(usageCache.value);
  if (inFlight) return inFlight;
  inFlight = new Promise(resolve => {
    execFile('ccusage', ['claude', 'daily', '--json'], { timeout: 15000, maxBuffer: 15 * 1024 * 1024 }, (error, stdout) => {
      let value;
      try {
        if (error) throw error;
        const report = JSON.parse(stdout);
        const list = Array.isArray(report.daily) ? report.daily : Array.isArray(report.data) ? report.data : [];
        const today = list.find(row => row.date === localDate(new Date()));
        value = { available: true, date: localDate(new Date()),
          inputTokens: num(today?.inputTokens), outputTokens: num(today?.outputTokens),
          cacheReadTokens: num(today?.cacheReadTokens), cacheCreationTokens: num(today?.cacheCreationTokens),
          totalTokens: num(today?.totalTokens), estimatedCostUSD: num(today?.totalCost ?? today?.costUSD) };
      } catch {
        value = { available: false, reason: 'Install ccusage globally: npm install -g ccusage' };
      }
      usageCache = { at: Date.now(), value };
      inFlight = null;
      resolve(value);
    });
  });
  return inFlight;
}

const jsonHeaders = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };
const server = http.createServer(async (req, res) => {
  if (req.method !== 'GET') { res.writeHead(405); res.end(); return; }
  const pathname = new URL(req.url, 'http://localhost').pathname;
  if (pathname === '/api/status') {
    const sessions = readSessions();
    const daily = await getDailyUsage();
    res.writeHead(200, jsonHeaders);
    res.end(JSON.stringify({
      quota: { fiveHour: latestQuota(sessions, 'fiveHour'), sevenDay: latestQuota(sessions, 'sevenDay') },
      sessions: sessions.filter(s => Date.now() - s.updatedAt < 24 * 60 * 60 * 1000).slice(0, 12),
      live: getLive(sessions),
      daily,
      now: Date.now(),
    }));
    return;
  }
  if (pathname === '/' || pathname === '/index.html') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
    fs.createReadStream(path.join(__dirname, 'public/index.html')).pipe(res);
    return;
  }
  res.writeHead(404); res.end('Not found');
});
server.listen(port, '127.0.0.1', () => console.log(`Claude usage dashboard: http://127.0.0.1:${port}`));
