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

/// Stateful wrapper around the same downmix+resample math as
/// `downmix_resample`, but carrying the fractional resample position
/// across calls. `downmix_resample` alone is only correct for a single,
/// complete buffer: cpal delivers audio in many small callbacks (e.g. 1024
/// frames), and rounding `out_len` fresh in each call resets the phase to
/// zero every time — for a 48kHz→16kHz stream with 1024-frame callbacks
/// that's a systematic ~0.33-sample loss per callback, compounding to
/// several seconds of mic/system-channel drift over a multi-hour meeting.
/// `Resampler::push` tracks the leftover phase as real state instead.
pub struct Resampler {
    /// Fractional source-sample position of the next output sample,
    /// relative to the start of the NEXT `push()` call's buffer (can be
    /// negative-of-zero..1.0, i.e. "this many source samples into the next
    /// buffer before the next output sample is due").
    phase: f64,
}

impl Resampler {
    pub fn new() -> Self {
        Self { phase: 0.0 }
    }

    pub fn push(&mut self, input: &[f32], channels: u16, src_rate: u32) -> Vec<i16> {
        let ch = channels.max(1) as usize;
        let frames = input.len() / ch;
        if frames == 0 {
            return Vec::new();
        }
        let mono: Vec<f32> = (0..frames)
            .map(|f| input[f * ch..f * ch + ch].iter().sum::<f32>() / ch as f32)
            .collect();
        let dst_rate = super::chunks::SAMPLE_RATE as f64;
        let step = src_rate as f64 / dst_rate; // source samples per output sample
        let mut out = Vec::new();
        let mut pos = self.phase;
        while (pos.floor() as usize) < frames {
            let idx = pos.floor() as usize;
            let frac = (pos - pos.floor()) as f32;
            let a = mono[idx];
            // Boundary approximation: the true next sample may live in the
            // NEXT callback's buffer, not yet available. Repeating `a`
            // here only affects the one output sample nearest each
            // callback boundary and does not accumulate — unlike the
            // phase itself, which is carried exactly below.
            let b = *mono.get(idx + 1).unwrap_or(&a);
            let v = a + (b - a) * frac;
            out.push((v.clamp(-1.0, 1.0) * 32_767.0) as i16);
            pos += step;
        }
        self.phase = pos - frames as f64;
        out
    }
}

// ---------- cpal-backed sources (Windows/Linux mic + loopback; mac mic) ----
//
// cpal's `Device`/`Stream` types are NOT `Send` on every backend (ALSA wraps
// a raw pointer marker that makes `Stream: !Send`). `AudioSource: Send` is
// required so the engine can hold `Box<dyn AudioSource>` behind a `Mutex`.
// The correct fix (not a workaround) is the standard cpal pattern: a
// dedicated OS thread owns the `Device`/`Stream` for their entire lifetime —
// they are built AND dropped on that thread, never touched from outside it.
// Only a `Sender<()>` (stop signal) and a `JoinHandle<()>` cross the thread
// boundary, and both are trivially `Send`.

#[derive(Clone, Copy)]
pub enum DeviceKind {
    DefaultInput,
    DefaultOutput,
    /// Linux only: the PipeWire/Pulse `*.monitor` input device.
    LinuxMonitor,
}

pub struct CpalSource {
    kind: DeviceKind,
    control_tx: Option<std::sync::mpsc::Sender<()>>,
    join: Option<std::thread::JoinHandle<()>>,
}

impl CpalSource {
    pub fn new(kind: DeviceKind) -> Self {
        Self { kind, control_tx: None, join: None }
    }

    fn resolve_device(kind: DeviceKind) -> Result<cpal::Device> {
        use cpal::traits::HostTrait;
        let host = cpal::default_host();
        match kind {
            DeviceKind::DefaultInput => host
                .default_input_device()
                .ok_or_else(|| anyhow!("no microphone device")),
            DeviceKind::DefaultOutput => host
                .default_output_device()
                .ok_or_else(|| anyhow!("no output device for loopback")),
            DeviceKind::LinuxMonitor => {
                use cpal::traits::DeviceTrait;
                host.input_devices()?
                    .find(|d| d.name().map(|n| n.contains("monitor")).unwrap_or(false))
                    .ok_or_else(|| anyhow!("no monitor (loopback) device found"))
            }
        }
    }
}

/// Build a stream for one concrete cpal sample type, converting every
/// sample to f32 before handing it to the existing `downmix_resample` path.
/// Devices are free to report any native format (WASAPI shared-mode is
/// nearly always F32, but cheaper USB mics commonly report I16/U16) —
/// hardcoding an `&[f32]` callback made `build_input_stream` fail outright
/// on any non-F32 device, so `capture_start` would reject an otherwise
/// perfectly good microphone.
fn build_typed_stream<T>(
    device: &cpal::Device,
    stream_config: &cpal::StreamConfig,
    channels: u16,
    rate: u32,
    mut on_samples: Box<dyn FnMut(&[i16]) + Send>,
) -> std::result::Result<cpal::Stream, cpal::BuildStreamError>
where
    T: cpal::SizedSample,
    f32: cpal::FromSample<T>,
{
    use cpal::traits::DeviceTrait;
    use cpal::Sample as _;
    let mut resampler = Resampler::new();
    device.build_input_stream(
        stream_config,
        move |data: &[T], _: &cpal::InputCallbackInfo| {
            let as_f32: Vec<f32> = data.iter().map(|&s| f32::from_sample(s)).collect();
            let mono16 = resampler.push(&as_f32, channels, rate);
            on_samples(&mono16);
        },
        |e| log::warn!("capture stream error: {e}"),
        None,
    )
}

impl AudioSource for CpalSource {
    fn start(&mut self, on_samples: Box<dyn FnMut(&[i16]) + Send>) -> Result<()> {
        use cpal::traits::{DeviceTrait, StreamTrait};
        let (stop_tx, stop_rx) = std::sync::mpsc::channel::<()>();
        let (ready_tx, ready_rx) = std::sync::mpsc::channel::<std::result::Result<(), String>>();
        let kind = self.kind;
        let join = std::thread::spawn(move || {
            let device = match Self::resolve_device(kind) {
                Ok(d) => d,
                Err(e) => {
                    let _ = ready_tx.send(Err(e.to_string()));
                    return;
                }
            };
            let config = match kind {
                DeviceKind::DefaultOutput => device.default_output_config(),
                _ => device.default_input_config(),
            };
            let config = match config {
                Ok(c) => c,
                Err(e) => {
                    let _ = ready_tx.send(Err(e.to_string()));
                    return;
                }
            };
            let channels = config.channels();
            let rate = config.sample_rate().0;
            let format = config.sample_format();
            let stream_config: cpal::StreamConfig = config.into();
            let stream = match format {
                cpal::SampleFormat::F32 => {
                    build_typed_stream::<f32>(&device, &stream_config, channels, rate, on_samples)
                }
                cpal::SampleFormat::I16 => {
                    build_typed_stream::<i16>(&device, &stream_config, channels, rate, on_samples)
                }
                cpal::SampleFormat::U16 => {
                    build_typed_stream::<u16>(&device, &stream_config, channels, rate, on_samples)
                }
                other => {
                    let _ = ready_tx.send(Err(format!("unsupported device sample format: {other:?}")));
                    return;
                }
            };
            let stream = match stream {
                Ok(s) => s,
                Err(e) => {
                    let _ = ready_tx.send(Err(e.to_string()));
                    return;
                }
            };
            if let Err(e) = stream.play() {
                let _ = ready_tx.send(Err(e.to_string()));
                return;
            }
            let _ = ready_tx.send(Ok(()));
            // Block this thread — and keep `stream` alive — until told to stop.
            let _ = stop_rx.recv();
            drop(stream);
        });
        match ready_rx.recv() {
            Ok(Ok(())) => {}
            Ok(Err(e)) => return Err(anyhow!(e)),
            Err(_) => return Err(anyhow!("audio capture thread exited before starting")),
        }
        self.control_tx = Some(stop_tx);
        self.join = Some(join);
        Ok(())
    }

    fn stop(&mut self) -> Result<()> {
        if let Some(tx) = self.control_tx.take() {
            let _ = tx.send(());
        }
        if let Some(j) = self.join.take() {
            let _ = j.join();
        }
        Ok(())
    }
}

pub fn mic_source() -> Result<Box<dyn AudioSource>> {
    Ok(Box::new(CpalSource::new(DeviceKind::DefaultInput)))
}

#[cfg(target_os = "windows")]
pub fn loopback_source() -> Result<Box<dyn AudioSource>> {
    // WASAPI loopback: open the default OUTPUT device as an input stream.
    Ok(Box::new(CpalSource::new(DeviceKind::DefaultOutput)))
}

#[cfg(target_os = "linux")]
pub fn loopback_source() -> Result<Box<dyn AudioSource>> {
    // PipeWire/Pulse expose "<sink>.monitor" as an input device.
    Ok(Box::new(CpalSource::new(DeviceKind::LinuxMonitor)))
}

#[cfg(target_os = "macos")]
pub fn loopback_source() -> Result<Box<dyn AudioSource>> {
    MacTapSource::spawn()
}

// Plain OS thread + std::process (not tokio) for the same reason as
// `CpalSource` above: `AudioSource::stop()` is a synchronous method that
// `CaptureEngine::stop()` calls right before `finalize_session()` reads the
// chunk files off disk. `finalize_session()` must never run until every
// sample the sidecar already wrote has been drained and handed to the
// `ChunkWriter` — with a detached `tokio::spawn` reader, `stop()` could
// return (and finalize could start) before the reader task's last
// `on_samples()` call lands, silently dropping the tail of the loopback
// channel. A real `std::thread::JoinHandle` gives `stop()` a synchronous
// `.join()` with no async-runtime hazards (calling `Handle::block_on` from
// inside an already-async Tauri command panics — see
// `commands::capture::transcribe::SidecarTranscriber` for the
// `spawn_blocking` workaround this file deliberately avoids needing).
#[cfg(target_os = "macos")]
pub struct MacTapSource {
    child: Option<std::process::Child>,
    reader: Option<std::thread::JoinHandle<()>>,
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
        Ok(Box::new(Self { child: None, reader: None }))
    }
}

#[cfg(target_os = "macos")]
impl AudioSource for MacTapSource {
    fn start(&mut self, mut on_samples: Box<dyn FnMut(&[i16]) + Send>) -> Result<()> {
        use std::io::Read;
        let binary = crate::commands::capture::mac_sidecar_path()
            .ok_or_else(|| anyhow!("capture-mac sidecar not bundled"))?;
        let mut child = std::process::Command::new(binary)
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()?;

        // Permission-denial handshake: the sidecar contract says it exits 3
        // immediately (before writing any PCM) when it lacks the macOS
        // System Audio/Screen Recording permission. Give it a short grace
        // period to fail fast so capture_start surfaces the real error
        // instead of silently recording an empty system channel.
        std::thread::sleep(std::time::Duration::from_millis(300));
        if let Ok(Some(status)) = child.try_wait() {
            let mut stderr_msg = String::new();
            if let Some(mut stderr) = child.stderr.take() {
                let _ = stderr.read_to_string(&mut stderr_msg);
            }
            let stderr_msg = stderr_msg.trim();
            return Err(anyhow!(
                "capture-mac sidecar exited immediately (code {}): {}",
                status.code().unwrap_or(-1),
                if stderr_msg.is_empty() {
                    "no stderr output — likely missing System Audio/Screen Recording permission"
                } else {
                    stderr_msg
                }
            ));
        }

        let mut stdout = child.stdout.take().ok_or_else(|| anyhow!("no stdout"))?;
        let reader = std::thread::spawn(move || {
            let mut buf = [0u8; 4096];
            // stdout is a raw byte stream — a single `read` is not
            // guaranteed to land on a 2-byte (i16) boundary. Carrying over
            // a stray trailing byte to the next read (instead of
            // `chunks_exact(2)` silently dropping it) is required: dropping
            // it would permanently shift every subsequent sample's byte
            // pairing for the rest of the recording, not just lose one byte.
            let mut carry: Vec<u8> = Vec::new();
            loop {
                match stdout.read(&mut buf) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => {
                        carry.extend_from_slice(&buf[..n]);
                        let usable = carry.len() - (carry.len() % 2);
                        if usable > 0 {
                            let samples: Vec<i16> = carry[..usable]
                                .chunks_exact(2)
                                .map(|b| i16::from_le_bytes([b[0], b[1]]))
                                .collect();
                            carry.drain(..usable);
                            on_samples(&samples);
                        }
                    }
                }
            }
        });
        self.child = Some(child);
        self.reader = Some(reader);
        Ok(())
    }
    fn stop(&mut self) -> Result<()> {
        if let Some(mut c) = self.child.take() {
            // Graceful first — matches the sidecar's documented contract
            // ("flush + exit 0 on SIGTERM") — with a bounded poll so a
            // misbehaving sidecar can't hang the stop path; hard-kill only
            // as the backstop.
            unsafe {
                libc::kill(c.id() as i32, libc::SIGTERM);
            }
            let deadline = std::time::Instant::now() + std::time::Duration::from_secs(3);
            loop {
                match c.try_wait() {
                    Ok(Some(_)) => break,
                    Ok(None) if std::time::Instant::now() < deadline => {
                        std::thread::sleep(std::time::Duration::from_millis(50));
                    }
                    _ => {
                        let _ = c.kill();
                        let _ = c.wait();
                        break;
                    }
                }
            }
        }
        // Join the reader thread so any PCM already sitting in the pipe
        // buffer is fully drained (and written through on_samples) before
        // this returns — finalize_session() runs right after stop() and
        // must not race the reader for the tail of the recording.
        if let Some(r) = self.reader.take() {
            let _ = r.join();
        }
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
