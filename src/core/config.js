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
    tickMs: Math.max(250, Math.min(1000, scale(1000))),
    speed,
  };
}

module.exports = { getConfig };
