'use strict';

const MINUTE = 60 * 1000;

// 一輪的時間（spec §3）。ANTISEDENTARY_SPEED 會把所有時間除以這個倍數，方便開發測試。
function getConfig(env = process.env) {
  const parsed = Number(env.ANTISEDENTARY_SPEED);
  const speed = Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
  const scale = (ms) => Math.round(ms / speed);
  return {
    workMs: scale(29 * MINUTE),
    reminderMs: scale(3 * MINUTE),
    lockMs: scale(3 * MINUTE),
    idleResetMs: scale(3 * MINUTE),
    shortIdleSegmentMs: scale(5 * MINUTE),
    askMaxMs: scale(30 * MINUTE),   // 離開超過這麼久就不問「剛剛有站起來嗎？」，直接算休息
    askTimeoutMs: scale(60 * 1000), // 問題卡沒人回答多久後，當作「還坐著」
    tickMs: Math.max(250, Math.min(1000, scale(1000))),
    speed,
  };
}

module.exports = { getConfig };
