'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { KEYS, accelerator, vk, label } = require('../src/core/hotkeys');

test('the key list matches the plan', () => {
  assert.deepEqual(KEYS, ['M', 'K', 'J', 'P', 'E', 'X', 'B', '0', '9']);
});

test('accelerator is Ctrl+Alt+Shift plus the key for Electron', () => {
  assert.equal(accelerator('M'), 'Control+Alt+Shift+M');
  assert.equal(accelerator('9'), 'Control+Alt+Shift+9');
});

test('vk gives the Windows virtual-key code', () => {
  assert.equal(vk('M'), 0x4d);
  assert.equal(vk('E'), 0x45);
  assert.equal(vk('0'), 0x30);
  assert.equal(vk('9'), 0x39);
});

test('label is the readable form shown on screen', () => {
  assert.equal(label('E'), 'Ctrl + Alt + Shift + E');
});
