'use strict';

// 可選的快捷鍵：一律是 Ctrl + Alt + Shift + 一個鍵，避免跟常用軟體衝突或誤觸。
(function () {
  const KEYS = ['M', 'K', 'J', 'P', 'E', 'X', '0', '9'];

  const accelerator = (key) => `Control+Alt+Shift+${key}`;
  // Windows 的 virtual-key code：英文字母和數字剛好等於它的 ASCII 大寫
  const vk = (key) => key.charCodeAt(0);
  const label = (key) => `Ctrl + Alt + Shift + ${key}`;

  const api = { KEYS, accelerator, vk, label };
  if (typeof module !== 'undefined') module.exports = api;
  else window.Hotkeys = api;
})();
