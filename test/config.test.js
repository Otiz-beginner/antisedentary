'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { getConfig } = require('../src/core/config');

test('default config uses spec minutes', () => {
  const c = getConfig({});
  assert.equal(c.workMs, 29 * 60000);
  assert.equal(c.reminderMs, 3 * 60000);
  assert.equal(c.lockMs, 3 * 60000);
  assert.equal(c.idleResetMs, 3 * 60000);
  assert.equal(c.shortIdleSegmentMs, 5 * 60000);
  assert.equal(c.tickMs, 1000);
  assert.equal(c.speed, 1);
});

test('ANTISEDENTARY_SPEED divides durations', () => {
  const c = getConfig({ ANTISEDENTARY_SPEED: '60' });
  assert.equal(c.workMs, 29000);
  assert.equal(c.lockMs, 3000);
  assert.equal(c.speed, 60);
});

test('invalid speed falls back to 1', () => {
  assert.equal(getConfig({ ANTISEDENTARY_SPEED: 'abc' }).speed, 1);
  assert.equal(getConfig({ ANTISEDENTARY_SPEED: '0' }).speed, 1);
});
