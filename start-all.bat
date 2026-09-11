@echo off
cd /d "%~dp0"

echo ==================================================
echo    GreenCube Dev - Start All Services
echo ==================================================
echo.
echo    [1/2] Backend     http://localhost:3001
echo    [2/2] Admin Web   http://localhost:5190
echo.
echo    Two new windows will open.
echo    KEEP THEM OPEN while you are debugging.
echo.

start "GC-Backend" cmd /k "%~dp0backend\run-backend.bat"
timeout /t 2 /nobreak >nul
start "GC-AdminWeb" cmd /k "cd /d %~dp0admin-web && npm run dev"

echo    Launched. This window can be closed.
timeout /t 5 /nobreak >nul
