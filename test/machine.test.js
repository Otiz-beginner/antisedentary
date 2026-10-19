'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { initialState, step } = require('../src/core/machine');

const S = 1000;
const M = 60 * S;
const config = { workMs: 29 * M, reminderMs: 3 * M, lockMs: 3 * M, idleResetMs: 3 * M };

function run(inputs, state = initialState()) {
  const effects = [];
  for (const input of inputs) {
    const out = step(state, input, config);
    state = out.state;
    effects.push(...out.effects);
  }
  return { state, effects };
}

const tick = (now, idleMs = 0) => ({ type: 'tick', now, idleMs });
const types = (effects) => effects.map((e) => e.type);
const find = (effects, type) => effects.find((e) => e.type === type);

// 從 t0 開始持續有輸入，一直跑到 until（含）
function ticksActive(t0, until, every = S) {
  const out = [];
  for (let t = t0; t <= until; t += every) out.push(tick(t, 0));
  return out;
}

test('first input starts a segment at last-input time', () => {
  const { state, effects } = run([tick(10 * S, 2 * S)]);
  assert.equal(state.phase, 'working');
  assert.equal(state.segStart, 8 * S);
  assert.deepEqual(effects, []);
});

test('reminder shows at 29:00 with endsAt 32:00', () => {
  const { state, effects } = run(ticksActive(0, 29 * M));
  assert.equal(state.phase, 'reminder');
  assert.deepEqual(find(effects, 'showReminder'), { type: 'showReminder', startsAt: 29 * M, endsAt: 32 * M });
});

test('locks at 32:00 and saves timeout segment', () => {
  const { state, effects } = run(ticksActive(0, 32 * M));
  assert.equal(state.phase, 'locked');
  assert.deepEqual(types(effects), ['showReminder', 'hideReminder', 'saveSegment', 'lock']);
  assert.deepEqual(find(effects, 'saveSegment'), { type: 'saveSegment', startedAt: 0, endedAt: 32 * M, endReason: 'timeout' });
  assert.deepEqual(find(effects, 'lock'), { type: 'lock', startsAt: 32 * M, endsAt: 35 * M });
});

test('unlocks after 3 minutes then waits for input', () => {
  const locked = run(ticksActive(0, 32 * M)).state;
  const { state, effects } = run([tick(34 * M, 0), tick(35 * M, 3 * M)], locked);
  assert.equal(state.phase, 'away');
  assert.deepEqual(types(effects), ['unlock']);
});

test('input from before unlock does not start a segment', () => {
  const locked = run(ticksActive(0, 32 * M)).state;
  const away = run([tick(35 * M, 3 * M)], locked).state;
  // 最後一次輸入在解鎖之前（鎖定中），不算回來工作
  const { state } = run([tick(35 * M + 2 * S, 10 * S)], away);
  assert.equal(state.phase, 'away');
});

test('first input after unlock starts the segment at that input', () => {
  const locked = run(ticksActive(0, 32 * M)).state;
  const away = run([tick(35 * M, 3 * M)], locked).state;
  const { state } = run([tick(35 * M + 5 * S, 1 * S)], away);
  assert.equal(state.phase, 'working');
  assert.equal(state.segStart, 35 * M + 4 * S);
});

test('saved idle segment never ends before it starts', () => {
  const locked = run(ticksActive(0, 32 * M)).state;
  const away = run([tick(35 * M, 3 * M)], locked).state;
  const { effects } = run([tick(35 * M + 2 * S, 10 * S), tick(38 * M + 2 * S, 3 * M + 10 * S)], away);
  for (const e of effects.filter((x) => x.type === 'saveSegment')) assert.ok(e.endedAt >= e.startedAt);
});

test('idle 3 minutes during working ends segment at last input', () => {
  const working = run([tick(0, 0)]).state;
  const { state, effects } = run([tick(13 * M, 3 * M)], working);
  assert.equal(state.phase, 'away');
  assert.deepEqual(effects, [{ type: 'saveSegment', startedAt: 0, endedAt: 10 * M, endReason: 'idle' }]);
});

test('idle 2.5 minutes keeps counting', () => {
  const working = run([tick(0, 0)]).state;
  const { state, effects } = run([tick(12 * M, 2.5 * M)], working);
  assert.equal(state.phase, 'working');
  assert.equal(state.segStart, 0);
  assert.deepEqual(effects, []);
});

test('idle reaching 3 minutes during reminder hides card, no lock', () => {
  const reminder = run(ticksActive(0, 29 * M)).state;
  const { state, effects } = run([tick(31.5 * M, 3 * M)], reminder);
  assert.equal(state.phase, 'away');
  assert.deepEqual(types(effects), ['hideReminder', 'saveSegment']);
  assert.equal(find(effects, 'saveSegment').endedAt, 28.5 * M);
  assert.equal(find(effects, 'saveSegment').endReason, 'idle');
});

test('idle wins when idle and timeout coincide', () => {
  const reminder = run(ticksActive(0, 29 * M)).state;
  const { state, effects } = run([tick(32 * M, 3 * M)], reminder);
  assert.equal(state.phase, 'away');
  assert.ok(!types(effects).includes('lock'));
  assert.equal(find(effects, 'saveSegment').endReason, 'idle');
});

test('card startBreak locks immediately with reason card', () => {
  const reminder = run(ticksActive(0, 30 * M)).state;
  const { state, effects } = run([{ type: 'startBreak', now: 30 * M + 5 * S, source: 'card' }], reminder);
  assert.equal(state.phase, 'locked');
  assert.deepEqual(types(effects), ['hideReminder', 'saveSegment', 'lock']);
  assert.equal(find(effects, 'saveSegment').endReason, 'card');
  assert.deepEqual(find(effects, 'lock'), { type: 'lock', startsAt: 30 * M + 5 * S, endsAt: 33 * M + 5 * S });
});

test('tray startBreak from working saves reason tray', () => {
  const working = run([tick(0, 0)]).state;
  const { effects } = run([{ type: 'startBreak', now: 5 * M, source: 'tray' }], working);
  assert.deepEqual(types(effects), ['saveSegment', 'lock']);
  assert.equal(find(effects, 'saveSegment').endReason, 'tray');
});

test('tray startBreak from away locks without saving', () => {
  const { state, effects } = run([{ type: 'startBreak', now: 5 * M, source: 'tray' }]);
  assert.equal(state.phase, 'locked');
  assert.deepEqual(types(effects), ['lock']);
});

test('startBreak while locked is ignored', () => {
  const locked = run(ticksActive(0, 32 * M)).state;
  const { state, effects } = run([{ type: 'startBreak', now: 33 * M, source: 'tray' }], locked);
  assert.deepEqual(state, locked);
  assert.deepEqual(effects, []);
});

test('meetingOn during reminder saves segment reason meeting', () => {
  const reminder = run(ticksActive(0, 30 * M)).state;
  const { state, effects } = run([{ type: 'meetingOn', now: 30 * M }], reminder);
  assert.equal(state.phase, 'meeting');
  assert.equal(state.meetingStart, 30 * M);
  assert.deepEqual(types(effects), ['hideReminder', 'saveSegment']);
  assert.deepEqual(find(effects, 'saveSegment'), { type: 'saveSegment', startedAt: 0, endedAt: 30 * M, endReason: 'meeting' });
});

test('meetingOn while locked unlocks', () => {
  const locked = run(ticksActive(0, 32 * M)).state;
  const { state, effects } = run([{ type: 'meetingOn', now: 33 * M }], locked);
  assert.equal(state.phase, 'meeting');
  assert.deepEqual(types(effects), ['unlock']);
});

test('meetingOn from away just enters meeting', () => {
  const { state, effects } = run([{ type: 'meetingOn', now: 5 * M }]);
  assert.equal(state.phase, 'meeting');
  assert.deepEqual(effects, []);
});

test('meeting mode never reminds or locks', () => {
  const meeting = run([{ type: 'meetingOn', now: 0 }]).state;
  const inputs = ticksActive(S, 120 * M, 10 * S);
  inputs.push({ type: 'startBreak', now: 60 * M, source: 'tray' });
  const { state, effects } = run(inputs, meeting);
  assert.equal(state.phase, 'meeting');
  assert.deepEqual(effects, []);
});

test('meetingOff saves meeting and returns to away', () => {
  const meeting = run([{ type: 'meetingOn', now: 10 * M }]).state;
  const { state, effects } = run([{ type: 'meetingOff', now: 70 * M }], meeting);
  assert.equal(state.phase, 'away');
  assert.equal(state.since, 70 * M);
  assert.deepEqual(effects, [{ type: 'saveMeeting', startedAt: 10 * M, endedAt: 70 * M }]);
});

test('resume after long suspend during reminder ends segment as idle', () => {
  const reminder = run(ticksActive(0, 30 * M)).state;
  const { state, effects } = run([{ type: 'suspend', now: 30 * M }, { type: 'resume', now: 40 * M }], reminder);
  assert.equal(state.phase, 'away');
  assert.deepEqual(types(effects), ['hideReminder', 'saveSegment']);
  assert.deepEqual(find(effects, 'saveSegment'), { type: 'saveSegment', startedAt: 0, endedAt: 30 * M, endReason: 'idle' });
});

test('resume after short suspend keeps counting', () => {
  const working = run(ticksActive(0, 10 * M)).state;
  const { state, effects } = run([{ type: 'suspend', now: 10 * M }, { type: 'resume', now: 12 * M }], working);
  assert.equal(state.phase, 'working');
  assert.equal(state.segStart, 0);
  assert.equal(state.suspendAt, undefined);
  assert.deepEqual(effects, []);
});

test('lock still ends after suspend', () => {
  const locked = run(ticksActive(0, 32 * M)).state;
  const { state, effects } = run([
    { type: 'suspend', now: 33 * M },
    { type: 'resume', now: 40 * M },
    tick(40 * M + S, 0),
  ], locked);
  assert.equal(state.phase, 'away');
  assert.deepEqual(types(effects), ['unlock']);
});

test('quit during working saves quit segment', () => {
  const working = run([tick(0, 0)]).state;
  const { effects } = run([{ type: 'quit', now: 7 * M }], working);
  assert.deepEqual(effects, [{ type: 'saveSegment', startedAt: 0, endedAt: 7 * M, endReason: 'quit' }]);
});

test('quit during meeting saves meeting; quit while locked unlocks', () => {
  const meeting = run([{ type: 'meetingOn', now: 0 }]).state;
  assert.deepEqual(run([{ type: 'quit', now: 5 * M }], meeting).effects, [{ type: 'saveMeeting', startedAt: 0, endedAt: 5 * M }]);
  const locked = run(ticksActive(0, 32 * M)).state;
  assert.deepEqual(types(run([{ type: 'quit', now: 33 * M }], locked).effects), ['unlock']);
});
