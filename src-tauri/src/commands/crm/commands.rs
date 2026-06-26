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
use crate::commands::crm::client::WealthboxClient;
use crate::commands::crm::engine;
use crate::commands::crm::store::CrmStore;

// ---------------------------------------------------------------------------
// Keychain constants + private helpers
// ---------------------------------------------------------------------------

const KEYCHAIN_SERVICE: &str = "keepance-wealthbox";
const KEYCHAIN_TOKEN_KEY: &str = "api-token";

/// Write the Wealthbox API token to the OS keychain.
fn store_token(token: &str) -> Result<(), String> {
    keyring::Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_TOKEN_KEY)
        .map_err(|e| e.to_string())?
        .set_password(token)
        .map_err(|e| e.to_string())
}

/// Read the stored Wealthbox API token from the OS keychain, or `None` if absent.
fn read_token() -> Option<String> {
    keyring::Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_TOKEN_KEY)
        .ok()?
        .get_password()
        .ok()
}

/// Delete the Wealthbox API token from the OS keychain.
/// A missing entry (`NoEntry`) is treated as success (idempotent).
fn delete_token() -> Result<(), String> {
    match keyring::Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_TOKEN_KEY)
        .map_err(|e| e.to_string())?
        .delete_credential()
    {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

// ---------------------------------------------------------------------------
// CrmState + manage_state + RAII guard
// ---------------------------------------------------------------------------

pub struct CrmState {
    pub workspace: tokio::sync::Mutex<Option<PathBuf>>,
    pub is_syncing: Arc<AtomicBool>,
    pub cancel: Arc<AtomicBool>,
    pub last_report: tokio::sync::Mutex<Option<CrmSyncReportDto>>,
}

pub fn manage_state(app: &tauri::App) {
    app.manage(CrmState {
        workspace: tokio::sync::Mutex::new(None),
        is_syncing: Arc::new(AtomicBool::new(false)),
        cancel: Arc::new(AtomicBool::new(false)),
        last_report: tokio::sync::Mutex::new(None),
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

        let payload_json = serde_json::json!({
            "auditEventType": action_s,
            "source": "crm-backend",
        })
        .to_string();

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
) -> Result<(), String> {
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
    token: String,
) -> Result<CrmConnectInfo, String> {
    let client = WealthboxClient::new(token.clone());

    // Validate: call /me and check the response is a success. Any network
    // error or non-2xx status surfaces a clean message; raw body is never
    // surfaced (it may contain advisor/firm PII).
    let me = client
        .me()
        .await
        .map_err(|_| "Could not connect to Wealthbox: invalid token or network error".to_string())?;

    // Store the token only after a confirmed successful validation.
    store_token(&token)?;

    // Emit durable audit — best-effort; uses AuditState workspace (same DB
    // that the Activity Log reads) so the entry appears immediately.
    append_crm_audit_best_effort(
        &app,
        "wealthbox.connect",
        "Connected Wealthbox. API key stored locally; data requests go directly \
         from this device to Wealthbox, never through Keepance servers.",
    )
    .await;

    // Parse account info tolerantly — absent or null fields fall back to "".
    // Prefer accounts[0].name (the firm/RIA name) over the top-level `name`
    // (the individual user's name) so the UI shows the firm, not the person.
    let firm_name = me
        .get("accounts")
        .and_then(|a| a.get(0))
        .and_then(|acc| acc.get("name"))
        .and_then(|n| n.as_str())
        .unwrap_or("");
    let user_name = me.get("name").and_then(|v| v.as_str()).unwrap_or("");
    let name = if !firm_name.is_empty() { firm_name } else { user_name }.to_string();
    let plan = me.get("plan").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let email = me.get("email").and_then(|v| v.as_str()).unwrap_or("").to_string();

    Ok(CrmConnectInfo { name, plan, email })
}

/// Returns `true` if a Wealthbox API token is present in the OS keychain.
#[tauri::command]
pub async fn crm_is_connected() -> Result<bool, String> {
    Ok(read_token().is_some())
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
    let mut result = CrmDisconnectResult::default();

    // Best-effort token deletion: a keychain failure is reported as a warning
    // but must NOT prevent the local data purge from running.  The user's
    // imported data is always deleted regardless of keychain availability;
    // token_deleted reports honestly whether the API key was also removed.
    match delete_token() {
        Ok(()) => result.token_deleted = true,
        Err(e) => {
            log::warn!("crm_disconnect: token deletion failed (non-fatal): {e}");
            result.warnings.push(format!("API key could not be removed from keychain: {e}"));
        }
    }

    let workspace = state.workspace.lock().await.clone();
    if let Some(ref ws) = workspace {
        // Purge RAG chunks whose source_type = 'crm'.
        match purge_crm_rag_chunks(ws).await {
            Ok(()) => result.rag_purged = true,
            Err(e) => {
                log::warn!("crm_disconnect: rag purge failed (non-fatal): {e:#}");
                result.warnings.push(format!("RAG chunk purge failed: {e}"));
            }
        }
        // Purge the encrypted CRM object database.
        match CrmStore::purge(ws) {
            Ok(()) => result.crm_db_purged = true,
            Err(e) => {
                log::warn!("crm_disconnect: crm db purge failed (non-fatal): {e:#}");
                result.warnings.push(format!("CRM database purge failed: {e}"));
            }
        }

    } else {
        result.warnings.push(
            "No workspace set; imported Wealthbox data could not be located and was NOT deleted."
                .to_string(),
        );
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
) -> Result<CrmDisconnectResult, String> {
    let result = crm_disconnect_logic(&state).await;

    // Build an honest audit description from the result flags.
    let key_part = if result.token_deleted {
        "removed the API key"
    } else {
        "could NOT remove the API key (keychain unavailable)"
    };
    let data_part = if result.rag_purged && result.crm_db_purged {
        "deleted the imported data"
    } else {
        "some imported data could not be deleted"
    };
    let audit_desc = format!("Disconnected Wealthbox; {key_part}; {data_part}.");
    append_crm_audit_best_effort(&app, "wealthbox.disconnect", &audit_desc).await;

    Ok(result)
}

/// Open the workspace RAG table and delete every chunk with source_type = 'crm'.
/// Extracted as a helper so the two awaits stay out of the command body.
async fn purge_crm_rag_chunks(ws: &std::path::Path) -> anyhow::Result<()> {
    let conn = crate::commands::rag::store::open_connection(ws).await?;
    let table = crate::commands::rag::store::open_or_create_table(&conn).await?;
    crate::commands::rag::store::delete_source_type(&table, "crm").await
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
/// TODO(progress): finer per-household progress events in a later iteration.
/// TODO(cancel): thread the cancel flag into `engine::backfill` once the
///   engine supports mid-run cancellation.
#[tauri::command]
pub async fn crm_sync_all(
    app: AppHandle,
    state: State<'_, CrmState>,
    matter_map: Vec<CrmMatterMapEntry>,
) -> Result<CrmSyncReportDto, String> {
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

    // Reset the cancel flag now that we hold the sync slot.
    state.cancel.store(false, Ordering::SeqCst);

    // Read the stored token (error if not connected).
    let token = read_token().ok_or("Wealthbox not connected — call crm_connect first")?;

    // Read the active workspace (error if not set).
    let workspace = state
        .workspace
        .lock()
        .await
        .clone()
        .ok_or("workspace not set — call crm_set_workspace first")?;

    // Emit the start event.
    let _ = app.emit(CRM_SYNC_PROGRESS_EVENT, serde_json::json!({ "status": "syncing" }));

    // Convert the Vec<CrmMatterMapEntry> → HashMap<String,String> for the engine.
    let matter_hashmap: HashMap<String, String> = matter_map
        .iter()
        .map(|e| (e.household_id.clone(), e.matter_id.clone()))
        .collect();

    // Open (or create) the encrypted CRM store.
    let store = CrmStore::open(&workspace).map_err(|e| {
        let _ = app.emit(CRM_SYNC_PROGRESS_EVENT, serde_json::json!({ "status": "error" }));
        // Never include raw Wealthbox data in errors; store-open errors are
        // local filesystem / keychain issues, safe to surface as-is.
        e.to_string()
    })?;

    // Run the full backfill (fetch → ingest → index).
    let client = WealthboxClient::new(token);
    let report = match engine::backfill(&client, &store, &workspace, &matter_hashmap).await {
        Ok(r) => r,
        Err(e) => {
            let _ = app.emit(CRM_SYNC_PROGRESS_EVENT, serde_json::json!({ "status": "error" }));
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

    // Emit the done event with summary counts.
    let _ = app.emit(
        CRM_SYNC_PROGRESS_EVENT,
        serde_json::json!({
            "status": "done",
            "households": dto.households_processed,
            "records": dto.records_indexed,
        }),
    );

    // Persist the last report in state so `crm_sync_status` can return it.
    *state.last_report.lock().await = Some(dto.clone());

    // Emit durable audit — records the confirmed import counts.
    let households = dto.households_processed;
    let records = dto.records_indexed;
    append_crm_audit_best_effort(
        &app,
        "wealthbox.sync",
        &format!(
            "Imported {households} Wealthbox households ({records} records) into the local encrypted store."
        ),
    )
    .await;

    Ok(dto)
}

/// Return the current sync state (running or idle) and the last completed report.
#[tauri::command]
pub async fn crm_sync_status(state: State<'_, CrmState>) -> Result<CrmSyncStatusDto, String> {
    let is_syncing = state.is_syncing.load(Ordering::SeqCst);
    let last_report = state.last_report.lock().await.clone();
    Ok(CrmSyncStatusDto { is_syncing, last_report })
}

/// Set the cancel flag. Best-effort — the backfill engine does not yet poll it.
///
/// TODO(cancel): once `engine::backfill` accepts a cancel signal, wire it here
///   so a long sync can be interrupted mid-run without waiting for the current
///   household to finish indexing.
#[tauri::command]
pub async fn crm_cancel_sync(state: State<'_, CrmState>) -> Result<(), String> {
    state.cancel.store(true, Ordering::SeqCst);
    Ok(())
}

// ---------------------------------------------------------------------------
// crm_list_households helpers + command
// ---------------------------------------------------------------------------

/// Derive the display name for a household `WbContact`.
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
fn household_dto_name(contact: &crate::commands::crm::model::WbContact) -> String {
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
/// maps each `WbContact` to `CrmHouseholdDto { id, name }`.
///
/// **Token and raw API body are never logged or returned** per the module
/// security contract.
#[tauri::command]
pub async fn crm_list_households() -> Result<Vec<CrmHouseholdDto>, String> {
    let token = read_token().ok_or_else(|| "not connected".to_string())?;
    let client = WealthboxClient::new(token);
    let contacts = client.list_households().await.map_err(|e| e.to_string())?;
    let dtos = contacts
        .iter()
        .map(|c| CrmHouseholdDto {
            id: c.id.to_string(),
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

        assert_eq!(map.len(), 2, "two distinct households must produce two entries");
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
        let map: HashMap<String, String> =
            entries.iter().map(|e| (e.household_id.clone(), e.matter_id.clone())).collect();
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
        let map: HashMap<String, String> =
            entries.iter().map(|e| (e.household_id.clone(), e.matter_id.clone())).collect();
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
        let firm_name = me
            .get("accounts")
            .and_then(|a| a.get(0))
            .and_then(|acc| acc.get("name"))
            .and_then(|n| n.as_str())
            .unwrap_or("");
        let user_name = me.get("name").and_then(|v| v.as_str()).unwrap_or("");
        let name = if !firm_name.is_empty() { firm_name } else { user_name }.to_string();
        let plan = me.get("plan").and_then(|v| v.as_str()).unwrap_or("").to_string();
        let email = me.get("email").and_then(|v| v.as_str()).unwrap_or("").to_string();
        CrmConnectInfo { name, plan, email }
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
        assert_eq!(info.name, "Northcrest Advisory",
            "accounts[0].name (firm) must be preferred over top-level name (user)");
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
        assert_eq!(info.name, "Northcrest Advisory",
            "user name is used as fallback when accounts is absent");
        assert_eq!(info.plan, "professional");
        assert_eq!(info.email, "advisor@northcrest.com");
    }

    /// Absent fields must fall back to "".
    #[test]
    fn parse_me_json_missing_fields_default_to_empty() {
        let me = serde_json::json!({ "id": 7 });
        let info = parse_me_to_info(&me);
        assert_eq!(info.name, "", "missing name + accounts must default to empty string");
        assert_eq!(info.plan, "", "missing 'plan' must default to empty string");
        assert_eq!(info.email, "", "missing 'email' must default to empty string");
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
        use crate::commands::crm::model::WbContact;
        let c = WbContact {
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
        use crate::commands::crm::model::WbContact;
        let c = WbContact {
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
        use crate::commands::crm::model::WbContact;
        let c = WbContact {
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
        use crate::commands::crm::model::WbContact;
        let c = WbContact {
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
        use crate::commands::crm::model::WbContact;
        let c = WbContact {
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
        use crate::commands::crm::model::WbContact;
        let c = WbContact {
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
        store.append(&rec2).expect("append wealthbox.disconnect entry");

        // List all entries and assert both wealthbox.* entries are present.
        let entries = store.list(None, None).expect("list audit entries");
        assert_eq!(entries.len(), 2, "two entries must be persisted");

        let connect_entry = entries.iter().find(|e| e.action == "wealthbox.connect");
        assert!(connect_entry.is_some(), "wealthbox.connect entry must be in the store");
        assert!(
            connect_entry.unwrap().action.starts_with("wealthbox."),
            "action must start with 'wealthbox.'"
        );
        assert!(
            connect_entry.unwrap().description.contains("Wealthbox"),
            "description must mention Wealthbox"
        );

        let disconnect_entry = entries.iter().find(|e| e.action == "wealthbox.disconnect");
        assert!(disconnect_entry.is_some(), "wealthbox.disconnect entry must be in the store");

        // Verify the chain is intact after both appends.
        use crate::commands::audit::store::AuditChainVerification;
        assert_eq!(
            store.verify_chain().unwrap(),
            AuditChainVerification::Verified { checked: 2 },
            "hash chain must be valid after two CRM audit appends"
        );
    }
}
