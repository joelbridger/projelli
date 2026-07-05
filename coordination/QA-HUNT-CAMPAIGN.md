# Aggressive Real-Windows Bug Hunt — continuous campaign (Jameson-directed 2026-07-05)

**Mandate:** keep pushing hard on real Windows to find + fix bugs, continuously, across all 3 machines in parallel. This is the standing "real-OS-first" doctrine (WORKER-DISCIPLINE.md) run at full intensity. As each hunt lane finishes, the coordinator redeploys a fresh one to the latest tip — the hunt does not stop.

## The 3 machines, distinct angles (parallel, no overlap)
- **Legion (real hardware, real headset, warm at tip):** the AUDIO + isolation-under-real-use angle. Meetings full flow, Notice Kit consent, recording edge cases, AND live-reproduce the sweep-found cross-client leaks with real recordings.
- **cloud bench-1 (non-audio):** ISOLATION + outbound-guard angle. Live-reproduce the race-sweep P0s (QA-52/53/56/57/58: workspace-lands-wrong, email-files-wrong-client, citation-verdict-wrong-card, privilege-explainer-wrong-context, memory-facts-stale) — switch clients/workspaces/emails FAST mid-async and watch for data bleed. Plus the Tier B outbound guards (try to get unreviewed AI text to CRM/email).
- **cloud bench-2 (VB-CABLE audio):** EDGE/KLUTZ + honesty angle. Fresh-first-run, weird inputs, mis-clicks, the Tier A honesty surfaces, AND QA-54 (voiceprint cross-client — record for client A, switch to B, check B doesn't show A's voice profiles).

## Every hunt lane's rules
- Record its exact tip SHA + rebuild (a stale tip = false findings — WORKER-DISCIPLINE §2).
- File findings to coordination/qa-campaign/BUG-DB.md continuing IDs (currently at QA-59). Severity + repro + screenshot + honest "real or my setup?" call.
- Especially: try to LIVE-REPRODUCE the static-sweep P0s (QA-44, 52-59) — a confirmed live repro upgrades them from static-suspected to proven and gives the fix lane gold.
- Deallocate the cloud VM when done; Legion left quiet. Coordinator redeploys the next round.

## Coordinator loop
On each hunt WORKER-DONE: triage findings → fix lanes (P0/P1 immediately), then redeploy a fresh hunt to the latest tip (rotating the angle if a machine's angle is exhausted). Pace new findings to review capacity, but keep all 3 machines driven. The idle-capacity monitor flags any bench that goes idle.
