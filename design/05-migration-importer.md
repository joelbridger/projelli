# 05 — Migration & Importer (Wealthbox → Lantern)

**Lane E · design phase · LANTERN-CRM program**
**Written:** 2026-07-11. Code inventory verified against this fork at the commit checked
out today (`~/lantern-crm`, forked from `~/lantern-plus` `0971d8f3`). Public API claims
verified via web search/fetch against `dev.wealthbox.com` and related sources on
2026-07-11 — dated because Wealthbox's docs can change; anything not directly quoted from
a fetched page is marked **UNVERIFIED** and needs a live-token check before the build wave
locks it in.

**Entity names note:** `design/02-data-model.md` (lane B) had not landed as of this
writing. Sections below describe Wealthbox objects and how they map onto *conceptual*
Lantern entities (Household, Contact, Note, Task, Event, Opportunity, Workflow Instance,
etc.) using plain descriptive names, not lane B's final type names. Reconcile at
`00-master-spec.md` / `SPEC-FREEZE.md`. The one name that is already locked and must not
be reinvented: the internal facade is `matter` / `matter_id` — a Household/Client maps onto
one `matter`, per the charter's inherited invariant.

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
- **Pagination:** `list_all()` loops `page = 1, 2, …` at `per_page = DEFAULT_PER_PAGE` (50,
  `model.rs`) until a page returns fewer items than the page size. The real maximum
  `per_page` Wealthbox allows is **UNVERIFIED** (`TODO(live-probe)` comments throughout
  `client.rs`/`model.rs` — the docs don't state it).
- **PII discipline:** non-2xx responses log only the HTTP status and endpoint path, never
  the response body (bodies can carry client PII). This is a real security property, not
  boilerplate — the importer must preserve it even while adding new endpoints.
- **Typed fetchers that exist:** `list_contacts` (optional `updated_since`, `contact_type`),
  `list_households` (contacts filtered to `type=household`), `list_notes` (⚠️ the API
  returns notes under the JSON key `status_updates`, not `notes` — a real, already-hit
  quirk), `list_tasks`, `list_events`, `deleted_contact_ids` (Wealthbox contacts support a
  real tombstone via `?deleted=true`; **no other object type exposes a deleted-items
  filter** in this client today).
- **Label resolver:** `resolve_category_label` / `resolve_user_name` / `resolve_team_name`
  lazily fetch and cache `/categories/{type}`, `/users`, `/teams` — **in-memory only, reset
  on every app restart, never persisted**. Fine for read-time label rendering; not usable
  as a durable Users/Teams import.
- **Not fetched by anything in this client today:** opportunities, projects, workflows,
  workflow templates, workflow steps, custom fields, tags (the dedicated `/tags` list —
  distinct from the tag strings already embedded on a contact), activity stream, contact
  roles (the dedicated list — a raw placeholder exists on the contact struct, see below).

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
  placeholder, not a real import of Wealthbox's contact-roles feature.
- Every bare `String`/`Vec` field uses a `null_to_default` deserializer so the live API's
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
  JSON, not a verbatim API capture. **The importer must add real raw-JSON retention** — see
  §2.1.
- `crm_cursors` table (`object_type → cursor` string) and `get_cursor`/`set_cursor` methods
  **already exist and are tested**, but **nothing in `ingest()` calls them** — every sync
  today is a full re-list of every object type, with `updated_since` never actually passed.
  This is real, tested scaffolding sitting unused — a strong starting point for §2.3, not
  a green-field build.
- `crm_outbound_writes` table is the write-back idempotency ledger (dedup key, status,
  remote id) — see §4.

### 1.5 Write-back (`write.rs`)

- Covers exactly two creation flows — `CrmWriteKind::Note` (`POST /notes`) and
  `CrmWriteKind::Task` (`POST /tasks`) — plus **one** field-level update: `PUT
  /contacts/{id}` restricted to `WRITABLE_FIELDS = ["background_information"]`
  (`write.rs:1112`). Nothing else is writable. No delete exists anywhere in the codebase,
  by design (doc comment on `client.rs`: "no delete anywhere").
- Two confirmed live Wealthbox quirks, found the hard way and now guarded against:
  1. `POST /tasks` with no `due_date` returns HTTP 422 — validated client-side
     (`validate_task_due_date`) before any network call.
  2. The **read** field name and the **write** field name for the one writable field
     differ (`background_info` on read, `background_information` on write) — using the
     wrong one for either direction produces a 200-that-does-nothing "silent no-op."
     `write.rs` treats a readback that doesn't match as `WriteNotApplied`, never as
     success. **This is the exact shape of landmine to expect for every new writable
     field** — assume nothing about read/write field-name symmetry until proven live.
- Dedup: `dedup_key()` hashes (kind, household, normalized title/body, due date,
  `requested_at`) — scoped to *one approval event*, so a crash-retry of the same approval
  can't double-post, but a genuinely new approval of identical content (e.g. a recurring
  "left voicemail" note) still sends. This pattern is the right one to reuse for any new
  writable object type.
- Field writes carry a **stale-guard**: `push_crm_field_update` re-reads the live value at
  approve time and refuses to write if it no longer matches what the advisor reviewed
  (`StaleFieldValue`) — this is the seed of the parallel-run conflict policy (§4).

### 1.6 Confirmed gap (code + Wealthbox docs cross-check)

A repo-wide search for `workflow|opportunity|custom_field|attachment|project` inside
`commands/crm/` turns up **zero fetchers, zero models, zero write paths** for any of
those — "project" appears only as the *type string* the linked-object guard excludes
(§1.3), never as a fetched object. This matches the deep-dive's own summary (§7): "Missing:
workflows and open instances, custom fields, file attachments, and full historical
activity." Section 2 below is the coverage plan for closing that gap.

---

## 2. The importer

**Framing:** the importer is not a separate one-shot batch script bolted onto the side —
it's the *same* `ingest()` engine already running as the read-only Mirror (deep-dive §7
phase 1), extended to (a) cover more object types, (b) retain true raw JSON, (c) checkpoint
progress, and (d) go incremental. "Migration" is the moment Lantern's copy of the data
becomes the one advisors *edit*, not a new fetch pipeline. This keeps re-runs safe for
free: the existing `crm_key()`/store-id upsert scheme already makes every `ingest()` call
idempotent (§1.2, §1.3) — re-running the importer twice does not duplicate anything, it
just re-confirms the same rows (or picks up what changed).

### 2.1 Full object coverage plan

| Object | Today | Wealthbox endpoint (per public docs, 2026-07-11) | Import plan |
|---|---|---|---|
| Contacts (person/household/org/trust) | ✅ fully modeled | `GET /v1/contacts` | Keep. Add raw-JSON retention (below). |
| Notes | ✅ (key quirk handled) | `GET /v1/notes` (returns `status_updates`) | Keep. |
| Tasks | ✅ | `GET /v1/tasks` | Keep. **UNVERIFIED**: docs describe nested subtasks — not modeled today; confirm shape live. |
| Events | ✅ | `GET /v1/events` | Keep. |
| Opportunities | ❌ not fetched | `GET /v1/opportunities` | **New.** Needed for pipeline/deal history — currently invisible to Lantern entirely. |
| Projects | ❌ not fetched (only excluded as a link type) | `GET /v1/projects` | **New.** |
| Workflow templates | ❌ | `GET /v1/workflow_templates` (read-only, per docs) | **New**, read-only — this is the template Lantern's own workflow-propagation feature needs to understand what a firm's workflows *are*. |
| Workflow instances | ❌ | `GET /v1/workflows` (filterable by resource/status) | **New — highest-risk item.** See below. |
| Workflow step state | ❌ | `PUT /v1/workflow_steps` (complete/revert) documented; **no list/read endpoint found** | **UNVERIFIED, critical.** If there is truly no way to read a workflow instance's current step short of enumerating steps some other way, we cannot faithfully import "what stage is this client at" — only that a workflow is attached. This directly threatens the charter's own locked decision #6 ("workflow-template propagation to open instances is the marquee feature and the hardest correctness problem") — if we can't even *read* instance state reliably, propagation design is blocked on this API question, not on our own logic. **Must be tested against a live token before the build wave, not assumed.** |
| Custom fields | ❌ | `GET /v1/custom_fields` (registry) + nested arrays on records, shape `{id, name, value, document_type, field_type}` per docs | **New.** Add a `CrmCustomField` struct, merge onto `CrmContact` (confirmed nested there per docs) and **UNVERIFIED** onto notes/tasks/opportunities — check live. |
| Tags (registry) | Partial — tag strings already parse per-contact (`CrmTag`) | `GET /v1/tags` | **New** — fetch the canonical registry so imported tags de-duplicate against a real workspace-wide tag list instead of becoming orphan strings per household. |
| Contact roles | Placeholder only (`Vec<Value>`, unused) | `GET /v1/contact_roles` | **New** — type it properly; today's field is a parse-safety no-op, not a real import. |
| Activity stream | ❌ | `GET /v1/activity`, cursor-paginated, filterable by contact/type/updated_since | **New**, read-only, lower priority — this is "full historical activity" (logins, field changes, system events), imported as an inspectable timeline, not an editable record. Its native cursor param is a good match for the currently-unused `crm_cursors` scaffold (§2.3). |
| Files / attachments | ❌ | **No documented endpoint found.** Wealthbox's own help docs point firms at third-party file storage integrations (Box, OneDrive/SharePoint) rather than native file hosting. | **UNVERIFIED / likely non-goal.** See §2.5 — don't design an "attachment downloader" against an API that may not exist; confirm with a real firm's setup first. |
| Users | Cached, in-memory only | `GET /v1/users` | **New** — persist as a real one-time reference import (id → name/email), used to map `assigned_to` to a Lantern member or an "external (Wealthbox-only) user" placeholder. |
| Teams | Cached, in-memory only | `GET /v1/teams` | **New**, same treatment as Users. |
| Categories (stages, sources, etc.) | Partial — label cache only | `GET /v1/customizable_categories`, `/v1/categories/{type}` | Persist as a lookup table so imported records show human labels without a live network call, and so the importer can validate a category id still exists in the workspace at import time. |

**Raw-JSON retention (new, required):** add a `crm_objects_raw` table (or a `raw_json`
column alongside the existing typed `json` column) that stores the **unmodified API
response body** per object, written at ingest time before/alongside the typed-model parse.
This is not optional for a migration tool: without it, any field Wealthbox sends that isn't
one of today's named struct fields is unrecoverable the moment it's fetched — including for
new object types we haven't fully modeled yet by launch. It is also the backbone of the
frozen export archive (§5) and the fidelity report's per-record drill-down (§3).

### 2.2 ID mapping + dedupe (re-runnable imports)

Extend the existing `crm_key()` / store-id pattern (`contact:<id>`, `note:<id>[@<household>]`)
uniformly to every new object type: `opportunity:<id>`, `project:<id>`,
`workflow:<id>`, `workflowtemplate:<id>`, `customfield:<id>`, `activity:<id>`, etc.,
carrying the same provider-prefix convention (`sfdc:`/`redtail:`) for multi-provider
safety. Because every upsert is keyed on this id and resets `deleted = 0` on re-appearance
(`store.rs`), **the importer is naturally re-runnable and idempotent** — running it again
after a partial failure, or periodically during parallel-run, never creates duplicates. The
one piece that needs new work is extending the linked-object type guard (§1.3) so a note
linked to a real Opportunity or Project (now that those are actually fetched) files under
the *right* grouping key instead of falling into `skipped_unlinked` by default.

### 2.3 Incremental re-sync during parallel-run

Wire up the already-existing, already-tested `crm_cursors` scaffold, which today sits
unused:

- **Additive objects (contacts, notes, tasks, events, opportunities, projects, workflow
  instances):** pass `updated_since` (already an accepted param on the objects that support
  it; **UNVERIFIED** exact format — the code's own comments flag this) using the cursor
  stored from the previous sync's completion time. This gets near-real-time pickup of
  *changes* cheaply.
- **Deletions are the catch:** an `updated_since`-scoped fetch, by definition, never sees
  something that was deleted (it's just absent from the response — same as it always was).
  Today's tombstone logic (§1.3) only works correctly against a **full** listing, because it
  diffs "everything we just saw" against "everything we had." **New design decision:** run
  a hybrid cadence — frequent incremental syncs (every few minutes, cursor-based, cheap) for
  live parallel-run responsiveness, plus a periodic **full** resync (e.g. nightly) that is
  the only pass allowed to tombstone. Document this plainly for the fidelity report (§3):
  "last full reconciliation" needs its own visible timestamp, distinct from "last sync,"
  because a deletion made in Wealthbox at 2pm won't show as gone in Lantern until the next
  full pass, not the next incremental one.
- The activity stream's own cursor param (§2.1) is a better fit for the unused
  `crm_cursors` shape than most objects — confirm it composes with the current
  `object_type → single cursor string` schema, or whether it needs a richer cursor value
  (page token vs timestamp) — **UNVERIFIED**.

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
   needs contacts already loaded), then workflows/custom-fields/activity last (informational,
   nothing else depends on them). This lets the fidelity report show real incremental
   progress ("contacts: done, notes: 40% …") instead of an opaque all-or-nothing status.

### 2.5 Attachment download strategy

**Provisional, pending verification.** No documented Wealthbox endpoint for listing or
downloading files/attachments was found (§2.1). Wealthbox's own help center describes file
storage as something firms do through connected third-party integrations (Box, OneDrive/
SharePoint), not through Wealthbox itself. If that holds up under a live check, the
importer's correct behavior is to **not** claim file migration as a Wealthbox-connector
responsibility at all — a firm's actual files most likely already live in a storage
provider Lantern has its own, separate connector for (per the parent Keepance codebase's
existing OneDrive/SharePoint and Box connectors). The migration-readiness checklist (§5)
should include "confirm which file-storage integration this firm actually uses" as a
discovery step, not assume it. **Do not build a Wealthbox-attachments fetcher against
unconfirmed docs — verify live first**, and if a real attachments API does turn up on a live
workspace, this section needs a real design pass (streamed download, size limits, virus
scanning parity with the existing document pipeline).

---

## 3. The fidelity report (a product artifact, not a log)

The existing `IngestReport` struct (`engine/ingest.rs`) already tracks `contacts, notes,
tasks, events, skipped_unlinked, removed_tombstoned` as plain counters — this is the right
shape to build on, not replace. Extend it into a real product surface:

### 3.1 Structure

- **Per record type:** fetched N / imported N / skipped N, with skip reasons broken out
  (unlinked, unparseable/malformed, duplicate id collision, provider rejected the record on
  a later write-back check, category/field reference to something no longer in the
  workspace). Every fetched-but-not-imported record has exactly one reason, always shown.
- **Per-record drill-down:** each skipped record is individually addressable — a firm's
  admin (or Lantern's own support) can open "12 notes skipped: unlinked" and see the actual
  12, including enough of the raw content (from the raw-JSON retention in §2.1) to judge
  whether it's genuinely orphaned data or a real bug.
- **Two timestamps, not one:** "last incremental sync" and "last full reconciliation" (see
  §2.3) — because a full reconciliation is the only pass that can prove a deletion.

### 3.2 The 100%-on-what-matters bar

Not every fetched byte carries equal weight, and pretending otherwise (either "100% of
everything" as an unreachable purity test, or "close enough" as an acceptable standard for
client data) both fail the product. The bar:

- **"Matters" = anything tied to an active client relationship**: households, contacts,
  notes, tasks, events, and opportunities linked to a still-open household. These import at
  **100% or the migration is not offered to the firm as complete** — no silent partial
  success.
- **Lower-stakes categories** (a note whose only link was to a project or opportunity that
  no longer exists in the workspace; activity-stream login/system events; a workflow
  instance closed years before the migration) may have a lower completeness bar, but they
  are still **counted and disclosed**, never silently dropped — the difference from
  "matters" records is *how loudly it's surfaced*, not whether it's tracked at all.
- **Why this bar, in the advisors' own words:** the user research (evidence ledger `E-094`)
  captures an advisor describing sending a client's tax document to the wrong accountant as
  "a nail biter" — a trust-breaking mistake, not a rounding error, precisely because it's
  the client's own sensitive information going somewhere it shouldn't. Losing (or silently
  mis-filing) one client's note or task during a CRM migration is the same category of
  failure from the advisor's seat: the whole pitch for switching off Wealthbox is "nothing
  about my clients gets lost or scrambled," and one dropped record — even one — falsifies
  that pitch for the advisor who finds it, regardless of how many thousands imported
  cleanly.

### 3.3 As a real artifact

The fidelity report is generated as a document a firm can keep — exportable (PDF or
similarly durable format), timestamped, matched 1:1 against the frozen archive's manifest
(§5) — not a debug log that only an engineer reads. It's the thing a firm's compliance
officer files alongside the frozen Wealthbox export for their own records.

---

## 4. Parallel-run mode

Deep-dive §7 phase 2: Lantern's records become editable while every Lantern-side change
still writes back to Wealthbox, which stays authoritative. This is "the honest test of
would they switch" — so it has to be honest about exactly what round-trips and what doesn't.

### 4.1 What write-back actually covers today (verified, §1.5)

- **Notes:** create only (`POST /notes`). No update, no delete — this is structurally
  fine, because notes are append-only in the advisor workflow anyway (you add a new note,
  you don't rewrite history) and it means notes **cannot conflict** — there's nothing to
  reconcile.
- **Tasks:** create only (`POST /tasks`), with Wealthbox's live-confirmed due-date
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
2. **Expanding write-back is real, field-by-field work, not a batch job.** Each new
   writable field should be expected to need the same live-verification write.rs already
   did once for `background_information` (§1.5's read/write name-mismatch landmine, the
   422-without-due-date landmine) — budget per-field verification, not a bulk "just add
   these to `WRITABLE_FIELDS`."
3. **Workflows/opportunities/projects should be READ-ONLY MIRROR during parallel-run,
   explicitly, not attempted write-back.** These are the objects with zero write
   scaffolding today, and per the charter's own pre-made decision #6, workflow-instance
   correctness is already flagged as the single hardest problem in the whole program. Let
   parallel-run advisors *see* their pipeline/workflow state live from Wealthbox, but don't
   let them edit it in Lantern until that subsystem gets its own dedicated design and
   review pass — rushing write-back for the riskiest object type into parallel-run is the
   wrong place to take that risk.

### 4.3 Conflict policy

Use the pattern the stale-guard on the field-update path already established
(`push_crm_field_update`, §1.5): **re-read the live value at write time; if it has changed
since what the advisor reviewed, refuse the write and surface the current value rather than
guessing or overwriting.** This generalizes cleanly to any newly-round-tripped field. It is
deliberately **not** the CRDT merge algorithm from architecture decision #2 — that governs
conflicts between two *Lantern* users editing the same shared Lantern document, a genuinely
different problem (both sides are peers with real merge semantics). Wealthbox, from
Lantern's point of view, is a dumb REST store with no merge concept of its own — optimistic
locking (read-check-then-write, surface don't silently clobber) is the right shape for
*this* boundary, not a CRDT.

---

## 5. Cutover + rollback

### 5.1 Frozen Wealthbox archive export

Once raw-JSON retention exists (§2.1), the frozen archive is a straightforward export: one
newline-delimited-JSON file per object type (`contacts.ndjson`, `notes.ndjson`, …) built
from the **raw** captured bodies (not the typed-model reserialization — the whole point is
recordkeeping fidelity to what Wealthbox actually sent), bundled with a manifest whose
counts must match the fidelity report (§3) exactly. This satisfies the deep-dive's Rule
204-2 recordkeeping concern (§8 of that doc — flagged there as a compliance flag, not a
resolved conclusion; this design treats "keep a frozen, provable export" as the safe
default regardless of how that flag ultimately resolves). Retained indefinitely, outside
the live Lantern workspace, immutable once written.

### 5.2 Day-one rollback

Re-export from Lantern back to a Wealthbox-importable format, split by what's actually
being rolled back:

- **Contact-field edits made only in Lantern** (anything beyond the one field that already
  round-trips): re-export as CSV matching Wealthbox's own bulk contact-import column
  schema. **UNVERIFIED** — need to confirm live whether that import tool's columns cover
  every field this connector syncs, or only a subset; this gates how complete a rollback of
  contact edits can actually be.
- **Lantern-native notes/tasks/events created after cutover:** replay them back through the
  same authenticated `POST` calls the write path already has half-built (§1.5, extended to
  events), reusing the exact `dedup_key` idempotency scheme so a rollback that's retried or
  partially redone can't double-post into Wealthbox.
- This is written down now as a **plan**, not implemented — building and testing the
  rollback path is build-wave/test-campaign work, but the plan must exist before cutover is
  ever offered to a real firm, per the deep-dive's own framing of cutover requiring "a
  defined day-one rollback," not a vague promise.

### 5.3 The Jump-coexistence problem (explicit, per charter instruction)

Jump writes into Wealthbox today through whatever integration it uses on the firm's side.
During Mirror and Parallel-run (deep-dive §7 phases 1–2), Lantern's sync is reading the same
Wealthbox API Jump writes into — so Jump's writes show up in Lantern automatically, for
free, with no special handling. **At cutover, that stops being true.** Once Wealthbox is no
longer the system of record (archived per §5.1, or simply no longer the place advisors and
Jump both write to), Jump's writes have nowhere authoritative to land. The firm has exactly
two options, and this design treats picking one as **mandatory, written into the pilot
agreement, not a thing discovered after the fact**:

1. **Drop Jump.** Whatever meeting-notes/follow-up automation Jump provided needs to
   already be replaced by a Lantern-native equivalent before cutover, or the firm loses
   that capability on day one.
2. **Keep Jump, lose its write target.** Jump keeps running against Wealthbox, but those
   writes now land in a system the firm has stopped treating as authoritative — meaning
   Jump's output either goes unread or the firm quietly keeps living in Wealthbox for
   Jump-touched work, undermining the whole point of cutting over.

**A concrete gap this design surfaces:** today's `CrmNote` model has no way to distinguish
a Jump-authored note from a human-authored one — notes are undifferentiated. There is no
automatic way to measure how dependent a firm currently is on Jump's writes before
cutover. The closest available mitigation, and a named item for the migration-readiness
checklist, is a **manual pre-cutover audit**: sample recent notes/tasks for Jump's
recognizable format or footer text and estimate reliance before asking the firm to commit
to option 1 or 2.

---

## 6. Test plan hooks for lane F

### 6.1 Fixture corpus

Two sources already exist and should be consolidated, not rebuilt from scratch:

- **`model.rs`'s inline test fixtures** (`CONTACTS_FIXTURE`, `NOTES_FIXTURE`,
  `TASKS_FIXTURE`, `EVENTS_FIXTURE`) — realistic, shaped against documented (and in one
  case live-quirk-corrected: the `background_info` alias) Wealthbox responses, including
  null-field edge cases (`household_with_null_fields_and_top_level_name_parses_correctly`)
  and the id-collision guard case in `engine/mod.rs`
  (`ingest_skips_and_counts_unlinked_objects`).
- **The Northcrest demo dataset** (`~/lantern-demo-data`, 80 households / 374 docs,
  referenced in project memory as the program's fabricated demo firm) — a much larger,
  more realistic corpus already built for other purposes, worth reusing as the volume test
  case for the importer's throughput/checkpointing work (§2.4).

**New fixture work needed:** every newly-added object type (§2.1) needs both clean and
edge-case fixtures — nulls, missing keys, colliding numeric ids across object types (the
existing Project/Contact-id-collision test is the template), and — critically — a
representative **open workflow instance with step state**, once §2.1's UNVERIFIED question
about whether that state is even readable gets answered live.

### 6.2 Synthetic Wealthbox API simulator

`client.rs` already supports a swappable base URL (`new_with_base`, built for tests) and
the existing test suite already runs a local mock HTTP server (`wiremock`) for `client.rs`'s
own unit tests (e.g. `post_json_sends_token_header_and_parses_response`). This is the seed
of a real simulator, not a green-field build:

- Build a small `wiremock`-backed fake Wealthbox server that serves the full fixture corpus
  (§6.1) across every endpoint in §2.1's coverage table, with configurable pagination,
  429/rate-limit behavior, and mid-page failure injection (for testing the checkpoint/resume
  logic from §2.4).
- Lane F's exit tests drive the whole importer + fidelity-report pipeline against this
  simulator with **zero live-Wealthbox dependency** — this is also the right shape for an
  ongoing CI regression gate, since the simulator's fixture corpus has known, fixed
  fetched/imported/skipped counts.

### 6.3 Fidelity report as an automated gate

Because the simulator's corpus has known counts, the fidelity report's own numbers become
an exact-match assertion, not a manual read: fetched N must equal imported N for every
"matters" category (§3.2) with zero unexplained skips — this turns the "100% on records
that matter" bar into something lane F can assert in CI on every change, not just check by
hand before a release.

---

## 7. Open questions / UNVERIFIED (dated 2026-07-11)

All of the following need a live Wealthbox API token against a real or sandbox workspace
to close out — none are blockers to freezing this design, but every one is an accepted
open risk that must be named at spec-freeze review, not discovered mid-build:

1. **Highest risk:** does `/v1/workflows` (or any endpoint) expose enough state to
   reconstruct an *open* workflow instance's current step/stage, or is `/v1/workflow_steps`
   truly write-only (complete/revert) with no way to read current position short of
   inference? This blocks faithful workflow-instance import and, downstream, the
   workflow-propagation design the charter already calls the hardest problem in the program.
2. Exact max `per_page` and exact `updated_since` timestamp format Wealthbox's API accepts
   — existing `TODO(live-probe)` markers in `client.rs`/`model.rs`.
3. Whether custom fields appear nested on notes/tasks/opportunities, or contacts only.
4. Whether Wealthbox exposes **any** native file/attachment storage + API at all, versus
   files living exclusively in a connected third-party integration (Box/OneDrive/
   SharePoint) — no attachments endpoint found in public docs or search.
5. Whether Wealthbox's contact CSV bulk-import format (needed for rollback, §5.2) covers
   every field this connector syncs, or only a subset.
6. Whether `/v1/activity`'s cursor shape is compatible with the existing (currently unused)
   `crm_cursors` table's single-string-per-object-type schema, or needs a richer cursor
   value (e.g. a page token).
7. Whether notes/tasks/events/opportunities/projects/workflows expose *any* deleted-item
   filter (contacts do, via `?deleted=true`) — today's diff-based tombstoning (§1.3, §2.3)
   is the only mechanism for every other object type, and it only works on a full resync.
8. Real-world 429/rate-limit behavior across many concurrently-relevant object-type
   endpoints during a full historical pull for a firm of meaningful size — untested at
   scale; today's single shared rate-gate mutex is the only mitigation in place.
9. Whether OAuth 2.0 (which the public docs describe as the primary auth path) differs
   from the raw `ACCESS_TOKEN` header this fork implements in available scopes or rate
   limits for the new endpoints — this fork has only ever implemented the token-header
   flow.

---

**Summary for spec-freeze review:** the read side is a solid, well-tested four-object
foundation (contacts/notes/tasks/events) with real pagination, rate-limiting, and PII
discipline already proven in production code — but it covers roughly half of what a
faithful Wealthbox migration needs, and the write side covers two object types plus one
field. The single highest-leverage unknown is whether open workflow instances are even
readable via the API; that answer should be sought before the build wave commits deeply to
the workflow-propagation design in lane C/D.
