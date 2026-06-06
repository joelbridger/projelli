pub mod model;
pub mod normalize;
pub mod store;
pub mod graph;
pub mod oauth;
pub mod sync;

use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager, State};
use crate::commands::mail::graph::GraphClient;
use crate::commands::mail::oauth::{OAuth, TokenOutcome};
use crate::commands::mail::store::SqliteMailStore;

const KEYCHAIN_SERVICE: &str = "keepance-mail-ms";
const KEYCHAIN_REFRESH_KEY: &str = "ms-refresh-token";
pub const SYNC_PROGRESS_EVENT: &str = "mail-sync-progress";

pub struct MailState {
    pub workspace: tokio::sync::Mutex<Option<std::path::PathBuf>>,
    pub cancel: Arc<AtomicBool>,
    pub is_syncing: Arc<AtomicBool>,
}

pub fn manage_state(app: &tauri::App) {
    app.manage(MailState {
        workspace: tokio::sync::Mutex::new(None),
        cancel: Arc::new(AtomicBool::new(false)),
        is_syncing: Arc::new(AtomicBool::new(false)),
    });
}

/// RAII guard: sets `is_syncing` to false when dropped, covering all exit paths.
struct SyncGuard(Arc<AtomicBool>);
impl Drop for SyncGuard {
    fn drop(&mut self) {
        self.0.store(false, Ordering::SeqCst);
    }
}

fn client_id() -> String {
    option_env!("KEEPANCE_MS_CLIENT_ID")
        .unwrap_or("845ddba0-70ab-4f90-88ba-e3522157e37a")
        .to_string()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceCodePrompt {
    pub user_code: String,
    pub verification_uri: String,
    pub device_code: String,
    pub interval_secs: u64,
    pub expires_in_secs: u64,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SyncProgress {
    pub status: String,
    pub folder: Option<String>,
    pub written: u32,
    pub removed: u32,
}

#[tauri::command]
pub async fn mail_set_workspace(
    state: State<'_, MailState>,
    path: String,
) -> Result<(), String> {
    *state.workspace.lock().await = Some(std::path::PathBuf::from(path));
    Ok(())
}

#[tauri::command]
pub async fn mail_begin_login() -> Result<DeviceCodePrompt, String> {
    let auth = OAuth::new(client_id());
    let dc = auth.request_device_code().await.map_err(|e| e.to_string())?;
    Ok(DeviceCodePrompt {
        user_code: dc.user_code,
        verification_uri: dc.verification_uri,
        device_code: dc.device_code,
        interval_secs: dc.interval_secs,
        expires_in_secs: dc.expires_in_secs,
    })
}

/// Poll once; the frontend calls this on `interval_secs`. On success, the
/// refresh token is stored in the OS keychain and `true` is returned.
#[tauri::command]
pub async fn mail_poll_login(device_code: String) -> Result<bool, String> {
    let auth = OAuth::new(client_id());
    match auth.poll_token(&device_code).await.map_err(|e| e.to_string())? {
        TokenOutcome::Tokens { refresh: Some(rt), .. } => {
            let entry = keyring::Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_REFRESH_KEY)
                .map_err(|e| e.to_string())?;
            entry.set_password(&rt).map_err(|e| e.to_string())?;
            Ok(true)
        }
        TokenOutcome::Tokens { refresh: None, .. } => Err("no refresh token returned".into()),
        TokenOutcome::Pending | TokenOutcome::SlowDown => Ok(false),
        TokenOutcome::Failed(e) => Err(e),
    }
}

#[tauri::command]
pub async fn mail_is_connected() -> Result<bool, String> {
    let entry = keyring::Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_REFRESH_KEY)
        .map_err(|e| e.to_string())?;
    Ok(entry.get_password().is_ok())
}

async fn fresh_access_token() -> Result<String, String> {
    let entry = keyring::Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_REFRESH_KEY)
        .map_err(|e| e.to_string())?;
    let rt = entry.get_password().map_err(|_| "not connected".to_string())?;
    let auth = OAuth::new(client_id());
    match auth.refresh(&rt).await.map_err(|e| e.to_string())? {
        TokenOutcome::Tokens { access, refresh, .. } => {
            if let Some(new_rt) = refresh {
                let _ = entry.set_password(&new_rt); // refresh-token rotation
            }
            Ok(access)
        }
        TokenOutcome::Failed(e) => Err(format!("refresh failed: {e}")),
        _ => Err("unexpected refresh outcome".into()),
    }
}

#[tauri::command]
pub async fn mail_cancel_sync(state: State<'_, MailState>) -> Result<(), String> {
    state.cancel.store(true, Ordering::SeqCst);
    Ok(())
}

/// Enumerate folders then sync each to its deltaLink, emitting progress.
#[tauri::command]
pub async fn mail_sync_all(
    app: AppHandle,
    state: State<'_, MailState>,
) -> Result<(), String> {
    // FIX A: atomically claim the sync slot; reject if already in progress.
    // We do NOT reset `cancel` here if we bail early — an in-flight sync owns it.
    if state.is_syncing
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return Err("a sync is already in progress".into());
    }
    // RAII guard: restores is_syncing=false on every exit path (success, early
    // return from cancel check, or any ? propagation below).
    let _sync_guard = SyncGuard(state.is_syncing.clone());

    // Only reset cancel now that we hold the sync slot.
    state.cancel.store(false, Ordering::SeqCst);

    let workspace = state
        .workspace
        .lock()
        .await
        .clone()
        .ok_or("workspace not set")?;
    let cancel = state.cancel.clone();
    let store = SqliteMailStore::open(&workspace).map_err(|e| e.to_string())?;

    // FIX C: paginate folder enumeration — follow @odata.nextLink until exhausted.
    let mut ids: Vec<String> = Vec::new();
    {
        let token = fresh_access_token().await?;
        let list_client = GraphClient::new(token);
        let mut next_url = Some(format!(
            "{}/v1.0/me/mailFolders?$top=200",
            list_client.base()
        ));
        while let Some(url) = next_url {
            let page = list_client
                .get_json(&url)
                .await
                .map_err(|e| e.to_string())?;
            if let Some(arr) = page.get("value").and_then(|v| v.as_array()) {
                for f in arr {
                    if let Some(id) = f.get("id").and_then(|s| s.as_str()) {
                        ids.push(id.to_string());
                    }
                }
            }
            // Follow the next page if present.
            next_url = page
                .get("@odata.nextLink")
                .and_then(|v| v.as_str())
                .map(String::from);
        }
    }

    // FIX B: refresh the access token before each folder so long backfills
    // never outlive the 3600-second token lifetime.
    for fid in ids {
        if cancel.load(Ordering::SeqCst) {
            let _ = app.emit(
                SYNC_PROGRESS_EVENT,
                SyncProgress {
                    status: "cancelled".into(),
                    folder: None,
                    written: 0,
                    removed: 0,
                },
            );
            return Ok(());
        }
        let token = fresh_access_token().await?;
        let client = GraphClient::new(token);
        let app2 = app.clone();
        let fid2 = fid.clone();
        let emit = move |w: u32, r: u32| {
            let _ = app2.emit(
                SYNC_PROGRESS_EVENT,
                SyncProgress {
                    status: "syncing".into(),
                    folder: Some(fid2.clone()),
                    written: w,
                    removed: r,
                },
            );
        };
        sync::sync_folder(&client, &store, &workspace, &fid, &emit)
            .await
            .map_err(|e| e.to_string())?;
    }
    let _ = app.emit(
        SYNC_PROGRESS_EVENT,
        SyncProgress {
            status: "done".into(),
            folder: None,
            written: 0,
            removed: 0,
        },
    );
    Ok(())
}
