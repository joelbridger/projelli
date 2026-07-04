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
