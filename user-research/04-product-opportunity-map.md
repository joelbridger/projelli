# 04 — Product opportunity map

*Chains from evidence to validation, keeping NEEDS (problems worth solving) separate from
SOLUTIONS (our current best guesses at responses). Evidence IDs reference 01; themes
reference 02; repo status references 06. Frequency/severity numbers are unknown unless a
quote supplies them — no invented sizing.*

Reading key per opportunity: **Evidence** (ledger IDs + type) → **Need** (solution-free) →
**Opportunity** (outcome) → **Solution directions** (options, not commitments) →
**Assumptions to validate** → **Validation method**.

---

## O1. Answer "what's current?" with dates, sources, and disagreements surfaced  *(T1)*

- **Evidence:** E-066/E-067 (umbrella $1M file vs $2M email; her own answer spec —
  actual-behavior + stated-preference, high confidence); E-069 (HSA/benefits churn); E-104
  (Philip's source-of-truth scavenger hunt); E-019/E-020 (keyword search fails; email
  unsearchable); E-128 ("hugely valuable for our firm" — her final answer); E-068 (answer
  window must fit the question's cadence); E-072 (stale answer = trust collapse).
- **Need:** when a fact may have changed, know the current value and its proof without
  manually cross-checking OneDrive, email, Wealthbox, and transcripts.
- **Opportunity:** become the one place the firm ASKS instead of hunts — the adjudicator of
  "current, with proof."
- **Solution directions:** (a) carry source dates through retrieval and render
  latest-and-greatest answers as short dated timelines with conflict flags ("file dated X
  says $1M; emails dated Y/Z say $2M"); (b) cadence-aware answer windows (pattern questions
  get years; point-facts get latest + one prior); (c) a "what's the latest on…" quick action
  on the client screen. NOT implied: a maintained dashboard of all facts (see D1 in 02).
- **Repo status:** 🟨 rails exist (email+doc+CRM RAG, citations); missing dates-through-RAG +
  conflict presentation (06 #1/#2 — Codex: "one primitive, five needs").
- **Assumptions to validate:** the question-class is frequent even though each instance type
  is rare; other firms share the scatter; dated timelines actually change her behavior
  (vs. double-checking manually anyway).
- **Validation:** usability probe 07 §5.1 (seeded conflict workspace); diary-style frequency
  question in the next interviews; demo-video reaction (she proposed umbrella + HSA as the
  demo herself, E-066/E-069).

## O2. Meeting outputs in the firm's own template, split by audience, routed as tasks  *(T4, T3)*

- **Evidence:** E-032 (married to template; Jump's on-record failure — actual-behavior, high);
  E-030 (Jump's send-to-Wealthbox unused for template reasons — negative evidence on generic
  automation); E-025 (detail slips through cracks "a lot of times"); E-050–E-052 (inside
  scoop "happens all the time"; wants it saved, searchable, never broadcast); E-034/E-035
  (full transcript to client = liability fear); E-043/E-044 (her composable include/exclude
  review sketch — suggestion, hedged); E-026 (numbers data-sheet exists in Jump but needs
  human review).
- **Need:** keep the beloved client-facing format AND stop losing everything that doesn't fit
  it; get meeting outcomes into the CRM without re-typing and without trusting an AI that
  "doesn't know the clients."
- **Opportunity:** win the exact standoff the incumbent has publicly failed at for this firm —
  faithful firm-template notes + template→tasks + an internal color lane.
- **Solution directions:** (a) firm-template rendering as a first-class meeting-note output;
  (b) per-item include/exclude review with destinations (client note / firm note / internal
  lane / Wealthbox task with assignee); (c) an internal-only artifact indexed for meeting
  prep, hard-separated from anything client-facing; (d) optional numbers-extraction sheet
  for the planning handoff. NOT implied: flexible/AI-remixed client notes (they refused that
  from Jump).
- **Repo status:** 🟨 capture+notes+approval-card rails exist; missing firm templates,
  audience split, task extraction into the queue, assignee/workflow routing (06 #10–12, #14).
- **Assumptions:** template rigidity generalizes beyond JBW; the internal/external split is a
  common practice; advisors accept reviewing per-item checkboxes (bandwidth, T3).
- **Validation:** template-fidelity test with 2–3 firms' real templates (07 §5.3 — acceptance
  = "that's ours" without edits); interview question 07 §4.5; prototype the review flow
  (07 §5.2).

## O3. A safe relay: propose → human-who-was-there approves → write, with second-person routing  *(T3, T2)*

- **Evidence:** E-062 (approval-over-log, with her reason — high); E-027/E-036/E-038 (advisor
  eyes required; review overwhelm); E-045 (multi-sign-off idea: "send it to Andy... he can
  approve it" — her words); E-046–E-049 (the actual relay chain and "a lot of hands");
  E-064 (relay cost suppresses proactive care); E-058 (fear of AI overwriting files).
- **Need:** move meeting/inbox facts into systems of record with fewer manual hops, while
  preserving (cheaply) the human-present verification the firm treats as law.
- **Opportunity:** turn the firm's verification culture into product rails — the approval
  queue as the safest, fastest path from "said in a meeting" to "recorded in Wealthbox /
  flagged to planning."
- **Solution directions:** (a) one shared proposal→approval→audit engine for every external
  write (Codex's architecture recommendation, 06 observations); (b) route-to-second-approver
  (advisor approves content; ops executes placement); (c) seconds-scale approval UI (diff
  preview, one Approve); (d) assignee-aware task writes.
- **Repo status:** 🟨 single-user approval card + audited Wealthbox writes exist; 🆕
  second-person routing; missing assignee/workflow params (06 #14/#15/#31).
- **Assumptions:** other firms want routing (JBW's role structure may be idiosyncratic);
  approval volume stays reviewable (T3's bandwidth limit); second-approver flow doesn't feel
  like bureaucracy.
- **Validation:** task-routing usability test (07 §5.4); approval-vs-log question to other
  advisors (07 §4.13).

## O4. Scheduling the yearly meeting cycle: who's due, right link, drafted outreach, batch approve  *(T6, T2)*

- **Evidence:** E-080–E-086 (the full cascade: client list → who hasn't booked → 2 follow-ups
  → escalate; Calendly buffer rules force ~40% manual Outlook booking; whose-link/combined-
  link/service-tier knowledge lives in her head — actual-behavior, the most mechanically
  detailed pain in the session); E-115 (follow-up = "battery drain[er]"); E-084 (her ask:
  "here's all the people who haven't scheduled... do you want me to just send them" with
  checkboxes).
- **Need:** stop hand-running the annual meeting cycle across a client list, Wealthbox,
  Calendly, and Outlook.
- **Opportunity:** absorb a recurring, resented, error-prone ops chore that no incumbent owns
  end-to-end (Wealthbox reports are static; Calendly is rule-bound; Jump doesn't touch it).
- **Solution directions:** (a) per-client service-tier + last-meeting model → "due" list;
  (b) drafted outreach with the correct booking link (advisor, combined, tier-appropriate),
  batch-approved; (c) reminder cascade with escalation to the advisor after N noes. NOT
  implied: auto-sending anything (T3), or becoming the booking engine itself.
- **Repo status:** 🟨 Calendly+calendar read exist; no tier model, due engine, or outreach
  drafts (06 #32).
- **Assumptions:** the cascade generalizes (other stacks may differ); email outreach drafts
  are acceptable to compliance without archiving features; service tiers are legible enough
  to model.
- **Validation:** ops-role interviews (07 §3, §4.7); pilot with her own fall scheduling cycle
  (a natural, bounded real-world test she'd likely accept).

## O5. Ask-once intake and the answer registry, extended toward "never ask a client twice, ever"  *(T7)*

- **Evidence:** E-014–E-017 ("never ask a client the same question twice" — "oh I love that",
  with her own causal story: credibility, the doctor's-office cringe, the CC'd-email cringe);
  E-009 (self-filing documents: unreserved enthusiasm, "human delay" pain); E-013 ("strike
  while the iron's hot" — document detective); E-011 (tracking what's done/not done is a
  pain); E-089 (chasing feels like "bothering people").
- **Need:** collect what's needed from clients without repeated asks, manual tracking, or
  the advisor personally nagging.
- **Opportunity:** intake as the credibility engine — the firm never asks twice, never loses
  what a client already provided, and the chase runs itself (with approval).
- **Solution directions:** (a) ship the built intake program (ask-once registry is its core);
  (b) extend the registry beyond onboarding into everyday asks; (c) reminder nudges drafted
  for approval (client-facing tone = "from the firm," not "from a robot").
- **Repo status:** 🔀 BUILT on `lp/intake` (waves 1–8), not merged to mainline (06 #22/#24).
- **Assumptions:** ask-once resonates with advisors (not just ops); clients actually use the
  link (real-world completion rates unknown); email-fallback covers the low-tech tail.
- **Validation:** merge decision + a real onboarding pilot; completion-rate telemetry
  (privacy-safe, local counts).

## O6. Verified-recipient delivery for sensitive documents  *(T2)*

- **Evidence:** E-094 (1099s with full PII to accountants — "a nail biter for Seattle and I";
  the firm already narrowed the practice out of fear); E-095 (her ask: programmatic
  client↔accountant links "so it couldn't mess up"); E-076 (wrong-Roth error — the same
  wrong-target failure class inside accounts).
- **Need:** make wrong-recipient (and wrong-account) errors structurally impossible, not
  vigilance-dependent.
- **Opportunity:** own the scariest seasonal moment in the ops year with a small, deeply
  trust-aligned feature (it IS the product's privacy story, applied).
- **Solution directions:** (a) verified-contact records (client↔accountant/attorney) with
  send-blocking on mismatch; (b) account-registry disambiguation (last-4, aliases) for
  task/write contexts; (c) optionally, encrypted delivery. NOT implied: building a secure
  portal for accountants (scope trap).
- **Repo status:** 🆕 both (06 #25, #20).
- **Assumptions:** seasonal severity justifies a build (frequency is bounded to tax season);
  accountant-side friction (opening secure links) doesn't kill it.
- **Validation:** interview question 07 §4.8; count last season's near-misses at 2–3 firms.

## O7. Task triage that knows capacity and context ("AI coach")  *(T6)*

- **Evidence:** E-119 (overdue reds, stress, equal-visual-weight: spelling task looks like
  fraud task — actual-behavior pain, high); E-121 (capacity honesty accepted even as
  possibly "shaming": "honestly it would be helpful"); E-122 (triage judgment lives only in
  her and Andy's heads; invisible consult workload); E-120 (resort around upcoming meetings,
  move-money urgency — her elaboration inside his pitch).
- **Need:** decide what to actually do today without personally re-deriving priority from a
  dumb list, and without the judgment bottlenecking on two people.
- **Opportunity:** the emotional daily-active surface — the first thing she'd touch every
  morning if it worked.
- **Solution directions:** (a) a proposal-style morning triage over CRM tasks + calendar
  ("meeting Thursday → these first; realistically 6 of 21 today — move these?"); (b) tone
  designed as helpful-not-scolding, opt-in; (c) manager view later, if ever (weakest
  evidence, E-123/E-124). Requires Wealthbox task ingestion depth Lantern already has, plus
  calendar (has) and capacity heuristics (new).
- **Repo status:** 🆕 as a surface; ingredients exist (06 #4, #8).
- **Assumptions:** provenance caveat is real — the concept arrived via the interviewer's
  pitch; her pain is genuine but the solution is unvalidated; equal-weight-task pain
  generalizes; a coach doesn't become nagware.
- **Validation:** replicate the pain in 3+ interviews unprompted (07 §6); low-fi prototype
  test before any build.

## O8. Quick capture to the CRM in a consistent, searchable form  *(T2, T5)*

- **Evidence:** E-106/E-107 (her brainstorm: "I just got an email... put that into Wealthbox
  for me in a format that is then searchable"; Andy speaking color in; keyword it — hedged:
  "I don't even know if this is needed"); E-108 (six people, six styles — inconsistent
  capture is real); E-021/E-051 (Teams holds color that never lands).
- **Need:** shrink the distance from "I just learned something" to "it's durably recorded
  where the team can find it."
- **Opportunity:** dry up the Teams/memory leak feeding T2.
- **Solution directions:** one capture box (typed or dictated) → standardized CRM-note
  proposal → existing approval card. Dictation rails exist (06 #16).
- **Assumptions:** her hedge is honest — this may be unnecessary if O1 (search over
  everything including Teams-adjacent content) works; capture habit change is real friction.
- **Validation:** ask other ops/advisors how color gets recorded today (07 §4.3); prototype
  only if it recurs.

## O9. "How do we do X here" — the firm process assistant  *(T5)*

- **Evidence:** E-091 (remembering why decisions were made; answering process questions);
  E-092/E-093 (advisors don't know template names → blank tasks → ops rework — actual
  recurring behavior); E-098/E-099 (role reassignment + template changes don't propagate;
  40 open workflows go stale); E-096/E-097 (compliance "tentacles" — rule change → audit
  everything; solution seeded by interviewer).
- **Need:** make the firm's ways-of-working answerable and keep process knowledge from
  living only in ops heads.
- **Opportunity:** extend "knows your clients" to "knows your firm" — sticky, defensible
  context no CRM owns.
- **Solution directions:** (a) firm-knowledge scope in Ask (process docs, Wealthbox workflow
  templates); (b) later: change-impact sweep as a review-marked search. Requires the
  firm-scope data model (06 #29) and Wealthbox workflow ingestion (06 #4).
- **Assumptions:** firms document processes at all (JBW partially does, in Wealthbox
  templates); the need survives outside a firm with JBW's role complexity.
- **Validation:** interview probe; cheap to pilot once firm-scope exists.

## O10. Engagement-gap and practice reports — a product-direction decision, not just a feature  *(T6)*

- **Evidence:** E-088 ("no interaction in such amount of time... would be really great" —
  her own wish, moderate depth); E-124/E-129 (hot-client / fee-mismatch reports — floated
  with explicit uncertainty); E-129 (Wealthbox reports are static and limited).
- **Need:** see the book's attention distribution (who's neglected, who's consuming
  disproportionate resources) without manual assembly.
- **Opportunity/tension:** direct user pull, BUT the needs-discovery doc explicitly scoped
  engagement cadences out as "CRM-shaped" (06 #6 CONTRADICTED). Session evidence reopens the
  question narrowly: a read-only report over already-ingested data is not a cadence/tickler
  engine.
- **Assumptions:** the read-only report satisfies the need without pulling Lantern into CRM
  territory; frequency of use is real (unknown).
- **Validation:** decide the boundary first (08 D6); then interview for pull.

---

## Explicit non-opportunities from this session (see 05 Reject/Reconsider for full list)

- **A maintained cash-needs/account map artifact** — pains route to O1/O8; the artifact shape
  was interviewer-introduced and she flagged staleness herself (E-071/E-072, D1 in 02).
- **Sending full transcripts to clients** — active liability fear (E-034/E-035).
- **A general client portal** — thin comparative interest (E-113/E-114); intake's narrow link
  covers the evidenced slice (06 #23).
- **Word/redline emphasis for THIS segment** — her firm barely uses Word (E-060); the
  filled-template appeal (E-061) was pitch-primed and is really a "don't make me hunt for
  data" wish (O1's job).
- **Autonomous anything** — every write is approval-gated by the verification law (T3).
