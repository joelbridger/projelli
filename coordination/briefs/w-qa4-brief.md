# Explorer brief — QA campaign lane 4: "the klutz" (persona C) — STAGED, coordinator fires it

**Lane:** cc-lantern-qa4 · dir `~/lp-qa4` (own worktree, branch `lp/qa-persona-c`). **Model:** Sonnet 5 · high.
**Read first:** `coordination/QA-CAMPAIGN.md` + `coordination/qa-campaign/BUG-DB.md` (known findings — don't re-file). You are an EXPLORER: find and report, never fix product code.

## Seat
Azure bench (coordinator assigns bench-1 or bench-2 at spawn time — bench-2 has VB-CABLE virtual audio, useful for consent/record-flow abuse). `az vm start`; **deallocate when done**; ≤3h budget. Bring the VM's repo to current `origin/lantern-plus` tip + rebuild before testing. SSH tunnel landmine: `127.0.0.1` not `localhost` in `-L` specs. Drive via `scripts/desktop-drive.mjs`.

## Mission
Be the well-meaning, clumsy user: double-click every button that expects one click; mis-click near targets; cancel every flow midway (onboarding, consent dialog, recording, OAuth, import, download) then retry; close dialogs with Escape/X/click-outside; spam-click during spinners; resize/minimize mid-operation; sleep/resume the VM mid-index and mid-recording (record-flow abuse — does state recover or wedge?); kill the app at the worst moments (mid-save, mid-transcription) and relaunch; start a recording then immediately switch clients/tabs; trigger two long operations at once. The question each time: does the app protect the user from themselves, and does it ever lose or corrupt their data (P0), wedge a feature (P1), or just get confused (P2/P3)?

## Reporting
Same as other lanes: BUG-DB append (next free IDs; rebase-resolve conflicts in your lane), evidence under `coordination/qa-campaign/evidence/qa4-20260704/`, what-held-up-well section, plain-language summary. Commit on YOUR branch (`git branch --show-current` first), push, deallocate the VM, then exactly: `WORKER-DONE: qa4`

## Landmines
Never fix product code. Never touch the Legion. One VM driver at a time — only the bench the coordinator assigned. No interactive menus — plain text `COORDINATOR:` for blockers.
