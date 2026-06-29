//! Shared external connector foundation.
//!
//! Additive bridge for connector-owned records (OneDrive, e-signature,
//! meetings, and future external sources) that need to become encrypted,
//! matter-scoped RAG chunks without touching the working mail or CRM paths.

use std::path::{Path, PathBuf};

/// Internal external-connector RAG indexer — parameterized clone of
/// `crm::index_crm_text_internal`.
///
/// `source_id` is already formatted by the caller (for example
/// `esign:envelope:123`). Encrypts chunk text at rest under the vector-store
/// master key, deletes stale rows first (idempotent), and writes `source_type`
/// through `build_batch_external`. Validates `source_type` before any
/// destructive work, and clears stale rows for `source_id` even when the new
/// text is empty (a source whose content became empty must not keep old
/// chunks searchable); returns Ok(0) when there is nothing left to index.
#[allow(dead_code)]
pub async fn index_external_text_internal(
    workspace: &Path,
    source_id: &str,
    plaintext: &str,
    matter_id: &str,
    source_type: &str,
) -> anyhow::Result<u32> {
    use anyhow::Context;
    // Validate the connector source type BEFORE any destructive work: an
    // unsupported / typo type must fail fast and must never delete a
    // previously-good index first (build_batch_external would otherwise reject
    // it only after the stale-row delete below, wiping the source's chunks).
    crate::commands::rag::store::validate_external_source_type(source_type)
        .context("validate external connector source_type")?;

    let key = crate::commands::rag::crypto::get_or_create_master_key()
        .context("vectors master key for external connector RAG index")?;
    index_external_text_with_validated_source_type(
        workspace,
        source_id,
        plaintext,
        matter_id,
        source_type,
        &key,
    )
    .await
}

/// Same indexing path as `index_external_text_internal`, but with the vector
/// encryption key supplied by the caller. This mirrors the CRM backfill test
/// seam so headless tests can exercise the real delete/embed/store/retrieve
/// path without depending on an unlockable desktop keychain.
#[allow(dead_code)]
pub async fn index_external_text_with_key_internal(
    workspace: &Path,
    source_id: &str,
    plaintext: &str,
    matter_id: &str,
    source_type: &str,
    key: &[u8; 32],
) -> anyhow::Result<u32> {
    use anyhow::Context;
    crate::commands::rag::store::validate_external_source_type(source_type)
        .context("validate external connector source_type")?;
    index_external_text_with_validated_source_type(
        workspace,
        source_id,
        plaintext,
        matter_id,
        source_type,
        key,
    )
    .await
}

async fn index_external_text_with_validated_source_type(
    workspace: &Path,
    source_id: &str,
    plaintext: &str,
    matter_id: &str,
    source_type: &str,
    key: &[u8; 32],
) -> anyhow::Result<u32> {
    use anyhow::Context;
    let conn = crate::commands::rag::store::open_connection(workspace)
        .await
        .context("open lancedb for external connector indexing")?;
    let table = crate::commands::rag::store::open_or_create_table(&conn)
        .await
        .context("open/create chunks table")?;

    // Clear stale rows for this source_id FIRST and ALWAYS — including when the
    // new text is empty — so a re-sync that emptied a source removes its old
    // chunks from search instead of leaving them behind (idempotent re-index).
    crate::commands::rag::store::delete_path(&table, source_id, &key)
        .await
        .context("delete stale external connector chunks")?;

    let chunks = crate::commands::rag::chunker::chunk_text(source_id, plaintext);
    if chunks.is_empty() {
        return Ok(0);
    }

    let texts: Vec<String> = chunks.iter().map(|c| c.text.clone()).collect();
    let vectors = crate::commands::rag::embedder::embed_documents_batched(&texts, None)
        .await
        .context("embed external connector chunks")?
        .unwrap_or_default();
    let rows: Vec<(crate::commands::rag::chunker::Chunk, Vec<f32>)> =
        chunks.into_iter().zip(vectors).collect();

    let batch = crate::commands::rag::store::build_batch_external(
        &rows,
        &key,
        matter_id,
        crate::commands::rag::store::PRIVILEGE_NONE,
        source_type,
    )
    .context("build external connector batch")?;
    let schema = batch.schema();
    use arrow_array::RecordBatchIterator;
    table
        .add(Box::new(RecordBatchIterator::new(vec![Ok(batch)], schema)))
        .execute()
        .await
        .context("add external connector chunks to lancedb")?;

    Ok(rows.len() as u32)
}

/// Delete every RAG chunk for a single external connector `source_id`. Used when
/// a connector record stops mapping to any matter (its mapping disappeared) so
/// its previously-indexed chunks don't linger under the old matter
/// (matter-isolation hygiene). Idempotent: deleting a source with no chunks is a
/// no-op. Mirrors the stale-row delete inside the indexing path, but without
/// re-indexing anything.
#[allow(dead_code)]
pub async fn delete_external_source_with_key_internal(
    workspace: &Path,
    source_id: &str,
    key: &[u8; 32],
) -> anyhow::Result<()> {
    use anyhow::Context;
    let conn = crate::commands::rag::store::open_connection(workspace)
        .await
        .context("open lancedb for external connector source delete")?;
    let table = crate::commands::rag::store::open_or_create_table(&conn)
        .await
        .context("open/create chunks table for external connector source delete")?;
    crate::commands::rag::store::delete_path(&table, source_id, key)
        .await
        .context("delete external connector source chunks")
}

/// Cap on concurrent external connector RAG indexing tasks.
#[allow(dead_code)]
static EXTERNAL_INDEX_SEMAPHORE: tokio::sync::Semaphore = tokio::sync::Semaphore::const_new(4);

/// Fire-and-forget external connector RAG indexing, bounded by the semaphore.
#[allow(dead_code)]
pub fn spawn_external_rag_index(
    workspace: PathBuf,
    source_id: String,
    text: String,
    matter_id: String,
    source_type: String,
) {
    let _ = tokio::task::spawn(async move {
        let _permit = EXTERNAL_INDEX_SEMAPHORE.acquire().await.ok();
        if let Err(e) =
            index_external_text_internal(&workspace, &source_id, &text, &matter_id, &source_type)
                .await
        {
            log::warn!(
                "external connector RAG index failed for {} ({}): {:#}",
                source_id,
                source_type,
                e
            );
        }
    });
}
