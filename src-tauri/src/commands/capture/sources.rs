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

impl AudioSource for CpalSource {
    fn start(&mut self, mut on_samples: Box<dyn FnMut(&[i16]) + Send>) -> Result<()> {
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
            let stream = device.build_input_stream(
                &config.into(),
                move |data: &[f32], _: &cpal::InputCallbackInfo| {
                    let mono16 = downmix_resample(data, channels, rate);
                    on_samples(&mono16);
                },
                |e| log::warn!("capture stream error: {e}"),
                None,
            );
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
