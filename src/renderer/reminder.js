'use strict';

// 提醒卡：水位從滿退到 0（29:00 → 32:00），不顯示任何數字。
const card = document.getElementById('card');
const note = document.getElementById('note');
let timer = null;
let debounce = null;

const clamp01 = (x) => Math.min(1, Math.max(0, x));

window.api.onReminder(({ startsAt, endsAt }) => {
  note.value = '';
  card.classList.remove('enter');
  void card.offsetWidth; // 重新觸發浮上來的動畫
  card.classList.add('enter');

  const update = () => card.style.setProperty('--level', clamp01(1 - (Date.now() - startsAt) / (endsAt - startsAt)));
  update();
  clearInterval(timer);
  timer = setInterval(update, 250);
});

note.addEventListener('input', () => {
  clearTimeout(debounce);
  debounce = setTimeout(() => window.api.setDraftNote(note.value), 300);
});

document.getElementById('start').addEventListener('click', () => {
  clearTimeout(debounce);
  window.api.setDraftNote(note.value);
  window.api.startBreak();
});
