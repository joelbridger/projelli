use arrow_array::RecordBatchIterator;
use lantern_lib::commands::connector::{
    index_external_text_internal, index_external_text_with_key_internal,
};
use lantern_lib::commands::rag::chunker::chunk_text;
use lantern_lib::commands::rag::embedder::{embed_query, EMBEDDING_DIM};
use lantern_lib::commands::rag::store::{self, PRIVILEGE_NONE};
use std::path::Path;

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
        lantern_lib::commands::mail::crypto::decrypt_with_key(&blob, &VEC_KEY)
            .expect("decrypt path_enc"),
    )
    .expect("path_enc should decrypt to UTF-8")
}

fn decrypted_hit_path_with_key(hit: &store::StoredHit, key: &[u8; 32]) -> String {
    let path_enc = hit
        .path_enc
        .as_deref()
        .expect("external hit should carry path_enc");
    let blob = hex::decode(path_enc).expect("path_enc should be hex");
    String::from_utf8(
        lantern_lib::commands::mail::crypto::decrypt_with_key(&blob, key)
            .expect("decrypt path_enc"),
    )
    .expect("path_enc should decrypt to UTF-8")
}

fn decrypted_hit_text(hit: &store::StoredHit) -> String {
    let blob = hex::decode(&hit.text).expect("external hit text should be hex ciphertext");
    String::from_utf8(
        lantern_lib::commands::mail::crypto::decrypt_with_key(&blob, &VEC_KEY)
            .expect("decrypt hit text"),
    )
    .expect("hit text should decrypt to UTF-8")
}

async fn retrieved_source_ids(
    workspace: &Path,
    key: &[u8; 32],
    matter_id: &str,
    query: &str,
) -> Vec<String> {
    let conn = store::open_connection(workspace)
        .await
        .expect("open vector store");
    let table = store::open_or_create_table(&conn)
        .await
        .expect("open chunks table");
    let query_vec = embed_query(query).await.expect("embed query");
    store::nearest(&table, &query_vec, 50, Some(matter_id), false, &[])
        .await
        .expect("vector search")
        .iter()
        .map(|hit| decrypted_hit_path_with_key(hit, key))
        .collect()
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

#[tokio::test]
async fn fixture_calendly_meeting_round_trips_as_encrypted_meeting_chunk() {
    let workspace = tempfile::tempdir().expect("workspace tempdir");
    let source_id = "calendly:event:evt-roundtrip";
    let text = "\
Calendly meeting: Initial consult
Start time: 2026-07-01T14:00:00Z
Invitees:
- Amelia Rivera <amelia@example.com>
  Intake Q&A - What should we discuss?: Draft complaint and deadline.
";

    let count = index_external_text_with_key_internal(
        workspace.path(),
        source_id,
        text,
        ESIGN_MATTER,
        "meeting",
        &VEC_KEY,
    )
    .await
    .expect("meeting index should succeed");
    assert!(count > 0, "meeting fixture should write at least one chunk");

    let ids = retrieved_source_ids(
        workspace.path(),
        &VEC_KEY,
        ESIGN_MATTER,
        "Amelia Rivera draft complaint deadline Calendly",
    )
    .await;
    assert!(
        ids.iter().any(|id| id == source_id),
        "retrieval should surface the calendly meeting chunk; got: {ids:?}"
    );
}

#[tokio::test]
async fn reindexing_external_source_with_whitespace_text_deletes_stale_chunks() {
    let workspace = tempfile::tempdir().expect("workspace tempdir");
    let source_id = "esign:envelope:empty-resync-target";
    let control_source_id = "esign:envelope:empty-resync-control";
    let target_text = "\
DocuSign envelope: Advisory Agreement - empty resync target.
Recipients: Robert Thompson and Linda Thompson.
Key terms: discretionary authority, household billing, and electronic delivery consent.
";
    let control_text = "\
DocuSign envelope: Investment Policy Statement - empty resync control.
Recipients: Amelia Rivera and Northcrest Advisory.
Key terms: IPS acknowledgment, allocation drift review, and next-meeting preparation.
";

    let first_count = index_external_text_with_key_internal(
        workspace.path(),
        source_id,
        target_text,
        ESIGN_MATTER,
        "esign",
        &VEC_KEY,
    )
    .await
    .expect("initial external index should succeed");
    assert!(
        first_count > 0,
        "initial index should write at least one chunk"
    );

    index_external_text_with_key_internal(
        workspace.path(),
        control_source_id,
        control_text,
        ESIGN_MATTER,
        "esign",
        &VEC_KEY,
    )
    .await
    .expect("control external index should succeed");

    let before = retrieved_source_ids(
        workspace.path(),
        &VEC_KEY,
        ESIGN_MATTER,
        "Thompson household advisory agreement electronic delivery",
    )
    .await;
    assert!(
        before.iter().any(|id| id == source_id),
        "target source should be retrievable before the empty re-sync; got: {before:?}"
    );

    let empty_count = index_external_text_with_key_internal(
        workspace.path(),
        source_id,
        " \n\t  ",
        ESIGN_MATTER,
        "esign",
        &VEC_KEY,
    )
    .await
    .expect("empty external re-index should succeed");
    assert_eq!(empty_count, 0, "whitespace text should write zero chunks");

    let after = retrieved_source_ids(
        workspace.path(),
        &VEC_KEY,
        ESIGN_MATTER,
        "Thompson household advisory agreement electronic delivery",
    )
    .await;
    assert!(
        !after.iter().any(|id| id == source_id),
        "empty re-sync must remove stale chunks for the target source; got: {after:?}"
    );
    assert!(
        after.iter().any(|id| id == control_source_id),
        "empty re-sync must not delete unrelated external sources; got: {after:?}"
    );
}

#[tokio::test]
async fn invalid_external_source_type_errors_without_deleting_existing_chunks() {
    let workspace = tempfile::tempdir().expect("workspace tempdir");
    let source_id = "esign:envelope:invalid-source-type-target";
    let source_text = "\
DocuSign envelope: Advisory Agreement - invalid type safety target.
Recipients: Sarah Chen and Robert Thompson.
Key terms: signed advisory agreement, billing consent, and custodian delivery preference.
";

    index_external_text_with_key_internal(
        workspace.path(),
        source_id,
        source_text,
        ESIGN_MATTER,
        "esign",
        &VEC_KEY,
    )
    .await
    .expect("initial external index should succeed");

    let before = retrieved_source_ids(
        workspace.path(),
        &VEC_KEY,
        ESIGN_MATTER,
        "Sarah Chen signed advisory agreement billing consent",
    )
    .await;
    assert!(
        before.iter().any(|id| id == source_id),
        "source should be retrievable before invalid source_type attempt; got: {before:?}"
    );

    let err = index_external_text_internal(
        workspace.path(),
        source_id,
        "This replacement text must not be indexed or trigger a delete.",
        ESIGN_MATTER,
        "docusign",
    )
    .await
    .expect_err("invalid source_type should fail");
    assert!(
        err.to_string().contains("validate external connector source_type")
            || format!("{err:#}").contains("invalid external source_type"),
        "error should identify invalid source_type validation; got: {err:#}"
    );

    let after = retrieved_source_ids(
        workspace.path(),
        &VEC_KEY,
        ESIGN_MATTER,
        "Sarah Chen signed advisory agreement billing consent",
    )
    .await;
    assert!(
        after.iter().any(|id| id == source_id),
        "invalid source_type must not delete the source's existing chunks; got: {after:?}"
    );
}
