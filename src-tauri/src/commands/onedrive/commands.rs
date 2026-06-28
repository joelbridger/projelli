use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::Arc;

use serde::Serialize;
use std::collections::BTreeSet;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::commands::onedrive::client::OneDriveClient;
use crate::commands::onedrive::engine::{sync_documents, OneDriveSyncReport};
use crate::commands::onedrive::model::{
    folder_key, item_folder_path, parse_folder_key, Drive, DriveItem, OneDriveMatterMapEntry,
    DEFAULT_ACCOUNT,
};
use crate::commands::onedrive::oauth::{OAuth, TokenOutcome};
use crate::commands::onedrive::source::GraphDocumentSource;
use crate::commands::onedrive::store::OneDriveStore;

const KEYCHAIN_SERVICE: &str = "keepance-docs-ms";
const KEYCHAIN_REFRESH_KEY: &str = "ms-refresh-token";
pub const ONEDRIVE_SYNC_PROGRESS_EVENT: &str = "onedrive-sync-progress";

pub struct OneDriveState {
    pub workspace: tokio::sync::Mutex<Option<PathBuf>>,
    pub is_syncing: Arc<AtomicBool>,
    pub cancel: Arc<AtomicBool>,
    pub progress_seen: Arc<AtomicU32>,
    pub last_report: tokio::sync::Mutex<Option<OneDriveSyncReport>>,
}

pub fn manage_state(app: &tauri::App) {
    app.manage(OneDriveState {
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

fn client_id() -> String {
    option_env!("KEEPANCE_MS_CLIENT_ID")
        .unwrap_or("845ddba0-70ab-4f90-88ba-e3522157e37a")
        .to_string()
}

fn token_entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_REFRESH_KEY).map_err(|e| e.to_string())
}

async fn fresh_access_token() -> Result<String, String> {
    let entry = token_entry()?;
    let rt = entry
        .get_password()
        .map_err(|_| "not connected".to_string())?;
    let auth = OAuth::new(client_id());
    match auth.refresh(&rt).await.map_err(|e| e.to_string())? {
        TokenOutcome::Tokens {
            access, refresh, ..
        } => {
            if let Some(new_rt) = refresh {
                let _ = entry.set_password(&new_rt);
            }
            Ok(access)
        }
        TokenOutcome::Failed(e) if e == "invalid_grant" || e == "invalid_scope" => {
            Err("scope_upgrade_required".to_string())
        }
        TokenOutcome::Failed(e) => Err(format!("refresh failed: {e}")),
        _ => Err("unexpected refresh outcome".into()),
    }
}

#[derive(Serialize, Clone)]
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
pub struct OneDriveFolderDto {
    pub key: String,
    pub drive_id: String,
    pub site_id: Option<String>,
    pub item_id: String,
    pub name: String,
    pub path: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct OneDriveStatusDto {
    pub is_syncing: bool,
    pub last_report: Option<OneDriveSyncReport>,
}

#[tauri::command]
pub async fn onedrive_set_workspace(
    state: State<'_, OneDriveState>,
    path: String,
) -> Result<(), String> {
    *state.workspace.lock().await = Some(PathBuf::from(path));
    Ok(())
}

#[tauri::command]
pub async fn onedrive_connect() -> Result<(), String> {
    use crate::commands::mail::gmail::oauth::{
        await_redirect_code, bind_loopback_host, gen_pkce, gen_state, open_browser,
    };
    use crate::commands::onedrive::oauth::{
        build_ms_auth_url, ms_exchange_code, MS_TOKEN_ENDPOINT,
    };

    let (verifier, challenge) = gen_pkce();
    let state_token = gen_state();
    let (listener, redirect_uri) = bind_loopback_host("localhost")
        .await
        .map_err(|e| e.to_string())?;
    let url = build_ms_auth_url(&client_id(), &redirect_uri, &challenge, &state_token);
    open_browser(&url);
    let code = await_redirect_code(listener, &state_token, std::time::Duration::from_secs(300))
        .await
        .map_err(|e| e.to_string())?;
    let tokens = ms_exchange_code(
        &client_id(),
        &code,
        &verifier,
        &redirect_uri,
        MS_TOKEN_ENDPOINT,
    )
    .await
    .map_err(|e| e.to_string())?;
    token_entry()?
        .set_password(&tokens.refresh)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn onedrive_begin_login() -> Result<DeviceCodePrompt, String> {
    let auth = OAuth::new(client_id());
    let dc = auth
        .request_device_code()
        .await
        .map_err(|e| e.to_string())?;
    Ok(DeviceCodePrompt {
        user_code: dc.user_code,
        verification_uri: dc.verification_uri,
        device_code: dc.device_code,
        interval_secs: dc.interval_secs,
        expires_in_secs: dc.expires_in_secs,
    })
}

#[tauri::command]
pub async fn onedrive_poll_login(device_code: String) -> Result<String, String> {
    let auth = OAuth::new(client_id());
    match auth
        .poll_token(&device_code)
        .await
        .map_err(|e| e.to_string())?
    {
        TokenOutcome::Tokens {
            refresh: Some(rt), ..
        } => {
            token_entry()?
                .set_password(&rt)
                .map_err(|e| e.to_string())?;
            Ok("authorized".into())
        }
        TokenOutcome::Tokens { refresh: None, .. } => Err("no refresh token returned".into()),
        TokenOutcome::Pending => Ok("pending".into()),
        TokenOutcome::SlowDown => Ok("slow_down".into()),
        TokenOutcome::Failed(e) => Err(e),
    }
}

#[tauri::command]
pub async fn onedrive_is_connected() -> Result<bool, String> {
    Ok(token_entry()?.get_password().is_ok())
}

#[tauri::command]
pub async fn onedrive_disconnect(state: State<'_, OneDriveState>) -> Result<(), String> {
    state.cancel.store(true, Ordering::SeqCst);
    match token_entry()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => {}
        Err(e) => return Err(e.to_string()),
    }
    if let Some(ws) = state.workspace.lock().await.clone() {
        let conn = crate::commands::rag::store::open_connection(&ws)
            .await
            .map_err(|e| e.to_string())?;
        let table = crate::commands::rag::store::open_or_create_table(&conn)
            .await
            .map_err(|e| e.to_string())?;
        crate::commands::rag::store::delete_source_type(&table, "onedrive")
            .await
            .map_err(|e| e.to_string())?;
        OneDriveStore::purge(&ws).map_err(|e| e.to_string())?;
        let _ = OneDriveStore::delete_master_key();
    }
    Ok(())
}

#[tauri::command]
pub async fn onedrive_list_drives() -> Result<Vec<Drive>, String> {
    let token = fresh_access_token().await?;
    OneDriveClient::new(token)
        .list_drives()
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn onedrive_list_folders() -> Result<Vec<OneDriveFolderDto>, String> {
    let token = fresh_access_token().await?;
    let client = OneDriveClient::new(token);
    let drives = client.list_drives().await.map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for drive in drives {
        let omit_select = is_personal_drive(&drive);
        let roots = client
            .list_root_children(Some(&drive.id), omit_select)
            .await
            .map_err(|e| e.to_string())?;
        collect_folders(&client, &drive.id, omit_select, None, roots, &mut out).await?;
    }
    Ok(out)
}

async fn collect_folders(
    client: &OneDriveClient,
    drive_id: &str,
    omit_select: bool,
    site_id: Option<String>,
    items: Vec<DriveItem>,
    out: &mut Vec<OneDriveFolderDto>,
) -> Result<(), String> {
    let mut stack: Vec<(DriveItem, Option<String>)> = items
        .into_iter()
        .filter(|i| i.is_folder())
        .map(|i| (i, site_id.clone()))
        .collect();
    while let Some((item, inherited_site_id)) = stack.pop() {
        let item_site_id = item.site_id().or(inherited_site_id);
        let path = item_folder_path(&item);
        out.push(OneDriveFolderDto {
            key: folder_key(DEFAULT_ACCOUNT, item_site_id.as_deref(), drive_id, &path),
            drive_id: drive_id.to_string(),
            site_id: item_site_id.clone(),
            item_id: item.id.clone(),
            name: item.name.clone(),
            path: path.clone(),
        });
        let children = client
            .list_children(drive_id, &item.id, omit_select)
            .await
            .map_err(|e| e.to_string())?;
        stack.extend(
            children
                .into_iter()
                .filter(|child| child.is_folder())
                .map(|child| (child, item_site_id.clone())),
        );
    }
    Ok(())
}

fn sync_drive_ids(
    matter_map: &[OneDriveMatterMapEntry],
    available_drives: &[Drive],
) -> Vec<String> {
    let mut drive_ids = BTreeSet::new();
    let mut personal_drive_ids = BTreeSet::new();
    for drive in available_drives {
        if is_personal_drive(drive) {
            if !drive.id.trim().is_empty() {
                personal_drive_ids.insert(drive.id.clone());
            }
            continue;
        }
        if !drive.id.trim().is_empty() {
            drive_ids.insert(drive.id.clone());
        }
    }
    for entry in matter_map {
        if let Some(parts) = parse_folder_key(&entry.folder_key) {
            if personal_drive_ids.contains(&parts.drive_id) {
                continue;
            }
            drive_ids.insert(parts.drive_id);
        }
    }
    // Personal-only accounts fall through to /me/drive. Mixed personal+business accounts
    // are not fully handled here; the personal drive is only synced when no per-drive ids remain.
    drive_ids.into_iter().collect()
}

fn is_personal_drive(drive: &Drive) -> bool {
    drive
        .drive_type
        .as_deref()
        .map(|drive_type| drive_type.eq_ignore_ascii_case("personal"))
        .unwrap_or(false)
}

#[tauri::command]
pub async fn onedrive_sync(
    app: AppHandle,
    state: State<'_, OneDriveState>,
    matter_map: Vec<OneDriveMatterMapEntry>,
) -> Result<OneDriveSyncReport, String> {
    if state
        .is_syncing
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return Err("a OneDrive sync is already in progress".into());
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
    let token = fresh_access_token().await?;
    let store = OneDriveStore::open(&workspace).map_err(|e| e.to_string())?;
    let rag_key =
        crate::commands::rag::crypto::get_or_create_master_key().map_err(|e| e.to_string())?;

    let _ = app.emit(
        ONEDRIVE_SYNC_PROGRESS_EVENT,
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
                    ONEDRIVE_SYNC_PROGRESS_EVENT,
                    serde_json::json!({ "status": "syncing", "seen": seen }),
                );
            }
        }
    });

    let available_drives = OneDriveClient::new(token.clone())
        .list_drives()
        .await
        .unwrap_or_default();
    let drive_ids = sync_drive_ids(&matter_map, &available_drives);
    let mut merged_report = OneDriveSyncReport::default();
    let result = if drive_ids.is_empty() {
        let omit_select = OneDriveClient::new(token.clone())
            .default_drive()
            .await
            .map(|drive| is_personal_drive(&drive))
            .unwrap_or(false);
        let source = GraphDocumentSource::new_for_default_drive(token, omit_select);
        sync_documents(
            &source,
            &store,
            &workspace,
            &matter_map,
            &state.cancel,
            &rag_key,
            &state.progress_seen,
        )
        .await
        .map(|report| {
            merged_report.merge_from(report);
            merged_report
        })
    } else {
        let mut result = Ok(());
        for drive_id in drive_ids {
            if state.cancel.load(Ordering::SeqCst) {
                merged_report.cancelled = true;
                break;
            }
            let omit_select = available_drives
                .iter()
                .find(|drive| drive.id == drive_id)
                .map(is_personal_drive)
                .unwrap_or(false);
            let source = GraphDocumentSource::new_for_drive(token.clone(), drive_id, omit_select);
            match sync_documents(
                &source,
                &store,
                &workspace,
                &matter_map,
                &state.cancel,
                &rag_key,
                &state.progress_seen,
            )
            .await
            {
                Ok(report) => {
                    let cancelled = report.cancelled;
                    merged_report.merge_from(report);
                    if cancelled {
                        break;
                    }
                }
                Err(e) => {
                    result = Err(e);
                    break;
                }
            }
        }
        result.map(|_| merged_report)
    };
    emitter.abort();

    let report = match result {
        Ok(report) => report,
        Err(e) => {
            let _ = app.emit(
                ONEDRIVE_SYNC_PROGRESS_EVENT,
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
        ONEDRIVE_SYNC_PROGRESS_EVENT,
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::onedrive::model::ParentReference;

    fn folder(
        id: &str,
        name: &str,
        drive_id: &str,
        path: &str,
        site_id: Option<&str>,
    ) -> DriveItem {
        DriveItem {
            id: id.to_string(),
            name: name.to_string(),
            parent_reference: Some(ParentReference {
                drive_id: drive_id.to_string(),
                path: Some(path.to_string()),
                site_id: site_id.map(str::to_string),
                ..Default::default()
            }),
            folder: Some(serde_json::json!({})),
            ..Default::default()
        }
    }

    #[test]
    fn sync_drive_ids_include_non_default_mapped_drive() {
        let map = vec![OneDriveMatterMapEntry {
            folder_key: folder_key(DEFAULT_ACCOUNT, None, "shared-drive", "/Clients/Acme"),
            matter_id: "matter-a".into(),
        }];
        let drives = vec![Drive {
            id: "business-drive".into(),
            name: "Business Documents".into(),
            drive_type: Some("business".into()),
            ..Default::default()
        }];
        assert_eq!(
            sync_drive_ids(&map, &drives),
            vec!["business-drive".to_string(), "shared-drive".to_string()]
        );
    }

    #[test]
    fn sync_drive_ids_skip_personal_available_drive() {
        let drives = vec![Drive {
            id: "personal-drive".into(),
            name: "OneDrive".into(),
            drive_type: Some("personal".into()),
            ..Default::default()
        }];
        assert_eq!(sync_drive_ids(&[], &drives), Vec::<String>::new());
    }

    #[test]
    fn sync_drive_ids_skip_personal_mapped_drive() {
        let map = vec![OneDriveMatterMapEntry {
            folder_key: folder_key(DEFAULT_ACCOUNT, None, "personal-drive", "/Clients/Acme"),
            matter_id: "matter-a".into(),
        }];
        let drives = vec![Drive {
            id: "personal-drive".into(),
            name: "OneDrive".into(),
            drive_type: Some("personal".into()),
            ..Default::default()
        }];
        assert_eq!(sync_drive_ids(&map, &drives), Vec::<String>::new());
    }

    #[test]
    fn sharepoint_folder_key_uses_parent_reference_site_id() {
        let item = folder(
            "folder-1",
            "Clients",
            "drive-sp",
            "/drive/root:",
            Some("site-123"),
        );
        let path = item_folder_path(&item);
        let key = folder_key(
            DEFAULT_ACCOUNT,
            item.site_id().as_deref(),
            "drive-sp",
            &path,
        );
        assert_eq!(key, "m365/default/site-123/drive-sp:/clients");
    }

    #[test]
    fn sharepoint_child_folder_can_inherit_listing_site_id() {
        let item = folder("folder-2", "Tax", "drive-sp", "/drive/root:/Clients", None);
        let inherited_site_id = Some("site-123".to_string());
        let item_site_id = item.site_id().or(inherited_site_id);
        let path = item_folder_path(&item);
        let key = folder_key(DEFAULT_ACCOUNT, item_site_id.as_deref(), "drive-sp", &path);
        assert_eq!(key, "m365/default/site-123/drive-sp:/clients/tax");
    }
}

#[tauri::command]
pub async fn onedrive_cancel(state: State<'_, OneDriveState>) -> Result<(), String> {
    state.cancel.store(true, Ordering::SeqCst);
    Ok(())
}

#[tauri::command]
pub async fn onedrive_status(state: State<'_, OneDriveState>) -> Result<OneDriveStatusDto, String> {
    Ok(OneDriveStatusDto {
        is_syncing: state.is_syncing.load(Ordering::SeqCst),
        last_report: state.last_report.lock().await.clone(),
    })
}
