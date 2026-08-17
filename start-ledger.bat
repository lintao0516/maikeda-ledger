@echo off
chcp 65001 >nul
cd /d "C:\Users\Lenovo-baiyin\WorkBuddy\财务\ledger-server"
start "" "C:\Users\Lenovo-baiyin\.workbuddy\binaries\node\versions\22.22.2\node.exe" server.js
timeout /t 3 >nul
start "" "C:\Users\Lenovo-baiyin\WorkBuddy\财务\ledger-server\cloudflared.exe" tunnel --url http://localhost:3000 --no-autoupdate
timeout /t 10 >nul
findstr /C:"trycloudflare" tunnel.log > "C:\Users\Lenovo-baiyin\WorkBuddy\财务\ledger-server\current_url.txt"
