// File-type detection + text extraction for the RAG indexer.
//
// M1 deliberately ships with TEXT FORMATS ONLY (`.md`, `.txt`, `.aichat`,
// `.workflow`, `.json`, `.csv`). Document formats — `.xlsx`, `.docx`,
// `.pptx`, `.rtf` — already have frontend extractors in
// `src/utils/{spreadsheet,docx,pptx,rtf}-io.ts` and a Rust-side extractor
// would be a near-duplicate. They land in a follow-up; the file walker
// silently skips them today.
//
// Centralizing the supported-extension list here also lets the workspace
// walker filter aggressively before opening files (no point reading a 100MB
// .png just to discover we won't index it).

use std::fs;
use std::path::Path;

/// Extensions whose contents are read as raw UTF-8 text and indexed.
pub const TEXT_EXTENSIONS: &[&str] = &[
    "md", "markdown", "txt", "text", "aichat", "workflow", "json", "csv",
    "log", "yml", "yaml", "toml",
];

/// TODO(M1-followup): extend with `.xlsx`, `.docx`, `.pptx`, `.rtf` once
/// the Rust-side extractors land. Frontend already has them in
/// `src/utils/{spreadsheet,docx,pptx,rtf}-io.ts` but they're TS modules.
const _DOCUMENT_EXTENSIONS_TODO: &[&str] = &["xlsx", "docx", "pptx", "rtf"];

/// Returns true if `path` has an extension we know how to index today.
pub fn is_indexable(path: &Path) -> bool {
    let Some(ext) = path.extension().and_then(|e| e.to_str()) else {
        return false;
    };
    let ext_lower = ext.to_ascii_lowercase();
    TEXT_EXTENSIONS.iter().any(|t| *t == ext_lower)
}

/// Returns true if the path lives inside a directory we always skip
/// (`node_modules`, `.git`, `.projelli`, etc). Keeps the workspace walker
/// O(useful files) rather than O(every file on disk).
pub fn is_skipped_dir_name(name: &str) -> bool {
    matches!(
        name,
        ".git"
            | ".projelli"
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
    fn aichat_and_workflow_are_indexable() {
        assert!(is_indexable(&PathBuf::from("/a/x.aichat")));
        assert!(is_indexable(&PathBuf::from("/a/x.workflow")));
    }

    #[test]
    fn images_are_not_indexable() {
        assert!(!is_indexable(&PathBuf::from("/a/x.png")));
        assert!(!is_indexable(&PathBuf::from("/a/x.jpg")));
        assert!(!is_indexable(&PathBuf::from("/a/x.pdf")));
    }

    #[test]
    fn document_formats_skipped_in_m1() {
        // Per the M1 scope decision: text formats only.
        assert!(!is_indexable(&PathBuf::from("/a/x.xlsx")));
        assert!(!is_indexable(&PathBuf::from("/a/x.docx")));
        assert!(!is_indexable(&PathBuf::from("/a/x.pptx")));
        assert!(!is_indexable(&PathBuf::from("/a/x.rtf")));
    }

    #[test]
    fn no_extension_not_indexable() {
        assert!(!is_indexable(&PathBuf::from("/a/no-ext")));
    }

    #[test]
    fn standard_skip_dirs() {
        assert!(is_skipped_dir_name(".git"));
        assert!(is_skipped_dir_name("node_modules"));
        assert!(is_skipped_dir_name(".projelli"));
        assert!(is_skipped_dir_name("target"));
        assert!(!is_skipped_dir_name("docs"));
        assert!(!is_skipped_dir_name("src"));
    }
}
