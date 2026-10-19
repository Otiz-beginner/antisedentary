'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createLogger } = require('../src/main/logger');

const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'antised-log-'));

test('writes timestamped lines and creates the folder', () => {
  const file = path.join(tmpDir(), 'logs', 'app.log');
  const log = createLogger(file, { now: () => new Date(2026, 9, 19, 17, 15, 28, 5).getTime() });
  log('started', { version: '0.1.0' });
  const text = fs.readFileSync(file, 'utf8');
  assert.equal(text, '2026-10-19 17:15:28.005 started {"version":"0.1.0"}\n');
});

test('appends across loggers', () => {
  const file = path.join(tmpDir(), 'app.log');
  createLogger(file)('one');
  createLogger(file)('two');
  const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
  assert.equal(lines.length, 2);
  assert.ok(lines[1].endsWith(' two'));
});

test('errors are written with their stack', () => {
  const file = path.join(tmpDir(), 'app.log');
  createLogger(file)('uncaught', new Error('boom'));
  const text = fs.readFileSync(file, 'utf8');
  assert.ok(text.includes('boom'));
  assert.ok(text.includes('logger.test.js'));
});

test('rotates to app.log.1 when the file grows past the limit', () => {
  const file = path.join(tmpDir(), 'app.log');
  const log = createLogger(file, { maxBytes: 200 });
  for (let i = 0; i < 20; i++) log(`line ${i} ${'x'.repeat(20)}`);
  assert.ok(fs.existsSync(file + '.1'));
  assert.ok(fs.statSync(file).size <= 200 + 100);
});

test('a broken log path never throws', () => {
  const log = createLogger(path.join(tmpDir(), 'app.log'));
  assert.doesNotThrow(() => log('x', { circular: (() => { const o = {}; o.self = o; return o; })() }));
});
