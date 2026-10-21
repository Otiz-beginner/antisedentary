'use strict';

const { initialState, step } = require('../core/machine');

// 把狀態機吐出的 effects 轉成實際動作：視窗、資料庫、輸入鎖。
function createController({ config, db, ui, startLock, host, now = Date.now, getIdleMs }) {
  let state = initialState();
  let draft = '';
  let lockHandle = null;
  let quitted = false;
  // 鎖定中由 lockhelper 偵測的兩組快捷鍵（Windows virtual-key code），預設 M、E
  let hotkeys = { meetingVk: 0x4d, escapeVk: 0x45 };
  // 用快捷鍵叫出的提早休息卡片（可以收起；到了提醒時間就變成正常提醒卡）
  let earlyOpen = false;
  // 最近存的那一段（回來時的補記卡要知道它的 id）
  let lastSaved = null;

  const sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();

  function run(effect) {
    switch (effect.type) {
      case 'showReminder':
        // kind：'reminder' 正常提醒卡、'focus' Lock-in 結束的收尾卡（都不能收起）
        ui.showReminder({ startsAt: effect.startsAt, endsAt: effect.endsAt, note: draft, kind: effect.kind || 'reminder' });
        break;
      case 'hideReminder':
        ui.hideReminder();
        break;
      case 'showQuestion':
        ui.showQuestion({ startsAt: effect.startsAt, endsAt: effect.endsAt });
        break;
      case 'hideQuestion':
        ui.hideQuestion();
        break;
      case 'saveSegment':
        lastSaved = {
          id: db.insertSegment({
            startedAt: effect.startedAt,
            endedAt: effect.endedAt,
            endReason: effect.endReason,
            note: draft.trim(),
            host,
          }),
          startedAt: effect.startedAt,
          endedAt: effect.endedAt,
        };
        draft = '';
        break;
      case 'showReturnCard': {
        // 剛才那段：找得到才給 id（沒找到就只問離開的那段）
        const seg = lastSaved && lastSaved.startedAt === effect.segment.startedAt ? lastSaved : null;
        // 離開的時間存成一段休息；跨夜（睡一覺回來）不算休息
        let rest = null;
        if (effect.breakEndedAt > effect.breakStartedAt && sameDay(effect.breakStartedAt, effect.breakEndedAt)) {
          const b = { startedAt: effect.breakStartedAt, endedAt: effect.breakEndedAt, host };
          rest = { id: db.insertBreak(b), startedAt: b.startedAt, endedAt: b.endedAt };
        }
        if (seg || rest) ui.showReturnCard({ segment: seg, break: rest });
        break;
      }
      case 'saveMeeting':
        db.insertMeeting({ startedAt: effect.startedAt, endedAt: effect.endedAt, host });
        break;
      case 'lock':
        ui.showLock({ startsAt: effect.startsAt, endsAt: effect.endsAt });
        try {
          lockHandle = startLock({
            maxSeconds: Math.ceil(config.lockMs / 1000) + 5,
            meetingVk: hotkeys.meetingVk,
            escapeVk: hotkeys.escapeVk,
            onMeetingHotkey: () => dispatch({ type: 'meetingOn', now: now() }),
            onEscapeHotkey: () => dispatch({ type: 'escape', now: now() }),
          });
        } catch (err) {
          console.error('input lock failed to start:', err);
          lockHandle = null;
        }
        break;
      case 'unlock':
        if (lockHandle) lockHandle.stop();
        lockHandle = null;
        ui.hideLock();
        break;
      default:
        throw new Error(`unknown effect ${effect.type}`);
    }
  }

  function dispatch(input) {
    const wasMeeting = state.phase === 'meeting';
    const prevPhase = state.phase;
    const out = step(state, input, config);
    state = out.state;
    out.effects.forEach(run);
    // 切換到休息、專注或還沒計時的那一刻，沒被存進任何一段的筆記就丟掉，不能跑進下一段
    // （只在切換時清：還沒計時時打開提早休息卡打字，不會被每秒的 tick 洗掉）
    if (state.phase !== prevPhase && ['locked', 'meeting', 'away'].includes(state.phase)) draft = '';
    const isMeeting = state.phase === 'meeting';
    if (isMeeting !== wasMeeting) ui.setMeetingIndicator(isMeeting);
    // 提早休息卡片只在工作中存在：變成提醒卡就交給提醒卡，其他狀態就收起
    if (earlyOpen && state.phase !== 'working') {
      earlyOpen = false;
      if (state.phase !== 'reminder') ui.hideReminder();
    }
  }

  function closeEarlyCard() {
    if (!earlyOpen) return;
    earlyOpen = false;
    ui.hideReminder();
  }

  // 提早休息快捷鍵：叫出或收起右下角卡片。水位跟提醒卡一樣以鎖定時間為準，
  // 離鎖定還超過收尾時間就是滿的
  function toggleEarlyCard() {
    if (earlyOpen) { closeEarlyCard(); return; }
    if (state.phase !== 'working' && state.phase !== 'away') return;
    if (state.ask) return; // 「剛剛有站起來嗎？」還在，不要疊在它上面
    const lockAt = state.phase === 'working' ? state.segStart + config.workMs + config.reminderMs : null;
    earlyOpen = true;
    ui.showReminder({
      startsAt: lockAt === null ? null : lockAt - config.reminderMs,
      endsAt: lockAt,
      note: draft,
      kind: 'early', // 可以收起
    });
  }

  return {
    tick: () => dispatch({ type: 'tick', now: now(), idleMs: getIdleMs() }),
    dispatch,
    // 從 dashboard 提早休息：寫的內容存進這一段（沒寫就沿用提醒卡上的草稿）
    breakNow(note = '') {
      if (String(note).trim()) draft = String(note);
      dispatch({ type: 'startBreak', now: now(), source: 'dashboard' });
      draft = ''; // 沒被採用（例如 Lock-in 專注中）也不能留到下一段
    },
    // 使用者在 dashboard 改了設定：之後的判斷都用新的時間
    setConfig: (next) => { config = next; },
    setHotkeys: (next) => { hotkeys = { ...next }; },
    // 回答「剛剛有站起來嗎？」
    answer: (stood) => dispatch({ type: 'answer', now: now(), stood: Boolean(stood) }),
    // 只有提醒卡出現時才收草稿：存檔後才晚到的草稿不能跑進下一段
    setDraftNote: (text) => {
      if (state.phase === 'reminder' || state.phase === 'focusWrap' || earlyOpen) draft = String(text ?? '');
    },
    toggleEarlyCard,
    closeEarlyCard,
    quit() {
      if (quitted) return;
      quitted = true;
      dispatch({ type: 'quit', now: now() });
    },
    // 給 dashboard 側欄用的目前狀態
    status() {
      const s = { phase: state.phase };
      if (state.segStart !== undefined) s.segStart = state.segStart;
      if (state.lockUntil !== undefined) s.lockUntil = state.lockUntil;
      if (state.meetingStart !== undefined) s.meetingStart = state.meetingStart;
      if (state.idleFrom !== undefined) s.idleFrom = state.idleFrom;
      s.now = now();
      return s;
    },
    get phase() { return state.phase; },
    get inMeeting() { return state.phase === 'meeting'; },
  };
}

module.exports = { createController };
