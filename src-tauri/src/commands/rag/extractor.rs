// File-type detection + content access for the RAG indexer.
//
// Two families are indexable (VG-2b — the M1 "text formats only" scope
// decision is closed by the vision gap closure plan):
//   - TEXT_EXTENSIONS: read as raw UTF-8 (`read_text`) and chunked directly.
//   - OFFICE_EXTENSIONS: read as bytes (`read_bytes`) and extracted natively
//     Rust-side — docx via the keepance-docx tree walk, xlsx/pptx/rtf via
//     `office.rs`. `index_one_file` dispatches on `classify`.
//
// PDFs are deliberately NOT here: extraction runs renderer-side (PDF.js)
// and lands through `rag_index_pdf_chunks`.
//
// Centralizing the supported-extension list here also lets the workspace
// walker filter aggressively before opening files (no point reading a 100MB
// .png just to discover we won't index it).

use std::fs;
use std::path::Path;

/// Extensions whose contents are read as raw UTF-8 text and indexed.
///
/// F-508: `.aichat` and `.workflow` are deliberately NOT here. They are AI
/// artifacts (chat answers, run records); indexing them feeds derived text
/// back into matter memory where it competes with primary sources and
/// creates retrieval feedback loops (a chat retrieving its own first turn
/// was observed live). Full-text search still sees them via the frontend.
pub const TEXT_EXTENSIONS: &[&str] = &[
    "md", "markdown", "txt", "text", "json", "csv",
    "log", "yml", "yaml", "toml",
];

/// VG-2b — office formats the Rust indexer extracts natively (docx via the
/// keepance-docx tree walk; xlsx/pptx/rtf via office.rs). The M1 "text
/// formats only" scope decision is closed by the vision gap closure plan.
pub const OFFICE_EXTENSIONS: &[&str] = &["docx", "xlsx", "pptx", "rtf"];

/// How an indexable file's content is extracted. Returned by `classify`;
/// `index_one_file` dispatches on it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IndexKind {
    /// Raw UTF-8 text (`TEXT_EXTENSIONS`) — read + chunk directly.
    Text,
    /// Word document — keepance-docx parse + plain-text tree walk.
    Docx,
    /// Workbook — per-sheet sections via `office::extract_xlsx_sections`.
    Xlsx,
    /// Slide deck — per-slide sections via `office::extract_pptx_sections`.
    Pptx,
    /// Rich Text — `office::extract_rtf_text`.
    Rtf,
}

/// Classify a path into its extraction kind, or `None` when we don't index
/// it. A basename starting with `~$` (the transient Word/Excel/PowerPoint
/// lock file that exists while a document is open) is ALWAYS `None` — lock
/// files are junk that would churn the watcher and carry no document text.
pub fn classify(path: &Path) -> Option<IndexKind> {
    let name = path.file_name()?.to_str()?;
    if name.starts_with("~$") {
        return None;
    }
    let ext = path.extension()?.to_str()?;
    let ext_lower = ext.to_ascii_lowercase();
    if TEXT_EXTENSIONS.iter().any(|t| *t == ext_lower) {
        return Some(IndexKind::Text);
    }
    match ext_lower.as_str() {
        "docx" => Some(IndexKind::Docx),
        "xlsx" => Some(IndexKind::Xlsx),
        "pptx" => Some(IndexKind::Pptx),
        "rtf" => Some(IndexKind::Rtf),
        _ => None,
    }
}

/// Returns true if `path` has an extension we know how to index today.
pub fn is_indexable(path: &Path) -> bool {
    classify(path).is_some()
}

/// Returns true if the path lives inside a directory we always skip
/// (`node_modules`, `.git`, the internal data dir, etc). Keeps the workspace walker
/// O(useful files) rather than O(every file on disk).
pub fn is_skipped_dir_name(name: &str) -> bool {
    if name == crate::identity::WORKSPACE_DATA_DIR {
        return true;
    }
    matches!(
        name,
        ".git"
            | "node_modules"
            | "target"
            | "dist"
            | "build"
            | ".venv"
            | "venv"
            | "__pycache__"
            | ".cache"
    )
}

/// Read a file's text content. Returns `None` on read errors so the caller
/// can skip and keep processing the rest of the workspace. Files larger
/// than `MAX_FILE_BYTES` are skipped to avoid OOM on accidental large
/// blobs (logs, binary data) the user might have under their workspace.
pub const MAX_FILE_BYTES: u64 = 5 * 1024 * 1024; // 5 MiB

pub fn read_text(path: &Path) -> Option<String> {
    let meta = fs::metadata(path).ok()?;
    if meta.len() > MAX_FILE_BYTES {
        return None;
    }
    fs::read_to_string(path).ok()
}

/// Size cap for office packages (`read_bytes`). Larger than `MAX_FILE_BYTES`
/// on purpose: office packages routinely carry embedded media (images in a
/// deck, logos in a letterhead) that inflate the ZIP while the text-bearing
/// XML parts stay small — and the extractors in `office.rs`/keepance-docx
/// have their own decompression-bomb budgets past this gate.
pub const MAX_OFFICE_FILE_BYTES: u64 = 50 * 1024 * 1024; // 50 MiB

/// Read a file's raw bytes for the office extractors. Returns `None` on
/// read errors or when the file exceeds `MAX_OFFICE_FILE_BYTES`, so the
/// caller can skip and keep processing the rest of the workspace (mirrors
/// `read_text`).
pub fn read_bytes(path: &Path) -> Option<Vec<u8>> {
    let meta = fs::metadata(path).ok()?;
    if meta.len() > MAX_OFFICE_FILE_BYTES {
        return None;
    }
    fs::read(path).ok()
}

/// Read a text file's raw bytes using the same `MAX_FILE_BYTES` (5 MiB) cap as
/// `read_text`. Used by the RAG indexer's decrypt-on-read seam (VG-6d): we need
/// the raw bytes to check for KPV1 magic before converting to UTF-8, but we still
/// want to enforce the text-file size limit, not the more permissive office limit.
pub fn read_text_bytes(path: &Path) -> Option<Vec<u8>> {
    let meta = fs::metadata(path).ok()?;
    if meta.len() > MAX_FILE_BYTES {
        return None;
    }
    fs::read(path).ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn markdown_is_indexable() {
        assert!(is_indexable(&PathBuf::from("/a/b/c.md")));
        assert!(is_indexable(&PathBuf::from("/a/b/c.MD")));
        assert!(is_indexable(&PathBuf::from("/a/b/c.markdown")));
    }

    #[test]
    fn ai_artifacts_are_not_indexable() {
        // F-508: `.aichat` and `.workflow` are AI-derived artifacts. Indexing
        // them pollutes matter memory with the model's own output, which then
        // competes with primary sources at retrieval (feedback loop observed
        // live in the wedge-proof run).
        assert!(!is_indexable(&PathBuf::from("/a/x.aichat")));
        assert!(!is_indexable(&PathBuf::from("/a/x.workflow")));
    }

    #[test]
    fn images_are_not_indexable() {
        assert!(!is_indexable(&PathBuf::from("/a/x.png")));
        assert!(!is_indexable(&PathBuf::from("/a/x.jpg")));
        assert!(!is_indexable(&PathBuf::from("/a/x.pdf")));
    }

    #[test]
    fn office_formats_are_indexable() {
        // VG-2b closes the M1 "text formats only" scope decision: the Rust
        // indexer extracts office documents natively (docx via keepance-docx,
        // xlsx/pptx/rtf via office.rs), so the walker and the watcher both
        // light up for them.
        assert!(is_indexable(&PathBuf::from("/a/x.xlsx")));
        assert!(is_indexable(&PathBuf::from("/a/x.docx")));
        assert!(is_indexable(&PathBuf::from("/a/x.DOCX")));
        assert!(is_indexable(&PathBuf::from("/a/x.pptx")));
        assert!(is_indexable(&PathBuf::from("/a/x.rtf")));
    }

    #[test]
    fn office_lock_files_are_never_indexable() {
        // "~$contract.docx" is the transient Word/Excel/PowerPoint lock file
        // that appears while a document is open. Indexing it would churn the
        // watcher (it is created/deleted constantly) and it carries no
        // document text.
        assert!(!is_indexable(&PathBuf::from("/a/~$contract.docx")));
        assert!(!is_indexable(&PathBuf::from("/a/~$model.xlsx")));
        // The guard is on the basename, never on a directory component.
        assert!(is_indexable(&PathBuf::from("/a/contract.docx")));
    }

    #[test]
    fn pdf_stays_on_the_ts_extraction_path() {
        // PDFs are extracted renderer-side (PDF.js) and indexed via
        // rag_index_pdf_chunks; the Rust walk must keep skipping them.
        assert!(!is_indexable(&PathBuf::from("/a/x.pdf")));
    }

    #[test]
    fn no_extension_not_indexable() {
        assert!(!is_indexable(&PathBuf::from("/a/no-ext")));
    }

    #[test]
    fn classify_maps_extensions_to_kinds() {
        assert_eq!(classify(&PathBuf::from("/a/x.md")), Some(IndexKind::Text));
        assert_eq!(classify(&PathBuf::from("/a/x.csv")), Some(IndexKind::Text));
        assert_eq!(classify(&PathBuf::from("/a/x.docx")), Some(IndexKind::Docx));
        assert_eq!(classify(&PathBuf::from("/a/x.xlsx")), Some(IndexKind::Xlsx));
        assert_eq!(classify(&PathBuf::from("/a/x.pptx")), Some(IndexKind::Pptx));
        assert_eq!(classify(&PathBuf::from("/a/x.rtf")), Some(IndexKind::Rtf));
        // Case-insensitive, like the text extensions always were.
        assert_eq!(classify(&PathBuf::from("/a/x.XLSX")), Some(IndexKind::Xlsx));
        assert_eq!(classify(&PathBuf::from("/a/x.pdf")), None);
        assert_eq!(classify(&PathBuf::from("/a/~$x.docx")), None);
        assert_eq!(classify(&PathBuf::from("/a/no-ext")), None);
    }

    #[test]
    fn standard_skip_dirs() {
        assert!(is_skipped_dir_name(".git"));
        assert!(is_skipped_dir_name("node_modules"));
        assert!(is_skipped_dir_name(crate::identity::WORKSPACE_DATA_DIR));
        assert!(is_skipped_dir_name("target"));
        assert!(!is_skipped_dir_name("docs"));
        assert!(!is_skipped_dir_name("src"));
    }
}
