import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatTrayTitle } from '../src/quota/title.mjs';

const e = (p, stale = false) => ({ usedPercentage: p, stale });
test('both fresh', () => assert.equal(formatTrayTitle({ fiveHour: e(42), sevenDay: e(18) }), '5h 42% · 7d 18%'));
test('rounds', () => assert.equal(formatTrayTitle({ fiveHour: e(41.6), sevenDay: e(18) }), '5h 42% · 7d 18%'));
test('null five hour', () => assert.equal(formatTrayTitle({ fiveHour: null, sevenDay: e(18) }), '5h – · 7d 18%'));
test('stale seven day', () => assert.equal(formatTrayTitle({ fiveHour: e(42), sevenDay: e(18, true) }), '5h 42% · 7d 18%*'));
test('both null', () => assert.equal(formatTrayTitle({ fiveHour: null, sevenDay: null }), '5h – · 7d –'));
