'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { sessionView } = require('../src/shared/sessionView');

const M = 60000;
const limits = { cycleMs: 32 * M, lockMs: 3 * M };

test('working shows elapsed minutes and a rising level', () => {
  const v = sessionView({ phase: 'working', segStart: 0, now: 12 * M + 40000 }, limits);
  assert.equal(v.label, '這一段已經工作');
  assert.equal(v.value, '12');
  assert.equal(v.unit, '分');
  assert.equal(v.level, (12 * M + 40000) / (32 * M));
  assert.equal(v.tone, 'work');
});

test('an hour or more shows hours and minutes', () => {
  const v = sessionView({ phase: 'working', segStart: 0, now: 75 * M }, { cycleMs: 120 * M, lockMs: 3 * M });
  assert.equal(v.value, '1:15');
  assert.equal(v.unit, '');
});

test('reminder counts the same as working and the level never passes full', () => {
  const v = sessionView({ phase: 'reminder', segStart: 0, now: 40 * M }, limits);
  assert.equal(v.label, '這一段已經工作');
  assert.equal(v.level, 1);
});

test('locked shows rest time left with the cup refilling', () => {
  const v = sessionView({ phase: 'locked', lockUntil: 10 * M, now: 8 * M }, limits);
  assert.equal(v.label, '休息一下');
  assert.equal(v.value, '2:00');
  assert.ok(Math.abs(v.level - 1 / 3) < 1e-9);
  assert.equal(v.tone, 'rest');
});

test('Lock-in shows how long you have been focusing', () => {
  const v = sessionView({ phase: 'meeting', meetingStart: 0, now: 75 * M }, limits);
  assert.equal(v.label, 'Lock-in 專注中');
  assert.equal(v.value, '1:15');
  assert.equal(v.tone, 'meeting');
  assert.equal(v.level, 1);
});

test('the Lock-in wrap-up shows a wrap-up label', () => {
  const v = sessionView({ phase: 'focusWrap', now: 5 * M }, limits);
  assert.equal(v.label, 'Lock-in 結束，收尾中');
  assert.equal(v.tone, 'meeting');
});

test('away shows not counting yet', () => {
  const v = sessionView({ phase: 'away', now: 5 * M }, limits);
  assert.equal(v.label, '還沒開始計時');
  assert.equal(v.value, '');
  assert.equal(v.level, 0);
});

test('paused shows the time worked before you left', () => {
  const v = sessionView({ phase: 'paused', segStart: 0, idleFrom: 10 * M, now: 14 * M }, limits);
  assert.equal(v.label, '暫停計時');
  assert.equal(v.value, '10');
  assert.equal(v.unit, '分');
  assert.equal(v.level, 10 / 32);
  assert.equal(v.tone, 'paused');
});
