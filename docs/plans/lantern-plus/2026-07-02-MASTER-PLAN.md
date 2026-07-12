# Lantern-Plus Master Plan — Jump Feature-Parity Program

> **For agentic workers:** This is the PROGRAM-level plan. Each wave below has its own
> detailed implementation plan in this folder. To execute a wave: REQUIRED SUB-SKILL:
> Use superpowers:subagent-driven-development (recommended) with the wave's plan.
> Do NOT execute waves out of order without reading "Sequencing & gates" below.

**Goal:** Bring Lantern (Keepance) to credible sales-deck parity with Jump (jump.ai) for
solo/small-RIA advisors — calendar-triggered prep briefs, CRM write-back, local-first
meeting capture — implemented leaner and more privately than Jump, per the feasibility
assessment at [`feasibility/ASSESSMENT.md`](../../../feasibility/ASSESSMENT.md).

**Architecture (program-level):** No cloud additions. Every feature is a layer on
existing rails: the connector framework (`src-tauri/src/commands/connector/`), the
Workflows template engine, Client Map, Ask/RAG (LanceDB; source types `transcript`/
`meeting` already allowlisted), the local Parakeet/whisper STT sidecar, and the email
connector. Meeting capture is **system-audio loopback + mic on the advisor's machine —
never a meeting bot, never cloud transcription.** Meetings surface as one more cited
source on the Client Map timeline — no fourth tab, per the 2026-06-29 board stance
("never a note-taker").

**Tech stack:** Existing only — Tauri 2 / Rust backend, React 18 + TS strict + Zustand
frontend, LanceDB + fastembed RAG, SQLCipher audit log, `lantern-docx` Word engine,
llama.cpp/Parakeet/Piper sidecars. New allowed deps are named per-wave (e.g. `cpal`/
WASAPI for Wave 3, sherpa-onnx sidecar for Wave 4); nothing else without a plan change.

## Who executes what (model routing)

- **Coordinator/reviewer per wave:** Opus 4.8 · high effort (xhigh only for Wave 3's
  capture-engine and retention-correctness tasks).
- **Implementation subagents:** Sonnet workers for well-specified tasks; Haiku for
  mechanical churn. Opus reviews every diff.
- **Codex:** independent adversarial review before every wave merge
  (`codex-review --base lantern-plus`), plus bounded investigation tasks. One
  cargo-compiling job at a time (shared CARGO_TARGET_DIR; a blocked job exits 144).

## Global constraints (every task in every wave inherits these)

1. **Repo/branch:** work in `~/lantern-plus` on feature branches `lp/<name>` off
   `lantern-plus`; merge back into `lantern-plus` only. NEVER push to `keepance-3.0`;
   NEVER touch `~/keepance`.
2. **Gate before merge:** `npm run gate` (typecheck + i18n + vitest + ESLint + cargo
   tests) green, plus the wave's own acceptance checks. Evidence (command + output)
   required in the PR/merge note — no green claim without it.
3. **No shortcuts on core** (Jameson's standing rule): robust solution over quick fix,
   TDD (see repo skill `.claude/skills/tdd`), real tests.
4. **Locked identifiers:** never rename `matter`/`matter_id`/`Matter` (facade rule).
   User-facing copy says client/household.
5. **Privacy invariants:** no Keepance/Lantern content server; AI calls only
   user-machine → user's provider (or firm zero-retention proxy); **no cloud
   transcription fallback under any circumstances**; keys in OS keychain; new stores
   encrypted at rest like their neighbors (SQLCipher / AES-256-GCM patterns).
6. **UX invariants:** everything lands in the 3-tab IA (Client Map · Ask · Workflows);
   AI proposes → user approves (writes show a diff preview + one Approve); light theme;
   no per-feature settings jungles; no em dashes in user-facing copy. **All UI work is
   governed by [`2026-07-02-UI-INTEGRATION-SPEC.md`](2026-07-02-UI-INTEGRATION-SPEC.md)
   (co-equal with this plan; it wins conflicts with wave-plan UI steps). UI merges
   require its §5 evidence: frontend-design skill on new surfaces, screenshots +
   click-counts in the merge note, screenshots to Jameson via notify-jameson.**
7. **Word-native:** generated artifacts (notes, briefs, attestation reports) are .docx
   via `lantern-docx`, not Markdown, wherever user-facing.
8. **Mergeability discipline:** prefer new modules (`src/features/meetings/`,
   `src-tauri/src/commands/calendar/`, `src-tauri/src/commands/capture/`…); keep
   shared-file diffs minimal; after each wave merges, `git merge origin/keepance-3.0`
   into `lantern-plus` and resolve drift immediately.
9. **No deploy/release from this fork.** Features reach users only by merging to the
   main line after Jameson's explicit go.
10. **No time estimates** in any doc or report — relative sizes only.

## Program status — synced 2026-07-12

This plan's Wave 0-4 scope is landed. The original program was already
feature-complete and Windows-checked; the current merged application tip is
`lp/ux-simplify-v1` at `8105d3c8`.

- **Landed:** Intake W1-W10, including the complete fold and its fixes
  (`f4c66ce8`); the ten-feature post-fold batch (`052ecf5f`); DocuSign signing
  (`698ff0d8`); and the mail re-index repair follow-ups (`63a93502`,
  `92898bdc`).
- **Landed integration lanes:** dated evidence (`871f9e45`), firm meeting
  templates (`cf289dfd`), and reviewed meeting-note delivery (`8105d3c8`).
- **Still pending:** firm relay and Offline Mode. These are not made complete
  by any of the merges above.

The wave descriptions below are the original implementation record. They do
not turn a merged implementation into a production release.

## The waves

| Wave | Plan file | Size | Delivers |
|---|---|---|---|
| 0 | `2026-07-02-wave-0-story-assembly.md` | S | Follow-up email draft-from-note action (incl. real save-to-mailbox-Drafts, which today's code lacks); Jump/Zocks note-import demo polish; "keep your notetaker" recipe docs; vendor API applications checklist |
| 1 | `2026-07-02-wave-1-calendar-auto-prep.md` | M/L | Outlook (Graph) + Google Calendar read-only connectors on the connector framework; attendee→client matching via `matterResolver`; "Today's meetings" strip on Client Map; pre-built "Before you meet" briefs (on-open generation first, scheduled generation second) |
| 2 | `2026-07-02-wave-2-crm-writeback.md` | M/L | Wealthbox write path (notes + tasks) with approval-preview UI, idempotency/duplicate protection, retries, audit-log entries; same command surface ready for Redtail/Salesforce when vendor creds land |
| 3 | `2026-07-02-wave-3-meeting-capture.md` | XL | Local capture engine: WASAPI loopback (Windows) + ScreenCaptureKit sidecar (macOS) + PipeWire (Linux) + mic, crash-durable chunked recording, long-form transcription pipeline on the existing STT sidecar (today capped at 30 s — pipeline is new), two-channel speaker attribution, templated .docx meeting notes with timestamp citations, consent flow + ledger, meeting entries on Client Map timeline, Ask-over-meetings indexing |
| 4 | `2026-07-02-wave-4-depth.md` | M | Within-channel diarization (sherpa-onnx sidecar) + local voiceprint naming; Book view (clients ranked by completeness/staleness); cross-client questions via per-client summary aggregation (never raw cross-matter RAG); retention policy engine + attestation export |

## Sequencing & gates

- **Waves 0 → 1 → 2 in order** (each reuses the last; 1 and 2 may overlap once 1's
  connector scaffolding has merged). Wave 0 also files all pending vendor API
  applications (Redtail key, Salesforce partner app, DocuSign integrator key) —
  paperwork that runs in parallel with everything.
- **Wave 3 gate (amended 2026-07-02 by Jameson):** Wave 3 starts once Waves 0–2 are
  merged and gate-green — no advisor-validation pause. Jameson's decision: ALL waves
  (0–4) are built BEFORE the experience is shown to advisors; the assessment's
  "validate 0–2 with real advisors first" recommendation is explicitly overridden
  (recorded in docs/design/lantern-plus-prototypes/DESIGN-DECISIONS.md). Jameson's
  explicit go to BEGIN program execution at all remains the start trigger.
- **Wave 4 tasks are independent** of each other; any may run after Wave 3's capture
  artifacts exist (Book view + cross-client Ask depend only on Wave 1, and may run
  earlier if idle capacity exists).
- **Per-wave merge ritual:** gate green → Codex adversarial review → fix findings →
  merge to `lantern-plus` → pull `origin/keepance-3.0` → CHANGELOG entry →
  notify-jameson MILESTONE.

## Cross-wave interfaces (the contracts later waves rely on)

- **Meeting artifact model (defined in Wave 3, pre-declared here):** a meeting is a
  folder `Meetings/<ISO-date>-<slug>/` inside the client's workspace area containing
  `audio.(opus|wav)` (unless retention says otherwise), `transcript.json`
  (schema: `{ segments: [{ startMs, endMs, channel: "mic"|"sys", speaker?: string,
  text: string }], meta: { startedAt, durationMs, matterId, consent: {...} } }`), and
  `notes.docx`. RAG indexing uses existing `source_type: "transcript"`.
- **Calendar event → client mapping (Wave 1):** Wave 1 introduces
  `CalendarMatterMapEntry { key, matterId }`, modeled on the Calendly connector's
  `MeetingMatterMapEntry { meetingKey, matterId }` with the same resolver semantics
  (`src/platform/rag/matterResolver.ts` decides; ambiguous → `unassigned`, never
  auto-linked).
- **CRM write commands (Wave 2):** Tauri commands
  `crm_create_note(matter_id, title, body, source_ref, household_key, provider?)` and
  `crm_create_task(matter_id, title, description, due_date?, source_ref,
  household_key, provider?)` — provider-agnostic write layer; Wealthbox first
  implementation. `household_key` is the resolved CRM household id: resolution happens
  on the TS side via the inverse CRM map (Wave 2 Task 8) because the backend does not
  persist the matter map. `provider` is an infrastructure param matching every
  existing crm command. `source_ref` carries provenance (document path or transcript
  timestamp) into the audit log.
- **Draft-to-mailbox (Wave 0):** new Tauri command `mail_save_draft(account_id, to,
  subject, body_html, in_reply_to?)` implemented for Graph (`/me/messages` draft) and
  Gmail (`drafts.create`), returning the provider draft id.

## Standing risks & watch items

- macOS capture permission UX (pre-14.4 rides the Screen Recording permission) —
  Wave 3 plan owns the onboarding copy.
- Google OAuth verification review for calendar scope — Wave 1 files it at task 1,
  not at the end.
- Retention correctness (Wave 3/4): a "deleted" recording surviving in a chunk cache
  is a trust-killer; sweep tests are mandatory, xhigh review.
- Prompt injection from transcript/calendar content into drafts and CRM writes —
  sanitize per the repo security guideline; every wave's plan carries a test for it.
- The public `website/vs/jump.html` page contradicts Wave 3 ("isn't a meeting-notes
  tool") — rewrite is deliberately OUT of this program's scope; flag to the main-line
  effort when Wave 3 merges (positioning is a Jameson call).

## Paper trail

- Feasibility corpus: `feasibility/` (assessment, Jump inventory, 4 design brainstorms,
  Codex readiness + adversarial review).
- Published report: https://jameworld.com/claudereports/r/2026-07-02-keepance-vs-jump-feature-parity-feasibility-assessment.html
- Board stance guarding identity: `docs/strategy/2026-06-29-board-decision-leading-advisor-ai.md`.
