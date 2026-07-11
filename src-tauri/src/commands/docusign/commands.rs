//! Tauri commands for the read-only DocuSign connector.

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::commands::docusign::client::DocusignClient;
use crate::commands::docusign::engine;
use crate::commands::docusign::model::{
    DocusignConnection, DocusignEnvironment, EsignMatterMapEntry,
};
use crate::commands::docusign::oauth;
use crate::commands::docusign::store::{DocusignStore, DocusignUnassignedRow};

pub const DOCUSIGN_SYNC_PROGRESS_EVENT: &str = "docusign-sync-progress";

pub struct DocusignState {
    pub workspace: tokio::sync::Mutex<Option<PathBuf>>,
    pub is_syncing: Arc<AtomicBool>,
    pub cancel: Arc<AtomicBool>,
    pub last_report: tokio::sync::Mutex<Option<DocusignSyncReportDto>>,
}

pub fn manage_state(app: &tauri::App) {
    app.manage(DocusignState {
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
pub struct DocusignConnectInfo {
    pub account_id: String,
    pub account_name: String,
    pub base_uri: String,
    pub environment: String,
}

#[derive(Debug, Clone, Serialize, serde::Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DocusignSyncReportDto {
    pub envelopes_fetched: u32,
    pub envelopes_changed: u32,
    pub envelopes_skipped_unchanged: u32,
    pub audit_events: u32,
    pub records_indexed: u32,
    pub needs_assignment: u32,
    pub cancelled: bool,
    pub pdf_body_extraction: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocusignSyncStatusDto {
    pub is_syncing: bool,
    pub last_report: Option<DocusignSyncReportDto>,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DocusignDisconnectResult {
    pub token_deleted: bool,
    pub rag_purged: bool,
    pub db_purged: bool,
    pub data_remains: bool,
    pub warnings: Vec<String>,
}

#[tauri::command]
pub async fn docusign_set_workspace(
    state: State<'_, DocusignState>,
    path: String,
) -> Result<(), String> {
    *state.workspace.lock().await = Some(PathBuf::from(path));
    Ok(())
}

#[tauri::command]
pub async fn docusign_connect(
    policy: State<'_, crate::network_policy::NetworkPolicy>,
) -> Result<DocusignConnectInfo, String> {
    use crate::commands::mail::gmail::oauth::{
        await_redirect_code, bind_loopback, gen_pkce, gen_state, open_browser,
    };

    let environment = DocusignEnvironment::Demo;
    let oauth_client = oauth::DocusignOAuth::new(oauth::client_id(), environment)
        .with_network_policy(policy.inner().clone());
    let (verifier, challenge) = gen_pkce();
    let state = gen_state();
    let (listener, redirect_uri) = bind_loopback().await.map_err(|e| e.to_string())?;
    let url = oauth_client.build_auth_url(&redirect_uri, &challenge, &state);
    crate::commands::connector_network::authorize_url(
        policy.inner(),
        &crate::network_policy::DOCUSIGN_OAUTH,
        &url,
    )
    .map_err(|e| e.to_string())?;
    open_browser(&url);
    let code = await_redirect_code(listener, &state, std::time::Duration::from_secs(300))
        .await
        .map_err(|e| e.to_string())?;
    let tokens = oauth_client
        .exchange_code(&code, &verifier, &redirect_uri)
        .await
        .map_err(|e| e.to_string())?;
    let account = oauth_client
        .userinfo(&tokens.access)
        .await
        .map_err(|e| e.to_string())?;
    let connection = DocusignConnection {
        refresh_token: tokens.refresh,
        account_id: account.account_id.clone(),
        base_uri: account.base_uri.clone(),
        account_name: account.account_name.clone(),
        environment: "demo".into(),
    };
    oauth::store_connection(&connection).map_err(|e| e.to_string())?;
    Ok(DocusignConnectInfo {
        account_id: account.account_id,
        account_name: account.account_name,
        base_uri: account.base_uri,
        environment: "demo".into(),
    })
}

#[tauri::command]
pub async fn docusign_is_connected() -> Result<bool, String> {
    oauth::read_connection()
        .map(|c| c.is_some())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn docusign_disconnect(
    state: State<'_, DocusignState>,
) -> Result<DocusignDisconnectResult, String> {
    let mut result = DocusignDisconnectResult::default();
    state.cancel.store(true, Ordering::SeqCst);
    if state
        .is_syncing
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        result.data_remains = true;
        result
            .warnings
            .push("A DocuSign sync is still running. Stop it and try disconnecting again.".into());
        return Ok(result);
    }
    let _guard = SyncGuard(state.is_syncing.clone());

    let workspace = state.workspace.lock().await.clone();
    if let Some(ws) = workspace {
        match purge_esign_rag_chunks(&ws).await {
            Ok(()) => result.rag_purged = true,
            Err(e) => result
                .warnings
                .push(format!("Search-index purge failed: {e}")),
        }
        match DocusignStore::purge(&ws) {
            Ok(()) => result.db_purged = true,
            Err(e) => result
                .warnings
                .push(format!("DocuSign local database purge failed: {e}")),
        }
    } else {
        result
            .warnings
            .push("No workspace is open, so imported DocuSign data could not be deleted.".into());
    }

    if result.rag_purged && result.db_purged {
        match oauth::delete_connection() {
            Ok(()) => result.token_deleted = true,
            Err(e) => result
                .warnings
                .push(format!("DocuSign token delete failed: {e}")),
        }
        if let Err(e) = DocusignStore::delete_master_key() {
            result
                .warnings
                .push(format!("DocuSign database key delete failed: {e}"));
        }
    } else {
        result.data_remains = true;
    }

    Ok(result)
}

async fn purge_esign_rag_chunks(workspace: &std::path::Path) -> anyhow::Result<()> {
    let conn = crate::commands::rag::store::open_connection(workspace).await?;
    let table = crate::commands::rag::store::open_or_create_table(&conn).await?;
    crate::commands::rag::store::delete_source_type(&table, "esign").await
}

#[tauri::command]
pub async fn docusign_sync(
    app: AppHandle,
    state: State<'_, DocusignState>,
    policy: State<'_, crate::network_policy::NetworkPolicy>,
    matter_map: Vec<EsignMatterMapEntry>,
    from_date: Option<String>,
    to_date: Option<String>,
) -> Result<DocusignSyncReportDto, String> {
    if state
        .is_syncing
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return Err("a DocuSign sync is already in progress".into());
    }
    let _guard = SyncGuard(state.is_syncing.clone());
    state.cancel.store(false, Ordering::SeqCst);

    let connection = oauth::read_connection()
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "DocuSign is not connected".to_string())?;
    let workspace = state
        .workspace
        .lock()
        .await
        .clone()
        .ok_or_else(|| "workspace not set - call docusign_set_workspace first".to_string())?;
    let _ = app.emit(
        DOCUSIGN_SYNC_PROGRESS_EVENT,
        serde_json::json!({ "status": "syncing" }),
    );

    let (access, updated_connection) =
        oauth::fresh_access_token_with_policy(&connection, policy.inner().clone())
            .await
            .map_err(|e| {
                let _ = app.emit(
                    DOCUSIGN_SYNC_PROGRESS_EVENT,
                    serde_json::json!({ "status": "error" }),
                );
                e.to_string()
            })?;
    let client = DocusignClient::new(
        access,
        updated_connection.account_id.clone(),
        updated_connection.api_base(),
    )
    .with_network_policy(policy.inner().clone(), crate::network_policy::DOCUSIGN_SYNC);
    let store = DocusignStore::open(&workspace).map_err(|e| e.to_string())?;
    let rag_key =
        crate::commands::rag::crypto::get_or_create_master_key().map_err(|e| e.to_string())?;

    let from = from_date.unwrap_or_else(|| "2020-01-01T00:00:00Z".to_string());
    let report = engine::sync_window_with_key(
        &client,
        &store,
        &workspace,
        client.account_id(),
        &from,
        to_date.as_deref(),
        &matter_map,
        &state.cancel,
        &rag_key,
    )
    .await
    .map_err(|e| {
        let _ = app.emit(
            DOCUSIGN_SYNC_PROGRESS_EVENT,
            serde_json::json!({ "status": "error" }),
        );
        e.to_string()
    })?;

    let dto = DocusignSyncReportDto {
        envelopes_fetched: report.ingest.envelopes_fetched,
        envelopes_changed: report.ingest.envelopes_changed,
        envelopes_skipped_unchanged: report.ingest.envelopes_skipped_unchanged,
        audit_events: report.ingest.audit_events,
        records_indexed: report.records_indexed,
        needs_assignment: report.ingest.needs_assignment.len() as u32,
        cancelled: report.cancelled,
        pdf_body_extraction:
            "fast-follow: Rust-side PDF body extraction is not wired; metadata and audit trail are indexed"
                .into(),
    };
    *state.last_report.lock().await = Some(dto.clone());
    let _ = app.emit(
        DOCUSIGN_SYNC_PROGRESS_EVENT,
        serde_json::json!({
            "status": if dto.cancelled { "cancelled" } else { "done" },
            "records": dto.records_indexed,
            "needsAssignment": dto.needs_assignment,
        }),
    );
    Ok(dto)
}

#[tauri::command]
pub async fn docusign_cancel_sync(state: State<'_, DocusignState>) -> Result<(), String> {
    state.cancel.store(true, Ordering::SeqCst);
    Ok(())
}

#[tauri::command]
pub async fn docusign_sync_status(
    state: State<'_, DocusignState>,
) -> Result<DocusignSyncStatusDto, String> {
    Ok(DocusignSyncStatusDto {
        is_syncing: state.is_syncing.load(Ordering::SeqCst),
        last_report: state.last_report.lock().await.clone(),
    })
}

#[tauri::command]
pub async fn docusign_list_unassigned(
    state: State<'_, DocusignState>,
) -> Result<Vec<DocusignUnassignedRow>, String> {
    let workspace = state
        .workspace
        .lock()
        .await
        .clone()
        .ok_or_else(|| "workspace not set - call docusign_set_workspace first".to_string())?;
    let store = DocusignStore::open(&workspace).map_err(|e| e.to_string())?;
    store.list_unassigned().map_err(|e| e.to_string())
}
