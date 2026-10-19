'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { renderDayList } = require('../src/shared/dayView');

const M = 60000;
const t = new Date(2026, 9, 19, 9, 24).getTime();
const seg = (extra = {}) => ({ startedAt: t, endedAt: t + 32 * M, endReason: 'timeout', note: '', ...extra });

test('renderDayList escapes html', () => {
  const html = renderDayList([seg({ note: '<script>x</script> & "q" \'s' })]);
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&lt;script&gt;x&lt;/script&gt; &amp; &quot;q&quot; &#39;s'));
});

test('shows time range and length', () => {
  const html = renderDayList([seg({ note: 'CTS' })]);
  assert.ok(html.includes('09:24–09:56'));
  assert.ok(html.includes('32 分鐘'));
  assert.ok(html.includes('CTS'));
});

test('newlines in note become line breaks', () => {
  assert.ok(renderDayList([seg({ note: 'a\nb' })]).includes('a<br>b'));
});

test('empty note shows 沒有寫紀錄', () => {
  assert.ok(renderDayList([seg()]).includes('沒有寫紀錄'));
});

test('card and tray segments get 提早休息 tag', () => {
  assert.ok(renderDayList([seg({ endReason: 'card' })]).includes('提早休息'));
  assert.ok(renderDayList([seg({ endReason: 'tray' })]).includes('提早休息'));
  assert.ok(!renderDayList([seg({ endReason: 'timeout' })]).includes('提早休息'));
});

test('no segments renders 這天沒有紀錄。', () => {
  assert.ok(renderDayList([]).includes('這天沒有紀錄。'));
});
