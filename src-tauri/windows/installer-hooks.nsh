; Projelli NSIS Installer Hooks
; Customizes the MUI2 wizard appearance without replacing the full template.
; Hooked into Tauri's default installer.nsi via tauri.conf.json > nsis.installerHooks
;
; Using hooks (not a full custom template) because:
;   1. Tauri's bundler injects ~400 lines of critical logic (registry, uninstaller,
;      WebView2 bootstrapping) that a custom template must replicate exactly.
;   2. Hooks add to the default template — they don't replace it — so Tauri
;      version upgrades won't silently break the installer.
;   3. MUI2 with branded images already looks dramatically better than generic.

; --- NSIS_HOOK_POSTINSTALL ---
; Runs after all files are installed, registry keys set, shortcuts created.
; We use this to ensure the desktop shortcut is created (MUI2 doesn't always do this
; in per-user install mode).
!macro NSIS_HOOK_POSTINSTALL
  ; Create desktop shortcut if it doesn't already exist
  SetShellVarContext current
  IfFileExists "$DESKTOP\Projelli.lnk" +2 0
    CreateShortcut "$DESKTOP\Projelli.lnk" "$INSTDIR\Projelli.exe" "" "$INSTDIR\Projelli.exe" 0
!macroend

; --- NSIS_HOOK_POSTUNINSTALL ---
; Clean up the desktop shortcut on uninstall
!macro NSIS_HOOK_POSTUNINSTALL
  SetShellVarContext current
  Delete "$DESKTOP\Projelli.lnk"
!macroend
