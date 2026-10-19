'use strict';

// 計時狀態機（spec §3、§4）。純函式：不讀時鐘、不做 I/O，所有動作都以 effects 回傳。

function initialState() {
  return { phase: 'away', since: 0 };
}

const away = (now) => ({ phase: 'away', since: now });
const lockFrom = (now, config) => ({ phase: 'locked', lockUntil: now + config.lockMs });
const lockEffect = (now, config) => ({ type: 'lock', startsAt: now, endsAt: now + config.lockMs });
const segment = (startedAt, endedAt, endReason) => ({ type: 'saveSegment', startedAt, endedAt, endReason });

// 結束 working/reminder 中的這一段，提醒卡若在就先收起來
function endSegment(state, endedAt, endReason) {
  const effects = state.phase === 'reminder' ? [{ type: 'hideReminder' }] : [];
  effects.push(segment(state.segStart, endedAt, endReason));
  return effects;
}

function onTick(state, { now, idleMs }, config) {
  switch (state.phase) {
    case 'away': {
      // 只有在進入 away 之後真的有輸入，才算回來工作（鎖定中被吞掉的輸入不算）
      const lastInput = now - idleMs;
      if (idleMs < config.idleResetMs && lastInput >= state.since) {
        return { state: { phase: 'working', segStart: lastInput }, effects: [] };
      }
      return { state, effects: [] };
    }

    case 'working':
    case 'reminder': {
      if (idleMs >= config.idleResetMs) {
        return { state: away(now), effects: endSegment(state, now - idleMs, 'idle') };
      }
      const reminderAt = state.segStart + config.workMs;
      const lockAt = reminderAt + config.reminderMs;
      if (state.phase === 'reminder' && now >= lockAt) {
        return {
          state: lockFrom(now, config),
          effects: [...endSegment(state, now, 'timeout'), lockEffect(now, config)],
        };
      }
      if (state.phase === 'working' && now >= reminderAt) {
        return {
          state: { ...state, phase: 'reminder' },
          effects: [{ type: 'showReminder', startsAt: reminderAt, endsAt: lockAt }],
        };
      }
      return { state, effects: [] };
    }

    case 'locked':
      if (now >= state.lockUntil) return { state: away(now), effects: [{ type: 'unlock' }] };
      return { state, effects: [] };

    default: // meeting：不提醒、不鎖定
      return { state, effects: [] };
  }
}

function step(state, input, config) {
  const { now } = input;
  const same = { state, effects: [] };
  const active = state.phase === 'working' || state.phase === 'reminder';

  switch (input.type) {
    case 'tick':
      return onTick(state, input, config);

    case 'startBreak':
      if (active) {
        return {
          state: lockFrom(now, config),
          effects: [...endSegment(state, now, input.source), lockEffect(now, config)],
        };
      }
      if (state.phase === 'away') return { state: lockFrom(now, config), effects: [lockEffect(now, config)] };
      return same;

    case 'meetingOn': {
      if (state.phase === 'meeting') return same;
      const meeting = { phase: 'meeting', meetingStart: now };
      if (active) return { state: meeting, effects: endSegment(state, now, 'meeting') };
      if (state.phase === 'locked') return { state: meeting, effects: [{ type: 'unlock' }] };
      return { state: meeting, effects: [] };
    }

    case 'meetingOff':
      if (state.phase !== 'meeting') return same;
      return { state: away(now), effects: [{ type: 'saveMeeting', startedAt: state.meetingStart, endedAt: now }] };

    case 'suspend':
      return { state: { ...state, suspendAt: now }, effects: [] };

    case 'resume': {
      if (state.suspendAt === undefined) return same;
      const { suspendAt, ...rest } = state;
      if (active && now - suspendAt >= config.idleResetMs) {
        return { state: away(now), effects: endSegment(state, suspendAt, 'idle') };
      }
      return { state: rest, effects: [] };
    }

    case 'quit':
      if (active) return { state, effects: endSegment(state, now, 'quit') };
      if (state.phase === 'meeting') {
        return { state, effects: [{ type: 'saveMeeting', startedAt: state.meetingStart, endedAt: now }] };
      }
      if (state.phase === 'locked') return { state, effects: [{ type: 'unlock' }] };
      return same;

    default:
      return same;
  }
}

module.exports = { initialState, step };
