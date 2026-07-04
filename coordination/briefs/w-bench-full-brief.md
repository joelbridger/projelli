# Worker brief — FULL scripted Windows bench pass, Waves 0-4 (the finish line)

**Lane:** cc-lantern-benchfull · worktree `~/lp-bench` (PERMANENTLY on `lp/windows-smoke-evidence` — do not switch branches, in either direction)
**Model:** Sonnet 5 · high. **Fires only when the coordinator says GO** (preconditions: `lp/symlink-hardening` AND `lp/meeting-capture` merged; w3 has released the Legion).

## Mission
Run the complete scripted smoke of Waves 0-4 on the Legion with `scripts/bench-smoke.mjs`, on the CURRENT merged tip, and bring it to a clean pass (or a precise FAIL report per check). This is what makes Waves 3+4 DONE by the real bar — merged+unit-green is NOT done; bench-verified is. It also doubles as the live shakedown of harness round-2 (Wave-4 B/C checks + nav helpers were merged offline-verified only).

## Bench facts
- Legion: Tailscale `james@100.127.67.22`, checkout `C:\lantern-plus`, dev app via the `LanternPlusDev` scheduled task. Pre-warm state + health checklist: `docs/evidence/windows-smoke-2/BENCH-READY.md` (on your branch). A real headset (AB13X USB Audio) is plugged in.
- You are the ONLY Legion driver while this lane is open. Coordinator enforces the one-driver rule.
- Driving how-to: `scripts/desktop-drive.mjs` over CDP (the harness wraps it); native dialogs via `scripts/legion_agent.py`.

## Procedure (in order)
1. **Bring the bench current:** pull `C:\lantern-plus` to the merged `origin/lantern-plus` tip. `npm install` if the lockfile moved.
2. **FULL rebuild, never skip:** run the complete build pipeline and record exit codes. A source-hash match is NOT a reason to skip — artifact freshness is what a bench verifies (standing playbook rule; a stale binary faked two fix-failures on 07-03).
3. **Freshness CANARY before any verdict:** prove the running binary is the new tip (grep the built exe for a string literal that only exists in a post-merge commit — e.g. something from the pathguard module or Wave-3 capture — and check the binary timestamp). Record it in the run log.
4. **Plan first:** `node scripts/bench-smoke.mjs --plan` (from the server repo), then run: `node scripts/bench-smoke.mjs --target legion`. Add `--live` only for the sandbox-safe Wealthbox Approve step (it is sandbox-only by design; still note it in evidence).
5. Exit codes: 0 = all ran checks PASS · 1 = ≥1 FAIL · 3 = no FAIL but ≥1 SETUP-BLOCKED. SETUP-BLOCKED means fix the bench/data readiness (BENCH-READY.md checklist) and re-run — it is not a product verdict.
6. **On FAIL:** capture the check id, screenshot, console/log excerpt. FIRST rule out stale build (a fix "failing" earlier than its own code, or in code the fix removed, = STALE BUILD until proven otherwise → redeploy). Then report to the coordinator — you do NOT fix product code in this lane; fix lanes are the coordinator's call. Re-run after each fix merge lands (repeat from step 1).
7. **Evidence:** the harness writes screenshots + summary.json to `docs/evidence/bench-smoke/<target>-<timestamp>/`. Commit evidence on `lp/windows-smoke-evidence` from `~/lp-bench` and push. Also append a dated verdict section to `docs/evidence/windows-smoke-2/RUN-LOG.md`.

## Discipline
- Long commands: wrap with `timeout` (e.g. `timeout 1200`) — no unbounded waits.
- Never use the coordinator's merge-gate cargo target; this lane should not need cargo at all (build happens ON the Legion).
- If a login/OAuth prompt appears: both M365 and Wealthbox connections were live and surviving restarts at prep time. If one genuinely needs re-auth, STOP and ask the coordinator (MS anti-automation risk) — do not improvise credentials. Demo creds reference: `demo-creds/sarah-morgan-account.md` (Sarah Morgan is de-passkeyed: password+TOTP).
- Report progress per wave (one line each). When fully done, print an evidence summary and then, as the very last line of your turn, the done sentinel in the standard format for branch `lp/windows-smoke-evidence` (copy exactly): `WORKER-DONE: lp/windows-smoke-evidence`
