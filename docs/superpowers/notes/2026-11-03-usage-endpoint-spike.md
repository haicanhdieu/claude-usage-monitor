# Usage endpoint spike (2026-11-03)

Result: **PASS** — expected values confirmed.

- Keychain item `Claude Code-credentials` → JSON `claudeAiOauth.accessToken` (string), `claudeAiOauth.expiresAt` (epoch ms).
- `GET https://api.anthropic.com/api/oauth/usage`, headers `Authorization: Bearer <token>`, `anthropic-beta: oauth-2025-04-20`.
- Real token: HTTP 200. Garbage token: HTTP 401 (`{type, error:{type,message}, request_id}`).
- Response relevant keys: `five_hour` and `seven_day`, each `{ utilization: number, resets_at: string, ... }`.
  - Sample: five_hour.utilization = 2, seven_day.utilization = 36.
  - `utilization` is **0–100** (not 0–1).
  - `resets_at` is ISO-8601 with offset and microseconds, e.g. `2026-11-03T09:10:00.808228+00:00`; parses with `Date.parse`.
- Response contains many additional keys (mostly null); parser must ignore them. Windows may be `null`.
- Not compared against the hook value (no server running during spike); seven_day=36 / five_hour=2 plausible.
