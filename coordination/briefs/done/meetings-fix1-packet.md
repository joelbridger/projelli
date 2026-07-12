# Meetings lane — fix round 1 (adversarial Codex review findings; ONE combined round)

Fix all five in one pass, TDD for 1/2/5 (failing test first), then re-run your scoped checks:

1. MAJOR MeetingSendPanel.tsx:193 — autosave/Review race: a debounced save already in flight can land AFTER flushSave() and overwrite the newer recipient plan. Serialize plan saves or add a version token so a stale save can never write or fire onChanged.
2. MAJOR meetingArtifactDelivery.ts:155 — confirm-vs-send divergence: sender rebuilds subject/body/attachments from latest meeting.json after confirm; a title change between dialog-open and send means the user confirms one email and sends another. Send exactly the confirmed snapshot (or hard-fail if the rebuilt preview differs from the confirmed one).
3. MAJOR MeetingSendPanel.tsx:222 — lost capability: buildMeetingRecipientSuggestions() (taught client emails / matter.meetingKeys / saved-plan people) no longer feeds the person matrix; only calendar + existing people appear. Restore the suggestion source in the Add person flow.
4. MINOR scripts/ui-system/rehearsal.mjs:685 — still grips removed handle meeting-subtab-send-to-team; update to open meeting-entry-send and inspect meeting-send-drawer.
5. MINOR meetingArtifactDelivery.ts:144 — sender enforces localOnly but not reviewedAt; add a base.reviewedAt check inside the sender (defense in depth).

When done: commit, push lp/ux-meetings, append a "## Fix round 1" section to coordination/briefs/done/meetings.done.md, and write the marker file coordination/briefs/done/meetings.fix1.md (one line summary + new HEAD sha + pasted check output). Then stop again.
