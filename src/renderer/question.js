'use strict';

// 回來時的問題卡：水位在 1 分鐘內退光，退光還沒回答就當作「還坐著」（由 main 決定）。
const card = document.getElementById('card');
let timer = null;

const clamp01 = (x) => Math.min(1, Math.max(0, x));

window.api.onQuestion(({ startsAt, endsAt }) => {
  card.classList.remove('enter');
  void card.offsetWidth; // 重新觸發浮上來的動畫
  card.classList.add('enter');

  const update = () => card.style.setProperty('--level', clamp01(1 - (Date.now() - startsAt) / (endsAt - startsAt)));
  update();
  clearInterval(timer);
  timer = setInterval(update, 250);
});

document.getElementById('stood').addEventListener('click', () => window.api.answer(true));
document.getElementById('sitting').addEventListener('click', () => window.api.answer(false));
