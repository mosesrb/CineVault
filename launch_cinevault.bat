@echo off
setlocal
title CineVault Launcher
cd /d "%~dp0"

echo ========================================
echo       CINEVAULT ONE-CLICK LAUNCH
echo ========================================
echo.

set /p tunnel="Start LocalTunnel for external access? (y/n): "

if /i "%tunnel%"=="y" (
    echo.
    echo [INFO] Starting LocalTunnel...
    echo [INFO] Your external URL will appear in the new window.
    start "LocalTunnel" cmd /k "npx -y localtunnel --port 3000"
)

echo.
set /p buildapk="Build and sync Android App? (y/n): "
if /i "%buildapk%"=="y" (
    echo.
    echo [INFO] Building Frontend and syncing with Capacitor...
    cd /d "%~dp0frontend"
    call npm run build
    call npx cap sync
    echo [INFO] Opening Android Studio...
    start cmd /c "npx cap open android"
    cd /d "%~dp0"
)

:: Auto-detect Local IP for easier setup on Android
set "MYIP=localhost"
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr "IPv4" ^| findstr "192.168."') do set "MYIP=%%a"
set "MYIP=%MYIP: =%"

echo.
echo [INFO] Starting CineVault Fullstack...
echo [INFO] Local:   http://localhost:3000
echo [INFO] Network: http://%MYIP%:3000  (Enter this in Android Profile)
echo [INFO] Web App: http://localhost:5180
echo.

cd /d "%~dp0"
call npm run fullstack

pause
