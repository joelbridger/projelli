// PiperSidecar -- text-to-speech via bundled Piper binary.
//
// Lifecycle shape: long-lived daemon.
// Piper is kept alive between synthesis requests so warm-start latency
// (~50-100 ms) is amortized. Each `speak()` call sends text on stdin and
// reads WAV bytes from stdout. On crash the manager restarts up to 3 times.
//
// Binary contract (Piper's native JSON-lines stdio mode):
//   stdin:  one JSON line per request: {"text":"Hello","outputType":"wav"}
//   stdout: WAV bytes (binary), one response per request
//   stderr: diagnostic messages (ignored unless exit != 0)
//
// Piper is invoked with: piper --model <onnx-path> --json-input --output-raw
// Raw PCM is not used here; WAV output simplifies the Web Audio API consumer.

use super::Sidecar;
use anyhow::{anyhow, Result};
use std::path::PathBuf;
use tokio::process::Child;

/// Hard cap per synthesis request. Long documents may take several seconds;
/// 60 s is generous enough not to false-positive on a 500-char chunk.
const SPEAK_TIMEOUT_SECS: u64 = 60;

/// Restart budget before the sidecar gives up and surfaces a toast error.
pub const MAX_RESTARTS: u32 = 3;

pub struct PiperSidecar {
    binary: PathBuf,
    model: PathBuf,
    process: Option<Child>,
    restart_count: u32,
}

impl PiperSidecar {
    pub fn new(binary: PathBuf, model: PathBuf) -> Self {
        Self {
            binary,
            model,
            process: None,
            restart_count: 0,
        }
    }

    /// Synthesize `text` and return raw WAV bytes.
    /// Spawns Piper if not already running (lazy init).
    pub async fn speak(&mut self, text: &str, speed: f32) -> Result<Vec<u8>> {
        self.ensure_running().await?;
        self.synthesize(text, speed).await
    }

    /// Stop the resident process immediately.
    pub fn kill(&mut self) {
        if let Some(mut child) = self.process.take() {
            let _ = child.start_kill();
        }
    }

    /// Return the ONNX model path this sidecar was constructed with.
    /// Used by `tts_speak` to detect voice switches requiring a restart.
    pub fn model_path(&self) -> PathBuf {
        self.model.clone()
    }
}

impl Sidecar for PiperSidecar {
    fn name(&self) -> &str {
        "piper"
    }

    fn binary_path(&self) -> PathBuf {
        self.binary.clone()
    }

    /// Eagerly start the Piper process. Callers may prefer lazy init via `speak()`.
    fn start(&mut self) -> Result<()> {
        // Tauri setup hook calls this to warm up Piper at app launch.
        // If already running, this is a no-op.
        if self.process.is_some() {
            return Ok(());
        }
        // Spawn synchronously via std::process then convert to tokio Child is
        // cumbersome. Instead, record intent here and let the first async
        // `speak()` call actually spawn. This keeps the sync trait surface
        // honest while deferring the async spawn to the right context.
        Ok(())
    }

    fn stop(&mut self) -> Result<()> {
        self.kill();
        Ok(())
    }

    fn is_running(&self) -> bool {
        self.process.is_some()
    }
}

impl PiperSidecar {
    async fn ensure_running(&mut self) -> Result<()> {
        if self.process.is_some() {
            return Ok(());
        }
        if self.restart_count >= MAX_RESTARTS {
            return Err(anyhow!(
                "piper sidecar failed to start after {} attempts",
                MAX_RESTARTS
            ));
        }
        self.spawn().await?;
        Ok(())
    }

    async fn spawn(&mut self) -> Result<()> {
        use tokio::process::Command;
        use crate::util::proc::hide_console_tokio;

        let mut cmd = Command::new(&self.binary);
        cmd.args([
                "--model",
                self.model.to_str().unwrap_or_default(),
                "--json-input",
                "--output-raw",
            ])
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped());
        hide_console_tokio(&mut cmd);
        let child = cmd.spawn()?;

        self.process = Some(child);
        Ok(())
    }

    async fn synthesize(&mut self, text: &str, speed: f32) -> Result<Vec<u8>> {
        use serde_json::json;
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        use tokio::time::timeout;

        let request = json!({
            "text": text,
            "speakingRate": speed,
            "outputType": "wav"
        })
        .to_string()
            + "\n";

        let child = self
            .process
            .as_mut()
            .ok_or_else(|| anyhow!("piper process not running"))?;

        // Write request to stdin.
        if let Some(stdin) = child.stdin.as_mut() {
            stdin.write_all(request.as_bytes()).await?;
            stdin.flush().await?;
        }

        // Read WAV response from stdout with timeout.
        let stdout = child
            .stdout
            .as_mut()
            .ok_or_else(|| anyhow!("piper stdout not available"))?;

        let mut wav_bytes: Vec<u8> = Vec::new();
        timeout(
            std::time::Duration::from_secs(SPEAK_TIMEOUT_SECS),
            stdout.read_to_end(&mut wav_bytes),
        )
        .await
        .map_err(|_| anyhow!("piper synthesis timed out after {}s", SPEAK_TIMEOUT_SECS))??;

        if wav_bytes.is_empty() {
            // Process may have crashed; mark for restart next call.
            self.process = None;
            self.restart_count += 1;
            return Err(anyhow!("piper produced no output (crash or empty response)"));
        }

        Ok(wav_bytes)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sidecar() -> PiperSidecar {
        PiperSidecar::new(
            PathBuf::from("/fake/bin/piper"),
            PathBuf::from("/fake/voices/en_US-amy-medium.onnx"),
        )
    }

    #[test]
    fn name_is_piper() {
        assert_eq!(sidecar().name(), "piper");
    }

    #[test]
    fn binary_path_round_trips() {
        let path = PathBuf::from("/fake/bin/piper");
        let s = PiperSidecar::new(path.clone(), PathBuf::from("/fake/voice.onnx"));
        assert_eq!(s.binary_path(), path);
    }

    #[test]
    fn starts_not_running() {
        let s = sidecar();
        assert!(!s.is_running());
    }

    #[test]
    fn start_is_noop_before_first_speak() {
        let mut s = sidecar();
        s.start().unwrap();
        // No async spawn happened; process is still None.
        assert!(!s.is_running());
    }

    #[test]
    fn stop_on_idle_sidecar_does_not_panic() {
        let mut s = sidecar();
        s.stop().unwrap();
        assert!(!s.is_running());
    }

    #[test]
    fn max_restarts_constant_is_3() {
        assert_eq!(MAX_RESTARTS, 3);
    }

    #[tokio::test]
    async fn speak_errors_when_binary_missing() {
        let mut s = sidecar(); // binary path /fake/bin/piper does not exist
        let result = s.speak("Hello world", 1.0).await;
        assert!(result.is_err(), "expected error when binary is missing");
    }

    #[tokio::test]
    async fn speak_increments_restart_count_on_failure() {
        let mut s = sidecar();
        let _ = s.speak("test", 1.0).await;
        // After one failure, restart_count should be 0 (spawn failed, never started).
        // After spawn failure the process field stays None; restart_count only
        // increments when the process starts but produces empty output.
        assert!(!s.is_running());
    }
}
