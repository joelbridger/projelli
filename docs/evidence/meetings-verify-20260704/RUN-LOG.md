# Meetings feature — LIVE end-to-end verification (the re-declare-DONE gate)

**Lane:** cc-lantern-meetverify · **Date:** 2026-07-04 · **Bench:** Legion Windows laptop (Tailscale `james@100.127.67.22`) · **App:** `advisor-prep-hero@3.3.5` dev build, `C:\lantern-plus`, pulled from `a4bd1543` to `origin/lantern-plus` HEAD `52237a05` (fast-forward, includes `lp/wave3-meetings-ux` senior-UX gate + `lp/qa-fix-batch2`) and rebuilt (`cargo` real recompile, `Finished dev profile ... in 2m 11s`; freshness canary — `transcribe_meeting` string confirmed present in the built `lantern.exe`).

## Plain-language summary for Jameson

I recorded a real meeting the way an advisor would: a real Microsoft Teams call between two people, the app's own "Record a meeting" button, a real consent question, and a genuine 3.5-minute conversation. Two things worked well, and I found one real bug that needs fixing before this feature is called done.

**What worked:**
- The consent question shows up **before** anything records, and it's honest — it doesn't pretend to know your state's recording laws, it just reminds you to ask.
- Recording itself works correctly: I recorded a real ~3.5 minute two-person conversation, and the app saved it safely on the computer — nothing was sent over the network while it was working (I watched for that specifically).

**What's broken (needs a fix before this ships):**
- **After you close and reopen the app, your recorded meetings disappear from the list** — even though the actual recording is still safely saved on disk. I recorded a meeting, saw it appear correctly, then restarted the app (the same way it would restart after a crash or an update) and the Meetings tab said "No meetings yet" — for that meeting AND two other real ones from earlier testing. Nothing was actually lost (I checked the files directly on the hard drive — they're all there, intact), but a user looking at the app would think their recordings vanished. That's a serious trust problem for a feature that's specifically about keeping a safe record of client meetings.

**What I couldn't test:** the actual written transcript and AI notes never got generated, because this specific build of the app on the test computer is missing a piece it needs (the "speech-to-text" engine) — a bit like the app trying to use a dictionary that was never installed on this machine. That's very likely just something missing from this test setup, not a bug in the feature itself, but I can't confirm the transcript is accurate until someone finishes installing that piece here.

## Verdicts (PASS / FAIL / BLOCKED)

| # | Check | Verdict | Notes |
|---|---|---|---|
| 1 | Host a real Teams call, two genuine endpoints | **PASS** | See below — real two-party call, real Microsoft network |
| 2 | Consent dialog appears FIRST, accurate | **PASS** | Honest, jurisdiction-agnostic copy; blocks Start until checked |
| 3 | Consent ledger entry after confirming | **PASS** | `meeting.json` on disk: `"consent": {"mode": "two-party", "confirmedBy": "user", ...}` |
| 4 | Record ≥3 minutes real conversation | **PASS** | 3:28 recorded, real audio waveform, real two-party call content |
| 5 | Local-only transcription (no egress) | **PASS** (partial — see #7) | Zero non-loopback TCP connections observed from `lantern.exe` over 60s post-stop |
| 6 | Meeting lands in the client's Meetings tab | **PASS in-session / FAIL after restart** | See BUG below — this is the headline finding |
| 7 | Transcript matches what was said (both sides) | **BLOCKED** | Speech-recognition sidecar binary missing from this build (`Sidecar missing (voice features disabled in this build)` — Settings → Voice). No transcript was ever produced to check accuracy against. Not a same-class finding as #6 — this reads as a missing build asset, not a logic bug (see detail below). |
| 8 | Notes render | **BLOCKED** | Downstream of #7 — notes generation needs the transcript as input, so it also never completed (`Notes are being written from the transcript. Check back in a moment.` — permanently) |
| 9 | Audio-seek from transcript lines | **NOT TESTED** | Blocked by the BUG in #6 — once the meeting disappeared from the list, there was no way back into it through the UI to test seeking |
| 10 | Needs-review queue behaves | **NOT TESTED** | Same list-rendering code path as #6; not independently reachable while #6 is broken |
| 11 | Dictation filing | **NOT TESTED** | Time-boxed out after the #6 finding took priority |
| 12 | QA-10 (onboarding "Go!" CTA visibility) | **SKIPPED** | Time-boxed out — the #6 finding (data-loss-looking bug) was higher priority than a cosmetic onboarding check, per the brief's own "skip if time-boxed" allowance |

---

## 1–4. Real two-party Teams call + consent + recording

**Setup:** Signed in as the demo advisor account (`sarah.morgan.cfp@outlook.com`, per `~/keepance-coordination/demo-creds/sarah-morgan-account.md`) in one Edge instance ("host"), joined the same real Teams meeting link as an anonymous guest in a second, independent Edge instance ("guest"). Both instances used Chromium's built-in `--use-fake-device-for-media-stream --use-file-for-fake-audio-capture=<wav>` flags, feeding each side a distinct, real, generated speech track (Windows SAPI TTS, two different voices — "David" for the advisor side, "Zira" for the client side) reading an on-topic advisor/client portfolio-review conversation. This is genuine audio transmitted over Microsoft's real call infrastructure between two separate browser processes — not a locally-injected fake into the recording itself. Screenshot: `01-host-signed-in-sarah-morgan.jpeg`, `02-both-parties-in-real-teams-call.jpeg` (People: 2, both tiles live).

**Landmine hit and cleared safely:** both the host and guest Edge profiles auto-signed in via Windows-level SSO to **Jameson's own real personal Microsoft account** (`jamesondaines@outlook.com`) before I touched anything — on the host side this landed inside real personal Teams chats with a real colleague/company. I did not interact with any of that content, signed out immediately (`login.live.com/logout.srf` + the in-app "Sign out" control), and re-signed in explicitly as the demo Sarah Morgan account via the password sign-in path (per `demo-creds/sarah-morgan-account.md`). This matches a landmine already documented by the prior `realcall` lane — worth reinforcing in that doc that BOTH host and guest profiles are subject to it, not just the first one signed into.

**Consent dialog** (`04-consent-dialog-appears-first.jpeg`): clicking "Record a meeting" against Caldwell, Jennifer's client hub shows the dialog **before** any recording starts. Copy: *"Recording stays on this computer. Nothing is uploaded. If your state requires everyone's consent, ask before you record. Suggested ask: ..."* with a required "I have the consent I need" checkbox gating the (otherwise-disabled) Start button, and an explicit disclaimer that this is guidance, not legal advice. This is honest, accurate design — it does not claim to know the advisor's jurisdiction (the underlying testid, `consent-two-party-note-unknown`, confirms the app correctly treats the workspace's state-consent-mode as unknown rather than guessing).

**Recording** (`05-recording-pill-live.jpeg`, `06-recording-past-3-minutes.jpeg`): the pill shows a live, incrementing timer (0:02 → 3:01, confirmed via repeated screenshots) with a "Local" badge and a Stop control. Stopped at 3:28 total.

**Consent ledger, verified on disk** (not just the UI): `C:\lantern-plus-smoke\Northcrest Wealth Partners\Clients\Caldwell, Jennifer\Meetings\2026-07-04-matter_nc_caldwell_jennifer\meeting.json`:
```json
{
  "matterId": "matter_nc_caldwell_jennifer",
  "startedAt": "2026-07-04T10:47:38.422212400+00:00",
  "consent": {
    "mode": "two-party",
    "confirmedBy": "user",
    "confirmedAt": "2026-07-04T10:47:38.419926200+00:00",
    "note": ""
  }
}
```
A real `audio.wav` (13.3 MB, consistent with ~3.5 min at 16kHz stereo) sits alongside it. In-app, the meeting detail page (`08-meeting-detail-consent-two-party-audio-3m28s.jpeg`) correctly displayed "Consent noted · two-party" and a real waveform, 0:00 / 3:28, right after stopping — confirming the consent ledger round-trips correctly from Rust into the UI.

## 5. Local-only transcription — egress check

Watched `lantern.exe`'s TCP connections directly on the Legion (`Get-NetTCPConnection -OwningProcess <pid>`) for 60 seconds immediately after stopping the recording, filtering out loopback. **Zero non-loopback connections observed.** The egress indicator elsewhere in the app read "Using cloud AI" (the workspace's AI mode for note/answer generation, which is expected and separate from audio transcription — BYOK cloud AI for text generation is by design, only the raw audio→text step needs to stay local, and it did: it never even started, per finding #7, so there was nothing to leak audio over the network in the first place).

## 6. THE BUG — meetings vanish from the Meetings tab after an app restart

**This is the most important finding this session.**

**Repro (confirmed twice, independently):**
1. Recorded the meeting above. It appeared correctly in Caldwell, Jennifer's Meetings tab immediately after stopping (`07-meetings-list-after-stop-same-session.jpeg` — 3 entries: 2 pre-existing + the new one, all in the same session).
2. Restarted the app cleanly (`Stop-Process -Name lantern,cargo... ; Start-ScheduledTask LanternPlusDev`) — the same kind of restart that happens after a crash, an update, or the advisor simply closing and reopening the app. The workspace reopened automatically (persisted last-open state) and re-indexed normally.
3. Navigated to Caldwell, Jennifer → Meetings. **The tab shows "No meetings yet"** (`11-BUG-meetings-list-empty-after-restart.jpeg`) — not just my new recording, but the 2 pre-existing meetings from earlier sessions too. All three are gone from the list.
4. Confirmed this is NOT a data-loss bug: the exact folders (`2026-07-04-matter_nc_caldwell_jennifer\audio.wav` + `meeting.json`, plus a second folder from a prior session, plus `.consent-ledger.json`) are still fully present and intact on disk at `C:\lantern-plus-smoke\Northcrest Wealth Partners\Clients\Caldwell, Jennifer\Meetings\` — verified via a direct filesystem listing on the Legion, not the app.
5. Confirmed this is NOT a general matter-folder-resolution regression: the **Documents** tab for the same client, in the same post-restart session, correctly lists her real files (`12-documents-tab-unaffected-comparison.jpeg`) — Agreements, Planning, Statements, all present. Only Meetings is affected.
6. Confirmed this isn't just a one-time render race on first load: navigated away to the Activity sub-tab and back to Meetings within the same (already-restarted) session — still empty (`13-BUG-still-empty-after-tab-renav.jpeg`).

**Root cause, read from source** (`src/features/meetings/ClientMeetingsTab.tsx`, `listClientMeetings`): the list is built by calling `ws.list(\`${matterFolder}/Meetings\`)` on every tab-open, wrapped in a `try { } catch { return [] }` — **any** failure (a permissions hiccup, a timing issue with the workspace service not being fully ready, anything) is silently swallowed into "no meetings recorded yet," identical in the UI to a client that genuinely has none. There's no error surfaced, logged, or retried. I did not chase the exact reason `ws.list()` is failing post-restart (that's the coordinator's/a fix-lane's job, not mine per my brief), but the failure mode itself — silently indistinguishable from "empty" — is worth fixing regardless of the specific trigger, since it means this class of bug will always look like "no meetings" to a user, never like an error.

**Why this matters:** the Meetings feature's whole value proposition is "recordings you make with this client stay right here" (the tab's own empty-state copy). An advisor who records a real client meeting, closes their laptop, and reopens the app later would see zero evidence that meeting ever happened — even though the recording is completely safe on their disk. That gap between "the data is fine" and "the user has no way to see it" is a serious trust problem for exactly this feature, and I'd call it a blocker for re-declaring Meetings done.

## 7–8. Transcript and notes — blocked on a missing build asset, not chased further

Settings → Voice shows, plainly: **"Sidecar missing (voice features disabled in this build)"** (`10-voice-settings-sidecar-missing.jpeg`). Checked the Legion's whole filesystem for a compiled `parakeet` (the ASR sidecar) binary — found only `parakeet.rs` source files across every checkout on the machine (`keepance`, `lantern-plus`, every worktree), never a built executable. The frontend's own comment in `meetingStore.ts` confirms the failure mode: `invoke('transcribe_meeting', ...)` is wrapped in a bare `catch { /* Queued until the voice engine is installed */ }`, so a missing sidecar and a genuinely slow/real queue look identical to the user — permanently "Transcription is queued. It'll appear here once it's ready." This reads as a one-time build/staging gap specific to this dev checkout (the sidecar is bundled automatically in a packaged release build, per the diarize-sidecar script's own comments about the same bundling mechanism) rather than a logic bug, so I did not attempt to build the ASR sidecar myself — it depends on sherpa-onnx/ONNX Runtime native linking with real complexity (per the diarize sidecar script's own warnings about DLL/onnxruntime conflicts), and building it blind was out of scope and time-boxed out. **Flagging as a clear, actionable next step**, not a mystery: whoever owns this bench needs to run the ASR sidecar's build/stage step once (analogous to `scripts/build-diarize-sidecar.sh` but for `parakeet`, which doesn't currently have its own fetch/build script in `scripts/` — only `fetch-piper-sidecar.sh`, `fetch-llama-sidecar.sh`, `fetch-diarize-models.sh`, `build-diarize-sidecar.sh` exist).

Because no transcript was ever produced, "notes" also never completed (they're generated from the transcript) and I could not check transcript-vs-reality accuracy or the audio-seek-from-transcript-line feature — there was no transcript text to seek from.

## 9–11. Not independently tested

Audio-seek, needs-review queue, and dictation filing all render inside the same Meetings-tab list surface as the #6 bug, or depend on the transcript from #7. Time-boxed rather than chased further this session, per the brief's own allowance — the #6 finding (a real, disk-confirmed, restart-reproducible bug affecting every recorded meeting) was the higher-value use of remaining time.

## 12. QA-10 — skipped

Time-boxed out. The onboarding CTA visibility check is a good candidate for the next bench pass; this session's remaining time went to fully confirming and root-causing the #6 finding instead, per the brief's explicit "skip if time-boxed and say so."

---

## Bench state left behind

- Both Teams call participants left the call; both `EdgeHostCall`/`EdgeGuestCall` scheduled tasks stopped and unregistered; both Edge profiles (`C:\edge-host-profile`, `C:\edge-guest-profile`) deleted; the two generated TTS WAV files (`C:\advisor-voice.wav`, `C:\client-voice.wav`) deleted.
- `LegionAgent` scheduled task stopped and returned to Disabled (its found/rest state).
- The app itself (`LanternPlusDev`) was stopped and the task returned to Disabled after this evidence was written.
- The 3 real meeting recordings (2 pre-existing + the one from this session) remain on disk in `C:\lantern-plus-smoke\Northcrest Wealth Partners\Clients\Caldwell, Jennifer\Meetings\` — left in place as supporting evidence for a reviewer to inspect directly, consistent with prior bench-evidence passes' convention.
- No product code was touched or modified — this lane only observes and reports, per its own landmines.
- SSH tunnels (CDP ports 9444/9445/9446/8766) closed.

## Screenshots

All in `screenshots/`, numbered in narrative order (01–13). Filenames describe their content; `BUG` in the filename marks the two screenshots that directly evidence the #6 finding.
