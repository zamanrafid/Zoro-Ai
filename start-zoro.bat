@echo off
REM ZORO AI — double-click korlei cholbe. Prothombar setup 2-4 min lagte pare.
cd /d "%~dp0"
where node >nul 2>&1
if errorlevel 1 (
  echo [ZORO AI] Node.js 20+ age install korun: https://nodejs.org
  pause
  exit /b 1
)
if not exist node_modules (
  echo [ZORO AI] Prothombar setup hocche, ektu wait korun...
  call npm install --no-audit --no-fund
)
if not exist .env.local copy .env.example .env.local >nul
echo [ZORO AI] Browser-e khulche: http://localhost:3000
start "" http://localhost:3000
call npm run dev
pause
