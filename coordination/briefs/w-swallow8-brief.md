# Worker brief — swallow-p0 ROUND 8: three verified review findings (merge-blocking)

You are **cc-lantern-swallow8**. Create worktree **~/lp-swallow8** on new branch **lp/swallow-p0-r8** off `origin/lp/swallow-p0` (@6fdcc5ed): `git -C ~/lantern-plus worktree add -b lp/swallow-p0-r8 ~/lp-swallow8 origin/lp/swallow-p0`. Do NOT touch ~/lp-swallowp0 (a bench driver is using it). You do NOT merge. SCOPED tests only. Read `coordination/WORKER-DISCIPLINE.md`. Context docs: `coordination/reports/swallow-p0-close-verdict.md` (on the branch) for the design vocabulary.

A fresh Codex review found 3 issues; the coordinator verified each against the code. All three are in scope; #1 is the hard blocker.

## F1 (BLOCKER) — unmapped folders' durable holds strand forever
`retagExistingMatterFolderPaths` (useMemoryWiring.ts ~1286) builds its folder list ONLY from `getMatters().flatMap(folderPaths)` and early-returns when empty. If a folder was unmapped/removed while its retag was pending, `restoreFolderHolds` re-holds it at boot but the boot pass never retags it → held out of search forever. The MAIL path already solved exactly this: `retagExistingMailFolders` (~1356) unions mapped folders with durable pending intents ("so a hold is ALWAYS retried until it lands"). Mirror that for files: union the workspace's `usePendingFolderRetagStore.forWorkspace(root)` paths into the boot pass, resolving each pending path's CURRENT matter by mapping (unmapped → retag/re-index to unassigned), and discharge the durable hold on success. Mind the early-return: pending-only (no mapped folders) must still run.

## F2 — hydration-suspect banner is dishonest
`restoreMailHolds` (~1438): the R7-6 `mail:hydration-suspect` entry has no `excludeMailMatters`, so it holds NOTHING out of retrieval — but `ScopeUpdateBanner`'s failed copy says "Some content is held out of search until it applies." A trust feature must not overstate. Fix so word and deed match; the coordinator's preferred direction: actually fail closed for the suspect window — exclude ALL mail hits while a hydration-suspect hold exists, cleared when the boot mail retag pass completes cleanly for that workspace (the idempotent pass already reconverges tags; you're adding the missing hold + a discharge hook). If you find a strong reason that's disproportionate, the fallback is a distinct honest banner copy for the suspect state + keeping the current behavior — but write down why.

## F3 — folder pending-store has no corruption guard (mail does)
`pendingFolderRetagStore.ts` persists raw with no merge sanitizer / suspect flag; a corrupt blob silently loses holds (fail open) or feeds garbage into retrieval filtering. Mirror `sanitizePersistedMailRetag` + `pendingMailRetagHydrationSuspect` from `pendingMailRetagStore.ts:101`: validate shape on hydration, keep well-formed entries, flag suspect, and wire the suspect flag into the same fail-closed treatment as F2 (hold the workspace's files out until the boot folder retag completes cleanly).

## Method
Strict TDD per finding (F1: a test where a pending hold exists for an unmapped folder → boot pass retags + discharges it; F2: suspect → mail hits excluded until clean pass; F3: corrupt blob → suspect + fail closed, valid entries survive). tsc + scoped vitest green. Rust untouched.

## Done criteria (HARD)
All three red→green, committed AND pushed (`git push --no-verify -u origin lp/swallow-p0-r8`), verify with `git ls-remote`. THEN print exactly: `WORKER-DONE: lp/swallow-p0-r8` + 3-line summary (one per finding). The coordinator merges r8 back into lp/swallow-p0 at the gate.
