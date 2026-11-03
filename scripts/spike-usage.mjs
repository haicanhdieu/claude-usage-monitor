#!/usr/bin/env node
// Spike: verify the account usage endpoint. Never prints the token.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const run = promisify(execFile);
const URL_ = 'https://api.anthropic.com/api/oauth/usage';

function shape(v, p = '$', out = []) {
  if (Array.isArray(v)) out.push(`${p}: array(${v.length})`);
  else if (v && typeof v === 'object') { out.push(`${p}: object`); for (const k of Object.keys(v)) shape(v[k], `${p}.${k}`, out); }
  else out.push(`${p}: ${v === null ? 'null' : typeof v} = ${typeof v === 'number' || /^\d{4}-/.test(String(v)) ? v : '<redacted>'}`);
  return out;
}

let token, expiresAt;
try {
  const { stdout } = await run('security', ['find-generic-password', '-s', 'Claude Code-credentials', '-w'], { timeout: 10000 });
  const j = JSON.parse(stdout);
  token = j.claudeAiOauth?.accessToken; expiresAt = j.claudeAiOauth?.expiresAt;
  console.log('keychain: ok, token present:', typeof token === 'string' && token.length > 0, 'expiresAt:', expiresAt, 'expired:', expiresAt <= Date.now());
} catch (e) { console.log('keychain failed, code:', e.code); process.exit(1); }

const headers = { Authorization: 'Bearer ' + token, 'anthropic-beta': 'oauth-2025-04-20' };
console.log('header names:', Object.keys(headers).join(', '));
for (const [label, h] of [['real token', headers], ['garbage token', { ...headers, Authorization: 'Bearer garbage' }]]) {
  const res = await fetch(URL_, { headers: h });
  console.log(`\n[${label}] HTTP ${res.status}`);
  const text = await res.text();
  try { console.log(shape(JSON.parse(text)).join('\n')); } catch { console.log('non-JSON body, length', text.length); }
}
