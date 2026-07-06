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

## 🚫 NEVER arm a background poller and go idle (added 2026-07-05 — cost 3 rescues in one session)
Three workers in one session (swallowbatch, swallowp0, ragleak) froze the SAME way: they armed a "background build/gate poller," announced "I'll resume when it notifies me," and went idle — the poller never fired (or they never acted on it), so complete, correct work sat unpushed until the coordinator rescued it. **Rule:** if you must wait on a build/gate/remote job, poll it YOURSELF in a foreground loop with a hard timeout (e.g. `for i in $(seq 1 40); do <check> && break; sleep 20; done`), then ACT on the result in the same turn. Do NOT hand the wait to a background task and stop. "Waiting for a notification" is not a valid resting state — actively verifying or actively working is. This compounds the push-before-done rule: freezing before the push is the most common way work is lost.

## 🧺 BATCH findings into ONE fix round — no drip-feed fix cycles (Jameson-approved policy, 2026-07-06)
On 2026-07-06 several branches went review → fix → re-review → fix again (connector-parity and localai-trimming each took 3 rounds), each round a fresh worker session with full context — slow AND token-expensive. **Rule for coordinators:** collect ALL findings on a branch FIRST (the fresh adversarial review, the coordinator's own verification pass, any bench/live evidence, and — when multiple reviews are planned — wait for all of them), reconcile and rank them, then dispatch ONE combined fix brief covering everything. A follow-up round is justified only when the re-review of the combined fix finds a genuinely NEW bug the fix introduced, not for findings that were knowable up front. Corollary: run the delta re-review of a fix round ONCE, after the whole batch lands — not per-finding. Jameson explicitly endorsed this both for speed and token economy; it is the default, not an option.

## 🚦 SCOPED tests only in worker lanes — never the full suite (added 2026-07-06 after load-152 pileup)
Two workers running full `vitest run` suites simultaneously (plus pre-push hooks) drove a 20-core box to load ~150, making unrelated timing-sensitive tests flake fleet-wide and stalling everyone. **Rule:** workers run `tsc --noEmit` + vitest SCOPED to their changed area only. The coordinator's merge gate runs the FULL suite serially — a worker full-suite run duplicates that work and taxes every other lane. If the pre-push hook's broader run flakes under fleet load, `git push --no-verify` is authorized (the coordinator gate is authoritative). Spawn briefs must state this; coordinators enforce it on sight.
