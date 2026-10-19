# 防久坐小程式 實作計畫

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 做一支 Windows 系統匣常駐程式。它偵測連續使用電腦的時間，在第 29 分鐘出現「水杯」提醒卡，第 32 分鐘鎖住滑鼠鍵盤 3 分鐘，把每段工作的紀錄存進本機 SQLite，並提供日曆式 dashboard 查看紀錄。

**Architecture:**
- **純邏輯核心**：計時狀態機（`src/core/`）和 dashboard 統計（`src/shared/`）是純函式，用假時間做單元測試。
- **Electron 主行程的控制器**：負責三件事：
  - 每秒把系統閒置時間餵給狀態機
  - 把狀態機吐出的「效果」(effects) 轉成實際動作：開關視窗、寫資料庫、啟動輸入鎖
  - 處理系統匣和全域快捷鍵
- **輸入鎖**：一個用 Windows 內建 `csc.exe` 編譯的小 C# 程式（low-level keyboard/mouse hook）。只在鎖定期間執行，行程結束時 hook 自動消失。

**Tech Stack:**
- Electron（安裝時的最新穩定版，必須 ≥ 36，才有 `node:sqlite` 和 `backgroundMaterial`）
- 資料庫用 `node:sqlite`，不用原生模組，所以不需要 rebuild
- 測試用 Node 24 內建的 `node --test`
- C#（.NET Framework 4，`C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe`）
- 打包用 electron-builder
- 字型用 `@fontsource/huninn`、`@fontsource/noto-sans-tc`

**Spec:** `docs/superpowers/specs/2026-10-19-antisedentary-design.md`

**視覺參考（直接沿用 CSS）:**
- `.superpowers/brainstorm/mockups/screens-v5.html`：提醒卡、鎖定卡、水杯
- `.superpowers/brainstorm/mockups/dashboard-v1.html`：dashboard

## Global Constraints

**平台與權限**
- 只支援 Windows 11。全程不需要管理員權限，不使用 `BlockInput`。
- 執行時不連網路。字型打包進程式，不能用 Google Fonts CDN。

**位置**
- 資料庫：`path.join(app.getPath('appData'), 'antisedentary', 'antisedentary.db')`
- 程式專案和打包輸出都在 `D:\antisedentary`

**時間（毫秒，集中在 `src/core/config.js`）**

| 名稱 | 值 | 意思 |
| --- | --- | --- |
| `workMs` | 29 分 | 開始計時多久後出現提醒卡 |
| `reminderMs` | 3 分 | 提醒卡出現後多久鎖定 |
| `lockMs` | 3 分 | 鎖定多久 |
| `idleResetMs` | 3 分 | 沒有輸入多久就算離開 |
| `shortIdleSegmentMs` | 5 分 | dashboard 隱藏短段的門檻 |

- 環境變數 `ANTISEDENTARY_SPEED`（預設 1）會把以上時間全部除以這個倍數，方便開發測試。

**絕對不能有**
- 延後、關閉、最小化提醒卡的按鈕
- 在提醒卡上顯示倒數數字

**開會模式快捷鍵**
- `Ctrl+Alt+Shift+M`。Electron accelerator 寫成 `Control+Alt+Shift+M`。

**文案（逐字使用）**
- 提醒卡標題：「快到休息時間了」
- 提醒卡輸入框提示：「這段時間做了什麼？（可以不寫）」
- 提醒卡按鈕：「開始休息」
- 鎖定卡：「休息一下」＋ `m:ss`
- 系統匣選單：「打開紀錄」「現在休息」「開會模式」（勾選式）「結束程式」
- Dashboard：
  - 標題：「紀錄」
  - 總覽四格：「總工作時間」「工作段數」「平均每段」「有寫紀錄的段數」
  - 連續天數：「有工作的天數」「目前連續天數」「最長連續天數」
  - 某一天：「沒有寫紀錄」「提早休息」「這天沒有紀錄。」

**顏色**

| 色碼 | 用途 |
| --- | --- |
| `#7B9DC8` | 霧藍 |
| `#BFC9DF` | 灰藍 |
| `#92C7FF` | 水藍 |
| `#D3D5FF` | 淡薰衣草 |
| `#D2BAFF` | 淡紫 |
| `#2E3A55` | 深色字 |
| `rgba(46,58,85,.55)` | 鎖定遮罩 |

- 熱度圖由淺到深：`#E6E9F3`、`#D3D5FF`、`#92C7FF`、`#7B9DC8`、`#4E6FA0`

**動態效果**
- 系統開啟「減少動態效果」(`prefers-reduced-motion: reduce`) 時，波浪停住，只改變水位。
- 不要做水滴落下的動畫。

## Review Focus

1. **輸入鎖的行程失去控制**：可能是主程式當掉、被工作管理員結束，或是 C# helper 自己卡住。這時滑鼠鍵盤必須在幾秒內恢復。
   - 測試放在 Task 5：stdin 關閉時 helper 會結束；超過 `--max-seconds` 時 helper 會自己結束。
2. **在提醒卡或鎖定中，電腦睡眠或按了 Win+L**。回來時要依照離開的時間長短，決定歸零或繼續，不能卡在提醒卡或鎖定狀態。
   - 測試放在 Task 2：`resume after long suspend during reminder ends segment as idle`、`lock still ends after suspend`。
3. **紀錄文字裡有 `<script>`、換行或很長的文字**。dashboard 必須當成純文字顯示，不能被當成 HTML 執行。
   - 測試放在 Task 7：`renderDayList escapes html`。
4. **一段工作跨過午夜**，例如 23:50 到 00:22。這段歸到開始的那一天，不能重複算，也不能消失。
   - 測試放在 Task 4：`segment spanning midnight counts on start day`。
5. **提醒卡上寫到一半的字，在按下開會快捷鍵、閒置歸零或程式結束時都要保存**，而且不能被下一段誤用。
   - 測試放在 Task 6：`draft note attaches to the saved segment then clears`。

---

## File Structure

```
D:\antisedentary
├─ package.json                 # scripts: start, test, build:helper, dist
├─ .gitignore                   # node_modules/, dist/, .superpowers/, resources/lockhelper.exe
├─ src/
│  ├─ core/
│  │  ├─ config.js              # 時間常數 + speed 倍數
│  │  └─ machine.js             # 純狀態機 reducer
│  ├─ shared/
│  │  ├─ stats.js               # dashboard 統計（純函式，main 和 renderer 共用）
│  │  └─ dayView.js             # 某一天清單的 HTML 產生（含跳脫）
│  ├─ main/
│  │  ├─ main.js                # Electron 進入點：單一實例、開機啟動、組裝
│  │  ├─ controller.js          # 狀態機 ↔ 效果 dispatcher（可用假物件測試）
│  │  ├─ db.js                  # node:sqlite 存取
│  │  ├─ inputLock.js           # 啟動/停止 lockhelper.exe
│  │  ├─ windows.js             # 提醒卡、鎖定遮罩、dashboard 視窗
│  │  ├─ tray.js                # 系統匣
│  │  └─ preload.js             # contextBridge API
│  └─ renderer/
│     ├─ water.css              # 卡片、水杯、波浪、字型（從 mockup 抽出）
│     ├─ reminder.html / reminder.js
│     ├─ lock.html / lock.js
│     └─ dashboard.html / dashboard.css / dashboard.js
├─ native/lockhelper.cs
├─ scripts/build-helper.ps1     # 用 csc.exe 編到 resources/lockhelper.exe
├─ assets/tray.png, tray-meeting.png
└─ test/
   ├─ config.test.js, machine.test.js, db.test.js, stats.test.js,
   ├─ inputLock.test.js, controller.test.js, dayView.test.js
   └─ fixtures/fake-helper.js
```

**格式**
- 全部用 CommonJS（`'use strict'`）。原因是 Electron 的 sandbox preload 只能用 CommonJS。
- renderer 用一般 `<script>`，不用打包器。

---

### Task 1: 專案骨架與設定

**Files:**
- Create: `package.json`, `.gitignore`, `src/core/config.js`, `test/config.test.js`

**Interfaces:**
- Produces:
  - `getConfig(env = process.env) -> { workMs, reminderMs, lockMs, idleResetMs, shortIdleSegmentMs, tickMs, speed }`
  - `tickMs` 固定是 1000。它不受 speed 影響，但最小不能低於 250。

- [ ] **Step 1：初始化專案**
  - `D:\antisedentary` 目前還不是 git repo，先執行 `git init`。
  - 建立 `.gitignore`，內容照 File Structure 那一節。
  - 執行 `npm init -y`，設定 `"main": "src/main/main.js"`。
  - scripts：
    - `"start": "electron ."`
    - `"test": "node --test test/"`
  - 執行 `npm install --save-dev electron@latest electron-builder`，再把 `package.json` 裡的 electron 版本改成剛裝到的確切版本（不要 `^`）。

- [ ] **Step 2：確認 Electron 裡有 `node:sqlite`**
  - 執行：`npx electron -e "require('node:sqlite'); console.log('ok'); process.exit(0)"`
  - 預期輸出 `ok`。
  - 如果失敗：停下來回報，不要自己換成其他資料庫。

- [ ] **Step 3：寫失敗的測試** `test/config.test.js`

```js
test('default config uses spec minutes', () => {
  const c = getConfig({});
  assert.equal(c.workMs, 29 * 60000);
  assert.equal(c.reminderMs, 3 * 60000);
  assert.equal(c.lockMs, 3 * 60000);
  assert.equal(c.idleResetMs, 3 * 60000);
  assert.equal(c.shortIdleSegmentMs, 5 * 60000);
  assert.equal(c.speed, 1);
});
test('ANTISEDENTARY_SPEED divides durations', () => {
  const c = getConfig({ ANTISEDENTARY_SPEED: '60' });
  assert.equal(c.workMs, 29000);
  assert.equal(c.lockMs, 3000);
});
test('invalid speed falls back to 1', () => {
  assert.equal(getConfig({ ANTISEDENTARY_SPEED: 'abc' }).speed, 1);
  assert.equal(getConfig({ ANTISEDENTARY_SPEED: '0' }).speed, 1);
});
```

- [ ] **Step 4：執行測試，確認失敗**
  - 執行：`npm test`
  - 預期：FAIL，原因是 `Cannot find module '../src/core/config'`。

- [ ] **Step 5：實作 `getConfig`**

- [ ] **Step 6：執行測試，確認通過**
  - 執行：`npm test`
  - 預期：3 個測試全部 PASS。

- [ ] **Step 7：Commit**
  - `git add -A && git commit -m "chore: scaffold electron project and timing config"`

---

### Task 2: 計時狀態機

**Files:**
- Create: `src/core/machine.js`, `test/machine.test.js`

**Interfaces:**
- Consumes: Task 1 的 config 物件。
- Produces:
  - `initialState() -> { phase: 'away', since: 0 }`
  - `step(state, input, config) -> { state, effects }`

**`phase` 的可能值：**

| phase | 意思 | 額外欄位 |
| --- | --- | --- |
| `away` | 還沒開始計時 | `since`（進入 away 的時間） |
| `working` | 正常工作中 | `segStart` |
| `reminder` | 提醒卡出現中 | `segStart` |
| `locked` | 鎖定中 | `lockUntil` |
| `meeting` | 開會模式 | `meetingStart` |

- 另外，state 可以帶一個 `suspendAt` 欄位，記錄睡眠或 Win+L 的開始時間。

**`input` 的可能值：**
- `{type:'tick', now, idleMs}`
- `{type:'startBreak', now, source:'card'|'tray'}`
- `{type:'meetingOn', now}`
- `{type:'meetingOff', now}`
- `{type:'suspend', now}`
- `{type:'resume', now}`
- `{type:'quit', now}`

**`effects` 的可能值（陣列，依序執行）：**
- `{type:'showReminder', startsAt, endsAt}`
- `{type:'hideReminder'}`
- `{type:'lock', startsAt, endsAt}`
- `{type:'unlock'}`
- `{type:'saveSegment', startedAt, endedAt, endReason}`，其中 `endReason` 是下列其中一個：
  - `'timeout'`：時間到
  - `'card'`：在提醒卡按「開始休息」
  - `'tray'`：從系統匣按「現在休息」
  - `'idle'`：閒置歸零
  - `'meeting'`：進入開會模式
  - `'quit'`：程式結束
- `{type:'saveMeeting', startedAt, endedAt}`

**規則**（來自 spec §3、§4，令 `W=workMs, R=reminderMs, L=lockMs, I=idleResetMs`）：

| 目前 phase | 輸入 | 下一個 phase | effects |
|---|---|---|---|
| away | tick 且 `idleMs < I` | working，`segStart = max(now - idleMs, since)` | — |
| working | tick 且 `idleMs >= I` | away | saveSegment(`segStart`, `now - idleMs`, 'idle') |
| working | tick 且 `now - segStart >= W` | reminder | showReminder(`segStart+W`, `segStart+W+R`) |
| reminder | tick 且 `idleMs >= I` | away | hideReminder；saveSegment(…, `now - idleMs`, 'idle') |
| reminder | tick 且 `now >= segStart+W+R` | locked | hideReminder；saveSegment(`segStart`, `now`, 'timeout')；lock(`now`, `now+L`) |
| locked | tick 且 `now >= lockUntil` | away | unlock |
| working/reminder | startBreak(source) | locked | （reminder 時先 hideReminder）；saveSegment(`segStart`, `now`, source)；lock(`now`, `now+L`) |
| away | startBreak('tray') | locked | lock（不存 segment） |
| locked | startBreak | 不變 | 不變 |
| working/reminder | meetingOn | meeting | （reminder 時先 hideReminder）；saveSegment(…, `now`, 'meeting') |
| locked | meetingOn | meeting | unlock |
| away | meetingOn | meeting | — |
| meeting | 任何 tick 或 startBreak | 不變 | 不變（開會模式不提醒、不鎖定） |
| meeting | meetingOff | away | saveMeeting(`meetingStart`, `now`) |
| 任何 phase | suspend | 不變，記錄 `suspendAt = now` | — |
| working/reminder | resume 且 `now - suspendAt >= I` | away | （reminder 時先 hideReminder）；saveSegment(`segStart`, `suspendAt`, 'idle') |
| 其他 | resume | 清掉 `suspendAt`，交給下一個 tick 判斷 | — |
| working/reminder | quit | — | saveSegment(…, `now`, 'quit') |
| meeting | quit | — | saveMeeting |
| locked | quit | — | unlock |

- 同一個 tick 同時滿足「閒置」和「時間到」時，**閒置優先**。
- 每次進入 `away`，都要把 `since` 設成當下的時間。可能的時間點：解鎖、閒置歸零、關閉開會模式、resume 歸零。
  - 原因：鎖定期間被吞掉的輸入，可能讓系統閒置時間變短。用 `since` 擋住，新的一段才不會從鎖定期間開始算。

- [ ] **Step 1：寫失敗的測試** `test/machine.test.js`
  - 用輔助函式 `run(inputs)`，從 `initialState()` 開始依序呼叫 `step`，最後回傳 `{ state, effects: 全部 effects 串在一起 }`。
  - 測試用的 config：`W=29m, R=3m, L=3m, I=3m`。

```js
test('first input starts a segment at last-input time');           // tick(now=10s, idleMs=2s) -> working, segStart 8000
test('reminder shows at 29:00 with endsAt 32:00');                  // effects include showReminder{startsAt:29m+t0, endsAt:32m+t0}
test('locks at 32:00 and saves timeout segment');                   // saveSegment endReason 'timeout', lock endsAt now+3m
test('unlocks after 3 minutes then waits for input');               // phase 'away' after unlock
test('segment after unlock never starts before unlock');           // 解鎖後下一個 tick 的 idleMs=10s -> segStart === 解鎖的時間
test('idle 3 minutes during working ends segment at last input');   // endedAt === now - idleMs, reason 'idle'
test('idle 2.5 minutes keeps counting');                            // still working, no effects
test('idle reaching 3 minutes during reminder hides card, no lock');// hideReminder + saveSegment 'idle', no lock effect
test('idle wins when idle and timeout coincide');
test('card startBreak locks immediately with reason card');
test('tray startBreak from away locks without saving');
test('startBreak while locked is ignored');
test('meetingOn during reminder saves segment reason meeting');
test('meetingOn while locked unlocks');
test('meeting mode never reminds or locks');                        // 2 小時的 tick 都沒有 effects
test('meetingOff saves meeting and returns to away');
test('resume after long suspend during reminder ends segment as idle'); // endedAt === suspendAt
test('resume after short suspend keeps counting');                  // 2 分鐘 suspend，維持 working，segStart 不變
test('lock still ends after suspend');                              // suspend 中經過 lockUntil，resume 後下一個 tick -> unlock
test('quit during working saves quit segment');
```

  每個測試的 assert 要寫出確切的 `phase`、effect 的 `type`，以及上表規定的時間值。

- [ ] **Step 2：執行測試，確認失敗**
  - 執行：`node --test test/machine.test.js`
  - 預期：FAIL，原因是 `Cannot find module`。

- [ ] **Step 3：實作 `step`**
  - 用一個 `switch (state.phase)` 加上依 input type 的分支。
  - 必須是純函式：不能讀 `Date.now()`，也不能有 I/O。

- [ ] **Step 4：執行測試，確認通過**
  - 執行：`node --test test/machine.test.js`
  - 預期：20 個測試全部 PASS。

- [ ] **Step 5：Commit**
  - `git commit -am "feat: session state machine"`（第一次新增檔案時，要先 `git add` 新檔）

---

### Task 3: 本機資料庫

**Files:**
- Create: `src/main/db.js`, `test/db.test.js`

**Interfaces:**
- Produces:
  - `openDb(filePath) -> Db`：自動建立資料夾和資料表
  - `Db.insertSegment({ startedAt, endedAt, endReason, note, host }) -> id`
  - `Db.insertMeeting({ startedAt, endedAt, host }) -> id`
  - `Db.listSegments() -> Segment[]`：依 `startedAt` 由小到大排序
  - `Db.listMeetings() -> Meeting[]`
  - `Db.close()`
- 時間都存 epoch 毫秒（INTEGER）。`note` 存 TEXT，沒寫的時候存空字串 `''`。

**資料表**
- `segments(id INTEGER PK, started_at INTEGER NOT NULL, ended_at INTEGER NOT NULL, end_reason TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', host TEXT NOT NULL)`
- `meetings(id INTEGER PK, started_at INTEGER NOT NULL, ended_at INTEGER NOT NULL, host TEXT NOT NULL)`
- 建立 index：`segments(started_at)`
- 設定 `PRAGMA journal_mode=WAL`

- [ ] **Step 1：寫失敗的測試**
  - 測試資料庫放在 `fs.mkdtempSync(os.tmpdir())` 建立的暫存資料夾。

```js
test('creates parent folder and tables');                // openDb(tmp/'a'/'b.db') 不會丟錯，檔案存在
test('inserts and lists segments in start order');       // 先插入 t=200 再插入 t=100，list 的結果是 [100, 200]
test('stores note text exactly including newlines and <tags>');
test('empty note stored as empty string');               // insertSegment 沒給 note -> ''
test('inserts and lists meetings');
test('data survives reopen');                            // close 後 openDb 同一個路徑，資料還在
```

- [ ] **Step 2：執行測試，確認失敗**
  - 執行：`node --test test/db.test.js`
  - 預期：FAIL。

- [ ] **Step 3：實作**
  - 使用 `const { DatabaseSync } = require('node:sqlite')`。
  - 一律用 prepared statement，不能把字串拼進 SQL。

- [ ] **Step 4：執行測試，確認通過**
  - 執行：`node --test test/db.test.js`
  - 預期：6 個測試全部 PASS。

- [ ] **Step 5：Commit**
  - `feat: sqlite storage for segments and meetings`

---

### Task 4: Dashboard 統計

**Files:**
- Create: `src/shared/stats.js`, `test/stats.test.js`

**Interfaces:**
- Consumes: Task 3 的 `Segment`、`Meeting` 形狀。
- Produces（全部是純函式，時區用執行環境的本地時間）：
  - `dayKey(ms) -> 'YYYY-MM-DD'`
  - `visibleSegments(segments, shortIdleSegmentMs) -> Segment[]`：去掉「`endReason==='idle'` 且長度 < 門檻 且 note 是空的」的段
  - `summarize(visible) -> { totalMs, count, avgMs, notedCount }`
  - `countsByDay(visible) -> Map<dayKey, number>`：用開始時間歸日
  - `heatLevel(n) -> 0..4`：0 段 → 0；1–2 → 1；3–4 → 2；5–7 → 3；8 以上 → 4
  - `streaks(dayKeysSet, todayKey) -> { activeDays, current, longest }`
    - `current`：從今天往回算的連續天數。如果今天還沒有紀錄，就從昨天開始算。
  - `segmentsOnDay(visible, dayKey) -> Segment[]`
  - `meetingsOnDay(meetings, dayKey) -> Meeting[]`
  - `isEarly(seg) -> boolean`：`endReason` 是 `'card'` 或 `'tray'` 時為 true

- [ ] **Step 1：寫失敗的測試**

```js
test('short idle segment without note is hidden');          // idle、4 分鐘、note '' -> 隱藏
test('short idle segment with note is kept');
test('long idle segment is kept');                          // idle、6 分鐘 -> 保留
test('summarize totals, average and noted count');
test('segment spanning midnight counts on start day');      // 23:50–00:22 -> 只算在開始那天
test('heatLevel thresholds', () => { assert.deepEqual([0,1,2,3,4,5,7,8,12].map(heatLevel), [0,1,1,2,2,3,3,4,4]); });
test('streak counts back from today, or from yesterday if today empty');
test('longest streak across gaps');
test('isEarly true only for card and tray');
```

- [ ] **Step 2：執行測試，確認失敗**
  - 執行：`node --test test/stats.test.js`
  - 預期：FAIL。

- [ ] **Step 3：實作**
  - 檔案結尾要能在瀏覽器裡用：`if (typeof module !== 'undefined') module.exports = {...}; else window.Stats = {...}`

- [ ] **Step 4：執行測試，確認通過**
  - 執行：`node --test test/stats.test.js`
  - 預期：全部 PASS。

- [ ] **Step 5：Commit**
  - `feat: dashboard statistics`

---

### Task 5: 輸入鎖（C# helper ＋ Node 包裝）

**Files:**
- Create: `native/lockhelper.cs`, `scripts/build-helper.ps1`, `src/main/inputLock.js`, `test/inputLock.test.js`, `test/fixtures/fake-helper.js`

**Interfaces:**
- Produces:
  - `startInputLock({ exePath, prefixArgs = [], maxSeconds, onMeetingHotkey, spawn = child_process.spawn }) -> { stop(): void, ready: Promise<void> }`
    - `prefixArgs` 只給測試用：讓測試可以把 fake helper 當成 exe 來啟動。
  - 打包後的 `exePath` 是 `path.join(process.resourcesPath, 'lockhelper.exe')`；開發時是 `path.join(__dirname, '../../resources/lockhelper.exe')`。

**helper 的行為規格（`lockhelper.exe --max-seconds N`）：**
- 安裝 `WH_KEYBOARD_LL` 和 `WH_MOUSE_LL` 兩個 hook，回呼一律回傳 1，把輸入吞掉。
  - 例外：偵測到 `Ctrl+Alt+Shift+M` 按下時，在 stdout 輸出一行 `MEETING` 並 flush。這組按鍵也一起吞掉。
  - 修飾鍵的狀態要在 hook 裡自己追蹤，因為被吞掉的按鍵不會更新 `GetAsyncKeyState`。
- hook 裝好後，在 stdout 輸出一行 `READY`。
- 用背景執行緒讀 stdin。讀到 EOF（父行程死掉或關閉管線），或讀到一行 `STOP`，就結束行程。
- 啟動後超過 N 秒就自己結束。這是安全保險。
- 用 `Application.Run()` 或 `GetMessage` 迴圈維持 hook 運作。

**`build-helper.ps1`：**
- 用 `& "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe" /nologo /target:winexe /out:resources\lockhelper.exe native\lockhelper.cs` 編譯。
- 在 `package.json` 加 script：`"build:helper": "powershell -ExecutionPolicy Bypass -File scripts/build-helper.ps1"`

**包裝（`inputLock.js`）：**
- 用 `spawn(exePath, ['--max-seconds', String(maxSeconds)], { stdio: ['pipe','pipe','ignore'], windowsHide: true })` 啟動 helper。
- 逐行讀 stdout：
  - 看到 `READY` 就 resolve `ready`。
  - 看到 `MEETING` 就呼叫 `onMeetingHotkey()`。
- `stop()`：先寫入 `STOP\n`，再 `stdin.end()`，500ms 後如果 helper 還沒結束就 `kill()`。
- `stop()` 可以重複呼叫，不會出錯。

**`fake-helper.js`（給測試用）：**
- 一個 node 腳本，模擬上面的協定：啟動後印 `READY`。
- 參數 `--emit-meeting` 會讓它接著印 `MEETING`。
- stdin 收到 EOF 時就結束。

- [ ] **Step 1：寫失敗的測試**
  - 測試時，用 `spawn` 參數把 `exePath` 換成 `process.execPath`，並在參數前面加上 fake-helper 的路徑。

```js
test('ready resolves when helper prints READY');
test('MEETING line calls onMeetingHotkey once');
test('stop ends the helper process');                       // 等待 child 的 'exit' 事件，2 秒內要發生
test('stop is safe to call twice');
test('helper exits when parent closes stdin');               // 直接結束 child.stdin -> 子行程結束
```

- [ ] **Step 2：執行測試，確認失敗**
  - 執行：`node --test test/inputLock.test.js`
  - 預期：FAIL。

- [ ] **Step 3：實作 `inputLock.js` 和 `fake-helper.js`**
  - 實際啟動的指令是 `spawn(exePath, [...prefixArgs, '--max-seconds', String(maxSeconds)], …)`。

- [ ] **Step 4：執行測試，確認通過**
  - 執行：`node --test test/inputLock.test.js`
  - 預期：5 個測試全部 PASS。

- [ ] **Step 5：寫 `lockhelper.cs` 和 `build-helper.ps1`，然後編譯**
  - 執行：`npm run build:helper`
  - 預期：產生 `resources\lockhelper.exe`，沒有編譯錯誤。

- [ ] **Step 6：真機手動驗證（必須先問使用者）**
  - 這一步會鎖住使用者的鍵盤滑鼠 5 秒，**執行前必須先在對話中徵得使用者同意**。
  - 執行：`resources\lockhelper.exe --max-seconds 5`
  - 預期：
    - 5 秒內滑鼠鍵盤都沒有作用。
    - 5 秒後自動恢復，行程結束。
    - 在這 5 秒內按 `Ctrl+Alt+Shift+M`，stdout 會出現 `MEETING`。
  - 把結果回報給使用者。

- [ ] **Step 7：Commit**
  - 把 `resources/lockhelper.exe` 加進 `.gitignore`，它由 build script 產生。
  - `feat: input lock helper with safety timeout`

---

### Task 6: 控制器（狀態機 ↔ 實際動作）

**Files:**
- Create: `src/main/controller.js`, `test/controller.test.js`

**Interfaces:**
- Consumes:
  - Task 2 的 `step` 和 `initialState`
  - Task 3 的 `Db`
  - Task 5 的 `startInputLock`
- Produces：`createController({ config, db, ui, startLock, host, now = Date.now, getIdleMs })`，回傳物件的方法：
  - `tick()`：用 `now()` 和 `getIdleMs()` 送出一個 `tick` input
  - `dispatch(input)`
  - `setDraftNote(text)`
  - `get phase()`
  - `get inMeeting()`

**`ui` 物件要有的方法**（Task 7 會實作）：
- `showReminder({startsAt, endsAt})`
- `hideReminder()`
- `showLock({startsAt, endsAt})`
- `hideLock()`
- `setMeetingIndicator(on: boolean)`

**effect 怎麼對應到實際動作：**
- `saveSegment`：呼叫 `db.insertSegment`，帶上 `note: draft.trim()`、`host`，存完把 draft 清成 `''`。
- `saveMeeting`：呼叫 `db.insertMeeting`。
- `lock`：
  - 呼叫 `ui.showLock`。
  - 呼叫 `startLock({ maxSeconds: Math.ceil(config.lockMs/1000) + 5, onMeetingHotkey: () => dispatch({type:'meetingOn', now: now()}) })`，把回傳的 handle 存起來。
- `unlock`：
  - 呼叫 handle 的 `stop()`。
  - 呼叫 `ui.hideLock()`。
- 每次 phase 進入或離開 `meeting`，都要呼叫 `ui.setMeetingIndicator`。
- 如果 `startLock` 丟出錯誤（例如找不到 exe）：照樣顯示鎖定畫面，並用 `console.error` 記錄。不能讓程式整個掛掉。

- [ ] **Step 1：寫失敗的測試**
  - 用假的 `db`、`ui`、`startLock`（都會記錄被呼叫的內容），加上可以手動往前推的假時鐘。

```js
test('draft note attaches to the saved segment then clears');   // setDraftNote('abc')，觸發 meetingOn -> insertSegment 收到 note 'abc'；下一段收到 note ''
test('note is trimmed');
test('lock effect shows lock and starts input lock with lockMs+5s cap');
test('unlock stops input lock and hides lock window');
test('meeting hotkey from helper unlocks and enables meeting indicator');
test('startLock throwing still shows lock window');
test('full cycle at speed: reminder at 29m, lock at 32m, unlock at 35m'); // 用假時鐘每秒呼叫一次 tick，idleMs 固定 0
```

- [ ] **Step 2：執行測試，確認失敗**
  - 執行：`node --test test/controller.test.js`
  - 預期：FAIL。

- [ ] **Step 3：實作**

- [ ] **Step 4：執行測試，確認通過**
  - 執行：`node --test test/controller.test.js`
  - 預期：7 個測試全部 PASS。

- [ ] **Step 5：Commit**
  - `feat: controller wiring machine effects to ui, db and input lock`

---

### Task 7: 視窗、畫面與系統匣（接上 Electron）

**Files:**
- Create:
  - `src/main/main.js`, `src/main/windows.js`, `src/main/tray.js`, `src/main/preload.js`
  - `src/renderer/water.css`, `src/renderer/reminder.html`, `src/renderer/reminder.js`, `src/renderer/lock.html`, `src/renderer/lock.js`
  - `src/shared/dayView.js`, `test/dayView.test.js`
  - `src/renderer/dashboard.html`, `src/renderer/dashboard.css`, `src/renderer/dashboard.js`
  - `assets/tray.png`, `assets/tray-meeting.png`
- Test: `test/dayView.test.js`

**Interfaces:**
- Consumes：Task 6 的 controller 和 `ui` 介面、Task 4 的 stats、Task 3 的 db。
- Produces：preload 透過 `contextBridge` 暴露 `window.api`：
  - 提醒卡：
    - `onReminder(cb({startsAt, endsAt}))`
    - `setDraftNote(text)`
    - `startBreak()`
  - 鎖定畫面：
    - `onLock(cb({startsAt, endsAt, primary}))`
  - dashboard：
    - `getRecords() -> Promise<{ segments, meetings, now, shortIdleSegmentMs }>`

**`dayView.js`：**
- 介面：`renderDayList(segments, meetings) -> string`
- 產生「某一天」逐段清單的 HTML，所有使用者文字都要先跳脫 `& < > " '`。
- 檔案結尾的匯出方式跟 Task 4 一樣，main 和瀏覽器都能用。

**視窗規格（`windows.js`）：**
- **提醒卡**
  - `BrowserWindow` 設定：`frame:false, transparent:true, resizable:false, skipTaskbar:true, alwaysOnTop:true, show:false`，大小 320×210。
  - 置頂層級：`setAlwaysOnTop(true, 'screen-saver')`。
  - 位置：主螢幕 `workArea` 的右下角，往內留 16px。
  - 用 `showInactive()` 顯示，**不搶焦點**。使用者點進輸入框時才會拿到焦點。
  - 點其他視窗時卡片不會隱藏，也就是不監聽 `blur` 事件。
- **鎖定**
  - 每個 `screen.getAllDisplays()` 開一個全螢幕 `BrowserWindow`。
  - 設定：`frame:false, transparent:false, backgroundMaterial:'acrylic', alwaysOnTop:'screen-saver', skipTaskbar:true, focusable:true, fullscreen` 蓋住 `display.bounds`。
  - 頁面背景用 `rgba(46,58,85,.55)` 疊在壓克力模糊上。
  - 只有主螢幕那個視窗的頁面，在右下角顯示「休息一下」卡片（`primary:true`）。
  - 實作完要截圖確認背後真的是模糊的。如果 acrylic 沒有模糊效果，就停下來回報，不要用其他假的效果代替。
- **Dashboard**：一般視窗，1080×800，關閉時只是隱藏，不結束程式。

**畫面（從 mockup 搬過來）：**
- `water.css` 從 `screens-v5.html` 抽出這些樣式：`.card`、`.tank`、`.tank::before`、`.tank::after`、`@keyframes flow/flow2`、`.card.enter`、`.card.rest`、`prefers-reduced-motion` 的部分。
- 字型改用本地檔案：`npm install @fontsource/huninn @fontsource/noto-sans-tc`，再從 `node_modules` 用相對路徑引入它們的 CSS。
  - 如果 `@fontsource/huninn` 不存在，就停下來回報，不要從其他網站下載。
- `reminder.js`：
  - 每 250ms 依 `1 - (Date.now()-startsAt)/(endsAt-startsAt)` 設定 `--level`（限制在 0–1 之間）。
  - 輸入框的 `input` 事件做 300ms debounce，再呼叫 `api.setDraftNote`。
  - 每次顯示時清空輸入框。
- `lock.js`：
  - `--level = (now-startsAt)/(endsAt-startsAt)`。
  - 倒數用 `m:ss` 格式，例如 `2:41`。
  - 時間到之後由 main 關閉視窗，renderer 不要自己關。
- `dashboard.html/css/js`：
  - 版面照 `dashboard-v1.html`。
  - 資料改成 `api.getRecords()` 回傳的真實資料，用 `Stats` 計算。
  - 某一天的清單用 `renderDayList` 產生。
  - 時間軸要另外用淡紫色 `#D2BAFF` 標出開會模式的區段。
- 每一頁都要設定 Content-Security-Policy：`default-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'`。

**系統匣（`tray.js`）：**
- 選單：「打開紀錄」「現在休息」「開會模式」（`type:'checkbox'`）「結束程式」。
  - 「現在休息」：`dispatch({type:'startBreak', source:'tray'})`
  - 「開會模式」：依勾選狀態送出 `meetingOn` 或 `meetingOff`
- 開會中把圖示換成 `tray-meeting.png`（淡紫），同時更新勾選狀態。
- 兩個圖示都是 16×16 和 32×32 的 PNG，用一個小 node 腳本或手繪產生：
  - `tray.png` 是一滴水藍色 `#92C7FF` 的水滴。
  - `tray-meeting.png` 是同樣的水滴，換成淡紫 `#D2BAFF`。

**`main.js`：**
- `app.requestSingleInstanceLock()`，拿不到就直接 `app.quit()`。
- 不顯示 dock 或主視窗；`window-all-closed` 時不結束程式。
- 用 `os.hostname()` 當 host。
- `setInterval(controller.tick, config.tickMs)`，`getIdleMs = () => powerMonitor.getSystemIdleTime() * 1000`。
- 把 `powerMonitor` 的 `suspend` 和 `lock-screen` 事件送成 `suspend`，`resume` 和 `unlock-screen` 事件送成 `resume`。
- `globalShortcut.register('Control+Alt+Shift+M', 切換開會模式)`。
- `before-quit` 時送出 `quit`，再關閉資料庫。
- 只有打包後（`app.isPackaged`）才呼叫 `app.setLoginItemSettings({ openAtLogin: true })`。

- [ ] **Step 1：寫失敗的測試** `test/dayView.test.js`

```js
test('renderDayList escapes html', () => {
  const html = renderDayList([{ startedAt: t, endedAt: t + 32*60000, endReason: 'timeout', note: '<script>x</script> & "q"' }], []);
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&lt;script&gt;'));
});
test('empty note shows 沒有寫紀錄');
test('card and tray segments get 提早休息 tag');
test('no segments renders 這天沒有紀錄。');
```

- [ ] **Step 2：執行測試，確認失敗**
  - 執行：`node --test test/dayView.test.js`
  - 預期：FAIL。

- [ ] **Step 3：實作 `dayView.js`，再執行測試確認通過**
  - 執行：`node --test test/dayView.test.js`
  - 預期：4 個測試全部 PASS。

- [ ] **Step 4：實作 main、windows、tray、preload 和各個 renderer**

- [ ] **Step 5：加速模式跑一輪**
  - 執行：`$env:ANTISEDENTARY_SPEED=60; npm start`。這個倍數下，一輪是 29 秒工作、3 秒提醒、3 秒鎖定。
  - 執行前要先告訴使用者：鎖定的 3 秒內，滑鼠鍵盤會被擋住。
  - 預期：
    - 系統匣出現水滴圖示。
    - 一直移動滑鼠的話，大約 29 秒時右下角浮出提醒卡，水位一路下降。
    - 提醒卡出現時點別的視窗，卡片仍然在。
    - 大約 32 秒時所有螢幕變暗加模糊，右下角顯示「休息一下」和倒數。
    - 大約 35 秒時解鎖。
  - 每個階段都截圖，跟 mockup 比對。
  - 全螢幕程式的情況：開一個全螢幕影片再跑一次鎖定，看遮罩能不能蓋過去。
    - 蓋得過：不用做任何事。
    - 蓋不過：spec §4.3 要求鎖定照樣進行，並在 `lock` 時同時送出 Windows 通知 `new Notification({ title: '休息一下' })`。
    - 無論哪一種，都把結果回報給使用者。

- [ ] **Step 6：驗證開會模式和紀錄**
  - 在提醒卡輸入「測試紀錄」，然後按 `Ctrl+Alt+Shift+M`：
    - 卡片收起。
    - 系統匣圖示變成淡紫。
  - 等 1 分鐘，確認沒有任何提醒或鎖定。
  - 再按一次 `Ctrl+Alt+Shift+M` 關閉開會模式。
  - 打開「打開紀錄」：今天的清單要有一段紀錄寫著「測試紀錄」，時間軸上要有一段淡紫色的開會區段。

- [ ] **Step 7：執行全部測試**
  - 執行：`npm test`
  - 預期：全部 PASS。

- [ ] **Step 8：Commit**
  - `feat: reminder card, lock overlay, tray and dashboard`

---

### Task 8: 打包與開機啟動

**Files:**
- Modify: `package.json`（`build` 設定、`dist` script）

**Interfaces:**
- Consumes：Task 5 的 `resources/lockhelper.exe`、Task 7 的整個 app。

- [ ] **Step 1：設定 electron-builder**
  - `"build": { "appId": "local.antisedentary", "productName": "Antisedentary", "win": { "target": "dir", "icon": "assets/tray.png" }, "extraResources": [{ "from": "resources/lockhelper.exe", "to": "lockhelper.exe" }], "directories": { "output": "dist" } }`
  - script：`"dist": "npm run build:helper && electron-builder --win dir"`

- [ ] **Step 2：打包**
  - 執行：`npm run dist`
  - 預期：產生 `D:\antisedentary\dist\win-unpacked\Antisedentary.exe`，裡面的 `resources\lockhelper.exe` 也存在。

- [ ] **Step 3：驗證打包後的版本**
  - 執行 `dist\win-unpacked\Antisedentary.exe`。
  - 確認系統匣出現圖示，「打開紀錄」可以開啟 dashboard。
  - 確認登錄機碼 `HKCU\Software\Microsoft\Windows\CurrentVersion\Run` 有 Antisedentary 的項目：`reg query HKCU\Software\Microsoft\Windows\CurrentVersion\Run`。
  - 確認 `%APPDATA%\antisedentary\antisedentary.db` 已經建立。

- [ ] **Step 4：寫 `README.md`**
  - 內容（中文，簡短）：
    - 怎麼開始用：`npm install`、`npm start`、`npm run dist`
    - 程式和資料各在哪裡
    - 開會模式的快捷鍵
    - 加速模式怎麼開

- [ ] **Step 5：Commit**
  - `build: package windows app with autostart`
