# Jump Coverage Audit — do we truly have everything Jump has or announced?

*2026-07-02, run at Jameson's request after design approval, before execution.
Source of truth for Jump's side: `feasibility/jump-feature-inventory.md` (built from the
2026-06-28 internal competitive report + the 2026-07-02 adversarially-verified web
research, which includes Jump's most recent announcements: the March 2026 Meet/Grow/
Operate reorg, AI Associate + its Apr–May updates, TaxStatus beta, Wealth.com,
Mobile Assistant acquisition). Our side: the five wave plans + P1–P7 prototypes.*

## Verdict in one line

The core loop — prep → capture → notes → tasks → CRM → follow-up → ask → book view —
is fully covered, usually with a better design than Jump's. Around the edges there are
**four deliberate skips** (documented, with sales stories), **two accepted architectural
gaps** (named honestly), and **six edge items that were not explicitly decided** —
now resolved below (four added, two deferred/skipped by Jameson's call, 2026-07-02).

## A. Covered (equal or better) — no action

| Jump feature | Our answer |
|---|---|
| Meeting capture Zoom/Teams/Meet/Webex/GoTo + phone-through-computer | Wave 3 loopback capture — every platform by construction, no bot |
| In-person capture | Wave 3 conference-room mode (mic + diarization) |
| Audio upload / import | Wave 3 import path (also the phone-recording bridge) |
| Transcription + voice differentiation | Wave 3 two-channel truth + Wave 4 clustering + local voiceprints (beyond Jump) |
| Templated AI notes | Wave 3 default shape + learned-from-edits; Workflows for power shapes; real .docx (Jump: flat text) |
| Notes/tasks/follow-up "within a minute" | Waves 0/2/3 post-meeting pipeline |
| Task extraction with inferred due dates | Wave 2/3 structured extraction (due dates from spoken commitments) |
| Pre-meeting prep briefs | Wave 1 — deeper sources than Jump (the actual file pile) |
| Ask-anything incl. actions-with-approval | Ask + Wave 2 write path + Wave 4 whole-practice scope |
| Unified client profiles | Client Map (cited, curated, completeness-scored) |
| CRM sync Wealthbox/Redtail/Salesforce | Wave 2 write-back (Wealthbox live; Redtail/Salesforce trait-ready, cred-gated) |
| Calendar integration | Wave 1 (Outlook + Google + ICS) |
| Retention controls / audit trail / attestation | Wave 3 consent ledger + Wave 4 retention engine + attestation .docx + append-only audit log |
| Book-level queries | Wave 4 whole-practice Ask (summaries-only isolation) |
| Doc intake (front half) | Existing OCR/ingest + thin "New Client Intake" gap-finding story |

## B. Deliberate skips — decided earlier, standing (each has a sales story)

1. **Meeting bot / host-independent joining** — never; "no bot in the room" IS the positioning.
2. **39-integration marketplace** (13+ CRMs, planning/portfolio long tail) — top connectors done well + recognized-exports overlay + Zapier consume-side recipes.
3. **Grow module** (held-away/referral/sentiment signals, Playbooks, Scorecards, dashboards) — Book view only; revenue surveillance is off the anti-roadmap.
4. **Account-opening form-filling (Operate back half), SCIM, autonomous AI Associate, scheduling** — skipped with stories (intake = gap-finding; SSO exists; approval is the brand; Calendly covers scheduling).

## C. Accepted architectural gaps — named honestly, sold around

1. **Mobile capture apps** (Jump's iOS/Android are real and top-rated) — our bridge: record on any phone app → synced folder → auto-transcribed. Not parity; the desk-based ICP mostly meets at the desk.
2. **Capture when the advisor's machine isn't in the meeting** (closed laptop, absent advisor, web-recorder-only users) — no cloud runtime, no capture. The trade IS the product.

## D. The six undecided edge items — decided by Jameson 2026-07-02

| # | Jump feature | Analysis | Decision (Jameson) |
|---|---|---|---|
| D1 | **Redaction** (compliance settings include redaction) | Fits our compliance pack naturally; a local "redact this passage" action is cheap and strengthens the privacy story. Local-first honesty: redaction = deletion of the span (it must not survive in the docx revision history, the index, or any cache) | **ADDED → Wave 4 Task 17b** (Track D, xhigh review) |
| D2 | **Agenda artifact** (Meet builds meeting agendas) | The brief already exists; an agenda is its client-facing sibling — one more export shape from the same Wave 1 pipeline | **ADDED → Wave 1 Task 17b** |
| D3 | **Compliance logs synced to CRM** | Rides the Wave 2 write path: optional approval-gated compliance-summary note composed from the send receipts (+ consent fields once Wave 3's ledger exists) | **ADDED → Wave 2 Task 9b** |
| D4 | **Firm-enforced note templates** (admin locks note structure across the team) | Fable recommended deferring to the firm tier later; **Jameson overrode the defer** — build it now | **ADDED → Wave 4 Task 17c** (new Track E) |
| D5 | **Pulse & Surveys / client-facing intake forms** (Grow/Operate) | Requires a client-facing surface we don't have and don't want yet; furthest from the wedge | **SKIP** (standing; revisit only on Jameson's word) |
| D6 | **In-inbox email assistant / planning-tool fact write-back** (Outlook add-in; AI-Suggested Fact Updates into eMoney/RightCapital) | Add-ins are already a roadmap item with vendor applications pending; planning write-back has no partner API path today. Wave 0's save-to-real-Drafts is the near answer | **DEFER** (existing roadmap; not in these waves) |

## Execution consequences (applied 2026-07-02)

- Wave 1 plan: Task 17b agenda export (D2) — provider rewrite of the brief with a
  deterministic fallback; second item in the brief strip's export control.
- Wave 2 plan: Task 9b compliance summary to CRM (D3) — off-by-default toggle on the
  review card; the compliance note itself goes back through the approval card.
- Wave 4 plan: Task 17b redaction (D1, xhigh, revision-node byte-scan hard-fail) and
  Task 17c firm note-template policy (D4, new Track E; org payload carries the value;
  enforcement call-sites flagged DEPENDS-WAVE-3 in the gate checklist).
- D5 skipped / D6 deferred — recorded here and in DESIGN-DECISIONS.md; future sessions
  should not treat them as forgotten. They were decided, not missed.
