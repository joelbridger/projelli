# Meetings UX Simplification Audit

## 1. Five-line screen summary

1. The Meetings screen is a left rail plus a meeting detail pane: rail header, mic button, meeting rows, empty/error states, and a selected meeting on the right.
2. The detail pane shows a long title/breadcrumb row, review/delete actions, consent/type metadata, four sub-tabs, and a recording-notice strip that stays above every tab.
3. Recording, Transcript, and Summary each add their own small action buttons, pending states, failure states, and export/copy controls.
4. Send to team is the heaviest area: it stacks recipient planning, groups, email account, send preview, missing-item warnings, send log, and a confirmation dialog.
5. The trust story is strong, but it is repeated as full helper text in many places; the screen can feel simpler if trust becomes compact, always-visible status plus details on demand.

## 2. Recommendations

1. **Move "Send to team" out of the sub-tabs and make it a single header action.**
   - **What/where:** `MeetingEntry.tsx` renders `Recording`, `Transcript`, `Summary`, and `Send to team` as equal tabs at lines 636-708, then renders send content at lines 863-890. The label comes from `src/locales/en.json` line 1740.
   - **Why it costs more than it gives:** Sending is not another way to inspect the meeting. It is an output workflow. Treating it like a peer of Recording/Transcript/Summary makes the review space feel busier and hides the real primary action behind a fourth tab.
   - **Concrete simplification:** Keep three content tabs: `Recording`, `Transcript`, `Summary`. Add a header button `Send` beside `Mark reviewed` after the meeting has a plan or reviewed state. Clicking opens the send workflow in a right drawer or inline panel. If the meeting is not reviewed, the button stays disabled with tooltip "Review first."
   - **Copy rewrite:** `Send to team` -> `Send`. Keep the longer phrase only as the drawer title if needed.
   - **Impact:** HIGH.

2. **Merge the two Send to team boxes into one flow.**
   - **What/where:** `MeetingRecipientsPanel.tsx` is one bordered card with title, helper text, and `Save plan` at lines 242-290. `MeetingArtifactSendPanel.tsx` is a second bordered card with another title, helper text, `Review send`, account selector, preview, send log, and dialog at lines 131-297.
   - **Why it costs more than it gives:** The user sees two boxes, two headers, and two main actions for one job. It asks them to think about "saving a plan" and "sending items" as separate mental chores.
   - **Concrete simplification:** Combine them into one unboxed `Send` surface with one primary action: `Review send`. Put recipient editing above the preview. Auto-save recipient changes when possible; if autosave is not available, show a small unsaved state and use `Save` as a secondary inline control, not the main button.
   - **Copy rewrite:** `Recipients` + `Send meeting items` -> one title: `Send`. `Choose who should receive each meeting item later. This only saves the plan.` -> `Pick who gets what. Nothing sends until review.`
   - **Impact:** HIGH.

3. **Use one person-first recipient picker everywhere.**
   - **What/where:** Calendar-based send uses a compact person row with artifact chips at `MeetingRecipientsPanel.tsx` lines 292-407. Manual send uses four separate artifact sections, four email fields, and four Add buttons at lines 409-551.
   - **Why it costs more than it gives:** The manual state is much heavier than the calendar state. It repeats the same email-entry task for Audio, Transcript, Summary, and Notes.
   - **Concrete simplification:** Use the calendar-style matrix for both states: one `Add person` field, then each person row has Notes, Summary, Transcript, Audio chips. For a brand-new manual recipient, default all available items on, then let the user turn items off.
   - **Copy rewrite:** Artifact help lines can go away from the default view. Replace the four helps with chip tooltips: `Audio: Original recording`, `Transcript: Word-for-word`, `Summary: Short recap`, `Notes: Advisor notes`.
   - **Impact:** HIGH.

4. **Fold recipient groups behind a saved-groups disclosure.**
   - **What/where:** `MeetingRecipientsPanel.tsx` always shows the Groups section, group explanation, existing group buttons, group-name input, and `Save current people as group` at lines 554-645. Copy is in `en.json` lines 1772-1777.
   - **Why it costs more than it gives:** Groups are useful, but they are not the main send task. Showing the whole group tool by default makes the Send area look like admin setup.
   - **Concrete simplification:** Replace the full section with a compact row: `Saved groups` plus a `+` menu or disclosure arrow. Expanded state shows existing groups and "Save current people as group."
   - **Copy rewrite:** `Groups are saved inside this client's folder, so client recipient lists stay with that client.` -> `Saved for this client.`
   - **Impact:** HIGH.

5. **Keep the notice status visible, but hide routine notice tools until asked.**
   - **What/where:** `NoticeTrail.tsx` always renders the heading, status, copy invite button, copy chat button, and local-note text at lines 103-181.
   - **Why it costs more than it gives:** A verified meeting still gets a whole notice block. The most important thing is the status chip. The copy buttons are useful before or during a meeting, but less important while reading the meeting afterward.
   - **Concrete simplification:** For verified/resolved meetings, show one slim row: shield icon + status chip + `Details` / `...` menu. Put snippet, copy invite, copy chat, and local-note inside details. For unverified or strict review, keep the warning block expanded.
   - **Copy rewrite:** `Recording notice` -> `Notice`. `The recording-notice check runs entirely on this computer.` -> `Checked on this computer.`
   - **Impact:** HIGH.

6. **Shorten the unverified notice warning into one sentence plus actions.**
   - **What/where:** `NoticeTrail.tsx` standard warning uses title, body, and three action buttons at lines 126-132. Strict warning adds a badge, title, body, and the same buttons at lines 136-145. Strings are in `en.json` lines 1863-1874.
   - **Why it costs more than it gives:** The warning has to stay visible, but the current wording is long and repeats the idea that the transcript missed the notice.
   - **Concrete simplification:** Keep the warning color and actions. Collapse title/body into one sentence, then show the three resolution choices.
   - **Copy rewrite:** `No spoken recording notice was detected in this meeting's first 5 minutes.` + `If you told everyone another way, or the transcription just missed it, let us know how you'd like to record that.` -> `No spoken notice was found in the first 5 minutes. Choose what happened.`
   - **Copy rewrite:** `Held for review: recording notice not detected` -> `Held for review`. `Your firm's Strict policy keeps this meeting in review until the notice is resolved. Your notes and transcript are safe and still open below.` -> `Strict policy keeps this meeting in review until you resolve the notice.`
   - **Impact:** HIGH.

7. **Move destructive and secondary meeting actions into a `...` menu.**
   - **What/where:** The header exposes `Mark reviewed` and `Delete audio` at `MeetingEntry.tsx` lines 571-596. Rename is a small pencil in the breadcrumb at lines 553-563. Download audio is inside the Recording tab at lines 739-747.
   - **Why it costs more than it gives:** Delete audio is a rare destructive action and should not compete with review. Rename, delete, download, and exports are utilities, not primary reading tasks.
   - **Concrete simplification:** Keep `Mark reviewed` as the only visible header button until the meeting is reviewed. Add a standard `...` menu with `Rename`, `Download audio`, `Delete audio`, `Copy transcript`, `Export transcript`, `Export summary as Word`, and `Export summary as PDF` as applicable.
   - **Copy rewrite:** `Delete audio · keep transcript` -> `Delete audio`. The confirm dialog already explains what stays.
   - **Impact:** HIGH.

8. **Make the meeting header a clean title with compact status chips below it.**
   - **What/where:** `MeetingEntry.tsx` shows `clientName / Meetings / title · date` in one breadcrumb-like line at lines 532-568, then a separate consent/type line at lines 600-634.
   - **Why it costs more than it gives:** The user is already inside a client. Repeating the client and `Meetings` adds clutter. Consent, type, notice, and reviewed status are scattered across the header, below-header line, rail badges, and notice strip.
   - **Concrete simplification:** First line: meeting title only. Second line: date + duration + compact chips: `Consent`, meeting type, `Reviewed` or `Needs review`, `Notice verified` or `In review`. Keep detailed notice below only when it needs action.
   - **Copy rewrite:** `Consent attested · two-party` -> `Consent: two-party`. `change` -> pencil icon with tooltip `Change type`.
   - **Impact:** HIGH.

9. **Simplify the recording consent dialog into a short checklist.**
   - **What/where:** `ConsentDialog.tsx` shows local recording body, low-disk warning, spoken script box, Notice Card section, two-party guidance, standing consent, checkbox, legal disclaimer, errors, and footer at lines 128-210. Strings are in `en.json` lines 1836-1848 and 1857-1859.
   - **Why it costs more than it gives:** The dialog is doing the right trust work, but as stacked paragraphs. Before a meeting, the user needs a quick, clear checklist.
   - **Concrete simplification:** Use three compact rows: `1. Ask consent`, `2. Say notice`, `3. Start recording`. Keep the checkbox and the script visible. Put legal disclaimer behind `Recording rules` details, unless strict/unknown state requires it.
   - **Copy rewrite:** `Recording stays on this computer. Nothing is uploaded.` -> `Saved on this computer.`
   - **Copy rewrite:** `Say this out loud after you start:` -> `Say after starting:`
   - **Copy rewrite:** `Saying it puts the notice in the recording itself. The app checks the transcript afterward and files it as evidence.` -> `Lantern checks the transcript for this later.`
   - **Copy rewrite:** `This is general guidance, not legal advice. Confirm your state's recording-consent rules with your own counsel.` -> `General guidance, not legal advice.`
   - **Impact:** HIGH.

10. **Make the floating recording pill smaller and calmer.**
    - **What/where:** `RecordPill.tsx` shows red dot, `Recording`, timer, `Local`, Notice Card status, `Copy chat notice`, and `Stop` at lines 154-264.
    - **Why it costs more than it gives:** During recording, the pill is always on screen. The timer and Stop matter most. Local and Notice Card status matter too, but can be compact. Copy chat is helpful but not needed every second.
    - **Concrete simplification:** Show: red dot + `0:43` + `Local` chip + `Stop`. Move `Copy chat notice` to an icon-only copy button with tooltip, or into a small `...` menu. Keep Notice Card status only when not normal: joining, waiting, failed. When present, show a tiny success chip with tooltip.
    - **Copy rewrite:** `Copy chat notice` -> icon-only copy button tooltip `Copy chat notice`.
    - **Impact:** HIGH.

11. **Do not show full send preview twice.**
    - **What/where:** `MeetingArtifactSendPanel.tsx` shows preview rows at lines 215-229, then repeats To, Subject, Body, and Attachment in the confirmation dialog at lines 271-284.
    - **Why it costs more than it gives:** The user reviews twice. The first preview makes the send panel tall, then the dialog repeats the same facts in larger cards.
    - **Concrete simplification:** In the panel, show only `3 items ready` and a compact recipient count. Put the full To/Subject/Body/Attachment details only in the review dialog.
    - **Copy rewrite:** `{{count}} items ready to review` can stay. Remove inline `To:` and `Attachment:` rows from the default panel view; show them on dialog only.
    - **Impact:** HIGH.

12. **Shorten the send privacy note but keep it visible.**
    - **What/where:** `MeetingArtifactSendPanel.tsx` renders the privacy note at lines 145-153. String is `en.json` line 1799. Confirm privacy is in line 1817.
    - **Why it costs more than it gives:** The idea is critical, but the sentence is long and uses two separate clauses. It slows the action area down.
    - **Concrete simplification:** Keep a small shield/lock line near `Review send`; use shorter copy.
    - **Copy rewrite:** `Review first. On send, the selected files leave this computer through your connected email account. Lantern does not receive them.` -> `Review first. Sends by your email. Lantern never receives files.`
    - **Copy rewrite:** `These files will be sent through {{account}}. This is the only step where the files leave this computer.` -> `Sends through {{account}}. This is when files leave this computer.`
    - **Impact:** HIGH.

13. **Fold tab action buttons into one small action area.**
    - **What/where:** Recording has `Download audio` at `MeetingEntry.tsx` lines 739-747. Transcript has `Copy` and `Export` at lines 768-789. Summary has `Copy`, `Export Word`, and `Export PDF` at lines 822-834.
    - **Why it costs more than it gives:** Each tab starts with a row of outlined buttons. The content is the main value; utility actions can be quieter.
    - **Concrete simplification:** Use a right-aligned `...` menu in each tab, or use icon-only Copy/Download buttons with tooltips. Keep disabled states, but do not show disabled utility buttons as the first thing in an empty/pending tab.
    - **Copy rewrite:** `Export Word` -> `Word`. `Export PDF` -> `PDF`. Tooltips can say `Export as Word` and `Export as PDF`.
    - **Impact:** MED.

14. **Make speaker naming a collapsed tool, not always-visible transcript furniture.**
    - **What/where:** `MeetingEntry.tsx` mounts `SpeakerNamesPanel` right under every transcript at lines 790-795. `SpeakerNamesPanel.tsx` shows title, button, rows, biometric consent, apply button, done/error callouts, and privacy note at lines 112-173.
    - **Why it costs more than it gives:** Naming speakers is useful but secondary. Most transcript reads do not need it. The panel also brings biometric consent text, which is important but heavy.
    - **Concrete simplification:** Default to a compact row at the top or bottom of Transcript: `Name speakers` button. Expand only after click. Once expanded, keep the biometric consent checkbox visible only if a new voice profile will be saved.
    - **Copy rewrite:** `Who is speaking?` -> `Speakers`. `Separate speakers` -> `Name speakers`.
    - **Impact:** MED.

15. **Trim the voice profile privacy note after consent is already shown.**
    - **What/where:** `SpeakerNamesPanel.tsx` always shows `privacy-note` at line 172, while the biometric consent section can show stronger consent text at lines 143-158. Strings are in `en.json` lines 1683-1685.
    - **Why it costs more than it gives:** When no new voice profile is being created, the privacy note feels like extra fine print. When one is being created, the consent checkbox and biometric note already cover the risk.
    - **Concrete simplification:** Show the privacy note as tooltip/details next to `Speakers`. Keep the full consent checkbox and biometric note visible only when `willEnroll` is true.
    - **Copy rewrite:** `Voice profiles are stored only on this computer, encrypted, and only for this client. You can delete them from the client's page at any time.` -> `Voice profiles stay encrypted on this computer.`
    - **Impact:** MED.

16. **Simplify rail rows by removing the repeated mic tile.**
    - **What/where:** Each meeting row renders a 28px mic icon tile at `ClientMeetingsTab.tsx` lines 483-500, then title, subtitle, and badges at lines 501-520.
    - **Why it costs more than it gives:** Every row in this rail is already a meeting. The mic icon repeats the screen context and takes a large chunk of the 268px rail.
    - **Concrete simplification:** Remove the icon tile. Use title first, meta second, status chip right-aligned or under meta only when needed. Keep warning/review chips because they change behavior.
    - **Copy rewrite:** Keep `Needs review`, `Reviewed`, and `In review`, but do not show any status when the meeting is normal.
    - **Impact:** MED.

17. **Only show "Reviewed" in the rail when it helps distinguish state.**
    - **What/where:** Rail rows show `Reviewed` when `m.meta?.reviewedAt` and no review items at `ClientMeetingsTab.tsx` lines 516-518. String is `en.json` line 1709.
    - **Why it costs more than it gives:** A completed normal state does not always need a badge in a dense list. Too many badges make warning badges less special.
    - **Concrete simplification:** Show `Needs review` / `In review` in the rail. Move `Reviewed` into the selected meeting header chip only.
    - **Copy rewrite:** No copy change needed.
    - **Impact:** MED.

18. **Shorten the no-meetings empty state.**
    - **What/where:** Empty state body comes from `ClientMeetingsTab.tsx` lines 621-629 and `en.json` lines 1700-1701. A separate activity hint shows at lines 631-635 and `en.json` line 1705.
    - **Why it costs more than it gives:** The empty state explains where recordings live and the Activity behavior, but the mic button already shows the action. The Activity hint is not needed before a meeting exists.
    - **Concrete simplification:** Keep the empty title and one short body. Remove the Activity hint from the empty/blank area; Activity can reflect meetings later.
    - **Copy rewrite:** `Recordings you make with this client stay right here: notes, transcript, and audio together.` -> `Recordings, notes, and transcripts stay with this client.`
    - **Copy rewrite:** Remove default display of `Each meeting also shows up as an entry on this client's Activity timeline.`
    - **Impact:** MED.

19. **Make scan error calmer and shorter.**
    - **What/where:** Scan error callout is in `ClientMeetingsTab.tsx` lines 549-565. Copy is in `en.json` lines 1711-1713.
    - **Why it costs more than it gives:** The callout is correct, but the body uses a vague "interrupted the check just now" phrase. A shorter message is clearer.
    - **Concrete simplification:** Keep the error state and Try again button. Shorten body.
    - **Copy rewrite:** `Couldn't load meetings` -> `Meetings did not load`. `Something interrupted the check just now. Your recordings are safe on this computer.` -> `Your recordings are still on this computer.`
    - **Impact:** MED.

20. **Make the Notice Card offer less like a second consent form.**
    - **What/where:** `NoticeCardConsentSection.tsx` shows a bordered box, checkbox, platform tag, explanation, optional Zoom checkbox, or manual link at lines 67-147. Strings are in `en.json` lines 1894-1903.
    - **Why it costs more than it gives:** The Notice Card matters, but the current box competes with the main consent checkbox. It can read like another required permission.
    - **Concrete simplification:** Present it as one optional row under the spoken script: checkbox + `Show Notice Card in Teams` / `Show Notice Card in Zoom`, with a details caret for explanation. Keep Zoom's native-record attestation visible only if Zoom is selected.
    - **Copy rewrite:** `Add the Notice Card to this meeting?` -> `Show Notice Card`. `A participant on your computer shows everyone the meeting is being recorded. It records nothing and leaves when recording ends.` -> `Shows everyone recording is on. Records nothing.`
    - **Copy rewrite:** `Recording an online meeting? Paste the link to add the Notice Card.` -> `Paste a Teams or Zoom link for Notice Card.`
    - **Impact:** MED.

21. **Reduce duplicate "local/private" messages into one visible status per moment.**
    - **What/where:** Local copy appears in consent dialog body (`ConsentDialog.tsx` lines 134-136), notice trail local note (`NoticeTrail.tsx` lines 177-180), recording pill local chip (`RecordPill.tsx` lines 181-195), and send privacy note (`MeetingArtifactSendPanel.tsx` lines 151-153).
    - **Why it costs more than it gives:** Each message is individually good, but together they make the screen feel wordy. Repetition also teaches the user to ignore trust copy.
    - **Concrete simplification:** Keep local/private visible at the action point only: start recording, while recording, and before sending. Hide the NoticeTrail local note under details for verified/resolved meetings.
    - **Copy rewrite:** Use one short vocabulary across the screen: `Saved on this computer`, `Checked on this computer`, `Sends by your email`.
    - **Impact:** MED.

22. **Use icon-only for obvious utility buttons, with tooltips.**
    - **What/where:** Many small buttons use icon + text: title rename at `MeetingEntry.tsx` lines 555-563 already uses icon-only; delete/download/copy/export/add/save group use text at lines 571-596, 739-789, 822-834, and `MeetingRecipientsPanel.tsx` lines 385-405, 490-510, 621-643.
    - **Why it costs more than it gives:** The app has standardized on rails, `...` menus, and `+` menus. Some utility labels are obvious from icon and context.
    - **Concrete simplification:** Keep text for primary actions (`Mark reviewed`, `Review send`, `Start recording`, `Stop`). Use icon-only with tooltip for rename, copy, download, remove recipient, clear/dismiss, and add where the field context is obvious.
    - **Copy rewrite:** `Add person` can become a `+` button next to the email field with tooltip `Add person`. `Remove {{email}}` stays as aria-label only.
    - **Impact:** MED.

23. **Make pending/failure states consistent and shorter.**
    - **What/where:** Recording/Transcript/Summary render separate pending, no-audio, no-one-spoke, failed, retry, and not-ready messages at `MeetingEntry.tsx` lines 749-858. Strings are in `en.json` lines 1722-1733 and 1742-1751.
    - **Why it costs more than it gives:** These states are necessary, but some messages are long for inline status text.
    - **Concrete simplification:** Use the same compact status pattern in all three tabs: one sentence, then a small retry button only when actionable.
    - **Copy rewrite:** `Notes are being written from the transcript. Check back in a moment.` -> `Writing notes...`
    - **Copy rewrite:** `Transcription is queued. It'll appear here once it's ready.` -> `Transcribing...`
    - **Copy rewrite:** `Summary is not ready yet. Export turns on after real notes text is available.` -> `Summary is not ready yet.`
    - **Impact:** LOW.

24. **Shorten send log rows and tuck old log entries under history.**
    - **What/where:** `MeetingArtifactSendPanel.tsx` shows `Send log` and the last four rows at lines 238-254. Copy is in `en.json` lines 1813-1815.
    - **Why it costs more than it gives:** A send log is useful proof, but it is secondary after the send has happened. Four rows can make the send area look like an audit page.
    - **Concrete simplification:** Show only the latest send status by default: `Sent 3 items today at 2:14 PM`. Add `View send log` disclosure for older entries.
    - **Copy rewrite:** `Send log` -> `History`. `{{status}} {{artifact}} to {{count}} recipients at {{date}}` -> `{{artifact}}: {{status}} to {{count}} at {{date}}`
    - **Impact:** LOW.

25. **Make the global auto-join panel expandable.**
    - **What/where:** `AutoJoinMeetingsPanel.tsx` renders a raised card with heading, explanatory body, count badge, meeting rows, platform badge, and `Don't join` buttons at lines 93-162. It is fixed above the recording pill in `App.tsx` lines 2046-2056.
    - **Why it costs more than it gives:** Auto-join is important when active, but a raised floating card with full rows can compete with the meeting detail and recording pill.
    - **Concrete simplification:** Default to one slim floating strip: `Will auto-join 2 meetings` + expand chevron. Expanded state shows rows and `Don't join`. Keep error visible when calendar check fails.
    - **Copy rewrite:** `These meetings will start the same recording flow and Notice Card as the Record button.` -> `They will use the same recording and Notice Card flow.`
    - **Impact:** LOW.

## 3. Do not touch

- **Do not remove review-gated sending.** `MeetingArtifactSendPanel.tsx` line 92 correctly blocks send until there is an email account, selected items, a reviewed meeting, and Local-only mode is off.
- **Do not hide strict notice quarantine.** The `In review` rail badge (`ClientMeetingsTab.tsx` lines 510-512) and strict callout (`NoticeTrail.tsx` lines 136-145) are load-bearing trust and compliance UI.
- **Do not remove the consent checkbox before recording.** `ConsentDialog.tsx` lines 181-189 keeps the user deliberately confirming recording consent.
- **Do not remove the spoken-notice script.** `ConsentDialog.tsx` lines 145-166 makes the notice evidence possible; simplify the wrapper, not the existence of the script.
- **Do not remove the local/privacy indicators.** The recording pill `Local` chip (`RecordPill.tsx` lines 181-195), send privacy note (`MeetingArtifactSendPanel.tsx` lines 151-153), and Notice Card explanations should stay visible at the moment they matter.
- **Do not remove biometric consent.** `SpeakerNamesPanel.tsx` lines 143-158 must stay visible when a new voice profile will be created.
- **Do not remove destructive confirmation for deleting audio.** `MeetingEntry.tsx` lines 897-923 is the right pattern for a permanent action.
- **Do not change user-facing client wording back to matter wording.** Keep the client facade; the internal `matterId` names in code are not a UX label.
- **Do not switch to dark styling.** This screen should stay light, calm, and sparse.
