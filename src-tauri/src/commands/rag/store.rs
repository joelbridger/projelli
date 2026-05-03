// LanceDB-backed vector store for the RAG indexer.
//
// One dataset per workspace, living at `<workspace>/.projelli/vectors/`.
// Schema (A3 extension):
//   id              : Utf8           — sha256(path || ":" || paragraph_index)
//   path            : Utf8           — absolute source path
//   paragraph_index : UInt32         — chunk index inside the source
//   text            : Utf8           — verbatim chunk text (returned to UI)
//   vector          : FixedSizeList<Float32, 384>
//   indexed_at      : Int64          — unix epoch seconds, debug only
//   source_type     : Utf8 (nullable) — "text" | "pdf"; null for pre-A3 rows
//   page_number     : UInt32 (nullable) — 1-based page # for PDF, 0 for text
//
// `id` is content-addressed by `(path, paragraph_index)` so re-indexing a
// file is idempotent — we delete `path = ?` first and then append, avoiding
// any need to dedupe at query time.

use anyhow::{Context, Result};
use arrow_array::{
    types::Float32Type, Array, FixedSizeListArray, Int64Array, RecordBatch, RecordBatchIterator,
    StringArray, UInt32Array,
};
use arrow_schema::{DataType, Field, Schema, SchemaRef};
use lancedb::{
    query::{ExecutableQuery, QueryBase},
    Connection, Table,
};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use std::sync::Arc;

use super::chunker::Chunk;
use super::embedder::EMBEDDING_DIM;

/// Identifies how a chunk was produced. Determines which columns are
/// meaningful in the chunks table. Added in Plan A3.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SourceType {
    Text,
    /// 1-based page number for display.
    Pdf { page_number: u32 },
}

/// Name of the per-workspace LanceDB table that stores chunk embeddings.
pub const TABLE_NAME: &str = "chunks";

/// Compute the path of the LanceDB dataset for a given workspace root.
pub fn dataset_path(workspace_root: &Path) -> PathBuf {
    workspace_root.join(".projelli").join("vectors")
}

/// Stable id for `(path, paragraph_index)`. Hex-encoded SHA-256.
pub fn chunk_id(path: &str, paragraph_index: u32) -> String {
    let mut hasher = Sha256::new();
    hasher.update(path.as_bytes());
    hasher.update(b":");
    hasher.update(paragraph_index.to_le_bytes());
    let digest = hasher.finalize();
    hex_encode(&digest)
}

fn hex_encode(bytes: &[u8]) -> String {
    const HEX: &[u8] = b"0123456789abcdef";
    let mut s = String::with_capacity(bytes.len() * 2);
    for &b in bytes {
        s.push(HEX[(b >> 4) as usize] as char);
        s.push(HEX[(b & 0x0f) as usize] as char);
    }
    s
}

/// The Arrow schema for the chunks table. Centralised so writes and
/// reads agree on field order + types.
///
/// A3: two new nullable columns added at the end so existing LanceDB
/// datasets created before A3 still open; old rows return null for these.
pub fn build_schema() -> SchemaRef {
    Arc::new(Schema::new(vec![
        Field::new("id", DataType::Utf8, false),
        Field::new("path", DataType::Utf8, false),
        Field::new("paragraph_index", DataType::UInt32, false),
        Field::new("text", DataType::Utf8, false),
        Field::new(
            "vector",
            DataType::FixedSizeList(
                Arc::new(Field::new("item", DataType::Float32, true)),
                EMBEDDING_DIM as i32,
            ),
            false,
        ),
        Field::new("indexed_at", DataType::Int64, false),
        // A3: discriminates "text" vs "pdf" chunks.
        // Nullable so pre-A3 rows stored without this column don't error.
        Field::new("source_type", DataType::Utf8, true),
        // A3: 1-based page number for PDF chunks; 0 for text chunks.
        // Nullable for pre-A3 rows.
        Field::new("page_number", DataType::UInt32, true),
    ]))
}

/// Open (or create) the LanceDB connection for a workspace.
pub async fn open_connection(workspace_root: &Path) -> Result<Connection> {
    let path = dataset_path(workspace_root);
    std::fs::create_dir_all(&path)
        .with_context(|| format!("failed to create vector dir at {:?}", &path))?;
    let path_str = path.to_string_lossy().to_string();
    lancedb::connect(&path_str)
        .execute()
        .await
        .with_context(|| format!("failed to open lancedb at {:?}", &path))
}

/// Open the `chunks` table, creating an empty one if it doesn't exist.
pub async fn open_or_create_table(conn: &Connection) -> Result<Table> {
    let names = conn
        .table_names()
        .execute()
        .await
        .context("table_names failed")?;
    if names.iter().any(|n| n == TABLE_NAME) {
        return conn
            .open_table(TABLE_NAME)
            .execute()
            .await
            .context("open_table chunks failed");
    }
    let schema = build_schema();
    conn.create_empty_table(TABLE_NAME, schema)
        .execute()
        .await
        .context("create_empty_table chunks failed")
}

/// Build a RecordBatch from a slice of chunk + vector pairs. All inputs
/// must have `vector.len() == EMBEDDING_DIM`; assertion failure is a bug.
///
/// A3: `source_type` controls the `source_type` and `page_number` columns.
/// Pass `SourceType::Text` for all text-file chunks (page_number = 0).
/// Pass `SourceType::Pdf { page_number }` for PDF chunks where page_number
/// is derived from `chunk.paragraph_index / MAX_CHUNKS_PER_PAGE + 1`.
pub fn build_batch(rows: &[(Chunk, Vec<f32>)], source_type: SourceType) -> Result<RecordBatch> {
    let schema = build_schema();
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);

    let ids: Vec<String> = rows
        .iter()
        .map(|(c, _)| chunk_id(&c.path, c.paragraph_index))
        .collect();
    let paths: Vec<&str> = rows.iter().map(|(c, _)| c.path.as_str()).collect();
    let para_idx: Vec<u32> = rows.iter().map(|(c, _)| c.paragraph_index).collect();
    let texts: Vec<&str> = rows.iter().map(|(c, _)| c.text.as_str()).collect();
    let timestamps: Vec<i64> = vec![now; rows.len()];

    let vectors = FixedSizeListArray::from_iter_primitive::<Float32Type, _, _>(
        rows.iter()
            .map(|(_, v)| Some(v.iter().copied().map(Some).collect::<Vec<_>>())),
        EMBEDDING_DIM as i32,
    );

    let id_arr = StringArray::from_iter_values(ids.iter().map(|s| s.as_str()));
    let path_arr = StringArray::from_iter_values(paths.iter().copied());
    let pi_arr = UInt32Array::from(para_idx);
    let text_arr = StringArray::from_iter_values(texts.iter().copied());
    let ts_arr = Int64Array::from(timestamps);

    // A3 columns — source_type and page_number.
    let (st_str, pn_val): (&str, u32) = match source_type {
        SourceType::Text => ("text", 0),
        SourceType::Pdf { page_number } => ("pdf", page_number),
    };
    let st_arr = StringArray::from(vec![st_str; rows.len()]);
    let pn_arr = UInt32Array::from(vec![pn_val; rows.len()]);

    let batch = RecordBatch::try_new(
        schema,
        vec![
            Arc::new(id_arr),
            Arc::new(path_arr),
            Arc::new(pi_arr),
            Arc::new(text_arr),
            Arc::new(vectors),
            Arc::new(ts_arr),
            Arc::new(st_arr),
            Arc::new(pn_arr),
        ],
    )
    .context("RecordBatch::try_new failed for chunks batch")?;
    Ok(batch)
}

/// Replace all rows for `path` with the new `rows`. Idempotent re-index.
///
/// A3: `source_type` is passed to `build_batch` so every row in the batch
/// gets the correct `source_type` / `page_number` values. Text callers pass
/// `SourceType::Text`; PDF callers pass `SourceType::Pdf { page_number }`.
/// Note: for PDF files where different chunks belong to different pages,
/// call this once per page or use `build_batch_per_row` (not needed in A3
/// since we split at the page level already).
pub async fn upsert_chunks_for_path(
    table: &Table,
    path: &str,
    rows: Vec<(Chunk, Vec<f32>)>,
    source_type: SourceType,
) -> Result<()> {
    // Always delete first — even if `rows` is empty (the file may have
    // been emptied by the user) we want to drop stale chunks.
    let predicate = format!("path = '{}'", path.replace('\'', "''"));
    table
        .delete(&predicate)
        .await
        .with_context(|| format!("delete failed for {}", path))?;

    if rows.is_empty() {
        return Ok(());
    }

    let batch = build_batch(&rows, source_type)?;
    let schema = batch.schema();
    let iter = RecordBatchIterator::new(vec![Ok(batch)], schema);
    table
        .add(Box::new(iter))
        .execute()
        .await
        .context("add chunks batch failed")?;
    Ok(())
}

/// Drop every row whose `path` matches. Used by the watcher when a file
/// is deleted from the workspace.
pub async fn delete_path(table: &Table, path: &str) -> Result<()> {
    let predicate = format!("path = '{}'", path.replace('\'', "''"));
    table
        .delete(&predicate)
        .await
        .with_context(|| format!("delete failed for {}", path))?;
    Ok(())
}

/// One raw query result before scoring.
#[derive(Debug, Clone)]
pub struct StoredHit {
    pub path: String,
    pub paragraph_index: u32,
    pub text: String,
    /// Cosine distance from LanceDB. Lower is better.
    pub distance: f32,
    // A3 additions. None for pre-A3 rows that lack these columns.
    pub source_type: Option<String>,
    pub page_number: Option<u32>,
}

/// Nearest-neighbor search. Returns up to `top_k` raw hits.
pub async fn nearest(table: &Table, query_vec: &[f32], top_k: usize) -> Result<Vec<StoredHit>> {
    use futures_util::TryStreamExt;
    let mut stream = table
        .query()
        .nearest_to(query_vec)
        .context("nearest_to failed")?
        .limit(top_k)
        .execute()
        .await
        .context("query execute failed")?;

    let mut out: Vec<StoredHit> = Vec::with_capacity(top_k);
    while let Some(batch) = stream
        .try_next()
        .await
        .context("query stream try_next failed")?
    {
        let path_col = batch
            .column_by_name("path")
            .context("missing path column")?
            .as_any()
            .downcast_ref::<StringArray>()
            .context("path column is not StringArray")?;
        let pi_col = batch
            .column_by_name("paragraph_index")
            .context("missing paragraph_index column")?
            .as_any()
            .downcast_ref::<UInt32Array>()
            .context("paragraph_index column is not UInt32Array")?;
        let text_col = batch
            .column_by_name("text")
            .context("missing text column")?
            .as_any()
            .downcast_ref::<StringArray>()
            .context("text column is not StringArray")?;
        // LanceDB exposes the distance as `_distance`. Falls back to 0
        // (best score) if the column is missing — should not happen on
        // a vector query but keeps us robust.
        let dist_col = batch
            .column_by_name("_distance")
            .and_then(|c| c.as_any().downcast_ref::<arrow_array::Float32Array>());

        // A3: read nullable source_type and page_number columns.
        // These are absent on pre-A3 tables so we fall back to None.
        let st_col = batch
            .column_by_name("source_type")
            .and_then(|c| c.as_any().downcast_ref::<StringArray>());
        let pn_col = batch
            .column_by_name("page_number")
            .and_then(|c| c.as_any().downcast_ref::<UInt32Array>());

        for i in 0..batch.num_rows() {
            let distance = dist_col.map(|c| c.value(i)).unwrap_or(0.0);
            let source_type = st_col
                .filter(|c| !c.is_null(i))
                .map(|c| c.value(i).to_string());
            let page_number = pn_col.filter(|c| !c.is_null(i)).map(|c| c.value(i));
            out.push(StoredHit {
                path: path_col.value(i).to_string(),
                paragraph_index: pi_col.value(i),
                text: text_col.value(i).to_string(),
                distance,
                source_type,
                page_number,
            });
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dataset_path_lives_under_dot_projelli() {
        let p = dataset_path(Path::new("/tmp/work"));
        assert_eq!(p, PathBuf::from("/tmp/work/.projelli/vectors"));
    }

    #[test]
    fn chunk_id_is_stable() {
        let a = chunk_id("/a/b.md", 3);
        let b = chunk_id("/a/b.md", 3);
        assert_eq!(a, b);
        // Different path or index -> different id.
        assert_ne!(a, chunk_id("/a/b.md", 4));
        assert_ne!(a, chunk_id("/a/c.md", 3));
        // SHA-256 hex is 64 chars.
        assert_eq!(a.len(), 64);
    }

    #[test]
    fn schema_has_eight_fields_in_canonical_order() {
        let s = build_schema();
        let names: Vec<_> = s.fields().iter().map(|f| f.name().as_str()).collect();
        assert_eq!(
            names,
            vec![
                "id",
                "path",
                "paragraph_index",
                "text",
                "vector",
                "indexed_at",
                "source_type",
                "page_number",
            ]
        );
    }

    #[test]
    fn build_batch_round_trips_rows() {
        let chunks = vec![
            (
                Chunk {
                    path: "/a.md".into(),
                    paragraph_index: 0,
                    text: "hello".into(),
                    start_offset: 0,
                    end_offset: 5,
                },
                vec![0.1f32; EMBEDDING_DIM],
            ),
            (
                Chunk {
                    path: "/a.md".into(),
                    paragraph_index: 1,
                    text: "world".into(),
                    start_offset: 6,
                    end_offset: 11,
                },
                vec![0.2f32; EMBEDDING_DIM],
            ),
        ];
        let batch = build_batch(&chunks, SourceType::Text).expect("build_batch");
        assert_eq!(batch.num_rows(), 2);
        // 8 columns: id, path, paragraph_index, text, vector, indexed_at, source_type, page_number
        assert_eq!(batch.num_columns(), 8);
    }

    #[test]
    fn build_batch_text_source_type_is_text() {
        use arrow_array::cast::AsArray;
        let rows = vec![(
            Chunk {
                path: "/a.md".into(),
                paragraph_index: 0,
                text: "hello".into(),
                start_offset: 0,
                end_offset: 5,
            },
            vec![0.1f32; EMBEDDING_DIM],
        )];
        let batch = build_batch(&rows, SourceType::Text).expect("build_batch text");
        let st_col = batch
            .column_by_name("source_type")
            .expect("source_type column missing")
            .as_string::<i32>();
        assert_eq!(st_col.value(0), "text");
        let pn_col = batch
            .column_by_name("page_number")
            .expect("page_number column missing")
            .as_primitive::<arrow_array::types::UInt32Type>();
        assert_eq!(pn_col.value(0), 0);
    }

    #[test]
    fn build_batch_pdf_source_type_is_pdf() {
        use arrow_array::cast::AsArray;
        let rows = vec![(
            Chunk {
                path: "/a.pdf".into(),
                paragraph_index: 0,
                text: "page text".into(),
                start_offset: 0,
                end_offset: 9,
            },
            vec![0.1f32; EMBEDDING_DIM],
        )];
        let batch = build_batch(&rows, SourceType::Pdf { page_number: 3 }).expect("build_batch pdf");
        let st_col = batch
            .column_by_name("source_type")
            .expect("source_type column missing")
            .as_string::<i32>();
        assert_eq!(st_col.value(0), "pdf");
        let pn_col = batch
            .column_by_name("page_number")
            .expect("page_number column missing")
            .as_primitive::<arrow_array::types::UInt32Type>();
        assert_eq!(pn_col.value(0), 3);
    }
}
