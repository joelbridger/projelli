use super::chunks::ChunkWriter;
use super::session::{finalize_session, ConsentRecord, SessionManifest};
use super::sources::AudioSource;
use anyhow::{anyhow, Result};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Instant;

pub struct StopResult {
    pub meeting_dir: PathBuf,
    pub audio_path: PathBuf,
    pub duration_ms: u64,
}

pub struct CaptureEngine {
    meeting_dir: PathBuf,
    mic: Box<dyn AudioSource>,
    sys: Box<dyn AudioSource>,
    started: Instant,
    _awake: Option<keepawake::KeepAwake>,
}

fn slugify(matter_id: &str) -> String {
    matter_id.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '-').collect()
}

impl CaptureEngine {
    pub fn start_with_sources(
        workspace: &Path,
        matter_id: &str,
        matter_folder: &str,
        consent: ConsentRecord,
        mut mic: Box<dyn AudioSource>,
        mut sys: Box<dyn AudioSource>,
    ) -> Result<Self> {
        // Path safety: matter_folder comes from the workspace store, but we
        // still refuse traversal per the repo's PathValidator rule.
        if matter_folder.contains("..") {
            return Err(anyhow!("invalid matter folder"));
        }
        let date = chrono::Utc::now().format("%Y-%m-%d");
        let meetings_dir = workspace.join(matter_folder).join("Meetings");
        let base_slug = format!("{date}-{}", slugify(matter_id));
        // The Meeting Artifact Contract's folder name is `<date>-<slug>` for
        // the common case (one meeting per client per day). A second
        // same-day meeting for the same client would otherwise collide on
        // that exact name and silently merge/overwrite the first meeting's
        // already-finalized audio.wav — fall back to a numeric disambiguator
        // only when that exact folder is already taken.
        let mut meeting_dir = meetings_dir.join(&base_slug);
        let mut suffix = 2;
        while meeting_dir.exists() {
            meeting_dir = meetings_dir.join(format!("{base_slug}-{suffix}"));
            suffix += 1;
        }
        let cap = meeting_dir.join(".capture");
        std::fs::create_dir_all(&cap)?;

        SessionManifest {
            meeting_dir: meeting_dir.clone(),
            matter_id: matter_id.to_string(),
            started_at: chrono::Utc::now().to_rfc3339(),
            consent,
        }
        .save()?;

        let mic_writer = Arc::new(Mutex::new(ChunkWriter::new(&cap, "mic")?));
        let sys_writer = Arc::new(Mutex::new(ChunkWriter::new(&cap, "sys")?));
        {
            let w = mic_writer.clone();
            mic.start(Box::new(move |s| {
                if let Ok(mut w) = w.lock() {
                    let _ = w.write(s);
                }
            }))?;
        }
        {
            let w = sys_writer.clone();
            sys.start(Box::new(move |s| {
                if let Ok(mut w) = w.lock() {
                    let _ = w.write(s);
                }
            }))?;
        }
        let awake = keepawake::Builder::default()
            .display(false)
            .idle(true)
            .sleep(true)
            .reason("Recording a client meeting")
            .create()
            .ok();
        Ok(Self { meeting_dir, mic, sys, started: Instant::now(), _awake: awake })
    }

    pub fn elapsed_ms(&self) -> u64 {
        self.started.elapsed().as_millis() as u64
    }

    pub fn stop(mut self) -> Result<StopResult> {
        self.mic.stop()?;
        self.sys.stop()?;
        // ChunkWriters finalize on drop (Task 1); finalize merges them.
        let audio_path = finalize_session(&self.meeting_dir)?;
        Ok(StopResult {
            meeting_dir: self.meeting_dir.clone(),
            audio_path,
            duration_ms: self.elapsed_ms(),
        })
    }
}

// ---------- global singleton + Tauri commands ------------------------------

static ENGINE: Mutex<Option<CaptureEngine>> = Mutex::new(None);

/// Guard + engine-start, parameterized over already-constructed sources so
/// tests can drive the "already recording" guard with `FakeSource` instead
/// of depending on real audio hardware (this dev box is headless — no ALSA
/// device exists, so resolving real sources here would make the guard test
/// fail for reasons unrelated to the guard itself).
fn begin_global_with_sources(
    workspace: &Path,
    matter_id: &str,
    matter_folder: &str,
    consent: ConsentRecord,
    mic: Box<dyn AudioSource>,
    sys: Box<dyn AudioSource>,
) -> Result<PathBuf, String> {
    let mut guard = ENGINE.lock().unwrap();
    if guard.is_some() {
        return Err("already recording".into());
    }
    let engine =
        CaptureEngine::start_with_sources(workspace, matter_id, matter_folder, consent, mic, sys)
            .map_err(|e| e.to_string())?;
    let dir = engine.meeting_dir.clone();
    *guard = Some(engine);
    Ok(dir)
}

pub fn try_begin_global(
    workspace: &Path,
    matter_id: &str,
    matter_folder: &str,
    consent: ConsentRecord,
) -> Result<PathBuf, String> {
    let mic = super::sources::mic_source().map_err(|e| e.to_string())?;
    let sys = super::sources::loopback_source().map_err(|e| e.to_string())?;
    begin_global_with_sources(workspace, matter_id, matter_folder, consent, mic, sys)
}

#[cfg(test)]
pub fn end_global_for_tests() {
    ENGINE.lock().unwrap().take();
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureStartResult {
    pub meeting_dir: String,
    pub started_at: String,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureStopResult {
    pub meeting_dir: String,
    pub audio_path: String,
    pub duration_ms: u64,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureStatus {
    pub recording: bool,
    pub meeting_dir: Option<String>,
    pub elapsed_ms: u64,
}

#[tauri::command]
pub async fn capture_start(
    workspace: String,
    matter_id: String,
    matter_folder: String,
    consent_mode: String,
    consent_note: Option<String>,
) -> Result<CaptureStartResult, String> {
    let consent = ConsentRecord {
        mode: consent_mode,
        confirmed_by: "user".into(),
        confirmed_at: chrono::Utc::now().to_rfc3339(),
        note: consent_note.unwrap_or_default(),
    };
    // Step 3 guard: refuse absolute / traversal / symlink-escape folders BEFORE any FS work.
    super::guard_matter_folder(Path::new(&workspace), &matter_folder).map_err(|e| e.to_string())?;
    let dir = try_begin_global(Path::new(&workspace), &matter_id, &matter_folder, consent)?;
    Ok(CaptureStartResult {
        meeting_dir: dir.to_string_lossy().into_owned(),
        started_at: chrono::Utc::now().to_rfc3339(),
    })
}

#[tauri::command]
pub async fn capture_stop() -> Result<CaptureStopResult, String> {
    let engine = ENGINE.lock().unwrap().take().ok_or("not recording")?;
    let r = engine.stop().map_err(|e| e.to_string())?;
    Ok(CaptureStopResult {
        meeting_dir: r.meeting_dir.to_string_lossy().into_owned(),
        audio_path: r.audio_path.to_string_lossy().into_owned(),
        duration_ms: r.duration_ms,
    })
}

#[tauri::command]
pub async fn capture_status() -> Result<CaptureStatus, String> {
    let guard = ENGINE.lock().unwrap();
    Ok(match guard.as_ref() {
        Some(e) => CaptureStatus {
            recording: true,
            meeting_dir: Some(e.meeting_dir.to_string_lossy().into_owned()),
            elapsed_ms: e.elapsed_ms(),
        },
        None => CaptureStatus { recording: false, meeting_dir: None, elapsed_ms: 0 },
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::capture::sources::FakeSource;
    use tempfile::tempdir;

    #[tokio::test]
    async fn engine_records_both_channels_and_finalizes() {
        let ws = tempdir().unwrap();
        let mic = Box::new(FakeSource::new(vec![vec![100i16; 16_000]]));
        let sys = Box::new(FakeSource::new(vec![vec![-100i16; 32_000]]));
        let engine = CaptureEngine::start_with_sources(
            ws.path(),
            "m-test",
            "Clients/Test Household",
            consent("one-party"),
            mic,
            sys,
        )
        .unwrap();
        let result = engine.stop().unwrap();
        assert!(result.audio_path.exists());
        let r = hound::WavReader::open(&result.audio_path).unwrap();
        assert_eq!(r.spec().channels, 2);
        assert_eq!(r.len(), 32_000 * 2); // padded to the longer channel
        assert!(result.meeting_dir.join(".capture").exists() == false);
        // Manifest breadcrumb must NOT survive finalize.
        assert!(!SessionManifest::path_in(&result.meeting_dir).exists());
    }

    #[test]
    fn second_same_day_meeting_for_same_client_gets_a_disambiguated_folder_not_an_overwrite() {
        let ws = tempdir().unwrap();
        let fake = || Box::new(FakeSource::new(vec![])) as Box<dyn AudioSource>;

        let first = CaptureEngine::start_with_sources(
            ws.path(),
            "m-dup",
            "Clients/Dup Household",
            consent("one-party"),
            fake(),
            fake(),
        )
        .unwrap();
        let first_result = first.stop().unwrap();

        let second = CaptureEngine::start_with_sources(
            ws.path(),
            "m-dup",
            "Clients/Dup Household",
            consent("one-party"),
            fake(),
            fake(),
        )
        .unwrap();
        let second_result = second.stop().unwrap();

        assert_ne!(
            first_result.meeting_dir, second_result.meeting_dir,
            "two same-day meetings for the same client must not share a folder"
        );
        // The first meeting's finalized audio must still be intact — not
        // clobbered by the second meeting's (empty) chunks.
        assert!(first_result.audio_path.exists());
        assert!(second_result.audio_path.exists());
    }

    #[test]
    fn second_start_while_recording_is_rejected() {
        // Drive through the global ENGINE guard used by the Tauri commands,
        // with FakeSource so this doesn't depend on real audio hardware.
        let ws = tempdir().unwrap();
        let fake = || Box::new(FakeSource::new(vec![])) as Box<dyn AudioSource>;
        let ok = begin_global_with_sources(
            ws.path(),
            "m-1",
            "Clients/A",
            consent("one-party"),
            fake(),
            fake(),
        );
        assert!(ok.is_ok(), "got: {ok:?}");
        let err = begin_global_with_sources(
            ws.path(),
            "m-2",
            "Clients/B",
            consent("one-party"),
            fake(),
            fake(),
        );
        assert!(err.unwrap_err().contains("already recording"));
        end_global_for_tests();
    }

    fn consent(mode: &str) -> ConsentRecord {
        ConsentRecord {
            mode: mode.into(),
            confirmed_by: "user".into(),
            confirmed_at: "2026-07-02T00:00:00Z".into(),
            note: String::new(),
        }
    }
}
