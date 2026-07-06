use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::Arc;
use std::time::Duration;

use serde::Serialize;
use std::collections::BTreeSet;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::commands::mail::graph::{GraphTokenRefresh, GraphTokenRefreshFuture};
use crate::commands::onedrive::client::OneDriveClient;
use crate::commands::onedrive::engine::{sync_documents, OneDriveSyncReport};
use crate::commands::onedrive::model::{
    folder_key, item_folder_path, parse_folder_key, Drive, DriveItem, OneDriveMatterMapEntry,
    DEFAULT_ACCOUNT,
};
use crate::commands::onedrive::oauth::{OAuth, TokenOutcome};
use crate::commands::onedrive::source::GraphDocumentSource;
use crate::commands::onedrive::store::OneDriveStore;

const KEYCHAIN_SERVICE: &str = crate::identity::DOCS_MS_SERVICE;
const KEYCHAIN_REFRESH_KEY: &str = "ms-refresh-token";
pub const ONEDRIVE_SYNC_PROGRESS_EVENT: &str = "onedrive-sync-progress";

/// Hard ceiling on the folder-discovery walk (`onedrive_list_folders`), the
/// step `runSync()` awaits BEFORE it ever calls `onedrive_sync` — a purely
/// sequential, un-paginated-progress recursive tree walk with no per-request
/// bound beyond each individual Graph call's own 60s timeout (`GraphClient`).
/// A very large or slow-to-enumerate account (or ambient resource pressure
/// from anything else running on the machine) can otherwise leave this
/// awaited from the frontend for many minutes with zero visible feedback,
/// since Rust progress events for `ONEDRIVE_SYNC_PROGRESS_EVENT` only start
/// once the later `onedrive_sync` call begins — this command never fires one.
/// 3 minutes is generous headroom over any legitimate metadata-only listing.
const LIST_FOLDERS_TIMEOUT: Duration = Duration::from_secs(180);

/// Hard ceiling on the whole `onedrive_sync` command, independent of the
/// user-triggered `onedrive_cancel` flag. Downloading real files can
/// legitimately take a while, so this is a generous backstop against a true
/// stall (not a normal-case budget) — the per-request 60s Graph timeout
/// already bounds any single call; this bounds the whole sequential chain of
/// them so the command can never hang the awaiting frontend forever.
const SYNC_TIMEOUT: Duration = Duration::from_secs(30 * 60);

const TIMED_OUT_LIST_FOLDERS: &str =
    "OneDrive took too long to respond while listing folders. Try syncing again.";
const TIMED_OUT_SYNC: &str = "OneDrive sync timed out. Try syncing again.";
const CANCELLED: &str = "cancelled";

pub struct OneDriveState {
    pub workspace: tokio::sync::Mutex<Option<PathBuf>>,
    pub is_syncing: Arc<AtomicBool>,
    pub cancel: Arc<AtomicBool>,
    pub progress_seen: Arc<AtomicU32>,
    pub last_report: tokio::sync::Mutex<Option<OneDriveSyncReport>>,
    /// Separate from `cancel` (which cancels an in-flight document *sync*):
    /// lets the frontend abort a pending interactive OAuth sign-in
    /// (`onedrive_connect`'s wait for the browser redirect) without touching
    /// sync state. See `onedrive_connect_cancel`.
    pub oauth_cancel: Arc<AtomicBool>,
}

pub fn manage_state(app: &tauri::App) {
    app.manage(OneDriveState {
        workspace: tokio::sync::Mutex::new(None),
        is_syncing: Arc::new(AtomicBool::new(false)),
        cancel: Arc::new(AtomicBool::new(false)),
        progress_seen: Arc::new(AtomicU32::new(0)),
        last_report: tokio::sync::Mutex::new(None),
        oauth_cancel: Arc::new(AtomicBool::new(false)),
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
                // Refresh-token rotation. Don't silently swallow a failed save: the
                // access token still works now, but the new refresh token wasn't
                // persisted, so a later launch may need a reconnect. Log it so the
                // failure is visible instead of invisible.
                if let Err(e) = entry.set_password(&new_rt) {
                    log::warn!(
                        "OneDrive refresh-token rotation not saved (reconnect may be needed later): {e}"
                    );
                }
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

fn graph_token_refresh() -> GraphTokenRefresh {
    Arc::new(|| -> GraphTokenRefreshFuture {
        Box::pin(async {
            fresh_access_token()
                .await
                .map_err(|e| anyhow::anyhow!("{e}"))
        })
    })
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

/// Run the Microsoft loopback+PKCE sign-in: open the browser, catch the
/// redirect, exchange the code, and store the refresh token. Blocks until the
/// user finishes, cancels (see `onedrive_connect_cancel`), or a 5-minute
/// timeout elapses.
#[tauri::command]
pub async fn onedrive_connect(state: State<'_, OneDriveState>) -> Result<(), String> {
    use crate::commands::mail::gmail::oauth::{
        await_redirect_code_or_cancel, bind_loopback_host, gen_pkce, gen_state, open_browser,
    };
    use crate::commands::onedrive::oauth::{
        build_ms_auth_url, ms_exchange_code, MS_TOKEN_ENDPOINT,
    };

    // Reset from any prior cancelled/finished attempt before starting a new one.
    state.oauth_cancel.store(false, Ordering::SeqCst);
    let cancel = state.oauth_cancel.clone();

    let (verifier, challenge) = gen_pkce();
    let state_token = gen_state();
    let (listener, redirect_uri) = bind_loopback_host("localhost")
        .await
        .map_err(|e| e.to_string())?;
    let url = build_ms_auth_url(&client_id(), &redirect_uri, &challenge, &state_token);
    open_browser(&url);
    let code = await_redirect_code_or_cancel(
        listener,
        &state_token,
        std::time::Duration::from_secs(300),
        cancel.clone(),
    )
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

    // Cancel can arrive while the token exchange (a network round trip) was
    // in flight — check again before persisting so a canceled flow never
    // leaves a stored credential behind, even though the redirect wait
    // itself already resolved successfully.
    let entry = token_entry()?;
    // Snapshot whatever was there before (if this is a reconnect over an
    // existing connection) so a cancel-after-store rolls back to THAT,
    // rather than always deleting — a canceled reconnect must not disconnect
    // an already-working account.
    let previous_token = entry.get_password().ok();
    crate::commands::mail::gmail::oauth::store_or_rollback_on_cancel(
        &cancel,
        || entry.set_password(&tokens.refresh).map_err(|e| e.to_string()),
        || match &previous_token {
            Some(prev) => { let _ = entry.set_password(prev); }
            None => { let _ = entry.delete_credential(); }
        },
    )
}

/// Abort a pending `onedrive_connect` interactive sign-in immediately (e.g.
/// the user clicked Cancel, or closed the popup and gave up) instead of
/// leaving them stuck on the 5-minute server-side timeout. A no-op if no
/// sign-in is in flight. Never touches an already-working connection.
#[tauri::command]
pub async fn onedrive_connect_cancel(state: State<'_, OneDriveState>) -> Result<(), String> {
    state.oauth_cancel.store(true, Ordering::SeqCst);
    Ok(())
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

/// Returned by `onedrive_disconnect` — reports exactly what was purged so the
/// UI can show an accurate post-disconnect status instead of always claiming
/// "deleted imported data" regardless of what actually happened. Mirrors
/// `CrmDisconnectResult` (`src/commands/crm/commands.rs`).
#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct OneDriveDisconnectResult {
    /// `true` when the Microsoft refresh token was removed from the OS keychain.
    pub token_deleted: bool,
    /// `true` when `source_type='onedrive'` RAG chunks were purged from the
    /// LanceDB vector store.
    pub rag_purged: bool,
    /// `true` when the local OneDrive sync-state database file was deleted.
    pub local_data_purged: bool,
    /// `true` when imported OneDrive data may STILL be on disk after this
    /// disconnect — because the purge could not run (no workspace) or a purge
    /// step failed. The refresh token is KEPT in that case, so the UI can
    /// offer a "finish deleting" retry instead of stranding the data.
    pub data_remains: bool,
    /// Non-empty when any purge step was skipped or failed (best-effort).
    /// Each entry is a plain-English sentence suitable for a UI warning banner.
    pub warnings: Vec<String>,
}

/// Purge every local trace of imported OneDrive data: `source_type='onedrive'`
/// RAG chunks and the local OneDrive sync-state database. Extracted so
/// `onedrive_disconnect_logic` can purge BEFORE touching the token (see its
/// doc comment for why that ordering matters).
async fn purge_onedrive_local_data(ws: &std::path::Path) -> Result<(), String> {
    let conn = crate::commands::rag::store::open_connection(ws)
        .await
        .map_err(|e| e.to_string())?;
    let table = crate::commands::rag::store::open_or_create_table(&conn)
        .await
        .map_err(|e| e.to_string())?;
    crate::commands::rag::store::delete_source_type(&table, "onedrive")
        .await
        .map_err(|e| e.to_string())?;
    OneDriveStore::purge(ws).map_err(|e| e.to_string())?;
    Ok(())
}

/// Core disconnect logic — extracted for testability so integration tests can
/// drive the full disconnect path without a Tauri runtime.
///
/// Purges local data FIRST (RAG chunks + the OneDrive sync-state DB), and
/// removes the Microsoft refresh token from the OS keychain ONLY AFTER that
/// purge succeeds — mirroring `crm_disconnect_logic_for_provider`'s ordering.
/// The previous ordering deleted the token first, so a purge failure left the
/// account looking disconnected while imported data was still on disk with no
/// way to finish removing it. Returns an `OneDriveDisconnectResult` that
/// reports exactly what happened; essentially never propagates `Err`.
pub async fn onedrive_disconnect_logic(state: &OneDriveState) -> OneDriveDisconnectResult {
    let mut result = OneDriveDisconnectResult::default();

    state.cancel.store(true, Ordering::SeqCst);

    // No workspace → the imported data can't be located/deleted. KEEP the
    // token + connected state so the user can finish deleting once a
    // workspace is open.
    let Some(ws) = state.workspace.lock().await.clone() else {
        result.data_remains = true;
        result.warnings.push(
            "No workspace is open, so the imported OneDrive data could not be located and \
             was NOT deleted. Your account connection was kept — open the workspace and \
             disconnect again to finish deleting."
                .to_string(),
        );
        return result;
    };

    match purge_onedrive_local_data(&ws).await {
        Ok(()) => {
            result.rag_purged = true;
            result.local_data_purged = true;
        }
        Err(e) => {
            log::warn!("onedrive_disconnect: local data purge failed (non-fatal): {e}");
            result
                .warnings
                .push(format!("OneDrive imported-data purge failed: {e}"));
        }
    }

    // Remove the refresh token (= become "disconnected") ONLY AFTER the local
    // purge succeeds, so the user is never disconnected with data stranded on
    // disk. If the purge failed, KEEP the token + connected state and flag
    // `data_remains` so the UI can retry.
    if result.rag_purged && result.local_data_purged {
        match token_entry() {
            Ok(entry) => match entry.delete_credential() {
                Ok(()) | Err(keyring::Error::NoEntry) => result.token_deleted = true,
                Err(e) => {
                    log::warn!("onedrive_disconnect: token deletion failed (non-fatal): {e}");
                    result.warnings.push(format!(
                        "Imported data was deleted, but the OneDrive connection could not be \
                         removed from the keychain: {e}"
                    ));
                }
            },
            Err(e) => {
                log::warn!("onedrive_disconnect: keychain entry unavailable (non-fatal): {e}");
                result.warnings.push(format!(
                    "Imported data was deleted, but the OneDrive connection could not be \
                     removed from the keychain: {e}"
                ));
            }
        }
        let _ = OneDriveStore::delete_master_key();
    } else {
        result.data_remains = true;
        result.warnings.push(
            "Some imported OneDrive data could not be deleted; your account connection was \
             kept so you can try disconnecting again to finish deleting."
                .to_string(),
        );
    }

    result
}

/// Disconnect the OneDrive/SharePoint account: purge locally-imported data
/// (RAG chunks + the OneDrive sync-state DB), then remove the Microsoft
/// refresh token from the OS keychain. Returns an `OneDriveDisconnectResult`
/// that reports exactly what was and was not deleted — the UI must use these
/// flags to show an honest status rather than always claiming "disconnected".
/// Thin wrapper over `onedrive_disconnect_logic`.
#[tauri::command]
pub async fn onedrive_disconnect(
    state: State<'_, OneDriveState>,
) -> Result<OneDriveDisconnectResult, String> {
    Ok(onedrive_disconnect_logic(&state).await)
}

#[tauri::command]
pub async fn onedrive_list_drives() -> Result<Vec<Drive>, String> {
    let token = fresh_access_token().await?;
    OneDriveClient::new_with_refresh(token, graph_token_refresh())
        .list_drives()
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn onedrive_list_folders(
    state: State<'_, OneDriveState>,
) -> Result<Vec<OneDriveFolderDto>, String> {
    // Fresh call, fresh cancel intent — a flag left set by a PRIOR stop
    // (Cancel button, or a cancelled sync) must not immediately kill this
    // brand new listing before it even starts.
    state.cancel.store(false, Ordering::SeqCst);
    let cancel = state.cancel.clone();
    match tokio::time::timeout(LIST_FOLDERS_TIMEOUT, list_folders_body(cancel)).await {
        Ok(result) => result,
        Err(_elapsed) => Err(TIMED_OUT_LIST_FOLDERS.to_string()),
    }
}

async fn list_folders_body(cancel: Arc<AtomicBool>) -> Result<Vec<OneDriveFolderDto>, String> {
    let token = fresh_access_token().await?;
    let client = OneDriveClient::new_with_refresh(token, graph_token_refresh());
    let drives = client.list_drives().await.map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    let mut listed_default_drive = false;
    for drive in drives {
        if cancel.load(Ordering::SeqCst) {
            return Err(CANCELLED.to_string());
        }
        if is_personal_drive(&drive) {
            if listed_default_drive {
                continue;
            }
            listed_default_drive = true;
            let roots = client
                .list_root_children(None, true)
                .await
                .map_err(|e| e.to_string())?;
            let folder_drive_id = client
                .default_drive()
                .await
                .map(|default_drive| default_drive.id)
                .unwrap_or_else(|_| drive.id.clone());
            collect_folders(
                &client,
                None,
                &folder_drive_id,
                true,
                None,
                roots,
                &mut out,
                &cancel,
            )
            .await?;
            continue;
        }
        let roots = client
            .list_root_children(Some(&drive.id), false)
            .await
            .map_err(|e| e.to_string())?;
        collect_folders(
            &client,
            Some(&drive.id),
            &drive.id,
            false,
            None,
            roots,
            &mut out,
            &cancel,
        )
        .await?;
    }
    Ok(out)
}

#[allow(clippy::too_many_arguments)]
async fn collect_folders(
    client: &OneDriveClient,
    graph_drive_id: Option<&str>,
    folder_drive_id: &str,
    omit_select: bool,
    site_id: Option<String>,
    items: Vec<DriveItem>,
    out: &mut Vec<OneDriveFolderDto>,
    cancel: &Arc<AtomicBool>,
) -> Result<(), String> {
    let mut stack: Vec<(DriveItem, Option<String>)> = items
        .into_iter()
        .filter(|i| i.is_folder())
        .map(|i| (i, site_id.clone()))
        .collect();
    while let Some((item, inherited_site_id)) = stack.pop() {
        if cancel.load(Ordering::SeqCst) {
            return Err(CANCELLED.to_string());
        }
        let item_site_id = item.site_id().or(inherited_site_id);
        let path = item_folder_path(&item);
        out.push(OneDriveFolderDto {
            key: folder_key(
                DEFAULT_ACCOUNT,
                item_site_id.as_deref(),
                folder_drive_id,
                &path,
            ),
            drive_id: folder_drive_id.to_string(),
            site_id: item_site_id.clone(),
            item_id: item.id.clone(),
            name: item.name.clone(),
            path: path.clone(),
        });
        let children = client
            .list_children(graph_drive_id, &item.id, omit_select)
            .await
            .map_err(|e| e.to_string())?;
        // Re-check AFTER the await too, not just before it: the check at the
        // top of this loop only fires on the NEXT iteration — if this was
        // the LAST item on the stack, there is no next iteration, so a Stop
        // that lands while this exact list_children call was in flight would
        // otherwise be silently dropped (the loop just ends and returns Ok).
        // That's not a cosmetic gap: the caller (onedrive_list_folders) would
        // then return a normal folder list, `runSync()` would proceed
        // straight into `onedrive_sync`, and `onedrive_sync` resets
        // `state.cancel` to false at its own start — so a Stop click that
        // landed here would be erased and the sync would start anyway.
        if cancel.load(Ordering::SeqCst) {
            return Err(CANCELLED.to_string());
        }
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

    // Emit the "syncing" signal, and start the periodic progress emitter,
    // BEFORE the token fetch / Graph calls below — those can themselves be
    // slow (or, pre-fix, hang), and the frontend's spinner should engage the
    // moment the command starts, not only once the first document is seen.
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

    // The whole token-fetch-through-sync-loop chain, bounded by SYNC_TIMEOUT
    // so this command can never leave the awaiting frontend hanging forever —
    // a stall anywhere in it (auth refresh, Graph calls, disk I/O) now ends in
    // an honest timeout error instead of silence.
    let sync_future = async {
        let token = fresh_access_token().await?;
        let refresh = graph_token_refresh();
        let store = OneDriveStore::open(&workspace).map_err(|e| e.to_string())?;
        let rag_key = crate::commands::rag::crypto::get_or_create_master_key()
            .map_err(|e| e.to_string())?;

        let available_drives = OneDriveClient::new_with_refresh(token.clone(), refresh.clone())
            .list_drives()
            .await
            .unwrap_or_default();
        let drive_ids = sync_drive_ids(&matter_map, &available_drives);
        let mut merged_report = OneDriveSyncReport::default();
        if drive_ids.is_empty() {
            let omit_select = OneDriveClient::new_with_refresh(token.clone(), refresh.clone())
                .default_drive()
                .await
                .map(|drive| is_personal_drive(&drive))
                .unwrap_or(false);
            let source = GraphDocumentSource::new_for_default_drive_with_refresh(
                token, omit_select, refresh,
            );
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
            .map_err(|e| e.to_string())
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
                let source = GraphDocumentSource::new_for_drive_with_refresh(
                    token.clone(),
                    drive_id,
                    omit_select,
                    refresh.clone(),
                );
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
                        result = Err(e.to_string());
                        break;
                    }
                }
            }
            result.map(|_| merged_report)
        }
    };

    let outcome = tokio::time::timeout(SYNC_TIMEOUT, sync_future).await;
    emitter.abort();

    let report = match outcome {
        Ok(Ok(report)) => report,
        Ok(Err(e)) => {
            let _ = app.emit(
                ONEDRIVE_SYNC_PROGRESS_EVENT,
                serde_json::json!({ "status": "error" }),
            );
            return Err(e.to_string());
        }
        Err(_elapsed) => {
            let _ = app.emit(
                ONEDRIVE_SYNC_PROGRESS_EVENT,
                serde_json::json!({ "status": "error" }),
            );
            return Err(TIMED_OUT_SYNC.to_string());
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
            "imported": report.imported,
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
            dest_folder: String::new(),
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
            dest_folder: String::new(),
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

    // fix/onedrive-sync-silence: regression tests for the two guarantees that
    // close the bench pass-3 "total silence" bug — a cancelled listing walk
    // stops honestly, and a stalled walk is bounded by an outer timeout.

    #[tokio::test]
    async fn collect_folders_stops_immediately_when_already_cancelled() {
        // No mocks registered on this server — if collect_folders made ANY
        // HTTP call before honoring cancel, it would hit an unmatched-request
        // panic (wiremock's default behavior), proving the check happens
        // before any network I/O, not just eventually.
        let server = wiremock::MockServer::start().await;
        let client = OneDriveClient::new_with_base("AT".into(), server.uri());
        let cancel = Arc::new(AtomicBool::new(true));
        let mut out = Vec::new();
        let items = vec![folder("folder-1", "Clients", "drive-1", "/drive/root:", None)];

        let result = collect_folders(
            &client,
            Some("drive-1"),
            "drive-1",
            false,
            None,
            items,
            &mut out,
            &cancel,
        )
        .await;

        assert_eq!(result, Err(CANCELLED.to_string()));
        assert!(out.is_empty());
    }

    #[tokio::test]
    async fn collect_folders_honors_cancel_flipped_mid_walk() {
        // Two roots on the stack; collect_folders pops LIFO, so "folder-2" is
        // visited first. Its list_children call is deliberately slow — long
        // enough for a background task to flip `cancel` (simulating a Stop
        // click landing while that request is in flight) before the loop
        // reaches "folder-1". Proves cancellation is honored BETWEEN
        // iterations of a real walk, not just when set before it starts —
        // and that whatever was already collected up to that point
        // (folder-2 itself) is real work, not silently discarded mid-request.
        use wiremock::matchers::method;
        use wiremock::{Mock, MockServer, ResponseTemplate};

        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_json(serde_json::json!({ "value": [] }))
                    .set_delay(Duration::from_millis(150)),
            )
            .mount(&server)
            .await;
        let client = OneDriveClient::new_with_base("AT".into(), server.uri());
        let cancel = Arc::new(AtomicBool::new(false));
        let flipper = cancel.clone();
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(40)).await;
            flipper.store(true, Ordering::SeqCst);
        });

        let mut out = Vec::new();
        let items = vec![
            folder("folder-1", "Should Not Visit", "drive-1", "/drive/root:", None),
            folder("folder-2", "Clients", "drive-1", "/drive/root:", None),
        ];
        let result = collect_folders(
            &client,
            Some("drive-1"),
            "drive-1",
            false,
            None,
            items,
            &mut out,
            &cancel,
        )
        .await;

        assert_eq!(result, Err(CANCELLED.to_string()));
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].name, "Clients");
    }

    #[tokio::test]
    async fn collect_folders_honors_cancel_flipped_during_the_final_list_children_call() {
        // round-2 review P2-b: a SINGLE item on the stack (the last/only one
        // left to visit) — cancel is false when the pre-await check runs,
        // then flips to true while its own list_children call is in flight.
        // Before the fix, the top-of-loop check was the ONLY place cancel
        // was ever re-read, and with the stack now empty there is no next
        // iteration to catch it — the function returned Ok(()) as if the
        // Stop click never happened, and the caller (onedrive_list_folders)
        // would then hand back a normal folder list. runSync() would proceed
        // straight into onedrive_sync, which unconditionally resets
        // state.cancel at its own start — silently erasing the user's Stop.
        use wiremock::matchers::method;
        use wiremock::{Mock, MockServer, ResponseTemplate};

        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_json(serde_json::json!({ "value": [] }))
                    .set_delay(Duration::from_millis(150)),
            )
            .mount(&server)
            .await;
        let client = OneDriveClient::new_with_base("AT".into(), server.uri());
        let cancel = Arc::new(AtomicBool::new(false));
        let flipper = cancel.clone();
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(40)).await;
            flipper.store(true, Ordering::SeqCst);
        });

        let mut out = Vec::new();
        let items = vec![folder("folder-1", "Clients", "drive-1", "/drive/root:", None)];
        let result = collect_folders(
            &client,
            Some("drive-1"),
            "drive-1",
            false,
            None,
            items,
            &mut out,
            &cancel,
        )
        .await;

        assert_eq!(
            result,
            Err(CANCELLED.to_string()),
            "a Stop click during the LAST item's in-flight request must still abort the whole walk"
        );
    }

    #[tokio::test]
    async fn collect_folders_walk_is_bounded_by_an_outer_timeout() {
        // Regression for the bench pass-3 "total silence" root cause: before
        // this fix, onedrive_list_folders's recursive walk had no bound at
        // all, so a stalled Graph call (or, in production, ambient resource
        // starvation slowing every call) left the frontend awaiting forever.
        // This proves the mechanism onedrive_list_folders now relies on
        // (wrapping the walk in tokio::time::timeout) genuinely interrupts a
        // stall mid-flight, not just before the walk starts.
        use wiremock::matchers::method;
        use wiremock::{Mock, MockServer, ResponseTemplate};

        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_json(serde_json::json!({ "value": [] }))
                    .set_delay(Duration::from_millis(300)),
            )
            .mount(&server)
            .await;
        let client = OneDriveClient::new_with_base("AT".into(), server.uri());
        let cancel = Arc::new(AtomicBool::new(false));
        let mut out = Vec::new();
        let items = vec![folder("folder-1", "Clients", "drive-1", "/drive/root:", None)];

        let outcome = tokio::time::timeout(
            Duration::from_millis(50),
            collect_folders(
                &client,
                Some("drive-1"),
                "drive-1",
                false,
                None,
                items,
                &mut out,
                &cancel,
            ),
        )
        .await;

        assert!(
            outcome.is_err(),
            "expected the outer timeout to fire while the Graph call was still stalled"
        );
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
