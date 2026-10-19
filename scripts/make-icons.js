'use strict';
// 產生系統匣和程式圖示：一滴水。水藍 #92C7FF（平常），淡紫 #D2BAFF（開會模式）。
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

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
  header[8] = 8; header[9] = 6; // 8-bit RGBA
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}

// 水滴：下半是圓，上半收成尖端。用 4x4 超取樣做反鋸齒。
function inDrop(x, y) {
  const cx = 0.5, cy = 0.62, r = 0.3;
  if (y >= cy) return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
  const top = 0.08;
  if (y < top) return false;
  const t = (y - top) / (cy - top); // 0 在尖端，1 在圓心高度
  return Math.abs(x - cx) <= r * Math.sin((t * Math.PI) / 2);
}
function drop(size, [r, g, b]) {
  const buf = Buffer.alloc(size * size * 4);
  const n = 4;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let hit = 0;
      for (let sy = 0; sy < n; sy++) for (let sx = 0; sx < n; sx++) {
        if (inDrop((px + (sx + 0.5) / n) / size, (py + (sy + 0.5) / n) / size)) hit++;
      }
      const i = (py * size + px) * 4;
      buf[i] = r; buf[i + 1] = g; buf[i + 2] = b; buf[i + 3] = Math.round((hit / (n * n)) * 255);
    }
  }
  return png(size, buf);
}

const out = path.join(__dirname, '..', 'assets');
fs.mkdirSync(out, { recursive: true });
const WATER = [0x92, 0xc7, 0xff];
const LILAC = [0xd2, 0xba, 0xff];
fs.writeFileSync(path.join(out, 'tray.png'), drop(16, WATER));
fs.writeFileSync(path.join(out, 'tray@2x.png'), drop(32, WATER));
fs.writeFileSync(path.join(out, 'tray-meeting.png'), drop(16, LILAC));
fs.writeFileSync(path.join(out, 'tray-meeting@2x.png'), drop(32, LILAC));
fs.writeFileSync(path.join(out, 'icon.png'), drop(256, WATER));
console.log('icons written to assets/');
