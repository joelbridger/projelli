//! Zocks sync engine: fetch sessions, store normalized JSON, render, and index.

use std::collections::{BTreeSet, HashMap};
use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
#[cfg(test)]
use std::sync::{Mutex, OnceLock};

use sha2::{Digest, Sha256};

use crate::commands::rag::store::UNASSIGNED_MATTER;
use crate::commands::zocks::model::{ZocksMatterMapEntry, ZocksSession};
use crate::commands::zocks::render::{render_session, zocks_source_id};
use crate::commands::zocks::source::ZocksSource;
use crate::commands::zocks::store::ZocksStore;

#[derive(Debug, Clone, Default)]
pub struct ZocksIngestReport {
    pub sessions_fetched: u32,
    pub sessions_changed: u32,
    pub pages_fetched: u32,
    pub needs_assignment: u32,
    pub cancelled: bool,
}

#[derive(Debug, Clone)]
pub struct ZocksIndexItem {
    pub source_id: String,
    pub text: String,
    pub matter_id: String,
    pub store_id: String,
    pub content_hash: String,
}

#[derive(Debug, Clone, Default)]
pub struct ZocksSyncReport {
    pub sessions_fetched: u32,
    pub sessions_changed: u32,
    pub sessions_indexed: u32,
    pub records_indexed: u32,
    pub needs_assignment: u32,
    pub cancelled: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ZocksAssignment {
    pub matter_id: String,
    pub needs_assignment: bool,
    pub reason: String,
}

pub fn content_hash(json: &str) -> String {
    hex::encode(Sha256::digest(json.as_bytes()))
}

pub fn build_matter_map(entries: &[ZocksMatterMapEntry]) -> HashMap<String, String> {
    let mut map = HashMap::new();
    for entry in entries {
        let key = normalize_key(&entry.zocks_key);
        if key.is_empty() || entry.matter_id.trim().is_empty() {
            continue;
        }
        map.entry(key).or_insert_with(|| entry.matter_id.clone());
    }
    map
}

pub async fn ingest(
    source: &dyn ZocksSource,
    store: &ZocksStore,
    matter_map: &HashMap<String, String>,
    cancel: &AtomicBool,
) -> anyhow::Result<ZocksIngestReport> {
    let mut report = ZocksIngestReport::default();
    let mut cursor = store
        .get_cursor("sessions")?
        .filter(|value| !value.trim().is_empty());

    loop {
        if cancel.load(Ordering::SeqCst) {
            report.cancelled = true;
            return Ok(report);
        }

        let page = source.list_sessions(cursor.as_deref()).await?;
        report.pages_fetched += 1;
        let next_cursor = page.next_cursor.trim().to_string();
        for listed in page.sessions {
            if cancel.load(Ordering::SeqCst) {
                report.cancelled = true;
                return Ok(report);
            }
            let listed_id = listed.stable_id();
            if listed_id.is_empty() {
                continue;
            }
            let session = source.get_session(&listed_id).await.unwrap_or(listed);
            let session_id = session.stable_id();
            if session_id.is_empty() {
                continue;
            }
            let assignment = resolve_session_matter(&session, matter_map);
            let json = serde_json::to_string(&session)?;
            let hash = content_hash(&json);
            let changed = store.upsert_session(
                &format!("session:{session_id}"),
                &session_id,
                &session.title,
                &hash,
                &json,
                &assignment.matter_id,
                assignment.needs_assignment,
                &assignment.reason,
            )?;
            report.sessions_fetched += 1;
            if changed {
                report.sessions_changed += 1;
            }
            if assignment.needs_assignment {
                report.needs_assignment += 1;
            }
        }

        if next_cursor.is_empty() {
            store.set_cursor("sessions", "")?;
            break;
        }
        store.set_cursor("sessions", &next_cursor)?;
        cursor = Some(next_cursor);
    }

    Ok(report)
}

pub fn plan_session_index(store: &ZocksStore) -> anyhow::Result<Vec<ZocksIndexItem>> {
    let rows = store.list_sessions_to_index()?;
    let mut out = Vec::with_capacity(rows.len());
    for row in rows {
        let session: ZocksSession = serde_json::from_str(&row.json)?;
        let (source_id, text) = render_session(&session);
        out.push(ZocksIndexItem {
            source_id,
            text,
            matter_id: row.matter_id,
            store_id: row.id,
            content_hash: row.content_hash,
        });
    }
    Ok(out)
}

pub async fn apply_index_with_key(
    store: &ZocksStore,
    workspace: &Path,
    items: &[ZocksIndexItem],
    cancel: &AtomicBool,
    rag_key: &[u8; 32],
    progress: &AtomicU32,
) -> anyhow::Result<(u32, bool)> {
    let mut records = 0u32;
    for item in items {
        if cancel.load(Ordering::SeqCst) {
            return Ok((records, true));
        }
        let written = index_zocks_item_with_key(workspace, item, rag_key).await?;
        if cancel.load(Ordering::SeqCst) {
            return Ok((records, true));
        }
        store.mark_indexed(&item.store_id, &item.content_hash, &item.matter_id)?;
        records += written;
        progress.fetch_add(1, Ordering::SeqCst);
    }
    Ok((records, false))
}

async fn index_zocks_item_with_key(
    workspace: &Path,
    item: &ZocksIndexItem,
    rag_key: &[u8; 32],
) -> anyhow::Result<u32> {
    #[cfg(test)]
    {
        if let Some(indexer) = test_indexer_slot().lock().unwrap().as_ref() {
            return indexer(workspace, item, rag_key);
        }
    }

    crate::commands::connector::index_external_text_with_key_internal(
        workspace,
        &item.source_id,
        &item.text,
        &item.matter_id,
        "zocks",
        rag_key,
    )
    .await
}

pub async fn backfill(
    source: &dyn ZocksSource,
    store: &ZocksStore,
    workspace: &Path,
    matter_map: &HashMap<String, String>,
    cancel: &AtomicBool,
    rag_key: &[u8; 32],
    progress: &AtomicU32,
) -> anyhow::Result<ZocksSyncReport> {
    let ingest = ingest(source, store, matter_map, cancel).await?;
    let items = if ingest.cancelled {
        Vec::new()
    } else {
        plan_session_index(store)?
    };
    let (records, index_cancelled) =
        apply_index_with_key(store, workspace, &items, cancel, rag_key, progress).await?;
    Ok(ZocksSyncReport {
        sessions_fetched: ingest.sessions_fetched,
        sessions_changed: ingest.sessions_changed,
        sessions_indexed: progress.load(Ordering::SeqCst),
        records_indexed: records,
        needs_assignment: ingest.needs_assignment,
        cancelled: ingest.cancelled || index_cancelled,
    })
}

pub fn resolve_session_matter(
    session: &ZocksSession,
    matter_map: &HashMap<String, String>,
) -> ZocksAssignment {
    let mut matches = BTreeSet::new();

    collect_exact(matter_map, &mut matches, &session.stable_id());
    collect_exact(matter_map, &mut matches, &zocks_source_id(&session.stable_id()));
    collect_exact(matter_map, &mut matches, &session.client_email);
    for participant in &session.participants {
        collect_exact(matter_map, &mut matches, &participant.email);
    }

    if matches.is_empty() {
        collect_fuzzy(matter_map, &mut matches, &session.client_name);
        for participant in &session.participants {
            collect_fuzzy(matter_map, &mut matches, &participant.name);
        }
    }
    if matches.is_empty() {
        collect_fuzzy(matter_map, &mut matches, &session.title);
        collect_fuzzy(matter_map, &mut matches, &session.summary);
    }

    if matches.len() == 1 {
        return ZocksAssignment {
            matter_id: matches.into_iter().next().unwrap(),
            needs_assignment: false,
            reason: String::new(),
        };
    }

    let reason = if matches.is_empty() {
        "no matter matched session id, participant email/name, client name, title, or summary"
    } else {
        "multiple matters matched this Zocks session"
    };
    ZocksAssignment {
        matter_id: UNASSIGNED_MATTER.to_string(),
        needs_assignment: true,
        reason: reason.to_string(),
    }
}

fn collect_exact(
    matter_map: &HashMap<String, String>,
    matches: &mut BTreeSet<String>,
    candidate: &str,
) {
    let key = normalize_key(candidate);
    if let Some(matter_id) = mapped_matter(matter_map, &key) {
        matches.insert(matter_id);
    }
}

fn collect_fuzzy(
    matter_map: &HashMap<String, String>,
    matches: &mut BTreeSet<String>,
    candidate: &str,
) {
    let haystack = normalize_key(candidate);
    if haystack.is_empty() {
        return;
    }
    for (key, matter_id) in matter_map {
        if key.len() >= 4 && (haystack.contains(key) || key.contains(&haystack)) {
            matches.insert(matter_id.clone());
        }
    }
}

fn mapped_matter(matter_map: &HashMap<String, String>, key: &str) -> Option<String> {
    matter_map
        .get(key)
        .map(|matter_id| matter_id.trim())
        .filter(|matter_id| !matter_id.is_empty())
        .map(str::to_string)
}

pub fn normalize_key(value: &str) -> String {
    value
        .to_ascii_lowercase()
        .replace(['<', '>', '"', '\'', ',', ';'], " ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

#[cfg(test)]
type TestIndexer =
    Box<dyn Fn(&Path, &ZocksIndexItem, &[u8; 32]) -> anyhow::Result<u32> + Send + Sync>;

#[cfg(test)]
fn test_indexer_slot() -> &'static Mutex<Option<TestIndexer>> {
    static SLOT: OnceLock<Mutex<Option<TestIndexer>>> = OnceLock::new();
    SLOT.get_or_init(|| Mutex::new(None))
}

#[cfg(test)]
struct TestIndexerGuard;

#[cfg(test)]
impl Drop for TestIndexerGuard {
    fn drop(&mut self) {
        *test_indexer_slot().lock().unwrap() = None;
    }
}

#[cfg(test)]
fn set_test_indexer(indexer: TestIndexer) -> TestIndexerGuard {
    *test_indexer_slot().lock().unwrap() = Some(indexer);
    TestIndexerGuard
}

#[cfg(test)]
mod tests {
    use async_trait::async_trait;

    use super::*;
    use crate::commands::zocks::model::{ZocksParticipant, ZocksSession, ZocksSessionsPage};

    const STORE_KEY: [u8; 32] = [0x62; 32];

    #[derive(Default)]
    struct FakeZocksSource {
        pages: HashMap<Option<String>, ZocksSessionsPage>,
        details: HashMap<String, ZocksSession>,
    }

    #[async_trait]
    impl ZocksSource for FakeZocksSource {
        async fn list_sessions(&self, cursor: Option<&str>) -> anyhow::Result<ZocksSessionsPage> {
            Ok(self
                .pages
                .get(&cursor.map(str::to_string))
                .cloned()
                .unwrap_or_default())
        }

        async fn get_session(&self, session_id: &str) -> anyhow::Result<ZocksSession> {
            self.details
                .get(session_id)
                .cloned()
                .ok_or_else(|| anyhow::anyhow!("missing session {session_id}"))
        }
    }

    fn fixture_session() -> ZocksSession {
        serde_json::from_str(include_str!("fixtures/session.json")).unwrap()
    }

    fn session(id: &str, client_name: &str, email: &str) -> ZocksSession {
        ZocksSession {
            id: id.to_string(),
            title: format!("{client_name} review"),
            client_name: client_name.to_string(),
            participants: vec![ZocksParticipant {
                name: client_name.to_string(),
                email: email.to_string(),
                role: "client".into(),
            }],
            summary: "Discussed portfolio updates.".into(),
            ..Default::default()
        }
    }

    fn fake_source() -> FakeZocksSource {
        let first = fixture_session();
        let second = session("sess_456", "Unknown Person", "unknown@example.com");
        FakeZocksSource {
            pages: HashMap::from([
                (
                    None,
                    ZocksSessionsPage {
                        sessions: vec![
                            ZocksSession {
                                id: "sess_123".into(),
                                ..Default::default()
                            },
                            ZocksSession {
                                id: "sess_456".into(),
                                ..Default::default()
                            },
                        ],
                        ..Default::default()
                    },
                ),
            ]),
            details: HashMap::from([
                ("sess_123".into(), first),
                ("sess_456".into(), second),
            ]),
        }
    }

    #[tokio::test]
    async fn fixture_session_maps_by_participant_email_and_unmatched_needs_assignment() {
        let dir = tempfile::tempdir().unwrap();
        let store = ZocksStore::open_with_key(dir.path(), &STORE_KEY).unwrap();
        let map = HashMap::from([(
            "amelia@example.com".to_string(),
            "matter-amelia".to_string(),
        )]);

        let report = ingest(&fake_source(), &store, &map, &AtomicBool::new(false))
            .await
            .unwrap();

        assert_eq!(report.sessions_fetched, 2);
        assert_eq!(report.needs_assignment, 1);
        assert_eq!(
            store
                .get_session("session:sess_123")
                .unwrap()
                .unwrap()
                .matter_id,
            "matter-amelia"
        );
        assert_eq!(
            store
                .get_session("session:sess_456")
                .unwrap()
                .unwrap()
                .matter_id,
            UNASSIGNED_MATTER
        );
    }

    #[test]
    fn source_id_is_stable() {
        assert_eq!(zocks_source_id("sess_123"), "zocks:sess_123");
    }

    #[test]
    fn session_name_matching_is_unambiguous_or_unassigned() {
        let session = session("sess_name", "Amelia Rivera", "different@example.com");
        let single = HashMap::from([("amelia rivera".to_string(), "matter-amelia".to_string())]);
        assert_eq!(
            resolve_session_matter(&session, &single).matter_id,
            "matter-amelia"
        );

        let ambiguous = HashMap::from([
            ("amelia".to_string(), "matter-a".to_string()),
            ("rivera".to_string(), "matter-b".to_string()),
        ]);
        let assignment = resolve_session_matter(&session, &ambiguous);
        assert_eq!(assignment.matter_id, UNASSIGNED_MATTER);
        assert!(assignment.needs_assignment);
    }

    #[tokio::test]
    async fn plan_indexes_rendered_session_text() {
        let dir = tempfile::tempdir().unwrap();
        let store = ZocksStore::open_with_key(dir.path(), &STORE_KEY).unwrap();
        let map = HashMap::from([(
            "amelia@example.com".to_string(),
            "matter-amelia".to_string(),
        )]);
        ingest(&fake_source(), &store, &map, &AtomicBool::new(false))
            .await
            .unwrap();
        let items = plan_session_index(&store).unwrap();
        assert_eq!(items.len(), 2);
        let amelia = items
            .iter()
            .find(|item| item.source_id == "zocks:sess_123")
            .unwrap();
        assert_eq!(amelia.matter_id, "matter-amelia");
        assert!(amelia.text.contains("Zocks meeting notes"));
        assert!(amelia.text.contains("Increase Roth conversion estimate"));
    }

    #[tokio::test]
    async fn cancelled_after_index_does_not_mark_session_indexed() {
        let dir = tempfile::tempdir().unwrap();
        let store = ZocksStore::open_with_key(dir.path(), &STORE_KEY).unwrap();
        let session = fixture_session();
        let json = serde_json::to_string(&session).unwrap();
        let hash = content_hash(&json);
        store
            .upsert_session(
                "session:sess_123",
                "sess_123",
                &session.title,
                &hash,
                &json,
                "matter-amelia",
                false,
                "",
            )
            .unwrap();
        let items = plan_session_index(&store).unwrap();
        let cancel = std::sync::Arc::new(AtomicBool::new(false));
        let cancel_for_indexer = cancel.clone();
        let _guard = set_test_indexer(Box::new(move |_workspace, item, _rag_key| {
            assert_eq!(item.source_id, "zocks:sess_123");
            cancel_for_indexer.store(true, Ordering::SeqCst);
            Ok(1)
        }));
        let progress = AtomicU32::new(0);
        let (records, cancelled) =
            apply_index_with_key(&store, dir.path(), &items, &cancel, &[0x5A; 32], &progress)
                .await
                .unwrap();
        assert_eq!(records, 0);
        assert!(cancelled);
        assert_eq!(progress.load(Ordering::SeqCst), 0);
        assert_eq!(
            store
                .get_session("session:sess_123")
                .unwrap()
                .unwrap()
                .indexed_hash,
            ""
        );
    }
}
