//! Local redaction of meeting artifacts (Wave 4 Track D, Task 17b) — ⚠️ xhigh
//! review, data-loss-critical.
//!
//! > 2026-07-02 Jameson: local-first honesty rule. Redaction is DELETION of a
//! > span, not hiding. The redacted text must not survive anywhere —
//! > transcript.json, notes.docx (including tracked-change revision nodes),
//! > the RAG index, or caches.
//!
//! v1 redacts WHOLE transcript segments (turns). For each chosen segment:
//! capture its exact text as the needle, replace it with a marker in
//! transcript.json, then replace it in notes.docx across every reachable
//! text run — then serialize and BYTE-SCAN for the needle. If it survives
//! (a `w:del`/`w:ins` revision node, or any other structure an ordinary DOM
//! replace can't reach), flatten tracked changes (accept all, drop
//! comments) on the ORIGINAL document, re-apply the replacement, and
//! re-scan. HARD-FAILS — nothing on disk changes — if the needle still
//! survives after that; a partial redaction is never reported as success.

use std::path::{Path, PathBuf};

use super::new_audit_id;
use super::sweep::{canonicalize_workspace_relative, contained, transcript_rag_source_ids};
// stage_atomically/commit_atomically live in mod.rs (shared with
// append_pending_rag_cleanup, which had the exact same truncate-in-place
// and temp-path-symlink risks). The two-phase split lets redact.rs stage
// BOTH transcript.json and notes.docx before committing either.
use super::{commit_atomically, stage_atomically};

fn redaction_marker(now_ms: u64) -> String {
    let date = chrono::DateTime::from_timestamp_millis(now_ms as i64)
        .map(|d| d.format("%Y-%m-%d").to_string())
        .unwrap_or_else(|| chrono::Utc::now().format("%Y-%m-%d").to_string());
    format!("[redacted {date} by the advisor]")
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RedactionReceipt {
    pub redacted_count: usize,
    pub marker: String,
    pub docx_flattened: bool,
    /// Deliberate addition beyond the plan's literal struct: Wave 3's
    /// meeting re-index command isn't merged into this worktree yet
    /// (DEPENDS-WAVE-3, same situation as Task 17d's UI mounts — see
    /// docs/plans/lantern-plus/2026-07-02-wave-4-depth.md Task 18 Step 2b).
    /// The caller uses these ids to flush the now-stale RAG rows via the
    /// existing generic `rag_delete_path` command; re-indexing FRESH rows
    /// for the marker text is deferred to Task 18's cross-wave gate.
    pub rag_cleanup_source_ids: Vec<String>,
    /// Set when the redaction itself succeeded on disk but the hash-chained
    /// audit entry failed to write (e.g. a corrupted chain head). Mirrors
    /// the sweep's "never let an audit-store hiccup erase what the caller
    /// needs to know" rule (retention/mod.rs) — the caller still gets
    /// `rag_cleanup_source_ids` to flush even if the audit trail for this
    /// one redaction is incomplete.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub audit_error: Option<String>,
}

/// `fs::write` FOLLOWS a symlink to its target — unlike sweep.rs's unlink
/// helpers (which only ever remove the link itself, never the target),
/// writing through a symlinked transcript.json/notes.docx could smuggle a
/// write to an arbitrary file outside the workspace. Refuse outright rather
/// than silently writing through it.
fn refuse_symlink(path: &Path) -> Result<(), String> {
    match path.symlink_metadata() {
        Ok(m) if m.file_type().is_symlink() => Err(format!("refused (symlink): {}", path.display())),
        _ => Ok(()),
    }
}

/// Resolve + guard `matter_folder`/`meeting_dir` inside the workspace.
/// Unlike the sweep's best-effort "vanished -> skip" (`retention_sweep`
/// enumerates many folders speculatively), a caller targeting ONE specific
/// meeting with a bad path is a caller bug, not benign — treat a missing
/// path as a hard error instead of silently doing nothing.
fn resolve_meeting_dir(canon_ws: &Path, matter_folder: &str, meeting_dir: &str) -> Result<PathBuf, String> {
    let matter_abs = canonicalize_workspace_relative(canon_ws, matter_folder)?
        .ok_or_else(|| format!("matter folder does not exist: {matter_folder}"))?;
    let rel_meeting = Path::new(meeting_dir);
    if rel_meeting.is_absolute() {
        return Err(format!("meeting dir must be relative to the matter folder: {meeting_dir}"));
    }
    let meeting_abs = matter_abs
        .join(rel_meeting)
        .canonicalize()
        .map_err(|e| format!("meeting dir does not exist: {meeting_dir}: {e}"))?;
    // Scoped to the SELECTED matter folder, not just "somewhere in the
    // workspace": meeting_dir is documented as relative to matter_folder, so
    // a `../OtherClient/...` escape must be refused here — otherwise a
    // caller could redact a DIFFERENT client's meeting while the audit entry
    // (which records matter_folder verbatim) claims it was this one.
    if !meeting_abs.starts_with(&matter_abs) {
        return Err(format!("meeting dir escapes its matter folder: {meeting_dir}"));
    }
    if !meeting_abs.starts_with(canon_ws) {
        return Err(format!("meeting dir escapes workspace: {meeting_dir}"));
    }
    Ok(meeting_abs)
}

/// Replace `needle` with `marker` in every Run reachable in the DOM — plain
/// runs AND the runs inside tracked insertions/deletions — across the whole
/// document body. An `Inline::Raw`/`BlockContent::Raw` element (anything the
/// engine doesn't model — tables, unmodeled revision shapes, etc.) is opaque
/// to this pass by design; that's exactly why the byte-scan + flatten
/// fallback exists.
fn replace_in_document(doc: &mut lantern_docx::Document, needle: &str, marker: &str) {
    for block in &mut doc.body {
        if let lantern_docx::BlockContent::Paragraph(p) = block {
            for inline in &mut p.inlines {
                let runs: &mut [lantern_docx::Run] = match inline {
                    lantern_docx::Inline::Run(r) => std::slice::from_mut(r),
                    lantern_docx::Inline::Insertion { runs, .. } => runs.as_mut_slice(),
                    lantern_docx::Inline::Deletion { runs, .. } => runs.as_mut_slice(),
                    _ => &mut [],
                };
                for run in runs {
                    if run.text.contains(needle) {
                        run.text = run.text.replace(needle, marker);
                    }
                }
            }
        }
    }
}

fn contains_bytes(haystack: &[u8], needle: &[u8]) -> bool {
    !needle.is_empty() && haystack.windows(needle.len()).any(|w| w == needle)
}


/// `.docx` is a ZIP archive — its parts are DEFLATE-compressed, so scanning
/// the raw serialized `.docx` bytes for a plain-text needle is close to
/// meaningless (compression scrambles byte patterns; a hit-or-miss match
/// proves nothing either way). The real safety check has to look at every
/// PART's decompressed content — `word/document.xml`, but also
/// `word/comments.xml`, `customXml/**`, footnotes/headers/footers, and
/// anything else the package carries — not just the outer archive bytes or
/// only the modeled paragraph text. If the bytes don't even parse as a
/// package, fail closed (treat as "still present") rather than silently
/// reporting success on something we can no longer verify.
/// Reverse the handful of XML entity escapes that can appear inside `<w:t>`
/// text content (`&`, `<`, `>` — quotes aren't escaped in element text, only
/// in attributes) so a literal needle comparison doesn't miss an occurrence
/// just because it contains one of those characters.
fn xml_unescape(s: &str) -> String {
    s.replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">")
}

/// Two independent checks, because they catch different survival modes:
///
///  1. PACKAGE scan — decompresses every part (document.xml, comments.xml,
///     customXml, footnotes/headers/footers, anything else the package
///     carries) and checks its raw text, XML-entity-unescaped, for the
///     needle. Catches content `replace_in_document` never reaches at all
///     (unmodeled parts, comments) and needles that survive with an escaped
///     character (`R&amp;D`).
///  2. MODELED PARAGRAPH TEXT scan — re-parses the DOM and joins each
///     paragraph's full text via `extract_paragraph_texts`, which
///     concatenates ACROSS run boundaries. Word can and does split what
///     looks like one phrase across adjacent `<w:r>` elements (spell-check
///     boundaries, formatting changes, revision splits); a needle split that
///     way is invisible to a scan of any SINGLE run's text (which is all
///     `replace_in_document` and a naive byte-scan can see) but shows up
///     once the paragraph's text is joined.
///
/// Fails closed (treats as "still present") if the bytes don't even parse.
fn needle_survives_in_docx_package(docx_bytes: &[u8], needle: &str) -> bool {
    let Ok(pkg) = lantern_docx::Package::read_from_bytes(docx_bytes) else {
        return true;
    };
    let needle_bytes = needle.as_bytes();
    let part_names: Vec<&String> = pkg.part_names().collect();
    let package_hit = part_names.into_iter().any(|name| {
        pkg.get(name).is_some_and(|raw| {
            if contains_bytes(raw, needle_bytes) {
                return true;
            }
            match std::str::from_utf8(raw) {
                Ok(text) => xml_unescape(text).contains(needle),
                Err(_) => false, // a binary part (media, etc.) — nothing to redact there
            }
        })
    });
    if package_hit {
        return true;
    }
    match lantern_docx::parse_docx_bytes(docx_bytes) {
        Ok(doc) => lantern_docx::extract_paragraph_texts(&doc).iter().any(|t| t.contains(needle)),
        Err(_) => true,
    }
}

/// Pure(ish) core: redact `segment_indices` from `meeting_dir`'s
/// transcript.json + notes.docx. All indices are validated BEFORE anything
/// is mutated. Does not touch the audit store (the Tauri command wrapper
/// does that) or the RAG index (the caller flushes `rag_cleanup_source_ids`
/// via the existing generic command).
pub(crate) fn redact_segments_inner(
    canon_ws: &Path,
    meeting_dir: &Path,
    segment_indices: &[usize],
    now_ms: u64,
) -> Result<RedactionReceipt, String> {
    if segment_indices.is_empty() {
        return Err("no segment indices given".to_string());
    }

    let transcript_path = meeting_dir.join("transcript.json");
    refuse_symlink(&transcript_path)?;
    if !contained(&transcript_path, canon_ws) {
        return Err(format!("refused (outside workspace): {}", transcript_path.display()));
    }
    let raw = std::fs::read(&transcript_path).map_err(|e| format!("read transcript.json: {e}"))?;
    let mut v: serde_json::Value =
        serde_json::from_slice(&raw).map_err(|e| format!("parse transcript.json: {e}"))?;
    let segments = v
        .get_mut("segments")
        .and_then(|s| s.as_array_mut())
        .ok_or_else(|| "transcript.json has no segments array".to_string())?;

    // Validate ALL indices before mutating anything — an out-of-range index
    // must touch nothing, not partially redact.
    for &i in segment_indices {
        if i >= segments.len() {
            return Err(format!(
                "segment index out of range: {i} (transcript has {} segments)",
                segments.len()
            ));
        }
    }

    // RAG ids for this transcript's chunks, computed from the PRE-redaction
    // bytes — same contract as Task 14's transcript_rag_source_ids ("must
    // run BEFORE transcript.json is removed"): here it's rewritten rather
    // than removed, but the chunks it identifies just went stale either way.
    let rag_cleanup_source_ids = transcript_rag_source_ids(meeting_dir);

    let marker = redaction_marker(now_ms);
    let mut needles: Vec<String> = Vec::with_capacity(segment_indices.len());
    for &i in segment_indices {
        let seg = &mut segments[i];
        let text = seg.get("text").and_then(|t| t.as_str()).unwrap_or("").to_string();
        if text.is_empty() || text == marker {
            continue; // already redacted (or empty) — idempotent no-op, not an error
        }
        needles.push(text);
        seg["text"] = serde_json::Value::String(marker.clone());
        seg["redacted"] = serde_json::Value::Bool(true);
    }

    let notes_path = meeting_dir.join("notes.docx");
    refuse_symlink(&notes_path)?;
    if !contained(&notes_path, canon_ws) {
        return Err(format!("refused (outside workspace): {}", notes_path.display()));
    }
    let mut docx_flattened = false;
    // Two-phase commit across BOTH artifacts: stage everything to temp files
    // first (this is where a failure — disk full, an interrupted write —
    // can happen, and it leaves NEITHER real file touched), and only once
    // every stage succeeds does either commit (rename) run. A rename is a
    // single filesystem metadata operation, not a data copy, so the window
    // where a commit failure could leave the two artifacts inconsistent
    // shrinks from "however long a whole docx/JSON write takes" down to
    // "however long two rename syscalls take" — the closest this engine
    // gets to real cross-file atomicity without a write-ahead log.
    let mut notes_tmp: Option<PathBuf> = None;
    if notes_path.exists() && !needles.is_empty() {
        let original_bytes = std::fs::read(&notes_path).map_err(|e| format!("read notes.docx: {e}"))?;

        let opened = lantern_docx::open_docx_bytes(&original_bytes).map_err(|e| format!("parse notes.docx: {e}"))?;
        let mut doc = opened.document.clone();
        for needle in &needles {
            replace_in_document(&mut doc, needle, &marker);
        }
        let mut new_bytes = opened
            .with_document(doc)
            .save_bytes()
            .map_err(|e| format!("serialize notes.docx: {e}"))?;

        if needles.iter().any(|n| needle_survives_in_docx_package(&new_bytes, n)) {
            // Fallback: re-open the ORIGINAL bytes fresh, flatten tracked
            // changes (accept all, drop comments), re-apply the same
            // replacement, re-scan.
            let reopened =
                lantern_docx::open_docx_bytes(&original_bytes).map_err(|e| format!("reparse notes.docx: {e}"))?;
            let flattened_bytes = reopened
                .clean_copy_bytes(lantern_docx::ScrubOptions {
                    strip_document_metadata: false,
                    accept_all_changes: true,
                })
                .map_err(|e| format!("flatten notes.docx: {e}"))?;
            let flat_opened = lantern_docx::open_docx_bytes(&flattened_bytes)
                .map_err(|e| format!("reparse flattened notes.docx: {e}"))?;
            let mut flat_doc = flat_opened.document.clone();
            for needle in &needles {
                replace_in_document(&mut flat_doc, needle, &marker);
            }
            let final_bytes = flat_opened
                .with_document(flat_doc)
                .save_bytes()
                .map_err(|e| format!("serialize flattened notes.docx: {e}"))?;

            if needles.iter().any(|n| needle_survives_in_docx_package(&final_bytes, n)) {
                // HARD FAIL: never report success on a partial redaction —
                // and nothing on disk has been written yet, so a failure
                // here leaves both transcript.json and notes.docx untouched.
                return Err(
                    "redaction failed: text survives in notes.docx even after flattening tracked changes"
                        .to_string(),
                );
            }
            new_bytes = final_bytes;
            docx_flattened = true;
        }
        notes_tmp = Some(stage_atomically(&notes_path, &new_bytes)?);
    }

    let transcript_bytes =
        serde_json::to_vec_pretty(&v).map_err(|e| format!("serialize transcript.json: {e}"))?;
    let transcript_tmp = stage_atomically(&transcript_path, &transcript_bytes)?;

    // Both artifacts are now fully written to temp files and verified safe
    // (the docx path already hard-failed above if the needle survived) —
    // commit both. If notes.docx has nothing staged (no needle in it), only
    // transcript.json commits.
    if let Some(tmp) = &notes_tmp {
        commit_atomically(tmp, &notes_path)?;
    }
    commit_atomically(&transcript_tmp, &transcript_path)?;

    Ok(RedactionReceipt {
        redacted_count: needles.len(),
        marker,
        docx_flattened,
        rag_cleanup_source_ids,
        audit_error: None,
    })
}

/// Redact whole transcript segments from one meeting: rewrite
/// transcript.json + notes.docx (revision-safe), and write one hash-chained
/// audit entry. NEVER includes the redacted text itself in the audit
/// payload — only counts/ids/booleans — since the whole point of redaction
/// is that the text must not survive anywhere, including the audit log.
#[tauri::command]
pub async fn redact_meeting_segments(
    workspace: String,
    matter_folder: String,
    meeting_dir: String,
    segment_indices: Vec<usize>,
) -> Result<RedactionReceipt, String> {
    tokio::task::spawn_blocking(move || {
        let ws = Path::new(&workspace);
        let canon_ws = ws
            .canonicalize()
            .map_err(|e| format!("cannot canonicalize workspace: {e}"))?;
        let meeting_abs = resolve_meeting_dir(&canon_ws, &matter_folder, &meeting_dir)?;
        let now_ms = chrono::Utc::now().timestamp_millis() as u64;

        // Preflight the audit store BEFORE any mutation — same rule as
        // retention_sweep in mod.rs: a redaction that cannot be durably
        // recorded must never happen. Opening is cheap (no writes yet); a
        // bad key/corrupt store fails HERE, before transcript.json or
        // notes.docx is touched, instead of after a real redaction already
        // happened with no way to record it.
        let store = crate::commands::audit::store::EncryptedAuditStore::open(ws)
            .map_err(|e| format!("open audit store: {e}"))?;

        let mut receipt = redact_segments_inner(&canon_ws, &meeting_abs, &segment_indices, now_ms)?;

        // Durable side-file, same file + same reasoning as the sweep's
        // PENDING_RAG_CLEANUP_FILE (retention/mod.rs): if the app crashes
        // after the writes above land but before the renderer ever receives
        // this receipt, these RAG rows would otherwise stay searchable
        // forever with the redacted text still in them. Written durably
        // INSIDE this blocking call, before the command even returns.
        if let Err(e) = super::append_pending_rag_cleanup(&canon_ws, &receipt.rag_cleanup_source_ids) {
            receipt.audit_error = Some(match &receipt.audit_error {
                Some(existing) => format!("{existing}; {e}"),
                None => e,
            });
        }

        // Append the audit entry using the store opened above. The mutation
        // has already happened by this point (this is a single atomic
        // operation, not a batch like the sweep, so there's no "later work"
        // whose visibility an append failure could hide) — but a failed
        // APPEND (as opposed to a failed OPEN, already handled above) must
        // still never erase the receipt the caller needs to flush RAG
        // cleanup, so it's recorded on the receipt instead of propagated as
        // this command's Err.
        let entry_id = new_audit_id();
        let entry_ts = chrono::Utc::now().to_rfc3339();
        let description = format!("Redacted {} segment(s) in {meeting_dir}", receipt.redacted_count);
        let entry = crate::commands::audit::store::AuditEntryRecord {
            id: entry_id.clone(),
            timestamp: entry_ts.clone(),
            action: "meeting_redaction".to_string(),
            description: description.clone(),
            payload_json: serde_json::json!({
                "id": entry_id,
                "timestamp": entry_ts,
                "action": "meeting_redaction",
                "description": description,
                "model": serde_json::Value::Null,
                "inputs": {
                    "matterFolder": matter_folder,
                    "meetingDir": meeting_dir,
                    "segmentIndices": segment_indices,
                },
                "outputs": {
                    "redactedCount": receipt.redacted_count,
                    "docxFlattened": receipt.docx_flattened,
                    "ragCleanupSourceIds": receipt.rag_cleanup_source_ids,
                },
                "userDecision": serde_json::Value::Null,
                "metadata": {
                    "auditEventType": "meeting_redaction",
                    "source": "retention-backend",
                    "scope": { "kind": "allMatters" },
                },
            })
            .to_string(),
        };
        if let Err(e) = store.append(&entry) {
            receipt.audit_error = Some(match &receipt.audit_error {
                Some(existing) => format!("{existing}; audit append: {e}"),
                None => format!("audit append: {e}"),
            });
        }
        Ok(receipt)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use lantern_docx::{BlockContent, Document, Inline, Paragraph, RevisionMeta, Run};
    use tempfile::tempdir;

    struct MeetingPaths {
        dir: PathBuf,
    }

    /// Mirrors sweep.rs's `make_meeting`: a finalized meeting (transcript.json
    /// + notes.docx present) whose transcript has one segment containing
    /// `needle`, and whose notes.docx contains `needle` BOTH as a plain run
    /// AND inside a tracked-change deletion (`w:del`) — the case the plan
    /// calls out as needing the byte-scan + flatten fallback, since a
    /// revision node can retain "deleted" text.
    fn make_meeting_with_tracked_change(ws: &Path, needle: &str) -> MeetingPaths {
        let dir = ws.join("Clients/H/Meetings/2026-05-01-review");
        std::fs::create_dir_all(&dir).unwrap();

        let transcript = serde_json::json!({
            "segments": [
                { "startMs": 0, "endMs": 4000, "channel": "sys", "speaker": "Them", "text": "Let's get started." },
                { "startMs": 4000, "endMs": 9000, "channel": "sys", "speaker": "Them", "text": needle },
                { "startMs": 9000, "endMs": 12000, "channel": "mic", "speaker": "You", "text": "Understood." },
            ],
            "meta": { "startedAt": "2026-05-01T10:00:00Z", "durationMs": 12000, "matterId": "m-1" },
        });
        std::fs::write(dir.join("transcript.json"), serde_json::to_vec(&transcript).unwrap()).unwrap();

        let doc = Document {
            format_version: lantern_docx::DOM_FORMAT_VERSION,
            body: vec![
                BlockContent::Paragraph(Paragraph::from_inlines(vec![Inline::Run(Run::new(format!(
                    "Notes: {needle}"
                )))])),
                BlockContent::Paragraph(Paragraph::from_inlines(vec![
                    Inline::Run(Run::new("An earlier draft said ")),
                    Inline::Deletion {
                        meta: RevisionMeta {
                            id: "1".into(),
                            author: "Advisor".into(),
                            date: "2026-05-01T10:05:00Z".into(),
                        },
                        runs: vec![Run::new(needle)],
                    },
                    Inline::Run(Run::new(" but that line was cut.")),
                ])),
            ],
            comments: Default::default(),
        };
        let docx_bytes = lantern_docx::serialize_docx_bytes(&doc).unwrap();
        std::fs::write(dir.join("notes.docx"), docx_bytes).unwrap();

        MeetingPaths { dir }
    }

    fn contains_bytes_test_helper(haystack: &[u8], needle: &[u8]) -> bool {
        contains_bytes(haystack, needle)
    }

    #[test]
    fn redacts_segment_from_transcript_and_docx_including_revision_nodes() {
        let needle = "client admitted undisclosed offshore account";
        let ws = tempdir().unwrap();
        let paths = make_meeting_with_tracked_change(ws.path(), needle);
        let canon_ws = ws.path().canonicalize().unwrap();

        let receipt = redact_segments_inner(&canon_ws, &paths.dir, &[1], 1_777_000_000_000).unwrap();
        assert_eq!(receipt.redacted_count, 1);
        assert!(receipt.marker.starts_with("[redacted"));
        assert!(receipt.audit_error.is_none());

        let tj_raw = std::fs::read(paths.dir.join("transcript.json")).unwrap();
        let tj_str = String::from_utf8(tj_raw.clone()).unwrap();
        assert!(!tj_str.contains(needle), "needle must not survive in transcript.json");
        assert!(tj_str.contains("[redacted"));
        let tj: serde_json::Value = serde_json::from_slice(&tj_raw).unwrap();
        assert_eq!(tj["segments"][1]["redacted"], serde_json::json!(true));
        // The other two segments are untouched.
        assert!(tj_str.contains("Let's get started."));
        assert!(tj_str.contains("Understood."));

        let docx_bytes = std::fs::read(paths.dir.join("notes.docx")).unwrap();
        // The byte-scan is the point: revision nodes must not retain the text.
        // replace_in_document already walks Insertion/Deletion runs (not just
        // plain Run), so the first pass alone catches this case — the flatten
        // fallback exists for text a DOM replace genuinely can't reach (see
        // not every tracked-change shape.
        assert!(!contains_bytes_test_helper(&docx_bytes, needle.as_bytes()));
        assert!(!receipt.docx_flattened, "the comprehensive first-pass replace should have been enough here");
    }

    #[test]
    fn out_of_range_index_touches_nothing() {
        let ws = tempdir().unwrap();
        let paths = make_meeting_with_tracked_change(ws.path(), "x");
        let canon_ws = ws.path().canonicalize().unwrap();
        let before_t = std::fs::read(paths.dir.join("transcript.json")).unwrap();
        let before_d = std::fs::read(paths.dir.join("notes.docx")).unwrap();

        let err = redact_segments_inner(&canon_ws, &paths.dir, &[99], 1_777_000_000_000).unwrap_err();
        assert!(err.contains("out of range"), "got: {err}");

        assert_eq!(before_t, std::fs::read(paths.dir.join("transcript.json")).unwrap());
        assert_eq!(before_d, std::fs::read(paths.dir.join("notes.docx")).unwrap());
    }

    #[test]
    fn empty_segment_indices_is_rejected() {
        let ws = tempdir().unwrap();
        let paths = make_meeting_with_tracked_change(ws.path(), "x");
        let canon_ws = ws.path().canonicalize().unwrap();
        let err = redact_segments_inner(&canon_ws, &paths.dir, &[], 1_777_000_000_000).unwrap_err();
        assert!(err.contains("no segment indices"), "got: {err}");
    }

    #[test]
    fn rejects_absolute_matter_folder() {
        let ws = tempdir().unwrap();
        make_meeting_with_tracked_change(ws.path(), "x");
        let canon_ws = ws.path().canonicalize().unwrap();
        let err = resolve_meeting_dir(&canon_ws, "/etc", "Meetings/2026-05-01-review").unwrap_err();
        assert!(err.contains("does not exist") || err.contains("workspace-relative"), "got: {err}");
    }

    #[test]
    fn rejects_matter_folder_escaping_workspace() {
        let ws = tempdir().unwrap();
        make_meeting_with_tracked_change(ws.path(), "x");
        let canon_ws = ws.path().canonicalize().unwrap();
        let err = resolve_meeting_dir(&canon_ws, "../../etc", "passwd").unwrap_err();
        assert!(!err.is_empty());
    }

    /// `meeting_dir` is documented as relative to `matter_folder` — a caller
    /// must not be able to climb OUT of the selected matter folder into a
    /// DIFFERENT (but still in-workspace) client's folder via `../`. Without
    /// this check the redaction would touch the wrong client's meeting while
    /// the audit entry (which records matter_folder verbatim) claims it
    /// touched the original one.
    #[test]
    fn rejects_meeting_dir_escaping_its_own_matter_folder_into_a_sibling_client() {
        let ws = tempdir().unwrap();
        make_meeting_with_tracked_change(ws.path(), "x"); // Clients/H/Meetings/2026-05-01-review
        std::fs::create_dir_all(ws.path().join("Clients/Acme")).unwrap();
        let canon_ws = ws.path().canonicalize().unwrap();

        let err = resolve_meeting_dir(&canon_ws, "Clients/Acme", "../H/Meetings/2026-05-01-review").unwrap_err();
        assert!(err.contains("matter folder"), "got: {err}");
    }

    /// The whole point of `needle_survives_in_docx_package`: a `.docx` is a
    /// ZIP archive with DEFLATE-compressed parts, so a raw byte-scan over the
    /// serialized file can miss text that's genuinely still present. This
    /// confirms the package-aware check actually finds it by decompressing.
    #[test]
    fn needle_survives_check_finds_text_inside_the_compressed_package() {
        let needle = "a fairly distinctive phrase repeated enough to compress predictably";
        let doc = Document {
            format_version: lantern_docx::DOM_FORMAT_VERSION,
            body: vec![BlockContent::Paragraph(Paragraph::from_inlines(vec![Inline::Run(Run::new(
                needle.repeat(20),
            ))]))],
            comments: Default::default(),
        };
        let bytes = lantern_docx::serialize_docx_bytes(&doc).unwrap();
        assert!(
            needle_survives_in_docx_package(&bytes, needle),
            "the needle really is in this document — the package-aware check must find it"
        );
        // A document that never had the needle at all must NOT false-positive.
        let clean = Document {
            format_version: lantern_docx::DOM_FORMAT_VERSION,
            body: vec![BlockContent::Paragraph(Paragraph::from_inlines(vec![Inline::Run(Run::new("unrelated text"))]))],
            comments: Default::default(),
        };
        let clean_bytes = lantern_docx::serialize_docx_bytes(&clean).unwrap();
        assert!(!needle_survives_in_docx_package(&clean_bytes, needle));
    }

    /// Word can split what reads as one phrase across adjacent runs (spell
    /// check boundaries, formatting changes) — no single run's text contains
    /// the whole needle, so `replace_in_document` can't touch it and a
    /// per-part byte-scan wouldn't find it as a contiguous substring either.
    /// The survival check must still catch it via the paragraph's JOINED
    /// text (extract_paragraph_texts concatenates across runs).
    #[test]
    fn needle_survives_check_catches_a_needle_split_across_adjacent_runs() {
        let needle = "client admitted wrongdoing";
        let doc = Document {
            format_version: lantern_docx::DOM_FORMAT_VERSION,
            body: vec![BlockContent::Paragraph(Paragraph::from_inlines(vec![
                Inline::Run(Run::new("client ad")),
                Inline::Run(Run::new("mitted wrong")),
                Inline::Run(Run::new("doing")),
            ]))],
            comments: Default::default(),
        };
        let bytes = lantern_docx::serialize_docx_bytes(&doc).unwrap();
        assert!(
            needle_survives_in_docx_package(&bytes, needle),
            "a needle split across run boundaries must still be detected via joined paragraph text"
        );
    }

    /// A needle containing a character XML escapes in text content (`&`)
    /// must still be found even though the raw `<w:t>` bytes spell it
    /// `&amp;` rather than `&`.
    #[test]
    fn needle_survives_check_catches_an_xml_escaped_needle() {
        let needle = "Smith & Associates";
        let doc = Document {
            format_version: lantern_docx::DOM_FORMAT_VERSION,
            body: vec![BlockContent::Paragraph(Paragraph::from_inlines(vec![Inline::Run(Run::new(needle))]))],
            comments: Default::default(),
        };
        let bytes = lantern_docx::serialize_docx_bytes(&doc).unwrap();
        assert!(needle_survives_in_docx_package(&bytes, needle));
    }

    /// Redacting an already-redacted segment (or the same call twice) is a
    /// safe no-op, not an error — the marker text itself never becomes a new
    /// needle to chase.
    #[test]
    fn redacting_twice_is_idempotent() {
        let needle = "sensitive detail";
        let ws = tempdir().unwrap();
        let paths = make_meeting_with_tracked_change(ws.path(), needle);
        let canon_ws = ws.path().canonicalize().unwrap();

        let first = redact_segments_inner(&canon_ws, &paths.dir, &[1], 1_777_000_000_000).unwrap();
        assert_eq!(first.redacted_count, 1);
        let second = redact_segments_inner(&canon_ws, &paths.dir, &[1], 1_777_000_000_100).unwrap();
        assert_eq!(second.redacted_count, 0, "already-redacted segment must be a no-op, not re-counted");
    }
}
