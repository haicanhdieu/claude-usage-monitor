import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gaugeState } from '../public/gauge.mjs';

test('0% used points left, full left', () => { const g = gaugeState({ usedPercentage: 0 }); assert.equal(g.angle, -90); assert.equal(g.left, 100); });
test('50% used points up', () => assert.equal(gaugeState({ usedPercentage: 50 }).angle, 0));
test('100% used points right, red', () => { const g = gaugeState({ usedPercentage: 100 }); assert.equal(g.angle, 90); assert.equal(g.color, '#e0675a'); });
test('clamps out of range', () => { assert.equal(gaugeState({ usedPercentage: 150 }).angle, 90); assert.equal(gaugeState({ usedPercentage: -5 }).angle, -90); });
test('amber band', () => assert.equal(gaugeState({ usedPercentage: 70 }).color, '#e0b04a'));
test('null/NaN/missing are invalid', () => { for (const q of [null, undefined, {}, { usedPercentage: null }, { usedPercentage: NaN }, { usedPercentage: 'x' }]) { const g = gaugeState(q); assert.equal(g.valid, false); assert.equal(g.left, null); } });
test('stale flag passes through', () => assert.equal(gaugeState({ usedPercentage: 10, stale: true }).stale, true));
