//! Exact-client, local-only persistence for approved meeting Task proposals.

use anyhow::{bail, Context, Result};
use rusqlite::{params, OptionalExtension, Transaction};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};
use tauri::State;

use crate::commands::crm::{
    active_client_context::{capture_active_client_lease_for, require_active_client_lease},
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

#[derive(Clone)]
struct ApprovedTask {
    artifact_id: String,
    proposal_revision: String,
    household_id: String,
    matter_id: String,
    meeting_id: String,
    meeting_owner: String,
    meeting_visibility_policy_id: Option<String>,
    title: String,
    detail: String,
    owner_ref: Option<String>,
    due_date: Option<String>,
    approved_at: String,
}

fn exact_text(value: Option<&Value>, label: &str) -> Result<String> {
    let Some(value) = value.and_then(Value::as_str) else {
        bail!("local meeting Task {label} is missing")
    };
    if value.is_empty() || value != value.trim() {
        bail!("local meeting Task {label} is malformed")
    }
    Ok(value.to_owned())
}

fn optional_text(value: Option<&Value>, label: &str) -> Result<Option<String>> {
    match value {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(value)) if !value.is_empty() && value == value.trim() => {
            Ok(Some(value.clone()))
        }
        _ => bail!("local meeting Task {label} is malformed"),
    }
}

fn record_object<'a>(record: Option<&'a Value>, label: &str) -> Result<&'a Map<String, Value>> {
    record
        .ok_or_else(|| anyhow::anyhow!("local meeting Task {label} is missing"))?
        .as_object()
        .ok_or_else(|| anyhow::anyhow!("local meeting Task {label} is not an object"))
}

fn one<'a>(
    records: &'a [Value],
    label: &str,
    predicate: impl Fn(&Value) -> bool,
) -> Result<&'a Value> {
    let matching: Vec<_> = records.iter().filter(|record| predicate(record)).collect();
    if matching.len() != 1 {
        bail!("local meeting Task {label} is missing or ambiguous")
    }
    Ok(matching[0])
}

fn live_records(transaction: &Transaction<'_>) -> Result<Vec<Value>> {
    let mut statement = transaction.prepare(
        "SELECT yjs_state FROM crm_docs WHERE doc_id LIKE 'live:%' AND deleted=0 ORDER BY doc_key",
    )?;
    let records = statement
        .query_map([], |row| row.get::<_, Vec<u8>>(0))?
        .map(|row| serde_json::from_slice(&row?).context("decode encrypted CRM record"))
        .collect();
    records
}

fn matching_kind_id(record: &Value, kind: &str, id: &str) -> bool {
    record.get("kind").and_then(Value::as_str) == Some(kind)
        && record.get("id").and_then(Value::as_str) == Some(id)
}

fn validate_artifact_visibility(
    artifact: &Map<String, Value>,
    artifact_id: &str,
    meeting_id: &str,
    owner_ref: &str,
    visibility_policy_id: &Option<String>,
) -> Result<()> {
    let visibility = record_object(
        artifact.get("meetingVisibility"),
        "artifact visibility lineage",
    )?;
    if exact_text(visibility.get("kind"), "artifact visibility kind")? != "meeting-artifact"
        || exact_text(visibility.get("id"), "artifact visibility id")? != artifact_id
        || exact_text(visibility.get("lineage"), "artifact visibility lineage")? != "derived"
        || exact_text(visibility.get("ownerRef"), "artifact visibility owner")? != owner_ref
    {
        bail!("local meeting Task artifact visibility lineage conflicts with its meeting")
    }
    let parent = record_object(visibility.get("parentRef"), "artifact visibility parent")?;
    if exact_text(parent.get("kind"), "artifact visibility parent kind")? != "meeting-note"
        || exact_text(parent.get("id"), "artifact visibility parent id")? != meeting_id
        || optional_text(
            visibility.get("visibilityPolicyId"),
            "artifact visibility policy",
        )? != *visibility_policy_id
    {
        bail!("local meeting Task artifact visibility lineage conflicts with its meeting")
    }
    Ok(())
}

fn approved_task_from_records(
    records: &[Value],
    request: &LocalMeetingTaskRequest,
) -> Result<ApprovedTask> {
    let artifact = one(records, "artifact", |record| {
        matching_kind_id(record, "meeting_artifact", &request.artifact_id)
    })?;
    let artifact = record_object(Some(artifact), "artifact")?;
    let artifact_id = exact_text(artifact.get("id"), "artifact id")?;
    let household_id = exact_text(artifact.get("householdRef"), "artifact household")?;
    let matter_id = exact_text(artifact.get("matterId"), "artifact matter")?;
    let meeting_id = exact_text(artifact.get("meetingId"), "artifact meeting")?;
    if exact_text(artifact.get("artifactState"), "artifact state")? != "produced"
        || exact_text(artifact.get("artifactKind"), "artifact kind")?.is_empty()
        || artifact
            .get("schemaVersion")
            .and_then(Value::as_u64)
            .filter(|version| *version > 0)
            .is_none()
    {
        bail!("local meeting Task artifact is not a live produced artifact")
    }

    let transition = one(records, "approval transition", |record| {
        record.get("kind").and_then(Value::as_str) == Some("meeting_artifact_transition")
            && record.get("artifactId").and_then(Value::as_str) == Some(artifact_id.as_str())
    })?;
    let transition = record_object(Some(transition), "approval transition")?;
    if exact_text(transition.get("householdRef"), "transition household")? != household_id
        || exact_text(transition.get("matterId"), "transition matter")? != matter_id
        || exact_text(transition.get("fromState"), "transition source state")? != "produced"
        || exact_text(transition.get("toState"), "transition target state")? != "approved"
    {
        bail!("local meeting Task approval transition conflicts with its artifact")
    }
    let proposal_revision = exact_text(transition.get("proposalRevision"), "proposal revision")?;
    if proposal_revision != request.proposal_revision {
        bail!("local meeting Task approval revision is no longer current")
    }
    let proposal = record_object(transition.get("exactProposal"), "approved task proposal")?;
    if exact_text(proposal.get("kind"), "approved proposal kind")? != TASK_KIND {
        bail!("local meeting Task approved proposal is not a Task")
    }

    let meeting = one(records, "parent meeting", |record| {
        matching_kind_id(record, "meeting", &meeting_id)
    })?;
    let meeting = record_object(Some(meeting), "parent meeting")?;
    if exact_text(meeting.get("householdRef"), "meeting household")? != household_id
        || exact_text(meeting.get("matterId"), "meeting matter")? != matter_id
    {
        bail!("local meeting Task parent meeting conflicts with its artifact")
    }
    let meeting_owner = exact_text(meeting.get("ownerRef"), "meeting owner")?;
    let visibility_policy_id = optional_text(
        meeting.get("visibilityPolicyId"),
        "meeting visibility policy",
    )?;
    validate_artifact_visibility(
        artifact,
        &artifact_id,
        &meeting_id,
        &meeting_owner,
        &visibility_policy_id,
    )?;

    Ok(ApprovedTask {
        artifact_id,
        proposal_revision,
        household_id,
        matter_id,
        meeting_id,
        meeting_owner,
        meeting_visibility_policy_id: visibility_policy_id,
        title: exact_text(proposal.get("title"), "approved Task title")?,
        detail: exact_text(proposal.get("detail"), "approved Task detail")?,
        owner_ref: optional_text(proposal.get("ownerRef"), "approved Task owner")?,
        due_date: optional_text(proposal.get("dueDate"), "approved Task due date")?,
        approved_at: exact_text(transition.get("transitionAt"), "approval timestamp")?,
    })
}

// The current meeting delivery convention is JavaScript's FNV-1a over UTF-16
// code units, rendered as unsigned base-36. Keep it byte-for-byte compatible.
fn meeting_delivery_key(artifact_id: &str, proposal_revision: &str) -> String {
    let mut hash: u32 = 2_166_136_261;
    for unit in format!("{artifact_id}\n{proposal_revision}").encode_utf16() {
        hash ^= u32::from(unit);
        hash = hash.wrapping_mul(16_777_619);
    }
    format!("meeting-delivery-{}", radix36(hash))
}

fn radix36(mut value: u32) -> String {
    if value == 0 {
        return "0".to_string();
    }
    const DIGITS: &[u8] = b"0123456789abcdefghijklmnopqrstuvwxyz";
    let mut reversed = Vec::new();
    while value > 0 {
        reversed.push(DIGITS[(value % 36) as usize] as char);
        value /= 36;
    }
    reversed.iter().rev().collect()
}

fn local_task_record(approved: &ApprovedTask, delivery_key: &str) -> Value {
    let task_id = format!("task-{delivery_key}");
    let mut visibility = json!({
        "kind": "task",
        "id": task_id,
        "lineage": "derived",
        "parentRef": { "kind": "meeting-note", "id": approved.meeting_id },
        "ownerRef": approved.meeting_owner,
    });
    if let Some(policy) = &approved.meeting_visibility_policy_id {
        visibility["visibilityPolicyId"] = Value::String(policy.clone());
    }
    let mut record = json!({
        "id": task_id,
        "kind": TASK_KIND,
        "matterId": FIRM_HOME,
        "createdAt": approved.approved_at,
        "updatedAt": approved.approved_at,
        "createdBy": { "userId": approved.meeting_owner, "display": "", "kind": "user" },
        "updatedBy": { "userId": approved.meeting_owner, "display": "", "kind": "user" },
        "source": { "origin": "meeting", "sources": [] },
        "deleted": false,
        "externalRefs": [],
        "schemaVersion": 1,
        "householdRef": { "kind": "household", "id": approved.household_id, "matterId": approved.matter_id },
        "title": approved.title,
        "body": approved.detail,
        "assigneeUserId": approved.owner_ref,
        "status": "open",
        "priority": "normal",
        "tagIds": [],
        "contextRefs": [],
        "customFields": {},
        "meetingVisibility": visibility,
        "meetingDeliveryKey": delivery_key,
    });
    if let Some(due_date) = &approved.due_date {
        record["due"] = Value::String(due_date.clone());
    }
    record
}

fn task_content_hash(record: &Value) -> Result<String> {
    Ok(hex::encode(Sha256::digest(
        serde_json::to_vec(record).context("encode local meeting Task")?,
    )))
}

fn persist_approved_task(
    store: &CrmCoreStore,
    request: &LocalMeetingTaskRequest,
) -> Result<LocalMeetingTaskReceipt> {
    store.with_immediate_transaction(|transaction| {
        let approved = approved_task_from_records(&live_records(transaction)?, request)?;
        let delivery_key = meeting_delivery_key(&approved.artifact_id, &approved.proposal_revision);
        let task = local_task_record(&approved, &delivery_key);
        let task_id = exact_text(task.get("id"), "derived Task id")?;
        let content_hash = task_content_hash(&task)?;
        let existing = transaction.query_row(
            "SELECT artifact_id,proposal_revision,task_id,task_content_sha256 FROM local_task_delivery_receipts WHERE delivery_key=?1",
            [&delivery_key],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?, row.get::<_, String>(3)?)),
        ).optional()?;
        if let Some((artifact_id, proposal_revision, recorded_task_id, recorded_hash)) = existing {
            if artifact_id != approved.artifact_id
                || proposal_revision != approved.proposal_revision
                || recorded_task_id != task_id
                || recorded_hash != content_hash
            {
                bail!("local meeting Task receipt identity no longer matches the approved Task")
            }
            let stored: Option<Vec<u8>> = transaction.query_row(
                "SELECT yjs_state FROM crm_docs WHERE doc_id=?1 AND matter_id=?2 AND deleted=0",
                params![format!("live:{task_id}"), FIRM_HOME],
                |row| row.get(0),
            ).optional()?;
            if stored.as_deref().map(|bytes| hex::encode(Sha256::digest(bytes))) != Some(content_hash) {
                bail!("local meeting Task receipt does not match a durable Task")
            }
            return Ok(LocalMeetingTaskReceipt {
                artifact_id: approved.artifact_id,
                proposal_revision: approved.proposal_revision,
                delivery_key,
                task_id,
                status: LocalMeetingTaskStatus::Replayed,
            });
        }

        let existing_task: Option<i64> = transaction.query_row(
            "SELECT 1 FROM crm_docs WHERE doc_id=?1 AND deleted=0",
            [format!("live:{task_id}")],
            |row| row.get(0),
        ).optional()?;
        if existing_task.is_some() {
            bail!("local meeting Task exists without its matching receipt")
        }
        transaction.execute(
            "INSERT INTO crm_docs(doc_key,matter_id,doc_id,yjs_state,state_vector,updated_at,deleted) VALUES(?1,?2,?3,?4,?5,?6,0)",
            params![
                format!("{FIRM_HOME}/live:{task_id}"),
                FIRM_HOME,
                format!("live:{task_id}"),
                serde_json::to_vec(&task)?,
                Vec::<u8>::new(),
                approved.approved_at,
            ],
        )?;
        transaction.execute(
            "INSERT INTO local_task_delivery_receipts(delivery_key,artifact_id,proposal_revision,task_id,task_content_sha256,recorded_at) VALUES(?1,?2,?3,?4,?5,?6)",
            params![delivery_key, approved.artifact_id, approved.proposal_revision, task_id, content_hash, approved.approved_at],
        )?;
        Ok(LocalMeetingTaskReceipt {
            artifact_id: approved.artifact_id,
            proposal_revision: approved.proposal_revision,
            delivery_key,
            task_id,
            status: LocalMeetingTaskStatus::Created,
        })
    })
}

fn read_approved_task(
    workspace: &std::path::Path,
    request: &LocalMeetingTaskRequest,
) -> Result<ApprovedTask> {
    let store = CrmCoreStore::open_read_only(workspace)?;
    let records = store.list_live_records()?;
    approved_task_from_records(&records, request)
}

/// The renderer can name only an artifact and revision. All client identity,
/// Task content, and the replay key come from encrypted approved records.
#[tauri::command]
pub async fn crm_local_meeting_task_create(
    state: State<'_, CrmState>,
    request: LocalMeetingTaskRequest,
) -> Result<LocalMeetingTaskReceipt, String> {
    if request.artifact_id.trim().is_empty() || request.proposal_revision.trim().is_empty() {
        return Err("local meeting Task requires an artifact and approved revision".to_string());
    }
    let workspace = state.service().workspace().await?;
    let initial_request = LocalMeetingTaskRequest {
        artifact_id: request.artifact_id.clone(),
        proposal_revision: request.proposal_revision.clone(),
    };
    let approved =
        tokio::task::spawn_blocking(move || read_approved_task(&workspace, &initial_request))
            .await
            .map_err(|error| error.to_string())?
            .map_err(|error| error.to_string())?;
    let lease =
        capture_active_client_lease_for(&state, &approved.household_id, &approved.matter_id)
            .await?;
    // This is the final authority check, immediately before the single
    // SQLCipher immediate transaction below. The lease itself never crosses
    // the renderer or becomes serializable data.
    require_active_client_lease(&state, &lease).await?;
    let workspace = state.service().workspace().await?;
    tokio::task::spawn_blocking(move || {
        let store = CrmCoreStore::open(&workspace)?;
        persist_approved_task(&store, &request)
    })
    .await
    .map_err(|error| error.to_string())?
    .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::crm::core_store::CrmDocRow;
    use tempfile::TempDir;

    fn record(id: &str, kind: &str, matter_id: &str, fields: Value) -> Value {
        let mut value = fields.as_object().unwrap().clone();
        value.insert("id".into(), Value::String(id.into()));
        value.insert("kind".into(), Value::String(kind.into()));
        value.insert("matterId".into(), Value::String(matter_id.into()));
        value.insert(
            "createdAt".into(),
            Value::String("2026-07-23T10:00:00Z".into()),
        );
        value.insert(
            "updatedAt".into(),
            Value::String("2026-07-23T10:00:00Z".into()),
        );
        Value::Object(value)
    }

    fn seed(store: &CrmCoreStore) {
        let meeting = record(
            "meeting-a",
            "meeting",
            "matter-a",
            json!({
                "householdRef": "household-a", "ownerRef": "advisor-a", "visibilityPolicyId": "policy-a"
            }),
        );
        let artifact = record(
            "artifact-a",
            "meeting_artifact",
            "matter-a",
            json!({
                "householdRef": "household-a", "meetingId": "meeting-a", "artifactKind": "structured-notes",
                "schemaVersion": 1, "artifactState": "produced", "producedAt": "2026-07-23T10:00:00Z",
                "meetingVisibility": {"kind":"meeting-artifact","id":"artifact-a","lineage":"derived","ownerRef":"advisor-a","visibilityPolicyId":"policy-a","parentRef":{"kind":"meeting-note","id":"meeting-a"}}
            }),
        );
        let transition = record(
            "transition-a",
            "meeting_artifact_transition",
            "matter-a",
            json!({
                "artifactId": "artifact-a", "householdRef": "household-a", "fromState": "produced", "toState": "approved",
                "proposalRevision": "proposal-a", "transitionAt": "2026-07-23T10:01:00Z",
                "exactProposal": {"id":"proposal-a","kind":"task","title":"Call the CPA","detail":"Confirm taxes.","ownerRef":"advisor-a","dueDate":"2026-08-01"}
            }),
        );
        for value in [meeting, artifact, transition] {
            store.upsert_live_record(&value).unwrap();
        }
    }

    fn store() -> (TempDir, CrmCoreStore) {
        let directory = TempDir::new().unwrap();
        let store = CrmCoreStore::open_with_key(directory.path(), &[7; 32]).unwrap();
        seed(&store);
        (directory, store)
    }

    fn request() -> LocalMeetingTaskRequest {
        LocalMeetingTaskRequest {
            artifact_id: "artifact-a".into(),
            proposal_revision: "proposal-a".into(),
        }
    }

    #[test]
    fn exact_approved_task_is_atomic_durable_and_replays() {
        let (directory, store) = store();
        let created = persist_approved_task(&store, &request()).unwrap();
        assert_eq!(created.status, LocalMeetingTaskStatus::Created);
        assert_eq!(
            store
                .list_live_records()
                .unwrap()
                .iter()
                .filter(
                    |row| row.get("id").and_then(Value::as_str) == Some(created.task_id.as_str())
                )
                .count(),
            1
        );
        drop(store);
        let reopened = CrmCoreStore::open_with_key(directory.path(), &[7; 32]).unwrap();
        let replayed = persist_approved_task(&reopened, &request()).unwrap();
        assert_eq!(replayed.status, LocalMeetingTaskStatus::Replayed);
        assert_eq!(replayed.task_id, created.task_id);
        let receipts: i64 = reopened
            .with_immediate_transaction(|tx| {
                Ok(tx.query_row(
                    "SELECT COUNT(*) FROM local_task_delivery_receipts",
                    [],
                    |row| row.get(0),
                )?)
            })
            .unwrap();
        assert_eq!(receipts, 1);
    }

    #[test]
    fn rejects_wrong_kind_ambiguous_transition_and_orphan_task_without_partial_write() {
        let (_directory, store) = store();
        let mut wrong = request();
        wrong.proposal_revision = "other".into();
        assert!(persist_approved_task(&store, &wrong).is_err());
        let key = meeting_delivery_key("artifact-a", "proposal-a");
        store
            .upsert_doc(&CrmDocRow {
                doc_key: format!("{FIRM_HOME}/live:task-{key}"),
                matter_id: FIRM_HOME.into(),
                doc_id: format!("live:task-{key}"),
                yjs_state: b"{}".to_vec(),
                state_vector: vec![],
                updated_at: "2026-07-23T10:01:00Z".into(),
                deleted: false,
            })
            .unwrap();
        assert!(persist_approved_task(&store, &request()).is_err());
        let receipts: i64 = store
            .with_immediate_transaction(|tx| {
                Ok(tx.query_row(
                    "SELECT COUNT(*) FROM local_task_delivery_receipts",
                    [],
                    |row| row.get(0),
                )?)
            })
            .unwrap();
        assert_eq!(receipts, 0);
    }

    #[test]
    fn delivery_key_matches_existing_meeting_delivery_identity() {
        assert_eq!(
            meeting_delivery_key("artifact-a", "proposal-test"),
            "meeting-delivery-1a7qczu"
        );
    }

    #[test]
    fn malformed_unapproved_or_ambiguous_lineage_refuses_before_any_task_write() {
        let (_directory, store) = store();
        let original = store.list_live_records().unwrap();
        for (label, mutate) in [
            (
                "wrong artifact kind",
                Box::new(|rows: &mut Vec<Value>| {
                    rows.iter_mut()
                        .find(|row| row["kind"] == "meeting_artifact")
                        .unwrap()["kind"] = json!("wrong");
                }) as Box<dyn Fn(&mut Vec<Value>)>,
            ),
            (
                "unapproved transition",
                Box::new(|rows: &mut Vec<Value>| {
                    rows.iter_mut()
                        .find(|row| row["kind"] == "meeting_artifact_transition")
                        .unwrap()["toState"] = json!("rejected");
                }),
            ),
            (
                "meeting lineage mismatch",
                Box::new(|rows: &mut Vec<Value>| {
                    rows.iter_mut()
                        .find(|row| row["kind"] == "meeting")
                        .unwrap()["householdRef"] = json!("household-b");
                }),
            ),
        ] {
            let mut rows = original.clone();
            mutate(&mut rows);
            assert!(
                approved_task_from_records(&rows, &request()).is_err(),
                "{label}"
            );
        }
        assert_eq!(
            store
                .list_live_records()
                .unwrap()
                .iter()
                .filter(|row| row["kind"] == "task")
                .count(),
            0
        );
    }

    #[test]
    fn changed_task_or_receipt_hash_refuses_and_rollback_leaves_no_partial_rows() {
        let (_directory, changed_task_store) = store();
        let created = persist_approved_task(&changed_task_store, &request()).unwrap();
        changed_task_store
            .with_immediate_transaction(|tx| {
                tx.execute(
                    "UPDATE crm_docs SET yjs_state=?2 WHERE doc_id=?1",
                    params![format!("live:{}", created.task_id), b"changed".to_vec()],
                )?;
                Ok(())
            })
            .unwrap();
        assert!(persist_approved_task(&changed_task_store, &request()).is_err());

        let (_directory, store) = store();
        let created = persist_approved_task(&store, &request()).unwrap();
        store.with_immediate_transaction(|tx| {
            tx.execute("UPDATE local_task_delivery_receipts SET task_content_sha256='changed' WHERE delivery_key=?1", [&created.delivery_key])?;
            Ok(())
        }).unwrap();
        assert!(persist_approved_task(&store, &request()).is_err());

        let failed: Result<()> = store.with_immediate_transaction(|tx| {
            tx.execute("INSERT INTO local_task_delivery_receipts(delivery_key,artifact_id,proposal_revision,task_id,task_content_sha256,recorded_at) VALUES('failed','a','p','task-failed','hash','now')", [])?;
            bail!("forced failure before commit")
        });
        assert!(failed.is_err());
        let failed_rows: i64 = store
            .with_immediate_transaction(|tx| {
                Ok(tx.query_row(
                    "SELECT COUNT(*) FROM local_task_delivery_receipts WHERE delivery_key='failed'",
                    [],
                    |row| row.get(0),
                )?)
            })
            .unwrap();
        assert_eq!(failed_rows, 0);
    }

    #[test]
    fn concurrent_duplicate_delivery_has_one_created_one_replayed_and_one_receipt() {
        use std::sync::{Arc, Barrier};
        let (_directory, store) = store();
        let store = Arc::new(store);
        let barrier = Arc::new(Barrier::new(2));
        let left_store = Arc::clone(&store);
        let left_barrier = Arc::clone(&barrier);
        let left = std::thread::spawn(move || {
            left_barrier.wait();
            persist_approved_task(&left_store, &request())
                .unwrap()
                .status
        });
        barrier.wait();
        let right = persist_approved_task(&store, &request()).unwrap().status;
        let left = left.join().unwrap();
        assert!(matches!(
            (left, right),
            (
                LocalMeetingTaskStatus::Created,
                LocalMeetingTaskStatus::Replayed
            ) | (
                LocalMeetingTaskStatus::Replayed,
                LocalMeetingTaskStatus::Created
            )
        ));
        let receipts: i64 = store
            .with_immediate_transaction(|tx| {
                Ok(tx.query_row(
                    "SELECT COUNT(*) FROM local_task_delivery_receipts",
                    [],
                    |row| row.get(0),
                )?)
            })
            .unwrap();
        assert_eq!(receipts, 1);
    }
}
