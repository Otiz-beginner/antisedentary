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
  updateEarly(status.phase);
}

// 側欄：從 dashboard 提早休息
const EARLY_HINTS = {
  locked: '正在休息中',
  meeting: '開會模式中不能提早休息',
  away: '還沒開始計時，這次不會留下紀錄',
  paused: '暫停中：會存到你離開前那一刻',
};
function updateEarly(phase) {
  const disabled = phase === 'locked' || phase === 'meeting';
  $('early-start').disabled = disabled;
  $('early-note').disabled = disabled;
  $('early-hint').textContent = EARLY_HINTS[phase] || '';
  if (disabled) setConfirming(false);
}

// 按「開始休息」先問一句，按「確定」才真的鎖定
function setConfirming(on) {
  $('early-confirm').hidden = !on;
  $('early-start').hidden = on;
  if (on) $('early-cancel').focus();
}

$('early-form').addEventListener('submit', (e) => {
  e.preventDefault();
  setConfirming(true);
});

$('early-cancel').addEventListener('click', () => {
  setConfirming(false);
  $('early-start').focus();
});

$('early-confirm').addEventListener('keydown', (e) => {
  if (e.key === 'Escape') $('early-cancel').click();
});

$('early-yes').addEventListener('click', async () => {
  $('early-yes').disabled = true;
  const phase = await window.api.breakNow($('early-note').value);
  $('early-yes').disabled = false;
  setConfirming(false);
  if (phase === 'locked') $('early-note').value = '';
  load();
  updateCup();
});

// ---------- 左側欄：可以展開 ----------
const RAIL_KEY = 'antisedentary.railOpen';
function setRail(open) {
  document.body.classList.toggle('rail-open', open);
  $('rail-toggle').setAttribute('aria-expanded', String(open));
  $('rail-toggle').setAttribute('aria-label', open ? '收起選單' : '展開選單');
  try { localStorage.setItem(RAIL_KEY, open ? '1' : '0'); } catch { /* 記不住也沒關係 */ }
}
let railOpen = false;
try { railOpen = localStorage.getItem(RAIL_KEY) === '1'; } catch { /* 預設收起 */ }
setRail(railOpen);
$('rail-toggle').addEventListener('click', () => setRail(!document.body.classList.contains('rail-open')));
$('open-tutorial').addEventListener('click', () => window.api.openTutorial());

// ---------- 設定：浮在中央的面板 ----------
// 欄位、範圍、說明都由 main 提供，存檔前由 main 再驗證一次
let settingsDefaults = {};
let lastFocus = null;

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function renderSettings(fields, values, keys) {
  $('settings-fields').innerHTML = fields.map((f) => {
    const control = f.kind === 'hotkey'
      ? `<select id="set-${f.key}" name="${f.key}" aria-describedby="err-${f.key}">
           ${keys.map((k) => `<option value="${k.key}"${k.key === values[f.key] ? ' selected' : ''}>${escapeHtml(k.label)}</option>`).join('')}
         </select>`
      : `<input type="number" id="set-${f.key}" name="${f.key}" min="${f.min}" max="${f.max}" step="1"
                value="${values[f.key]}" aria-describedby="err-${f.key}"><span class="unit">${f.unit}</span>`;
    return `
    <div class="field">
      <div class="field-row">
        <div class="field-name">
          <label for="set-${f.key}">${escapeHtml(f.short)}</label>
          <button type="button" class="help-btn" aria-expanded="false" aria-controls="help-${f.key}"
                  aria-label="${escapeHtml(f.short)}的說明">?</button>
        </div>
        ${control}
      </div>
      <p class="help-text" id="help-${f.key}" hidden>${escapeHtml(f.help)}</p>
      <span class="error" id="err-${f.key}"></span>
    </div>`;
  }).join('');
}

// 點「?」展開說明，再點一次收起；同時只開一個
$('settings-fields').addEventListener('click', (e) => {
  const btn = e.target.closest('.help-btn');
  if (!btn) return;
  const open = btn.getAttribute('aria-expanded') !== 'true';
  document.querySelectorAll('#settings-fields .help-btn').forEach((b) => {
    b.setAttribute('aria-expanded', 'false');
    $(b.getAttribute('aria-controls')).hidden = true;
  });
  btn.setAttribute('aria-expanded', String(open));
  $(btn.getAttribute('aria-controls')).hidden = !open;
});

function showErrors(errors) {
  document.querySelectorAll('#settings-fields [name]').forEach((el) => {
    const msg = errors[el.name] || '';
    el.setAttribute('aria-invalid', msg ? 'true' : 'false');
    $(`err-${el.name}`).textContent = msg;
  });
}

async function openSettings() {
  const { fields, values, defaults, keys } = await window.api.getSettings();
  settingsDefaults = defaults;
  renderSettings(fields, values, keys);
  $('settings-status').textContent = '';
  lastFocus = document.activeElement;
  $('settings-modal').hidden = false;
  $('settings-fields').querySelector('[name]').focus();
}

function closeSettings() {
  $('settings-modal').hidden = true;
  if (lastFocus) lastFocus.focus();
}

$('open-settings').addEventListener('click', openSettings);
$('settings-close').addEventListener('click', closeSettings);
// 點面板外面就關閉
$('settings-modal').addEventListener('mousedown', (e) => { if (e.target === $('settings-modal')) closeSettings(); });
$('settings-modal').addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { e.preventDefault(); closeSettings(); return; }
  if (e.key !== 'Tab') return;
  // 焦點留在面板裡
  const focusable = [...$('settings-modal').querySelectorAll('button, input, select')].filter((el) => !el.disabled);
  const first = focusable[0];
  const last = focusable.at(-1);
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
});

$('settings-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const values = Object.fromEntries(new FormData(e.target).entries());
  const result = await window.api.saveSettings(values);
  if (result.ok) {
    showErrors({});
    $('settings-status').textContent = '已儲存，馬上生效';
    updateCup();
  } else {
    showErrors(result.errors);
    $('settings-status').textContent = '有欄位需要修正';
  }
});

$('settings-reset').addEventListener('click', () => {
  for (const [key, value] of Object.entries(settingsDefaults)) $(`set-${key}`).value = value;
  showErrors({});
  $('settings-status').textContent = '已填回預設值，按「儲存設定」才會生效';
});

load();
updateCup();
setInterval(updateCup, 1000);
window.addEventListener('focus', load);
