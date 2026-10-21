'use strict';

// Dashboard「某一天」的逐段清單（spec §6）。紀錄文字是使用者輸入的，一律跳脫成純文字。
(function () {
  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ESC[c]);
  const pad = (n) => String(n).padStart(2, '0');
  const hm = (ms) => { const d = new Date(ms); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  // 提早休息：自己按休息（提醒卡、系統匣、紀錄頁），而且是在提醒卡該出現之前。
  // 提醒卡出現後才按、或坐超過時間才休息，都不算提早。
  const BREAK_REASONS = ['card', 'tray', 'dashboard'];
  const DEFAULT_EARLY_BEFORE_MS = 29 * 60000;
  const isEarly = (s, earlyBeforeMs = DEFAULT_EARLY_BEFORE_MS) =>
    BREAK_REASONS.includes(s.endReason) && s.endedAt - s.startedAt < earlyBeforeMs;

  const noteHtml = (note, emptyText) => (note
    ? `<div class="note">${escapeHtml(note).replace(/\r?\n/g, '<br>')}`
    : `<div class="note empty">${emptyText}`);
  // 補寫或修改、刪除；休息多帶 data-kind="break"
  const actions = (item, kind) => {
    if (item.id === undefined) return '';
    const k = kind ? ` data-kind="${kind}"` : '';
    return `<span class="seg-actions"><button type="button" class="edit-note"${k} data-id="${Number(item.id)}">${item.note ? '修改' : '補寫'}</button>`
      + `<button type="button" class="delete-seg"${k} data-id="${Number(item.id)}">刪除</button></span>`;
  };
  const when = (x) => {
    const minutes = Math.round((x.endedAt - x.startedAt) / 60000);
    return `<div class="when">${hm(x.startedAt)}–${hm(x.endedAt)}<small>${minutes} 分鐘</small></div>`;
  };

  // breaks：這天離開座位的時間，依開始時間插在工作段之間
  function renderDayList(segments, { earlyBeforeMs, breaks = [] } = {}) {
    if (!segments.length && !breaks.length) return '<p class="none">這天沒有紀錄。</p>';
    const rows = [
      ...segments.map((s, i) => ({ at: s.startedAt, html: segmentItem(s, i, earlyBeforeMs) })),
      ...breaks.map((b, j) => ({ at: b.startedAt, html: breakItem(b, j) })),
    ].sort((x, y) => x.at - y.at);
    return `<ul class="list">${rows.map((r) => r.html).join('')}</ul>`;
  }

  function segmentItem(s, i, earlyBeforeMs) {
    let tag = '';
    if (s.endReason === 'focus') tag = '<span class="tag focus">Lock-in 專注</span>';
    else if (isEarly(s, earlyBeforeMs)) tag = '<span class="tag">提早休息</span>';
    // id／data-i 讓時間軸上的區塊可以跳到這一段
    return `<li id="seg-${i}" data-i="${i}" tabindex="-1">${when(s)}${noteHtml(s.note, '沒有寫紀錄')}${tag}${actions(s)}</div></li>`;
  }

  function breakItem(b, j) {
    return `<li id="brk-${j}" data-b="${j}" class="rest" tabindex="-1">${when(b)}${noteHtml(b.note, '沒有寫做了什麼')}`
      + `<span class="tag rest">休息</span>${actions(b, 'break')}</div></li>`;
  }

  const api = { renderDayList, escapeHtml };
  if (typeof module !== 'undefined') module.exports = api;
  else window.DayView = api;
})();
