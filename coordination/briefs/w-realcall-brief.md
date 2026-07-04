# Explorer brief — Real Microsoft Teams CALL recording verification (answers Jameson's cross-client question)

**Lane:** cc-lantern-realcall · dir `~/lantern-plus`. **Model:** Sonnet 5 · high. You OWN the Legion for this lane (one driver rule).
Read `coordination/QA-CAMPAIGN.md` first. This is the TOP QA priority: prove meeting capture works on a REAL Teams call, not just test audio.

## Why
Jameson asked to confirm recording works across Zoom/Teams/Meet. The engine is device-agnostic by design (captures system audio + mic, not the meeting app), and passed hardware tests with test audio — but no real video-call has been recorded end-to-end. Teams is first (demo M365 account already signed in). This produces the live evidence.

## Setup (all on the Legion, driven by you)
- Legion: Tailscale `james@100.127.67.22`, `C:\lantern-plus`, app via `LanternPlusDev` task. Pull to origin/lantern-plus tip, rebuild, freshness canary (standard bench discipline — see any recent RUN-LOG for the pattern).
- The demo M365 account (Sarah Morgan, de-passkeyed password+TOTP in `demo-creds/sarah-morgan-account.md`) can host a Teams meeting. Start a Teams meeting in the signed-in browser/app. To get REAL two-way audio into the call without a second human: join the same meeting from the always-on server Chrome (`chrome-cdp`) OR play a spoken-word audio clip through the meeting as the "other party" — the goal is genuine call audio on BOTH the loopback (Them) and mic (You) channels. Document exactly how you produced each side.

## The test
1. With the Teams call live and audio flowing both ways, invoke `capture_start` over CDP against the demo client's matter folder (same pattern as w3's Task 6 device verification — find it in the capture command surface; `capture_start`/`capture_stop`), record ~60-90s of real call audio, `capture_stop`.
2. Verify the produced WAV: both channels contain real audio (loopback RMS well above noise from the call's far side; mic RMS from the near side). Report RMS numbers.
3. If the transcription pipeline (Task 8 `transcribe_meeting`) has merged by the time you run, also run it and check `transcript.json` has both "You" and "Them" segments with sensible text. If not merged yet, note that and stop at audio verification.
4. Bonus if time: repeat the audio-capture check while a Zoom or Google Meet call is the audio source instead (any account; even a test meeting with music playing proves the source-agnostic claim). Even one extra client strengthens the evidence.

## Report
Evidence (WAVs + RMS + how you sourced call audio + screenshots) to `coordination/qa-campaign/evidence/realcall-20260704/`, committed on `lantern-plus` (check branch first). A plain-language verdict for Jameson: "Teams call recording: confirmed / not yet — because…". Append findings to `coordination/qa-campaign/BUG-DB.md` if anything's broken. Leave the bench quiesced (app stopped, task Disabled, Teams call ended, tunnels closed). Last line exactly: `WORKER-DONE: realcall`
