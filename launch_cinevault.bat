@echo off
setlocal
title CineVault Launcher

echo ========================================
echo       CINEVAULT ONE-CLICK LAUNCH
echo ========================================
echo.

set /p tunnel="Start Cloudflare Tunnel for external access? (y/n): "

if /i "%tunnel%"=="y" (
    echo.
    echo [INFO] Starting Cloudflare Tunnel...
    echo [INFO] Your external URL will appear in the new window.
    start "Cloudflare Tunnel" cmd /k "C:\cloudflared\cloudflared.exe tunnel --url http://localhost:3000"
)

:: Auto-detect Local IP for easier setup on Android
set "MYIP=localhost"
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr "IPv4" ^| findstr "192.168."') do set "MYIP=%%a"
set "MYIP=%MYIP: =%"

echo.
echo [INFO] Starting CineVault Fullstack...
echo [INFO] Local:   http://localhost:3000
echo [INFO] Network: http://%MYIP%:3000  (Enter this in Android Profile)
echo [INFO] Web App: http://localhost:5173
echo.

cd /d "e:\MachineApps\delatron"
npm run fullstack

pause
