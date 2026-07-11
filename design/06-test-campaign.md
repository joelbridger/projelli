# 06 — The test campaign: the exit exam

**Conforms to 00-master-spec decisions D1–D25 (reconciled 2026-07-11).**

**Lane F deliverable.** This is the complete test plan for Path 4 (Lantern as a small
RIA's system of record). Per the charter (`LANTERN-CRM.md`), the whole CRM is designed
and built first, against a frozen spec, with **no lane pausing for user testing**. This
document is what runs *after* the build wave — the single exit exam. It must be runnable
by agents with no further design decisions.

**How to read this doc:** each Layer states WHAT must be true, points at the EXISTING
rail it extends (cited with a real path), and gives the CONCRETE spec (file to write,
fixture to use, pass/fail numbers) an agent can execute without asking a design question.
Where a fact depends on another design contract, this plan links to that contract directly;
§6 handles execution ordering.

---

## 0. What already exists (the rails this campaign extends)

Verified by direct inspection of `/home/jameson/lantern-crm` on 2026-07-11:

**Gate command** — `npm run gate` (`scripts/gate.sh`): build-asset staging → parity/brand/
identity checks → `tsc --noEmit` (app + tests) → i18n (report-only, then blocking
completeness) → `npx vitest run` (all unit/integration/security specs under `tests/`) →
ESLint regression gate → UI-system guards (`handle-guard.mjs`, `token-guard.mjs`) → Rust
`cargo test --workspace --locked` in `src-tauri/`. `npm run gate:full` additionally runs
**L1** (`scripts/run-e2e-suite.sh en 6` — Playwright browser E2E, sharded 6-way because a
single run starves the tail specs) and **L2** (`npm run test:desktop` → `tests/desktop/
run.sh`). *Naming note: the existing gate calls its two heaviest suites "L1" (browser) and
"L2" (desktop) — distinct from this document's "Layer 1–5." Both numbering schemes are
kept; L1/L2 are gate-internal suite names, Layer 1–5 are this campaign's phases.*

**Vitest layout** — `tests/unit/<domain>/` (69 domain folders today, e.g. `firm/`,
`coedit/`, `crm/`, `matter/`), `tests/integration/`, `tests/security/`, `tests/eval/ask/`
(a full retrieval/citation eval harness with `grade.ts`, baseline JSON, gate test —
directly reusable as the pattern for the migration fidelity report and workflow-eval
scoring below). No `fast-check` or other property-testing library is installed today
(checked `package.json`, `backend/package.json` — absent). **Gap: add `fast-check`** for
Layer 1's property-based specs (§1); it is the standard PBT library for the existing
TS/Vitest stack and needs no new tooling philosophy.

**CRDT test rails** — `tests/unit/coedit/` (6,065 lines across 10 files) already proves
the exact property class Layer 1 needs, just for `.docx` bodies, not CRM records:
`convergence.test.ts` (5 named cases, p1-p5, using the production `Y.encodeStateAsUpdate`/
`applyUpdate` primitives — "the same primitives the relay carries"), `chaos.test.ts`
(fixed-permutation replay proving commutativity + idempotency, explicitly **no
`Math.random`** — deterministic by design), `offline.test.ts` (310 lines, offline/rejoin
merge), `matterDocSync.test.ts` (428 lines, the sync-orchestration layer above raw CRDT).
**This is the template to clone** for Task/WorkflowInstance CRDT docs once lane B defines
their doc shape.

**Relay/envelope test rails** — `backend/test/sync-relay.test.ts` is a full E2E HTTP+WS
test of the **existing** matter-sync relay: boots an isolated in-memory server
(`Store(":memory:")` + `FanoutHub`), proves ciphertext round-trips byte-for-byte between
two members, non-member push/pull is rejected (403, audited), cursor catch-up returns
only post-cursor updates in order, a live WebSocket subscriber gets pushed a new update
while a walled user can't even open the socket (403 at upgrade), cross-org access is
rejected (404), oversized/malformed blobs are rejected. **This is the exact test shape**
Layer 1's envelope-delivery specs (§1.3) extend — the relay primitive (opaque blob
push/pull/subscribe with ticket auth) already exists and is proven server-blind; what's
new is the envelope *notification* semantics lane C designs on top of it. Confirmed by
grep: no `propagat*` or `envelope`-as-notification code exists yet anywhere in `backend/
src` or `src/platform` — both are net-new for this program.

**Multi-instance test rails** — two patterns exist today, both single-purpose:
`tests/campaign/persona-firm.spec.ts` (Playwright, two **browser contexts** — admin +
member — against a seeded local firm backend, driving shared-matter invite + co-edit);
`tests/desktop/specs/20-firm-lifecycle.mjs` (one **real Tauri app instance** driving org
claim/seat activation against a disposable local backend). The desktop harness's own
README flags the gap explicitly: *"a two-instance spec needs two driver ports... tracked
as a harness enhancement"* — **no existing desktop spec runs two real app instances
concurrently.** Layer 2's N-client harness (§2) is this missing piece, generalized past 2
clients.

**Northcrest fixture boundary (D7)** — all campaign data is fabricated. The canonical
fixture is the fabricated Northcrest practice: 80 households and its fabricated documents,
notes, meetings, tasks, and Wealthbox-shaped records. The importer is fed only by the
synthetic Wealthbox-API simulator defined in `design/05-migration-importer.md` §6.2. Old
26-household material and any non-fabricated export are excluded from this campaign. The
simulator fixture manifest records its exact 80-household counts, relationships, and edge
cases so every assertion remains deterministic without accessing a real workspace.

**Legion bench harness** — `scripts/desktop-drive.mjs` (CDP driver, data-testid based,
matches the always-on-Chrome pattern), `scripts/legion-drive.sh` (SSH wrapper running the
driver ON the Legion since the tunnel is blocked from the sandbox), `scripts/legion-sync-
launch.sh` (frontend-only fast sync + relaunch, ~seconds, vs a full Rust rebuild),
`scripts/legion_agent.py` (pyautogui sidecar for native OS dialogs the CDP driver can't
reach). `.github/workflows/windows-bench.yml` runs a nightly robot smoke against the real
Legion over CDP — self-sufficient (brings the app up itself, resets to a clean snapshot,
writes a job summary on failure). This is the existing rail Layer 3 runs on.

**Trust-breaker precedent** — the term and the discipline already exist in this codebase,
not invented for this document: `docs/PRODUCT-JOURNEY.md` (2026-07-05 entry) records
Jameson's direction-call to stop broad bug-hunting and instead lock down "the handful of
things that, if they happened to the very first real advisor, would end the relationship"
— and `tests/unit/crm/WealthboxConnect.import.test.tsx` is tagged `QA-74 (P1 trust-
breaker)` for exactly the failure mode Layer 5 generalizes: *"the connector reports
success... but the [record] never gains any of the imported [data]."* Layer 5 (§5) is this
program's version of that same list, sized for the CRM's larger blast radius.

---

## 1. LAYER 1 — automated gate additions

Everything here is a **new spec file added to the existing `npm run gate` surface** —
`tests/unit/<domain>/*.test.ts` (Vitest), `backend/test/*.test.ts` (Bun test), or
`src-tauri/**/tests` (`cargo test`) as appropriate to where the subsystem lives. No new
runner, no new CI job — these specs run every time `npm run gate` runs, same as today.

**New dependency:** add `fast-check` (`npm i -D fast-check`) for the property-based specs
below. It integrates directly with Vitest (`fc.assert(fc.property(...))`) and needs no
config changes.

### 1.1 Data model invariants (owns: lane B's schema, `design/02-data-model.md`)

Location: `tests/unit/crm/dataModel.invariants.test.ts` (new domain — the CRM's typed
core is new; existing `tests/unit/crm/` only covers Wealthbox connector wiring today).

For every `EntityKind` in `design/02-data-model.md` §1 — `household`, `person`,
`account`, `fact`, `note`, `task`, `workflowTemplate`, `workflowInstance`,
`servicePolicy`, `activityEvent`, `firmDoc`, `tag`, `customFieldDef`, `opportunity`,
`savedView`, `pipelineDef`, `stageDef`, `proposalRecord`, `legacyProject`, `firmDirectoryEntry`, and
`importArchiveManifest` — run
the shared base-record invariants below. The test fixture catalog is exhaustive: adding an
EntityKind in 02 without adding it here fails this test file's catalog check.

- **Actual-field contract:** validate each generated record against 02's concrete schema,
  including every required field, required immutable field, and declared optional field
  behavior. In particular, a Fact requires `asOf` and `observedAt` plus the shared
  provenance `source`; a Note requires immutable `audience` and its Y.Text `body`; a Person
  has `roles[]` distinct from `HouseholdMember.role`; and the canonical Task is
  exactly D2's `id`, nullable `householdRef`, `title`, client-key-side Y.Text `body`, one
  `assigneeUserId`, D2 status set, `due`, `recurrence`, D2 priority set, `contextRefs`, and
  provenance/dating. No test may revive the superseded plural-assignee, `description`,
  `dueDate`, or extra-priority task variants.
- **Stable-ID invariant:** an entity's ID never changes across any mutation, merge, or
  round-trip through the CRDT encoding. Property test: generate a random valid entity +
  a random sequence of valid mutations (via `fast-check` model-based testing —
  `fc.commands`), assert `id` is invariant across the whole run.
- **Provenance and dating invariant (Fact):** a `Fact` can never exist without a
  provenance `source` object, valid `asOf`, and valid `observedAt`; `source.sources` may
  legitimately be an empty citations array (`0..n`), exactly as [02 §1](02-data-model.md#1-entities)
  defines it. The type system plus a runtime schema guard (mirroring the existing
  `DocSummary`/`SourceCard`/`RunRecord` Zod-or-equivalent pattern in
  `src/platform/types/`) rejects construction otherwise. Test: `fc.assert` over random
  partial objects, assert every one missing the provenance object or a required dating field throws
  or is rejected by the schema guard — zero silent acceptance.
- **Import archive manifest contract:** validate every `importArchiveManifest` against
  [02 §1.18](02-data-model.md#118-importarchivemanifest): immutable `kind`, firm-home
  `matterId`, `importBatchId`, `provider`, `capturedAt`, and synthetic-only
  `sourceWorkspaceLabel`; its `records` contain `rawRecordId`, `requestPath`,
  `capturedAt`, `responseSha256`, and `byteLength`; and finalization permits only the
  documented immutable `finalizedAt` and `manifestSha256`. Reject a manifest whose raw
  archive entries or finalization fields do not match that contract.
- **Matter-facade invariant:** every entity that attaches to a household resolves to a
  `matter_id` internally and the field is never renamed on the wire — a machine-checked
  regression test mirroring the existing renaming guard pattern (see `ARCHITECTURE.md`'s
  "locked identifiers" + `tests/unit/architecture-boundaries.test.ts` for the existing
  enforcement style to extend).
- **Two-audience invariant (Note):** a `Note`'s immutable `audience` field is exactly
  `internal` or `client-facing`, is set at creation (no untyped default), and a
  client-facing rendering path can be statically shown to never read an `internal` note
  (grep-based architecture guard, same style as the ESLint `lint:gate` regression-only
  pattern already in `scripts/eslint-gate.mjs`).

Pass criteria: 100% of generated cases hold (property tests, not example tests — a single
counterexample fails the gate).

### 1.2 CRDT merge properties (owns: lane B's doc shapes + lane C's merge algorithm)

Location: `tests/unit/crdt/task.convergence.test.ts`, `tests/unit/crdt/task.chaos.test.ts`,
`tests/unit/crdt/workflowInstance.convergence.test.ts`,
`tests/unit/crdt/workflowInstance.propagation.test.ts` — cloned directly from the
`tests/unit/coedit/convergence.test.ts` / `chaos.test.ts` pattern (same header comment
convention: *"If a case fails, the bug is in `<docShape>.ts` — do NOT weaken these
assertions"*), retargeted at the CRM's Task and WorkflowInstance CRDT doc shapes instead
of `DocumentJson`.

For **every** mergeable document type lane B defines as CRDT-friendly (Task,
WorkflowInstance minimum; ActivityFeed if lane B makes it CRDT rather than pure
append-log), compare only a document that every test replica is authorized and subscribed
to; these are document-level assertions, never a full-device state comparison:
- **Commutativity:** applying a set of concurrent updates in any of N fixed permutations
  (no `Math.random`, matching the existing chaos-test convention) converges to a
  byte-identical materialized state.
- **Idempotency:** applying the same update blob twice is a no-op.
- **Convergence under partition:** two replicas edit disjoint fields offline, then sync
  both directions — final state has both edits, neither clobbered.
- **Convergence under conflicting edits on the same field:** two replicas edit the SAME
  field offline (e.g. both reassign a task's `assignee`); the CRDT's last-writer-wins-per-
  field (or lane C's chosen conflict rule) resolves deterministically and identically on
  both replicas — assert both replicas' materialized view is byte-identical after sync,
  regardless of which replica synced first.
- **Subscribe-to-watermark duplicate:** deliver a relay row whose cursor and immutable
  blob ID were already durably applied while the client is draining its
  subscribe-to-watermark window. The client verifies the matching immutable identity,
  ignores the duplicate idempotently, does not start gap repair, and reaches `Live`.
  A mismatched identity at an old cursor is a corruption failure, not a duplicate.

### 1.3 Envelope delivery semantics (owns: lane C's notification design)

Location: `backend/test/notification-envelope.test.ts`, cloned from
`backend/test/sync-relay.test.ts`'s boot pattern (isolated in-memory `Store` + `FanoutHub`,
same ticket-auth WS pattern).

- **Metadata-only, senderless delivery:** the relay persists only recipient, timestamps,
  and ciphertext for an envelope — never plaintext, a persisted sender identity, or a
  sender-to-recipient history. Test a known fabricated plaintext and assert no persisted
  field or relay log contains it; assert `sender_seat` is absent. Short-lived rate-limit
  state is exercised separately and is never a durable envelope field.
- **At-least-once delivery:** an envelope pushed while the recipient is offline is present
  on their next poll/reconnect (no notification silently dropped). Test: create envelope,
  simulate offline client (no WS connection), reconnect, assert envelope is retrievable.
- **Delivery dedup and durability:** simulate an at-least-once relay retry and a client
  crash between mutation and send. The same `envelope_id` is shown once and the durable
  transactional outbox/inbox survives restart. For an approval-class notice, leave the
  only active recipient device offline for eight days, reconnect it, and assert it
  receives and durably acknowledges the notice. That notice remains available until its
  underlying approval is terminal **and** every active recipient device has durably
  acknowledged it. In the paired informational-notice case, assert the seven-day TTL and
  durable dead-letter marker. Neither class is silently lost.
- **Client-confidential wall class:** assert D5's actual forward-looking wall rule, never
  retrospective withdrawal. A send to a currently ineligible recipient is rejected; after
  a wall change, future client keys rotate and new ineligible sends are rejected. A
  previously addressed, old-key pending envelope is allowed to reach its seven-day expiry
  and then becomes a dead-letter marker; the test does not claim a later wall can retract
  it from a recipient who already retained the old key.
- **Firm-operational wall class:** a firm-operational notice (for example, a firm task or
  "notify everybody") reaches every firm seat, including a seat walled from the related
  client content, while revealing no client-confidential title, body, link, or key. This is
  intentionally distinct from the client-confidential test above.

### 1.4 Importer id-mapping / dedupe (owns: lane E's importer design)

Location: `tests/unit/crm/wealthboxImporter.idMapping.test.ts`, using only the fabricated
80-household Northcrest payload served by the synthetic Wealthbox-API simulator (§0 and
`design/05-migration-importer.md` §6.2).

- **Stable id-mapping:** the canonical `(provider, sourceType, sourceId, scope)` key from
  [02 §3.2](02-data-model.md#32-sqlcipher-schema-crm-core-encdb) maps to exactly one Lantern
  entity ID across repeated import runs (re-running the importer against the same export
  never creates a duplicate household).
- **Idempotent re-import:** importing the same export twice produces zero new records the
  second time (record count after run 2 == record count after run 1); every field is
  either unchanged or updated in place (a modified-since-last-import Wealthbox record
  updates the existing Lantern entity, never forks a duplicate).
- **Dedup on partial overlap:** import a subset (first 40 households) followed by the
  full 80 — the union result has exactly 80 households, not 120.
- **Person-to-household attachment fidelity:** every fabricated Person with a household
  reference attaches to the correct fabricated household in the imported result (property
  test over the simulator manifest — 100% must attach correctly, zero orphans).

### 1.5 Propagation properties (owns: lane C's `design/03-sync-and-notifications.md` §4)

This is the marquee correctness problem (per the charter's pre-made decision #6). The
binding property contract is P1–P10 in [03 §4.4](03-sync-and-notifications.md#44-propagation-properties-p1-p10),
under D4's per-instance offer with per-step decisions. The review starts all steps
selected, allows accept/reject per step, and advances the displayed revision set only
once its required composed change-set is wholly present.

Location: `tests/unit/workflows/templatePropagation.properties.test.ts`.

The following ten **named, one-for-one** tests are mandatory. They do not collapse into
broader tests and no additional concern is substituted for a P-property:

1. **P1 completed outcome immutable** — apply and undo never alter a valid completion
   operation, `completedBy`, or outcome.
2. **P2 no destructive removal** — a removal with any merged progress remains visible and
   detached; it is never deleted.
3. **P3 idempotent revision application** — replaying the same accepted revision/offer has exactly the
   same result as applying it once.
4. **P4 concurrent-apply convergence** — equivalent offers applied on different devices
   converge to the same instance state and accepted revision set.
5. **P5 complete revision-set pinning** — an instance displays a target revision set only
   after every required composed change is present; rejected fields retain their prior,
   explicitly recorded source revisions.
6. **P6 progress invariance** — propagation never modifies status, assignee, notes,
   completion operations, or outcome.
7. **P7 conditional undo scope** — undo restores only still-untouched derived cells from
   its own operation and reports every later-changed cell it leaves alone.
8. **P8 added-step uniqueness** — a template step ID appears once regardless of duplicate
   apply, reconnect, or concurrent review.
9. **P9 monotonic accepted knowledge** — `acceptedRevisionIds` only grows through apply;
   undo adds a compensating event and never erases revision history.
10. **P10 reassign-after-complete** — a completed step’s outcome stays intact; later
    reassignment creates a new open assignment rather than changing the completion.

The following named sync-attack regression scenarios are required in the same file, in
addition to P1–P10:

- **SA revision-path field race:** independently change two template-derived fields across
  revisions; each field's source revision is tracked and neither change is skipped by a
  single coarse template revision.
- **SA incomplete change-set visibility:** interrupt an approved multi-step apply; the
  instance continues to display its old revision set until every required change is
  present after recovery.
- **SA offline progress versus removal:** make step progress offline while another device
  removes that step; on merge, re-run the removal decision and preserve/detach progressed
  work rather than deleting it.
- **SA conditional undo after local edit:** edit a template-derived field after apply, then
  undo; the later local edit survives and the undo reports that field as untouched by
  rollback.
- **SA transactional outbox crash:** crash at each mutation/outbox boundary of an approved
  apply; after restart, the mutation and its approval envelope are both durable and deduped,
  or neither is committed.
- **SA decision-ledger persistence and re-offer:** reject a field in revision R1, accept a
  different field in descendant R2, and assert the immutable ledger entry keyed by
  `(instanceId, revisionId, stepId, field)` preserves R1's rejection. The rejected field
  is re-offered only when a descendant revision changes that same field, with its source
  operation and superseded/re-offered state recorded.
- **SA deterministic target selection:** create concurrent revision heads. An offer with
  an unresolved same-field collision is an explicit review state, never a silent pick;
  once resolved, every client applies the same topological target closure and the D3
  HLC/operation-id winner rule.

Pass criteria for all of §1: every property spec passes at ≥1,000 generated cases (the
`fast-check` default is 100 runs; raise `numRuns` to 1000 for the propagation and CRDT
convergence suites specifically, given their correctness-criticality) with zero
shrink-to-counterexample failures.

### 1.6 D1 lazy-subscription load budgets (80 fabricated households)

Location: `tests/integration/crm/syncLoadBudget.test.ts`. This test consumes the numeric
ceilings and total-bootstrap allocation in [03 §1.3](03-sync-and-notifications.md#13-hard-load-ceilings);
that section is the single source of truth for permitted subscriptions, bytes, catch-up
work, and completion time. The test fails if a ceiling or allocation is missing or
non-numeric, if the allocation does not sum within the 64 MiB bootstrap ceiling, or when
the implementation exceeds one. It runs against all 80 fabricated Northcrest households,
not a reduced sample.

- **Bootstrap budget:** start a fresh device. It receives the firm-wide collection docs
  and only its configured pinned/recent client-record docs, never all 80 client records.
  For each subscribed client record, measure its paired `crm:task-notes` transfer; assert
  no task-notes doc is fetched for an unsubscribed client. Independently measure the
  documented allocations for firm docs, client records, task-notes, checkpoints, and
  tails; their total stays within 64 MiB and every ciphertext chunk is at most 768 KiB.
- **Restart budget:** restart after a clean persisted session. Assert restored
  subscriptions and catch-up work stay within the D1 restart ceiling and do not expand
  into an all-household re-subscription.
- **Offline-return budget:** take a device offline, make representative firm and client
  changes elsewhere, then reconnect it. Assert cursor catch-up, replay volume, and final
  subscriptions meet the D1 offline-return ceiling while preserving convergence.
- **Wall-change budget:** revoke then restore one client's eligibility for a seat. Assert
  its client-record subscription and key are removed before protected content can be read,
  its paired `crm:task-notes` subscription is removed too, then both are restored only as
  allowed; all wall-change work meets the D1 numeric ceiling.

The test records measured values beside the four D1 ceilings so a failure identifies
bootstrap, restart, offline return, or wall change rather than producing one opaque result.

### 1.7 Checkpoint reconstruction validation (owns: lane C's retention protocol)

Location: `tests/integration/crm/checkpointValidation.test.ts`.

Starting from a prior validated checkpoint, have an independent validator replay every
contiguous retained raw row through declared frontier `F`, then compare its state vector
and canonical state hash with the signed checkpoint manifest. Only a matching signed
receipt counts toward the two-validator rule. The adversarial case deliberately builds a
self-consistent checkpoint that omits one retained row but labels itself frontier `F`:
both validators must reject it, it receives no qualifying receipt, and pruning is blocked.

---

## 2. LAYER 2 — multi-user simulation

### 2.1 The gap and the shape of the fix

Confirmed in §0: no existing harness runs **N real app instances** (or N headless
clients) concurrently against a shared relay. `persona-firm.spec.ts` does 2 *browser
tabs*; `20-firm-lifecycle.mjs` does 1 *real Tauri instance*. Layer 2 needs both:
(a) a fast headless-client harness for wide scripted-day coverage, and (b) real desktop
instances for the parts that only manifest in the real Tauri/Rust stack (SQLCipher
writes, keychain, CRDT persistence to disk).

**Recommended harness shape (new, ~M-sized build):** `tests/campaign/multiClient/`
— a Node/Bun harness that spins up **N headless "client" processes**, each an in-process
instance of the same CRDT + sync-client code the app uses (imported directly from
`src/platform/firm/coedit/` and the new CRM sync module lane C designs — no browser, no
Tauri, just the TypeScript sync engine talking to a real relay instance). This mirrors
`backend/test/sync-relay.test.ts`'s pattern of booting an isolated in-memory relay
(`Store(":memory:")` + `FanoutHub` on an ephemeral port) but adds N *persistent, stateful*
clients that hold local CRDT state across a multi-step script, instead of one-shot
push/pull assertions. Each client gets its own local materialized-view snapshot function
so a script step can assert "client 3's view of Task X equals client 1's view."

For the subset of scenarios that must exercise the real desktop app (device bootstrap,
keychain-backed keys, SQLCipher persistence across restart), extend the **existing**
`tests/desktop/` harness per its own README-documented gap: give `run.sh` the ability to
start N `tauri-driver` instances on N ports (today it starts one), each with its own
isolated profile (the isolation already exists per-spec — extend it to per-client-within-
a-spec). This is a scoped harness enhancement to a rail that already does 90% of the work
(fresh isolated `HOME`/`XDG_*` per instance, WebDriver session management, evidence
capture on failure).

### 2.2 Scripted days (run against the headless N-client harness; a subset re-run on the
extended desktop harness for real-stack confirmation, marked ✱ below)

Each script is a spec file under `tests/campaign/multiClient/scripts/`, structured as an
ordered list of `{clientIndex, action, expectedInvariant}` steps, run against a firm of
6 simulated seats (the charter's target ≤10-seat boundary; 6 matches the Northcrest
Layer-3 firm size for continuity).

1. **Concurrent task edits.** All 6 clients open the same authorized, subscribed task simultaneously; each edits
   a different field (`assigneeUserId`, `due`, `priority`, `body`, `title`, `status`) within
   a 2-second window; all sync. Assert: final state has all 6 edits present, no field
   reverted, and is byte-identical across those six clients' shared authorized +
   subscribed document set.
2. **Offline/rejoin.** 2 of 6 clients go offline (sync socket closed); the online 4 make
   10 more edits across various tasks; the offline 2 rejoin after the online clients have
   fully converged. Assert: the rejoining clients converge to the same state within one
   sync round-trip, with zero manual conflict resolution required for non-overlapping
   edits.
3. **Assignment storm.** ✱ 20 tasks get reassigned across the 6 seats in rapid succession
   (~1 reassignment/100ms), triggering 20 notification envelopes. Assert: every seat's
   final "my tasks" view matches the last-applied assignment for each task (no task shows
   a stale assignee); notification count delivered per seat matches actual assignment
   count with zero duplicates and zero drops (ties to §1.3's dedup property, exercised at
   volume here).
4. **Template edit with open instances.** ✱ A workflow template is edited while 8 open
   instances exist across the 6 seats, 3 of which have uncommitted local progress on 2
   different clients at edit time. Propagation offers are reviewed per instance with
   per-step accept/reject choices and all-on defaults. Assert: P1–P10 and the named
   sync-attack scenarios from §1.5 hold at the *system* level, including byte-identical
   authorized + subscribed workflow documents after quiesce and retained in-progress work.
5. **Notification delivery/dedup at scale.** Combine the day's total event count (from
   steps 1-4) against actual envelopes delivered per seat; assert zero lost
   notifications, zero duplicate notifications, and — since the relay is content-blind by
   design — assert the relay's own storage/logs contain no plaintext of any task/note/
   assignment content at any point during the day (re-checked adversarially in §5).
6. **Device bootstrap.** ✱ A 7th seat is added mid-day (new device, fresh keychain, joins
   the firm). Assert: the new device receives the current authorized + subscribed document
   set (not just future updates) within one sync cycle, and that set matches the equivalent
   set on the other clients once caught up. Assert separately that client records and
   `crm:task-notes` outside its subscriptions, and every walled document, are absent from
   its device.

### 2.3 Pass criteria (numeric, checked automatically by the harness after each script)

- **Convergence:** after quiesce (no client has pending local or remote updates), each
  seat's authorized + subscribed document set is byte-identical to the equivalent set on
  every comparable seat (a deep-equal / hash comparison of serialized document state, not
  a UI screenshot diff). This is never a full-device or all-seat-state comparison.
- **Access absence:** for every seat, assert independently that unsubscribed records and
  task-notes, plus every ethically walled record and task-notes, are absent from local
  storage, search, projections, and rendered views.
- **Zero lost updates:** the count of distinct user-initiated edits issued during the
  script equals the count of distinct edits reflected in the final converged state (an
  edit that get silently overwritten by a "last write wins" collapse on the SAME field is
  not a loss — see the conflicting-edit case in §1.2 — but an edit to a DIFFERENT field
  disappearing is a hard failure).
- **Notification accuracy:** delivered-envelope count == actual-notification-worthy-event
  count, per seat, with zero duplicates (exact match, not approximate).
- **Latency ceiling (soft, reported not gated):** time from an edit committed on client A
  to that edit visible in client B's materialized view, for both clients online — report
  p50/p95 across all scripts; no numeric gate yet since lane C hasn't fixed a target, but
  the harness must emit the number so a future gate can be added.

---

## 3. LAYER 3 — the Northcrest drive-through week (Legion bench)

### 3.1 Setup

Uses the fabricated Northcrest 80-household corpus (§0), with 6 simulated seats matching a small RIA
team (an advisor lead, 2 associate advisors, an ops/compliance person, and 2 support
staff). Corpus is synced to the Legion via the
existing `scripts/legion-sync-launch.sh` pattern (frontend-only fast sync where possible;
full sync + rebuild when Rust changed). App is driven via `scripts/legion-drive.sh` /
`desktop-drive.mjs` (CDP, data-testid based) with `legion_agent.py` for any native-dialog
steps (file pickers during import).

Each day is a checklist spec under `tests/desktop/specs/crm-week/NN-<day>.mjs` (numbered,
extending the existing `tests/desktop/specs/` convention — `00`-`19` are taken by existing
journeys, so this week's specs live at `30`-`36` to avoid collision). Failures auto-
collect evidence per the existing pattern (`evidenceDir` screenshots, `<name>.FAIL.png`,
per-spec logs) — no new evidence tooling needed.

### 3.2 Day-by-day script

**Day 1 — Onboarding the book.** The importer ingests all 80 households from the
fabricated Northcrest Wealthbox-API simulator and its fabricated structured email/meeting
records. It does **not** ingest attachments through an API. Checklist: all 80 households
are present in the directory and Clients; the fidelity report (§4) is complete; every
in-flight workflow has the [05 §2.5a](05-migration-importer.md#25a-open-workflow-instances-guided-re-creation-at-cutover)
operator checklist with its recorded decision; every affected client has the [05 §2.5b](05-migration-importer.md#25b-files-and-attachments-operator-export-plus-client-level-gap-flags)
attachment exported-or-gap status; every seat sees permitted firm-wide collections; client
records remain lazily subscribed according to §1.6; import progress is visible and honest
throughout (no false-success class of bug — the QA-74 precedent in §0).

**Day 2 — Morning triage, x2 (two advisors).** Two seats independently open Home.
Checklist: the day's triage view is computed live (not stale), matches the actual
state of tasks/meetings due that day, capacity-aware surfacing shows a realistic subset
(not all 21 possible tasks framed as due), and internal-lane items never bleed into any
client-facing surface opened later the same day.

**Day 3 — Meetings → notes → tasks.** 3 seats each run one client meeting (using a
fabricated Northcrest household's existing meeting transcript+notes as the simulated capture
input, or a live scripted mock meeting if lane D's meeting-capture flow requires real
audio/video input — confirm against lane D). Each meeting produces notes (correctly
audience-tagged) and 2-3 tasks assigned across the other seats. Checklist: notes attach to
the correct household; tasks appear in the assignee's task list within one sync cycle;
pinned facts extracted from the meeting (if lane D's design includes this) show up on the
household record with correct provenance.

**Day 4 — Workflow run + mid-week template edit + propagation approval.** Morning: 2 new
workflow instances started from an existing template (e.g. a Money Movement or annual-
review template) against 2 different households. Midday: the template is edited by the
ops seat while both instances (and 6 other pre-existing open instances seeded from Day 1)
are live, at least one with uncommitted local progress on a different seat's client.
Propagation is proposed; the appropriate seat(s) review and approve per lane C's model.
Checklist: this is the Layer-3 system-level re-run of §1.5 and §2.2 step 4's properties,
now on real hardware with real SQLCipher/keychain/CRDT persistence — no clobbered
progress, all 8 instances converge identically across the seats authorized and
subscribed to those workflow documents after propagation.

**Day 5 — Reports + exam export.** Each report type lane A/D define (e.g. "no contact in
6 months," birthdays, service-tier due-for-review) is run and checked against the known
fabricated Northcrest fact sheets (since every household's `timeline` field is internally
consistent per the fixture's own schema, a report's output is mechanically checkable
against the fixture data — e.g. count of households with no `timeline` event in the
trailing 6 months should match the report's row count exactly). Checklist ends with the
exam-export capability (per the deep-dive §8's compliance flag: *"an export-everything-
decrypted capability, firm-initiated, becomes a hard requirement"*) — run a full firm-
initiated decrypted export and verify every household, note, task, and workflow instance
present in the live system appears in the export with matching content (hash comparison).

### 3.3 Evidence and pass criteria

Every day's checklist is pass/fail per item, auto-collected on failure (existing pattern).
A day is GREEN only if every item passes; the week is GREEN only if all 5 days are green
AND the cumulative convergence check for each shared authorized + subscribed document set
holds at the end of Day 5, with separate proof that unsubscribed and walled documents are
absent from each seat.

---

## 4. LAYER 4 — migration fidelity

Adopts the canonical fidelity matrix in `design/05-migration-importer.md` §3 by reference:
that matrix alone defines source type → target entity → fabricated fixture source → required
completeness → allowed skip reasons. This layer does not create a second matrix or a
competing definition of "records-that-matter." Location:
`tests/integration/migration/fidelityReport.test.ts` + a Legion-bench re-run as part of
Layer 3 Day 1.

- **Fidelity report, matrix-exact.** Drive the whole importer against the fabricated
  Northcrest simulator. Build the report in the existing `tests/eval/ask/grade.ts` style:
  `{sourceType, targetEntity, fetched, imported, skipped, skipReason[]}`. For every matrix
  row, assert its required completeness exactly; any skip must be an allowed matrix reason
  and carry a human-readable explanation. No non-fabricated export or workspace is used.
- **Re-run idempotency.** Import the fixture twice in immediate succession; assert zero
  new records on run 2 (this duplicates §1.4's unit-level dedup test at the integration
  level, against the full importer path including file/UI wiring, not just the
  mapping function).
- **Rollback dry-run.** Per the deep-dive §7's cutover design ("a defined day-one
  rollback: re-export from Lantern back to Wealthbox format"), run a dry-run rollback
  export against the imported 80-household state and assert every field round-trips
  losslessly for the fields Wealthbox's schema can represent, and every Lantern-native
  field with no Wealthbox equivalent (if any exist per lane B's schema) is explicitly
  listed as "not representable in target format" rather than silently dropped.

Pass criteria: every canonical matrix row meets its required completeness with zero
unexplained or disallowed skips, idempotency test shows 0 new records on re-run, and the
rollback dry-run shows 0 silent field drops.

---

## 5. LAYER 5 — trust-breaker sweep

Per §0's precedent (`docs/PRODUCT-JOURNEY.md` 2026-07-05, `QA-74`), this campaign's
version of the trust-breaker list — the CRM's larger blast radius over the existing
trust-breaker set (lose a document, cross-matter leak, crash, a connector that lies about
importing, files that don't show up). Each gets ONE adversarial test, written to actively
try to cause the failure, not just check its absence in a happy path.

Location: `tests/security/crm-trust-breakers/*.test.ts` (new folder — mirrors the
existing `tests/security/` convention for adversarial specs).

1. **Lose a record.** Adversarial script: kill a client mid-sync at the exact moment
   after a local CRDT update is created but before the sync push completes (fault
   injection at the sync-client boundary — simulate a process kill via aborting the
   in-flight push and restarting the client from persisted local state). Assert: on
   restart, the locally-created update is still present and re-attempts sync — it is
   never lost because a push was interrupted.
2. **Cross-client leak.** Adversarial: seat A and seat B are both simulated firm members but A
   is walled from a specific household (per the existing ethical-wall mechanism in
   `sync-relay.test.ts`). Attempt every read path in the CRM against that household from
   A's client (Home surfacing, search, reports, notification content) — assert
   zero paths surface any content from the walled household, not just the obvious
   client-record page. This generalizes the existing walled-403 test (which only checks
   the sync socket) to every CRM read surface.
3. **Internal note reaching a client-facing surface.** Adversarial: create an internal-
   audience note with a distinctive marker string on a household; render every client-
   facing surface lane D defines (any exam-export view, any future client-portal-style
   view, any generated report meant to be printable/shareable) and grep the rendered
   output for the marker string — assert it never appears outside internal surfaces. This
   directly operationalizes design principle #5 ("two audiences, hard-walled... visually
   unmistakable") as a machine-checked test, not just a visual convention.
4. **Stale view presented as current.** Adversarial: force a client's local materialized
   view to be stale (disconnect before syncing a remote update from another seat), then
   assert the UI for every "live" surface (Home, reports, the household record)
   either (a) shows a visible staleness indicator or (b) blocks rendering until sync
   completes — never silently presents outdated data as current. Ties directly to design
   principle #2 ("staleness is visible, never silent") and the deep-dive's explicit "never
   a stored 'current' artifact" requirement for triage.
5. **Envelope metadata leaking content.** Adversarial: instrument the relay's actual
   network traffic and server-side storage during a full scripted day (reuse Layer 2's
   scripts), and run a content-fingerprint scan (string search for every known plaintext
   value used in that day's script — task titles, note text, assignee names) against
   everything the relay persisted or transmitted in cleartext. Assert zero matches outside
   the ciphertext blob fields themselves (which are expected to be opaque, and are
   separately asserted to fail to decrypt without the matter key). This is the sharpest
   version of §1.3's metadata-only assertion, run against the FULL system under load
   rather than a single synthetic envelope.

Pass criteria: all 5 tests pass with **zero tolerance** — a trust-breaker-class failure in
any of these 5 is treated as a program-blocking bug regardless of how minor its trigger
condition seems (per the precedent in §0, this class does not get a "low severity, fix
later" path).

---

## 6. Execution plan

### 6.1 What runs where

| Layer | Where | Why |
|---|---|---|
| 1 (gate additions) | `npm run gate` (existing Vitest/Bun/cargo test runners) | Same rail as every other unit/integration/security spec; no new infra |
| 2 (multi-user sim) | New: headless harness runs in CI-capable time (seconds-minutes per script, Bun/Node process spin-up, no browser); the ✱-marked desktop-harness re-runs need the Legion (WebView2/keychain/SQLCipher are Windows-real, can't fully fake in CI) | Split deliberately: fast headless coverage for breadth, real-stack re-runs only where the real stack matters |
| 3 (Northcrest week) | Legion bench only (`scripts/legion-*`, `windows-bench.yml` pattern) | Needs the real signed desktop app, real file system, real multi-day state accumulation — this is what `windows-bench.yml` already exists to run, extended to a week-long script instead of a single smoke |
| 4 (migration fidelity) | Split: fidelity-report scoring + idempotency in CI (`tests/integration/`); the Day-1 fabricated full-corpus import re-run happens again on the Legion as part of Layer 3 (real-stack confirmation, not a duplicate design) | The scoring math doesn't need real hardware; the fabricated 80-household import and indexing path does |
| 5 (trust-breaker sweep) | Split: 1-4 run in CI (`tests/security/`, deterministic fault injection); 5 (metadata leak under load) needs Layer 2's full harness running, so it runs wherever Layer 2 runs (CI headless first, Legion re-run alongside Layer 3 Day 1's live import for belt-and-suspenders) | Matches existing `tests/security/` convention of CI-first adversarial tests |

### 6.2 Ordering

1. **Layer 1** first and continuously — these are gate-blocking unit-level specs; they
   should exist and be green *before* any higher layer runs, because a Layer-2/3 failure
   traced back to a Layer-1-testable root cause (e.g. a CRDT convergence bug) wastes a
   full multi-client script or a Legion day chasing something a unit test would have
   caught in seconds. P1–P10 and the named sync-attack cases in §1.5 are binding inputs
   here; they are written before any higher-layer propagation exercise runs.
2. **Layer 2** next — the headless multi-client harness is the cheapest way to find
   convergence/propagation/notification bugs at N-client scale; run it repeatedly (it's
   fast) as the fix wave lands.
3. **Layer 4's CI-side half** (fidelity scoring, idempotency) runs alongside Layer 2 —
   both are fast, both gate on lane E's importer being functionally complete.
4. **Layer 5.1-5.4** (CI-side trust-breakers) run alongside Layer 1-2 — they're
   deterministic adversarial unit/integration tests, no reason to wait.
5. **Layer 3** (Northcrest week) runs last, on the Legion, only once Layers 1-2-4(CI)-
   5(CI) are green — it is the expensive, slow, full-system confirmation and should not
   be the tool used to find bugs that a cheaper layer would have caught faster. Within
   Layer 3, Day 1 also re-runs Layer 4's full-corpus import and Layer 5.5's metadata
   sweep, so those two get their real-hardware confirmation as part of the week rather
   than as separate bench trips.
6. **Layer 5.5** (metadata leak under load) runs twice: once headless (fast, alongside
   Layer 2) and once for real during Layer 3 Day 1's live import + the week's accumulated
   traffic (belt-and-suspenders on the sharpest privacy claim in the whole program).

### 6.3 How the bug list feeds the fix wave

Every failing spec/checklist item across all 5 layers writes a structured entry (mirroring
the existing `docs/quality/2026-06-20-test-bug-backlog.md` pattern already used for
Keepance's QA engine) tagged with: layer, severity (`trust-breaker` / `standard`),
subsystem (data-model / CRDT / relay / importer / propagation / UI), and reproduction
(the exact failing spec path + fixture, or the Legion day + step number + evidence
screenshot path). `trust-breaker`-tagged bugs (any Layer 5 failure, or any Layer 1-4
failure that independently matches one of the 5 trust-breaker categories) go to the front
of the fix queue regardless of when they were found — same discipline as the existing
`QA_BOARD.md` parallel-fix-ticket protocol (isolated worktree agents + Codex on scoped
tickets, one lead reviews/gates/merges serially), reused as-is rather than reinvented for
this program.

### 6.4 DONE criteria for the whole program

The test campaign — and by extension the one-shot build wave it exits — is DONE when:
1. **All 5 layers are green:** Layer 1 passes at `npm run gate`; Layer 2's full script set
   passes on the headless harness AND the ✱-marked subset passes on the desktop-harness
   re-run; Layer 3's full 5-day Northcrest week is green on the Legion; Layer 4's fidelity
   report meets every canonical fidelity-matrix row with idempotency and rollback dry-run
   both clean; Layer 5's 5 trust-breaker tests all pass.
2. **Zero trust-breaker-class bugs open** — not "zero known trust-breaker bugs of high
   severity," zero, full stop, matching the precedent's own bar (§0).
3. **The numeric convergence bar holds at every layer that defines one:** byte-identical
   authorized + subscribed document sets after quiesce, with unsubscribed and walled
   documents absent (Layers 1.2, 2.3, 3.3), 100% fidelity (Layer 4), zero lost updates,
   and zero notification duplicates/drops (Layer 2.3).

Anything short of this is not "ready for the next stage" — per the charter, the program's
next real gate (§10 of the deep-dive: consolidation-appetite evidence from strangers) is
downstream of this exam entirely and is not this document's concern; this document's only
job is proving the built system is *correct*, not that anyone wants it.

---

## 7. Open questions

1. **Exact 6 seat roles for Layer 3.** The deep-dive names a "6-10 person RIA" and a
   morning-triage/meetings/reports pattern but doesn't assign the exact 6 job titles this
   campaign's week-script uses. Recommend finalizing against lane D's screens doc (which
   will define role-specific UI, if any) rather than inventing roles here that might not
   match what got built.
2. **Meeting-capture input for Layer 3 Day 3.** Fabricated Northcrest households already have
   1-2 past meetings with transcript+notes as static fixtures (good for testing the
   *data* side — notes/tasks generated from a meeting). Whether Day 3 also needs to
   exercise the *live capture* flow (the notice card, live transcription) or can validate
   against the static fixtures depends on whether lane D's screens doc treats meeting
   capture as in-scope for this program's exit exam or as an already-proven existing
   feature being reused as-is. Recommend treating it as already-proven (per
   `docs/PRODUCT-JOURNEY.md`'s own account of the notice-card feature going through nine
   rounds of adversarial review already) and scoping Day 3 to the CRM-specific
   downstream behavior (notes/tasks attaching correctly), not re-proving live capture.
3. **Property-based testing library approval.** This doc recommends adding `fast-check`
   as a new dev dependency (§1). Flagging as a genuinely new tool choice for this repo
   (not previously used) rather than assuming it's pre-approved — cheap, standard,
   Vitest-native, but worth a one-line sign-off during spec freeze review rather than
   silently landing with the first Layer-1 spec.
