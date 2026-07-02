I stayed read-only. I did **not** write `research/codex-design-brainstorm.md` because your first rule said not to create or edit files. Here is the proposal content.

**Core Proposal**
Keepance should not copy Jump’s meeting bot. Build a **local meeting recorder** instead: record mic + system audio, transcribe locally in chunks, save transcript/audio/notes into the client workspace, then feed them into the existing cited search layer.

Why this is better: no bot waiting room, no bot denied by host, no client audio sent to a cloud notetaker, and every output becomes part of Keepance’s local client memory.

Reuse:
- Local transcription command: [voice.rs](/home/jameson/keepance/src-tauri/src/commands/voice.rs:1)
- Current audio recorder/save path: [useAudioRecording.ts](/home/jameson/keepance/src/app/lifecycle/useAudioRecording.ts:26), [AudioRecorderModal.tsx](/home/jameson/keepance/src/features/dictation/audio/AudioRecorderModal.tsx:46)
- Meeting source already allowed in RAG: [store.rs](/home/jameson/keepance/src-tauri/src/commands/rag/store.rs:181)
- External connector indexing: [connector/mod.rs](/home/jameson/keepance/src-tauri/src/commands/connector/mod.rs:20)
- Client Map can already cite `meeting` sources: [types.ts](/home/jameson/keepance/src/platform/clientMap/types.ts:31)
- Existing meeting prep and summary templates: [MeetingPrepAndSuitabilityNotes.ts](/home/jameson/keepance/src/features/workflows/engine/templates/advisors/MeetingPrepAndSuitabilityNotes.ts:145), [ClientFinancialPlanSummary.ts](/home/jameson/keepance/src/features/workflows/engine/templates/advisors/ClientFinancialPlanSummary.ts:132)

**Capability Map**

| Jump capability | Keepance design | Why better | Lift / risks |
|---|---|---|---|
| Zoom/Teams/Meet bot | Local “Record Meeting” button. Capture mic + system audio. Use bot only as optional fallback later. | Private, no join failure, no client-facing bot. | L/XL. Windows doable with WASAPI loopback. macOS/Linux harder. |
| Phone calls | Best path: record VoIP/system audio on desktop. For real phone calls, offer “speakerphone capture” and later a dial-in bridge only if needed. | Avoids phone network/vendor complexity early. | M for speakerphone, XL for dial-in. Cannot fully match Jump’s Join My Call without cloud telephony. |
| In-person meetings | Desktop mic capture now; later “drop audio file” import. Mobile app is needed for real field capture. | Local and simple at desk. | S/M. Cannot match Jump mobile capture without mobile app. |
| Transcription | Convert long audio into 30-60 sec chunks and feed existing Parakeet/whisper path. Store raw transcript + cleaned transcript. | Works offline and keeps text local. | M/L. Current command has a 30 sec cap, so long-meeting chunking is required. |
| Diarization, speaker labels | Start with “Advisor / Client / Unknown” labels using audio-channel hints and simple speaker-change detection. Add pyannote-style model only if accuracy is acceptable locally. | Honest labels, no fake certainty. | L. Local diarization is the biggest quality risk. |
| AI notes templates | Turn current advisor templates into meeting-output templates: SOAP-style notes, annual review, suitability notes, client recap. | Existing workflow engine already fits this. | M. Risk is compliance language and bad facts if transcript is weak. |
| Follow-up email drafts | Generate drafts from transcript + Client Map, then open in Keepance email composer for review. Never auto-send. | Safer than Jump-style automation; advisor approves. | M. Needs tight source grounding and tone controls. |
| Task extraction | Extract tasks into a local “Action Items” tray, tied to transcript timestamps and citations. | Better audit trail: every task points to where it came from. | M. Needs dedupe and “not actually a task” filtering. |
| CRM write-back | Use existing CRM command layer for Wealthbox/Redtail/Salesforce. Sync only approved notes/tasks/field updates. | Keeps human approval and local record first. | L. CRM APIs are messy; field mapping is the risk. Existing CRM base is real. |
| Calendar sync | Add Microsoft/Google calendar connector, reuse OAuth loopback patterns. Calendly stays useful but insufficient. | Meeting prep can happen before capture, not after. | M/L. Calendar permissions and matching attendees to clients are the risks. |
| Pre-meeting briefs | Client Map already does the hard part. Add “Upcoming Meeting Brief” that pulls Client Map + calendar + last meeting transcript. | Stronger than Jump when local docs matter. | S/M. Mostly product wiring. |
| Ask anything over meetings | Store transcripts as `source_type='meeting'`; Ask can already cite sources. Add filters: “meetings only,” “since last meeting.” | Meeting answers become part of the whole client file, not a separate notetaker silo. | S/M. Main risk is noisy transcript chunks. |
| Compliance retention | Add retention rules per source: keep audio, delete audio after transcription, transcript-only, summary-only. Log every choice. | Local-first means less vendor exposure. | M. Needs clear audit export and policy UI. |
| Supervision controls | Firm admin queue for meeting outputs: reviewed / needs edit / approved for CRM. | Better for small firms if lightweight. | L. Enterprise supervision depth is hard. |
| 39 integrations | Do not chase 39. Focus Wealthbox, Redtail, Salesforce, Outlook/Gmail, OneDrive/SharePoint, Google/Microsoft calendar, RightCapital/eMoney export recognition. | Depth beats shallow logo grid. | M to XL depending on vendors. Jump wins breadth. |
| Mobile app | Do not build first. Support “upload phone recording” and maybe a tiny capture-only mobile app later. | Avoids a large second product too early. | XL for real mobile. Keepance cannot match Jump mobile now. |
| Scheduling | Keep Calendly metadata. Do not build scheduling unless demanded. | Scheduling is not the local-first wedge. | S if staying metadata-only. |
| Document intelligence / onboarding | Keepance should not copy form-filling first. Better angle: “read the full messy client folder, cite it, draft Word docs.” | This is where Keepance is already stronger. | M. Use existing document/RAG/Word engine. |
| Grow signals / dashboards | Build narrow “opportunities found in client file,” not firm revenue dashboards. Example: missing beneficiary, stale plan, unassigned task. | More useful and less salesy for solo/small RIA. | M/L. Risk is false positives. |
| Enterprise SSO/SCIM | SSO exists in code direction, but SCIM is not worth early build. | Keepance should win solos/small firms first. | XL. Cannot match enterprise SCIM soon. |

**Hard Truths**
Keepance cannot fully match Jump in four areas soon:

1. **Mobile in-person capture** without a mobile app.
2. **Always-on capture when the desktop app is closed.**
3. **Cloud phone bridge / dial-in notetaker** without telephony infrastructure.
4. **Enterprise controls like SCIM, large compliance dashboards, and 39 live integrations.**

Least-bad mitigation: be explicit. “Keepance records from your computer, keeps it private, and lets you import audio. Jump is better if you need a cloud bot and mobile capture today.”

**Recommended Build Sequence**
1. Meeting artifact model: `meeting:<id>` source IDs, transcript file format, audio retention setting, RAG indexing.
2. Long-audio local transcription: chunk audio, queue jobs, resume after failure.
3. Windows system-audio loopback MVP plus mic mixing.
4. Meeting workspace UI: record, pause, stop, transcript, notes, tasks, citations.
5. AI outputs: advisor notes, client recap email, task list, CRM-ready summary.
6. Ask + Client Map meeting filters.
7. CRM approval/write-back for Wealthbox first, then Redtail/Salesforce.
8. Microsoft/Google calendar connector.
9. Compliance retention/supervision pack.
10. Only then consider mobile capture or cloud bot fallback.

Sources checked: Jump’s official pages say it covers scheduling/prep/notes/follow-up/CRM updates and onboarding/docs/growth workflows; its notetaker page claims Zoom/Teams/Meet/Webex/phone/in-person/mobile capture and voice differentiation; its help center describes compliance settings and phone/mobile capture; its integrations page shows broad CRM/planning/workflow integrations. Links: [Jump home](https://jump.ai/), [notetaker](https://jump.ai/products/meet/notetaker), [integrations](https://jump.ai/integrations), [compliance settings](https://help.jumpapp.com/en/articles/11526343-compliance-settings), [phone capture](https://help.jumpapp.com/en/articles/10073183-how-to-capture-a-phone-call-with-jump).
tokens used
286,215
I stayed read-only. I did **not** write `research/codex-design-brainstorm.md` because your first rule said not to create or edit files. Here is the proposal content.

**Core Proposal**
Keepance should not copy Jump’s meeting bot. Build a **local meeting recorder** instead: record mic + system audio, transcribe locally in chunks, save transcript/audio/notes into the client workspace, then feed them into the existing cited search layer.

Why this is better: no bot waiting room, no bot denied by host, no client audio sent to a cloud notetaker, and every output becomes part of Keepance’s local client memory.

Reuse:
- Local transcription command: [voice.rs](/home/jameson/keepance/src-tauri/src/commands/voice.rs:1)
- Current audio recorder/save path: [useAudioRecording.ts](/home/jameson/keepance/src/app/lifecycle/useAudioRecording.ts:26), [AudioRecorderModal.tsx](/home/jameson/keepance/src/features/dictation/audio/AudioRecorderModal.tsx:46)
- Meeting source already allowed in RAG: [store.rs](/home/jameson/keepance/src-tauri/src/commands/rag/store.rs:181)
- External connector indexing: [connector/mod.rs](/home/jameson/keepance/src-tauri/src/commands/connector/mod.rs:20)
- Client Map can already cite `meeting` sources: [types.ts](/home/jameson/keepance/src/platform/clientMap/types.ts:31)
- Existing meeting prep and summary templates: [MeetingPrepAndSuitabilityNotes.ts](/home/jameson/keepance/src/features/workflows/engine/templates/advisors/MeetingPrepAndSuitabilityNotes.ts:145), [ClientFinancialPlanSummary.ts](/home/jameson/keepance/src/features/workflows/engine/templates/advisors/ClientFinancialPlanSummary.ts:132)

**Capability Map**

| Jump capability | Keepance design | Why better | Lift / risks |
|---|---|---|---|
| Zoom/Teams/Meet bot | Local “Record Meeting” button. Capture mic + system audio. Use bot only as optional fallback later. | Private, no join failure, no client-facing bot. | L/XL. Windows doable with WASAPI loopback. macOS/Linux harder. |
| Phone calls | Best path: record VoIP/system audio on desktop. For real phone calls, offer “speakerphone capture” and later a dial-in bridge only if needed. | Avoids phone network/vendor complexity early. | M for speakerphone, XL for dial-in. Cannot fully match Jump’s Join My Call without cloud telephony. |
| In-person meetings | Desktop mic capture now; later “drop audio file” import. Mobile app is needed for real field capture. | Local and simple at desk. | S/M. Cannot match Jump mobile capture without mobile app. |
| Transcription | Convert long audio into 30-60 sec chunks and feed existing Parakeet/whisper path. Store raw transcript + cleaned transcript. | Works offline and keeps text local. | M/L. Current command has a 30 sec cap, so long-meeting chunking is required. |
| Diarization, speaker labels | Start with “Advisor / Client / Unknown” labels using audio-channel hints and simple speaker-change detection. Add pyannote-style model only if accuracy is acceptable locally. | Honest labels, no fake certainty. | L. Local diarization is the biggest quality risk. |
| AI notes templates | Turn current advisor templates into meeting-output templates: SOAP-style notes, annual review, suitability notes, client recap. | Existing workflow engine already fits this. | M. Risk is compliance language and bad facts if transcript is weak. |
| Follow-up email drafts | Generate drafts from transcript + Client Map, then open in Keepance email composer for review. Never auto-send. | Safer than Jump-style automation; advisor approves. | M. Needs tight source grounding and tone controls. |
| Task extraction | Extract tasks into a local “Action Items” tray, tied to transcript timestamps and citations. | Better audit trail: every task points to where it came from. | M. Needs dedupe and “not actually a task” filtering. |
| CRM write-back | Use existing CRM command layer for Wealthbox/Redtail/Salesforce. Sync only approved notes/tasks/field updates. | Keeps human approval and local record first. | L. CRM APIs are messy; field mapping is the risk. Existing CRM base is real. |
| Calendar sync | Add Microsoft/Google calendar connector, reuse OAuth loopback patterns. Calendly stays useful but insufficient. | Meeting prep can happen before capture, not after. | M/L. Calendar permissions and matching attendees to clients are the risks. |
| Pre-meeting briefs | Client Map already does the hard part. Add “Upcoming Meeting Brief” that pulls Client Map + calendar + last meeting transcript. | Stronger than Jump when local docs matter. | S/M. Mostly product wiring. |
| Ask anything over meetings | Store transcripts as `source_type='meeting'`; Ask can already cite sources. Add filters: “meetings only,” “since last meeting.” | Meeting answers become part of the whole client file, not a separate notetaker silo. | S/M. Main risk is noisy transcript chunks. |
| Compliance retention | Add retention rules per source: keep audio, delete audio after transcription, transcript-only, summary-only. Log every choice. | Local-first means less vendor exposure. | M. Needs clear audit export and policy UI. |
| Supervision controls | Firm admin queue for meeting outputs: reviewed / needs edit / approved for CRM. | Better for small firms if lightweight. | L. Enterprise supervision depth is hard. |
| 39 integrations | Do not chase 39. Focus Wealthbox, Redtail, Salesforce, Outlook/Gmail, OneDrive/SharePoint, Google/Microsoft calendar, RightCapital/eMoney export recognition. | Depth beats shallow logo grid. | M to XL depending on vendors. Jump wins breadth. |
| Mobile app | Do not build first. Support “upload phone recording” and maybe a tiny capture-only mobile app later. | Avoids a large second product too early. | XL for real mobile. Keepance cannot match Jump mobile now. |
| Scheduling | Keep Calendly metadata. Do not build scheduling unless demanded. | Scheduling is not the local-first wedge. | S if staying metadata-only. |
| Document intelligence / onboarding | Keepance should not copy form-filling first. Better angle: “read the full messy client folder, cite it, draft Word docs.” | This is where Keepance is already stronger. | M. Use existing document/RAG/Word engine. |
| Grow signals / dashboards | Build narrow “opportunities found in client file,” not firm revenue dashboards. Example: missing beneficiary, stale plan, unassigned task. | More useful and less salesy for solo/small RIA. | M/L. Risk is false positives. |
| Enterprise SSO/SCIM | SSO exists in code direction, but SCIM is not worth early build. | Keepance should win solos/small firms first. | XL. Cannot match enterprise SCIM soon. |

**Hard Truths**
Keepance cannot fully match Jump in four areas soon:

1. **Mobile in-person capture** without a mobile app.
2. **Always-on capture when the desktop app is closed.**
3. **Cloud phone bridge / dial-in notetaker** without telephony infrastructure.
4. **Enterprise controls like SCIM, large compliance dashboards, and 39 live integrations.**

Least-bad mitigation: be explicit. “Keepance records from your computer, keeps it private, and lets you import audio. Jump is better if you need a cloud bot and mobile capture today.”

**Recommended Build Sequence**
1. Meeting artifact model: `meeting:<id>` source IDs, transcript file format, audio retention setting, RAG indexing.
2. Long-audio local transcription: chunk audio, queue jobs, resume after failure.
3. Windows system-audio loopback MVP plus mic mixing.
4. Meeting workspace UI: record, pause, stop, transcript, notes, tasks, citations.
5. AI outputs: advisor notes, client recap email, task list, CRM-ready summary.
6. Ask + Client Map meeting filters.
7. CRM approval/write-back for Wealthbox first, then Redtail/Salesforce.
8. Microsoft/Google calendar connector.
9. Compliance retention/supervision pack.
10. Only then consider mobile capture or cloud bot fallback.

Sources checked: Jump’s official pages say it covers scheduling/prep/notes/follow-up/CRM updates and onboarding/docs/growth workflows; its notetaker page claims Zoom/Teams/Meet/Webex/phone/in-person/mobile capture and voice differentiation; its help center describes compliance settings and phone/mobile capture; its integrations page shows broad CRM/planning/workflow integrations. Links: [Jump home](https://jump.ai/), [notetaker](https://jump.ai/products/meet/notetaker), [integrations](https://jump.ai/integrations), [compliance settings](https://help.jumpapp.com/en/articles/11526343-compliance-settings), [phone capture](https://help.jumpapp.com/en/articles/10073183-how-to-capture-a-phone-call-with-jump).
