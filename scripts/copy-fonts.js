'use strict';
// 把需要的字型（粉圓 400、Noto Sans TC 400/500/700、Luckiest Guy）從 @fontsource 複製到 src/renderer/fonts，
// 程式執行時就不用連網路（spec §7）。只保留 woff2。
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const outDir = path.join(root, 'src', 'renderer', 'fonts');
const outFiles = path.join(outDir, 'files');
const wanted = [
  ['huninn', '400'],
  ['noto-sans-tc', '400'],
  ['noto-sans-tc', '500'],
  ['noto-sans-tc', '700'],
  ['luckiest-guy', '400'], // 休息畫面的 POP 大字
];

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outFiles, { recursive: true });

const sheets = [];
for (const [pkg, weight] of wanted) {
  const pkgDir = path.join(root, 'node_modules', '@fontsource', pkg);
  let css = fs.readFileSync(path.join(pkgDir, `${weight}.css`), 'utf8');
  // 只留 woff2 來源
  css = css.replace(/,\s*url\([^)]*\.woff\)\s*format\('woff'\)/g, '');
  for (const [, file] of css.matchAll(/url\(\.\/files\/([^)]+\.woff2)\)/g)) {
    fs.copyFileSync(path.join(pkgDir, 'files', file), path.join(outFiles, file));
  }
  sheets.push(css);
}
fs.writeFileSync(path.join(outDir, 'fonts.css'), sheets.join('\n'));
console.log(`fonts copied to ${path.relative(root, outDir)}`);
