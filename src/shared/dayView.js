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

  function renderDayList(segments, { earlyBeforeMs } = {}) {
    if (!segments.length) return '<p class="none">這天沒有紀錄。</p>';
    const items = segments.map((s, i) => {
      const minutes = Math.round((s.endedAt - s.startedAt) / 60000);
      const note = s.note
        ? `<div class="note">${escapeHtml(s.note).replace(/\r?\n/g, '<br>')}`
        : '<div class="note empty">沒有寫紀錄';
      let tag = '';
      if (s.endReason === 'focus') tag = '<span class="tag focus">Lock-in 專注</span>';
      else if (isEarly(s, earlyBeforeMs)) tag = '<span class="tag">提早休息</span>';
      // 補寫或修改這一段的紀錄
      const edit = s.id === undefined ? ''
        : `<span class="seg-actions"><button type="button" class="edit-note" data-id="${Number(s.id)}">${s.note ? '修改' : '補寫'}</button>`
          + `<button type="button" class="delete-seg" data-id="${Number(s.id)}">刪除</button></span>`;
      // id／data-i 讓時間軸上的區塊可以跳到這一段
      return `<li id="seg-${i}" data-i="${i}" tabindex="-1"><div class="when">${hm(s.startedAt)}–${hm(s.endedAt)}<small>${minutes} 分鐘</small></div>${note}${tag}${edit}</div></li>`;
    });
    return `<ul class="list">${items.join('')}</ul>`;
  }

  const api = { renderDayList, escapeHtml };
  if (typeof module !== 'undefined') module.exports = api;
  else window.DayView = api;
})();
