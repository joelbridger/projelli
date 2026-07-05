# Bench brief — Meetings FULL re-verify on the Legion (the re-declare-DONE gate) + Zoom call test

**Lane:** cc-lantern-meetverify2 · dir `~/lp-bench` (evidence worktree, branch `lp/windows-smoke-evidence` — never switch it). **Model:** Sonnet 5 · high.
**Context:** everything found in the first walkthrough is now fixed and merged: QA-30 (meetings vanishing after restart) @cb1181c9, plus the whole UX polish. The speech sidecar IS staged and verified on the Legion ("Voice ready" — see the SIDECAR STAGING addendum in docs/evidence/meetings-verify-20260704/RUN-LOG.md for what lives where). You are the FINAL gate: a full PASS here re-declares the Meetings feature DONE. Be skeptical.

## Seat
The Legion (`james@100.127.67.22`), one driver — you own it. Update repo to current `origin/lantern-plus` tip (must include cb1181c9), rebuild, launch. Re-enable the `LanternPlusDev` scheduled task if needed (it was left disabled; qa4's note: if the task won't start from a non-interactive SSH session, an `az`-style full reboot of the box is NOT available — it's a physical laptop — try schtasks run / an interactive-session workaround and report if truly stuck). Drive via `scripts/desktop-drive.mjs` + `scripts/legion_agent.py`. Unique local tunnel port (NOT 9444/9448).

## Mission — the full loop, twice over
1. **Teams pass (the DONE gate):** host a real Teams call (demo M365 account, second endpoint in browser — same recipe as realcall/meetverify), record ≥3 min of genuine two-party speech via the record pill against a specific client. Verify in order: consent dialog first + accurate + ledger entry; pill shows Recording + the local-privacy line; zero egress during record+transcribe (watch the indicator AND monitor lantern.exe connections); stop → "Writing your meeting notes…" state; transcription actually runs now (sidecar staged) → REAL transcript matching what was said, both sides; notes render with "(at m:ss)" timestamps (no raw [t:ms] tokens); audio-seek from transcript works; meeting title is human. THEN THE BIG ONE: **close and reopen the app — the meeting (and any older ones) MUST still be listed** (QA-30 fix live-verified). Also kill-and-relaunch mid-idle once. Screenshot every step — these go to Jameson.
2. **Zoom pass (same session):** log into the Zoom demo account (creds `~/keepance-coordination/demo-creds/zoom-account.md`, browser), host an instant meeting, join from a second browser context, record it in the app the same way. Verify both channels contain the real call audio + transcription + note lands. This confirms the capture mechanism on Zoom (Teams already confirmed; Meet awaits Jameson's account tap).
3. Time-permitting: QA-10 (onboarding "Go!" CTA visibility on real hardware — needs an app-data wipe; do it LAST and restore the backup after, or skip and say so).

## Reporting
Evidence under `docs/evidence/meetings-verify2-20260704/` on `lp/windows-smoke-evidence`, committed+pushed (`git branch --show-current` first). Per-step PASS/FAIL/BLOCKED, honest. Plain-language summary for Jameson with the screenshot list. Leave the Legion quiet (app closed, tunnels closed, scheduled task back to its at-rest state). Last line exactly: `WORKER-DONE: meetverify2`

## Landmines
Never fix product code — findings route to the coordinator. No cloud transcription. Never touch `~/lantern` on the Legion. No interactive menus — `COORDINATOR:` plain text.
