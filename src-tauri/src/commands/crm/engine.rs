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
//! Notes, tasks, and events inherit the grouping key of the **first
//! `linked_to` entry** whose id resolves to a known contact.  Objects with no
//! resolvable link are skipped and counted in [`IngestReport::skipped_unlinked`].

use std::collections::HashMap;
use std::path::Path;

use sha2::{Digest, Sha256};

use crate::commands::crm::model::{WbContact, WbEvent, WbLink, WbNote, WbTask};
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

// ---------------------------------------------------------------------------
// 2. ingest
// ---------------------------------------------------------------------------

/// Fetch all objects from `source`, upsert them into `store`, and return a
/// count summary.
///
/// Contacts are grouped by household id (see module-level doc for the grouping
/// key rules).  Notes/tasks/events inherit the grouping key of the first
/// `linked_to` entry whose id matches a fetched contact.  Unresolvable objects
/// are skipped and tallied in [`IngestReport::skipped_unlinked`].
#[allow(dead_code)]
pub async fn ingest(source: &dyn CrmSource, store: &CrmStore) -> anyhow::Result<IngestReport> {
    let mut report = IngestReport::default();

    // ── 1. Contacts ──────────────────────────────────────────────────────────
    let contacts = source.list_all_contacts().await?;

    // Build contact_id → grouping_key lookup used by note/task/event resolution.
    let mut contact_to_group: HashMap<i64, String> = HashMap::with_capacity(contacts.len());
    for c in &contacts {
        let gk = c.household_id().unwrap_or(c.id).to_string();
        contact_to_group.insert(c.id, gk);
    }

    for c in &contacts {
        let gk = contact_to_group[&c.id].clone();
        let store_id = format!("contact:{}", c.id);
        let json = serde_json::to_string(c)?;
        let hash = content_hash(&json);
        // WbContact has no updated_at field; use "" (content_hash drives change detection).
        store.upsert_object(&store_id, &c.r#type, &gk, "", &hash, &json)?;
        report.contacts += 1;
    }

    // ── 2. Notes ─────────────────────────────────────────────────────────────
    let notes = source.list_notes().await?;
    for n in &notes {
        match resolve_grouping_key(&n.linked_to, &contact_to_group) {
            Some(gk) => {
                let store_id = format!("note:{}", n.id);
                let json = serde_json::to_string(n)?;
                let hash = content_hash(&json);
                store.upsert_object(&store_id, "note", &gk, &n.updated_at, &hash, &json)?;
                report.notes += 1;
            }
            None => {
                // TODO(1B.3c): surface unlinked objects to an operator log
                report.skipped_unlinked += 1;
            }
        }
    }

    // ── 3. Tasks ─────────────────────────────────────────────────────────────
    let tasks = source.list_tasks().await?;
    for t in &tasks {
        match resolve_grouping_key(&t.linked_to, &contact_to_group) {
            Some(gk) => {
                let store_id = format!("task:{}", t.id);
                let json = serde_json::to_string(t)?;
                let hash = content_hash(&json);
                // WbTask has no updated_at; use "" (content_hash drives change detection).
                store.upsert_object(&store_id, "task", &gk, "", &hash, &json)?;
                report.tasks += 1;
            }
            None => {
                report.skipped_unlinked += 1;
            }
        }
    }

    // ── 4. Events ────────────────────────────────────────────────────────────
    let events = source.list_events().await?;
    for e in &events {
        match resolve_grouping_key(&e.linked_to, &contact_to_group) {
            Some(gk) => {
                let store_id = format!("event:{}", e.id);
                let json = serde_json::to_string(e)?;
                let hash = content_hash(&json);
                // WbEvent has no updated_at; use "" (content_hash drives change detection).
                store.upsert_object(&store_id, "event", &gk, "", &hash, &json)?;
                report.events += 1;
            }
            None => {
                report.skipped_unlinked += 1;
            }
        }
    }

    Ok(report)
}

/// Walk `linked_to`, return the grouping key of the first **contact-typed**
/// entry whose id maps to a known contact.  Returns `None` if no such entry
/// resolves.
///
/// The `r#type` check is mandatory for correctness: a note/task/event can
/// also be linked to a project or opportunity, and if a project's numeric id
/// happens to collide with a contact's id the record would be silently
/// mis-filed into the wrong household — a confidentiality bug.  Only entries
/// with `r#type == "Contact"` (case-insensitive) are eligible for lookup.
fn resolve_grouping_key(
    linked_to: &[WbLink],
    contact_to_group: &HashMap<i64, String>,
) -> Option<String> {
    for link in linked_to {
        // Guard: only contact-typed links may resolve a household grouping key.
        // Non-contact links (Project, Opportunity, …) are ignored even when
        // their numeric id happens to match a known contact id.
        if link.r#type.eq_ignore_ascii_case("contact") {
            if let Some(gk) = contact_to_group.get(&link.id) {
                return Some(gk.clone());
            }
        }
    }
    None
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
    let mut hh_contact: Option<WbContact> = None;
    let mut member_contacts: Vec<WbContact> = Vec::new();
    let mut notes: Vec<WbNote> = Vec::new();
    let mut tasks: Vec<WbTask> = Vec::new();
    let mut events: Vec<WbEvent> = Vec::new();

    for row in &rows {
        match row.kind.as_str() {
            "household" => {
                hh_contact = Some(serde_json::from_str(&row.json)?);
            }
            "person" | "organization" | "trust" => {
                member_contacts.push(serde_json::from_str(&row.json)?);
            }
            "note" => {
                notes.push(serde_json::from_str(&row.json)?);
            }
            "task" => {
                tasks.push(serde_json::from_str(&row.json)?);
            }
            "event" => {
                events.push(serde_json::from_str(&row.json)?);
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

// ---------------------------------------------------------------------------
// 4. apply_index  (model-gated)
// ---------------------------------------------------------------------------

/// Embed and write each [`CrmIndexItem`] to the RAG index.
///
/// Calls `index_crm_text_internal` (which runs the embedding model) for every
/// item and sums the indexed chunk counts.  This is the only function in the
/// engine that requires the embedding model to be loaded.
#[allow(dead_code)]
pub async fn apply_index(workspace: &Path, items: &[CrmIndexItem]) -> anyhow::Result<u32> {
    let mut total = 0u32;
    for item in items {
        let n = crate::commands::crm::index_crm_text_internal(
            workspace,
            &item.source_id,
            &item.text,
            &item.matter_id,
        )
        .await?;
        total += n;
    }
    Ok(total)
}

// ---------------------------------------------------------------------------
// 5. backfill  (top-level entry point)
// ---------------------------------------------------------------------------

/// Full backfill: ingest all objects from `source`, then for each
/// `(grouping_key, matter_id)` in `matter_map`, plan the index items and
/// apply them to the RAG store.
///
/// `matter_map` is supplied by the frontend in Plan 1C once it creates one
/// Matter per household.  Only households present in the map are indexed —
/// ingest still stores *all* contacts so the store is a complete snapshot.
#[allow(dead_code)]
pub async fn backfill(
    source: &dyn CrmSource,
    store: &CrmStore,
    workspace: &Path,
    matter_map: &HashMap<String, String>,
) -> anyhow::Result<SyncReport> {
    let mut report = SyncReport::default();

    // Phase 1: ingest everything into the store.
    report.ingest = ingest(source, store).await?;

    // Phase 2: index each household that has a matter.
    for (grouping_key, matter_id) in matter_map {
        let items = plan_household_index(store, grouping_key, matter_id)?;
        let n = apply_index(workspace, &items).await?;
        report.records_indexed += n;
        report.households_processed += 1;

        // Stable render hash: SHA-256 over all source_ids + texts in plan order.
        // Stored so a future delta pass can skip re-indexing unchanged households.
        let plan_hash = {
            let mut h = Sha256::new();
            for item in &items {
                h.update(item.source_id.as_bytes());
                h.update(item.text.as_bytes());
            }
            hex::encode(h.finalize())
        };
        store.set_render_state(grouping_key, &plan_hash, true)?;
    }

    Ok(report)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::crm::model::{WbContact, WbEvent, WbHouseholdRef, WbLink, WbNote, WbTask};
    use crate::commands::crm::store::CrmStore;
    use async_trait::async_trait;
    use tempfile::TempDir;

    // ── FakeCrmSource ─────────────────────────────────────────────────────────

    /// In-memory test double for `CrmSource`.  Returns the Anderson household
    /// fixture: one household contact, two member persons, one note linked to the
    /// head, one task and one event linked to the household.
    struct FakeCrmSource;

    fn fixture_household() -> WbContact {
        WbContact {
            id: 10001,
            r#type: "household".to_string(),
            company_name: "The Andersons".to_string(),
            contact_type: "Client".to_string(),
            status: "Active".to_string(),
            ..Default::default()
        }
    }

    fn fixture_head() -> WbContact {
        WbContact {
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
            household: Some(WbHouseholdRef {
                id: 10001,
                name: "The Andersons".to_string(),
                title: "Head".to_string(),
                members: vec![],
            }),
            ..Default::default()
        }
    }

    fn fixture_spouse() -> WbContact {
        WbContact {
            id: 10003,
            r#type: "person".to_string(),
            first_name: "Linda".to_string(),
            last_name: "Anderson".to_string(),
            birth_date: Some("1968-09-20".to_string()),
            contact_type: "Client".to_string(),
            status: "Active".to_string(),
            household: Some(WbHouseholdRef {
                id: 10001,
                name: "The Andersons".to_string(),
                title: "Spouse".to_string(),
                members: vec![],
            }),
            ..Default::default()
        }
    }

    fn fixture_note() -> WbNote {
        WbNote {
            id: 30001,
            created_at: "2026-03-10 09:15 AM -0500".to_string(),
            updated_at: "2026-03-10 09:15 AM -0500".to_string(),
            content: "Reviewed Q1 portfolio allocations with Robert. Discussed rebalancing RSUs."
                .to_string(),
            // Linked to the head person — resolves via contact_to_group to household "10001".
            linked_to: vec![WbLink {
                id: 10002,
                r#type: "contact".to_string(),
                name: "Robert Anderson".to_string(),
            }],
        }
    }

    fn fixture_task() -> WbTask {
        WbTask {
            id: 40001,
            name: "Consolidate inherited IRA".to_string(),
            due_date: Some("2026-12-31".to_string()),
            complete: false,
            priority: "High".to_string(),
            description: "Roll Linda's inherited IRA from her mother before year-end.".to_string(),
            // Linked directly to the household contact — grouping key is "10001".
            linked_to: vec![WbLink {
                id: 10001,
                r#type: "contact".to_string(),
                name: "The Andersons".to_string(),
            }],
        }
    }

    fn fixture_event() -> WbEvent {
        WbEvent {
            id: 50001,
            title: "Annual Review — Andersons".to_string(),
            starts_at: "2026-07-15 10:00 AM -0600".to_string(),
            ends_at: "2026-07-15 11:00 AM -0600".to_string(),
            all_day: false,
            location: "Advisor Office".to_string(),
            description: "Comprehensive annual review including tax-loss harvest discussion."
                .to_string(),
            // Linked directly to the household contact.
            linked_to: vec![WbLink {
                id: 10001,
                r#type: "contact".to_string(),
                name: "The Andersons".to_string(),
            }],
        }
    }

    #[async_trait]
    impl CrmSource for FakeCrmSource {
        async fn list_all_contacts(&self) -> anyhow::Result<Vec<WbContact>> {
            Ok(vec![fixture_household(), fixture_head(), fixture_spouse()])
        }
        async fn list_notes(&self) -> anyhow::Result<Vec<WbNote>> {
            Ok(vec![fixture_note()])
        }
        async fn list_tasks(&self) -> anyhow::Result<Vec<WbTask>> {
            Ok(vec![fixture_task()])
        }
        async fn list_events(&self) -> anyhow::Result<Vec<WbEvent>> {
            Ok(vec![fixture_event()])
        }
    }

    fn crm_store() -> (TempDir, CrmStore) {
        let dir = TempDir::new().unwrap();
        let key = [0x33u8; 32];
        let s = CrmStore::open_with_key(dir.path(), &key).expect("crm store open");
        (dir, s)
    }

    // ── Test: ingest ──────────────────────────────────────────────────────────

    #[tokio::test]
    async fn ingest_stores_all_objects_under_correct_household() {
        let (_d, store) = crm_store();
        let source = FakeCrmSource;

        let report = ingest(&source, &store).await.expect("ingest");

        // Report counts: household + head + spouse = 3 contacts; 1 note, 1 task, 1 event.
        assert_eq!(report.contacts, 3, "expected 3 contacts (household + head + spouse)");
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

    // ── Test: unlinked objects are skipped and counted ────────────────────────

    /// A source that returns one normal note (linked) and one orphan note
    /// (empty linked_to).  The orphan should not be stored and should increment
    /// `skipped_unlinked`.
    struct FakeWithUnlinkedNote;

    #[async_trait]
    impl CrmSource for FakeWithUnlinkedNote {
        async fn list_all_contacts(&self) -> anyhow::Result<Vec<WbContact>> {
            Ok(vec![fixture_household(), fixture_head()])
        }
        async fn list_notes(&self) -> anyhow::Result<Vec<WbNote>> {
            let orphan = WbNote {
                id: 99999,
                created_at: "2026-01-01".to_string(),
                updated_at: "2026-01-01".to_string(),
                content: "Orphan note — no linked contact".to_string(),
                linked_to: vec![], // empty → cannot resolve a grouping key
            };
            Ok(vec![fixture_note(), orphan])
        }
        async fn list_tasks(&self) -> anyhow::Result<Vec<WbTask>> {
            Ok(vec![])
        }
        async fn list_events(&self) -> anyhow::Result<Vec<WbEvent>> {
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
        assert!(row.is_none(), "unlinked note must not be written to the store");
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
        async fn list_all_contacts(&self) -> anyhow::Result<Vec<WbContact>> {
            // Contact id 10001 (the household) is registered in contact_to_group.
            Ok(vec![fixture_household()])
        }
        async fn list_notes(&self) -> anyhow::Result<Vec<WbNote>> {
            let note = WbNote {
                id: 77777,
                created_at: "2026-01-01".to_string(),
                updated_at: "2026-01-01".to_string(),
                content: "Note linked to a project, NOT a contact".to_string(),
                linked_to: vec![WbLink {
                    // Same numeric id as the household contact — must NOT match
                    // because the link type is "Project", not "Contact".
                    id: 10001,
                    r#type: "Project".to_string(),
                    name: "Some Pipeline Project".to_string(),
                }],
            };
            Ok(vec![note])
        }
        async fn list_tasks(&self) -> anyhow::Result<Vec<WbTask>> {
            Ok(vec![])
        }
        async fn list_events(&self) -> anyhow::Result<Vec<WbEvent>> {
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

    // ── (Ignored) Full backfill → apply_index integration test ───────────────
    //
    // Requires the e5-small embedding model (set REQUIRE_RAG_MODEL=1 to run).
    // Kept ignored so the default suite stays fully offline and fast.

    #[tokio::test]
    #[ignore]
    async fn backfill_full_integration_requires_embedding_model() {
        let dir = TempDir::new().unwrap();
        let key = [0x33u8; 32];
        let store = CrmStore::open_with_key(dir.path(), &key).unwrap();

        let mut matter_map = HashMap::new();
        matter_map.insert("10001".to_string(), "matter-integration".to_string());

        let report = backfill(&FakeCrmSource, &store, dir.path(), &matter_map)
            .await
            .expect("backfill");

        assert_eq!(report.households_processed, 1);
        assert!(report.records_indexed > 0, "expected at least one indexed chunk");
    }
}
