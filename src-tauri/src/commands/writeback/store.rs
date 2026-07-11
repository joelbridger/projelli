//! SQLCipher-backed ledger for approval-gated external writes.
//!
//! This database is separate from the CRM database on purpose. Planning and
//! tax write receipts do not share tables with CRM internals.

use anyhow::{Context, Result};
use rusqlite::{Connection, OptionalExtension};
use std::path::{Path, PathBuf};

use crate::commands::writeback::model::{ExternalWriteOperation, ExternalWriteTarget};
use crate::util::sync::lock_unpoison;

const WRITEBACK_KEYCHAIN_SERVICE: &str = crate::identity::WRITEBACK_ENC_SERVICE;
const WRITEBACK_KEYCHAIN_KEY: &str = "master-key-v1";
const KEY_LEN: usize = 32;

fn writeback_master_key() -> Result<[u8; KEY_LEN]> {
    if let Ok(hex) = std::env::var("LANTERN_HEADLESS_TEST_WRITEBACK_MASTER_KEY_HEX") {
        let bytes = hex::decode(hex.trim()).context("decode headless test writeback key")?;
        if bytes.len() != KEY_LEN {
            anyhow::bail!(
                "headless test writeback master key has wrong length: {}",
                bytes.len()
            );
        }
        let mut k = [0u8; KEY_LEN];
        k.copy_from_slice(&bytes);
        return Ok(k);
    }

    let entry = keyring::Entry::new(WRITEBACK_KEYCHAIN_SERVICE, WRITEBACK_KEYCHAIN_KEY)
        .context("writeback keychain entry")?;
    match entry.get_password() {
        Ok(hex) => {
            let bytes = hex::decode(hex.trim()).context("decode writeback master key")?;
            if bytes.len() != KEY_LEN {
                anyhow::bail!(
                    "stored writeback master key has wrong length: {}",
                    bytes.len()
                );
            }
            let mut k = [0u8; KEY_LEN];
            k.copy_from_slice(&bytes);
            Ok(k)
        }
        Err(keyring::Error::NoEntry) => {
            let mut k = [0u8; KEY_LEN];
            rand::RngCore::fill_bytes(&mut rand::thread_rng(), &mut k);
            entry
                .set_password(&hex::encode(k))
                .context("store writeback master key")?;
            Ok(k)
        }
        Err(e) => Err(anyhow::anyhow!("writeback keychain read: {e}")),
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExternalOutboundWrite {
    pub dedup_key: String,
    pub target: String,
    pub operation: String,
    pub subject_key: String,
    pub matter_id: String,
    pub source_ref: String,
    pub status: String,
    pub remote_id: Option<String>,
    pub receipt_ref: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub content_key: String,
    pub before_hash: Option<String>,
    pub after_hash: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct PendingExternalWriteProposal {
    pub proposal_id: String,
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

pub struct ExternalWriteStore {
    conn: std::sync::Mutex<Connection>,
    #[allow(dead_code)]
    workspace_root: PathBuf,
}

impl ExternalWriteStore {
    pub fn db_path(workspace_root: &Path) -> PathBuf {
        crate::commands::data_dir::workspace_data_dir(workspace_root).join("writeback-enc.db")
    }

    pub fn open(workspace_root: &Path) -> Result<Self> {
        let key = writeback_master_key()?;
        Self::open_with_key(workspace_root, &key)
    }

    pub fn open_with_key(workspace_root: &Path, key: &[u8; KEY_LEN]) -> Result<Self> {
        let p = Self::db_path(workspace_root);
        if let Some(parent) = p.parent() {
            std::fs::create_dir_all(parent).ok();
        }
        let conn =
            Connection::open(&p).with_context(|| format!("open writeback db {}", p.display()))?;
        conn.execute_batch(&format!("PRAGMA key = \"x'{}'\";", hex::encode(key)))?;
        conn.busy_timeout(std::time::Duration::from_secs(5))?;
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS external_outbound_writes (
              dedup_key TEXT PRIMARY KEY,
              target TEXT NOT NULL,
              operation TEXT NOT NULL,
              subject_key TEXT NOT NULL,
              matter_id TEXT NOT NULL,
              source_ref TEXT NOT NULL,
              status TEXT NOT NULL,
              remote_id TEXT,
              receipt_ref TEXT,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              content_key TEXT NOT NULL DEFAULT '',
              before_hash TEXT,
              after_hash TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_external_outbound_target
              ON external_outbound_writes(target);
            CREATE INDEX IF NOT EXISTS idx_external_outbound_matter
              ON external_outbound_writes(matter_id);
            CREATE TABLE IF NOT EXISTS external_write_proposals (
              proposal_id TEXT PRIMARY KEY,
              target TEXT NOT NULL,
              operation_json TEXT NOT NULL,
              matter_id TEXT NOT NULL,
              subject_key TEXT NOT NULL DEFAULT '',
              source_ref TEXT NOT NULL,
              requested_at TEXT,
              before_hash TEXT,
              after_hash TEXT NOT NULL,
              current_json TEXT NOT NULL DEFAULT '{}',
              source_json TEXT NOT NULL DEFAULT '{}',
              final_json TEXT NOT NULL DEFAULT '{}',
              status TEXT NOT NULL,
              remote_id TEXT,
              receipt_ref TEXT,
              error TEXT,
              content_hash TEXT NOT NULL,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_external_write_proposals_matter
              ON external_write_proposals(matter_id);
            CREATE INDEX IF NOT EXISTS idx_external_write_proposals_status
              ON external_write_proposals(status);",
        )?;
        Ok(Self {
            conn: std::sync::Mutex::new(conn),
            workspace_root: workspace_root.to_path_buf(),
        })
    }

    pub fn outbound_get(&self, dedup_key: &str) -> Result<Option<ExternalOutboundWrite>> {
        let c = lock_unpoison(&self.conn);
        c.query_row(
            "SELECT dedup_key, target, operation, subject_key, matter_id, source_ref,
                    status, remote_id, receipt_ref, created_at, updated_at, content_key,
                    before_hash, after_hash
             FROM external_outbound_writes WHERE dedup_key = ?1",
            [dedup_key],
            row_to_outbound,
        )
        .optional()
        .map_err(anyhow::Error::from)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn outbound_upsert(
        &self,
        dedup_key: &str,
        target: &str,
        operation: &str,
        subject_key: &str,
        matter_id: &str,
        source_ref: &str,
        status: &str,
        remote_id: Option<&str>,
        receipt_ref: Option<&str>,
        reset_created_at: bool,
        content_key: &str,
        before_hash: Option<&str>,
        after_hash: &str,
    ) -> Result<()> {
        let c = lock_unpoison(&self.conn);
        let now = chrono::Utc::now().to_rfc3339();
        c.execute(
            "INSERT INTO external_outbound_writes
                (dedup_key, target, operation, subject_key, matter_id, source_ref,
                 status, remote_id, receipt_ref, created_at, updated_at, content_key,
                 before_hash, after_hash)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10, ?12, ?13, ?14)
             ON CONFLICT(dedup_key) DO UPDATE SET
                target = excluded.target,
                operation = excluded.operation,
                subject_key = excluded.subject_key,
                matter_id = excluded.matter_id,
                source_ref = excluded.source_ref,
                status = excluded.status,
                remote_id = CASE WHEN ?11 THEN excluded.remote_id ELSE COALESCE(excluded.remote_id, external_outbound_writes.remote_id) END,
                receipt_ref = COALESCE(excluded.receipt_ref, external_outbound_writes.receipt_ref),
                updated_at = excluded.updated_at,
                created_at = CASE WHEN ?11 THEN excluded.created_at ELSE external_outbound_writes.created_at END,
                content_key = excluded.content_key,
                before_hash = excluded.before_hash,
                after_hash = excluded.after_hash",
            rusqlite::params![
                dedup_key,
                target,
                operation,
                subject_key,
                matter_id,
                source_ref,
                status,
                remote_id,
                receipt_ref,
                now,
                reset_created_at,
                content_key,
                before_hash,
                after_hash,
            ],
        )?;
        Ok(())
    }

    pub fn proposal_upsert(
        &self,
        proposal: &PendingExternalWriteProposal,
    ) -> Result<PendingExternalWriteProposal> {
        let now = chrono::Utc::now().to_rfc3339();
        let created_at = if proposal.created_at.trim().is_empty() {
            now.clone()
        } else {
            proposal.created_at.clone()
        };
        let operation_json = serde_json::to_string(&proposal.operation)
            .context("serialize external write operation")?;
        {
            let c = lock_unpoison(&self.conn);
            c.execute(
                "INSERT INTO external_write_proposals
                (proposal_id, target, operation_json, matter_id, subject_key, source_ref,
                 requested_at, before_hash, after_hash, current_json, source_json, final_json,
                 status, remote_id, receipt_ref, error, content_hash, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19)
             ON CONFLICT(proposal_id) DO UPDATE SET
                target = excluded.target,
                operation_json = excluded.operation_json,
                matter_id = excluded.matter_id,
                subject_key = excluded.subject_key,
                source_ref = excluded.source_ref,
                requested_at = excluded.requested_at,
                before_hash = excluded.before_hash,
                after_hash = excluded.after_hash,
                current_json = excluded.current_json,
                source_json = excluded.source_json,
                final_json = excluded.final_json,
                status = excluded.status,
                remote_id = excluded.remote_id,
                receipt_ref = excluded.receipt_ref,
                error = excluded.error,
                content_hash = excluded.content_hash,
                updated_at = excluded.updated_at",
                rusqlite::params![
                    proposal.proposal_id,
                    proposal.target.as_str(),
                    operation_json,
                    proposal.matter_id,
                    proposal.subject_key,
                    proposal.source_ref,
                    proposal.requested_at,
                    proposal.before_hash,
                    proposal.after_hash,
                    proposal.current_json,
                    proposal.source_json,
                    proposal.final_json,
                    proposal.status,
                    proposal.remote_id,
                    proposal.receipt_ref,
                    proposal.error,
                    proposal.content_hash,
                    created_at,
                    now,
                ],
            )?;
        }
        self.proposal_get(&proposal.proposal_id)?
            .ok_or_else(|| anyhow::anyhow!("external write proposal was not saved"))
    }

    pub fn proposal_get(&self, proposal_id: &str) -> Result<Option<PendingExternalWriteProposal>> {
        let c = lock_unpoison(&self.conn);
        c.query_row(
            "SELECT proposal_id, target, operation_json, matter_id, subject_key, source_ref,
                    requested_at, before_hash, after_hash, current_json, source_json, final_json,
                    status, remote_id, receipt_ref, error, content_hash, created_at, updated_at
             FROM external_write_proposals WHERE proposal_id = ?1",
            [proposal_id],
            row_to_proposal,
        )
        .optional()
        .map_err(anyhow::Error::from)
    }

    pub fn proposal_list_pending(&self) -> Result<Vec<PendingExternalWriteProposal>> {
        let c = lock_unpoison(&self.conn);
        let mut stmt = c.prepare(
            "SELECT proposal_id, target, operation_json, matter_id, subject_key, source_ref,
                    requested_at, before_hash, after_hash, current_json, source_json, final_json,
                    status, remote_id, receipt_ref, error, content_hash, created_at, updated_at
             FROM external_write_proposals
             WHERE status != 'sent'
             ORDER BY created_at ASC",
        )?;
        let rows = stmt
            .query_map([], row_to_proposal)?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(anyhow::Error::from)?;
        Ok(rows)
    }

    pub fn proposal_delete(&self, proposal_id: &str) -> Result<usize> {
        let c = lock_unpoison(&self.conn);
        c.execute(
            "DELETE FROM external_write_proposals WHERE proposal_id = ?1",
            [proposal_id],
        )
        .map_err(anyhow::Error::from)
    }
}

fn row_to_outbound(row: &rusqlite::Row<'_>) -> rusqlite::Result<ExternalOutboundWrite> {
    Ok(ExternalOutboundWrite {
        dedup_key: row.get(0)?,
        target: row.get(1)?,
        operation: row.get(2)?,
        subject_key: row.get(3)?,
        matter_id: row.get(4)?,
        source_ref: row.get(5)?,
        status: row.get(6)?,
        remote_id: row.get(7)?,
        receipt_ref: row.get(8)?,
        created_at: row.get(9)?,
        updated_at: row.get(10)?,
        content_key: row.get(11)?,
        before_hash: row.get(12)?,
        after_hash: row.get(13)?,
    })
}

fn row_to_proposal(row: &rusqlite::Row<'_>) -> rusqlite::Result<PendingExternalWriteProposal> {
    let target_s: String = row.get(1)?;
    let operation_json: String = row.get(2)?;
    let target = match target_s.as_str() {
        "wealthbox" => ExternalWriteTarget::Wealthbox,
        "rightcapital" => ExternalWriteTarget::Rightcapital,
        "holistiplan" => ExternalWriteTarget::Holistiplan,
        _ => return Err(rusqlite::Error::InvalidQuery),
    };
    let operation = serde_json::from_str::<ExternalWriteOperation>(&operation_json)
        .map_err(|_| rusqlite::Error::InvalidQuery)?;
    Ok(PendingExternalWriteProposal {
        proposal_id: row.get(0)?,
        target,
        operation,
        matter_id: row.get(3)?,
        subject_key: row.get(4)?,
        source_ref: row.get(5)?,
        requested_at: row.get(6)?,
        before_hash: row.get(7)?,
        after_hash: row.get(8)?,
        current_json: row.get(9)?,
        source_json: row.get(10)?,
        final_json: row.get(11)?,
        status: row.get(12)?,
        remote_id: row.get(13)?,
        receipt_ref: row.get(14)?,
        error: row.get(15)?,
        content_hash: row.get(16)?,
        created_at: row.get(17)?,
        updated_at: row.get(18)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::writeback::model::{
        ExternalWriteOperation, HolistiplanOperation, IncomeFrequency, MoneyAmount,
        RightCapitalIncomeType, RightCapitalOperation,
    };

    fn test_key() -> [u8; KEY_LEN] {
        [7u8; KEY_LEN]
    }

    fn test_store() -> (tempfile::TempDir, ExternalWriteStore) {
        let dir = tempfile::tempdir().unwrap();
        let store = ExternalWriteStore::open_with_key(dir.path(), &test_key()).unwrap();
        (dir, store)
    }

    #[test]
    fn outbound_ledger_upsert_roundtrip_uses_external_table_shape() {
        let (_dir, store) = test_store();
        assert!(store.outbound_get("k1").unwrap().is_none());
        store
            .outbound_upsert(
                "k1",
                "rightcapital",
                "rightcapital.upsert_income",
                "hh-1",
                "m1",
                "meeting:1",
                "pending",
                None,
                None,
                true,
                "content",
                Some("before"),
                "after",
            )
            .unwrap();
        let row = store.outbound_get("k1").unwrap().unwrap();
        assert_eq!(row.target, "rightcapital");
        assert_eq!(row.operation, "rightcapital.upsert_income");
        assert_eq!(row.subject_key, "hh-1");
        assert_eq!(row.matter_id, "m1");
        assert_eq!(row.status, "pending");
        assert_eq!(row.before_hash.as_deref(), Some("before"));
        assert_eq!(row.after_hash, "after");
    }

    #[test]
    fn proposal_persists_typed_operation() {
        let (_dir, store) = test_store();
        let proposal = PendingExternalWriteProposal {
            proposal_id: "p1".into(),
            target: ExternalWriteTarget::Rightcapital,
            operation: ExternalWriteOperation::Rightcapital(RightCapitalOperation::UpsertIncome {
                client_id: "client-1".into(),
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
                notes: "From meeting.".into(),
            }),
            matter_id: "m1".into(),
            subject_key: "hh-1".into(),
            source_ref: "meeting:1".into(),
            requested_at: None,
            before_hash: None,
            after_hash: "after".into(),
            current_json: "{}".into(),
            source_json: "{}".into(),
            final_json: "{}".into(),
            status: "proposed".into(),
            remote_id: None,
            receipt_ref: None,
            error: None,
            content_hash: "hash".into(),
            created_at: "".into(),
            updated_at: "".into(),
        };
        store.proposal_upsert(&proposal).unwrap();
        let row = store.proposal_get("p1").unwrap().unwrap();
        assert_eq!(row.target, ExternalWriteTarget::Rightcapital);
        assert_eq!(row.operation.operation_name(), "rightcapital.upsert_income");

        let holi = PendingExternalWriteProposal {
            proposal_id: "p2".into(),
            target: ExternalWriteTarget::Holistiplan,
            operation: ExternalWriteOperation::Holistiplan(
                HolistiplanOperation::UploadTaxDocument {
                    document_ref: "Clients/Henderson/2025-return.pdf".into(),
                    tax_year: 2025,
                    document_kind: "tax_return".into(),
                },
            ),
            matter_id: "m1".into(),
            subject_key: "hp-household-1".into(),
            source_ref: "client-folder:tax".into(),
            requested_at: None,
            before_hash: None,
            after_hash: "after2".into(),
            current_json: "{}".into(),
            source_json: "{}".into(),
            final_json: "{}".into(),
            status: "proposed".into(),
            remote_id: None,
            receipt_ref: None,
            error: None,
            content_hash: "hash2".into(),
            created_at: "".into(),
            updated_at: "".into(),
        };
        store.proposal_upsert(&holi).unwrap();
        assert_eq!(store.proposal_list_pending().unwrap().len(), 2);
    }
}
