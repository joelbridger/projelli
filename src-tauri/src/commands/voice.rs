// Voice commands (M6, v1.5 — Flag 4).
//
// Public surface:
//   - `voice_sidecar_available()` — reports whether the bundled
//     whisper.cpp-family binary is on disk. The frontend uses this to
//     render the Voice settings status pill before attempting a
//     transcription.
//   - `transcribe_audio(wav_bytes, model?)` — delegates to
//     `ParakeetSidecar::transcribe` (`src-tauri/src/sidecars/parakeet.rs`),
//     which speaks the engine's real, verified CLI contract. This command
//     used to have its own separate (and, before 2026-07-04, never actually
//     tested against a real engine) subprocess-spawning logic duplicated
//     from `ParakeetSidecar` — collapsed into one implementation so
//     `transcribe_meeting` (`commands/capture/transcribe.rs`, the Meetings
//     feature's transcription path, which already called
//     `ParakeetSidecar` directly) and this command can never drift apart
//     again.
//
// Binary resolution:
//   Tauri's `binaries/**/*` resource glob (see `tauri.conf.json`) stages
//   per-platform binaries in the resource dir at install time. We look for
//   them with these names (first hit wins):
//
//     resource_dir/binaries/parakeet[.exe]
//     resource_dir/binaries/whisper[.exe]
//
//   Dev builds also check `src-tauri/binaries/` so engineers running
//   `cargo tauri dev` after `bash scripts/build-voice-sidecar.sh` get a hit
//   without a full bundle. Model files are resolved the same way, one
//   level over in `resources/voice/models/` (see `resolve_models_dir`).
//
// Binary contract (verified 2026-07-04 against a locally-built
// ggml-org/whisper.cpp — see the doc comment atop
// `src-tauri/src/sidecars/parakeet.rs` for the full verification and why
// Parakeet-family models use this exact same contract, not a separate one):
//   The engine takes a real file path via `-f`, a real model file path via
//   `-m`, and `-np -nt` for clean unadorned stdout text. There is no stdin
//   mode.

use std::path::PathBuf;
use tauri::Manager;

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

/// Resolve the directory of bundled ggml model files. Mirrors
/// `resolve_sidecar_path`'s prod/dev search shape, one level over:
/// `resources/voice/models/` sits alongside `binaries/` both in the Tauri
/// resource dir (release builds, per the `resources/**/*` glob in
/// `tauri.conf.json`) and under `src-tauri/` in a dev checkout. This is a
/// pure lookup — it does not read or validate any model file, just the
/// directory they'd be in; `ParakeetSidecar::resolve_model_path` does the
/// per-tier resolution against whatever it finds there.
pub fn resolve_models_dir(app: &tauri::AppHandle) -> Option<PathBuf> {
    if let Ok(resource_dir) = app.path().resource_dir() {
        let dir = resource_dir.join("resources").join("voice").join("models");
        if dir.is_dir() {
            return Some(dir);
        }
    }
    if let Ok(cwd) = std::env::current_dir() {
        let dev_candidates = [
            cwd.join("src-tauri").join("resources").join("voice").join("models"),
            cwd.join("resources").join("voice").join("models"),
            cwd.join("..").join("src-tauri").join("resources").join("voice").join("models"),
        ];
        for dir in &dev_candidates {
            if dir.is_dir() {
                return Some(dir.clone());
            }
        }
    }
    None
}

/// Transcribe WAV audio via the bundled sidecar binary. Delegates to
/// `ParakeetSidecar::transcribe`, which speaks the engine's real, file-based
/// CLI contract (see the doc comment atop `sidecars/parakeet.rs`).
#[tauri::command]
pub async fn transcribe_audio(
    app: tauri::AppHandle,
    wav_bytes: Vec<u8>,
    model: Option<String>,
) -> Result<TranscribeResult, String> {
    let binary = resolve_sidecar_path(&app)
        .ok_or_else(|| "Voice sidecar binary not bundled for this platform".to_string())?;
    let models_dir = resolve_models_dir(&app);

    let sidecar = crate::sidecars::ParakeetSidecar::new(binary, models_dir);
    let out = sidecar
        .transcribe(wav_bytes, model.as_deref())
        .await
        .map_err(|e| e.to_string())?;
    Ok(TranscribeResult { text: out.text, latency_ms: out.latency_ms })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    // Arg-building for the real engine contract is tested in
    // `sidecars/parakeet.rs` (`ParakeetSidecar::build_args`), which now owns
    // that logic — this module only resolves paths (binary + models dir)
    // and delegates.

    #[test]
    fn find_sidecar_returns_none_when_missing() {
        let dir = tempfile::tempdir().unwrap();
        let found = find_sidecar_in(dir.path(), &["parakeet", "whisper"]);
        assert!(found.is_none());
    }

    #[test]
    fn find_sidecar_hits_first_match() {
        let dir = tempfile::tempdir().unwrap();
        let name = if cfg!(windows) { "whisper.exe" } else { "whisper" };
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

    // `resolve_models_dir`, like `resolve_sidecar_path` above it, takes a
    // real `tauri::AppHandle` and isn't unit-testable without one — no
    // existing test in this file exercises `resolve_sidecar_path` directly
    // either, only its pure `find_sidecar_in` building block. The
    // corresponding per-tier resolution logic against a real directory
    // listing (`resolve_model_path`) IS fully unit-tested, in
    // `sidecars/parakeet.rs`.
}
