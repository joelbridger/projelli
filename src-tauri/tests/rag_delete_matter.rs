//! BUG-040 — `store::delete_matter` must purge EVERY chunk of one matter and
//! nothing else, so a deleted matter's content can never resurface through
//! all-matters retrieval (which applies no matter filter).
//!
//! Model-free: uses dummy vectors via `build_batch`, so it exercises the real
//! LanceDB delete path without the e5-small embedder (runs on CI too).

use arrow_array::RecordBatchIterator;
use keepance_lib::commands::rag::chunker::chunk_text;
use keepance_lib::commands::rag::store::{self, SourceType, PRIVILEGE_NONE, UNASSIGNED_MATTER};

const VEC_KEY: [u8; 32] = [7u8; 32];
const DIM: usize = 384; // e5-small embedding dimension (FixedSizeList<Float32, 384>)

async fn add_matter(table: &lancedb::Table, source: &str, text: &str, matter_id: &str) {
    let chunks = chunk_text(source, text);
    let rows: Vec<_> = chunks.into_iter().map(|c| (c, vec![0.1f32; DIM])).collect();
    let batch = store::build_batch(&rows, SourceType::Text, matter_id, PRIVILEGE_NONE, None, &VEC_KEY)
        .expect("build batch");
    let schema = batch.schema();
    table
        .add(Box::new(RecordBatchIterator::new(vec![Ok(batch)], schema)))
        .execute()
        .await
        .expect("add batch");
}

async fn matter_ids(table: &lancedb::Table) -> std::collections::HashSet<String> {
    let q = vec![0.1f32; DIM];
    let hits = store::nearest(table, &q, 100, None, false).await.expect("nearest");
    hits.into_iter().filter_map(|h| h.matter_id).collect()
}

#[tokio::test]
async fn delete_matter_removes_only_that_matter() {
    let dir = tempfile::tempdir().expect("tempdir");
    let conn = store::open_connection(dir.path()).await.expect("open connection");
    let table = store::open_or_create_table(&conn).await.expect("create table");

    add_matter(&table, "/ws/A/a.md", "alpha contract terms and conditions go here", "matter-a").await;
    add_matter(&table, "/ws/B/b.md", "bravo settlement figures and key dates go here", "matter-b").await;

    let before = matter_ids(&table).await;
    assert!(before.contains("matter-a"), "setup: matter-a present");
    assert!(before.contains("matter-b"), "setup: matter-b present");

    store::delete_matter(&table, "matter-b").await.expect("delete matter-b");

    let after = matter_ids(&table).await;
    assert!(!after.contains("matter-b"), "matter-b chunks must be gone after delete");
    assert!(after.contains("matter-a"), "matter-a chunks must remain (isolation)");
}

#[tokio::test]
async fn delete_matter_refuses_the_unassigned_bucket() {
    let dir = tempfile::tempdir().expect("tempdir");
    let conn = store::open_connection(dir.path()).await.expect("open connection");
    let table = store::open_or_create_table(&conn).await.expect("create table");

    add_matter(&table, "/ws/loose.md", "uncategorized loose content here", UNASSIGNED_MATTER).await;

    let res = store::delete_matter(&table, UNASSIGNED_MATTER).await;
    assert!(res.is_err(), "must refuse to wipe the entire unassigned bucket");

    // The unassigned content must still be present.
    assert!(matter_ids(&table).await.contains(UNASSIGNED_MATTER));
}

#[tokio::test]
async fn delete_matter_rejects_malformed_id() {
    let dir = tempfile::tempdir().expect("tempdir");
    let conn = store::open_connection(dir.path()).await.expect("open connection");
    let table = store::open_or_create_table(&conn).await.expect("create table");

    assert!(store::delete_matter(&table, "").await.is_err(), "empty id rejected");
    assert!(
        store::delete_matter(&table, "bad\0id").await.is_err(),
        "control-char id rejected",
    );
}
