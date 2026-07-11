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
    /// Held for the WHOLE disconnect flow (F1). While it's set, `onedrive_sync`
    /// and `onedrive_list_folders` refuse to start — otherwise a sync that
    /// begins during the disconnect's cancel+wait window (it even clears the
    /// cancel flag as it starts) would re-download and re-materialize files
    /// right after the purge deletes them, resurrecting everything the user
    /// asked to remove. Set BEFORE cancel is raised, released when disconnect
    /// finishes.
    pub disconnecting: Arc<AtomicBool>,
}

pub fn manage_state(app: &tauri::App) {
    app.manage(OneDriveState {
        workspace: tokio::sync::Mutex::new(None),
        is_syncing: Arc::new(AtomicBool::new(false)),
        cancel: Arc::new(AtomicBool::new(false)),
        progress_seen: Arc::new(AtomicU32::new(0)),
        last_report: tokio::sync::Mutex::new(None),
        oauth_cancel: Arc::new(AtomicBool::new(false)),
        disconnecting: Arc::new(AtomicBool::new(false)),
    });
}

pub struct SyncGuard(Arc<AtomicBool>);
impl Drop for SyncGuard {
    fn drop(&mut self) {
        self.0.store(false, Ordering::SeqCst);
    }
}

/// Sets `disconnecting` false again when the disconnect flow ends (F1),
/// however it returns — so a refused/early-return disconnect never leaves the
/// gate stuck closed against future syncs.
struct DisconnectGuard(Arc<AtomicBool>);
impl Drop for DisconnectGuard {
    fn drop(&mut self) {
        self.0.store(false, Ordering::SeqCst);
    }
}

/// Rejected-sync message when a disconnect is in progress (F1).
const DISCONNECTING_MSG: &str = "OneDrive is disconnecting; syncing is paused until that finishes.";

/// Win the single sync slot for one run. Refuses if a sync is already running
/// OR a disconnect is in progress (F1). The disconnect check happens AFTER
/// winning `is_syncing`, which is what closes the race: under the SeqCst total
/// order, a sync that gets past this check must have set `is_syncing` before
/// disconnect's idle-wait reads it (so disconnect WAITS for this sync rather
/// than purging under it), and a sync that starts after disconnect raised the
/// flag observes it here and bails without clearing `cancel` or writing
/// anything. On refusal the returned guard is never created, so `is_syncing`
/// is released immediately.
pub fn acquire_sync_slot(state: &OneDriveState) -> Result<SyncGuard, String> {
    if state
        .is_syncing
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return Err("a OneDrive sync is already in progress".into());
    }
    let guard = SyncGuard(state.is_syncing.clone());
    if state.disconnecting.load(Ordering::SeqCst) {
        // `guard` drops here, releasing the slot we just took.
        return Err(DISCONNECTING_MSG.into());
    }
    Ok(guard)
}

fn client_id() -> String {
    option_env!("LANTERN_MS_CLIENT_ID")
        .unwrap_or("845ddba0-70ab-4f90-88ba-e3522157e37a")
        .to_string()
}

fn token_entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_REFRESH_KEY).map_err(|e| e.to_string())
}

async fn fresh_access_token(
    policy: &crate::network_policy::NetworkPolicy,
) -> Result<String, String> {
    let entry = token_entry()?;
    let rt = entry
        .get_password()
        .map_err(|_| "not connected".to_string())?;
    let auth = OAuth::new(client_id(), policy.clone());
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

fn graph_token_refresh(policy: crate::network_policy::NetworkPolicy) -> GraphTokenRefresh {
    Arc::new(move || -> GraphTokenRefreshFuture {
        let policy = policy.clone();
        Box::pin(async {
            fresh_access_token(&policy)
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
pub async fn onedrive_connect(
    state: State<'_, OneDriveState>,
    policy: State<'_, crate::network_policy::NetworkPolicy>,
) -> Result<(), String> {
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
    crate::commands::connector_network::authorize_url(
        &policy,
        &crate::network_policy::ONEDRIVE_OAUTH,
        &url,
    )
    .map_err(|e| e.to_string())?;
    open_browser(&url);
    let code = await_redirect_code_or_cancel(
        listener,
        &state_token,
        std::time::Duration::from_secs(300),
        cancel.clone(),
    )
    .await
    .map_err(|e| e.to_string())?;
    crate::commands::connector_network::authorize_url(
        &policy,
        &crate::network_policy::ONEDRIVE_OAUTH,
        MS_TOKEN_ENDPOINT,
    )
    .map_err(|e| e.to_string())?;
    let tokens = ms_exchange_code(
        &policy,
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
        || {
            entry
                .set_password(&tokens.refresh)
                .map_err(|e| e.to_string())
        },
        || match &previous_token {
            Some(prev) => {
                let _ = entry.set_password(prev);
            }
            None => {
                let _ = entry.delete_credential();
            }
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
pub async fn onedrive_begin_login(
    policy: State<'_, crate::network_policy::NetworkPolicy>,
) -> Result<DeviceCodePrompt, String> {
    crate::commands::connector_network::authorize_url(
        &policy,
        &crate::network_policy::ONEDRIVE_OAUTH,
        "https://login.microsoftonline.com",
    )
    .map_err(|e| e.to_string())?;
    let auth = OAuth::new(client_id(), policy.inner().clone());
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
pub async fn onedrive_poll_login(
    device_code: String,
    policy: State<'_, crate::network_policy::NetworkPolicy>,
) -> Result<String, String> {
    crate::commands::connector_network::authorize_url(
        &policy,
        &crate::network_policy::ONEDRIVE_OAUTH,
        "https://login.microsoftonline.com",
    )
    .map_err(|e| e.to_string())?;
    let auth = OAuth::new(client_id(), policy.inner().clone());
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

/// How long the disconnect flow waits for an in-flight sync to actually stop
/// after setting the cancel flag, before giving up. The cancel is honored at
/// the engine's per-file checkpoints, so this only ever waits out the current
/// file's download+write — 15s is generous headroom over that.
const DISCONNECT_SYNC_WAIT: Duration = Duration::from_secs(15);

/// Poll `is_syncing` until it clears, or `max` elapses. Returns `true` if the
/// sync stopped in time, `false` on timeout. This is the backend guarantee for
/// F2: disconnect must not purge/report while a sync could still commit a
/// mid-flight write AFTER the purge (which would resurrect deleted data and can
/// even recreate the tracking DB via a store upsert).
async fn wait_for_sync_idle(is_syncing: &AtomicBool, max: Duration) -> bool {
    let start = std::time::Instant::now();
    while is_syncing.load(Ordering::SeqCst) {
        if start.elapsed() >= max {
            return false;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    true
}

async fn delete_materialized_rag_rows(
    table: &lancedb::Table,
    ws: &std::path::Path,
    rel: &str,
    rag_key: &[u8; 32],
) -> anyhow::Result<()> {
    crate::commands::rag::store::delete_path(table, rel, rag_key).await?;

    // The file watcher indexes materialized files with the exact absolute path
    // string emitted by notify (`PathBuf::to_string_lossy`). The OneDrive store
    // records the workspace-relative path, so disconnect must purge both keys.
    let abs = ws.join(rel).to_string_lossy().to_string();
    if abs != rel {
        crate::commands::rag::store::delete_path(table, &abs, rag_key).await?;
    }

    Ok(())
}

/// Delete every materialized OneDrive file the store recorded a `local_path`
/// for (the imported documents sitting in the user's client folders). Returns
/// the workspace-relative paths that could NOT be removed — empty means every
/// file is gone. A file already missing (the user moved/deleted it themselves)
/// counts as successfully removed. After each successful file removal, the
/// matching normal-document RAG rows are purged by path too; that cleanup is
/// part of the disconnect, not just a best-effort watcher side effect. The
/// store is opened by the caller-supplied `open_store` so tests can inject a
/// known key instead of the OS keychain.
async fn delete_materialized_files<F>(
    ws: &std::path::Path,
    open_store: &F,
    rag_key: &[u8; 32],
) -> Result<Vec<String>, String>
where
    F: Fn(&std::path::Path) -> anyhow::Result<OneDriveStore>,
{
    let store = open_store(ws).map_err(|e| e.to_string())?;
    let paths = store.all_local_paths().map_err(|e| e.to_string())?;
    // F3: enforce the workspace boundary on every stored path BEFORE touching
    // the filesystem. The DB strings are ours, but a delete is destructive, so
    // apply the repo's PathValidator principle (`pathguard`): reject an
    // absolute path, any `..` component, and any symlink escape. Resolve
    // containment against the canonicalized workspace root; if the root itself
    // can't be canonicalized, we can't safely delete anything.
    let canon_ws = ws
        .canonicalize()
        .map_err(|e| format!("workspace root unavailable, cannot delete safely: {e}"))?;
    let conn = crate::commands::rag::store::open_connection(ws)
        .await
        .map_err(|e| e.to_string())?;
    let table = crate::commands::rag::store::open_or_create_table(&conn)
        .await
        .map_err(|e| e.to_string())?;
    let mut failed = Vec::new();
    for rel in paths {
        match crate::commands::pathguard::canonicalize_workspace_relative(&canon_ws, &rel) {
            // A safe, contained, symlink-free path that exists on disk — remove it.
            Ok(Some(abs)) => match std::fs::remove_file(&abs) {
                Ok(()) => {
                    if let Err(e) = delete_materialized_rag_rows(&table, ws, &rel, rag_key).await {
                        log::warn!(
                            "onedrive_disconnect: failed to purge RAG rows for deleted file {rel}: {e}"
                        );
                        failed.push(rel);
                    }
                }
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                    if let Err(e) = delete_materialized_rag_rows(&table, ws, &rel, rag_key).await {
                        log::warn!(
                            "onedrive_disconnect: failed to purge RAG rows for missing file {rel}: {e}"
                        );
                        failed.push(rel);
                    }
                }
                Err(e) => {
                    log::warn!(
                        "onedrive_disconnect: failed to delete imported file {}: {e}",
                        abs.display()
                    );
                    failed.push(rel);
                }
            },
            // The path resolved safely but no file is there (already gone) —
            // that counts as successfully removed, same as NotFound above.
            Ok(None) => {
                if let Err(e) = delete_materialized_rag_rows(&table, ws, &rel, rag_key).await {
                    log::warn!(
                        "onedrive_disconnect: failed to purge RAG rows for already-missing file {rel}: {e}"
                    );
                    failed.push(rel);
                }
            }
            // Unsafe stored path (absolute, `..`, or a symlink component). NEVER
            // delete through it — treat it as a failed delete so the token + DB
            // are kept and `data_remains` is flagged for a retry.
            Err(e) => {
                log::warn!("onedrive_disconnect: refusing to delete unsafe stored path {rel}: {e}");
                failed.push(rel);
            }
        }
    }
    Ok(failed)
}

/// Core disconnect logic — thin wrapper over `onedrive_disconnect_logic_with`
/// using the real OS-keychain store opener and the production sync-wait bound.
///
/// `delete_files` = the user's opt-in choice: when `true`, the materialized
/// OneDrive files in their client folders are deleted too; when `false`
/// (default), those files STAY (they're the user's documents now, possibly
/// edited) and only the connection + search index are removed.
pub async fn onedrive_disconnect_logic(
    state: &OneDriveState,
    delete_files: bool,
) -> Result<OneDriveDisconnectResult, String> {
    onedrive_disconnect_logic_with(
        state,
        delete_files,
        |ws| OneDriveStore::open(ws),
        || {
            crate::commands::rag::crypto::get_or_create_master_key()
                .map_err(|e| format!("vectors key: {e}"))
        },
        DISCONNECT_SYNC_WAIT,
    )
    .await
}

/// Core disconnect logic with injectable seams — extracted for testability so
/// integration tests can drive the full disconnect path without a Tauri runtime
/// or the OS keychain, and with a short sync-wait bound.
///
/// Order of operations:
/// 1. Set cancel, then WAIT for any in-flight sync to actually stop (F2). On
///    timeout, keep the token and report `data_remains` — never purge/report
///    while a sync could still commit a write after the purge.
/// 2. If `delete_files`, delete the materialized files FIRST (before the
///    tracking DB — the only record of their paths — is removed). Any failure
///    keeps everything (token + DB) so the retry can re-enumerate and finish.
/// 3. Purge local data (RAG chunks + the OneDrive sync-state DB), and remove
///    the Microsoft refresh token ONLY AFTER that purge succeeds — so the user
///    is never disconnected with data stranded on disk.
///
/// Returns an `OneDriveDisconnectResult` that reports exactly what happened;
/// essentially never propagates `Err`.
pub async fn onedrive_disconnect_logic_with<F>(
    state: &OneDriveState,
    delete_files: bool,
    open_store: F,
    rag_key_provider: impl Fn() -> Result<[u8; 32], String>,
    sync_wait: Duration,
) -> Result<OneDriveDisconnectResult, String>
where
    F: Fn(&std::path::Path) -> anyhow::Result<OneDriveStore>,
{
    let mut result = OneDriveDisconnectResult::default();

    // F1: close the gate FIRST — before raising cancel or waiting — so no new
    // sync (or folder-discovery walk that leads into one) can start during the
    // whole disconnect and re-materialize files right after the purge. Released
    // when this function returns, however it returns.
    if state
        .disconnecting
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return Err("OneDrive disconnect is already running; try again in a moment.".into());
    }
    let _disconnect_guard = DisconnectGuard(state.disconnecting.clone());

    state.cancel.store(true, Ordering::SeqCst);

    // F2: an in-flight sync must fully stop before we purge — otherwise a file
    // caught between the engine's cancel checks and its write commits AFTER the
    // purge, reappearing on disk (and its store upsert can recreate the DB).
    if !wait_for_sync_idle(&state.is_syncing, sync_wait).await {
        result.data_remains = true;
        result.warnings.push(
            "An import was still stopping, so the OneDrive data was NOT deleted yet. Your \
             account connection was kept — try disconnecting again in a moment to finish."
                .to_string(),
        );
        return Ok(result);
    }

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
        return Ok(result);
    };

    // F1: opt-in delete of the materialized files. Do this BEFORE the tracking
    // DB is purged (it's the only record of where those files live). Any
    // failure → keep the token AND the DB, flag data_remains, and stop — so the
    // "Finish deleting local data" retry can re-enumerate the paths and finish.
    if delete_files {
        let rag_key = match rag_key_provider() {
            Ok(key) => key,
            Err(e) => {
                result.data_remains = true;
                result.warnings.push(format!(
                    "The imported OneDrive files could not be deleted ({e}); your account \
                     connection was kept so you can try disconnecting again to finish deleting."
                ));
                return Ok(result);
            }
        };
        match delete_materialized_files(&ws, &open_store, &rag_key).await {
            Ok(failed) if failed.is_empty() => {}
            Ok(failed) => {
                result.data_remains = true;
                result.warnings.push(format!(
                    "{} imported OneDrive {} could not be deleted; your account connection was \
                     kept so you can try disconnecting again to finish deleting.",
                    failed.len(),
                    if failed.len() == 1 { "file" } else { "files" },
                ));
                return Ok(result);
            }
            Err(e) => {
                result.data_remains = true;
                result.warnings.push(format!(
                    "The imported OneDrive files could not be deleted ({e}); your account \
                     connection was kept so you can try disconnecting again to finish deleting."
                ));
                return Ok(result);
            }
        }
    }

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

    Ok(result)
}

/// Disconnect the OneDrive/SharePoint account: stop any in-flight sync, remove
/// the connection + search index, and — only when the user opts in via
/// `delete_files` — delete the materialized files imported into their client
/// folders. Returns an `OneDriveDisconnectResult` that reports exactly what was
/// and was not deleted — the UI must use these flags to show an honest status
/// rather than always claiming "disconnected". Thin wrapper over
/// `onedrive_disconnect_logic`.
#[tauri::command]
pub async fn onedrive_disconnect(
    app: AppHandle,
    state: State<'_, OneDriveState>,
    delete_files: bool,
) -> Result<OneDriveDisconnectResult, String> {
    let result = onedrive_disconnect_logic(&state, delete_files).await;
    // A successful purge removed RAG rows, so any cached citation verdicts may
    // now point at deleted content. Announce that on a dedicated invalidation
    // event, not the indexing-progress channel: a purge is not an authoritative
    // snapshot of the live indexer state.
    if let Ok(r) = &result {
        if r.rag_purged {
            let _ = app.emit(
                crate::commands::rag::CONTENT_INVALIDATED_EVENT,
                crate::commands::rag::ContentInvalidated {
                    source: "onedrive".to_string(),
                    deleted: 1,
                },
            );
        }
    }
    result
}

#[tauri::command]
pub async fn onedrive_list_drives(
    policy: State<'_, crate::network_policy::NetworkPolicy>,
) -> Result<Vec<Drive>, String> {
    authorize_onedrive(&policy)?;
    let token = fresh_access_token(&policy).await?;
    OneDriveClient::new_with_refresh(token, graph_token_refresh(policy.inner().clone()))
        .with_network_policy(policy.inner().clone(), crate::network_policy::ONEDRIVE_SYNC)
        .list_drives()
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn onedrive_list_folders(
    state: State<'_, OneDriveState>,
    policy: State<'_, crate::network_policy::NetworkPolicy>,
) -> Result<Vec<OneDriveFolderDto>, String> {
    authorize_onedrive(&policy)?;
    // F1: refuse the folder-discovery walk (the step `runSync()` runs BEFORE
    // `onedrive_sync`) while a disconnect is in progress — it would otherwise
    // clear the cancel flag below and lead straight into a sync that
    // re-materializes files the disconnect is about to purge.
    if state.disconnecting.load(Ordering::SeqCst) {
        return Err(DISCONNECTING_MSG.to_string());
    }
    // Fresh call, fresh cancel intent — a flag left set by a PRIOR stop
    // (Cancel button, or a cancelled sync) must not immediately kill this
    // brand new listing before it even starts.
    state.cancel.store(false, Ordering::SeqCst);
    let cancel = state.cancel.clone();
    match tokio::time::timeout(
        LIST_FOLDERS_TIMEOUT,
        list_folders_body(cancel, policy.inner().clone()),
    )
    .await
    {
        Ok(result) => result,
        Err(_elapsed) => Err(TIMED_OUT_LIST_FOLDERS.to_string()),
    }
}

async fn list_folders_body(
    cancel: Arc<AtomicBool>,
    policy: crate::network_policy::NetworkPolicy,
) -> Result<Vec<OneDriveFolderDto>, String> {
    let token = fresh_access_token(&policy).await?;
    let client = OneDriveClient::new_with_refresh(token, graph_token_refresh(policy.clone()))
        .with_network_policy(policy, crate::network_policy::ONEDRIVE_SYNC);
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

fn authorize_onedrive(policy: &crate::network_policy::NetworkPolicy) -> Result<(), String> {
    crate::commands::connector_network::authorize_url(
        policy,
        &crate::network_policy::ONEDRIVE_OAUTH,
        "https://login.microsoftonline.com",
    )
    .map_err(|e| e.to_string())?;
    crate::commands::connector_network::authorize_url(
        policy,
        &crate::network_policy::ONEDRIVE_SYNC,
        "https://graph.microsoft.com",
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn onedrive_sync(
    app: AppHandle,
    state: State<'_, OneDriveState>,
    policy: State<'_, crate::network_policy::NetworkPolicy>,
    matter_map: Vec<OneDriveMatterMapEntry>,
) -> Result<OneDriveSyncReport, String> {
    authorize_onedrive(&policy)?;
    // Win the sync slot and refuse if a disconnect is in progress (F1). Only
    // AFTER this succeeds is `cancel` cleared below — a sync that bails because
    // a disconnect is underway must not erase the cancel the disconnect raised.
    let _guard = acquire_sync_slot(&state)?;
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
        let token = fresh_access_token(&policy).await?;
        let refresh = graph_token_refresh(policy.inner().clone());
        let store = OneDriveStore::open(&workspace).map_err(|e| e.to_string())?;
        let rag_key =
            crate::commands::rag::crypto::get_or_create_master_key().map_err(|e| e.to_string())?;

        let available_drives = OneDriveClient::new_with_refresh(token.clone(), refresh.clone())
            .with_network_policy(policy.inner().clone(), crate::network_policy::ONEDRIVE_SYNC)
            .list_drives()
            .await
            .unwrap_or_default();
        let drive_ids = sync_drive_ids(&matter_map, &available_drives);
        let mut merged_report = OneDriveSyncReport::default();
        if drive_ids.is_empty() {
            let omit_select = OneDriveClient::new_with_refresh(token.clone(), refresh.clone())
                .with_network_policy(policy.inner().clone(), crate::network_policy::ONEDRIVE_SYNC)
                .default_drive()
                .await
                .map(|drive| is_personal_drive(&drive))
                .unwrap_or(false);
            let source = GraphDocumentSource::new_for_default_drive_with_refresh(
                token,
                omit_select,
                refresh,
                policy.inner().clone(),
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
                    policy.inner().clone(),
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

    let mut cancellation = policy.register_cancellation();
    let outcome = tokio::select! {
        outcome = tokio::time::timeout(SYNC_TIMEOUT, sync_future) => Some(outcome),
        _ = cancellation.cancelled() => {
            state.cancel.store(true, Ordering::SeqCst);
            None
        }
    };
    emitter.abort();
    let outcome = outcome.ok_or_else(|| "Offline Mode cancelled the OneDrive sync.".to_string())?;

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
        let items = vec![folder(
            "folder-1",
            "Clients",
            "drive-1",
            "/drive/root:",
            None,
        )];

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
            folder(
                "folder-1",
                "Should Not Visit",
                "drive-1",
                "/drive/root:",
                None,
            ),
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
        let items = vec![folder(
            "folder-1",
            "Clients",
            "drive-1",
            "/drive/root:",
            None,
        )];
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
        let items = vec![folder(
            "folder-1",
            "Clients",
            "drive-1",
            "/drive/root:",
            None,
        )];

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

    // ── F1: the sync gate ────────────────────────────────────────────────────

    fn test_state(ws: Option<PathBuf>) -> OneDriveState {
        OneDriveState {
            workspace: tokio::sync::Mutex::new(ws),
            is_syncing: Arc::new(AtomicBool::new(false)),
            cancel: Arc::new(AtomicBool::new(false)),
            progress_seen: Arc::new(AtomicU32::new(0)),
            last_report: tokio::sync::Mutex::new(None),
            oauth_cancel: Arc::new(AtomicBool::new(false)),
            disconnecting: Arc::new(AtomicBool::new(false)),
        }
    }

    // A sync must be refused while a disconnect holds the gate — and the refusal
    // must NOT leave the sync slot stuck occupied (or every later sync would be
    // wrongly rejected as "already in progress").
    #[test]
    fn acquire_sync_slot_is_refused_while_disconnecting() {
        let state = test_state(None);
        state.disconnecting.store(true, Ordering::SeqCst);
        assert!(acquire_sync_slot(&state).is_err());
        assert!(
            !state.is_syncing.load(Ordering::SeqCst),
            "a refused acquire must release the sync slot"
        );
    }

    // With no disconnect underway the slot is granted, held for the guard's
    // lifetime (a second concurrent acquire is refused), and cleared on drop.
    #[test]
    fn acquire_sync_slot_grants_and_releases_on_drop() {
        let state = test_state(None);
        {
            let _g = acquire_sync_slot(&state).expect("idle slot should be granted");
            assert!(state.is_syncing.load(Ordering::SeqCst));
            assert!(
                acquire_sync_slot(&state).is_err(),
                "a second sync must be refused while one is running"
            );
        }
        assert!(!state.is_syncing.load(Ordering::SeqCst));
        assert!(acquire_sync_slot(&state).is_ok());
    }

    // ── F3: delete_materialized_files enforces the workspace boundary ─────────

    const TEST_DB_KEY: [u8; 32] = [0x31u8; 32];
    const TEST_RAG_KEY: [u8; 32] = [0x42u8; 32];

    fn open_test_store(ws: &std::path::Path) -> anyhow::Result<OneDriveStore> {
        OneDriveStore::open_with_key(ws, &TEST_DB_KEY)
    }

    fn seed_local_path(ws: &std::path::Path, source_id: &str, name: &str, local_path: &str) {
        let store = OneDriveStore::open_with_key(ws, &TEST_DB_KEY).unwrap();
        store
            .upsert_item(
                source_id,
                "d",
                None,
                source_id,
                name,
                "/clients/acme",
                None,
                "sig",
                "hash",
                "matter-a",
                true,
                false,
            )
            .unwrap();
        store.set_local_path(source_id, local_path).unwrap();
    }

    fn rag_test_row(path: &str, text: &str) -> crate::commands::rag::chunker::Chunk {
        crate::commands::rag::chunker::Chunk {
            path: path.into(),
            paragraph_index: 0,
            text: text.into(),
            start_offset: 0,
            end_offset: text.len(),
            locator: None,
        }
    }

    // An absolute stored path is refused — never deleted — and reported as a
    // failed delete so the caller keeps the token + DB and flags data_remains.
    #[tokio::test]
    async fn delete_materialized_files_refuses_an_absolute_path() {
        let dir = tempfile::TempDir::new().unwrap();
        // A real file OUTSIDE the workspace that must never be touched.
        let outside = tempfile::TempDir::new().unwrap();
        let victim = outside.path().join("secret.txt");
        std::fs::write(&victim, b"do not delete").unwrap();
        seed_local_path(
            dir.path(),
            "onedrive:d:abs",
            "secret.txt",
            victim.to_str().unwrap(),
        );

        let failed = delete_materialized_files(dir.path(), &open_test_store, &TEST_RAG_KEY)
            .await
            .unwrap();
        assert_eq!(failed.len(), 1, "the absolute path must be a failed delete");
        assert!(
            victim.exists(),
            "a file outside the workspace must never be deleted"
        );
    }

    // A `..` traversal is refused — never deleted — and reported as failed.
    #[tokio::test]
    async fn delete_materialized_files_refuses_a_parent_traversal() {
        let dir = tempfile::TempDir::new().unwrap();
        // Create the traversal target so a naive `ws.join(rel)` delete WOULD hit it.
        let escape = dir.path().parent().unwrap().join("onedrive-f3-escape.txt");
        std::fs::write(&escape, b"keep me").unwrap();
        // Point the stored path at that concrete escape target via `..`.
        seed_local_path(
            dir.path(),
            "onedrive:d:dots",
            "onedrive-f3-escape.txt",
            "../onedrive-f3-escape.txt",
        );

        let failed = delete_materialized_files(dir.path(), &open_test_store, &TEST_RAG_KEY)
            .await
            .unwrap();
        assert_eq!(failed.len(), 1);
        assert!(
            escape.exists(),
            "a `..` traversal must never delete outside the workspace"
        );
        let _ = std::fs::remove_file(&escape);
    }

    // A normal, in-workspace path deletes cleanly (the guard doesn't break the
    // happy path).
    #[tokio::test]
    async fn delete_materialized_files_deletes_a_safe_in_workspace_path() {
        let dir = tempfile::TempDir::new().unwrap();
        let rel = "Clients/Acme/memo.docx";
        let abs = dir.path().join(rel);
        std::fs::create_dir_all(abs.parent().unwrap()).unwrap();
        std::fs::write(&abs, b"bytes").unwrap();
        seed_local_path(dir.path(), "onedrive:d:ok", "memo.docx", rel);

        let failed = delete_materialized_files(dir.path(), &open_test_store, &TEST_RAG_KEY)
            .await
            .unwrap();
        assert!(failed.is_empty(), "a safe path must delete cleanly");
        assert!(!abs.exists());
    }

    #[tokio::test]
    async fn delete_materialized_files_purges_normal_document_rag_rows_for_deleted_path() {
        let dir = tempfile::TempDir::new().unwrap();
        let rel = "Clients/Acme/retirement-plan.txt";
        let abs = dir.path().join(rel);
        std::fs::create_dir_all(abs.parent().unwrap()).unwrap();
        std::fs::write(&abs, b"retirement plan").unwrap();
        seed_local_path(dir.path(), "onedrive:d:rag", "retirement-plan.txt", rel);

        let conn = crate::commands::rag::store::open_connection(dir.path())
            .await
            .expect("open rag conn");
        let table = crate::commands::rag::store::open_or_create_table(&conn)
            .await
            .expect("open rag table");
        crate::commands::rag::store::upsert_chunks_for_path(
            &table,
            rel,
            vec![(
                rag_test_row(rel, "Retirement income ladder shows the ghost chunk."),
                vec![0.25f32; crate::commands::rag::embedder::EMBEDDING_DIM],
            )],
            crate::commands::rag::store::SourceType::Text,
            "matter-acme",
            crate::commands::rag::store::PRIVILEGE_NONE,
            &TEST_RAG_KEY,
        )
        .await
        .expect("seed normal-file rag row");
        let query = vec![0.25f32; crate::commands::rag::embedder::EMBEDDING_DIM];
        let before = crate::commands::rag::store::nearest(
            &table,
            &query,
            10,
            Some("matter-acme"),
            false,
            &[],
        )
        .await
        .expect("retrieve before delete");
        assert!(
            !before.is_empty(),
            "precondition: the normal file row is searchable"
        );

        let failed = delete_materialized_files(dir.path(), &open_test_store, &TEST_RAG_KEY)
            .await
            .expect("delete materialized files");
        assert!(failed.is_empty(), "delete + RAG purge must both succeed");
        assert!(!abs.exists(), "the materialized file should be deleted");

        let after = crate::commands::rag::store::nearest(
            &table,
            &query,
            10,
            Some("matter-acme"),
            false,
            &[],
        )
        .await
        .expect("retrieve after delete");
        assert!(
            after.is_empty(),
            "deleted OneDrive file must not leave ghost RAG hits"
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
