// ParakeetSidecar — voice transcription via bundled Parakeet / whisper.cpp.
//
// Lifecycle shape: fire-and-forget (per-request subprocess).
// Unlike a daemon sidecar, Parakeet is spawned fresh for every transcription
// request, reads WAV bytes from stdin, writes text to stdout, then exits.
//
// Consequently:
//   - start() / stop() are no-ops (nothing to persist)
//   - is_running() always returns false (no resident process)
//
// The real work is done by `transcribe()`, which is specific to Parakeet and
// lives outside the generic Sidecar trait.
//
// Concurrency note: `process` and `running` never escape this struct between
// calls, so the required `Send + Sync` bounds are trivially satisfied.

use super::Sidecar;
use anyhow::Result;
use std::path::PathBuf;
use std::time::{Duration, Instant};
use tokio::io::AsyncWriteExt;

/// Hard cap on a single transcription. Mirrors the constant in
/// `commands/voice.rs` so both call-sites enforce the same limit.
const TRANSCRIBE_TIMEOUT_SECS: u64 = 30;

/// Per-request transcription result. Mirrors `TranscribeResult` in
/// `commands/voice.rs` (kept separate to avoid coupling the sidecar module
/// to the Tauri command layer).
pub struct TranscribeOutput {
    pub text: String,
    pub latency_ms: u64,
}

pub struct ParakeetSidecar {
    binary: PathBuf,
}

impl ParakeetSidecar {
    pub fn new(binary: PathBuf) -> Self {
        Self { binary }
    }

    /// Binary-name–based arg builder. Whisper.cpp uses `--stdin`; Parakeet.cpp
    /// uses `-`. Both accept an optional `--model` arg.
    ///
    /// This is the same logic as `commands::voice::build_transcribe_args` —
    /// re-implemented here so the sidecar module is self-contained. Tests in
    /// `commands/voice.rs` continue to cover the original path; tests here
    /// cover the sidecar path.
    pub fn build_args(&self, model: Option<&str>) -> Vec<String> {
        let mut args: Vec<String> = Vec::new();
        let name = self
            .binary
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("parakeet")
            .to_ascii_lowercase();

        if name.contains("whisper") {
            args.push("--stdin".to_string());
            args.push("--no-timestamps".to_string());
            if let Some(m) = model {
                args.push("--model".to_string());
                args.push(m.to_string());
            }
        } else {
            args.push("-".to_string());
            if let Some(m) = model {
                args.push("--model".to_string());
                args.push(m.to_string());
            }
        }
        args
    }

    /// Spawn a fresh subprocess, pipe WAV bytes to stdin, and collect the
    /// transcription from stdout. Errors on non-zero exit or timeout.
    pub async fn transcribe(
        &self,
        wav_bytes: Vec<u8>,
        model: Option<&str>,
    ) -> Result<TranscribeOutput> {
        use tokio::process::Command;
        use tokio::time::timeout;
        use crate::util::proc::hide_console_tokio;

        let args = self.build_args(model);
        let started = Instant::now();

        let mut cmd = Command::new(&self.binary);
        cmd.args(&args)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped());
        hide_console_tokio(&mut cmd);
        let mut child = cmd.spawn()?;

        if let Some(mut stdin) = child.stdin.take() {
            let bytes = wav_bytes.clone();
            tokio::spawn(async move {
                let _ = stdin.write_all(&bytes).await;
                let _ = stdin.flush().await;
                drop(stdin);
            });
        }

        let output = timeout(
            Duration::from_secs(TRANSCRIBE_TIMEOUT_SECS),
            child.wait_with_output(),
        )
        .await
        .map_err(|_| anyhow::anyhow!("voice sidecar timed out"))??;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(anyhow::anyhow!(
                "voice sidecar exited {}: {}",
                output.status.code().unwrap_or(-1),
                stderr.trim()
            ));
        }

        let text = String::from_utf8_lossy(&output.stdout).trim().to_string();
        Ok(TranscribeOutput {
            text,
            latency_ms: started.elapsed().as_millis() as u64,
        })
    }
}

// Sidecar trait impl. For this fire-and-forget design, start/stop/is_running
// are intentional no-ops. The trait is implemented so ParakeetSidecar can be
// stored as a `Box<dyn Sidecar>` alongside future long-lived sidecars.
impl Sidecar for ParakeetSidecar {
    fn name(&self) -> &str {
        "parakeet"
    }

    fn binary_path(&self) -> PathBuf {
        self.binary.clone()
    }

    /// No-op: Parakeet is spawned per-request, not kept alive.
    fn start(&mut self) -> Result<()> {
        Ok(())
    }

    /// No-op: no resident process to terminate.
    fn stop(&mut self) -> Result<()> {
        Ok(())
    }

    /// Always false: no resident process between requests.
    fn is_running(&self) -> bool {
        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sidecar(name: &str) -> ParakeetSidecar {
        ParakeetSidecar::new(PathBuf::from(format!("/fake/bin/{name}")))
    }

    // --- Sidecar trait ---

    #[test]
    fn name_is_parakeet() {
        let s = sidecar("parakeet");
        assert_eq!(s.name(), "parakeet");
    }

    #[test]
    fn binary_path_round_trips() {
        let path = PathBuf::from("/fake/bin/parakeet");
        let s = ParakeetSidecar::new(path.clone());
        assert_eq!(s.binary_path(), path);
    }

    #[test]
    fn lifecycle_noop_does_not_panic() {
        let mut s = sidecar("parakeet");
        // Fire-and-forget: start/stop are no-ops.
        s.start().unwrap();
        assert!(!s.is_running());
        s.stop().unwrap();
        assert!(!s.is_running());
    }

    // --- Arg builder (mirrors commands/voice.rs tests) ---

    #[test]
    fn build_args_parakeet_binary() {
        let s = sidecar("parakeet");
        let args = s.build_args(None);
        assert_eq!(args.first().map(String::as_str), Some("-"));
        assert!(!args.iter().any(|a| a == "--model"));
    }

    #[test]
    fn build_args_parakeet_with_model() {
        let s = sidecar("parakeet");
        let args = s.build_args(Some("small"));
        assert_eq!(args.first().map(String::as_str), Some("-"));
        assert!(args.contains(&"--model".to_string()));
        assert!(args.contains(&"small".to_string()));
    }

    #[test]
    fn build_args_whisper_binary() {
        let s = sidecar("whisper");
        let args = s.build_args(Some("small"));
        assert!(args.contains(&"--stdin".to_string()));
        assert!(args.contains(&"--no-timestamps".to_string()));
        assert!(args.contains(&"--model".to_string()));
    }

    #[test]
    fn build_args_case_insensitive() {
        // Binary name may be "Parakeet-X86.exe" from CI.
        let s = sidecar("Parakeet-X86.exe");
        let args = s.build_args(None);
        assert_eq!(args.first().map(String::as_str), Some("-"));
    }

    #[tokio::test]
    async fn transcribe_errors_when_binary_missing() {
        let s = ParakeetSidecar::new(PathBuf::from("/nonexistent-parakeet-abc"));
        let result = s.transcribe(b"fake_wav".to_vec(), None).await;
        assert!(result.is_err(), "expected error when binary is missing");
    }
}
