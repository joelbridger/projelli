//! Tauri commands for the provisional read-only Zocks connector.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::commands::zocks::client::ZocksClient;
use crate::commands::zocks::engine;
use crate::commands::zocks::model::{ZocksMatterMapEntry, ZocksSession};
use crate::commands::zocks::store::{ZocksStore, ZocksUnassignedRow};

const KEYCHAIN_SERVICE: &str = crate::identity::ZOCKS_SERVICE;
const KEYCHAIN_API_KEY: &str = "api-key";

pub const ZOCKS_SYNC_PROGRESS_EVENT: &str = "zocks-sync-progress";

pub struct ZocksState {
    pub workspace: tokio::sync::Mutex<Option<PathBuf>>,
    pub is_syncing: Arc<AtomicBool>,
    pub cancel: Arc<AtomicBool>,
    pub last_report: tokio::sync::Mutex<Option<ZocksSyncReportDto>>,
    pub progress_sessions: Arc<AtomicU32>,
}

pub fn manage_state(app: &tauri::App) {
    app.manage(ZocksState {
        workspace: tokio::sync::Mutex::new(None),
        is_syncing: Arc::new(AtomicBool::new(false)),
        cancel: Arc::new(AtomicBool::new(false)),
        last_report: tokio::sync::Mutex::new(None),
        progress_sessions: Arc::new(AtomicU32::new(0)),
    });
}

struct SyncGuard(Arc<AtomicBool>);
impl Drop for SyncGuard {
    fn drop(&mut self) {
        self.0.store(false, Ordering::SeqCst);
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ZocksConnectInfo {
    pub base_url: String,
    pub endpoint_status: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ZocksSessionSummary {
    pub id: String,
    pub title: String,
    pub client_name: String,
    pub started_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ZocksSyncReportDto {
    pub sessions_fetched: u32,
    pub sessions_changed: u32,
    pub sessions_indexed: u32,
    pub records_indexed: u32,
    pub needs_assignment: u32,
    /// Sessions skipped this sync because their detail fetch kept failing. They
    /// are retried on the next sync; surfaced so the UI can tell the user some
    /// meetings were temporarily skipped rather than silently dropped.
    pub fetch_failures: u32,
    pub cancelled: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ZocksSyncStatusDto {
    pub is_syncing: bool,
    pub last_report: Option<ZocksSyncReportDto>,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ZocksDisconnectResult {
    pub token_deleted: bool,
    pub rag_purged: bool,
    pub zocks_db_purged: bool,
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
pub async fn zocks_set_workspace(
    state: State<'_, ZocksState>,
    path: String,
) -> Result<(), String> {
    *state.workspace.lock().await = Some(PathBuf::from(path));
    Ok(())
}

#[tauri::command]
pub async fn zocks_connect(api_key: String) -> Result<ZocksConnectInfo, String> {
    let api_key = api_key.trim().to_string();
    if api_key.is_empty() {
        return Err("Paste a Zocks API key first.".into());
    }
    let client = ZocksClient::new(api_key.clone());
    client.validate_connection().await.map_err(|e| {
        format!(
            "Could not connect to Zocks. The Zocks API endpoints are provisional pending vendor confirmation. Details: {e}"
        )
    })?;
    store_secret(KEYCHAIN_API_KEY, &api_key)?;
    Ok(ZocksConnectInfo {
        base_url: client.base_url().to_string(),
        endpoint_status: "provisional".into(),
    })
}

#[tauri::command]
pub async fn zocks_is_connected() -> Result<bool, String> {
    Ok(read_secret(KEYCHAIN_API_KEY).is_some())
}

#[tauri::command]
pub async fn zocks_list_sessions() -> Result<Vec<ZocksSessionSummary>, String> {
    let api_key = read_secret(KEYCHAIN_API_KEY).ok_or("Zocks is not connected")?;
    let client = ZocksClient::new(api_key);
    let page = client
        .list_sessions(None, Some(50))
        .await
        .map_err(|e| format!("Could not list Zocks sessions. Endpoints are provisional: {e}"))?;
    Ok(page.sessions.into_iter().map(session_summary).collect())
}

#[tauri::command]
pub async fn zocks_sync(
    app: AppHandle,
    state: State<'_, ZocksState>,
    matter_map: Vec<ZocksMatterMapEntry>,
) -> Result<ZocksSyncReportDto, String> {
    if state
        .is_syncing
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return Err("a Zocks sync is already in progress".into());
    }
    let _guard = SyncGuard(state.is_syncing.clone());
    state.cancel.store(false, Ordering::SeqCst);
    state.progress_sessions.store(0, Ordering::SeqCst);

    let api_key = read_secret(KEYCHAIN_API_KEY).ok_or("Zocks is not connected")?;
    let workspace = state
        .workspace
        .lock()
        .await
        .clone()
        .ok_or("workspace not set - call zocks_set_workspace first")?;

    let _ = app.emit(
        ZOCKS_SYNC_PROGRESS_EVENT,
        serde_json::json!({ "status": "syncing" }),
    );

    let store = ZocksStore::open(&workspace).map_err(|e| {
        let _ = app.emit(
            ZOCKS_SYNC_PROGRESS_EVENT,
            serde_json::json!({ "status": "error" }),
        );
        e.to_string()
    })?;
    let rag_key = crate::commands::rag::crypto::get_or_create_master_key().map_err(|e| {
        let _ = app.emit(
            ZOCKS_SYNC_PROGRESS_EVENT,
            serde_json::json!({ "status": "error" }),
        );
        e.to_string()
    })?;
    let map: HashMap<String, String> = engine::build_matter_map(&matter_map);
    let client = ZocksClient::new(api_key);

    let emit_counter = state.progress_sessions.clone();
    let emit_app = app.clone();
    let emitter = tokio::spawn(async move {
        let mut last = u32::MAX;
        loop {
            tokio::time::sleep(std::time::Duration::from_millis(250)).await;
            let done = emit_counter.load(Ordering::SeqCst);
            if done != last {
                last = done;
                let _ = emit_app.emit(
                    ZOCKS_SYNC_PROGRESS_EVENT,
                    serde_json::json!({ "status": "syncing", "sessions": done }),
                );
            }
        }
    });

    let result = engine::backfill(
        &client,
        &store,
        &workspace,
        &map,
        &state.cancel,
        &rag_key,
        &state.progress_sessions,
    )
    .await;
    emitter.abort();

    let report = match result {
        Ok(report) => report,
        Err(e) => {
            let _ = app.emit(
                ZOCKS_SYNC_PROGRESS_EVENT,
                serde_json::json!({ "status": "error" }),
            );
            return Err(e.to_string());
        }
    };
    let dto = ZocksSyncReportDto {
        sessions_fetched: report.sessions_fetched,
        sessions_changed: report.sessions_changed,
        sessions_indexed: report.sessions_indexed,
        records_indexed: report.records_indexed,
        needs_assignment: report.needs_assignment,
        fetch_failures: report.fetch_failures,
        cancelled: report.cancelled,
    };
    *state.last_report.lock().await = Some(dto.clone());
    let _ = app.emit(
        ZOCKS_SYNC_PROGRESS_EVENT,
        serde_json::json!({
            "status": if dto.cancelled { "cancelled" } else { "done" },
            "sessions": dto.sessions_indexed,
            "records": dto.records_indexed,
            "needsAssignment": dto.needs_assignment,
            "fetchFailures": dto.fetch_failures,
        }),
    );
    Ok(dto)
}

#[tauri::command]
pub async fn zocks_cancel(state: State<'_, ZocksState>) -> Result<(), String> {
    state.cancel.store(true, Ordering::SeqCst);
    Ok(())
}

#[tauri::command]
pub async fn zocks_status(state: State<'_, ZocksState>) -> Result<ZocksSyncStatusDto, String> {
    let is_syncing = state.is_syncing.load(Ordering::SeqCst);
    if is_syncing {
        return Ok(ZocksSyncStatusDto {
            is_syncing,
            last_report: Some(ZocksSyncReportDto {
                sessions_indexed: state.progress_sessions.load(Ordering::SeqCst),
                ..Default::default()
            }),
        });
    }
    Ok(ZocksSyncStatusDto {
        is_syncing,
        last_report: state.last_report.lock().await.clone(),
    })
}

#[tauri::command]
pub async fn zocks_disconnect(
    state: State<'_, ZocksState>,
) -> Result<ZocksDisconnectResult, String> {
    let mut result = ZocksDisconnectResult::default();
    state.cancel.store(true, Ordering::SeqCst);
    if state
        .is_syncing
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        result.data_remains = true;
        result
            .warnings
            .push("A Zocks sync is still running. Stop it and try disconnecting again.".into());
        return Ok(result);
    }
    let _guard = SyncGuard(state.is_syncing.clone());

    let Some(ws) = state.workspace.lock().await.clone() else {
        result.data_remains = true;
        result
            .warnings
            .push("No workspace is open, so imported Zocks data could not be located.".into());
        return Ok(result);
    };

    match purge_zocks_rag_chunks(&ws).await {
        Ok(()) => result.rag_purged = true,
        Err(e) => result.warnings.push(format!("Search-index purge failed: {e}")),
    }
    match ZocksStore::purge(&ws) {
        Ok(()) => result.zocks_db_purged = true,
        Err(e) => result.warnings.push(format!("Zocks local database purge failed: {e}")),
    }

    if result.rag_purged && result.zocks_db_purged {
        match delete_secret(KEYCHAIN_API_KEY) {
            Ok(()) => result.token_deleted = true,
            Err(e) => result.warnings.push(format!("Zocks API key delete failed: {e}")),
        }
        if let Err(e) = ZocksStore::delete_master_key() {
            result
                .warnings
                .push(format!("Zocks database key delete failed: {e}"));
        }
    } else {
        result.data_remains = true;
        result
            .warnings
            .push("Some imported Zocks data could not be deleted; the API key was kept.".into());
    }

    Ok(result)
}

#[tauri::command]
pub async fn zocks_list_unassigned(
    state: State<'_, ZocksState>,
) -> Result<Vec<ZocksUnassignedRow>, String> {
    let workspace = state
        .workspace
        .lock()
        .await
        .clone()
        .ok_or_else(|| "workspace not set - call zocks_set_workspace first".to_string())?;
    let store = ZocksStore::open(&workspace).map_err(|e| e.to_string())?;
    store.list_unassigned().map_err(|e| e.to_string())
}

async fn purge_zocks_rag_chunks(ws: &std::path::Path) -> anyhow::Result<()> {
    let store = ZocksStore::open(ws)?;
    let source_ids = store.list_source_ids()?;
    let key = crate::commands::rag::crypto::get_or_create_master_key()?;
    let conn = crate::commands::rag::store::open_connection(ws).await?;
    let table = crate::commands::rag::store::open_or_create_table(&conn).await?;
    for source_id in source_ids {
        crate::commands::rag::store::delete_path(&table, &source_id, &key).await?;
    }
    Ok(())
}

fn session_summary(session: ZocksSession) -> ZocksSessionSummary {
    ZocksSessionSummary {
        id: session.id,
        title: session.title,
        client_name: session.client_name,
        started_at: session.started_at,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn matter_map_drops_duplicate_keys_as_ambiguous() {
        // Two matters claiming the same key is ambiguous: the key must NOT map to
        // either, so the meeting is left for manual assignment rather than being
        // silently filed under whichever entry came first (matter-isolation bug
        // flagged by Codex). The unambiguous case is covered in engine tests.
        let entries = vec![
            ZocksMatterMapEntry {
                zocks_key: " Amelia@Example.COM ".into(),
                matter_id: "matter-first".into(),
            },
            ZocksMatterMapEntry {
                zocks_key: "amelia@example.com".into(),
                matter_id: "matter-second".into(),
            },
        ];
        let map = engine::build_matter_map(&entries);
        assert!(!map.contains_key("amelia@example.com"));
    }

    #[test]
    fn matter_map_skips_blank_keys() {
        let entries = vec![ZocksMatterMapEntry {
            zocks_key: " ".into(),
            matter_id: "matter-a".into(),
        }];
        assert!(engine::build_matter_map(&entries).is_empty());
    }
}
