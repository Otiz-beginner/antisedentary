'use strict';

// 鎖定畫面：只有主螢幕顯示卡片。水從杯底漲滿，旁邊顯示 m:ss 倒數。時間到由 main 關閉視窗。
const card = document.getElementById('card');
const clock = document.getElementById('clock');
let timer = null;

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const mss = (ms) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

window.api.onLock(({ startsAt, endsAt, primary }) => {
  card.hidden = !primary;
  if (!primary) return;
  card.classList.add('enter');
  const update = () => {
    const now = Date.now();
    card.style.setProperty('--level', clamp01((now - startsAt) / (endsAt - startsAt)));
    clock.textContent = mss(endsAt - now);
  };
  update();
  clearInterval(timer);
  timer = setInterval(update, 250);
});
