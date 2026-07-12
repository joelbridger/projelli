# 00 — Master spec: coordinator decision record & unification contracts

*Coordinator (Fable 5) decisions settling every contested contract found by the two Codex
review rounds of 2026-07-11 (`reviews/2026-07-11-codex-xdoc-consistency.md`, 20 findings;
`reviews/2026-07-11-codex-sync-attack.md`, ~14 blockers). Reconciliation lanes conform the
numbered design docs to THESE decisions; where a doc disagrees with this file, this file
wins. Cross-references: XD-# = consistency finding, SA = sync-attack.*

## Decisions (binding)

**D1 — Sync topology: per-collection docs, lazily subscribed.** Lane C's per-collection
shape wins (XD-2): firm-wide docs (`crm:tasks` shells, `crm:workflows`, `crm:templates`,
`crm:directory`, time-bucketed `crm:activity:<YYYY-Qn>`) under a synthetic firm-home
matter; one `crm:record` doc per household under its real matter. Lane B's per-entity
streams are struck. SA's load objection is accepted as a requirement, not a rebuttal:
client-record docs are subscribed ON OPEN (plus pinned/recent), never all-80-at-once;
design 03 must carry an explicit load budget table (bootstrap, restart, offline return,
wall change) with numeric ceilings, and 06 tests them.

**D2 — Canonical Task schema (one, everywhere).** `id` (app-minted), `householdRef`
(nullable ⇒ firm task; opaque in shells), `title`, `body` (Y.Text, client-key side),
single `assigneeUserId`, `status ∈ {open, in_progress, blocked, done, cancelled}`, `due`,
`recurrence: RecurrenceRule`, `priority ∈ {high, normal, low}`, `contextRefs: EntityRef[]`,
provenance/dating per D3. Shell/body split per lane C (operational shell in firm doc;
content behind the client key). 02 defines it; 03/05/06 reference it; no local variants.

**D3 — Merge contract: explicit per-field HLC for LWW scalars.** Lane B's explicit
hybrid-logical-clock stamps win over "trust Yjs internal clocks" (XD-4; SA showed
cross-doc semantics need app-level ordering). Prose = Y.Text; collections = add-wins
OR-Set; workflow step progress = per-step-id LWW map. 02 §merge becomes a named, versioned
**Field Merge Contract table** covering EVERY entity field; 03 references it by section
link only. `rev` survives only as the propagation revision mechanism redefined by D4.

**D4 — Propagation: per-instance offer containing per-step decisions, revision-set based.**
Approval unit reconciled (XD-5): the review screen is per-instance (research E-098/E-099),
each offer carrying per-step accept/reject toggles (lane B's granularity) with all-on
defaults and batch approve-all. SA's blockers are accepted wholesale: (a) per-derived-FIELD
source-revision tracking replaces the single `templateFieldsRev` (SA "revision path"
attack); (b) an instance's displayed template version never advances until its required
change-set is fully present; (c) removal-vs-offline-progress races re-run the removal
decision on merge (`detachedFromTemplate` rule); (d) **conditional undo model**: undo
restores only template-derived fields still untouched since the apply, reports the rest;
(e) apply is transactional through the outbox (D5). The 10 properties P1–P10 get restated
under these semantics in 03 §4 and tested one-for-one in 06 Layer 1 (XD-6), plus SA's
interleavings as named regression scenarios.

**D5 — Notifications: sealed envelopes, no persisted sender, eligibility-gated, durable.**
(a) The relay's envelope table stores recipient, timestamps, ciphertext — **no
`sender_seat`** (XD-7; charter decision 3 wins; abuse control via short-lived,
non-persisted rate counters). (b) Eligibility rule (XD-8): client-confidential envelopes
may only be addressed to holders of that client key (relay enforces via existing ACL
knowledge of key grants — it already knows matter membership; this is not new leakage);
firm-operational notices go to all seats; 06's wall test distinguishes the two classes.
(c) SA's delivery blockers accepted: a **durable transactional outbox/inbox** (local
SQLCipher tables, written in the same transaction as the doc mutation; relay delivery
at-least-once with client-side dedupe by `envelope_id`); approval-class notifications are
explicitly crash-survivable end to end. (d) Undecryptable-envelope handling: TTL + dead-
letter marker, never hold-forever.

**D6 — Compaction & retention: retention wins.** No hard deletion before the retention
period (XD-9): checkpoint horizon ≥ retention; archive-before-prune; SA's **chunked,
validated checkpoint protocol** and an explicit **offline-device retirement/rebase rule**
(a device offline past the horizon re-bootstraps from checkpoint; its unsynced local edits
export to a reviewable file, never silently merge). The relay live-sync
missed-update defect SA found in the EXISTING code gets a named fix task in the build plan
— it is a pre-existing bug, fixed on this fork regardless.

**D7 — Synthetic data only, everywhere.** 05/06 language authorizing "real or sandbox"
workspaces and "real 229-contact export" fixtures is struck (XD-13). Fixtures = Northcrest
+ synthetic Wealthbox-API simulator corpus, formally labeled fabricated.

**D8 — Migration landing pipeline (the only idempotency rule).** raw HTTP response
(verbatim, new capture layer) → typed source record → Lantern entity/CRDT mutation →
`external_refs` projection (XD-10). Every imported entity carries `rawRecordRef` into an
immutable import-batch **archive manifest** (XD-12). Multi-household notes: ONE note, many
`householdLinks` (composite external ref; confidentiality = intersection rule) (XD-11).
ONE fidelity matrix (05 §3 owns it; 06 adopts by reference): source type → target entity →
fixture source → required completeness → allowed skip reasons (XD-18).

**D9 — Feature homes (XD-14/15/16/17), settled:**
- Contact roles ≠ household member roles: `Person.roles[]` + `HouseholdMember.role`.
- Note mentions + notify state: `Note.mentions[]` + ActivityEvent; "notify everybody" =
  firm-operational envelope class.
- Search index: local SQL FTS over decrypted store — never synced, rebuilt per device.
- Triage inputs (capacity/meeting-proximity): COMPUTED at view time, never stored as
  synced truth; a local `TriageSnapshot` cache may exist per device.
- Scheduled workflows: `WorkflowTemplate.schedule`; branching outcomes: `StepDef.outcomes`;
  step comments: per-step Y.Text `stepNotes`.
- AI-proposed workflow launches: `ProposalRecord` (extends the approval-queue pattern).
- Pipelines: first-class `PipelineDef` + `StageDef` + stage-trigger rules; `Opportunity`
  stays an entity (XD-15). Imported Wealthbox Projects: preserved as read-only legacy
  records + optional manual conversion to workflows — never auto-converted.
- Calendar/email/files: EXISTING subsystems own them (calendar connector, mail store,
  documents); CRM links via `EntityRef` only; no second event/email entity (XD-16).
  **BCC-dropbox capture: client-side alternative** — the advisor uses a dedicated
  folder or label in their already-connected mailbox. The app checks it locally,
  suggests a client, and files only after the advisor approves; no plaintext email
  reaches a server.
- Users/Teams/permissions: existing firm-admin rails own identity/roles; 02 gets a small
  `FirmDirectoryEntry` read-model + import mapping table; no new permission entities
  (XD-17).
- DocuSign tracking, activity reactions, CSV/vCard import jobs: v1 exclusions, documented
  in 01 with reasons (DocuSign = existing connector's job; reactions = deferred; imports =
  migration wizard covers Wealthbox, generic CSV import deferred).
- Layer-1 test contract mismatches (XD-19): 06 conforms to 02's actual field requirements
  and enumerates every EntityKind.

**D10 — Doc hygiene:** all `[DM-fields]`/"not landed yet" placeholders replaced with real
section links (XD-20); every doc states "conforms to 00-master-spec decisions D1–D10" in
its header after reconciliation.

**D11 — Top-level IA: the CRM gets a dedicated "Home" tab, and it's the landing surface
(JAMESON'S DECISION, 2026-07-11).** Three top-level spaces: **Home · Clients · Ask**.
Home opens on launch and contains the whole CRM operating space: Today (morning triage,
approvals queue, activity), Tasks (list/board/saved views), Workflows (templates,
instances, propagation review), Pipeline, Reports (computed on demand), and Firm
(directory, service tiers, fields & tags, migration, retention). The Workflows top-level
tab is absorbed into Home; "Client Map" as a tab name becomes **Clients** (directory +
household records: facts, accounts, timeline, documents, email, meetings). "Practice" was
rejected as the tab name per research E-001 (reads dental/medical). Lane D's original
woven IA (Practice Home inside Client Map; ops inside Workflows tab) is superseded —
design/04 must be amended to this structure throughout (routes, wireframe headers,
navigation references).

## Reconciliation lanes (all Codex terra high; one doc per lane)

| Lane | Doc | Work |
|---|---|---|
| R1 | 03-sync-and-notifications | Rewrite to absorb D1/D3/D4/D5/D6 + EVERY sync-attack finding (fix or explicitly accept-with-reason); add the load-budget table; restate P1–P10 |
| R2 | 02-data-model | Conform to D1–D5, D8, D9: topology, canonical Task, Field Merge Contract table, new entities (PipelineDef/StageDef, ProposalRecord, FirmDirectoryEntry, householdLinks, rawRecordRef, archive manifest) |
| R3 | 05-migration-importer | D7/D8: landing pipeline, raw-capture layer, archive manifest, fidelity matrix (canonical), synthetic-only language |
| R4 | 06-test-campaign | D4 (P1–P10 one-for-one + SA regression scenarios), D5 wall-test split, D1 load-budget tests, D7, XD-19 conformance, fidelity matrix by reference |
| R5 | 01-wealthbox-feature-matrix | Record the D9 exclusions/decisions as verdict updates with reasons |

04-screens (lane D, in flight) reconciles in a follow-up pass once landed. After R1–R5:
review round 2 (fresh Codex cross-doc + a second sync attack on the rewritten 03) →
SPEC-FREEZE.md.

## Round-2 adjudication (binding, 2026-07-11)

*Round-2 reviews: `reviews/2026-07-11-codex-xdoc-round2.md` (XD2-1..14, 5 blockers),
`reviews/2026-07-11-codex-sync-attack-round2.md` (SA2-1..10, 4 blockers + closure audit),
`reviews/2026-07-11-codex-screens-round2.md` (SC-1..22, 6 blockers). Every finding is
adjudicated below; the R8–R12 lanes implement these rulings. Where a ruling and a doc
disagree, the ruling wins.*

**D12 — 03's reconciled model is canonical for topology + propagation mechanics; 02
converts.** (XD2-1, XD2-2, SA2-3, SA2-10, sync closure PARTIALs.) The firm matter is
`firm_home` (no `__firm__` anywhere); confidential task text lives in per-household
`crm:task-notes` docs. 02 replaces numeric `rev`/`displayedTemplateRev`/`derivedFieldRevs`
with 03 §4's immutable revision IDs + revision-set state; completion (`completedAt/By`)
becomes append-only completion operations with derived display, NOT LWW fields; the full
HLC issuance + 5-minute clamp algorithm (incl. no-prior-observation + quarantine rules)
moves INTO 02's Field Merge Contract, 03 referencing it; the untouched-step status is the
named contract constant `UNTOUCHED = 'todo'` (03 stops writing `open`).

**D13 — External-reference identity.** (XD2-3.) One canonical key:
`(provider, sourceType, sourceId, scope)` — 02's `external_refs` table adopts it verbatim;
05/06 idempotency language references 02.

**D14 — Fidelity-matrix targets must be real 02 entities.** (XD2-4, SC-16.) 02 gains a
read-only **LegacyProject** entity (per D9's "preserved as read-only legacy records", with
storage/merge/import shape + a manual "start a workflow from this" action); matrix rows for
Organization/Trust normalize to 02's `Person.personType` naming; imported events target
`ActivityEvent` timeline records, as 02 already states.

**D15 — Relay delivery is at-least-once; duplicates are normal.** (SA2-1.) 03 §0.1 adopts
the exact triage: `cursor <= durable` → verify same immutable row identity, ignore;
`== durable+1` → authenticate/apply+persist in one transaction; `> durable+1` → bounded gap
repair. CRDT apply + cursor persistence are idempotent by relay cursor/blob id. No doc may
assume exactly-once or gap-free ordering.

**D16 — Approval-class envelopes are TTL-exempt.** (SA2-2.) They persist until the
underlying approval reaches a terminal state AND every active recipient device has durably
acked (device-retirement per D6 bounds "active"); informational envelopes keep the 7-day
TTL + dead-letter. The "crash-survivable end to end" promise stands, now actually earned.

**D17 — Checkpoint validation = independent reconstruction.** (SA2-4.) A validator loads
the prior validated checkpoint, replays every contiguous retained raw row through frontier
F, and compares state vector + canonical state hash to the manifest; only matching SIGNED
validation receipts count toward the two-validator rule. The relay holds minimal plaintext
checkpoint control metadata (stream, generation, frontier, retention eligibility, receipts).

**D18 — Cross-outbox ordering.** (SA2-5.) An envelope referencing a document operation may
not dispatch until the relay has durably accepted that operation (by immutable
operation/blob id); recipients hold early envelopes in "waiting for referenced state".

**D19 — Load-budget consistency.** (SA2-6, XD2-5.) One chunk ceiling: 768 KiB ciphertext.
03 §1.3 gains a total bootstrap allocation across firm docs + client records + task-notes +
checkpoints + tails that provably sums within the 64 MiB ceiling; `crm:task-notes` is
counted in subscription/transfer budgets. 06's convergence assertions compare only the
authorized + subscribed document set, with separate assertions that unsubscribed/walled
content is ABSENT (never "all seats byte-identical").

**D20 — Notification scoping.** (SA2-7.) Every notification sequence, cursor, inbox query,
ack, idempotency key, and device-retirement decision is scoped by `org_id`.

**D21 — Propagation decision ledger + deterministic targets.** (SA2-8, SA2-9.) Persist an
immutable decision ledger keyed `(instanceId, revisionId, stepId, field)` with
accepted/rejected + source operation + superseded/re-offered state; a rejection persists
until a DESCENDANT revision changes the same field, which re-offers it. Apply targets are
a deterministic closure: topological order over the revision graph with same-field
collisions resolved by the D3 HLC/operation-id rule; unresolved concurrent heads surface as
an explicit review state in the offer, never a silent pick.

**D22 — ProposalRecord generalizes (AI-first, robustly).** (SC-2.) 02 §1.15 extends
`ProposalRecord` with `kind ∈ {workflow_launch, task_create, fact_add,
communication_draft}` — one durable contract, approval semantics per 03 §2.3, so Ask's
ProposalCards are real records, not UI fictions. (Board stance: AI proposes → user
approves is the product; it gets a first-class contract.)

**D23 — Feature-home rulings.** (XD2-9, SC-14/15/17/19/20/21/22.)
- Pipeline configuration gets a real settings surface in 04 (create/edit/order pipelines +
  stages + `StageTriggerRule`); entities already exist in 02.
- Template editor gains `WorkflowTemplate.schedule` + `StepDef.outcomes` editors in 04.
- Scheduling links: `ServicePolicy.schedulingLinkUrl` (plain field in 02); Firm setup +
  household scheduling actions expose it. The Calendly integration itself stays owned by
  the existing connector (D9 pattern).
- Responsive intake links: 04 designs the full flow (link creation, public responsive form,
  submission → matching/review route) per charter pre-made decision 5.
- Archive/rollback export: explicit user actions + readiness/status screens in 04 §11.
- Custom-field VALUES get contextual editors on Household/Person/Account/Task records;
  `FirmDoc` gets a minimal list + open-in-existing-editor surface.
- Note editor in 04 exposes pin, @mentions (02 `Note.mentions`), and explicit notification
  review.
- **v1 exclusions (01 verdicts updated with reasons):** activity comments (deferred with
  reactions per D9); "Contact Actions in Opportunity Workflows" bulk actions; file storage
  on records (existing documents subsystem owns files, linked via `contextRefs` — no new
  attachment entity).

**D24 — Task surface truth.** (XD2-10, SC-3.) Single `assigneeUserId` everywhere ("assignee",
singular, in UI); NO task comments in v1 (the D2 `body` Y.Text is the notes surface);
workflow linkage renders from `contextRefs`. 02 fixes the `notes` index to
`anchor_household_id` (XD2-12). 06 adds `importArchiveManifest` to the EntityKind catalog
and conforms Fact-provenance assertions to 02's `0..n` sources (XD2-11).

**D25 — Screens conform to sync/notification truth.** (SC-4/6/7/8/9/12/13/18, XD2-6/7/8,
SC-5/10/11.) Client-facing notes are local records with an audience lane — outbound email
goes through the existing mail surface + external approval (never "send" on a Note).
Propagation review = ONE offer per instance with per-step/field toggles (all-on defaults,
approve-all), revision-set labels (no `v7 → v8` integers), completed steps NEVER mutated by
propagation (owner-role changes affect future routing; a separate new assignment may be
offered), undo = the D4 conditional compensating operation (auto-restores untouched cells,
REPORTS the protected rest — no compare/decide dialog for protected cells). Freshness
states: Live / Syncing (visible lower-bound wording) / Last synced / Offline. Notification
UI discloses the real relay metadata (recipient, timestamps, size band, delivery/ack
timing, opaque ids) and ordinary read/unread is LOCAL device state. Firm setup is a shell
over existing admin rails (`FirmDirectoryEntry` stays display-only). The Email Dropbox
surface uses the D9 client-side flow, not server-side capture. Migration UI gains the two mandatory fallback
surfaces (in-flight-workflow operator checklist + per-client attachment exported-or-gap
accounting), the parallel-run "mirror" is limited to readable templates + activity traces,
and 06's Day-1 corpus + envelope-revocation tests conform (XD2-6/7).

**Hygiene (D10 continues):** 04 header states conformance to D1–D11 (not D11 alone); stale
"not landed / still being written" cross-references in 05/06 removed; "Practice"-family UI
labels replaced with firm/Home wording (SC-1, XD2-14); the stray `DONE-EXIT` sentinel at
the end of 04 is deleted.

## Round-2 reconciliation lanes (all Codex terra high; one doc per lane)

| Lane | Doc | Work |
|---|---|---|
| R8 | 02-data-model | D12 conversion (topology names, revision graph, append-only completion, HLC clamp into Field Merge Contract), D13 key, D14 LegacyProject + naming, D22 ProposalRecord kinds, D23 ServicePolicy.schedulingLinkUrl, D24 index fix |
| R9 | 03-sync-and-notifications | D15 duplicate triage, D16 approval TTL exemption, D17 checkpoint validation, D18 cross-outbox ordering, D19 budget table repair, D20 org scoping, D21 decision ledger + deterministic targets; reference (never restate) 02's merge contract |
| R10 | 04-screens-end-to-end | D23 new surfaces, D24 task truth, D25 whole-cloth conformance (propagation UI, migration fallbacks, freshness, notifications, firm setup, BCC removal), hygiene |
| R11 | 06-test-campaign | D19 scoped convergence tests, D24 EntityKind + provenance, XD2-6 envelope test, XD2-7 Day-1 corpus, revision-set language, Home naming |
| R12 | 01-wealthbox-feature-matrix | D23 v1-exclusion verdicts + scheduling-link/intake homes recorded; XD2-7 BCC verdict cross-check |

After R8–R12: round-3 closure review (one adversarial Codex pass verifying every XD2/SA2/SC
finding closed + no new contradictions) → SPEC-FREEZE.md.

## Round-3 adjudication (binding, 2026-07-11)

*Round-3 reports: `reviews/2026-07-11-codex-round3-closure.md` (41/46 closed; remainders
XD2-3/4/11/13, SA2-7) and `reviews/2026-07-11-codex-round3-freshdrift.md` (FD-1..14).
Lanes R13 (02) and R14 (01/03/04/05/06) implement these rulings.*

**D26 — Fresh-drift rulings (all bindings, tersely):**
- FD-1: 02 adds `WorkflowStepProgress.origin: template|local` and
  `removalRequestedBy: OR-Set<revisionId>` with merge rules + SQL projection (03's removal
  reconciliation needs them).
- FD-2: canonical name is **`assigneeUserId`** everywhere (02 renames step-progress
  `assigneeId`); 02 adds append-only **`assignmentOperations`** (mirror of completion
  operations) — P10's reassign-after-complete and 03's "assignment history" hang off it.
- FD-3: 02 defines **`HouseholdDirectoryShell`** (opaque household ref + operational
  status only; non-identifying per wall rules) as the `crm:directory` content.
- FD-4: prose field name is `completedBy` (03/06); `completed_by` is SQL-only.
- FD-5: 02 adds **`IntakeLink`** + **`IntakeSubmission`** entities (scoped fields,
  audience-lane payload, matching-decision mutation) backing 04 §14.
- FD-6: 02 adds `Task.customFields: CustomFieldValueMap` + merge row.
- FD-7: 02 adds durable local migration-operation records: **`MigrationChecklistItem`**
  (in-flight workflow re-creation decision), **`AttachmentAccountingRecord`**
  (exported-or-gap), **`ExportJob`** (archive/rollback export status). Local SQLCipher
  tables on the operator device, projected into the fidelity report and captured in the
  immutable archive — NOT synced CRDT docs.
- FD-8: 02 adds immutable `TemplateRevision.label` (human-readable update label).
- FD-9: `ProposalRecord.householdRef` becomes nullable; null = firm-scope proposal
  (firm-operational approval routing).
- FD-10: 02 adds `LegacyProject.anchorHouseholdId?`; unlinked imports anchor to the
  `firm_home` operational doc, flagged `unlinked`, visible in the Legacy Projects view.
- FD-11: `RawArchiveEntry` extends with capture-layer version, fixture identity, typed
  outcome, target `EntityRef`/skip reason, and the resulting `external_refs` projection.
- FD-12: 06 adds `legacyProject` to the EntityKind catalog; Task test scripts use only
  canonical Task fields (`assigneeUserId`, `body` — no "checklist item").
- FD-13: fix the three broken anchors (01→05 §2.1, 04→03 §2.3, 06→02 §1.18).
- FD-14: 03 drops the "`rev` is reserved" sentence — no `rev` field exists; propagation
  uses immutable `revisionId` values and revision sets.
- Closure remainders: 06 §1.4 idempotency test requires the canonical
  `(provider, sourceType, sourceId, scope)` key by 02 link (XD2-3); 05 §3.2 matrix targets
  renamed to `Person.personType` / `ActivityEvent` / `LegacyProject` (XD2-4); 06 §1.1
  anchor → 02 §1.18 (XD2-11); 05 intro's "02 had not landed / conceptual names" wording
  removed (XD2-13); 02's `crm_outbox`/`crm_inbox` tables gain `org_id` scope (SA2-7).

## Build-lane map (the one-shot build wave)

*Authored 2026-07-11 by the coordinator per the charter's lane-table stub. Builders are
Codex (gpt-5.6-terra, high), one isolated worktree per lane (`crm-b<N>-<name>`), branch
`crm/b<N>-<name>`. Every lane builds against the FROZEN spec sections named as its
contract — a lane needing a contract change STOPS and escalates to the coordinator; no
lane edits another lane's files; shared TypeScript types land in B1 first. The coordinator
reviews every diff and is the only merger. No design-build-test loops: lanes do not pause
for user testing; the 06 campaign runs after the whole wave lands.*

| Lane | Subsystem | Contract (frozen sections) | Stack | Waits for (merge, not start) |
|---|---|---|---|---|
| B1 `crm-store` | Local CRM store: SQLCipher schema, entities + projections, HLC persistence + clamp, decision ledger, completion/assignment operations, org-scoped outbox/inbox tables, FTS, shared TS types | 02 all (esp. §§1–3) | Rust + TS types | — |
| B2 `relay` | Relay: org-scoped sealed-envelope tables + API (terminal-notice retention, acks, idempotency), checkpoint control metadata + archive-before-prune, multiplexed doc-subscription upgrades | 03 §§0 (relay side), 2, 6.1 | TS (`backend/`) | — |
| B3 `sync-engine` | Client sync core: one multiplexed socket, durable cursors, D15 duplicate triage + gap repair, epoch reseal/quarantine, doc router + D19 load ceilings, `firm_home` provisioning | 03 §§0–1 | TS (`src/platform/firm/`) | B1, B2 |
| B4 `notify` | Notification client: seal/unseal + padding/batching, transactional outbox/inbox, D18 client-side ordering, key hints, dead letters, approval-class retention | 03 §2 (client side) | TS | B1, B2 |
| B5 `propagation` | Template-propagation engine: revision graph, per-instance offers, decision ledger, deterministic target closure, removal reconciliation, conditional undo | 02 §2.4 + 03 §4 | TS | B1, B3 |
| B6 `ui-home` | Home spaces: Today, Tasks, Workflows + Propagation Review, Pipeline + settings, Reports, Firm (migration UI, fields/tags, intake links, firm setup shell) | 04 §§1–2, 5–13, 15 | React | B1 (types), B5 (offer shapes) |
| B7 `ui-clients` | Clients spaces: directory, household record, people/external parties, note editor, custom-field/tag editors, Ask/ProposalCard surfaces, intake review | 04 §§3–4, 14 | React | B1 (types) |
| B8 `importer` | Migration: new endpoint coverage, landing pipeline + raw capture + archive manifest, fidelity engine/report, guided fallbacks (2.5a/2.5b), parallel-run write-back, rollback/export jobs | 05 all + 04 §11 shapes | Rust + TS | B1 |
| B9 `retention` | Client checkpoints: chunked signed checkpoints, replay validation + receipts, offline-device retirement/rebase | 03 §6 (client side) | TS | B2, B3 |
| B10 `test-campaign` | 06 implementation: Layer-1 gate additions (P1–P10, merge properties, duplicate/TTL/replay tests), Layer-2 multi-user sim extension, fidelity gate wiring | 06 all | TS | all contracts (tests target the frozen spec) |

**Merge order (coordinator executes):** (B1 ∥ B2) → (B3 ∥ B4) → (B5 ∥ B8) → (B6 ∥ B7) →
B9 → B10 → full gate on the merged wave → THEN the 06 campaign executes (Layers 1–5,
Northcrest drive-through on the Legion bench) and its bug list drives the fix phase.

**Discipline:** ONE cargo compile server-wide — B1 and B8 are the Rust lanes; the
coordinator sequences their gates (and posts compile windows to
`~/lantern-coordination/BOARD.md`). All lanes may START immediately at freeze (contracts
are frozen text); the "waits for" column gates MERGE, not start — lanes stub against
frozen type contracts. Every lane ships tests for its own scope with the build (TDD per
repo convention); what it may NOT do is pause the wave to user-test. Liveness: every lane
is watched; a lane silent past the liveness bar is killed and relaunched smaller.

## Status
- 2026-07-11: D1–D10 recorded; R1–R5 dispatching. Round-2 review + freeze pending.
- 2026-07-11 (later): Round-2 reviews complete (15 blockers total); D12–D25 adjudicated
  above; R8–R12 dispatching. Round-3 closure review + freeze pending.
- 2026-07-11 (round 3): closure 41/46 + fresh-drift FD-1..14; D26 adjudicated; R13/R14
  dispatching. Freeze after their merge + spot verification.
