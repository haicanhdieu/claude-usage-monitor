# Claude Code live usage dashboard

A lightweight **local** Node.js dashboard. Shows 5-hour / 7-day quota, current context, daily token history, **observed live CLI sessions**, **subagents**, their **resolved models**, per-agent tokens and status. No third-party dependencies for the server or collectors. Node.js 20+.

## Run

1. Extract the archive, enter the folder, and run `pwd`. Keep the **absolute path**.
2. Edit `~/.claude/settings.json`, merging the keys with your existing configuration. Replace `/ABSOLUTE/PATH` with the extracted directory. **Do not overwrite other settings or hooks.**

```json
{
  "statusLine": {
    "type": "command",
    "command": "node /ABSOLUTE/PATH/claude-usage-monitor/statusline.mjs"
  },
  "subagentStatusLine": {
    "type": "command",
    "command": "node /ABSOLUTE/PATH/claude-usage-monitor/subagent-statusline.mjs"
  },
  "hooks": {
    "SessionStart": [{ "hooks": [{ "type": "command", "command": "node /ABSOLUTE/PATH/claude-usage-monitor/hook.mjs" }] }],
    "UserPromptSubmit": [{ "hooks": [{ "type": "command", "command": "node /ABSOLUTE/PATH/claude-usage-monitor/hook.mjs" }] }],
    "Stop": [{ "hooks": [{ "type": "command", "command": "node /ABSOLUTE/PATH/claude-usage-monitor/hook.mjs" }] }],
    "SessionEnd": [{ "hooks": [{ "type": "command", "command": "node /ABSOLUTE/PATH/claude-usage-monitor/hook.mjs" }] }],
    "SubagentStart": [{ "hooks": [{ "type": "command", "command": "node /ABSOLUTE/PATH/claude-usage-monitor/hook.mjs" }] }],
    "SubagentStop": [{ "hooks": [{ "type": "command", "command": "node /ABSOLUTE/PATH/claude-usage-monitor/hook.mjs" }] }],
    "PostModelSwitch": [{ "hooks": [{ "type": "command", "command": "node /ABSOLUTE/PATH/claude-usage-monitor/hook.mjs" }] }]
  }
}
```

3. For daily usage aggregates (optional):

```bash
npm install -g ccusage
```

4. In the extracted folder, start the server:

```bash
node server.mjs
```

5. Open http://127.0.0.1:4319. **Start or resume Claude Code** sessions so they register lifecycle hooks. Run a task that starts subagents.

## Sources and meaning

- `statusLine`: main session ID, project, current model/context, subscription quota percentages. Does **not** describe subagents.
- `subagentStatusLine`: *visible subagent panel tasks* on current versions, with status, resolved model, tokenCount, contextWindowSize. `agentType` needs Claude Code v2.1.293+. As a hook-like command, it writes snapshots into `~/.claude-usage-monitor/agent-panels` but emits no replacement row, keeping Claude's built-in panel rendering. Earlier versions may not support this feature.
- Lifecycle hooks: SessionStart, SessionEnd, UserPromptSubmit, Stop, SubagentStart, SubagentStop, PostModelSwitch. Data stored as append-only JSONL events under `~/.claude-usage-monitor/events`. Captures no conversation text.
- Raw transcripts: discovered from the `transcript_path` officially exposed by statusLine and hooks, and then inside `session-id/subagents/agent-*.jsonl`. The server reads **only** model and API usage counters (input, output, cache reads/writes), and never exposes prompts or file contents. On long logs, the server incrementally parses up to 8 MB per file per refresh, so totals can initially be incomplete. Multiple assistant snapshots for the same API response are deduplicated by message ID.
- Token usage: “consumed incl. cache” sums each API request's input/output/cache counters; cached inputs are token traffic, not new unique text, and this number is **not** the remaining plan quota.
- Status honesty: “active/recent” shows events in the last 2 minutes but **doesn't guarantee an open OS process**. “idle” means a Stop hook occurred; “ended” means SessionEnd fired. Crashes may leave old sessions as `stale (unconfirmed)`. A running agent becomes unknown/stale after two minutes without an update. Hook and panel-based activity is near-real-time, not continuous API streaming.
- Third-party gateways (e.g., 9Router) can replace the actual model behind an alias: local Claude Code telemetry reports what Claude Code requested or resolved, which may not equal the **upstream model actually served**. For upstream verification, you must also ingest the gateway logs. Claude subscription quota data can be absent with proxies/API-key sessions.

## Security & limits

- Binds to `127.0.0.1`. Do not expose on a public network without authentication.
- Local files created with owner-only permissions. Tokens, prompts, tool arguments and credentials are not recorded by the collectors.
- Transcripts are not a formally stable API, so schema changes need handling. The dashboard is best-effort and not a process manager.
- The main model of a session may switch; the dashboard displays the latest known model, while transcript usage counts by actual logged model.

Official references:
- https://code.claude.com/docs/en/statusline
- https://code.claude.com/docs/en/hooks
- https://code.claude.com/docs/en/monitoring-usage
