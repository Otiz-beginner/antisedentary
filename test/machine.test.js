'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { initialState, step } = require('../src/core/machine');

const S = 1000;
const M = 60 * S;
const config = { workMs: 29 * M, reminderMs: 3 * M, lockMs: 3 * M, idleResetMs: 3 * M, askMaxMs: 30 * M, askTimeoutMs: 60 * S };

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

// 最後一次輸入在 lastInput，之後每秒 tick 一次直到 until（含）
function ticksIdleSince(lastInput, from, until) {
  const out = [];
  for (let t = from; t <= until; t += S) out.push(tick(t, t - lastInput));
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

test('idle 3 minutes during working pauses without saving', () => {
  const working = run(ticksActive(0, 10 * M)).state;
  const { state, effects } = run(ticksIdleSince(10 * M, 10 * M + S, 13 * M), working);
  assert.equal(state.phase, 'paused');
  assert.equal(state.segStart, 0);
  assert.equal(state.idleFrom, 10 * M);
  assert.deepEqual(effects, []);
});

test('idle 2.5 minutes keeps counting', () => {
  const working = run(ticksActive(0, 9.5 * M)).state;
  const { state, effects } = run(ticksIdleSince(9.5 * M, 9.5 * M + S, 12 * M), working);
  assert.equal(state.phase, 'working');
  assert.equal(state.segStart, 0);
  assert.deepEqual(effects, []);
});

test('idle reaching 3 minutes during reminder hides card and pauses, no lock', () => {
  const reminder = run(ticksActive(0, 29 * M)).state;
  const { state, effects } = run([tick(31.5 * M, 3 * M)], reminder);
  assert.equal(state.phase, 'paused');
  assert.equal(state.idleFrom, 28.5 * M);
  assert.deepEqual(types(effects), ['hideReminder']);
});

test('idle wins when idle and timeout coincide', () => {
  const reminder = run(ticksActive(0, 29 * M)).state;
  const { state, effects } = run(ticksIdleSince(29 * M, 29 * M + S, 32 * M), reminder);
  assert.equal(state.phase, 'paused');
  assert.ok(!types(effects).includes('lock'));
});

test('paused never reminds or locks', () => {
  const working = run(ticksActive(0, 20 * M)).state;
  const { state, effects } = run(ticksIdleSince(20 * M, 20 * M + S, 45 * M), working);
  assert.equal(state.phase, 'paused');
  assert.deepEqual(effects, []);
});

// 10 分鐘開始離開，14 分鐘時已經暫停
const pausedAt14 = () => run(ticksIdleSince(10 * M, 10 * M + S, 14 * M), run(ticksActive(0, 10 * M)).state).state;

test('returning within 30 minutes asks and keeps counting', () => {
  const { state, effects } = run([tick(15 * M, 0)], pausedAt14());
  assert.equal(state.phase, 'working');
  assert.equal(state.segStart, 0);
  assert.deepEqual(effects, [{ type: 'showQuestion', startsAt: 15 * M, endsAt: 16 * M }]);
});

test('answering stood up saves the idle segment and restarts at the return', () => {
  const asking = run([tick(15 * M, 0)], pausedAt14()).state;
  const { state, effects } = run([{ type: 'answer', now: 15 * M + 5 * S, stood: true }], asking);
  assert.deepEqual(effects, [
    { type: 'hideQuestion' },
    { type: 'saveSegment', startedAt: 0, endedAt: 10 * M, endReason: 'idle' },
  ]);
  assert.equal(state.phase, 'working');
  assert.equal(state.segStart, 15 * M);
  assert.equal(state.ask, undefined);
});

test('answering still sitting keeps the segment going', () => {
  const asking = run([tick(15 * M, 0)], pausedAt14()).state;
  const { state, effects } = run([{ type: 'answer', now: 15 * M + 5 * S, stood: false }], asking);
  assert.deepEqual(effects, [{ type: 'hideQuestion' }]);
  assert.equal(state.segStart, 0);
  assert.equal(state.ask, undefined);
});

test('no answer within a minute counts as still sitting', () => {
  const asking = run([tick(15 * M, 0)], pausedAt14()).state;
  const { state, effects } = run(ticksActive(15 * M + S, 16 * M), asking);
  assert.deepEqual(effects, [{ type: 'hideQuestion' }]);
  assert.equal(state.segStart, 0);
  assert.equal(state.ask, undefined);
});

test('answer when no question is showing is ignored', () => {
  const working = run(ticksActive(0, 5 * M)).state;
  const { state, effects } = run([{ type: 'answer', now: 5 * M, stood: true }], working);
  assert.deepEqual(state, working);
  assert.deepEqual(effects, []);
});

test('sitting through past 32 minutes gets a full reminder instead of an instant lock', () => {
  const paused = run(ticksIdleSince(28 * M, 28 * M + S, 33 * M), run(ticksActive(0, 28 * M)).state).state;
  const asking = run([tick(33 * M, 0)], paused).state;
  // 問題卡還在的時候不提醒
  const during = run(ticksActive(33 * M + S, 33 * M + 30 * S), asking);
  assert.ok(!types(during.effects).includes('showReminder'));
  const sitting = run([{ type: 'answer', now: 33.5 * M, stood: false }], during.state).state;
  const { state, effects } = run([tick(33.5 * M + S, 0)], sitting);
  assert.equal(state.phase, 'reminder');
  assert.deepEqual(effects, [{ type: 'showReminder', startsAt: 33.5 * M + S, endsAt: 36.5 * M + S }]);
  const later = run(ticksActive(33.5 * M + 2 * S, 36.5 * M), state);
  assert.equal(later.state.phase, 'reminder');
  assert.equal(run([tick(36.5 * M + S, 0)], later.state).state.phase, 'locked');
});

test('paused for 30 minutes counts as a break without asking', () => {
  const working = run(ticksActive(0, 10 * M)).state;
  const { state, effects } = run(ticksIdleSince(10 * M, 10 * M + S, 40 * M), working);
  assert.equal(state.phase, 'away');
  assert.deepEqual(effects, [{ type: 'saveSegment', startedAt: 0, endedAt: 10 * M, endReason: 'idle' }]);
  const back = run([tick(40 * M + S, 0)], state);
  assert.equal(back.state.phase, 'working');
  assert.ok(!types(back.effects).includes('showQuestion'));
});

test('meetingOn while paused saves the segment ending when you left', () => {
  const { state, effects } = run([{ type: 'meetingOn', now: 14 * M }], pausedAt14());
  assert.equal(state.phase, 'meeting');
  assert.deepEqual(effects, [{ type: 'saveSegment', startedAt: 0, endedAt: 10 * M, endReason: 'meeting' }]);
});

test('meetingOn while the question shows hides it and saves', () => {
  const asking = run([tick(15 * M, 0)], pausedAt14()).state;
  const { effects } = run([{ type: 'meetingOn', now: 15 * M + S }], asking);
  assert.deepEqual(types(effects), ['hideQuestion', 'saveSegment']);
});

test('tray break while paused saves the segment ending when you left and locks', () => {
  const { state, effects } = run([{ type: 'startBreak', now: 14 * M, source: 'tray' }], pausedAt14());
  assert.equal(state.phase, 'locked');
  assert.deepEqual(effects[0], { type: 'saveSegment', startedAt: 0, endedAt: 10 * M, endReason: 'tray' });
});

test('quit while paused saves the segment ending when you left', () => {
  assert.deepEqual(run([{ type: 'quit', now: 14 * M }], pausedAt14()).effects,
    [{ type: 'saveSegment', startedAt: 0, endedAt: 10 * M, endReason: 'quit' }]);
});

test('sleep while paused ends the segment as idle when you left', () => {
  const { state, effects } = run([tick(60 * M, 0)], pausedAt14());
  assert.equal(find(effects, 'saveSegment').endedAt, 10 * M);
  assert.equal(state.phase, 'away');
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

// ---------- Lock-in 專注模式（內部沿用 meeting 這個名字） ----------
const focusAt = (start) => run([{ type: 'meetingOn', now: start }]).state;

test('ending Lock-in shows the wrap-up card for the wrap-up time', () => {
  const { state, effects } = run([{ type: 'meetingOff', now: 70 * M }], focusAt(10 * M));
  assert.equal(state.phase, 'focusWrap');
  assert.deepEqual(effects, [{ type: 'showReminder', startsAt: 70 * M, endsAt: 73 * M, kind: 'focus' }]);
});

test('when the wrap-up water runs out the focus session is saved and the break starts', () => {
  const wrap = run([{ type: 'meetingOff', now: 70 * M }], focusAt(10 * M)).state;
  const { state, effects } = run(ticksActive(70 * M + S, 73 * M), wrap);
  assert.equal(state.phase, 'locked');
  assert.deepEqual(effects, [
    { type: 'hideReminder' },
    { type: 'saveSegment', startedAt: 10 * M, endedAt: 70 * M, endReason: 'focus' },
    { type: 'lock', startsAt: 73 * M, endsAt: 76 * M },
  ]);
});

test('starting the break from the wrap-up card saves focus and locks at once', () => {
  const wrap = run([{ type: 'meetingOff', now: 70 * M }], focusAt(10 * M)).state;
  const { state, effects } = run([{ type: 'startBreak', now: 71 * M, source: 'card' }], wrap);
  assert.equal(state.phase, 'locked');
  assert.deepEqual(types(effects), ['hideReminder', 'saveSegment', 'lock']);
  assert.equal(find(effects, 'saveSegment').endReason, 'focus');
  assert.equal(find(effects, 'saveSegment').endedAt, 70 * M);
});

test('pressing Lock-in again during the wrap-up goes back to the same focus session', () => {
  const wrap = run([{ type: 'meetingOff', now: 70 * M }], focusAt(10 * M)).state;
  const { state, effects } = run([{ type: 'meetingOn', now: 71 * M }], wrap);
  assert.equal(state.phase, 'meeting');
  assert.equal(state.meetingStart, 10 * M);
  assert.deepEqual(effects, [{ type: 'hideReminder' }]);
});

test('walking away during the wrap-up saves focus without locking an empty desk', () => {
  const wrap = run([{ type: 'meetingOff', now: 70 * M }], focusAt(10 * M)).state;
  const { state, effects } = run(ticksIdleSince(70 * M, 70 * M + S, 73 * M), wrap);
  assert.equal(state.phase, 'away');
  assert.deepEqual(types(effects), ['hideReminder', 'saveSegment']);
  assert.ok(!types(effects).includes('lock'));
});

test('Lock-in has no work-length limit', () => {
  const { state, effects } = run(ticksActive(S, 3 * 60 * M, 30 * S), focusAt(0));
  assert.equal(state.phase, 'meeting');
  assert.deepEqual(effects, []);
});

test('quitting during the wrap-up saves the focus session', () => {
  const wrap = run([{ type: 'meetingOff', now: 70 * M }], focusAt(10 * M)).state;
  const { effects } = run([{ type: 'quit', now: 71 * M }], wrap);
  assert.deepEqual(effects, [{ type: 'hideReminder' }, { type: 'saveSegment', startedAt: 10 * M, endedAt: 70 * M, endReason: 'focus' }]);
});

test('sleeping through the wrap-up saves focus and does not lock on wake', () => {
  const wrap = run([{ type: 'meetingOff', now: 70 * M }], focusAt(10 * M)).state;
  const { state, effects } = run([tick(70 * M + S, 0), { type: 'suspend', now: 71 * M }, { type: 'resume', now: 90 * M }, tick(90 * M + S, 0)], wrap);
  assert.ok(!types(effects).includes('lock'));
  assert.equal(find(effects, 'saveSegment').endReason, 'focus');
  assert.notEqual(state.phase, 'locked');
});

test('the early-break, escape and answer inputs do nothing during the wrap-up', () => {
  const wrap = run([{ type: 'meetingOff', now: 70 * M }], focusAt(10 * M)).state;
  for (const input of [{ type: 'escape', now: 71 * M }, { type: 'answer', now: 71 * M, stood: true }, { type: 'meetingOff', now: 71 * M }]) {
    const out = run([input], wrap);
    assert.deepEqual(out.effects, [], input.type);
    assert.equal(out.state.phase, 'focusWrap', input.type);
  }
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

test('quit during Lock-in saves the focus session; quit while locked unlocks', () => {
  const meeting = run([{ type: 'meetingOn', now: 0 }]).state;
  assert.deepEqual(run([{ type: 'quit', now: 5 * M }], meeting).effects, [{ type: 'saveSegment', startedAt: 0, endedAt: 5 * M, endReason: 'focus' }]);
  const locked = run(ticksActive(0, 32 * M)).state;
  assert.deepEqual(types(run([{ type: 'quit', now: 33 * M }], locked).effects), ['unlock']);
});

test('tick after a long gap without resume ends segment as idle at last tick', () => {
  // 睡眠醒來時 tick 可能比 resume 事件先到；喚醒用的按鍵讓 idleMs 接近 0
  const reminder = run(ticksActive(0, 30 * M)).state;
  const { state, effects } = run([tick(90 * M, 0)], reminder);
  assert.equal(state.phase, 'away');
  assert.ok(!types(effects).includes('lock'));
  assert.deepEqual(types(effects), ['hideReminder', 'saveSegment']);
  assert.deepEqual(find(effects, 'saveSegment'), { type: 'saveSegment', startedAt: 0, endedAt: 30 * M, endReason: 'idle' });
});

test('tick after a long gap while working does not show the reminder', () => {
  const working = run(ticksActive(0, 10 * M)).state;
  const { state, effects } = run([tick(70 * M, 0)], working);
  assert.equal(state.phase, 'away');
  assert.deepEqual(effects, [{ type: 'saveSegment', startedAt: 0, endedAt: 10 * M, endReason: 'idle' }]);
});

test('escape while locked unlocks and waits for the next input', () => {
  const locked = run(ticksActive(0, 32 * M)).state;
  const { state, effects } = run([{ type: 'escape', now: 33 * M }], locked);
  assert.equal(state.phase, 'away');
  assert.equal(state.since, 33 * M);
  assert.deepEqual(effects, [{ type: 'unlock' }]);
  const back = run([tick(33 * M + 2 * S, 0)], state).state;
  assert.equal(back.phase, 'working');
  assert.equal(back.segStart, 33 * M + 2 * S);
});

test('escape outside a lock does nothing', () => {
  for (const state of [
    initialState(),
    run(ticksActive(0, 5 * M)).state,
    run(ticksActive(0, 30 * M)).state,
    run([{ type: 'meetingOn', now: 0 }]).state,
  ]) {
    const out = run([{ type: 'escape', now: 40 * M }], state);
    assert.deepEqual(out.state, state);
    assert.deepEqual(out.effects, []);
  }
});

test('whole-second idle times never make a paused segment end before it starts', () => {
  // Windows 只回報整秒的閒置時間：開始計時時 idleMs=0，0.4 秒後回報的「最後輸入」可能落在開始之前
  const working = run([tick(10 * S + 400, 0)]).state; // segStart = 10.4s
  const { state, effects } = run(ticksIdleSince(10 * S, 11 * S, 10 * S + 3 * M), working);
  assert.equal(state.phase, 'paused');
  assert.ok(state.idleFrom >= state.segStart);
  const later = run(ticksIdleSince(10 * S, 10 * S + 3 * M + S, 10 * S + 31 * M), state);
  for (const e of [...effects, ...later.effects].filter((x) => x.type === 'saveSegment')) assert.ok(e.endedAt >= e.startedAt);
});
