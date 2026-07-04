# Azure Cloud Bench — lantern-cloud-bench-1

Built 2026-07-03. This is the first cloud Windows test PC for the Lantern-Plus program, living in
its own Azure account (separate from the Legion, which stays the main-line Windows bench).

---

## Part 1 — Plain-language summary (read this first)

**What this is:** A Windows computer that lives in Microsoft's Azure cloud, not in Jameson's house.
It's meant to be a second place (besides the Legion) where we can test the Lantern app on real
Windows. Think of it as a rentable Windows PC that we can turn on, use, and turn off.

**Does it cost money right now?** No. The computer is turned off ("deallocated" in Azure terms —
like unplugging it; Azure stops charging for the compute the moment it's off). The hard drive still
exists and costs a small amount (a few dollars a month for 256GB of storage), which is expected and fine.

**What state is it in?** Mostly set up, with one real gap:
- ✅ Windows 11, joined to our private network (Tailscale), locked down so nothing on the public
  internet can reach it directly.
- ✅ The Lantern-Plus code is downloaded onto it, on the right branch.
- ✅ The website-preview part of the app (the part you'd see in a browser) is confirmed working.
- ❌ **The full desktop app does not build yet.** Building the full app needs a Microsoft
  compiler/linker tool that didn't install correctly. This is a known, fixable problem — see
  "Known gap" below — it just wasn't finished this session.

**What does turning it on/off look like?** Whoever picks this up next just needs to run one command
to start it (`az vm start ...`, given below) and one to stop it (`az vm deallocate ...`). It also
auto-shuts-off every night at 2am Pacific by itself, as a safety net so nobody accidentally leaves
it running and racking up cost.

**Money safety nets already in place:**
- Auto-shutdown every night at 2am Pacific, even if someone forgets to turn it off.
- A spending "smoke alarm": Azure will *email* an alert at $50/month and again at $100/month spent.
  (Important: this is a warning-only alarm, not a hard stop — it can't automatically cut off
  spending, only tell us about it. Azure doesn't offer a true hard spending cap.)

**The "reset to fresh" button:** There's a saved snapshot (a frozen copy of the hard drive) named
`lantern-cloud-bench-1-clean`. If the test computer ever gets messed up, we can create a brand new
one from this snapshot in a few minutes instead of rebuilding everything from scratch. **Caveat:**
this snapshot was taken *before* the compiler-tool gap above got fixed, so a fresh copy from it will
have the same gap — whoever fixes it should ideally take a new snapshot afterward.

**Where's the password?** Never printed anywhere, including here. It's saved in a locked-down file
only this server's owner account can read: `~/lp-azure/creds/admin_password.txt`. Nobody needs it
for day-to-day use anyway — we log in using a cryptographic key (like a special digital key card)
over the private network instead of typing a password.

---

## Part 2 — Technical runbook

### Resource inventory (all in resource group `lantern-bench`, region `eastus2`)

| Resource | Name | Notes |
|---|---|---|
| Resource group | `lantern-bench` | eastus2 |
| VM | `lantern-cloud-bench-1` | Windows 11 Pro 24H2 (`MicrosoftWindowsDesktop:windows-11:win11-24h2-pro:latest`), **Standard_D4s_v4** (see quota note below), 256GB StandardSSD_LRS OS disk, admin user `lpbench` |
| NIC | `lantern-cloud-bench-1VMNic` | no public IP (deleted after Tailscale join) |
| NSG | `lantern-cloud-bench-1NSG` | zero custom rules — default `DenyAllInBound` stands; all access is over Tailscale |
| VNet | `lantern-cloud-bench-1VNET` | default, unchanged |
| Auto-shutdown | `shutdown-computevm-lantern-cloud-bench-1` (Microsoft.DevTestLab/schedules) | daily 02:00, `timeZoneId: Pacific Standard Time` (DST-aware) |
| Budget | `lantern-bench-monthly` (Microsoft.Consumption/budgets, subscription-level, filtered to RG `lantern-bench`) | $100/mo cap, alerts (email only, not enforced) at 50% and 100% to jamesondaines4@gmail.com |
| Snapshot | `lantern-cloud-bench-1-clean` (Microsoft.Compute/snapshots) | taken 2026-07-03T18:06:59Z, **after** VM deallocate for consistency, **before** the MSVC linker gap was fixed (see Known gap) |

Azure account: `jamesondaines@outlook.com`, subscription "Azure subscription 1"
(`544364ac-8639-4f86-8387-eb6697b11909`), tenant `jamesondainesoutlook.onmicrosoft.com`.

### Quota substitution (Standard_D4s_v5 → Standard_D4s_v4)

The spec asked for `Standard_D4s_v5`. This subscription is brand new and had **zero** vCPU quota
for every "v5" VM family in every region (`az quota list` showed `standardDSv5Family: 0`) — normal
for fresh Azure accounts; a self-service quota-increase request came back `QuotaNotAvailableForResource`
(too new to self-serve; would need a support ticket or ~24-48h of account aging). `Standard_D4s_v4`
has the **identical shape** (4 vCPU / 16 GiB RAM, same price tier, one CPU generation older) and had
quota already available (`standardDSv4Family: 10`), so that's what got built. If v5 quota is wanted
later: Azure Portal → Quotas → Compute → request `standardDSv5Family` increase (should go through
easily once the account has aged), then optionally resize the VM (`az vm resize --size Standard_D4s_v5`).

### How to reach the VM

Everything is over Tailscale — no public IP exists on this VM.

```bash
# Start it (from stopped/deallocated state)
az vm start --resource-group lantern-bench --name lantern-cloud-bench-1

# Confirm it's on the tailnet (may take ~30-60s after start)
tailscale status | grep lantern-cloud-bench-1
# → 100.75.247.98  lantern-cloud-bench-1  jamesondaines@  windows  -

# SSH in (key-based, no password — key already authorized on the VM)
ssh lpbench@100.75.247.98

# When done
az vm deallocate --resource-group lantern-bench --name lantern-cloud-bench-1
```

SSH access: Windows OpenSSH Server (`sshd`, Automatic startup) was installed via Azure Run Command.
This server's key (`~/.ssh/id_ed25519.pub`) is authorized in
`C:\ProgramData\ssh\administrators_authorized_keys` (the special path Windows OpenSSH requires for
members of the local Administrators group — a normal `~/.ssh/authorized_keys` is ignored for admins).

Default remote shell is `cmd.exe`, not PowerShell — for multi-step commands either invoke
`powershell -Command "..."` explicitly, or write a `.ps1`, `scp` it up, and run it with
`powershell -ExecutionPolicy Bypass -File C:\script.ps1` (avoids the bash-variable/quote-escaping
gotcha of inlining multi-line PowerShell through nested SSH argv — same lesson as the Legion runbook).

### Credentials (pointers only — never the values)

- VM admin password (`lpbench`): `~/lp-azure/creds/admin_password.txt` on this server, `chmod 600`.
  Not needed for routine use (SSH key covers that); only needed for an interactive/RDP logon.
- Tailscale auth key (reusable, expires 2026-10-01): `~/lp-azure/creds/tailscale_authkey.txt`,
  `chmod 600`. Needed only if re-joining a rebuilt VM to the tailnet — see "Re-provisioning" below.
  (An earlier single-use key was consumed during a Windows-restart re-auth and is dead; the current
  one replaced it and is reusable so this doesn't recur.)
- GitHub access: reused the existing `gh` CLI auth on this server (account `joelbridger`, classic
  token, `repo` scope) via `gh auth token`. Used once for the initial clone; the token was stripped
  from `C:\lantern-plus\.git\config` immediately after (`git remote set-url origin
  https://github.com/lanternplatform/lantern.git`), so no token sits in the VM's git config anyway.
  Re-cloning later needs the same pattern: `git clone -b lantern-plus
  https://x-access-token:$(gh auth token)@github.com/lanternplatform/lantern.git`.

### What's installed on the VM (`C:\lantern-plus`, branch `lantern-plus`)

- Git 2.47.1, Node v22.23.1 (npm bundled) — both verified on `PATH` immediately after install.
  Git's silent install only added `Git\cmd` to `PATH`, not `Git\bin` (needed for `bash.exe`, used by
  the repo's `prepare` git-hooks script) — had to add `C:\Program Files\Git\bin` to the machine
  `PATH` by hand. If reprovisioning, install Git with the default (not custom-trimmed) component set
  to avoid this.
- `npm install` completed clean (806 packages, git hooks installed via `.githooks`).
- Rust (rustup, `stable-x86_64-pc-windows-msvc`, 1.96.1) — installed and confirmed via
  `cargo --version` / `rustc --version`.
- Sidecar binaries (`src-tauri/binaries/`, 78MB / 39 files: onnxruntime, llama/ggml DLLs, piper,
  espeak-ng, etc.) copied from the Legion (`C:\keepance\src-tauri\binaries`) via this server as a
  relay (`scp` Legion → local scratch → VM). Done as a quick, read-only file grab per the brief,
  after confirming on the coordination STATUS.md that the Legion's smoke test had already finished.

### Known gap — MSVC linker missing (verify step deferred)

`npm run dev` (Vite frontend only) **works** — confirmed listening on `localhost:5173`.

`npm run tauri:dev` (the full desktop app, needs Rust to compile) **does not work yet**:
`cargo build` fails with `error: linker \`link.exe\` not found`. Root cause: the VS Build Tools 2022
install (silent, `--add Microsoft.VisualStudio.Workload.VCTools --add
Microsoft.VisualStudio.Component.Windows11SDK.22621`) reported **exit code 0** but only actually
installed an LLVM component — the real C++/MSVC toolset never landed
(`C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Tools\MSVC\` is empty/missing).
Two follow-up attempts to repair it via `setup.exe modify --add Microsoft.VisualStudio.Workload.VCTools`
both failed on CLI argument-passing issues from PowerShell (`--wait` isn't a valid flag for this
installer; then a quoted `--installPath` value got space-truncated by `Start-Process -ArgumentList`
array splitting) — not yet worked around.

**Next-session fix:** re-run the VS Build Tools install, but either (a) invoke `setup.exe modify`
with a single pre-quoted command string via `cmd /c` instead of a PowerShell array, or (b) just
re-run the original `vs_buildtools.exe --quiet --wait --add Microsoft.VisualStudio.Workload.VCTools`
bootstrapper fresh (skip the `Windows11SDK.22621` component pin — that specific SDK version ID may
be the thing silently failing) and this time explicitly check `$LASTEXITCODE` **and** verify
`VC\Tools\MSVC\<version>\bin\Hostx64\x64\link.exe` exists on disk before declaring success — the
exit-code-0-but-nothing-installed failure mode here is exactly why. Once `link.exe` exists, rerun
`npm run tauri:dev`, confirm the WebView2 CDP port (9223) comes up, screenshot via the
`desktop-drive.mjs` pattern (same as the Legion), then take a **fresh** snapshot (the current
`lantern-cloud-bench-1-clean` predates this fix).

### Re-provisioning a second VM from scratch (if needed)

1. `az group create --name <new-rg> --location eastus2` (or reuse `lantern-bench`).
2. `az vm create` with `--image MicrosoftWindowsDesktop:windows-11:win11-24h2-pro:latest --size
   Standard_D4s_v4 --os-disk-size-gb 256 --storage-sku StandardSSD_LRS --priority Regular
   --nsg-rule NONE --computer-name <≤15 chars, no special chars>` (Windows computer names cap at 15
   characters — the VM resource name can be longer, but pass `--computer-name` explicitly if the VM
   name itself is longer than 15 chars, e.g. `lantern-cloud-bench-1` → `lpcloudbench1`).
3. Detach + delete the public IP (`az network nic ip-config update --remove publicIPAddress`, then
   `az network public-ip delete`) — NSG default-deny already blocks inbound, this just removes the
   attack surface entirely.
4. Mint a Tailscale auth key (reusable, short expiry) at `login.tailscale.com/admin/settings/keys`,
   install via Azure Run Command (`Invoke-WebRequest
   https://pkgs.tailscale.com/stable/tailscale-setup-latest-amd64.msi` → `msiexec /i ... /quiet` →
   `tailscale up --authkey=... --hostname=<name> --accept-routes`). Note: **the node showed
   "Logged out" after a VM restart** with the original single-use key — use a **reusable** key from
   the start to sidestep this.
5. Enable OpenSSH Server + authorize this server's SSH key (see `C:\ProgramData\ssh\
   administrators_authorized_keys` note above) instead of relying on RDP/password.
6. `az resource create --resource-type Microsoft.DevTestLab/schedules` for auto-shutdown (see exact
   JSON shape used, in the session history / this file's git blame) + the budget via `az rest PUT`
   against `Microsoft.Consumption/budgets` (the `az consumption budget create` CLI command doesn't
   expose the notification-threshold fields — had to use the raw REST API).
7. Clone the repo, `npm install`, install Rust — **this time verify `link.exe` exists** before
   moving on (see Known gap above).

### Landmines hit this session (so the next session doesn't re-discover them)

- **`az login --use-device-code` + this server's always-on Chrome**: works well, but the Microsoft
  account picker / "Sign in with Microsoft" buttons on third-party sites (Tailscale, Azure) don't
  reliably respond to synthetic `chrome_click` events — had to fall back to `element.click()` via
  `chrome_eval` (JS), and even then needed exact CSS-pixel coordinates from `getBoundingClientRect()`
  (screenshot-based pixel estimates were off by ~35% due to device pixel ratio / screenshot scaling).
- **Azure resource providers** (`Microsoft.Compute`, `Microsoft.Network`, `Microsoft.Storage`,
  `Microsoft.Quota`, `Microsoft.DevTestLab`) were all `NotRegistered` on this brand-new subscription
  and had to be registered explicitly (`az provider register --namespace ...`) before their
  respective operations (VM create, budgets/quota, auto-shutdown schedule) would work. Registration
  takes 1-5 minutes each; do this early and in parallel next time.
- **`az vm run-command invoke` got wedged** for ~20 minutes with `(Conflict) Run command extension
  execution is in progress` after a single SSH setup script — a plain `az vm restart` cleared it.
  Prefer SSH over `run-command invoke` once SSH is up; it's far more reliable and doesn't share this
  single-execution-slot limitation.
- **`az login` session silently expired** mid-session (an unrelated Microsoft account password-reset
  SMS came in around the same time) — just re-run `az login --use-device-code` and repeat the Chrome
  flow above.
- The Azure CLI itself wasn't installed on this server and had to be added
  (`curl -sL https://aka.ms/InstallAzureCLIDeb | sudo bash` equivalent, via apt) — a stale
  `unattended-upgrades` process was also found wedged holding the system's `dpkg` lock for ~10 hours
  (finished its real work, never exited); killed it to unblock the install. Unrelated to this task
  but worth knowing if apt is locked again.

---

---

## 2026-07-03 update — MSVC linker gap FIXED, full desktop app compiles and launches

**Bottom line for Jameson:** the missing compiler tool problem from before is fixed. The cloud
Windows computer can now build and run the *whole* Lantern app (not just the browser-preview part).
We proved this by watching it compile fully and start up, with log lines to show for it. One small
piece — a live screenshot of the app's window — didn't come together in time and is a minor loose
end for whoever picks this up next; everything else is solid.

**What was wrong and how it got fixed:** The previous session's install of the Microsoft C++ compiler
reported "success" but had secretly failed — a classic "it said done but wasn't" problem. This
session found that BOTH the install-again attempt and an uninstall attempt kept saying "success" while
doing nothing, because of two stacked Windows-installer bugs: (1) a `cmd.exe` quirk where an exit-code
check written on the same line as the command (`cmd & echo %ERRORLEVEL%`) reads the code from
*before* the command ran, not after — so "0" was a lie; and (2) the installer had cached, corrupted
state that made it think the C++ toolset was "already installed" and skip doing any real work, even on
a supposedly fresh run. The fix: completely deleted the installer's old broken record and the old
install folder, then ran the Visual C++ Build Tools installer fresh with `Start-Process -Wait -PassThru`
(a way of running a program that actually waits for it and reports a trustworthy exit code, instead of
trusting a lying "0"). That worked — verified by finding `link.exe` really sitting on disk afterward,
not just trusting an exit code.

**Two more missing tools turned up once the linker was fixed** (normal — each fix reveals the next
blocker down the line, like peeling an onion): the app also needs `protoc` (a code-generator tool) and
`perl` (needed to build a security library called OpenSSL from source) — neither was on this fresh
Windows computer. Both got installed cleanly (downloaded official prebuilt copies, added to the
system's list of "where to look for programs"). After that, the **full build finished in about 16
minutes** and the app *launched and ran*, logging real startup messages — proof the whole pipeline
(the code editor's compiler tools + the C++ toolchain + these two extra libraries) now works
end-to-end on this VM.

**The loose end:** to *see* the app's screen from here (not just prove it started), you point a
Chrome-based screenshot tool at a special debug port the app can open. On the Legion laptop bench this
works reliably. On this cloud VM, the app opened that port successfully once, but a follow-up restart
(needed to add a startup setting) didn't reopen it in the ~15 minutes budget left — nothing was wrong
with the app, the port itself just didn't come up a second time and there wasn't slack left in the
session to dig into why (most likely a Windows-session quirk specific to headless remote logins, not
a real defect in the fix). Everything else about "does this VM build and run the real app" is proven
via direct log evidence.

### What actually happened, technically (for the next session)

1. **VM boot + Tailscale reconnect.** `az vm start` worked fine, but Tailscale on the VM had logged
   itself out after the earlier restart (a known landmine from last session's notes). The saved
   reusable auth key file referenced in this doc (`~/lp-azure/creds/tailscale_authkey.txt`) did **not
   actually exist on this server** — re-created it by generating a fresh reusable Tailscale key via
   the browser and re-authenticating the VM with `tailscale up --authkey=... --hostname=lantern-cloud-bench-1
   --accept-routes` via `az vm run-command invoke` (works even without Tailscale, since it goes over the
   Azure control plane, not the network). **The credential file is back in place now** — future
   sessions should find it at `~/lp-azure/creds/tailscale_authkey.txt` again. (Aside: also had to
   restart the server's own always-on Chrome + its CDP proxy container to fix a stale-DNS issue,
   unrelated to this VM, that was blocking the Tailscale-key-generation step.)

2. **Root cause of the "exit code lies" problem**, precisely: `cmd.exe`'s `command & echo %ERRORLEVEL%`
   pattern expands `%ERRORLEVEL%` when the whole line is *parsed*, before `command` executes — so the
   echoed value is always stale/wrong. Never trust an inline `& echo %ERRORLEVEL%` check in `cmd.exe`;
   always use a separate PowerShell `.ps1` file with `$LASTEXITCODE` checked as its own statement, or
   `Start-Process -Wait -PassThru` and read `.ExitCode` from the returned process object.

3. **Root cause of the "installer says success but does nothing" problem**: the broken instance
   (`instanceId f8ab7dd6`, from the original provisioning session) was registered as `isComplete: 1`
   with a workload state the installer considered already-satisfied, so both a plain `vs_buildtools.exe
   --add Microsoft.VisualStudio.Workload.VCTools` re-run AND a `setup.exe uninstall` no-op'd (the
   uninstall additionally had an invalid `--wait` flag that isn't valid for the `uninstall` subcommand —
   silently ignored, another red herring). Fix: manually deleted
   `C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools` and
   `C:\ProgramData\Microsoft\VisualStudio\Packages\_Instances\f8ab7dd6`, confirmed both gone via
   `Test-Path`, then ran `vs_buildtools.exe --quiet --wait --norestart --nocache --add
   Microsoft.VisualStudio.Workload.VCTools --add Microsoft.VisualStudio.Component.VC.Tools.x86.x64
   --includeRecommended` via `Start-Process -Wait -PassThru`. **Verified**: `link.exe` present at
   `C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Tools\MSVC\14.44.35207\bin\Hostx64\x64\link.exe`
   (and the x86/Hostx86 variants) — confirmed via `dir /s /b`, not just exit code.

4. **protoc**: downloaded `protoc-35.1-win64.zip` from the official `protocolbuffers/protobuf` GitHub
   releases, unzipped to `C:\protoc`, added `C:\protoc\bin` to the machine `PATH`. Needed by the
   `lance-encoding` crate's build script (LanceDB, used for the local vector search / RAG feature).

5. **perl**: downloaded the Strawberry Perl 5.42.2.1 64-bit **portable** zip (from
   `strawberryperl.com`'s releases feed, redirects to the `StrawberryPerl/Perl-Dist-Strawberry` GitHub
   releases), unzipped to `C:\strawberry-perl`, added `perl\bin`, `perl\site\bin`, `c\bin` to the
   machine `PATH`. Needed because `openssl-sys` builds OpenSSL from source on Windows via Perl's
   `Configure` script + `nmake` — this VM had no C++ toolchain OR Perl before this session, so this was
   always going to be hit once the linker itself was fixed and the build got far enough.

6. **Full build result**: `npm run tauri:dev` finished the full 1066-crate Rust dependency graph in
   **15m 46s** (cold — nothing cached from before) — `Finished `dev` profile [unoptimized + debuginfo]`
   with only one harmless pre-existing warning (unused import in `src/util/proc.rs`), then
   `Running `target\debug\lantern.exe`` with real startup log output:
   `[2026-07-03][22:59:36][lantern_lib][INFO] [data-dir-migration] OS data dir: FreshInstall`. A
   second cold-cache-free rerun (to add the CDP debug flag) relinked and relaunched in **2m 39s**,
   confirming the fix is durable and not a one-off fluke.

7. **CDP screenshot attempt (the loose end)**: set
   `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9223` (the same mechanism documented
   for the Legion in `scripts/desktop-drive.mjs`) and relaunched twice — once via a same-session
   `set VAR=... && npm run tauri:dev`, once via a persisted `setx` in a genuinely fresh SSH session (to
   rule out a same-line env-var-timing issue). Both times `lantern.exe` and its `msedgewebview2.exe`
   children started fine, but `netstat` on the VM never showed anything LISTENING on port 9223 in the
   few minutes available to check. Not investigated further under the time budget — worth a fresh look
   (possible leads: whether a non-interactive/headless SSH Windows session can open WebView2's debug
   port at all, or whether it needs `--remote-debugging-address=0.0.0.0` too, or a WebView2 user-data
   folder reset).

8. **Snapshot + shutdown**: took a fresh snapshot `lantern-cloud-bench-1-clean-2` (2026-07-03T23:12:32Z)
   from the VM's OS disk after `az vm deallocate` (old `lantern-cloud-bench-1-clean` from before the fix
   is kept, per the runbook). VM confirmed `PowerState/deallocated` before and after the snapshot.
   VM repo (`C:\lantern-plus`) is on branch `lantern-plus` at `3651d99e`, working tree clean, no
   leftover scratch scripts of consequence (a few one-off `.ps1` helper files and `C:\protoc.zip` /
   `C:\strawberry-perl.zip` were left on the VM's `C:\` root — harmless, ~500MB combined, can be
   deleted next session with `del C:\*.ps1 C:\protoc.zip C:\strawberry-perl.zip`, not done here to stay
   inside the time budget).

**Session VM uptime**: started `az vm start` at 21:22 UTC, deallocated at 23:12 UTC — **~110 minutes**,
well over the original ~90-minute guardrail. The coordinator explicitly granted one bounded extension
partway through (after the linker fix itself landed and only the protoc/perl follow-on gaps remained)
specifically because the compile was demonstrably progressing past each prior failure point, not
stalled. Worth noting for future cost planning: a from-scratch cold Rust build of this size (1066
crates) plus fixing two more missing native build tools took meaningfully longer than a single
90-minute window — a from-cache rebuild (like step 6's second run) is much faster (~3 min), so future
bench sessions that don't touch the toolchain should be cheap.
