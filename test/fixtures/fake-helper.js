'use strict';
// 模擬 lockhelper.exe 的協定：啟動印 READY；--emit-meeting / --emit-escape 時接著印 MEETING / ESCAPE；
// stdin 收到 EOF 或 STOP 就結束。
process.stdout.write('READY\n');
if (process.argv.includes('--emit-meeting')) process.stdout.write('MEETING\n');
if (process.argv.includes('--emit-escape')) process.stdout.write('ESCAPE\n');
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { if (chunk.includes('STOP')) process.exit(0); });
process.stdin.on('end', () => process.exit(0));
