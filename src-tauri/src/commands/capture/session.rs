use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ConsentRecord {
    pub mode: String,         // "one-party" | "two-party"
    pub confirmed_by: String, // "user"
    pub confirmed_at: String, // ISO 8601
    #[serde(default)]
    pub note: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SessionManifest {
    pub meeting_dir: PathBuf,
    pub matter_id: String,
    pub started_at: String,
    pub consent: ConsentRecord,
}

impl SessionManifest {
    pub fn path_in(meeting_dir: &Path) -> PathBuf {
        meeting_dir.join(".capture").join("session.json")
    }
    pub fn save(&self) -> Result<()> {
        let p = Self::path_in(&self.meeting_dir);
        if let Some(parent) = p.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::write(&p, serde_json::to_vec_pretty(self)?)?;
        Ok(())
    }
    pub fn load(meeting_dir: &Path) -> Result<Self> {
        let bytes = std::fs::read(Self::path_in(meeting_dir))?;
        Ok(serde_json::from_slice(&bytes)?)
    }
}

fn read_channel_samples(cap_dir: &Path, channel: &str) -> Result<Vec<i16>> {
    let mut files: Vec<PathBuf> = std::fs::read_dir(cap_dir)?
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| {
            p.file_name()
                .and_then(|n| n.to_str())
                .map(|n| n.starts_with(&format!("{channel}-")) && n.ends_with(".wav"))
                .unwrap_or(false)
        })
        .collect();
    files.sort();
    let mut out = Vec::new();
    for f in files {
        let mut r = hound::WavReader::open(&f).with_context(|| format!("open {}", f.display()))?;
        for s in r.samples::<i16>() {
            out.push(s?);
        }
    }
    Ok(out)
}

/// Merge chunked channels into `<meeting_dir>/audio.wav` (stereo: L=mic,
/// R=sys), then remove `.capture/`. Idempotent-safe: if audio.wav already
/// exists it is overwritten from chunks (chunks are the source of truth
/// until this returns Ok).
pub fn finalize_session(meeting_dir: &Path) -> Result<PathBuf> {
    let cap = meeting_dir.join(".capture");
    let mic = read_channel_samples(&cap, "mic")?;
    let sys = read_channel_samples(&cap, "sys")?;
    let len = mic.len().max(sys.len());
    let spec = hound::WavSpec {
        channels: 2,
        sample_rate: crate::commands::capture::chunks::SAMPLE_RATE,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };
    let audio_path = meeting_dir.join("audio.wav");
    let mut w = hound::WavWriter::create(&audio_path, spec)?;
    for i in 0..len {
        w.write_sample(*mic.get(i).unwrap_or(&0))?;
        w.write_sample(*sys.get(i).unwrap_or(&0))?;
    }
    w.finalize()?;
    std::fs::remove_dir_all(&cap).ok();
    Ok(audio_path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::capture::chunks::ChunkWriter;
    use tempfile::tempdir;

    fn write_channel(dir: &std::path::Path, channel: &str, secs: usize, value: i16) {
        let mut w = ChunkWriter::new(dir, channel).unwrap();
        let one_sec = vec![value; 16_000];
        for _ in 0..secs {
            w.write(&one_sec).unwrap();
        }
        w.finish().unwrap();
    }

    #[test]
    fn finalize_merges_two_channels_and_removes_capture_dir() {
        let meeting = tempdir().unwrap();
        let cap = meeting.path().join(".capture");
        write_channel(&cap, "mic", 3, 1000); // L
        write_channel(&cap, "sys", 5, -2000); // R, longer → L zero-padded
        let audio = finalize_session(meeting.path()).unwrap();
        assert_eq!(audio, meeting.path().join("audio.wav"));
        let mut r = hound::WavReader::open(&audio).unwrap();
        assert_eq!(r.spec().channels, 2);
        assert_eq!(r.spec().sample_rate, 16_000);
        assert_eq!(r.len(), 5 * 16_000 * 2); // 5 s stereo, interleaved count
        let first_two: Vec<i16> = r.samples::<i16>().take(2).map(|s| s.unwrap()).collect();
        assert_eq!(first_two, vec![1000, -2000]); // L then R interleave
        assert!(!cap.exists(), ".capture/ must be removed after finalize");
    }
}
