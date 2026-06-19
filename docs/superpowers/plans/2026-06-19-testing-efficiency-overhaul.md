# Testing Efficiency & Effectiveness Overhaul — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn Keepance's already-strong-but-mostly-manual test suite into an automatic safety net that actually runs on every change, protects the expensive signed build, and closes the highest-risk coverage gaps — without slowing down day-to-day work.

**Architecture:** Three lanes. (1) **Cloud CI** (GitHub Actions) runs the fast, hermetic checks on every push to the real working branch and gates the signed-release build. (2) A **nightly server cron** (systemd --user timer on this box) runs the heavy/flaky-on-this-box suites (full browser E2E, the real-desktop harness, full Rust suite) where RAM is fresh and minutes are free, and notifies on failure. (3) **Local one-command gate** + a pre-push hook so neither a human nor an AI session has to remember the sequence. Plus targeted new tests and a post-ship crash-reporting safety net.

**Tech Stack:** GitHub Actions (YAML), Vitest, Rust `cargo`, Playwright, `tauri-driver`+Xvfb desktop harness, Bun (firm backend), systemd --user timers, `notify-jameson` CLI, ESLint, Sentry (Tauri plugin).

---

## Context for a fresh session (read this first — it IS the analysis)

You are picking up a testing-infrastructure overhaul. **Keepance's test material is genuinely strong** (do not rip anything out): ~3,460 Vitest cases, ~672 Rust `cargo` tests, ~345 Playwright browser tests, ~159 visual "campaign" tests, ~210 Bun backend tests, a custom "drive the real desktop app" harness (`tests/desktop/`, 12 specs), security tests, and an architecture-boundary guard. Conventions are good (1,115 `data-testid`s; `getByTestId` only; no `waitForTimeout`).

**The problem is that almost none of it runs automatically.** The evaluation found:

1. **CI watches the wrong branch.** `.github/workflows/ci.yml` triggers only on `pull_request` and `push` to `master`. All real work lands directly on `keepance-3.0`. So CI effectively **never runs**. *(Highest-impact, smallest fix.)*
2. **CI never runs the Rust engine tests** — the docx/vault/email/**encryption** code (most data-loss/leak-sensitive code in the product) has the *weakest* automatic gate. It runs only when an agent remembers `cargo test` by hand.
3. **The 60–90 min signed release build runs ZERO tests first** (`release.yml` goes checkout → build → sign → upload). A typo can burn an hour and signing budget.
4. **ESLint is wired to always pass** (`|| true`), so it's decoration, not a gate (baseline: 1362 errors / 468 warnings).
5. **A dead, stale duplicate** of the workflows lives in `.github/workflows_temp/` (references a non-existent action) — confusing noise.
6. **Everything beyond the 3 fast checks is manual:** cargo, Playwright (L1), the desktop harness (L2), backend Bun tests, live email smokes. Confidence rides on "did the AI session remember and have time."
7. **The browser suite can't run in one shot on this box** — memory pressure falsely fails ~42 tail tests, so it's run in 6 shards (`scripts/run-e2e-suite.sh`). A recurring tax; root cause is this server being memory-tight.
8. **No coverage measurement** — "3,460 tests" is a count, not a measured guarantee.

The two-speed + real-OS-bench strategy written 2026-06-19 (`docs/operations/2026-06-19-ai-dev-velocity-strategy.md`, `docs/quality/2026-06-19-pre-release-master-test-plan.md`) is correct and complementary — **this plan does not replace it; it automates the gate it describes.** Jameson wants ALL of the below implemented.

**Audience note:** Jameson is a product designer, NOT an engineer. Any progress notes or `notify-jameson` messages must be in plain language (explain like he's 16; define any technical term once). The code/commits can be normal engineering.

---

## Global Constraints

- **Active branch is `keepance-3.0`.** Branch new work off it; merge back to it. Do NOT assume `master`.
- **GitHub work is autonomous** (branch/commit/merge/PR per `~/.claude/CLAUDE.md`). **Do NOT deploy or publish a release** — building/publishing the signed app needs Jameson's explicit go (commercial boundary). CI/cron/test config changes are NOT deploys; do them freely.
- **Confidential-data product.** Anything that sends data off the machine (Sentry, telemetry) must scrub ALL personal data and document/email **content** — never transmit user content. Default to opt-in where reasonable.
- **Keep the existing test material green.** Net-new gating only; don't delete passing tests.
- **No new heavyweight deps without need.** Prefer a committed git hook over adding `husky` unless the team already wants it.
- **Commit messages** end with: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- **Reusable Rust-on-CI recipe** (copied from `release.yml`, use verbatim where a job needs Rust):
  - toolchain: `dtolnay/rust-toolchain@stable`
  - cache: `swatinem/rust-cache@v2` with `workspaces: './src-tauri -> target'`
  - protoc: `sudo apt-get update && sudo apt-get install -y protobuf-compiler`
  - webkit/Linux deps: `sudo apt-get install -y libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf libssl-dev libfuse2`
- **Cargo workspace** = `src-tauri` with members `.`, `crates/keepance-docx`, `crates/keepance-vault`. Run Rust tests with `--manifest-path src-tauri/Cargo.toml`. `#[ignore]`d tests (live smokes, model download, heavy stress) are skipped by default — keep them out of CI; they belong to the nightly job / manual runs.

---

## Phases (suggested order; each phase ships value on its own)

- **Phase 1 — Make the cloud guard real** (Tasks 1–4): biggest payoff, smallest effort.
- **Phase 2 — Protect the expensive build** (Task 5).
- **Phase 3 — One command + local enforcement** (Tasks 6–7).
- **Phase 4 — Heavy suites run automatically every night on the server** (Task 8).
- **Phase 5 — Kill the browser-suite memory tax at the root** (Task 9).
- **Phase 6 — Coverage visibility** (Task 10).
- **Phase 7 — Close the named coverage gaps** (Tasks 11–13).
- **Phase 8 — Post-ship safety net** (Tasks 14–15) — bigger; privacy-sensitive; do last.

> Phases 1–6 are infrastructure: the "test" for each is *run the command / trigger the workflow and observe the expected output*. Phase 7 is real TDD (write failing test → implement). Phase 8 is feature work with strict privacy guardrails.

---

## Phase 1 — Make the cloud guard real

### Task 1: Point CI at the working branch

**Files:**
- Modify: `.github/workflows/ci.yml:15-19` (the `on:` block)

**Why (plain):** the automatic checker is set to wake up only for a branch nobody uses. Wake it up for the branch we actually work on.

- [ ] **Step 1:** Edit the trigger block so it also fires on `keepance-3.0`:

```yaml
on:
  pull_request:
  push:
    branches:
      - master
      - keepance-3.0
```

- [ ] **Step 2: Verify the YAML parses.** Run:

```bash
cd ~/keepance && python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/ci.yml')); print('ci.yml OK')"
```
Expected: `ci.yml OK`

- [ ] **Step 3: Commit.**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: run CI on keepance-3.0 (the active branch), not just master"
```

- [ ] **Step 4: Confirm it actually fires.** After this branch's work is pushed, check the run exists:

```bash
gh run list --branch keepance-3.0 --limit 3
```
Expected: a `CI` run listed for the latest push (status queued/in_progress/completed).

---

### Task 2: Add the Rust engine tests to CI

**Files:**
- Modify: `.github/workflows/ci.yml` (add a second job `rust` alongside `quality`)

**Why (plain):** the most sensitive code (files, email, encryption) currently has no automatic check. Give it one on every push. Caching makes it fast after the first run.

**Interfaces:** Produces nothing other tasks consume; it's a standalone CI job.

- [ ] **Step 1: Add a `rust` job** to `.github/workflows/ci.yml` (append under `jobs:`, sibling to `quality`):

```yaml
  rust:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Install Rust
        uses: dtolnay/rust-toolchain@stable
      - name: Cache Rust
        uses: swatinem/rust-cache@v2
        with:
          workspaces: './src-tauri -> target'
      - name: Install protoc
        run: |
          sudo apt-get update
          sudo apt-get install -y protobuf-compiler
      - name: Install Linux/webkit deps
        run: sudo apt-get install -y libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf libssl-dev libfuse2
      - name: Build sidecar dep stubs (protoc available)
        run: protoc --version
      - name: cargo test (hermetic; ignored/live/stress tests excluded by default)
        working-directory: ./src-tauri
        env:
          CI: '1'
        run: cargo test --workspace --locked
```

- [ ] **Step 2: Smoke the exact command locally first** (so CI isn't the first place it runs). Run:

```bash
cd ~/keepance/src-tauri && CI=1 cargo test --workspace --locked 2>&1 | tail -30
```
Expected: all run tests pass, ignored ones reported as `ignored`, `0 failed`.

- [ ] **Step 3: Handle any network/model-download test that escapes `#[ignore]`.** If Step 2 fails because a test tries to download a model or hit the network (e.g. an embedder), add `#[ignore]` to that specific test with a comment `// network/model — runs in nightly server job, not CI` and re-run Step 2. (The full version of that test still runs in Task 8's nightly job.)

- [ ] **Step 4: Verify YAML parses** (same command as Task 1 Step 2).

- [ ] **Step 5: Commit.**

```bash
git add .github/workflows/ci.yml src-tauri
git commit -m "ci: run the Rust engine test suite (most data-sensitive code) on every push"
```

---

### Task 3: Make ESLint an honest gate (fail on NEW errors)

**Files:**
- Create: `scripts/eslint-gate.mjs`
- Create: `.eslint-baseline.json`
- Modify: `.github/workflows/ci.yml` (replace the `|| true` ESLint step)
- Modify: `package.json` (add a `lint:gate` script)

**Why (plain):** the style/quality checker is currently set to "always pass," so it never catches anything. There are 1,362 old issues we won't fix today — but we CAN stop the number from ever going UP. The gate fails only if a change *adds* new problems.

- [ ] **Step 1: Write the gate script** `scripts/eslint-gate.mjs`:

```js
#!/usr/bin/env node
// Fails if the ESLint error/warning counts exceed the committed baseline.
// Lets the large pre-existing baseline stand while preventing NEW regressions.
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const baselinePath = new URL('../.eslint-baseline.json', import.meta.url);
const writeMode = process.argv.includes('--update-baseline');

let raw = '[]';
try {
  raw = execSync('npx eslint src/ -f json', { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
} catch (e) {
  // ESLint exits non-zero when there are errors; the JSON is still on stdout.
  raw = e.stdout?.toString() || '[]';
}
const results = JSON.parse(raw);
const errors = results.reduce((n, f) => n + f.errorCount, 0);
const warnings = results.reduce((n, f) => n + f.warningCount, 0);
const current = { errors, warnings };

if (writeMode) {
  writeFileSync(baselinePath, JSON.stringify(current, null, 2) + '\n');
  console.log('Baseline updated:', current);
  process.exit(0);
}

const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
console.log('ESLint current:', current, ' baseline:', baseline);
if (errors > baseline.errors || warnings > baseline.warnings) {
  console.error(`\n❌ ESLint regressed. errors ${baseline.errors}→${errors}, warnings ${baseline.warnings}→${warnings}.`);
  console.error('Fix the new findings, or if intentional run: npm run lint:gate -- --update-baseline');
  process.exit(1);
}
console.log('✅ No ESLint regression vs baseline.');
```

- [ ] **Step 2: Generate the baseline from the current state.** Run:

```bash
cd ~/keepance && node scripts/eslint-gate.mjs --update-baseline && cat .eslint-baseline.json
```
Expected: `.eslint-baseline.json` written, e.g. `{ "errors": 1362, "warnings": 468 }` (use whatever the real numbers are).

- [ ] **Step 3: Add the npm script** to `package.json` `scripts`:

```json
    "lint:gate": "node scripts/eslint-gate.mjs",
```

- [ ] **Step 4: Replace the ESLint step** in `.github/workflows/ci.yml` (the step currently ending in `|| true`) with:

```yaml
      - name: ESLint regression gate (fails only on NEW errors/warnings)
        run: npm run lint:gate
```
Also delete the now-stale `|| true` explanatory comment block above the old step.

- [ ] **Step 5: Verify the gate passes on a clean tree.** Run:

```bash
cd ~/keepance && npm run lint:gate
```
Expected: `✅ No ESLint regression vs baseline.`

- [ ] **Step 6: Commit.**

```bash
git add scripts/eslint-gate.mjs .eslint-baseline.json package.json .github/workflows/ci.yml
git commit -m "ci: turn ESLint into a real regression gate (no new errors past baseline)"
```

> Stretch (optional, separate later effort, NOT required now): burn the 1,362-error baseline down to 0, then change the gate to `npx eslint src/ --max-warnings=0`. Out of scope here.

---

### Task 4: Delete the dead duplicate workflows

**Files:**
- Delete: `.github/workflows_temp/` (entire directory)

**Why (plain):** there's an old, broken second copy of the CI files that GitHub never reads. It only causes confusion.

- [ ] **Step 1: Confirm it's not referenced anywhere.** Run:

```bash
cd ~/keepance && grep -rn "workflows_temp" . --exclude-dir=node_modules --exclude-dir=.git || echo "no references"
```
Expected: `no references` (if there ARE references, resolve them before deleting).

- [ ] **Step 2: Delete and commit.**

```bash
cd ~/keepance && git rm -r .github/workflows_temp
git commit -m "ci: remove dead/stale duplicate workflows (workflows_temp was never run)"
```

---

## Phase 2 — Protect the expensive build

### Task 5: Gate the signed release build on green checks

**Files:**
- Modify: `.github/workflows/release.yml` (add a `gate` job; add `needs: gate` to the build jobs)

**Why (plain):** the 60–90 minute build-and-sign should refuse to start if the basic checks are failing. Cheap insurance on the slowest, most expensive step.

**Interfaces:** Produces a `gate` job that `build` and `build-windows` depend on. `finalize-updater-manifest` already `needs: [build, build-windows]`, so it inherits the gate transitively.

- [ ] **Step 1: Add a `gate` job** at the top of `jobs:` in `.github/workflows/release.yml`:

```yaml
  gate:
    name: Pre-release gate (must be green before any build)
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20', cache: 'npm' }
      - run: npm ci
      - name: TypeScript
        run: npx tsc --noEmit
      - name: i18n key parity
        run: npm run i18n:check
      - name: Unit tests
        run: npm test -- --run
      - name: ESLint regression gate
        run: npm run lint:gate
      - name: Install Rust
        uses: dtolnay/rust-toolchain@stable
      - name: Cache Rust
        uses: swatinem/rust-cache@v2
        with: { workspaces: './src-tauri -> target' }
      - name: protoc + webkit deps
        run: |
          sudo apt-get update
          sudo apt-get install -y protobuf-compiler libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf libssl-dev libfuse2
      - name: Rust tests
        working-directory: ./src-tauri
        env: { CI: '1' }
        run: cargo test --workspace --locked
```

- [ ] **Step 2: Make the build jobs depend on it.** Add `needs: gate` to the `build` job and the `build-windows` job (place it next to each job's existing `permissions:`/`runs-on:` keys). Example for `build`:

```yaml
  build:
    needs: gate
    permissions:
      # ...unchanged...
```
Do the same for `build-windows`.

- [ ] **Step 3: Verify YAML parses.** Run:

```bash
cd ~/keepance && python3 -c "import yaml; yaml.safe_load(open('.github/workflows/release.yml')); print('release.yml OK')"
```
Expected: `release.yml OK`

- [ ] **Step 4: Sanity-check the job graph** (no typo in `needs`):

```bash
cd ~/keepance && grep -nE "^  [a-z-]+:$|needs:" .github/workflows/release.yml
```
Expected: `gate:`, `build:` + `needs: gate`, `build-windows:` + `needs: gate`, `finalize-updater-manifest:` + `needs: [build, build-windows]`.

- [ ] **Step 5: Commit.**

```bash
git add .github/workflows/release.yml
git commit -m "ci(release): gate the signed multi-OS build on typecheck+vitest+cargo+lint+i18n"
```

> Do NOT trigger a release to test this (that's the commercial-boundary deploy). The YAML parse + graph check is the verification here.

---

## Phase 3 — One command + local enforcement

### Task 6: One command that runs the whole gate in order

**Files:**
- Create: `scripts/gate.sh`
- Modify: `package.json` (add `gate` and `gate:full` scripts)

**Why (plain):** so no human and no AI session ever has to remember the seven-step checklist. One command runs it all in the right order and stops at the first failure.

- [ ] **Step 1: Write `scripts/gate.sh`:**

```bash
#!/usr/bin/env bash
# scripts/gate.sh — the canonical pre-merge / pre-release gate, in order.
# Usage:
#   scripts/gate.sh         # fast gate: typecheck + i18n + vitest + lint + cargo
#   scripts/gate.sh --full  # also runs L1 browser suite + L2 desktop harness (slow; for nightly/release)
set -uo pipefail
cd "$(dirname "$0")/.."
FULL=0; [ "${1:-}" = "--full" ] && FULL=1
fail=0
step () { echo ""; echo "===== $1 ====="; shift; "$@" || { echo "❌ FAILED: $*"; fail=1; }; }

step "TypeScript"      npm run typecheck
step "i18n key parity" npm run i18n:check
step "Unit tests"      npx vitest run
step "ESLint gate"     npm run lint:gate
step "Rust tests"      bash -c "cd src-tauri && CI=1 cargo test --workspace --locked"

if [ "$FULL" -eq 1 ]; then
  step "L1 browser E2E (sharded)" ./scripts/run-e2e-suite.sh en 6
  step "L2 desktop harness"       npm run test:desktop
fi

echo ""
[ "$fail" -eq 0 ] && echo "✅ GATE GREEN" || echo "❌ GATE RED — see failures above"
exit "$fail"
```

- [ ] **Step 2: Make it executable and add npm scripts.** Run `chmod +x scripts/gate.sh`, then add to `package.json` `scripts`:

```json
    "gate": "bash scripts/gate.sh",
    "gate:full": "bash scripts/gate.sh --full",
```

- [ ] **Step 3: Run the fast gate to verify it works end to end.** Run:

```bash
cd ~/keepance && npm run gate
```
Expected: each step prints, ends with `✅ GATE GREEN`. (If a real failure surfaces, that's the gate doing its job — fix or report it.)

- [ ] **Step 4: Commit.**

```bash
git add scripts/gate.sh package.json
git commit -m "test: add one-command gate (npm run gate / gate:full) running the full checklist in order"
```

---

### Task 7: Pre-push hook so the gate can't be skipped by accident

**Files:**
- Create: `.githooks/pre-push`
- Create: `scripts/install-git-hooks.sh`
- Modify: `package.json` (add a `postinstall`/`prepare` to auto-install the hook), and document in `CLAUDE.md`

**Why (plain):** runs the FAST checks automatically right before code is pushed, so broken code can't leave the machine. Kept fast (typecheck + unit tests) so it's not annoying; the heavy stuff stays in CI/nightly.

**Approach:** a committed hook + `core.hooksPath` (no new dependency like husky).

- [ ] **Step 1: Write `.githooks/pre-push`:**

```bash
#!/usr/bin/env bash
# Fast pre-push gate. Skip with: git push --no-verify (use sparingly).
set -uo pipefail
echo "pre-push: fast gate (typecheck + unit tests)…"
npm run typecheck || { echo "❌ typecheck failed — push blocked"; exit 1; }
npx vitest run    || { echo "❌ unit tests failed — push blocked"; exit 1; }
echo "✅ fast gate passed"
```

- [ ] **Step 2: Write `scripts/install-git-hooks.sh`:**

```bash
#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
chmod +x .githooks/* 2>/dev/null || true
git config core.hooksPath .githooks
echo "✅ git hooks installed (core.hooksPath=.githooks)"
```

- [ ] **Step 3: Wire auto-install + make executable.** Run `chmod +x .githooks/pre-push scripts/install-git-hooks.sh`, then add to `package.json` `scripts`:

```json
    "prepare": "bash scripts/install-git-hooks.sh || true",
```

- [ ] **Step 4: Install the hook now and verify it's wired.** Run:

```bash
cd ~/keepance && bash scripts/install-git-hooks.sh && git config --get core.hooksPath
```
Expected: `✅ git hooks installed` then `.githooks`.

- [ ] **Step 5: Document the bypass.** Add one line under the testing section of `CLAUDE.md`: "A pre-push hook runs typecheck + unit tests; bypass for docs-only pushes with `git push --no-verify`."

- [ ] **Step 6: Commit.**

```bash
git add .githooks scripts/install-git-hooks.sh package.json CLAUDE.md
git commit -m "test: fast pre-push hook (typecheck+vitest) via core.hooksPath, auto-installed on npm install"
```

---

## Phase 4 — Heavy suites run automatically every night (on the server)

### Task 8: Nightly full-gate server timer with failure notification

**Files:**
- Create: `scripts/nightly-tests.sh`
- Create: `~/.config/systemd/user/keepance-nightly-tests.service`
- Create: `~/.config/systemd/user/keepance-nightly-tests.timer`

**Why (plain):** the heavy tests (full browser suite, the real-desktop harness, the full Rust suite) are too slow/flaky to run on every push on GitHub's machines, but they're our best bug-catchers. Run them automatically every night on this server (free, plenty of time) and text Jameson only if something breaks. This is modeled on the existing `held-backup.timer`.

**Note:** the desktop harness (L2) needs a built debug binary + Xvfb + an unlocked keyring; `tests/desktop/run.sh` already sets up Xvfb/dbus/keyring per spec, but the binary must exist first.

- [ ] **Step 1: Write `scripts/nightly-tests.sh`:**

```bash
#!/usr/bin/env bash
# Nightly full test gate. Runs on the server via systemd --user timer.
# Notifies Jameson (plain language) ONLY on failure.
set -uo pipefail
cd "$HOME/keepance"
LOG="/tmp/keepance-nightly-tests-$(date +%Y%m%d).log"
exec > >(tee "$LOG") 2>&1

echo "=== Keepance nightly tests $(date -u) on branch $(git rev-parse --abbrev-ref HEAD) ==="
git pull --ff-only origin keepance-3.0 || echo "(pull skipped/failed — testing local tree)"

fail=0
run () { echo ""; echo "##### $1 #####"; shift; "$@" || { echo "FAILED: $*"; fail=1; }; }

# Build the debug desktop binary the L2 harness needs.
run "build debug binary" bash -c "cd src-tauri && cargo build --workspace"
run "full Rust suite (incl. integration)" bash -c "cd src-tauri && cargo test --workspace"
run "Vitest (full)"        npx vitest run
run "Backend Bun tests"    bash -c "cd backend && bun test"
run "L1 browser E2E"       ./scripts/run-e2e-suite.sh en 6
run "L2 desktop harness"   npm run test:desktop

echo ""
if [ "$fail" -ne 0 ]; then
  echo "RESULT: FAIL"
  notify-jameson \
    --subject "[Keepance] NEED YOU: nightly tests failed" \
    --body "Project: Keepance (~/keepance, branch keepance-3.0)
Task: Automatic nightly test run on the server
Result: One or more test groups failed. Full log: $LOG
Next: A Claude session should read the log and fix the failing tests." \
    --level critical --channel email,telegram || true
  exit 1
fi
echo "RESULT: PASS"
exit 0
```

- [ ] **Step 2:** `chmod +x scripts/nightly-tests.sh` and commit it:

```bash
cd ~/keepance && chmod +x scripts/nightly-tests.sh
git add scripts/nightly-tests.sh
git commit -m "test: nightly full-gate runner (cargo+vitest+bun+L1+L2) with failure notify"
```

- [ ] **Step 3: Write the systemd service** `~/.config/systemd/user/keepance-nightly-tests.service` (NOT in the repo — server config):

```ini
[Unit]
Description=Keepance nightly full test gate

[Service]
Type=oneshot
ExecStart=/bin/bash %h/keepance/scripts/nightly-tests.sh
# Generous: full Rust build + E2E can take a while on this box.
TimeoutStartSec=7200
```

- [ ] **Step 4: Write the timer** `~/.config/systemd/user/keepance-nightly-tests.timer`:

```ini
[Unit]
Description=Run Keepance nightly tests at 03:30 UTC

[Timer]
OnCalendar=*-*-* 03:30:00
Persistent=true

[Install]
WantedBy=timers.target
```

- [ ] **Step 5: Enable it** (and ensure the user lingers so it runs while logged out — other timers already run, so linger is likely on):

```bash
loginctl enable-linger "$USER" 2>/dev/null || true
systemctl --user daemon-reload
systemctl --user enable --now keepance-nightly-tests.timer
systemctl --user list-timers --all | grep keepance
```
Expected: `keepance-nightly-tests.timer` listed with a NEXT time of tonight 03:30 UTC.

- [ ] **Step 6: Do a real dry run now** (don't wait for tonight) to prove the script works on this box:

```bash
systemctl --user start keepance-nightly-tests.service
journalctl --user -u keepance-nightly-tests.service -n 40 --no-pager
```
Expected: the run completes; log ends with `RESULT: PASS` (or a real failure to fix). If L2 fails for infra reasons (BLOCKED), note it — `run.sh` treats BLOCKED as non-fatal.

---

## Phase 5 — Kill the browser-suite memory tax at the root

### Task 9: Run Playwright L1 against a built preview server (remove the sharding need)

**Files:**
- Create: `vite.config.e2e.ts` (a preview-time config that reproduces the dev `/api/*` proxies)
- Modify: `playwright.config.ts` (point `webServer` at the preview build for a new `e2e-preview` path; keep the dev path working)
- Modify/Create: `scripts/run-e2e-suite.sh` is kept as the fallback; add `scripts/run-e2e-preview.sh`

**Why (plain):** the browser tests have to run in 6 small batches because this server runs low on memory while compiling the app on the fly during the test. If we test against a **pre-built** copy instead (compiled once, then just served), the memory spikes disappear and the whole suite can run in one clean pass. The one tricky part: the dev server quietly forwards AI calls to Anthropic/OpenAI/Google to avoid browser security blocks; the built server must do the same.

> **Effort honesty:** this is the largest single task. If it proves fiddly, the acceptable fallback is to keep `run-e2e-suite.sh` (sharded) but run it in the nightly job (Task 8) where RAM is fresh — that already removes the day-to-day pain. Treat the preview-server path as the preferred fix and the sharded runner as the safety net.

- [ ] **Step 1: Find the dev proxy config to reproduce.** Run:

```bash
cd ~/keepance && grep -nE "proxy|/api/|anthropic|openai|google" vite.config.ts
```
Read the `server.proxy` block; that's exactly what the preview server must replicate.

- [ ] **Step 2: Create `vite.config.e2e.ts`** that builds normally but adds a tiny preview-time proxy plugin mirroring the dev `/api/*` routes. Use the proxy targets you found in Step 1 (Anthropic `https://api.anthropic.com`, OpenAI `https://api.openai.com`, Google `https://generativelanguage.googleapis.com` — confirm against Step 1):

```ts
import { defineConfig } from 'vite';
import baseConfig from './vite.config';

// Preview-server proxy plugin: `vite preview` ignores server.proxy, so add it
// via configurePreviewServer. Mirrors the dev /api/* routes the E2E specs use.
function previewApiProxy() {
  const { createProxyMiddleware } = require('http-proxy-middleware');
  const routes = {
    '/api/anthropic': 'https://api.anthropic.com',
    '/api/openai': 'https://api.openai.com',
    '/api/google': 'https://generativelanguage.googleapis.com',
  };
  return {
    name: 'preview-api-proxy',
    configurePreviewServer(server: any) {
      for (const [path, target] of Object.entries(routes)) {
        server.middlewares.use(
          path,
          createProxyMiddleware({ target, changeOrigin: true, pathRewrite: { [`^${path}`]: '' } })
        );
      }
    },
  };
}

export default defineConfig({
  ...baseConfig,
  plugins: [...(baseConfig as any).plugins, previewApiProxy()],
});
```
(If `http-proxy-middleware` isn't already a dep, `npm i -D http-proxy-middleware`. Confirm the exact proxy targets/paths from Step 1 and adjust — do not guess them.)

- [ ] **Step 3: Add `scripts/run-e2e-preview.sh`:**

```bash
#!/usr/bin/env bash
# Build once, serve the static build, run the FULL Playwright suite in one pass.
set -uo pipefail
cd "$(dirname "$0")/.."
PROJECT="${1:-en}"
echo "Building app for E2E (config: vite.config.e2e.ts)…"
npx vite build --config vite.config.e2e.ts
echo "Starting preview server on :4173…"
npx vite preview --config vite.config.e2e.ts --port 4173 >/tmp/keepance-e2e-preview.log 2>&1 &
PREVIEW_PID=$!
trap 'kill $PREVIEW_PID 2>/dev/null || true' EXIT
for _ in $(seq 1 60); do curl -sf http://localhost:4173 >/dev/null 2>&1 && break; sleep 1; done
E2E_BASE_URL=http://localhost:4173 npx playwright test --project="$PROJECT" --reporter=line
```

- [ ] **Step 4: Teach `playwright.config.ts` to honor `E2E_BASE_URL`.** Where `use.baseURL` and `webServer` are set, make `baseURL` read `process.env.E2E_BASE_URL ?? 'http://localhost:5173'`, and skip auto-starting the dev `webServer` when `E2E_BASE_URL` is set (the preview script manages its own server). Keep the existing dev behavior as the default when the env var is absent.

- [ ] **Step 5: Verify the full suite runs in ONE pass against preview.** Run:

```bash
cd ~/keepance && chmod +x scripts/run-e2e-preview.sh && ./scripts/run-e2e-preview.sh en 2>&1 | tail -25
```
Expected: a single Playwright run with **0 of the ~42 tail timeouts**; all (or the same intentional skips) green. If memory is still an issue, fall back to the sharded runner in nightly and record that in `docs/quality/e2e-suite-batching.md`.

- [ ] **Step 6: If green, point the nightly job (Task 8) at the preview runner** — change that one line in `scripts/nightly-tests.sh` from `./scripts/run-e2e-suite.sh en 6` to `./scripts/run-e2e-preview.sh en`. Re-run the Task 8 Step 6 dry run.

- [ ] **Step 7: Update `docs/quality/e2e-suite-batching.md`** to note the preview-server runner is now the primary path (it was listed there as the "future option, not done") and the sharded runner is the fallback.

- [ ] **Step 8: Commit.**

```bash
git add vite.config.e2e.ts playwright.config.ts scripts/run-e2e-preview.sh scripts/nightly-tests.sh docs/quality/e2e-suite-batching.md package.json package-lock.json
git commit -m "test(e2e): run full browser suite against a built preview server (kills the memory-pressure sharding)"
```

---

## Phase 6 — Coverage visibility

### Task 10: Measure coverage and floor it so it can't silently rot

**Files:**
- Modify: `vitest.config.ts` (add `coverage.thresholds`)
- Modify: `.github/workflows/ci.yml` (run coverage, upload the HTML report as an artifact)

**Why (plain):** "3,460 tests" is a count, not proof. Coverage measures how much of the code the tests actually touch. We measure it, then set a floor so a future change can't quietly drop it.

- [ ] **Step 1: Measure the current coverage** to choose a realistic floor. Run:

```bash
cd ~/keepance && npx vitest run --coverage 2>&1 | tail -20
```
Note the overall `% Lines` / `% Statements` / `% Functions` / `% Branches`.

- [ ] **Step 2: Set thresholds just below current** (so it passes today and only fails on a real drop). In `vitest.config.ts`, inside the `coverage` block, add (replace the example numbers with ~2–3 points below your Step 1 readings):

```ts
      thresholds: {
        lines: 70,
        functions: 70,
        statements: 70,
        branches: 60,
      },
```

- [ ] **Step 3: Verify the threshold passes on the current tree.** Run:

```bash
cd ~/keepance && npx vitest run --coverage 2>&1 | tail -5
```
Expected: exit 0 (no "coverage threshold not met" error). If it fails, lower the floor to just under the measured value.

- [ ] **Step 4: Add a coverage job/step to CI** in `.github/workflows/ci.yml` (add to the `quality` job after unit tests, or as a step that replaces the plain unit-test run):

```yaml
      - name: Unit tests with coverage (enforces thresholds)
        run: npm run test:coverage
      - name: Upload coverage report
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: coverage-html
          path: coverage/
          retention-days: 14
```
(Remove the old plain `npm test -- --run` step so tests aren't run twice.)

- [ ] **Step 5: Commit.**

```bash
git add vitest.config.ts .github/workflows/ci.yml
git commit -m "test: enforce a coverage floor in CI + publish the coverage report"
```

---

## Phase 7 — Close the named coverage gaps (real TDD)

> These three are from the 2026-06-19 strategy doc's "quick wins." Each is real test code: write the failing test first, then make it pass.

### Task 11: `mockIPC()` tests for the JS↔Rust boundary

**Files:**
- Create: `tests/unit/ipc/<command-area>.mockipc.test.ts` (one file per command area you cover; start with the highest-risk: keychain + fs)

**Why (plain):** the front end talks to the Rust engine through named "commands" (like an internal phone line). Today we test each side separately but not the wiring of the call. Tauri's `mockIPC()` lets us fake the Rust side in a fast JS test and verify the front end sends the right call and handles the reply — in seconds, no Rust build.

- [ ] **Step 1: Find the real command names + the front-end wrapper that invokes them.** Run:

```bash
cd ~/keepance && grep -rnE "invoke\(['\"]" src/ | grep -oE "invoke\(['\"][a-z_]+" | sort -u | head -40
```
Pick the highest-risk ones first (keychain store/get, fs read/write/move). Read the wrapper that calls `invoke(...)` for one of them.

- [ ] **Step 2: Write a failing test** using `@tauri-apps/api/mocks` `mockIPC`. Adapt names to what you found in Step 1 (this is a template — replace `storeApiKey` / `store_api_key` with the real wrapper + command):

```ts
import { describe, it, expect, afterEach, vi } from 'vitest';
import { mockIPC, clearMocks } from '@tauri-apps/api/mocks';
import { storeApiKey } from '@/platform/providers/KeychainService'; // adjust to real path

afterEach(() => clearMocks());

describe('IPC: keychain store_api_key', () => {
  it('sends the right command + args and returns the Rust reply', async () => {
    const seen: { cmd: string; args: unknown }[] = [];
    mockIPC((cmd, args) => {
      seen.push({ cmd, args });
      if (cmd === 'store_api_key') return true; // fake Rust success
      throw new Error(`unexpected command ${cmd}`);
    });
    const ok = await storeApiKey('anthropic', 'sk-test-123');
    expect(ok).toBe(true);
    expect(seen).toContainEqual({ cmd: 'store_api_key', args: { provider: 'anthropic', key: 'sk-test-123' } });
  });
});
```

- [ ] **Step 3: Run it, expect FAIL** (wrong command name / args mismatch / import path) until aligned with the real code:

```bash
cd ~/keepance && npx vitest run tests/unit/ipc/ 2>&1 | tail -15
```

- [ ] **Step 4: Fix the test to match the real wrapper** (correct import path, command string, and arg shape — read the source, don't guess). Re-run until PASS.

- [ ] **Step 5: Repeat for fs read/write/move** (a second `describe`/file), same pattern.

- [ ] **Step 6: Commit.**

```bash
git add tests/unit/ipc
git commit -m "test(ipc): mockIPC coverage for keychain + fs JS↔Rust boundary"
```

---

### Task 12: Windows-style path tests on Linux

**Files:**
- Find the path-handling code first; add tests next to the existing path tests.

**Why (plain):** a lot of Windows-only bugs are about file paths (backslashes, `C:\`, very long paths, reserved names like `CON`/`NUL`). We can catch most of them on Linux by feeding those shapes into the path code directly. Some hardening already landed (commit `508b5d7`); this extends it.

- [ ] **Step 1: Locate existing path validation + its tests.** Run:

```bash
cd ~/keepance && grep -rniE "PathValidator|reserved|backslash|\\\\\\\\|long path" src/ src-tauri/src tests/ | grep -vi node_modules | head -25
```

- [ ] **Step 2: Write failing tests** (in whichever layer owns the logic — likely a Rust test in `src-tauri/src/commands/fs.rs` and/or a TS test for `PathValidator`). Cover: a `C:\Users\x\file.docx` style absolute path, backslash separators, a >260-char path, and reserved names `CON`, `NUL`, `PRN`, `AUX`, `COM1`. Assert the code normalizes or rejects each per the intended behavior (read the existing rules to decide expected outcomes).

- [ ] **Step 3: Run, expect FAIL** for any case not yet handled:

```bash
cd ~/keepance/src-tauri && cargo test fs:: 2>&1 | tail -20   # and/or: cd ~/keepance && npx vitest run PathValidator
```

- [ ] **Step 4: Implement the minimal handling** for any failing case (normalize backslashes, reject reserved names on the Windows path, bound length). Re-run to PASS.

- [ ] **Step 5: Commit.**

```bash
git add -A
git commit -m "test(fs): Windows-style path cases (backslash, C:\\, long paths, reserved names) verified on Linux"
```

---

### Task 13: Upgrade WebdriverIO to 9.19.1+ (auto-Xvfb)

**Files:**
- Modify: `package.json` (the `webdriverio` / `@wdio/*` dep versions) + `package-lock.json`
- Possibly simplify: `tests/desktop/run.sh` (Xvfb handling) if the upgrade auto-detects it.

**Why (plain):** a newer version of the desktop-test driver detects the headless display automatically, which simplifies the rig and removes manual setup steps.

- [ ] **Step 1: Check current versions.** Run:

```bash
cd ~/keepance && grep -iE "webdriverio|@wdio" package.json && npx wdio --version 2>/dev/null || true
```

- [ ] **Step 2: Upgrade.** Run (adjust package names to what Step 1 shows):

```bash
cd ~/keepance && npm i -D webdriverio@^9.19.1 @wdio/cli@^9.19.1 2>&1 | tail -5
```
(If the desktop harness uses `tauri-driver` directly rather than WDIO, confirm whether WDIO is even a dependency; if it isn't, this task is N/A — record that and skip.)

- [ ] **Step 3: Re-run the desktop harness** to confirm nothing broke:

```bash
cd ~/keepance && npm run test:desktop 2>&1 | tail -20
```
Expected: same pass/BLOCKED results as before the upgrade.

- [ ] **Step 4: If the upgrade makes manual Xvfb setup redundant in `run.sh`, simplify it** (and only then). Otherwise leave `run.sh` as-is.

- [ ] **Step 5: Commit.**

```bash
git add package.json package-lock.json tests/desktop/run.sh
git commit -m "test(desktop): upgrade WebdriverIO to 9.19.1+ (auto-Xvfb)"
```

---

## Phase 8 — Post-ship safety net (bigger; privacy-critical; do last)

> **Privacy is non-negotiable here.** Keepance holds confidential legal data. Any crash/usage data leaving the machine must contain ZERO document/email content and ZERO personal data. Scrub aggressively; prefer opt-in. Building/publishing a release that includes this needs Jameson's explicit go (commercial boundary) — implement + test locally, do NOT ship without sign-off.

### Task 14: Sentry crash reporting with strict content scrubbing

**Files:**
- Modify: `src-tauri/Cargo.toml` + Rust init (sentry-rust) and/or `package.json` + front-end init (`@sentry/react` / `@sentry/tauri`)
- Create: a scrubbing layer (`beforeSend` hook) + tests for it
- Create: `docs/operations/sentry-privacy-policy.md` documenting exactly what is and isn't sent

**Why (plain):** when the app crashes on a real user's computer, we want to know immediately — but we must never see their files. Sentry reports the crash (where in the code it broke) with all personal text stripped out.

- [ ] **Step 1: Decide the SDK** — `@sentry/tauri` covers both the JS and Rust sides; confirm Tauri 2 support. Add the dep(s) and a Sentry project DSN (free tier; create the project in Sentry, store DSN as a build secret, never in the repo).

- [ ] **Step 2: Write the scrubbing test FIRST** (`tests/unit/observability/sentry-scrub.test.ts`): given a fake event whose `message`/`extra`/`breadcrumbs` contain a file path, document text, and an email address, the `beforeSend` scrubber must return an event with all of those redacted (e.g. paths → `<path>`, any value over N chars → `<redacted>`, email-shaped strings → `<email>`).

- [ ] **Step 3: Run, expect FAIL** (`scrubEvent` not implemented):

```bash
cd ~/keepance && npx vitest run sentry-scrub 2>&1 | tail -10
```

- [ ] **Step 4: Implement `scrubEvent` + wire it as `beforeSend`** in the Sentry init (both JS and Rust init paths). Disable Sentry's default PII capture (`sendDefaultPii: false`, no request bodies). Make it **opt-in** via a settings toggle defaulting OFF, or at minimum a first-run consent. Re-run to PASS.

- [ ] **Step 5: Document** exactly what is/isn't transmitted in `docs/operations/sentry-privacy-policy.md`, and surface a plain-language line in the app's privacy/Data Map UI.

- [ ] **Step 6: Commit.**

```bash
git add -A
git commit -m "feat(observability): opt-in Sentry crash reporting with strict content/PII scrubbing"
```

> Do NOT publish a build with this on without Jameson's explicit go.

### Task 15: Staged rollout gated by crash-free %

**Files:**
- Modify: the updater config / `latest.json` generation (`release.yml` `finalize-updater-manifest` job + any updater-channel logic)
- Create: `docs/operations/staged-rollout.md`

**Why (plain):** instead of pushing a new version to everyone at once, release it to a small slice of users first. If Sentry shows crashes spiking, halt before it reaches everyone.

- [ ] **Step 1: Design the channel mechanism.** Tauri's updater is single-endpoint by default; implement channels via a `?channel=` query string (e.g. `beta` vs `stable`) the client appends when checking for updates. Document the design in `docs/operations/staged-rollout.md` first (it's an engineering design, not a one-liner).

- [ ] **Step 2: Implement a `beta` channel** — the client reads its channel from settings; `finalize-updater-manifest` publishes `latest.json` (stable) and `latest-beta.json`. New versions go to `beta` first.

- [ ] **Step 3: Define the gate (manual at first):** before promoting `beta` → `stable`, check Sentry "crash-free sessions ≥ 99%" for the new version. Document the threshold + the promote step. (Auto-rollback is out of scope; this is a documented manual gate to start.)

- [ ] **Step 4: Test the channel switch locally** (point a debug build at a local `latest-beta.json` and confirm it picks up the beta version while a `stable` client does not).

- [ ] **Step 5: Commit.**

```bash
git add -A
git commit -m "feat(updater): beta channel for staged rollout + crash-free promote gate (docs)"
```

> Do NOT publish channel changes to real users without Jameson's explicit go.

---

## Self-review checklist (for the implementing session, before declaring done)

- [ ] **CI actually fires on `keepance-3.0`** (`gh run list --branch keepance-3.0` shows runs) and is green.
- [ ] **`cargo test` runs in CI** and on a clean tree passes; no test tries the network/model download in CI.
- [ ] **ESLint gate fails on a deliberately-introduced new error** (test it once by adding a junk error, confirm red, revert).
- [ ] **`.github/workflows_temp/` is gone.**
- [ ] **`release.yml` build jobs `needs: gate`** (YAML parses; graph correct). Not triggered.
- [ ] **`npm run gate` green;** pre-push hook installed (`git config --get core.hooksPath` = `.githooks`).
- [ ] **Nightly timer enabled** (`systemctl --user list-timers | grep keepance`) and a manual `start` produced `RESULT: PASS` (or real failures filed).
- [ ] **Full E2E runs in one pass** against the preview server (or the sharded fallback is documented as the chosen path in nightly).
- [ ] **Coverage threshold enforced in CI** and passes today.
- [ ] **mockIPC + Windows-path + (WDIO if applicable) tests pass.**
- [ ] **Sentry is opt-in, scrubs content/PII (test passes), documented; nothing shipped without Jameson's go.**
- [ ] All work committed to `keepance-3.0`; tree clean; `npm run gate` green at the end.

## What to tell Jameson when done (plain language)

Lead with: "The automatic guard now actually runs — on every change, on the branch we use, including the risky encryption code; the slow signed build refuses to start on broken code; and every night the server quietly runs the heavy tests and only texts you if something's wrong." Then the short list of what changed. No jargon, no file paths as the main content.
