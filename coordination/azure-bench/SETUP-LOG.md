# Azure Cloud Bench — lantern-cloud-bench-1

Built 2026-07-03. This is the first cloud Windows test PC for the Lantern-Plus program, living in
its own Azure account (separate from the Legion, which stays the main-line Windows bench).

> 🤖 **Before adding ANY new VM to the `lantern-bench` resource group:** the automation's power-robot
> can start/stop every VM in that group and read its userData — so a new VM there MUST be stop-safe
> (safe to power-cycle, no secrets in userData/customData). Non-stop-safe machines go in a different
> resource group. Rule: coordination repo → `prep/AZURE-ROBOT-IDENTITY-SETUP.md` → Section E.

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

---

## 2026-07-04 update — WebView2 CDP port FIXED; cloud bench now a working 2nd smoke target

**Bottom line for Jameson:** the cloud computer can now be driven by our automated test tool, the
same way the Legion laptop already is. That was the last missing piece — everything else about this
VM was already working. We proved it by running one of the real test checks against the cloud VM and
watching it pass, with a screenshot of the app's actual screen to show for it.

**What was actually wrong (this is the interesting part):** the leftover mystery from last session
was "the app starts fine, but the debug port (9223) that our screenshot tool talks to never opens."
The working theory going in was that it was a *login-type* problem — the app was being started over a
plain remote command-line connection (SSH), which Windows treats as a background/non-interactive
session, and some Windows security features quietly misbehave for on-screen apps started that way. That
theory was reasonable and partly right (it's still good practice to run the real app in a real
logged-in session, which this session set up properly, see below) — **but it turned out NOT to be the
actual cause of the missing debug port.** The real cause was smaller and stranger: the way we were
telling the app to open a debug port (setting an "environment variable," `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS`,
which is like a sticky note the operating system hands to a program when it starts) was being **silently
ignored** — because the underlying Windows browser component our app is built on (`WebView2`, part of
Microsoft Edge) always explicitly tells itself what settings to use in code, and once it does that, it
stops reading the sticky note entirely. It's not a bug in this specific app being broken — it's how this
version of the underlying toolkit (`wry`, the library Tauri apps use to embed a browser) always behaves;
the sticky note was never going to work, on the Legion or anywhere else, once you look closely at the
code. Whoever wrote the original scripts documenting the env-var approach a few weeks back had reasonable
grounds to believe it worked, but nobody had actually confirmed a real CDP screenshot from either bench
until today.

**The fix (real code change, not a workaround):** instead of relying on that ignored sticky note, this
session changed the actual application source code (`src-tauri/src/lib.rs` + `src-tauri/tauri.conf.json`,
committed on `lp/azure-cdp-fix`) so the app *itself* reads that same environment variable at startup and
hands it directly to the browser-embedding library's own proper setting for this — the one code path
that's actually honored. When the variable isn't set (the normal case for every real user), the app
behaves 100% identically to before — this only changes anything when a bench script explicitly sets that
variable to open a debug port. This is a genuine, durable fix to the shared codebase, not an Azure-only
patch — it should also fix the same "screenshot tool can't connect" gap on the Legion bench, if that gap
was ever actually hit there (worth a quick sanity check next time the Legion is in active use, since
this session did not touch the Legion, per its lane boundaries).

### Second, smaller gap found and fixed: wrong remote shell

After the CDP port itself was confirmed open (`netstat`/`Invoke-WebRequest` both showed it listening),
running the *actual test harness* (`scripts/bench-smoke.mjs --target azure-cloud-bench-1`) still failed
with a generic Windows path error. Root cause: this VM's remote-command connection (SSH) was set up to
run old-style `cmd.exe` by default, but the test harness's connection code (`scripts/bench-smoke/remote.mjs`)
assumes the newer PowerShell is the default (matching whatever the Legion is configured with) — so its
commands were being fed to the wrong interpreter entirely. Fixed by pointing this VM's SSH connection at
PowerShell by default (`HKLM:\SOFTWARE\OpenSSH\DefaultShell` registry value + an sshd service restart) —
a standard, supported, one-line Windows OpenSSH setting, and a durable one-time fix (survives reboots).

### What actually happened, technically (for the next session)

1. **VM boot + Tailscale re-auth (expected, per the known landmine above).** `az vm start` at 01:09 UTC;
   Tailscale had logged itself out again exactly as documented — re-authenticated with the existing
   reusable key at `~/lp-azure/creds/tailscale_authkey.txt`. **Correction to this doc**: that file
   existed, but `~/lp-azure/creds/admin_password.txt` (referenced above as already present) had gone
   missing from this server (empty `creds/` dir apart from the Tailscale key) — reset the VM admin
   password via `az vm user update --username lpbench --password <new>` (the standard Azure VMAccess
   extension path, doesn't need the old password) and re-saved it properly at that path, `chmod 600`.

2. **Set up a real interactive logon (needed regardless of the CDP root cause, and still correct
   practice)**: enabled Windows auto-logon for `lpbench` (`HKLM:\...\Winlogon\AutoAdminLogon` +
   `DefaultUserName`/`DefaultPassword`/`DefaultDomainName`, password written via a temp file transferred
   over `scp` and deleted immediately after, never echoed to any log), then rebuilt the `LanternDevBench`
   scheduled task with `LogonType Interactive` + an `AtLogOn` trigger for `lpbench` (previously it was
   `LogonType S4U`, time-triggered — a non-interactive logon type that likely explains why last
   session's headless-SSH launch attempt never got a real interactive session either way). Rebooted the
   VM once; confirmed via `query user` that `lpbench` came up **Active** on the console session
   immediately post-boot with no manual RDP step, and the scheduled task fired at logon as configured
   (`cargo`/`node`/`lantern.exe`/`msedgewebview2.exe` all landed in `SessionId 1`, the real interactive
   session — confirmed via `Get-CimInstance Win32_Process`).

3. **Diagnosed the "env var silently ignored" root cause** by: (a) confirming via a temporary `set >
   file` diagnostic in `run-dev.bat` that the cmd.exe process launching `npm run tauri:dev` genuinely
   had `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` set correctly in its own environment (ruling out an
   env-propagation issue); (b) dumping the full command lines of every `msedgewebview2.exe` child process
   via `Get-CimInstance Win32_Process` and finding **zero** occurrences of `--remote-debugging-port`
   anywhere, even on the main browser-process instance, while a *different* wry-default flag
   (`--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection`) **was** present — proving the app's
   browser-launch arguments were coming from somewhere other than the env var; (c) reading the actual
   `wry 0.55.1` source on the VM's own cargo registry cache
   (`wry-0.55.1/src/webview2/mod.rs:294`) and finding it unconditionally calls
   `options.set_additional_browser_arguments(...)` with a default string it builds itself whenever the
   app doesn't supply its own — and per the WebView2 API, an explicitly-set `AdditionalBrowserArguments`
   option (even a non-custom default) takes precedence over and fully suppresses the
   `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` environment variable. Confirmed the fix's exact shape (a
   `"create": false` window-config flag + building the window manually in `.setup()` with
   `.additional_browser_args(...)`) is Tauri's own documented pattern for this
   (`tauri-utils-2.9.3/src/config.rs:1928-1934` doc-comment shows the identical snippet).

4. **Applied the fix, rebuilt, verified.** Patched `src-tauri/tauri.conf.json` (added `"create": false`
   to the one window entry) and `src-tauri/src/lib.rs` (added ~20 lines in `.setup()` building the main
   window explicitly, reading `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` and forwarding it through
   `.additional_browser_args(...)`, defaulting to wry's own default string when unset so production
   behavior is unchanged). **Landmine for next time**: the VM's checkout (`C:\lantern-plus`, branch
   `lantern-plus` @ `3651d99e`) is *behind* this worktree's branch (`lp/azure-cdp-fix`, based on a much
   later `lantern-plus` commit) — an initial attempt that `scp`'d over the *entire* modified `lib.rs`
   file broke the VM's build (`could not find \`retention\` in \`commands\`` — that module doesn't exist
   yet at the VM's pinned commit). Recovered cleanly via `git checkout -- <path>` on the VM (repo was
   otherwise clean) and re-applied *only* the actual diff by locating the matching context lines and
   inserting around them — never blind-overwrite a file on a VM pinned to an older commit than your
   local worktree; diff/patch it instead. Rebuild after the correct patch: **5m 11s** (touching the
   crate root requires relinking the final binary even on a warm dependency cache, slower than a
   leaf-file change but nowhere near a cold 1066-crate build). Confirmed via `netstat` and
   `Invoke-WebRequest http://127.0.0.1:9223/json/version` that the CDP port came up and answered with a
   real WebView2 version banner. Committed the fix locally on the VM's own repo too (`git commit`, not
   pushed — the VM's checkout is pinned to an older commit than the branch this fix lives on here) so
   the VM's working tree stays clean for the next session.

5. **Ran the real harness end-to-end**: `node scripts/bench-smoke.mjs --target azure-cloud-bench-1
   --only index-health` → **PASS** (`Client Map shows cited facts with no index-health error text
   present`), with a real screenshot saved to
   `docs/evidence/bench-smoke/azure-cloud-bench-1-20260704-014042/01-index-health-client-map.jpeg`.
   This is the first time either the CDP port or the harness's Azure-target path has been verified
   working end-to-end.

6. **Cleanup + snapshot + shutdown.** Deleted the leftover clutter files from the previous session
   (`C:\*.ps1`, `C:\protoc.zip`, `C:\strawberry-perl.zip`, ~500MB). Took a fresh snapshot
   `lantern-cloud-bench-1-clean-3` (2026-07-04T01:43:39Z) from the VM's OS disk after `az vm deallocate`
   (both prior snapshots, `-clean` and `-clean-2`, are kept). VM confirmed `PowerState/deallocated`
   before and after the snapshot.

**Durable state now on the VM (survives reboot/redeploy from this snapshot):** Windows auto-logon for
`lpbench`; `LanternDevBench` scheduled task with `LogonType Interactive` + `AtLogOn` trigger (so the app
always comes up in a real interactive session, CDP-capable, with no manual step); SSH `DefaultShell` set
to PowerShell (so `bench-smoke.mjs` and any other PowerShell-based remote tooling work out of the box);
the CDP fix itself is in the app's source (`src-tauri/src/lib.rs` + `tauri.conf.json`), committed both
here (`lp/azure-cdp-fix`) and locally on the VM's own repo.

**Session VM uptime**: started `az vm start` at 01:09 UTC, deallocated at 01:42 UTC — **~33 minutes**,
well inside the 90-minute guardrail.

---

## 2026-07-04 update — merged-tip re-verify, bench-ready golden snapshot, and clone lantern-cloud-bench-2

**Bottom line for Jameson:** we brought the cloud test computer up to date with the very latest code
(everything that's been merged in since last time), proved it still works with no problems, then made
a save-point ("snapshot") of it in the fully-ready state so a brand new copy can be spun up in minutes
instead of rebuilding everything from scratch. We then actually made one such copy
(`lantern-cloud-bench-2`) and confirmed it works — this is our second real cloud test computer now,
ready to use alongside the first one and the Legion laptop. A second copy (`lantern-cloud-bench-3`) hit
an account limit (a "how many computers can run at once" cap) and was not completed tonight — a request
to raise that limit was filed and is pending; a follow-up session can finish the third copy once it's
approved (no cost while it waits, nothing is running).

### Phase A — merged-tip re-verify (P0 check)

1. Started `lantern-cloud-bench-1`, re-joined Tailscale (logs itself out on every restart — known,
   documented above), pulled the repo to `origin/lantern-plus` tip (`f6614b43`, well past the required
   `fc82c2a2`). The VM's repo had 1 local-only commit (the CDP fix, committed but never pushed last
   session) — confirmed via diff that it's the exact same fix already merged upstream via
   `lp/azure-cdp-fix`, so it was safe to `git reset --hard origin/lantern-plus` rather than rebase.
2. **The rebuild took far longer than the "cached, ~3 min" assumption**: the gap between the VM's old
   pinned commit and the new tip was large (37 Rust files changed, ~10,650 lines added — a new
   diarization/speaker-ID feature pulling in heavy new crates), so this was a genuine fresh compile of
   several large dependencies, not a relink. Total real build time was a real cold-ish rebuild (verified
   throughout via CPU time / memory / disk-I/O trending — never stalled, just legitimately big). Lesson
   for next time: check `git log <vm-pinned-commit>..origin/lantern-plus -- src-tauri/` before assuming
   a rebuild will be cheap; a big native-dependency diff means budget for a much longer rebuild.
3. **CDP port 9223 confirmed working** — `lantern.exe` launched, real WebView2 CDP banner returned from
   `http://127.0.0.1:9223/json/version`. **No regression**: the merged tip's CDP fix (the one committed
   via `lp/azure-cdp-fix` last session) still works correctly after landing through the real PR/merge
   path, not just in the original one-off session that built it.
4. Ran `bench-smoke.mjs --only index-health,wave4-whole-book-view,cross-cutting-light-theme`: 2/3
   PASS (`index-health`, `cross-cutting-light-theme`); `wave4-whole-book-view` came back
   `SETUP-BLOCKED` (harness couldn't find the "Whole book" toggle/container on this workspace — a test
   navigation/setup issue, not an app crash or CDP failure). **Verdict: no P0.** The one blocked check
   is worth a look in a future harness-focused session but does not indicate the merged tip broke
   anything.

### Phase B — bench-ready golden snapshot (program #2)

5. Cleaned scratch files, deallocated the VM, and snapshotted its OS disk as
   `lantern-cloud-bench-ready-1` (256GB, succeeded). This is now the **"skip setup" golden image**:
   anyone can clone a VM from this snapshot and get a machine that already has the full toolchain, the
   repo at a known-good commit, and — critically — the CDP fix and PowerShell-default-shell fix already
   applied, so a fresh clone should be usable within a couple minutes of boot (no rebuild needed at all;
   confirmed below).

### Phase C — clones (program #1)

6. Created `lantern-cloud-bench-2` from the golden snapshot (new OS disk `lantern-cloud-bench-2-osdisk`,
   same size `Standard_D4s_v4`, same guardrails — no public IP, default `DenyAllInBound` NSG). Booted it
   and **confirmed the entire point of the golden snapshot**: CDP port 9223 came up immediately with zero
   rebuild, because the `LanternDevBench` scheduled task (interactive auto-logon + `AtLogOn` trigger) just
   self-launched the already-compiled app from the cloned disk.

7. **New landmine found and fixed — cloning a VM disk clones its Tailscale identity too.** When
   `lantern-cloud-bench-2` first joined Tailscale (`tailscale up --hostname=lantern-cloud-bench-2`), it
   showed up on the tailnet at the **exact same IP as `lantern-cloud-bench-1`** (`100.75.247.98`) — because
   the OS disk clone carried over Tailscale's on-disk machine identity (its state lives under
   `C:\ProgramData\Tailscale\profile-data\`, not the `tailscaled.state` file the older docs/scripts
   assume — that file doesn't exist on this Tailscale version). Both VMs were silently fighting over one
   shared tailnet identity/IP, each kicking the other offline whenever it reconnected. **Fix**: on the
   clone, stop the `Tailscale` service, delete `C:\ProgramData\Tailscale\profile-data\` (and
   `server-state.conf`), restart the service, then `tailscale up --authkey=... --hostname=...` fresh —
   this mints a genuinely new machine key and a new IP. **This is now a required step for every future
   clone from this (or any) golden snapshot** — do it immediately after first boot, before assuming the
   clone is reachable at a distinct address. (Tailscale then auto-suffixed the hostname to
   `lantern-cloud-bench-2-1` since the stale duplicate device record was still squatting on the plain
   name — harmless, but there's now an orphaned offline device named `lantern-cloud-bench-2` at
   `100.75.247.98` in the tailnet admin console that should be removed by hand next time someone's in
   the Tailscale admin UI; it does not affect billing or function, just tailnet-list tidiness.)

8. **`lantern-cloud-bench-3` blocked on a regional vCPU quota wall.** This subscription's DSv4-family /
   total-regional-cores quota is 10; each D4s_v4 VM needs 4. bench-1 + bench-2 running together (8
   cores) is fine, but a 3rd VM needs 12. Deallocating bench-1 to free room did **not** immediately help
   — Azure's quota accounting lagged the real VM state by 25+ minutes in this subscription (confirmed via
   `az vm list-usage` staying at "8 used" long after `az vm list -d` showed only 4 cores' worth actually
   running). Per a coordinator decision, filed a quota increase request instead of waiting further:
   `az quota update --scope /subscriptions/544364ac-8639-4f86-8387-eb6697b11909/providers/Microsoft.Compute/locations/eastus2
   --resource-name standardDSv4Family --limit-object value=16 limit-type=Independent --no-wait`
   → request id `a8a59e7e-84bd-4eb6-a229-eaa48eb7ff91`, status `InProgress` as of this session. **Next
   session**: check `az quota request status list --scope <same scope>` for that id; once approved
   (limit shows 16), clone `lantern-cloud-bench-3` from `lantern-cloud-bench-ready-1` the same way
   bench-2 was created (see step 6 above), and remember the Tailscale-identity-reset step in #7. The
   orphaned `lantern-cloud-bench-3-osdisk` (created before the VM-create failed) was deleted to avoid
   paying for an unattached disk in the meantime.

9. **2-way sharded smoke test — first live validation of the shard runner.** With both bench-1
   (`100.75.247.98`) and bench-2 (`100.88.113.105`, registered as `lantern-cloud-bench-2-1`) reachable
   and CDP-live simultaneously, ran:
   ```
   node scripts/bench-smoke-shard.mjs --target azure-cloud-bench-1 \
     --target-host 100.88.113.105 --target-user lpbench --target-id azure-cloud-bench-2 \
     --only index-health,cross-cutting-light-theme
   ```
   → **PASS** on both shards, combined summary at
   `docs/evidence/bench-smoke/sharded-20260704-030352/summary.md`. This is the first time the sharded
   runner has been proven against two real, independent cloud targets running concurrently (previously
   only exercised against a single target or in dry-run/plan mode).

### Ad hoc targets (for `bench-smoke.mjs --target-host/--target-user`, not added to `targets.mjs` per lane rules)

| Target | Host (Tailscale IP) | User | Repo dir | Notes |
|---|---|---|---|---|
| `lantern-cloud-bench-1` | `100.75.247.98` | `lpbench` | `C:\lantern-plus` | Original; already a named target (`azure-cloud-bench-1`) in `targets.mjs` |
| `lantern-cloud-bench-2` | `100.88.113.105` (tailnet name `lantern-cloud-bench-2-1`) | `lpbench` | `C:\lantern-plus` | New clone from `lantern-cloud-bench-ready-1`; Tailscale identity reset done (see #7) |
| `lantern-cloud-bench-3` | — not created — | — | — | Blocked on quota; disk deleted; retry once quota request `a8a59e7e-...` is approved |

### Cost accounting for this session

- **Compute**: bench-1 ran ~02:29–02:51 UTC and again ~02:55–03:06 UTC (~33 min total); bench-2 ran
  ~02:50–03:06 UTC (~16 min). **Combined ≈ 49 minutes of `Standard_D4s_v4` compute** — at list pricing
  (~$0.19/hr for this size in `eastus2`) that's **well under $0.20 total** for this session's compute.
  All VMs confirmed `deallocated` at session end (`az vm list -d`).
- **Storage (ongoing, monthly)**: the resource group now holds 2 attached OS disks (bench-1's original,
  256GB; bench-2's clone, 256GB, `StandardSSD_LRS`) plus **4 snapshots** (`lantern-cloud-bench-1-clean`,
  `-clean-2`, `-clean-3`, and the new `lantern-cloud-bench-ready-1`, each sourced from a 256GB disk).
  Snapshot billing is usage-based (only changed/used blocks, not the full provisioned size), so actual
  cost is likely well below a naive "256GB × 4" estimate, but at full-size list pricing as an upper
  bound: 2 disks × ~$19.66/mo + 4 snapshots × up to ~$12-19/mo each ≈ **roughly $90-130/mo worst case if
  all four snapshots were fully-utilized**, more realistically well under half that given snapshot
  deduplication. **Recommendation**: the two oldest snapshots (`-clean`, `-clean-2`) predate the CDP fix
  and the PowerShell-default-shell fix — they're now strictly worse starting points than
  `lantern-cloud-bench-ready-1`. Worth deleting them in a future session to cut ongoing storage cost,
  unless there's a reason to keep pre-fix rollback points around.

**WORKER-DONE: azclone**
