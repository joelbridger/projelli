//! Native, transactional CRM record trash/recovery service.
//!
//! A record is hidden from the live collection and its recoverable snapshot is
//! written in one SQLCipher transaction. Expiry removes a record from the
//! recovery list but never bypasses the firm-admin permanent-purge boundary.

use anyhow::{bail, Context, Result};
use chrono::{DateTime, Duration, Utc};
use rusqlite::{params, OptionalExtension, Transaction};
use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::commands::audit::{
    store::{AuditEntryRecord, EncryptedAuditStore},
    AuditState,
};
use crate::commands::crm::{commands::CrmState, core_store::CrmCoreStore};

const RETENTION_DAYS: i64 = 30;
const CRM_AUDIT_APPENDED_EVENT: &str = "crm-audit-appended";

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TrashRecordDto {
    pub record_id: String,
    pub record_type: String,
    pub matter_id: String,
    pub record: Value,
    pub deleted_at: String,
    pub deleted_by: String,
    pub expires_at: String,
}

#[derive(Debug)]
struct StoredTrashRecord {
    doc_key: String,
    record_id: String,
    record_type: String,
    matter_id: String,
    snapshot: Vec<u8>,
    state_vector: Vec<u8>,
    original_updated_at: String,
    deleted_at: String,
    deleted_by: String,
    expires_at: String,
}

fn require_value(value: &str, label: &str) -> Result<()> {
    if value.trim().is_empty() {
        bail!("CRM trash {label} is required")
    }
    Ok(())
}

fn parse_time(value: &str, label: &str) -> Result<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(value)
        .with_context(|| format!("invalid CRM trash {label}"))
        .map(|time| time.with_timezone(&Utc))
}

fn retain_expired_tombstones(_transaction: &Transaction<'_>, _now: DateTime<Utc>) -> Result<()> {
    // The recovery window controls listing and restore eligibility, not data
    // destruction. Only the native firm-admin purge command may erase a
    // hidden record, so expiry can never silently become a hard delete.
    Ok(())
}

fn read_live_record(
    transaction: &Transaction<'_>,
    record_id: &str,
    matter_id: &str,
) -> Result<StoredTrashRecord> {
    transaction
        .query_row(
            "SELECT doc_key, matter_id, yjs_state, state_vector, updated_at
             FROM crm_docs WHERE doc_id=?1 AND matter_id=?2 AND deleted=0",
            params![format!("live:{record_id}"), matter_id],
            |row| {
                let snapshot = row.get::<_, Vec<u8>>(2)?;
                let record: Value = serde_json::from_slice(&snapshot).map_err(|error| {
                    rusqlite::Error::FromSqlConversionFailure(
                        snapshot.len(),
                        rusqlite::types::Type::Blob,
                        Box::new(error),
                    )
                })?;
                let record_type = record
                    .get("kind")
                    .and_then(Value::as_str)
                    .filter(|kind| !kind.trim().is_empty())
                    .ok_or(rusqlite::Error::InvalidQuery)?
                    .to_owned();
                Ok(StoredTrashRecord {
                    doc_key: row.get(0)?,
                    record_id: record_id.to_owned(),
                    record_type,
                    matter_id: row.get(1)?,
                    snapshot,
                    state_vector: row.get(3)?,
                    original_updated_at: row.get(4)?,
                    deleted_at: String::new(),
                    deleted_by: String::new(),
                    expires_at: String::new(),
                })
            },
        )
        .optional()?
        .ok_or_else(|| anyhow::anyhow!("CRM record is not available for deletion"))
}

fn as_dto(row: StoredTrashRecord) -> Result<TrashRecordDto> {
    Ok(TrashRecordDto {
        record_id: row.record_id,
        record_type: row.record_type,
        matter_id: row.matter_id,
        record: serde_json::from_slice(&row.snapshot).context("decode CRM trash snapshot")?,
        deleted_at: row.deleted_at,
        deleted_by: row.deleted_by,
        expires_at: row.expires_at,
    })
}

/// Atomically hides a live CRM record and stores its full recovery snapshot.
/// This is the only native soft-delete service future CRM delete lanes may call.
pub fn soft_delete_record(
    store: &CrmCoreStore,
    record_id: &str,
    matter_id: &str,
    deleted_by: &str,
    now: DateTime<Utc>,
) -> Result<TrashRecordDto> {
    require_value(record_id, "record id")?;
    require_value(matter_id, "matter id")?;
    require_value(deleted_by, "actor")?;
    store.transaction(|transaction| {
        retain_expired_tombstones(transaction, now)?;
        let mut row = read_live_record(transaction, record_id, matter_id)?;
        row.deleted_at = now.to_rfc3339();
        row.deleted_by = deleted_by.trim().to_owned();
        row.expires_at = (now + Duration::days(RETENTION_DAYS)).to_rfc3339();
        transaction.execute(
            "UPDATE crm_docs SET deleted=1, updated_at=?2 WHERE doc_key=?1 AND deleted=0",
            params![row.doc_key, row.deleted_at],
        )?;
        transaction.execute(
            "INSERT INTO crm_trash_records(
                doc_key,record_id,record_type,matter_id,snapshot,state_vector,original_updated_at,
                deleted_at,deleted_by,expires_at,restored_at,restored_by
             ) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,NULL,NULL)
             ON CONFLICT(doc_key) DO UPDATE SET
                record_id=excluded.record_id, record_type=excluded.record_type,
                matter_id=excluded.matter_id, snapshot=excluded.snapshot,
                state_vector=excluded.state_vector, original_updated_at=excluded.original_updated_at,
                deleted_at=excluded.deleted_at, deleted_by=excluded.deleted_by,
                expires_at=excluded.expires_at, restored_at=NULL, restored_by=NULL",
            params![
                row.doc_key,
                row.record_id,
                row.record_type,
                row.matter_id,
                row.snapshot,
                row.state_vector,
                row.original_updated_at,
                row.deleted_at,
                row.deleted_by,
                row.expires_at,
            ],
        )?;
        as_dto(row)
    })
}

/// Lists currently recoverable records after enforcing their persisted expiry.
pub fn list_trashed_records(
    store: &CrmCoreStore,
    now: DateTime<Utc>,
) -> Result<Vec<TrashRecordDto>> {
    store.transaction(|transaction| {
        retain_expired_tombstones(transaction, now)?;
        let rows = {
            let mut statement = transaction.prepare(
                "SELECT doc_key,record_id,record_type,matter_id,snapshot,state_vector,original_updated_at,
                        deleted_at,deleted_by,expires_at
                 FROM crm_trash_records
                 WHERE restored_at IS NULL AND expires_at > ?1
                 ORDER BY deleted_at DESC, record_id ASC",
            )?;
            let records = statement
                .query_map([now.to_rfc3339()], |row| {
                    Ok(StoredTrashRecord {
                        doc_key: row.get(0)?,
                        record_id: row.get(1)?,
                        record_type: row.get(2)?,
                        matter_id: row.get(3)?,
                        snapshot: row.get(4)?,
                        state_vector: row.get(5)?,
                        original_updated_at: row.get(6)?,
                        deleted_at: row.get(7)?,
                        deleted_by: row.get(8)?,
                        expires_at: row.get(9)?,
                    })
                })?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            records
        };
        rows.into_iter().map(as_dto).collect()
    })
}

/// Returns whether a live-record identity is presently protected by an active
/// trash tombstone. Connector/import lanes use this before recreating a record
/// so a remote re-import cannot silently resurrect a locally deleted record.
pub fn is_tombstoned_record(
    store: &CrmCoreStore,
    record_id: &str,
    matter_id: &str,
    now: DateTime<Utc>,
) -> Result<bool> {
    require_value(record_id, "record id")?;
    require_value(matter_id, "matter id")?;
    store.transaction(|transaction| {
        retain_expired_tombstones(transaction, now)?;
        let tombstone_exists = transaction.query_row(
            "SELECT EXISTS(
                    SELECT 1 FROM crm_trash_records
                    WHERE record_id=?1 AND matter_id=?2
                      AND restored_at IS NULL AND expires_at > ?3
                )",
            params![record_id, matter_id, now.to_rfc3339()],
            |row| row.get::<_, bool>(0),
        )?;
        Ok(tombstone_exists)
    })
}

/// Atomically makes a still-recoverable record live again and records the
/// restoring actor on its tombstone before removing the retained snapshot.
pub fn restore_record(
    store: &CrmCoreStore,
    record_id: &str,
    matter_id: &str,
    restored_by: &str,
    now: DateTime<Utc>,
) -> Result<TrashRecordDto> {
    require_value(record_id, "record id")?;
    require_value(matter_id, "matter id")?;
    require_value(restored_by, "actor")?;
    store.transaction(|transaction| {
        retain_expired_tombstones(transaction, now)?;
        let row = transaction
            .query_row(
                "SELECT doc_key,record_id,record_type,matter_id,snapshot,state_vector,original_updated_at,
                        deleted_at,deleted_by,expires_at
                 FROM crm_trash_records
                 WHERE record_id=?1 AND matter_id=?2 AND restored_at IS NULL AND expires_at > ?3",
                params![record_id, matter_id, now.to_rfc3339()],
                |row| {
                    Ok(StoredTrashRecord {
                        doc_key: row.get(0)?, record_id: row.get(1)?, record_type: row.get(2)?,
                        matter_id: row.get(3)?, snapshot: row.get(4)?, state_vector: row.get(5)?,
                        original_updated_at: row.get(6)?, deleted_at: row.get(7)?,
                        deleted_by: row.get(8)?, expires_at: row.get(9)?,
                    })
                },
            )
            .optional()?
            .ok_or_else(|| anyhow::anyhow!("CRM record is no longer recoverable"))?;
        let restored_at = now.to_rfc3339();
        // Clear recoverability first. The migration-level resurrection guard
        // then allows this single, transactional, intentional restore while
        // still blocking generic imports and live upserts.
        transaction.execute(
            "UPDATE crm_trash_records SET restored_at=?2, restored_by=?3 WHERE doc_key=?1",
            params![row.doc_key, restored_at, restored_by.trim()],
        )?;
        let affected = transaction.execute(
            "UPDATE crm_docs SET deleted=0, updated_at=?2 WHERE doc_key=?1 AND deleted=1",
            params![row.doc_key, restored_at],
        )?;
        if affected != 1 {
            bail!("CRM recovery record no longer has a matching tombstone")
        }
        transaction.execute(
            "INSERT INTO crm_trash_restores(restore_id,doc_key,record_id,record_type,deleted_at,deleted_by,expires_at,restored_at,restored_by)
             VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9)",
            params![
                format!("{}:{}", row.doc_key, restored_at),
                row.doc_key,
                row.record_id,
                row.record_type,
                row.deleted_at,
                row.deleted_by,
                row.expires_at,
                restored_at,
                restored_by.trim()
            ],
        )?;
        // The separate restore row retains auditable metadata. Remove the
        // content snapshot only after the live document and metadata commit.
        transaction.execute("DELETE FROM crm_trash_records WHERE doc_key=?1", [row.doc_key.clone()])?;
        as_dto(row)
    })
}

/// Native authorization hook for destructive purge.
///
/// This intentionally denies every request until the teams-roles lane lands a
/// server-trusted role/team authority contract. Do not replace this with a
/// renderer-supplied role claim: that would make permanent deletion forgeable.
fn is_firm_admin(_actor_id: &str) -> bool {
    false
}

/// Permanently removes a recoverable record only when native authority allows
/// it. The present deny-all hook makes this safe before teams-roles is wired.
pub fn permanently_purge_record(
    store: &CrmCoreStore,
    record_id: &str,
    matter_id: &str,
    actor_id: &str,
    now: DateTime<Utc>,
) -> Result<()> {
    require_value(record_id, "record id")?;
    require_value(matter_id, "matter id")?;
    require_value(actor_id, "actor")?;
    if !is_firm_admin(actor_id) {
        bail!("Permanent CRM deletion requires a firm admin")
    }
    store.transaction(|transaction| {
        retain_expired_tombstones(transaction, now)?;
        let doc_key = transaction
            .query_row(
                "SELECT doc_key FROM crm_trash_records WHERE record_id=?1 AND matter_id=?2 AND restored_at IS NULL",
                params![record_id, matter_id],
                |row| row.get::<_, String>(0),
            )
            .optional()?
            .ok_or_else(|| anyhow::anyhow!("CRM record is no longer recoverable"))?;
        transaction.execute(
            "DELETE FROM crm_docs WHERE doc_key=?1 AND deleted=1",
            [doc_key.clone()],
        )?;
        transaction.execute("DELETE FROM crm_trash_records WHERE doc_key=?1", [doc_key])?;
        Ok(())
    })
}

async fn workspace(state: &CrmState) -> Result<std::path::PathBuf, String> {
    state.service().workspace().await
}

fn build_trash_audit_record(
    id: String,
    timestamp: String,
    lifecycle: &str,
    description: &str,
    matter_id: &str,
    metadata: Value,
) -> AuditEntryRecord {
    let payload_json = serde_json::json!({
        "id": &id,
        "timestamp": &timestamp,
        "action": "user_action",
        "description": description,
        "model": Value::Null,
        "inputs": {},
        "outputs": {},
        "userDecision": Value::Null,
        "metadata": {
            "auditEventType": "user_action",
            "source": "crm-trash-backend",
            "scope": { "kind": "matter", "matterId": matter_id },
            "matterId": matter_id,
            "crmLifecycle": lifecycle,
            "details": metadata,
            "auditPersistenceStatus": "saved"
        }
    })
    .to_string();
    AuditEntryRecord {
        id,
        timestamp,
        action: "user_action".to_owned(),
        description: description.to_owned(),
        payload_json,
    }
}

/// Writes against the exact workspace captured by the CRM command. This must
/// not use the process-wide AuditState: the user may switch workspaces while a
/// delete or restore is finishing, and the audit row must stay beside the CRM
/// database that was changed.
async fn append_trash_audit_best_effort(
    app: &AppHandle,
    workspace: std::path::PathBuf,
    lifecycle: &'static str,
    description: &'static str,
    matter_id: String,
    metadata: Value,
) {
    let event_workspace = workspace.clone();
    let result = tokio::task::spawn_blocking(move || -> anyhow::Result<AuditEntryRecord> {
        let store = EncryptedAuditStore::open(&workspace)?;
        let timestamp = Utc::now().to_rfc3339();
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or_default();
        let mut random = [0_u8; 4];
        rand::RngCore::fill_bytes(&mut rand::thread_rng(), &mut random);
        let id = format!("audit_crm_trash_{nanos}_{}", hex::encode(random));
        let record =
            build_trash_audit_record(id, timestamp, lifecycle, description, &matter_id, metadata);
        store.append(&record)?;
        Ok(record)
    })
    .await;

    match result {
        Ok(Ok(record)) => {
            // The existing workspace lifecycle listener deduplicates by id and
            // inserts this into the open Activity Log immediately. Do not emit
            // into a different workspace if the user switched while the
            // native operation was finishing; reopening the original
            // workspace will hydrate its already-persisted row.
            let active_workspace = app.state::<AuditState>().workspace.lock().await.clone();
            if active_workspace.as_ref() == Some(&event_workspace) {
                let _ = app.emit(CRM_AUDIT_APPENDED_EVENT, &record);
            }
        }
        Ok(Err(error)) => log::warn!("CRM trash audit append failed (non-fatal): {error:#}"),
        Err(error) => log::warn!("CRM trash audit task failed (non-fatal): {error}"),
    }
}

#[tauri::command]
pub async fn crm_trash_soft_delete(
    app: AppHandle,
    state: State<'_, CrmState>,
    record_id: String,
    matter_id: String,
    deleted_by: String,
) -> Result<TrashRecordDto, String> {
    let workspace = workspace(&state).await?;
    let operation_workspace = workspace.clone();
    let audit_record_id = record_id.clone();
    let audit_matter_id = matter_id.clone();
    let audit_actor = deleted_by.clone();
    let current = crate::commands::crm::features::permissions::commands::native_current_member();
    let deleted = tokio::task::spawn_blocking(move || {
        use crate::commands::crm::features::permissions::commands as perms;
        let store = CrmCoreStore::open(&operation_workspace)?;
        // Soft-delete mutates client data (and returns its snapshot). A scoped
        // member may only delete within a matter they own; deny-closed with no
        // member.
        let scope =
            perms::matter_read_scope(&store, perms::own_clients_permissions_enabled(), current.as_ref())?;
        if !scope.allows(&matter_id) {
            bail!("CRM record is outside the current member's client scope.");
        }
        soft_delete_record(&store, &record_id, &matter_id, &deleted_by, Utc::now())
    })
    .await
    .map_err(|error| error.to_string())?
    .map_err(|error| error.to_string())?;
    append_trash_audit_best_effort(
        &app,
        workspace,
        "soft-delete",
        "CRM record moved to Trash & recovery",
        audit_matter_id.clone(),
        serde_json::json!({
            "recordId": audit_record_id,
            "matterId": audit_matter_id,
            "deletedBy": audit_actor,
            "expiresAt": deleted.expires_at,
        }),
    )
    .await;
    Ok(deleted)
}

#[tauri::command]
pub async fn crm_trash_list(state: State<'_, CrmState>) -> Result<Vec<TrashRecordDto>, String> {
    use crate::commands::crm::features::permissions::commands as perms;
    let workspace = workspace(&state).await?;
    let current = perms::native_current_member();
    tokio::task::spawn_blocking(move || {
        let store = CrmCoreStore::open(&workspace)?;
        // Own-clients doorway: a trashed record still holds client PII (its full
        // snapshot). Filter to the matters the member may read; a firm-wide
        // reader (or flag off) sees all. Deny-closed when no member is bound.
        let scope =
            perms::matter_read_scope(&store, perms::own_clients_permissions_enabled(), current.as_ref())?;
        let records = list_trashed_records(&store, Utc::now())?;
        Ok::<Vec<TrashRecordDto>, anyhow::Error>(
            records
                .into_iter()
                .filter(|record| scope.allows(&record.matter_id))
                .collect(),
        )
    })
    .await
    .map_err(|error| error.to_string())?
    .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn crm_trash_is_tombstoned(
    state: State<'_, CrmState>,
    record_id: String,
    matter_id: String,
) -> Result<bool, String> {
    let workspace = workspace(&state).await?;
    let current = crate::commands::crm::features::permissions::commands::native_current_member();
    tokio::task::spawn_blocking(move || {
        use crate::commands::crm::features::permissions::commands as perms;
        let store = CrmCoreStore::open(&workspace)?;
        // Existence-probe for a matter's record: scope it so a member cannot
        // enumerate a non-owned matter's records. Deny-closed with no member.
        let scope =
            perms::matter_read_scope(&store, perms::own_clients_permissions_enabled(), current.as_ref())?;
        if !scope.allows(&matter_id) {
            bail!("CRM record is outside the current member's client scope.");
        }
        is_tombstoned_record(&store, &record_id, &matter_id, Utc::now())
    })
    .await
    .map_err(|error| error.to_string())?
    .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn crm_trash_restore(
    app: AppHandle,
    state: State<'_, CrmState>,
    record_id: String,
    matter_id: String,
    restored_by: String,
) -> Result<TrashRecordDto, String> {
    let workspace = workspace(&state).await?;
    let operation_workspace = workspace.clone();
    let audit_record_id = record_id.clone();
    let audit_matter_id = matter_id.clone();
    let audit_actor = restored_by.clone();
    let current = crate::commands::crm::features::permissions::commands::native_current_member();
    let restored = tokio::task::spawn_blocking(move || {
        use crate::commands::crm::features::permissions::commands as perms;
        let store = CrmCoreStore::open(&operation_workspace)?;
        // Restore writes client PII back into `matter_id` (renderer-supplied), so
        // a scoped member may only restore into a matter they own. Deny-closed
        // when no member is bound; firm-wide readers may restore anywhere.
        let scope =
            perms::matter_read_scope(&store, perms::own_clients_permissions_enabled(), current.as_ref())?;
        if !scope.allows(&matter_id) {
            bail!("CRM record is outside the current member's client scope.");
        }
        restore_record(&store, &record_id, &matter_id, &restored_by, Utc::now())
    })
    .await
    .map_err(|error| error.to_string())?
    .map_err(|error| error.to_string())?;
    append_trash_audit_best_effort(
        &app,
        workspace,
        "restore",
        "CRM record restored from Trash & recovery",
        audit_matter_id.clone(),
        serde_json::json!({
            "recordId": audit_record_id,
            "matterId": audit_matter_id,
            "restoredBy": audit_actor,
        }),
    )
    .await;
    Ok(restored)
}

#[tauri::command]
pub async fn crm_trash_purge(
    app: AppHandle,
    state: State<'_, CrmState>,
    record_id: String,
    matter_id: String,
    actor_id: String,
) -> Result<(), String> {
    let workspace = workspace(&state).await?;
    let operation_workspace = workspace.clone();
    let audit_record_id = record_id.clone();
    let audit_matter_id = matter_id.clone();
    let audit_actor = actor_id.clone();
    let current = crate::commands::crm::features::permissions::commands::native_current_member();
    let result = tokio::task::spawn_blocking(move || {
        use crate::commands::crm::features::permissions::commands as perms;
        let store = CrmCoreStore::open(&operation_workspace)?;
        // Native matter-scope guard on top of the existing firm-admin boundary:
        // a scoped member may only purge within a matter they own (the firm-admin
        // check below keys on a renderer-supplied actor id). Deny-closed with no
        // member.
        let scope =
            perms::matter_read_scope(&store, perms::own_clients_permissions_enabled(), current.as_ref())?;
        if !scope.allows(&matter_id) {
            bail!("CRM record is outside the current member's client scope.");
        }
        permanently_purge_record(&store, &record_id, &matter_id, &actor_id, Utc::now())
    })
    .await
    .map_err(|error| error.to_string())?
    .map_err(|error| error.to_string());

    let (lifecycle, description) = match &result {
        Ok(()) => ("purge", "CRM record permanently deleted"),
        Err(message) if message.contains("requires a firm admin") => {
            ("purge-refused", "CRM permanent deletion refused")
        }
        Err(_) => return result,
    };
    append_trash_audit_best_effort(
        &app,
        workspace,
        lifecycle,
        description,
        audit_matter_id.clone(),
        serde_json::json!({
            "recordId": audit_record_id,
            "matterId": audit_matter_id,
            "actorId": audit_actor,
        }),
    )
    .await;
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::crm::core_store::CrmDocRow;

    fn store() -> (tempfile::TempDir, CrmCoreStore) {
        let directory = tempfile::tempdir().unwrap();
        let store = CrmCoreStore::open_with_key(directory.path(), &[7; 32]).unwrap();
        (directory, store)
    }

    fn live_record(id: &str) -> Value {
        live_record_in_matter(id, "matter-1")
    }

    fn live_record_in_matter(id: &str, matter_id: &str) -> Value {
        serde_json::json!({
            "id": id, "kind": "household", "matterId": matter_id,
            "createdAt": "2026-07-15T00:00:00Z", "updatedAt": "2026-07-15T00:00:00Z",
            "name": "Maya Chen"
        })
    }

    #[test]
    fn audit_record_keeps_lifecycle_actor_and_workspace_scope_metadata() {
        let record = build_trash_audit_record(
            "audit-1".to_owned(),
            "2026-07-15T12:00:00Z".to_owned(),
            "soft-delete",
            "CRM record moved to Trash & recovery",
            "matter-1",
            serde_json::json!({
                "recordId": "household-1",
                "matterId": "matter-1",
                "deletedBy": "advisor-1",
            }),
        );
        let payload: Value = serde_json::from_str(&record.payload_json).unwrap();
        assert_eq!(payload["metadata"]["crmLifecycle"], "soft-delete");
        assert_eq!(payload["metadata"]["scope"]["kind"], "matter");
        assert_eq!(payload["metadata"]["scope"]["matterId"], "matter-1");
        assert_eq!(payload["metadata"]["matterId"], "matter-1");
        assert_eq!(payload["metadata"]["details"]["deletedBy"], "advisor-1");
        assert_eq!(payload["metadata"]["auditPersistenceStatus"], "saved");
    }

    #[test]
    fn soft_delete_is_scoped_to_the_requested_matter() {
        let (_directory, store) = store();
        store
            .upsert_live_record(&live_record_in_matter("same-id", "matter-a"))
            .unwrap();
        store
            .upsert_live_record(&live_record_in_matter("same-id", "matter-b"))
            .unwrap();
        let now = parse_time("2026-07-15T12:00:00Z", "test").unwrap();

        soft_delete_record(&store, "same-id", "matter-a", "advisor-1", now).unwrap();

        assert_eq!(
            list_trashed_records(&store, now).unwrap()[0].matter_id,
            "matter-a"
        );
        assert_eq!(
            store.list_live_records().unwrap(),
            vec![live_record_in_matter("same-id", "matter-b")]
        );
    }

    #[test]
    fn soft_delete_list_restore_round_trip_is_atomic_and_durable() {
        let (directory, store) = store();
        store
            .upsert_live_record(&live_record("household-1"))
            .unwrap();
        let deleted_at = parse_time("2026-07-15T12:00:00Z", "test").unwrap();

        let deleted =
            soft_delete_record(&store, "household-1", "matter-1", "advisor-1", deleted_at).unwrap();
        assert_eq!(deleted.record_type, "household");
        assert_eq!(deleted.expires_at, "2026-08-14T12:00:00+00:00");
        assert!(store.list_live_records().unwrap().is_empty());
        drop(store);

        let reopened = CrmCoreStore::open_with_key(directory.path(), &[7; 32]).unwrap();
        assert_eq!(
            list_trashed_records(&reopened, deleted_at).unwrap(),
            vec![deleted.clone()]
        );

        let restored = restore_record(
            &reopened,
            "household-1",
            "matter-1",
            "advisor-2",
            deleted_at + Duration::days(1),
        )
        .unwrap();
        assert_eq!(restored, deleted);
        assert_eq!(
            reopened.list_live_records().unwrap(),
            vec![live_record("household-1")]
        );
        drop(reopened);

        let reopened_after_restore =
            CrmCoreStore::open_with_key(directory.path(), &[7; 32]).unwrap();
        assert_eq!(
            reopened_after_restore.list_live_records().unwrap(),
            vec![live_record("household-1")]
        );
        assert!(
            list_trashed_records(&reopened_after_restore, deleted_at + Duration::days(1))
                .unwrap()
                .is_empty()
        );
        reopened_after_restore
            .transaction(|transaction| {
                let restored_by: String = transaction.query_row(
                    "SELECT restored_by FROM crm_trash_restores WHERE record_id='household-1'",
                    [],
                    |row| row.get(0),
                )?;
                assert_eq!(restored_by, "advisor-2");
                Ok(())
            })
            .unwrap();

        soft_delete_record(
            &reopened_after_restore,
            "household-1",
            "matter-1",
            "advisor-3",
            deleted_at + Duration::days(2),
        )
        .unwrap();
        restore_record(
            &reopened_after_restore,
            "household-1",
            "matter-1",
            "advisor-4",
            deleted_at + Duration::days(3),
        )
        .unwrap();
        reopened_after_restore
            .transaction(|transaction| {
                let restore_count: i64 = transaction.query_row(
                    "SELECT COUNT(*) FROM crm_trash_restores WHERE record_id='household-1'",
                    [],
                    |row| row.get(0),
                )?;
                assert_eq!(restore_count, 2);
                Ok(())
            })
            .unwrap();
    }

    #[test]
    fn expired_records_fall_out_of_recovery_without_hard_deleting_data() {
        let (_directory, store) = store();
        store
            .upsert_live_record(&live_record("household-2"))
            .unwrap();
        let deleted_at = parse_time("2026-07-15T12:00:00Z", "test").unwrap();
        soft_delete_record(&store, "household-2", "matter-1", "advisor-1", deleted_at).unwrap();
        let after_expiry = deleted_at + Duration::days(RETENTION_DAYS) + Duration::seconds(1);

        assert!(list_trashed_records(&store, after_expiry)
            .unwrap()
            .is_empty());
        assert!(
            restore_record(&store, "household-2", "matter-1", "advisor-1", after_expiry).is_err()
        );
        assert!(store
            .get_doc("matter-1/live:household-2")
            .unwrap()
            .is_some_and(|row| row.deleted));
    }

    #[test]
    fn tombstone_blocks_generic_live_upserts_until_restore() {
        let (_directory, store) = store();
        store
            .upsert_live_record(&live_record("household-connector"))
            .unwrap();
        let deleted_at = parse_time("2026-07-15T12:00:00Z", "test").unwrap();

        assert!(
            !is_tombstoned_record(&store, "household-connector", "matter-1", deleted_at).unwrap()
        );
        soft_delete_record(
            &store,
            "household-connector",
            "matter-1",
            "advisor-1",
            deleted_at,
        )
        .unwrap();
        assert!(
            is_tombstoned_record(&store, "household-connector", "matter-1", deleted_at).unwrap()
        );
        assert!(store
            .upsert_live_record(&live_record("household-connector"))
            .is_err());
        assert!(store.list_live_records().unwrap().is_empty());

        restore_record(
            &store,
            "household-connector",
            "matter-1",
            "advisor-1",
            deleted_at + Duration::days(1),
        )
        .unwrap();
        assert!(!is_tombstoned_record(
            &store,
            "household-connector",
            "matter-1",
            deleted_at + Duration::days(1)
        )
        .unwrap());
    }

    #[test]
    fn permanent_purge_is_denied_by_native_authority_before_mutating_data() {
        let (_directory, store) = store();
        store
            .upsert_live_record(&live_record("household-3"))
            .unwrap();
        let now = parse_time("2026-07-15T12:00:00Z", "test").unwrap();
        soft_delete_record(&store, "household-3", "matter-1", "advisor-1", now).unwrap();

        let error =
            permanently_purge_record(&store, "household-3", "matter-1", "pretend-admin", now)
                .unwrap_err();
        assert!(error.to_string().contains("requires a firm admin"));
        assert_eq!(list_trashed_records(&store, now).unwrap().len(), 1);
    }

    #[test]
    fn restore_metadata_write_is_rolled_back_if_live_document_is_missing() {
        let (_directory, store) = store();
        let now = parse_time("2026-07-15T12:00:00Z", "test").unwrap();
        store
            .upsert_doc(&CrmDocRow {
                doc_key: "matter-1/live:broken".into(),
                matter_id: "matter-1".into(),
                doc_id: "live:broken".into(),
                yjs_state: serde_json::to_vec(&live_record("broken")).unwrap(),
                state_vector: vec![],
                updated_at: now.to_rfc3339(),
                deleted: true,
            })
            .unwrap();
        store.transaction(|transaction| {
            transaction.execute(
                "INSERT INTO crm_trash_records(doc_key,record_id,record_type,matter_id,snapshot,state_vector,original_updated_at,deleted_at,deleted_by,expires_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",
                params!["matter-1/live:broken", "broken", "household", "matter-1", serde_json::to_vec(&live_record("broken"))?, Vec::<u8>::new(), now.to_rfc3339(), now.to_rfc3339(), "advisor-1", (now + Duration::days(30)).to_rfc3339()],
            )?;
            transaction.execute("DELETE FROM crm_docs WHERE doc_key=?1", ["matter-1/live:broken"])?;
            Ok(())
        }).unwrap();
        assert!(restore_record(&store, "broken", "matter-1", "advisor-2", now).is_err());
        assert_eq!(list_trashed_records(&store, now).unwrap().len(), 1);
    }
}
