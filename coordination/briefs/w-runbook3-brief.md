# Worker brief — runbook final edits (docs-only; the stamp itself waits for the retest)

You are **cc-lantern-runbook3**, worktree **~/lp-runbook3**, branch **lp/runbook-final-edits** (off tip 658dbf13). Docs-only; push --no-verify. You do NOT merge.

## Voice (non-negotiable)
Jameson is a designer, not an engineer — the runbook reads like a friendly stage script a smart 10-year-old could follow. Keep the existing voice exactly. No paths/jargon in presenter-facing lines.

## Edit `docs/demo/DEMO-RUNBOOK.md` per these findings (read the sources: coordination/qa-campaign/evidence/legion-dressrun1/REPORT.md on lp/legionverify-evidence; the pre-flight notes in the same evidence tree)
1. **Step 1 (dress F2):** script the exact clicks to reach the "✓ Working" checkmark: Settings → AI & Privacy → scroll down → "Manage AI Account Keys" → the checkmark is beside each provider. Also note the checkmark now REMEMBERS itself and shows "checked N minutes ago" (fix merged) — the presenter just points, no re-checking needed.
2. **Step 3 (dress F4):** the PRIMARY path is now the staged PDF kit: a folder called "Practice Reference Library" (~30 small PDFs) sits ready on the demo machine; the script says to point the app at it (or restart the app if it's pre-placed — the live verification saw "Indexing PDFs: 17 / 36" on a normal restart) and narrate the visible progress line. Keep "this one was quick" as the fallback line, not the plan.
3. **Step 4 (dress F6):** script the mode-switch honestly: gear icon → AI & Privacy → tap the "On this computer only" card (mention the little lock message that appears — that's the network lockdown switching on, a GOOD thing to narrate) → back to Ask. Then: ask a THROWAWAY warm-up question first, then the real one. (The cold-start fix merged, but the warm-up habit costs nothing and guarantees smoothness.)
4. **Prep checklist:** add "use the one-click Check button for each AI key (no need to spend a real question)"; add "delete/clean any leftover test meeting recordings under demo clients"; add "if the welcome tour pops up, dismiss it" (fix merged, belt-and-suspenders); confirm the sidebar-tidy item reflects that archived clients now disappear from the rail automatically (fix merged).
5. **Step 2:** note Outlook's connection status honestly — if it isn't connected on demo day, the script's line is "email is one of the connectors — here are OneDrive and Wealthbox live" (do not fake it).
6. Do NOT remove the DRAFT banner — the coordinator flips it after the retest + 3× dry-run.

## Done criteria (HARD)
Edits applied, reads smoothly end-to-end, committed AND pushed (`git push --no-verify -u origin lp/runbook-final-edits`). THEN print exactly: `WORKER-DONE: lp/runbook-final-edits` + 2-line summary.
