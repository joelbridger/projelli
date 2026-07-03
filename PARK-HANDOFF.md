# PARK-HANDOFF — Wave 4 Track D (retention policy engine + attestation)

**Parked:** 2026-07-03, server hardware upgrade (tmux session did not survive).
**Branch:** `lp/retention` @ `ca270bf5` (local commit — push was hanging at park
time; verify it landed on `origin/lp/retention` before trusting that remote
copy, otherwise `git push origin lp/retention` from this exact commit).
**NOT self-merged.** The coordinator merges this branch; do not merge it
yourself even once everything below is green.

## Read first

1. `LANTERN-PLUS.md` → `docs/plans/lantern-plus/2026-07-02-MASTER-PLAN.md`
   (Global Constraints) → the Wave 4 plan's **"Track D — Retention policy
   engine + attestation export"** section in
   `docs/plans/lantern-plus/2026-07-02-wave-4-depth.md` (search for "Task 13:
   Retention policy store"). That section is the spec; this doc is only the
   state of executing it.
2. `coordination/briefs/w-wave4-d-brief.md` — the original task brief (scope:
   Tasks 13, 14, 15, 16, 17, 17b, 17d; NOT 17c, NOT 18).

## Environment

```bash
export CARGO_TARGET_DIR=$HOME/.cargo-target-lp-w4d   # set this in EVERY shell
cd ~/lp-w4d
```

`npm ci` has already been run (node_modules exists). The Rust target dir was
rsync-seeded from `.cargo-target-lp-gate` and the FIRST attempt at a cargo
build hit **widespread cache corruption** (missing crates, transmute-size
errors that cascaded across unrelated packages) — I did a full `cargo clean`
and rebuilt from scratch (~4 min for `cargo check`, longer for `cargo test`
the first time because it also builds every integration-test binary in the
package). **Use `cargo test --lib commands::retention` (not plain `cargo test
commands::retention`)** — the `--lib` flag skips rebuilding every integration
test target and is much faster once the lib itself is warm; this was the
single biggest time sink of the session.

Also: `src-tauri/binaries/{piper,llama-server}-x86_64-unknown-linux-gnu` did
not exist in this worktree (gitignored, populated by
`scripts/fetch-piper-sidecar.sh` normally) — a Tauri build script needs the
`externalBin` targets to exist as *some* file. I created empty stub files
(0 bytes, matching the pattern other worktrees like `~/lantern-plus` use for
dev builds). If they're missing again: `touch src-tauri/binaries/piper-x86_64-unknown-linux-gnu src-tauri/binaries/llama-server-x86_64-unknown-linux-gnu`.

## What's done and VERIFIED (evidence, not just claims)

- **Task 13 — retention policy store (TS).** `src/platform/privacy/retentionPolicyStore.ts`
  + test. Committed at `7490ce4d`. `npx vitest run src/platform/privacy/retentionPolicyStore.test.ts`
  → 3/3 pass (then grew to include 2 more tests for `pendingRagCleanup`,
  now 5/5 — see Task 15 below).
- **Task 14 — sweep engine (Rust), xhigh.** `src-tauri/src/commands/retention/sweep.rs`.
  Committed at `b97ed7bf`. `cargo test --lib commands::retention::sweep` →
  6/6 pass including the **mandatory enumeration test**
  (`delete_audio_mode_clears_every_capture_location_for_old_meetings`) which
  does a recursive `walkdir` scan asserting no `.wav`/`.opus`/`import-original*`
  survives anywhere under a swept meeting folder.
- **Task 15 — `retention_sweep` command + audit + runner, xhigh.** In the
  **uncommitted-until-park WIP commit `ca270bf5`** (see message for full
  detail). `cargo test --lib commands::retention` → **8/8 pass** (the 6 above
  + `audit_entry_ids_are_unique_and_prefixed` +
  `retention_sweep_rejects_absolute_matter_folders` +
  `retention_sweep_rejects_unknown_mode_before_touching_disk`).
  `npx vitest run src/platform/privacy/` → 10/10 pass. `npm run typecheck` → clean.
- **Task 16 — Settings UI + Data Map row.** `RetentionSettings.tsx` wired into
  `PrivacySettings.tsx`; live policy row wired into `DataMapDialog.tsx`
  (same `<div className="row" data-testid="data-map-retention">` block also
  carries Task 17's export button — they share one insertion point in the
  plan). `npx vitest run src/features/settings/RetentionSettings.test.tsx` →
  2/2 pass.
- **Task 17 — attestation export.** `src/platform/privacy/attestation.ts`
  (`buildAttestationMarkdown` pure + `exportAttestationDocx`). `npx vitest
  run src/platform/privacy/attestation.test.ts` → 2/2 pass. **NOT verified
  live** (no `VERIFY-LIVE` run of the actual .docx export in a running app —
  that still needs to happen before this task is truly done).
- **`npm run lint:gate`** — clean for every file I touched. 3 pre-existing
  findings remain in `src/features/documents/versioning/VersionService.ts`
  and `src/platform/hooks/useMemoryWiring.matterResolveWindows.test.ts` —
  **I did not touch either file** (confirmed via `git status`/`git diff`
  against my branch); this is stale ESLint-baseline drift from elsewhere in
  the shared repo (most likely Track B's earlier merge into `lantern-plus`
  outpacing the baseline snapshot), not something Track D introduced. Flag
  it to the coordinator; do not "fix" it from this branch without checking
  it's actually in scope.

## Codex-review status (xhigh requirement: 2 clean rounds before handoff)

**Round 1 ran and its findings are folded in already** (this is NOT the
2nd round yet — do not count it as such):

```
codex-review "Review the retention sweep engine and Tauri command for
data-loss safety. Focus files: src-tauri/src/commands/retention/sweep.rs,
src-tauri/src/commands/retention/mod.rs, src/platform/privacy/retentionRunner.ts,
src/platform/rag/matterResolver.ts (toWorkspaceRelativeFolder export). ..."
```

Findings and their resolution:
1. **[P1] Delete-before-audit-durability-confirmed** — fixed: the audit store
   now opens (preflight) before any `sweep_matter_folder` call, but crucially
   **after** validating every matter-folder input (see gotcha below).
2. **[P1] RAG cleanup lost on crash** — fixed: `pendingRagCleanup` state added
   to `retentionPolicyStore.ts`; `retentionRunner.ts` persists the pending
   RAG-source-id list *before* attempting `ragDeletePath`, and retries
   leftovers on the next call (even a debounced no-op sweep flushes pending
   cleanup first). 2 new tests cover this.
3. **[P2] Case-insensitive path compare could treat outside-workspace as
   inside** — fixed: `toWorkspaceRelativeFolder` in `matterResolver.ts` now
   uses `relativeInside()` (case-sensitive per segment, only case-folds a
   Windows drive/UNC root) instead of a blanket `.toLowerCase()` compare.
4. **[P2] Unknown retention mode could still delete chunk-caches before being
   rejected** — fixed: `retention_sweep` now validates `mode` against
   `RETENTION_MODES` before touching any folder. New test
   `retention_sweep_rejects_unknown_mode_before_touching_disk`.

**⚠️ GOTCHA I hit and fixed, that the NEXT session must not reintroduce:**
my first attempt at fix #1 opened `EncryptedAuditStore::open(ws)`
**before** the per-folder validation loop. That made the
`retention_sweep_rejects_absolute_matter_folders` test **hang** (confirmed via
`ps`/`pstree` — it was blocked inside the real OS-keychain lookup that
`EncryptedAuditStore::open()` does; `store.rs`'s own tests dodge this by using
`open_with_key()` with an in-memory test key instead of `open()`). The fix:
validate **all** folder inputs (absolute-path rejection AND workspace-escape
check) into a `Vec<PathBuf>` **first**, and only open the audit store
**after** that validation passes but **before** any actual deletion. This is
now the shape of `retention_sweep` in `mod.rs` — **do not reorder the audit
store open back before the folder-validation loop**, or the fast-fail tests
will hang again in this sandboxed (no real keychain daemon) environment.

**Round 2 codex-review has NOT been run yet.** Do that next, on the same
scope plus everything new since round 1 (the case-safe path fix, the
pending-RAG-cleanup fix, and the reordering fix above). The worker brief
requires **2 clean self-review rounds** before Tasks 14/15/17b can be
considered ready for the coordinator's max-scrutiny pass.

## What's NOT done yet — the concrete next steps, in order

1. **Run codex-review round 2** on Tasks 14+15 (scope: same files as round 1
   plus the fixes above). Fix anything it finds. This is the very next thing
   to do — everything else in Task 15 is otherwise ready.
2. **Task 17 `VERIFY-LIVE`**: actually run the app, open the Data Map dialog,
   click "Export attestation report", confirm a real `.docx` is written and
   opens correctly (title/policy line/integrity line/three tables render).
   Never claimed — evidence-before-assertions rule.
3. **Task 17b — Local redaction of meeting artifacts, xhigh, NOT STARTED.**
   Full spec in the wave-4-depth plan under "Task 17b (Track D): Local
   redaction of meeting artifacts". Needs: `src-tauri/src/commands/retention/redact.rs`
   (+ `mod redact;` in `retention/mod.rs`), `redact_meeting_segments` Tauri
   command registered in `lib.rs`, `src/platform/utils/redaction-commands.ts`
   TS wrapper + test. This is the last data-loss-critical (⚠️ xhigh) piece —
   give it its own 2 codex-review rounds same as Tasks 14/15, same
   audit-store-open-ordering gotcha almost certainly applies again (it also
   writes a hash-chained audit entry). The design in the plan is locked
   (whole-segment redaction, transcript.json marker replacement, notes.docx
   replace-then-byte-scan-then-DOM-flatten-then-rescan-then-hard-fail, RAG
   re-index, one audit entry) — follow it, verify plan line numbers by
   symbol since "tree has moved since 2026-07-02".
4. **Task 17d mount points — deferred, not blocking.** The pure `scanKeywords`
   scanner is done and tested (committed at `f7aac010`). The storage pair
   (`.lantern/tracked-keywords.json`), the post-transcription hook, and the
   two UI mounts (`MeetingEntry.tsx`, `ClientMeetingsTab.tsx`) are
   `DEPENDS-WAVE-3` — those files don't exist in this worktree yet because
   Wave 3 capture is a concurrent, unmerged lane (`~/lp-w4`). Leave deferred;
   note for Task 18 (coordinator's cross-wave gate).
5. **Final evidence-required handoff to the coordinator** (this is explicitly
   NOT self-merge): once 17b is done and codex-review-clean, assemble:
   HEAD SHA, per-task test counts (see "What's done" above for the running
   tally), the enumeration-test output verbatim, self-review round count per
   xhigh task, "Rust-touched: yes", the decisions/drifts list below, and the
   literal line `NOT self-merged`. Print `WORKER-DONE: lp/retention ready for
   review` as the last line, per the original brief.

## Decisions / drift from the plan (for the coordinator, not hidden)

- **Test split vs. the plan's literal test file contents**: the plan's Task 14
  code block included a test (`retention_sweep_rejects_absolute_matter_folders`)
  that calls the `retention_sweep` Tauri command — but that command is a
  Task 15 deliverable, not Task 14's. I moved that one test to Task 15's test
  module (`mod.rs`) instead of Task 14's (`sweep.rs`), since Task 14 as
  specified can't compile/test standalone with a call to a not-yet-defined
  command. Task 14 ended up with 6 tests (not literally what the plan's
  numbered comment said, which itself didn't match its own test count either
  — treat the plan's test-count comments as approximate).
- **`isTauri` import path differs from the plan's assumption.** The plan's
  Task 15 code imports `isTauri` from `@/platform/utils/tauri-commands`, but
  that module only imports `isTauri` from `@tauri-apps/api/core` internally —
  it does not re-export it. `retentionRunner.ts` imports `isTauri` directly
  from `@tauri-apps/api/core` instead; the test mocks that module directly
  rather than mocking `tauri-commands.ts`'s (nonexistent) re-export.
- **`getMatters().folderPaths` are ABSOLUTE, not workspace-relative** (see
  the doc comment on `Matter.folderPaths` in `src/platform/types/matter.ts`)
  — the plan's Task 15 runner code passed them straight to the Rust command,
  which only accepts workspace-relative folders and would have errored on
  every real call. Fixed by exporting `toWorkspaceRelativeFolder` from
  `matterResolver.ts` (previously private) and mapping/filtering through it
  in `retentionRunner.ts` before calling `retentionSweep`.
- **Zustand selector bug the plan's own code would have hit**: the plan's
  `RetentionSettings.tsx` and the Data Map row both selected
  `useRetentionPolicyStore((s) => s.getPolicy(workspaceRoot))` directly —
  `getPolicy()` allocates a fresh object every call, which breaks Zustand's
  referential-equality selector check and causes an infinite re-render loop
  (`Maximum update depth exceeded`, confirmed by running the test as
  literally specified in the plan first). Fixed in both places by selecting
  the raw `policies[workspaceRoot]` record entry (referentially stable) and
  calling `sanitizePolicy()` on it at render time instead.
- **`.keepance/` → `.lantern/`**: the plan's Task 17d storage path
  (`.keepance/tracked-keywords.json`) uses the pre-rename internal-folder
  name; current convention is `.lantern/` (see `BackendFactory.ts` comments).
  Not yet implemented (deferred per point 4 above), but note the path when
  it is.
- **Consent-ledger / attestation .docx writes go through
  `@tauri-apps/plugin-fs` directly** (`readTextFile`/`writeFile`), not
  through a `WorkspaceService` instance — there is no standalone/singleton
  `WorkspaceService` accessor in this codebase (it's always injected via a
  React ref), so pure non-component modules like `attestation.ts` and
  `retentionRunner.ts` can't obtain one. Verified this mirrors exactly what
  `TauriFSBackend.ts` does under the hood, so it's within the same capability
  scope already granted to the app, not a new privilege.

## Files touched (for a clean review diff)

Everything in `git show ca270bf5 --stat` plus the two earlier commits
(`7490ce4d` Task 13, `b97ed7bf` Task 14, `f7aac010` Task 17d scanner). Track D
file lanes remain disjoint from Wave 3's `commands/capture/` — confirmed no
imports from or references to that path anywhere in this branch.
