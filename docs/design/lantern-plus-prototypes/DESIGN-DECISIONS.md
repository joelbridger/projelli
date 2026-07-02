# Lantern-Plus Design Decisions Log

*The reasoning record behind the design phase. Newest entries at the bottom.
Companion docs: DESIGN-BRIEF.md (what to build), ../../plans/lantern-plus/2026-07-02-UI-INTEGRATION-SPEC.md
(the binding rules), ../lantern-plus-ui-audit/ (ground truth).*

---

## 2026-07-02 — Why a design phase at all

Jameson's call, and the right one: the wave plans had UX guardrails but no unified
design layer — the exact gap that made Jump's UI "a wreck" (features added by
different teams, each individually fine, no coherent whole). Decision: senior-UX
design pass before execution; Jameson as design director reviewing clickable HTML
prototypes (his native medium); approved prototypes become binding acceptance
criteria for the 4.8 execution agents. Prototypes are built from a ground-truth
audit of the real app (25 screenshots + design tokens extracted from
`src/styles/globals.css`) so fit is judgeable, not imagined.

## 2026-07-02 — Prototype coherence fixes (round 0, pre-review)

Fable review of the five built prototypes found: red bullet dots in P2 used the
accent decoratively (the product's rule: red marks state, never decoration) —
changed to neutral navy; two em dashes in sample copy (P2 household fact, P3 note
title) — removed per the copy rule. Lesson encoded for future builders: sample
data reads as copy direction; hold it to copy rules.

## 2026-07-02 — The meetings-placement question (Jameson, review round 1)

**Question:** does meeting capture warrant a fourth top-level tab ("Meetings"
under Ask)? Jameson liked the day-story shape (morning moment → before-you-meet →
draft follow-up) but felt meetings might need a dedicated space, and noted the
north-star mock implied one.

**Analysis (Fable):**
- FOR a fourth tab: advisors think chronologically about their day; "what did I
  record this week / what needs review" had no home in the 3-tab IA; Jump
  switchers will look for a meetings place; room for consent ledger/retention/
  recordings management.
- AGAINST: (1) the 2026-06-29 board stance — notetaking is a feature, NEVER the
  identity — and the left nav IS the identity; a Meetings tab makes Lantern
  architecturally a note-taker on day one. (2) It splits the container: today
  "where is it?" always answers "on the client"; a second container is the first
  step toward Jump's scattered-surfaces failure.
- Options considered: (A) meetings view inside Client Map home (segmented toggle,
  like Wave 4's Book view); (B) fourth global nav tab; (C) per-client Meetings
  tab in the client surface tab row.
- Fable's advice: "give meetings a home, not an identity" — hold three global
  tabs; promote later only if real usage shows advisors living in the meetings
  view (evidence over instinct).

**DECISION (Jameson, 2026-07-02): Option C — meetings get a home IN EACH CLIENT,
as a new tab in the client surface tab row** (Client Map · Documents · Email ·
**Meetings** · Activity). The global nav stays exactly three items. This is the
best of both: a full dedicated management space for meetings, zero identity
cost, zero container split — the client remains the one place everything lives.
The meeting also appears as an Activity timeline entry. Consequences applied:
P6 rebuilt as the per-client tab (A/B comparison variants dropped); Wave 3 plan's
UI mount amended; UI-INTEGRATION-SPEC amended (constitution rule 1 clarified:
"three tabs" = the global Spine; the per-client tab row may grow when the
client-container logic demands it — this is the only sanctioned instance).

## 2026-07-02 — Why the meeting-notes experience wasn't in review round 1 (and the fix)

Jameson asked where the core notetaking flow was. Honest answer recorded: the
PLAN was always built out (Wave 3 — the deepest plan: capture, transcription,
templated notes, consent, retention, Ask integration), but the PROTOTYPE (P6)
was queued last-if-budget-remained under the design-just-in-time policy (Wave 3
was gated on advisor validation of Waves 0–2) — and never got built for round 1.
Miss acknowledged: the story's climax must be on screen when the story is what's
being judged. Fixed: P6 built in full.

## 2026-07-02 — Sequencing override: ALL waves before advisors (Jameson)

**DECISION (Jameson, 2026-07-02):** do NOT show advisors Waves 0–2 first. All
waves (0–4, including Wave 3 meeting capture) are built BEFORE the experience is
shown to advisors. This overrides the feasibility assessment's recommendation
(validate 0–2 with real advisors before the Wave 3 XL bet) — recorded here so
future sessions don't "correct" back to the old sequencing. Wave order 0→1→2→3→4
still holds for technical reasons (each reuses the last). The master plan's
Wave 3 gate is amended accordingly: the advisor-validation precondition is
removed; Jameson's explicit go to BEGIN execution overall remains the start
trigger.

## 2026-07-02 — The story is the spec

Jameson's framing, adopted as design law: these are not five features, they are
one day in an advisor's life (8:55 morning strip → 9:00 before-you-meet →
10:00 record, no bot → 10:45 note + Wealthbox stamp + follow-up draft →
afternoon Ask across meetings and files → review what needs attention on each
client's Meetings tab). Deliverables: a "Day with Lantern" story
flowchart/infographic as the review-set landing page, every moment linking to
its prototype; full mockup coverage of the entire experience (added P7 for the
Wave 4 surfaces) so the whole thing is judgeable end to end before any code.

## 2026-07-02 — Coverage-audit decisions: the last four Jump edge features

After approving the designs, Jameson asked for certainty that nothing Jump has or
announced was missed. The full sweep lives in
`../../plans/lantern-plus/2026-07-02-JUMP-COVERAGE-AUDIT.md`. Six undecided edge
items surfaced; Jameson decided: **add all four buildable ones** — redaction (Wave 4
Task 17b, xhigh: a redacted span must not survive anywhere, including Word
revision history), client-facing agenda export (Wave 1 Task 17b, a rewrite of the
existing brief), compliance summary filed to the CRM (Wave 2 Task 9b, off-by-default
toggle riding the approval card), and firm-enforced note templates (Wave 4 Task 17c,
new Track E — Jameson explicitly overrode Fable's defer recommendation). D5
(client-facing surveys/intake forms) stays skipped; D6 (Outlook add-in, planning-tool
write-back) stays deferred on the existing roadmap. With these, every feature in
Jump's verified inventory is either covered, added, or consciously skipped with a
recorded story — nothing is unaccounted for.

## 2026-07-02 — The exhaustive triple sweep and the last scope calls

Jameson's "make sure Jump doesn't have ANY more features" triggered a three-way
verification (a full help-center census — 168 articles; a third-party-sources sweep;
an independent Codex crawl cross-checking both). ~40 uncaptured items surfaced, mostly
Jump's Mar–Jun 2026 shipping streak; the full disposition table is
`../../plans/lantern-plus/2026-07-02-JUMP-COVERAGE-AUDIT.md` §E. Jameson's three calls:

1. **Adds:** the capture-polish bundle (local verbal-consent detection as additive
   evidence, attendee prefill for in-person capture, dictation voice-notes through the
   meeting pipeline), keyword tracking (local, no dashboards), and field-level blended
   CRM updates pulled into Wave 2 now (3-column existing/new/blended review). The local
   MCP server goes to the backlog as our eventual answer to Jump's MCP support.
2. **Unified action items:** Jameson chose the middle path — a "Needs review" section
   per client (Wave 3 Task 12b), **explicitly refusing a practice-wide queue.** The
   Book view remains the only cross-client attention surface. Recorded so no future
   session resurrects a global inbox as an "obvious improvement."
3. **Automations:** thin version only — meeting-type defaults taught inline (Wave 3
   Task 12c); a rules-engine configuration surface stays refused.

Design-language note for the new pieces: every addition reuses existing vocabulary
(chips for topics, a quiet strip for needs-review, the same approval card for field
updates) — nothing new was invented, per the constitution.

