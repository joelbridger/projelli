codex
Read-only investigation only. I changed nothing.

**Bottom line:** build these in this order:

1. **Choose recipients per meeting artifact**
2. **Send selected artifacts by email after review**
3. **Auto-detect calendar meetings and auto-record only when safely matched**

That keeps the first two features useful right away, and avoids making auto-recording depend on unfinished sending logic.

**What Already Exists**
The app already has most of the needed pieces:

- Meetings live inside a client workspace: `src/features/meetings/ClientMeetingsTab.tsx`
- Meeting metadata is saved in `meeting.json`: `src/features/meetings/meetingStore.ts`
- Notes, transcript, and audio already exist after recording: `MeetingEntry.tsx`
- The app already blocks outbound meeting notes until reviewed: `outboundNoteGate.ts`
- Email sending already supports attachments through Outlook, Gmail, and IMAP: `mail-commands.ts`
- Calendar sync already supports Outlook/M365 and Google with join links: `calendar-commands.ts`
- Notice Card already supports Teams and Zoom join links: `noticeCardTypes.ts`, `meetingPlatform.ts`
- Calendly has event and join-link data in Rust, but it is not yet wired like the main calendar list.

One important gap: `startRecording` has a `calendarTitle` option, but `ClientMeetingsTab` does not currently pass the selected calendar event into it. That should be fixed first.

**Feature 1: Pick Who Gets Each Artifact**
Options:

1. **Per-meeting recipient picker**
   - Best fit.
   - Add recipients to each meeting’s `meeting.json`.
   - Lets the advisor say: “Client gets summary, assistant gets transcript, nobody gets audio.”
   - Low privacy risk because nothing leaves the machine yet.

2. **Meeting-type defaults**
   - Example: “Discovery meeting always sends summary to client and notes to CRM.”
   - Good later.
   - Risk: too much automation before the advisor trusts it.

3. **Global defaults**
   - Fastest, but weakest.
   - Risky because different clients and meetings need different sharing rules.

Recommended approach: **per-meeting recipient plan first, with optional defaults later.**

Implementation shape:

- Extend `MeetingMeta` in `src/features/meetings/meetingStore.ts` with a local-only delivery plan.
- Add a small recipient panel to `MeetingEntry.tsx`, because that screen already knows the notes, transcript, summary, audio, review state, and notice state.
- Pull suggested recipients from the calendar event attendees and organizer.
- Allow manual emails too.
- Do not send anything in this feature.

Suggested shape:

```ts
deliveryPlan: {
  artifacts: {
    notes?: RecipientRule[];
    summary?: RecipientRule[];
    transcript?: RecipientRule[];
    audio?: RecipientRule[];
  };
  autoSendAfterReview?: boolean;
  updatedAt: string;
}
```

Effort: **M**

Main risks:

- Wrong recipients are worse than no recipients. The UI should make recipients obvious.
- Audio is sensitive. It should be off by default.
- Calendar attendees may include internal people, assistants, or wrong guests.

First shippable slice:

- Add “Recipients” to each completed meeting.
- Suggested people come from the calendar invite.
- Advisor can choose recipients for summary, notes, transcript, and audio.
- Save only to `meeting.json`.

**Feature 2: Send Artifacts After the Meeting**
Options:

1. **Send by email using connected Outlook/Gmail**
   - Best fit.
   - Reuses existing email connector and attachment support.
   - Clear privacy story: files leave the machine only through the advisor’s own email account.

2. **Create share links**
   - Bad first choice.
   - Would need cloud storage or a sharing server.
   - Conflicts with local-first unless carefully designed.

3. **Push to CRM**
   - Good for advisor notes.
   - Not enough for client delivery.
   - Wealthbox write queue already exists, but this should stay separate from sending files to people.

Recommended approach: **email first, with explicit review gates.**

Implementation shape:

- Create a small meeting delivery service, likely under `src/features/meetings/`.
- Reuse `mailSend` from `src/platform/utils/mail-commands.ts`; it already supports attachments.
- Reuse existing artifacts:
  - `notes.docx`
  - generated summary docx/pdf
  - generated `transcript.txt`
  - `audio.wav`
- Reuse the existing review gate from `outboundNoteGate.ts`.
- Add a delivery status block to `meeting.json`, so the advisor can see what was sent, when, and whether it failed.
- Log a privacy/audit event with metadata only: artifact type, provider, recipient count, meeting id. Do not log body text or email addresses.

Privacy rule:

- The app should say plainly: “This sends these files through your connected email account.”
- Keepance should not receive the files.
- Local-only mode should block sending.
- Audio should require a stronger confirmation than notes or summary.

Effort: **M for reviewed manual send, L for true unattended auto-send**

Main risks:

- “Save draft with attachments” is not currently supported. Direct send supports attachments, but draft save does not.
- Automatic sending can surprise people. Start with “ready to send” after review.
- Large audio files may hit email size limits.

First shippable slice:

- After the advisor reviews the meeting, show “Send selected artifacts.”
- Send by connected email with attachments.
- Save sent/failed status per artifact.
- Then add “auto-send after review” once this is trusted.

**Feature 3: Auto-Join And Auto-Record Without Pasting Invite**
Options:

1. **Use Outlook/M365 and Google calendar**
   - Best first choice.
   - Already wired to list events and extract join links.
   - Works with Teams, Zoom, and Google Meet links, though Notice Card currently supports Teams/Zoom best.

2. **Use Calendly**
   - Useful later.
   - Backend has scheduled event join links, but the frontend does not yet expose Calendly events like the main calendar list.
   - Better as a second source.

3. **Scan email for meeting links**
   - Too broad and risky.
   - Harder to match to the right client.
   - Worse privacy story.

Recommended approach: **calendar-first auto-recording, Outlook/M365 and Google first.**

Implementation shape:

- Build on `calendarListEvents` from `src/platform/utils/calendar-commands.ts`.
- Use the existing encrypted local calendar store.
- Only consider events that:
  - are not cancelled,
  - are not declined,
  - have a join link,
  - are matched to exactly one client,
  - are Teams or Zoom for the first version,
  - have advisor opt-in enabled.
- Use `detectPlatform` from `noticeCard/meetingPlatform.ts`.
- Reuse `startRecording` in `meetingStore.ts`.
- Pass the calendar event into meeting metadata so the meeting knows title, attendees, organizer, provider, event id, and join URL.
- Add a small scheduler that runs while the app is open:
  - look ahead about 10 minutes,
  - arm the meeting around 5 minutes before,
  - join around 1 minute before,
  - start recording only if consent/notice rules are satisfied.

Consent and notice:

- Auto-record should fail closed.
- If Notice Card cannot join or be admitted, do not silently record.
- Manual recording can still work because the advisor can announce recording out loud.
- Auto-record needs a clear per-meeting or per-client opt-in. Not a hidden global switch.

Edge cases:

- **Back-to-back meetings:** only one recording at a time. Skip or warn on overlap.
- **No join link:** do not record.
- **Unsupported platform:** do not auto-record.
- **Google Meet:** detect it, but do not auto-record until Notice Card support is ready.
- **Client match is unclear:** skip and ask the advisor to choose.
- **App closed or computer asleep:** nothing happens; show “missed because app was closed.”
- **Host never admits Notice Card:** wait a short time, then skip.
- **Private/internal meeting:** never auto-record unless it is matched to a client workspace.

Effort: **L**

First shippable slice:

- Add “Auto-record this meeting” to matched Teams/Zoom calendar events.
- No paste required.
- App starts the Notice Card and recording when the app is open.
- If anything is unclear, it does not record.

**Cross-Feature Dependencies**
Build order should be:

1. **Calendar snapshot into meeting metadata**
   - Fix the current gap where the selected calendar event is not saved into the recording start flow.

2. **Feature 1 recipient plan**
   - Needed before sending.
   - Purely local and lower risk.

3. **Feature 2 reviewed email sending**
   - Start with advisor-reviewed send.
   - Add true auto-send after the send log, retry behavior, and privacy copy are solid.

4. **Feature 3 auto-record scheduler**
   - Highest risk.
   - Depends on clean calendar matching, Notice Card reliability, and saved meeting metadata.

**Recommendation**
Do not start with full unattended automation. Start with a safe chain:

Calendar event → meeting metadata → recipient plan → reviewed send → optional auto-send → optional auto-record.

That gives advisors useful power quickly, while keeping privacy and consent clear.
tokens used
255,405
Read-only investigation only. I changed nothing.

**Bottom line:** build these in this order:

1. **Choose recipients per meeting artifact**
2. **Send selected artifacts by email after review**
3. **Auto-detect calendar meetings and auto-record only when safely matched**

That keeps the first two features useful right away, and avoids making auto-recording depend on unfinished sending logic.

**What Already Exists**
The app already has most of the needed pieces:

- Meetings live inside a client workspace: `src/features/meetings/ClientMeetingsTab.tsx`
- Meeting metadata is saved in `meeting.json`: `src/features/meetings/meetingStore.ts`
- Notes, transcript, and audio already exist after recording: `MeetingEntry.tsx`
- The app already blocks outbound meeting notes until reviewed: `outboundNoteGate.ts`
- Email sending already supports attachments through Outlook, Gmail, and IMAP: `mail-commands.ts`
- Calendar sync already supports Outlook/M365 and Google with join links: `calendar-commands.ts`
- Notice Card already supports Teams and Zoom join links: `noticeCardTypes.ts`, `meetingPlatform.ts`
- Calendly has event and join-link data in Rust, but it is not yet wired like the main calendar list.

One important gap: `startRecording` has a `calendarTitle` option, but `ClientMeetingsTab` does not currently pass the selected calendar event into it. That should be fixed first.

**Feature 1: Pick Who Gets Each Artifact**
Options:

1. **Per-meeting recipient picker**
   - Best fit.
   - Add recipients to each meeting’s `meeting.json`.
   - Lets the advisor say: “Client gets summary, assistant gets transcript, nobody gets audio.”
   - Low privacy risk because nothing leaves the machine yet.

2. **Meeting-type defaults**
   - Example: “Discovery meeting always sends summary to client and notes to CRM.”
   - Good later.
   - Risk: too much automation before the advisor trusts it.

3. **Global defaults**
   - Fastest, but weakest.
   - Risky because different clients and meetings need different sharing rules.

Recommended approach: **per-meeting recipient plan first, with optional defaults later.**

Implementation shape:

- Extend `MeetingMeta` in `src/features/meetings/meetingStore.ts` with a local-only delivery plan.
- Add a small recipient panel to `MeetingEntry.tsx`, because that screen already knows the notes, transcript, summary, audio, review state, and notice state.
- Pull suggested recipients from the calendar event attendees and organizer.
- Allow manual emails too.
- Do not send anything in this feature.

Suggested shape:

```ts
deliveryPlan: {
  artifacts: {
    notes?: RecipientRule[];
    summary?: RecipientRule[];
    transcript?: RecipientRule[];
    audio?: RecipientRule[];
  };
  autoSendAfterReview?: boolean;
  updatedAt: string;
}
```

Effort: **M**

Main risks:

- Wrong recipients are worse than no recipients. The UI should make recipients obvious.
- Audio is sensitive. It should be off by default.
- Calendar attendees may include internal people, assistants, or wrong guests.

First shippable slice:

- Add “Recipients” to each completed meeting.
- Suggested people come from the calendar invite.
- Advisor can choose recipients for summary, notes, transcript, and audio.
- Save only to `meeting.json`.

**Feature 2: Send Artifacts After the Meeting**
Options:

1. **Send by email using connected Outlook/Gmail**
   - Best fit.
   - Reuses existing email connector and attachment support.
   - Clear privacy story: files leave the machine only through the advisor’s own email account.

2. **Create share links**
   - Bad first choice.
   - Would need cloud storage or a sharing server.
   - Conflicts with local-first unless carefully designed.

3. **Push to CRM**
   - Good for advisor notes.
   - Not enough for client delivery.
   - Wealthbox write queue already exists, but this should stay separate from sending files to people.

Recommended approach: **email first, with explicit review gates.**

Implementation shape:

- Create a small meeting delivery service, likely under `src/features/meetings/`.
- Reuse `mailSend` from `src/platform/utils/mail-commands.ts`; it already supports attachments.
- Reuse existing artifacts:
  - `notes.docx`
  - generated summary docx/pdf
  - generated `transcript.txt`
  - `audio.wav`
- Reuse the existing review gate from `outboundNoteGate.ts`.
- Add a delivery status block to `meeting.json`, so the advisor can see what was sent, when, and whether it failed.
- Log a privacy/audit event with metadata only: artifact type, provider, recipient count, meeting id. Do not log body text or email addresses.

Privacy rule:

- The app should say plainly: “This sends these files through your connected email account.”
- Keepance should not receive the files.
- Local-only mode should block sending.
- Audio should require a stronger confirmation than notes or summary.

Effort: **M for reviewed manual send, L for true unattended auto-send**

Main risks:

- “Save draft with attachments” is not currently supported. Direct send supports attachments, but draft save does not.
- Automatic sending can surprise people. Start with “ready to send” after review.
- Large audio files may hit email size limits.

First shippable slice:

- After the advisor reviews the meeting, show “Send selected artifacts.”
- Send by connected email with attachments.
- Save sent/failed status per artifact.
- Then add “auto-send after review” once this is trusted.

**Feature 3: Auto-Join And Auto-Record Without Pasting Invite**
Options:

1. **Use Outlook/M365 and Google calendar**
   - Best first choice.
   - Already wired to list events and extract join links.
   - Works with Teams, Zoom, and Google Meet links, though Notice Card currently supports Teams/Zoom best.

2. **Use Calendly**
   - Useful later.
   - Backend has scheduled event join links, but the frontend does not yet expose Calendly events like the main calendar list.
   - Better as a second source.

3. **Scan email for meeting links**
   - Too broad and risky.
   - Harder to match to the right client.
   - Worse privacy story.

Recommended approach: **calendar-first auto-recording, Outlook/M365 and Google first.**

Implementation shape:

- Build on `calendarListEvents` from `src/platform/utils/calendar-commands.ts`.
- Use the existing encrypted local calendar store.
- Only consider events that:
  - are not cancelled,
  - are not declined,
  - have a join link,
  - are matched to exactly one client,
  - are Teams or Zoom for the first version,
  - have advisor opt-in enabled.
- Use `detectPlatform` from `noticeCard/meetingPlatform.ts`.
- Reuse `startRecording` in `meetingStore.ts`.
- Pass the calendar event into meeting metadata so the meeting knows title, attendees, organizer, provider, event id, and join URL.
- Add a small scheduler that runs while the app is open:
  - look ahead about 10 minutes,
  - arm the meeting around 5 minutes before,
  - join around 1 minute before,
  - start recording only if consent/notice rules are satisfied.

Consent and notice:

- Auto-record should fail closed.
- If Notice Card cannot join or be admitted, do not silently record.
- Manual recording can still work because the advisor can announce recording out loud.
- Auto-record needs a clear per-meeting or per-client opt-in. Not a hidden global switch.

Edge cases:

- **Back-to-back meetings:** only one recording at a time. Skip or warn on overlap.
- **No join link:** do not record.
- **Unsupported platform:** do not auto-record.
- **Google Meet:** detect it, but do not auto-record until Notice Card support is ready.
- **Client match is unclear:** skip and ask the advisor to choose.
- **App closed or computer asleep:** nothing happens; show “missed because app was closed.”
- **Host never admits Notice Card:** wait a short time, then skip.
- **Private/internal meeting:** never auto-record unless it is matched to a client workspace.

Effort: **L**

First shippable slice:

- Add “Auto-record this meeting” to matched Teams/Zoom calendar events.
- No paste required.
- App starts the Notice Card and recording when the app is open.
- If anything is unclear, it does not record.

**Cross-Feature Dependencies**
Build order should be:

1. **Calendar snapshot into meeting metadata**
   - Fix the current gap where the selected calendar event is not saved into the recording start flow.

2. **Feature 1 recipient plan**
   - Needed before sending.
   - Purely local and lower risk.

3. **Feature 2 reviewed email sending**
   - Start with advisor-reviewed send.
   - Add true auto-send after the send log, retry behavior, and privacy copy are solid.

4. **Feature 3 auto-record scheduler**
   - Highest risk.
   - Depends on clean calendar matching, Notice Card reliability, and saved meeting metadata.

**Recommendation**
Do not start with full unattended automation. Start with a safe chain:

Calendar event → meeting metadata → recipient plan → reviewed send → optional auto-send → optional auto-record.

That gives advisors useful power quickly, while keeping privacy and consent clear.
