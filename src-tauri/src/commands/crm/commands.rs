//! Tauri commands for the Wealthbox CRM connector.
//!
//! Mirrors the mail connector's command/state/keychain patterns exactly.
//! Every `#[tauri::command]` returns `Result<T, String>`; anyhow errors are
//! converted at the IPC boundary.  Token values and raw API response bodies
//! are **never** logged or returned to the frontend.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::commands::audit::AuditState;
use crate::commands::crm::engine;
use crate::commands::crm::model::crm_key_belongs_to_provider;
use crate::commands::crm::provider::{
    CrmProvider, client_for, delete_token, read_token, store_token, validate_token,
};
use crate::commands::crm::redtail::RedtailClient;
use crate::commands::crm::salesforce::{
    SALESFORCE_TOKEN_ENDPOINT, SalesforceClient, build_salesforce_auth_url,
    exchange_salesforce_code, salesforce_client_id,
};
use crate::commands::crm::store::CrmStore;
use crate::commands::crm::write::{
    self, CrmWriteError, CrmWriteKind, CrmWriteRequest, WriteReceipt,
};

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
    /// Separate from `cancel` (which cancels an in-flight sync): lets the
    /// frontend abort a pending interactive OAuth sign-in (`crm_oauth_connect`'s
    /// wait for the browser redirect) without touching sync state. See
    /// `crm_oauth_connect_cancel`.
    pub oauth_cancel: Arc<AtomicBool>,
    /// Shared across every `crm_create_note`/`crm_create_task` call for the
    /// life of the running app — see `write::WriteInFlightGuard` for why this
    /// can't live on the per-call `CrmStore` instead.
    pub write_guard: write::WriteInFlightGuard,
    /// Count of `crm_create_note`/`crm_create_task` calls currently in
    /// flight (POST sent, ledger not yet settled). Disconnect waits for this
    /// to drain to zero before purging, mirroring how it already waits on
    /// `is_syncing` — otherwise a write started just before disconnect could
    /// still POST to Wealthbox (with the about-to-be-revoked token) while
    /// local state is mid-purge. See `WriteInFlightSlot`.
    pub write_in_flight: Arc<std::sync::atomic::AtomicUsize>,
    /// Set by disconnect before it waits for `write_in_flight` to drain; a
    /// NEW write checks this and refuses to start rather than racing a
    /// disconnect that's already underway.
    pub disconnect_requested: Arc<AtomicBool>,
}

pub fn manage_state(app: &tauri::App) {
    app.manage(CrmState {
        workspace: tokio::sync::Mutex::new(None),
        is_syncing: Arc::new(AtomicBool::new(false)),
        cancel: Arc::new(AtomicBool::new(false)),
        last_report: tokio::sync::Mutex::new(None),
        progress_households: Arc::new(std::sync::atomic::AtomicU32::new(0)),
        oauth_cancel: Arc::new(AtomicBool::new(false)),
        write_guard: write::WriteInFlightGuard::new(),
        write_in_flight: Arc::new(std::sync::atomic::AtomicUsize::new(0)),
        disconnect_requested: Arc::new(AtomicBool::new(false)),
    });
}

/// RAII guard: decrements `write_in_flight` when dropped, covering all exit
/// paths (normal return, early return via `?`, and panic) — pairs with the
/// increment in `crm_create_write`.
struct WriteInFlightSlot(Arc<std::sync::atomic::AtomicUsize>);
impl Drop for WriteInFlightSlot {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::SeqCst);
    }
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

fn provider_scoped_matter_entries(
    matter_map: &[CrmMatterMapEntry],
    provider: CrmProvider,
) -> HashMap<String, String> {
    let provider_id = provider.id();
    matter_map
        .iter()
        .filter(|entry| crm_key_belongs_to_provider(&entry.household_id, provider_id))
        .map(|entry| (entry.household_id.clone(), entry.matter_id.clone()))
        .collect()
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

/// Downgrade every `sent` outbound-write ledger row for `provider` to
/// `pending_verify` (see `CrmStore::mark_sent_rows_pending_verify_for_provider`).
/// Called from every successful connect path (`crm_connect`'s Redtail branch,
/// its token branch, and `crm_oauth_connect`'s OAuth branch) — a reconnect,
/// same account or a different one, means a `sent` row's proof of delivery no
/// longer holds, so the next write attempt for that content must re-verify
/// against whichever account is connected now rather than trust a stale
/// receipt. Best-effort: no workspace open yet (connecting before opening a
/// workspace) or a local DB hiccup is logged and does not fail the connect —
/// there is nothing to protect the ledger from before a workspace exists.
async fn mark_stale_sent_rows_pending_verify_best_effort(app: &AppHandle, provider: CrmProvider) {
    let ws_opt: Option<std::path::PathBuf> = {
        let audit_ws = app.state::<AuditState>().workspace.lock().await.clone();
        if audit_ws.is_some() {
            audit_ws
        } else {
            app.state::<CrmState>().workspace.lock().await.clone()
        }
    };
    let Some(ws) = ws_opt else {
        return;
    };
    let provider_id = provider.id();
    let result = tokio::task::spawn_blocking(move || -> anyhow::Result<usize> {
        let store = CrmStore::open(&ws)?;
        Ok(store.mark_sent_rows_pending_verify_for_provider(provider_id)?)
    })
    .await;
    match result {
        Ok(Ok(n)) if n > 0 => {
            log::info!("crm connect: downgraded {n} stale '{provider_id}' sent row(s) to pending_verify");
        }
        Ok(Ok(_)) => {}
        Ok(Err(e)) => log::warn!("crm connect: marking stale sent rows failed (non-fatal): {e:#}"),
        Err(e) => log::warn!("crm connect: marking stale sent rows spawn failed (non-fatal): {e}"),
    }
}

/// Matter-scoped variant of [`crm_audit_payload_json`] for writes that
/// originate from (and only affect) one client — the approval-gated CRM
/// write path (`crm_create_note` / `crm_create_task`), unlike connect/sync/
/// disconnect which are workspace-wide (`allMatters`).
fn crm_audit_payload_json_for_matter(
    id: &str,
    timestamp: &str,
    action: &str,
    description: &str,
    matter_id: &str,
) -> String {
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
            "scope": { "kind": "matter", "matterId": matter_id },
        },
    })
    .to_string()
}

/// Matter-scoped variant of [`append_crm_audit_best_effort`] — same
/// best-effort contract (never propagates to the calling command).
/// `write_dedup_key`: when `Some`, the audit entry's id is DETERMINISTIC
/// (derived from the write's own dedup key) instead of randomly generated.
/// `EncryptedAuditStore::append` is `INSERT OR IGNORE` on id — a deterministic
/// id makes re-auditing the SAME logical write idempotent-safe: a genuine
/// retry/dedup of an already-audited write silently no-ops (no duplicate
/// "pushed" entry), while a write that landed but whose process crashed
/// before this call ever ran gets audited for the first time on the very
/// next retry that recovers it, instead of never being audited at all.
async fn append_crm_audit_best_effort_for_matter(
    app: &AppHandle,
    action: &str,
    description: &str,
    matter_id: &str,
    write_dedup_key: Option<&str>,
) {
    use crate::commands::audit::store::{AuditEntryRecord, EncryptedAuditStore};

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
    let matter_id_s = matter_id.to_string();
    let write_dedup_key = write_dedup_key.map(str::to_string);

    let result = tokio::task::spawn_blocking(move || -> anyhow::Result<AuditEntryRecord> {
        let store = EncryptedAuditStore::open(&ws)?;

        let timestamp = chrono::Utc::now().to_rfc3339();
        let id = match &write_dedup_key {
            Some(key) => format!("audit_crmwrite_{key}"),
            None => {
                let nanos = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|d| d.as_nanos())
                    .unwrap_or_default();
                let mut rng_bytes = [0u8; 4];
                rand::RngCore::fill_bytes(&mut rand::thread_rng(), &mut rng_bytes);
                format!("audit_crm_{}_{}", nanos, hex::encode(rng_bytes))
            }
        };

        let payload_json =
            crm_audit_payload_json_for_matter(&id, &timestamp, &action_s, &desc_s, &matter_id_s);

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
            let _ = app.emit(CRM_AUDIT_APPENDED_EVENT, &rec);
        }
        Ok(Err(e)) => log::warn!("crm audit append failed (non-fatal): {e:#}"),
        Err(e) => log::warn!("crm audit spawn failed (non-fatal): {e}"),
    }
}


/// Push one approval-gated note to the connected CRM and record an audit entry.
///
/// The write only happens because the frontend's review card called this
/// command after an explicit user Approve click — there is no other call
/// site. `household_key` is resolved by the frontend from the matter's
/// `crmHouseholdKeys` (the backend does not persist the matter map).
///
/// `requested_at` identifies THIS approval event (an ISO timestamp the
/// frontend generates once, when the user clicks Approve) — see
/// `CrmWriteRequest`'s doc comment for why the idempotency ledger needs it:
/// without it, identical content approved on two separate occasions (e.g. a
/// recurring "Left voicemail" note) would collide into one dedup key
/// forever, and the second approval would be silently swallowed as a
/// "duplicate" of the first. The frontend must reuse the SAME value for any
/// automatic retry of this exact approval, and generate a NEW one for a
/// fresh approval — even of identical content.
#[tauri::command]
pub async fn crm_create_note(
    app: AppHandle,
    state: State<'_, CrmState>,
    matter_id: String,
    title: String,
    body: String,
    source_ref: String,
    household_key: String,
    requested_at: String,
    provider: Option<String>,
) -> Result<WriteReceipt, String> {
    crm_create_write(
        app,
        state,
        CrmWriteKind::Note,
        matter_id,
        title,
        body,
        None,
        source_ref,
        household_key,
        requested_at,
        provider,
    )
    .await
}

/// Push one approval-gated task to the connected CRM and record an audit entry.
/// See [`crm_create_note`] for the shared write-then-audit contract and the
/// `requested_at` contract.
#[tauri::command]
pub async fn crm_create_task(
    app: AppHandle,
    state: State<'_, CrmState>,
    matter_id: String,
    title: String,
    description: String,
    due_date: Option<String>,
    source_ref: String,
    household_key: String,
    requested_at: String,
    provider: Option<String>,
) -> Result<WriteReceipt, String> {
    crm_create_write(
        app,
        state,
        CrmWriteKind::Task,
        matter_id,
        title,
        description,
        due_date,
        source_ref,
        household_key,
        requested_at,
        provider,
    )
    .await
}

#[allow(clippy::too_many_arguments)]
async fn crm_create_write(
    app: AppHandle,
    state: State<'_, CrmState>,
    kind: CrmWriteKind,
    matter_id: String,
    title: String,
    body: String,
    due_date: Option<String>,
    source_ref: String,
    household_key: String,
    requested_at: String,
    provider: Option<String>,
) -> Result<WriteReceipt, String> {
    let provider = CrmProvider::from_optional(provider.as_deref())?;

    // Register as in-flight BEFORE reading the token, so a disconnect that's
    // already waiting on `write_in_flight` (see crm_disconnect_logic) sees us
    // and doesn't purge underneath this call. If disconnect got there first
    // (flag already set), bail immediately — better to reject the write than
    // POST with a token that's about to be revoked. The guard decrements on
    // every exit path (normal return, `?`, or panic).
    state.write_in_flight.fetch_add(1, Ordering::SeqCst);
    let _write_slot = WriteInFlightSlot(state.write_in_flight.clone());
    if state.disconnect_requested.load(Ordering::SeqCst) {
        return Err(format!(
            "{} is disconnecting — try again once reconnected",
            provider.display_name()
        ));
    }

    write::validate_write_inputs(&title, &body).map_err(|e| e.to_string())?;

    let token = read_token(provider).ok_or_else(|| {
        format!(
            "{} not connected — connect it in Account → Connections first",
            provider.display_name()
        )
    })?;

    let workspace = state
        .workspace
        .lock()
        .await
        .clone()
        .ok_or("workspace not set — call crm_set_workspace first")?;

    let store = CrmStore::open(&workspace).map_err(|e| e.to_string())?;
    let client = write::write_client_for(provider, token).map_err(|e| e.to_string())?;

    let req = CrmWriteRequest {
        kind,
        matter_id: matter_id.clone(),
        household_key: household_key.clone(),
        title,
        body,
        due_date,
        source_ref: source_ref.clone(),
        requested_at,
    };

    let action = provider.audit_action(match kind {
        CrmWriteKind::Note => "create_note",
        CrmWriteKind::Task => "create_task",
    });

    let write_dedup_key = write::dedup_key(&req);

    match write::push_crm_write(client.as_ref(), &store, &state.write_guard, &req).await {
        Ok(receipt) => {
            // The audit id is deterministic (see append_crm_audit_best_effort_for_matter)
            // and INSERT-OR-IGNORE at the store layer, so this is always safe
            // to call even on a deduped receipt: a genuine retry of an
            // already-audited write silently no-ops (no duplicate "pushed"
            // entry), but a write that landed and whose process crashed
            // BEFORE this call ever ran on its first attempt gets audited
            // for the first time right here, on the recovering retry —
            // instead of never being audited at all.
            let description = format!(
                "{} pushed to {} household {household_key} (source: {source_ref})",
                kind.as_str(),
                provider.display_name(),
            );
            append_crm_audit_best_effort_for_matter(
                &app,
                &action,
                &description,
                &matter_id,
                Some(&write_dedup_key),
            )
            .await;
            Ok(receipt)
        }
        // Wealthbox may already have accepted (even persisted) this write —
        // record that possibility now rather than leaving the audit trail
        // silent about a CRM change that may exist until a later retry
        // resolves it. Distinct id suffix from the confirmed case above, so
        // an eventual confirmation still gets its OWN audit entry rather
        // than being silently ignored as a duplicate of this ambiguous one.
        Err(CrmWriteError::VerifyPending) => {
            let description = format!(
                "{} MAY have been pushed to {} household {household_key} (source: {source_ref}) — delivery unconfirmed, will verify on retry",
                kind.as_str(),
                provider.display_name(),
            );
            append_crm_audit_best_effort_for_matter(
                &app,
                &action,
                &description,
                &matter_id,
                Some(&format!("{write_dedup_key}_ambiguous")),
            )
            .await;
            Err(CrmWriteError::VerifyPending.to_string())
        }
        Err(e) => Err(e.to_string()),
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
        mark_stale_sent_rows_pending_verify_best_effort(&app, provider).await;

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
    mark_stale_sent_rows_pending_verify_best_effort(&app, provider).await;

    // Emit durable audit — best-effort; uses AuditState workspace (same DB
    // that the Activity Log reads) so the entry appears immediately.
    append_crm_audit_best_effort(
        &app,
        &provider.audit_action("connect"),
        &format!(
            "Connected {}. API key stored locally; data requests go directly \
             from this device to {}, never through Advisor Prep Hero servers.",
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
    state: State<'_, CrmState>,
    provider: Option<String>,
) -> Result<CrmConnectInfo, String> {
    let provider = CrmProvider::from_optional(provider.as_deref())?;
    if provider != CrmProvider::Salesforce {
        return Err(format!(
            "{} uses a direct connect path, not OAuth.",
            provider.display_name()
        ));
    }

    // Reset from any prior cancelled/finished attempt before starting a new one.
    state.oauth_cancel.store(false, Ordering::SeqCst);
    let cancel = state.oauth_cancel.clone();

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
    let code = crate::commands::mail::gmail::oauth::await_redirect_code_or_cancel(
        listener,
        &state_token,
        std::time::Duration::from_secs(300),
        cancel.clone(),
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

    // Cancel can arrive while the token exchange (a network round trip) was
    // in flight — check again before persisting so a canceled flow never
    // leaves a stored credential behind, even though the redirect wait
    // itself already resolved successfully.
    let stored = serde_json::to_string(&tokens).map_err(|e| e.to_string())?;
    // Snapshot whatever was there before (if this is a reconnect over an
    // existing connection) so any cancel-rollback below restores THAT,
    // rather than always deleting — a canceled reconnect must not disconnect
    // an already-working account.
    let previous_token = read_token(provider);
    let rollback_token = |previous: &Option<String>| match previous {
        Some(prev) => { let _ = store_token(provider, prev); }
        None => { let _ = delete_token(provider); }
    };

    crate::commands::mail::gmail::oauth::store_or_rollback_on_cancel(
        &cancel,
        || store_token(provider, &stored),
        || rollback_token(&previous_token),
    )?;

    let info = SalesforceClient::new_with_token_endpoint(
        stored,
        client_id,
        SALESFORCE_TOKEN_ENDPOINT.to_string(),
    )
    .map_err(|e| e.to_string())?
    .identity()
    .await
    .map_err(|e| e.to_string())?;

    // Cancel can also arrive during the identity() call above (another
    // network round trip, and the token is already stored by this point) —
    // roll it back too so a canceled flow leaves NO credential behind
    // regardless of exactly when Cancel landed.
    if cancel.load(Ordering::SeqCst) {
        rollback_token(&previous_token);
        return Err("cancelled".to_string());
    }

    append_crm_audit_best_effort(
        &app,
        &provider.audit_action("connect"),
        &format!(
            "Connected {}. OAuth refresh token stored locally; data requests go directly \
             from this device to {}, never through Advisor Prep Hero servers.",
            provider.display_name(),
            provider.display_name()
        ),
    )
    .await;

    // The Cancel button stays live until this command settles, and the audit
    // append above is itself an awaited disk write — check one more time
    // before declaring success so a cancel during that write still rolls
    // back the credential instead of returning Ok with it still stored.
    //
    // The append-only audit log can never retract the "Connected" entry
    // written above, so a cancel landing here would otherwise leave the log
    // saying the connect succeeded even though it was rolled back. Write a
    // compensating entry so the log stays honest about the FINAL outcome.
    if cancel.load(Ordering::SeqCst) {
        // The outcome text must match what rollback_token actually does: a
        // fresh connect (no previous_token) ends up disconnected, but a
        // canceled RECONNECT restores the prior credential — the device is
        // still connected with that credential, not disconnected.
        let outcome = match &previous_token {
            Some(_) => "the new credential was discarded and the previous connection was restored".to_string(),
            None => format!("the new credential was removed and this device is not connected to {}", provider.display_name()),
        };
        rollback_token(&previous_token);
        append_crm_audit_best_effort(
            &app,
            &provider.audit_action("connect_cancelled"),
            &format!(
                "{} connect was cancelled after a new credential was briefly stored; {}.",
                provider.display_name(),
                outcome
            ),
        )
        .await;
        return Err("cancelled".to_string());
    }

    mark_stale_sent_rows_pending_verify_best_effort(&app, provider).await;

    Ok(CrmConnectInfo {
        name: info.name,
        plan: String::new(),
        email: info.email,
    })
}

/// Abort a pending `crm_oauth_connect` interactive sign-in immediately (e.g.
/// the user clicked Cancel on the "Connecting..." Salesforce button, or closed
/// the popup and gave up) instead of leaving them stuck on the 5-minute
/// server-side timeout. A no-op if no sign-in is in flight. Never touches an
/// already-working connection.
#[tauri::command]
pub async fn crm_oauth_connect_cancel(state: State<'_, CrmState>) -> Result<(), String> {
    state.oauth_cancel.store(true, Ordering::SeqCst);
    Ok(())
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

/// RAII guard: resets `disconnect_requested` to false when dropped, covering
/// every exit path — so an aborted/deferred disconnect never leaves new
/// writes permanently blocked.
struct DisconnectRequestedGuard(Arc<AtomicBool>);
impl Drop for DisconnectRequestedGuard {
    fn drop(&mut self) {
        self.0.store(false, Ordering::SeqCst);
    }
}

async fn crm_disconnect_logic_for_provider(
    state: &CrmState,
    provider: CrmProvider,
) -> CrmDisconnectResult {
    let mut result = CrmDisconnectResult::default();

    // Stop NEW writes from starting immediately; the wait loop below drains
    // any already-in-flight ones before we touch the token or local data —
    // otherwise a write started just before disconnect could still POST
    // with the about-to-be-revoked token while the purge runs underneath it.
    state.disconnect_requested.store(true, Ordering::SeqCst);
    let _disconnect_requested_guard = DisconnectRequestedGuard(state.disconnect_requested.clone());

    // P3 — stop any in-flight sync, drain in-flight writes, and CLAIM the
    // single-flight slot BEFORE purging, so nothing re-inserts CRM chunks or
    // posts a stray write after the purge starts and the DB file isn't
    // locked. Signal cancel, then spin until we win the slot AND no write is
    // in flight (a running sync releases the slot when it sees cancel
    // between matters; a running write releases its count on completion) or
    // a short timeout elapses.
    state.cancel.store(true, Ordering::SeqCst);
    let mut claimed = false;
    let mut waited_ms: u64 = 0;
    loop {
        let no_writes_in_flight = state.write_in_flight.load(Ordering::SeqCst) == 0;
        if no_writes_in_flight
            && state
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

    let mut no_crm_rows_remain = false;
    match purge_crm_data_for_provider(&ws, provider).await {
        Ok(outcome) => {
            result.rag_purged = true;
            result.crm_db_purged = true;
            no_crm_rows_remain = outcome.no_crm_rows_remain;
            if no_crm_rows_remain {
                match CrmStore::purge(&ws) {
                    Ok(()) => {}
                    Err(e) => {
                        result.crm_db_purged = false;
                        log::warn!("crm_disconnect: shared crm db purge failed (non-fatal): {e:#}");
                        result
                            .warnings
                            .push(format!("CRM database purge failed: {e}"));
                    }
                }
            }
        }
        Err(e) => {
            log::warn!(
                "crm_disconnect: {} purge failed (non-fatal): {e:#}",
                provider.display_name()
            );
            result.warnings.push(format!(
                "{} imported-data purge failed: {e}",
                provider.display_name()
            ));
        }
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
        if no_crm_rows_remain {
            if let Err(e) = CrmStore::delete_master_key() {
                log::warn!("crm_disconnect: crm db key deletion failed (non-fatal): {e:#}");
                result.warnings.push(format!(
                    "The CRM database encryption key could not be removed from the keychain: {e}"
                ));
            }
            // `CrmStore::purge` above already deleted the whole shared DB
            // file (nothing else has CRM data left), which took the
            // outbound-write ledger with it — nothing further to do here.
        } else {
            // The shared DB file survives (another CRM provider still has
            // data), so purge only THIS provider's outbound-write ledger
            // rows directly. Only reached once disconnect has actually
            // committed (this whole block is gated on rag_purged &&
            // crm_db_purged) — never before, so a failed disconnect can't
            // strand a connected account with its duplicate-protection
            // ledger already erased.
            match CrmStore::open(&ws) {
                Ok(store) => {
                    if let Err(e) = store.purge_outbound_writes_for_provider(provider.id()) {
                        log::warn!("crm_disconnect: outbound ledger purge failed (non-fatal): {e:#}");
                        result.warnings.push(format!(
                            "{} write history could not be fully cleared: {e}",
                            provider.display_name()
                        ));
                    }
                }
                Err(e) => {
                    log::warn!("crm_disconnect: could not open crm store to purge outbound ledger (non-fatal): {e:#}");
                }
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

#[derive(Debug, Clone, Copy)]
enum CrmProviderDataScope {
    LegacyWealthbox,
    ProviderMarker(&'static str),
}

#[derive(Debug, Clone, Copy, Default)]
struct ProviderCrmPurgeOutcome {
    no_crm_rows_remain: bool,
}

async fn purge_crm_data_for_provider(
    ws: &std::path::Path,
    provider: CrmProvider,
) -> anyhow::Result<ProviderCrmPurgeOutcome> {
    let store = CrmStore::open(ws)?;
    let key = crate::commands::rag::crypto::get_or_create_master_key()?;
    let scope = match provider {
        CrmProvider::Wealthbox => CrmProviderDataScope::LegacyWealthbox,
        CrmProvider::Salesforce => CrmProviderDataScope::ProviderMarker("sfdc:"),
        CrmProvider::Redtail => CrmProviderDataScope::ProviderMarker("redtail:"),
    };
    purge_provider_crm_data_with_store_and_key(ws, &store, scope, &key).await
}

async fn purge_provider_crm_data_with_store_and_key(
    ws: &std::path::Path,
    store: &CrmStore,
    scope: CrmProviderDataScope,
    rag_key: &[u8; 32],
) -> anyhow::Result<ProviderCrmPurgeOutcome> {
    let rows = match scope {
        CrmProviderDataScope::LegacyWealthbox => {
            store.list_legacy_wealthbox_objects_including_deleted()?
        }
        CrmProviderDataScope::ProviderMarker(marker) => {
            store.list_objects_by_provider_marker_including_deleted(marker)?
        }
    };
    let source_ids: Vec<String> = rows.iter().filter_map(crm_source_id_for_row).collect();

    let conn = crate::commands::rag::store::open_connection(ws).await?;
    let table = crate::commands::rag::store::open_or_create_table(&conn).await?;
    for source_id in source_ids {
        crate::commands::rag::store::delete_path(&table, &source_id, rag_key).await?;
    }

    match scope {
        CrmProviderDataScope::LegacyWealthbox => {
            store.purge_legacy_wealthbox_objects()?;
        }
        CrmProviderDataScope::ProviderMarker(marker) => {
            store.purge_objects_by_provider_marker(marker)?;
        }
    }

    Ok(ProviderCrmPurgeOutcome {
        no_crm_rows_remain: !store.has_any_objects_including_deleted()?,
    })
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
    let matter_hashmap = provider_scoped_matter_entries(&matter_map, provider);

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
            oauth_cancel: Arc::new(AtomicBool::new(false)),
            write_guard: write::WriteInFlightGuard::new(),
            write_in_flight: Arc::new(std::sync::atomic::AtomicUsize::new(0)),
            disconnect_requested: Arc::new(AtomicBool::new(false)),
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

    /// A disconnect must not purge/revoke while a write is still POSTing —
    /// it signals `disconnect_requested` (so no NEW write starts) and waits
    /// for `write_in_flight` to drain, mirroring how it already waits for a
    /// running sync. Here the "in-flight write" finishes shortly after
    /// disconnect starts waiting; disconnect must claim the slot and proceed
    /// (not defer), and must reset `disconnect_requested` afterward so a
    /// later write isn't stuck permanently blocked.
    #[tokio::test]
    async fn disconnect_waits_for_in_flight_write_to_drain_then_proceeds() {
        let state = test_state(false);
        state.write_in_flight.store(1, Ordering::SeqCst); // a write is "in flight"

        let write_in_flight = state.write_in_flight.clone();
        let disconnect_requested = state.disconnect_requested.clone();
        tokio::spawn(async move {
            while !disconnect_requested.load(Ordering::SeqCst) {
                tokio::time::sleep(std::time::Duration::from_millis(5)).await;
            }
            tokio::time::sleep(std::time::Duration::from_millis(20)).await;
            write_in_flight.store(0, Ordering::SeqCst);
        });

        let result = crm_disconnect_logic(&state).await;

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
            !state.disconnect_requested.load(Ordering::SeqCst),
            "disconnect_requested must be reset so a later write isn't stuck blocked"
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

    #[tokio::test]
    async fn salesforce_disconnect_purges_live_and_tombstoned_chunks_preserving_other_crms() {
        use crate::commands::mail::crypto::decrypt_with_key;
        use crate::commands::rag::chunker::{Chunk, chunk_text};
        use crate::commands::rag::embedder::EMBEDDING_DIM;
        use crate::commands::rag::store::{self, PRIVILEGE_NONE};
        use arrow_array::RecordBatchIterator;

        const RAG_KEY: [u8; 32] = [0x5Au8; 32];
        const CRM_KEY: [u8; 32] = [0x33u8; 32];
        const MATTER: &str = "matter-salesforce-disconnect";

        let workspace = tempfile::TempDir::new().unwrap();
        let crm = crate::commands::crm::store::CrmStore::open_with_key(workspace.path(), &CRM_KEY)
            .expect("open crm store");

        crm.upsert_object(
            "contact:10002",
            "person",
            "10001",
            "",
            "hash-wb-contact",
            r#"{"id":10002}"#,
        )
        .expect("upsert wealthbox contact");
        crm.upsert_object(
            "contact:sfdc:003LIVE:acct:001HH",
            "person",
            "sfdc:001HH",
            "",
            "hash-sf-live",
            r#"{"external_id":"sfdc:003LIVE:acct:001HH"}"#,
        )
        .expect("upsert salesforce live contact");
        crm.upsert_object(
            "contact:sfdc:003TOMBSTONED:acct:001HH",
            "person",
            "sfdc:001HH",
            "",
            "hash-sf-tombstoned",
            r#"{"external_id":"sfdc:003TOMBSTONED:acct:001HH"}"#,
        )
        .expect("upsert salesforce tombstone target");
        crm.tombstone_object("contact:sfdc:003TOMBSTONED:acct:001HH")
            .expect("tombstone salesforce row");
        crm.upsert_object(
            "contact:redtail:contact:66",
            "person",
            "redtail:family:7",
            "",
            "hash-redtail-live",
            r#"{"external_id":"redtail:contact:66"}"#,
        )
        .expect("upsert redtail contact");

        let conn = store::open_connection(workspace.path())
            .await
            .expect("open vector store");
        let table = store::open_or_create_table(&conn)
            .await
            .expect("open chunks table");
        let source_ids = [
            "crm:contact:10002",
            "crm:contact:sfdc:003LIVE:acct:001HH",
            "crm:contact:sfdc:003TOMBSTONED:acct:001HH",
            "crm:contact:redtail:contact:66",
        ];
        let mut rows: Vec<(Chunk, Vec<f32>)> = Vec::new();
        for source_id in source_ids {
            for chunk in chunk_text(source_id, &format!("CRM fixture for {source_id}")) {
                rows.push((chunk, vec![0.10f32; EMBEDDING_DIM]));
            }
        }
        let batch = store::build_batch_crm(&rows, &RAG_KEY, MATTER, PRIVILEGE_NONE)
            .expect("build crm batch");
        let schema = batch.schema();
        table
            .add(Box::new(RecordBatchIterator::new(vec![Ok(batch)], schema)))
            .execute()
            .await
            .expect("add crm chunks");

        purge_provider_crm_data_with_store_and_key(
            workspace.path(),
            &crm,
            CrmProviderDataScope::ProviderMarker("sfdc:"),
            &RAG_KEY,
        )
        .await
        .expect("purge salesforce provider data");

        assert!(
            crm.get_object("contact:10002").unwrap().is_some(),
            "Wealthbox CRM row must survive Salesforce disconnect"
        );
        assert!(
            crm.get_object("contact:redtail:contact:66")
                .unwrap()
                .is_some(),
            "Redtail CRM row must survive Salesforce disconnect"
        );
        assert!(
            crm.get_object("contact:sfdc:003LIVE:acct:001HH")
                .unwrap()
                .is_none(),
            "live Salesforce CRM row must be purged"
        );
        assert!(
            crm.get_object("contact:sfdc:003TOMBSTONED:acct:001HH")
                .unwrap()
                .is_none(),
            "tombstoned Salesforce CRM row must be purged"
        );

        let conn_after = store::open_connection(workspace.path())
            .await
            .expect("reopen vector store after purge");
        let table_after = store::open_or_create_table(&conn_after)
            .await
            .expect("reopen chunks table after purge");
        let hits = store::nearest(
            &table_after,
            &vec![0.10f32; EMBEDDING_DIM],
            20,
            Some(MATTER),
            false,
            &[],
        )
        .await
        .expect("nearest after salesforce purge");
        let paths: Vec<String> = hits
            .iter()
            .map(|hit| {
                let enc = hit.path_enc.as_deref().expect("crm hit has path_enc");
                let blob = hex::decode(enc).expect("path_enc hex");
                String::from_utf8(decrypt_with_key(&blob, &RAG_KEY).expect("decrypt path_enc"))
                    .expect("utf8 path")
            })
            .collect();
        assert!(
            paths.iter().any(|p| p == "crm:contact:10002"),
            "Wealthbox RAG chunk must survive Salesforce disconnect; got {paths:?}"
        );
        assert!(
            paths.iter().any(|p| p == "crm:contact:redtail:contact:66"),
            "Redtail RAG chunk must survive Salesforce disconnect; got {paths:?}"
        );
        assert!(
            !paths.iter().any(|p| p.contains("sfdc:")),
            "live and tombstoned Salesforce RAG chunks must be gone; got {paths:?}"
        );
    }

    #[tokio::test]
    async fn wealthbox_disconnect_purges_live_and_tombstoned_chunks_preserving_other_crms() {
        use crate::commands::mail::crypto::decrypt_with_key;
        use crate::commands::rag::chunker::{Chunk, chunk_text};
        use crate::commands::rag::embedder::EMBEDDING_DIM;
        use crate::commands::rag::store::{self, PRIVILEGE_NONE};
        use arrow_array::RecordBatchIterator;

        const RAG_KEY: [u8; 32] = [0x5Bu8; 32];
        const CRM_KEY: [u8; 32] = [0x34u8; 32];
        const MATTER: &str = "matter-wealthbox-disconnect";

        let workspace = tempfile::TempDir::new().unwrap();
        let crm = crate::commands::crm::store::CrmStore::open_with_key(workspace.path(), &CRM_KEY)
            .expect("open crm store");

        crm.upsert_object(
            "contact:10002",
            "person",
            "10001",
            "",
            "hash-wb-live",
            r#"{"id":10002}"#,
        )
        .expect("upsert wealthbox live contact");
        crm.upsert_object(
            "note:20002",
            "note",
            "10001",
            "",
            "hash-wb-tombstoned",
            r#"{"id":20002}"#,
        )
        .expect("upsert wealthbox tombstone target");
        crm.tombstone_object("note:20002")
            .expect("tombstone wealthbox row");
        crm.upsert_object(
            "contact:sfdc:003LIVE:acct:001HH",
            "person",
            "sfdc:001HH",
            "",
            "hash-sf-live",
            r#"{"external_id":"sfdc:003LIVE:acct:001HH"}"#,
        )
        .expect("upsert salesforce contact");
        crm.upsert_object(
            "contact:redtail:contact:66",
            "person",
            "redtail:family:7",
            "",
            "hash-redtail-live",
            r#"{"external_id":"redtail:contact:66"}"#,
        )
        .expect("upsert redtail contact");

        let conn = store::open_connection(workspace.path())
            .await
            .expect("open vector store");
        let table = store::open_or_create_table(&conn)
            .await
            .expect("open chunks table");
        let source_ids = [
            "crm:contact:10002",
            "crm:note:20002",
            "crm:contact:sfdc:003LIVE:acct:001HH",
            "crm:contact:redtail:contact:66",
        ];
        let mut rows: Vec<(Chunk, Vec<f32>)> = Vec::new();
        for source_id in source_ids {
            for chunk in chunk_text(source_id, &format!("CRM fixture for {source_id}")) {
                rows.push((chunk, vec![0.11f32; EMBEDDING_DIM]));
            }
        }
        let batch = store::build_batch_crm(&rows, &RAG_KEY, MATTER, PRIVILEGE_NONE)
            .expect("build crm batch");
        let schema = batch.schema();
        table
            .add(Box::new(RecordBatchIterator::new(vec![Ok(batch)], schema)))
            .execute()
            .await
            .expect("add crm chunks");

        let outcome = purge_provider_crm_data_with_store_and_key(
            workspace.path(),
            &crm,
            CrmProviderDataScope::LegacyWealthbox,
            &RAG_KEY,
        )
        .await
        .expect("purge wealthbox provider data");

        assert!(
            !outcome.no_crm_rows_remain,
            "shared CRM DB/key must stay while Salesforce and Redtail rows remain"
        );
        assert!(
            crm.get_object("contact:10002").unwrap().is_none(),
            "live Wealthbox CRM row must be purged"
        );
        assert!(
            crm.get_object("note:20002").unwrap().is_none(),
            "tombstoned Wealthbox CRM row must be purged"
        );
        assert!(
            crm.get_object("contact:sfdc:003LIVE:acct:001HH")
                .unwrap()
                .is_some(),
            "Salesforce CRM row must survive Wealthbox disconnect"
        );
        assert!(
            crm.get_object("contact:redtail:contact:66")
                .unwrap()
                .is_some(),
            "Redtail CRM row must survive Wealthbox disconnect"
        );

        let conn_after = store::open_connection(workspace.path())
            .await
            .expect("reopen vector store after purge");
        let table_after = store::open_or_create_table(&conn_after)
            .await
            .expect("reopen chunks table after purge");
        let hits = store::nearest(
            &table_after,
            &vec![0.11f32; EMBEDDING_DIM],
            20,
            Some(MATTER),
            false,
            &[],
        )
        .await
        .expect("nearest after wealthbox purge");
        let paths: Vec<String> = hits
            .iter()
            .map(|hit| {
                let enc = hit.path_enc.as_deref().expect("crm hit has path_enc");
                let blob = hex::decode(enc).expect("path_enc hex");
                String::from_utf8(decrypt_with_key(&blob, &RAG_KEY).expect("decrypt path_enc"))
                    .expect("utf8 path")
            })
            .collect();
        assert!(
            paths
                .iter()
                .any(|p| p == "crm:contact:sfdc:003LIVE:acct:001HH"),
            "Salesforce RAG chunk must survive Wealthbox disconnect; got {paths:?}"
        );
        assert!(
            paths.iter().any(|p| p == "crm:contact:redtail:contact:66"),
            "Redtail RAG chunk must survive Wealthbox disconnect; got {paths:?}"
        );
        assert!(
            !paths
                .iter()
                .any(|p| p == "crm:contact:10002" || p == "crm:note:20002"),
            "live and tombstoned Wealthbox RAG chunks must be gone; got {paths:?}"
        );
    }

    #[tokio::test]
    async fn redtail_disconnect_purges_live_and_tombstoned_chunks_preserving_other_crms() {
        use crate::commands::mail::crypto::decrypt_with_key;
        use crate::commands::rag::chunker::{Chunk, chunk_text};
        use crate::commands::rag::embedder::EMBEDDING_DIM;
        use crate::commands::rag::store::{self, PRIVILEGE_NONE};
        use arrow_array::RecordBatchIterator;

        const RAG_KEY: [u8; 32] = [0x5Au8; 32];
        const CRM_KEY: [u8; 32] = [0x33u8; 32];
        const MATTER: &str = "matter-redtail-disconnect";

        let workspace = tempfile::TempDir::new().unwrap();
        let crm = crate::commands::crm::store::CrmStore::open_with_key(workspace.path(), &CRM_KEY)
            .expect("open crm store");

        crm.upsert_object(
            "contact:10002",
            "person",
            "10001",
            "",
            "hash-wb-contact",
            r#"{"id":10002}"#,
        )
        .expect("upsert wealthbox contact");
        crm.upsert_object(
            "contact:sfdc:003LIVE:acct:001HH",
            "person",
            "sfdc:001HH",
            "",
            "hash-sf-live",
            r#"{"external_id":"sfdc:003LIVE:acct:001HH"}"#,
        )
        .expect("upsert salesforce live contact");
        crm.upsert_object(
            "contact:redtail:contact:66",
            "person",
            "redtail:family:7",
            "",
            "hash-redtail-live",
            r#"{"external_id":"redtail:contact:66"}"#,
        )
        .expect("upsert redtail live contact");
        crm.upsert_object(
            "note:redtail:note:2",
            "note",
            "redtail:family:7",
            "",
            "hash-redtail-tombstoned",
            r#"{"external_id":"redtail:note:2"}"#,
        )
        .expect("upsert redtail tombstone target");
        crm.tombstone_object("note:redtail:note:2")
            .expect("tombstone redtail row");

        let conn = store::open_connection(workspace.path())
            .await
            .expect("open vector store");
        let table = store::open_or_create_table(&conn)
            .await
            .expect("open chunks table");
        let source_ids = [
            "crm:contact:10002",
            "crm:contact:sfdc:003LIVE:acct:001HH",
            "crm:contact:redtail:contact:66",
            "crm:note:redtail:note:2",
        ];
        let mut rows: Vec<(Chunk, Vec<f32>)> = Vec::new();
        for source_id in source_ids {
            for chunk in chunk_text(source_id, &format!("CRM fixture for {source_id}")) {
                rows.push((chunk, vec![0.10f32; EMBEDDING_DIM]));
            }
        }
        let batch = store::build_batch_crm(&rows, &RAG_KEY, MATTER, PRIVILEGE_NONE)
            .expect("build mixed crm batch");
        let schema = batch.schema();
        table
            .add(Box::new(RecordBatchIterator::new(vec![Ok(batch)], schema)))
            .execute()
            .await
            .expect("add crm chunks");

        let outcome = purge_provider_crm_data_with_store_and_key(
            workspace.path(),
            &crm,
            CrmProviderDataScope::ProviderMarker("redtail:"),
            &RAG_KEY,
        )
        .await
        .expect("purge redtail provider data");

        assert!(
            !outcome.no_crm_rows_remain,
            "shared CRM DB/key must stay while Wealthbox and Salesforce rows remain"
        );
        assert!(
            crm.get_object("contact:10002").unwrap().is_some(),
            "Wealthbox CRM row must survive Redtail disconnect"
        );
        assert!(
            crm.get_object("contact:sfdc:003LIVE:acct:001HH")
                .unwrap()
                .is_some(),
            "Salesforce CRM row must survive Redtail disconnect"
        );
        assert!(
            crm.get_object("contact:redtail:contact:66")
                .unwrap()
                .is_none(),
            "live Redtail CRM row must be purged"
        );
        assert!(
            crm.get_object("note:redtail:note:2").unwrap().is_none(),
            "tombstoned Redtail CRM row must be purged"
        );

        let conn_after = store::open_connection(workspace.path())
            .await
            .expect("reopen vector store after purge");
        let table_after = store::open_or_create_table(&conn_after)
            .await
            .expect("reopen chunks table after purge");
        let hits = store::nearest(
            &table_after,
            &vec![0.10f32; EMBEDDING_DIM],
            20,
            Some(MATTER),
            false,
            &[],
        )
        .await
        .expect("nearest after redtail purge");
        let paths: Vec<String> = hits
            .iter()
            .map(|hit| {
                let enc = hit.path_enc.as_deref().expect("crm hit has path_enc");
                let blob = hex::decode(enc).expect("path_enc hex");
                String::from_utf8(decrypt_with_key(&blob, &RAG_KEY).expect("decrypt path_enc"))
                    .expect("utf8 path")
            })
            .collect();
        assert!(
            paths.iter().any(|p| p == "crm:contact:10002"),
            "Wealthbox RAG chunk must survive Redtail disconnect; got {paths:?}"
        );
        assert!(
            paths
                .iter()
                .any(|p| p == "crm:contact:sfdc:003LIVE:acct:001HH"),
            "Salesforce RAG chunk must survive Redtail disconnect; got {paths:?}"
        );
        assert!(
            !paths.iter().any(|p| p.contains("redtail:")),
            "live and tombstoned Redtail RAG chunks must be gone; got {paths:?}"
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

    #[test]
    fn sync_entry_path_filters_matter_map_to_current_provider() {
        let entries = vec![
            CrmMatterMapEntry {
                household_id: "10001".to_string(),
                matter_id: "matter-wealthbox".to_string(),
            },
            CrmMatterMapEntry {
                household_id: "sfdc:001HH0000000001AAA".to_string(),
                matter_id: "matter-salesforce".to_string(),
            },
            CrmMatterMapEntry {
                household_id: "redtail:rt-household".to_string(),
                matter_id: "matter-redtail".to_string(),
            },
        ];

        let salesforce = provider_scoped_matter_entries(&entries, CrmProvider::Salesforce);
        assert_eq!(salesforce.len(), 1);
        assert_eq!(
            salesforce
                .get("sfdc:001HH0000000001AAA")
                .map(String::as_str),
            Some("matter-salesforce")
        );
        assert!(!salesforce.contains_key("10001"));
        assert!(!salesforce.contains_key("redtail:rt-household"));

        let wealthbox = provider_scoped_matter_entries(&entries, CrmProvider::Wealthbox);
        assert_eq!(wealthbox.len(), 1);
        assert_eq!(
            wealthbox.get("10001").map(String::as_str),
            Some("matter-wealthbox")
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
                           directly from this device to Wealthbox, never through Advisor Prep Hero servers."
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
