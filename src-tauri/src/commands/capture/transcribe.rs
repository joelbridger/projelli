//! Long-form local transcription. The bundled sidecar caps a single request
//! at 30 s (src-tauri/src/commands/voice.rs:38); we window at 25 s with 2 s
//! overlap and merge. LOCAL ONLY: the only WindowTranscriber is the sidecar.
use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::path::Path;

pub const WINDOW_SECONDS: u32 = 25;
pub const OVERLAP_SECONDS: u32 = 2;
pub const SILENCE_RMS: f64 = 0.008;

pub trait WindowTranscriber: Send + Sync {
    fn transcribe_window(&self, wav_bytes: Vec<u8>) -> Result<String>;
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Segment {
    pub start_ms: u64,
    pub end_ms: u64,
    pub channel: String, // "mic" | "sys"  (schema field name: channel)
    pub speaker: String, // "You" | "Them" (v1; Wave 4 replaces per-voice)
    pub text: String,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptMeta {
    pub started_at: String,
    pub matter_id: String,
    pub consent: super::session::ConsentRecord,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TranscriptFile<'a> {
    segments: &'a [Segment],
    meta: MetaOut<'a>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MetaOut<'a> {
    started_at: &'a str,
    duration_ms: u64,
    matter_id: &'a str,
    consent: &'a super::session::ConsentRecord,
}

#[derive(Serialize, Deserialize, Default)]
struct Progress {
    done: Vec<String>,
    #[serde(default)]
    partial: Vec<Segment>,
}

/// Write-then-rename so a crash mid-write can never leave a truncated,
/// unparseable progress journal on disk — `transcribe_meeting_audio` would
/// otherwise silently fall back to an empty `Progress` on the next run and
/// re-transcribe an entire long meeting from scratch. `rename` is atomic
/// within a directory on every platform this app targets, and the temp file
/// lives alongside the real one so both are guaranteed to be on the same
/// filesystem.
fn write_progress_atomically(path: &Path, progress: &Progress) -> Result<()> {
    let tmp_name = format!(
        "{}.tmp",
        path.file_name().and_then(|n| n.to_str()).unwrap_or(".transcribe-progress.json")
    );
    let tmp = path.with_file_name(tmp_name);
    std::fs::write(&tmp, serde_json::to_vec(progress)?)?;
    std::fs::rename(&tmp, path)?;
    Ok(())
}

fn rms(samples: &[i16]) -> f64 {
    if samples.is_empty() {
        return 0.0;
    }
    let sum: f64 = samples
        .iter()
        .map(|&s| {
            let f = s as f64 / 32768.0;
            f * f
        })
        .sum();
    (sum / samples.len() as f64).sqrt()
}

fn wav_mono_bytes(samples: &[i16]) -> Vec<u8> {
    let spec = hound::WavSpec {
        channels: 1,
        sample_rate: super::chunks::SAMPLE_RATE,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };
    let mut cursor = std::io::Cursor::new(Vec::new());
    {
        let mut w = hound::WavWriter::new(&mut cursor, spec).unwrap();
        for s in samples {
            w.write_sample(*s).unwrap();
        }
        w.finalize().unwrap();
    }
    cursor.into_inner()
}

/// Trim overlap duplication: drop leading words of `text` that repeat the
/// trailing words of `prev_text` (up to 8 words).
fn trim_overlap(prev_text: &str, text: &str) -> String {
    let prev: Vec<&str> = prev_text.split_whitespace().collect();
    let cur: Vec<&str> = text.split_whitespace().collect();
    let max = prev.len().min(cur.len()).min(8);
    for k in (1..=max).rev() {
        if prev[prev.len() - k..] == cur[..k] {
            return cur[k..].join(" ");
        }
    }
    text.to_string()
}

/// Reads exactly the `[start_frame, end_frame)` window for one channel out
/// of an interleaved multi-channel WAV, via seek — never reads samples
/// outside the requested window. Generic over any `Read + Seek` source so it
/// can be exercised directly against an in-memory buffer in tests.
fn read_channel_window<R: std::io::Read + std::io::Seek>(
    reader: &mut hound::WavReader<R>,
    start_frame: u64,
    end_frame: u64,
    channel_index: u32,
    channel_count: u32,
) -> Result<Vec<i16>> {
    reader.seek(start_frame as u32)?;
    let frame_count = (end_frame - start_frame) as usize;
    let mut out = Vec::with_capacity(frame_count);
    let samples = reader.samples::<i16>().take(frame_count * channel_count as usize);
    for (idx, s) in samples.enumerate() {
        if idx as u32 % channel_count == channel_index {
            out.push(s?);
        }
    }
    Ok(out)
}

/// Turns `audio.wav` into `transcript.json`, one ≤25 s window at a time.
/// Reads only the current window's samples off disk via seek (`hound`'s
/// `WavReader` never buffers a whole channel, let alone the whole file) —
/// peak memory is bounded by WINDOW_SECONDS regardless of meeting length. A
/// prior version `.collect()`ed every sample into memory and duplicated
/// both channels, which meant a 2-hour meeting (this feature's actual
/// target use case) could approach ~1.8 GB of peak RAM before the sidecar
/// even ran — a real freeze/OOM risk, found in coordinator review.
pub fn transcribe_meeting_audio(
    audio: &Path,
    out: &Path,
    meta: TranscriptMeta,
    t: &dyn WindowTranscriber,
) -> Result<()> {
    let spec = hound::WavReader::open(audio)?.spec();
    anyhow::ensure!(
        (spec.channels == 1 || spec.channels == 2) && spec.sample_rate == super::chunks::SAMPLE_RATE,
        "expected 16 kHz mono or stereo audio.wav"
    );
    let channel_count = spec.channels as u32;
    // Imported audio (single channel) has no mic/sys separation — every
    // segment is attributed to "sys"/"Them" and the UI labels the meeting
    // "imported — speakers not separated" rather than pretending it knows
    // who's speaking.
    let mono = spec.channels == 1;
    let total_frames = hound::WavReader::open(audio)?.duration() as u64;
    let duration_ms = total_frames * 1000 / super::chunks::SAMPLE_RATE as u64;

    let progress_path = audio.parent().unwrap().join(".transcribe-progress.json");
    let mut progress: Progress = std::fs::read(&progress_path)
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default();
    let mut segments: Vec<Segment> = progress.partial.clone();

    let sr = super::chunks::SAMPLE_RATE as u64;
    let step = (WINDOW_SECONDS - OVERLAP_SECONDS) as u64 * sr;
    let win = WINDOW_SECONDS as u64 * sr;

    // (name, speaker, channel index within an interleaved frame)
    let channel_defs: &[(&str, &str, u32)] =
        if mono { &[("sys", "Them", 0)] } else { &[("mic", "You", 0), ("sys", "Them", 1)] };
    for &(channel, speaker, channel_index) in channel_defs {
        let mut reader = hound::WavReader::open(audio)?;
        let mut prev_text = String::new();
        let mut start = 0u64;
        while start < total_frames {
            let start_ms = start * 1000 / sr;
            let key = format!("{channel}:{start_ms}");
            let end = (start + win).min(total_frames);
            if !progress.done.contains(&key) {
                // Only read this window off disk when it isn't already
                // resumed from a prior run — a resumed window's samples are
                // never needed again.
                let window = read_channel_window(&mut reader, start, end, channel_index, channel_count)?;
                // A silent window, or one where the sidecar recognizes no
                // speech, is a real gap in the audio — reset the overlap
                // state so a LATER window's leading words are never trimmed
                // against stale text from before the gap (e.g. dropping a
                // genuine "thanks for joining" because an earlier segment
                // also happened to end in "thanks"). A window whose text is
                // fully consumed by `trim_overlap` (pure repeat of the
                // previous window's tail) is NOT a gap — `prev_text` already
                // reflects that content correctly, so it's left alone.
                if rms(&window) >= SILENCE_RMS {
                    let raw = t.transcribe_window(wav_mono_bytes(&window))?;
                    let raw = raw.trim();
                    if raw.is_empty() {
                        prev_text.clear();
                    } else {
                        let text = trim_overlap(&prev_text, raw);
                        if !text.is_empty() {
                            let seg = Segment {
                                start_ms,
                                end_ms: end * 1000 / sr,
                                channel: channel.to_string(),
                                speaker: speaker.to_string(),
                                text: text.clone(),
                            };
                            prev_text = text;
                            segments.push(seg);
                        }
                    }
                } else {
                    prev_text.clear();
                }
                progress.done.push(key);
                progress.partial = segments.clone();
                write_progress_atomically(&progress_path, &progress)?;
            } else if let Some(s) = segments
                .iter()
                .filter(|s| s.channel == channel && s.start_ms == start_ms)
                .last()
            {
                prev_text = s.text.clone();
            } else {
                // Resumed window was marked done but produced no segment
                // (it was silent/empty last run) — same gap, same reset.
                prev_text.clear();
            }
            start += step;
        }
    }

    segments.sort_by_key(|s| (s.start_ms, s.channel.clone()));
    let file = TranscriptFile {
        segments: &segments,
        meta: MetaOut {
            started_at: &meta.started_at,
            duration_ms,
            matter_id: &meta.matter_id,
            consent: &meta.consent,
        },
    };
    std::fs::write(out, serde_json::to_vec_pretty(&file)?)?;
    let _ = std::fs::remove_file(&progress_path);
    Ok(())
}

/// Wraps the bundled per-request whisper.cpp-family sidecar as a
/// `WindowTranscriber`. The ONLY production impl — there is no remote impl,
/// and none may ever be added (NO cloud transcription, ever).
pub struct SidecarTranscriber {
    binary: std::path::PathBuf,
    models_dir: Option<std::path::PathBuf>,
    model: Option<String>,
}

impl WindowTranscriber for SidecarTranscriber {
    fn transcribe_window(&self, wav_bytes: Vec<u8>) -> Result<String> {
        let sidecar = crate::sidecars::ParakeetSidecar::new(self.binary.clone(), self.models_dir.clone());
        let handle = tokio::runtime::Handle::current();
        let out = handle.block_on(sidecar.transcribe(wav_bytes, self.model.as_deref()))?;
        Ok(out.text)
    }
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscribeMeetingResult {
    pub transcript_path: String,
    pub segment_count: u32,
}

/// Loads meeting metadata for a finalized meeting dir from
/// `<meeting_dir>/meeting.json` (`MeetingMeta`, written by
/// `finalize_session` itself from the real `SessionManifest` — see
/// `session.rs`). Deliberately has NO fallback: consent mode (one-party vs
/// two-party) is a compliance fact, not something safe to guess from a
/// folder name or timestamp. A meeting recorded before this file existed
/// (or one whose write somehow failed) fails transcription with a clear
/// error rather than silently asserting "one-party" — a wrong consent
/// record in a compliance product is worse than a blocked transcript.
pub fn load_meta_for(dir: &Path) -> Result<TranscriptMeta> {
    let meta = super::session::MeetingMeta::load(dir).with_context(|| {
        format!(
            "no meeting.json consent record found for {} — refusing to guess the consent mode. \
             This meeting was recorded before finalize started writing this file, or the write \
             failed. Confirm and record consent manually before transcribing.",
            dir.display()
        )
    })?;
    Ok(TranscriptMeta {
        started_at: meta.started_at,
        matter_id: meta.matter_id,
        consent: meta.consent,
    })
}

/// Tauri command: local, resumable transcription of a finalized meeting's
/// `audio.wav` into `transcript.json`. `meeting_dir` is guarded against
/// path traversal / symlink escape the same way every other dir-input
/// capture command is (`super::guard_meeting_path`) — this is NOT optional,
/// per the crate-wide rule in `capture::mod`'s doc comment.
#[tauri::command]
pub async fn transcribe_meeting(
    app: tauri::AppHandle,
    workspace_root: String,
    meeting_dir: String,
    model: Option<String>,
) -> Result<TranscribeMeetingResult, String> {
    // Guard BEFORE any other filesystem-dependent work (including sidecar
    // resolution) — every dir-input capture command must reject a
    // traversal/symlink-escape meeting_dir before touching disk, not just
    // before touching the workspace itself. Param named `workspace_root` to
    // match the sibling `diarize_meeting`/voiceprint commands in this same
    // meetings surface (`src-tauri/src/commands/diarize/mod.rs`), not
    // `workspace` — the frontend's meetings lane threads one `workspaceRoot`
    // through every meeting-related invoke call.
    let dir = super::guard_meeting_path(Path::new(&workspace_root), Path::new(&meeting_dir))
        .map_err(|e| e.to_string())?;
    let binary = crate::commands::voice::resolve_sidecar_path(&app)
        .ok_or_else(|| "Voice sidecar binary not bundled for this platform".to_string())?;
    let models_dir = crate::commands::voice::resolve_models_dir(&app);
    let audio = dir.join("audio.wav");
    let out = dir.join("transcript.json");
    let meta = load_meta_for(&dir).map_err(|e| e.to_string())?;
    let t = SidecarTranscriber { binary, models_dir, model };
    tokio::task::spawn_blocking(move || transcribe_meeting_audio(&audio, &out, meta, &t).map(|_| out))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
        .map(|out| {
            let count = std::fs::read(&out)
                .ok()
                .and_then(|b| serde_json::from_slice::<serde_json::Value>(&b).ok())
                .and_then(|v| v["segments"].as_array().map(|a| a.len() as u32))
                .unwrap_or(0);
            TranscribeMeetingResult {
                transcript_path: out.to_string_lossy().into_owned(),
                segment_count: count,
            }
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    struct FakeT;
    impl WindowTranscriber for FakeT {
        fn transcribe_window(&self, wav_bytes: Vec<u8>) -> anyhow::Result<String> {
            // Deterministic: text derives from byte length so windows differ.
            Ok(format!("w{}", wav_bytes.len() % 97))
        }
    }

    /// Regression for the coordinator-review finding (2026-07-04, P2 OOM
    /// risk): the old implementation `.collect()`ed the ENTIRE file into
    /// memory and duplicated both channels, so a 2-hour meeting (this
    /// feature's real target use case) approached ~1.8 GB of peak RAM.
    /// Proves the fix precisely: reading a window deep inside a
    /// much-larger-than-any-window file pulls EXACTLY that window's bytes
    /// off the underlying stream — not the file up to the window, not the
    /// file after it — regardless of the recording's total length.
    #[test]
    fn read_channel_window_reads_exactly_the_window_not_the_whole_file() {
        let spec = hound::WavSpec {
            channels: 2,
            sample_rate: 16_000,
            bits_per_sample: 16,
            sample_format: hound::SampleFormat::Int,
        };
        let total_secs = 250u32; // far longer than any single 25 s window
        let mut cursor = std::io::Cursor::new(Vec::new());
        {
            let mut w = hound::WavWriter::new(&mut cursor, spec).unwrap();
            for frame in 0..(total_secs * 16_000) {
                // Value == frame index (mic) / its negation (sys), so the
                // returned window's contents pin down exactly which frames
                // were read.
                w.write_sample(frame as i16).unwrap();
                w.write_sample((frame as i16).wrapping_neg()).unwrap();
            }
            w.finalize().unwrap();
        }
        let buf = cursor.into_inner();
        let data_bytes = total_secs as u64 * 16_000 * 2 /* channels */ * 2 /* bytes/sample */;
        let header_size = buf.len() as u64 - data_bytes;

        let mut reader = hound::WavReader::new(std::io::Cursor::new(buf)).unwrap();
        let start_frame = 100u64 * 16_000; // deep inside the file, not the start
        let end_frame = start_frame + WINDOW_SECONDS as u64 * 16_000;
        let mic_window = read_channel_window(&mut reader, start_frame, end_frame, 0, 2).unwrap();

        assert_eq!(mic_window.len(), (end_frame - start_frame) as usize);
        assert_eq!(mic_window[0], start_frame as i16, "must start exactly at start_frame");
        assert_eq!(*mic_window.last().unwrap(), (end_frame - 1) as i16, "must end exactly at end_frame - 1");

        let window_bytes = (end_frame - start_frame) * 2 * 2;
        let expected_final_position = header_size + start_frame * 2 * 2 + window_bytes;
        assert_eq!(
            reader.into_inner().position(),
            expected_final_position,
            "must consume exactly the window's bytes off the stream, nothing more"
        );
    }

    fn stereo_fixture(dir: &std::path::Path, secs: u32) -> std::path::PathBuf {
        let spec = hound::WavSpec {
            channels: 2,
            sample_rate: 16_000,
            bits_per_sample: 16,
            sample_format: hound::SampleFormat::Int,
        };
        let p = dir.join("audio.wav");
        let mut w = hound::WavWriter::create(&p, spec).unwrap();
        for i in 0..(secs * 16_000) {
            // L (mic): loud first half, silent second half. R (sys): opposite.
            let half = i < secs * 8_000;
            w.write_sample(if half { 3000i16 } else { 0 }).unwrap();
            w.write_sample(if half { 0i16 } else { 3000 }).unwrap();
        }
        w.finalize().unwrap();
        p
    }

    #[test]
    fn transcribes_windows_with_channel_speakers_and_skips_silence() {
        let dir = tempdir().unwrap();
        let audio = stereo_fixture(dir.path(), 60);
        let out = dir.path().join("transcript.json");
        transcribe_meeting_audio(&audio, &out, test_meta("m-1"), &FakeT).unwrap();
        let t: serde_json::Value = serde_json::from_slice(&std::fs::read(&out).unwrap()).unwrap();
        let segs = t["segments"].as_array().unwrap();
        assert!(!segs.is_empty());
        // First half of the meeting: mic speaks → speaker "You".
        assert_eq!(segs[0]["speaker"], "You");
        assert_eq!(segs[0]["channel"], "mic");
        // Some later segment must be "Them" (sys channel).
        assert!(segs.iter().any(|s| s["speaker"] == "Them"));
        // Silent windows produced no segments: total segments < total windows.
        assert!(segs.len() < ((60 / 25) + 1) * 2 * 2);
        assert_eq!(t["meta"]["matterId"], "m-1");
        assert!(!dir.path().join(".transcribe-progress.json").exists());
    }

    #[test]
    fn mono_import_is_transcribed_as_sys_channel() {
        let dir = tempdir().unwrap();
        let spec = hound::WavSpec {
            channels: 1,
            sample_rate: 16_000,
            bits_per_sample: 16,
            sample_format: hound::SampleFormat::Int,
        };
        let p = dir.path().join("audio.wav");
        let mut w = hound::WavWriter::create(&p, spec).unwrap();
        for _ in 0..(30 * 16_000) {
            w.write_sample(3000i16).unwrap();
        }
        w.finalize().unwrap();
        let out = dir.path().join("transcript.json");
        transcribe_meeting_audio(&p, &out, test_meta("m-i"), &FakeT).unwrap();
        let t: serde_json::Value = serde_json::from_slice(&std::fs::read(&out).unwrap()).unwrap();
        let segs = t["segments"].as_array().unwrap();
        assert!(!segs.is_empty());
        assert!(segs.iter().all(|s| s["channel"] == "sys" && s["speaker"] == "Them"));
    }

    #[test]
    fn resume_skips_completed_windows() {
        let dir = tempdir().unwrap();
        let audio = stereo_fixture(dir.path(), 60);
        let out = dir.path().join("transcript.json");
        // Pre-seed a progress journal claiming the first mic window is done.
        std::fs::write(
            dir.path().join(".transcribe-progress.json"),
            r#"{"done":["mic:0"],"partial":[{"startMs":0,"endMs":25000,"channel":"mic","speaker":"You","text":"already"}]}"#,
        ).unwrap();
        transcribe_meeting_audio(&audio, &out, test_meta("m-1"), &FakeT).unwrap();
        let t: serde_json::Value = serde_json::from_slice(&std::fs::read(&out).unwrap()).unwrap();
        let texts: Vec<&str> = t["segments"]
            .as_array()
            .unwrap()
            .iter()
            .map(|s| s["text"].as_str().unwrap())
            .collect();
        assert!(texts.contains(&"already"), "pre-completed window text must be kept");
    }

    /// Regression for the codex-review finding (2026-07-04): a window that
    /// produces no recognized speech (silence, or the sidecar returning
    /// empty text) must reset the overlap state. Otherwise the NEXT spoken
    /// window's leading words get incorrectly trimmed against a FAR-earlier
    /// window's tail, dropping real content across the gap.
    #[test]
    fn overlap_state_resets_after_a_window_with_no_recognized_speech() {
        struct ScriptedT(std::sync::Mutex<std::collections::VecDeque<&'static str>>);
        impl WindowTranscriber for ScriptedT {
            fn transcribe_window(&self, _wav_bytes: Vec<u8>) -> anyhow::Result<String> {
                Ok(self.0.lock().unwrap().pop_front().unwrap_or_default().to_string())
            }
        }
        let dir = tempdir().unwrap();
        // Mic loud for the whole clip (every window passes the RMS gate);
        // sys silent throughout (produces no calls, kept out of the way).
        let spec = hound::WavSpec {
            channels: 2,
            sample_rate: 16_000,
            bits_per_sample: 16,
            sample_format: hound::SampleFormat::Int,
        };
        let audio = dir.path().join("audio.wav");
        let mut w = hound::WavWriter::create(&audio, spec).unwrap();
        for _ in 0..(60 * 16_000) {
            w.write_sample(3000i16).unwrap();
            w.write_sample(0i16).unwrap();
        }
        w.finalize().unwrap();
        let out = dir.path().join("transcript.json");
        // 3 mic windows at 60s duration (starts 0s, 23s, 46s). Middle window
        // recognizes nothing — simulating a pause — even though it passed
        // the RMS gate (e.g. keyboard clicks, background hum).
        let t = ScriptedT(std::sync::Mutex::new(
            ["hello thanks", "", "thanks for joining"].into_iter().collect(),
        ));
        transcribe_meeting_audio(&audio, &out, test_meta("m-1"), &t).unwrap();
        let v: serde_json::Value = serde_json::from_slice(&std::fs::read(&out).unwrap()).unwrap();
        let texts: Vec<&str> = v["segments"]
            .as_array()
            .unwrap()
            .iter()
            .map(|s| s["text"].as_str().unwrap())
            .collect();
        assert_eq!(texts, vec!["hello thanks", "thanks for joining"],
            "the third window's leading \"thanks\" must survive — it must not be trimmed as an overlap-duplicate of the first window's tail across the silent middle window");
    }

    #[test]
    fn load_meta_for_prefers_meeting_json_when_present() {
        let dir = tempdir().unwrap();
        std::fs::write(
            dir.path().join("meeting.json"),
            r#"{"matterId":"m-real","startedAt":"2026-07-02T17:03:00Z","consent":{"mode":"two-party","confirmedBy":"user","confirmedAt":"2026-07-02T17:02:58Z","note":"recorded live"}}"#,
        ).unwrap();
        let meta = load_meta_for(dir.path()).unwrap();
        assert_eq!(meta.matter_id, "m-real");
        assert_eq!(meta.started_at, "2026-07-02T17:03:00Z");
        assert_eq!(meta.consent.mode, "two-party");
        assert_eq!(meta.consent.note, "recorded live");
    }

    /// Regression for the coordinator-review finding (2026-07-04,
    /// COMPLIANCE-CRITICAL): a two-party consent recording finalized without
    /// a durable meeting.json must never silently transcribe as one-party.
    /// The old folder-name-reconstruction fallback fabricated "one-party"
    /// unconditionally — this proves that path no longer exists: transcribing
    /// a meeting whose consent record is missing FAILS loudly instead.
    #[test]
    fn load_meta_for_errors_instead_of_fabricating_consent_when_meeting_json_is_missing() {
        let root = tempdir().unwrap();
        let dir = root.path().join("2026-07-02-matter_two-party-case");
        std::fs::create_dir_all(&dir).unwrap();
        let err = load_meta_for(&dir).unwrap_err();
        assert!(
            err.to_string().contains("refusing to guess the consent mode"),
            "got: {err}"
        );
    }

    pub(super) fn test_meta(m: &str) -> TranscriptMeta {
        TranscriptMeta {
            started_at: "2026-07-02T00:00:00Z".into(),
            matter_id: m.into(),
            consent: crate::commands::capture::session::ConsentRecord {
                mode: "one-party".into(),
                confirmed_by: "user".into(),
                confirmed_at: "2026-07-02T00:00:00Z".into(),
                note: String::new(),
            },
        }
    }
}
