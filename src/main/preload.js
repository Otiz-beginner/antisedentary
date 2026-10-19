'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // 提醒卡
  onReminder: (cb) => ipcRenderer.on('reminder:show', (_e, data) => cb(data)),
  setDraftNote: (text) => ipcRenderer.send('note:update', String(text)),
  startBreak: () => ipcRenderer.send('break:start'),
  // 回來時的問題卡
  onQuestion: (cb) => ipcRenderer.on('question:show', (_e, data) => cb(data)),
  answer: (stood) => ipcRenderer.send('question:answer', Boolean(stood)),
  // 鎖定畫面
  onLock: (cb) => ipcRenderer.on('lock:show', (_e, data) => cb(data)),
  // dashboard
  getRecords: () => ipcRenderer.invoke('records:get'),
  getStatus: () => ipcRenderer.invoke('status:get'),
});
