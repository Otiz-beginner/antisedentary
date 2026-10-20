'use strict';

// 提醒卡：水位以鎖定時間為準退到 0，不顯示任何數字。
// 用快捷鍵叫出的提早休息卡片（dismissible）長得一樣，多一個右上角的 ×；
// 離鎖定還超過收尾時間時水是滿的，還沒開始計時（沒有 endsAt）也是滿的。
const card = document.getElementById('card');
const note = document.getElementById('note');
const close = document.getElementById('close');
const title = document.getElementById('title');
let timer = null;

const clamp01 = (x) => Math.min(1, Math.max(0, x));

// kind：reminder 正常提醒、early 用快捷鍵叫出的提早休息（可以收起）、focus Lock-in 結束的收尾
const TITLES = { reminder: '快到休息時間了', early: '要提早休息嗎？', focus: 'Lock-in 結束了' };
const HINTS = { reminder: '這段時間做了什麼？（可以不寫）', early: '這段時間做了什麼？（可以不寫）', focus: '這段專注做了什麼？（可以不寫）' };

window.api.onReminder(({ startsAt, endsAt, note: draft = '', kind = 'reminder' }) => {
  note.value = draft;
  close.hidden = kind !== 'early';
  title.textContent = TITLES[kind] || TITLES.reminder;
  note.placeholder = HINTS[kind] || HINTS.reminder;
  card.classList.remove('enter');
  void card.offsetWidth; // 重新觸發浮上來的動畫
  card.classList.add('enter');

  const update = () => {
    const level = endsAt ? 1 - (Date.now() - startsAt) / (endsAt - startsAt) : 1;
    card.style.setProperty('--level', clamp01(level));
  };
  update();
  clearInterval(timer);
  timer = setInterval(update, 250);
});

// 每次輸入都立刻送出，鎖定那一刻的草稿才會是完整的
note.addEventListener('input', () => window.api.setDraftNote(note.value));

document.getElementById('start').addEventListener('click', () => {
  window.api.setDraftNote(note.value);
  window.api.startBreak();
});

close.addEventListener('click', () => window.api.dismissCard());
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !close.hidden) window.api.dismissCard(); });
