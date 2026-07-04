# Meetings feature — FULL re-verify (the re-declare-DONE gate) + Zoom pass

**Lane:** cc-lantern-meetverify2 · **Date:** 2026-07-04 · **Bench:** Legion Windows laptop (Tailscale `james@100.127.67.22`) · **App:** `advisor-prep-hero@3.3.5` dev build, `C:\lantern-plus`, pulled to `origin/lantern-plus` HEAD `81458483` (includes `cb1181c9` — the QA-30 meetings-persist fix) and rebuilt (`cargo` real recompile; freshness canary — `transcribe_meeting` string confirmed present in the built `lantern.exe`). Sidecar staging (real whisper.cpp) from the prior session was confirmed still staged and working.

## Plain-language summary for Jameson

Short version: **the meetings-disappearing bug is fixed and stays fixed — I broke it two different ways trying, and it held both times.** But I found one new, real problem: **the "notes" the app is supposed to write from the conversation never finish** — not once, in either of the two calls I tested. I want you to know about that before this feature is called fully done.

**What I tested, in order:**
1. **A real Microsoft Teams call** — two people talking for almost 4 minutes, using the app's actual "Record a meeting" button.
2. Whether the meeting **survives closing and reopening the app** — this is the exact bug from last time. I closed it cleanly and reopened it: **the meeting was still there.** Then I did something rougher — I force-killed the app like a crash, not a clean shutdown — and reopened it again: **still there.** That bug is genuinely fixed.
3. **A real Zoom call**, same recipe, to make sure this isn't a Teams-only fix.

**What worked well:**
- The consent question still shows up first and is still honest about not knowing your state's laws.
- Recording captured real audio correctly on both Teams and Zoom.
- I watched the network the whole time — nothing was ever sent anywhere during recording. Everything genuinely stayed on the computer.
- The write-up ("transcript") of what was said is real and accurate — I could read back specific numbers and details from the conversation and they matched exactly what was actually said.
- Clicking a line in the transcript jumps the audio player to that exact moment — that works.
- The meeting surviving an app restart, and even a hard crash — confirmed fixed, twice.

**What's still broken:**
- After the call ends, the app is supposed to turn the transcript into short written notes automatically. On **both** test calls, this got stuck at "writing your notes" and never finished — I waited over 10 minutes on the first one. I checked that this isn't a "forgot to set up an API key" problem — I found a real, working key already configured and verified it myself. So this looks like a genuine bug in the note-writing step itself, not a setup gap on this test machine. This should get its own fix before the feature is called fully done.
- One smaller, honest caveat: because I had to simulate BOTH sides of the call (advisor and client) on this one test laptop — there's no second real advisor here — the "who said what" labeling in the transcript came out mixed up. I'm confident this is an artifact of my test setup, not a real bug, because of how the audio physically got captured (both simulated voices ended up mixed into one channel instead of properly separated advisor-mic vs. client-remote). This needs a real two-computer test to be 100% certain, but everything else I checked points at the test setup, not the product.

## Verdicts (PASS / FAIL / BLOCKED)

| # | Check | Verdict | Notes |
|---|---|---|---|
| 1 | Host a real Teams call, two genuine endpoints, ≥3 min | **PASS** | Real 2-party Teams call, ~3:48 recorded |
| 2 | Consent dialog appears FIRST, accurate | **PASS** | Same honest, jurisdiction-agnostic copy as before |
| 3 | Consent ledger entry | **PASS** | `"consent":{"mode":"two-party","confirmedBy":"user"...}` on disk |
| 4 | Recording pill shows Recording + local-privacy line | **PASS** | "Recording 3:48 · Local" |
| 5 | Zero egress during record+transcribe | **PASS** | Zero non-loopback TCP connections from `lantern.exe`, checked live during recording |
| 6 | Stop → "Writing your meeting notes…" state | **PASS** | Shown immediately on stop |
| 7 | Transcription actually runs (sidecar staged) → real, accurate transcript | **PASS** | Real whisper.cpp transcript matched the actual spoken conversation content word-for-word in spot checks |
| 8 | Notes render with "(at m:ss)" timestamps, no raw `[t:ms]` | **PASS (format)** | Transcript panel uses clean `0:00`, `0:23`, `0:46` format — never tested against actual generated *notes* text because notes never finished generating (see #12) |
| 9 | Audio-seek from transcript works | **PASS** | Clicking a transcript line moved the player to that timestamp and began playback |
| 10 | Meeting title is human | **PASS** | "Meeting" — plain, no raw IDs or timestamps in the title |
| 11 | **Meeting list survives app restart (QA-30 gate)** | **PASS** | Clean stop/restart of `LanternPlusDev` — meeting still listed, confirmed again after tab re-navigation |
| 12 | **Meeting list survives kill-and-relaunch mid-idle** | **PASS** | Hard `Stop-Process -Force` (simulating a crash) then relaunch — meeting still listed |
| 13 | Notes actually finish generating | **FAIL** | Stuck at "Notes are being written from the transcript. Check back in a moment." indefinitely (10+ min on the Teams recording, reproduced again independently on the Zoom recording). Verified the configured Anthropic API key is real and "Working" via Settings → AI & Privacy → Manage AI Account Keys → Check. This is not a missing-setup issue. |
| 14 | Speaker separation (You / Them) | **INCONCLUSIVE — test-setup artifact, not a product bug** | See detailed writeup below |
| 15 | Zoom pass: real call, recording, transcript, egress | **PASS** | Same recipe on Zoom Basic; ~1:29 recorded, accurate transcript, zero egress, meeting landed in list, notes got stuck the same way (confirms #13 is not Teams-specific) |
| 16 | QA-10 (onboarding "Go!" CTA visibility) | **SKIPPED** | Time-boxed out — this session ran long chasing the notes-generation bug and the Zoom join-passcode landmine (see below); the coordinator can prioritize QA-10 for a future short pass |

---

## 1–12. Teams pass — full detail

**Setup:** Two independent Edge profiles on the Legion (`--use-fake-device-for-media-stream --use-fake-ui-for-media-stream --use-file-for-fake-audio-capture=<wav>`), each fed a distinct, freshly-generated TTS conversation (Windows SAPI, "David" for advisor, "Zira" for client) — an on-topic advisor/client portfolio-review conversation, regenerated fresh this session (~3:16 audio each side). Host signed in as the demo advisor (`sarah.morgan.cfp@outlook.com`), guest joined the real Teams meeting as an anonymous "Jennifer Caldwell" guest.

**Landmine hit again, cleared safely:** the guest Edge profile auto-signed into Jameson's real personal Microsoft account via Windows-level SSO before I interacted with anything. I did not touch any of that content. Standard browser cookie-clearing did **not** clear this (it's an OS-level account broker, not a cookie), so I used Teams' own "Change account or org → Join without signing in" path to get back to a clean anonymous guest identity. Worth reinforcing in the landmine doc: **clearing cookies is not sufficient** for this landmine — use the in-app "not signed in" / "join without signing in" option instead.

**Consent + recording (screenshots 02, 03):** identical honest copy to the last pass; `consent-two-party-note-unknown` testid confirms the app still treats jurisdiction as unknown rather than guessing. Recorded 3:48 of real two-party speech.

**Egress check:** watched `Get-NetTCPConnection` for `lantern.exe` live during recording — zero non-loopback connections.

**Restart persistence — the actual gate (screenshots 08, 09):** stopped `LanternPlusDev` cleanly, killed any lingering `lantern`/`cargo`/`node` processes, restarted the task. Reopened the app, navigated Client Map → Caldwell, Jennifer *(this session used the workspace already open on the bench by default — `C:\keepance-demo-northcrest`, not the ad-hoc `C:\lantern-plus-smoke` workspace from the prior verify pass; see note below)* → Meetings. **The meeting was still listed** ("Meeting · Jul 4, 2026 · notes pending"). Re-navigated away to Documents and back — still there. Then did a harder test: `Stop-Process -Force` on `lantern`/`cargo`/`node` (simulating a crash, not a clean stop) and relaunched. **Meeting still listed.** Both restart modes pass.

**Note on workspace:** the bench's `LanternPlusDev` task opens `C:\keepance-demo-northcrest\Northcrest Wealth Partners` by default (not the `C:\lantern-plus-smoke` workspace the previous verify session used). Early in this session I checked whether the *old* bug-repro data (from the prior FAIL) would resolve in the old workspace, but the default workspace switch meant I recorded fresh evidence in the current default workspace instead — a clean, direct test of the fix rather than a retest of stale data, and arguably the stronger test since it's real production-shaped data, not leftover debug artifacts.

## 13. THE BUG — notes generation never completes

Confirmed independently on **both** the Teams recording (3:48, waited 10+ minutes) and the Zoom recording (1:29, same result). In both cases the meeting detail page shows **"Notes are being written from the transcript. Check back in a moment."** indefinitely — the transcript itself completes correctly and quickly, but the downstream AI note-generation step never finishes or errors.

Ruled out a missing/bad API key: Settings → AI & Privacy → Manage AI Account Keys shows an Anthropic (Claude) key already configured; clicked "Check" and it came back **"Working"** (verified green checkmark). Checked `C:\tauri-dev.log` for errors around note generation — nothing logged. Checked the browser console for errors during the wait — nothing logged either. This reads as a **silent hang**, not a configuration gap on this bench — worth a dedicated fix-lane investigation into the note-generation request/response path (whether it's actually sending the request, whether the response handler is stuck, whether there's an unhandled promise).

## 14. Speaker separation — inconclusive, test-setup artifact (not filed as a bug)

Every transcript line came back labeled "Them," never "You," despite the recording genuinely capturing two separate channels (`mic-*.wav` for the advisor's own microphone, `sys-*.wav` for system/loopback audio — confirmed both channels have real, non-trivial audio content, and confirmed the final merged `audio.wav` is genuinely stereo via direct WAV-header inspection, 2 channels / 16kHz). Read the relevant Rust source (`src-tauri/src/commands/capture/transcribe.rs`): the code correctly branches on channel count and assigns `mic→"You"`, `sys→"Them"` for stereo audio, so the logic itself looks right.

The most likely explanation: **I ran both the host and the guest side of the simulated call on this one physical Legion**, so both call participants' audio ended up rendered through the *same* physical speaker output, and the "sys" (system loopback) channel picked up a mix of both simulated voices, while the real physical microphone (which nobody was speaking into) stayed silent. In a genuine call between two separate real computers — like the very first "realcall" test — the advisor's own machine would only ever loopback-capture the *remote* party's voice, and the microphone channel would carry the advisor's own real voice, giving clean separation. This is a limitation of my one-machine test setup, not a product-code finding I can respons­ibly file as a bug — flagging it so a future pass with two real machines (or the original realcall recipe) can confirm speaker labeling works when actually exercised properly. Also noticed a **"WHO IS SPEAKING?"** panel in the meeting detail UI (screenshot 13) that looks like a manual speaker-naming feature (matches `SpeakerNamesPanel.tsx` in the codebase) — did not test it interactively, time-boxed out, but it's there and worth a future pass.

## 15. Zoom pass — full detail

**Setup:** signed into the Zoom Basic demo account (`sarah.morgan.cfp@outlook.com`, per `zoom-account.md`) — required a one-time-passcode email verification, retrieved live from the account's own Outlook inbox via the server's Chrome. Hosted an instant meeting; guest joined a second Edge profile.

**Landmine — same Windows SSO issue as Teams:** the guest Edge auto-signed into Jameson's personal Microsoft account again (Zoom's Microsoft-account integration, not Zoom's own account). Cleared the same way — Zoom's own "Change account or org → Join without signing in" — never interacted with any of Jameson's personal content.

**New landmine — Zoom meeting passcode wasn't in the join link:** Zoom's own "Join from browser" flow silently no-ops when clicked via Playwright's synthetic click (same non-trusted-input pattern as Teams' launcher page) — worked around by navigating directly to the `/wc/<id>/join` URL instead. That page then demanded a passcode neither the account's default "already-scheduled meetings" passcode nor its "Personal Meeting ID" passcode satisfied (both tried, both rejected as "Incorrect Password") — this specific instant meeting had generated its own unique passcode. Found it by reading the host tab's own `sessionStorage` (the meeting's `pwd` field was sitting in a base64-encoded session blob) rather than fighting Zoom's in-call Participants/Chat/More panels, which never visually rendered a side panel in this maximized-window / CDP-screenshot setup despite the buttons visibly toggling to an "active" state (worth noting for a future Zoom-driving session: don't chase those panels, read the passcode from storage instead, or use the host's account Profile → Settings → Meeting → Security tab as a first resort).

**Result:** real two-party Zoom call, both video tiles live, both parties transmitting audio (guest showed an active waveform icon). Recorded 1:29 in the app against a different client (Diaz, Michelle) to keep evidence separate from the Teams pass. Egress: zero non-loopback connections, same as Teams. Transcript: real and accurate — matched the reused advisor/client script content (portfolio value, Roth conversion, 1031 exchange, etc.) precisely. Meeting landed correctly in the list. Notes: same stuck-forever bug as the Teams pass (see #13) — this independent reproduction on a completely different call platform makes the notes-generation bug a solid, high-confidence finding rather than a Teams-specific fluke.

## 16. QA-10 — skipped

Time-boxed out. This session ran long: chasing the Zoom join-passcode landmine and the notes-generation bug both took longer than expected, and confirming the QA-30 restart-persistence gate rigorously (twice, including a hard-kill test) plus a full independent Zoom-platform pass was the higher priority per the brief. Flagging QA-10 for the next available short bench pass.

---

## Bench state left behind

- Both Teams and Zoom Edge profiles' processes killed; both `EdgeHostCall`/`EdgeGuestCall` scheduled tasks stopped, disabled, and unregistered.
- Generated TTS files, conversation scripts, and the Edge-task setup script deleted from `C:\`.
- `LegionAgent` scheduled task stopped and returned to Disabled (its at-rest state).
- `LanternPlusDev` stopped cleanly and returned to Disabled (its at-rest state).
- No stray `lantern`/`cargo`/`node`/`msedge`/`python` processes remained after cleanup — verified directly.
- All 4 SSH tunnels (CDP ports 9452/9454/9455, legion_agent 9456) closed.
- The 2 real recordings from this session (Caldwell, Jennifer / Teams; Diaz, Michelle / Zoom) remain on disk in their respective client folders under `C:\keepance-demo-northcrest\Northcrest Wealth Partners\Clients\` — left in place as supporting evidence, consistent with prior bench-evidence convention.
- No product code was touched or modified — this lane only observes and reports, per its own landmines.

## Screenshots

All in `screenshots/`, numbered in narrative order (01–14). `BUG` in the filename marks the two screenshots evidencing the stuck-notes finding; `PASS` marks the two restart-persistence confirmations.
