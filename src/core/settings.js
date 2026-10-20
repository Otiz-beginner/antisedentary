'use strict';

const { KEYS } = require('./hotkeys');

// 使用者可以在 dashboard 調整的設定。時間存的是「分鐘／秒」，toConfig 再換成程式用的毫秒。
const MINUTE = 60 * 1000;

const DEFAULTS = Object.freeze({
  cycleMinutes: 32,
  reminderMinutes: 3,
  restMinutes: 3,
  idlePauseMinutes: 3,
  askMaxMinutes: 30,
  askTimeoutSeconds: 60,
  meetingKey: 'M',
  escapeKey: 'E',
  earlyKey: 'B',
  autoStart: true,
  restBackground: 'blur',
  restSlogan: 'break',
  restSloganText: '',
});

// 休息畫面中央的標語
const SLOGANS = Object.freeze({ break: 'TAKE A BREAK', fish: '摸魚中…', none: '' });
const SLOGAN_MAX = 20;

const FIELDS = Object.freeze([
  {
    key: 'cycleMinutes', group: 'time', short: '工作時長', label: '工作多久要休息', kind: 'minutes', unit: '分鐘', min: 10, max: 120,
    help: '從開始計時到螢幕鎖定、強制休息的總時間，包含最後的收尾時間。例如設 32 分鐘、收尾 3 分鐘，第 29 分鐘會出現提醒卡，第 32 分鐘鎖定。',
  },
  {
    key: 'reminderMinutes', group: 'time', short: '收尾時間', label: '提醒卡出現到鎖定', kind: 'minutes', unit: '分鐘', min: 1, max: 10,
    help: '提醒卡出現後，給你多久整理手邊的事、寫下這段做了什麼。卡片上的水會在這段時間內慢慢退光，退光就鎖定。',
  },
  {
    // 鎖鍵盤滑鼠的小程式最多只會鎖 10 分鐘（安全上限）
    key: 'restMinutes', group: 'time', short: '休息時長', label: '鎖定多久', kind: 'minutes', unit: '分鐘', min: 1, max: 10,
    help: '鎖定休息的時間。這段時間滑鼠和鍵盤會被擋住，讓你起來走走、看看遠方。為了安全，最多 10 分鐘。',
  },
  {
    key: 'idlePauseMinutes', group: 'time', short: '暫停判定', label: '離開多久算暫停', kind: 'minutes', unit: '分鐘', min: 1, max: 15,
    help: '多久沒碰滑鼠和鍵盤就暫停計時。暫停不會歸零，回來時右下角會問「剛剛有站起來嗎？」再決定要不要歸零。',
  },
  {
    key: 'askMaxMinutes', group: 'time', short: '手機上限', label: '離開超過多久就算休息', kind: 'minutes', unit: '分鐘', min: 5, max: 180,
    help: '離開超過這麼久，就直接當作你有站起來休息過，回來時不再詢問，計時從 0 開始。適合吃飯、出門回來的情況。',
  },
  {
    key: 'askTimeoutSeconds', group: 'time', short: '回答等待', label: '問題卡多久沒回答算還坐著', kind: 'seconds', unit: '秒', min: 15, max: 300,
    help: '回來時出現「剛剛有站起來嗎？」的卡片，等你多久。時間到還沒回答，就當作你一直坐著，離開的時間也算進工作時間。',
  },
  {
    key: 'meetingKey', group: 'hotkey', short: 'Lock-in 快捷鍵', label: 'Lock-in 專注模式快捷鍵', kind: 'hotkey',
    help: '按一次進入 Lock-in 專注模式，再按一次結束。專注中沒有工作時長限制，不會提醒也不會鎖定；結束時右下角會請你寫下這段專注做了什麼，接著進入休息。就算正在鎖定休息，按下也會立刻解鎖並進入專注。',
  },
  {
    key: 'escapeKey', group: 'hotkey', short: '緊急逃出快捷鍵', label: '緊急逃出快捷鍵', kind: 'hotkey',
    help: '鎖定休息時遇到急事，按下就立刻解鎖、結束這次休息，計時從 0 開始，之後照常提醒。只有在鎖定中按才有作用。',
  },
  {
    key: 'earlyKey', group: 'hotkey', short: '提早休息快捷鍵', label: '提早休息快捷鍵', kind: 'hotkey',
    help: '想提早休息時按一下，右下角會浮出跟提醒卡一樣的小卡片，可以寫下這段做了什麼再開始休息。不想休息了，按卡片右上角的 × 或再按一次就收起來。',
  },
  {
    key: 'autoStart', group: 'other', short: '開機自動啟動', label: '開機自動啟動', kind: 'toggle',
    help: '登入 Windows 時自動開啟這個程式。關掉的話，要自己打開 Antisedentary 才會開始計時與提醒。',
  },
  {
    key: 'restBackground', group: 'rest', short: '休息背景', label: '休息時的背景', kind: 'choice',
    options: [{ value: 'blur', label: '模糊目前畫面' }, { value: 'wallpaper', label: '內建桌布' }],
    help: '「模糊目前畫面」會在鎖定前把螢幕拍下來再模糊，看得出剛剛在做什麼但看不清楚；「內建桌布」改成一張固定的柔和風景。',
  },
  {
    key: 'restSlogan', group: 'rest', short: '休息標語', label: '休息畫面中央的標語', kind: 'choice',
    options: [
      { value: 'break', label: 'TAKE A BREAK' }, { value: 'fish', label: '摸魚中…' },
      { value: 'none', label: '不顯示' }, { value: 'custom', label: '自己輸入' },
    ],
    help: '休息時畫面中央的大字。選「自己輸入」可以寫自己想看的話，例如「去裝水」。',
  },
  {
    key: 'restSloganText', group: 'rest', short: '自訂標語', label: '自己輸入的標語', kind: 'text', max: SLOGAN_MAX,
    help: `「休息標語」選「自己輸入」時顯示的文字，最多 ${SLOGAN_MAX} 個字。`,
  },
]);

function validate(input = {}) {
  const value = {};
  const errors = {};
  for (const f of FIELDS) {
    if (f.kind === 'text') {
      const text = String(input[f.key] ?? '').trim();
      if ([...text].length > f.max) errors[f.key] = `最多 ${f.max} 個字`;
      else value[f.key] = text;
      continue;
    }
    const raw = input[f.key] === undefined || input[f.key] === '' ? DEFAULTS[f.key] : input[f.key];
    if (f.kind === 'toggle') {
      if (raw === true || raw === 'true' || raw === 'on') value[f.key] = true;
      else if (raw === false || raw === 'false' || raw === 'off') value[f.key] = false;
      else errors[f.key] = '請選擇開或關';
      continue;
    }
    if (f.kind === 'choice') {
      if (f.options.some((o) => o.value === raw)) value[f.key] = raw;
      else errors[f.key] = '請從清單裡選一個';
      continue;
    }
    if (f.kind === 'hotkey') {
      if (KEYS.includes(raw)) value[f.key] = raw;
      else errors[f.key] = '請從清單裡選一個';
      continue;
    }
    const n = Number(raw);
    if (!Number.isInteger(n)) errors[f.key] = '請輸入整數';
    else if (n < f.min || n > f.max) errors[f.key] = `請輸入 ${f.min} 到 ${f.max}`;
    else value[f.key] = n;
  }
  if (!errors.cycleMinutes && !errors.reminderMinutes && value.cycleMinutes < value.reminderMinutes + 5) {
    errors.cycleMinutes = `至少要比收尾時間多 5 分鐘（${value.reminderMinutes + 5} 以上）`;
  }
  if (!errors.askMaxMinutes && !errors.idlePauseMinutes && value.askMaxMinutes <= value.idlePauseMinutes) {
    errors.askMaxMinutes = '要比「暫停判定」更長';
  }
  if (!errors.meetingKey && !errors.escapeKey && value.meetingKey === value.escapeKey) {
    errors.escapeKey = '不能跟 Lock-in 用同一組';
  }
  if (!errors.earlyKey && (value.earlyKey === value.meetingKey || value.earlyKey === value.escapeKey)) {
    errors.earlyKey = '不能跟其他快捷鍵用同一組';
  }
  if (!errors.restSlogan && !errors.restSloganText && value.restSlogan === 'custom' && !value.restSloganText) {
    errors.restSloganText = '請輸入標語，或改選其他標語';
  }
  const ok = Object.keys(errors).length === 0;
  return ok ? { ok, value, errors } : { ok, errors };
}

// 休息畫面上要顯示的字
function sloganFor(settings) {
  return settings.restSlogan === 'custom' ? String(settings.restSloganText ?? '') : SLOGANS[settings.restSlogan] ?? '';
}

function toConfig(settings, speed = 1) {
  const scale = (ms) => Math.round(ms / speed);
  return {
    workMs: scale((settings.cycleMinutes - settings.reminderMinutes) * MINUTE),
    reminderMs: scale(settings.reminderMinutes * MINUTE),
    lockMs: scale(settings.restMinutes * MINUTE),
    idleResetMs: scale(settings.idlePauseMinutes * MINUTE),
    askMaxMs: scale(settings.askMaxMinutes * MINUTE),
    askTimeoutMs: scale(settings.askTimeoutSeconds * 1000),
    shortIdleSegmentMs: scale(5 * MINUTE),
    tickMs: Math.max(250, Math.min(1000, scale(1000))),
    speed,
  };
}

module.exports = { DEFAULTS, FIELDS, validate, toConfig, sloganFor };
