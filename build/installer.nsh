; 安裝或更新前，先請正在跑的 Antisedentary 存好檔再結束（用 --quit），
; 這樣更新時不會弄丟正在計時的那一段紀錄。之後才交給 electron-builder 原本的「程式還在跑」檢查。
!macro customInit
  IfFileExists "$INSTDIR\${APP_EXECUTABLE_FILENAME}" 0 +3
    nsExec::Exec '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" --quit'
    Sleep 3000
!macroend
