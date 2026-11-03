# Claude Usage Monitor

A real-time quota and token usage monitor for Claude Code. Shows your account-wide 5-hour / 7-day quota, live sessions, subagents, and per-session token consumption. Available as a native Mac app with tray widget or as a Node.js server dashboard.

## Quick Start (Mac App)

1. **Clone and install:**
   ```bash
   git clone https://github.com/minh-nguyen-kms/claude-usage-monitor.git
   cd claude-usage-monitor
   npm install
   ```

2. **Build the app:**
   ```bash
   npm run dist
   ```
   → Creates `dist/Claude Usage Monitor-*.dmg` and `dist/mac-arm64/Claude Usage Monitor.app`

3. **Install:**
   - Open the `.dmg` file and drag the app to Applications
   - Or double-click the app in `dist/mac-arm64/` (unsigned, so right-click → Open on first launch)

4. **Run:**
   - App reads your Claude Code credentials from Keychain (no configuration needed)
   - Menu bar shows quota: `5h 42% · 7d 18%`
   - Click tray icon to open dashboard, toggle tiny view, or launch at login

## Features

**Mac App:**
- 📊 Menu bar tray showing real-time account quota
- 🔍 Full dashboard with 5h/7d quota, daily history, live sessions
- 📍 Always-on-top tiny gauge view (click-through toggle on/off)
- 🔄 Auto-polling account quota from Anthropic (OAuth token via Keychain)
- ⚙️ Launch at login, window state persistence, single instance lock
- 🎯 Subagent tracking and model resolution

**Optional CLI Server & Hooks:**
- Web dashboard at `http://127.0.0.1:4319`
- CLI status lines for terminal output
- Session lifecycle hooks (SessionStart, SessionEnd, UserPromptSubmit, etc.)
- Token usage tracking per session and per model

**No bloat:**
- Zero third-party dependencies for server/collectors
- Keychain-based authentication (secure, no token storage)
- Incremental parsing for large transcripts (8 MB/refresh limit)
- Runs on Node.js 20+

## CLI Server Mode (Optional)

For a web-only dashboard without the Mac app, or to use hooks for session tracking:

1. **Start the server:**
   ```bash
   node server.mjs
   ```
   Opens `http://127.0.0.1:4319` with full dashboard.

2. **Add hooks to `~/.claude/settings.json` (optional, for per-session tracking):**

   First, get your absolute path:
   ```bash
   pwd  # copy this
   ```

   Then merge into `~/.claude/settings.json`:
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

   **Note:** Do not overwrite other settings or hooks.

3. Start Claude Code and open sessions—hooks will track activity automatically.

## How It Works

**Mac App Quota (Account-wide):**
- Reads OAuth token from Keychain (`Claude Code-credentials`)
- Polls account quota from Anthropic every 150s (stays under ~1 req/2min endpoint budget)
- Retries with backoff on 429 errors
- Falls back to hook-derived quota if Keychain denied or signed out
- Displays quota badges: `account` (live), `hook` (from events), `stale` (older than 10m)

**Dashboard & Hooks (Optional):**
- `statusLine`: Shows session ID, model, current/max context, 5h/7d quota in terminal
- `subagentStatusLine`: Displays active subagent panels with status and token counts
- Lifecycle hooks (SessionStart, SessionEnd, UserPromptSubmit, Stop, SubagentStart, SubagentStop, PostModelSwitch) emit JSONL to `~/.claude-usage-monitor/events`
- Transcripts parsed from `~/.claude/session-id/transcript.jsonl` and agent subagent JSON files
- **Privacy:** Only reads model, token counts, and API usage—never extracts prompts or file contents
- Incremental parsing: up to 8 MB per file per refresh (totals initially incomplete for long sessions)

**Token Counting:**
- Tracks: input tokens, output tokens, cache reads, cache writes
- `consumed incl. cache` = input + output + cache reads (cache writes are write cost, not traffic)
- This is **traffic**, not remaining quota (which comes from account endpoint)
- Cached inputs count as token traffic (the cost to write/read cache), not new text

**Status Indicators:**
- `active`: Event in last 2 minutes (not guaranteed OS process still running)
- `idle`: Stop hook occurred
- `ended`: SessionEnd fired
- `stale (unconfirmed)`: No updates for 2+ minutes (crashed or Claude Code exited)
- Stale values dimmed with age marker (`stale · 5m old`)

**Proxy/Gateway Note:**
- Third-party gateways (9Router, etc.) may serve different model than requested
- Local telemetry shows what Claude Code saw, not what endpoint actually served
- Account quota may be unavailable with API-key or proxy sessions

## Development

**Build and run locally:**
```bash
npm install
npm run app          # Run Electron app in dev
npm run dist         # Build DMG and standalone app
npm run icon         # Regenerate app icon from SVG
npm test             # Run test suite (Node --test)
npm start            # Run CLI server only
```

**Project structure:**
- `app/` — Electron main process, tray, window management
- `src/` — Server, quota polling, Keychain integration
- `public/` — Web UI (HTML, CSS, gauge visualization)
- `test/` — Unit tests
- `scripts/` — Icon generation

**Key modules:**
- `src/quota/poller.mjs` — Account quota polling with backoff
- `src/quota/keychain.mjs` — Secure Keychain token retrieval
- `src/live.mjs` — Event aggregation and transcript parsing
- `src/windowState.mjs` — Persist app window/mode state

## Security & Limitations

- **Binding:** Server only binds to `127.0.0.1` (localhost). Do not expose on networks without auth.
- **Data:**
  - Keychain: Token stored in system Keychain, not disk or RAM (read once per app session)
  - Events: Append-only JSONL to `~/.claude-usage-monitor/` with owner-only permissions
  - Transcripts: Only usage counters are read—prompts, files, args never extracted
- **Stability:** Best-effort monitoring, not a process manager. Schema changes may require updates.
- **Model tracking:** Main model may switch mid-session; dashboard shows latest known, counters show actual.
- **Account quota:** May unavailable with proxies, API keys, or 3rd-party gateways.

## References

- [Claude Code status line docs](https://code.claude.com/docs/en/statusline)
- [Claude Code hooks docs](https://code.claude.com/docs/en/hooks)
- [Claude Code monitoring guide](https://code.claude.com/docs/en/monitoring-usage)
- [GitHub repository](https://github.com/minh-nguyen-kms/claude-usage-monitor)
