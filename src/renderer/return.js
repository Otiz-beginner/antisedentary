'use strict';

// 回來開始新的一段時的補記卡：剛才那段做了什麼、站起來做了什麼。
// 打字就自動存（停 0.4 秒），所以按「完成」或 × 收起都不會掉字。
const $ = (id) => document.getElementById(id);
const pad = (n) => String(n).padStart(2, '0');
const hm = (ms) => { const d = new Date(ms); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const span = (r) => `${hm(r.startedAt)}–${hm(r.endedAt)}`;

function autosave(box, kind, id) {
  let timer = null;
  box.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      await window.api.saveReturnNote(kind, id, box.value);
      $('saved').textContent = '已自動儲存';
    }, 400);
  });
  // 收起前把還沒存的字存掉
  return () => { clearTimeout(timer); return window.api.saveReturnNote(kind, id, box.value); };
}

const flushers = [];
window.api.onReturnCard(({ segment, break: rest }) => {
  $('card').classList.add('enter');
  $('seg-field').hidden = !segment;
  $('rest-field').hidden = !rest;
  if (segment) {
    $('seg-when').textContent = span(segment);
    flushers.push(autosave($('seg-note'), 'segment', segment.id));
  }
  if (rest) {
    $('rest-when').textContent = span(rest);
    flushers.push(autosave($('rest-note'), 'break', rest.id));
  }
});

async function close() {
  await Promise.all(flushers.map((f) => f()));
  window.api.closeReturnCard();
}
$('done').addEventListener('click', close);
$('close').addEventListener('click', close);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
