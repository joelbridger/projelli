# Advisor Prep Hero — Testing Index (start here)

This is the map of **everything testing-related** in Advisor Prep Hero: how we prove the app works, where each piece lives, how to run it, and where we are right now. If you're picking up testing work, read this first.

## The one-paragraph picture
We test in **layers**, cheapest first. Thousands of small automated tests run on every change (free, on the server). A headless copy of the real desktop app runs the trickier flows nightly. And — newest — **we now drive the actual desktop app on a real Windows laptop** to catch the things only real Windows can show (the Microsoft web engine, the OS keychain, real sign-ins, native file dialogs, the on-disk encrypted index, real mail). The first three layers are automated and green; the Windows-driving layer is where the active hands-on testing is happening now.

---

## The test pyramid (what runs, where, how to run it)

| Layer | What it checks | Count (approx) | Where it runs | Run it |
|---|---|---|---|---|
| **L0 — static** | TypeScript types, lint (only *new* lint fails the gate) | — | server / CI | `npm run typecheck`, `npm run lint:gate` |
| **L1 — unit/integration** | Frontend logic (Vitest), Rust logic (cargo), backend (Bun) | ~3,375 frontend · ~450 Rust · ~247 backend | server / CI | `npm test` · `cargo test` (in `src-tauri`) · `bun test` (in `backend`) |
| **L1 — browser E2E** | Whole UI in a headless browser (Playwright) | ~254 specs | server / CI | `bash scripts/run-e2e-preview.sh` (preferred) |
| **L2 — headless desktop** | The *real* Tauri app, headless on Linux (tauri-driver + Xvfb) | 12 flow specs | server | `npm run test:desktop` |
| **L3/L4 — real hardware, driven by hand** | The actual desktop app on real **Windows** (and soon Mac), driven like a user | the Windows test plan | Legion laptop | see "Driving the real Windows app" below |

**One command for the first layers:** `npm run gate` (typecheck + i18n + Vitest + lint gate + Rust) is the pre-merge check; `npm run gate:full` adds browser E2E + the headless desktop harness. A pre-push hook runs typecheck + Vitest automatically before every push.

**Continuous safety nets (automated, server-side):**
- **Nightly full run** — a timer runs the whole gate + the real-bench cargo tests every night (`scripts/nightly-tests.sh`, `scripts/nightly-bench-tests.sh`).
- **Watchdog** — a daily dead-man's-switch that checks the nightly actually ran and passed, and that cloud CI is green on the current code (`scripts/testing-watchdog.sh`). It pings Jameson "healthy" daily; silence = something broke.
- **Cloud CI** — `.github/workflows/ci.yml` runs the quality + backend + Rust jobs on every change to `master`/`keepance-3.0`. `release.yml` builds the signed installers on a version tag.

---

## Current docs (the active map)

### The plans / gates
- **[2026-06-19-pre-release-master-test-plan.md](2026-06-19-pre-release-master-test-plan.md)** — the authoritative **release gate**: the full pyramid (L0–L4), what must pass per area, and the order to run it. Read before any release.
- **[2026-06-20-windows-desktop-test-plan.md](2026-06-20-windows-desktop-test-plan.md)** — **NEW. The complete Windows-driving checklist**: every screen/feature with a status (driven-and-passing vs not), the goal being to prove the whole app bug-free on real Windows. **This is the live "what's left on Windows" tracker.**
- **[2026-06-19-linux-vs-windows-coverage.md](2026-06-19-linux-vs-windows-coverage.md)** — what the server tests cover confidently vs what genuinely needs real Windows/Mac. The "why bother with the laptop" rationale.
- **[full-user-test-playbook.md](full-user-test-playbook.md)** — the repeatable "drive it like a user" procedure (Playwright on the dev server + real keys + the core journeys). Run before any release candidate.
- **[2026-06-18-user-test/](2026-06-18-user-test/)** — the **definitive feature inventory**: ~540 user stories (`USER-STORIES.md`), per-area breakdowns (`inventory/`), the layered test plan, and the headless-desktop-harness findings. The source of truth for "what the product must do."

### The live trackers (these change as we test)
- **[2026-06-20-windows-desktop-test-plan.md](2026-06-20-windows-desktop-test-plan.md)** — coverage status per surface (flip as each is driven).
- **[2026-06-20-test-bug-backlog.md](2026-06-20-test-bug-backlog.md)** — **every bug found, with a fix plan + status.** Standing rule: no bug drops through the cracks. (Currently: BUG-001/002/005/007 fixed + the desktop ones confirmed live; **BUG-008 open** — email sync gives no feedback when stuck.)
- **[2026-06-20-real-software-test-results.md](2026-06-20-real-software-test-results.md)** — the narrative log of what was actually driven and what happened.

### Operational reference
- **[TROUBLESHOOTING_TESTS.md](TROUBLESHOOTING_TESTS.md)** — debugging a failing test, layer by layer: Vitest (jsdom polyfills, the confidentiality-mode seed, mocks, stores), Playwright (the CI quarantine, ports, cold-start timing, visual baselines), and Rust (the `REQUIRE_RAG_MODEL` skip, the cargo build lock, system deps). Read this when a test goes red.
- **[e2e-suite-batching.md](e2e-suite-batching.md)** — why the browser suite runs in shards / via a preview server (server memory pressure) and how.
- **[DEFINITION_OF_DONE.md](DEFINITION_OF_DONE.md)** — the merge bar (note: pre-3.0 branding, due a refresh).
- **Bench setup + operation:** `docs/operations/2026-06-19-test-bench-operations-guide.md` (daily use), `...-test-bench-setup-plan.md` (one-time setup), `...-ai-dev-velocity-strategy.md` (the why).
- **Driving the real desktop app:** the bring-up + gotchas live in the memory note `reference_keepance_desktop_control`; the tools are `scripts/desktop-drive.mjs` (in-app, by test-id) + `scripts/legion_agent.py` (whole-desktop: native dialogs + browser).

### Historical records (kept, not current)
These document finished work; they're not living docs. Still inside `docs/quality/` only because live test configs/scripts point at them:
- `2026-06-10-v3-usability-campaign/` (the v3.1 quality campaign; `playwright.campaign.config.ts` uses it)
- `2026-06-11-wave3a-sso/` + `2026-06-11-wedge-proof/` (one-time milestone verifications; scripts/state-docs reference them)

Fully retired docs (completed UX rounds, v1.0/v2.0 checklists, superseded Playwright notes) were moved to **`docs/archive/quality/`** on 2026-06-20.

---

## Driving the real Windows app (the new layer)
1. **Bench:** the Legion laptop (`james@100.127.67.22`) over Tailscale, running the dev build.
2. **Check it's up:** `curl localhost:9444/json/version` (the app) and `curl localhost:8766/health` (the full-desktop agent). Bring-up steps + gotchas: memory note `reference_keepance_desktop_control`.
3. **Drive in-app:** `node scripts/desktop-drive.mjs {snapshot|click <id>|type <id> "txt"|eval "<js>"|screenshot <path>|waitfor "txt"}` — targets the app's own test-ids.
4. **Drive native dialogs / browser:** `curl localhost:8766/{shot|click?x&y|type?text=|key?name=|hotkey?keys=}`.
5. **Record every result in two places:** flip the status in the Windows test plan, and log any bug (with a fix plan) in the bug backlog. Append narrative to the results doc.

---

## Where we are / what's left (2026-06-20)
- **Automated layers (L0–L2): green.** Cloud CI was silently red earlier this cycle and is now fixed; the nightly + watchdog guard it daily.
- **Windows driving (L3): the foundation + headline are proven.** Confirmed by driving the real app: the cited-answer search (the core value prop), workspace open, file tree, matter create + scope, AI keys add/verify, language, Privacy Center, Outlook connect, app stability — plus both sweep bugs (BUG-001 provider labels, BUG-007 mail sync) fixed and **confirmed live**.
- **What's left on Windows (the burn-down):** `.docx` editing + AI redline, running a workflow to output, the vault encrypt/recover cycle, email beyond connect (sync-to-completion needs a fresh Outlook sign-in — see BUG-008), the AI chat depth, settings depth, account/firm + SSO, global overlays, and the platform bits (keychain explicit, updater, OCR). The full list with status is the **Windows test plan**.
- **Mac:** same approach next, once Windows is well-exercised.

**In one line:** the test system is healthy and automated; the real-Windows hands-on layer has proven the core and is now working down the feature-by-feature checklist in the Windows test plan.
</content>
