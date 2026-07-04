# Bench brief — SCOPED Meetings notes re-check on the Legion (the final DONE gate)

**Lane:** cc-lantern-meetverify3 · dir `~/lp-bench` (evidence worktree, branch `lp/windows-smoke-evidence` — never switch it). **Model:** Sonnet 5 · high.
**Fires only on coordinator GO** (needs lp/meeting-notes-hang merged). Everything else already PASSED live today (see docs/evidence/meetings-verify2-20260704/): consent, recording, zero egress, real transcripts on Teams AND Zoom, audio-seek, restart persistence. The ONLY unverified step is notes generation, which hung forever and is now fixed (120s watchdog + classified honest errors + retry). This is a SHORT, scoped session — verify the one fixed step end-to-end plus its honest-failure UX, then Meetings is DONE.

## Seat
The Legion (one driver — you own it on GO). Update repo to the tip the coordinator names, rebuild, launch. Sidecar is already staged ("Voice ready"). Unique local tunnel port (not 9444/9448).

## Mission (scoped — don't re-run the whole walkthrough)
1. Record a SHORT real call (~60-90s — a solo Teams meeting with the demo account speaking, or Zoom instant meeting; two-party niceties NOT required, transcript+notes is what matters).
2. Stop → watch "Writing your meeting notes…" → **notes must actually LAND this time** (real note content in the meeting page, timestamps "(at m:ss)" formatted). Screenshot the written note — this is THE money shot for Jameson.
3. Also verify the honest-failure path once: temporarily break the provider (e.g. block the endpoint or remove the key), retry notes on a meeting → the UI must show the classified honest error (not an eternal spinner) and the RETRY must work after restoring the provider. Screenshot the honest-error state too.
4. Confirm the meeting list still persists across one app restart (30-second sanity, not a full pass).

## Reporting
Evidence under `docs/evidence/meetings-verify3-20260704/` on lp/windows-smoke-evidence, commit+push (`git branch --show-current` first). Per-step PASS/FAIL. Plain-language summary for Jameson. Leave the Legion quiet. Last line exactly: `WORKER-DONE: meetverify3`

## Landmines
Never fix product code. No cloud transcription. Restore anything you broke for step 3 (key/endpoint) and SAY you restored it. No interactive menus.
