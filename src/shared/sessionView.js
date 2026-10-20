'use strict';

// Dashboard 側欄的水杯：把目前狀態轉成要顯示的文字和水位。
// 工作中水位從 0 漲到滿（滿 = 進入鎖定的時間），休息中水重新漲回來。
(function () {
  const clamp01 = (x) => Math.min(1, Math.max(0, x));
  const pad = (n) => String(n).padStart(2, '0');

  function elapsedText(ms) {
    const minutes = Math.floor(ms / 60000);
    if (minutes < 60) return { value: String(minutes), unit: '分' };
    return { value: `${Math.floor(minutes / 60)}:${pad(minutes % 60)}`, unit: '' };
  }

  function sessionView(status, { cycleMs, lockMs }) {
    const { phase, now } = status;
    if (phase === 'working' || phase === 'reminder') {
      const ms = Math.max(0, now - status.segStart);
      return { label: '這一段已經工作', ...elapsedText(ms), level: clamp01(ms / cycleMs), tone: 'work' };
    }
    if (phase === 'paused') {
      const ms = Math.max(0, status.idleFrom - status.segStart);
      return { label: '暫停計時', ...elapsedText(ms), level: clamp01(ms / cycleMs), tone: 'paused' };
    }
    if (phase === 'locked') {
      const left = Math.max(0, status.lockUntil - now);
      const s = Math.ceil(left / 1000);
      return {
        label: '休息一下', value: `${Math.floor(s / 60)}:${pad(s % 60)}`, unit: '',
        level: clamp01(1 - left / lockMs), tone: 'rest',
      };
    }
    if (phase === 'meeting') {
      // Lock-in 沒有時長限制：顯示已經專注多久
      const ms = Math.max(0, now - status.meetingStart);
      return { label: 'Lock-in 專注中', ...elapsedText(ms), level: clamp01(ms / cycleMs), tone: 'meeting' };
    }
    if (phase === 'focusWrap') return { label: 'Lock-in 結束，收尾中', value: '', unit: '', level: 0, tone: 'meeting' };
    return { label: '還沒開始計時', value: '', unit: '', level: 0, tone: 'away' };
  }

  const api = { sessionView };
  if (typeof module !== 'undefined') module.exports = api;
  else window.SessionView = api;
})();
