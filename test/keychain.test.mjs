import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getAccessToken } from '../src/quota/keychain.mjs';

const TOKEN = 'sk-ant-oat01-FAKE-SECRET';
const ok = (stdout) => async () => ({ stdout });
const fail = (props) => async () => { throw Object.assign(new Error('boom ' + TOKEN), props); };

test('valid JSON → ok with token and expiresAt', async () => {
  const r = await getAccessToken({ exec: ok(JSON.stringify({ claudeAiOauth: { accessToken: TOKEN, expiresAt: 123 } })) });
  assert.deepEqual(r, { ok: true, token: TOKEN, expiresAt: 123 });
});
test('missing expiresAt → null', async () => {
  const r = await getAccessToken({ exec: ok(JSON.stringify({ claudeAiOauth: { accessToken: TOKEN } })) });
  assert.equal(r.expiresAt, null);
});
const cases = [
  ['exit 44 → no-credentials', fail({ code: 44 }), 'no-credentials'],
  ['exit 51 → denied', fail({ code: 51 }), 'denied'],
  ['stderr User canceled → denied', fail({ code: 1, stderr: 'User canceled the operation.' }), 'denied'],
  ['non-JSON → no-credentials', ok('not json'), 'no-credentials'],
  ['{} → no-credentials', ok('{}'), 'no-credentials'],
  ['empty string → no-credentials', ok(''), 'no-credentials'],
  ['empty accessToken → no-credentials', ok(JSON.stringify({ claudeAiOauth: { accessToken: '' } })), 'no-credentials'],
  ['other failure → error', fail({ code: 1 }), 'error'],
];
for (const [name, exec, reason] of cases) {
  test(name, async () => {
    const r = await getAccessToken({ exec });
    assert.deepEqual(r, { ok: false, reason });
    assert.ok(!JSON.stringify(r).includes(TOKEN));
  });
}
