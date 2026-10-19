'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { DEFAULTS, FIELDS, validate, toConfig } = require('../src/core/settings');

const M = 60000;

test('defaults match the original timings', () => {
  assert.deepEqual(DEFAULTS, {
    cycleMinutes: 32, reminderMinutes: 3, restMinutes: 3,
    idlePauseMinutes: 3, askMaxMinutes: 30, askTimeoutSeconds: 60,
  });
});

test('every field has a label, unit and range', () => {
  for (const key of Object.keys(DEFAULTS)) {
    const f = FIELDS.find((x) => x.key === key);
    assert.ok(f, key);
    assert.ok(f.label && f.unit && f.min < f.max, key);
  }
});

test('toConfig turns default settings into the original config', () => {
  const c = toConfig(DEFAULTS, 1);
  assert.equal(c.workMs, 29 * M);
  assert.equal(c.reminderMs, 3 * M);
  assert.equal(c.lockMs, 3 * M);
  assert.equal(c.idleResetMs, 3 * M);
  assert.equal(c.askMaxMs, 30 * M);
  assert.equal(c.askTimeoutMs, 60000);
  assert.equal(c.shortIdleSegmentMs, 5 * M);
  assert.equal(c.tickMs, 1000);
});

test('toConfig applies the speed factor', () => {
  const c = toConfig({ ...DEFAULTS, cycleMinutes: 50, reminderMinutes: 5 }, 60);
  assert.equal(c.workMs, 45000);
  assert.equal(c.reminderMs, 5000);
});

test('valid settings pass and numbers given as text are accepted', () => {
  const r = validate({ ...DEFAULTS, cycleMinutes: '45' });
  assert.equal(r.ok, true);
  assert.equal(r.value.cycleMinutes, 45);
});

test('out of range values are rejected with a message per field', () => {
  const r = validate({ ...DEFAULTS, restMinutes: 11, idlePauseMinutes: 0 });
  assert.equal(r.ok, false);
  assert.ok(r.errors.restMinutes);
  assert.ok(r.errors.idlePauseMinutes);
});

test('rest cannot exceed the 10 minute lock safety cap', () => {
  const rest = FIELDS.find((f) => f.key === 'restMinutes');
  assert.equal(rest.max, 10);
});

test('non numbers are rejected', () => {
  assert.equal(validate({ ...DEFAULTS, cycleMinutes: 'abc' }).ok, false);
  assert.equal(validate({ ...DEFAULTS, cycleMinutes: 2.5 }).ok, false);
});

test('cycle must leave at least 5 minutes before the wrap-up time', () => {
  const r = validate({ ...DEFAULTS, cycleMinutes: 12, reminderMinutes: 8 });
  assert.equal(r.ok, false);
  assert.ok(r.errors.cycleMinutes);
});

test('phone limit must be longer than the pause threshold', () => {
  const r = validate({ ...DEFAULTS, idlePauseMinutes: 10, askMaxMinutes: 10 });
  assert.equal(r.ok, false);
  assert.ok(r.errors.askMaxMinutes);
});

test('missing fields fall back to defaults', () => {
  const r = validate({ cycleMinutes: 40 });
  assert.equal(r.ok, true);
  assert.deepEqual(r.value, { ...DEFAULTS, cycleMinutes: 40 });
});
