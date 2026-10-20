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
let earlyBeforeMs; // 從 main 拿；在這之前自己休息才標「提早休息」
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
  const style = (a, b) => `left:${pct(a)};width:calc(${pct(b)} - ${pct(a)})`;
  const meetBar = (m) => `<b class="meeting" style="${style(m.startedAt, m.endedAt)}" title="Lock-in ${hm(m.startedAt)}–${hm(m.endedAt)}"></b>`;
  // 工作段是按鈕：點了跳到下面清單裡的那一段
  const segBar = (s, i) => `<button type="button" class="seg${s.endReason === 'focus' ? ' focus' : ''}" data-i="${i}" style="${style(s.startedAt, s.endedAt)}"
      title="${hm(s.startedAt)}–${hm(s.endedAt)}" aria-label="跳到 ${hm(s.startedAt)} 到 ${hm(s.endedAt)} 這一段"></button>`;
  const minutes = Math.round(total / 60000);
  el.innerHTML = `
    <div class="day-head"><h2>${title}</h2>
      <span class="sum">${segs.length} 段，共 ${Math.floor(minutes / 60)} 小時 ${minutes % 60} 分</span></div>
    <div class="track">${meets.map(meetBar).join('')}${segs.map(segBar).join('')}</div>
    <div class="track-axis">${[8, 12, 16, 20, 24].map((h) => `<span style="left:${(h - 8) / 16 * 100}%">${h}:00</span>`).join('')}</div>
    ${DayView.renderDayList(segs, { earlyBeforeMs })}`;
}

async function load() {
  const data = await window.api.getRecords();
  visible = Stats.visibleSegments(data.segments, data.shortIdleSegmentMs);
  earlyBeforeMs = data.earlyBeforeMs;
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
  updateFocus(status.phase);
}

// 側欄：從 dashboard 提早休息
const EARLY_HINTS = {
  locked: '正在休息中',
  meeting: 'Lock-in 專注中，要休息請先結束專注',
  focusWrap: '正在寫專注的收尾，水退光就休息',
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

// 設定分三群，依這個順序顯示
const GROUPS = [['hotkey', '快捷鍵'], ['time', '時間設定'], ['rest', '休息畫面'], ['other', '其他']];

function renderSettings(fields, values, keys) {
  $('settings-fields').innerHTML = GROUPS.map(([group, name]) => `
    <section class="group" aria-labelledby="group-${group}">
      <h3 class="group-title" id="group-${group}">${name}</h3>
      ${fields.filter((f) => f.group === group).map((f) => renderField(f, values, keys)).join('')}
    </section>`).join('');
}

function renderField(f, values, keys) {
    let control;
    if (f.kind === 'hotkey') {
      control = `<select id="set-${f.key}" name="${f.key}" aria-describedby="err-${f.key}">
           ${keys.map((k) => `<option value="${k.key}"${k.key === values[f.key] ? ' selected' : ''}>${escapeHtml(k.label)}</option>`).join('')}
         </select>`;
    } else if (f.kind === 'choice') {
      control = `<select id="set-${f.key}" name="${f.key}" aria-describedby="err-${f.key}">
           ${f.options.map((o) => `<option value="${o.value}"${o.value === values[f.key] ? ' selected' : ''}>${escapeHtml(o.label)}</option>`).join('')}
         </select>`;
    } else if (f.kind === 'text') {
      control = `<input type="text" class="text" id="set-${f.key}" name="${f.key}" maxlength="${f.max}"
                value="${escapeHtml(values[f.key] ?? '')}" placeholder="例如：去裝水" aria-describedby="err-${f.key}">`;
    } else if (f.kind === 'toggle') {
      control = `<span class="switch"><input type="checkbox" role="switch" id="set-${f.key}" name="${f.key}"
                 ${values[f.key] ? 'checked' : ''} aria-describedby="err-${f.key}"><span class="track-ui" aria-hidden="true"></span></span>`;
    } else {
      control = `<input type="number" id="set-${f.key}" name="${f.key}" min="${f.min}" max="${f.max}" step="1"
                value="${values[f.key]}" aria-describedby="err-${f.key}"><span class="unit">${f.unit}</span>`;
    }
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

// 「自訂標語」只有在「休息標語」選「自己輸入」時才需要
function syncSloganText() {
  const mode = $('set-restSlogan');
  const text = $('set-restSloganText');
  if (!mode || !text) return;
  text.closest('.field').hidden = mode.value !== 'custom';
}
$('settings-fields').addEventListener('change', (e) => { if (e.target.id === 'set-restSlogan') syncSloganText(); });

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
  syncSloganText();
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
  const focusable = [...$('settings-modal').querySelectorAll('button, input, select')].filter((el) => !el.disabled && el.offsetParent !== null);
  const first = focusable[0];
  const last = focusable.at(-1);
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
});

$('settings-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const values = Object.fromEntries(new FormData(e.target).entries());
  // 開關沒勾時 FormData 不會帶這個欄位，要明確送 false
  e.target.querySelectorAll('input[type="checkbox"]').forEach((box) => { values[box.name] = box.checked; });
  const result = await window.api.saveSettings(values);
  if (result.ok) {
    showErrors({});
    $('settings-status').textContent = '已儲存，馬上生效';
    updateCup();
    loadHotkeys();
  } else {
    showErrors(result.errors);
    $('settings-status').textContent = '有欄位需要修正';
  }
});

$('settings-reset').addEventListener('click', () => {
  for (const [key, value] of Object.entries(settingsDefaults)) {
    const el = $(`set-${key}`);
    if (el.type === 'checkbox') el.checked = Boolean(value);
    else el.value = value;
  }
  syncSloganText();
  showErrors({});
  $('settings-status').textContent = '已填回預設值，按「儲存設定」才會生效';
});

// 右側欄：目前的快捷鍵
async function loadHotkeys() {
  const keys = await window.api.getHotkeys();
  $('key-meeting').textContent = keys.meeting;
  $('key-escape').textContent = keys.escape;
  $('key-early').textContent = keys.early;
}

load();
loadHotkeys();
updateCup();
setInterval(updateCup, 1000);
// 視窗拿回焦點時重新整理；正在補寫紀錄時不要把編輯框洗掉
window.addEventListener('focus', () => { if (!document.querySelector('.note-editor, .confirm-delete')) load(); });

// ---------- 右側欄：Lock-in 專注模式按鈕 ----------
function updateFocus(phase) {
  const btn = $('focus-toggle');
  const on = phase === 'meeting';
  btn.setAttribute('aria-pressed', String(on));
  btn.disabled = phase === 'locked' || phase === 'focusWrap';
  $('focus-sub').textContent = on ? '專注中，按一下結束'
    : phase === 'focusWrap' ? '正在收尾，水退光就休息'
    : phase === 'locked' ? '休息中'
    : '按一下開始專注，沒有時長限制';
}
$('focus-toggle').addEventListener('click', async () => {
  const phase = await window.api.toggleFocus();
  updateFocus(phase);
  updateCup();
});

// ---------- 補寫或修改某一段的紀錄 ----------
$('day').addEventListener('click', async (e) => {
  const editBtn = e.target.closest('.edit-note');
  if (editBtn) {
    const seg = visible.find((x) => x.id === Number(editBtn.dataset.id));
    const noteEl = editBtn.closest('.note');
    if (!seg || !noteEl || noteEl.querySelector('.note-editor')) return;
    noteEl.innerHTML = `<div class="note-editor">
        <textarea aria-label="這段時間做了什麼"></textarea>
        <div class="row"><button type="button" class="cancel">取消</button><button type="button" class="save" data-id="${seg.id}">儲存</button></div>
      </div>`;
    const box = noteEl.querySelector('textarea');
    box.value = seg.note || '';
    box.focus();
    return;
  }
  // 刪除：先在同一行問一次，按「刪除」才真的刪
  const del = e.target.closest('.delete-seg');
  if (del) {
    const actions = del.closest('.seg-actions');
    actions.innerHTML = `<span class="confirm-delete" role="group" aria-label="確定要刪除這一段嗎？">確定刪除？
        <button type="button" class="cancel-delete">取消</button>
        <button type="button" class="do-delete" data-id="${Number(del.dataset.id)}">刪除</button></span>`;
    actions.querySelector('.cancel-delete').focus();
    return;
  }
  const doDel = e.target.closest('.do-delete');
  if (doDel) {
    doDel.disabled = true;
    await window.api.deleteSegment(doDel.dataset.id);
    load();
    updateCup();
    return;
  }
  if (e.target.closest('.cancel-delete')) { load(); return; }
  const save = e.target.closest('.note-editor .save');
  if (save) {
    const text = save.closest('.note-editor').querySelector('textarea').value;
    save.disabled = true;
    await window.api.updateNote(save.dataset.id, text);
    load();
    return;
  }
  if (e.target.closest('.note-editor .cancel')) load();
});
$('day').addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && (e.target.closest('.note-editor') || e.target.closest('.confirm-delete'))) load();
});

// 點時間軸上的區塊：捲到下面清單裡那一段，並亮一下
$('day').addEventListener('click', (e) => {
  const bar = e.target.closest('.track .seg');
  if (!bar) return;
  const item = $(`seg-${bar.dataset.i}`);
  if (!item) return;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  item.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' });
  item.classList.remove('flash');
  void item.offsetWidth;
  item.classList.add('flash');
  item.focus({ preventScroll: true });
});
