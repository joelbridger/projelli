# Round-2 sync attack — 2026-07-11

## Part 1: round-1 closure audit

| Round-1 finding | Status | Evidence in rewritten 03 |
|---|---|---|
| Live sync only replays 500 updates; cursor was not durable; pull-then-subscribe lost updates | PARTIAL | §0 requires durable SQLCipher cursors; §0.1 says “subscribe… watermark `W`… page… through `W`… gap repair.” It fixes the old gap, but omits duplicate-cursor handling required by the merged subscribe-first relay. |
| Old-epoch queued writes can become unreadable and silently skipped | FIXED | §0: relay accepts “only at the current epoch”; queued work is resealed or sent to visible export/review; clients do not advance past an unauthenticated blob. |
| 80-household bootstrap lacked connection and byte limits | PARTIAL | §1.3 adds one multiplexed socket, document cap, transfer caps, and time caps. The numeric table conflicts with later limits and excludes confidential task-notes loading. |
| Lane B/C topology disagreement | PARTIAL | §1.1 clearly freezes `firm_home` plus per-household `crm:record`. But 02 still defines workflow data under `__firm__` and uses the retired integer revision model. |
| Compaction can resurrect deleted records | FIXED | §6.2 forces stale devices to discard old editable state, load a checkpoint, and replay approved local exports; tombstones remain until that procedure makes removal safe. |
| Bad checkpoint can permanently erase an update | PARTIAL | §6.1 requires an applied frontier, manifest, chunks, and two client validations. It does not define validation as replay-and-compare against the raw log, so a self-consistent but incomplete checkpoint can still be approved. |
| Checkpoint exceeds relay’s 1 MiB write limit | PARTIAL | §6.1 says chunks are `<=768 KiB`, which is correct. §1.3 simultaneously permits `<=2 MiB per checkpoint chunk`, which is not. |
| Crash between business change and notification outbox loses notice | PARTIAL | §2.3 correctly makes mutation, operation, activity, and notification outbox one SQLCipher transaction. Approval notices can still expire before an offline recipient ever receives them. |
| A later wall cannot retract pending confidential notification without scope metadata | FIXED | §2.2 explicitly accepts the weaker guarantee and explains why: no persisted scope means pending old-key messages can survive until expiry. |
| Sender can send an envelope under a key the recipient lacks | FIXED | §2.1 requires the relay to check the recipient’s current relevant key grant; §2.4 defines a durable dead-letter state if decryption still fails. |
| Trying every client key is unbounded | FIXED | §2.1 adds a recipient-only encrypted key hint for constant-time key selection. |
| Relay metadata and traffic analysis were understated | FIXED | §2.4 requires random opaque IDs, size bands, batching, and explicitly accepts timing/correlation leakage. |
| Blind relay cannot “collapse” old notices into a synthetic encrypted summary | PARTIAL | §2.3 correctly forbids synthetic summaries and preserves authoritative state, but its TTL still drops unresolved approval delivery envelopes. |
| Losing offline edit can disappear because activity is separate | FIXED | §1.2 and §3 require immutable operation records plus a repairable activity outbox in the same transaction as the mutation. |
| Activity cannot prove which competing value won | FIXED | §1.2 requires operation ID, entity, field, proposed value/reference, HLC, predecessor/winner links, and current-field winner pointer. |
| HLC/wall-clock rules conflict | PARTIAL | §3 adds a five-minute clamp, but 02’s canonical Field Merge Contract still defines raw `wallMillis` ordering and does not include that clamp. |
| Concurrent template edits collide at mutable version N+1 | PARTIAL | §4.1 correctly introduces immutable revisions and parent graphs. 02 still makes `rev: number` the propagation mechanism. |
| Displayed version can skip required prior changes | PARTIAL | §4.2/§4.4 add composed change-sets and per-field source revisions. The canonical 02 model still uses numeric `displayedTemplateRev` and `derivedFieldRevs`. |
| Removal races with offline progress | PARTIAL | §4.2 correctly re-runs reconciliation after merge, but it calls only `open` untouched while 02 defines untouched workflow steps as `todo`. |
| Per-instance versus per-step approval conflict | FIXED | §4.2 defines one per-instance offer with per-step/per-field accept-reject choices. |
| Undo overwrites newer template work | FIXED | §4.3 requires `sourceOperationId` to exactly match the operation being undone. |
| “Immutable” completion fields are mutable Yjs fields | PARTIAL | §3 and §4 require append-only completion operations and derived display state. 02 still lists `completedAt` and `completedBy` as LWW mutable fields. |

## Part 2: new findings

### SA2-1 — BLOCKER: duplicate relay rows are treated as gaps

**Interleaving**

1. A device subscribes from durable cursor 700 and receives watermark 730.
2. It backfills 701–730 over HTTP.
3. The subscribe-first relay also delivers a row from the subscribe-to-watermark window that the device already applied, such as cursor 730.
4. §0.1 says any cursor that is not “the next expected cursor” triggers gap repair.
5. Cursor 730 is not the next expected cursor after 730; it is a duplicate, not a gap. The device can repeatedly repair or remain non-live.

The real relay behavior allows duplicate delivery in this window. The design assumes strict exactly-once cursor delivery.

**Minimal spec fix**

Before gap detection, require:

```text
if cursor <= durableCursor: verify same immutable row identity, ignore it;
if cursor == durableCursor + 1: authenticate/apply in one transaction;
if cursor > durableCursor + 1: run bounded gap repair.
```

State explicitly that CRDT application and cursor persistence are idempotent by relay cursor/blob ID.

---

### SA2-2 — BLOCKER: approval delivery promise contradicts seven-day TTL

**Interleaving**

1. Alice creates an approval request; the mutation and approval envelope enter the transactional outbox.
2. Bob’s only active device is offline for eight days.
3. The relay expires the envelope after seven days, without a durable inbox record or acknowledgement from Bob.
4. Bob later reconnects. The workflow record may show an outstanding approval, but the promised approval notification was never delivered.

§2.3 says approval-class notices are “crash-survivable end to end” and says unresolved action prompts are never dropped merely for a cap. Expiry drops them anyway.

**Minimal spec fix**

Approval-class envelopes must remain until the underlying approval reaches a terminal state and every active recipient device has durably stored it, or the sender/client must reliably reissue the same approval notice after reconnection. Informational notices may keep the seven-day TTL. If the intended promise is only “the approval state survives,” narrow the promise and stop calling approval notification delivery end-to-end durable.

---

### SA2-3 — BLOCKER: 03 does not compose with the canonical merge contract it names

**Interleaving**

1. An untouched workflow step has status `todo`, as defined by 02.
2. An admin removes that template step.
3. §4.2 of 03 treats every status other than `open` as progress.
4. The untouched `todo` step is therefore kept visible and detached instead of hidden.

The same mismatch remains for the core propagation model: 03 uses revision IDs, revision sets, source operation IDs, and append-only completion operations. 02 still defines `rev: number`, `displayedTemplateRev`, numeric `derivedFieldRevs`, and LWW `completedAt`/`completedBy`.

This lets two implementers build incompatible merge behavior while each follows a supposedly binding document.

**Minimal spec fix**

Make 02’s types and Field Merge Contract exactly match 03/D4:

- replace numeric propagation revisions with immutable revision IDs and revision-set state;
- define a per-field decision/source-operation ledger;
- make completion operations append-only and display completion derived;
- use one canonical untouched status, or name it as a contract constant instead of writing `open` in 03.

---

### SA2-4 — BLOCKER: checkpoint “validation” does not prove completeness before pruning

**Interleaving**

1. A checkpoint writer has a local defect and emits a state missing applied cursor 499, but labels its manifest frontier `F=500`.
2. Its encrypted chunks, state vector, and hash are internally consistent with the incomplete state.
3. Two other clients download the chunks and “verify” their hashes/state vector, as §6.1 requires.
4. The relay prunes raw updates through 500 after retention.
5. Cursor 499 is gone from both the raw log and all retained checkpoints.

Hashing a checkpoint proves it was transferred intact. It does not prove it was derived from every raw update through `F`.

**Minimal spec fix**

Define validation as an independent reconstruction:

```text
validator loads prior validated checkpoint;
validator replays every contiguous retained raw row through F;
validator compares resulting Yjs state vector and canonical state hash to manifest;
only matching signed validation receipts count toward the two-validator rule.
```

The relay also needs explicit, minimal checkpoint control metadata—stream, generation, frontier, retention eligibility, and validation receipts—so it can publish and prune without reading encrypted content.

---

### SA2-5 — MAJOR: document and notification outboxes have no remote ordering rule

**Interleaving**

1. Alice approves a propagation change. One local transaction creates both the CRDT outbox row and the approval-envelope outbox row.
2. The network worker sends the envelope first; the relay accepts it.
3. Bob receives and displays the envelope before Alice’s CRDT update reaches the relay.
4. Bob follows the encrypted subject pointer but cannot find the approval or its current state.

This is not fixed by local atomicity. The two remote writes are independent.

**Minimal spec fix**

Make the envelope outbox depend on successful relay acceptance of the referenced document operation, identified by immutable operation/blob ID. The recipient must keep an envelope in “waiting for referenced state” until the matching operation is durably applied.

---

### SA2-6 — MAJOR: the load ceilings are internally inconsistent and omit a real stream

The table permits `<=2 MiB per checkpoint chunk`; §1.3 later requires `<=768 KiB` because the relay limit is 1 MiB. Those cannot both be hard ceilings.

Also, 17 allowed subscribed documents at 16 MiB each can require far more than the claimed 64 MiB bootstrap transfer. Finally, opening a client can fetch `crm:task-notes`, an additional logical document with no count, byte, tail-update, or completion-time ceiling.

**Minimal spec fix**

Use one number: `768 KiB ciphertext maximum per chunk`. Add a total bootstrap allocation across firm docs, client records, task-notes, checkpoints, and tails; then make the sum fit 64 MiB. Count `crm:task-notes` in the subscription and transfer budgets.

---

### SA2-7 — MAJOR: notification cursors and acknowledgements have ambiguous organization scope

`notify_envelopes` includes `org_id`, but `notify_device_acks`, the notification cursor in §0, and every notification API example omit it.

**Interleaving**

1. One person uses the same device in two firms.
2. The server provides an organization-scoped inbox, but acknowledgements are stored only by `(recipient_user_id, device_id)`.
3. An acknowledgement from firm A advances the shared cursor beyond unseen firm-B rows.
4. The relay treats the device as having acknowledged firm-B notices and can prune them.

If the inbox is intentionally cross-firm, the API instead needs to say so and enforce that a device receives all firms’ rows before it may advance a global cursor.

**Minimal spec fix**

Scope every notification sequence, cursor, inbox query, acknowledgement, idempotency key, and device-retirement decision by `org_id`; or explicitly define and test one all-organizations inbox with a single global ordering.

---

### SA2-8 — MAJOR: partial revision acceptance is not represented precisely enough

**Interleaving**

1. Revision R1 changes a step title. The instance rejects that one field.
2. Revision R2, parented from R1, changes the step’s due offset. The instance accepts it.
3. The instance’s `acceptedRevisionIds` grows, but that set cannot express “R1 is known, its title was intentionally rejected, while R2’s offset was accepted.”
4. A later composed change-set may either silently overwrite the rejected title or permanently skip it without a defined review rule.

A revision set alone cannot model per-field rejection.

**Minimal spec fix**

Persist an immutable decision ledger keyed by `(instanceId, revisionId, stepId, field)`, including accepted/rejected decision, source operation, and whether a later revision supersedes or re-offers it. Define whether rejection is permanent or must be reconsidered when a descendant revision changes the same field.

---

### SA2-9 — MAJOR: graph target selection is not deterministic for concurrent revisions

03 says an apply calculates a composed change-set “to the selected target,” but its target is a revision graph/set, not one ordered version.

**Interleaving**

1. Admin A and B make concurrent edits to the same derived field.
2. Both revisions are valid graph heads.
3. One device applies target A; another applies target B.
4. A later composed revision names both parents.
5. The design does not say whether the composed target includes both changes, how same-field collisions are ordered, or what an offer must show.

P4 only promises convergence for “equivalent offers,” leaving the normal non-equivalent case undefined.

**Minimal spec fix**

Define target closure, deterministic topological ordering, same-field conflict resolution using the D3 HLC/operation-ID rule, and an explicit review state for unresolved concurrent heads.

---

### SA2-10 — MAJOR: HLC clamp is outside the contract it claims to follow

03 says every HLC physical component is clamped to relay-observed time plus five minutes. 02’s named canonical Field Merge Contract says higher raw `(wallMillis, logicalCounter, actorId)` wins and never defines the clamp, the stored relay-observed time, or offline behavior before any relay observation.

A future-clock client can still win if implementation follows 02.

**Minimal spec fix**

Move the full HLC issuance and clamp algorithm into 02’s Field Merge Contract, including no-prior-observation behavior, persisted relay-time state, and rejection/quarantine behavior for invalid old-client stamps. Have 03 only reference that rule.

VERDICT: NOT-READY (4 blockers)
