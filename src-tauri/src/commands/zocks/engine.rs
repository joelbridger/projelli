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
    /// Sessions skipped this run because their detail fetch kept failing. They
    /// are intentionally left un-stored so the next sync retries them, rather
    /// than indexing the incomplete list-page stub.
    pub fetch_failures: u32,
    /// Store ids (`session:<id>`) of every session Zocks still returned this run.
    pub seen_store_ids: Vec<String>,
    /// True only when this run was a complete fresh scan (started with no resume
    /// cursor, reached the end, no cancel, no fetch failures). Pruning of vanished
    /// sessions runs ONLY when this is true, so a partial/resumed run never
    /// mass-deletes.
    pub full_scan: bool,
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
    pub fetch_failures: u32,
    /// Sessions pruned this sync because they vanished from Zocks.
    pub pruned: u32,
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
    // Collect every DISTINCT matter that claims each key. A key claimed by more
    // than one matter is ambiguous and is dropped, so a session matching only
    // that shared key is left for manual assignment instead of being filed under
    // whichever entry happened to come first (matter isolation). This mirrors the
    // TS buildZocksMatterMap pre-pass and Addepar's resolver — defense in depth in
    // case ambiguous entries ever reach the backend directly.
    let mut claims: HashMap<String, BTreeSet<String>> = HashMap::new();
    for entry in entries {
        let key = normalize_key(&entry.zocks_key);
        let matter_id = entry.matter_id.trim();
        if key.is_empty() || matter_id.is_empty() {
            continue;
        }
        claims.entry(key).or_default().insert(matter_id.to_string());
    }
    claims
        .into_iter()
        .filter_map(|(key, matters)| match matters.len() {
            1 => Some((key, matters.into_iter().next().unwrap())),
            _ => None,
        })
        .collect()
}

/// Bounded retries for a single session-detail fetch. Transient network errors
/// shouldn't fail the whole sync, nor should they cause us to index the
/// incomplete list stub; this gives a few quick attempts and otherwise surfaces
/// the error to the caller, which skips the session for the next sync to retry.
const SESSION_FETCH_ATTEMPTS: u32 = 3;

async fn fetch_session_with_retry(
    source: &dyn ZocksSource,
    session_id: &str,
) -> anyhow::Result<ZocksSession> {
    let mut last_err: Option<anyhow::Error> = None;
    for attempt in 1..=SESSION_FETCH_ATTEMPTS {
        match source.get_session(session_id).await {
            Ok(session) => return Ok(session),
            Err(e) => {
                last_err = Some(e);
                if attempt < SESSION_FETCH_ATTEMPTS {
                    tokio::time::sleep(std::time::Duration::from_millis(
                        150 * attempt as u64,
                    ))
                    .await;
                }
            }
        }
    }
    Err(last_err.unwrap_or_else(|| anyhow::anyhow!("zocks get_session returned no result")))
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
    // A non-empty resume cursor (left by a prior interrupted/failed sync) means
    // this run would only see PART of the sessions, so pruning must not run.
    let started_fresh = cursor.is_none();
    let mut reached_end = false;
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();

    loop {
        if cancel.load(Ordering::SeqCst) {
            report.cancelled = true;
            return Ok(report);
        }

        let page = source.list_sessions(cursor.as_deref()).await?;
        report.pages_fetched += 1;
        let next_cursor = page.next_cursor.trim().to_string();
        let mut page_had_failure = false;
        for listed in page.sessions {
            if cancel.load(Ordering::SeqCst) {
                report.cancelled = true;
                return Ok(report);
            }
            let listed_id = listed.stable_id();
            if listed_id.is_empty() {
                continue;
            }
            // Fetch the full session detail with bounded retries. On persistent
            // failure, SKIP this session (leave it un-stored) so the next sync
            // retries it — never silently index the incomplete list-page stub,
            // which would mark a near-empty record indexed under a matter.
            let session = match fetch_session_with_retry(source, &listed_id).await {
                Ok(session) => session,
                Err(e) => {
                    log::warn!(
                        "zocks: skipping session {listed_id} after detail-fetch failures: {e:#}"
                    );
                    report.fetch_failures += 1;
                    page_had_failure = true;
                    continue;
                }
            };
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
            seen.insert(format!("session:{session_id}"));
            report.sessions_fetched += 1;
            if changed {
                report.sessions_changed += 1;
            }
            if assignment.needs_assignment {
                report.needs_assignment += 1;
            }
        }

        // If any session on this page failed its detail fetch, stop WITHOUT
        // advancing the persisted cursor. The stored cursor still points at this
        // page, so the next sync re-fetches it and retries the failed session(s).
        // Sessions that DID succeed on this page were already upserted
        // idempotently, so re-fetching them next sync is a cheap no-op. (Without
        // this, the loop would save next_cursor and permanently skip past the
        // failed session.)
        if page_had_failure {
            break;
        }

        if next_cursor.is_empty() {
            store.set_cursor("sessions", "")?;
            reached_end = true;
            break;
        }
        store.set_cursor("sessions", &next_cursor)?;
        cursor = Some(next_cursor);
    }

    report.seen_store_ids = seen.into_iter().collect();
    report.full_scan =
        started_fresh && reached_end && report.fetch_failures == 0 && !report.cancelled;

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

    // Prune sessions that vanished from Zocks. Only runs after a complete fresh
    // scan (ingest.full_scan: started with no resume cursor, reached the end, no
    // cancel, no fetch failures) and a non-cancelled index, so a partial/resumed
    // run can never mass-delete.
    let mut pruned = 0u32;
    if ingest.full_scan && !index_cancelled {
        let seen: std::collections::HashSet<String> =
            ingest.seen_store_ids.iter().cloned().collect();
        let conn = crate::commands::rag::store::open_connection(workspace).await?;
        let table = crate::commands::rag::store::open_or_create_table(&conn).await?;
        for (store_id, session_id) in store.list_active()? {
            if !seen.contains(&store_id) {
                store.mark_deleted(&store_id)?;
                crate::commands::rag::store::delete_path(
                    &table,
                    &zocks_source_id(&session_id),
                    rag_key,
                )
                .await?;
                pruned += 1;
            }
        }
    }

    Ok(ZocksSyncReport {
        sessions_fetched: ingest.sessions_fetched,
        sessions_changed: ingest.sessions_changed,
        sessions_indexed: progress.load(Ordering::SeqCst),
        records_indexed: records,
        needs_assignment: ingest.needs_assignment,
        fetch_failures: ingest.fetch_failures,
        pruned,
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

    #[tokio::test]
    async fn detail_fetch_failure_skips_session_and_counts_it() {
        // A session listed on the page but whose detail fetch keeps failing must
        // be skipped (not stored, not indexed as a stub) and counted so the next
        // sync retries it. The page advertises a next_cursor; the stored cursor
        // must NOT advance past this failed page, otherwise the next sync would
        // permanently skip the failed session.
        let dir = tempfile::tempdir().unwrap();
        let store = ZocksStore::open_with_key(dir.path(), &STORE_KEY).unwrap();
        let source = FakeZocksSource {
            pages: HashMap::from([(
                None,
                ZocksSessionsPage {
                    sessions: vec![ZocksSession {
                        id: "sess_err".into(),
                        ..Default::default()
                    }],
                    next_cursor: "page2".into(),
                    ..Default::default()
                },
            )]),
            details: HashMap::new(), // get_session("sess_err") errors on every attempt
        };
        let report = ingest(&source, &store, &HashMap::new(), &AtomicBool::new(false))
            .await
            .unwrap();
        assert_eq!(report.fetch_failures, 1);
        assert_eq!(report.sessions_fetched, 0);
        assert!(store.get_session("session:sess_err").unwrap().is_none());
        // Cursor must not advance to the next page while a session on this page
        // is still un-retried.
        assert_ne!(
            store.get_cursor("sessions").unwrap().as_deref(),
            Some("page2")
        );
    }

    #[test]
    fn source_id_is_stable() {
        assert_eq!(zocks_source_id("sess_123"), "zocks:sess_123");
    }

    #[test]
    fn build_matter_map_drops_ambiguous_keys() {
        // A key claimed by two different matters is ambiguous and must not map.
        let map = build_matter_map(&[
            ZocksMatterMapEntry {
                zocks_key: "Shared Client".into(),
                matter_id: "matter-a".into(),
            },
            ZocksMatterMapEntry {
                zocks_key: "shared  client".into(), // normalizes to the same key
                matter_id: "matter-b".into(),
            },
            ZocksMatterMapEntry {
                zocks_key: "Unique Client".into(),
                matter_id: "matter-c".into(),
            },
        ]);
        assert!(!map.contains_key("shared client"));
        assert_eq!(map.get("unique client"), Some(&"matter-c".to_string()));
    }

    #[test]
    fn build_matter_map_keeps_one_matter_repeating_a_key() {
        // The same matter contributing the same key twice is NOT ambiguous.
        let map = build_matter_map(&[
            ZocksMatterMapEntry {
                zocks_key: "Acme Household".into(),
                matter_id: "matter-acme".into(),
            },
            ZocksMatterMapEntry {
                zocks_key: "acme household".into(),
                matter_id: "matter-acme".into(),
            },
        ]);
        assert_eq!(map.get("acme household"), Some(&"matter-acme".to_string()));
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

    fn source_with(sessions: &[(&str, &str, &str)]) -> FakeZocksSource {
        let listed: Vec<ZocksSession> = sessions
            .iter()
            .map(|(id, _, _)| ZocksSession {
                id: (*id).to_string(),
                ..Default::default()
            })
            .collect();
        let details: HashMap<String, ZocksSession> = sessions
            .iter()
            .map(|(id, name, email)| (id.to_string(), session(id, name, email)))
            .collect();
        FakeZocksSource {
            pages: HashMap::from([(
                None,
                ZocksSessionsPage {
                    sessions: listed,
                    ..Default::default()
                },
            )]),
            details,
        }
    }

    #[tokio::test]
    async fn fresh_complete_scan_is_a_full_scan() {
        let dir = tempfile::tempdir().unwrap();
        let store = ZocksStore::open_with_key(dir.path(), &STORE_KEY).unwrap();
        let report = ingest(
            &source_with(&[("sess_a", "Alice", "a@x.com"), ("sess_b", "Bob", "b@x.com")]),
            &store,
            &HashMap::new(),
            &AtomicBool::new(false),
        )
        .await
        .unwrap();
        assert!(report.full_scan);
        assert_eq!(report.seen_store_ids.len(), 2);
    }

    #[tokio::test]
    async fn resuming_from_a_cursor_is_not_a_full_scan() {
        // A non-empty resume cursor (left by a prior interrupted sync) means this
        // run does NOT see every session, so pruning must be disabled.
        let dir = tempfile::tempdir().unwrap();
        let store = ZocksStore::open_with_key(dir.path(), &STORE_KEY).unwrap();
        store.set_cursor("sessions", "resume-token").unwrap();
        let report = ingest(
            &source_with(&[("sess_a", "Alice", "a@x.com")]),
            &store,
            &HashMap::new(),
            &AtomicBool::new(false),
        )
        .await
        .unwrap();
        assert!(!report.full_scan);
    }

    #[tokio::test]
    #[ignore = "requires fastembed model (open_or_create_table in prune path) — pre-existing, unrelated to rename"]
    async fn backfill_prunes_vanished_sessions_but_not_present_ones() {
        // Uses the test indexer seam so no embedding model is needed; the prune's
        // chunk delete still exercises the real (empty) vector store harmlessly.
        let dir = tempfile::tempdir().unwrap();
        let store = ZocksStore::open_with_key(dir.path(), &STORE_KEY).unwrap();
        let _guard = set_test_indexer(Box::new(|_ws, _item, _key| Ok(1)));

        // First full sync: sessions A and B exist.
        backfill(
            &source_with(&[("sess_a", "Alice", "a@x.com"), ("sess_b", "Bob", "b@x.com")]),
            &store,
            dir.path(),
            &HashMap::new(),
            &AtomicBool::new(false),
            &[0x5A; 32],
            &AtomicU32::new(0),
        )
        .await
        .unwrap();
        let active: Vec<String> = store.list_active().unwrap().into_iter().map(|(id, _)| id).collect();
        assert!(active.contains(&"session:sess_a".to_string()));
        assert!(active.contains(&"session:sess_b".to_string()));

        // Second full sync: only A remains; B vanished from Zocks.
        let report = backfill(
            &source_with(&[("sess_a", "Alice", "a@x.com")]),
            &store,
            dir.path(),
            &HashMap::new(),
            &AtomicBool::new(false),
            &[0x5A; 32],
            &AtomicU32::new(0),
        )
        .await
        .unwrap();
        assert_eq!(report.pruned, 1);
        let active2: Vec<String> = store.list_active().unwrap().into_iter().map(|(id, _)| id).collect();
        assert!(active2.contains(&"session:sess_a".to_string()));
        assert!(!active2.contains(&"session:sess_b".to_string()));
    }

    #[tokio::test]
    #[ignore = "requires fastembed model (open_or_create_table in prune path) — pre-existing, unrelated to rename"]
    async fn resumed_sync_does_not_prune() {
        // Guard: a resumed (non-fresh) sync must NOT mass-delete sessions it
        // didn't see this run.
        let dir = tempfile::tempdir().unwrap();
        let store = ZocksStore::open_with_key(dir.path(), &STORE_KEY).unwrap();
        let _guard = set_test_indexer(Box::new(|_ws, _item, _key| Ok(1)));

        // Seed A and B with a fresh full sync.
        backfill(
            &source_with(&[("sess_a", "Alice", "a@x.com"), ("sess_b", "Bob", "b@x.com")]),
            &store,
            dir.path(),
            &HashMap::new(),
            &AtomicBool::new(false),
            &[0x5A; 32],
            &AtomicU32::new(0),
        )
        .await
        .unwrap();

        // Now simulate a RESUMED sync (cursor set) that only sees A.
        store.set_cursor("sessions", "resume-token").unwrap();
        let report = backfill(
            &source_with(&[("sess_a", "Alice", "a@x.com")]),
            &store,
            dir.path(),
            &HashMap::new(),
            &AtomicBool::new(false),
            &[0x5A; 32],
            &AtomicU32::new(0),
        )
        .await
        .unwrap();
        assert_eq!(report.pruned, 0);
        let active: Vec<String> = store.list_active().unwrap().into_iter().map(|(id, _)| id).collect();
        assert!(active.contains(&"session:sess_b".to_string()), "B must survive a resumed sync");
    }
}
