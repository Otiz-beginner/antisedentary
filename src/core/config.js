'use strict';

const { DEFAULTS, toConfig } = require('./settings');

// 程式用的時間（毫秒）。settings 是使用者在 dashboard 調的值；
// ANTISEDENTARY_SPEED 會把所有時間除以這個倍數，方便開發測試。
function getConfig(env = process.env, settings = DEFAULTS) {
  const parsed = Number(env.ANTISEDENTARY_SPEED);
  const speed = Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
  return toConfig(settings, speed);
}

module.exports = { getConfig };
