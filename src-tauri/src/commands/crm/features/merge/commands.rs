//! Atomic, review-approved duplicate household merge operations.

use anyhow::{bail, Context, Result};
use chrono::{DateTime, Utc};
use rusqlite::{params, OptionalExtension, Transaction};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use tauri::State;

use crate::commands::crm::{commands::CrmState, core_store::CrmCoreStore};

const CHOOSABLE_FIELDS: &[&str] = &[
    "name",
    "lifecycle",
    "primaryAdvisor",
    "ownership",
    "serviceTier",
    "nextReview",
    "schedulingLinkUrl",
];
const NON_SCALAR_FIELDS: &[&str] = &[
    "facts", "accounts", "members", "externalParties", "notes", "customFields", "tags", "contextRefs", "extensionData",
];

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MergeApprovalRequest {
    source_id: String,
    target_id: String,
    matter_id: String,
    actor_id: String,
    idempotency_key: String,
    field_choices: std::collections::BTreeMap<String, MergeFieldChoice>,
}

#[derive(Debug, Deserialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum MergeFieldChoice { Source, Target }

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RedactedMergeReceipt {
    pub receipt_id: String,
    pub source_id: String,
    pub target_id: String,
    pub matter_id: String,
    pub approved_by: String,
    pub approved_at: String,
    pub moved_reference_count: usize,
    pub conflict_count: usize,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MergeApprovalResult { pub receipt: RedactedMergeReceipt, pub idempotent: bool }

struct StoredHousehold { doc_key: String, matter_id: String, record: Value }

#[derive(Debug, Clone, PartialEq, Eq)]
struct MergeAuthority { member_id: String }

fn require(value: &str, label: &str) -> Result<()> {
    if value.trim().is_empty() { bail!("CRM merge {label} is required") }
    Ok(())
}

fn read_household(transaction: &Transaction<'_>, id: &str, matter_id: &str) -> Result<StoredHousehold> {
    let row = transaction.query_row(
        "SELECT doc_key,matter_id,yjs_state FROM crm_docs WHERE doc_id=?1 AND matter_id=?2 AND deleted=0",
        params![format!("live:{id}"), matter_id],
        |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, Vec<u8>>(2)?)),
    ).optional()?.ok_or_else(|| anyhow::anyhow!("CRM household is not available for merge"))?;
    let record: Value = serde_json::from_slice(&row.2).context("decode CRM household")?;
    let object = record.as_object().ok_or_else(|| anyhow::anyhow!("CRM household must be an object"))?;
    if object.get("kind").and_then(Value::as_str) != Some("household") { bail!("CRM merge requires household records") }
    if object.get("ownership").and_then(Value::as_str) == Some("other") { bail!("CRM merge requires access to both households") }
    Ok(StoredHousehold { doc_key: row.0, matter_id: row.1, record })
}

fn role_permits_household(client_access: &str, member_id: &str, household: &Value) -> bool {
    if client_access == "firm-read" { return true; }
    let assigned = household.get("assignedMemberIds").and_then(Value::as_array)
        .is_some_and(|members| members.iter().any(|member| member.as_str() == Some(member_id)));
    match client_access {
        "assigned" => household.get("ownerMemberId").and_then(Value::as_str) == Some(member_id) || assigned,
        "shared" => assigned,
        _ => false,
    }
}

/// The caller identity is validated against the durable P0 teams-and-roles
/// tables in the same SQLCipher transaction as both household reads. Renderer
/// eligibility is therefore only a convenience; it cannot authorize a merge.
fn require_merge_authority(
    transaction: &Transaction<'_>, authority: &MergeAuthority, source: &Value, target: &Value,
) -> Result<()> {
    let (client_access, capabilities): (String, String) = transaction.query_row(
        "SELECT role.client_access,role.capabilities_json FROM crm_member_roles AS member JOIN crm_roles AS role ON role.role_id=member.role_id WHERE member.member_id=?1",
        [&authority.member_id], |row| Ok((row.get(0)?, row.get(1)?)),
    ).optional()?.ok_or_else(|| anyhow::anyhow!("CRM merge caller has no role assignment"))?;
    let capabilities: Vec<String> = serde_json::from_str(&capabilities).context("decode CRM merge role capabilities")?;
    if !capabilities.iter().any(|capability| capability == "clients:write") {
        bail!("CRM merge caller lacks client write access")
    }
    if !role_permits_household(&client_access, &authority.member_id, source)
        || !role_permits_household(&client_access, &authority.member_id, target) {
        bail!("CRM merge caller cannot access both households")
    }
    Ok(())
}

fn receipt_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<RedactedMergeReceipt> {
    Ok(RedactedMergeReceipt {
        receipt_id: row.get(0)?, source_id: row.get(1)?, target_id: row.get(2)?, matter_id: row.get(3)?,
        approved_by: row.get(4)?, approved_at: row.get(5)?,
        moved_reference_count: row.get::<_, i64>(6)? as usize, conflict_count: row.get::<_, i64>(7)? as usize,
    })
}

fn existing_receipt(transaction: &Transaction<'_>, idempotency_key: &str) -> Result<Option<RedactedMergeReceipt>> {
    Ok(transaction.query_row(
        "SELECT receipt_id,source_id,target_id,matter_id,approved_by,approved_at,moved_reference_count,conflict_count FROM crm_merge_receipts WHERE idempotency_key=?1",
        [idempotency_key], receipt_from_row,
    ).optional()?)
}

fn same_value(left: Option<&Value>, right: Option<&Value>) -> bool { left == right }

fn conflicting_non_scalar(source: Option<&Value>, target: Option<&Value>) -> bool {
    match (source, target) {
        (Some(Value::Null), _) | (_, Some(Value::Null)) => false,
        (Some(Value::Array(source)), Some(Value::Array(target))) => !source.is_empty() && !target.is_empty() && source != target,
        (Some(source), Some(target)) => source != target,
        _ => false,
    }
}

fn copy_non_scalar(
    result: &mut Map<String, Value>, field: &str, source: Option<&Value>, target: Option<&Value>,
    choices: &std::collections::BTreeMap<String, MergeFieldChoice>,
) -> Result<()> {
    if source.is_none() || source == Some(&Value::Null) { return Ok(()); }
    if conflicting_non_scalar(source, target) {
        match choices.get(field) {
            Some(MergeFieldChoice::Source) => { result.insert(field.to_string(), source.cloned().unwrap_or(Value::Null)); }
            Some(MergeFieldChoice::Target) => {}
            None => bail!("CRM merge requires an explicit choice for conflicting field {field}"),
        }
    } else if target.is_none() || target == Some(&Value::Null) {
        result.insert(field.to_string(), source.cloned().unwrap_or(Value::Null));
    }
    Ok(())
}

fn merge_household_values(source: &Value, target: &Value, choices: &std::collections::BTreeMap<String, MergeFieldChoice>) -> Result<(Value, usize, usize)> {
    let source_obj = source.as_object().ok_or_else(|| anyhow::anyhow!("invalid source household"))?;
    let target_obj = target.as_object().ok_or_else(|| anyhow::anyhow!("invalid target household"))?;
    let mut result: Map<String, Value> = target_obj.clone();
    let mut conflicts = 0usize;
    for field in CHOOSABLE_FIELDS {
        let source_value = source_obj.get(*field);
        let target_value = target_obj.get(*field);
        if source_value.is_none() || source_value == Some(&Value::Null) { continue; }
        if target_value.is_none() || target_value == Some(&Value::Null) {
            result.insert((*field).to_string(), source_value.cloned().unwrap_or(Value::Null));
            continue;
        }
        if !same_value(source_value, target_value) {
            conflicts += 1;
            match choices.get(*field) {
                Some(MergeFieldChoice::Source) => { result.insert((*field).to_string(), source_value.cloned().unwrap_or(Value::Null)); }
                Some(MergeFieldChoice::Target) => {}
                None => bail!("CRM merge requires an explicit choice for conflicting field {field}"),
            }
        }
    }
    for field in NON_SCALAR_FIELDS {
        if conflicting_non_scalar(source_obj.get(*field), target_obj.get(*field)) { conflicts += 1; }
        copy_non_scalar(&mut result, field, source_obj.get(*field), target_obj.get(*field), choices)?;
    }
    Ok((Value::Object(result), 0, conflicts))
}

/// Repoints every same-matter live reference to the surviving household in the
/// very transaction that hides the duplicate. This includes records that are
/// not currently mounted in the household screen, so a task or activity can
/// never retain a dangling duplicate reference after an approved merge.
fn reparent_household_references(
    transaction: &Transaction<'_>,
    source_id: &str,
    target_id: &str,
    matter_id: &str,
    updated_at: &str,
) -> Result<usize> {
    let rows = {
        let mut statement = transaction.prepare(
            "SELECT doc_key,yjs_state FROM crm_docs
             WHERE matter_id=?1 AND doc_id LIKE 'live:%' AND deleted=0",
        )?;
        statement.query_map([matter_id], |row| Ok((row.get::<_, String>(0)?, row.get::<_, Vec<u8>>(1)?)))?
            .collect::<rusqlite::Result<Vec<_>>>()?
    };
    let mut changed = 0usize;
    for (doc_key, bytes) in rows {
        if doc_key == format!("{matter_id}/live:{source_id}") || doc_key == format!("{matter_id}/live:{target_id}") { continue; }
        let mut record: Value = serde_json::from_slice(&bytes).context("decode CRM reference record")?;
        let Some(object) = record.as_object_mut() else { continue; };
        let mut touched = false;
        if object.get("householdId").and_then(Value::as_str) == Some(source_id) {
            object.insert("householdId".to_string(), Value::String(target_id.to_string()));
            touched = true;
        }
        if let Some(references) = object.get_mut("contextRefs").and_then(Value::as_array_mut) {
            for reference in references {
                if reference.get("kind").and_then(Value::as_str) == Some("household")
                    && reference.get("id").and_then(Value::as_str) == Some(source_id) {
                    if let Some(reference_object) = reference.as_object_mut() {
                        reference_object.insert("id".to_string(), Value::String(target_id.to_string()));
                        touched = true;
                    }
                }
            }
        }
        if touched {
            object.insert("updatedAt".to_string(), Value::String(updated_at.to_string()));
            transaction.execute(
                "UPDATE crm_docs SET yjs_state=?2,updated_at=?3 WHERE doc_key=?1 AND deleted=0",
                params![doc_key, serde_json::to_vec(&record)?, updated_at],
            )?;
            changed += 1;
        }
    }
    Ok(changed)
}

pub fn approve_household_merge(store: &CrmCoreStore, request: MergeApprovalRequest, now: DateTime<Utc>) -> Result<MergeApprovalResult> {
    require(&request.source_id, "source id")?; require(&request.target_id, "target id")?;
    require(&request.matter_id, "matter id")?; require(&request.actor_id, "actor")?; require(&request.idempotency_key, "idempotency key")?;
    if request.source_id == request.target_id { bail!("CRM merge source and surviving household must differ") }
    store.with_immediate_transaction(|transaction| {
        if let Some(receipt) = existing_receipt(transaction, &request.idempotency_key)? {
            if receipt.source_id != request.source_id || receipt.target_id != request.target_id || receipt.matter_id != request.matter_id { bail!("CRM merge idempotency key belongs to a different merge") }
            return Ok(MergeApprovalResult { receipt, idempotent: true });
        }
        let source = read_household(transaction, &request.source_id, &request.matter_id)?;
        let target = read_household(transaction, &request.target_id, &request.matter_id)?;
        if source.matter_id != request.matter_id || target.matter_id != request.matter_id { bail!("CRM merge cannot cross household access boundaries") }
        require_merge_authority(transaction, &MergeAuthority { member_id: request.actor_id.trim().to_owned() }, &source.record, &target.record)?;
        let (mut merged, embedded_reference_count, conflict_count) = merge_household_values(&source.record, &target.record, &request.field_choices)?;
        let mut entropy = [0_u8; 8];
        rand::RngCore::fill_bytes(&mut rand::thread_rng(), &mut entropy);
        let receipt_id = format!("merge:{}:{}", now.timestamp_nanos_opt().unwrap_or_default(), hex::encode(entropy));
        let approved_at = now.to_rfc3339();
        let object = merged.as_object_mut().expect("merge result is object");
        object.insert("id".to_string(), Value::String(request.target_id.clone()));
        object.insert("kind".to_string(), Value::String("household".to_string()));
        object.insert("matterId".to_string(), Value::String(target.matter_id.clone()));
        object.insert("updatedAt".to_string(), Value::String(approved_at.clone()));
        let encoded = serde_json::to_vec(&merged)?;
        transaction.execute("UPDATE crm_docs SET yjs_state=?2,updated_at=?3 WHERE doc_key=?1 AND deleted=0", params![target.doc_key, encoded, approved_at])?;
        let moved_reference_count = embedded_reference_count + reparent_household_references(
            transaction, &request.source_id, &request.target_id, &target.matter_id, &approved_at,
        )?;
        // The source remains available until every validation, target update,
        // and receipt write below are in the one transaction. A failure rolls
        // all of them back, so an unapproved proposal cannot mutate either row.
        transaction.execute("UPDATE crm_docs SET deleted=1,updated_at=?2 WHERE doc_key=?1 AND deleted=0", params![source.doc_key, approved_at])?;
        transaction.execute("INSERT INTO crm_merge_receipts(receipt_id,idempotency_key,source_id,target_id,matter_id,approved_by,approved_at,moved_reference_count,conflict_count) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9)", params![receipt_id, request.idempotency_key, request.source_id, request.target_id, target.matter_id, request.actor_id.trim(), approved_at, moved_reference_count as i64, conflict_count as i64])?;
        Ok(MergeApprovalResult { receipt: RedactedMergeReceipt { receipt_id, source_id: request.source_id, target_id: request.target_id, matter_id: target.matter_id, approved_by: request.actor_id.trim().to_owned(), approved_at, moved_reference_count, conflict_count }, idempotent: false })
    })
}

pub fn find_merge_receipt(store: &CrmCoreStore, receipt_id: &str) -> Result<Option<RedactedMergeReceipt>> {
    require(receipt_id, "receipt id")?;
    store.transaction(|transaction| Ok(transaction.query_row("SELECT receipt_id,source_id,target_id,matter_id,approved_by,approved_at,moved_reference_count,conflict_count FROM crm_merge_receipts WHERE receipt_id=?1", [receipt_id], receipt_from_row).optional()?))
}

#[tauri::command]
pub async fn crm_merge_households_approve(state: State<'_, CrmState>, workspace_root: String, request: MergeApprovalRequest) -> Result<MergeApprovalResult, String> {
    // Hold the native active-workspace lock through the destructive SQLCipher
    // transaction. A later workspace switch waits, rather than redirecting a
    // merge after its caller has reviewed a different household.
    let workspace_guard = state.workspace.lock().await;
    let workspace = workspace_guard.clone().ok_or_else(|| "Open a workspace before using CRM data.".to_string())?;
    if workspace != std::path::PathBuf::from(workspace_root) { return Err("The active workspace changed. Reload the household and try again.".to_string()); }
    let result = tokio::task::spawn_blocking(move || approve_household_merge(&CrmCoreStore::open(&workspace)?, request, Utc::now())).await.map_err(|error| error.to_string())?.map_err(|error| error.to_string());
    drop(workspace_guard);
    result
}

#[tauri::command]
pub async fn crm_merge_receipt_get(state: State<'_, CrmState>, workspace_root: String, receipt_id: String) -> Result<Option<RedactedMergeReceipt>, String> {
    let workspace_guard = state.workspace.lock().await;
    let workspace = workspace_guard.clone().ok_or_else(|| "Open a workspace before using CRM data.".to_string())?;
    if workspace != std::path::PathBuf::from(workspace_root) { return Err("The active workspace changed. Reload the household and try again.".to_string()); }
    let result = tokio::task::spawn_blocking(move || find_merge_receipt(&CrmCoreStore::open(&workspace)?, &receipt_id)).await.map_err(|error| error.to_string())?.map_err(|error| error.to_string());
    drop(workspace_guard);
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn record(id: &str, matter_id: &str, name: &str, fact: &str) -> Value { serde_json::json!({"id": id, "kind": "household", "matterId": matter_id, "name": name, "lifecycle": "Active", "primaryAdvisor": "advisor", "ownerMemberId": "advisor-1", "ownership": "mine", "serviceTier": "Standard", "facts": [{"id": fact}], "members": []}) }
    fn seed(store: &CrmCoreStore, record: &Value) { store.upsert_live_record(record).unwrap(); }
    fn authorize(store: &CrmCoreStore, member_id: &str) {
        store.with_immediate_transaction(|transaction| {
            transaction.execute("INSERT INTO crm_member_roles(member_id,role_id,updated_at) VALUES(?1,'advisor','now')", [member_id])?;
            Ok(())
        }).unwrap();
    }
    fn request() -> MergeApprovalRequest { MergeApprovalRequest { source_id: "source".into(), target_id: "target".into(), matter_id: "matter-1".into(), actor_id: "advisor-1".into(), idempotency_key: "merge-1".into(), field_choices: [("name".into(), MergeFieldChoice::Target), ("facts".into(), MergeFieldChoice::Source)].into_iter().collect() } }

    #[test]
    fn approved_merge_is_atomic_idempotent_and_survives_reopen() {
        let directory = TempDir::new().unwrap(); let key = [13; 32]; let store = CrmCoreStore::open_with_key(directory.path(), &key).unwrap();
        authorize(&store, "advisor-1");
        seed(&store, &record("source", "matter-1", "Source", "fact-1")); seed(&store, &record("target", "matter-1", "Target", "fact-2"));
        seed(&store, &serde_json::json!({"id": "task-1", "kind": "task", "matterId": "matter-1", "householdId": "source", "contextRefs": [{"kind": "household", "id": "source"}]}));
        let result = approve_household_merge(&store, request(), Utc::now()).unwrap(); assert!(!result.idempotent); assert_eq!(result.receipt.moved_reference_count, 1);
        let retry = approve_household_merge(&store, request(), Utc::now()).unwrap(); assert!(retry.idempotent); assert_eq!(retry.receipt.receipt_id, result.receipt.receipt_id);
        drop(store); let reopened = CrmCoreStore::open_with_key(directory.path(), &key).unwrap();
        let records = reopened.list_live_records().unwrap(); assert_eq!(records.len(), 2); assert_eq!(records.iter().find(|record| record["id"] == "target").unwrap()["facts"].as_array().unwrap().len(), 1);
        let task = records.iter().find(|record| record["id"] == "task-1").unwrap(); assert_eq!(task["householdId"], "target"); assert_eq!(task["contextRefs"][0]["id"], "target");
        assert_eq!(find_merge_receipt(&reopened, &result.receipt.receipt_id).unwrap(), Some(result.receipt));
    }

    #[test]
    fn unapproved_conflict_and_cross_matter_leave_both_households_live_after_reload() {
        let directory = TempDir::new().unwrap(); let store = CrmCoreStore::open_with_key(directory.path(), &[14; 32]).unwrap();
        authorize(&store, "advisor-1");
        seed(&store, &record("source", "matter-1", "Source", "fact-1")); seed(&store, &record("target", "matter-1", "Target", "fact-2"));
        let mut no_choice = request(); no_choice.field_choices.clear(); assert!(approve_household_merge(&store, no_choice, Utc::now()).is_err()); assert_eq!(store.list_live_records().unwrap().len(), 2);
        seed(&store, &record("target-2", "matter-2", "Target", "fact-3")); let mut cross = request(); cross.target_id = "target-2".into(); assert!(approve_household_merge(&store, cross, Utc::now()).is_err()); assert_eq!(store.list_live_records().unwrap().len(), 3);
        drop(store);
        let reopened = CrmCoreStore::open_with_key(directory.path(), &[14; 32]).unwrap();
        assert_eq!(reopened.list_live_records().unwrap().len(), 3);
    }

    #[test]
    fn unauthorized_or_cross_household_merge_is_refused_without_mutation() {
        let directory = TempDir::new().unwrap(); let store = CrmCoreStore::open_with_key(directory.path(), &[15; 32]).unwrap();
        authorize(&store, "advisor-1");
        seed(&store, &record("source", "matter-1", "Source", "fact-1"));
        let mut foreign = record("target", "matter-1", "Target", "fact-2");
        foreign.as_object_mut().unwrap().insert("ownerMemberId".into(), Value::String("other-advisor".into()));
        seed(&store, &foreign);
        assert!(approve_household_merge(&store, request(), Utc::now()).unwrap_err().to_string().contains("cannot access both households"));
        assert_eq!(store.list_live_records().unwrap().len(), 2);
    }

    #[test]
    fn non_scalar_conflict_requires_advisor_choice_and_rolls_back() {
        let directory = TempDir::new().unwrap(); let key = [16; 32]; let store = CrmCoreStore::open_with_key(directory.path(), &key).unwrap();
        authorize(&store, "advisor-1");
        seed(&store, &record("source", "matter-1", "Source", "fact-1")); seed(&store, &record("target", "matter-1", "Target", "fact-2"));
        let mut no_fact_choice = request(); no_fact_choice.field_choices.remove("facts");
        assert!(approve_household_merge(&store, no_fact_choice, Utc::now()).unwrap_err().to_string().contains("facts"));
        drop(store);
        let reopened = CrmCoreStore::open_with_key(directory.path(), &key).unwrap();
        assert_eq!(reopened.list_live_records().unwrap().len(), 2);
    }
}
