'use strict';

const childProcess = require('node:child_process');
const readline = require('node:readline');

// 啟動 lockhelper.exe 擋住滑鼠鍵盤（spec §4.3）。helper 自己有 --max-seconds 安全上限，
// 並在 stdin 關閉時結束，所以主程式不論怎麼死掉，輸入都會恢復。
function startInputLock({
  exePath, prefixArgs = [], maxSeconds, meetingVk, escapeVk,
  onMeetingHotkey = () => {}, onEscapeHotkey = () => {}, spawn = childProcess.spawn,
}) {
  const args = [...prefixArgs, '--max-seconds', String(maxSeconds)];
  // 開會模式、緊急逃出各自的按鍵（Ctrl+Alt+Shift+這個鍵）
  if (meetingVk !== undefined) args.push('--meeting-vk', String(meetingVk));
  if (escapeVk !== undefined) args.push('--escape-vk', String(escapeVk));
  const child = spawn(exePath, args, {
    stdio: ['pipe', 'pipe', 'ignore'],
    windowsHide: true,
  });

  let markReady;
  let failReady;
  const ready = new Promise((resolve, reject) => { markReady = resolve; failReady = reject; });
  ready.catch(() => {}); // 呼叫端不一定會等 ready
  const exited = new Promise((resolve) => {
    child.once('exit', (code) => { failReady(new Error(`lock helper exited (${code}) before READY`)); resolve(code); });
    child.once('error', (err) => { failReady(err); resolve(null); });
  });

  readline.createInterface({ input: child.stdout }).on('line', (line) => {
    const msg = line.trim();
    if (msg === 'READY') markReady();
    else if (stopped) return; // 已經解鎖了，晚到的快捷鍵不算
    else if (msg === 'MEETING') onMeetingHotkey();
    else if (msg === 'ESCAPE') onEscapeHotkey();
  });
  child.stdin.on('error', () => {}); // helper 先結束時寫入會 EPIPE，忽略

  let stopped = false;
  function stop() {
    if (stopped) return;
    stopped = true;
    if (child.exitCode !== null || child.pid === undefined) return;
    try {
      child.stdin.write('STOP\n');
      child.stdin.end();
    } catch { /* 已經結束 */ }
    const killer = setTimeout(() => child.kill(), 500);
    killer.unref();
    exited.then(() => clearTimeout(killer));
  }

  return { ready, exited, stop, child };
}

module.exports = { startInputLock };
