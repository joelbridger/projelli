# Lantern Plus UI Reachability Audit

Date: 2026-07-03  
Repo/branch: `/home/jameson/lantern-plus`, `lantern-plus`  
Mode: read-only investigation; this report is the only file written.

## Executive Summary

I traced the Wave 0, Wave 1, and Wave 2 acceptance items from the assembled app shell into the actual mounted components.

Most user-facing controls are mounted. A lot of them are intentionally hidden or disabled in the realistic bench state Jameson described: one IMAP mailbox, no CRM connected yet, non-shared matters, empty calendar, and Local-only mode.

I found two remaining reachability-class risks:

1. **UNREACHABLE: Wave 1 scheduled calendar rescan while the app is running.** The plan describes a recurring rescan hook, but the app currently refreshes meetings only on strip mount and calendar sync events. I found no `useAutoprepRescan` or equivalent mounted hook.
2. **UNREACHABLE: Wave 2 CRM field-level updates from real app actions.** The review card can render field-update rows, but no production UI path appears to enqueue those field rows. The only non-test references are the store type and store method.

## Realistic Bench State Used

- Mail: one IMAP mailbox.
- CRM: no CRM connected yet.
- Matters: non-shared matters.
- Calendar: empty calendar.
- Privacy: Local-only mode.

## Status Legend

- **REACHABLE**: A normal user path from app launch reaches the control.
- **CONDITIONALLY-BLOCKED**: The control exists, but realistic state or required data hides/disables it.
- **UNREACHABLE**: The planned UI/action has no real mounted path, or only exists as rendering code with no app action that can feed it.

## Findings Table

| Wave | Acceptance item | Click path from app launch | Status | Evidence / blocking condition |
|---|---|---|---|---|
| 0 | Draft follow-up button for Word documents | Launch -> Client Map -> open a client -> Documents -> open a mapped `.docx` -> top editor bar -> `Draft follow-up` | REACHABLE | `src/app/shell/layout/MainPanel.tsx:846` passes `onDraftFollowUp` into `DocxEditor`; `src/features/documents/media/DocxEditor.tsx:1248` renders `data-testid="docx-draft-follow-up"`. |
| 0 | Draft follow-up button for text/Markdown documents | Launch -> Client Map -> open a client -> Documents -> open `.md`, `.markdown`, or `.txt` -> formatting toolbar -> `Draft follow-up` | REACHABLE | `src/app/shell/layout/MainPanel.tsx:986` mounts `FormattingToolbar` for text documents; `src/features/documents/editor/FormattingToolbar.tsx:515` renders `data-testid="draft-followup-button"`. |
| 0 | Draft follow-up modal: `Save to my Drafts` | Same as draft follow-up path -> modal footer -> `Save to my Drafts` | CONDITIONALLY-BLOCKED | With only IMAP, saving drafts is intentionally disabled: `src/features/email/DraftFollowUpModal.tsx:200` sets `canSaveDraft` false for IMAP; `src/features/email/DraftFollowUpModal.tsx:526` explains the block; `src/features/email/DraftFollowUpModal.tsx:568` disables the button. This matches the Wave 0 plan: IMAP draft save is out of scope. |
| 0 | Draft follow-up modal: `Send` | Same as draft follow-up path -> modal footer -> `Send` | CONDITIONALLY-BLOCKED | IMAP can send, but the button still needs a connected account, recipient, and non-empty generated body: `src/features/email/DraftFollowUpModal.tsx:540`. In Local-only mode, generation can also fail before the body is created: `src/features/email/DraftFollowUpModal.tsx:140`. |
| 0 | Client Map source chips show Jump/Zocks/meeting-note provenance | Launch -> Client Map -> open a client -> Client Map section -> citation/source chip | CONDITIONALLY-BLOCKED | Mounted only after the Client Map is ready: `src/features/matters/MatterHub.tsx:461`. Labels are implemented in `src/platform/clientMap/meetingNoteSources.ts:33` and rendered in `src/features/matters/ClientMapPanel.tsx:249`. Requires a map item with an imported meeting-note source. |
| 0 | `Imported meeting notes` filter chip in Client Map sections | Launch -> Client Map -> open a client -> Client Map section with meeting-note sources -> filter chip | CONDITIONALLY-BLOCKED | The chip only appears when that section has at least one imported meeting-note source: `src/features/matters/ClientMapPanel.tsx:452` and `src/features/matters/ClientMapPanel.tsx:465`. Empty or non-imported sections hide it. |
| 0 | Jump demo fixture | File/demo asset, not an app control | REACHABLE | Fixture exists at `scripts/demo/staged-live-client/Brennan, Thomas & Karen/Jump Meeting Recap 2026-06-24 - Brennan.txt`. No shell mount expected. |
| 0 | Keep-your-notetaker doc and vendor checklist | Docs, not app controls | REACHABLE | Docs exist at `docs/features/keep-your-notetaker.md` and `docs/plans/lantern-plus/vendor-applications-checklist.md`. No shell mount expected. |
| 1 | Calendar connector card: Microsoft, Google, ICS, Sync, Stop, Disconnect | Launch -> account button in lower-left spine -> Account window -> Connections -> Calendar | CONDITIONALLY-BLOCKED | The card is mounted from `src/features/account/AccountWindow.tsx:310` and `src/features/account/AccountWindow.tsx:324`. Local-only blocks OAuth connect, ICS add, and sync at `src/platform/connectors/calendar/CalendarConnect.tsx:94`, `src/platform/connectors/calendar/CalendarConnect.tsx:130`, and `src/platform/connectors/calendar/CalendarConnect.tsx:150`. Buttons render at `src/platform/connectors/calendar/CalendarConnect.tsx:260`, `src/platform/connectors/calendar/CalendarConnect.tsx:285`, `src/platform/connectors/calendar/CalendarConnect.tsx:330`, `src/platform/connectors/calendar/CalendarConnect.tsx:377`, `src/platform/connectors/calendar/CalendarConnect.tsx:389`, and `src/platform/connectors/calendar/CalendarConnect.tsx:400`. |
| 1 | Today’s meetings strip on Client Map home | Launch -> Client Map home | CONDITIONALLY-BLOCKED | Mounted at `src/features/matters/MattersHome.tsx:748`, but returns nothing when there are no events: `src/features/meetings/TodaysMeetingsStrip.tsx:146`. With an empty calendar, the strip is hidden. |
| 1 | Matched meeting card opens client hub | Launch -> Client Map home -> Today strip -> matched meeting card | CONDITIONALLY-BLOCKED | Requires at least one calendar event that resolves to a matter. Click opens the client at `src/features/meetings/TodaysMeetingsStrip.tsx:201`. Empty calendar blocks this. |
| 1 | Unmatched meeting assignment flow: `Whose meeting is this?`, client picker, identifier picker, skip | Launch -> Client Map home -> Today strip -> unmatched meeting card -> `Whose meeting is this?` | CONDITIONALLY-BLOCKED | Requires at least one unmatched calendar event. The assign button renders at `src/features/meetings/TodaysMeetingsStrip.tsx:257`; picker options render at `src/features/meetings/TodaysMeetingsStrip.tsx:285`; skip renders at `src/features/meetings/TodaysMeetingsStrip.tsx:321`; ambiguous identifier picker renders at `src/features/meetings/TodaysMeetingsStrip.tsx:336`. Empty calendar blocks all of it. |
| 1 | Automatic prep brief queue on app open | Launch -> Client Map home | CONDITIONALLY-BLOCKED | The hook is mounted at `src/features/meetings/TodaysMeetingsStrip.tsx:125`, but it only enqueues jobs from actual events matched to matters. Empty calendar means no jobs. |
| 1 | `Before you meet` strip in client hub | Launch -> Client Map -> open a client -> Client Map hub overview | CONDITIONALLY-BLOCKED | Mounted at `src/features/matters/MatterHub.tsx:342`, but returns nothing unless there is a ready brief for today: `src/features/meetings/BeforeYouMeetStrip.tsx:48`. Empty calendar means no brief, so no strip. |
| 1 | Brief collapse, stale chip, citations, `Export brief`, `Agenda`, `Refresh` | Launch -> Client Map -> open a client -> `Before you meet` strip | CONDITIONALLY-BLOCKED | Requires the `Before you meet` strip to exist first. Collapse renders at `src/features/meetings/BeforeYouMeetStrip.tsx:146`; stale chip at `src/features/meetings/BeforeYouMeetStrip.tsx:170`; export buttons at `src/features/meetings/BeforeYouMeetStrip.tsx:224` and `src/features/meetings/BeforeYouMeetStrip.tsx:237`; refresh at `src/features/meetings/BeforeYouMeetStrip.tsx:249`. |
| 1 | Stale brief refresh after document changes | Background behavior while app is open | REACHABLE | Despite a stale comment saying it is not mounted, the hook is mounted at `src/features/meetings/TodaysMeetingsStrip.tsx:126`. It listens for `workspace-file-changed`, marks ready briefs stale, and requeues after a debounce: `src/features/meetings/useBriefStaleness.ts:38`. It still requires an existing ready brief and a matching calendar event. |
| 1 | Scheduled rescan while app is running | Background behavior after launch | UNREACHABLE | The plan describes a recurring rescan hook, but `TodaysMeetingsStrip` only refreshes on mount and `CALENDAR_SYNC_EVENT`: `src/features/meetings/TodaysMeetingsStrip.tsx:107`. Search found no production `useAutoprepRescan`, `RESCAN_INTERVAL`, or equivalent mounted hook. |
| 2 | Normal Word-document `Send to Wealthbox` action | Launch -> Client Map -> open a client -> Documents -> open a mapped `.docx` -> top editor bar -> `Send to Wealthbox` | CONDITIONALLY-BLOCKED | The normal Word path is mounted, so the feature is no longer only behind shared notes. `MainPanel` passes `onSendToWealthbox` for mapped matter documents at `src/app/shell/layout/MainPanel.tsx:854`; `DocxEditor` renders the button at `src/features/documents/media/DocxEditor.tsx:1278`. With no Wealthbox connection, the button is disabled: `src/features/documents/media/DocxEditor.tsx:1292`. |
| 2 | Shared-notes `Send to Wealthbox` action | Shared/firm matter -> shared notes editor -> `Send to Wealthbox` | CONDITIONALLY-BLOCKED | This path is behind a shared-matter/firm gate. `openMatterNotes` exits unless the matter is shared and has a firm matter id: `src/features/matters/logic/openMatterNotes.ts:28`; sync has the same gate at `src/features/matters/logic/matterNotesSync.ts:51`; the button itself renders at `src/features/matters/MatterNotesEditor.tsx:296`. This is acceptable only because the normal Word path above exists. |
| 2 | CRM review card / collapsed `Update Wealthbox` card | Launch -> Client Map -> open a client -> Client Map hub overview | CONDITIONALLY-BLOCKED | The card is mounted outside Client Map readiness at `src/features/matters/MatterHub.tsx:449`, but returns nothing until a queue item exists: `src/features/matters/CrmWriteReviewCard.tsx:161`. With a queued item but no Wealthbox connection, it shows a connect prompt instead of approvals: `src/features/matters/CrmWriteReviewCard.tsx:163`. |
| 2 | CRM review checkboxes and row dismiss | Same as CRM review card, after queued item exists | CONDITIONALLY-BLOCKED | Requires queued item plus card visibility. Row checkbox renders at `src/features/matters/CrmWriteReviewCard.tsx:456`; Dismiss renders at `src/features/matters/CrmWriteReviewCard.tsx:564`. |
| 2 | CRM retry for failed / verify-pending / stale writes | Same as CRM review card, after a row enters failed, verify-pending, or stale state | CONDITIONALLY-BLOCKED | Retry renders only for attention states: `src/features/matters/CrmWriteReviewCard.tsx:535` and `src/features/matters/CrmWriteReviewCard.tsx:549`. Store statuses include `verify_pending`: `src/platform/state/crmWriteQueueStore.ts:18`. |
| 2 | Household picker when more than one Wealthbox household is linked | Same as CRM review card -> expanded review | CONDITIONALLY-BLOCKED | Requires Wealthbox connected and more than one household key. No linked household shows the link-first empty state at `src/features/matters/CrmWriteReviewCard.tsx:303`; picker renders at `src/features/matters/CrmWriteReviewCard.tsx:309`. With no CRM connected yet, this is blocked. |
| 2 | Approve CRM changes | Same as CRM review card -> expanded review -> `Approve` | CONDITIONALLY-BLOCKED | Requires selected rows, Wealthbox connection, and a linked household. The disabled logic is at `src/features/matters/CrmWriteReviewCard.tsx:174`; the button renders at `src/features/matters/CrmWriteReviewCard.tsx:382`. With no CRM connected yet, approval is blocked. |
| 2 | `Also file a compliance note` checkbox | Same as CRM review card -> expanded review | CONDITIONALLY-BLOCKED | Renders only after household keys exist: `src/features/matters/CrmWriteReviewCard.tsx:359`. With no CRM connection/household link, it is hidden. |
| 2 | Field-update 3-column review: Existing / From this meeting / Blended | Same as CRM review card, after a field-update queue item exists | UNREACHABLE | The row renderer exists at `src/features/matters/CrmWriteReviewCard.tsx:480`, and the store has `enqueueFieldUpdate` at `src/platform/state/crmWriteQueueStore.ts:243`. But production search found no caller outside the store declaration/method itself. That means normal app actions can show note/task rows, but not field-update rows. |

## Main Recommended Changes

### 1. Add and mount the scheduled calendar rescan

Recommended behavior: while the app is open, periodically rescan today’s calendar window and enqueue prep for newly matched meetings. Mount it from `TodaysMeetingsStrip`, because that component already owns today’s events and prep hooks.

Text-only patch shape:

```diff
diff --git a/src/features/meetings/TodaysMeetingsStrip.tsx b/src/features/meetings/TodaysMeetingsStrip.tsx
@@
 import { useMeetingAutoprep } from './useMeetingAutoprep';
 import { useBriefStaleness } from './useBriefStaleness';
+import { useAutoprepRescan } from './useAutoprepRescan';
@@
   useMeetingAutoprep(events, matters);
   useBriefStaleness();
+  useAutoprepRescan({ onEvents: setEvents });
```

Also add the missing hook if it does not already exist. It should reuse `calendarListEvents(todayWindowUtc())`, avoid duplicate prep work, and stop cleanly on unmount.

### 2. Wire CRM field-update proposals into a real app path

The field row UI exists, but no production action creates field rows. Pick the intended source and wire it into `enqueueFieldUpdate`.

Recommended source: the meeting-note extraction / client-map proposal flow, because that is where “From this meeting” field changes naturally come from.

Text-only patch shape:

```diff
// Somewhere in the real meeting-note/client-map proposal path:
useCrmWriteQueueStore.getState().enqueueFieldUpdate({
  matterId,
  title: 'Update background information',
  field: 'background_information',
  existingValue,
  newValue,
  sourceRef,
  provider,
});
```

Then add a shell-level or integration test that proves a realistic imported meeting note can produce a visible field-update row in `CrmWriteReviewCard`.

### 3. Bench setup notes

These are not code bugs, but they matter for the next smoke run:

- With **Local-only on**, calendar connect/sync is expected to block.
- With an **empty calendar**, Today’s meetings and Before-you-meet are expected to be invisible.
- With **only IMAP mail**, `Save to my Drafts` is expected to be disabled, while Send can still work after the draft body is generated.
- With **no Wealthbox connection**, CRM approval is expected to stop at the connect prompt or disabled Send-to-Wealthbox button.
- With **non-shared matters**, shared notes are expected to be unavailable; the normal Word-document CRM path is the path to test.

## Suggested Smoke Assertions

For the next automated or manual smoke, use assertions like these:

- Open a mapped `.docx` for a normal, non-shared client and confirm both `Draft follow-up` and `Send to Wealthbox` are present.
- Confirm `Save to my Drafts` is disabled with a clear IMAP explanation when only IMAP is connected.
- Turn off Local-only, add a test calendar event, and confirm Today’s strip appears.
- Match that event to a client and confirm Before-you-meet appears after prep completes.
- Queue a normal CRM note from a mapped Word document and confirm the CRM review card appears even if Client Map is empty.
- After wiring field updates, import a meeting note that proposes a Wealthbox field update and confirm the Existing / From this meeting / Blended row appears without using test-only store injection.
