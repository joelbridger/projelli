//! Atomic local Task creation from an encrypted, already-approved artifact.
//!
//! The renderer can identify only an artifact and revision. Client identity,
//! content, lineage, and delivery identity are reloaded from SQLCipher twice.

use anyhow::{bail, Context, Result};
use rusqlite::{params, OptionalExtension, Transaction};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};
use tauri::State;

use crate::commands::crm::{
    active_client_context::{
        capture_active_client_lease_for, hold_active_client_lease_through_transaction,
        ActiveClientLeaseExecutionGuard,
    },
    commands::CrmState,
    core_store::CrmCoreStore,
};

const TASK_KIND: &str = "task";
const FIRM_HOME: &str = "firm_home";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalMeetingTaskRequest {
    artifact_id: String,
    proposal_revision: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LocalMeetingTaskReceipt {
    pub artifact_id: String,
    pub proposal_revision: String,
    pub delivery_key: String,
    pub task_id: String,
    pub status: LocalMeetingTaskStatus,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum LocalMeetingTaskStatus {
    Created,
    Replayed,
}

#[derive(Clone, Debug)]
struct ApprovedTask {
    artifact_id: String,
    proposal_revision: String,
    household_id: String,
    matter_id: String,
    meeting_id: String,
    meeting_owner: String,
    visibility_policy_id: Option<String>,
    title: String,
    detail: String,
    owner_ref: Option<String>,
    due_date: Option<String>,
    approved_at: String,
}

fn text(value: Option<&Value>, name: &str) -> Result<String> {
    let Some(value) = value.and_then(Value::as_str) else {
        bail!("local meeting Task {name} is missing")
    };
    if value.is_empty() || value != value.trim() {
        bail!("local meeting Task {name} is malformed")
    }
    Ok(value.to_owned())
}

fn optional_text(value: Option<&Value>, name: &str) -> Result<Option<String>> {
    match value {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(v)) if !v.is_empty() && v == v.trim() => Ok(Some(v.clone())),
        _ => bail!("local meeting Task {name} is malformed"),
    }
}

fn object<'a>(value: Option<&'a Value>, name: &str) -> Result<&'a Map<String, Value>> {
    value
        .ok_or_else(|| anyhow::anyhow!("local meeting Task {name} is missing"))?
        .as_object()
        .ok_or_else(|| anyhow::anyhow!("local meeting Task {name} is malformed"))
}

fn exactly_one<'a>(
    records: &'a [Value],
    name: &str,
    predicate: impl Fn(&Value) -> bool,
) -> Result<&'a Value> {
    let matches: Vec<_> = records.iter().filter(|record| predicate(record)).collect();
    if matches.len() != 1 {
        bail!("local meeting Task {name} is missing or ambiguous")
    }
    Ok(matches[0])
}

fn same_kind_id(record: &Value, kind: &str, id: &str) -> bool {
    record.get("kind").and_then(Value::as_str) == Some(kind)
        && record.get("id").and_then(Value::as_str) == Some(id)
}

fn task_from_records(records: &[Value], request: &LocalMeetingTaskRequest) -> Result<ApprovedTask> {
    let artifact = object(
        Some(exactly_one(records, "artifact", |r| {
            same_kind_id(r, "meeting_artifact", &request.artifact_id)
        })?),
        "artifact",
    )?;
    let artifact_id = text(artifact.get("id"), "artifact id")?;
    let household_id = text(artifact.get("householdRef"), "artifact household")?;
    let matter_id = text(artifact.get("matterId"), "artifact matter")?;
    let meeting_id = text(artifact.get("meetingId"), "artifact meeting")?;
    if text(artifact.get("artifactState"), "artifact state")? != "produced"
        || text(artifact.get("artifactKind"), "artifact kind")?.is_empty()
        || artifact
            .get("schemaVersion")
            .and_then(Value::as_u64)
            .filter(|v| *v > 0)
            .is_none()
    {
        bail!("local meeting Task artifact is not live and produced")
    }
    let transition = object(
        Some(exactly_one(records, "approval transition", |r| {
            r.get("kind").and_then(Value::as_str) == Some("meeting_artifact_transition")
                && r.get("artifactId").and_then(Value::as_str) == Some(&artifact_id)
        })?),
        "approval transition",
    )?;
    if text(transition.get("householdRef"), "transition household")? != household_id
        || text(transition.get("matterId"), "transition matter")? != matter_id
        || text(transition.get("fromState"), "transition source")? != "produced"
        || text(transition.get("toState"), "transition target")? != "approved"
    {
        bail!("local meeting Task transition conflicts with artifact")
    }
    let proposal_revision = text(transition.get("proposalRevision"), "proposal revision")?;
    if proposal_revision != request.proposal_revision {
        bail!("local meeting Task approval revision is no longer current")
    }
    let proposal = object(transition.get("exactProposal"), "approved proposal")?;
    if text(proposal.get("kind"), "approved proposal kind")? != TASK_KIND {
        bail!("local meeting Task approved proposal is not a Task")
    }
    let meeting = object(
        Some(exactly_one(records, "parent meeting", |r| {
            same_kind_id(r, "meeting", &meeting_id)
        })?),
        "parent meeting",
    )?;
    if text(meeting.get("householdRef"), "meeting household")? != household_id
        || text(meeting.get("matterId"), "meeting matter")? != matter_id
    {
        bail!("local meeting Task meeting conflicts with artifact")
    }
    let meeting_owner = text(meeting.get("ownerRef"), "meeting owner")?;
    let visibility_policy_id = optional_text(meeting.get("visibilityPolicyId"), "meeting policy")?;
    let visibility = object(artifact.get("meetingVisibility"), "artifact visibility")?;
    let parent = object(visibility.get("parentRef"), "artifact visibility parent")?;
    if text(visibility.get("kind"), "artifact visibility kind")? != "meeting-artifact"
        || text(visibility.get("id"), "artifact visibility id")? != artifact_id
        || text(visibility.get("lineage"), "artifact visibility lineage")? != "derived"
        || text(visibility.get("ownerRef"), "artifact visibility owner")? != meeting_owner
        || text(parent.get("kind"), "artifact parent kind")? != "meeting-note"
        || text(parent.get("id"), "artifact parent id")? != meeting_id
        || optional_text(visibility.get("visibilityPolicyId"), "artifact policy")?
            != visibility_policy_id
    {
        bail!("local meeting Task visibility lineage conflicts with meeting")
    }
    Ok(ApprovedTask {
        artifact_id,
        proposal_revision,
        household_id,
        matter_id,
        meeting_id,
        meeting_owner,
        visibility_policy_id,
        title: text(proposal.get("title"), "Task title")?,
        detail: text(proposal.get("detail"), "Task detail")?,
        owner_ref: optional_text(proposal.get("ownerRef"), "Task owner")?,
        due_date: optional_text(proposal.get("dueDate"), "Task due date")?,
        approved_at: text(transition.get("transitionAt"), "approval timestamp")?,
    })
}

fn delivery_key(artifact_id: &str, proposal_revision: &str) -> String {
    let mut hash = 2_166_136_261_u32;
    for unit in format!("{artifact_id}\n{proposal_revision}").encode_utf16() {
        hash = (hash ^ u32::from(unit)).wrapping_mul(16_777_619);
    }
    format!("meeting-delivery-{}", radix36(hash))
}

fn radix36(mut value: u32) -> String {
    if value == 0 {
        return "0".into();
    };
    let mut out = Vec::new();
    while value > 0 {
        out.push(b"0123456789abcdefghijklmnopqrstuvwxyz"[(value % 36) as usize] as char);
        value /= 36;
    }
    out.iter().rev().collect()
}

fn local_task_record(approved: &ApprovedTask, key: &str) -> Value {
    let task_id = format!("task-{key}");
    let mut visibility = json!({"kind":"task","id":task_id,"lineage":"derived","parentRef":{"kind":"meeting-note","id":approved.meeting_id},"ownerRef":approved.meeting_owner});
    if let Some(policy) = &approved.visibility_policy_id {
        visibility["visibilityPolicyId"] = Value::String(policy.clone());
    }
    let mut task = json!({"id":task_id,"kind":TASK_KIND,"matterId":FIRM_HOME,"createdAt":approved.approved_at,"updatedAt":approved.approved_at,"createdBy":{"userId":approved.meeting_owner,"display":"","kind":"user"},"updatedBy":{"userId":approved.meeting_owner,"display":"","kind":"user"},"source":{"origin":"meeting","sources":[]},"deleted":false,"externalRefs":[],"schemaVersion":1,"householdRef":{"kind":"household","id":approved.household_id,"matterId":approved.matter_id},"title":approved.title,"body":approved.detail,"assigneeUserId":approved.owner_ref,"status":"open","priority":"normal","tagIds":[],"contextRefs":[],"customFields":{},"meetingVisibility":visibility,"meetingDeliveryKey":key});
    if let Some(due) = &approved.due_date {
        task["due"] = Value::String(due.clone());
    }
    task
}

fn hash(record: &Value) -> Result<String> {
    Ok(hex::encode(Sha256::digest(
        serde_json::to_vec(record).context("encode derived local Task")?,
    )))
}

fn live_records(tx: &Transaction<'_>) -> Result<Vec<Value>> {
    tx.prepare(
        "SELECT yjs_state FROM crm_docs WHERE doc_id LIKE 'live:%' AND deleted=0 ORDER BY doc_key",
    )?
    .query_map([], |row| row.get::<_, Vec<u8>>(0))?
    .map(|row| serde_json::from_slice(&row?).context("decode encrypted CRM record"))
    .collect()
}

fn count_rows(tx: &Transaction<'_>, table: &str) -> Result<i64> {
    Ok(
        tx.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
            row.get(0)
        })?,
    )
}

fn persist(
    store: &CrmCoreStore,
    request: &LocalMeetingTaskRequest,
    guard: ActiveClientLeaseExecutionGuard,
    fail_after_task_insert: bool,
) -> Result<LocalMeetingTaskReceipt> {
    store.with_immediate_transaction(|tx| {
        // The guard and permit arrive in this blocking closure and live until
        // commit/rollback has completed. This is the second encrypted reload.
        let approved = task_from_records(&live_records(tx)?, request)?;
        guard.require_exact_target(&approved.household_id, &approved.matter_id).map_err(anyhow::Error::msg)?;
        let delivery_key = delivery_key(&approved.artifact_id, &approved.proposal_revision);
        let task = local_task_record(&approved, &delivery_key);
        let task_id = text(task.get("id"), "derived Task id")?;
        let task_hash = hash(&task)?;
        let receipt: Option<(String, String, String, String)> = tx.query_row("SELECT artifact_id,proposal_revision,task_id,task_content_sha256 FROM local_task_delivery_receipts WHERE delivery_key=?1", [&delivery_key], |r| Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?))).optional()?;
        if let Some((artifact, revision, stored_id, stored_hash)) = receipt {
            if artifact != approved.artifact_id || revision != approved.proposal_revision || stored_id != task_id || stored_hash != task_hash { bail!("local meeting Task receipt identity no longer matches") }
            let bytes: Option<Vec<u8>> = tx.query_row("SELECT yjs_state FROM crm_docs WHERE doc_id=?1 AND matter_id=?2 AND deleted=0", params![format!("live:{task_id}"), FIRM_HOME], |r| r.get(0)).optional()?;
            if bytes.as_deref().map(|v| hex::encode(Sha256::digest(v))) != Some(task_hash) { bail!("local meeting Task receipt does not match durable Task") }
            return Ok(LocalMeetingTaskReceipt { artifact_id: approved.artifact_id, proposal_revision: approved.proposal_revision, delivery_key, task_id, status: LocalMeetingTaskStatus::Replayed });
        }
        if tx.query_row("SELECT 1 FROM crm_docs WHERE doc_id=?1 AND deleted=0", [format!("live:{task_id}")], |r| r.get::<_, i64>(0)).optional()?.is_some() { bail!("local meeting Task exists without matching receipt") }
        tx.execute("INSERT INTO crm_docs(doc_key,matter_id,doc_id,yjs_state,state_vector,updated_at,deleted) VALUES(?1,?2,?3,?4,?5,?6,0)", params![format!("{FIRM_HOME}/live:{task_id}"),FIRM_HOME,format!("live:{task_id}"),serde_json::to_vec(&task)?,Vec::<u8>::new(),approved.approved_at])?;
        // This is deliberately after the actual Task row and before receipt.
        if fail_after_task_insert { bail!("test-only failure after real Task insert") }
        tx.execute("INSERT INTO local_task_delivery_receipts(delivery_key,artifact_id,proposal_revision,task_id,task_content_sha256,recorded_at) VALUES(?1,?2,?3,?4,?5,?6)", params![delivery_key,approved.artifact_id,approved.proposal_revision,task_id,task_hash,approved.approved_at])?;
        Ok(LocalMeetingTaskReceipt { artifact_id: approved.artifact_id, proposal_revision: approved.proposal_revision, delivery_key, task_id, status: LocalMeetingTaskStatus::Created })
    })
}

fn read_approved_task(
    workspace: &std::path::Path,
    request: &LocalMeetingTaskRequest,
) -> Result<ApprovedTask> {
    task_from_records(
        &CrmCoreStore::open_read_only(workspace)?.list_live_records()?,
        request,
    )
}

async fn execute(
    state: &CrmState,
    request: LocalMeetingTaskRequest,
) -> Result<LocalMeetingTaskReceipt, String> {
    if request.artifact_id.trim().is_empty() || request.proposal_revision.trim().is_empty() {
        return Err("local meeting Task requires an artifact and approved revision".into());
    }
    let workspace = state.service().workspace().await?;
    let read_request = LocalMeetingTaskRequest {
        artifact_id: request.artifact_id.clone(),
        proposal_revision: request.proposal_revision.clone(),
    };
    let approved =
        tokio::task::spawn_blocking(move || read_approved_task(&workspace, &read_request))
            .await
            .map_err(|e| e.to_string())?
            .map_err(|e| e.to_string())?;
    let lease =
        capture_active_client_lease_for(state, &approved.household_id, &approved.matter_id).await?;
    let guard = hold_active_client_lease_through_transaction(state, lease).await?;
    tokio::task::spawn_blocking(move || {
        let store = CrmCoreStore::open(guard.workspace())?;
        persist(&store, &request, guard, false)
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())
}

/// Native-only one-way doorway. No client, content, authority, or receipt may
/// be supplied by the renderer.
#[tauri::command]
pub async fn crm_local_meeting_task_create(
    state: State<'_, CrmState>,
    request: LocalMeetingTaskRequest,
) -> Result<LocalMeetingTaskReceipt, String> {
    execute(&state, request).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::crm::core_store::CrmDocRow;
    use tempfile::TempDir;

    fn record(id: &str, kind: &str, matter: &str, fields: Value) -> Value {
        let mut r = fields.as_object().unwrap().clone();
        r.insert("id".into(), json!(id));
        r.insert("kind".into(), json!(kind));
        r.insert("matterId".into(), json!(matter));
        r.insert("createdAt".into(), json!("2026-07-24T10:00:00Z"));
        r.insert("updatedAt".into(), json!("2026-07-24T10:00:00Z"));
        Value::Object(r)
    }
    fn request() -> LocalMeetingTaskRequest {
        LocalMeetingTaskRequest {
            artifact_id: "artifact-a".into(),
            proposal_revision: "proposal-a".into(),
        }
    }
    fn seeded() -> (TempDir, CrmCoreStore) {
        let dir = TempDir::new().unwrap();
        let store = CrmCoreStore::open_with_key(dir.path(), &[7; 32]).unwrap();
        for r in [
            record(
                "meeting-a",
                "meeting",
                "matter-a",
                json!({"householdRef":"household-a","ownerRef":"advisor-a","visibilityPolicyId":"policy-a"}),
            ),
            record(
                "artifact-a",
                "meeting_artifact",
                "matter-a",
                json!({"householdRef":"household-a","meetingId":"meeting-a","artifactKind":"notes","schemaVersion":1,"artifactState":"produced","meetingVisibility":{"kind":"meeting-artifact","id":"artifact-a","lineage":"derived","ownerRef":"advisor-a","visibilityPolicyId":"policy-a","parentRef":{"kind":"meeting-note","id":"meeting-a"}}}),
            ),
            record(
                "transition-a",
                "meeting_artifact_transition",
                "matter-a",
                json!({"artifactId":"artifact-a","householdRef":"household-a","fromState":"produced","toState":"approved","proposalRevision":"proposal-a","transitionAt":"2026-07-24T10:01:00Z","exactProposal":{"kind":"task","title":"Call the CPA","detail":"Confirm taxes.","ownerRef":"advisor-a","dueDate":"2026-08-01"}}),
            ),
        ] {
            store.upsert_live_record(&r).unwrap();
        }
        (dir, store)
    }
    fn guard(dir: &TempDir) -> ActiveClientLeaseExecutionGuard {
        crate::commands::crm::active_client_context::test_execution_guard(
            dir.path().to_path_buf(),
            "household-a",
            "matter-a",
        )
    }
    #[test]
    fn exact_create_close_reopen_retry_and_real_between_insert_rollback() {
        let (fault_dir, fault_store) = seeded();
        assert!(persist(&fault_store, &request(), guard(&fault_dir), true).is_err());
        assert_eq!(
            fault_store
                .with_immediate_transaction(|tx| count_rows(tx, "crm_docs"))
                .unwrap(),
            3
        );
        assert_eq!(
            fault_store
                .with_immediate_transaction(|tx| count_rows(tx, "local_task_delivery_receipts"))
                .unwrap(),
            0
        );
        let (dir, store) = seeded();
        let created = persist(&store, &request(), guard(&dir), false).unwrap();
        assert_eq!(created.status, LocalMeetingTaskStatus::Created);
        let json = local_task_record(
            &task_from_records(&store.list_live_records().unwrap(), &request()).unwrap(),
            &created.delivery_key,
        );
        println!(
            "FOUNDATION_C_RUST_TASK_JSON:{}",
            serde_json::to_string(&json).unwrap()
        );
        drop(store);
        let reopened = CrmCoreStore::open_with_key(dir.path(), &[7; 32]).unwrap();
        assert_eq!(
            persist(&reopened, &request(), guard(&dir), false)
                .unwrap()
                .status,
            LocalMeetingTaskStatus::Replayed
        );
    }
    #[test]
    fn malformed_wrong_revision_and_orphan_refuse_without_receipt() {
        let (dir, store) = seeded();
        let mut bad = request();
        bad.proposal_revision = "wrong".into();
        assert!(task_from_records(&store.list_live_records().unwrap(), &bad).is_err());
        let key = delivery_key("artifact-a", "proposal-a");
        store
            .upsert_doc(&CrmDocRow {
                doc_key: format!("{FIRM_HOME}/live:task-{key}"),
                matter_id: FIRM_HOME.into(),
                doc_id: format!("live:task-{key}"),
                yjs_state: b"{}".to_vec(),
                state_vector: vec![],
                updated_at: "now".into(),
                deleted: false,
            })
            .unwrap();
        assert!(persist(&store, &request(), guard(&dir), false).is_err());
        let receipts = store
            .with_immediate_transaction(|tx| count_rows(tx, "local_task_delivery_receipts"))
            .unwrap();
        assert_eq!(receipts, 0);
    }
}
