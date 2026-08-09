# Lantern as System-of-Record: CRM Core Feasibility (code-grounded)

**Date:** 2026-07-11
**Repo:** `/home/jameson/lantern-plus` (Tauri 2 + React local-first; E2EE firm tier + relay under `backend/`)
**Method:** Every claim below is verified against source (not docs). Repo paths + line numbers cited inline. Docs in this repo drift; where docs and code disagreed, code wins.

---

## TL;DR verdict

The privacy architecture is a **document-sync relay, not a CRM backend.** The relay stores only opaque ciphertext (`matter_updates.ciphertext BLOB`) and never parses it — the same choice that delivers the E2EE promise is exactly what blocks any server-side CRM logic (team task lists, who's-overdue, activity feeds). Those must be computed **client-side after decryption.**

Two facts shape everything:

1. **Structured records are NOT multi-user today.** The shipped Yjs CRDT (`MatterSyncClient`) syncs only per-matter **notes/`.docx` text**, fanned out per `(matter, doc_id)` stream. The matter list and the Client Map live in **frontend `localStorage` only** — they never touch the relay. So "typed records" don't automatically become shared; each record type that must be team-wide needs a new CRDT stream.
2. **The CRM read-connector already models a lot.** `CrmContact`, `CrmHouseholdRef/Member`, `CrmNote`, `CrmTask`, `CrmEvent`, tags/addresses/phones are typed Rust structs stored in a SQLCipher mirror (`crm-enc.db`), with a partial write-back queue. ~60-70% of a Wealthbox migration importer's fetch layer already exists.

The genuinely hard parts of a local-first E2EE CRM are: **offline notification delivery**, **server-blind cross-firm queries** (who's overdue), and **workflow-instance propagation as a convergent CRDT**. Everything else (typed records, per-matter CRDT streams, SQLCipher local stores) is routine on top of existing rails.

---

## 1. Current data-model reality

### The `Matter` — a scope tag, not a client record
`src/platform/types/matter.ts` (`interface Matter`, lines 29-168). A matter is a **confidentiality/retrieval boundary**, not a rich client entity. Fields: `id`, `name`, `client` (a bare string), `folderPaths[]`, plus a long list of connector-mapping key arrays (`mailFolderPaths`, `crmHouseholdKeys`, `onedriveFolderKeys`, `esignKeys`, …), firm-linkage fields (`firmMatterId`, `orgId`, `role`, `shared`), and organizational flags (`archived`, `privileged`, `isSample`). There is **no** structured contact, household member, account, address, or relationship model on `Matter`. `client` is a display string; a household is not a first-class object.

Persisted **frontend-side only** via Zustand `persist` to `localStorage` keys `lantern:matters`, `lantern:matter-ui-snapshots`, `lantern:matter-at-a-glance` (`src/platform/matter/matterStore.ts`, header + slice comments lines 6-16, 330-412). Not in any Rust DB, not synced.

### The Client Map — freeform bullets, not typed facts
`src/platform/clientMap/types.ts`. The Client Map is a per-matter document of **sections → items (bullets)** with sources/citations: `ClientMap` (line 131), `ClientMapSection` (73), `ClientMapItem` (43, an `id + text + sources[]`). Core sections are Household / Goals / Money-and-accounts / Follow-ups (`CoreSectionKey`, line 17). Money and Household are **prose bullets, not structured account or person records** — e.g. there is no `Account { balance, custodian, type }` or `Person { dob, relationship }` type. It has an append-style `editHistory?` (line 145, `ClientMapEditHistoryEntry`). Persisted in `localStorage` per workspace (`clientMapStore.ts` lines 349-424, Zustand `persist`, custom per-workspace key). Not synced.

### The CRM connector mirror — the richest typed model in the app
`src-tauri/src/commands/crm/model.rs` + `store.rs`. This is where real typed CRM records exist:
- `CrmContact` (model.rs:200) — deep: identity, birth/anniversary/retirement/death dates, marital status, investment objective/risk/time-horizon, gross income/assets/liabilities/tax bracket, professional-relationship pointers (attorney/cpa/doctor/trusted_contact as contact ids), plus arrays of `CrmStreetAddress`/`CrmEmailAddress`/`CrmPhoneNumber`/`CrmTag`.
- `CrmHouseholdRef` (95), `CrmHouseholdMember` (76) — household graph.
- `CrmNote` (349), `CrmTask` (371), `CrmEvent` (403).

**Storage:** SQLCipher via `rusqlite` (bundled-sqlcipher), one encrypted DB per workspace at `data_dir/crm-enc.db` (store.rs:152), key in OS keychain (`CRM_ENC_SERVICE`, store.rs:24-31). Schema (store.rs:176-214): a **generic `crm_objects` table** `(id, kind, household_id, updated_at, content_hash, json, deleted)` — the **full raw provider JSON is stored verbatim in `json`**, keyed `contact:123`/`note:456`/`task:`/`event:`. Plus `crm_cursors` (delta high-water marks), `crm_render_state` (RAG re-index dedup), `crm_outbound_writes` (write-back ledger), `meta`.

**Shape assessment:** a **read-mirror with soft-delete** (`deleted` tombstone flag, store.rs:514), change-tracked by `content_hash` per row — **not** append-only, rows overwrite on conflict. It's a sync cache, not an editable system-of-record store.

### Distance from "first-class contacts/households/accounts/tasks"
- **Contacts / households:** the *typed shape* mostly exists in `CrmContact`/`CrmHouseholdMember`, **but** it lives in the connector mirror as a Wealthbox-shaped read cache, not as an editable, app-owned, synced entity. To be system-of-record these must become first-class app records the user creates/edits locally (independent of any connector), which is a new store + UI, reusing the struct shapes.
- **Accounts:** **not modeled at all.** No `Account` struct anywhere (financial figures are flat fields on `CrmContact`; the Client Map has a prose "Money and accounts" section). This is a genuine gap.
- **Tasks:** `CrmTask` (model.rs:371) has `name, due_date, complete, priority, description, linked_to` — but **no assignee, no recurrence, no notifications, no category/team**. It's a read-mirror of Wealthbox tasks, not a first-class assignable task.

**Bottom line:** today's model is a scope-tag matter + freeform Client Map + a Wealthbox-shaped read cache. The typed *shapes* for contacts/households/notes/tasks/events exist (in Rust, in the connector); what's missing is (a) app-owned editable records decoupled from the connector, (b) an Account entity, and (c) task richness (assignee/due/recurrence).

---

## 2. Multi-user backbone (firm tier / E2EE relay)

### What ships today
- **A dumb E2EE relay.** `backend/` is a Bun + `bun:sqlite` service (`backend/src/lib/db.ts`). The relay stores only opaque ciphertext blobs and fans them out; it never reads content.
- **The shipped CRDT (Wave 4 "3.0 co-editing").** `src/platform/firm/MatterSyncClient.ts` drives one **Yjs** doc per `(matter, doc_id)` stream. Lifecycle: HTTP catch-up (`GET /matter/:id/updates?since=<cursor>`, paged) → live **WebSocket** (`GET /matter/:id/sync?ticket=…`) → on local Yjs update, **encrypt under the per-matter key + `key_epoch`** and `POST /matter/:id/updates`. Convergence is guaranteed by Yjs; self-echo is a no-op (MatterSyncClient.ts:1-26, 205-315). The CRDT↔document mapping is `src/platform/firm/coedit/docCrdt.ts` — a Y.Doc of `meta` + `body: Y.Array<Y.Map>` blocks/runs mirroring the `.docx` engine JSON (docCrdt.ts:9-76).
- **What it actually syncs:** **document/text only.** Callers are `MatterNotesEditorWrapper.tsx`, `matterNotesSync.ts` (default `_notes` stream = rich-text matter notes), and `MatterDocSyncClient.ts` (per-`.docx` file streams). **No structured record (matter list, Client Map, tasks) is synced through the CRDT today.**
- **Key distribution — mature.** Device keys are EC P-256 pubkeys registered per device (`db.ts:242-251`); per-matter content keys are ECDH-wrapped per `(matter, epoch, user, device)` and published/fetched via `POST /matter/:id/keys/publish|fetch` (`backend/src/routes/matterKeys.ts`, table `wrapped_matter_keys` db.ts:259-268). Epoch bumps on member-remove/wall-set delete the old set and force re-wrap (matters.ts:142,190; db.ts:961-970). The server never sees a content key.
- **ACL / ethical walls — mature, fail-closed.** `matters`, `matter_members` (owner/editor/viewer), `ethical_walls` (deny-overrides-allow) all plaintext, org-scoped (db.ts:142-174).
- **Presence — minimal.** The WS broadcasts a **subscriber-count integer** per doc channel on join/leave (`server.ts:222-262`). No user identity, no cursors/awareness, nothing persisted. Inbound WS frames are ignored — all writes go through the audited HTTP POST.
- **Notifications — none.** There is no notification table, no push, no email-out, no SSE, no per-user inbox anywhere in `backend/`.

### Is this a plausible always-on backbone for a 6-10 person firm?
**As transport + E2EE substrate: yes. As a CRM backend: no, not as-is.** The oplog is a good CRDT substrate: ordered, monotonic-cursor, idempotent append (`db.ts:1116-1192`), with sub-second WebSocket fan-out for connected peers. Modeling shared tasks/feeds as additional per-matter (or per-org) CRDT streams would "just work" for connected users, reusing the exact `MatterSyncClient` machinery.

**Hard problems:**
1. **Offline notification delivery.** The core CRM loop is assign → notify → act. If a peer is offline, the server does nothing and *can't* synthesize "you were assigned X" because the payload is E2EE ciphertext it can't read, and there is no assignment concept stored server-side. You must add either (a) client-emitted encrypted-but-addressed "notification blobs" + a new server delivery/inbox table + a push channel (email/APNs/desktop), or (b) a minimal plaintext metadata side-channel (assignee user_id + due date only) — which slightly widens what the server sees.
2. **Single-instance real-time.** The `FanoutHub` and `SyncTicketStore` are in-process Maps (`lib/matters.ts:214`, `syncTickets.ts:46`) — a restart drops all live subscriptions; horizontal scale needs a Redis/NATS backplane (flagged as a TODO seam, not built). Fine for one always-on box serving 6-10 people; not HA.
3. **Storage is SQLite today** (README says ship on Postgres); 500-row pull cap/request, 1 MiB/update cap.

---

## 3. The server-blind query problem (the crux)

**The relay can never compute a shared always-current view.** `matter_updates.ciphertext` is a BLOB the server measures for size and never decodes (matters.ts:276-286; db.ts:187). Task fields (assignee, due date, status) live *inside* that ciphertext. Therefore:

- **"Team task list", "who's overdue", "activity feed across matters" cannot run server-side.** There are no queryable task columns and, by the E2EE promise, there can't be. To answer "all tasks assigned to Alice due before Friday across all matters," a client must have downloaded and decrypted the relevant matters' oplogs and computed it **locally**.
- **The only pattern the existing code uses for shared state is client-side CRDT merge.** Co-editing = every client applies every peer's decrypted Yjs update and converges locally (MatterSyncClient.ts:1-26). There is **no server-side index of any kind** over content — the server's only indexes are on plaintext metadata (`matter_id`, `doc_id`, cursor `id`, `author_seat`, `created_at`).

**What a CRM needs that this architecture cannot do without weakening E2EE:**
- A cross-matter/cross-firm "my tasks / overdue" roll-up that's instant and correct even for a device that hasn't synced a given matter. Server-blind means either every member syncs every matter's task stream (feasible at 6-10 people, one org-wide task CRDT stream, but every member then holds every matter's task data — which tensions with ethical walls), or you accept a **narrow plaintext metadata channel** (assignee, due date, status, matter_id — never client content) so the server can drive notifications and overdue queries. That is the central product/privacy trade-off to decide.
- Push notification to offline peers (see §2). Same root cause.

Note: the app **already uses** a "plaintext scope + encrypted content" split locally — the RAG `chunks` table keeps `matter_id` queryable while encrypting the text (§4). Extending that idea to a **narrow server-visible task metadata channel** (assignee, due date, status, matter_id — never content) is consistent with patterns already in the codebase, and is the pragmatic way to get server-driven notifications and overdue queries. It does widen what the relay sees by a little, so it's a deliberate product/privacy decision, not a free lunch.

**Design implication:** model shared CRM state as CRDT streams (tasks, activity) so it syncs and converges like documents already do; but plan explicitly for the "device that isn't caught up" case and for notifications — those are the parts the current architecture leaves entirely to the client and offers no server help for.

---

## 4. Local stores (what could hold a CRM core)

- **SQLCipher via `rusqlite` 0.32 (`bundled-sqlcipher-vendored-openssl`, Cargo.toml:155)** — the established encrypted structured-store pattern, already used by ~10 connectors, each with its own `store.rs`: mail, audit, crm, calendar, onedrive, box, docusign, jotform, sharefile, calendly. **This is the natural home for a CRM core's structured records + a sync/activity log.** A new `crm_core-enc.db` (or tables in an app DB) would follow an established, encrypted, keychain-keyed pattern.
- **The Rust audit store is a reusable append-only, tamper-evident log.** `src-tauri/src/commands/audit/store.rs` — SQLCipher, append-only contract (exposes only `append`/`list`/`count`, lines 12-13), **hash-chained** (`prev_hash`/`entry_hash`, genesis hash, integrity seal, lines 52-156, 254-280). This is directly reusable as the model for a **task/activity event log** (an activity feed is an append-only event stream). The frontend `AuditService` (`src/platform/audit/AuditService.ts`) is already append-only with a discriminated `AuditEvent` union (`src/platform/types/audit.ts:212+`, each event `{ type, timestamp, payload }`) — a ready template for typed activity events.
- **`lantern-vault` crate** (`src-tauri/crates/lantern-vault/`) — AES-256-GCM **per-file** encryption for workspace *document* files (`encrypt_file_at`/`decrypt_file_at(path, vmk: &[u8;32])`, vault.rs:42-127), with BIP39 recovery and atomic writes. It encrypts document blobs, **not** structured records — so it's the store for attachments/document bodies, not for a task table.
- **LanceDB 0.21** (Cargo.toml:111) — RAG vectors only (semantic search), under `<workspace>/.lantern/vectors/`. Not a record store. **But note the precedent:** its `chunks` table (`rag/store/mod.rs:393-447`) keeps `matter_id`/`source_id` **plaintext + queryable** for scope-filtering/scoped-delete while the chunk `text` itself is **encrypted at rest** under a separate key (`rag/crypto.rs`). That is exactly the "queryable metadata + encrypted content" split a server-blind CRM would need for tasks (plaintext assignee/due/status, encrypted everything else) — a pattern the codebase already uses locally.
- **CRDT stack:** Yjs `^13.6.31` (`package.json:114`); wire blobs are `[version][12-byte IV][AES-256-GCM ct+tag]` base64, with `key_epoch` bound as GCM AAD (`matterCrypto.ts`). No automerge/loro.
- **Zustand + `localStorage`** — where the matter list and Client Map currently live (frontend). Fine for local UI state; **not** where a multi-user CRM core should live (no encryption in browser, no sync).

**Reusable rails for a task/activity model:** the audit hash-chain SQLCipher store (Rust) + the append-only `AuditEvent` union (frontend) are the two best-fit existing patterns; the per-connector `store.rs` template is the fastest path to a new encrypted structured store.

---

## 5. Migration surface (Wealthbox importer — how much exists)

**De-facto ~60-70% of the fetch layer already exists** (verified in `client.rs`, `model.rs`, `engine/`):

Already fetched + typed + stored (raw JSON preserved), with paginated backfill (`engine/index.rs` `backfill` → `ingest.rs`), rate-limited ~1 rps + 429 backoff:
- **Contacts** `GET /contacts` → `CrmContact` (deep field set incl. financial profile, dates, professional relationships, addresses/emails/phones/tags).
- **Households** `GET /contacts?type=household` → `CrmHouseholdRef`/`Member` (household graph reconstructed).
- **Notes** `GET /notes` (JSON key `status_updates`) → `CrmNote`.
- **Tasks** `GET /tasks` → `CrmTask`.
- **Events** `GET /events` → `CrmEvent`.
- Categories/users/teams are fetched **as label lookups only** (in-memory `LabelCache`, never persisted).

**Partial write-back already exists:** `crm_outbound_writes` ledger + `CrmWriteSource` trait; Wealthbox can **create notes, create tasks, and update one contact field** (`background_information` only — `WRITABLE_FIELDS`, write.rs:1112). No delete anywhere.

**Multi-provider abstraction exists:** `CrmSource` read trait (source.rs:20), `CrmProvider` enum (Wealthbox/Salesforce/Redtail, provider.rs:16), shared normalized `Crm*` model. Salesforce/Redtail clients exist and normalize onto the same structs.

**Missing for a true system-of-record migration (no DTO, no endpoint today):**
- **Workflows / workflow steps** — absent. (This is the marquee CRM feature; the importer has nothing for it.)
- **Opportunities / pipeline / stages** — absent.
- **Custom fields** — not modeled (`contact_roles` kept as raw `serde_json::Value`).
- **Attachments / documents / files on records** — absent.
- **Comments on notes/tasks** — absent.
- **Task richness** — no assignee, recurrence, category, or assigned user/team on `CrmTask`.
- **Historical activity / timeline** — absent (only current snapshots of notes/tasks/events).
- **Delta / deletion** — `updated_since` + `deleted_contact_ids` exist in `client.rs` but are `#[allow(dead_code)]`; only full-snapshot backfill is wired (source.rs TODO). A one-time importer doesn't need delta, so this is fine for migration.
- **Government-ID fields** deliberately excluded by policy (model.rs:8-10) — would need reconsideration for system-of-record.

---

## 6. Build-shape verdict (subsystems)

Sizes are **on top of existing rails** (S=days, M=1-2 weeks, L=multiple weeks, XL=largest single risk).

| Subsystem | Existing rails that help | Size | Single hardest technical risk |
|---|---|---|---|
| **Contacts / households / accounts** | `CrmContact`/`CrmHouseholdMember` struct shapes; SQLCipher `store.rs` template; matter already the household scope | **M** | Decoupling app-owned editable records from the connector read-mirror **without** breaking the `matter`/`matter_id` facade (locked identifier) — and adding the missing **Account** entity cleanly. |
| **Tasks** (assignee, due, recurrence, priority, notifications) | `CrmTask` shape (partial); audit append-only log pattern; write-back queue | **M** | Recurrence semantics + making tasks a **convergent CRDT** (two people editing the same task offline) rather than a local table. |
| **Workflows + open-instance propagation** | `WorkflowTemplate`/`WorkflowStep`/`WorkflowExecution` types exist (`src/platform/types/workflow.ts`) but are **AI-run pipelines, not human task checklists**; `.workflow` file persistence | **L-XL** | The marquee "edit template → propagate to open instances" as a **CRDT merge**: applying a template diff to in-flight instances that peers may be concurrently editing, convergently, without clobbering per-instance progress. This is the single hardest correctness problem and has **no existing rail** (current workflow types are the wrong shape). |
| **Multi-user sync / notifications** | Yjs `MatterSyncClient` + relay oplog + key distribution + ACL/walls (all mature) | **L** | **Offline notification delivery** + the server-blind constraint: notifying/among offline peers and cross-firm "overdue" without weakening E2EE. Needs a new inbox/delivery table + push channel + a privacy-trade-off decision (metadata side-channel vs. everyone-syncs-everything). |
| **Reports** (basic) | LanceDB/RAG for text; local structured stores | **M** | Everything is client-computed over decrypted data (server-blind) — reports must be assembled locally per device; cross-matter roll-ups need the device to hold all relevant streams. |
| **Migration importer** (Wealthbox) | ~60-70% of fetch layer built (contacts/households/notes/tasks/events + raw JSON + pagination + write-back queue) | **S-M** | Filling the gaps with **no existing rail**: workflows, custom fields, attachments, opportunities, task assignment/recurrence, historical timeline. |

### Overall honest verdict

**Genuinely hard (architecture-level):** (1) **workflow-instance propagation as a convergent CRDT** — new shape, no rail, correctness-critical; (2) **offline notifications** — tensions with E2EE, needs new server surface + a privacy call; (3) **server-blind cross-firm queries** (overdue/roll-ups) — a permanent architectural constraint, not a feature you build once. These three are where the real risk and design debate live.

**Routine on existing rails:** typed contact/household/task **records** (struct shapes exist; SQLCipher store template exists), local encrypted structured storage, append-only activity logs (audit hash-chain is a ready model), per-matter CRDT sync for connected peers (reuse `MatterSyncClient`), and the migration **fetch** layer (mostly built).

**Is "typed-records seed now, CRM later" architecturally sound? Mostly yes — with two caveats.**
- **Carries forward well:** typed household/account/task **shapes and their local SQLCipher store** built now for other features (e.g. a structured Client Map, an accounts view, local task list) are exactly what a CRM core reuses. The struct definitions, the encrypted-store pattern, and the matter-scope model are durable. Building these early is not throwaway.
- **Will get rewritten if built naively:** anything persisted **only to browser `localStorage`** (as the matter list and Client Map are today) must migrate to an encrypted local store + a CRDT stream to become multi-user — so seed records should land in a **Rust SQLCipher store from day one**, not localStorage, if they're meant to carry forward. And **tasks/workflow-instances should be modeled as CRDT-friendly documents (stable ids, last-writer-wins or field-level merge) from the start**, not as plain local tables, or the multi-user step forces a rewrite. Seed the *shapes and the encrypted local store* now; defer the *sync/notification* wiring — that sequencing is sound.
