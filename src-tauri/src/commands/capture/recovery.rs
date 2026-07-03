use super::session::{finalize_session, SessionManifest};
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
            let p = e.path();
            if !p.is_dir() {
                continue;
            }
            if p.file_name().and_then(|n| n.to_str()) == Some(".capture") {
                if let Ok(m) = SessionManifest::load(p.parent().unwrap_or(&p)) {
                    out.push(OrphanSession {
                        meeting_dir: m.meeting_dir.to_string_lossy().into_owned(),
                        matter_id: m.matter_id,
                        started_at: m.started_at,
                    });
                }
                continue;
            }
            walk(&p, depth + 1, out);
        }
    }
    walk(workspace, 0, &mut out);
    if let Some(active) = active {
        out.retain(|o| PathBuf::from(&o.meeting_dir) != active);
    }
    Ok(out)
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
    let audio = recover(&dir).map_err(|e| e.to_string())?;
    Ok(super::engine::CaptureStopResult {
        meeting_dir: dir.to_string_lossy().into_owned(),
        audio_path: audio.to_string_lossy().into_owned(),
        duration_ms: 0,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::capture::chunks::ChunkWriter;
    use crate::commands::capture::session::{ConsentRecord, SessionManifest};
    use tempfile::tempdir;

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
