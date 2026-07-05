**Ranked Findings**

1. **P0 privacy/wrong-client risk: RAG retag failures are swallowed after client or privilege changes**  
   [useMemoryWiring.ts:1489](/home/jameson/lantern-plus/src/platform/hooks/useMemoryWiring.ts:1489), [useMemoryWiring.ts:1524](/home/jameson/lantern-plus/src/platform/hooks/useMemoryWiring.ts:1524), [useMemoryWiring.ts:1549](/home/jameson/lantern-plus/src/platform/hooks/useMemoryWiring.ts:1549)  
   Scenario: user changes which client a folder/email folder belongs to, or marks a source as privileged. If the retag call fails, the error is swallowed. The UI says the new rule is active, but search may still use old tags. Worst case: privileged content remains available in normal Ask, or content stays attached to the wrong client.  
   Recommended change: replace `.catch(() => {})` with durable retry plus visible “search scope update failed” state. For privilege retag failure, fail closed: exclude the source until retag succeeds.

2. **P1 broken feature: shared client notes can stay on “Loading” forever**  
   [MatterNotesEditorWrapper.tsx:52](/home/jameson/lantern-plus/src/features/matters/MatterNotesEditorWrapper.tsx:52)  
   Scenario: `ensureMatterSync(matter)` rejects because key fetch, sync startup, or crypto setup fails. The promise has `.then(...)` but no `.catch(...)`. `loading` stays `true`, so Jameson sees a permanent loading screen instead of the existing locked/no-access state.  
   Recommended change: add `.catch`, set `loading` false, set sync status/error, and render the fail-closed panel.

3. **P1 broken feature: live co-edit sync does not re-arm after a socket drop**  
   [MatterSyncClient.ts:288](/home/jameson/lantern-plus/src/platform/firm/MatterSyncClient.ts:288), [MatterSyncClient.ts:338](/home/jameson/lantern-plus/src/platform/firm/MatterSyncClient.ts:338)  
   Scenario: websocket closes or a local update push fails. The client sets status to `offline`, but there is no reconnect loop and failed local updates are not queued. User may keep editing, but teammates do not receive changes until some outside restart/reopen path recreates sync.  
   Recommended change: add reconnect with backoff while `started === true`, and queue unsent Yjs updates until push succeeds.

4. **P1 broken feature: meeting notes file can exist, but the meeting screen says “notes pending” after chunk-load failure**  
   [MeetingEntry.tsx:115](/home/jameson/lantern-plus/src/features/meetings/MeetingEntry.tsx:115), [MeetingEntry.tsx:378](/home/jameson/lantern-plus/src/features/meetings/MeetingEntry.tsx:378)  
   Scenario: dynamic import of `DocxEditor` fails. `DocxEditorComp` stays `null`. If `notes.docx` exists, the UI falls through to “notes pending,” which is false. This matches today’s chunk-load flake class.  
   Recommended change: track `docxEditorLoadError`; show “couldn’t load notes editor” with retry instead of pending.

5. **P1 broken feature: calendar failures are treated as “no meetings today,” so auto-prep silently dies**  
   [TodaysMeetingsStrip.tsx:98](/home/jameson/lantern-plus/src/features/meetings/TodaysMeetingsStrip.tsx:98), [TodaysMeetingsStrip.tsx:147](/home/jameson/lantern-plus/src/features/meetings/TodaysMeetingsStrip.tsx:147), [useMeetingAutoprep.ts:97](/home/jameson/lantern-plus/src/features/meetings/useMeetingAutoprep.ts:97)  
   Scenario: `calendarListEvents` fails. The strip sets `events` to `[]` and returns `null`; the background rescan also converts failure to `[]`. User sees no Today strip and no prep briefs, even though calendar access failed.  
   Recommended change: store a calendar error state, show a small retryable calendar warning, and do not treat failed fetch as empty calendar.

6. **P2 wrong state: “Refresh brief” silently does nothing if calendar lookup fails**  
   [BeforeYouMeetStrip.tsx:128](/home/jameson/lantern-plus/src/features/meetings/BeforeYouMeetStrip.tsx:128)  
   Scenario: user clicks refresh on a stale brief. If calendar fetch fails, `events` becomes `[]`, no job is queued, and the UI gives no error. The stale brief remains stale with no explanation.  
   Recommended change: add per-brief refresh error state and retry button. Do not swallow calendar failures as empty lists.

7. **P2 wrong state: meeting folder read failures can masquerade as “pending” content**  
   [ClientMeetingsTab.tsx:114](/home/jameson/lantern-plus/src/features/meetings/ClientMeetingsTab.tsx:114), [ClientMeetingsTab.tsx:117](/home/jameson/lantern-plus/src/features/meetings/ClientMeetingsTab.tsx:117), [ClientMeetingsTab.tsx:194](/home/jameson/lantern-plus/src/features/meetings/ClientMeetingsTab.tsx:194)  
   Scenario: one meeting folder cannot be listed or its `meeting.json` cannot be read. The row still renders, but with missing notes/audio/transcript/meta. User sees “pending” or generic data instead of “this meeting could not be read.” Notice ledger failure also clears notice states.  
   Recommended change: carry per-row read errors into `MeetingSummary` and show “couldn’t read this meeting” with retry.

8. **P2 wrong state: fact extraction failure is marked as already handled, so it never retries**  
   [AIChatViewer.tsx:558](/home/jameson/lantern-plus/src/features/ask/AIChatViewer.tsx:558)  
   Scenario: after an Ask answer, fact extraction fails once. The catch marks the checkpoint as run, so the same answer will not try again. User just never sees proposed facts. In auto-accept mode, individual save failures are also swallowed.  
   Recommended change: store extraction error or retry eligibility separately from “successfully checked.” Do not advance the checkpoint on transient provider/storage failure.

**Rust pass**

I did not find a high-confidence new Rust-side instance in this sweep. The Rust hits I inspected were mostly cleanup sends, temp-file cleanup, event emission, or already-commented best-effort logging. The strongest recurring bug class still appears in frontend orchestration around async Rust calls and long-running state.
tokens used
161,331
Read-only report only. I did **not** write `/home/jameson/lantern-plus/coordination/qa-campaign/static-swallow-sweep.md` or commit, because that conflicts with your “do not create/edit/mutate” instruction.

**Ranked Findings**

1. **P0 privacy/wrong-client risk: RAG retag failures are swallowed after client or privilege changes**  
   [useMemoryWiring.ts:1489](/home/jameson/lantern-plus/src/platform/hooks/useMemoryWiring.ts:1489), [useMemoryWiring.ts:1524](/home/jameson/lantern-plus/src/platform/hooks/useMemoryWiring.ts:1524), [useMemoryWiring.ts:1549](/home/jameson/lantern-plus/src/platform/hooks/useMemoryWiring.ts:1549)  
   Scenario: user changes which client a folder/email folder belongs to, or marks a source as privileged. If the retag call fails, the error is swallowed. The UI says the new rule is active, but search may still use old tags. Worst case: privileged content remains available in normal Ask, or content stays attached to the wrong client.  
   Recommended change: replace `.catch(() => {})` with durable retry plus visible “search scope update failed” state. For privilege retag failure, fail closed: exclude the source until retag succeeds.

2. **P1 broken feature: shared client notes can stay on “Loading” forever**  
   [MatterNotesEditorWrapper.tsx:52](/home/jameson/lantern-plus/src/features/matters/MatterNotesEditorWrapper.tsx:52)  
   Scenario: `ensureMatterSync(matter)` rejects because key fetch, sync startup, or crypto setup fails. The promise has `.then(...)` but no `.catch(...)`. `loading` stays `true`, so Jameson sees a permanent loading screen instead of the existing locked/no-access state.  
   Recommended change: add `.catch`, set `loading` false, set sync status/error, and render the fail-closed panel.

3. **P1 broken feature: live co-edit sync does not re-arm after a socket drop**  
   [MatterSyncClient.ts:288](/home/jameson/lantern-plus/src/platform/firm/MatterSyncClient.ts:288), [MatterSyncClient.ts:338](/home/jameson/lantern-plus/src/platform/firm/MatterSyncClient.ts:338)  
   Scenario: websocket closes or a local update push fails. The client sets status to `offline`, but there is no reconnect loop and failed local updates are not queued. User may keep editing, but teammates do not receive changes until some outside restart/reopen path recreates sync.  
   Recommended change: add reconnect with backoff while `started === true`, and queue unsent Yjs updates until push succeeds.

4. **P1 broken feature: meeting notes file can exist, but the meeting screen says “notes pending” after chunk-load failure**  
   [MeetingEntry.tsx:115](/home/jameson/lantern-plus/src/features/meetings/MeetingEntry.tsx:115), [MeetingEntry.tsx:378](/home/jameson/lantern-plus/src/features/meetings/MeetingEntry.tsx:378)  
   Scenario: dynamic import of `DocxEditor` fails. `DocxEditorComp` stays `null`. If `notes.docx` exists, the UI falls through to “notes pending,” which is false. This matches today’s chunk-load flake class.  
   Recommended change: track `docxEditorLoadError`; show “couldn’t load notes editor” with retry instead of pending.

5. **P1 broken feature: calendar failures are treated as “no meetings today,” so auto-prep silently dies**  
   [TodaysMeetingsStrip.tsx:98](/home/jameson/lantern-plus/src/features/meetings/TodaysMeetingsStrip.tsx:98), [TodaysMeetingsStrip.tsx:147](/home/jameson/lantern-plus/src/features/meetings/TodaysMeetingsStrip.tsx:147), [useMeetingAutoprep.ts:97](/home/jameson/lantern-plus/src/features/meetings/useMeetingAutoprep.ts:97)  
   Scenario: `calendarListEvents` fails. The strip sets `events` to `[]` and returns `null`; the background rescan also converts failure to `[]`. User sees no Today strip and no prep briefs, even though calendar access failed.  
   Recommended change: store a calendar error state, show a small retryable calendar warning, and do not treat failed fetch as empty calendar.

6. **P2 wrong state: “Refresh brief” silently does nothing if calendar lookup fails**  
   [BeforeYouMeetStrip.tsx:128](/home/jameson/lantern-plus/src/features/meetings/BeforeYouMeetStrip.tsx:128)  
   Scenario: user clicks refresh on a stale brief. If calendar fetch fails, `events` becomes `[]`, no job is queued, and the UI gives no error. The stale brief remains stale with no explanation.  
   Recommended change: add per-brief refresh error state and retry button. Do not swallow calendar failures as empty lists.

7. **P2 wrong state: meeting folder read failures can masquerade as “pending” content**  
   [ClientMeetingsTab.tsx:114](/home/jameson/lantern-plus/src/features/meetings/ClientMeetingsTab.tsx:114), [ClientMeetingsTab.tsx:117](/home/jameson/lantern-plus/src/features/meetings/ClientMeetingsTab.tsx:117), [ClientMeetingsTab.tsx:194](/home/jameson/lantern-plus/src/features/meetings/ClientMeetingsTab.tsx:194)  
   Scenario: one meeting folder cannot be listed or its `meeting.json` cannot be read. The row still renders, but with missing notes/audio/transcript/meta. User sees “pending” or generic data instead of “this meeting could not be read.” Notice ledger failure also clears notice states.  
   Recommended change: carry per-row read errors into `MeetingSummary` and show “couldn’t read this meeting” with retry.

8. **P2 wrong state: fact extraction failure is marked as already handled, so it never retries**  
   [AIChatViewer.tsx:558](/home/jameson/lantern-plus/src/features/ask/AIChatViewer.tsx:558)  
   Scenario: after an Ask answer, fact extraction fails once. The catch marks the checkpoint as run, so the same answer will not try again. User just never sees proposed facts. In auto-accept mode, individual save failures are also swallowed.  
   Recommended change: store extraction error or retry eligibility separately from “successfully checked.” Do not advance the checkpoint on transient provider/storage failure.

**Rust pass**

I did not find a high-confidence new Rust-side instance in this sweep. The Rust hits I inspected were mostly cleanup sends, temp-file cleanup, event emission, or already-commented best-effort logging. The strongest recurring bug class still appears in frontend orchestration around async Rust calls and long-running state.
