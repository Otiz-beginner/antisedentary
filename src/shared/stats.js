'use strict';

// Dashboard 統計（spec §6）。純函式，main 行程和 dashboard 網頁共用。日期一律用本地時間。
(function () {
  const pad = (n) => String(n).padStart(2, '0');

  function dayKey(ms) {
    const d = new Date(ms);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  // 等 APR 時偶爾碰一下滑鼠產生的碎片段：閒置歸零、太短、沒寫紀錄
  function visibleSegments(segments, shortIdleSegmentMs) {
    return segments.filter((s) =>
      !(s.endReason === 'idle' && s.endedAt - s.startedAt < shortIdleSegmentMs && !s.note));
  }

  function summarize(visible) {
    const totalMs = visible.reduce((sum, s) => sum + (s.endedAt - s.startedAt), 0);
    const count = visible.length;
    return {
      totalMs,
      count,
      avgMs: count ? Math.round(totalMs / count) : 0,
      notedCount: visible.filter((s) => s.note).length,
    };
  }

  function countsByDay(visible) {
    const counts = new Map();
    for (const s of visible) {
      const k = dayKey(s.startedAt);
      counts.set(k, (counts.get(k) || 0) + 1);
    }
    return counts;
  }

  function heatLevel(n) {
    if (n <= 0) return 0;
    if (n <= 2) return 1;
    if (n <= 4) return 2;
    if (n <= 7) return 3;
    return 4;
  }

  function shiftKey(key, days) {
    const [y, m, d] = key.split('-').map(Number);
    return dayKey(new Date(y, m - 1, d + days).getTime());
  }

  function streaks(dayKeys, todayKey) {
    let current = 0;
    let k = dayKeys.has(todayKey) ? todayKey : shiftKey(todayKey, -1);
    while (dayKeys.has(k)) { current++; k = shiftKey(k, -1); }

    let longest = 0;
    for (const key of dayKeys) {
      if (dayKeys.has(shiftKey(key, -1))) continue; // 只從每段連續的第一天往後數
      let run = 0;
      for (let j = key; dayKeys.has(j); j = shiftKey(j, 1)) run++;
      longest = Math.max(longest, run);
    }
    return { activeDays: dayKeys.size, current, longest };
  }

  const segmentsOnDay = (visible, key) => visible.filter((s) => dayKey(s.startedAt) === key);
  const meetingsOnDay = (meetings, key) => meetings.filter((m) => dayKey(m.startedAt) === key);
  // 提早休息：自己按休息（提醒卡、系統匣、紀錄頁），而且是在提醒卡該出現之前。
  // 提醒卡出現後才按、或坐超過時間才休息，都不算提早。
  const BREAK_REASONS = ['card', 'tray', 'dashboard'];
  const DEFAULT_EARLY_BEFORE_MS = 29 * 60000;
  const isEarly = (s, earlyBeforeMs = DEFAULT_EARLY_BEFORE_MS) =>
    BREAK_REASONS.includes(s.endReason) && s.endedAt - s.startedAt < earlyBeforeMs;

  const api = { dayKey, visibleSegments, summarize, countsByDay, heatLevel, streaks, segmentsOnDay, meetingsOnDay, isEarly };
  if (typeof module !== 'undefined') module.exports = api;
  else window.Stats = api;
})();
