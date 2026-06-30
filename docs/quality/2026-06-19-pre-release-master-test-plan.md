# Advisor Prep Hero Pre-Release Master Test Plan

_2026-06-19. **The complete checklist that must pass before cutting + publishing an official signed release.** Ties the existing test layers together with the new real-OS benches._
_Companions: `docs/operations/2026-06-19-test-bench-operations-guide.md` (how to drive the benches) · `docs/quality/full-user-test-playbook.md` · `docs/quality/2026-06-19-linux-vs-windows-coverage.md` · `docs/quality/DEFINITION_OF_DONE.md`._

> **How to read this:** §1 is the test pyramid (where each kind of test runs). §2 is the gating checklist by area. §3 is the release gate *sequence* (the order to run them). §4 is the current status + the gaps still open before a release. A release is GO only when every §2 item that applies is ✅ and the §3 sequence is complete.

---

## 1. The test pyramid (where tests run)

| Layer | What | Where | Automated? |
|---|---|---|---|
| **L0** | Unit + integration — Vitest (~3,338) + Rust `cargo test` | Linux server | ✅ auto, every change |
| **L1** | Browser E2E — Playwright on the Vite dev server (6 journeys; `scripts/run-e2e-suite.sh`) | Linux server (Chromium ≈ Windows WebView2 family) | ✅ auto |
| **L2** | Real desktop app, headless — `tauri-driver` + WebKitWebDriver + Xvfb | Linux server | ✅ auto |
| **L3 (NEW)** | Real-OS benches — build/run/test on real **Windows (Legion)** + **macOS (M1)** | The benches, server-driven | ✅ auto (GUI/keychain bits need the interactive session) |
| **L4** | Human spot-checks — the irreducible eyes-on checks | Real hardware (Jameson + the benches) | ⚠️ manual |

**Principle:** push every check as far DOWN/LEFT as it will go (cheaper, faster). Only the genuinely OS-specific or human-judgment items rise to L3/L4. Reserve the 60–90 min signed build for L4-on-a-signed-install + shipping.

---

## 2. The gating checklist (by area)

### A. Automated gates — must be green (server)
- [ ] `npm run typecheck` = 0
- [ ] `npx vitest run` = all pass (currently ~3,338)
- [ ] `cargo test` (server/Linux) = 0 failed
- [ ] `npm run i18n:check` (key parity) = clean
- [ ] ESLint = no NEW regressions vs baseline
- [ ] L1 browser suite (`scripts/run-e2e-suite.sh`, `en`) = green
- [ ] L2 desktop board (with firm backend up for `20-firm`) = pass

### B. Real-OS bench checks — Windows + macOS (L3)
- [ ] **Builds** (unsigned debug) on Windows ✅ and macOS ✅ *(done 2026-06-19)*
- [ ] `cargo test` green on the Windows bench ✅ *(469/0, done)* and the macOS bench
- [ ] App **launches + renders** correctly (Windows WebView2 ✅ screenshotted; macOS WKWebView — pending)
- [ ] **Windows file-path** behavior (backslashes, `C:\`, long paths, reserved names) — covered by `cargo test` ✅
- [ ] **OS keychain** round-trip — **must run in the interactive session** (Windows Credential Manager / macOS Keychain): API-key storage + vault key load/lock. *(SSH cannot reach the keychain — see ops guide §5.8.)*
- [ ] **Native folder picker** opens + returns a path (open/create workspace) — human or screen-driven
- [ ] **Multi-window** behavior (the separate connector window; Email-tab refresh on focus)

### C. v3.3.5 email-connector fixes — the open handoff item (needs §D taps)
- [ ] **Outlook** connects and imports
- [ ] **Gmail** connects and imports AND the mail appears in the Email tab
- [ ] The two provider panels never show each other's count/error
- [ ] The import count does not restart from 0
- [ ] The installer/uninstaller say "Advisor Prep Hero" (not "Projelli") — needs a bundle build (§F)

### D. Live connector auth — needs Jameson's hands
- [ ] **Outlook** final sign-in (hardware passkey on jamesondaines@outlook.com)
- [ ] **Gmail** consent (jamesondaines4@gmail.com; consent screen in Testing mode)

### E. Full user-test playbook (drive it like a user)
- [ ] Run `docs/quality/full-user-test-playbook.md` end-to-end (the 6 journeys) on the latest RC, incl. es/de locales — before any release candidate

### F. Installer / updater / signing (needs the signed build — L4)
- [ ] Signed build produces installers for Win (NSIS) / macOS (dmg, notarized) / Linux ✅ pipeline exists
- [ ] **Install the signed build on real Windows + Mac** and smoke-test what only a real signed install exercises: first-run, installer/uninstaller branding, **auto-updater** (`latest.json` points at the new version + an update actually applies), signed-launch (no SmartScreen/Gatekeeper block), keychain in a real install
- [ ] The Windows signed build itself (known tripwire: Unix-only shell steps in npm prebuild — keep cross-platform)

### G. Microsoft Word interop
- [ ] Open a Advisor Prep Hero-edited / co-edited `.docx` in **real Microsoft Word**; tracked changes + formatting survive

### H. Firm / collaboration (the remaining sliver)
- [ ] Two real desktop instances co-edit a shared matter; convergence + ethical-wall key-denial (logic already covered by `firm-collaboration.spec.ts` 8/8; the two-desktop-instance OS-keychain path is the sliver)

### I. Performance / stress
- [ ] Large-workspace indexing memory bounded (no OOM) — `rag_workspace_stress` ✅

### J. Security
- [ ] Path traversal + symlink-escape blocked (covered by tests)
- [ ] Prompt-injection sanitation on external content
- [ ] E2EE relay never sees plaintext (firm sync) — covered

---

## 3. The release gate SEQUENCE (order of operations)
1. **Green all automated gates (A)** on the server.
2. **Bench pass (B + C)** on Windows + macOS, including the interactive-session keychain + GUI checks.
3. **Live connectors (D)** with Jameson's taps; confirm C end-to-end.
4. **Full user-test playbook (E)** on the candidate.
5. **Cut the signed build** — *Jameson's explicit go (commercial boundary).*
6. **Signed-install smoke (F + G)** on real Windows + Mac (installer, updater, signed-launch, keychain-in-install, Word interop).
7. **Jameson's final 5-minute spot-check** on real hardware.
8. **Publish** — *Jameson's explicit go.* Then update keepance.com download links + verify the live auto-updater.

---

## 4. Status snapshot + gaps before release (as of 2026-06-19)

**Covered now:** L0/L1/L2 (server); Windows bench builds + renders + full Rust suite (469/0); macOS bench builds; file-path + stress + security automated.

**Gaps to close before an official release:**
- [ ] macOS: run + render + `cargo test` on the bench (build ✅, run/test pending)
- [ ] Interactive-session **keychain** tests on Windows + Mac (Credential Manager / Keychain)
- [ ] Native **folder picker** + **multi-window** checks on both OSes
- [ ] **Live email connectors** (Outlook + Gmail) — the v3.3.5 fixes, end-to-end (needs Jameson taps)
- [ ] **Signed-install smoke** on real Windows + Mac (installer branding, auto-updater applies, signed-launch, keychain-in-install)
- [ ] **Word `.docx` interop** in real MS Word
- [ ] Full **user-test playbook** re-run on the release candidate

**The point:** most of the pyramid is automated and green. What remains are the OS-specific, human-judgment, and signed-install items — which is exactly what the benches (B/C) + Jameson's spot-check (F/G) now make fast to clear, instead of a 60–90 min signed build per attempt.
