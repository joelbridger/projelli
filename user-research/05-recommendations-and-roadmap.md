# 05 — Recommendations & roadmap

*Lead synthesis. Buckets: A protect · B improve now · C prototype/test · D research · E defer
· F reject/reconsider. Each entry: problem → evidence (01 IDs + type) → value → fit →
confidence (+why) → scope (S/M/L/?) → dependencies → risks → validation → success signal →
phase. Scope letters are relative engineering size on existing rails (per repo check, 06) —
no time estimates. This is deliberately a small number of coherent bets, not a transcript-
derived feature dump: the three product bets are marked ★.*

---

## A. Protect / preserve (the research says: whatever you do, don't lose these)

**A1. The approval-first, AI-proposes-user-approves constitution.**
Problem: trust. Evidence: E-062 approval-over-log with her stated reason; E-027/E-036/E-038
advisor-eyes gating; E-058 file-write fear (stated-preference but repeated, cross-context;
high confidence). Value: it IS the adoption precondition. Fit: already the product's stated
principle — the strategy and the participant agree here. Keep every new write behind the
gate; never ship a "review the log later" posture. Risk if eroded: total. Success signal:
zero autonomous-write incidents; approval-flow completion without abandonment.

**A2. Local capture (no bot) + citations that open the source.**
Evidence: E-055/E-056 (call-capture awkwardness with Jump's bot; light-seat cost), E-034
(transcript liability → local control matters), citation verification working today (06 #5).
Her accuracy-precondition (E-042) makes verifiable answers non-negotiable. Confidence:
medium-high (the citation UX itself was pitched, not pulled — but verifiability was hers).
Note: citations need DATES to complete the trust story (B1).

**A3. The intake program's ask-once answer registry.**
Evidence: E-014–E-017 — strongest single positive of the session, with her own causal story
(credibility economy, T7). Actual-behavior grounding (she hunts before asking; cringes at
CC'd repeat questions). It's built (on `lp/intake`); protect it through the merge and don't
dilute the "never ask twice" promise. Confidence: high.

**A4. The 3-tab simplicity / not-a-note-taker stance.**
Evidence: negative — she described Jump fatigue (E-039 format breakage battery drain) and an
appetite for ONE place to ask (E-110's consolidation wish, discounted but directionally
real). Nothing in the session asks for more surface area; several moments punish complexity
(E-038 overwhelm). Confidence: medium. Guard the board's simplicity rule as features from
this research land.

---

## B. Improve now (high-confidence, bounded, on existing rails)

**★B1. Dates through retrieval + "latest and greatest" timeline answers with conflict flags.**
*The bet: Lantern becomes the adjudicator of "current, with proof."*
- Problem: scattered truth; scavenger hunts (T1). Evidence: E-066/E-067 (her spec, verbatim),
  E-069, E-104, E-128 — actual-behavior + her final "hugely valuable." Confidence: **high**
  (behavior-grounded, repeated, both parts, minimal leading).
- Value: answers the session's center of gravity; differentiates from Wealthbox search and
  Jump prep. Fit: perfect — extends Ask, no new surface.
- Scope: **M** (RagHit date fields, mail/doc/CRM timestamp plumbing, answer-shaping,
  conflict presentation; 06 #1/#2 — Codex sized the shortest path the same way).
- Dependencies: none external. Risks: answer-length calibration (E-068 — cadence-aware
  windows, not calendar caps); recency ≠ authority (a newer email can be wrong — show, don't
  silently override).
- Validation: seeded-conflict usability probe (07 §5.1). Success: she (and pilot advisors)
  answer "what's current on X" via Ask instead of opening OneDrive/Outlook, and click dates.
- Phase: next release theme (see sequencing).

**★B2. Meeting notes in the firm's template + per-item review with destinations + internal lane.**
*The bet: win the exact standoff Jump lost — "your template, your tasks, your inside scoop."*
- Problem: template lock-in vs detail loss vs CRM re-typing (T4/T2). Evidence: E-032/E-030
  (actual-behavior incl. the incumbent's on-record failure), E-025, E-050–E-052 ("all the
  time" frequency), E-043/E-044 (her review sketch), E-034 (never client-ward). Confidence:
  **high** on the pains; medium on exact artifact shapes (co-authored) — mitigated by
  building the review as composable rather than fixing three artifacts in stone.
- Value: converts the meetings feature from parity to wedge; directly reduces "a lot of
  hands." Fit: strong (capture + approval card + CRM writes exist).
- Scope: **M/L** (firm-template model, audience split, task extraction into the existing
  queue, assignee param; 06 #10–12/#14).
- Dependencies: B3 for assignee/workflow params. Risks: per-firm template ingestion is a
  content problem (start: parse THEIR template from an example doc); internal-lane leakage
  would be catastrophic — hard separation + visual marking (skeptic §5.8).
- Validation: template-fidelity test with real firm templates (07 §5.3), review-flow
  usability (07 §5.2). Success: a pilot firm's advisor accepts generated notes as "ours"
  without edits; ops stops re-typing tasks from notes.
- Phase: next release theme.

**B3. CRM write depth: assignee + workflow targets; Wealthbox workflow/custom-field ingestion.**
- Problem: writes must land in the firm's REAL containers (tasks assigned to Philip; the
  right workflow), and Ask must see workflows/custom fields (process bypass pain,
  E-092/E-093; the relay, E-049). Evidence type: actual-behavior. Confidence: high.
- Scope: **S/M** (extend provider requests + render layer; 06 #4/#14). Dependencies: none.
  Risks: Wealthbox API surface for workflows (verify before promising).
- Validation: live write to a test Wealthbox with assignee. Success: her firm's
  notes→tasks→Philip relay runs through the approval card end-to-end.

**B4. Merge-or-kill decision on `lp/intake`, then pilot intake for real.**
- Problem: the session's most-loved concept (A3) is finished, verified, and sitting on a side
  branch (06 #22). Evidence: E-009/E-013/E-014 + build reality. Confidence: high that
  limbo is waste; the merge itself is a program-management decision (main-line stability
  rules apply — LANTERN-PLUS.md says features reach users only by merging after Jameson's
  go).
- Scope: **S** (decision + merge mechanics) — the code exists. Risks: merge conflicts with
  the July-9/10 mainline work; needs the standard gate.
- Success: one real household onboarded through the private link at a pilot firm.

**B5. Copy/positioning fixes from her exact confusions (with the 2026-07-08 repeats).**
- Problem: language mismatches break comprehension before value lands. Evidence: E-001
  ("practice" reads dental/medical → "firm"), E-002/E-003 ("exported from RightCapital"
  breaks their mental model — REPEAT miss from 07-08; say "reads the files/screenshots you
  already have" / meet data where it is), E-008 (strip law-firm connectors from advisor
  surfaces — Jameson conceded it's a mistake), E-010 ("flagship" jargon), E-005/E-006
  (story-selling "so that…" benefit framing — her suggestion), E-057 ("AI team member /
  historian / bridge" — her framing, validate with strangers before adopting wholesale).
  Confidence: high (these are observed comprehension failures, the cheapest fixes in the
  study). Scope: **S**. Success: next advisor session hits zero of these confusions.

---

## C. Prototype / test next (promising; needs interaction design + validation before betting)

**★C1. The morning triage proposal ("AI coach" over tasks + calendar).**
*The bet-in-waiting: the emotional daily surface — prototype before building.*
- Problem: dumb equal-weight task lists; triage judgment trapped in two heads (T6). Evidence:
  E-119 (pain: actual-behavior, high), E-121/E-122 (her elaboration), provenance caveat
  (concept arrived via pitch; skeptic §4a/§4b). Confidence: **medium** — pain high, solution
  unvalidated, single participant.
- Approach: low-fi prototype (a static "here's your morning" proposal over real-looking
  tasks); test tone (helpful vs shaming — she named the risk and accepted it, E-121), test
  with a process-oriented persona too (Seattle would want different affordances, E-116/E-125).
- Scope if built: **M**. Dependencies: CRM task ingestion (have), calendar (have), capacity
  heuristics (new). Success signal in test: participants reorder their real day after seeing
  it; no one reports feeling judged.

**C2. Scheduling due-list + drafted outreach batch.**
- Problem: the annual cascade (O4). Evidence: E-080–E-086 — actual-behavior, granular, high
  confidence THAT the pain exists at JBW; generality unknown. Why C not B: needs a service-
  tier model design and outreach-draft UX; also compliance-adjacent (client outreach) so the
  draft-only boundary must be visibly right.
- Prototype: run HER fall cycle through a mock due-list + drafts. Scope if built: **M**.
  Success: she approves a batch in minutes and manual Outlook bookings drop.

**C3. Verified-recipient sending + account registry (the "nail biter" killers).**
- Problem: wrong-recipient/wrong-account structural safety (O6). Evidence: E-094/E-095
  (nail-biter, her proposed mechanism), E-076 (real harm story) — actual-behavior/remembered,
  bounded frequency. Confidence: medium-high on severity, low on frequency.
- Prototype: a send-flow mock with client↔accountant links + a mismatch block; an account
  picker that disambiguates two Roths. Scope if built: **S/M** each. Success: ops-persona
  testers choose it over their current email flow for 1099 season.

**C4. Whole-practice Ask exposure + a first read-only practice report.**
- Problem: book-level questions exist in code but are unreachable (06 #7); she asked for an
  engagement-gap report (E-088). Why C: the engagement report crosses a decided boundary
  (06 #6 CONTRADICTED) — prototype it read-only, decide the boundary deliberately (08 D6).
- Scope: **S** (expose scope option) + **S/M** (report). Success: pilot users run a book
  question weekly; the report changes one real outreach decision.

## D. Research next (cannot be answered from this session — see 07 for the full plan)

- **D1. Frequency & generality of T1** (the what's-current question-class) — diary probes.
- **D2. Template lock-in prevalence** — determines whether B2 is a moat or a custom-work trap.
- **D3. The buyer's evaluation** (advisors/owners, not ops) — what Andy/Chris/Jessica-personas
  pay for; nothing in this session prices anything.
- **D4. The Seattle-persona interface needs** — structured/browsable complement to Ask.
- **D5. Privacy's place in the pitch** — permission vs desire (the 07-08 vs 07-10 tension);
  test pitch orders with strangers.
- **D6. Phone-call capture reality across firms** (E-055/E-056) before any telephony work.

## E. Defer (real signal, wrong time or wrong size)

- **E1. Client portal / client to-do lists** (E-113/E-114): thin, comparative, reactive
  evidence; explicit current non-goal (06 #23). Revisit only if intake pilots surface pull.
- **E2. Manager/team-health reports** (E-123/E-124): floated with self-doubt; second-hand
  personas. Ride behind C4's boundary decision.
- **E3. Cash-needs/account-purpose structured model** (E-070–E-079): pains are real
  (earmarks, "which bank is for what", reserve comfort numbers) but the artifact she was
  offered (a map) worried her (staleness E-072) and she hedged ("I don't know if that's worth
  building", E-071). Let O1 answer these questions from live sources first; revisit typed
  records (06 #19) if pilots show demand.
- **E4. Compliance change-impact sweep ("tentacles", E-096/E-097)**: vivid but brief and
  solution-seeded; net-new build (06 #30). One follow-up question in D-interviews first.
- **E5. Quick-capture surface (E-106/E-107)**: her own hedge ("maybe not needed if Ask can
  pull it") is probably right; test after B1 ships.
- **E6. RightCapital write-back** (06 #17): the relay's last hop, but gated on vendor API
  access; keep the planned socket parked until access exists.

## F. Reject / reconsider (evidence argues against, or against our strategy)

- **F1. Full transcript to clients — never.** Active liability fear (E-034/E-035). Also
  implies: internal artifacts must be unmistakably non-client-facing (B2 risk note).
- **F2. Autonomous write-anything.** Violates the verification law (T3); she rejected even
  helpful-sounding auto-flows without a present-human gate (E-036).
- **F3. "Flexible/smarter" client-facing notes as a selling point.** They refused flexibility
  from Jump (E-032); sell fidelity, not flexibility.
- **F4. Word/redline as an advisor headline.** Negative evidence (E-060: barely use Word;
  track changes unknown). Keep the engine (other segments, letters, agreements) but don't
  lead advisor pitches with it. Reconsider per-segment.
- **F5. Replace-Wealthbox positioning or roadmap items.** Her hope (E-110) is
  spouse-invested and contradicted by her own integral-dependence evidence (E-106–E-109,
  E-111 discounted); Jump-becomes-CRM (E-112) is opinion. Coexist-and-write-back is the
  strategy this evidence supports. Revisit only with multi-firm evidence and a deliberate
  strategic decision.
- **F6. Maintained "map" dashboards as the flagship demo.** The map framing was
  interviewer-introduced (skeptic §4a#7); staleness is a named trust cliff (E-072).
  Reconsider as compute-on-view surfaces (B1) — not stored artifacts. NOTE: this cuts at the
  current "living Client Map" flagship language — see 00 §challenged and 08 D2. The Client
  Map's completeness/gap machinery stays valuable as INPUT (e.g. to briefs and B1 answers);
  what changes is presenting a maintained artifact as the headline promise.
- **F7. "Connect 60 things" breadth.** Her "more connections, very cool" (E-007) is a
  credibility/marketing signal, not a usage need — it does not overturn the board's
  anti-breadth stance. Depth on the four systems her day runs through (email, Wealthbox,
  OneDrive, calendar/Calendly) beats breadth.

---

## Dependencies & sequencing

```
B5 (copy)              — immediate, independent
B4 (intake merge)      — decision now; unblocks A3 pilot
B3 (CRM depth)         — precedes B2's routing; small
B1 (dates/timeline)    — the release theme's spine; independent of B2
B2 (meeting outputs)   — after B3; the wedge feature
C1/C2/C3/C4            — prototypes in parallel with B-track, gated by D-research
E/F                    — parked with explicit revisit conditions
```

**Suggested near-term product focus (one sentence):** *Make Lantern the place a small RIA
asks "what's current on this client — with proof?" and the safest, fastest path from a
meeting to their own template, their own tasks, and their own CRM.*

**Proposed next milestone / release theme:** **"The Source of Truth release"** — B1 + B3 +
B2(first slice: firm template + task extraction into the approval card) + B4 merge + B5 copy
— demoed via her own two scenarios (umbrella policy; HSA/benefits) plus one live meeting →
template-notes → approved tasks-in-Wealthbox run. The three ★ bets stay the organizing
priorities; everything else queues behind their validation.
