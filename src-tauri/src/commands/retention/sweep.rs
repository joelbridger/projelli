//! Workspace retention sweep (Wave 4 Track D). Enforces the per-workspace
//! retention policy over EVERY location the Wave 3 capture pipeline writes:
//! audio.wav, import-original.*, .capture/ chunk caches,
//! .transcribe-progress.json, and (summary-only) transcript.json.
//!
//! Contract source: docs/plans/lantern-plus/2026-07-02-wave-3-meeting-capture.md
//! (Meeting Artifact Contract + Task 15). The enumeration test below is the
//! guard: if capture grows a new write location, extend make_meeting + the
//! sweep together or the test fails.
//!
//! Safety rules:
//!   - A meeting dir without transcript.json is IN FLIGHT — never touched.
//!   - transcript.json is deleted only in summary-only mode AND only when
//!     notes.docx exists (never delete the only record of a meeting).
//!   - Every failure is reported in `errors`, never swallowed.
use std::path::Path;

pub const MEETINGS_DIR_NAME: &str = "Meetings";
const DAY_MS: u64 = 86_400_000;
/// One indexed RAG doc per this many transcript segments (Wave 3 Task 14).
const SEGMENTS_PER_RAG_DOC: usize = 40;

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SweepDeletion {
    pub path: String,
    pub kind: String,
}

#[derive(Debug, Default, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SweepOutcome {
    pub deleted: Vec<SweepDeletion>,
    pub kept_meetings: u32,
    pub skipped_in_flight: u32,
    pub errors: Vec<String>,
    pub rag_cleanup_source_ids: Vec<String>,
}

/// Last line of defense: every unlink re-verifies canonical containment in the
/// workspace. The command-level guard already rejected bad folder inputs; this
/// catches anything a symlink inside a matter folder could smuggle in.
/// `pub(crate)` so redact.rs (Task 17b) reuses this instead of duplicating it.
///
/// Promoted to `crate::commands::pathguard` (2026-07-04 hardening pass) so
/// the vault, MCP, and diarize command sites can share the same no-follow
/// walk instead of each duplicating a canonicalize+starts_with check that
/// FOLLOWS symlinks — see the module doc comment there for the exact
/// cross-client alias-escape class this defends against. Re-exported here
/// under the original names so `retention/mod.rs` and `redact.rs` don't need
/// to change their call sites.
pub(crate) use crate::commands::pathguard::{
    canonicalize_within, canonicalize_workspace_relative, contained,
};

/// Called immediately after EVERY confirmed unlink/rmdir, before the sweep
/// moves on to the next artifact — never batched per-meeting, per-folder, or
/// per-run. A process crash anywhere in the sweep can then lose at most the
/// ONE deletion that was in flight, never a whole folder or batch's worth of
/// already-deleted, not-yet-audited files. `rag_ids` carries the RAG-doc ids
/// this specific deletion makes stale (only the summary-only mode's
/// transcript.json delete has any; every other kind passes `&[]`), so those
/// ids land durably in the SAME audit entry as the deletion that orphaned
/// them, not only in the Tauri IPC response the renderer might never finish
/// processing before a crash.
type DeleteAudit<'a> = &'a mut dyn FnMut(&SweepDeletion, &[String]) -> Result<(), String>;

/// Returns `true` when nothing remains at `path` afterward (it didn't exist,
/// or was just successfully deleted+audited) — `false` when it was refused
/// (still there) or the delete itself failed. Callers that later do a bulk
/// `remove_dir_all` over a directory this was called on MUST check this:
/// `remove_dir_all` doesn't know about a "refused" entry and would delete it
/// anyway, silently, without ever calling `on_delete` — see `remove_dir`.
fn remove_file(path: &Path, kind: &str, canon_ws: &Path, out: &mut SweepOutcome, rag_ids: &[String], on_delete: DeleteAudit) -> bool {
    // `symlink_metadata` (no-follow), not `exists()` (follows): a BROKEN
    // symlink (target doesn't exist) makes `exists()` return false even
    // though the link itself is still a real directory entry. Treating
    // that as "nothing here" would skip the containment check entirely and
    // let the caller's follow-up `remove_dir_all` unlink it later, silently
    // and unaudited — exactly the gap `contained()`'s no-follow walk and
    // this function's bool return exist to close.
    if path.symlink_metadata().is_err() {
        return true;
    }
    if !contained(path, canon_ws) {
        out.errors.push(format!("refused (outside workspace): {}", path.display()));
        return false;
    }
    match std::fs::remove_file(path) {
        Ok(()) => {
            let d = SweepDeletion { path: path.to_string_lossy().into_owned(), kind: kind.to_string() };
            if let Err(e) = on_delete(&d, rag_ids) {
                out.errors.push(e);
            }
            if !rag_ids.is_empty() {
                out.rag_cleanup_source_ids.extend(rag_ids.iter().cloned());
            }
            out.deleted.push(d);
            true
        }
        Err(e) => {
            out.errors.push(format!("delete {}: {e}", path.display()));
            false
        }
    }
}

/// Walk a directory tree and unlink every FILE individually (via
/// `remove_file`, so each one gets its own immediate audit call) rather than
/// a single `remove_dir_all` — a `.capture` chunk-cache can hold several
/// files, and auditing only once after the whole recursive delete finishes
/// would mean a crash mid-delete could leave several already-gone chunks
/// with zero audit trail, defeating the per-unlink guarantee `remove_file`
/// otherwise provides. A symlink entry falls through to `remove_file`'s own
/// containment check (which refuses it outright rather than unlinking it —
/// same as everywhere else in this module).
///
/// Returns `Ok(true)` only if EVERY entry underneath was actually removed —
/// `remove_dir` must not follow up with a bulk `remove_dir_all` otherwise,
/// or a refused (not actually deleted) entry would get swept up by it
/// anyway, unaudited.
fn remove_dir_files_individually(
    dir: &Path,
    kind: &str,
    canon_ws: &Path,
    out: &mut SweepOutcome,
    on_delete: DeleteAudit,
) -> std::io::Result<bool> {
    let mut all_removed = true;
    for entry in std::fs::read_dir(dir)? {
        let entry = entry?;
        let p = entry.path();
        if entry.file_type()?.is_dir() {
            all_removed &= remove_dir_files_individually(&p, kind, canon_ws, out, on_delete)?;
        } else {
            all_removed &= remove_file(&p, kind, canon_ws, out, &[], on_delete);
        }
    }
    Ok(all_removed)
}

fn remove_dir(path: &Path, kind: &str, canon_ws: &Path, out: &mut SweepOutcome, on_delete: DeleteAudit) {
    if !path.exists() {
        return;
    }
    // If the directory ITSELF is a symlink, walking and deleting through it
    // could destroy a different client's files entirely (its target might
    // be some other, unrelated in-workspace directory). Refuse outright:
    // never walk through a symlinked directory, no matter where it resolves
    // to. `contained()` (now a no-follow walk in its own right) would also
    // catch this, but checking it explicitly here — before ever touching
    // the directory's contents — keeps the refusal message specific.
    match path.symlink_metadata() {
        Ok(m) if m.file_type().is_symlink() => {
            out.errors.push(format!("refused (symlink): {}", path.display()));
            return;
        }
        Err(_) => return, // vanished between exists() and here — nothing to do
        Ok(_) => {}
    }
    if !contained(path, canon_ws) {
        out.errors.push(format!("refused (outside workspace): {}", path.display()));
        return;
    }
    let all_removed = match remove_dir_files_individually(path, kind, canon_ws, out, on_delete) {
        Ok(all_removed) => all_removed,
        Err(e) => {
            out.errors.push(format!("delete {}: {e}", path.display()));
            return;
        }
    };
    if !all_removed {
        // At least one entry underneath (e.g. a symlink `remove_file`
        // refused) is still there. `remove_dir_all` doesn't know or care
        // about a "refused" entry — it would delete it anyway, silently,
        // without ever calling `on_delete`, breaking the per-unlink audit
        // guarantee this function exists to provide. Leave the directory in
        // place; the refusal is already reported in `out.errors`.
        return;
    }
    // Every file inside is confirmed gone and individually audited above —
    // this only removes the now-empty directory tree structure itself (no
    // data content, so one plain filesystem call is fine here).
    if let Err(e) = std::fs::remove_dir_all(path) {
        out.errors.push(format!("delete {}: {e}", path.display()));
    }
}

/// startedAt from transcript meta -> folder-name YYYY-MM-DD prefix -> mtime.
pub fn meeting_started_ms(meeting_dir: &Path) -> Option<u64> {
    if let Ok(raw) = std::fs::read(meeting_dir.join("transcript.json")) {
        if let Ok(v) = serde_json::from_slice::<serde_json::Value>(&raw) {
            if let Some(s) = v.pointer("/meta/startedAt").and_then(|x| x.as_str()) {
                if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(s) {
                    return Some(dt.timestamp_millis() as u64);
                }
            }
        }
    }
    let name = meeting_dir.file_name()?.to_string_lossy().into_owned();
    if let Some(prefix) = name.get(..10) {
        if let Ok(date) = chrono::NaiveDate::parse_from_str(prefix, "%Y-%m-%d") {
            return Some(date.and_hms_opt(0, 0, 0)?.and_utc().timestamp_millis() as u64);
        }
    }
    let meta = std::fs::metadata(meeting_dir).ok()?;
    let mtime = meta.modified().ok()?;
    Some(mtime.duration_since(std::time::UNIX_EPOCH).ok()?.as_millis() as u64)
}

/// Recompute the RAG source ids Wave 3's indexer produced for this meeting
/// (`meeting:<dir>#<segments[k*40].startMs>`), so the renderer can delete the
/// LanceDB docs. Must run BEFORE transcript.json is removed.
pub fn transcript_rag_source_ids(meeting_dir: &Path) -> Vec<String> {
    let Ok(raw) = std::fs::read(meeting_dir.join("transcript.json")) else {
        return Vec::new();
    };
    let Ok(v) = serde_json::from_slice::<serde_json::Value>(&raw) else {
        return Vec::new();
    };
    let Some(segments) = v.get("segments").and_then(|s| s.as_array()) else {
        return Vec::new();
    };
    let dir = meeting_dir.to_string_lossy();
    segments
        .chunks(SEGMENTS_PER_RAG_DOC)
        .filter_map(|chunk| chunk.first())
        .filter_map(|first| first.get("startMs").and_then(serde_json::Value::as_u64))
        .map(|start| format!("meeting:{dir}#{start}"))
        .collect()
}

fn remove_raw_audio(meeting_dir: &Path, canon_ws: &Path, out: &mut SweepOutcome, on_delete: DeleteAudit) {
    remove_file(&meeting_dir.join("audio.wav"), "audio", canon_ws, out, &[], on_delete);
    // import-original.<any ext> + diarization temp channel extracts (.diarize-*.wav)
    if let Ok(entries) = std::fs::read_dir(meeting_dir) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            if name.starts_with("import-original.") {
                remove_file(&entry.path(), "import-original", canon_ws, out, &[], on_delete);
            }
            if name.starts_with(".diarize-") && name.ends_with(".wav") {
                remove_file(&entry.path(), "diarize-temp", canon_ws, out, &[], on_delete);
            }
        }
    }
}

pub fn sweep_matter_folder(
    matter_folder: &Path,
    canon_ws: &Path,
    mode: &str,
    audio_retention_days: u32,
    now_ms: u64,
    out: &mut SweepOutcome,
    on_delete: DeleteAudit,
) {
    let meetings = matter_folder.join(MEETINGS_DIR_NAME);
    let Ok(entries) = std::fs::read_dir(&meetings) else {
        return; // no Meetings dir — nothing to do
    };
    for entry in entries.flatten() {
        let dir = entry.path();
        // `DirEntry::file_type()` does NOT follow symlinks (unlike
        // `Path::is_dir()`, used below) — so a MEETING FOLDER ENTRY that is
        // itself a symlink to a different, unrelated in-workspace directory
        // (e.g. another client's real meeting) is caught HERE, before
        // anything under it is ever joined/walked/deleted. The `.capture`
        // symlink guard in `remove_dir` alone isn't enough: it only protects
        // the specific subdirectory it's called on, not a symlink one level
        // up at the meeting-folder entry itself.
        if entry.file_type().map(|t| t.is_symlink()).unwrap_or(false) {
            out.errors.push(format!("refused (symlink): {}", dir.display()));
            continue;
        }
        if !dir.is_dir() {
            continue; // .consent-ledger.json and friends
        }
        if !dir.join("transcript.json").exists() {
            out.skipped_in_flight += 1;
            continue; // recording/transcription in flight — NEVER touch
        }
        // Finalized: caches + breadcrumbs go in EVERY mode.
        remove_dir(&dir.join(".capture"), "chunk-cache", canon_ws, out, on_delete);
        remove_file(&dir.join(".transcribe-progress.json"), "progress", canon_ws, out, &[], on_delete);
        // Diarization temps also die in every mode (Track A writes .diarize-*.wav next to audio.wav).
        if let Ok(files) = std::fs::read_dir(&dir) {
            for f in files.flatten() {
                let n = f.file_name().to_string_lossy().into_owned();
                if n.starts_with(".diarize-") && n.ends_with(".wav") {
                    remove_file(&f.path(), "diarize-temp", canon_ws, out, &[], on_delete);
                }
            }
        }

        match mode {
            "keep-everything" => {
                out.kept_meetings += 1;
            }
            "delete-audio-after-days" => {
                let started = meeting_started_ms(&dir).unwrap_or(now_ms);
                let age_ms = now_ms.saturating_sub(started);
                if age_ms > u64::from(audio_retention_days) * DAY_MS {
                    remove_raw_audio(&dir, canon_ws, out, on_delete);
                } else {
                    out.kept_meetings += 1;
                }
            }
            "summary-only" => {
                remove_raw_audio(&dir, canon_ws, out, on_delete);
                if dir.join("notes.docx").exists() {
                    // Only queue RAG cleanup once transcript.json is CONFIRMED
                    // gone — remove_file only extends rag_cleanup_source_ids
                    // (and only invokes on_delete with these ids) on the
                    // Ok(()) branch, so a locked file, a permission error, or
                    // a containment refusal never wipes the searchable RAG
                    // index for a transcript that's still sitting on disk.
                    let ids = transcript_rag_source_ids(&dir);
                    remove_file(&dir.join("transcript.json"), "transcript", canon_ws, out, &ids, on_delete);
                } else {
                    out.kept_meetings += 1; // transcript is the only record
                }
            }
            other => out.errors.push(format!("unknown retention mode: {other}")),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    const DAY_MS: u64 = 86_400_000;

    /// Build one meeting dir with EVERY artifact the Wave 3 capture pipeline
    /// writes (the location contract). `started_days_ago` controls age.
    fn make_meeting(matters_root: &std::path::Path, slug: &str, started_days_ago: u64, now_ms: u64, finalized: bool) -> std::path::PathBuf {
        let m = matters_root.join("Meetings").join(slug);
        std::fs::create_dir_all(m.join(".capture")).unwrap();
        std::fs::write(m.join(".capture/mic-000001.wav"), b"chunk").unwrap();
        std::fs::write(m.join(".capture/sys-000001.wav"), b"chunk").unwrap();
        std::fs::write(m.join(".capture/session.json"), b"{}").unwrap();
        std::fs::write(m.join("audio.wav"), b"audio").unwrap();
        std::fs::write(m.join("import-original.m4a"), b"import").unwrap();
        std::fs::write(m.join(".diarize-sys.wav"), b"diarize-temp").unwrap();
        std::fs::write(m.join(".transcribe-progress.json"), b"{}").unwrap();
        std::fs::write(m.join("notes.docx"), b"docx").unwrap();
        std::fs::write(m.join("meeting.json"), b"{}").unwrap();
        if finalized {
            let started = now_ms - started_days_ago * DAY_MS;
            let started_iso = chrono::DateTime::from_timestamp_millis(started as i64).unwrap().to_rfc3339();
            // 90 segments -> 3 indexed docs (Wave 3 chunks by 40)
            let segments: Vec<serde_json::Value> = (0..90)
                .map(|i| serde_json::json!({ "startMs": i * 10_000, "endMs": i * 10_000 + 9_000, "channel": if i % 2 == 0 { "mic" } else { "sys" }, "speaker": "Them", "text": format!("line {i}") }))
                .collect();
            let t = serde_json::json!({ "segments": segments, "meta": { "startedAt": started_iso, "durationMs": 900_000, "matterId": "m-1", "consent": { "mode": "one-party" } } });
            std::fs::write(m.join("transcript.json"), serde_json::to_vec(&t).unwrap()).unwrap();
        }
        m
    }

    fn now_ms() -> u64 {
        chrono::Utc::now().timestamp_millis() as u64
    }

    /// THE mandatory test: after a policy-firing sweep, a recursive scan of the
    /// matter folder finds NO raw-audio artifact of any kind for old finalized
    /// meetings — not in the meeting dir, not in a chunk cache, nowhere.
    #[test]
    fn delete_audio_mode_clears_every_capture_location_for_old_meetings() {
        let ws = tempdir().unwrap();
        let matter = ws.path().join("Clients/Henderson");
        let now = now_ms();
        let old = make_meeting(&matter, "2026-05-01-review", 40, now, true);
        let fresh = make_meeting(&matter, "2026-07-01-checkin", 1, now, true);
        let inflight = make_meeting(&matter, "2026-07-02-live", 0, now, false);
        std::fs::write(matter.join("Meetings/.consent-ledger.json"), b"{}").unwrap();

        let mut out = SweepOutcome::default();
        let canon_ws = ws.path().canonicalize().unwrap();
        sweep_matter_folder(&matter, &canon_ws, "delete-audio-after-days", 30, now, &mut out, &mut |_d, _ids| Ok(()));

        // Old meeting: every raw-audio location gone; text artifacts kept.
        assert!(!old.join("audio.wav").exists());
        assert!(!old.join("import-original.m4a").exists());
        assert!(!old.join(".capture").exists());
        assert!(!old.join(".diarize-sys.wav").exists());
        assert!(!old.join(".transcribe-progress.json").exists());
        assert!(old.join("transcript.json").exists());
        assert!(old.join("notes.docx").exists());
        assert!(old.join("meeting.json").exists());

        // Fresh meeting keeps audio; caches STILL cleared (finalized).
        assert!(fresh.join("audio.wav").exists());
        assert!(!fresh.join(".capture").exists());
        assert!(!fresh.join(".diarize-sys.wav").exists()); // diarize temps die in every mode
        assert!(!fresh.join(".transcribe-progress.json").exists());

        // In-flight meeting: completely untouched (no transcript.json yet).
        assert!(inflight.join(".capture").exists());
        assert!(inflight.join("audio.wav").exists());
        assert_eq!(out.skipped_in_flight, 1);

        // Ledger untouched.
        assert!(matter.join("Meetings/.consent-ledger.json").exists());

        // Exhaustive scan: NO stray audio bytes survive anywhere for the old
        // meeting (this is the "provably clears every location" assertion —
        // if Wave 3 adds a new write location, add it to make_meeting and to
        // the sweep or this scan fails).
        for entry in walkdir::WalkDir::new(&old) {
            let entry = entry.unwrap();
            let name = entry.file_name().to_string_lossy().to_lowercase();
            assert!(
                !(name.ends_with(".wav") || name.ends_with(".opus") || name.starts_with("import-original")),
                "raw audio artifact survived the sweep: {}", entry.path().display()
            );
        }
        assert!(out.errors.is_empty(), "sweep errors: {:?}", out.errors);
        assert!(out.deleted.iter().any(|d| d.kind == "audio"));
        assert!(out.deleted.iter().any(|d| d.kind == "chunk-cache"));
    }

    #[test]
    fn summary_only_also_deletes_transcript_and_reports_rag_ids_but_never_orphans_notes() {
        let ws = tempdir().unwrap();
        let matter = ws.path().join("Clients/H");
        let now = now_ms();
        let m = make_meeting(&matter, "2026-06-01-review", 10, now, true);
        // Meeting WITHOUT notes.docx must keep its transcript (only record).
        let m2 = make_meeting(&matter, "2026-06-02-nonotes", 10, now, true);
        std::fs::remove_file(m2.join("notes.docx")).unwrap();

        let mut out = SweepOutcome::default();
        let canon_ws = ws.path().canonicalize().unwrap();
        sweep_matter_folder(&matter, &canon_ws, "summary-only", 30, now, &mut out, &mut |_d, _ids| Ok(()));

        assert!(!m.join("transcript.json").exists());
        assert!(!m.join("audio.wav").exists());
        assert!(m.join("notes.docx").exists());
        assert!(m2.join("transcript.json").exists(), "transcript is the only record — must be kept");
        // 90 segments -> 3 rag doc ids computed BEFORE deletion
        assert_eq!(out.rag_cleanup_source_ids.iter().filter(|s| s.contains("2026-06-01-review")).count(), 3);
        assert!(out.rag_cleanup_source_ids[0].starts_with("meeting:"));
    }

    /// The audit callback fires exactly once per confirmed deletion — not
    /// once per meeting, not once per folder, not once for the whole sweep —
    /// and only the transcript.json deletion carries its RAG-cleanup ids
    /// (every other kind gets an empty slice). This is the interleaving the
    /// data-loss-critical audit trail depends on: a crash mid-sweep can only
    /// ever lose the ONE deletion the callback was in the middle of auditing.
    #[test]
    fn on_delete_fires_once_per_deletion_with_rag_ids_only_for_transcript() {
        let ws = tempdir().unwrap();
        let matter = ws.path().join("Clients/H");
        let now = now_ms();
        make_meeting(&matter, "2026-06-01-review", 10, now, true);

        let mut out = SweepOutcome::default();
        let canon_ws = ws.path().canonicalize().unwrap();
        let mut audited: Vec<(String, String, Vec<String>)> = Vec::new();
        sweep_matter_folder(&matter, &canon_ws, "summary-only", 30, now, &mut out, &mut |d, ids| {
            audited.push((d.path.clone(), d.kind.clone(), ids.to_vec()));
            Ok(())
        });

        // Every out.deleted entry has a matching, immediately-fired audit call.
        assert_eq!(audited.len(), out.deleted.len());
        assert_eq!(
            audited.iter().map(|(p, ..)| p.clone()).collect::<Vec<_>>(),
            out.deleted.iter().map(|d| d.path.clone()).collect::<Vec<_>>(),
        );
        let transcript_calls: Vec<_> = audited.iter().filter(|(_, kind, _)| kind == "transcript").collect();
        assert_eq!(transcript_calls.len(), 1);
        assert_eq!(transcript_calls[0].2.len(), 3, "the transcript delete's own audit call must carry its RAG ids");
        for (_, kind, ids) in audited.iter().filter(|(_, kind, _)| kind != "transcript") {
            assert!(ids.is_empty(), "{kind} deletion must not carry RAG ids");
        }
    }

    /// `.capture` (the chunk-cache directory) holds MULTIPLE files
    /// (mic/sys .wav chunks + session.json). Each one must get its own
    /// immediate audit call — not one call after a single `remove_dir_all` —
    /// so a crash mid-directory-delete can only ever lose the one chunk file
    /// in flight, never the whole cache's contents with zero audit trail.
    #[test]
    fn capture_dir_audits_each_chunk_file_individually_not_the_whole_dir_at_once() {
        let ws = tempdir().unwrap();
        let matter = ws.path().join("Clients/H");
        let now = now_ms();
        let m = make_meeting(&matter, "2026-06-01-review", 10, now, true);
        let capture_files: Vec<_> = std::fs::read_dir(m.join(".capture")).unwrap().map(|e| e.unwrap().path()).collect();
        assert!(capture_files.len() >= 2, "fixture must actually have multiple chunk-cache files for this test to mean anything");

        let mut out = SweepOutcome::default();
        let canon_ws = ws.path().canonicalize().unwrap();
        let mut chunk_cache_calls: Vec<String> = Vec::new();
        sweep_matter_folder(&matter, &canon_ws, "keep-everything", 30, now, &mut out, &mut |d, _ids| {
            if d.kind == "chunk-cache" {
                chunk_cache_calls.push(d.path.clone());
            }
            Ok(())
        });

        assert_eq!(
            chunk_cache_calls.len(),
            capture_files.len(),
            "every file inside .capture must get its own audit call, not one call for the whole directory"
        );
        for f in &capture_files {
            let p = f.to_string_lossy().into_owned();
            assert!(chunk_cache_calls.contains(&p), "missing individual audit call for {p}");
        }
        assert!(!m.join(".capture").exists());
    }

    /// If the audit callback fails for one deletion (simulating an audit-store
    /// hiccup), the sweep must still record that deletion in `out.deleted`
    /// (the file really is gone) and keep processing later deletions — a
    /// single audit-append failure must never make the caller lose visibility
    /// into everything that was actually deleted.
    #[test]
    fn on_delete_failure_does_not_lose_the_deletion_or_stop_the_sweep() {
        let ws = tempdir().unwrap();
        let matter = ws.path().join("Clients/H");
        let now = now_ms();
        make_meeting(&matter, "2026-05-01-review", 40, now, true);

        let mut out = SweepOutcome::default();
        let canon_ws = ws.path().canonicalize().unwrap();
        let mut calls = 0u32;
        sweep_matter_folder(&matter, &canon_ws, "delete-audio-after-days", 30, now, &mut out, &mut |_d, _ids| {
            calls += 1;
            Err("simulated audit-store failure".to_string())
        });

        assert!(calls > 0, "the callback must have been invoked");
        assert!(out.deleted.iter().any(|d| d.kind == "audio"), "the deletion itself must still be recorded");
        assert!(out.errors.iter().any(|e| e.contains("simulated audit-store failure")));
    }

    /// summary-only mode must never queue a transcript's RAG-doc ids for
    /// deletion when the transcript.json unlink itself failed — here, a
    /// read-only meeting folder lets the transcript still be READ (so the ids
    /// are computed, same as a real run) but refuses the actual unlink
    /// (Unix requires write+exec on the containing dir to remove an entry),
    /// so the searchable index must stay in sync with what's really on disk.
    /// Unix-only: the read-only-directory trick to force a deterministic
    /// unlink failure relies on `std::os::unix::fs::PermissionsExt`, which
    /// doesn't exist on Windows (a shipped target platform) — gate the whole
    /// test + its helper so `cargo test` still compiles cross-platform.
    #[cfg(unix)]
    #[test]
    fn summary_only_never_queues_rag_cleanup_when_transcript_delete_fails() {
        use std::os::unix::fs::PermissionsExt;

        let ws = tempdir().unwrap();
        let matter = ws.path().join("Clients/H");
        let now = now_ms();
        let m = make_meeting(&matter, "2026-05-01-x", 40, now, true);

        // Read-only meeting dir: read(transcript.json) still works, but
        // unlinking any entry inside it (including transcript.json) fails.
        std::fs::set_permissions(&m, std::fs::Permissions::from_mode(0o555)).unwrap();
        let restore = scopeguard(&m);

        let mut out = SweepOutcome::default();
        let canon_ws = ws.path().canonicalize().unwrap();
        sweep_matter_folder(&matter, &canon_ws, "summary-only", 30, now, &mut out, &mut |_d, _ids| Ok(()));
        drop(restore); // restore write perms so tempdir cleanup can delete it

        assert!(m.join("transcript.json").exists(), "delete must have actually failed for this test to be meaningful");
        assert!(
            out.rag_cleanup_source_ids.is_empty(),
            "RAG cleanup must not be queued when the transcript delete didn't happen: {:?}",
            out.rag_cleanup_source_ids
        );
        assert!(!out.errors.is_empty(), "the failed delete should be reported");
    }

    /// Restores a directory's permissions to 0o755 when dropped, so a
    /// read-only-dir test cleans up after itself even on an early return.
    #[cfg(unix)]
    struct RestorePerms<'a>(&'a std::path::Path);
    #[cfg(unix)]
    impl Drop for RestorePerms<'_> {
        fn drop(&mut self) {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(self.0, std::fs::Permissions::from_mode(0o755));
        }
    }
    #[cfg(unix)]
    fn scopeguard(p: &std::path::Path) -> RestorePerms<'_> {
        RestorePerms(p)
    }

    #[test]
    fn meeting_started_ms_does_not_panic_when_folder_name_prefix_splits_unicode() {
        let dir = tempdir().unwrap();
        let meeting = dir.path().join("123456789😀bad");
        std::fs::create_dir_all(&meeting).unwrap();

        let result = std::panic::catch_unwind(|| meeting_started_ms(&meeting));

        assert!(result.is_ok(), "unicode folder names must never crash retention cleanup");
        assert!(result.unwrap().is_some(), "mtime fallback should still identify a start time");
    }

    #[test]
    fn keep_everything_only_clears_finalized_caches() {
        let ws = tempdir().unwrap();
        let matter = ws.path().join("Clients/H");
        let now = now_ms();
        let m = make_meeting(&matter, "2026-05-01-review", 40, now, true);
        let mut out = SweepOutcome::default();
        let canon_ws = ws.path().canonicalize().unwrap();
        sweep_matter_folder(&matter, &canon_ws, "keep-everything", 30, now, &mut out, &mut |_d, _ids| Ok(()));
        assert!(m.join("audio.wav").exists());
        assert!(m.join("transcript.json").exists());
        assert!(!m.join(".capture").exists());
        assert!(!m.join(".transcribe-progress.json").exists());
    }

    /// Deletion code refuses to reach outside the workspace — both a symlinked
    /// Meetings dir and a symlinked artifact must be refused, not deleted.
    /// Unix-only: `std::os::unix::fs::symlink` doesn't exist on Windows (a
    /// shipped target platform) — gate so `cargo test` still compiles there.
    #[cfg(unix)]
    #[test]
    fn sweep_refuses_symlink_escape() {
        let ws = tempdir().unwrap();
        let outside = tempdir().unwrap();
        let victim = outside.path().join("audio.wav");
        std::fs::write(&victim, b"precious").unwrap();

        let matter = ws.path().join("Clients/Evil");
        let now = now_ms();
        let meeting = make_meeting(&matter, "2026-05-01-x", 40, now, true);
        // Replace a swept artifact with a symlink pointing outside.
        std::fs::remove_file(meeting.join("audio.wav")).unwrap();
        std::os::unix::fs::symlink(&victim, meeting.join("audio.wav")).unwrap();

        let mut out = SweepOutcome::default();
        let canon_ws = ws.path().canonicalize().unwrap();
        sweep_matter_folder(&matter, &canon_ws, "summary-only", 30, now, &mut out, &mut |_d, _ids| Ok(()));

        // NOTE on semantics: unlinking a symlink inside the workspace removes
        // only the link, never the target — `contained()` checks the LINK's
        // parent. The victim file outside the workspace must survive.
        assert!(victim.exists(), "sweep must never delete through a symlink");
    }

    /// `.capture` being a symlink to a DIFFERENT, unrelated IN-WORKSPACE
    /// directory (e.g. another client's folder) must be refused outright —
    /// `contained()` alone would pass (the symlink's target really is inside
    /// canon_ws), so walking and deleting through it could destroy a
    /// completely different client's files.
    #[cfg(unix)]
    #[test]
    fn sweep_refuses_a_symlinked_capture_directory_even_when_its_target_is_in_workspace() {
        let ws = tempdir().unwrap();
        let now = now_ms();

        // A real directory belonging to a DIFFERENT client, with a file that
        // must never be touched.
        let victim_dir = ws.path().join("Clients/OtherClient/precious-data");
        std::fs::create_dir_all(&victim_dir).unwrap();
        std::fs::write(victim_dir.join("secret.txt"), b"do not delete me").unwrap();

        let matter = ws.path().join("Clients/Evil");
        let meeting = make_meeting(&matter, "2026-05-01-x", 40, now, true);
        std::fs::remove_dir_all(meeting.join(".capture")).unwrap();
        std::os::unix::fs::symlink(&victim_dir, meeting.join(".capture")).unwrap();

        let mut out = SweepOutcome::default();
        let canon_ws = ws.path().canonicalize().unwrap();
        sweep_matter_folder(&matter, &canon_ws, "summary-only", 30, now, &mut out, &mut |_d, _ids| Ok(()));

        assert!(victim_dir.join("secret.txt").exists(), "must never walk/delete through a symlinked directory");
        assert!(out.errors.iter().any(|e| e.contains("symlink")), "the refusal should be reported: {:?}", out.errors);
    }

    /// A symlink FILE planted inside a real `.capture` directory (alongside
    /// the normal chunk files) must be refused by `remove_file`'s
    /// containment check — and, critically, that refusal must stop the
    /// directory's follow-up bulk `remove_dir_all` too. Otherwise the
    /// refused symlink would still get deleted by `remove_dir_all` (which
    /// doesn't know or care that it was "refused"), just silently, without
    /// ever calling `on_delete` — breaking the per-unlink audit guarantee
    /// this whole module exists to provide.
    #[cfg(unix)]
    #[test]
    fn sweep_leaves_capture_dir_in_place_rather_than_silently_sweeping_an_unaudited_symlink() {
        let ws = tempdir().unwrap();
        let now = now_ms();
        let outside = tempdir().unwrap();
        let victim = outside.path().join("secret.txt");
        std::fs::write(&victim, b"do not delete me").unwrap();

        let matter = ws.path().join("Clients/Evil");
        let meeting = make_meeting(&matter, "2026-05-01-x", 40, now, true);
        std::os::unix::fs::symlink(&victim, meeting.join(".capture/escape.bin")).unwrap();

        let mut audited_paths: Vec<String> = Vec::new();
        let mut out = SweepOutcome::default();
        let canon_ws = ws.path().canonicalize().unwrap();
        sweep_matter_folder(&matter, &canon_ws, "summary-only", 30, now, &mut out, &mut |d, _ids| {
            audited_paths.push(d.path.clone());
            Ok(())
        });

        assert!(victim.exists(), "the symlink target outside the workspace must never be touched");
        assert!(
            meeting.join(".capture").exists(),
            ".capture must not be bulk-removed while a refused symlink entry is still inside it"
        );
        assert!(
            meeting.join(".capture/escape.bin").exists(),
            "the refused symlink entry itself must still be there, not silently swept by remove_dir_all"
        );
        assert!(
            !audited_paths.iter().any(|p| p.contains("escape.bin")),
            "the symlink must never be reported as an audited deletion: {audited_paths:?}"
        );
        assert!(
            out.errors.iter().any(|e| e.contains("outside workspace") || e.contains("symlink")),
            "the refusal should be reported: {:?}", out.errors
        );
    }

    /// A BROKEN (dangling) symlink — its target doesn't exist — inside
    /// `.capture` must be treated the same as a live one: refused, not
    /// silently swept by the follow-up `remove_dir_all`. `Path::exists()`
    /// FOLLOWS symlinks and returns false for a dangling one, which would
    /// make `remove_file`'s old `!path.exists()` early-return treat it as
    /// "nothing here" and skip the containment check entirely, letting
    /// `remove_dir_all` unlink it later without ever calling `on_delete`.
    #[cfg(unix)]
    #[test]
    fn sweep_leaves_capture_dir_in_place_when_it_contains_a_broken_symlink() {
        let ws = tempdir().unwrap();
        let now = now_ms();

        let matter = ws.path().join("Clients/Evil");
        let meeting = make_meeting(&matter, "2026-05-01-x", 40, now, true);
        // Target deliberately does not exist — a dangling symlink.
        std::os::unix::fs::symlink(
            ws.path().join("nonexistent-target"),
            meeting.join(".capture/broken.bin"),
        )
        .unwrap();
        assert!(!meeting.join(".capture/broken.bin").exists(), "sanity check: the symlink must be broken (exists() follows and reports false)");

        let mut audited_paths: Vec<String> = Vec::new();
        let mut out = SweepOutcome::default();
        let canon_ws = ws.path().canonicalize().unwrap();
        sweep_matter_folder(&matter, &canon_ws, "summary-only", 30, now, &mut out, &mut |d, _ids| {
            audited_paths.push(d.path.clone());
            Ok(())
        });

        assert!(
            meeting.join(".capture").exists(),
            ".capture must not be bulk-removed while a refused broken symlink is still inside it"
        );
        assert!(
            meeting.join(".capture/broken.bin").symlink_metadata().is_ok(),
            "the broken symlink entry itself must still be there, not silently swept by remove_dir_all"
        );
        assert!(
            !audited_paths.iter().any(|p| p.contains("broken.bin")),
            "the broken symlink must never be reported as an audited deletion: {audited_paths:?}"
        );
        assert!(
            out.errors.iter().any(|e| e.contains("outside workspace") || e.contains("symlink")),
            "the refusal should be reported: {:?}", out.errors
        );
    }

    /// A MEETING FOLDER ENTRY itself (not just an artifact one level deeper,
    /// like `.capture`) being a symlink to another client's real meeting
    /// must be refused BEFORE anything under it is touched — `Path::is_dir()`
    /// follows symlinks, so without a check using `DirEntry::file_type()`
    /// (which does not), the sweep would walk straight into it.
    #[cfg(unix)]
    #[test]
    fn sweep_refuses_a_symlinked_meeting_folder_entry() {
        let ws = tempdir().unwrap();
        let now = now_ms();

        let victim_matter = ws.path().join("Clients/OtherClient");
        let victim_meeting = make_meeting(&victim_matter, "2026-05-01-real", 40, now, true);

        let evil_matter = ws.path().join("Clients/Evil");
        std::fs::create_dir_all(evil_matter.join("Meetings")).unwrap();
        std::os::unix::fs::symlink(&victim_meeting, evil_matter.join("Meetings/link")).unwrap();

        let mut out = SweepOutcome::default();
        let canon_ws = ws.path().canonicalize().unwrap();
        sweep_matter_folder(&evil_matter, &canon_ws, "summary-only", 30, now, &mut out, &mut |_d, _ids| Ok(()));

        assert!(victim_meeting.join("audio.wav").exists(), "the OTHER client's real meeting must be completely untouched");
        assert!(victim_meeting.join("transcript.json").exists());
        assert!(out.errors.iter().any(|e| e.contains("symlink")), "the refusal should be reported: {:?}", out.errors);
    }

    #[test]
    fn meeting_age_falls_back_from_meta_to_folder_name() {
        let ws = tempdir().unwrap();
        let matter = ws.path().join("Clients/H");
        let now = now_ms();
        let m = make_meeting(&matter, "2026-01-15-old", 5, now, true);
        // Corrupt the meta so startedAt is unreadable -> folder-name date wins.
        std::fs::write(m.join("transcript.json"), br#"{"segments":[],"meta":{}}"#).unwrap();
        let started = meeting_started_ms(&m).unwrap();
        let expected = chrono::NaiveDate::from_ymd_opt(2026, 1, 15).unwrap()
            .and_hms_opt(0, 0, 0).unwrap().and_utc().timestamp_millis() as u64;
        assert_eq!(started, expected);
    }
}
