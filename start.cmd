@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Install Node.js 22.13 or newer first.
  pause
  exit /b 1
)
if not exist node_modules call npm ci --omit=dev
if errorlevel 1 exit /b 1
node app/main.js
pause
