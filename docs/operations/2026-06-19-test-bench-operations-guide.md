# Advisor Prep Hero AI Test-Bench — Operations Guide

_2026-06-19. **Authoritative manual for using the always-on, AI-driven Windows + macOS test benches.** Read this first for any test-bench work._
_Companions: `2026-06-19-ai-dev-velocity-strategy.md` (the WHY / strategy) · `2026-06-19-test-bench-setup-plan.md` (the original setup runbook) · `docs/quality/2026-06-19-linux-vs-windows-coverage.md` (what only real Windows/Mac can test)._
_Memory: `~/.claude/projects/-home-jameson/memory/project_keepance_dev_velocity.md`._

> **Audience note (for AI sessions):** Jameson is NOT a developer. Report bench results to him in plain language. This guide is the technical reference; translate it for him.

---

## 1. Why these benches exist (the problem they solve)

Advisor Prep Hero ships signed installers for Windows / macOS (arm+intel) / Linux. Cutting that signed cross-platform build takes **60–90 minutes** and is the explicit-go, commercial-ship step. It was being used as a *testing* loop — wait 60–90 min just to see if a Windows fix worked.

The fix is the **two-speed model + a real-OS test bench in the middle:**

1. **Fast loop (seconds–min):** logic + UI, on the Linux server. No signing. ~90% of work.
2. **Test bench (minutes):** real Windows + real Mac machines where an AI builds an **unsigned debug** app and runs/tests it — the genuinely-OS-specific things — WITHOUT a signed build.
3. **Release loop (60–90 min signed build):** only when actually shipping.

**Proven result (2026-06-19):** a Windows fix that needed a 60–90 min signed build to test now rebuilds in **~67 seconds** on the bench. See §7 for the build-time table.

---

## 2. The benches (inventory + access)

Everything runs over **Tailscale** (a private encrypted tunnel between the machines). **Nothing is exposed to the public internet.** The Linux server (`jameworld`, Tailscale `100.68.20.52`) drives both.

### Windows bench — "the Legion"
- **Hardware:** Lenovo Legion 5i Pro, Windows 11. Jameson's, treated as **disposable** (wipe-and-rebuild = the safe reset).
- **Tailscale device:** `laptop` → `100.127.67.22`. **User:** `james` (admin).
- **Access:** native **Windows OpenSSH Server** (Tailscale SSH can't run a *server* on Windows), key auth, auto-starts at boot. SSH is firewall-locked to the Tailscale range only: `Set-NetFirewallRule -Name OpenSSH-Server-In-TCP -RemoteAddress 100.64.0.0/10`.
- **Code:** `C:\keepance` (a synced copy — NOT a git checkout; see §4.1). Read-only GitHub deploy key at `C:\Users\james\.ssh\keepance_deploy` (registered on `keepance/keepance`, read-only).
- **Remote shell:** PowerShell (set as the OpenSSH default shell).
- **Connect:** `ssh -o BatchMode=yes james@100.127.67.22 '<powershell>'`

### macOS bench — the M1
- **Hardware:** Apple M1 MacBook (Allison's), **8GB RAM, ~9GB free disk after a build (TIGHT — watch it)**, macOS 26.2 arm64.
- **Tailscale device:** `allisons-macbook-pro` → `100.113.42.26`.
- **Account:** `keepancebench` — a **Standard (non-admin)** account created for this. macOS walls off the other users' files from it by default, so **the wife's personal files stay private** without a VM. (An 8GB/9GB-free machine is too small for a VM anyway.)
- **Access:** built-in **Remote Login** (SSH), key auth. Remote Login must be set to **"Allow access for: All users"** (default "only these users" excludes a standard account → "Connection closed by port 22").
- **Code:** `~/keepance` (synced copy). **Toolchain is user-local** (no admin): `~/.cargo/bin` (rustup), `~/node/bin` (Node 24), `~/protoc/bin` (protoc 35). Xcode Command Line Tools installed once by Jameson (the one admin step).
- **Remote shell:** zsh. **PATH is NOT auto-set for `ssh host cmd`** (zsh non-interactive only reads `~/.zshenv`) — so prepend it every command:
  `export PATH="$HOME/.cargo/bin:$HOME/node/bin:$HOME/protoc/bin:$PATH"`
- **Connect:** `ssh -o BatchMode=yes keepancebench@100.113.42.26 '<zsh>'`

### Security model (keep it this way)
- **Private tunnel only.** ACL-restricted; never expose SSH/RDP/VNC to the internet.
- **No real client data on the benches.** Synthetic fixtures only.
- **No disk encryption** (Jameson's call, for speed) — acceptable *because* boxes are disposable + tunnel-locked + carry no real data. Revisit if that changes.
- **Disposable.** Worst case = wipe and rebuild. The deploy key is read-only and revocable; the server's access key can be rotated.

---

## 3. The development model (which loop to use)

| Task | Where | Cost |
|---|---|---|
| Logic / unit / most UI | Linux server (`npm test`, vitest, the L1/L2 suites) | seconds–min |
| "Does it build/run/look right on Windows or Mac" | the bench (`cargo build`, run the app, screenshot) | ~1 min incremental |
| Genuinely OS-specific (keychain, folder picker, installer, WebView2 render, Word interop) | the bench, **in an interactive session** for GUI/keychain (§5) | minutes |
| Ship a signed release | the 60–90 min CI signed build | only on Jameson's explicit go (commercial boundary) |

**Rule:** never cut the signed build just to test. Use the bench. The signed build is for shipping.

---

## 4. How to USE the benches (the working playbook)

### 4.1 Sync code to a bench
The benches hold a **copy** of the source, not a git checkout. Two ways:
- **Tarball-over-tunnel (used for the initial seed + reliable on both OSes):**
  ```bash
  tar czf /tmp/keepance-src.tgz -C /home/jameson/lantern \
    --exclude=node_modules --exclude=target --exclude=.git --exclude=dist \
    --exclude=dist-web-demo --exclude=dist-node --exclude=playwright-report --exclude=test-results .
  scp /tmp/keepance-src.tgz <bench>:keepance-src.tgz
  # then on the bench: extract into the keepance dir, delete the tarball
  ```
  This was the FALLBACK after the Windows box couldn't reliably `git clone` from GitHub. It is fast over the LAN tunnel and is the reliable seed path. (~771MB today because the repo carries large assets.)
- **Incremental (day-to-day):** only `scp` the changed files into the bench's tree (kilobytes, near-instant). Do NOT re-send the whole tarball each time.

### 4.2 Build (unsigned debug)
Per OS, with the toolchain PATH set:
- **Windows:** `ssh james@100.127.67.22 'Set-Location C:\keepance\src-tauri; $env:Path="$env:USERPROFILE\.cargo\bin;C:\Strawberry\perl\bin;C:\Strawberry\c\bin;"+$env:Path; cargo build'`
- **macOS:** `ssh keepancebench@100.113.42.26 'cd ~/keepance/src-tauri; export PATH="$HOME/.cargo/bin:$HOME/node/bin:$HOME/protoc/bin:$PATH"; cargo build'`
- Frontend first when needed: `npm ci` then `npm run build` (creates `../dist`). A full app run uses `npm run tauri:dev` (Vite + the app).
- **Always run a real build/long job as a non-killed background job** (see §5) and TIME it into `~/keepance-bench-buildtimes.csv`.

### 4.3 Run the app + screenshot it (GUI — needs an interactive desktop)
A GUI app launched directly over SSH runs in a **non-interactive window station** and is invisible. To put it on the real screen and capture it, run via an **interactive scheduled task** (Windows) / the logged-in Aqua session (Mac):
- **Windows (proven):** a Scheduled Task `Advisor Prep HeroDev` (principal `james`, **LogonType Interactive**, RunLevel Highest) runs `C:\run-dev.bat` (= `npm run tauri:dev`). A second interactive task `BenchShot` runs `bench-shot.ps1`, which **brings the Advisor Prep Hero window to the front** (`user32!SetForegroundWindow` + `ShowWindow(…,3)` on the keepance process's MainWindowHandle) then captures the virtual screen to `~\shot.png`. `scp` it back and view. (The first capture caught the build terminals on top — focus the window first.)
- The interactive session must be **unlocked + auto-logged-in** for capture to work.

### 4.4 Run tests
- **Most tests** run fine over SSH: `cargo test` (Rust), and the JS suites.
- **EXCEPTION — the OS keychain:** see §5; keychain tests can't run over SSH.

### 4.5 Track build times (do this every build)
Append to `~/keepance-bench-buildtimes.csv` (`timestamp_utc,machine,phase,seconds,exit,note`). This is the evidence of the efficiency gain — keep it growing.

---

## 5. Best practices & hard-won gotchas (READ before driving a bench)

These were learned the expensive way this session. Future AI: heed them to avoid repeating the mistakes.

1. **NEVER wrap a long remote command in a short `timeout`.** Killing the local SSH client **orphans the remote process** (it keeps running on the bench) and orphans pile up and jam every retry. Symptom: new commands hang, `ssh` shows the box busy. Instead: run long jobs with the Bash tool's `run_in_background: true` (no timer) — it finishes on its own and notifies you. To catch a true *hang*, arm a `Monitor` that polls a progress signal and emits done/stalled/hung.
2. **Tell "slow" from "hung" by a progress signal, never by elapsed time.** A Windows `git`/file op is slow because **Defender scans every file**. Add exclusions: `Add-MpPreference -ExclusionPath C:\keepance` (and `~/.cargo`, the target dir). A slow-but-working job killed early = the orphan problem above.
3. **Clean up before launching:** kill stale same-name procs (`Get-Process git,ssh,cargo,node | Stop-Process -Force`) and `cmd /c rmdir /s /q <dir>` any partial dir, so orphans can't accumulate.
4. **Fragile clipboards mangle multi-line pastes into literal `\n`.** When giving Jameson something to paste into a Mac/Windows terminal, give **ONE single line with no line breaks and no quotes.** Encode any value with spaces/quotes as **base64** and `echo <b64> | base64 -D` (macOS uses `-D`, Linux `-d`). This dodges both newline-mangling and smart-quote conversion.
5. **Windows `ssh-keygen -N ""` over bash→PowerShell gives the key a stray passphrase** (quoting). **Generate SSH/deploy keys on the Linux server** (`ssh-keygen -N ''` is reliable there), register the pubkey via `gh api repos/keepance/keepance/keys -F read_only=true`, and base64-transfer the private key to the box. For git on Windows use the **Windows OpenSSH** binary explicitly + `IdentitiesOnly=yes`: `GIT_SSH_COMMAND="C:/Windows/System32/OpenSSH/ssh.exe -i <key> -o IdentitiesOnly=yes"`.
6. **Windows can't be a Tailscale SSH *server*** → use native Windows OpenSSH Server.
7. **GUI apps + screenshots need an INTERACTIVE, unlocked, auto-logged-in desktop session.** Launch them via interactive scheduled tasks, not raw SSH (which uses a hidden window station). Bring the target window to the foreground before capturing.
8. **The OS keychain cannot be tested over SSH.** On Windows, Credential Manager returns `ERROR_NO_SUCH_LOGON_SESSION` (1312) over SSH/headless — there's no interactive logon session — which is NOT "credential not found" (`ERROR_NOT_FOUND`, 1168). So **keychain tests (vault keys, API-key storage) must run inside the live desktop session** (interactive scheduled task, with `KEEPANCE_TEST_KEYCHAIN=1`), never via `ssh cargo test`. This is real and unavoidable.
9. **Fill the gaps the cloud runners hide — one-time, per machine:**
   - **Rust/openssl-sys needs Perl (+NASM)** to build vendored OpenSSL. Windows: `winget install StrawberryPerl.StrawberryPerl NASM.NASM` (Strawberry bundles both at `C:\Strawberry\perl\bin` + `C:\Strawberry\c\bin`). GitHub runners ship these; a fresh laptop doesn't.
   - **The Piper voice sidecar binary** must exist before the build (`tauri.conf.json` `externalBin: binaries/piper`). macOS/Linux: `bash scripts/fetch-piper-sidecar.sh` (auto-detects platform; the voice download may fail rc=1 but the *binary* gets placed → build still OK). Windows: download `piper_windows_amd64.zip` from rhasspy/piper `2023.11.14-2`, place `piper.exe` as `src-tauri/binaries/piper-x86_64-pc-windows-msvc.exe`.
   - **Windows MSVC C++ Build Tools** (the linker): `winget install Microsoft.VisualStudio.2022.BuildTools` with the `VCTools` workload; set Rust to MSVC (`rustup default stable-msvc`). **macOS Xcode Command Line Tools** (`xcode-select --install`) is the one step that needs an admin password.
10. **Long installs launched from SSH can die with the session.** Run them as a **Scheduled Task** (Windows) so they survive — that's how the C++ Build Tools install completed.
11. **Keep a laptop awake lid-closed:** Windows = "do nothing on lid close" + disable sleep/hibernate (`powercfg`). macOS = `sudo pmset -c disablesleep 1` (runs lid-closed on AC with no external display). Both should auto-login so a desktop exists after a power blip.
12. **Cross-platform test-writing lessons** (from the 5 fixes committed `b6a139c`): use `std::env::temp_dir().join(...)` for "absolute path" tests (a `/...` literal is NOT absolute on Windows); **canonicalize both sides** of a path `assert_eq!` (Windows adds a `\\?\` extended-length prefix); a test's bundle/skip-guard must mirror ALL the candidate paths the production code checks; **gate keychain tests** behind `KEEPANCE_TEST_KEYCHAIN`.
13. **macOS over SSH won't auto-load PATH** (only `~/.zshenv` is read non-interactively) → prepend the toolchain PATH in every command.
14. **`cargo test name1 name2` takes only ONE filter on Windows; PowerShell pipelines (`| Select-String`) override the exit code** — read the output for `0 failed`, don't trust the SSH exit status.

---

## 6. History / timeline (what happened, honestly)

- **Research + strategy:** two deep-research passes → the velocity strategy (two-speed + benches) and the setup runbook. Decided to use Jameson's existing Legion (Windows) + Allison's M1 (Mac) instead of buying hardware.
- **Windows bench stood up:** OpenSSH server + key + firewall lockdown + power settings, all over Tailscale. Toolchain installed (Node, Rust-MSVC, protoc, then Perl/NASM, then the Piper sidecar — each surfaced as a build failure and was fixed one-time).
- **The clone saga (lesson #1 + #2 + #4):** the Windows box couldn't reliably `git clone` from GitHub (stalled at ~0 bytes); repeated short-timeout kills left 6 orphaned processes that jammed retries. **Switched to tarball-over-tunnel**, which worked first try.
- **First build:** ~15–20 min cold (across the Perl/Piper fixes); **incremental rebuild = 67 s.** App launched and **rendered correctly in WebView2** (screenshot captured).
- **Windows test pass (continuing the prior session's handoff):** ran the Rust suite → 464 pass / 5 fail. **All 5 were test-only assumptions, zero product bugs.** Fixed, verified on Linux (470/0) + Windows (469/0), committed + pushed (`b6a139c`, `27c4c1d`).
- **Mac bench stood up:** standard account (files isolated), user-local toolchain, Xcode CLT (Jameson), Piper auto-fetch. **Built v3.3.5 in 5m 12s.**
- **Net:** two real-OS benches, both building Advisor Prep Hero from the server, no signed build. Test loop went from 60–90 min to ~1 min.

---

## 7. Build-time reference (`~/keepance-bench-buildtimes.csv`)

| Machine | Phase | Time |
|---|---|---|
| Legion (Win) | cold first build (one-time, incl. env fixes) | ~15–20 min |
| Legion (Win) | **incremental, 1 file changed** | **67 s** |
| Legion (Win) | full Rust test suite | ~7 min |
| Mac (M1) | cold build | 5m 12s |
| — | (old) signed cloud build to test a fix | **60–90 min** |

---

## 8. What's still open (as of 2026-06-19)
- Run + screenshot the app **on the Mac** (mirror Windows §4.3).
- The **live email-connector** UI test — needs 2 Jameson taps (Outlook passkey + Gmail consent).
- **Windows keychain** test in an interactive session (§5.8).
- The **pre-release master test plan** (separate doc) — the full checklist before an official release.
- Mac disk is tight (~9GB) — prune build artifacts as needed.
