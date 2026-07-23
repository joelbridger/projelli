//! Narrow Tauri boundary for the CRM SQLCipher core. The renderer receives no
//! database handle and cannot split a propagation commit into separate writes.

use serde::Deserialize;
use serde_json::Value;
use tauri::State;

use super::{
    commands::CrmState, core_store::CrmCoreStore, record_descriptors::valid_record_identifier,
};

async fn workspace(state: &CrmState) -> Result<std::path::PathBuf, String> {
    state
        .workspace
        .lock()
        .await
        .clone()
        .ok_or_else(|| "Open a workspace before using CRM data.".to_string())
}

#[tauri::command]
pub async fn crm_core_cursor(
    state: State<'_, CrmState>,
    stream_key: String,
) -> Result<i64, String> {
    let workspace = workspace(&state).await?;
    tokio::task::spawn_blocking(move || {
        CrmCoreStore::open_read_only(&workspace)?
            .cursor(&stream_key)
            .map(|value| value.map(|(cursor, _)| cursor).unwrap_or(0))
    })
    .await
    .map_err(|error| error.to_string())?
    .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn crm_core_record_applied(
    state: State<'_, CrmState>,
    stream_key: String,
    cursor: i64,
    blob_id: String,
) -> Result<(), String> {
    let workspace = workspace(&state).await?;
    tokio::task::spawn_blocking(move || {
        CrmCoreStore::open(&workspace)?.record_applied_cursor(&stream_key, cursor, &blob_id)
    })
    .await
    .map_err(|error| error.to_string())?
    .map_err(|error| error.to_string())
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
pub struct PropagationEventDto {
    event_id: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OutboxDto {
    idempotency_key: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NotificationRowDto {
    org_id: String,
    envelope_id: String,
}

#[tauri::command]
pub async fn crm_core_commit_propagation(
    state: State<'_, CrmState>,
    payload: PropagationCommitDto,
) -> Result<(), String> {
    let workspace = workspace(&state).await?;
    tokio::task::spawn_blocking(move || {
        if payload
            .notification_outbox
            .idempotency_key
            .trim()
            .is_empty()
        {
            return Err(anyhow::anyhow!(
                "CRM notification outbox requires an idempotency key"
            ));
        }
        let rows = payload
            .notification_rows
            .into_iter()
            .map(|row| (row.org_id, row.envelope_id))
            .collect::<Vec<_>>();
        CrmCoreStore::open(&workspace)?.commit_propagation_transaction(
            &payload.kind,
            &payload.event.event_id,
            &serde_json::to_string(&payload.instance)?,
            &payload.immutable_operations,
            &payload.activity_outbox.idempotency_key,
            &rows,
        )
    })
    .await
    .map_err(|error| error.to_string())?
    .map_err(|error| error.to_string())
}

fn normalize_live_record(mut record: Value) -> Result<Value, String> {
    let object = record
        .as_object_mut()
        .ok_or("CRM live record must be an object")?;
    let id = object
        .get("id")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .ok_or("CRM live record requires id")?;
    let kind = object
        .get("kind")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .ok_or("CRM live record requires kind")?;
    if !valid_record_identifier(kind, false) {
        return Err("CRM live record kind is invalid".to_string());
    }
    if !valid_record_identifier(id, true) {
        return Err("CRM live record id is invalid".to_string());
    }
    let now = chrono::Utc::now().to_rfc3339();
    object
        .entry("matterId".to_string())
        .or_insert_with(|| Value::String("firm".to_string()));
    object
        .entry("createdAt".to_string())
        .or_insert_with(|| Value::String(now.clone()));
    object.insert("updatedAt".to_string(), Value::String(now));
    Ok(record)
}

/// Save one durable CRM collection document.  The renderer supplies a typed
/// record payload, but SQLCipher remains the only persistence boundary.
#[tauri::command]
pub async fn crm_live_upsert(state: State<'_, CrmState>, record: Value) -> Result<Value, String> {
    let workspace = workspace(&state).await?;
    let record = normalize_live_record(record)?;
    let saved = record.clone();
    tokio::task::spawn_blocking(move || CrmCoreStore::open(&workspace)?.upsert_live_record(&saved))
        .await
        .map_err(|error| error.to_string())?
        .map_err(|error| error.to_string())?;
    Ok(record)
}

/// Seed several durable collection documents through one real SQLCipher-store
/// opening. This keeps shared test fixtures fast without bypassing the same
/// validation and persistence path used by individual app writes.
#[tauri::command]
pub async fn crm_live_upsert_many(
    state: State<'_, CrmState>,
    records: Vec<Value>,
) -> Result<Vec<Value>, String> {
    let workspace = workspace(&state).await?;
    let records = records
        .into_iter()
        .map(normalize_live_record)
        .collect::<Result<Vec<_>, _>>()?;
    let saved = records.clone();
    tokio::task::spawn_blocking(move || {
        let store = CrmCoreStore::open(&workspace)?;
        for record in saved {
            store.upsert_live_record(&record)?;
        }
        Ok::<(), anyhow::Error>(())
    })
    .await
    .map_err(|error| error.to_string())?
    .map_err(|error| error.to_string())?;
    Ok(records)
}

/// Return the encrypted collection documents required to render the CRM
/// screens.  Browser/test mode deliberately has no hidden persistence path.
#[tauri::command]
pub async fn crm_live_list(state: State<'_, CrmState>) -> Result<Vec<Value>, String> {
    let workspace = workspace(&state).await?;
    tokio::task::spawn_blocking(move || {
        CrmCoreStore::open_read_only(&workspace)?.list_live_records()
    })
    .await
    .map_err(|error| error.to_string())?
    .map_err(|error| error.to_string())
}
