'use strict';

const { initialState, step } = require('../core/machine');

// 把狀態機吐出的 effects 轉成實際動作：視窗、資料庫、輸入鎖。
function createController({ config, db, ui, startLock, host, now = Date.now, getIdleMs }) {
  let state = initialState();
  let draft = '';
  let lockHandle = null;

  function run(effect) {
    switch (effect.type) {
      case 'showReminder':
        ui.showReminder({ startsAt: effect.startsAt, endsAt: effect.endsAt });
        break;
      case 'hideReminder':
        ui.hideReminder();
        break;
      case 'saveSegment':
        db.insertSegment({
          startedAt: effect.startedAt,
          endedAt: effect.endedAt,
          endReason: effect.endReason,
          note: draft.trim(),
          host,
        });
        draft = '';
        break;
      case 'saveMeeting':
        db.insertMeeting({ startedAt: effect.startedAt, endedAt: effect.endedAt, host });
        break;
      case 'lock':
        ui.showLock({ startsAt: effect.startsAt, endsAt: effect.endsAt });
        try {
          lockHandle = startLock({
            maxSeconds: Math.ceil(config.lockMs / 1000) + 5,
            onMeetingHotkey: () => dispatch({ type: 'meetingOn', now: now() }),
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
    const out = step(state, input, config);
    state = out.state;
    out.effects.forEach(run);
    const isMeeting = state.phase === 'meeting';
    if (isMeeting !== wasMeeting) ui.setMeetingIndicator(isMeeting);
  }

  return {
    tick: () => dispatch({ type: 'tick', now: now(), idleMs: getIdleMs() }),
    dispatch,
    setDraftNote: (text) => { draft = String(text ?? ''); },
    get phase() { return state.phase; },
    get inMeeting() { return state.phase === 'meeting'; },
  };
}

module.exports = { createController };
