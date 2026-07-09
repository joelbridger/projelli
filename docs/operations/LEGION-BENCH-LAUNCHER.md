# Legion Bench Launcher

**Current as of 2026-07-09.** This explains how the Legion starts the dev app and how to refresh code on it.

## What runs the app

The dev app is launched by a Windows scheduled task:

```powershell
KeepanceDev
```

That task runs:

```powershell
C:\run-dev.bat
```

The app source on the Legion is:

```text
C:\keepance
```

Important: `C:\keepance` is a synced folder, not a git repo. Do not use `git pull` there.

## What the launcher does

`C:\run-dev.bat` is the robust launcher. It:

1. Changes to `C:\keepance`.
2. Kills leftover app, Node, WebView2, and sidecar processes.
3. Sets the WebView2 debug env var, even though CDP is currently not usable on this bench.
4. Puts Rust and build tools on `PATH`.
5. Writes a fresh log under `C:\dev-logs\dev-*.log`.
6. Runs `npm run tauri:dev`.

The important kill list includes the local sidecars:

- `llama-server-x86_64-pc-windows-msvc`
- `piper`
- `whisper-cli`

## The big gotcha

The recurring "app won't restart" problem was an orphaned `llama-server` sidecar holding the app data folder open.

That means a normal app kill was not enough. The launcher must kill sidecars too. If restarts begin failing again, check for leftover sidecars first.

## Restart the app

Use the scheduled task. Do not launch the GUI app directly over SSH.

```bash
ssh james@100.127.67.22 "Stop-ScheduledTask -TaskName KeepanceDev; Start-ScheduledTask -TaskName KeepanceDev"
```

If `src-tauri` changed, expect a Rust rebuild. A warm rebuild is usually about 5 minutes.

Check the newest log:

```bash
ssh james@100.127.67.22 "Get-ChildItem C:\dev-logs -Filter 'dev-*.log' | Sort-Object LastWriteTime -Descending | Select-Object -First 1 | Get-Content -Tail 80"
```

Check the app bridge:

```bash
ssh james@100.127.67.22 "(Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:9250/health').Content"
```

## Deploy code from the server

Use a tarball from the server. Keep the Legion's Windows sidecar binaries in place.

From this worktree or the current source worktree:

```bash
tar czf /tmp/legion-deploy.tgz \
  --exclude='src-tauri/target' \
  --exclude='src-tauri/gen' \
  --exclude='src-tauri/binaries' \
  src src-tauri
scp /tmp/legion-deploy.tgz james@100.127.67.22:C:/deploy.tgz
```

Extract on the Legion:

```bash
ssh james@100.127.67.22 "cd C:\keepance; tar -xzf C:\deploy.tgz; Remove-Item C:\deploy.tgz"
```

PowerShell note: use `;`, not `&&`.

Then restart:

```bash
ssh james@100.127.67.22 "Stop-ScheduledTask -TaskName KeepanceDev; Start-ScheduledTask -TaskName KeepanceDev"
```

## Preserve these folders

Do not overwrite or delete this folder during sync:

```text
C:\keepance\src-tauri\binaries
```

It holds the Legion's Windows sidecars. A server tarball usually does not contain the right Windows binaries.

Also avoid copying build output:

- `src-tauri/target`
- `src-tauri/gen`
- `node_modules`
- `dist`

## Quick health checklist

```bash
ssh james@100.127.67.22 "Get-ScheduledTask -TaskName KeepanceDev,LegionAgent | Select-Object TaskName,State"
ssh james@100.127.67.22 "(Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:9250/health').Content"
ssh james@100.127.67.22 "(Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:8765/health').Content"
```

Expected:

- `KeepanceDev` is running.
- `LegionAgent` is running.
- The app bridge returns JSON.
- The screen agent returns `ok`.
