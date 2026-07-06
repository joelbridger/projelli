codex
Read-only investigation only. I did not change files, start VMs, or touch Azure.

**Bottom Line**
The strongest lead is not “the app update path is stale.” It is “the cloud bench is accidentally running WebView2 with a shared or wrong browser profile / browser process.” In plain terms: the test app may be looking in the wrong closet for its cached web page, so wiping the closet we thought it used did nothing.

For real users: I do **not** see evidence that a normal signed installer update can keep running old frontend code after update. The production path builds the frontend into the Tauri app and the updater installs a signed whole-app installer. There is one hardening concern: the app currently forwards `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` in production too, so a machine-level env var could force a weird WebView2 profile/cache path.

**Ranked Hypotheses**
1. **Wrong WebView2 user-data/cache folder is being used**
Most likely. The custom forwarding code appends whatever is in `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` into every WebView2 launch. If that env var, the scheduled task, or the image has `--user-data-dir` / `--disk-cache-dir`, then wiping `com.lantern.app\EBWebView` would not matter.

Run on the VM:
```powershell
Get-CimInstance Win32_Process |
  Where-Object { $_.Name -in 'lantern.exe','msedgewebview2.exe','node.exe' } |
  Select-Object Name,ProcessId,ParentProcessId,CreationDate,ExecutablePath,CommandLine |
  Format-List

'Process','User','Machine' | ForEach-Object {
  [pscustomobject]@{
    Scope = $_
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS =
      [Environment]::GetEnvironmentVariable('WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS', $_)
    WEBVIEW2_BROWSER_EXECUTABLE_FOLDER =
      [Environment]::GetEnvironmentVariable('WEBVIEW2_BROWSER_EXECUTABLE_FOLDER', $_)
  }
}
```

2. **A stale bench app/server starts automatically and CDP attaches to that**
Very plausible because both VMs share the same snapshot lineage and `LanternDevBench` auto-starts the app. The fresh build may exist, but the visible WebView2 page may belong to an older process.

Run:
```powershell
Get-ScheduledTask -TaskName LanternDevBench |
  Select-Object -ExpandProperty Actions | Format-List
Get-ScheduledTaskInfo -TaskName LanternDevBench | Format-List

Get-NetTCPConnection -LocalPort 5173,5273,9223 -ErrorAction SilentlyContinue |
  Select LocalAddress,LocalPort,State,OwningProcess |
  Sort LocalPort,LocalAddress

Get-CimInstance Win32_Process |
  Where-Object { $_.ProcessId -in (Get-NetTCPConnection -LocalPort 5173,5273,9223 -EA SilentlyContinue).OwningProcess } |
  Select Name,ProcessId,CreationDate,ExecutablePath,CommandLine |
  Format-List
```

3. **IPv4 vs IPv6 loopback split**
Still possible. Curl may hit `[::1]`, while WebView2 may hit `127.0.0.1` or normalize `localhost` differently. That would make “same port” not actually mean “same server.”

Run:
```powershell
$urls = @(
  'http://127.0.0.1:5173/',
  'http://localhost:5173/',
  'http://[::1]:5173/'
)
foreach ($u in $urls) {
  $r = Invoke-WebRequest $u -UseBasicParsing
  [pscustomobject]@{
    Url = $u
    Length = $r.Content.Length
    HasDevClient = $r.Content.Contains('/@vite/client')
    HasProdAssets = $r.Content.Contains('/assets/')
  }
}
```

Then compare inside WebView2:
```bash
node scripts/desktop-drive.mjs eval "Promise.all(['http://127.0.0.1:5173/','http://localhost:5173/','http://[::1]:5173/'].map(async u => { const t = await fetch(u,{cache:'no-store'}).then(r=>r.text()); return {u, len:t.length, dev:t.includes('/@vite/client'), prod:t.includes('/assets/')}; }))"
```

4. **Fixed WebView2 runtime or runtime policy pinned in the image**
Possible, but less likely. A bad runtime normally should not cache one app’s old HTTP response across profile wipes, but both VMs sharing an image makes this worth checking.

Run:
```powershell
Get-CimInstance Win32_Process -Filter "name='msedgewebview2.exe'" |
  Select ProcessId,ExecutablePath,CommandLine | Format-List

Get-ChildItem 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients',
              'HKCU:\SOFTWARE\Microsoft\EdgeUpdate\Clients' -Recurse -EA SilentlyContinue |
  Get-ItemProperty |
  Select PSChildName,name,pv,location | Format-Table -Auto

reg query "HKLM\SOFTWARE\Policies\Microsoft\Edge\WebView2" /s
reg query "HKCU\SOFTWARE\Policies\Microsoft\Edge\WebView2" /s
```

5. **Cache files outside the wiped profile**
Less likely than #1, but the marker search is cheap and concrete.

Run:
```powershell
$roots = @(
  "$env:LOCALAPPDATA\com.lantern.app",
  "$env:APPDATA\com.lantern.app",
  "$env:LOCALAPPDATA\Microsoft\EdgeWebView",
  "$env:LOCALAPPDATA\Temp",
  "$env:ProgramData"
)
Get-ChildItem $roots -Recurse -File -EA SilentlyContinue |
  Select-String -SimpleMatch '1783358744','Beacon Ridge Demo','/@vite/client','scheduleFolderMatterRetag' -List |
  Select Path,LineNumber,Line
```

**Production Audit**
Production build config looks correct:

- [src-tauri/tauri.conf.json](/home/jameson/lantern-plus/src-tauri/tauri.conf.json:6) sets `frontendDist: "../dist"` for packaged builds, and `devUrl: "http://localhost:5173"` only for dev.
- [package.json](/home/jameson/lantern-plus/package.json:15) builds with `tsc -b && vite build`.
- [src-tauri/tauri.conf.json](/home/jameson/lantern-plus/src-tauri/tauri.conf.json:37) has bundling active, and [line 88](/home/jameson/lantern-plus/src-tauri/tauri.conf.json:88) creates updater artifacts.
- [src-tauri/src/lib.rs](/home/jameson/lantern-plus/src-tauri/src/lib.rs:430) registers the updater plugin.
- [src/platform/updater/updaterStore.ts](/home/jameson/lantern-plus/src/platform/updater/updaterStore.ts:107) calls Tauri’s updater `check()`, [line 148](/home/jameson/lantern-plus/src/platform/updater/updaterStore.ts:148) downloads and installs, and [line 182](/home/jameson/lantern-plus/src/platform/updater/updaterStore.ts:182) relaunches.
- Windows release uses real `npm run tauri build`, not debug/no-bundle: [.github/workflows/release.yml](/home/jameson/lantern-plus/.github/workflows/release.yml:548).
- The Windows installer is Azure-signed at [.github/workflows/release.yml](/home/jameson/lantern-plus/.github/workflows/release.yml:609), then the updater signature is regenerated over the final signed installer at [line 645](/home/jameson/lantern-plus/.github/workflows/release.yml:645), then `latest.json` gets the Windows URL/signature at [line 747](/home/jameson/lantern-plus/.github/workflows/release.yml:747).

**Precise Risk Call**
A normal real-user update should not execute stale frontend code after update. The update is a signed installer replacing the app package, not a loose web cache update.

But I would harden this before trusting the cloud benches again: restrict `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` forwarding to bench/dev use, or at least reject `--user-data-dir`, `--disk-cache-dir`, and `--browser-subprocess-path`. The risky code path is [src-tauri/src/webview_env.rs](/home/jameson/lantern-plus/src-tauri/src/webview_env.rs:60) plus [src-tauri/src/lib.rs](/home/jameson/lantern-plus/src-tauri/src/lib.rs:379).
tokens used
200,340
Read-only investigation only. I did not change files, start VMs, or touch Azure.

**Bottom Line**
The strongest lead is not “the app update path is stale.” It is “the cloud bench is accidentally running WebView2 with a shared or wrong browser profile / browser process.” In plain terms: the test app may be looking in the wrong closet for its cached web page, so wiping the closet we thought it used did nothing.

For real users: I do **not** see evidence that a normal signed installer update can keep running old frontend code after update. The production path builds the frontend into the Tauri app and the updater installs a signed whole-app installer. There is one hardening concern: the app currently forwards `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` in production too, so a machine-level env var could force a weird WebView2 profile/cache path.

**Ranked Hypotheses**
1. **Wrong WebView2 user-data/cache folder is being used**
Most likely. The custom forwarding code appends whatever is in `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` into every WebView2 launch. If that env var, the scheduled task, or the image has `--user-data-dir` / `--disk-cache-dir`, then wiping `com.lantern.app\EBWebView` would not matter.

Run on the VM:
```powershell
Get-CimInstance Win32_Process |
  Where-Object { $_.Name -in 'lantern.exe','msedgewebview2.exe','node.exe' } |
  Select-Object Name,ProcessId,ParentProcessId,CreationDate,ExecutablePath,CommandLine |
  Format-List

'Process','User','Machine' | ForEach-Object {
  [pscustomobject]@{
    Scope = $_
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS =
      [Environment]::GetEnvironmentVariable('WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS', $_)
    WEBVIEW2_BROWSER_EXECUTABLE_FOLDER =
      [Environment]::GetEnvironmentVariable('WEBVIEW2_BROWSER_EXECUTABLE_FOLDER', $_)
  }
}
```

2. **A stale bench app/server starts automatically and CDP attaches to that**
Very plausible because both VMs share the same snapshot lineage and `LanternDevBench` auto-starts the app. The fresh build may exist, but the visible WebView2 page may belong to an older process.

Run:
```powershell
Get-ScheduledTask -TaskName LanternDevBench |
  Select-Object -ExpandProperty Actions | Format-List
Get-ScheduledTaskInfo -TaskName LanternDevBench | Format-List

Get-NetTCPConnection -LocalPort 5173,5273,9223 -ErrorAction SilentlyContinue |
  Select LocalAddress,LocalPort,State,OwningProcess |
  Sort LocalPort,LocalAddress

Get-CimInstance Win32_Process |
  Where-Object { $_.ProcessId -in (Get-NetTCPConnection -LocalPort 5173,5273,9223 -EA SilentlyContinue).OwningProcess } |
  Select Name,ProcessId,CreationDate,ExecutablePath,CommandLine |
  Format-List
```

3. **IPv4 vs IPv6 loopback split**
Still possible. Curl may hit `[::1]`, while WebView2 may hit `127.0.0.1` or normalize `localhost` differently. That would make “same port” not actually mean “same server.”

Run:
```powershell
$urls = @(
  'http://127.0.0.1:5173/',
  'http://localhost:5173/',
  'http://[::1]:5173/'
)
foreach ($u in $urls) {
  $r = Invoke-WebRequest $u -UseBasicParsing
  [pscustomobject]@{
    Url = $u
    Length = $r.Content.Length
    HasDevClient = $r.Content.Contains('/@vite/client')
    HasProdAssets = $r.Content.Contains('/assets/')
  }
}
```

Then compare inside WebView2:
```bash
node scripts/desktop-drive.mjs eval "Promise.all(['http://127.0.0.1:5173/','http://localhost:5173/','http://[::1]:5173/'].map(async u => { const t = await fetch(u,{cache:'no-store'}).then(r=>r.text()); return {u, len:t.length, dev:t.includes('/@vite/client'), prod:t.includes('/assets/')}; }))"
```

4. **Fixed WebView2 runtime or runtime policy pinned in the image**
Possible, but less likely. A bad runtime normally should not cache one app’s old HTTP response across profile wipes, but both VMs sharing an image makes this worth checking.

Run:
```powershell
Get-CimInstance Win32_Process -Filter "name='msedgewebview2.exe'" |
  Select ProcessId,ExecutablePath,CommandLine | Format-List

Get-ChildItem 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients',
              'HKCU:\SOFTWARE\Microsoft\EdgeUpdate\Clients' -Recurse -EA SilentlyContinue |
  Get-ItemProperty |
  Select PSChildName,name,pv,location | Format-Table -Auto

reg query "HKLM\SOFTWARE\Policies\Microsoft\Edge\WebView2" /s
reg query "HKCU\SOFTWARE\Policies\Microsoft\Edge\WebView2" /s
```

5. **Cache files outside the wiped profile**
Less likely than #1, but the marker search is cheap and concrete.

Run:
```powershell
$roots = @(
  "$env:LOCALAPPDATA\com.lantern.app",
  "$env:APPDATA\com.lantern.app",
  "$env:LOCALAPPDATA\Microsoft\EdgeWebView",
  "$env:LOCALAPPDATA\Temp",
  "$env:ProgramData"
)
Get-ChildItem $roots -Recurse -File -EA SilentlyContinue |
  Select-String -SimpleMatch '1783358744','Beacon Ridge Demo','/@vite/client','scheduleFolderMatterRetag' -List |
  Select Path,LineNumber,Line
```

**Production Audit**
Production build config looks correct:

- [src-tauri/tauri.conf.json](/home/jameson/lantern-plus/src-tauri/tauri.conf.json:6) sets `frontendDist: "../dist"` for packaged builds, and `devUrl: "http://localhost:5173"` only for dev.
- [package.json](/home/jameson/lantern-plus/package.json:15) builds with `tsc -b && vite build`.
- [src-tauri/tauri.conf.json](/home/jameson/lantern-plus/src-tauri/tauri.conf.json:37) has bundling active, and [line 88](/home/jameson/lantern-plus/src-tauri/tauri.conf.json:88) creates updater artifacts.
- [src-tauri/src/lib.rs](/home/jameson/lantern-plus/src-tauri/src/lib.rs:430) registers the updater plugin.
- [src/platform/updater/updaterStore.ts](/home/jameson/lantern-plus/src/platform/updater/updaterStore.ts:107) calls Tauri’s updater `check()`, [line 148](/home/jameson/lantern-plus/src/platform/updater/updaterStore.ts:148) downloads and installs, and [line 182](/home/jameson/lantern-plus/src/platform/updater/updaterStore.ts:182) relaunches.
- Windows release uses real `npm run tauri build`, not debug/no-bundle: [.github/workflows/release.yml](/home/jameson/lantern-plus/.github/workflows/release.yml:548).
- The Windows installer is Azure-signed at [.github/workflows/release.yml](/home/jameson/lantern-plus/.github/workflows/release.yml:609), then the updater signature is regenerated over the final signed installer at [line 645](/home/jameson/lantern-plus/.github/workflows/release.yml:645), then `latest.json` gets the Windows URL/signature at [line 747](/home/jameson/lantern-plus/.github/workflows/release.yml:747).

**Precise Risk Call**
A normal real-user update should not execute stale frontend code after update. The update is a signed installer replacing the app package, not a loose web cache update.

But I would harden this before trusting the cloud benches again: restrict `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` forwarding to bench/dev use, or at least reject `--user-data-dir`, `--disk-cache-dir`, and `--browser-subprocess-path`. The risky code path is [src-tauri/src/webview_env.rs](/home/jameson/lantern-plus/src-tauri/src/webview_env.rs:60) plus [src-tauri/src/lib.rs](/home/jameson/lantern-plus/src-tauri/src/lib.rs:379).
