@echo off
title CoverSwap - Audio Cover Art Replacer
cd /d "%~dp0"

echo =============================================
echo   CoverSwap — Audio Cover Art Replacer
echo =============================================
echo.
echo Starting server and opening browser at http://localhost:3000...
echo Press Ctrl+C in this window to stop the server.
echo.

:: Wait 1 second in background then open browser
start "" cmd /c "timeout /t 1 /nobreak >nul & start http://localhost:3000"

:: Start the Node.js server
node server.js

pause
