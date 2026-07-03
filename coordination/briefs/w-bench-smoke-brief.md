ROLE: Windows bench worker — interim real-Windows smoke of the merged Lantern-Plus Waves 0-2.

MISSION: On the Legion Windows laptop (reserved for us), bring the machine up to the lantern-plus branch tip, run the app, and DRIVE the new features like an advisor would. You do the testing yourself — NEVER ask Jameson to run, click, or verify anything (rare exceptions: physical taps only). Report every defect with reproduction steps; fix NOTHING (this is a test lane, not a fix lane).

READ FIRST: ~/.claude/projects/-home-jameson/memory/reference_keepance_desktop_control.md (bench access: Tailscale james@100.127.67.22, scripts/desktop-drive.mjs over CDP port, scripts/legion_agent.py for native dialogs) + ~/lantern-plus/LANTERN-PLUS.md (fork rules — the bench checkout must be on branch lantern-plus of the same repo; NEVER touch keepance-3.0 there; restore the bench's prior branch state when done).

WORKDIR: ~/lantern-plus (READ-ONLY for you except docs/evidence/ — you are not a code lane). Local evidence + your run log go to docs/evidence/windows-smoke-1/ on a branch lp/windows-smoke-evidence.

SMOKE SCRIPT (drive each; screenshot each; note exact failures):
1. Bench prep: fetch + checkout lantern-plus tip on the bench clone, npm install if needed, launch the dev build (run-dev per the bench docs). Confirm version/branch on screen.
2. Wave 0: open a client note → Draft follow-up (1 click) → verify the modal populates, citations show hover previews, Close CANCELS generation; save to Drafts → verify it lands in the real mailbox's Drafts (bench test account per bench docs). Client Map: source chips name the notetaker; "Imported meeting notes" filter works.
3. Wave 1: Account→Connections→CalendarConnect card renders; connect the bench's test Outlook calendar (1 click + OAuth); sync (1 click); Today's-meetings strip appears on Client Map with correct client matching; a before-you-meet brief generates with per-bullet citation chips + hover previews; agenda export produces a real .docx that opens in Word.
4. Wave 2: from a client note, Send to Wealthbox → review card (2 clicks to send incl. Approve); verify the note actually appears in the bench's Wealthbox test account; try a field-level update → 3-column review renders, edit the blend, approve; disconnect/reconnect Wealthbox → verify no duplicate posts on retry.
5. Cross-cutting: light theme everywhere; no console errors flooding; egress indicator behavior sane in Local-only mode (briefs should refuse/queue, not silently call cloud).

HANDOFF BAR: a run log (docs/evidence/windows-smoke-1/RUN-LOG.md) listing each step PASS/FAIL with screenshots, exact repro for every failure, and a severity guess (P0 blocks demo / P1 wrong behavior / P2 polish); commit+push the evidence branch; restore the bench to its prior branch; print the sentinel as the very LAST line: WORKER-DONE: windows-smoke-1 ready for review

MAIN-LINE HANDOVER CONDITIONS (from their bulletin release line — BINDING):
- Their handover may still be in progress when you start: VERIFY the bench is quiet first (their app closed, their tunnels down) before touching anything; if their processes are still running, wait and re-check every few minutes.
- Leave C:\bench-backups\ and C:\KeepanceWorkspaces\ COMPLETELY untouched (their snapshot + Jameson's pending personal test live there). Use a separate workspace folder for your smoke (e.g. C:\lantern-plus-smoke\).
