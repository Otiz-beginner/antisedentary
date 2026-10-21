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
    showQuestion: (a) => calls.push(['showQuestion', a, clock.t]),
    hideQuestion: () => calls.push(['hideQuestion', clock.t]),
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

test('ending Lock-in turns the indicator off and shows the wrap-up card', () => {
  const { ctl, calls, meetings } = setup();
  ctl.dispatch({ type: 'meetingOn', now: 0 });
  ctl.dispatch({ type: 'meetingOff', now: 10 * M });
  assert.deepEqual(calls.filter((c) => c[0] === 'meeting'), [['meeting', true], ['meeting', false]]);
  assert.deepEqual(calls.at(-2), ['showReminder', { startsAt: 10 * M, endsAt: 13 * M, note: '', kind: 'focus' }, 0]);
  assert.deepEqual(meetings, []);
});

test('the note on the Lock-in wrap-up card is saved with the focus session, then the break starts', () => {
  const { ctl, clock, segments, locks } = setup();
  ctl.dispatch({ type: 'meetingOn', now: 0 });
  clock.t = 50 * M;
  ctl.dispatch({ type: 'meetingOff', now: clock.t });
  ctl.setDraftNote('專注完成 floorplan');
  while (clock.t < 53 * M) { clock.t += S; ctl.tick(); }
  assert.equal(ctl.phase, 'locked');
  assert.deepEqual(segments, [{ startedAt: 0, endedAt: 50 * M, endReason: 'focus', note: '專注完成 floorplan', host: 'pc' }]);
  assert.equal(locks.length, 1);
});

test('status reports the Lock-in start so the dashboard can show elapsed focus time', () => {
  const { ctl, clock } = setup();
  ctl.dispatch({ type: 'meetingOn', now: 0 });
  clock.t = 25 * M;
  assert.deepEqual(ctl.status(), { phase: 'meeting', meetingStart: 0, now: 25 * M });
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
  assert.deepEqual(calls.find((c) => c[0] === 'showReminder')[1], { startsAt: 29 * M, endsAt: 32 * M, note: '', kind: 'reminder' });
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
    config: { ...config, askTimeoutMs: 60 * S },
    db: { insertSegment: (s) => segments.push(s), insertMeeting() {}, insertBreak: () => 1 },
    ui: {
      showReminder() {}, hideReminder() {}, showLock() {}, hideLock() {}, setMeetingIndicator() {},
      showQuestion: (a) => calls.push(['showQuestion', a]),
      hideQuestion: () => calls.push(['hideQuestion']),
      showReturnCard() {},
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

test('setConfig applies new timings to the running segment', () => {
  const { ctl, calls, locks, advance } = setup();
  ctl.tick();
  advance(10 * M);
  ctl.setConfig({ ...config, workMs: 12 * M, reminderMs: 2 * M, lockMs: 5 * M });
  advance(12 * M);
  assert.deepEqual(calls.find((c) => c[0] === 'showReminder')[1], { startsAt: 12 * M, endsAt: 14 * M, note: '', kind: 'reminder' });
  advance(14 * M);
  assert.deepEqual(calls.find((c) => c[0] === 'showLock')[1], { startsAt: 14 * M, endsAt: 19 * M });
  assert.equal(locks[0].opts.maxSeconds, 305);
});

test('breakNow from the dashboard saves the note and locks', () => {
  const { ctl, clock, segments, locks, advance } = setup();
  ctl.tick();
  advance(12 * M);
  ctl.breakNow('  讀完 CTS 那章 \n');
  assert.equal(ctl.phase, 'locked');
  assert.deepEqual(segments, [{ startedAt: 0, endedAt: clock.t, endReason: 'dashboard', note: '讀完 CTS 那章', host: 'pc' }]);
  assert.equal(locks.length, 1);
});

test('breakNow while not counting locks without saving a segment', () => {
  const { ctl, segments, locks } = setup();
  ctl.breakNow('沒有在計時');
  assert.equal(ctl.phase, 'locked');
  assert.deepEqual(segments, []);
  assert.equal(locks.length, 1);
});

test('a dashboard note does not leak when the break is ignored', () => {
  const { ctl, clock, segments, advance } = setup();
  ctl.dispatch({ type: 'meetingOn', now: 0 });
  ctl.breakNow('開會中按的');
  assert.equal(ctl.phase, 'meeting');
  ctl.dispatch({ type: 'meetingOff', now: M });
  clock.t = M;
  ctl.tick();
  advance(5 * M);
  ctl.dispatch({ type: 'startBreak', now: clock.t, source: 'tray' });
  assert.equal(segments.at(-1).note, '');
});

test('lock passes the hotkey codes and escape ends the break without meeting mode', () => {
  const { ctl, calls, locks, advance } = setup();
  ctl.setHotkeys({ meetingVk: 0x4a, escapeVk: 0x39 });
  ctl.tick();
  advance(32 * M);
  assert.equal(locks[0].opts.meetingVk, 0x4a);
  assert.equal(locks[0].opts.escapeVk, 0x39);
  locks[0].opts.onEscapeHotkey();
  assert.equal(ctl.phase, 'away');
  assert.equal(ctl.inMeeting, false);
  assert.equal(locks[0].stopped, 1);
  assert.ok(calls.some((c) => c[0] === 'hideLock'));
  assert.ok(!calls.some((c) => c[0] === 'meeting'));
});

test('default hotkey codes are M and E', () => {
  const { ctl, locks, advance } = setup();
  ctl.tick();
  advance(32 * M);
  assert.equal(locks[0].opts.meetingVk, 0x4d);
  assert.equal(locks[0].opts.escapeVk, 0x45);
});

test('early-break hotkey opens a dismissible card that stays full until the last minutes', () => {
  const { ctl, calls, advance } = setup();
  ctl.tick();
  advance(10 * M);
  ctl.toggleEarlyCard();
  assert.deepEqual(calls.at(-1), ['showReminder', { startsAt: 29 * M, endsAt: 32 * M, note: '', kind: 'early' }, 10 * M]);
  ctl.toggleEarlyCard();
  assert.deepEqual(calls.at(-1), ['hideReminder', 10 * M]);
});

test('a note written on the early card is saved when the break starts from it', () => {
  const { ctl, clock, segments, advance } = setup();
  ctl.tick();
  advance(10 * M);
  ctl.toggleEarlyCard();
  ctl.setDraftNote('寫完 testbench');
  ctl.dispatch({ type: 'startBreak', now: clock.t, source: 'card' });
  assert.equal(ctl.phase, 'locked');
  assert.equal(segments[0].note, '寫完 testbench');
  assert.equal(segments[0].endReason, 'card');
});

test('breaking from the early card closes it', () => {
  const { ctl, clock, calls, advance } = setup();
  ctl.tick();
  advance(10 * M);
  ctl.toggleEarlyCard();
  ctl.dispatch({ type: 'startBreak', now: clock.t, source: 'card' });
  const names = calls.map((c) => c[0]);
  assert.ok(names.lastIndexOf('hideReminder') > names.lastIndexOf('showReminder'));
});

test('when reminder time comes the early card becomes the normal reminder and keeps the note', () => {
  const { ctl, calls, advance } = setup();
  ctl.tick();
  advance(28 * M);
  ctl.toggleEarlyCard();
  ctl.setDraftNote('收尾中');
  advance(29 * M);
  assert.deepEqual(calls.at(-1), ['showReminder', { startsAt: 29 * M, endsAt: 32 * M, note: '收尾中', kind: 'reminder' }, 29 * M]);
  ctl.toggleEarlyCard(); // 正常提醒卡不能用快捷鍵收起
  assert.equal(calls.at(-1)[0], 'showReminder');
});

test('early-break hotkey does nothing while paused, locked or in a meeting', () => {
  const { ctl, clock, calls, advance } = setup();
  ctl.tick();
  advance(32 * M); // locked
  const before = calls.length;
  ctl.toggleEarlyCard();
  ctl.dispatch({ type: 'meetingOn', now: clock.t });
  const afterMeeting = calls.length;
  ctl.toggleEarlyCard();
  assert.equal(calls.length, afterMeeting);
  assert.ok(!calls.slice(before).some((c) => c[0] === 'showReminder'));
});

test('the early card closes when you step away', () => {
  const { ctl, clock, calls, advance } = setup();
  ctl.tick();
  advance(10 * M);
  ctl.toggleEarlyCard();
  while (clock.t < 14 * M) { clock.t += S; clock.idle = clock.t - 10 * M; ctl.tick(); }
  assert.equal(ctl.phase, 'paused');
  assert.equal(calls.at(-1)[0], 'hideReminder');
});

test('a note from the early card is not carried into the next segment when there was nothing to save', () => {
  const { ctl, clock, segments, advance } = setup();
  ctl.toggleEarlyCard(); // 還沒開始計時
  ctl.setDraftNote('沒有工作段可以存');
  ctl.dispatch({ type: 'startBreak', now: clock.t, source: 'card' });
  assert.equal(ctl.phase, 'locked');
  advance(3 * M + S); // 解鎖
  ctl.tick();
  advance(10 * M);
  ctl.dispatch({ type: 'startBreak', now: clock.t, source: 'tray' });
  assert.equal(segments.at(-1).note, '');
});

test('the early card does not open on top of the question card', () => {
  const { ctl, clock, calls, advance } = setup();
  ctl.tick();
  advance(10 * M);
  while (clock.t < 14 * M) { clock.t += S; clock.idle = clock.t - 10 * M; ctl.tick(); }
  clock.t += S; clock.idle = 0; ctl.tick(); // 回來：問題卡出現
  assert.equal(calls.at(-1)[0], 'showQuestion');
  ctl.toggleEarlyCard();
  assert.equal(calls.at(-1)[0], 'showQuestion');
});

test('starting Lock-in while the early card is open closes it and keeps its note on the segment', () => {
  const { ctl, clock, calls, segments, advance } = setup();
  ctl.tick();
  advance(10 * M);
  ctl.toggleEarlyCard();
  ctl.setDraftNote('先記一下');
  ctl.dispatch({ type: 'meetingOn', now: clock.t });
  assert.equal(ctl.phase, 'meeting');
  assert.equal(calls.at(-1)[0] === 'hideReminder' || calls.some((c, i) => c[0] === 'hideReminder' && i > calls.findIndex((x) => x[0] === 'showReminder')), true);
  assert.deepEqual(segments.map((s) => [s.endReason, s.note]), [['meeting', '先記一下']]);
});

test('the early-break hotkey does nothing during the Lock-in wrap-up', () => {
  const { ctl, calls } = setup();
  ctl.dispatch({ type: 'meetingOn', now: 0 });
  ctl.dispatch({ type: 'meetingOff', now: 10 * M });
  const n = calls.length;
  ctl.toggleEarlyCard();
  assert.equal(calls.length, n);
});

test('a break from the dashboard during the Lock-in wrap-up saves the focus session with that note', () => {
  const { ctl, segments } = setup();
  ctl.dispatch({ type: 'meetingOn', now: 0 });
  ctl.dispatch({ type: 'meetingOff', now: 10 * M });
  ctl.breakNow('從紀錄頁寫的');
  assert.equal(ctl.phase, 'locked');
  assert.deepEqual(segments.map((s) => [s.endReason, s.note, s.endedAt]), [['focus', '從紀錄頁寫的', 10 * M]]);
});

function returnSetup(startAt) {
  const clock = { t: startAt, idle: 0 };
  const cards = [];
  const breaks = [];
  let nextId = 100;
  const ctl = createController({
    config: { ...config, askTimeoutMs: 60 * S },
    db: {
      insertSegment: () => nextId++,
      insertMeeting() {},
      insertBreak: (b) => { breaks.push(b); return 500 + breaks.length; },
    },
    ui: {
      showReminder() {}, hideReminder() {}, showLock() {}, hideLock() {}, setMeetingIndicator() {},
      showQuestion() {}, hideQuestion() {},
      showReturnCard: (d) => cards.push(d),
    },
    startLock: () => ({ stop() {} }), host: 'pc', now: () => clock.t, getIdleMs: () => clock.idle,
  });
  return { ctl, clock, cards, breaks };
}

test('answering stood up saves the time away as a break and opens the return card', () => {
  const day = new Date(2026, 9, 21, 9, 0).getTime();
  const { ctl, clock, cards, breaks } = returnSetup(day);
  ctl.tick();
  while (clock.t < day + 10 * M) { clock.t += S; ctl.tick(); }
  while (clock.t < day + 20 * M) { clock.t += S; clock.idle = clock.t - (day + 10 * M); ctl.tick(); }
  clock.t += S; clock.idle = 0; ctl.tick();
  ctl.answer(true);
  assert.deepEqual(breaks, [{ startedAt: day + 10 * M, endedAt: day + 20 * M + S, host: 'pc' }]);
  assert.deepEqual(cards, [{
    segment: { id: 100, startedAt: day, endedAt: day + 10 * M },
    break: { id: 501, startedAt: day + 10 * M, endedAt: day + 20 * M + S },
  }]);
});

test('time away overnight is not saved as a break but the card still asks about the last segment', () => {
  const evening = new Date(2026, 9, 20, 22, 0).getTime();
  const { ctl, clock, cards, breaks } = returnSetup(evening);
  ctl.tick();
  while (clock.t < evening + 10 * M) { clock.t += S; ctl.tick(); }
  clock.t = new Date(2026, 9, 21, 9, 0).getTime(); clock.idle = 30 * M; ctl.tick(); // 睡眠醒來
  clock.t += S; clock.idle = 0; ctl.tick();
  assert.deepEqual(breaks, []);
  assert.deepEqual(cards, [{ segment: { id: 100, startedAt: evening, endedAt: evening + 10 * M }, break: null }]);
});
