import { execFile } from 'node:child_process';

const defaultExec = (file, args) => new Promise((resolve, reject) => {
  execFile(file, args, { timeout: 10_000 }, (error, stdout, stderr) => {
    if (error) { error.stderr = stderr; reject(error); } else resolve({ stdout });
  });
});

// Returns only a reason on failure; never includes token material or raw errors.
export async function getAccessToken({ exec = defaultExec } = {}) {
  let stdout;
  try {
    ({ stdout } = await exec('security', ['find-generic-password', '-s', 'Claude Code-credentials', '-w']));
  } catch (e) {
    const text = String(e?.stderr ?? '');
    if (e?.code === 44) return { ok: false, reason: 'no-credentials' };
    if (e?.code === 51 || /User canceled|denied/i.test(text)) return { ok: false, reason: 'denied' };
    return { ok: false, reason: 'error' };
  }
  try {
    const oauth = JSON.parse(stdout).claudeAiOauth;
    if (typeof oauth?.accessToken !== 'string' || oauth.accessToken === '') return { ok: false, reason: 'no-credentials' };
    return { ok: true, token: oauth.accessToken, expiresAt: Number.isFinite(oauth.expiresAt) ? oauth.expiresAt : null };
  } catch {
    return { ok: false, reason: 'no-credentials' };
  }
}
