//! Shared internal text ingestion for connector-owned sources.
//!
//! This is deliberately not a Tauri command. Callers pass plaintext from Rust
//! connector code directly into the local RAG store, so client content never
//! crosses IPC into the renderer just to be indexed.

use anyhow::{Context, Result};
use std::path::Path;

use super::store::SourceType;

/// Index one connector-owned plaintext source into the local RAG table.
///
/// Idempotent: rows for `source_id` are deleted before replacement. The
/// `matter_id` is the security scope key used by retrieval prefilters, so every
/// caller must pass the already-resolved matter id.
pub async fn index_text(
    workspace: &Path,
    source_id: &str,
    plaintext: &str,
    matter_id: &str,
    source_type: SourceType,
) -> Result<u32> {
    if source_id.trim().is_empty() {
        anyhow::bail!("source_id must not be empty");
    }
    if plaintext.trim().is_empty() {
        return Ok(0);
    }

    let key = super::crypto::get_or_create_master_key()
        .context("vectors master key for connector RAG index")?;
    let conn = super::store::open_connection(workspace)
        .await
        .context("open lancedb for connector indexing")?;
    let table = super::store::open_or_create_table(&conn)
        .await
        .context("open/create chunks table")?;

    let chunks = super::chunker::chunk_text(source_id, plaintext);
    super::store::delete_path(&table, source_id, &key)
        .await
        .context("delete stale connector chunks")?;
    if chunks.is_empty() {
        return Ok(0);
    }

    let texts: Vec<String> = chunks.iter().map(|c| c.text.clone()).collect();
    let vectors = super::embedder::embed_documents_batched(&texts, None)
        .await
        .context("embed connector chunks")?
        .unwrap_or_default();
    let row_count = vectors.len() as u32;
    let rows: Vec<(super::chunker::Chunk, Vec<f32>)> = chunks.into_iter().zip(vectors).collect();

    let batch = if matches!(source_type, SourceType::Mail) {
        super::store::build_batch_mail(&rows, &key, matter_id, super::store::PRIVILEGE_NONE)
            .context("build mail batch")?
    } else {
        super::store::build_batch(
            &rows,
            source_type,
            matter_id,
            super::store::PRIVILEGE_NONE,
            None,
            &key,
        )
        .context("build connector batch")?
    };

    let schema = batch.schema();
    use arrow_array::RecordBatchIterator;
    table
        .add(Box::new(RecordBatchIterator::new(vec![Ok(batch)], schema)))
        .execute()
        .await
        .context("add connector chunks to lancedb")?;

    Ok(row_count)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_plaintext_is_a_noop() {
        let rt = tokio::runtime::Runtime::new().expect("runtime");
        let dir = tempfile::tempdir().expect("tempdir");
        let count = rt
            .block_on(index_text(
                dir.path(),
                "wealthbox:note:1",
                "  \n\t",
                "matter-a",
                SourceType::Wealthbox,
            ))
            .expect("empty text should not touch model or store");
        assert_eq!(count, 0);
    }
}
