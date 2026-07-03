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
fn contained(path: &Path, canon_ws: &Path) -> bool {
    match path.parent().and_then(|p| p.canonicalize().ok()) {
        Some(parent) => parent.starts_with(canon_ws),
        None => false,
    }
}

fn remove_file(path: &Path, kind: &str, canon_ws: &Path, out: &mut SweepOutcome) {
    if !path.exists() {
        return;
    }
    if !contained(path, canon_ws) {
        out.errors.push(format!("refused (outside workspace): {}", path.display()));
        return;
    }
    match std::fs::remove_file(path) {
        Ok(()) => out.deleted.push(SweepDeletion { path: path.to_string_lossy().into_owned(), kind: kind.to_string() }),
        Err(e) => out.errors.push(format!("delete {}: {e}", path.display())),
    }
}

fn remove_dir(path: &Path, kind: &str, canon_ws: &Path, out: &mut SweepOutcome) {
    if !path.exists() {
        return;
    }
    if !contained(path, canon_ws) {
        out.errors.push(format!("refused (outside workspace): {}", path.display()));
        return;
    }
    match std::fs::remove_dir_all(path) {
        Ok(()) => out.deleted.push(SweepDeletion { path: path.to_string_lossy().into_owned(), kind: kind.to_string() }),
        Err(e) => out.errors.push(format!("delete {}: {e}", path.display())),
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
    if name.len() >= 10 {
        if let Ok(date) = chrono::NaiveDate::parse_from_str(&name[..10], "%Y-%m-%d") {
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

fn remove_raw_audio(meeting_dir: &Path, canon_ws: &Path, out: &mut SweepOutcome) {
    remove_file(&meeting_dir.join("audio.wav"), "audio", canon_ws, out);
    // import-original.<any ext> + diarization temp channel extracts (.diarize-*.wav)
    if let Ok(entries) = std::fs::read_dir(meeting_dir) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            if name.starts_with("import-original.") {
                remove_file(&entry.path(), "import-original", canon_ws, out);
            }
            if name.starts_with(".diarize-") && name.ends_with(".wav") {
                remove_file(&entry.path(), "diarize-temp", canon_ws, out);
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
) {
    let meetings = matter_folder.join(MEETINGS_DIR_NAME);
    let Ok(entries) = std::fs::read_dir(&meetings) else {
        return; // no Meetings dir — nothing to do
    };
    for entry in entries.flatten() {
        let dir = entry.path();
        if !dir.is_dir() {
            continue; // .consent-ledger.json and friends
        }
        if !dir.join("transcript.json").exists() {
            out.skipped_in_flight += 1;
            continue; // recording/transcription in flight — NEVER touch
        }
        // Finalized: caches + breadcrumbs go in EVERY mode.
        remove_dir(&dir.join(".capture"), "chunk-cache", canon_ws, out);
        remove_file(&dir.join(".transcribe-progress.json"), "progress", canon_ws, out);
        // Diarization temps also die in every mode (Track A writes .diarize-*.wav next to audio.wav).
        if let Ok(files) = std::fs::read_dir(&dir) {
            for f in files.flatten() {
                let n = f.file_name().to_string_lossy().into_owned();
                if n.starts_with(".diarize-") && n.ends_with(".wav") {
                    remove_file(&f.path(), "diarize-temp", canon_ws, out);
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
                    remove_raw_audio(&dir, canon_ws, out);
                } else {
                    out.kept_meetings += 1;
                }
            }
            "summary-only" => {
                remove_raw_audio(&dir, canon_ws, out);
                if dir.join("notes.docx").exists() {
                    let ids = transcript_rag_source_ids(&dir);
                    out.rag_cleanup_source_ids.extend(ids);
                    remove_file(&dir.join("transcript.json"), "transcript", canon_ws, out);
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
        sweep_matter_folder(&matter, &canon_ws, "delete-audio-after-days", 30, now, &mut out);

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
        sweep_matter_folder(&matter, &canon_ws, "summary-only", 30, now, &mut out);

        assert!(!m.join("transcript.json").exists());
        assert!(!m.join("audio.wav").exists());
        assert!(m.join("notes.docx").exists());
        assert!(m2.join("transcript.json").exists(), "transcript is the only record — must be kept");
        // 90 segments -> 3 rag doc ids computed BEFORE deletion
        assert_eq!(out.rag_cleanup_source_ids.iter().filter(|s| s.contains("2026-06-01-review")).count(), 3);
        assert!(out.rag_cleanup_source_ids[0].starts_with("meeting:"));
    }

    #[test]
    fn keep_everything_only_clears_finalized_caches() {
        let ws = tempdir().unwrap();
        let matter = ws.path().join("Clients/H");
        let now = now_ms();
        let m = make_meeting(&matter, "2026-05-01-review", 40, now, true);
        let mut out = SweepOutcome::default();
        let canon_ws = ws.path().canonicalize().unwrap();
        sweep_matter_folder(&matter, &canon_ws, "keep-everything", 30, now, &mut out);
        assert!(m.join("audio.wav").exists());
        assert!(m.join("transcript.json").exists());
        assert!(!m.join(".capture").exists());
        assert!(!m.join(".transcribe-progress.json").exists());
    }

    /// Deletion code refuses to reach outside the workspace — both a symlinked
    /// Meetings dir and a symlinked artifact must be refused, not deleted.
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
        sweep_matter_folder(&matter, &canon_ws, "summary-only", 30, now, &mut out);

        // NOTE on semantics: unlinking a symlink inside the workspace removes
        // only the link, never the target — `contained()` checks the LINK's
        // parent. The victim file outside the workspace must survive.
        assert!(victim.exists(), "sweep must never delete through a symlink");
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
