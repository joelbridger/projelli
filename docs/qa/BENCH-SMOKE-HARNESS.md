# Bench Smoke Harness

Scripted, repeatable automation of the manual Windows/Azure bench smoke test
(`docs/evidence/windows-smoke-2/RUN-LOG.md`). Goal: a future bench pass (Wave 3,
Wave 4, final integration re-verify) is a command + a human skim of
screenshots + `summary.json`, not hours of manual driving.

**Status:** built and unit-tested (105 tests); **live-validated against the
Legion bench once** (2026-07-03, read-only/queue-only, no `--live`), with a
second, not-yet-live-validated round of fixes/additions on top (2026-07-03,
`lp/harness-round2`, see "Round 2" below). 6 of 8 non-stub checks PASSed
against the real app in round 1: workspace binding, per-client Documents,
Wave 0 (Draft follow-up — 3 real citations, confirmed against a screenshot),
Wave 2 (Send to Wealthbox renders and queues a review card — confirms the
smoke-2 P0 #5 fix is still working), light theme, console errors. Round 1
live testing surfaced and fixed four real bugs in the harness itself (see
"Bugs found live" below). Not self-merged into `lantern-plus`.

### Round 2 (2026-07-03, `lp/harness-round2`) — built + unit-tested, awaiting live validation

- **Settings/Connections navigation, built.** `checks/_util.mjs` gained
  `openSettingsAiPrivacy()` (spine `settings-gear` → rail
  `settings-category-ai-privacy`) and `openAccountConnectionsTab()` (spine
  `account-identity` → `account-tab-connections`), each primed (best-effort,
  same pattern as every other nav helper here) ahead of the existing
  `wave1-calendar-brief-export` and `cross-cutting-egress-indicator`
  assertions — this un-blocks both checks that round 1 left `SETUP-BLOCKED`
  for lack of this navigation.
- **`index-health` flakiness, root-caused and fixed.** The real cause (found
  by reading `MatterHub.tsx`/`MattersHome.tsx`): once ANY client hub is open,
  there is no UI control wired back to the client table
  (`closeHub()` is never bound to a visible button) — so
  `matter-launch-documents-<matterId>` can legitimately disappear the instant
  a prior check (Wave 0/Wave 2, which open a docx note) leaves a hub open on a
  different sub-tab. `setup.mjs`'s `primeClientView()` used to wrap BOTH
  navigation steps in one try/catch, so whenever step 1 failed for this
  reason, step 2 (switching to the desired sub-tab via the hub's own,
  always-present `hub-subtab-overview`/`hub-subtab-documents` sub-tab bar)
  never even ran. Fixed by trying each step independently.
- **3 new Wave 4 Track B/C checks** (promoted out of `wave-stubs.mjs`, now
  merged UI): `wave4-whole-book-view` (the "Whole book" toggle renders ranked
  `book-row-<matterId>` rows; clicking one opens that client's hub),
  `wave4-estate-beneficiary-gap` (a `book-gap-chip` on a flagged row; opening
  that client's Client Map sub-tab and clicking its
  `clientmap-ask-know`/`clientmap-ask-flag` resolve control clears the gap —
  via a clean-state check or a dropped resolvable-row count), and
  `wave4-whole-practice-ask` (the Ask surface's `scope-option-whole-practice`
  pill selects and renders; the cross-client consent gate
  (`chat-file-access-consent`) is asserted present when shown, never
  granted/denied — read-only by design). All selectors were confirmed by
  reading the actual merged source (`BookView.tsx`, `ClientMapPanel.tsx`,
  `ScopeToggle.tsx`, `FileAccessConsentBanner.tsx`), not guessed.
- **Track D stub added** (`wave4-retention-attestation`) — retention policy +
  attestation `.docx` export (Task 16-17) hasn't merged; confirmed absent from
  source before stubbing.
- **Not yet live-validated.** Round 2 is offline-verified only (unit tests,
  ESLint, `--plan`, and an unreachable-host end-to-end run) — the actual
  Windows-bench pass against the Legion is a follow-up, coordinated separately
  so it doesn't collide with the Wave-3 lane's device verification.
- **Independent Codex review caught 2 real logic bugs before merge**, both
  fixed (with regression tests): the estate/beneficiary dismissal was clicking
  whichever of `clientmap-ask-know`/`clientmap-ask-flag` matched first —
  `clientmap-ask-know` ("I know this") actually opens an answer-entry prompt
  (`onAnswerQuestion`), not an immediate resolve, so an automated click on it
  would hang or leave a stray dialog open; only `clientmap-ask-flag` ("Ask the
  client") resolves synchronously (`flagForClient` → `markGapResolved`, no
  modal) and is now the only one clicked. Separately, the whole-practice-ask
  scope-pill assertion used to `textPresent(driver, 'Whole practice')`, a
  substring already visible on the *pre-click* scope-option button's own
  label — it could pass even if the click did nothing; it now waits for the
  pill's distinguishing full copy ("Whole practice (summaries only)") and
  additionally asserts `findByTestId(elements, 'ask-scope-pill')`. A third
  flagged concern (a client hub possibly still open when `openWholeBookView`
  clicks the "matters" spine tab) was investigated and refuted by reading
  `src/App.tsx`'s `AppShellNav onTabChange` handler, which unconditionally
  nulls the hub state on that click (single render site, no guard) — a
  defensive check-and-retry was still added since it's cheap insurance.
- **Merged `origin/lantern-plus` twice more into this branch** (2026-07-04):
  the Client Map error-classification fix (`lp/clientmap-errors`) and the
  Wave 4 Track A diarization merge (`lp/diarization`). Both merged cleanly
  (no conflicts), but the error-classification merge changed the REAL
  broken-index copy the app renders — `index-health`'s detection strings
  (`memory integrity uncertain` / `ai-connection error` / `indexing failed`)
  never matched real UI text and are now further stale; updated to the
  actual classified messages from `src/features/matters/clientMap/
  errorClassification.ts` (`needs to rebuild`, `Could not build client map`,
  `Could not check for client map updates`). Wave 4 Track A (diarization) is
  now merged but this round did NOT add a check for it — the existing
  `wave4-diarization` stub is unchanged; promoting it is a natural next
  ticket, out of this round's explicit scope.
- **A second Codex-review pass on the post-merge diff caught one more real
  bug**: `wave4-estate-beneficiary-gap` was still clicking `clientmap-ask-flag`
  on every normal (non-`--live`) run, synchronously resolving the gap
  (`markGapResolved`, audit-logged) — a real fixture mutation on a
  supposedly read-only check, and it would make the gap silently vanish for
  the next run. Split into two checks, same pattern as Wave 2's Wealthbox
  Approve: `wave4-estate-beneficiary-gap` now only asserts the chip and its
  resolve control are present (no click); the actual dismiss-and-verify
  moved to a new `--live`-gated `wave4-estate-beneficiary-gap-dismiss-live`
  (`SKIPPED` without `--live`). 111 unit tests (up from 108), full-project
  `tsc --noEmit` and the full pre-push test suite (5608 tests) both clean.

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
npm run bench-smoke:test        # vitest — 105 tests, pure logic, no SSH/bench required
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

## Live validation (2026-07-03, Legion bench) — round 1

Round 1's live-validation table below is kept as historical record. The three
follow-ups it left open (Settings/Connections navigation for Wave 1 and
egress-indicator, and `index-health` flakiness) were fixed in round 2 above,
but round 2 itself has **not yet** been re-run live against the Legion — that
re-validation is a follow-up, not evidence claimed here.

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

### Known follow-ups (round 1) — resolved in round 2

- ~~Wave 1 / egress-indicator need a Settings→Connections navigation
  helper.~~ Fixed — see "Round 2" above (`openSettingsAiPrivacy()` /
  `openAccountConnectionsTab()`). Not yet re-confirmed live.
- ~~`index-health` is flaky.~~ Root-caused and fixed — see "Round 2" above.
  Not yet re-confirmed live.
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
