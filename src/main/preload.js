'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // 提醒卡
  onReminder: (cb) => ipcRenderer.on('reminder:show', (_e, data) => cb(data)),
  setDraftNote: (text) => ipcRenderer.send('note:update', String(text)),
  startBreak: () => ipcRenderer.send('break:start'),
  dismissCard: () => ipcRenderer.send('reminder:dismiss'),
  // 回來時的問題卡
  onQuestion: (cb) => ipcRenderer.on('question:show', (_e, data) => cb(data)),
  answer: (stood) => ipcRenderer.send('question:answer', Boolean(stood)),
  // 回來時的補記卡
  onReturnCard: (cb) => ipcRenderer.on('return:show', (_e, data) => cb(data)),
  saveReturnNote: (kind, id, text) => ipcRenderer.invoke('return:note', String(kind), Number(id), String(text ?? '')),
  closeReturnCard: () => ipcRenderer.send('return:close'),
  // 鎖定畫面
  onLock: (cb) => ipcRenderer.on('lock:show', (_e, data) => cb(data)),
  // dashboard
  getRecords: () => ipcRenderer.invoke('records:get'),
  getStatus: () => ipcRenderer.invoke('status:get'),
  breakNow: (note) => ipcRenderer.invoke('break:now', String(note ?? '')),
  toggleFocus: () => ipcRenderer.invoke('focus:toggle'),
  updateNote: (id, note) => ipcRenderer.invoke('segment:note', Number(id), String(note ?? '')),
  deleteSegment: (id) => ipcRenderer.invoke('segment:delete', Number(id)),
  updateBreakNote: (id, note) => ipcRenderer.invoke('break:note', Number(id), String(note ?? '')),
  deleteBreak: (id) => ipcRenderer.invoke('break:delete', Number(id)),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  // 使用教學
  getHotkeys: () => ipcRenderer.invoke('hotkeys:get'),
  openTutorial: () => ipcRenderer.send('tutorial:open'),
  finishTutorial: () => ipcRenderer.send('tutorial:done'),
  closeTutorial: () => ipcRenderer.send('tutorial:close'),
  saveSettings: (values) => ipcRenderer.invoke('settings:save', values),
});
