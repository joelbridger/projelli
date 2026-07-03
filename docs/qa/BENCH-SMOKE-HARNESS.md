# Bench Smoke Harness

Scripted, repeatable automation of the manual Windows/Azure bench smoke test
(`docs/evidence/windows-smoke-2/RUN-LOG.md`). Goal: a future bench pass (Wave 3,
Wave 4, final integration re-verify) is a command + a human skim of
screenshots + `summary.json`, not hours of manual driving.

**Status:** built and unit-tested from the server; **not yet run against a live
bench** (that's a separate, explicit go/no-go — see "Running against a real
bench" below). Not self-merged into `lantern-plus`.

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
npm run bench-smoke:test        # vitest — 58 tests, pure logic, no SSH/bench required
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

## Running against a real bench (not done yet)

This has **not** been run against the Legion or the Azure bench yet — the
Legion is owned by the bench-prep lane right now and then by Wave-3 device
verification, and the harness needed to exist first. Before a live run:

1. Confirm the bench's app is running with `DESKTOP_CDP_PORT`/remote-debug
   wired up (same precondition `legion-drive.sh` already assumes).
2. Confirm a workspace is open with real client folders bound (Phase 1 in
   RUN-LOG.md) — the harness does not create workspaces or drive OAuth.
3. Run `node scripts/bench-smoke.mjs --target legion` (read-only) first.
   Expect some `SETUP-BLOCKED` rows on the first-ever run while real
   `data-testid`s / button text get confirmed against `checks/*.mjs` — that's
   the harness doing its job (honest about failure), not a defect.
4. Only add `--live` once the read-only pass is clean and you're pointed at
   the sandbox Wealthbox account.

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
