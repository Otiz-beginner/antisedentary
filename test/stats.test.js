'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Stats = require('../src/shared/stats');

const M = 60000;
const at = (d, h = 9, min = 0) => new Date(2026, 9, d, h, min).getTime();
const seg = (startedAt, minutes, extra = {}) =>
  ({ startedAt, endedAt: startedAt + minutes * M, endReason: 'timeout', note: '', host: 'pc', ...extra });

test('dayKey uses local date', () => {
  assert.equal(Stats.dayKey(at(5, 23, 59)), '2026-10-05');
  assert.equal(Stats.dayKey(at(19, 0, 0)), '2026-10-19');
});

test('short idle segment without note is hidden', () => {
  assert.deepEqual(Stats.visibleSegments([seg(at(1), 4, { endReason: 'idle' })], 5 * M), []);
});

test('short idle segment with note is kept', () => {
  assert.equal(Stats.visibleSegments([seg(at(1), 4, { endReason: 'idle', note: 'x' })], 5 * M).length, 1);
});

test('long idle segment is kept', () => {
  assert.equal(Stats.visibleSegments([seg(at(1), 6, { endReason: 'idle' })], 5 * M).length, 1);
});

test('short non-idle segment is kept', () => {
  assert.equal(Stats.visibleSegments([seg(at(1), 2, { endReason: 'tray' })], 5 * M).length, 1);
});

test('summarize totals, average and noted count', () => {
  const s = Stats.summarize([seg(at(1), 32, { note: 'a' }), seg(at(1, 11), 20), seg(at(2), 32, { note: 'b' })]);
  assert.deepEqual(s, { totalMs: 84 * M, count: 3, avgMs: 28 * M, notedCount: 2 });
});

test('summarize of nothing is all zero', () => {
  assert.deepEqual(Stats.summarize([]), { totalMs: 0, count: 0, avgMs: 0, notedCount: 0 });
});

test('segment spanning midnight counts on start day', () => {
  const counts = Stats.countsByDay([seg(at(5, 23, 50), 32)]);
  assert.equal(counts.get('2026-10-05'), 1);
  assert.equal(counts.get('2026-10-06'), undefined);
  assert.equal(Stats.segmentsOnDay([seg(at(5, 23, 50), 32)], '2026-10-06').length, 0);
  assert.equal(Stats.segmentsOnDay([seg(at(5, 23, 50), 32)], '2026-10-05').length, 1);
});

test('heatLevel thresholds', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 7, 8, 12].map(Stats.heatLevel), [0, 1, 1, 2, 2, 3, 3, 4, 4]);
});

test('streak counts back from today, or from yesterday if today empty', () => {
  const days = new Set(['2026-10-16', '2026-10-17', '2026-10-18']);
  assert.equal(Stats.streaks(days, '2026-10-19').current, 3);
  days.add('2026-10-19');
  assert.equal(Stats.streaks(days, '2026-10-19').current, 4);
  assert.equal(Stats.streaks(new Set(['2026-10-10']), '2026-10-19').current, 0);
});

test('longest streak across gaps', () => {
  const days = new Set(['2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-10', '2026-10-11']);
  assert.deepEqual(Stats.streaks(days, '2026-10-19'), { activeDays: 6, current: 0, longest: 4 });
});

test('meetingsOnDay filters by start day', () => {
  const ms = [{ startedAt: at(3, 10), endedAt: at(3, 11) }, { startedAt: at(4, 10), endedAt: at(4, 11) }];
  assert.deepEqual(Stats.meetingsOnDay(ms, '2026-10-04'), [ms[1]]);
});

test('isEarly true only for card and tray', () => {
  assert.deepEqual(['card', 'tray', 'timeout', 'idle', 'meeting', 'quit'].map((r) => Stats.isEarly({ endReason: r })),
    [true, true, false, false, false, false]);
});
