# Legion QA-91 Live Retest — Round 4 — Notice Card at tip 658dbf13 (layer-4 admitted-phase fix)

**Date:** 2026-07-06
**Bench:** Legion Windows laptop (Tailscale `james@100.127.67.22`)
**Tip verified:** `658dbf13` (merge: `lp/qa91d-admitted` — admitted-state detection grounded in real in-meeting DOM, admission latch scoped to in-call drift; also contains the Local-AI warm-up fix)
**Worker:** cc-lantern-legionverify

## Headline result: **PASS — the step-5 decider holds.**

The Notice Card now reaches the lobby, gets admitted, becomes visible to a real second participant, and **stays visible and correctly-reported for the full meeting** — not just a few seconds like round 3. This is the fix that was missing.

**Definitive proof, straight from the app's own record (`.consent-ledger.json`):**
```
notice-context   07:49:21.214Z
notice-card-joined  07:50:11.618Z   ← genuinely "joined", not "failed"
notice-card-left    07:55:36.837Z   ← clean, deliberate leave (I clicked Stop), not a forced failure-close
```
**5 minutes 25 seconds of continuous, honest presence** — the card left only because I stopped the recording, not because the app gave up on it.

**One gap remains, separate from the step-5 fix:** the resulting transcript came back empty (`"segments": []`), so **Step 6 (Search Transcript) still cannot be exercised** with this recording. Read on for exactly why and what's needed — this is a testing-environment gap I hit, not a new app bug found this round.

---

## What I did, in order

### 1. Rebuild (with a real landmine — corrected the restart method)

Pulled `C:\lantern-plus` to `658dbf13` and rebuilt (`npm run tauri build`, debug profile — compiled clean in 3m39s; the only failure was the installer *signing* step, irrelevant for local testing). Restarting the running app turned out to be the interesting part:

- I initially restarted via `Start-ScheduledTask KeepanceDev` (the same command used in the earlier F4 staging job). **This task is stale/broken** — its `run-dev.bat` points at `C:\keepance`, which is an **empty folder**, not this repo. It silently no-ops.
- The actual mechanism that had been restarting the app all session is a **standing `npm run tauri:dev` supervisor**, started once the night before via a *different*, correctly-configured task: **`LanternPlusDev`** (`C:\run-dev-lantern.bat`, `cd C:\lantern-plus; npm run tauri:dev`). Killing the app process while that supervisor is alive gets it auto-relaunched from the correct code. But my manual one-shot `npm run tauri build` run today appears to have knocked that supervisor out (the log shows it died on the binary exit and didn't come back).
- Fixed by explicitly restarting via `Start-ScheduledTask LanternPlusDev`, watching `C:\tauri-dev.log` for the Vite+cargo boot sequence, and confirming via CDP screenshot.

**Correction to a prior finding (QA-83, filed in `legion-staging/REPORT.md`):** that report attributed a sidebar-shows-archived-clients regression to "a full app restart." Having now done a *proper* restart via the correct `LanternPlusDest` supervisor, **the sidebar came back completely clean — only the 3 real households, no archived-client bleed-through.** This strongly suggests QA-83 was **not a real code regression**, but an artifact of the earlier restart having gone through the broken `KeepanceDev` path (which may have left the old process/webview in some half-torn-down state rather than doing a genuine clean boot). Recommend downgrading QA-83's confidence pending one more deliberate repro attempt with the correct restart path — I did not have time to specifically re-attempt that repro this round, so I'm flagging the doubt rather than closing it outright.

### 2. Real 2-person Teams meeting, same method as round 3

- Created a fresh meeting ("QA-91 Round 4 Retest") via the server's shared Chrome (host, signed in as `microsoft@projelli.com` / "Jameson Daines").
- Joined a genuinely separate second participant — Chrome **Guest mode** launched on the Legion's own local desktop via the pyautogui agent (`legion_agent.py`, Win+R → direct `chrome.exe --guest` launch — SSH-launched GUI processes land in the wrong Windows session and don't work for this).
- Started the recording from The Hendersons' Meetings tab, pasted the meeting link, confirmed consent, clicked Start recording.
- Both the Notice Card and the guest ("Sarah Morgan (guest observer)") reached the host's lobby together — screenshot-equivalent confirmed via `Waiting in lobby (2)` — admitted both with **Admit all**.

### 3. The decisive check: does it stay?

- **T+15s (guest's own view):** `01-DEFINITIVE-admitted-tile-visible-t00-15.png` — visible, clearly labeled "Recording Notice (Guest)" tile, not black. The app's own recorder widget already read **"Notice card in meeting"** (not the stale "waiting to be let in" text round 3 got stuck on).
- **T+~1:30, 2:00, 3:00 (polled every 15s via the host's Participants panel):** tile still present every single check — no flicker, no drop.
- **T+4:36 (guest's own view), recording widget at 5:26:** `02-still-present-t04-36-recording-5-26.png` — still there, still labeled correctly, widget still says "Notice card in meeting." This is roughly **10x longer** than round 3's ~28-second failure point.
- Stopped the recording manually. Both host and guest saw a clean departure — `03-clean-leave-after-stop.png` shows the guest's own "left the meeting" screen, not a card that vanished mid-call.

**Conclusion: all three fix layers from rounds 2–3 (launcher skip, prejoin, lobby/admission) still work, and the round-4 fix (admitted-phase detection grounded in real in-meeting DOM) closes the exact gap QA-82 found — the card now knows it's actually in the meeting and stays there.**

### 4. Step 6 (transcript) — attempted, not achieved this round

I tried to make this recording produce a **real transcript** by feeding synthetic speech (a ~3:10 Windows-SAPI-generated recording of realistic advisor talking points — RMD figures, asset allocation, Roth conversion, matching the dress-rehearsal crib questions) into the guest's microphone two ways:
1. Launched the guest Chrome with `--use-fake-device-for-media-stream --use-file-for-fake-audio-capture=<wav>` — the prejoin screen still showed the **real** hardware mic name ("Microphone (AB13X USB Audio)"), not a fake device, so this flag did not take effect (Chrome Guest-mode may restrict or ignore it).
2. As a fallback, played the WAV through the Legion's default speakers via a PowerShell `SoundPlayer`, hoping for acoustic pickup — launched via SSH, which (per the same known SSH-session-isolation issue that affects GUI launches) may not have actually routed to the interactive session's audio device at all.

**Result:** `audio.wav` (24MB, matching the ~6-minute recording) exists, but `transcript.json` came back with `"segments": []` — empty, same as every prior QA-91 test recording. Step 6 still needs either a real human voice on the call, or a properly-wired synthetic-audio pipeline (a virtual audio device correctly configured on the Legion, launched in the *interactive* session) — neither of which I achieved this round. **This is a testing-tooling gap, not a new finding about the app itself.**

---

## Verdict — precise, not overclaimed

- **Step 5 (Record Meeting): PASS.** The specific, literal criterion — card reaches lobby, gets admitted, tile visible with text, and now *stays* for the full meeting while the app accurately reports its presence — is met, proven with a real second participant and the app's own ledger. This is the fix the coordinator asked to confirm, and it holds.
- **NOT "all six demo steps green."** Step 6 (Search Transcript) remains **unverified** — not because of any app bug found this round, but because I could not get real speech into this test recording. Steps 1–4 carry the same caveats already on record from the dress rehearsal (`legion-dressrun1/REPORT.md`) — mostly script/UX gaps, not blocking bugs.
- **So: 5 of 6 steps are demonstrably solid** (1–4 with known minor script caveats already filed, 5 now fully fixed and proven). **Step 6 needs one more round** — ideally a real live 2-person conversation (or a working synthetic-audio rig) recorded end-to-end, to prove the cited-transcript-answer flow the same way Step 4's document/email answers were already proven.

## Evidence
3 screenshots in `screenshots/`, named for the story they support. Consent-ledger excerpt quoted above (authoritative, not a screenshot).

## State left on the Legion
- App running at tip `658dbf13`, restarted via the correct `LanternPlusDev` task, Cloud AI mode, Beacon Ridge Demo workspace, sidebar clean (3 clients only).
- This round's meeting recording sits under The Hendersons' Meetings tab (empty transcript, ~6 min audio) — left as evidence.
- Guest Chrome (Guest mode, no persistent login) closed.
- `qa91d-host` chrome-cdp session closed.
- Cleaned up scratch scripts/screenshots left on the Legion during this round.
