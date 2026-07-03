# Bench Smoke Harness

Scripted, repeatable automation of the manual Windows/Azure bench smoke test
(`docs/evidence/windows-smoke-2/RUN-LOG.md`). Goal: a future bench pass (Wave 3,
Wave 4, final integration re-verify) is a command + a human skim of
screenshots + `summary.json`, not hours of manual driving.

**Status:** built, unit-tested, and **live-validated against the Legion bench**
(2026-07-03, read-only/queue-only, no `--live`). 6 of 8 non-stub checks PASS
against the real app: workspace binding, per-client Documents, Wave 0 (Draft
follow-up — 3 real citations, confirmed against a screenshot), Wave 2 (Send to
Wealthbox renders and queues a review card — confirms the smoke-2 P0 #5 fix is
still working), light theme, console errors. Live testing surfaced and fixed
four real bugs in the harness itself (see "Bugs found live" below); the two
remaining `SETUP-BLOCKED` checks (Wave 1 calendar sync, egress indicator) need
a Settings/Connections navigation helper this pass didn't build — tracked as a
follow-up below, not a defect in what exists. Not self-merged into
`lantern-plus`.

---

## How it works

```
scripts/bench-smoke.mjs          # CLI entrypoint
scripts/bench-smoke/
  targets.mjs                    # known bench connection facts (legion, azure-cloud-bench-1)
  remote.mjs                     # ssh/scp invocation builders + exec (subprocess only)
  driver.mjs                     # high-level actions (snapshot/click/type/eval/waitFor/screenshot)
  parse.mjs                      # parses desktop-drive.mjs stdout
  console-watch.mjs              # console-error capture, built on the `eval` command
  result.mjs                     # STATUS enum, result/summary shape, exit-code policy
  checklist.mjs                  # the ordered list of checks + stubs
  checks/*.mjs                   # one module per RUN-LOG section
  __tests__/*.test.mjs           # vitest — logic only, no bench required
```

**The harness never talks CDP/Playwright directly.** It drives the bench the
same way `scripts/legion-drive.sh` already does: SSH to the bench and run the
real, unmodified `scripts/desktop-drive.mjs` there against its local port 9223
WebView2 remote-debug endpoint, then parses that subprocess's stdout. This is
deliberate — `desktop-drive.mjs` has no exported functions to `import` (it's a
top-level-await CLI), and it must not be modified or forked, so subprocess
invocation is the only way to reuse its CDP-connection logic instead of
duplicating it.

Every SSH call goes through `remote.mjs`'s `buildDesktopDriveInvocation()` /
`buildProbeInvocation()` — same `ssh` options as `legion-drive.sh`
(`BatchMode=yes`, short `ConnectTimeout`, non-interactive), same
`cd <repo>; set DESKTOP_CDP_PORT; node scripts/desktop-drive.mjs <args>` remote
command shape, just parameterized by target and built from an array so it's
testable without a shell.

### Checks and evidence

Each check in `checklist.mjs` maps 1:1 to a RUN-LOG.md section: workspace
binding, per-client Documents scoping, RAG index health, Wave 0 (Draft
follow-up + Client Map review tray), Wave 1 (Calendar sync → meeting match →
brief), Wave 2 (Send to Wealthbox, queue/review only), and the three
cross-cutting checks (light theme, console errors, egress indicator).

A check returns one result object (`result.mjs`'s `makeResult`) with a status:

| Status | Meaning |
|---|---|
| `PASS` | The assertion held. |
| `FAIL` | The assertion did NOT hold — real evidence something is broken. |
| `SETUP-BLOCKED` | The check's precondition wasn't met (bench unreachable, no workspace open, client not linked to Wealthbox yet, etc.) — **not** evidence of a bug, just "couldn't check this run." |
| `TODO` | A Wave-3/4 stub — not wired to any UI yet, always reported, never run. |
| `SKIPPED` | Deliberately not run this pass (e.g. the live-only Approve step without `--live`). |

Every check is wrapped in `checks/_util.mjs`'s `withGuard()`, which turns a
thrown `DriverError` (bench/SSH/CDP problem) into `SETUP-BLOCKED` and any other
thrown error into `FAIL` — a bug in the check itself is reported as a result
row, not a crash that kills the rest of the run.

Checks wait on visible text/elements (`driver.waitFor`, Playwright's own
auto-waiting `getByText(...).waitFor()` under the hood) — never a fixed
`sleep`. Screenshots are captured on the bench via `desktop-drive.mjs
screenshot` and pulled to the evidence dir over `scp`.

### Console-error checking

`desktop-drive.mjs` has no built-in console listener (its CLI surface is
snapshot/click/type/eval/screenshot/waitfor/url/pages). Rather than opening a
second CDP connection, `console-watch.mjs` re-uses the existing `eval`
command: it evaluates a small script in-page once per run to patch
`console.error` / `window.onerror` / `unhandledrejection` into a page-global
array, then evaluates a second script after navigation to read and clear that
array. Same reuse rule as everything else — no new CDP connection code
anywhere in this harness.

---

## Running it

```bash
# Print the checklist (id / section / title) and exit — touches nothing.
node scripts/bench-smoke.mjs --plan

# Run everything against a known target (default: legion).
node scripts/bench-smoke.mjs --target legion
node scripts/bench-smoke.mjs --target azure-cloud-bench-1

# Run one check.
node scripts/bench-smoke.mjs --only wave2-wealthbox-queue-review

# Also run the sandbox-only mutating step (Wealthbox Approve).
node scripts/bench-smoke.mjs --target legion --live

# Drive a bench that isn't in targets.mjs yet.
node scripts/bench-smoke.mjs --host 100.x.x.x --user someuser --repo-dir 'C:\lantern-plus'
```

Output: a markdown table to stdout, plus `docs/evidence/bench-smoke/<target>-<timestamp>/summary.json`
and any captured screenshots in that same directory (override the location
with `--evidence-dir`).

**Exit codes:** `0` = every check that ran PASSED. `1` = at least one FAIL
(something is actually broken). `3` = no FAIL, but at least one SETUP-BLOCKED
(bench/data wasn't ready — worth a look, but not proof of a break). `TODO` and
`SKIPPED` never affect the exit code.

### Safety default — read-only unless `--live`

The Wealthbox check (`wave2-wealthbox-queue-review`) stops the instant the
review card renders. It never clicks Approve, never sends anything, never
touches OAuth. The separate `wave2-wealthbox-approve-live` check is the only
thing `--live` unlocks, and it is reported `SKIPPED` (not run) without that
flag.

**`--live` is sandbox-only.** The harness has no way to know which Wealthbox
account a given bench is connected to, so this is a documented rule, not a
code-enforced one: never pass `--live` against a bench connected to a real
advisor's Wealthbox — only the smoke sandbox account used in
`docs/evidence/windows-smoke-2/RUN-LOG.md` / `scripts/crm/wealthbox-write-probe.md`.

---

## Testing without a bench

```bash
npm run bench-smoke:test        # vitest — 77 tests, pure logic, no SSH/bench required
node --check scripts/bench-smoke.mjs && for f in scripts/bench-smoke/*.mjs scripts/bench-smoke/checks/*.mjs; do node --check "$f"; done
node scripts/bench-smoke.mjs --plan   # dry run, prints the checklist
node scripts/bench-smoke.mjs --host 127.0.0.1 --user nobody --evidence-dir /tmp/bs-test   # exercises the real CLI end to end against a deliberately-unreachable host; every check reports SETUP-BLOCKED, exit code 3
```

The vitest suite (`scripts/bench-smoke/__tests__/`, run via its own
`scripts/bench-smoke/vitest.config.mjs`, same pattern as
`scripts/robot/vitest.config.mjs`) covers: target resolution, the ssh/scp
command builders (including PowerShell quoting), stdout parsers, the
result/summary/exit-code logic, the console-watch scripts, the checklist's
shape (unique ids, required sections present, stub run() always returns
`TODO`), and `withGuard`'s DriverError-vs-generic-error classification. What it
does **not** and cannot cover: whether the actual `data-testid`s and visible
text this harness looks for (`docx-draft-follow-up`, `docx-send-to-wealthbox`,
"Sync now", "On this computer only", etc. — taken from RUN-LOG.md's prose)
still match the live app. That's exactly what a live validation run confirms.

---

## Live validation (2026-07-03, Legion bench)

Run read-only (no `--live`) against the Legion, bench state per
`docs/evidence/windows-smoke-2/BENCH-READY.md`. Final result after fixing what
the run surfaced:

| Check | Result |
|---|---|
| workspace-binding | **PASS** |
| per-client-files-visible | **PASS** (real files: DocuSign cert, Form ADV, Meeting Notes, Schwab Statement) |
| index-health | SETUP-BLOCKED (passed on one run, blocked on another — see "Known flakiness" below) |
| wave0-draft-followup | **PASS** — 3 real citation chips confirmed in a screenshot ("May 20, 2024", "adopt the 53% target-equity policy mix", "next review is scheduled for approximately one year out") |
| wave1-calendar-brief-export | SETUP-BLOCKED — needs a Settings/Connections navigation helper this pass didn't build (see "Known follow-ups") |
| wave2-wealthbox-queue-review | **PASS** — Send to Wealthbox button renders and queues a review card; **confirms the smoke-2 P0 #5 matter-resolution fix is still working** |
| wave2-wealthbox-approve-live | SKIPPED (no `--live` passed — correct default) |
| cross-cutting-light-theme | **PASS** |
| cross-cutting-console-errors | **PASS** |
| cross-cutting-egress-indicator | SETUP-BLOCKED — same Settings-navigation gap as Wave 1 |

### Bugs found live and fixed (all covered by new/updated unit tests)

1. **`driver.click(el.testid ?? undefined)` silently sent the literal string
   `"undefined"` as a testid** whenever a check matched an element by text
   instead of a real `data-testid` — every such click timed out. Fixed with
   `driver.clickByText()` + a `clickElement()` routing helper
   (`checks/_util.mjs`).
2. **A modal/overlay left open from a PRIOR session blocks every click**
   underneath it (confirmed: a stale Clients-management dialog was still open
   at bench handoff). Fixed with `driver.dismissBlockingOverlay()` (dispatches
   a real Escape keydown/keyup), run before every check, not just once at
   start.
3. **A custom "Draft follow-up" modal does not close on Escape** and stayed
   open across checks, blocking a later check's click on a real button
   underneath it. Fixed by extending `dismissBlockingOverlay()` to also click
   the first button inside any still-open `[role="dialog"]` /
   `[data-testid$="-modal"]` container (confirmed live: that first button is
   the icon-only close control).
4. **`findByText()` on `driver.snapshot()` false-negatives on plain
   informational text** (captions, banners) — desktop-drive.mjs's `snapshot()`
   only captures interactive elements (`[data-testid], button, a,
   [role="button"], input, textarea`), so text like "3 details are cited from
   your notes" (a plain `<p>`) never appears in it. This produced a false
   `FAIL` on `wave0-draft-followup` even though the screenshot showed the
   citations working correctly. Fixed with a `textPresent()` helper built on
   `driver.waitFor()` (Playwright's `getByText`, which searches the whole
   rendered DOM) instead of the restricted snapshot.

Also added, as a direct byproduct of live navigation debugging: a two-tier
search in `clickByTextScript()` (interactive elements first, then a
leaf-DOM-node fallback for elements like Documents file-tree rows that have no
testid/button/role at all) and `driver.doubleClickByText()` (file-tree rows
open on double-click, not single-click — confirmed live).

### Known follow-ups (not fixed this pass)

- **Wave 1 / egress-indicator need a Settings→Connections navigation helper.**
  Both checks currently assume the app is already on that view; this pass only
  built navigation for the Documents/Client-Map views (`checks/_util.mjs`'s
  `openSmokeClient*` helpers). Same shape of fix, just a different
  destination — a natural next ticket.
- **`index-health` is flaky** — passed once, `SETUP-BLOCKED` once, likely an
  ordering/timing interaction with the checks that ran immediately before it
  (each check re-primes navigation independently; Wave 0/Wave 2 leave the app
  on a docx editor tab, not the Client Map). Worth revisiting if it's still
  flaky once the Settings-navigation follow-up above is done.
- The `SMOKE_CLIENT_MATTER_ID` / `SMOKE_NOTE_FILENAME` constants in
  `checks/smoke-workspace.mjs` are specific to the Northcrest Wealth Partners
  demo workspace used in every RUN-LOG pass — update them there if a future
  smoke run ever targets a different demo dataset.

## Adding a Wave-3/4 check once its UI exists

1. Remove the matching stub from `checks/wave-stubs.mjs`'s `WAVE_3_STUBS` /
   `WAVE_4_STUBS`.
2. Add a real check module under `checks/` (copy the shape of `checks/wave0.mjs`
   or `checks/wave2.mjs` — `withGuard(id, section, async ({ driver, live }) => {...})`
   returning `makeResult(...)`).
3. Register it in `checklist.mjs`'s `CHECKLIST` array.
4. Add a `__tests__/checklist.test.mjs`-style assertion if the new check
   changes the checklist's shape (unique id, section present, etc.) — the
   check's own driver-calling logic isn't unit-testable without a bench, same
   as every other live check here.
