import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadState, saveState, clampPos } from '../src/windowState.mjs';

const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ws-')), 's.json');
test('round trip', () => { const f = tmp(); saveState(f, { mode: 'tiny', tinyPos: { x: 5, y: 6 } }); assert.deepEqual(loadState(f), { mode: 'tiny', tinyPos: { x: 5, y: 6 } }); });
test('missing file -> defaults', () => assert.deepEqual(loadState('/nonexistent/x.json'), { mode: 'full', tinyPos: null }));
test('corrupt file -> defaults', () => { const f = tmp(); fs.writeFileSync(f, '{nope'); assert.deepEqual(loadState(f), { mode: 'full', tinyPos: null }); });
test('bad fields sanitized', () => { const f = tmp(); fs.writeFileSync(f, JSON.stringify({ mode: 'weird', tinyPos: { x: 'a', y: 1 } })); assert.deepEqual(loadState(f), { mode: 'full', tinyPos: null }); });
const d = [{ x: 0, y: 0, width: 1000, height: 800 }];
const size = { width: 260, height: 140 };
test('clamp keeps on-screen pos', () => assert.deepEqual(clampPos({ x: 100, y: 100 }, size, d), { x: 100, y: 100 }));
test('clamp pulls partially off-screen back', () => assert.deepEqual(clampPos({ x: 900, y: 750 }, size, d), { x: 740, y: 660 }));
test('fully off-screen -> null', () => assert.equal(clampPos({ x: 5000, y: 5000 }, size, d), null));
test('no pos -> null', () => assert.equal(clampPos(null, size, d), null));
