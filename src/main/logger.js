'use strict';

const fs = require('node:fs');
const path = require('node:path');

// 簡單的檔案日誌：記錄程式啟動、結束、當機等事件，出問題時才有證據可查。
// 寫日誌本身絕對不能讓程式出錯，所以所有錯誤都吞掉。
function createLogger(file, { maxBytes = 1024 * 1024, now = Date.now } = {}) {
  const pad = (n, w = 2) => String(n).padStart(w, '0');
  const stamp = (ms) => {
    const d = new Date(ms);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} `
      + `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
  };
  const describe = (detail) => {
    if (detail === undefined) return '';
    if (detail instanceof Error) return ` ${detail.stack || detail.message}`;
    try { return ` ${JSON.stringify(detail)}`; } catch { return ` ${String(detail)}`; }
  };

  try { fs.mkdirSync(path.dirname(file), { recursive: true }); } catch { /* 寫不了就算了 */ }

  return function log(message, detail) {
    try {
      if (fs.existsSync(file) && fs.statSync(file).size > maxBytes) fs.renameSync(file, `${file}.1`);
      fs.appendFileSync(file, `${stamp(now())} ${message}${describe(detail)}\n`);
    } catch { /* 寫日誌失敗不影響程式 */ }
  };
}

module.exports = { createLogger };
