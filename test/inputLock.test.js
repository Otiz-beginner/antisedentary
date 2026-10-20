'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { startInputLock } = require('../src/main/inputLock');

const FAKE = path.join(__dirname, 'fixtures', 'fake-helper.js');

function startFake(opts = {}) {
  return startInputLock({
    exePath: process.execPath,
    prefixArgs: [FAKE, ...(opts.extraArgs || [])],
    maxSeconds: 10,
    onMeetingHotkey: opts.onMeetingHotkey || (() => {}),
  });
}

const within = (promise, ms) => Promise.race([
  promise,
  new Promise((_, reject) => setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms)),
]);

test('ready resolves when helper prints READY', async () => {
  const lock = startFake();
  await within(lock.ready, 2000);
  lock.stop();
  await within(lock.exited, 2000);
});

test('MEETING line calls onMeetingHotkey once', async () => {
  let calls = 0;
  const lock = startFake({ extraArgs: ['--emit-meeting'], onMeetingHotkey: () => { calls++; } });
  await within(lock.ready, 2000);
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(calls, 1);
  lock.stop();
  await within(lock.exited, 2000);
});

test('stop ends the helper process', async () => {
  const lock = startFake();
  await within(lock.ready, 2000);
  lock.stop();
  await within(lock.exited, 2000);
});

test('stop is safe to call twice', async () => {
  const lock = startFake();
  await within(lock.ready, 2000);
  lock.stop();
  lock.stop();
  await within(lock.exited, 2000);
});

test('helper exits when parent closes stdin', async () => {
  const lock = startFake();
  await within(lock.ready, 2000);
  lock.child.stdin.end();
  await within(lock.exited, 2000);
});

test('missing exe rejects ready instead of throwing', async () => {
  const lock = startInputLock({ exePath: path.join(__dirname, 'no-such.exe'), maxSeconds: 5, onMeetingHotkey() {} });
  await assert.rejects(within(lock.ready, 2000));
  lock.stop();
});

test('ESCAPE line calls onEscapeHotkey', async () => {
  let escapes = 0;
  let meetings = 0;
  const lock = startInputLock({
    exePath: process.execPath, prefixArgs: [FAKE, '--emit-escape'], maxSeconds: 10,
    onMeetingHotkey: () => { meetings++; }, onEscapeHotkey: () => { escapes++; },
  });
  try {
    await within(lock.ready, 2000);
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(escapes, 1);
    assert.equal(meetings, 0);
  } finally {
    lock.stop();
    await within(lock.exited, 2000);
  }
});

test('helper gets the two virtual-key codes', async () => {
  const calls = [];
  const fakeSpawn = (exe, args) => { calls.push(args); return require('node:child_process').spawn(process.execPath, [FAKE], { stdio: ['pipe', 'pipe', 'ignore'] }); };
  const lock = startInputLock({ exePath: 'x.exe', maxSeconds: 9, meetingVk: 0x4d, escapeVk: 0x45, onMeetingHotkey() {}, onEscapeHotkey() {}, spawn: fakeSpawn });
  try {
    await within(lock.ready, 2000);
    assert.deepEqual(calls[0], ['--max-seconds', '9', '--meeting-vk', '77', '--escape-vk', '69']);
  } finally {
    lock.stop();
    lock.child.kill();
    await within(lock.exited, 2000);
  }
});
