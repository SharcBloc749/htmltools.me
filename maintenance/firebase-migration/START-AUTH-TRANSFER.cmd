@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Install Node.js 24 LTS from https://nodejs.org then run this file again.
  pause
  exit /b 1
)
node -e "const n=Number(process.versions.node.split('.')[0]); process.exit(n===22 || n===24 ? 0 : 1)"
if errorlevel 1 (
  echo Please install Node.js 24 LTS. This launcher supports Node 22 or 24.
  pause
  exit /b 1
)
if not exist "node_modules\firebase-admin\package.json" (
  echo Installing local Firebase Admin tools. This may take a few minutes.
  call npm ci --no-audit --no-fund
  if errorlevel 1 (
    echo Installation failed. Check the message above and your internet connection.
    pause
    exit /b 1
  )
)
echo Starting private local interface. Open the localhost URL printed below.
node auth-server.mjs
pause
