# Worker brief — cloud bench-1 driver: demo rehearsal + QA-92 re-verify standby

You are **cc-lantern-bench1**, worktree **~/lp-bench1**, branch **lp/bench1-evidence** (evidence lane off a4046edd). You DRIVE the Azure Windows VM `lantern-cloud-bench-1` (RG `lantern-bench`, already RUNNING, Tailscale-joined). You do NOT merge.

## Read first
- `docs/qa/BENCH-SMOKE-HARNESS.md` (how to drive the bench: `scripts/bench-smoke.mjs --target azure-cloud-bench-1`, desktop-drive over CDP 9223, PowerShell over SSH)
- `coordination/azure-bench/SETUP-LOG.md` (VM specifics; latest clean snapshot `lantern-cloud-bench-1-clean-3`; creds pointer — never echo/commit them)
- `coordination/DEMO-V1.md` (the 6-step demo path)

## Mission
1. **Bring the bench to the current tip** (a4046edd on branch lantern-plus) using the established harness/build flow.
2. **Rehearse demo steps 1, 2, 3, 4, 6** end-to-end like a first-time user (NO step 5 — cloud VMs have no real audio; meetings stay on the Legion): connect OpenAI AI (test key per harness docs), connect data connectors as far as test accounts allow, watch the progress screen, Ask about imported data (ChatGPT path), search content. Score each step PASS / BROKEN / CANT-TEST with a screenshot per step. KNOWN ISSUE you will hit: pre-existing files aren't searchable (QA-92, fix in flight) — note it, don't re-investigate.
3. **Write the scorecard** to `coordination/qa-campaign/evidence/bench1-demo-rehearsal/REPORT.md`, commit + push the evidence branch.
4. **Then STANDBY** (say "STANDBY: awaiting QA-92 merge" in plain text, stay alive): when the coordinator tells you the QA-92 fix is merged, rebuild to the new tip and verify specifically: a workspace whose client folders ALREADY contain .docx/.pdf files at open → Ask finds and cites them, including after closing and reopening the SAME workspace. (If branch lp/demo-sample-workspace is pushed by then, use its `scripts/deploy-demo-workspace.mjs` sample files.)

## Rules
- Never deallocate/stop the VM yourself; the coordinator manages power (it costs money idle — work steadily, report, standby).
- Evidence discipline: exact tip SHA in every report; screenshots for every claim.
- If the bench is broken/unreachable >15 min of honest attempts, report BLOCKED with what you tried — don't spin.

## Done criteria for phase 1 (HARD)
Committed AND pushed evidence (`git push -u origin lp/bench1-evidence`; `--no-verify` OK for evidence branches). THEN print exactly: `WORKER-DONE: bench1-rehearsal` + per-step PASS/BROKEN/CANT-TEST summary, then enter STANDBY as above.
