'use strict';

const os = require('node:os');
const path = require('node:path');
const { app, globalShortcut, ipcMain, powerMonitor } = require('electron');
const { getConfig } = require('../core/config');
const { DEFAULTS, FIELDS, validate, sloganFor } = require('../core/settings');
const hotkeys = require('../core/hotkeys');
const { openDb, dailyBackup } = require('./db');
const { createLogger } = require('./logger');
const { createController } = require('./controller');
const { startInputLock } = require('./inputLock');
const { createWindows } = require('./windows');
const { createTray } = require('./tray');

const HEARTBEAT_MS = 10 * 60 * 1000;

// `Antisedentary.exe --quit`：請正在跑的那一個存好檔再結束（更新程式前用）
const QUIT_FLAG = '--quit';

const DATA_DIR = path.join(app.getPath('appData'), 'antisedentary');
const log = createLogger(path.join(DATA_DIR, 'logs', 'app.log'));

// 不用顯示卡加速：避免顯示卡相關的子程序出錯時把整個程式拖垮
app.disableHardwareAcceleration();

process.on('uncaughtException', (err) => log('uncaughtException', err));
process.on('unhandledRejection', (err) => log('unhandledRejection', err));
process.on('exit', (code) => log('process exit', { code }));
app.on('child-process-gone', (_e, details) => log('child process gone', details));
app.on('render-process-gone', (_e, _wc, details) => log('render process gone', details));

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else if (process.argv.includes(QUIT_FLAG)) {
  app.quit(); // 沒有正在跑的，什麼都不用做
} else {
  app.on('second-instance', (_e, argv) => {
    log('second instance', { argv: argv.slice(1) });
    if (argv.includes(QUIT_FLAG)) app.quit();
  });
  app.whenReady().then(start).catch((err) => log('start failed', err));
}

function lockHelperPath() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'lockhelper.exe')
    : path.join(__dirname, '..', '..', 'resources', 'lockhelper.exe');
}

function start() {
  const db = openDb(path.join(DATA_DIR, 'antisedentary.db'));
  try {
    dailyBackup(db, path.join(DATA_DIR, 'backups'));
  } catch (err) {
    log('daily backup failed', err);
  }
  const stored = validate(db.getSettings());
  let settings = stored.ok ? stored.value : { ...DEFAULTS };
  let config = getConfig(process.env, settings);
  log('started', {
    version: app.getVersion(), pid: process.pid, segments: db.listSegments().length,
    journal: db.journalMode(), settings,
  });

  const windows = createWindows({ log });
  let tray = null;

  const controller = createController({
    config,
    db: {
      insertSegment: (s) => { log('save segment', { ...s, note: s.note ? `${s.note.length} chars` : '' }); return db.insertSegment(s); },
      insertMeeting: (m) => { log('save meeting', m); return db.insertMeeting(m); },
    },
    host: os.hostname(),
    getIdleMs: () => powerMonitor.getSystemIdleTime() * 1000,
    startLock: (opts) => {
      const handle = startInputLock({ exePath: lockHelperPath(), ...opts });
      handle.ready.then(() => log('input lock ready'), (err) => log('input lock failed', err));
      handle.exited.then((code) => log('input lock exited', { code }));
      return handle;
    },
    ui: {
      showReminder: (d) => { log('show reminder', d); windows.showReminder(d); },
      hideReminder: windows.hideReminder,
      showQuestion: (d) => { log('show question', d); windows.showQuestion(d); },
      hideQuestion: windows.hideQuestion,
      showLock: (d) => {
        log('lock', d);
        windows.showLock({ ...d, background: settings.restBackground, slogan: sloganFor(settings) });
      },
      hideLock: () => { log('unlock'); windows.hideLock(); },
      setMeetingIndicator: (on) => { log('meeting mode', { on }); if (tray) tray.setMeetingIndicator(on); },
    },
  });

  const toggleMeeting = () =>
    controller.dispatch({ type: controller.inMeeting ? 'meetingOff' : 'meetingOn', now: Date.now() });

  tray = createTray({
    onOpenRecords: windows.openDashboard,
    onBreakNow: () => controller.dispatch({ type: 'startBreak', now: Date.now(), source: 'tray' }),
    onMeetingToggle: toggleMeeting,
    onQuit: () => { log('quit from tray'); app.quit(); },
  });

  // Lock-in 專注模式快捷鍵（平常用 Electron 全域快捷鍵；鎖定中由 lockhelper 偵測）
  let meetingAccelerator = null;
  // 提早休息快捷鍵：叫出或收起右下角的卡片
  let earlyAccelerator = null;
  const toggleEarly = () => { log('early card hotkey', { phase: controller.phase }); controller.toggleEarlyCard(); };
  function applyHotkeys() {
    if (meetingAccelerator) globalShortcut.unregister(meetingAccelerator);
    if (earlyAccelerator) globalShortcut.unregister(earlyAccelerator);
    meetingAccelerator = hotkeys.accelerator(settings.meetingKey);
    earlyAccelerator = hotkeys.accelerator(settings.earlyKey);
    if (!globalShortcut.register(meetingAccelerator, toggleMeeting)) log(`could not register ${meetingAccelerator}`);
    if (!globalShortcut.register(earlyAccelerator, toggleEarly)) log(`could not register ${earlyAccelerator}`);
    controller.setHotkeys({ meetingVk: hotkeys.vk(settings.meetingKey), escapeVk: hotkeys.vk(settings.escapeKey) });
  }
  applyHotkeys();

  // 開機自動啟動（只有打包後的版本才設定）
  const applyAutoStart = () => { if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: settings.autoStart }); };

  ipcMain.on('note:update', (_e, text) => controller.setDraftNote(text));
  ipcMain.on('break:start', () => controller.dispatch({ type: 'startBreak', now: Date.now(), source: 'card' }));
  ipcMain.on('reminder:dismiss', () => controller.closeEarlyCard());
  // 紀錄頁右側欄的 Lock-in 按鈕
  ipcMain.handle('focus:toggle', () => { log('focus toggle from dashboard', { phase: controller.phase }); toggleMeeting(); return controller.phase; });
  // 在紀錄頁補寫或修改某一段的紀錄
  ipcMain.handle('segment:note', (_e, id, note) => {
    const ok = db.updateSegmentNote(id, note);
    log('note edited', { id, ok, length: String(note ?? '').trim().length });
    return ok;
  });
  // 在紀錄頁刪除某一段
  ipcMain.handle('segment:delete', (_e, id) => {
    const ok = db.deleteSegment(id);
    log('segment deleted', { id, ok });
    return ok;
  });
  ipcMain.handle('break:now', (_e, note) => {
    log('break from dashboard', { phase: controller.phase, note: note ? `${String(note).length} chars` : '' });
    controller.breakNow(note);
    return controller.phase;
  });
  ipcMain.on('question:answer', (_e, stood) => { log('answer', { stood }); controller.answer(stood); });
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
  ipcMain.handle('settings:get', () => ({
    fields: FIELDS, values: settings, defaults: DEFAULTS,
    keys: hotkeys.KEYS.map((key) => ({ key, label: hotkeys.label(key) })),
  }));
  ipcMain.handle('hotkeys:get', () => ({
    meeting: hotkeys.label(settings.meetingKey), escape: hotkeys.label(settings.escapeKey),
    early: hotkeys.label(settings.earlyKey),
  }));
  ipcMain.on('tutorial:open', () => windows.openTutorial());
  ipcMain.on('tutorial:close', () => windows.closeTutorial());
  ipcMain.on('tutorial:done', () => { db.setState('tutorialSeen', Date.now()); windows.closeTutorial(); });
  ipcMain.handle('settings:save', (_e, values) => {
    const result = validate(values);
    if (!result.ok) return { ok: false, errors: result.errors };
    settings = result.value;
    db.saveSettings(settings);
    config = getConfig(process.env, settings);
    controller.setConfig(config);
    applyHotkeys();
    applyAutoStart();
    log('settings saved', settings);
    return { ok: true, values: settings };
  });

  const suspend = (why) => () => { log(why); controller.dispatch({ type: 'suspend', now: Date.now() }); };
  const resume = (why) => () => { log(why); controller.dispatch({ type: 'resume', now: Date.now() }); };
  powerMonitor.on('suspend', suspend('suspend'));
  powerMonitor.on('lock-screen', suspend('lock-screen'));
  powerMonitor.on('resume', resume('resume'));
  powerMonitor.on('unlock-screen', resume('unlock-screen'));

  const ticker = setInterval(() => {
    try {
      controller.tick();
    } catch (err) {
      log('tick failed', err);
    }
  }, config.tickMs);
  controller.tick();
  // 每 10 分鐘記一次「還活著」，程式突然不見時才知道大概是幾點
  const heartbeat = setInterval(() => log('alive', { phase: controller.phase }), HEARTBEAT_MS);

  // 程式結束、或 Windows 關機/登出（不會觸發 before-quit）時，把進行中的段落和專注紀錄存起來
  let closed = false;
  const shutdown = (why) => () => {
    if (closed) return;
    closed = true;
    log('shutdown', { why, phase: controller.phase });
    clearInterval(ticker);
    clearInterval(heartbeat);
    controller.quit();
    globalShortcut.unregisterAll();
    db.close();
  };
  app.on('before-quit', shutdown('before-quit'));
  windows.onSessionEnd(shutdown('session-end'));

  // 第一次使用（完全沒有紀錄、也沒存過設定）才自動打開新手教學；
  // 已經在用的人升級上來不跳，直接記成看過了
  if (!db.getState('tutorialSeen')) {
    const firstRun = db.listSegments().length === 0 && Object.keys(db.getSettings()).length === 0;
    if (firstRun) windows.openTutorial();
    else db.setState('tutorialSeen', 'upgraded');
  }
  // 教學視窗被關掉（不管是按「開始使用」還是右上角 X）就算看過了
  windows.onTutorialClosed(() => { if (!closed) db.setState('tutorialSeen', Date.now()); });

  applyAutoStart();
}

// 常駐在系統匣：關掉所有視窗也不結束
app.on('window-all-closed', () => {});
