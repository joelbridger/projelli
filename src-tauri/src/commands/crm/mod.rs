//! Read-only Wealthbox CRM connector.
//!
//! Phase 1A: the ingestion bridge that turns rendered Wealthbox text (a
//! per-object record or a household summary) into encrypted, matter-scoped RAG
//! chunks, mirroring the mail connector's `index_mail_text_internal`. Later
//! phases add the Wealthbox client, the durable object store, and the
//! object-level sync engine.

pub mod client;
pub mod core_model;
pub mod core_commands;
pub mod core_schema;
pub mod core_store;
pub mod commands;
pub mod engine;
pub mod importer;
pub mod migration_commands;
pub mod migrations;
pub mod model;
pub mod provider;
pub mod record_descriptors;
pub mod redtail;
pub mod render;
pub mod search;
pub mod salesforce;
pub mod source;
pub mod store;
pub mod write;

#[cfg(test)]
mod offline_mode_tests;

use std::path::{Path, PathBuf};

/// Internal CRM RAG indexer — mirrors `mail::index_mail_text_internal`.
/// `source_id` is already formatted as `crm:<kind>:<id>` by the caller
/// (e.g. `crm:household:123`, `crm:note:456`). Encrypts chunk text at rest
/// under the vector-store master key, deletes stale rows first (idempotent),
/// and writes `source_type = "crm"` via `build_batch_crm`. Returns Ok(0) on
/// empty text.
#[allow(dead_code)]
pub async fn index_crm_text_internal(
    workspace: &Path,
    source_id: &str,
    plaintext: &str,
    matter_id: &str,
) -> anyhow::Result<u32> {
    use anyhow::Context;
    if plaintext.trim().is_empty() {
        return Ok(0);
    }
    let key = crate::commands::rag::crypto::get_or_create_master_key()
        .context("vectors master key for crm RAG index")?;
    let conn = crate::commands::rag::store::open_connection(workspace)
        .await
        .context("open lancedb for crm indexing")?;
    let table = crate::commands::rag::store::open_or_create_table(&conn)
        .await
        .context("open/create chunks table")?;

    let chunks = crate::commands::rag::chunker::chunk_text(source_id, plaintext);

    crate::commands::rag::store::delete_path(&table, source_id, &key)
        .await
        .context("delete stale crm chunks")?;

    if chunks.is_empty() {
        return Ok(0);
    }

    let texts: Vec<String> = chunks.iter().map(|c| c.text.clone()).collect();
    let vectors = crate::commands::rag::embedder::embed_documents_batched(&texts, None)
        .await
        .context("embed crm chunks")?
        .unwrap_or_default();
    let rows: Vec<(crate::commands::rag::chunker::Chunk, Vec<f32>)> =
        chunks.into_iter().zip(vectors).collect();

    let batch = crate::commands::rag::store::build_batch_crm(
        &rows,
        &key,
        matter_id,
        crate::commands::rag::store::PRIVILEGE_NONE,
    )
    .context("build crm batch")?;
    let schema = batch.schema();
    use arrow_array::RecordBatchIterator;
    let _write = crate::commands::rag::store::acquire_write_access(&table).await?;
    table
        .add(Box::new(RecordBatchIterator::new(vec![Ok(batch)], schema)))
        .execute()
        .await
        .context("add crm chunks to lancedb")?;

    Ok(rows.len() as u32)
}

/// Cap on concurrent CRM RAG indexing tasks (mirrors the BUG-011 mail cap).
#[allow(dead_code)]
static CRM_INDEX_SEMAPHORE: tokio::sync::Semaphore = tokio::sync::Semaphore::const_new(4);

/// Fire-and-forget CRM RAG indexing, bounded by the semaphore.
#[allow(dead_code)]
pub fn spawn_crm_rag_index(workspace: PathBuf, source_id: String, text: String, matter_id: String) {
    let _ = tokio::task::spawn(async move {
        let _permit = CRM_INDEX_SEMAPHORE.acquire().await.ok();
        if let Err(e) = index_crm_text_internal(&workspace, &source_id, &text, &matter_id).await {
            log::warn!("crm RAG index failed for {}: {:#}", source_id, e);
        }
    });
}
