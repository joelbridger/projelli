//! Tauri commands for the read-only Calendly connector.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::commands::calendly::client::CalendlyClient;
use crate::commands::calendly::engine;
use crate::commands::calendly::store::CalendlyStore;

const KEYCHAIN_SERVICE: &str = crate::identity::CALENDLY_SERVICE;
const KEYCHAIN_TOKEN_KEY: &str = "api-token";
const KEYCHAIN_USER_URI_KEY: &str = "user-uri";

pub const CALENDLY_SYNC_PROGRESS_EVENT: &str = "calendly-sync-progress";

pub struct CalendlyState {
    pub workspace: tokio::sync::Mutex<Option<PathBuf>>,
    pub is_syncing: Arc<AtomicBool>,
    pub cancel: Arc<AtomicBool>,
    pub last_report: tokio::sync::Mutex<Option<CalendlySyncReportDto>>,
    pub progress_meetings: Arc<AtomicU32>,
}

pub fn manage_state(app: &tauri::App) {
    app.manage(CalendlyState {
        workspace: tokio::sync::Mutex::new(None),
        is_syncing: Arc::new(AtomicBool::new(false)),
        cancel: Arc::new(AtomicBool::new(false)),
        last_report: tokio::sync::Mutex::new(None),
        progress_meetings: Arc::new(AtomicU32::new(0)),
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
pub struct CalendlyConnectInfo {
    pub name: String,
    pub email: String,
    pub user_uri: String,
    pub current_organization: String,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CalendlyMatterMapEntry {
    pub meeting_key: String,
    pub matter_id: String,
}

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct CalendlySyncReportDto {
    pub events_fetched: u32,
    pub events_changed: u32,
    pub invitees_fetched: u32,
    pub meetings_indexed: u32,
    pub records_indexed: u32,
    /// True when the user stopped the sync mid-run. Exposed so the frontend can
    /// record an honest "stopped early" audit row instead of a plain success.
    pub cancelled: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendlySyncStatusDto {
    pub is_syncing: bool,
    pub last_report: Option<CalendlySyncReportDto>,
}

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CalendlyDisconnectResult {
    pub token_deleted: bool,
    pub rag_purged: bool,
    pub calendly_db_purged: bool,
    pub data_remains: bool,
    pub warnings: Vec<String>,
}

fn store_secret(key: &str, value: &str) -> Result<(), String> {
    keyring::Entry::new(KEYCHAIN_SERVICE, key)
        .map_err(|e| e.to_string())?
        .set_password(value)
        .map_err(|e| e.to_string())
}

fn read_secret(key: &str) -> Option<String> {
    keyring::Entry::new(KEYCHAIN_SERVICE, key)
        .ok()?
        .get_password()
        .ok()
}

fn delete_secret(key: &str) -> Result<(), String> {
    match keyring::Entry::new(KEYCHAIN_SERVICE, key)
        .map_err(|e| e.to_string())?
        .delete_credential()
    {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub async fn calendly_set_workspace(
    state: State<'_, CalendlyState>,
    path: String,
) -> Result<(), String> {
    *state.workspace.lock().await = Some(PathBuf::from(path));
    Ok(())
}

#[tauri::command]
pub async fn calendly_connect(token: String) -> Result<CalendlyConnectInfo, String> {
    let user = CalendlyClient::current_user_with_token(token.clone())
        .await
        .map_err(|_| "Could not connect to Calendly: invalid token or network error".to_string())?;

    if user.uri.trim().is_empty() {
        return Err(
            "Could not connect to Calendly: the account response did not include a user URI".into(),
        );
    }
    store_secret(KEYCHAIN_TOKEN_KEY, &token)?;
    store_secret(KEYCHAIN_USER_URI_KEY, &user.uri)?;

    Ok(CalendlyConnectInfo {
        name: user.name,
        email: user.email,
        user_uri: user.uri,
        current_organization: user.current_organization,
    })
}

#[tauri::command]
pub async fn calendly_is_connected() -> Result<bool, String> {
    Ok(read_secret(KEYCHAIN_TOKEN_KEY).is_some() && read_secret(KEYCHAIN_USER_URI_KEY).is_some())
}

#[tauri::command]
pub async fn calendly_sync_all(
    app: AppHandle,
    state: State<'_, CalendlyState>,
    matter_map: Vec<CalendlyMatterMapEntry>,
) -> Result<CalendlySyncReportDto, String> {
    if state
        .is_syncing
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return Err("a Calendly sync is already in progress".into());
    }
    let _sync_guard = SyncGuard(state.is_syncing.clone());
    state.cancel.store(false, Ordering::SeqCst);
    state.progress_meetings.store(0, Ordering::SeqCst);

    let token = read_secret(KEYCHAIN_TOKEN_KEY).ok_or("Calendly not connected")?;
    let user_uri = read_secret(KEYCHAIN_USER_URI_KEY).ok_or("Calendly user is missing")?;
    let workspace = state
        .workspace
        .lock()
        .await
        .clone()
        .ok_or("workspace not set — call calendly_set_workspace first")?;

    let _ = app.emit(
        CALENDLY_SYNC_PROGRESS_EVENT,
        serde_json::json!({ "status": "syncing" }),
    );
    let map = build_matter_map(&matter_map);
    let store = CalendlyStore::open(&workspace).map_err(|e| {
        let _ = app.emit(
            CALENDLY_SYNC_PROGRESS_EVENT,
            serde_json::json!({ "status": "error" }),
        );
        e.to_string()
    })?;
    let rag_key = crate::commands::rag::crypto::get_or_create_master_key().map_err(|e| {
        let _ = app.emit(
            CALENDLY_SYNC_PROGRESS_EVENT,
            serde_json::json!({ "status": "error" }),
        );
        e.to_string()
    })?;

    let emit_counter = state.progress_meetings.clone();
    let emit_app = app.clone();
    let emitter = tokio::spawn(async move {
        let mut last = u32::MAX;
        loop {
            tokio::time::sleep(std::time::Duration::from_millis(250)).await;
            let done = emit_counter.load(Ordering::SeqCst);
            if done != last {
                last = done;
                let _ = emit_app.emit(
                    CALENDLY_SYNC_PROGRESS_EVENT,
                    serde_json::json!({ "status": "syncing", "meetings": done }),
                );
            }
        }
    });

    let client = CalendlyClient::new(token, user_uri);
    let result = engine::backfill(
        &client,
        &store,
        &workspace,
        &map,
        &state.cancel,
        &rag_key,
        &state.progress_meetings,
    )
    .await;
    emitter.abort();

    let report = match result {
        Ok(r) => r,
        Err(e) => {
            let _ = app.emit(
                CALENDLY_SYNC_PROGRESS_EVENT,
                serde_json::json!({ "status": "error" }),
            );
            return Err(e.to_string());
        }
    };
    let dto = CalendlySyncReportDto {
        events_fetched: report.events_fetched,
        events_changed: report.events_changed,
        invitees_fetched: report.invitees_fetched,
        meetings_indexed: report.meetings_indexed,
        records_indexed: report.records_indexed,
        cancelled: report.cancelled,
    };
    let _ = app.emit(
        CALENDLY_SYNC_PROGRESS_EVENT,
        serde_json::json!({
            "status": if report.cancelled { "cancelled" } else { "done" },
            "meetings": dto.meetings_indexed,
            "records": dto.records_indexed,
        }),
    );
    *state.last_report.lock().await = Some(dto.clone());
    Ok(dto)
}

#[tauri::command]
pub async fn calendly_sync_status(
    state: State<'_, CalendlyState>,
) -> Result<CalendlySyncStatusDto, String> {
    let is_syncing = state.is_syncing.load(Ordering::SeqCst);
    if is_syncing {
        return Ok(CalendlySyncStatusDto {
            is_syncing,
            last_report: Some(CalendlySyncReportDto {
                meetings_indexed: state.progress_meetings.load(Ordering::SeqCst),
                ..Default::default()
            }),
        });
    }
    Ok(CalendlySyncStatusDto {
        is_syncing,
        last_report: state.last_report.lock().await.clone(),
    })
}

#[tauri::command]
pub async fn calendly_cancel_sync(state: State<'_, CalendlyState>) -> Result<(), String> {
    state.cancel.store(true, Ordering::SeqCst);
    Ok(())
}

#[tauri::command]
pub async fn calendly_disconnect(
    state: State<'_, CalendlyState>,
) -> Result<CalendlyDisconnectResult, String> {
    Ok(calendly_disconnect_logic(&state).await)
}

pub async fn calendly_disconnect_logic(state: &CalendlyState) -> CalendlyDisconnectResult {
    let mut result = CalendlyDisconnectResult::default();
    state.cancel.store(true, Ordering::SeqCst);
    if state
        .is_syncing
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        result.data_remains = true;
        result.warnings.push(
            "A Calendly sync is still running; try disconnecting again after it stops.".into(),
        );
        return result;
    }
    let _guard = SyncGuard(state.is_syncing.clone());

    let Some(ws) = state.workspace.lock().await.clone() else {
        result.data_remains = true;
        result
            .warnings
            .push("No workspace is open, so imported Calendly data could not be located.".into());
        return result;
    };

    match purge_calendly_rag_chunks(&ws).await {
        Ok(()) => result.rag_purged = true,
        Err(e) => {
            result
                .warnings
                .push(format!("Search-index purge failed: {e}"));
        }
    }
    match CalendlyStore::purge(&ws) {
        Ok(()) => result.calendly_db_purged = true,
        Err(e) => result
            .warnings
            .push(format!("Calendly database purge failed: {e}")),
    }

    if result.rag_purged && result.calendly_db_purged {
        let token_ok = delete_secret(KEYCHAIN_TOKEN_KEY).is_ok();
        let user_ok = delete_secret(KEYCHAIN_USER_URI_KEY).is_ok();
        result.token_deleted = token_ok && user_ok;
        if let Err(e) = CalendlyStore::delete_master_key() {
            result
                .warnings
                .push(format!("Calendly database key removal failed: {e}"));
        }
    } else {
        result.data_remains = true;
        result
            .warnings
            .push("Some imported Calendly data could not be deleted; the token was kept.".into());
    }

    result
}

async fn purge_calendly_rag_chunks(ws: &std::path::Path) -> anyhow::Result<()> {
    let store = CalendlyStore::open(ws)?;
    let source_ids = store.list_source_ids()?;
    let key = crate::commands::rag::crypto::get_or_create_master_key()?;
    let conn = crate::commands::rag::store::open_connection(ws).await?;
    let table = crate::commands::rag::store::open_or_create_table(&conn).await?;
    for source_id in source_ids {
        crate::commands::rag::store::delete_path(&table, &source_id, &key).await?;
    }
    Ok(())
}

fn build_matter_map(entries: &[CalendlyMatterMapEntry]) -> HashMap<String, String> {
    let mut map = HashMap::new();
    for entry in entries {
        let key = engine::normalize_name(&entry.meeting_key);
        if key.is_empty() {
            continue;
        }
        map.entry(key).or_insert_with(|| entry.matter_id.clone());
    }
    map
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn calendly_matter_map_duplicate_keys_keep_first_matter() {
        let entries = vec![
            CalendlyMatterMapEntry {
                meeting_key: " Amelia@Example.COM ".to_string(),
                matter_id: "matter-first".to_string(),
            },
            CalendlyMatterMapEntry {
                meeting_key: "amelia@example.com".to_string(),
                matter_id: "matter-second".to_string(),
            },
        ];

        let map = build_matter_map(&entries);

        assert_eq!(map.len(), 1);
        assert_eq!(
            map.get("amelia@example.com").map(String::as_str),
            Some("matter-first")
        );
    }

    #[test]
    fn calendly_matter_map_skips_blank_keys() {
        let entries = vec![CalendlyMatterMapEntry {
            meeting_key: "   ".to_string(),
            matter_id: "matter-blank".to_string(),
        }];

        assert!(build_matter_map(&entries).is_empty());
    }
}
