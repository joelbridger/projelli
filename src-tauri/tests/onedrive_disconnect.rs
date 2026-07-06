use arrow_array::RecordBatchIterator;
use lantern_lib::commands::onedrive::commands::{
    onedrive_disconnect_logic, onedrive_disconnect_logic_with, OneDriveState,
};
use lantern_lib::commands::onedrive::store::OneDriveStore;
use lantern_lib::commands::rag::chunker::chunk_text;
use lantern_lib::commands::rag::embedder::EMBEDDING_DIM;
use lantern_lib::commands::rag::store::{self, PRIVILEGE_NONE};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

const VEC_KEY: [u8; 32] = [0x7Cu8; 32];
const ONEDRIVE_DB_KEY: [u8; 32] = [0x2Du8; 32];
const ONEDRIVE_MATTER: &str = "matter-acme-onedrive";
const FIXTURE_TEXT: &str = "\
Client intake memo: Acme Holdings — quarterly review notes, imported from a \
OneDrive folder named after the client.\
";

async fn index_onedrive_entry(table: &lancedb::Table, source_id: &str, text: &str, matter_id: &str) {
    let chunks = chunk_text(source_id, text);
    assert!(!chunks.is_empty(), "fixture text should produce at least one chunk");
    let rows: Vec<_> = chunks
        .into_iter()
        .map(|chunk| (chunk, vec![0.3f32; EMBEDDING_DIM]))
        .collect();
    let batch = store::build_batch_external(&rows, &VEC_KEY, matter_id, PRIVILEGE_NONE, "onedrive")
        .expect("build onedrive external batch");
    let schema = batch.schema();
    table
        .add(Box::new(RecordBatchIterator::new(vec![Ok(batch)], schema)))
        .execute()
        .await
        .expect("add fixture onedrive chunk");
}

fn make_state(ws: Option<std::path::PathBuf>) -> OneDriveState {
    OneDriveState {
        workspace: tokio::sync::Mutex::new(ws),
        is_syncing: Arc::new(AtomicBool::new(false)),
        cancel: Arc::new(AtomicBool::new(false)),
        progress_seen: Arc::new(AtomicU32::new(0)),
        last_report: tokio::sync::Mutex::new(None),
        oauth_cancel: Arc::new(AtomicBool::new(false)),
    }
}

/// Regression test for the disconnect-ordering bug (connect-flow adversarial
/// review, finding 5): `onedrive_disconnect_logic` must purge local data
/// (RAG chunks + the sync-state DB) BEFORE it reports the token as removed,
/// and must report `data_remains = true` (never silently drop data) when a
/// workspace is genuinely unavailable. This mirrors `crm_disconnect_logic`'s
/// contract, verified by `crm_fixture_import.rs`.
#[tokio::test]
async fn disconnect_purges_local_data_and_reports_an_honest_result() {
    // ── 1: Seed a workspace with an indexed OneDrive RAG chunk ───────────────
    let workspace = tempfile::tempdir().expect("workspace tempdir");
    let ws = workspace.path().to_path_buf();

    let conn = store::open_connection(&ws).await.expect("open vector store");
    let table = store::open_or_create_table(&conn)
        .await
        .expect("open chunks table");
    index_onedrive_entry(&table, "onedrive:drive-demo:item-intake-memo", FIXTURE_TEXT, ONEDRIVE_MATTER).await;

    // Seed the local OneDrive sync-state DB too, so we can assert the whole
    // file is gone after disconnect (mirrors OneDriveStore::purge's contract).
    // The headless test runner has no usable OS keychain (DBus collection is
    // locked), so open with an explicit key instead of `open()` — mirrors
    // `CrmStore::open_with_key` in crm_fixture_import.rs. Disconnect itself
    // never needs to decrypt this DB (it only deletes the file), so no
    // keychain override env var is needed for the disconnect call itself.
    {
        let _onedrive_db =
            OneDriveStore::open_with_key(&ws, &ONEDRIVE_DB_KEY).expect("open onedrive store");
    }
    let db_path = OneDriveStore::db_path(&ws);
    assert!(db_path.exists(), "onedrive sync-state db should exist before disconnect");

    // Confirm the RAG chunk is present before disconnect.
    let hits_before = store::nearest(&table, &vec![0.3f32; EMBEDDING_DIM], 20, Some(ONEDRIVE_MATTER), false, &[])
        .await
        .expect("nearest before disconnect");
    assert!(
        hits_before.iter().any(|h| h.source_type.as_deref() == Some("onedrive")),
        "at least one onedrive rag chunk must exist before disconnect"
    );

    // ── 2: Drive the REAL disconnect path with a workspace open ──────────────
    let state = make_state(Some(ws.clone()));
    let result = onedrive_disconnect_logic(&state, false).await;

    // token_deleted may be false in a headless CI environment with no usable
    // keychain — that is expected and acceptable; we only assert on the DATA
    // purge (the actual bug) to keep the test portable.
    assert!(
        result.rag_purged,
        "onedrive_disconnect_logic must set rag_purged=true; warnings: {:?}",
        result.warnings
    );
    assert!(
        result.local_data_purged,
        "onedrive_disconnect_logic must set local_data_purged=true; warnings: {:?}",
        result.warnings
    );
    assert!(
        !result.data_remains,
        "a fully successful purge must not report data_remains; warnings: {:?}",
        result.warnings
    );

    // ── 3: Assert the sync-state DB file is gone ─────────────────────────────
    assert!(
        !db_path.exists(),
        "onedrive sync-state db file should be deleted after disconnect"
    );

    // ── 4: Assert zero source_type='onedrive' RAG chunks remain ─────────────
    let conn2 = store::open_connection(&ws)
        .await
        .expect("reopen vector store after disconnect");
    let table2 = store::open_or_create_table(&conn2)
        .await
        .expect("reopen chunks table after disconnect");
    let hits_after = store::nearest(&table2, &vec![0.3f32; EMBEDDING_DIM], 20, Some(ONEDRIVE_MATTER), false, &[])
        .await
        .expect("nearest after disconnect");
    let remaining_onedrive = hits_after
        .iter()
        .filter(|h| h.source_type.as_deref() == Some("onedrive"))
        .count();
    assert!(
        remaining_onedrive == 0,
        "no onedrive chunks should survive disconnect; got {remaining_onedrive} remaining"
    );
}

/// The ordering bug specifically: with NO workspace open, disconnect must
/// KEEP the connection (report `data_remains = true`) rather than silently
/// reporting success while there is nowhere to purge local data from — the
/// previous implementation deleted the token unconditionally in this case.
#[tokio::test]
async fn disconnect_without_a_workspace_keeps_the_connection_and_flags_data_remains() {
    let state = make_state(None);
    let result = onedrive_disconnect_logic(&state, false).await;

    assert!(
        result.data_remains,
        "disconnecting with no workspace open must report data_remains=true"
    );
    assert!(
        !result.token_deleted,
        "disconnecting with no workspace open must NOT remove the token"
    );
    assert!(
        !result.warnings.is_empty(),
        "disconnecting with no workspace open must explain why in warnings"
    );
}

// ── F1: opt-in delete of materialized files ──────────────────────────────────

const MEMO_REL: &str = "Clients/Acme/memo.docx";

/// Open the store and seed one materialized (mapped-to-a-client) row with a real
/// on-disk file at `MEMO_REL`. Returns the absolute file path.
fn seed_materialized_file(ws: &std::path::Path) -> std::path::PathBuf {
    let abs = ws.join(MEMO_REL);
    std::fs::create_dir_all(abs.parent().unwrap()).unwrap();
    std::fs::write(&abs, b"imported client document bytes").unwrap();
    let store = OneDriveStore::open_with_key(ws, &ONEDRIVE_DB_KEY).unwrap();
    store
        .upsert_item(
            "onedrive:d:memo", "d", None, "memo", "memo.docx", "/clients/acme", None, "sig",
            "hash", ONEDRIVE_MATTER, true, false,
        )
        .unwrap();
    store.set_local_path("onedrive:d:memo", MEMO_REL).unwrap();
    abs
}

fn open_with_test_key(ws: &std::path::Path) -> anyhow::Result<OneDriveStore> {
    OneDriveStore::open_with_key(ws, &ONEDRIVE_DB_KEY)
}

/// F1: with `delete_files = true`, the materialized files in the client folders
/// are actually deleted, and a clean disconnect reports no remaining data.
#[tokio::test]
async fn opt_in_delete_removes_the_materialized_files() {
    let workspace = tempfile::tempdir().unwrap();
    let ws = workspace.path().to_path_buf();
    let abs = seed_materialized_file(&ws);
    assert!(abs.exists(), "seeded file should exist before disconnect");

    let state = make_state(Some(ws.clone()));
    let result = onedrive_disconnect_logic_with(
        &state,
        true,
        open_with_test_key,
        Duration::from_secs(15),
    )
    .await;

    assert!(
        !abs.exists(),
        "opt-in delete must remove the imported file from the client folder"
    );
    assert!(
        !result.data_remains,
        "a clean opt-in delete must not report data_remains; warnings: {:?}",
        result.warnings
    );
    assert!(
        !OneDriveStore::db_path(&ws).exists(),
        "the tracking DB must be purged after a clean disconnect"
    );
}

/// F1: with `delete_files = false` (the default), the materialized files STAY on
/// disk — they are the user's documents now — but the connection + search index
/// are still removed, and keeping the files is NOT reported as a failure.
#[tokio::test]
async fn opt_out_keeps_the_materialized_files_but_still_removes_the_connection() {
    let workspace = tempfile::tempdir().unwrap();
    let ws = workspace.path().to_path_buf();
    let abs = seed_materialized_file(&ws);

    let state = make_state(Some(ws.clone()));
    let result = onedrive_disconnect_logic_with(
        &state,
        false,
        open_with_test_key,
        Duration::from_secs(15),
    )
    .await;

    assert!(
        abs.exists(),
        "without opt-in, imported files must STAY on disk (they are the user's documents now)"
    );
    assert!(
        !result.data_remains,
        "keeping the imported files is not a failure; warnings: {:?}",
        result.warnings
    );
    assert!(
        result.rag_purged && result.local_data_purged,
        "the connection + search index are still removed even when files are kept; warnings: {:?}",
        result.warnings
    );
}

/// F1: if a materialized file can't be deleted, disconnect keeps BOTH the token
/// and the tracking DB (the only record of the paths) so the "Finish deleting
/// local data" retry can re-enumerate and finish — and reports data_remains.
#[tokio::test]
async fn opt_in_delete_failure_keeps_token_and_db_for_retry() {
    let workspace = tempfile::tempdir().unwrap();
    let ws = workspace.path().to_path_buf();
    // local_path points at a DIRECTORY, which `remove_file` cannot delete —
    // a portable way to force a non-NotFound delete failure.
    let rel = "Clients/Acme/stubborn";
    let abs = ws.join(rel);
    std::fs::create_dir_all(&abs).unwrap();
    {
        let store = OneDriveStore::open_with_key(&ws, &ONEDRIVE_DB_KEY).unwrap();
        store
            .upsert_item(
                "onedrive:d:stub", "d", None, "stub", "stubborn", "/clients/acme", None, "sig",
                "hash", ONEDRIVE_MATTER, true, false,
            )
            .unwrap();
        store.set_local_path("onedrive:d:stub", rel).unwrap();
    }
    let db_path = OneDriveStore::db_path(&ws);

    let state = make_state(Some(ws.clone()));
    let result = onedrive_disconnect_logic_with(
        &state,
        true,
        open_with_test_key,
        Duration::from_secs(15),
    )
    .await;

    assert!(
        result.data_remains,
        "a file that could not be deleted must flag data_remains"
    );
    assert!(
        !result.token_deleted,
        "the token must be kept on delete failure so the retry can finish"
    );
    assert!(
        db_path.exists(),
        "the tracking DB must be kept on delete failure so the retry can re-enumerate the paths"
    );
    assert!(
        result.warnings.iter().any(|w| w.contains("could not be deleted")),
        "the warning must explain the delete failure; got {:?}",
        result.warnings
    );
}

// ── F2: disconnect must not race an in-flight sync ───────────────────────────

/// F2: disconnect sets cancel, then WAITS for the in-flight sync to actually
/// stop before purging. Here the sync commits a materialized file+row AFTER
/// disconnect has already started (the exact mid-flight write the race allowed);
/// because disconnect waits, the opt-in delete still finds and removes that file
/// instead of the write landing after the purge and reappearing on disk.
#[tokio::test]
async fn disconnect_waits_for_an_in_flight_sync_then_deletes_the_file_it_just_wrote() {
    let workspace = tempfile::tempdir().unwrap();
    let ws = workspace.path().to_path_buf();
    // Fresh store, no materialized rows yet — the "sync" writes one below.
    {
        OneDriveStore::open_with_key(&ws, &ONEDRIVE_DB_KEY).unwrap();
    }

    let state = make_state(Some(ws.clone()));
    state.is_syncing.store(true, Ordering::SeqCst);

    let ws_task = ws.clone();
    let syncing = state.is_syncing.clone();
    let writer = tokio::spawn(async move {
        // Simulate the engine still finishing the current file well after
        // disconnect has flipped cancel.
        tokio::time::sleep(Duration::from_millis(200)).await;
        let abs = ws_task.join(MEMO_REL);
        std::fs::create_dir_all(abs.parent().unwrap()).unwrap();
        std::fs::write(&abs, b"a write that lands mid-disconnect").unwrap();
        let store = OneDriveStore::open_with_key(&ws_task, &ONEDRIVE_DB_KEY).unwrap();
        store
            .upsert_item(
                "onedrive:d:memo", "d", None, "memo", "memo.docx", "/clients/acme", None, "sig",
                "hash", ONEDRIVE_MATTER, true, false,
            )
            .unwrap();
        store.set_local_path("onedrive:d:memo", MEMO_REL).unwrap();
        drop(store);
        // The write is fully committed; only NOW does the sync actually stop.
        syncing.store(false, Ordering::SeqCst);
    });

    let start = Instant::now();
    let result = onedrive_disconnect_logic_with(
        &state,
        true,
        open_with_test_key,
        Duration::from_secs(15),
    )
    .await;
    writer.await.unwrap();

    assert!(
        start.elapsed() >= Duration::from_millis(180),
        "disconnect must wait for the in-flight sync to stop before purging"
    );
    assert!(
        !ws.join(MEMO_REL).exists(),
        "the file the sync wrote mid-flight must be deleted, not left behind after the purge"
    );
    assert!(
        !result.data_remains,
        "with the file deleted and DB purged, no data should remain; warnings: {:?}",
        result.warnings
    );
    assert!(
        !OneDriveStore::db_path(&ws).exists(),
        "the tracking DB must be purged once the sync has stopped"
    );
}

/// F2: if a sync never stops, disconnect times out, keeps the token, keeps the
/// tracking DB (never purges while a sync could still write), and reports
/// data_remains with an honest warning — so the retry works.
#[tokio::test]
async fn disconnect_times_out_when_a_sync_never_stops_and_keeps_everything() {
    let workspace = tempfile::tempdir().unwrap();
    let ws = workspace.path().to_path_buf();
    {
        OneDriveStore::open_with_key(&ws, &ONEDRIVE_DB_KEY).unwrap();
    }
    let db_path = OneDriveStore::db_path(&ws);
    assert!(db_path.exists());

    let state = make_state(Some(ws.clone()));
    // A sync that is running and never clears the flag.
    state.is_syncing.store(true, Ordering::SeqCst);

    let result = onedrive_disconnect_logic_with(
        &state,
        false,
        open_with_test_key,
        Duration::from_millis(200), // short bound so the test is fast
    )
    .await;

    assert!(
        result.data_remains,
        "a sync that never stops must make disconnect report data_remains=true"
    );
    assert!(
        !result.token_deleted,
        "the token must be kept when disconnect times out waiting for a sync"
    );
    assert!(
        db_path.exists(),
        "the tracking DB must NOT be purged while a sync could still be writing"
    );
    assert!(
        result.warnings.iter().any(|w| w.contains("still stopping")),
        "the warning must explain the sync was still stopping; got {:?}",
        result.warnings
    );
}
