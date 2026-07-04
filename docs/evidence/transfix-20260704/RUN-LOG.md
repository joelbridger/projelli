# QA-40 transcript-hang fix — root cause, restage, and live verification

**Lane:** cc-lantern-transfix · **Date:** 2026-07-04 · **Bench:** Legion Windows laptop (Tailscale `james@100.127.67.22`) · **App:** `C:\lantern-plus` on branch `lp/transcript-hang` · **Product commits:** `92a9d167`, `2df9ead1`, `f4e0b2e4` (branch `lp/transcript-hang`, pushed, not yet merged).

## Plain-language summary for Jameson

Short version: **the "meeting transcript hangs forever" bug is fixed, and I found and fixed a second, deeper bug hiding behind it that would have kept transcripts silently broken even after the first fix.**

1. **What everyone thought was happening:** a stuck program (the "engine" that turns speech into text) that just never finished — like a frozen app you have to force-quit.
2. **What was actually happening (bug #1):** the program that turns speech into text couldn't find the "model" file it needs (like a dictionary it reads from) because it was saved in the wrong folder. That failure happened almost instantly — a tenth of a second, not a hang — but the app's own code was throwing that failure straight in the trash instead of telling anyone. So a fast, already-finished failure LOOKED exactly like an infinite hang, because nothing on screen ever changed either way.
3. **What I found while testing the fix (bug #2):** even after fixing the folder problem, a real recording still came back with an empty transcript — no error, but no words either. I tracked this down to the app holding a file open with one hand while asking a separate program to read that same file with the other hand. On Windows, that specific combination let the second program quietly read nothing at all and say "done!" instead of complaining. I fixed that by making the app let go of the file before handing it off.
4. **Proof:** after both fixes, I recorded three real short test calls (using a computer voice speaking through the Legion's speakers, captured the same way a real Zoom call would be) and all three produced correct, real, readable transcripts.
5. **One more thing I noticed, unrelated to this bug:** in this session, the "AI writes your meeting notes" step didn't finish for any of my three test recordings, with no error shown either. I did NOT chase this down — it's a different part of the app than what I was sent to fix, and my best guess (not confirmed) is that this session's very heavy back-and-forth testing may have left something in a confusing state. I'm flagging it clearly so it isn't missed, not claiming it's broken for real users.

## Root cause #1 — a staging path mismatch, NOT a subprocess hang

**The reported symptom (from `docs/evidence/meetings-verify3-20260704/RUN-LOG.md`):** a real recording's transcript pipeline processed the mic channel, then appeared to hang forever on the sys (system audio) channel — no progress, no CPU, no error, restart didn't help.

**Working hypothesis in the brief:** the old shim binary was blocking forever on a stdin read it never received, since the app's new code (post `6cf6f6a4`/`aa0ab3eb`, "speak whisper.cpp's real CLI contract") no longer pipes stdin.

**What was actually proven, step by step:**

1. Confirmed via the Legion's filesystem that the voice model (`ggml-base.en.bin`) was staged at `src-tauri\binaries\whisper-engine\models\` — the OLD shim-era location — not `src-tauri\resources\voice\models\`, which is the ONLY place `resolve_models_dir()` (`src-tauri/src/commands/voice.rs`) actually looks post-voicefix.
2. Directly invoked the real `transcribe_meeting` Tauri command against the app's live WebView2 (via CDP + `scripts/desktop-drive.mjs`), targeting the exact stuck Diaz/Sandra meeting left over from the prior session. Result: **failed in 125ms** with `"no voice model bundled for this platform (expected a ggml model under resources/voice/models — see scripts/fetch-voice-models.sh)"`. This is conclusive: the call is not hanging — it's failing almost instantly.
3. Checked `.transcribe-progress.json` from that stuck meeting: `{"done":["mic:0","mic:23000","mic:46000","mic:69000"],"partial":[]}` — all four mic windows marked "done" with **zero segments produced**. This matches a test methodology where TTS audio was played through the bench's speakers (captured on the "sys"/loopback channel) while the mic itself picked up near-silence — so the mic channel's windows were all silence-gated and skipped (no sidecar call ever made, "done" trivially), and the sys channel's first real window is exactly where the fast, silent failure hit.
4. `meetingStore.ts`'s `stopRecording()` wrapped `transcribe_meeting` in a bare `try { await invoke(...) } catch { /* Queued until the voice engine is installed */ }` — so this 125ms failure vanished with zero trace. From the outside (UI state frozen on "queued", no CPU activity for as long as anyone kept watching), this is **indistinguishable from a genuine multi-minute hang** — which is exactly why the prior session concluded it was stuck.

**This working hypothesis (shim blocking on stdin) was disproven**, not confirmed: the failure happens before any subprocess is ever spawned (model resolution fails first), so there's nothing to block on.

## Restaging the Legion (per the new file-based contract)

- Removed the obsolete shim (`whisper.exe`, a ~50-line Rust translator built for the old `--stdin --model <tier>` contract) and its isolated `whisper-engine\` subfolder.
- Built a real, static `whisper-cli.exe` from the pinned `whisper.cpp` source already cloned at `C:\sidecar-build\whisper.cpp` (commit `6fc7c33b`), using the exact flags `scripts/build-voice-sidecar.sh` specifies (`-DBUILD_SHARED_LIBS=OFF -DGGML_NATIVE=OFF -DGGML_OPENMP=OFF`), via the MSVC generator (the default Ninja+MinGW toolchain on this box fails to build ggml's Windows power-throttling API calls — confirmed by reproducing that exact failure first, then switching to `-G "Visual Studio 17 2022" -A x64`).
- Verified the resulting binary is genuinely self-contained (tested in complete isolation from the shared `binaries\` folder's other ggml*.dll files, which belong to the llama.cpp sidecar) — it transcribed correctly with zero sibling DLLs.
- Staged it at `src-tauri\binaries\whisper.exe` (the flat, non-shim location the app's own `resolve_sidecar_path` looks for).
- Reused the already-downloaded, SHA256-verified `ggml-base.en.bin` (moved to the correct `src-tauri\resources\voice\models\` path this time).
- Confirmed Settings → Voice still shows **"Voice ready."**

None of this is committed to source control (`binaries/` and `resources/voice/models/` are gitignored dev/CI artifacts, matching the existing convention for the diarize and llama.cpp sidecars).

## Product fix #1 — meetingStore.ts / MeetingEntry.tsx (the silent catch)

Even with the staging fixed, the underlying design flaw remained: **any** `transcribe_meeting` failure — a missing model, a wedged engine, anything — was silently discarded, with no way for an advisor to know or retry. Fixed to mirror the existing QA-31 notes-error pattern exactly:

- `meetingStore.ts`: `transcribeMeetingSerialized`/`runTranscribeMeeting` replace the bare catch. A failure is classified (`not-installed` / `timeout` / `error`) and persisted as `transcriptError` on `meeting.json`, mirroring `notesError`. A new exported `retryMeetingTranscript()` mirrors `retryMeetingNotes()` — the Rust side resumes from `.transcribe-progress.json`, so a retry only redoes the windows that never completed, then chains into notes generation on success.
- `needsReview()` gained a `'transcript-failed'` kind, so a failed transcript surfaces in the same review queue an advisor already checks, not just on the meeting's own page.
- `MeetingEntry.tsx`: the transcript pane now shows an honest, classified failed state + a working Retry button when `transcriptError` is set, instead of a permanent "Transcription is queued" message.
- New i18n keys added to `en.json`/`es.json`/`de.json`.
- Tests: `tests/unit/meeting-store.test.ts` (classification + retry + serialization), `tests/unit/meeting-needs-review.test.ts`, and a new `tests/unit/meetings/meeting-entry-transcript-failed.test.tsx`.

## Product-side hole check — the engine-level timeout already exists and works

The brief asked specifically: does a wedged engine subprocess have a bounded timeout + honest error, or is that hole still open? **It's already closed, and now proven with a real test, not just code inspection.**

`ParakeetSidecar::transcribe` (`src-tauri/src/sidecars/parakeet.rs`) already had a 30-second `tokio::time::timeout` + `kill_on_drop(true)` around the subprocess call, added in the same lane that shipped the new engine contract (`aa0ab3eb`). Added a new test, `transcribe_kills_a_wedged_engine_and_returns_a_bounded_timeout_error`, using a real fake-engine subprocess that sleeps forever and never exits: it confirms the process is genuinely spawned and running (checked via `/proc/<pid>`), fast-forwards virtual time past the 30s bound (`tokio::time::pause`/`advance`, so the test runs in 0.01s of real wall-clock time), and confirms both that a classified `"timed out"` error is returned AND that the wedged process is actually reaped (not left running in the background). **This protection was already correct — the original hang was never actually an engine-level problem.**

## Root cause #2 — found live: the temp file's write handle stayed open

After the staging fix, a real recording still came back with **zero transcript segments** despite confirmed-loud, real audio — no error this time, just empty results. This is a second, independent, more fundamental bug, only found by actually testing on real hardware:

1. Downloaded the real captured `audio.wav` and ran a Python pass computing per-window RMS using the exact same math as the app's own `rms()`/`read_channel_window()` (`src-tauri/src/commands/capture/transcribe.rs`). Result: sys-channel windows at 0s and 23s clearly audible (rms 0.10 and 0.04, both well above the 0.008 gate); one weak mic window at 46s (0.017).
2. Manually ran the real `whisper.exe` against the exact extracted window (written via a plain `std::fs::write`, i.e. a file that's fully closed before anything reads it): **worked perfectly**, producing the full correct sentence in ~1.9 real seconds.
3. Re-invoked the app's own `transcribe_meeting` command directly: it completed in **~1.28 seconds total** for all three audible windows combined — impossibly fast for even one real ~1.9s engine call — and returned **empty text for every window**, with no error (the whole call reported success).
4. Added temporary debug instrumentation confirming the app's own RMS values matched the Python analysis exactly (ruling out a channel-extraction bug), and that `wav_mono_bytes()`'s own output, dumped to a fixed path and fed to `whisper.exe` standalone, **also transcribed perfectly** — ruling out the WAV construction itself.

That isolated the bug to `ParakeetSidecar::transcribe`'s temp-file handling: it wrote the WAV bytes to a `tempfile::NamedTempFile` and passed `tmp.path()` to the child process **while still holding the write handle open** for the child's entire run. On Windows, this let `whisper-cli.exe`'s underlying file/audio decoder open the file and read **zero bytes** — not a sharing-violation error, just silent empty input, giving a clean exit code 0 with no output.

**Fix:** call `tmp.into_temp_path()` right after writing and flushing — this closes the write handle immediately (the file itself isn't deleted until the returned `TempPath` guard drops at the end of the function, i.e. after the child has finished reading it). One-line, idiomatic use of the `tempfile` crate's own API for exactly this situation.

**Test coverage note (stated plainly, not hidden):** this is a Windows-file-sharing-model-specific race. It does not reproduce on Linux (this crate's CI/dev target — see the existing `#[cfg(unix)]... never Windows` note already in this same file for the fake-engine tests), so there is no practical way to encode it as an automated test in this repo's gate. The existing `transcribe_writes_wav_to_tempfile_and_cleans_up_after` test still passes, confirming the temp-file write/cleanup behavior is otherwise unchanged. This live verification (three independent real recordings, detailed below) is the real regression evidence for this fix.

## Live verify — real recordings, no seeded fixtures

Three independent real recordings on a fresh client (Voss, Eleanor — not previously used in any prior session), each using real Windows text-to-speech played through the Legion's own speakers and captured through the app's actual "Record a meeting" button (consent flow, real audio capture, real stop), exactly the way a real advisor would use it:

| Take | Duration | Transcript result |
|---|---|---|
| 1 (~65s) | 3 segments, both mic and sys channels — sys channel: *"Hi, this is Sarah calling to follow up on the Voss household portfolio review..."* (full, correct, real content); mic channel picked up incidental background speech, also correctly transcribed |
| 2 (~29s) | 1 segment, sys channel: *"Hi Eleanor, this is Sarah following up after our call. We agreed to rebalance your portfolio by moving 5% from cash into your core equity fund, and I will email you the updated statement by Friday. Thanks so much for your time today, talk soon."* — verbatim match to the real spoken TTS content |
| 3 (~16s) | 1 segment, sys channel: *"This is a quick clean verification test for the notes pipeline."* — verbatim |

All three ran through the app's own natural pipeline (record → stop → automatic transcription), no manual fixture-seeding, confirming the original QA-40 symptom (transcript pipeline stalling/never completing on a real two-channel recording) is fully resolved. Screenshots: `screenshots/01-meetings-list-after-first-two-takes.jpeg`, `screenshots/02-real-transcript-landed-in-ui.jpeg` (shows the real transcript rendered in the app's own transcript viewer), `screenshots/03-meetings-list-after-fresh-reload.jpeg`, `screenshots/04-meetings-list-after-third-clean-take.jpeg`.

## New finding, out of QA-40's scope — notes generation did not land on any of the 3 takes this session

For all three takes above, the notes-generation step ("Notes are being written from the transcript...") never resolved to either a landed `notes.docx` or a classified `notesError` — it stayed in the pending state indefinitely, with `processingCount` back to 0 (meaning `stopRecording()`'s whole promise chain had already resolved) and no error ever recorded.

This is **not the same bug as QA-40** (which is specifically about the transcript step) and I did not attempt to fix it — flagging it clearly rather than chasing it, consistent with how the prior `meetings-verify3` session flagged the original transcript hang as a new, unrelated finding while completing its own assigned scope.

What I ruled out:
- The AI provider itself resolves fine (`buildResolvedProviderForGlance()` returns a valid `anthropic`/`claude-sonnet-4-6` result when called directly).
- It is not a timing race with the transcript step — `generateNotesSerialized` is `await`ed strictly after `transcribeMeetingSerialized` resolves, and `transcript.json` is confirmed present and valid by the time notes-generation would read it.
- It reproduced identically on all three independent takes, including one done after a full, clean page reload with zero diagnostic interference — so it isn't an artifact of a single flaky run.

My best (unconfirmed) working theory: `tryGenerateNotes()`'s very first step reads `${meetingDir}/meeting.json` via the JS-side `WorkspaceService`, silently discarding a null result — but *durationMs* also never got merged into any of these meetings' `meeting.json` (a separate, earlier JS-side read+write in the same `stopRecording()` function, also wrapped in a silent `.catch(() => null)`/`.catch(() => {})`), across every test meeting in this session including ones from *before* my changes. That's consistent with JS-side `WorkspaceService` reads/writes against these particular meeting folders silently failing in this session, while direct Rust-side `std::fs` writes (which is how `meeting.json` and `transcript.json` actually got their real content) work fine regardless. I did not chase this to a confirmed root cause — it would need a dedicated investigation into the `WorkspaceService`/Tauri FS-scope path, and this session had already been through heavy diagnostic churn (many rapid rebuilds, page reloads, and broken module-import diagnostics) that could plausibly have contributed. Recommend a fresh, clean bench session to confirm whether this reproduces outside this session's conditions before treating it as a confirmed bug.

## Bench state left behind

- `LanternPlusDev` scheduled task: stopped, returned to Disabled (its at-rest state).
- SSH CDP tunnel (port 9470 on this server → Legion :9223) closed.
- Debug artifacts (`C:\qa40-debug-window.wav`, `C:\sys-window0-mono.wav`) removed from the Legion during the investigation; none left behind.
- The real evidence meetings (Voss, Eleanor ×3, plus the pre-existing Diaz, Sandra / Patel, Priya from the prior session) remain on disk under `C:\keepance-demo-northcrest\...\Clients\`, left in place as supporting evidence per prior bench convention.
- No product code changes were made directly on the Legion — all product fixes live in `~/lp-transfix` on branch `lp/transcript-hang` (commits `92a9d167`, `2df9ead1`, `f4e0b2e4`), pushed to `origin/lp/transcript-hang`, not self-merged.

## Screenshots

All in `screenshots/`, numbered in narrative order (01–04).
