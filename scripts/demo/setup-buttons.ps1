$ErrorActionPreference = 'Stop'
$dir = 'C:\demo-buttons'
New-Item -ItemType Directory -Force $dir | Out-Null

# --- Loaded Demo .bat ---
@'
@echo off
title Keepance Demo - LOADED (clean)
cd /d C:\keepance
set DESKTOP_CDP_PORT=9223
echo.
echo   Resetting to the LOADED demo...
echo   (Northcrest firm, 26 instant client maps, Brennan ready to build live,
echo    Sarah's email inbox connected. Takes about 15 seconds.)
echo.
node scripts\demo\reset-loaded.mjs
echo.
echo   ============================================================
echo    DONE. The LOADED demo is clean and ready. Close this window.
echo   ============================================================
timeout /t 6 >nul
'@ | Set-Content -Encoding ASCII (Join-Path $dir 'Loaded Demo.bat')

# --- Blank Demo .bat ---
@'
@echo off
title Keepance Demo - BLANK (first run)
cd /d C:\keepance
set DESKTOP_CDP_PORT=9223
echo.
echo   Resetting to a BLANK first-run state (empty app, onboarding wizard)...
echo.
node scripts\demo\reset-blank.mjs
echo.
echo   ============================================================
echo    DONE. The app is at first-run. To build it up live, open
echo    the folder:  C:\keepance-demo-blank  (the Brennan client).
echo   ============================================================
timeout /t 8 >nul
'@ | Set-Content -Encoding ASCII (Join-Path $dir 'Blank Demo.bat')

# --- Restart App .bat ---
@'
@echo off
title Keepance Demo - RESTART APP
echo.
echo   Restarting the Keepance app (use this if it freezes or closes)...
echo.
powershell -NoProfile -Command "Stop-Process -Name keepance,node,msedgewebview2 -Force -ErrorAction SilentlyContinue; Start-Sleep -Seconds 5; Start-ScheduledTask -TaskName KeepanceDev"
echo.
echo   ============================================================
echo    App is restarting. Wait ~30 seconds, then click "Loaded Demo"
echo    (or "Blank Demo") to load the workspace.
echo   ============================================================
timeout /t 10 >nul
'@ | Set-Content -Encoding ASCII (Join-Path $dir 'Restart App.bat')

# --- Desktop shortcuts ---
$desktop = [Environment]::GetFolderPath('Desktop')
$ws = New-Object -ComObject WScript.Shell
function Make-Link($name, $bat) {
  $lnk = $ws.CreateShortcut((Join-Path $desktop ($name + '.lnk')))
  $lnk.TargetPath = 'cmd.exe'
  $lnk.Arguments = '/c "' + (Join-Path $dir $bat) + '"'
  $lnk.WorkingDirectory = 'C:\keepance'
  $lnk.IconLocation = 'imageres.dll,76'
  $lnk.Description = 'Keepance demo control'
  $lnk.Save()
}
Make-Link 'Keepance - 1 Loaded Demo' 'Loaded Demo.bat'
Make-Link 'Keepance - 2 Blank Demo'  'Blank Demo.bat'
Make-Link 'Keepance - 3 Restart App' 'Restart App.bat'

'Created:'
Get-ChildItem $dir | Select-Object Name | Format-Table -Auto | Out-String
'Desktop shortcuts:'
Get-ChildItem $desktop -Filter 'Keepance - *.lnk' | Select-Object Name | Format-Table -Auto | Out-String
