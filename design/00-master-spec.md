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
  **BCC-dropbox capture: documented exclusion** — server-side plaintext capture conflicts
  with the E2EE charter; revisit only with a client-side alternative.
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

## Status
- 2026-07-11: D1–D10 recorded; R1–R5 dispatching. Round-2 review + freeze pending.
