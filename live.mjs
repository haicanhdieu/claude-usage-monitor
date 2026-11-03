/**
 * Joins statusline snapshots, native lifecycle hooks, current subagent-panel data and
 * per-agent JSONL transcripts. Never stores message content. Best effort, not a process manager.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const home = process.env.CLAUDE_USAGE_MONITOR_DIR || path.join(os.homedir(), '.claude-usage-monitor');
const traceCache = new Map();
const MAX_PARSE_BYTES_PER_REFRESH = 8 * 1024 * 1024;
const MAX_AGENTS = 100;

function safeReadJSON(filename) {
  try { return JSON.parse(fs.readFileSync(filename, 'utf8')); } catch { return null; }
}
function safeList(dir, filter) {
  try { return fs.readdirSync(dir).filter(filter).slice(0, 1000); } catch { return []; }
}
function add(t, usage, sign = 1) {
  for (const field of ['input', 'output', 'cacheRead', 'cacheWrite']) t[field] += sign * (usage[field] || 0);
}
function blank() { return {input: 0, output: 0, cacheRead: 0, cacheWrite: 0}; }
function parseTrace(filename) {
  if (!filename) return null;
  let stat;
  try { stat = fs.statSync(filename); if (!stat.isFile()) return null; } catch { return null; }
  let cache = traceCache.get(filename);
  if (!cache || stat.size < cache.pos) {
    cache = {pos: 0, carry: '', messages: new Map(), totals: blank(), models: {}, lastModel: '', lastAt: 0};
    traceCache.set(filename, cache);
  }
  let remaining = Math.min(MAX_PARSE_BYTES_PER_REFRESH, stat.size - cache.pos);
  if (remaining > 0) {
    const fd = fs.openSync(filename, 'r');
    try {
      while (remaining > 0) {
        const buffer = Buffer.allocUnsafe(Math.min(256 * 1024, remaining));
        const read = fs.readSync(fd, buffer, 0, buffer.length, cache.pos);
        if (!read) break;
        cache.pos += read;
        remaining -= read;
        const lines = (cache.carry + buffer.subarray(0, read).toString('utf8')).split('\n');
        cache.carry = lines.pop() || '';
        for (const line of lines) {
          if (!line.includes('"assistant"') && !line.includes('"usage"')) continue;
          let rec; try { rec = JSON.parse(line); } catch { continue; }
          if (rec.type !== 'assistant' || !rec.message?.usage) continue;
          const msg = rec.message;
          if (typeof msg.model !== 'string' || msg.model.startsWith('<')) continue;
          const u = msg.usage;
          const value = {
            input: Number(u.input_tokens) || 0,
            output: Number(u.output_tokens) || 0,
            cacheRead: Number(u.cache_read_input_tokens) || 0,
            cacheWrite: Number(u.cache_creation_input_tokens) || 0,
          };
          if (Object.values(value).some(n => n < 0 || !Number.isFinite(n))) continue;
          const id = String(msg.id || rec.uuid || `${cache.pos}-${cache.messages.size}`);
          const key = msg.model + ':' + id;
          const old = cache.messages.get(key);
          if (old) {
            // Claude emits repeated snapshots for a request; keep the largest counters.
            const next = {};
            for (const field of Object.keys(value)) next[field] = Math.max(value[field], old[field]);
            add(cache.totals, old, -1);
            add(cache.models[msg.model], old, -1);
            add(cache.totals, next);
            add(cache.models[msg.model], next);
            cache.messages.set(key, next);
          } else {
            cache.messages.set(key, value);
            add(cache.totals, value);
            cache.models[msg.model] ||= blank();
            add(cache.models[msg.model], value);
          }
          cache.lastModel = msg.model;
          if (rec.timestamp) cache.lastAt = Math.max(cache.lastAt, Date.parse(rec.timestamp) || 0);
        }
      }
    } finally { fs.closeSync(fd); }
  }
  const total = cache.totals.input + cache.totals.output + cache.totals.cacheRead + cache.totals.cacheWrite;
  return { ...cache.totals, total, model: cache.lastModel,
    models: cache.models, complete: cache.pos >= stat.size, lastAt: cache.lastAt };
}
function eventsFor(sid) {
  const filename = path.join(home, 'events', sid + '.jsonl');
  try {
    const stat = fs.statSync(filename);
    const fd = fs.openSync(filename, 'r');
    const len = Math.min(stat.size, 512 * 1024);
    const buf = Buffer.alloc(len);
    try { fs.readSync(fd, buf, 0, len, stat.size - len); } finally { fs.closeSync(fd); }
    return buf.toString('utf8').split('\n').slice(stat.size > len ? 1 : 0)
      .filter(Boolean).map(s => { try { return JSON.parse(s); } catch { return null; } }).filter(Boolean);
  } catch { return []; }
}
function discoverTraces(transcriptPath) {
  if (!transcriptPath || !transcriptPath.endsWith('.jsonl')) return [];
  // Explicit allowlist: never read files outside the local Claude transcript root.
  const root = path.resolve(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'projects');
  const parent = path.resolve(transcriptPath);
  if (!parent.startsWith(root + path.sep)) return [];
  const dir = path.join(path.dirname(parent), path.basename(parent, '.jsonl'), 'subagents');
  const traces = [];
  function scan(folder, depth) {
    if (depth > 4 || traces.length >= MAX_AGENTS) return;
    for (const name of safeList(folder, () => true)) {
      if (traces.length >= MAX_AGENTS) break;
      const file = path.join(folder, name);
      let stat; try { stat = fs.lstatSync(file); } catch { continue; }
      if (stat.isSymbolicLink()) continue;
      if (stat.isDirectory()) { scan(file, depth + 1); continue; }
      if (!/^agent-[\w-]+\.jsonl$/.test(name)) continue;
      const agentId = name.replace(/\.jsonl$/, '');
      const meta = safeReadJSON(file.replace(/\.jsonl$/, '.meta.json')) || {};
      traces.push({agentId, agentType: String(meta.agentType || '').slice(0, 80), file});
    }
  }
  scan(dir, 0);
  return traces;
}
function canonicalAgentId(id) {
  const s = String(id || '');
  return s.startsWith('agent-') ? s : 'agent-' + s;
}
function newerStatus(s, ageLimit = 15000) { return s && Date.now() - s.updatedAt < ageLimit; }

export function getLive(snapshots) {
  const ids = new Set(snapshots.map(s => s.sessionId));
  for (const name of safeList(path.join(home, 'events'), n => /^[\w-]+\.jsonl$/.test(n))) ids.add(name.slice(0, -6));
  const sessions = [];
  const now = Date.now();
  for (const sid of ids) {
    if (sessions.length >= 150) break;
    const snap = snapshots.find(s => s.sessionId === sid);
    const events = eventsFor(sid);
    const last = events.at(-1);
    const lastSeen = Math.max(snap?.updatedAt || 0, last?.at || 0);
    if (now - lastSeen > 24 * 3600 * 1000) continue;
    const lifecycle = events.filter(e => !e.agentId);
    const lastLifecycle = lifecycle.at(-1);
    const closed = lastLifecycle?.event === 'SessionEnd';
    const status = closed ? 'ended' : lastLifecycle?.event === 'Stop' ? 'idle'
      : now - lastSeen < 2 * 60 * 1000 ? 'active/recent' : 'stale (unconfirmed)';
    const panel = safeReadJSON(path.join(home, 'agent-panels', sid + '.json'));
    const agents = new Map();
    for (const event of events) {
      if (!event.agentId) continue;
      const agentId = canonicalAgentId(event.agentId);
      const a = agents.get(agentId) || {agentId, agentType: '', status: 'unknown', updatedAt: 0};
      a.agentType = event.agentType || a.agentType;
      if (event.event === 'SubagentStart') a.status = 'running';
      if (event.event === 'SubagentStop') a.status = 'completed';
      a.updatedAt = Math.max(a.updatedAt, event.at);
      agents.set(agentId, a);
    }
    // The live panel exposes resolved models, independent agent token counts, and task status.
    if (panel?.tasks && Array.isArray(panel.tasks)) {
      for (const task of panel.tasks) {
        let agent = agents.get(task.id) || agents.get(canonicalAgentId(task.id));
        if (!agent && task.description) agent = [...agents.values()].find(a => a.description && a.description === task.description);
        if (!agent && task.agentType) {
          // Prefer an unambiguous type match; task ID is not guaranteed to be agent ID.
          const candidates = [...agents.values()].filter(a => a.agentType === task.agentType && !a.panelMatched);
          if (candidates.length === 1) agent = candidates[0];
        }
        agent ||= {agentId: task.id, updatedAt: 0};
        agent.panelMatched = true;
        Object.assign(agent, {
          agentType: task.agentType || agent.agentType || task.name || '',
          name: task.name,
          description: task.description,
          model: task.model || agent.model || '',
          status: newerStatus(panel, 20000) ? task.status : agent.status || 'unknown',
          tokenCount: task.tokenCount,
          contextWindowSize: task.contextWindowSize,
          startedAt: task.startTime,
          updatedAt: Math.max(agent.updatedAt || 0, panel.updatedAt),
        });
        agents.set(agent.agentId, agent);
      }
    }
    const transcript = snap?.transcriptPath || [...events].reverse().find(e => e.transcriptPath)?.transcriptPath || '';
    const parentTrace = parseTrace(transcript);
    const traces = discoverTraces(transcript);
    for (const trace of traces) {
      let a = agents.get(trace.agentId);
      if (!a && trace.agentType) {
        const candidates = [...agents.values()].filter(item => item.agentType === trace.agentType && !item.usage);
        if (candidates.length === 1) a = candidates[0];
      }
      a ||= {agentId: trace.agentId, status: 'unknown', updatedAt: 0};
      a.agentType ||= trace.agentType;
      const usage = parseTrace(trace.file);
      if (usage) {
        a.usage = usage;
        a.model ||= usage.model;
        a.updatedAt = Math.max(a.updatedAt || 0, usage.lastAt || 0);
      }
      agents.set(a.agentId, a);
    }
    let total = parentTrace?.total || 0;
    for (const a of agents.values()) {
      if (a.usage) total += a.usage.total;
      if (a.status === 'running' && now - a.updatedAt > 120000) a.status = 'unknown (stale)';
      if (closed && a.status === 'running') a.status = 'unknown (session ended)';
    }
    sessions.push({
      sessionId: sid, name: snap?.sessionName || lastLifecycle?.sessionName || '',
      project: snap?.project || lastLifecycle?.project || 'Unknown project',
      model: snap?.modelId || snap?.model || [...lifecycle].reverse().find(e => e.model)?.model || parentTrace?.model || 'Unknown',
      status, lastSeen, context: snap?.context || {},
      agents: [...agents.values()].sort((a,b) => (b.updatedAt||0) - (a.updatedAt||0)).slice(0, MAX_AGENTS),
      usage: {total, main: parentTrace, isComplete: Boolean(parentTrace?.complete && [...agents.values()].every(a => a.usage?.complete || !a.usage))},
    });
  }
  return sessions.sort((a,b) => b.lastSeen - a.lastSeen).slice(0, 25);
}
