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

        if needles.iter().any(|n| contains_bytes(&new_bytes, n.as_bytes())) {
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

            if needles.iter().any(|n| contains_bytes(&final_bytes, n.as_bytes())) {
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
        std::fs::write(&notes_path, &new_bytes).map_err(|e| format!("write notes.docx: {e}"))?;
    }

    // Only write transcript.json once notes.docx is confirmed safe (or there
    // was nothing to redact there): never leave transcript.json rewritten
    // while notes.docx still holds the needle.
    let transcript_bytes =
        serde_json::to_vec_pretty(&v).map_err(|e| format!("serialize transcript.json: {e}"))?;
    std::fs::write(&transcript_path, transcript_bytes).map_err(|e| format!("write transcript.json: {e}"))?;

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

        let mut receipt = redact_segments_inner(&canon_ws, &meeting_abs, &segment_indices, now_ms)?;

        // Audit AFTER the mutation. This is a single atomic operation (not a
        // batch like the sweep), so there's no "later work" whose visibility
        // an audit failure could hide — but a failed audit-store write must
        // still never erase the receipt the caller needs to flush RAG
        // cleanup, so it's recorded on the receipt instead of propagated as
        // this command's Err (same rule as retention_sweep in mod.rs).
        match crate::commands::audit::store::EncryptedAuditStore::open(ws) {
            Ok(store) => {
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
                    receipt.audit_error = Some(format!("audit append: {e}"));
                }
            }
            Err(e) => {
                receipt.audit_error = Some(format!("open audit store: {e}"));
            }
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
