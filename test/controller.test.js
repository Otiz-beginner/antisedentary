'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createController } = require('../src/main/controller');

const S = 1000;
const M = 60 * S;
const config = { workMs: 29 * M, reminderMs: 3 * M, lockMs: 3 * M, idleResetMs: 3 * M };

function setup({ startLockThrows = false } = {}) {
  const calls = [];
  const clock = { t: 0, idle: 0 };
  const segments = [];
  const meetings = [];
  const locks = [];
  const db = {
    insertSegment: (s) => { segments.push(s); return segments.length; },
    insertMeeting: (m) => { meetings.push(m); return meetings.length; },
  };
  const ui = {
    showReminder: (a) => calls.push(['showReminder', a, clock.t]),
    hideReminder: () => calls.push(['hideReminder', clock.t]),
    showLock: (a) => calls.push(['showLock', a, clock.t]),
    hideLock: () => calls.push(['hideLock', clock.t]),
    setMeetingIndicator: (on) => calls.push(['meeting', on]),
  };
  const startLock = (opts) => {
    if (startLockThrows) throw new Error('lockhelper.exe not found');
    const handle = { opts, stopped: 0, stop() { this.stopped++; } };
    locks.push(handle);
    return handle;
  };
  const ctl = createController({ config, db, ui, startLock, host: 'pc', now: () => clock.t, getIdleMs: () => clock.idle });
  const advance = (until) => { while (clock.t < until) { clock.t += S; ctl.tick(); } };
  return { ctl, calls, clock, segments, meetings, locks, advance };
}

const names = (calls) => calls.map((c) => c[0]);

test('draft note attaches to the saved segment then clears', () => {
  const { ctl, clock, segments, advance } = setup();
  ctl.tick();
  advance(29 * M);
  ctl.setDraftNote('abc');
  ctl.dispatch({ type: 'meetingOn', now: clock.t });
  assert.equal(segments[0].note, 'abc');
  assert.equal(segments[0].host, 'pc');
  assert.equal(segments[0].endReason, 'meeting');
  ctl.dispatch({ type: 'meetingOff', now: clock.t });
  ctl.tick();
  ctl.dispatch({ type: 'startBreak', now: clock.t + S, source: 'tray' });
  assert.equal(segments[1].note, '');
});

test('note is trimmed', () => {
  const { ctl, clock, segments, advance } = setup();
  ctl.tick();
  advance(30 * M);
  ctl.setDraftNote('  跑完 CTS \n');
  ctl.dispatch({ type: 'startBreak', now: clock.t, source: 'card' });
  assert.equal(segments[0].note, '跑完 CTS');
});

test('lock effect shows lock and starts input lock with lockMs+5s cap', () => {
  const { ctl, calls, locks, advance } = setup();
  ctl.tick();
  advance(32 * M);
  const show = calls.find((c) => c[0] === 'showLock');
  assert.deepEqual(show[1], { startsAt: 32 * M, endsAt: 35 * M });
  assert.equal(locks.length, 1);
  assert.equal(locks[0].opts.maxSeconds, 185);
  assert.equal(ctl.phase, 'locked');
});

test('unlock stops input lock and hides lock window', () => {
  const { ctl, calls, locks, advance } = setup();
  ctl.tick();
  advance(35 * M);
  assert.equal(locks[0].stopped, 1);
  assert.deepEqual(calls.find((c) => c[0] === 'hideLock'), ['hideLock', 35 * M]);
  assert.equal(ctl.phase, 'away');
});

test('meeting hotkey from helper unlocks and enables meeting indicator', () => {
  const { ctl, calls, locks, advance } = setup();
  ctl.tick();
  advance(33 * M);
  locks[0].opts.onMeetingHotkey();
  assert.equal(ctl.phase, 'meeting');
  assert.equal(ctl.inMeeting, true);
  assert.equal(locks[0].stopped, 1);
  assert.ok(names(calls).includes('hideLock'));
  assert.deepEqual(calls.at(-1), ['meeting', true]);
});

test('meetingOff turns meeting indicator off and saves the meeting', () => {
  const { ctl, calls, meetings } = setup();
  ctl.dispatch({ type: 'meetingOn', now: 0 });
  ctl.dispatch({ type: 'meetingOff', now: 10 * M });
  assert.deepEqual(calls.filter((c) => c[0] === 'meeting'), [['meeting', true], ['meeting', false]]);
  assert.deepEqual(meetings, [{ startedAt: 0, endedAt: 10 * M, host: 'pc' }]);
});

test('startLock throwing still shows lock window', () => {
  const { ctl, calls, advance } = setup({ startLockThrows: true });
  const origError = console.error;
  console.error = () => {};
  try {
    ctl.tick();
    advance(35 * M);
  } finally {
    console.error = origError;
  }
  assert.ok(names(calls).includes('showLock'));
  assert.ok(names(calls).includes('hideLock'));
});

test('full cycle at speed: reminder at 29m, lock at 32m, unlock at 35m', () => {
  const { ctl, calls, segments, advance } = setup();
  ctl.tick();
  advance(36 * M);
  const when = (n) => calls.find((c) => c[0] === n).at(-1);
  assert.equal(when('showReminder'), 29 * M);
  assert.deepEqual(calls.find((c) => c[0] === 'showReminder')[1], { startsAt: 29 * M, endsAt: 32 * M });
  assert.equal(when('hideReminder'), 32 * M);
  assert.equal(when('showLock'), 32 * M);
  assert.equal(when('hideLock'), 35 * M);
  assert.deepEqual(segments, [{ startedAt: 0, endedAt: 32 * M, endReason: 'timeout', note: '', host: 'pc' }]);
});

test('a draft arriving after the segment was saved does not leak into the next segment', () => {
  const { ctl, segments, advance } = setup();
  ctl.tick();
  advance(30 * M);
  ctl.setDraftNote('寫到一半');
  advance(32 * M);                 // 時間到，存下這一段
  ctl.setDraftNote('寫到一半的最後幾個字'); // debounce 晚到的草稿
  advance(36 * M);                 // 解鎖後開始下一段
  ctl.dispatch({ type: 'startBreak', now: 36 * M + S, source: 'tray' });
  assert.equal(segments[0].note, '寫到一半');
  assert.equal(segments[1].note, '');
});

test('quit is idempotent', () => {
  const { ctl, clock, segments } = setup();
  ctl.tick();
  clock.t = 5 * M;
  ctl.quit();
  ctl.quit();
  assert.equal(segments.length, 1);
  assert.equal(segments[0].endReason, 'quit');
});

test('status reports the current phase, segment start and clock', () => {
  const { ctl, clock, advance } = setup();
  clock.t = 5 * S;
  ctl.tick();
  advance(10 * M);
  assert.deepEqual(ctl.status(), { phase: 'working', segStart: 5 * S, now: 10 * M });
  advance(33 * M);
  assert.deepEqual(ctl.status(), { phase: 'locked', lockUntil: 32 * M + 5 * S + 3 * M, now: 33 * M });
});

test('question card shows on return and the answer hides it', () => {
  const calls = [];
  const clock = { t: 0, idle: 0 };
  const segments = [];
  const ctl = createController({
    config: { ...config, askMaxMs: 30 * M, askTimeoutMs: 60 * S },
    db: { insertSegment: (s) => segments.push(s), insertMeeting() {} },
    ui: {
      showReminder() {}, hideReminder() {}, showLock() {}, hideLock() {}, setMeetingIndicator() {},
      showQuestion: (a) => calls.push(['showQuestion', a]),
      hideQuestion: () => calls.push(['hideQuestion']),
    },
    startLock: () => ({ stop() {} }), host: 'pc', now: () => clock.t, getIdleMs: () => clock.idle,
  });
  ctl.tick();
  while (clock.t < 10 * M) { clock.t += S; ctl.tick(); }
  while (clock.t < 14 * M) { clock.t += S; clock.idle = clock.t - 10 * M; ctl.tick(); }
  assert.equal(ctl.status().phase, 'paused');
  assert.equal(ctl.status().idleFrom, 10 * M);
  clock.t += S; clock.idle = 0; ctl.tick();
  assert.deepEqual(calls, [['showQuestion', { startsAt: 14 * M + S, endsAt: 15 * M + S }]]);
  ctl.answer(true);
  assert.deepEqual(calls.at(-1), ['hideQuestion']);
  assert.deepEqual(segments.map((s) => [s.startedAt, s.endedAt, s.endReason]), [[0, 10 * M, 'idle']]);
});
