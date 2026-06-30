# AI development, testing & shipping velocity — strategy + action plan

_2026-06-19. Research-backed (deep web research, 23 sources, 21 fact-checked claims). Written for a non-engineer founder + future Claude sessions. Companion to `docs/quality/2026-06-19-linux-vs-windows-coverage.md`._

> **TL;DR.** The 60–90 min signed cross-platform build is a *shipping* tool that was being used as a *testing* tool. Run development at **two speeds + a real-OS test bench**: fast unsigned loop (Linux, already strong) → real Windows/Mac test bench (unsigned debug builds an AI drives) → slow signed build only when actually releasing. You can start the test bench for **~$0** using Jameson's existing Legion 5i Pro (Windows) and a borrowed M1 MacBook, and only buy a dedicated Mac Mini later if Mac testing becomes routine.

---

## 1. The core idea: two speeds + a test bench

The signed build exists so customers' Windows/Mac machines will trust and install the app (Apple "notarizes", Azure "signs"). It was never meant to verify a fix. Today every small change runs that full marathon. Fix it with three lanes:

1. **Fast loop (seconds–minutes):** all logic + on-screen work. No signing. Already running on the Linux server. ~90% of work lives here.
2. **Test bench (minutes):** real Windows + Mac machines where the AI builds an **unsigned debug** app (`tauri build --debug`) and drives the real app to catch OS-specific bugs — *without* the signed build.
3. **Release loop (60–90 min signed build):** only when cutting a real version to ship.

Advisor Prep Hero already has lane 1 and lane 3. **Lane 2 is the gap.** Real Windows/Mac hardware fills it.

---

## 2. Are we doing it wrong? Mostly no.

Advisor Prep Hero's test setup is strong and unusually mature for a solo project:
- Thousands of fast logic tests (Vitest + Rust crates: docx engine, RAG, mail, CRDT co-edit math).
- Playwright driving the real React UI on the Vite dev server (~80% of journeys; Chromium ≈ Windows' WebView2 family).
- A headless **real desktop app** suite — `tauri-driver` + `WebKitWebDriver` + `Xvfb` on Linux (`tests/desktop/`) — catches "real app" bugs without a signed build.
- Server-side `*_live_smoke` / `*_live_import` Rust harnesses that hit real provider APIs.
- A written, accurate gap analysis of the Windows/Mac risk surface.

**The single wrong habit:** using the signed build to test Windows/Mac behavior. Replace with real-OS hardware + the two-speed rule.

---

## 3. The irreducible Windows/Mac surface (only these truly need the target OS)

Per the gap doc + research, everything else is testable on Linux. Genuinely OS-specific:
- The **native folder/file picker** dialog (WebDriver can't drive it).
- **OS secret store**: Windows Credential Manager vs macOS Keychain.
- **Installer/uninstaller, auto-updater**, and **webview rendering** (WebView2 on Windows, WKWebView on Mac vs WebKitGTK on Linux).
- **Real Microsoft Word** `.docx` interop.
- The **Windows signed build pipeline itself** (history of breaking on a Unix-only shell step the Linux rig can't catch).

---

## 4. Hardware: use what we already have FIRST

### 4a. Windows — the Legion 5i Pro is excellent. Use it now. (Recommended, $0)
A Legion 5i Pro is a high-end gaming laptop: a powerful multi-core Intel H/HX-series CPU, fast NVMe SSD, typically 16–32GB RAM, and strong cooling built for sustained load. That is **more than enough** to compile a Tauri/Rust app quickly — likely faster than a base Windows mini PC. The GPU is irrelevant to builds (compilation is CPU/RAM/disk bound), but the strong cooling actually helps sustained compiles.

**Use it for:** unsigned debug builds + the AI building/launching/driving the real Windows app + your own spot-checks. Install Tailscale to link it to the server; the AI can then run on it or drive it.

**Tradeoffs (why a dedicated box might come later):**
- It's a **personal/daily machine, not always-on.** If it's asleep, closed, or you're using it, the AI can't reach it — bad for unattended overnight loops.
- **Computer-use (visual) agents are foreground-only on Windows** — they take over the screen, so you can't use the laptop while one runs.
- Heavy continuous builds run it hot/loud; fine occasionally, less ideal 24/7.

**Verdict:** Start here for free. Only buy a dedicated Windows mini PC (~$500–900) if you later want always-on autonomous loops or to stop tying up the laptop. Many solo founders never need to.

### 4b. Mac — borrow the wife's M1 for spot-checks; get a Mac Mini when Mac testing is routine
An M1 MacBook is Apple Silicon (arm64). It can build + run the **Apple-Silicon** Mac version and is a fine machine for occasional manual Mac checks and even an occasional AI-driven Mac session.

**Real cautions (Mac is the weaker option to lean on long-term):**
- **It's someone else's personal machine.** Installing dev tools, remote access, and especially letting an AI agent operate it needs her clear okay — and for a *confidential-data product*, you don't want Advisor Prep Hero test data or an autonomous agent living on a family member's daily computer. Use it for clean, supervised spot-checks, not unattended runs.
- **M1 only covers the Apple-Silicon build, not the Intel Mac build** Advisor Prep Hero also ships. (Intel share is shrinking; Rosetta can smoke-test, but native Intel coverage needs Intel hardware or CI.)
- **Not always available** to you — bad for continuous loops.
- Signing/notarization needs the Apple Developer account, which is independent of the machine (already set up).
- Mac automated-testing tooling is immature anyway (see §8), so a human/visual spot-check is the realistic Mac method regardless of hardware.

**Verdict:** Use the M1 for supervised spot-checks now (with her okay). When Mac testing becomes a regular need, buy a cheap dedicated **Mac Mini (M-series, ~$600–1,000)** — always-on, fully yours, keeps the confidential product off a family machine, and is the only clean long-term Mac path. Lower urgency than Windows.

### 4c. Cost summary
| Path | Cost | When |
|---|---|---|
| Legion 5i Pro as Windows bench | **$0** | now |
| Borrowed M1 for supervised Mac spot-checks | **$0** (needs wife's okay) | now |
| Dedicated Windows mini PC (32GB) | ~$500–900 | only if you need 24/7 autonomy / free up the laptop |
| Dedicated Mac Mini (16–24GB) | ~$600–1,000 | when Mac testing is routine |
| Tailscale (secure linking) | free tier | now |

So the realistic start is **$0**, with a likely **~$600–1,000 Mac Mini later** — not the ~$1,100–1,900 of buying both new.

---

## 5. How the AI gets hands-on access (the "give Claude a Mac/PC" pattern)

Two proven 2025–2026 patterns:
1. **Agent runs *on* the box** (over SSH/Tailscale; Claude Code Remote Control, v2.1.51+, syncs the session to a browser). It builds the unsigned debug app, launches it, clicks through, reads logs, fixes, repeats — minutes, no signed build.
2. **Visual "drive it like a user" agent** (computer-use). OpenAI Codex Computer Use shipped to **Windows 11 on 2026-05-29** — "essentially acting as an autonomous tester." Best for the folder picker, installer, real-Word checks.

**The discipline for near-zero bugs:** let the agent iterate freely on the fast loop + bench, but keep **one ~5-minute human spot-check on real Windows before a release goes public.** Agents follow known flows well and *discover* odd edge cases less well, so the spot-check is cheap insurance, not a bottleneck.

**Gotchas:** Windows computer-use is foreground-only and asks permission per app; was region-limited at launch; reliability is "a joint human-AI effort." On a confidential product, be deliberate about what an autonomous agent with full access can see/touch.

---

## 6. Quick wins — this week, ~free
| Move | What it does | Effort |
|---|---|---|
| Write the **two-speed rule** into the project (signed = release only) | Stops the 60–90 min loop being the test loop | tiny |
| Add **`mockIPC()`** logic tests for JS↔Rust calls | Tests native-boundary logic in seconds, no Rust | small |
| Add **Windows-style path tests on Linux** (backslashes, `C:\`, long paths, reserved names `CON`/`NUL`) | Kills a big chunk of Windows-only bugs without a Windows box | small |
| Turn on **Sentry crash reporting** (free tier) | See real-world crashes the moment a user hits one | small |
| Stand up the **Legion as a Windows bench** (Tailscale + Rust/Node toolchain) | Real Windows testing in minutes, $0 | small |
| Upgrade **WebdriverIO to 9.19.1+** | Auto-Xvfb; simpler Linux E2E | tiny |

---

## 7. Catching the last real-world bugs (post-release)
- **Sentry release health** → "crash-free sessions / crash-free users" %, with threshold alerts usable as a **rollout gate** (e.g. halt promotion if crash-free < 99%). It alerts; it does not auto-roll-back — wire that yourself.
- **Staged rollout / beta channel**: Tauri's auto-update guide only documents a basic single-endpoint flow; channels/percentage rollouts must be engineered (channels via a `?channel=` query string). Roll new versions to a few users first, widen only if clean.
- **Telemetry**: if any is added, **Aptabase** is self-hostable + privacy-first (MIT plugin, AGPLv3 server, manual `trackEvent`). Do NOT assume it is auto-anonymous — audit every event for confidential-data leakage.

---

## 8. Verified findings + sources (research backbone)
- Slow build is **structural**: Tauri CI builds 5 targets/3 OSes; uncached ~1 hr; emulated ARM "much slower." — https://v2.tauri.app/distribute/pipelines/github/
- `swatinem/rust-cache` is the recommended baseline (already used); **sccache + remote storage** is the next level. — same; https://depot.dev/blog/sccache-in-github-actions ; https://github.com/mozilla/sccache/blob/main/docs/Rust.md
- **Cirrus Runners**: $150/mo per concurrent runner, unlimited minutes, ~15× cheaper than GitHub Mac runners; **not** a one-line swap. — https://cirrus-runners.app/
- **`mockIPC()`** tests the JS↔Rust boundary without Rust. — https://v2.tauri.app/develop/tests/mocking/
- **`tauri build --debug`** = runnable unsigned app w/ devtools; signing is a release concern. — https://v2.tauri.app/develop/debug/
- Linux E2E headless via **Xvfb**; **WebdriverIO 9.19.1+ auto-detects Xvfb**. — https://webdriver.io/docs/headless-and-xvfb/
- **macOS can't be E2E-tested with the first-party tool** — Apple ships no WKWebView WebDriver; tauri-driver covers only Windows + Linux. — https://v2.tauri.app/develop/tests/webdriver/ ; tauri#7068
- Third-party **tauri-webdriver** fills the Mac gap but is **immature** (no releases, ~25 stars, debug-only, partial). — https://github.com/danielraffel/tauri-webdriver (alt: Choochmeque/tauri-plugin-webdriver)
- AI-on-remote-box patterns confirmed (Remote Control over SSH/Tailscale; Codex Computer Use on Windows 11). — https://code.claude.com/docs/en/remote-control ; https://developers.openai.com/codex/app/computer-use
- **Sentry release health** crash-free %/alerts as a rollout gate. — https://docs.sentry.io/product/releases/health/
- **Aptabase** self-hostable privacy telemetry. — https://github.com/aptabase/tauri-plugin-aptabase
- Tauri auto-update guide = single-endpoint only; staged/canary must be built. — https://docs.crabnebula.dev/cloud/guides/auto-updates-tauri/

## 9. Disproven — do NOT rely on these
- Cirrus as a one-line drop-in replacement (0–3).
- WebdriverIO natively testing macOS Tauri (0–3).
- Aptabase being automatically anonymous/untraceable (0–3).
- Claude Code Remote Control on a *fully headless, no-display* Linux VM (unconfirmed, 1–2).

---

## 10. Recommended sequence
1. **This week ($0):** two-speed rule + `mockIPC()` + Windows-path tests on Linux + Sentry + stand up the **Legion** as the Windows bench.
2. **Wire the AI** to the Legion (run-on-the-box + a visual agent); use the **borrowed M1** for supervised Mac spot-checks (with consent). Keep a 5-min human spot-check before public release.
3. **Buy a Mac Mini (~$600–1,000)** when Mac testing becomes routine; add a dedicated Windows mini PC only if you need 24/7 autonomy.
4. **Add staged rollout gated by crash-free %** so rare real-world bugs hit a few users, not all.

This keeps the slow signed build for shipping only, and gives you (and the AI) a fast, real, three-OS test loop for everything else — at near-zero starting cost.
