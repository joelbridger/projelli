//! Narrow Tauri boundary for the CRM SQLCipher core. The renderer receives no
//! database handle and cannot split a propagation commit into separate writes.

use serde::Deserialize;
use tauri::State;

use super::{commands::CrmState, core_store::CrmCoreStore};

async fn workspace(state: &CrmState) -> Result<std::path::PathBuf, String> {
    state.workspace.lock().await.clone().ok_or_else(|| "Open a workspace before using CRM data.".to_string())
}

#[tauri::command]
pub async fn crm_core_cursor(state: State<'_, CrmState>, stream_key: String) -> Result<i64, String> {
    let workspace = workspace(&state).await?;
    tokio::task::spawn_blocking(move || CrmCoreStore::open(&workspace)?.cursor(&stream_key).map(|value| value.map(|(cursor, _)| cursor).unwrap_or(0)))
        .await.map_err(|error| error.to_string())?.map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn crm_core_record_applied(state: State<'_, CrmState>, stream_key: String, cursor: i64, blob_id: String) -> Result<(), String> {
    let workspace = workspace(&state).await?;
    tokio::task::spawn_blocking(move || CrmCoreStore::open(&workspace)?.record_applied_cursor(&stream_key, cursor, &blob_id))
        .await.map_err(|error| error.to_string())?.map_err(|error| error.to_string())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PropagationCommitDto {
    kind: String,
    instance: serde_json::Value,
    event: PropagationEventDto,
    immutable_operations: Vec<String>,
    activity_outbox: OutboxDto,
    notification_outbox: OutboxDto,
    /// The encrypted envelope is created by B4; only its opaque routing ids
    /// cross this bridge. An empty list is valid for an offer with no recipients.
    notification_rows: Vec<NotificationRowDto>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PropagationEventDto { event_id: String }
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OutboxDto { idempotency_key: String }
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NotificationRowDto { org_id: String, envelope_id: String }

#[tauri::command]
pub async fn crm_core_commit_propagation(state: State<'_, CrmState>, payload: PropagationCommitDto) -> Result<(), String> {
    let workspace = workspace(&state).await?;
    tokio::task::spawn_blocking(move || {
        if payload.notification_outbox.idempotency_key.trim().is_empty() {
            return Err(anyhow::anyhow!("CRM notification outbox requires an idempotency key"));
        }
        let rows = payload.notification_rows.into_iter().map(|row| (row.org_id, row.envelope_id)).collect::<Vec<_>>();
        CrmCoreStore::open(&workspace)?.commit_propagation_transaction(
            &payload.kind, &payload.event.event_id, &serde_json::to_string(&payload.instance)?,
            &payload.immutable_operations, &payload.activity_outbox.idempotency_key, &rows,
        )
    }).await.map_err(|error| error.to_string())?.map_err(|error| error.to_string())
}
