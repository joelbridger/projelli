# Brainstorm — lens: maximum reuse / leanest path (2026-07-02)

Grounded in `keepance-current-map.md`, `~/keepance/docs/reference/CONNECTORS.md`, competitive report §4–7, and `~/keepance/docs/strategy/2026-06-29-connector-access-options-rightcapital-jump.md`.

---

## 1. Already have (or ≥80%) under a different name

| Jump feature | Keepance equivalent | How complete | Real gap |
|---|---|---|---|
| Pre-meeting prep brief | `MeetingPrepAndSuitabilityNotes` template (Workflows) + Client Map per-client summaries/completeness | **~85%** — the brief is cited over docs+email+CRM, *more* source depth than Jump's | Not **auto-triggered by the calendar**. No calendar sync exists; only Calendly metadata |
| Client Profiles ("evergreen") | **Client Map** — per-client home: scoped docs, scoped email, timeline, summaries, completeness scoring | **~90%** | Jump's is meeting/CRM-fed; Keepance's is document/email-fed. Fill = connectors, not new UI |
| Ask-anything AI (cited) | **Ask** — cited RAG (LanceDB + e5-small) over docs+email+connector data | **~90% per-client** | Jump demos **book-level** queries ("which clients over 60 lack a beneficiary?"). Ask is client-scoped *by design*. Cross-client needs a deliberate aggregate layer (Wave 4), not a privacy-boundary bypass |
| Follow-up email drafting | Email connector already does reply-draft/send (Outlook/Gmail/IMAP); Ask can draft | **~75%** | Missing one-click "post-meeting follow-up from this note" template wiring — a template + prompt, not infrastructure |
| Doc intake (Onboard front half) | Viewers + OCR (PDF), xlsx/csv, generic ingester, matter-scoped filing, UNASSIGNED needs-filing state | **~60%** | Structured **field extraction → account-opening forms** does not exist |
| Compliance/admin base | Append-only encrypted audit log, egress indicator, Data Map, SSO/OIDC, E2EE firm tier, information barriers via key denial | **~70% for solos** | No SOC 2, no SCIM, no supervision/attestation workflow, retention controls not configurable features |
| Meeting notes from audio | Local Parakeet/whisper.cpp sidecar (`transcribe_audio`), ad-hoc recorder + waveform editor, `transcript` in RAG allowlist, Zocks connector merged | **~40%** | Dictation is single-utterance: no long-form pipeline, no diarization, no meeting bot. But the primitives all exist |
| Templates | Workflow template engine + marketplace, export to Word/PPT | **100%** — arguably deeper (Word-native output, which Jump lacks) | — |

**Bonus already shipped:** Jump's own output is a recognized source — `src/platform/rag/sourceProvenance.ts` already tags Jump meeting-note exports arriving via Wealthbox/SharePoint with provenance badges + consent gate. "Keep Jump's notes, we read them" works **today**.

## 2. Cheap adapters on the connector framework

- **Calendar sync (Outlook + Google) — cheapest high-value build (S/M).** Massive reuse: M365 OAuth PKCE + refresh already exist twice (`commands/mail/`, `commands/onedrive/`); Gmail OAuth exists; `meeting` source_type allowlisted; Calendly's `MeetingMatterMapEntry` (attendee/name → matter) is the exact mapping shape. New code ≈ one Graph/Google-Calendar fetch loop + `CalendarConnect` UI. This single adapter unlocks the auto-prep-brief — Jump's flagship.
- **CRM write-back (M for Wealthbox, then S each).** Connectors are deliberately read-only today. Needs: new Tauri commands (`crm_create_note`, `crm_create_task`) on the existing authed Wealthbox client, the matter map inverted (matter → householdId — already stored in `CrmMatterMapEntry`), and an approval UI — matching Jump's own "human approves every action" model and Keepance's stated principle. Wealthbox is paste-token, no vendor gate. Redtail/Salesforce reuse the same commands once partner creds arrive (code-complete clients exist).
- **Watched-folder/mailbox ingestion hardening (S).** The strategy doc's "single highest-leverage build serving both RightCapital and Jump" — mostly polish on existing email + OneDrive paths.
- **NOT cheap:** meeting bot (needs cloud runtime — architecturally opposed); anything requiring a Keepance content server.

## 3. The 39-integrations problem — three layers, mostly done

1. **Top-8 real connectors — engineering ~finished; bottleneck is partner paperwork.** Shipped: Email, Wealthbox, OneDrive/SharePoint, Calendly. Code-complete gated: DocuSign, Salesforce, Redtail. Merged gated: Addepar, Box, Jotform, ShareFile, Zocks. Add Calendar and you cover ~90% of what an advisor actually connects. **Action: file all vendor-credential applications (Redtail key, Salesforce partner app, DocuSign integrator key) NOW, in parallel — calendar-time, not eng-time.**
2. **Recognized-exports overlay for the long tail.** Extend the `sourceProvenance.ts` recognizer table to eMoney/MoneyGuidePro/Holistiplan/Orion export PDFs — per-tool S, pure TS. Honestly converts "39 integrations" into "reads the exported output of the tools you already use."
3. **Zapier as consume-side recipes, not a Zapier app.** "Jump note finalized → OneDrive folder / watched mailbox" lands in surfaces Keepance already reads. Ship documentation, zero code. Fallback for firms that already run Zapier, never the hero.

Sales framing (matches 2026-06-29 board stance): *"Four ways in — your email, your files, your CRM, your calendar — and we read the exports of everything else. No 39-toggle integration page to babysit."*

## 4. Deliberate skips / thin v1s (+ sales line for each)

| Jump feature | Call | Minimum credible story |
|---|---|---|
| **Meeting bot** (Zoom/Teams/Meet) | **SKIP forever** | "No bot joins your client calls, and no recording leaves your machine. Record or upload, transcribed on-device — or keep your notetaker: we read Jump's and Zocks' notes automatically." |
| **Grow** (book signals/dashboards) | **Thin v1** (S/M) | A "Book view": clients ranked by Client Map completeness + staleness + last-touch — all already computed. Skip sentiment/held-away signals (Jump's own attach rate is unproven) |
| **Mobile** | **SKIP** (explicitly out of scope) | "Client data stays on your desk, not on a phone in an Uber." Prep briefs can arrive by email (existing send path) |
| **Onboard** (account-opening forms) | **Thin v1** | "New Client Intake" workflow template: drop docs, OCR + extraction → structured Word intake summary. "We organize and extract; we don't file forms with Schwab for you — yet" |
| **SCIM / supervision / attestation** | **Thin v1** (SSO/OIDC exists) | Audit-log export + retention-days setting. "Solo = you're your own CCO, everything local + append-only logged." Avoid firm/enterprise deals early anyway |
| **Agentic "AI Associate"** | **SKIP** | Violates "no autonomous AI operations" — and Jump's own is early-access with no efficacy data. "Our AI proposes; you approve. Same as Jump's, minus the cloud" |

## 5. Build order — waves optimized for demo-able parity soonest

| Wave | What | Lift | Reuse | Parity unlocked |
|---|---|---|---|---|
| **0 — Story assembly** (now) | "Post-meeting follow-up email" template wired to existing draft/send; polish Jump/Zocks-note recognition demo; "keep your notetaker" recipe docs; **file all vendor-credential applications** | **S** | `sourceProvenance.ts`, mail reply-draft, template engine | Follow-up emails ✓, Jump-coexistence ✓ — demo-able in days |
| **1 — Calendar → auto prep brief** | Outlook (Graph) + Google Calendar connectors; "Today's meetings" strip on Client Map pre-running `MeetingPrepAndSuitabilityNotes` per attendee-matched client | **M** | Both OAuth stacks, Calendly matter mapping, `meeting` source_type, existing template | **Jump's flagship** — auto brief — with more source depth |
| **2 — CRM write-back** | Wealthbox note + task creation, approval-gated; Redtail/Salesforce same commands when creds land | **M** (then S each) | `commands/crm/` client + auth, `CrmMatterMapEntry` inverted, audit log | "Meeting → notes + tasks in your CRM," Jump's core loop |
| **3 — Meeting capture v1** | Long-form pipeline on the local STT sidecar: record/upload → transcript → templated note → Wave-0 email + Wave-2 CRM write. Diarization deferred | **L** (the one real new surface) | `transcribe_audio` sidecar, recorder + waveform editor, `transcript` RAG type, templates | In-person/uploaded meeting notes — closes the biggest checkbox, on-device |
| **4 — Book view (thin Grow) + cross-client Ask** | Completeness/staleness dashboard; book-level questions answered by aggregating Client Map **summaries** (not raw cross-matter RAG — preserves matter isolation) | **S/M** | Completeness scoring, summaries, matterStore | "Which clients…?" queries + a Grow-shaped screen |
| **5 — Compliance polish** | Retention setting, audit export, supervision-lite view for firm tier | **S** | Audit log, firm tier, Data Map | Checks admin boxes for firm conversations |

**After Wave 2 (two M-lifts) the sales-deck parity grid is ~full:** prep briefs ✓ (auto), profiles ✓, ask-anything ✓, follow-up email ✓, CRM sync ✓, tasks ✓ (as CRM writes — leaner than a native task system), doc intake ✓ (thin), notetaker ✓ ("bring your own / record locally" until Wave 3) — plus three columns Jump can't fill: local-first/BYOK, Word-native redline, no-CRM-required.

**Honest gaps no wave closes:** live in-call capture with diarization at Jump quality (architecturally off-limits without a cloud runtime), SOC 2, integration *brand* breadth on a logo wall, and distribution — the competitive report is blunt that distribution, not features, is why Jump wins. This plan buys the parity *story* cheaply; it doesn't buy users.
