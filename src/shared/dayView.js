'use strict';

// Dashboard「某一天」的逐段清單（spec §6）。紀錄文字是使用者輸入的，一律跳脫成純文字。
(function () {
  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ESC[c]);
  const pad = (n) => String(n).padStart(2, '0');
  const hm = (ms) => { const d = new Date(ms); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  const isEarly = (s) => s.endReason === 'card' || s.endReason === 'tray' || s.endReason === 'dashboard';

  function renderDayList(segments) {
    if (!segments.length) return '<p class="none">這天沒有紀錄。</p>';
    const items = segments.map((s) => {
      const minutes = Math.round((s.endedAt - s.startedAt) / 60000);
      const note = s.note
        ? `<div class="note">${escapeHtml(s.note).replace(/\r?\n/g, '<br>')}`
        : '<div class="note empty">沒有寫紀錄';
      const tag = isEarly(s) ? '<span class="tag">提早休息</span>' : '';
      return `<li><div class="when">${hm(s.startedAt)}–${hm(s.endedAt)}<small>${minutes} 分鐘</small></div>${note}${tag}</div></li>`;
    });
    return `<ul class="list">${items.join('')}</ul>`;
  }

  const api = { renderDayList, escapeHtml };
  if (typeof module !== 'undefined') module.exports = api;
  else window.DayView = api;
})();
