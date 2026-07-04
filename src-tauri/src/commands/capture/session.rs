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

/// Durable per-meeting metadata that survives `finalize_session` deleting
/// `.capture/` (unlike `SessionManifest`, which lives ONLY under
/// `.capture/` and is gone once finalize completes). Written by
/// `finalize_session` itself from the real `SessionManifest` — this is the
/// last point at which the ACTUAL consent mode (one-party vs two-party) and
/// original start time are still on disk anywhere. `transcribe.rs`'s
/// `load_meta_for` reads this file and refuses to transcribe without it
/// rather than fabricate consent — this is a compliance product, and a
/// wrong consent record is worse than no transcript. A later meeting-store
/// write (matterHub/Task 12) may extend this file with additional fields
/// (title, participants, ...) but must never overwrite matterId/startedAt/
/// consent with anything less authoritative than what's recorded here.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct MeetingMeta {
    pub matter_id: String,
    pub started_at: String,
    pub consent: ConsentRecord,
}

impl MeetingMeta {
    pub fn path_in(meeting_dir: &Path) -> PathBuf {
        meeting_dir.join("meeting.json")
    }
    pub fn save(&self, meeting_dir: &Path) -> Result<()> {
        std::fs::write(Self::path_in(meeting_dir), serde_json::to_vec_pretty(self)?)?;
        Ok(())
    }
    pub fn load(meeting_dir: &Path) -> Result<Self> {
        let bytes = std::fs::read(Self::path_in(meeting_dir))?;
        Ok(serde_json::from_slice(&bytes)?)
    }
}

fn sorted_channel_files(cap_dir: &Path, channel: &str) -> Result<Vec<PathBuf>> {
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
    Ok(files)
}

/// Streams one channel's samples across its (possibly many) chunk files
/// without ever holding more than one chunk's decoded samples in memory —
/// a multi-hour meeting is hundreds of MB of i16 samples per channel, which
/// a `Vec<i16>` collect-then-interleave approach would hold twice over
/// (once per channel) for the whole merge.
struct ChannelSampleStream {
    files: std::collections::VecDeque<PathBuf>,
    current: Option<Box<dyn Iterator<Item = hound::Result<i16>>>>,
}

impl ChannelSampleStream {
    fn new(files: Vec<PathBuf>) -> Result<Self> {
        let mut s = Self { files: files.into(), current: None };
        s.advance()?;
        Ok(s)
    }

    fn advance(&mut self) -> Result<()> {
        self.current = None;
        if let Some(f) = self.files.pop_front() {
            let r = hound::WavReader::open(&f).with_context(|| format!("open {}", f.display()))?;
            self.current = Some(Box::new(r.into_samples::<i16>()));
        }
        Ok(())
    }
}

impl Iterator for ChannelSampleStream {
    type Item = Result<i16>;
    fn next(&mut self) -> Option<Self::Item> {
        loop {
            match self.current.as_mut()?.next() {
                Some(Ok(s)) => return Some(Ok(s)),
                Some(Err(e)) => return Some(Err(e.into())),
                None => {
                    if let Err(e) = self.advance() {
                        return Some(Err(e));
                    }
                    self.current.as_ref()?;
                    // Loop again: the just-advanced file may itself be
                    // empty (defensive — chunk rotation never produces
                    // zero-length chunks, but don't assume it).
                }
            }
        }
    }
}

/// Writes the durable `meeting.json` (see `MeetingMeta`), merges chunked
/// channels into `<meeting_dir>/audio.wav` (stereo: L=mic, R=sys), then
/// removes `.capture/`. Idempotent-safe: if audio.wav already exists it is
/// overwritten from chunks (chunks are the source of truth until this
/// returns Ok). Streams both channels sample-by-sample rather than loading
/// either into memory.
pub fn finalize_session(meeting_dir: &Path) -> Result<PathBuf> {
    let cap = meeting_dir.join(".capture");
    // Persist the REAL consent mode + matter id + start time to a durable
    // file BEFORE removing `.capture/` below — `SessionManifest` lives only
    // there, and once it's gone this is the last chance to record the
    // actual consent (one-party vs two-party) anywhere durable. Without
    // this, transcription would have no choice but to guess "one-party"
    // for every meeting once `.capture/` is deleted — unacceptable in a
    // compliance product.
    //
    // A MISSING manifest (should never happen for a real
    // capture_start-initiated recording, but historical/test fixtures may
    // not have one) does not block finalize — audio.wav is still the
    // primary artifact, and `transcribe_meeting` refuses to transcribe
    // rather than fabricate consent when meeting.json is absent.
    //
    // A manifest that DOES load but FAILS to save (disk full, permissions
    // changed) is different: propagate that error and abort BEFORE
    // deleting `.capture/` below (codex-review, 2026-07-04) — silently
    // continuing would destroy the only remaining copy of the real
    // consent record with no way to ever recover it.
    if let Ok(manifest) = SessionManifest::load(meeting_dir) {
        MeetingMeta {
            matter_id: manifest.matter_id,
            started_at: manifest.started_at,
            consent: manifest.consent,
        }
        .save(meeting_dir)
        .context(
            "failed to persist meeting consent metadata — refusing to finalize \
             (this would destroy the only durable copy of the real consent record)",
        )?;
    }
    let mut mic = ChannelSampleStream::new(sorted_channel_files(&cap, "mic")?)?;
    let mut sys = ChannelSampleStream::new(sorted_channel_files(&cap, "sys")?)?;
    let spec = hound::WavSpec {
        channels: 2,
        sample_rate: crate::commands::capture::chunks::SAMPLE_RATE,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };
    let audio_path = meeting_dir.join("audio.wav");
    let mut w = hound::WavWriter::create(&audio_path, spec)?;
    loop {
        let m = mic.next().transpose()?;
        let s = sys.next().transpose()?;
        if m.is_none() && s.is_none() {
            break;
        }
        w.write_sample(m.unwrap_or(0))?;
        w.write_sample(s.unwrap_or(0))?;
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

    /// Regression for the coordinator-review finding (2026-07-04,
    /// COMPLIANCE-CRITICAL): a two-party-consent recording must round-trip
    /// as two-party — never silently become "one-party" once `.capture/`
    /// (the only prior home of the real consent mode) is deleted.
    #[test]
    fn finalize_preserves_the_real_consent_mode_after_capture_dir_is_deleted() {
        let meeting = tempdir().unwrap();
        let cap = meeting.path().join(".capture");
        write_channel(&cap, "mic", 1, 100);
        write_channel(&cap, "sys", 1, 100);
        SessionManifest {
            meeting_dir: meeting.path().to_path_buf(),
            matter_id: "matter_two-party-case".into(),
            started_at: "2026-07-02T17:03:00Z".into(),
            consent: ConsentRecord {
                mode: "two-party".into(),
                confirmed_by: "user".into(),
                confirmed_at: "2026-07-02T17:02:58Z".into(),
                note: "both parties verbally confirmed".into(),
            },
        }
        .save()
        .unwrap();

        finalize_session(meeting.path()).unwrap();

        assert!(!cap.exists(), ".capture/ (and the SessionManifest inside it) must be gone");
        let meta = MeetingMeta::load(meeting.path()).unwrap();
        assert_eq!(meta.matter_id, "matter_two-party-case");
        assert_eq!(meta.started_at, "2026-07-02T17:03:00Z");
        assert_eq!(meta.consent.mode, "two-party", "consent mode must never silently downgrade to one-party");
        assert_eq!(meta.consent.note, "both parties verbally confirmed");
    }

    /// Regression for the codex-review follow-up finding (2026-07-04): if
    /// persisting the real consent record fails (disk full, permissions),
    /// finalize must abort BEFORE deleting `.capture/` — silently
    /// continuing would destroy the only remaining copy of the real
    /// consent, with no way to ever recover it.
    #[cfg(unix)]
    #[test]
    fn finalize_aborts_without_deleting_capture_dir_when_meeting_json_write_fails() {
        use std::os::unix::fs::PermissionsExt;

        let meeting = tempdir().unwrap();
        let cap = meeting.path().join(".capture");
        write_channel(&cap, "mic", 1, 100);
        write_channel(&cap, "sys", 1, 100);
        SessionManifest {
            meeting_dir: meeting.path().to_path_buf(),
            matter_id: "matter_perm-fail-case".into(),
            started_at: "2026-07-02T17:03:00Z".into(),
            consent: ConsentRecord {
                mode: "two-party".into(),
                confirmed_by: "user".into(),
                confirmed_at: "2026-07-02T17:02:58Z".into(),
                note: String::new(),
            },
        }
        .save()
        .unwrap();

        // Read-only meeting dir: writing meeting.json into it must fail.
        let mut perms = std::fs::metadata(meeting.path()).unwrap().permissions();
        perms.set_mode(0o555);
        std::fs::set_permissions(meeting.path(), perms.clone()).unwrap();

        let result = finalize_session(meeting.path());

        // Restore write permission so the tempdir can clean itself up.
        perms.set_mode(0o755);
        std::fs::set_permissions(meeting.path(), perms).unwrap();

        assert!(result.is_err(), "finalize must fail rather than silently lose the consent record");
        assert!(cap.exists(), ".capture/ (holding the only consent record) must survive a failed finalize");
        assert!(
            !meeting.path().join("audio.wav").exists(),
            "must not have proceeded to merge/finalize audio after the metadata write failed"
        );
    }
}
