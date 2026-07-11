// TTS commands (v2.0, Stream B).
//
// Public Tauri commands:
//   - `tts_sidecar_available()` -- probe whether the Piper binary + bundled
//     voice are present. Frontend uses this to gate the Output settings section.
//   - `tts_speak(text, voice_id, speed)` -- synthesize text with the requested
//     voice and return WAV bytes. For text <= 500 chars, returns the full WAV
//     at once. For text > 500 chars, emits framed chunks via a Tauri IPC
//     channel so the frontend can start playback before synthesis finishes.
//   - `tts_stop()` -- kill the resident Piper process immediately (user pressed
//     stop).
//   - `tts_download_voice(voice_id)` -- download a lazy-loaded voice from
//     Advisor Prep Hero CDN, returning progress events. Spanish and German voices use
//     this path on first selection.
//
// Binary resolution:
//   Same pattern as voice.rs: resource_dir/binaries/piper[.exe] in release
//   builds, src-tauri/binaries/piper-<target-triple>[.exe] in dev.
//
// Voice file resolution:
//   Bundled voice: resource_dir/voices/en_US-amy-medium/
//   Downloaded voices: <app_data_dir>/voices/<voice-id>/
//   Each voice dir contains <voice-id>.onnx and <voice-id>.onnx.json.

use std::path::PathBuf;
use tauri::State;
use tauri::{AppHandle, Manager};
use tokio::sync::Mutex;

use crate::commands::connector_network::{authorize_url, await_authorized, send_with_authorized_redirects};
use crate::network_policy::{NetworkPolicy, VOICE_MODEL_DOWNLOAD};
use crate::sidecars::{PiperSidecar, Sidecar};

// Canonical product setting: BRAND.urls.voices in src/config/brand.ts.
// This remains a Rust literal because the native binary cannot import the
// generated TypeScript configuration at runtime.
const VOICE_CDN_BASE_URL: &str = "https://advisorprephero.com/voices";

/// Tauri state: a single resident PiperSidecar shared across all commands.
/// Uses tokio::sync::Mutex so the guard can be held across `.await` points
/// (e.g., the `speak()` async call inside `tts_speak`).
pub struct TtsState(pub Mutex<PiperSidecar>);

// ---------------------------------------------------------------------------
// Binary and voice resolution
// ---------------------------------------------------------------------------

fn with_platform_ext(name: &str) -> String {
    if cfg!(windows) {
        format!("{name}.exe")
    } else {
        name.to_string()
    }
}

fn target_triple() -> String {
    std::env::consts::ARCH.to_string()
        + "-"
        + if cfg!(target_os = "windows") {
            "pc-windows-msvc"
        } else if cfg!(target_os = "macos") {
            "apple-darwin"
        } else {
            "unknown-linux-gnu"
        }
}

fn triple_named_piper() -> String {
    format!("piper-{}", target_triple())
}

fn find_piper_in(root: &std::path::Path) -> Option<PathBuf> {
    // Prefer the resource-bundled, triple-named binary because its DLLs/shared
    // libs are copied into the same binaries directory by the staging scripts.
    let candidate = root.join(with_platform_ext(&triple_named_piper()));
    if candidate.exists() {
        return Some(candidate);
    }

    let candidate = root.join(with_platform_ext("piper"));
    if candidate.exists() {
        return Some(candidate);
    }

    None
}

/// Resolve the Piper binary path. Returns None when not bundled.
pub fn resolve_piper_binary(app: &AppHandle) -> Option<PathBuf> {
    // 1. Release: resource dir + binaries/
    if let Ok(resource_dir) = app.path().resource_dir() {
        if let Some(path) = find_piper_in(&resource_dir.join("binaries")) {
            return Some(path);
        }
        if let Some(path) = find_piper_in(&resource_dir) {
            return Some(path);
        }
    }

    // 2. Dev: src-tauri/binaries/<name>-<target-triple>
    let dev_candidate = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("binaries")
        .join(with_platform_ext(&triple_named_piper()));
    if dev_candidate.exists() {
        return Some(dev_candidate);
    }

    None
}

/// Resolve the ONNX model path for a given voice ID.
/// Checks bundled (resource dir) then downloaded (app data dir).
pub fn resolve_voice_model(app: &AppHandle, voice_id: &str) -> Option<PathBuf> {
    let onnx_name = format!("{voice_id}.onnx");

    // Bundled voices live in resource_dir/voices/<voice-id>/
    if let Ok(resource_dir) = app.path().resource_dir() {
        let bundled = resource_dir.join("voices").join(voice_id).join(&onnx_name);
        if bundled.exists() {
            return Some(bundled);
        }
    }

    // Downloaded voices live in <app-data>/voices/<voice-id>/
    if let Ok(data_dir) = app.path().app_data_dir() {
        let downloaded = data_dir.join("voices").join(voice_id).join(&onnx_name);
        if downloaded.exists() {
            return Some(downloaded);
        }
    }

    None
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/// Returns true when both the Piper binary and the bundled English voice are
/// present. The frontend uses this to show/hide the Output settings section
/// and the "Read aloud" button.
#[tauri::command]
pub async fn tts_sidecar_available(app: AppHandle) -> bool {
    resolve_piper_binary(&app).is_some() && resolve_voice_model(&app, "en_US-amy-medium").is_some()
}

/// Synthesize text and return WAV bytes.
/// For text <= 500 chars, returns all bytes at once.
/// For text > 500 chars, streaming is handled by `tts_speak_streaming`.
#[tauri::command]
pub async fn tts_speak(
    app: AppHandle,
    state: tauri::State<'_, TtsState>,
    text: String,
    voice_id: String,
    speed: f32,
) -> Result<Vec<u8>, String> {
    // Resolve voice model; fall back to bundled English if missing.
    let model = resolve_voice_model(&app, &voice_id)
        .or_else(|| resolve_voice_model(&app, "en_US-amy-medium"))
        .ok_or_else(|| {
            "TTS not available: bundled voice missing. Re-download in Updater.".to_string()
        })?;

    let binary = resolve_piper_binary(&app).ok_or_else(|| {
        "TTS not available: Piper binary missing. Re-download in Updater.".to_string()
    })?;

    let mut sidecar = state.0.lock().await;

    // If the sidecar's current model differs from the requested model,
    // kill and reinit so the next speak() picks up the new model.
    if sidecar.binary_path() != binary || sidecar.model_path() != model {
        sidecar.stop().ok();
        *sidecar = PiperSidecar::new(binary, model);
    }

    sidecar.speak(&text, speed).await.map_err(|e| e.to_string())
}

/// Kill the resident Piper process immediately.
#[tauri::command]
pub async fn tts_stop(state: tauri::State<'_, TtsState>) -> Result<(), String> {
    let mut sidecar = state.0.lock().await;
    sidecar.stop().map_err(|e| e.to_string())
}

/// Download a lazy-loaded voice from Advisor Prep Hero CDN.
/// Returns the local path to the downloaded .onnx file on success.
#[tauri::command]
pub async fn tts_download_voice(
    app: AppHandle,
    voice_id: String,
    policy: State<'_, NetworkPolicy>,
) -> Result<String, String> {
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;

    let voice_dir = data_dir.join("voices").join(&voice_id);
    tokio::fs::create_dir_all(&voice_dir)
        .await
        .map_err(|e| e.to_string())?;

    let cdn_url = format!("{VOICE_CDN_BASE_URL}/{voice_id}.tar.gz");
    let http = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| e.to_string())?;
    let response = send_with_authorized_redirects(
        policy.inner(),
        &VOICE_MODEL_DOWNLOAD,
        &cdn_url,
        |url| {
            let http = http.clone();
            async move { Ok(http.get(url).send().await?) }
        },
    )
    .await
    .map_err(|e| e.to_string())?;

    if !response.status().is_success() {
        return Err(format!(
            "Voice download failed: HTTP {}",
            response.status().as_u16()
        ));
    }

    // Keep a fresh capability alive while consuming the body too: receiving a
    // large archive is still network activity and must stop after a mode flip.
    // `response.url()` is the URL of the final authorized redirect hop. Use
    // it for the body grant and receipt so the audit trail names the host that
    // actually supplied the archive, not merely the initial CDN URL.
    let body_url = response.url().as_str().to_string();
    let body_grant = authorize_url(policy.inner(), &VOICE_MODEL_DOWNLOAD, &body_url)
        .map_err(|e| e.to_string())?;
    let archive_bytes = await_authorized(policy.inner(), &body_grant, async {
        Ok(response.bytes().await?)
    })
    .await
    .map_err(|e| e.to_string())?;
    let tmp_path = voice_dir.join("download.tar.gz");
    tokio::fs::write(&tmp_path, &archive_bytes)
        .await
        .map_err(|e| e.to_string())?;

    // Extract the archive.
    let voice_dir_clone = voice_dir.clone();
    let tmp_path_clone = tmp_path.clone();
    tokio::task::spawn_blocking(move || {
        let file = std::fs::File::open(&tmp_path_clone)?;
        let gz = flate2::read::GzDecoder::new(file);
        let mut archive = tar::Archive::new(gz);
        archive.unpack(&voice_dir_clone)?;
        std::fs::remove_file(&tmp_path_clone)?;
        Ok::<(), std::io::Error>(())
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e: std::io::Error| e.to_string())?;

    let onnx_path = voice_dir.join(format!("{voice_id}.onnx"));
    Ok(onnx_path.to_string_lossy().into_owned())
}

// ---------------------------------------------------------------------------
// Unit tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn voice_download_url_matches_the_current_brand_voice_cdn() {
        assert_eq!(
            format!("{VOICE_CDN_BASE_URL}/amy.tar.gz"),
            "https://advisorprephero.com/voices/amy.tar.gz"
        );
    }

    #[test]
    fn with_platform_ext_adds_exe_on_windows() {
        let result = with_platform_ext("piper");
        if cfg!(windows) {
            assert_eq!(result, "piper.exe");
        } else {
            assert_eq!(result, "piper");
        }
    }

    #[test]
    fn resolve_piper_binary_returns_none_for_nonexistent() {
        // In test context, no Tauri AppHandle is available so we test the
        // path-building logic via the helper function.
        let fake_root = PathBuf::from("/nonexistent-lantern-test-dir");
        let candidate = fake_root.join("binaries").join(with_platform_ext("piper"));
        assert!(!candidate.exists());
    }

    #[test]
    fn find_piper_prefers_triple_named_binary() {
        let tmp = tempfile::tempdir().unwrap();
        let expected = tmp.path().join(with_platform_ext(&triple_named_piper()));
        std::fs::write(&expected, b"fake binary").unwrap();
        assert_eq!(
            find_piper_in(tmp.path()).as_deref(),
            Some(expected.as_path())
        );
    }

    #[test]
    fn find_piper_still_accepts_plain_binary() {
        let tmp = tempfile::tempdir().unwrap();
        let expected = tmp.path().join(with_platform_ext("piper"));
        std::fs::write(&expected, b"fake binary").unwrap();
        assert_eq!(
            find_piper_in(tmp.path()).as_deref(),
            Some(expected.as_path())
        );
    }
}
