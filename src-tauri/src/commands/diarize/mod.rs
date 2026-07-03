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

/// sherpa-onnx's pyannote segmentation + speaker-embedding models require
/// exactly 16 kHz mono input (lantern-diarize hard-rejects anything else —
/// see EXPECTED_SAMPLE_RATE in sidecar-src/lantern-diarize/src/main.rs).
/// Meeting recordings are typically 44.1/48 kHz, so this extractor must
/// resample, not just copy the rate through.
const DIARIZE_SAMPLE_RATE: u32 = 16_000;

/// Chunk size for streaming extraction/resampling, in mono (post-channel-
/// extraction) samples. Bounds memory to well under a megabyte regardless
/// of recording length — reading the whole channel plus a whole resampled
/// copy into memory at once (the prior implementation) needed ~1GB for a
/// 2-hour 48kHz meeting and could freeze the desktop app.
const CHUNK_SAMPLES: usize = 1 << 16; // 65536 samples (~1.4s @ 48kHz)

/// Stereo (L=mic, R=sys) -> mono right channel, resampled to 16 kHz; mono
/// input (imported meetings are single-channel all-sys per Wave 3 Task 11)
/// -> resampled to 16 kHz. Streams the whole pipeline in bounded-size
/// chunks (read -> resample -> write) instead of materializing the entire
/// channel or the entire resampled output in memory.
pub fn extract_system_channel(audio_wav: &Path, out_wav: &Path) -> Result<(), String> {
    let mut reader = hound::WavReader::open(audio_wav).map_err(|e| format!("open {}: {e}", audio_wav.display()))?;
    let spec = reader.spec();
    if spec.channels != 1 && spec.channels != 2 {
        return Err(format!("unsupported channel count: {}", spec.channels));
    }

    let out_spec = hound::WavSpec {
        channels: 1,
        sample_rate: DIARIZE_SAMPLE_RATE,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };
    let mut writer = hound::WavWriter::create(out_wav, out_spec).map_err(|e| format!("create {}: {e}", out_wav.display()))?;

    let mut resampler = ChunkedResampler::new(spec.sample_rate, DIARIZE_SAMPLE_RATE);
    let mut samples = reader.samples::<i16>();
    let mut chunk: Vec<i16> = Vec::with_capacity(CHUNK_SAMPLES);
    loop {
        chunk.clear();
        let mut eof = false;
        while chunk.len() < CHUNK_SAMPLES {
            match spec.channels {
                1 => match samples.next() {
                    Some(Ok(v)) => chunk.push(v),
                    Some(Err(e)) => return Err(e.to_string()),
                    None => {
                        eof = true;
                        break;
                    }
                },
                // Stereo: read the (left, right) pair together so a decode
                // error on EITHER sample is propagated — a prior version
                // used `.filter_map()` keyed on index parity, which silently
                // discarded left-channel read errors instead of surfacing
                // them, letting a truncated/corrupt WAV produce a shifted or
                // partial right channel that diarization would treat as valid.
                _ => match samples.next() {
                    None => {
                        eof = true;
                        break;
                    }
                    Some(left) => {
                        left.map_err(|e| e.to_string())?;
                        match samples.next() {
                            None => {
                                return Err(
                                    "truncated stereo wav: an odd number of interleaved samples (missing the final right-channel value)"
                                        .to_string(),
                                )
                            }
                            Some(right) => chunk.push(right.map_err(|e| e.to_string())?),
                        }
                    }
                },
            }
        }
        for s in resampler.push(&chunk, eof) {
            writer.write_sample(s).map_err(|e| e.to_string())?;
        }
        if eof {
            break;
        }
    }
    writer.finalize().map_err(|e| e.to_string())?;
    Ok(())
}

/// Streaming linear-interpolation resampler. Feed input in successive
/// chunks (stream order) via `push`; each call returns whatever output
/// samples can now be finalized. Carries at most one input sample of state
/// across calls — correct because the interpolation window for output
/// index `i` is always `[idx, idx+1]` where `idx = floor(i / ratio)`, and
/// `idx` only ever needs to look one sample behind the current chunk's
/// start (the previous chunk's last sample). The final `push(chunk, true)`
/// also emits the trailing samples the whole-buffer version produces by
/// clamping to the last index.
struct ChunkedResampler {
    ratio: f64,
    chunk_start: u64,
    carry: Option<i16>,
    next_out: u64,
}

impl ChunkedResampler {
    fn new(from_hz: u32, to_hz: u32) -> Self {
        Self { ratio: f64::from(to_hz) / f64::from(from_hz), chunk_start: 0, carry: None, next_out: 0 }
    }

    fn push(&mut self, chunk: &[i16], is_final: bool) -> Vec<i16> {
        let chunk_end = self.chunk_start + chunk.len() as u64;
        let sample_at = |idx: u64| -> i16 {
            if idx < self.chunk_start {
                self.carry.expect("idx before this chunk must be covered by carry")
            } else {
                chunk[(idx - self.chunk_start) as usize]
            }
        };
        // Only known once the true end of the stream is reached: matches
        // resample_linear's `round(total_len * ratio)`.
        let out_len = is_final.then(|| ((chunk_end as f64) * self.ratio).round() as u64);

        let mut out = Vec::new();
        loop {
            if let Some(limit) = out_len {
                if self.next_out >= limit {
                    break;
                }
            }
            let src_pos = self.next_out as f64 / self.ratio;
            let idx = src_pos.floor() as u64;
            let idx1 = idx + 1;
            if out_len.is_none() && idx1 >= chunk_end {
                break; // idx+1 isn't available yet — wait for the next chunk
            }
            if chunk_end == 0 {
                break; // nothing has ever been read; only reachable when out_len is also 0
            }
            let frac = src_pos - idx as f64;
            let a = sample_at(idx.min(chunk_end - 1));
            let b = sample_at(idx1.min(chunk_end - 1));
            out.push((f64::from(a) + (f64::from(b) - f64::from(a)) * frac).round() as i16);
            self.next_out += 1;
        }

        if let Some(&last) = chunk.last() {
            self.carry = Some(last);
        }
        self.chunk_start = chunk_end;
        out
    }
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

    /// Resample a whole in-memory buffer in one shot — the "unchunked"
    /// reference: feeding the entire input as a single final push is
    /// mathematically the same computation the old whole-buffer
    /// `resample_linear` did, just inlined into `ChunkedResampler`.
    fn resample_whole(samples: &[i16], from_hz: u32, to_hz: u32) -> Vec<i16> {
        ChunkedResampler::new(from_hz, to_hz).push(samples, true)
    }

    #[test]
    fn resample_is_noop_when_rates_match() {
        let s = vec![1i16, 2, 3, 4];
        assert_eq!(resample_whole(&s, 16_000, 16_000), s);
    }

    #[test]
    fn resample_halves_length_on_2x_downsample() {
        let s: Vec<i16> = (0..3200).map(|i| (i % 100) as i16).collect();
        let out = resample_whole(&s, 32_000, 16_000);
        assert!((out.len() as i64 - 1600).abs() <= 1, "got {} expected ~1600", out.len());
    }

    #[test]
    fn chunked_resample_matches_unchunked_reference_on_a_long_input() {
        // A few seconds of a synthetic tone-ish signal, long enough to span
        // several CHUNK_SAMPLES-sized chunks at 48kHz.
        let from_hz = 48_000u32;
        let to_hz = 16_000u32;
        let n = CHUNK_SAMPLES * 5 + 777; // deliberately not a multiple of the chunk size
        let samples: Vec<i16> = (0..n).map(|i| (((i as f64) * 0.05).sin() * 8000.0) as i16).collect();

        let reference = resample_whole(&samples, from_hz, to_hz);

        // Push through in small, irregular chunk sizes to stress boundary
        // handling (not just CHUNK_SAMPLES-aligned chunks).
        let mut resampler = ChunkedResampler::new(from_hz, to_hz);
        let mut out = Vec::new();
        let mut pos = 0usize;
        let chunk_sizes = [37usize, 4096, 100_000, 1, 65_536, 2048];
        let mut cs_iter = chunk_sizes.iter().cycle();
        while pos < samples.len() {
            let size = (*cs_iter.next().unwrap()).min(samples.len() - pos);
            let end = pos + size;
            out.extend(resampler.push(&samples[pos..end], end == samples.len()));
            pos = end;
        }

        assert_eq!(out, reference, "chunked resample must exactly match the unchunked whole-buffer result");
    }

    #[test]
    fn extract_system_channel_resamples_a_48khz_recording_to_16khz() {
        let dir = tempdir().unwrap();
        let src = dir.path().join("audio-48k.wav");
        let dst = dir.path().join("sys-16k.wav");
        let spec = hound::WavSpec { channels: 2, sample_rate: 48_000, bits_per_sample: 16, sample_format: hound::SampleFormat::Int };
        let mut w = hound::WavWriter::create(&src, spec).unwrap();
        for _ in 0..(48_000 * 2 / 100) {
            // 20ms of stereo audio: left silence, right a fixed tone-ish value
            w.write_sample(0i16).unwrap();
            w.write_sample(1234i16).unwrap();
        }
        w.finalize().unwrap();

        extract_system_channel(&src, &dst).unwrap();
        let mut r = hound::WavReader::open(&dst).unwrap();
        assert_eq!(r.spec().channels, 1);
        assert_eq!(r.spec().sample_rate, 16_000);
        // 20ms @ 48kHz stereo -> 20ms @ 16kHz mono ~= 320 samples
        let n = r.samples::<i16>().count();
        assert!((n as i64 - 320).abs() <= 2, "got {n} samples, expected ~320");
    }

    #[test]
    fn extract_system_channel_errors_on_a_truncated_stereo_wav_instead_of_shifting_channels() {
        let dir = tempdir().unwrap();
        let src = dir.path().join("audio-truncated.wav");
        let dst = dir.path().join("sys.wav");
        stereo_wav(&src, 111, 222, 10); // 10 complete (L,R) pairs = 20 interleaved samples
        // Chop off exactly one i16 sample (2 bytes) so the interleaving is
        // odd — a real-world truncated/corrupt recording. Before the fix,
        // `.filter_map()` keyed on index parity would have silently dropped
        // this instead of erroring, quietly shifting the "right channel" it
        // extracted by one sample for everything after the cut.
        let len = std::fs::metadata(&src).unwrap().len();
        let f = std::fs::OpenOptions::new().write(true).open(&src).unwrap();
        f.set_len(len - 2).unwrap();
        drop(f);

        let result = extract_system_channel(&src, &dst);
        assert!(result.is_err(), "a truncated stereo wav must error, not silently produce a shifted/partial channel");
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
