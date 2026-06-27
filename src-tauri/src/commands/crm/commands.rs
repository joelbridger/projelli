//! Tauri commands for the Wealthbox CRM connector.
//!
//! Mirrors the mail connector's command/state/keychain patterns exactly.
//! Every `#[tauri::command]` returns `Result<T, String>`; anyhow errors are
//! converted at the IPC boundary.  Token values and raw API response bodies
//! are **never** logged or returned to the frontend.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::commands::audit::AuditState;
use crate::commands::crm::engine;
use crate::commands::crm::provider::{
    client_for, delete_token, read_token, store_token, validate_token, CrmProvider,
};
use crate::commands::crm::redtail::RedtailClient;
use crate::commands::crm::salesforce::{
    build_salesforce_auth_url, exchange_salesforce_code, salesforce_client_id, SalesforceClient,
    SALESFORCE_TOKEN_ENDPOINT,
};
use crate::commands::crm::store::CrmStore;

// ---------------------------------------------------------------------------
// CrmState + manage_state + RAII guard
// ---------------------------------------------------------------------------

pub struct CrmState {
    pub workspace: tokio::sync::Mutex<Option<PathBuf>>,
    pub is_syncing: Arc<AtomicBool>,
    pub cancel: Arc<AtomicBool>,
    pub last_report: tokio::sync::Mutex<Option<CrmSyncReportDto>>,
    /// Live count of households processed so far in the CURRENT sync. The engine
    /// stores the running total per matter; `crm_sync_status` reads it so a watching
    /// user sees steady movement instead of a stale number that jumps at the end.
    pub progress_households: Arc<std::sync::atomic::AtomicU32>,
}

pub fn manage_state(app: &tauri::App) {
    app.manage(CrmState {
        workspace: tokio::sync::Mutex::new(None),
        is_syncing: Arc::new(AtomicBool::new(false)),
        cancel: Arc::new(AtomicBool::new(false)),
        last_report: tokio::sync::Mutex::new(None),
        progress_households: Arc::new(std::sync::atomic::AtomicU32::new(0)),
    });
}

/// RAII guard: sets `is_syncing` to false when dropped, covering all exit paths
/// (normal return, early return, and panic).
struct SyncGuard(Arc<AtomicBool>);
impl Drop for SyncGuard {
    fn drop(&mut self) {
        self.0.store(false, Ordering::SeqCst);
    }
}

// ---------------------------------------------------------------------------
// Data-transfer objects
// ---------------------------------------------------------------------------

/// Returned by `crm_connect` after the token is validated via `GET /me`.
/// Fields are parsed tolerantly (`get().and_then()`) — absent fields default to "".
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CrmConnectInfo {
    /// Display name of the workspace or account (e.g. the RIA's name).
    pub name: String,
    /// Wealthbox subscription plan (e.g. "trial", "professional").
    pub plan: String,
    /// Email address associated with the account.
    pub email: String,
}

/// One entry in the household → matter mapping supplied by the frontend.
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CrmMatterMapEntry {
    pub household_id: String,
    pub matter_id: String,
}

/// Sync summary DTO returned by `crm_sync_all` and stored as the last report.
#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct CrmSyncReportDto {
    pub households_processed: u32,
    pub records_indexed: u32,
    /// Contacts ingested from Wealthbox.
    pub ingest_contacts: u32,
    /// Notes ingested from Wealthbox.
    pub ingest_notes: u32,
    /// Tasks ingested from Wealthbox.
    pub ingest_tasks: u32,
    /// Events ingested from Wealthbox.
    pub ingest_events: u32,
    /// Objects skipped because their `linked_to` list had no resolvable household.
    pub ingest_skipped_unlinked: u32,
}

/// Returned by `crm_sync_status`.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CrmSyncStatusDto {
    pub is_syncing: bool,
    pub last_report: Option<CrmSyncReportDto>,
}

/// Returned by `crm_disconnect` — reports exactly what was purged so the UI
/// can show an accurate post-disconnect status instead of always claiming
/// "deleted imported data" regardless of what actually happened.
#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CrmDisconnectResult {
    /// `true` when the Wealthbox API key was removed from the OS keychain.
    pub token_deleted: bool,
    /// `true` when `source_type='crm'` RAG chunks were purged from the
    /// LanceDB vector store.
    pub rag_purged: bool,
    /// `true` when the encrypted CRM object database file was deleted.
    pub crm_db_purged: bool,
    /// `true` when imported CRM data may STILL be on disk after this disconnect —
    /// because the purge could not run (no workspace, or a sync was still running) or
    /// a purge step failed. The API token + connected state are KEPT in that case, so
    /// the UI can offer a "finish deleting" retry instead of stranding the data.
    pub data_remains: bool,
    /// Non-empty when any purge step was skipped or failed (best-effort).
    /// Each entry is a plain-English sentence suitable for a UI warning banner.
    pub warnings: Vec<String>,
}

/// One household entry returned by `crm_list_households`.
///
/// Slim view suitable for the Client Map / matter-creation UI.
/// The `id` is the Wealthbox contact id as a string (JSON-safe, no
/// i64 precision issues on the JS side).  The `name` is the trimmed
/// `company_name`, or `"Household {id}"` if that field is blank.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CrmHouseholdDto {
    pub id: String,
    pub name: String,
}

// ---------------------------------------------------------------------------
// Event name
// ---------------------------------------------------------------------------

const CRM_SYNC_PROGRESS_EVENT: &str = "crm-sync-progress";

/// Emitted after a durable audit entry is written by the CRM backend so the
/// frontend can push it into the live Activity-Log React state without waiting
/// for the next workspace re-open.  Payload: `AuditEntryRecord` (camelCase JSON).
const CRM_AUDIT_APPENDED_EVENT: &str = "crm-audit-appended";

// ---------------------------------------------------------------------------
// Durable audit helper
// ---------------------------------------------------------------------------

/// Append one CRM audit entry to the encrypted audit store and notify the
/// frontend so it appears in the live Activity-Log view immediately.
///
/// # Workspace resolution
/// Prefers the `AuditState` workspace (the same path that `audit_list` and
/// `audit_append` use) so the entry is visible as soon as it is written.
/// Falls back to the `CrmState` workspace when `AuditState` has not been set
/// yet (should not happen in normal use — both are set together at workspace
/// open — but is handled defensively).
///
/// # Best-effort contract
/// Any failure (keychain unavailable, I/O error, spawn panic) is logged as a
/// `warn!` and **never** propagates to the calling command.  The id is
/// `audit_crm_<nanos>_<4-byte-hex>` (unique per call within the nanosecond
/// range of the system clock) and the timestamp is RFC 3339.
///
/// # Live Activity-Log update
/// After a successful DB write the `crm-audit-appended` Tauri event is emitted
/// with the `AuditEntryRecord` as the payload.  The frontend listener in
/// `useWorkspaceLifecycle.ts` pushes the record into the `auditEntries` React
/// state, making the entry visible without a workspace re-open.
/// Build the `payload_json` for a CRM audit entry as a FULL camelCase `AuditEntry`
/// shape.
///
/// The frontend persists each entry by serialising the whole `AuditEntry` into
/// `payloadJson` and reconstructs it on load with `JSON.parse(payloadJson) as
/// AuditEntry` (`recordToEntry`). A thin payload with no `metadata` key therefore
/// yields `entry.metadata === undefined`, and the Activity Log white-screens the
/// entire app when `getAuditEntryMatterScope` reads `metadata['scope']` unguarded.
/// So every CRM entry carries a real `metadata` object. CRM connect/sync/disconnect
/// are workspace-wide rather than tied to one matter, so the scope is `allMatters`.
fn crm_audit_payload_json(id: &str, timestamp: &str, action: &str, description: &str) -> String {
    serde_json::json!({
        "id": id,
        "timestamp": timestamp,
        "action": action,
        "description": description,
        "model": serde_json::Value::Null,
        "inputs": {},
        "outputs": {},
        "userDecision": serde_json::Value::Null,
        "metadata": {
            "auditEventType": action,
            "source": "crm-backend",
            "scope": { "kind": "allMatters" },
        },
    })
    .to_string()
}

async fn append_crm_audit_best_effort(app: &AppHandle, action: &str, description: &str) {
    use crate::commands::audit::store::{AuditEntryRecord, EncryptedAuditStore};

    // Resolve workspace: AuditState first (guarantees same DB as audit_list),
    // then CrmState as a fallback.
    let ws_opt: Option<std::path::PathBuf> = {
        let audit_ws = app.state::<AuditState>().workspace.lock().await.clone();
        if audit_ws.is_some() {
            audit_ws
        } else {
            app.state::<CrmState>().workspace.lock().await.clone()
        }
    };
    let Some(ws) = ws_opt else {
        log::warn!("crm audit append skipped (non-fatal): no workspace path available");
        return;
    };

    let action_s = action.to_string();
    let desc_s = description.to_string();

    let result = tokio::task::spawn_blocking(move || -> anyhow::Result<AuditEntryRecord> {
        let store = EncryptedAuditStore::open(&ws)?;

        let timestamp = chrono::Utc::now().to_rfc3339();
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or_default();
        let mut rng_bytes = [0u8; 4];
        rand::RngCore::fill_bytes(&mut rand::thread_rng(), &mut rng_bytes);
        let id = format!("audit_crm_{}_{}", nanos, hex::encode(rng_bytes));

        let payload_json = crm_audit_payload_json(&id, &timestamp, &action_s, &desc_s);

        let rec = AuditEntryRecord {
            id,
            timestamp,
            action: action_s,
            description: desc_s,
            payload_json,
        };
        store.append(&rec)?;
        Ok(rec)
    })
    .await;

    match result {
        Ok(Ok(rec)) => {
            // Notify the frontend so it can push the entry into the live
            // `auditEntries` React state without a workspace re-open.
            let _ = app.emit(CRM_AUDIT_APPENDED_EVENT, &rec);
        }
        Ok(Err(e)) => log::warn!("crm audit append failed (non-fatal): {e:#}"),
        Err(e) => log::warn!("crm audit spawn failed (non-fatal): {e}"),
    }
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/// Set the active workspace path for CRM operations.
/// Must be called before `crm_sync_all`.
#[tauri::command]
pub async fn crm_set_workspace(
    state: State<'_, CrmState>,
    path: String,
    provider: Option<String>,
) -> Result<(), String> {
    let _provider = CrmProvider::from_optional(provider.as_deref())?;
    *state.workspace.lock().await = Some(PathBuf::from(path));
    Ok(())
}

/// Validate a Wealthbox API token by calling `GET /me`.
///
/// On success the token is written to the OS keychain, a durable audit entry
/// is appended (best-effort), and a `CrmConnectInfo` containing the
/// workspace/account name, plan, and email is returned.  On failure a clean,
/// status-only error is returned — the raw response body and the token itself
/// are **never** included in the error string.
///
/// The `name` field in `CrmConnectInfo` is the **firm/account** name from
/// `accounts[0].name` (e.g. "Northcrest"), falling back to the user's own
/// `name` field (e.g. "Jameson Daines") when no accounts are present.  This
/// ensures the UI shows the RIA/firm name rather than the individual user.
#[tauri::command]
pub async fn crm_connect(
    app: AppHandle,
    token: Option<String>,
    username: Option<String>,
    password: Option<String>,
    provider: Option<String>,
) -> Result<CrmConnectInfo, String> {
    let provider = CrmProvider::from_optional(provider.as_deref())?;

    if provider == CrmProvider::Redtail {
        let username = username
            .as_deref()
            .map(str::trim)
            .filter(|v| !v.is_empty())
            .ok_or_else(|| "Redtail username is required".to_string())?;
        let password = password
            .as_deref()
            .filter(|v| !v.is_empty())
            .ok_or_else(|| "Redtail password is required".to_string())?;
        let info = RedtailClient::authenticate(username, password)
            .await
            .map_err(|_| {
                "Could not connect to Redtail: invalid login or network error".to_string()
            })?;

        // Store only the exchanged Redtail UserKey. The advisor password is
        // used for this request and is never persisted.
        store_token(provider, &info.user_key)?;

        append_crm_audit_best_effort(
            &app,
            &provider.audit_action("connect"),
            "Connected Redtail. Redtail password was used once to get a UserKey; only the UserKey is stored locally.",
        )
        .await;

        return Ok(CrmConnectInfo {
            name: info.name,
            plan: info.tier,
            email: info.email,
        });
    }

    let token = token
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .ok_or_else(|| format!("{} API token is required", provider.display_name()))?;

    // Validate: call /me and check the response is a success. Any network
    // error or non-2xx status surfaces a clean message; raw body is never
    // surfaced (it may contain advisor/firm PII).
    let info = validate_token(provider, token).await.map_err(|_| {
        format!(
            "Could not connect to {}: invalid token or network error",
            provider.display_name()
        )
    })?;

    // Store the token only after a confirmed successful validation.
    store_token(provider, token)?;

    // Emit durable audit — best-effort; uses AuditState workspace (same DB
    // that the Activity Log reads) so the entry appears immediately.
    append_crm_audit_best_effort(
        &app,
        &provider.audit_action("connect"),
        &format!(
            "Connected {}. API key stored locally; data requests go directly \
             from this device to {}, never through Keepance servers.",
            provider.display_name(),
            provider.display_name()
        ),
    )
    .await;

    Ok(CrmConnectInfo {
        name: info.name,
        plan: info.plan,
        email: info.email,
    })
}

/// Run the provider's browser-based OAuth flow and store its refresh token in
/// the provider-scoped CRM keychain slot.
///
/// Salesforce is the first CRM provider that needs OAuth instead of a pasted
/// API key. Wealthbox still uses `crm_connect(token, provider='wealthbox')`.
#[tauri::command]
pub async fn crm_oauth_connect(
    app: AppHandle,
    provider: Option<String>,
) -> Result<CrmConnectInfo, String> {
    let provider = CrmProvider::from_optional(provider.as_deref())?;
    if provider != CrmProvider::Salesforce {
        return Err(format!(
            "{} uses a direct connect path, not OAuth.",
            provider.display_name()
        ));
    }

    let client_id = salesforce_client_id()
        .ok_or_else(|| "KEEPANCE_SALESFORCE_CLIENT_ID is not configured".to_string())?;
    let (verifier, challenge) = crate::commands::mail::gmail::oauth::gen_pkce();
    let state_token = crate::commands::mail::gmail::oauth::gen_state();
    let (listener, redirect_uri) =
        crate::commands::mail::gmail::oauth::bind_loopback_host("localhost")
            .await
            .map_err(|e| e.to_string())?;
    let url = build_salesforce_auth_url(&client_id, &redirect_uri, &challenge, &state_token);
    crate::commands::mail::gmail::oauth::open_browser(&url);
    let code = crate::commands::mail::gmail::oauth::await_redirect_code(
        listener,
        &state_token,
        std::time::Duration::from_secs(300),
    )
    .await
    .map_err(|e| e.to_string())?;
    let tokens = exchange_salesforce_code(
        &client_id,
        &code,
        &verifier,
        &redirect_uri,
        SALESFORCE_TOKEN_ENDPOINT,
    )
    .await
    .map_err(|e| e.to_string())?;
    let stored = serde_json::to_string(&tokens).map_err(|e| e.to_string())?;
    store_token(provider, &stored)?;

    let info = SalesforceClient::new_with_token_endpoint(
        stored,
        client_id,
        SALESFORCE_TOKEN_ENDPOINT.to_string(),
    )
    .map_err(|e| e.to_string())?
    .identity()
    .await
    .map_err(|e| e.to_string())?;

    append_crm_audit_best_effort(
        &app,
        &provider.audit_action("connect"),
        &format!(
            "Connected {}. OAuth refresh token stored locally; data requests go directly \
             from this device to {}, never through Keepance servers.",
            provider.display_name(),
            provider.display_name()
        ),
    )
    .await;

    Ok(CrmConnectInfo {
        name: info.name,
        plan: String::new(),
        email: info.email,
    })
}

/// Returns `true` if a Wealthbox API token is present in the OS keychain.
#[tauri::command]
pub async fn crm_is_connected(provider: Option<String>) -> Result<bool, String> {
    let provider = CrmProvider::from_optional(provider.as_deref())?;
    Ok(read_token(provider).is_some())
}

/// Core disconnect logic — extracted for testability so integration tests can
/// drive the full disconnect path without a Tauri runtime.
///
/// Reads the workspace from `state`, deletes the Wealthbox API token
/// (best-effort: a keychain failure sets `token_deleted=false` and adds a
/// warning, but does **not** abort — the local data purge always proceeds),
/// purges RAG `source_type='crm'` chunks, purges the CRM database file, and
/// emits a durable audit entry.  Returns a `CrmDisconnectResult` that reports
/// exactly what happened; essentially never propagates `Err`.
///
/// A wiring regression (e.g. disconnect not reading the workspace from state,
/// or the purge helpers not being called) is caught by tests that call this
/// function and assert on the purge flags + the data being gone.
pub async fn crm_disconnect_logic(state: &CrmState) -> CrmDisconnectResult {
    crm_disconnect_logic_for_provider(state, CrmProvider::default()).await
}

async fn crm_disconnect_logic_for_provider(
    state: &CrmState,
    provider: CrmProvider,
) -> CrmDisconnectResult {
    let mut result = CrmDisconnectResult::default();

    // P3 — stop any in-flight sync and CLAIM the single-flight slot BEFORE purging, so
    // nothing re-inserts CRM chunks after the purge and the DB file isn't locked. Signal
    // cancel, then spin until we win the slot (the running sync releases it when it sees
    // cancel between matters) or a short timeout elapses.
    state.cancel.store(true, Ordering::SeqCst);
    let mut claimed = false;
    let mut waited_ms: u64 = 0;
    loop {
        if state
            .is_syncing
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .is_ok()
        {
            claimed = true;
            break;
        }
        if waited_ms >= 10_000 {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        waited_ms += 50;
        state.cancel.store(true, Ordering::SeqCst); // keep signalling while we wait
    }

    if !claimed {
        // A sync wouldn't stop in time. Refuse to purge — it would race inserts against
        // the delete and could lock the DB — and KEEP the token + connected state.
        result.data_remains = true;
        result.warnings.push(format!(
            "A {} sync is still running; disconnect was deferred. Stop the sync and try \
             disconnecting again.",
            provider.display_name()
        ));
        return result;
    }
    // We hold `is_syncing` for the whole purge; the guard releases it on every exit path,
    // so no NEW sync can start mid-purge.
    let _slot_guard = SyncGuard(state.is_syncing.clone());

    // No workspace → the imported data can't be located/deleted. KEEP the token + connected
    // state so the user can finish deleting once a workspace is open.
    let Some(ws) = state.workspace.lock().await.clone() else {
        result.data_remains = true;
        result.warnings.push(format!(
            "No workspace is open, so the imported {} data could not be located and was NOT \
             deleted. Your API key was kept — open the workspace and disconnect again to finish \
             deleting.",
            provider.display_name()
        ));
        return result;
    };

    match provider {
        CrmProvider::Wealthbox => {
            // Wealthbox was the original CRM provider; its historical disconnect
            // contract is a full CRM purge for the current workspace.
            match purge_crm_rag_chunks(&ws).await {
                Ok(()) => result.rag_purged = true,
                Err(e) => {
                    log::warn!("crm_disconnect: rag purge failed (non-fatal): {e:#}");
                    result
                        .warnings
                        .push(format!("Search-index (RAG) purge failed: {e}"));
                }
            }
            match CrmStore::purge(&ws) {
                Ok(()) => result.crm_db_purged = true,
                Err(e) => {
                    log::warn!("crm_disconnect: crm db purge failed (non-fatal): {e:#}");
                    result
                        .warnings
                        .push(format!("CRM database purge failed: {e}"));
                }
            }
        }
        CrmProvider::Salesforce => match purge_namespaced_crm_data(&ws, "sfdc:").await {
            Ok(()) => {
                result.rag_purged = true;
                result.crm_db_purged = true;
            }
            Err(e) => {
                log::warn!("crm_disconnect: salesforce purge failed (non-fatal): {e:#}");
                result
                    .warnings
                    .push(format!("Salesforce imported-data purge failed: {e}"));
            }
        },
        CrmProvider::Redtail => match purge_namespaced_crm_data(&ws, "redtail:").await {
            Ok(()) => {
                result.rag_purged = true;
                result.crm_db_purged = true;
            }
            Err(e) => {
                log::warn!("crm_disconnect: redtail purge failed (non-fatal): {e:#}");
                result
                    .warnings
                    .push(format!("Redtail imported-data purge failed: {e}"));
            }
        },
    }

    // P2 — remove the API token (= become "disconnected") ONLY AFTER both purges succeed,
    // so the user is never disconnected with data stranded on disk. Then drop the CRM DB
    // encryption key (P4), now that there is nothing left to decrypt. If a purge failed,
    // KEEP the token + connected state and flag `data_remains` so the UI can retry.
    if result.rag_purged && result.crm_db_purged {
        match delete_token(provider) {
            Ok(()) => result.token_deleted = true,
            Err(e) => {
                log::warn!("crm_disconnect: token deletion failed (non-fatal): {e}");
                result.warnings.push(format!(
                    "Imported data was deleted, but the API key could not be removed from the \
                     keychain: {e}"
                ));
            }
        }
        if provider == CrmProvider::Wealthbox {
            if let Err(e) = CrmStore::delete_master_key() {
                log::warn!("crm_disconnect: crm db key deletion failed (non-fatal): {e:#}");
                result.warnings.push(format!(
                    "The CRM database encryption key could not be removed from the keychain: {e}"
                ));
            }
        }
    } else {
        result.data_remains = true;
        result.warnings.push(format!(
            "Some imported {} data could not be deleted; your API key was kept so you can \
             try disconnecting again to finish deleting.",
            provider.display_name()
        ));
    }

    result
}

/// Remove the stored Wealthbox API token from the OS keychain and purge all
/// locally-imported Wealthbox data from this device (RAG chunks + encrypted
/// CRM object store).  Returns a `CrmDisconnectResult` that reports exactly
/// what was and was not deleted — the UI must use these flags to show an
/// honest status rather than always claiming "deleted imported data".
///
/// Thin wrapper over `crm_disconnect_logic`.  Token deletion is best-effort:
/// a momentarily unavailable keychain no longer blocks the local data purge.
/// After the purge, a durable audit entry is written (via `AuditState` so it
/// appears in the Activity Log immediately) and a `crm-audit-appended` event
/// is emitted.  Essentially never returns `Err`.
#[tauri::command]
pub async fn crm_disconnect(
    app: AppHandle,
    state: State<'_, CrmState>,
    provider: Option<String>,
) -> Result<CrmDisconnectResult, String> {
    let provider = CrmProvider::from_optional(provider.as_deref())?;
    let result = crm_disconnect_logic_for_provider(&state, provider).await;

    // Build an honest audit description from the result flags.
    let key_part = if result.token_deleted {
        "removed the API key"
    } else if result.data_remains {
        "kept the API key so deletion can be finished later"
    } else {
        "could NOT remove the API key"
    };
    let data_part = if result.data_remains {
        "some imported data could not be deleted yet"
    } else {
        "deleted the imported data"
    };
    let audit_desc = format!(
        "Disconnected {}; {key_part}; {data_part}.",
        provider.display_name()
    );
    append_crm_audit_best_effort(&app, &provider.audit_action("disconnect"), &audit_desc).await;

    Ok(result)
}

/// Open the workspace RAG table and delete every chunk with source_type = 'crm'.
/// Extracted as a helper so the two awaits stay out of the command body.
async fn purge_crm_rag_chunks(ws: &std::path::Path) -> anyhow::Result<()> {
    let conn = crate::commands::rag::store::open_connection(ws).await?;
    let table = crate::commands::rag::store::open_or_create_table(&conn).await?;
    crate::commands::rag::store::delete_source_type(&table, "crm").await
}

async fn purge_namespaced_crm_data(
    ws: &std::path::Path,
    provider_marker: &str,
) -> anyhow::Result<()> {
    let store = CrmStore::open(ws)?;
    let rows = store.list_objects_by_provider_marker(provider_marker)?;
    let source_ids: Vec<String> = rows.iter().filter_map(crm_source_id_for_row).collect();

    let key = crate::commands::rag::crypto::get_or_create_master_key()?;
    let conn = crate::commands::rag::store::open_connection(ws).await?;
    let table = crate::commands::rag::store::open_or_create_table(&conn).await?;
    for source_id in source_ids {
        crate::commands::rag::store::delete_path(&table, &source_id, &key).await?;
    }

    store.purge_objects_by_provider_marker(provider_marker)?;
    Ok(())
}

fn crm_source_id_for_row(row: &crate::commands::crm::store::CrmObjectRow) -> Option<String> {
    let (_, crm_key) = row.id.split_once(':')?;
    let kind = match row.kind.to_ascii_lowercase().as_str() {
        "household" => "household",
        "person" | "organization" | "trust" | "contact" => "contact",
        "note" => "note",
        "task" => "task",
        "event" => "event",
        _ => return None,
    };
    Some(format!("crm:{kind}:{crm_key}"))
}

/// Run a full backfill sync: fetch all Wealthbox objects, store them locally,
/// then index each household that appears in `matter_map` into the RAG store.
///
/// Single-flight: returns an error immediately if a sync is already running.
/// Emits `crm-sync-progress` events:
/// - `{ status: "syncing" }` at start
/// - `{ status: "done", households: N, records: N }` on success
/// - `{ status: "error" }` on failure
///
/// The `is_syncing` flag is always cleared on exit (RAII guard covers panics).
///
/// Cancellation: `crm_cancel_sync` sets the cancel flag, which `engine::backfill`
/// polls between households — a Stop bails cleanly and emits `{ status: "cancelled" }`.
///
/// TODO(progress): finer per-household progress events in a later iteration.
#[tauri::command]
pub async fn crm_sync_all(
    app: AppHandle,
    state: State<'_, CrmState>,
    matter_map: Vec<CrmMatterMapEntry>,
    provider: Option<String>,
) -> Result<CrmSyncReportDto, String> {
    let provider = CrmProvider::from_optional(provider.as_deref())?;

    // Atomically claim the sync slot; reject if a sync is already running.
    if state
        .is_syncing
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return Err("a sync is already in progress".into());
    }
    // RAII guard: restores is_syncing=false on every exit path.
    let _sync_guard = SyncGuard(state.is_syncing.clone());

    // Reset the cancel flag and the live progress counter now that we hold the slot.
    state.cancel.store(false, Ordering::SeqCst);
    state.progress_households.store(0, Ordering::SeqCst);

    // Read the stored token (error if not connected).
    let token = read_token(provider).ok_or_else(|| {
        format!(
            "{} not connected — call crm_connect first",
            provider.display_name()
        )
    })?;

    // Read the active workspace (error if not set).
    let workspace = state
        .workspace
        .lock()
        .await
        .clone()
        .ok_or("workspace not set — call crm_set_workspace first")?;

    // Emit the start event.
    let _ = app.emit(
        CRM_SYNC_PROGRESS_EVENT,
        serde_json::json!({ "status": "syncing" }),
    );

    // Convert the Vec<CrmMatterMapEntry> → HashMap<String,String> for the engine.
    let matter_hashmap: HashMap<String, String> = matter_map
        .iter()
        .map(|e| (e.household_id.clone(), e.matter_id.clone()))
        .collect();

    // Open (or create) the encrypted CRM store.
    let store = CrmStore::open(&workspace).map_err(|e| {
        let _ = app.emit(
            CRM_SYNC_PROGRESS_EVENT,
            serde_json::json!({ "status": "error" }),
        );
        // Never include raw Wealthbox data in errors; store-open errors are
        // local filesystem / keychain issues, safe to surface as-is.
        e.to_string()
    })?;

    // Read the RAG/vector master key from the OS keychain and hand it to the engine
    // (the engine stays keychain-free so it can be driven in tests with a literal key).
    let rag_key = crate::commands::rag::crypto::get_or_create_master_key().map_err(|e| {
        let _ = app.emit(
            CRM_SYNC_PROGRESS_EVENT,
            serde_json::json!({ "status": "error" }),
        );
        e.to_string()
    })?;

    // Live progress emitter: poll the shared counter every 250ms and emit `syncing`
    // events with the running household count, so the FE's progress display climbs
    // steadily instead of jumping at the end. Aborted once backfill returns (the
    // terminal done/cancelled/error event is emitted below).
    let emit_counter = state.progress_households.clone();
    let emit_app = app.clone();
    let emitter = tokio::spawn(async move {
        let mut last = u32::MAX;
        loop {
            tokio::time::sleep(std::time::Duration::from_millis(250)).await;
            let done = emit_counter.load(Ordering::SeqCst);
            if done != last {
                last = done;
                let _ = emit_app.emit(
                    CRM_SYNC_PROGRESS_EVENT,
                    serde_json::json!({ "status": "syncing", "households": done }),
                );
            }
        }
    });

    // Run the full backfill (fetch → ingest → index). The cancel flag is polled
    // between matters so the UI's Stop button interrupts a long sync.
    let client = client_for(provider, token).map_err(|e| e.to_string())?;
    let backfill_result = engine::backfill(
        client.as_ref(),
        &store,
        &workspace,
        &matter_hashmap,
        &state.cancel,
        &rag_key,
        &state.progress_households,
    )
    .await;
    emitter.abort();

    let report = match backfill_result {
        Ok(r) => r,
        Err(e) => {
            let _ = app.emit(
                CRM_SYNC_PROGRESS_EVENT,
                serde_json::json!({ "status": "error" }),
            );
            return Err(e.to_string());
        }
    };

    // Build the DTO.
    let dto = CrmSyncReportDto {
        households_processed: report.households_processed,
        records_indexed: report.records_indexed,
        ingest_contacts: report.ingest.contacts,
        ingest_notes: report.ingest.notes,
        ingest_tasks: report.ingest.tasks,
        ingest_events: report.ingest.events,
        ingest_skipped_unlinked: report.ingest.skipped_unlinked,
    };

    // Emit the terminal event. A cancelled run gets its own status so the UI
    // un-sticks from "Syncing…" and shows it was stopped (not a clean finish);
    // both `done` and `cancelled` are terminal states the UI handles.
    let households = dto.households_processed;
    let records = dto.records_indexed;
    let _ = app.emit(
        CRM_SYNC_PROGRESS_EVENT,
        serde_json::json!({
            "status": if report.cancelled { "cancelled" } else { "done" },
            "households": households,
            "records": records,
        }),
    );

    // Persist the last report in state so `crm_sync_status` can return it.
    *state.last_report.lock().await = Some(dto.clone());

    // Emit durable audit — records what was actually imported (honest about a
    // cancelled, partial run).
    let audit_desc = if report.cancelled {
        format!(
            "{} sync stopped early — imported {households} households ({records} records) before cancellation.",
            provider.display_name()
        )
    } else {
        format!(
            "Imported {households} {} households ({records} records) into the local encrypted store.",
            provider.display_name()
        )
    };
    append_crm_audit_best_effort(&app, &provider.audit_action("sync"), &audit_desc).await;

    Ok(dto)
}

/// Return the current sync state (running or idle) and the last completed report.
#[tauri::command]
pub async fn crm_sync_status(
    state: State<'_, CrmState>,
    provider: Option<String>,
) -> Result<CrmSyncStatusDto, String> {
    let _provider = CrmProvider::from_optional(provider.as_deref())?;
    let is_syncing = state.is_syncing.load(Ordering::SeqCst);
    if is_syncing {
        // Live, in-progress count so a watching poller sees steady movement rather than
        // last sync's stale report. `records_indexed` is only final-accurate, so the
        // live report carries the household count and leaves the rest at defaults.
        let done = state.progress_households.load(Ordering::SeqCst);
        let live = CrmSyncReportDto {
            households_processed: done,
            ..Default::default()
        };
        return Ok(CrmSyncStatusDto {
            is_syncing,
            last_report: Some(live),
        });
    }
    let last_report = state.last_report.lock().await.clone();
    Ok(CrmSyncStatusDto {
        is_syncing,
        last_report,
    })
}

/// Set the cancel flag. `engine::backfill` polls it between households, so a
/// long sync stops cleanly at the next household boundary (those already
/// processed stay indexed). Releasing the UI is driven by the terminal
/// `{ status: "cancelled" }` event `crm_sync_all` emits when it observes the flag.
#[tauri::command]
pub async fn crm_cancel_sync(
    state: State<'_, CrmState>,
    provider: Option<String>,
) -> Result<(), String> {
    let _provider = CrmProvider::from_optional(provider.as_deref())?;
    state.cancel.store(true, Ordering::SeqCst);
    Ok(())
}

// ---------------------------------------------------------------------------
// crm_list_households helpers + command
// ---------------------------------------------------------------------------

/// Derive the display name for a household `CrmContact`.
///
/// Priority:
///   1. `contact.name` trimmed — the top-level `name` field returned by the
///      live Wealthbox API on household contacts (e.g. "Ellison, Robert &
///      Margaret"). This is the real household display name.
///   2. `contact.company_name` trimmed — used by organisation-type households
///      and older fixtures that set `company_name` instead of `name`.
///   3. `"Household {id}"` — generic fallback when both are blank.
///
/// Factored out of the command so it can be unit-tested without any
/// Tauri runtime, OS keychain, or network call.
fn household_dto_name(contact: &crate::commands::crm::model::CrmContact) -> String {
    let name = contact.name.trim();
    if !name.is_empty() {
        return name.to_string();
    }
    let company = contact.company_name.trim();
    if !company.is_empty() {
        return company.to_string();
    }
    format!("Household {}", contact.id)
}

/// Return a slim list of every household in the advisor's Wealthbox account.
///
/// Reads the stored token (returns `"not connected"` if absent) → builds
/// `WealthboxClient` → calls `list_households()` (paged, ~1 rps gated) →
/// maps each `CrmContact` to `CrmHouseholdDto { id, name }`.
///
/// **Token and raw API body are never logged or returned** per the module
/// security contract.
#[tauri::command]
pub async fn crm_list_households(provider: Option<String>) -> Result<Vec<CrmHouseholdDto>, String> {
    let provider = CrmProvider::from_optional(provider.as_deref())?;
    let token = read_token(provider).ok_or_else(|| "not connected".to_string())?;
    let client = client_for(provider, token).map_err(|e| e.to_string())?;
    let contacts = client.list_households().await.map_err(|e| e.to_string())?;
    let dtos = contacts
        .iter()
        .map(|c| CrmHouseholdDto {
            id: c.crm_key(),
            name: household_dto_name(c),
        })
        .collect();
    Ok(dtos)
}

// ---------------------------------------------------------------------------
// Tests — pure-logic only (no OS keychain, no network, no Tauri runtime)
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    /// Build a `CrmState` for disconnect tests. Workspace is `None` by default so the
    /// purge path (which needs the keychain) is not exercised headless.
    fn test_state(is_syncing: bool) -> CrmState {
        CrmState {
            workspace: tokio::sync::Mutex::new(None),
            is_syncing: Arc::new(AtomicBool::new(is_syncing)),
            cancel: Arc::new(AtomicBool::new(false)),
            last_report: tokio::sync::Mutex::new(None),
            progress_households: Arc::new(std::sync::atomic::AtomicU32::new(0)),
        }
    }

    /// DISCONNECT P2: when the purge can't run (no workspace), the API token is KEPT
    /// and `data_remains` is true, so the user is never "disconnected" with data
    /// stranded on disk.
    #[tokio::test]
    async fn disconnect_no_workspace_keeps_token_and_reports_data_remains() {
        let state = test_state(false);
        let result = crm_disconnect_logic(&state).await;

        assert!(
            result.data_remains,
            "data_remains must be true when the purge can't run"
        );
        assert!(
            !result.token_deleted,
            "the API token must be KEPT when data couldn't be purged"
        );
        assert!(!result.rag_purged && !result.crm_db_purged);
        assert!(
            result.warnings.iter().any(|w| w.contains("No workspace")),
            "expected a no-workspace warning; got {:?}",
            result.warnings
        );
        // The single-flight slot claimed during the attempt is released again.
        assert!(
            !state.is_syncing.load(Ordering::SeqCst),
            "the claimed slot must be released"
        );
    }

    /// DISCONNECT P3: a disconnect signals cancel and WAITS for an in-flight sync to
    /// release the single-flight slot, then claims it before purging — so nothing
    /// re-inserts after the purge. Here the "running sync" releases the slot shortly
    /// after it sees cancel; disconnect must claim it and proceed (not defer).
    #[tokio::test]
    async fn disconnect_waits_for_running_sync_then_claims_slot() {
        let state = test_state(true); // a sync is "running" (slot held)

        // Simulate the running sync stopping once it observes cancel.
        let is_syncing = state.is_syncing.clone();
        let cancel = state.cancel.clone();
        tokio::spawn(async move {
            while !cancel.load(Ordering::SeqCst) {
                tokio::time::sleep(std::time::Duration::from_millis(5)).await;
            }
            tokio::time::sleep(std::time::Duration::from_millis(20)).await;
            is_syncing.store(false, Ordering::SeqCst);
        });

        let result = crm_disconnect_logic(&state).await;

        // It WAITED, claimed the slot, and reached the no-workspace path — NOT the
        // "deferred, sync still running" path.
        assert!(
            result.warnings.iter().any(|w| w.contains("No workspace")),
            "expected the no-workspace path (claimed after waiting); got {:?}",
            result.warnings
        );
        assert!(
            !result.warnings.iter().any(|w| w.contains("still running")),
            "must NOT be the deferred path; got {:?}",
            result.warnings
        );
        assert!(
            state.cancel.load(Ordering::SeqCst),
            "disconnect must signal cancel"
        );
        assert!(
            !state.is_syncing.load(Ordering::SeqCst),
            "the claimed slot must be released"
        );
    }

    #[test]
    fn crm_source_id_for_salesforce_rows_uses_provider_namespaced_key() {
        let household = crate::commands::crm::store::CrmObjectRow {
            id: "contact:sfdc:001HH0000000001AAA".to_string(),
            kind: "household".to_string(),
            household_id: "sfdc:001HH0000000001AAA".to_string(),
            updated_at: String::new(),
            content_hash: "hash".to_string(),
            json: "{}".to_string(),
            deleted: false,
        };
        let contact = crate::commands::crm::store::CrmObjectRow {
            id: "contact:sfdc:003CC0000000002AAA:acct:001HH0000000001AAA".to_string(),
            kind: "person".to_string(),
            household_id: "sfdc:001HH0000000001AAA".to_string(),
            updated_at: String::new(),
            content_hash: "hash".to_string(),
            json: "{}".to_string(),
            deleted: false,
        };

        assert_eq!(
            crm_source_id_for_row(&household).as_deref(),
            Some("crm:household:sfdc:001HH0000000001AAA")
        );
        assert_eq!(
            crm_source_id_for_row(&contact).as_deref(),
            Some("crm:contact:sfdc:003CC0000000002AAA:acct:001HH0000000001AAA")
        );
    }

    #[test]
    fn crm_source_id_for_redtail_rows_uses_provider_namespaced_key() {
        let household = crate::commands::crm::store::CrmObjectRow {
            id: "contact:redtail:family:7".to_string(),
            kind: "household".to_string(),
            household_id: "redtail:family:7".to_string(),
            updated_at: String::new(),
            content_hash: "hash".to_string(),
            json: "{}".to_string(),
            deleted: false,
        };
        let note = crate::commands::crm::store::CrmObjectRow {
            id: "note:redtail:note:2".to_string(),
            kind: "note".to_string(),
            household_id: "redtail:family:7".to_string(),
            updated_at: String::new(),
            content_hash: "hash".to_string(),
            json: "{}".to_string(),
            deleted: false,
        };

        assert_eq!(
            crm_source_id_for_row(&household).as_deref(),
            Some("crm:household:redtail:family:7")
        );
        assert_eq!(
            crm_source_id_for_row(&note).as_deref(),
            Some("crm:note:redtail:note:2")
        );
    }

    // ── Vec<CrmMatterMapEntry> → HashMap conversion ────────────────────────

    #[test]
    fn matter_map_vec_converts_to_hashmap_correctly() {
        let entries = vec![
            CrmMatterMapEntry {
                household_id: "10001".to_string(),
                matter_id: "matter-alpha".to_string(),
            },
            CrmMatterMapEntry {
                household_id: "10002".to_string(),
                matter_id: "matter-beta".to_string(),
            },
        ];

        let map: HashMap<String, String> = entries
            .iter()
            .map(|e| (e.household_id.clone(), e.matter_id.clone()))
            .collect();

        assert_eq!(
            map.len(),
            2,
            "two distinct households must produce two entries"
        );
        assert_eq!(
            map.get("10001").map(String::as_str),
            Some("matter-alpha"),
            "household 10001 must map to matter-alpha"
        );
        assert_eq!(
            map.get("10002").map(String::as_str),
            Some("matter-beta"),
            "household 10002 must map to matter-beta"
        );
        assert_eq!(
            map.get("99999"),
            None,
            "an unmapped household id must return None"
        );
    }

    #[test]
    fn matter_map_empty_vec_produces_empty_hashmap() {
        let entries: Vec<CrmMatterMapEntry> = vec![];
        let map: HashMap<String, String> = entries
            .iter()
            .map(|e| (e.household_id.clone(), e.matter_id.clone()))
            .collect();
        assert!(map.is_empty(), "an empty Vec must produce an empty HashMap");
    }

    #[test]
    fn matter_map_duplicate_household_id_last_entry_wins() {
        // If the frontend accidentally sends duplicate household ids, the
        // HashMap collect keeps the last entry (standard Rust HashMap::collect
        // deduplication semantics).
        let entries = vec![
            CrmMatterMapEntry {
                household_id: "10001".to_string(),
                matter_id: "matter-first".to_string(),
            },
            CrmMatterMapEntry {
                household_id: "10001".to_string(),
                matter_id: "matter-second".to_string(),
            },
        ];
        let map: HashMap<String, String> = entries
            .iter()
            .map(|e| (e.household_id.clone(), e.matter_id.clone()))
            .collect();
        assert_eq!(map.len(), 1, "duplicate household ids must be de-duped");
        assert_eq!(
            map.get("10001").map(String::as_str),
            Some("matter-second"),
            "last entry wins on duplicate"
        );
    }

    // ── me() JSON → CrmConnectInfo parsing ────────────────────────────────

    /// Helper: apply the same firm-name-over-user-name logic used in crm_connect.
    fn parse_me_to_info(me: &serde_json::Value) -> CrmConnectInfo {
        let info = crate::commands::crm::provider::parse_wealthbox_me_to_info(me);
        CrmConnectInfo {
            name: info.name,
            plan: info.plan,
            email: info.email,
        }
    }

    /// The real /me shape: `accounts[0].name` carries the firm name;
    /// top-level `name` is the individual user.  Firm name must be preferred.
    #[test]
    fn parse_me_json_prefers_account_name_over_user_name() {
        let me = serde_json::json!({
            "id": 42,
            "name": "Jameson Daines",          // user's name — must NOT be shown
            "plan": "basic",
            "email": "advisor@northcrest.com",
            "accounts": [
                { "id": 1, "name": "Northcrest Advisory" }
            ]
        });
        let info = parse_me_to_info(&me);
        assert_eq!(
            info.name, "Northcrest Advisory",
            "accounts[0].name (firm) must be preferred over top-level name (user)"
        );
        assert_eq!(info.plan, "basic");
        assert_eq!(info.email, "advisor@northcrest.com");
    }

    /// When no accounts array is present, fall back to the user's own name.
    #[test]
    fn parse_me_json_falls_back_to_user_name_when_no_accounts() {
        let me = serde_json::json!({
            "id": 42,
            "name": "Northcrest Advisory",  // in this fixture the user IS the firm
            "plan": "professional",
            "email": "advisor@northcrest.com",
        });
        let info = parse_me_to_info(&me);
        assert_eq!(
            info.name, "Northcrest Advisory",
            "user name is used as fallback when accounts is absent"
        );
        assert_eq!(info.plan, "professional");
        assert_eq!(info.email, "advisor@northcrest.com");
    }

    /// Absent fields must fall back to "".
    #[test]
    fn parse_me_json_missing_fields_default_to_empty() {
        let me = serde_json::json!({ "id": 7 });
        let info = parse_me_to_info(&me);
        assert_eq!(
            info.name, "",
            "missing name + accounts must default to empty string"
        );
        assert_eq!(info.plan, "", "missing 'plan' must default to empty string");
        assert_eq!(
            info.email, "",
            "missing 'email' must default to empty string"
        );
    }

    /// Kept for forward-compatibility: a /me that has a full_fields shape
    /// without the new accounts array still works via fallback.
    #[test]
    fn parse_me_json_full_fields() {
        let me = serde_json::json!({
            "id": 42,
            "name": "Northcrest Advisory",
            "plan": "professional",
            "email": "advisor@northcrest.com",
        });
        let info = parse_me_to_info(&me);
        // No accounts array → falls back to user name field.
        assert_eq!(info.name, "Northcrest Advisory");
        assert_eq!(info.plan, "professional");
        assert_eq!(info.email, "advisor@northcrest.com");
    }

    // ── household_dto_name helper ──────────────────────────────────────────────

    #[test]
    fn household_dto_name_uses_company_name_when_present() {
        use crate::commands::crm::model::CrmContact;
        let c = CrmContact {
            id: 10001,
            company_name: "The Andersons".to_string(),
            r#type: "household".to_string(),
            ..Default::default()
        };
        assert_eq!(
            household_dto_name(&c),
            "The Andersons",
            "non-empty company_name must be returned as-is (trimmed)"
        );
    }

    #[test]
    fn household_dto_name_trims_surrounding_whitespace() {
        use crate::commands::crm::model::CrmContact;
        let c = CrmContact {
            id: 10001,
            company_name: "  The Andersons  ".to_string(),
            r#type: "household".to_string(),
            ..Default::default()
        };
        assert_eq!(
            household_dto_name(&c),
            "The Andersons",
            "leading/trailing whitespace must be stripped"
        );
    }

    #[test]
    fn household_dto_name_falls_back_for_empty_company_name() {
        use crate::commands::crm::model::CrmContact;
        let c = CrmContact {
            id: 42,
            company_name: "".to_string(),
            r#type: "household".to_string(),
            ..Default::default()
        };
        assert_eq!(
            household_dto_name(&c),
            "Household 42",
            "empty company_name must fall back to 'Household {{id}}'"
        );
    }

    #[test]
    fn household_dto_name_falls_back_for_whitespace_only_company_name() {
        use crate::commands::crm::model::CrmContact;
        let c = CrmContact {
            id: 99,
            company_name: "   ".to_string(),
            r#type: "household".to_string(),
            ..Default::default()
        };
        assert_eq!(
            household_dto_name(&c),
            "Household 99",
            "whitespace-only company_name must fall back to 'Household {{id}}'"
        );
    }

    // ── parse_me_json tests (continued) ───────────────────────────────────────

    /// Trial plan fixture: no accounts array — user name used as fallback.
    #[test]
    fn parse_me_json_trial_plan_fixture() {
        let me = serde_json::json!({
            "name": "Northcrest",
            "plan": "trial",
        });
        let info = parse_me_to_info(&me);
        assert_eq!(info.name, "Northcrest");
        assert_eq!(info.plan, "trial");
        assert_eq!(info.email, "");
    }

    // ── household_dto_name: Fix C — name field preferred over company_name ────

    /// Top-level `name` (set on household contacts by the live API, e.g.
    /// "Ellison, Robert & Margaret") must be preferred over `company_name`.
    #[test]
    fn household_dto_name_prefers_name_field_over_company_name() {
        use crate::commands::crm::model::CrmContact;
        let c = CrmContact {
            id: 20001,
            name: "Ellison, Robert & Margaret".to_string(),
            company_name: "Ellison Family".to_string(), // both set — name wins
            r#type: "household".to_string(),
            ..Default::default()
        };
        assert_eq!(
            household_dto_name(&c),
            "Ellison, Robert & Margaret",
            "contact.name must be preferred over company_name when both are present"
        );
    }

    /// When `name` is empty, `company_name` is the fallback.
    #[test]
    fn household_dto_name_falls_back_to_company_name_when_name_empty() {
        use crate::commands::crm::model::CrmContact;
        let c = CrmContact {
            id: 10001,
            name: "".to_string(),
            company_name: "The Andersons".to_string(),
            r#type: "household".to_string(),
            ..Default::default()
        };
        assert_eq!(
            household_dto_name(&c),
            "The Andersons",
            "company_name is used when name is empty"
        );
    }

    // ── Audit payload shape: full AuditEntry with a metadata object ───────────

    /// The CRM audit payload must be a full camelCase `AuditEntry` with a real
    /// `metadata` object (scope = allMatters). A thin payload (no `metadata` key)
    /// makes `entry.metadata` undefined on load and white-screens the Activity Log
    /// when `getAuditEntryMatterScope` reads `metadata['scope']`.
    #[test]
    fn crm_audit_payload_json_carries_metadata_object_with_scope() {
        let payload = crm_audit_payload_json(
            "audit_crm_1_abcd",
            "2026-06-26T00:00:00Z",
            "wealthbox.connect",
            "Connected to Wealthbox.",
        );
        let v: serde_json::Value = serde_json::from_str(&payload).expect("valid json");

        // Full entry shape so the frontend's recordToEntry yields a complete AuditEntry.
        assert_eq!(v["id"], "audit_crm_1_abcd");
        assert_eq!(v["action"], "wealthbox.connect");
        assert!(v["inputs"].is_object());
        assert!(v["outputs"].is_object());

        // metadata MUST be an object — this is the white-screen guard.
        assert!(
            v["metadata"].is_object(),
            "metadata must be an object, never undefined"
        );
        assert_eq!(v["metadata"]["source"], "crm-backend");
        assert_eq!(v["metadata"]["auditEventType"], "wealthbox.connect");

        // scope is the allMatters object shape getAuditEntryMatterScope reads.
        assert!(
            v["metadata"]["scope"].is_object(),
            "scope must be an object"
        );
        assert_eq!(v["metadata"]["scope"]["kind"], "allMatters");
    }

    // ── Fix A: audit roundtrip — wealthbox.* entry persists and lists ─────────

    /// Verify that the audit-append path (the same code `append_crm_audit_best_effort`
    /// uses) writes a `wealthbox.*` entry that can be retrieved via `list`.
    /// Uses `EncryptedAuditStore::open_with_key` to bypass the OS keychain,
    /// mirroring the pattern in `commands/audit/store.rs` tests.
    #[test]
    fn crm_audit_append_writes_wealthbox_entry_to_store() {
        use crate::commands::audit::store::{AuditEntryRecord, EncryptedAuditStore};
        use tempfile::TempDir;

        let dir = TempDir::new().unwrap();
        let key = [0x42u8; 32]; // deterministic test key, bypasses keychain

        let store = EncryptedAuditStore::open_with_key(dir.path(), &key)
            .expect("open audit store at temp workspace");

        // Simulate what append_crm_audit_best_effort writes for a connect event.
        let rec = AuditEntryRecord {
            id: "audit_crm_test_connect_001".to_string(),
            timestamp: "2026-06-25T12:00:00Z".to_string(),
            action: "wealthbox.connect".to_string(),
            description: "Connected Wealthbox. API key stored locally; data requests go \
                           directly from this device to Wealthbox, never through Keepance servers."
                .to_string(),
            payload_json: r#"{"auditEventType":"wealthbox.connect","source":"crm-backend"}"#
                .to_string(),
        };
        store.append(&rec).expect("append wealthbox.connect entry");

        // Also write a disconnect entry to cover both connect + disconnect audit paths.
        let rec2 = AuditEntryRecord {
            id: "audit_crm_test_disconnect_001".to_string(),
            timestamp: "2026-06-25T12:01:00Z".to_string(),
            action: "wealthbox.disconnect".to_string(),
            description: "Disconnected Wealthbox; removed the API key; deleted the imported data."
                .to_string(),
            payload_json: r#"{"auditEventType":"wealthbox.disconnect","source":"crm-backend"}"#
                .to_string(),
        };
        store
            .append(&rec2)
            .expect("append wealthbox.disconnect entry");

        // List all entries and assert both wealthbox.* entries are present.
        let entries = store.list(None, None).expect("list audit entries");
        assert_eq!(entries.len(), 2, "two entries must be persisted");

        let connect_entry = entries.iter().find(|e| e.action == "wealthbox.connect");
        assert!(
            connect_entry.is_some(),
            "wealthbox.connect entry must be in the store"
        );
        assert!(
            connect_entry.unwrap().action.starts_with("wealthbox."),
            "action must start with 'wealthbox.'"
        );
        assert!(
            connect_entry.unwrap().description.contains("Wealthbox"),
            "description must mention Wealthbox"
        );

        let disconnect_entry = entries.iter().find(|e| e.action == "wealthbox.disconnect");
        assert!(
            disconnect_entry.is_some(),
            "wealthbox.disconnect entry must be in the store"
        );

        // Verify the chain is intact after both appends.
        use crate::commands::audit::store::AuditChainVerification;
        assert_eq!(
            store.verify_chain().unwrap(),
            AuditChainVerification::Verified { checked: 2 },
            "hash chain must be valid after two CRM audit appends"
        );
    }
}
