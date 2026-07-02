# Brainstorm — lens: local-first-native designs (2026-07-02)

**Framing:** Jump's architecture is a cloud bot that joins the meeting, ships audio to Jump's servers, and pushes results back. Keepance's counter is a **capture engine on the advisor's own machine**: system-audio loopback + mic, transcribed by the already-bundled Parakeet/whisper sidecar, landing as Word documents in the client's folder. No bot participant, no platform allowlist, no vendor in the data path. Every feature below is a layer on that engine plus rails that already exist (Workflows, Client Map, Ask/RAG, email connector, connector framework, audit log).

---

## 1. Meeting capture & transcription (the keystone)

### Approach: dual-stream on-device capture, no bot

Capture **two synchronized audio streams**:

- **Mic stream** — the advisor's voice (near end). Capture plumbing exists in `VoiceCapture.ts` / `AudioRecorderModal`.
- **System-audio loopback stream** — everyone else (far end): Zoom, Teams, Meet, WebEx, softphone, browser call, anything the machine plays.
  - **Windows:** WASAPI loopback (`AUDCLNT_STREAMFLAGS_LOOPBACK`, `cpal`/`wasapi` crates); v1.1 refinement: **per-process loopback** (Win10 2004+, `ActivateAudioInterfaceAsync` with target PID) so only the Zoom/Teams process is captured — background Spotify never enters the recording (itself a privacy talking point).
  - **macOS:** ScreenCaptureKit audio capture (13+; 14.4+ has a dedicated System Audio Recording permission) or CoreAudio process taps (14.2+). Practical shape: a **small Swift sidecar streaming PCM over stdout** — the same sidecar pattern already used for Parakeet and Piper, so lifecycle/packaging is solved in this codebase.
  - **Linux:** PipeWire/Pulse monitor source — trivial.

**Pipeline:** both streams → 16 kHz mono per channel → **continuously flushed to disk as encrypted opus/wav chunks** (crash loses seconds, not the meeting — directly attacks Jump's #1 third-party complaint, dropped recordings) → **silero-VAD** (tiny ONNX, skips silence, cuts ASR work 30–50%) → 15–30 s overlapping chunks into the **existing Parakeet/whisper sidecar** via its file/stdin batch interface. No sidecar rewrite for v1; streaming mode is a later optimization.

**Meeting detection & start UX:** (a) watch audio sessions / process list for Zoom/Teams/Meet/WebEx → "Meeting detected — record?"; (b) calendar-triggered prompt; (c) manual tray button. Tauri hide-to-tray keeps the recorder resident.

**Phone calls:** anything routed through the computer (Teams Phone, Zoom Phone, RingCentral, Bluetooth-paired handset audio) is just loopback — zero extra work, on platforms Jump's bot literally cannot join. A cell call held to the ear is a genuine gap → speakerphone mode or import path.

**In-person:** "Conference room mode" — mic-only capture, full diarization, laptop on the table. Existing recorder UI is 70% of this.

**Mobile / away-from-desk gap (honest):** no mobile app, don't build one for this. Lean bridge: **phone as dumb recorder + watched import folder** — record with any voice-memo app; file reaches the desktop via the shipped OneDrive connector (watch a "Meeting Recordings" folder) or the existing `watcher.rs`; auto-transcribe on arrival, "Which client?", same post-meeting pipeline. A workaround, not parity — Jump has real iOS capture.

**App closed / laptop asleep:** flag honestly — **capture requires the app running.** Mitigations: tray residency default, auto-launch at login (opt-in), calendar-driven notifications, crash-recovery resume, keep-awake OS assertions while recording. No cloud fallback, ever.

**Battery/CPU (honest numbers):** capture + VAD negligible (<1–2% CPU). ASR: parakeet-tdt-0.6b int8 / whisper small run at or faster than real time on ~1 modern laptop core. Ship **two modes:** *Live* (transcribe during the meeting) and *Battery saver* (record only; transcribe in a burst at meeting end or on AC). Default Live on AC, Battery saver on battery.

**Consent / 2-party recording UX** (loopback is invisible — no bot announcing itself — so consent must be first-class, day one):
- **Per-client consent ledger on the Client Map**: standing or per-meeting consent (date, method, evidence link), recorded in the append-only encrypted audit log = attestation trail.
- **Pre-meeting consent email template** via existing email draft/send.
- **At record-start**: verbal-disclosure script card; in all-party-consent states (CA, FL, WA…) recording won't start until the advisor confirms disclosure — the confirmation is audit-logged.
- The disclosure line is itself a differentiator: *"this stays on my machine"* is an easier ask than *"a third-party AI vendor's bot will record us."*

### Why it beats Jump
- **No bot in the room** — clients dislike "Jump Notetaker has joined"; many BD/IT compliance depts block bot participants; bots can't join the client's WebEx, a phone call, or a platform without a bot API. Loopback works with every platform by construction.
- **Nothing leaves the machine** — a categorical claim Jump cannot make without abandoning its architecture.
- **Crash-durable local chunks** vs Jump's documented dropped-recording complaints.
- Consent tooling built in beats "the bot's presence is the disclosure."

### Lift: **XL** (the one XL — capture engine, per-OS loopback, tray residency, meeting detection, chunked pipeline). Everything downstream reuses it.

### Risks
- macOS permission UX: pre-14.4 the audio tap rides on the scary "Screen Recording" permission; genuine onboarding friction.
- Whole-device loopback captures notification dings until per-process loopback lands.
- Laptop sleep/lid-close mid-meeting truncates recording; keep-awake + clear messaging.
- Mobile capture stays worse than Jump's. Accept it; the ICP (desk-based solo/small RIA doing Zoom reviews) mostly meets at the desk.

---

## 2. Templated meeting notes (near-real-time)

Don't chase token-by-token live notes (Jump doesn't truly have that either). Two tiers:
1. **Live transcript view** during the meeting (chunked ASR output scrolling, speaker-tagged) — cheap.
2. **Notes 30–60 s after meeting end**: transcript → template-slot summarization → **a real .docx via `lantern-docx`** filed in the client's folder, every claim carrying a transcript-timestamp citation. Optional mid-meeting section drafts refreshed every ~2–3 min via embedded llama.cpp.

Templates = existing Workflows engine (`MeetingPrepAndSuitabilityNotes`, `AnnualReviewPacket`, `RegBIDocumentation` already exist); add transcript slot-fill as an input source. Custom templates ride the marketplace. Confidentiality spectrum untouched: Local-only = llama.cpp/Ollama; BYOK for frontier-quality notes.

**Beats Jump:** notes land as Word docs with tracked changes + AI redline (Jump exports flat text, zero authoring); every note line cites a transcript timestamp; a fully-local notes mode exists at all.
**Lift: M.** Risks: local-model note quality below GPT-class (make BYOK the recommended default); template prompts need real advisor-meeting tuning.

---

## 3. Speaker diarization — three stacked tiers, cheapest first

1. **Channel diarization (free, exact):** mic stream = Advisor; loopback stream = Client(s). Zero ML, zero error; fully solves the dominant 1:1/1:couple video review. Jump infers statistically; Keepance gets it from physics.
2. **Within-channel clustering (ML tier):** far-end channel → VAD segments → speaker-embedding ONNX (ECAPA/CAM++-class, ~20 MB) → clustering. **sherpa-onnx ships exactly this pipeline** (segmentation + embedding + clustering) with a C API and Rust bindings — run as a sidecar, matching the existing pattern. Avoid shipping pyannote/Python. whisper.cpp `tinydiarize` = fallback for turn-boundaries only.
3. **Voiceprint naming (killer tier):** after the first meeting the advisor labels "Speaker 2 → Sarah Henderson"; the centroid embedding is stored **locally on the Client Map**. Future meetings auto-name her. Voiceprints are biometric data — a cloud vendor storing them is a BIPA/GDPR liability magnet, which is exactly why **only a local-first product can ship client voice recognition comfortably.** Turns diarization from parity into a headline feature.

**Lift: M** (tier 1 = S, ships with #1; sherpa-onnx = M; voiceprint enrollment +S). Risks: far-end multi-speaker on one line (a couple sharing a laptop) is genuinely hard locally — expect Jump-level (imperfect) accuracy there; easy manual relabel improves stored voiceprints.

---

## 4. Auto follow-up email drafts

Post-meeting workflow step: notes + action items → draft → **push into the advisor's real Outlook/Gmail Drafts folder via the shipped email connector**. User reviews in their own mail client. Voice matching: few-shot on the advisor's own sent mail — **already locally indexed and encrypted**.

**Beats Jump:** drafts from the meeting **plus** the entire local email history **plus** the document pile ("attach the updated IPS we discussed" — it knows the file); voice from the full sent-mail corpus, which never leaves the machine; lands in the advisor's real drafts folder, not a vendor UI.
**Lift: S.** Risk: prompt-injection from transcript content into drafts (sanitization rule already in codebase guidelines).

---

## 5. Task / action-item extraction → CRM

Structured extraction via existing `Provider.structuredOutput` (JSON schema: task, owner, due, client, source-timestamp) → **review checklist UI** → two sinks:
1. **Local task ledger** on the Client Map — works with *no CRM at all* (the stack-light solo, whom Jump serves worst).
2. **Wealthbox tasks API** via the shipped connector — adds a **write scope** (approval-gated, diff-previewed, audit-logged). Redtail/Salesforce follow when vendor creds land.

**Beats Jump:** extraction local/BYOK; works CRM-less; every pushed task human-approved with a visible diff, audit-logged, citing its transcript timestamp.
**Lift: M.** Risks: Wealthbox write-scope approval + API quotas; Redtail/Salesforce vendor-cred-gated.

---

## 6. Calendar integration + pre-meeting prep briefs

- **Calendar sync (the real gap — zero code):** Calendar connector on the existing framework. M365/Gmail **OAuth apps + token plumbing already exist for email** — add `Calendars.Read` / `calendar.readonly` scopes + a Graph/GCal poll. Zero-OAuth fallback: subscribe to an ICS URL. Attendee-email → client matching reuses the unit-tested resolver; Calendly metadata already covers Calendly users.
- **Prep briefs (home turf):** literally what Client Map + Ask + `MeetingPrepAndSuitabilityNotes` were built for. New work is the **trigger**: nightly job reads tomorrow's meetings → runs prep per client → cited .docx brief in each folder + morning digest. In Local-only mode the brief generates on-device overnight.

**Beats Jump:** Jump's brief cites CRM + past meetings; Keepance's cites **the actual document pile** — statements, estate plan PDF, last quarter's emails, the DocuSign'd IPS — which Jump's intake-only document layer cannot synthesize.
**Lift: M** (calendar M on existing OAuth rails; brief trigger S). Risks: Google OAuth verification review for new scopes takes time (start early); recurring-event/timezone edge cases.

---

## 7. Ask-anything over past meetings

Nearly free by design: the RAG source-type allowlist **already includes `transcript` and `meeting`**. Index transcript chunks into LanceDB with speaker/timestamp/client metadata, under existing matter isolation. Citations deep-link to the **audio timestamp** — existing player seeks and plays the moment. Bonus wedge: `sourceProvenance.ts` **already recognizes Jump meeting-note exports** — ship "Import your Jump history" so a switching advisor keeps their past meetings on day one.

**Beats Jump:** answers across **meetings + documents + email in one cited answer**; client-scoped with cryptographic isolation; can run fully local; citations replay audio; literal migration path off Jump.
**Lift: S.** Risk: speaker-turn-aware chunking for retrieval quality.

---

## 8. Compliance controls (retention, attestation, supervision)

- **Retention policy engine:** local rules mirroring Jump's tiers ("delete raw audio after 30 days, keep transcript," "summary-only mode," "keep everything"), deletions audit-logged, policy shown on the Data Map.
- **Attestation:** consent ledger + audit log → one-click **attestation report as a Word doc**. Add hash-chaining to the audit log if absent (tamper-evident).
- **Supervision (firm tier):** reuse E2EE key-grant architecture — CCO gets supervisory access via key grant; periodic supervision export. No new crypto.
- **Books-and-records:** notes are plain .docx in folders — the firm's existing 17a-4 archiving just archives the folder. No vendor export API, no lock-in.

**Beats Jump:** Jump sells retention *promises about their servers*; Keepance sells retention *facts about your machine*. **Honest flag:** no SOC 2 remains a real loss for firm procurement — target the solo/self-CCO buyer first.
**Lift: M.** Risks: retention must be airtight (a "deleted" recording surviving in a temp/chunk cache is a trust-killer); legal review of per-state consent-script defaults.

---

## 9. CRM sync of structured meeting data

Extend #5 into a **post-meeting CRM packet**: note + tasks + detected structured-field updates ("new grandchild / beneficiary change / address move") → **approval screen with per-item diff preview** → push via connector write APIs. v1 = Wealthbox, note + tasks only. v2 = field updates + Redtail/Salesforce as creds land. Every push audit-logged with transcript citation.

**Beats Jump:** same human-approved sync UX, but the transcript that produced the data never left the machine — only advisor-approved structured output touches the CRM. Degrades gracefully to the local ledger for stack-light solos.
**Lift: M.** Risk: field-mapping scope creep — hold v1 at note + tasks.

---

## Sequencing & summary

| # | Feature | Lift | Verdict vs Jump |
|---|---|---|---|
| 1 | Capture engine (loopback + mic, no bot) | **XL** | Beats (no bot, every platform, nothing leaves) |
| 3 | Diarization (channel → clustering → voiceprints) | M | Beats on 1:1 attribution + local voiceprints |
| 2 | Templated notes (.docx, cited) | M | Beats (Word-native, local mode) |
| 7 | Ask over meetings | S | Beats (meetings+docs+email in one answer; Jump import) |
| 4 | Follow-up email drafts | S | Beats (voice from full sent-mail corpus) |
| 5/9 | Tasks + CRM sync | M | Parity-plus (approval + provenance; CRM-optional) |
| 6 | Calendar + prep briefs | M | Beats on brief depth; calendar itself is catch-up |
| 8 | Compliance pack | M | Beats for solo/self-CCO; loses firm procurement (no SOC 2) |

**Build order:** #1 (+tier-1 diarization) → #2 → #7 (days) → #4 → #5 Wealthbox write → #6 calendar → #3 tiers 2–3 → #8/#9 hardening. The first three alone make a demoable "record a Zoom review, get a cited Word note, ask questions about it — no bot, nothing leaving your laptop."

**Genuine hard blockers, restated:** (1) app-must-be-running; (2) mobile/in-person-away-from-laptop is a workaround, not parity; (3) macOS permission friction; (4) far-end multi-speaker diarization ceiling; (5) Wealthbox write scope + Redtail/Salesforce vendor creds; (6) no SOC 2 for firm buyers; (7) this direction conflicts with the competitive report's §7 advice ("do NOT build meeting capture") but is consistent with the 2026-06-29 board decision to compete head-on — and the "never a note-taker identity" rule means it ships as a *feature of the Client Map* (meetings = one more cited source), not the product's identity.
