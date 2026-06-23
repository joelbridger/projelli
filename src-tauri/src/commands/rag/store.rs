// LanceDB-backed vector store for the RAG indexer.
//
// One dataset per workspace, living at `<workspace>/.keepance/vectors/`.
// Schema (WS-B/C extension):
//   id              : Utf8           — sha256(path || ":" || paragraph_index),
//                                      computed from the PLAINTEXT path (the
//                                      content-addressed citation contract is
//                                      independent of the at-rest tokenization).
//   path            : Utf8           — VG-6e: deterministic keyed TOKEN of the
//                                      source path (crypto::path_token — HMAC-
//                                      SHA256 under a key derived from the
//                                      vector master key). NEVER plaintext.
//                                      Deterministic so every equality
//                                      predicate (upsert delete / delete_path /
//                                      retag) keeps working.
//   matter_id       : Utf8 NOT NULL  — confidentiality scope key (WS-B/C)
//   source_id       : Utf8 NOT NULL  — originating source: file path (docs/pdf)
//                                      or "mail:<message-id>" (email). WS-B/C.
//                                      VG-6e: holds the SAME token as `path`
//                                      (source_id == path by construction);
//                                      the real value is recovered from
//                                      `path_enc` on read.
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
//   extraction      : Utf8 (nullable) — "ocr" when the chunk text was read from
//                                      a scanned page by the local OCR engine
//                                      (VG-2); null for natively-extracted text.
//   extraction_confidence : Float32 (nullable) — mean OCR word confidence
//                                      (0-100) for the chunk's page; null on
//                                      native chunks.
//   locator         : Utf8 (nullable) — VG-3c page:line locator for certified
//                                      deposition transcripts
//                                      ("startPage:startLine-endPage:endLine",
//                                      e.g. "45:12-46:3"); null on every other
//                                      source. Metadata ON TOP of the unchanged
//                                      sequential paragraph_index — the
//                                      content-addressed citation contract is
//                                      untouched.
//   path_enc        : Utf8 NOT NULL  — VG-6e: the REAL source path, encrypted
//                                      at rest (hex AES-256-GCM under the
//                                      vector master key — the exact
//                                      chunk-text pattern). Decrypted on read
//                                      so Hit.path / Hit.source_id still hand
//                                      the frontend real paths for display and
//                                      click-through.
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
//   - VG-6e closed the former path residual: `path` / `source_id` hold opaque
//     deterministic HMAC tokens (equality predicates keep working) and the real
//     path is recovered from the encrypted `path_enc` column on read. The
//     REMAINING residual, documented honestly (and in the user-facing Data
//     Map): `matter_id` and `privilege` values stay readable on disk because
//     isolation prefilters on them, and the embedding vectors are stored as
//     plain floats by design. One more, subtle: `id` below is UNKEYED
//     sha256(path, paragraph_index), so a raw-disk reader who GUESSES an
//     exact absolute path can confirm the guess by hashing it against the
//     id column. Browsing/recovery of paths stays closed (that needs the
//     key); guess-CONFIRMATION survives. Keying the id would break the
//     content-address contract (review-accepted residual, Wave 2 Task 10).
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
    query::{ExecutableQuery, QueryBase, Select},
    Connection, Table,
};
use sha2::{Digest, Sha256};
use std::collections::HashSet;
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
    // VG-2b — office documents. Word-processing formats chunk like text
    // (page_number 0); sectioned formats band like PDF pages so citations
    // can say "sheet 2" / "slide 3". The numbers are the REAL 1-based
    // sheet/slide numbers from the package (empty sections are skipped, so
    // they are not necessarily contiguous).
    Docx,
    Rtf,
    Xlsx { sheet_number: u32 },
    Pptx { slide_number: u32 },
    /// VG-3c — certified line-numbered deposition transcript (.txt detected
    /// by `transcript::detect_transcript`). `start_page` is the chunk
    /// group's locator start page (derived from the locator's first
    /// number), stored in `page_number` the way PDF pages band.
    Transcript { start_page: u32 },
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
///
/// F-508: bumped 5 → 6. Versions ≤ 5 indexed `.aichat` / `.workflow` files, so
/// a pre-6 table holds AI-artifact chunks (chat answers, run records) that the
/// walker now skips and would therefore never delete on their own. The
/// migration drops + re-indexes once, purging those stale artifact rows so
/// matter memory holds primary sources only.
///
/// 7: VG-2b — office formats (docx/xlsx/pptx/rtf) join the indexable set. No
/// column change, but a pre-7 table predates office extraction entirely, so
/// the one-time re-index is what guarantees the office documents already
/// sitting in a workspace become retrievable at update — without waiting for
/// each file to be touched. (The migration is `read_index_version <
/// INDEX_VERSION`: end users see exactly ONE re-index per update no matter
/// how many bumps a release carries.)
///
/// 8: VG-2 — OCR extraction/confidence columns. The chunk schema gains the
/// trailing nullable `extraction` / `extraction_confidence` columns so a
/// passage read from a scanned page is permanently distinguishable from
/// native text (and its confidence is disclosable in citations). A pre-8
/// table lacks the columns, so the one-time drop + re-index migration brings
/// every row onto the uniform schema — never rely on LanceDB auto-evolving a
/// live table.
///
/// 9: VG-3c — transcript page:line locator column. The chunk schema gains the
/// trailing nullable `locator` column ("startPage:startLine-endPage:endLine")
/// so certified deposition transcripts cite as "Tr. 45:12-46:3", and a pre-9
/// table predates transcript detection entirely — the one-time drop +
/// re-index migration is what re-chunks the transcripts already sitting in a
/// workspace through the page:line path.
///
/// 10: VG-6e — path/source_id tokenized + path_enc encrypted at rest. A pre-10
/// table holds PLAINTEXT file paths in the queryable `path` / `source_id`
/// columns (the documented Pillar-1 residual: a raw-disk reader could recover
/// the client/matter file map). Version 10 writes deterministic HMAC tokens
/// in those columns and the real path AES-256-GCM-encrypted in the new
/// NOT-NULL `path_enc` column. We never leave plaintext paths behind: the
/// one-time drop + re-index migration rewrites every row tokenized.
pub const INDEX_VERSION: u32 = 10;

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
        // VG-2: how the chunk's text was extracted. "ocr" for chunks read from
        // a scanned page image by the local OCR engine; null for native text.
        // Nullable + trailing so pre-V8 datasets still open during migration.
        Field::new("extraction", DataType::Utf8, true),
        // VG-2: mean word confidence (0-100) of the OCR pass that produced the
        // chunk's page; null on native chunks. Surfaced in retrieval so the UI
        // can disclose low-confidence scans (OCR_LOW_CONFIDENCE = 60).
        Field::new("extraction_confidence", DataType::Float32, true),
        // VG-3c: page:line locator for certified deposition transcript chunks
        // ("startPage:startLine-endPage:endLine"); null on every other source.
        // Nullable + trailing so pre-V9 datasets still open during migration.
        Field::new("locator", DataType::Utf8, true),
        // VG-6e: the real source path, encrypted at rest (hex AES-256-GCM
        // under the vector master key — the chunk-text pattern). NOT NULL on
        // every V10 row; a pre-V10 table simply lacks the column (reads fall
        // back to the raw `path`, and the V10 migration re-indexes it away).
        Field::new("path_enc", DataType::Utf8, false),
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
/// VG-6e: the `path` / `source_id` COLUMNS hold the deterministic keyed token
/// (`crypto::path_token`), never the plaintext path; the real path is written
/// AES-256-GCM-encrypted into `path_enc` and recovered on read. `id` is still
/// computed from the PLAINTEXT path, so citation ids are unchanged.
///
/// WS-PRIV: `privilege` is the litigation-safety status written to every row
/// (NON-NULL — one of "none" | "attorney-client" | "work-product"). Privileged
/// rows are excluded from retrieval by default.
///
/// VG-2: `extraction` marks HOW the text was extracted. `Some(("ocr", conf))`
/// stamps every row in the batch as OCR-read with the page's mean word
/// confidence (0-100); `None` (every native caller: text / office / native
/// PDF pages) leaves both columns null. Disclosure, not behaviour: retrieval
/// surfaces the values so citations can say "scanned" / "low-confidence scan".
pub fn build_batch(
    rows: &[(Chunk, Vec<f32>)],
    source_type: SourceType,
    matter_id: &str,
    privilege: &str,
    extraction: Option<(&str, f32)>,
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

    // VG-6e: the queryable path/source_id columns carry the deterministic
    // keyed token; the real path is encrypted into path_enc (same key, same
    // wire format as the text column). Plaintext paths are NEVER written.
    let mut path_tokens: Vec<String> = Vec::with_capacity(rows.len());
    let mut path_encs: Vec<String> = Vec::with_capacity(rows.len());
    for (c, _) in rows.iter() {
        path_tokens.push(super::crypto::path_token(key, &c.path));
        let blob = encrypt_with_key(c.path.as_bytes(), key)
            .map_err(|e| anyhow::anyhow!("encrypt chunk path {}: {e}", c.path))?;
        path_encs.push(hex::encode(&blob));
    }

    let vectors = FixedSizeListArray::from_iter_primitive::<Float32Type, _, _>(
        rows.iter()
            .map(|(_, v)| Some(v.iter().copied().map(Some).collect::<Vec<_>>())),
        EMBEDDING_DIM as i32,
    );

    let id_arr = StringArray::from_iter_values(ids.iter().map(|s| s.as_str()));
    let path_arr = StringArray::from_iter_values(path_tokens.iter().map(|s| s.as_str()));
    // WS-B/C: matter_id (one value, all rows) + source_id (== path per row —
    // VG-6e: both columns hold the token).
    let matter_arr = StringArray::from(vec![matter_id; rows.len()]);
    let src_arr = StringArray::from_iter_values(path_tokens.iter().map(|s| s.as_str()));
    let penc_arr = StringArray::from_iter_values(path_encs.iter().map(|s| s.as_str()));
    let pi_arr = UInt32Array::from(para_idx);
    let text_arr = StringArray::from_iter_values(encrypted_texts.iter().map(|s| s.as_str()));
    let ts_arr = Int64Array::from(timestamps);

    // A3 columns — source_type and page_number.
    let (st_str, pn_val): (&str, u32) = match source_type {
        SourceType::Text => ("text", 0),
        SourceType::Pdf { page_number } => ("pdf", page_number),
        // VG-2b — office documents. docx/rtf band like text; xlsx/pptx put
        // their REAL 1-based sheet/slide number in page_number (the citation
        // label "sheet N" / "slide N" reads it back).
        SourceType::Docx => ("docx", 0),
        SourceType::Rtf => ("rtf", 0),
        SourceType::Xlsx { sheet_number } => ("xlsx", sheet_number),
        SourceType::Pptx { slide_number } => ("pptx", slide_number),
        // VG-3c — certified transcripts: page_number carries the group's
        // locator start page (the per-row "Tr. p:l-p:l" detail lives in the
        // `locator` column below).
        SourceType::Transcript { start_page } => ("transcript", start_page),
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

    // VG-2: extraction disclosure — one value for the whole batch (callers
    // group OCR pages separately), null on every native batch.
    let ext_arr = StringArray::from(vec![extraction.map(|(kind, _)| kind); rows.len()]);
    let conf_arr =
        arrow_array::Float32Array::from(vec![extraction.map(|(_, conf)| conf); rows.len()]);

    // VG-3c: the page:line locator is PER ROW — each transcript chunk carries
    // its own range; every non-transcript chunk writes null.
    let loc_arr = StringArray::from(
        rows.iter()
            .map(|(c, _)| c.locator.as_deref())
            .collect::<Vec<Option<&str>>>(),
    );

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
            Arc::new(ext_arr),
            Arc::new(conf_arr),
            Arc::new(loc_arr),
            Arc::new(penc_arr),
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

    // VG-6e: same tokenization as build_batch — a "mail:<id>" key on disk is a
    // re-identification surface exactly like a file path (message ids tie back
    // to mailbox provider records), so it gets the same token + path_enc pair.
    let mut path_tokens: Vec<String> = Vec::with_capacity(rows.len());
    let mut path_encs: Vec<String> = Vec::with_capacity(rows.len());
    for (c, _) in rows.iter() {
        path_tokens.push(super::crypto::path_token(key, &c.path));
        let blob = encrypt_with_key(c.path.as_bytes(), key)
            .map_err(|e| anyhow::anyhow!("encrypt mail chunk path {}: {e}", c.path))?;
        path_encs.push(hex::encode(&blob));
    }

    let vectors = FixedSizeListArray::from_iter_primitive::<Float32Type, _, _>(
        rows.iter()
            .map(|(_, v)| Some(v.iter().copied().map(Some).collect::<Vec<_>>())),
        EMBEDDING_DIM as i32,
    );

    let id_arr = StringArray::from_iter_values(ids.iter().map(|s| s.as_str()));
    let path_arr = StringArray::from_iter_values(path_tokens.iter().map(|s| s.as_str()));
    // WS-B/C: matter_id (one value, all rows) + source_id (== path = "mail:<id>"
    // — VG-6e: both columns hold the token).
    let matter_arr = StringArray::from(vec![matter_id; rows.len()]);
    let src_arr = StringArray::from_iter_values(path_tokens.iter().map(|s| s.as_str()));
    let penc_arr = StringArray::from_iter_values(path_encs.iter().map(|s| s.as_str()));
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
    // VG-2: mail is never OCR-extracted — extraction columns stay null.
    let ext_arr = StringArray::from(vec![None::<&str>; rows.len()]);
    let conf_arr = arrow_array::Float32Array::from(vec![None::<f32>; rows.len()]);
    // VG-3c: mail never carries a page:line locator.
    let loc_arr = StringArray::from(vec![None::<&str>; rows.len()]);

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
            Arc::new(ext_arr),
            Arc::new(conf_arr),
            Arc::new(loc_arr),
            Arc::new(penc_arr),
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
    // VG-6e: the column holds the keyed token, so the predicate matches on
    // the token computed from the same plaintext path + key. (The predicate
    // string lands in LanceDB's transaction log — tokenizing it is part of
    // the no-plaintext-paths-on-disk guarantee.)
    let predicate = format!(
        "path = '{}'",
        sql_escape(&super::crypto::path_token(key, path))
    );
    table
        .delete(&predicate)
        .await
        .with_context(|| format!("delete failed for {}", path))?;

    if rows.is_empty() {
        return Ok(());
    }

    // WS-VEC: build_batch encrypts the text column under the vector-store key.
    // VG-2: this path serves native text extraction only — never OCR.
    let batch = build_batch(&rows, source_type, matter_id, privilege, None, key)?;
    let schema = batch.schema();
    let iter = RecordBatchIterator::new(vec![Ok(batch)], schema);
    table
        .add(Box::new(iter))
        .execute()
        .await
        .context("add chunks batch failed")?;
    Ok(())
}

/// Replace all rows for `path` with per-group batches, where every group
/// carries its OWN `SourceType` — the write shape for SECTIONED sources
/// (PDF pages, xlsx sheets, pptx slides) whose chunks differ in
/// `source_type`/`page_number` across the same file.
///
/// Generalized out of `pdf_indexer.rs` (VG-2b): one up-front delete for the
/// whole path (calling `upsert_chunks_for_path` per group would re-delete
/// the groups already inserted), then ONE `table.add` over every group's
/// batch. Idempotent re-index, exactly like `upsert_chunks_for_path`.
/// Returns the number of rows inserted; an empty `groups` still deletes
/// stale rows (the file may have emptied) and returns 0.
///
/// VG-2: each group carries its own `extraction` marker — `Some(("ocr", conf))`
/// on a PDF page group the OCR engine read, `None` on every native group
/// (office callers pass `None` throughout).
pub async fn upsert_grouped(
    table: &Table,
    path: &str,
    groups: Vec<(SourceType, Option<(&str, f32)>, Vec<(Chunk, Vec<f32>)>)>,
    matter_id: &str,
    privilege: &str,
    key: &[u8; 32],
) -> Result<usize> {
    // VG-6e: tokenized predicate — see upsert_chunks_for_path.
    let predicate = format!(
        "path = '{}'",
        sql_escape(&super::crypto::path_token(key, path))
    );
    table
        .delete(&predicate)
        .await
        .with_context(|| format!("delete failed for {}", path))?;

    use arrow_schema::ArrowError;
    let mut count = 0usize;
    let mut batches: Vec<std::result::Result<RecordBatch, ArrowError>> = Vec::new();
    for (source_type, extraction, rows) in &groups {
        if rows.is_empty() {
            continue;
        }
        count += rows.len();
        let batch = build_batch(rows, *source_type, matter_id, privilege, *extraction, key)
            .map_err(|e| anyhow::anyhow!("build grouped batch for {}: {e}", path))?;
        batches.push(Ok(batch));
    }
    if !batches.is_empty() {
        let schema = build_schema();
        let iter = RecordBatchIterator::new(batches.into_iter(), schema);
        table
            .add(Box::new(iter))
            .execute()
            .await
            .context("add grouped chunks batch failed")?;
    }
    Ok(count)
}

/// Drop every row whose `path` matches. Used by the watcher when a file
/// is deleted from the workspace.
///
/// VG-6e: takes the PLAINTEXT path plus the vector master `key` and computes
/// the stored token internally — callers never handle tokens.
pub async fn delete_path(table: &Table, path: &str, key: &[u8; 32]) -> Result<()> {
    let predicate = format!(
        "path = '{}'",
        sql_escape(&super::crypto::path_token(key, path))
    );
    table
        .delete(&predicate)
        .await
        .with_context(|| format!("delete failed for {}", path))?;
    Ok(())
}

/// BUG-040: purge EVERY chunk belonging to a matter, regardless of which file
/// or mail folder it came from. Used when a matter is deleted so its content
/// can no longer surface through all-matters retrieval (which applies no matter
/// filter). `matter_id` is the plaintext, queryable confidentiality-scope column
/// (see the schema notes above), so we filter on it directly — validated +
/// SQL-escaped to keep the predicate safe. Deleting `UNASSIGNED_MATTER` is
/// refused: it would wipe every uncategorized chunk in the workspace.
pub async fn delete_matter(table: &Table, matter_id: &str) -> Result<()> {
    let matter_id = validate_matter_id(matter_id)?;
    if matter_id == UNASSIGNED_MATTER {
        anyhow::bail!("refusing to delete the UNASSIGNED_MATTER bucket");
    }
    let predicate = format!("matter_id = '{}'", sql_escape(matter_id));
    table
        .delete(&predicate)
        .await
        .with_context(|| format!("delete failed for matter {}", matter_id))?;
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
    key: &[u8; 32],
) -> Result<u64> {
    let privilege = validate_privilege(privilege)?;
    // VG-6e: tokenized predicate — the column holds the keyed token.
    let predicate = format!(
        "path = '{}'",
        sql_escape(&super::crypto::path_token(key, path))
    );
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
    key: &[u8; 32],
) -> Result<u64> {
    let matter_id = validate_matter_id(matter_id)?;
    // VG-6e: tokenized predicate — the column holds the keyed token.
    let predicate = format!(
        "path = '{}'",
        sql_escape(&super::crypto::path_token(key, path))
    );
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

/// Read the matter scope a given source path is currently filed under, by
/// querying the tokenized `path` column and returning the chunk's `matter_id`.
///
/// Mirrors `retag_matter_for_path`'s tokenized predicate (the `path` column
/// holds the keyed token, not the plaintext path — VG-6e). Scans EVERY chunk
/// for the path rather than one arbitrary row, so a robust answer is returned
/// even if chunks somehow disagree: returns `Ok(Some(matter))` when all
/// non-empty chunks agree on one matter, `Ok(None)` when the path has no
/// indexed chunk (or only empty matters), and `Ok(None)` (with a warning) when
/// chunks disagree — never an arbitrary/ambiguous pick.
///
/// BUG-013: used as the SOFT folder-level fallback when a message has no durable
/// per-message override; the unassigned sentinel is filtered by the caller.
pub async fn matter_for_path(
    table: &Table,
    path: &str,
    key: &[u8; 32],
) -> Result<Option<String>> {
    use futures_util::TryStreamExt;
    let predicate = format!(
        "path = '{}'",
        sql_escape(&super::crypto::path_token(key, path))
    );
    let mut stream = table
        .query()
        .only_if(predicate)
        .select(Select::columns(&["matter_id"]))
        .execute()
        .await
        .context("matter_for_path query execute failed")?;

    let mut found: Option<String> = None;
    while let Some(batch) = stream
        .try_next()
        .await
        .context("matter_for_path stream try_next failed")?
    {
        let Some(col) = batch
            .column_by_name("matter_id")
            .and_then(|c| c.as_any().downcast_ref::<StringArray>())
        else {
            continue;
        };
        for i in 0..col.len() {
            if col.is_null(i) {
                continue;
            }
            let v = col.value(i);
            if v.is_empty() {
                continue;
            }
            match &found {
                None => found = Some(v.to_string()),
                Some(existing) if existing == v => {}
                Some(existing) => {
                    log::warn!(
                        "matter_for_path: chunks for {path} disagree ({existing} vs {v}); \
                         treating as indeterminate"
                    );
                    return Ok(None);
                }
            }
        }
    }
    Ok(found)
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
    // VG-2: "ocr" when the chunk text was read from a scanned page by the
    // local OCR engine; None on native chunks (and pre-V8 rows).
    pub extraction: Option<String>,
    // VG-2: mean OCR word confidence (0-100) for the chunk's page; None on
    // native chunks. Disclosed in citations below OCR_LOW_CONFIDENCE = 60.
    pub extraction_confidence: Option<f32>,
    // VG-3c: page:line locator for certified transcript chunks
    // ("startPage:startLine-endPage:endLine"); None on every other source
    // (and pre-V9 rows). Citations read it as "Tr. 45:12-46:3".
    pub locator: Option<String>,
    // VG-6e: hex AES-256-GCM ciphertext of the REAL source path. Present on
    // every V10 row; None only on a pre-V10 row (whose `path` is then the raw
    // plaintext — the migration re-indexes those away). Consumers (the
    // rag_retrieve command, the MCP search tool, the test harnesses) decrypt
    // this to recover the display path; `path`/`source_id` above hold the
    // opaque keyed token on V10 rows.
    pub path_enc: Option<String>,
}

/// Compose the LanceDB `only_if` PREFILTER predicate for a retrieval query from
/// the matter scope, the privilege rule, and the per-path tombstone exclusion
/// (BUG-099 fail-closed). This is the single place ALL three safety boundaries
/// are AND-ed together, so the composition is auditable and tested as a unit.
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
/// BUG-099 tombstone — per-path unsafe exclusion:
///   - `tombstoned_tokens` is a slice of HMAC path tokens for files whose
///     cleanup DELETE failed. Those files' stale rows MUST NOT be returned as
///     citations. Each token is the same opaque string stored in the `path`
///     column (computed by `crypto::path_token`), so the exclusion can be
///     pushed as a SQL prefilter: `path NOT IN ('tok1', 'tok2', ...)`.
///   - An empty slice means no exclusion (the normal case on a healthy index).
///
/// Both matter and privilege clauses are validated + SQL-escaped before
/// interpolation. Returns `None` only when ALL three are absent — a fully
/// unconstrained scan that callers must reach via explicit choices.
pub fn build_retrieval_predicate(
    scope: Option<&str>,
    include_privileged: bool,
    tombstoned_tokens: &[String],
) -> Result<Option<String>> {
    let mut clauses: Vec<String> = Vec::with_capacity(3);
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
    // BUG-099: exclude any path whose cleanup failed (stale rows that we could
    // not delete). The tokens are already HMAC-opaque — safe to embed directly
    // in the SQL literal list without escaping (they are hex strings).
    if !tombstoned_tokens.is_empty() {
        let list: String = tombstoned_tokens
            .iter()
            .map(|t| format!("'{}'", sql_escape(t)))
            .collect::<Vec<_>>()
            .join(", ");
        clauses.push(format!("path NOT IN ({})", list));
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
/// BUG-099 tombstone — `tombstoned_tokens` is a slice of HMAC path tokens for
/// paths whose cleanup DELETE failed after a skip. Those paths' stale rows are
/// excluded from the vector search prefilter. Pass `&[]` (the normal case) to
/// apply no tombstone exclusion. See `build_retrieval_predicate` for the design.
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
    tombstoned_tokens: &[String],
) -> Result<Vec<StoredHit>> {
    use futures_util::TryStreamExt;
    let mut query = table
        .query()
        .nearest_to(query_vec)
        .context("nearest_to failed")?
        .limit(top_k);
    // WS-B/C + WS-PRIV + BUG-099: compose all safety predicates. They are part
    // of the query PLAN (prefilter), not a post-hoc filter on the returned Vec.
    if let Some(predicate) = build_retrieval_predicate(scope, include_privileged, tombstoned_tokens)? {
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
        // VG-2: read the nullable extraction columns. Absent on pre-V8 rows → None.
        let ext_col = batch
            .column_by_name("extraction")
            .and_then(|c| c.as_any().downcast_ref::<StringArray>());
        let ext_conf_col = batch
            .column_by_name("extraction_confidence")
            .and_then(|c| c.as_any().downcast_ref::<arrow_array::Float32Array>());
        // VG-3c: read the nullable locator column. Absent on pre-V9 rows → None.
        let loc_col = batch
            .column_by_name("locator")
            .and_then(|c| c.as_any().downcast_ref::<StringArray>());
        // VG-6e: read the encrypted-path column. Absent on pre-V10 tables →
        // None (the raw `path` is then plaintext and passes through).
        let penc_col = batch
            .column_by_name("path_enc")
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
            let extraction = ext_col
                .filter(|c| !c.is_null(i))
                .map(|c| c.value(i).to_string());
            let extraction_confidence = ext_conf_col.filter(|c| !c.is_null(i)).map(|c| c.value(i));
            let locator = loc_col
                .filter(|c| !c.is_null(i))
                .map(|c| c.value(i).to_string());
            let path_enc = penc_col
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
                extraction,
                extraction_confidence,
                locator,
                path_enc,
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
    /// VG-6e: hex AES-256-GCM ciphertext of the real source path (the
    /// `source_id` field above holds the keyed token on V10 rows). None on a
    /// pre-V10 row. Verification itself never needs the path; surfaced so a
    /// caller that wants to display the verified source can decrypt it.
    pub path_enc: Option<String>,
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
        // VG-6e: absent on pre-V10 tables → None.
        let penc_v = str_col("path_enc")
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
            path_enc: penc_v,
        }));
    }
    Ok(None)
}

/// Collect the PLAINTEXT path key ("mail:<id>") of EVERY mail chunk into a
/// set — one scan — so the mail RAG backfill can answer "is this message
/// already indexed?" by set membership instead of issuing a `count_rows`
/// query per message. Paths repeat once per chunk; the set collapses them to
/// one entry per message.
///
/// VG-6e: the `path` column holds opaque tokens now, so the former
/// `path LIKE 'mail:%'` prefix scan is impossible BY DESIGN (a token kills
/// prefixes). Mail rows are selected on the existing plaintext
/// `source_type = 'mail'` column instead, and the plaintext "mail:<id>" keys
/// are recovered by decrypting `path_enc` under the vector master `key` —
/// the SAME plaintext the backfill's `format!("mail:{id}")` probes with, so
/// set membership keeps working. A row whose path_enc is missing or fails to
/// decrypt is skipped: the backfill then just re-indexes that message
/// (delete-then-insert is idempotent — redundant work, never a gap).
pub async fn list_indexed_mail_paths(table: &Table, key: &[u8; 32]) -> Result<HashSet<String>> {
    use futures_util::TryStreamExt;
    let mut stream = table
        .query()
        .only_if("source_type = 'mail'")
        .select(Select::columns(&["path_enc"]))
        .execute()
        .await
        .context("list_indexed_mail_paths query execute failed")?;

    let mut out = HashSet::new();
    while let Some(batch) = stream
        .try_next()
        .await
        .context("list_indexed_mail_paths stream try_next failed")?
    {
        let penc_col = batch
            .column_by_name("path_enc")
            .context("missing path_enc column")?
            .as_any()
            .downcast_ref::<StringArray>()
            .context("path_enc column is not StringArray")?;
        for i in 0..penc_col.len() {
            if penc_col.is_null(i) {
                continue;
            }
            let decrypted = hex::decode(penc_col.value(i))
                .ok()
                .and_then(|blob| {
                    crate::commands::mail::crypto::decrypt_with_key(&blob, key).ok()
                })
                .and_then(|v| String::from_utf8(v).ok());
            match decrypted {
                Some(p) => {
                    out.insert(p);
                }
                None => log::warn!(
                    "list_indexed_mail_paths: a mail row's path_enc did not decrypt; \
                     the backfill will re-index that message"
                ),
            }
        }
    }
    Ok(out)
}

// ---------------------------------------------------------------------------
// WS-B/C: version-aware migration.
// ---------------------------------------------------------------------------

/// Path of the index-version marker file for a workspace's vector dir.
fn index_version_path(workspace_root: &Path) -> PathBuf {
    dataset_path(workspace_root).join(INDEX_VERSION_FILE)
}

/// BUG-099: filename holding the DURABLE tombstone set — the HMAC PATH TOKENS
/// (not plaintext paths) of files whose stale-row cleanup DELETE failed. One
/// token per line. This makes the fail-closed guarantee survive an app restart:
/// without it, the in-memory `RagState::unsafe_tokens` is empty on relaunch while
/// the stale rows are still on disk, so retrieval could cite the old version.
///
/// LOCATION (decorrelated from the failing dir): this file lives in the
/// `.keepance/` PARENT dir, NOT inside `.keepance/vectors/`. The tombstone is
/// written precisely WHEN a LanceDB delete in the vectors dataset dir failed
/// (lock contention / a locked or unwritable dataset). Writing the tombstone
/// into that SAME dataset dir would likely fail for the same reason, defeating
/// the durable guarantee. The sibling `.keepance/` dir is a separate directory,
/// so a dataset-scoped failure does not block persisting the tombstone.
///
/// PRIVACY (VG-6e parity): we persist the OPAQUE keyed token — the exact value
/// stored in the `path` column — NOT the plaintext path. A raw-disk reader
/// therefore learns nothing about client/matter file names from this file,
/// consistent with the tokenized `path`/`source_id` columns and the encrypted
/// `path_enc`. The token is what retrieval excludes anyway, so this is both
/// safer and simpler (no plaintext→token conversion on read).
const UNSAFE_PATHS_FILE: &str = ".unsafe_tokens";

/// Path of the durable tombstone file. Lives in the `.keepance/` dir (the parent
/// of `vectors/`) so a locked/unwritable LanceDB dataset dir cannot block it.
fn unsafe_paths_path(workspace_root: &Path) -> PathBuf {
    workspace_root.join(".keepance").join(UNSAFE_PATHS_FILE)
}

/// BUG-099: outcome of reading the durable tombstone file. We MUST distinguish
/// "no tombstones" from "couldn't read the tombstones", because treating the
/// latter as the former is a fail-OPEN: in the exact cleanup-failure case this
/// feature protects, stale rows are still in LanceDB, so an unreadable tombstone
/// file (corruption / lock / permission fault) must make retrieval fail CLOSED,
/// not serve unfiltered results.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TombstoneRead {
    /// File absent (healthy: no cleanup ever failed) or read cleanly. Carries the
    /// token set (possibly empty). Retrieval applies it as the exclusion.
    Tokens(HashSet<String>),
    /// File EXISTS but could not be read (corruption / lock / permission). The
    /// real tombstone set is unknown, so callers must FAIL CLOSED (refuse to
    /// serve / force a re-index) rather than assume "no tombstones".
    IntegrityUnknown,
}

impl TombstoneRead {
    /// True when the durable tombstone could not be read and the index integrity
    /// is therefore unknown — callers must fail closed.
    pub fn is_integrity_unknown(&self) -> bool {
        matches!(self, TombstoneRead::IntegrityUnknown)
    }

    /// The token set when readable; an empty set when integrity is unknown.
    /// Use ONLY where a fail-closed decision has already been made separately
    /// (e.g. the MCP path checks `is_integrity_unknown()` first and refuses).
    pub fn into_tokens(self) -> HashSet<String> {
        match self {
            TombstoneRead::Tokens(t) => t,
            TombstoneRead::IntegrityUnknown => HashSet::new(),
        }
    }
}

/// BUG-099: load the durable tombstone token set for a workspace. Used to
/// re-hydrate `RagState::unsafe_tokens` on workspace open so the fail-closed
/// exclusion survives a restart, and read directly by the MCP sidecar. Tokens
/// are hex strings, taken verbatim after stripping only the line terminator.
///
/// Returns `Tokens(set)` when the file is ABSENT (healthy → empty) or read
/// cleanly, and `IntegrityUnknown` when the file EXISTS but cannot be read. The
/// file is written ATOMICALLY (temp + rename, with a direct-write fallback), so
/// a torn/truncated write cannot happen; an unreadable existing file is genuine
/// corruption or a permission/lock fault — rare, but it must fail closed.
pub fn read_unsafe_tokens(workspace_root: &Path) -> TombstoneRead {
    let path = unsafe_paths_path(workspace_root);
    match std::fs::read_to_string(&path) {
        Ok(s) => TombstoneRead::Tokens(
            s.split('\n')
                .map(|l| l.strip_suffix('\r').unwrap_or(l))
                .filter(|l| !l.is_empty())
                .map(|l| l.to_string())
                .collect(),
        ),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            // Absent = healthy default (no tombstones).
            TombstoneRead::Tokens(HashSet::new())
        }
        Err(e) => {
            // Present-but-unreadable = corruption / lock / permission fault.
            // FAIL CLOSED: the caller must not serve as if there were no
            // tombstones (stale rows may still be in the DB).
            log::error!(
                "rag: durable tombstone file {:?} exists but could not be read \
                 ({e}); marking index integrity UNKNOWN — retrieval will fail \
                 closed until a clean re-index rewrites the tombstone file",
                path
            );
            TombstoneRead::IntegrityUnknown
        }
    }
}

/// BUG-099: persist the durable tombstone TOKEN set for a workspace. Called
/// after any change (a token tombstoned on a cleanup failure, or cleared on a
/// clean re-index) so the on-disk set always matches memory. An empty set writes
/// an empty file (rather than deleting it) so a later read is unambiguous. Write
/// errors are surfaced to the caller, which treats a failed persist as part of
/// the unsafe state (does not stamp the index complete).
///
/// ATOMICITY: written to a temp file in the SAME dir, then renamed over the
/// target so a crash mid-write can never leave a half-written / truncated
/// tombstone that would silently drop tokens (fail-open) on the next read.
///
/// WINDOWS-SAFE REPLACE: `std::fs::rename` is an atomic replace on POSIX, and on
/// Windows it maps to a replacing move — BUT a Windows move over an EXISTING
/// target can still fail with a sharing violation if the target is momentarily
/// open. Losing the tombstone there would be a fail-OPEN, so on ANY rename
/// failure we FALL BACK to a direct in-place write of the same bytes: that loses
/// the crash-atomicity for this one write but GUARANTEES the tombstone persists
/// (fail-closed beats elegant). The fallback's own error is surfaced to the
/// caller, which treats a failed persist as part of the unsafe state.
pub fn write_unsafe_tokens(workspace_root: &Path, tokens: &HashSet<String>) -> Result<()> {
    let path = unsafe_paths_path(workspace_root);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).ok();
    }
    let mut sorted: Vec<&String> = tokens.iter().collect();
    sorted.sort();
    let body = sorted
        .iter()
        .map(|s| s.as_str())
        .collect::<Vec<_>>()
        .join("\n");
    // Preferred path: write temp + atomic rename-replace. Pid-tagged temp name so
    // concurrent writers don't collide on the temp path.
    let tmp = path.with_extension(format!("tmp.{}", std::process::id()));
    std::fs::write(&tmp, &body)
        .with_context(|| format!("write unsafe-tokens temp at {:?}", tmp))?;
    if let Err(rename_err) = std::fs::rename(&tmp, &path) {
        // Windows: a replacing move can fail with a sharing violation if the
        // existing target is briefly open. Fall back to a direct write so the
        // tombstone STILL persists (never fail-open), then drop the temp file.
        log::warn!(
            "rag: atomic rename of unsafe-tokens failed ({rename_err}); \
             falling back to a direct write to keep the tombstone durable"
        );
        let direct = std::fs::write(&path, &body)
            .with_context(|| format!("direct-write unsafe-tokens tombstone at {:?}", path));
        let _ = std::fs::remove_file(&tmp);
        direct?;
    }
    Ok(())
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

    /// VG-6e: recover a StoredHit's REAL path by decrypting `path_enc` under
    /// `TEST_KEY`, exactly as the read path (`rag_retrieve`) does. The raw
    /// `path` field holds the opaque keyed token on V10 rows.
    fn stored_path(h: &StoredHit) -> String {
        use crate::commands::mail::crypto::decrypt_with_key;
        let enc = h.path_enc.as_deref().expect("V10 rows carry path_enc");
        let blob = hex::decode(enc).expect("path_enc must be hex");
        String::from_utf8(decrypt_with_key(&blob, &TEST_KEY).expect("decrypt path_enc"))
            .expect("utf8 path")
    }

    #[test]
    fn dataset_path_lives_under_dot_keepance() {
        let p = dataset_path(Path::new("/tmp/work"));
        assert_eq!(p, PathBuf::from("/tmp/work/.keepance/vectors"));
    }

    /// BUG-099 durable tombstone: the unsafe-TOKEN set round-trips through disk,
    /// so the fail-closed exclusion survives an app restart. Absent file = empty.
    #[test]
    fn unsafe_tokens_round_trip_through_disk() {
        let dir = tempfile::TempDir::new().unwrap();
        let root = dir.path();
        let key = [0x5Au8; 32];

        // No file yet → Tokens(empty) (the healthy default — NOT IntegrityUnknown).
        assert_eq!(read_unsafe_tokens(root), TombstoneRead::Tokens(HashSet::new()));

        // Persist two tombstoned tokens (the at-rest path-column values), then
        // read them back identically. We use real tokens so the test exercises
        // the same opaque hex strings the production path computes.
        let mut set = HashSet::new();
        set.insert(super::super::crypto::path_token(&key, "/w/stuck.docx"));
        set.insert(super::super::crypto::path_token(&key, "/w/broken.rtf"));
        write_unsafe_tokens(root, &set).expect("write tombstone set");

        assert_eq!(
            read_unsafe_tokens(root).into_tokens(),
            set,
            "tombstone tokens must survive a write/read cycle (restart)"
        );

        // WINDOWS-SAFE REPLACE regression: a SECOND write over the now-EXISTING
        // file must succeed (this is exactly the Windows rename-over-existing case
        // — adding another tombstone after the first). Add a third token and
        // confirm all three persist.
        let mut set2 = set.clone();
        set2.insert(super::super::crypto::path_token(&key, "/w/third.txt"));
        write_unsafe_tokens(root, &set2).expect("second write over existing file");
        assert_eq!(
            read_unsafe_tokens(root).into_tokens(),
            set2,
            "a second write over an existing tombstone file must persist (Windows-safe replace)"
        );

        // Clearing to empty writes an empty file that reads back as empty (not stale).
        write_unsafe_tokens(root, &HashSet::new()).expect("clear tombstone set");
        assert_eq!(
            read_unsafe_tokens(root),
            TombstoneRead::Tokens(HashSet::new()),
            "an emptied tombstone file must read back as empty (not IntegrityUnknown)"
        );
    }

    /// BUG-099 durable tombstone PRIVACY: the on-disk file holds opaque HMAC
    /// tokens, NEVER the plaintext path — consistent with the tokenized
    /// `path`/`source_id` columns (VG-6e). A raw-disk reader learns nothing about
    /// client/matter file names from this file.
    #[test]
    fn unsafe_tokens_file_holds_no_plaintext_path() {
        let dir = tempfile::TempDir::new().unwrap();
        let root = dir.path();
        let key = [0x5Au8; 32];

        let secret_path = "/clients/Acme Corp/privileged-memo.docx";
        let mut set = HashSet::new();
        set.insert(super::super::crypto::path_token(&key, secret_path));
        write_unsafe_tokens(root, &set).expect("write");

        let on_disk = std::fs::read_to_string(unsafe_paths_path(root)).expect("read raw file");
        assert!(
            !on_disk.contains("Acme")
                && !on_disk.contains("privileged-memo")
                && !on_disk.contains("/clients/"),
            "the durable tombstone file must NOT contain any plaintext path bytes; got {on_disk:?}"
        );
        // But the token round-trips so the exclusion still works after restart.
        assert!(read_unsafe_tokens(root)
            .into_tokens()
            .contains(&super::super::crypto::path_token(&key, secret_path)));
    }

    /// BUG-099 fail-closed DECORRELATION: the durable tombstone is written when a
    /// LanceDB DELETE in the `vectors/` dataset dir failed — often because that
    /// dir is locked/unwritable. The tombstone must persist anyway, so it lives in
    /// the SIBLING `.keepance/` dir, not inside `vectors/`. This test makes the
    /// `vectors/` dataset dir read-only and asserts the tombstone STILL persists.
    #[test]
    #[cfg(unix)]
    fn unsafe_tokens_persist_even_when_vectors_dir_is_readonly() {
        use std::os::unix::fs::PermissionsExt;

        let dir = tempfile::TempDir::new().unwrap();
        let root = dir.path();
        let key = [0x5Au8; 32];

        // Create the dataset dir, then lock it read-only (the failing-cleanup case).
        let vectors_dir = dataset_path(root);
        std::fs::create_dir_all(&vectors_dir).unwrap();
        let orig = std::fs::metadata(&vectors_dir).unwrap().permissions();
        std::fs::set_permissions(&vectors_dir, std::fs::Permissions::from_mode(0o444))
            .expect("lock vectors dir");

        let mut set = HashSet::new();
        set.insert(super::super::crypto::path_token(&key, "/w/stuck.docx"));
        let result = write_unsafe_tokens(root, &set);

        // Restore before asserting so the tempdir cleans up.
        std::fs::set_permissions(&vectors_dir, orig).expect("restore");

        assert!(
            result.is_ok(),
            "tombstone must persist even when the vectors dataset dir is read-only \
             (it lives in the sibling .keepance/ dir): {result:?}"
        );
        assert_eq!(read_unsafe_tokens(root).into_tokens().len(), 1, "the persisted token must read back");
    }

    /// BUG-099 fail-CLOSED on unreadable tombstone: a file that EXISTS but cannot
    /// be read (corruption / lock / permission) returns IntegrityUnknown, NOT an
    /// empty token set — so callers refuse to serve rather than fail open.
    #[test]
    #[cfg(unix)]
    fn unreadable_tombstone_file_reports_integrity_unknown() {
        use std::os::unix::fs::PermissionsExt;

        let dir = tempfile::TempDir::new().unwrap();
        let root = dir.path();
        let key = [0x5Au8; 32];

        // Write a real tombstone, then make it unreadable (chmod 000).
        let mut set = HashSet::new();
        set.insert(super::super::crypto::path_token(&key, "/w/stuck.docx"));
        write_unsafe_tokens(root, &set).expect("write");
        let file = unsafe_paths_path(root);
        let orig = std::fs::metadata(&file).unwrap().permissions();
        std::fs::set_permissions(&file, std::fs::Permissions::from_mode(0o000))
            .expect("make unreadable");

        let result = read_unsafe_tokens(root);

        // Restore before asserting so the tempdir cleans up.
        std::fs::set_permissions(&file, orig).expect("restore");

        assert!(
            result.is_integrity_unknown(),
            "an existing-but-unreadable tombstone file must report IntegrityUnknown \
             (fail closed), not an empty token set; got {result:?}"
        );
        // Sanity: an ABSENT file is NOT integrity-unknown (it is the healthy default).
        let empty_dir = tempfile::TempDir::new().unwrap();
        assert!(!read_unsafe_tokens(empty_dir.path()).is_integrity_unknown());
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
                "extraction",
                "extraction_confidence",
                "locator",
                "path_enc",
            ]
        );
    }

    #[test]
    fn matter_id_and_source_id_are_non_nullable() {
        // WS-B/C: a null matter_id is a confidentiality hazard. The schema must
        // forbid it (and source_id) at the column level.
        // WS-PRIV: a null privilege is a litigation-safety hazard — forbid it too.
        // VG-6e: a V10 row without a recoverable path would be a permanently
        // undisplayable hit — path_enc is NOT NULL at the column level too.
        let s = build_schema();
        for name in ["matter_id", "source_id", "privilege", "path_enc"] {
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
                locator: None,
            },
            vec![0.1f32; EMBEDDING_DIM],
        )];
        let batch = build_batch(&rows, SourceType::Text, "matter-acme", PRIVILEGE_WORK_PRODUCT, None, &TEST_KEY)
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
                locator: None,
            },
            vec![0.1f32; EMBEDDING_DIM],
        )];
        // A bad privilege value fails the build loudly rather than persisting an
        // unscopeable row.
        assert!(build_batch(&rows, SourceType::Text, UNASSIGNED_MATTER, "bogus", None, &TEST_KEY).is_err());
    }

    // ---- build_retrieval_predicate: the single place matter AND privilege compose.

    #[test]
    fn predicate_default_excludes_privileged_with_matter_scope() {
        // The DEFAULT (include_privileged = false) composes matter AND privilege
        // into one prefilter: `matter_id = '..' AND privilege = 'none'`.
        let p = build_retrieval_predicate(Some("matter-acme"), false, &[])
            .expect("predicate")
            .expect("some predicate");
        assert_eq!(p, "matter_id = 'matter-acme' AND privilege = 'none'");
    }

    #[test]
    fn predicate_default_excludes_privileged_even_cross_matter() {
        // Cross-matter (scope None) still excludes privileged by default — the
        // privilege clause stands alone.
        let p = build_retrieval_predicate(None, false, &[])
            .expect("predicate")
            .expect("some predicate");
        assert_eq!(p, "privilege = 'none'");
    }

    #[test]
    fn predicate_include_privileged_drops_privilege_clause() {
        // include_privileged = true is the deliberate capability: only the matter
        // clause remains; privileged rows become candidates.
        let p = build_retrieval_predicate(Some("matter-acme"), true, &[])
            .expect("predicate")
            .expect("some predicate");
        assert_eq!(p, "matter_id = 'matter-acme'");
    }

    #[test]
    fn predicate_fully_unconstrained_only_when_both_chosen() {
        // The only way to a None predicate (no prefilter at all) is BOTH explicit
        // choices: cross-matter AND include-privileged. Neither is a silent default.
        let p = build_retrieval_predicate(None, true, &[]).expect("predicate");
        assert!(p.is_none(), "cross-matter + include-privileged => no prefilter");
    }

    #[test]
    fn predicate_sql_escapes_matter_id() {
        // SECURITY: a crafted matter id is escaped inside the composed predicate.
        let p = build_retrieval_predicate(Some("a'b"), false, &[])
            .expect("predicate")
            .expect("some predicate");
        assert_eq!(p, "matter_id = 'a''b' AND privilege = 'none'");
    }

    #[test]
    fn predicate_rejects_invalid_matter_id() {
        assert!(build_retrieval_predicate(Some("bad\0id"), false, &[]).is_err());
    }

    /// BUG-099 tombstone — tombstoned path tokens are excluded from the predicate
    /// via a SQL `path NOT IN (...)` clause, composed with the other safety clauses.
    #[test]
    fn predicate_excludes_tombstoned_tokens() {
        let tokens = vec!["deadbeef01".to_string(), "cafebabe02".to_string()];
        let p = build_retrieval_predicate(Some("matter-acme"), false, &tokens)
            .expect("predicate")
            .expect("some predicate");
        // The matter + privilege clauses come first; the NOT IN clause is last.
        assert_eq!(
            p,
            "matter_id = 'matter-acme' AND privilege = 'none' AND path NOT IN ('deadbeef01', 'cafebabe02')"
        );
    }

    /// BUG-099 tombstone — an empty tombstone slice adds NO extra clause.
    #[test]
    fn predicate_empty_tombstone_adds_no_clause() {
        let p = build_retrieval_predicate(Some("matter-acme"), false, &[])
            .expect("predicate")
            .expect("some predicate");
        assert_eq!(p, "matter_id = 'matter-acme' AND privilege = 'none'");
    }

    /// BUG-099 tombstone — tombstone tokens are SQL-escaped so a crafted token
    /// (with a single-quote) cannot break out of the predicate literal list.
    #[test]
    fn predicate_sql_escapes_tombstoned_tokens() {
        let tokens = vec!["tok'evil".to_string()];
        let p = build_retrieval_predicate(None, true, &tokens)
            .expect("predicate")
            .expect("some predicate");
        assert_eq!(p, "path NOT IN ('tok''evil')");
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
                    locator: None,
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
                    locator: None,
                },
                vec![0.2f32; EMBEDDING_DIM],
            ),
        ];
        let batch = build_batch(&chunks, SourceType::Text, UNASSIGNED_MATTER, PRIVILEGE_NONE, None, &TEST_KEY)
            .expect("build_batch");
        assert_eq!(batch.num_rows(), 2);
        // 16 columns: id, path, matter_id, source_id, paragraph_index, text,
        // vector, indexed_at, source_type, page_number, encrypted, privilege,
        // extraction, extraction_confidence, locator, path_enc
        assert_eq!(batch.num_columns(), 16);
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
                locator: None,
            },
            vec![0.1f32; EMBEDDING_DIM],
        )];
        let batch = build_batch(&rows, SourceType::Text, "matter-acme", PRIVILEGE_NONE, None, &TEST_KEY).expect("build_batch");
        let matter_col = batch.column_by_name("matter_id").expect("matter_id col").as_string::<i32>();
        assert_eq!(matter_col.value(0), "matter-acme");
        // VG-6e: source_id mirrors the path COLUMN — both hold the same
        // deterministic keyed token of the plaintext path, never the path.
        let expected_token = super::super::crypto::path_token(&TEST_KEY, "/w/contract.md");
        let src_col = batch.column_by_name("source_id").expect("source_id col").as_string::<i32>();
        assert_eq!(src_col.value(0), expected_token);
        let path_col = batch.column_by_name("path").expect("path col").as_string::<i32>();
        assert_eq!(path_col.value(0), expected_token);
    }

    /// VG-6e — the batch-level halves of the residual closure: (b) the
    /// queryable path/source_id columns never contain the plaintext path
    /// bytes; (c) `path_enc` decrypts back to the exact plaintext path; and
    /// the content-addressed `id` still hashes the PLAINTEXT path (the
    /// citation contract is independent of the tokenization).
    #[test]
    fn build_batch_tokenizes_paths_and_path_enc_recovers_plaintext() {
        use arrow_array::cast::AsArray;
        use crate::commands::mail::crypto::decrypt_with_key;
        let plain = "/ws/clients/very-identifiable-client-name.md";
        let rows = vec![(
            Chunk {
                path: plain.into(),
                paragraph_index: 3,
                text: "engagement notes".into(),
                start_offset: 0,
                end_offset: 16,
                locator: None,
            },
            vec![0.1f32; EMBEDDING_DIM],
        )];
        let batch = build_batch(&rows, SourceType::Text, "matter-acme", PRIVILEGE_NONE, None, &TEST_KEY)
            .expect("build_batch");
        for col_name in ["path", "source_id"] {
            let col = batch.column_by_name(col_name).expect("col").as_string::<i32>();
            let v = col.value(0);
            assert!(
                !v.contains("very-identifiable-client-name") && !v.contains("/ws/"),
                "VG-6e LEAK: {col_name} column carries plaintext path bytes: {v:?}"
            );
            assert_eq!(v.len(), 64, "{col_name} must hold the 64-hex-char token");
        }
        // (c) path_enc → plaintext round trip.
        let penc = batch.column_by_name("path_enc").expect("path_enc col").as_string::<i32>();
        let blob = hex::decode(penc.value(0)).expect("hex");
        let recovered =
            String::from_utf8(decrypt_with_key(&blob, &TEST_KEY).expect("decrypt")).expect("utf8");
        assert_eq!(recovered, plain);
        // id is plaintext-derived, exactly as before V10.
        let id_col = batch.column_by_name("id").expect("id col").as_string::<i32>();
        assert_eq!(id_col.value(0), chunk_id(plain, 3));
    }

    /// VG-6e — same closure for the mail write path ("mail:<id>" keys are a
    /// re-identification surface like file paths).
    #[test]
    fn build_batch_mail_tokenizes_paths_and_path_enc_recovers_plaintext() {
        use arrow_array::cast::AsArray;
        use crate::commands::mail::crypto::decrypt_with_key;
        let plain = "mail:AAMk-very-identifiable-message-id";
        let rows = vec![(
            Chunk {
                path: plain.into(),
                paragraph_index: 0,
                text: "mail body".into(),
                start_offset: 0,
                end_offset: 9,
                locator: None,
            },
            vec![0.1f32; EMBEDDING_DIM],
        )];
        let batch = build_batch_mail(&rows, &TEST_KEY, "matter-acme", PRIVILEGE_NONE)
            .expect("build_batch_mail");
        for col_name in ["path", "source_id"] {
            let col = batch.column_by_name(col_name).expect("col").as_string::<i32>();
            let v = col.value(0);
            assert!(
                !v.contains("mail:") && !v.contains("very-identifiable"),
                "VG-6e LEAK: mail {col_name} column carries plaintext bytes: {v:?}"
            );
        }
        let penc = batch.column_by_name("path_enc").expect("path_enc col").as_string::<i32>();
        let blob = hex::decode(penc.value(0)).expect("hex");
        let recovered =
            String::from_utf8(decrypt_with_key(&blob, &TEST_KEY).expect("decrypt")).expect("utf8");
        assert_eq!(recovered, plain);
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
                locator: None,
            },
            vec![0.1f32; EMBEDDING_DIM],
        )];
        let batch = build_batch(&rows, SourceType::Text, UNASSIGNED_MATTER, PRIVILEGE_NONE, None, &TEST_KEY).expect("build_batch text");
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
        // VG-3c: a generic text chunk writes a NULL locator.
        let loc_col = batch
            .column_by_name("locator")
            .expect("locator column missing")
            .as_string::<i32>();
        assert!(loc_col.is_null(0), "non-transcript chunks must write null locator");
    }

    #[test]
    fn build_batch_transcript_writes_per_row_locator_and_start_page() {
        // VG-3c: transcript chunks carry their own page:line locator per ROW,
        // source_type = "transcript", page_number = the group's start page.
        use arrow_array::cast::AsArray;
        let rows = vec![
            (
                Chunk {
                    path: "/w/depo-weston.txt".into(),
                    paragraph_index: 0,
                    text: "Q. When was a hold issued?".into(),
                    start_offset: 0,
                    end_offset: 26,
                    locator: Some("45:12-46:3".into()),
                },
                vec![0.1f32; EMBEDDING_DIM],
            ),
            (
                Chunk {
                    path: "/w/depo-weston.txt".into(),
                    paragraph_index: 1,
                    text: "A. In September.".into(),
                    start_offset: 27,
                    end_offset: 43,
                    locator: Some("46:4-46:20".into()),
                },
                vec![0.2f32; EMBEDDING_DIM],
            ),
        ];
        let batch = build_batch(
            &rows,
            SourceType::Transcript { start_page: 45 },
            "matter-johnson",
            PRIVILEGE_NONE,
            None,
            &TEST_KEY,
        )
        .expect("build_batch transcript");
        let st_col = batch.column_by_name("source_type").expect("source_type").as_string::<i32>();
        assert_eq!(st_col.value(0), "transcript");
        let pn_col = batch
            .column_by_name("page_number")
            .expect("page_number")
            .as_primitive::<arrow_array::types::UInt32Type>();
        assert_eq!(pn_col.value(0), 45);
        let loc_col = batch.column_by_name("locator").expect("locator").as_string::<i32>();
        assert_eq!(loc_col.value(0), "45:12-46:3");
        assert_eq!(loc_col.value(1), "46:4-46:20");
        // The content-address contract is untouched: id still hashes
        // (path, paragraph_index) — the locator is metadata ON TOP.
        let id_col = batch.column_by_name("id").expect("id").as_string::<i32>();
        assert_eq!(id_col.value(0), chunk_id("/w/depo-weston.txt", 0));
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
                locator: None,
            },
            vec![0.1f32; EMBEDDING_DIM],
        )];
        let batch = build_batch(&rows, SourceType::Pdf { page_number: 3 }, UNASSIGNED_MATTER, PRIVILEGE_NONE, None, &TEST_KEY)
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
    // VG-2b: office source types — word-processing formats band like text
    // (page_number 0); sectioned formats carry their REAL 1-based sheet/slide
    // number so citations can say "sheet 2" / "slide 3".
    // -----------------------------------------------------------------------

    fn one_row(path: &str) -> Vec<(Chunk, Vec<f32>)> {
        vec![(
            Chunk {
                path: path.into(),
                paragraph_index: 0,
                text: "office text".into(),
                start_offset: 0,
                end_offset: 11,
                locator: None,
            },
            vec![0.1f32; EMBEDDING_DIM],
        )]
    }

    fn batch_st_pn(batch: &RecordBatch) -> (String, u32) {
        use arrow_array::cast::AsArray;
        let st = batch
            .column_by_name("source_type")
            .expect("source_type col")
            .as_string::<i32>()
            .value(0)
            .to_string();
        let pn = batch
            .column_by_name("page_number")
            .expect("page_number col")
            .as_primitive::<arrow_array::types::UInt32Type>()
            .value(0);
        (st, pn)
    }

    #[test]
    fn build_batch_docx_and_rtf_band_like_text() {
        let b = build_batch(&one_row("/a.docx"), SourceType::Docx, UNASSIGNED_MATTER, PRIVILEGE_NONE, None, &TEST_KEY)
            .expect("build_batch docx");
        assert_eq!(batch_st_pn(&b), ("docx".to_string(), 0));
        let b = build_batch(&one_row("/a.rtf"), SourceType::Rtf, UNASSIGNED_MATTER, PRIVILEGE_NONE, None, &TEST_KEY)
            .expect("build_batch rtf");
        assert_eq!(batch_st_pn(&b), ("rtf".to_string(), 0));
    }

    // -----------------------------------------------------------------------
    // VG-2: OCR extraction disclosure columns. A chunk produced by OCR carries
    // extraction = "ocr" + the page's mean word confidence (0-100); every
    // native chunk leaves both columns null so the UI can tell an OCR-read
    // passage apart and disclose low confidence honestly.
    // -----------------------------------------------------------------------

    #[test]
    fn schema_extraction_columns_are_trailing_and_nullable() {
        let s = build_schema();
        let names: Vec<_> = s.fields().iter().map(|f| f.name().as_str()).collect();
        // Trailing so older datasets (pre-V8 rows) still open; nullable so
        // native chunks simply leave them unset. (V9 appended `locator`,
        // V10 appended `path_enc` — the post-V7 additions stay one trailing
        // block, in bump order.)
        assert_eq!(names[names.len() - 4], "extraction");
        assert_eq!(names[names.len() - 3], "extraction_confidence");
        assert_eq!(names[names.len() - 2], "locator");
        assert_eq!(names[names.len() - 1], "path_enc");
        for name in ["extraction", "extraction_confidence", "locator"] {
            let f = s.field_with_name(name).expect("field present");
            assert!(f.is_nullable(), "{name} must be nullable");
        }
        assert_eq!(
            s.field_with_name("extraction_confidence").unwrap().data_type(),
            &DataType::Float32
        );
        assert_eq!(
            s.field_with_name("locator").unwrap().data_type(),
            &DataType::Utf8
        );
    }

    #[test]
    fn build_batch_ocr_extraction_writes_both_columns() {
        use arrow_array::cast::AsArray;
        let rows = one_row("/a.pdf");
        let batch = build_batch(
            &rows,
            SourceType::Pdf { page_number: 2 },
            UNASSIGNED_MATTER,
            PRIVILEGE_NONE,
            Some(("ocr", 87.5)),
            &TEST_KEY,
        )
        .expect("build_batch ocr");
        let ext_col = batch
            .column_by_name("extraction")
            .expect("extraction col")
            .as_string::<i32>();
        assert!(!ext_col.is_null(0));
        assert_eq!(ext_col.value(0), "ocr");
        let conf_col = batch
            .column_by_name("extraction_confidence")
            .expect("extraction_confidence col")
            .as_primitive::<arrow_array::types::Float32Type>();
        assert!(!conf_col.is_null(0));
        assert!((conf_col.value(0) - 87.5).abs() < f32::EPSILON);
    }

    #[test]
    fn build_batch_native_extraction_is_null() {
        let rows = one_row("/a.pdf");
        let batch = build_batch(
            &rows,
            SourceType::Pdf { page_number: 1 },
            UNASSIGNED_MATTER,
            PRIVILEGE_NONE,
            None,
            &TEST_KEY,
        )
        .expect("build_batch native pdf");
        let ext_col = batch.column_by_name("extraction").expect("extraction col");
        assert!(ext_col.is_null(0), "native chunks must leave extraction null");
        let conf_col = batch
            .column_by_name("extraction_confidence")
            .expect("extraction_confidence col");
        assert!(conf_col.is_null(0), "native chunks must leave confidence null");
    }

    #[test]
    fn build_batch_mail_extraction_columns_are_null() {
        let key = [0x42u8; 32];
        let rows = vec![(
            Chunk {
                path: "mail:m-ocr".into(),
                paragraph_index: 0,
                text: "mail body".into(),
                start_offset: 0,
                end_offset: 9,
                locator: None,
            },
            vec![0.1f32; EMBEDDING_DIM],
        )];
        let batch = build_batch_mail(&rows, &key, UNASSIGNED_MATTER, PRIVILEGE_NONE)
            .expect("build_batch mail");
        // Mail is never OCR-extracted; the columns exist (schema is shared)
        // but stay null.
        assert!(batch.column_by_name("extraction").expect("col").is_null(0));
        assert!(batch
            .column_by_name("extraction_confidence")
            .expect("col")
            .is_null(0));
    }

    /// VG-2 round-trip through a real table: an OCR chunk surfaces from
    /// `nearest` with extraction = "ocr" and its confidence; a native chunk
    /// surfaces with both None.
    #[tokio::test]
    async fn nearest_round_trips_extraction_columns() {
        let dir = tempfile::TempDir::new().unwrap();
        let conn = open_connection(dir.path()).await.expect("open conn");
        let table = open_or_create_table(&conn).await.expect("open table");

        let mk = |path: &str, seed: f32| {
            vec![(
                Chunk {
                    path: path.into(),
                    paragraph_index: 0,
                    text: format!("text of {path}"),
                    start_offset: 0,
                    end_offset: 10,
                    locator: None,
                },
                vec![seed; EMBEDDING_DIM],
            )]
        };
        let ocr_batch = build_batch(
            &mk("/scan.pdf", 0.10),
            SourceType::Pdf { page_number: 1 },
            UNASSIGNED_MATTER,
            PRIVILEGE_NONE,
            Some(("ocr", 48.6)),
            &TEST_KEY,
        )
        .expect("ocr batch");
        let native_batch = build_batch(
            &mk("/native.pdf", 0.11),
            SourceType::Pdf { page_number: 1 },
            UNASSIGNED_MATTER,
            PRIVILEGE_NONE,
            None,
            &TEST_KEY,
        )
        .expect("native batch");
        for batch in [ocr_batch, native_batch] {
            let schema = batch.schema();
            table
                .add(Box::new(RecordBatchIterator::new(vec![Ok(batch)], schema)))
                .execute()
                .await
                .expect("add batch");
        }

        let q = vec![0.10f32; EMBEDDING_DIM];
        let hits = nearest(&table, &q, 10, None, false, &[]).await.expect("nearest");
        // VG-6e: the raw path column holds tokens — resolve via path_enc.
        let scan = hits.iter().find(|h| stored_path(h) == "/scan.pdf").expect("scan hit");
        assert_eq!(scan.extraction.as_deref(), Some("ocr"));
        assert!((scan.extraction_confidence.expect("conf") - 48.6).abs() < 0.001);
        let native = hits.iter().find(|h| stored_path(h) == "/native.pdf").expect("native hit");
        assert_eq!(native.extraction, None);
        assert_eq!(native.extraction_confidence, None);
    }

    #[test]
    fn build_batch_xlsx_and_pptx_carry_real_section_numbers() {
        // The number is the REAL 1-based sheet/slide number (empty sections
        // are skipped upstream, so it is NOT necessarily contiguous with the
        // enumeration index used for paragraph_index banding).
        let b = build_batch(&one_row("/a.xlsx"), SourceType::Xlsx { sheet_number: 2 }, UNASSIGNED_MATTER, PRIVILEGE_NONE, None, &TEST_KEY)
            .expect("build_batch xlsx");
        assert_eq!(batch_st_pn(&b), ("xlsx".to_string(), 2));
        let b = build_batch(&one_row("/a.pptx"), SourceType::Pptx { slide_number: 3 }, UNASSIGNED_MATTER, PRIVILEGE_NONE, None, &TEST_KEY)
            .expect("build_batch pptx");
        assert_eq!(batch_st_pn(&b), ("pptx".to_string(), 3));
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
                locator: None,
            },
            vec![0.1f32; EMBEDDING_DIM],
        )];
        let batch = build_batch(&rows, SourceType::Text, UNASSIGNED_MATTER, PRIVILEGE_NONE, None, &TEST_KEY).expect("build_batch text");
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
                locator: None,
            },
            vec![0.1f32; EMBEDDING_DIM],
        )];
        let batch = build_batch(&rows, SourceType::Pdf { page_number: 3 }, UNASSIGNED_MATTER, PRIVILEGE_NONE, None, &TEST_KEY)
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
                locator: None,
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
                locator: None,
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
                    locator: None,
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
                    locator: None,
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
                locator: None,
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
                locator: None,
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
        // (VG-6e: the raw path column holds tokens — resolve via path_enc.)
        let hits_a = nearest(&table, &q, 10, Some("matter_a"), false, &[]).await.expect("nearest a");
        let paths_a: Vec<String> = hits_a.iter().map(stored_path).collect();
        assert!(paths_a.iter().any(|p| p == "mail:a-msg"), "Matter A scope must return Matter A mail");
        assert!(!paths_a.iter().any(|p| p == "mail:b-msg"), "Matter A scope must NOT return Matter B mail");

        // Scoped to Matter B: only the Matter-B mail comes back.
        let hits_b = nearest(&table, &q, 10, Some("matter_b"), false, &[]).await.expect("nearest b");
        let paths_b: Vec<String> = hits_b.iter().map(stored_path).collect();
        assert!(paths_b.iter().any(|p| p == "mail:b-msg"));
        assert!(!paths_b.iter().any(|p| p == "mail:a-msg"));
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

        // Initially under Matter A. (VG-6e: resolve real paths via path_enc.)
        let before = nearest(&table, &q, 10, Some("matter_a"), false, &[]).await.unwrap();
        assert!(before.iter().any(|h| stored_path(h) == "mail:movable"));

        // Re-tag to Matter B in place (VG-6e: the retag takes the plaintext
        // path + key and matches the tokenized predicate internally).
        let updated = retag_matter_for_path(&table, "mail:movable", "matter_b", &TEST_KEY)
            .await
            .expect("retag");
        assert_eq!(updated, 1, "exactly one chunk re-tagged");

        // Now it is gone from Matter A and present under Matter B.
        let after_a = nearest(&table, &q, 10, Some("matter_a"), false, &[]).await.unwrap();
        assert!(!after_a.iter().any(|h| stored_path(h) == "mail:movable"), "must leave Matter A after re-tag");
        let after_b = nearest(&table, &q, 10, Some("matter_b"), false, &[]).await.unwrap();
        assert!(after_b.iter().any(|h| stored_path(h) == "mail:movable"), "must appear under Matter B after re-tag");
    }

    /// The backfill's batched skip-probe: ONE path-only scan returns every mail
    /// chunk path as a set, and never file/pdf paths.
    #[tokio::test]
    async fn list_indexed_mail_paths_returns_mail_paths_only() {
        let dir = tempfile::TempDir::new().unwrap();
        let conn = open_connection(dir.path()).await.expect("open conn");
        let table = open_or_create_table(&conn).await.expect("open table");

        add_mail_chunk(&table, "mail:msg-1", "matter_a", 0.10).await;
        add_mail_chunk(&table, "mail:msg-2", "matter_b", 0.11).await;

        // A non-mail (file) chunk must NOT appear in the set.
        let rows = vec![(
            Chunk {
                path: "notes/mail-policy.md".into(),
                paragraph_index: 0,
                text: "a file, not a message".into(),
                start_offset: 0,
                end_offset: 10,
                locator: None,
            },
            vec![0.2f32; EMBEDDING_DIM],
        )];
        let batch =
            build_batch(&rows, SourceType::Text, UNASSIGNED_MATTER, PRIVILEGE_NONE, None, &TEST_KEY)
                .expect("build file batch");
        let schema = batch.schema();
        table
            .add(Box::new(RecordBatchIterator::new(vec![Ok(batch)], schema)))
            .execute()
            .await
            .expect("add file chunk");

        // VG-6e: the probe selects mail rows on source_type and decrypts
        // path_enc back to the SAME plaintext "mail:<id>" keys the backfill's
        // membership check probes with.
        let set = list_indexed_mail_paths(&table, &TEST_KEY).await.expect("list mail paths");
        assert_eq!(set.len(), 2, "exactly the two mail messages: {set:?}");
        assert!(set.contains("mail:msg-1"));
        assert!(set.contains("mail:msg-2"));
        assert!(!set.contains("notes/mail-policy.md"));
    }

    // -----------------------------------------------------------------------
    // VG-6e — the tokenized predicate round trip and the raw-disk proof.
    // -----------------------------------------------------------------------

    /// (a) Every equality-predicate helper still hits the rows it should after
    /// tokenization: upsert's stale-delete replaces rows, both retags update
    /// them, and delete_path removes them — all addressed by PLAINTEXT path
    /// from the caller's side, token-matched internally.
    #[tokio::test]
    async fn vg6e_tokenized_predicates_round_trip() {
        let dir = tempfile::TempDir::new().unwrap();
        let conn = open_connection(dir.path()).await.expect("open conn");
        let table = open_or_create_table(&conn).await.expect("open table");

        let path = "/ws/clients/o'neil-engagement.md"; // quote exercises sql_escape too
        let mk_rows = |text: &str| {
            vec![(
                Chunk {
                    path: path.into(),
                    paragraph_index: 0,
                    text: text.into(),
                    start_offset: 0,
                    end_offset: text.len(),
                    locator: None,
                },
                vec![0.10f32; EMBEDDING_DIM],
            )]
        };
        let q = vec![0.10f32; EMBEDDING_DIM];

        // Upsert twice: the second write's internal tokenized delete must
        // replace the first (idempotent re-index), never duplicate.
        upsert_chunks_for_path(&table, path, mk_rows("v1"), SourceType::Text, "matter_a", PRIVILEGE_NONE, &TEST_KEY)
            .await
            .expect("first upsert");
        upsert_chunks_for_path(&table, path, mk_rows("v2"), SourceType::Text, "matter_a", PRIVILEGE_NONE, &TEST_KEY)
            .await
            .expect("second upsert");
        let hits = nearest(&table, &q, 10, Some("matter_a"), false, &[]).await.unwrap();
        assert_eq!(hits.len(), 1, "re-upsert must replace, not duplicate");
        assert_eq!(stored_path(&hits[0]), path);

        // Both retags hit the row through the tokenized predicate.
        let n = retag_privilege_for_path(&table, path, PRIVILEGE_ATTORNEY_CLIENT, &TEST_KEY)
            .await
            .expect("retag privilege");
        assert_eq!(n, 1, "retag_privilege_for_path must hit the tokenized row");
        let n = retag_matter_for_path(&table, path, "matter_b", &TEST_KEY)
            .await
            .expect("retag matter");
        assert_eq!(n, 1, "retag_matter_for_path must hit the tokenized row");
        let moved = nearest(&table, &q, 10, Some("matter_b"), true, &[]).await.unwrap();
        assert!(moved.iter().any(|h| stored_path(h) == path));

        // delete_path drops the rows through the tokenized predicate.
        delete_path(&table, path, &TEST_KEY).await.expect("delete");
        let gone = nearest(&table, &q, 10, Some("matter_b"), true, &[]).await.unwrap();
        assert!(gone.is_empty(), "delete_path must remove the tokenized rows");
    }

    /// THE RAW-DISK PROOF (VG-6e, mirrors rag_matter_scope.rs's WS-VEC scan
    /// `vec_chunk_text_is_encrypted_on_disk`): after a production write for a
    /// re-identifiable client path, NO file under the LanceDB dataset dir —
    /// data fragments, manifests, transaction logs (which carry the delete
    /// PREDICATES) — contains the plaintext path bytes; and retrieval still
    /// recovers the real path by decrypting path_enc.
    #[tokio::test]
    async fn vg6e_no_plaintext_path_bytes_on_disk_and_read_recovers_path() {
        let dir = tempfile::TempDir::new().unwrap();
        let conn = open_connection(dir.path()).await.expect("open conn");
        let table = open_or_create_table(&conn).await.expect("open table");

        let secret_path = "/ws/clients/very-identifiable-client-name.md";
        let rows = vec![(
            Chunk {
                path: secret_path.into(),
                paragraph_index: 0,
                text: "engagement notes for the matter".into(),
                start_offset: 0,
                end_offset: 31,
                locator: None,
            },
            vec![0.10f32; EMBEDDING_DIM],
        )];
        // The PRODUCTION write shape (upsert = tokenized delete + add), so the
        // transaction log this run leaves behind is exactly what ships.
        upsert_chunks_for_path(&table, secret_path, rows, SourceType::Text, "matter_a", PRIVILEGE_NONE, &TEST_KEY)
            .await
            .expect("upsert");

        // Read path first: the real path comes back via path_enc...
        let q = vec![0.10f32; EMBEDDING_DIM];
        let hits = nearest(&table, &q, 5, Some("matter_a"), false, &[]).await.unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(stored_path(&hits[0]), secret_path);
        // ...while the raw queryable columns are opaque tokens.
        assert!(!hits[0].path.contains("very-identifiable-client-name"));
        assert_eq!(hits[0].path.len(), 64);

        drop(table);
        drop(conn);

        // Scan EVERY file under the dataset dir for the identifying bytes.
        let needle = b"very-identifiable-client-name";
        let dataset_dir = dataset_path(dir.path());
        let mut files_scanned = 0usize;
        for entry in walkdir::WalkDir::new(&dataset_dir).into_iter().filter_map(|e| e.ok()) {
            if entry.file_type().is_file() {
                let bytes = std::fs::read(entry.path()).unwrap_or_default();
                files_scanned += 1;
                assert!(
                    !bytes.windows(needle.len()).any(|w| w == needle),
                    "VG-6e LEAK: plaintext path bytes found in {:?}",
                    entry.path()
                );
            }
        }
        assert!(files_scanned > 0, "expected to scan at least one on-disk LanceDB file");
    }
}
