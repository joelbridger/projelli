use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::Arc;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::commands::sharefile::client::{normalize_api_base, SharefileClient};
use crate::commands::sharefile::engine::{sync_documents, SharefileSyncReport};
use crate::commands::sharefile::model::{
    child_path, folder_key, SharefileItem, SharefileMatterMapEntry, DEFAULT_ACCOUNT,
};
use crate::commands::sharefile::source::SharefileDocumentSource;
use crate::commands::sharefile::store::SharefileStore;

const KEYCHAIN_SERVICE: &str = "keepance-sharefile";
const KEYCHAIN_ACCESS_TOKEN_KEY: &str = "access-token";
const KEYCHAIN_SUBDOMAIN_KEY: &str = "subdomain";
pub const SHAREFILE_SYNC_PROGRESS_EVENT: &str = "sharefile-sync-progress";

pub struct SharefileState {
    pub workspace: tokio::sync::Mutex<Option<PathBuf>>,
    pub is_syncing: Arc<AtomicBool>,
    pub cancel: Arc<AtomicBool>,
    pub progress_seen: Arc<AtomicU32>,
    pub last_report: tokio::sync::Mutex<Option<SharefileSyncReport>>,
}

pub fn manage_state(app: &tauri::App) {
    app.manage(SharefileState {
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

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SharefileFolderDto {
    pub key: String,
    pub item_id: String,
    pub name: String,
    pub path: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SharefileStatusDto {
    pub is_syncing: bool,
    pub last_report: Option<SharefileSyncReport>,
}

fn token_entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_ACCESS_TOKEN_KEY).map_err(|e| e.to_string())
}

fn subdomain_entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_SUBDOMAIN_KEY).map_err(|e| e.to_string())
}

fn store_connection(access_token: &str, subdomain: &str) -> Result<(), String> {
    token_entry()?
        .set_password(access_token)
        .map_err(|e| e.to_string())?;
    subdomain_entry()?
        .set_password(subdomain)
        .map_err(|e| e.to_string())?;
    Ok(())
}

fn read_connection() -> Result<(String, String), String> {
    let token = token_entry()?
        .get_password()
        .map_err(|_| "ShareFile is not connected".to_string())?;
    let subdomain = subdomain_entry()?
        .get_password()
        .map_err(|_| "ShareFile is not connected".to_string())?;
    Ok((token, subdomain))
}

fn delete_connection() -> Result<(), String> {
    for entry in [token_entry()?, subdomain_entry()?] {
        match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => {}
            Err(e) => return Err(e.to_string()),
        }
    }
    Ok(())
}

fn client_from_stored_connection() -> Result<SharefileClient, String> {
    let (token, subdomain) = read_connection()?;
    SharefileClient::new(token, subdomain).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn sharefile_set_workspace(
    state: State<'_, SharefileState>,
    path: String,
) -> Result<(), String> {
    *state.workspace.lock().await = Some(PathBuf::from(path));
    Ok(())
}

#[tauri::command]
pub async fn sharefile_connect(access_token: String, subdomain: String) -> Result<(), String> {
    let token = access_token.trim().to_string();
    if token.is_empty() {
        return Err("ShareFile access token is required".into());
    }
    let normalized_base = normalize_api_base(&subdomain).map_err(|e| e.to_string())?;
    let normalized_host = normalized_base
        .trim_start_matches("https://")
        .trim_end_matches("/sf/v3")
        .to_string();
    let client = SharefileClient::new(token.clone(), normalized_host.clone())
        .map_err(|e| e.to_string())?;
    client.validate_token().await.map_err(|e| e.to_string())?;
    store_connection(&token, &normalized_host)
}

#[tauri::command]
pub async fn sharefile_is_connected() -> Result<bool, String> {
    Ok(read_connection().is_ok())
}

#[tauri::command]
pub async fn sharefile_disconnect(state: State<'_, SharefileState>) -> Result<(), String> {
    state.cancel.store(true, Ordering::SeqCst);
    let ws = state.workspace.lock().await.clone();
    // Purge imported data FIRST; only delete the credential once the purge
    // succeeds, so a failed purge can't leave ShareFile chunks searchable behind a
    // connector that now looks disconnected.
    crate::commands::connector::purge_then_forget(
        || async move {
            if let Some(ws) = ws {
                let conn = crate::commands::rag::store::open_connection(&ws)
                    .await
                    .map_err(|e| e.to_string())?;
                let table = crate::commands::rag::store::open_or_create_table(&conn)
                    .await
                    .map_err(|e| e.to_string())?;
                crate::commands::rag::store::delete_source_type(&table, "sharefile")
                    .await
                    .map_err(|e| e.to_string())?;
                SharefileStore::purge(&ws).map_err(|e| e.to_string())?;
                let _ = SharefileStore::delete_master_key();
            }
            Ok(())
        },
        delete_connection,
    )
    .await
}

#[tauri::command]
pub async fn sharefile_list_folders() -> Result<Vec<SharefileFolderDto>, String> {
    let client = client_from_stored_connection()?;
    let roots = client
        .list_root_children()
        .await
        .map_err(|e| e.to_string())?;
    collect_folders(&client, roots).await
}

async fn collect_folders(
    client: &SharefileClient,
    items: Vec<SharefileItem>,
) -> Result<Vec<SharefileFolderDto>, String> {
    let mut out = Vec::new();
    let mut stack: Vec<(SharefileItem, String)> = items
        .into_iter()
        .filter(|i| i.is_folder())
        .map(|i| {
            let path = child_path("/", &i.name);
            (i, path)
        })
        .collect();
    while let Some((item, path)) = stack.pop() {
        out.push(SharefileFolderDto {
            key: folder_key(DEFAULT_ACCOUNT, &item.id, &path),
            item_id: item.id.clone(),
            name: item.name.clone(),
            path: path.clone(),
        });
        let children = client
            .list_children(&item.id)
            .await
            .map_err(|e| e.to_string())?;
        stack.extend(children.into_iter().filter(|child| child.is_folder()).map(
            |child| {
                let child_path = child_path(&path, &child.name);
                (child, child_path)
            },
        ));
    }
    Ok(out)
}

#[tauri::command]
pub async fn sharefile_sync(
    app: AppHandle,
    state: State<'_, SharefileState>,
    matter_map: Vec<SharefileMatterMapEntry>,
) -> Result<SharefileSyncReport, String> {
    if state
        .is_syncing
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return Err("a ShareFile sync is already in progress".into());
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
    let client = client_from_stored_connection()?;
    let source = SharefileDocumentSource::new(client);
    let store = SharefileStore::open(&workspace).map_err(|e| e.to_string())?;
    let rag_key =
        crate::commands::rag::crypto::get_or_create_master_key().map_err(|e| e.to_string())?;

    let _ = app.emit(
        SHAREFILE_SYNC_PROGRESS_EVENT,
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
                    SHAREFILE_SYNC_PROGRESS_EVENT,
                    serde_json::json!({ "status": "syncing", "seen": seen }),
                );
            }
        }
    });

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
                SHAREFILE_SYNC_PROGRESS_EVENT,
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
        SHAREFILE_SYNC_PROGRESS_EVENT,
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
pub async fn sharefile_cancel(state: State<'_, SharefileState>) -> Result<(), String> {
    state.cancel.store(true, Ordering::SeqCst);
    Ok(())
}

#[tauri::command]
pub async fn sharefile_status(
    state: State<'_, SharefileState>,
) -> Result<SharefileStatusDto, String> {
    Ok(SharefileStatusDto {
        is_syncing: state.is_syncing.load(Ordering::SeqCst),
        last_report: state.last_report.lock().await.clone(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn folder(id: &str, name: &str) -> SharefileItem {
        SharefileItem {
            id: id.to_string(),
            name: name.to_string(),
            file_count: Some(1),
            odata_metadata: Some("ShareFile.Api.Models.Folder".to_string()),
            ..Default::default()
        }
    }

    #[test]
    fn folder_dto_key_uses_sharefile_provider_shape() {
        let item = folder("fo1", "Clients");
        let path = child_path("/", &item.name);
        assert_eq!(
            folder_key(DEFAULT_ACCOUNT, &item.id, &path),
            "sharefile/default/fo1:/clients"
        );
    }
}
