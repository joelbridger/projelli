# 10 — Path 4 deep dive: Lantern as the system of record ("Replace Wealthbox")

*Requested by Jameson 2026-07-11, following the four-paths report (09). This is the full
build-out of the most aggressive option: what it would actually be, how it would be
designed, what the architecture can and cannot do, what the market looks like right now,
how migration and compliance work, and the gated plan that would take us there — or tell us
to stop. It is an analysis, not a commitment; nothing here is being built.*

*Inputs: the 2026-07-10 session evidence (ledger 01, E-###), the repo gap analysis (06), a
fresh code-level feasibility investigation
(`analysis-drafts/crm-core-feasibility.md`), and fresh market research with dated sources
(summarized in §2; full detail preserved inline). Relative sizes only (S/M/L/XL) — no time
promises.*

---

## 1. What "replace Wealthbox" means, concretely

Lantern becomes the firm's **system of record**: the place client relationships, notes,
tasks, and processes LIVE — not a smart layer beside them. A 6–10 person RIA would cancel
Wealthbox (and Jump), and run the practice on Lantern.

From the research, what her firm actually runs on Wealthbox today — the true replacement
checklist, not a generic CRM feature list:

| What JBW uses | Evidence | Notes |
|---|---|---|
| Contacts + households, "is that my client or Seattle's" | E-085 | Plus relationship/ownership knowledge |
| Notes (meeting notes pushed from Jump; manual notes) | E-003, E-030 | Team notification blasts on important notes (E-021) |
| Pinned notes as permanent memory ("can't disappear") | E-073 | Account-purpose facts, "do not forget" items |
| Tasks: assignees, due dates, recurrence | E-049, E-075 | Tasks double as information storage (E-074) |
| Workflow templates + open workflow instances | E-092/E-093, E-098/E-099 | ~40 open post-meeting workflows at a time; template edits do NOT propagate — their named defect |
| Task/workflow templates advisors can't find/name | E-092 | Causes ad-hoc tasks → ops rework |
| Reports tab (age-65, birthdays — static) | E-129 | She called them "fairly limited" |
| Email view (unsearchable) | E-020 | A known Wealthbox weakness |
| Calendar feature | E-109 region | Exists, unused at JBW |
| Jump → Wealthbox note push (manual approve) | E-029/E-030 | Any replacement must receive or replace this flow |
| Service-tier knowledge (who meets when) | E-085/E-086 | Lives in heads + Wealthbox context today |

Minimum lovable scope for a ≤10-person RIA is therefore: **contacts/households/accounts ·
notes with provenance · tasks (assignee, due, recurring, priority) · workflow templates +
instances with propagation · team notifications/activity · a handful of computed reports ·
Wealthbox migration importer** — all of it multi-user, all of it under the privacy
architecture, plus everything Lantern already is (Ask, meetings, documents, email, intake).

## 2. Market reality check (fresh research, 2026-07-11; sources dated)

The four facts that most change the picture since report 09:

1. **Wealthbox is now PE-armed and building AI into the CRM.** $200M majority investment
   from Sixth Street (June 2025); shipped its own AI Notetaker (fall 2025); launched
   "Agents," "Playbooks," and a conversational AI Assistant in early access (March 2026),
   explicitly pitching the CRM as "a system of action." Pricing: $59/$75/$99 per user/month
   (about $35/$49/$65 with annual billing). *Implication: the incumbent is not standing
   still — it is attacking OUR thesis (AI on your practice data) from the other side.*
2. **Jump says it will NOT become a CRM** (April 2026, on the record) — 35,000+ advisors,
   $80M Series B (Feb 2026), price CUT from $120 to $100/month ($75 small-firm) with
   features unbundled into add-ons. Her prediction that "Jump becomes a full CRM within
   five years" (E-112) is contradicted by Jump's stated strategy — but functionally
   supported by independent analysis: a May 2026 industry piece argues AI notetakers are
   already displacing the CRM as the advisor's **daily interface**, relegating the CRM to a
   passively-updated backup. *Implication: the "own the daily surface" logic (Path 3) is
   the industry's live battleground; the system-of-record title fight is separate.*
3. **The whitespace appears real.** No local-first, self-hosted, or end-to-end-encrypted
   CRM for financial advisors was found (healthcare has "HIPAA-compliant CRM" as a
   category, but cloud-hosted; nothing local-first). Needs one exhaustive confirmation
   pass, but as of this search: nobody sells what Path 4 would be. *Implication: if the
   category ever wants a privacy-native CRM, we would define it.*
4. **Market share context:** Redtail ~26%, Wealthbox ~22% (2025 T3 survey), with Wealthbox
   strongest in exactly our segment (solo/small firms) and climbing; 91% of advisors use a
   CRM and rate it their most valuable software category (2026 T3). Advisor-CRM migrations
   are commonly quoted at 1–2 weeks for basic setups — switching is *possible*, which cuts
   both ways (they could leave Wealthbox; they could also leave us). *Implication: we would
   be attacking the segment leader's home turf, in the software category advisors value
   most — the prize and the difficulty are both maximal.*

Compliance datapoint for later: RIAs keep records under **Advisers Act Rule 204-2** (5
years, first 2 readily accessible). WORM-style immutability is a broker-dealer rule
(17a-4), not an RIA rule, and the SEC accepts audit-trail alternatives there — our
hash-chained audit log is directionally the right shape, **but a compliance attorney must
confirm what a system of record needs before any Path 4 commitment** (see §8).

## 3. Why this path tempts us anyway (the strongest honest case)

- **Her aspiration, plainly stated:** "I've been kind of hoping that you would just replace
  Wealthbox and combine a lot of softwares into one... an assistant, a source of truth,
  amazing searchability" (E-110). One person, spouse-invested — but it names a real dream:
  ONE place.
- **The defects we'd fix are structural, not cosmetic.** Template propagation to open
  workflows (E-098/E-099) cannot be fixed from outside the CRM. Judgment-aware task lists
  (E-119) need to own the task model. Unified search across notes+email+tasks (E-019/E-020)
  is easiest when one system holds them.
- **The economics story writes itself:** JBW-type firms pay Wealthbox ($59–99/user/mo) AND
  Jump ($75–100/mo + add-ons) — with "light seats" rationing (E-056) showing price
  sensitivity. One consolidated, privacy-native bill is a real pitch.
- **The strategic squeeze is real:** as a layer, we depend on Wealthbox's API posture and
  compete with Wealthbox's own AI (now PE-funded). Owning the record is the only position
  that can't be squeezed from below.
- **The whitespace (pending confirmation) is ours alone.**

Report 09's counter-case stands unchanged (one aspirational sentence vs proven inertia;
XL build; all-in-one skepticism; GTM regression) — this report doesn't relitigate it; it
builds the path as if we chose it, with gates that force honesty along the way.

## 4. Design principles for an AI-native, local-first CRM

Everything below flows from the research evidence, not from copying Wealthbox:

1. **Approval-first, always** (T3, E-062): the CRM proposes; a present human approves.
   Writes show diffs; approvals take seconds; there is no "review the log later" posture.
2. **Every fact wears its date and source** (T1, E-067/E-072): the record is a claim with
   provenance, not a bare field. Staleness is visible, never silent.
3. **Tasks carry judgment, not just deadlines** (E-119/E-122): capacity-aware, context-aware
   (meeting proximity, money movement), and honest ("6 of 21 realistic today").
4. **Templates propagate** (E-098/E-099): editing a workflow template offers a reviewed
   update to open instances — the marquee "only we do this" moment.
5. **Two audiences, hard-walled** (T4, E-050): internal color and client-facing content are
   separate lanes everywhere, visually unmistakable.
6. **Ask AND browse** (E-125/E-126): the ask-bar for her persona, structured
   browse/categorize views for the Seattle persona — one data model, two doors.
7. **Information is not a task** (E-074/E-075): pinned facts, account purposes, and
   preferences get first-class homes instead of living as fake to-dos.
8. **The firm's format is sacred** (E-032): note templates, meeting-note formats, and
   report layouts render THEIR way; fidelity over flexibility.
9. **Server-blind by construction:** the relay never reads content. Anything requiring a
   server-side view must be redesigned client-side or explicitly traded off (§6).

## 5. Initial designs (concept level)

### 5.1 Data model (the typed core)

```
Household ──── members ──── Person (client, spouse, dependent, accountant*, attorney*)
   │                            *external parties: verified-recipient links (E-095)
   ├── Account (custodian, type, last4, PURPOSE, ownership)   ← fixes E-076/E-073
   ├── Fact (typed claim: value + source + date + status)     ← the Client Map, promoted
   ├── Note (audience: internal | client-facing; provenance)  ← E-050 lanes
   ├── Task (assignee, due, recurrence, priority, context)    ← CRDT-friendly doc
   ├── WorkflowInstance (steps, owners, progress) ── from ── WorkflowTemplate (versioned)
   └── ServicePolicy (tier, meeting cadence)                  ← E-085/E-086
Firm-level: ProcessDoc / ways-of-working (E-091), Templates, ActivityFeed (append-only)
```

Key design calls: every entity is a **mergeable encrypted document with a stable ID**
(feasibility caveat #2 — CRDT-friendly from day one); all of it lives in the **Rust
SQLCipher store, not browser storage** (feasibility caveat #1 — the matter list and Client
Map live in localStorage today and would need re-homing anyway); the audit log's existing
hash-chained append-only pattern becomes the activity feed's backbone; the locked
`matter_id` facade is preserved (households attach to matters; nothing renames).

### 5.2 The five screens that matter

**Practice Home (the morning surface).** Replaces the dumb red task list (E-119):
```
┌─ Today ────────────────────────────────────────────────┐
│ ▸ Hendersons meet Thu — 3 open items for them first    │
│ ▸ Move-money task (Miller) — needs Andy's approval     │
│ ▸ Realistic today: 6 of 21. Move 4 to next week? [Review]│
│ ─ Approvals waiting (3): note→CRM · task→Philip · email │
└─────────────────────────────────────────────────────────┘
```
Triage is a *proposal* (approve/adjust), tone helpful-not-scolding (E-121), computed live
at open — never a stored "current" artifact (E-072).

**Client record.** One page per household: dated facts with sources (the promoted Client
Map), the unified timeline (meetings, emails, notes, tasks — each entry dated + cited),
internal lane visually separated (amber "internal only" — E-050), accounts with purposes
("Wells Fargo — rentals", E-073/E-077), service tier + next-meeting-due. The ask-bar sits
on top; every answer opens sources in a click.

**Tasks & workflows (the Seattle door).** Structured browse: filters, saved views,
kanban-by-workflow-stage. Workflow templates are versioned; editing one shows *"12 open
instances — review which get the change"* with a checkbox diff per instance (the propagation
marquee, E-098/E-099). Ad-hoc tasks that match a known template trigger *"this looks like a
Money Movement — convert?"* (E-092/E-093, ends the ops re-typing loop).

**Reports (computed, dated, on demand).** "Who hasn't interacted with us in 6 months"
(E-088), "who's consuming the most attention vs fee" (E-124/E-129), birthdays/RMD-style
lists — every report stamped *"computed just now from N sources."* Nothing cached as truth.

**Migration wizard.** §7 — a first-class product surface, not a script.

### 5.3 What stays exactly as it is
Ask, meetings capture + notes, documents/email, intake — Path 4 doesn't reinvent them; it
gives their outputs a home we own. The 3-tab simplicity gains one surface (Practice Home);
the board's "simple AI-first app" identity is preserved by making the CRM invisible-as-a-
category: we never sell "a CRM," we sell "the practice runs here."

## 6. Architecture: what the feasibility investigation found

Full report: `analysis-drafts/crm-core-feasibility.md`. The verdict in brief:

**The privacy architecture is a document-sync relay, not a CRM backend.** It moves and
converges encrypted blobs (Yjs CRDT over an oplog) very well — per-client co-editing,
key distribution, and ACLs are mature. But by design the server can never compute a shared
view. Three hard problems own the risk budget:

1. **Offline notification delivery.** The relay has no notification/inbox surface and can't
   read content to generate one ("you were assigned X"). Options, each a real decision:
   (a) encrypted notification envelopes (server sees only "something for you" + timing
   metadata); (b) client polling (battery/latency costs, no true push); (c) a firm-hosted
   always-on peer that computes and pushes (new deployment burden). **Metadata leakage vs
   liveness is a genuine privacy trade-off Jameson must decide** — it slightly weakens the
   "server knows nothing" story no matter which we pick (except polling).
2. **Server-blind cross-firm queries.** Team task lists and who's-overdue can only be
   computed on a device that has synced the underlying docs. Permanent constraint: every
   member's device syncs the firm's task/activity docs (fine at 6–10 people; this is why
   Path 4 targets small firms and should not chase enterprise).
3. **Workflow propagation as convergent merge.** Applying a template edit to in-flight
   instances being concurrently edited, without clobbering progress — correctness-critical,
   no existing rail. This is the marquee feature AND the hardest correctness problem; it
   gets TDD + adversarial review + the xhigh-effort treatment if ever built.

Per-subsystem build sizes (on top of existing rails): contacts/households/accounts **M** ·
tasks **M** · workflows+propagation **L/XL** · multi-user sync/notifications **L** ·
reports **M** · migration importer **S/M** (60–70% of the Wealthbox fetch layer already
exists). Total remains **XL**, dominated by multi-user liveness and workflow correctness.

**The seed is architecturally sound.** Typed household/account/task records built now (for
Paths 2–3 features) carry forward IF (a) they live in the Rust SQLCipher store from day
one, and (b) tasks/workflow instances are modeled as mergeable documents with stable IDs.
This makes report 09's "hybrid seed" a real Stage 0, not a metaphor.

## 7. Migration (the make-or-break product surface)

What already exists: the Wealthbox read connector fetches contacts, households, notes,
tasks, and events with raw JSON retained and pagination handled — a de facto importer core
(S/M to productize). Missing: workflows and open instances, custom fields, file
attachments, and full historical activity — each needs API verification against Wealthbox's
actual export surface (unknown until tested with a real token).

Migration design (three phases, each independently valuable):
1. **Mirror** (exists today, read-only): Lantern continuously mirrors Wealthbox; all Paths
   2–3 value works in this mode. No commitment.
2. **Parallel run:** Lantern's typed records become editable; every Lantern-side change
   still writes back to Wealthbox through the approval queue. The firm lives in Lantern;
   Wealthbox stays authoritative. **This phase is the honest test of "would they switch"**
   — if a firm won't live here while it's free to retreat, they'll never cut over.
3. **Cutover:** a **fidelity report** (every record type: fetched N, imported N, skipped N
   with reasons — the "nail biter" standard E-094 applied to ourselves), a frozen Wealthbox
   archive export retained for Rule 204-2, and a defined day-one rollback (re-export from
   Lantern back to Wealthbox format). Jump-coexistence: in phases 1–2, Jump's
   Wealthbox-writes still arrive via the mirror; at cutover the firm either drops Jump
   (Lantern meetings replace it) or Jump loses its write target — this must be explicit in
   the pilot agreement.

## 8. Compliance and records (flags, not conclusions)

- A system of record inherits **Advisers Act Rule 204-2** expectations (5-year retention,
  2 years readily accessible). Our retention engine + hash-chained audit log are
  directionally right; "readily accessible" under E2EE (regulator asks the FIRM, the firm
  decrypts and produces) needs a written, counsel-reviewed procedure.
- **Examiner access story:** an SEC exam must never be blocked by our architecture — an
  export-everything-decrypted capability, firm-initiated, becomes a hard requirement
  (pairs naturally with the existing exam-binder concept in the Phase-2 matrix).
- The 07-08 session's lesson binds hardest here: the CCO is the gate. A CRM replacement is
  the heaviest possible compliance ask — the CCO pack, XYPN validation, and an outside
  compliance consultant's written read (Synergy-type) are **prerequisites to selling Path 4
  at all**, not nice-to-haves.
- None of the above is legal advice; a compliance attorney reviews before any gate-3
  commitment (below).

## 9. GTM and pricing implications

- **The pitch:** "Run your practice in one private place. Cancel two bills." Target
  all-in cost between Wealthbox-alone and Wealthbox+Jump (their combined spend today is
  roughly $135–200/user/mo at list) — pricing work is its own project; the point is the
  consolidation headroom is real.
- **The motion changes:** from champion-led tool adoption to firm-wide rip-and-replace —
  longer cycle, CCO-gated, migration-assisted. Small firms only (≤10 seats) — the
  architecture (§6.2) and the sales motion agree on this boundary.
- **Sequencing GTM honestly:** Path 4 is unsellable until Paths 2–3 have produced firms
  that ALREADY live in Lantern daily (the parallel-run phase is the funnel). The wedge
  stays "the AI you're allowed to use, that fits your firm exactly"; the CRM replacement is
  offered only to firms who ask for it or who live in parallel-run happily.
- **Competitive timing:** we'd be racing Wealthbox's own AI roadmap (Agents/Playbooks).
  Their weakness is the cloud: they cannot match "nothing leaves your machine" without
  rebuilding their company. Our whitespace claim (§2.3) is the moat IF the privacy-native
  angle actually drives CRM purchase decisions — unknown, and gate-tested below.

## 10. The gated program (how Path 4 becomes a sequence of small decisions)

**Stage 0 — Seed (S/M; identical to report 09's hybrid; no Path 4 commitment).**
Build Paths 2–3 features on typed records in the Rust SQLCipher store: households/members,
accounts (purpose, last4), ServicePolicy (for scheduling), tasks-as-mergeable-docs (for
triage). Everything is justified by Path 2/3 value alone.
→ **Gate 1 (evidence):** in the 8–12 stranger interviews, does consolidation appetite
appear unprompted in ≥3? Do ≥2 firms volunteer CRM frustration as top-3 pain? If no: seed
stays, path parks.

**Stage 1 — Parallel-run pilot (M on top of seed).**
One pilot firm (JBW is the obvious candidate — with eyes open about its bias) lives in
Lantern daily against the Wealthbox mirror, with write-back. Measure: do they open Lantern
first in the morning? Do they ASK to stop using Wealthbox's UI?
→ **Gate 2 (behavior):** pilot firm requests cutover unprompted, or admits they'd pay to
consolidate. Also required to pass: compliance counsel's written read on 204-2 under E2EE
(§8), and the notification-privacy design decision (§6.1) validated with the pilot's CCO.

**Stage 2 — CRM-core alpha (L/XL).**
Tasks/notifications/reports productized; workflow templates + the propagation engine built
under the xhigh correctness bar; migration wizard phases 1–2 productized.
→ **Gate 3 (fidelity):** a real Wealthbox export migrates with a clean fidelity report;
the pilot runs a full quarter with zero data-loss incidents and zero trust-breaker bugs.

**Stage 3 — Cutover + second firm.**
First real cancellation; then a NON-related second firm repeats it.
→ **Gate 4 (business):** two firms paying a consolidated price ≥ their old Wealthbox
spend, retention through one renewal.

**Standing kill criteria at every gate:** interviews show all-in-one revulsion in our
segment; Wealthbox ships local/E2EE-equivalent posture (unlikely, watch anyway); pilot firm
retreats to Wealthbox during parallel run; migration fidelity can't hit 100% on
records-that-matter; the trust-breaker bug class reappears under the expanded surface.

## 11. Risk register (top ten, with mitigations)

| # | Risk | Mitigation |
|---|---|---|
| 1 | Evidence base stays n=1 aspiration | Gates 1–2 are evidence gates; no build past seed without them |
| 2 | Behavioral inertia (template lock-in ×100) | Parallel-run phase — switching is experienced before it's decided |
| 3 | Multi-user liveness under E2EE underdelivers (notifications, latency) | §6.1 decision made WITH a pilot CCO; small-firm-only boundary; polling fallback |
| 4 | Workflow propagation correctness bug clobbers a firm's live work | xhigh bar, TDD, adversarial review, staged rollout behind flags, instance-level undo |
| 5 | Migration loses data (the E-094 standard, against us) | Fidelity report as a product artifact; frozen archive; rollback path; gate 3 |
| 6 | Surface explosion re-opens the trust-breaker era | Stage separation; each stage hardens before the next; kill criteria include bug-class recurrence |
| 7 | Wealthbox's PE-funded AI closes our differentiation | Watch item at every gate; our moat is privacy-native, theirs is distribution — don't fight on their ground (integrations breadth) |
| 8 | All-in-one skepticism (market-documented) tars the pitch | Never market "all-in-one"; market "one private place" + keep best-of-breed READ integrations working |
| 9 | Compliance/records posture fails counsel review | Gate 2 prerequisite; exam-export capability designed in from seed |
| 10 | Opportunity cost drains Paths 2–3 (the validated work) | Stage 0 IS Paths 2–3; later stages only start after the Source of Truth release ships |

## 12. Honest bottom line

Path 4, built out, is not a single leap — it decomposes into a **seed we should build
anyway** (typed records in the right store, justified by Path 2/3 features), followed by
**three gates that are mostly evidence and behavior, not code**. The fresh market research
sharpened both edges: the whitespace (no privacy-native advisor CRM exists) is more real
than report 09 assumed, and the war (a $200M-backed incumbent building AI into the CRM,
strongest in exactly our segment) is harder than report 09 assumed. The architecture
verdict is "sound but honest": typed records, local encrypted storage, per-client sync and
migration fetch are routine; **multi-user liveness under end-to-end encryption is the
genuinely hard part**, and one privacy trade-off (notifications) lands on Jameson's desk no
matter what.

What I'd need to believe to recommend committing past Stage 0: consolidation appetite from
strangers (gate 1), a pilot firm that won't go back (gate 2), counsel sign-off on records
(gate 2), and a migration fidelity run at 100% (gate 3). Until then, Path 4 stays what the
gates make it: an option we are deliberately keeping cheap to exercise and cheap to
abandon.

*Traceability: session evidence per ledger 01; architecture per
`analysis-drafts/crm-core-feasibility.md` (code-verified paths inside); market facts per
the dated sources in §2 (full research output preserved in the lane report; anything
UNVERIFIED is marked there). Compliance items are flags for counsel, not conclusions.*
