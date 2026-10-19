'use strict';

// 使用者可以在 dashboard 調整的時間設定。存的是「分鐘／秒」，toConfig 再換成程式用的毫秒。
const MINUTE = 60 * 1000;

const DEFAULTS = Object.freeze({
  cycleMinutes: 32,
  reminderMinutes: 3,
  restMinutes: 3,
  idlePauseMinutes: 3,
  askMaxMinutes: 30,
  askTimeoutSeconds: 60,
});

const FIELDS = Object.freeze([
  { key: 'cycleMinutes', label: '工作多久要休息', unit: '分鐘', min: 10, max: 120, hint: '從開始計時到鎖定' },
  { key: 'reminderMinutes', label: '收尾時間', unit: '分鐘', min: 1, max: 10, hint: '提醒卡出現到鎖定' },
  // 鎖鍵盤滑鼠的小程式最多只會鎖 10 分鐘（安全上限）
  { key: 'restMinutes', label: '休息多久', unit: '分鐘', min: 1, max: 10, hint: '鎖定的時間，最多 10 分鐘' },
  { key: 'idlePauseMinutes', label: '離開多久算暫停', unit: '分鐘', min: 1, max: 15, hint: '沒碰滑鼠鍵盤多久就暫停計時' },
  { key: 'askMaxMinutes', label: '滑手機上限', unit: '分鐘', min: 5, max: 180, hint: '離開超過這麼久就直接算休息，不再詢問' },
  { key: 'askTimeoutSeconds', label: '問題卡等多久', unit: '秒', min: 15, max: 300, hint: '沒回答就當作還坐著' },
]);

function validate(input = {}) {
  const value = {};
  const errors = {};
  for (const f of FIELDS) {
    const raw = input[f.key] === undefined || input[f.key] === '' ? DEFAULTS[f.key] : input[f.key];
    const n = Number(raw);
    if (!Number.isInteger(n)) errors[f.key] = '請輸入整數';
    else if (n < f.min || n > f.max) errors[f.key] = `請輸入 ${f.min} 到 ${f.max}`;
    else value[f.key] = n;
  }
  if (!errors.cycleMinutes && !errors.reminderMinutes && value.cycleMinutes < value.reminderMinutes + 5) {
    errors.cycleMinutes = `至少要比收尾時間多 5 分鐘（${value.reminderMinutes + 5} 以上）`;
  }
  if (!errors.askMaxMinutes && !errors.idlePauseMinutes && value.askMaxMinutes <= value.idlePauseMinutes) {
    errors.askMaxMinutes = '要比「離開多久算暫停」更長';
  }
  const ok = Object.keys(errors).length === 0;
  return ok ? { ok, value, errors } : { ok, errors };
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

module.exports = { DEFAULTS, FIELDS, validate, toConfig };
