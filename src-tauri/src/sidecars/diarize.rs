// DiarizeSidecar — within-channel speaker diarization via the bundled
// lantern-diarize binary (sherpa-onnx wrapper).
//
// Lifecycle shape: fire-and-forget (per-request subprocess), identical to
// ParakeetSidecar: start()/stop() are no-ops, is_running() is always false.
// The real work is `diarize()`, which spawns the binary with wav + model
// paths and parses one JSON object from stdout.
use super::Sidecar;
use anyhow::{anyhow, Result};
use std::path::{Path, PathBuf};
use std::time::Duration;

/// Long meetings on CPU: generous cap, mirrors the "never hang forever" rule.
const DIARIZE_TIMEOUT_SECS: u64 = 900;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TurnMs {
    pub start_ms: u64,
    pub end_ms: u64,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiarizedSpeaker {
    pub index: usize,
    pub label: String,
    pub turns: Vec<TurnMs>,
    pub centroid: Vec<f32>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiarizeOutput {
    pub dims: usize,
    pub speakers: Vec<DiarizedSpeaker>,
}

pub struct DiarizeSidecar {
    binary: PathBuf,
    seg_model: PathBuf,
    emb_model: PathBuf,
}

impl DiarizeSidecar {
    pub fn new(binary: PathBuf, seg_model: PathBuf, emb_model: PathBuf) -> Self {
        Self { binary, seg_model, emb_model }
    }

    pub fn build_args(&self, wav: &Path, num_speakers: Option<u32>) -> Vec<String> {
        let mut args = vec![
            "--wav".to_string(),
            wav.to_string_lossy().into_owned(),
            "--seg-model".to_string(),
            self.seg_model.to_string_lossy().into_owned(),
            "--emb-model".to_string(),
            self.emb_model.to_string_lossy().into_owned(),
        ];
        if let Some(n) = num_speakers {
            args.push("--num-speakers".to_string());
            args.push(n.to_string());
        }
        args
    }

    pub async fn diarize(&self, wav: &Path, num_speakers: Option<u32>) -> Result<DiarizeOutput> {
        use crate::util::proc::hide_console_tokio;
        use tokio::process::Command;
        use tokio::time::timeout;

        let mut cmd = Command::new(&self.binary);
        cmd.args(self.build_args(wav, num_speakers))
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            // On timeout below, the `wait_with_output()` future (which owns
            // `child`) is dropped without ever being awaited to completion.
            // Without kill_on_drop, tokio does NOT kill the OS process on
            // drop, so a stuck/slow diarization would keep burning CPU as an
            // orphan after the caller sees a timeout error.
            .kill_on_drop(true);
        hide_console_tokio(&mut cmd);
        let child = cmd.spawn()?;
        let output = timeout(Duration::from_secs(DIARIZE_TIMEOUT_SECS), child.wait_with_output())
            .await
            .map_err(|_| anyhow!("diarize sidecar timed out"))??;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(anyhow!(
                "diarize sidecar exited {}: {}",
                output.status.code().unwrap_or(-1),
                stderr.trim()
            ));
        }
        let parsed: DiarizeOutput = serde_json::from_slice(&output.stdout)
            .map_err(|e| anyhow!("diarize sidecar wrote invalid JSON: {e}"))?;
        Ok(parsed)
    }
}

impl Sidecar for DiarizeSidecar {
    fn name(&self) -> &str {
        "diarize"
    }
    fn binary_path(&self) -> PathBuf {
        self.binary.clone()
    }
    fn start(&mut self) -> Result<()> {
        Ok(())
    }
    fn stop(&mut self) -> Result<()> {
        Ok(())
    }
    fn is_running(&self) -> bool {
        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn sidecar() -> DiarizeSidecar {
        DiarizeSidecar::new(
            PathBuf::from("/fake/bin/lantern-diarize"),
            PathBuf::from("/fake/models/segmentation.onnx"),
            PathBuf::from("/fake/models/embedding.onnx"),
        )
    }

    #[test]
    fn name_and_lifecycle_are_fire_and_forget() {
        let mut s = sidecar();
        assert_eq!(s.name(), "diarize");
        s.start().unwrap();
        assert!(!s.is_running());
        s.stop().unwrap();
    }

    #[test]
    fn build_args_includes_models_and_optional_speaker_count() {
        let s = sidecar();
        let args = s.build_args(std::path::Path::new("/tmp/sys.wav"), Some(2));
        assert!(args.windows(2).any(|w| w[0] == "--wav" && w[1] == "/tmp/sys.wav"));
        assert!(args.windows(2).any(|w| w[0] == "--seg-model" && w[1].ends_with("segmentation.onnx")));
        assert!(args.windows(2).any(|w| w[0] == "--num-speakers" && w[1] == "2"));
        let no_n = s.build_args(std::path::Path::new("/tmp/sys.wav"), None);
        assert!(!no_n.iter().any(|a| a == "--num-speakers"));
    }

    #[test]
    fn parses_contract_json() {
        let json = r#"{"dims":2,"speakers":[{"index":0,"label":"Speaker 1","turns":[{"startMs":320,"endMs":3010}],"centroid":[0.6,0.8]}]}"#;
        let out: DiarizeOutput = serde_json::from_str(json).unwrap();
        assert_eq!(out.dims, 2);
        assert_eq!(out.speakers[0].turns[0].start_ms, 320);
        assert_eq!(out.speakers[0].label, "Speaker 1");
    }

    #[tokio::test]
    async fn diarize_errors_when_binary_missing() {
        let s = sidecar();
        let r = s.diarize(std::path::Path::new("/nonexistent.wav"), None).await;
        assert!(r.is_err());
    }
}
