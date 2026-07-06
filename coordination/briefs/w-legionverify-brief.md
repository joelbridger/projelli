# Worker brief — Legion QA-92 re-verify (the demo machine proves the #1 fix)

You are **cc-lantern-legionverify**, worktree **~/lp-legionverify**, branch **lp/legionverify-evidence** (evidence lane off tip 5b4deaf6). You DRIVE the physical Legion Windows laptop (Tailscale `james@100.127.67.22`, admin). You do NOT merge. Evidence pushes always use `git push --no-verify`. SCOPED work only — never run the repo test suite.

## Read first
- `docs/qa/BENCH-SMOKE-HARNESS.md` — how to build/deploy/drive (scripts/desktop-drive.mjs over CDP 9223; scripts/legion_agent.py for native dialogs)
- `coordination/qa-campaign/evidence/winsmoke-qa90-91/SCORECARD.md` — how the previous Legion driver worked this machine
- `docs/demo/DEMO-QA-CRIB.md` — the questions + expected answers

## Context
QA-92 (Ask couldn't find files that were ALREADY on disk when a workspace opened) was root-caused, fixed (row-verified reconcile skip; PDF freshness requires rows; per-path retag-miss reindex), and merged at tip **5b4deaf6**. Bench-1 (cloud) is re-verifying in parallel; the Legion is the DEMO machine, so its pass is the one that counts most.

## Mission
1. Bring the Legion app to tip **5b4deaf6** (established build/deploy flow).
2. Deploy the sample workspace (`scripts/deploy-demo-workspace.mjs`) to a **FRESH folder path** on the Legion (e.g. `Documents\Beacon Ridge Demo`).
3. Open it in the app as a new workspace. Register the 3 households (Hendersons; Maria & Luis Alvarez; Dr. Priya Nair) as clients via the normal **+ New client** flow mapped to their folders.
4. **The core check:** client-scoped Ask questions from `DEMO-QA-CRIB.md` — the answers must come from the PRE-EXISTING .docx/.pdf files WITH clickable citations. Test at least 2 questions per household (docx-sourced AND pdf-sourced).
5. **The acid test:** close the app fully, reopen the SAME workspace, ask again — must still answer with citations.
6. Also spot-check with Local AI mode for one question (model is pre-downloaded and verified on this machine).
7. Screenshot every claim. Write `coordination/qa-campaign/evidence/legion-qa92-verify/REPORT.md` with PASS/FAIL per check + exact tip SHA. Commit + push (`--no-verify`).

## Rules
- If a check fails, capture the failure precisely (screenshot + app logs if reachable) and continue the remaining checks — a partial scorecard beats an early abort.
- Don't fix anything; report only.
- If the Legion is unreachable/broken >15 min of honest attempts, report BLOCKED with what you tried.

## Done criteria (HARD)
Evidence committed AND pushed. THEN print exactly: `WORKER-DONE: legion-qa92-verify` + PASS/FAIL per check in plain language.
