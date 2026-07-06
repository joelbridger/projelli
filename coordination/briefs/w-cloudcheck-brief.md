# Worker brief — swallow-p0 LIVE remap-restart check on the CLOUD bench

You are **cc-lantern-cloudcheck**, a bench-driver lane. Work from the existing worktree **~/lp-swallowp0** (branch `lp/swallow-p0` @6fdcc5ed — do NOT commit code changes to it). You do NOT merge. Read `coordination/WORKER-DISCIPLINE.md` first (foreground-poll rule, scoped-tests-only, DONE-means-PUSHED).

## 🛑 Hard constraint
The **Legion laptop is PINNED at abcedeb0 for Jameson's real demo — you must NOT touch it** (no pull, no rebuild, no launch, no SSH). Your bench is the Azure VM **lantern-cloud-bench-1** ONLY (Tailscale, target `azure-cloud-bench-1` in `scripts/bench-smoke/targets.mjs`). It is being started now (`az vm start -g lantern-bench -n lantern-cloud-bench-1` was just issued); wait for Tailscale/SSH reachability. Setup + drive details: `coordination/azure-bench/SETUP-LOG.md` (read Part 2), `docs/qa/BENCH-SMOKE-HARNESS.md`.

## The mission
lp/swallow-p0 (QA-44) makes client re-tagging fail-closed and durable: re-mapping a folder from client A to client B must never let stale A-tagged content answer as the wrong client — even across an app restart. It is pre-merge. Your job: prove the remap-restart behavior LIVE on real Windows, on the branch build.

1. Bring the VM's checkout to **lp/swallow-p0 @6fdcc5ed exactly** (fetch + hard checkout; verify `git rev-parse HEAD` on the VM). Rebuild the app there (Rust was touched — a full rebuild is expected; the VM has a warm target dir from earlier builds).
2. **Check A (happy path):** in a test workspace with 2 clients + an indexed folder mapped to client A: re-map the folder A→B, let the retag finish, then RESTART the app. Verify: after restart, Ask scoped to client B finds the folder's content; Ask scoped to client A does NOT.
3. **Check B (durable hold across restart):** re-map a folder and kill/quit the app BEFORE the retag can complete (quit immediately after the remap click — the retag of a big folder takes seconds). Relaunch. Verify: (i) on boot a hold is restored (the scope-update banner shows, and/or Ask scoped to the OLD client withholds that folder's content — it must NOT answer from stale tags during the boot-heal window); (ii) after the boot heal completes, tags are correct (B finds it, A doesn't) and the banner clears.
4. Evidence: screenshots + the exact drive transcript per check, PASS/FAIL verdicts. Commit evidence to a NEW branch `lp/cloudcheck-evidence` (evidence files only, under `docs/evidence/cloudcheck-swallow/`), push with `--no-verify`.

Design the drive with `scripts/desktop-drive.mjs` over the bench SSH/CDP path (see how `scripts/bench-smoke/driver.mjs` invokes it) and the robot verbs in `scripts/robot/verbs/` (matters/workspace/ask/reset). If a step is impossible on this bench (e.g. timing too tight to quit mid-retag), say so precisely and do the closest honest variant — do NOT fake a pass.

## Context you should read on the branch
`coordination/reports/swallow-p0-close-verdict.md` (what the fix guarantees — R7-2/R7-3 describe exactly the restart windows you are probing) and the pendingMail/pendingFolder retag stores + `restoreMailHolds`/folder-hold restore in `src/platform/hooks/useMemoryWiring.ts`.

## Money guardrail
When your checks are DONE, deallocate the VM: `az vm deallocate -g lantern-bench -n lantern-cloud-bench-1 --no-wait`. Never create new Azure resources.

## Done criteria (HARD)
Evidence branch committed AND pushed (verify with `git ls-remote`). THEN print exactly: `WORKER-DONE: cloudcheck swallow-p0` + verdicts: `CHECK-A: PASS|FAIL — <one line>` and `CHECK-B: PASS|FAIL — <one line>` (+ any caveat). A FAIL is a fine outcome — report it honestly; the coordinator gates the merge on your verdicts.
