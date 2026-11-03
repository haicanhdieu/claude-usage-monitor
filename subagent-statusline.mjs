#!/usr/bin/env node
/** Capture Claude Code subagent panel data; print nothing so its normal rows stay intact. */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

try {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  const raw = JSON.parse(input);
  const sid = String(raw.session_id || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 100);
  if (!sid || !Array.isArray(raw.tasks)) process.exit(0);
  const tasks = raw.tasks.map(t => ({
    id: String(t.id || '').slice(0, 100),
    name: String(t.name || '').slice(0, 80),
    agentType: String(t.agentType || '').slice(0, 80),
    status: String(t.status || '').slice(0, 30),
    description: String(t.label || t.description || '').slice(0, 140),
    model: String(t.model || '').slice(0, 120),
    tokenCount: Number.isFinite(t.tokenCount) ? t.tokenCount : null,
    contextWindowSize: Number.isFinite(t.contextWindowSize) ? t.contextWindowSize : null,
    startTime: Number.isFinite(t.startTime) ? t.startTime : null,
  })).slice(0, 150);
  const dir = path.join(process.env.CLAUDE_USAGE_MONITOR_DIR || path.join(os.homedir(), '.claude-usage-monitor'), 'agent-panels');
  fs.mkdirSync(dir, {recursive: true, mode: 0o700});
  const dest = path.join(dir, sid + '.json');
  const temp = dest + '.' + process.pid + '.tmp';
  fs.writeFileSync(temp, JSON.stringify({sessionId: sid, updatedAt: Date.now(), tasks}), {mode: 0o600});
  fs.renameSync(temp, dest);
} catch {
  // Leave Claude Code's native UI untouched.
}
