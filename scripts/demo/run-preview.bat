@echo off
cd /d C:\keepance
set PATH=%USERPROFILE%\.cargo\bin;C:\Strawberry\perl\bin;C:\Strawberry\c\bin;%PATH%
start "vite-preview" cmd /c "npx vite preview --port 5173 --strictPort > C:\vite-preview.log 2>&1"
rem Wait ~8s for vite. Use ping, NOT `timeout`: timeout reads the console and
rem fails ("Input redirection is not supported") when this runs from a Scheduled
rem Task (no interactive stdin), which aborted the script before launching the app.
ping -n 9 127.0.0.1 > nul
rem Launch the app DETACHED via `start`, NOT as a redirected child of this cmd.
rem A direct `keepance.exe > log` from the Scheduled Task's cmd.exe never brought
rem up the WebView2 remote-debug port (CDP 9223) — the GUI/webview did not
rem initialize in that redirected, non-interactive context. `start` runs it as its
rem own interactive process (like a normal launch), and CDP comes up reliably.
rem Trade-off: no stdout log file; rely on CDP + the robot's console capture.
start "keepance-app" "C:\keepance\src-tauri\target\debug\keepance.exe"
