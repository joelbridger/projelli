# Worker brief — swallow-p0 Check B re-run on a CLEAN bench (bench-2)

You are **cc-lantern-cloudcheck2**, a bench-driver lane. Work from worktree **~/lp-swallow8** (branch `lp/swallow-p0-r8` @2efa2e05 — the FINAL merge candidate: R7 rounds + R8 fixes + hardening). Do NOT commit code to it. Read `coordination/WORKER-DISCIPLINE.md`. 🛑 The Legion is PINNED — never touch it. Your bench: **lantern-cloud-bench-2** (being started now: `az vm start -g lantern-bench -n lantern-cloud-bench-2`). bench-1 stays off.

## Context — read first
Predecessor's evidence + report: branch `lp/cloudcheck-evidence` @b80e28ce (`docs/evidence/cloudcheck-swallow/`), and the brief `coordination/briefs/w-cloudcheck-brief.md`. Check A (happy-path remap→restart) PASSED live and is DONE — do not repeat it. Check B was BLOCKED on bench-1: WebView2 persistently executed a STALE frontend bundle despite cache wipes, a VM reboot, and a production preview build — the R7-3 durable-hold code never actually ran. Read their report's tooling notes before you start.

## The mission — Check B ONLY, with a runtime-freshness protocol
1. Bring bench-2's checkout to **lp/swallow-p0-r8 @2efa2e05 exactly**; build.
2. **PROVE the running webview executes the new code BEFORE testing:** over CDP, import/probe a symbol that exists ONLY in the new code (e.g. `pendingFolderRetagHydrationSuspect` from `src/platform/rag/pendingFolderRetagStore.ts`, added in R8) and confirm it resolves. If stale: this bench has the same tooling problem — dig into WHY (service-worker? disk cache? old dev-server process? wrong port?) and fix or report precisely. Do NOT run the check against unverified code.
3. **Check B:** in a 2-client workspace with an indexed folder mapped to client A: remap the folder A→B and kill the app BEFORE the retag completes (large folder = seconds of window; several attempts are fine). Relaunch. Verify: (i) a hold is restored at boot (scope-update banner visible and/or Ask against the OLD client withholds that folder's content during the boot-heal window — no stale wrong-client answers); (ii) after the boot heal completes, tags are correct (B finds it, A doesn't) and the banner clears.
4. Evidence (screenshots + drive transcript + PASS/FAIL verdict) committed to the EXISTING branch `lp/cloudcheck-evidence` under `docs/evidence/cloudcheck-swallow/checkB-bench2/`, pushed `--no-verify`.
5. **Money guardrail:** when done, `az vm deallocate -g lantern-bench -n lantern-cloud-bench-2 --no-wait`. Never create Azure resources.

## Done criteria (HARD)
Evidence pushed (verify `git ls-remote`). THEN print exactly: `WORKER-DONE: cloudcheck2 checkB` + `CHECK-B: PASS|FAIL|BLOCKED — <one line>` (+ freshness-proof note). An honest FAIL or BLOCKED beats a fake PASS.
