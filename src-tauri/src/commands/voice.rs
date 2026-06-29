// Voice commands (M6, v1.5 — Flag 4).
//
// Public surface:
//   - `voice_sidecar_available()` — reports whether the bundled
//     Parakeet/whisper.cpp binary is on disk. The frontend uses this to
//     render the Voice settings status pill before attempting a
//     transcription.
//   - `transcribe_audio(wav_bytes, model?)` — spawns the bundled binary
//     with the WAV bytes on stdin and captures the transcription on stdout.
//
// Binary resolution:
//   Tauri's `bundle.externalBin` mechanism stages per-platform binaries in
//   the resource dir at install time. We look for them with these names
//   (first hit wins):
//
//     resource_dir/binaries/parakeet[.exe]
//     resource_dir/binaries/whisper[.exe]
//
//   Dev builds also check `src-tauri/binaries/<name>-<target-triple>` so
//   engineers running `cargo tauri dev` after `npm run fetch-voice-sidecar`
//   get a hit without a full bundle.
//
// Binary contract:
//   The sidecar reads a WAV from stdin, writes the transcription to stdout
//   as UTF-8 (trailing newline OK), and exits 0 on success. Errors go to
//   stderr and exit != 0. Both Parakeet.cpp's `parakeet-stream` mode and
//   whisper.cpp's `--stdin` mode satisfy this contract.

use std::path::PathBuf;
use std::time::{Duration, Instant};
use tauri::Manager;
use tokio::io::AsyncWriteExt;
use tokio::process::Command;
use tokio::time::timeout;

/// Hard cap on a single transcription. Voice input is expected to be short;
/// anything past this is almost certainly a hang or a runaway model.
const TRANSCRIBE_TIMEOUT_SECS: u64 = 30;

/// Structured result of a successful transcription.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscribeResult {
    pub text: String,
    pub latency_ms: u64,
}

/// Filenames we look for in the bundled binaries directory. First match
/// wins. The platform-specific `.exe` suffix is appended on Windows.
fn candidate_binary_names() -> Vec<&'static str> {
    vec!["parakeet", "whisper"]
}

fn with_platform_ext(name: &str) -> String {
    if cfg!(windows) {
        format!("{name}.exe")
    } else {
        name.to_string()
    }
}

/// Pure helper: given a search root and a list of base names, return the
/// first candidate path that exists. Exposed for unit tests.
pub fn find_sidecar_in(root: &std::path::Path, names: &[&str]) -> Option<PathBuf> {
    for name in names {
        let file = root.join(with_platform_ext(name));
        if file.exists() {
            return Some(file);
        }
    }
    None
}

/// Attempt to resolve the sidecar binary path. Returns `None` when the
/// bundle didn't ship one for this platform. This is a pure lookup — it
/// does NOT spawn the binary.
pub fn resolve_sidecar_path(app: &tauri::AppHandle) -> Option<PathBuf> {
    let names = candidate_binary_names();

    // 1. Tauri resource dir + `binaries/` sub-folder (release builds).
    if let Ok(resource_dir) = app.path().resource_dir() {
        let bin_dir = resource_dir.join("binaries");
        if let Some(p) = find_sidecar_in(&bin_dir, &names) {
            return Some(p);
        }
        if let Some(p) = find_sidecar_in(&resource_dir, &names) {
            return Some(p);
        }
    }

    // 2. Dev fallback — look next to the project `src-tauri/binaries/` dir
    //    so engineers running `npm run tauri:dev` can drop a binary in there
    //    without a full bundle rebuild.
    if let Ok(cwd) = std::env::current_dir() {
        let dev_candidates = [
            cwd.join("src-tauri").join("binaries"),
            cwd.join("binaries"),
            cwd.join("..").join("src-tauri").join("binaries"),
        ];
        for root in &dev_candidates {
            if let Some(p) = find_sidecar_in(root, &names) {
                return Some(p);
            }
        }
    }

    None
}

/// Reports whether the bundled voice sidecar is on disk. The frontend
/// surfaces this as a status pill in Settings → Voice.
#[tauri::command]
pub async fn voice_sidecar_available(app: tauri::AppHandle) -> Result<bool, String> {
    Ok(resolve_sidecar_path(&app).is_some())
}

/// Build the command-line args for the transcription binary. Exposed
/// for unit testing without spawning a subprocess.
pub fn build_transcribe_args(binary_name: &str, model: Option<&str>) -> Vec<String> {
    let mut args: Vec<String> = Vec::new();
    let lower = binary_name.to_ascii_lowercase();
    if lower.contains("whisper") {
        // whisper.cpp: `--stdin` to read from stdin, `--model` for the model.
        args.push("--stdin".to_string());
        args.push("--no-timestamps".to_string());
        if let Some(m) = model {
            args.push("--model".to_string());
            args.push(m.to_string());
        }
    } else {
        // Parakeet.cpp: `-` reads from stdin; `--model` optional.
        args.push("-".to_string());
        if let Some(m) = model {
            args.push("--model".to_string());
            args.push(m.to_string());
        }
    }
    args
}

/// Transcribe WAV audio via the bundled sidecar binary. Bytes are piped
/// to stdin; the full stdout output (minus trailing whitespace) is
/// returned as the transcription text.
#[tauri::command]
pub async fn transcribe_audio(
    app: tauri::AppHandle,
    wav_bytes: Vec<u8>,
    model: Option<String>,
) -> Result<TranscribeResult, String> {
    let binary = resolve_sidecar_path(&app)
        .ok_or_else(|| "Voice sidecar binary not bundled for this platform".to_string())?;

    if wav_bytes.is_empty() {
        return Err("wav_bytes is empty — nothing to transcribe".to_string());
    }

    let binary_name = binary
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("parakeet")
        .to_string();
    let args = build_transcribe_args(&binary_name, model.as_deref());

    let started = Instant::now();
    let mut spawn_cmd = Command::new(&binary);
    spawn_cmd
        .args(&args)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());
    crate::util::proc::hide_console_tokio(&mut spawn_cmd);
    let mut child = spawn_cmd
        .spawn()
        .map_err(|e| format!("failed to spawn voice sidecar: {e}"))?;

    // Pipe WAV bytes in asynchronously so we can also read stdout in the
    // main await branch without deadlocking on a big input.
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
    .map_err(|_| "voice sidecar timed out".to_string())?
    .map_err(|e| format!("voice sidecar failed: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!(
            "voice sidecar exited {}: {}",
            output.status.code().unwrap_or(-1),
            stderr.trim()
        ));
    }

    let text = String::from_utf8_lossy(&output.stdout).trim().to_string();
    Ok(TranscribeResult {
        text,
        latency_ms: started.elapsed().as_millis() as u64,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn build_args_whisper() {
        let args = build_transcribe_args("whisper", Some("small"));
        assert!(args.contains(&"--stdin".to_string()));
        assert!(args.contains(&"--model".to_string()));
        assert!(args.contains(&"small".to_string()));
    }

    #[test]
    fn build_args_whisper_no_model() {
        let args = build_transcribe_args("whisper.exe", None);
        assert!(args.contains(&"--stdin".to_string()));
        assert!(!args.iter().any(|a| a == "--model"));
    }

    #[test]
    fn build_args_parakeet() {
        let args = build_transcribe_args("parakeet", Some("small"));
        assert_eq!(args.first().map(String::as_str), Some("-"));
        assert!(args.contains(&"--model".to_string()));
    }

    #[test]
    fn build_args_parakeet_case_insensitive() {
        // Binary might be renamed Parakeet-X86.exe by CI; name-match is
        // lowercase.
        let args = build_transcribe_args("Parakeet-X86.exe", None);
        assert_eq!(args.first().map(String::as_str), Some("-"));
    }

    #[test]
    fn find_sidecar_returns_none_when_missing() {
        let dir = tempfile::tempdir().unwrap();
        let found = find_sidecar_in(dir.path(), &["parakeet", "whisper"]);
        assert!(found.is_none());
    }

    #[test]
    fn find_sidecar_hits_first_match() {
        let dir = tempfile::tempdir().unwrap();
        let name = if cfg!(windows) {
            "whisper.exe"
        } else {
            "whisper"
        };
        let expected = dir.path().join(name);
        fs::write(&expected, b"fake binary").unwrap();
        let found = find_sidecar_in(dir.path(), &["parakeet", "whisper"]);
        assert_eq!(found.as_deref(), Some(expected.as_path()));
    }

    #[test]
    fn find_sidecar_prefers_parakeet_over_whisper() {
        let dir = tempfile::tempdir().unwrap();
        let whisper = dir.path().join(with_platform_ext("whisper"));
        let parakeet = dir.path().join(with_platform_ext("parakeet"));
        fs::write(&whisper, b"x").unwrap();
        fs::write(&parakeet, b"x").unwrap();
        let found = find_sidecar_in(dir.path(), &["parakeet", "whisper"]).unwrap();
        assert_eq!(found, parakeet);
    }

    #[tokio::test]
    async fn transcribe_errors_when_sidecar_missing() {
        // Use a binary path that definitely doesn't exist to drive the
        // failure path inside `Command::spawn`.
        let output = Command::new("/nonexistent-voice-sidecar-abc")
            .arg("-")
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn();
        assert!(output.is_err(), "expected spawn to fail for missing binary");
    }
}
