# 03 — Sync, Notifications & Propagation (Lane C)

Conforms to 00-master-spec decisions D1–D25.

**Status:** Design-phase deliverable. This is the build contract for CRM sync, encrypted
notifications, offline behavior, workflow-template propagation, and retention for firms
of no more than 10 seats.

**Boundaries:** `design/02-data-model.md` owns entity fields and the versioned **Field
Merge Contract** (its §2 after R2 reconciliation). This document references that contract;
it does not create a second field schema. All CRM truth is encrypted in local SQLCipher
and CRDT documents. The relay remains unable to read document or envelope content.

---

## 0. Code reality and required repairs

The existing relay is an opaque encrypted update log partitioned by `(matter_id, doc_id)`.
HTTP reads are paged at 500; update writes are idempotent by blob ID; membership, key
wrapping, key epochs, and ethical walls exist. AES-GCM authenticates the key epoch as
additional authenticated data.

The following are **build-plan fixes**, not capabilities we may assume already work:

1. **Pre-existing relay live-sync missed-update defect (D6).** Today the socket sends only
   its first 500 historic updates, client cursors are memory-only, and “HTTP catch up,
   then open a socket” has a race that can lose update 601. Build `SYNC-01: lossless
   cursor subscription and gap repair` before CRM sync uses the relay.
2. **Persistent cursors.** Store a successful applied cursor in local SQLCipher for every
   `(matter_id, doc_id)` and one notification cursor for every `(org_id,
   recipient_user_id, device_id)`. A cursor advances only in the same local transaction
   that authenticates and applies (or durably stores) its item.
3. **Key-epoch write policy.** The relay accepts writes only at the current epoch. A
   reconnecting device with queued old-epoch work fetches the current key, decrypts its
   own queued edit, re-encrypts it at the current epoch, and sends it as a new idempotent
   blob. If that cannot be done, the work enters a visible export/review queue. No client
   skips an unauthenticated blob or advances beyond it.

### 0.1 Lossless subscription protocol

For each logical document, the client opens one multiplexed authenticated sync session
and sends `{matter_id, doc_id, since: durableCursor}`. The relay atomically records a
subscription watermark `W` for that document and begins buffering later live frames for
that subscription. It then returns `ready { watermark: W }`.

The client pages HTTP updates from `since` through `W`, applying each in cursor order.
It then drains buffered frames after `W`. Relay delivery is **at-least-once**: the
subscribe-first window can deliver a row already received during the HTTP backfill. For
each received row, it uses this exact triage:

```text
cursor <= durableCursor     -> verify the same immutable row identity, then ignore it
cursor == durableCursor + 1 -> authenticate, apply, and persist cursor in one transaction
cursor > durableCursor + 1  -> run bounded gap repair
```

CRDT application and cursor persistence are idempotent by relay cursor/blob ID. The
client never claims `live` while a gap exists. The socket supports `since`, paged
backlog, and gap repair. On reconnect this sequence repeats. This closes the old
pull-to-socket gap without mistaking normal duplicates for gaps.

---

## 1. Sync topology and load budget (D1)

### 1.1 Exact document topology

`firm_home` is one real, synthetic matter per organization. Every active seat has its
key; walls are rejected on it. Client matters remain the real household matters and use
their existing membership and wall rules.

| Scope | Matter | Documents |
|---|---|---|
| Firm operational | `firm_home` | `crm:tasks` shells, `crm:workflows`, `crm:templates`, `crm:directory`, current `crm:activity:<YYYY-Qn>` |
| Client record | real household matter | one `crm:record` document |
| Confidential task text | real household matter | `crm:task-notes`, opened only when needed |
| Existing content | real household matter | legacy `_notes` and individual `.docx` documents, unchanged |

This is the only CRM topology. There are no per-entity streams or retired pseudo-matter
identifier. Client-record documents are subscribed **when opened**, plus a bounded set of
pinned or recently used clients. They are never all subscribed merely because a firm has
80 households.

Firm task shells use the canonical Task contract from 02: `id`, nullable
`householdRef`, `title`/`body` behind the client key, one `assigneeUserId`, status
`open|in_progress|blocked|done|cancelled`, `due`, `recurrence`, `priority`,
`contextRefs`, and D3 provenance/dating fields. A firm task has `householdRef = null`.
Shells contain only non-content operational data and opaque references. A walled member
can see that work exists and its operational state, but not client identity or text.
This residual metadata exposure is explicitly accepted because the firm board must work
across the firm; client content remains cryptographically denied.

### 1.2 Document shapes and local truth

All maps use stable IDs and soft-delete tombstones. Field behavior is exactly the
versioned Field Merge Contract in [02 §2, after reconciliation](02-data-model.md#2-identity--merge-crdt-model).

```
firm_home / crm:tasks       tasks: Y.Map<TaskId, TaskShell>
firm_home / crm:workflows   instances, propagation offers/events, completion operations
firm_home / crm:templates   templates and immutable template revisions
firm_home / crm:directory   non-identifying household directory shells
firm_home / crm:activity:Q  immutable operation/activity references for that quarter
client / crm:record         one household's CRM record
client / crm:task-notes     taskId -> Y.Text confidential task body/notes
```

The activity entry is not the only evidence of a change. Each field mutation creates an
immutable operation record with `operationId`, entity ID, field name, encrypted proposed
value or protected value reference, D3 HLC stamp, and causal predecessor/winner links.
The current field points to its winning operation. Activity is derived from these records,
so the app can honestly show both the attempted and winning values.

### 1.3 Hard load ceilings

All logical documents share **one authenticated multiplexed WebSocket per device**;
there is no socket or ticket per document. The ceilings below are release gates, tested
with the fabricated 80-household Northcrest corpus and 10 seats. A build that exceeds a
ceiling is not ready for freeze.

| Situation | Logical docs allowed | Connection ceiling | Transfer / storage ceiling | Completion ceiling |
|---|---:|---:|---:|---:|
| Fresh bootstrap | 5 firm + 12 client records + 12 matching `crm:task-notes` max | 1 WS/device, 1 ticket/device | <= 64 MiB downloaded; every ciphertext chunk <= 768 KiB | <= 45 s to usable firm board; <= 90 s all subscribed docs projected |
| Relay restart | same active set, including matching task-notes | 1 reconnecting WS/device; jitter 0-30 s | <= 20 MiB redownload/device | <= 60 s back to live after relay availability |
| Return after 30 days offline | same active set, including matching task-notes | 1 WS/device | <= 32 MiB tail plus checkpoints; <= 10,000 tail updates/doc before rebase | <= 90 s back to live |
| Ethical-wall/key change | affected client docs only, plus firm docs | no extra socket | <= 8 MiB key/checkpoint recovery; 0 unreadable cursor advances | <= 30 s to revoke affected live access and mark rebase need |

Pinned/recent client documents are capped at 12 (most-recent eviction, pin overrides only
after the user explicitly unpins another). Opening a thirteenth client closes the least
recent unpinned subscription after persisting it. The matching `crm:task-notes` subscription
closes with that client record. The local SQLCipher projections of closed records remain
available but carry their freshness state. Every checkpoint and update chunk is at most
768 KiB ciphertext, below the existing 1 MiB relay limit. The test campaign owns these
measurements under D1.

The fresh-bootstrap ceiling is an allocation, not an aspirational aggregate. It includes
all subscribed documents and their required tails:

| Bootstrap allocation | Count ceiling | Checkpoint bytes | Tail/control bytes | Total ceiling | Completion ceiling |
|---|---:|---:|---:|---:|---:|
| Firm documents | 5 | 8 MiB | 2 MiB | 10 MiB | usable board within 45 s |
| `crm:record` client documents | 12 | 24 MiB | 6 MiB | 30 MiB | all subscribed records within 90 s |
| `crm:task-notes` documents | 12 | 12 MiB | 3 MiB | 15 MiB | all matching notes within 90 s |
| Checkpoint manifests, relay frames, and projection overhead | — | 1 MiB | 0 MiB | 1 MiB | included above |
| **Fresh-bootstrap total** | **29 logical docs** | **45 MiB** | **11 MiB** | **56 MiB** | **within 64 MiB** |

### 1.4 Bootstrap

1. Register or recover the device keypair; obtain `firm_home` and eligible client keys.
2. Start the one multiplexed session and subscribe to the five firm docs.
3. Subscribe only to user-opened, pinned, and recent client record docs, up to the cap.
   Fetch `crm:task-notes` only with the corresponding client view.
4. For every subscription, use §0.1, applying a validated checkpoint then tail updates.
5. Open notification delivery only after its durable inbox is ready.

---

## 2. Sealed notification envelopes (D5)

Notifications are client-emitted encrypted envelopes. The relay routes them but does not
read type, subject, content, actor identity, or sender identity.

### 2.1 Relay storage and eligibility

```sql
CREATE TABLE notify_envelopes (
  org_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  recipient_user_id TEXT NOT NULL,
  envelope_id TEXT NOT NULL,
  ciphertext BLOB NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT,
  retention_until_terminal BOOLEAN NOT NULL DEFAULT FALSE,
  terminal_at TEXT,
  PRIMARY KEY(org_id, seq),
  UNIQUE(org_id, recipient_user_id, envelope_id)
);
CREATE TABLE notify_device_acks (
  org_id TEXT NOT NULL,
  recipient_user_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  acked_through INTEGER NOT NULL,
  PRIMARY KEY(org_id, recipient_user_id, device_id)
);
```

`notify_envelopes` deliberately has **no `sender_seat`** and no persisted matter/type
column. Short-lived, in-memory rate counters enforce abuse limits without retaining a
sender-to-recipient history. `envelope_id` is a random 128-bit opaque value in a fixed
format, never a semantic identifier. The relay assigns `seq` in increasing order within
each `org_id`; the retention flag records delivery lifetime only, not an envelope type.

At send time the client supplies a transient authorization scope. The relay checks that
the sender and recipient are active and that the recipient holds the relevant current
key grant: all seats for `firm_home`, and only current client-matter members for a
client-confidential envelope. The scope is used to authorize the send and is not written
into the envelope table. The client also includes a recipient-only encrypted key hint,
which lets the receiving device select the correct key in constant time without exposing
the hint to the relay.

### 2.2 Post-wall delivery trade-off (accepted with reason)

**Accepted with reason:** D5 forbids persisting a sender or authorization scope with an
envelope. Therefore the relay cannot re-check a pending client-confidential envelope
against a wall added *after* it was sent without widening relay metadata. The guarantee
is: the relay rejects sends to a user who is not currently eligible; a wall immediately
blocks new deliveries and rotates future content keys. A recipient who already retained
an old key could decrypt a previously delivered/pending epoch-1 envelope.

This is the deliberately weaker, honest post-wall guarantee chosen to keep the D5
metadata boundary. Client-confidential informational envelopes have a short TTL (7 days),
and every expired/undecryptable informational item becomes a local dead-letter marker.
Approval-class envelopes instead follow the terminal-and-ack retention rule in §2.3.
Devices remove revoked key material during wall processing. The app must never claim that
a later wall retracts an already-addressed encrypted message.

### 2.3 API and delivery protocol

```
POST /notify/send
  { org_id, recipient_user_id, envelope_id, ciphertext_b64, transient_scope, key_hint,
    idempotency_key }
GET  /notify/inbox?org_id=<org_id>&since=<cursor>
POST /notify/ack { org_id, device_id, up_to_cursor }
POST /notify/sync-ticket { org_id }
WS   /notify/sync?org_id=<org_id>&ticket=...
```

Inbox responses contain only `seq`, `envelope_id`, `created_at`, `expires_at`,
`key_hint`, and ciphertext. Live push is a wake-up/fast path; the paged inbox is the
source of truth. Sequences, cursors, inbox rows, acknowledgements, idempotency keys,
and device-retirement decisions are all scoped by `org_id`. The same lossless watermark
and duplicate triage as §0.1 apply.

On the sending device, one SQLCipher transaction writes the business mutation, immutable
operation record, activity-outbox row, and notification outbox row. The outbox retries
idempotently until `/notify/send` accepts it under its `org_id`-scoped idempotency key.
When an envelope references a document operation, its outbox row dispatches only after
the relay has durably accepted that immutable operation/blob ID — this D18 ordering is
enforced entirely on the sending client; the operation reference lives only inside the
encrypted envelope, and the relay is never told which operation (or matter) an envelope
concerns. A recipient that receives
an early envelope stores it durably as **waiting for referenced state**; it becomes
display-ready only after the referenced operation is durably applied. On the recipient,
one SQLCipher transaction stores/deduplicates the envelope, records its
display-ready/waiting/dead-letter state, and advances the highest **contiguous** durable
cursor. Only then may that device ack. This provides at-least-once delivery across
crashes; approval-class notices are crash-survivable end to end.

Informational envelopes have a seven-day TTL and then receive a durable local dead-letter
marker if undelivered or undecryptable. Approval-class envelopes are TTL-exempt:
`retention_until_terminal = true`, `expires_at` is null, and their opaque retention state
is released only after the underlying approval is terminal **and** every active recipient
device has durably acked it. A signed terminal notice, addressed by opaque `envelope_id`,
sets `terminal_at` without exposing approval content or sender identity. “Active” is
bounded by the device-retirement/rebase rule in §6 and is evaluated per `org_id`.
Retired devices are removed from that organization’s `notify_device_acks` only through
that procedure. The relay never invents a blind “N earlier notifications” envelope and
never drops an unresolved action prompt merely to enforce a cap.

### 2.4 Encryption, padding, and metadata truth

Envelope plaintext contains a version, encrypted type, subject reference, D3 HLC display
stamp, actor identity, and a pointer rather than client content. Firm-operational notices
use the `firm_home` key; confidential notices use the client key. Ciphertexts are padded to
1 KiB, 4 KiB, or 16 KiB bands. Clients batch non-urgent informational sends for up to
30 seconds; assignments and approval requests send immediately.

The relay sees recipient, timestamp, count, ciphertext size band, delivery/ack timing,
and an opaque ID. It does not persist sender identity. Traffic correlation with matter
oplog timing can still suggest collaboration and likely client association. Padding and
batching reduce but cannot eliminate that inference. This residual traffic-analysis risk
is accepted because encrypted offline routing requires a recipient dimension.

An undecryptable informational envelope is not retried forever: validate the key hint and
current grant, retry one key refresh, then store a durable local dead-letter reason at
its seven-day TTL. An undecryptable approval-class envelope stays durably retained and is
retried after access refresh until its terminal-and-all-active-device-ack condition is
met. The app offers “refresh access” and shows the authoritative task/approval state; it
never silently advances past either state.

### 2.5 Envelope classes

| Class | Examples | Addressing rule | Retention |
|---|---|---|---|
| Firm operational | task assigned/reassigned, approval requested, workflow due, migration event | any active firm seat; `firm_home` key | informational: 7 days; approval request: terminal-and-ack |
| Client confidential | mention or content-bearing client alert | only a current holder of that client key; client key | informational: 7 days; approval request: terminal-and-ack |

`workflow_step_due` remains client-computed from synced data. The relay has no due-date
timer and no plaintext due date.

---

## 3. Offline conflict behavior (D3)

Every scalar LWW decision uses the explicit HLC stamps in the
[02 §2.3 Field Merge Contract](02-data-model.md#23-field-merge-contract-v10), not Yjs
internal clocks. HLC issuance, clamping, and invalid-stamp handling are owned solely by
that contract. No `rev` field exists; propagation uses immutable `revisionId` values and
revision sets. Relay cursor and `created_at` are transport/display metadata, never merge
inputs.

Different fields merge independently. Same-field collisions resolve by the field’s HLC
stamp and operation ID. Because the mutation, immutable operation, and repairable activity
outbox are one local transaction, a losing offline edit remains auditable. The winning
field links to the winning operation; the UI can accurately show what was proposed and
what won without asserting that an activity document alone proves it.

Deletion is a soft tombstone. Concurrent edits survive underneath it and an undelete is
a new mergeable mutation. Tombstones are not hard-deleted merely because time passed;
§6 governs their safe retirement.

Completion is not a mutable “write-once” map field. A completion is an append-only,
immutable completion operation keyed by `(stepId, completionId)`. Deterministic
validation derives the displayed completion; conflicting/invalid completion operations
are visibly quarantined. Reassignment after completion creates a new active assignment
and never rewrites the recorded completion.

---

## 4. Workflow-template propagation (D4)

### 4.1 Revision-set model

A template edit creates an immutable `TemplateRevision` with a unique `revisionId`,
parent revision IDs, author, D3 HLC, and complete per-step change set. Concurrent offline
edits are distinct revisions, never two mutable “version 8” values. A later composed
revision may name both as parents. The template’s displayed head is a revision set/graph,
not an integer version.

Each workflow instance records:

```
acceptedRevisionIds: add-wins OR-Set<revisionId>
displayedRevisionSet: revision-set          // only complete applied change-set
steps[stepId or local:<uuid>]:
  origin: template | local
  derived[field]: { value, sourceRevisionId, sourceOperationId }
  removalRequestedBy: OR-Set<revisionId>
  detachedFromTemplate: bool
  progress: status, assigneeUserId, stepNotes, completion operations, outcome
```

An immutable, append-only decision ledger is keyed by
`(instanceId, revisionId, stepId, field)`. Each decision entry records `accepted` or
`rejected`, its source operation ID, and any superseded/re-offered state with its
successor entry. A rejection persists for that field until a **descendant** revision
changes that same field, at which point the new value is re-offered; unrelated descendant
changes do not silently reopen it.

Derived fields are exactly title, description, order, required, default assignee role,
and due offset. Progress and local steps are never propagation targets. There is no
`templateFieldsRev` and no integer `templateVersionApplied`.

### 4.2 Offer, review, and transactional apply

For each active instance and applicable revision path, create one **per-instance offer**
containing one decision for every changed step/field. The review screen is per instance,
defaults all decisions to accept, supports per-step accept/reject toggles, and supports
batch approve-all. This gives the required per-instance review while preserving the
per-step choice. The offer reads and appends decision-ledger entries; it does not infer a
past rejection from `acceptedRevisionIds` alone.

An apply target is deterministic: take its full target closure, order revisions
topologically over the revision graph, and resolve same-field collisions with the Field
Merge Contract’s HLC/operation-ID rule. If concurrent heads remain unresolved for review,
the offer shows an explicit **concurrent-head review required** state and cannot silently
pick one. Applying an accepted offer calculates this deterministic composed change-set
from the instance’s accepted revision set to the selected target. It writes, in one local
SQLCipher transaction: instance CRDT changes; propagation event; immutable operations;
activity outbox; and approval/notification outbox. The outbox sends the encrypted CRDT
transaction, waits for its durable relay acceptance, then sends its dependent
notification idempotently. No displayed revision set advances until every required
accepted change in that change-set is present. Rejected decisions are recorded in the
immutable ledger and leave that field’s source revision unchanged.

Template removal writes `removalRequestedBy`, not an immediate deletion. After every
merge, deterministic reconciliation checks progress. Any step whose status is not the
Field Merge Contract constant `UNTOUCHED = 'todo'`, or that has notes, completion,
outcome, or assignment history in append-only `assignmentOperations` stays visible and sets
`detachedFromTemplate = true`; only a genuinely untouched step can be hidden. This
re-runs correctly when offline progress arrives after a removal decision.

### 4.3 Conditional undo

Undo is an explicit compensating proposal. For each derived cell or added untouched step,
it restores/removes only when the current `sourceOperationId` is exactly the operation
being undone and no later accepted revision changed it. All other cells remain intact and
are reported as “not undone because later template work exists.” Undo never changes
progress, notes, assignments, completion operations, or outcomes. It creates a new
event/outbox transaction rather than lowering a mutable template version.

### 4.4 Propagation properties P1-P10

- **P1 Completed outcome immutable.** Apply and undo never alter a valid completion
  operation, `completedBy`, or outcome.
- **P2 No destructive removal.** A removal with any merged progress remains visible and
  detached; it is never deleted.
- **P3 Idempotent revision application.** Reapplying an accepted revision/offer or its
  decision-ledger entry causes no additional state change.
- **P4 Concurrent-apply convergence.** Equivalent offers use the same target closure,
  topological order, and Field Merge Contract collision rule, so they converge to the
  same instance state and accepted revision set. Unresolved concurrent heads are an
  explicit review state, never a device-local choice.
- **P5 Complete revision-set pinning.** An instance displays a target revision set only
  after every required composed change is present; rejected fields retain their prior
  explicitly recorded source revisions and immutable rejection ledger entries until a
  descendant revision changes that field and re-offers it.
- **P6 Progress invariance.** Propagation never modifies status, `assigneeUserId`, notes,
  completion operations, or outcome.
- **P7 Conditional undo scope.** Undo restores only still-untouched derived cells from
  its own operation and reports every later-changed cell it leaves alone.
- **P8 Added-step uniqueness.** A template step ID appears once regardless of duplicate
  apply, reconnect, or concurrent review.
- **P9 Monotonic accepted knowledge.** `acceptedRevisionIds` only grows through apply;
  the immutable decision ledger preserves accepts, rejects, supersession, and re-offers;
  undo adds a compensating event and never erases revision history.
- **P10 Reassign-after-complete.** A completed step’s outcome stays intact; later
  reassignment creates a new active assignment rather than changing the completion.

---

## 5. Server-blind views and freshness

Each device computes task lists, workflow dashboards, activity, and overdue views from
its decrypted firm docs and the client docs it currently holds. Walled client content is
locked; only the accepted operational shell remains. Search is local SQL FTS and is never
synced.

Every view displays **Live**, **Syncing**, **Last synced**, or **Offline**. A view is
authoritative only when every contributing subscription has applied through its current
watermark. While catching up it is a visible lower-bound, never silently presented as
current. Overdue is a local display calculation only.

---

## 6. Checkpoints, retention, and offline-device rebase (D6)

Retention wins: no raw update, tombstone, or checkpoint predecessor is hard-deleted
before its retention horizon. The checkpoint horizon is at least the retention period.

### 6.1 Validated, chunked checkpoint protocol

1. An eligible admin device creates a checkpoint only after it has durably authenticated
   and applied every update through causal frontier `F`; it may not checkpoint past an
   unreadable or missing cursor.
2. It emits a signed encrypted manifest containing `(matter, doc_id, F)`, Yjs state
   vector, canonical state hash, chunk hashes, key epoch, and generation. It uploads
   encrypted chunks (<=768 KiB) first, then atomically publishes the manifest. The
   relay’s minimal plaintext checkpoint control metadata is only stream, generation,
   frontier, retention eligibility, and validation receipts.
3. Validation is independent reconstruction: a validator loads the prior validated
   checkpoint, replays every contiguous retained raw row through frontier `F`, and
   compares the resulting Yjs state vector and canonical state hash with the manifest.
   Only a matching **signed** validation receipt counts toward the two-validator rule.
   Readers retain the prior valid checkpoint and raw tail until two independent eligible
   clients provide those receipts. Validation failure leaves the previous checkpoint
   authoritative and records a repair alert.
4. Only after the retention horizon, retention eligibility, and two matching signed
   validation receipts may the relay prune raw updates below the checkpoint. It archives
   the manifest and audit record before pruning.

### 6.2 Device retirement/rebase

A device offline beyond the checkpoint/retention horizon, or one with a cursor before
the retained base, cannot merge its old editable CRDT state. The retirement/rebase
decision is made separately for that device in each `org_id`. It exports unsent local
edits to a reviewable encrypted file, discards its stale replicated state, loads the
validated checkpoint, and replays approved exports as new current-epoch operations. This
prevents old edits from resurrecting tombstoned records. Tombstones remain in valid
checkpoints until this retirement rule makes their removal safe.

### 6.3 Other failure rules

Relay loss keeps local reads and writes available through durable outboxes. Reconnect
uses §0.1 rather than assuming a socket backlog is complete. Lost-device deprovision
rotates `firm_home` and every affected client key; already-synced local content cannot be
remotely erased and the trust story says so plainly.

---

## 7. Build-plan checklist

- `SYNC-01` Fix the pre-existing live-sync missed-update defect: multiplexed durable
  subscriptions, watermarks, persistent cursors, paging, and gap repair.
- `SYNC-02` Enforce current key epoch, reseal queued edits, and quarantine failures.
- `SYNC-03` Add `firm_home` provisioning and the exact D1 document router/load limits.
- `NOTIFY-01` Build sender-blind, eligibility-gated sealed envelopes with transactional
  outbox/inbox, `org_id`-scoped acknowledgements, referenced-operation ordering,
  approval-class durable retention, informational TTL/dead letters, key hints, padding,
  and traffic-analysis disclosure.
- `PROP-01` Build revision-set propagation, immutable per-field decision ledger,
  deterministic target closure, per-instance/per-step offers, merge-time removal
  reconciliation, immutable completion operations, and conditional undo.
- `RETENTION-01` Build signed chunked checkpoints, independent validation,
  archive-before-prune, and offline-device rebase.

The test campaign must test P1-P10 one-for-one, the sync race, stale-epoch rejection,
crash recovery for both inbox/outbox, old-wall notification behavior, 80-household load
ceilings, checkpoint corruption, tombstone resurrection, and device rebase.
