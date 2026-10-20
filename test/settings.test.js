'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { DEFAULTS, FIELDS, validate, toConfig } = require('../src/core/settings');

const M = 60000;

test('defaults match the original timings plus the two hotkeys', () => {
  assert.deepEqual(DEFAULTS, {
    cycleMinutes: 32, reminderMinutes: 3, restMinutes: 3,
    idlePauseMinutes: 3, askMaxMinutes: 30, askTimeoutSeconds: 60,
    meetingKey: 'M', escapeKey: 'E', earlyKey: 'B', autoStart: true,
    restBackground: 'blur', restSlogan: 'break', restSloganText: '',
  });
});

test('every field has a short name, a longer help text and a kind', () => {
  assert.deepEqual(FIELDS.map((f) => f.short),
    ['工作時長', '收尾時間', '休息時長', '暫停判定', '手機上限', '回答等待', 'Lock-in 快捷鍵', '緊急逃出快捷鍵', '提早休息快捷鍵', '開機自動啟動', '休息背景', '休息標語', '自訂標語']);
  for (const key of Object.keys(DEFAULTS)) {
    const f = FIELDS.find((x) => x.key === key);
    assert.ok(f, key);
    assert.ok(f.help && f.help.length > 15, key);
    assert.ok(['minutes', 'seconds', 'hotkey', 'toggle', 'choice', 'text'].includes(f.kind), key);
    assert.ok(['hotkey', 'time', 'rest', 'other'].includes(f.group), key);
    if (f.kind === 'minutes' || f.kind === 'seconds') assert.ok(f.unit && f.min < f.max, key);
  }
});

test('hotkeys must come from the list', () => {
  const r = validate({ ...DEFAULTS, meetingKey: 'Q' });
  assert.equal(r.ok, false);
  assert.ok(r.errors.meetingKey);
});

test('the two hotkeys must be different', () => {
  const r = validate({ ...DEFAULTS, meetingKey: 'K', escapeKey: 'K' });
  assert.equal(r.ok, false);
  assert.ok(r.errors.escapeKey);
});

test('a chosen hotkey is kept', () => {
  const r = validate({ ...DEFAULTS, meetingKey: 'J', escapeKey: '9' });
  assert.equal(r.ok, true);
  assert.equal(r.value.meetingKey, 'J');
  assert.equal(r.value.escapeKey, '9');
});

test('settings saved by an older version get the default hotkeys', () => {
  const old = { cycleMinutes: 30, reminderMinutes: 3, restMinutes: 3, idlePauseMinutes: 2, askMaxMinutes: 40, askTimeoutSeconds: 60 };
  const r = validate(old);
  assert.equal(r.ok, true);
  assert.deepEqual(r.value, { ...old, meetingKey: 'M', escapeKey: 'E', earlyKey: 'B', autoStart: true,
    restBackground: 'blur', restSlogan: 'break', restSloganText: '' });
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

test('fields are grouped into hotkeys, times and others', () => {
  const groups = {};
  for (const f of FIELDS) (groups[f.group] ||= []).push(f.key);
  assert.deepEqual(groups.hotkey, ['meetingKey', 'escapeKey', 'earlyKey']);
  assert.deepEqual(groups.time, ['cycleMinutes', 'reminderMinutes', 'restMinutes', 'idlePauseMinutes', 'askMaxMinutes', 'askTimeoutSeconds']);
  assert.deepEqual(groups.rest, ['restBackground', 'restSlogan', 'restSloganText']);
  assert.deepEqual(groups.other, ['autoStart']);
});

test('the three hotkeys must all be different', () => {
  const r = validate({ ...DEFAULTS, earlyKey: 'E' });
  assert.equal(r.ok, false);
  assert.ok(r.errors.earlyKey);
});

test('autostart accepts on and off', () => {
  assert.equal(validate({ ...DEFAULTS, autoStart: false }).value.autoStart, false);
  assert.equal(validate({ ...DEFAULTS, autoStart: 'false' }).value.autoStart, false);
  assert.equal(validate({ ...DEFAULTS, autoStart: 'on' }).value.autoStart, true);
  assert.equal(validate({ ...DEFAULTS, autoStart: 'maybe' }).ok, false);
});

test('rest background is blur or the built-in wallpaper', () => {
  assert.deepEqual(FIELDS.find((f) => f.key === 'restBackground').options.map((o) => o.value), ['blur', 'wallpaper']);
  assert.equal(validate({ ...DEFAULTS, restBackground: 'wallpaper' }).value.restBackground, 'wallpaper');
  assert.equal(validate({ ...DEFAULTS, restBackground: 'photo' }).ok, false);
});

test('slogan can be TAKE A BREAK, 摸魚中, nothing or custom text', () => {
  assert.deepEqual(FIELDS.find((f) => f.key === 'restSlogan').options.map((o) => o.value), ['break', 'fish', 'none', 'custom']);
  assert.equal(validate({ ...DEFAULTS, restSlogan: 'fish' }).value.restSlogan, 'fish');
  assert.equal(validate({ ...DEFAULTS, restSlogan: 'shout' }).ok, false);
});

test('custom slogan text is trimmed, required when chosen and at most 20 characters', () => {
  assert.equal(validate({ ...DEFAULTS, restSlogan: 'custom', restSloganText: '  去喝水  ' }).value.restSloganText, '去喝水');
  const empty = validate({ ...DEFAULTS, restSlogan: 'custom', restSloganText: '   ' });
  assert.equal(empty.ok, false);
  assert.ok(empty.errors.restSloganText);
  assert.equal(validate({ ...DEFAULTS, restSlogan: 'custom', restSloganText: '字'.repeat(21) }).ok, false);
  // 沒選自訂時，留白也沒關係
  assert.equal(validate({ ...DEFAULTS, restSlogan: 'break', restSloganText: '' }).ok, true);
});

test('settings saved before 0.5.0 get the default rest screen', () => {
  const old = { ...DEFAULTS };
  delete old.restBackground; delete old.restSlogan; delete old.restSloganText;
  const r = validate(old);
  assert.equal(r.value.restBackground, 'blur');
  assert.equal(r.value.restSlogan, 'break');
});

test('sloganFor turns the setting into the words shown on the rest screen', () => {
  const { sloganFor } = require('../src/core/settings');
  assert.equal(sloganFor({ restSlogan: 'break' }), 'TAKE A BREAK');
  assert.equal(sloganFor({ restSlogan: 'fish' }), '摸魚中…');
  assert.equal(sloganFor({ restSlogan: 'none' }), '');
  assert.equal(sloganFor({ restSlogan: 'custom', restSloganText: '去喝水' }), '去喝水');
});
