# 03 — Sync, Notifications & Propagation (Lane C)

**Status:** Design-phase deliverable, frozen-spec quality. Build the system-of-record
multi-user layer from this file without further questions.
**Scope:** How CRM records sync between a firm's ≤10 devices over the existing E2EE
relay; the encrypted-envelope notification system (locked decision #3); offline &
conflict semantics; the workflow-template propagation merge algorithm; server-blind
views; failure modes; open questions for the freeze review.

**Contract dependencies (do not duplicate here):**
- Lane B `design/02-data-model.md` owns entity/field definitions and the **per-field
  merge rules** (which fields are last-writer-wins registers vs. CRDT sequences vs.
  append-only). This document references that contract as **[DM-fields]** and never
  redefines a field's merge class. Where a field is named here, its merge class is
  whatever [DM-fields] assigns it.
- Lane A `design/01-wealthbox-feature-matrix.md` owns which features exist.
- This document owns: **doc topology, the relay wire protocol additions, the
  notification transport, the offline/convergence semantics, and the propagation
  algorithm.**

**Everything below is verified against the fork's actual code.** Cited paths are
relative to `/home/jameson/lantern-crm`. Where a capability does **not** exist yet
and must be built, it is marked **[NEW]**.

---

## 0. What exists today (verified rails)

The relay is a **dumb E2EE pipe**, not a CRM backend. Confirmed by reading the code:

- **One append-only oplog table**, `matter_updates`
  (`backend/src/lib/db.ts:181-193`): columns
  `id` (autoincrement = the monotonic catch-up cursor), `matter_id`, `org_id`,
  `doc_id` (default `'_notes'`), `blob_id` (client idempotency key), `ciphertext`
  (BLOB, **never parsed/decoded/logged/hashed**), `author_seat`, `key_epoch`,
  `created_at`. Unique index `(matter_id, doc_id, blob_id)`; order index
  `(matter_id, doc_id, id)`.
- **Stream partitioning** is by `(matter_id, doc_id)`. A `doc_id` is an arbitrary
  string; `'_notes'` is the legacy default. **This is the seam CRM docs ride on** —
  new record types are just new `doc_id`s under a matter.
- **Transport, both directions exist** (`backend/src/routes/matters.ts`,
  `backend/src/server.ts`):
  - **HTTP catch-up:** `GET /matter/:id/updates?since=<cursor>&doc_id=<d>` — returns
    updates strictly after `<cursor>`, in cursor order, **500 rows/page**, with
    `has_more` + `latest_cursor` (matters.ts:320-357).
  - **HTTP push:** `POST /matter/:id/updates` `{ blob_id, ciphertext_b64, seat_token,
    key_epoch?, doc_id? }` — idempotent on `(matter,doc,blob_id)`; a duplicate is
    **not** re-broadcast (matters.ts:299-315).
  - **Live WebSocket:** `GET /matter/:id/sync?ticket=<t>&doc_id=<d>` — ticket-authed
    (single-use, 30 s TTL, minted by `POST /matter/:id/sync-ticket`;
    `syncTickets.ts`). On open the relay sends a `ready` frame, replays the full
    backlog (`since=0`) as `update` frames, then live `update` frames + `presence`
    frames (server.ts:222-262). **Inbound socket frames are ignored** — every write
    goes through the audited HTTP POST.
  - There is **no long-poll**; catch-up is a bounded paged GET, liveness is the WS.
- **Client sync engine:** `src/platform/firm/MatterSyncClient.ts` drives **one Yjs
  doc per `(matter, doc_id)` stream**: catch-up → live WS → encrypt-and-push local
  Yjs updates. It already handles offline (pending-update queue + exponential
  backoff reconnect 1 s→30 s), key-epoch advance (`onKeyEpochAdvanced` → host rotates
  key), and skips undecryptable blobs. **Convergence is Yjs's**, not ours.
- **Crypto envelope** (`src/platform/firm/matterCrypto.ts`): each blob is
  `[1B version=1][12B IV][AES-256-GCM ct+tag]`, base64; `key_epoch` is bound as GCM
  **AAD** so an old key + new epoch fails authentication by construction.
- **Key distribution — mature.** Device ECDH P-256 pubkeys registered
  (`POST /device/register`); the per-matter AES key is wrapped per
  `(matter, epoch, user, device)` and published/fetched
  (`POST /matter/:id/keys/{publish,fetch}`, `matterKeyService.ts`, `keyWrap.ts`,
  `deviceKeys.ts`). Admin escrow copies are included. **Auto-republish** on device-set
  drift (`deviceSetFingerprint` + `autoRepublishHeldMatterKeys`) already exists.
- **ACL / walls — mature, fail-closed.** `resolveAccess` = `(member ∨ org-admin) ∧
  ¬walled`, one place, audited (`backend/src/lib/matters.ts:52-124`). Removing a member
  or setting a wall **bumps `key_epoch`** and deletes the affected wrapped keys
  (matters.ts:129-203; db.ts:1391-1439), forcing re-wrap at the new epoch.
- **`POST /matter/mine`** lists the matters a user may access (member ∧ ¬walled),
  with `key_epoch` and role (`matterKeys.ts:154-168`).

**What does NOT exist and must be built ([NEW]):**
1. Any **notification / inbox / push** surface (grep-confirmed: zero rows).
2. Any **oplog compaction / GC** — `matter_updates` is appended forever; a fresh
   device replays from cursor 0 (grep-confirmed: no `DELETE FROM matter_updates`,
   no snapshot pruning).
3. A **firm-wide (cross-client) doc scope** — every stream today lives under one
   client matter; there is no firm-home scope for a firm-wide task board.
4. CRM record **Yjs doc schemas** (only the `.docx` schema exists in `docCrdt.ts`).

---

## 1. Sync topology

### 1.1 Two scopes, mapped onto the existing matter/doc_id rails

Every relay stream must live under **some** `matter_id`. CRM has two natural ACL
scopes, so we introduce exactly one new matter kind and reuse everything else.

| Scope | Matter | Who holds the key | Doc streams (doc_id) |
|---|---|---|---|
| **Firm-wide** | **Firm-home matter** `firm_home` **[NEW]** — one synthetic matter per org, every active non-walled seat is a member | Every firm member's device (wrapped on the existing rails) | `crm:tasks`, `crm:workflows`, `crm:directory`, `crm:activity:<bucket>` |
| **Per-client** | The existing client matter (one per household) | Members of that matter, minus walled users (key denial) | `crm:record`, `crm:task-notes`, `_notes` (legacy client map/notes), per-`.docx` streams (existing) |

- **`firm_home` is an ordinary matter** created at org-claim time. It uses the exact
  membership/wrapped-key/epoch machinery: add a seat → wrap `firm_home` key to their
  devices; deprovision a seat → bump `firm_home` epoch + re-wrap to the rest.
  Ethical walls are **never** set on `firm_home` (a wall is a per-client screen; a
  firm member always sees the operational board). Enforce this in the admin API:
  reject `wall/set` where `matter_id == firm_home`.
- **Client matters are unchanged.** Their key is denied to walled users, which is
  how per-client confidentiality stays cryptographic.

### 1.2 The plaintext-scope / encrypted-content split (the load-bearing idea)

The firm task board and activity feed are **firm-visible by design** — that is what a
team task list *is*. To keep walls meaningful we split every firm-wide entity into:

- an **operational shell** in the firm-home doc (sealed under the firm-home key,
  readable by all members): only `client_matter_id` + non-identifying operational
  fields (assignee, status, due date, priority, template-step key, logical `rev`);
- **sensitive content** in the client matter doc (sealed under the client key,
  denied to walled users): title/description free text, notes, the household record,
  attachments.

So a walled user's device holds the firm-home key and *sees* "task on
`client_matter=abc`, assignee Alice, due Fri, status open," but **cannot resolve**
who `abc` is or what the task says (no client key → `crm:record` / `crm:task-notes`
don't decrypt). This is the same "queryable scope + encrypted body" pattern the RAG
`chunks` table already uses, extended to tasks. The residual metadata leak
(assignee/status/due of a walled client's task is visible firm-wide) is **explicitly
accepted** — see §2.6 and §7-Q1.

> **Rule for content authors / AI:** never place client-identifying text in an
> operational-shell field. Titles shown on the board resolve from the client doc; the
> shell carries a `title_ref`, not the title. For a firm with no walls this is moot;
> the split exists so that turning on a wall is cryptographically honest.

### 1.3 Doc granularity: **per-collection, not per-entity** (decision)

**Decision: one Yjs doc per collection (a keyed map of many entities), NOT one doc
per entity.** Reasoning, at the ≤10-seat target:

- **Doc count / fan-out.** Per-entity means one relay stream, one WS channel, one
  catch-up request, and one wrapped-key lifecycle **per task/contact/event**. Northcrest
  alone is 80 households × (tasks + notes + events + record) → thousands of streams and
  thousands of WS subscriptions per device on bootstrap. Per-collection is a **fixed
  handful of firm docs + one `crm:record` per client the member can see** — order tens
  of streams per device, not thousands. Yjs holds many entities inside one doc
  efficiently (a `Y.Map<entityId → Y.Map>`), and a single WS channel carries all of a
  collection's deltas.
- **10-seat scale.** 10 devices × ~4 firm docs + ~(clients-visible) record docs is a
  trivial subscriber matrix for the in-process `FanoutHub`. Per-entity would blow the
  in-memory channel map up by 100–1000×.
- **Where per-entity would win** (thousands of huge entities, selective sync of one
  entity, per-entity ACL) does not apply: entities are small, the firm syncs
  everything it's entitled to, and ACL is per-matter, not per-entity.

**The one exception — the activity feed is append-only and unbounded**, so a single
all-time doc would bloat and every fresh device would replay all history. Activity
uses **time-bucketed collection docs**: `crm:activity:<YYYY-Qn>` (per quarter). A
device live-syncs only the current bucket + lazily catches up prior buckets on demand
(scroll-back). Closed buckets are snapshot-compacted (§6.4) and never re-grow.

### 1.4 Yjs doc schemas [NEW]

All entities are **soft-delete keyed maps** (tombstone flag, never a hard array
removal — see §3.3). Field merge classes come from **[DM-fields]**; the shapes below
are the CRDT container structure only.

```
Firm-home matter, doc_id = "crm:tasks"
  Y.Doc
    tasks : Y.Map<taskId → Y.Map>          // operational shells
      task Y.Map:
        id                : string  (stable uuid, == entity id)
        client_matter_id  : string  (plaintext scope ref; may be firm_home for internal tasks)
        assignee_user_id  : LWW      [DM-fields]
        status            : LWW  'todo'|'doing'|'done'|'blocked'   [DM-fields]
        due_date          : LWW  ISO date (calendar date, not a clock)  [DM-fields]
        priority          : LWW      [DM-fields]
        title_ref         : string   // pointer into the client doc; NOT the title text
        workflow_ref      : { instanceId, stepKey } | null
        rev               : LWW int   // per-entity Lamport counter (§3.4)
        completed_by      : LWW user_id | null   (immutable once set — §4 P1)
        completed_rev     : LWW int   | null     (immutable once set)
        deleted           : LWW bool  (tombstone)  [DM-fields]
        deleted_by        : LWW user_id | null

Firm-home matter, doc_id = "crm:workflows"
    instances : Y.Map<instanceId → Y.Map>   // see §4.1 for the full instance shape

Firm-home matter, doc_id = "crm:directory"
    households : Y.Map<clientMatterId → Y.Map>   // lightweight index
      { client_matter_id, display_ref, status, tags:Y.Array, rev }   // no PII in shells

Firm-home matter, doc_id = "crm:activity:<YYYY-Qn>"
    events : Y.Array<Y.Map>   // append-only; each { id, ts_rev, actor_user_id,
                              //   type, subject_ref:{matter_id,entity_id}, label_ref }

Client matter, doc_id = "crm:record"
    the household's structured record (contacts, accounts, relationships) — [DM-fields]

Client matter, doc_id = "crm:task-notes"
    notes : Y.Map<taskId → Y.Text>   // the confidential body/description of tasks
```

### 1.5 New-device bootstrap (exact sequence)

1. **Device keypair** — `getOrCreateDeviceKeypair()` (ECDH P-256) then
   `registerDevice()` (`POST /device/register`). Existing.
2. **Key delivery** — a key-holder client's `autoRepublishHeldMatterKeys` poll
   notices the new device (device-set fingerprint drift) and re-wraps every matter
   key it holds — including `firm_home` — to the new device. Existing rail; the only
   change is that `firm_home` is in the roster.
3. **Matter list** — `POST /matter/mine` → the matters this user may open, each with
   `key_epoch` + role. `firm_home` is always in the list for an active member.
4. **Fetch keys** — for each matter, `obtainMatterKey` (local hit, else
   `POST /matter/:id/keys/fetch` → unwrap with the device private key → store in OS
   keychain). Existing.
5. **Open streams** — for `firm_home`, open `MatterSyncClient` instances for
   `crm:tasks`, `crm:workflows`, `crm:directory`, and the current
   `crm:activity:<bucket>`. For each visible client matter, open `crm:record` (and
   `crm:task-notes` / `_notes` on demand when the client is viewed).
6. **Catch-up then live** — each client HTTP-catches-up from **cursor 0** (fresh
   device) or its persisted `(matter,doc_id) → cursor` (returning device), applying
   the latest **checkpoint** first (§6.4) so replay is bounded, then goes live on the
   WS. Cursors persist in the local encrypted store keyed by `(matter_id, doc_id)`.
7. **Notification inbox** — open the notify channel (§2.3) and catch up the envelope
   backlog from the persisted inbox cursor.

**Bootstrap cost per fresh device:** ~4 firm streams + one `crm:record` per visible
client, each a bounded checkpoint + tail. No per-entity fan-out.

---

## 2. The envelope notification system (locked decision #3) [NEW]

The core CRM loop is **assign → notify → act**. A peer may be offline, and the relay
**cannot** synthesize "you were assigned X" because the payload is ciphertext it can't
read and no assignment concept lives server-side. So notifications are **client-emitted
encrypted envelopes** delivered through a new per-recipient inbox. The server learns
only *"user X has N pending envelopes,"* per the locked decision.

### 2.1 Relay data model [NEW]

One append-only table, mirroring the oplog's discipline:

```sql
CREATE TABLE IF NOT EXISTS notify_envelopes (
  seq          INTEGER PRIMARY KEY AUTOINCREMENT,  -- per-recipient monotonic cursor
  org_id       TEXT NOT NULL,
  recipient_user_id TEXT NOT NULL,
  envelope_id  TEXT NOT NULL,          -- client idempotency key (dedupe)
  sender_seat  TEXT NOT NULL,          -- attribution; NOT sender content
  ciphertext   BLOB NOT NULL,          -- opaque; sealed under a matter key (§2.4)
  created_at   TEXT NOT NULL,
  delivered_at TEXT                    -- set on first successful pull/ack
);
CREATE UNIQUE INDEX idx_notify_dedupe ON notify_envelopes(recipient_user_id, envelope_id);
CREATE INDEX idx_notify_recipient ON notify_envelopes(recipient_user_id, seq);
```

The server stores **recipient + sender_seat + timestamps + opaque ciphertext + size
only** — structurally identical to the oplog's blindness. There is **no type,
subject, or matter column** (see §2.6 for what that buys and what it doesn't).

### 2.2 Relay API additions [NEW] — exactly three endpoints

```
POST /notify/send    Bearer + X-Seat-Token
   { recipient_user_id, envelope_id, ciphertext_b64 }
   -> { ok, seq, duplicate }         // idempotent on (recipient,envelope_id); org-scoped;
                                      // sender must share ≥1 matter with recipient (anti-spam gate)

GET  /notify/inbox?since=<cursor>    Bearer + X-Seat-Token
   -> { since, cursor, latest, has_more,
        envelopes:[{ seq, envelope_id, sender_seat, created_at, ciphertext_b64 }] }
   // recipient == caller only; 500/page; same paged shape as /matter/:id/updates

POST /notify/ack     Bearer + X-Seat-Token
   { up_to_cursor }                  // marks delivered; enables server-side prune (§6.3)
   -> { ok, acked_through }
```

Plus **live push** reusing the exact ticket→WS pattern, keyed by the caller's
`user_id` instead of a matter:

```
POST /notify/sync-ticket   Bearer + X-Seat-Token  -> { ticket, expires_in_ms }
GET  /notify/sync?ticket=<t>   (WS upgrade)  -> ready frame + backlog(since=inbox_cursor)
                                                + live envelope frames
```

The WS is a **wake-up + fast-path**, not the source of truth: it carries the same
envelope frames the inbox GET returns. If the WS is unavailable, the client **polls**
`GET /notify/inbox` on a backoff (locked-decision fallback). Same in-process
`FanoutHub` seam (channel key = `notify::<user_id>`), same single-instance caveat
(§6.1).

### 2.3 Client transport & polling

- **Live:** one `notify` WS per device (ticket-authed like sync). On an envelope
  frame, decrypt (§2.4), enqueue the notification, advance the inbox cursor.
- **Fallback / catch-up:** `GET /notify/inbox?since=<cursor>` on a backoff (e.g. 20 s
  when WS-down, 5 min when WS-live as a safety net). A device that was off for a week
  pulls the whole backlog on one paged sweep — identical mechanics to matter catch-up.
- **Cursor** persists in the local encrypted store as `notify_inbox_cursor`.

### 2.4 Envelope encryption & addressing

An envelope is a **pointer, not a payload of content.** Plaintext schema (sealed,
then base64 → `ciphertext_b64`):

```json
{ "v":1, "type":"task_assigned", "ts_rev": 187,
  "subject": { "matter_id":"firm_home", "doc_id":"crm:tasks", "entity_id":"task_9f.." },
  "actor_user_id":"u_alice", "label_ref":"task.title",
  "extra": { "due_date":"2026-07-17" } }
```

- **Sealed under a matter key**, reusing `matterCrypto.encryptUpdate` verbatim
  (version+IV+GCM, epoch as AAD):
  - **Firm-wide notifications** (`task_assigned`, `approval_requested`,
    `workflow_step_due`, `migration_event`) → sealed under the **firm-home key**.
    Every member holds it, so the recipient can always open it.
  - **Client-confidential notifications** (`mention` that quotes a client note, or any
    notif that would embed client content) → sealed under the **referenced client
    matter key**. A walled recipient **cannot decrypt it** (no key), so a wall
    silences client-confidential notifications cryptographically, not by UI hiding.
- **Key selection on decrypt:** the envelope is opaque to the server, so the client
  tries its **firm-home key first** (covers the large majority), then its held client
  keys (a bounded handful at ≤10 seats). An envelope that opens under no held key is a
  wall/timing race — it is **held, not dropped**, and retried after the next key
  fetch. No key hint is stored server-side (that would leak the matter).

### 2.5 Delivery semantics

- **At-least-once.** The client may receive an envelope via both the WS and a poll,
  or replay it after a crash. **Dedupe by `envelope_id`** at the recipient (the unique
  index makes `send` idempotent; the client also dedupes on `envelope_id` before
  surfacing). Applying a notification is itself idempotent (it targets an entity id).
- **Ordering** for display is by the envelope's internal `ts_rev` (a Lamport-style
  counter, §3.4), **not** `created_at` (server wall clock) and not `seq` (server
  arrival order) — those two are transport metadata only.
- **Acked-through prune:** once the client `ack`s `up_to_cursor`, the server may prune
  delivered envelopes below it after a retention window (§6.3).

### 2.6 What the server can observe — honest leakage statement

**The relay CAN see, for notifications:** each recipient's `user_id`, the
`sender_seat` (→ resolvable to a sender user), envelope **byte size**, `created_at` /
`delivered_at` / `ack` timestamps, and therefore **counts and rates per recipient and
per sender→recipient pair.**

**From that metadata the server (or anyone who compromises it) can infer:** who is
active and when (working hours, vacations), **who directs work to whom** (Alice's
seat repeatedly sends envelopes to Bob → Alice assigns Bob), overall activity volume
and its timing, and — combined with the oplog's plaintext `matter_id` + `author_seat`
on updates — *that* collaboration is happening on a given client, and by whom.

**The relay CANNOT see:** the notification **type**, the **subject** (which task /
client / workflow / note), any **label or content**, or whether a mention quotes
confidential text. For client-confidential envelopes it also cannot see the referenced
matter (sealed inside), so a walled client's mentions are invisible to it beyond
"an envelope of size S went to Bob."

**This is a deliberate, bounded widening** of what the server sees versus pure oplog
sync: it adds an explicit **recipient** dimension (the oplog has author but no
recipient). It is the minimum needed to route offline notifications without the server
reading content. It is NOT free — see §7-Q1.

### 2.7 Notification types (inside the envelope)

| type | Emitted when | Sealed under | Subject ref | Notes |
|---|---|---|---|---|
| `task_assigned` | assignee set/changed to recipient | firm-home | task | fires to new assignee |
| `task_reassigned_away` | recipient was assignee, now isn't | firm-home | task | optional courtesy |
| `approval_requested` | a workflow step / external write needs recipient's approval | firm-home | workflow instance/step | AI-proposes → human-approves gate |
| `workflow_step_due` | a step assigned to recipient is due/overdue | firm-home | workflow step | emitted by the assignee's own device on a local timer (§5.3), not the server |
| `mention` | recipient @-mentioned in a note/task body | **client matter** | note/task | wall-silenced by key denial |
| `migration_event` | importer milestone (parallel-run diff ready, cutover done, rollback) | firm-home | migration run | see Lane E |

`workflow_step_due` has no server timer (the server can't read due dates). Each
device computes its own due/overdue set locally (§5) and self-notifies; peers'
awareness comes from the shared task board, not from a server push.

---

## 3. Offline & conflict semantics

Merge classes per field are **[DM-fields]** (Lane B). This section defines the
*behavior* those classes produce and the rules the app layers on top. **No wall clock
is trusted for conflict resolution.**

### 3.1 Two members edit the same task offline

Each task field is a keyed entry in the task's `Y.Map`. Yjs resolves **per key**:

- **Different keys** (Alice sets `due_date`, Bob sets `priority`) → both survive.
  No conflict.
- **Same key**, both LWW (both set `due_date`) → Yjs keeps one deterministically by
  its **internal item order (clientID, clock)** — *not* by wall-clock recency. The
  outcome is identical on every device and every replay order (that is the
  convergence guarantee). The **losing value is not silently vaporized**: every
  field write also appends an `activity` event (§1.4 `crm:activity`), so the board
  shows "Alice set due = Jul 17; Bob set due = Jul 20 (kept)." Staleness/collision is
  visible, never silent (research requirement).

### 3.2 Assignee completes a task someone else re-assigned offline

`status` and `assignee_user_id` are **independent LWW registers**. If, offline, Bob
(assignee) sets `status=done` while a manager sets `assignee=Carol`, the merge yields
`{ status: done, assignee: Carol }`. **We do not fight the CRDT to enforce a business
rule inside the merge** — we let the fields converge and reconcile in the app:

- Completion records **`completed_by` + `completed_rev`**, which are **write-once /
  immutable** (§4 P1). The recorded outcome (who did it, the deliverable) can never be
  overwritten by a later reassignment.
- If a reassignment's `rev` is concurrent-with or after the completion, the UI shows
  *"Completed by Bob; reassigned to Carol after completion"* and offers Carol a
  **Reopen** action (a new forward transition, not a rewrite of history). The invariant
  that holds: **a completed task's recorded outcome is immutable; reassignment can
  only create a new open state going forward.**

### 3.3 Tombstones & undelete

- Deletion is a **soft-delete LWW flag** (`deleted=true` + `deleted_by`), never a Yjs
  array/map removal. This means concurrent edits to a "deleted" entity still converge,
  and **undelete is just `deleted=false`** (with an activity event). Matches the CRM
  connector's existing soft-delete precedent.
- Concurrent delete + edit → both apply (entity is `deleted` and carries the edit);
  the edit is preserved so an undelete restores a correct, current entity.
- **Hard removal only happens at compaction** (§6.4), after a retention window, when a
  tombstone is old enough that no device could still be merging against it.

### 3.4 Clock handling — no wall-clock trust

- **CRDT merge** uses Yjs's **internal logical clocks** `(clientID, clock)`. This is
  the "existing Lamport-style pattern" the fork already relies on — there is **no
  explicit Lamport/HLC in the firm code** (grep-confirmed); it is Yjs-internal and it
  is enough for field convergence. Do not add wall-clock tiebreakers.
- The relay's autoincrement `id` is a **server sequence for catch-up ordering only**,
  never a merge input. `created_at` is server ISO **display metadata only**.
- For **cross-field causal hints** the CRDT can't express (e.g. "was this reassignment
  after that completion?"), each entity carries an explicit **`rev` Lamport counter**:
  on any write, `rev = max(local_rev, any_seen_rev) + 1`. `completed_rev` snapshots
  `rev` at completion; the UI compares a reassignment's `rev` to `completed_rev` to
  decide the "reassigned after completion" wording. `rev` is advisory for
  presentation and for propagation ordering (§4); it is **not** a merge tiebreaker
  (Yjs still owns convergence).
- **Due dates are calendar dates**, user-entered. "Is it overdue?" compares the due
  date to the local wall clock **for display only** (§5.3) — never for merge.

---

## 4. Workflow-template propagation (the marquee correctness problem) [NEW]

**Goal:** an admin edits a workflow **template**; every **open instance** of that
template gets a **proposed** update; a human reviews and approves per instance; the
approved update merges template changes into in-flight instances **without clobbering
per-instance progress, owners, or notes**, and **converges** even when two admins
review concurrently.

The existing `WorkflowTemplate`/`WorkflowExecution` types
(`src/platform/types/workflow.ts`) are **AI-pipeline shaped, not human checklists** —
verified. This section defines the checklist-shaped v2 types and the algorithm. There
is **no existing rail**; build it against the invariants in §4.6.

### 4.1 The instance-vs-template data contract

```
WorkflowTemplate (v2, human checklist) — a versioned document
  { templateId, version:int (monotonic), name,
    steps: [ TemplateStep ],  // ordered
    updatedAt }
  TemplateStep
  { stepId:string (STABLE across versions),  // the join key to instance steps
    title, description, order:int, defaultAssigneeRole, dueOffsetDays, required:bool }

WorkflowInstance  (lives in firm-home doc "crm:workflows", instances Y.Map<instanceId → Y.Map>)
  { instanceId, templateId,
    templateVersionApplied: LWW int,          // the template version last merged in
    client_matter_id, status,
    steps: Y.Map<stepKey → Y.Map>             // stepKey == template stepId, or "local:<uuid>" for ad-hoc
      instanceStep Y.Map:
        stepKey            : string
        origin             : 'template' | 'local'
        detachedFromTemplate : LWW bool        // template removed it but it had progress (§4.3)
        // ---- TEMPLATE-DERIVED FIELDS (propagation may overwrite; never carry progress) ----
        title              : LWW  (template-derived)
        description        : LWW  (template-derived)
        order              : LWW  (template-derived)
        required           : LWW  (template-derived)
        dueOffsetDays      : LWW  (template-derived)
        templateFieldsRev  : LWW int           // = template version whose fields are in these cells
        // ---- PER-INSTANCE PROGRESS (propagation NEVER writes these) ----
        status             : LWW 'todo'|'doing'|'done'|'skipped'
        assignee_user_id   : LWW
        notes_ref          : pointer → crm:task-notes (client-confidential)
        completed_by       : LWW user_id | null   (write-once)
        completed_rev      : LWW int | null       (write-once)
        outcome            : LWW (write-once)      // the recorded result/deliverable
        rev                : LWW int               (§3.4) }
```

The **field partition is the whole game**: template-derived cells vs. per-instance
progress cells are disjoint. Propagation writes **only** the first set; the merge
rules below guarantee it.

### 4.2 Template edit → versioned diff

On template save `vN → vN+1`, compute a structured diff `D` by `stepId`:

```
D = {
  added:     [ TemplateStep ]                       // stepId not in vN
  removed:   [ stepId ]                             // in vN, not in vN+1
  modified:  [ { stepId, changed: {field: newValue} } ]  // template-derived fields only
  reordered: [ { stepId, order } ]                  // order changed
}
```

### 4.3 Merge rules — per change, per step-field

For each **open** instance still at `templateVersionApplied ≤ N`, each change in `D`
maps to a deterministic effect. **Protected** = per-instance progress cells, never
touched.

| Change | Instance step state | Effect | Protected? |
|---|---|---|---|
| `added` stepId | (absent) | Insert new `template`-origin step, `status=todo`, template-derived fields set, `templateFieldsRev=N+1` | n/a |
| `removed` stepId | not started (`status=todo`, no progress) | Soft-remove (tombstone) | — |
| `removed` stepId | started/done/has notes/outcome | **Keep**; set `detachedFromTemplate=true` | **yes — never delete recorded work** |
| `modified` title/description/dueOffset/required | any | Overwrite the **template-derived cell only**; set `templateFieldsRev=N+1` | progress untouched |
| `modified` on a step already `done` | done | Update template-derived cell; **do NOT touch `outcome`/`completed_by`/`completed_rev`**; flag `template_changed_after_completion` for display | **yes** |
| `reordered` stepId | any | Update `order` (template-derived) | progress untouched |

**Idempotency guard:** apply a change only if `instanceStep.templateFieldsRev < N+1`.
Re-applying the same version is a no-op (satisfies §4.6 P3).

### 4.4 The proposed → reviewed-apply flow (AI proposes, human approves)

1. **Propose.** On `vN+1` save, the system enumerates every open instance at
   `≤N` and classifies each change as:
   - **SAFE-AUTO** — non-conflicting (add a step; modify a template-derived cell of a
     `todo` step with no local override); or
   - **NEEDS-REVIEW** — touches a step with progress (started/done/notes) or a removal
     of a step with progress.
2. **Review UI (per charter; E-098/E-099).** A **Propagation Review** screen lists the
   affected open instances. **Per instance: one checkbox** — "apply the vN+1 update to
   this instance." Default **checked** when all changes are SAFE-AUTO; default
   **unchecked** when any change is NEEDS-REVIEW. Expanding an instance shows a
   per-step diff: template-derived changes highlighted, **protected fields rendered as
   locked** ("progress preserved: status=doing, assignee=Bob, notes kept"). This is the
   E-098/E-099 per-instance opt-in.
3. **Reviewed-apply.** For each **approved** instance, apply `D` as **one Yjs
   transaction** on that instance's `Y.Map` in `crm:workflows`, using the §4.3 rules,
   then set `templateVersionApplied = N+1` (LWW; max wins, §4.6 P9). Write a
   `propagationEvent` (§4.5) capturing pre-apply snapshots of exactly the
   template-derived cells it changed.
4. **Unapproved instances stay at `≤N`.** They can be updated later; the template
   version pins what they're on. An instance can be brought forward at any time by
   re-running review for the delta between its `templateVersionApplied` and the current
   template version.

**Convergence across concurrent editors.** Two admins approving the **same** instance's
propagation both apply the **same deterministic `D`** in Yjs transactions:

- Added steps are keyed by `stepId` in a `Y.Map` → inserting twice converges to one.
- Template-derived cell writes are identical values → LWW converges to that value.
- `templateVersionApplied` is an LWW int with **max-wins**, so order doesn't matter.
- `templateFieldsRev` gating makes a second identical apply a no-op.

Two admins approving **different** decisions (one approves vN+1, one leaves it) still
converge: the apply is idempotent and version-gated, so whichever apply lands sets the
instance to vN+1; a "leave it" is simply the absence of a write. A later, higher
template version always wins the template-derived cells (`templateFieldsRev` /
`templateVersionApplied` monotonic). **No per-instance progress cell is ever a merge
input to propagation**, so concurrent progress edits during a propagation are
orthogonal and safe.

### 4.5 Failure / rollback — instance-level undo

Each apply writes a `propagationEvent` into the instance:

```
propagationEvent { fromVersion:N, toVersion:N+1, appliedBy, applied_rev,
                   priorCells: { stepKey: {field: oldValue} },   // only template-derived cells it changed
                   addedStepKeys:[...], detachedStepKeys:[...] }
```

**Undo(instance, event)** is a CRDT transaction that:
- restores each `priorCells` template-derived value,
- soft-removes steps in `addedStepKeys` **only if still `todo` with no progress**
  (else leaves them, since progress appeared after apply),
- clears `detachedFromTemplate` on `detachedStepKeys` (re-attaching),
- reverts `templateVersionApplied` to `fromVersion`.

Undo **touches only template-derived cells** — never progress — so it is convergent and
cannot lose work. Because it targets specific cells with specific prior values, two
devices issuing the same undo converge; an undo after further progress edits still only
rewrites template-derived cells (§4.6 P7).

### 4.6 Test invariants (write these as properties)

- **P1 — Completed outcome immutable.** An approved propagation (or its undo) NEVER
  changes a step's `completed_by`, `completed_rev`, or `outcome` once set.
- **P2 — No destructive removal.** An approved propagation NEVER deletes a step that
  has any progress (status≠todo, or notes, or outcome); it sets
  `detachedFromTemplate=true` instead.
- **P3 — Idempotent per version.** Applying `vN+1`'s propagation to an instance twice
  equals applying it once (`templateFieldsRev` / `templateVersionApplied` gate).
- **P4 — Concurrent-apply convergence.** Two devices applying the same propagation to
  the same instance converge to byte-identical instance state.
- **P5 — Version pinning.** After apply, approved instances have
  `templateVersionApplied == template.version`; unapproved instances are unchanged.
- **P6 — Progress invariance.** `status`, `assignee_user_id`, and `notes` are
  identical before and after any template-derived apply.
- **P7 — Undo scope.** Undo restores exactly the template-derived cells that apply
  changed, reverts `templateVersionApplied`, and changes nothing else.
- **P8 — Added-step uniqueness.** A template-added step appears exactly once in the
  instance regardless of how many devices apply or observe.
- **P9 — Monotonic version.** An instance's `templateVersionApplied` never decreases
  via propagation (LWW max-wins); only an explicit undo lowers it.
- **P10 — Reassign-after-complete.** A step completed then reassigned ends
  `{completed_by preserved, a new open assignment}`; the recorded outcome is intact
  (ties to §3.2).

---

## 5. Server-blind views

The relay can compute **nothing** over content (`matter_updates.ciphertext` is opaque).
Every roll-up is **client-side over synced docs.**

### 5.1 How each view is computed

Because every member syncs the firm-home docs, each device holds the full operational
board locally and filters in memory — instant and offline-capable:

- **Team task list** — iterate `crm:tasks.tasks`, drop `deleted`, resolve `title_ref`
  through the client `crm:record`/`crm:task-notes` **only for clients the device has
  keys for** (walled clients render as a locked shell). Group/sort locally.
- **Who's-overdue / my tasks** — filter `assignee_user_id == me` (or any member) and
  `due_date < today` and `status ∉ {done,skipped}`, over the same local map. No server
  query, and correct across **all** clients the device can see.
- **Activity feed** — merge `crm:activity:<current-bucket>` (live) with lazily
  caught-up prior buckets; sort by `ts_rev`.
- **Workflow dashboards** — over `crm:workflows.instances` locally.

The permanent architectural constraint (feasibility §3): a device can only roll up over
streams **it has synced**. At ≤10 seats syncing all firm-home docs, that is "everything
operational," so the roll-ups are complete. A client the device lacks a key for
contributes only its operational shells (no content) — by design.

### 5.2 Staleness bounds — what "current" means

A view is **current as of the device's latest applied cursor** for each contributing
doc. Precisely:

- **Live** (WS connected, caught up to `latest_cursor`): staleness ≈ WS round-trip
  (sub-second). `MatterSyncClient` status `live`.
- **Syncing** (catch-up in progress after wake/reconnect): the view is **not yet
  authoritative**; it is showing a prefix of history. Status `catching-up`.
- **Offline** (relay unreachable): staleness = age of the last successful pull;
  local edits are queued and shown optimistically. Status `offline`.

"Who's overdue" is only trustworthy once **all** firm-home docs have reached their
`latest_cursor`. Before that, the answer is a lower bound (may miss a peer's just-made
change).

### 5.3 UI affordances for sync state (never silent)

- **Per-view freshness badge**, driven by the aggregate `MatterSyncClient` status +
  cursor-age across the docs the view reads: **Live** · **Syncing…** · **Last synced
  3m ago** · **Offline (edits will send when you reconnect)**.
- A **who's-overdue** or **team task** panel shows **"Syncing…"** until catch-up
  completes, then flips to **Live**; it must **never** present a stale list as
  authoritative without the badge (research requirement: staleness visible, not
  silent).
- **Presence** (the existing subscriber-count frame) shows "N teammates viewing" but is
  advisory only.
- **Overdue** is computed against the local wall clock **for display**; if the device
  clock is obviously wrong (skew vs. server `created_at` on the last pull), show a
  "check your clock" hint rather than trusting it.

---

## 6. Failure modes & limits

### 6.1 Relay down → local-first

`MatterSyncClient` already handles this: on push failure it sets `offline`, **queues
local Yjs updates** (`pendingUpdates`), and reconnects with exponential backoff
(1 s→30 s), flushing the queue in order on reconnect. All reads/writes continue against
the **local Yjs docs** and the local encrypted store; nothing blocks. Outbound
**notification envelopes queue locally** too (a local outbox) and `POST /notify/send`
on reconnect (dedup by `envelope_id`). **No data loss**: Yjs + the queues recover
fully. The single-instance `FanoutHub`/`SyncTicketStore` mean a **relay restart drops
live subscriptions** — clients transparently HTTP-catch-up and re-open the WS; correct,
just a brief `offline`→`live` blip. (Multi-instance HA needs a Redis/NATS backplane
behind the same hub interface — documented seam, out of scope for ≤10 seats.)

### 6.2 Member device lost → revoke on existing rails

Verified rails:
- **Deprovision the user** → `revokeAllSeatsForUser` (db.ts:736) blocks all relay
  access for their seats (`verifyActiveSeat` fails).
- **Rotate keys** → for every matter the user was in **plus `firm_home`**:
  `bumpMatterKeyEpoch` (db.ts:961) + `deleteWrappedKeysForUser` +
  `deleteWrappedKeysForEpoch` (db.ts:1423-1439). A key-holder re-wraps the **new**
  epoch to remaining devices (`autoRepublishHeldMatterKeys`). The lost device, even
  with its stored keys, **cannot read updates pushed after rotation** (epoch AAD makes
  old key + new epoch fail). **[NEW] wiring:** the deprovision path must include
  `firm_home` in the set of matters it rotates (today deprovision revokes seats but the
  firm-home rotation is new because firm-home is new).
- **Honest limit:** content **already synced** to the lost device's local encrypted
  store is **not remotely wipeable** (local-first reality). Mitigations: seat revoke
  blocks new content, key rotation gives forward secrecy, and the local store is
  SQLCipher + OS-keychain-keyed on top of OS full-disk encryption. Call this out in the
  trust story; do not claim remote wipe.

### 6.3 Envelope backlog growth

- Delivered + `ack`ed envelopes are **pruned** server-side below `acked_through` after
  a retention window (e.g. 30 days) by a periodic GC (mirror `startRateLimitGc`).
- A recipient who **never comes online** accrues envelopes; cap per-recipient depth and
  **collapse the oldest** into a single "N earlier notifications" marker the client
  expands on demand (the count is what the server sees anyway). Rate-limit
  `POST /notify/send` per sender seat (anti-spam), reusing the existing `rateLimit`.

### 6.4 Doc compaction / GC — the real scaling limit [NEW]

**Verified: the relay never compacts `matter_updates`** (no `DELETE`, no snapshot
prune). A fresh device replays from cursor 0, so a long-lived `crm:tasks` board accrues
**unbounded** updates and bootstrap cost grows without bound. `coeditSession` produces a
local `Y.encodeStateAsUpdate` snapshot on teardown but **does not persist it to prune
the oplog** (code comment confirms it's a future affordance). This must be built.

**Client-driven checkpoint + prune protocol [NEW]:**
1. Periodically (or when a stream's update count crosses a threshold), a **key-holder**
   client computes `Y.encodeStateAsUpdate(doc)` — a single blob equivalent to the whole
   history — encrypts it under the current matter key/epoch, and pushes it via a new
   `POST /matter/:id/checkpoint { doc_id, ciphertext_b64, up_to_cursor }`.
2. The relay stores the checkpoint (a distinguished row / small `checkpoints` table:
   `matter_id, doc_id, cursor, ciphertext, created_at`) and may then **prune
   `matter_updates` below `up_to_cursor`** for that `(matter,doc)` — guarded so it
   never prunes above the newest checkpoint and never mid-flight.
3. **Catch-up changes:** `GET /matter/:id/updates` first returns the **latest
   checkpoint** (if the caller's `since` < checkpoint cursor), then updates after it.
   A fresh device applies checkpoint → tail — **bounded** replay.
4. **Tombstone GC** rides on this: a soft-deleted entity older than the checkpoint
   horizon is dropped from the snapshot, hard-removing it convergently (no live device
   is still merging against it).
5. **Activity buckets** are compacted the same way: a closed quarter bucket gets one
   checkpoint and its raw updates prune; it is fetched only on scroll-back.

This is the single largest **[NEW]** piece of server work beyond notifications, and it
is required for a system-of-record that runs for years, not a demo.

---

## 7. Open questions for the freeze review

1. **Q1 — Task-metadata leak under walls (accepted-risk vs. mitigate).** The firm task
   board exposes assignee/status/due of a walled client's tasks to all firm members
   (only content is denied, §1.2/§2.6). Accept as documented, or additionally encrypt
   walled tasks' **operational shells** under the client key (which breaks the firm-wide
   roll-up for those tasks)? Recommendation: **accept + document**; walls are rare and
   the firm is high-trust; content is already protected.
2. **Q2 — Envelope addressing dimension.** `notify_envelopes.recipient_user_id` is a new
   server-visible dimension the oplog doesn't have (§2.6). Confirm the compliance/trust
   story tolerates "server sees who notifies whom, never what." Alternative
   (metadata-lighter, more complex): fan notifications through per-matter oplog markers
   the recipient scans — heavier client cost. Recommendation: **keep the inbox**; it's
   the honest minimum.
3. **Q3 — Firm-home epoch churn.** Every add/deprovision rotates the firm-home key and
   re-wraps to all devices. At ≤10 seats this is cheap, but confirm the auto-republish
   poll cadence keeps a new hire from waiting on the board. Recommendation: event-driven
   republish on `members/add`, not just the drift poll.
4. **Q4 — Checkpoint authority.** Who is trusted to write a `crm:tasks` checkpoint —
   any key-holder, or a designated coordinator device? Concurrent checkpoints are safe
   (idempotent, highest cursor wins) but wasteful. Recommendation: any admin device,
   debounced by a "last checkpoint cursor" the relay returns.
5. **Q5 — `workflow_step_due` self-notification.** Due/overdue is computed and
   self-notified per device (no server timer, §2.7). A member whose device is offline
   past a due date gets the notification only on next wake. Accept, or add a
   coarse-grained server timer keyed on a plaintext due-date side-channel (widens
   leakage)? Recommendation: **accept** (local-first); the board shows overdue to peers.
6. **Q6 — Cross-field causal presentation.** The `rev` Lamport counter drives
   "reassigned after completion" wording (§3.2/§3.4). Confirm [DM-fields] carries `rev`
   as a first-class per-entity field, or whether Lane B prefers a different sequence
   mechanism. Dependency on Lane B.
7. **Q7 — Presence richness.** Today presence is a bare subscriber count. Do the CRM
   screens need per-user "who's viewing/editing this task" awareness (a new ephemeral
   channel), or is the count enough? Recommendation: **count is enough for v1**;
   awareness is a later ephemeral channel that never touches the audited write path.

**Open-question count: 7.**

---

## Appendix A — Endpoint delta summary (what Lane C adds to the relay)

Existing (reused unchanged): `POST/GET /matter/:id/updates`, `POST
/matter/:id/sync-ticket`, `WS /matter/:id/sync`, `/matter/:id/keys/{publish,fetch}`,
`/matter/mine`, `/device/register`, membership/wall admin, epoch rotation.

**[NEW] to build:**
- Firm-home matter provisioning at org claim (+ reject walls on it).
- `POST /notify/send`, `GET /notify/inbox`, `POST /notify/ack`,
  `POST /notify/sync-ticket`, `WS /notify/sync` (+ `notify_envelopes` table, per-user
  `FanoutHub` channel, backlog GC).
- `POST /matter/:id/checkpoint` + `checkpoints` table + oplog prune-below-checkpoint +
  checkpoint-first catch-up.
- Firm-home rotation wired into the deprovision path.

## Appendix B — Client modules (what Lane C adds to the desktop app)

- CRM Yjs schemas + per-collection `MatterSyncClient` orchestration (open/route the
  firm-home + per-client streams; persist per-`(matter,doc)` cursors).
- Notification client: outbox, inbox cursor, envelope seal/open (reuse `matterCrypto`),
  key-trial-on-decrypt, WS + polling fallback.
- Propagation engine: template diff, propose/classify, Propagation Review UI,
  reviewed-apply transaction, `propagationEvent` + instance-undo.
- Server-blind view layer: local roll-ups + freshness badges wired to
  `MatterSyncClient` status.
- Checkpoint writer (debounced, admin device).
