// LanceDB-backed vector store for the RAG indexer.
//
// One dataset per workspace, living at `<workspace>/.keepance/vectors/`.
// Schema (WS-B/C extension):
//   id              : Utf8           — sha256(path || ":" || paragraph_index)
//   path            : Utf8           — absolute source path
//   matter_id       : Utf8 NOT NULL  — confidentiality scope key (WS-B/C)
//   source_id       : Utf8 NOT NULL  — originating source: file path (docs/pdf)
//                                      or "mail:<message-id>" (email). WS-B/C.
//   paragraph_index : UInt32         — chunk index inside the source
//   text            : Utf8           — chunk text AT REST. Encrypted-at-rest
//                                      (WS-VEC): hex-encoded AES-256-GCM blob
//                                      (nonce‖ciphertext‖tag). Decrypted in
//                                      memory on read; NEVER written to disk in
//                                      plaintext. See `encrypted` below + crypto.rs.
//   vector          : FixedSizeList<Float32, 384>  — PLAINTEXT (similarity needs it)
//   indexed_at      : Int64          — unix epoch seconds, debug only
//   source_type     : Utf8 (nullable) — "text" | "pdf" | "mail"; null for pre-A3 rows
//   page_number     : UInt32 (nullable) — 1-based page # for PDF, 0 for text
//   encrypted       : Boolean (nullable) — true => `text` holds AES-256-GCM ciphertext
//   privilege       : Utf8 NOT NULL  — privilege status (WS-PRIV). One of
//                                      "none" | "attorney-client" | "work-product".
//
// WS-VEC — chunk text is a CONFIDENTIALITY GUARANTEE at rest. The `text` column
// is encrypted with AES-256-GCM under the dedicated vector-store master key
// (`crypto.rs`, keychain service "keepance-vectors-enc") for EVERY source type
// (text / pdf / mail). Reads decrypt in memory; plaintext is never persisted.
//   - `matter_id` and `privilege` stay PLAINTEXT and queryable ON PURPOSE — the
//     retrieval isolation guarantee depends on them running as a LanceDB
//     PREFILTER (`only_if`) BEFORE the vector search. Encrypting them would force
//     postfiltering, which is both slower and leaks (it runs the vector search
//     over out-of-scope rows). They are intentionally NOT encrypted here.
//   - The `vector` column stays plaintext (similarity needs it); a leaked vector
//     reveals only fuzzy, non-reversible semantics.
//   - DOCUMENTED RESIDUAL (out of scope): `source_id` / `path` (file paths) and
//     `matter_id` values, being queryable, still reveal the client/matter map to
//     a disk reader. Opaque-id-ifying them is a separate follow-up.
//
// `id` is content-addressed by `(path, paragraph_index)` so re-indexing a
// file is idempotent — we delete `path = ?` first and then append, avoiding
// any need to dedupe at query time.
//
// WS-B/C — matter scoping is a CONFIDENTIALITY GUARANTEE, treat it as
// security-critical:
//   - `matter_id` is NON-NULL. A chunk with no matter is a confidentiality
//     hazard (it would leak into every scope or none), so the sentinel
//     `UNASSIGNED_MATTER` ("unassigned") is used for not-yet-categorized
//     content — never null, never empty.
//   - Scoped retrieval (`nearest` with `Some(matter_id)`) applies the matter
//     filter as a LanceDB PREFILTER (`only_if`, prefilter defaults to true),
//     so an out-of-scope row is never even a candidate for the vector search.
//     We NEVER call `.postfilter()` on a scoped query — that is the only mode
//     that could drop in-scope hits or admit approximation. Verified against
//     LanceDB 0.21 source in spikes/matter-retrieval/FEASIBILITY.md.

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
    /// Email message. `text` column holds hex-encoded AES-256-GCM ciphertext.
    Mail,
}

/// Name of the per-workspace LanceDB table that stores chunk embeddings.
pub const TABLE_NAME: &str = "chunks";

/// WS-PRIV — privilege is a LITIGATION-SAFETY GUARANTEE, treat it as
/// security-critical, parallel to matter scoping:
///   - `privilege` is NON-NULL. Every chunk carries one of the three values
///     below; never null, never empty. New rows default to `PRIVILEGE_NONE`.
///   - Privileged chunks (`PRIVILEGE_ATTORNEY_CLIENT` / `PRIVILEGE_WORK_PRODUCT`)
///     are EXCLUDED from retrieval BY DEFAULT. The scoped query composes the
///     privilege predicate with the matter predicate as a single LanceDB
///     PREFILTER (`matter_id = '..' AND privilege = 'none'`), so a privileged
///     row is never even a candidate for the vector search.
///   - The ONLY way privileged rows surface is an explicit, deliberate
///     `include_privileged = true` on the query — analogous to `AllMatters`
///     being a deliberate cross-matter capability, never the silent default.

/// Privilege status: content carries no privilege claim. The default for every
/// row; the ONLY value retrieval returns unless privileged content is explicitly
/// requested.
pub const PRIVILEGE_NONE: &str = "none";
/// Privilege status: attorney-client privileged. Excluded from retrieval by default.
pub const PRIVILEGE_ATTORNEY_CLIENT: &str = "attorney-client";
/// Privilege status: attorney work product. Excluded from retrieval by default.
pub const PRIVILEGE_WORK_PRODUCT: &str = "work-product";

/// Validate a privilege value before it is interpolated into a SQL `only_if`
/// filter or written to a row. Defence-in-depth, parallel to `validate_matter_id`:
/// only the three known, fixed values are accepted, so a degenerate or crafted
/// privilege string can never reach the predicate. Returns the value unchanged
/// if valid.
pub fn validate_privilege(privilege: &str) -> Result<&str> {
    match privilege {
        PRIVILEGE_NONE | PRIVILEGE_ATTORNEY_CLIENT | PRIVILEGE_WORK_PRODUCT => Ok(privilege),
        other => anyhow::bail!(
            "invalid privilege {:?} (expected one of: none, attorney-client, work-product)",
            other
        ),
    }
}

/// Sentinel matter id for content that has not yet been assigned to a matter.
/// WS-B/C: `matter_id` is NON-NULL by design — a null/empty matter is a
/// confidentiality hazard. Not-yet-categorized content is indexed under this
/// explicit sentinel so it is scopeable (a query scoped to "unassigned" finds
/// it) and never silently leaks into a real matter's scope.
pub const UNASSIGNED_MATTER: &str = "unassigned";

/// Schema/index version marker. Bumped when the on-disk chunk schema changes in
/// a way that requires a one-time re-index (e.g. adding the NON-NULL
/// `matter_id` / `source_id` columns in 3.0, then the NON-NULL `privilege`
/// column in WS-PRIV → version 4). Stored at
/// `<workspace>/.keepance/vectors/.index_version`. See `needs_migration`.
///
/// WS-PRIV: bumped 3 → 4. A pre-WS-PRIV table has rows without the NON-NULL
/// `privilege` column; we never back-fill (a missing privilege is a litigation-
/// safety hazard the same way a null matter is a confidentiality hazard), so the
/// migration drops + re-indexes, defaulting every row to `PRIVILEGE_NONE` and
/// then re-tagging from the privilege store.
///
/// WS-VEC: bumped 4 → 5. Versions ≤ 4 stored text/pdf chunk `text` as PLAINTEXT
/// (only mail was encrypted under the G4 scheme). Encrypting `text` at rest for
/// all source types is a confidentiality guarantee, so a pre-5 table holds
/// plaintext chunk text on disk. We never leave that behind: the migration drops
/// + re-indexes, re-encrypting every chunk's text under the dedicated vector-store
/// key. (Re-indexing also re-encrypts the formerly mail-key'd mail chunks under
/// the vector-store key, unifying the decryption key for the whole table.)
pub const INDEX_VERSION: u32 = 5;

/// Filename (under the vectors dir) holding the integer `INDEX_VERSION` the
/// current `chunks` table was built with.
const INDEX_VERSION_FILE: &str = ".index_version";

/// SQL-escape a string for safe embedding inside an `only_if` predicate. Doubles
/// single quotes (the only metacharacter that can break out of a single-quoted
/// SQL string literal), identical to what `delete_path` already does. Matter
/// ids are app-controlled, but the filter string is SECURITY-SENSITIVE so we
/// always escape — a crafted matter_id must never be able to break the predicate.
pub fn sql_escape(s: &str) -> String {
    s.replace('\'', "''")
}

/// Validate a matter id before it is interpolated into a SQL `only_if` filter.
/// Defence-in-depth on top of `sql_escape`: reject obviously malformed ids
/// (empty, or containing control characters / NULs) so a scoped query can never
/// be built from a degenerate scope key. Returns the id unchanged if valid.
pub fn validate_matter_id(matter_id: &str) -> Result<&str> {
    if matter_id.is_empty() {
        anyhow::bail!("matter_id must not be empty (use UNASSIGNED_MATTER for uncategorized content)");
    }
    if matter_id.chars().any(|c| c == '\0' || c.is_control()) {
        anyhow::bail!("matter_id contains control characters");
    }
    Ok(matter_id)
}

/// Compute the path of the LanceDB dataset for a given workspace root.
pub fn dataset_path(workspace_root: &Path) -> PathBuf {
    workspace_root.join(".keepance").join("vectors")
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
///
/// G4: one new nullable boolean column `encrypted` added at the end.
/// Existing pre-G4 datasets (rows without this column) return null → false
/// so old text/pdf rows are treated as unencrypted (correct behaviour).
pub fn build_schema() -> SchemaRef {
    Arc::new(Schema::new(vec![
        Field::new("id", DataType::Utf8, false),
        Field::new("path", DataType::Utf8, false),
        // WS-B/C: confidentiality scope key. NON-NULL — every chunk belongs to
        // exactly one matter (the sentinel UNASSIGNED_MATTER for uncategorized).
        Field::new("matter_id", DataType::Utf8, false),
        // WS-B/C: originating source — file path (docs/pdf) or "mail:<id>".
        // NON-NULL. Equals `path` today; named explicitly so the citation
        // contract is stable and resolvable independent of the `path` column.
        Field::new("source_id", DataType::Utf8, false),
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
        // WS-VEC: true for EVERY chunk written at version ≥ 5 — the text column
        // holds a hex-encoded AES-256-GCM blob (vector-store key). Nullable so a
        // stray pre-5 row (no column / false) is still readable; the version-5
        // migration drops + re-indexes such rows so nothing stays plaintext.
        // (Historically G4 set this only for mail; now all source types set it.)
        Field::new("encrypted", DataType::Boolean, true),
        // WS-PRIV: privilege status. NON-NULL — every chunk carries one of
        // "none" | "attorney-client" | "work-product". Privileged values are
        // excluded from retrieval by default. Pre-WS-PRIV tables (no column)
        // are dropped + re-indexed by the version-4 migration, never back-filled.
        Field::new("privilege", DataType::Utf8, false),
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
///
/// WS-VEC: the `text` column is encrypted at rest with AES-256-GCM under the
/// vector-store master `key` (hex-encoded nonce‖ciphertext‖tag), and `encrypted`
/// is always true. This applies to Text and Pdf chunks; Mail chunks go through
/// `build_batch_mail` (same encryption, source_type = "mail"). Plaintext chunk
/// text is NEVER written to disk for any source type. (Pre-WS-VEC this function
/// stored plaintext with encrypted=false; the version-5 migration re-indexes
/// such tables so nothing stays plaintext.)
///
/// WS-B/C: `matter_id` is the confidentiality scope key written to every row
/// (NON-NULL). `source_id` is set to the chunk's `path` (docs/pdf path), which
/// is the resolvable originating source for the citation contract. matter_id and
/// privilege stay PLAINTEXT — retrieval isolation prefilters on them.
///
/// WS-PRIV: `privilege` is the litigation-safety status written to every row
/// (NON-NULL — one of "none" | "attorney-client" | "work-product"). Privileged
/// rows are excluded from retrieval by default.
pub fn build_batch(
    rows: &[(Chunk, Vec<f32>)],
    source_type: SourceType,
    matter_id: &str,
    privilege: &str,
    key: &[u8; 32],
) -> Result<RecordBatch> {
    use crate::commands::mail::crypto::encrypt_with_key;

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
    let timestamps: Vec<i64> = vec![now; rows.len()];

    // WS-VEC: encrypt each chunk's text at rest; store as a hex blob in the text
    // column. Embeddings (the `vector` column) are computed from plaintext by the
    // caller and stay unencrypted — similarity needs them. Propagate encrypt
    // errors (never silently store an empty string with encrypted=true, which
    // would be a permanently-unrecoverable chunk).
    let mut encrypted_texts: Vec<String> = Vec::with_capacity(rows.len());
    for (c, _) in rows.iter() {
        let blob = encrypt_with_key(c.text.as_bytes(), key)
            .map_err(|e| anyhow::anyhow!("encrypt chunk {}: {e}", c.path))?;
        encrypted_texts.push(hex::encode(&blob));
    }

    let vectors = FixedSizeListArray::from_iter_primitive::<Float32Type, _, _>(
        rows.iter()
            .map(|(_, v)| Some(v.iter().copied().map(Some).collect::<Vec<_>>())),
        EMBEDDING_DIM as i32,
    );

    let id_arr = StringArray::from_iter_values(ids.iter().map(|s| s.as_str()));
    let path_arr = StringArray::from_iter_values(paths.iter().copied());
    // WS-B/C: matter_id (one value, all rows) + source_id (== path per row).
    let matter_arr = StringArray::from(vec![matter_id; rows.len()]);
    let src_arr = StringArray::from_iter_values(paths.iter().copied());
    let pi_arr = UInt32Array::from(para_idx);
    let text_arr = StringArray::from_iter_values(encrypted_texts.iter().map(|s| s.as_str()));
    let ts_arr = Int64Array::from(timestamps);

    // A3 columns — source_type and page_number.
    let (st_str, pn_val): (&str, u32) = match source_type {
        SourceType::Text => ("text", 0),
        SourceType::Pdf { page_number } => ("pdf", page_number),
        // Mail chunks MUST go through build_batch_mail so source_type = "mail".
        // Fail loudly — this is a programmer error on a code-chosen enum, never
        // data-driven.
        SourceType::Mail => unreachable!("mail chunks must use build_batch_mail, not build_batch"),
    };
    let st_arr = StringArray::from(vec![st_str; rows.len()]);
    let pn_arr = UInt32Array::from(vec![pn_val; rows.len()]);

    // WS-VEC: encrypted = true — the text column holds ciphertext, not plaintext.
    let enc_arr = arrow_array::BooleanArray::from(vec![true; rows.len()]);

    // WS-PRIV: validate the privilege value (defence-in-depth) before it is
    // written to every row. An invalid value fails the build loudly rather than
    // persisting an unscopeable privilege string.
    let privilege = validate_privilege(privilege)?;
    let priv_arr = StringArray::from(vec![privilege; rows.len()]);

    let batch = RecordBatch::try_new(
        schema,
        vec![
            Arc::new(id_arr),
            Arc::new(path_arr),
            Arc::new(matter_arr),
            Arc::new(src_arr),
            Arc::new(pi_arr),
            Arc::new(text_arr),
            Arc::new(vectors),
            Arc::new(ts_arr),
            Arc::new(st_arr),
            Arc::new(pn_arr),
            Arc::new(enc_arr),
            Arc::new(priv_arr),
        ],
    )
    .context("RecordBatch::try_new failed for chunks batch")?;
    Ok(batch)
}

/// Build a RecordBatch for mail chunks. The `text` column contains
/// hex-encoded AES-256-GCM ciphertext (encrypt_with_key). Embeddings are
/// computed from plaintext (already passed in as `rows`). `encrypted = true`.
///
/// WS-VEC: `key` is the dedicated vector-store master key (`crypto.rs`), the
/// SAME key `build_batch` uses for text/pdf chunks — so the whole `chunks` table
/// decrypts under one key. (Pre-WS-VEC this was the mail key and only mail was
/// encrypted; the version-5 migration re-indexes mail chunks under the vector
/// key.) The mail BODY's canonical encrypted copy still lives in the mail store
/// under the mail key; this is the RAG-derived copy.
///
/// WS-B/C: `matter_id` is the confidentiality scope key (NON-NULL) written to
/// every row. `source_id` is the chunk's `path` — for mail this is the
/// "mail:<message-id>" key, the resolvable source for the citation contract.
///
/// WS-PRIV: `privilege` is the litigation-safety status (NON-NULL) written to
/// every row. Privileged mail (e.g. a client communication) is excluded from
/// retrieval by default, just like a privileged document.
pub fn build_batch_mail(
    rows: &[(Chunk, Vec<f32>)],
    key: &[u8; 32],
    matter_id: &str,
    privilege: &str,
) -> Result<RecordBatch> {
    use crate::commands::mail::crypto::encrypt_with_key;

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
    let timestamps = vec![now; rows.len()];

    // Encrypt each chunk's text; store as hex string in the text column.
    // The embedding was computed from plaintext (passed in `rows`) and is stored unencrypted.
    //
    // S2: Propagate encrypt errors — an unwrap_or_default() here would silently
    // store an empty string with encrypted=true, producing a permanently-
    // unrecoverable chunk. Instead, return Err so the caller sees the failure.
    let mut encrypted_texts: Vec<String> = Vec::with_capacity(rows.len());
    for (c, _) in rows.iter() {
        let blob = encrypt_with_key(c.text.as_bytes(), key)
            .map_err(|e| anyhow::anyhow!("encrypt mail chunk {}: {e}", c.path))?;
        encrypted_texts.push(hex::encode(&blob));
    }

    let vectors = FixedSizeListArray::from_iter_primitive::<Float32Type, _, _>(
        rows.iter()
            .map(|(_, v)| Some(v.iter().copied().map(Some).collect::<Vec<_>>())),
        EMBEDDING_DIM as i32,
    );

    let id_arr = StringArray::from_iter_values(ids.iter().map(|s| s.as_str()));
    let path_arr = StringArray::from_iter_values(paths.iter().copied());
    // WS-B/C: matter_id (one value, all rows) + source_id (== path = "mail:<id>").
    let matter_arr = StringArray::from(vec![matter_id; rows.len()]);
    let src_arr = StringArray::from_iter_values(paths.iter().copied());
    let pi_arr = UInt32Array::from(para_idx);
    let text_arr = StringArray::from_iter_values(encrypted_texts.iter().map(|s| s.as_str()));
    let ts_arr = Int64Array::from(timestamps);
    let st_arr = StringArray::from(vec!["mail"; rows.len()]);
    let pn_arr = UInt32Array::from(vec![0u32; rows.len()]);
    // G4: encrypted = true — the text column holds ciphertext, not plaintext.
    let enc_arr = arrow_array::BooleanArray::from(vec![true; rows.len()]);
    // WS-PRIV: validate + write the privilege value to every mail row.
    let privilege = validate_privilege(privilege)?;
    let priv_arr = StringArray::from(vec![privilege; rows.len()]);

    RecordBatch::try_new(
        schema,
        vec![
            Arc::new(id_arr),
            Arc::new(path_arr),
            Arc::new(matter_arr),
            Arc::new(src_arr),
            Arc::new(pi_arr),
            Arc::new(text_arr),
            Arc::new(vectors),
            Arc::new(ts_arr),
            Arc::new(st_arr),
            Arc::new(pn_arr),
            Arc::new(enc_arr),
            Arc::new(priv_arr),
        ],
    )
    .context("RecordBatch::try_new failed for mail chunks batch")
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
    matter_id: &str,
    privilege: &str,
    key: &[u8; 32],
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

    // WS-VEC: build_batch encrypts the text column under the vector-store key.
    let batch = build_batch(&rows, source_type, matter_id, privilege, key)?;
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

/// WS-PRIV — re-tag the privilege of every already-indexed chunk for `path`
/// IN PLACE, without re-embedding. Used when the user toggles a source's
/// privilege: the chunk text + vectors are unchanged, only the `privilege`
/// column flips, which is exactly what changes whether the chunk is excluded
/// from default retrieval.
///
/// Implemented as a LanceDB `UPDATE ... WHERE path = ?` so it is cheap and does
/// not touch the embedder. The new value is validated against the three known
/// privilege values (defence-in-depth) and SQL-escaped both as the SET literal
/// and in the WHERE clause. Returns the number of rows updated.
///
/// Note: a source that has not been indexed yet has zero chunks; this returns 0
/// and the source picks up the right privilege when it is next indexed (the
/// privilege store is the source of truth and the index resolver reads it).
pub async fn retag_privilege_for_path(
    table: &Table,
    path: &str,
    privilege: &str,
) -> Result<u64> {
    let privilege = validate_privilege(privilege)?;
    let predicate = format!("path = '{}'", sql_escape(path));
    // The update expression is a SQL string literal for the new privilege value.
    let value_expr = format!("'{}'", sql_escape(privilege));
    let result = table
        .update()
        .only_if(predicate)
        .column("privilege", value_expr)
        .execute()
        .await
        .with_context(|| format!("retag privilege failed for {}", path))?;
    Ok(result.rows_updated)
}

/// WS-B/C — re-tag the matter of every already-indexed chunk for `path` IN
/// PLACE, without re-embedding. The mirror of `retag_privilege_for_path` for the
/// matter scope: used when a source's matter assignment changes (e.g. a mail
/// folder is mapped to a different matter) so retrieval scoping updates without
/// re-running the embedder. The chunk text + vectors are unchanged; only the
/// `matter_id` column flips, which is exactly what changes which matter scope the
/// chunk surfaces under.
///
/// `matter_id` is validated (non-empty; `UNASSIGNED_MATTER` is allowed) and
/// SQL-escaped both as the SET literal and in the WHERE clause. Returns the
/// number of rows updated (0 when the source has not been indexed yet — it will
/// pick up the right matter when next indexed, since the index path resolves the
/// matter at index time).
pub async fn retag_matter_for_path(
    table: &Table,
    path: &str,
    matter_id: &str,
) -> Result<u64> {
    let matter_id = validate_matter_id(matter_id)?;
    let predicate = format!("path = '{}'", sql_escape(path));
    let value_expr = format!("'{}'", sql_escape(matter_id));
    let result = table
        .update()
        .only_if(predicate)
        .column("matter_id", value_expr)
        .execute()
        .await
        .with_context(|| format!("retag matter failed for {}", path))?;
    Ok(result.rows_updated)
}

/// One raw query result before scoring.
#[derive(Debug, Clone)]
pub struct StoredHit {
    /// Content-addressed chunk id (sha256(path:paragraph_index)). WS-B/C: the
    /// citation key returned to the answer layer and used by verify.
    pub id: String,
    pub path: String,
    /// WS-B/C: confidentiality scope key. Absent only on pre-3.0 rows (which the
    /// migration re-indexes away), in which case None.
    pub matter_id: Option<String>,
    /// WS-B/C: originating source ("mail:<id>" or file path). None on pre-3.0 rows.
    pub source_id: Option<String>,
    pub paragraph_index: u32,
    pub text: String,
    /// Cosine distance from LanceDB. Lower is better.
    pub distance: f32,
    // A3 additions. None for pre-A3 rows that lack these columns.
    pub source_type: Option<String>,
    pub page_number: Option<u32>,
    // G4: true means `text` holds hex-encoded AES-256-GCM ciphertext; must
    // be decrypted before use. false (and null for pre-G4 rows) means plaintext.
    pub encrypted: bool,
    // WS-PRIV: the chunk's privilege status. None only on a pre-WS-PRIV row
    // (which the version-4 migration re-indexes away). Default retrieval only
    // returns "none"; this is surfaced so the UI can label an explicitly-
    // included privileged hit.
    pub privilege: Option<String>,
}

/// Compose the LanceDB `only_if` PREFILTER predicate for a retrieval query from
/// the matter scope and the privilege rule. This is the single place the two
/// security boundaries are AND-ed together, so the composition is auditable and
/// tested as a unit.
///
/// WS-B/C — matter scope:
///   - `scope = Some(matter_id)` → `matter_id = '<escaped>'`
///   - `scope = None`            → no matter clause (deliberate cross-matter)
///
/// WS-PRIV — privilege rule (litigation safety):
///   - `include_privileged = false` (the DEFAULT) → `privilege = 'none'`, so
///     attorney-client / work-product rows are never even candidates.
///   - `include_privileged = true` (deliberate)   → no privilege clause.
///
/// Both clauses are validated + SQL-escaped before interpolation. Returns
/// `None` only when BOTH are absent (cross-matter AND include-privileged) — a
/// fully unconstrained scan that callers must reach via two explicit choices.
pub fn build_retrieval_predicate(
    scope: Option<&str>,
    include_privileged: bool,
) -> Result<Option<String>> {
    let mut clauses: Vec<String> = Vec::with_capacity(2);
    if let Some(matter_id) = scope {
        let matter_id = validate_matter_id(matter_id)?;
        clauses.push(format!("matter_id = '{}'", sql_escape(matter_id)));
    }
    if !include_privileged {
        // Default exclusion: only non-privileged content. PRIVILEGE_NONE is a
        // fixed constant, but escape it anyway so the predicate-building rule is
        // uniform and future-proof.
        clauses.push(format!("privilege = '{}'", sql_escape(PRIVILEGE_NONE)));
    }
    Ok(if clauses.is_empty() {
        None
    } else {
        Some(clauses.join(" AND "))
    })
}

/// Nearest-neighbor search. Returns up to `top_k` raw hits.
///
/// WS-B/C — `scope` is the confidentiality boundary:
///   - `Some(matter_id)` constrains results to that matter via a store-level
///     LanceDB PREFILTER (`only_if`). LanceDB defaults `prefilter = true`, so
///     the SQL predicate is pushed into the scan and the vector search runs ONLY
///     over rows already in scope — an out-of-scope row can never be a candidate,
///     so similarity cannot surface it. This is the matter-isolation guarantee.
///   - `None` searches ALL matters (a deliberate, caller-audited cross-matter
///     path — never the silent default; the `rag_retrieve` command requires an
///     explicit scope and only reaches `None` via the named `AllMatters` action).
///
/// WS-PRIV — `include_privileged` is the litigation-safety boundary, composed
/// into the SAME prefilter as the matter scope:
///   - `false` (DEFAULT) appends `AND privilege = 'none'`, so attorney-client /
///     work-product chunks are never candidates — they cannot surface even if
///     they are the single most semantically relevant row.
///   - `true` is a deliberate, separately-named capability (mirrors AllMatters)
///     that omits the privilege clause so privileged content can be retrieved.
///
/// SECURITY: we NEVER call `.postfilter()` here. Postfilter runs the vector
/// search first and filters afterward, which can both drop in-scope hits and
/// admit ranking approximation. The scoped path must stay prefilter-only.
pub async fn nearest(
    table: &Table,
    query_vec: &[f32],
    top_k: usize,
    scope: Option<&str>,
    include_privileged: bool,
) -> Result<Vec<StoredHit>> {
    use futures_util::TryStreamExt;
    let mut query = table
        .query()
        .nearest_to(query_vec)
        .context("nearest_to failed")?
        .limit(top_k);
    // WS-B/C + WS-PRIV: compose the matter AND privilege predicate. It is part
    // of the query PLAN (prefilter), not a post-hoc filter on the returned Vec.
    if let Some(predicate) = build_retrieval_predicate(scope, include_privileged)? {
        query = query.only_if(predicate);
    }
    let mut stream = query
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
        // WS-B/C: id is the citation key; matter_id/source_id are nullable here
        // only to tolerate a pre-3.0 row sneaking through (the migration prevents
        // that), so we read them defensively rather than requiring the columns.
        let id_col = batch
            .column_by_name("id")
            .and_then(|c| c.as_any().downcast_ref::<StringArray>());
        let matter_col = batch
            .column_by_name("matter_id")
            .and_then(|c| c.as_any().downcast_ref::<StringArray>());
        let source_col = batch
            .column_by_name("source_id")
            .and_then(|c| c.as_any().downcast_ref::<StringArray>());
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
        // G4: read nullable encrypted column. Absent on pre-G4 rows → false (plaintext).
        let enc_col = batch
            .column_by_name("encrypted")
            .and_then(|c| c.as_any().downcast_ref::<arrow_array::BooleanArray>());
        // WS-PRIV: read the privilege column. Absent on pre-WS-PRIV rows → None.
        let priv_col = batch
            .column_by_name("privilege")
            .and_then(|c| c.as_any().downcast_ref::<StringArray>());

        for i in 0..batch.num_rows() {
            let distance = dist_col.map(|c| c.value(i)).unwrap_or(0.0);
            let source_type = st_col
                .filter(|c| !c.is_null(i))
                .map(|c| c.value(i).to_string());
            let page_number = pn_col.filter(|c| !c.is_null(i)).map(|c| c.value(i));
            // G4: null or absent encrypted column → false (pre-G4 plaintext row).
            let encrypted = enc_col.map(|c| !c.is_null(i) && c.value(i)).unwrap_or(false);
            let id = id_col
                .filter(|c| !c.is_null(i))
                .map(|c| c.value(i).to_string())
                .unwrap_or_default();
            let matter_id = matter_col
                .filter(|c| !c.is_null(i))
                .map(|c| c.value(i).to_string());
            let source_id = source_col
                .filter(|c| !c.is_null(i))
                .map(|c| c.value(i).to_string());
            let privilege = priv_col
                .filter(|c| !c.is_null(i))
                .map(|c| c.value(i).to_string());
            out.push(StoredHit {
                id,
                path: path_col.value(i).to_string(),
                matter_id,
                source_id,
                paragraph_index: pi_col.value(i),
                text: text_col.value(i).to_string(),
                distance,
                source_type,
                page_number,
                encrypted,
                privilege,
            });
        }
    }
    Ok(out)
}

// ---------------------------------------------------------------------------
// WS-B/C: point lookup for citation verification.
// ---------------------------------------------------------------------------

/// A single row located by an exact `id` lookup, used by citation verification.
/// Carries the stored matter_id and (decrypt-pending) text so the caller can
/// assert scope and quoted-text containment.
#[derive(Debug, Clone)]
pub struct ChunkRecord {
    pub id: String,
    pub matter_id: String,
    pub source_id: String,
    pub paragraph_index: u32,
    /// Raw stored text. If `encrypted` is true this is hex-encoded ciphertext
    /// the caller must decrypt before comparing.
    pub text: String,
    pub encrypted: bool,
    /// WS-PRIV: the chunk's privilege status (None only on a pre-WS-PRIV row).
    /// Verification does NOT filter on privilege — a privileged source must still
    /// verify for an explicitly-included query — but the value is surfaced so the
    /// caller can audit/label it.
    pub privilege: Option<String>,
}

/// Look up at most one chunk by its content-addressed `id`. Optionally
/// constrain to a matter (`scope`) — verification uses this to require that the
/// chunk both exists AND lives in the claimed matter (a prefiltered point read).
/// Returns None if no row matches. SECURITY: id + matter_id are escaped before
/// interpolation.
pub async fn lookup_by_id(
    table: &Table,
    id: &str,
    scope: Option<&str>,
) -> Result<Option<ChunkRecord>> {
    use futures_util::TryStreamExt;
    let predicate = match scope {
        Some(matter_id) => {
            let matter_id = validate_matter_id(matter_id)?;
            format!(
                "id = '{}' AND matter_id = '{}'",
                sql_escape(id),
                sql_escape(matter_id)
            )
        }
        None => format!("id = '{}'", sql_escape(id)),
    };
    let mut stream = table
        .query()
        .only_if(predicate)
        .limit(1)
        .execute()
        .await
        .context("lookup_by_id query execute failed")?;

    while let Some(batch) = stream
        .try_next()
        .await
        .context("lookup_by_id stream try_next failed")?
    {
        if batch.num_rows() == 0 {
            continue;
        }
        let str_col = |name: &str| -> Option<&StringArray> {
            batch
                .column_by_name(name)
                .and_then(|c| c.as_any().downcast_ref::<StringArray>())
        };
        let id_v = str_col("id").map(|c| c.value(0).to_string()).unwrap_or_default();
        let matter_v = str_col("matter_id")
            .map(|c| c.value(0).to_string())
            .unwrap_or_default();
        let source_v = str_col("source_id")
            .map(|c| c.value(0).to_string())
            .unwrap_or_default();
        let text_v = str_col("text").map(|c| c.value(0).to_string()).unwrap_or_default();
        let pi_v = batch
            .column_by_name("paragraph_index")
            .and_then(|c| c.as_any().downcast_ref::<UInt32Array>())
            .map(|c| c.value(0))
            .unwrap_or(0);
        let enc_v = batch
            .column_by_name("encrypted")
            .and_then(|c| c.as_any().downcast_ref::<arrow_array::BooleanArray>())
            .map(|c| !c.is_null(0) && c.value(0))
            .unwrap_or(false);
        let priv_v = str_col("privilege")
            .filter(|c| !c.is_null(0))
            .map(|c| c.value(0).to_string());
        return Ok(Some(ChunkRecord {
            id: id_v,
            matter_id: matter_v,
            source_id: source_v,
            paragraph_index: pi_v,
            text: text_v,
            encrypted: enc_v,
            privilege: priv_v,
        }));
    }
    Ok(None)
}

// ---------------------------------------------------------------------------
// WS-B/C: version-aware migration.
// ---------------------------------------------------------------------------

/// Path of the index-version marker file for a workspace's vector dir.
fn index_version_path(workspace_root: &Path) -> PathBuf {
    dataset_path(workspace_root).join(INDEX_VERSION_FILE)
}

/// Read the index version the on-disk `chunks` table was built with. Returns 0
/// when the marker is absent (i.e. a pre-3.0 table, or no table yet).
pub fn read_index_version(workspace_root: &Path) -> u32 {
    std::fs::read_to_string(index_version_path(workspace_root))
        .ok()
        .and_then(|s| s.trim().parse::<u32>().ok())
        .unwrap_or(0)
}

/// Stamp the current `INDEX_VERSION` into the marker file. Called once after a
/// successful (re-)index so the migration runs at most once.
pub fn write_index_version(workspace_root: &Path) -> Result<()> {
    let path = index_version_path(workspace_root);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).ok();
    }
    std::fs::write(&path, INDEX_VERSION.to_string())
        .with_context(|| format!("write index version marker at {:?}", path))?;
    Ok(())
}

/// WS-B/C migration check: does this workspace need a one-time re-index because
/// its vectors predate the NON-NULL `matter_id` / `source_id` columns?
///
/// True iff a `chunks` table already exists AND its version marker is below
/// `INDEX_VERSION`. A fresh workspace (no table) returns false — there is
/// nothing to migrate; new content is written with the columns from the start.
///
/// We deliberately do NOT back-fill nulls: a null matter_id is a confidentiality
/// hazard. The caller drops the old table and re-indexes, assigning the
/// `UNASSIGNED_MATTER` sentinel, then calls `write_index_version`.
pub async fn needs_migration(conn: &Connection, workspace_root: &Path) -> Result<bool> {
    if read_index_version(workspace_root) >= INDEX_VERSION {
        return Ok(false);
    }
    let names = conn
        .table_names()
        .execute()
        .await
        .context("table_names failed during migration check")?;
    let table_exists = names.iter().any(|n| n == TABLE_NAME);
    Ok(table_exists)
}

/// Drop the legacy `chunks` table so the caller can re-index from scratch under
/// the 3.0 schema. Used by the one-time migration when `needs_migration` is true.
/// No-op if the table doesn't exist.
pub async fn drop_table(conn: &Connection) -> Result<()> {
    let names = conn
        .table_names()
        .execute()
        .await
        .context("table_names failed before drop")?;
    if names.iter().any(|n| n == TABLE_NAME) {
        conn.drop_table(TABLE_NAME)
            .await
            .context("drop_table chunks failed")?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Fixed 32-byte key for tests (bypasses the keychain). WS-VEC: every chunk's
    /// text column is now AES-256-GCM ciphertext, so tests must supply a key to
    /// `build_batch` and decrypt the column to read back the plaintext.
    const TEST_KEY: [u8; 32] = [0x42u8; 32];

    /// Decrypt the hex-encoded ciphertext stored in the `text` column at row `i`
    /// back to its plaintext String, using `key`. Mirrors what `rag_retrieve` and
    /// `rag_verify_citation` do on read.
    fn decrypt_text_col(batch: &RecordBatch, i: usize, key: &[u8; 32]) -> String {
        use arrow_array::cast::AsArray;
        use crate::commands::mail::crypto::decrypt_with_key;
        let stored_hex = batch.column_by_name("text").expect("text col").as_string::<i32>().value(i);
        let blob = hex::decode(stored_hex).expect("hex decode text column");
        String::from_utf8(decrypt_with_key(&blob, key).expect("decrypt text column")).expect("utf8")
    }

    #[test]
    fn dataset_path_lives_under_dot_keepance() {
        let p = dataset_path(Path::new("/tmp/work"));
        assert_eq!(p, PathBuf::from("/tmp/work/.keepance/vectors"));
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
    fn schema_has_canonical_fields_in_order() {
        let s = build_schema();
        let names: Vec<_> = s.fields().iter().map(|f| f.name().as_str()).collect();
        assert_eq!(
            names,
            vec![
                "id",
                "path",
                "matter_id",
                "source_id",
                "paragraph_index",
                "text",
                "vector",
                "indexed_at",
                "source_type",
                "page_number",
                "encrypted",
                "privilege",
            ]
        );
    }

    #[test]
    fn matter_id_and_source_id_are_non_nullable() {
        // WS-B/C: a null matter_id is a confidentiality hazard. The schema must
        // forbid it (and source_id) at the column level.
        // WS-PRIV: a null privilege is a litigation-safety hazard — forbid it too.
        let s = build_schema();
        for name in ["matter_id", "source_id", "privilege"] {
            let f = s.field_with_name(name).expect("field present");
            assert!(!f.is_nullable(), "{name} must be NOT NULL");
        }
    }

    #[test]
    fn sql_escape_doubles_single_quotes() {
        assert_eq!(sql_escape("a'b"), "a''b");
        assert_eq!(sql_escape("o'neil's"), "o''neil''s");
        assert_eq!(sql_escape("clean"), "clean");
    }

    #[test]
    fn validate_matter_id_rejects_empty_and_control_chars() {
        assert!(validate_matter_id("").is_err());
        assert!(validate_matter_id("matter\0id").is_err());
        assert!(validate_matter_id("good-uuid-1234").is_ok());
        assert!(validate_matter_id(UNASSIGNED_MATTER).is_ok());
    }

    // -----------------------------------------------------------------------
    // WS-PRIV: privilege validation + composed-prefilter construction.
    // -----------------------------------------------------------------------

    #[test]
    fn validate_privilege_accepts_only_known_values() {
        assert!(validate_privilege(PRIVILEGE_NONE).is_ok());
        assert!(validate_privilege(PRIVILEGE_ATTORNEY_CLIENT).is_ok());
        assert!(validate_privilege(PRIVILEGE_WORK_PRODUCT).is_ok());
        // Anything else is rejected, never silently coerced — a degenerate
        // privilege string must not be able to reach the SQL predicate.
        assert!(validate_privilege("").is_err());
        assert!(validate_privilege("privileged").is_err());
        assert!(validate_privilege("none' OR '1'='1").is_err());
        assert!(validate_privilege("attorney_client").is_err()); // underscore, not hyphen
    }

    #[test]
    fn build_batch_writes_privilege_value() {
        use arrow_array::cast::AsArray;
        let rows = vec![(
            Chunk {
                path: "/w/memo.md".into(),
                paragraph_index: 0,
                text: "work product memo".into(),
                start_offset: 0,
                end_offset: 17,
            },
            vec![0.1f32; EMBEDDING_DIM],
        )];
        let batch = build_batch(&rows, SourceType::Text, "matter-acme", PRIVILEGE_WORK_PRODUCT, &TEST_KEY)
            .expect("build_batch");
        let priv_col = batch
            .column_by_name("privilege")
            .expect("privilege col")
            .as_string::<i32>();
        assert_eq!(priv_col.value(0), PRIVILEGE_WORK_PRODUCT);
    }

    #[test]
    fn build_batch_rejects_invalid_privilege() {
        let rows = vec![(
            Chunk {
                path: "/w/x.md".into(),
                paragraph_index: 0,
                text: "x".into(),
                start_offset: 0,
                end_offset: 1,
            },
            vec![0.1f32; EMBEDDING_DIM],
        )];
        // A bad privilege value fails the build loudly rather than persisting an
        // unscopeable row.
        assert!(build_batch(&rows, SourceType::Text, UNASSIGNED_MATTER, "bogus", &TEST_KEY).is_err());
    }

    // ---- build_retrieval_predicate: the single place matter AND privilege compose.

    #[test]
    fn predicate_default_excludes_privileged_with_matter_scope() {
        // The DEFAULT (include_privileged = false) composes matter AND privilege
        // into one prefilter: `matter_id = '..' AND privilege = 'none'`.
        let p = build_retrieval_predicate(Some("matter-acme"), false)
            .expect("predicate")
            .expect("some predicate");
        assert_eq!(p, "matter_id = 'matter-acme' AND privilege = 'none'");
    }

    #[test]
    fn predicate_default_excludes_privileged_even_cross_matter() {
        // Cross-matter (scope None) still excludes privileged by default — the
        // privilege clause stands alone.
        let p = build_retrieval_predicate(None, false)
            .expect("predicate")
            .expect("some predicate");
        assert_eq!(p, "privilege = 'none'");
    }

    #[test]
    fn predicate_include_privileged_drops_privilege_clause() {
        // include_privileged = true is the deliberate capability: only the matter
        // clause remains; privileged rows become candidates.
        let p = build_retrieval_predicate(Some("matter-acme"), true)
            .expect("predicate")
            .expect("some predicate");
        assert_eq!(p, "matter_id = 'matter-acme'");
    }

    #[test]
    fn predicate_fully_unconstrained_only_when_both_chosen() {
        // The only way to a None predicate (no prefilter at all) is BOTH explicit
        // choices: cross-matter AND include-privileged. Neither is a silent default.
        let p = build_retrieval_predicate(None, true).expect("predicate");
        assert!(p.is_none(), "cross-matter + include-privileged => no prefilter");
    }

    #[test]
    fn predicate_sql_escapes_matter_id() {
        // SECURITY: a crafted matter id is escaped inside the composed predicate.
        let p = build_retrieval_predicate(Some("a'b"), false)
            .expect("predicate")
            .expect("some predicate");
        assert_eq!(p, "matter_id = 'a''b' AND privilege = 'none'");
    }

    #[test]
    fn predicate_rejects_invalid_matter_id() {
        assert!(build_retrieval_predicate(Some("bad\0id"), false).is_err());
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
        let batch = build_batch(&chunks, SourceType::Text, UNASSIGNED_MATTER, PRIVILEGE_NONE, &TEST_KEY)
            .expect("build_batch");
        assert_eq!(batch.num_rows(), 2);
        // 12 columns: id, path, matter_id, source_id, paragraph_index, text,
        // vector, indexed_at, source_type, page_number, encrypted, privilege
        assert_eq!(batch.num_columns(), 12);
    }

    #[test]
    fn build_batch_writes_matter_id_and_source_id() {
        use arrow_array::cast::AsArray;
        let rows = vec![(
            Chunk {
                path: "/w/contract.md".into(),
                paragraph_index: 0,
                text: "hello".into(),
                start_offset: 0,
                end_offset: 5,
            },
            vec![0.1f32; EMBEDDING_DIM],
        )];
        let batch = build_batch(&rows, SourceType::Text, "matter-acme", PRIVILEGE_NONE, &TEST_KEY).expect("build_batch");
        let matter_col = batch.column_by_name("matter_id").expect("matter_id col").as_string::<i32>();
        assert_eq!(matter_col.value(0), "matter-acme");
        // source_id mirrors the path (the resolvable originating source).
        let src_col = batch.column_by_name("source_id").expect("source_id col").as_string::<i32>();
        assert_eq!(src_col.value(0), "/w/contract.md");
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
        let batch = build_batch(&rows, SourceType::Text, UNASSIGNED_MATTER, PRIVILEGE_NONE, &TEST_KEY).expect("build_batch text");
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
        let batch = build_batch(&rows, SourceType::Pdf { page_number: 3 }, UNASSIGNED_MATTER, PRIVILEGE_NONE, &TEST_KEY)
            .expect("build_batch pdf");
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

    // -----------------------------------------------------------------------
    // WS-VEC regression tests: EVERY source type (text / pdf / mail) must store
    // ciphertext in the text column + encrypted=true. Plaintext chunk text must
    // never land in the column. (Pre-WS-VEC these tests asserted text/pdf were
    // plaintext; that invariant is intentionally inverted now.)
    // -----------------------------------------------------------------------

    #[test]
    fn build_batch_text_source_encrypts_text_column_ws_vec() {
        use arrow_array::cast::AsArray;
        let plaintext = "hello world";
        let rows = vec![(
            Chunk {
                path: "/a.md".into(),
                paragraph_index: 0,
                text: plaintext.into(),
                start_offset: 0,
                end_offset: 11,
            },
            vec![0.1f32; EMBEDDING_DIM],
        )];
        let batch = build_batch(&rows, SourceType::Text, UNASSIGNED_MATTER, PRIVILEGE_NONE, &TEST_KEY).expect("build_batch text");
        // WS-VEC: the text column must NOT contain the plaintext.
        let text_col = batch.column_by_name("text").expect("text col").as_string::<i32>();
        assert!(
            !text_col.value(0).contains(plaintext),
            "text-source text column must be ciphertext (WS-VEC), not plaintext"
        );
        // But it must decrypt back to the original plaintext.
        assert_eq!(decrypt_text_col(&batch, 0, &TEST_KEY), plaintext);
        // source_type must still be "text".
        let st_col = batch.column_by_name("source_type").expect("st col").as_string::<i32>();
        assert_eq!(st_col.value(0), "text");
        // WS-VEC: encrypted column must be true for text rows now.
        let enc_col = batch
            .column_by_name("encrypted")
            .expect("encrypted column must exist")
            .as_boolean();
        assert!(enc_col.value(0), "WS-VEC: text rows must have encrypted=true");
    }

    #[test]
    fn build_batch_pdf_source_encrypts_text_column_ws_vec() {
        use arrow_array::cast::AsArray;
        let plaintext = "page text";
        let rows = vec![(
            Chunk {
                path: "/a.pdf".into(),
                paragraph_index: 0,
                text: plaintext.into(),
                start_offset: 0,
                end_offset: 9,
            },
            vec![0.1f32; EMBEDDING_DIM],
        )];
        let batch = build_batch(&rows, SourceType::Pdf { page_number: 3 }, UNASSIGNED_MATTER, PRIVILEGE_NONE, &TEST_KEY)
            .expect("build_batch pdf");
        let text_col = batch.column_by_name("text").expect("text col").as_string::<i32>();
        assert!(
            !text_col.value(0).contains(plaintext),
            "pdf-source text column must be ciphertext (WS-VEC), not plaintext"
        );
        assert_eq!(decrypt_text_col(&batch, 0, &TEST_KEY), plaintext);
        let st_col = batch.column_by_name("source_type").expect("st col").as_string::<i32>();
        assert_eq!(st_col.value(0), "pdf");
        let enc_col = batch
            .column_by_name("encrypted")
            .expect("encrypted column must exist")
            .as_boolean();
        assert!(enc_col.value(0), "WS-VEC: pdf rows must have encrypted=true");
    }

    #[test]
    fn build_batch_mail_source_stores_ciphertext_in_text_column() {
        use arrow_array::cast::AsArray;
        let plaintext = "Re: closing — see you at 10am.";
        let key = [0x42u8; 32];
        let rows = vec![(
            Chunk {
                path: "mail:AAMk-abc".into(),
                paragraph_index: 0,
                text: plaintext.to_string(),
                start_offset: 0,
                end_offset: plaintext.len(),
            },
            vec![0.1f32; EMBEDDING_DIM],
        )];
        let batch = build_batch_mail(&rows, &key, UNASSIGNED_MATTER, PRIVILEGE_NONE).expect("build_batch mail");
        let text_col = batch.column_by_name("text").expect("text col").as_string::<i32>();
        let stored = text_col.value(0);
        // The text column must NOT contain the plaintext.
        assert!(
            !stored.contains(plaintext),
            "mail text column must contain ciphertext, not plaintext; got: {:?}",
            &stored[..stored.len().min(30)]
        );
        // source_type must be "mail".
        let st_col = batch.column_by_name("source_type").expect("st col").as_string::<i32>();
        assert_eq!(st_col.value(0), "mail");
        // encrypted must be true.
        let enc_col = batch.column_by_name("encrypted").expect("enc col").as_boolean();
        assert!(enc_col.value(0), "mail rows must have encrypted=true");
    }

    #[test]
    fn build_batch_mail_ciphertext_decrypts_to_original_plaintext() {
        use arrow_array::cast::AsArray;
        use crate::commands::mail::crypto::decrypt_with_key;
        let plaintext = "Confidential: closing scheduled for 10am.";
        let key = [0x77u8; 32];
        let rows = vec![(
            Chunk {
                path: "mail:m1".into(),
                paragraph_index: 0,
                text: plaintext.to_string(),
                start_offset: 0,
                end_offset: plaintext.len(),
            },
            vec![0.1f32; EMBEDDING_DIM],
        )];
        let batch = build_batch_mail(&rows, &key, UNASSIGNED_MATTER, PRIVILEGE_NONE).expect("build batch");
        let text_col = batch.column_by_name("text").expect("text col").as_string::<i32>();
        let stored_hex = text_col.value(0);
        let blob = hex::decode(stored_hex).expect("hex decode");
        let recovered = decrypt_with_key(&blob, &key).expect("decrypt");
        assert_eq!(
            String::from_utf8(recovered).expect("utf8"),
            plaintext,
            "decrypted ciphertext must equal original plaintext"
        );
    }

    // S2 tests ----------------------------------------------------------------

    /// S2: build_batch_mail must never produce an empty text column for a
    /// successfully-built batch. Previously the .unwrap_or_default() would
    /// silently store "" with encrypted=true on encryption failure.
    /// This test confirms the success path stores a non-empty hex ciphertext,
    /// exercising the loop that replaced the map+unwrap_or_default.
    #[test]
    fn build_batch_mail_s2_no_empty_ciphertext_on_success() {
        use arrow_array::cast::AsArray;
        let key = [0xAAu8; 32];
        let rows = vec![
            (
                Chunk {
                    path: "mail:a1".into(),
                    paragraph_index: 0,
                    text: "First confidential paragraph.".into(),
                    start_offset: 0,
                    end_offset: 30,
                },
                vec![0.1f32; EMBEDDING_DIM],
            ),
            (
                Chunk {
                    path: "mail:a1".into(),
                    paragraph_index: 1,
                    text: "Second confidential paragraph.".into(),
                    start_offset: 31,
                    end_offset: 61,
                },
                vec![0.2f32; EMBEDDING_DIM],
            ),
        ];
        let batch = build_batch_mail(&rows, &key, UNASSIGNED_MATTER, PRIVILEGE_NONE).expect("build_batch_mail must succeed");
        let text_col = batch.column_by_name("text").expect("text col").as_string::<i32>();
        // Every row must have a non-empty hex ciphertext — the S2 fix removes the
        // unwrap_or_default() that would silently store "" on failure.
        for i in 0..batch.num_rows() {
            let stored = text_col.value(i);
            assert!(
                !stored.is_empty(),
                "S2: row {} text column must not be empty (was unwrap_or_default)",
                i
            );
            // Must be valid hex (would decode and decrypt to the plaintext).
            assert!(
                hex::decode(stored).is_ok(),
                "S2: row {} text column must be valid hex ciphertext",
                i
            );
        }
    }

    /// S2: build_batch_mail called with a single-row batch must return Ok (not
    /// silently swallow an encrypt error). Verifying the batch propagates
    /// correctly through the row-by-row error path.
    #[test]
    fn build_batch_mail_s2_single_row_returns_ok_with_valid_key() {
        let key = [0xBBu8; 32];
        let rows = vec![(
            Chunk {
                path: "mail:singleton".into(),
                paragraph_index: 0,
                text: "One chunk.".into(),
                start_offset: 0,
                end_offset: 10,
            },
            vec![0.5f32; EMBEDDING_DIM],
        )];
        // Should succeed — verifies the for-loop path (not the old .map iterator).
        let result = build_batch_mail(&rows, &key, UNASSIGNED_MATTER, PRIVILEGE_NONE);
        assert!(result.is_ok(), "S2: single-row build_batch_mail must return Ok; got {:?}", result.err());
    }

    // WS-B/C — mail is scoped by matter exactly like files ---------------------

    /// Add a single mail chunk to `table` under `matter_id` with a deterministic
    /// vector (no embedder needed). `seed` differentiates the vectors so the
    /// nearest-neighbour ordering is stable.
    async fn add_mail_chunk(table: &Table, path: &str, matter_id: &str, seed: f32) {
        let key = [0x42u8; 32];
        let rows = vec![(
            Chunk {
                path: path.into(),
                paragraph_index: 0,
                text: format!("confidential body for {path}"),
                start_offset: 0,
                end_offset: 10,
            },
            vec![seed; EMBEDDING_DIM],
        )];
        let batch = build_batch_mail(&rows, &key, matter_id, PRIVILEGE_NONE).expect("build mail batch");
        let schema = batch.schema();
        table
            .add(Box::new(RecordBatchIterator::new(vec![Ok(batch)], schema)))
            .execute()
            .await
            .expect("add mail chunk");
    }

    /// An email indexed under Matter A must be retrievable under the Matter A
    /// scope and MUST NOT surface under the Matter B scope — the same matter
    /// prefilter that scopes files, applied to `mail:<id>` chunks.
    #[tokio::test]
    async fn mail_chunk_is_retrievable_only_under_its_matter_scope() {
        let dir = tempfile::TempDir::new().unwrap();
        let conn = open_connection(dir.path()).await.expect("open conn");
        let table = open_or_create_table(&conn).await.expect("open table");

        add_mail_chunk(&table, "mail:a-msg", "matter_a", 0.10).await;
        add_mail_chunk(&table, "mail:b-msg", "matter_b", 0.11).await;

        let q = vec![0.10f32; EMBEDDING_DIM];

        // Scoped to Matter A: only the Matter-A mail comes back.
        let hits_a = nearest(&table, &q, 10, Some("matter_a"), false).await.expect("nearest a");
        let paths_a: Vec<&str> = hits_a.iter().map(|h| h.path.as_str()).collect();
        assert!(paths_a.contains(&"mail:a-msg"), "Matter A scope must return Matter A mail");
        assert!(!paths_a.contains(&"mail:b-msg"), "Matter A scope must NOT return Matter B mail");

        // Scoped to Matter B: only the Matter-B mail comes back.
        let hits_b = nearest(&table, &q, 10, Some("matter_b"), false).await.expect("nearest b");
        let paths_b: Vec<&str> = hits_b.iter().map(|h| h.path.as_str()).collect();
        assert!(paths_b.contains(&"mail:b-msg"));
        assert!(!paths_b.contains(&"mail:a-msg"));
    }

    /// Re-tagging a mail's matter IN PLACE moves which scope it surfaces under,
    /// without re-embedding — the engine half of the folder->matter remap path.
    #[tokio::test]
    async fn retag_matter_for_path_moves_mail_between_scopes() {
        let dir = tempfile::TempDir::new().unwrap();
        let conn = open_connection(dir.path()).await.expect("open conn");
        let table = open_or_create_table(&conn).await.expect("open table");

        add_mail_chunk(&table, "mail:movable", "matter_a", 0.10).await;
        let q = vec![0.10f32; EMBEDDING_DIM];

        // Initially under Matter A.
        let before = nearest(&table, &q, 10, Some("matter_a"), false).await.unwrap();
        assert!(before.iter().any(|h| h.path == "mail:movable"));

        // Re-tag to Matter B in place.
        let updated = retag_matter_for_path(&table, "mail:movable", "matter_b").await.expect("retag");
        assert_eq!(updated, 1, "exactly one chunk re-tagged");

        // Now it is gone from Matter A and present under Matter B.
        let after_a = nearest(&table, &q, 10, Some("matter_a"), false).await.unwrap();
        assert!(!after_a.iter().any(|h| h.path == "mail:movable"), "must leave Matter A after re-tag");
        let after_b = nearest(&table, &q, 10, Some("matter_b"), false).await.unwrap();
        assert!(after_b.iter().any(|h| h.path == "mail:movable"), "must appear under Matter B after re-tag");
    }
}
