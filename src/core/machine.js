'use strict';

// 計時狀態機（spec §3、§4）。純函式：不讀時鐘、不做 I/O，所有動作都以 effects 回傳。
//
// phase：
//   away     還沒開始計時；因為離開而結束的那一段會記在 pending，回來開始新的一段時請你補記
//   working  正常工作中；回來時若有問題卡，帶著 ask: { idleFrom, returnAt, shownAt }
//   reminder 提醒卡出現中，lockAt 時鎖定
//   paused   閒置滿 3 分鐘，暫停計時（不提醒、不鎖定），等你回來再問「剛剛有站起來嗎？」
//   locked   鎖定休息中
//   meeting   Lock-in 專注模式：沒有工作時長限制，不提醒、不鎖定
//   focusWrap 結束專注後的收尾卡：寫下這段做了什麼，水退光就休息

function initialState() {
  return { phase: 'away', since: 0 };
}

const away = (now) => ({ phase: 'away', since: now });
const lockFrom = (now, config) => ({ phase: 'locked', lockUntil: now + config.lockMs });
const lockEffect = (now, config) => ({ type: 'lock', startsAt: now, endsAt: now + config.lockMs });
const segment = (startedAt, endedAt, endReason) => ({ type: 'saveSegment', startedAt, endedAt, endReason });
const hasSegment = (state) => state.phase === 'working' || state.phase === 'reminder' || state.phase === 'paused';
// 暫停中的這一段，在你離開的那一刻就結束了
const segmentEnd = (state, now) => (state.phase === 'paused' ? state.idleFrom : now);

// 結束這一段，提醒卡或問題卡若在就先收起來
function endSegment(state, endedAt, endReason) {
  const effects = [];
  if (state.phase === 'reminder') effects.push({ type: 'hideReminder' });
  if (state.ask) effects.push({ type: 'hideQuestion' });
  effects.push(segment(state.segStart, endedAt, endReason));
  return effects;
}

// 結束專注：存成一段 endReason 'focus'（筆記由 controller 附上），收尾卡若在就收起來
function saveFocus(state, endedAt) {
  const effects = state.phase === 'focusWrap' ? [{ type: 'hideReminder' }] : [];
  effects.push(segment(state.focusStart ?? state.meetingStart, endedAt, 'focus'));
  return effects;
}

// 人離開了（睡眠、鎖定畫面、長時間沒有 tick）：存下這一段，回來時再請你補記
function leaveIdle(state, endedAt, now) {
  return {
    state: { ...away(now), pending: { startedAt: state.segStart, endedAt } },
    effects: endSegment(state, endedAt, 'idle'),
  };
}

// 回來開始新的一段：請你補記剛才那段做了什麼、站起來做了什麼
const returnCard = (segment, breakEndedAt) =>
  ({ type: 'showReturnCard', segment, breakStartedAt: segment.endedAt, breakEndedAt });

function withoutAsk(state) {
  const { ask, ...rest } = state;
  return rest;
}

function onTick(state, { now, idleMs }, config) {
  const lastInput = now - idleMs;
  // 兩次 tick 間隔太久（睡眠醒來時 tick 可能比 resume 事件先到）：當作離開過了
  const gap = state.lastTickAt !== undefined && now - state.lastTickAt >= config.idleResetMs;

  switch (state.phase) {
    case 'away':
      // 只有在進入 away 之後真的有輸入，才算回來工作（鎖定中被吞掉的輸入不算）
      if (idleMs < config.idleResetMs && lastInput >= state.since) {
        const effects = state.pending ? [returnCard(state.pending, lastInput)] : [];
        return { state: { phase: 'working', segStart: lastInput }, effects };
      }
      return { state, effects: [] };

    case 'paused':
      // 不管離開多久，回來都會問；只有睡眠醒來（tick 中斷）才直接結束這一段
      if (gap) return leaveIdle(state, state.idleFrom, now);
      if (idleMs < config.idleResetMs) {
        // 回來了：先當作還坐著繼續計時，同時問一句
        return {
          state: { phase: 'working', segStart: state.segStart, ask: { idleFrom: state.idleFrom, returnAt: lastInput, shownAt: now } },
          effects: [{ type: 'showQuestion', startsAt: now, endsAt: now + config.askTimeoutMs }],
        };
      }
      return { state, effects: [] };

    case 'working':
    case 'reminder': {
      if (gap) return leaveIdle(state, state.lastTickAt, now);
      if (idleMs >= config.idleResetMs) {
        const effects = [];
        if (state.phase === 'reminder') effects.push({ type: 'hideReminder' });
        if (state.ask) effects.push({ type: 'hideQuestion' });
        // 閒置時間只精確到整秒，換算的「最後輸入」可能比這段開始還早一點點
        return { state: { phase: 'paused', segStart: state.segStart, idleFrom: Math.max(lastInput, state.segStart) }, effects };
      }
      if (state.ask) {
        // 問題卡出現時不提醒；沒人回答就當作「還坐著」
        if (now - state.ask.shownAt >= config.askTimeoutMs) {
          return { state: withoutAsk(state), effects: [{ type: 'hideQuestion' }] };
        }
        return { state, effects: [] };
      }
      if (state.phase === 'reminder' && now >= state.lockAt) {
        return {
          state: lockFrom(now, config),
          effects: [...endSegment(state, now, 'timeout'), lockEffect(now, config)],
        };
      }
      if (state.phase === 'working' && now >= state.segStart + config.workMs) {
        // 提醒卡至少給滿 3 分鐘收尾（例如回答「還坐著」時已經超過 32 分鐘）
        const lockAt = now + config.reminderMs;
        return {
          state: { ...state, phase: 'reminder', lockAt },
          effects: [{ type: 'showReminder', startsAt: now, endsAt: lockAt }],
        };
      }
      return { state, effects: [] };
    }

    case 'locked':
      if (now >= state.lockUntil) return { state: away(now), effects: [{ type: 'unlock' }] };
      return { state, effects: [] };

    case 'focusWrap':
      // 人已經走了（或睡眠醒來）：存檔就好，不鎖一張空桌子
      if (gap || idleMs >= config.idleResetMs) return { state: away(now), effects: saveFocus(state, state.focusEnd) };
      if (now >= state.lockAt) {
        return { state: lockFrom(now, config), effects: [...saveFocus(state, state.focusEnd), lockEffect(now, config)] };
      }
      return { state, effects: [] };

    default: // meeting（Lock-in）：不提醒、不鎖定，沒有時長限制
      return { state, effects: [] };
  }
}

function step(state, input, config) {
  const { now } = input;
  const same = { state, effects: [] };

  switch (input.type) {
    case 'tick': {
      const out = onTick(state, input, config);
      if (hasSegment(out.state) || out.state.phase === 'focusWrap') out.state = { ...out.state, lastTickAt: now };
      return out;
    }

    case 'answer': {
      if (!state.ask) return same;
      const effects = [{ type: 'hideQuestion' }];
      if (!input.stood) return { state: withoutAsk(state), effects };
      // 有站起來：離開前那段存成一段，從回來那一刻重新開始
      effects.push(segment(state.segStart, state.ask.idleFrom, 'idle'));
      effects.push(returnCard({ startedAt: state.segStart, endedAt: state.ask.idleFrom }, state.ask.returnAt));
      return { state: { ...withoutAsk(state), segStart: state.ask.returnAt }, effects };
    }

    case 'startBreak':
      if (hasSegment(state)) {
        return {
          state: lockFrom(now, config),
          effects: [...endSegment(state, segmentEnd(state, now), input.source), lockEffect(now, config)],
        };
      }
      if (state.phase === 'focusWrap') {
        return { state: lockFrom(now, config), effects: [...saveFocus(state, state.focusEnd), lockEffect(now, config)] };
      }
      if (state.phase === 'away') return { state: lockFrom(now, config), effects: [lockEffect(now, config)] };
      return same;

    case 'meetingOn': {
      if (state.phase === 'meeting') return same;
      // 收尾卡出現時又按了 Lock-in：回到同一段專注
      if (state.phase === 'focusWrap') {
        return { state: { phase: 'meeting', meetingStart: state.focusStart }, effects: [{ type: 'hideReminder' }] };
      }
      const meeting = { phase: 'meeting', meetingStart: now };
      if (hasSegment(state)) return { state: meeting, effects: endSegment(state, segmentEnd(state, now), 'meeting') };
      if (state.phase === 'locked') return { state: meeting, effects: [{ type: 'unlock' }] };
      return { state: meeting, effects: [] };
    }

    case 'escape':
      // 緊急逃出：只結束這次休息，之後照常計時提醒
      if (state.phase !== 'locked') return same;
      return { state: away(now), effects: [{ type: 'unlock' }] };

    case 'meetingOff': {
      if (state.phase !== 'meeting') return same;
      // 結束專注：先給收尾卡寫筆記，水在收尾時間內退光就休息
      const lockAt = now + config.reminderMs;
      return {
        state: { phase: 'focusWrap', focusStart: state.meetingStart, focusEnd: now, lockAt },
        effects: [{ type: 'showReminder', startsAt: now, endsAt: lockAt, kind: 'focus' }],
      };
    }

    case 'suspend':
      return { state: { ...state, suspendAt: now }, effects: [] };

    case 'resume': {
      if (state.suspendAt === undefined) return same;
      const { suspendAt, ...rest } = state;
      if (hasSegment(state) && now - suspendAt >= config.idleResetMs) {
        return leaveIdle(state, segmentEnd(state, suspendAt), now);
      }
      if (state.phase === 'focusWrap' && now - suspendAt >= config.idleResetMs) {
        return { state: away(now), effects: saveFocus(state, state.focusEnd) };
      }
      return { state: rest, effects: [] };
    }

    case 'quit':
      if (hasSegment(state)) return { state, effects: endSegment(state, segmentEnd(state, now), 'quit') };
      if (state.phase === 'meeting') return { state, effects: saveFocus(state, now) };
      if (state.phase === 'focusWrap') return { state, effects: saveFocus(state, state.focusEnd) };
      if (state.phase === 'locked') return { state, effects: [{ type: 'unlock' }] };
      return same;

    default:
      return same;
  }
}

module.exports = { initialState, step };
