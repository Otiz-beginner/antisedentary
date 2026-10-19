'use strict';

const path = require('node:path');
const { BrowserWindow, screen } = require('electron');

const RENDERER = path.join(__dirname, '..', 'renderer');
const PRELOAD = path.join(__dirname, 'preload.js');
const REMINDER_SIZE = { width: 320, height: 220 };
const QUESTION_SIZE = { width: 320, height: 130 };
const webPreferences = { preload: PRELOAD, contextIsolation: true, sandbox: true, nodeIntegration: false };

// 右下角的透明小視窗（提醒卡、問題卡）
function createCornerWindow(file, size) {
  const win = new BrowserWindow({
    ...size,
    frame: false, transparent: true, resizable: false, movable: false, skipTaskbar: true,
    minimizable: false, maximizable: false, fullscreenable: false, alwaysOnTop: true,
    show: false, hasShadow: false, webPreferences,
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.loadFile(path.join(RENDERER, file));
  return win;
}

function placeInCorner(win, size) {
  const { workArea } = screen.getPrimaryDisplay();
  win.setBounds({
    x: workArea.x + workArea.width - size.width - 16 + 10,
    y: workArea.y + workArea.height - size.height - 16 + 10,
    ...size,
  });
}

// 提醒卡、問題卡、鎖定遮罩、dashboard（spec §4.2、§4.3、§6）
function createWindows() {
  let reminder = null;
  let question = null;
  let lockWindows = [];
  let dashboard = null;

  function ensureReminder() {
    if (!reminder || reminder.isDestroyed()) reminder = createCornerWindow('reminder.html', REMINDER_SIZE);
    return reminder;
  }

  function ensureQuestion() {
    if (!question || question.isDestroyed()) question = createCornerWindow('question.html', QUESTION_SIZE);
    return question;
  }

  const placeReminder = (win) => placeInCorner(win, REMINDER_SIZE);

  function showQuestion(data) {
    const win = ensureQuestion();
    placeInCorner(win, QUESTION_SIZE);
    whenLoaded(win, () => {
      win.webContents.send('question:show', data);
      win.showInactive(); // 不搶焦點，你可以繼續打字
    });
  }

  function hideQuestion() {
    if (question && !question.isDestroyed()) question.hide();
  }

  function whenLoaded(win, fn) {
    if (win.webContents.isLoading()) win.webContents.once('did-finish-load', fn);
    else fn();
  }

  function showReminder(data) {
    const win = ensureReminder();
    placeReminder(win);
    whenLoaded(win, () => {
      win.webContents.send('reminder:show', data);
      win.showInactive(); // 不搶焦點；點進輸入框才會拿到焦點
    });
  }

  function hideReminder() {
    if (reminder && !reminder.isDestroyed()) reminder.hide();
  }

  function showLock(data) {
    hideLock();
    const primaryId = screen.getPrimaryDisplay().id;
    lockWindows = screen.getAllDisplays().map((display) => {
      const win = new BrowserWindow({
        ...display.bounds,
        frame: false, transparent: false, backgroundMaterial: 'acrylic', backgroundColor: '#00000000',
        resizable: false, movable: false, skipTaskbar: true, minimizable: false, maximizable: false,
        alwaysOnTop: true, focusable: true, show: false, webPreferences,
      });
      win.setAlwaysOnTop(true, 'screen-saver');
      win.setBounds(display.bounds);
      win.loadFile(path.join(RENDERER, 'lock.html'));
      whenLoaded(win, () => {
        win.webContents.send('lock:show', { ...data, primary: display.id === primaryId });
        win.show();
        win.moveTop();
      });
      return win;
    });
  }

  function hideLock() {
    for (const win of lockWindows) if (!win.isDestroyed()) win.destroy();
    lockWindows = [];
  }

  function openDashboard() {
    if (dashboard && !dashboard.isDestroyed()) {
      dashboard.show();
      dashboard.focus();
      return;
    }
    dashboard = new BrowserWindow({
      width: 1080, height: 800, minWidth: 420, minHeight: 480, title: '紀錄',
      backgroundColor: '#EEF0F8', autoHideMenuBar: true, show: false, webPreferences,
    });
    dashboard.setMenu(null);
    dashboard.loadFile(path.join(RENDERER, 'dashboard.html'));
    dashboard.once('ready-to-show', () => dashboard.show());
  }

  // 啟動時先載入兩張卡片，第一次出現時才不會慢半拍
  ensureReminder();
  ensureQuestion();

  // Windows 關機或登出時，Electron 只會在視窗上發出 session-end
  function onSessionEnd(fn) {
    ensureReminder().on('session-end', fn);
  }

  return { showReminder, hideReminder, showQuestion, hideQuestion, showLock, hideLock, openDashboard, onSessionEnd };
}

module.exports = { createWindows };
