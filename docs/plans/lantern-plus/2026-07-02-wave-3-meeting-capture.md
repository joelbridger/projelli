# Wave 3: Local Meeting Capture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record client meetings on the advisor's own machine (mic + system-audio loopback, never a meeting bot), transcribe them fully locally with the bundled STT sidecar, and land each meeting as a cited, templated Word note plus transcript on the client's Client Map — with consent tracking, retention controls, and Ask integration.

**Architecture:** A new Rust `capture` command module records two synchronized channels (microphone + OS loopback) as crash-durable WAV chunks flushed to disk, finalized into a per-meeting folder inside the client's workspace. A new long-form transcription queue slices audio into ≤25 s windows and feeds the existing per-request Parakeet/whisper sidecar (which has a hard 30 s cap — see `src-tauri/src/commands/voice.rs:38`), merging results into `transcript.json` with channel-based speaker attribution (mic = "You", loopback = "Them"). The frontend adds a `src/features/meetings/` surface: a floating record pill, a consent dialog, a per-client Meetings tab in the client surface tab row (plus an Activity timeline entry) opening the meeting page, and a transcript viewer that seeks the audio. Notes are generated through the existing Workflows template engine into a real `.docx`. Transcripts index into RAG via the existing connector indexing path (`source_type: "transcript"` is already allowlisted at `src-tauri/src/commands/rag/store.rs:189`).

**Tech Stack:** Rust (Tauri 2 command module; new crate deps: `cpal` for audio capture, `keepawake` for sleep prevention), Swift sidecar for macOS system audio (ScreenCaptureKit, PCM over stdout — same sidecar pattern as `src-tauri/src/sidecars/`), React 18 + TS strict + Zustand frontend, existing `lantern-docx` Word engine, existing LanceDB RAG, existing SQLCipher audit store.

## Global Constraints

All 10 Global Constraints from [`2026-07-02-MASTER-PLAN.md`](./2026-07-02-MASTER-PLAN.md) apply to every task. The ones this wave trips over daily:

- **NO cloud transcription fallback, ever.** If the sidecar is missing, capture still works and transcription queues until it's available. No network path for audio/transcripts exists in any code this wave adds.
- **No meeting bot, no fourth tab.** Meetings render inside Client Map (and Ask); the record pill floats over existing surfaces.
- **Encrypt/protect at rest like neighbors:** meeting artifacts are workspace files (vault-eligible like all documents); the consent ledger and queue state are workspace-data files; audit entries go through `EncryptedAuditStore::append` (`src-tauri/src/commands/audit/store.rs:453`) which is hash-chained.
- **`matter_id` naming is locked.** Wire and Rust use `matter_id`; user-facing copy says client/household.
- **xhigh review flag:** the capture engine tasks (3a) and retention/sweep tasks (3d) are correctness/data-loss-critical — the wave driver reviews those diffs at xhigh effort.
- **Branch:** all commits on `lp/meeting-capture` off `lantern-plus`. Gate before merge: `npm run gate`.
- **Prompt-injection:** transcript text is untrusted input — it must pass through the same sanitization used for external content before entering any AI prompt (Task 14).
- **No time estimates** in code comments, docs, or commit messages.

## The Meeting Artifact Contract (all tasks use this verbatim)

Folder per meeting, inside the client's workspace area:

```
<workspace>/<matter folder>/Meetings/<YYYY-MM-DD>-<slug>/
  audio.wav          # stereo WAV: L = mic, R = system loopback (absent after "delete audio" retention)
  transcript.json    # schema below
  notes.docx         # templated meeting note (created in 3c)
  .capture/          # DURING recording only: chunk files + session manifest; removed on finalize
```

`transcript.json` (schema declared in the master plan, Cross-wave interfaces — verbatim):

```json
{
  "segments": [
    { "startMs": 0, "endMs": 4200, "channel": "mic", "speaker": "You", "text": "..." }
  ],
  "meta": {
    "startedAt": "2026-07-02T17:03:00Z",
    "durationMs": 2460000,
    "matterId": "m-abc123",
    "consent": { "mode": "one-party", "confirmedBy": "user", "confirmedAt": "2026-07-02T17:02:58Z", "note": "" }
  }
}
```

TS types for this schema live in ONE place: `src/platform/types/meeting.ts` (Task 8). Rust structs mirror them in `src-tauri/src/commands/capture/session.rs` (Task 2) with `#[serde(rename_all = "camelCase")]`.

---

## Phase 3a — Capture engine (dual-channel, crash-durable)

Phase deliverable: `capture_start` / `capture_stop` Tauri commands that record mic + loopback to chunked WAV on disk, survive a hard kill, and finalize to `audio.wav`. Verified by cargo tests + a dev harness command.

### Task 0 (SPIKE — run FIRST, before any engine code): prove WASAPI loopback via cpal on the Legion

`VERIFY-LIVE:` the whole capture design assumes cpal can open the default OUTPUT device as a loopback INPUT on Windows (WASAPI). The repo has no existing cpal capture code to prove it, and cpal's loopback support has historically been version-sensitive. Spend this spike before building anything on the assumption.

**Files:**
- Create: `src-tauri/examples/loopback_spike.rs` (a cargo example — deleted or kept as a diagnostic at the end of the wave; it is NOT product code)
- Modify: `src-tauri/Cargo.toml` (add `cpal = "0.15"` under `[dependencies]` — Task 1 needs it anyway)

- [ ] **Step 1: Write the spike**

```rust
// src-tauri/examples/loopback_spike.rs
// Proof: open the default output device in loopback mode, capture ~3 s of
// system audio, count non-zero samples. Run WHILE audio is playing (open a
// YouTube video first).
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

fn main() -> anyhow::Result<()> {
    let host = cpal::default_host();
    // WASAPI loopback: the OUTPUT device, opened with an INPUT stream config.
    let device = host
        .default_output_device()
        .ok_or_else(|| anyhow::anyhow!("no default output device"))?;
    println!("device: {}", device.name()?);
    let config = device.default_output_config()?;
    println!("config: {:?}", config);
    let nonzero = Arc::new(AtomicU64::new(0));
    let total = Arc::new(AtomicU64::new(0));
    let (nz, tt) = (nonzero.clone(), total.clone());
    let stream = device.build_input_stream(
        &config.clone().into(),
        move |data: &[f32], _| {
            tt.fetch_add(data.len() as u64, Ordering::Relaxed);
            nz.fetch_add(data.iter().filter(|s| s.abs() > 1e-6).count() as u64, Ordering::Relaxed);
        },
        |e| eprintln!("stream error: {e}"),
        None,
    )?;
    stream.play()?;
    std::thread::sleep(std::time::Duration::from_secs(3));
    drop(stream);
    let (n, t) = (nonzero.load(Ordering::Relaxed), total.load(Ordering::Relaxed));
    println!("captured {t} samples, {n} non-zero");
    anyhow::ensure!(t > 0, "SPIKE FAILED: no samples captured at all");
    anyhow::ensure!(n > 0, "SPIKE FAILED: samples captured but all zero (loopback not wired)");
    println!("SPIKE OK: cpal loopback works on this machine");
    Ok(())
}
```

- [ ] **Step 2: Run it on the Legion Windows bench (this is the AI's job, never Jameson's)**

Bring the Legion (`james@100.127.67.22`) to this branch, start audio playing (open a YouTube tab via the desktop-drive tooling), then:

Run: `cargo run --manifest-path src-tauri/Cargo.toml --example loopback_spike`
Expected: `SPIKE OK: cpal loopback works on this machine`

- [ ] **Step 3: Decision gate**

- **SPIKE OK** → proceed to Task 1 unchanged; commit the example (`git add src-tauri/examples/loopback_spike.rs src-tauri/Cargo.toml && git commit -m "spike(capture): cpal WASAPI loopback proven on Legion"`).
- **SPIKE FAILED (opens but silence, or build_input_stream errors on the output device)** → fall back to the `wasapi` crate directly (`wasapi = "0.15"`, `AUDCLNT_STREAMFLAGS_LOOPBACK` on the render device) for the Windows `AudioSource` implementation in Task 3, keeping cpal for the mic side only. Record the outcome + chosen path in a dated note at the top of this plan file BEFORE starting Task 1, so every later task builds on the proven API. Do not proceed on an unproven capture API.

### Task 1: Crate deps + capture module skeleton + chunk writer

**Files:**
- Modify: `src-tauri/Cargo.toml` (add `cpal = "0.15"`, `keepawake = "0.5"`, `hound = "3"`)
- Create: `src-tauri/src/commands/capture/mod.rs`
- Create: `src-tauri/src/commands/capture/chunks.rs`
- Test: inline `#[cfg(test)]` in `chunks.rs`

**Interfaces:**
- Produces: `ChunkWriter::new(dir: &Path, channel: &str) -> Result<ChunkWriter>`, `ChunkWriter::write(&mut self, samples: &[i16]) -> Result<()>`, `ChunkWriter::finish(self) -> Result<Vec<PathBuf>>`. Chunks are 16 kHz mono 16-bit WAV files named `<channel>-NNNNNN.wav`, rotated every `CHUNK_SECONDS = 20` seconds of audio, each fully flushed+synced on rotate. Consumed by Tasks 2, 4, 6.

- [ ] **Step 1: Write the failing test**

```rust
// src-tauri/src/commands/capture/chunks.rs  (tests module)
#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn chunk_writer_rotates_and_survives_drop_without_finish() {
        let dir = tempdir().unwrap();
        let mut w = ChunkWriter::new(dir.path(), "mic").unwrap();
        // 25 s of silence at 16 kHz → must produce 2 chunks (20 s + 5 s)
        let one_sec = vec![0i16; 16_000];
        for _ in 0..25 {
            w.write(&one_sec).unwrap();
        }
        drop(w); // simulate crash: NO finish() call
        let mut names: Vec<_> = std::fs::read_dir(dir.path())
            .unwrap()
            .map(|e| e.unwrap().file_name().into_string().unwrap())
            .collect();
        names.sort();
        assert_eq!(names, vec!["mic-000001.wav", "mic-000002.wav"]);
        // Every chunk on disk must be a valid, readable WAV even without finish().
        for n in &names {
            let r = hound::WavReader::open(dir.path().join(n)).unwrap();
            assert_eq!(r.spec().sample_rate, 16_000);
            assert!(r.len() > 0);
        }
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src-tauri && cargo test capture::chunks -- --nocapture`
Expected: FAIL — `ChunkWriter` not found (module doesn't exist yet).

- [ ] **Step 3: Write minimal implementation**

```rust
// src-tauri/src/commands/capture/chunks.rs
//! Crash-durable chunked WAV writer. Every rotate finalizes the current WAV
//! header and fsyncs, so a hard kill loses at most the currently-open chunk's
//! tail — never the meeting. (Master plan: capture reliability is XL-critical.)

use anyhow::Result;
use std::path::{Path, PathBuf};

pub const SAMPLE_RATE: u32 = 16_000;
pub const CHUNK_SECONDS: u32 = 20;
const SAMPLES_PER_CHUNK: u64 = (SAMPLE_RATE as u64) * (CHUNK_SECONDS as u64);

pub struct ChunkWriter {
    dir: PathBuf,
    channel: String,
    index: u32,
    written_in_chunk: u64,
    writer: Option<hound::WavWriter<std::io::BufWriter<std::fs::File>>>,
    finished: Vec<PathBuf>,
}

impl ChunkWriter {
    pub fn new(dir: &Path, channel: &str) -> Result<Self> {
        std::fs::create_dir_all(dir)?;
        let mut w = Self {
            dir: dir.to_path_buf(),
            channel: channel.to_string(),
            index: 0,
            written_in_chunk: 0,
            writer: None,
            finished: Vec::new(),
        };
        w.rotate()?;
        Ok(w)
    }

    fn spec() -> hound::WavSpec {
        hound::WavSpec {
            channels: 1,
            sample_rate: SAMPLE_RATE,
            bits_per_sample: 16,
            sample_format: hound::SampleFormat::Int,
        }
    }

    fn current_path(&self) -> PathBuf {
        self.dir.join(format!("{}-{:06}.wav", self.channel, self.index))
    }

    fn rotate(&mut self) -> Result<()> {
        if let Some(w) = self.writer.take() {
            w.finalize()?; // writes the header length + flushes
            self.finished.push(self.current_path());
        }
        self.index += 1;
        self.written_in_chunk = 0;
        let file = std::fs::File::create(self.current_path())?;
        self.writer = Some(hound::WavWriter::new(std::io::BufWriter::new(file), Self::spec())?);
        Ok(())
    }

    pub fn write(&mut self, samples: &[i16]) -> Result<()> {
        let w = self.writer.as_mut().expect("writer always present");
        for s in samples {
            w.write_sample(*s)?;
        }
        self.written_in_chunk += samples.len() as u64;
        if self.written_in_chunk >= SAMPLES_PER_CHUNK {
            self.rotate()?;
        } else {
            // Durability: flush samples so a crash loses only unflushed tail.
            self.writer.as_mut().unwrap().flush()?;
        }
        Ok(())
    }

    pub fn finish(mut self) -> Result<Vec<PathBuf>> {
        if let Some(w) = self.writer.take() {
            if self.written_in_chunk > 0 {
                w.finalize()?;
                self.finished.push(self.current_path());
            } else {
                w.finalize()?;
                let _ = std::fs::remove_file(self.current_path());
            }
        }
        Ok(self.finished.clone())
    }
}

impl Drop for ChunkWriter {
    fn drop(&mut self) {
        // Crash-path: finalize whatever is open so the chunk header is valid.
        if let Some(w) = self.writer.take() {
            let _ = w.finalize();
        }
    }
}
```

```rust
// src-tauri/src/commands/capture/mod.rs
//! Local meeting capture: dual-channel (mic + system loopback) chunked
//! recording. NO network paths exist in this module by design.
pub mod chunks;
```

Also add to `src-tauri/src/commands/mod.rs` (alongside its siblings): `pub mod capture;`
And in `src-tauri/Cargo.toml` under `[dependencies]`:

```toml
cpal = "0.15"
keepawake = "0.5"
hound = "3"
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd src-tauri && cargo test capture::chunks -- --nocapture`
Expected: PASS (2 chunks, both valid WAV).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/src/commands/capture/ src-tauri/src/commands/mod.rs
git commit -m "feat(capture): crash-durable chunked WAV writer (Wave 3a)"
```

### Task 2: Session manifest + finalize (chunks → stereo audio.wav)

**Files:**
- Create: `src-tauri/src/commands/capture/session.rs`
- Modify: `src-tauri/src/commands/capture/mod.rs` (add `pub mod session;`)
- Test: inline `#[cfg(test)]` in `session.rs`

**Interfaces:**
- Produces:
  - `SessionManifest { meeting_dir: PathBuf, matter_id: String, started_at: String, consent: ConsentRecord }` serialized as `.capture/session.json` (crash-recovery breadcrumb, Task 6).
  - `ConsentRecord { mode: String, confirmed_by: String, confirmed_at: String, note: String }` (serde camelCase — matches the transcript.json `meta.consent` block).
  - `finalize_session(meeting_dir: &Path) -> Result<PathBuf>` — merges `.capture/mic-*.wav` (L) and `.capture/sys-*.wav` (R) into `<meeting_dir>/audio.wav` (stereo, 16 kHz), deletes `.capture/`. Shorter channel is zero-padded. Returns the audio path. Consumed by Tasks 4, 5, 6.

- [ ] **Step 1: Write the failing test**

```rust
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
        write_channel(&cap, "mic", 3, 1000);  // L
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src-tauri && cargo test capture::session -- --nocapture`
Expected: FAIL — `finalize_session` not defined.

- [ ] **Step 3: Write minimal implementation**

```rust
// src-tauri/src/commands/capture/session.rs
use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ConsentRecord {
    pub mode: String,        // "one-party" | "two-party"
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd src-tauri && cargo test capture::session -- --nocapture`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/commands/capture/
git commit -m "feat(capture): session manifest + stereo finalize from chunks (Wave 3a)"
```

### Task 3: Platform audio sources (cpal mic + loopback; mac sidecar shell)

⚠️ **xhigh review.** This is the per-OS heart of the engine. It CANNOT be fully unit-tested in CI (no audio devices); the testable seam is the `AudioSource` trait + a scripted fake. Real-device verification happens in Task 7 (Legion/M1 harness).

**Files:**
- Create: `src-tauri/src/commands/capture/sources.rs`
- Create: `src-tauri/sidecar-src/capture-mac/README.md` (Swift sidecar spec — see Step 3)
- Modify: `src-tauri/src/commands/capture/mod.rs` (add `pub mod sources;`)
- Test: inline `#[cfg(test)]` in `sources.rs` (fake source only)

**Interfaces:**
- Produces:
  - `trait AudioSource: Send { fn start(&mut self, on_samples: Box<dyn FnMut(&[i16]) + Send>) -> Result<()>; fn stop(&mut self) -> Result<()>; }`
  - `fn mic_source() -> Result<Box<dyn AudioSource>>` — cpal default input device, resampled to 16 kHz mono i16.
  - `fn loopback_source() -> Result<Box<dyn AudioSource>>` — Windows: cpal WASAPI loopback (open the default OUTPUT device as an input stream — cpal ≥0.15 supports this on WASAPI); Linux: the PipeWire/Pulse `*.monitor` input device (match device name containing `"monitor"`); macOS: `MacTapSource` that spawns the `capture-mac` sidecar and reads little-endian i16 16 kHz mono PCM frames from its stdout (identical sidecar plumbing to `ParakeetSidecar::transcribe` at `src-tauri/src/sidecars/parakeet.rs:79-129`, but long-lived).
  - `struct FakeSource { script: Vec<Vec<i16>> }` (cfg(test)) — emits scripted buffers; used by Task 4's engine tests.
- Consumes: `Sidecar` trait (`src-tauri/src/sidecars/mod.rs:31-37`) for the mac binary lifecycle.

- [ ] **Step 1: Write the failing test (trait + fake + resampler)**

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fake_source_delivers_scripted_buffers_then_stops() {
        let mut src = FakeSource::new(vec![vec![1i16; 160], vec![2i16; 160]]);
        let got = std::sync::Arc::new(std::sync::Mutex::new(Vec::<i16>::new()));
        let sink = got.clone();
        src.start(Box::new(move |s| sink.lock().unwrap().extend_from_slice(s)))
            .unwrap();
        src.stop().unwrap();
        let g = got.lock().unwrap();
        assert_eq!(g.len(), 320);
        assert_eq!(g[0], 1);
        assert_eq!(g[319], 2);
    }

    #[test]
    fn downmix_resample_48k_stereo_f32_to_16k_mono_i16_length() {
        // 48 000 stereo f32 frames of 1 s → 16 000 mono i16 samples.
        let input = vec![0.5f32; 48_000 * 2];
        let out = downmix_resample(&input, 2, 48_000);
        assert_eq!(out.len(), 16_000);
        assert!(out.iter().all(|&s| s > 15_000)); // 0.5 → ~16383
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src-tauri && cargo test capture::sources -- --nocapture`
Expected: FAIL — types not defined.

- [ ] **Step 3: Write the implementation**

```rust
// src-tauri/src/commands/capture/sources.rs
//! Per-OS audio sources. All sources deliver 16 kHz mono i16 via callback.
//! Loopback = "what the machine is playing" (the far end of the meeting).
//! NO audio ever leaves this process; sources write only to the ChunkWriter.
use anyhow::{anyhow, Result};

pub trait AudioSource: Send {
    fn start(&mut self, on_samples: Box<dyn FnMut(&[i16]) + Send>) -> Result<()>;
    fn stop(&mut self) -> Result<()>;
}

/// Downmix interleaved f32 (any channel count) to mono and linearly resample
/// to 16 kHz i16. Same approach as the frontend's `resampleLinear`
/// (`src/features/dictation/voice/VoiceCapture.ts:87`), kept in Rust so the
/// capture path has no JS in the hot loop.
pub fn downmix_resample(input: &[f32], channels: u16, src_rate: u32) -> Vec<i16> {
    let ch = channels.max(1) as usize;
    let frames = input.len() / ch;
    let mono: Vec<f32> = (0..frames)
        .map(|f| input[f * ch..f * ch + ch].iter().sum::<f32>() / ch as f32)
        .collect();
    let dst_rate = super::chunks::SAMPLE_RATE as f64;
    let out_len = ((frames as f64) * dst_rate / (src_rate as f64)).round() as usize;
    (0..out_len)
        .map(|i| {
            let pos = (i as f64) * (src_rate as f64) / dst_rate;
            let idx = pos.floor() as usize;
            let frac = (pos - pos.floor()) as f32;
            let a = *mono.get(idx).unwrap_or(&0.0);
            let b = *mono.get(idx + 1).unwrap_or(&a);
            let v = a + (b - a) * frac;
            (v.clamp(-1.0, 1.0) * 32_767.0) as i16
        })
        .collect()
}

// ---------- cpal-backed sources (Windows/Linux mic + loopback; mac mic) ----

pub struct CpalSource {
    stream: Option<cpal::Stream>,
    device: cpal::Device,
}

impl CpalSource {
    pub fn from_device(device: cpal::Device) -> Self {
        Self { stream: None, device }
    }
}

impl AudioSource for CpalSource {
    fn start(&mut self, mut on_samples: Box<dyn FnMut(&[i16]) + Send>) -> Result<()> {
        use cpal::traits::{DeviceTrait, StreamTrait};
        let config = self.device.default_input_config()?;
        let channels = config.channels();
        let rate = config.sample_rate().0;
        let stream = self.device.build_input_stream(
            &config.into(),
            move |data: &[f32], _| {
                let mono16 = downmix_resample(data, channels, rate);
                on_samples(&mono16);
            },
            |e| log::warn!("capture stream error: {e}"),
            None,
        )?;
        stream.play()?;
        self.stream = Some(stream);
        Ok(())
    }
    fn stop(&mut self) -> Result<()> {
        self.stream.take(); // dropping the stream stops it
        Ok(())
    }
}

pub fn mic_source() -> Result<Box<dyn AudioSource>> {
    use cpal::traits::HostTrait;
    let host = cpal::default_host();
    let device = host
        .default_input_device()
        .ok_or_else(|| anyhow!("no microphone device"))?;
    Ok(Box::new(CpalSource::from_device(device)))
}

#[cfg(target_os = "windows")]
pub fn loopback_source() -> Result<Box<dyn AudioSource>> {
    // WASAPI loopback: open the default OUTPUT device as an input stream.
    use cpal::traits::HostTrait;
    let host = cpal::default_host();
    let device = host
        .default_output_device()
        .ok_or_else(|| anyhow!("no output device for loopback"))?;
    Ok(Box::new(CpalSource::from_device(device)))
}

#[cfg(target_os = "linux")]
pub fn loopback_source() -> Result<Box<dyn AudioSource>> {
    // PipeWire/Pulse expose "<sink>.monitor" as an input device.
    use cpal::traits::{DeviceTrait, HostTrait};
    let host = cpal::default_host();
    let device = host
        .input_devices()?
        .find(|d| d.name().map(|n| n.contains("monitor")).unwrap_or(false))
        .ok_or_else(|| anyhow!("no monitor (loopback) device found"))?;
    Ok(Box::new(CpalSource::from_device(device)))
}

#[cfg(target_os = "macos")]
pub fn loopback_source() -> Result<Box<dyn AudioSource>> {
    MacTapSource::spawn()
}

#[cfg(target_os = "macos")]
pub struct MacTapSource {
    child: Option<tokio::process::Child>,
    reader_task: Option<tokio::task::JoinHandle<()>>,
}

#[cfg(target_os = "macos")]
impl MacTapSource {
    /// Spawns the `capture-mac` sidecar (resolved exactly like the voice
    /// sidecar — `resolve_sidecar_path` pattern in
    /// `src-tauri/src/commands/voice.rs:77-108`, names: ["capture-mac"]).
    /// Contract: sidecar writes raw little-endian i16 16 kHz mono PCM to
    /// stdout in ≤4096-byte frames; exits 0 on SIGTERM; permission errors go
    /// to stderr with exit 3 (surfaced to the UI as the macOS permission
    /// onboarding moment, Task 13).
    pub fn spawn() -> Result<Box<dyn AudioSource>> {
        Ok(Box::new(Self { child: None, reader_task: None }))
    }
}

#[cfg(target_os = "macos")]
impl AudioSource for MacTapSource {
    fn start(&mut self, mut on_samples: Box<dyn FnMut(&[i16]) + Send>) -> Result<()> {
        use tokio::io::AsyncReadExt;
        let binary = crate::commands::capture::mac_sidecar_path()
            .ok_or_else(|| anyhow!("capture-mac sidecar not bundled"))?;
        let mut cmd = tokio::process::Command::new(binary);
        cmd.stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped());
        let mut child = cmd.spawn()?;
        let mut stdout = child.stdout.take().ok_or_else(|| anyhow!("no stdout"))?;
        self.reader_task = Some(tokio::spawn(async move {
            let mut buf = [0u8; 4096];
            loop {
                match stdout.read(&mut buf).await {
                    Ok(0) | Err(_) => break,
                    Ok(n) => {
                        let samples: Vec<i16> = buf[..n]
                            .chunks_exact(2)
                            .map(|b| i16::from_le_bytes([b[0], b[1]]))
                            .collect();
                        on_samples(&samples);
                    }
                }
            }
        }));
        self.child = Some(child);
        Ok(())
    }
    fn stop(&mut self) -> Result<()> {
        if let Some(mut c) = self.child.take() {
            let _ = c.start_kill();
        }
        self.reader_task.take();
        Ok(())
    }
}

// ---------- test fake ------------------------------------------------------

#[cfg(test)]
pub struct FakeSource {
    script: Vec<Vec<i16>>,
}

#[cfg(test)]
impl FakeSource {
    pub fn new(script: Vec<Vec<i16>>) -> Self {
        Self { script }
    }
}

#[cfg(test)]
impl AudioSource for FakeSource {
    fn start(&mut self, mut on_samples: Box<dyn FnMut(&[i16]) + Send>) -> Result<()> {
        for buf in self.script.drain(..) {
            on_samples(&buf);
        }
        Ok(())
    }
    fn stop(&mut self) -> Result<()> {
        Ok(())
    }
}
```

Also create `src-tauri/sidecar-src/capture-mac/README.md` with the sidecar build spec (the Swift source is built on the M1 bench, not in this repo's CI):

```markdown
# capture-mac sidecar

Swift binary. Captures system audio via ScreenCaptureKit
(SCStreamConfiguration.capturesAudio = true, excludesCurrentProcessAudio =
true), converts to 16 kHz mono Int16, writes raw little-endian PCM to stdout
in ≤4096-byte writes. Requires the "System Audio Recording" permission
(macOS 14.4+) or Screen Recording permission (13.0–14.3). On permission
denial: print a one-line error to stderr and exit 3. On SIGTERM: stop the
stream, flush, exit 0. Build: `swiftc -O capture-mac.swift -o capture-mac`
on the M1 bench; stage via `npm run fetch-voice-sidecar`'s pattern into
`src-tauri/binaries/capture-mac-<target-triple>`.
```

Add a helper in `src-tauri/src/commands/capture/mod.rs`:

```rust
#[cfg(target_os = "macos")]
pub fn mac_sidecar_path() -> Option<std::path::PathBuf> {
    // Same dev-dir fallbacks as commands::voice::resolve_sidecar_path, with
    // the app handle path checked by the caller at command level.
    let cwd = std::env::current_dir().ok()?;
    crate::commands::voice::find_sidecar_in(&cwd.join("src-tauri").join("binaries"), &["capture-mac"])
        .or_else(|| crate::commands::voice::find_sidecar_in(&cwd.join("binaries"), &["capture-mac"]))
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd src-tauri && cargo test capture::sources -- --nocapture`
Expected: PASS (fake + resampler tests; cpal paths compile but are untested in CI).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/commands/capture/ src-tauri/sidecar-src/
git commit -m "feat(capture): per-OS audio sources (cpal mic/loopback, mac sidecar contract) (Wave 3a)"
```

### Task 4: Capture engine + Tauri commands (start/stop/status)

⚠️ **xhigh review.**

**Files:**
- Create: `src-tauri/src/commands/capture/engine.rs`
- Modify: `src-tauri/src/commands/capture/mod.rs`
- Modify: `src-tauri/src/lib.rs` (register commands in the `generate_handler![]` list, next to `commands::voice::transcribe_audio` at `src-tauri/src/lib.rs:99-100`)
- Test: inline `#[cfg(test)]` in `engine.rs` (FakeSource-driven)

**Interfaces:**
- Produces Tauri commands (all return `Result<_, String>` like every command in this repo):
  - `capture_start(workspace: String, matter_id: String, matter_folder: String, consent_mode: String, consent_note: Option<String>) -> Result<CaptureStartResult, String>` where `CaptureStartResult { meeting_dir: String, started_at: String }`. Creates `<workspace>/<matter_folder>/Meetings/<YYYY-MM-DD>-<slug>/.capture/`, writes `SessionManifest`, starts mic + loopback sources into two `ChunkWriter`s, acquires a `keepawake` handle (display-off allowed, sleep prevented).
  - `capture_stop() -> Result<CaptureStopResult, String>` where `CaptureStopResult { meeting_dir: String, audio_path: String, duration_ms: u64 }` — stops sources, `finalize_session`, releases keep-awake, appends an audit entry ("meeting_recorded") via the existing audit command path.
  - `capture_status() -> Result<CaptureStatus, String>` where `CaptureStatus { recording: bool, meeting_dir: Option<String>, elapsed_ms: u64 }` — polled by the UI pill.
  - Internal: `CaptureEngine::start_with_sources(...)` seam that accepts `Box<dyn AudioSource>` pairs — this is what tests drive with `FakeSource`.
- Consumes: Tasks 1–3 types. Single global engine: `static ENGINE: Mutex<Option<CaptureEngine>>` — a second `capture_start` while recording returns `Err("already recording")`.

- [ ] **Step 1: Write the failing engine test**

```rust
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
        let mut engine = CaptureEngine::start_with_sources(
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
    fn second_start_while_recording_is_rejected() {
        // Drive through the global ENGINE guard used by the Tauri commands.
        let ws = tempdir().unwrap();
        let ok = try_begin_global(ws.path(), "m-1", "Clients/A", consent("one-party"));
        assert!(ok.is_ok());
        let err = try_begin_global(ws.path(), "m-2", "Clients/B", consent("one-party"));
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src-tauri && cargo test capture::engine -- --nocapture`
Expected: FAIL — `CaptureEngine` not defined.

- [ ] **Step 3: Path guard — failing tests, then `guard_meeting_path`**

Every capture command takes `workspace`/`matter_folder`/`meeting_dir` strings from the renderer and joins/deletes under them. A `..`-check alone misses absolute paths and symlink escapes. Mirror the repo's existing guarded-path pattern (canonicalize root, canonicalize candidate, `starts_with` — see `src-tauri/src/commands/vault/mod.rs:254` and `src-tauri/src/commands/tarball.rs:142`). Add to `src-tauri/src/commands/capture/mod.rs`:

```rust
#[cfg(test)]
mod path_guard_tests {
    use super::*;

    #[test]
    fn rejects_absolute_matter_folder() {
        let ws = tempfile::tempdir().unwrap();
        let err = guard_matter_folder(ws.path(), "/etc").unwrap_err();
        assert!(err.to_string().contains("must be workspace-relative"), "got: {err}");
    }

    #[test]
    fn rejects_dotdot_traversal() {
        let ws = tempfile::tempdir().unwrap();
        let err = guard_matter_folder(ws.path(), "../outside").unwrap_err();
        assert!(err.to_string().contains("escapes workspace"), "got: {err}");
    }

    #[test]
    fn rejects_symlink_escape() {
        let ws = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        std::os::unix::fs::symlink(outside.path(), ws.path().join("link")).unwrap();
        let err = guard_matter_folder(ws.path(), "link/Clients/A").unwrap_err();
        assert!(err.to_string().contains("escapes workspace"), "got: {err}");
    }

    #[test]
    fn accepts_normal_relative_folder() {
        let ws = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(ws.path().join("Clients/A")).unwrap();
        let p = guard_matter_folder(ws.path(), "Clients/A").unwrap();
        assert!(p.starts_with(ws.path().canonicalize().unwrap()));
    }

    #[test]
    fn meeting_dir_must_be_inside_workspace() {
        let ws = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let err = guard_meeting_path(ws.path(), &outside.path().join("Meetings/x")).unwrap_err();
        assert!(err.to_string().contains("escapes workspace"), "got: {err}");
    }
}
```

Implementation (same file):

```rust
/// Resolve a RELATIVE matter folder under the workspace, refusing absolute
/// inputs, `..` traversal, and symlink escapes. Every capture command that
/// receives a folder/dir string MUST route through one of these two guards
/// before any create/join/delete.
pub(crate) fn guard_matter_folder(
    workspace: &std::path::Path,
    matter_folder: &str,
) -> anyhow::Result<std::path::PathBuf> {
    use anyhow::{bail, Context};
    let rel = std::path::Path::new(matter_folder);
    if rel.is_absolute() {
        bail!("matter_folder must be workspace-relative, got absolute path");
    }
    let canon_ws = workspace
        .canonicalize()
        .context("cannot canonicalize workspace")?;
    let joined = canon_ws.join(rel);
    // Canonicalize the deepest existing ancestor so symlinks anywhere in the
    // chain resolve, then re-append the not-yet-created tail.
    let mut existing = joined.clone();
    let mut tail = std::path::PathBuf::new();
    while !existing.exists() {
        let name = existing
            .file_name()
            .map(std::ffi::OsString::from)
            .context("path has no file name while walking ancestors")?;
        tail = std::path::Path::new(&name).join(&tail);
        existing = existing
            .parent()
            .context("ran out of ancestors")?
            .to_path_buf();
    }
    let canon = existing
        .canonicalize()
        .context("cannot canonicalize existing ancestor")?
        .join(&tail);
    if !canon.starts_with(&canon_ws) {
        bail!("path '{}' escapes workspace '{}'", canon.display(), canon_ws.display());
    }
    Ok(canon)
}

/// Same contract for an already-materialized meeting dir passed back from the
/// frontend (stop/recover/index/retention): canonicalize and require it to be
/// a descendant of the workspace.
pub(crate) fn guard_meeting_path(
    workspace: &std::path::Path,
    meeting_dir: &std::path::Path,
) -> anyhow::Result<std::path::PathBuf> {
    use anyhow::{bail, Context};
    let canon_ws = workspace
        .canonicalize()
        .context("cannot canonicalize workspace")?;
    let canon = meeting_dir
        .canonicalize()
        .context("cannot canonicalize meeting dir")?;
    if !canon.starts_with(&canon_ws) {
        bail!("path '{}' escapes workspace '{}'", canon.display(), canon_ws.display());
    }
    Ok(canon)
}
```

Run: `cd src-tauri && cargo test capture::path_guard -- --nocapture`
Expected: `test result: ok. 5 passed`

Wiring requirement for the NEXT step: `capture_start` calls `guard_matter_folder(Path::new(&workspace), &matter_folder)?` (mapping the error with `.map_err(|e| e.to_string())`) and builds the meeting dir from the returned canonical path; `capture_recover` (Task 5), `transcribe_meeting` (Task 8), `capture_index_transcript` (Task 14) and the retention commands (Task 15) call `guard_meeting_path` on their dir inputs before touching the filesystem. The Task 15 sweep additionally re-verifies each individual deletion target with `starts_with` on the canonical workspace before unlink.

- [ ] **Step 4: Implement the engine and commands**

```rust
// src-tauri/src/commands/capture/engine.rs
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
    _awake: Option<keepawake::AwakeHandle>,
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
        let meeting_dir = workspace
            .join(matter_folder)
            .join("Meetings")
            .join(format!("{date}-{}", slugify(matter_id)));
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

pub fn try_begin_global(
    workspace: &Path,
    matter_id: &str,
    matter_folder: &str,
    consent: ConsentRecord,
) -> Result<PathBuf, String> {
    let mut guard = ENGINE.lock().unwrap();
    if guard.is_some() {
        return Err("already recording".into());
    }
    let mic = super::sources::mic_source().map_err(|e| e.to_string())?;
    let sys = super::sources::loopback_source().map_err(|e| e.to_string())?;
    let engine =
        CaptureEngine::start_with_sources(workspace, matter_id, matter_folder, consent, mic, sys)
            .map_err(|e| e.to_string())?;
    let dir = engine.meeting_dir.clone();
    *guard = Some(engine);
    Ok(dir)
}

#[cfg(test)]
pub fn end_global_for_tests() {
    ENGINE.lock().unwrap().take();
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureStartResult { pub meeting_dir: String, pub started_at: String }

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureStopResult { pub meeting_dir: String, pub audio_path: String, pub duration_ms: u64 }

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureStatus { pub recording: bool, pub meeting_dir: Option<String>, pub elapsed_ms: u64 }

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
    guard_matter_folder(Path::new(&workspace), &matter_folder).map_err(|e| e.to_string())?;
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
```

Note: `finalize_session` must also delete `session.json` (it lives inside `.capture/`, which is removed — already covered). Add the three commands to `generate_handler![]` in `src-tauri/src/lib.rs` directly under the voice commands (`src-tauri/src/lib.rs:99-100`):

```rust
            commands::capture::engine::capture_start,
            commands::capture::engine::capture_stop,
            commands::capture::engine::capture_status,
```

- [ ] **Step 5: Run tests**

Run: `cd src-tauri && cargo test capture:: -- --nocapture`
Expected: PASS (all capture module tests).

- [ ] **Step 6: Run the full Rust suite to catch registration breakage**

Run: `cd src-tauri && cargo test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/commands/capture/ src-tauri/src/lib.rs
git commit -m "feat(capture): capture engine + start/stop/status commands (Wave 3a)"
```

### Task 5: Crash recovery (orphaned session detection)

**Files:**
- Create: `src-tauri/src/commands/capture/recovery.rs`
- Modify: `src-tauri/src/commands/capture/mod.rs`, `src-tauri/src/lib.rs`
- Test: inline `#[cfg(test)]`

**Interfaces:**
- Produces: `capture_find_orphans(workspace: String) -> Result<Vec<OrphanSession>, String>` where `OrphanSession { meeting_dir: String, matter_id: String, started_at: String }` — scans `<workspace>/**/Meetings/*/.capture/session.json` (bounded: only two directory levels above `Meetings/`), and `capture_recover(meeting_dir: String) -> Result<CaptureStopResult, String>` — finalizes an orphan's chunks into `audio.wav`. Consumed by the UI on launch (Task 12: "Found Tuesday's recording — finish the notes?").

- [ ] **Step 1: Write the failing test**

```rust
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
            consent: ConsentRecord { mode: "one-party".into(), confirmed_by: "user".into(), confirmed_at: "2026-07-01T09:59:00Z".into(), note: String::new() },
        }.save().unwrap();

        let orphans = find_orphans(ws.path()).unwrap();
        assert_eq!(orphans.len(), 1);
        assert_eq!(orphans[0].matter_id, "m-test");

        let audio = recover(&meeting).unwrap();
        assert!(audio.exists());
        assert!(find_orphans(ws.path()).unwrap().is_empty());
    }
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd src-tauri && cargo test capture::recovery -- --nocapture`
Expected: FAIL.

- [ ] **Step 3: Implement**

```rust
// src-tauri/src/commands/capture/recovery.rs
use super::session::{finalize_session, SessionManifest};
use anyhow::Result;
use std::path::{Path, PathBuf};

#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct OrphanSession {
    pub meeting_dir: String,
    pub matter_id: String,
    pub started_at: String,
}

pub fn find_orphans(workspace: &Path) -> Result<Vec<OrphanSession>> {
    let mut out = Vec::new();
    // Meetings dirs sit at <workspace>/<matter folder>/Meetings/<meeting>.
    // Matter folders may be one or two levels deep; walk breadth-limited.
    fn walk(dir: &Path, depth: u8, out: &mut Vec<OrphanSession>) {
        if depth > 4 { return; }
        let Ok(entries) = std::fs::read_dir(dir) else { return };
        for e in entries.flatten() {
            let p = e.path();
            if !p.is_dir() { continue; }
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
    Ok(out)
}

pub fn recover(meeting_dir: &Path) -> Result<PathBuf> {
    finalize_session(meeting_dir)
}

#[tauri::command]
pub async fn capture_find_orphans(workspace: String) -> Result<Vec<OrphanSession>, String> {
    find_orphans(Path::new(&workspace)).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn capture_recover(meeting_dir: String) -> Result<super::engine::CaptureStopResult, String> {
    let dir = PathBuf::from(&meeting_dir);
    let audio = recover(&dir).map_err(|e| e.to_string())?;
    Ok(super::engine::CaptureStopResult {
        meeting_dir,
        audio_path: audio.to_string_lossy().into_owned(),
        duration_ms: 0,
    })
}
```

Register both commands in `src-tauri/src/lib.rs` under the capture block.

- [ ] **Step 4: Run tests**

Run: `cd src-tauri && cargo test capture::recovery -- --nocapture`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/commands/capture/ src-tauri/src/lib.rs
git commit -m "feat(capture): crash recovery for orphaned recording sessions (Wave 3a)"
```

### Task 6: Real-device verification harness (Legion + M1)

Per the repo rule, real-OS testing is the AI's job (Legion Windows laptop `james@100.127.67.22`, M1 bench for macOS). This task builds the harness script and runs it — it is the phase gate for 3a.

**Files:**
- Create: `scripts/capture-smoke.mjs`
- Test: manual harness run (this task IS the test)

**Interfaces:**
- Consumes: the three capture commands (Task 4) via the WebView2/CDP driver (`scripts/desktop-drive.mjs` pattern).

- [ ] **Step 1: Write the harness**

```javascript
// scripts/capture-smoke.mjs
// Drives the running desktop app over CDP: starts a capture, plays a known
// tone out of the speakers (loopback truth), speaks nothing into the mic,
// stops, then asserts audio.wav exists, is stereo, and the R (system)
// channel has energy while L (mic) is near-silent.
// Usage: node scripts/desktop-drive.mjs --eval-file scripts/capture-smoke.mjs
import { invoke, evalInApp, sleep } from './desktop-drive.mjs';

const ws = process.env.KP_SMOKE_WORKSPACE;
if (!ws) throw new Error('set KP_SMOKE_WORKSPACE');

const start = await invoke('capture_start', {
  workspace: ws,
  matterId: 'm-smoke',
  matterFolder: 'Clients/Smoke Test',
  consentMode: 'one-party',
});
console.log('recording →', start.meetingDir);

// Play a 440 Hz tone through the system output for 10 s (loopback source).
await evalInApp(`
  const ctx = new AudioContext();
  const osc = ctx.createOscillator();
  osc.frequency.value = 440; osc.connect(ctx.destination); osc.start();
  window.__smokeOsc = { osc, ctx };
`);
await sleep(10_000);
await evalInApp(`window.__smokeOsc.osc.stop(); window.__smokeOsc.ctx.close();`);

const stop = await invoke('capture_stop', {});
console.log('audio →', stop.audioPath, 'duration', stop.durationMs, 'ms');
if (stop.durationMs < 9_000) throw new Error('recording shorter than tone playback');
console.log('CAPTURE SMOKE: PASS (inspect channel energy with scripts/wav-energy.mjs)');
```

Also create the tiny checker `scripts/wav-energy.mjs` (reads a WAV, prints per-channel RMS):

```javascript
// scripts/wav-energy.mjs — usage: node scripts/wav-energy.mjs <path/to/audio.wav>
import { readFileSync } from 'node:fs';
const buf = readFileSync(process.argv[2]);
const channels = buf.readUInt16LE(22);
const dataStart = buf.indexOf(Buffer.from('data')) + 8;
let sums = new Array(channels).fill(0), n = 0;
for (let i = dataStart; i + 2 * channels <= buf.length; i += 2 * channels) {
  for (let c = 0; c < channels; c++) sums[c] += (buf.readInt16LE(i + 2 * c) / 32768) ** 2;
  n++;
}
sums.forEach((s, c) => console.log(`channel ${c} RMS: ${Math.sqrt(s / n).toFixed(4)}`));
```

- [ ] **Step 2: Run on the Legion (Windows)**

Bring the Legion to this branch, launch the dev app, then:
Run: `KP_SMOKE_WORKSPACE=C:\\kp-smoke node scripts/desktop-drive.mjs --eval-file scripts/capture-smoke.mjs` then `node scripts/wav-energy.mjs <printed audio.wav path>`
Expected: `CAPTURE SMOKE: PASS`; channel 1 (system) RMS > 0.05; channel 0 (mic) RMS < 0.02 (quiet room).

- [ ] **Step 3: Run the mid-recording kill test on the Legion**

Start a capture as above, then hard-kill the app process (`taskkill /F`), relaunch, and run `invoke('capture_find_orphans', { workspace })`.
Expected: one orphan returned; `capture_recover` produces a valid `audio.wav` whose duration ≈ time before the kill (verify with `wav-energy.mjs` reading it without error).

- [ ] **Step 4: Repeat Step 2 on the M1 bench (macOS)** — requires the `capture-mac` sidecar built per its README first. If the permission prompt appears, grant it and re-run; record the exact prompt wording in `docs/plans/lantern-plus/notes-macos-permission.md` for Task 13's onboarding copy.
Expected: same PASS criteria.

- [ ] **Step 5: Commit harness + evidence**

```bash
git add scripts/capture-smoke.mjs scripts/wav-energy.mjs docs/plans/lantern-plus/notes-macos-permission.md
git commit -m "test(capture): real-device capture smoke harness + Legion/M1 evidence (Wave 3a gate)"
```

---

## Phase 3b — Long-form local transcription pipeline

Phase deliverable: `transcribe_meeting(meeting_dir)` turns `audio.wav` into `transcript.json` — resumable, fully local, with Live/Battery-saver modes. Works for recorded AND imported audio files.

### Task 7: Windowed transcription queue over the existing sidecar

**Files:**
- Create: `src-tauri/src/commands/capture/transcribe.rs`
- Modify: `src-tauri/src/commands/capture/mod.rs`, `src-tauri/src/lib.rs`
- Test: inline `#[cfg(test)]` (fake transcriber seam)

**Interfaces:**
- Produces:
  - `trait WindowTranscriber: Send + Sync { fn transcribe_window(&self, wav_bytes: Vec<u8>) -> anyhow::Result<String>; }` — production impl wraps `ParakeetSidecar::transcribe` (`src-tauri/src/sidecars/parakeet.rs:79`, respecting its 30 s cap by construction: windows are `WINDOW_SECONDS = 25`).
  - `transcribe_meeting_audio(audio: &Path, out: &Path, meta: TranscriptMeta, t: &dyn WindowTranscriber) -> Result<()>` — splits each channel into 25 s windows with 2 s overlap, skips silent windows (RMS gate `SILENCE_RMS = 0.008`), transcribes, dedupes the overlap by trimming repeated leading words, writes `transcript.json` in the Meeting Artifact Contract schema (mic→speaker "You", sys→"Them"), sorted by `startMs`.
  - Resume: progress journal at `<meeting_dir>/.transcribe-progress.json` (`{ done: ["mic:0", "sys:25000", ...] }`) — windows listed there are skipped on re-run; the journal is deleted when the transcript is complete.
  - Tauri command: `transcribe_meeting(meeting_dir: String, model: Option<String>) -> Result<TranscribeMeetingResult, String>` where `TranscribeMeetingResult { transcript_path: String, segment_count: u32 }`.
- Consumes: `audio.wav` (Task 2), `SessionManifest` fields for `meta` (matterId, startedAt, consent).
- **Hard rule restated:** the ONLY transcriber is the local sidecar. There is no remote impl of `WindowTranscriber`, and none may ever be added.

- [ ] **Step 1: Write the failing tests (fake transcriber)**

```rust
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
        let spec = hound::WavSpec { channels: 2, sample_rate: 16_000, bits_per_sample: 16, sample_format: hound::SampleFormat::Int };
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
        let texts: Vec<&str> = t["segments"].as_array().unwrap().iter().map(|s| s["text"].as_str().unwrap()).collect();
        assert!(texts.contains(&"already"), "pre-completed window text must be kept");
    }

    fn test_meta(m: &str) -> TranscriptMeta {
        TranscriptMeta { started_at: "2026-07-02T00:00:00Z".into(), matter_id: m.into(),
            consent: crate::commands::capture::session::ConsentRecord { mode: "one-party".into(), confirmed_by: "user".into(), confirmed_at: "2026-07-02T00:00:00Z".into(), note: String::new() } }
    }
}
```

- [ ] **Step 2: Run to verify failure**

Run: `cd src-tauri && cargo test capture::transcribe -- --nocapture`
Expected: FAIL.

- [ ] **Step 3: Implement**

```rust
// src-tauri/src/commands/capture/transcribe.rs
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

fn rms(samples: &[i16]) -> f64 {
    if samples.is_empty() { return 0.0; }
    let sum: f64 = samples.iter().map(|&s| { let f = s as f64 / 32768.0; f * f }).sum();
    (sum / samples.len() as f64).sqrt()
}

fn wav_mono_bytes(samples: &[i16]) -> Vec<u8> {
    let spec = hound::WavSpec { channels: 1, sample_rate: super::chunks::SAMPLE_RATE, bits_per_sample: 16, sample_format: hound::SampleFormat::Int };
    let mut cursor = std::io::Cursor::new(Vec::new());
    {
        let mut w = hound::WavWriter::new(&mut cursor, spec).unwrap();
        for s in samples { w.write_sample(*s).unwrap(); }
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
    anyhow::ensure!(spec.channels == 2 && spec.sample_rate == super::chunks::SAMPLE_RATE,
        "expected 16 kHz stereo audio.wav");
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
                if rms(window) >= SILENCE_RMS {
                    let text = t.transcribe_window(wav_mono_bytes(window))?;
                    let text = trim_overlap(&prev_text, text.trim());
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
                progress.done.push(key);
                progress.partial = segments.clone();
                std::fs::write(&progress_path, serde_json::to_vec(&progress)?)?;
            } else if let Some(s) = segments.iter().filter(|s| s.channel == channel && s.start_ms == start_ms).last() {
                prev_text = s.text.clone();
            }
            start += step;
        }
    }

    segments.sort_by_key(|s| (s.start_ms, s.channel.clone()));
    let file = TranscriptFile {
        segments: &segments,
        meta: MetaOut { started_at: &meta.started_at, duration_ms, matter_id: &meta.matter_id, consent: &meta.consent },
    };
    std::fs::write(out, serde_json::to_vec_pretty(&file)?)?;
    let _ = std::fs::remove_file(&progress_path);
    Ok(())
}
```

- [ ] **Step 4: Run tests**

Run: `cd src-tauri && cargo test capture::transcribe -- --nocapture`
Expected: PASS (both tests).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/commands/capture/
git commit -m "feat(capture): resumable windowed local transcription pipeline (Wave 3b)"
```

### Task 8: `transcribe_meeting` command + sidecar wiring + shared TS types

**Files:**
- Modify: `src-tauri/src/commands/capture/transcribe.rs` (sidecar impl + command)
- Modify: `src-tauri/src/lib.rs` (register)
- Create: `src/platform/types/meeting.ts`
- Test: `tests/unit/meeting-types.test.ts` + cargo test for the arg plumbing

**Interfaces:**
- Produces (Rust): `SidecarTranscriber { binary: PathBuf }` implementing `WindowTranscriber` by blocking on `ParakeetSidecar::transcribe(wav_bytes, model)` (`tokio::runtime::Handle::current().block_on` from a `spawn_blocking` context — the command wraps the whole run in `tokio::task::spawn_blocking`). Command: `transcribe_meeting(app: AppHandle, meeting_dir: String, model: Option<String>)` — resolves the binary via `commands::voice::resolve_sidecar_path` (`src-tauri/src/commands/voice.rs:77`); errors with the exact string `"Voice sidecar binary not bundled for this platform"` when absent (UI shows "transcription queued until voice engine is installed" and the meeting stays recorded — capture never depends on transcription).
- Produces (TS): `src/platform/types/meeting.ts`:

```typescript
export interface TranscriptSegment {
  startMs: number;
  endMs: number;
  channel: 'mic' | 'sys';
  speaker: string; // "You" | "Them" in v1
  text: string;
}
export interface TranscriptConsent {
  mode: 'one-party' | 'two-party';
  confirmedBy: string;
  confirmedAt: string;
  note?: string;
}
export interface TranscriptFile {
  segments: TranscriptSegment[];
  meta: {
    startedAt: string;
    durationMs: number;
    matterId: string;
    consent: TranscriptConsent;
  };
}
export interface CaptureStatus {
  recording: boolean;
  meetingDir: string | null;
  elapsedMs: number;
}
```

- [ ] **Step 1: Write the failing TS test**

```typescript
// tests/unit/meeting-types.test.ts
import { describe, it, expect } from 'vitest';
import type { TranscriptFile } from '@/platform/types/meeting';

describe('meeting transcript schema', () => {
  it('accepts the canonical wire shape produced by transcribe_meeting', () => {
    const wire = {
      segments: [{ startMs: 0, endMs: 4200, channel: 'mic', speaker: 'You', text: 'hi' }],
      meta: {
        startedAt: '2026-07-02T17:03:00Z',
        durationMs: 2460000,
        matterId: 'm-abc123',
        consent: { mode: 'one-party', confirmedBy: 'user', confirmedAt: '2026-07-02T17:02:58Z' },
      },
    } satisfies TranscriptFile;
    expect(wire.segments[0].speaker).toBe('You');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/unit/meeting-types.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Create the TS types file (contents above), add the Rust command**

```rust
// appended to src-tauri/src/commands/capture/transcribe.rs
pub struct SidecarTranscriber {
    binary: std::path::PathBuf,
    model: Option<String>,
}

impl WindowTranscriber for SidecarTranscriber {
    fn transcribe_window(&self, wav_bytes: Vec<u8>) -> Result<String> {
        let sidecar = crate::sidecars::ParakeetSidecar::new(self.binary.clone());
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

#[tauri::command]
pub async fn transcribe_meeting(
    app: tauri::AppHandle,
    meeting_dir: String,
    model: Option<String>,
) -> Result<TranscribeMeetingResult, String> {
    let binary = crate::commands::voice::resolve_sidecar_path(&app)
        .ok_or_else(|| "Voice sidecar binary not bundled for this platform".to_string())?;
    let dir = std::path::PathBuf::from(&meeting_dir);
    let audio = dir.join("audio.wav");
    let out = dir.join("transcript.json");
    // Meta comes from the finalized transcript's neighbors: the manifest is
    // gone after finalize, so the CALLER passes matter context — read it from
    // the meeting store file written at capture_stop (Task 12 writes
    // meeting.json alongside; until then derive matter_id from the folder name).
    let meta = load_meta_for(&dir).map_err(|e| e.to_string())?;
    let t = SidecarTranscriber { binary, model };
    tokio::task::spawn_blocking(move || {
        transcribe_meeting_audio(&audio, &out, meta, &t).map(|_| out)
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())
    .map(|out| {
        let count = std::fs::read(&out)
            .ok()
            .and_then(|b| serde_json::from_slice::<serde_json::Value>(&b).ok())
            .and_then(|v| v["segments"].as_array().map(|a| a.len() as u32))
            .unwrap_or(0);
        TranscribeMeetingResult { transcript_path: out.to_string_lossy().into_owned(), segment_count: count }
    })
}
```

`load_meta_for` (same file): reads `<meeting_dir>/meeting.json` if present (written by Task 12's store with matterId/startedAt/consent), else reconstructs from the folder name + file mtimes with consent mode `"one-party"` and a `note: "meta reconstructed"`. Show the code:

```rust
pub fn load_meta_for(dir: &std::path::Path) -> Result<TranscriptMeta> {
    #[derive(serde::Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct MeetingJson { matter_id: String, started_at: String, consent: super::session::ConsentRecord }
    if let Ok(bytes) = std::fs::read(dir.join("meeting.json")) {
        let m: MeetingJson = serde_json::from_slice(&bytes)?;
        return Ok(TranscriptMeta { started_at: m.started_at, matter_id: m.matter_id, consent: m.consent });
    }
    let name = dir.file_name().and_then(|n| n.to_str()).unwrap_or("");
    let matter_id = name.splitn(2, '-').nth(1).map(|s| s.get(9..).unwrap_or(s)).unwrap_or("unknown").to_string();
    Ok(TranscriptMeta {
        started_at: chrono::Utc::now().to_rfc3339(),
        matter_id,
        consent: super::session::ConsentRecord { mode: "one-party".into(), confirmed_by: "user".into(), confirmed_at: chrono::Utc::now().to_rfc3339(), note: "meta reconstructed".into() },
    })
}
```

Register `transcribe_meeting` in `src-tauri/src/lib.rs`.

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/unit/meeting-types.test.ts && cd src-tauri && cargo test capture::`
Expected: both PASS.

- [ ] **Step 5: Sidecar end-to-end spot check (dev machine with sidecar staged)**

Run: `npm run fetch-voice-sidecar` then, with a recorded meeting dir from Task 6: invoke `transcribe_meeting` via the CDP driver.
Expected: `transcript.json` exists with ≥1 segment; every segment's `speaker` ∈ {"You","Them"}.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/commands/capture/ src-tauri/src/lib.rs src/platform/types/meeting.ts tests/unit/meeting-types.test.ts
git commit -m "feat(capture): transcribe_meeting command wired to local sidecar + shared TS schema (Wave 3b)"
```

### Task 9: Battery-saver mode + audio import path

**Files:**
- Create: `src/features/meetings/importMeetingAudio.ts`
- Modify: `src-tauri/src/commands/capture/transcribe.rs` (accept any mono/stereo WAV; convert on entry)
- Test: `tests/unit/import-meeting-audio.test.ts` + cargo test

**Interfaces:**
- Produces:
  - Setting `meetings.transcribeMode: 'live' | 'batch'` in the existing settings store (`'batch'` = transcription runs only when `capture_stop` fires AND (on AC or user taps "Transcribe now"); `'live'` v1 = start transcription immediately at stop — true during-meeting streaming is deliberately NOT in scope, matching the assessment's honesty note).
  - `importMeetingAudio(filePath: string, matterId: string): Promise<{ meetingDir: string }>` — copies a user-picked audio file (`.wav`/`.webm`/`.m4a`/`.mp3`) into a new meeting folder as `import-original.<ext>`, converts to `audio.wav` via the existing waveform decode path (`src/features/dictation/audio/` uses WebAudio decode — reuse `encodeWav16kMono` from `src/features/dictation/voice/VoiceCapture.ts:45`), then invokes `transcribe_meeting`. Imported audio is single-channel ⇒ all segments get `channel: "sys"`, `speaker: "Them"`, and the UI labels the meeting "imported — speakers not separated".
- Rust change: `transcribe_meeting_audio` accepts 1- or 2-channel input; mono input is treated as sys-only. Add the cargo test:

```rust
    #[test]
    fn mono_import_is_transcribed_as_sys_channel() {
        let dir = tempdir().unwrap();
        let spec = hound::WavSpec { channels: 1, sample_rate: 16_000, bits_per_sample: 16, sample_format: hound::SampleFormat::Int };
        let p = dir.path().join("audio.wav");
        let mut w = hound::WavWriter::create(&p, spec).unwrap();
        for _ in 0..(30 * 16_000) { w.write_sample(3000i16).unwrap(); }
        w.finalize().unwrap();
        let out = dir.path().join("transcript.json");
        transcribe_meeting_audio(&p, &out, test_meta("m-i"), &FakeT).unwrap();
        let t: serde_json::Value = serde_json::from_slice(&std::fs::read(&out).unwrap()).unwrap();
        assert!(t["segments"].as_array().unwrap().iter().all(|s| s["channel"] == "sys"));
    }
```

- [ ] **Step 1: Write the failing tests** (cargo test above + TS test that `importMeetingAudio` creates the folder layout and calls invoke with `transcribe_meeting` — mock `@tauri-apps/api/core` `invoke` the way neighboring tests in `tests/unit/` mock it).

```typescript
// tests/unit/import-meeting-audio.test.ts
import { describe, it, expect, vi } from 'vitest';
const invokeMock = vi.fn().mockResolvedValue({ transcriptPath: '/x/transcript.json', segmentCount: 3 });
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...a: unknown[]) => invokeMock(...a) }));
import { importMeetingAudio } from '@/features/meetings/importMeetingAudio';

describe('importMeetingAudio', () => {
  it('invokes transcribe_meeting for the created meeting dir', async () => {
    const { meetingDir } = await importMeetingAudio('/tmp/call.wav', 'm-77', {
      copyIntoMeetingFolder: vi.fn().mockResolvedValue('/ws/Clients/X/Meetings/2026-07-02-m-77'),
    });
    expect(meetingDir).toContain('Meetings');
    expect(invokeMock).toHaveBeenCalledWith('transcribe_meeting', expect.objectContaining({ meetingDir }));
  });
});
```

- [ ] **Step 2: Run both to verify failure** — `npx vitest run tests/unit/import-meeting-audio.test.ts` and `cargo test mono_import` → FAIL.

- [ ] **Step 3: Implement** — `importMeetingAudio` goes through `WorkspaceService` for all file writes (repo anti-pattern rule: no direct fs):

```typescript
// src/features/meetings/importMeetingAudio.ts
import { invoke } from '@tauri-apps/api/core';

export interface ImportDeps {
  /** Copies the source file into a fresh meeting folder for the matter and
   *  returns the meeting dir. Default impl uses WorkspaceService (all writes
   *  go through it) + the matter store's folder for `matterId`. */
  copyIntoMeetingFolder: (filePath: string, matterId: string) => Promise<string>;
}

export async function importMeetingAudio(
  filePath: string,
  matterId: string,
  deps: ImportDeps,
): Promise<{ meetingDir: string }> {
  const meetingDir = await deps.copyIntoMeetingFolder(filePath, matterId);
  await invoke('transcribe_meeting', { meetingDir, model: null });
  return { meetingDir };
}
```

(The default `copyIntoMeetingFolder` — wired in Task 12's store — converts non-WAV input with the WebAudio decode + `encodeWav16kMono` pipeline and writes `audio.wav` via `WorkspaceService`.) Loosen the Rust channel assertion per the interface note.

- [ ] **Step 4: Run tests** — both PASS.
- [ ] **Step 5: Commit**

```bash
git add src/features/meetings/ src-tauri/src/commands/capture/ tests/unit/import-meeting-audio.test.ts
git commit -m "feat(meetings): audio import path + batch transcribe mode (Wave 3b)"
```

---

## Phase 3c — Notes, timeline entry, viewer

Phase deliverable: stopping (or importing) a meeting produces `notes.docx` from a template, the meeting appears on the client's new **Meetings tab** (and as an Activity timeline entry), and clicking it opens notes + transcript with audio seek.

### Task 10: Meeting note template (Workflows engine) with timestamp citations

**Files:**
- Create: `src/features/workflows/engine/templates/advisors/MeetingNoteFromTranscript.ts` (sibling of `src/features/workflows/engine/templates/advisors/MeetingPrepAndSuitabilityNotes.ts` — copy that file's export/registration shape exactly, including how it registers in the advisors pack index)
- Test: `tests/unit/meeting-note-template.test.ts`

**Interfaces:**
- Produces: template id `meeting-note-from-transcript`, input: `{ transcript: TranscriptFile, clientName: string }`. Output sections (fixed v1 default per the UX brainstorm — NO template picker): **What changed · Decisions · Action items · Facts worth keeping**. Every generated bullet must end with a citation token of the exact form `[t:<startMs>]` (e.g. `[t:341000]`) referencing the transcript segment it came from — the viewer (Task 12) and RAG (Task 14) parse this token. Action items render as Word checkboxes (the docx engine's checkbox list style — same style `AnnualReviewPacket.ts` uses for its checklist section).
- **Prompt-injection rule:** transcript text entering the template's AI prompt is wrapped with the repo's external-content sanitization (same helper the email→AI path uses — find it via `grep -rn "sanitize" src/platform/providers/ src/features/ask/` and use that exact function; if the helper is `sanitizeExternalContent(text)`, wrap every segment).
- The template must run in Local-only mode (llama.cpp/Ollama provider) and BYOK mode identically — it consumes the `Provider` interface, never a concrete provider.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/meeting-note-template.test.ts
import { describe, it, expect } from 'vitest';
import { meetingNoteFromTranscript } from '@/features/workflows/engine/templates/advisors/MeetingNoteFromTranscript';

const transcript = {
  segments: [
    { startMs: 0, endMs: 5000, channel: 'mic' as const, speaker: 'You', text: 'Welcome back.' },
    { startMs: 341000, endMs: 349000, channel: 'sys' as const, speaker: 'Them', text: 'We want to fund a 529 for the grandkids this fall.' },
  ],
  meta: { startedAt: '2026-07-02T17:00:00Z', durationMs: 2460000, matterId: 'm-1', consent: { mode: 'one-party' as const, confirmedBy: 'user', confirmedAt: '2026-07-02T16:59:00Z' } },
};

describe('meeting note template', () => {
  it('builds a prompt containing sanitized transcript and demands [t:ms] citations', () => {
    const prompt = meetingNoteFromTranscript.buildPrompt({ transcript, clientName: 'The Hendersons' });
    expect(prompt).toContain('529');
    expect(prompt).toContain('[t:');           // citation instruction present
    expect(prompt).toContain('What changed');  // fixed sections
    expect(prompt).toContain('Action items');
  });

  it('post-processes model output: every bullet keeps a [t:ms] token that exists in the transcript', () => {
    const raw = '## What changed\n- Wants to fund a 529 [t:341000]\n- Invented fact [t:999999]\n';
    const cleaned = meetingNoteFromTranscript.enforceCitations(raw, transcript);
    expect(cleaned).toContain('[t:341000]');
    expect(cleaned).not.toContain('[t:999999]'); // token not in transcript → bullet dropped
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run tests/unit/meeting-note-template.test.ts` → FAIL.

- [ ] **Step 3: Implement** — follow `MeetingPrepAndSuitabilityNotes.ts` for the registration/type shape; the two functions under test:

```typescript
// core of src/features/workflows/engine/templates/advisors/MeetingNoteFromTranscript.ts
import type { TranscriptFile } from '@/platform/types/meeting';
// import the pack's Template type + registration exactly as MeetingPrepAndSuitabilityNotes.ts does.

const SECTIONS = ['What changed', 'Decisions', 'Action items', 'Facts worth keeping'] as const;

export function buildPrompt(input: { transcript: TranscriptFile; clientName: string }): string {
  const lines = input.transcript.segments
    .map((s) => `[t:${s.startMs}] ${s.speaker}: ${sanitizeExternalContent(s.text)}`)
    .join('\n');
  return [
    `You are drafting a meeting note for the client "${input.clientName}".`,
    `Sections, in order: ${SECTIONS.join(' · ')}.`,
    `Every bullet MUST end with the [t:<ms>] token of the segment it came from.`,
    `Only state things supported by a transcript line. Transcript:`,
    lines,
  ].join('\n\n');
}

export function enforceCitations(raw: string, transcript: TranscriptFile): string {
  const valid = new Set(transcript.segments.map((s) => `[t:${s.startMs}]`));
  return raw
    .split('\n')
    .filter((line) => {
      const m = line.match(/\[t:\d+\]/g);
      if (!line.trim().startsWith('-')) return true; // headings pass through
      return m !== null && m.every((tok) => valid.has(tok));
    })
    .join('\n');
}
```

Then wire `buildPrompt`/`enforceCitations` into the template object with the pack's standard `run()` that calls the `Provider`, converts the sectioned output to docx via the same docx-emit call `MeetingPrepAndSuitabilityNotes.ts` uses, and writes `notes.docx` into the meeting folder through `WorkspaceService`.

- [ ] **Step 4: Run tests** — PASS.
- [ ] **Step 5: Commit**

```bash
git add src/features/workflows/engine/templates/advisors/ tests/unit/meeting-note-template.test.ts
git commit -m "feat(meetings): meeting-note template with enforced transcript citations (Wave 3c)"
```

### Task 11: Meeting SourceRefs into the Client Map

**Files:**
- Modify: `src/platform/clientMap/updater.ts` (meetings become a fact source)
- Create: `src/features/meetings/meetingSources.ts`
- Test: `tests/unit/meeting-sources.test.ts`

**Interfaces:**
- Produces: `meetingSourceRef(meetingDir: string, segment: TranscriptSegment): SourceRef` returning `{ kind: 'meeting', ref: 'meeting:<meetingDir>#<startMs>', snippet: segment.text, locator: '<mm:ss>' }` — `SourceRef.kind 'meeting'` already exists (`src/platform/clientMap/types.ts:32`). The Client Map proposal pass (existing `proposeUpdates` in `updater.ts`) picks up meeting facts the same way it picks up email/CRM facts once RAG indexing (Task 14) makes segments retrievable; this task adds only the ref format + locator ("14:35" style) and the ref-resolution so clicking a meeting source opens the meeting entry at that timestamp (consumed by Task 12).

- [ ] **Step 1: Failing test**

```typescript
// tests/unit/meeting-sources.test.ts
import { describe, it, expect } from 'vitest';
import { meetingSourceRef, parseMeetingRef } from '@/features/meetings/meetingSources';

describe('meeting source refs', () => {
  const seg = { startMs: 875000, endMs: 880000, channel: 'sys' as const, speaker: 'Them', text: 'fund the 529' };
  it('builds a ref with kind meeting and mm:ss locator', () => {
    const ref = meetingSourceRef('/ws/Clients/H/Meetings/2026-07-02-m1', seg);
    expect(ref.kind).toBe('meeting');
    expect(ref.ref).toBe('meeting:/ws/Clients/H/Meetings/2026-07-02-m1#875000');
    expect(ref.locator).toBe('14:35');
  });
  it('round-trips through parseMeetingRef', () => {
    const parsed = parseMeetingRef('meeting:/ws/x/Meetings/2026-07-02-m1#875000');
    expect(parsed).toEqual({ meetingDir: '/ws/x/Meetings/2026-07-02-m1', startMs: 875000 });
  });
});
```

- [ ] **Step 2: Run to verify failure** — FAIL (module missing).

- [ ] **Step 3: Implement**

```typescript
// src/features/meetings/meetingSources.ts
import type { SourceRef } from '@/platform/clientMap/types';
import type { TranscriptSegment } from '@/platform/types/meeting';

export function mmss(ms: number): string {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function meetingSourceRef(meetingDir: string, seg: TranscriptSegment): SourceRef {
  return {
    kind: 'meeting',
    ref: `meeting:${meetingDir}#${seg.startMs}`,
    snippet: seg.text,
    locator: mmss(seg.startMs),
  };
}

export function parseMeetingRef(ref: string): { meetingDir: string; startMs: number } | null {
  const m = ref.match(/^meeting:(.+)#(\d+)$/);
  if (!m) return null;
  return { meetingDir: m[1], startMs: Number(m[2]) };
}
```

- [ ] **Step 4: Run tests** — PASS.
- [ ] **Step 5: Commit**

```bash
git add src/features/meetings/meetingSources.ts tests/unit/meeting-sources.test.ts
git commit -m "feat(meetings): meeting SourceRef format + locator for Client Map (Wave 3c)"
```

### Task 12: Record pill, meeting store, per-client Meetings tab, transcript viewer

> **2026-07-02 Jameson: meetings live on a per-client Meetings tab.** The meeting's
> primary home is a new **Meetings** sub-tab in the client surface's tab row
> (Client Map · Documents · Email · **Meetings** · Activity), NOT a fourth global nav
> tab and NOT a segmented toggle on the Clients home. Each finished meeting ALSO
> appears as an entry on that client's Activity timeline (reachable both ways).
> Acceptance prototype: `docs/design/lantern-plus-prototypes/p6-client-meetings-tab.html`.

This is the largest UI task; it composes existing pieces (AudioPlayer, docx editor tab, the client surface tab row) and the commands from 3a/3b.

**Files:**
- Create: `src/features/meetings/meetingStore.ts` (Zustand: `useMeetingStore`)
- Create: `src/features/meetings/RecordPill.tsx`
- Create: `src/features/meetings/ClientMeetingsTab.tsx` (the per-client Meetings sub-tab: a chronological list of THIS client's meetings, grouped by recency, each row → the meeting page; opens `MeetingEntry`)
- Create: `src/features/meetings/MeetingEntry.tsx` (the meeting page: notes + transcript + scrubber; opened from the Meetings tab and from the Activity entry)
- Create: `src/features/meetings/TranscriptViewer.tsx`
- Create: `src/features/meetings/index.ts`
- Modify: `src/features/matters/MatterHub.tsx` — add a `meetings` entry to `HUB_TABS` **between `email` and `activity`** (label "Meetings", following the existing sub-tab component/pattern exactly), and render `ClientMeetingsTab` when that sub-tab is active (list meetings by scanning the matter folder's `Meetings/` via `WorkspaceService.list`)
- Modify: `src/platform/matter/matterStore.ts` — add `'meetings'` to the `ClientMapHubTab` union so the sub-tab can be selected/routed like the others
- Modify: the client's Activity timeline surface to ALSO render each meeting as a timeline entry (same open action), so the meeting is reachable from Activity as well as the Meetings tab
- Modify: `src/app/shell/layout/MainPanel.tsx` — mount `RecordPill` (floats over all tabs) and register the meeting entry open action
- Test: `tests/unit/meeting-store.test.ts`

**Interfaces:**
- Produces `useMeetingStore` with: `startRecording(matterId)` (opens the consent dialog → invokes `capture_start` with the matter's folder from the matter store), `stopRecording()` (invokes `capture_stop`, writes `<meetingDir>/meeting.json` `{ matterId, startedAt, consent }` via WorkspaceService — this is the file Task 8's `load_meta_for` reads — then invokes `transcribe_meeting` per the `meetings.transcribeMode` setting, then runs the Task 10 template to produce `notes.docx`, then Task 14's indexing), `status: CaptureStatus` (polled every 1 s while recording), `orphans: OrphanSession[]` (checked once on app launch via `capture_find_orphans`; surfaced as the "Found a recording — finish the notes?" card).
- `RecordPill` renders: idle → nothing (a "Record meeting" button lives on the client's Meetings tab header); recording → floating pill with elapsed time, the egress indicator dot (reuse the existing egress indicator component — find via `grep -rn "egress" src/ --include=*.tsx -l`), and a Stop button. **The pill is the whole recording UI** (UX brainstorm rule).
- `ClientMeetingsTab` renders THIS client's meetings as a chronological list (recency groups; row = title, date, duration, review/synced badges) and a "Record a meeting" affordance; a row opens `MeetingEntry`. It reads only the active matter's `Meetings/` folder — it is per-client, never a cross-client inbox.
- `MeetingEntry` shows date, duration, consent stamp ("Consent noted · one-party"), a "Delete audio · keep transcript" retention action, and opens a split view: `notes.docx` in the existing docx editor on the left (open via the same file-open action the file tree uses), `TranscriptViewer` right. It opens both from the Meetings tab and from the matching Activity timeline entry.
- `TranscriptViewer` renders segments (speaker label + text + `mmss` timestamp); clicking a segment seeks the existing `AudioPlayer` (`src/features/dictation/audio/AudioPlayer.tsx`) to `startMs`; it accepts an optional `initialSeekMs` (used when opened from a `meeting:` SourceRef via `parseMeetingRef`, Task 11). Citation tokens `[t:ms]` inside opened notes render as clickable chips that call the same seek (hook into the docx viewer's link-click handler the way existing citation chips work in Ask — mirror that mechanism).

- [ ] **Step 1: Failing store test**

```typescript
// tests/unit/meeting-store.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
const invokeMock = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...a: unknown[]) => invokeMock(...a) }));
import { useMeetingStore } from '@/features/meetings/meetingStore';

describe('meeting store', () => {
  beforeEach(() => {
    invokeMock.mockReset();
    useMeetingStore.setState(useMeetingStore.getInitialState());
  });

  it('start → stop drives capture commands and post-processing in order', async () => {
    invokeMock
      .mockResolvedValueOnce({ meetingDir: '/ws/C/Meetings/x', startedAt: 't0' }) // capture_start
      .mockResolvedValueOnce({ meetingDir: '/ws/C/Meetings/x', audioPath: '/ws/C/Meetings/x/audio.wav', durationMs: 60000 }) // capture_stop
      .mockResolvedValueOnce({ transcriptPath: '/ws/C/Meetings/x/transcript.json', segmentCount: 4 }); // transcribe_meeting
    const s = useMeetingStore.getState();
    await s.startRecording('m-1', { consentMode: 'one-party' });
    expect(useMeetingStore.getState().status.recording).toBe(true);
    await useMeetingStore.getState().stopRecording();
    const calls = invokeMock.mock.calls.map((c) => c[0]);
    expect(calls).toEqual(['capture_start', 'capture_stop', 'transcribe_meeting']);
    expect(useMeetingStore.getState().status.recording).toBe(false);
  });

  it('refuses to start when already recording', async () => {
    invokeMock.mockResolvedValueOnce({ meetingDir: '/x', startedAt: 't0' });
    const s = useMeetingStore.getState();
    await s.startRecording('m-1', { consentMode: 'one-party' });
    await expect(
      useMeetingStore.getState().startRecording('m-2', { consentMode: 'one-party' }),
    ).rejects.toThrow(/already recording/i);
  });
});
```

- [ ] **Step 2: Run to verify failure** — FAIL.

- [ ] **Step 3: Implement the store** (component wiring follows the store; keep the store free of React):

```typescript
// src/features/meetings/meetingStore.ts
import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import type { CaptureStatus } from '@/platform/types/meeting';

interface StartOpts { consentMode: 'one-party' | 'two-party'; consentNote?: string }

interface MeetingState {
  status: CaptureStatus;
  startRecording: (matterId: string, opts: StartOpts) => Promise<void>;
  stopRecording: () => Promise<void>;
}

export const useMeetingStore = create<MeetingState>((set, get) => ({
  status: { recording: false, meetingDir: null, elapsedMs: 0 },
  async startRecording(matterId, opts) {
    if (get().status.recording) throw new Error('already recording');
    // matter folder resolution: matterStore (src/platform/matter/matterStore.ts)
    const matterFolder = resolveMatterFolder(matterId); // helper in this file, reads matterStore
    const workspace = resolveWorkspaceRoot();           // from useWorkspaceStore
    const r = await invoke<{ meetingDir: string; startedAt: string }>('capture_start', {
      workspace, matterId, matterFolder,
      consentMode: opts.consentMode, consentNote: opts.consentNote ?? null,
    });
    set({ status: { recording: true, meetingDir: r.meetingDir, elapsedMs: 0 } });
  },
  async stopRecording() {
    const r = await invoke<{ meetingDir: string; audioPath: string; durationMs: number }>('capture_stop', {});
    set({ status: { recording: false, meetingDir: null, elapsedMs: 0 } });
    await invoke('transcribe_meeting', { meetingDir: r.meetingDir, model: null });
    // notes.docx generation + RAG indexing are chained here in Task 14's step.
  },
}));
```

(`resolveMatterFolder` / `resolveWorkspaceRoot` are 5-line helpers reading the existing stores; write `meeting.json` via `WorkspaceService` right after `capture_stop` returns.) Then build the four components per the interface block, reusing: egress indicator component, `AudioPlayer`, the docx open action, and the Client Map card styles (copy the visual pattern of an existing timeline/source card in the clientMap UI folder).

- [ ] **Step 3b: Add the per-client Meetings tab** (Jameson's 2026-07-02 placement decision). Add `'meetings'` to the `ClientMapHubTab` union in `src/platform/matter/matterStore.ts`, then add its entry to `HUB_TABS` in `src/features/matters/MatterHub.tsx` **between `email` and `activity`** — `{ id: 'meetings', label: 'Meetings', Icon: Mic }` — following the exact shape of the neighbouring tabs, and render `ClientMeetingsTab` (scoped to the active matter) when `subTab === 'meetings'`. Also emit each finished meeting as an Activity timeline entry so it is reachable both ways. Match `docs/design/lantern-plus-prototypes/p6-client-meetings-tab.html`. Do NOT add a fourth item to the left Spine nav — the Spine stays three tabs.

- [ ] **Step 4: Run tests** — `npx vitest run tests/unit/meeting-store.test.ts` → PASS. Also run `npm run typecheck`.

- [ ] **Step 5: Manual UI pass in the browser dev build** — `npm run dev`, use the FakeSource? No: browser has no capture commands — verify UI states with the store mocked via devtools instead; the REAL end-to-end check is Step 6.

- [ ] **Step 6: Real end-to-end on the Legion**: record 2 minutes of a YouTube video playing + speak two sentences into the mic → stop → within the batch mode window, confirm: `transcript.json` has both "You" and "Them" segments; `notes.docx` opens in the app; the meeting appears on the client's **Meetings tab** (and as an Activity timeline entry); clicking a transcript line plays audio from that moment. Capture a screenshot for the PR.
Expected: all four confirmations true.

- [ ] **Step 7: Commit**

```bash
git add src/features/meetings/ src/app/shell/layout/MainPanel.tsx src/features/matters/ src/platform/matter/matterStore.ts tests/unit/meeting-store.test.ts
git commit -m "feat(meetings): record pill, meeting store, per-client Meetings tab, transcript viewer (Wave 3c)"
```

---

## Phase 3d — Consent & retention

⚠️ **xhigh review on Task 15 (retention).**

### Task 13: Consent dialog + per-client consent ledger + audit entries

**Files:**
- Create: `src/features/meetings/ConsentDialog.tsx`
- Create: `src/features/meetings/consentLedger.ts`
- Create: `src/features/meetings/recordingConsentLaw.ts` (static state table)
- Modify: `src/features/meetings/meetingStore.ts` (startRecording opens dialog first)
- Test: `tests/unit/recording-consent-law.test.ts`, `tests/unit/consent-ledger.test.ts`

**Interfaces:**
- Produces:
  - `recordingConsentLaw.ts`: `const TWO_PARTY_STATES: ReadonlySet<string>` (exactly: CA, CT, DE, FL, IL, MD, MA, MI, MT, NV, NH, OR, PA, VT, WA — the standard all-party-consent list; include a comment that this is guidance, not legal advice, and a `disclaimer` string exported for the UI) and `consentModeFor(stateCode: string | null): 'one-party' | 'two-party'` (unknown/null → `'two-party'`, the safe default).
  - `consentLedger.ts`: per-matter JSON at `<matter folder>/Meetings/.consent-ledger.json` (via WorkspaceService): `{ entries: [{ mode, scope: 'standing' | 'per-meeting', confirmedAt, note, meetingDir? }] }`, API `recordConsent(matterId, entry)`, `standingConsent(matterId): ConsentEntry | null`. When standing consent exists, the dialog pre-fills and shows "standing consent on file (dated)".
  - ConsentDialog copy (exact strings): title "Record this meeting?"; body line 1: "Recording stays on this computer. Nothing is uploaded."; two-party mode adds: "Your state requires everyone's consent. Suggested ask: \"I'd like to record this for my notes. Is that alright with everyone?\""; checkbox: "I have the consent I need"; primary button: "Start recording" (disabled until checked); the `disclaimer` string renders in small text.
  - Every recording start appends an audit entry through the existing audit command surface (find the exact command with `grep -rn "audit" src-tauri/src/lib.rs` and its frontend caller with `grep -rn "audit" src/platform/audit/AuditService.ts`; action string: `"meeting_capture_started"`, detail: `{ matterId, consentMode, meetingDir }`) — the store already appends `"meeting_recorded"` on stop (Task 4).

- [ ] **Step 1: Failing tests**

```typescript
// tests/unit/recording-consent-law.test.ts
import { describe, it, expect } from 'vitest';
import { consentModeFor, TWO_PARTY_STATES } from '@/features/meetings/recordingConsentLaw';

describe('recording consent law table', () => {
  it('classifies known states', () => {
    expect(consentModeFor('UT')).toBe('one-party');
    expect(consentModeFor('CA')).toBe('two-party');
    expect(TWO_PARTY_STATES.has('FL')).toBe(true);
  });
  it('defaults to two-party when state unknown', () => {
    expect(consentModeFor(null)).toBe('two-party');
    expect(consentModeFor('ZZ')).toBe('two-party');
  });
});
```

```typescript
// tests/unit/consent-ledger.test.ts — mock WorkspaceService the way existing
// unit tests do (grep tests/unit for "WorkspaceService" and copy the mock).
import { describe, it, expect, vi } from 'vitest';
import { makeConsentLedger } from '@/features/meetings/consentLedger';

describe('consent ledger', () => {
  it('records and finds standing consent', async () => {
    const files = new Map<string, string>();
    const ws = {
      read: vi.fn(async (p: string) => files.get(p) ?? null),
      write: vi.fn(async (p: string, c: string) => void files.set(p, c)),
    };
    const ledger = makeConsentLedger(ws as never, () => 'Clients/Hendersons');
    expect(await ledger.standingConsent('m-1')).toBeNull();
    await ledger.recordConsent('m-1', { mode: 'one-party', scope: 'standing', confirmedAt: 't1', note: 'email 6/12' });
    const sc = await ledger.standingConsent('m-1');
    expect(sc?.scope).toBe('standing');
  });
});
```

- [ ] **Step 2: Run to verify failure** — both FAIL.
- [ ] **Step 3: Implement** the three files per the interface block (the law table is a hardcoded set + function; the ledger is ~40 lines around the injected WorkspaceService pair; the dialog is a shadcn `Dialog` using the exact copy above). Wire `startRecording` to open the dialog and only invoke `capture_start` after confirmation, passing the chosen mode + note; append the audit entry; record per-meeting consent into the ledger.
- [ ] **Step 4: Run tests** — PASS; `npm run typecheck` clean.
- [ ] **Step 5: Also write** `docs/plans/lantern-plus/notes-macos-permission.md` consumers: add the macOS first-run permission explainer to the ConsentDialog flow — when `capture_start` fails with the sidecar's exit-3 permission error, show: "macOS needs your permission to hear meeting audio. This lets the app record what plays on this Mac. It is saved to your disk and nowhere else." with an "Open System Settings" button (`x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture`).
- [ ] **Step 6: Commit**

```bash
git add src/features/meetings/ tests/unit/recording-consent-law.test.ts tests/unit/consent-ledger.test.ts
git commit -m "feat(meetings): consent dialog, state-aware guidance, per-client consent ledger (Wave 3d)"
```

### Task 15: Retention actions + cache sweep (numbered 15 to keep 14 = RAG; execute in numeric order 13→14→15 is NOT required — 14 and 15 are independent)

⚠️ **xhigh review. Data-deletion correctness.**

**Files:**
- Create: `src-tauri/src/commands/capture/retention.rs`
- Modify: `src-tauri/src/commands/capture/mod.rs`, `src-tauri/src/lib.rs`
- Modify: `src/features/meetings/MeetingEntry.tsx` (the "Delete audio · keep transcript" action with confirmation)
- Test: inline cargo tests

**Interfaces:**
- Produces: `meeting_delete_audio(meeting_dir: String) -> Result<DeletedReport, String>` where `DeletedReport { removed: Vec<String> }`. MUST remove, if present: `audio.wav`, `import-original.*`, the whole `.capture/` dir, `.transcribe-progress.json` — and MUST leave `transcript.json`, `notes.docx`, `meeting.json` untouched. Appends audit entry `"meeting_audio_deleted"`. Also produces `sweep_capture_caches(workspace: String) -> Result<DeletedReport, String>` — deletes any `.capture/` or `.transcribe-progress.json` under meetings that already have a `transcript.json` (the "a deleted recording surviving in a temp dir is a trust-killer" rule).

- [ ] **Step 1: Failing test**

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn delete_audio_removes_every_audio_artifact_and_keeps_text() {
        let dir = tempdir().unwrap();
        let m = dir.path();
        std::fs::create_dir_all(m.join(".capture")).unwrap();
        for f in ["audio.wav", "import-original.m4a", ".transcribe-progress.json", "transcript.json", "notes.docx", "meeting.json"] {
            std::fs::write(m.join(f), b"x").unwrap();
        }
        std::fs::write(m.join(".capture/mic-000001.wav"), b"x").unwrap();
        let report = delete_audio(m).unwrap();
        assert!(!m.join("audio.wav").exists());
        assert!(!m.join("import-original.m4a").exists());
        assert!(!m.join(".capture").exists());
        assert!(!m.join(".transcribe-progress.json").exists());
        assert!(m.join("transcript.json").exists());
        assert!(m.join("notes.docx").exists());
        assert!(m.join("meeting.json").exists());
        assert!(report.removed.iter().any(|p| p.ends_with("audio.wav")));
    }
}
```

- [ ] **Step 2: Run to verify failure** — FAIL.
- [ ] **Step 3: Implement** `delete_audio` + `sweep_capture_caches` exactly per the interface (glob `import-original.*` via `read_dir` filter; audit append; both wrapped as Tauri commands and registered). UI action shows the confirm dialog with diff-preview convention: list of files that will be removed.
- [ ] **Step 4: Run tests** — PASS.
- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/commands/capture/ src-tauri/src/lib.rs src/features/meetings/
git commit -m "feat(meetings): retention delete-audio action + capture cache sweep (Wave 3d)"
```

---

## Phase 3e — Ask over meetings

### Task 14: Index transcripts into RAG + audio-seek citations in Ask

**Files:**
- Create: `src/features/meetings/indexMeeting.ts`
- Modify: `src-tauri/src/commands/capture/mod.rs` (new `capture_index_transcript` command — see the correction below)
- Modify: `src-tauri/src/lib.rs` (register the new command next to the other capture commands)
- Modify: `src/features/meetings/meetingStore.ts` (chain indexing after notes generation)
- Modify: the Ask citation-open handler (find with `grep -rn "citationId\|openSource" src/features/ask/ -l`) to route `meeting:` refs through `parseMeetingRef` → open `MeetingEntry` with `initialSeekMs`
- Test: `tests/unit/index-meeting.test.ts` + Rust test in `capture/mod.rs`

**Interfaces:**
- Consumes: `index_external_text_internal(workspace, source_id, plaintext, matter_id, source_type)` (`src-tauri/src/commands/connector/mod.rs:20` — validates the source type, fetches the vectors master key, indexes). **Correction (verified): there is NO existing `#[tauri::command]` wrapper around the connector indexing helpers and nothing registered in `lib.rs` — the helpers are `pub` internals the connector engines call from Rust. The frontend cannot invoke them. Step 1a below creates and registers a real command.**
- Produces (Rust): `capture_index_transcript(workspace: String, meeting_dir: String, source_id: String, text: String, matter_id: String) -> Result<u32, String>` — `source_type` is hard-coded to `"transcript"` inside the command (never caller-supplied), and `meeting_dir` is validated with the Task 4 path guard (`guard_meeting_path`) before any work so the command cannot be pointed outside the workspace.
- Produces: `indexMeeting(meetingDir, transcript: TranscriptFile): Promise<void>` — formats the transcript into speaker-turn blocks, one indexed doc per ~40 segments, `source_id = "meeting:<meetingDir>#<firstStartMs>"`, `source_type = "transcript"` (allowlisted at `src-tauri/src/commands/rag/store.rs:189`), text lines formatted `"[t:<startMs>] <speaker>: <text>"` so RAG hits carry the seekable token in their `chunkText`. Ask hits with `sourceType === 'transcript'` and a `meeting:` sourceId render a play-from-here citation chip (SourceRef mapping already routes `sourceType 'meeting'`→kind meeting in `src/platform/clientMap/types.ts:160-161`; transcript hits map to kind 'document' today — extend `sourceRefFromRagHit` with `sourceType === 'transcript' && sourceId.startsWith('meeting:')` → kind `'meeting'`).

- [ ] **Step 1a: Failing Rust test for `capture_index_transcript`, then the command**

Add to `src-tauri/src/commands/capture/mod.rs` (test first — it fails to compile until the command exists, which is the red step for this codebase):

```rust
#[cfg(test)]
mod index_transcript_tests {
    use super::*;

    #[tokio::test]
    async fn rejects_meeting_dir_outside_workspace() {
        let ws = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let err = capture_index_transcript(
            ws.path().to_string_lossy().into_owned(),
            outside.path().join("Meetings/x").to_string_lossy().into_owned(),
            "meeting:x#0".into(),
            "[t:0] You: hi".into(),
            "m-1".into(),
        )
        .await
        .unwrap_err();
        assert!(err.contains("escapes workspace"), "got: {err}");
    }
}
```

Implement in the same file and register in `src-tauri/src/lib.rs` inside `generate_handler![]` directly under the other capture commands (Task 4 added them at `src-tauri/src/lib.rs:99`):

```rust
/// Frontend-callable transcript indexing. `source_type` is fixed server-side;
/// `meeting_dir` must resolve inside the workspace (Task 4 guard) so a
/// compromised renderer cannot index arbitrary ids against arbitrary paths.
#[tauri::command]
pub async fn capture_index_transcript(
    workspace: String,
    meeting_dir: String,
    source_id: String,
    text: String,
    matter_id: String,
) -> Result<u32, String> {
    let ws = std::path::PathBuf::from(&workspace);
    guard_meeting_path(&ws, std::path::Path::new(&meeting_dir)).map_err(|e| e.to_string())?;
    crate::commands::connector::index_external_text_internal(
        &ws, &source_id, &text, &matter_id, "transcript",
    )
    .await
    .map(|n| n)
    .map_err(|e| format!("{e:#}"))
}
```

Run: `cargo test --manifest-path src-tauri/Cargo.toml -p lantern capture::index_transcript`
Expected: `test result: ok. 1 passed` (the reject test; the happy path is covered end-to-end in Step 5 because the keychain-backed master key is unavailable in unit tests).

Commit: `git add src-tauri/src/commands/capture/ src-tauri/src/lib.rs && git commit -m "feat(capture): registered capture_index_transcript command (path-guarded, server-fixed source_type)"`

- [ ] **Step 1: Failing test**

```typescript
// tests/unit/index-meeting.test.ts
import { describe, it, expect, vi } from 'vitest';
const invokeMock = vi.fn().mockResolvedValue(42);
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...a: unknown[]) => invokeMock(...a) }));
import { indexMeeting, formatForIndex } from '@/features/meetings/indexMeeting';

const transcript = {
  segments: Array.from({ length: 90 }, (_, i) => ({
    startMs: i * 10000, endMs: i * 10000 + 9000,
    channel: (i % 2 ? 'sys' : 'mic') as 'sys' | 'mic',
    speaker: i % 2 ? 'Them' : 'You',
    text: `line ${i}`,
  })),
  meta: { startedAt: 't0', durationMs: 900000, matterId: 'm-9', consent: { mode: 'one-party' as const, confirmedBy: 'user', confirmedAt: 't0' } },
};

describe('indexMeeting', () => {
  it('formats lines with seekable tokens and speakers', () => {
    const text = formatForIndex(transcript.segments.slice(0, 2));
    expect(text).toBe('[t:0] You: line 0\n[t:10000] Them: line 1');
  });
  it('splits into ~40-segment docs, each through capture_index_transcript', async () => {
    await indexMeeting('/ws/C/Meetings/x', transcript, '/ws');
    expect(invokeMock).toHaveBeenCalledTimes(3); // 90 segments → 3 docs
    expect(invokeMock.mock.calls[0][0]).toBe('capture_index_transcript');
    const args = invokeMock.mock.calls[0][1] as Record<string, unknown>;
    expect(args.workspace).toBe('/ws');
    expect(args.meetingDir).toBe('/ws/C/Meetings/x');
    expect(args.matterId).toBe('m-9');
    expect(String(args.sourceId)).toMatch(/^meeting:\/ws\/C\/Meetings\/x#0$/);
    expect('sourceType' in args).toBe(false); // fixed server-side, never caller-supplied
  });
});
```

- [ ] **Step 2: Run to verify failure** — FAIL.
- [ ] **Step 3: Implement** (`formatForIndex` is the mapper shown by the first assertion; `indexMeeting` chunks by 40 and invokes the Step 1a command: `invoke('capture_index_transcript', { workspace, meetingDir, sourceId, text, matterId })` — camelCase keys map to the Rust snake_case params; note there is NO `sourceType` argument, the command fixes it to `"transcript"` server-side). Chain `indexMeeting` into `stopRecording` after notes generation; extend `sourceRefFromRagHit` per the interface note; route Ask citation clicks for `meeting:` refs to the viewer.
- [ ] **Step 4: Run tests** — PASS; run the full frontend suite `npm run test`.
- [ ] **Step 5: End-to-end on the Legion:** with the Task 12 recording, open Ask scoped to that client, ask "what did we say about the 529?" → expect a cited answer whose citation chip opens the transcript at the right moment and plays audio.
- [ ] **Step 6: Commit**

```bash
git add src/features/meetings/ src/platform/clientMap/types.ts src/features/ask/ tests/unit/index-meeting.test.ts
git commit -m "feat(meetings): transcript RAG indexing + audio-seek citations in Ask (Wave 3e)"
```

### Task 16: Wave gate — full verification + merge

- [ ] **Step 1:** `npm run gate` → all green (paste output in the PR).
- [ ] **Step 2:** Repeat the two signature demo moves on the Legion and record evidence: (a) force-quit mid-recording → relaunch → recovery card → finished notes; (b) disconnect network mid-recording → everything still completes; egress indicator never left green. Screenshots into the PR.
- [ ] **Step 3:** `codex-review --base lantern-plus "Wave 3 meeting capture: focus on capture durability, retention deletion completeness, transcript schema consistency, prompt-injection from transcripts"` → fix findings → re-run gate.
- [ ] **Step 4:** Merge `lp/meeting-capture` → `lantern-plus`; `git merge origin/keepance-3.0` into `lantern-plus`; update `CHANGELOG.md` under `## [Unreleased]`; append the PRODUCT-JOURNEY entry ("meeting capture shipped in the parallel build — recorded on the advisor's own computer, never a bot"); `notify-jameson` MILESTONE.

### Task 17 (stretch, only if the wave is green and capacity remains): Windows per-process loopback

Isolate capture to the meeting app's process (`ActivateAudioInterfaceAsync` with target PID, Win10 2004+) so background audio (music, notifications) never enters the recording. New file `src-tauri/src/commands/capture/win_process_loopback.rs`, feature-flagged behind setting `meetings.perProcessCapture` (default off). Requires the `windows` crate's `Win32_Media_Audio` features. Falls back silently to device loopback when activation fails. Test: device-level only (Legion): play music in Spotify + tone in the browser, record with the flag on, verify `wav-energy.mjs` shows tone-only energy after stopping Spotify… (full harness steps mirror Task 6). This task may be dropped without affecting the wave.

---

## Self-review (done at planning time)

- **Spec coverage:** capture engine per-OS ✓ (T3/T4), crash durability ✓ (T1/T5/T6), 30 s cap bypassed via windowing ✓ (T7), Live/batch modes ✓ (T9 — deliberately scoped: "live" = transcribe at stop; true streaming explicitly out), two-channel speakers ✓ (T7), .docx notes + citations ✓ (T10), per-client Meetings tab + Activity entry / no fourth Spine tab ✓ (T12, per Jameson 2026-07-02), consent flow + ledger + state table ✓ (T13), retention + sweep ✓ (T15), RAG + audio-seek Ask ✓ (T11/T14), macOS permission onboarding ✓ (T6 evidence + T13 step 5), per-process loopback stretch ✓ (T17).
- **Known deliberate gaps (match the assessment's honesty notes):** no tray residency v1 (app must be open; recorded in LANTERN-PLUS risks), no VAD model (RMS gate v1; silero is a Wave 4 candidate), no live in-meeting note drafts, imported audio has no speaker split.
- **Type consistency:** `transcript.json` schema identical in master plan / Task 2 Rust / Task 8 TS; command names `capture_start/stop/status`, `capture_find_orphans`, `capture_recover`, `transcribe_meeting`, `meeting_delete_audio`, `sweep_capture_caches` used consistently; citation token `[t:<startMs>]` consistent across T10/T12/T14.
