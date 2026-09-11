@echo off
title GreenCube Backend (auto-restart)
cd /d "%~dp0"

echo ============================================
echo   GreenCube Backend
echo   http://localhost:3001/api/v1
echo ============================================
echo.

echo [1/3] Freeing port 3001...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3001 " ^| findstr "LISTENING"') do (
  echo       stopping old process PID %%a
  taskkill /PID %%a /F >nul 2>&1
)
timeout /t 1 /nobreak >nul

echo [2/3] Building backend...
call npm run build
if errorlevel 1 (
  echo.
  echo [ERROR] Build failed. Please check the messages above.
  pause
  exit /b 1
)
echo       Build OK.

echo [3/3] Starting backend (auto-restart enabled)
echo.

:loop
echo --------------------------------------------
echo   [%date% %time%] Backend starting...
echo --------------------------------------------
node dist\main.js
echo.
echo [%time%] Backend process exited.
echo Auto-restart in 3 seconds... (close this window to stop)
timeout /t 3 /nobreak >nul
goto loop
