'use strict';

// 鎖定畫面：背景（模糊的螢幕照片或內建桌布）和標語每個螢幕都有，卡片只在主螢幕。水從杯底漲滿，旁邊顯示 m:ss 倒數。時間到由 main 關閉視窗。
const card = document.getElementById('card');
const clock = document.getElementById('clock');
let timer = null;

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const mss = (ms) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

const backdrop = document.getElementById('backdrop');
const slogan = document.getElementById('slogan');

// 背景與標語每個螢幕都顯示；倒數卡片只放在主螢幕
function paintBackground(background, image) {
  if (background === 'wallpaper') {
    backdrop.className = 'backdrop wallpaper ready';
  } else if (image) {
    backdrop.className = 'backdrop blur';
    backdrop.style.backgroundImage = `url("${image}")`;
    // 下一個畫格才加 ready，照片才會淡入
    requestAnimationFrame(() => backdrop.classList.add('ready'));
  }
}

window.api.onLock(({ startsAt, endsAt, primary, background, backdrop: image, slogan: words }) => {
  paintBackground(background, image);
  slogan.textContent = words || '';
  slogan.hidden = !words;
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
