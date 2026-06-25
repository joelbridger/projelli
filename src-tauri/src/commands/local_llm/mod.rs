pub mod manifest;
pub mod model_download;

use crate::sidecars::llama_server::{resolve_llama_server_binary, LlamaServerSidecar};
use crate::sidecars::Sidecar;
use tauri::Manager;
use tokio::sync::Mutex;

/// Empty until the user starts Keepance Local AI. This keeps llama-server lazy:
/// app launch never loads the model or starts a background process.
pub struct LocalLlmSidecarState(pub Mutex<Option<LlamaServerSidecar>>);

pub fn manage_state(app: &tauri::App) {
    app.manage(LocalLlmSidecarState(Mutex::new(None)));
}

#[tauri::command]
pub async fn local_llm_sidecar_start(
    app: tauri::AppHandle,
    state: tauri::State<'_, LocalLlmSidecarState>,
) -> Result<String, String> {
    let model_path = model_download::model_file_path();
    if !model_path.exists() {
        return Err("Keepance Local AI model is not downloaded yet".to_string());
    }

    let binary = resolve_llama_server_binary(&app).ok_or_else(|| {
        "llama-server sidecar binary missing. Re-download or reinstall Keepance.".to_string()
    })?;

    let mut guard = state.0.lock().await;
    let needs_new = guard
        .as_ref()
        .map(|sidecar| sidecar.binary_path() != binary || sidecar.model_path() != model_path)
        .unwrap_or(true);

    if needs_new {
        if let Some(sidecar) = guard.as_mut() {
            let _ = sidecar.stop().await;
        }
        *guard = Some(LlamaServerSidecar::new(binary, model_path));
    }

    let sidecar = guard
        .as_mut()
        .ok_or_else(|| "llama-server state was not initialized".to_string())?;
    sidecar.start().await.map_err(|e| format!("{e:#}"))?;
    Ok(sidecar.endpoint())
}

#[tauri::command]
pub async fn local_llm_sidecar_stop(
    state: tauri::State<'_, LocalLlmSidecarState>,
) -> Result<(), String> {
    let mut guard = state.0.lock().await;
    if let Some(sidecar) = guard.as_mut() {
        sidecar.stop().await.map_err(|e| format!("{e:#}"))?;
    }
    *guard = None;
    Ok(())
}

#[tauri::command]
pub async fn local_llm_sidecar_health(
    state: tauri::State<'_, LocalLlmSidecarState>,
) -> Result<bool, String> {
    let guard = state.0.lock().await;
    if let Some(sidecar) = guard.as_ref() {
        Ok(sidecar.health_check().await)
    } else {
        Ok(false)
    }
}

#[tauri::command]
pub async fn local_llm_sidecar_is_running(
    state: tauri::State<'_, LocalLlmSidecarState>,
) -> Result<bool, String> {
    let mut guard = state.0.lock().await;
    Ok(guard
        .as_mut()
        .map(LlamaServerSidecar::is_running)
        .unwrap_or(false))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn managed_state_starts_empty_for_lazy_sidecar() {
        let state = LocalLlmSidecarState(Mutex::new(None));
        assert!(state.0.lock().await.is_none());
    }
}
