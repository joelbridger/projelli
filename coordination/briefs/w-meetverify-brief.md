# Bench brief — Meetings feature LIVE end-to-end verification on the Legion (the re-declare-DONE gate)

**Lane:** cc-lantern-meetverify · dir `~/lp-bench` (the permanent evidence worktree, branch `lp/windows-smoke-evidence` — NEVER switch its branch). **Model:** Sonnet 5 · high.
**Fires only when the coordinator says GO** (needs: w3ux polish merged to `lantern-plus` + the Legion free). You are the LAST gate before the Meetings feature is re-declared DONE — be skeptical, not charitable.

## Seat
The Legion Windows laptop (Tailscale `laptop` = `james@100.127.67.22`). One driver at a time — confirm with the coordinator you own it. Bring its repo to the current `origin/lantern-plus` tip, rebuild, launch. Drive via `scripts/desktop-drive.mjs` (CDP) + `scripts/legion_agent.py` for native dialogs. A REAL HEADSET is plugged in (mic + loopback) — use it.

## Mission — record a real meeting and read the notes, like an advisor would
1. Host a real Teams call from the demo M365 account (the `realcall` lane proved this path — see `coordination/qa-campaign/evidence/realcall-20260704/`; creds `~/lantern-coordination/demo-creds/sarah-morgan-account.md`). Join from a second endpoint (browser session) so there's genuine two-party audio; speak/play audio on both sides.
2. In the app: start recording via the record pill against a specific client. The consent dialog must appear FIRST and be accurate (two-party); confirm the consent ledger entry after.
3. Record ≥3 minutes of real conversation, stop, let transcription run (local only — any network egress during transcription = P0, watch the egress indicator).
4. Verify the artifacts as a user: the meeting lands in that client's Meetings tab; the transcript is real (matches what was said, both sides); audio-seek works from transcript lines; notes render; needs-review queue behaves; dictation filing if reachable.
5. Screenshot EVERY step (consent dialog, recording pill live, transcript, notes, Meetings tab) — these go to Jameson so he can see his feature working.
6. While there, also confirm on real hardware: QA-10 (is the onboarding "Go!" CTA actually invisible on a real screen? needs a first-run app-data wipe — do this AFTER the meeting test, or skip if time-boxed and say so).

## Reporting
Evidence under `docs/evidence/meetings-verify-20260704/` on `lp/windows-smoke-evidence` (commit in ~/lp-bench, `git branch --show-current` first), push. Verdict per step: PASS/FAIL/BLOCKED with honest calls — a wedged state, wrong consent metadata, or a transcript that doesn't match reality is a FAIL, not a note. Plain-language summary for Jameson. Leave the Legion quiet (app closed, no stray processes). Last line exactly: `WORKER-DONE: meetverify`

## Landmines
Never fix product code (report; the coordinator routes fixes). No cloud transcription paths. Never touch `~/lantern` (main line) on the Legion. No interactive menus — blocking decisions as plain text `COORDINATOR:` lines.
