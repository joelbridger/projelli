//! Tauri command layer for the in-house OOXML document engine (WS-A / A1).
//!
//! These are **thin wrappers** over the `keepance-docx` crate. All real work —
//! parsing, serialization, the package/preserve-by-default logic, authoring —
//! lives in the engine crate so it can be tested fast and in isolation. This
//! module's job is just: marshal between the frontend (paths + JSON `Value`s)
//! and the engine, and map engine errors to user-facing strings.
//!
//! Commands:
//!   * [`docx_open`] — read a `.docx` from disk into the JSON DOM the React
//!     editor (A3) renders.
//!   * [`docx_save`] — write the JSON DOM back to a `.docx`, PRESERVING every
//!     unmodeled part of the file currently at that path (styles, numbering,
//!     theme, fonts, headers/footers, media, ...). When the target path does
//!     not yet exist, a minimal new package is synthesized.
//!   * [`docx_author_revision`] — the helper the AI redliner (A4) will call:
//!     add a new tracked change (insertion / deletion) to the DOM and return
//!     the updated DOM. Pure DOM-in / DOM-out; no disk I/O.
//!
//! The JSON DOM shape is defined by `keepance_docx::Document` (serde,
//! camelCase). See the engine crate for the authoritative schema.

use std::path::Path;

use keepance_docx::author;
use keepance_docx::{
    document_from_value, document_to_value, serialize_docx_bytes, Document, OpenedDocument,
};
use serde_json::Value;

/// The document DOM as a JSON `Value` — the exact serde serialization of
/// `keepance_docx::Document` (camelCase, tag-discriminated). This is what the
/// `docx_*` commands hand to / take from the React editor; the engine crate
/// owns the authoritative schema.
pub type DocumentJson = Value;

// ---------------------------------------------------------------------------
// Pure, testable core (no Tauri, no #[command]) — the commands delegate here.
// ---------------------------------------------------------------------------

/// Read `.docx` bytes from `path` and return the JSON DOM.
pub fn open_to_json(path: &Path) -> Result<DocumentJson, String> {
    let bytes = std::fs::read(path).map_err(|e| format!("read {}: {e}", path.display()))?;
    let opened = OpenedDocument::open_bytes(&bytes).map_err(|e| e.to_string())?;
    document_to_value(&opened.document).map_err(|e| e.to_string())
}

/// Serialize the JSON DOM to `.docx` bytes, preserving the unmodeled parts of
/// the file currently at `path` (if any). Returns the bytes to write.
///
/// Stateless preserve-by-default: the original package is recovered by reading
/// whatever is already at `path`. For an edit, that file is the source document
/// whose styles/theme/etc. must survive; for a brand-new document the path does
/// not exist and we synthesize minimal plumbing.
pub fn save_from_json(path: &Path, document_json: Value) -> Result<Vec<u8>, String> {
    let document: Document = document_from_value(document_json).map_err(|e| e.to_string())?;

    match std::fs::read(path) {
        Ok(existing) => {
            // Preserve the original package's unmodeled parts.
            let opened = OpenedDocument::open_bytes(&existing).map_err(|e| e.to_string())?;
            opened
                .with_document(document)
                .save_bytes()
                .map_err(|e| e.to_string())
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            // Brand-new document: synthesize minimal plumbing.
            serialize_docx_bytes(&document).map_err(|e| e.to_string())
        }
        Err(e) => Err(format!("read {}: {e}", path.display())),
    }
}

/// The kind of revision the AI can author. Matches the strings the A4 layer
/// passes from JS.
pub fn author_revision_core(
    document_json: Value,
    kind: &str,
    author_name: &str,
    paragraph_index: usize,
    text: Option<&str>,
    needle: Option<&str>,
    date: &str,
) -> Result<DocumentJson, String> {
    let mut document: Document =
        document_from_value(document_json).map_err(|e| e.to_string())?;

    match kind {
        "insertion" | "insert" => {
            let text = text.ok_or("insertion requires `text`")?;
            author::insert_at_paragraph_end(
                &mut document,
                paragraph_index,
                text,
                author_name,
                date,
            )
            .ok_or_else(|| format!("paragraph index {paragraph_index} out of range"))?;
        }
        "insertParagraph" | "insert_paragraph" => {
            let text = text.ok_or("insertParagraph requires `text`")?;
            author::insert_paragraph_after(
                &mut document,
                paragraph_index,
                text,
                author_name,
                date,
            );
        }
        "deletion" | "delete" => {
            let needle = needle.ok_or("deletion requires `needle` (text to delete)")?;
            author::delete_run_containing(
                &mut document,
                paragraph_index,
                needle,
                author_name,
                date,
            )
            .ok_or_else(|| {
                format!("no run containing {needle:?} found in paragraph {paragraph_index}")
            })?;
        }
        other => return Err(format!("unknown revision kind: {other:?}")),
    }

    document_to_value(&document).map_err(|e| e.to_string())
}

// ---------------------------------------------------------------------------
// Tauri command surface — thin wrappers around the core fns above.
// ---------------------------------------------------------------------------

/// Open a `.docx` file at `path` and return its JSON DOM for the editor.
#[tauri::command]
pub async fn docx_open(path: String) -> Result<DocumentJson, String> {
    tokio::task::spawn_blocking(move || open_to_json(Path::new(&path)))
        .await
        .map_err(|e| format!("task join error: {e}"))?
}

/// Save the JSON DOM `document` back to a `.docx` at `path`, preserving the
/// unmodeled parts of any existing file there.
#[tauri::command]
pub async fn docx_save(path: String, document: Value) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        let p = Path::new(&path);
        let bytes = save_from_json(p, document)?;
        std::fs::write(p, bytes).map_err(|e| format!("write {}: {e}", p.display()))
    })
    .await
    .map_err(|e| format!("task join error: {e}"))?
}

/// Author a new tracked change on the JSON DOM and return the updated DOM.
///
/// This is the helper task A4 (AI redlining) calls. Parameters:
///   * `kind` — `"insertion"` / `"deletion"` / `"insertParagraph"`.
///   * `author` — the author string stamped on the revision (defaults to
///     `"Keepance AI"` when empty).
///   * `paragraph_index` — which paragraph (counting only paragraphs) to edit.
///   * `text` — the inserted text (for insertion / insertParagraph).
///   * `needle` — the existing text to mark deleted (for deletion).
///   * `date` — ISO-8601 timestamp; defaults to now (UTC) when empty.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn docx_author_revision(
    document: Value,
    kind: String,
    author: Option<String>,
    paragraph_index: usize,
    text: Option<String>,
    needle: Option<String>,
    date: Option<String>,
) -> Result<DocumentJson, String> {
    tokio::task::spawn_blocking(move || {
        let author_name = match author {
            Some(a) if !a.trim().is_empty() => a,
            _ => keepance_docx::author::AI_AUTHOR.to_string(),
        };
        let date = match date {
            Some(d) if !d.trim().is_empty() => d,
            _ => keepance_docx::author::now_iso(),
        };
        author_revision_core(
            document,
            &kind,
            &author_name,
            paragraph_index,
            text.as_deref(),
            needle.as_deref(),
            &date,
        )
    })
    .await
    .map_err(|e| format!("task join error: {e}"))?
}

#[cfg(test)]
mod tests {
    use super::*;
    use keepance_docx::fixture::build_fixture_model;
    use keepance_docx::{document_to_value, parse_docx_bytes};

    /// Smoke test of the command-layer core: open -> author -> save round-trips
    /// a real file on disk, preserving content and adding a revision. Exercises
    /// the exact code paths the Tauri commands call (minus the async/IPC shell).
    #[test]
    fn command_layer_open_author_save_roundtrip() {
        // Write a fixture .docx to a temp path.
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("matter.docx");
        let bytes = keepance_docx::serialize_docx_bytes(&build_fixture_model()).unwrap();
        std::fs::write(&path, &bytes).unwrap();

        // 1. open_to_json returns a JSON DOM with the existing revisions.
        let json = open_to_json(&path).expect("open");
        assert_eq!(json["formatVersion"], 1);
        let body = json["body"].as_array().expect("body array");
        assert!(!body.is_empty());

        // 2. author a new AI insertion via the core fn.
        let authored = author_revision_core(
            json,
            "insertion",
            "Keepance AI",
            0,
            Some(" Authored by command layer."),
            None,
            "2026-06-09T00:00:00Z",
        )
        .expect("author");

        // 3. save_from_json writes back, preserving the original package and
        //    adding the new revision.
        let out_bytes = save_from_json(&path, authored).expect("save");
        std::fs::write(&path, &out_bytes).unwrap();

        // 4. re-open from disk and confirm originals + the new AI revision.
        let reparsed = parse_docx_bytes(&std::fs::read(&path).unwrap()).expect("reparse");
        let revs = reparsed.revisions();
        // 2 originals (opposing counsel) + 1 new (Keepance AI) = 3.
        assert_eq!(revs.len(), 3, "expected originals + authored revision");
        assert!(revs.iter().any(|(m, _, _)| m.author == "Keepance AI"));
        assert!(revs.iter().any(|(m, _, _)| m.author == "Opposing Counsel"));
        // Comment preserved.
        assert!(reparsed.comments.contains_key("1"));
    }

    #[test]
    fn author_revision_deletion_path() {
        let json = document_to_value(&build_fixture_model()).unwrap();
        let out = author_revision_core(
            json,
            "deletion",
            "Keepance AI",
            0,
            None,
            Some("resolve all "),
            "2026-06-09T00:00:00Z",
        )
        .expect("author deletion");
        let doc = keepance_docx::document_from_value(out).unwrap();
        assert!(doc
            .revisions()
            .iter()
            .any(|(m, k, runs)| m.author == "Keepance AI"
                && *k == keepance_docx::RevisionKind::Deletion
                && runs.iter().any(|r| r.text.contains("resolve all"))));
    }

    #[test]
    fn author_revision_rejects_unknown_kind() {
        let json = document_to_value(&build_fixture_model()).unwrap();
        let err = author_revision_core(json, "bogus", "X", 0, None, None, "d").unwrap_err();
        assert!(err.contains("unknown revision kind"), "got: {err}");
    }

    #[test]
    fn save_new_document_when_path_absent() {
        // No file at path -> synthesize a fresh package.
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("brand-new.docx");
        let json = document_to_value(&build_fixture_model()).unwrap();
        let bytes = save_from_json(&path, json).expect("save new");
        // It parses back as a valid document with the fixture's content.
        let doc = parse_docx_bytes(&bytes).expect("parse new");
        assert_eq!(doc.revisions().len(), 2);
    }

    /// Smoke test the ACTUAL `#[tauri::command]` async surface (not just the
    /// core fns): docx_open -> docx_author_revision -> docx_save, end to end,
    /// through a tokio runtime. These commands take plain `String`/`Value`
    /// arguments (no Tauri `State`/`Window`), so they are directly callable in a
    /// test — this guards the async/spawn_blocking shell + arg marshalling.
    #[tokio::test]
    async fn async_command_surface_open_author_save_smoke() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("matter.docx");
        let bytes = keepance_docx::serialize_docx_bytes(&build_fixture_model()).unwrap();
        std::fs::write(&path, &bytes).unwrap();
        let path_str = path.to_string_lossy().to_string();

        // 1. docx_open (async command) returns the JSON DOM.
        let json = super::docx_open(path_str.clone())
            .await
            .expect("docx_open command");
        assert_eq!(json["formatVersion"], 1);

        // 2. docx_author_revision (async command) adds an AI insertion.
        let authored = super::docx_author_revision(
            json,
            "insertion".to_string(),
            Some("Keepance AI".to_string()),
            0,
            Some(" Authored via async command.".to_string()),
            None,
            Some("2026-06-09T00:00:00Z".to_string()),
        )
        .await
        .expect("docx_author_revision command");

        // 3. docx_save (async command) writes it back to disk.
        super::docx_save(path_str.clone(), authored)
            .await
            .expect("docx_save command");

        // 4. Re-open and confirm originals + the new AI revision survived.
        let reopened = super::docx_open(path_str).await.expect("reopen");
        let doc = keepance_docx::document_from_value(reopened).unwrap();
        let revs = doc.revisions();
        assert_eq!(revs.len(), 3, "expected 2 originals + 1 authored");
        assert!(revs.iter().any(|(m, _, _)| m.author == "Keepance AI"));
        assert!(doc.comments.contains_key("1"), "comment preserved");
    }

    /// The async command surface must surface errors (not panic) for bad input:
    /// opening a path that is not a .docx returns Err.
    #[tokio::test]
    async fn async_command_open_rejects_non_docx() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("garbage.docx");
        std::fs::write(&path, b"not a zip at all").unwrap();
        let res = super::docx_open(path.to_string_lossy().to_string()).await;
        assert!(res.is_err(), "opening non-docx must error");
    }
}
