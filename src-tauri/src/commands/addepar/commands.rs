//! Tauri commands for the read-only Addepar connector.

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::commands::addepar::client::AddeparClient;
use crate::commands::addepar::engine;
use crate::commands::addepar::model::{AddeparConfig, AddeparEntityDto, AddeparMatterMapEntry};

const KEYCHAIN_SERVICE: &str = crate::identity::ADDEPAR_SERVICE;
const KEYCHAIN_CONFIG_KEY: &str = "connection-v1";

pub const ADDEPAR_SYNC_PROGRESS_EVENT: &str = "addepar-sync-progress";

pub struct AddeparState {
    pub workspace: tokio::sync::Mutex<Option<PathBuf>>,
    pub is_syncing: Arc<AtomicBool>,
    pub cancel: Arc<AtomicBool>,
    pub last_report: tokio::sync::Mutex<Option<AddeparSyncReportDto>>,
}

pub fn manage_state(app: &tauri::App) {
    app.manage(AddeparState {
        workspace: tokio::sync::Mutex::new(None),
        is_syncing: Arc::new(AtomicBool::new(false)),
        cancel: Arc::new(AtomicBool::new(false)),
        last_report: tokio::sync::Mutex::new(None),
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
pub struct AddeparConnectInfo {
    pub subdomain: String,
    pub firm_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AddeparSyncReportDto {
    pub entities_fetched: u32,
    pub households_processed: u32,
    pub records_indexed: u32,
    pub needs_assignment: u32,
    pub cancelled: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AddeparSyncStatusDto {
    pub is_syncing: bool,
    pub last_report: Option<AddeparSyncReportDto>,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AddeparDisconnectResult {
    pub token_deleted: bool,
    pub rag_purged: bool,
    pub data_remains: bool,
    pub warnings: Vec<String>,
}

fn store_config(config: &AddeparConfig) -> Result<(), String> {
    let json = serde_json::to_string(config).map_err(|e| e.to_string())?;
    keyring::Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_CONFIG_KEY)
        .map_err(|e| e.to_string())?
        .set_password(&json)
        .map_err(|e| e.to_string())
}

fn read_config() -> Option<AddeparConfig> {
    let json = keyring::Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_CONFIG_KEY)
        .ok()?
        .get_password()
        .ok()?;
    serde_json::from_str(&json).ok()
}

fn delete_config() -> Result<(), String> {
    match keyring::Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_CONFIG_KEY)
        .map_err(|e| e.to_string())?
        .delete_credential()
    {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub async fn addepar_set_workspace(
    state: State<'_, AddeparState>,
    path: String,
) -> Result<(), String> {
    *state.workspace.lock().await = Some(PathBuf::from(path));
    Ok(())
}

#[tauri::command]
pub async fn addepar_connect(
    api_key: String,
    api_secret: String,
    subdomain: String,
    firm_id: String,
    policy: State<'_, crate::network_policy::NetworkPolicy>,
) -> Result<AddeparConnectInfo, String> {
    let config = AddeparConfig {
        api_key: api_key.trim().to_string(),
        api_secret: api_secret.trim().to_string(),
        subdomain: subdomain.trim().to_string(),
        firm_id: firm_id.trim().to_string(),
    };
    if config.api_key.is_empty()
        || config.api_secret.is_empty()
        || config.subdomain.is_empty()
        || config.firm_id.is_empty()
    {
        return Err(
            "Addepar API key, API secret, firm subdomain, and firm id are required.".into(),
        );
    }

    AddeparClient::new(config.clone()).with_network_policy(policy.inner().clone(), crate::network_policy::ADDEPAR_SYNC)
        .validate()
        .await
        .map_err(|_| "Could not connect to Addepar. Check the key, secret, subdomain, firm id, and API permissions.".to_string())?;
    store_config(&config)?;
    Ok(AddeparConnectInfo {
        subdomain: config.subdomain,
        firm_id: config.firm_id,
    })
}

#[tauri::command]
pub async fn addepar_is_connected() -> Result<bool, String> {
    Ok(read_config().is_some())
}

#[tauri::command]
pub async fn addepar_list_entities(
    policy: State<'_, crate::network_policy::NetworkPolicy>,
) -> Result<Vec<AddeparEntityDto>, String> {
    let config = read_config().ok_or_else(|| "Addepar is not connected".to_string())?;
    let client = AddeparClient::new(config)
        .with_network_policy(policy.inner().clone(), crate::network_policy::ADDEPAR_SYNC);
    let entities = client.list_entities().await.map_err(|e| e.to_string())?;
    Ok(entities
        .into_iter()
        .map(|entity| {
            let name = entity.name();
            AddeparEntityDto {
                id: entity.id,
                name,
                model_type: entity.attributes.model_type,
            }
        })
        .collect())
}

#[tauri::command]
pub async fn addepar_sync(
    app: AppHandle,
    state: State<'_, AddeparState>,
    policy: State<'_, crate::network_policy::NetworkPolicy>,
    matter_map: Vec<AddeparMatterMapEntry>,
) -> Result<AddeparSyncReportDto, String> {
    if state
        .is_syncing
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return Err("an Addepar sync is already in progress".into());
    }
    let _guard = SyncGuard(state.is_syncing.clone());
    state.cancel.store(false, Ordering::SeqCst);

    let config = read_config().ok_or_else(|| "Addepar is not connected".to_string())?;
    let workspace = state
        .workspace
        .lock()
        .await
        .clone()
        .ok_or_else(|| "workspace not set - call addepar_set_workspace first".to_string())?;
    let rag_key =
        crate::commands::rag::crypto::get_or_create_master_key().map_err(|e| e.to_string())?;

    let _ = app.emit(
        ADDEPAR_SYNC_PROGRESS_EVENT,
        serde_json::json!({ "status": "syncing" }),
    );
    let client = AddeparClient::new(config)
        .with_network_policy(policy.inner().clone(), crate::network_policy::ADDEPAR_SYNC);
    let report = engine::sync_with_key(&client, &workspace, &matter_map, &state.cancel, &rag_key)
        .await
        .map_err(|e| {
            let _ = app.emit(
                ADDEPAR_SYNC_PROGRESS_EVENT,
                serde_json::json!({ "status": "error" }),
            );
            e.to_string()
        })?;

    let dto = AddeparSyncReportDto {
        entities_fetched: report.entities_fetched,
        households_processed: report.households_processed,
        records_indexed: report.records_indexed,
        needs_assignment: report.needs_assignment.len() as u32,
        cancelled: report.cancelled,
    };
    *state.last_report.lock().await = Some(dto.clone());
    let _ = app.emit(
        ADDEPAR_SYNC_PROGRESS_EVENT,
        serde_json::json!({
            "status": if dto.cancelled { "cancelled" } else { "done" },
            "households": dto.households_processed,
            "records": dto.records_indexed,
            "needsAssignment": dto.needs_assignment,
        }),
    );
    Ok(dto)
}

#[tauri::command]
pub async fn addepar_cancel(state: State<'_, AddeparState>) -> Result<(), String> {
    state.cancel.store(true, Ordering::SeqCst);
    Ok(())
}

#[tauri::command]
pub async fn addepar_status(
    state: State<'_, AddeparState>,
) -> Result<AddeparSyncStatusDto, String> {
    Ok(AddeparSyncStatusDto {
        is_syncing: state.is_syncing.load(Ordering::SeqCst),
        last_report: state.last_report.lock().await.clone(),
    })
}

#[tauri::command]
pub async fn addepar_disconnect(
    state: State<'_, AddeparState>,
) -> Result<AddeparDisconnectResult, String> {
    let mut result = AddeparDisconnectResult::default();
    state.cancel.store(true, Ordering::SeqCst);
    if state
        .is_syncing
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        result.data_remains = true;
        result
            .warnings
            .push("An Addepar sync is still running. Stop it and try disconnecting again.".into());
        return Ok(result);
    }
    let _guard = SyncGuard(state.is_syncing.clone());

    let workspace = state.workspace.lock().await.clone();
    if let Some(ws) = workspace {
        match purge_addepar_rag_chunks(&ws).await {
            Ok(()) => result.rag_purged = true,
            Err(e) => result
                .warnings
                .push(format!("Search-index purge failed: {e}")),
        }
    } else {
        result
            .warnings
            .push("No workspace is open, so imported Addepar data could not be deleted.".into());
    }

    if result.rag_purged {
        match delete_config() {
            Ok(()) => result.token_deleted = true,
            Err(e) => result
                .warnings
                .push(format!("Addepar credential delete failed: {e}")),
        }
    } else {
        result.data_remains = true;
    }

    Ok(result)
}

async fn purge_addepar_rag_chunks(workspace: &std::path::Path) -> anyhow::Result<()> {
    let conn = crate::commands::rag::store::open_connection(workspace).await?;
    let table = crate::commands::rag::store::open_or_create_table(&conn).await?;
    crate::commands::rag::store::delete_source_type(&table, "addepar").await
}
