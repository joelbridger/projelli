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

*This is the canonical doc for lantern-cloud-bench-1. Update it in place as the VM's state changes
(fixed the MSVC gap, took a new snapshot, resized to v5, etc.) rather than creating a new file.*
