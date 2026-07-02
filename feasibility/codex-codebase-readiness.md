I did **not** write `/home/jameson/keepance-jump-feasibility/codex-codebase-readiness.md` because you set read-only mode. Writing that file would be a file mutation. Below is the report content.

**Bottom Line**

Keepance is much closer to “advisor intelligence over files, email, CRM, and client context” than to “Jump-style meeting bot.” It has strong foundations for **pre-meeting prep, meeting artifact import, summaries, follow-up drafts, task suggestions, and ask-anything over stored transcripts**.

A full Jump clone is a **very large project** because Jump’s current product includes bot/web/mobile capture across Zoom, Teams, Meet, Webex, phone calls, and in-person meetings, plus CRM/system writeback and firm compliance controls. Keepance’s local-first desktop design fights that shape.

**Architecture Summary**

Keepance is a local-first Tauri + React desktop app. Its core promise is private local intelligence over advisor documents, email, and files, with cited answers. The architecture doc says this directly: local-first app, client documents/email/files, verifiable citations ([ARCHITECTURE.md](/home/jameson/keepance/ARCHITECTURE.md:8)).

Important pieces:

- Frontend: React/Tauri feature folders like Ask, Documents, Workflows, Email, CRM, Calendly, Zocks, Audit ([ARCHITECTURE.md](/home/jameson/keepance/ARCHITECTURE.md:54)).
- AI/RAG: local vector search using FastEmbed + LanceDB under `.keepance/vectors`, with scoped retrieval and citation verification ([rag/mod.rs](/home/jameson/keepance/src-tauri/src/commands/rag/mod.rs:1)).
- Ask: cited chat over current client, all clients, email, or documents ([Ask.tsx](/home/jameson/keepance/src/features/ask/Ask.tsx:1)).
- Client Map: structured sourced client facts, including source kinds for document, email, CRM, meeting, Zocks, etc. ([types.ts](/home/jameson/keepance/src/platform/clientMap/types.ts:31)).
- Audio: there is local recording and short voice transcription, but the transcription command has a hard 30-second cap ([voice.rs](/home/jameson/keepance/src-tauri/src/commands/voice.rs:36)).
- CRM/calendar: Wealthbox, Redtail, Salesforce, Calendly are mostly **read/import/index**, not write-back. Wealthbox client explicitly says GET only ([crm/client.rs](/home/jameson/keepance/src-tauri/src/commands/crm/client.rs:1)); Calendly is also GET only ([calendly/client.rs](/home/jameson/keepance/src-tauri/src/commands/calendly/client.rs:1)).
- Compliance: strong local audit log with encryption and hash chain, but not a formal WORM archive or SEC recordkeeping system ([audit/store.rs](/home/jameson/keepance/src-tauri/src/commands/audit/store.rs:1)).

**Feature Readiness**

| Jump feature | What helps | What is missing | Lift | Main risk |
|---|---|---|---|---|
| Bot joins Zoom/Teams/Meet | Calendly can import meetings; local audio exists | Cloud bot service, calendar scheduler, meeting join logic, WebRTC/browser capture, consent flow, retry system | **Very large** | Desktop app may be closed; bots need always-on cloud infra |
| In-person audio recording | `AudioRecorderModal` records mic audio to `.webm` ([AudioRecorderModal.tsx](/home/jameson/keepance/src/features/dictation/audio/AudioRecorderModal.tsx:46)) | Long meeting storage, diarization, transcript pipeline, speaker labels, recovery if app crashes | **Large**; MVP medium | Existing transcription is for short clips, not hour meetings |
| Real-time transcription | Voice sidecar can transcribe WAV | Streaming STT, chunking, diarization, live transcript UI, performance tuning | **Large** | Local model speed/accuracy on advisor laptops |
| AI meeting summaries/templates | Workflow templates already have advisor meeting prep and client summary docs ([MeetingPrepAndSuitabilityNotes.ts](/home/jameson/keepance/src/features/workflows/engine/templates/advisors/MeetingPrepAndSuitabilityNotes.ts:73), [ClientFinancialPlanSummary.ts](/home/jameson/keepance/src/features/workflows/engine/templates/advisors/ClientFinancialPlanSummary.ts:65)) | Transcript-to-note pipeline, user template editor, review queue, grounded quotes | **Medium** if transcript exists; **large** if capture included | Bad summaries become compliance risk |
| Follow-up email drafts | Email send/draft exists; AI reply drafting has prompt-injection guard ([EmailViewer.tsx](/home/jameson/keepance/src/features/email/EmailViewer.tsx:280)) | Meeting-based follow-up composer, recipient matching, approval workflow | **Medium** | Wrong recipient or wrong promise in client email |
| Task extraction | Client Map has follow-ups; CRM imports tasks | Real task model, due dates, owners, confidence, review/approve queue | **Medium** | False tasks create advisor obligations |
| CRM sync notes/tasks | CRM import is real; Wealthbox/Redtail/Salesforce context helps | Write APIs, field mapping, conflict handling, retries, audit, firm approval | **Large** | Current CRM code is read-only by design |
| Calendar integration | Calendly connector imports scheduled events/invitees | Outlook/Google calendar, meeting matching, reminders, bot auto-join | **Medium** for read-only calendars; **large** with bot scheduling | OAuth/admin approval and reliability |
| Pre-meeting prep briefs | Strongest fit: Client Map, RAG, CRM/email, advisor prep template | One-click upcoming-meeting flow, better calendar matching, template options | **Small/medium** | Data matching gaps |
| Ask-anything over past meetings | Ask + RAG already works; source type supports `meeting` and `zocks` | Need transcripts imported/captured; meeting filters by date/client/person | **Small/medium** if transcripts exist | AI-generated notes are intentionally not indexed in some paths |
| Compliance/archive posture | Audit log, Data Map, local encryption, confidentiality report | WORM archive, retention policy, legal hold, admin supervision, Smarsh/Global Relay-style export | **Large/very large** | Easy to overclaim compliance |

**Hard Blockers From Local-First Desktop**

The biggest blocker is simple: **meeting bots must run even when Keepance is closed**. A desktop app cannot reliably join a 9 AM Zoom if the laptop is asleep.

Other blockers:

- Real-time bot capture needs cloud infrastructure, not just Tauri code.
- Firms often want central compliance review; local-only data makes supervision harder.
- BYOK/local-only privacy conflicts with cloud speech-to-text unless the user clearly opts in.
- CRM writeback needs durable background jobs, retries, and duplicate protection.
- Meeting audio/video storage changes the security and legal risk profile a lot.

**Existing Keepance Edge**

Keepance has real advantages Jump may not own as deeply:

- Whole-document intelligence: files, Office docs, PDFs/OCR, email, CRM, OneDrive, and more can feed cited answers.
- Client Map: sourced household/goals/money/follow-up facts, not just meeting notes.
- Privacy story: local-first, BYOK, local model option, Data Map, audit trail ([DataMapDialog.tsx](/home/jameson/keepance/src/platform/privacy/ui/DataMapDialog.tsx:72)).
- Email intelligence already exists.
- Zocks import path exists, but it is provisional and read-only, with vendor assumptions still called out in code ([zocks/client.rs](/home/jameson/keepance/src-tauri/src/commands/zocks/client.rs:1)).

**Docs vs Code Reality**

The 2026-06-29 board decision says Keepance should be an AI app, not a note-taking app, and not lead with meeting notes ([board decision](/home/jameson/keepance/docs/strategy/2026-06-29-board-decision-leading-advisor-ai.md:41)). The code matches that direction: it has import/context/drafting pieces, not a full notetaker.

Be skeptical of any claim that CRM sync is Jump-equivalent. Code shows CRM connectors are mainly read-only/import. Also be careful with Zocks claims: the connector exists, but the API is explicitly “provisional” pending vendor confirmation.

**Recommended Ordering**

Cheap wins:

1. One-click pre-meeting brief from Client Map + CRM/email/calendar context.
2. Import meeting transcripts/audio exports into a client matter.
3. Generate meeting summary, follow-up email draft, and task suggestions from an imported transcript.
4. Add Ask filters for “past meetings.”

Medium projects:

1. Local in-person recorder with post-meeting transcription.
2. Review queue for extracted tasks.
3. Read-only Outlook/Google Calendar import.

Major projects:

1. CRM writeback of notes/tasks.
2. Real-time transcription with speaker labels.
3. Firm compliance archive/export/admin review.

Very large projects:

1. Zoom/Teams/Meet bot joiner.
2. Full Jump-style cloud meeting infrastructure.
3. Enterprise compliance posture around captured meetings.

My recommendation: **do not chase bots first**. Build “meeting artifact intake” first: let advisors import Jump/Zocks/transcript/audio outputs, then use Keepance’s stronger document/email/Client Map brain to make better prep, summaries, emails, tasks, and cited meeting chat. That gets useful fast without turning Keepance into the cloud notetaker it is currently designed not to be.
tokens used
306,920
I did **not** write `/home/jameson/keepance-jump-feasibility/codex-codebase-readiness.md` because you set read-only mode. Writing that file would be a file mutation. Below is the report content.

**Bottom Line**

Keepance is much closer to “advisor intelligence over files, email, CRM, and client context” than to “Jump-style meeting bot.” It has strong foundations for **pre-meeting prep, meeting artifact import, summaries, follow-up drafts, task suggestions, and ask-anything over stored transcripts**.

A full Jump clone is a **very large project** because Jump’s current product includes bot/web/mobile capture across Zoom, Teams, Meet, Webex, phone calls, and in-person meetings, plus CRM/system writeback and firm compliance controls. Keepance’s local-first desktop design fights that shape.

**Architecture Summary**

Keepance is a local-first Tauri + React desktop app. Its core promise is private local intelligence over advisor documents, email, and files, with cited answers. The architecture doc says this directly: local-first app, client documents/email/files, verifiable citations ([ARCHITECTURE.md](/home/jameson/keepance/ARCHITECTURE.md:8)).

Important pieces:

- Frontend: React/Tauri feature folders like Ask, Documents, Workflows, Email, CRM, Calendly, Zocks, Audit ([ARCHITECTURE.md](/home/jameson/keepance/ARCHITECTURE.md:54)).
- AI/RAG: local vector search using FastEmbed + LanceDB under `.keepance/vectors`, with scoped retrieval and citation verification ([rag/mod.rs](/home/jameson/keepance/src-tauri/src/commands/rag/mod.rs:1)).
- Ask: cited chat over current client, all clients, email, or documents ([Ask.tsx](/home/jameson/keepance/src/features/ask/Ask.tsx:1)).
- Client Map: structured sourced client facts, including source kinds for document, email, CRM, meeting, Zocks, etc. ([types.ts](/home/jameson/keepance/src/platform/clientMap/types.ts:31)).
- Audio: there is local recording and short voice transcription, but the transcription command has a hard 30-second cap ([voice.rs](/home/jameson/keepance/src-tauri/src/commands/voice.rs:36)).
- CRM/calendar: Wealthbox, Redtail, Salesforce, Calendly are mostly **read/import/index**, not write-back. Wealthbox client explicitly says GET only ([crm/client.rs](/home/jameson/keepance/src-tauri/src/commands/crm/client.rs:1)); Calendly is also GET only ([calendly/client.rs](/home/jameson/keepance/src-tauri/src/commands/calendly/client.rs:1)).
- Compliance: strong local audit log with encryption and hash chain, but not a formal WORM archive or SEC recordkeeping system ([audit/store.rs](/home/jameson/keepance/src-tauri/src/commands/audit/store.rs:1)).

**Feature Readiness**

| Jump feature | What helps | What is missing | Lift | Main risk |
|---|---|---|---|---|
| Bot joins Zoom/Teams/Meet | Calendly can import meetings; local audio exists | Cloud bot service, calendar scheduler, meeting join logic, WebRTC/browser capture, consent flow, retry system | **Very large** | Desktop app may be closed; bots need always-on cloud infra |
| In-person audio recording | `AudioRecorderModal` records mic audio to `.webm` ([AudioRecorderModal.tsx](/home/jameson/keepance/src/features/dictation/audio/AudioRecorderModal.tsx:46)) | Long meeting storage, diarization, transcript pipeline, speaker labels, recovery if app crashes | **Large**; MVP medium | Existing transcription is for short clips, not hour meetings |
| Real-time transcription | Voice sidecar can transcribe WAV | Streaming STT, chunking, diarization, live transcript UI, performance tuning | **Large** | Local model speed/accuracy on advisor laptops |
| AI meeting summaries/templates | Workflow templates already have advisor meeting prep and client summary docs ([MeetingPrepAndSuitabilityNotes.ts](/home/jameson/keepance/src/features/workflows/engine/templates/advisors/MeetingPrepAndSuitabilityNotes.ts:73), [ClientFinancialPlanSummary.ts](/home/jameson/keepance/src/features/workflows/engine/templates/advisors/ClientFinancialPlanSummary.ts:65)) | Transcript-to-note pipeline, user template editor, review queue, grounded quotes | **Medium** if transcript exists; **large** if capture included | Bad summaries become compliance risk |
| Follow-up email drafts | Email send/draft exists; AI reply drafting has prompt-injection guard ([EmailViewer.tsx](/home/jameson/keepance/src/features/email/EmailViewer.tsx:280)) | Meeting-based follow-up composer, recipient matching, approval workflow | **Medium** | Wrong recipient or wrong promise in client email |
| Task extraction | Client Map has follow-ups; CRM imports tasks | Real task model, due dates, owners, confidence, review/approve queue | **Medium** | False tasks create advisor obligations |
| CRM sync notes/tasks | CRM import is real; Wealthbox/Redtail/Salesforce context helps | Write APIs, field mapping, conflict handling, retries, audit, firm approval | **Large** | Current CRM code is read-only by design |
| Calendar integration | Calendly connector imports scheduled events/invitees | Outlook/Google calendar, meeting matching, reminders, bot auto-join | **Medium** for read-only calendars; **large** with bot scheduling | OAuth/admin approval and reliability |
| Pre-meeting prep briefs | Strongest fit: Client Map, RAG, CRM/email, advisor prep template | One-click upcoming-meeting flow, better calendar matching, template options | **Small/medium** | Data matching gaps |
| Ask-anything over past meetings | Ask + RAG already works; source type supports `meeting` and `zocks` | Need transcripts imported/captured; meeting filters by date/client/person | **Small/medium** if transcripts exist | AI-generated notes are intentionally not indexed in some paths |
| Compliance/archive posture | Audit log, Data Map, local encryption, confidentiality report | WORM archive, retention policy, legal hold, admin supervision, Smarsh/Global Relay-style export | **Large/very large** | Easy to overclaim compliance |

**Hard Blockers From Local-First Desktop**

The biggest blocker is simple: **meeting bots must run even when Keepance is closed**. A desktop app cannot reliably join a 9 AM Zoom if the laptop is asleep.

Other blockers:

- Real-time bot capture needs cloud infrastructure, not just Tauri code.
- Firms often want central compliance review; local-only data makes supervision harder.
- BYOK/local-only privacy conflicts with cloud speech-to-text unless the user clearly opts in.
- CRM writeback needs durable background jobs, retries, and duplicate protection.
- Meeting audio/video storage changes the security and legal risk profile a lot.

**Existing Keepance Edge**

Keepance has real advantages Jump may not own as deeply:

- Whole-document intelligence: files, Office docs, PDFs/OCR, email, CRM, OneDrive, and more can feed cited answers.
- Client Map: sourced household/goals/money/follow-up facts, not just meeting notes.
- Privacy story: local-first, BYOK, local model option, Data Map, audit trail ([DataMapDialog.tsx](/home/jameson/keepance/src/platform/privacy/ui/DataMapDialog.tsx:72)).
- Email intelligence already exists.
- Zocks import path exists, but it is provisional and read-only, with vendor assumptions still called out in code ([zocks/client.rs](/home/jameson/keepance/src-tauri/src/commands/zocks/client.rs:1)).

**Docs vs Code Reality**

The 2026-06-29 board decision says Keepance should be an AI app, not a note-taking app, and not lead with meeting notes ([board decision](/home/jameson/keepance/docs/strategy/2026-06-29-board-decision-leading-advisor-ai.md:41)). The code matches that direction: it has import/context/drafting pieces, not a full notetaker.

Be skeptical of any claim that CRM sync is Jump-equivalent. Code shows CRM connectors are mainly read-only/import. Also be careful with Zocks claims: the connector exists, but the API is explicitly “provisional” pending vendor confirmation.

**Recommended Ordering**

Cheap wins:

1. One-click pre-meeting brief from Client Map + CRM/email/calendar context.
2. Import meeting transcripts/audio exports into a client matter.
3. Generate meeting summary, follow-up email draft, and task suggestions from an imported transcript.
4. Add Ask filters for “past meetings.”

Medium projects:

1. Local in-person recorder with post-meeting transcription.
2. Review queue for extracted tasks.
3. Read-only Outlook/Google Calendar import.

Major projects:

1. CRM writeback of notes/tasks.
2. Real-time transcription with speaker labels.
3. Firm compliance archive/export/admin review.

Very large projects:

1. Zoom/Teams/Meet bot joiner.
2. Full Jump-style cloud meeting infrastructure.
3. Enterprise compliance posture around captured meetings.

My recommendation: **do not chase bots first**. Build “meeting artifact intake” first: let advisors import Jump/Zocks/transcript/audio outputs, then use Keepance’s stronger document/email/Client Map brain to make better prep, summaries, emails, tasks, and cited meeting chat. That gets useful fast without turning Keepance into the cloud notetaker it is currently designed not to be.
