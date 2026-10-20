'use strict';

// 使用教學：一頁一頁看，最後一頁按「開始使用」。← → 換頁，Enter 下一步。
const slides = [...document.querySelectorAll('.slide')];
const dots = document.getElementById('dots');
const prev = document.getElementById('prev');
const next = document.getElementById('next');
const progress = document.getElementById('progress');
let index = 0;

dots.innerHTML = slides.map(() => '<i></i>').join('');

function show(i) {
  index = Math.max(0, Math.min(slides.length - 1, i));
  slides.forEach((s, n) => s.classList.toggle('active', n === index));
  [...dots.children].forEach((d, n) => d.classList.toggle('on', n === index));
  prev.hidden = index === 0;
  const last = index === slides.length - 1;
  next.textContent = last ? '開始使用' : '下一步';
  progress.textContent = `第 ${index + 1} 頁，共 ${slides.length} 頁`;
  next.focus();
}

next.addEventListener('click', () => {
  if (index === slides.length - 1) window.api.finishTutorial();
  else show(index + 1);
});
prev.addEventListener('click', () => show(index - 1));
document.getElementById('tour-close').addEventListener('click', () => window.api.closeTutorial());
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') window.api.closeTutorial();
  else if (e.key === 'ArrowRight') show(index + 1);
  else if (e.key === 'ArrowLeft') show(index - 1);
});

// 第 6 頁顯示目前設定的快捷鍵
window.api.getHotkeys().then(({ meeting, escape, early }) => {
  document.getElementById('key-meeting').textContent = meeting;
  document.getElementById('key-escape').textContent = escape;
  document.getElementById('key-early').textContent = early;
}).catch(() => {});

show(0);
