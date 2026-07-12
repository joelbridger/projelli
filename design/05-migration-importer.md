# 05 — Migration & Importer (Wealthbox → Lantern)

**Lane E · design phase · LANTERN-CRM program**
Conforms to 00-master-spec decisions D1-D10 (reconciled 2026-07-11).
**Probe amendment (2026-07-11):** this document incorporates the live fabricated-sandbox
findings in [2026-07-11 Wealthbox API probe](evidence/2026-07-11-wealthbox-api-probe.md).
**Written:** 2026-07-11. Code inventory verified against this fork at the commit checked
out today (`~/lantern-crm`, forked from `~/lantern-plus` `0971d8f3`). Public API claims
verified via web search/fetch against `dev.wealthbox.com` and related sources on
2026-07-11 — dated because Wealthbox's docs can change; anything not directly quoted from
a fetched page is marked **UNVERIFIED** and remains an explicit build risk until it can be
modeled by the fabricated API simulator described in §6.

**Data boundary (D7):** this design authorizes only the fabricated Northcrest corpus and
the synthetic Wealthbox-API simulator. It authorizes no customer data, production accounts,
or non-fabricated workspaces. Every fixture, raw capture, archive manifest, fidelity report,
parallel-run, cutover, and rollback described below is a sandbox exercise over fabricated
data only.

**Entity names:** `design/02-data-model.md` is the canonical entity contract. The internal
facade is `matter` / `matter_id` — a Household/Client maps onto one `matter`, per the
charter's inherited invariant.

---

## 1. What exists today (code-verified)

The current Wealthbox connector in this fork is a **read-only mirror with a narrow,
allowlisted write-back for two object types** — it is not a migration importer, but it is
most of one's plumbing. Everything below is cited to `src-tauri/src/commands/crm/`.

### 1.1 Transport (`client.rs`)

- `WealthboxClient` talks to `https://api.crmworkspace.com/v1`, authenticating with the
  header `ACCESS_TOKEN: <token>` (not OAuth Bearer — this fork uses the simpler personal
  access-token flow).
- **Rate limiting:** a `tokio::sync::Mutex<Option<Instant>>` gate enforces ~1 request/second
  (`rate_gate()`), matching Wealthbox's documented "~1 req/sec over a 5-minute window."
  On HTTP 429 it retries up to `MAX_429_RETRIES = 6` times, honoring a `Retry-After` header
  (capped at `MAX_RETRY_AFTER_SECS = 120`) or falling back to capped exponential backoff
  (1s → 2s → 4s → … → 64s). This whole gate is a **single mutex shared by every call** —
  all requests for all object types serialize through it one at a time.
- **Pagination:** `list_all()` currently loops `page = 1, 2, …` at
  `per_page = DEFAULT_PER_PAGE` (50, `model.rs`) until a page returns fewer items than the
  page size. The live probe established **100** as the effective page cap: a request for
  250 returned 100 contacts and three pages. The importer changes its page size to 100.
- **PII discipline:** non-2xx responses log only the HTTP status and endpoint path, never
  the response body (bodies can carry client PII). This is an important security property, not
  boilerplate — the importer must preserve it even while adding new endpoints.
- **Typed fetchers that exist:** `list_contacts` (optional `updated_since`, `contact_type`),
  `list_households` (contacts filtered to `type=household`), `list_notes` (⚠️ the API
  returns notes under the JSON key `status_updates`, not `notes` — an already-handled
  quirk), `list_tasks`, `list_events`, `deleted_contact_ids` (Wealthbox contacts support a
  tombstone via `?deleted=true`; **no other object type exposes a deleted-items
  filter** in this client today).
- **Label resolver:** `resolve_category_label` / `resolve_user_name` / `resolve_team_name`
  lazily fetch and cache `/categories/{type}`, `/users`, `/teams` — **in-memory only, reset
  on every app restart, never persisted**. Fine for read-time label rendering; not usable
  as a durable Users/Teams import.
- **Not fetched by anything in this client today:** opportunities, projects, workflows,
  workflow templates, workflow steps, custom fields, tags (the registry is
  `/categories/tags`, distinct from the `{id,name}` tags already embedded on a contact),
  activity stream, contact roles (the dedicated list — a raw placeholder exists on the
  contact struct, see below).

### 1.2 Data model (`model.rs`)

Four typed structs are fully modeled: `CrmContact` (`type` ∈ person/household/
organization/trust), `CrmNote`, `CrmTask`, `CrmEvent`. Notable details:

- `CrmContact` captures identity, key dates, classification, investment profile, a
  **tolerant `serde_json::Value`** financial profile (income/assets/liabilities/tax —
  Wealthbox sends these as either numbers or strings depending on field, so the model
  doesn't force a type), professional-relationship contact-ids (attorney/cpa/doctor/…),
  address/email/phone arrays, the nested household ref + member list, and tags.
- **Deliberately omitted by design (privacy, §5.5 cited in the file's own doc comment):**
  passport number, green card number, driver's license. This is a product decision already
  made, not a gap — the importer must not "fix" this by adding them back without a new
  product decision.
- `contact_roles: Vec<serde_json::Value>` is captured but **completely untyped** — the
  field exists so nothing throws on parse, but nothing in the codebase reads it. It is a
  placeholder, not a complete import of Wealthbox's contact-roles feature.
- Every bare `String`/`Vec` field uses a `null_to_default` deserializer so the API's
  habit of sending explicit `null` (not just omitting keys) never fails a parse. This
  matters for the importer: **anything not modeled as a named field is silently dropped**
  at parse time (see 1.4) — this null-tolerance only protects fields that *are* modeled.
- **ID scheme:** `crm_key()` — Wealthbox rows use the raw numeric id as the dedupe key;
  Salesforce/Redtail rows use a provider-prefixed `external_id` (`sfdc:…`, `redtail:…`) so
  multi-provider ids can never collide. This scheme already generalizes cleanly to new
  object types (see §2.2).

### 1.3 Ingest / sync engine (`engine/ingest.rs`, `engine/mod.rs`)

- `ingest()` fetches all contacts, then notes/tasks/events, and **files each note/task/
  event under every household its `linked_to` array resolves to** — but *only* for
  `linked_to` entries whose `type` is literally `"Contact"` (case-insensitive). This guard
  exists because Wealthbox ids are **not namespaced per object type**: a Project or
  Opportunity can have the same numeric id as a Contact, and without the type check a
  note linked to "Project #10002" could be silently mis-filed into whatever household
  happens to own Contact #10002 — a confidentiality bug, already caught and tested
  (`engine/mod.rs`, `ingest_skips_and_counts_unlinked_objects`). Anything that can't
  resolve is counted in `IngestReport::skipped_unlinked`, never silently dropped or
  mis-filed.
- **Deletion detection is diff-based, not API-driven**, except for contacts: every sync
  builds a `seen` set of everything just filed; anything previously stored (for the same
  provider) but not in `seen` gets soft-deleted (`deleted = 1`). This only works correctly
  against a **full** listing — see §2.3 for why this caps how "incremental" a delta sync
  can be.
- `apply_ingest_batch()` commits every upsert + every tombstone in **one SQL transaction**
  at the end of a full `ingest()` call. Network fetches (which hold nothing in the DB) all
  happen first, then one transaction writes everything. This is efficient for routine syncs
  but means a crash mid-`ingest()` today loses the entire in-flight sync's work — nothing is
  checkpointed page-by-page (see §2.4, throughput).

### 1.4 Storage (`store.rs`)

- SQLCipher-encrypted DB (`crm-enc.db`), one `crm_objects` table: `id, kind, household_id,
  updated_at, content_hash, json, deleted`.
- **Important nuance for fidelity work:** the `json` column is `serde_json::to_string(c)`
  of the **typed Rust struct**, not the Wealthbox API's raw response body. Because serde
  silently ignores unknown JSON keys by default, **any field Wealthbox sends that isn't a
  named field on `CrmContact`/`CrmNote`/`CrmTask`/`CrmEvent` is dropped at parse time and
  never stored anywhere** — not even as an orphan blob. Today there is no true raw-response
  archive. The deep-dive doc's "raw JSON retained" line (§7) describes this typed-model
  JSON, not a verbatim API capture. **The importer must add verbatim raw-JSON retention** — see
  §2.1.
- `crm_cursors` table (`object_type → cursor` string) and `get_cursor`/`set_cursor` methods
  **already exist and are tested**, but **nothing in `ingest()` calls them** — every sync
  today is a full re-list of every object type, with `updated_since` never actually passed.
  This is tested scaffolding sitting unused — a strong starting point for §2.3, not
  a green-field build.
- `crm_outbound_writes` table is the write-back approval ledger (dedup key, status,
  remote id) — see §4. It is not the importer idempotency mechanism; D8 defines the only
  importer rule in §2.2.

### 1.5 Write-back (`write.rs`)

- Covers exactly two creation flows — `CrmWriteKind::Note` (`POST /notes`) and
  `CrmWriteKind::Task` (`POST /tasks`) — plus **one** field-level update: `PUT
  /contacts/{id}` restricted to `WRITABLE_FIELDS = ["background_information"]`
  (`write.rs:1112`). Nothing else is writable. No delete exists anywhere in the codebase,
  by design (doc comment on `client.rs`: "no delete anywhere").
- Two confirmed Wealthbox quirks, now guarded against:
  1. `POST /tasks` with no `due_date` returns HTTP 422 — validated client-side
     (`validate_task_due_date`) before any network call.
  2. The **read** field name and the **write** field name for the one writable field
     differ (`background_info` on read, `background_information` on write) — using the
     wrong one for either direction produces a 200-that-does-nothing "silent no-op."
     `write.rs` treats a readback that doesn't match as `WriteNotApplied`, never as
     success. **This is the exact shape of landmine to expect for every new writable
  field** — assume nothing about read/write field-name symmetry without a simulator case.
- Dedup: `dedup_key()` hashes (kind, household, normalized title/body, due date,
  `requested_at`) — scoped to *one approval event*, so a crash-retry of the same approval
  can't double-post, but a genuinely new approval of identical content (e.g. a recurring
  "left voicemail" note) still sends. This pattern is the right one to reuse for any new
  writable object type.
- Field writes carry a **stale-guard**: `push_crm_field_update` re-reads the current value at
  approve time and refuses to write if it no longer matches what the advisor reviewed
  (`StaleFieldValue`) — this is the seed of the parallel-run conflict policy (§4).

### 1.6 Confirmed gap (code + Wealthbox docs cross-check)

A repo-wide search for `workflow|opportunity|custom_field|attachment|project` inside
`commands/crm/` turns up **zero fetchers, zero models, zero write paths** for any of
those — "project" appears only as the *type string* the linked-object guard excludes
(§1.3), never as a fetched object. This matches the deep-dive's own summary (§7): "Missing:
workflow coverage, custom fields, file attachments, and full historical activity." The
live probe now makes the boundary precise: workflow templates/steps/collections are
readable but the API cannot read a workflow instance at `/workflow_instances`, and every
tested attachment/file/document read path is absent. Section 2 below covers what can be
imported and the explicit cutover fallbacks for what cannot.

---

## 2. The importer

**Framing:** the importer is not a separate one-shot batch script bolted onto the side —
it's the *same* `ingest()` engine already running as the read-only Mirror (deep-dive §7
phase 1), extended to (a) cover more object types, (b) retain true raw JSON, (c) checkpoint
progress, and (d) go incremental. "Migration" is the moment Lantern's copy of the data
becomes the one advisors *edit*, not a new fetch pipeline. D8 replaces the old
`crm_key()`/store-id explanation: the landing pipeline in §2.2 is the **only** importer
idempotency rule. Existing keys remain useful source identifiers and read-model keys, but
they never independently decide whether an import is safe to replay.

### 2.1 Full object coverage plan

| Object | Today | Wealthbox endpoint (per public docs, 2026-07-11) | Import plan |
|---|---|---|---|
| Contacts (person/household/org/trust) | ✅ fully modeled | `GET /v1/contacts` | Keep. Add raw-JSON retention (below). |
| Notes | ✅ (key quirk handled) | `GET /v1/notes` (returns `status_updates`) | Keep. |
| Tasks | ✅ | `GET /v1/tasks` | Keep. **UNVERIFIED**: docs describe nested subtasks — not modeled today; model a simulator case before implementation. |
| Events | ✅ | `GET /v1/events` | Keep. |
| Opportunities | ❌ not fetched | `GET /v1/opportunities` | **New.** The collection is live-readable, though empty in the fabricated sandbox. Import stages from `GET /v1/categories/opportunity_stage`; `/pipelines`, `/opportunity_stages`, and `/pipeline_stages` are absent at the tested paths. |
| Projects | ❌ not fetched (only excluded as a link type) | `GET /v1/projects` | **New.** |
| Workflow templates | ❌ | `GET /v1/workflow_templates` (read-only, per docs) | **New**, read-only — this is the template Lantern's own workflow-propagation feature needs to understand what a firm's workflows *are*. |
| Workflow instances / current step | ❌ | `GET /v1/workflows` and `GET /v1/workflow_steps` return 200 but were empty; `GET /v1/workflow_instances` returned 404 | **Not an API migration path in v1.** Current-state fidelity is **UNVERIFIED** until a seeded open workflow can be read. At cutover, use the guided manual re-creation fallback in §2.5a: templates plus activity traces become an operator checklist; the operator starts a new Lantern instance at the correct step. |
| Custom fields | ❌ | Registry IS readable at `GET /v1/categories/custom_fields?document_type=<Type>` (200, empty in this sandbox — [seeded re-probe](evidence/2026-07-11-wealthbox-seeded-reprobe.md)); the earlier-guessed `/v1/custom_fields`, `/contact_custom_fields`, `/custom_field_definitions` are 404; record-level `custom_fields` arrays are exposed on contacts | **New.** Import the registry from `/categories/custom_fields` per document type AND derive/cross-check the inventory from record-level `custom_fields` arrays, preserving each value's raw record reference; populated definition and value shapes are **UNVERIFIED** (sandbox holds no definitions — the seeded re-probe still owes this case). |
| Tags (registry) | Partial — tag strings already parse per-contact (`CrmTag`) | `GET /v1/categories/tags` | **New** — fetch the canonical registry so imported tags de-duplicate against one firm-wide tag list instead of becoming orphan strings per household. Contact records also supply `{id, name}` values inline. |
| Contact roles | Placeholder only (`Vec<Value>`, unused) | `GET /v1/contact_roles` | **New** — type it properly; today's field is a parse-safety no-op, not a complete import. |
| Activity stream | ❌ | `GET /v1/activity`, cursor-paginated | **New**, read-only, lower priority — this is "full historical activity" (logins, field changes, system events), imported as an inspectable timeline, not an editable record. It uses an opaque `meta.cursor`; persist its one cursor string in `crm_cursors` and request the next page with `cursor=<opaque-cursor>&per_page=100` (§2.3). No `Link` headers were observed. |
| Files / attachments | ❌ | Every tested global and per-contact `/attachments`, `/files`, and `/documents` read path returned 404 | **Out of v1 API migration scope.** Use the documented operator-export and per-client attachment-gap fallback in §2.5b; do not build an attachment downloader. |
| Users | Cached, in-memory only | `GET /v1/users` | **New** — persist as a reference import (id → name/email), used to map `assigned_to` to a Lantern member or an "external (Wealthbox-only) user" placeholder. |
| Teams | Cached, in-memory only | `GET /v1/teams` | **New**, same treatment as Users. |
| Categories (stages, sources, etc.) | Partial — label cache only | `GET /v1/customizable_categories`, `/v1/categories/{type}` | Persist as a lookup table so imported records show human labels without a network call, and so the importer can validate a category id at import time. |

### 2.2 Landing pipeline, raw capture, and replay safety (D8)

Every imported record takes exactly this path, in this order:

```text
verbatim raw HTTP response → typed source record → Lantern entity / CRDT mutation → external_refs projection
```

This pipeline is the sole rule for safe replay. A retry starts by looking up the source
record's `external_refs` projection, then re-applies the same typed source record into the
same entity or CRDT mutation in one transaction. It must never use a separate upsert key,
content hash, cursor, or UI action as a competing idempotency rule.

**New raw-capture layer.** Before parsing, the importer persists each verbatim response in
an encrypted `crm_raw_captures` store. Each capture has a stable `rawRecordRef`, batch id,
provider, endpoint, page/cursor position, captured-at timestamp, response bytes, byte
length, and SHA-256. Parsing makes typed source records that retain their originating
`rawRecordRef`; unknown fields remain recoverable because the original bytes are never
rewritten. Capture rows are append-only. The importer may mark a capture parsed or rejected,
but never alter its bytes, source locator, or hash.

**Atomic landing transaction.** For each typed source record, one SQLCipher transaction:

1. resolves or creates the Lantern entity / CRDT document using its existing
   `external_refs` projection;
2. applies the typed fields under the field-merge contract in `02-data-model.md`;
3. writes the entity's `rawRecordRef` and provenance; and
4. upserts the matching `external_refs` projection only after the mutation succeeds.

`external_refs` is the durable mapping `(provider, sourceType, sourceId, scope) →
EntityRef`. `scope` is empty for ordinary one-entity mappings and is a canonical,
sorted household-set fingerprint where a source record's confidentiality scope requires it.
The projection is rebuildable from captured records and Lantern provenance, but is the only
lookup used during normal replay.

**Multi-household notes.** A source note linked to several households becomes **one**
Lantern `Note`, never copied into several household records. Its `householdLinks` list holds
every resolved household link; its external reference uses the composite scope fingerprint
of that sorted list. The note is visible only to a person holding keys for **every** linked
household (the intersection rule). A missing or unauthorized household link prevents the
note from landing and records the specific allowed skip reason in the fidelity matrix.

**Archive manifest.** Each import batch creates one immutable archive manifest alongside
its raw captures. The manifest records the batch id, capture-layer version, fixture corpus
identity, every `rawRecordRef`, source locator, SHA-256, byte length, capture timestamp,
typed-record outcome, target `EntityRef` or skip reason, and the resulting `external_refs`
projection. The completed manifest is content-addressed and sealed; correction requires a
new batch and new manifest, never editing an earlier one. Every imported entity carries its
own `rawRecordRef` back to this manifest.

### 2.3 Incremental re-sync during parallel-run

Wire up the already-existing, already-tested `crm_cursors` scaffold, which today sits
unused:

- **Additive objects (contacts, notes, tasks, events, opportunities, projects, and readable
  workflow templates):** pass `updated_since` (already an accepted param on the objects that support
  it; **UNVERIFIED** exact format — the code's own comments flag this) using the cursor
  stored from the previous sync's completion time. This gets prompt pickup of
  *changes* cheaply.
- **Deletions are the catch:** an `updated_since`-scoped fetch, by definition, never sees
  something that was deleted (it's just absent from the response — same as it always was).
  Today's tombstone logic (§1.3) only works correctly against a **full** listing, because it
  diffs "everything we just saw" against "everything we had." **New design decision:** run
  a hybrid cadence — frequent incremental syncs (every few minutes, cursor-based, cheap) for
  parallel-run responsiveness, plus a periodic **full** resync (e.g. nightly) that is
  the only pass allowed to tombstone. Document this plainly for the fidelity report (§3):
  "last full reconciliation" needs its own visible timestamp, distinct from "last sync,"
  because a deletion made in Wealthbox at 2pm won't show as gone in Lantern until the next
  full pass, not the next incremental one.
- **Activity is settled:** it returns an opaque `meta.cursor`; one stored cursor string in
  the existing `object_type → cursor` table is sufficient for its incremental re-sync.
  Request the next page as `GET /activity?cursor=<opaque-cursor>&per_page=100`. The live
  probe saw no `Link` headers, so do not design around them.

### 2.4 Throughput / rate-limit handling

The existing 1 req/sec gate is a single mutex shared across **every** call this client
makes, for every object type. Adding six-plus new object types multiplies the number of
paginated calls a full historical pull makes, and that entire pull still serializes through
one request per second. Two concrete design changes for the importer specifically (routine
small-delta syncs are fine as-is):

1. **Checkpointed, resumable progress.** Today, `list_all()` collects an entire object
   type's pages into memory before `ingest()` ever touches the DB, and the whole sync
   commits in one transaction at the end (§1.3) — a crash or app-close mid-import today
   loses all in-flight work, not just the last page. For a firm's first full historical
   pull (which, per the rate gate above, plausibly runs for **hours, not minutes** — this
   is a background job the UI should show a progress bar and an "it's safe to close the app
   and resume later" message for, not a blocking modal), the importer needs to persist
   progress per object type (and per page, or per cursor position) so a resumed run picks
   up where it left off instead of re-paying the entire rate-gated cost from page 1.
2. **Per-object-type sequencing, not one giant blob.** Import contacts first (everything
   else links to them), then notes/tasks/events/opportunities/projects (link resolution
   needs contacts already loaded), then workflow templates, record-derived custom fields,
   and activity last (informational; nothing else depends on them). In-flight workflow
   instances follow the separate guided fallback in §2.5a, not this API sequence. This lets
   the fidelity report show clear incremental progress ("contacts: done, notes: 40% …")
   instead of an opaque all-or-nothing status.

### 2.5 Explicit non-API fallbacks

#### 2.5a Open workflow instances: guided re-creation at cutover

Open workflow instances are **not API-readable in v1**. The live probe found
`GET /workflow_instances` absent (404). `GET /workflows`, `GET /workflow_steps`, and
`GET /workflow_templates` returned 200, but the fabricated sandbox held no records, so they
do not prove an open instance's current step or state is readable. Workflow steps are not
write-only; their populated current-state shape simply remains **UNVERIFIED**.

The fallback is a guided, operator-owned cutover step, not a silent skip. The importer
imports readable workflow templates and activity-stream traces, then produces an
**in-flight workflow checklist** for each affected client: the source template, linked
client, available activity evidence, and a required operator decision. At cutover, the
operator starts a **new Lantern workflow instance** and selects its correct current step.
The fidelity report records the operator, decision, resulting Lantern instance, and any
unresolved trace as an explicit gap. This preserves visibility and makes the human judgment
auditable without claiming the API supplied state it did not.

#### 2.5b Files and attachments: operator export plus client-level gap flags

Files and attachments are **out of v1 API migration scope**. The live probe tested global
and per-contact `/attachments`, `/files`, and `/documents` paths; every one returned 404.
Do not build a Wealthbox attachment-listing or downloader.

The cutover fallback is a documented, operator-driven bulk export from the Wealthbox UI if
that UI offers one, or from the firm's connected storage provider where the files actually
live. For every client whose attachment status cannot be shown as imported from that
operator export, the fidelity report creates a visible **attachment gap** flag. The flag
names the client, records the export source and operator decision, and remains open until
the files are accounted for. This makes an unavailable API path visible rather than letting
documents silently disappear.

---

## 3. The fidelity report (a product artifact, not a log)

The existing `IngestReport` struct (`engine/ingest.rs`) already tracks `contacts, notes,
tasks, events, skipped_unlinked, removed_tombstoned` as plain counters — this is the right
shape to build on, not replace. Extend it into a durable product surface:

### 3.1 Structure

- **Per record type:** fetched N / imported N / skipped N, with skip reasons broken out
  exactly as listed for that source type in §3.2. Every fetched-but-not-imported record has
  exactly one reason, always shown.
- **Per-record drill-down:** each skipped record is individually addressable through its
  `rawRecordRef`, so a sandbox reviewer can inspect the verbatim capture and determine
  whether it is orphaned data or an importer defect.
- **Two timestamps, not one:** "last incremental sync" and "last full reconciliation" (see
  §2.3) — because a full reconciliation is the only pass that can prove a deletion.

### 3.2 Canonical fidelity matrix (D8)

This is the **only** fidelity matrix for the program. `06-test-campaign.md` adopts this
table by reference and must not create a competing matrix. “Complete” means every
fabricated source record reaches the stated target through §2.2 and has an archive-manifest
entry; “skip” means the record is retained in raw capture and reported with exactly one
listed reason.

| Source type | Target entity | Fixture source | Required completeness | Allowed skip reasons |
|---|---|---|---|---|
| Household/contact person/org/trust | Household, Person, `Person.personType` (Organization/Trust), household membership | Northcrest fabricated API corpus: contacts clean/null/collision cases | 100% for resolved active households and contacts | malformed source; unsupported source type; unresolved required household link |
| Note | One Note with `householdLinks[]` | Northcrest fabricated API corpus: single-link, multi-link, unresolved-link, collision cases | 100% when every household link resolves; one target note per source note | malformed source; no resolved household link; partial/missing household-link set; confidentiality intersection cannot be established |
| Task | Canonical Task (D2) | Northcrest fabricated API corpus: assigned/unassigned/due/recurrence cases | 100% for records with a valid target scope | malformed source; unresolved required household link; unsupported subtask shape |
| Event | `ActivityEvent` | Northcrest fabricated API corpus: household-linked and firm cases | 100% for records with a valid target scope | malformed source; unresolved required household link |
| Opportunity | Opportunity linked to PipelineDef/StageDef | Northcrest fabricated API corpus: opportunity and `/categories/opportunity_stage` cases | 100% where source stage-category references resolve | malformed source; missing required stage-category reference; unresolved required household link; stage value shape unverified pending seeded re-probe |
| Project | `LegacyProject` | Northcrest fabricated API corpus: linked/unlinked cases | 100% of parseable records; no automatic workflow conversion | malformed source; unresolved required link |
| Workflow template | WorkflowTemplate | Northcrest fabricated API corpus: templates and step definitions | 100% of parseable records | malformed source; unsupported source shape |
| Open workflow instance/current step | New Lantern workflow instance created by operator at cutover | Northcrest fabricated API corpus: templates, activity traces, and guided-re-creation checklist | 100% of in-flight workflows have a checklist and recorded operator decision; no API state is claimed | malformed source; guided manual re-creation fallback required because `/workflow_instances` is absent and populated current state is unverified; unresolved required link |
| Custom-field values / registry + record-derived inventory | Field inventory (`/categories/custom_fields` registry cross-checked against record-level arrays) plus typed target field/provenance | Northcrest fabricated API corpus: populated contact `custom_fields`, typed and null values, registry definitions | 100% of proven record-level supported shapes; registry and record inventories must agree or the divergence is reported | malformed source; unsupported field type; populated definition/value shape unverified pending seeded re-probe |
| Tags/categories | Firm lookup/read model and entity labels | Northcrest fabricated API corpus: duplicate and missing-label cases | 100% of parseable registry entries | malformed source; unresolved registry reference |
| Contact roles | `Person.roles[]` and `HouseholdMember.role` as applicable | Northcrest fabricated API corpus: person and household roles | 100% of typed role records | malformed source; role has no supported target scope |
| Users/teams | `FirmDirectoryEntry` read model | Northcrest fabricated API corpus: matched and external users | 100% of parseable records | malformed source |
| Activity stream | ActivityEvent timeline record | Northcrest fabricated API corpus: cursor, login, field-change cases | 100% of parseable records | malformed source; unsupported activity subtype |
| Files/attachments | No API migration target in v1; operator-export accounting plus per-client attachment-gap flag | Fabricated “no endpoint” fixture and operator-export/gap cases | 0% via API; 100% of affected clients have an explicit exported-or-gap status | API read paths absent; operator export unavailable; attachment gap remains open |

### 3.3 The 100%-on-what-matters bar

Not every fetched byte carries equal weight, and pretending otherwise (either "100% of
everything" as an unreachable purity test, or "close enough" as an acceptable standard for
client data) both fail the product. The bar:

- **"Matters" = anything tied to an active client relationship**: households, contacts,
  notes, tasks, events, and opportunities linked to a still-open household. These import at
  **100% or the sandbox migration is not marked complete** — no silent partial
  success.
- **Lower-stakes categories** (a note whose only link was to a project or opportunity that
  no longer exists in the workspace; activity-stream login/system events; a workflow
  instance closed years before the migration) may have a lower completeness bar, but they
  are still **counted and disclosed**, never silently dropped — the difference from
  "matters" records is *how loudly it's surfaced*, not whether it's tracked at all.
- **Attachments are a separate v1 boundary:** they are not API-importable, so they cannot
  satisfy the ordinary record-import bar. Every affected client must instead show either a
  completed operator export or an open attachment-gap flag (§2.5b); an unflagged absence is
  a migration failure.
- **Why this bar, in the advisors' own words:** the user research (evidence ledger `E-094`)
  captures an advisor describing sending a client's tax document to the wrong accountant as
  "a nail biter" — a trust-breaking mistake, not a rounding error, precisely because it's
  the client's own sensitive information going somewhere it shouldn't. Losing (or silently
  mis-filing) one client's note or task during a CRM migration is the same category of
  failure from the advisor's seat: the whole pitch for switching off Wealthbox is "nothing
  about my clients gets lost or scrambled," and one dropped record — even one — falsifies
  that pitch for the advisor who finds it, regardless of how many thousands imported
  cleanly.

### 3.4 As a durable artifact

The fidelity report is generated as a document a firm can keep — exportable (PDF or
similarly durable format), timestamped, matched 1:1 against the frozen archive's manifest
(§5) — not a debug log that only an engineer reads. It's the thing a firm's compliance
officer files alongside the frozen Wealthbox export for their own records.

---

## 4. Parallel-run mode

Deep-dive §7 phase 2: Lantern's records become editable while every Lantern-side change
still writes back to Wealthbox, which stays authoritative. This is "the honest test of
would they switch" — so it has to be honest about exactly what round-trips and what doesn't.
Under D7, this section specifies only a fabricated-data sandbox rehearsal; it does not
authorize a customer-data parallel run.

### 4.1 What write-back actually covers today (verified, §1.5)

- **Notes:** create only (`POST /notes`). No update, no delete — this is structurally
  fine, because notes are append-only in the advisor workflow anyway (you add a new note,
  you don't rewrite history) and it means notes **cannot conflict** — there's nothing to
  reconcile.
- **Tasks:** create only (`POST /tasks`), with Wealthbox's documented due-date
  requirement enforced before send.
- **Contact fields:** exactly one field, `background_information`, via `PUT
  /contacts/{id}`, with a stale-guard.
- **Everything else the read side now imports (§2) has zero write path**: address changes,
  tags, financial-profile edits, marital status, risk tolerance, opportunities, projects,
  workflow-step progression, custom fields — none of it round-trips. If an advisor edits any
  of these in Lantern during parallel-run today, that edit is Lantern-only and **will not
  appear in Wealthbox**, silently, unless the UI is explicit about it.

### 4.2 Design requirement for parallel-run

1. **Be honest in the UI about the round-trip boundary.** Don't let an advisor edit a field
   that can't write back without a visible marker ("this stays in Lantern until cutover" or
   similar) — the entire point of parallel-run is trust; a field that silently doesn't sync
   back is a worse trust failure than not offering the edit at all.
2. **Expanding write-back is careful, field-by-field work, not a batch job.** Each new
   writable field should be expected to need the same simulator verification write.rs already
   did once for `background_information` (§1.5's read/write name-mismatch landmine, the
   422-without-due-date landmine) — budget per-field verification, not a bulk "just add
   these to `WRITABLE_FIELDS`."
3. **Opportunities/projects are read-only mirrors during parallel-run; workflows use the
   explicit fallback, not a false mirror.** These objects have zero write scaffolding
   today. Workflow templates and activity traces may be shown read-only, but Lantern must
   not present an API-derived open-workflow state while current-state readability remains
   unproven (§2.5a). At cutover, in-flight workflows use guided manual re-creation. Do not
   let advisors edit any of these in Lantern until the subsystem gets its own dedicated
   design and review pass.

### 4.3 Conflict policy

Use the pattern the stale-guard on the field-update path already established
(`push_crm_field_update`, §1.5): **re-read the current value at write time; if it has changed
since what the advisor reviewed, refuse the write and surface the current value rather than
guessing or overwriting.** This generalizes cleanly to any newly-round-tripped field. It is
deliberately **not** the CRDT merge algorithm from architecture decision #2 — that governs
conflicts between two *Lantern* users editing the same shared Lantern document, a genuinely
different problem (both sides are peers with CRDT merge semantics). Wealthbox, from
Lantern's point of view, is a dumb REST store with no merge concept of its own — optimistic
locking (read-check-then-write, surface don't silently clobber) is the right shape for
*this* boundary, not a CRDT.

---

## 5. Cutover + rollback

This is a fabricated-data sandbox cutover and rollback rehearsal only. It does not
authorize a customer migration, external write, or production cutover.

### 5.1 Immutable import-batch archive manifest

Each completed sandbox batch seals the immutable archive manifest defined in §2.2. Its
raw-capture files may be exported as one newline-delimited JSON file per source type
(`contacts.ndjson`, `notes.ndjson`, …), but the manifest is the authoritative archive
index: every `rawRecordRef`, checksum, source locator, typed outcome, target entity,
external-reference projection, and fidelity-matrix result appears exactly once. Its counts
must match §3 exactly. The archive is retained outside the editable Lantern data store;
neither its raw captures nor its manifest can be edited after sealing.

### 5.2 Day-one rollback

Re-export from Lantern back to a Wealthbox-importable format, split by what's actually
being rolled back:

- **Contact-field edits made only in Lantern** (anything beyond the one field that already
  round-trips): re-export as CSV matching Wealthbox's own bulk contact-import column
  schema. **UNVERIFIED** — confirm through documented schemas whether that import tool's columns cover
  every field this connector syncs, or only a subset; this gates how complete a rollback of
  contact edits can actually be.
- **Lantern-native notes/tasks/events created after cutover:** replay them back through the
  same authenticated `POST` calls the write path already has half-built (§1.5, extended to
  events). Every replay enters the same raw response → typed source record → entity/CRDT
  mutation → `external_refs` landing pipeline in §2.2; no separate rollback dedupe rule is
  permitted.
- This is written down now as a **plan**, not implemented — building and testing the
  rollback path is build-wave/test-campaign work, but the plan must exist before cutover is
  ever used outside the fabricated sandbox, per the deep-dive's own framing of cutover requiring "a
  defined day-one rollback," not a vague promise.

### 5.3 The Jump-coexistence problem (explicit, per charter instruction)

In the fabricated Jump-coexistence scenario, Jump writes into the simulated Wealthbox API.
During Mirror and Parallel-run (deep-dive §7 phases 1–2), Lantern reads those simulated
writes automatically. **At cutover, that stops being true.** Once the simulated Wealthbox
store is no longer authoritative (archived per §5.1), simulated Jump writes have nowhere
authoritative to land. The sandbox scenario has exactly two outcomes, and the rehearsal
must select one before cutover:

1. **Drop Jump.** Whatever meeting-notes/follow-up automation Jump provided needs to
   already be replaced by a Lantern-native equivalent before cutover, or the scenario loses
   that capability on day one.
2. **Keep Jump, lose its write target.** Jump keeps running against Wealthbox, but those
   writes now land in a system the scenario has stopped treating as authoritative — meaning
   Jump's output either goes unread or the scenario quietly keeps using Wealthbox for
   Jump-touched work, undermining the whole point of cutting over.

**A concrete gap this design surfaces:** today's `CrmNote` model has no way to distinguish
a Jump-authored note from a human-authored one — notes are undifferentiated. There is no
automatic way to measure how dependent a sandbox scenario is on Jump's writes before
cutover. The closest available mitigation, and a named item for the migration-readiness
checklist, is a **manual pre-cutover audit**: sample recent notes/tasks for Jump's
recognizable format or footer text and estimate reliance before selecting
option 1 or 2.

---

## 6. Test plan hooks for lane F

### 6.1 Fixture corpus

Two fabricated sources already exist and should be consolidated, not rebuilt from scratch:

- **`model.rs`'s inline test fixtures** (`CONTACTS_FIXTURE`, `NOTES_FIXTURE`,
  `TASKS_FIXTURE`, `EVENTS_FIXTURE`) — realistic, shaped against documented (and in one
  case quirk-corrected: the `background_info` alias) Wealthbox responses, including
  null-field edge cases (`household_with_null_fields_and_top_level_name_parses_correctly`)
  and the id-collision guard case in `engine/mod.rs`
  (`ingest_skips_and_counts_unlinked_objects`).
- **The Northcrest demo dataset** (`~/lantern-demo-data`, 80 households / 374 docs,
  referenced in project memory as the program's fabricated demo firm) — a larger
  fabricated corpus already built for other purposes, worth reusing as the volume test
  case for the importer's throughput/checkpointing work (§2.4).

**New fixture work needed:** every newly-added object type (§2.1) needs both clean and
edge-case fixtures — nulls, missing keys, colliding numeric ids across object types (the
existing Project/Contact-id-collision test is the template), populated record-level custom
fields, stage categories, and a representative **open workflow** with activity traces. The
simulator must model the proven API boundary (`/workflow_instances` absent) and the guided
manual re-creation fallback, rather than assuming a readable instance-state endpoint.

### 6.2 Synthetic Wealthbox API simulator

`client.rs` already supports a swappable base URL (`new_with_base`, built for tests) and
the existing test suite already runs a local mock HTTP server (`wiremock`) for `client.rs`'s
own unit tests (e.g. `post_json_sends_token_header_and_parses_response`). This is the seed
of a complete simulator, not a green-field build:

- Build a small `wiremock`-backed fake Wealthbox server that serves the full fixture corpus
  (§6.1) across every endpoint in §2.1's coverage table, with configurable pagination,
  429/rate-limit behavior, and mid-page failure injection (for testing the checkpoint/resume
  logic from §2.4).
- Lane F's exit tests drive the whole importer + fidelity-report pipeline against this
  simulator with **zero external-account dependency** — this is also the right shape for an
  ongoing CI regression gate, since the simulator's fixture corpus has known, fixed
  fetched/imported/skipped counts.

### 6.3 Fidelity report as an automated gate

Because the simulator's corpus has known counts, the fidelity report's own numbers become
an exact-match assertion, not a manual read: fetched N must equal imported N for every
"matters" category (§3.2) with zero unexplained skips — this turns the "100% on records
that matter" bar into something lane F can assert in CI on every change, not just check by
hand before a release.

### 6.4 Seeded re-probe before build commitments

The live fabricated sandbox was near-empty: it had 229 contacts but no workflows,
opportunities, projects, populated custom-field values, or populated opportunity stages.
Several results are therefore absence-of-data, not proof of populated-record behavior.
Before build commitments that depend on those shapes, seed the Wealthbox sandbox through its
UI with **synthetic Northcrest-style, clearly fake data only** (D7): workflow templates,
open workflows with steps in progress, opportunities with stage categories, projects, and
contacts with populated custom fields. Re-run the read probe against those records, then
update this document and the canonical fidelity matrix (§3.2) with the proven verdicts.

This re-probe also checks whether the sandbox's empty collections reflect plan availability,
but does not assume they do: the first probe saw no 402 or 403 response, so plan gating is
still unproven. No customer data, production account, or non-fabricated workspace is allowed
for this task.

---

## 7. Open questions / UNVERIFIED (dated 2026-07-11)

The 2026-07-11 live probe settled these points and they are **not** open questions:
`per_page=100` is the effective page cap; activity uses one opaque `meta.cursor` string
with no observed `Link` headers; tags use `GET /categories/tags` and contacts expose inline
`{id,name}` tags; workflow steps are readable as a collection (not write-only); the
custom-field registry is readable at `GET /categories/custom_fields?document_type=<Type>`
(the guessed `/custom_fields`-style addresses are absent — corrected by the
[seeded re-probe](evidence/2026-07-11-wealthbox-seeded-reprobe.md), which also proved the
populated Projects shape and that project-contact links do not persist through
`PUT /projects`); `/pipelines` is absent while
`/categories/opportunity_stage` is readable; `/workflow_instances` is absent; and every
tested attachment/file/document read path is absent. See the
[live probe evidence](evidence/2026-07-11-wealthbox-api-probe.md).

The following remain simulator-modeling risks. They are resolved through the seeded
re-probe in §6.4 and fabricated simulator tests only; this program does not authorize
obtaining answers from customer data, production accounts, or non-fabricated workspaces.
None blocks freezing this design, but each is an accepted risk that must be named at
spec-freeze review:

1. **Highest risk:** whether populated `GET /workflows` and `GET /workflow_steps` records
   expose enough state to describe an open workflow's current step/stage. The empty sandbox
   cannot answer this even though both collections returned 200; `/workflow_instances`
   itself is absent. Until §6.4 proves otherwise, the guided manual re-creation fallback in
   §2.5a is required.
2. The populated value shape of contact `custom_fields`, and whether record-level arrays
   also appear on notes, tasks, or opportunities. Registry import remains unavailable;
   §6.4 seeds fake values to establish the record-derived import contract.
3. The populated shape and references of opportunities, projects, and opportunity stages.
   The collections/stage-category endpoint were readable but empty; §6.4 seeds fake cases.
4. Whether Wealthbox's contact CSV bulk-import format (needed for rollback, §5.2) covers
   every field this connector syncs, or only a subset.
5. Whether notes/tasks/events/opportunities/projects/workflows expose any deleted-item
   filter (contacts do, via `?deleted=true`) — today's diff-based tombstoning (§1.3, §2.3)
   remains the only mechanism for every other object type and only works on a full resync.
6. Rate-limit behavior across many object-type endpoints during a full historical pull for a
   firm-sized fabricated corpus — untested at scale; today's single shared rate gate is the
   mitigation in place.
7. Whether OAuth 2.0 (which the public docs describe as the primary auth path) differs from
   the raw `ACCESS_TOKEN` header this fork implements in available scopes or rate limits for
   the new endpoints.
8. Whether empty workflow, opportunity, project, team, custom-field, and stage collections
   are affected by account tier. No request returned 402 or 403, so plan gating is
   **UNVERIFIED**; §6.4 records it as a re-probe observation, not as an assumption.

---

**Summary for spec-freeze review:** the read side is a solid, well-tested four-object
foundation (contacts/notes/tasks/events) with pagination, rate-limiting, and PII discipline
already present in the code — but it covers roughly half of what a faithful Wealthbox
migration needs, and the write side covers two object types plus one field. The
highest-leverage unknown is the populated current-state shape of the readable workflow
collections. Until the seeded re-probe proves it, in-flight work uses the auditable guided
manual re-creation fallback, and files use the explicit attachment-gap fallback rather than
an assumed API migration path.
