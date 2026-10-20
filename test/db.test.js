'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openDb } = require('../src/main/db');

const tmpFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'antised-')), 'a', 'b.db');
const seg = (startedAt, extra = {}) => ({ startedAt, endedAt: startedAt + 1000, endReason: 'timeout', note: '', host: 'pc', ...extra });

test('creates parent folder and tables', () => {
  const file = tmpFile();
  const db = openDb(file);
  assert.ok(fs.existsSync(file));
  assert.deepEqual(db.listSegments(), []);
  assert.deepEqual(db.listMeetings(), []);
  db.close();
});

test('inserts and lists segments in start order', () => {
  const db = openDb(tmpFile());
  db.insertSegment(seg(200));
  db.insertSegment(seg(100));
  assert.deepEqual(db.listSegments().map((s) => s.startedAt), [100, 200]);
  db.close();
});

test('stores note text exactly including newlines and <tags>', () => {
  const db = openDb(tmpFile());
  const note = "第一行\n<script>alert('x')</script> & \"q\"";
  db.insertSegment(seg(1, { note, endReason: 'card' }));
  const [row] = db.listSegments();
  assert.deepEqual(row, { id: row.id, startedAt: 1, endedAt: 1001, endReason: 'card', note, host: 'pc' });
  db.close();
});

test('empty note stored as empty string', () => {
  const db = openDb(tmpFile());
  db.insertSegment({ startedAt: 1, endedAt: 2, endReason: 'idle', host: 'pc' });
  assert.equal(db.listSegments()[0].note, '');
  db.close();
});

test('inserts and lists meetings', () => {
  const db = openDb(tmpFile());
  db.insertMeeting({ startedAt: 50, endedAt: 90, host: 'pc' });
  const [m] = db.listMeetings();
  assert.deepEqual(m, { id: m.id, startedAt: 50, endedAt: 90, host: 'pc' });
  db.close();
});

test('data survives reopen', () => {
  const file = tmpFile();
  const db = openDb(file);
  db.insertSegment(seg(5));
  db.close();
  const again = openDb(file);
  assert.equal(again.listSegments().length, 1);
  again.close();
});

test('settings start empty and round-trip through the database', () => {
  const file = tmpFile();
  const db = openDb(file);
  assert.deepEqual(db.getSettings(), {});
  db.saveSettings({ cycleMinutes: 45, restMinutes: 5 });
  db.close();
  const again = openDb(file);
  assert.deepEqual(again.getSettings(), { cycleMinutes: 45, restMinutes: 5 });
  again.saveSettings({ cycleMinutes: 50 });
  assert.deepEqual(again.getSettings(), { cycleMinutes: 50 });
  again.close();
});

test('database uses a rollback journal, not WAL', () => {
  const file = tmpFile();
  const db = openDb(file);
  assert.equal(db.journalMode(), 'delete');
  db.insertSegment(seg(1));
  assert.equal(fs.existsSync(file + '-wal'), false);
  db.close();
});

test('an existing WAL database is switched to rollback journal without losing rows', () => {
  const { DatabaseSync } = require('node:sqlite');
  const file = tmpFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const raw = new DatabaseSync(file);
  raw.exec("PRAGMA journal_mode = WAL; CREATE TABLE segments (id INTEGER PRIMARY KEY, started_at INTEGER NOT NULL, ended_at INTEGER NOT NULL, end_reason TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', host TEXT NOT NULL); INSERT INTO segments (started_at, ended_at, end_reason, host) VALUES (1, 2, 'idle', 'pc');");
  raw.close();
  const db = openDb(file);
  assert.equal(db.journalMode(), 'delete');
  assert.equal(db.listSegments().length, 1);
  db.close();
});

test('daily backup makes one copy per day and keeps the newest 14', () => {
  const { dailyBackup } = require('../src/main/db');
  const file = tmpFile();
  const dir = path.join(path.dirname(file), 'backups');
  const db = openDb(file);
  db.insertSegment(seg(7));
  for (let d = 1; d <= 16; d++) dailyBackup(db, dir, new Date(2026, 9, d, 9).getTime());
  dailyBackup(db, dir, new Date(2026, 9, 16, 18).getTime()); // 同一天第二次：不再備份
  const files = fs.readdirSync(dir).sort();
  assert.equal(files.length, 14);
  assert.equal(files[0], 'antisedentary-2026-10-03.db');
  assert.equal(files.at(-1), 'antisedentary-2026-10-16.db');
  const copy = openDb(path.join(dir, files.at(-1)));
  assert.equal(copy.listSegments().length, 1);
  copy.close();
  db.close();
});

test('app state values are stored and survive reopen', () => {
  const file = tmpFile();
  const db = openDb(file);
  assert.equal(db.getState('tutorialSeen'), null);
  db.setState('tutorialSeen', '1');
  db.setState('tutorialSeen', '2');
  db.close();
  const again = openDb(file);
  assert.equal(again.getState('tutorialSeen'), '2');
  again.close();
});

test('a segment note can be written later', () => {
  const db = openDb(tmpFile());
  const id = db.insertSegment(seg(1));
  assert.equal(db.updateSegmentNote(id, '  補寫的內容\n第二行 '), true);
  assert.equal(db.listSegments()[0].note, '補寫的內容\n第二行');
  assert.equal(db.updateSegmentNote(9999, 'x'), false);
  db.close();
});

test('a written note can be cleared', () => {
  const db = openDb(tmpFile());
  const id = db.insertSegment(seg(1, { note: 'old' }));
  db.updateSegmentNote(id, '   ');
  assert.equal(db.listSegments()[0].note, '');
  db.close();
});
