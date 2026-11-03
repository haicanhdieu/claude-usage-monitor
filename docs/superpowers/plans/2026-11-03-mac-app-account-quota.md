# Mac App + Account-Wide Quota Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show the account's real 5-hour/7-day quota (read directly from Anthropic, not via local hooks) in a double-clickable Electron Mac app with a menu-bar tray.

**Architecture:** The existing dependency-free Node server becomes an importable `startServer({port, quotaSource})`. A new `src/quota/` trio (`keychain` → `poller` → `merge`) produces account quota and reconciles it with hook-derived quota. Electron (`app/`) is a thin shell: it starts the server in-process, opens a window on it, and drives a tray title from the same data.

**Tech Stack:** Node 20+ ESM (`.mjs`), `node:test` (no new test deps), Electron + electron-builder (devDependencies only), macOS `security` CLI.

**Spec:** `docs/superpowers/specs/2026-11-03-mac-app-account-quota-design.md`

## Global Constraints

- Server and collectors stay dependency-free; Electron/electron-builder are `devDependencies` only.
- Tests use `node:test` only (`node --test`), no new deps.
- Server binds `127.0.0.1`; port `4319`, or a free port if taken (app mode).
- Keychain item name: `Claude Code-credentials`, read via `security find-generic-password -w`.
- Poll immediately, then every 60 s, and again on window focus.
- Token is in memory only: never written to disk, logged, included in errors, or sent to the renderer / `/api/status`.
- Never refresh the OAuth token (would rotate the refresh token and log Claude Code out).
- Backoff on network error / 429 / 5xx: exponential up to 5 min; show last good value as stale. 401: keep last good value stale, retry next normal cycle.
- Each `/api/status` quota entry: `source: "account" | "hook"`, `observedAt`, `stale: boolean`; existing fields (`usedPercentage`, `resetsAt`) unchanged.
- A value past its `resetsAt` is never shown as current.
- Tray title format: `5h 42% · 7d 18%`. Tray menu: Open, Launch at login, Quit.
- Window close hides to tray; single-instance lock (second launch focuses window).
- Unsigned/ad-hoc `.app` + `.dmg` via electron-builder. `node server.mjs` must keep working.
- `statusline.mjs`, `hook.mjs`, `subagent-statusline.mjs`, `live.mjs` logic unchanged and stay at repo root paths users' `~/.claude/settings.json` already reference (`live.mjs` moves into `src/` with import fixes only).
- Out of scope: multi-machine session sync, signing/notarization, auto-update, token refresh, Windows/Linux.

## Review Focus

1. Keychain returns non-JSON, JSON without `claudeAiOauth.accessToken`, or an empty string → treated as "no credentials" (fallback to hook), never a crash.
2. Usage response with `utilization` as string / negative / >100 / missing `resets_at` → rejected as "quota API changed" (not rendered as a nonsense bar); `resets_at` as ISO string normalized to epoch **seconds**.
3. Port 4319 already in use when launched as the app → falls back to a free port and the window loads that port; CLI mode still reports the error.
4. The access token string never appears in `/api/status` output, thrown error messages, or logs.
5. Token `expiresAt` already in the past → no API call is made (no 401 loop); last good value is shown stale.

## File Structure

```
package.json                 scripts: test, start, app, dist; devDeps electron, electron-builder; "main": "app/main.js"
server.mjs                   root shim: imports src/server.mjs, calls startServer() (keeps `node server.mjs`)
src/server.mjs               moved; exports startServer(); wires quotaSource + merge into /api/status
src/live.mjs                 moved, import paths only
src/quota/keychain.mjs       getAccessToken()
src/quota/poller.mjs         createPoller()
src/quota/merge.mjs          mergeQuota()
src/quota/title.mjs          formatTrayTitle()
app/main.js                  Electron entry (CJS; uses dynamic import() for ESM server)
app/tray.js                  Tray wrapper
public/index.html            source badge + stale state + quota status line
test/*.test.mjs              unit + integration tests
scripts/spike-usage.mjs      Task 1 verification spike (kept as dev tool)
docs/superpowers/notes/2026-11-03-usage-endpoint-spike.md   spike findings
```

Shared shapes (used by every task):

```js
// AccountQuota entry (internal, from poller; resetsAt = epoch SECONDS to match hook data)
{ usedPercentage: number /*0..100*/, resetsAt: number|null, observedAt: number /*epoch ms*/ }
// poller.getQuota() ->
{ fiveHour: AccountQuota|null, sevenDay: AccountQuota|null,
  status: 'ok'|'no-credentials'|'denied'|'api-changed'|'error'|'pending',
  lastAttemptAt: number|null, lastOkAt: number|null }
// merged entry (what /api/status exposes)
{ usedPercentage, resetsAt, observedAt, source: 'account'|'hook', stale: boolean }
```

---

### Task 1: Verification spike — real usage endpoint

Per spec this gates everything else. If it fails, stop and report; ship hook-only (Tasks 2, 6-8 only, skipping poller wiring).

**Files:**
- Create: `scripts/spike-usage.mjs`, `docs/superpowers/notes/2026-11-03-usage-endpoint-spike.md`

**Interfaces:**
- Produces: confirmed endpoint URL, required headers, response shape, and token JSON path — recorded in the notes file. Tasks 4 and 5 use these; the values below are the *expected* ones from community tooling and must be corrected if the spike differs.
  - Keychain JSON: `{ "claudeAiOauth": { "accessToken": string, "expiresAt": epoch-ms } }`
  - `GET https://api.anthropic.com/api/oauth/usage`, headers `Authorization: Bearer <token>`, `anthropic-beta: oauth-2025-04-20`
  - Response: `{ "five_hour": { "utilization": number, "resets_at": ISO-8601 string }, "seven_day": { ...same } }`

- [ ] **Step 1: Write `scripts/spike-usage.mjs`.** Reads the token with `security find-generic-password -s "Claude Code-credentials" -w`, calls the endpoint, prints HTTP status, header names used, and the response **with the token never printed**. Prints key paths/types of the response (not just raw values) so shape can be recorded.
- [ ] **Step 2: Run it** — `node scripts/spike-usage.mjs`. Expected: HTTP 200 and `five_hour` / `seven_day` objects. Compare `utilization` to the `/status` quota shown by Claude Code (or `curl http://127.0.0.1:4319/api/status` hook value) — should agree within a few percent.
- [ ] **Step 3: Write the notes file** with: endpoint, headers, exact response sample (numbers only), whether `utilization` is 0-100 or 0-1, `resets_at` format, and behaviour on a garbage token (expect 401). If the call fails (non-200, Keychain denied, shape unusable), write that down, stop, and report to the user instead of continuing.
- [ ] **Step 4: Commit**

```bash
git add scripts/spike-usage.mjs docs/superpowers
git commit -m "spike: verify account usage endpoint"
```

---

### Task 2: Restructure into `src/`, `startServer()`, test harness

**Files:**
- Create: `package.json`, `src/server.mjs` (moved), `src/live.mjs` (moved), root `server.mjs` (shim), `test/server.test.mjs`
- Modify: `.gitignore` (already ignores `node_modules/`, `dist/`)

**Interfaces:**
- Produces: `startServer({ port?: number = 4319, fallbackToFreePort?: boolean = false, quotaSource?: QuotaSource, sessionsDir?: string }) -> Promise<{ port: number, close: () => Promise<void> }>` exported from `src/server.mjs`.
  `QuotaSource = { getQuota(): PollerSnapshot, refresh(): Promise<void> }` (shape in File Structure). Default `quotaSource` returns `{fiveHour:null, sevenDay:null, status:'pending'}`.
- Consumes: existing behaviour of `server.mjs` (reads sessions dir, `getLive`, `getDailyUsage`).

- [ ] **Step 1: Write failing test** `test/server.test.mjs`: `startServer({port: 0, sessionsDir: <tmpdir with one session JSON having quota.fiveHour usedPercentage 40, updatedAt now>, quotaSource: fake})` then `fetch('/api/status')`. Assert 200, body has keys `quota, sessions, live, daily, now`; `quota.fiveHour.usedPercentage === 40`. Second test: `close()` resolves and the port stops accepting. (`daily` will call `ccusage`; tolerate `available:false`.)
- [ ] **Step 2: Run** `node --test test/` → FAIL (module not found).
- [ ] **Step 3: Move and refactor.** `mv server.mjs src/server.mjs; mv live.mjs src/live.mjs` (files are untracked). In `src/server.mjs`: fix `public/index.html` path to `../public/index.html`; wrap `http.createServer(...).listen` in `startServer`; sessions dir becomes the `sessionsDir` option defaulting to the current env-based path; remove module-level listen. Keep the `ccusage` cache module-level. When run directly (`import.meta.url === pathToFileURL(process.argv[1]).href`) call `startServer({port: Number(process.env.PORT||4319)})` and print the existing URL line. `fallbackToFreePort`: on `EADDRINUSE` retry with port `0`.
- [ ] **Step 4: Create root `server.mjs` shim** (`import { startServer } from './src/server.mjs'; startServer({port: Number(process.env.PORT||4319)}).then(s=>console.log(...))`) and `package.json` (`"private": true`, `"scripts": {"test": "node --test test/", "start": "node server.mjs"}`; no `"type"` field — `.mjs` is ESM, `app/main.js` stays CJS).
- [ ] **Step 5: Run** `node --test test/` → PASS; manually `node server.mjs` and `curl -s 127.0.0.1:4319/api/status | head -c 200`, then stop it.
- [ ] **Step 6: Commit**

```bash
git add package.json server.mjs src test .gitignore README.md hook.mjs statusline.mjs subagent-statusline.mjs public
git commit -m "refactor: move server into src, export startServer, add tests"
```

---

### Task 3: `merge.mjs` and `/api/status` wiring

**Files:**
- Create: `src/quota/merge.mjs`, `test/merge.test.mjs`
- Modify: `src/server.mjs` (replace `latestQuota` use), `test/server.test.mjs`

**Interfaces:**
- Produces: `mergeQuota({ polled: PollerSnapshot, hook: {fiveHour, sevenDay} /* existing latestQuota output or null per key */, now: number }) -> { fiveHour: Merged|null, sevenDay: Merged|null, status: PollerSnapshot['status'] }`.
- Rules (pin in tests): (a) a candidate with `resetsAt*1000 <= now` is dropped; (b) polled entry `stale = now - observedAt > 180_000`; hook entry `stale = now - observedAt > 300_000` (hook entries >30 min old are already dropped by `latestQuota`); (c) pick a non-stale candidate over a stale one; if both fresh, `account` wins; if both stale, the one with newer `observedAt`; (d) `source` set accordingly.

- [ ] **Step 1: Write failing tests** `test/merge.test.mjs` with fixed `now`: fresh polled + fresh hook → `source:'account'`; stale polled (observedAt now-200_000) + fresh hook → `source:'hook', stale:false`; both null → `null`; polled past `resetsAt` + no hook → `null`; both stale → newer wins and `stale:true`; `status` passes through.
- [ ] **Step 2: Run** `node --test test/merge.test.mjs` → FAIL.
- [ ] **Step 3: Implement `mergeQuota`** per rules.
- [ ] **Step 4: Wire into `/api/status`:** `quota: mergeQuota({polled: quotaSource.getQuota(), hook: {...latestQuota...}, now})`, plus top-level `quotaStatus: status`. Extend `test/server.test.mjs`: fake source with fresh account 55% and session hook 40% → `quota.fiveHour.source === 'account'`, `usedPercentage === 55`; fake source `status:'no-credentials'` with null quotas → falls back to `source:'hook'` and `quotaStatus === 'no-credentials'`.
- [ ] **Step 5: Run** `node --test test/` → PASS.
- [ ] **Step 6: Commit** `git add src test && git commit -m "feat: merge account and hook quota with source/stale tags"`

---

### Task 4: `keychain.mjs`

**Files:**
- Create: `src/quota/keychain.mjs`, `test/keychain.test.mjs`

**Interfaces:**
- Produces: `getAccessToken({ exec = defaultExec }) -> Promise<{ ok: true, token: string, expiresAt: number|null } | { ok: false, reason: 'no-credentials' | 'denied' | 'error' }>`. `exec(file, args) -> Promise<{stdout}>` is injectable; default wraps `execFile('security', ['find-generic-password','-s','Claude Code-credentials','-w'])` with a 10 s timeout. The returned object must not be logged anywhere; error paths return only `reason`.
- Mapping: exit code 44 (item not found) → `no-credentials`; stderr/exit indicating user cancelled (exit 51, or stderr containing `User canceled` / `denied`) → `denied`; other failure → `error`; stdout not JSON or missing `claudeAiOauth.accessToken` string → `no-credentials`.

- [ ] **Step 1: Write failing tests** with fake `exec`: valid JSON → `ok` with token and `expiresAt`; rejects with `{code:44}` → `no-credentials`; rejects `{code:51}` → `denied`; stdout `"not json"` → `no-credentials`; JSON `{}` → `no-credentials`; empty string → `no-credentials`; other rejection → `error`. Assert no result object's `JSON.stringify` contains the fake token when `ok:false`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Verify on the real machine** (not in the test suite): `node -e "import('./src/quota/keychain.mjs').then(async m=>{const r=await m.getAccessToken();console.log(r.ok,r.reason)})"` → prints `true undefined` (Keychain prompt may appear; choose Allow).
- [ ] **Step 6: Commit** `git add src/quota/keychain.mjs test/keychain.test.mjs && git commit -m "feat: read Claude Code OAuth token from Keychain"`

---

### Task 5: `poller.mjs`

**Files:**
- Create: `src/quota/poller.mjs`, `test/poller.test.mjs`, `test/fixtures/usage-*.json` (valid, partial, garbage — shape per spike notes)

**Interfaces:**
- Consumes: `getAccessToken` from Task 4 (injected as `getToken`).
- Produces: `parseUsage(body: unknown, now: number) -> { fiveHour: AccountQuota|null, sevenDay: AccountQuota|null } | null` (null = unrecognised shape) and
  `createPoller({ getToken, fetch = globalThis.fetch, now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout, intervalMs = 60_000, maxBackoffMs = 300_000, minRefreshGapMs = 10_000 }) -> { getQuota(): PollerSnapshot, refresh(): Promise<void>, start(): void, stop(): void }`.
- Behaviour to pin:
  - `parseUsage`: `utilization` must be a finite number in `[0,100]` (adjust to spike finding if API uses 0–1), else the whole body → `null`; at least one of the two windows must parse; `resets_at` ISO string → epoch seconds, absent → `null`.
  - `refresh()`: token `!ok` → status = `reason` (`no-credentials`/`denied`/`error`), no fetch; token `expiresAt <= now` → no fetch, status `error`, keep last good; 200+valid → status `ok`, update `lastOkAt`; 200+unparseable → `api-changed`, keep last good; 401 → status `error`, keep last good, **no backoff**; network throw / 429 / 5xx → status `error`, backoff doubles each failure from `intervalMs` capped at `maxBackoffMs`, reset on success; `refresh()` calls within `minRefreshGapMs` of the last attempt are no-ops; concurrent calls share one in-flight request.
  - `start()` calls `refresh()` immediately then schedules the next via `setTimer(…, currentDelay)`; `stop()` clears it. Token is fetched fresh each cycle, never stored on the poller object.

- [ ] **Step 1: Write failing tests** (fake clock via injected `now`/`setTimer`, fake `fetch` returning `{status, json()}`): one per behaviour bullet above; backoff test asserts scheduled delays `60000, 120000, 240000, 300000, 300000`, then `60000` after a success; 401 test asserts delay stays `60000`; fixture tests for `parseUsage` (valid, one-window-only, `utilization: "x"`, `utilization: 150`, `[]`, `null`). Assert the fake token never appears in `JSON.stringify(poller.getQuota())` nor in any `Error.message` produced.
- [ ] **Step 2: Run** `node --test test/poller.test.mjs` → FAIL.
- [ ] **Step 3: Implement** per interfaces; request uses the URL and headers recorded in the spike notes.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Live check:** `node -e` script creating a poller with the real keychain + fetch, `await refresh()`, print `getQuota()` → `status: 'ok'`, percentages plausible.
- [ ] **Step 6: Commit** `git add src/quota/poller.mjs test && git commit -m "feat: poll account quota with backoff and stale handling"`

---

### Task 6: Dashboard UI — source badge and stale state

**Files:**
- Modify: `public/index.html` (the `quota()` function at line ~56 and the two quota cards at lines 14–15)

**Interfaces:**
- Consumes: `/api/status` fields `quota.*.{source, stale, observedAt}` and `quotaStatus`.
- Copy (exact): badge text `account` / `hook`; stale marker `stale · <N>m old`; status messages by `quotaStatus`: `no-credentials` → `Sign in to Claude Code`; `denied` → `Allow Keychain access for this app to read account quota`; `api-changed` → `quota API changed`; `error` → `Quota refresh failing; showing last value`. Only rendered via `textContent` (existing XSS discipline).

- [ ] **Step 1: Add a small `quotaNote(status)` and badge element** to each card; update `quota()` to set badge, stale styling (dim bar + marker), and the status line; keep existing "Unavailable" fallback when entry is null.
- [ ] **Step 2: Verify in browser** via `node server.mjs` with a temp `CLAUDE_USAGE_MONITOR_DIR` containing a session JSON with quota; open http://127.0.0.1:4319 and confirm `hook` badge shows. (Account/stale states are covered by Task 3 server tests plus Task 9 smoke.)
- [ ] **Step 3: Commit** `git add public/index.html && git commit -m "feat: show quota source badge and stale state"`

---

### Task 7: Electron shell — main, tray, title

**Files:**
- Create: `app/main.js`, `app/tray.js`, `src/quota/title.mjs`, `test/title.test.mjs`
- Modify: `package.json` (devDependency `electron`, `"main": "app/main.js"`, script `"app": "electron ."`)

**Interfaces:**
- Produces: `formatTrayTitle(quota: {fiveHour, sevenDay}) -> string` in `src/quota/title.mjs`: `"5h 42% · 7d 18%"` (rounded `usedPercentage`); a missing/null window shows `5h –`/`7d –`; stale entries get a trailing `*` on that window (e.g. `5h 42%*`).
- `app/tray.js` exports `createTray({ onOpen, getLoginItem, setLoginItem, onQuit }) -> { setTitle(text: string): void }`.
- `app/main.js` behaviour: `app.requestSingleInstanceLock()` (second instance → focus window, quit); `const { startServer } = await import('../src/server.mjs')`; create poller (`createPoller({getToken: getAccessToken})`), `poller.start()`, `startServer({port: 4319, fallbackToFreePort: true, quotaSource: poller})`; `BrowserWindow` loads `http://127.0.0.1:<port>` with `nodeIntegration: false`, `contextIsolation: true`, no preload (token never reaches the renderer); window `close` event → `preventDefault()` + `hide()` unless quitting; window `focus` → `poller.refresh()`; every 15 s fetch `/api/status` (or share the merge function directly) and `tray.setTitle(formatTrayTitle(...))`; `app.setLoginItemSettings({openAtLogin})` for the tray toggle; `before-quit` → `poller.stop()`, server `close()`; `app.dock` stays visible.

- [ ] **Step 1: Write failing tests** `test/title.test.mjs`: both fresh → `"5h 42% · 7d 18%"`; 41.6 → `42%`; `fiveHour:null` → `"5h – · 7d 18%"`; stale 7d → `"5h 42% · 7d 18%*"`; both null → `"5h – · 7d –"`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement `title.mjs`.** **Step 4: Run** → PASS.
- [ ] **Step 5: `npm install --save-dev electron`**, write `app/main.js` and `app/tray.js` per the behaviour above.
- [ ] **Step 6: Smoke:** `npm run app` → window shows dashboard; tray shows title; closing window keeps tray alive; launching `npm run app` a second time doesn't create a second tray; with `node server.mjs` already holding 4319, the app still opens (free-port fallback; Review Focus 3).
- [ ] **Step 7: Commit** `git add app src/quota/title.mjs test/title.test.mjs package.json package-lock.json && git commit -m "feat: electron shell with tray and single instance"`

---

### Task 8: Packaging

**Files:**
- Modify: `package.json` (`build` block, `dist` script)

**Interfaces:**
- Produces: `npm run dist` → `dist/*.dmg` and `dist/mac*/…app`.
- Config to pin: `appId: "com.ntm.claude-usage-monitor"`, `productName: "Claude Usage Monitor"`, `mac.target: ["dmg","dir"]`, `mac.identity: null` (unsigned/ad-hoc), `files: ["app/**","src/**","public/**","package.json"]`, `mac.category: "public.app-category.developer-tools"`.

- [ ] **Step 1: `npm install --save-dev electron-builder`**, add `build` block and `"dist": "electron-builder --mac"`.
- [ ] **Step 2: Run** `npm run dist`; expected: `.app` and `.dmg` in `dist/` (gitignored). Confirm `public/index.html` and `src/server.mjs` are inside the app bundle (`ls "dist/mac-arm64/Claude Usage Monitor.app/Contents/Resources/app.asar"` or `npx asar list`).
- [ ] **Step 3: Commit** `git add package.json package-lock.json && git commit -m "build: electron-builder mac config"`

---

### Task 9: End-to-end smoke and docs

**Files:**
- Modify: `README.md` (add "Mac app" section; mark hook setup as optional fallback)

- [ ] **Step 1: Smoke the built app** (open from Finder via right-click → Open, no terminal): dashboard loads; quota shows `account` badge; tray title matches; `ps` shows no `node server.mjs`.
- [ ] **Step 2: Fallback smoke:** in Keychain Access, deny/remove access for the app (or run with the Keychain item temporarily unavailable) → badge flips to `hook` (if hook data exists) and the status line reads the correct copy from Task 6; restore access → returns to `account` within 60 s.
- [ ] **Step 3: Token leak check:** `curl -s 127.0.0.1:<port>/api/status | grep -c "sk-ant"` → `0`; app stdout has none either.
- [ ] **Step 4: Update README** with install (right-click → Open for unsigned app), launch-at-login, Keychain prompt explanation, and that `node server.mjs` still works. Mention hooks are optional but still provide sessions/subagents.
- [ ] **Step 5: Run full suite** `npm test` → all PASS.
- [ ] **Step 6: Commit** `git add README.md && git commit -m "docs: mac app usage and fallback behaviour"`
