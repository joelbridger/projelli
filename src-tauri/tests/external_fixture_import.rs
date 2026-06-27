use arrow_array::RecordBatchIterator;
use keepance_lib::commands::rag::chunker::chunk_text;
use keepance_lib::commands::rag::embedder::EMBEDDING_DIM;
use keepance_lib::commands::rag::store::{self, PRIVILEGE_NONE};

const VEC_KEY: [u8; 32] = [0x5Au8; 32];
const ESIGN_MATTER: &str = "matter-northcrest-advisory";

/// A realistic e-signature record that will produce at least one chunk.
const FIXTURE_BRIEF: &str = "\
DocuSign envelope: Advisory Agreement - Thompson Household
Envelope status: completed.
Recipients: Robert Thompson, Linda Thompson, Sarah Chen.
Completed at: 2026-06-18T15:42:00Z.
Key terms: discretionary management authority, 1.00% annual advisory fee, \
electronic delivery consent, and household-level billing across Schwab taxable \
and IRA accounts.\
";

async fn index_external_entry(
    table: &lancedb::Table,
    source_id: &str,
    text: &str,
    matter_id: &str,
    source_type: &str,
) {
    let chunks = chunk_text(source_id, text);
    assert!(
        !chunks.is_empty(),
        "fixture external brief should produce at least one chunk"
    );
    let rows: Vec<_> = chunks
        .into_iter()
        .map(|chunk| (chunk, vec![0.1f32; EMBEDDING_DIM]))
        .collect();
    let batch =
        store::build_batch_external(&rows, &VEC_KEY, matter_id, PRIVILEGE_NONE, source_type)
            .expect("build external batch");
    let schema = batch.schema();
    table
        .add(Box::new(RecordBatchIterator::new(vec![Ok(batch)], schema)))
        .execute()
        .await
        .expect("add fixture external chunk");
}

fn decrypted_hit_path(hit: &store::StoredHit) -> String {
    let path_enc = hit
        .path_enc
        .as_deref()
        .expect("external hit should carry path_enc");
    let blob = hex::decode(path_enc).expect("path_enc should be hex");
    String::from_utf8(
        keepance_lib::commands::mail::crypto::decrypt_with_key(&blob, &VEC_KEY)
            .expect("decrypt path_enc"),
    )
    .expect("path_enc should decrypt to UTF-8")
}

fn decrypted_hit_text(hit: &store::StoredHit) -> String {
    let blob = hex::decode(&hit.text).expect("external hit text should be hex ciphertext");
    String::from_utf8(
        keepance_lib::commands::mail::crypto::decrypt_with_key(&blob, &VEC_KEY)
            .expect("decrypt hit text"),
    )
    .expect("hit text should decrypt to UTF-8")
}

#[tokio::test]
async fn fixture_esign_chunk_round_trips_encrypted_and_is_retrievable() {
    let workspace = tempfile::tempdir().expect("workspace tempdir");
    let conn = store::open_connection(workspace.path())
        .await
        .expect("open vector store");
    let table = store::open_or_create_table(&conn)
        .await
        .expect("open chunks table");

    let source_id = "esign:envelope:demo-1";

    index_external_entry(&table, source_id, FIXTURE_BRIEF, ESIGN_MATTER, "esign").await;

    let hits = store::nearest(
        &table,
        &vec![0.1f32; EMBEDDING_DIM],
        5,
        Some(ESIGN_MATTER),
        false,
        &[],
    )
    .await
    .expect("vector search");

    let esign_hit = hits
        .iter()
        .find(|hit| decrypted_hit_path(hit) == source_id)
        .expect("vector search should surface the imported esign chunk");

    assert_eq!(
        esign_hit.source_type.as_deref(),
        Some("esign"),
        "source_type column must be 'esign'"
    );
    assert_eq!(
        esign_hit.matter_id.as_deref(),
        Some(ESIGN_MATTER),
        "matter_id must match the indexed matter"
    );

    let decrypted = decrypted_hit_text(esign_hit);
    assert!(
        decrypted.contains("DocuSign") || decrypted.contains("Advisory Agreement"),
        "decrypted hit text should contain content from the fixture brief; got: {decrypted:?}"
    );
}
