use arrow_array::RecordBatchIterator;
use lantern_lib::commands::rag::chunker::chunk_text;
use lantern_lib::commands::rag::embedder::EMBEDDING_DIM;
use lantern_lib::commands::rag::store::{self, PRIVILEGE_NONE};

const VEC_KEY: [u8; 32] = [0x5Au8; 32];
const CRM_MATTER: &str = "matter-northcrest-advisory";

/// A realistic household brief that will produce at least one chunk.
const FIXTURE_BRIEF: &str = "\
Household: Thompson, Robert & Linda
Relationship manager: Sarah Chen
Net worth (est.): $4.2M — primarily concentrated in MSFT RSUs and a rental \
property in Denver, CO.
Risk profile: Moderate-growth; 60/40 target allocation.
Next review: Q3 2026. Open action: consolidate inherited IRA from Linda's mother \
into the existing rollover IRA before year-end to simplify RMD tracking.\
";

async fn index_crm_entry(table: &lancedb::Table, source_id: &str, text: &str, matter_id: &str) {
    let chunks = chunk_text(source_id, text);
    assert!(
        !chunks.is_empty(),
        "fixture crm brief should produce at least one chunk"
    );
    let rows: Vec<_> = chunks
        .into_iter()
        .map(|chunk| (chunk, vec![0.1f32; EMBEDDING_DIM]))
        .collect();
    let batch = store::build_batch_crm(&rows, &VEC_KEY, matter_id, PRIVILEGE_NONE)
        .expect("build crm batch");
    let schema = batch.schema();
    table
        .add(Box::new(RecordBatchIterator::new(vec![Ok(batch)], schema)))
        .execute()
        .await
        .expect("add fixture crm chunk");
}

fn decrypted_hit_path(hit: &store::StoredHit) -> String {
    let path_enc = hit
        .path_enc
        .as_deref()
        .expect("crm hit should carry path_enc");
    let blob = hex::decode(path_enc).expect("path_enc should be hex");
    String::from_utf8(
        lantern_lib::commands::mail::crypto::decrypt_with_key(&blob, &VEC_KEY)
            .expect("decrypt path_enc"),
    )
    .expect("path_enc should decrypt to UTF-8")
}

fn decrypted_hit_text(hit: &store::StoredHit) -> String {
    let blob = hex::decode(&hit.text).expect("crm hit text should be hex ciphertext");
    String::from_utf8(
        lantern_lib::commands::mail::crypto::decrypt_with_key(&blob, &VEC_KEY)
            .expect("decrypt hit text"),
    )
    .expect("hit text should decrypt to UTF-8")
}

#[tokio::test]
async fn fixture_crm_chunk_round_trips_encrypted_and_is_retrievable() {
    let workspace = tempfile::tempdir().expect("workspace tempdir");
    let conn = store::open_connection(workspace.path())
        .await
        .expect("open vector store");
    let table = store::open_or_create_table(&conn)
        .await
        .expect("open chunks table");

    let source_id = "crm:household:demo-1";

    index_crm_entry(&table, source_id, FIXTURE_BRIEF, CRM_MATTER).await;

    let hits = store::nearest(
        &table,
        &vec![0.1f32; EMBEDDING_DIM],
        5,
        Some(CRM_MATTER),
        false,
        &[],
    )
    .await
    .expect("vector search");

    let crm_hit = hits
        .iter()
        .find(|hit| decrypted_hit_path(hit) == source_id)
        .expect("vector search should surface the imported crm chunk");

    assert_eq!(
        crm_hit.source_type.as_deref(),
        Some("crm"),
        "source_type column must be 'crm'"
    );
    assert_eq!(
        crm_hit.matter_id.as_deref(),
        Some(CRM_MATTER),
        "matter_id must match the indexed matter"
    );

    let decrypted = decrypted_hit_text(crm_hit);
    assert!(
        decrypted.contains("Thompson") || decrypted.contains("4.2M") || decrypted.contains("IRA"),
        "decrypted hit text should contain content from the fixture brief; got: {decrypted:?}"
    );
}

/// `delete_source_type("crm")` removes all crm chunks from the RAG store.
///
/// Indexes two CRM chunks under the same matter, calls `delete_source_type`,
/// then confirms neither survives a vector search in that matter scope.
#[tokio::test]
async fn delete_source_type_removes_all_crm_chunks() {
    use lantern_lib::commands::rag::embedder::EMBEDDING_DIM;
    use lantern_lib::commands::rag::store;

    let workspace = tempfile::tempdir().expect("workspace tempdir");
    let conn = store::open_connection(workspace.path())
        .await
        .expect("open vector store");
    let table = store::open_or_create_table(&conn)
        .await
        .expect("open chunks table");

    // Index two distinct CRM entries (source_type = "crm" for both).
    index_crm_entry(&table, "crm:household:2001", FIXTURE_BRIEF, CRM_MATTER).await;
    index_crm_entry(&table, "crm:household:2002", FIXTURE_BRIEF, CRM_MATTER).await;

    // Confirm chunks are present before the delete.
    let hits_before = store::nearest(
        &table,
        &vec![0.1f32; EMBEDDING_DIM],
        20,
        Some(CRM_MATTER),
        false,
        &[],
    )
    .await
    .expect("nearest before delete_source_type");
    assert!(
        hits_before
            .iter()
            .any(|h| h.source_type.as_deref() == Some("crm")),
        "at least one crm chunk should be present before delete_source_type"
    );

    // Purge all crm chunks.
    store::delete_source_type(&table, "crm")
        .await
        .expect("delete_source_type(\"crm\") should succeed");

    // Confirm no crm chunks remain.
    let hits_after = store::nearest(
        &table,
        &vec![0.1f32; EMBEDDING_DIM],
        20,
        Some(CRM_MATTER),
        false,
        &[],
    )
    .await
    .expect("nearest after delete_source_type");
    assert!(
        !hits_after
            .iter()
            .any(|h| h.source_type.as_deref() == Some("crm")),
        "no crm chunks should survive delete_source_type; got {} hits",
        hits_after.len()
    );
}

/// True end-to-end purge exercising the REAL `crm_disconnect_logic` path.
///
/// This test catches wiring regressions — e.g. disconnect not reading the
/// workspace from `CrmState`, or the purge helpers not being called — that
/// direct low-level helper calls would miss.
///
/// Steps:
/// 1. Constructs a `CrmState` with the temp workspace set directly on it
///    (equivalent to what `crm_set_workspace` does at runtime).
/// 2. Seeds the CRM DB via `CrmStore::open_with_key` + `upsert_object`.
/// 3. Seeds `source_type='crm'` RAG chunks via `build_batch_crm`.
/// 4. Calls `crm_disconnect_logic(&state)` — the same code path the Tauri
///    command runs — NOT the raw helpers directly.
/// 5. Asserts `result.rag_purged == true` and `result.crm_db_purged == true`.
///    (`result.token_deleted` may be false in a headless CI environment with
///    no working keychain — that is expected; we assert on the DATA purge.)
/// 6. Asserts the CRM store is empty (re-opening after purge yields no rows).
/// 7. Asserts the RAG store has zero `source_type='crm'` chunks.
#[tokio::test]
async fn crm_purge_e2e_removes_both_db_rows_and_rag_chunks() {
    use arrow_array::RecordBatchIterator;
    use lantern_lib::commands::crm::commands::{crm_disconnect_logic, CrmState};
    use lantern_lib::commands::crm::store::CrmStore;
    use lantern_lib::commands::rag::chunker::chunk_text;
    use lantern_lib::commands::rag::embedder::EMBEDDING_DIM;
    use lantern_lib::commands::rag::store::{self, build_batch_crm, PRIVILEGE_NONE};
    use std::sync::atomic::AtomicBool;
    use std::sync::Arc;

    const E2E_MATTER: &str = "matter-e2e-purge";
    // Deterministic literal key for the CRM store — bypasses the OS keychain.
    const CRM_KEY: [u8; 32] = [0xAAu8; 32];

    let workspace = tempfile::tempdir().expect("workspace tempdir");
    let ws = workspace.path().to_path_buf();

    // ── 1: Construct CrmState with workspace pre-set ─────────────────────────
    // Setting workspace.lock() directly is equivalent to what crm_set_workspace
    // does at runtime: `*state.workspace.lock().await = Some(PathBuf::from(path))`.
    let state = CrmState {
        workspace: tokio::sync::Mutex::new(Some(ws.clone())),
        is_syncing: Arc::new(AtomicBool::new(false)),
        cancel: Arc::new(AtomicBool::new(false)),
        last_report: tokio::sync::Mutex::new(None),
        progress_households: Arc::new(std::sync::atomic::AtomicU32::new(0)),
        oauth_cancel: Arc::new(AtomicBool::new(false)),
    };

    // ── 2: Seed the CRM DB rows ───────────────────────────────────────────────
    {
        let crm = CrmStore::open_with_key(&ws, &CRM_KEY).expect("open crm store");
        crm.upsert_object(
            "household:7001",
            "household",
            "7001",
            "2026-06-01T00:00:00Z",
            "hash-h7001",
            r#"{"id":7001,"company_name":"Purge Test Family"}"#,
        )
        .expect("upsert household");
        crm.upsert_object(
            "contact:7002",
            "contact",
            "7001",
            "2026-06-01T00:00:00Z",
            "hash-c7002",
            r#"{"id":7002,"first_name":"Alice","last_name":"Purge"}"#,
        )
        .expect("upsert contact");

        // Confirm rows are present before the disconnect call.
        let hids = crm.list_household_ids().expect("list_household_ids");
        assert_eq!(
            hids.len(),
            1,
            "one household id must exist before disconnect"
        );
    } // CrmStore dropped — connection closed.

    // ── 3: Seed RAG chunks with source_type='crm' ────────────────────────────
    let conn = store::open_connection(&ws)
        .await
        .expect("open vector store");
    let table = store::open_or_create_table(&conn)
        .await
        .expect("open chunks table");

    let chunks = chunk_text("crm:household:7001", FIXTURE_BRIEF);
    assert!(
        !chunks.is_empty(),
        "fixture must produce at least one chunk"
    );
    let rows: Vec<_> = chunks
        .into_iter()
        .map(|c| (c, vec![0.2f32; EMBEDDING_DIM]))
        .collect();
    let batch =
        build_batch_crm(&rows, &VEC_KEY, E2E_MATTER, PRIVILEGE_NONE).expect("build crm batch");
    let schema = batch.schema();
    table
        .add(Box::new(RecordBatchIterator::new(vec![Ok(batch)], schema)))
        .execute()
        .await
        .expect("add rag chunks");

    // Confirm RAG chunks are present before the disconnect call.
    let hits_before = store::nearest(
        &table,
        &vec![0.2f32; EMBEDDING_DIM],
        20,
        Some(E2E_MATTER),
        false,
        &[],
    )
    .await
    .expect("nearest before disconnect");
    assert!(
        hits_before
            .iter()
            .any(|h| h.source_type.as_deref() == Some("crm")),
        "at least one crm rag chunk must exist before disconnect"
    );

    // ── 4: Drive the REAL disconnect path ────────────────────────────────────
    // crm_disconnect_logic reads the workspace from CrmState, purges the RAG
    // store and the CRM DB, and emits the durable audit — exactly what the
    // Tauri `crm_disconnect` command calls.  A wiring regression (e.g. the
    // workspace not being read, or a purge step not being called) is caught here.
    // The headless test runner has no OS keychain, so the production key loader
    // reads this test-only override and opens the same DB key seeded above.
    std::env::set_var(
        "KEEPANCE_HEADLESS_TEST_CRM_MASTER_KEY_HEX",
        hex::encode(CRM_KEY),
    );
    std::env::set_var(
        "KEEPANCE_HEADLESS_TEST_VECTORS_MASTER_KEY_HEX",
        hex::encode(VEC_KEY),
    );
    let result = crm_disconnect_logic(&state).await;
    std::env::remove_var("KEEPANCE_HEADLESS_TEST_CRM_MASTER_KEY_HEX");
    std::env::remove_var("KEEPANCE_HEADLESS_TEST_VECTORS_MASTER_KEY_HEX");

    // ── 5: Assert purge flags ─────────────────────────────────────────────────
    // token_deleted may be false in a headless CI environment with no usable
    // keychain — that is expected and acceptable; we only assert on the DATA
    // purge to keep the test portable.
    assert!(
        result.rag_purged,
        "crm_disconnect_logic must set rag_purged=true; warnings: {:?}",
        result.warnings
    );
    assert!(
        result.crm_db_purged,
        "crm_disconnect_logic must set crm_db_purged=true; warnings: {:?}",
        result.warnings
    );

    // ── 6: Assert CRM DB is empty ─────────────────────────────────────────────
    // purge() deletes the DB file; re-opening creates a fresh empty store.
    let crm_after = CrmStore::open_with_key(&ws, &CRM_KEY).expect("reopen crm after disconnect");
    let hids_after = crm_after
        .list_household_ids()
        .expect("list_household_ids after disconnect");
    assert!(
        hids_after.is_empty(),
        "no households should remain in CrmStore after disconnect; got: {hids_after:?}"
    );

    // ── 7: Assert zero source_type='crm' RAG chunks remain ───────────────────
    // Re-open the connection + table after disconnect so we get a fresh view of
    // the Lance file — the disconnect logic opens its own internal connection
    // when it deletes, so querying the old handle would see a stale snapshot.
    let conn2 = store::open_connection(&ws)
        .await
        .expect("reopen vector store after disconnect");
    let table2 = store::open_or_create_table(&conn2)
        .await
        .expect("reopen chunks table after disconnect");
    let hits_after = store::nearest(
        &table2,
        &vec![0.2f32; EMBEDDING_DIM],
        20,
        Some(E2E_MATTER),
        false,
        &[],
    )
    .await
    .expect("nearest after disconnect");
    let remaining_crm = hits_after
        .iter()
        .filter(|h| h.source_type.as_deref() == Some("crm"))
        .count();
    assert!(
        remaining_crm == 0,
        "no crm chunks should survive disconnect; got {remaining_crm} remaining"
    );
}
