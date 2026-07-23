//! Native authority for the one built-in Hendricks walkthrough review.
//!
//! This module has no generic sample or accountless mode.  It derives a
//! capability key from the existing SQLCipher key, validates raw encrypted
//! records in the same immediate transaction, and owns the durable decisions
//! and exactly-once local deliveries.

use anyhow::{bail, Context, Result};
use hmac::{Hmac, Mac};
use rusqlite::{params, OptionalExtension, Transaction};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::Sha256;

pub const LINEAGE: &str = "hendricks-sample-capability";
const MATTER_ID: &str = "matter_sample_garcia_v_meridian";
const HOUSEHOLD_ID: &str = "sample-hendricks-household";
const MEETING_ID: &str = "sample-hendricks-annual-review";
const TASK_ID: &str = "builtin-hendricks-task-v1";
const CRM_ID: &str = "builtin-hendricks-crm-v1";
const MANIFEST_ID: &str = "hendricks-review-manifest-v1";
const TASK_RECEIPT_ID: &str = "hendricks-review-task-receipt-v1";
const CRM_RECEIPT_ID: &str = "hendricks-review-crm-receipt-v1";

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HendricksContext {
    pub matter_id: String,
    pub household_ref: String,
    pub meeting_id: String,
    pub workspace_root: String,
    pub workspace_generation: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HendricksView {
    pub manifest_id: String,
    pub artifacts: Vec<Value>,
}

fn require_exact_context(context: &HendricksContext, workspace_root: &str) -> Result<()> {
    if context.matter_id != MATTER_ID
        || context.household_ref != HOUSEHOLD_ID
        || context.meeting_id != MEETING_ID
        || context.workspace_root != workspace_root
        || context.workspace_generation < 0
    {
        bail!("Hendricks review capability does not match the active client workspace")
    }
    Ok(())
}

fn task_payload() -> Value {
    json!({
        "id": TASK_ID, "kind": "task",
        "title": "Confirm Robert’s consulting 401(k) beneficiary designations",
        "detail": "Confirm the primary and contingent beneficiary designations and record the outcome.",
        "ownerRef": Value::Null, "dueDate": Value::Null,
        "transcriptRef": "sample-hendricks-annual-review#64-92000",
        "sourceLabel": "Hendricks annual review transcript"
    })
}

fn crm_payload() -> Value {
    json!({
        "id": CRM_ID, "kind": "crm-update", "title": "Record the annual-review follow-up",
        "detail": "Save the completed annual-review note on the Hendricks household.",
        "transcriptRef": "sample-hendricks-annual-review#64-92000",
        "sourceLabel": "Hendricks annual review transcript", "entityRef": HOUSEHOLD_ID,
        "field": "annualReviewNote", "valueType": "text", "before": "",
        "proposed": "Annual review completed. Roth conversion remains planned for Q4; confirm Robert’s consulting 401(k) beneficiaries; revisit 529 funding in October."
    })
}

fn meeting_record() -> Value {
    json!({
        "id": MEETING_ID, "kind": "meeting", "matterId": MATTER_ID, "householdRef": HOUSEHOLD_ID,
        "title": "Hendricks annual review", "typeId": "annual-review", "state": "completed",
        "workspaceId": "sample-hendricks-workspace", "ownerRef": Value::Null,
        "scheduledStartUtc": "2026-07-02T14:00:00.000Z", "scheduledEndUtc": "2026-07-02T14:42:00.000Z",
        "timezone": "UTC", "references": ["meeting:sample-hendricks-annual-review"],
        "createdAt": "2026-07-02T14:00:00.000Z", "updatedAt": "2026-07-02T14:42:00.000Z",
        "legacyMeetingLink": { "meetingDir": "Meetings/2026-07-02-hendricks-annual-review", "linkedAt": "2026-07-02T14:42:00.000Z" },
        "sourceRef": "meeting:sample-hendricks-annual-review",
        "meetingDirectory": "Meetings/2026-07-02-hendricks-annual-review",
        "visibility": { "lineage": LINEAGE, "meetingId": MEETING_ID }
    })
}

fn artifact(id: &str, payload: Value) -> Value {
    json!({
        "id": id, "kind": "meeting_artifact", "matterId": MATTER_ID, "householdRef": HOUSEHOLD_ID,
        "meetingId": MEETING_ID, "artifactKind": "action-update-proposal", "schemaVersion": 3,
        "state": "produced", "producedAt": "2026-07-02T15:01:00.000Z",
        "sourceRefs": ["meeting:sample-hendricks-annual-review", "sample-hendricks-annual-review#64-92000"],
        "lineage": LINEAGE, "payload": payload
    })
}

fn canonical_records() -> Vec<Value> {
    vec![
        meeting_record(),
        artifact(TASK_ID, task_payload()),
        artifact(CRM_ID, crm_payload()),
    ]
}

fn capability_key(master_key: &[u8; 32]) -> Result<[u8; 32]> {
    let mut mac =
        Hmac::<Sha256>::new_from_slice(master_key).context("derive Hendricks capability key")?;
    mac.update(b"lantern/hendricks-review-capability/v1");
    let mut key = [0u8; 32];
    key.copy_from_slice(&mac.finalize().into_bytes());
    Ok(key)
}

fn manifest_signature(
    master_key: &[u8; 32],
    workspace_root: &str,
    records: &[Value],
) -> Result<String> {
    let body = serde_json::to_vec(&json!({
        "version": 1, "lineage": LINEAGE, "workspaceRoot": workspace_root,
        "matterId": MATTER_ID, "householdRef": HOUSEHOLD_ID, "records": records,
    }))?;
    let key = capability_key(master_key)?;
    let mut mac = Hmac::<Sha256>::new_from_slice(&key).context("sign Hendricks capability")?;
    mac.update(&body);
    Ok(hex::encode(mac.finalize().into_bytes()))
}

fn manifest(workspace_root: &str, master_key: &[u8; 32]) -> Result<Value> {
    Ok(json!({
        "id": MANIFEST_ID, "kind": "hendricks_review_manifest", "matterId": MATTER_ID,
        "lineage": LINEAGE, "version": 1, "workspaceRoot": workspace_root,
        "artifactIds": [TASK_ID, CRM_ID],
        "signature": manifest_signature(master_key, workspace_root, &canonical_records())?,
    }))
}

fn doc_key(record: &Value) -> Result<String> {
    Ok(format!(
        "{}/live:{}",
        record["matterId"]
            .as_str()
            .context("Hendricks record matter")?,
        record["id"].as_str().context("Hendricks record id")?
    ))
}

fn write_record(tx: &Transaction<'_>, record: &Value) -> Result<()> {
    let key = doc_key(record)?;
    tx.execute(
        "INSERT INTO crm_docs(doc_key,matter_id,doc_id,yjs_state,state_vector,updated_at,deleted) VALUES(?1,?2,?3,?4,?5,?6,0)",
        params![key, MATTER_ID, format!("live:{}", record["id"].as_str().unwrap_or_default()), serde_json::to_vec(record)?, Vec::<u8>::new(), "2026-07-02T15:01:00.000Z"],
    )?;
    Ok(())
}

fn load_record(tx: &Transaction<'_>, id: &str) -> Result<Option<Value>> {
    tx.query_row(
        "SELECT yjs_state FROM crm_docs WHERE doc_key=?1 AND deleted=0",
        [format!("{MATTER_ID}/live:{id}")],
        |row| row.get::<_, Vec<u8>>(0),
    )
    .optional()?
    .map(|bytes| serde_json::from_slice(&bytes).context("decode Hendricks encrypted record"))
    .transpose()
}

fn source_files_match(workspace_root: &str) -> Result<()> {
    let directory =
        std::path::Path::new(workspace_root).join("Meetings/2026-07-02-hendricks-annual-review");
    let meeting: Value = serde_json::from_slice(
        &std::fs::read(directory.join("meeting.json")).context("read canonical meeting source")?,
    )?;
    let transcript: Value = serde_json::from_slice(
        &std::fs::read(directory.join("transcript.json"))
            .context("read canonical transcript source")?,
    )?;
    let segments = transcript["segments"]
        .as_array()
        .context("canonical transcript segments")?;
    if meeting["matterId"] != MATTER_ID
        || meeting["calendarEvent"]["id"] != MEETING_ID
        || meeting["calendarEvent"]["title"] != "Hendricks annual review"
        || transcript["meta"]["matterId"] != MATTER_ID
        || segments.len() != 4
        || segments.get(3).and_then(|segment| segment["endMs"].as_i64()) != Some(92_000)
        || segments.get(3).and_then(|segment| segment["text"].as_str()) != Some("I will prepare the Schwab Roth authorization, check Robert's consulting 401(k) beneficiaries, and revisit 529 funding in October.")
    {
        bail!("Hendricks source bytes do not match the built-in capability")
    }
    Ok(())
}

fn proposal_rows(tx: &Transaction<'_>) -> Result<Vec<Value>> {
    let mut statement = tx.prepare(
        "SELECT yjs_state FROM crm_docs WHERE matter_id=?1 AND doc_id LIKE 'live:%' AND deleted=0",
    )?;
    let rows = statement.query_map([MATTER_ID], |row| row.get::<_, Vec<u8>>(0))?;
    rows.filter_map(|row| match row {
        Ok(bytes) => match serde_json::from_slice::<Value>(&bytes) {
            Ok(value)
                if value["kind"] == "meeting_artifact" && value["meetingId"] == MEETING_ID =>
            {
                Some(Ok(value))
            }
            Ok(_) => None,
            Err(error) => Some(Err(error.into())),
        },
        Err(error) => Some(Err(error.into())),
    })
    .collect()
}

fn verify(tx: &Transaction<'_>, workspace_root: &str, master_key: &[u8; 32]) -> Result<Vec<Value>> {
    source_files_match(workspace_root)?;
    let expected = canonical_records();
    let mut found = Vec::with_capacity(expected.len());
    for expected_record in &expected {
        let saved = load_record(
            tx,
            expected_record["id"]
                .as_str()
                .context("canonical record id")?,
        )?
        .context("Hendricks canonical record is missing")?;
        let equal = if saved["kind"] == "meeting_artifact" {
            let stable = [
                "id",
                "kind",
                "matterId",
                "householdRef",
                "meetingId",
                "artifactKind",
                "schemaVersion",
                "producedAt",
                "sourceRefs",
                "lineage",
                "payload",
            ];
            stable
                .iter()
                .all(|key| saved[*key] == expected_record[*key])
                && matches!(
                    saved["state"].as_str(),
                    Some("produced") | Some("approved") | Some("rejected")
                )
        } else {
            saved == *expected_record
        };
        if !equal {
            bail!("Hendricks canonical record is missing or altered")
        }
        found.push(saved);
    }
    let proposals = proposal_rows(tx)?;
    if proposals.len() != 2
        || proposals
            .iter()
            .any(|item| item["id"] != TASK_ID && item["id"] != CRM_ID)
    {
        bail!("Hendricks proposal set is not exactly two canonical artifacts")
    }
    if load_record(tx, MANIFEST_ID)?.context("Hendricks signed manifest is missing")?
        != manifest(workspace_root, master_key)?
    {
        bail!("Hendricks signed manifest is missing or invalid")
    }
    Ok(found)
}

pub fn ensure(
    tx: &Transaction<'_>,
    context: &HendricksContext,
    workspace_root: &str,
    master_key: &[u8; 32],
) -> Result<HendricksView> {
    require_exact_context(context, workspace_root)?;
    source_files_match(workspace_root)?;
    let ids = [MEETING_ID, TASK_ID, CRM_ID, MANIFEST_ID];
    let existing = ids
        .iter()
        .map(|id| load_record(tx, id))
        .collect::<Result<Vec<_>>>()?;
    if existing.iter().all(Option::is_none) {
        for record in canonical_records() {
            write_record(tx, &record)?;
        }
        write_record(tx, &manifest(workspace_root, master_key)?)?;
    } else if existing.iter().any(Option::is_none) {
        bail!("Hendricks review seed is partial")
    }
    view(tx, context, workspace_root, master_key)
}

pub fn view(
    tx: &Transaction<'_>,
    context: &HendricksContext,
    workspace_root: &str,
    master_key: &[u8; 32],
) -> Result<HendricksView> {
    require_exact_context(context, workspace_root)?;
    let artifacts = verify(tx, workspace_root, master_key)?
        .into_iter()
        .filter(|record| record["kind"] == "meeting_artifact")
        .collect();
    Ok(HendricksView {
        manifest_id: MANIFEST_ID.into(),
        artifacts,
    })
}

pub fn approve(
    tx: &Transaction<'_>,
    context: &HendricksContext,
    workspace_root: &str,
    master_key: &[u8; 32],
    artifact_id: &str,
) -> Result<HendricksView> {
    if artifact_id != TASK_ID && artifact_id != CRM_ID {
        bail!("Hendricks approval references an unknown artifact")
    }
    let mut records = verify(tx, workspace_root, master_key)?;
    let record = records
        .iter_mut()
        .find(|record| record["id"] == artifact_id)
        .context("Hendricks artifact is missing")?;
    if record["state"] == "rejected" {
        bail!("Hendricks proposal was rejected")
    }
    record["state"] = Value::String("approved".into());
    record["decision"] = json!({ "state": "approved", "proposal": record["payload"].clone() });
    tx.execute(
        "UPDATE crm_docs SET yjs_state=?1 WHERE doc_key=?2",
        params![serde_json::to_vec(record)?, doc_key(record)?],
    )?;
    require_exact_context(context, workspace_root)?;
    Ok(HendricksView {
        manifest_id: MANIFEST_ID.into(),
        artifacts: records
            .into_iter()
            .filter(|record| record["kind"] == "meeting_artifact")
            .collect(),
    })
}

fn approved(
    tx: &Transaction<'_>,
    context: &HendricksContext,
    workspace_root: &str,
    master_key: &[u8; 32],
    artifact_id: &str,
) -> Result<Value> {
    require_exact_context(context, workspace_root)?;
    verify(tx, workspace_root, master_key)?;
    let record = load_record(tx, artifact_id)?.context("Hendricks artifact is missing")?;
    let payload = if artifact_id == TASK_ID {
        task_payload()
    } else if artifact_id == CRM_ID {
        crm_payload()
    } else {
        bail!("unknown Hendricks artifact")
    };
    if record["state"] != "approved"
        || record["payload"] != payload
        || record["decision"]["proposal"] != payload
    {
        bail!("Hendricks approval is absent, stale, or altered")
    }
    Ok(record)
}

fn receipt(tx: &Transaction<'_>, id: &str, content: &Value) -> Result<Option<Value>> {
    let existing = load_record(tx, id)?;
    if existing
        .as_ref()
        .is_some_and(|value| value["content"] != *content)
    {
        bail!("Hendricks delivery key conflicts with different content")
    }
    Ok(existing)
}

fn deliver(
    tx: &Transaction<'_>,
    context: &HendricksContext,
    workspace_root: &str,
    master_key: &[u8; 32],
    artifact_id: &str,
    receipt_id: &str,
    destination: Value,
) -> Result<Value> {
    let artifact = approved(tx, context, workspace_root, master_key, artifact_id)?;
    if let Some(found) = receipt(tx, receipt_id, &destination)? {
        return Ok(found);
    }
    let id = destination["id"]
        .as_str()
        .context("Hendricks delivery id")?;
    if let Some(found) = load_record(tx, id)? {
        if found != destination {
            bail!("Hendricks delivery identity conflicts with different content")
        }
    } else {
        write_record(tx, &destination)?;
    }
    let outcome = json!({ "id": receipt_id, "kind": "hendricks_review_receipt", "matterId": MATTER_ID, "content": destination, "deliveryKey": artifact["payload"]["id"] });
    write_record(tx, &outcome)?;
    Ok(outcome)
}

pub fn deliver_task(
    tx: &Transaction<'_>,
    context: &HendricksContext,
    workspace_root: &str,
    master_key: &[u8; 32],
) -> Result<Value> {
    let destination = json!({
        "id": "task-hendricks-review-v1", "kind": "task", "matterId": MATTER_ID, "householdRef": HOUSEHOLD_ID,
        "title": task_payload()["title"], "body": task_payload()["detail"], "assigneeUserId": Value::Null,
        "status": "open", "meetingDeliveryKey": "hendricks-review-task-v1",
        "meetingVisibility": { "kind": "task", "id": "task-hendricks-review-v1", "lineage": LINEAGE },
        "source": { "origin": "meeting", "sources": ["meeting:sample-hendricks-annual-review"] }
    });
    deliver(
        tx,
        context,
        workspace_root,
        master_key,
        TASK_ID,
        TASK_RECEIPT_ID,
        destination,
    )
}

pub fn deliver_crm(
    tx: &Transaction<'_>,
    context: &HendricksContext,
    workspace_root: &str,
    master_key: &[u8; 32],
) -> Result<Value> {
    let destination = json!({
        "id": "crm-hendricks-review-v1", "kind": "household", "matterId": MATTER_ID, "householdRef": HOUSEHOLD_ID,
        "annualReviewNote": crm_payload()["proposed"], "meetingDeliveryKey": "hendricks-review-crm-v1"
    });
    deliver(
        tx,
        context,
        workspace_root,
        master_key,
        CRM_ID,
        CRM_RECEIPT_ID,
        destination,
    )
}
