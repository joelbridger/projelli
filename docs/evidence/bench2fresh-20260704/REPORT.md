# bench2fresh — fresh-eyes first-run + audio pass on `lantern-cloud-bench-2`

**Date:** 2026-07-04 · **Lane:** cc-lantern-bench2fresh · **Target:** Azure `lantern-cloud-bench-2` (VB-CABLE virtual audio) · **Repo commit tested:** `origin/lantern-plus` @ `36d8eb2a` (updated + rebuilt at session start).

**Role:** a brand-new, skeptical financial advisor meeting the app for the very first time — true fresh install (app-data wiped, no existing workspace), WITH working audio via VB-CABLE, so this pass could actually record and transcribe a real ~90s meeting, not just click through screens.

## Bottom line

Onboarding, the Client Map, citations, the Notice Kit consent flow, and the Data Map all held up well to a skeptical first-time read — no overclaiming found anywhere. But the **meeting-notes pipeline is broken for a first-time local-AI user**: transcription reliably fails ("the voice engine returned an error"), and when it fails, the notes panel is left saying "Check back in a moment" **forever**, with no error and no retry. A brand-new advisor who records their first meeting and picks local AI will get a recording that goes nowhere, with no way to know that or fix it themselves.

## What a fresh user sees — onboarding (all good)

1. **Welcome screen** (`01-fresh-launch.jpeg`): "A private AI that knows your clients." — accurate, not oversold. Three-step flow (Connect your AI and files → builds Client Maps → Ask anything, with sources) plus two honest pills: "Our servers never see your documents or prompts" / "Vault: optional AES-256 encryption" (correctly says *optional*, doesn't overclaim it's always on).
2. **"How do you want to start?"** (`02-after-go.jpeg`): sample-practice vs. connect-your-own-data, both clearly described, "You can always switch later." No dark patterns steering away from the honest option.
3. **AI connect step** (`11-after-ok.jpeg`): cloud card says "Providers are SOC 2 Type 2 certified" (correct, not "Advisor Prep Hero is SOC 2 certified" — attributes the certification to the right party); local card is balanced ("Not as great with complex reasoning," 2.5GB/~5min download disclosed upfront).
4. **Connect-your-data step** (`12-local-ai.jpeg`): a genuinely nice honest touch — the Microsoft 365 card detects **this machine has full-disk encryption off** and says so explicitly, recommending FileVault/BitLocker. That's not a canned string; it's a real, accurate disk-encryption check on this VM.
5. **Setup progress screen** (`13-step3.jpeg`): Email/Wealthbox/Files correctly show "Not started" (I skipped them) rather than faking completion.

**Environment note (not a product bug):** both onboarding paths — "Start with a sample practice" and "Connect my own data" — open a real native Windows folder-picker dialog before anything else, and a cloud bench has no way to drive that dialog visually (no pyautogui-style screen bridge exists on bench-2, unlike the Legion). It cost real time to work around (see Landmines below). Worth calling out for future cloud-bench sessions: **the app does have a graceful in-app fallback** ("Type the folder path" text input) when the native picker doesn't respond in time — that's a nice piece of defensive UX that happened to be exactly what a scripted/automated environment needs. Screenshot: `10-after-confirm.jpeg`.

## Client Map + citations (good)

- Sample "Hendricks Household" populated correctly, Client Map sections (Household, Goals, Money and accounts, Follow-ups, What I'm missing) all present.
- Three "Sources" cards, each marked **"Verified against source"**.
- Clicked citation #1 → opened the real underlying file (`Sample - Household Overview.md`) in the Documents editor with matching content. Citations are real, not decorative. (`21-household.jpeg`, `23-citation-opened.jpeg`)

## Data Map / Privacy (good — Wealthbox claim verified against source)

Opened via the map icon in the top trust bar ("Open the Data Map"). Plain-English, printable, matches the brief's ask:

- **Wealthbox row, expanded** (`46-wealthbox-row.jpeg`): "Your Wealthbox connection runs from your machine to Wealthbox... Advisor Prep Hero reads your Wealthbox data by calling Wealthbox directly from your machine... Advisor Prep Hero never sees your CRM data." Checked the actual source (`src/platform/privacy/ui/DataMapDialog.tsx:109`) and the caveat line is explicit: **"The connection is read-only: Advisor Prep Hero never writes anything back to Wealthbox."** Copy matches code — honest.
- Also present: files-stay-local, AI keys in OS keychain, cloud-prompt-goes-direct-to-provider, local-model-for-sensitive-work, email-encrypted-on-device rows — all consistent with the rest of the app's claims.

## Meetings + real audio (the core of this pass) — mixed: consent flow good, transcription pipeline broken

**Setup:** VB-CABLE virtual mic/speaker (installed in a prior spike session) were already the system default playback/recording devices. Simulated a ~90s real client meeting using Windows SAPI text-to-speech spoken through the virtual cable — this is genuinely captured by the app's live audio pipeline (cpal/WASAPI), not a pre-baked file.

1. **Record button → Notice Kit consent dialog** (`25-record-clicked.jpeg`): exactly matches the brief's expectation — a "say this out loud" script ("Quick note before we start. I'm recording this meeting for my notes...") with an explanation that the app checks the transcript afterward and files it as proof. A required "I have the consent I need" checkbox gates the Start button. Good, no way to skip past consent messaging.
2. **Recorded ~87s** of simulated meeting audio (a fake advisor/client conversation about retirement planning, IRA rollovers, beneficiary updates — content chosen to mirror the sample household). Live recording pill showed a real running timer, "Local" badge, Stop button. (`26`–`29-recording-progress*.jpeg`)
3. **Stopped** → meeting entry created immediately: "Meeting · Jul 4, 2026 · 1 min · notes pending" with a **"Needs review"** badge. (`31-stopped2.jpeg`)
4. **Opened the meeting** (`33-meeting-detail2.jpeg`): "Consent noted · two-party" — **the Notice Kit correctly detected the spoken consent notice in the recording and verified it**, exactly the notice-verified state the brief asked me to confirm. Real waveform, 1:27 duration, playable. "The recording-notice check runs entirely on this computer" (honest, no cloud round-trip needed just to check consent).
5. **Transcription: FAILS.** Right panel: *"Transcription couldn't finish. The voice engine returned an error. Your recording is safe."* with a "Try again" button. Retried 3 times across 2 separate app restarts — same failure every time, not a one-off session hiccup. No corresponding error in `tauri-dev.log` (the failure isn't logged server-side at all, which will make this hard for a real user to report accurately).
6. **Notes: silently stuck forever.** Left panel says *"Notes are being written from the transcript. Check back in a moment."* — and never changes, because there is no transcript to write notes from (transcription never succeeded). Unlike the transcription side, **there is no error, no retry, no "this is stuck" affordance** on the notes side. A real advisor would be told to "check back in a moment" indefinitely with no way to know their meeting notes will never appear.
7. **Restart persistence: PASS.** Killed and restarted the whole app process; the recording, its waveform, the "Consent noted · two-party" state, and the (still-broken) transcription/notes state all survived correctly. This part of the persistence story is solid — nothing was lost.

### BUG — Transcription reliably fails on this bench ("voice engine returned an error")
- **Where:** Meeting detail page, right panel, after clicking "Record a meeting" → speaking the consent notice → recording ~90s → Stop.
- **Repro:** 100% reproducible across 3 attempts and 2 full app restarts on `lantern-cloud-bench-2` (fresh install, local AI selected, VB-CABLE audio).
- **User-facing message:** "Transcription couldn't finish. The voice engine returned an error. Your recording is safe."
- **Backend:** no corresponding error is written to `tauri-dev.log` — the failure isn't surfaced anywhere a developer (or support person reading logs) could diagnose it from server-side logs alone.
- **Likely related:** the local-AI (LLM) model download on this same bench also got stuck at 0% earlier in this session and only resumed after an app restart (the app itself surfaced an honest "The download looks stuck. Restarting Advisor Prep Hero resumes it where it stopped" message — that one self-healed). The ASR/"voice engine" download may have a similar first-download hiccup that a restart normally fixes, but restarting did **not** fix the transcription error in this case — it failed identically before and after restart. This suggests the ASR engine either never finished downloading/installing, or fails for a different reason than the LLM did. Not root-caused further; flagging for the fix lane to investigate with real backend log instrumentation around the transcription/parakeet sidecar call.

### BUG — Notes panel hangs forever with no error when transcription fails
- **Where:** Meeting detail page, left panel.
- **Repro:** same session as above. As long as transcription has failed, the notes panel is stuck on "Notes are being written from the transcript. Check back in a moment." with no time limit, no error state, and no retry button.
- **Why it matters:** the transcription side models good UX (clear failure message + "your recording is safe" reassurance + retry). The notes side should do the same — at minimum, it should stop claiming to be "in progress" once its prerequisite (a transcript) is confirmed unavailable, and should offer its own retry once transcription succeeds.

## Cited Ask

Not separately exercised as a live Q&A in this pass beyond citation-following on the Client Map (see above) — time went to the audio/transcription investigation instead. The citation-opens-real-file check (item under Client Map above) is the strongest evidence available this session that "Ask anything, with sources" is real and not decorative.

## What a fresh, skeptical user would think

- **Trust-building things that worked:** the disk-encryption-off warning, the "read-only, never writes back" Wealthbox language matching code, the spoken-consent verification, "your recording is safe" messaging on failure, and the graceful in-app fallback when the native folder dialog can't be driven — these all read as an app that's honest about its limits rather than papering over them.
- **The one thing that would break trust fast:** recording a real client meeting, watching it fail to transcribe, and then being told forever that notes are "just about to be ready." A first-time advisor who trusted the "walk you through it" onboarding promise and then hits this would reasonably conclude the app lost their meeting content, even though the audio itself is safely preserved.

## Landmines hit this session (environment, not product — for future cloud-bench sessions)

1. **Tailscale on this VM logs itself out on every boot/restart** (already known for bench-1, confirmed for bench-2 too) — reconnect with `tailscale up --authkey=<...> --hostname=lantern-cloud-bench-2 --accept-routes` using the key at `~/lp-azure/creds/tailscale_authkey.txt`.
2. **Both onboarding "start" paths open a real native Windows folder dialog** that a cloud bench's CDP-only harness cannot see or drive — there is no pyautogui-style screen/input bridge deployed on bench-2 (unlike the Legion's `legion_agent.py`). Worked around it by finding the app's own graceful "type the folder path" fallback once the native dialog stopped responding — much cleaner than trying to automate the native dialog itself. **Recommendation:** don't invest in native-dialog automation on cloud benches; the in-app fallback is the intended path.
3. **A leftover PowerShell/Terminal console window from an earlier scheduled-task helper ate a stray keystroke and killed the whole `npm run tauri:dev` process tree.** Any future helper scripts run via Task Scheduler on this bench should launch through the `wscript.exe`+VBScript "hidden window" trick (`Set objShell = CreateObject("WScript.Shell"): objShell.Run "powershell ...", 0, False`), not `powershell.exe -WindowStyle Hidden` directly — Windows Terminal ignores that hidden-window flag and pops a visible window anyway.
4. **A stuck `Stop-Process -Force` on `lantern.exe` alone leaves `node`/`cargo`/`cmd`/`conhost` processes orphaned**, which then hold `tauri-dev.log` open (blocking `Remove-Item`) and squat on port 5173, causing the *next* restart to fail silently (exit code 1, zero log output, because the new instance can't bind the port). Always kill `node,cargo,lantern,rustc,link,cmd,conhost` together, not just `lantern`, before restarting the dev server on this bench.

## Files in this evidence folder

- `01`–`13`: onboarding walkthrough (welcome → choose-start → AI connect → data-connect → setup progress)
- `14`–`20`: first look at the main app, Client Map / Clients list
- `21`–`23`: Client Map detail + citation verification
- `24`–`39`: Meetings — record button, Notice Kit consent, live recording, stop, meeting detail, transcription failure + retries, restart persistence
- `40`–`46`: Data Map dialog + Wealthbox row
- `desktop-full-*.png`: real full-desktop screenshots (not CDP/webview-only) taken while diagnosing the native-folder-dialog blocker — kept as evidence of the environment limitation described above.

## Action items for the fix lane / BUG-DB

This worktree's branch (`lp/bench2fresh-evidence` / `lp/windows-smoke-evidence`) does not contain `coordination/qa-campaign/BUG-DB.md` (it lives only in the canonical `~/lantern-plus` checkout), so the two bugs above were **not** appended there directly — flagging here for the coordinator to file:

1. **[HIGH] Transcription ("voice engine") reliably fails after a real recording on a fresh local-AI install**, with no server-side log signal to diagnose from. Confirmed reproducible 3x across 2 app restarts on `lantern-cloud-bench-2`.
2. **[MEDIUM-HIGH] Notes-generation panel hangs indefinitely with no error/retry when its transcript prerequisite never arrives.** Should surface a clear failure state instead of an unbounded "check back in a moment."
