//! Tauri commands for the CRM provider connector feature.
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
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::commands::audit::AuditState;
use crate::commands::crm::commands::CrmState;
use crate::commands::crm::engine;
use crate::commands::crm::model::crm_key_belongs_to_provider;
use crate::commands::crm::provider::{
    client_for, delete_token, read_token, store_token, validate_token, CrmProvider,
};
use crate::commands::crm::redtail::RedtailClient;
use crate::commands::crm::salesforce::{
    build_salesforce_auth_url, exchange_salesforce_code, salesforce_client_id, SalesforceClient,
    SALESFORCE_TOKEN_ENDPOINT,
};
use crate::commands::crm::store::{
    crm_store_user_message, is_crm_store_recovery_required, CrmStore, PendingCrmProposal,
};
use crate::commands::crm::write::{
    self, CrmWriteError, CrmWriteKind, CrmWriteRequest, WriteReceipt,
};

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

/// Wait for a sync job, or request its cooperative cancellation at `timeout`.
/// Crucially, this does not drop `work`: after signalling cancellation it awaits
/// the same future to its safe exit point.  That is what keeps the single-flight
/// lock held until an active `spawn_blocking` embedding batch has joined.
async fn await_sync_or_stop<T, F, H>(
    cancel: &AtomicBool,
    timeout: std::time::Duration,
    work: F,
    on_timeout: H,
) -> (bool, T)
where
    F: std::future::Future<Output = T>,
    H: FnOnce(),
{
    tokio::pin!(work);
    tokio::select! {
        result = &mut work => (false, result),
        _ = tokio::time::sleep(timeout) => {
            cancel.store(true, Ordering::SeqCst);
            on_timeout();
            (true, work.await)
        }
    }
}

/// Stop a progress task before emitting a terminal state.  Awaiting the aborted
/// task closes the race where a queued "syncing" event repaints the UI after a
/// final error or cancellation event.
async fn stop_progress_emitter(emitter: tokio::task::JoinHandle<()>) {
    emitter.abort();
    let _ = emitter.await;
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

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CrmProposalAiSourceDto {
    pub kind: String,
    pub date: Option<String>,
}

/// Renderer DTO for a CRM write proposal. This is allowed to contain proposed
/// note/task/field content because it only saves into the encrypted Rust CRM
/// store; it never calls the provider.
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CrmWriteProposalDto {
    pub id: String,
    pub kind: String,
    pub matter_id: String,
    pub title: String,
    pub body: String,
    pub due_date: Option<String>,
    pub source_ref: String,
    pub status: Option<String>,
    pub remote_id: Option<String>,
    pub error: Option<String>,
    pub requested_at: Option<String>,
    pub field: Option<String>,
    pub existing_value: Option<String>,
    pub new_value: Option<String>,
    pub final_value: Option<String>,
    pub provenance: Option<String>,
    pub meeting_visibility: Option<serde_json::Value>,
    pub ai_source: Option<CrmProposalAiSourceDto>,
    pub household_key: Option<String>,
    pub provider: Option<String>,
}

/// Proposal record returned to the renderer for the review queue. It includes
/// the content preview because the database at rest is SQLCipher-encrypted.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CrmWriteProposalRecordDto {
    pub id: String,
    pub kind: String,
    pub matter_id: String,
    pub title: String,
    pub body: String,
    pub due_date: Option<String>,
    pub source_ref: String,
    pub status: String,
    pub remote_id: Option<String>,
    pub error: Option<String>,
    pub requested_at: Option<String>,
    pub field: Option<String>,
    pub existing_value: Option<String>,
    pub new_value: Option<String>,
    pub final_value: Option<String>,
    pub provenance: Option<String>,
    pub meeting_visibility: Option<serde_json::Value>,
    pub ai_source: Option<CrmProposalAiSourceDto>,
    pub household_key: String,
    pub provider: String,
    pub content_hash: String,
    pub created_at: String,
    pub updated_at: String,
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

/// Every renderer event belongs to exactly one user-initiated import. This
/// stops a late event from an abandoned request from overwriting a newer run.
fn emit_crm_progress(app: &AppHandle, run_id: &str, mut payload: serde_json::Value) {
    if let Some(event) = payload.as_object_mut() {
        event.insert(
            "runId".to_string(),
            serde_json::Value::String(run_id.to_string()),
        );
    }
    let _ = app.emit(CRM_SYNC_PROGRESS_EVENT, payload);
}

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
            app.state::<CrmState>().service().optional_workspace().await
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

/// Wait (bounded, 10s — matching `crm_disconnect_logic_for_provider`'s own
/// `is_syncing` wait budget) for any write ALREADY in flight to finish
/// BEFORE a connect path overwrites the token and downgrades the ledger.
/// Returns `true` once drained, `false` on timeout.
///
/// The caller MUST refuse to proceed (not swap the token) on `false` rather
/// than proceeding anyway — `post_json` can legitimately keep a write alive
/// far longer than 10s under heavy 429 throttling (`MAX_429_RETRIES` = 6,
/// each capped at `MAX_RETRY_AFTER_SECS` = 120s), so a short wait can easily
/// time out during a perfectly healthy, still-in-progress write. Blocking
/// the connect command for the many minutes that would take to rule out
/// is worse UX than failing fast and asking the user to try again shortly
/// (the same trade-off `crm_disconnect_logic_for_provider` already makes:
/// short wait, then defer rather than either a long hang or an unsafe
/// proceed).
///
/// This only handles writes that started before the connect did — new ones
/// are blocked separately by `connect_in_progress`/`ConnectInProgressGuard`
/// (set by the caller before this runs). Without BOTH halves, a write that
/// read the OLD token just before (or during) a reconnect could still
/// complete (successfully, against the OLD account) AFTER the downgrade
/// already ran — recording a fresh `sent` row with a NEW `created_at` that
/// the downgrade never touched, so a later retry would wrongly trust it as
/// proof of delivery to the NEWLY connected account, when it was actually
/// delivered to the old one.
async fn wait_for_writes_to_drain(state: &CrmState) -> bool {
    let mut waited_ms: u64 = 0;
    while state.write_in_flight.load(Ordering::SeqCst) > 0 {
        if waited_ms >= 10_000 {
            return false;
        }
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        waited_ms += 50;
    }
    true
}

/// Wait (bounded, 10s, same budget/poll as `wait_for_writes_to_drain`) for
/// an in-progress connect/reconnect to finish. Used by `crm_set_workspace`
/// when it can't claim `connect_in_progress` itself (self-converge, review
/// findings on lp/crm-9c-rust) — a plain "can't claim it, just mark this
/// provider unconfirmed and move on" was racy: if the concurrent connect's
/// OWN downgrade check finished and cleared `downgrade_unconfirmed` for
/// this provider BEFORE `crm_set_workspace`'s insert landed, the insert
/// would silently override that fresh confirmation, leaving writes blocked
/// with no path to recovery short of another workspace-open or connect.
/// Waiting first means `crm_set_workspace` runs its OWN downgrade check
/// strictly AFTER the other connect finishes — sequencing instead of
/// racing, so whichever check's result lands last reflects the current
/// truth rather than two concurrent inserts/removes interleaving
/// unpredictably.
async fn wait_for_connect_in_progress_to_clear(state: &CrmState) -> bool {
    let mut waited_ms: u64 = 0;
    while state.connect_in_progress.load(Ordering::SeqCst) {
        if waited_ms >= 10_000 {
            return false;
        }
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        waited_ms += 50;
    }
    true
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
/// Returns `true` if there's nothing to protect yet (no workspace open) OR
/// the downgrade is CONFIRMED to have succeeded; `false` if a workspace
/// exists but the downgrade could not be confirmed after retries. Every
/// `crm_connect`/`crm_oauth_connect` success path calls this BEFORE storing
/// the new token and MUST refuse the connect (return Err, token untouched)
/// on `false` — see `downgrade_stale_sent_rows_for_workspace`'s doc comment
/// for why this ordering avoids needing any rollback plumbing.
async fn confirm_stale_sent_rows_downgraded(app: &AppHandle, provider: CrmProvider) -> bool {
    // Connect can happen before ANY workspace is ever opened (e.g. from a
    // general Account/Connections screen) — in that case there's no ledger
    // to touch yet. `crm_set_workspace` runs the SAME downgrade for whichever
    // provider is already connected, closing the other half of this
    // ordering: connect-with-no-workspace, then later open a workspace that
    // has stale 'sent' rows from a past connection.
    let ws_opt: Option<std::path::PathBuf> = {
        let audit_ws = app.state::<AuditState>().workspace.lock().await.clone();
        if audit_ws.is_some() {
            audit_ws
        } else {
            app.state::<CrmState>().service().optional_workspace().await
        }
    };
    let Some(ws) = ws_opt else {
        return true;
    };
    let confirmed = downgrade_stale_sent_rows_for_workspace(ws, provider, "crm connect").await;
    if confirmed {
        // A confirmed downgrade here also resolves any EARLIER
        // crm_set_workspace failure for THIS provider (same underlying
        // safety property) — remove just this provider's id so writes for
        // it aren't left blocked by a since-superseded failure. Per-
        // provider, not a global clear: an unrelated provider's still-
        // unconfirmed downgrade must be untouched.
        app.state::<CrmState>()
            .downgrade_unconfirmed
            .lock()
            .await
            .remove(provider.id());
    }
    confirmed
}

/// Shared core of the stale-`sent`-row downgrade (see
/// `CrmStore::mark_sent_rows_pending_verify_for_provider`) — called from
/// every `crm_connect`/`crm_oauth_connect` success path (via
/// `confirm_stale_sent_rows_downgraded`, which resolves the workspace path
/// from app state and gates the token store on this returning `true`) AND
/// from `crm_set_workspace` (which already has the path directly, covering
/// the reverse ordering: a connect that happened before any workspace was
/// open — that call site stays best-effort; there's no in-flight connect to
/// refuse there, just an already-open workspace).
///
/// Retries a few times against a TRANSIENT failure (the most realistic real
/// cause — e.g. another operation briefly holding the SQLite file lock)
/// before giving up.
///
/// A workspace-open connect leaving stale 'sent' rows un-downgraded is a
/// failed safety-critical write, not a "nothing to protect" case — so on
/// persistent (non-transient) failure the CONNECT call sites refuse the
/// connect (return `false`) rather than proceeding with a token swap the
/// old 'sent' rows can't be trusted to survive. This is what makes a
/// rollback unnecessary: the downgrade is confirmed BEFORE the token is
/// ever stored, so a failure here means nothing has changed yet — there's
/// nothing to roll back.
async fn downgrade_stale_sent_rows_for_workspace(
    ws: std::path::PathBuf,
    provider: CrmProvider,
    caller: &'static str,
) -> bool {
    let provider_id = provider.id();
    const ATTEMPTS: u32 = 3;
    let mut last_err: Option<anyhow::Error> = None;
    for attempt in 0..ATTEMPTS {
        if attempt > 0 {
            tokio::time::sleep(std::time::Duration::from_millis(200)).await;
        }
        let ws = ws.clone();
        let result = tokio::task::spawn_blocking(move || -> anyhow::Result<usize> {
            let store = CrmStore::open(&ws)?;
            Ok(store.mark_sent_rows_pending_verify_for_provider(provider_id)?)
        })
        .await;
        match result {
            Ok(Ok(n)) => {
                if n > 0 {
                    log::info!(
                        "{caller}: downgraded {n} stale '{provider_id}' sent row(s) to pending_verify"
                    );
                }
                return true;
            }
            Ok(Err(e)) => last_err = Some(e),
            Err(e) => last_err = Some(anyhow::anyhow!("spawn failed: {e}")),
        }
    }
    if let Some(e) = last_err {
        log::warn!(
            "{caller}: marking stale sent rows failed after {ATTEMPTS} attempts — any 'sent' \
             rows for '{provider_id}' remain un-downgraded: {e:#}"
        );
    }
    false
}

/// Matter-scoped variant of [`crm_audit_payload_json`] for writes that
/// originate from (and only affect) one client — the approval-gated CRM
/// write path (`crm_approve_write_proposal`), unlike connect/sync/
/// disconnect which are workspace-wide (`allMatters`).
fn crm_audit_payload_json_for_matter(
    id: &str,
    timestamp: &str,
    action: &str,
    description: &str,
    matter_id: &str,
    audit_phase: &str,
    audit_pair_id: &str,
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
            "auditPhase": audit_phase,
            "auditPairId": audit_pair_id,
            "auditMustPersist": true,
            "auditPersistenceStatus": "saved",
        },
    })
    .to_string()
}

fn crm_audit_failure_message(audit_phase: &str, detail: Option<String>) -> String {
    let base = if audit_phase == "intent" {
        "Audit log is unavailable, so the CRM write was blocked before anything was sent."
            .to_string()
    } else {
        "Audit log is unavailable after the CRM write attempt; the CRM result could not be recorded durably."
            .to_string()
    };
    match detail {
        Some(detail) => format!("{base}: {detail}"),
        None => base,
    }
}

/// Matter-scoped CRM write audit append that must persist.
///
/// Compliance-critical CRM writes call this with `audit_phase = "intent"`
/// BEFORE contacting the CRM. If that append fails, the caller refuses the
/// write, so no CRM mutation can happen without a durable audit row.
/// `write_dedup_key`: when `Some`, the audit entry's id is DETERMINISTIC
/// (derived from the write's own dedup key) instead of randomly generated.
/// `EncryptedAuditStore::append` is `INSERT OR IGNORE` on id — a deterministic
/// id makes re-auditing the SAME logical write idempotent-safe: a genuine
/// retry/dedup of an already-audited write silently no-ops (no duplicate
/// "pushed" entry), while a write that landed but whose process crashed
/// before this call ever ran gets audited for the first time on the very
/// next retry that recovers it, instead of never being audited at all.
async fn append_crm_audit_must_for_matter(
    app: &AppHandle,
    action: &str,
    description: &str,
    matter_id: &str,
    write_dedup_key: Option<&str>,
    audit_phase: &str,
    audit_pair_id: &str,
) -> Result<(), String> {
    use crate::commands::audit::store::{AuditEntryRecord, EncryptedAuditStore};

    let ws_opt: Option<std::path::PathBuf> = {
        let audit_ws = app.state::<AuditState>().workspace.lock().await.clone();
        if audit_ws.is_some() {
            audit_ws
        } else {
            app.state::<CrmState>().service().optional_workspace().await
        }
    };
    let Some(ws) = ws_opt else {
        return Err(crm_audit_failure_message(audit_phase, None));
    };

    let action_s = action.to_string();
    let desc_s = description.to_string();
    let matter_id_s = matter_id.to_string();
    let write_dedup_key = write_dedup_key.map(str::to_string);
    let audit_phase_s = audit_phase.to_string();
    let audit_phase_for_error = audit_phase_s.clone();
    let audit_pair_id_s = audit_pair_id.to_string();

    let result = tokio::task::spawn_blocking(move || -> anyhow::Result<AuditEntryRecord> {
        let store = EncryptedAuditStore::open(&ws)?;

        let timestamp = chrono::Utc::now().to_rfc3339();
        let id = match &write_dedup_key {
            Some(key) => format!("audit_crmwrite_{key}_{audit_phase_s}"),
            None => {
                let nanos = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|d| d.as_nanos())
                    .unwrap_or_default();
                let mut rng_bytes = [0u8; 4];
                rand::RngCore::fill_bytes(&mut rand::thread_rng(), &mut rng_bytes);
                format!(
                    "audit_crm_{}_{}_{}",
                    audit_phase_s,
                    nanos,
                    hex::encode(rng_bytes)
                )
            }
        };

        let payload_json = crm_audit_payload_json_for_matter(
            &id,
            &timestamp,
            &action_s,
            &desc_s,
            &matter_id_s,
            &audit_phase_s,
            &audit_pair_id_s,
        );

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
            Ok(())
        }
        Ok(Err(e)) => Err(crm_audit_failure_message(
            &audit_phase_for_error,
            Some(format!("{e:#}")),
        )),
        Err(e) => Err(crm_audit_failure_message(
            &audit_phase_for_error,
            Some(e.to_string()),
        )),
    }
}

async fn crm_store_from_state(state: &State<'_, CrmState>) -> Result<CrmStore, String> {
    let workspace = state
        .service()
        .optional_workspace()
        .await
        .ok_or("workspace not set — call crm_set_workspace first")?;
    CrmStore::open(&workspace).map_err(|e| e.to_string())
}

fn proposal_hash_part(h: &mut Sha256, value: Option<&str>) {
    if let Some(value) = value {
        h.update(value.as_bytes());
    }
    h.update([0u8]);
}

fn crm_proposal_content_hash(proposal: &PendingCrmProposal) -> String {
    let mut h = Sha256::new();
    for part in [
        Some(proposal.provider.as_str()),
        Some(proposal.kind.as_str()),
        Some(proposal.matter_id.as_str()),
        Some(proposal.household_key.as_str()),
        Some(proposal.title.as_str()),
        Some(proposal.body.as_str()),
        proposal.due_date.as_deref(),
        Some(proposal.source_ref.as_str()),
        proposal.requested_at.as_deref(),
        proposal.field.as_deref(),
        proposal.existing_value.as_deref(),
        proposal.new_value.as_deref(),
        proposal.final_value.as_deref(),
        proposal.provenance.as_deref(),
        proposal.ai_source_kind.as_deref(),
        proposal.ai_source_date.as_deref(),
    ] {
        proposal_hash_part(&mut h, part);
    }
    // Keep the old hash byte-for-byte stable when no visibility field exists,
    // while binding every new structured lineage into the approval hash.
    if let Some(value) = proposal.meeting_visibility_json.as_deref() {
        proposal_hash_part(&mut h, Some(value));
    }
    hex::encode(h.finalize())
}

fn validate_crm_proposal_status(status: Option<String>) -> Result<String, String> {
    let status = status.unwrap_or_else(|| "proposed".to_string());
    match status.as_str() {
        "proposed" | "sending" | "sent" | "failed" | "verify_pending" | "stale" => Ok(status),
        _ => Err("invalid CRM proposal status".to_string()),
    }
}

fn crm_proposal_from_dto(dto: CrmWriteProposalDto) -> Result<PendingCrmProposal, String> {
    let provider = CrmProvider::from_optional(dto.provider.as_deref())?;
    let kind = match dto.kind.as_str() {
        "note" | "task" | "field" => dto.kind.clone(),
        _ => return Err("invalid CRM proposal kind".to_string()),
    };
    if dto.id.trim().is_empty() {
        return Err("CRM proposal id is required".to_string());
    }
    if dto.matter_id.trim().is_empty() {
        return Err("CRM proposal matter id is required".to_string());
    }
    if dto.source_ref.trim().is_empty() {
        return Err("CRM proposal source is required".to_string());
    }

    let ai_source_kind = dto.ai_source.as_ref().map(|s| s.kind.clone());
    let ai_source_date = dto.ai_source.as_ref().and_then(|s| s.date.clone());
    let meeting_visibility_json = dto
        .meeting_visibility
        .map(|value| serde_json::to_string(&value))
        .transpose()
        .map_err(|error| format!("invalid CRM proposal meeting visibility: {error}"))?;
    let mut proposal = PendingCrmProposal {
        proposal_id: dto.id,
        provider: provider.id().to_string(),
        kind,
        matter_id: dto.matter_id,
        household_key: dto.household_key.unwrap_or_default(),
        content_hash: String::new(),
        title: dto.title,
        body: dto.body,
        due_date: dto.due_date,
        source_ref: dto.source_ref,
        requested_at: dto.requested_at,
        field: dto.field,
        existing_value: dto.existing_value,
        new_value: dto.new_value,
        final_value: dto.final_value,
        provenance: dto.provenance,
        meeting_visibility_json,
        ai_source_kind,
        ai_source_date,
        status: validate_crm_proposal_status(dto.status)?,
        remote_id: dto.remote_id,
        error: dto.error,
        created_at: String::new(),
        updated_at: String::new(),
    };
    proposal.content_hash = crm_proposal_content_hash(&proposal);
    Ok(proposal)
}

fn crm_proposal_to_dto(proposal: PendingCrmProposal) -> CrmWriteProposalRecordDto {
    let ai_source = match (proposal.ai_source_kind, proposal.ai_source_date) {
        (Some(kind), date) => Some(CrmProposalAiSourceDto { kind, date }),
        (None, _) => None,
    };
    let meeting_visibility = proposal
        .meeting_visibility_json
        .as_deref()
        .and_then(|value| serde_json::from_str(value).ok());
    CrmWriteProposalRecordDto {
        id: proposal.proposal_id,
        kind: proposal.kind,
        matter_id: proposal.matter_id,
        title: proposal.title,
        body: proposal.body,
        due_date: proposal.due_date,
        source_ref: proposal.source_ref,
        status: proposal.status,
        remote_id: proposal.remote_id,
        error: proposal.error,
        requested_at: proposal.requested_at,
        field: proposal.field,
        existing_value: proposal.existing_value,
        new_value: proposal.new_value,
        final_value: proposal.final_value,
        provenance: proposal.provenance,
        meeting_visibility,
        ai_source,
        household_key: proposal.household_key,
        provider: proposal.provider,
        content_hash: proposal.content_hash,
        created_at: proposal.created_at,
        updated_at: proposal.updated_at,
    }
}

fn verify_crm_proposal(proposal: &PendingCrmProposal) -> Result<(), String> {
    if proposal.status == "sent" {
        return Err("this CRM proposal was already sent".to_string());
    }
    if proposal.created_at.trim().is_empty() {
        return Err("CRM proposal is missing its creation time".to_string());
    }
    let expected = crm_proposal_content_hash(proposal);
    if expected != proposal.content_hash {
        return Err("CRM proposal no longer matches its saved approval hash".to_string());
    }
    Ok(())
}

#[tauri::command]
pub async fn crm_save_write_proposal(
    state: State<'_, CrmState>,
    proposal: CrmWriteProposalDto,
) -> Result<CrmWriteProposalRecordDto, String> {
    let proposal = crm_proposal_from_dto(proposal)?;
    let store = crm_store_from_state(&state).await?;
    store
        .proposal_upsert(&proposal)
        .map(crm_proposal_to_dto)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn crm_prepare_write_proposal(
    state: State<'_, CrmState>,
    proposal_id: String,
    household_key: String,
    requested_at: String,
    provenance: Option<String>,
) -> Result<CrmWriteProposalRecordDto, String> {
    if proposal_id.trim().is_empty() {
        return Err("CRM proposal id is required".to_string());
    }
    if household_key.trim().is_empty() {
        return Err("this client is not linked to a CRM household".to_string());
    }
    write::validate_requested_at(&requested_at).map_err(|e| e.to_string())?;

    let store = crm_store_from_state(&state).await?;
    let mut proposal = store
        .proposal_get(&proposal_id)
        .map_err(|e| e.to_string())?
        .ok_or("CRM proposal not found — reopen the client and try again")?;
    if proposal.status == "sent" {
        return Err("this CRM proposal was already sent".to_string());
    }
    proposal.household_key = household_key;
    proposal.requested_at = Some(requested_at);
    let has_provenance = provenance
        .as_deref()
        .map(str::trim)
        .map(|p| !p.is_empty())
        .unwrap_or(false);
    if has_provenance {
        proposal.provenance = provenance;
    }
    proposal.status = "sending".to_string();
    proposal.error = None;
    proposal.content_hash = crm_proposal_content_hash(&proposal);
    store
        .proposal_upsert(&proposal)
        .map(crm_proposal_to_dto)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn crm_list_write_proposals(
    state: State<'_, CrmState>,
) -> Result<Vec<CrmWriteProposalRecordDto>, String> {
    let store = crm_store_from_state(&state).await?;
    store
        .proposal_list_pending()
        .map(|rows| rows.into_iter().map(crm_proposal_to_dto).collect())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn crm_delete_write_proposal(
    state: State<'_, CrmState>,
    proposal_id: String,
) -> Result<(), String> {
    if proposal_id.trim().is_empty() {
        return Ok(());
    }
    let store = crm_store_from_state(&state).await?;
    store
        .proposal_delete(&proposal_id)
        .map(|_| ())
        .map_err(|e| e.to_string())
}

/// The only provider-writing CRM command exposed to the renderer. It takes a
/// proposal id, reloads the encrypted proposal, verifies the saved content hash,
/// then sends the already-saved content to Wealthbox.
#[tauri::command]
pub async fn crm_approve_write_proposal(
    app: AppHandle,
    state: State<'_, CrmState>,
    policy: State<'_, crate::network_policy::NetworkPolicy>,
    proposal_id: String,
) -> Result<WriteReceipt, String> {
    let mut proposal = {
        let store = crm_store_from_state(&state).await?;
        let proposal = store
            .proposal_get(&proposal_id)
            .map_err(|e| e.to_string())?
            .ok_or("CRM proposal not found — reopen the client and try again")?;
        verify_crm_proposal(&proposal)?;
        proposal
    };
    let requested_at = proposal
        .requested_at
        .clone()
        .ok_or("CRM proposal has not been prepared for approval")?;
    if proposal.household_key.trim().is_empty() {
        return Err("this client is not linked to a CRM household".to_string());
    }

    let proposal_kind = proposal.kind.clone();
    let receipt = match proposal_kind.as_str() {
        "note" => {
            crm_create_write(
                app,
                &state,
                policy.inner().clone(),
                CrmWriteKind::Note,
                proposal.matter_id.clone(),
                proposal.title.clone(),
                proposal.body.clone(),
                None,
                proposal.source_ref.clone(),
                proposal.household_key.clone(),
                requested_at.clone(),
                Some(proposal.provider.clone()),
                proposal.provenance.clone(),
            )
            .await
        }
        "task" => {
            crm_create_write(
                app,
                &state,
                policy.inner().clone(),
                CrmWriteKind::Task,
                proposal.matter_id.clone(),
                proposal.title.clone(),
                proposal.body.clone(),
                proposal.due_date.clone(),
                proposal.source_ref.clone(),
                proposal.household_key.clone(),
                requested_at.clone(),
                Some(proposal.provider.clone()),
                None,
            )
            .await
        }
        "field" => {
            crm_update_field_from_proposal(
                app,
                &state,
                policy.inner().clone(),
                proposal.matter_id.clone(),
                proposal.household_key.clone(),
                proposal.field.clone().unwrap_or_default(),
                proposal.existing_value.clone().unwrap_or_default(),
                proposal.new_value.clone().unwrap_or_default(),
                proposal.final_value.clone().unwrap_or_default(),
                proposal.source_ref.clone(),
                requested_at,
                Some(proposal.provider.clone()),
            )
            .await
        }
        _ => Err("invalid CRM proposal kind".to_string()),
    }?;

    proposal.status = "sent".to_string();
    proposal.remote_id = Some(receipt.remote_id.clone());
    proposal.error = None;
    proposal.content_hash = crm_proposal_content_hash(&proposal);
    let store = crm_store_from_state(&state).await?;
    store.proposal_upsert(&proposal).map_err(|e| {
        format!("CRM write sent, but the local proposal status could not be saved: {e}")
    })?;

    Ok(receipt)
}

/// Compatibility entry point retained from the CRM parent for its
/// approval-gated note review flow.
#[tauri::command]
pub async fn crm_create_note(
    app: AppHandle,
    state: State<'_, CrmState>,
    policy: State<'_, crate::network_policy::NetworkPolicy>,
    matter_id: String,
    title: String,
    body: String,
    source_ref: String,
    household_key: String,
    requested_at: String,
    provider: Option<String>,
    provenance: Option<String>,
) -> Result<WriteReceipt, String> {
    crm_create_write(
        app,
        &state,
        policy.inner().clone(),
        CrmWriteKind::Note,
        matter_id,
        title,
        body,
        None,
        source_ref,
        household_key,
        requested_at,
        provider,
        provenance,
    )
    .await
}

/// Compatibility entry point retained from the CRM parent for its
/// approval-gated task review flow.
#[tauri::command]
pub async fn crm_create_task(
    app: AppHandle,
    state: State<'_, CrmState>,
    policy: State<'_, crate::network_policy::NetworkPolicy>,
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
        &state,
        policy.inner().clone(),
        CrmWriteKind::Task,
        matter_id,
        title,
        description,
        due_date,
        source_ref,
        household_key,
        requested_at,
        provider,
        None,
    )
    .await
}

#[allow(clippy::too_many_arguments)]
async fn crm_create_write(
    app: AppHandle,
    state: &State<'_, CrmState>,
    policy: crate::network_policy::NetworkPolicy,
    kind: CrmWriteKind,
    matter_id: String,
    title: String,
    body: String,
    due_date: Option<String>,
    source_ref: String,
    household_key: String,
    requested_at: String,
    provider: Option<String>,
    provenance: Option<String>,
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
    if state.connect_in_progress.load(Ordering::SeqCst) {
        return Err(format!(
            "{} is reconnecting — try again in a moment",
            provider.display_name()
        ));
    }
    if state
        .downgrade_unconfirmed
        .lock()
        .await
        .contains(provider.id())
    {
        return Err(
            "CRM sync state couldn't be verified — try reopening your workspace before writing."
                .to_string(),
        );
    }

    write::validate_write_inputs(&title, &body).map_err(|e| e.to_string())?;
    write::validate_requested_at(&requested_at).map_err(|e| e.to_string())?;
    write::validate_task_due_date(kind, provider.id(), due_date.as_deref())
        .map_err(|e| e.to_string())?;

    let token = read_token(provider).ok_or_else(|| {
        format!(
            "{} not connected — connect it in Account → Connections first",
            provider.display_name()
        )
    })?;

    let workspace = state
        .service()
        .optional_workspace()
        .await
        .ok_or("workspace not set — call crm_set_workspace first")?;

    let store = CrmStore::open(&workspace).map_err(|e| e.to_string())?;
    let client = write::write_client_for(provider, token, policy).map_err(|e| e.to_string())?;

    let req = CrmWriteRequest {
        kind,
        matter_id: matter_id.clone(),
        household_key: household_key.clone(),
        title,
        body,
        due_date,
        source_ref: source_ref.clone(),
        requested_at,
        provenance,
    };

    let action = provider.audit_action(match kind {
        CrmWriteKind::Note => "create_note",
        CrmWriteKind::Task => "create_task",
    });

    let write_dedup_key = write::dedup_key(&req);
    let audit_pair_id = format!("crmwrite_{write_dedup_key}");
    let intent_description = format!(
        "{} push requested to {} household {household_key} (source: {source_ref})",
        kind.as_str(),
        provider.display_name(),
    );
    append_crm_audit_must_for_matter(
        &app,
        &action,
        &intent_description,
        &matter_id,
        Some(&write_dedup_key),
        "intent",
        &audit_pair_id,
    )
    .await?;

    match write::push_crm_write(client.as_ref(), &store, &state.write_guard, &req).await {
        Ok(receipt) => {
            // The audit id is deterministic (see append_crm_audit_must_for_matter)
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
            append_crm_audit_must_for_matter(
                &app,
                &action,
                &description,
                &matter_id,
                Some(&write_dedup_key),
                "outcome",
                &audit_pair_id,
            )
            .await?;
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
            append_crm_audit_must_for_matter(
                &app,
                &action,
                &description,
                &matter_id,
                Some(&format!("{write_dedup_key}_ambiguous")),
                "outcome",
                &audit_pair_id,
            )
            .await?;
            Err(CrmWriteError::VerifyPending.to_string())
        }
        Err(e) => Err(e.to_string()),
    }
}

/// Compatibility entry point retained from the CRM parent for its
/// approval-gated field review flow.
#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn crm_update_field(
    app: AppHandle,
    state: State<'_, CrmState>,
    policy: State<'_, crate::network_policy::NetworkPolicy>,
    matter_id: String,
    household_key: String,
    field: String,
    existing_value: String,
    new_value: String,
    final_value: String,
    source_ref: String,
    requested_at: String,
    provider: Option<String>,
) -> Result<WriteReceipt, String> {
    crm_update_field_from_proposal(
        app,
        &state,
        policy.inner().clone(),
        matter_id,
        household_key,
        field,
        existing_value,
        new_value,
        final_value,
        source_ref,
        requested_at,
        provider,
    )
    .await
}

/// Shared field-level "blend" implementation. Both approval paths keep the
/// merged tree's audit and stale-value checks.
#[allow(clippy::too_many_arguments)]
async fn crm_update_field_from_proposal(
    app: AppHandle,
    state: &State<'_, CrmState>,
    policy: crate::network_policy::NetworkPolicy,
    matter_id: String,
    household_key: String,
    field: String,
    existing_value: String,
    new_value: String,
    final_value: String,
    source_ref: String,
    requested_at: String,
    provider: Option<String>,
) -> Result<WriteReceipt, String> {
    let provider = CrmProvider::from_optional(provider.as_deref())?;

    // Same in-flight/disconnect/reconnect coordination as crm_create_write —
    // see its comments for why each check exists.
    state.write_in_flight.fetch_add(1, Ordering::SeqCst);
    let _write_slot = WriteInFlightSlot(state.write_in_flight.clone());
    if state.disconnect_requested.load(Ordering::SeqCst) {
        return Err(format!(
            "{} is disconnecting — try again once reconnected",
            provider.display_name()
        ));
    }
    if state.connect_in_progress.load(Ordering::SeqCst) {
        return Err(format!(
            "{} is reconnecting — try again in a moment",
            provider.display_name()
        ));
    }
    if state
        .downgrade_unconfirmed
        .lock()
        .await
        .contains(provider.id())
    {
        return Err(
            "CRM sync state couldn't be verified — try reopening your workspace before writing."
                .to_string(),
        );
    }

    write::validate_requested_at(&requested_at).map_err(|e| e.to_string())?;

    let token = read_token(provider).ok_or_else(|| {
        format!(
            "{} not connected — connect it in Account → Connections first",
            provider.display_name()
        )
    })?;

    let workspace = state
        .service()
        .optional_workspace()
        .await
        .ok_or("workspace not set — call crm_set_workspace first")?;

    let store = CrmStore::open(&workspace).map_err(|e| e.to_string())?;
    let client = write::write_client_for(provider, token, policy).map_err(|e| e.to_string())?;

    let req = write::CrmFieldUpdateRequest {
        matter_id: matter_id.clone(),
        household_key: household_key.clone(),
        field: field.clone(),
        existing_value,
        new_value,
        final_value,
        source_ref: source_ref.clone(),
        requested_at: requested_at.clone(),
    };

    let action = provider.audit_action("field_updated");
    // Codex round 10 (self-converge): the audit id incorporates
    // requested_at (unlike dedup_key_field, the WRITE-safety key, which
    // deliberately doesn't) — without it, a genuine retry (this exact
    // command re-invoked after its response was lost) and a LATER, separate
    // approval that happens to restore the same final_value are
    // indistinguishable from content alone: one wants the SAME audit entry
    // (no duplicate), the other wants its own. See CrmFieldUpdateRequest's
    // doc comment.
    //
    // Trimmed here (self-converge, review findings on lp/crm-9c-rust):
    // validate_requested_at accepts (and validates) the TRIMMED value, so a
    // retry with incidental whitespace around an otherwise-identical
    // requested_at must still compute the SAME audit id — hashing the raw
    // string would let harmless whitespace defeat the INSERT OR IGNORE
    // dedup this id exists for.
    let write_dedup_key = format!("{}_{}", write::dedup_key_field(&req), requested_at.trim());
    let audit_pair_id = format!("crmwrite_{write_dedup_key}");
    let intent_description = format!(
        "field '{field}' update requested on {} household {household_key} (source: {source_ref})",
        provider.display_name(),
    );
    append_crm_audit_must_for_matter(
        &app,
        &action,
        &intent_description,
        &matter_id,
        Some(&write_dedup_key),
        "intent",
        &audit_pair_id,
    )
    .await?;

    match write::push_crm_field_update(client.as_ref(), &store, &state.write_guard, &req).await {
        Ok(receipt) => {
            let description = format!(
                "field '{field}' updated on {} household {household_key} (source: {source_ref})",
                provider.display_name(),
            );
            // write_dedup_key now includes requested_at (see above), so
            // this single deterministic id correctly handles all three
            // cases: a genuine retry (same requested_at) of either a real
            // write or a cache hit collides with its own prior entry (no
            // duplicate); a LATER, separate approval (new requested_at) of
            // the same content always gets its own entry.
            append_crm_audit_must_for_matter(
                &app,
                &action,
                &description,
                &matter_id,
                Some(&write_dedup_key),
                "outcome",
                &audit_pair_id,
            )
            .await?;
            Ok(receipt)
        }
        Err(CrmWriteError::StaleFieldValue(current)) => {
            let description = format!(
                "field '{field}' update on {} household {household_key} (source: {source_ref}) \
                 skipped — the value changed in the CRM since this was proposed",
                provider.display_name(),
            );
            append_crm_audit_must_for_matter(
                &app,
                &action,
                &description,
                &matter_id,
                Some(&format!("{write_dedup_key}_stale")),
                "outcome",
                &audit_pair_id,
            )
            .await?;
            Err(CrmWriteError::StaleFieldValue(current).to_string())
        }
        Err(CrmWriteError::VerifyPending) => {
            let description = format!(
                "field '{field}' update on {} household {household_key} (source: {source_ref}) \
                 MAY have been applied — delivery unconfirmed, will verify on retry",
                provider.display_name(),
            );
            append_crm_audit_must_for_matter(
                &app,
                &action,
                &description,
                &matter_id,
                Some(&format!("{write_dedup_key}_ambiguous")),
                "outcome",
                &audit_pair_id,
            )
            .await?;
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
    policy: State<'_, crate::network_policy::NetworkPolicy>,
    path: String,
    provider: Option<String>,
) -> Result<(), String> {
    let provider = CrmProvider::from_optional(provider.as_deref())?;
    let ws = PathBuf::from(path);
    // CRM setup is also the earliest guaranteed CRM workspace handoff. Point
    // native egress receipts at the same encrypted append-only log even if the
    // Activity screen has not hydrated its audit service yet.
    policy.set_audit_workspace(ws.clone());

    // Codex round 9 (self-converge): ALWAYS store the workspace path,
    // unconditionally — never gate this on connect_in_progress. Round 4's
    // fix refused the WHOLE command (workspace never set) when a connect
    // was already in progress, but the frontend calls crm_set_workspace at
    // routine app/workspace-open time and only logs a failure here (it
    // doesn't retry) — so a race against an in-progress connect could
    // leave CrmState.workspace permanently None for the rest of the
    // session, breaking sync/write/disconnect entirely. That's a much
    // worse failure mode than the downgrade race this originally guarded.
    state.service().set_workspace(ws.clone()).await;

    // See downgrade_stale_sent_rows_for_workspace's doc comment: this covers
    // the ordering connect couldn't (a connect that happened before this
    // workspace was ever opened, whose downgrade attempt at connect time
    // found no workspace to touch). Can't fail-closed the same way connect
    // does (refuse the whole command) -- this runs automatically on
    // workspace open, and hard-failing it would block the user from ever
    // opening their workspace over a transient ledger hiccup. Instead,
    // block NEW writes via downgrade_unconfirmed until a LATER successful
    // check (another crm_set_workspace call, or a future connect) clears
    // it -- see CrmState::downgrade_unconfirmed's doc comment.
    if read_token(provider).is_some() {
        // Only the DOWNGRADE CHECK itself needs the connect_in_progress
        // race protection (a concurrent connect could be mid-transition on
        // the SAME provider's ledger rows) — the workspace path above is
        // never gated on it.
        //
        // Self-converge (review findings on lp/crm-9c-rust): a plain
        // "can't claim it right now, just mark this provider unconfirmed"
        // was itself racy — connect_in_progress is a single flag shared by
        // ALL providers, so if the concurrent connect (for this SAME
        // provider) finished and cleared downgrade_unconfirmed BEFORE this
        // function's own insert landed, the insert would silently override
        // that fresh confirmation, leaving writes blocked with no path to
        // recovery short of another workspace-open or connect. So: if the
        // claim fails, WAIT (bounded) for the other connect to finish
        // first, then claim again — this makes our own check run strictly
        // AFTER theirs (sequenced, not racing), so whichever result lands
        // last is the current truth. Only if contention persists past the
        // wait budget do we fall back to marking unconfirmed as a
        // last-resort, self-healing signal.
        let mut connect_guard = claim_connect_in_progress(&state);
        if connect_guard.is_none() {
            wait_for_connect_in_progress_to_clear(&state).await;
            connect_guard = claim_connect_in_progress(&state);
        }
        match connect_guard {
            Some(_connect_guard) => {
                let confirmed =
                    downgrade_stale_sent_rows_for_workspace(ws, provider, "crm set_workspace")
                        .await;
                let mut unconfirmed = state.downgrade_unconfirmed.lock().await;
                if confirmed {
                    unconfirmed.remove(provider.id());
                } else {
                    unconfirmed.insert(provider.id().to_string());
                }
            }
            None => {
                state
                    .downgrade_unconfirmed
                    .lock()
                    .await
                    .insert(provider.id().to_string());
            }
        }
    }
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
fn crm_connect_error(provider: CrmProvider, error: &anyhow::Error) -> String {
    if let Some(policy_error) = error.downcast_ref::<crate::network_policy::NetworkPolicyError>() {
        return policy_error.to_string();
    }
    format!(
        "Could not connect to {}: invalid login or network error",
        provider.display_name()
    )
}

#[tauri::command]
pub async fn crm_connect(
    app: AppHandle,
    state: State<'_, CrmState>,
    policy: State<'_, crate::network_policy::NetworkPolicy>,
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
        let info = RedtailClient::authenticate(username, password, policy.inner())
            .await
            .map_err(|error| crm_connect_error(CrmProvider::Redtail, &error))?;

        // Block NEW writes for the whole token-swap + downgrade transition
        // (not just the drain wait) — see ConnectInProgressGuard's doc
        // comment for why a drain wait alone isn't a safe handoff. Also
        // refuses a SECOND overlapping connect attempt outright (see
        // claim_connect_in_progress) rather than letting both proceed.
        let Some(_connect_guard) = claim_connect_in_progress(&state) else {
            return Err("A connect is already in progress — try again in a moment.".to_string());
        };
        if !wait_for_writes_to_drain(&state).await {
            return Err(
                "A CRM write is still in progress — wait a moment and try connecting again."
                    .to_string(),
            );
        }
        // Confirm the stale-row downgrade BEFORE ever storing the new
        // token — fail closed rather than proceed with a token swap the old
        // 'sent' rows can't be trusted to survive. See
        // downgrade_stale_sent_rows_for_workspace's doc comment for why
        // this ordering means no rollback is needed on failure: nothing has
        // changed yet.
        if !confirm_stale_sent_rows_downgraded(&app, provider).await {
            return Err(
                "Could not verify your previous Redtail activity before reconnecting — try again in a moment."
                    .to_string(),
            );
        }
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
    let info = validate_token(provider, token, policy.inner().clone())
        .await
        .map_err(|error| crm_connect_error(provider, &error))?;

    // Block NEW writes for the whole token-swap + downgrade transition (not
    // just the drain wait) — see ConnectInProgressGuard's doc comment. Also
    // refuses a SECOND overlapping connect attempt outright (see
    // claim_connect_in_progress) rather than letting both proceed.
    let Some(_connect_guard) = claim_connect_in_progress(&state) else {
        return Err("A connect is already in progress — try again in a moment.".to_string());
    };
    if !wait_for_writes_to_drain(&state).await {
        return Err(
            "A CRM write is still in progress — wait a moment and try connecting again."
                .to_string(),
        );
    }
    // Confirm the stale-row downgrade BEFORE ever storing the new token —
    // fail closed rather than proceed with a token swap the old 'sent' rows
    // can't be trusted to survive. See
    // downgrade_stale_sent_rows_for_workspace's doc comment for why this
    // ordering means no rollback is needed on failure: nothing has changed yet.
    if !confirm_stale_sent_rows_downgraded(&app, provider).await {
        return Err(format!(
            "Could not verify your previous {} activity before reconnecting — try again in a moment.",
            provider.display_name()
        ));
    }
    // Store the token only after a confirmed successful validation.
    store_token(provider, token)?;

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
    policy: State<'_, crate::network_policy::NetworkPolicy>,
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
        .ok_or_else(|| "LANTERN_SALESFORCE_CLIENT_ID is not configured".to_string())?;
    let (verifier, challenge) = crate::commands::mail::gmail::oauth::gen_pkce();
    let state_token = crate::commands::mail::gmail::oauth::gen_state();
    let (listener, redirect_uri) =
        crate::commands::mail::gmail::oauth::bind_loopback_host("localhost")
            .await
            .map_err(|e| e.to_string())?;
    let url = build_salesforce_auth_url(&client_id, &redirect_uri, &challenge, &state_token);
    crate::commands::connector_network::handoff_guarded(
        policy.inner(),
        &crate::network_policy::SALESFORCE_OAUTH,
        &url,
        None,
        || crate::commands::mail::gmail::oauth::open_browser(&url),
    )
    .map_err(|error| {
        crate::commands::connector_network::transport_error(
            error,
            "failed to open Salesforce sign-in",
        )
        .to_string()
    })?;
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
        policy.inner(),
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
        Some(prev) => {
            let _ = store_token(provider, prev);
        }
        None => {
            let _ = delete_token(provider);
        }
    };

    // Block NEW writes from the start of this transition all the way through
    // the downgrade below (the guard is dropped — and connect_in_progress
    // reset — whenever this function returns, on every exit path including
    // the cancel-rollback branches) — see ConnectInProgressGuard's doc
    // comment for why a drain wait alone isn't a safe handoff. Also refuses
    // a SECOND overlapping connect attempt outright (see
    // claim_connect_in_progress) rather than letting both proceed.
    let Some(_connect_guard) = claim_connect_in_progress(&state) else {
        return Err("A connect is already in progress — try again in a moment.".to_string());
    };
    if !wait_for_writes_to_drain(&state).await {
        // Nothing has been stored yet at this point (we're still before
        // store_or_rollback_on_cancel) — a plain Err is enough, no rollback
        // needed.
        return Err(
            "A CRM write is still in progress — wait a moment and try connecting again."
                .to_string(),
        );
    }

    // Confirm the stale-row downgrade BEFORE ever storing the new token —
    // fail closed rather than proceed with a token swap the old 'sent' rows
    // can't be trusted to survive. Nothing has been stored yet at this
    // point either, so — like the drain-wait check above — this needs no
    // rollback: just don't store the token. See
    // downgrade_stale_sent_rows_for_workspace's doc comment for the full
    // reasoning.
    if !confirm_stale_sent_rows_downgraded(&app, provider).await {
        return Err(format!(
            "Could not verify your previous {} activity before reconnecting — try again in a moment.",
            provider.display_name()
        ));
    }

    crate::commands::mail::gmail::oauth::store_or_rollback_on_cancel(
        &cancel,
        || store_token(provider, &stored),
        || rollback_token(&previous_token),
    )?;

    let info = SalesforceClient::new_with_token_endpoint(
        stored,
        client_id,
        SALESFORCE_TOKEN_ENDPOINT.to_string(),
        policy.inner().clone(),
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

    // The Cancel button stays live until this command settles, and the work
    // above is itself awaited disk I/O — check one more time before
    // declaring success so a cancel during that write still rolls back the
    // credential instead of returning Ok with it still stored.
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
            Some(_) => "the new credential was discarded and the previous connection was restored"
                .to_string(),
            None => format!(
                "the new credential was removed and this device is not connected to {}",
                provider.display_name()
            ),
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

/// RAII guard: resets `connect_in_progress` to false when dropped, covering
/// every exit path (normal return, `?`, or panic) — so a failed connect
/// attempt never leaves new writes permanently blocked.
struct ConnectInProgressGuard(Arc<AtomicBool>);
impl Drop for ConnectInProgressGuard {
    fn drop(&mut self) {
        self.0.store(false, Ordering::SeqCst);
    }
}

/// Single-flight claim on `connect_in_progress` via `compare_exchange` (the
/// same idiom `crm_disconnect_logic_for_provider` already uses for
/// `is_syncing`) — returns `None` if another connect is already mid-transition.
///
/// A plain `store(true)` per caller is NOT safe here: if two
/// `crm_connect`/`crm_oauth_connect` calls overlap, each would create its
/// OWN guard, and whichever finishes FIRST would drop its guard and reset
/// the flag to `false` while the SECOND is still between its drain wait,
/// token swap, and ledger downgrade — reopening the exact race this flag
/// exists to close (a write could start in that gap, read whichever token
/// exists at that instant, and complete after the second connect's
/// downgrade already ran).
fn claim_connect_in_progress(state: &CrmState) -> Option<ConnectInProgressGuard> {
    state
        .connect_in_progress
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .ok()
        .map(|_| ConnectInProgressGuard(state.connect_in_progress.clone()))
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
    let Some(ws) = state.service().optional_workspace().await else {
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
    let mut workspace_key_service_to_delete = None;
    match purge_crm_data_for_provider(&ws, provider).await {
        Ok(outcome) => {
            result.rag_purged = true;
            result.crm_db_purged = true;
            no_crm_rows_remain = outcome.no_crm_rows_remain;
            if no_crm_rows_remain {
                workspace_key_service_to_delete = CrmStore::workspace_key_service_for_deletion(&ws);
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
            if let Err(e) =
                CrmStore::delete_workspace_master_key(workspace_key_service_to_delete.as_deref())
            {
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
                        log::warn!(
                            "crm_disconnect: outbound ledger purge failed (non-fatal): {e:#}"
                        );
                        result.warnings.push(format!(
                            "{} write history could not be fully cleared: {e}",
                            provider.display_name()
                        ));
                    }
                }
                Err(e) => {
                    log::warn!(
                        "crm_disconnect: could not open crm store to purge outbound ledger (non-fatal): {e:#}"
                    );
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

/// Replace only an unreadable local CRM cache, then let the renderer refill it
/// from every connected CRM provider. Files and non-CRM search rows are untouched.
#[tauri::command]
pub async fn crm_rebuild_store(state: State<'_, CrmState>) -> Result<(), String> {
    if state
        .is_syncing
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return Err("A CRM sync is already running. Let it finish, then rebuild.".into());
    }
    let _sync_guard = SyncGuard(state.is_syncing.clone());
    let workspace = state
        .service()
        .optional_workspace()
        .await
        .ok_or("Open a workspace before rebuilding its CRM records.")?;

    match CrmStore::open(&workspace) {
        Ok(_) => return Err("The saved CRM records are healthy, so they were not rebuilt.".into()),
        Err(error) if is_crm_store_recovery_required(&error) => {}
        Err(error) => return Err(crm_store_user_message(&error)),
    }

    // Remove CRM-only search chunks first. Files and email remain available.
    let connection = crate::commands::rag::store::open_connection(&workspace)
        .await
        .map_err(|error| error.to_string())?;
    let table = crate::commands::rag::store::open_or_create_table(&connection)
        .await
        .map_err(|error| error.to_string())?;
    crate::commands::rag::store::delete_source_type(&table, "crm")
        .await
        .map_err(|error| error.to_string())?;

    let workspace_key_service = CrmStore::workspace_key_service_for_deletion(&workspace);
    drop(
        CrmStore::replace_unopenable_database(&workspace, || {
            if let Err(error) =
                CrmStore::delete_workspace_master_key(workspace_key_service.as_deref())
            {
                // The old DB is gone and the replacement gets a fresh unique key,
                // so an orphaned old credential cannot expose or block anything.
                log::warn!("crm recovery: could not remove orphaned workspace key: {error:#}");
            }
            CrmStore::open(&workspace)
        })
        .map_err(|error| crm_store_user_message(&error))?,
    );
    Ok(())
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
    policy: State<'_, crate::network_policy::NetworkPolicy>,
    matter_map: Vec<CrmMatterMapEntry>,
    run_id: String,
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
        .service()
        .optional_workspace()
        .await
        .ok_or("workspace not set — call crm_set_workspace first")?;

    // Emit the start event.
    emit_crm_progress(&app, &run_id, serde_json::json!({ "status": "syncing" }));

    // Convert the Vec<CrmMatterMapEntry> → HashMap<String,String> for the engine.
    let matter_hashmap = provider_scoped_matter_entries(&matter_map, provider);

    // Open (or create) the encrypted CRM store.
    let store = CrmStore::open(&workspace).map_err(|e| {
        emit_crm_progress(&app, &run_id, serde_json::json!({ "status": "error" }));
        crm_store_user_message(&e)
    })?;

    // Read the RAG/vector master key from the OS keychain and hand it to the engine
    // (the engine stays keychain-free so it can be driven in tests with a literal key).
    let rag_key = crate::commands::rag::crypto::get_or_create_master_key().map_err(|e| {
        emit_crm_progress(&app, &run_id, serde_json::json!({ "status": "error" }));
        e.to_string()
    })?;

    // Live progress emitter: poll the shared counter every 250ms and emit `syncing`
    // events with the running household count, so the FE's progress display climbs
    // steadily instead of jumping at the end. Aborted once backfill returns (the
    // terminal done/cancelled/error event is emitted below).
    let emit_counter = state.progress_households.clone();
    let emit_app = app.clone();
    let emit_run_id = run_id.clone();
    let emitter = tokio::spawn(async move {
        let mut last = u32::MAX;
        loop {
            tokio::time::sleep(std::time::Duration::from_millis(250)).await;
            let done = emit_counter.load(Ordering::SeqCst);
            if done != last {
                last = done;
                emit_crm_progress(
                    &emit_app,
                    &emit_run_id,
                    serde_json::json!({ "status": "syncing", "households": done }),
                );
            }
        }
    });

    // Run the full backfill (fetch → ingest → index). The cancel flag is polled
    // between matters so the UI's Stop button interrupts a long sync.
    let client = client_for(provider, token, policy.inner().clone()).map_err(|e| e.to_string())?;
    // A frontend timeout cannot stop a Tauri command already running in the
    // desktop process.  At ten minutes we therefore request cancellation, tell
    // the screen we are stopping safely, and WAIT for the engine to finish its
    // current bounded network/embedding step.  Only then does SyncGuard release
    // the single-flight slot, so Retry can never overlap orphaned work.
    const CRM_SYNC_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(10 * 60);
    // A cooperative stop normally ends after one bounded provider or embedding
    // operation. If it does not, keep the truthful "Stopping" state but say
    // why Retry remains unavailable instead of looking frozen forever.
    const STOPPING_DIAGNOSTIC_DELAY: std::time::Duration = std::time::Duration::from_secs(60);
    let still_stopping = Arc::new(AtomicBool::new(false));
    let diagnostic_flag = still_stopping.clone();
    let diagnostic_app = app.clone();
    let diagnostic_run_id = run_id.clone();
    let (timed_out, backfill_result) = await_sync_or_stop(
        &state.cancel,
        CRM_SYNC_TIMEOUT,
        engine::backfill(
            client.as_ref(),
            &store,
            &workspace,
            &matter_hashmap,
            &state.cancel,
            &rag_key,
            &state.progress_households,
        ),
        || {
            diagnostic_flag.store(true, Ordering::SeqCst);
            tokio::spawn(async move {
                tokio::time::sleep(STOPPING_DIAGNOSTIC_DELAY).await;
                if diagnostic_flag.load(Ordering::SeqCst) {
                    emit_crm_progress(
                        &diagnostic_app,
                        &diagnostic_run_id,
                        serde_json::json!({
                            "status": "stopping",
                            "message": "This import is still finishing its current step safely. You can retry as soon as it finishes."
                        }),
                    );
                }
            });
            emit_crm_progress(
                &app,
                &run_id,
                serde_json::json!({ "status": "stopping" }),
            );
        },
    )
    .await;
    still_stopping.store(false, Ordering::SeqCst);
    stop_progress_emitter(emitter).await;
    // A progress tick queued just before abort must settle before a terminal
    // event is sent, otherwise it could repaint the UI as Syncing after Error.

    let report = match backfill_result {
        Ok(r) if !timed_out => r,
        Ok(_) => {
            emit_crm_progress(&app, &run_id, serde_json::json!({ "status": "error" }));
            return Err("Wealthbox sync took longer than 10 minutes. It stopped safely; you can try Sync now again.".into());
        }
        Err(e) => {
            emit_crm_progress(&app, &run_id, serde_json::json!({ "status": "error" }));
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
    emit_crm_progress(
        &app,
        &run_id,
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
pub async fn crm_list_households(
    app: AppHandle,
    policy: State<'_, crate::network_policy::NetworkPolicy>,
    run_id: String,
    provider: Option<String>,
) -> Result<Vec<CrmHouseholdDto>, String> {
    let provider = CrmProvider::from_optional(provider.as_deref())?;
    // This is the first real network call in the Sync-now path, before the
    // advisor confirms import.  Emit it immediately so the UI never displays
    // an activity-free "Syncing" state while this fetch is underway.
    emit_crm_progress(&app, &run_id, serde_json::json!({ "status": "connecting" }));
    let token = read_token(provider).ok_or_else(|| "not connected".to_string())?;
    let client = client_for(provider, token, policy.inner().clone()).map_err(|e| e.to_string())?;
    let contacts = match client.list_households().await {
        Ok(contacts) => contacts,
        Err(error) => {
            emit_crm_progress(&app, &run_id, serde_json::json!({ "status": "error" }));
            return Err(error.to_string());
        }
    };
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

    #[tokio::test]
    async fn a_timeout_requests_cancellation_and_does_not_leave_embedding_work_running() {
        use std::sync::atomic::{AtomicUsize, Ordering};

        let cancel = AtomicBool::new(false);
        let embeddings_in_flight = Arc::new(AtomicUsize::new(0));
        let in_flight = Arc::clone(&embeddings_in_flight);
        let observed_cancel = Arc::new(AtomicBool::new(false));
        let observed_cancel_for_timeout = Arc::clone(&observed_cancel);

        let work = async move {
            in_flight.fetch_add(1, Ordering::SeqCst);
            // This models one non-interruptible `spawn_blocking` embedding batch:
            // cancellation is requested while it runs, and the sync must wait
            // for its join before allowing another run.
            tokio::task::spawn_blocking(move || {
                std::thread::sleep(std::time::Duration::from_millis(30))
            })
            .await
            .expect("embedding worker joins");
            in_flight.fetch_sub(1, Ordering::SeqCst);
        };

        let (timed_out, ()) =
            await_sync_or_stop(&cancel, std::time::Duration::from_millis(5), work, || {
                observed_cancel_for_timeout.store(true, Ordering::SeqCst)
            })
            .await;

        assert!(timed_out, "the watchdog must fire");
        assert!(
            cancel.load(Ordering::SeqCst),
            "timeout must request cancellation"
        );
        assert!(
            observed_cancel.load(Ordering::SeqCst),
            "the stopping event hook must run"
        );
        assert_eq!(
            embeddings_in_flight.load(Ordering::SeqCst),
            0,
            "no embedding worker may outlive the timed-out sync"
        );
    }

    #[tokio::test]
    async fn retry_stays_disabled_until_the_first_run_has_fully_exited() {
        let is_syncing = Arc::new(AtomicBool::new(false));
        assert!(is_syncing
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .is_ok());
        let guard = SyncGuard(Arc::clone(&is_syncing));
        let cancel = AtomicBool::new(false);

        let (_timed_out, ()) = await_sync_or_stop(
            &cancel,
            std::time::Duration::from_millis(5),
            async { tokio::time::sleep(std::time::Duration::from_millis(25)).await },
            || {},
        )
        .await;

        assert!(
            is_syncing.load(Ordering::SeqCst),
            "the command lock stays held while its safe shutdown completes"
        );
        drop(guard);
        assert!(
            !is_syncing.load(Ordering::SeqCst),
            "only the completed command may release Retry"
        );
    }

    #[tokio::test]
    async fn no_progress_event_can_overwrite_the_final_error_state() {
        let events = Arc::new(std::sync::Mutex::new(Vec::new()));
        let late_events = Arc::clone(&events);
        let emitter = tokio::spawn(async move {
            tokio::time::sleep(std::time::Duration::from_millis(30)).await;
            late_events.lock().expect("event list").push("syncing");
        });

        stop_progress_emitter(emitter).await;
        events.lock().expect("event list").push("error");
        tokio::time::sleep(std::time::Duration::from_millis(40)).await;

        assert_eq!(*events.lock().expect("event list"), vec!["error"]);
    }

    #[tokio::test]
    async fn a_real_command_level_lifecycle_proves_the_command_starts_emits_events_times_out_and_releases_its_lock(
    ) {
        let is_syncing = Arc::new(AtomicBool::new(false));
        assert!(is_syncing
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .is_ok());
        let guard = SyncGuard(Arc::clone(&is_syncing));
        let cancel = AtomicBool::new(false);
        let events = Arc::new(std::sync::Mutex::new(vec!["syncing"]));
        let timeout_events = Arc::clone(&events);

        let (timed_out, ()) = await_sync_or_stop(
            &cancel,
            std::time::Duration::from_millis(5),
            async { tokio::time::sleep(std::time::Duration::from_millis(20)).await },
            || timeout_events.lock().expect("event list").push("stopping"),
        )
        .await;
        events.lock().expect("event list").push("error");
        drop(guard);

        assert!(timed_out);
        assert_eq!(
            *events.lock().expect("event list"),
            vec!["syncing", "stopping", "error"]
        );
        assert!(
            !is_syncing.load(Ordering::SeqCst),
            "the completed command releases its single-flight lock"
        );
    }

    fn test_pending_crm_proposal() -> PendingCrmProposal {
        let mut proposal = PendingCrmProposal {
            proposal_id: "proposal-1".to_string(),
            provider: "wealthbox".to_string(),
            kind: "note".to_string(),
            matter_id: "matter-1".to_string(),
            household_key: "household-1".to_string(),
            content_hash: String::new(),
            title: "Follow-up note".to_string(),
            body: "Discussed Roth conversion planning.".to_string(),
            due_date: None,
            source_ref: "doc:meeting-notes.docx".to_string(),
            requested_at: Some("2026-07-09T12:00:00Z".to_string()),
            field: None,
            existing_value: None,
            new_value: None,
            final_value: None,
            provenance: Some("Generated from the July review meeting.".to_string()),
            meeting_visibility_json: None,
            ai_source_kind: Some("meeting".to_string()),
            ai_source_date: Some("2026-07-09".to_string()),
            status: "sending".to_string(),
            remote_id: None,
            error: None,
            created_at: "2026-07-09T12:00:01Z".to_string(),
            updated_at: "2026-07-09T12:00:01Z".to_string(),
        };
        proposal.content_hash = crm_proposal_content_hash(&proposal);
        proposal
    }

    #[test]
    fn verify_crm_proposal_rejects_content_hash_mismatch() {
        let mut proposal = test_pending_crm_proposal();
        proposal.body = "Tampered content after the advisor approved.".to_string();

        let err = verify_crm_proposal(&proposal).expect_err("tampered proposal must fail");
        assert_eq!(
            err,
            "CRM proposal no longer matches its saved approval hash"
        );
    }

    #[test]
    fn verify_crm_proposal_hash_binds_structured_meeting_visibility() {
        let mut proposal = test_pending_crm_proposal();
        proposal.meeting_visibility_json = Some(
            r#"{"kind":"proposal","id":"proposal-1","lineage":"legacy-unrestricted"}"#
                .to_string(),
        );
        proposal.content_hash = crm_proposal_content_hash(&proposal);
        verify_crm_proposal(&proposal).expect("structured visibility must verify");

        proposal.meeting_visibility_json = Some(
            r#"{"kind":"proposal","id":"different","lineage":"legacy-unrestricted"}"#
                .to_string(),
        );
        let error = verify_crm_proposal(&proposal)
            .expect_err("changed visibility must invalidate approval hash");
        assert_eq!(error, "CRM proposal no longer matches its saved approval hash");
    }

    #[test]
    fn verify_crm_proposal_rejects_already_sent() {
        let mut proposal = test_pending_crm_proposal();
        proposal.status = "sent".to_string();

        let err = verify_crm_proposal(&proposal).expect_err("sent proposal must fail");
        assert_eq!(err, "this CRM proposal was already sent");
    }

    #[test]
    fn verify_crm_proposal_rejects_missing_created_at() {
        let mut proposal = test_pending_crm_proposal();
        proposal.created_at = "   ".to_string();

        let err =
            verify_crm_proposal(&proposal).expect_err("proposal without created_at must fail");
        assert_eq!(err, "CRM proposal is missing its creation time");
    }

    #[test]
    fn verify_crm_proposal_accepts_valid_pending_proposal() {
        let proposal = test_pending_crm_proposal();

        verify_crm_proposal(&proposal).expect("valid pending proposal must pass");
    }

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
            connect_in_progress: Arc::new(AtomicBool::new(false)),
            downgrade_unconfirmed: tokio::sync::Mutex::new(std::collections::HashSet::new()),
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

    /// P1 (self-converge codex-review): a reconnect must not overwrite the
    /// token (and downgrade the ledger) while a write using the OLD token is
    /// still in flight — otherwise that write could complete afterward and
    /// record a fresh 'sent' row the downgrade never touched, which a later
    /// retry would wrongly trust as delivered under the NEW connection.
    #[tokio::test]
    async fn wait_for_writes_to_drain_waits_for_in_flight_write_then_returns_true() {
        let state = test_state(false);
        state.write_in_flight.store(1, Ordering::SeqCst); // a write is "in flight"

        let write_in_flight = state.write_in_flight.clone();
        tokio::spawn(async move {
            tokio::time::sleep(std::time::Duration::from_millis(30)).await;
            write_in_flight.store(0, Ordering::SeqCst);
        });

        let started = std::time::Instant::now();
        let drained = wait_for_writes_to_drain(&state).await;
        assert!(
            drained,
            "must report success once the write actually drains"
        );
        assert!(
            started.elapsed() >= std::time::Duration::from_millis(25),
            "must actually wait for the in-flight write, not return immediately"
        );
        assert_eq!(state.write_in_flight.load(Ordering::SeqCst), 0);
    }

    /// P2 (self-converge codex-review round 6): connect_in_progress must
    /// block a NEW write for the ENTIRE token-swap + downgrade transition,
    /// and must always reset — even on an early return via `?` inside that
    /// transition — so a failed connect attempt never leaves writes
    /// permanently blocked.
    #[test]
    fn connect_in_progress_guard_sets_and_always_resets_on_drop() {
        let flag = Arc::new(AtomicBool::new(false));
        flag.store(true, Ordering::SeqCst);
        {
            let _guard = ConnectInProgressGuard(flag.clone());
            assert!(
                flag.load(Ordering::SeqCst),
                "flag must be set while the guard is held"
            );
        }
        assert!(
            !flag.load(Ordering::SeqCst),
            "flag must reset once the guard drops"
        );
    }

    /// P2 (self-converge codex-review round 8): a plain `store(true)` per
    /// caller is unsafe for OVERLAPPING connect attempts — whichever
    /// finishes first would reset the flag while the second is still
    /// mid-transition. claim_connect_in_progress must refuse the second
    /// attempt outright instead.
    #[test]
    fn claim_connect_in_progress_refuses_a_second_overlapping_claim() {
        let state = test_state(false);
        let first = claim_connect_in_progress(&state);
        assert!(first.is_some(), "first claim must succeed");
        assert!(
            claim_connect_in_progress(&state).is_none(),
            "a second overlapping claim must be refused while the first is still held"
        );
        drop(first);
        assert!(
            claim_connect_in_progress(&state).is_some(),
            "a new claim must succeed once the first is released"
        );
    }

    /// Self-converge (review findings on lp/crm-9c-rust, P2): proves the
    /// primitive crm_set_workspace's race fix relies on — it must actually
    /// wait for a held claim to release, not return immediately, so a
    /// caller that then re-claims runs its own check strictly AFTER the
    /// original connect finishes (sequenced, not racing).
    #[tokio::test]
    async fn wait_for_connect_in_progress_to_clear_waits_for_the_flag_then_returns_true() {
        let state = test_state(false);
        let guard = claim_connect_in_progress(&state).expect("first claim must succeed");

        let connect_in_progress = state.connect_in_progress.clone();
        tokio::spawn(async move {
            tokio::time::sleep(std::time::Duration::from_millis(30)).await;
            drop(guard);
            let _ = connect_in_progress; // guard's Drop clears the flag; keep the clone alive until then
        });

        let started = std::time::Instant::now();
        let cleared = wait_for_connect_in_progress_to_clear(&state).await;
        assert!(cleared, "must report success once the claim is released");
        assert!(
            started.elapsed() >= std::time::Duration::from_millis(25),
            "must actually wait for the held claim, not return immediately"
        );
        assert!(
            claim_connect_in_progress(&state).is_some(),
            "a fresh claim must succeed once wait_for_connect_in_progress_to_clear reports cleared"
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
        use crate::commands::rag::chunker::{chunk_text, Chunk};
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
        use crate::commands::rag::chunker::{chunk_text, Chunk};
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
        use crate::commands::rag::chunker::{chunk_text, Chunk};
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

    /// CRM write intents are the fail-closed gate. The command writes this
    /// row before contacting Wealthbox; if the append fails, the command
    /// returns an error and the CRM write never starts.
    #[test]
    fn crm_write_audit_payload_marks_intent_as_must_persist() {
        let payload = crm_audit_payload_json_for_matter(
            "audit_crmwrite_dedup_intent",
            "2026-07-09T00:00:00Z",
            "wealthbox.create_note",
            "Note push requested to Wealthbox household 12345",
            "matter-1",
            "intent",
            "crmwrite_dedup",
        );
        let v: serde_json::Value = serde_json::from_str(&payload).expect("valid json");

        assert_eq!(v["action"], "wealthbox.create_note");
        assert_eq!(v["metadata"]["scope"]["kind"], "matter");
        assert_eq!(v["metadata"]["scope"]["matterId"], "matter-1");
        assert_eq!(v["metadata"]["auditPhase"], "intent");
        assert_eq!(v["metadata"]["auditPairId"], "crmwrite_dedup");
        assert_eq!(v["metadata"]["auditMustPersist"], true);
        assert_eq!(v["metadata"]["auditPersistenceStatus"], "saved");
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

    /// REVIEW FINDING 1 (self-converge, lp/crm-remainder): confirms both
    /// outcomes of the renamed downgrade helper — every connect path now
    /// calls this BEFORE storing the new token and must refuse the connect
    /// on `false`. Both cases live in ONE test (rather than two) because
    /// both need `LANTERN_HEADLESS_TEST_CRM_MASTER_KEY_HEX` set to bypass
    /// the OS keychain (which can BLOCK indefinitely on a headless box
    /// without a working D-Bus secret service) — that env var is
    /// process-global, and `cargo test` runs tests in parallel THREADS by
    /// default, so two separate tests each doing their own set/remove would
    /// race each other.
    #[tokio::test]
    async fn downgrade_stale_sent_rows_for_workspace_reports_success_and_failure_correctly() {
        const KEY_HEX: &str = "2222222222222222222222222222222222222222222222222222222222222222";
        std::env::set_var("LANTERN_HEADLESS_TEST_CRM_MASTER_KEY_HEX", KEY_HEX);

        // Success: a real, writable workspace with a seeded 'sent' row.
        let workspace = tempfile::TempDir::new().unwrap();
        let key: [u8; 32] = hex::decode(KEY_HEX).unwrap().try_into().unwrap();
        {
            let store =
                crate::commands::crm::store::CrmStore::open_with_key(workspace.path(), &key)
                    .expect("open crm store");
            store
                .outbound_upsert(
                    "dedup-1",
                    "wealthbox",
                    "note",
                    "12345",
                    "matter-1",
                    "doc:x",
                    "sent",
                    Some("999"),
                    true,
                    "ck-1",
                )
                .expect("seed a sent row");
        }
        let ok = downgrade_stale_sent_rows_for_workspace(
            workspace.path().to_path_buf(),
            CrmProvider::Wealthbox,
            "test",
        )
        .await;
        assert!(
            ok,
            "downgrade must report success against a real, writable workspace"
        );
        let store =
            crate::commands::crm::store::CrmStore::open_with_key(workspace.path(), &key).unwrap();
        let row = store.outbound_get("dedup-1").unwrap().unwrap();
        assert_eq!(
            row.status, "pending_verify",
            "the sent row must have been downgraded"
        );

        // Failure: the "workspace" is a plain file, so the DB can never be
        // opened — the caller (every crm_connect/crm_oauth_connect success
        // path) relies on this `false` to refuse the reconnect instead of
        // swapping the token.
        let not_a_workspace = tempfile::NamedTempFile::new().unwrap();
        let ok = downgrade_stale_sent_rows_for_workspace(
            not_a_workspace.path().to_path_buf(),
            CrmProvider::Wealthbox,
            "test",
        )
        .await;
        assert!(
            !ok,
            "must report failure when the underlying store can never be opened, so the caller fails closed"
        );

        std::env::remove_var("LANTERN_HEADLESS_TEST_CRM_MASTER_KEY_HEX");
    }
}
