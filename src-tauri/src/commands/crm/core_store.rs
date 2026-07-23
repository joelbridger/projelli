//! SQLCipher-backed local CRM core read model.  `crm_docs` is the local merged
//! collection-document truth; every other CRM entity table is replaceable.

use anyhow::{bail, Context, Result};
use rusqlite::{params, Connection, OptionalExtension};
use std::{
    path::{Path, PathBuf},
    sync::Mutex,
};

use super::{
    core_model::{AssignmentOperation, CompletionOperation, HlcStamp, PropagationDecision},
    migrations,
    record_descriptors::{self, RecordDescriptor, CRM_RECORD_DESCRIPTORS},
};
use crate::util::sync::lock_unpoison;

const CORE_KEYCHAIN_SERVICE: &str = "lantern-crm-core-enc";
const CORE_KEYCHAIN_KEY: &str = "master-key-v1";
const KEY_LEN: usize = 32;
const FUTURE_SKEW_MILLIS: i64 = 5 * 60 * 1000;
const MAX_LOGICAL_COUNTER: u32 = 1_000_000;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CrmDocRow {
    pub doc_key: String,
    pub matter_id: String,
    pub doc_id: String,
    pub yjs_state: Vec<u8>,
    pub state_vector: Vec<u8>,
    pub updated_at: String,
    pub deleted: bool,
}
#[derive(Debug, Clone, PartialEq)]
pub struct FtsHit {
    pub entity_id: String,
    pub entity_kind: String,
    pub matter_id: String,
    pub content: String,
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NotificationEnvelopeRow {
    pub org_id: String,
    pub envelope_id: String,
    pub ciphertext: Vec<u8>,
    pub received_at: String,
}

fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339()
}

fn core_master_key() -> Result<[u8; KEY_LEN]> {
    if let Ok(hex) = std::env::var("LANTERN_HEADLESS_TEST_CRM_CORE_MASTER_KEY_HEX") {
        let bytes = hex::decode(hex.trim()).context("decode CRM core test master key")?;
        if bytes.len() != KEY_LEN {
            bail!("CRM core test master key has wrong length")
        }
        let mut key = [0u8; KEY_LEN];
        key.copy_from_slice(&bytes);
        return Ok(key);
    }
    let entry = keyring::Entry::new(CORE_KEYCHAIN_SERVICE, CORE_KEYCHAIN_KEY)
        .context("CRM core keychain entry")?;
    match entry.get_password() {
        Ok(hex) => {
            let bytes = hex::decode(hex.trim()).context("decode CRM core master key")?;
            if bytes.len() != KEY_LEN {
                bail!("stored CRM core master key has wrong length")
            };
            let mut key = [0u8; KEY_LEN];
            key.copy_from_slice(&bytes);
            Ok(key)
        }
        Err(keyring::Error::NoEntry) => {
            let mut key = [0; KEY_LEN];
            rand::RngCore::fill_bytes(&mut rand::thread_rng(), &mut key);
            entry
                .set_password(&hex::encode(key))
                .context("store CRM core master key")?;
            Ok(key)
        }
        Err(error) => Err(anyhow::anyhow!("CRM core keychain read: {error}")),
    }
}

pub struct CrmCoreStore {
    conn: Mutex<Connection>,
    #[allow(dead_code)]
    workspace_root: PathBuf,
}

impl CrmCoreStore {
    pub fn db_path(workspace_root: &Path) -> PathBuf {
        crate::commands::data_dir::workspace_data_dir(workspace_root).join("crm-core-enc.db")
    }
    pub fn open(workspace_root: &Path) -> Result<Self> {
        Self::open_with_key(workspace_root, &core_master_key()?)
    }
    pub fn open_with_key(workspace_root: &Path, key: &[u8; KEY_LEN]) -> Result<Self> {
        let path = Self::db_path(workspace_root);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).ok();
        }
        let conn = Connection::open(&path)
            .with_context(|| format!("open CRM core database {}", path.display()))?;
        conn.execute_batch(&format!("PRAGMA key = \"x'{}'\";", hex::encode(key)))?;
        conn.busy_timeout(std::time::Duration::from_secs(5))?;
        migrations::migrate(&conn)?;
        Ok(Self {
            conn: Mutex::new(conn),
            workspace_root: workspace_root.to_path_buf(),
        })
    }

    /// Runs one feature-owned CRM mutation as a single SQLCipher transaction.
    ///
    /// The core store remains the sole owner of the encrypted connection and
    /// its lock. Feature modules may use this narrow boundary when a durable
    /// operation must change a live document and its own feature tables
    /// together (for example, CRM trash/recovery). Callers receive no database
    /// handle after this method returns, so they cannot accidentally split an
    /// atomic mutation across independent store openings.
    pub(crate) fn transaction<T>(
        &self,
        work: impl FnOnce(&rusqlite::Transaction<'_>) -> Result<T>,
    ) -> Result<T> {
        let mut conn = lock_unpoison(&self.conn);
        let transaction = conn.transaction()?;
        let result = work(&transaction)?;
        transaction.commit()?;
        Ok(result)
    }

    pub fn upsert_doc(&self, row: &CrmDocRow) -> Result<()> {
        lock_unpoison(&self.conn).execute("INSERT INTO crm_docs(doc_key,matter_id,doc_id,yjs_state,state_vector,updated_at,deleted) VALUES(?1,?2,?3,?4,?5,?6,?7) ON CONFLICT(doc_key) DO UPDATE SET matter_id=excluded.matter_id,doc_id=excluded.doc_id,yjs_state=excluded.yjs_state,state_vector=excluded.state_vector,updated_at=excluded.updated_at,deleted=excluded.deleted", params![row.doc_key,row.matter_id,row.doc_id,row.yjs_state,row.state_vector,row.updated_at,row.deleted as i64])?;
        Ok(())
    }

    /// Small, renderer-facing CRM records are stored as individual encrypted
    /// collection documents.  Keeping their id in `doc_id` means this is not a
    /// second browser cache: it uses the same SQLCipher database, key, backup,
    /// and delete semantics as the CRM core.
    pub fn upsert_live_record(&self, record: &serde_json::Value) -> Result<()> {
        self.upsert_live_record_with_descriptors(record, CRM_RECORD_DESCRIPTORS, true)
    }

    /// Run one domain mutation under SQLite's write lock. The closure loads,
    /// validates, and persists its aggregate before another connection may
    /// start a competing write, preventing stale read-modify-write loss.
    pub fn with_immediate_transaction<T>(
        &self,
        operation: impl FnOnce(&rusqlite::Transaction<'_>) -> Result<T>,
    ) -> Result<T> {
        let mut conn = lock_unpoison(&self.conn);
        let transaction =
            conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        let result = operation(&transaction)?;
        transaction.commit()?;
        Ok(result)
    }

    /// Narrow transaction boundary reserved for the sealed M4 mailbox
    /// foundation. It keeps mailbox identity and draft claims in this existing
    /// SQLCipher store without exposing its connection to a renderer or a
    /// provider adapter.
    #[allow(dead_code)] // Called when the sealed M4 adapter work lands.
    pub(crate) fn m4_shared_foundation_transaction<T>(
        &self,
        operation: impl FnOnce(&rusqlite::Transaction<'_>) -> Result<T>,
    ) -> Result<T> {
        self.with_immediate_transaction(operation)
    }

    /// Importer-only persistence boundary. Wealthbox ids are opaque source
    /// values, and this path accepted every non-empty id before descriptors
    /// were introduced. Keep that compatibility while still running any
    /// registered feature validator/projector atomically.
    pub(super) fn upsert_imported_live_record(&self, record: &serde_json::Value) -> Result<()> {
        self.upsert_live_record_with_descriptors(record, CRM_RECORD_DESCRIPTORS, false)
    }

    fn upsert_live_record_with_descriptors(
        &self,
        record: &serde_json::Value,
        descriptors: &[RecordDescriptor],
        enforce_identifier_syntax: bool,
    ) -> Result<()> {
        let identity = if enforce_identifier_syntax {
            record_descriptors::validate_live_record(record, descriptors)?
        } else {
            record_descriptors::validate_imported_live_record(record, descriptors)?
        };
        let object = record
            .as_object()
            .expect("a validated CRM live record is an object");
        let matter_id = object
            .get("matterId")
            .and_then(serde_json::Value::as_str)
            .filter(|value| !value.trim().is_empty())
            .unwrap_or("firm");
        let updated_at = object
            .get("updatedAt")
            .and_then(serde_json::Value::as_str)
            .filter(|value| !value.trim().is_empty())
            .unwrap_or("unknown");
        let encoded = serde_json::to_vec(record).context("encode CRM live record")?;
        let mut conn = lock_unpoison(&self.conn);
        let transaction = conn.transaction()?;
        transaction.execute(
            "INSERT INTO crm_docs(doc_key,matter_id,doc_id,yjs_state,state_vector,updated_at,deleted) VALUES(?1,?2,?3,?4,?5,?6,0) ON CONFLICT(doc_key) DO UPDATE SET matter_id=excluded.matter_id,doc_id=excluded.doc_id,yjs_state=excluded.yjs_state,state_vector=excluded.state_vector,updated_at=excluded.updated_at,deleted=excluded.deleted",
            params![
                format!("{matter_id}/live:{}", identity.id),
                matter_id,
                format!("live:{}", identity.id),
                encoded,
                Vec::<u8>::new(),
                updated_at,
            ],
        )?;
        if enforce_identifier_syntax {
            record_descriptors::project_live_record(record, &transaction, descriptors)?;
        } else {
            record_descriptors::project_imported_live_record(record, &transaction, descriptors)?;
        }
        transaction.commit()?;
        Ok(())
    }

    pub fn list_live_records(&self) -> Result<Vec<serde_json::Value>> {
        let conn = lock_unpoison(&self.conn);
        let mut statement = conn.prepare(
            "SELECT yjs_state FROM crm_docs WHERE doc_id LIKE 'live:%' AND deleted=0 ORDER BY updated_at, doc_id",
        )?;
        let records = statement
            .query_map([], |row| row.get::<_, Vec<u8>>(0))?
            .map(|row| {
                let bytes = row?;
                serde_json::from_slice(&bytes).context("decode CRM live record")
            })
            .collect::<Result<Vec<_>>>()?;
        Ok(records)
    }
    /// Soft deletion is a projected tombstone, never a physical erase of the
    /// collection document.  The allow-list prevents identifiers becoming SQL.
    pub fn tombstone_projection(&self, table: &str, id: &str) -> Result<()> {
        const TABLES: &[&str] = &[
            "households",
            "persons",
            "accounts",
            "facts",
            "notes",
            "tasks",
            "workflow_templates",
            "workflow_instances",
            "opportunities",
            "service_policies",
            "pipeline_defs",
            "stage_defs",
            "proposal_records",
            "legacy_projects",
            "firm_directory_entries",
            "household_directory_shells",
            "intake_links",
            "intake_submissions",
            "tags",
            "saved_views",
        ];
        if !TABLES.contains(&table) {
            bail!("CRM projection table is not tombstone-capable")
        }
        lock_unpoison(&self.conn)
            .execute(&format!("UPDATE {table} SET deleted=1 WHERE id=?1"), [id])?;
        Ok(())
    }
    pub fn get_doc(&self, doc_key: &str) -> Result<Option<CrmDocRow>> {
        Ok(lock_unpoison(&self.conn).query_row("SELECT doc_key,matter_id,doc_id,yjs_state,state_vector,updated_at,deleted FROM crm_docs WHERE doc_key=?1", [doc_key], |r| Ok(CrmDocRow { doc_key:r.get(0)?, matter_id:r.get(1)?, doc_id:r.get(2)?, yjs_state:r.get(3)?, state_vector:r.get(4)?, updated_at:r.get(5)?, deleted:r.get::<_,i64>(6)? != 0 })).optional()?)
    }
    pub fn set_cursor(&self, stream_key: &str, cursor: i64, key_epoch: i64) -> Result<()> {
        lock_unpoison(&self.conn).execute("INSERT INTO crm_sync_cursors(stream_key,cursor,key_epoch) VALUES(?1,?2,?3) ON CONFLICT(stream_key) DO UPDATE SET cursor=excluded.cursor,key_epoch=excluded.key_epoch", params![stream_key,cursor,key_epoch])?;
        Ok(())
    }
    pub fn cursor(&self, stream_key: &str) -> Result<Option<(i64, i64)>> {
        Ok(lock_unpoison(&self.conn)
            .query_row(
                "SELECT cursor,key_epoch FROM crm_sync_cursors WHERE stream_key=?1",
                [stream_key],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()?)
    }
    /// Records an authenticated CRDT blob and advances its relay cursor in one
    /// SQLCipher transaction. Replays are accepted only when their immutable
    /// blob identity matches; gaps are rejected before state can advance.
    pub fn record_applied_cursor(&self, stream_key: &str, cursor: i64, blob_id: &str) -> Result<()> {
        let mut conn = lock_unpoison(&self.conn);
        let tx = conn.transaction()?;
        let current = tx.query_row("SELECT cursor FROM crm_sync_cursors WHERE stream_key=?1", [stream_key], |row| row.get::<_, i64>(0)).optional()?.unwrap_or(0);
        if cursor <= current {
            let existing: Option<String> = tx.query_row("SELECT blob_id FROM crm_sync_applied WHERE stream_key=?1 AND cursor=?2", params![stream_key, cursor], |row| row.get(0)).optional()?;
            match existing {
                Some(existing) if existing == blob_id => return Ok(()),
                Some(_) => bail!("CRM relay blob identity mismatch"),
                None => bail!("CRM relay cursor history is incomplete"),
            }
        }
        if cursor != current + 1 { bail!("CRM relay cursor must stay contiguous") }
        tx.execute("INSERT INTO crm_sync_applied(stream_key,cursor,blob_id) VALUES(?1,?2,?3)", params![stream_key,cursor,blob_id])?;
        tx.execute("INSERT INTO crm_sync_cursors(stream_key,cursor,key_epoch) VALUES(?1,?2,0) ON CONFLICT(stream_key) DO UPDATE SET cursor=excluded.cursor", params![stream_key,cursor])?;
        tx.commit()?;
        Ok(())
    }

    /// The propagation commit boundary. Its instance snapshot, append-only
    /// operation ids, activity row, and notification outbox entries commit or
    /// roll back together. All JSON is encrypted at rest by SQLCipher.
    pub fn commit_propagation_transaction(
        &self,
        kind: &str,
        event_id: &str,
        instance_json: &str,
        operation_ids: &[String],
        activity_idempotency_key: &str,
        notification_rows: &[(String, String)],
    ) -> Result<()> {
        if !matches!(kind, "apply" | "undo") { bail!("invalid propagation transaction kind") }
        let mut conn = lock_unpoison(&self.conn);
        let tx = conn.transaction()?;
        tx.execute("INSERT OR IGNORE INTO crm_propagation_transactions(event_id,kind,instance_json,created_at) VALUES(?1,?2,?3,?4)", params![event_id,kind,instance_json,now_iso()])?;
        for operation_id in operation_ids {
            tx.execute("INSERT OR IGNORE INTO crm_immutable_operations(operation_id,payload_json,created_at) VALUES(?1,?2,?3)", params![operation_id, "{}", now_iso()])?;
        }
        tx.execute("INSERT OR IGNORE INTO crm_activity_outbox(idempotency_key,event_id,created_at) VALUES(?1,?2,?3)", params![activity_idempotency_key,event_id,now_iso()])?;
        for (org_id, envelope_id) in notification_rows {
            // This is the durable dependency-ready intent. B4 later attaches a
            // recipient, encrypted envelope, and class in the same database;
            // this core layer never invents routing data or placeholder content.
            tx.execute("INSERT OR IGNORE INTO crm_notification_outbox_intents(org_id,envelope_id,mutation_id,created_at) VALUES(?1,?2,?3,?4)", params![org_id,envelope_id,event_id,now_iso()])?;
        }
        tx.commit()?;
        Ok(())
    }
    /// Callers use this inside the same transaction as a document mutation.
    /// Envelope identity is always org-scoped; no sender identity is persisted.
    pub fn enqueue_outbox(
        &self,
        org_id: &str,
        envelope_id: &str,
        mutation_id: &str,
        recipient_user_id: &str,
        envelope_class: &str,
        ciphertext: &[u8],
        created_at: &str,
    ) -> Result<()> {
        if !matches!(envelope_class, "firm_operational" | "client_confidential") {
            bail!("invalid CRM envelope class")
        }
        lock_unpoison(&self.conn).execute("INSERT OR IGNORE INTO crm_outbox(org_id,envelope_id,mutation_id,recipient_user_id,envelope_class,ciphertext,created_at) VALUES(?1,?2,?3,?4,?5,?6,?7)", params![org_id,envelope_id,mutation_id,recipient_user_id,envelope_class,ciphertext,created_at])?;
        Ok(())
    }
    pub fn receive_inbox(&self, row: &NotificationEnvelopeRow) -> Result<()> {
        lock_unpoison(&self.conn).execute("INSERT OR IGNORE INTO crm_inbox(org_id,envelope_id,ciphertext,received_at) VALUES(?1,?2,?3,?4)", params![row.org_id,row.envelope_id,row.ciphertext,row.received_at])?;
        Ok(())
    }

    /// The sole HLC issuer.  Before a relay observation it uses monotonic local
    /// time.  Once observed, the physical clock is capped at relay+five minutes.
    pub fn issue_hlc(
        &self,
        org_id: &str,
        actor_id: &str,
        operation_id: &str,
        local_wall_millis: i64,
    ) -> Result<HlcStamp> {
        let mut conn = lock_unpoison(&self.conn);
        let tx = conn.transaction()?;
        let prior: Option<(Option<i64>, String)> = tx.query_row("SELECT last_relay_observed_millis,last_valid_issued_hlc_json FROM crm_hlc_state WHERE org_id=?1", [org_id], |r| Ok((r.get(0)?,r.get(1)?))).optional()?;
        let (observed, old) = prior.unwrap_or((None, String::new()));
        let last: Option<HlcStamp> = if old.is_empty() {
            None
        } else {
            Some(serde_json::from_str(&old).context("decode persisted CRM HLC")?)
        };
        let capped = observed
            .map(|millis| local_wall_millis.min(millis.saturating_add(FUTURE_SKEW_MILLIS)))
            .unwrap_or(local_wall_millis);
        let physical = last
            .as_ref()
            .map(|v| v.wall_millis.max(capped))
            .unwrap_or(capped);
        let logical = match &last {
            Some(v) if v.wall_millis == physical => v
                .logical_counter
                .checked_add(1)
                .filter(|n| *n <= MAX_LOGICAL_COUNTER)
                .context("CRM HLC logical counter exhausted")?,
            _ => 0,
        };
        let stamp = HlcStamp {
            wall_millis: physical,
            logical_counter: logical,
            actor_id: actor_id.into(),
            operation_id: operation_id.into(),
        };
        tx.execute("INSERT INTO crm_hlc_state(org_id,last_relay_observed_millis,last_valid_issued_hlc_json) VALUES(?1,?2,?3) ON CONFLICT(org_id) DO UPDATE SET last_valid_issued_hlc_json=excluded.last_valid_issued_hlc_json", params![org_id, observed, serde_json::to_string(&stamp)?])?;
        tx.commit()?;
        Ok(stamp)
    }
    /// Persist relay observation before later stamp issuance, then quarantine any
    /// previously-issued future stamp.  Quarantined operations are never merged.
    pub fn observe_relay_time(&self, org_id: &str, observed_millis: i64) -> Result<()> {
        let mut conn = lock_unpoison(&self.conn);
        let tx = conn.transaction()?;
        let prior: Option<(Option<i64>, String)> = tx.query_row("SELECT last_relay_observed_millis,last_valid_issued_hlc_json FROM crm_hlc_state WHERE org_id=?1", [org_id], |r| Ok((r.get(0)?,r.get(1)?))).optional()?;
        let prior_observed = prior.as_ref().and_then(|v| v.0);
        let max_observed = prior_observed
            .map(|v| v.max(observed_millis))
            .unwrap_or(observed_millis);
        let last = prior.and_then(|v| {
            if v.1.is_empty() {
                None
            } else {
                serde_json::from_str::<HlcStamp>(&v.1).ok()
            }
        });
        let invalidated = last
            .as_ref()
            .is_some_and(|s| s.wall_millis > max_observed.saturating_add(FUTURE_SKEW_MILLIS));
        let persisted_last = if invalidated {
            String::new()
        } else {
            last.as_ref()
                .map(serde_json::to_string)
                .transpose()?
                .unwrap_or_default()
        };
        tx.execute("INSERT INTO crm_hlc_state(org_id,last_relay_observed_millis,last_valid_issued_hlc_json) VALUES(?1,?2,?3) ON CONFLICT(org_id) DO UPDATE SET last_relay_observed_millis=excluded.last_relay_observed_millis,last_valid_issued_hlc_json=excluded.last_valid_issued_hlc_json", params![org_id,max_observed,persisted_last])?;
        if let Some(stamp) =
            last.filter(|s| s.wall_millis > max_observed.saturating_add(FUTURE_SKEW_MILLIS))
        {
            self_quarantine(
                &tx,
                org_id,
                &stamp,
                "issued stamp exceeds observed relay ceiling",
            )?;
        }
        tx.commit()?;
        Ok(())
    }
    pub fn validate_received_hlc(&self, org_id: &str, stamp: &HlcStamp) -> Result<bool> {
        let conn = lock_unpoison(&self.conn);
        let observed: Option<i64> = conn
            .query_row(
                "SELECT last_relay_observed_millis FROM crm_hlc_state WHERE org_id=?1",
                [org_id],
                |r| r.get(0),
            )
            .optional()?
            .flatten();
        let valid = stamp.wall_millis >= 0
            && stamp.logical_counter <= MAX_LOGICAL_COUNTER
            && !stamp.actor_id.is_empty()
            && !stamp.operation_id.is_empty()
            && observed
                .map(|m| stamp.wall_millis <= m.saturating_add(FUTURE_SKEW_MILLIS))
                .unwrap_or(true);
        if !valid {
            self_quarantine(&conn, org_id, stamp, "invalid or future HLC stamp")?;
        }
        Ok(valid)
    }

    pub fn append_completion(
        &self,
        instance_id: &str,
        operation: &CompletionOperation,
    ) -> Result<()> {
        let json = serde_json::to_string(operation)?;
        let actor = serde_json::to_string(&operation.completed_by)?;
        lock_unpoison(&self.conn).execute("INSERT OR IGNORE INTO workflow_completion_operations(completion_id,workflow_instance_id,step_id,completed_at,completed_by_json,source_operation_id,json) VALUES(?1,?2,?3,?4,?5,?6,?7)", params![operation.completion_id,instance_id,operation.step_id,operation.completed_at,actor,operation.source_operation_id,json])?;
        Ok(())
    }
    pub fn append_assignment(
        &self,
        instance_id: &str,
        operation: &AssignmentOperation,
    ) -> Result<()> {
        let json = serde_json::to_string(operation)?;
        let actor = serde_json::to_string(&operation.assigned_by)?;
        lock_unpoison(&self.conn).execute("INSERT OR IGNORE INTO workflow_assignment_operations(assignment_id,workflow_instance_id,step_id,assigned_user_id,assigned_at,assigned_by_json,source_operation_id,json) VALUES(?1,?2,?3,?4,?5,?6,?7,?8)", params![operation.assignment_id,instance_id,operation.step_id,operation.assigned_user_id,operation.assigned_at,actor,operation.source_operation_id,json])?;
        Ok(())
    }
    pub fn put_propagation_decision(&self, decision: &PropagationDecision) -> Result<()> {
        lock_unpoison(&self.conn).execute("INSERT INTO propagation_decisions(instance_id,revision_id,step_id,field,decision,source_operation_id,supersedes_decision_key,reoffer_state,json) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9) ON CONFLICT(instance_id,revision_id,step_id,field) DO NOTHING", params![decision.instance_id,decision.revision_id,decision.step_id,decision.field,decision.decision,decision.source_operation_id,decision.supersedes_decision_key,decision.reoffer_state,serde_json::to_string(&decision.json)?])?;
        Ok(())
    }
    pub fn index_fts(
        &self,
        id: &str,
        kind: &str,
        matter_id: &str,
        decrypted_content: &str,
    ) -> Result<()> {
        let conn = lock_unpoison(&self.conn);
        conn.execute("DELETE FROM crm_fts WHERE entity_id=?1", [id])?;
        conn.execute(
            "INSERT INTO crm_fts(entity_id,entity_kind,matter_id,content) VALUES(?1,?2,?3,?4)",
            params![id, kind, matter_id, decrypted_content],
        )?;
        Ok(())
    }
    pub fn search_fts(&self, matter_id: &str, query: &str) -> Result<Vec<FtsHit>> {
        let conn = lock_unpoison(&self.conn);
        let mut stmt = conn.prepare("SELECT entity_id,entity_kind,matter_id,content FROM crm_fts WHERE crm_fts MATCH ?1 AND matter_id=?2")?;
        let rows = stmt
            .query_map(params![query, matter_id], |r| {
                Ok(FtsHit {
                    entity_id: r.get(0)?,
                    entity_kind: r.get(1)?,
                    matter_id: r.get(2)?,
                    content: r.get(3)?,
                })
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    }
    pub fn rebuild_projections<F>(&self, mut projector: F) -> Result<()>
    where
        F: FnMut(&CrmDocRow, &Connection) -> Result<()>,
    {
        let mut conn = lock_unpoison(&self.conn);
        let tx = conn.transaction()?;
        tx.execute_batch("DELETE FROM households; DELETE FROM persons; DELETE FROM accounts; DELETE FROM facts; DELETE FROM notes; DELETE FROM tasks; DELETE FROM workflow_templates; DELETE FROM workflow_instances; DELETE FROM opportunities; DELETE FROM proposal_records; DELETE FROM legacy_projects; DELETE FROM firm_directory_entries; DELETE FROM household_directory_shells; DELETE FROM intake_links; DELETE FROM intake_submissions; DELETE FROM activity_events; DELETE FROM tags; DELETE FROM custom_field_defs; DELETE FROM saved_views; DELETE FROM external_refs; DELETE FROM note_household_links; DELETE FROM crm_fts;")?;
        let mut stmt = tx.prepare("SELECT doc_key,matter_id,doc_id,yjs_state,state_vector,updated_at,deleted FROM crm_docs WHERE deleted=0")?;
        let docs = stmt
            .query_map([], |r| {
                Ok(CrmDocRow {
                    doc_key: r.get(0)?,
                    matter_id: r.get(1)?,
                    doc_id: r.get(2)?,
                    yjs_state: r.get(3)?,
                    state_vector: r.get(4)?,
                    updated_at: r.get(5)?,
                    deleted: r.get::<_, i64>(6)? != 0,
                })
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        drop(stmt);
        for doc in &docs {
            projector(doc, &tx)?;
        }
        tx.commit()?;
        Ok(())
    }
    pub fn purge(workspace_root: &Path) -> Result<()> {
        let base = Self::db_path(workspace_root);
        for suffix in ["", "-wal", "-shm", "-journal"] {
            let path = if suffix.is_empty() {
                base.clone()
            } else {
                let mut s = base.clone().into_os_string();
                s.push(suffix);
                PathBuf::from(s)
            };
            if path.exists() {
                std::fs::remove_file(&path)
                    .with_context(|| format!("remove CRM core database {}", path.display()))?;
            }
        }
        Ok(())
    }
    pub fn delete_master_key() -> Result<()> {
        match keyring::Entry::new(CORE_KEYCHAIN_SERVICE, CORE_KEYCHAIN_KEY)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(anyhow::anyhow!("delete CRM core key: {e}")),
        }
    }
}

fn self_quarantine(conn: &Connection, org_id: &str, stamp: &HlcStamp, reason: &str) -> Result<()> {
    conn.execute("INSERT OR IGNORE INTO crm_merge_quarantine(operation_id,org_id,stamp_json,reason,quarantined_at) VALUES(?1,?2,?3,?4,?5)", params![stamp.operation_id,org_id,serde_json::to_string(stamp)?,reason,now_iso()])?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::crm::core_model::ActorRef;
    use anyhow::bail;
    use serde_json::Value;
    use tempfile::TempDir;
    fn store() -> (TempDir, CrmCoreStore) {
        let dir = TempDir::new().unwrap();
        let store = CrmCoreStore::open_with_key(dir.path(), &[7; 32]).unwrap();
        (dir, store)
    }
    #[test]
    fn document_and_cursor_round_trip() {
        let (_d, s) = store();
        let row = CrmDocRow {
            doc_key: "m/crm:records".into(),
            matter_id: "m".into(),
            doc_id: "crm:records".into(),
            yjs_state: vec![1],
            state_vector: vec![2],
            updated_at: "now".into(),
            deleted: false,
        };
        s.upsert_doc(&row).unwrap();
        assert_eq!(s.get_doc(&row.doc_key).unwrap(), Some(row));
        s.set_cursor("m/crm:records", 4, 2).unwrap();
        assert_eq!(s.cursor("m/crm:records").unwrap(), Some((4, 2)));
    }
    #[test]
    fn live_records_round_trip_through_the_encrypted_document_store() {
        let (directory, store) = store();
        let record = serde_json::json!({
            "id": "household-northcrest",
            "kind": "household",
            "matterId": "household-northcrest",
            "name": "Northcrest household",
            "updatedAt": "2026-07-11T00:00:00Z"
        });
        store.upsert_live_record(&record).unwrap();
        drop(store);

        let reopened = CrmCoreStore::open_with_key(directory.path(), &[7; 32]).unwrap();
        assert_eq!(reopened.list_live_records().unwrap(), vec![record]);
    }

    #[test]
    fn legacy_baseline_database_is_adopted_and_round_trips_unchanged() {
        let directory = TempDir::new().unwrap();
        let path = CrmCoreStore::db_path(directory.path());
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        let legacy = Connection::open(&path).unwrap();
        legacy
            .execute_batch(&format!("PRAGMA key = \"x'{}'\";", hex::encode([9; 32])))
            .unwrap();
        crate::commands::crm::core_schema::apply_baseline(&legacy).unwrap();
        let record = serde_json::json!({
            "id": "existing-1",
            "kind": "futureFeature",
            "matterId": "client-1",
            "label": "Already stored",
            "updatedAt": "2026-07-14T00:00:00Z"
        });
        legacy
            .execute(
                "INSERT INTO crm_docs(doc_key,matter_id,doc_id,yjs_state,state_vector,updated_at,deleted) VALUES(?1,?2,?3,?4,?5,?6,0)",
                (
                    "client-1/live:existing-1",
                    "client-1",
                    "live:existing-1",
                    serde_json::to_vec(&record).unwrap(),
                    Vec::<u8>::new(),
                    "2026-07-14T00:00:00Z",
                ),
            )
            .unwrap();
        drop(legacy);

        let adopted = CrmCoreStore::open_with_key(directory.path(), &[9; 32]).unwrap();
        assert_eq!(adopted.list_live_records().unwrap(), vec![record.clone()]);
        adopted.upsert_live_record(&record).unwrap();
        drop(adopted);

        let reopened = CrmCoreStore::open_with_key(directory.path(), &[9; 32]).unwrap();
        assert_eq!(reopened.list_live_records().unwrap(), vec![record]);
    }

    fn validate_projected_record(record: &Value) -> Result<()> {
        if record.get("label").and_then(Value::as_str).is_none() {
            bail!("label is required")
        }
        Ok(())
    }

    fn project_test_record(record: &Value, conn: &Connection) -> Result<()> {
        conn.execute(
            "INSERT INTO test_record_projection(id,label) VALUES(?1,?2)",
            (
                record["id"].as_str().unwrap(),
                record["label"].as_str().unwrap(),
            ),
        )?;
        Ok(())
    }

    #[test]
    fn feature_descriptor_validates_and_projects_with_the_generic_document_write() {
        let (_directory, store) = store();
        lock_unpoison(&store.conn)
            .execute_batch(
                "CREATE TABLE test_record_projection(id TEXT PRIMARY KEY,label TEXT NOT NULL);",
            )
            .unwrap();
        let descriptors = [RecordDescriptor {
            kind: "futureFeature",
            validate: Some(validate_projected_record),
            project: Some(project_test_record),
        }];
        let record = serde_json::json!({
            "id": "future-1",
            "kind": "futureFeature",
            "matterId": "client-1",
            "label": "Future record"
        });

        store
            .upsert_live_record_with_descriptors(&record, &descriptors, true)
            .unwrap();

        let projected: String = lock_unpoison(&store.conn)
            .query_row(
                "SELECT label FROM test_record_projection WHERE id='future-1'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(projected, "Future record");
        assert_eq!(store.list_live_records().unwrap(), vec![record]);
    }
    #[test]
    fn observed_relay_time_caps_issued_stamp_and_quarantines_old_future_stamp() {
        let (_d, s) = store();
        let stamp = s.issue_hlc("org", "a", "op", 10_000_000).unwrap();
        s.observe_relay_time("org", 100).unwrap();
        assert!(!s.validate_received_hlc("org", &stamp).unwrap());
        let next = s.issue_hlc("org", "a", "op2", 99_999_999).unwrap();
        assert_eq!(next.wall_millis, 300_100);
    }
    #[test]
    fn append_only_ops_and_decision_key_are_idempotent() {
        let (_d, s) = store();
        let actor = ActorRef {
            user_id: "u".into(),
            seat: None,
            display: "U".into(),
            kind: "user".into(),
        };
        let op = CompletionOperation {
            completion_id: "c".into(),
            step_id: "step".into(),
            completed_at: "now".into(),
            completed_by: actor,
            outcome: None,
            source_operation_id: "op".into(),
        };
        s.append_completion("i", &op).unwrap();
        s.append_completion("i", &op).unwrap();
        let count: i64 = lock_unpoison(&s.conn)
            .query_row(
                "SELECT COUNT(*) FROM workflow_completion_operations",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 1);
    }
    #[test]
    fn propagation_commit_persists_snapshot_operations_activity_and_notification_intent_together() {
        let (_d, s) = store();
        s.commit_propagation_transaction(
            "apply", "event-1", r#"{"id":"instance-1"}"#,
            &["op-1".into(), "op-2".into()], "activity:event-1",
            &[("org-1".into(), "envelope-1".into())],
        ).unwrap();
        let conn = lock_unpoison(&s.conn);
        for table in ["crm_propagation_transactions", "crm_immutable_operations", "crm_activity_outbox", "crm_notification_outbox_intents"] {
            let count: i64 = conn.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| row.get(0)).unwrap();
            assert!(count > 0, "{table} must be committed with the propagation event");
        }
    }
}
