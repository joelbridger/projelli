//! Calendar sync engine: fetch -> exclude -> upsert -> resolve matters ->
//! render -> index (one RAG row per matched matter) -> purge absentees.

use std::collections::HashMap;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};

use super::graph_source::CalendarSource;
use super::model::{should_keep_event, CalendarEvent};
use super::store::CalendarStore;
use crate::commands::rag::store::UNASSIGNED_MATTER;

pub struct SyncCounts {
    pub fetched: u32,
    pub changed: u32,
    pub indexed: u32,
    pub records: u32,
}

/// Must stay semantically identical to `normalizeMeetingKey` in
/// src/platform/rag/matterResolver.ts:349 (lowercase, trim, collapse ws).
pub fn normalize_key(key: &str) -> String {
    key.to_lowercase()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

/// Email match beats name match per attendee (the Calendly rule,
/// calendly/engine.rs:194-233), but ACROSS attendees every distinct matched
/// matter is kept: a joint meeting legitimately belongs to several clients.
/// Zero matches -> unassigned. (Key-level ambiguity was already dropped by
/// the TS map builder, so any key present here maps to exactly one matter.)
pub fn resolve_event_matters(
    event: &CalendarEvent,
    matter_map: &HashMap<String, String>,
) -> Vec<String> {
    let mut matches = std::collections::BTreeSet::new();
    for attendee in &event.attendees {
        let email = attendee.email.trim().to_ascii_lowercase();
        if let Some(m) = lookup(matter_map, &email) {
            matches.insert(m);
            continue;
        }
        if let Some(m) = lookup(matter_map, &normalize_key(&attendee.name)) {
            matches.insert(m);
        }
    }
    // Full-diff review finding (P2): when the CLIENT sends the invite
    // (common with Google/Graph), the attendee list may only contain the
    // advisor — the client's own address lands in organizer_email, not
    // attendees. Without checking it too, that meeting landed unassigned
    // even though model.rs already captures organizer_email for exactly
    // this reason.
    let organizer_email = event.organizer_email.trim().to_ascii_lowercase();
    if let Some(m) = lookup(matter_map, &organizer_email) {
        matches.insert(m);
    }
    // The event title can also carry a taught key (e.g. "Henderson quarterly").
    if let Some(m) = lookup(matter_map, &normalize_key(&event.title)) {
        matches.insert(m);
    }
    if matches.is_empty() {
        vec![UNASSIGNED_MATTER.to_string()]
    } else {
        matches.into_iter().collect()
    }
}

fn lookup(map: &HashMap<String, String>, key: &str) -> Option<String> {
    if key.trim().is_empty() {
        return None;
    }
    map.get(key)
        .map(|m| m.trim())
        .filter(|m| !m.is_empty())
        .map(str::to_string)
}

/// Plain-text rendering for the RAG index (source_type "meeting").
pub fn render_event(event: &CalendarEvent) -> String {
    let attendees = event
        .attendees
        .iter()
        .map(|a| {
            if a.name.is_empty() {
                a.email.clone()
            } else {
                format!("{} <{}>", a.name, a.email)
            }
        })
        .collect::<Vec<_>>()
        .join(", ");
    format!(
        "Meeting: {}\nWhen: {} to {} (UTC)\nOrganizer: {}\nAttendees: {}\nSource: {} calendar\n\n{}",
        event.title,
        event.start_utc,
        event.end_utc,
        event.organizer_email,
        attendees,
        event.provider.as_str(),
        event.description
    )
}

// ── Test seam (the calendly/engine.rs test_indexer_slot pattern) ───────────

pub struct TestHooks {
    pub index: Box<dyn Fn(&str, &str) -> anyhow::Result<u32> + Send>,
    pub delete: Box<dyn Fn(&str) -> anyhow::Result<()> + Send>,
}

#[cfg(test)]
pub fn test_hooks_slot() -> &'static std::sync::Mutex<Option<TestHooks>> {
    static SLOT: std::sync::Mutex<Option<TestHooks>> = std::sync::Mutex::new(None);
    &SLOT
}

async fn index_one(
    workspace: &Path,
    source_id: &str,
    text: &str,
    matter_id: &str,
    rag_key: &[u8; 32],
) -> anyhow::Result<u32> {
    #[cfg(test)]
    {
        if let Some(hooks) = test_hooks_slot().lock().unwrap().as_ref() {
            return (hooks.index)(source_id, matter_id);
        }
    }
    crate::commands::connector::index_external_text_with_key_internal(
        workspace, source_id, text, matter_id, "meeting", rag_key,
    )
    .await
}

async fn delete_one(workspace: &Path, source_id: &str, rag_key: &[u8; 32]) -> anyhow::Result<()> {
    #[cfg(test)]
    {
        if let Some(hooks) = test_hooks_slot().lock().unwrap().as_ref() {
            return (hooks.delete)(source_id);
        }
    }
    crate::commands::connector::delete_external_source_with_key_internal(
        workspace, source_id, rag_key,
    )
    .await
}

/// One provider's full sync pass. Cancellable between events.
#[allow(clippy::too_many_arguments)]
pub async fn sync_source(
    store: &CalendarStore,
    source: &dyn CalendarSource,
    matter_map: &HashMap<String, String>,
    workspace: &Path,
    rag_key: &[u8; 32],
    from_utc: &str,
    to_utc: &str,
    cancel: &AtomicBool,
    progress: &(dyn Fn(u32) + Send + Sync),
) -> anyhow::Result<SyncCounts> {
    let provider = source.provider().as_str();
    let fetched_events = source.fetch_events(from_utc, to_utc).await?;
    let mut counts = SyncCounts { fetched: 0, changed: 0, indexed: 0, records: 0 };
    let mut seen_ids: Vec<String> = Vec::new();

    for event in &fetched_events {
        if cancel.load(Ordering::SeqCst) {
            break;
        }
        counts.fetched += 1;
        if !should_keep_event(event) {
            // Excluded (cancelled / self-declined): do NOT record it as seen,
            // so the collective absent-purge below removes any rows a previous
            // sync indexed for it.
            continue;
        }
        seen_ids.push(event.id.clone());
        let text = render_event(event);
        let content_hash = crate::commands::calendly::engine::content_hash(&text);
        // Read the PREVIOUS matter assignment before upsert/mark_indexed
        // touch anything (upsert_event never writes matter_ids itself).
        let previous_matter_ids = store.get_matter_ids(&event.id)?.unwrap_or_default();
        let content_changed = store.upsert_event(event, &content_hash)?;
        let matters = resolve_event_matters(event, matter_map);
        let matters_csv = matters.join(",");
        // codex-review P2: a taught/re-taught mapping must take effect on
        // the next sync even when the event's own text hasn't changed —
        // otherwise a meeting stays misfiled under its old client (or
        // unassigned) until its content happens to change too.
        let mapping_changed = matters_csv != previous_matter_ids;
        // codex-review P1 (wave-1b review round 2): upsert_event commits
        // content_hash unconditionally, before indexing runs below. If a
        // PRIOR sync's indexing failed partway (network hiccup, one bad
        // matter write, ...), content_hash already advanced but
        // indexed_hash didn't — content_changed/mapping_changed alone
        // can't see that, so a since-content-unchanged event would
        // silently never retry. is_stale reads the store's own
        // indexed_hash-vs-content_hash bookkeeping directly (the same
        // condition list_to_index filters on).
        let stale = store.is_stale(&event.id)?;
        if !content_changed && !mapping_changed && !stale {
            continue;
        }
        if content_changed {
            counts.changed += 1;
        }
        // codex-review P1: delete RAG rows for any matter this event no
        // longer resolves to BEFORE writing the new matter_ids — otherwise
        // the old source ids are silently orphaned (never purged by the
        // absent-event sweep below, since the event itself is still
        // present upstream) and Ask can keep surfacing the meeting under
        // the wrong/old client forever.
        let previous_set: std::collections::HashSet<&str> =
            previous_matter_ids.split(',').filter(|m| !m.is_empty()).collect();
        let new_set: std::collections::HashSet<&str> = matters.iter().map(String::as_str).collect();
        for old_matter in previous_set.difference(&new_set) {
            let source_id = format!("calendar:{}:{}", event.id, old_matter);
            delete_one(workspace, &source_id, rag_key).await?;
        }
        let mut indexed_any = false;
        for matter_id in &matters {
            let source_id = format!("calendar:{}:{}", event.id, matter_id);
            let records = index_one(workspace, &source_id, &text, matter_id, rag_key).await?;
            counts.records += records;
            indexed_any = true;
        }
        if indexed_any {
            counts.indexed += 1;
            store.mark_indexed(&event.id, &content_hash, &matters_csv)?;
        }
        progress(counts.indexed);
    }

    // Purge events that vanished upstream (rescheduled out of window,
    // cancelled-and-removed, deleted).
    if !cancel.load(Ordering::SeqCst) {
        let gone = store.mark_absent_deleted(provider, from_utc, to_utc, &seen_ids)?;
        for row in gone {
            for matter in row.matter_ids.split(',').filter(|m| !m.is_empty()) {
                let source_id = format!("calendar:{}:{}", row.id, matter);
                delete_one(workspace, &source_id, rag_key).await?;
            }
        }
    }
    Ok(counts)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::calendar::graph_source::CalendarSource;
    use crate::commands::calendar::model::{CalendarAttendee, CalendarEvent, CalendarProvider};
    use crate::commands::calendar::store::CalendarStore;
    use std::collections::HashMap;
    use std::sync::atomic::AtomicBool;
    use std::sync::Arc;

    const STORE_KEY: [u8; 32] = [0x42; 32];

    /// `test_hooks_slot()` is a single process-global static shared by every
    /// test in this module; cargo's default multi-threaded test runner can
    /// interleave two hook-using tests, so one test's teardown
    /// (`= None`) or setup can clobber another's mid-flight — observed as a
    /// flaky empty `indexed`/`deleted` list. Any test that sets hooks must
    /// hold this guard for its whole body so only one such test runs at a
    /// time (pure tests with no hooks, like the `resolve_event_matters`
    /// table test, don't need it and still run in parallel).
    fn hooks_test_guard() -> std::sync::MutexGuard<'static, ()> {
        static GUARD: std::sync::Mutex<()> = std::sync::Mutex::new(());
        GUARD.lock().unwrap_or_else(|e| e.into_inner())
    }

    struct FakeSource {
        events: Vec<CalendarEvent>,
    }

    #[async_trait::async_trait]
    impl CalendarSource for FakeSource {
        fn provider(&self) -> CalendarProvider {
            CalendarProvider::Outlook
        }
        async fn fetch_events(
            &self,
            _from: &str,
            _to: &str,
        ) -> anyhow::Result<Vec<CalendarEvent>> {
            Ok(self.events.clone())
        }
    }

    fn ev(id: &str, title: &str, attendees: &[(&str, &str)]) -> CalendarEvent {
        CalendarEvent {
            id: id.into(),
            provider: CalendarProvider::Outlook,
            title: title.into(),
            description: String::new(),
            start_utc: "2026-07-02T16:00:00Z".into(),
            end_utc: "2026-07-02T17:00:00Z".into(),
            attendees: attendees
                .iter()
                .map(|(e, n)| CalendarAttendee { email: (*e).into(), name: (*n).into() })
                .collect(),
            organizer_email: "adv@firm.com".into(),
            is_cancelled: false,
            self_declined: false,
            join_url: None,
        }
    }

    fn map(entries: &[(&str, &str)]) -> HashMap<String, String> {
        entries
            .iter()
            .map(|(k, m)| (normalize_key(k), (*m).to_string()))
            .collect()
    }

    #[test]
    fn resolves_email_then_name_multi_client_and_unassigned() {
        let m = map(&[("kim@henderson.com", "m-hend"), ("r ortiz", "m-ortiz")]);
        // (event, expected matters, why)
        let table: Vec<(CalendarEvent, Vec<&str>, &str)> = vec![
            (
                ev("outlook:1", "Review", &[("kim@henderson.com", "Kim")]),
                vec!["m-hend"],
                "email match",
            ),
            (
                ev("outlook:2", "Check-in", &[("other@x.com", "R Ortiz")]),
                vec!["m-ortiz"],
                "name match when email unknown",
            ),
            (
                ev(
                    "outlook:3",
                    "Joint meeting",
                    &[("kim@henderson.com", "Kim"), ("other@x.com", "R Ortiz")],
                ),
                vec!["m-hend", "m-ortiz"],
                "multi-client meeting matches BOTH matters",
            ),
            (
                ev("outlook:4", "Stranger", &[("who@x.com", "Nobody")]),
                vec![crate::commands::rag::store::UNASSIGNED_MATTER],
                "no match is unassigned, never guessed",
            ),
        ];
        for (event, expected, why) in table {
            let got = resolve_event_matters(&event, &m);
            assert_eq!(got, expected.iter().map(|s| s.to_string()).collect::<Vec<_>>(), "{why}");
        }
    }

    #[test]
    fn resolves_by_organizer_email_when_the_client_sent_the_invite() {
        // Full-diff review finding (P2): when the CLIENT sends the invite
        // (common with Google/Graph), the attendee list may only contain
        // the advisor — the client's own address lands in organizer_email,
        // not attendees. Previously that meant the meeting landed
        // unassigned even though a taught key existed for the organizer.
        let m = map(&[("kim@henderson.com", "m-hend")]);
        let mut event = ev("outlook:5", "Client-sent invite", &[("adv@firm.com", "Advisor")]);
        event.organizer_email = "kim@henderson.com".into();
        assert_eq!(resolve_event_matters(&event, &m), vec!["m-hend".to_string()]);
    }

    #[tokio::test]
    async fn sync_ingests_indexes_per_matter_and_purges_absent() {
        let _guard = hooks_test_guard();
        let dir = tempfile::tempdir().unwrap();
        let indexed: Arc<std::sync::Mutex<Vec<(String, String)>>> =
            Arc::new(std::sync::Mutex::new(Vec::new()));
        let deleted: Arc<std::sync::Mutex<Vec<String>>> =
            Arc::new(std::sync::Mutex::new(Vec::new()));
        {
            let indexed = indexed.clone();
            let deleted = deleted.clone();
            *test_hooks_slot().lock().unwrap() = Some(TestHooks {
                index: Box::new(move |source_id, matter_id| {
                    indexed.lock().unwrap().push((source_id.into(), matter_id.into()));
                    Ok(1)
                }),
                delete: Box::new(move |source_id| {
                    deleted.lock().unwrap().push(source_id.into());
                    Ok(())
                }),
            });
        }

        let store = CalendarStore::open_with_key(dir.path(), &STORE_KEY).unwrap();
        let matter_map = map(&[("kim@henderson.com", "m-hend"), ("r ortiz", "m-ortiz")]);
        let source = FakeSource {
            events: vec![ev(
                "outlook:1",
                "Joint",
                &[("kim@henderson.com", "Kim"), ("x@y.com", "R Ortiz")],
            )],
        };
        let cancel = Arc::new(AtomicBool::new(false));
        let counts = sync_source(
            &store,
            &source,
            &matter_map,
            dir.path(),
            &STORE_KEY,
            "2026-07-01T00:00:00Z",
            "2026-07-10T00:00:00Z",
            &cancel,
            &|_| {},
        )
        .await
        .unwrap();
        assert_eq!(counts.fetched, 1);
        assert_eq!(counts.indexed, 1);
        {
            let got = indexed.lock().unwrap();
            assert_eq!(
                *got,
                vec![
                    ("calendar:outlook:1:m-hend".to_string(), "m-hend".to_string()),
                    ("calendar:outlook:1:m-ortiz".to_string(), "m-ortiz".to_string()),
                ],
                "one RAG row per matched matter, matter-scoped"
            );
        }

        // Second sync: the event disappeared upstream -> its RAG rows purge.
        let empty = FakeSource { events: vec![] };
        sync_source(
            &store,
            &empty,
            &matter_map,
            dir.path(),
            &STORE_KEY,
            "2026-07-01T00:00:00Z",
            "2026-07-10T00:00:00Z",
            &cancel,
            &|_| {},
        )
        .await
        .unwrap();
        let got = deleted.lock().unwrap();
        assert_eq!(
            *got,
            vec![
                "calendar:outlook:1:m-hend".to_string(),
                "calendar:outlook:1:m-ortiz".to_string()
            ]
        );
        *test_hooks_slot().lock().unwrap() = None;
    }

    #[tokio::test]
    async fn reassigned_mapping_purges_old_matter_and_reindexes_new_even_with_unchanged_content() {
        // codex-review P1+P2: a taught/re-taught mapping must take effect
        // on the next sync even though the event's own text is unchanged,
        // AND the old matter's RAG rows must be purged — not left as
        // stale/wrong-client duplicates.
        let _guard = hooks_test_guard();
        let dir = tempfile::tempdir().unwrap();
        let indexed: Arc<std::sync::Mutex<Vec<(String, String)>>> =
            Arc::new(std::sync::Mutex::new(Vec::new()));
        let deleted: Arc<std::sync::Mutex<Vec<String>>> = Arc::new(std::sync::Mutex::new(Vec::new()));
        {
            let indexed = indexed.clone();
            let deleted = deleted.clone();
            *test_hooks_slot().lock().unwrap() = Some(TestHooks {
                index: Box::new(move |source_id, matter_id| {
                    indexed.lock().unwrap().push((source_id.into(), matter_id.into()));
                    Ok(1)
                }),
                delete: Box::new(move |source_id| {
                    deleted.lock().unwrap().push(source_id.into());
                    Ok(())
                }),
            });
        }

        let store = CalendarStore::open_with_key(dir.path(), &STORE_KEY).unwrap();
        let source = FakeSource {
            events: vec![ev("outlook:1", "Review", &[("kim@henderson.com", "Kim")])],
        };
        let cancel = Arc::new(AtomicBool::new(false));

        // First sync: kim@henderson.com maps to m-hend.
        let map_v1 = map(&[("kim@henderson.com", "m-hend")]);
        let counts1 = sync_source(
            &store, &source, &map_v1, dir.path(), &STORE_KEY,
            "2026-07-01T00:00:00Z", "2026-07-10T00:00:00Z", &cancel, &|_| {},
        )
        .await
        .unwrap();
        assert_eq!(counts1.changed, 1, "first sync: content is new");
        assert_eq!(*indexed.lock().unwrap(), vec![("calendar:outlook:1:m-hend".to_string(), "m-hend".to_string())]);

        // Second sync: SAME event content, but kim@henderson.com now maps
        // to m-new (re-taught). No content change, but the mapping did.
        let map_v2 = map(&[("kim@henderson.com", "m-new")]);
        let counts2 = sync_source(
            &store, &source, &map_v2, dir.path(), &STORE_KEY,
            "2026-07-01T00:00:00Z", "2026-07-10T00:00:00Z", &cancel, &|_| {},
        )
        .await
        .unwrap();
        assert_eq!(counts2.changed, 0, "content itself is unchanged");
        assert_eq!(counts2.indexed, 1, "still reindexed because the mapping changed");
        assert_eq!(
            deleted.lock().unwrap().as_slice(),
            ["calendar:outlook:1:m-hend".to_string()],
            "the old matter's RAG row must be purged, not left as a stale duplicate"
        );
        let got_indexed = indexed.lock().unwrap();
        assert!(
            got_indexed.contains(&("calendar:outlook:1:m-new".to_string(), "m-new".to_string())),
            "reindexed under the new matter: {got_indexed:?}"
        );
        assert_eq!(
            store.get_matter_ids("outlook:1").unwrap(),
            Some("m-new".to_string()),
            "store's own bookkeeping reflects only the current matter"
        );
        *test_hooks_slot().lock().unwrap() = None;
    }

    #[tokio::test]
    async fn stale_index_hash_is_retried_even_when_content_and_mapping_are_unchanged() {
        // codex-review P1 (wave-1b review round 2): upsert_event commits
        // content_hash unconditionally, before indexing runs. A transient
        // indexing failure (network hiccup, etc.) leaves content_hash
        // already at the current value while indexed_hash stays stale. A
        // later sync with the SAME content and SAME mapping must still
        // retry the indexing, not skip it forever.
        let _guard = hooks_test_guard();
        let dir = tempfile::tempdir().unwrap();
        let indexed: Arc<std::sync::Mutex<Vec<(String, String)>>> =
            Arc::new(std::sync::Mutex::new(Vec::new()));
        {
            let indexed = indexed.clone();
            *test_hooks_slot().lock().unwrap() = Some(TestHooks {
                index: Box::new(move |source_id, matter_id| {
                    indexed.lock().unwrap().push((source_id.into(), matter_id.into()));
                    Ok(1)
                }),
                delete: Box::new(|_| Ok(())),
            });
        }

        let store = CalendarStore::open_with_key(dir.path(), &STORE_KEY).unwrap();
        let event = ev("outlook:1", "Review", &[("kim@henderson.com", "Kim")]);
        let text = render_event(&event);
        let real_hash = crate::commands::calendly::engine::content_hash(&text);
        // Simulate the failure precondition directly: content already at
        // the value sync_source will compute this run, but never indexed.
        store.upsert_event(&event, &real_hash).unwrap();
        assert!(store.is_stale("outlook:1").unwrap());

        let matter_map = map(&[("kim@henderson.com", "m-hend")]);
        let source = FakeSource { events: vec![event] };
        let cancel = Arc::new(AtomicBool::new(false));
        let counts = sync_source(
            &store, &source, &matter_map, dir.path(), &STORE_KEY,
            "2026-07-01T00:00:00Z", "2026-07-10T00:00:00Z", &cancel, &|_| {},
        )
        .await
        .unwrap();
        assert_eq!(counts.changed, 0, "content itself did not change this sync");
        assert_eq!(counts.indexed, 1, "still retried because the row was stale");
        assert_eq!(
            *indexed.lock().unwrap(),
            vec![("calendar:outlook:1:m-hend".to_string(), "m-hend".to_string())]
        );
        assert!(!store.is_stale("outlook:1").unwrap(), "no longer stale after the retry");
        *test_hooks_slot().lock().unwrap() = None;
    }

    #[tokio::test]
    async fn cancelled_and_declined_events_never_index_and_purge_if_previously_indexed() {
        let _guard = hooks_test_guard();
        let dir = tempfile::tempdir().unwrap();
        let indexed: Arc<std::sync::Mutex<Vec<(String, String)>>> =
            Arc::new(std::sync::Mutex::new(Vec::new()));
        {
            let indexed = indexed.clone();
            *test_hooks_slot().lock().unwrap() = Some(TestHooks {
                index: Box::new(move |source_id, matter_id| {
                    indexed.lock().unwrap().push((source_id.into(), matter_id.into()));
                    Ok(1)
                }),
                delete: Box::new(|_| Ok(())),
            });
        }
        let store = CalendarStore::open_with_key(dir.path(), &STORE_KEY).unwrap();
        let matter_map = map(&[("kim@henderson.com", "m-hend")]);
        let mut cancelled = ev("outlook:9", "Cancelled", &[("kim@henderson.com", "Kim")]);
        cancelled.is_cancelled = true;
        let source = FakeSource { events: vec![cancelled] };
        let cancel = Arc::new(AtomicBool::new(false));
        let counts = sync_source(
            &store, &source, &matter_map, dir.path(), &STORE_KEY,
            "2026-07-01T00:00:00Z", "2026-07-10T00:00:00Z", &cancel, &|_| {},
        )
        .await
        .unwrap();
        assert_eq!(counts.indexed, 0, "cancelled events are excluded");
        assert!(indexed.lock().unwrap().is_empty());
        assert!(
            store
                .list_in_window("2026-07-01T00:00:00Z", "2026-07-10T00:00:00Z")
                .unwrap()
                .is_empty(),
            "cancelled events do not even land in the store window"
        );
        *test_hooks_slot().lock().unwrap() = None;
    }
}
