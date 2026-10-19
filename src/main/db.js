'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

// 本機紀錄（spec §5）。時間一律存 epoch 毫秒。
function openDb(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const db = new DatabaseSync(filePath);
  db.exec(`
    PRAGMA journal_mode = WAL;
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
  `);
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
    close: () => db.close(),
  };
}

module.exports = { openDb };
