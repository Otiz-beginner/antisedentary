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

test('breaks taken before the reminder would appear get 提早休息 tag', () => {
  const short = (endReason) => seg({ endReason, endedAt: t + 10 * M });
  const opts = { earlyBeforeMs: 29 * M };
  assert.ok(renderDayList([short('card')], opts).includes('提早休息'));
  assert.ok(renderDayList([short('tray')], opts).includes('提早休息'));
  assert.ok(renderDayList([short('dashboard')], opts).includes('提早休息'));
  assert.ok(!renderDayList([short('timeout')], opts).includes('提早休息'));
});

test('a break taken after the reminder appeared is not early', () => {
  const opts = { earlyBeforeMs: 29 * M };
  // 提醒卡出現後按「開始休息」、或坐超過時間才從系統匣休息
  assert.ok(!renderDayList([seg({ endReason: 'card', endedAt: t + 30 * M })], opts).includes('提早休息'));
  assert.ok(!renderDayList([seg({ endReason: 'tray', endedAt: t + 45 * M })], opts).includes('提早休息'));
  assert.ok(!renderDayList([seg({ endReason: 'dashboard', endedAt: t + 29 * M })], opts).includes('提早休息'));
});

test('without options the default 29 minute threshold is used', () => {
  assert.ok(renderDayList([seg({ endReason: 'card', endedAt: t + 20 * M })]).includes('提早休息'));
  assert.ok(!renderDayList([seg({ endReason: 'card', endedAt: t + 32 * M })]).includes('提早休息'));
});

test('no segments renders 這天沒有紀錄。', () => {
  assert.ok(renderDayList([]).includes('這天沒有紀錄。'));
});

test('each list item carries its index so the timeline can jump to it', () => {
  const html = renderDayList([seg(), seg({ startedAt: t + 40 * M, endedAt: t + 72 * M })]);
  assert.ok(html.includes('<li id="seg-0" data-i="0" tabindex="-1">'));
  assert.ok(html.includes('<li id="seg-1" data-i="1" tabindex="-1">'));
});

test('Lock-in sessions are tagged', () => {
  const html = renderDayList([seg({ endReason: 'focus', note: '寫 RTL' })]);
  assert.ok(html.includes('<span class="tag focus">Lock-in 專注</span>'));
  assert.ok(!html.includes('提早休息'));
});

test('each item has a button to write or edit its note', () => {
  const html = renderDayList([seg({ id: 42 }), seg({ id: 43, note: 'x' })]);
  assert.ok(html.includes('<button type="button" class="edit-note" data-id="42">補寫</button>'));
  assert.ok(html.includes('<button type="button" class="edit-note" data-id="43">修改</button>'));
});

test('each saved item has a delete button', () => {
  const html = renderDayList([seg({ id: 42 })]);
  assert.ok(html.includes('<button type="button" class="delete-seg" data-id="42">刪除</button>'));
  assert.ok(!renderDayList([seg()]).includes('delete-seg'));
});

test('breaks are listed in time order between segments with their own tag and buttons', () => {
  const a = seg({ id: 1, endedAt: t + 30 * M });
  const b = seg({ id: 2, startedAt: t + 45 * M, endedAt: t + 60 * M });
  const rest = { id: 7, startedAt: t + 30 * M, endedAt: t + 45 * M, note: '講<電話>' };
  const html = renderDayList([a, b], { breaks: [rest] });
  const order = ['id="seg-0"', 'id="brk-0"', 'id="seg-1"'].map((x) => html.indexOf(x));
  assert.ok(order.every((x) => x >= 0) && order[0] < order[1] && order[1] < order[2], order.join(','));
  assert.ok(html.includes('<li id="brk-0" data-b="0" class="rest" tabindex="-1">'));
  assert.ok(html.includes('<span class="tag rest">休息</span>'));
  assert.ok(html.includes('講&lt;電話&gt;'));
  assert.ok(html.includes('<button type="button" class="edit-note" data-kind="break" data-id="7">修改</button>'));
  assert.ok(html.includes('<button type="button" class="delete-seg" data-kind="break" data-id="7">刪除</button>'));
});

test('a break without a note says 沒有寫做了什麼', () => {
  const html = renderDayList([], { breaks: [{ id: 3, startedAt: t, endedAt: t + 10 * M, note: '' }] });
  assert.ok(html.includes('沒有寫做了什麼'));
  assert.ok(html.includes('data-kind="break" data-id="3">補寫</button>'));
  assert.ok(!html.includes('這天沒有紀錄'));
});
