# swallow-p0 (QA-44) — comprehensive close-out verdict

**Reviewer:** cc-lantern-swallowclose (Fable worker, fresh eyes)
**Date:** 2026-07-06
**Branch reviewed:** `lp/swallow-p0` @ `a54e0061` (rounds 1–6), diffed against merge-base with `origin/lantern-plus`
**Second opinion weighed:** Codex adversarial review (`codex-swallowp0.log`, completed 03:15) — read in full, agreements/disagreements called out below.

---

## VERDICT: **MERGE-READY AFTER LISTED FIXES — a round 7 is required. No redesign.**

The architecture is sound and the right shape for this class of bug. Six rounds have produced a
coherent, layered design: (1) fail-closed filtering at the single retrieval choke point
(`MemoryService.retrieve` → `applyFailClosedExclusions`), (2) a per-workspace retry scheduler with
generation supersession + per-id op serialization, (3) visible state (`ScopeUpdateBanner`), and
(4) a durable per-workspace mail-hold store restored synchronously on workspace open. The privilege
half of the original P0 is closed **unconditionally** — every hit is re-checked against the live,
persisted privilege store across all path forms on every retrieval, independent of whether any
re-tag ever lands. That is the strongest possible closure for the privilege leak and it is done.

What remains is a short, precise list of holes — two of them merge-blocking — all fixable inside
the existing design. None of them argues for a redesign.

**Evidence base:** full read of the branch diff (12 files, ~2,270 lines) plus the surrounding
current code (Rust `commands/mail/matter.rs`, `commands/rag/state.rs`, retrieval call sites);
branch test suite run green (**51/51 passed**, my new documenting test brings it to 51 + 1
expected-fail); dry merge against current `origin/lantern-plus` performed and aborted (conflicts
confirmed first-hand).

---

## Remaining holes (ranked; each with file:line + failure scenario)

### R7-1 · BLOCKING · Semantic merge reconciliation with this week's RAG work
**Where:** `src/platform/hooks/useMemoryWiring.ts` (conflicts at ~892–980, ~1340, ~2045 in a dry
merge), `src/platform/rag/MemoryService.ts:448`.
**What:** origin moved 63 commits past this branch's last merge. Two textual conflicts hide two
semantic ones:

1. **Workspace-identity guards vs. throw-on-failure.** Origin threaded a
   `WorkspaceIdentitySnapshot` through `reindexFolderPaths` / `retagFolderPathsInPlace` /
   `startFullIndex` with `if (!isWorkspaceIdentityCurrent(...)) return;` early-exits. The branch's
   fail-closed contract makes `reindexFolderPaths` **throw** when any file failed, so the scheduler
   keeps the hold. An identity-guard **early `return` resolves the promise** — under the branch's
   semantics that reads as *clean success* and would **clear a fail-closed hold without having
   re-tagged anything**. Failure scenario: user re-maps folder A→B, immediately switches workspace;
   the in-flight op hits the identity guard, returns, scheduler (if not yet disposed at that
   microtask) or the pre-mount fallback treats it as success → hold dropped, stale wrong-client
   tags retrievable. The merge must make identity-abort a **distinct outcome that never clears a
   hold** (throw a sentinel the scheduler treats as "abandoned, keep hold", or check disposal
   before clearing).
2. **`retagMatterBatch` API divergence.** Branch HEAD: `Promise<number>` (row count). Origin:
   `Promise<string[]>` (per-path **misses** the caller must re-index — misses are NOT failures).
   `retagFolderPathsInPlace` (useMemoryWiring.ts:1077) must be rebuilt on the new API: thrown
   errors → `failedPaths` (hold), returned misses → re-index those paths, and only re-index
   failures join the hold. Mechanical conflict resolution here would either hold out every
   never-indexed file (over-exclusion) or drop real failures (leak).

**Codex concurs** (its blocking findings #1 and #4). This is the definitional blocker: the branch
cannot land without this work, and it is judgment work, not `git checkout --theirs`.

### R7-2 · BLOCKING · Rust `mail_retag_folder_matter` swallows per-message failures → false success discharges the durable hold
**Where:** `src-tauri/src/commands/mail/matter.rs:239` —
`Err(e) => log::warn!("retag matter for {path_key} failed: {e}")` inside the per-message loop; the
command still returns `Ok(retagged)`.
**What:** the entire round-4 invariant is "only a genuine SUCCESS discharges the durable hold."
But the success signal is not genuine: if the folder has 100 messages and 99 re-tag while 1 errors
(LanceDB row update failure), the command resolves Ok. The frontend then clears the
`excludeMailMatters` exclusion AND the persisted `pendingMailRetagStore` record
(useMemoryWiring.ts op success path + `retagExistingMailFolders` discharge). The still-stale
message surfaces under the OLD client — the exact QA-44 leak, now laundered through a "successful"
retag, and *durably* discharged so no boot pass re-holds it (the next boot's idempotent retag will
retry the row, but until a boot where it succeeds, the hold is gone).
**Fix (small):** count per-message `Err`s; if > 0, return `Err` (or `Ok` with a failed-count the
frontend treats as failure). The frontend already does the right thing with a rejection — retry +
keep hold. Note `Ok(0 rows)` (message not yet indexed) is correctly NOT a failure and must stay a
no-op. Add a Rust unit test alongside.
**Found independently by me; not in Codex's list.** This is the highest-value single fix in round 7
— it is the one hole that defeats the branch's central invariant rather than narrowing it.

### R7-3 · P2 · No durable cross-session hold for FILE folders (mail got round 4; files never did)
**Where:** gap by omission — compare `restoreMailHolds` (useMemoryWiring.ts:1652, synchronous at
mount) with the file path: file holds live only in the non-persisted `scopeUpdateStore`
(`matter:<folder>` entries + `matter:boot-retag`), all wiped by `clearAll()` on close.
**Failure scenario:** session 1 — folder re-mapped A→B, re-index fails all retries → correct
in-memory hold + banner. App closed (hold gone; or simpler: user quits while retries are still
pending, no visible failure at all). Session 2 — from workspace open until the boot heal completes,
there is **no hold**, and the boot heal runs LAST in the boot chain
(`startFullIndex`: full reconcile → PDF pass → mail backfill → mail retag →
`retagExistingMatterFolderPaths`, useMemoryWiring.ts:1268–1284). On a large workspace that is
minutes. Any Ask scoped to client A in that window retrieves B's files still physically tagged A.
If `MemoryService.indexWorkspace()` itself rejects, the heal never runs and the window lasts the
whole session.
**Why it's P2 not P1:** it needs a live re-tag left unresolved in a prior session (backend broken
at that moment, or quit-during-retry) and a wrong-client query inside the boot window — a narrower
gate than the mail equivalent had (mail had NO boot-window protection at all before round 4). But
it is the same *class* the campaign rated P1 for mail, and the product's pitch is per-client
confidentiality.
**Fix:** mirror the mail design symmetrically — persist pending folder-retag intents per workspace
(a `pendingFolderRetagStore`, or generalize `pendingMailRetagStore`), restore folder holds
synchronously in the same mount effect as `restoreMailHolds`, discharge on live or boot success
(the `dischargeBootRetagForFolder` plumbing already exists for the live-success half).

### R7-4 · P2/P3 · Boot heal races the live scheduler — a stale write can land last with no hold
**Where:** both boot passes run OUTSIDE the scheduler's per-id serialization:
`retagFolderPathsInPlace` groups `byMatter` from the matter map **once at pass start**
(useMemoryWiring.ts:1051) and writes over the following seconds/minutes;
`retagExistingMailFolders` snapshots `targets` once (useMemoryWiring.ts:1190) then loops.
**Failure scenario (file variant):** boot pass snapshots folder F→A; user re-maps F→B mid-pass;
live scheduler re-indexes F's files to B, succeeds, clears `matter:F` and discharges the boot hold;
boot pass then executes its (stale) `retagMatterBatch(F files, A)` — rows back to A, boot pass saw
no failure so it clears `matter:boot-retag` too. Final state: files physically tagged A, UI says B,
**no hold anywhere**, until the next app restart's heal. Mail variant is symmetric (boot writes a
stale target after a live success; the round-4 `mailIntentTargets` guard protects the *record*
from being cleared wrongly but cannot stop the stale *write*). Round 6 solved exactly this ordering
problem — but only among scheduler-owned ops.
**Why P2/P3:** requires a re-map inside the boot pass window with the unlucky interleaving
(live full re-embed finishing before the boot pass's in-place write for the same folder — the
less likely order, since in-place SQL is fast), and it self-heals on next boot.
**Fix:** route the boot passes through the same per-id serialization (run boot batches as
scheduler tasks with ids `matter:<folder>` / `mail:<key>`), or minimally: re-resolve the target
mapping immediately before each batch/folder write and skip any id that has a live scheduler entry.

### R7-5 · P3 · A same-id op queued behind an in-flight op still fires after `disposeAll()` — and the Rust mail retag isn't workspace-pinned
**Where:** `src/platform/rag/retagScheduler.ts:114` — `prior.then(() => op())` never re-checks
`disposed`/generation; plus `src-tauri/src/commands/mail/matter.rs:166` — the command uses
whatever `state.workspace` is current at execution time.
**Proven:** I added `it.fails('a same-id op queued behind an in-flight op does not execute after
disposeAll')` to `src/platform/rag/scopeUpdateRetag.test.ts` — it passes as an expected-fail today
(i.e., the queued op DOES fire), and flips to a plain green `it` once fixed.
**Failure scenario:** double re-map of one mail folder in quick succession (op2 queued behind
in-flight op1), workspace switch while op1 is in flight; op1 settles → op2's backend call fires
against the NEW workspace's mail store/RAG table, tagging the new workspace's copies of that
folder's mail with the old workspace's target matter. No hold exists in the new workspace; heals
only on its next boot. Narrow trigger (same account synced in both workspaces + that exact timing)
but it directly contradicts the scheduler's own documented invariant ("cancellation makes that
impossible" — it doesn't, for the round-6 queue).
**Fix (two halves):** (a) one-line frontend: in the chained continuation, skip `op()` when
`superseded(id, generation)` — also an efficiency win (stale queued ops become no-ops);
(b) defense-in-depth Rust: pass the expected workspace root into `mail_retag_folder_matter` and
have it refuse when not current (Codex's suggestion — I agree; origin's new identity-guard
infrastructure covers the file path once merged, mail needs the backend check).
**Codex found the in-flight half of this; the queued-op half (new in round 6) is mine.**

### R7-6 · P3 · Corrupt/unreadable persisted mail-hold state fails open
**Where:** `src/platform/rag/pendingMailRetagStore.ts:76` — zustand `persist`, no shape validation,
no hydration-failure handling; `restoreMailHolds` trusts whatever hydrated.
**Failure scenario:** the `lantern:pending-mail-retag` localStorage entry is corrupted/cleared →
hydration yields `{}` → no holds restored → the R7-3-style boot window applies to mail too, until
the boot retag succeeds. (Codex blocking finding #3; I rank it P3, not blocking: localStorage
corruption is rare, the idempotent boot heal converges, and the window equals the boot-window
already accepted elsewhere. Codex's "exclude ALL mail until forced repair" remedy is heavier than
warranted — a validated-shape migration + treating a hydration error as "hold every matter listed
in ANY surviving record + surface the failed banner" is proportionate. Worth doing in round 7
since the store is 120 lines, but I would not block a merge on it alone.)

### R7-7 · P3 (note) · `PrivilegeExclusionExplainer` demo bypasses the new central filters
**Where:** `src/features/ask/PrivilegeExclusionExplainer.tsx:29,64` — calls raw `ragRetrieve`, so
its demonstration diff doesn't apply `applyFailClosedExclusions`. Its "withheld" count/name can
disagree with what real Ask actually does while a re-tag is pending (cosmetic inaccuracy in a
trust-building feature; no content leak — it renders counts and one basename). Route the demo
through `MemoryService.retrieve` for consistency. Not blocking.

---

## What I verified as SOLID (so round 7 doesn't re-litigate it)

- **Privilege fail-closed is complete and durable.** Live-store re-check on every retrieval, across
  all path forms (`sourceIdForms`), skipped only on the explicit include-privileged opt-in, which
  still applies the matter exclusion (`MemoryService.ts` — `applyFailClosedExclusions`). Survives
  reload, failed re-tags, everything. Covered by `MemoryService.failClosed.test.ts`.
- **All product retrieval flows go through the choke point.** `useChatSending`, `useAsk`, workflow
  runner, briefs, Client Map all use `MemoryService.retrieve`; the only raw `ragRetrieve` caller is
  the explainer demo (R7-7) and the browser-only web demo.
- **Rust-side scoping is per-workspace** (`rag/state.rs` workspace_root; `EncryptedMailStore::open(&workspace)`),
  so the per-workspace-root keying of the durable store is the right key, and holds cannot bleed
  across workspaces through the backend.
- **Supersession + serialization (rounds 5–6) are correct for scheduler-owned ops.** Generation
  guards protect status cleanup; per-id tails order physical writes; the A→B→C rapid-remap ladder
  is well covered by tests (`scopeUpdateRetag.test.ts:151,186,231`). Codex concurs.
- **Hydration timing is safe.** zustand v5 `persist` over synchronous localStorage hydrates
  synchronously at module init, so `restoreMailHolds` at mount reads real data (same pattern as
  every other persisted store in the app).
- **Mount/switch ordering is safe.** Cleanup (disposeAll + clearAll) and setup (restoreMailHolds)
  run synchronously in React's commit; no retrieval can interleave. `matter:boot-retag`'s
  workspace-root guard (round 4) correctly stops cross-workspace bleed of the boot hold.
- **`isPathInFolder` handles the boot hold's exact-file-path entries** (same-or-inside predicate),
  so holding individual failed files works.
- **Tests: 51/51 green** on the branch's five QA-44 test files (+ my 1 expected-fail documenting
  R7-5). Banner is light-theme, honest-copy, aria-live.

## Codex cross-check

Codex's verdict ("needs specific fixes before merge, not a redesign") **matches mine**. Agreement
on: merge conflicts + semantic reconciliation (R7-1), in-flight-op workspace hazard (half of R7-5),
hydration validation (R7-6), and on the soundness of the core design. Differences: (a) Codex missed
the Rust partial-failure swallow (R7-2) — my top finding — and the durable-file-hold asymmetry
(R7-3) and the boot-vs-live write race (R7-4); (b) I rank its corrupt-store finding P3 rather than
blocking (reasoning under R7-6); (c) its note about the unused folder-filing side door in
`MatterPickerPopover` is valid as a future guard but touches code this branch doesn't change.

## What round 7 should do (in order)

1. Merge `origin/lantern-plus` and do the R7-1 reconciliation properly: identity-abort ≠ success
   (never clears a hold); rebuild `retagFolderPathsInPlace` on the misses-returning
   `retagMatterBatch` (misses → re-index; only failures → hold). Re-run the full branch suite plus
   origin's workspace-identity tests.
2. Fix R7-2 (Rust: fail the command on any per-message retag error) + a Rust test.
3. Fix R7-5a (skip queued op when superseded/disposed — flips my `it.fails` test green) and R7-5b
   (workspace-pinned `mail_retag_folder_matter`).
4. Fix R7-3 (durable per-workspace FILE-folder holds, mirroring the mail design).
5. Fix R7-4 (boot passes re-resolve targets at write time + skip scheduler-owned ids, or route
   through the scheduler).
6. R7-6 hydration validation + R7-7 explainer routing, time permitting.
7. Gate: `npm run gate` + the five QA-44 test files + `cargo test` for the mail command change.

Items 1–3 are the merge gate. 4–5 could technically ship as a fast-follow, but given this branch
exists precisely to close cross-session leak windows *completely*, I recommend round 7 includes
them — they are each small, and shipping "durable for mail but not files" invites the same
post-merge re-open this ticket already went through six rounds to avoid.

## Confidence

**High** on the verdict and on R7-1/R7-2/R7-5 (each verified directly: dry merge run, Rust code
read at the exact lines, failing behavior proven by test). **Medium-high** on R7-3/R7-4 severity
ranking — the mechanisms are certain from code reading, but the real-world trigger windows depend
on boot-pass duration and user timing I did not measure on a bench. I did not run a live desktop
session; nothing in this review required one, but round 7's verification should include one
scripted remap-fail-restart pass on the Legion bench to see the restored hold + banner with real
eyes.

---

## ROUND 7 — IMPLEMENTED (cc-lantern-swallow7, 2026-07-06)

All seven items done, each with red→green evidence. The branch was **merged** with the current
`origin/lantern-plus` tip (63→74 commits behind at start; a merge, not a linear rebase, because the
branch already carries prior origin-merge commits — a rebase would replay them and risk losing the
per-round conflict resolutions). Merge-base was `b1794baf`. Full QA-44 + wiring vitest green; Rust
`mail::matter::tests` green; `tsc` clean.

- **R7-1 (merge + semantic reconciliation) — DONE.** Both collisions resolved by hand:
  (1) *identity-abort ≠ success* — `reindexFolderPaths` keeps origin's quiet-return-on-switch
  contract (origin's "bails on switch" test stays green), and the scheduler op + pre-mount fallback
  now pin the identity, re-check it after the re-tag resolves, and throw a `WorkspaceIdentityChangedError`
  on abort so the fail-closed hold is never discharged. `retagFolderPathsInPlace` /
  `retagExistingMailFolders` store-write guards tightened from root-only to full identity.
  (2) *`retagMatterBatch` misses API* — rebuilt on `Promise<string[]>`: misses → re-index; a miss
  that FAILS to re-index rejoins the hold (the auto-merge had dropped `reindexPaths`' failure count).
  Red→green tests in `scopeRetag.test.ts`. Commit `9f618d3e`.
- **R7-2 (Rust partial-failure swallow) — DONE.** `mail_retag_folder_matter` now fails on ANY
  per-message error via a pure, tested `summarize_mail_retag` (Ok(0 rows) stays a no-op). 5 Rust
  unit tests; proven red (the swallow build failed the two failure-path tests) → green. Commit `87a657e3`.
- **R7-5 (queued-op-after-dispose + workspace pin) — DONE.** (a) `runSerialized` re-checks
  supersession/disposal when a queued op would START — the documenting `it.fails` flipped to a
  passing `it` (red→green). (b) `mail_retag_folder_matter` takes an optional `expected_workspace`
  pin; the 3 QA-44 callers pass the captured root and the backend refuses on a switch. Commit `87a657e3`.
- **R7-3 (durable FILE-folder holds) — DONE.** New per-workspace `pendingFolderRetagStore` +
  `restoreFolderHolds` (synchronous at mount, mirror of `restoreMailHolds`); the live reaction
  records up front + discharges on success; the boot pass records failed folders + discharges clean
  ones. 5 wiring tests + 6 store tests. Commit `8a0f4c42`.
- **R7-4 (boot vs live write race) — DONE.** Both boot passes re-resolve each target's CURRENT
  matter immediately before the write (FILE: skip a file whose matter changed; MAIL: write the live
  mapping, not the snapshot). 2 tests, proven red→green. Commit `ea04cb75`.
- **R7-6 (corrupt pending-store hydration) — DONE (proportionate, per this doc's ranking, not the
  heavier "exclude all mail").** `sanitizePersistedMailRetag` (wired as the persist `merge`) keeps
  well-formed records, drops malformed ones, and marks the store SUSPECT; `restoreMailHolds`
  surfaces a visible failed banner when suspect. 5 sanitizer + 2 banner tests. Commit `44633cff`.
- **R7-7 (explainer routing) — DONE.** `PrivilegeExclusionExplainer` now defaults its demo to
  `MemoryService.retrieve` (the fail-closed choke point) instead of raw `ragRetrieve`, so its
  "withheld" count agrees with real Ask. Explainer tests green.

**Merge-gate note for the coordinator:** the eslint gate reports 4 findings in
`teamsAdapter*` / `OneDriveConnect` — those files are byte-identical to origin and the baseline
already equals origin's, so this is lantern-plus's own pre-existing lint debt, NOT introduced by
this branch (this branch adds zero new eslint findings). The sidecar `binaries/` (piper,
llama-server) were copied from the `lantern-plus` base into this fresh worktree so `cargo test`
could build — gitignored, tree stays clean. A live Legion remap-fail-restart pass (this doc's
suggestion) was NOT run — build-only during the demo freeze.
