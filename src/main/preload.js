'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // 提醒卡
  onReminder: (cb) => ipcRenderer.on('reminder:show', (_e, data) => cb(data)),
  setDraftNote: (text) => ipcRenderer.send('note:update', String(text)),
  startBreak: () => ipcRenderer.send('break:start'),
  // 鎖定畫面
  onLock: (cb) => ipcRenderer.on('lock:show', (_e, data) => cb(data)),
  // dashboard
  getRecords: () => ipcRenderer.invoke('records:get'),
});
