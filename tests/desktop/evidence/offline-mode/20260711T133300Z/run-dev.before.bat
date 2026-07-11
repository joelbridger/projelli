@echo off
rem run-dev.bat - robust demo launcher for the Legion bench (detached via KeepanceDev task).
rem Fixes the recurring "won't relaunch" failures: clears leftovers so ports/handles are free,
rem and writes to a FRESH unique log every run so a locked log can never block startup.
cd /d C:\keepance
rem Kill the app, its dev toolchain, AND its sidecars (llama-server/piper/whisper) -
rem an orphaned sidecar holds the data folder open and is what jams a clean restart.
powershell -NoProfile -Command "Get-Process lantern,node,msedgewebview2,'llama-server-x86_64-pc-windows-msvc',piper,'whisper-cli' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue"
timeout /t 4 /nobreak >nul
set WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9223
set PATH=%USERPROFILE%\.cargo\bin;C:\Strawberry\perl\bin;C:\Strawberry\c\bin;%PATH%
if not exist C:\dev-logs mkdir C:\dev-logs
set LOG=C:\dev-logs\dev-%RANDOM%%RANDOM%.log
echo [run-dev] launching tauri:dev, log=%LOG%
call npm run tauri:dev > "%LOG%" 2>&1
