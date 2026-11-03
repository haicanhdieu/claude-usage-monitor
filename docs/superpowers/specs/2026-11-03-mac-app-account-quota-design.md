# Mac app + account-wide quota — design

Date: 2026-11-03

## Goals

1. Show the account's real 5-hour and 7-day quota regardless of which machine consumed it. Today quota only arrives via the Claude Code statusLine hook on this Mac, so usage from other machines is invisible.
2. Ship the dashboard as a double-clickable Mac app that starts monitoring on launch and shows the dashboard, with no CLI.

## Scope decisions (agreed)

- Quota is account-wide and read directly. Sessions, subagents and context stay local to this Mac (hooks + transcripts). No multi-machine session sync.
- App shell: Electron, reusing the existing dependency-free Node server and `public/index.html`.
- Hook-based quota remains as a fallback. The `node server.mjs` CLI path keeps working.

## Out of scope

Multi-machine session sync, notarization/signing, auto-update, OAuth token refresh, Windows/Linux builds.

## Components

```
app/
  main.js          Electron entry: calls startServer(), creates window + tray, single-instance lock
  tray.js          menu-bar icon; title "5h 42% · 7d 18%"; menu: Open, Launch at login, Quit
src/
  server.mjs       existing; exports startServer({port, quotaSource}); still runnable via CLI
  live.mjs         unchanged
  quota/
    keychain.mjs   returns the OAuth access token from Keychain item "Claude Code-credentials"
                   (via `security find-generic-password -w`); in-memory only
    poller.mjs     token -> usage endpoint -> {fiveHour, sevenDay}; caches last good value; getQuota()
    merge.mjs      chooses polled vs hook quota; tags source and staleness
public/index.html  adds source badge ("account" / "hook") and stale state
statusline.mjs, hook.mjs, subagent-statusline.mjs   unchanged, now optional
```

Each quota unit has one purpose: `keychain` returns a token, `poller` turns a token into quota, `merge` decides which source wins.

(Source files currently sit at the repo root; moving them into `src/` is part of the implementation plan.)

## Data flow

1. App launch: Electron calls `startServer()` bound to `127.0.0.1` (port 4319, or a free port if taken). The window loads that URL.
2. The poller runs immediately, then every 60 s, and again when the window gains focus.
3. `/api/status` keeps its current shape. Each quota entry gains `source: "account" | "hook"`, `observedAt`, and `stale: boolean`.
4. The tray title is updated from the same data.
5. `node server.mjs` continues to work for terminal use.

## Error handling

| Situation | Behavior |
|---|---|
| Keychain item missing | Fall back to hook quota; badge "Sign in to Claude Code". |
| User denies Keychain prompt | Same fallback; one-line hint on allowing access. |
| Token expired / 401 | Never refresh (could rotate the refresh token and log Claude Code out). Keep last good value marked stale with age; retry next cycle. |
| Network error, 429, 5xx | Exponential backoff up to 5 min; show last good value as stale. |
| Response shape changed (endpoint is undocumented) | Validate defensively; treat as unavailable, fall back to hook quota, show "quota API changed". |
| Value older than its `resetsAt` | Not shown as current (matches existing `latestQuota` guard). |

The token is held in memory only: never written to disk, logged, or sent to the renderer.

## Packaging

- `electron-builder` produces `.app` and `.dmg`. Initially unsigned/ad-hoc signed (first launch via right-click → Open).
- "Launch at login" via `app.setLoginItemSettings`.
- Closing the window hides to tray; monitoring continues. Quit is in the tray menu.
- Single instance: a second launch focuses the existing window.

## Testing

- Unit (`node:test`, no new deps): `merge` precedence and staleness; `poller` parsing with valid/partial/garbage fixtures; backoff with a fake clock.
- Integration: `startServer()` with an injected fake quota source; assert `/api/status` shape and `source` tags.
- Manual smoke: build the app, launch without a terminal, confirm quota and tray update; revoke Keychain access and confirm fallback.
- **First implementation task — verification spike:** confirm the real usage endpoint, required headers and response shape against the user's own account before building on it. If it fails, ship hook-only quota and report it rather than work around it.

## Risks

- The usage endpoint is undocumented and may change or be restricted; mitigated by defensive parsing, the fallback, and the spike.
- Keychain access prompts on first use.
- Unsigned app triggers a Gatekeeper warning until signing is added.
