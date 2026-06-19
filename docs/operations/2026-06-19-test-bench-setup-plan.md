# Test-bench setup plan — give the server full control of the Legion (Win) + M1 MacBook (Mac)

_2026-06-19. Research-backed runbook. Companion to `2026-06-19-ai-dev-velocity-strategy.md` (the "why") — this is the "how"._

Legend:  👤 = **you** must be physically at that laptop for this step ·  🤖 = **I** (the server/AI) can do this remotely afterward ·  ✅ = verified against primary docs ·  📋 = standard, well-documented practice (not separately fact-checked here).

> **Goal.** Turn two computers you both never use — your **Legion 5i Pro** (Windows 11) and your wife's **M1 MacBook** — into always-on machines the server can fully drive, so an AI can build and test the real Windows/Mac app in minutes instead of waiting 60–90 min for a signed build. Maximum control, files kept safe, secured to your private network only.

---

## 1. The picture in plain words

We give the server its own seat at each laptop, through your existing private tunnel (Tailscale — already set up; the Mac and a Windows laptop are already on it). Each laptop will:
- **Never sleep**, even with the lid shut.
- **Log itself in** so there's always a live desktop ready.
- Accept the server over two private channels: a **command line** (type anything) and a **screen view** (see + click like a person).
- Run an **AI agent with admin power** so it can build, launch, click through, read errors, fix, repeat — on its own.

**Your laptop:** full admin, treated as a disposable test box (wipe-and-rebuild is always the safe reset).
**Your wife's Mac:** the AI gets maximum power inside a **sealed space** that can't see her files — a virtual machine if the Mac has 16GB memory, or a separate private login if it has 8GB. I'll check the memory myself once I'm in and pick.

**Your total physical to-do list (everything else is me):**
- Legion: ~6 quick clicks/toggles + paste 3 short commands I'll give you (≈15 min, once).
- Mac: ~5 quick toggles + paste 1 command (≈10 min, once).
That's it. After that I do all the installing, configuring, building, and testing remotely.

---

## 2. The five hard truths from the research (these shape every step)

1. **Windows can't be a "Tailscale SSH" server.** ✅ So the Legion gets Windows' own built-in remote terminal (OpenSSH Server) instead. The Mac and server can use Tailscale SSH directly. (Source: Tailscale SSH docs.)
2. **A GUI test needs a logged-in, *unlocked* desktop.** ✅ If a screen session locks, the OS literally stops drawing the screen and any click-test fails. On Windows, plain Remote Desktop *locks* the local screen when you disconnect — so we use a screen tool that mirrors the real (console) session instead, and keep it auto-logged-in. (Source: SmartBear/TestComplete + Microsoft.)
3. **The Mac has no built-in "app driver."** ✅ Apple ships no automation driver for the Mac app's web view. So on Mac we lean on the built-in screen-share (mirrors the real session) + a visual AI tester, plus a brand-new community driver we can compile into the debug build if we want scripted tests. (Source: Tauri + WebdriverIO docs.)
4. **Disk encryption behaves differently per OS at power-on.** 📋 Windows BitLocker (with the laptop's security chip) unlocks itself at boot — encrypted *and* unattended. Mac FileVault needs a password typed once after a full power-loss before it'll boot — encrypted but a cold start needs one human unlock. (We plan around this below.)
5. **A Mac laptop won't normally stay awake lid-closed without an external monitor.** 📋 There's a one-line fix (`pmset disablesleep`) so it runs lid-shut with nothing plugged in.

None of these are blockers — they just decide *how* we wire each box.

---

## 3. Architecture (what connects to what)

```
        ( your private Tailscale tunnel — nothing exposed to the open internet )
                                    │
   ┌───────────────┐        ┌───────────────┐        ┌────────────────────────┐
   │  jameworld    │  SSH   │  Legion (Win) │        │   M1 MacBook           │
   │  Linux server │──────▶ │  full admin   │        │  ┌──────────────────┐  │
   │  (me/AI)      │  +VNC  │  AI agent     │        │  │ sealed space:    │  │
   │               │──────▶ │  GH runner    │  SSH   │  │  VM  *or*  a     │  │
   │               │────────────────────────────────┼─▶│  separate login  │  │
   └───────────────┘        └───────────────┘  +screen│  │  AI agent (max   │  │
                                                       │  │  power inside)   │  │
   ACL: ONLY the server may reach the two benches.     │  └──────────────────┘  │
                                                       │   her files: walled off │
                                                       └────────────────────────┘
```

---

## 4. Legion (Windows 11) — ordered runbook

### Phase A — you, physically at the Legion (~15 min, once)
- **A1 👤 Plug it in and confirm it's on the tunnel.** Keep it on AC power. Open the Tailscale app; make sure it's signed in (it shows as a Windows device named "laptop" on your tailnet). _Effort: 1 min._
- **A2 👤 Stop it ever sleeping.** Settings → System → Power → Screen & sleep → set **all** "sleep" options to **Never** (on AC). Then Control Panel → Power Options → "Choose what closing the lid does" → **On AC: Do nothing**. _Effort: 2 min. 📋_
- **A3 👤 Turn on auto-login.** Press Win+R, type `netplwiz`, Enter → uncheck "Users must enter a user name and password" → enter the account password once. Now it boots straight to the desktop. _Effort: 2 min. 📋_
- **A4 👤 Turn on the remote terminal (paste this in an *Admin* PowerShell).** Right-click Start → "Terminal (Admin)" → paste: _Effort: 2 min. ✅_
  ```powershell
  Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0
  Start-Service sshd
  Set-Service -Name sshd -StartupType Automatic
  ```
- **A5 👤 Turn on disk encryption (BitLocker).** Search "BitLocker" → Turn on for C:. (Needs Windows 11 **Pro**; if it's **Home**, use Settings → Privacy & Security → Device encryption instead.) This auto-unlocks at boot via the security chip, so it stays unattended. _Effort: 3 min to start (encrypts in background). 📋_
- **A6 👤 Tell me the account name.** So I know who to SSH in as. _Effort: 10 sec._

### Phase B — me, remotely (no human needed)
- **B1 🤖 Lock down access** so *only* the server can reach the Legion: tighten the Tailscale ACL (tag the bench, grant SSH from the server only), never expose it publicly. ✅
- **B2 🤖 Confirm I can SSH in**, set up a key so it's password-free, and harden the SSH config. 📋
- **B3 🤖 Install a screen tool that mirrors the real desktop** (a console-mode VNC such as TightVNC/RealVNC) so the visual AI can see + click the actual logged-in screen — not a separate locking session. ✅ (avoids the Remote-Desktop lock trap)
- **B4 🤖 Install the build toolchain:** Microsoft C++ Build Tools ("Desktop development with C++"), Rust set to the MSVC toolchain (`rustup default stable-msvc`), the Edge WebView2 runtime, Node.js LTS, protoc. ✅
- **B5 🤖 Install the AI agent on the box** (Claude Code) with admin rights, so it can build/run/test locally at full speed. 📋
- **B6 🤖 (Optional now) Install a self-hosted GitHub Actions build runner** as an auto-start service, with the build cache kept warm on disk for fast repeat builds, labeled `windows`. ✅ (private repo only — Keepance is private ✓)
- **B7 🤖 Set "restart after power loss"** (a firmware setting, where remotely settable) + verify everything auto-starts at boot, so a power blip self-recovers. 📋
- **B8 🤖 First real test:** clone Keepance, build the **unsigned debug** app, launch it, click through, confirm I can see the screen and read logs. Then we have a working Windows bench.

---

## 5. M1 MacBook — ordered runbook

> First, the safety choice gets made here: **I'll read the Mac's memory as step C-pre and pick** — 16GB → sealed **virtual machine** (AI gets unlimited power inside, her files invisible to it); 8GB → a **separate standard login** (macOS keeps her files private from it by default). Either way her files stay safe.

### Phase C — you, physically at the Mac (~10 min, once)
- **C1 👤 Plug it in and confirm Tailscale is on** (it's already on your tunnel as "allisons-macbook-pro"). Keep it on AC. _1 min._
- **C2 👤 Turn on the remote terminal + screen share.** System Settings → General → Sharing → enable **Remote Login** (SSH) and **Screen Sharing**. _2 min. ✅_
- **C3 👤 Let it run lid-closed without a monitor.** Open Terminal, paste: `sudo pmset -c disablesleep 1` (type your password). This keeps it awake on AC even with the lid shut and nothing plugged in. _1 min. 📋_
- **C4 👤 Turn on auto-login** (System Settings → Users & Groups → Automatic login → the test account). _1 min. 📋_
- **C5 👤 Turn on disk encryption (FileVault)** (System Settings → Privacy & Security → FileVault → On). Note: after a *full* power loss it'll ask for the password once before booting — rare, and worth it for a confidential product. (If you'd rather it be 100% hands-off through power cuts, we can skip FileVault or add a small battery backup; your call — I'll flag it again at setup.) _2 min to start. 📋_
- **C6 👤 Give me an admin password once** so I can do the system-level installs, then I take over. _1 min._

### Phase D — me, remotely
- **D-pre 🤖 Read the Mac's memory + storage → choose VM vs separate-login** (the §C decision), and tell you which I picked and why. ✅(per-user file isolation is macOS-default)
- **D1 🤖 Lock down access** (Tailscale ACL: only the server reaches the Mac). ✅
- **D2 🤖 Key-based SSH in over the tunnel**, password-free, hardened. 📋
- **D3 🤖 Build the sealed space:**
  - _If VM:_ install a free virtualizer (UTM or VirtualBuddy), create a macOS VM, set it to auto-start, and do everything below *inside* it. 📋
  - _If separate login:_ create the standard "Keepance Test" account; work inside it. macOS already blocks it from her Documents/Desktop/Downloads. ✅
- **D4 🤖 Install the toolchain** (Xcode Command Line Tools via `xcode-select --install`, Rust via rustup, Node LTS, protoc). ✅ (no full Xcode needed — desktop only)
- **D5 🤖 Install the AI agent** (Claude Code) in that space. 📋
- **D6 🤖 (Optional) GUI test driver:** built-in Screen Sharing mirrors the real session for a visual AI tester (no lock problem on Mac), plus — if we want scripted Mac tests — compile the new debug-only WebDriver plugin into the build. ✅(new/community — verify version before relying)
- **D7 🤖 (Optional) Self-hosted build runner** as a launchd auto-start service, labeled `macos`, warm cache on disk. ✅
- **D8 🤖 First real test:** build the unsigned debug Mac app, launch it, drive it, read logs. Mac bench live.

---

## 6. Security hardening (both machines)

- **Private tunnel only.** ✅ Never expose the terminal/screen to the open internet; everything rides Tailscale, ACL-restricted so *only the server* can reach the benches. Benches authenticated as tagged "server" devices, not as user devices.
- **Disk encryption on** (BitLocker / FileVault) so a stolen laptop is unreadable. 📋
- **Disposable + no real client data.** 📋 Treat both as wipe-able. Use **synthetic test data only** — never real client files — on these boxes. (Extra important on the Mac, where her real files live in a *different* sealed compartment from the AI's.)
- **Self-hosted runners: private repo only.** ✅ Keepance's repo is private, which is the safe configuration. (Note: the scary "runners are backdoors" claim was *not* substantiated in verification — the real rule is simply "private repos only, isolated boxes.")
- **One honest risk, stated plainly:** maximum access = maximum blast radius if the AI errs or is tricked by something it reads while testing. The disposable-box + private-tunnel + encryption + synthetic-data combo is exactly what keeps that risk cheap (worst case = wipe and rebuild).

---

## 7. Reliability / always-on / recovery

- **Auto-start everything at boot** (SSH, screen tool, agent, optional runner as services). ✅ for runner/SSH.
- **Self-recover after a power cut:** firmware "power on after AC restore" + auto-login + auto-start services. (Mac caveat: FileVault wants one manual unlock after a cold boot — mitigate with a small UPS if you want it fully hands-off.) 📋
- **Wake-on-LAN** so a sleeping/off box can be woken over the tunnel if ever needed. 📋
- **Liveness check:** a small scheduled ping from the server; if a bench drops offline it messages you via `notify-jameson`. 📋

---

## 8. How the AI uses the benches (the payoff)

Once live, the loop for any Windows/Mac fix becomes: I SSH into the bench → build the **unsigned debug** app (fast, warm cache, no signing) → launch the real app → drive it (script + visual agent) → read logs → fix → repeat — in minutes. The slow 60–90 min signed build is then used **only** when actually shipping a release, with a quick human spot-check from you before it goes public.

---

## 9. Open decisions / what I'll need from you to start

1. **Go-ahead to begin**, and whether to start with the **Legion** (simpler, fully yours) or both.
2. The Legion's **Windows account name** (step A6) and the Mac's **admin login** (C6) — given to me at setup time.
3. **FileVault on the Mac: yes (encrypted, one manual unlock after a power cut) or skip (fully hands-off, less secure)?** Default = yes.
4. Everything else I decide and execute, reporting back at each milestone.

---

## 10. Sources (primary unless noted)
- Tailscale SSH + ACLs/tags: https://tailscale.com/kb/1193/tailscale-ssh/ · https://tailscale.com/docs/features/access-control/acls · https://tailscale.com/blog/acl-tags-ga
- Windows OpenSSH Server: https://learn.microsoft.com/windows-server/administration/openssh/openssh_install_firstuse
- RDP-lock / keep-unlocked for GUI tests (tscon→console): https://support.smartbear.com/testcomplete/docs/testing-with/running/via-rdp/keeping-computer-unlocked.html
- Tauri 2 prerequisites (Win MSVC/WebView2; Mac CLT): https://v2.tauri.app/start/prerequisites/
- Tauri WebDriver + macOS gap: https://v2.tauri.app/develop/tests/webdriver/ · https://webdriver.io/docs/desktop-testing/tauri/platform-support/ · https://github.com/danielraffel/tauri-webdriver · https://github.com/Choochmeque/tauri-plugin-webdriver
- Self-hosted runner as a service: https://docs.github.com/actions/hosting-your-own-runners/managing-self-hosted-runners/configuring-the-self-hosted-runner-application-as-a-service
- Warm Rust cache: https://github.com/swatinem/rust-cache
- Mac lid-closed / clamshell: https://www.macworld.com/article/673295/how-to-use-macbook-with-lid-closed-stop-closed-mac-sleeping.html · https://github.com/pirj/noclamshell
- FileVault + login/auto-login interaction: https://help.swif.ai/en/articles/10536153-filevault-s-effect-on-the-macos-login-window

> **Verification note:** the agent-install, keep-awake, auto-login, FileVault/BitLocker, Wake-on-LAN and ephemeral-vs-persistent-runner details are marked 📋 (well-documented standard practice) rather than ✅ because they fell outside the fact-checked claim set in this research pass; the networking, OpenSSH, RDP-lock, toolchain, WebDriver and runner-as-service items are ✅ verified against primary docs.
