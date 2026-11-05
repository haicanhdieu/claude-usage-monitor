import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gaugeState } from '../public/gauge.mjs';

test('0% used (100% left) points right', () => { const g = gaugeState({ usedPercentage: 0 }); assert.equal(g.angle, 90); assert.equal(g.left, 100); });
test('50% used points up', () => assert.equal(gaugeState({ usedPercentage: 50 }).angle, 0));
test('100% used (0% left) points left, red', () => { const g = gaugeState({ usedPercentage: 100 }); assert.equal(g.angle, -90); assert.equal(g.color, '#e0675a'); });
test('clamps out of range', () => { assert.equal(gaugeState({ usedPercentage: 150 }).angle, -90); assert.equal(gaugeState({ usedPercentage: -5 }).angle, 90); });
test('amber band', () => assert.equal(gaugeState({ usedPercentage: 70 }).color, '#e0b04a'));
test('null/NaN/missing are invalid', () => { for (const q of [null, undefined, {}, { usedPercentage: null }, { usedPercentage: NaN }, { usedPercentage: 'x' }]) { const g = gaugeState(q); assert.equal(g.valid, false); assert.equal(g.left, null); } });
test('stale flag passes through', () => assert.equal(gaugeState({ usedPercentage: 10, stale: true }).stale, true));
test('needle moves right to left as usage grows', () => assert.ok(gaugeState({ usedPercentage: 60 }).angle < gaugeState({ usedPercentage: 20 }).angle));

import { valueColor } from '../public/gauge.mjs';
test('valueColor ramps red -> orange -> green and is lightened', () => {
  const rgb = (c) => c.match(/\d+/g).map(Number);
  const [r1, g1] = rgb(valueColor(5)); const [r2, g2] = rgb(valueColor(100));
  assert.ok(r1 > g1); assert.ok(g2 > r2);
  assert.notEqual(valueColor(35), valueColor(5));
  assert.ok(rgb(valueColor(5)).every((v) => v >= 89));
});
