//! Calendly sync engine: fetch, store, render, and index meetings.

use std::collections::{BTreeSet, HashMap};
use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
#[cfg(test)]
use std::sync::{Mutex, OnceLock};

use sha2::{Digest, Sha256};

use crate::commands::calendly::model::{CalendlyEventWithInvitees, CalendlyInvitee};
use crate::commands::calendly::render::render_meeting;
use crate::commands::calendly::source::{fetch_event_bundle, CalendlySource};
use crate::commands::calendly::store::CalendlyStore;
use crate::commands::rag::store::UNASSIGNED_MATTER;

#[derive(Debug, Default, Clone)]
pub struct CalendlyIngestReport {
    pub events_fetched: u32,
    pub events_changed: u32,
    pub invitees_fetched: u32,
    pub pages_fetched: u32,
    pub cancelled: bool,
}

#[derive(Debug, Clone)]
pub struct CalendlyIndexItem {
    pub source_id: String,
    pub text: String,
    pub matter_id: String,
    pub store_id: String,
    pub content_hash: String,
}

#[derive(Debug, Default)]
pub struct CalendlySyncReport {
    pub events_fetched: u32,
    pub events_changed: u32,
    pub invitees_fetched: u32,
    pub meetings_indexed: u32,
    pub records_indexed: u32,
    pub cancelled: bool,
}

pub fn content_hash(json: &str) -> String {
    let hash = Sha256::digest(json.as_bytes());
    hex::encode(hash)
}

pub async fn ingest(
    source: &dyn CalendlySource,
    store: &CalendlyStore,
    cancel: &AtomicBool,
) -> anyhow::Result<CalendlyIngestReport> {
    let mut report = CalendlyIngestReport::default();
    let mut page_token: Option<String> = None;

    loop {
        if cancel.load(Ordering::SeqCst) {
            report.cancelled = true;
            return Ok(report);
        }

        let page = source.list_scheduled_events(page_token.as_deref()).await?;
        report.pages_fetched += 1;
        for event in &page.collection {
            if cancel.load(Ordering::SeqCst) {
                report.cancelled = true;
                return Ok(report);
            }
            let bundle = fetch_event_bundle(source, event).await?;
            report.events_fetched += 1;
            report.invitees_fetched += bundle.invitees.len() as u32;
            let json = serde_json::to_string(&bundle)?;
            let hash = content_hash(&json);
            let uuid = bundle.event.uuid();
            let store_id = format!("event:{}", uuid);
            let changed = store.upsert_event(&store_id, &uuid, &bundle.event.uri, &hash, &json)?;
            if changed {
                report.events_changed += 1;
            }
        }

        page_token = page.pagination.next_page_token;
        if page_token.as_deref().unwrap_or("").is_empty() {
            break;
        }
    }

    if !cancel.load(Ordering::SeqCst) {
        store.set_cursor("last_completed_at", &chrono::Utc::now().to_rfc3339())?;
        store.set_cursor("last_next_page_token", "")?;
    } else {
        report.cancelled = true;
    }
    Ok(report)
}

pub fn plan_meeting_index(
    store: &CalendlyStore,
    matter_map: &HashMap<String, String>,
) -> anyhow::Result<Vec<CalendlyIndexItem>> {
    let rows = store.list_events_to_index()?;
    let mut out = Vec::with_capacity(rows.len());
    for row in rows {
        let bundle: CalendlyEventWithInvitees = serde_json::from_str(&row.json)?;
        let (source_id, text) = render_meeting(&bundle);
        let matter_id = resolve_meeting_matter(&bundle, matter_map);
        out.push(CalendlyIndexItem {
            source_id,
            text,
            matter_id,
            store_id: row.id,
            content_hash: row.content_hash,
        });
    }
    Ok(out)
}

pub async fn apply_index_with_key(
    store: &CalendlyStore,
    workspace: &Path,
    items: &[CalendlyIndexItem],
    cancel: &AtomicBool,
    rag_key: &[u8; 32],
    progress: &AtomicU32,
) -> anyhow::Result<(u32, bool)> {
    let mut records = 0u32;
    for item in items {
        if cancel.load(Ordering::SeqCst) {
            return Ok((records, true));
        }
        let written = index_calendly_item_with_key(workspace, item, rag_key).await?;
        if cancel.load(Ordering::SeqCst) {
            return Ok((records, true));
        }
        store.mark_indexed(&item.store_id, &item.content_hash, &item.matter_id)?;
        records += written;
        progress.fetch_add(1, Ordering::SeqCst);
    }
    Ok((records, false))
}

async fn index_calendly_item_with_key(
    workspace: &Path,
    item: &CalendlyIndexItem,
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
        "meeting",
        rag_key,
    )
    .await
}

pub async fn backfill(
    source: &dyn CalendlySource,
    store: &CalendlyStore,
    workspace: &Path,
    matter_map: &HashMap<String, String>,
    cancel: &AtomicBool,
    rag_key: &[u8; 32],
    progress: &AtomicU32,
) -> anyhow::Result<CalendlySyncReport> {
    let ingest = ingest(source, store, cancel).await?;
    let items = if ingest.cancelled {
        Vec::new()
    } else {
        plan_meeting_index(store, matter_map)?
    };
    let (records, index_cancelled) =
        apply_index_with_key(store, workspace, &items, cancel, rag_key, progress).await?;
    Ok(CalendlySyncReport {
        events_fetched: ingest.events_fetched,
        events_changed: ingest.events_changed,
        invitees_fetched: ingest.invitees_fetched,
        meetings_indexed: progress.load(Ordering::SeqCst),
        records_indexed: records,
        cancelled: ingest.cancelled || index_cancelled,
    })
}

pub fn resolve_meeting_matter(
    bundle: &CalendlyEventWithInvitees,
    matter_map: &HashMap<String, String>,
) -> String {
    let mut matches = BTreeSet::new();

    if let Some(matter_id) = mapped_matter(matter_map, &bundle.event.uuid().to_ascii_lowercase()) {
        matches.insert(matter_id);
    }

    for invitee in stable_invitees(bundle) {
        let email = invitee.email.trim().to_ascii_lowercase();
        if let Some(matter_id) = mapped_matter(matter_map, &email) {
            matches.insert(matter_id);
            continue;
        }

        let name = normalize_name(&invitee.name);
        if let Some(matter_id) = mapped_matter(matter_map, &name) {
            matches.insert(matter_id);
        }
    }

    if matches.len() == 1 {
        matches.into_iter().next().unwrap()
    } else {
        UNASSIGNED_MATTER.to_string()
    }
}

fn mapped_matter(matter_map: &HashMap<String, String>, key: &str) -> Option<String> {
    if key.trim().is_empty() {
        return None;
    }
    matter_map
        .get(key)
        .map(|matter_id| matter_id.trim())
        .filter(|matter_id| !matter_id.is_empty())
        .map(str::to_string)
}

pub fn meeting_match_keys(bundle: &CalendlyEventWithInvitees) -> Vec<String> {
    let mut keys = Vec::new();
    for invitee in stable_invitees(bundle) {
        add_invitee_keys(&mut keys, invitee);
    }
    keys
}

fn add_invitee_keys(keys: &mut Vec<String>, invitee: &CalendlyInvitee) {
    let email = invitee.email.trim().to_ascii_lowercase();
    if !email.is_empty() {
        push_unique(keys, email);
    }
    let name = normalize_name(&invitee.name);
    if !name.is_empty() {
        push_unique(keys, name);
    }
}

fn push_unique(keys: &mut Vec<String>, key: String) {
    if !keys.contains(&key) {
        keys.push(key);
    }
}

fn stable_invitees(bundle: &CalendlyEventWithInvitees) -> Vec<&CalendlyInvitee> {
    let mut invitees = bundle.invitees.iter().collect::<Vec<_>>();
    invitees.sort_by_key(|invitee| {
        (
            invitee.email.trim().to_ascii_lowercase(),
            normalize_name(&invitee.name),
            invitee.uri.trim().to_ascii_lowercase(),
        )
    });
    invitees
}

pub fn normalize_name(name: &str) -> String {
    name.to_ascii_lowercase()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

#[cfg(test)]
type TestIndexer =
    Box<dyn Fn(&Path, &CalendlyIndexItem, &[u8; 32]) -> anyhow::Result<u32> + Send + Sync>;

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
    use std::sync::Mutex;

    use async_trait::async_trait;

    use crate::commands::calendly::model::{
        CalendlyEventsResponse, CalendlyInvitee, CalendlyPagination, CalendlyQuestionAnswer,
        CalendlyScheduledEvent,
    };

    use super::*;

    const STORE_KEY: [u8; 32] = [0x42; 32];

    #[derive(Default)]
    struct FakeCalendlySource {
        pages: Vec<CalendlyEventsResponse>,
        details: HashMap<String, CalendlyScheduledEvent>,
        invitees: HashMap<String, Vec<CalendlyInvitee>>,
        requested_pages: Mutex<Vec<Option<String>>>,
    }

    #[async_trait]
    impl CalendlySource for FakeCalendlySource {
        async fn list_scheduled_events(
            &self,
            page_token: Option<&str>,
        ) -> anyhow::Result<CalendlyEventsResponse> {
            self.requested_pages
                .lock()
                .unwrap()
                .push(page_token.map(str::to_string));
            let idx = match page_token {
                None => 0,
                Some("page-2") => 1,
                Some(other) => anyhow::bail!("unexpected page token {other}"),
            };
            Ok(self.pages.get(idx).cloned().unwrap_or_default())
        }

        async fn get_scheduled_event(&self, uuid: &str) -> anyhow::Result<CalendlyScheduledEvent> {
            self.details
                .get(uuid)
                .cloned()
                .ok_or_else(|| anyhow::anyhow!("missing detail {uuid}"))
        }

        async fn list_event_invitees(&self, uuid: &str) -> anyhow::Result<Vec<CalendlyInvitee>> {
            Ok(self.invitees.get(uuid).cloned().unwrap_or_default())
        }
    }

    fn event(uuid: &str, name: &str) -> CalendlyScheduledEvent {
        CalendlyScheduledEvent {
            uri: format!("https://api.calendly.com/scheduled_events/{uuid}"),
            name: name.to_string(),
            status: "active".into(),
            start_time: "2026-07-01T14:00:00Z".into(),
            end_time: "2026-07-01T14:30:00Z".into(),
            ..Default::default()
        }
    }

    fn invitee(name: &str, email: &str) -> CalendlyInvitee {
        CalendlyInvitee {
            name: name.to_string(),
            email: email.to_string(),
            status: "active".into(),
            questions_and_answers: vec![CalendlyQuestionAnswer {
                question: "What should we discuss?".into(),
                answer: "Draft complaint and deadline.".into(),
            }],
            ..Default::default()
        }
    }

    fn bundle(uuid: &str, invitees: Vec<CalendlyInvitee>) -> CalendlyEventWithInvitees {
        CalendlyEventWithInvitees {
            event: event(uuid, "Client meeting"),
            invitees,
        }
    }

    fn fake_source() -> FakeCalendlySource {
        let first = event("evt-1", "Initial consult");
        let second = event("evt-2", "Follow-up");
        FakeCalendlySource {
            pages: vec![
                CalendlyEventsResponse {
                    collection: vec![first.clone()],
                    pagination: CalendlyPagination {
                        next_page_token: Some("page-2".into()),
                        ..Default::default()
                    },
                },
                CalendlyEventsResponse {
                    collection: vec![second.clone()],
                    pagination: CalendlyPagination::default(),
                },
            ],
            details: HashMap::from([("evt-1".into(), first), ("evt-2".into(), second)]),
            invitees: HashMap::from([
                (
                    "evt-1".into(),
                    vec![invitee("Amelia Rivera", "amelia@example.com")],
                ),
                (
                    "evt-2".into(),
                    vec![invitee("Unmapped Person", "nobody@example.com")],
                ),
            ]),
            requested_pages: Mutex::new(Vec::new()),
        }
    }

    #[tokio::test]
    async fn plans_per_matter_and_unassigned_meeting_chunks() {
        let dir = tempfile::tempdir().unwrap();
        let store = CalendlyStore::open_with_key(dir.path(), &STORE_KEY).unwrap();
        let source = fake_source();
        let cancel = AtomicBool::new(false);
        ingest(&source, &store, &cancel).await.unwrap();

        let map = HashMap::from([(
            "amelia@example.com".to_string(),
            "matter-amelia".to_string(),
        )]);
        let items = plan_meeting_index(&store, &map).unwrap();
        assert_eq!(items.len(), 2);
        assert!(items.iter().any(|i| i.matter_id == "matter-amelia"));
        assert!(items.iter().any(|i| i.matter_id == UNASSIGNED_MATTER));
    }

    #[tokio::test]
    async fn hash_unchanged_events_are_skipped_after_successful_index_mark() {
        let dir = tempfile::tempdir().unwrap();
        let store = CalendlyStore::open_with_key(dir.path(), &STORE_KEY).unwrap();
        let source = fake_source();
        let cancel = AtomicBool::new(false);
        let first = ingest(&source, &store, &cancel).await.unwrap();
        assert_eq!(first.events_changed, 2);
        let items = plan_meeting_index(&store, &HashMap::new()).unwrap();
        for item in &items {
            store
                .mark_indexed(&item.store_id, &item.content_hash, &item.matter_id)
                .unwrap();
        }
        let second = ingest(&source, &store, &cancel).await.unwrap();
        assert_eq!(second.events_changed, 0);
        assert!(plan_meeting_index(&store, &HashMap::new())
            .unwrap()
            .is_empty());
    }

    #[tokio::test]
    async fn q_and_a_is_rendered_for_indexing() {
        let dir = tempfile::tempdir().unwrap();
        let store = CalendlyStore::open_with_key(dir.path(), &STORE_KEY).unwrap();
        let source = fake_source();
        let cancel = AtomicBool::new(false);
        ingest(&source, &store, &cancel).await.unwrap();
        let items = plan_meeting_index(&store, &HashMap::new()).unwrap();
        assert!(items
            .iter()
            .any(|i| i.text.contains("What should we discuss?")
                && i.text.contains("Draft complaint and deadline.")));
    }

    #[test]
    fn meeting_matter_conflict_across_invitees_is_unassigned_and_stable() {
        let meeting = bundle(
            "evt-conflict",
            vec![
                invitee("Beta Client", "beta@example.com"),
                invitee("Alpha Client", "alpha@example.com"),
            ],
        );
        let map = HashMap::from([
            ("alpha@example.com".to_string(), "matter-alpha".to_string()),
            ("beta@example.com".to_string(), "matter-beta".to_string()),
        ]);

        for _ in 0..100 {
            assert_eq!(resolve_meeting_matter(&meeting, &map), UNASSIGNED_MATTER);
        }
    }

    #[test]
    fn meeting_matter_email_match_wins_over_same_invitee_name_match() {
        let meeting = bundle(
            "evt-email-wins",
            vec![invitee("Beta Client", "alpha@example.com")],
        );
        let map = HashMap::from([
            ("alpha@example.com".to_string(), "matter-alpha".to_string()),
            ("beta client".to_string(), "matter-beta".to_string()),
        ]);

        assert_eq!(resolve_meeting_matter(&meeting, &map), "matter-alpha");
    }

    #[test]
    fn meeting_match_keys_are_stable_and_email_before_name_per_invitee() {
        let meeting = bundle(
            "evt-stable-keys",
            vec![
                invitee("Beta Client", "beta@example.com"),
                invitee("Alpha Client", "alpha@example.com"),
            ],
        );

        let expected = vec![
            "alpha@example.com".to_string(),
            "alpha client".to_string(),
            "beta@example.com".to_string(),
            "beta client".to_string(),
        ];
        for _ in 0..100 {
            assert_eq!(meeting_match_keys(&meeting), expected);
        }
    }

    #[tokio::test]
    async fn cancel_before_apply_does_not_mark_indexed_or_advance_progress() {
        let dir = tempfile::tempdir().unwrap();
        let store = CalendlyStore::open_with_key(dir.path(), &STORE_KEY).unwrap();
        let source = fake_source();
        let cancel = AtomicBool::new(false);
        ingest(&source, &store, &cancel).await.unwrap();
        let items = plan_meeting_index(&store, &HashMap::new()).unwrap();
        cancel.store(true, Ordering::SeqCst);
        let progress = AtomicU32::new(0);
        let (records, cancelled) =
            apply_index_with_key(&store, dir.path(), &items, &cancel, &[0x5A; 32], &progress)
                .await
                .unwrap();
        assert_eq!(records, 0);
        assert!(cancelled);
        assert_eq!(progress.load(Ordering::SeqCst), 0);
        assert_eq!(
            plan_meeting_index(&store, &HashMap::new()).unwrap().len(),
            2
        );
    }

    #[tokio::test]
    async fn cancel_after_index_returns_does_not_mark_indexed_or_advance_progress() {
        let dir = tempfile::tempdir().unwrap();
        let store = CalendlyStore::open_with_key(dir.path(), &STORE_KEY).unwrap();
        let meeting = bundle(
            "evt-cancel-after-index",
            vec![invitee("Amelia Rivera", "amelia@example.com")],
        );
        let json = serde_json::to_string(&meeting).unwrap();
        let hash = content_hash(&json);
        store
            .upsert_event(
                "event:evt-cancel-after-index",
                "evt-cancel-after-index",
                &meeting.event.uri,
                &hash,
                &json,
            )
            .unwrap();
        let items = plan_meeting_index(&store, &HashMap::new()).unwrap();
        assert_eq!(items.len(), 1);

        let cancel = std::sync::Arc::new(AtomicBool::new(false));
        let cancel_for_indexer = cancel.clone();
        let _guard = set_test_indexer(Box::new(move |_workspace, item, _rag_key| {
            assert_eq!(item.source_id, "calendly:event:evt-cancel-after-index");
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
            plan_meeting_index(&store, &HashMap::new()).unwrap().len(),
            1,
            "cancelled meeting must retry on the next sync"
        );
        let row = store
            .get_event("event:evt-cancel-after-index")
            .unwrap()
            .unwrap();
        assert_eq!(row.indexed_hash, "");
    }

    #[tokio::test]
    async fn pagination_is_requested_and_cursor_is_persisted_only_on_complete_sync() {
        let dir = tempfile::tempdir().unwrap();
        let store = CalendlyStore::open_with_key(dir.path(), &STORE_KEY).unwrap();
        let source = fake_source();
        let cancel = AtomicBool::new(false);
        ingest(&source, &store, &cancel).await.unwrap();
        assert_eq!(
            source.requested_pages.lock().unwrap().clone(),
            vec![None, Some("page-2".into())]
        );
        assert!(store.get_cursor("last_completed_at").unwrap().is_some());
        assert_eq!(
            store.get_cursor("last_next_page_token").unwrap(),
            Some(String::new())
        );

        let dir2 = tempfile::tempdir().unwrap();
        let store2 = CalendlyStore::open_with_key(dir2.path(), &STORE_KEY).unwrap();
        let cancelled = AtomicBool::new(true);
        let report = ingest(&source, &store2, &cancelled).await.unwrap();
        assert!(report.cancelled);
        assert!(store2.get_cursor("last_completed_at").unwrap().is_none());
    }
}
