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
resolved in §D (four added, two deferred/skipped by Jameson's call, 2026-07-02).
**Then an exhaustive triple sweep (§E, same day) surfaced ~40 further items Jump shipped
mostly in Mar–Jun 2026; every one is now dispositioned** — added to a wave, covered/moot
by our architecture, skipped with a story, backlogged, or folded into corrected docs.
Nothing in Jump's public or announced surface is unaccounted for as of 2026-07-02.

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
3. **Dial-in capture from any phone** (Jump: call a Jump number to start capture, even mid-call) — requires cloud telephony we will not build; the speakerphone-at-the-laptop and phone-recording-import bridges are the honest answers. *(Added 2026-07-02, triple sweep.)*

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

## E. 2026-07-02 exhaustive triple-sweep dispositions (Claude census + third-party + Codex)

*Sweep sources: `feasibility/research/claude-census-diff-context.md`, the third-party
sweep (session record), `feasibility/research/codex-jump-completeness-diff.md`. Codex
refuted nothing; all three converged. Inventory corrections applied in
`feasibility/jump-feature-inventory.md` §Addendum. Jameson's calls taken 2026-07-02.*

| Jump item | Disposition |
|---|---|
| Blended updates (CRM field-level, 3-column review) | **ADDED → Wave 2 Task 9c** (Jameson) |
| Verbal-consent auto-detection | **ADDED → Wave 3 Task 13b** (local, additive evidence only) |
| Attendee prefill for in-person capture | **ADDED → Wave 3 Task 13c** |
| Dictation notes | **ADDED → Wave 3 Task 10b** (existing local dictation + this wave's pipeline) |
| Automations builder + custom meeting types | **ADDED (thin) → Wave 3 Task 12c** — meeting-type defaults, taught inline; full rules engine refused |
| Unified Action Items (practice-wide queue) | **PER-CLIENT ONLY → Wave 3 Task 12b** — Jameson explicitly refused a global queue; Book view stays the only cross-client surface |
| Keyword tracking | **ADDED → Wave 4 Task 17d** (local; no dashboards) |
| MCP support (all plans) + Enterprise API access | **Doc-corrected** (weakness #10 retired) + **local MCP server BACKLOGGED** as our answer |
| Smart Forms write-back to planning tools | Doc-corrected (kills old D6 rationale); planning write-back stays **DEFERRED** (no partner APIs held) — see BACKLOG.md |
| Outlook add-in (shipped May 2026) | Doc-corrected; **DEFER** stands (vendor applications pending) — BACKLOG.md |
| Landing pages / Compliant Scheduling stack | **SKIP with story** — no client-facing surface; Calendly + Wave 1 calendar answer scheduling; disclosure-block idea noted for the future booking story |
| Marketing content generator (transcript→LinkedIn) | **SKIP** — off-wedge; advisors' compliance depts distrust auto-social; revisit only on demand |
| Schwab account-opening execution | **SKIP with story** — form-filling/custodian submission remains Jump's realm ("we organize and extract; we don't file with Schwab — yet") |
| Holdings CSV extraction | **SKIP for now** — recognized-exports reads statements already; CSV emission is cheap later if advisors ask |
| E-Comms Supervision | **Moot by architecture** (better): our follow-ups send from the advisor's own inbox → firm archiving already applies. Added to attack surface (#13) |
| Consent-monitoring modes (cloud-analyzed) | Ours ships local (Task 13b); their cloud analysis added to attack surface (#12) |
| Anonymized transcript aggregation for benchmarks | **Attack surface #11** — "your clients' conversations never train anyone's benchmarks" |
| Contacts surface + Household records | **Covered** — the Client Map IS the contact surface; households = the matter/household model |
| Meeting page as modular hub | **Covered** — P6 meeting page (notes/transcript/scrubber/actions) |
| Conversation search | **Covered** — Ask + transcript search (P6) |
| Smart capture-now→event attachment | **Covered** — Wave 3 meeting detection + Wave 1 calendar matching; noted as polish in Task 12's detection flow |
| AI speaker role labeling (Advisor/Client) | **Covered, better** — two-channel truth gives roles from physics (Wave 3), names from voiceprints (Wave 4) |
| Notetaker join-timing / Zoom in-client controls / private-meeting mirroring / host-independent join | **Moot** — bot-management features; Lantern has no bot. (Firm-tier private-meeting visibility variant → BACKLOG.md) |
| Dial-In Join My Call | **Accepted gap** (added to §C) — needs cloud telephony; speakerphone/import bridge is the honest answer |
| Video recording | **SKIP** — audio+transcript is the artifact advisors need; video storage multiplies risk for little advisory value |
| Limited Spanish | **Noted** — our STT sidecar is multilingual-capable (e5/whisper family); not a wave item |
| Prep visuals + presentation export | **BACKLOG** (portfolio-data dependent) |
| Meeting-note PDF export preview | **Covered differently** — notes are real .docx (print/PDF from Word); no build |
| Scorecards/Flash Surveys/Pulse + analysis reports | **SKIP** — inside the deliberately-skipped Grow module |
| Reminders/tickler | **SKIP** — CRM is the task system (BACKLOG.md records the refusal) |
| Redtail embedded AI Associate; HubSpot Deals/Tickets; Karbon/Hubly/Drive/Box/Zapier/Exchange/SharePoint-PDF | **Doc-corrected**; long-tail integration stance unchanged (top connectors + recognized exports) |
| Holistiplan Scenario Analysis in prep | **Doc-corrected**; recognized-exports reads Holistiplan outputs |
| Lite seats / $75 tier / Core-Scale-Ramping / annual discount | **Doc-corrected** (pricing intel; informs our packaging later) |
| Admin usage dashboards, bulk configs, Intune, invite emails, notetaker branding | **SKIP** — enterprise admin surface; revisit with firm tier |
| Mobile depth (Capture Card, widget, mobile booking) | **Accepted gap C1 stands** (no mobile app); phone-recorder bridge + email-delivered briefs remain the answer |
| New verticals (insurance/accounting/asset managers/banks) | **Competitive intel only** — Lantern stays advisor-first (law/tax remain secondary verticals) |
| Smarsh/Global Relay/Hadrius archiving claim | **Unconfirmed** (single source, contradicted by Jump's own directory) — books-and-records answer stays "notes are files; your archiving archives them" |

