'use strict';

const os = require('node:os');
const path = require('node:path');
const { app, globalShortcut, ipcMain, powerMonitor } = require('electron');
const { getConfig } = require('../core/config');
const { openDb } = require('./db');
const { createController } = require('./controller');
const { startInputLock } = require('./inputLock');
const { createWindows } = require('./windows');
const { createTray } = require('./tray');

const MEETING_HOTKEY = 'Control+Alt+Shift+M';

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.whenReady().then(start);
}

function lockHelperPath() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'lockhelper.exe')
    : path.join(__dirname, '..', '..', 'resources', 'lockhelper.exe');
}

function start() {
  const config = getConfig();
  const db = openDb(path.join(app.getPath('appData'), 'antisedentary', 'antisedentary.db'));
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
  ipcMain.handle('records:get', () => ({
    segments: db.listSegments(),
    meetings: db.listMeetings(),
    now: Date.now(),
    shortIdleSegmentMs: config.shortIdleSegmentMs,
  }));

  const suspend = () => controller.dispatch({ type: 'suspend', now: Date.now() });
  const resume = () => controller.dispatch({ type: 'resume', now: Date.now() });
  powerMonitor.on('suspend', suspend);
  powerMonitor.on('lock-screen', suspend);
  powerMonitor.on('resume', resume);
  powerMonitor.on('unlock-screen', resume);

  const ticker = setInterval(controller.tick, config.tickMs);
  controller.tick();

  let quitting = false;
  app.on('before-quit', () => {
    if (quitting) return;
    quitting = true;
    clearInterval(ticker);
    controller.dispatch({ type: 'quit', now: Date.now() });
    globalShortcut.unregisterAll();
    db.close();
  });

  if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: true });
}

// 常駐在系統匣：關掉所有視窗也不結束
app.on('window-all-closed', () => {});
