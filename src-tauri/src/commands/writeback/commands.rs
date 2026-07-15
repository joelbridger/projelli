use std::path::PathBuf;

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::commands::audit::{store::AuditEntryRecord, AuditState};
use crate::commands::writeback::engine::{
    dedup_key, push_external_write, validate_requested_at, ExternalWriteError,
    ExternalWriteInFlightGuard, ExternalWriteSocket,
};
use crate::commands::writeback::holistiplan::HolistiplanSocket;
use crate::commands::writeback::model::{
    ExternalWriteOperation, ExternalWriteReceipt, ExternalWriteRequest, ExternalWriteStatus,
    ExternalWriteTarget,
};
use crate::commands::writeback::rightcapital::RightCapitalSocket;
use crate::commands::writeback::store::{ExternalWriteStore, PendingExternalWriteProposal};

pub struct ExternalWriteState {
    pub workspace: tokio::sync::Mutex<Option<PathBuf>>,
    pub write_guard: ExternalWriteInFlightGuard,
}

pub fn manage_state(app: &tauri::App) {
    app.manage(ExternalWriteState {
        workspace: tokio::sync::Mutex::new(None),
        write_guard: ExternalWriteInFlightGuard::new(),
    });
}

const WRITEBACK_AUDIT_APPENDED_EVENT: &str = "writeback-audit-appended";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalWriteProposalDto {
    pub id: String,
    pub target: ExternalWriteTarget,
    pub operation: ExternalWriteOperation,
    pub matter_id: String,
    pub subject_key: Option<String>,
    pub source_ref: String,
    pub requested_at: Option<String>,
    pub before_hash: Option<String>,
    pub after_hash: String,
    pub current_json: Option<String>,
    pub source_json: Option<String>,
    pub final_json: Option<String>,
    pub status: Option<ExternalWriteStatus>,
    pub remote_id: Option<String>,
    pub receipt_ref: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalWriteProposalRecordDto {
    pub id: String,
    pub target: ExternalWriteTarget,
    pub operation: ExternalWriteOperation,
    pub matter_id: String,
    pub subject_key: String,
    pub source_ref: String,
    pub requested_at: Option<String>,
    pub before_hash: Option<String>,
    pub after_hash: String,
    pub current_json: String,
    pub source_json: String,
    pub final_json: String,
    pub status: String,
    pub remote_id: Option<String>,
    pub receipt_ref: Option<String>,
    pub error: Option<String>,
    pub content_hash: String,
    pub created_at: String,
    pub updated_at: String,
}

async fn store_from_state(
    state: &State<'_, ExternalWriteState>,
) -> Result<ExternalWriteStore, String> {
    let workspace = state
        .workspace
        .lock()
        .await
        .clone()
        .ok_or("workspace not set - call external_write_set_workspace first")?;
    ExternalWriteStore::open(&workspace).map_err(|e| e.to_string())
}

fn status_to_str(status: Option<ExternalWriteStatus>) -> String {
    match status.unwrap_or(ExternalWriteStatus::Proposed) {
        ExternalWriteStatus::Proposed => "proposed",
        ExternalWriteStatus::Sending => "sending",
        ExternalWriteStatus::Sent => "sent",
        ExternalWriteStatus::Failed => "failed",
        ExternalWriteStatus::VerifyPending => "verify_pending",
        ExternalWriteStatus::Stale => "stale",
    }
    .to_string()
}

fn hash_part(h: &mut Sha256, value: Option<&str>) {
    if let Some(value) = value {
        h.update(value.as_bytes());
    }
    h.update([0u8]);
}

fn proposal_content_hash(proposal: &PendingExternalWriteProposal) -> String {
    let mut h = Sha256::new();
    hash_part(&mut h, Some(proposal.target.as_str()));
    hash_part(&mut h, Some(proposal.operation.operation_name()));
    hash_part(
        &mut h,
        Some(&serde_json::to_string(&proposal.operation).unwrap_or_default()),
    );
    hash_part(&mut h, Some(&proposal.matter_id));
    hash_part(&mut h, Some(&proposal.subject_key));
    hash_part(&mut h, Some(&proposal.source_ref));
    hash_part(&mut h, proposal.requested_at.as_deref());
    hash_part(&mut h, proposal.before_hash.as_deref());
    hash_part(&mut h, Some(&proposal.after_hash));
    hash_part(&mut h, Some(&proposal.current_json));
    hash_part(&mut h, Some(&proposal.source_json));
    hash_part(&mut h, Some(&proposal.final_json));
    hex::encode(h.finalize())
}

fn proposal_from_dto(
    dto: ExternalWriteProposalDto,
) -> Result<PendingExternalWriteProposal, String> {
    if dto.id.trim().is_empty() {
        return Err("external write proposal id is required".into());
    }
    if dto.matter_id.trim().is_empty() {
        return Err("matter id is required".into());
    }
    if dto.source_ref.trim().is_empty() {
        return Err("source reference is required".into());
    }
    if dto.after_hash.trim().is_empty() {
        return Err("after hash is required".into());
    }
    if dto.operation.target() != dto.target {
        return Err("external write target and operation do not match".into());
    }
    let mut proposal = PendingExternalWriteProposal {
        proposal_id: dto.id,
        target: dto.target,
        operation: dto.operation,
        matter_id: dto.matter_id,
        subject_key: dto.subject_key.unwrap_or_default(),
        source_ref: dto.source_ref,
        requested_at: dto.requested_at,
        before_hash: dto.before_hash,
        after_hash: dto.after_hash,
        current_json: dto.current_json.unwrap_or_else(|| "{}".into()),
        source_json: dto.source_json.unwrap_or_else(|| "{}".into()),
        final_json: dto.final_json.unwrap_or_else(|| "{}".into()),
        status: status_to_str(dto.status),
        remote_id: dto.remote_id,
        receipt_ref: dto.receipt_ref,
        error: dto.error,
        content_hash: String::new(),
        created_at: String::new(),
        updated_at: String::new(),
    };
    proposal.content_hash = proposal_content_hash(&proposal);
    Ok(proposal)
}

fn proposal_to_dto(proposal: PendingExternalWriteProposal) -> ExternalWriteProposalRecordDto {
    ExternalWriteProposalRecordDto {
        id: proposal.proposal_id,
        target: proposal.target,
        operation: proposal.operation,
        matter_id: proposal.matter_id,
        subject_key: proposal.subject_key,
        source_ref: proposal.source_ref,
        requested_at: proposal.requested_at,
        before_hash: proposal.before_hash,
        after_hash: proposal.after_hash,
        current_json: proposal.current_json,
        source_json: proposal.source_json,
        final_json: proposal.final_json,
        status: proposal.status,
        remote_id: proposal.remote_id,
        receipt_ref: proposal.receipt_ref,
        error: proposal.error,
        content_hash: proposal.content_hash,
        created_at: proposal.created_at,
        updated_at: proposal.updated_at,
    }
}

fn verify_proposal(proposal: &PendingExternalWriteProposal) -> Result<(), String> {
    let expected = proposal_content_hash(proposal);
    if expected != proposal.content_hash {
        return Err("external write proposal no longer matches its saved approval hash".into());
    }
    Ok(())
}

fn socket_for_target(target: ExternalWriteTarget) -> Result<Box<dyn ExternalWriteSocket>, String> {
    match target {
        ExternalWriteTarget::Rightcapital => Ok(Box::new(RightCapitalSocket::mock())),
        ExternalWriteTarget::Holistiplan => Ok(Box::new(HolistiplanSocket::mock())),
        ExternalWriteTarget::Wealthbox => {
            Err("Wealthbox is not routed through the new writeback engine yet".into())
        }
    }
}

fn writeback_audit_payload_json_for_matter(
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
            "source": "writeback-backend",
            "scope": { "kind": "matter", "matterId": matter_id },
            "auditPhase": audit_phase,
            "auditPairId": audit_pair_id,
            "auditMustPersist": true,
            "auditPersistenceStatus": "saved",
        },
    })
    .to_string()
}

fn writeback_audit_failure_message(audit_phase: &str, detail: Option<String>) -> String {
    let base = if audit_phase == "intent" {
        "Audit log is unavailable, so the external write was blocked before anything was sent."
            .to_string()
    } else {
        "Audit log is unavailable after the external write attempt; the external write result could not be recorded durably."
            .to_string()
    };
    match detail {
        Some(detail) => format!("{base}: {detail}"),
        None => base,
    }
}

fn build_writeback_audit_record(
    action: &str,
    description: &str,
    matter_id: &str,
    write_dedup_key: Option<&str>,
    audit_phase: &str,
    audit_pair_id: &str,
) -> AuditEntryRecord {
    let timestamp = chrono::Utc::now().to_rfc3339();
    let id = match write_dedup_key {
        Some(key) => format!("audit_extwrite_{key}_{audit_phase}"),
        None => {
            let nanos = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or_default();
            let mut rng_bytes = [0u8; 4];
            rand::RngCore::fill_bytes(&mut rand::thread_rng(), &mut rng_bytes);
            format!(
                "audit_extwrite_{}_{}_{}",
                audit_phase,
                nanos,
                hex::encode(rng_bytes)
            )
        }
    };
    let payload_json = writeback_audit_payload_json_for_matter(
        &id,
        &timestamp,
        action,
        description,
        matter_id,
        audit_phase,
        audit_pair_id,
    );
    AuditEntryRecord {
        id,
        timestamp,
        action: action.to_string(),
        description: description.to_string(),
        payload_json,
    }
}

async fn append_writeback_audit_must_for_matter(
    app: &AppHandle,
    action: &str,
    description: &str,
    matter_id: &str,
    write_dedup_key: Option<&str>,
    audit_phase: &str,
    audit_pair_id: &str,
) -> Result<(), String> {
    use crate::commands::audit::store::EncryptedAuditStore;

    let ws_opt: Option<PathBuf> = {
        let audit_ws = app.state::<AuditState>().workspace.lock().await.clone();
        if audit_ws.is_some() {
            audit_ws
        } else {
            app.state::<ExternalWriteState>()
                .workspace
                .lock()
                .await
                .clone()
        }
    };
    let Some(ws) = ws_opt else {
        return Err(writeback_audit_failure_message(audit_phase, None));
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
        let rec = build_writeback_audit_record(
            &action_s,
            &desc_s,
            &matter_id_s,
            write_dedup_key.as_deref(),
            &audit_phase_s,
            &audit_pair_id_s,
        );
        store.append(&rec)?;
        Ok(rec)
    })
    .await;

    match result {
        Ok(Ok(rec)) => {
            let _ = app.emit(WRITEBACK_AUDIT_APPENDED_EVENT, &rec);
            Ok(())
        }
        Ok(Err(e)) => Err(writeback_audit_failure_message(
            &audit_phase_for_error,
            Some(format!("{e:#}")),
        )),
        Err(e) => Err(writeback_audit_failure_message(
            &audit_phase_for_error,
            Some(e.to_string()),
        )),
    }
}

#[async_trait]
trait WritebackAuditAppender: Send + Sync {
    async fn append_writeback_audit(
        &self,
        action: &str,
        description: &str,
        matter_id: &str,
        write_dedup_key: Option<&str>,
        audit_phase: &str,
        audit_pair_id: &str,
    ) -> Result<(), String>;
}

struct TauriWritebackAuditAppender<'a> {
    app: &'a AppHandle,
}

#[async_trait]
impl WritebackAuditAppender for TauriWritebackAuditAppender<'_> {
    async fn append_writeback_audit(
        &self,
        action: &str,
        description: &str,
        matter_id: &str,
        write_dedup_key: Option<&str>,
        audit_phase: &str,
        audit_pair_id: &str,
    ) -> Result<(), String> {
        append_writeback_audit_must_for_matter(
            self.app,
            action,
            description,
            matter_id,
            write_dedup_key,
            audit_phase,
            audit_pair_id,
        )
        .await
    }
}

async fn approve_external_write_proposal_with_socket<A: WritebackAuditAppender + ?Sized>(
    store: &ExternalWriteStore,
    write_guard: &ExternalWriteInFlightGuard,
    mut proposal: PendingExternalWriteProposal,
    socket: &dyn ExternalWriteSocket,
    audit: &A,
) -> Result<ExternalWriteReceipt, String> {
    verify_proposal(&proposal)?;
    let requested_at = proposal
        .requested_at
        .clone()
        .ok_or("external write proposal has not been prepared for approval")?;
    if proposal.subject_key.trim().is_empty() {
        return Err("target client or household is required".into());
    }

    let req = ExternalWriteRequest {
        target: proposal.target,
        operation: proposal.operation.clone(),
        matter_id: proposal.matter_id.clone(),
        subject_key: proposal.subject_key.clone(),
        source_ref: proposal.source_ref.clone(),
        requested_at,
        before_hash: proposal.before_hash.clone(),
        after_hash: proposal.after_hash.clone(),
    };
    let action = format!("external_write.{}", req.operation.operation_name());
    let write_dedup_key = dedup_key(&req);
    let audit_pair_id = format!("extwrite_{write_dedup_key}");
    let operation = req.operation.operation_name();
    let target = req.target.as_str();
    let intent_description = format!(
        "{operation} write requested for {target} subject {} in matter {} (source: {})",
        req.subject_key, req.matter_id, req.source_ref
    );
    audit
        .append_writeback_audit(
            &action,
            &intent_description,
            &req.matter_id,
            Some(&write_dedup_key),
            "intent",
            &audit_pair_id,
        )
        .await?;

    match push_external_write(socket, store, write_guard, &req).await {
        Ok(receipt) => {
            let description = format!(
                "{operation} sent to {target} subject {} in matter {}; remote id {} (source: {})",
                req.subject_key, req.matter_id, receipt.remote_id, req.source_ref
            );
            audit
                .append_writeback_audit(
                    &action,
                    &description,
                    &req.matter_id,
                    Some(&write_dedup_key),
                    "outcome",
                    &audit_pair_id,
                )
                .await?;

            proposal.status = "sent".into();
            proposal.remote_id = Some(receipt.remote_id.clone());
            proposal.receipt_ref = Some(receipt.receipt_ref.clone());
            proposal.error = None;
            proposal.content_hash = proposal_content_hash(&proposal);
            store.proposal_upsert(&proposal).map_err(|e| {
                format!("external write sent, but local status could not be saved: {e}")
            })?;
            Ok(receipt)
        }
        Err(ExternalWriteError::VerifyPending) => {
            let description = format!(
                "{operation} may have been sent to {target} subject {} in matter {} (source: {}); delivery unconfirmed, will verify on retry",
                req.subject_key, req.matter_id, req.source_ref
            );
            audit
                .append_writeback_audit(
                    &action,
                    &description,
                    &req.matter_id,
                    Some(&format!("{write_dedup_key}_ambiguous")),
                    "outcome",
                    &audit_pair_id,
                )
                .await?;

            proposal.status = "verify_pending".into();
            proposal.error = Some(ExternalWriteError::VerifyPending.to_string());
            proposal.content_hash = proposal_content_hash(&proposal);
            let _ = store.proposal_upsert(&proposal);
            Err(ExternalWriteError::VerifyPending.to_string())
        }
        Err(err) => {
            proposal.status = match err {
                ExternalWriteError::StaleExternalValue { .. } => "stale",
                _ => "failed",
            }
            .into();
            proposal.error = Some(err.to_string());
            proposal.content_hash = proposal_content_hash(&proposal);
            let _ = store.proposal_upsert(&proposal);
            Err(err.to_string())
        }
    }
}

#[tauri::command]
pub async fn external_write_set_workspace(
    state: State<'_, ExternalWriteState>,
    path: String,
) -> Result<(), String> {
    *state.workspace.lock().await = Some(PathBuf::from(path));
    Ok(())
}

/// Own-clients guard for external-write proposals: each carries client content
/// (`current_json`/`source_json`/`final_json`) tied to a matter, so a scoped
/// member may only create/modify/remove/approve one in a matter they own. No-op
/// when the flag is off; deny-closed with no bound member.
async fn require_external_matter_in_scope(
    state: &State<'_, ExternalWriteState>,
    matter_id: &str,
) -> Result<(), String> {
    use crate::commands::crm::features::permissions::commands as perms;
    if !perms::own_clients_permissions_enabled() {
        return Ok(());
    }
    let ws = state
        .workspace
        .lock()
        .await
        .clone()
        .ok_or_else(|| "workspace not set - call external_write_set_workspace first".to_string())?;
    let current = perms::native_current_member();
    let matter = matter_id.to_string();
    let allowed = tokio::task::spawn_blocking(move || {
        let core = crate::commands::crm::core_store::CrmCoreStore::open(&ws)?;
        Ok::<bool, anyhow::Error>(
            perms::matter_read_scope(&core, true, current.as_ref())?.allows(&matter),
        )
    })
    .await
    .map_err(|error| error.to_string())?
    .map_err(|error| error.to_string())?;
    if !allowed {
        return Err("This client is outside the current member's client scope.".into());
    }
    Ok(())
}

#[tauri::command]
pub async fn external_write_save_proposal(
    state: State<'_, ExternalWriteState>,
    proposal: ExternalWriteProposalDto,
) -> Result<ExternalWriteProposalRecordDto, String> {
    require_external_matter_in_scope(&state, &proposal.matter_id).await?;
    let proposal = proposal_from_dto(proposal)?;
    let store = store_from_state(&state).await?;
    store
        .proposal_upsert(&proposal)
        .map(proposal_to_dto)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn external_write_prepare_proposal(
    state: State<'_, ExternalWriteState>,
    proposal_id: String,
    subject_key: String,
    requested_at: String,
) -> Result<ExternalWriteProposalRecordDto, String> {
    if proposal_id.trim().is_empty() {
        return Err("external write proposal id is required".into());
    }
    if subject_key.trim().is_empty() {
        return Err("target client or household is required".into());
    }
    validate_requested_at(&requested_at).map_err(|e| e.to_string())?;

    let store = store_from_state(&state).await?;
    let mut proposal = store
        .proposal_get(&proposal_id)
        .map_err(|e| e.to_string())?
        .ok_or("external write proposal not found - reopen the client and try again")?;
    require_external_matter_in_scope(&state, &proposal.matter_id).await?;
    if proposal.status == "sent" {
        return Err("this external write proposal was already sent".into());
    }
    proposal.subject_key = subject_key;
    proposal.requested_at = Some(requested_at);
    proposal.status = "sending".into();
    proposal.error = None;
    proposal.content_hash = proposal_content_hash(&proposal);
    store
        .proposal_upsert(&proposal)
        .map(proposal_to_dto)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn external_write_list_proposals(
    state: State<'_, ExternalWriteState>,
) -> Result<Vec<ExternalWriteProposalRecordDto>, String> {
    use crate::commands::crm::features::permissions::commands as perms;
    let store = store_from_state(&state).await?;
    let dtos: Vec<ExternalWriteProposalRecordDto> = store
        .proposal_list_pending()
        .map(|rows| rows.into_iter().map(proposal_to_dto).collect())
        .map_err(|e| e.to_string())?;
    if !perms::own_clients_permissions_enabled() {
        return Ok(dtos);
    }
    // Own-clients doorway: each pending proposal carries client content tied to a
    // matter. Filter to the member's readable matters; deny-closed with no member.
    let ws = state
        .workspace
        .lock()
        .await
        .clone()
        .ok_or_else(|| "workspace not set - call external_write_set_workspace first".to_string())?;
    let current = perms::native_current_member();
    let scope = tokio::task::spawn_blocking(move || {
        let core = crate::commands::crm::core_store::CrmCoreStore::open(&ws)?;
        perms::matter_read_scope(&core, true, current.as_ref())
    })
    .await
    .map_err(|error| error.to_string())?
    .map_err(|error| error.to_string())?;
    Ok(dtos
        .into_iter()
        .filter(|dto| scope.allows(&dto.matter_id))
        .collect())
}

#[tauri::command]
pub async fn external_write_delete_proposal(
    state: State<'_, ExternalWriteState>,
    proposal_id: String,
) -> Result<(), String> {
    if proposal_id.trim().is_empty() {
        return Ok(());
    }
    let store = store_from_state(&state).await?;
    // A scoped member may only delete a proposal in a matter they own.
    if let Some(proposal) = store.proposal_get(&proposal_id).map_err(|e| e.to_string())? {
        require_external_matter_in_scope(&state, &proposal.matter_id).await?;
    }
    store
        .proposal_delete(&proposal_id)
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn external_write_approve_proposal(
    app: AppHandle,
    state: State<'_, ExternalWriteState>,
    proposal_id: String,
) -> Result<ExternalWriteReceipt, String> {
    let store = store_from_state(&state).await?;
    let proposal = store
        .proposal_get(&proposal_id)
        .map_err(|e| e.to_string())?
        .ok_or("external write proposal not found - reopen the client and try again")?;
    require_external_matter_in_scope(&state, &proposal.matter_id).await?;
    let socket = socket_for_target(proposal.target)?;
    let audit = TauriWritebackAuditAppender { app: &app };
    approve_external_write_proposal_with_socket(
        &store,
        &state.write_guard,
        proposal,
        socket.as_ref(),
        &audit,
    )
    .await
}

#[allow(dead_code)]
fn request_dedup_key_for_test(req: &ExternalWriteRequest) -> String {
    dedup_key(req)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::audit::store::EncryptedAuditStore;
    use crate::commands::writeback::engine::hash_json_value;
    use crate::commands::writeback::model::{
        ExternalCurrentValue, ExternalRemoteResult, ExternalVerifyResult, IncomeFrequency,
        MoneyAmount, RightCapitalIncomeType, RightCapitalOperation,
    };
    use async_trait::async_trait;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};

    const WRITEBACK_KEY: [u8; 32] = [0x7Au8; 32];
    const AUDIT_KEY: [u8; 32] = [0x31u8; 32];

    fn test_store() -> (tempfile::TempDir, ExternalWriteStore) {
        let dir = tempfile::tempdir().unwrap();
        let store = ExternalWriteStore::open_with_key(dir.path(), &WRITEBACK_KEY).unwrap();
        (dir, store)
    }

    fn test_proposal(id: &str, raw_marker: &str) -> PendingExternalWriteProposal {
        let final_value = serde_json::json!({
            "incomeId": "income-1",
            "amount": 185000,
            "rawVendorPayload": raw_marker,
        });
        let mut proposal = PendingExternalWriteProposal {
            proposal_id: id.into(),
            target: ExternalWriteTarget::Rightcapital,
            operation: ExternalWriteOperation::Rightcapital(RightCapitalOperation::UpsertIncome {
                client_id: "rc-client-1".into(),
                income_id: None,
                income_type: RightCapitalIncomeType::Salary,
                owner: Some("Robert".into()),
                amount: MoneyAmount {
                    amount: 185000.0,
                    currency: "USD".into(),
                },
                frequency: IncomeFrequency::Annual,
                start_date: None,
                end_date: None,
                notes: format!("approved from meeting; raw marker {raw_marker}"),
            }),
            matter_id: "matter-1".into(),
            subject_key: "rc-household-1".into(),
            source_ref: "meeting:income-review".into(),
            requested_at: Some("2026-07-10T12:00:00Z".into()),
            before_hash: None,
            after_hash: hash_json_value(&final_value),
            current_json: format!(r#"{{"rawVendorPayload":"{raw_marker}-current"}}"#),
            source_json: format!(r#"{{"rawVendorPayload":"{raw_marker}-source"}}"#),
            final_json: serde_json::to_string(&final_value).unwrap(),
            status: "sending".into(),
            remote_id: None,
            receipt_ref: None,
            error: None,
            content_hash: String::new(),
            created_at: String::new(),
            updated_at: String::new(),
        };
        proposal.content_hash = proposal_content_hash(&proposal);
        proposal
    }

    fn request_from_proposal(proposal: &PendingExternalWriteProposal) -> ExternalWriteRequest {
        ExternalWriteRequest {
            target: proposal.target,
            operation: proposal.operation.clone(),
            matter_id: proposal.matter_id.clone(),
            subject_key: proposal.subject_key.clone(),
            source_ref: proposal.source_ref.clone(),
            requested_at: proposal.requested_at.clone().unwrap(),
            before_hash: proposal.before_hash.clone(),
            after_hash: proposal.after_hash.clone(),
        }
    }

    fn audit_rows(workspace: &std::path::Path) -> Vec<AuditEntryRecord> {
        let store = EncryptedAuditStore::open_with_key(workspace, &AUDIT_KEY).unwrap();
        store.list(None, None).unwrap()
    }

    fn audit_phase(row: &AuditEntryRecord) -> String {
        let v: serde_json::Value = serde_json::from_str(&row.payload_json).unwrap();
        v["metadata"]["auditPhase"].as_str().unwrap().to_string()
    }

    struct TestAuditAppender {
        workspace: PathBuf,
        key: [u8; 32],
    }

    #[async_trait]
    impl WritebackAuditAppender for TestAuditAppender {
        async fn append_writeback_audit(
            &self,
            action: &str,
            description: &str,
            matter_id: &str,
            write_dedup_key: Option<&str>,
            audit_phase: &str,
            audit_pair_id: &str,
        ) -> Result<(), String> {
            let store = EncryptedAuditStore::open_with_key(&self.workspace, &self.key)
                .map_err(|e| writeback_audit_failure_message(audit_phase, Some(e.to_string())))?;
            let rec = build_writeback_audit_record(
                action,
                description,
                matter_id,
                write_dedup_key,
                audit_phase,
                audit_pair_id,
            );
            store
                .append(&rec)
                .map_err(|e| writeback_audit_failure_message(audit_phase, Some(e.to_string())))?;
            Ok(())
        }
    }

    #[derive(Clone, Copy)]
    enum SocketMode {
        Success,
        VerifyPending,
    }

    struct RecordingSocket {
        mode: SocketMode,
        audit_workspace: Option<PathBuf>,
        apply_calls: AtomicUsize,
        intent_seen_before_apply: AtomicBool,
        outcome_seen_before_apply: AtomicBool,
    }

    impl RecordingSocket {
        fn success(audit_workspace: PathBuf) -> Self {
            Self {
                mode: SocketMode::Success,
                audit_workspace: Some(audit_workspace),
                apply_calls: AtomicUsize::new(0),
                intent_seen_before_apply: AtomicBool::new(false),
                outcome_seen_before_apply: AtomicBool::new(false),
            }
        }

        fn verify_pending(audit_workspace: PathBuf) -> Self {
            Self {
                mode: SocketMode::VerifyPending,
                audit_workspace: Some(audit_workspace),
                apply_calls: AtomicUsize::new(0),
                intent_seen_before_apply: AtomicBool::new(false),
                outcome_seen_before_apply: AtomicBool::new(false),
            }
        }

        fn uncalled() -> Self {
            Self {
                mode: SocketMode::Success,
                audit_workspace: None,
                apply_calls: AtomicUsize::new(0),
                intent_seen_before_apply: AtomicBool::new(false),
                outcome_seen_before_apply: AtomicBool::new(false),
            }
        }
    }

    #[async_trait]
    impl ExternalWriteSocket for RecordingSocket {
        fn target_id(&self) -> &'static str {
            "rightcapital"
        }

        fn supports(&self, operation: &ExternalWriteOperation) -> bool {
            operation.target() == ExternalWriteTarget::Rightcapital
        }

        async fn read_current(
            &self,
            req: &ExternalWriteRequest,
        ) -> Result<ExternalCurrentValue, ExternalWriteError> {
            Ok(ExternalCurrentValue {
                remote_id: None,
                hash: req
                    .before_hash
                    .clone()
                    .unwrap_or_else(|| hash_json_value(&serde_json::json!({ "empty": true }))),
                summary: Some("current".into()),
            })
        }

        async fn apply(
            &self,
            _req: &ExternalWriteRequest,
        ) -> Result<ExternalRemoteResult, ExternalWriteError> {
            self.apply_calls.fetch_add(1, Ordering::SeqCst);
            if let Some(workspace) = &self.audit_workspace {
                let rows = audit_rows(workspace);
                self.intent_seen_before_apply.store(
                    rows.iter().any(|row| audit_phase(row) == "intent"),
                    Ordering::SeqCst,
                );
                self.outcome_seen_before_apply.store(
                    rows.iter().any(|row| audit_phase(row) == "outcome"),
                    Ordering::SeqCst,
                );
            }
            match self.mode {
                SocketMode::Success => Ok(ExternalRemoteResult {
                    remote_id: "rc-income-remote-1".into(),
                    status_code: Some(200),
                    response_hash: Some("raw-response-hash-only".into()),
                }),
                SocketMode::VerifyPending => Err(ExternalWriteError::VerifyPending),
            }
        }

        async fn verify(
            &self,
            req: &ExternalWriteRequest,
            remote: Option<&ExternalRemoteResult>,
        ) -> Result<ExternalVerifyResult, ExternalWriteError> {
            Ok(ExternalVerifyResult {
                applied: true,
                remote_id: remote.map(|r| r.remote_id.clone()),
                receipt_ref: Some(format!(
                    "external-write:{}:{}:receipt",
                    req.matter_id,
                    req.target.as_str()
                )),
                current_hash: Some(req.after_hash.clone()),
            })
        }
    }

    #[tokio::test]
    async fn approve_appends_intent_before_apply_and_outcome_after_success() {
        let (workspace, store) = test_store();
        let proposal = store
            .proposal_upsert(&test_proposal("proposal-success", "RAW_VENDOR_SECRET"))
            .unwrap();
        let guard = ExternalWriteInFlightGuard::new();
        let audit = TestAuditAppender {
            workspace: workspace.path().to_path_buf(),
            key: AUDIT_KEY,
        };
        let socket = RecordingSocket::success(workspace.path().to_path_buf());

        let receipt =
            approve_external_write_proposal_with_socket(&store, &guard, proposal, &socket, &audit)
                .await
                .unwrap();

        assert_eq!(receipt.remote_id, "rc-income-remote-1");
        assert_eq!(socket.apply_calls.load(Ordering::SeqCst), 1);
        assert!(socket.intent_seen_before_apply.load(Ordering::SeqCst));
        assert!(!socket.outcome_seen_before_apply.load(Ordering::SeqCst));

        let rows = audit_rows(workspace.path());
        assert_eq!(rows.len(), 2);
        assert_eq!(audit_phase(&rows[0]), "intent");
        assert_eq!(audit_phase(&rows[1]), "outcome");
    }

    #[tokio::test]
    async fn audit_append_failure_refuses_approval_before_apply() {
        let (_workspace, store) = test_store();
        let proposal = store
            .proposal_upsert(&test_proposal("proposal-audit-fails", "RAW_VENDOR_SECRET"))
            .unwrap();
        let guard = ExternalWriteInFlightGuard::new();
        let not_a_workspace = tempfile::NamedTempFile::new().unwrap();
        let audit = TestAuditAppender {
            workspace: not_a_workspace.path().to_path_buf(),
            key: AUDIT_KEY,
        };
        let socket = RecordingSocket::uncalled();

        let err =
            approve_external_write_proposal_with_socket(&store, &guard, proposal, &socket, &audit)
                .await
                .unwrap_err();

        assert!(
            err.contains("Audit log is unavailable"),
            "unexpected error: {err}"
        );
        assert_eq!(socket.apply_calls.load(Ordering::SeqCst), 0);
    }

    #[tokio::test]
    async fn verify_pending_outcome_uses_distinct_ambiguous_audit_id() {
        let (workspace, store) = test_store();
        let proposal = store
            .proposal_upsert(&test_proposal(
                "proposal-verify-pending",
                "RAW_VENDOR_SECRET",
            ))
            .unwrap();
        let req = request_from_proposal(&proposal);
        let expected_ambiguous_id = format!("audit_extwrite_{}_ambiguous_outcome", dedup_key(&req));
        let guard = ExternalWriteInFlightGuard::new();
        let audit = TestAuditAppender {
            workspace: workspace.path().to_path_buf(),
            key: AUDIT_KEY,
        };
        let socket = RecordingSocket::verify_pending(workspace.path().to_path_buf());

        let err =
            approve_external_write_proposal_with_socket(&store, &guard, proposal, &socket, &audit)
                .await
                .unwrap_err();

        assert!(err.contains("Delivery unconfirmed"));
        let rows = audit_rows(workspace.path());
        assert_eq!(rows.len(), 2);
        let intent = rows
            .iter()
            .find(|row| audit_phase(row) == "intent")
            .unwrap();
        let outcome = rows
            .iter()
            .find(|row| audit_phase(row) == "outcome")
            .unwrap();
        assert_ne!(intent.id, outcome.id);
        assert_eq!(outcome.id, expected_ambiguous_id);
    }

    #[tokio::test]
    async fn audit_descriptions_do_not_include_raw_vendor_payload_json() {
        let marker = "RAW_VENDOR_SECRET_DO_NOT_LOG";
        let (workspace, store) = test_store();
        let proposal = store
            .proposal_upsert(&test_proposal("proposal-no-raw-json", marker))
            .unwrap();
        let guard = ExternalWriteInFlightGuard::new();
        let audit = TestAuditAppender {
            workspace: workspace.path().to_path_buf(),
            key: AUDIT_KEY,
        };
        let socket = RecordingSocket::success(workspace.path().to_path_buf());

        approve_external_write_proposal_with_socket(&store, &guard, proposal, &socket, &audit)
            .await
            .unwrap();

        let rows = audit_rows(workspace.path());
        assert_eq!(rows.len(), 2);
        for row in rows {
            assert!(
                !row.description.contains(marker),
                "raw payload marker leaked into audit description: {}",
                row.description
            );
            assert!(
                !row.description.contains("rawVendorPayload"),
                "raw payload JSON key leaked into audit description: {}",
                row.description
            );
        }
    }
}
