//! Addepar household sync engine.

use std::collections::{HashMap, HashSet};
use std::future::Future;
use std::path::Path;
use std::pin::Pin;
use std::sync::atomic::{AtomicBool, Ordering};

use async_trait::async_trait;

use crate::commands::addepar::client::AddeparClient;
use crate::commands::addepar::model::{
    AddeparEntity, AddeparHouseholdRecord, AddeparMatterMapEntry, AddeparNeedsAssignment,
};
use crate::commands::addepar::render::render_household_record;

#[async_trait]
pub trait AddeparSource: Send + Sync {
    async fn list_entities(&self) -> anyhow::Result<Vec<AddeparEntity>>;
    async fn household_record(&self, entity: &AddeparEntity) -> anyhow::Result<AddeparHouseholdRecord>;
}

#[async_trait]
impl AddeparSource for AddeparClient {
    async fn list_entities(&self) -> anyhow::Result<Vec<AddeparEntity>> {
        AddeparClient::list_entities(self).await
    }

    async fn household_record(&self, entity: &AddeparEntity) -> anyhow::Result<AddeparHouseholdRecord> {
        AddeparClient::household_record(self, entity).await
    }
}

#[derive(Debug, Clone)]
pub struct AddeparIndexItem {
    pub source_id: String,
    pub text: String,
    pub matter_id: String,
}

#[derive(Debug, Default, Clone)]
pub struct AddeparSyncReport {
    pub entities_fetched: u32,
    pub households_processed: u32,
    pub records_indexed: u32,
    pub needs_assignment: Vec<AddeparNeedsAssignment>,
    /// Chunks deleted for households that vanished from Addepar entirely (no
    /// longer returned by list_entities) since the last sync.
    pub pruned: u32,
    pub cancelled: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Assignment {
    pub matter_id: String,
    pub needs_assignment: bool,
    pub reason: String,
}

pub fn resolve_entity_matter(
    entity: &AddeparEntity,
    matter_map: &[AddeparMatterMapEntry],
) -> Assignment {
    let key_map = build_key_map(matter_map);
    let mut matches = HashSet::new();
    collect_exact(&key_map, &mut matches, &entity.id);
    if matches.is_empty() {
        collect_exact(&key_map, &mut matches, &entity.name());
    }

    if matches.len() == 1 {
        return Assignment {
            matter_id: matches.into_iter().next().unwrap(),
            needs_assignment: false,
            reason: String::new(),
        };
    }
    Assignment {
        matter_id: crate::commands::rag::store::UNASSIGNED_MATTER.to_string(),
        needs_assignment: true,
        reason: if matches.is_empty() {
            "no client matched this Addepar household"
        } else {
            "multiple clients matched this Addepar household"
        }
        .to_string(),
    }
}

fn build_key_map(matter_map: &[AddeparMatterMapEntry]) -> HashMap<String, Vec<String>> {
    let mut map: HashMap<String, Vec<String>> = HashMap::new();
    for entry in matter_map {
        let key = normalize_key(&entry.addepar_key);
        if key.is_empty() || entry.matter_id.trim().is_empty() {
            continue;
        }
        map.entry(key).or_default().push(entry.matter_id.clone());
    }
    map
}

fn collect_exact(
    key_map: &HashMap<String, Vec<String>>,
    matches: &mut HashSet<String>,
    candidate: &str,
) {
    let key = normalize_key(candidate);
    if let Some(matter_ids) = key_map.get(&key) {
        matches.extend(matter_ids.iter().cloned());
    }
}

fn normalize_key(value: &str) -> String {
    value
        .to_ascii_lowercase()
        .replace(['<', '>', '"', '\'', ',', ';'], " ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

type IndexOneFuture<'a> = Pin<Box<dyn Future<Output = anyhow::Result<u32>> + Send + 'a>>;

async fn apply_index_items<F>(
    items: &[AddeparIndexItem],
    cancel: &AtomicBool,
    mut index_one: F,
) -> anyhow::Result<(u32, bool)>
where
    F: for<'a> FnMut(&'a AddeparIndexItem) -> IndexOneFuture<'a> + Send,
{
    let mut count = 0;
    for item in items {
        // Check cancel BETWEEN writes so Stop stops indexing promptly instead of
        // writing every queued household first.
        if cancel.load(Ordering::SeqCst) {
            return Ok((count, true));
        }
        count += index_one(item).await?;
    }
    Ok((count, false))
}

pub async fn apply_index_with_key(
    workspace: &Path,
    items: &[AddeparIndexItem],
    cancel: &AtomicBool,
    key: &[u8; 32],
) -> anyhow::Result<(u32, bool)> {
    let workspace = workspace.to_path_buf();
    let key = *key;
    apply_index_items(items, cancel, move |item| {
        let workspace = workspace.clone();
        Box::pin(async move {
            #[cfg(test)]
            {
                if let Some(result) =
                    TEST_INDEXER.with(|slot| slot.borrow().as_ref().map(|f| f(item)))
                {
                    return result;
                }
            }
            crate::commands::connector::index_external_text_with_key_internal(
                &workspace,
                &item.source_id,
                &item.text,
                &item.matter_id,
                "addepar",
                &key,
            )
            .await
        })
    })
    .await
}

pub async fn sync_with_key(
    source: &dyn AddeparSource,
    workspace: &Path,
    matter_map: &[AddeparMatterMapEntry],
    cancel: &AtomicBool,
    rag_key: &[u8; 32],
) -> anyhow::Result<AddeparSyncReport> {
    let entities = source.list_entities().await?;
    let mut report = AddeparSyncReport {
        entities_fetched: entities.len() as u32,
        ..Default::default()
    };
    let mut items = Vec::new();
    // Every household Addepar still returns this sync — used after a successful
    // full list to prune chunks for households that have vanished entirely.
    let mut seen: HashSet<String> = HashSet::new();

    for entity in entities {
        if cancel.load(Ordering::SeqCst) {
            report.cancelled = true;
            break;
        }
        seen.insert(crate::commands::addepar::render::household_source_id(&entity.id));
        let assignment = resolve_entity_matter(&entity, matter_map);
        if assignment.needs_assignment {
            // The household no longer maps to any matter. If it was indexed under
            // a previous mapping, delete those chunks so they don't linger under
            // the old matter (matter-isolation hygiene). No-op if never indexed.
            let source_id = crate::commands::addepar::render::household_source_id(&entity.id);
            crate::commands::connector::delete_external_source_with_key_internal(
                workspace, &source_id, rag_key,
            )
            .await?;
            report.needs_assignment.push(AddeparNeedsAssignment {
                source_id,
                entity_id: entity.id.clone(),
                name: entity.name(),
                reason: assignment.reason,
            });
            continue;
        }

        let record = source.household_record(&entity).await?;
        // Re-check AFTER the awaited fetch: Stop may have fired while this request
        // was in flight, after the loop's top-of-iteration check already passed.
        if cancel.load(Ordering::SeqCst) {
            report.cancelled = true;
            break;
        }
        let (source_id, text) = render_household_record(&record);
        items.push(AddeparIndexItem {
            source_id,
            text,
            matter_id: assignment.matter_id,
        });
        report.households_processed += 1;
    }

    // Re-check again right before any index mutation / prune, so a cancellation
    // that landed after the last fetch (or during list_entities) cannot let a
    // cancelled run index or prune.
    if report.cancelled || cancel.load(Ordering::SeqCst) {
        report.cancelled = true;
        return Ok(report);
    }
    let (records, index_cancelled) = apply_index_with_key(workspace, &items, cancel, rag_key).await?;
    report.records_indexed = records;

    // A cancel observed DURING indexing (between writes) or right after must skip
    // the prune, so a cancelled run never deletes vanished-household chunks.
    if index_cancelled || cancel.load(Ordering::SeqCst) {
        report.cancelled = true;
        return Ok(report);
    }

    // Prune households that vanished from Addepar entirely (no longer returned by
    // list_entities, so never added to `seen`). This only runs after a successful,
    // non-cancelled full list (a fetch error would have returned early above), so
    // a partial/failed sync can never mass-delete. Addepar keeps no local record
    // table, so the indexed source ids are read back from the RAG store.
    let conn = crate::commands::rag::store::open_connection(workspace).await?;
    let table = crate::commands::rag::store::open_or_create_table(&conn).await?;
    let existing =
        crate::commands::rag::store::list_external_source_ids(&table, "addepar", rag_key).await?;
    for source_id in existing {
        if !seen.contains(&source_id) {
            crate::commands::rag::store::delete_path(&table, &source_id, rag_key).await?;
            report.pruned += 1;
        }
    }
    Ok(report)
}

// Test seam: lets a test replace the per-item indexer (e.g. to flip the cancel
// flag mid-indexing) without the embedding model. THREAD-LOCAL so a seam set by
// one test never bleeds into a real-indexing test running on another thread
// (#[tokio::test] uses a current-thread runtime, so the indexing future runs on
// the same thread that set the seam).
#[cfg(test)]
type TestIndexer = Box<dyn Fn(&AddeparIndexItem) -> anyhow::Result<u32> + Send + Sync>;

#[cfg(test)]
thread_local! {
    static TEST_INDEXER: std::cell::RefCell<Option<TestIndexer>> =
        std::cell::RefCell::new(None);
}

#[cfg(test)]
struct TestIndexerGuard;

#[cfg(test)]
impl Drop for TestIndexerGuard {
    fn drop(&mut self) {
        TEST_INDEXER.with(|slot| *slot.borrow_mut() = None);
    }
}

#[cfg(test)]
fn set_test_indexer(indexer: TestIndexer) -> TestIndexerGuard {
    TEST_INDEXER.with(|slot| *slot.borrow_mut() = Some(indexer));
    TestIndexerGuard
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::addepar::model::{
        AddeparEntityAttributes, AddeparPortfolioQueryResponse, AddeparResource,
    };

    fn entity(id: &str, name: &str) -> AddeparEntity {
        AddeparResource {
            id: id.into(),
            r#type: "entities".into(),
            attributes: AddeparEntityAttributes {
                display_name: name.into(),
                model_type: "PERSON_NODE".into(),
                ..Default::default()
            },
        }
    }

    #[test]
    fn household_matching_prefers_addepar_entity_id() {
        let assignment = resolve_entity_matter(
            &entity("329263", "Northcrest Family Household"),
            &[AddeparMatterMapEntry {
                addepar_key: "329263".into(),
                matter_id: "matter-northcrest".into(),
            }],
        );
        assert_eq!(assignment.matter_id, "matter-northcrest");
        assert!(!assignment.needs_assignment);
    }

    #[test]
    fn household_matching_can_use_household_name() {
        let assignment = resolve_entity_matter(
            &entity("329263", "Northcrest Family Household"),
            &[AddeparMatterMapEntry {
                addepar_key: " northcrest   family household ".into(),
                matter_id: "matter-northcrest".into(),
            }],
        );
        assert_eq!(assignment.matter_id, "matter-northcrest");
        assert!(!assignment.needs_assignment);
    }

    #[test]
    fn unmatched_household_needs_assignment() {
        let assignment = resolve_entity_matter(&entity("329263", "Northcrest"), &[]);
        assert_eq!(assignment.matter_id, crate::commands::rag::store::UNASSIGNED_MATTER);
        assert!(assignment.needs_assignment);
    }

    #[test]
    fn indexed_item_uses_stable_source_id() {
        let record = AddeparHouseholdRecord {
            entity: entity("329263", "Northcrest"),
            asset_allocation: Some(AddeparPortfolioQueryResponse::default()),
            performance: None,
            account_list: None,
            warnings: vec![],
        };
        let (source_id, text) = crate::commands::addepar::render::render_household_record(&record);
        assert_eq!(source_id, "addepar:329263");
        assert!(text.contains("Addepar household portfolio summary"));
    }

    fn fake_household_record(entity_id: &str, name: &str) -> AddeparHouseholdRecord {
        let query_json = r#"{
          "data": { "type": "portfolio_views", "attributes": { "total": {
            "name": "Total", "columns": { "value": 1000000, "time_weighted_return": 0.05 },
            "children": [
              { "name": "Equity", "columns": { "value": 600000 }, "children": [] }
            ]
          } } }
        }"#;
        let query: AddeparPortfolioQueryResponse = serde_json::from_str(query_json).unwrap();
        AddeparHouseholdRecord {
            entity: entity(entity_id, name),
            asset_allocation: Some(query.clone()),
            performance: Some(query),
            account_list: None,
            warnings: vec![],
        }
    }

    struct FakeAddeparSource {
        entities: Vec<AddeparEntity>,
    }

    #[async_trait]
    impl AddeparSource for FakeAddeparSource {
        async fn list_entities(&self) -> anyhow::Result<Vec<AddeparEntity>> {
            Ok(self.entities.clone())
        }
        async fn household_record(
            &self,
            entity: &AddeparEntity,
        ) -> anyhow::Result<AddeparHouseholdRecord> {
            Ok(fake_household_record(&entity.id, &entity.name()))
        }
    }

    fn model_is_provisioned() -> bool {
        crate::commands::rag::model_download::model_files_cached(
            &crate::commands::rag::embedder::resolve_cache_dir(),
        )
    }

    async fn addepar_chunk_exists(workspace: &Path, matter_id: &str) -> bool {
        let conn = crate::commands::rag::store::open_connection(workspace)
            .await
            .unwrap();
        let table = crate::commands::rag::store::open_or_create_table(&conn)
            .await
            .unwrap();
        let hits = crate::commands::rag::store::nearest(
            &table,
            &vec![0.1f32; crate::commands::rag::embedder::EMBEDDING_DIM],
            10,
            Some(matter_id),
            false,
            &[],
        )
        .await
        .unwrap();
        hits.iter()
            .any(|h| h.source_type.as_deref() == Some("addepar"))
    }

    #[tokio::test]
    async fn unmapped_household_deletes_previously_indexed_chunks() {
        if !model_is_provisioned() {
            eprintln!("SKIP addepar unmap test: e5-small model cache not provisioned");
            return;
        }
        let workspace = tempfile::TempDir::new().unwrap();
        let rag_key = [0x71u8; 32];
        let source = FakeAddeparSource {
            entities: vec![entity("329263", "Northcrest Family Household")],
        };

        // First sync: household is mapped, so it gets indexed under the matter.
        let mapped = vec![AddeparMatterMapEntry {
            addepar_key: "329263".into(),
            matter_id: "matter-northcrest".into(),
        }];
        let report = sync_with_key(
            &source,
            workspace.path(),
            &mapped,
            &AtomicBool::new(false),
            &rag_key,
        )
        .await
        .unwrap();
        assert!(report.records_indexed > 0);
        assert!(addepar_chunk_exists(workspace.path(), "matter-northcrest").await);

        // Second sync: the mapping is gone, so the household is now unassigned and
        // its previously-indexed chunks must be deleted (matter isolation).
        let report2 = sync_with_key(
            &source,
            workspace.path(),
            &[],
            &AtomicBool::new(false),
            &rag_key,
        )
        .await
        .unwrap();
        assert_eq!(report2.records_indexed, 0);
        assert_eq!(report2.needs_assignment.len(), 1);
        assert!(!addepar_chunk_exists(workspace.path(), "matter-northcrest").await);
    }

    #[tokio::test]
    async fn vanished_household_chunks_are_pruned() {
        // A household that disappears from list_entities() entirely must have its
        // chunks pruned after a successful full sync (matter-isolation/privacy).
        if !model_is_provisioned() {
            eprintln!("SKIP addepar prune test: e5-small model cache not provisioned");
            return;
        }
        let workspace = tempfile::TempDir::new().unwrap();
        let rag_key = [0x72u8; 32];
        let map = vec![
            AddeparMatterMapEntry {
                addepar_key: "111".into(),
                matter_id: "matter-alpha".into(),
            },
            AddeparMatterMapEntry {
                addepar_key: "222".into(),
                matter_id: "matter-beta".into(),
            },
        ];

        // First sync: households 111 and 222 both exist and are indexed.
        let source1 = FakeAddeparSource {
            entities: vec![entity("111", "Alpha House"), entity("222", "Beta House")],
        };
        let r1 = sync_with_key(&source1, workspace.path(), &map, &AtomicBool::new(false), &rag_key)
            .await
            .unwrap();
        assert_eq!(r1.households_processed, 2);
        assert!(addepar_chunk_exists(workspace.path(), "matter-alpha").await);
        assert!(addepar_chunk_exists(workspace.path(), "matter-beta").await);

        // Second sync: household 222 has vanished from Addepar entirely.
        let source2 = FakeAddeparSource {
            entities: vec![entity("111", "Alpha House")],
        };
        let r2 = sync_with_key(&source2, workspace.path(), &map, &AtomicBool::new(false), &rag_key)
            .await
            .unwrap();
        assert_eq!(r2.pruned, 1);
        assert!(addepar_chunk_exists(workspace.path(), "matter-alpha").await);
        assert!(!addepar_chunk_exists(workspace.path(), "matter-beta").await);
    }

    /// Flips the shared cancel flag while a household_record fetch is in flight,
    /// simulating Stop pressed after the loop's top-of-iteration check.
    struct CancellingAddeparSource {
        entities: Vec<AddeparEntity>,
        cancel: std::sync::Arc<AtomicBool>,
    }

    #[async_trait]
    impl AddeparSource for CancellingAddeparSource {
        async fn list_entities(&self) -> anyhow::Result<Vec<AddeparEntity>> {
            Ok(self.entities.clone())
        }
        async fn household_record(
            &self,
            entity: &AddeparEntity,
        ) -> anyhow::Result<AddeparHouseholdRecord> {
            self.cancel.store(true, Ordering::SeqCst);
            Ok(fake_household_record(&entity.id, &entity.name()))
        }
    }

    #[tokio::test]
    async fn cancel_during_fetch_does_not_index_or_prune() {
        // Guard timing: if Stop fires during an in-flight record fetch, the run
        // must not index and must not prune the (vanished) household's chunks.
        if !model_is_provisioned() {
            eprintln!("SKIP addepar cancel-timing test: e5-small model cache not provisioned");
            return;
        }
        let workspace = tempfile::TempDir::new().unwrap();
        let rag_key = [0x73u8; 32];
        let map = vec![
            AddeparMatterMapEntry {
                addepar_key: "111".into(),
                matter_id: "matter-alpha".into(),
            },
            AddeparMatterMapEntry {
                addepar_key: "222".into(),
                matter_id: "matter-beta".into(),
            },
        ];

        // Seed: index household 222 with a normal sync.
        let seed = FakeAddeparSource {
            entities: vec![entity("222", "Beta House")],
        };
        sync_with_key(&seed, workspace.path(), &map, &AtomicBool::new(false), &rag_key)
            .await
            .unwrap();
        assert!(addepar_chunk_exists(workspace.path(), "matter-beta").await);

        // Cancelled sync: 222 has vanished and Stop fires during 111's fetch.
        let cancel = std::sync::Arc::new(AtomicBool::new(false));
        let source = CancellingAddeparSource {
            entities: vec![entity("111", "Alpha House")],
            cancel: cancel.clone(),
        };
        let report = sync_with_key(&source, workspace.path(), &map, &cancel, &rag_key)
            .await
            .unwrap();

        assert!(report.cancelled);
        assert_eq!(report.records_indexed, 0);
        assert_eq!(report.pruned, 0);
        // 222's chunks survive: a cancelled run must not prune.
        assert!(addepar_chunk_exists(workspace.path(), "matter-beta").await);
    }

    #[tokio::test]
    async fn cancel_during_indexing_does_not_prune() {
        // Guard timing: if Stop fires DURING indexing (after the pre-index check),
        // the post-index re-check must skip the prune so a vanished household's
        // chunks are not deleted on a cancelled run.
        if !model_is_provisioned() {
            eprintln!("SKIP addepar cancel-during-indexing test: model not provisioned");
            return;
        }
        let workspace = tempfile::TempDir::new().unwrap();
        let rag_key = [0x74u8; 32];

        // Seed a REAL chunk for household 222 that the prune WOULD delete.
        crate::commands::connector::index_external_text_with_key_internal(
            workspace.path(),
            "addepar:222",
            "Beta House portfolio summary and holdings.",
            "matter-beta",
            "addepar",
            &rag_key,
        )
        .await
        .unwrap();
        assert!(addepar_chunk_exists(workspace.path(), "matter-beta").await);

        // Sync where only 111 is mapped/listed (222 has vanished). The test
        // indexer flips cancel while indexing 111, simulating Stop pressed during
        // apply_index_with_key — after the pre-index check has already passed.
        let cancel = std::sync::Arc::new(AtomicBool::new(false));
        let cancel_for_indexer = cancel.clone();
        let _guard = set_test_indexer(Box::new(move |_item| {
            cancel_for_indexer.store(true, Ordering::SeqCst);
            Ok(1)
        }));
        let source = FakeAddeparSource {
            entities: vec![entity("111", "Alpha House")],
        };
        let map = vec![AddeparMatterMapEntry {
            addepar_key: "111".into(),
            matter_id: "matter-alpha".into(),
        }];
        let report = sync_with_key(&source, workspace.path(), &map, &cancel, &rag_key)
            .await
            .unwrap();

        assert!(report.cancelled);
        assert_eq!(report.pruned, 0);
        // 222's chunk survives because the cancelled run skipped pruning.
        assert!(addepar_chunk_exists(workspace.path(), "matter-beta").await);
    }

    #[tokio::test]
    async fn cancel_mid_index_stops_writing() {
        // Cancel threaded into the index loop: with two mapped households queued,
        // a Stop after the FIRST write must stop indexing the second one (not
        // write every queued household first). Model-free via the test seam.
        let workspace = tempfile::TempDir::new().unwrap();
        let rag_key = [0x75u8; 32];
        let cancel = std::sync::Arc::new(AtomicBool::new(false));
        let cancel_for_indexer = cancel.clone();
        let calls = std::sync::Arc::new(std::sync::atomic::AtomicU32::new(0));
        let calls_for_indexer = calls.clone();
        let _guard = set_test_indexer(Box::new(move |_item| {
            calls_for_indexer.fetch_add(1, Ordering::SeqCst);
            cancel_for_indexer.store(true, Ordering::SeqCst); // Stop after first write
            Ok(1)
        }));
        let source = FakeAddeparSource {
            entities: vec![entity("111", "Alpha House"), entity("222", "Beta House")],
        };
        let map = vec![
            AddeparMatterMapEntry {
                addepar_key: "111".into(),
                matter_id: "matter-a".into(),
            },
            AddeparMatterMapEntry {
                addepar_key: "222".into(),
                matter_id: "matter-b".into(),
            },
        ];
        let report = sync_with_key(&source, workspace.path(), &map, &cancel, &rag_key)
            .await
            .unwrap();

        assert!(report.cancelled);
        assert_eq!(
            calls.load(Ordering::SeqCst),
            1,
            "indexing must stop after the cancel — the second household must not be written"
        );
        assert_eq!(report.pruned, 0);
    }
}
