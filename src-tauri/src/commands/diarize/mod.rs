//! Within-channel diarization for meeting transcripts (Wave 4 Track A).
//! Splits Wave 3's far-end "Them" channel into per-voice speakers by mapping
//! sherpa-onnx speaker turns onto transcript segments. Works on
//! serde_json::Value so every Wave 3 field (incl. meta.consent) round-trips
//! byte-identically except the `speaker` strings it rewrites.
use std::path::Path;

pub fn overlap_ms(a: (u64, u64), b: (u64, u64)) -> u64 {
    let start = a.0.max(b.0);
    let end = a.1.min(b.1);
    end.saturating_sub(start)
}

/// Stereo (L=mic, R=sys) -> mono right channel; mono input copied as-is
/// (imported meetings are single-channel all-sys per Wave 3 Task 11).
pub fn extract_system_channel(audio_wav: &Path, out_wav: &Path) -> Result<(), String> {
    let mut reader = hound::WavReader::open(audio_wav).map_err(|e| format!("open {}: {e}", audio_wav.display()))?;
    let spec = reader.spec();
    let out_spec = hound::WavSpec {
        channels: 1,
        sample_rate: spec.sample_rate,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };
    let mut writer = hound::WavWriter::create(out_wav, out_spec).map_err(|e| format!("create {}: {e}", out_wav.display()))?;
    match spec.channels {
        1 => {
            for s in reader.samples::<i16>() {
                writer.write_sample(s.map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
            }
        }
        2 => {
            for (i, s) in reader.samples::<i16>().enumerate() {
                let v = s.map_err(|e| e.to_string())?;
                if i % 2 == 1 {
                    // odd interleaved index = right channel = system loopback
                    writer.write_sample(v).map_err(|e| e.to_string())?;
                }
            }
        }
        n => return Err(format!("unsupported channel count: {n}")),
    }
    writer.finalize().map_err(|e| e.to_string())?;
    Ok(())
}

/// Rewrite `speaker` on sys-channel segments to the diarized speaker label
/// with the greatest ms overlap. Returns how many segments changed.
pub fn assign_speakers(
    transcript: &mut serde_json::Value,
    turns_by_speaker: &[(String, Vec<(u64, u64)>)],
) -> usize {
    let mut updated = 0usize;
    let Some(segments) = transcript.get_mut("segments").and_then(|s| s.as_array_mut()) else {
        return 0;
    };
    for seg in segments {
        if seg.get("channel").and_then(|c| c.as_str()) != Some("sys") {
            continue;
        }
        let (Some(start), Some(end)) = (
            seg.get("startMs").and_then(serde_json::Value::as_u64),
            seg.get("endMs").and_then(serde_json::Value::as_u64),
        ) else {
            continue;
        };
        let mut best: Option<(&str, u64)> = None;
        for (label, turns) in turns_by_speaker {
            let total: u64 = turns.iter().map(|&t| overlap_ms((start, end), t)).sum();
            if total > 0 && best.map_or(true, |(_, b)| total > b) {
                best = Some((label, total));
            }
        }
        if let Some((label, _)) = best {
            seg["speaker"] = serde_json::Value::String(label.to_string());
            updated += 1;
        }
    }
    updated
}

use std::collections::HashMap;

/// Rewrite speaker labels on sys-channel segments per an advisor-supplied
/// name map (e.g. "Speaker 2" -> "Sarah Henderson"). Mic segments are never
/// touched. Returns how many segments changed.
pub fn rename_speakers(transcript: &mut serde_json::Value, renames: &HashMap<String, String>) -> usize {
    let mut updated = 0usize;
    let Some(segments) = transcript.get_mut("segments").and_then(|s| s.as_array_mut()) else {
        return 0;
    };
    for seg in segments {
        if seg.get("channel").and_then(|c| c.as_str()) != Some("sys") {
            continue;
        }
        let Some(current) = seg.get("speaker").and_then(|s| s.as_str()) else { continue };
        if let Some(new_name) = renames.get(current) {
            seg["speaker"] = serde_json::Value::String(new_name.clone());
            updated += 1;
        }
    }
    updated
}

fn read_transcript(meeting_dir: &Path) -> Result<serde_json::Value, String> {
    let p = meeting_dir.join("transcript.json");
    let raw = std::fs::read(&p).map_err(|e| format!("read {}: {e}", p.display()))?;
    serde_json::from_slice(&raw).map_err(|e| format!("parse transcript.json: {e}"))
}

fn write_transcript(meeting_dir: &Path, transcript: &serde_json::Value) -> Result<(), String> {
    let p = meeting_dir.join("transcript.json");
    let bytes = serde_json::to_vec_pretty(transcript).map_err(|e| e.to_string())?;
    lantern_vault::atomic::atomic_write(&p, &bytes).map_err(|e| format!("write transcript: {e}"))
}

/// Locate the bundled sidecar + models. Mirrors resolve_sidecar_path
/// (commands/voice.rs) and resolve_voice_model (commands/tts.rs):
/// resource_dir first, dev-tree fallback.
fn resolve_diarize_assets(app: &tauri::AppHandle) -> Result<(std::path::PathBuf, std::path::PathBuf, std::path::PathBuf), String> {
    use tauri::Manager;
    let bin_name = if cfg!(windows) { "lantern-diarize.exe" } else { "lantern-diarize" };
    let mut roots: Vec<std::path::PathBuf> = Vec::new();
    if let Ok(res) = app.path().resource_dir() {
        roots.push(res);
    }
    if let Ok(cwd) = std::env::current_dir() {
        roots.push(cwd.join("src-tauri"));
        roots.push(cwd); // when cwd is already src-tauri in dev
    }
    for root in &roots {
        let bin = root.join("binaries").join(bin_name);
        let seg = root.join("resources").join("diarize").join("segmentation.onnx");
        let emb = root.join("resources").join("diarize").join("embedding.onnx");
        if bin.exists() && seg.exists() && emb.exists() {
            return Ok((bin, seg, emb));
        }
    }
    Err("Speaker separation is not available: the diarize sidecar or its models were not found. Run: npm run fetch-diarize-models && npm run build-diarize-sidecar".to_string())
}

/// Reject a renderer-supplied meeting folder that resolves outside the
/// active workspace (traversal / symlink escape / wrong-workspace bug),
/// before either command touches the filesystem inside it. Mirrors the
/// canonicalize-and-contain check `commands::vault::resolve_and_guard` uses
/// for workspace-relative paths, adapted for an absolute directory that
/// must already exist (both callers require it to: `diarize_meeting` needs
/// `audio.wav` inside it, `apply_speaker_names` needs `transcript.json`).
fn ensure_within_workspace(workspace_root: &Path, dir: &Path) -> Result<(), String> {
    let canon_root = workspace_root
        .canonicalize()
        .map_err(|e| format!("cannot resolve the active workspace: {e}"))?;
    let canon_dir = dir
        .canonicalize()
        .map_err(|e| format!("cannot resolve this meeting folder: {e}"))?;
    if !canon_dir.starts_with(&canon_root) {
        return Err("This meeting folder is outside the active workspace.".to_string());
    }
    Ok(())
}

/// Refuse to proceed if `path` already exists as a symlink (checked with
/// `symlink_metadata`, which — unlike `exists()`/`metadata()` — does NOT
/// follow the link). A crafted workspace could otherwise pre-place a
/// symlink at our temp-file path; writing through it would clobber a file
/// outside the workspace even though `meeting_dir` itself passed the
/// containment check. A path that doesn't exist at all is fine.
fn reject_existing_symlink(path: &Path) -> Result<(), String> {
    match std::fs::symlink_metadata(path) {
        Ok(meta) if meta.file_type().is_symlink() => {
            Err(format!("refusing to write through an existing symlink at {}", path.display()))
        }
        Ok(_) => Err(format!("refusing to overwrite an existing file at {}", path.display())),
        Err(_) => Ok(()), // doesn't exist — the common case
    }
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeakerWire {
    pub label: String,
    pub turn_count: usize,
    pub total_ms: u64,
    pub centroid: Vec<f32>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiarizeMeetingResult {
    pub speakers: Vec<SpeakerWire>,
    pub updated_segments: usize,
    pub dims: usize,
}

#[tauri::command]
pub async fn diarize_meeting(
    app: tauri::AppHandle,
    workspace_root: String,
    meeting_dir: String,
    num_speakers: Option<u32>,
) -> Result<DiarizeMeetingResult, String> {
    let dir = std::path::PathBuf::from(&meeting_dir);
    let audio = dir.join("audio.wav");
    if !audio.exists() {
        return Err("The recording for this meeting is no longer on disk (removed by your retention policy), so speakers cannot be separated.".to_string());
    }
    ensure_within_workspace(Path::new(&workspace_root), &dir)?;
    let (bin, seg, emb) = resolve_diarize_assets(&app)?;
    // Extract the far-end channel next to the meeting (cleaned up after).
    // Randomized (not the fixed `.diarize-sys.wav`) so a workspace can't
    // pre-place a symlink at a name it knows we'll write to, and refused
    // outright if something already exists there (extract_system_channel's
    // hound::WavWriter::create follows symlinks — it must never get the
    // chance to write through one out of the workspace).
    let sys_wav = dir.join(format!(".diarize-sys-{}.wav", rand::random::<u64>()));
    reject_existing_symlink(&sys_wav)?;
    let extract_audio = audio.clone();
    let extract_out = sys_wav.clone();
    let extraction = tokio::task::spawn_blocking(move || extract_system_channel(&extract_audio, &extract_out))
        .await
        .map_err(|e| e.to_string())
        .and_then(|r| r);
    if let Err(e) = extraction {
        // A failed extraction (corrupt WAV, unsupported channel count, disk
        // error) can still have created a partial file before erroring out;
        // clean it up here too, not only on the success path below, so a
        // hidden copy of meeting audio never survives a failure.
        let _ = std::fs::remove_file(&sys_wav);
        return Err(e);
    }

    let sidecar = crate::sidecars::DiarizeSidecar::new(bin, seg, emb);
    let result = sidecar.diarize(&sys_wav, num_speakers).await;
    let _ = std::fs::remove_file(&sys_wav); // best-effort temp cleanup, both paths
    let output = result.map_err(|e| e.to_string())?;

    let turns: Vec<(String, Vec<(u64, u64)>)> = output
        .speakers
        .iter()
        .map(|s| (s.label.clone(), s.turns.iter().map(|t| (t.start_ms, t.end_ms)).collect()))
        .collect();
    let mut transcript = read_transcript(&dir)?;
    let updated_segments = assign_speakers(&mut transcript, &turns);
    write_transcript(&dir, &transcript)?;

    Ok(DiarizeMeetingResult {
        speakers: output
            .speakers
            .into_iter()
            .map(|s| SpeakerWire {
                label: s.label,
                turn_count: s.turns.len(),
                total_ms: s.turns.iter().map(|t| t.end_ms - t.start_ms).sum(),
                centroid: s.centroid,
            })
            .collect(),
        updated_segments,
        dims: output.dims,
    })
}

#[tauri::command]
pub async fn apply_speaker_names(
    workspace_root: String,
    meeting_dir: String,
    renames: HashMap<String, String>,
) -> Result<usize, String> {
    let dir = std::path::PathBuf::from(&meeting_dir);
    ensure_within_workspace(Path::new(&workspace_root), &dir)?;
    tokio::task::spawn_blocking(move || {
        let mut transcript = read_transcript(&dir)?;
        let n = rename_speakers(&mut transcript, &renames);
        write_transcript(&dir, &transcript)?;
        Ok(n)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn overlap_math() {
        assert_eq!(overlap_ms((0, 100), (50, 150)), 50);
        assert_eq!(overlap_ms((0, 100), (100, 200)), 0);
        assert_eq!(overlap_ms((10, 20), (0, 100)), 10);
    }

    fn stereo_wav(path: &std::path::Path, left: i16, right: i16, samples: usize) {
        let spec = hound::WavSpec { channels: 2, sample_rate: 16_000, bits_per_sample: 16, sample_format: hound::SampleFormat::Int };
        let mut w = hound::WavWriter::create(path, spec).unwrap();
        for _ in 0..samples {
            w.write_sample(left).unwrap();
            w.write_sample(right).unwrap();
        }
        w.finalize().unwrap();
    }

    #[test]
    fn extracts_right_channel_as_mono() {
        let dir = tempdir().unwrap();
        let src = dir.path().join("audio.wav");
        let dst = dir.path().join("sys.wav");
        stereo_wav(&src, 0, 9999, 1600);
        extract_system_channel(&src, &dst).unwrap();
        let mut r = hound::WavReader::open(&dst).unwrap();
        assert_eq!(r.spec().channels, 1);
        let first: i16 = r.samples::<i16>().next().unwrap().unwrap();
        assert_eq!(first, 9999); // right channel, not left
    }

    fn transcript_fixture() -> serde_json::Value {
        serde_json::json!({
            "segments": [
                { "startMs": 0,     "endMs": 4000,  "channel": "mic", "speaker": "You",  "text": "welcome" },
                { "startMs": 4000,  "endMs": 9000,  "channel": "sys", "speaker": "Them", "text": "thanks" },
                { "startMs": 9000,  "endMs": 15000, "channel": "sys", "speaker": "Them", "text": "we want a 529" },
                { "startMs": 15000, "endMs": 16000, "channel": "sys", "speaker": "Them", "text": "hm" }
            ],
            "meta": { "startedAt": "t0", "durationMs": 16000, "matterId": "m-1", "consent": { "mode": "one-party" } }
        })
    }

    #[test]
    fn assigns_sys_segments_by_max_overlap_and_leaves_mic_alone() {
        let mut t = transcript_fixture();
        let turns = vec![
            ("Speaker 1".to_string(), vec![(4000u64, 9500u64)]),
            ("Speaker 2".to_string(), vec![(9500u64, 15000u64)]),
        ];
        let updated = assign_speakers(&mut t, &turns);
        assert_eq!(updated, 2); // third sys segment (15000-16000) overlaps nothing
        let segs = t["segments"].as_array().unwrap();
        assert_eq!(segs[0]["speaker"], "You");        // mic untouched
        assert_eq!(segs[1]["speaker"], "Speaker 1");
        assert_eq!(segs[2]["speaker"], "Speaker 2");  // 5500ms overlap beats 500ms
        assert_eq!(segs[3]["speaker"], "Them");       // no overlap -> unchanged
        assert_eq!(t["meta"]["consent"]["mode"], "one-party"); // meta preserved
    }

    #[test]
    fn rename_speakers_touches_only_matching_sys_segments() {
        let mut t = transcript_fixture();
        // pre-assign so there is something to rename
        let turns = vec![("Speaker 1".to_string(), vec![(4000u64, 15000u64)])];
        assign_speakers(&mut t, &turns);
        let mut renames = std::collections::HashMap::new();
        renames.insert("Speaker 1".to_string(), "Sarah Henderson".to_string());
        let n = rename_speakers(&mut t, &renames);
        assert_eq!(n, 2);
        let segs = t["segments"].as_array().unwrap();
        assert_eq!(segs[0]["speaker"], "You"); // mic never renamed
        assert_eq!(segs[1]["speaker"], "Sarah Henderson");
        assert_eq!(segs[2]["speaker"], "Sarah Henderson");
    }

    #[test]
    fn ensure_within_workspace_accepts_nested_dir_and_rejects_outside() {
        let ws = tempdir().unwrap();
        let meeting = ws.path().join("ClientA").join("Meetings").join("2026-07-03");
        std::fs::create_dir_all(&meeting).unwrap();
        assert!(ensure_within_workspace(ws.path(), &meeting).is_ok());

        let other = tempdir().unwrap();
        assert!(
            ensure_within_workspace(ws.path(), other.path()).is_err(),
            "a folder outside the workspace must be rejected"
        );
    }

    #[test]
    fn ensure_within_workspace_rejects_missing_dir() {
        let ws = tempdir().unwrap();
        let missing = ws.path().join("does-not-exist");
        assert!(ensure_within_workspace(ws.path(), &missing).is_err());
    }

    #[test]
    fn reject_existing_symlink_allows_missing_path() {
        let dir = tempdir().unwrap();
        assert!(reject_existing_symlink(&dir.path().join("nothing-here.wav")).is_ok());
    }

    #[test]
    fn reject_existing_symlink_rejects_plain_file_too() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("already-here.wav");
        std::fs::write(&path, b"x").unwrap();
        assert!(reject_existing_symlink(&path).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn reject_existing_symlink_rejects_a_symlink() {
        let dir = tempdir().unwrap();
        let outside = tempdir().unwrap();
        let target = outside.path().join("clobber-me");
        std::fs::write(&target, b"do not touch").unwrap();
        let link = dir.path().join("sneaky.wav");
        std::os::unix::fs::symlink(&target, &link).unwrap();
        assert!(reject_existing_symlink(&link).is_err());
        // the guard must not have followed the link and mutated the target
        assert_eq!(std::fs::read(&target).unwrap(), b"do not touch");
    }
}
