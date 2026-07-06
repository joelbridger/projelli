//! polish-1 item 3: calendar_disconnect must not report success (nor delete
//! the local rows or credential) when the RAG/vector-store purge fails.
//! True end-to-end tests against a real temp workspace + real LanceDB
//! dataset dir, mirroring the crm_purge_e2e_* precedent in
//! crm_fixture_import.rs — but for the FAILURE path, which had no coverage
//! anywhere in this codebase before this ticket.

use lantern_lib::commands::calendar::commands::{calendar_disconnect_inner, CalendarState};
use lantern_lib::commands::calendar::model::{CalendarEvent, CalendarProvider};
use lantern_lib::commands::calendar::store::CalendarStore;
use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicU32};
use std::sync::Arc;

fn test_state(ws: std::path::PathBuf) -> CalendarState {
    CalendarState {
        workspace: tokio::sync::Mutex::new(Some(ws)),
        is_syncing: Arc::new(AtomicBool::new(false)),
        cancel: Arc::new(AtomicBool::new(false)),
        oauth_cancel: Arc::new(AtomicBool::new(false)),
        last_report: tokio::sync::Mutex::new(None),
        progress_events: Arc::new(AtomicU32::new(0)),
    }
}

/// Headless-test override for the calendar SQLCipher master key (see
/// calendar/store.rs's `calendar_master_key`) — `CalendarStore::open` is the
/// first thing `calendar_disconnect_inner` does, and without this override
/// it hits a real OS keychain read that blocks indefinitely in a sandbox
/// with no Secret Service/D-Bus backend, rather than failing fast.
fn calendar_test_key_hex() -> String {
    "33".repeat(32)
}

/// Both tests below mutate the same two process-global env vars; Rust's
/// default test runner executes tests in this binary on separate threads
/// concurrently, so without serializing them one test's env var could leak
/// into the other mid-run. Held for each test's full body.
static ENV_GUARD: std::sync::Mutex<()> = std::sync::Mutex::new(());

/// Seed one Outlook event, indexed under one matter, so
/// `list_indexed_rag_source_ids()` returns exactly one row scoped to the
/// "outlook" provider prefix `calendar_disconnect_inner` filters on.
fn seed_indexed_event(ws: &Path, event_id: &str, matter: &str) {
    let store = CalendarStore::open(ws).expect("open calendar store");
    let event = CalendarEvent {
        id: event_id.to_string(),
        provider: CalendarProvider::Outlook,
        title: "Henderson check-in".to_string(),
        description: String::new(),
        start_utc: "2026-07-02T16:00:00Z".to_string(),
        end_utc: "2026-07-02T17:00:00Z".to_string(),
        attendees: vec![],
        organizer_email: "adv@firm.com".to_string(),
        is_cancelled: false,
        self_declined: false,
        join_url: None,
    };
    store.upsert_event(&event, "hash1").expect("upsert event");
    store
        .mark_indexed(event_id, "hash1", matter)
        .expect("mark indexed");
}

/// NOTE (sandbox limitation): the disconnect's LATER steps — deleting the
/// provider's own credential, and reading the other two providers' keychain
/// entries to decide whether to purge the whole store — hit the real OS
/// keychain with no headless-test override, which blocks indefinitely in a
/// sandbox with no Secret Service/D-Bus backend rather than failing fast.
/// Both tests below are constructed so `calendar_disconnect_inner` returns
/// (with an Err) INSIDE the purge block, before any of those later steps —
/// exactly the ordering this fix establishes — so they never reach that
/// untestable-here code. A "purge succeeds, so the rest of the disconnect
/// runs" test is not included for the same reason: it cannot complete in
/// this environment without hanging.
#[tokio::test]
async fn purge_failure_from_a_bad_master_key_leaves_local_rows_and_index_untouched() {
    let _guard = ENV_GUARD.lock().unwrap_or_else(|e| e.into_inner());
    std::env::set_var(
        "LANTERN_HEADLESS_TEST_CALENDAR_MASTER_KEY_HEX",
        &calendar_test_key_hex(),
    );
    let workspace = tempfile::tempdir().expect("workspace tempdir");
    let ws = workspace.path().to_path_buf();
    seed_indexed_event(&ws, "outlook:e1", "matter-1");

    // Force rag::crypto::get_or_create_master_key() to fail deterministically:
    // its headless-test override requires exactly 32 bytes of hex.
    std::env::set_var("LANTERN_HEADLESS_TEST_VECTORS_MASTER_KEY_HEX", "00");
    let state = test_state(ws.clone());
    let result = calendar_disconnect_inner(&state, "outlook", "lantern-calendar-ms-test").await;
    std::env::remove_var("LANTERN_HEADLESS_TEST_VECTORS_MASTER_KEY_HEX");

    assert!(
        result.is_err(),
        "a master-key read failure must abort the disconnect, not report success"
    );
    let store = CalendarStore::open(&ws).expect("reopen calendar store");
    let remaining = store
        .list_indexed_rag_source_ids()
        .expect("list indexed rag source ids");
    std::env::remove_var("LANTERN_HEADLESS_TEST_CALENDAR_MASTER_KEY_HEX");
    assert_eq!(
        remaining,
        vec!["calendar:outlook:e1:matter-1".to_string()],
        "the RAG source id must still be listed as indexed — nothing was purged"
    );
}

#[tokio::test]
async fn purge_failure_from_an_unavailable_vector_store_leaves_local_rows_untouched() {
    let _guard = ENV_GUARD.lock().unwrap_or_else(|e| e.into_inner());
    std::env::set_var(
        "LANTERN_HEADLESS_TEST_CALENDAR_MASTER_KEY_HEX",
        &calendar_test_key_hex(),
    );
    let workspace = tempfile::tempdir().expect("workspace tempdir");
    let ws = workspace.path().to_path_buf();
    seed_indexed_event(&ws, "outlook:e2", "matter-2");

    // Block LanceDB from ever creating its dataset directory: put a regular
    // FILE at the exact path open_connection's create_dir_all needs, the
    // same class of real-world failure as a locked/corrupted vector store.
    let dataset_path = lantern_lib::commands::rag::store::dataset_path(&ws);
    std::fs::create_dir_all(dataset_path.parent().expect("dataset path has a parent"))
        .expect("create parent dir");
    std::fs::write(&dataset_path, b"not a directory").expect("write blocking file");

    std::env::set_var("LANTERN_HEADLESS_TEST_VECTORS_MASTER_KEY_HEX", "11".repeat(32));
    let state = test_state(ws.clone());
    let result = calendar_disconnect_inner(&state, "outlook", "lantern-calendar-ms-test").await;
    std::env::remove_var("LANTERN_HEADLESS_TEST_VECTORS_MASTER_KEY_HEX");

    assert!(
        result.is_err(),
        "an unreachable vector store must abort the disconnect, not report success"
    );
    let store = CalendarStore::open(&ws).expect("reopen calendar store");
    let remaining = store
        .list_indexed_rag_source_ids()
        .expect("list indexed rag source ids");
    std::env::remove_var("LANTERN_HEADLESS_TEST_CALENDAR_MASTER_KEY_HEX");
    assert_eq!(
        remaining,
        vec!["calendar:outlook:e2:matter-2".to_string()],
        "the RAG source id must still be listed as indexed — nothing was purged"
    );
}
