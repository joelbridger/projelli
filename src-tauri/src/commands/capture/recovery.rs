use super::session::{finalize_session, SessionManifest};
use crate::commands::pathguard::display_path;
use anyhow::Result;
use std::path::{Path, PathBuf};

#[derive(serde::Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct OrphanSession {
    pub meeting_dir: String,
    pub matter_id: String,
    pub started_at: String,
}

pub fn find_orphans(workspace: &Path) -> Result<Vec<OrphanSession>> {
    // The currently-recording meeting (if any) has a `.capture/session.json`
    // too, but it isn't crashed — it's live. Listing it as recoverable would
    // let the UI offer to finalize a recording that's still in progress.
    let active = super::engine::active_meeting_dir();
    // `active_meeting_dir()` and `guard_meeting_path` (used by
    // `capture_recover`) both work in canonical paths (round-8 fix). Walking
    // from a non-canonical `workspace` (e.g. the raw string the frontend
    // happens to pass, which needn't be canonical) would make every scanned
    // path below fail to match either of those — the live-recording
    // exclusion just below, and a later capture_recover call using the very
    // path this function just returned. Canonicalize once, up front,
    // falling back to the raw path only if canonicalization itself fails
    // (e.g. workspace doesn't exist — the subsequent read_dir calls will
    // then simply find nothing, same as today).
    let canon_workspace = workspace.canonicalize().unwrap_or_else(|_| workspace.to_path_buf());
    let mut out = Vec::new();
    // Meetings dirs sit at <workspace>/<matter folder>/Meetings/<meeting>.
    // Matter folders are usually one or two levels deep, but firm/practice
    // workspaces can nest deeper (e.g. "Clients/Team/Household") — cap
    // generously to guard against a genuinely pathological/cyclic tree
    // rather than the couple of levels a real matter folder actually uses.
    fn walk(dir: &Path, depth: u8, out: &mut Vec<OrphanSession>) {
        if depth > 12 {
            return;
        }
        let Ok(entries) = std::fs::read_dir(dir) else { return };
        for e in entries.flatten() {
            // `DirEntry::file_type()` reports the entry itself without
            // following a symlink (unlike `Path::is_dir()`, which resolves
            // through symlinks via `fs::metadata`). Directory symlinks are
            // skipped rather than followed, so a workspace containing one
            // can't make this scan crawl outside the workspace boundary —
            // matching the symlink-escape guard the rest of this module
            // already enforces for direct path lookups.
            let Ok(ft) = e.file_type() else { continue };
            if !ft.is_dir() {
                continue;
            }
            let p = e.path();
            if p.file_name().and_then(|n| n.to_str()) == Some(".capture") {
                let scanned_meeting_dir = p.parent().unwrap_or(&p);
                if let Ok(m) = SessionManifest::load(scanned_meeting_dir) {
                    // Use the directory actually found on disk this scan,
                    // NOT `m.meeting_dir` (the absolute path frozen into the
                    // manifest when the meeting started). If the workspace
                    // was moved or reopened at a different mount point
                    // after a crash, the manifest's stale path no longer
                    // resolves inside the CURRENT workspace root — a
                    // capture_recover call built from it would get rejected
                    // by guard_meeting_path's workspace-containment check
                    // even though the chunks are sitting right here.
                    out.push(OrphanSession {
                        meeting_dir: display_path(scanned_meeting_dir),
                        matter_id: m.matter_id,
                        started_at: m.started_at,
                    });
                }
                continue;
            }
            walk(&p, depth + 1, out);
        }
    }
    walk(&canon_workspace, 0, &mut out);
    if let Some(active) = active {
        // The scanned `meeting_dir`s are stored on `OrphanSession` in DISPLAY
        // form (QA-41's `display_path` — the Windows verbatim `\\?\C:\…`
        // prefix stripped before it ever reaches the frontend).
        // `active_meeting_dir()` may hold a DIFFERENT form for the very same
        // directory — e.g. a non-verbatim `C:\…` path if the live session
        // was started from a raw workspace string, or the verbatim form from
        // its own canonicalization — and a plain `PathBuf` string compare
        // would then FAIL to match, wrongly listing the live recording as a
        // recoverable orphan (offering to finalize/truncate an in-progress
        // meeting). `is_same_meeting_dir` canonicalizes `active` AND runs it
        // through the SAME `display_path` strip the scanned entries already
        // went through — comparing both sides in the identical (display)
        // form — so the exclusion is reliable regardless of how the active
        // path was stored. On Unix the forms already coincide and
        // `display_path` is a no-op, so this stays a no-op there too.
        out.retain(|o| !is_same_meeting_dir(&o.meeting_dir, &active));
    }
    Ok(out)
}

/// True when `orphan_meeting_dir` (an `OrphanSession.meeting_dir` string,
/// always in QA-41 DISPLAY form) names the same directory as `active` (a
/// `PathBuf` from `active_meeting_dir()` that may or may not be
/// verbatim-prefixed, and may or may not already be canonical). Canonicalizes
/// `active` and strips it to display form before comparing, so a
/// verbatim-vs-display form mismatch can never make a live recording look
/// like a distinct (recoverable) directory. A separate function so this
/// exact comparison is unit-testable without a real Windows `canonicalize()`
/// call (see the tests below, which construct a literal verbatim-style
/// string).
fn is_same_meeting_dir(orphan_meeting_dir: &str, active: &Path) -> bool {
    let active = active.canonicalize().unwrap_or_else(|_| active.to_path_buf());
    PathBuf::from(orphan_meeting_dir) == PathBuf::from(display_path(&active))
}

pub fn recover(meeting_dir: &Path) -> Result<PathBuf> {
    // Same protection as find_orphans, enforced here too (not just at the
    // listing layer) so a stale UI list or a direct command call can't
    // finalize a recording that's still actively writing chunks.
    if super::engine::active_meeting_dir().as_deref() == Some(meeting_dir) {
        anyhow::bail!("cannot recover: this meeting is currently recording");
    }
    finalize_session(meeting_dir)
}

#[tauri::command]
pub async fn capture_find_orphans(workspace: String) -> Result<Vec<OrphanSession>, String> {
    find_orphans(Path::new(&workspace)).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn capture_recover(
    workspace: String,
    meeting_dir: String,
) -> Result<super::engine::CaptureStopResult, String> {
    // Path safety: meeting_dir comes back from the renderer (orphan list /
    // deep link) — never touch the filesystem before confirming it's really
    // inside this workspace.
    let dir = super::guard_meeting_path(Path::new(&workspace), Path::new(&meeting_dir))
        .map_err(|e| e.to_string())?;
    // Load the manifest BEFORE recover() finalizes it (finalize_session
    // removes `.capture/session.json`) so the matter id is still available
    // for the completion audit entry below. Best-effort: a manifest read
    // failure must not block recovering the actual audio, which is the
    // primary point of this command.
    let matter_id = SessionManifest::load(&dir).ok().map(|m| m.matter_id);
    let audio = recover(&dir).map_err(|e| e.to_string())?;
    // Same non-negotiable as the normal stop path (round 10 fix): a
    // completed capture — recovered or not — gets a meeting_recorded audit
    // row, or a crash-recovered meeting silently undercounts in the
    // client's confidentiality report.
    if let Some(matter_id) = matter_id {
        super::engine::append_capture_audit_best_effort(
            Path::new(&workspace).to_path_buf(),
            matter_id,
            "meeting_recorded",
            format!("Meeting recording recovered after a crash and saved at {}", display_path(&audio)),
        )
        .await;
    }
    Ok(super::engine::CaptureStopResult {
        meeting_dir: display_path(&dir),
        audio_path: display_path(&audio),
        duration_ms: 0,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::capture::chunks::ChunkWriter;
    use crate::commands::capture::session::{ConsentRecord, SessionManifest};
    use tempfile::tempdir;

    // Regression for a coordinator-review finding (2026-07-04): OrphanSession
    // now stores `meeting_dir` in QA-41 DISPLAY form (the Windows verbatim
    // `\\?\C:\…` prefix stripped before it reaches the frontend — see
    // `pathguard::display_path`), but `active_meeting_dir()` can still return
    // the verbatim form directly from the engine's own canonicalization. A
    // literal string compare between the two forms never matches on Windows,
    // so the live-recording exclusion below `find_orphans`'s scan would
    // wrongly treat an actively-recording meeting as a distinct, recoverable
    // orphan — reintroducing, in the opposite direction, exactly the bug the
    // surrounding comment warns about. These construct a literal
    // verbatim-style path (not a real Windows `canonicalize()` call) so they
    // run portably on any host, including this Linux dev/CI box.
    #[test]
    fn is_same_meeting_dir_matches_display_form_against_a_verbatim_active_path() {
        let active = Path::new(r"\\?\C:\ws\Clients\Live Household\Meetings\2026-07-01-mlive");
        let orphan_meeting_dir = r"C:\ws\Clients\Live Household\Meetings\2026-07-01-mlive";
        assert!(is_same_meeting_dir(orphan_meeting_dir, active));
    }

    #[test]
    fn is_same_meeting_dir_is_false_for_a_genuinely_different_directory() {
        let active = Path::new(r"\\?\C:\ws\Clients\Live Household\Meetings\2026-07-01-mlive");
        let orphan_meeting_dir = r"C:\ws\Clients\Old\Meetings\2026-06-01-mold";
        assert!(!is_same_meeting_dir(orphan_meeting_dir, active));
    }

    #[test]
    fn orphan_is_found_and_recovered() {
        let ws = tempdir().unwrap();
        let meeting = ws.path().join("Clients/Test/Meetings/2026-07-01-mtest");
        let cap = meeting.join(".capture");
        let mut w = ChunkWriter::new(&cap, "mic").unwrap();
        w.write(&vec![7i16; 16_000]).unwrap();
        drop(w); // crash: no finish, no finalize
        SessionManifest {
            meeting_dir: meeting.clone(),
            matter_id: "m-test".into(),
            started_at: "2026-07-01T10:00:00Z".into(),
            consent: ConsentRecord {
                mode: "one-party".into(),
                confirmed_by: "user".into(),
                confirmed_at: "2026-07-01T09:59:00Z".into(),
                note: String::new(),
            },
        }
        .save()
        .unwrap();

        let orphans = find_orphans(ws.path()).unwrap();
        assert_eq!(orphans.len(), 1);
        assert_eq!(orphans[0].matter_id, "m-test");

        let audio = recover(&meeting).unwrap();
        assert!(audio.exists());
        assert!(find_orphans(ws.path()).unwrap().is_empty());
    }

    /// Regression for the codex-review round-14 finding: `find_orphans`
    /// used to report `OrphanSession.meeting_dir` from the manifest's own
    /// `meeting_dir` field — an absolute path frozen in at recording-start
    /// time. If the workspace is later moved or reopened at a different
    /// path (e.g. relocated Documents folder, different drive letter), that
    /// stale path no longer resolves inside the CURRENT workspace root, so
    /// a `capture_recover` call built from it would get wrongly rejected by
    /// `guard_meeting_path`'s workspace-containment check even though the
    /// chunks are sitting right there. This test deliberately saves a
    /// manifest whose own `meeting_dir` field points somewhere else
    /// entirely (simulating "workspace moved after the crash") and proves
    /// `find_orphans` reports the directory it actually scanned instead.
    #[test]
    fn find_orphans_reports_the_scanned_path_not_a_stale_manifest_path() {
        let ws = tempdir().unwrap();
        let meeting = ws.path().join("Clients/Moved/Meetings/2026-07-01-mmoved");
        let cap = meeting.join(".capture");
        let mut w = ChunkWriter::new(&cap, "mic").unwrap();
        w.write(&vec![7i16; 16_000]).unwrap();
        drop(w); // crash: no finish, no finalize
        // `SessionManifest::save()` derives its ON-DISK location from
        // `self.meeting_dir`, so it can't be used here — that would try to
        // (re)create the manifest under the stale path instead of at the
        // REAL location on disk. Write the JSON directly to the real
        // `.capture/session.json` path (matching what find_orphans will
        // actually scan), with a stale `meeting_dir` field embedded inside
        // it — exactly what a manifest written before a workspace move
        // looks like: the file itself doesn't move with the workspace, but
        // its own recorded absolute path does become stale.
        let manifest = SessionManifest {
            meeting_dir: std::path::PathBuf::from("/this/workspace/no/longer/exists/mmoved"),
            matter_id: "m-moved".into(),
            started_at: "2026-07-01T10:00:00Z".into(),
            consent: ConsentRecord {
                mode: "one-party".into(),
                confirmed_by: "user".into(),
                confirmed_at: "2026-07-01T09:59:00Z".into(),
                note: String::new(),
            },
        };
        std::fs::write(
            SessionManifest::path_in(&meeting),
            serde_json::to_vec_pretty(&manifest).unwrap(),
        )
        .unwrap();

        let orphans = find_orphans(ws.path()).unwrap();
        assert_eq!(orphans.len(), 1);
        let reported = std::path::PathBuf::from(&orphans[0].meeting_dir);
        let display_workspace = std::path::PathBuf::from(display_path(&ws.path().canonicalize().unwrap()));
        assert!(
            reported.starts_with(&display_workspace),
            "expected the scanned path under the current workspace, got: {reported:?}"
        );
        assert_eq!(reported.file_name().unwrap(), "2026-07-01-mmoved");
        // The scanned path must also be directly recoverable — proving
        // this isn't just cosmetically "under the workspace" but the exact
        // directory guard_meeting_path/recover() need.
        let audio = recover(&reported).unwrap();
        assert!(audio.exists());
    }

    /// Regression for the codex-review round-11 finding: `capture_stop`
    /// appends a `meeting_recorded` audit row (round 10 fix), but
    /// `capture_recover` — the crash-recovery path — finalized the
    /// recording and returned without doing the same, so a meeting
    /// recovered after an app crash had `audio.wav` on disk but no
    /// completion event in the client's audit/confidentiality report.
    /// `capture_recover` now loads the manifest for its matter id BEFORE
    /// `recover()` deletes it, then appends the same audit row the normal
    /// stop path does.
    ///
    /// This sandbox's OS keychain collection is locked (no interactive
    /// unlock in a headless test run), so asserting the audit row actually
    /// landed in the encrypted DB isn't reliable here —
    /// `append_capture_audit_best_effort`'s own `EncryptedAuditStore::open`
    /// call is guaranteed to fail in this environment. That failure mode is
    /// exactly what this test locks in instead: the best-effort audit call
    /// must never take down the actual recovery it's piggybacking on, even
    /// when its own dependency (the keychain) is unavailable. The audit
    /// JSON shape itself is covered separately, with no keychain involved,
    /// by `capture_audit_payload_carries_a_matter_scope` in engine.rs.
    #[tokio::test]
    async fn capture_recover_still_succeeds_even_if_the_audit_append_cannot_reach_the_keychain() {
        let ws = tempdir().unwrap();
        let meeting = ws.path().join("Clients/AuditRecover/Meetings/2026-07-01-maudit");
        let cap = meeting.join(".capture");
        let mut w = ChunkWriter::new(&cap, "mic").unwrap();
        w.write(&vec![7i16; 16_000]).unwrap();
        drop(w); // crash: no finish, no finalize
        SessionManifest {
            meeting_dir: meeting.clone(),
            matter_id: "m-audit-recover".into(),
            started_at: "2026-07-01T10:00:00Z".into(),
            consent: ConsentRecord {
                mode: "one-party".into(),
                confirmed_by: "user".into(),
                confirmed_at: "2026-07-01T09:59:00Z".into(),
                note: String::new(),
            },
        }
        .save()
        .unwrap();

        // Sanity: the manifest (and its matter id) really is readable before
        // recover() runs — the round-11 fix relies on this, since recover()
        // deletes .capture/session.json as part of finalizing.
        assert_eq!(SessionManifest::load(&meeting).unwrap().matter_id, "m-audit-recover");

        let result = capture_recover(
            ws.path().to_string_lossy().into_owned(),
            meeting.to_string_lossy().into_owned(),
        )
        .await
        .unwrap();
        assert!(std::path::Path::new(&result.audio_path).exists());
    }

    // Symlink creation on Windows requires elevated/dev-mode privileges and a
    // different API — matching the convention already used for the
    // guard_matter_folder symlink test in mod.rs.
    #[cfg(unix)]
    #[test]
    fn orphan_scan_does_not_follow_directory_symlinks_out_of_the_workspace() {
        let ws = tempdir().unwrap();
        let outside = tempdir().unwrap();
        // An orphan session that lives OUTSIDE the workspace, reachable only
        // by following a symlink planted inside it.
        let crashed = outside.path().join("Clients/Escaped/Meetings/2026-06-01-mescaped");
        let mut w = ChunkWriter::new(&crashed.join(".capture"), "mic").unwrap();
        w.write(&vec![7i16; 16_000]).unwrap();
        drop(w);
        SessionManifest {
            meeting_dir: crashed.clone(),
            matter_id: "m-escaped".into(),
            started_at: "2026-06-01T10:00:00Z".into(),
            consent: ConsentRecord {
                mode: "one-party".into(),
                confirmed_by: "user".into(),
                confirmed_at: "2026-06-01T09:59:00Z".into(),
                note: String::new(),
            },
        }
        .save()
        .unwrap();
        std::os::unix::fs::symlink(outside.path(), ws.path().join("escape-link")).unwrap();

        let orphans = find_orphans(ws.path()).unwrap();
        assert!(
            orphans.is_empty(),
            "orphan scan followed a directory symlink out of the workspace: {orphans:?}"
        );
    }

    #[test]
    fn active_recording_is_never_listed_or_recoverable_as_an_orphan() {
        use crate::commands::capture::engine::{
            begin_global_with_sources_for_tests, end_global_for_tests, ENGINE_TEST_LOCK,
        };
        use crate::commands::capture::sources::{AudioSource, FakeSource};

        // Serialized against engine.rs's own ENGINE-touching tests.
        let _guard = ENGINE_TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let ws = tempdir().unwrap();
        // A genuine crashed orphan, elsewhere in the workspace — must still
        // be found even while a different meeting is actively recording.
        let crashed = ws.path().join("Clients/Old/Meetings/2026-06-01-mold");
        let mut w = ChunkWriter::new(&crashed.join(".capture"), "mic").unwrap();
        w.write(&vec![7i16; 16_000]).unwrap();
        drop(w);
        SessionManifest {
            meeting_dir: crashed.clone(),
            matter_id: "m-old".into(),
            started_at: "2026-06-01T10:00:00Z".into(),
            consent: ConsentRecord {
                mode: "one-party".into(),
                confirmed_by: "user".into(),
                confirmed_at: "2026-06-01T09:59:00Z".into(),
                note: String::new(),
            },
        }
        .save()
        .unwrap();

        let fake = || Box::new(FakeSource::new(vec![])) as Box<dyn AudioSource>;
        let active_dir = begin_global_with_sources_for_tests(
            ws.path(),
            "m-live",
            "Clients/Live Household",
            ConsentRecord {
                mode: "one-party".into(),
                confirmed_by: "user".into(),
                confirmed_at: "2026-07-01T10:00:00Z".into(),
                note: String::new(),
            },
            fake(),
            fake(),
        )
        .unwrap();

        let orphans = find_orphans(ws.path()).unwrap();
        assert_eq!(orphans.len(), 1, "only the crashed session, not the live one: {orphans:?}");
        assert_eq!(orphans[0].matter_id, "m-old");

        let err = recover(&active_dir).unwrap_err();
        assert!(err.to_string().contains("currently recording"), "got: {err}");

        end_global_for_tests();
    }
}
