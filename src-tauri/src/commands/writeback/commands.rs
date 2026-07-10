use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{Manager, State};

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

#[tauri::command]
pub async fn external_write_set_workspace(
    state: State<'_, ExternalWriteState>,
    path: String,
) -> Result<(), String> {
    *state.workspace.lock().await = Some(PathBuf::from(path));
    Ok(())
}

#[tauri::command]
pub async fn external_write_save_proposal(
    state: State<'_, ExternalWriteState>,
    proposal: ExternalWriteProposalDto,
) -> Result<ExternalWriteProposalRecordDto, String> {
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
    let store = store_from_state(&state).await?;
    store
        .proposal_list_pending()
        .map(|rows| rows.into_iter().map(proposal_to_dto).collect())
        .map_err(|e| e.to_string())
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
    store
        .proposal_delete(&proposal_id)
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn external_write_approve_proposal(
    state: State<'_, ExternalWriteState>,
    proposal_id: String,
) -> Result<ExternalWriteReceipt, String> {
    let store = store_from_state(&state).await?;
    let mut proposal = store
        .proposal_get(&proposal_id)
        .map_err(|e| e.to_string())?
        .ok_or("external write proposal not found - reopen the client and try again")?;
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
    let socket = socket_for_target(proposal.target)?;

    match push_external_write(socket.as_ref(), &store, &state.write_guard, &req).await {
        Ok(receipt) => {
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
        Err(err) => {
            proposal.status = match err {
                ExternalWriteError::VerifyPending => "verify_pending",
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

#[allow(dead_code)]
fn request_dedup_key_for_test(req: &ExternalWriteRequest) -> String {
    dedup_key(req)
}
