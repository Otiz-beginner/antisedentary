'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

// 本機紀錄（spec §5）。時間一律存 epoch 毫秒。
function openDb(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const db = new DatabaseSync(filePath);
  // 不用 WAL：每次存檔都直接寫進主檔，不會因為暫存的 -wal 檔不見而遺失紀錄
  db.exec(`
    PRAGMA journal_mode = DELETE;
    PRAGMA synchronous = FULL;
    CREATE TABLE IF NOT EXISTS segments (
      id INTEGER PRIMARY KEY,
      started_at INTEGER NOT NULL,
      ended_at INTEGER NOT NULL,
      end_reason TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      host TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS segments_started_at ON segments(started_at);
    CREATE TABLE IF NOT EXISTS meetings (
      id INTEGER PRIMARY KEY,
      started_at INTEGER NOT NULL,
      ended_at INTEGER NOT NULL,
      host TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS app_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
  const updateNote = db.prepare('UPDATE segments SET note = ? WHERE id = ?');
  const deleteSeg = db.prepare('DELETE FROM segments WHERE id = ?');
  const selectState = db.prepare('SELECT value FROM app_state WHERE key = ?');
  const upsertState = db.prepare(
    'INSERT INTO app_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  const selectSettings = db.prepare('SELECT json FROM settings WHERE id = 1');
  const upsertSettings = db.prepare(
    'INSERT INTO settings (id, json) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET json = excluded.json');

  const insertSeg = db.prepare(
    'INSERT INTO segments (started_at, ended_at, end_reason, note, host) VALUES (?, ?, ?, ?, ?)');
  const insertMeet = db.prepare('INSERT INTO meetings (started_at, ended_at, host) VALUES (?, ?, ?)');
  const selectSegs = db.prepare(
    `SELECT id, started_at AS startedAt, ended_at AS endedAt, end_reason AS endReason, note, host
     FROM segments ORDER BY started_at, id`);
  const selectMeets = db.prepare(
    'SELECT id, started_at AS startedAt, ended_at AS endedAt, host FROM meetings ORDER BY started_at, id');
  const plain = (row) => ({ ...row });

  return {
    insertSegment({ startedAt, endedAt, endReason, note = '', host }) {
      return Number(insertSeg.run(startedAt, endedAt, endReason, note, host).lastInsertRowid);
    },
    insertMeeting({ startedAt, endedAt, host }) {
      return Number(insertMeet.run(startedAt, endedAt, host).lastInsertRowid);
    },
    listSegments: () => selectSegs.all().map(plain),
    listMeetings: () => selectMeets.all().map(plain),
    // 使用者在 dashboard 調的時間設定（只存有改過的欄位）
    getSettings() {
      const row = selectSettings.get();
      return row ? JSON.parse(row.json) : {};
    },
    saveSettings: (settings) => { upsertSettings.run(JSON.stringify(settings)); },
    // 在紀錄頁補寫或修改某一段的紀錄；找不到這一段就回傳 false
    updateSegmentNote: (id, note) => updateNote.run(String(note ?? '').trim(), Number(id)).changes > 0,
    // 在紀錄頁刪除某一段；找不到這一段就回傳 false
    deleteSegment: (id) => deleteSeg.run(Number(id)).changes > 0,
    // 程式自己的小狀態，例如新手教學看過了沒
    getState: (key) => selectState.get(key)?.value ?? null,
    setState: (key, value) => { upsertState.run(key, String(value)); },
    journalMode: () => db.prepare('PRAGMA journal_mode').get().journal_mode,
    // 存一份完整一致的複本到 target（VACUUM INTO 不會讀到寫到一半的狀態）
    backupTo: (target) => db.prepare('VACUUM INTO ?').run(target),
    close: () => db.close(),
  };
}

// 每天第一次啟動時備份一份到 dir，只保留最新的 keep 份
function dailyBackup(db, dir, now = Date.now(), keep = 14) {
  const d = new Date(now);
  const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const target = path.join(dir, `antisedentary-${day}.db`);
  fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(target)) db.backupTo(target);
  const old = fs.readdirSync(dir).filter((f) => /^antisedentary-\d{4}-\d{2}-\d{2}\.db$/.test(f)).sort();
  for (const f of old.slice(0, Math.max(0, old.length - keep))) fs.rmSync(path.join(dir, f));
  return target;
}

module.exports = { openDb, dailyBackup };
