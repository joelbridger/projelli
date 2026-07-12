use super::chunks::AsyncChunkWriter;
use super::session::{finalize_session, ConsentRecord, SessionManifest};
use super::sources::AudioSource;
use crate::commands::pathguard::display_path;
use crate::util::sync::lock_unpoison;
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
    workspace: PathBuf,
    meeting_dir: PathBuf,
    matter_id: String,
    mic: Box<dyn AudioSource>,
    sys: Box<dyn AudioSource>,
    /// Each channel's disk writer runs on its own dedicated thread — see
    /// `AsyncChunkWriter`'s doc — so the real-time audio callback never
    /// blocks on the flush+fsync `ChunkWriter::write` always does. Held here
    /// (not just locally in `start_sources_and_manifest`) so `stop()` can
    /// explicitly drain and join them, in order, before `finalize_session`
    /// reads the chunk files back.
    mic_writer: AsyncChunkWriter,
    sys_writer: AsyncChunkWriter,
    started: Instant,
    _awake: Option<keepawake::KeepAwake>,
    /// First chunk-write error from either channel, if any. Populated from
    /// the writer threads (`AsyncChunkWriter::spawn`'s loop), not the audio
    /// callback itself — silently dropping a write failure (disk full,
    /// permissions changed, rotate/flush error) would let `stop()` return a
    /// normal-looking `audio.wav` path even though part of the meeting was
    /// never actually written to disk. `stop()` checks this and fails
    /// loudly instead.
    write_error: Arc<Mutex<Option<String>>>,
}

/// Keeps `_` alongside alphanumerics and `-` (both are safe filename
/// characters on Windows/macOS/Linux). Real matter ids are generated as
/// `matter_<uuid>` (`src/platform/matter/matterStore.ts`'s `generateMatterId`)
/// — dropping the underscore would make the folder-name slug a LOSSY
/// encoding of the matter id, which `transcribe.rs::load_meta_for`'s
/// folder-name fallback (used whenever `meeting.json` hasn't been written
/// yet) relies on being reversible to scope a reconstructed transcript to
/// the correct client.
fn slugify(matter_id: &str) -> String {
    matter_id.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_').collect()
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
        match Self::start_sources_and_manifest(
            &meeting_dir,
            &cap,
            matter_id,
            consent,
            &mut mic,
            &mut sys,
        ) {
            Ok((write_error, mic_writer, sys_writer)) => {
                let awake = keepawake::Builder::default()
                    .display(false)
                    .idle(true)
                    .sleep(true)
                    .reason("Recording a client meeting")
                    .create()
                    .ok();
                Ok(Self {
                    workspace: workspace.to_path_buf(),
                    meeting_dir,
                    matter_id: matter_id.to_string(),
                    mic,
                    sys,
                    mic_writer,
                    sys_writer,
                    started: Instant::now(),
                    _awake: awake,
                    write_error,
                })
            }
            Err(e) => {
                // A failure here (e.g. no Linux monitor device, missing
                // macOS sidecar/permission) must not leave a phantom
                // `.capture/session.json` behind — capture never actually
                // started, so find_orphans must never later report this
                // directory as a crashed meeting to recover.
                let _ = mic.stop();
                let _ = sys.stop();
                let _ = std::fs::remove_dir_all(&meeting_dir);
                Err(e)
            }
        }
    }

    #[allow(clippy::type_complexity)]
    fn start_sources_and_manifest(
        meeting_dir: &Path,
        cap: &Path,
        matter_id: &str,
        consent: ConsentRecord,
        mic: &mut Box<dyn AudioSource>,
        sys: &mut Box<dyn AudioSource>,
    ) -> Result<(Arc<Mutex<Option<String>>>, AsyncChunkWriter, AsyncChunkWriter)> {
        std::fs::create_dir_all(cap)?;
        SessionManifest {
            meeting_dir: meeting_dir.to_path_buf(),
            matter_id: matter_id.to_string(),
            started_at: chrono::Utc::now().to_rfc3339(),
            consent,
        }
        .save()?;

        let write_error: Arc<Mutex<Option<String>>> = Arc::new(Mutex::new(None));
        // Each channel's ChunkWriter lives on its own dedicated thread — see
        // AsyncChunkWriter's doc — so the real-time audio callback below
        // only ever does a cheap, non-blocking channel send, never the
        // flush+fsync disk I/O ChunkWriter::write does on every call.
        let mic_writer = AsyncChunkWriter::spawn(cap, "mic", write_error.clone())?;
        let sys_writer = AsyncChunkWriter::spawn(cap, "sys", write_error.clone())?;
        {
            let tx = mic_writer.sender();
            mic.start(Box::new(move |s| {
                let _ = tx.send(s.to_vec());
            }))?;
        }
        // `AudioSource::start` doesn't return until its stream is confirmed
        // playing (see CpalSource::start's `ready_rx.recv()`), so this is
        // reached strictly AFTER mic is already recording — on macOS,
        // `MacTapSource::start`'s own 300ms permission-check grace period
        // makes that gap large enough to matter. `finalize_session` pairs
        // the two chunk files sample-index-for-sample-index with no
        // timestamp, so without correction every recording would carry a
        // systematic mic/sys channel shift equal to however long sys took
        // to start.
        //
        // The sys callback can't send straight to `sys_writer`'s channel
        // from the moment it's registered: cpal (and the mac sidecar's
        // reader thread) can deliver a first callback before `sys.start()`
        // itself returns, which — sent immediately — would land REAL audio
        // ahead of the gap-padding silence computed below in the channel's
        // FIFO order, backwards from the intended order. `SysStart` gates
        // that: every callback that arrives before the gap is known just
        // buffers in memory instead of sending; once the gap is computed,
        // the padding and any buffered real audio are sent in the correct
        // order in one locked step, and the gate flips open for every
        // callback after that. No race window — this is correct regardless
        // of how the two threads get scheduled.
        enum SysStart {
            Buffering(Vec<i16>),
            Open,
        }
        let sys_start: Arc<Mutex<SysStart>> = Arc::new(Mutex::new(SysStart::Buffering(Vec::new())));
        let mic_ready_at = Instant::now();
        {
            let tx = sys_writer.sender();
            let gate = sys_start.clone();
            if let Err(e) = sys.start(Box::new(move |s| {
                let mut g = lock_unpoison(&gate);
                match &mut *g {
                    SysStart::Buffering(buf) => buf.extend_from_slice(s),
                    SysStart::Open => {
                        let _ = tx.send(s.to_vec());
                    }
                }
            })) {
                // mic already started successfully above and is actively
                // recording via a live callback that holds its own Sender
                // clone into mic_writer's channel. Simply propagating `e`
                // via `?` would drop mic_writer (and sys_writer) right
                // here, and AsyncChunkWriter::drop joins its writer
                // thread — which can never happen while mic's audio thread
                // (and that Sender clone) is still alive, since the channel
                // never closes. That would hang capture_start forever
                // instead of returning this startup error. Stop mic FIRST
                // so its thread — and the Sender clone it holds — is
                // actually gone before mic_writer/sys_writer drop below.
                let _ = mic.stop();
                return Err(e);
            }
        }
        // sys started `gap` after mic did, so sys is MISSING `gap` worth of
        // real audio at its front (mic has genuine content there; sys never
        // captured that window at all). Pad sys's leading edge with silence
        // for the measured gap so both channels represent the same
        // wall-clock start instant — this can't be perfectly sample-
        // accurate against real wall-clock time (OS audio APIs don't offer
        // true cross-device sample sync), but it fixes the systematic
        // whole-recording shift the naive direct-send version had.
        let gap_ms = Instant::now().saturating_duration_since(mic_ready_at).as_millis() as u64;
        let gap_samples = (gap_ms * super::chunks::SAMPLE_RATE as u64) / 1000;
        {
            let mut g = lock_unpoison(&sys_start);
            if let SysStart::Buffering(buffered) = &mut *g {
                let buffered = std::mem::take(buffered);
                if gap_samples > 0 {
                    sys_writer.send(vec![0i16; gap_samples as usize]);
                }
                if !buffered.is_empty() {
                    sys_writer.send(buffered);
                }
            }
            *g = SysStart::Open;
        }
        Ok((write_error, mic_writer, sys_writer))
    }

    pub fn elapsed_ms(&self) -> u64 {
        self.started.elapsed().as_millis() as u64
    }

    /// First write failure seen so far, if any. Surfaced live via
    /// `capture_status` so the UI can warn mid-recording, not just after
    /// the fact.
    pub fn write_error(&self) -> Option<String> {
        lock_unpoison(&self.write_error).clone()
    }

    pub fn stop(mut self) -> Result<StopResult> {
        self.mic.stop()?;
        self.sys.stop()?;
        // Captured right after the sources actually stop producing audio,
        // not after finalize_session below — merging chunks into audio.wav
        // can take real time for a long meeting, and measuring elapsed_ms()
        // after that would make the reported (and audited) duration include
        // stop/finalization time instead of just the captured recording.
        let duration_ms = self.elapsed_ms();
        // Explicit, ordered drop: mic/sys have already stopped (no callback
        // can still be sending), so this closes each writer's channel and
        // blocks until its dedicated thread has drained every queued buffer
        // and finalized+synced its last chunk (AsyncChunkWriter's Drop impl)
        // — BEFORE finalize_session reads the chunk files back. Dropping
        // implicitly at the end of this function instead would run this
        // AFTER finalize_session, too late to matter.
        drop(self.mic_writer);
        drop(self.sys_writer);
        let audio_path = finalize_session(&self.meeting_dir)?;
        // A chunk write failure during recording means part of the meeting
        // was never saved even though finalize_session succeeded on
        // whatever chunks DID make it to disk — fail loudly rather than
        // hand back a normal-looking StopResult that implies a complete
        // recording. audio.wav still exists at this path if the caller
        // wants to recover the partial audio.
        //
        // Read directly off the field (not via `self.write_error()`, which
        // takes `&self`): `mic_writer`/`sys_writer` were partially moved out
        // of `self` above, so a whole-`self` borrow no longer typechecks —
        // only individual untouched fields remain accessible. Must also
        // happen AFTER the drops above, not before: the writer threads can
        // still record a failure while draining their last queued buffers
        // during `drop()`'s own join.
        let write_error = lock_unpoison(&self.write_error).clone();
        if let Some(err) = write_error {
            anyhow::bail!(
                "recording stopped, but part of the audio failed to save ({err}); partial audio at {}",
                audio_path.display()
            );
        }
        Ok(StopResult {
            meeting_dir: self.meeting_dir.clone(),
            audio_path,
            duration_ms,
        })
    }
}

// ---------- global singleton + Tauri commands ------------------------------

/// All three states live behind ONE lock so every transition is atomic. Two
/// separate `Mutex`es (one for "recording", one for "stopping") would leave
/// a window between "take the engine out of the first" and "put the marker
/// into the second" where neither reflects reality — during which a
/// concurrent `capture_start` could begin a second recording against the
/// same devices, or a concurrent `capture_recover` could treat the meeting
/// as a crashed orphan. A single `Mutex<EngineState>` makes "not idle"
/// checks and state transitions the same atomic operation.
enum EngineState {
    Idle,
    Recording(CaptureEngine),
    /// Sources stopped and chunks finalizing; not yet `Idle`. Distinct from
    /// `Recording` so `begin_global_with_sources` can give a clearer error
    /// than "already recording" for the (expected to be brief) window where
    /// the previous meeting is still being written to disk.
    Stopping(PathBuf),
}

static STATE: Mutex<EngineState> = Mutex::new(EngineState::Idle);

/// Resets `STATE` back to `Idle` on drop — covers the success path, the
/// `?`-propagated error path, AND an unexpected panic inside `engine.stop()`,
/// so a `Stopping` marker can never get stuck forever and permanently block
/// both new recordings and recovery of that meeting.
struct StoppingGuard;

impl Drop for StoppingGuard {
    fn drop(&mut self) {
        *lock_unpoison(&STATE) = EngineState::Idle;
    }
}

/// `cargo test` runs test functions concurrently by default; any test that
/// drives the global `STATE` (via `begin_global_with_sources`/
/// `begin_global_with_sources_for_tests`) must hold this for its whole
/// body, or two such tests running in parallel can race each other's
/// "already recording" guard and flake. Not `pub(crate)` — only test code
/// in this module and `recovery.rs`'s test module need it.
#[cfg(test)]
pub(crate) static ENGINE_TEST_LOCK: Mutex<()> = Mutex::new(());

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
    let mut state = lock_unpoison(&STATE);
    match &*state {
        EngineState::Recording(_) => return Err("already recording".into()),
        EngineState::Stopping(_) => {
            return Err("a previous recording is still finalizing".into())
        }
        EngineState::Idle => {}
    }
    let engine =
        CaptureEngine::start_with_sources(workspace, matter_id, matter_folder, consent, mic, sys)
            .map_err(|e| e.to_string())?;
    let dir = engine.meeting_dir.clone();
    *state = EngineState::Recording(engine);
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
    *lock_unpoison(&STATE) = EngineState::Idle;
}

/// Test-only cross-module hook: drives the same global-engine path as
/// `try_begin_global`, but with caller-supplied (fake) sources so other
/// modules' tests (recovery.rs) can exercise "a recording is live" without
/// depending on real audio hardware.
#[cfg(test)]
pub fn begin_global_with_sources_for_tests(
    workspace: &Path,
    matter_id: &str,
    matter_folder: &str,
    consent: ConsentRecord,
    mic: Box<dyn AudioSource>,
    sys: Box<dyn AudioSource>,
) -> Result<PathBuf, String> {
    begin_global_with_sources(workspace, matter_id, matter_folder, consent, mic, sys)
}

/// The meeting directory currently being recorded OR still finalizing, if
/// any. Recovery (`recovery::find_orphans` / `capture_recover`) must never
/// treat this directory as a crashed/orphaned session — it isn't crashed,
/// and finalizing it while it's live (or while the real stop path is
/// already finalizing it) would corrupt or truncate the meeting.
pub fn active_meeting_dir() -> Option<PathBuf> {
    match &*lock_unpoison(&STATE) {
        EngineState::Recording(e) => Some(e.meeting_dir.clone()),
        EngineState::Stopping(dir) => Some(dir.clone()),
        EngineState::Idle => None,
    }
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
    /// First chunk-write failure seen so far this recording, if any (see
    /// `CaptureEngine::write_error`'s doc). The UI should surface this as a
    /// live warning — it means part of the meeting is not being saved.
    pub write_error: Option<String>,
}

/// Build the `payload_json` for a capture audit entry as a full camelCase
/// `AuditEntry` shape, matching the CRM backend's `crm_audit_payload_json`
/// (`commands/crm/commands.rs`) so the frontend's `recordToEntry`/
/// `getAuditEntryMatterScope` round-trip it the same way. Unlike CRM's
/// workspace-wide `allMatters` scope, a capture always belongs to one
/// client, so this carries a real `matter` scope — required for the entry
/// to show up in that client's own confidentiality report, not just the
/// all-matters Activity Log.
fn capture_audit_payload_json(
    id: &str,
    timestamp: &str,
    action: &str,
    description: &str,
    matter_id: &str,
) -> String {
    serde_json::json!({
        "id": id,
        "timestamp": timestamp,
        "action": action,
        "description": description,
        "model": serde_json::Value::Null,
        "inputs": {},
        "outputs": {},
        "userDecision": serde_json::Value::Null,
        "metadata": {
            "auditEventType": action,
            "source": "capture-backend",
            "scope": { "kind": "matter", "matterId": matter_id },
        },
    })
    .to_string()
}

/// Append one capture audit entry (consent confirmed / meeting recorded).
/// Best-effort and non-fatal, matching `append_crm_audit_best_effort`'s
/// precedent: a failure to WRITE the audit trail must not itself block the
/// user from recording (or from getting their already-recorded audio back)
/// — it's logged and swallowed, not propagated as a command error.
pub(crate) async fn append_capture_audit_best_effort(
    workspace: PathBuf,
    matter_id: String,
    action: &'static str,
    description: String,
) {
    if let Err(e) = append_capture_audit(workspace, matter_id, action, description).await {
        log::warn!("capture audit append failed (non-fatal): {e:#}");
    }
}

/// Append one capture audit entry and report any storage/keychain failure to
/// the caller. Command paths that must keep working when audit storage is
/// unavailable deliberately log and swallow this result at their boundary.
pub(crate) async fn append_capture_audit(
    workspace: PathBuf,
    matter_id: String,
    action: &'static str,
    description: String,
) -> anyhow::Result<()> {
    use crate::commands::audit::store::{AuditEntryRecord, EncryptedAuditStore};
    tokio::task::spawn_blocking(move || -> anyhow::Result<()> {
        let store = EncryptedAuditStore::open(&workspace)?;
        let timestamp = chrono::Utc::now().to_rfc3339();
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or_default();
        let mut rng_bytes = [0u8; 4];
        rand::RngCore::fill_bytes(&mut rand::thread_rng(), &mut rng_bytes);
        let id = format!("audit_capture_{nanos}_{}", hex::encode(rng_bytes));
        let payload_json =
            capture_audit_payload_json(&id, &timestamp, action, &description, &matter_id);
        let rec = AuditEntryRecord {
            id,
            timestamp,
            action: action.to_string(),
            description,
            payload_json,
        };
        store.append(&rec)?;
        Ok(())
    })
    .await
    .map_err(|e| anyhow::anyhow!("capture audit task failed: {e}"))?
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
        mode: consent_mode.clone(),
        confirmed_by: "user".into(),
        confirmed_at: chrono::Utc::now().to_rfc3339(),
        note: consent_note.unwrap_or_default(),
    };
    // Step 3 guard: refuse absolute / traversal / symlink-escape folders BEFORE any FS work.
    // Use the CANONICALIZED result as the matter-folder root passed onward
    // (not the raw `matter_folder` string) — `meeting_dir` is derived from
    // whatever root we pass here, and it must land on the exact same bytes
    // that `guard_meeting_path` (used by `capture_recover`) and
    // `find_orphans`'s workspace walk will later compute for the same
    // directory. A raw, non-canonical workspace/matter-folder pairing (e.g.
    // one that resolves through a symlink) would otherwise make
    // `active_meeting_dir()`'s stored path and a later canonicalized lookup
    // disagree, letting `capture_recover` miss that the meeting is live.
    let canon_matter_folder =
        super::guard_matter_folder(Path::new(&workspace), &matter_folder).map_err(|e| e.to_string())?;
    let canon_matter_folder_str =
        canon_matter_folder.to_str().ok_or("matter folder path is not valid UTF-8")?;
    let dir =
        try_begin_global(Path::new(&workspace), &matter_id, canon_matter_folder_str, consent)?;
    // Non-negotiable per the Meeting Artifact Contract: recording consent is
    // an audit fact, not just a manifest field — append it now that the
    // engine has actually started (not before: a failed start never
    // recorded anything, so it shouldn't claim consent was acted on).
    //
    // Action string is "meeting_capture_started" (the plan's declared
    // string, docs/plans/lantern-plus/2026-07-02-wave-3-meeting-capture.md
    // ~line 2378) — NOT a bespoke "meeting_capture_consent". The frontend's
    // RECORDING_ACTIONS set (platform/privacy/attestation.ts), the audit-log
    // icon/label maps (features/audit/auditHomeHelpers.ts,
    // app/shell/common/AuditLog.tsx), and the AuditActionType union
    // (platform/types/audit.ts) only recognize "meeting_capture_started" —
    // a different string here is invisible to attestation/compliance
    // reporting and renders with no icon/label in the Activity Log.
    // Consent mode is kept in the description text below, not lost.
    append_capture_audit_best_effort(
        PathBuf::from(&workspace),
        matter_id.clone(),
        "meeting_capture_started",
        format!("Recording consent confirmed ({consent_mode} mode) for meeting capture"),
    )
    .await;
    Ok(CaptureStartResult {
        meeting_dir: display_path(&dir),
        started_at: chrono::Utc::now().to_rfc3339(),
    })
}

#[tauri::command]
pub async fn capture_stop() -> Result<CaptureStopResult, String> {
    // Atomically take the engine out of `Recording` and mark `Stopping` in
    // the SAME locked section — the whole point of the single-`Mutex`
    // design above is that no other thread can observe a gap where neither
    // state holds true.
    let engine = {
        let mut state = lock_unpoison(&STATE);
        match std::mem::replace(&mut *state, EngineState::Idle) {
            EngineState::Recording(engine) => {
                *state = EngineState::Stopping(engine.meeting_dir.clone());
                engine
            }
            other => {
                *state = other;
                return Err("not recording".into());
            }
        }
    };
    let _stopping_guard = StoppingGuard;
    // Captured before `.stop(self)` consumes `engine` — StopResult doesn't
    // carry matter_id, and the audit entry needs it for the matter scope.
    let workspace = engine.workspace.clone();
    let matter_id = engine.matter_id.clone();
    let r = engine.stop().map_err(|e| e.to_string())?;
    // Non-negotiable per the Meeting Artifact Contract: every completed
    // capture gets a `meeting_recorded` audit row. Only reached on the
    // success path — a write-error stop() already failed loudly above, so
    // it never falsely claims a complete recording was saved.
    append_capture_audit_best_effort(
        workspace,
        matter_id,
        "meeting_recorded",
        format!(
            "Meeting recording saved ({} ms) at {}",
            r.duration_ms,
            display_path(&r.audio_path)
        ),
    )
    .await;
    Ok(CaptureStopResult {
        meeting_dir: display_path(&r.meeting_dir),
        audio_path: display_path(&r.audio_path),
        duration_ms: r.duration_ms,
    })
}

/// QA-35 — a cheap, best-effort check the frontend calls right before
/// `capture_start` so it can warn ("Low disk space — long recordings may not
/// fit") BEFORE a chunk write ever has a chance to actually fail, rather than
/// only reacting after the fact. Reuses the same `fs2::available_space` this
/// codebase already uses for the local-AI model download's own disk-space
/// preflight (`commands/local_llm/model_download.rs::ensure_disk_space`).
/// Takes a path rather than deriving one internally so the frontend can pass
/// the real workspace root it already has — `available_space` only needs
/// SOME existing path on the target volume, not the exact meeting folder
/// (which may not exist yet).
#[tauri::command]
pub fn capture_free_disk_bytes(path: String) -> Result<u64, String> {
    fs2::available_space(Path::new(&path)).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn capture_status() -> Result<CaptureStatus, String> {
    Ok(match &*lock_unpoison(&STATE) {
        EngineState::Recording(e) => CaptureStatus {
            recording: true,
            meeting_dir: Some(display_path(&e.meeting_dir)),
            elapsed_ms: e.elapsed_ms(),
            write_error: e.write_error(),
        },
        EngineState::Stopping(dir) => CaptureStatus {
            recording: true,
            meeting_dir: Some(display_path(dir)),
            elapsed_ms: 0,
            write_error: None,
        },
        EngineState::Idle => {
            CaptureStatus { recording: false, meeting_dir: None, elapsed_ms: 0, write_error: None }
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::capture::sources::FakeSource;
    use tempfile::tempdir;

    /// QA-35 — the low-disk-space preflight must return a real, plausible
    /// free-space figure for an existing path rather than erroring or
    /// silently returning 0/garbage — that's the one thing the frontend's
    /// warning threshold check actually depends on.
    #[test]
    fn capture_free_disk_bytes_returns_a_plausible_value_for_an_existing_path() {
        let dir = tempdir().unwrap();
        let bytes = capture_free_disk_bytes(dir.path().to_str().unwrap().to_string()).unwrap();
        assert!(bytes > 0, "expected nonzero free space on a real filesystem, got {bytes}");
    }

    /// The frontend's `getAuditEntryMatterScope`/`recordToEntry` (see
    /// `src/features/audit/audit-export.ts`) reads `metadata.scope.kind` /
    /// `.matterId` to route an entry into a specific client's confidentiality
    /// report instead of only the all-matters Activity Log — proves this
    /// payload builder produces that exact shape (no I/O, no keychain).
    #[test]
    fn capture_audit_payload_carries_a_matter_scope() {
        let json = capture_audit_payload_json(
            "audit_capture_1",
            "2026-07-03T00:00:00Z",
            "meeting_recorded",
            "Meeting recording saved (1234 ms) at /tmp/x/audio.wav",
            "m-123",
        );
        let v: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(v["action"], "meeting_recorded");
        assert_eq!(v["metadata"]["scope"]["kind"], "matter");
        assert_eq!(v["metadata"]["scope"]["matterId"], "m-123");
    }

    /// Regression for the codex-review finding (2026-07-04): real matter ids
    /// are `matter_<uuid>` (an underscore, not a hyphen, joins the prefix) —
    /// `slugify` must keep that underscore so the folder-name slug remains a
    /// lossless, reversible encoding of the matter id.
    #[test]
    fn slugify_preserves_underscores_in_real_matter_ids() {
        assert_eq!(
            slugify("matter_3fa85f64-5717-4562-b3fc-2c963f66afa6"),
            "matter_3fa85f64-5717-4562-b3fc-2c963f66afa6"
        );
    }

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
        // Padded to the longer channel (32_000 interleaved frames = 64_000
        // total samples). Not an exact equality: the round-13 start-gap
        // alignment fix pads the sys channel's front with silence for
        // whatever gap elapsed between mic.start() and sys.start()
        // returning, and even two back-to-back FakeSource calls (no
        // simulated device delay at all) take a small nonzero, environment-
        // dependent amount of wall-clock time — so a few extra samples of
        // real, correctly-computed padding here is expected, not a bug.
        let len = r.len();
        assert!(
            (32_000 * 2..32_000 * 2 + 4_000).contains(&len),
            "expected ~64_000 samples (+ a small natural start-gap padding), got {len}"
        );
        assert!(result.meeting_dir.join(".capture").exists() == false);
        // Manifest breadcrumb must NOT survive finalize.
        assert!(!SessionManifest::path_in(&result.meeting_dir).exists());
    }

    /// Regression for the codex-review round-13 finding: `sys.start()`
    /// doesn't return until its stream is confirmed playing, so a
    /// slow-to-start system-audio source (macOS's 300ms permission grace
    /// period, or any slow loopback device) used to leave sys's real audio
    /// shifted earlier relative to mic once `finalize_session` pairs the two
    /// channels sample-index-for-sample-index. `DelayedFakeSource` (real
    /// `std::thread::sleep`, no hardware needed) simulates that slow start;
    /// this proves the merged stereo file now has silence padding on the
    /// sys (right) channel's front instead of a systematic shift.
    #[tokio::test]
    async fn slow_starting_sys_source_gets_leading_silence_padding_not_a_channel_shift() {
        use crate::commands::capture::sources::DelayedFakeSource;
        use std::time::Duration;

        let ws = tempdir().unwrap();
        let mic = Box::new(FakeSource::new(vec![vec![100i16; 4_000]]));
        let sys =
            Box::new(DelayedFakeSource::new(Duration::from_millis(150), vec![vec![-100i16; 4_000]]));
        let engine = CaptureEngine::start_with_sources(
            ws.path(),
            "m-align",
            "Clients/Align Household",
            consent("one-party"),
            mic,
            sys,
        )
        .unwrap();
        let result = engine.stop().unwrap();
        let r = hound::WavReader::open(&result.audio_path).unwrap();
        let samples: Vec<i16> = r.into_samples::<i16>().map(|s| s.unwrap()).collect();
        // Interleaved stereo: [L0, R0, L1, R1, ...]. Mic (L) has no gap to
        // pad — its real audio starts immediately at sample 0.
        assert_eq!(samples[0], 100, "mic channel must not be padded/shifted");
        // sys (R) should have real leading silence padding: at 16kHz a
        // 150ms gap is ~2400 samples; assert at least 1000 (62.5ms) of
        // leading silence to leave generous slack for scheduling jitter on
        // a loaded CI/dev box, while still proving padding — not just
        // "R happens to be 0 at index 1" — actually occurred.
        let right_channel: Vec<i16> = samples.iter().skip(1).step_by(2).copied().collect();
        let leading_silence =
            right_channel.iter().take_while(|&&s| s == 0).count();
        assert!(
            leading_silence >= 1_000,
            "expected at least 1000 samples of leading silence on the sys channel, got {leading_silence}"
        );
    }

    /// Regression for the codex-review round-14 finding: a sys source can
    /// deliver its first real callback BEFORE its own `start()` call
    /// returns (real cpal can do this after `stream.play()`, as can the mac
    /// sidecar's reader thread) — the round-13 fix wrote gap padding right
    /// after `sys.start()` returned, so a callback that already fired
    /// during `start()` would have landed real audio on disk BEFORE the
    /// padding, backwards. `SyncDelayedFakeSource` delivers synchronously
    /// before returning — a deterministic reproduction of exactly that
    /// scenario, not a scheduling race — proving the gate now buffers those
    /// samples until the padding is written first, every time.
    #[tokio::test]
    async fn sys_callback_arriving_before_start_returns_is_still_buffered_behind_padding() {
        use crate::commands::capture::sources::SyncDelayedFakeSource;
        use std::time::Duration;

        let ws = tempdir().unwrap();
        let mic = Box::new(FakeSource::new(vec![vec![100i16; 4_000]]));
        let sys = Box::new(SyncDelayedFakeSource::new(
            Duration::from_millis(50),
            vec![vec![-100i16; 4_000]],
        ));
        let engine = CaptureEngine::start_with_sources(
            ws.path(),
            "m-sync-align",
            "Clients/SyncAlign Household",
            consent("one-party"),
            mic,
            sys,
        )
        .unwrap();
        let result = engine.stop().unwrap();
        let r = hound::WavReader::open(&result.audio_path).unwrap();
        let samples: Vec<i16> = r.into_samples::<i16>().map(|s| s.unwrap()).collect();
        let right_channel: Vec<i16> = samples.iter().skip(1).step_by(2).copied().collect();
        let leading_silence = right_channel.iter().take_while(|&&s| s == 0).count();
        assert!(
            leading_silence >= 300,
            "expected real leading silence on the sys channel, got {leading_silence}"
        );
        assert_eq!(
            right_channel[leading_silence], -100,
            "real sys audio must come AFTER the padding, not before it"
        );
    }

    /// Regression for the codex-review round-9 finding: the mic/sys
    /// callbacks used to swallow `ChunkWriter::write` errors with `let _ =`,
    /// so `stop()` could return a normal-looking `StopResult` even though
    /// part of the meeting was never written. `write_error` can't easily be
    /// triggered by a real disk-full/permission failure in a unit test, so
    /// this sets it directly (as if a callback had recorded one) and proves
    /// `stop()` fails loudly and names both the cause and the partial-audio
    /// path, instead of silently succeeding.
    #[test]
    fn stop_fails_loudly_when_a_chunk_write_error_occurred() {
        let ws = tempdir().unwrap();
        let mic = Box::new(FakeSource::new(vec![vec![100i16; 16_000]]));
        let sys = Box::new(FakeSource::new(vec![vec![-100i16; 16_000]]));
        let engine = CaptureEngine::start_with_sources(
            ws.path(),
            "m-writeerr",
            "Clients/WriteErr Household",
            consent("one-party"),
            mic,
            sys,
        )
        .unwrap();
        *lock_unpoison(&engine.write_error) = Some("mic channel: simulated disk full".into());
        let err = match engine.stop() {
            Err(e) => e,
            Ok(_) => panic!("stop() must fail when a chunk write error occurred"),
        };
        assert!(err.to_string().contains("simulated disk full"), "got: {err}");
        assert!(err.to_string().contains("partial audio"), "got: {err}");
    }

    /// Always fails to start — proves a failed sys/mic source doesn't leave
    /// a phantom `.capture/session.json` that `find_orphans` would later
    /// mistake for a crashed (but never-actually-started) meeting.
    struct FailingSource;
    impl AudioSource for FailingSource {
        fn start(&mut self, _: Box<dyn FnMut(&[i16]) + Send>) -> anyhow::Result<()> {
            Err(anyhow!("simulated device failure"))
        }
        fn stop(&mut self) -> anyhow::Result<()> {
            Ok(())
        }
    }

    #[test]
    fn failed_source_start_leaves_no_phantom_meeting_dir() {
        let ws = tempdir().unwrap();
        let mic = Box::new(FakeSource::new(vec![])) as Box<dyn AudioSource>;
        let sys = Box::new(FailingSource) as Box<dyn AudioSource>;
        let result = CaptureEngine::start_with_sources(
            ws.path(),
            "m-fail",
            "Clients/Fail Household",
            consent("one-party"),
            mic,
            sys,
        );
        let err = result.err().expect("start_with_sources must fail when a source fails");
        assert!(err.to_string().contains("simulated device failure"));

        // Nothing should remain under Meetings/ — not the meeting dir, not
        // a lingering .capture/session.json.
        let meetings = ws.path().join("Clients/Fail Household/Meetings");
        let remaining: Vec<_> = std::fs::read_dir(&meetings)
            .map(|d| d.filter_map(|e| e.ok()).collect())
            .unwrap_or_default();
        assert!(remaining.is_empty(), "expected no leftover meeting dirs, got: {remaining:?}");
    }

    /// A source that fails with the exact message `CpalSource::resolve_device`
    /// produces for `DeviceKind::DefaultInput` (see `sources.rs`) when the
    /// host has no usable microphone — the real-world QA-20b repro (no mic
    /// plugged in / permission denied). `failed_source_start_leaves_no_
    /// phantom_meeting_dir` above only exercises a `sys`-side failure; mic
    /// fails at a different point (mic.start()'s `?` propagates before
    /// sys.start(), write_error, or sys_writer are ever touched), so this is
    /// a distinct code path worth its own regression test rather than
    /// assuming symmetry.
    struct NoMicSource;
    impl AudioSource for NoMicSource {
        fn start(&mut self, _: Box<dyn FnMut(&[i16]) + Send>) -> anyhow::Result<()> {
            Err(anyhow!("no microphone device"))
        }
        fn stop(&mut self) -> anyhow::Result<()> {
            Ok(())
        }
    }

    #[test]
    fn failed_mic_start_leaves_no_orphan_meeting_dir_and_surfaces_the_error() {
        let ws = tempdir().unwrap();
        let mic = Box::new(NoMicSource) as Box<dyn AudioSource>;
        let sys = Box::new(FakeSource::new(vec![])) as Box<dyn AudioSource>;
        let result = CaptureEngine::start_with_sources(
            ws.path(),
            "m-no-mic",
            "Clients/NoMic Household",
            consent("one-party"),
            mic,
            sys,
        );
        let err = result.err().expect("start_with_sources must fail when the mic fails to start");
        assert!(err.to_string().contains("no microphone device"), "got: {err}");

        // QA-20b: no orphan folder under Meetings/ left behind on disk.
        let meetings = ws.path().join("Clients/NoMic Household/Meetings");
        let remaining: Vec<_> = std::fs::read_dir(&meetings)
            .map(|d| d.filter_map(|e| e.ok()).collect())
            .unwrap_or_default();
        assert!(remaining.is_empty(), "expected no leftover meeting dirs, got: {remaining:?}");
    }

    /// A source that, unlike `FakeSource`, actually keeps its callback alive
    /// on a dedicated thread until `stop()` is called — the same lifecycle
    /// `CpalSource`/`MacTapSource` really have (the closure lives inside a
    /// live stream/reader thread, holding whatever it captured, until
    /// explicitly stopped). `FakeSource`'s callback runs synchronously
    /// inside `start()` and is dropped the moment `start()` returns, so it
    /// can never reproduce the round-17 deadlock below — this fake can.
    struct PersistentFakeSource {
        stop_tx: Option<std::sync::mpsc::Sender<()>>,
        join: Option<std::thread::JoinHandle<()>>,
    }
    impl PersistentFakeSource {
        fn new() -> Self {
            Self { stop_tx: None, join: None }
        }
    }
    impl AudioSource for PersistentFakeSource {
        fn start(&mut self, on_samples: Box<dyn FnMut(&[i16]) + Send>) -> anyhow::Result<()> {
            let (stop_tx, stop_rx) = std::sync::mpsc::channel::<()>();
            let join = std::thread::spawn(move || {
                // Keep `on_samples` (and whatever Sender it captured) alive
                // until told to stop — never actually calls it, since this
                // test only cares about the callback's LIFETIME, not
                // delivering audio.
                let _on_samples = on_samples;
                let _ = stop_rx.recv();
            });
            self.stop_tx = Some(stop_tx);
            self.join = Some(join);
            Ok(())
        }
        fn stop(&mut self) -> anyhow::Result<()> {
            if let Some(tx) = self.stop_tx.take() {
                let _ = tx.send(());
            }
            if let Some(j) = self.join.take() {
                let _ = j.join();
            }
            Ok(())
        }
    }

    /// Regression for the codex-review round-17 finding: if mic starts
    /// successfully but sys then fails to start (no Linux monitor device,
    /// missing macOS sidecar, etc.), the old code just propagated sys's
    /// error via `?` — dropping `mic_writer`/`sys_writer` right there.
    /// `AsyncChunkWriter::drop` joins its writer thread, but mic's audio
    /// thread (and the Sender clone its live callback holds) was still
    /// running, so the channel could never close and `join()` — and
    /// therefore `capture_start` itself — would hang forever instead of
    /// returning the startup error. Runs `start_with_sources` on its own
    /// thread with a bounded `recv_timeout` specifically so a real
    /// regression fails this test (and the whole suite) fast instead of
    /// hanging it — `FakeSource` can't reproduce this (see
    /// `PersistentFakeSource`'s doc), so this needs a source with a real
    /// persistent background thread.
    #[test]
    fn failed_sys_start_after_successful_mic_start_does_not_deadlock() {
        let ws = tempdir().unwrap();
        let ws_path = ws.path().to_path_buf();
        let (done_tx, done_rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let mic = Box::new(PersistentFakeSource::new()) as Box<dyn AudioSource>;
            let sys = Box::new(FailingSource) as Box<dyn AudioSource>;
            let result = CaptureEngine::start_with_sources(
                &ws_path,
                "m-deadlock",
                "Clients/Deadlock Household",
                consent("one-party"),
                mic,
                sys,
            );
            let _ = done_tx.send(result.err().map(|e| e.to_string()));
        });
        match done_rx.recv_timeout(std::time::Duration::from_secs(5)) {
            Ok(Some(msg)) => assert!(msg.contains("simulated device failure"), "got: {msg}"),
            Ok(None) => panic!("expected start_with_sources to return an error"),
            Err(_) => panic!(
                "start_with_sources did not return within 5s — regression of the round-17 \
                 deadlock: mic succeeded and kept running, sys failed to start, and \
                 AsyncChunkWriter::drop hung joining the writer thread because mic's Sender \
                 clone was still alive"
            ),
        }
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
        // Serialized against other ENGINE-touching tests (cargo test runs
        // tests concurrently by default) — see ENGINE_TEST_LOCK's doc.
        let _guard = lock_unpoison(&ENGINE_TEST_LOCK);
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

    /// Regression for the codex-review round-8 finding: `capture_stop` must
    /// take the engine out of `ENGINE` before it can call the by-value
    /// `.stop(self)`, which would otherwise make `active_meeting_dir()`
    /// report `None` (recoverable) while the real stop path is still
    /// finalizing chunks on disk — a window `capture_recover` could race.
    /// `STOPPING` closes that window; this proves the mechanism directly
    /// (deterministic, no timing dependency on a slow fake stop()).
    #[test]
    fn active_meeting_dir_reports_stopping_session_and_resets_on_guard_drop() {
        let _guard = lock_unpoison(&ENGINE_TEST_LOCK);
        assert!(matches!(&*lock_unpoison(&STATE), EngineState::Idle));
        assert_eq!(active_meeting_dir(), None);

        let dir = PathBuf::from("/tmp/lp-w4-test-stopping-meeting");
        *lock_unpoison(&STATE) = EngineState::Stopping(dir.clone());
        let stopping_guard = StoppingGuard;
        assert_eq!(
            active_meeting_dir(),
            Some(dir),
            "must report the stopping session even though it's no longer Recording"
        );
        drop(stopping_guard);
        assert_eq!(active_meeting_dir(), None, "StoppingGuard::drop must reset STATE to Idle");
    }

    /// Regression for the codex-review round-8 finding: the old two-`Mutex`
    /// design (`ENGINE` + a separate `STOPPING`) only blocked a NEW
    /// `capture_start` by checking `ENGINE`, not `STOPPING` — so a start
    /// issued while the previous meeting was still finalizing could begin a
    /// second recording against the same audio devices. The single
    /// `Mutex<EngineState>` design makes `Stopping` a real "not idle" state
    /// that `begin_global_with_sources` refuses to start over.
    #[test]
    fn start_is_rejected_while_a_previous_recording_is_still_stopping() {
        let _guard = lock_unpoison(&ENGINE_TEST_LOCK);
        *lock_unpoison(&STATE) = EngineState::Stopping(PathBuf::from("/tmp/lp-w4-test-stopping"));

        let ws = tempdir().unwrap();
        let fake = || Box::new(FakeSource::new(vec![])) as Box<dyn AudioSource>;
        let err = begin_global_with_sources(
            ws.path(),
            "m-new",
            "Clients/New",
            consent("one-party"),
            fake(),
            fake(),
        );
        assert!(
            err.unwrap_err().contains("still finalizing"),
            "a start while the previous meeting is Stopping must be rejected, not silently allowed"
        );

        end_global_for_tests();
    }

    /// Regression for the codex-review round-8 finding: `capture_recover`
    /// canonicalizes the meeting path it's handed via `guard_meeting_path`,
    /// but `active_meeting_dir()` used to return whatever raw
    /// `workspace.join(matter_folder)` path `start_with_sources` was given
    /// — if the workspace or matter folder resolved through a symlink,
    /// those two paths could differ even though they name the same
    /// directory, so `recover()`'s equality check would miss that the
    /// meeting is live and finalize a still-recording session. `capture_start`
    /// now passes `guard_matter_folder`'s CANONICAL result onward instead of
    /// the raw string, so the stored `meeting_dir` already matches what a
    /// later `guard_meeting_path` canonicalization produces.
    #[cfg(unix)]
    #[test]
    fn active_meeting_dir_matches_a_canonicalized_recover_lookup_through_a_symlinked_workspace() {
        let _guard = lock_unpoison(&ENGINE_TEST_LOCK);
        let real_ws = tempdir().unwrap();
        std::fs::create_dir_all(real_ws.path().join("Clients/Sym Household")).unwrap();
        let link_root = tempdir().unwrap();
        let ws_alias = link_root.path().join("workspace-link");
        std::os::unix::fs::symlink(real_ws.path(), &ws_alias).unwrap();

        // Mirrors capture_start: canonicalize the matter folder through the
        // symlinked workspace alias before starting the engine with it.
        let canon_matter_folder =
            super::super::guard_matter_folder(&ws_alias, "Clients/Sym Household").unwrap();
        let fake = || Box::new(FakeSource::new(vec![])) as Box<dyn AudioSource>;
        let started_dir = begin_global_with_sources_for_tests(
            &ws_alias,
            "m-sym",
            canon_matter_folder.to_str().unwrap(),
            consent("one-party"),
            fake(),
            fake(),
        )
        .unwrap();

        // Mirrors capture_recover: guard_meeting_path canonicalizes whatever
        // meeting-dir string the frontend got back from capture_start.
        let recover_lookup = super::super::guard_meeting_path(&ws_alias, &started_dir).unwrap();

        assert_eq!(
            active_meeting_dir(),
            Some(recover_lookup),
            "a canonicalized recover lookup must exactly match the stored active meeting dir"
        );

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
