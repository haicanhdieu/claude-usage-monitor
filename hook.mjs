#!/usr/bin/env node
/** Non-blocking Claude Code lifecycle collector; deliberately stores no prompts or tool inputs. */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

try {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  const raw = JSON.parse(input);
  const sid = String(raw.session_id || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 100);
  if (!sid) process.exit(0);
  const allow = new Set(['SessionStart', 'SessionEnd', 'UserPromptSubmit', 'Stop', 'SubagentStart', 'SubagentStop', 'PostModelSwitch']);
  const event = String(raw.hook_event_name || '');
  if (!allow.has(event)) process.exit(0);
  const line = {
    sessionId: sid, event, at: Date.now(),
    project: path.basename(raw.cwd || '') || '',
    sessionName: String(raw.session_title || '').slice(0, 100),
    transcriptPath: typeof raw.transcript_path === 'string' ? raw.transcript_path : '',
    agentTranscriptPath: typeof raw.agent_transcript_path === 'string' ? raw.agent_transcript_path : '',
    agentId: String(raw.agent_id || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 100),
    agentType: String(raw.agent_type || '').slice(0, 80),
    model: String(raw.to_model || raw.model || '').slice(0, 100),
  };
  const home = process.env.CLAUDE_USAGE_MONITOR_DIR || path.join(os.homedir(), '.claude-usage-monitor');
  const dir = path.join(home, 'events');
  fs.mkdirSync(dir, {recursive: true, mode: 0o700});
  fs.appendFileSync(path.join(dir, sid + '.jsonl'), JSON.stringify(line) + '\n', {mode: 0o600});

  if (event === 'SessionStart') {
    // Prune data from sessions not touched in the last 2 days.
    const cutoff = Date.now() - 2 * 24 * 60 * 60 * 1000;
    for (const sub of ['sessions', 'agent-panels', 'events']) {
      const subdir = path.join(home, sub);
      let names = [];
      try { names = fs.readdirSync(subdir); } catch { continue; }
      for (const name of names) {
        if (name.startsWith(sid)) continue;
        try {
          const file = path.join(subdir, name);
          if (fs.statSync(file).mtimeMs < cutoff) fs.unlinkSync(file);
        } catch {}
      }
    }
  }
} catch {
  // Hook failures must not interfere with Claude Code.
}
