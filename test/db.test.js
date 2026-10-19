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
