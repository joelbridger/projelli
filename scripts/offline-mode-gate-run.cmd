@echo off
set APPDATA=C:\offline-mode-gate\appdata\Roaming
set LOCALAPPDATA=C:\offline-mode-gate\appdata\Local
set HTTP_PROXY=http://127.0.0.1:18080
set HTTPS_PROXY=http://127.0.0.1:18080
set ALL_PROXY=http://127.0.0.1:18080
set NO_PROXY=127.0.0.1,localhost,::1
cd /d C:\keepance
npm run tauri:dev
