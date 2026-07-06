use arrow_array::RecordBatchIterator;
use lantern_lib::commands::onedrive::commands::{onedrive_disconnect_logic, OneDriveState};
use lantern_lib::commands::onedrive::store::OneDriveStore;
use lantern_lib::commands::rag::chunker::chunk_text;
use lantern_lib::commands::rag::embedder::EMBEDDING_DIM;
use lantern_lib::commands::rag::store::{self, PRIVILEGE_NONE};
use std::sync::atomic::{AtomicBool, AtomicU32};
use std::sync::Arc;

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
    let result = onedrive_disconnect_logic(&state).await;

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
    let result = onedrive_disconnect_logic(&state).await;

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
