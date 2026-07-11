# Adversarial review: not ready to freeze

I found several production-breaking gaps. The existing relay is a solid starting pipe, but its current live-sync behavior can already miss updates. The proposed workflow, notification, and compaction rules need changes before a one-shot build.

I did not change any files.

## Code reality check

These claims hold:

- The relay really is an opaque encrypted update log, split by `(matter_id, doc_id)`.
- HTTP catch-up is paged at 500 updates and writes are idempotent by blob ID.
- The key wrapping, member access, and ethical-wall access checks exist.
- The relay does not compact old updates today.
- The client does use Yjs for shared editing and AES-GCM with the key epoch bound into encryption.

These claims are overstated or false:

1. **“The WebSocket replays the full backlog.” — false.** It sends only the first 500 old updates in `backend/src/server.ts`. It does not page.

2. **“Cursors persist locally.” — not implemented in the existing client.** `MatterSyncClient` always starts at cursor 0. Its cursor is only in memory. The co-edit session also says persistent snapshots are future work.

3. **“Catch up, then go live” is lossless. — false today.** There is a gap between the last HTTP pull and WebSocket subscription.

   - Device pulls through update 600.
   - Another device writes update 601 just after that pull.
   - The first device opens its socket.
   - The server replays only updates 1–500, then waits for future live writes.
   - Update 601 was neither in the pull nor received live.

   **Severity: BLOCKER.** This is real missing shared state, not merely a stale badge.

   **Fix:** subscribe first with a durable `since` cursor, atomically establish a server-side subscription watermark, then page catch-up through that watermark. Or subscribe, pull repeatedly until the pull cursor catches the server’s “subscribed at” cursor, then accept live frames. The WebSocket must support `since`, pagination, and gap repair.

4. **Key rotation can silently skip legitimate late edits.**

   - Alice remains authorized but was offline with epoch-1 key.
   - A wall or removal rotates the matter to epoch 2.
   - Alice reconnects and sends an edit encrypted under epoch 1.
   - The relay accepts arbitrary positive `key_epoch` values; it does not require the current epoch.
   - A current device has replaced its epoch-1 key, cannot decrypt Alice’s update, skips it, and still advances its cursor.

   **Severity: BLOCKER.**

   **Fix:** reject writes below the current epoch after rotation, or retain epoch-key history and explicitly migrate/reseal queued edits before accepting them. Never advance a durable cursor past a blob that was not successfully authenticated and applied.

---

## 1. Per-collection document plan

### Attack: the stated 80-household bootstrap is materially understated

1. The design says a device opens roughly four firm streams plus one record stream for each visible household.
2. With 80 households, that is about **84 live streams per device**, not “a handful.”
3. At ten seats, that is roughly **840 WebSocket subscriptions**, plus:
   - 84 sync tickets per device,
   - 84 initial HTTP catch-ups per device,
   - key fetches,
   - live reconnect storms after a relay restart.
4. The design gives no byte budget for each checkpoint, update rate, or local SQL projection time.

**Flaw:** The plan calls this trivial without capacity math or a connection strategy.

**Severity: MAJOR.**

**Fix:** Set hard targets before freeze: maximum streams/device, maximum bootstrap bytes, maximum initial sync time, maximum checkpoint size, and reconnect behavior. Use a bounded connection pool or multiplex streams over one authenticated socket, rather than one socket per collection.

### Attack: Lane B and Lane C disagree about the basic data layout

1. Lane C says per-client `crm:record` plus `crm:task-notes`.
2. Lane B says each household has many collection streams: people, accounts, facts, notes, tasks, opportunities, workflow instances, service policies, activity, and more.
3. Lane B also calls `__firm__` a pseudo-matter; Lane C calls for a real `firm_home` matter.

**Flaw:** The system cannot be sized, secured, or built from both contracts at once.

**Severity: MAJOR.**

**Fix:** Freeze one topology. Define the exact stream list, real matter identity, key ownership, bootstrap order, and which records are replicated into firm-wide operational shells.

### Attack: checkpoint compaction can resurrect deleted records

1. A device goes offline before task T is deleted.
2. Another device deletes T, later writes a checkpoint, and hard-removes T’s tombstone from the snapshot.
3. The server prunes the old update history.
4. The offline device returns with an old Yjs update that edits T.
5. The checkpoint no longer contains the deletion tombstone, so the old edit can bring T back.

**Flaw:** “After a retention window, no device could still be merging” is not true for a local-first product. Devices can be offline for months.

**Severity: BLOCKER.**

**Fix:** Keep deletion tombstones indefinitely, or establish a real device-retirement and resync protocol. A device older than a compaction generation must discard its old editable CRDT state, load the checkpoint, and replay its local unsent edits through a visible conflict-review process.

### Attack: a bad checkpoint can permanently remove valid data

1. A client skips an undecryptable update but still advances its cursor, as the current client does.
2. That client creates a snapshot claiming it covers that cursor.
3. The relay prunes raw updates below the checkpoint.
4. The skipped update is now gone from both the checkpoint and the raw log.

**Flaw:** The proposed checkpoint rule trusts a client snapshot without proving the client actually applied all prior updates.

**Severity: BLOCKER.**

**Fix:** A checkpoint writer must prove a fully applied causal frontier, never advance past failed decrypts, and publish a signed manifest with Yjs state-vector information. Keep the previous checkpoint and raw tail until independent clients validate the new checkpoint. Define recovery when validation fails.

### Attack: checkpoint blobs may exceed the existing relay’s size limit

1. The current relay caps encrypted updates at 1 MiB.
2. A collection snapshot grows with all tasks, workflow instances, and tombstones.
3. The proposed checkpoint is a whole-document Yjs update.

**Flaw:** No chunking or atomic multi-part checkpoint protocol exists.

**Severity: MAJOR.**

**Fix:** Define a checkpoint manifest plus fixed-size encrypted chunks, hash each chunk, upload all chunks, then atomically publish the manifest. Readers use only fully published manifests.

---

## 2. Notification envelopes

### Attack: “at least once” is not guaranteed across a crash

1. Alice assigns a task to Bob.
2. Alice’s device writes the task update.
3. Before it durably writes the matching notification to an outbox, the app crashes.
4. The task later syncs, but Bob never receives an assignment notification.

A second failure exists on Bob’s device:

1. Bob receives an envelope.
2. The app advances the inbox cursor or sends an ack.
3. The app crashes before the notification is durably stored and displayed.
4. The server later prunes it.

**Flaw:** The design describes ordering but not an atomic local inbox/outbox transaction.

**Severity: BLOCKER** for approvals and other work that depends on a person being told.

**Fix:** Use a durable transactional outbox created in the same local transaction as the business change. Use a durable inbox table where “store envelope, dedupe ID, advance contiguous cursor, and mark ready to display” is one transaction. Ack only the highest contiguous sequence durably stored, never merely received.

### Attack: a wall does not actually silence old confidential notifications

1. Alice sends Bob a client-confidential mention encrypted under client matter key epoch 1.
2. The notification remains pending because Bob is offline.
3. Bob is walled from that client. The matter rotates to epoch 2.
4. Bob’s device still has the old epoch-1 key.
5. Bob calls the planned `/notify/inbox`.
6. That endpoint only knows Bob is the recipient; it has no matter ID to re-check the wall.
7. Bob receives and decrypts the old confidential mention.

**Flaw:** The “wall silences notifications cryptographically” claim is false for pending pre-wall messages. The existing matter endpoint would deny Bob, but the proposed notification endpoint cannot because it deliberately hides the matter scope.

**Severity: BLOCKER.**

**Fix:** Choose the real trade-off. To block later delivery after a wall, the relay needs a server-checkable authorization scope, normally plaintext `matter_id`, and must re-check access on every inbox fetch and delete/reject pending items after a wall. This leaks matter association to the server. There is no design that provides both revocable delivery and zero server knowledge of the authorization scope.

### Attack: the sender can poison a recipient’s inbox

1. Alice and Bob share matter A.
2. Alice sends a notification to Bob but encrypts it under matter B, which Bob cannot access.
3. The proposed anti-spam check passes because Alice and Bob share at least one matter.
4. Bob cannot decrypt the envelope and holds it forever.

**Flaw:** “Share at least one matter” does not prove the envelope uses a key the recipient may use.

**Severity: MAJOR.**

**Fix:** Bind each notification to an authorization scope that the relay can validate, or use a recipient-device encrypted key hint that lets Bob identify the intended key without trial-decrypting every household key. Treat permanently undecryptable envelopes as a defined, auditable error state, not an endless backlog.

### Attack: key trial is not “a bounded handful”

1. A recipient has the firm key and 80 household keys.
2. A batch of 500 notifications arrives.
3. The design says try the firm key, then all held client keys.
4. In the worst case this causes roughly 40,000 AES-GCM attempts for one page.

**Flaw:** The number of seats does not bound the number of household keys.

**Severity: MAJOR.**

**Fix:** Add a recipient-only encrypted key hint or a per-recipient wrapped content-key header. The server need not read it, but the recipient must identify the correct key in constant time.

### Attack: the relay learns more than the design’s privacy summary implies

1. The relay sees the sender seat, recipient, byte size, send time, first delivery time, and acknowledgment time.
2. It also sees the sender’s matter oplog writes.
3. A matter update immediately followed by a notification to Bob strongly links that notification to the matter and often to the kind of event.
4. Ciphertext size can also classify short assignment notices versus long quoted mentions.
5. `envelope_id` is visible too, but the spec does not require it to be a random opaque ID.

**Flaw:** The later leakage section admits some metadata, but understates traffic correlation, type inference from size, and semantic leakage from a carelessly formed envelope ID.

**Severity: MAJOR.**

**Fix:** State these in the trust model. Require a random fixed-format envelope ID, pad ciphertexts into size bands, batch or delay sends where practical, and explicitly accept that server traffic analysis can infer collaboration patterns and likely matter association.

### Attack: backlog “collapse” cannot work as written

1. Bob is offline for months.
2. His inbox reaches the cap.
3. The server cannot read or create an encrypted “N earlier notifications” envelope.
4. If it drops old approval requests, Bob loses the prompt that told him to act.
5. If it keeps them, the cap did not solve storage growth.

**Flaw:** The proposed server-side collapse assumes the blind relay can synthesize encrypted content.

**Severity: MAJOR.**

**Fix:** Keep action-required notifications until the underlying task/approval is resolved. For informational notices only, return an unencrypted count as explicit metadata and rebuild the visible inbox from authoritative synced state. Define whether notification acknowledgment is per user or per device; the current table is per user while the client plan is per device.

---

## 3. Offline conflict semantics

### Attack: a losing edit can be silent because activity is a separate document

1. Alice is offline and changes a task due date from July 10 to July 17.
2. Her task update is durably queued.
3. The corresponding activity event is supposed to be written to a separate activity document.
4. The app crashes before that activity event is durably queued.
5. Bob, also offline, changes the same due date to July 20.
6. On merge, the LWW/HLC rule picks Bob’s value.
7. Alice’s task update reaches the shared task doc, but her activity event never does.

**Flaw:** The design promises “every field write also appends an activity event,” but gives no atomic cross-document write or recovery rule. Alice’s losing edit is silently lost.

**Severity: BLOCKER.**

**Fix:** Put a durable immutable operation record in the same authoritative transaction as the field change, then derive activity from that operation log. If activity remains separate, use a local database transaction plus a recoverable outbox and an invariant checker that repairs every missing activity entry.

### Attack: even a successfully synced activity entry cannot prove the claimed outcome

1. Alice and Bob edit the same due date offline.
2. Both activity entries sync.
3. Lane C’s activity schema contains `type`, `subject_ref`, and `label_ref`.
4. It does not include the changed field, proposed value, winning operation ID, or losing operation ID.
5. The UI cannot truthfully show: “Alice set July 17; Bob set July 20, kept.”

**Flaw:** The schema does not contain the evidence required by the promised conflict explanation.

**Severity: MAJOR.**

**Fix:** Each field-write operation needs an immutable operation ID, entity ID, field name, proposed encrypted value or protected value reference, causal stamp, and resolution status. The current field must point to the winning operation ID.

### Attack: the clock rules contradict each other

1. Lane C says no wall clock is trusted for conflict resolution.
2. Lane B defines LWW using a hybrid logical clock whose first component is wall-clock milliseconds.
3. A device with a badly future-set clock can win over a later real-world edit.

**Flaw:** The two frozen contracts choose different truth rules.

**Severity: MAJOR.**

**Fix:** Pick one rule. Use a proper HLC with server-observed bounds only if that metadata is acceptable, or use causal revision IDs plus explicit conflict review for high-risk fields. Do not claim wall clocks are irrelevant while making them the first comparison term.

---

## 4. Workflow propagation

### Narrow case that holds

If two devices apply the exact same template change to the same instance, and both write the exact same derived fields, Yjs maps will normally converge. Also, a normal progress edit remains safe if propagation truly never writes progress fields.

That is only the easy case.

### Attack: two admins make different “version N+1” template edits offline

1. Template is at version 7.
2. Admin A, offline, changes step S title and saves what she calls version 8.
3. Admin B, offline, changes S’s required flag and also saves what he calls version 8.
4. Their template CRDT state merges into a combined template.
5. Their propagation diffs are both labeled `N+1 = 8`.
6. Whichever propagation is applied first sets `templateFieldsRev = 8`.
7. The second propagation is skipped by the `< N+1` guard, even though it contains a different real change.

**Flaw:** Numeric version labels are not unique concurrent revisions. The “same version means same deterministic diff” assumption is false.

**Severity: BLOCKER.**

**Fix:** Replace mutable integer versions with immutable revision objects: unique revision ID, parent revision IDs, author, and complete change set. Build a revision graph. An instance records which revision IDs it has accepted. Concurrent template edits become separate revisions that can be merged into a new revision or reviewed separately.

### Attack: version 3 can claim success while omitting version 2’s changes

1. Instance I is at template version 1.
2. Version 2 changes `required`.
3. Version 3 changes `title`.
4. Admin A applies version 2 while offline.
5. Admin B applies version 3 first on another device.
6. B sets `templateFieldsRev = 3`.
7. A’s later version-2 application is skipped because `3 < 2` is false.
8. The instance can show version 3 while still retaining the version-1 `required` value.

**Flaw:** A per-step `templateFieldsRev` cannot prove every field matches the claimed template version.

**Severity: BLOCKER.**

**Fix:** Track source revision per derived field, not one number for a whole step. More importantly, apply a fully composed revision path from the instance’s accepted revision set to the chosen target revision. Never advance the instance’s displayed template revision until its required change set is present.

### Attack: removal races with offline progress

1. Template step S is `todo`.
2. Admin A removes S and approves propagation while offline.
3. The algorithm sees `todo` and soft-removes S.
4. Bob, offline, starts S and adds notes.
5. Both changes merge.
6. The resulting step has progress but is already tombstoned; no rule re-runs the removal decision to set `detachedFromTemplate = true`.

**Flaw:** The design decides whether progress exists from a stale local snapshot. It violates its own “never delete recorded work” rule after merge.

**Severity: BLOCKER.**

**Fix:** Represent template removal as immutable “removed by revision R,” not an immediate instance deletion. Derive visibility from the merged state: if any progress exists, the step remains visible and detached. Add a deterministic reconciliation rule that runs after every merge.

### Attack: partial approval has two incompatible contracts

1. Lane C offers one checkbox per instance: apply all changes or none.
2. Lane B requires one propagation offer per changed step, with each offer independently accepted or rejected.
3. An advisor wants to add a new checklist step but reject the removal of a progressed step.

**Flaw:** The user-facing decision model is contradictory. One contract cannot produce the other result.

**Severity: MAJOR.**

**Fix:** Freeze one model. The safer choice is immutable per-step offers, with explicit accepted/rejected decisions, and an instance revision derived only when every required offer is resolved.

### Attack: undo overwrites later template work

1. Version 2 changes step title from A to B and is applied.
2. Version 3 changes that title from B to C and is applied.
3. Someone undoes the version-2 propagation event.
4. The stated undo restores its saved prior value A.
5. A now overwrites C, even though version 3 was later work.

**Flaw:** “Undo only touches template-derived fields” does not make it safe. It still destroys later template-derived edits.

**Severity: BLOCKER.**

**Fix:** Undo must be conditional: only reverse a cell when its current source operation is exactly the event being undone. Otherwise create a visible compensating proposal or conflict, never blindly restore an old value.

### Attack: “write once” completed fields are not enforced by Yjs

1. A completed step has `completed_by` and `outcome`.
2. A buggy or old client writes another value directly into the Yjs map.
3. Yjs resolves it like any other mutable map value.

**Flaw:** Calling fields immutable in a schema does not make them immutable in a peer-written CRDT.

**Severity: MAJOR.**

**Fix:** Store completion as an immutable append-only completion operation keyed by step and completion ID. Derive the displayed completion from deterministic validation rules. Reject or visibly quarantine conflicting completion operations.

---

## Required freeze changes

Do not freeze this design until it has:

1. A lossless relay subscription protocol with persistent cursors and gap repair.
2. A real key-epoch policy that never accepts or skips unreadable stale writes.
3. A revision-graph propagation model, not shared mutable integer template versions.
4. A conditional undo model.
5. A durable transactional activity/outbox/inbox design.
6. An honest wall-delivery decision: either server-visible authorization scope or weaker post-wall notification guarantees.
7. A chunked, validated checkpoint protocol and an offline-device retirement/rebase rule.
8. One reconciled data topology shared by Lane B and Lane C.
9. Concrete 80-household load budgets and tests for bootstrap, restart, offline return, wall changes, and compaction.

DONE-EXIT
