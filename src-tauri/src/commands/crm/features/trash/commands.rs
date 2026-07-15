//! Native, transactional CRM record trash/recovery service.
//!
//! A record is hidden from the live collection and its recoverable snapshot is
//! written in one SQLCipher transaction. The same service purges expired rows
//! before a list, delete, restore, or permanent-purge operation, so the
//! 30-day window is durable across application restarts rather than a UI timer.

use anyhow::{bail, Context, Result};
use chrono::{DateTime, Duration, Utc};
use rusqlite::{params, OptionalExtension, Transaction};
use serde::Serialize;
use serde_json::Value;
use tauri::State;

use crate::commands::crm::{commands::CrmState, core_store::CrmCoreStore};

const RETENTION_DAYS: i64 = 30;

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

fn purge_expired_in(transaction: &Transaction<'_>, now: DateTime<Utc>) -> Result<usize> {
    let expired_doc_keys = {
        let mut statement = transaction.prepare(
            "SELECT doc_key FROM crm_trash_records WHERE restored_at IS NULL AND expires_at <= ?1",
        )?;
        let expired = statement
            .query_map([now.to_rfc3339()], |row| row.get::<_, String>(0))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        expired
    };

    for doc_key in &expired_doc_keys {
        // Delete only a document that is still hidden. A later restore cannot
        // be erased by a stale expiry sweep.
        transaction.execute(
            "DELETE FROM crm_docs WHERE doc_key=?1 AND deleted=1",
            [doc_key],
        )?;
    }
    transaction.execute(
        "DELETE FROM crm_trash_records WHERE restored_at IS NULL AND expires_at <= ?1",
        [now.to_rfc3339()],
    )?;
    Ok(expired_doc_keys.len())
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
        purge_expired_in(transaction, now)?;
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
        purge_expired_in(transaction, now)?;
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
        purge_expired_in(transaction, now)?;
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
        let affected = transaction.execute(
            "UPDATE crm_docs SET deleted=0, updated_at=?2 WHERE doc_key=?1 AND deleted=1",
            params![row.doc_key, restored_at],
        )?;
        if affected != 1 {
            bail!("CRM recovery record no longer has a matching tombstone")
        }
        transaction.execute(
            "UPDATE crm_trash_records SET restored_at=?2, restored_by=?3 WHERE doc_key=?1",
            params![row.doc_key, restored_at, restored_by.trim()],
        )?;
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
        purge_expired_in(transaction, now)?;
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

#[tauri::command]
pub async fn crm_trash_soft_delete(
    state: State<'_, CrmState>,
    record_id: String,
    matter_id: String,
    deleted_by: String,
) -> Result<TrashRecordDto, String> {
    let workspace = workspace(&state).await?;
    tokio::task::spawn_blocking(move || {
        soft_delete_record(
            &CrmCoreStore::open(&workspace)?,
            &record_id,
            &matter_id,
            &deleted_by,
            Utc::now(),
        )
    })
    .await
    .map_err(|error| error.to_string())?
    .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn crm_trash_list(state: State<'_, CrmState>) -> Result<Vec<TrashRecordDto>, String> {
    let workspace = workspace(&state).await?;
    tokio::task::spawn_blocking(move || {
        list_trashed_records(&CrmCoreStore::open(&workspace)?, Utc::now())
    })
    .await
    .map_err(|error| error.to_string())?
    .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn crm_trash_restore(
    state: State<'_, CrmState>,
    record_id: String,
    matter_id: String,
    restored_by: String,
) -> Result<TrashRecordDto, String> {
    let workspace = workspace(&state).await?;
    tokio::task::spawn_blocking(move || {
        restore_record(
            &CrmCoreStore::open(&workspace)?,
            &record_id,
            &matter_id,
            &restored_by,
            Utc::now(),
        )
    })
    .await
    .map_err(|error| error.to_string())?
    .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn crm_trash_purge(
    state: State<'_, CrmState>,
    record_id: String,
    matter_id: String,
    actor_id: String,
) -> Result<(), String> {
    let workspace = workspace(&state).await?;
    tokio::task::spawn_blocking(move || {
        permanently_purge_record(
            &CrmCoreStore::open(&workspace)?,
            &record_id,
            &matter_id,
            &actor_id,
            Utc::now(),
        )
    })
    .await
    .map_err(|error| error.to_string())?
    .map_err(|error| error.to_string())
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
    fn expired_records_are_purged_and_cannot_be_restored() {
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
            .is_none());
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
