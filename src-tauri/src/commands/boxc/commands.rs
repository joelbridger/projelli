use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::Arc;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::commands::boxc::client::BoxClient;
use crate::commands::boxc::engine::{list_folders, sync_documents, BoxFolderDto, BoxSyncReport};
use crate::commands::boxc::model::BoxMatterMapEntry;
use crate::commands::boxc::source::ApiBoxSource;
use crate::commands::boxc::store::BoxStore;

const KEYCHAIN_SERVICE: &str = crate::identity::BOX_SERVICE;
const KEYCHAIN_TOKEN_KEY: &str = "developer-token-v1";
pub const BOX_SYNC_PROGRESS_EVENT: &str = "box-sync-progress";

pub struct BoxState {
    pub workspace: tokio::sync::Mutex<Option<PathBuf>>,
    pub is_syncing: Arc<AtomicBool>,
    pub cancel: Arc<AtomicBool>,
    pub progress_seen: Arc<AtomicU32>,
    pub last_report: tokio::sync::Mutex<Option<BoxSyncReport>>,
}

pub fn manage_state(app: &tauri::App) {
    app.manage(BoxState {
        workspace: tokio::sync::Mutex::new(None),
        is_syncing: Arc::new(AtomicBool::new(false)),
        cancel: Arc::new(AtomicBool::new(false)),
        progress_seen: Arc::new(AtomicU32::new(0)),
        last_report: tokio::sync::Mutex::new(None),
    });
}

struct SyncGuard(Arc<AtomicBool>);
impl Drop for SyncGuard {
    fn drop(&mut self) {
        self.0.store(false, Ordering::SeqCst);
    }
}

fn token_entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_TOKEN_KEY).map_err(|e| e.to_string())
}

fn stored_access_token() -> Result<String, String> {
    token_entry()?
        .get_password()
        .map_err(|_| "not connected".to_string())
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BoxStatusDto {
    pub is_syncing: bool,
    pub last_report: Option<BoxSyncReport>,
}

#[tauri::command]
pub async fn box_set_workspace(state: State<'_, BoxState>, path: String) -> Result<(), String> {
    *state.workspace.lock().await = Some(PathBuf::from(path));
    Ok(())
}

#[tauri::command]
pub async fn box_connect(
    access_token: String,
    policy: State<'_, crate::network_policy::NetworkPolicy>,
) -> Result<(), String> {
    let token = access_token.trim().to_string();
    if token.is_empty() {
        return Err("Paste a Box Developer Token first.".into());
    }
    BoxClient::new(token.clone())
        .with_network_policy(policy.inner().clone(), crate::network_policy::BOX_SYNC)
        .current_user()
        .await
        .map_err(|e| format!("Box rejected this token: {e}"))?;
    token_entry()?
        .set_password(&token)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn box_is_connected() -> Result<bool, String> {
    Ok(token_entry()?.get_password().is_ok())
}

#[tauri::command]
pub async fn box_disconnect(state: State<'_, BoxState>) -> Result<(), String> {
    // Tell any in-flight sync to stop, then refuse to disconnect while one is
    // still running (it holds the token/store/RAG handles and could write chunks
    // after we purge). purge_then_forget_guarded acquires the same is_syncing lock
    // the sync uses; if a sync holds it the user just retries once it has stopped.
    state.cancel.store(true, Ordering::SeqCst);
    let ws = state.workspace.lock().await.clone();
    // Purge imported data FIRST; only delete the token once the purge succeeds, so
    // a failed purge can never leave Box chunks searchable behind a connector that
    // now looks disconnected.
    crate::commands::connector::purge_then_forget_guarded(
        &state.is_syncing,
        || async move {
            if let Some(ws) = ws {
                let conn = crate::commands::rag::store::open_connection(&ws)
                    .await
                    .map_err(|e| e.to_string())?;
                let table = crate::commands::rag::store::open_or_create_table(&conn)
                    .await
                    .map_err(|e| e.to_string())?;
                crate::commands::rag::store::delete_source_type(&table, "box")
                    .await
                    .map_err(|e| e.to_string())?;
                BoxStore::purge(&ws).map_err(|e| e.to_string())?;
                let _ = BoxStore::delete_master_key();
            }
            Ok(())
        },
        || match token_entry()?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(e.to_string()),
        },
    )
    .await
}

#[tauri::command]
pub async fn box_list_folders(
    policy: State<'_, crate::network_policy::NetworkPolicy>,
) -> Result<Vec<BoxFolderDto>, String> {
    let token = stored_access_token()?;
    let source = ApiBoxSource::new(token, policy.inner().clone());
    list_folders(&source).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn box_sync(
    app: AppHandle,
    state: State<'_, BoxState>,
    policy: State<'_, crate::network_policy::NetworkPolicy>,
    matter_map: Vec<BoxMatterMapEntry>,
) -> Result<BoxSyncReport, String> {
    if state
        .is_syncing
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return Err("a Box sync is already in progress".into());
    }
    let _guard = SyncGuard(state.is_syncing.clone());
    state.cancel.store(false, Ordering::SeqCst);
    state.progress_seen.store(0, Ordering::SeqCst);

    let workspace = state
        .workspace
        .lock()
        .await
        .clone()
        .ok_or("workspace not set")?;
    let token = stored_access_token()?;
    let store = BoxStore::open(&workspace).map_err(|e| e.to_string())?;
    let rag_key =
        crate::commands::rag::crypto::get_or_create_master_key().map_err(|e| e.to_string())?;

    let _ = app.emit(
        BOX_SYNC_PROGRESS_EVENT,
        serde_json::json!({ "status": "syncing", "seen": 0 }),
    );
    let emit_app = app.clone();
    let emit_counter = state.progress_seen.clone();
    let emitter = tokio::spawn(async move {
        let mut last = u32::MAX;
        loop {
            tokio::time::sleep(std::time::Duration::from_millis(250)).await;
            let seen = emit_counter.load(Ordering::SeqCst);
            if seen != last {
                last = seen;
                let _ = emit_app.emit(
                    BOX_SYNC_PROGRESS_EVENT,
                    serde_json::json!({ "status": "syncing", "seen": seen }),
                );
            }
        }
    });

    let source = ApiBoxSource::new(token, policy.inner().clone());
    let result = sync_documents(
        &source,
        &store,
        &workspace,
        &matter_map,
        &state.cancel,
        &rag_key,
        &state.progress_seen,
    )
    .await;
    emitter.abort();

    let report = match result {
        Ok(report) => report,
        Err(e) => {
            let _ = app.emit(
                BOX_SYNC_PROGRESS_EVENT,
                serde_json::json!({ "status": "error" }),
            );
            return Err(e.to_string());
        }
    };
    let status = if report.cancelled {
        "cancelled"
    } else {
        "done"
    };
    let _ = app.emit(
        BOX_SYNC_PROGRESS_EVENT,
        serde_json::json!({
            "status": status,
            "seen": report.seen,
            "indexed": report.indexed,
            "pendingPdf": report.pending_pdf,
        }),
    );
    *state.last_report.lock().await = Some(report.clone());
    Ok(report)
}

#[tauri::command]
pub async fn box_cancel(state: State<'_, BoxState>) -> Result<(), String> {
    state.cancel.store(true, Ordering::SeqCst);
    Ok(())
}

#[tauri::command]
pub async fn box_status(state: State<'_, BoxState>) -> Result<BoxStatusDto, String> {
    Ok(BoxStatusDto {
        is_syncing: state.is_syncing.load(Ordering::SeqCst),
        last_report: state.last_report.lock().await.clone(),
    })
}
