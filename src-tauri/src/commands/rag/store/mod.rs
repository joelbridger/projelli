// LanceDB-backed vector store for the RAG indexer.
//
// One dataset per workspace, living at `<workspace>/.lantern/vectors/`.
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
// (`crypto.rs`, keychain service "lantern-vectors-enc") for EVERY source type
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
    Array, FixedSizeListArray, Int64Array, RecordBatch, RecordBatchIterator, StringArray,
    UInt32Array, types::Float32Type,
};
use arrow_schema::{DataType, Field, Schema, SchemaRef};
use lancedb::{
    Connection, Table,
    query::{ExecutableQuery, QueryBase, Select},
};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::collections::HashSet;
use std::fs::{File, OpenOptions};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering as AtomicOrdering};
use std::sync::{Arc, OnceLock, Weak};
use tokio::sync::{Mutex as AsyncMutex, OwnedMutexGuard};

use super::chunker::Chunk;
use super::embedder::EMBEDDING_DIM;

/// Identifies how a chunk was produced. Determines which columns are
/// meaningful in the chunks table. Added in Plan A3.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SourceType {
    Text,
    /// 1-based page number for display.
    Pdf {
        page_number: u32,
    },
    /// Email message. `text` column holds hex-encoded AES-256-GCM ciphertext.
    Mail,
    // VG-2b — office documents. Word-processing formats chunk like text
    // (page_number 0); sectioned formats band like PDF pages so citations
    // can say "sheet 2" / "slide 3". The numbers are the REAL 1-based
    // sheet/slide numbers from the package (empty sections are skipped, so
    // they are not necessarily contiguous).
    Docx,
    Rtf,
    Xlsx {
        sheet_number: u32,
    },
    Pptx {
        slide_number: u32,
    },
    /// VG-3c — certified line-numbered deposition transcript (.txt detected
    /// by `transcript::detect_transcript`). `start_page` is the chunk
    /// group's locator start page (derived from the locator's first
    /// number), stored in `page_number` the way PDF pages band.
    Transcript {
        start_page: u32,
    },
    /// Wealthbox CRM record (per-object record or household summary). text column holds hex-encoded AES-256-GCM ciphertext.
    Crm,
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

/// External connector source kinds accepted by `build_batch_external`.
///
/// This keeps connector-owned string source types explicit without widening the
/// typed `SourceType` enum that drives file extraction.
pub const EXTERNAL_SOURCE_TYPE_ALLOWLIST: &[&str] = &[
    "text",
    "pdf",
    "mail",
    "docx",
    "rtf",
    "xlsx",
    "pptx",
    "transcript",
    "crm",
    "onedrive",
    "esign",
    "meeting",
    "box",
    "jotform",
    "sharefile",
    "zocks",
    "addepar",
];

pub fn validate_external_source_type(source_type: &str) -> Result<&str> {
    if EXTERNAL_SOURCE_TYPE_ALLOWLIST.contains(&source_type) {
        return Ok(source_type);
    }
    anyhow::bail!(
        "invalid external source_type {:?} (expected one of: {})",
        source_type,
        EXTERNAL_SOURCE_TYPE_ALLOWLIST.join(", ")
    )
}

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
/// `<workspace>/.lantern/vectors/.index_version`. See `needs_migration`.
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
///
/// 11: P1.1 — the `path` token now HMACs the NORMALIZED path (`path_token` runs
/// `normalize_source_path` first), so the native Windows form `C:\ws\a.docx` and
/// the forward-slash form `C:/ws/a.docx` map to ONE token. A pre-11 table on
/// Windows holds tokens over the un-normalized (backslash) path, which the new
/// code can't match with the forward-slash form the TS retag/delete/index uses —
/// so a mapped file could silently vanish from matter-scoped search. The one-time
/// drop + re-index rewrites every row under the normalized token. (On
/// Linux/macOS the paths were already forward-slash, so the tokens are unchanged
/// and the rebuild is a no-op cost — but the marker is global, so it runs once.)
pub const INDEX_VERSION: u32 = 11;

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
        anyhow::bail!(
            "matter_id must not be empty (use UNASSIGNED_MATTER for uncategorized content)"
        );
    }
    if matter_id.chars().any(|c| c == '\0' || c.is_control()) {
        anyhow::bail!("matter_id contains control characters");
    }
    Ok(matter_id)
}

/// Compute the path of the LanceDB dataset for a given workspace root.
pub fn dataset_path(workspace_root: &Path) -> PathBuf {
    crate::commands::data_dir::workspace_data_dir(workspace_root).join("vectors")
}

// ---------------------------------------------------------------------------
// Store-wide writer serialization.
// ---------------------------------------------------------------------------

/// One keyed async mutex per local LanceDB store.  The weak references let an
/// unused workspace lock disappear after its last writer finishes instead of
/// growing this process-wide map forever as advisors open different workspaces.
static WRITE_LOCKS: OnceLock<std::sync::Mutex<HashMap<PathBuf, Weak<AsyncMutex<()>>>>> =
    OnceLock::new();

/// Number of writers currently waiting behind another write, keyed by the
/// `vectors` directory.  The frontend reads this through a tiny Tauri command so
/// "queued" is shown as waiting, never as a failed privacy/search update.
static WRITE_WAITERS: OnceLock<std::sync::Mutex<HashMap<PathBuf, usize>>> = OnceLock::new();
static SCOPE_WRITE_WAITERS: AtomicUsize = AtomicUsize::new(0);

tokio::task_local! {
    static WRITE_OPERATION_KIND: &'static str;
}

fn write_locks() -> &'static std::sync::Mutex<HashMap<PathBuf, Weak<AsyncMutex<()>>>> {
    WRITE_LOCKS.get_or_init(|| std::sync::Mutex::new(HashMap::new()))
}

fn write_waiters() -> &'static std::sync::Mutex<HashMap<PathBuf, usize>> {
    WRITE_WAITERS.get_or_init(|| std::sync::Mutex::new(HashMap::new()))
}

fn local_path_from_uri(uri: &str) -> PathBuf {
    if let Ok(url) = tauri::Url::parse(uri) {
        if url.scheme() == "file" {
            if let Ok(path) = url.to_file_path() {
                return path;
            }
        }
    }
    PathBuf::from(uri)
}

/// Turn either a connection URI (`.../vectors`) or table URI
/// (`.../vectors/chunks.lance`) into the one store key both must share.
fn store_root_from_uri(uri: &str) -> PathBuf {
    let path = local_path_from_uri(uri);
    if path.extension().is_some_and(|ext| ext == "lance") {
        path.parent().unwrap_or(&path).to_path_buf()
    } else {
        path
    }
}

fn lock_for(root: &Path) -> Arc<AsyncMutex<()>> {
    let mut locks = crate::util::sync::lock_unpoison(write_locks());
    if let Some(lock) = locks.get(root).and_then(Weak::upgrade) {
        return lock;
    }
    let lock = Arc::new(AsyncMutex::new(()));
    locks.insert(root.to_path_buf(), Arc::downgrade(&lock));
    lock
}

struct WaiterCount {
    root: PathBuf,
    is_scope_update: bool,
}

impl WaiterCount {
    fn begin(root: &Path) -> Self {
        let mut waiters = crate::util::sync::lock_unpoison(write_waiters());
        *waiters.entry(root.to_path_buf()).or_insert(0) += 1;
        let is_scope_update = WRITE_OPERATION_KIND
            .try_with(|kind| *kind == "scope-update")
            .unwrap_or(false);
        if is_scope_update {
            SCOPE_WRITE_WAITERS.fetch_add(1, AtomicOrdering::SeqCst);
        }
        Self {
            root: root.to_path_buf(),
            is_scope_update,
        }
    }
}

impl Drop for WaiterCount {
    fn drop(&mut self) {
        if self.is_scope_update {
            SCOPE_WRITE_WAITERS.fetch_sub(1, AtomicOrdering::SeqCst);
        }
        let mut waiters = crate::util::sync::lock_unpoison(write_waiters());
        if let Some(count) = waiters.get_mut(&self.root) {
            *count = count.saturating_sub(1);
            if *count == 0 {
                waiters.remove(&self.root);
            }
        }
    }
}

/// RAII ownership of the process-local async mutex plus a cross-process file
/// lock.  Keeping the lock file beside `vectors/` (not inside it) means a corrupt
/// dataset can be quarantined and rebuilt while the writer gate stays held.
pub struct WriteAccessGuard {
    _process: OwnedMutexGuard<()>,
    file: File,
}

impl Drop for WriteAccessGuard {
    fn drop(&mut self) {
        let _ = fs2::FileExt::unlock(&self.file);
    }
}

async fn acquire_write_access_for_root(root: PathBuf) -> Result<WriteAccessGuard> {
    let lock = lock_for(&root);
    let process_guard = match lock.clone().try_lock_owned() {
        Ok(guard) => guard,
        Err(_) => {
            let _waiting = WaiterCount::begin(&root);
            lock.lock_owned().await
        }
    };

    let lock_path = root.parent().unwrap_or(&root).join(".rag-store-write.lock");
    if let Some(parent) = lock_path.parent() {
        std::fs::create_dir_all(parent)
            .with_context(|| format!("create rag writer-lock directory at {:?}", parent))?;
    }
    let mut file = OpenOptions::new()
        .create(true)
        .read(true)
        .write(true)
        .open(&lock_path)
        .with_context(|| format!("open rag writer lock at {:?}", lock_path))?;

    match fs2::FileExt::try_lock_exclusive(&file) {
        Ok(()) => {}
        Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
            let _waiting = WaiterCount::begin(&root);
            let file_for_wait = file.try_clone().context("clone rag writer lock file")?;
            let locked_file = tokio::task::spawn_blocking(move || {
                fs2::FileExt::lock_exclusive(&file_for_wait)?;
                Ok::<File, std::io::Error>(file_for_wait)
            })
            .await
            .context("rag writer file-lock join failed")?
            .context("wait for rag writer file lock")?;
            file = locked_file;
        }
        Err(e) => return Err(e).context("try rag writer file lock"),
    }

    Ok(WriteAccessGuard {
        _process: process_guard,
        file,
    })
}

/// Acquire the single-writer gate for a table mutation.  Every production
/// LanceDB write must go through this seam, including direct batched `add` calls
/// in connector indexers.
pub async fn acquire_write_access(table: &Table) -> Result<WriteAccessGuard> {
    acquire_write_access_for_root(store_root_from_uri(table.dataset_uri())).await
}

/// Label a scope/privacy re-tag while it passes through the shared writer gate.
/// If it has to wait, only the scope-specific queue counter moves, so the banner
/// never mistakes a queued CRM writer for a queued scope update.
pub async fn with_scope_write_status<F: std::future::Future>(future: F) -> F::Output {
    WRITE_OPERATION_KIND.scope("scope-update", future).await
}

pub fn scope_write_queue_depth() -> usize {
    SCOPE_WRITE_WAITERS.load(AtomicOrdering::SeqCst)
}

async fn acquire_connection_write_access(conn: &Connection) -> Result<WriteAccessGuard> {
    acquire_write_access_for_root(store_root_from_uri(conn.uri())).await
}

/// How many writers are waiting for this workspace's single-writer gate.
pub fn write_queue_depth(workspace_root: &Path) -> usize {
    let root = dataset_path(workspace_root);
    crate::util::sync::lock_unpoison(write_waiters())
        .get(&root)
        .copied()
        .unwrap_or(0)
}

/// Stable id for `(path, paragraph_index)`. Hex-encoded SHA-256.
pub fn chunk_id(path: &str, paragraph_index: u32) -> String {
    let path = normalize_source_path(path);
    let mut hasher = Sha256::new();
    hasher.update(path.as_bytes());
    hasher.update(b":");
    hasher.update(paragraph_index.to_le_bytes());
    let digest = hasher.finalize();
    hex_encode(&digest)
}

/// Canonical source path used by the RAG store.
///
/// Windows accepts `/` in normal filesystem paths and the TypeScript side also
/// uses forward slashes for absolute workspace paths. Normalize before deriving
/// chunk ids, path tokens, encrypted `path_enc`, delete predicates, and retag
/// predicates so `C:/root\Clients\a.docx` and `C:/root/Clients/a.docx` are one
/// stored source. `mail:<id>` keys are opaque provider ids, not filesystem paths.
pub fn normalize_source_path(path: &str) -> String {
    if path.starts_with("mail:") {
        path.to_string()
    } else {
        // Fold backslashes to forward slashes so the native Windows form and the
        // TS forward-slash form of one file collapse to a single source (used for
        // chunk ids, path tokens, delete/retag predicates, encrypted `path_enc`).
        //
        // KNOWN PATHOLOGICAL EDGE (documented, not a regression): on Unix a
        // backslash is a LEGAL filename character, so a file literally named
        // `a\b.docx` folds to the same key as `a/b.docx`. Such a file is
        // essentially never created in the Windows/macOS advisor workspaces this
        // targets, and `chunk_id` has always normalized this way — so this only
        // makes the path-token/delete predicate CONSISTENT with the long-standing
        // chunk-id behaviour, it does not open a new class of collision.
        path.replace('\\', "/")
    }
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
    // P2.1 (Finding 8): `create_dir_all` is a blocking syscall (stat + mkdir per
    // path component). On the Ask hot path it ran inline on the async executor;
    // on Windows or a network-backed workspace folder that can hitch the runtime.
    // Hop it to a blocking thread so a slow filesystem never stalls the reactor.
    let dir = path.clone();
    tokio::task::spawn_blocking(move || std::fs::create_dir_all(&dir))
        .await
        .context("create vector dir join failed")?
        .with_context(|| format!("failed to create vector dir at {:?}", &path))?;
    let path_str = path.to_string_lossy().to_string();
    lancedb::connect(&path_str)
        // P2.1 (Finding 4): a zero read-consistency interval makes every table
        // handle opened on this connection RE-CHECK the latest committed version
        // on each read. This is what lets `RagState` cache an open `chunks` table
        // across queries SAFELY: writes committed by the indexer through other
        // connections (add / delete / retag) become visible on the cached handle's
        // next read, so caching never serves a stale snapshot. Fresh (uncached)
        // callers are unaffected — they already saw the latest on open. Only a
        // destructive `drop_table` rebuild needs explicit cache invalidation.
        .read_consistency_interval(std::time::Duration::from_secs(0))
        .execute()
        .await
        .with_context(|| format!("failed to open lancedb at {:?}", &path))
}

async fn open_or_create_table_unlocked(conn: &Connection) -> Result<Table> {
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

fn is_corrupt_store_error(error: &anyhow::Error) -> bool {
    error.chain().any(|cause| {
        let message = cause.to_string().to_ascii_lowercase();
        message.contains("file is not a database")
            || message.contains("database disk image is malformed")
            || message.contains("lanceerror(corrupt")
            || message.contains("corruptfile")
            || message.contains("bad magic")
            || message.contains("invalid lance")
            || message.contains("not a directory")
            // `table_names` is file-name based. A half-published `chunks.lance`
            // entry can therefore appear in the list but fail to open as a table.
            || message.contains("table 'chunks' was not found")
    })
}

async fn rebuild_corrupt_store(conn: &Connection, original: &anyhow::Error) -> Result<Table> {
    let root = store_root_from_uri(conn.uri());
    let workspace = root
        .parent()
        .and_then(Path::parent)
        .context("cannot derive workspace root from corrupt vector-store path")?
        .to_path_buf();

    // Mark recovery BEFORE moving anything. If the rename or fresh create fails,
    // retrieval fails closed and the next reconcile retries the clean rebuild.
    mark_integrity_unknown(&workspace);
    mark_rebuild_required(&workspace);
    super::manifest::delete(&workspace);
    super::reconcile::mark_mail_backfill_needed_after_vector_rebuild(
        &workspace,
        "corrupt vector store",
    );

    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let quarantine = root.with_file_name(format!("vectors.corrupt-{stamp}-{}", std::process::id()));
    if root.exists() {
        std::fs::rename(&root, &quarantine).with_context(|| {
            format!(
                "quarantine corrupt vector store at {:?} after {original:#}",
                quarantine
            )
        })?;
    }
    std::fs::create_dir_all(&root)
        .with_context(|| format!("create clean vector store at {:?}", root))?;

    let replacement = lancedb::connect(&root.to_string_lossy())
        .read_consistency_interval(std::time::Duration::from_secs(0))
        .execute()
        .await
        .with_context(|| format!("reopen clean lancedb at {:?}", root))?;
    open_or_create_table_unlocked(&replacement)
        .await
        .with_context(|| format!("rebuild clean vector table after {original:#}"))
}

/// Open the `chunks` table, creating an empty one if it doesn't exist.
///
/// Creation and corruption recovery both hold the same store-wide writer gate
/// as normal mutations. A damaged derived index is quarantined and recreated;
/// durable markers make the normal reconcile/mail-backfill paths repopulate it
/// from authoritative content instead of leaving search permanently broken.
pub async fn open_or_create_table(conn: &Connection) -> Result<Table> {
    let _write = acquire_connection_write_access(conn).await?;
    match open_or_create_table_unlocked(conn).await {
        Ok(table) => Ok(table),
        Err(error) if is_corrupt_store_error(&error) => {
            log::error!(
                "rag: corrupt vector store detected; quarantining and rebuilding: {error:#}"
            );
            rebuild_corrupt_store(conn, &error).await
        }
        Err(error) => Err(error),
    }
}

/// P2.3 row 3: build the `path` (token) and `path_enc` (encrypted) columns for
/// a batch, computing each distinct path's token + ciphertext ONCE and reusing
/// it for every chunk that shares that path. A 200-chunk PDF has one path, so
/// this replaces 200 HMACs + 200 AES-GCM encryptions with one of each.
///
/// Behaviour is preserved: `path_token` is a deterministic HMAC (already
/// identical across same-path rows), and same-path rows sharing one `path_enc`
/// ciphertext still decrypt to the same path on read. This leaks nothing new —
/// the deterministic `path_token` already groups a source's rows by design — and
/// is not dangerous nonce reuse: it is the identical (plaintext, key) reused, not
/// a fresh plaintext under a stale nonce. Memoizing by path also stays correct if
/// a batch ever mixes paths (each distinct path gets its own token/ciphertext).
fn path_token_and_enc_columns(
    rows: &[(Chunk, Vec<f32>)],
    key: &[u8; 32],
) -> Result<(Vec<String>, Vec<String>)> {
    use crate::commands::mail::crypto::encrypt_with_key;
    let mut cache: std::collections::HashMap<&str, (String, String)> =
        std::collections::HashMap::new();
    let mut path_tokens: Vec<String> = Vec::with_capacity(rows.len());
    let mut path_encs: Vec<String> = Vec::with_capacity(rows.len());
    for (c, _) in rows.iter() {
        let (tok, enc) = match cache.get(c.path.as_str()) {
            Some(pair) => pair.clone(),
            None => {
                let tok = super::crypto::path_token(key, &c.path);
                let blob = encrypt_with_key(c.path.as_bytes(), key)
                    .map_err(|e| anyhow::anyhow!("encrypt chunk path {}: {e}", c.path))?;
                let enc = hex::encode(&blob);
                cache.insert(c.path.as_str(), (tok.clone(), enc.clone()));
                (tok, enc)
            }
        };
        path_tokens.push(tok);
        path_encs.push(enc);
    }
    Ok((path_tokens, path_encs))
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

// ---------------------------------------------------------------------------
// Responsibility submodules (F3.1, pure move — split from the former
// single-file store.rs). Every symbol below still resolves at `store::X`
// via the re-exports so callers outside this module are unaffected.
// ---------------------------------------------------------------------------
mod delete;
mod integrity;
mod maintain;
mod retrieval;
mod write;

pub use delete::*;
pub use integrity::*;
pub use maintain::*;
pub use retrieval::*;
pub use write::*;

// Cross-file helpers used only by this module's own tests below (not part of
// the public store:: API — kept pub(crate) rather than pub).
#[cfg(test)]
pub(crate) use delete::{crm_delete_predicate, crm_source_id_belongs_to_provider};
#[cfg(test)]
pub(crate) use integrity::unsafe_paths_path;
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
        use crate::commands::mail::crypto::decrypt_with_key;
        use arrow_array::cast::AsArray;
        let stored_hex = batch
            .column_by_name("text")
            .expect("text col")
            .as_string::<i32>()
            .value(i);
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

    /// Regression harness for the Windows bench collision: CRM backfill and the
    /// scope-retag worker both opened the same workspace store independently,
    /// then mutated it at the same time.  Drive that exact two-open shape here.
    ///
    /// This intentionally starts from an empty store because table publication
    /// is the narrowest deterministic overlap: without a store-wide access gate,
    /// both tasks observe "chunks is absent" and race to create it.  LanceDB may
    /// report an already-exists/conflicting-commit error on Unix; on the Windows
    /// bench the same unguarded overlap presented as SQL error 26, "file is not a
    /// database", while a long scope update and CRM indexing were both active.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn two_independent_store_writers_do_not_overlap() {
        let dir = tempfile::TempDir::new().unwrap();
        let root = dir.path().to_path_buf();
        let barrier = std::sync::Arc::new(tokio::sync::Barrier::new(2));

        let writer = |path: &str, root: PathBuf, barrier: std::sync::Arc<tokio::sync::Barrier>| {
            let path = path.to_string();
            tokio::spawn(async move {
                barrier.wait().await;
                let conn = open_connection(&root)
                    .await
                    .expect("open writer connection");
                let table = open_or_create_table(&conn)
                    .await
                    .expect("open writer table");
                let rows = vec![(
                    Chunk {
                        path: path.clone(),
                        paragraph_index: 0,
                        text: "concurrent writer".into(),
                        start_offset: 0,
                        end_offset: 17,
                        locator: None,
                    },
                    vec![0.25f32; EMBEDDING_DIM],
                )];
                upsert_chunks_for_path(
                    &table,
                    &path,
                    rows,
                    SourceType::Text,
                    "matter-a",
                    PRIVILEGE_NONE,
                    &TEST_KEY,
                )
                .await
                .expect("writer commit");
            })
        };

        let a = writer("/crm/household-1", root.clone(), barrier.clone());
        let b = writer("/clients/acme/plan.docx", root, barrier);
        a.await.expect("crm writer task");
        b.await.expect("scope writer task");
    }

    #[tokio::test]
    async fn queued_scope_writer_has_distinct_live_status() {
        let dir = tempfile::TempDir::new().unwrap();
        let conn = open_connection(dir.path()).await.expect("open connection");
        let table = open_or_create_table(&conn).await.expect("open table");
        let held = acquire_write_access(&table).await.expect("hold writer gate");

        let waiting_table = table.clone();
        let waiting = tokio::spawn(async move {
            with_scope_write_status(acquire_write_access(&waiting_table)).await
        });
        tokio::time::timeout(std::time::Duration::from_secs(1), async {
            while scope_write_queue_depth() == 0 {
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("scope writer should report that it is queued");

        assert_eq!(scope_write_queue_depth(), 1);
        drop(held);
        let acquired = waiting
            .await
            .expect("queued task join")
            .expect("queued writer acquires after release");
        drop(acquired);
        assert_eq!(scope_write_queue_depth(), 0);
    }

    /// A damaged derived index must never brick search.  The workspace files,
    /// mail store, and connector stores are authoritative; LanceDB is a cache.
    /// Simulate a half-published table by putting a regular file where LanceDB's
    /// `chunks.lance/` dataset directory belongs.  Opening must quarantine that
    /// bad cache, create a clean table, and leave the rebuild marker for the
    /// normal reconcile/backfill paths to repopulate it.
    #[tokio::test]
    async fn corrupt_vector_table_is_quarantined_and_rebuilt() {
        let dir = tempfile::TempDir::new().unwrap();
        let vectors = dataset_path(dir.path());
        std::fs::create_dir_all(&vectors).unwrap();
        std::fs::write(vectors.join("chunks.lance"), b"half-written-index").unwrap();

        let conn = open_connection(dir.path()).await.expect("open connection");
        let table = open_or_create_table(&conn)
            .await
            .expect("corrupt cache should rebuild instead of bricking search");
        assert_eq!(table.name(), TABLE_NAME);
        assert!(
            is_rebuild_required(dir.path()),
            "recovery must schedule authoritative content re-indexing"
        );

        let quarantines =
            std::fs::read_dir(crate::commands::data_dir::workspace_data_dir(dir.path()))
                .unwrap()
                .filter_map(|entry| entry.ok())
                .filter(|entry| {
                    entry
                        .file_name()
                        .to_string_lossy()
                        .starts_with("vectors.corrupt-")
                })
                .count();
        assert_eq!(
            quarantines, 1,
            "bad cache should be preserved for diagnosis"
        );
    }

    /// P2.1 (Finding 2): `fetch_records_by_ids` returns, in one query, the SAME
    /// per-id records the single-verify path gets from `lookup_by_id(id, None)`.
    #[tokio::test]
    async fn fetch_records_by_ids_matches_lookup_by_id() {
        let dir = tempfile::TempDir::new().unwrap();
        let conn = open_connection(dir.path()).await.expect("open conn");
        let table = open_or_create_table(&conn).await.expect("open table");

        // Two chunks in matter A, one in matter B.
        let mk = |path: &str, matter: &str| {
            let rows = vec![(
                Chunk {
                    path: path.into(),
                    paragraph_index: 0,
                    text: format!("text of {path}"),
                    start_offset: 0,
                    end_offset: 10,
                    locator: None,
                },
                vec![0.05f32; EMBEDDING_DIM],
            )];
            build_batch(&rows, SourceType::Text, matter, PRIVILEGE_NONE, None, &TEST_KEY)
                .expect("build batch")
        };
        for batch in [mk("/a1.txt", "matterA"), mk("/a2.txt", "matterA"), mk("/b1.txt", "matterB")] {
            let schema = batch.schema();
            table
                .add(Box::new(RecordBatchIterator::new(vec![Ok(batch)], schema)))
                .execute()
                .await
                .expect("add");
        }

        let ids = [
            chunk_id("/a1.txt", 0),
            chunk_id("/b1.txt", 0),
            // A fabricated id must simply be absent from the result (never errors).
            "0".repeat(64),
        ];
        let records = fetch_records_by_ids(&table, &ids).await.expect("batch fetch");

        // Every real id resolves to exactly one record with the right matter; the
        // batch record equals the single lookup_by_id(None) record.
        for id in [&ids[0], &ids[1]] {
            let single = lookup_by_id(&table, id, None).await.unwrap().expect("single");
            let batched: Vec<_> = records.iter().filter(|r| &r.id == id).collect();
            assert_eq!(batched.len(), 1, "one row per id in this fixture");
            assert_eq!(batched[0].matter_id, single.matter_id);
            assert_eq!(batched[0].source_id, single.source_id);
            assert_eq!(batched[0].text, single.text);
            assert_eq!(batched[0].encrypted, single.encrypted);
        }
        // The fabricated id contributes no rows.
        assert!(records.iter().all(|r| r.id != "0".repeat(64)));
    }

    #[test]
    fn dataset_path_lives_under_dot_lantern() {
        let p = dataset_path(Path::new("/tmp/work"));
        assert_eq!(p, PathBuf::from(format!("/tmp/work/{}/vectors", crate::identity::WORKSPACE_DATA_DIR)));
    }

    /// BUG-099 durable tombstone: the unsafe-TOKEN set round-trips through disk,
    /// so the fail-closed exclusion survives an app restart. Absent file = empty.
    #[test]
    fn unsafe_tokens_round_trip_through_disk() {
        let dir = tempfile::TempDir::new().unwrap();
        let root = dir.path();
        let key = [0x5Au8; 32];

        // No file yet → Tokens(empty) (the healthy default — NOT IntegrityUnknown).
        assert_eq!(
            read_unsafe_tokens(root),
            TombstoneRead::Tokens(HashSet::new())
        );

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
        assert!(
            read_unsafe_tokens(root)
                .into_tokens()
                .contains(&super::super::crypto::path_token(&key, secret_path))
        );
    }

    /// BUG-099 fail-closed DECORRELATION: the durable tombstone is written when a
    /// LanceDB DELETE in the `vectors/` dataset dir failed — often because that
    /// dir is locked/unwritable. The tombstone must persist anyway, so it lives in
    /// the SIBLING `.lantern/` dir, not inside `vectors/`. This test makes the
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
             (it lives in the sibling {}/ dir): {result:?}",
            crate::identity::WORKSPACE_DATA_DIR,
        );
        assert_eq!(
            read_unsafe_tokens(root).into_tokens().len(),
            1,
            "the persisted token must read back"
        );
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

    /// BUG-099 cross-process fail-closed: the durable integrity-unknown SENTINEL
    /// forces `read_unsafe_tokens` to report IntegrityUnknown even when the
    /// `.unsafe_tokens` file itself is perfectly readable. This is how a durable
    /// tombstone WRITE failure in the GUI reaches the separate MCP sidecar
    /// process (which only reads disk). A clean re-index clears it.
    #[test]
    fn integrity_sentinel_forces_fail_closed_across_processes() {
        let dir = tempfile::TempDir::new().unwrap();
        let root = dir.path();
        let key = [0x5Au8; 32];

        // A perfectly readable tombstone file exists...
        let mut set = HashSet::new();
        set.insert(super::super::crypto::path_token(&key, "/w/stuck.docx"));
        write_unsafe_tokens(root, &set).expect("write tombstone");
        assert!(
            !read_unsafe_tokens(root).is_integrity_unknown(),
            "clean state first"
        );

        // ...but a prior durable WRITE failure dropped the sentinel. Any reader
        // (GUI hydration OR the MCP sidecar) must now fail closed.
        mark_integrity_unknown(root);
        assert!(
            read_unsafe_tokens(root).is_integrity_unknown(),
            "the durable sentinel must force IntegrityUnknown even with a readable file"
        );

        // A clean re-index clears the sentinel → readers serve again.
        clear_integrity_unknown(root);
        assert!(
            !read_unsafe_tokens(root).is_integrity_unknown(),
            "clearing the sentinel restores normal (readable) tombstone reads"
        );
        assert_eq!(
            read_unsafe_tokens(root).into_tokens(),
            set,
            "tokens still intact"
        );
    }

    #[test]
    fn rebuild_required_sentinel_survives_across_boots() {
        let dir = tempfile::TempDir::new().unwrap();
        let root = dir.path();
        // Absent by default (a healthy workspace never needs a forced rebuild).
        assert!(!is_rebuild_required(root), "clean state first");
        // Boot A: a degraded purge marks the durable sentinel.
        mark_rebuild_required(root);
        // Boot B: a fresh process (any reader of the same dir) sees it and must
        // drop + rebuild — this is what stops the degraded-purge content leak.
        assert!(
            is_rebuild_required(root),
            "the durable sentinel must survive to the next boot to force a rebuild"
        );
        // Boot B's clean full rebuild clears it → Boot C is a normal reconcile
        // (no re-trip / oscillation).
        clear_rebuild_required(root);
        assert!(
            !is_rebuild_required(root),
            "a completed clean rebuild clears the sentinel"
        );
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
    fn validate_external_source_type_accepts_only_known_values() {
        // 🔴 THIS TEST USED TO PROVE NOTHING ABOUT ITS OWN NAME.
        //
        // It opened with `for source_type in EXTERNAL_SOURCE_TYPE_ALLOWLIST` and
        // asserted each one is accepted — deriving its expectation from the very
        // constant under test. Adding ANY value to the allowlist made the loop
        // assert that the new value is accepted, which it is, BY CONSTRUCTION.
        // The test was structurally incapable of detecting a widening while its
        // name claimed exactly that property.
        //
        // Measured, not assumed: with `"sql"` planted into the allowlist, the
        // whole Rust workspace suite ran 1836 passed / 0 failed, exit 0, and this
        // test printed `ok`.
        //
        // The general class is broader than substring-vs-exact:
        // AN ASSERTION WHOSE SOURCE OF TRUTH IS THE THING UNDER TEST PROVES
        // NOTHING, even with `assert_eq!`. The fix is a frozen expectation that
        // is written down independently of the constant.
        const APPROVED: &[&str] = &[
            "text", "pdf", "mail", "docx", "rtf", "xlsx", "pptx", "transcript", "crm", "onedrive",
            "esign", "meeting", "box", "jotform", "sharefile", "zocks", "addepar",
        ];

        let shipped: std::collections::BTreeSet<&str> =
            EXTERNAL_SOURCE_TYPE_ALLOWLIST.iter().copied().collect();
        let approved: std::collections::BTreeSet<&str> = APPROVED.iter().copied().collect();

        let added: Vec<&str> = shipped.difference(&approved).copied().collect();
        let removed: Vec<&str> = approved.difference(&shipped).copied().collect();
        assert!(
            added.is_empty(),
            "EXTERNAL_SOURCE_TYPE_ALLOWLIST was WIDENED by {added:?}. Every entry here is a \
             source_type string that reaches the store's SQL predicate; a new one must be \
             approved in this test in the same change."
        );
        assert!(
            removed.is_empty(),
            "EXTERNAL_SOURCE_TYPE_ALLOWLIST LOST {removed:?}. Removing a kind silently stops \
             indexing it; update APPROVED deliberately if that is intended."
        );

        // The allowlist is still exercised behaviourally — but against the frozen
        // list, so the expectation cannot follow the constant.
        for source_type in APPROVED {
            assert!(
                validate_external_source_type(source_type).is_ok(),
                "approved source_type {source_type:?} was rejected"
            );
        }
        assert!(validate_external_source_type("").is_err());
        assert!(validate_external_source_type("docusign").is_err());
        assert!(validate_external_source_type("esign' OR '1'='1").is_err());
    }

    /// P2.3 row 3 MEASUREMENT (ignored by default; run with
    /// `cargo test -p lantern --lib measure_path_token_memoization -- --ignored --nocapture`).
    /// Times the OLD per-chunk path-token+encrypt loop against the NEW memoized
    /// helper on a 200-chunk single-path batch (a typical PDF), proving the win.
    #[test]
    #[ignore]
    fn measure_path_token_memoization() {
        use crate::commands::mail::crypto::encrypt_with_key;
        use std::time::Instant;

        const N: usize = 200;
        let path = "/workspace/clients/acme/2026-financials-annual-report.pdf";
        let rows: Vec<(Chunk, Vec<f32>)> = (0..N)
            .map(|i| {
                (
                    Chunk {
                        path: path.into(),
                        paragraph_index: i as u32,
                        text: format!("chunk body number {i}"),
                        start_offset: 0,
                        end_offset: 0,
                        locator: None,
                    },
                    vec![0.0f32; EMBEDDING_DIM],
                )
            })
            .collect();

        // OLD: recompute HMAC token + fresh AES-GCM encryption for every chunk.
        let t0 = Instant::now();
        let mut old_tokens = Vec::with_capacity(N);
        let mut old_encs = Vec::with_capacity(N);
        for (c, _) in rows.iter() {
            old_tokens.push(super::super::crypto::path_token(&TEST_KEY, &c.path));
            let blob = encrypt_with_key(c.path.as_bytes(), &TEST_KEY).unwrap();
            old_encs.push(hex::encode(&blob));
        }
        let old_dur = t0.elapsed();

        // NEW: memoized helper — one HMAC + one AES-GCM for the shared path.
        let t1 = Instant::now();
        let (new_tokens, new_encs) = path_token_and_enc_columns(&rows, &TEST_KEY).unwrap();
        let new_dur = t1.elapsed();

        // Same column lengths; tokens identical (deterministic HMAC); every
        // path_enc still decrypts to the same plaintext path.
        assert_eq!(new_tokens.len(), N);
        assert_eq!(new_encs.len(), N);
        assert_eq!(old_tokens[0], new_tokens[0]);
        {
            use crate::commands::mail::crypto::decrypt_with_key;
            let blob = hex::decode(&new_encs[N - 1]).unwrap();
            let recovered = String::from_utf8(decrypt_with_key(&blob, &TEST_KEY).unwrap()).unwrap();
            assert_eq!(recovered, path);
        }

        eprintln!(
            "[P2.3 row 3] path cols for {N} chunks/1 path: OLD {old_dur:?}  NEW {new_dur:?}  speedup {:.1}x",
            old_dur.as_secs_f64() / new_dur.as_secs_f64().max(1e-9)
        );
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
        let batch = build_batch(
            &rows,
            SourceType::Text,
            "matter-acme",
            PRIVILEGE_WORK_PRODUCT,
            None,
            &TEST_KEY,
        )
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
        assert!(
            build_batch(
                &rows,
                SourceType::Text,
                UNASSIGNED_MATTER,
                "bogus",
                None,
                &TEST_KEY
            )
            .is_err()
        );
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
        assert!(
            p.is_none(),
            "cross-matter + include-privileged => no prefilter"
        );
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

    // ---- crm_delete_predicate: one scoped delete PER CALL (backfill uses it per
    //      household), never one delete per item — that per-item churn is what hung.

    #[test]
    fn crm_delete_predicate_builds_one_clause_for_all_matters() {
        // The perf fix's contract: ONE predicate per call (scoped to source_type='crm'),
        // never one delete per ITEM. backfill calls it per household with a single
        // matter; the multi-matter form is exercised here for completeness.
        let ids = vec!["m1".to_string(), "m2".to_string(), "m3".to_string()];
        let p = crm_delete_predicate(&ids).expect("some predicate");
        assert_eq!(p, "source_type = 'crm' AND matter_id IN ('m1', 'm2', 'm3')");
    }

    #[test]
    fn crm_delete_predicate_is_none_for_empty() {
        assert!(
            crm_delete_predicate(&[]).is_none(),
            "empty list => no delete at all"
        );
    }

    #[test]
    fn crm_delete_predicate_sql_escapes_matter_ids() {
        let ids = vec!["a'b".to_string()];
        let p = crm_delete_predicate(&ids).expect("some predicate");
        assert_eq!(p, "source_type = 'crm' AND matter_id IN ('a''b')");
    }

    #[test]
    fn crm_source_id_provider_detection_keeps_legacy_wealthbox_unprefixed() {
        assert!(crm_source_id_belongs_to_provider(
            "crm:household:10001",
            "wealthbox"
        ));
        assert!(crm_source_id_belongs_to_provider(
            "crm:contact:sfdc:003CC0000000002AAA",
            "salesforce"
        ));
        assert!(!crm_source_id_belongs_to_provider(
            "crm:contact:sfdc:003CC0000000002AAA",
            "wealthbox"
        ));
        assert!(crm_source_id_belongs_to_provider(
            "crm:contact:redtail:123",
            "redtail"
        ));
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
        let batch = build_batch(
            &chunks,
            SourceType::Text,
            UNASSIGNED_MATTER,
            PRIVILEGE_NONE,
            None,
            &TEST_KEY,
        )
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
        let batch = build_batch(
            &rows,
            SourceType::Text,
            "matter-acme",
            PRIVILEGE_NONE,
            None,
            &TEST_KEY,
        )
        .expect("build_batch");
        let matter_col = batch
            .column_by_name("matter_id")
            .expect("matter_id col")
            .as_string::<i32>();
        assert_eq!(matter_col.value(0), "matter-acme");
        // VG-6e: source_id mirrors the path COLUMN — both hold the same
        // deterministic keyed token of the plaintext path, never the path.
        let expected_token = super::super::crypto::path_token(&TEST_KEY, "/w/contract.md");
        let src_col = batch
            .column_by_name("source_id")
            .expect("source_id col")
            .as_string::<i32>();
        assert_eq!(src_col.value(0), expected_token);
        let path_col = batch
            .column_by_name("path")
            .expect("path col")
            .as_string::<i32>();
        assert_eq!(path_col.value(0), expected_token);
    }

    /// VG-6e — the batch-level halves of the residual closure: (b) the
    /// queryable path/source_id columns never contain the plaintext path
    /// bytes; (c) `path_enc` decrypts back to the exact plaintext path; and
    /// the content-addressed `id` still hashes the PLAINTEXT path (the
    /// citation contract is independent of the tokenization).
    #[test]
    fn build_batch_tokenizes_paths_and_path_enc_recovers_plaintext() {
        use crate::commands::mail::crypto::decrypt_with_key;
        use arrow_array::cast::AsArray;
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
        let batch = build_batch(
            &rows,
            SourceType::Text,
            "matter-acme",
            PRIVILEGE_NONE,
            None,
            &TEST_KEY,
        )
        .expect("build_batch");
        for col_name in ["path", "source_id"] {
            let col = batch
                .column_by_name(col_name)
                .expect("col")
                .as_string::<i32>();
            let v = col.value(0);
            assert!(
                !v.contains("very-identifiable-client-name") && !v.contains("/ws/"),
                "VG-6e LEAK: {col_name} column carries plaintext path bytes: {v:?}"
            );
            assert_eq!(v.len(), 64, "{col_name} must hold the 64-hex-char token");
        }
        // (c) path_enc → plaintext round trip.
        let penc = batch
            .column_by_name("path_enc")
            .expect("path_enc col")
            .as_string::<i32>();
        let blob = hex::decode(penc.value(0)).expect("hex");
        let recovered =
            String::from_utf8(decrypt_with_key(&blob, &TEST_KEY).expect("decrypt")).expect("utf8");
        assert_eq!(recovered, plain);
        // id is plaintext-derived, exactly as before V10.
        let id_col = batch
            .column_by_name("id")
            .expect("id col")
            .as_string::<i32>();
        assert_eq!(id_col.value(0), chunk_id(plain, 3));
    }

    /// VG-6e — same closure for the mail write path ("mail:<id>" keys are a
    /// re-identification surface like file paths).
    #[test]
    fn build_batch_mail_tokenizes_paths_and_path_enc_recovers_plaintext() {
        use crate::commands::mail::crypto::decrypt_with_key;
        use arrow_array::cast::AsArray;
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
            let col = batch
                .column_by_name(col_name)
                .expect("col")
                .as_string::<i32>();
            let v = col.value(0);
            assert!(
                !v.contains("mail:") && !v.contains("very-identifiable"),
                "VG-6e LEAK: mail {col_name} column carries plaintext bytes: {v:?}"
            );
        }
        let penc = batch
            .column_by_name("path_enc")
            .expect("path_enc col")
            .as_string::<i32>();
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
        let batch = build_batch(
            &rows,
            SourceType::Text,
            UNASSIGNED_MATTER,
            PRIVILEGE_NONE,
            None,
            &TEST_KEY,
        )
        .expect("build_batch text");
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
        assert!(
            loc_col.is_null(0),
            "non-transcript chunks must write null locator"
        );
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
        let st_col = batch
            .column_by_name("source_type")
            .expect("source_type")
            .as_string::<i32>();
        assert_eq!(st_col.value(0), "transcript");
        let pn_col = batch
            .column_by_name("page_number")
            .expect("page_number")
            .as_primitive::<arrow_array::types::UInt32Type>();
        assert_eq!(pn_col.value(0), 45);
        let loc_col = batch
            .column_by_name("locator")
            .expect("locator")
            .as_string::<i32>();
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
        let batch = build_batch(
            &rows,
            SourceType::Pdf { page_number: 3 },
            UNASSIGNED_MATTER,
            PRIVILEGE_NONE,
            None,
            &TEST_KEY,
        )
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
        let b = build_batch(
            &one_row("/a.docx"),
            SourceType::Docx,
            UNASSIGNED_MATTER,
            PRIVILEGE_NONE,
            None,
            &TEST_KEY,
        )
        .expect("build_batch docx");
        assert_eq!(batch_st_pn(&b), ("docx".to_string(), 0));
        let b = build_batch(
            &one_row("/a.rtf"),
            SourceType::Rtf,
            UNASSIGNED_MATTER,
            PRIVILEGE_NONE,
            None,
            &TEST_KEY,
        )
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
            s.field_with_name("extraction_confidence")
                .unwrap()
                .data_type(),
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
        assert!(
            ext_col.is_null(0),
            "native chunks must leave extraction null"
        );
        let conf_col = batch
            .column_by_name("extraction_confidence")
            .expect("extraction_confidence col");
        assert!(
            conf_col.is_null(0),
            "native chunks must leave confidence null"
        );
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
        assert!(
            batch
                .column_by_name("extraction_confidence")
                .expect("col")
                .is_null(0)
        );
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
        let hits = nearest(&table, &q, 10, None, false, &[])
            .await
            .expect("nearest");
        // VG-6e: the raw path column holds tokens — resolve via path_enc.
        let scan = hits
            .iter()
            .find(|h| stored_path(h) == "/scan.pdf")
            .expect("scan hit");
        assert_eq!(scan.extraction.as_deref(), Some("ocr"));
        assert!((scan.extraction_confidence.expect("conf") - 48.6).abs() < 0.001);
        let native = hits
            .iter()
            .find(|h| stored_path(h) == "/native.pdf")
            .expect("native hit");
        assert_eq!(native.extraction, None);
        assert_eq!(native.extraction_confidence, None);
    }

    #[test]
    fn build_batch_xlsx_and_pptx_carry_real_section_numbers() {
        // The number is the REAL 1-based sheet/slide number (empty sections
        // are skipped upstream, so it is NOT necessarily contiguous with the
        // enumeration index used for paragraph_index banding).
        let b = build_batch(
            &one_row("/a.xlsx"),
            SourceType::Xlsx { sheet_number: 2 },
            UNASSIGNED_MATTER,
            PRIVILEGE_NONE,
            None,
            &TEST_KEY,
        )
        .expect("build_batch xlsx");
        assert_eq!(batch_st_pn(&b), ("xlsx".to_string(), 2));
        let b = build_batch(
            &one_row("/a.pptx"),
            SourceType::Pptx { slide_number: 3 },
            UNASSIGNED_MATTER,
            PRIVILEGE_NONE,
            None,
            &TEST_KEY,
        )
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
        let batch = build_batch(
            &rows,
            SourceType::Text,
            UNASSIGNED_MATTER,
            PRIVILEGE_NONE,
            None,
            &TEST_KEY,
        )
        .expect("build_batch text");
        // WS-VEC: the text column must NOT contain the plaintext.
        let text_col = batch
            .column_by_name("text")
            .expect("text col")
            .as_string::<i32>();
        assert!(
            !text_col.value(0).contains(plaintext),
            "text-source text column must be ciphertext (WS-VEC), not plaintext"
        );
        // But it must decrypt back to the original plaintext.
        assert_eq!(decrypt_text_col(&batch, 0, &TEST_KEY), plaintext);
        // source_type must still be "text".
        let st_col = batch
            .column_by_name("source_type")
            .expect("st col")
            .as_string::<i32>();
        assert_eq!(st_col.value(0), "text");
        // WS-VEC: encrypted column must be true for text rows now.
        let enc_col = batch
            .column_by_name("encrypted")
            .expect("encrypted column must exist")
            .as_boolean();
        assert!(
            enc_col.value(0),
            "WS-VEC: text rows must have encrypted=true"
        );
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
        let batch = build_batch(
            &rows,
            SourceType::Pdf { page_number: 3 },
            UNASSIGNED_MATTER,
            PRIVILEGE_NONE,
            None,
            &TEST_KEY,
        )
        .expect("build_batch pdf");
        let text_col = batch
            .column_by_name("text")
            .expect("text col")
            .as_string::<i32>();
        assert!(
            !text_col.value(0).contains(plaintext),
            "pdf-source text column must be ciphertext (WS-VEC), not plaintext"
        );
        assert_eq!(decrypt_text_col(&batch, 0, &TEST_KEY), plaintext);
        let st_col = batch
            .column_by_name("source_type")
            .expect("st col")
            .as_string::<i32>();
        assert_eq!(st_col.value(0), "pdf");
        let enc_col = batch
            .column_by_name("encrypted")
            .expect("encrypted column must exist")
            .as_boolean();
        assert!(
            enc_col.value(0),
            "WS-VEC: pdf rows must have encrypted=true"
        );
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
        let batch = build_batch_mail(&rows, &key, UNASSIGNED_MATTER, PRIVILEGE_NONE)
            .expect("build_batch mail");
        let text_col = batch
            .column_by_name("text")
            .expect("text col")
            .as_string::<i32>();
        let stored = text_col.value(0);
        // The text column must NOT contain the plaintext.
        assert!(
            !stored.contains(plaintext),
            "mail text column must contain ciphertext, not plaintext; got: {:?}",
            &stored[..stored.len().min(30)]
        );
        // source_type must be "mail".
        let st_col = batch
            .column_by_name("source_type")
            .expect("st col")
            .as_string::<i32>();
        assert_eq!(st_col.value(0), "mail");
        // encrypted must be true.
        let enc_col = batch
            .column_by_name("encrypted")
            .expect("enc col")
            .as_boolean();
        assert!(enc_col.value(0), "mail rows must have encrypted=true");
    }

    #[test]
    fn build_batch_mail_ciphertext_decrypts_to_original_plaintext() {
        use crate::commands::mail::crypto::decrypt_with_key;
        use arrow_array::cast::AsArray;
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
        let batch =
            build_batch_mail(&rows, &key, UNASSIGNED_MATTER, PRIVILEGE_NONE).expect("build batch");
        let text_col = batch
            .column_by_name("text")
            .expect("text col")
            .as_string::<i32>();
        let stored_hex = text_col.value(0);
        let blob = hex::decode(stored_hex).expect("hex decode");
        let recovered = decrypt_with_key(&blob, &key).expect("decrypt");
        assert_eq!(
            String::from_utf8(recovered).expect("utf8"),
            plaintext,
            "decrypted ciphertext must equal original plaintext"
        );
    }

    #[test]
    fn build_batch_external_esign_source_stores_ciphertext_and_kind() {
        use arrow_array::cast::AsArray;
        let plaintext = "DocuSign envelope completed by Robert Thompson.";
        let rows = vec![(
            Chunk {
                path: "esign:envelope:env-123".into(),
                paragraph_index: 0,
                text: plaintext.to_string(),
                start_offset: 0,
                end_offset: plaintext.len(),
                locator: None,
            },
            vec![0.1f32; EMBEDDING_DIM],
        )];
        let batch = build_batch_external(&rows, &TEST_KEY, "matter-acme", PRIVILEGE_NONE, "esign")
            .expect("build external batch");

        let st_col = batch
            .column_by_name("source_type")
            .expect("st col")
            .as_string::<i32>();
        assert_eq!(st_col.value(0), "esign");

        let text_col = batch
            .column_by_name("text")
            .expect("text col")
            .as_string::<i32>();
        assert!(
            !text_col.value(0).contains(plaintext),
            "external text column must contain ciphertext, not plaintext"
        );
        assert_eq!(decrypt_text_col(&batch, 0, &TEST_KEY), plaintext);

        let enc_col = batch
            .column_by_name("encrypted")
            .expect("enc col")
            .as_boolean();
        assert!(enc_col.value(0), "external rows must have encrypted=true");

        assert!(
            build_batch_external(&rows, &TEST_KEY, "matter-acme", PRIVILEGE_NONE, "unknown")
                .is_err(),
            "unknown connector source_type must be rejected"
        );
    }

    #[test]
    fn build_batch_external_accepts_new_connector_source_kinds() {
        use arrow_array::cast::AsArray;
        let plaintext = "Box folder document for the Acme matter.";
        let rows = vec![(
            Chunk {
                path: "box:folder:file-123".into(),
                paragraph_index: 0,
                text: plaintext.to_string(),
                start_offset: 0,
                end_offset: plaintext.len(),
                locator: None,
            },
            vec![0.1f32; EMBEDDING_DIM],
        )];

        let batch = build_batch_external(&rows, &TEST_KEY, "matter-acme", PRIVILEGE_NONE, "box")
            .expect("box should be accepted as an external source kind");
        let st_col = batch
            .column_by_name("source_type")
            .expect("st col")
            .as_string::<i32>();
        assert_eq!(st_col.value(0), "box");

        assert!(
            build_batch_external(&rows, &TEST_KEY, "matter-acme", PRIVILEGE_NONE, "not-real")
                .is_err(),
            "unknown connector source_type must still be rejected"
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
        let batch = build_batch_mail(&rows, &key, UNASSIGNED_MATTER, PRIVILEGE_NONE)
            .expect("build_batch_mail must succeed");
        let text_col = batch
            .column_by_name("text")
            .expect("text col")
            .as_string::<i32>();
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
        assert!(
            result.is_ok(),
            "S2: single-row build_batch_mail must return Ok; got {:?}",
            result.err()
        );
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
        let batch =
            build_batch_mail(&rows, &key, matter_id, PRIVILEGE_NONE).expect("build mail batch");
        let schema = batch.schema();
        table
            .add(Box::new(RecordBatchIterator::new(vec![Ok(batch)], schema)))
            .execute()
            .await
            .expect("add mail chunk");
    }

    /// Test helper: add several CRM chunks for one matter in a single batch.
    async fn add_crm_chunks(table: &Table, matter_id: &str, source_ids: &[String], seed: f32) {
        let key = [0x42u8; 32];
        let rows: Vec<(Chunk, Vec<f32>)> = source_ids
            .iter()
            .map(|sid| {
                (
                    Chunk {
                        path: sid.clone(),
                        paragraph_index: 0,
                        text: format!("crm record {sid}"),
                        start_offset: 0,
                        end_offset: 4,
                        locator: None,
                    },
                    vec![seed; EMBEDDING_DIM],
                )
            })
            .collect();
        let batch =
            build_batch_crm(&rows, &key, matter_id, PRIVILEGE_NONE).expect("build crm batch");
        let schema = batch.schema();
        table
            .add(Box::new(RecordBatchIterator::new(vec![Ok(batch)], schema)))
            .execute()
            .await
            .expect("add crm chunks");
    }

    /// REAL-SCALE regression for the sync hang (B-LAST): a 40-household sync's
    /// worth of CRM chunks across 40 matters (~200 items) is cleared by ONE
    /// `delete_crm_for_matters` call, while a MERGED household's file chunk under
    /// the same matter is preserved. The 1–2-household integration fixtures never
    /// reached this scale, so the live per-item delete loop (~200 sequential
    /// full-table deletes) hung here unnoticed.
    #[tokio::test]
    async fn delete_crm_for_matters_clears_all_crm_in_one_call_preserving_files() {
        let dir = tempfile::TempDir::new().unwrap();
        let conn = open_connection(dir.path()).await.expect("open conn");
        let table = open_or_create_table(&conn).await.expect("open table");

        // 40 matters, 5 CRM chunks each = 200 CRM rows (a 40-household sync).
        let mut matter_ids: Vec<String> = Vec::new();
        for h in 0..40 {
            let matter = format!("matter-{h}");
            matter_ids.push(matter.clone());
            let sids = vec![
                format!("crm:household:{h}"),
                format!("crm:contact:{h}a"),
                format!("crm:contact:{h}b"),
                format!("crm:note:{h}"),
                format!("crm:task:{h}"),
            ];
            add_crm_chunks(&table, &matter, &sids, 0.10 + (h as f32) * 0.001).await;
        }

        // matter-0 is a MERGED household: it ALSO has a file chunk that must survive.
        {
            let key = [0x42u8; 32];
            let rows = vec![(
                Chunk {
                    path: "/clients/bishop/statement.pdf".into(),
                    paragraph_index: 0,
                    text: "annual statement".into(),
                    start_offset: 0,
                    end_offset: 16,
                    locator: None,
                },
                vec![0.10f32; EMBEDDING_DIM],
            )];
            let batch = build_batch(
                &rows,
                SourceType::Text,
                "matter-0",
                PRIVILEGE_NONE,
                None,
                &key,
            )
            .expect("build file batch");
            let schema = batch.schema();
            table
                .add(Box::new(RecordBatchIterator::new(vec![Ok(batch)], schema)))
                .execute()
                .await
                .expect("add file chunk");
        }

        // ONE scoped delete clears every CRM chunk for all 40 matters.
        delete_crm_for_matters(&table, &matter_ids)
            .await
            .expect("delete crm for matters");

        // The merged matter-0 keeps ONLY its file chunk; its CRM chunks are gone.
        let q = vec![0.10f32; EMBEDDING_DIM];
        let hits = nearest(&table, &q, 50, Some("matter-0"), false, &[])
            .await
            .expect("nearest matter-0");
        let paths: Vec<String> = hits.iter().map(stored_path).collect();
        assert!(
            paths.iter().any(|p| p == "/clients/bishop/statement.pdf"),
            "the merged household's file chunk must survive the crm delete; got {paths:?}"
        );
        assert!(
            !paths.iter().any(|p| p.starts_with("crm:")),
            "all crm chunks for the matter must be gone after one delete; got {paths:?}"
        );

        // A different matter's CRM is gone too (the single IN-clause covered all 40).
        let hits2 = nearest(&table, &q, 50, Some("matter-17"), false, &[])
            .await
            .expect("nearest matter-17");
        assert!(
            !hits2.iter().map(stored_path).any(|p| p.starts_with("crm:")),
            "matter-17 crm must be gone after the single batched delete"
        );
    }

    /// FIRST-SYNC-COMPLETES + REPLACEMENT regression. Mirrors `engine::backfill`'s
    /// per-household delete-then-insert loop (the real thing needs the embedder +
    /// keychain, so we exercise the delete/insert shape directly). 40 households on
    /// an EMPTY table = 40 no-op scoped deletes + inserts — the exact first-sync
    /// shape that HUNG with the old per-ITEM delete loop; per household it completes.
    /// Then a re-sync of one household with a removed record leaves exactly the new
    /// set — no orphan, no duplicate — and other households are untouched.
    #[tokio::test]
    async fn per_household_replace_completes_at_scale_no_orphans_or_dupes() {
        let dir = tempfile::TempDir::new().unwrap();
        let conn = open_connection(dir.path()).await.expect("open conn");
        let table = open_or_create_table(&conn).await.expect("open table");

        // 40 households, 5 CRM records each (~200 items) — a first sync (empty table).
        let households: Vec<(String, Vec<String>)> = (0..40)
            .map(|h| {
                (
                    format!("matter-{h}"),
                    vec![
                        format!("crm:household:{h}"),
                        format!("crm:contact:{h}a"),
                        format!("crm:contact:{h}b"),
                        format!("crm:note:{h}"),
                        format!("crm:task:{h}"),
                    ],
                )
            })
            .collect();

        // First sync: per-household delete (a no-op on the empty table) then insert.
        for (matter, sids) in &households {
            delete_crm_for_matters(&table, std::slice::from_ref(matter))
                .await
                .expect("first-sync delete (no-op)");
            add_crm_chunks(&table, matter, sids, 0.10).await;
        }

        let q = vec![0.10f32; EMBEDDING_DIM];
        let crm0: Vec<String> = nearest(&table, &q, 50, Some("matter-0"), false, &[])
            .await
            .expect("nearest 0")
            .iter()
            .map(stored_path)
            .filter(|p| p.starts_with("crm:"))
            .collect();
        assert_eq!(
            crm0.len(),
            5,
            "first sync indexed all of matter-0; got {crm0:?}"
        );

        // Re-sync matter-0 with contact `0b` REMOVED in Wealthbox (4 records now).
        let m0 = "matter-0".to_string();
        let resynced = vec![
            "crm:household:0".to_string(),
            "crm:contact:0a".to_string(),
            // crm:contact:0b removed upstream
            "crm:note:0".to_string(),
            "crm:task:0".to_string(),
        ];
        delete_crm_for_matters(&table, std::slice::from_ref(&m0))
            .await
            .expect("re-sync delete");
        add_crm_chunks(&table, &m0, &resynced, 0.10).await;

        let crm0b: Vec<String> = nearest(&table, &q, 50, Some("matter-0"), false, &[])
            .await
            .expect("nearest 0 resync")
            .iter()
            .map(stored_path)
            .filter(|p| p.starts_with("crm:"))
            .collect();
        assert_eq!(
            crm0b.len(),
            4,
            "re-sync replaced matter-0: removed record gone, no dupes; got {crm0b:?}"
        );
        assert!(
            !crm0b.iter().any(|p| p == "crm:contact:0b"),
            "the removed contact must not survive re-sync; got {crm0b:?}"
        );
        let uniq: std::collections::HashSet<&String> = crm0b.iter().collect();
        assert_eq!(uniq.len(), crm0b.len(), "no duplicate chunks after re-sync");

        // A different household is untouched by matter-0's re-sync.
        let crm17: Vec<String> = nearest(&table, &q, 50, Some("matter-17"), false, &[])
            .await
            .expect("nearest 17")
            .iter()
            .map(stored_path)
            .filter(|p| p.starts_with("crm:"))
            .collect();
        assert_eq!(
            crm17.len(),
            5,
            "matter-17 unaffected by matter-0 re-sync; got {crm17:?}"
        );
    }

    /// PERF: a first sync's writes are bounded by MATTERS, not items. Mirrors the
    /// backfill commit shape after the perf fix — on a first sync there are NO deletes
    /// (nothing to clear) and ONE combined add per matter — so the table version (one
    /// bump per commit) grows by ~O(matters), NOT O(items). A regression back to
    /// per-item writes/deletes would blow this past `items`.
    #[tokio::test]
    async fn first_sync_writes_are_bounded_by_matters_not_items() {
        let dir = tempfile::TempDir::new().unwrap();
        let conn = open_connection(dir.path()).await.expect("open conn");
        let table = open_or_create_table(&conn).await.expect("open table");

        let v0 = table.version().await.expect("version0");

        // 40 matters, 5 records each (~200 items). First sync = no deletes, ONE add
        // per matter (the combined per-matter insert).
        for m in 0..40 {
            let matter = format!("matter-{m}");
            let sids: Vec<String> = (0..5).map(|i| format!("crm:rec:{m}-{i}")).collect();
            add_crm_chunks(&table, &matter, &sids, 0.10).await;
        }

        let v1 = table.version().await.expect("version1");
        let delta = v1 - v0;
        assert!(
            delta <= 2 * 40,
            "first-sync commits must be O(matters) (<= 80); got {delta} (regressed to per-item?)"
        );
        assert!(
            delta < 200,
            "first-sync commits must NOT be O(items=200); got {delta}"
        );
    }

    /// BUG-B (orphan cleanup): a matter that still has CRM chunks but is no longer
    /// synced (its household re-linked elsewhere) has its CRM purged by ONE scoped
    /// delete, while OTHER matters' CRM and the orphaned matter's FILE chunks survive.
    #[tokio::test]
    async fn orphan_matter_crm_is_purged_preserving_files_and_other_matters() {
        let dir = tempfile::TempDir::new().unwrap();
        let conn = open_connection(dir.path()).await.expect("open conn");
        let table = open_or_create_table(&conn).await.expect("open table");

        // matter-A: CRM + a file chunk (a merged household). matter-B: CRM only.
        add_crm_chunks(&table, "matter-A", &["crm:household:A".to_string()], 0.10).await;
        add_crm_chunks(&table, "matter-B", &["crm:household:B".to_string()], 0.11).await;
        {
            let key = [0x42u8; 32];
            let rows = vec![(
                Chunk {
                    path: "/clients/a.pdf".into(),
                    paragraph_index: 0,
                    text: "file".into(),
                    start_offset: 0,
                    end_offset: 4,
                    locator: None,
                },
                vec![0.10f32; EMBEDDING_DIM],
            )];
            let batch = build_batch(
                &rows,
                SourceType::Text,
                "matter-A",
                PRIVILEGE_NONE,
                None,
                &key,
            )
            .expect("file batch");
            let schema = batch.schema();
            table
                .add(Box::new(RecordBatchIterator::new(vec![Ok(batch)], schema)))
                .execute()
                .await
                .expect("add file");
        }

        // list_crm_matters sees both A and B.
        let matters = list_crm_matters(&table).await.expect("list crm matters");
        assert!(
            matters.contains("matter-A") && matters.contains("matter-B"),
            "got {matters:?}"
        );

        // A is orphaned (no longer synced) → purge its CRM only.
        delete_crm_for_matters(&table, &["matter-A".to_string()])
            .await
            .expect("purge orphan");

        // A's CRM gone; A's file chunk survives; B's CRM intact.
        let after = list_crm_matters(&table).await.expect("list after");
        assert!(
            !after.contains("matter-A"),
            "orphaned matter-A CRM must be purged; got {after:?}"
        );
        assert!(
            after.contains("matter-B"),
            "matter-B CRM must survive; got {after:?}"
        );
        let q = vec![0.10f32; EMBEDDING_DIM];
        let a_paths: Vec<String> = nearest(&table, &q, 20, Some("matter-A"), false, &[])
            .await
            .expect("nearest A")
            .iter()
            .map(stored_path)
            .collect();
        assert!(
            a_paths.iter().any(|p| p == "/clients/a.pdf"),
            "matter-A file chunk must survive; got {a_paths:?}"
        );
        assert!(
            !a_paths.iter().any(|p| p.starts_with("crm:")),
            "matter-A CRM must be gone; got {a_paths:?}"
        );
    }

    /// Multi-CRM safety boundary: a provider-scoped CRM cleanup under one matter
    /// removes only that provider's chunks. Without provider scoping, replacing
    /// Salesforce for a matter would also erase the legacy unprefixed Wealthbox
    /// chunks in the same matter.
    #[tokio::test]
    async fn delete_crm_for_matters_for_provider_preserves_other_crm_provider_chunks() {
        let dir = tempfile::TempDir::new().unwrap();
        let conn = open_connection(dir.path()).await.expect("open conn");
        let table = open_or_create_table(&conn).await.expect("open table");
        let matter = "matter-coexist".to_string();

        add_crm_chunks(
            &table,
            &matter,
            &[
                "crm:household:10001".to_string(),
                "crm:contact:10002".to_string(),
                "crm:household:sfdc:001HH0000000001AAA".to_string(),
                "crm:contact:sfdc:003CC0000000002AAA:acct:001HH0000000001AAA".to_string(),
            ],
            0.10,
        )
        .await;

        let before = list_crm_matters_for_provider(&table, "salesforce", &TEST_KEY)
            .await
            .expect("list salesforce matters");
        assert!(
            before.contains(&matter),
            "Salesforce chunks should be visible before cleanup"
        );

        delete_crm_for_matters_for_provider(
            &table,
            std::slice::from_ref(&matter),
            "salesforce",
            &TEST_KEY,
        )
        .await
        .expect("delete salesforce chunks only");

        let q = vec![0.10f32; EMBEDDING_DIM];
        let paths: Vec<String> = nearest(&table, &q, 20, Some(&matter), false, &[])
            .await
            .expect("nearest after provider delete")
            .iter()
            .map(stored_path)
            .collect();
        assert!(
            paths.iter().any(|p| p == "crm:household:10001"),
            "legacy Wealthbox household chunk must survive Salesforce cleanup; got {paths:?}"
        );
        assert!(
            paths.iter().any(|p| p == "crm:contact:10002"),
            "legacy Wealthbox contact chunk must survive Salesforce cleanup; got {paths:?}"
        );
        assert!(
            !paths.iter().any(|p| p.contains("sfdc:")),
            "Salesforce chunks must be gone after Salesforce cleanup; got {paths:?}"
        );

        let salesforce_after = list_crm_matters_for_provider(&table, "salesforce", &TEST_KEY)
            .await
            .expect("list salesforce after");
        let wealthbox_after = list_crm_matters_for_provider(&table, "wealthbox", &TEST_KEY)
            .await
            .expect("list wealthbox after");
        assert!(!salesforce_after.contains(&matter));
        assert!(wealthbox_after.contains(&matter));
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
        let hits_a = nearest(&table, &q, 10, Some("matter_a"), false, &[])
            .await
            .expect("nearest a");
        let paths_a: Vec<String> = hits_a.iter().map(stored_path).collect();
        assert!(
            paths_a.iter().any(|p| p == "mail:a-msg"),
            "Matter A scope must return Matter A mail"
        );
        assert!(
            !paths_a.iter().any(|p| p == "mail:b-msg"),
            "Matter A scope must NOT return Matter B mail"
        );

        // Scoped to Matter B: only the Matter-B mail comes back.
        let hits_b = nearest(&table, &q, 10, Some("matter_b"), false, &[])
            .await
            .expect("nearest b");
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
        let before = nearest(&table, &q, 10, Some("matter_a"), false, &[])
            .await
            .unwrap();
        assert!(before.iter().any(|h| stored_path(h) == "mail:movable"));

        // Re-tag to Matter B in place (VG-6e: the retag takes the plaintext
        // path + key and matches the tokenized predicate internally).
        let updated = retag_matter_for_path(&table, "mail:movable", "matter_b", &TEST_KEY)
            .await
            .expect("retag");
        assert_eq!(updated, 1, "exactly one chunk re-tagged");

        // Now it is gone from Matter A and present under Matter B.
        let after_a = nearest(&table, &q, 10, Some("matter_a"), false, &[])
            .await
            .unwrap();
        assert!(
            !after_a.iter().any(|h| stored_path(h) == "mail:movable"),
            "must leave Matter A after re-tag"
        );
        let after_b = nearest(&table, &q, 10, Some("matter_b"), false, &[])
            .await
            .unwrap();
        assert!(
            after_b.iter().any(|h| stored_path(h) == "mail:movable"),
            "must appear under Matter B after re-tag"
        );
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
        let batch = build_batch(
            &rows,
            SourceType::Text,
            UNASSIGNED_MATTER,
            PRIVILEGE_NONE,
            None,
            &TEST_KEY,
        )
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
        let set = list_indexed_mail_paths(&table, &TEST_KEY)
            .await
            .expect("list mail paths");
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
        upsert_chunks_for_path(
            &table,
            path,
            mk_rows("v1"),
            SourceType::Text,
            "matter_a",
            PRIVILEGE_NONE,
            &TEST_KEY,
        )
        .await
        .expect("first upsert");
        upsert_chunks_for_path(
            &table,
            path,
            mk_rows("v2"),
            SourceType::Text,
            "matter_a",
            PRIVILEGE_NONE,
            &TEST_KEY,
        )
        .await
        .expect("second upsert");
        let hits = nearest(&table, &q, 10, Some("matter_a"), false, &[])
            .await
            .unwrap();
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
        let moved = nearest(&table, &q, 10, Some("matter_b"), true, &[])
            .await
            .unwrap();
        assert!(moved.iter().any(|h| stored_path(h) == path));

        // delete_path drops the rows through the tokenized predicate.
        delete_path(&table, path, &TEST_KEY).await.expect("delete");
        let gone = nearest(&table, &q, 10, Some("matter_b"), true, &[])
            .await
            .unwrap();
        assert!(
            gone.is_empty(),
            "delete_path must remove the tokenized rows"
        );
    }

    /// SWAP-1 (re-index atomicity): re-indexing a file must be an ATOMIC swap —
    /// a retrieval that lands on ANY committed table version during the re-index
    /// still finds the file.
    ///
    /// The bug (demo step-4 finding 4): the old write path DELETED a path's
    /// chunks, then ADDED the new ones as TWO separate LanceDB commits. Between
    /// those commits there was a briefly-committed version in which the file had
    /// ZERO rows — an Ask that retrieved in that window missed the file entirely
    /// (a silent, brief disappearance of a source mid-write).
    ///
    /// This test reconstructs, via `checkout`, EXACTLY what a concurrent reader
    /// would have seen at every committed version from just-after-the-first-index
    /// through the final version, and proves the file is retrievable at each one —
    /// the literal "a retrieval interleaved between the write phases still finds
    /// the file" property.
    ///
    /// Deterministic RED→GREEN: with delete-then-add the re-index bumps the table
    /// version by TWO and the intermediate (post-delete) version has the file gone
    /// (RED). With the merge_insert atomic swap it bumps by exactly ONE and no gap
    /// version exists (GREEN).
    #[tokio::test]
    async fn reindex_is_atomic_no_retrieval_gap() {
        let dir = tempfile::TempDir::new().unwrap();
        let conn = open_connection(dir.path()).await.expect("open conn");
        let table = open_or_create_table(&conn).await.expect("open table");

        let path = "/ws/clients/acme/engagement.md";
        let matter = "matter_acme";
        let q = vec![0.11f32; EMBEDDING_DIM];
        let mk_rows = |texts: &[&str]| {
            texts
                .iter()
                .enumerate()
                .map(|(i, t)| {
                    (
                        Chunk {
                            path: path.into(),
                            paragraph_index: i as u32,
                            text: (*t).into(),
                            start_offset: 0,
                            end_offset: t.len(),
                            locator: None,
                        },
                        vec![0.11f32; EMBEDDING_DIM],
                    )
                })
                .collect::<Vec<_>>()
        };

        // v1: index the file with 3 chunks. This is the state a reader sees
        // BEFORE the re-index begins.
        upsert_chunks_for_path(
            &table,
            path,
            mk_rows(&["a1", "a2", "a3"]),
            SourceType::Text,
            matter,
            PRIVILEGE_NONE,
            &TEST_KEY,
        )
        .await
        .expect("v1 upsert");
        let version_before = table.version().await.expect("version before re-index");
        assert!(
            !nearest(&table, &q, 10, Some(matter), false, &[])
                .await
                .unwrap()
                .is_empty(),
            "file must be retrievable after the initial index"
        );

        // Re-index the SAME path with new content and a DIFFERENT chunk count
        // (3 → 2), exercising update + insert + stale-delete in one swap.
        upsert_chunks_for_path(
            &table,
            path,
            mk_rows(&["b1", "b2"]),
            SourceType::Text,
            matter,
            PRIVILEGE_NONE,
            &TEST_KEY,
        )
        .await
        .expect("re-index upsert");
        let version_after = table.version().await.expect("version after re-index");

        // (1) The swap is a SINGLE commit — there is no briefly-committed
        // in-between state a reader could land on. delete-then-add would be +2.
        assert_eq!(
            version_after,
            version_before + 1,
            "re-index must be ONE atomic commit (delete-then-add is +2, exposing a gap)"
        );

        // (2) The literal interleaving proof: for EVERY committed version a
        // reader could have landed on from just-after-v1 through the final
        // version, the file stays retrievable. Old code's post-delete/pre-add
        // version has the file gone → this fails deterministically.
        let reader = conn
            .open_table(TABLE_NAME)
            .execute()
            .await
            .expect("reader handle");
        for v in (version_before + 1)..=version_after {
            reader
                .checkout(v)
                .await
                .unwrap_or_else(|e| panic!("checkout v{v}: {e}"));
            let hits = nearest(&reader, &q, 10, Some(matter), false, &[])
                .await
                .unwrap_or_else(|e| panic!("nearest at v{v}: {e}"));
            assert!(
                hits.iter().any(|h| stored_path(h) == path),
                "file disappeared at committed version {v} during re-index — a \
                 retrieval interleaved with the write would miss it"
            );
        }

        // (3) After the swap, retrieval returns exactly the 2 NEW chunks — no
        // orphaned v1 rows, no dupes (guards QA-92's row-count contract).
        reader.checkout_latest().await.expect("checkout latest");
        let final_hits = nearest(&reader, &q, 10, Some(matter), false, &[])
            .await
            .unwrap();
        assert_eq!(
            final_hits
                .iter()
                .filter(|h| stored_path(h) == path)
                .count(),
            2,
            "after re-index exactly the 2 new chunks are present (no orphans/dupes)"
        );
    }

    /// P2 (adversarial review of SWAP-1): a pre-existing duplicate `id` — two
    /// physical rows already sharing the same chunk id under one path, however
    /// they got there (corruption, a stale race, migrated data) — must COLLAPSE
    /// back to exactly one row on the next re-index. `merge_insert`'s join on
    /// `id` documents behavior on multiple matches as undefined; the reviewer's
    /// repro showed `when_matched_update_all` updating BOTH duplicates in place
    /// (row count stays 2) instead of collapsing them. The old delete-then-add
    /// path cleaned such dupes for free (a fresh `add` after a full delete can
    /// never duplicate) — the atomic merge_insert swap needs its own dedup pass
    /// to keep that guarantee.
    ///
    /// Also proves the fix stays gap-free: every committed version from just
    /// before the re-index through the final (deduped) version still has the
    /// row retrievable — the collapse never passes through a "row missing"
    /// state, only a possibly-briefly-duplicated one.
    #[tokio::test]
    async fn reindex_collapses_preexisting_duplicate_id_rows() {
        let dir = tempfile::TempDir::new().unwrap();
        let conn = open_connection(dir.path()).await.expect("open conn");
        let table = open_or_create_table(&conn).await.expect("open table");

        let path = "/ws/clients/acme/dup.md";
        let matter = "matter_dup";
        let q = vec![0.33f32; EMBEDDING_DIM];
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
                vec![0.33f32; EMBEDDING_DIM],
            )]
        };

        // Seed a pre-existing DUPLICATE: two physical rows sharing the same id
        // (sha256(path, 0)), written directly via `add` (bypassing merge_insert
        // entirely) to reconstruct exactly the corruption the reviewer's repro
        // found — a state that must never happen going forward once this fix
        // ships, but must be recoverable if it's already on disk.
        for _ in 0..2 {
            let batch = build_batch(
                &mk_rows("stale"),
                SourceType::Text,
                matter,
                PRIVILEGE_NONE,
                None,
                &TEST_KEY,
            )
            .expect("build stale batch");
            let schema = batch.schema();
            table
                .add(Box::new(RecordBatchIterator::new(vec![Ok(batch)], schema)))
                .execute()
                .await
                .expect("seed duplicate row");
        }

        let token = super::super::crypto::path_token(&TEST_KEY, path);
        let path_predicate = format!("path = '{}'", sql_escape(&token));
        let precondition = table
            .count_rows(Some(path_predicate.clone()))
            .await
            .expect("count rows before re-index");
        assert_eq!(
            precondition, 2,
            "test setup must seed exactly 2 duplicate rows"
        );
        let version_before = table.version().await.expect("version before re-index");

        // Re-index the SAME single-chunk file. This drives merge_insert's `id`
        // join straight into the pre-existing duplicate — the exact repro.
        upsert_chunks_for_path(
            &table,
            path,
            mk_rows("fresh"),
            SourceType::Text,
            matter,
            PRIVILEGE_NONE,
            &TEST_KEY,
        )
        .await
        .expect("re-index over duplicate rows");
        let version_after = table.version().await.expect("version after re-index");

        let after = table
            .count_rows(Some(path_predicate))
            .await
            .expect("count rows after re-index");
        assert_eq!(
            after, 1,
            "re-index must collapse the pre-existing duplicate to exactly ONE row"
        );

        // Gap-free proof: at every committed version from just-before the
        // re-index through the final (deduped) version, the row stays
        // retrievable — the collapse never passes through "row missing".
        let reader = conn
            .open_table(TABLE_NAME)
            .execute()
            .await
            .expect("reader handle");
        for v in version_before..=version_after {
            reader
                .checkout(v)
                .await
                .unwrap_or_else(|e| panic!("checkout v{v}: {e}"));
            let hits = nearest(&reader, &q, 10, Some(matter), false, &[])
                .await
                .unwrap_or_else(|e| panic!("nearest at v{v}: {e}"));
            assert!(
                hits.iter().any(|h| stored_path(h) == path),
                "row disappeared at committed version {v} while collapsing the \
                 pre-existing duplicate — a retrieval interleaved with the \
                 dedup pass would miss it"
            );
        }

        let hits = nearest(&table, &q, 10, Some(matter), false, &[])
            .await
            .unwrap();
        let matches: Vec<_> = hits.iter().filter(|h| stored_path(h) == path).collect();
        assert_eq!(
            matches.len(),
            1,
            "retrieval must see exactly one row post-collapse"
        );
        let text = {
            use crate::commands::mail::crypto::decrypt_with_key;
            let blob = hex::decode(&matches[0].text).expect("hex text");
            String::from_utf8(decrypt_with_key(&blob, &TEST_KEY).expect("decrypt text"))
                .expect("utf8")
        };
        assert_eq!(
            text, "fresh",
            "surviving row must carry the NEW content, not the stale duplicate"
        );
    }

    /// F2 defense-in-depth: an incoming batch whose rows share a chunk `id`
    /// (same path + paragraph_index — the shape a PDF band overflow would
    /// produce) must be REJECTED before the merge, not silently collapsed to
    /// one row by undefined `merge_insert` behavior. An honest indexing failure
    /// beats silent content loss.
    #[tokio::test]
    async fn duplicate_incoming_ids_are_rejected_single_path() {
        let dir = tempfile::TempDir::new().unwrap();
        let conn = open_connection(dir.path()).await.expect("open conn");
        let table = open_or_create_table(&conn).await.expect("open table");

        let path = "/ws/clients/acme/collide.md";
        // Two rows with the SAME paragraph_index -> the SAME chunk_id.
        let rows = vec![
            (
                Chunk {
                    path: path.into(),
                    paragraph_index: 0,
                    text: "first".into(),
                    start_offset: 0,
                    end_offset: 5,
                    locator: None,
                },
                vec![0.5f32; EMBEDDING_DIM],
            ),
            (
                Chunk {
                    path: path.into(),
                    paragraph_index: 0,
                    text: "second".into(),
                    start_offset: 0,
                    end_offset: 6,
                    locator: None,
                },
                vec![0.5f32; EMBEDDING_DIM],
            ),
        ];

        let err = upsert_chunks_for_path(
            &table,
            path,
            rows,
            SourceType::Text,
            "matter_x",
            PRIVILEGE_NONE,
            &TEST_KEY,
        )
        .await
        .expect_err("duplicate incoming ids must be rejected");
        assert!(
            format!("{err:#}").contains("duplicate incoming chunk id"),
            "error must name the duplicate-id cause, got: {err:#}"
        );
    }

    /// F2 defense-in-depth, grouped (sectioned) path: two page/sheet groups
    /// carrying a colliding chunk `id` (what a band overflow produces across
    /// PDF pages) must be rejected before the merge.
    #[tokio::test]
    async fn duplicate_incoming_ids_are_rejected_grouped_path() {
        let dir = tempfile::TempDir::new().unwrap();
        let conn = open_connection(dir.path()).await.expect("open conn");
        let table = open_or_create_table(&conn).await.expect("open table");

        let path = "/ws/clients/acme/collide.pdf";
        let mk = |pi: u32, text: &str| {
            (
                Chunk {
                    path: path.into(),
                    paragraph_index: pi,
                    text: text.into(),
                    start_offset: 0,
                    end_offset: text.len(),
                    locator: None,
                },
                vec![0.5f32; EMBEDDING_DIM],
            )
        };
        // Two groups (different pages) whose rows collide on paragraph_index 0.
        let groups: Vec<(SourceType, Option<(&str, f32)>, Vec<(Chunk, Vec<f32>)>)> = vec![
            (SourceType::Pdf { page_number: 1 }, None, vec![mk(0, "p1")]),
            (SourceType::Pdf { page_number: 2 }, None, vec![mk(0, "p2")]),
        ];

        let err = upsert_grouped(&table, path, groups, "matter_x", PRIVILEGE_NONE, &TEST_KEY)
            .await
            .expect_err("duplicate incoming ids across groups must be rejected");
        assert!(
            format!("{err:#}").contains("duplicate incoming chunk id"),
            "error must name the duplicate-id cause, got: {err:#}"
        );
    }

    /// P1.1 (Windows regression): rows written under the NATIVE backslash path
    /// (what the Rust WalkDir/reconcile sees on Windows) must be reachable by a
    /// delete/retag issued with the FORWARD-SLASH form (what the TS side builds
    /// via appPath and passes to retag/delete). Because `path_token` now
    /// normalizes, the two forms produce the SAME token, so cross-form ops match.
    /// (Before the fix the tokens differed, the op matched ZERO rows, and a mapped
    /// file silently dropped out of matter-scoped search on Windows.)
    #[tokio::test]
    async fn cross_slash_form_token_matches_rows_on_windows_paths() {
        use crate::commands::rag::crypto::path_token;
        let dir = tempfile::TempDir::new().unwrap();
        let conn = open_connection(dir.path()).await.expect("open conn");
        let table = open_or_create_table(&conn).await.expect("open table");

        // Written under the native Windows (backslash) form, as WalkDir yields it.
        let backslash = r"C:\WS\Clients\Acme\engagement.docx";
        // Referenced later via the forward-slash form the TS side produces.
        let forward = "C:/WS/Clients/Acme/engagement.docx";

        // The normalizer collapses them to ONE token now (the fix).
        assert_eq!(
            path_token(&TEST_KEY, backslash),
            path_token(&TEST_KEY, forward),
            "backslash and forward-slash forms of one file must tokenize identically"
        );

        let rows = vec![(
            Chunk {
                path: backslash.into(),
                paragraph_index: 0,
                text: "engagement".into(),
                start_offset: 0,
                end_offset: 10,
                locator: None,
            },
            vec![0.10f32; EMBEDDING_DIM],
        )];
        upsert_chunks_for_path(
            &table,
            backslash,
            rows,
            SourceType::Docx,
            UNASSIGNED_MATTER,
            PRIVILEGE_NONE,
            &TEST_KEY,
        )
        .await
        .expect("upsert under backslash path");

        // (a) A BATCHED matter retag issued with the FORWARD-slash form (the exact
        // boot-retag path) must hit the backslash-written rows.
        let updated = retag_matter_for_paths(&table, &[forward.to_string()], "acme", &TEST_KEY)
            .await
            .expect("batched retag via forward-slash form");
        assert!(updated >= 1, "forward-slash retag must match the backslash rows");
        let q = vec![0.10f32; EMBEDDING_DIM];
        let in_acme = nearest(&table, &q, 10, Some("acme"), false, &[]).await.unwrap();
        assert!(
            in_acme.iter().any(|h| stored_path(h) == backslash),
            "the file must now be in the 'acme' matter scope after a forward-slash retag"
        );

        // (b) delete_by_token over the forward-slash token also purges the rows.
        delete_by_token(&table, &path_token(&TEST_KEY, forward))
            .await
            .expect("delete by forward-slash token");
        let gone = nearest(&table, &q, 10, None, false, &[]).await.unwrap();
        assert!(gone.is_empty(), "forward-slash delete must purge the backslash rows");
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
        upsert_chunks_for_path(
            &table,
            secret_path,
            rows,
            SourceType::Text,
            "matter_a",
            PRIVILEGE_NONE,
            &TEST_KEY,
        )
        .await
        .expect("upsert");

        // Read path first: the real path comes back via path_enc...
        let q = vec![0.10f32; EMBEDDING_DIM];
        let hits = nearest(&table, &q, 5, Some("matter_a"), false, &[])
            .await
            .unwrap();
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
        for entry in walkdir::WalkDir::new(&dataset_dir)
            .into_iter()
            .filter_map(|e| e.ok())
        {
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
        assert!(
            files_scanned > 0,
            "expected to scan at least one on-disk LanceDB file"
        );
    }
}
