//! Tauri commands for the read-only Jotform connector.

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::commands::jotform::client::JotformClient;
use crate::commands::jotform::engine;
use crate::commands::jotform::model::{JotformForm, JotformMatterMapEntry};
use crate::commands::jotform::store::{JotformStore, JotformUnassignedRow};

const KEYCHAIN_SERVICE: &str = crate::identity::JOTFORM_SERVICE;
const KEYCHAIN_API_KEY: &str = "api-key";

pub const JOTFORM_SYNC_PROGRESS_EVENT: &str = "jotform-sync-progress";

pub struct JotformState {
    pub workspace: tokio::sync::Mutex<Option<PathBuf>>,
    pub is_syncing: Arc<AtomicBool>,
    pub cancel: Arc<AtomicBool>,
    pub last_report: tokio::sync::Mutex<Option<JotformSyncReportDto>>,
    pub progress_submissions: Arc<AtomicU32>,
}

pub fn manage_state(app: &tauri::App) {
    app.manage(JotformState {
        workspace: tokio::sync::Mutex::new(None),
        is_syncing: Arc::new(AtomicBool::new(false)),
        cancel: Arc::new(AtomicBool::new(false)),
        last_report: tokio::sync::Mutex::new(None),
        progress_submissions: Arc::new(AtomicU32::new(0)),
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
pub struct JotformConnectInfo {
    pub username: String,
    pub name: String,
    pub email: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JotformFormDto {
    pub form_id: String,
    pub title: String,
    pub status: String,
    pub updated_at: String,
}

impl From<JotformForm> for JotformFormDto {
    fn from(form: JotformForm) -> Self {
        Self {
            form_id: form.form_id,
            title: form.title,
            status: form.status,
            updated_at: form.updated_at,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct JotformSyncReportDto {
    pub forms_fetched: u32,
    pub submissions_fetched: u32,
    pub submissions_changed: u32,
    pub submissions_skipped_unchanged: u32,
    pub submissions_indexed: u32,
    pub records_indexed: u32,
    pub needs_assignment: u32,
    pub cancelled: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JotformSyncStatusDto {
    pub is_syncing: bool,
    pub last_report: Option<JotformSyncReportDto>,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct JotformDisconnectResult {
    pub token_deleted: bool,
    pub rag_purged: bool,
    pub jotform_db_purged: bool,
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
pub async fn jotform_set_workspace(
    state: State<'_, JotformState>,
    path: String,
) -> Result<(), String> {
    *state.workspace.lock().await = Some(PathBuf::from(path));
    Ok(())
}

#[tauri::command]
pub async fn jotform_connect(
    api_key: String,
    policy: State<'_, crate::network_policy::NetworkPolicy>,
) -> Result<JotformConnectInfo, String> {
    let trimmed = api_key.trim().to_string();
    if trimmed.is_empty() {
        return Err("Paste your Jotform API key first.".into());
    }
    let user =
        JotformClient::current_user_with_key_and_policy(trimmed.clone(), policy.inner().clone())
            .await
            .map_err(|_| {
                "Could not connect to Jotform: check the API key and try again.".to_string()
            })?;
    store_secret(KEYCHAIN_API_KEY, &trimmed)?;
    Ok(JotformConnectInfo {
        username: user.username,
        name: user.name,
        email: user.email,
    })
}

#[tauri::command]
pub async fn jotform_is_connected() -> Result<bool, String> {
    Ok(read_secret(KEYCHAIN_API_KEY).is_some())
}

#[tauri::command]
pub async fn jotform_list_forms(
    policy: State<'_, crate::network_policy::NetworkPolicy>,
) -> Result<Vec<JotformFormDto>, String> {
    let api_key = read_secret(KEYCHAIN_API_KEY).ok_or("Jotform is not connected")?;
    let client = JotformClient::new(api_key)
        .with_network_policy(policy.inner().clone(), crate::network_policy::JOTFORM_SYNC);
    let forms = client.list_forms().await.map_err(|e| e.to_string())?;
    Ok(forms.into_iter().map(Into::into).collect())
}

#[tauri::command]
pub async fn jotform_sync(
    app: AppHandle,
    state: State<'_, JotformState>,
    policy: State<'_, crate::network_policy::NetworkPolicy>,
    matter_map: Vec<JotformMatterMapEntry>,
) -> Result<JotformSyncReportDto, String> {
    if state
        .is_syncing
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return Err("a Jotform sync is already in progress".into());
    }
    let _guard = SyncGuard(state.is_syncing.clone());
    state.cancel.store(false, Ordering::SeqCst);
    state.progress_submissions.store(0, Ordering::SeqCst);

    let api_key = read_secret(KEYCHAIN_API_KEY).ok_or("Jotform is not connected")?;
    let workspace = state
        .workspace
        .lock()
        .await
        .clone()
        .ok_or("workspace not set - call jotform_set_workspace first")?;

    let _ = app.emit(
        JOTFORM_SYNC_PROGRESS_EVENT,
        serde_json::json!({ "status": "syncing" }),
    );

    let store = JotformStore::open(&workspace).map_err(|e| {
        let _ = app.emit(
            JOTFORM_SYNC_PROGRESS_EVENT,
            serde_json::json!({ "status": "error" }),
        );
        e.to_string()
    })?;
    let rag_key = crate::commands::rag::crypto::get_or_create_master_key().map_err(|e| {
        let _ = app.emit(
            JOTFORM_SYNC_PROGRESS_EVENT,
            serde_json::json!({ "status": "error" }),
        );
        e.to_string()
    })?;

    let emit_counter = state.progress_submissions.clone();
    let emit_app = app.clone();
    let emitter = tokio::spawn(async move {
        let mut last = u32::MAX;
        loop {
            tokio::time::sleep(std::time::Duration::from_millis(250)).await;
            let done = emit_counter.load(Ordering::SeqCst);
            if done != last {
                last = done;
                let _ = emit_app.emit(
                    JOTFORM_SYNC_PROGRESS_EVENT,
                    serde_json::json!({ "status": "syncing", "submissions": done }),
                );
            }
        }
    });

    let client = JotformClient::new(api_key)
        .with_network_policy(policy.inner().clone(), crate::network_policy::JOTFORM_SYNC);
    let result = engine::backfill(
        &client,
        &store,
        &workspace,
        &matter_map,
        &state.cancel,
        &rag_key,
        &state.progress_submissions,
    )
    .await;
    emitter.abort();

    let report = match result {
        Ok(report) => report,
        Err(e) => {
            let _ = app.emit(
                JOTFORM_SYNC_PROGRESS_EVENT,
                serde_json::json!({ "status": "error" }),
            );
            return Err(e.to_string());
        }
    };

    let dto = JotformSyncReportDto {
        forms_fetched: report.ingest.forms_fetched,
        submissions_fetched: report.ingest.submissions_fetched,
        submissions_changed: report.ingest.submissions_changed,
        submissions_skipped_unchanged: report.ingest.submissions_skipped_unchanged,
        submissions_indexed: report.submissions_indexed,
        records_indexed: report.records_indexed,
        needs_assignment: report.ingest.needs_assignment.len() as u32,
        cancelled: report.cancelled,
    };
    let _ = app.emit(
        JOTFORM_SYNC_PROGRESS_EVENT,
        serde_json::json!({
            "status": if dto.cancelled { "cancelled" } else { "done" },
            "submissions": dto.submissions_indexed,
            "records": dto.records_indexed,
            "needsAssignment": dto.needs_assignment,
        }),
    );
    *state.last_report.lock().await = Some(dto.clone());
    Ok(dto)
}

#[tauri::command]
pub async fn jotform_cancel(state: State<'_, JotformState>) -> Result<(), String> {
    state.cancel.store(true, Ordering::SeqCst);
    Ok(())
}

#[tauri::command]
pub async fn jotform_status(
    state: State<'_, JotformState>,
) -> Result<JotformSyncStatusDto, String> {
    let is_syncing = state.is_syncing.load(Ordering::SeqCst);
    if is_syncing {
        return Ok(JotformSyncStatusDto {
            is_syncing,
            last_report: Some(JotformSyncReportDto {
                submissions_indexed: state.progress_submissions.load(Ordering::SeqCst),
                ..Default::default()
            }),
        });
    }
    Ok(JotformSyncStatusDto {
        is_syncing,
        last_report: state.last_report.lock().await.clone(),
    })
}

#[tauri::command]
pub async fn jotform_disconnect(
    state: State<'_, JotformState>,
) -> Result<JotformDisconnectResult, String> {
    let mut result = JotformDisconnectResult::default();
    state.cancel.store(true, Ordering::SeqCst);
    if state
        .is_syncing
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        result.data_remains = true;
        result
            .warnings
            .push("A Jotform sync is still running; stop it and try disconnecting again.".into());
        return Ok(result);
    }
    let _guard = SyncGuard(state.is_syncing.clone());

    let Some(workspace) = state.workspace.lock().await.clone() else {
        result.data_remains = true;
        result
            .warnings
            .push("No workspace is open, so imported Jotform data could not be deleted.".into());
        return Ok(result);
    };

    match purge_jotform_rag_chunks(&workspace).await {
        Ok(()) => result.rag_purged = true,
        Err(e) => result
            .warnings
            .push(format!("Search-index purge failed: {e}")),
    }
    match JotformStore::purge(&workspace) {
        Ok(()) => result.jotform_db_purged = true,
        Err(e) => result
            .warnings
            .push(format!("Jotform local database purge failed: {e}")),
    }

    if result.rag_purged && result.jotform_db_purged {
        result.token_deleted = delete_secret(KEYCHAIN_API_KEY).is_ok();
        if let Err(e) = JotformStore::delete_master_key() {
            result
                .warnings
                .push(format!("Jotform database key removal failed: {e}"));
        }
    } else {
        result.data_remains = true;
        result
            .warnings
            .push("Some imported Jotform data could not be deleted; the API key was kept.".into());
    }

    Ok(result)
}

#[tauri::command]
pub async fn jotform_list_unassigned(
    state: State<'_, JotformState>,
) -> Result<Vec<JotformUnassignedRow>, String> {
    let workspace = state
        .workspace
        .lock()
        .await
        .clone()
        .ok_or("workspace not set - call jotform_set_workspace first")?;
    let store = JotformStore::open(&workspace).map_err(|e| e.to_string())?;
    store.list_unassigned().map_err(|e| e.to_string())
}

async fn purge_jotform_rag_chunks(workspace: &std::path::Path) -> anyhow::Result<()> {
    let store = JotformStore::open(workspace)?;
    let source_ids = store.list_source_ids()?;
    let key = crate::commands::rag::crypto::get_or_create_master_key()?;
    let conn = crate::commands::rag::store::open_connection(workspace).await?;
    let table = crate::commands::rag::store::open_or_create_table(&conn).await?;
    for source_id in source_ids {
        crate::commands::rag::store::delete_path(&table, &source_id, &key).await?;
    }
    Ok(())
}
