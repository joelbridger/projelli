# Regression smoke (audio-dependent half) — Meetings E2E, QA-35 disk-full, Notice Kit

**Lane:** cc-lantern-regression · **Date:** 2026-07-04 · **Bench:** Legion Windows laptop (Tailscale `james@100.127.67.22`) · **App:** `C:\lantern-plus`, git checkout updated `origin/lantern-plus` HEAD `17081c31` → `14b6be71` (fast-forward, includes the just-merged QA-35 fix `0946cd7b`) and rebuilt from scratch (real cargo recompile — Rust changed across many merges since the last bench session; ~2 min build).

**Scope note:** the coordinator split today's consolidated regression brief across two parallel benches to avoid duplication. This lane (Legion) covers the audio-dependent checks only: Meetings end-to-end, QA-35 disk-full-during-recording, and the Recording Notice Kit. The non-audio items (QA-34 file-lock save fix, Tier A honesty pages, broad smoke, QA-32/33) were run in parallel on a separate cloud bench and are reported there.

## Plain-language summary for Jameson

**Everything I was asked to check today passed. The meeting-notes feature still works perfectly after all of today's changes, and I found that a brand-new safety feature (an honest "your disk is full" warning) works exactly the way it should.**

Here's the short version of what I tested and what happened:

1. **Recording a meeting, start to finish, still works.** I recorded a test call, and the app wrote it down (transcript) and turned it into a tidy summary note — accurately, with no errors, exactly like the last time I checked this.
2. **A brand-new safety net works: if your computer's hard drive fills up while you're recording, the app tells you the truth instead of getting stuck.** I deliberately filled up the laptop's hard drive while a recording was running (a scenario advisors could hit on a long call). The app immediately said "Recording can't continue. Disk is full." — no fake "Saved" message, no frozen spinner. It's an honest failure, which is exactly what you want from software handling confidential client recordings.
3. **The "say this out loud" recording-consent reminder shows up correctly.** When you hit record, the app shows the advisor a script to read aloud so everyone on the call knows they're being recorded — I confirmed this renders and that the follow-up "did I actually say it" check has a working one-click fix if it can't tell for certain.
4. **One bookkeeping mistake on my end, caught and fixed before it mattered:** I initially set up the test on the wrong folder on the laptop (a copy of the older "Keepance" app, left over from before this project split off). I caught it, switched to the correct current build, and redid the setup properly — no impact on the test results above, but flagging it for the record.

**Bottom line: nothing regressed. Meetings still works, and the new disk-full protection works exactly as designed.**

## Setup note: bring-up correction (read before the results)

The bench's `C:\keepance` (a plain-file-copy checkout used by the older, separate main-line Keepance effort) was mistakenly synced and rebuilt first, because a stale global reference doc pointed there. That checkout is **not** part of the lantern-plus program and is not git-tracked, so there was nothing to "revert" — it was simply the wrong target. Caught via `docs/evidence/meetings-verify5-20260704/RUN-LOG.md`, which documents the real, correct target: a separate git checkout at **`C:\lantern-plus`**, launched by the **`LanternPlusDev`** scheduled task (at-rest state: enabled/idle), tracking `origin/lantern-plus` directly. Corrected setup:

1. `C:\keepance`'s dev server was stopped (no lasting effect — it's an unrelated, non-git working copy; flagging only so whoever owns that folder knows it was touched and can re-sync it from `keepance-3.0` if needed).
2. `C:\lantern-plus` fetched + reset to `origin/lantern-plus` tip. This picked up a brand-new merge that landed mid-setup: **QA-35 (disk-full recording) was merged upstream during this session**, so the check below tested the real fix, not a known gap.
3. `LanternPlusDev` rebuilt from scratch (real cargo recompile, ~2 min — confirmed via the build log showing `Compiling lantern v3.3.5` reaching 1086/1086 crates and the app coming up fresh on CDP).
4. Bring-up verified: **Settings → Voice → "Voice ready"** (screenshot 01) and **Settings → AI & Privacy → Manage AI Account Keys → Anthropic (Claude) → Check → "Working"** (screenshot 02).

**Minor test-automation note (not a product bug):** the "Manage AI Account Keys" row's `data-testid` sits on the outer flex row, not the inner `<button>`; a driver that clicks the row's geometric center can land in empty space between the label and the button. Worked around by targeting the inner `button` element directly. Filed for awareness only — a real user clicking the visible button is unaffected.

## Verdicts (PASS / FAIL)

| # | Check | Verdict | Notes |
|---|---|---|---|
| 1 | Bench updated to tip + real rebuild, freshness verified | **PASS** | `C:\lantern-plus` fast-forwarded `17081c31` → `14b6be71`; real cargo recompile (Rust changed) |
| 2 | AI provider key healthy before starting | **PASS** | Anthropic (Claude) → Check → **Working** |
| 3 | Voice engine (local transcription) healthy | **PASS** | Settings → Voice → **"Voice ready"** |
| 4 | **Meetings end-to-end**: record → transcript → notes → restart-safe | **PASS** | Fresh client (Greer, Carol & Anthony, never used before). ~2:25 real TTS-voiced advisor monologue via the Legion's own speakers, captured through the app's real "Record a meeting" flow. Transcript landed within ~2 seconds of Stop, word-for-word accurate. `notes.docx` landed ~20s later with accurate, well-structured content (What Changed / Decisions / Action Items / Facts Worth Keeping, correct `(at m:ss)` citations) |
| 5 | Meetings restart persistence | **PASS** | Full `LanternPlusDev` restart (stop, kill, relaunch, no rebuild needed). Meeting entry, "Needs review" state, and prior data all survived unchanged |
| 6 | Recording Notice Kit: consent-script renders at record time | **PASS** | "Say this out loud after you start" verbatim script shown in the consent dialog before every recording |
| 7 | Recording Notice Kit: honest not-detected + one-click resolution | **PASS** (see note) | My synthetic audio came in on the `sys` (system/loopback) channel, not `mic` — by design, the matcher only scans the advisor's own mic channel (so a client's spoken words can never falsely satisfy the check). Result: honest "No spoken recording notice was detected" — correct behavior given the test method, not a bug. Clicked "Notice was given, transcription missed it" → resolved cleanly to "Recording notice resolved: notice given, transcription missed it" |
| 8 | **QA-35 — disk-full mid-recording** | **PASS** | Filled the Legion's C: drive to ~3MB free while a recording was live (fresh client, Hollings Family). App detected the failed chunk write and surfaced an honest toast: **"Recording can't continue. Disk is full."** Recording stopped cleanly — no stuck spinner, no false "Saved". Meeting entry read **"recording didn't finish saving"** with a **Needs review** badge. `meeting.json` recorded the real OS error (`os error 112`, ERROR_DISK_FULL). 14 partial mic-audio chunks (640KB each) were preserved on disk in `.capture/`, not silently discarded. Disk space restored immediately after (verified free space back to ~62.8GB) |
| 9 | (Optional) Zoom live call-recording test | **SKIPPED** | Marked optional/budget-aware in the brief; skipped in favor of thorough coverage of the four mandatory audio checks above given the added scope from the bring-up correction. No blocker found — just a time trade-off |

No retries were needed on any check — every result above is the first, natural, untouched attempt.

## Meetings run, in detail

- **Client:** Greer, Carol & Anthony — confirmed never used in any prior evidence session before this one.
- **Recording:** a realistic ~2:25 advisor monologue (portfolio performance, a cash-position flag, a beneficiary-designation issue on an old 401(k) rollover, next steps) spoken by a Windows TTS voice through the Legion's actual speakers, captured by the app's own "Record a meeting" → consent checkbox → "Start recording" flow. The consent-notice script ("Quick note before we start...") was included at the very start of the monologue.
- **Transcript:** landed within ~2 seconds of clicking Stop, correctly split into 5 timestamped segments, verbatim-accurate.
- **Notes:** landed ~20 seconds later. Verified content by extracting the raw `notes.docx` text directly (not just eyeballing the UI) — every fact, decision, and action item matched what was actually said, each with an accurate `(at m:ss)` citation.

## QA-35 disk-full run, in detail

- **Client:** Hollings Family — fresh, never used before.
- Started a normal recording (consent flow identical to the Meetings run above).
- While recording was live, filled `C:` from ~62.8GB free down to ~3MB free using `fsutil file createnew` with a dummy file (near-instant on NTFS via volume-maintenance privileges — no full zero-fill wait).
- First attempt left ~26MB free; Windows itself reclaimed disk space partway through (likely an automatic low-disk cleanup), and the recording's low compressed audio rate meant it never got close to filling that back up within the test window. Re-filled to a much tighter ~3MB margin on a second pass, which triggered the real failure within ~80 seconds of polling.
- Observed: the "Recording can't continue. Disk is full." toast, the recording pill disappearing (auto-stopped, not stuck), and the meeting entry showing an honest "recording didn't finish saving" / "Needs review" state.
- Verified directly on disk: `meeting.json` contains a `recordingError` object with the literal OS error string (`"There is not enough space on the disk. (os error 112)"`), and the `.capture/` staging folder still holds all 14 partial mic-audio chunks recorded before the failure — nothing was silently deleted.
- Restored disk space immediately by deleting the dummy fill file; confirmed free space back to ~62.8GB before moving on.

## On-disk verification

```
Greer, Carol & Anthony (Meetings E2E):
C:\keepance-demo-northcrest\Northcrest Wealth Partners\Clients\Greer, Carol & Anthony\Meetings\2026-07-04-matter_nc_greer_carol_anthony\
  audio.wav          9,308,204 bytes
  meeting.json             272 bytes  — durationMs: 145452, consent recorded, no notesError
  transcript.json        2,380 bytes
  notes.docx              9,379 bytes

Hollings Family (QA-35 disk-full):
C:\keepance-demo-northcrest\Northcrest Wealth Partners\Clients\Hollings Family\Meetings\2026-07-04-matter_nc_hollings_family\
  meeting.json             398 bytes  — recordingError: "There is not enough space on the disk. (os error 112)"
  .capture\mic-000001.wav … mic-000014.wav   (640,044 bytes each, last chunk 565,164 bytes — 14 partial chunks preserved)
  .capture\session.json
```

## No product code changes

Per the brief's landmines — this lane only observed, recorded, and reported. No product code was modified. Both test meetings (Greer, Carol & Anthony; Hollings Family) went through the app's own natural flows, untouched.

## Bench state left behind

- `LanternPlusDev` scheduled task: stopped and returned to Disabled (its at-rest state).
- `LegionAgent` scheduled task: left as found (was already Running at the start of this session, before any action of mine — left unchanged since its state going in wasn't something this lane controlled).
- `C:\keepance` (the unrelated main-line checkout): dev server stopped. Its `src/`/`src-tauri/` now contain a copy of lantern-plus source from this session's initial (mistaken) sync — flagging so whoever owns that folder re-syncs it from `keepance-3.0` before relying on it.
- Both test meetings (Greer, Carol & Anthony; Hollings Family) remain on disk as supporting evidence, per prior bench convention.
- Disk space fully restored (~62.8GB free) after the QA-35 test.
- SSH CDP/agent tunnels (local ports 9444/8766) closed.
- No hosts-file changes, no AI-provider disruption — the Anthropic key was left exactly as found: configured and Working.
