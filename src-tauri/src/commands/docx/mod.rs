//! Tauri command layer for the in-house OOXML document engine (WS-A / A1).
//!
//! These are **thin wrappers** over the `lantern-docx` crate. All real work —
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
//!   * [`docx_resolve_revision`] / [`docx_resolve_all`] — the helpers the editor
//!     (A3) calls to ACCEPT / REJECT one tracked change (by revision id) or all
//!     of them (the review pane's bulk buttons). Pure DOM-in / DOM-out; no disk
//!     I/O. The `action` is a plain string `"accept"` / `"reject"` (see
//!     [`resolve_revision_core`]).
//!
//! The JSON DOM shape is defined by `lantern_docx::Document` (serde,
//! camelCase). See the engine crate for the authoritative schema.

use std::path::Path;

use base64::Engine;
use lantern_docx::author;
use lantern_docx::author::{Edit, EditResult};
use lantern_docx::{
    document_from_value, document_to_value, merge_into_template, open_docx_bytes, resolve_all,
    resolve_revision, serialize_docx_bytes, Document, OpenedDocument, ResolveAction,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// The document DOM as a JSON `Value` — the exact serde serialization of
/// `lantern_docx::Document` (camelCase, tag-discriminated). This is what the
/// `docx_*` commands hand to / take from the React editor; the engine crate
/// owns the authoritative schema.
pub type DocumentJson = Value;

/// BUG-049: cap how large a `.docx` we load fully into memory. Real Word
/// documents are KB to a few MB; this only catches a pathological or corrupt
/// file that would otherwise read + parse (JSZip-style, several× the file size)
/// into RAM and OOM the app — a real risk on a memory-tight machine. Generous so
/// no legitimate document is ever rejected.
const MAX_DOCX_BYTES: u64 = 100 * 1024 * 1024; // 100 MB

/// Read a `.docx` into memory with the size cap above. Returns a clear,
/// user-facing error if the file is implausibly large rather than risking OOM.
fn read_docx_capped(path: &Path) -> Result<Vec<u8>, String> {
    let len = std::fs::metadata(path)
        .map_err(|e| format!("read {}: {e}", path.display()))?
        .len();
    if len > MAX_DOCX_BYTES {
        return Err(format!(
            "I could not open this document: it is {} MB, larger than the {} MB Advisor Prep Hero can safely load.",
            len / (1024 * 1024),
            MAX_DOCX_BYTES / (1024 * 1024),
        ));
    }
    std::fs::read(path).map_err(|e| format!("read {}: {e}", path.display()))
}

// ---------------------------------------------------------------------------
// Pure, testable core (no Tauri, no #[command]) — the commands delegate here.
// ---------------------------------------------------------------------------

/// Read `.docx` bytes from `path` and return the JSON DOM.
///
/// Defense in depth: if `path` is relative, reject it immediately with a clear
/// error rather than attempting a CWD-relative read (which produces "os error 3"
/// on Windows when the process CWD is not the workspace root).  The TS layer
/// should always resolve paths to absolute before invoking this command, but this
/// guard catches any future caller that forgets.
pub fn open_to_json(path: &Path) -> Result<DocumentJson, String> {
    if path.is_relative() {
        return Err(format!(
            "I could not open this document: the app passed a relative path ({}) where an absolute path is required.",
            path.display()
        ));
    }
    let bytes = read_docx_capped(path)?; // BUG-049: cap in-memory read
    let opened = OpenedDocument::open_bytes(&bytes).map_err(|e| e.to_string())?;
    document_to_value(&opened.document).map_err(|e| e.to_string())
}

/// Serialize the JSON DOM to `.docx` bytes, preserving the unmodeled parts of
/// the file currently at `path` (if any). Returns the bytes to write.
///
/// Defense in depth: if `path` is relative, reject it immediately with a clear
/// error rather than writing into the process CWD (which would silently produce
/// a stray file in an unpredictable location). The TS layer should always
/// resolve paths to absolute before invoking this command, but this guard
/// catches any future caller that forgets.
///
/// Stateless preserve-by-default: the original package is recovered by reading
/// whatever is already at `path`. For an edit, that file is the source document
/// whose styles/theme/etc. must survive; for a brand-new document the path does
/// not exist and we synthesize minimal plumbing.
pub fn save_from_json(path: &Path, document_json: Value) -> Result<Vec<u8>, String> {
    if path.is_relative() {
        return Err(format!(
            "I could not save this document: the app passed a relative path ({}) where an absolute path is required.",
            path.display()
        ));
    }
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
// Batch AI redline (A4) — apply many edits drift-safely in one engine pass.
// ---------------------------------------------------------------------------

/// The wire shape of one AI-proposed edit, matching the structured-output schema
/// the model returns (see `src/modules/docx/redline.ts`). `op` is
/// `"insert"` | `"delete"` | `"replace"`. `anchorText` is the verbatim substring
/// to locate (required for delete/replace; optional for insert — when omitted the
/// insertion is appended at the paragraph end). `newText` carries the inserted /
/// replacement text (required for insert/replace). `reason` is carried for the
/// UI summary and ignored by the engine.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EditInput {
    pub op: String,
    pub paragraph_index: usize,
    #[serde(default)]
    pub anchor_text: Option<String>,
    #[serde(default)]
    pub new_text: Option<String>,
    #[serde(default)]
    pub reason: Option<String>,
}

/// The wire shape of one applied/skipped edit returned to the frontend, so the
/// results panel can show which edits anchored and surface a precise reason for
/// any that didn't.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EditOutcome {
    pub index: usize,
    pub applied: bool,
    pub revision_id: Option<String>,
    pub error: Option<String>,
}

impl From<EditResult> for EditOutcome {
    fn from(r: EditResult) -> Self {
        EditOutcome {
            index: r.index,
            applied: r.applied,
            revision_id: r.revision_id,
            error: r.error,
        }
    }
}

/// The full result of a batch redline: the updated DOM plus per-edit outcomes.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthorRevisionsResult {
    pub document: DocumentJson,
    pub results: Vec<EditOutcome>,
}

/// Translate one wire [`EditInput`] into the engine's typed [`Edit`], validating
/// required fields per op. Returns a user-facing error for a malformed edit.
fn edit_input_to_edit(e: EditInput) -> Result<Edit, String> {
    match e.op.as_str() {
        "insert" => Ok(Edit::Insert {
            paragraph_index: e.paragraph_index,
            anchor_text: e.anchor_text,
            new_text: e
                .new_text
                .ok_or("insert edit requires `newText`")?,
        }),
        "delete" => Ok(Edit::Delete {
            paragraph_index: e.paragraph_index,
            anchor_text: e
                .anchor_text
                .ok_or("delete edit requires `anchorText`")?,
        }),
        "replace" => Ok(Edit::Replace {
            paragraph_index: e.paragraph_index,
            anchor_text: e
                .anchor_text
                .ok_or("replace edit requires `anchorText`")?,
            new_text: e
                .new_text
                .ok_or("replace edit requires `newText`")?,
        }),
        other => Err(format!("unknown edit op {other:?} (expected insert/delete/replace)")),
    }
}

/// Apply a BATCH of AI-proposed edits to the DOM as tracked changes, drift-safe.
/// All paragraph indices and anchors resolve against the ORIGINAL document (see
/// [`author::apply_edits`]); edits are applied in one pass with fresh,
/// non-colliding revision ids. Returns the updated DOM + per-edit outcomes.
///
/// An edit whose anchor can't be found is SKIPPED (reported in `results`), not
/// fatal — partial success is the right behavior for an AI redline so a single
/// mis-quoted anchor doesn't discard the whole proposal. A structurally
/// malformed edit (bad op / missing required field) IS an error.
pub fn author_revisions_core(
    document_json: Value,
    edits_json: Value,
    author_name: &str,
    date: &str,
) -> Result<AuthorRevisionsResult, String> {
    let inputs: Vec<EditInput> =
        serde_json::from_value(edits_json).map_err(|e| format!("invalid edits payload: {e}"))?;
    let mut edits: Vec<Edit> = Vec::with_capacity(inputs.len());
    for input in inputs {
        edits.push(edit_input_to_edit(input)?);
    }

    let mut document: Document =
        document_from_value(document_json).map_err(|e| e.to_string())?;
    let results = author::apply_edits(&mut document, &edits, author_name, date);
    let document = document_to_value(&document).map_err(|e| e.to_string())?;
    Ok(AuthorRevisionsResult {
        document,
        results: results.into_iter().map(EditOutcome::from).collect(),
    })
}

/// Parse the loose `action` string the editor sends into a [`ResolveAction`],
/// or a user-facing error. Shared by the resolve-one and resolve-all cores so
/// both reject the same way.
fn parse_action(action: &str) -> Result<ResolveAction, String> {
    ResolveAction::from_str_action(action)
        .ok_or_else(|| format!("unknown resolve action {action:?} (expected \"accept\" or \"reject\")"))
}

/// Accept or reject a SINGLE tracked change (every inline whose revision id
/// matches `revision_id`) and return the updated DOM. `action` is `"accept"` or
/// `"reject"` (case-insensitive). Errors if the action is unknown or if no
/// revision with that id exists (so the editor can surface a precise message
/// rather than silently no-op'ing a stale button click).
pub fn resolve_revision_core(
    document_json: Value,
    revision_id: &str,
    action: &str,
) -> Result<DocumentJson, String> {
    let act = parse_action(action)?;
    let mut document: Document = document_from_value(document_json).map_err(|e| e.to_string())?;
    if !resolve_revision(&mut document, revision_id, act) {
        return Err(format!("no revision with id {revision_id:?} found"));
    }
    document_to_value(&document).map_err(|e| e.to_string())
}

/// Accept-all or reject-all: apply `action` to every tracked change in the
/// document and return the updated DOM. `action` is `"accept"` or `"reject"`.
/// Resolving a document with no tracked changes is a no-op (not an error) — the
/// review pane can call this unconditionally.
pub fn resolve_all_core(document_json: Value, action: &str) -> Result<DocumentJson, String> {
    let act = parse_action(action)?;
    let mut document: Document = document_from_value(document_json).map_err(|e| e.to_string())?;
    resolve_all(&mut document, act);
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
        // Data-loss fix (Codex audit #6): write the .docx ATOMICALLY (temp +
        // fsync + atomic rename) instead of a plain `std::fs::write`, which
        // truncates the existing file first — a crash mid-write would leave a
        // lawyer's Word file corrupt/empty. Reuses the vault crate's crash-safe,
        // Windows-safe atomic_write.
        lantern_vault::atomic::atomic_write(p, &bytes)
            .map_err(|e| format!("write {}: {e}", p.display()))
    })
    .await
    .map_err(|e| format!("task join error: {e}"))?
}

/// Author a new tracked change on the JSON DOM and return the updated DOM.
///
/// This is the helper task A4 (AI redlining) calls. Parameters:
///   * `kind` — `"insertion"` / `"deletion"` / `"insertParagraph"`.
///   * `author` — the author string stamped on the revision (defaults to
///     `"Advisor Prep Hero AI"` when empty).
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
            _ => lantern_docx::author::AI_AUTHOR.to_string(),
        };
        let date = match date {
            Some(d) if !d.trim().is_empty() => d,
            _ => lantern_docx::author::now_iso(),
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

/// Author a BATCH of AI-proposed tracked changes on the JSON DOM in one pass and
/// return the updated DOM plus per-edit outcomes. This is the engine entry point
/// for the A4 AI redliner: the React layer builds an edit list from the model's
/// structured output and applies it here, where all anchors/paragraph indices
/// resolve against the ORIGINAL document (drift-safe) and each edit gets a fresh
/// non-colliding revision id.
///
/// Parameters:
///   * `document` — the JSON DOM.
///   * `edits` — a JSON array of `{ op, paragraphIndex, anchorText?, newText?,
///     reason? }` (see [`EditInput`]).
///   * `author` — the author string stamped on every revision (defaults to
///     `"Advisor Prep Hero AI"` when empty).
///   * `date` — ISO-8601 timestamp; defaults to now (UTC) when empty.
///
/// Anchors that can't be found are skipped and reported (not fatal); a malformed
/// edit object is an error.
#[tauri::command]
pub async fn docx_author_revisions(
    document: Value,
    edits: Value,
    author: Option<String>,
    date: Option<String>,
) -> Result<AuthorRevisionsResult, String> {
    tokio::task::spawn_blocking(move || {
        let author_name = match author {
            Some(a) if !a.trim().is_empty() => a,
            _ => lantern_docx::author::AI_AUTHOR.to_string(),
        };
        let date = match date {
            Some(d) if !d.trim().is_empty() => d,
            _ => lantern_docx::author::now_iso(),
        };
        author_revisions_core(document, edits, &author_name, &date)
    })
    .await
    .map_err(|e| format!("task join error: {e}"))?
}

/// Accept or reject a single tracked change on the JSON DOM and return the
/// updated DOM. This is what the editor (A3) wires its per-revision
/// accept/reject buttons to.
///
/// Parameters:
///   * `document` — the JSON DOM.
///   * `revision_id` — the revision's `w:id` (groups all runs of one change).
///   * `action` — `"accept"` or `"reject"` (case-insensitive).
///
/// Word semantics: accept an insertion keeps its text (as normal runs) / reject
/// removes it; accept a deletion removes the text / reject restores it.
#[tauri::command]
pub async fn docx_resolve_revision(
    document: Value,
    revision_id: String,
    action: String,
) -> Result<DocumentJson, String> {
    tokio::task::spawn_blocking(move || resolve_revision_core(document, &revision_id, &action))
        .await
        .map_err(|e| format!("task join error: {e}"))?
}

/// Accept-all or reject-all every tracked change on the JSON DOM and return the
/// updated DOM. This is what the editor's review pane wires its bulk buttons to.
///
/// Parameters:
///   * `document` — the JSON DOM.
///   * `action` — `"accept"` or `"reject"` (case-insensitive).
///
/// A document with no tracked changes is returned unchanged (no error).
#[tauri::command]
pub async fn docx_resolve_all(document: Value, action: String) -> Result<DocumentJson, String> {
    tokio::task::spawn_blocking(move || resolve_all_core(document, &action))
        .await
        .map_err(|e| format!("task join error: {e}"))?
}

// ---------------------------------------------------------------------------
// Export (the discoverable Export control in the editor — A6).
//
// All three export paths operate on the on-disk `.docx` at `src_path` (which the
// editor keeps current via its debounced autosave), so the exported copy always
// reflects what the user sees:
//
//   * Word (.docx)   -> `docx_export_copy`        — a faithful copy that
//                       preserves every unmodeled part of the source package
//                       (styles, theme, numbering, media). This is NOT a
//                       lossy re-synthesis: we open the source and re-save it
//                       to `dest_path` through the same preserve-by-default path
//                       `docx_save` uses, so the chosen-location copy is
//                       byte-faithful for everything the engine doesn't model.
//   * Clean copy     -> `docx_export_clean_copy`  — same, but scrubs hidden
//                       identifying metadata (docProps/core.xml + app.xml) and,
//                       optionally, accepts all tracked changes + removes
//                       comments (privilege-safe export).
//   * PDF            -> handled by `commands::fs::convert_docx_to_pdf` (the
//                       editor saves first, then converts the saved source).
// ---------------------------------------------------------------------------

/// VG-4c — re-house a generated `.docx`'s content inside a letterhead template
/// package. `generated` is the workflow deliverable's bytes; `template` is the
/// firm letterhead `.docx` chosen in settings. The result carries the template's
/// header/footer/styles/sectPr with the generated document's content blocks (see
/// `lantern_docx::merge_into_template`). Pure bytes-in / bytes-out, no disk I/O.
pub fn apply_letterhead_bytes(generated: &[u8], template: &[u8]) -> Result<Vec<u8>, String> {
    // Open BOTH as full packages: the merge copies the generated content's own
    // hyperlink/image relationships and numbering definitions into the template
    // package, so it needs the generated package, not just its DOM.
    let generated_opened = open_docx_bytes(generated).map_err(|e| {
        format!("I could not read the generated document to apply the letterhead: {e}")
    })?;
    let template_opened = open_docx_bytes(template)
        .map_err(|e| format!("I could not read the letterhead template: {e}"))?;
    let merged = merge_into_template(&generated_opened, template_opened);
    merged
        .save_bytes()
        .map_err(|e| format!("I could not write the letterheaded document: {e}"))
}

/// Read the `.docx` at `src`, re-serialize it preserving every unmodeled part,
/// and return the bytes to write to a new location. This is the faithful "save a
/// copy as .docx" path — distinct from synthesizing a fresh package, which would
/// drop the source's styles/theme/numbering.
pub fn export_copy_bytes(src: &Path) -> Result<Vec<u8>, String> {
    if src.is_relative() {
        return Err(format!(
            "I could not export this document: the app passed a relative path ({}) where an absolute path is required.",
            src.display()
        ));
    }
    let bytes = read_docx_capped(src)?; // BUG-049: cap in-memory read
    let opened = OpenedDocument::open_bytes(&bytes).map_err(|e| e.to_string())?;
    opened.save_bytes().map_err(|e| e.to_string())
}

/// Read the `.docx` at `src` and return privilege-safe **clean copy** bytes:
/// hidden identifying metadata stripped, and (when `accept_all_changes`) all
/// tracked changes accepted + comments removed. Preserves every other unmodeled
/// part byte-for-byte.
pub fn export_clean_copy_bytes(src: &Path, accept_all_changes: bool) -> Result<Vec<u8>, String> {
    if src.is_relative() {
        return Err(format!(
            "I could not export a clean copy: the app passed a relative path ({}) where an absolute path is required.",
            src.display()
        ));
    }
    let bytes = read_docx_capped(src)?; // BUG-049: cap in-memory read
    let opened = OpenedDocument::open_bytes(&bytes).map_err(|e| e.to_string())?;
    let options = lantern_docx::ScrubOptions {
        strip_document_metadata: true,
        accept_all_changes,
    };
    opened
        .clean_copy_bytes(options)
        .map_err(|e| e.to_string())
}

/// Export a faithful Word (`.docx`) copy of the document at `src_path` to
/// `dest_path`, preserving every unmodeled part of the source package. Used by
/// the editor's Export → Word control to "save a copy as .docx" to a chosen
/// location.
#[tauri::command]
pub async fn docx_export_copy(src_path: String, dest_path: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        let bytes = export_copy_bytes(Path::new(&src_path))?;
        std::fs::write(&dest_path, bytes)
            .map_err(|e| format!("write {dest_path}: {e}"))
    })
    .await
    .map_err(|e| format!("task join error: {e}"))?
}

/// Export a privilege-safe **clean copy** of the document at `src_path` to
/// `dest_path`: strip hidden identifying metadata (`docProps/core.xml` +
/// `docProps/app.xml`) and, when `accept_all_changes` is true, also accept every
/// tracked change and remove all comments (a flat final document with no review
/// history). Preserves every other unmodeled part byte-for-byte.
#[tauri::command]
pub async fn docx_export_clean_copy(
    src_path: String,
    dest_path: String,
    accept_all_changes: bool,
) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        let bytes = export_clean_copy_bytes(Path::new(&src_path), accept_all_changes)?;
        std::fs::write(&dest_path, bytes)
            .map_err(|e| format!("write {dest_path}: {e}"))
    })
    .await
    .map_err(|e| format!("task join error: {e}"))?
}

/// VG-4c — apply a firm letterhead to in-memory `.docx` bytes. Both arguments
/// are base64-encoded `.docx` packages (the workflow engine has the generated
/// deliverable's bytes in memory, not on disk, when it post-processes a
/// deliverable); the return is the base64-encoded letterheaded document.
///
/// The TS choke point (`applyLetterheadIfConfigured` in `docx-io.ts`) only calls
/// this when a letterhead template is configured and reachable, and treats any
/// error as a pass-through (a deliverable must never fail because of the
/// letterhead). This command therefore just does the merge and reports a clear
/// error string; it does not itself decide policy.
#[tauri::command]
pub async fn docx_apply_letterhead(
    generated_b64: String,
    template_b64: String,
) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        let engine = base64::engine::general_purpose::STANDARD;
        let generated = engine
            .decode(generated_b64.as_bytes())
            .map_err(|e| format!("invalid generated-document base64: {e}"))?;
        let template = engine
            .decode(template_b64.as_bytes())
            .map_err(|e| format!("invalid letterhead-template base64: {e}"))?;
        let merged = apply_letterhead_bytes(&generated, &template)?;
        Ok::<String, String>(engine.encode(merged))
    })
    .await
    .map_err(|e| format!("task join error: {e}"))?
}

#[cfg(test)]
mod tests {
    use super::*;
    use lantern_docx::fixture::build_fixture_model;
    use lantern_docx::{document_to_value, parse_docx_bytes};

    /// Absolute path to a matter-corpus fixture. `CARGO_MANIFEST_DIR` is
    /// `src-tauri/`, so the corpus is at `tests/fixtures/matter-corpus/`.
    fn corpus_path(filename: &str) -> std::path::PathBuf {
        std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("tests")
            .join("fixtures")
            .join("matter-corpus")
            .join(filename)
    }

    /// VG-4c — the command-layer core merges generated bytes into the letterhead
    /// template package: the result re-opens cleanly, keeps the template's
    /// header/footer parts and a single body-level sectPr, and preserves the
    /// generated content. (Mirrors the crate's `merge_into_template` test at the
    /// host boundary so a future signature change here is caught.)
    #[test]
    fn apply_letterhead_bytes_rehouses_content_in_template_package() {
        let generated_path = corpus_path("contract-services-agreement.docx");
        let template_path = corpus_path("letterhead-template.docx");
        if !generated_path.exists() || !template_path.exists() {
            eprintln!("SKIP apply_letterhead_bytes: fixtures missing (run generate-fixtures.py)");
            return;
        }
        let generated = std::fs::read(&generated_path).unwrap();
        let template = std::fs::read(&template_path).unwrap();

        let merged = apply_letterhead_bytes(&generated, &template).expect("apply letterhead");

        // Re-opens cleanly through the full package path.
        let reopened = lantern_docx::open_docx_bytes(&merged).expect("merged re-opens cleanly");
        assert!(
            reopened.package.contains("word/header1.xml"),
            "merged package must keep the template header part"
        );
        // Exactly one body-level sectPr (the template's).
        let doc_xml = reopened
            .package
            .get_str("word/document.xml")
            .expect("document.xml");
        assert_eq!(
            doc_xml.matches("<w:sectPr").count(),
            1,
            "merged document must carry exactly one body-level sectPr (the template's)"
        );
        // Generated content present.
        let texts = lantern_docx::text::extract_paragraph_texts(&reopened.document);
        assert!(
            texts
                .join("\n\n")
                .contains("blended hourly rate of $375 per hour"),
            "generated body content must survive the letterhead merge"
        );
    }

    /// Garbage bytes produce a clear error, never a panic (the TS choke point
    /// turns this into a pass-through).
    #[test]
    fn apply_letterhead_bytes_errs_on_invalid_input() {
        let err = apply_letterhead_bytes(b"not a docx", b"also not a docx").unwrap_err();
        assert!(!err.is_empty(), "error string should be user-facing");
    }

    /// Smoke test of the command-layer core: open -> author -> save round-trips
    /// a real file on disk, preserving content and adding a revision. Exercises
    /// the exact code paths the Tauri commands call (minus the async/IPC shell).
    #[test]
    fn command_layer_open_author_save_roundtrip() {
        // Write a fixture .docx to a temp path.
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("matter.docx");
        let bytes = lantern_docx::serialize_docx_bytes(&build_fixture_model()).unwrap();
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
            "Advisor Prep Hero AI",
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
        // 2 originals (opposing counsel) + 1 new (Advisor Prep Hero AI) = 3.
        assert_eq!(revs.len(), 3, "expected originals + authored revision");
        assert!(revs.iter().any(|(m, _, _)| m.author == "Advisor Prep Hero AI"));
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
            "Advisor Prep Hero AI",
            0,
            None,
            Some("resolve all "),
            "2026-06-09T00:00:00Z",
        )
        .expect("author deletion");
        let doc = lantern_docx::document_from_value(out).unwrap();
        assert!(doc
            .revisions()
            .iter()
            .any(|(m, k, runs)| m.author == "Advisor Prep Hero AI"
                && *k == lantern_docx::RevisionKind::Deletion
                && runs.iter().any(|r| r.text.contains("resolve all"))));
    }

    #[test]
    fn author_revisions_batch_applies_replace_and_delete_drift_safe() {
        // Build a doc with one paragraph of plain text spanning two runs.
        let json = serde_json::json!({
            "formatVersion": 1,
            "body": [{
                "kind": "paragraph",
                "inlines": [
                    { "kind": "run", "text": "The Company shall " },
                    { "kind": "run", "text": "indemnify the Client for all losses." }
                ]
            }],
            "comments": {}
        });
        let edits = serde_json::json!([
            { "op": "replace", "paragraphIndex": 0, "anchorText": "Company", "newText": "Vendor", "reason": "naming" },
            { "op": "delete", "paragraphIndex": 0, "anchorText": "for all losses", "reason": "scope" }
        ]);
        let out = author_revisions_core(json, edits, "Advisor Prep Hero AI", "2026-06-09T00:00:00Z")
            .expect("batch author");
        // Both edits applied.
        assert_eq!(out.results.len(), 2);
        assert!(out.results.iter().all(|r| r.applied), "all edits should apply");
        // Distinct revision ids across the two edits.
        assert_ne!(out.results[0].revision_id, out.results[1].revision_id);
        // Reparse the DOM and confirm the tracked changes are present + attributed.
        let doc = lantern_docx::document_from_value(out.document).unwrap();
        let revs = doc.revisions();
        // replace = del+ins (2) + delete (1) = 3 revision elements.
        assert_eq!(revs.len(), 3);
        assert!(revs.iter().all(|(m, _, _)| m.author == "Advisor Prep Hero AI"));
        assert!(revs.iter().any(|(_, k, r)| *k == lantern_docx::RevisionKind::Insertion
            && r.iter().any(|x| x.text.contains("Vendor"))));
        assert!(revs.iter().any(|(_, k, r)| *k == lantern_docx::RevisionKind::Deletion
            && r.iter().any(|x| x.text == "Company")));
        assert!(revs.iter().any(|(_, k, r)| *k == lantern_docx::RevisionKind::Deletion
            && r.iter().any(|x| x.text == "for all losses")));
    }

    #[test]
    fn author_revisions_batch_skips_bad_anchor_but_keeps_others() {
        let json = document_to_value(&build_fixture_model()).unwrap();
        let edits = serde_json::json!([
            { "op": "delete", "paragraphIndex": 0, "anchorText": "NONEXISTENT PHRASE" },
            { "op": "insert", "paragraphIndex": 0, "newText": " Appended.", "reason": "add" }
        ]);
        let out = author_revisions_core(json, edits, "Advisor Prep Hero AI", "2026-06-09T00:00:00Z")
            .expect("batch author");
        assert!(!out.results[0].applied);
        assert!(out.results[0].error.as_deref().unwrap().contains("not found"));
        assert!(out.results[1].applied);
    }

    #[test]
    fn author_revisions_batch_rejects_malformed_edit() {
        let json = document_to_value(&build_fixture_model()).unwrap();
        let edits = serde_json::json!([
            { "op": "frobnicate", "paragraphIndex": 0 }
        ]);
        let err = author_revisions_core(json, edits, "X", "d").unwrap_err();
        assert!(err.contains("unknown edit op"), "got: {err}");
    }

    #[tokio::test]
    async fn async_command_author_revisions_smoke() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("matter.docx");
        let bytes = lantern_docx::serialize_docx_bytes(&build_fixture_model()).unwrap();
        std::fs::write(&path, &bytes).unwrap();
        let path_str = path.to_string_lossy().to_string();

        let json = super::docx_open(path_str.clone()).await.expect("open");
        let edits = serde_json::json!([
            { "op": "insert", "paragraphIndex": 0, "anchorText": "resolve all", "newText": " outstanding", "reason": "clarity" }
        ]);
        let result = super::docx_author_revisions(json, edits, Some("Advisor Prep Hero AI".into()), None)
            .await
            .expect("docx_author_revisions command");
        assert_eq!(result.results.len(), 1);
        assert!(result.results[0].applied);

        // Save + reopen: the AI revision survives alongside the 2 originals.
        super::docx_save(path_str.clone(), result.document)
            .await
            .expect("save");
        let reopened = super::docx_open(path_str).await.expect("reopen");
        let doc = lantern_docx::document_from_value(reopened).unwrap();
        assert_eq!(doc.revisions().len(), 3, "2 originals + 1 AI insertion");
        assert!(doc.revisions().iter().any(|(m, _, _)| m.author == "Advisor Prep Hero AI"));
        assert!(doc.comments.contains_key("1"), "comment preserved");
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
        let bytes = lantern_docx::serialize_docx_bytes(&build_fixture_model()).unwrap();
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
            Some("Advisor Prep Hero AI".to_string()),
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
        let doc = lantern_docx::document_from_value(reopened).unwrap();
        let revs = doc.revisions();
        assert_eq!(revs.len(), 3, "expected 2 originals + 1 authored");
        assert!(revs.iter().any(|(m, _, _)| m.author == "Advisor Prep Hero AI"));
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

    // -----------------------------------------------------------------------
    // resolve (accept/reject) command-layer coverage
    // -----------------------------------------------------------------------

    /// resolve_revision_core accepts an insertion (id 101) → its text stays as a
    /// normal run, the other revision (102) is untouched, comment preserved.
    #[test]
    fn resolve_revision_core_accept_insertion() {
        let json = document_to_value(&build_fixture_model()).unwrap();
        let out = resolve_revision_core(json, "101", "accept").expect("resolve");
        let doc = lantern_docx::document_from_value(out).unwrap();
        let revs = doc.revisions();
        assert_eq!(revs.len(), 1, "only the deletion remains");
        assert_eq!(revs[0].0.id, "102");
        assert!(doc.comments.contains_key("1"), "comment preserved");
    }

    /// resolve_revision_core errors (does not panic) on an unknown id and on a
    /// bad action string — the editor needs precise messages.
    #[test]
    fn resolve_revision_core_rejects_bad_input() {
        let json = document_to_value(&build_fixture_model()).unwrap();
        let err = resolve_revision_core(json.clone(), "9999", "accept").unwrap_err();
        assert!(err.contains("no revision with id"), "got: {err}");
        let err = resolve_revision_core(json, "101", "maybe").unwrap_err();
        assert!(err.contains("unknown resolve action"), "got: {err}");
    }

    /// resolve_all_core accept-all clears every revision; reject-all also clears
    /// them (restoring deleted text), and a clean document is a no-op (no error).
    #[test]
    fn resolve_all_core_accept_reject_and_noop() {
        let json = document_to_value(&build_fixture_model()).unwrap();
        let accepted = resolve_all_core(json.clone(), "accept").expect("accept all");
        let doc = lantern_docx::document_from_value(accepted.clone()).unwrap();
        assert!(doc.revisions().is_empty());

        let rejected = resolve_all_core(json, "reject").expect("reject all");
        assert!(lantern_docx::document_from_value(rejected)
            .unwrap()
            .revisions()
            .is_empty());

        // Resolving the already-clean doc is fine (review pane calls it freely).
        let again = resolve_all_core(accepted, "accept").expect("noop accept all");
        assert!(lantern_docx::document_from_value(again)
            .unwrap()
            .revisions()
            .is_empty());
    }

    /// Smoke the ACTUAL async `#[tauri::command]` resolve surface end to end:
    /// open a real file, accept one revision, accept-all the rest, save, reopen,
    /// and confirm the result is a clean, valid document with the comment intact.
    #[tokio::test]
    async fn async_command_surface_resolve_smoke() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("matter.docx");
        let bytes = lantern_docx::serialize_docx_bytes(&build_fixture_model()).unwrap();
        std::fs::write(&path, &bytes).unwrap();
        let path_str = path.to_string_lossy().to_string();

        let json = super::docx_open(path_str.clone()).await.expect("open");

        // Accept the insertion (id 101) via the async command.
        let after_one = super::docx_resolve_revision(json, "101".to_string(), "accept".to_string())
            .await
            .expect("docx_resolve_revision");
        let mid = lantern_docx::document_from_value(after_one.clone()).unwrap();
        assert_eq!(mid.revisions().len(), 1, "deletion still pending");

        // Accept everything else via the async bulk command.
        let after_all = super::docx_resolve_all(after_one, "accept".to_string())
            .await
            .expect("docx_resolve_all");

        // Save and reopen → clean, valid, comment preserved.
        super::docx_save(path_str.clone(), after_all)
            .await
            .expect("save");
        let reopened = super::docx_open(path_str).await.expect("reopen");
        let doc = lantern_docx::document_from_value(reopened).unwrap();
        assert!(doc.revisions().is_empty(), "all revisions resolved");
        assert!(doc.comments.contains_key("1"), "comment preserved");
    }

    /// The async resolve command surfaces errors (not panic) for a bad action.
    #[tokio::test]
    async fn async_command_resolve_rejects_bad_action() {
        let json = document_to_value(&build_fixture_model()).unwrap();
        let res = super::docx_resolve_all(json, "frobnicate".to_string()).await;
        assert!(res.is_err(), "bad action must error");
    }

    /// A6 export cores: a faithful Word copy preserves the document (revisions +
    /// comment survive), while the clean-copy-final core yields a flat document
    /// with no revisions or comments. Exercises the exact code the
    /// `docx_export_copy` / `docx_export_clean_copy` commands call.
    #[test]
    fn export_copy_and_clean_copy_cores() {
        use lantern_docx::parse_docx_bytes;

        let dir = tempfile::tempdir().unwrap();
        let src = dir.path().join("matter.docx");
        let bytes = lantern_docx::serialize_docx_bytes(&build_fixture_model()).unwrap();
        std::fs::write(&src, &bytes).unwrap();

        // Faithful Word copy: revisions + comment preserved.
        let copy = export_copy_bytes(&src).expect("export copy");
        let copy_doc = parse_docx_bytes(&copy).expect("parse copy");
        assert_eq!(copy_doc.revisions().len(), 2, "Word copy must keep tracked changes");
        assert!(copy_doc.comments.contains_key("1"), "Word copy dropped the comment");

        // Clean copy (metadata-only): still keeps revisions + comment.
        let clean = export_clean_copy_bytes(&src, false).expect("clean copy");
        let clean_doc = parse_docx_bytes(&clean).expect("parse clean");
        assert_eq!(clean_doc.revisions().len(), 2, "metadata-only clean copy must keep changes");
        assert!(clean_doc.comments.contains_key("1"));

        // Clean copy final (accept-all + strip comments): flat document.
        let final_clean = export_clean_copy_bytes(&src, true).expect("final clean copy");
        let final_doc = parse_docx_bytes(&final_clean).expect("parse final clean");
        assert!(final_doc.revisions().is_empty(), "final clean copy must accept all changes");
        assert!(final_doc.comments.is_empty(), "final clean copy must remove comments");
    }

    // -----------------------------------------------------------------------
    // Task 6: defense-in-depth — relative paths must be rejected at the native
    // layer with a clear error, not silently resolved against the process CWD.
    // -----------------------------------------------------------------------

    /// `open_to_json` must return an error (not attempt a CWD-relative read)
    /// when given a relative path.  This is the last-resort guard that catches
    /// any future TS caller that forgets to call `resolveWorkspacePath` first.
    #[test]
    fn open_to_json_rejects_relative_path() {
        let rel = std::path::Path::new("docs/The Supreme Court.docx");
        let result = open_to_json(rel);
        assert!(result.is_err(), "relative path must be rejected by open_to_json");
        let err = result.unwrap_err();
        assert!(
            err.contains("absolute path"),
            "error message must contain 'absolute path'; got: {err}"
        );
    }

    /// `open_to_json` must proceed past the relative-path guard for an absolute path
    /// (even if the file does not exist — the error changes to "read ... No such file").
    #[test]
    fn open_to_json_accepts_absolute_path() {
        // Use a path that is absolute but does not exist — we just want to confirm
        // the relative-path guard does NOT fire for an absolute path.
        // NOTE: "/nonexistent/..." is NOT absolute on Windows; use temp_dir() instead
        // so the path is platform-absolute on all OSes.
        let abs_buf = std::env::temp_dir().join("kp_nonexistent_dir").join("file.docx");
        let abs = abs_buf.as_path();
        let result = open_to_json(abs);
        // Must be Err (file doesn't exist) but NOT the "relative path" error.
        assert!(result.is_err(), "non-existent file must still error");
        let err = result.unwrap_err();
        assert!(
            !err.contains("relative path"),
            "an absolute path must NOT trigger the relative-path guard; got: {err}"
        );
    }

    // -----------------------------------------------------------------------
    // Item 5: defense-in-depth — relative paths must be rejected on the WRITE
    // side too (save_from_json, export_copy_bytes, export_clean_copy_bytes).
    // A relative path on the write path would silently create a stray file in
    // the process CWD rather than returning a clear error to the user.
    // -----------------------------------------------------------------------

    /// `save_from_json` rejects a relative path with a clear first-person error.
    #[test]
    fn save_from_json_rejects_relative_path() {
        let rel = std::path::Path::new("docs/matter.docx");
        let json = serde_json::json!({
            "formatVersion": 1,
            "body": [],
            "comments": {}
        });
        let result = save_from_json(rel, json);
        assert!(result.is_err(), "relative path must be rejected by save_from_json");
        let err = result.unwrap_err();
        assert!(
            err.contains("absolute path"),
            "error must mention 'absolute path'; got: {err}"
        );
    }

    /// `save_from_json` proceeds past the guard for an absolute path (the path
    /// may not exist — the error then changes to "parse" / "synthesize", not a
    /// relative-path error).
    #[test]
    fn save_from_json_accepts_absolute_path() {
        // NOTE: "/nonexistent/..." is NOT absolute on Windows; use temp_dir() instead
        // so the path is platform-absolute on all OSes.
        let abs_buf = std::env::temp_dir().join("kp_nonexistent_dir").join("matter.docx");
        let abs = abs_buf.as_path();
        // The body is valid JSON — only the path is tested here.
        let json = lantern_docx::document_to_value(&lantern_docx::fixture::build_fixture_model()).unwrap();
        let result = save_from_json(abs, json);
        // Must be Err (file doesn't exist → synthesize path, which may succeed
        // or error on write, but NOT on the relative-path guard).
        // We only assert that the relative-path guard did NOT fire.
        if let Err(ref err) = result {
            assert!(
                !err.contains("relative path"),
                "an absolute path must NOT trigger the relative-path guard; got: {err}"
            );
        }
        // (If it somehow succeeds by writing to a nonexistent path, that's fine too.)
    }

    /// `export_copy_bytes` rejects a relative path with a clear first-person error.
    #[test]
    fn export_copy_bytes_rejects_relative_path() {
        let rel = std::path::Path::new("docs/matter.docx");
        let result = export_copy_bytes(rel);
        assert!(result.is_err(), "relative path must be rejected by export_copy_bytes");
        let err = result.unwrap_err();
        assert!(
            err.contains("absolute path"),
            "error must mention 'absolute path'; got: {err}"
        );
    }

    /// `export_clean_copy_bytes` rejects a relative path with a clear first-person error.
    #[test]
    fn export_clean_copy_bytes_rejects_relative_path() {
        let rel = std::path::Path::new("docs/matter.docx");
        let result = export_clean_copy_bytes(rel, false);
        assert!(result.is_err(), "relative path must be rejected by export_clean_copy_bytes");
        let err = result.unwrap_err();
        assert!(
            err.contains("absolute path"),
            "error must mention 'absolute path'; got: {err}"
        );
    }
}
