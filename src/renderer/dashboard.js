'use strict';

// 紀錄 dashboard（spec §6）：總覽、日曆熱度圖、某一天的細節。
const { Stats, DayView } = window;
const WEEKDAY = '日一二三四五六';
const MIN_WEEKS = 20;

const $ = (id) => document.getElementById(id);
const num = (n, unit) => `${n}<small>${unit}</small>`;
const pad = (n) => String(n).padStart(2, '0');
const hm = (ms) => { const d = new Date(ms); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const startOfDay = (ms) => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d; };

let visible = [];
let meetings = [];
let selected = null; // 重新整理時保留目前看的那一天

function renderSummary(today) {
  const s = Stats.summarize(visible);
  $('s-hours').innerHTML = num(Math.round(s.totalMs / 3600000), '小時');
  $('s-count').innerHTML = num(s.count, '段');
  $('s-avg').innerHTML = num(Math.round(s.avgMs / 60000), '分鐘');
  $('s-notes').innerHTML = num(s.notedCount, '段');
  const st = Stats.streaks(new Set(Stats.countsByDay(visible).keys()), Stats.dayKey(today.getTime()));
  $('s-days').innerHTML = num(st.activeDays, '天');
  $('s-cur').innerHTML = num(st.current, '天');
  $('s-max').innerHTML = num(st.longest, '天');
}

function renderHeat(today) {
  const counts = Stats.countsByDay(visible);
  const heat = $('heat');
  heat.innerHTML = '';
  // 範圍：最早一筆紀錄和 20 週前，取比較早的那個，到今天為止
  const minStart = new Date(today); minStart.setDate(minStart.getDate() - MIN_WEEKS * 7);
  const firstRecord = visible.length ? startOfDay(visible[0].startedAt) : minStart;
  const start = firstRecord < minStart ? firstRecord : minStart;
  const first = new Date(start); first.setDate(first.getDate() - first.getDay());
  const end = new Date(today); end.setDate(end.getDate() + (6 - end.getDay()));

  let lastMonth = -1;
  for (let w = new Date(first); w <= end; w.setDate(w.getDate() + 7)) {
    const mon = document.createElement('span');
    mon.className = 'mon';
    const sat = new Date(w); sat.setDate(sat.getDate() + 6);
    if (sat.getMonth() !== lastMonth) { mon.textContent = `${sat.getMonth() + 1}月`; lastMonth = sat.getMonth(); }
    heat.appendChild(mon);
    for (let i = 0; i < 7; i++) {
      const d = new Date(w); d.setDate(d.getDate() + i);
      const cell = document.createElement('button');
      cell.className = 'cell';
      if (d > today) {
        cell.classList.add('future');
        cell.disabled = true;
        cell.tabIndex = -1;
      } else {
        const key = Stats.dayKey(d.getTime());
        const n = counts.get(key) || 0;
        cell.dataset.l = Stats.heatLevel(n);
        cell.dataset.k = key;
        cell.title = `${d.getMonth() + 1}/${d.getDate()}　${n ? `${n} 段` : '沒有紀錄'}`;
        cell.setAttribute('aria-label', cell.title);
        cell.addEventListener('click', () => showDay(d));
      }
      heat.appendChild(cell);
    }
  }
  document.querySelector('.heat-wrap').scrollLeft = 1e6;
}

function showDay(d) {
  selected = d;
  const key = Stats.dayKey(d.getTime());
  document.querySelectorAll('.cell.sel').forEach((c) => c.classList.remove('sel'));
  document.querySelector(`.cell[data-k="${key}"]`)?.classList.add('sel');

  const segs = Stats.segmentsOnDay(visible, key);
  const meets = Stats.meetingsOnDay(meetings, key);
  const total = Stats.summarize(segs).totalMs;
  const title = `${d.getMonth() + 1} 月 ${d.getDate()} 日（${WEEKDAY[d.getDay()]}）`;
  const el = $('day');
  if (!segs.length && !meets.length) {
    el.innerHTML = `<div class="day-head"><h2>${title}</h2></div>${DayView.renderDayList([])}`;
    return;
  }
  // 時間軸 8:00–24:00
  const dayStart = startOfDay(d.getTime()).getTime();
  const from = dayStart + 8 * 3600000;
  const to = dayStart + 24 * 3600000;
  const pct = (ms) => `${(Math.min(Math.max(ms, from), to) - from) / (to - from) * 100}%`;
  const bar = (a, b, cls = '') =>
    `<b class="${cls}" style="left:${pct(a)};width:calc(${pct(b)} - ${pct(a)})" title="${hm(a)}–${hm(b)}"></b>`;
  const minutes = Math.round(total / 60000);
  el.innerHTML = `
    <div class="day-head"><h2>${title}</h2>
      <span class="sum">${segs.length} 段，共 ${Math.floor(minutes / 60)} 小時 ${minutes % 60} 分</span></div>
    <div class="track">${meets.map((m) => bar(m.startedAt, m.endedAt, 'meeting')).join('')}${segs.map((s) => bar(s.startedAt, s.endedAt)).join('')}</div>
    <div class="track-axis">${[8, 12, 16, 20, 24].map((h) => `<span style="left:${(h - 8) / 16 * 100}%">${h}:00</span>`).join('')}</div>
    ${DayView.renderDayList(segs)}`;
}

async function load() {
  const data = await window.api.getRecords();
  visible = Stats.visibleSegments(data.segments, data.shortIdleSegmentMs);
  meetings = data.meetings;
  const today = startOfDay(data.now);
  renderSummary(today);
  renderHeat(today);
  showDay(selected || today);
}

// 側欄水杯：每秒更新目前這一段
async function updateCup() {
  const { status, cycleMs, lockMs } = await window.api.getStatus();
  const v = window.SessionView.sessionView(status, { cycleMs, lockMs });
  const cup = $('cup');
  cup.dataset.tone = v.tone;
  cup.style.setProperty('--level', v.level);
  $('cup-label').textContent = v.label;
  $('cup-value').textContent = v.value;
  $('cup-unit').textContent = v.unit;
}

load();
updateCup();
setInterval(updateCup, 1000);
window.addEventListener('focus', load);
