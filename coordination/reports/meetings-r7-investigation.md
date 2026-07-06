codex
Read-only mode honored. I only read files and reports. I did not run tests, start the app, touch the Legion, or change files.

**1. Notice Card**
Short answer: attempt 2 is probably not being mislabeled. The log sequence you gave shows attempt 1 timed out, then attempt 2 failed while opening the replacement browser guest.

Why:

- Attempt 1 starts here: [supervisor.ts](/home/jameson/lantern-plus/src/features/meetings/noticeCard/supervisor.ts:204). It logs `attempt: 1`, opens the guest window, then starts a join timer.
- `join-timeout` means this exact timer fired: [supervisor.ts](/home/jameson/lantern-plus/src/features/meetings/noticeCard/supervisor.ts:167). Default length is 120 seconds: [supervisor.ts](/home/jameson/lantern-plus/src/features/meetings/noticeCard/supervisor.ts:105).
- The first timeout can retry because the card never reached the lobby or meeting: [supervisor.ts](/home/jameson/lantern-plus/src/features/meetings/noticeCard/supervisor.ts:342).
- Attempt 2 logs here: [supervisor.ts](/home/jameson/lantern-plus/src/features/meetings/noticeCard/supervisor.ts:361).
- `terminal: internal` only appears in this notice-card path when `driver.open()` throws: [supervisor.ts](/home/jameson/lantern-plus/src/features/meetings/noticeCard/supervisor.ts:210). The error is swallowed and collapsed to `internal`: [supervisor.ts](/home/jameson/lantern-plus/src/features/meetings/noticeCard/supervisor.ts:220).

So: with the telemetry you pasted, I see one real `join-timeout`, then an open-window failure on retry. If there really was a second `pre-admit-giveup reason=join-timeout willRetry=false` before `terminal internal`, I’d need that raw log, because this code path should not produce both as the same final event.

What `join-timeout` mechanically means:

It means the supervisor did not receive `admitted` within 120 seconds. It does not prove where the guest got stuck. It could mean no page status came back, the Join button never worked, Teams stayed in prejoin, the guest sat in lobby, or the host never admitted it. In this specific first-attempt log, `willRetry=true` means it never reached lobby, so the host probably never saw the knock.

Most likely causes, ranked:

1. **Recognized-but-stuck join page.** This best matches `join-timeout` instead of `page-unrecognized`. The injected script reports `joining` forever when `ready-to-join` happens, even if `clickJoin()` returns false: [injectionScript.ts](/home/jameson/lantern-plus/src/features/meetings/noticeCard/injectionScript.ts:171), [teamsAdapter.ts](/home/jameson/lantern-plus/src/features/meetings/noticeCard/adapters/teamsAdapter.ts:330).
2. **Retry window failed to open.** This best explains `terminal internal`. Rust destroys any same-label old window, then immediately builds a new one: [mod.rs](/home/jameson/lantern-plus/src-tauri/src/commands/notice_card/mod.rs:55). On Windows, that may fail if WebView2 is still tearing down, but the real error is hidden.
3. **Shared WebView2 profile/cookies changing Teams’ path.** The prior report’s strongest theory still holds. The companion window does not set a separate profile folder: [mod.rs](/home/jameson/lantern-plus/src-tauri/src/commands/notice_card/mod.rs:60). That means Teams state can leak across runs.
4. **Status bridge/injection failed.** The app only knows the guest’s state through `document.title`: [tauriDriver.ts](/home/jameson/lantern-plus/src/features/meetings/noticeCard/tauriDriver.ts:58), [mod.rs](/home/jameson/lantern-plus/src-tauri/src/commands/notice_card/mod.rs:86). If that bridge fails, the 120-second timer fires.
5. **Slow Teams load.** Possible, but less likely for this exact telemetry because pure “loading” should become `page-unrecognized` after about 28 seconds: [injectionScript.ts](/home/jameson/lantern-plus/src/features/meetings/noticeCard/injectionScript.ts:23).

Strongest next diagnostic:

Add two small logs, not a behavior change:

```diff
- } catch {
+ } catch (err) {
+   this.onDiagnostic?.({ kind: 'open-failed', attempt: this.preAdmitRetryUsed ? 2 : 1, message: String(err) });
    if (this.terminal) return;
    this.fail('internal');
  }
```

And add in-page breadcrumbs for `phase`, `doc.URL`, `clickJoin returned false`, and `join button disabled`. That would separate “Teams page stuck” from “window failed to open.”

**2. Voice Announcements**
Feasible: yes, but not through normal speaker playback. The guest must feed spoken audio into the meeting as its microphone track.

Current map:

- The notice card is a real browser guest inside a Tauri WebView window: [mod.rs](/home/jameson/lantern-plus/src-tauri/src/commands/notice_card/mod.rs:40).
- The meeting page gets no Tauri powers; capabilities are only for `main`: [default.json](/home/jameson/lantern-plus/src-tauri/capabilities/default.json:5).
- The card already fakes its camera with canvas video and its mic with a silent generated audio track: [canvasCard.ts](/home/jameson/lantern-plus/src/features/meetings/noticeCard/canvasCard.ts:157), [canvasCard.ts](/home/jameson/lantern-plus/src/features/meetings/noticeCard/canvasCard.ts:174).
- The dry-run already proved the core trick: override `getUserMedia`, use Piper TTS as the guest mic, and send real audio through Teams: [REPORT.md](/home/jameson/lantern-plus/coordination/qa-campaign/evidence/realcall-20260704/REPORT.md:15).

Two viable implementation shapes:

1. **Best path: synthesize with existing Piper TTS, inject into fake mic stream.**
   Use `tts_speak` in the main app to make WAV bytes: [TTSService.ts](/home/jameson/lantern-plus/src/features/dictation/engine/TTSService.ts:86), [tts.rs](/home/jameson/lantern-plus/src-tauri/src/commands/tts.rs:143). Pass those bytes into the notice-card script. Decode them in the WebView with `AudioContext`, connect them to the same `MediaStreamDestination` that currently makes silence, then unmute only while speaking.
   Tradeoff: most flexible and uses the app’s real TTS system, but needs careful stop signaling.

2. **Simpler path: bundle two tiny fixed audio clips.**
   Ship two prerecorded local clips: “This meeting is being recorded” and “Recording stopped.” Feed those into the same fake mic stream.
   Tradeoff: much more reliable and fast for exactly these two phrases, but less customizable and needs separate clips for localization.

Important stop issue:

Right now stop closes the card immediately: [meetingStore.ts](/home/jameson/lantern-plus/src/features/meetings/meetingStore.ts:1118), [supervisor.ts](/home/jameson/lantern-plus/src/features/meetings/noticeCard/supervisor.ts:377). To say “Recording stopped,” stop must become “tell the guest to speak, wait briefly, then close.” That likely needs a new Rust command that runs JS inside the companion window, then the watchdog still force-closes after a short cap.
tokens used
167,312
Read-only mode honored. I only read files and reports. I did not run tests, start the app, touch the Legion, or change files.

**1. Notice Card**
Short answer: attempt 2 is probably not being mislabeled. The log sequence you gave shows attempt 1 timed out, then attempt 2 failed while opening the replacement browser guest.

Why:

- Attempt 1 starts here: [supervisor.ts](/home/jameson/lantern-plus/src/features/meetings/noticeCard/supervisor.ts:204). It logs `attempt: 1`, opens the guest window, then starts a join timer.
- `join-timeout` means this exact timer fired: [supervisor.ts](/home/jameson/lantern-plus/src/features/meetings/noticeCard/supervisor.ts:167). Default length is 120 seconds: [supervisor.ts](/home/jameson/lantern-plus/src/features/meetings/noticeCard/supervisor.ts:105).
- The first timeout can retry because the card never reached the lobby or meeting: [supervisor.ts](/home/jameson/lantern-plus/src/features/meetings/noticeCard/supervisor.ts:342).
- Attempt 2 logs here: [supervisor.ts](/home/jameson/lantern-plus/src/features/meetings/noticeCard/supervisor.ts:361).
- `terminal: internal` only appears in this notice-card path when `driver.open()` throws: [supervisor.ts](/home/jameson/lantern-plus/src/features/meetings/noticeCard/supervisor.ts:210). The error is swallowed and collapsed to `internal`: [supervisor.ts](/home/jameson/lantern-plus/src/features/meetings/noticeCard/supervisor.ts:220).

So: with the telemetry you pasted, I see one real `join-timeout`, then an open-window failure on retry. If there really was a second `pre-admit-giveup reason=join-timeout willRetry=false` before `terminal internal`, I’d need that raw log, because this code path should not produce both as the same final event.

What `join-timeout` mechanically means:

It means the supervisor did not receive `admitted` within 120 seconds. It does not prove where the guest got stuck. It could mean no page status came back, the Join button never worked, Teams stayed in prejoin, the guest sat in lobby, or the host never admitted it. In this specific first-attempt log, `willRetry=true` means it never reached lobby, so the host probably never saw the knock.

Most likely causes, ranked:

1. **Recognized-but-stuck join page.** This best matches `join-timeout` instead of `page-unrecognized`. The injected script reports `joining` forever when `ready-to-join` happens, even if `clickJoin()` returns false: [injectionScript.ts](/home/jameson/lantern-plus/src/features/meetings/noticeCard/injectionScript.ts:171), [teamsAdapter.ts](/home/jameson/lantern-plus/src/features/meetings/noticeCard/adapters/teamsAdapter.ts:330).
2. **Retry window failed to open.** This best explains `terminal internal`. Rust destroys any same-label old window, then immediately builds a new one: [mod.rs](/home/jameson/lantern-plus/src-tauri/src/commands/notice_card/mod.rs:55). On Windows, that may fail if WebView2 is still tearing down, but the real error is hidden.
3. **Shared WebView2 profile/cookies changing Teams’ path.** The prior report’s strongest theory still holds. The companion window does not set a separate profile folder: [mod.rs](/home/jameson/lantern-plus/src-tauri/src/commands/notice_card/mod.rs:60). That means Teams state can leak across runs.
4. **Status bridge/injection failed.** The app only knows the guest’s state through `document.title`: [tauriDriver.ts](/home/jameson/lantern-plus/src/features/meetings/noticeCard/tauriDriver.ts:58), [mod.rs](/home/jameson/lantern-plus/src-tauri/src/commands/notice_card/mod.rs:86). If that bridge fails, the 120-second timer fires.
5. **Slow Teams load.** Possible, but less likely for this exact telemetry because pure “loading” should become `page-unrecognized` after about 28 seconds: [injectionScript.ts](/home/jameson/lantern-plus/src/features/meetings/noticeCard/injectionScript.ts:23).

Strongest next diagnostic:

Add two small logs, not a behavior change:

```diff
- } catch {
+ } catch (err) {
+   this.onDiagnostic?.({ kind: 'open-failed', attempt: this.preAdmitRetryUsed ? 2 : 1, message: String(err) });
    if (this.terminal) return;
    this.fail('internal');
  }
```

And add in-page breadcrumbs for `phase`, `doc.URL`, `clickJoin returned false`, and `join button disabled`. That would separate “Teams page stuck” from “window failed to open.”

**2. Voice Announcements**
Feasible: yes, but not through normal speaker playback. The guest must feed spoken audio into the meeting as its microphone track.

Current map:

- The notice card is a real browser guest inside a Tauri WebView window: [mod.rs](/home/jameson/lantern-plus/src-tauri/src/commands/notice_card/mod.rs:40).
- The meeting page gets no Tauri powers; capabilities are only for `main`: [default.json](/home/jameson/lantern-plus/src-tauri/capabilities/default.json:5).
- The card already fakes its camera with canvas video and its mic with a silent generated audio track: [canvasCard.ts](/home/jameson/lantern-plus/src/features/meetings/noticeCard/canvasCard.ts:157), [canvasCard.ts](/home/jameson/lantern-plus/src/features/meetings/noticeCard/canvasCard.ts:174).
- The dry-run already proved the core trick: override `getUserMedia`, use Piper TTS as the guest mic, and send real audio through Teams: [REPORT.md](/home/jameson/lantern-plus/coordination/qa-campaign/evidence/realcall-20260704/REPORT.md:15).

Two viable implementation shapes:

1. **Best path: synthesize with existing Piper TTS, inject into fake mic stream.**
   Use `tts_speak` in the main app to make WAV bytes: [TTSService.ts](/home/jameson/lantern-plus/src/features/dictation/engine/TTSService.ts:86), [tts.rs](/home/jameson/lantern-plus/src-tauri/src/commands/tts.rs:143). Pass those bytes into the notice-card script. Decode them in the WebView with `AudioContext`, connect them to the same `MediaStreamDestination` that currently makes silence, then unmute only while speaking.
   Tradeoff: most flexible and uses the app’s real TTS system, but needs careful stop signaling.

2. **Simpler path: bundle two tiny fixed audio clips.**
   Ship two prerecorded local clips: “This meeting is being recorded” and “Recording stopped.” Feed those into the same fake mic stream.
   Tradeoff: much more reliable and fast for exactly these two phrases, but less customizable and needs separate clips for localization.

Important stop issue:

Right now stop closes the card immediately: [meetingStore.ts](/home/jameson/lantern-plus/src/features/meetings/meetingStore.ts:1118), [supervisor.ts](/home/jameson/lantern-plus/src/features/meetings/noticeCard/supervisor.ts:377). To say “Recording stopped,” stop must become “tell the guest to speak, wait briefly, then close.” That likely needs a new Rust command that runs JS inside the companion window, then the watchdog still force-closes after a short cap.
