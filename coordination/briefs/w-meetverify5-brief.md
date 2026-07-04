# Bench brief — the FINAL fresh-session Meetings check (record → transcript → notes, no fixtures)

**Lane:** cc-lantern-meetverify5 · dir `~/lp-bench` (evidence worktree, lp/windows-smoke-evidence — never switch). **Model:** Sonnet 5 · high. **You own the Legion.**
**Context:** ALL FOUR Meetings blockers are now merged at tip (@e4b0f30d+): QA-30 vanish, QA-31 notes watchdog, QA-40 transcript (both bugs), and QA-41 (the Windows verbatim-path transcript-read failure that blocked notes — root-caused and fixed at 3 layers): QA-31 notes watchdog+retry (live-verified), QA-40 transcript fixes (live-proven with 3 real recordings by the transfix lane). **Your single mission: the clean, fresh, no-fixtures run that declares this feature DONE.** meetverify4's run proved everything up to notes (word-for-word transcript); QA-41 was the last blocker and is now fixed. If notes land this time, Meetings is DONE — your screenshots go straight to Jameson.

## The run
1. Update the Legion repo to current `origin/lantern-plus` tip, rebuild, reboot the app FRESH (kill anything running first; clean session — no leftover state from transfix's testing; verify the AI provider key state is healthy in Settings before you start, since transfix broke/restored it in its tests).
2. Record ONE short real meeting (~60-90s; the TTS-through-speakers recipe transfix used is fine — real capture path, real audio).
3. Watch the FULL pipeline with no intervention: stop → transcription completes (should now work — QA-40 fixed) → "Writing your meeting notes…" → **notes LAND**. Screenshot each stage; the landed note is the money shot.
4. If notes do NOT land: capture everything (the meeting.json state, any notesError, the console/log tail, how the UI reports it — the watchdog should produce an honest error within ~2 min, never a silent stall), then try ONE retry via the UI and record what happens. Do not fix anything.
5. Quick sanity: restart the app once — meeting + transcript + notes still listed.

## Reporting
Evidence `docs/evidence/meetings-verify5-20260704/` on lp/windows-smoke-evidence, commit+push (branch-check first). Verdict per stage PASS/FAIL. Plain-language summary. Leave the Legion quiet. Last line exactly: `WORKER-DONE: meetverify5`

## Landmines
No product code changes. No fixtures/seeding — the whole point is the untouched natural path. Unique tunnel port. No interactive menus.
