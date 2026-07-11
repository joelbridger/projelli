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
use super::sweep::{canonicalize_within, canonicalize_workspace_relative, contained, transcript_rag_source_ids};
// stage_atomically/commit_atomically live in mod.rs (shared with
// append_pending_rag_cleanup, which had the exact same truncate-in-place
// and temp-path-symlink risks). The two-phase split lets redact.rs stage
// BOTH transcript.json and notes.docx before committing either.
use super::{commit_atomically, stage_atomically};

/// Guards the entire `redact_meeting_segments` read-modify-write-commit
/// sequence. Without this, two concurrent redaction calls could each read
/// the same original files, compute independent changes, and have the
/// later commit silently clobber the earlier one. See its use site for the
/// full reasoning (same tradeoff as PENDING_RAG_CLEANUP_LOCK in mod.rs).
static REDACTION_LOCK: std::sync::LazyLock<std::sync::Mutex<()>> = std::sync::LazyLock::new(|| std::sync::Mutex::new(()));

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
    /// Set ONLY in the narrow window where notes.docx's commit (rename)
    /// succeeded but transcript.json's commit then failed (e.g. a locked
    /// file on Windows) — the one gap the two-phase stage/commit design
    /// doesn't fully close (see write_atomically/stage_atomically/
    /// commit_atomically's docs). When this is set, `redacted_count` is 0
    /// (transcript.json — the source of truth this design's retry-safety
    /// depends on — was NOT actually updated) but notes.docx WAS mutated;
    /// the caller must still get an audit entry for that real change
    /// instead of losing all visibility into it, and should prompt a retry
    /// (safe: redacting an already-redacted notes.docx run is a no-op).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub partial_commit_error: Option<String>,
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
    // Symlink-safe from the workspace root down to the matter folder itself
    // — a symlinked "Clients/Alias" -> "Clients/RealClient" (both inside the
    // workspace) would otherwise pass a plain canonicalize()+starts_with()
    // check and let this redact RealClient's meeting while the audit entry
    // (which records matter_folder verbatim) still says Alias.
    let matter_abs = canonicalize_workspace_relative(canon_ws, matter_folder)?
        .ok_or_else(|| format!("matter folder does not exist: {matter_folder}"))?;
    // Symlink-safe AGAIN from the matter folder down to the meeting dir —
    // the same hazard applies one level deeper (a symlinked meeting entry
    // pointing at a different meeting), and meeting_dir must stay scoped to
    // ITS OWN matter folder specifically (canonicalize_within's containment
    // check is against matter_abs, not just canon_ws) — a `../OtherClient/...`
    // meeting_dir must be refused for the same reason.
    let meeting_abs = canonicalize_within(&matter_abs, meeting_dir)?
        .ok_or_else(|| format!("meeting dir does not exist: {meeting_dir}"))?;
    Ok(meeting_abs)
}

/// Replace `needle` with `marker` in every Run reachable in the DOM — plain
/// runs AND the runs inside tracked insertions/deletions — across the whole
/// document body. An `Inline::Raw`/`BlockContent::Raw` element (anything the
/// engine doesn't model — tables, unmodeled revision shapes, etc.) is opaque
/// to this pass by design; that's exactly why the byte-scan + flatten
/// fallback exists.
/// Redact every occurrence of every needle in `text` — handling needles
/// that OVERLAP without either containing the other (e.g. "HIV positive"
/// and "positive test" inside "HIV positive test"). Doing this needle-by-
/// needle sequentially (even longest-first) can leave a fragment behind:
/// replacing "positive test" first turns "HIV positive test" into
/// "HIV [marker]", after which "HIV positive" no longer matches ANYTHING
/// (its own text was partly consumed) — so it's never detected as
/// surviving, even though "HIV" is still sitting right there. Instead, find
/// every match interval for every needle up front, merge any that overlap
/// or touch, and replace each merged span with exactly one marker. This
/// also naturally subsumes the substring/containment case (a shorter
/// needle's interval is fully inside a longer one's, so they merge into
/// one span) — no ordering dependency needed at all.
fn redact_run_text(text: &str, needles: &[String], marker: &str) -> String {
    let mut intervals: Vec<(usize, usize)> = Vec::new();
    for needle in needles {
        if needle.is_empty() {
            continue;
        }
        let mut search_from = 0usize;
        while search_from <= text.len() {
            let Some(rel) = text[search_from..].find(needle.as_str()) else { break };
            let start = search_from + rel;
            let end = start + needle.len();
            intervals.push((start, end));
            // Step forward by one CHARACTER (not one byte) so overlapping
            // matches starting at any subsequent position are still found,
            // while never landing mid-character — `text[start..].find(...)`
            // and every other slice here requires a char-boundary index, and
            // `start + 1` can split a multi-byte UTF-8 character (e.g. "é",
            // "Élodie") and panic on the next slice.
            let step = text[start..].chars().next().map_or(1, char::len_utf8);
            search_from = start + step;
        }
    }
    if intervals.is_empty() {
        return text.to_string();
    }
    intervals.sort_unstable();
    let mut merged: Vec<(usize, usize)> = Vec::with_capacity(intervals.len());
    for (s, e) in intervals {
        match merged.last_mut() {
            Some(last) if s <= last.1 => last.1 = last.1.max(e),
            _ => merged.push((s, e)),
        }
    }
    let mut out = String::with_capacity(text.len());
    let mut cursor = 0usize;
    for (s, e) in merged {
        out.push_str(&text[cursor..s]);
        out.push_str(marker);
        cursor = e;
    }
    out.push_str(&text[cursor..]);
    out
}

fn replace_in_document(doc: &mut lantern_docx::Document, needles: &[String], marker: &str) {
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
                    run.text = redact_run_text(&run.text, needles, marker);
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
        Ok(doc) => {
            let in_body = lantern_docx::extract_paragraph_texts(&doc).iter().any(|t| t.contains(needle));
            // Word can split a COMMENT's text across adjacent <w:t> runs the
            // same way it splits paragraph text — the raw package_hit scan
            // above would miss that (XML tags sit between the fragments),
            // and extract_paragraph_texts only covers doc.body. Comment.text
            // is the parser's own already-FLATTENED/joined text for the
            // comment body (see lantern-docx's model.rs), so checking it
            // directly catches a split comment without needing to re-parse
            // comments.xml's raw run structure ourselves.
            let in_comments = doc.comments.values().any(|c| c.text.contains(needle));
            in_body || in_comments
        }
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

    let marker = redaction_marker(now_ms);
    let mut needles: Vec<String> = Vec::with_capacity(segment_indices.len());
    for &i in segment_indices {
        let seg = &mut segments[i];
        // Check the `redacted` FLAG, not marker-string equality: the marker
        // embeds today's date, so a segment redacted on an earlier day has
        // an OLDER marker string that would never equal today's — comparing
        // by text would treat it as "new" sensitive content, needlessly
        // adding the (harmless, but pointless) old marker text as a needle
        // and returning whole-transcript RAG cleanup ids for a call that
        // changed nothing real.
        let already_redacted = seg.get("redacted").and_then(|r| r.as_bool()).unwrap_or(false);
        let text = seg.get("text").and_then(|t| t.as_str()).unwrap_or("").to_string();
        if text.is_empty() || already_redacted {
            continue; // already redacted (or empty) — idempotent no-op, not an error
        }
        needles.push(text);
        seg["text"] = serde_json::Value::String(marker.clone());
        seg["redacted"] = serde_json::Value::Bool(true);
    }
    // Note: replace_in_document/redact_run_text handle every needle for a
    // run TOGETHER, via interval merging — not one sequential
    // needle.replace() call per needle — so overlapping or substring
    // needles (e.g. "John" and "John has cancer", or "HIV positive" and
    // "positive test") are redacted correctly regardless of processing
    // order, with no residual fragment left behind. See redact_run_text's
    // doc comment for why a sequential approach (even longest-first) isn't
    // enough on its own.

    // RAG ids for this transcript's chunks, computed from the PRE-redaction
    // bytes — same contract as Task 14's transcript_rag_source_ids ("must
    // run BEFORE transcript.json is removed"): here it's rewritten rather
    // than removed, but the chunks it identifies just went stale either way.
    // Only computed when something ACTUALLY changed (`needles` non-empty) —
    // a true no-op call (every selected segment already redacted or empty)
    // must not hand back cleanup ids for the whole transcript and cause the
    // caller to delete RAG rows that were never touched.
    let rag_cleanup_source_ids =
        if needles.is_empty() { Vec::new() } else { transcript_rag_source_ids(meeting_dir) };

    let notes_path = meeting_dir.join("notes.docx");
    refuse_symlink(&notes_path)?;
    // notes.docx is OPTIONAL (a meeting can have only a transcript) —
    // `contained()` now requires the no-follow walk to fully resolve the
    // path (see `crate::commands::pathguard::contained`), which returns
    // false for anything that doesn't exist. Only enforce containment when
    // notes.docx is actually there; a missing one is the normal,
    // transcript-only case, not a refusal.
    if notes_path.exists() && !contained(&notes_path, canon_ws) {
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
        replace_in_document(&mut doc, &needles, &marker);
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
            replace_in_document(&mut flat_doc, &needles, &marker);
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
    // transcript.json commits. If the notes.docx commit itself fails,
    // NOTHING has changed yet (transcript.json is still only staged, not
    // committed) — a clean `?` failure is correct here.
    if let Some(tmp) = &notes_tmp {
        commit_atomically(tmp, &notes_path)?;
    }
    // The transcript.json commit is the one place a failure here CAN leave
    // a real, already-applied mutation (notes.docx) with no receipt at all
    // if propagated via `?` — the caller would get nothing to audit. Return
    // Ok with partial_commit_error set instead, so redact_meeting_segments
    // can still record what actually happened on disk.
    if let Err(e) = commit_atomically(&transcript_tmp, &transcript_path) {
        return Ok(RedactionReceipt {
            redacted_count: 0, // transcript.json — the source of truth — was NOT updated
            marker,
            docx_flattened,
            rag_cleanup_source_ids: Vec::new(), // nothing durably changed on the transcript side
            audit_error: None,
            partial_commit_error: Some(format!(
                "notes.docx was updated but transcript.json commit failed: {e} — retry this redaction to complete it"
            )),
        });
    }

    Ok(RedactionReceipt {
        redacted_count: needles.len(),
        marker,
        docx_flattened,
        rag_cleanup_source_ids,
        audit_error: None,
        partial_commit_error: None,
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
        // Serialize the ENTIRE redact-and-commit sequence: two concurrent
        // redact_meeting_segments calls (even against different meetings,
        // for simplicity — this is a rare, non-perf-critical operation, same
        // tradeoff as PENDING_RAG_CLEANUP_LOCK) could otherwise both read
        // the same original transcript.json/notes.docx, compute their own
        // changes independently, and have the LATER commit silently
        // overwrite the earlier one — bringing already-redacted text back.
        let _guard = REDACTION_LOCK.lock().unwrap_or_else(|p| p.into_inner());
        let ws = Path::new(&workspace);
        let canon_ws = ws
            .canonicalize()
            .map_err(|e| format!("cannot canonicalize workspace: {e}"))?;
        let meeting_abs = resolve_meeting_dir(&canon_ws, &matter_folder, &meeting_dir)?;
        let now_ms = chrono::Utc::now().timestamp_millis() as u64;

        // Preflight the audit store BEFORE any mutation — same rule as
        // retention_sweep in mod.rs: a redaction that cannot be durably
        // recorded must never happen. super::preflight_audit_store both
        // opens AND verifies the hash chain (open() alone only opens the
        // DB — an ALREADY-altered chain is otherwise only discovered lazily
        // inside append(), by which point transcript.json/notes.docx would
        // already be rewritten with no way to durably record it).
        let store = super::preflight_audit_store(ws)?;

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
        // A partial-commit case (notes.docx changed, transcript.json didn't)
        // gets an honest, distinct description — this is a REAL mutation
        // that happened, and it must be visible in the audit log even
        // though the overall redaction didn't fully complete.
        let description = match &receipt.partial_commit_error {
            Some(e) => format!("PARTIAL redaction in {meeting_dir}: notes.docx updated but transcript.json was not ({e})"),
            None => format!("Redacted {} segment(s) in {meeting_dir}", receipt.redacted_count),
        };
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
                    "partialCommitError": receipt.partial_commit_error,
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
    use lantern_docx::{BlockContent, Comment, Document, Inline, Paragraph, RevisionMeta, Run};
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

        // `redact_segments_inner` is deliberately called with the canonical
        // meeting path produced by `resolve_meeting_dir` in production. Keep
        // this fixture in that same form: Windows canonical paths carry the
        // `\\?\` prefix, while the raw tempfile spelling does not.
        MeetingPaths { dir: dir.canonicalize().unwrap() }
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

    /// `notes.docx` is OPTIONAL — a meeting can legitimately have only a
    /// transcript and no docx notes yet. Redacting such a meeting must
    /// succeed (transcript-only), not fail with a containment refusal just
    /// because notes.docx doesn't exist.
    #[test]
    fn redacts_transcript_only_meeting_with_no_notes_docx() {
        let needle = "client admitted undisclosed offshore account";
        let ws = tempdir().unwrap();
        let dir = ws.path().join("Clients/H/Meetings/2026-05-01-review");
        std::fs::create_dir_all(&dir).unwrap();
        let transcript = serde_json::json!({
            "segments": [
                { "startMs": 0, "endMs": 4000, "channel": "sys", "speaker": "Them", "text": needle },
            ],
            "meta": { "startedAt": "2026-05-01T10:00:00Z", "durationMs": 4000, "matterId": "m-1" },
        });
        std::fs::write(dir.join("transcript.json"), serde_json::to_vec(&transcript).unwrap()).unwrap();
        assert!(!dir.join("notes.docx").exists());

        let canon_ws = ws.path().canonicalize().unwrap();
        let receipt = redact_segments_inner(&canon_ws, &dir.canonicalize().unwrap(), &[0], 1_777_000_000_000)
            .expect("redacting a transcript-only meeting (no notes.docx) must succeed");
        assert_eq!(receipt.redacted_count, 1);

        let tj_str = String::from_utf8(std::fs::read(dir.join("transcript.json")).unwrap()).unwrap();
        assert!(!tj_str.contains(needle));
        assert!(!dir.join("notes.docx").exists(), "must not create notes.docx that never existed");
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

    /// A MATTER FOLDER that is itself a symlink to a DIFFERENT, real
    /// in-workspace client folder (`Clients/Alias` -> `Clients/RealClient`)
    /// must be refused outright — a plain `canonicalize()` + `starts_with()`
    /// check would follow the symlink and accept it (the target really is
    /// inside the workspace), letting a redaction mutate RealClient's
    /// meeting while the caller's own matter_folder string (recorded in the
    /// audit entry) still says Alias.
    #[cfg(unix)]
    #[test]
    fn rejects_a_symlinked_matter_folder_even_when_its_target_is_in_workspace() {
        let ws = tempdir().unwrap();
        let real_client_meeting = make_meeting_with_tracked_change(ws.path(), "x"); // Clients/H/Meetings/...
        std::fs::rename(ws.path().join("Clients/H"), ws.path().join("Clients/RealClient")).unwrap();
        std::os::unix::fs::symlink(ws.path().join("Clients/RealClient"), ws.path().join("Clients/Alias")).unwrap();
        let canon_ws = ws.path().canonicalize().unwrap();

        let err = resolve_meeting_dir(&canon_ws, "Clients/Alias", "Meetings/2026-05-01-review").unwrap_err();
        assert!(err.contains("symlink"), "got: {err}");
        // The real client's data must be provably untouched — this test
        // only exercises path resolution, but confirms nothing was even
        // looked up under Alias's resolved target.
        let _ = real_client_meeting;
    }

    /// A symlink one level DEEPER than the matter folder itself — an
    /// intermediate directory inside the matter folder's own path but above
    /// the meeting dir — must also be refused, not just the matter folder or
    /// the final meeting entry.
    #[cfg(unix)]
    #[test]
    fn rejects_a_symlink_ancestor_mid_path() {
        let ws = tempdir().unwrap();
        make_meeting_with_tracked_change(ws.path(), "x"); // Clients/H/Meetings/2026-05-01-review
        let victim_dir = ws.path().join("Clients/OtherClient");
        std::fs::create_dir_all(&victim_dir).unwrap();
        // A symlinked intermediate directory INSIDE "Clients/H", one level
        // above the meeting entry itself.
        std::fs::rename(ws.path().join("Clients/H/Meetings"), ws.path().join("Clients/H/Meetings-real")).unwrap();
        std::os::unix::fs::symlink(ws.path().join("Clients/H/Meetings-real"), ws.path().join("Clients/H/Meetings")).unwrap();
        let canon_ws = ws.path().canonicalize().unwrap();

        let err = resolve_meeting_dir(&canon_ws, "Clients/H", "Meetings/2026-05-01-review").unwrap_err();
        assert!(err.contains("symlink"), "got: {err}");
    }

    /// A normal, non-symlinked, multi-level nested matter/meeting path must
    /// still resolve successfully — the symlink-safe walk must not reject
    /// legitimate structure.
    #[test]
    fn normal_nested_matter_and_meeting_folder_still_resolves() {
        let ws = tempdir().unwrap();
        make_meeting_with_tracked_change(ws.path(), "x"); // Clients/H/Meetings/2026-05-01-review
        let canon_ws = ws.path().canonicalize().unwrap();

        let resolved = resolve_meeting_dir(&canon_ws, "Clients/H", "Meetings/2026-05-01-review").unwrap();
        assert_eq!(resolved, canon_ws.join("Clients/H/Meetings/2026-05-01-review"));
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
        // canonicalize_within (shared with canonicalize_workspace_relative)
        // now refuses ANY '..' component outright during its symlink-safe
        // walk, rather than resolving it and checking containment
        // afterward — same protection, more precise/earlier rejection.
        assert!(err.contains("..") , "got: {err}");
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

    /// A needle sitting in a COMMENT's text (not the main document body) must
    /// also be caught — `replace_in_document` never touches `doc.comments`,
    /// and the raw package-level scan alone would miss a comment whose text
    /// got split across adjacent `<w:t>` runs on serialize/parse. Comment.text
    /// is the crate's own already-flattened text for the comment body, so
    /// checking it directly is the reliable way to catch this.
    #[test]
    fn needle_survives_check_finds_text_inside_a_comment_body() {
        let needle = "client disclosed a prior bankruptcy";
        let mut comments = std::collections::BTreeMap::new();
        comments.insert(
            "1".to_string(),
            Comment {
                id: "1".into(),
                author: "Advisor".into(),
                date: "2026-05-01T10:00:00Z".into(),
                initials: None,
                text: format!("Follow up: {needle}"),
                body_xml: None,
            },
        );
        let doc = Document {
            format_version: lantern_docx::DOM_FORMAT_VERSION,
            body: vec![BlockContent::Paragraph(Paragraph::from_inlines(vec![
                Inline::CommentRangeStart { id: "1".into() },
                Inline::Run(Run::new("Unrelated body text.")),
                Inline::CommentRangeEnd { id: "1".into() },
                Inline::CommentReference { id: "1".into() },
            ]))],
            comments,
        };
        let bytes = lantern_docx::serialize_docx_bytes(&doc).unwrap();
        assert!(
            needle_survives_in_docx_package(&bytes, needle),
            "a needle living only in a comment body must still be detected"
        );
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
        assert!(!first.rag_cleanup_source_ids.is_empty(), "the first, real redaction should report cleanup ids");
        let second = redact_segments_inner(&canon_ws, &paths.dir, &[1], 1_777_000_000_100).unwrap();
        assert_eq!(second.redacted_count, 0, "already-redacted segment must be a no-op, not re-counted");
        assert!(
            second.rag_cleanup_source_ids.is_empty(),
            "a true no-op must not report cleanup ids — nothing changed, so nothing needs re-flushing: {:?}",
            second.rag_cleanup_source_ids
        );
    }

    /// If selected segments overlap textually (one's text is a substring of
    /// another's — e.g. two segments where one says "John" and another says
    /// "John has cancer"), replacing the SHORT needle first in notes.docx
    /// would eat into the long one mid-match, leaving residual sensitive
    /// text ("has cancer") that no longer matches either needle whole. Both
    /// must come out fully redacted regardless of which segment index comes
    /// first in the selection.
    #[test]
    fn overlapping_needles_are_both_fully_redacted_not_partially_consumed() {
        let short_needle = "John";
        let long_needle = "John has cancer";
        let ws = tempdir().unwrap();
        let dir = ws.path().join("Clients/H/Meetings/2026-05-01-review");
        std::fs::create_dir_all(&dir).unwrap();

        let transcript = serde_json::json!({
            "segments": [
                { "startMs": 0, "endMs": 2000, "channel": "sys", "speaker": "Them", "text": short_needle },
                { "startMs": 2000, "endMs": 5000, "channel": "sys", "speaker": "Them", "text": long_needle },
            ],
            "meta": { "startedAt": "2026-05-01T10:00:00Z", "durationMs": 5000, "matterId": "m-1" },
        });
        std::fs::write(dir.join("transcript.json"), serde_json::to_vec(&transcript).unwrap()).unwrap();

        // notes.docx contains BOTH phrases as plain text.
        let doc = Document {
            format_version: lantern_docx::DOM_FORMAT_VERSION,
            body: vec![BlockContent::Paragraph(Paragraph::from_inlines(vec![Inline::Run(Run::new(format!(
                "Client update: {long_needle}. Also, {short_needle} called back."
            )))]))],
            comments: Default::default(),
        };
        std::fs::write(dir.join("notes.docx"), lantern_docx::serialize_docx_bytes(&doc).unwrap()).unwrap();

        let canon_ws = ws.path().canonicalize().unwrap();
        // Select index 0 (short) BEFORE index 1 (long) — the ordering that
        // would trigger the bug if needles weren't sorted longest-first.
        let receipt = redact_segments_inner(&canon_ws, &dir.canonicalize().unwrap(), &[0, 1], 1_777_000_000_000).unwrap();
        assert_eq!(receipt.redacted_count, 2);

        let docx_bytes = std::fs::read(dir.join("notes.docx")).unwrap();
        assert!(!needle_survives_in_docx_package(&docx_bytes, short_needle), "short needle must not survive");
        assert!(!needle_survives_in_docx_package(&docx_bytes, long_needle), "long needle must not survive");
        assert!(
            !needle_survives_in_docx_package(&docx_bytes, "has cancer"),
            "no residual fragment of the long needle may survive after the short needle's replacement"
        );
    }

    /// The harder case: needles that overlap WITHOUT either containing the
    /// other — "HIV positive" and "positive test" inside "HIV positive
    /// test". Longest-first sequential replacement (the round-13 fix) isn't
    /// enough here: replacing "positive test" first turns the source into
    /// "HIV [marker]", after which "HIV positive" no longer matches
    /// anything at all (its own text was partly consumed), so it would
    /// never be flagged as surviving — even though the literal word "HIV"
    /// is still sitting there. Interval merging (redact_run_text) must
    /// treat the union of both spans as one redacted region.
    #[test]
    fn non_contained_overlapping_needles_leave_no_fragment() {
        let needle_a = "HIV positive";
        let needle_b = "positive test";
        let ws = tempdir().unwrap();
        let dir = ws.path().join("Clients/H/Meetings/2026-05-01-review");
        std::fs::create_dir_all(&dir).unwrap();

        let transcript = serde_json::json!({
            "segments": [
                { "startMs": 0, "endMs": 2000, "channel": "sys", "speaker": "Them", "text": needle_a },
                { "startMs": 2000, "endMs": 5000, "channel": "sys", "speaker": "Them", "text": needle_b },
            ],
            "meta": { "startedAt": "2026-05-01T10:00:00Z", "durationMs": 5000, "matterId": "m-1" },
        });
        std::fs::write(dir.join("transcript.json"), serde_json::to_vec(&transcript).unwrap()).unwrap();

        let doc = Document {
            format_version: lantern_docx::DOM_FORMAT_VERSION,
            body: vec![BlockContent::Paragraph(Paragraph::from_inlines(vec![Inline::Run(Run::new(
                "Client update: HIV positive test result received today.",
            ))]))],
            comments: Default::default(),
        };
        std::fs::write(dir.join("notes.docx"), lantern_docx::serialize_docx_bytes(&doc).unwrap()).unwrap();

        let canon_ws = ws.path().canonicalize().unwrap();
        let receipt = redact_segments_inner(&canon_ws, &dir.canonicalize().unwrap(), &[0, 1], 1_777_000_000_000).unwrap();
        assert_eq!(receipt.redacted_count, 2);

        let docx_bytes = std::fs::read(dir.join("notes.docx")).unwrap();
        assert!(!needle_survives_in_docx_package(&docx_bytes, needle_a));
        assert!(!needle_survives_in_docx_package(&docx_bytes, needle_b));
        assert!(!needle_survives_in_docx_package(&docx_bytes, "HIV"), "no fragment of either overlapping needle may survive");
        assert!(!needle_survives_in_docx_package(&docx_bytes, "test result"), "the union span, not just the two needles literally, must be gone");
    }

    /// A needle starting with (or entirely made of) a multi-byte UTF-8
    /// character — e.g. an accented client name — must not panic the
    /// interval scanner. `search_from = start + 1` would land mid-character
    /// for "Élodie" (É is 2 bytes) or a lone "é", causing the next slice to
    /// panic on a non-char-boundary index.
    #[test]
    fn redact_run_text_handles_multi_byte_utf8_needles_without_panicking() {
        let needle = "Élodie";
        let ws = tempdir().unwrap();
        let dir = ws.path().join("Clients/H/Meetings/2026-05-01-review");
        std::fs::create_dir_all(&dir).unwrap();

        let transcript = serde_json::json!({
            "segments": [
                { "startMs": 0, "endMs": 2000, "channel": "sys", "speaker": "Them", "text": needle },
            ],
            "meta": { "startedAt": "2026-05-01T10:00:00Z", "durationMs": 2000, "matterId": "m-1" },
        });
        std::fs::write(dir.join("transcript.json"), serde_json::to_vec(&transcript).unwrap()).unwrap();

        let doc = Document {
            format_version: lantern_docx::DOM_FORMAT_VERSION,
            body: vec![BlockContent::Paragraph(Paragraph::from_inlines(vec![Inline::Run(Run::new(format!(
                "Client: {needle}. Also mentioned: {needle} again and é alone."
            )))]))],
            comments: Default::default(),
        };
        std::fs::write(dir.join("notes.docx"), lantern_docx::serialize_docx_bytes(&doc).unwrap()).unwrap();

        let canon_ws = ws.path().canonicalize().unwrap();
        // Must not panic, and must actually redact both occurrences.
        let receipt = redact_segments_inner(&canon_ws, &dir.canonicalize().unwrap(), &[0], 1_777_000_000_000).unwrap();
        assert_eq!(receipt.redacted_count, 1);
        let docx_bytes = std::fs::read(dir.join("notes.docx")).unwrap();
        assert!(!needle_survives_in_docx_package(&docx_bytes, needle));
    }

    /// A segment redacted on an EARLIER day has an OLDER marker string
    /// (the marker embeds the date) that will never equal TODAY's marker —
    /// comparing by text equality would wrongly treat it as new sensitive
    /// content. The no-op check must use the `redacted` flag instead.
    #[test]
    fn redacting_again_on_a_later_day_is_still_a_no_op() {
        let needle = "sensitive detail";
        let ws = tempdir().unwrap();
        let paths = make_meeting_with_tracked_change(ws.path(), needle);
        let canon_ws = ws.path().canonicalize().unwrap();

        let day1_ms = 1_777_000_000_000;
        let day2_ms = day1_ms + 86_400_000; // +1 day -> a different marker date string
        let first = redact_segments_inner(&canon_ws, &paths.dir, &[1], day1_ms).unwrap();
        assert_eq!(first.redacted_count, 1);

        let second = redact_segments_inner(&canon_ws, &paths.dir, &[1], day2_ms).unwrap();
        assert_eq!(second.redacted_count, 0, "a segment already redacted on an earlier day must still be a no-op");
        assert!(second.rag_cleanup_source_ids.is_empty(), "a true no-op must not report cleanup ids");

        // The transcript keeps day 1's marker text — a later no-op call must
        // NOT overwrite it with today's marker.
        let tj: serde_json::Value = serde_json::from_slice(&std::fs::read(paths.dir.join("transcript.json")).unwrap()).unwrap();
        assert_eq!(tj["segments"][1]["text"], serde_json::json!(first.marker));
    }
}
