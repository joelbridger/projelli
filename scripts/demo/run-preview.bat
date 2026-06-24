@echo off
cd /d C:\keepance
set PATH=%USERPROFILE%\.cargo\bin;C:\Strawberry\perl\bin;C:\Strawberry\c\bin;%PATH%
start "vite-preview" cmd /c "npx vite preview --port 5173 --strictPort > C:\vite-preview.log 2>&1"
timeout /t 8 /nobreak > nul
C:\keepance\src-tauri\target\debug\keepance.exe > C:\keepance-app.log 2>&1
