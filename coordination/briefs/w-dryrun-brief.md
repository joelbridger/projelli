# The 3× demo dry-run — instructions for the Legion driver (send after retest round 4 PASSES)

You are running the FORMAL DEMO READINESS PROOF: the full 6-step Demo V1 path, THREE TIMES IN A ROW, cleanly, on the final tip, following `docs/demo/DEMO-RUNBOOK.md` exactly as a presenter would. This is the finish line — treat it like opening night.

## Rules
- Pull + rebuild to the CURRENT origin/lantern-plus tip first; record the exact SHA in the report. The tip is FROZEN — if anything merges mid-run, the run restarts (coordinator will tell you).
- Each run = the runbook start to finish: prep checklist (fast verify — most is already staged), then steps 1→6 including a real 2-person Teams meeting for step 5 (short is fine, ~3 min with real speech) and searching THAT meeting's transcript for step 6.
- Between runs: reset like a presenter would (close app, fresh open of the same workspace). Do NOT wipe the workspace.
- **A run is CLEAN only if every step works without an unscripted recovery.** Using the runbook's own scripted fallbacks (e.g. "this one was quick") counts as clean; an error, a retry the script doesn't cover, a lie on screen, or a step skipped = that run FAILS and you note exactly what happened.
- 3 clean runs in a row = PASS. One failure = stop, report precisely (screenshot + the moment), await the coordinator — do NOT grind retries.

## Known checkpoints to watch explicitly (from tonight's findings — all supposedly fixed; verify live)
1. Step 1: the "✓ Working" checkmark shows persisted state ("checked N min ago") without re-clicking.
2. Step 3: the Practice Reference Library PDF kit produces a visible "Indexing PDFs: X of Y" moment.
3. Step 4: the mode-switch → warm-up question → real question flow — the FIRST local answer after switching must not error (the cold-start fix's live proof).
4. Step 5: notice card visible to the second participant AND STAYS the full meeting; recorder widget truthful throughout.
5. Step 6: Ask finds content from THIS run's real transcript, cited.
6. Outlook: if still unconnected, the scripted honest line is the path — note it, it does not fail the run.

## Deliverable
`coordination/qa-campaign/evidence/legion-3x-dryrun/REPORT.md`: per-run timing table + per-step verdicts + screenshots of each run's step 5 card and step 6 cited answer. Commit + push (`--no-verify`). THEN print exactly: `WORKER-DONE: legion-3x-dryrun` + "3/3 CLEAN" or the precise failure.
