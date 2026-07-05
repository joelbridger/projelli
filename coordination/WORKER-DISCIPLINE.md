# Worker & fleet discipline (from the 2026-07-05 whole-system assessment)

## 1. "DONE" means INTEGRATED-READY — push before the sentinel (process leak, hit twice on 2026-07-04)
A worker is NOT done until its branch is **committed AND pushed AND reconciled with the current origin/lantern-plus tip**. Twice on 2026-07-04 a worker printed WORKER-DONE with work only staged/committed-locally and never pushed — caught only by the coordinator checking git state. Enforcement:
- Every build brief ends: "commit + PULL origin/lantern-plus + reconcile + PUSH, THEN print `WORKER-DONE: <branch>`. Do not print the sentinel before `git push` succeeds."
- The coordinator's FIRST action on every WORKER-DONE is `git rev-parse HEAD` vs `origin/<branch>` + a conflict check vs tip — before launching the review. (Already practiced; now doctrine.)

## 2. Real-OS smoke is FIRST-CLASS, not after-merge (the thing that keeps saving us)
Server `tsc+vitest+cargo` is structurally blind to file locks, path shapes, native dialogs, engine subprocesses — every scary bug on 2026-07-04 passed unit tests and only died on real Windows. Doctrine:
- Real-OS smoke (Legion + cloud benches, in parallel) runs continuously alongside merges, not only before a release. Cloud benches are cheap and parallel to the Legion; keep them driven.
- A comprehensive fresh-eyes QA campaign (see QA-CAMPAIGN-ROUND2.md) is a STANDING gate: before any release candidate AND after any large feature wave, on a STABLE tip. Recurring, not one-off.
- Benches MUST record their exact tip SHA and rebuild AFTER the stability point — a bench on a stale tip produces false findings (happened 2026-07-04: a bench reported an already-fixed claim).

## 3. Codex/analysis is gate-free throughput — reclaim it
Read-only Codex sweeps (bug-class hunts, adversarial design review) never touch the serial merge gate and are near-free. When the merge gate is the bottleneck, fan out Codex analysis — on 2026-07-04 a swallowed-failure sweep found a P0 privilege leak before it reached users. The idle-capacity monitor enforces using idle bench/cloud/Codex capacity.
