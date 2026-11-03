#!/usr/bin/env node
/** Claude Code statusLine collector: stores only aggregate usage (never transcripts or auth). */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let input = '';
for await (const chunk of process.stdin) input += chunk;

const finite = (value) => typeof value === 'number' && Number.isFinite(value) ? value : null;
const quota = (value) => {
  if (!value || typeof value !== 'object') return null;
  const used = finite(value.used_percentage);
  if (used === null) return null;
  return { usedPercentage: used, resetsAt: finite(value.resets_at) };
};
try {
  const data = JSON.parse(input);
  const sid = String(data.session_id || 'default').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 80) || 'default';
  const ctx = data.context_window ?? {};
  const record = {
    sessionId: sid,
    sessionName: String(data.session_name || '').slice(0, 100),
    transcriptPath: String(data.transcript_path || ''),
    modelId: String(data.model?.id || ''),
    updatedAt: Date.now(),
    model: String(data.model?.display_name || data.model?.id || 'Unknown').slice(0, 120),
    project: path.basename(data.workspace?.project_dir || data.workspace?.current_dir || 'Unknown'),
    context: {
      usedPercentage: finite(ctx.used_percentage),
      remainingPercentage: finite(ctx.remaining_percentage),
      size: finite(ctx.context_window_size),
      inputTokens: finite(ctx.total_input_tokens),
      outputTokens: finite(ctx.total_output_tokens),
    },
    costUSD: finite(data.cost?.total_cost_usd),
    quota: {
      fiveHour: quota(data.rate_limits?.five_hour),
      sevenDay: quota(data.rate_limits?.seven_day),
    },
  };
  const dir = path.join(process.env.CLAUDE_USAGE_MONITOR_DIR || path.join(os.homedir(), '.claude-usage-monitor'), 'sessions');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const dest = path.join(dir, `${sid}.json`);
  const temp = `${dest}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(record), { mode: 0o600 });
  fs.renameSync(temp, dest);

  const parts = [record.model];
  if (record.quota.fiveHour) parts.push(`5h ${Math.round(record.quota.fiveHour.usedPercentage)}%`);
  if (record.quota.sevenDay) parts.push(`7d ${Math.round(record.quota.sevenDay.usedPercentage)}%`);
  if (record.context.usedPercentage != null) parts.push(`ctx ${Math.round(record.context.usedPercentage)}%`);
  process.stdout.write(parts.join(' | ') + '\n');
} catch {
  // Never break Claude Code if a statusLine payload is missing or the disk is unavailable.
  process.stdout.write('Claude usage: unavailable\n');
}
