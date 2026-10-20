'use strict';
// 產生圖示：一個坐在椅子上、對著桌上電腦的人的側面剪影。
// 同一組形狀輸出：系統匣 PNG（平常霧藍、開會淡紫）、程式圖示 PNG、紀錄頁左上角用的 SVG。
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

// ---------- 形狀（座標在 0..1 的正方形裡） ----------
// circle: [cx, cy, r]；line: [x1, y1, x2, y2, r]（兩端圓頭的粗線）
const FIGURE = {
  circles: [[0.40, 0.17, 0.10]],                       // 頭
  lines: [
    [0.38, 0.31, 0.34, 0.56, 0.085],                     // 身體
    [0.38, 0.35, 0.50, 0.47, 0.045],                     // 上臂
    [0.50, 0.47, 0.66, 0.44, 0.040],                     // 前臂（打字）
    [0.34, 0.58, 0.62, 0.60, 0.075],                     // 大腿
    [0.64, 0.62, 0.63, 0.86, 0.060],                     // 小腿
    [0.63, 0.88, 0.73, 0.88, 0.035],                     // 腳
  ],
};
const CHAIR = {
  circles: [],
  lines: [
    [0.19, 0.30, 0.21, 0.66, 0.032],                     // 椅背
    [0.21, 0.70, 0.55, 0.70, 0.030],                     // 椅面
    [0.36, 0.72, 0.36, 0.90, 0.026],                     // 椅腳
    [0.24, 0.92, 0.48, 0.92, 0.026],                     // 椅座
  ],
};
const DESK = {
  circles: [],
  lines: [
    [0.70, 0.48, 0.95, 0.48, 0.026],                     // 桌面
    [0.89, 0.50, 0.89, 0.92, 0.024],                     // 桌腳
    [0.80, 0.45, 0.85, 0.29, 0.024],                     // 螢幕
  ],
};

function segDist(px, py, [x1, y1, x2, y2]) {
  const dx = x2 - x1, dy = y2 - y1;
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}
function inside(parts, x, y) {
  for (const p of parts) {
    for (const [cx, cy, r] of p.circles) if (Math.hypot(x - cx, y - cy) <= r) return true;
    for (const l of p.lines) if (segDist(x, y, l) <= l[4]) return true;
  }
  return false;
}

// ---------- PNG ----------
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function png(size, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0); header.writeUInt32BE(size, 4);
  header[8] = 8; header[9] = 6;
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}

// background: null（透明）或 { color, radius }（圓角方塊底）
function render(size, parts, [r, g, b], background = null, pad = 0) {
  const buf = Buffer.alloc(size * size * 4);
  const n = 4;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let fig = 0, bg = 0;
      for (let sy = 0; sy < n; sy++) for (let sx = 0; sx < n; sx++) {
        const u = (px + (sx + 0.5) / n) / size, v = (py + (sy + 0.5) / n) / size;
        const x = (u - pad) / (1 - 2 * pad), y = (v - pad) / (1 - 2 * pad);
        if (inside(parts, x, y)) fig++;
        if (background) {
          const rr = background.radius, cx = Math.min(Math.max(u, rr), 1 - rr), cy = Math.min(Math.max(v, rr), 1 - rr);
          if (Math.hypot(u - cx, v - cy) <= rr) bg++;
        }
      }
      const i = (py * size + px) * 4, a = fig / (n * n), ab = bg / (n * n);
      if (background) {
        const [br, bgc, bb] = background.color;
        buf[i] = Math.round(br + (r - br) * a); buf[i + 1] = Math.round(bgc + (g - bgc) * a); buf[i + 2] = Math.round(bb + (b - bb) * a);
        buf[i + 3] = Math.round(ab * 255);
      } else {
        buf[i] = r; buf[i + 1] = g; buf[i + 2] = b; buf[i + 3] = Math.round(a * 255);
      }
    }
  }
  return png(size, buf);
}

// ---------- SVG（紀錄頁左上角） ----------
function svg(parts, color) {
  const s = (v) => +(v * 64).toFixed(2);
  const shapes = parts.flatMap((p) => [
    ...p.circles.map(([cx, cy, r]) => `<circle cx="${s(cx)}" cy="${s(cy)}" r="${s(r)}"/>`),
    ...p.lines.map(([x1, y1, x2, y2, r]) => `<line x1="${s(x1)}" y1="${s(y1)}" x2="${s(x2)}" y2="${s(y2)}" stroke-width="${s(r * 2)}"/>`),
  ]);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><g fill="${color}" stroke="${color}" stroke-linecap="round">${shapes.join('')}</g></svg>\n`;
}

const out = path.join(__dirname, '..', 'assets');
fs.mkdirSync(out, { recursive: true });
const MIST = [0x5b, 0x86, 0xc0];   // 系統匣平常：比霧藍深一點，淺色工作列上也看得清楚
const LILAC = [0xa9, 0x84, 0xf0];  // 開會模式：淡紫加深
const DEEP = [0x4e, 0x6f, 0xa0];
const ALL = [FIGURE, CHAIR, DESK];
const SMALL = [FIGURE, CHAIR];     // 16px 太小，拿掉桌子
fs.writeFileSync(path.join(out, 'tray.png'), render(16, SMALL, MIST));
fs.writeFileSync(path.join(out, 'tray@2x.png'), render(32, ALL, MIST));
fs.writeFileSync(path.join(out, 'tray-meeting.png'), render(16, SMALL, LILAC));
fs.writeFileSync(path.join(out, 'tray-meeting@2x.png'), render(32, ALL, LILAC));
fs.writeFileSync(path.join(out, 'icon.png'), render(256, ALL, DEEP, { color: [0xd3, 0xd5, 0xff], radius: 0.22 }, 0.12));
fs.writeFileSync(path.join(out, 'logo.svg'), svg(ALL, '#4E6FA0'));
console.log('icons written to assets/');
