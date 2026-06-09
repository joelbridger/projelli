//! matter-retrieval spike library.
//!
//! Mirrors the app's RAG store path (LanceDB + fastembed e5-small) and adds the
//! ONE thing the matter-isolation gate needs: a `matter_id` column written at
//! index time and a SQL `only_if` filter applied at query time. Everything else
//! — the 384-dim FixedSizeList vector column, the sha256 chunk id, the
//! "passage:" / "query:" e5 prefixes, the paragraph-aware chunker — is the same
//! shape as src-tauri/src/commands/rag/.
//!
//! The proposed *production* chunk schema (proven here) extends the existing 9
//! columns with three citation/scoping columns:
//!   matter_id   : Utf8           (NOT NULL once 3.0 ships; the scope key)
//!   source_id   : Utf8           (file path for docs, "mail:<id>" for email)
//!   source_type : Utf8           (already exists; we reuse "document"/"email")
//! plus the existing page_number for page-level citations. `id` (sha256) already
//! gives a verifiable citation key.

pub mod corpus;

use anyhow::{Context, Result};
use arrow_array::{
    types::Float32Type, Array, FixedSizeListArray, Int64Array, RecordBatch, RecordBatchIterator,
    StringArray, UInt32Array,
};
use arrow_schema::{DataType, Field, Schema, SchemaRef};
use fastembed::{EmbeddingModel, InitOptions, TextEmbedding};
use lancedb::{
    query::{ExecutableQuery, QueryBase},
    Connection, Table,
};
use sha2::{Digest, Sha256};
use std::path::Path;
use std::sync::Arc;

/// e5-small output dimension (matches the app's EMBEDDING_DIM).
pub const EMBEDDING_DIM: usize = 384;
/// Table name (matches the app's store::TABLE_NAME).
pub const TABLE_NAME: &str = "chunks";

// ---------------------------------------------------------------------------
// Chunk ids — content-addressed, citation-grade.
// ---------------------------------------------------------------------------

/// Stable id for a chunk: sha256(source_id || ":" || paragraph_index), hex.
/// This is the citation key — given (source_id, paragraph_index) anyone can
/// recompute it and assert it exists. Same construction as store::chunk_id but
/// keyed on `source_id` (which equals the app's `path`).
pub fn chunk_id(source_id: &str, paragraph_index: u32) -> String {
    let mut hasher = Sha256::new();
    hasher.update(source_id.as_bytes());
    hasher.update(b":");
    hasher.update(paragraph_index.to_le_bytes());
    hex::encode(hasher.finalize())
}

// ---------------------------------------------------------------------------
// Chunking — reuse of the app's paragraph-aware strategy (trimmed copy).
// ---------------------------------------------------------------------------

pub const TARGET_BYTES: usize = 384 * 4;

/// One chunk before embedding.
#[derive(Debug, Clone)]
pub struct Chunk {
    pub paragraph_index: u32,
    pub text: String,
}

/// Paragraph-aware chunker: greedily groups double-newline paragraphs up to the
/// byte budget. Faithful in spirit to rag::chunker::chunk_text — for this small
/// corpus each source becomes a handful of paragraph chunks, which is exactly
/// the granularity citations resolve to.
pub fn chunk_text(text: &str) -> Vec<Chunk> {
    let mut out = Vec::new();
    let mut buf = String::new();
    let mut idx: u32 = 0;
    let flush = |buf: &mut String, idx: &mut u32, out: &mut Vec<Chunk>| {
        if buf.trim().is_empty() {
            buf.clear();
            return;
        }
        out.push(Chunk {
            paragraph_index: *idx,
            text: buf.trim().to_string(),
        });
        *idx += 1;
        buf.clear();
    };
    for para in text.split("\n\n") {
        let para = para.trim();
        if para.is_empty() {
            continue;
        }
        if !buf.is_empty() && buf.len() + para.len() + 2 > TARGET_BYTES {
            flush(&mut buf, &mut idx, &mut out);
        }
        if !buf.is_empty() {
            buf.push_str("\n\n");
        }
        buf.push_str(para);
    }
    flush(&mut buf, &mut idx, &mut out);
    out
}

// ---------------------------------------------------------------------------
// Embedder — same model + prefixes as rag::embedder.
// ---------------------------------------------------------------------------

/// Build a fresh e5-small embedder. (The app uses a process-wide singleton; for
/// a spike a per-run instance is simpler and the cost is one model load.)
pub fn new_embedder() -> Result<TextEmbedding> {
    let opts = InitOptions::new(EmbeddingModel::MultilingualE5Small)
        .with_show_download_progress(false);
    TextEmbedding::try_new(opts).context("init e5-small")
}

/// Embed documents with the "passage: " prefix (e5 convention, matches app).
pub fn embed_documents(model: &TextEmbedding, docs: &[String]) -> Result<Vec<Vec<f32>>> {
    if docs.is_empty() {
        return Ok(Vec::new());
    }
    let prefixed: Vec<String> = docs.iter().map(|d| format!("passage: {d}")).collect();
    model.embed(prefixed, None).context("embed documents")
}

/// Embed a single query with the "query: " prefix (matches app).
pub fn embed_query(model: &TextEmbedding, query: &str) -> Result<Vec<f32>> {
    let mut v = model
        .embed(vec![format!("query: {query}")], None)
        .context("embed query")?;
    v.pop().context("no query vector returned")
}

/// LanceDB cosine distance -> [0,1] score (matches app's mapping).
pub fn distance_to_score(distance: f32) -> f32 {
    (1.0 - distance / 2.0).clamp(0.0, 1.0)
}

// ---------------------------------------------------------------------------
// Store — the app's schema + a matter_id and source_id column.
// ---------------------------------------------------------------------------

/// Schema = app's existing columns (minus the mail-only `encrypted`, which is
/// orthogonal to this gate) PLUS `matter_id` and `source_id`. `matter_id` is
/// the scope key the whole gate hinges on; `source_id` carries the originating
/// document path / mail id so a citation resolves to the exact source.
pub fn build_schema() -> SchemaRef {
    Arc::new(Schema::new(vec![
        Field::new("id", DataType::Utf8, false),
        // NEW (3.0): scope key. Non-nullable — every chunk MUST belong to a matter.
        Field::new("matter_id", DataType::Utf8, false),
        // NEW (3.0): originating document path or "mail:<id>".
        Field::new("source_id", DataType::Utf8, false),
        Field::new("paragraph_index", DataType::UInt32, false),
        Field::new("text", DataType::Utf8, false),
        Field::new(
            "vector",
            DataType::FixedSizeList(Arc::new(Field::new("item", DataType::Float32, true)), EMBEDDING_DIM as i32),
            false,
        ),
        Field::new("indexed_at", DataType::Int64, false),
        Field::new("source_type", DataType::Utf8, true),
        Field::new("page_number", DataType::UInt32, true),
    ]))
}

/// A row staged for insert.
pub struct Row {
    pub matter_id: String,
    pub source_id: String,
    pub paragraph_index: u32,
    pub text: String,
    pub source_type: String,
    pub page_number: Option<u32>,
    pub vector: Vec<f32>,
}

/// Open (or create) the LanceDB connection at `dir/.keepance/vectors`
/// (same on-disk layout as the app's store::dataset_path).
pub async fn open_connection(dir: &Path) -> Result<Connection> {
    let path = dir.join(".keepance").join("vectors");
    std::fs::create_dir_all(&path).context("create vector dir")?;
    lancedb::connect(path.to_string_lossy().as_ref())
        .execute()
        .await
        .context("connect lancedb")
}

/// Create the chunks table from a batch of rows.
pub async fn create_table(conn: &Connection, rows: &[Row]) -> Result<Table> {
    let batch = build_batch(rows)?;
    let schema = batch.schema();
    let iter = RecordBatchIterator::new(vec![Ok(batch)], schema);
    conn.create_table(TABLE_NAME, Box::new(iter))
        .execute()
        .await
        .context("create_table chunks")
}

fn build_batch(rows: &[Row]) -> Result<RecordBatch> {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);

    let ids: Vec<String> = rows.iter().map(|r| chunk_id(&r.source_id, r.paragraph_index)).collect();
    let id_arr = StringArray::from_iter_values(ids.iter().map(|s| s.as_str()));
    let matter_arr = StringArray::from_iter_values(rows.iter().map(|r| r.matter_id.as_str()));
    let src_arr = StringArray::from_iter_values(rows.iter().map(|r| r.source_id.as_str()));
    let pi_arr = UInt32Array::from(rows.iter().map(|r| r.paragraph_index).collect::<Vec<_>>());
    let text_arr = StringArray::from_iter_values(rows.iter().map(|r| r.text.as_str()));
    let vectors = FixedSizeListArray::from_iter_primitive::<Float32Type, _, _>(
        rows.iter().map(|r| Some(r.vector.iter().copied().map(Some).collect::<Vec<_>>())),
        EMBEDDING_DIM as i32,
    );
    let ts_arr = Int64Array::from(vec![now; rows.len()]);
    let st_arr = StringArray::from_iter_values(rows.iter().map(|r| r.source_type.as_str()));
    let pn_arr = UInt32Array::from(rows.iter().map(|r| r.page_number).collect::<Vec<Option<u32>>>());

    RecordBatch::try_new(
        build_schema(),
        vec![
            Arc::new(id_arr),
            Arc::new(matter_arr),
            Arc::new(src_arr),
            Arc::new(pi_arr),
            Arc::new(text_arr),
            Arc::new(vectors),
            Arc::new(ts_arr),
            Arc::new(st_arr),
            Arc::new(pn_arr),
        ],
    )
    .context("RecordBatch::try_new")
}

/// A scored result row from a retrieval. This is the spike's analogue of the
/// app's `Hit`, extended with the citation/scoping fields the gate requires.
#[derive(Debug, Clone)]
pub struct ScopedHit {
    pub id: String,
    pub matter_id: String,
    pub source_id: String,
    pub paragraph_index: u32,
    pub text: String,
    pub source_type: Option<String>,
    pub page_number: Option<u32>,
    pub score: f32,
}

/// SQL-escape a matter id for embedding in an `only_if` clause (defends the
/// filter against a `'`-bearing matter id — matter ids are app-controlled, but
/// the production code must still escape, exactly like store::delete_path does).
pub fn sql_escape(s: &str) -> String {
    s.replace('\'', "''")
}

/// THE GATE. Embed `query`, run nearest-neighbor, and — when `scope` is Some —
/// constrain results to that matter with a store-level SQL prefilter.
///
/// `only_if` sets `QueryFilter::Sql`; LanceDB's default is `prefilter = true`
/// (verified in lancedb-0.21.3 query.rs: QueryRequest::default => prefilter:true,
/// VectorQueryRequest.base defaults the same). Prefilter applies the predicate
/// to the row set BEFORE the ANN/flat search, so similarity can never surface a
/// row outside the scope. We deliberately do NOT call `.postfilter()`, which is
/// the only mode that could drop in-scope results or admit approximation.
pub async fn retrieve(
    table: &Table,
    model: &TextEmbedding,
    query: &str,
    top_k: usize,
    scope: Option<&str>,
) -> Result<Vec<ScopedHit>> {
    use futures_util::TryStreamExt;
    let qvec = embed_query(model, query)?;

    let mut q = table
        .query()
        .nearest_to(qvec.as_slice())
        .context("nearest_to")?
        .limit(top_k);
    if let Some(matter_id) = scope {
        // Store-level enforcement: the matter filter is part of the query plan,
        // not a post-hoc .filter() on the returned Vec.
        q = q.only_if(format!("matter_id = '{}'", sql_escape(matter_id)));
    }
    let mut stream = q.execute().await.context("execute query")?;

    let mut out = Vec::new();
    while let Some(batch) = stream.try_next().await.context("stream batch")? {
        let col_str = |name: &str| -> Option<&StringArray> {
            batch.column_by_name(name).and_then(|c| c.as_any().downcast_ref::<StringArray>())
        };
        let id_c = col_str("id");
        let matter_c = col_str("matter_id");
        let src_c = col_str("source_id");
        let text_c = col_str("text");
        let st_c = col_str("source_type");
        let pi_c = batch
            .column_by_name("paragraph_index")
            .and_then(|c| c.as_any().downcast_ref::<UInt32Array>());
        let pn_c = batch
            .column_by_name("page_number")
            .and_then(|c| c.as_any().downcast_ref::<UInt32Array>());
        let dist_c = batch
            .column_by_name("_distance")
            .and_then(|c| c.as_any().downcast_ref::<arrow_array::Float32Array>());

        for i in 0..batch.num_rows() {
            out.push(ScopedHit {
                id: id_c.map(|c| c.value(i).to_string()).unwrap_or_default(),
                matter_id: matter_c.map(|c| c.value(i).to_string()).unwrap_or_default(),
                source_id: src_c.map(|c| c.value(i).to_string()).unwrap_or_default(),
                paragraph_index: pi_c.map(|c| c.value(i)).unwrap_or(0),
                text: text_c.map(|c| c.value(i).to_string()).unwrap_or_default(),
                source_type: st_c.filter(|c| !c.is_null(i)).map(|c| c.value(i).to_string()),
                page_number: pn_c.filter(|c| !c.is_null(i)).map(|c| c.value(i)),
                score: dist_c.map(|c| distance_to_score(c.value(i))).unwrap_or(0.0),
            });
        }
    }
    out.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal));
    Ok(out)
}

// ---------------------------------------------------------------------------
// Citation verification.
// ---------------------------------------------------------------------------

/// A citation as an AI answer would carry it: enough to (a) locate the exact
/// source and (b) verify the quoted text actually came from there. The `id` is
/// the content-addressed chunk id; `quoted_text` is what the answer claims the
/// source says.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct Citation {
    pub id: String,
    pub matter_id: String,
    pub source_id: String,
    pub paragraph_index: u32,
    pub page_number: Option<u32>,
    /// The exact text the answer attributes to this chunk.
    pub quoted_text: String,
}

/// Result of verifying a citation against the store.
#[derive(Debug, PartialEq)]
pub enum VerifyResult {
    /// Chunk exists, is in the claimed matter, and its stored text contains the
    /// quoted text verbatim.
    Verified,
    /// No chunk with that id exists (fabricated/stale citation).
    NotFound,
    /// Chunk exists but belongs to a different matter than claimed (a scope lie).
    MatterMismatch { actual_matter: String },
    /// Chunk exists in the right matter, but the quoted text is NOT in the
    /// stored chunk (the answer misquoted / hallucinated the content).
    TextMismatch,
}

/// Verify a citation against the store. The app would refuse to present an
/// answer whose citation does not return `Verified`.
///
/// This is an exact, scoped point-lookup by `id` (also constrained by
/// `matter_id` so a citation can't be verified against another matter's chunk).
pub async fn verify_citation(table: &Table, c: &Citation) -> Result<VerifyResult> {
    use futures_util::TryStreamExt;
    // Point lookup by content-addressed id, scoped to the claimed matter.
    let filter = format!(
        "id = '{}' AND matter_id = '{}'",
        sql_escape(&c.id),
        sql_escape(&c.matter_id)
    );
    let mut stream = table
        .query()
        .only_if(filter)
        .limit(1)
        .execute()
        .await
        .context("verify query")?;

    let mut found_text: Option<String> = None;
    while let Some(batch) = stream.try_next().await.context("verify stream")? {
        if batch.num_rows() == 0 {
            continue;
        }
        if let Some(tc) = batch
            .column_by_name("text")
            .and_then(|c| c.as_any().downcast_ref::<StringArray>())
        {
            found_text = Some(tc.value(0).to_string());
        }
    }

    let Some(stored) = found_text else {
        // Either id doesn't exist at all, or it exists under a different matter.
        // Distinguish the two so the caller gets an honest reason.
        return Ok(classify_missing(table, c).await?);
    };

    if normalize(&stored).contains(&normalize(&c.quoted_text)) {
        Ok(VerifyResult::Verified)
    } else {
        Ok(VerifyResult::TextMismatch)
    }
}

/// When a scoped lookup finds nothing, check whether the id exists at all under
/// any matter, to return `MatterMismatch` vs `NotFound`.
async fn classify_missing(table: &Table, c: &Citation) -> Result<VerifyResult> {
    use futures_util::TryStreamExt;
    let mut stream = table
        .query()
        .only_if(format!("id = '{}'", sql_escape(&c.id)))
        .limit(1)
        .execute()
        .await
        .context("classify query")?;
    while let Some(batch) = stream.try_next().await.context("classify stream")? {
        if batch.num_rows() == 0 {
            continue;
        }
        if let Some(mc) = batch
            .column_by_name("matter_id")
            .and_then(|c| c.as_any().downcast_ref::<StringArray>())
        {
            return Ok(VerifyResult::MatterMismatch {
                actual_matter: mc.value(0).to_string(),
            });
        }
    }
    Ok(VerifyResult::NotFound)
}

/// Whitespace-normalize for robust text containment (chunking may collapse some
/// runs of whitespace; a citation quote shouldn't fail over a stray newline).
fn normalize(s: &str) -> String {
    s.split_whitespace().collect::<Vec<_>>().join(" ")
}

// ---------------------------------------------------------------------------
// Convenience: build the whole corpus into a fresh table.
// ---------------------------------------------------------------------------

/// Index the entire spike corpus into a fresh table under `dir`. Returns the
/// open table. Chunks every source, embeds with e5-small, writes matter_id +
/// source_id + page_number per chunk.
pub async fn index_corpus(dir: &Path, model: &TextEmbedding) -> Result<Table> {
    let mut rows: Vec<Row> = Vec::new();
    for src in corpus::corpus() {
        let chunks = chunk_text(src.text);
        let texts: Vec<String> = chunks.iter().map(|c| c.text.clone()).collect();
        let vectors = embed_documents(model, &texts)?;
        for (chunk, vector) in chunks.into_iter().zip(vectors) {
            rows.push(Row {
                matter_id: src.matter_id.to_string(),
                source_id: src.source_id.to_string(),
                paragraph_index: chunk.paragraph_index,
                text: chunk.text,
                source_type: src.source_type.to_string(),
                page_number: src.page_number,
                vector,
            });
        }
    }
    let conn = open_connection(dir).await?;
    create_table(&conn, &rows).await
}
