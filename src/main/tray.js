'use strict';

const path = require('node:path');
const { Tray, Menu, nativeImage } = require('electron');

const ASSETS = path.join(__dirname, '..', '..', 'assets');

// 系統匣（spec §4.6）。Lock-in 專注中圖示換成淡紫色。
function createTray({ onOpenRecords, onBreakNow, onMeetingToggle, onQuit }) {
  const normalIcon = nativeImage.createFromPath(path.join(ASSETS, 'tray.png'));
  const meetingIcon = nativeImage.createFromPath(path.join(ASSETS, 'tray-meeting.png'));
  const tray = new Tray(normalIcon);
  let inMeeting = false;

  function rebuild() {
    tray.setImage(inMeeting ? meetingIcon : normalIcon);
    tray.setToolTip(inMeeting ? 'Antisedentary：Lock-in 專注中' : 'Antisedentary');
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: '打開紀錄', click: onOpenRecords },
      { label: '現在休息', click: onBreakNow, enabled: !inMeeting },
      { label: 'Lock-in 專注模式', type: 'checkbox', checked: inMeeting, click: onMeetingToggle },
      { type: 'separator' },
      { label: '結束程式', click: onQuit },
    ]));
  }

  tray.on('double-click', onOpenRecords);
  rebuild();

  return {
    setMeetingIndicator(on) {
      inMeeting = on;
      rebuild();
    },
  };
}

module.exports = { createTray };
