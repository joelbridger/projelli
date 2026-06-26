use arrow_array::RecordBatchIterator;
use keepance_lib::commands::rag::chunker::chunk_text;
use keepance_lib::commands::rag::embedder::EMBEDDING_DIM;
use keepance_lib::commands::rag::store::{self, PRIVILEGE_NONE};

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

async fn index_crm_entry(
    table: &lancedb::Table,
    source_id: &str,
    text: &str,
    matter_id: &str,
) {
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
    let path_enc = hit.path_enc.as_deref().expect("crm hit should carry path_enc");
    let blob = hex::decode(path_enc).expect("path_enc should be hex");
    String::from_utf8(
        keepance_lib::commands::mail::crypto::decrypt_with_key(&blob, &VEC_KEY)
            .expect("decrypt path_enc"),
    )
    .expect("path_enc should decrypt to UTF-8")
}

fn decrypted_hit_text(hit: &store::StoredHit) -> String {
    let blob = hex::decode(&hit.text).expect("crm hit text should be hex ciphertext");
    String::from_utf8(
        keepance_lib::commands::mail::crypto::decrypt_with_key(&blob, &VEC_KEY)
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
    use keepance_lib::commands::rag::embedder::EMBEDDING_DIM;
    use keepance_lib::commands::rag::store;

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
        hits_before.iter().any(|h| h.source_type.as_deref() == Some("crm")),
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
        !hits_after.iter().any(|h| h.source_type.as_deref() == Some("crm")),
        "no crm chunks should survive delete_source_type; got {} hits",
        hits_after.len()
    );
}
