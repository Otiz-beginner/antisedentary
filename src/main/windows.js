'use strict';

const path = require('node:path');
const { BrowserWindow, desktopCapturer, screen } = require('electron');

const RENDERER = path.join(__dirname, '..', 'renderer');
const PRELOAD = path.join(__dirname, 'preload.js');
const REMINDER_SIZE = { width: 320, height: 220 };
const QUESTION_SIZE = { width: 320, height: 130 };
const RETURN_SIZE = { width: 320, height: 290 };
const webPreferences = { preload: PRELOAD, contextIsolation: true, sandbox: true, nodeIntegration: false };

function whenLoaded(win, fn) {
  if (win.webContents.isLoading()) win.webContents.once('did-finish-load', fn);
  else fn();
}

// 視窗內容當掉或卡住時寫進日誌
function watch(win, name, log) {
  win.webContents.on('render-process-gone', (_e, details) => log(`${name} renderer gone`, details));
  win.on('unresponsive', () => log(`${name} unresponsive`));
}

function cornerBounds(size) {
  const { workArea } = screen.getPrimaryDisplay();
  return {
    x: workArea.x + workArea.width - size.width - 16 + 10,
    y: workArea.y + workArea.height - size.height - 16 + 10,
    ...size,
  };
}

// 提醒卡、問題卡、鎖定遮罩、dashboard（spec §4.2、§4.3、§6）
function createWindows({ log = () => {} } = {}) {
  let lockWindows = [];
  let dashboard = null;

  // 右下角的卡片：每次顯示都開一個新視窗，收起時直接關掉。
  // 不重複使用開了好幾小時的舊視窗，避免卡片叫出來了卻看不到。
  function cornerCard(file, size, channel, name) {
    let win = null;
    return {
      show(data) {
        if (win && !win.isDestroyed()) win.destroy();
        const bounds = cornerBounds(size);
        win = new BrowserWindow({
          ...bounds,
          frame: false, transparent: true, resizable: false, movable: false, skipTaskbar: true,
          minimizable: false, maximizable: false, fullscreenable: false, alwaysOnTop: true,
          show: false, hasShadow: false, webPreferences,
        });
        win.setAlwaysOnTop(true, 'screen-saver');
        watch(win, name, log);
        win.loadFile(path.join(RENDERER, file));
        const shown = win;
        whenLoaded(shown, () => {
          if (shown.isDestroyed()) return;
          shown.webContents.send(channel, data);
          shown.showInactive(); // 不搶焦點；點進去才會拿到焦點
          log(`${name} shown`, { bounds: shown.getBounds(), visible: shown.isVisible() });
        });
      },
      hide() {
        if (win && !win.isDestroyed()) win.destroy();
        win = null;
      },
    };
  }

  const reminder = cornerCard('reminder.html', REMINDER_SIZE, 'reminder:show', 'reminder');
  const question = cornerCard('question.html', QUESTION_SIZE, 'question:show', 'question');
  const returnCard = cornerCard('return.html', RETURN_SIZE, 'return:show', 'return');
  // 補記卡是自動存檔的，提醒卡或問題卡要出現時直接收起，不要疊在一起
  const showReminder = (d) => { returnCard.hide(); reminder.show(d); };
  const showQuestion = (d) => { returnCard.hide(); question.show(d); };

  // 鎖定前把每個螢幕拍一張小圖，交給鎖定畫面自己模糊。
  // 不靠 Windows 的壓克力效果：遠端桌面或關掉透明效果時，壓克力只會剩下一片單色。
  async function captureScreens() {
    const { width, height } = screen.getPrimaryDisplay().size;
    const sources = await desktopCapturer.getSources({
      types: ['screen'], thumbnailSize: { width: Math.round(width / 2), height: Math.round(height / 2) },
    });
    return new Map(sources.map((s) => [String(s.display_id), s.thumbnail]));
  }

  let lockToken = 0;
  // 拍照最多等這麼久；太慢就不等，直接用備用底色
  const CAPTURE_WAIT_MS = 1500;
  function showLock(data) {
    hideLock();
    const token = ++lockToken;
    if (data.background !== 'blur') { openLockWindows(data, new Map()); return; }
    // 先拍、再開視窗，才不會拍到鎖定畫面自己
    const timeout = new Promise((resolve) => setTimeout(() => resolve(null), CAPTURE_WAIT_MS));
    Promise.race([captureScreens(), timeout])
      .catch((err) => { log('screen capture failed', err); return null; })
      .then((shots) => {
        if (token !== lockToken) return; // 拍照中就已經解鎖了
        if (!shots) log('screen capture skipped');
        openLockWindows(data, shots || new Map());
      });
  }

  function openLockWindows(data, shots) {
    const primaryId = screen.getPrimaryDisplay().id;
    lockWindows = screen.getAllDisplays().map((display) => {
      const shot = shots.get(String(display.id));
      const backdrop = shot && !shot.isEmpty() ? `data:image/jpeg;base64,${shot.toJPEG(70).toString('base64')}` : null;
      const win = new BrowserWindow({
        ...display.bounds,
        frame: false, transparent: false, backgroundColor: '#5B6E92',
        resizable: false, movable: false, skipTaskbar: true, minimizable: false, maximizable: false,
        alwaysOnTop: true, focusable: true, show: false, webPreferences,
      });
      win.setAlwaysOnTop(true, 'screen-saver');
      win.setBounds(display.bounds);
      watch(win, 'lock', log);
      win.loadFile(path.join(RENDERER, 'lock.html'));
      whenLoaded(win, () => {
        if (win.isDestroyed()) return;
        // 拍不到照片（例如遠端桌面視窗縮到最小時）就改用內建桌布，不要只剩一片單色
        const background = backdrop ? 'blur' : 'wallpaper';
        win.webContents.send('lock:show', { ...data, background, backdrop, primary: display.id === primaryId });
        win.show();
        win.moveTop();
      });
      return win;
    });
    log('lock shown', { displays: lockWindows.length, background: data.background, captured: shots.size });
  }

  function hideLock() {
    lockToken += 1;
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
      width: 1400, height: 860, minWidth: 420, minHeight: 480, title: '紀錄',
      backgroundColor: '#EEF0F8', autoHideMenuBar: true, show: false, webPreferences,
    });
    dashboard.setMenu(null);
    watch(dashboard, 'dashboard', log);
    dashboard.loadFile(path.join(RENDERER, 'dashboard.html'));
    dashboard.once('ready-to-show', () => dashboard.show());
  }

  // 使用教學：獨立視窗，置中
  let tutorial = null;
  let onTutorialClosedFn = () => {};
  function openTutorial() {
    if (tutorial && !tutorial.isDestroyed()) {
      tutorial.show();
      tutorial.focus();
      return;
    }
    tutorial = new BrowserWindow({
      width: 760, height: 580, center: true, resizable: false, maximizable: false, minimizable: false,
      frame: false, roundedCorners: true, // 不用 Windows 的外框，右上角是自己畫的小圓 ×
      title: '使用教學', backgroundColor: '#EEF0F8', autoHideMenuBar: true, show: false, webPreferences,
    });
    tutorial.setMenu(null);
    watch(tutorial, 'tutorial', log);
    tutorial.loadFile(path.join(RENDERER, 'tutorial.html'));
    tutorial.once('ready-to-show', () => { tutorial.show(); tutorial.focus(); });
    tutorial.on('closed', () => { tutorial = null; onTutorialClosedFn(); });
    log('tutorial opened');
  }
  function closeTutorial() {
    if (tutorial && !tutorial.isDestroyed()) tutorial.close();
  }
  function onTutorialClosed(fn) {
    onTutorialClosedFn = fn;
  }

  // Windows 關機或登出時，Electron 只會在視窗上發出 session-end。
  // 用一個永遠不顯示、也不會被關掉的小視窗來接這個訊號。
  const keeper = new BrowserWindow({ width: 1, height: 1, show: false, skipTaskbar: true, frame: false });
  function onSessionEnd(fn) {
    keeper.on('session-end', fn);
  }

  return {
    showReminder, hideReminder: reminder.hide,
    showQuestion, hideQuestion: question.hide,
    showReturnCard: returnCard.show, hideReturnCard: returnCard.hide,
    showLock, hideLock, openDashboard, onSessionEnd,
    openTutorial, closeTutorial, onTutorialClosed,
  };
}

module.exports = { createWindows };
