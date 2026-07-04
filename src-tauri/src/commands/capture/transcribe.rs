//! Long-form local transcription. The bundled sidecar caps a single request
//! at 30 s (src-tauri/src/commands/voice.rs:38); we window at 25 s with 2 s
//! overlap and merge. LOCAL ONLY: the only WindowTranscriber is the sidecar.
use anyhow::Result;
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

#[derive(Serialize, Clone)]
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

pub fn transcribe_meeting_audio(
    audio: &Path,
    out: &Path,
    meta: TranscriptMeta,
    t: &dyn WindowTranscriber,
) -> Result<()> {
    let mut reader = hound::WavReader::open(audio)?;
    let spec = reader.spec();
    anyhow::ensure!(
        spec.channels == 2 && spec.sample_rate == super::chunks::SAMPLE_RATE,
        "expected 16 kHz stereo audio.wav"
    );
    let all: Vec<i16> = reader.samples::<i16>().collect::<Result<_, _>>()?;
    let frames = all.len() / 2;
    let mic: Vec<i16> = (0..frames).map(|i| all[i * 2]).collect();
    let sys: Vec<i16> = (0..frames).map(|i| all[i * 2 + 1]).collect();
    let duration_ms = (frames as u64) * 1000 / super::chunks::SAMPLE_RATE as u64;

    let progress_path = audio.parent().unwrap().join(".transcribe-progress.json");
    let mut progress: Progress = std::fs::read(&progress_path)
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default();
    let mut segments: Vec<Segment> = progress.partial.clone();

    let sr = super::chunks::SAMPLE_RATE as u64;
    let step = (WINDOW_SECONDS - OVERLAP_SECONDS) as u64 * sr;
    let win = WINDOW_SECONDS as u64 * sr;

    for (channel, speaker, samples) in [("mic", "You", &mic), ("sys", "Them", &sys)] {
        let mut prev_text = String::new();
        let mut start = 0u64;
        while start < samples.len() as u64 {
            let start_ms = start * 1000 / sr;
            let key = format!("{channel}:{start_ms}");
            let end = (start + win).min(samples.len() as u64);
            let window = &samples[start as usize..end as usize];
            if !progress.done.contains(&key) {
                // A silent window, or one where the sidecar recognizes no
                // speech, is a real gap in the audio — reset the overlap
                // state so a LATER window's leading words are never trimmed
                // against stale text from before the gap (e.g. dropping a
                // genuine "thanks for joining" because an earlier segment
                // also happened to end in "thanks"). A window whose text is
                // fully consumed by `trim_overlap` (pure repeat of the
                // previous window's tail) is NOT a gap — `prev_text` already
                // reflects that content correctly, so it's left alone.
                if rms(window) >= SILENCE_RMS {
                    let raw = t.transcribe_window(wav_mono_bytes(window))?;
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
