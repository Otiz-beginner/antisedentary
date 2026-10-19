'use strict';

const os = require('node:os');
const path = require('node:path');
const { app, globalShortcut, ipcMain, powerMonitor } = require('electron');
const { getConfig } = require('../core/config');
const { DEFAULTS, FIELDS, validate } = require('../core/settings');
const { openDb } = require('./db');
const { createController } = require('./controller');
const { startInputLock } = require('./inputLock');
const { createWindows } = require('./windows');
const { createTray } = require('./tray');

const MEETING_HOTKEY = 'Control+Alt+Shift+M';

// `Antisedentary.exe --quit`：請正在跑的那一個存好檔再結束（更新程式前用）
const QUIT_FLAG = '--quit';

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else if (process.argv.includes(QUIT_FLAG)) {
  app.quit(); // 沒有正在跑的，什麼都不用做
} else {
  app.on('second-instance', (_e, argv) => { if (argv.includes(QUIT_FLAG)) app.quit(); });
  app.whenReady().then(start);
}

function lockHelperPath() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'lockhelper.exe')
    : path.join(__dirname, '..', '..', 'resources', 'lockhelper.exe');
}

function start() {
  const db = openDb(path.join(app.getPath('appData'), 'antisedentary', 'antisedentary.db'));
  const stored = validate(db.getSettings());
  let settings = stored.ok ? stored.value : { ...DEFAULTS };
  let config = getConfig(process.env, settings);
  const windows = createWindows();
  let tray = null;

  const controller = createController({
    config,
    db,
    host: os.hostname(),
    getIdleMs: () => powerMonitor.getSystemIdleTime() * 1000,
    startLock: (opts) => startInputLock({ exePath: lockHelperPath(), ...opts }),
    ui: {
      showReminder: windows.showReminder,
      hideReminder: windows.hideReminder,
      showQuestion: windows.showQuestion,
      hideQuestion: windows.hideQuestion,
      showLock: windows.showLock,
      hideLock: windows.hideLock,
      setMeetingIndicator: (on) => tray && tray.setMeetingIndicator(on),
    },
  });

  const toggleMeeting = () =>
    controller.dispatch({ type: controller.inMeeting ? 'meetingOff' : 'meetingOn', now: Date.now() });

  tray = createTray({
    onOpenRecords: windows.openDashboard,
    onBreakNow: () => controller.dispatch({ type: 'startBreak', now: Date.now(), source: 'tray' }),
    onMeetingToggle: toggleMeeting,
    onQuit: () => app.quit(),
  });

  if (!globalShortcut.register(MEETING_HOTKEY, toggleMeeting)) {
    console.error(`could not register ${MEETING_HOTKEY}`);
  }

  ipcMain.on('note:update', (_e, text) => controller.setDraftNote(text));
  ipcMain.on('break:start', () => controller.dispatch({ type: 'startBreak', now: Date.now(), source: 'card' }));
  ipcMain.on('question:answer', (_e, stood) => controller.answer(stood));
  ipcMain.handle('records:get', () => ({
    segments: db.listSegments(),
    meetings: db.listMeetings(),
    now: Date.now(),
    shortIdleSegmentMs: config.shortIdleSegmentMs,
  }));
  ipcMain.handle('status:get', () => ({
    status: controller.status(),
    cycleMs: config.workMs + config.reminderMs,
    lockMs: config.lockMs,
  }));
  ipcMain.handle('settings:get', () => ({ fields: FIELDS, values: settings, defaults: DEFAULTS }));
  ipcMain.handle('settings:save', (_e, values) => {
    const result = validate(values);
    if (!result.ok) return { ok: false, errors: result.errors };
    settings = result.value;
    db.saveSettings(settings);
    config = getConfig(process.env, settings);
    controller.setConfig(config);
    return { ok: true, values: settings };
  });

  const suspend = () => controller.dispatch({ type: 'suspend', now: Date.now() });
  const resume = () => controller.dispatch({ type: 'resume', now: Date.now() });
  powerMonitor.on('suspend', suspend);
  powerMonitor.on('lock-screen', suspend);
  powerMonitor.on('resume', resume);
  powerMonitor.on('unlock-screen', resume);

  const ticker = setInterval(controller.tick, config.tickMs);
  controller.tick();

  // 程式結束、或 Windows 關機/登出（不會觸發 before-quit）時，把進行中的段落和開會紀錄存起來
  let closed = false;
  const shutdown = () => {
    if (closed) return;
    closed = true;
    clearInterval(ticker);
    controller.quit();
    globalShortcut.unregisterAll();
    db.close();
  };
  app.on('before-quit', shutdown);
  windows.onSessionEnd(shutdown);

  if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: true });
}

// 常駐在系統匣：關掉所有視窗也不結束
app.on('window-all-closed', () => {});
