//! P1.1 — persistent per-source freshness manifest for the RAG store.
//!
//! # Why this exists
//!
//! Before P1.1 the app re-extracted + re-embedded EVERY supported workspace file
//! on every launch (~20 min on a real laptop for ~300 files), because the only
//! "already indexed" state was an in-memory latch that a fresh process forgets.
//! The persistent LanceDB store held the vectors, but nothing recorded WHICH file
//! version those vectors were built from — so boot always rebuilt from scratch.
//!
//! This manifest is that missing durable freshness layer. It records, per indexed
//! source, a cheap **signature** (size + mtime + the pipeline versions that
//! produced the rows). At boot, `rag_reconcile_workspace` stat-walks the tree and
//! re-indexes ONLY files whose signature changed (or are new / deleted), instead
//! of the whole workspace.
//!
//! # Fail-SAFE, never fail-OPEN
//!
//! A missing, unreadable, corrupt, or version-mismatched manifest is treated as
//! "no knowledge" → an EMPTY manifest → reconcile re-indexes everything (slow, but
//! exactly today's behaviour, and always correct). The worst case is "index a
//! file we didn't need to", never a lost row. The one caveat: freshness is judged
//! by size + mtime, so an edit that preserves BOTH (an mtime-preserving tool, or
//! coarse FS granularity) made while the app is closed could be skipped until the
//! file changes again. Live edits are caught by the file watcher regardless; the
//! reserved `hash` field exists to close this gap later. The fail-CLOSED retrieval
//! guarantees (BUG-099 tombstones) live elsewhere and are unaffected by this file.
//!
//! # Isolation (matter / privilege) rides the manifest
//!
//! Each signature records the `matter_id` and `privilege` the source's rows are
//! filed under. When a CHANGED existing file is re-indexed during reconcile it is
//! re-indexed under that SAME recorded scope — never silently widened to the
//! `unassigned` / `none` defaults that the cold full-walk uses. A brand-new file
//! (absent from the manifest) gets the default scope and is then narrowed by the
//! frontend's folder→matter retag, exactly as it is on a cold index. Reconcile can
//! only preserve or narrow scope, never widen it.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

/// Manifest file schema version. Bump when the on-disk JSON shape OR its key
/// format changes in a way older/newer code can't read; a mismatch makes `load`
/// return empty (→ a one-time full reconcile rebuilds it under the new shape).
///
/// v2: the `sources` map is keyed by the HMAC PATH TOKEN, not the plaintext path
/// (privacy + Windows-token parity — see the `sources` field doc). A v1 manifest
/// held plaintext-path keys, so it MUST be discarded rather than read with the new
/// token lookups (which would treat every entry as missing and could pass a
/// plaintext key to a token-based delete). The version mismatch discards it and a
/// full reconcile rebuilds it correctly.
///
/// v3: `path_token` now NORMALIZES the path (folds `\`→`/`) before the HMAC, so
/// the native-Windows form and the forward-slash form of one file tokenize
/// identically (commit 74e24612). That change altered how EVERY token is
/// derived, but did not bump this version at the time. A v2 manifest written
/// BEFORE normalization holds tokens over the raw backslash path; after
/// normalization the disk walk computes forward-slash tokens, so every v2 entry
/// mismatches and the whole workspace looks deleted — the boot-reconcile
/// delete-flood. We cannot tell a normalized-v2 from a non-normalized-v2 file on
/// disk (both just say `manifest_version: 2`), so any pre-v3 manifest is treated
/// as stale-key-format and REBUILT from scratch (drop table + full re-index),
/// which re-derives every token under the normalizer. This is a one-time reindex
/// for existing installs and the only correct migration.
pub const MANIFEST_VERSION: u32 = 3;

/// Bump when the text/office extraction pipeline changes in a way that would
/// produce different chunk TEXT for the same bytes (new extractor, changed
/// paragraph joining, etc.). A bump invalidates every non-matching signature so
/// affected files re-index on the next boot.
pub const EXTRACTOR_VERSION: u32 = 1;

/// Bump when the chunker changes (window/overlap/segmentation) so the same text
/// would chunk differently.
pub const CHUNKER_VERSION: u32 = 1;

/// Identity of the embedding model. A different model produces incomparable
/// vectors, so a change here must re-embed everything. Ties to
/// `model_download::MODEL_REPO`.
pub const EMBEDDER_VERSION: &str = "intfloat/multilingual-e5-small";

/// Bump when the PDF text-extraction path (PDF.js pipeline / page handling)
/// changes in a way that alters extracted text.
pub const PDF_EXTRACTOR_VERSION: u32 = 1;

/// Bump when the OCR engine/model or its post-processing changes so a scanned
/// page would extract differently.
pub const OCR_VERSION: u32 = 1;

/// Manifest filename, in the workspace data dir (sibling of `vectors/`, NOT
/// inside the LanceDB dataset dir). Living beside the dataset — not in it — keeps
/// a locked/being-rebuilt dataset dir from blocking a manifest read/write, and
/// mirrors where the durable tombstone lives.
const MANIFEST_FILE: &str = "rag-manifest-v1.json";

/// PDF-specific half of a source signature. `None` on non-PDF sources.
///
/// `page_count` is a RESULT of extraction (informational; surfaced for debugging
/// and future partial-OCR logic) and does NOT gate the skip decision — we can't
/// know it without opening the file, which is the work we're trying to avoid. The
/// skip gate is size + mtime + the version/OCR INPUTS below.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct PdfSignature {
    pub pdf_extractor_version: u32,
    /// Whether OCR was enabled when this PDF was indexed. If the user flips the
    /// OCR setting, the input changed → the PDF re-indexes.
    pub ocr_enabled: bool,
    pub ocr_version: u32,
    /// Informational: pages extracted last time. Not part of the skip gate.
    #[serde(default)]
    pub page_count: u32,
    /// The PDF was successfully checked but deliberately stored no searchable
    /// rows (for example: encrypted, OCR disabled, or safely rejected OCR).
    /// Missing on older manifests, so `false` preserves QA-92's healing rule
    /// for legacy PDF receipts whose vector rows disappeared.
    #[serde(default)]
    pub empty_index: bool,
}

/// The freshness signature of one indexed source.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct SourceSignature {
    /// File size in bytes at index time.
    pub size: u64,
    /// File modification time in nanoseconds since the Unix epoch. Stored as
    /// `i128` so it can't overflow and can represent pre-epoch mtimes.
    pub mtime_ns: i128,
    /// Reserved: a content hash for filesystems/workflows where mtime is
    /// unreliable. `None` in v1 (size+mtime is the standard, cheap signal); the
    /// field exists so a future hardening can populate it without a schema bump.
    #[serde(default)]
    pub hash: Option<String>,
    pub extractor_version: u32,
    pub chunker_version: u32,
    pub embedder_version: String,
    /// `Some` iff this source is a PDF (the expensive OCR path).
    #[serde(default)]
    pub pdf: Option<PdfSignature>,
    /// Isolation: the confidentiality scope this source's rows carry. Re-applied
    /// verbatim when a changed file is re-indexed, so reconcile never widens scope.
    pub matter_id: String,
    pub privilege: String,
    /// Durable privacy provenance for meeting-derived files. Unlike the
    /// sibling meeting.json, this receipt survives that manifest becoming
    /// unreadable, so a later reconcile cannot silently downgrade the source
    /// to an ordinary document.
    #[serde(default)]
    pub meeting_derived: bool,
    /// Informational: chunk rows written last time.
    #[serde(default)]
    pub row_count: u32,
    /// Unix seconds when the source was last successfully indexed.
    #[serde(default)]
    pub indexed_at: i64,
}

impl SourceSignature {
    /// True when this recorded signature still matches the CURRENT file stat and
    /// the CURRENT pipeline versions — i.e. the source can be safely skipped.
    ///
    /// `current_pdf` carries the CURRENT pdf inputs (extractor/OCR versions +
    /// whether OCR is enabled now) for a PDF source, or `None` for a non-PDF. A
    /// source that changed type (was PDF, now isn't, or vice-versa) never matches.
    pub fn is_fresh(
        &self,
        current_size: u64,
        current_mtime_ns: i128,
        current_pdf: Option<&PdfInputs>,
    ) -> bool {
        if self.size != current_size || self.mtime_ns != current_mtime_ns {
            return false;
        }
        if self.extractor_version != EXTRACTOR_VERSION
            || self.chunker_version != CHUNKER_VERSION
            || self.embedder_version != EMBEDDER_VERSION
        {
            return false;
        }
        match (&self.pdf, current_pdf) {
            (None, None) => true,
            (Some(recorded), Some(now)) => {
                recorded.pdf_extractor_version == now.pdf_extractor_version
                    && recorded.ocr_enabled == now.ocr_enabled
                    && recorded.ocr_version == now.ocr_version
            }
            // Type changed (PDF↔non-PDF): never fresh.
            _ => false,
        }
    }
}

/// The CURRENT pdf inputs used to decide whether a PDF source is still fresh.
/// Distinct from `PdfSignature` (which also records the page-count RESULT).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PdfInputs {
    pub pdf_extractor_version: u32,
    pub ocr_enabled: bool,
    pub ocr_version: u32,
}

impl PdfInputs {
    /// The current PDF inputs given whether OCR is enabled right now.
    pub fn current(ocr_enabled: bool) -> Self {
        Self {
            pdf_extractor_version: PDF_EXTRACTOR_VERSION,
            ocr_enabled,
            ocr_version: OCR_VERSION,
        }
    }
}

/// The persistent per-workspace manifest.
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct Manifest {
    #[serde(default)]
    pub manifest_version: u32,
    /// The RAG schema `INDEX_VERSION` this manifest was built against. When it is
    /// below the live `INDEX_VERSION`, a schema migration is due and the manifest
    /// is rebuilt by the one-time full walk (see `store::needs_migration`).
    #[serde(default)]
    pub index_version: u32,
    /// Keyed by each source's HMAC PATH TOKEN (`crypto::path_token` over the same
    /// path string its LanceDB rows were written under) — NOT a plaintext path.
    /// This keeps no client/matter file map on disk (VG-6e parity) and makes the
    /// key agree with the stored rows, so the reconcile's delete/tombstone-by-key
    /// hits the right rows on every platform (incl. Windows backslash paths).
    #[serde(default)]
    pub sources: BTreeMap<String, SourceSignature>,
}

impl Manifest {
    /// A fresh, empty manifest stamped for the given schema version.
    pub fn new(index_version: u32) -> Self {
        Self {
            manifest_version: MANIFEST_VERSION,
            index_version,
            sources: BTreeMap::new(),
        }
    }

    pub fn get(&self, normalized_path: &str) -> Option<&SourceSignature> {
        self.sources.get(normalized_path)
    }

    pub fn insert(&mut self, normalized_path: String, sig: SourceSignature) {
        self.sources.insert(normalized_path, sig);
    }

    pub fn remove(&mut self, normalized_path: &str) {
        self.sources.remove(normalized_path);
    }
}

/// The reconcile decision for one workspace file: skip it, or re-index it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FileDecision {
    /// Signature unchanged and not tombstoned → nothing to do; its rows stay.
    Skip,
    /// New / changed / tombstoned → (re)index. `prior_scope` carries the
    /// previously-recorded `(matter_id, privilege)` when the file was already in
    /// the manifest, so the caller re-indexes under that SAME scope (never widened
    /// to the defaults). `None` means a genuinely new file — the caller uses the
    /// default unassigned/none scope.
    Reindex { prior_scope: Option<(String, String)> },
}

/// Decide what a boot reconcile should do with one file, given its recorded
/// manifest entry (if any), its current stat, and whether its path is
/// tombstoned. Pure + total so it is unit-testable without a DB, model, or FS.
///
/// A tombstoned file ALWAYS re-indexes (to clear the tombstone), even if its
/// signature looks fresh. A file re-indexes under its previously-recorded scope
/// so reconcile never widens confidentiality scope.
pub fn decide_file(
    entry: Option<&SourceSignature>,
    current: Option<(u64, i128)>,
    tombstoned: bool,
) -> FileDecision {
    let prior_scope = entry.map(|e| (e.matter_id.clone(), e.privilege.clone()));
    if tombstoned {
        return FileDecision::Reindex { prior_scope };
    }
    match (entry, current) {
        // Text/office are never PDFs in the Rust walker → current_pdf = None.
        (Some(e), Some((size, mtime))) if e.is_fresh(size, mtime, None) => FileDecision::Skip,
        _ => FileDecision::Reindex { prior_scope },
    }
}

/// Absolute path of the manifest file for a workspace.
pub fn manifest_path(workspace_root: &Path) -> PathBuf {
    crate::commands::data_dir::workspace_data_dir(workspace_root)
        .join(MANIFEST_FILE)
}

/// Load the manifest for a workspace.
///
/// FAIL-SAFE: any problem (absent, unreadable, malformed JSON, or a
/// manifest/schema version mismatch) yields an EMPTY manifest stamped for
/// `current_index_version`. An empty manifest makes reconcile treat every file as
/// new → it re-indexes the whole workspace, which is always correct (just as slow
/// as today). The manifest can only ever speed boot up, never skip a stale file.
pub fn load(workspace_root: &Path, current_index_version: u32) -> Manifest {
    let path = manifest_path(workspace_root);
    let raw = match std::fs::read_to_string(&path) {
        Ok(s) => s,
        Err(e) => {
            if e.kind() != std::io::ErrorKind::NotFound {
                log::warn!(
                    "rag manifest: {:?} exists but could not be read ({e}); \
                     treating as empty → full reconcile",
                    path
                );
            }
            return Manifest::new(current_index_version);
        }
    };
    match serde_json::from_str::<Manifest>(&raw) {
        Ok(m) if m.manifest_version == MANIFEST_VERSION => m,
        Ok(m) => {
            log::info!(
                "rag manifest: version {} != current {} — rebuilding via full reconcile",
                m.manifest_version,
                MANIFEST_VERSION
            );
            Manifest::new(current_index_version)
        }
        Err(e) => {
            log::warn!("rag manifest: malformed JSON at {:?} ({e}); treating as empty", path);
            Manifest::new(current_index_version)
        }
    }
}

/// Persist the manifest atomically (temp file + rename), best-effort.
///
/// A failed save is non-fatal: the next boot just reconciles against a stale/older
/// manifest, which at worst re-indexes a few already-fresh files. It never causes
/// a stale ROW (the vectors are already written), so we surface the error to the
/// caller for logging but callers treat it as best-effort.
pub fn save(workspace_root: &Path, manifest: &Manifest) -> std::io::Result<()> {
    let path = manifest_path(workspace_root);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).ok();
    }
    let body = serde_json::to_vec_pretty(manifest)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
    // Pid-tagged temp so concurrent writers don't collide, then atomic rename.
    let tmp = path.with_extension(format!("json.tmp.{}", std::process::id()));
    std::fs::write(&tmp, &body)?;
    if let Err(rename_err) = std::fs::rename(&tmp, &path) {
        // Windows: a replacing move can fail with a sharing violation. Fall back
        // to a direct write so the manifest still persists; then drop the temp.
        // (Losing atomicity here is harmless — a torn manifest just triggers a
        // fuller reconcile next boot, never a stale row.)
        let direct = std::fs::write(&path, &body);
        let _ = std::fs::remove_file(&tmp);
        direct?;
        let _ = rename_err;
    }
    Ok(())
}

/// True iff a manifest file exists on disk AND was written in an OLDER key-format
/// version than the live `MANIFEST_VERSION` (`1 <= version < MANIFEST_VERSION`).
///
/// Any such manifest may hold source keys whose HMAC-token derivation differs
/// from the current one, so its keys cannot be reliably matched against the
/// LanceDB rows written by this build:
///   - v1 kept plaintext-path keys (a token-based delete could get a plaintext
///     key), and
///   - a pre-v3 (v2) manifest predates path normalization, so its tokens are
///     over the raw backslash path while the disk walk now tokenizes the
///     normalized path — a mismatch that makes the whole workspace look deleted
///     (the boot-reconcile delete-flood).
///
/// Either way the reconcile must REBUILD the store from scratch (drop table +
/// full re-index) rather than silently discard the manifest — discarding it
/// while the table survives would strand a deleted-while-closed file's rows
/// (their token is only recoverable from the stale key), leaving deleted content
/// searchable. Absent / unreadable / already-current / newer (future) manifests
/// return false (no rebuild needed — a newer format is forward-compat and load()
/// simply starts empty).
pub fn has_stale_key_format(workspace_root: &Path) -> bool {
    match std::fs::read_to_string(manifest_path(workspace_root)) {
        Ok(s) => serde_json::from_str::<Manifest>(&s)
            .map(|m| m.manifest_version >= 1 && m.manifest_version < MANIFEST_VERSION)
            .unwrap_or(false),
        Err(_) => false,
    }
}

/// Delete the manifest file (used when a schema migration drops the table, so the
/// stale signatures can't wrongly skip files against the freshly-rebuilt store).
pub fn delete(workspace_root: &Path) {
    let path = manifest_path(workspace_root);
    match std::fs::remove_file(&path) {
        Ok(()) => {}
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => log::warn!("rag manifest: failed to delete {:?}: {e}", path),
    }
}

/// Cheap stat of a file → `(size, mtime_ns)`. `None` when the file can't be
/// stat'd (missing / permission). This is the ONLY filesystem work the reconcile
/// "checking" phase does per unchanged file — no read, no extract, no embed.
pub fn stat_signature(path: &Path) -> Option<(u64, i128)> {
    let meta = std::fs::metadata(path).ok()?;
    let size = meta.len();
    let mtime_ns = meta
        .modified()
        .ok()
        .map(system_time_to_ns)
        // A filesystem without mtime support → 0, so size alone drives freshness.
        .unwrap_or(0);
    Some((size, mtime_ns))
}

/// Convert a `SystemTime` to signed nanoseconds since the Unix epoch (handles
/// pre-epoch times without underflow).
fn system_time_to_ns(t: std::time::SystemTime) -> i128 {
    match t.duration_since(std::time::UNIX_EPOCH) {
        Ok(d) => d.as_nanos() as i128,
        Err(e) => -(e.duration().as_nanos() as i128),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn text_sig(size: u64, mtime: i128) -> SourceSignature {
        SourceSignature {
            size,
            mtime_ns: mtime,
            hash: None,
            extractor_version: EXTRACTOR_VERSION,
            chunker_version: CHUNKER_VERSION,
            embedder_version: EMBEDDER_VERSION.to_string(),
            pdf: None,
            matter_id: "unassigned".into(),
            privilege: "none".into(),
            meeting_derived: false,
            row_count: 3,
            indexed_at: 0,
        }
    }

    #[test]
    fn fresh_when_stat_and_versions_match() {
        let sig = text_sig(100, 42);
        assert!(sig.is_fresh(100, 42, None));
    }

    #[test]
    fn older_receipts_default_to_non_meeting_provenance() {
        let mut value = serde_json::to_value(text_sig(100, 42)).unwrap();
        value
            .as_object_mut()
            .unwrap()
            .remove("meeting_derived");
        let restored: SourceSignature = serde_json::from_value(value).unwrap();
        assert!(!restored.meeting_derived);
    }

    #[test]
    fn stale_on_size_change() {
        let sig = text_sig(100, 42);
        assert!(!sig.is_fresh(101, 42, None));
    }

    #[test]
    fn stale_on_mtime_change() {
        let sig = text_sig(100, 42);
        assert!(!sig.is_fresh(100, 43, None));
    }

    #[test]
    fn stale_on_extractor_version_bump() {
        let mut sig = text_sig(100, 42);
        sig.extractor_version = EXTRACTOR_VERSION + 1; // simulate an older build's entry
        assert!(!sig.is_fresh(100, 42, None));
    }

    #[test]
    fn stale_on_embedder_change() {
        let mut sig = text_sig(100, 42);
        sig.embedder_version = "some-other-model".into();
        assert!(!sig.is_fresh(100, 42, None));
    }

    #[test]
    fn pdf_fresh_when_ocr_inputs_match() {
        let mut sig = text_sig(100, 42);
        sig.pdf = Some(PdfSignature {
            pdf_extractor_version: PDF_EXTRACTOR_VERSION,
            ocr_enabled: true,
            ocr_version: OCR_VERSION,
            page_count: 12,
            empty_index: false,
        });
        let now = PdfInputs::current(true);
        assert!(sig.is_fresh(100, 42, Some(&now)));
    }

    #[test]
    fn pdf_stale_when_ocr_toggled() {
        let mut sig = text_sig(100, 42);
        sig.pdf = Some(PdfSignature {
            pdf_extractor_version: PDF_EXTRACTOR_VERSION,
            ocr_enabled: false,
            ocr_version: OCR_VERSION,
            page_count: 12,
            empty_index: false,
        });
        // OCR now ON → input changed → must re-index.
        let now = PdfInputs::current(true);
        assert!(!sig.is_fresh(100, 42, Some(&now)));
    }

    #[test]
    fn type_change_is_never_fresh() {
        // Recorded as a PDF, now presented as non-PDF (and vice-versa).
        let mut sig = text_sig(100, 42);
        sig.pdf = Some(PdfSignature {
            pdf_extractor_version: PDF_EXTRACTOR_VERSION,
            ocr_enabled: true,
            ocr_version: OCR_VERSION,
            page_count: 1,
            empty_index: false,
        });
        assert!(!sig.is_fresh(100, 42, None));
        let text = text_sig(100, 42);
        let now = PdfInputs::current(true);
        assert!(!text.is_fresh(100, 42, Some(&now)));
    }

    #[test]
    fn round_trips_through_disk() {
        let dir = tempfile::TempDir::new().unwrap();
        let mut m = Manifest::new(10);
        m.insert("C:/ws/a.txt".into(), text_sig(10, 1));
        m.insert("C:/ws/b.docx".into(), text_sig(20, 2));
        save(dir.path(), &m).unwrap();

        let loaded = load(dir.path(), 10);
        assert_eq!(loaded.manifest_version, MANIFEST_VERSION);
        assert_eq!(loaded.index_version, 10);
        assert_eq!(loaded.sources.len(), 2);
        assert_eq!(loaded.get("C:/ws/a.txt"), Some(&text_sig(10, 1)));
    }

    #[test]
    fn missing_manifest_loads_empty() {
        let dir = tempfile::TempDir::new().unwrap();
        let m = load(dir.path(), 10);
        assert!(m.sources.is_empty());
        assert_eq!(m.index_version, 10);
    }

    #[test]
    fn corrupt_manifest_fails_safe_to_empty() {
        let dir = tempfile::TempDir::new().unwrap();
        let path = manifest_path(dir.path());
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, b"{ this is not valid json ").unwrap();
        let m = load(dir.path(), 10);
        // Fail-safe: empty → reconcile will re-index everything (correct).
        assert!(m.sources.is_empty());
    }

    #[test]
    fn version_mismatch_rebuilds_empty() {
        let dir = tempfile::TempDir::new().unwrap();
        let path = manifest_path(dir.path());
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        // A manifest written by a future/older shape (version 999).
        std::fs::write(&path, br#"{"manifest_version":999,"index_version":10,"sources":{}}"#).unwrap();
        let m = load(dir.path(), 10);
        assert_eq!(m.manifest_version, MANIFEST_VERSION);
        assert!(m.sources.is_empty());
    }

    #[test]
    fn has_stale_key_format_detects_all_older_formats() {
        let dir = tempfile::TempDir::new().unwrap();
        // Absent → false.
        assert!(!has_stale_key_format(dir.path()));
        // Current (MANIFEST_VERSION) → false.
        save(dir.path(), &Manifest::new(10)).unwrap();
        assert!(!has_stale_key_format(dir.path()));
        let p = manifest_path(dir.path());
        // A v1 (plaintext-key era) manifest → true.
        std::fs::write(&p, br#"{"manifest_version":1,"index_version":10,"sources":{}}"#).unwrap();
        assert!(has_stale_key_format(dir.path()));
        // A v2 (pre-normalization token era) manifest → true — this is the
        // boot-reconcile delete-flood case: its tokens are over raw backslash
        // paths and no longer match the normalized disk walk, so it must rebuild.
        std::fs::write(&p, br#"{"manifest_version":2,"index_version":10,"sources":{}}"#).unwrap();
        assert!(has_stale_key_format(dir.path()));
        // A hypothetical future version → false (forward-compat; load() starts empty).
        std::fs::write(&p, br#"{"manifest_version":9,"index_version":10,"sources":{}}"#).unwrap();
        assert!(!has_stale_key_format(dir.path()));
    }

    // Round-3 P1 regression: a pre-reconcile incremental manifest write (PDF-record
    // or watcher index) load+saves the manifest, which upgrades a stale v2 file to
    // the current version and erases the has_stale_key_format signal. The durable
    // rebuild-required marker planted at workspace-open must survive that write, so
    // the boot reconcile STILL drops + rebuilds and deleted-while-closed rows are
    // purged.
    #[test]
    fn stale_v2_manifest_still_forces_rebuild_after_a_pre_reconcile_incremental_write() {
        use crate::commands::rag::reconcile::mark_rebuild_if_manifest_stale;
        use crate::commands::rag::store::is_rebuild_required;
        let dir = tempfile::TempDir::new().unwrap();
        let root = dir.path();
        let p = manifest_path(root);
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        // A pre-normalization v2 manifest is on disk.
        std::fs::write(&p, br#"{"manifest_version":2,"index_version":10,"sources":{}}"#).unwrap();
        assert!(has_stale_key_format(root), "v2 is stale");
        assert!(!is_rebuild_required(root), "no rebuild marker yet");

        // rag_set_workspace (earliest per-open hook) observes the stale manifest and
        // durably records the rebuild-required — BEFORE any writer runs.
        mark_rebuild_if_manifest_stale(root);
        assert!(is_rebuild_required(root), "workspace-open must plant the marker");

        // Now an incremental writer (rag_manifest_record_pdf) runs BEFORE reconcile:
        // load() treats the v2 file as empty and save() writes a fresh CURRENT-version
        // manifest — erasing the has_stale_key_format signal.
        let mut m = load(root, 10);
        m.insert("some-pdf-token".to_string(), text_sig(100, 42));
        save(root, &m).unwrap();
        assert!(
            !has_stale_key_format(root),
            "the incremental save upgraded the on-disk version (the trap)"
        );

        // ...but the durable rebuild marker SURVIVES, so reconcile still rebuilds.
        assert!(
            is_rebuild_required(root),
            "the rebuild signal must survive a pre-reconcile incremental write"
        );
    }

    #[test]
    fn delete_removes_file_and_is_idempotent() {
        let dir = tempfile::TempDir::new().unwrap();
        let m = Manifest::new(10);
        save(dir.path(), &m).unwrap();
        assert!(manifest_path(dir.path()).exists());
        delete(dir.path());
        assert!(!manifest_path(dir.path()).exists());
        // Second delete is a no-op, not an error.
        delete(dir.path());
    }

    #[test]
    fn decide_new_file_reindexes_with_default_scope() {
        // No manifest entry → new file → reindex, no prior scope.
        let d = decide_file(None, Some((10, 1)), false);
        assert_eq!(d, FileDecision::Reindex { prior_scope: None });
    }

    #[test]
    fn decide_unchanged_file_skips() {
        let sig = text_sig(10, 1);
        let d = decide_file(Some(&sig), Some((10, 1)), false);
        assert_eq!(d, FileDecision::Skip);
    }

    #[test]
    fn decide_changed_file_reindexes_preserving_scope() {
        // A file scoped to matter "acme" that changed on disk must re-index UNDER
        // "acme", never widened to unassigned.
        let mut sig = text_sig(10, 1);
        sig.matter_id = "acme".into();
        sig.privilege = "attorney_client".into();
        let d = decide_file(Some(&sig), Some((11, 2)), false); // size+mtime changed
        assert_eq!(
            d,
            FileDecision::Reindex {
                prior_scope: Some(("acme".into(), "attorney_client".into()))
            }
        );
    }

    #[test]
    fn decide_tombstoned_file_reindexes_even_when_fresh() {
        // Fresh signature but tombstoned → must re-index to clear the tombstone,
        // and still under its recorded scope.
        let mut sig = text_sig(10, 1);
        sig.matter_id = "acme".into();
        let d = decide_file(Some(&sig), Some((10, 1)), true);
        assert_eq!(
            d,
            FileDecision::Reindex {
                prior_scope: Some(("acme".into(), "none".into()))
            }
        );
    }

    #[test]
    fn decide_missing_stat_reindexes() {
        // Can't stat (e.g. vanished mid-walk) → fail safe toward reindex.
        let sig = text_sig(10, 1);
        assert!(matches!(
            decide_file(Some(&sig), None, false),
            FileDecision::Reindex { .. }
        ));
    }

    #[test]
    fn stat_signature_reads_real_file() {
        let dir = tempfile::TempDir::new().unwrap();
        let f = dir.path().join("x.txt");
        std::fs::write(&f, b"hello world").unwrap();
        let (size, mtime) = stat_signature(&f).expect("stat");
        assert_eq!(size, 11);
        assert!(mtime > 0);
        assert!(stat_signature(&dir.path().join("nope.txt")).is_none());
    }
}
