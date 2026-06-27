//! Backfill sync engine — ingest, plan, and apply CRM data to the RAG index.
//!
//! The pipeline is split into three layers so the valuable logic stays
//! testable without a network or embedding model:
//!
//!  1. [`ingest`]              — fetch from source, upsert into `CrmStore`  (network-gated)
//!  2. [`plan_household_index`]— load from store, render text                (PURE / offline)
//!  3. [`apply_index`]         — embed text, write chunks to LanceDB          (model-gated)
//!
//! [`backfill`] composes all three into a single top-level entry point.
//!
//! # Grouping key
//! Every contact (and by extension every note/task/event linked to a contact)
//! is placed under a *grouping key*:
//! - For contacts whose `type == "household"`: the household's own id.
//! - For member persons/orgs/trusts with a nested household ref: that ref's id.
//! - For unhouseholded contacts: the contact's own id (they are their own group).
//!
//! Notes, tasks, and events inherit every distinct grouping key from their
//! contact links. Objects with no resolvable link are skipped and counted in
//! [`IngestReport::skipped_unlinked`].

use std::collections::{HashMap, HashSet};
use std::path::Path;

use sha2::{Digest, Sha256};

use crate::commands::crm::model::{
    crm_key_belongs_to_provider, CrmContact, CrmEvent, CrmLink, CrmNote, CrmRecordProvider, CrmTask,
};
use crate::commands::crm::render::{
    render_contact, render_event, render_household_summary, render_note, render_task,
};
use crate::commands::crm::source::CrmSource;
use crate::commands::crm::store::CrmStore;

// ---------------------------------------------------------------------------
// Public output types
// ---------------------------------------------------------------------------

/// Counts from a single [`ingest`] run.
#[derive(Debug, Default, Clone)]
pub struct IngestReport {
    /// Total contacts stored (all types: household + person + org + trust).
    pub contacts: u32,
    /// Total notes stored.
    pub notes: u32,
    /// Total tasks stored.
    pub tasks: u32,
    /// Total events stored.
    pub events: u32,
    /// Notes/tasks/events whose `linked_to` list had no entry that resolved to
    /// a known contact id.  They were not stored and are counted here so the
    /// caller can surface data gaps to the user.
    pub skipped_unlinked: u32,
    /// Objects that were stored on a previous sync but are absent from this API
    /// response (removed in Wealthbox), and were soft-deleted (tombstoned) so they
    /// stop being re-planned/re-indexed.
    pub removed_tombstoned: u32,
}

/// One item to be written to the RAG index.
#[derive(Debug, Clone)]
pub struct CrmIndexItem {
    /// `crm:<kind>:<id>` — passed directly to `index_crm_text_internal`.
    pub source_id: String,
    /// Human-readable plain text ready for chunking and embedding.
    pub text: String,
    /// The matter this item belongs to (supplied by the caller from the
    /// frontend's household→matter mapping).
    pub matter_id: String,
}

/// Summary of a complete [`backfill`] run.
#[derive(Debug, Default)]
pub struct SyncReport {
    /// Number of households processed through the full index pipeline.
    pub households_processed: u32,
    /// Total RAG chunks written across all households.
    pub records_indexed: u32,
    /// Counts from the preceding ingest phase.
    pub ingest: IngestReport,
    /// True when the run stopped early because the cancel flag was set. The
    /// households processed before the stop are still fully indexed.
    pub cancelled: bool,
}

// ---------------------------------------------------------------------------
// 1. content_hash
// ---------------------------------------------------------------------------

/// SHA-256 hex digest of `json`.
///
/// Used to detect whether an object has changed since the last sync, so
/// unchanged objects are not re-embedded (saves model calls on re-sync).
pub fn content_hash(json: &str) -> String {
    let hash = Sha256::digest(json.as_bytes());
    hex::encode(hash)
}

pub(crate) fn provider_scoped_matter_map(
    matter_map: &HashMap<String, String>,
    provider_id: &str,
) -> HashMap<String, String> {
    matter_map
        .iter()
        .filter(|(grouping_key, _)| crm_key_belongs_to_provider(grouping_key, provider_id))
        .map(|(grouping_key, matter_id)| (grouping_key.clone(), matter_id.clone()))
        .collect()
}

// ---------------------------------------------------------------------------
// 2. ingest
// ---------------------------------------------------------------------------

/// Fetch all objects from `source`, upsert them into `store`, and return a
/// count summary.
///
/// Contacts are grouped by household id (see module-level doc for the grouping
/// key rules).  Notes/tasks/events inherit every distinct grouping key from
/// their fetched contact links. Unresolvable objects are skipped and tallied in
/// [`IngestReport::skipped_unlinked`].
#[allow(dead_code)]
pub async fn ingest(source: &dyn CrmSource, store: &CrmStore) -> anyhow::Result<IngestReport> {
    let mut report = IngestReport::default();
    let provider_id = source.provider_id();

    // Every store id we FILED this sync: contacts always; a note/task/event only when
    // its link resolves to a household. The deletion diff at the end tombstones any
    // previously-stored object that is NOT filed now — i.e. removed from Wealthbox OR
    // newly unlinkable — so neither can leave a stale chunk behind on re-sync.
    let mut seen: HashSet<String> = HashSet::new();

    // ── 1. Contacts ──────────────────────────────────────────────────────────
    let contacts = source.list_all_contacts().await?;

    // Build contact_id → grouping_key lookup used by note/task/event resolution.
    let mut contact_to_group: HashMap<String, String> = HashMap::with_capacity(contacts.len());
    for c in &contacts {
        let gk = c.household_key().unwrap_or_else(|| c.crm_key());
        contact_to_group.insert(c.crm_key(), gk);
    }

    for c in &contacts {
        let c_key = c.crm_key();
        let gk = contact_to_group[&c_key].clone();
        let store_id = format!("contact:{}", c_key);
        seen.insert(store_id.clone());
        let json = serde_json::to_string(c)?;
        let hash = content_hash(&json);
        // Store the kind canonicalised to lowercase. The live Wealthbox API returns
        // CAPITALISED contact types ("Household"/"Person"/"Organization"/"Trust") while
        // the whole index pipeline matches on lowercase — without this every contact
        // falls through `plan_household_index`'s `_ => skip` arm and NOTHING is embedded.
        // CrmContact has no updated_at field; use "" (content_hash drives change detection).
        store.upsert_object(
            &store_id,
            &c.r#type.to_ascii_lowercase(),
            &gk,
            "",
            &hash,
            &json,
        )?;
        report.contacts += 1;
    }

    // ── 2. Notes ─────────────────────────────────────────────────────────────
    let notes = source.list_notes().await?;
    for n in &notes {
        let grouping_keys = resolve_grouping_keys(&n.linked_to, &contact_to_group);
        if grouping_keys.is_empty() {
            // TODO(1B.3c): surface unlinked objects to an operator log
            report.skipped_unlinked += 1;
        } else {
            let grouping_count = grouping_keys.len();
            let crm_key = n.crm_key();
            let json = serde_json::to_string(n)?;
            let hash = content_hash(&json);
            for gk in grouping_keys {
                let store_id = linked_object_store_id("note", &crm_key, &gk, grouping_count);
                seen.insert(store_id.clone());
                store.upsert_object(&store_id, "note", &gk, &n.updated_at, &hash, &json)?;
                report.notes += 1;
            }
        }
    }

    // ── 3. Tasks ─────────────────────────────────────────────────────────────
    let tasks = source.list_tasks().await?;
    for t in &tasks {
        let grouping_keys = resolve_grouping_keys(&t.linked_to, &contact_to_group);
        if grouping_keys.is_empty() {
            report.skipped_unlinked += 1;
        } else {
            let grouping_count = grouping_keys.len();
            let crm_key = t.crm_key();
            let json = serde_json::to_string(t)?;
            let hash = content_hash(&json);
            for gk in grouping_keys {
                let store_id = linked_object_store_id("task", &crm_key, &gk, grouping_count);
                seen.insert(store_id.clone());
                // CrmTask has no updated_at; use "" (content_hash drives change detection).
                store.upsert_object(&store_id, "task", &gk, "", &hash, &json)?;
                report.tasks += 1;
            }
        }
    }

    // ── 4. Events ────────────────────────────────────────────────────────────
    let events = source.list_events().await?;
    for e in &events {
        let grouping_keys = resolve_grouping_keys(&e.linked_to, &contact_to_group);
        if grouping_keys.is_empty() {
            report.skipped_unlinked += 1;
        } else {
            let grouping_count = grouping_keys.len();
            let crm_key = e.crm_key();
            let json = serde_json::to_string(e)?;
            let hash = content_hash(&json);
            for gk in grouping_keys {
                let store_id = linked_object_store_id("event", &crm_key, &gk, grouping_count);
                seen.insert(store_id.clone());
                // CrmEvent has no updated_at; use "" (content_hash drives change detection).
                store.upsert_object(&store_id, "event", &gk, "", &hash, &json)?;
                report.events += 1;
            }
        }
    }

    // ── 5. Tombstone objects that are no longer filed ────────────────────────
    // `seen` holds everything we filed this sync. Anything still stored (deleted = 0)
    // from a previous sync but NOT in `seen` is either gone from Wealthbox OR newly
    // unlinkable (its contact link was removed) — both must stop surfacing. Soft-delete
    // it so `plan_household_index` (which filters deleted = 0) stops re-planning it and
    // its stale RAG chunk drops on the household's next delete-then-insert.
    // `upsert_object` resets deleted = 0, so an object that re-appears (or is re-linked)
    // un-tombstones itself automatically.
    for existing in store.list_all_object_ids()? {
        if object_belongs_to_provider(&existing, provider_id) && !seen.contains(&existing) {
            store.tombstone_object(&existing)?;
            report.removed_tombstoned += 1;
        }
    }

    Ok(report)
}

fn object_belongs_to_provider(store_id: &str, provider_id: &str) -> bool {
    let Some((_, rest)) = store_id.split_once(':') else {
        return provider_id == "wealthbox";
    };
    match provider_id {
        "salesforce" => rest.starts_with("sfdc:"),
        "redtail" => rest.starts_with("redtail:"),
        "wealthbox" => !rest.starts_with("sfdc:") && !rest.starts_with("redtail:"),
        _ => false,
    }
}

/// Walk `linked_to`, returning every distinct grouping key from **contact-typed**
/// entries whose ids map to known contacts.
///
/// The `r#type` check is mandatory for correctness: a note/task/event can
/// also be linked to a project or opportunity, and if a project's numeric id
/// happens to collide with a contact's id the record would be silently
/// mis-filed into the wrong household — a confidentiality bug.  Only entries
/// with `r#type == "Contact"` (case-insensitive) are eligible for lookup.
fn resolve_grouping_keys(
    linked_to: &[CrmLink],
    contact_to_group: &HashMap<String, String>,
) -> Vec<String> {
    let mut grouping_keys = Vec::new();
    let mut seen = HashSet::new();
    for link in linked_to {
        // Guard: only contact-typed links may resolve a household grouping key.
        // Non-contact links (Project, Opportunity, …) are ignored even when
        // their numeric id happens to match a known contact id.
        if link.r#type.eq_ignore_ascii_case("contact") {
            if let Some(gk) = contact_to_group.get(&link.crm_key()) {
                if seen.insert(gk.clone()) {
                    grouping_keys.push(gk.clone());
                }
            }
        }
    }
    grouping_keys
}

fn linked_object_store_id(
    kind: &str,
    crm_key: &str,
    grouping_key: &str,
    grouping_count: usize,
) -> String {
    if grouping_count <= 1 {
        format!("{kind}:{crm_key}")
    } else {
        format!("{kind}:{crm_key}@{grouping_key}")
    }
}

// ---------------------------------------------------------------------------
// 3. plan_household_index  (PURE — no network, no embedding model)
// ---------------------------------------------------------------------------

/// Build the list of RAG index items for one household from the store.
///
/// This function is **pure**: it reads the store, deserialises stored JSON,
/// calls the render functions, and returns a list of [`CrmIndexItem`]s — no
/// network calls, no embedding model.  It is the offline-testable core of the
/// sync pipeline.
///
/// **Household-type contact present** (typical case): emits one household
/// summary record (`crm:household:<id>`) followed by one per-contact record
/// for each member (`crm:contact:<id>`).
///
/// **No household-type contact** (individual client): emits per-contact
/// records only.  A synthetic household summary is not generated because a
/// single-person group has no additional household-level context beyond the
/// contact record itself, and duplicating the data would confuse the RAG
/// retriever.
///
/// Notes, tasks, and events are rendered individually regardless.
#[allow(dead_code)]
pub fn plan_household_index(
    store: &CrmStore,
    grouping_key: &str,
    matter_id: &str,
) -> anyhow::Result<Vec<CrmIndexItem>> {
    let rows = store.list_objects_by_household(grouping_key)?;
    let mut items: Vec<CrmIndexItem> = Vec::new();

    // Partition rows by kind.
    let mut hh_contact: Option<CrmContact> = None;
    let mut member_contacts: Vec<CrmContact> = Vec::new();
    let mut notes: Vec<CrmNote> = Vec::new();
    let mut tasks: Vec<CrmTask> = Vec::new();
    let mut events: Vec<CrmEvent> = Vec::new();

    for row in &rows {
        // Match on a lowercased kind. `ingest` already normalises on store, but
        // normalise here too so any row stored before that fix (capitalised live
        // value) still indexes instead of being skipped.
        match row.kind.to_ascii_lowercase().as_str() {
            "household" => {
                let mut contact: CrmContact = serde_json::from_str(&row.json)?;
                apply_contact_provider(&mut contact, provider_for_store_id(&row.id));
                hh_contact = Some(contact);
            }
            "person" | "organization" | "trust" => {
                let mut contact: CrmContact = serde_json::from_str(&row.json)?;
                apply_contact_provider(&mut contact, provider_for_store_id(&row.id));
                member_contacts.push(contact);
            }
            "note" => {
                let mut note: CrmNote = serde_json::from_str(&row.json)?;
                apply_linked_object_provider(
                    &mut note.source_provider,
                    &mut note.linked_to,
                    &row.id,
                );
                notes.push(note);
            }
            "task" => {
                let mut task: CrmTask = serde_json::from_str(&row.json)?;
                apply_linked_object_provider(
                    &mut task.source_provider,
                    &mut task.linked_to,
                    &row.id,
                );
                tasks.push(task);
            }
            "event" => {
                let mut event: CrmEvent = serde_json::from_str(&row.json)?;
                apply_linked_object_provider(
                    &mut event.source_provider,
                    &mut event.linked_to,
                    &row.id,
                );
                events.push(event);
            }
            other => {
                log::warn!(
                    "plan_household_index: unknown kind '{}' for id '{}'; skipping",
                    other,
                    row.id
                );
            }
        }
    }

    // ── Household summary (when a household-type contact exists) ─────────────
    if let Some(ref hh) = hh_contact {
        let (source_id, text) = render_household_summary(hh, &member_contacts);
        items.push(CrmIndexItem {
            source_id,
            text,
            matter_id: matter_id.to_string(),
        });
    }
    // No household-type contact = individual client; per-contact records below
    // are sufficient and clearer than a synthetic one-person summary.

    // ── Per-contact records (non-household contacts only) ────────────────────
    for contact in &member_contacts {
        let (source_id, text) = render_contact(contact);
        items.push(CrmIndexItem {
            source_id,
            text,
            matter_id: matter_id.to_string(),
        });
    }

    // ── Notes ────────────────────────────────────────────────────────────────
    for note in &notes {
        let (source_id, text) = render_note(note);
        items.push(CrmIndexItem {
            source_id,
            text,
            matter_id: matter_id.to_string(),
        });
    }

    // ── Tasks ─────────────────────────────────────────────────────────────────
    for task in &tasks {
        let (source_id, text) = render_task(task);
        items.push(CrmIndexItem {
            source_id,
            text,
            matter_id: matter_id.to_string(),
        });
    }

    // ── Events ───────────────────────────────────────────────────────────────
    for event in &events {
        let (source_id, text) = render_event(event);
        items.push(CrmIndexItem {
            source_id,
            text,
            matter_id: matter_id.to_string(),
        });
    }

    Ok(items)
}

fn provider_for_store_id(store_id: &str) -> CrmRecordProvider {
    let rest = store_id
        .split_once(':')
        .map(|(_, rest)| rest)
        .unwrap_or(store_id);
    if rest.starts_with("sfdc:") {
        CrmRecordProvider::Salesforce
    } else if rest.starts_with("redtail:") {
        CrmRecordProvider::Redtail
    } else {
        CrmRecordProvider::Wealthbox
    }
}

fn apply_contact_provider(contact: &mut CrmContact, provider: CrmRecordProvider) {
    contact.source_provider = provider;
    if let Some(household) = contact.household.as_mut() {
        household.source_provider = provider;
        for member in &mut household.members {
            member.source_provider = provider;
        }
    }
}

fn apply_linked_object_provider(
    source_provider: &mut CrmRecordProvider,
    linked_to: &mut [CrmLink],
    store_id: &str,
) {
    let provider = provider_for_store_id(store_id);
    *source_provider = provider;
    for link in linked_to {
        link.source_provider = provider;
    }
}

// ---------------------------------------------------------------------------
// 4. apply_index  (model-gated)
// ---------------------------------------------------------------------------

/// Embed and write a household's [`CrmIndexItem`]s to the RAG index, reusing an
/// already-open LanceDB table and master key.
///
/// This is the performance-critical hot path. Two earlier costs were removed:
///   1. It used to call `index_crm_text_internal` per item, which **opened the
///      LanceDB connection and scanned the table on every record**. The caller
///      ([`backfill`]) now opens the table once and passes it in.
///   2. It used to call `delete_path` **per item** to clear stale chunks — on a
///      ~40-household / ~200-item first sync that was ~200 sequential full-table
///      deletes (each a scan + commit + compaction, all no-ops on a first sync)
///      and never completed. Stale-chunk clearing now happens **per matter** in
///      [`backfill`] (one `delete_crm_for_matters`, only when the matter already has
///      chunks, after the cancel check — a delete-then-insert), NOT per item
///      and NOT one up-front bulk wipe. So this function is a pure insert: chunk →
///      embed (batched per matter) → one `table.add`.
///
/// Requires the embedding model to be loaded (model-gated).
#[allow(dead_code)]
pub async fn apply_index(
    table: &lancedb::Table,
    key: &[u8; 32],
    items: &[CrmIndexItem],
) -> anyhow::Result<u32> {
    use anyhow::Context;
    use std::collections::HashMap;

    if items.is_empty() {
        return Ok(0);
    }

    // Chunk every non-empty item, grouped by matter id. One household maps to one
    // matter, but we group defensively so `build_batch_crm` (which takes a single
    // matter id) always gets a uniform batch.
    let mut by_matter: HashMap<String, Vec<crate::commands::rag::chunker::Chunk>> = HashMap::new();
    for item in items {
        if item.text.trim().is_empty() {
            continue;
        }
        let chunks = crate::commands::rag::chunker::chunk_text(&item.source_id, &item.text);
        if chunks.is_empty() {
            continue;
        }
        by_matter
            .entry(item.matter_id.clone())
            .or_default()
            .extend(chunks);
    }
    if by_matter.is_empty() {
        return Ok(0);
    }

    // For each matter group: embed all its chunks in one batched model call and
    // write them in a single `table.add` (was one add per item).
    let mut total = 0u32;
    for (matter_id, chunks) in by_matter {
        let texts: Vec<String> = chunks.iter().map(|c| c.text.clone()).collect();
        let vectors = crate::commands::rag::embedder::embed_documents_batched(&texts, None)
            .await
            .context("embed crm chunks")?
            .unwrap_or_default();
        let rows: Vec<(crate::commands::rag::chunker::Chunk, Vec<f32>)> =
            chunks.into_iter().zip(vectors).collect();
        if rows.is_empty() {
            continue;
        }
        let batch = crate::commands::rag::store::build_batch_crm(
            &rows,
            key,
            &matter_id,
            crate::commands::rag::store::PRIVILEGE_NONE,
        )
        .context("build crm batch")?;
        let schema = batch.schema();
        use arrow_array::RecordBatchIterator;
        table
            .add(Box::new(RecordBatchIterator::new(vec![Ok(batch)], schema)))
            .execute()
            .await
            .context("add crm chunks to lancedb")?;
        total += rows.len() as u32;
    }
    Ok(total)
}

// ---------------------------------------------------------------------------
// 5. backfill  (top-level entry point)
// ---------------------------------------------------------------------------

/// Full backfill: ingest all objects from `source`, then index each MATTER in
/// `matter_map` (grouping all of its households together) into the RAG store —
/// one delete + one combined, batched insert per matter.
///
/// `matter_map` is the frontend's household→matter mapping. Usually one household
/// per matter, but a matter may own several; they are grouped so the matter's CRM
/// chunks are replaced as a unit — a delete-then-insert (not once per household,
/// which would wipe siblings). Only matters present in the map are indexed; ingest still stores
/// *all* contacts so the store is a complete snapshot. A matter that previously had
/// CRM chunks but is absent from the map (a re-linked household) has its orphaned
/// chunks purged. Unchanged matters (byte-identical plan) do zero RAG work.
///
/// `cancel` is polled between matters so a long sync can be stopped from the UI;
/// matters already processed stay indexed and `SyncReport::cancelled` is set.
///
/// `rag_key` is the RAG/vector-store master key, supplied by the caller. The
/// command layer reads it from the OS keychain (`get_or_create_master_key`); tests
/// pass a literal key so the real entry point can be driven without a keychain.
///
/// `progress` is updated with the running count of households processed as each matter
/// completes, so a watching `crm_sync_status` (and the progress emitter) sees steady
/// movement during the sync instead of a number that only jumps at the end.
#[allow(dead_code)]
pub async fn backfill(
    source: &dyn CrmSource,
    store: &CrmStore,
    workspace: &Path,
    matter_map: &HashMap<String, String>,
    cancel: &std::sync::atomic::AtomicBool,
    rag_key: &[u8; 32],
    progress: &std::sync::atomic::AtomicU32,
) -> anyhow::Result<SyncReport> {
    use std::sync::atomic::Ordering;

    let mut report = SyncReport::default();
    let provider_id = source.provider_id();
    let provider_matter_map = provider_scoped_matter_map(matter_map, provider_id);

    // Phase 1: ingest everything into the store.
    report.ingest = ingest(source, store).await?;

    // Open the RAG connection + table ONCE for the whole sync. Opening the table
    // scans LanceDB, so per-record opens were a dominant cost; one open per sync.
    // We open even when `matter_map` is EMPTY: a re-sync with no CRM links (Wealthbox
    // returned none, or all unlinked) must still purge previously-indexed CRM chunks
    // in the orphan pass below — never leave them searchable.
    let conn = crate::commands::rag::store::open_connection(workspace).await?;
    let table = crate::commands::rag::store::open_or_create_table(&conn).await?;

    // Which matters already have CRM chunks? ONE column-only scan up front. Used to
    // (a) skip the stale-chunk delete for a matter that has none yet — a first sync's
    // deletes are all no-ops, and skipping them removes their commit + compaction churn
    // (the perf cost), and (b) find orphaned matters to purge below.
    let indexed_matters =
        crate::commands::rag::store::list_crm_matters_for_provider(&table, provider_id, rag_key)
            .await?;

    // Group the household→matter map BY MATTER. A matter can own several households,
    // and the old per-household loop deleted the matter's CRM chunks once PER household
    // — each delete wiping the previous household's just-inserted rows (BUG-A: last
    // household wins). Indexing per matter (one delete + one combined batched insert)
    // both fixes that and cuts commits. BTreeMap → deterministic order.
    let mut by_matter: std::collections::BTreeMap<String, Vec<String>> =
        std::collections::BTreeMap::new();
    for (grouping_key, matter_id) in &provider_matter_map {
        by_matter
            .entry(matter_id.clone())
            .or_default()
            .push(grouping_key.clone());
    }
    let synced_matters: std::collections::HashSet<&String> = by_matter.keys().collect();

    let mut did_write = false;

    // Run the index phase in one fallible block so the post-sync `optimize` below runs
    // in a finally-style path even if a delete/embed/add errors — an error must not
    // leave the index bloated. The first error is propagated AFTER the optimize.
    let index_result: anyhow::Result<()> = async {
        // Orphan cleanup (BUG-B + empty-map): a matter that still has CRM chunks but is
        // no longer synced — INCLUDING the empty-map case, where EVERY indexed matter is
        // orphaned — must have its CRM purged (scoped to `source_type='crm'`, so file/mail
        // chunks survive), or its client data stays wrongly retrievable under the old
        // matter. One scoped delete per orphaned matter (none on the happy path).
        for orphan in indexed_matters
            .iter()
            .filter(|m| !synced_matters.contains(m))
        {
            if cancel.load(Ordering::SeqCst) {
                report.cancelled = true;
                return Ok(());
            }
            // Mark BEFORE the write: a delete that succeeds but errors elsewhere must
            // still trigger the final optimize, or a partial write bloats the index.
            did_write = true;
            crate::commands::rag::store::delete_crm_for_matters_for_provider(
                &table,
                std::slice::from_ref(orphan),
                provider_id,
                rag_key,
            )
            .await?;
        }

        // Phase 2: index each MATTER — plan all its households together, then (only if
        // its plan changed) delete its old CRM chunks and insert the combined, batched
        // fresh plan. This is a delete-then-insert, NOT a real transaction (LanceDB
        // gives none here): cancel is checked BEFORE the delete so a Stop leaves the
        // matter UNCHANGED, and a mid-write error is surfaced (optimize still runs).
        for (matter_id, households) in &by_matter {
            if cancel.load(Ordering::SeqCst) {
                report.cancelled = true;
                return Ok(());
            }

            // Plan every household under this matter, concatenated. Poll cancel inside
            // the loop so a large multi-household matter stays responsive to Stop.
            let mut items: Vec<CrmIndexItem> = Vec::new();
            for hk in households {
                if cancel.load(Ordering::SeqCst) {
                    report.cancelled = true;
                    return Ok(());
                }
                items.extend(plan_household_index(store, hk, matter_id)?);
            }
            report.households_processed += households.len() as u32;
            // Publish live progress as each matter is reached (steady movement for a
            // watching crm_sync_status / progress emitter).
            progress.store(report.households_processed, Ordering::SeqCst);

            // Combined render hash over the matter's whole plan (source_ids + texts).
            let plan_hash = {
                let mut h = Sha256::new();
                for item in &items {
                    h.update(item.source_id.as_bytes());
                    h.update(item.text.as_bytes());
                }
                hex::encode(h.finalize())
            };

            let already_indexed = indexed_matters.contains(matter_id.as_str());

            // Unchanged-skip: byte-identical plan + chunks already present → ZERO RAG
            // work. (Guarded on actual-chunk presence too, so a stale render row can
            // never cause an incorrect skip.)
            if already_indexed {
                if let Some((prev_hash, true)) = store.get_render_state(matter_id)? {
                    if prev_hash == plan_hash {
                        continue;
                    }
                }
            }

            // Cancel right before the expensive delete + embed, so a Stop on a large
            // matter leaves it UNCHANGED (nothing deleted, nothing inserted).
            if cancel.load(Ordering::SeqCst) {
                report.cancelled = true;
                return Ok(());
            }

            // Delete only when the matter actually has stale chunks (never on a first
            // sync — that no-op-delete churn is what we removed). Set `did_write` BEFORE
            // each LanceDB write so a partial write (delete ok then add fails, or add ok
            // then render-state write fails) still triggers the finally-style optimize.
            if already_indexed {
                did_write = true;
                crate::commands::rag::store::delete_crm_for_matters_for_provider(
                    &table,
                    std::slice::from_ref(matter_id),
                    provider_id,
                    rag_key,
                )
                .await?;
            }
            if !items.is_empty() {
                did_write = true;
                report.records_indexed += apply_index(&table, rag_key, &items).await?;
            }
            store.set_render_state(matter_id, &plan_hash, true)?;
        }

        Ok(())
    }
    .await;

    // Finally: ONE optimize at the end (deferred compaction — perf), regardless of
    // whether the index phase errored, so an error never leaves the index bloated.
    // Best-effort: a failure here never fails the sync.
    if did_write {
        if let Err(e) = crate::commands::rag::store::optimize_after_bulk_write(&table).await {
            log::warn!("crm post-sync optimize failed (non-fatal): {e:#}");
        }
    }

    // Propagate the first index-phase error (if any) AFTER the optimize ran.
    index_result?;

    Ok(report)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::crm::model::{
        CrmContact, CrmEvent, CrmHouseholdRef, CrmLink, CrmNote, CrmTask,
    };
    use crate::commands::crm::salesforce::{
        normalize_salesforce_records, SalesforceAccount, SalesforceAccountContactRelation,
        SalesforceContact,
    };
    use crate::commands::crm::store::CrmStore;
    use async_trait::async_trait;
    use tempfile::TempDir;

    // ── FakeCrmSource ─────────────────────────────────────────────────────────

    /// In-memory test double for `CrmSource`.  Returns the Anderson household
    /// fixture: one household contact, two member persons, one note linked to the
    /// head, one task and one event linked to the household.
    struct FakeCrmSource;

    fn fixture_household() -> CrmContact {
        CrmContact {
            id: 10001,
            r#type: "household".to_string(),
            company_name: "The Andersons".to_string(),
            contact_type: "Client".to_string(),
            status: "Active".to_string(),
            ..Default::default()
        }
    }

    fn fixture_head() -> CrmContact {
        CrmContact {
            id: 10002,
            r#type: "person".to_string(),
            first_name: "Robert".to_string(),
            last_name: "Anderson".to_string(),
            birth_date: Some("1965-04-12".to_string()),
            client_since: Some("2018-01-15".to_string()),
            marital_status: "Married".to_string(),
            contact_type: "Client".to_string(),
            status: "Active".to_string(),
            risk_tolerance: "Moderate".to_string(),
            investment_objective: "Growth".to_string(),
            assets: Some(serde_json::json!(4_200_000_i64)),
            liabilities: Some(serde_json::json!(850_000_i64)),
            household: Some(CrmHouseholdRef {
                id: 10001,
                external_id: String::new(),
                name: "The Andersons".to_string(),
                title: "Head".to_string(),
                members: vec![],
                ..Default::default()
            }),
            ..Default::default()
        }
    }

    fn fixture_spouse() -> CrmContact {
        CrmContact {
            id: 10003,
            r#type: "person".to_string(),
            first_name: "Linda".to_string(),
            last_name: "Anderson".to_string(),
            birth_date: Some("1968-09-20".to_string()),
            contact_type: "Client".to_string(),
            status: "Active".to_string(),
            household: Some(CrmHouseholdRef {
                id: 10001,
                external_id: String::new(),
                name: "The Andersons".to_string(),
                title: "Spouse".to_string(),
                members: vec![],
                ..Default::default()
            }),
            ..Default::default()
        }
    }

    fn fixture_note() -> CrmNote {
        CrmNote {
            id: 30001,
            external_id: String::new(),
            created_at: "2026-03-10 09:15 AM -0500".to_string(),
            updated_at: "2026-03-10 09:15 AM -0500".to_string(),
            content: "Reviewed Q1 portfolio allocations with Robert. Discussed rebalancing RSUs."
                .to_string(),
            // Linked to the head person — resolves via contact_to_group to household "10001".
            linked_to: vec![CrmLink {
                id: 10002,
                external_id: String::new(),
                r#type: "contact".to_string(),
                name: "Robert Anderson".to_string(),
                ..Default::default()
            }],
            ..Default::default()
        }
    }

    fn fixture_task() -> CrmTask {
        CrmTask {
            id: 40001,
            external_id: String::new(),
            name: "Consolidate inherited IRA".to_string(),
            due_date: Some("2026-12-31".to_string()),
            complete: false,
            priority: "High".to_string(),
            description: "Roll Linda's inherited IRA from her mother before year-end.".to_string(),
            // Linked directly to the household contact — grouping key is "10001".
            linked_to: vec![CrmLink {
                id: 10001,
                external_id: String::new(),
                r#type: "contact".to_string(),
                name: "The Andersons".to_string(),
                ..Default::default()
            }],
            ..Default::default()
        }
    }

    fn fixture_event() -> CrmEvent {
        CrmEvent {
            id: 50001,
            external_id: String::new(),
            title: "Annual Review — Andersons".to_string(),
            starts_at: "2026-07-15 10:00 AM -0600".to_string(),
            ends_at: "2026-07-15 11:00 AM -0600".to_string(),
            all_day: false,
            location: "Advisor Office".to_string(),
            description: "Comprehensive annual review including tax-loss harvest discussion."
                .to_string(),
            // Linked directly to the household contact.
            linked_to: vec![CrmLink {
                id: 10001,
                external_id: String::new(),
                r#type: "contact".to_string(),
                name: "The Andersons".to_string(),
                ..Default::default()
            }],
            ..Default::default()
        }
    }

    #[async_trait]
    impl CrmSource for FakeCrmSource {
        async fn list_all_contacts(&self) -> anyhow::Result<Vec<CrmContact>> {
            Ok(vec![fixture_household(), fixture_head(), fixture_spouse()])
        }
        async fn list_notes(&self) -> anyhow::Result<Vec<CrmNote>> {
            Ok(vec![fixture_note()])
        }
        async fn list_tasks(&self) -> anyhow::Result<Vec<CrmTask>> {
            Ok(vec![fixture_task()])
        }
        async fn list_events(&self) -> anyhow::Result<Vec<CrmEvent>> {
            Ok(vec![fixture_event()])
        }
    }

    struct EmptySalesforceSource;

    #[async_trait]
    impl CrmSource for EmptySalesforceSource {
        fn provider_id(&self) -> &'static str {
            "salesforce"
        }

        async fn list_all_contacts(&self) -> anyhow::Result<Vec<CrmContact>> {
            Ok(Vec::new())
        }
        async fn list_notes(&self) -> anyhow::Result<Vec<CrmNote>> {
            Ok(Vec::new())
        }
        async fn list_tasks(&self) -> anyhow::Result<Vec<CrmTask>> {
            Ok(Vec::new())
        }
        async fn list_events(&self) -> anyhow::Result<Vec<CrmEvent>> {
            Ok(Vec::new())
        }
    }

    fn crm_store() -> (TempDir, CrmStore) {
        let dir = TempDir::new().unwrap();
        let key = [0x33u8; 32];
        let s = CrmStore::open_with_key(dir.path(), &key).expect("crm store open");
        (dir, s)
    }

    #[test]
    fn object_provider_detection_keeps_legacy_wealthbox_unprefixed() {
        assert!(object_belongs_to_provider("contact:10002", "wealthbox"));
        assert!(object_belongs_to_provider(
            "contact:sfdc:003CC0000000002AAA",
            "salesforce"
        ));
        assert!(object_belongs_to_provider("contact:redtail:123", "redtail"));
        assert!(!object_belongs_to_provider(
            "contact:redtail:123",
            "wealthbox"
        ));
        assert!(!object_belongs_to_provider(
            "contact:sfdc:003CC0000000002AAA",
            "wealthbox"
        ));
    }

    #[test]
    fn backfill_scopes_matter_map_to_current_provider_keys() {
        let mixed_map: std::collections::HashMap<String, String> = [
            ("10001".to_string(), "matter-wealthbox".to_string()),
            (
                "sfdc:001HH0000000001AAA".to_string(),
                "matter-salesforce".to_string(),
            ),
            (
                "redtail:rt-household".to_string(),
                "matter-redtail".to_string(),
            ),
        ]
        .into_iter()
        .collect();

        let salesforce_map = provider_scoped_matter_map(&mixed_map, "salesforce");
        assert_eq!(salesforce_map.len(), 1);
        assert_eq!(
            salesforce_map
                .get("sfdc:001HH0000000001AAA")
                .map(String::as_str),
            Some("matter-salesforce")
        );
        assert!(
            !salesforce_map.contains_key("10001"),
            "Salesforce sync must not plan legacy Wealthbox household keys"
        );
        assert!(
            !salesforce_map.contains_key("redtail:rt-household"),
            "Salesforce sync must not plan Redtail household keys"
        );

        let wealthbox_map = provider_scoped_matter_map(&mixed_map, "wealthbox");
        assert_eq!(wealthbox_map.len(), 1);
        assert_eq!(
            wealthbox_map.get("10001").map(String::as_str),
            Some("matter-wealthbox")
        );
    }

    // ── Test: ingest ──────────────────────────────────────────────────────────

    #[tokio::test]
    async fn ingest_stores_all_objects_under_correct_household() {
        let (_d, store) = crm_store();
        let source = FakeCrmSource;

        let report = ingest(&source, &store).await.expect("ingest");

        // Report counts: household + head + spouse = 3 contacts; 1 note, 1 task, 1 event.
        assert_eq!(
            report.contacts, 3,
            "expected 3 contacts (household + head + spouse)"
        );
        assert_eq!(report.notes, 1, "expected 1 note");
        assert_eq!(report.tasks, 1, "expected 1 task");
        assert_eq!(report.events, 1, "expected 1 event");
        assert_eq!(report.skipped_unlinked, 0, "all objects are linked");

        // All 6 objects land under grouping key "10001".
        let rows = store
            .list_objects_by_household("10001")
            .expect("list_objects_by_household");
        assert_eq!(rows.len(), 6, "3 contacts + 1 note + 1 task + 1 event = 6");

        // Household contact: kind="household", household_id="10001".
        let hh = store
            .get_object("contact:10001")
            .unwrap()
            .expect("household row missing");
        assert_eq!(hh.kind, "household");
        assert_eq!(hh.household_id, "10001");

        // Head person: also under "10001".
        let head = store
            .get_object("contact:10002")
            .unwrap()
            .expect("head row missing");
        assert_eq!(head.household_id, "10001");

        // Spouse person: also under "10001".
        let spouse = store
            .get_object("contact:10003")
            .unwrap()
            .expect("spouse row missing");
        assert_eq!(spouse.household_id, "10001");

        // Note linked to head (10002) → resolves to household grouping key "10001".
        let note = store
            .get_object("note:30001")
            .unwrap()
            .expect("note row missing");
        assert_eq!(note.kind, "note");
        assert_eq!(note.household_id, "10001");

        // Task linked to household (10001) → grouping key "10001".
        let task = store
            .get_object("task:40001")
            .unwrap()
            .expect("task row missing");
        assert_eq!(task.household_id, "10001");

        // Event linked to household (10001) → grouping key "10001".
        let event = store
            .get_object("event:50001")
            .unwrap()
            .expect("event row missing");
        assert_eq!(event.household_id, "10001");
    }

    struct SalesforceFixtureSource;

    #[async_trait]
    impl CrmSource for SalesforceFixtureSource {
        fn provider_id(&self) -> &'static str {
            "salesforce"
        }

        async fn list_all_contacts(&self) -> anyhow::Result<Vec<CrmContact>> {
            Ok(normalize_salesforce_records(
                vec![SalesforceAccount {
                    id: "001HH0000000001AAA".to_string(),
                    name: "Anderson Household".to_string(),
                    phone: String::new(),
                    billing_street: String::new(),
                    billing_city: "Denver".to_string(),
                    billing_state: "CO".to_string(),
                    billing_postal_code: String::new(),
                }],
                vec![SalesforceAccountContactRelation {
                    account_id: "001HH0000000001AAA".to_string(),
                    contact_id: "003CC0000000002AAA".to_string(),
                    roles: "Client;Head".to_string(),
                    active: true,
                    primary_group: true,
                    primary_member: true,
                    include_in_group: true,
                }],
                vec![SalesforceContact {
                    id: "003CC0000000002AAA".to_string(),
                    account_id: "001IND000000003AAA".to_string(),
                    first_name: "Robert".to_string(),
                    middle_name: String::new(),
                    last_name: "Anderson".to_string(),
                    salutation: String::new(),
                    suffix: String::new(),
                    email: "robert@example.com".to_string(),
                    phone: String::new(),
                    mobile_phone: String::new(),
                    home_phone: String::new(),
                    title: String::new(),
                    birthdate: None,
                    mailing_street: String::new(),
                    mailing_city: String::new(),
                    mailing_state: String::new(),
                    mailing_postal_code: String::new(),
                    description: "Salesforce note-like background text.".to_string(),
                    last_modified_date: "2026-06-27T00:00:00.000+0000".to_string(),
                }],
            ))
        }

        async fn list_notes(&self) -> anyhow::Result<Vec<CrmNote>> {
            Ok(Vec::new())
        }

        async fn list_tasks(&self) -> anyhow::Result<Vec<CrmTask>> {
            Ok(Vec::new())
        }

        async fn list_events(&self) -> anyhow::Result<Vec<CrmEvent>> {
            Ok(Vec::new())
        }
    }

    struct RedtailFixtureSource;

    #[async_trait]
    impl CrmSource for RedtailFixtureSource {
        fn provider_id(&self) -> &'static str {
            "redtail"
        }

        async fn list_all_contacts(&self) -> anyhow::Result<Vec<CrmContact>> {
            Ok(vec![
                CrmContact {
                    id: 7001,
                    external_id: "redtail:family:7".to_string(),
                    source_provider: CrmRecordProvider::Redtail,
                    r#type: "household".to_string(),
                    name: "The Anderson Family".to_string(),
                    company_name: "The Anderson Family".to_string(),
                    contact_type: "Family".to_string(),
                    ..Default::default()
                },
                CrmContact {
                    id: 7066,
                    external_id: "redtail:contact:66".to_string(),
                    source_provider: CrmRecordProvider::Redtail,
                    r#type: "person".to_string(),
                    first_name: "Robert".to_string(),
                    last_name: "Anderson".to_string(),
                    household: Some(CrmHouseholdRef {
                        id: 7001,
                        external_id: "redtail:family:7".to_string(),
                        source_provider: CrmRecordProvider::Redtail,
                        name: "The Anderson Family".to_string(),
                        title: "Head of household".to_string(),
                        members: Vec::new(),
                    }),
                    ..Default::default()
                },
            ])
        }

        async fn list_notes(&self) -> anyhow::Result<Vec<CrmNote>> {
            Ok(vec![CrmNote {
                id: 9002,
                external_id: "redtail:note:2".to_string(),
                source_provider: CrmRecordProvider::Redtail,
                created_at: "2026-06-01T12:00:00Z".to_string(),
                updated_at: "2026-06-01T12:00:00Z".to_string(),
                content: "Reviewed Q1 allocations with Robert.".to_string(),
                linked_to: vec![CrmLink {
                    id: 7066,
                    external_id: "redtail:contact:66".to_string(),
                    source_provider: CrmRecordProvider::Redtail,
                    r#type: "contact".to_string(),
                    name: "Robert Anderson".to_string(),
                }],
            }])
        }

        async fn list_tasks(&self) -> anyhow::Result<Vec<CrmTask>> {
            Ok(Vec::new())
        }

        async fn list_events(&self) -> anyhow::Result<Vec<CrmEvent>> {
            Ok(vec![CrmEvent {
                id: 9010,
                external_id: "redtail:activity:10".to_string(),
                source_provider: CrmRecordProvider::Redtail,
                title: "Annual Review".to_string(),
                starts_at: "2026-07-15T10:00:00Z".to_string(),
                description: "Tax-loss harvest discussion.".to_string(),
                linked_to: vec![CrmLink {
                    id: 7066,
                    external_id: "redtail:contact:66".to_string(),
                    source_provider: CrmRecordProvider::Redtail,
                    r#type: "contact".to_string(),
                    name: "Robert Anderson".to_string(),
                }],
                ..Default::default()
            }])
        }
    }

    struct RedtailSharedLinkedObjectSource;

    #[async_trait]
    impl CrmSource for RedtailSharedLinkedObjectSource {
        fn provider_id(&self) -> &'static str {
            "redtail"
        }

        async fn list_all_contacts(&self) -> anyhow::Result<Vec<CrmContact>> {
            Ok(vec![
                CrmContact {
                    id: 7001,
                    external_id: "redtail:family:7".to_string(),
                    source_provider: CrmRecordProvider::Redtail,
                    r#type: "household".to_string(),
                    name: "The Anderson Family".to_string(),
                    company_name: "The Anderson Family".to_string(),
                    contact_type: "Family".to_string(),
                    ..Default::default()
                },
                CrmContact {
                    id: 7066,
                    external_id: "redtail:contact:66".to_string(),
                    source_provider: CrmRecordProvider::Redtail,
                    r#type: "person".to_string(),
                    first_name: "Robert".to_string(),
                    last_name: "Anderson".to_string(),
                    household: Some(CrmHouseholdRef {
                        id: 7001,
                        external_id: "redtail:family:7".to_string(),
                        source_provider: CrmRecordProvider::Redtail,
                        name: "The Anderson Family".to_string(),
                        title: "Head of household".to_string(),
                        members: Vec::new(),
                    }),
                    ..Default::default()
                },
                CrmContact {
                    id: 8001,
                    external_id: "redtail:family:8".to_string(),
                    source_provider: CrmRecordProvider::Redtail,
                    r#type: "household".to_string(),
                    name: "The Bennett Family".to_string(),
                    company_name: "The Bennett Family".to_string(),
                    contact_type: "Family".to_string(),
                    ..Default::default()
                },
                CrmContact {
                    id: 8077,
                    external_id: "redtail:contact:77".to_string(),
                    source_provider: CrmRecordProvider::Redtail,
                    r#type: "person".to_string(),
                    first_name: "Marisol".to_string(),
                    last_name: "Bennett".to_string(),
                    household: Some(CrmHouseholdRef {
                        id: 8001,
                        external_id: "redtail:family:8".to_string(),
                        source_provider: CrmRecordProvider::Redtail,
                        name: "The Bennett Family".to_string(),
                        title: "Head of household".to_string(),
                        members: Vec::new(),
                    }),
                    ..Default::default()
                },
            ])
        }

        async fn list_notes(&self) -> anyhow::Result<Vec<CrmNote>> {
            Ok(vec![CrmNote {
                id: 9002,
                external_id: "redtail:note:2".to_string(),
                source_provider: CrmRecordProvider::Redtail,
                created_at: "2026-06-01T12:00:00Z".to_string(),
                updated_at: "2026-06-01T12:00:00Z".to_string(),
                content: "Shared planning note for two families.".to_string(),
                linked_to: vec![
                    CrmLink {
                        id: 7066,
                        external_id: "redtail:contact:66".to_string(),
                        source_provider: CrmRecordProvider::Redtail,
                        r#type: "contact".to_string(),
                        name: "Robert Anderson".to_string(),
                    },
                    CrmLink {
                        id: 8077,
                        external_id: "redtail:contact:77".to_string(),
                        source_provider: CrmRecordProvider::Redtail,
                        r#type: "contact".to_string(),
                        name: "Marisol Bennett".to_string(),
                    },
                ],
            }])
        }

        async fn list_tasks(&self) -> anyhow::Result<Vec<CrmTask>> {
            Ok(Vec::new())
        }

        async fn list_events(&self) -> anyhow::Result<Vec<CrmEvent>> {
            Ok(vec![CrmEvent {
                id: 9010,
                external_id: "redtail:activity:10".to_string(),
                source_provider: CrmRecordProvider::Redtail,
                title: "Shared review".to_string(),
                starts_at: "2026-07-15T10:00:00Z".to_string(),
                description: "Shared annual review for two families.".to_string(),
                linked_to: vec![
                    CrmLink {
                        id: 7066,
                        external_id: "redtail:contact:66".to_string(),
                        source_provider: CrmRecordProvider::Redtail,
                        r#type: "contact".to_string(),
                        name: "Robert Anderson".to_string(),
                    },
                    CrmLink {
                        id: 8077,
                        external_id: "redtail:contact:77".to_string(),
                        source_provider: CrmRecordProvider::Redtail,
                        r#type: "contact".to_string(),
                        name: "Marisol Bennett".to_string(),
                    },
                ],
                ..Default::default()
            }])
        }
    }

    #[tokio::test]
    async fn salesforce_records_group_by_namespaced_household_key_and_plan_per_matter_chunks() {
        let (_d, store) = crm_store();
        let source = SalesforceFixtureSource;

        let report = ingest(&source, &store).await.expect("ingest salesforce");

        assert_eq!(report.contacts, 2, "household account + one contact");
        let rows = store
            .list_objects_by_household("sfdc:001HH0000000001AAA")
            .expect("list salesforce household objects");
        assert_eq!(rows.len(), 2);
        assert!(
            rows.iter()
                .any(|r| r.id == "contact:sfdc:001HH0000000001AAA"),
            "household row should use provider-namespaced source id"
        );
        assert!(
            rows.iter()
                .any(|r| r.id == "contact:sfdc:003CC0000000002AAA:acct:001HH0000000001AAA"),
            "contact row should include Salesforce namespace and household account id"
        );

        let items = plan_household_index(&store, "sfdc:001HH0000000001AAA", "matter-anderson")
            .expect("plan salesforce household");
        assert!(items.iter().all(|i| i.matter_id == "matter-anderson"));
        assert!(items
            .iter()
            .any(|i| i.source_id == "crm:household:sfdc:001HH0000000001AAA"));
        assert!(items.iter().any(|i| {
            i.source_id == "crm:contact:sfdc:003CC0000000002AAA:acct:001HH0000000001AAA"
                && i.text.contains("Robert Anderson")
        }));
    }

    #[tokio::test]
    async fn salesforce_ingest_does_not_tombstone_existing_wealthbox_rows() {
        let (_d, store) = crm_store();

        ingest(&FakeCrmSource, &store)
            .await
            .expect("ingest wealthbox");
        assert!(
            store
                .get_object("contact:10001")
                .expect("get wealthbox household")
                .expect("wealthbox household exists")
                .deleted
                == false
        );

        ingest(&SalesforceFixtureSource, &store)
            .await
            .expect("ingest salesforce");

        let wealthbox_household = store
            .get_object("contact:10001")
            .expect("get wealthbox household after salesforce")
            .expect("wealthbox household still exists");
        assert!(
            !wealthbox_household.deleted,
            "a Salesforce snapshot must not tombstone Wealthbox rows"
        );
        let salesforce_household = store
            .get_object("contact:sfdc:001HH0000000001AAA")
            .expect("get salesforce household")
            .expect("salesforce household exists");
        assert!(!salesforce_household.deleted);
    }

    #[tokio::test]
    async fn redtail_records_group_by_namespaced_family_key_and_plan_per_matter_chunks() {
        let (_d, store) = crm_store();

        let report = ingest(&RedtailFixtureSource, &store)
            .await
            .expect("ingest redtail");

        assert_eq!(report.contacts, 2, "family household + one contact");
        assert_eq!(report.notes, 1);
        assert_eq!(report.events, 1);
        let rows = store
            .list_objects_by_household("redtail:family:7")
            .expect("list redtail household objects");
        assert_eq!(rows.len(), 4);
        assert!(
            rows.iter().any(|r| r.id == "contact:redtail:family:7"),
            "family row should use Redtail namespace"
        );
        assert!(
            rows.iter().any(|r| r.id == "note:redtail:note:2"),
            "note row should use Redtail namespace"
        );

        let items = plan_household_index(&store, "redtail:family:7", "matter-anderson")
            .expect("plan redtail household");
        assert!(items.iter().all(|i| i.matter_id == "matter-anderson"));
        assert!(items
            .iter()
            .any(|i| i.source_id == "crm:household:redtail:family:7"));
        assert!(items.iter().any(|i| {
            i.source_id == "crm:note:redtail:note:2" && i.text.contains("Reviewed Q1 allocations")
        }));
        assert!(items
            .iter()
            .any(|i| i.source_id == "crm:event:redtail:activity:10"));
    }

    #[tokio::test]
    async fn redtail_shared_notes_and_activities_file_under_all_linked_families() {
        let (_d, store) = crm_store();

        let report = ingest(&RedtailSharedLinkedObjectSource, &store)
            .await
            .expect("ingest redtail shared records");

        assert_eq!(report.contacts, 4, "two families + two contacts");
        assert_eq!(
            report.notes, 2,
            "one shared Redtail note is filed under both linked families"
        );
        assert_eq!(
            report.events, 2,
            "one shared Redtail activity is filed under both linked families"
        );

        let family_7_rows = store
            .list_objects_by_household("redtail:family:7")
            .expect("list family 7 rows");
        let family_8_rows = store
            .list_objects_by_household("redtail:family:8")
            .expect("list family 8 rows");

        assert!(
            family_7_rows
                .iter()
                .any(|r| r.id == "note:redtail:note:2@redtail:family:7"),
            "shared note must be stored under family 7"
        );
        assert!(
            family_8_rows
                .iter()
                .any(|r| r.id == "note:redtail:note:2@redtail:family:8"),
            "shared note must be stored under family 8"
        );
        assert!(
            family_7_rows
                .iter()
                .any(|r| r.id == "event:redtail:activity:10@redtail:family:7"),
            "shared activity must be stored under family 7"
        );
        assert!(
            family_8_rows
                .iter()
                .any(|r| r.id == "event:redtail:activity:10@redtail:family:8"),
            "shared activity must be stored under family 8"
        );

        let family_7_items = plan_household_index(&store, "redtail:family:7", "matter-anderson")
            .expect("plan family 7");
        let family_8_items = plan_household_index(&store, "redtail:family:8", "matter-bennett")
            .expect("plan family 8");

        assert!(
            family_7_items.iter().any(|i| {
                i.matter_id == "matter-anderson"
                    && i.source_id == "crm:note:redtail:note:2"
                    && i.text.contains("Shared planning note")
            }),
            "family 7 matter must index the shared note"
        );
        assert!(
            family_8_items.iter().any(|i| {
                i.matter_id == "matter-bennett"
                    && i.source_id == "crm:note:redtail:note:2"
                    && i.text.contains("Shared planning note")
            }),
            "family 8 matter must index the shared note"
        );
        assert!(
            family_7_items.iter().any(|i| {
                i.matter_id == "matter-anderson"
                    && i.source_id == "crm:event:redtail:activity:10"
                    && i.text.contains("Shared annual review")
            }),
            "family 7 matter must index the shared activity"
        );
        assert!(
            family_8_items.iter().any(|i| {
                i.matter_id == "matter-bennett"
                    && i.source_id == "crm:event:redtail:activity:10"
                    && i.text.contains("Shared annual review")
            }),
            "family 8 matter must index the shared activity"
        );
    }

    #[tokio::test]
    async fn redtail_ingest_does_not_tombstone_wealthbox_or_salesforce_rows() {
        let (_d, store) = crm_store();

        ingest(&FakeCrmSource, &store)
            .await
            .expect("ingest wealthbox");
        ingest(&SalesforceFixtureSource, &store)
            .await
            .expect("ingest salesforce");
        ingest(&RedtailFixtureSource, &store)
            .await
            .expect("ingest redtail");

        let wealthbox_household = store
            .get_object("contact:10001")
            .expect("get wealthbox household after redtail")
            .expect("wealthbox household still exists");
        assert!(
            !wealthbox_household.deleted,
            "a Redtail snapshot must not tombstone Wealthbox rows"
        );
        let salesforce_household = store
            .get_object("contact:sfdc:001HH0000000001AAA")
            .expect("get salesforce household after redtail")
            .expect("salesforce household still exists");
        assert!(
            !salesforce_household.deleted,
            "a Redtail snapshot must not tombstone Salesforce rows"
        );
    }

    // ── Test: plan_household_index ────────────────────────────────────────────

    #[tokio::test]
    async fn plan_household_index_returns_all_expected_items() {
        let (_d, store) = crm_store();
        ingest(&FakeCrmSource, &store).await.expect("ingest");

        let items =
            plan_household_index(&store, "10001", "matter-x").expect("plan_household_index");

        let source_ids: Vec<&str> = items.iter().map(|i| i.source_id.as_str()).collect();

        // Household summary is present.
        assert!(
            source_ids.contains(&"crm:household:10001"),
            "expected household summary; got: {:?}",
            source_ids
        );
        // Both member contact records are present.
        assert!(
            source_ids.contains(&"crm:contact:10002"),
            "expected head contact record; got: {:?}",
            source_ids
        );
        assert!(
            source_ids.contains(&"crm:contact:10003"),
            "expected spouse contact record; got: {:?}",
            source_ids
        );
        // Note record is present.
        assert!(
            source_ids.contains(&"crm:note:30001"),
            "expected note record; got: {:?}",
            source_ids
        );

        // Every item carries the correct matter_id.
        for item in &items {
            assert_eq!(
                item.matter_id, "matter-x",
                "all items should have matter_id 'matter-x'; found '{}' on {}",
                item.matter_id, item.source_id
            );
        }

        // Household summary text contains both member names and the "(self-reported)" label.
        let hh_item = items
            .iter()
            .find(|i| i.source_id == "crm:household:10001")
            .expect("household summary item not found");

        assert!(
            hh_item.text.contains("Robert Anderson"),
            "household summary should mention Robert Anderson; text:\n{}",
            hh_item.text
        );
        assert!(
            hh_item.text.contains("Linda Anderson"),
            "household summary should mention Linda Anderson; text:\n{}",
            hh_item.text
        );
        assert!(
            hh_item.text.contains("(self-reported)"),
            "household summary should label financials '(self-reported)'; text:\n{}",
            hh_item.text
        );
    }

    // ── Test: live CAPITALIZED contact kinds still index (Blocker B regression) ─

    /// The live Wealthbox API returns CAPITALISED contact types ("Household",
    /// "Person", …) while the index pipeline matches lowercase. Before the
    /// normalisation fix this made `plan_household_index` skip every contact
    /// ("unknown kind") so nothing was searchable. This source mirrors the live
    /// capitalisation; the fixtures elsewhere use lowercase, which is exactly why
    /// the bug slipped through — same class as the deserialize blocker.
    struct CapitalizedKindSource;

    #[async_trait]
    impl CrmSource for CapitalizedKindSource {
        async fn list_all_contacts(&self) -> anyhow::Result<Vec<CrmContact>> {
            Ok(vec![
                CrmContact {
                    id: 20001,
                    r#type: "Household".to_string(), // live capitalisation
                    company_name: "The Bishops".to_string(),
                    contact_type: "Client".to_string(),
                    status: "Active".to_string(),
                    ..Default::default()
                },
                CrmContact {
                    id: 20002,
                    r#type: "Person".to_string(), // live capitalisation
                    first_name: "Grace".to_string(),
                    last_name: "Bishop".to_string(),
                    contact_type: "Client".to_string(),
                    status: "Active".to_string(),
                    household: Some(CrmHouseholdRef {
                        id: 20001,
                        external_id: String::new(),
                        name: "The Bishops".to_string(),
                        title: "Head".to_string(),
                        members: vec![],
                        ..Default::default()
                    }),
                    ..Default::default()
                },
                CrmContact {
                    id: 20003,
                    r#type: "Organization".to_string(), // live capitalisation
                    company_name: "Bishop Holdings LLC".to_string(),
                    contact_type: "Client".to_string(),
                    status: "Active".to_string(),
                    household: Some(CrmHouseholdRef {
                        id: 20001,
                        external_id: String::new(),
                        name: "The Bishops".to_string(),
                        title: "Entity".to_string(),
                        members: vec![],
                        ..Default::default()
                    }),
                    ..Default::default()
                },
                CrmContact {
                    id: 20004,
                    r#type: "Trust".to_string(), // live capitalisation
                    company_name: "Bishop Family Trust".to_string(),
                    contact_type: "Client".to_string(),
                    status: "Active".to_string(),
                    household: Some(CrmHouseholdRef {
                        id: 20001,
                        external_id: String::new(),
                        name: "The Bishops".to_string(),
                        title: "Entity".to_string(),
                        members: vec![],
                        ..Default::default()
                    }),
                    ..Default::default()
                },
            ])
        }
        async fn list_notes(&self) -> anyhow::Result<Vec<CrmNote>> {
            Ok(vec![])
        }
        async fn list_tasks(&self) -> anyhow::Result<Vec<CrmTask>> {
            Ok(vec![])
        }
        async fn list_events(&self) -> anyhow::Result<Vec<CrmEvent>> {
            Ok(vec![])
        }
    }

    #[tokio::test]
    async fn capitalized_live_kinds_are_normalized_and_indexed() {
        let (_d, store) = crm_store();
        ingest(&CapitalizedKindSource, &store)
            .await
            .expect("ingest");

        // Stored kinds are canonicalised to lowercase on ingest — for ALL FOUR
        // live contact types (Household / Person / Organization / Trust).
        let hh = store
            .get_object("contact:20001")
            .unwrap()
            .expect("household row");
        assert_eq!(hh.kind, "household", "kind must be lowercased on store");
        let person = store
            .get_object("contact:20002")
            .unwrap()
            .expect("person row");
        assert_eq!(person.kind, "person", "kind must be lowercased on store");
        let org = store
            .get_object("contact:20003")
            .unwrap()
            .expect("organization row");
        assert_eq!(org.kind, "organization", "kind must be lowercased on store");
        let trust = store
            .get_object("contact:20004")
            .unwrap()
            .expect("trust row");
        assert_eq!(trust.kind, "trust", "kind must be lowercased on store");

        // plan_household_index produces the household summary + a record for EVERY
        // member type — NOT skipped as "unknown kind". This is the connector value.
        let items = plan_household_index(&store, "20001", "matter-bishop").expect("plan");
        let source_ids: Vec<&str> = items.iter().map(|i| i.source_id.as_str()).collect();
        assert!(
            source_ids.contains(&"crm:household:20001"),
            "expected household summary from a live 'Household' contact; got {:?}",
            source_ids
        );
        for sid in [
            "crm:contact:20002",
            "crm:contact:20003",
            "crm:contact:20004",
        ] {
            assert!(
                source_ids.contains(&sid),
                "expected member record {sid} (Person/Organization/Trust); got {:?}",
                source_ids
            );
        }
    }

    /// Defense-in-depth: a row stored with a CAPITALISED kind (e.g. by an older
    /// build, before on-store normalisation) must still index because
    /// `plan_household_index` lowercases when matching.
    #[tokio::test]
    async fn plan_household_index_matches_kind_case_insensitively() {
        let (_d, store) = crm_store();
        let json = serde_json::to_string(&CrmContact {
            id: 21000,
            r#type: "Person".to_string(),
            first_name: "Owen".to_string(),
            last_name: "Reed".to_string(),
            ..Default::default()
        })
        .unwrap();
        // Bypass ingest's normalisation to simulate already-stored legacy data.
        store
            .upsert_object("contact:21000", "Person", "21000", "", "h", &json)
            .unwrap();

        let items = plan_household_index(&store, "21000", "matter-reed").expect("plan");
        assert!(
            items.iter().any(|i| i.source_id == "crm:contact:21000"),
            "a stored capitalised 'Person' kind must still index, not be skipped"
        );
    }

    // ── Test: removed objects are tombstoned and drop from the plan ────────────

    /// A source returning the Bishops WITHOUT the trust member (20004) — simulates
    /// that contact being removed in Wealthbox on a later sync.
    struct BishopsMinusTrust;

    #[async_trait]
    impl CrmSource for BishopsMinusTrust {
        async fn list_all_contacts(&self) -> anyhow::Result<Vec<CrmContact>> {
            Ok(vec![
                CrmContact {
                    id: 20001,
                    r#type: "Household".to_string(),
                    company_name: "The Bishops".to_string(),
                    contact_type: "Client".to_string(),
                    status: "Active".to_string(),
                    ..Default::default()
                },
                CrmContact {
                    id: 20002,
                    r#type: "Person".to_string(),
                    first_name: "Grace".to_string(),
                    last_name: "Bishop".to_string(),
                    contact_type: "Client".to_string(),
                    status: "Active".to_string(),
                    household: Some(CrmHouseholdRef {
                        id: 20001,
                        external_id: String::new(),
                        name: "The Bishops".to_string(),
                        title: "Head".to_string(),
                        members: vec![],
                        ..Default::default()
                    }),
                    ..Default::default()
                },
                CrmContact {
                    id: 20003,
                    r#type: "Organization".to_string(),
                    company_name: "Bishop Holdings LLC".to_string(),
                    contact_type: "Client".to_string(),
                    status: "Active".to_string(),
                    household: Some(CrmHouseholdRef {
                        id: 20001,
                        external_id: String::new(),
                        name: "The Bishops".to_string(),
                        title: "Entity".to_string(),
                        members: vec![],
                        ..Default::default()
                    }),
                    ..Default::default()
                },
                // 20004 (Trust) removed upstream.
            ])
        }
        async fn list_notes(&self) -> anyhow::Result<Vec<CrmNote>> {
            Ok(vec![])
        }
        async fn list_tasks(&self) -> anyhow::Result<Vec<CrmTask>> {
            Ok(vec![])
        }
        async fn list_events(&self) -> anyhow::Result<Vec<CrmEvent>> {
            Ok(vec![])
        }
    }

    #[tokio::test]
    async fn removed_objects_are_tombstoned_and_drop_from_the_plan() {
        let (_d, store) = crm_store();

        // First sync: household + person(20002) + org(20003) + trust(20004).
        let r1 = ingest(&CapitalizedKindSource, &store)
            .await
            .expect("ingest 1");
        assert_eq!(
            r1.removed_tombstoned, 0,
            "nothing is removed on a first sync"
        );
        let before = plan_household_index(&store, "20001", "m").expect("plan 1");
        assert!(
            before.iter().any(|i| i.source_id == "crm:contact:20004"),
            "the trust member is present before it is removed upstream"
        );

        // Second sync: the same household but the TRUST (20004) is gone from Wealthbox.
        let r2 = ingest(&BishopsMinusTrust, &store).await.expect("ingest 2");
        assert_eq!(
            r2.removed_tombstoned, 1,
            "the removed trust is tombstoned exactly once"
        );
        let after = plan_household_index(&store, "20001", "m").expect("plan 2");
        assert!(
            !after.iter().any(|i| i.source_id == "crm:contact:20004"),
            "a removed object must drop from the plan after tombstoning"
        );
        assert!(
            after.iter().any(|i| i.source_id == "crm:contact:20002"),
            "a surviving member is still planned"
        );

        // Re-appearance self-heals: the trust returns, upsert resets deleted=0.
        let r3 = ingest(&CapitalizedKindSource, &store)
            .await
            .expect("ingest 3");
        assert_eq!(
            r3.removed_tombstoned, 0,
            "nothing removed when the trust returns"
        );
        let again = plan_household_index(&store, "20001", "m").expect("plan 3");
        assert!(
            again.iter().any(|i| i.source_id == "crm:contact:20004"),
            "a re-appearing object un-tombstones itself and is planned again"
        );
    }

    // ── Test: a previously-filed object that becomes UNLINKED is tombstoned ────

    /// The Anderson household + head, with the note linked to the head (filed).
    struct LinkedNoteSource;
    #[async_trait]
    impl CrmSource for LinkedNoteSource {
        async fn list_all_contacts(&self) -> anyhow::Result<Vec<CrmContact>> {
            Ok(vec![fixture_household(), fixture_head()])
        }
        async fn list_notes(&self) -> anyhow::Result<Vec<CrmNote>> {
            Ok(vec![fixture_note()])
        }
        async fn list_tasks(&self) -> anyhow::Result<Vec<CrmTask>> {
            Ok(vec![])
        }
        async fn list_events(&self) -> anyhow::Result<Vec<CrmEvent>> {
            Ok(vec![])
        }
    }

    /// Same household + head, but the SAME note is now UNLINKED (empty `linked_to`)
    /// — its contact link was removed upstream, so it can no longer be filed.
    struct UnlinkedNoteSource;
    #[async_trait]
    impl CrmSource for UnlinkedNoteSource {
        async fn list_all_contacts(&self) -> anyhow::Result<Vec<CrmContact>> {
            Ok(vec![fixture_household(), fixture_head()])
        }
        async fn list_notes(&self) -> anyhow::Result<Vec<CrmNote>> {
            let mut n = fixture_note();
            n.linked_to = vec![]; // unlinked now — cannot resolve a household
            Ok(vec![n])
        }
        async fn list_tasks(&self) -> anyhow::Result<Vec<CrmTask>> {
            Ok(vec![])
        }
        async fn list_events(&self) -> anyhow::Result<Vec<CrmEvent>> {
            Ok(vec![])
        }
    }

    #[tokio::test]
    async fn became_unlinked_object_is_tombstoned_and_dropped_from_plan() {
        let (_d, store) = crm_store();

        // First sync: the note is linked to the head and filed under the household.
        ingest(&LinkedNoteSource, &store)
            .await
            .expect("ingest linked");
        let before = plan_household_index(&store, "10001", "m").expect("plan 1");
        assert!(
            before.iter().any(|i| i.source_id == "crm:note:30001"),
            "the linked note is planned on the first sync"
        );

        // Re-sync: the note is now UNLINKED upstream — skipped, not re-filed.
        let r2 = ingest(&UnlinkedNoteSource, &store)
            .await
            .expect("ingest unlinked");
        assert_eq!(
            r2.skipped_unlinked, 1,
            "the now-unlinkable note is counted as skipped"
        );
        assert_eq!(
            r2.removed_tombstoned, 1,
            "a previously-filed object that becomes unlinkable is tombstoned, not left stale"
        );
        let after = plan_household_index(&store, "10001", "m").expect("plan 2");
        assert!(
            !after.iter().any(|i| i.source_id == "crm:note:30001"),
            "a became-unlinked note must drop from the plan so its stale chunk is cleared"
        );
    }

    // ── Test: unlinked objects are skipped and counted ────────────────────────

    /// A source that returns one normal note (linked) and one orphan note
    /// (empty linked_to).  The orphan should not be stored and should increment
    /// `skipped_unlinked`.
    struct FakeWithUnlinkedNote;

    #[async_trait]
    impl CrmSource for FakeWithUnlinkedNote {
        async fn list_all_contacts(&self) -> anyhow::Result<Vec<CrmContact>> {
            Ok(vec![fixture_household(), fixture_head()])
        }
        async fn list_notes(&self) -> anyhow::Result<Vec<CrmNote>> {
            let orphan = CrmNote {
                id: 99999,
                external_id: String::new(),
                created_at: "2026-01-01".to_string(),
                updated_at: "2026-01-01".to_string(),
                content: "Orphan note — no linked contact".to_string(),
                linked_to: vec![], // empty → cannot resolve a grouping key
                ..Default::default()
            };
            Ok(vec![fixture_note(), orphan])
        }
        async fn list_tasks(&self) -> anyhow::Result<Vec<CrmTask>> {
            Ok(vec![])
        }
        async fn list_events(&self) -> anyhow::Result<Vec<CrmEvent>> {
            Ok(vec![])
        }
    }

    #[tokio::test]
    async fn ingest_skips_and_counts_unlinked_objects() {
        let (_d, store) = crm_store();
        let source = FakeWithUnlinkedNote;

        let report = ingest(&source, &store).await.expect("ingest");

        // The linked note is counted.
        assert_eq!(report.notes, 1, "only the linked note should be stored");
        // The orphan note is counted as skipped.
        assert_eq!(
            report.skipped_unlinked, 1,
            "the unlinked note should increment skipped_unlinked"
        );

        // The orphan note must not be present in the store.
        let row = store.get_object("note:99999").unwrap();
        assert!(
            row.is_none(),
            "unlinked note must not be written to the store"
        );
    }

    // ── Test: non-contact linked_to with colliding id is NOT filed ───────────
    //
    // A note whose only linked_to entry carries r#type="Project" (or any
    // non-contact type) with an id that numerically matches a known contact id
    // must NOT be filed under that contact's household.  It must be counted in
    // skipped_unlinked instead.  This is Fix 2 (P1 correctness/privacy).

    struct FakeWithProjectLinkedNote;

    #[async_trait]
    impl CrmSource for FakeWithProjectLinkedNote {
        async fn list_all_contacts(&self) -> anyhow::Result<Vec<CrmContact>> {
            // Contact id 10001 (the household) is registered in contact_to_group.
            Ok(vec![fixture_household()])
        }
        async fn list_notes(&self) -> anyhow::Result<Vec<CrmNote>> {
            let note = CrmNote {
                id: 77777,
                external_id: String::new(),
                created_at: "2026-01-01".to_string(),
                updated_at: "2026-01-01".to_string(),
                content: "Note linked to a project, NOT a contact".to_string(),
                linked_to: vec![CrmLink {
                    // Same numeric id as the household contact — must NOT match
                    // because the link type is "Project", not "Contact".
                    id: 10001,
                    external_id: String::new(),
                    r#type: "Project".to_string(),
                    name: "Some Pipeline Project".to_string(),
                    ..Default::default()
                }],
                ..Default::default()
            };
            Ok(vec![note])
        }
        async fn list_tasks(&self) -> anyhow::Result<Vec<CrmTask>> {
            Ok(vec![])
        }
        async fn list_events(&self) -> anyhow::Result<Vec<CrmEvent>> {
            Ok(vec![])
        }
    }

    #[tokio::test]
    async fn non_contact_linked_to_with_colliding_id_is_skipped() {
        let (_d, store) = crm_store();
        let source = FakeWithProjectLinkedNote;

        let report = ingest(&source, &store).await.expect("ingest");

        // The note must be skipped, not stored.
        assert_eq!(
            report.skipped_unlinked, 1,
            "note linked via 'Project' type (not 'Contact') must be counted as skipped_unlinked"
        );
        assert_eq!(report.notes, 0, "no notes should be stored");

        // The note must not appear in the store under any household.
        let row = store.get_object("note:77777").unwrap();
        assert!(
            row.is_none(),
            "project-linked note with colliding id must not be written to the store"
        );

        // The household contact itself is still ingested normally.
        assert_eq!(report.contacts, 1);
        let hh_row = store.get_object("contact:10001").unwrap();
        assert!(hh_row.is_some(), "household contact should still be stored");
    }

    // ── Model-gated headless integration test ────────────────────────────────
    //
    // Drives the REAL `backfill` end-to-end — ingest → plan → apply_index (the
    // delete-then-insert path that hung) → embed → store → retrieve — without the OS
    // keychain. The real app reads the RAG key from the keychain at runtime; here we
    // pass `backfill` a LITERAL key ([0x5Au8;32]) (the engine takes the key as a param
    // exactly so the real entry point is testable headless). The keychain path itself
    // is exercised on a real machine via the full user-test playbook. This is the
    // real-entry-point proof; the always-on gate covers the per-household delete shape
    // at 40-household scale via `rag::store`'s
    // `per_household_replace_completes_at_scale_no_orphans_or_dupes`.
    //
    // Requires the e5-small embedding model.  Self-skips when the model is absent
    // (normal CI behaviour).  Panics loudly when REQUIRE_RAG_MODEL=1 and the
    // model is missing so nightly runs surface the gap instead of silently passing.

    /// Returns true when the e5-small model cache is provisioned.
    fn model_is_provisioned() -> bool {
        use crate::commands::rag::embedder::resolve_cache_dir;
        use crate::commands::rag::model_download::model_files_cached;
        model_files_cached(&resolve_cache_dir())
    }

    /// Skip a model-dependent test when the e5-small cache is absent.
    macro_rules! skip_without_model {
        () => {
            if !model_is_provisioned() {
                if std::env::var("REQUIRE_RAG_MODEL")
                    .ok()
                    .filter(|v| !v.is_empty())
                    .is_some()
                {
                    panic!(
                        "REQUIRE_RAG_MODEL set but e5-small cache missing — \
                         refusing to silently skip RAG tests"
                    );
                }
                eprintln!(
                    "SKIP {}: e5-small model cache not provisioned \
                     (expected on CI; runs locally/nightly)",
                    module_path!()
                );
                return;
            }
        };
    }

    #[tokio::test]
    #[ignore]
    async fn backfill_full_integration_requires_embedding_model() {
        use crate::commands::mail::crypto::decrypt_with_key;
        use crate::commands::rag::embedder::embed_documents_batched;
        use crate::commands::rag::store;

        skip_without_model!();

        // Literal RAG encryption key — passed straight into `backfill` (which takes
        // the key as a param), so no OS keychain is needed on a headless server. The
        // real app reads this key from the keychain; that path is verified on a real
        // machine via the full user-test playbook.
        const VEC_KEY: [u8; 32] = [0x5Au8; 32];

        // ── Drive the REAL backfill (ingest → plan → apply_index → embed → store) ──
        let ws = TempDir::new().unwrap();
        let crm_key = [0x33u8; 32];
        let store = CrmStore::open_with_key(ws.path(), &crm_key).unwrap();

        let matter_map: std::collections::HashMap<String, String> =
            [("10001".to_string(), "matter-integration".to_string())]
                .into_iter()
                .collect();
        let cancel = std::sync::atomic::AtomicBool::new(false);
        let progress = std::sync::atomic::AtomicU32::new(0);
        let report = backfill(
            &FakeCrmSource,
            &store,
            ws.path(),
            &matter_map,
            &cancel,
            &VEC_KEY,
            &progress,
        )
        .await
        .expect("backfill");
        assert!(
            report.records_indexed > 0,
            "backfill must embed + store at least one CRM chunk for the Anderson household"
        );
        // P4 progress: the live counter reaches the final household count.
        assert_eq!(
            progress.load(std::sync::atomic::Ordering::SeqCst),
            report.households_processed,
            "the progress counter must reach the final households_processed"
        );

        // ── Open a fresh handle to the persisted store, then retrieve end-to-end ──
        let conn = store::open_connection(ws.path())
            .await
            .expect("open rag connection");
        let table = store::open_or_create_table(&conn)
            .await
            .expect("open or create rag table");

        // ── Retrieve — prove the chain end-to-end ────────────────────────────────
        let query_texts = vec!["Anderson household net worth assets".to_string()];
        let query_vecs = embed_documents_batched(&query_texts, None)
            .await
            .expect("embed query")
            .unwrap_or_default();
        assert!(
            !query_vecs.is_empty(),
            "embed must return at least one vector"
        );
        let qv = &query_vecs[0];

        let hits = store::nearest(&table, qv, 8, Some("matter-integration"), false, &[])
            .await
            .expect("nearest");
        assert!(!hits.is_empty(), "RAG search must return at least one hit");

        // Decrypt the path of the first hit and confirm it is a CRM source.
        let top = &hits[0];
        let path_enc = top
            .path_enc
            .as_deref()
            .expect("crm hit must carry path_enc");
        let blob = hex::decode(path_enc).expect("path_enc must be hex");
        let plain_path =
            String::from_utf8(decrypt_with_key(&blob, &VEC_KEY).expect("decrypt path_enc"))
                .expect("path_enc must be UTF-8");

        assert!(
            plain_path.starts_with("crm:household:10001")
                || plain_path.starts_with("crm:contact:")
                || plain_path.starts_with("crm:"),
            "retrieved source path must be a CRM path; got: {plain_path:?}"
        );
        assert_eq!(
            top.source_type.as_deref(),
            Some("crm"),
            "source_type must be 'crm'"
        );
        assert_eq!(
            top.matter_id.as_deref(),
            Some("matter-integration"),
            "matter_id must match the indexed matter"
        );
    }

    /// Two distinct households (Alpha 30001, Beta 30003) for the BUG-A test.
    struct TwoHouseholdsSource;
    #[async_trait]
    impl CrmSource for TwoHouseholdsSource {
        async fn list_all_contacts(&self) -> anyhow::Result<Vec<CrmContact>> {
            Ok(vec![
                CrmContact {
                    id: 30001,
                    r#type: "Household".to_string(),
                    company_name: "Alpha".to_string(),
                    contact_type: "Client".to_string(),
                    status: "Active".to_string(),
                    ..Default::default()
                },
                CrmContact {
                    id: 30002,
                    r#type: "Person".to_string(),
                    first_name: "Ann".to_string(),
                    last_name: "Alpha".to_string(),
                    contact_type: "Client".to_string(),
                    status: "Active".to_string(),
                    household: Some(CrmHouseholdRef {
                        id: 30001,
                        external_id: String::new(),
                        name: "Alpha".to_string(),
                        title: "Head".to_string(),
                        members: vec![],
                        ..Default::default()
                    }),
                    ..Default::default()
                },
                CrmContact {
                    id: 30003,
                    r#type: "Household".to_string(),
                    company_name: "Beta".to_string(),
                    contact_type: "Client".to_string(),
                    status: "Active".to_string(),
                    ..Default::default()
                },
                CrmContact {
                    id: 30004,
                    r#type: "Person".to_string(),
                    first_name: "Ben".to_string(),
                    last_name: "Beta".to_string(),
                    contact_type: "Client".to_string(),
                    status: "Active".to_string(),
                    household: Some(CrmHouseholdRef {
                        id: 30003,
                        external_id: String::new(),
                        name: "Beta".to_string(),
                        title: "Head".to_string(),
                        members: vec![],
                        ..Default::default()
                    }),
                    ..Default::default()
                },
            ])
        }
        async fn list_notes(&self) -> anyhow::Result<Vec<CrmNote>> {
            Ok(vec![])
        }
        async fn list_tasks(&self) -> anyhow::Result<Vec<CrmTask>> {
            Ok(vec![])
        }
        async fn list_events(&self) -> anyhow::Result<Vec<CrmEvent>> {
            Ok(vec![])
        }
    }

    /// BUG-A (model-gated): two distinct households mapped to the SAME matter must
    /// BOTH be indexed. The group-by-matter restructure plans them together and does
    /// one combined insert, so neither wipes the other (the old per-household loop
    /// deleted the matter's chunks between them, leaving only the last household).
    #[tokio::test]
    #[ignore]
    async fn backfill_two_households_one_matter_keeps_both() {
        use crate::commands::mail::crypto::decrypt_with_key;
        use crate::commands::rag::embedder::embed_documents_batched;
        use crate::commands::rag::store;
        skip_without_model!();

        const VEC_KEY: [u8; 32] = [0x5Au8; 32];
        let ws = TempDir::new().unwrap();
        let store_db = CrmStore::open_with_key(ws.path(), &[0x33u8; 32]).unwrap();
        let matter_map: std::collections::HashMap<String, String> = [
            ("30001".to_string(), "matter-shared".to_string()),
            ("30003".to_string(), "matter-shared".to_string()),
        ]
        .into_iter()
        .collect();
        let cancel = std::sync::atomic::AtomicBool::new(false);
        let progress = std::sync::atomic::AtomicU32::new(0);
        backfill(
            &TwoHouseholdsSource,
            &store_db,
            ws.path(),
            &matter_map,
            &cancel,
            &VEC_KEY,
            &progress,
        )
        .await
        .expect("backfill");

        let conn = store::open_connection(ws.path()).await.unwrap();
        let table = store::open_or_create_table(&conn).await.unwrap();
        let q = embed_documents_batched(&["household client".to_string()], None)
            .await
            .unwrap()
            .unwrap();
        let hits = store::nearest(&table, &q[0], 50, Some("matter-shared"), false, &[])
            .await
            .unwrap();
        let paths: Vec<String> = hits
            .iter()
            .filter_map(|h| {
                h.path_enc
                    .as_deref()
                    .and_then(|pe| hex::decode(pe).ok())
                    .and_then(|b| decrypt_with_key(&b, &VEC_KEY).ok())
                    .and_then(|v| String::from_utf8(v).ok())
            })
            .collect();
        assert!(
            paths
                .iter()
                .any(|p| p.contains(":30001") || p.contains(":30002")),
            "Alpha household must be indexed; got {paths:?}"
        );
        assert!(
            paths
                .iter()
                .any(|p| p.contains(":30003") || p.contains(":30004")),
            "Beta household must be indexed (NOT wiped by Alpha's sibling under the same matter); got {paths:?}"
        );
    }

    /// BUG-B (model-gated): a household re-linked from matter A to matter B leaves NO
    /// orphaned CRM chunks under A — only under B (the orphan cleanup purges A).
    #[tokio::test]
    #[ignore]
    async fn backfill_relink_household_no_orphan_under_old_matter() {
        use crate::commands::rag::embedder::embed_documents_batched;
        use crate::commands::rag::store;
        skip_without_model!();

        const VEC_KEY: [u8; 32] = [0x5Au8; 32];
        let ws = TempDir::new().unwrap();
        let store_db = CrmStore::open_with_key(ws.path(), &[0x33u8; 32]).unwrap();
        let cancel = std::sync::atomic::AtomicBool::new(false);
        let progress = std::sync::atomic::AtomicU32::new(0);

        // Sync 1: household 10001 under matter-A.
        let map_a: std::collections::HashMap<String, String> =
            [("10001".to_string(), "matter-A".to_string())]
                .into_iter()
                .collect();
        backfill(
            &FakeCrmSource,
            &store_db,
            ws.path(),
            &map_a,
            &cancel,
            &VEC_KEY,
            &progress,
        )
        .await
        .expect("sync A");

        // Sync 2: the SAME household re-linked to matter-B (A absent from the map).
        let map_b: std::collections::HashMap<String, String> =
            [("10001".to_string(), "matter-B".to_string())]
                .into_iter()
                .collect();
        backfill(
            &FakeCrmSource,
            &store_db,
            ws.path(),
            &map_b,
            &cancel,
            &VEC_KEY,
            &progress,
        )
        .await
        .expect("sync B");

        let conn = store::open_connection(ws.path()).await.unwrap();
        let table = store::open_or_create_table(&conn).await.unwrap();
        let q = embed_documents_batched(&["Anderson household".to_string()], None)
            .await
            .unwrap()
            .unwrap();

        let under_b = store::nearest(&table, &q[0], 50, Some("matter-B"), false, &[])
            .await
            .unwrap();
        assert!(
            !under_b.is_empty(),
            "household must be retrievable under the new matter-B"
        );

        let under_a = store::nearest(&table, &q[0], 50, Some("matter-A"), false, &[])
            .await
            .unwrap();
        let a_crm = under_a
            .iter()
            .filter(|h| h.source_type.as_deref() == Some("crm"))
            .count();
        assert_eq!(
            a_crm, 0,
            "a re-linked household must leave NO orphaned CRM chunks under the old matter-A"
        );
    }

    /// Provider-scoped orphan cleanup: an empty Salesforce sync must purge only
    /// Salesforce CRM chunks. The legacy unprefixed Wealthbox chunks in the same
    /// matter are a different provider and must survive.
    #[tokio::test]
    async fn backfill_salesforce_empty_map_purges_only_salesforce_crm_chunks() {
        use crate::commands::mail::crypto::decrypt_with_key;
        use crate::commands::rag::chunker::{chunk_text, Chunk};
        use crate::commands::rag::embedder::EMBEDDING_DIM;
        use crate::commands::rag::store::{self, PRIVILEGE_NONE};
        use arrow_array::RecordBatchIterator;

        const VEC_KEY: [u8; 32] = [0x5Au8; 32];
        let ws = TempDir::new().unwrap();
        let store_db = CrmStore::open_with_key(ws.path(), &[0x33u8; 32]).unwrap();
        let cancel = std::sync::atomic::AtomicBool::new(false);
        let progress = std::sync::atomic::AtomicU32::new(0);
        let matter = "matter-coexist";

        let conn = store::open_connection(ws.path()).await.unwrap();
        let table = store::open_or_create_table(&conn).await.unwrap();
        let source_ids = [
            "crm:household:10001",
            "crm:contact:10002",
            "crm:household:sfdc:001HH0000000001AAA",
            "crm:contact:sfdc:003CC0000000002AAA:acct:001HH0000000001AAA",
        ];
        let mut rows: Vec<(Chunk, Vec<f32>)> = Vec::new();
        for source_id in source_ids {
            for chunk in chunk_text(source_id, &format!("CRM fixture for {source_id}")) {
                rows.push((chunk, vec![0.10f32; EMBEDDING_DIM]));
            }
        }
        let batch = store::build_batch_crm(&rows, &VEC_KEY, matter, PRIVILEGE_NONE)
            .expect("build mixed-provider crm batch");
        let schema = batch.schema();
        table
            .add(Box::new(RecordBatchIterator::new(vec![Ok(batch)], schema)))
            .execute()
            .await
            .expect("add mixed-provider crm chunks");

        assert!(
            store::list_crm_matters_for_provider(&table, "salesforce", &VEC_KEY)
                .await
                .unwrap()
                .contains(matter),
            "Salesforce chunks must exist before the empty Salesforce sync"
        );
        assert!(
            store::list_crm_matters_for_provider(&table, "wealthbox", &VEC_KEY)
                .await
                .unwrap()
                .contains(matter),
            "Wealthbox chunks must exist before the empty Salesforce sync"
        );

        let empty: std::collections::HashMap<String, String> = std::collections::HashMap::new();
        backfill(
            &EmptySalesforceSource,
            &store_db,
            ws.path(),
            &empty,
            &cancel,
            &VEC_KEY,
            &progress,
        )
        .await
        .expect("empty Salesforce sync");

        let conn2 = store::open_connection(ws.path()).await.unwrap();
        let table2 = store::open_or_create_table(&conn2).await.unwrap();
        assert!(
            !store::list_crm_matters_for_provider(&table2, "salesforce", &VEC_KEY)
                .await
                .unwrap()
                .contains(matter),
            "empty Salesforce sync must purge Salesforce orphan chunks"
        );
        assert!(
            store::list_crm_matters_for_provider(&table2, "wealthbox", &VEC_KEY)
                .await
                .unwrap()
                .contains(matter),
            "empty Salesforce sync must not purge Wealthbox chunks"
        );

        let hits = store::nearest(
            &table2,
            &vec![0.10f32; EMBEDDING_DIM],
            20,
            Some(matter),
            false,
            &[],
        )
        .await
        .unwrap();
        let paths: Vec<String> = hits
            .iter()
            .map(|hit| {
                let enc = hit.path_enc.as_deref().expect("crm hit has path_enc");
                let blob = hex::decode(enc).expect("path_enc hex");
                String::from_utf8(decrypt_with_key(&blob, &VEC_KEY).expect("decrypt path_enc"))
                    .expect("utf8 path")
            })
            .collect();
        assert!(
            paths.iter().any(|p| p == "crm:household:10001"),
            "Wealthbox household chunk must survive; got {paths:?}"
        );
        assert!(
            paths.iter().any(|p| p == "crm:contact:10002"),
            "Wealthbox contact chunk must survive; got {paths:?}"
        );
        assert!(
            !paths.iter().any(|p| p.contains("sfdc:")),
            "Salesforce chunks must be gone; got {paths:?}"
        );
    }

    /// HIGH (empty-map orphan cleanup, model-gated): a re-sync with NO CRM links must
    /// still purge previously-indexed CRM chunks (Wealthbox returned none, or all are
    /// unlinked) — never leave them searchable — while preserving file/mail chunks. The
    /// early-return on an empty map (which skipped the orphan pass) was the bug.
    #[tokio::test]
    #[ignore]
    async fn backfill_empty_map_purges_crm_preserving_files() {
        use crate::commands::rag::chunker::Chunk;
        use crate::commands::rag::embedder::{embed_documents_batched, EMBEDDING_DIM};
        use crate::commands::rag::store::{self, SourceType, PRIVILEGE_NONE};
        use arrow_array::RecordBatchIterator;
        skip_without_model!();

        const VEC_KEY: [u8; 32] = [0x5Au8; 32];
        let ws = TempDir::new().unwrap();
        let store_db = CrmStore::open_with_key(ws.path(), &[0x33u8; 32]).unwrap();
        let cancel = std::sync::atomic::AtomicBool::new(false);
        let progress = std::sync::atomic::AtomicU32::new(0);

        // Sync household 10001 under matter-A (real backfill → CRM chunks exist).
        let map: std::collections::HashMap<String, String> =
            [("10001".to_string(), "matter-A".to_string())]
                .into_iter()
                .collect();
        backfill(
            &FakeCrmSource,
            &store_db,
            ws.path(),
            &map,
            &cancel,
            &VEC_KEY,
            &progress,
        )
        .await
        .expect("sync A");

        // Add a FILE chunk under matter-A (a merged household) to prove preservation.
        let conn = store::open_connection(ws.path()).await.unwrap();
        let table = store::open_or_create_table(&conn).await.unwrap();
        {
            let rows = vec![(
                Chunk {
                    path: "/clients/a.pdf".into(),
                    paragraph_index: 0,
                    text: "file body".into(),
                    start_offset: 0,
                    end_offset: 9,
                    locator: None,
                },
                vec![0.10f32; EMBEDDING_DIM],
            )];
            let batch = store::build_batch(
                &rows,
                SourceType::Text,
                "matter-A",
                PRIVILEGE_NONE,
                None,
                &VEC_KEY,
            )
            .expect("file batch");
            let schema = batch.schema();
            table
                .add(Box::new(RecordBatchIterator::new(vec![Ok(batch)], schema)))
                .execute()
                .await
                .expect("add file chunk");
        }
        assert!(
            store::list_crm_matters(&table)
                .await
                .unwrap()
                .contains("matter-A"),
            "CRM must exist under matter-A before the empty-map sync"
        );

        // Re-sync with an EMPTY map → must purge ALL CRM, preserve the file chunk.
        let empty: std::collections::HashMap<String, String> = std::collections::HashMap::new();
        backfill(
            &FakeCrmSource,
            &store_db,
            ws.path(),
            &empty,
            &cancel,
            &VEC_KEY,
            &progress,
        )
        .await
        .expect("empty-map sync");

        let conn2 = store::open_connection(ws.path()).await.unwrap();
        let table2 = store::open_or_create_table(&conn2).await.unwrap();
        assert!(
            store::list_crm_matters(&table2).await.unwrap().is_empty(),
            "an empty-map sync must purge ALL previously-indexed CRM (the early-return bug)"
        );
        // The file chunk survives — matter-A still has a retrievable (non-CRM) chunk.
        let q = embed_documents_batched(&["file body".to_string()], None)
            .await
            .unwrap()
            .unwrap();
        let hits = store::nearest(&table2, &q[0], 20, Some("matter-A"), false, &[])
            .await
            .unwrap();
        assert!(
            !hits.is_empty(),
            "the file chunk under matter-A must survive the empty-map CRM purge"
        );
    }
}
