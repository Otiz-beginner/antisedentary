# 防久坐小程式（Antisedentary）

連續使用電腦 29 分鐘後，右下角會浮出一張「水杯」提醒卡。給你 3 分鐘收尾，也可以記一下這段時間做了什麼。時間到就鎖住滑鼠鍵盤 3 分鐘，讓你起來動一動、看看遠方。

設計文件：[docs/superpowers/specs/2026-10-19-antisedentary-design.md](docs/superpowers/specs/2026-10-19-antisedentary-design.md)

## 開始用

需要 Windows 11 和 Node.js 24。

```bash
npm install
```

```bash
npm start
```

打包成可以直接執行的程式：

```bash
npm run dist
```

打包完的程式在 `dist\win-unpacked\Antisedentary.exe`。執行一次後，之後每次登入 Windows 都會自動啟動。

重新打包前，要先讓正在跑的程式存好檔再結束。用工作管理員強制結束的話，正在計的那一段會遺失：

```powershell
& "D:\antisedentary\dist\win-unpacked\Antisedentary.exe" --quit
```

## 東西放在哪裡

| 內容 | 位置 |
| --- | --- |
| 程式 | `D:\antisedentary\dist\win-unpacked\` |
| 紀錄資料庫 | `%APPDATA%\antisedentary\antisedentary.db` |

重裝或更新程式都不會動到紀錄。

## 怎麼操作

- **系統匣（右下角的水滴圖示）**：
  - 打開紀錄
  - 現在休息
  - 開會模式
  - 結束程式
- **開會模式**：按 `Ctrl+Alt+Shift+M` 或從系統匣開啟，鎖定中也可以按。開啟後不會提醒也不會鎖定，直到你自己關掉。開會模式中水滴會變成淡紫色。
- **離開 3 分鐘**：完全沒有操作滿 3 分鐘會暫停計時。回來時右下角會問「剛剛有站起來嗎？」；離開超過 30 分鐘就不問，直接算休息。
- **從紀錄頁提早休息**：「紀錄」頁右側的「提早休息」可以寫下這段做了什麼，按「開始休息」就馬上鎖定休息，紀錄會標成「提早休息」。
- **設定**：「紀錄」頁的左邊可以調整工作多久要休息、休息多久、滑手機上限等時間，按「儲存設定」就馬上生效。

## 開發

```bash
npm test
```

加速模式會把所有時間除以倍數，例如 60 倍時一輪只要 35 秒：

```powershell
$env:ANTISEDENTARY_SPEED=60; npm start
```

鎖住滑鼠鍵盤的是 `native/lockhelper.cs`，用 Windows 內建的 `csc.exe` 編譯：

```bash
npm run build:helper
```

它最多只會鎖 `--max-seconds` 秒，主程式結束時也會跟著結束，所以不會把你永遠鎖在外面。
