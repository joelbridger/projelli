use anyhow::{bail, Context, Result};
use rand::RngCore;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};

use crate::commands::audit::store::{AuditEntryRecord, EncryptedAuditStore};
use crate::util::sync::lock_unpoison;

const KEYCHAIN_SERVICE: &str = crate::identity::INTAKE_FACTS_ENC_SERVICE;
const KEYCHAIN_KEY: &str = "master-key-v1";
const KEY_LEN: usize = 32;

fn intake_master_key() -> Result<[u8; KEY_LEN]> {
    if let Ok(hex) = std::env::var("LANTERN_HEADLESS_TEST_INTAKE_FACTS_MASTER_KEY_HEX") {
        let bytes = hex::decode(hex.trim()).context("decode headless intake facts key")?;
        if bytes.len() != KEY_LEN {
            bail!("headless intake facts key has wrong length: {}", bytes.len());
        }
        let mut out = [0u8; KEY_LEN];
        out.copy_from_slice(&bytes);
        return Ok(out);
    }

    let entry = keyring::Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_KEY)
        .context("intake facts keychain entry")?;
    match entry.get_password() {
        Ok(hex) => {
            let bytes = hex::decode(hex.trim()).context("decode intake facts key")?;
            if bytes.len() != KEY_LEN {
                bail!("stored intake facts key has wrong length: {}", bytes.len());
            }
            let mut out = [0u8; KEY_LEN];
            out.copy_from_slice(&bytes);
            Ok(out)
        }
        Err(keyring::Error::NoEntry) => {
            let mut out = [0u8; KEY_LEN];
            rand::thread_rng().fill_bytes(&mut out);
            entry
                .set_password(&hex::encode(out))
                .context("store intake facts key")?;
            Ok(out)
        }
        Err(e) => Err(anyhow::anyhow!("intake facts keychain read: {e}")),
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct IntakeFactInput {
    pub fact_id: Option<String>,
    pub matter_id: String,
    pub subject: String,
    pub kind: String,
    pub value: Value,
    pub sensitivity: String,
    pub provenance: Value,
    pub verification: String,
}

#[derive(Debug, Clone)]
pub struct ClientFactRow {
    pub fact_id: String,
    pub matter_id: String,
    pub subject: String,
    pub kind: String,
    pub value_json: String,
    pub sensitivity: String,
    pub provenance_json: String,
    pub verification: String,
    pub status: String,
    pub superseded_by: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct MaskedClientFact {
    pub fact_id: String,
    pub matter_id: String,
    pub subject: String,
    pub kind: String,
    pub sensitivity: String,
    pub display_value: String,
    pub provenance: Value,
    pub verification: String,
    pub status: String,
    pub superseded_by: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct RevealedClientFact {
    pub fact_id: String,
    pub matter_id: String,
    pub subject: String,
    pub kind: String,
    pub sensitivity: String,
    pub display_value: String,
    pub provenance: Value,
    pub verification: String,
    pub status: String,
    pub superseded_by: Option<String>,
    pub value: Value,
}

pub trait IntakeAuditSink: Send + Sync {
    fn append(&self, entry: AuditEntryRecord) -> Result<()>;
}

pub struct EncryptedAuditSink {
    workspace_root: PathBuf,
}

impl EncryptedAuditSink {
    pub fn new(workspace_root: PathBuf) -> Self {
        Self { workspace_root }
    }
}

impl IntakeAuditSink for EncryptedAuditSink {
    fn append(&self, entry: AuditEntryRecord) -> Result<()> {
        let store = EncryptedAuditStore::open(&self.workspace_root)?;
        store.append(&entry)?;
        Ok(())
    }
}

pub struct IntakeFactsStore {
    conn: std::sync::Mutex<Connection>,
    #[allow(dead_code)]
    workspace_root: PathBuf,
}

fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

fn new_fact_id() -> String {
    let mut bytes = [0u8; 16];
    rand::thread_rng().fill_bytes(&mut bytes);
    format!("fact_{}", hex::encode(bytes))
}

fn row_to_fact(row: &rusqlite::Row<'_>) -> rusqlite::Result<ClientFactRow> {
    Ok(ClientFactRow {
        fact_id: row.get(0)?,
        matter_id: row.get(1)?,
        subject: row.get(2)?,
        kind: row.get(3)?,
        value_json: row.get(4)?,
        sensitivity: row.get(5)?,
        provenance_json: row.get(6)?,
        verification: row.get(7)?,
        status: row.get(8)?,
        superseded_by: row.get(9)?,
        created_at: row.get(10)?,
    })
}

fn value_plain(value: &Value) -> String {
    match value.get("t").and_then(Value::as_str) {
        Some("date") | Some("string") => value
            .get("v")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string(),
        Some("money") => {
            let fallback = Value::Null;
            let v = value.get("v").unwrap_or(&fallback);
            format!(
                "{} {}",
                v.get("currency").and_then(Value::as_str).unwrap_or(""),
                v.get("amount").and_then(Value::as_f64).unwrap_or_default()
            )
            .trim()
            .to_string()
        }
        Some("range") => {
            let fallback = Value::Null;
            let v = value.get("v").unwrap_or(&fallback);
            let min = v.get("min").map(Value::to_string).unwrap_or_default();
            let max = v.get("max").map(Value::to_string).unwrap_or_default();
            format!("{}{}", min, if max.is_empty() { String::new() } else { format!(" to {max}") })
        }
        Some("doc_ref") => value
            .get("v")
            .and_then(|v| v.get("path"))
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string(),
        _ => value.to_string(),
    }
}

fn mask_value(kind: &str, value: &Value, sensitivity: &str) -> String {
    let plain = value_plain(value);
    if sensitivity != "restricted" {
        return plain;
    }
    let digits: String = plain.chars().filter(|c| c.is_ascii_digit()).collect();
    let mut last4 = digits
        .chars()
        .rev()
        .take(4)
        .collect::<String>()
        .chars()
        .rev()
        .collect::<String>();
    while last4.len() < 4 {
        last4.insert(0, '•');
    }
    if kind == "ssn" {
        format!("•••-••-{last4}")
    } else {
        format!("••••{last4}")
    }
}

fn masked(row: &ClientFactRow) -> Result<MaskedClientFact> {
    let value: Value = serde_json::from_str(&row.value_json).context("decode fact value")?;
    let provenance: Value = serde_json::from_str(&row.provenance_json).context("decode provenance")?;
    Ok(MaskedClientFact {
        fact_id: row.fact_id.clone(),
        matter_id: row.matter_id.clone(),
        subject: row.subject.clone(),
        kind: row.kind.clone(),
        sensitivity: row.sensitivity.clone(),
        display_value: mask_value(&row.kind, &value, &row.sensitivity),
        provenance,
        verification: row.verification.clone(),
        status: row.status.clone(),
        superseded_by: row.superseded_by.clone(),
    })
}

fn audit_entry(
    action: &str,
    description: &str,
    matter_id: &str,
    fact_id: Option<&str>,
    phase: &str,
    pair_id: &str,
) -> AuditEntryRecord {
    let timestamp = now_iso();
    let id = format!(
        "audit_intake_{}_{}_{}",
        pair_id,
        phase,
        timestamp.replace([':', '.', '-'], "")
    );
    let payload = json!({
        "auditEventType": "intake_fact",
        "matter_id": matter_id,
        "fact_id": fact_id,
        "phase": phase,
        "audit_pair_id": pair_id,
        "action": action,
    });
    AuditEntryRecord {
        id,
        timestamp,
        action: action.to_string(),
        description: description.to_string(),
        payload_json: payload.to_string(),
    }
}

impl IntakeFactsStore {
    pub fn db_path(workspace_root: &Path) -> PathBuf {
        crate::commands::data_dir::workspace_data_dir(workspace_root).join("intake-facts-enc.db")
    }

    pub fn open_with_key(workspace_root: &Path, key: &[u8; KEY_LEN]) -> Result<Self> {
        let path = Self::db_path(workspace_root);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).ok();
        }
        let conn = Connection::open(&path)
            .with_context(|| format!("open intake facts db {}", path.display()))?;
        conn.execute_batch(&format!("PRAGMA key = \"x'{}'\";", hex::encode(key)))?;
        conn.busy_timeout(std::time::Duration::from_secs(5))?;
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS client_facts (
                fact_id         TEXT PRIMARY KEY,
                matter_id       TEXT NOT NULL,
                subject         TEXT NOT NULL,
                kind            TEXT NOT NULL,
                value_json      TEXT NOT NULL,
                sensitivity     TEXT NOT NULL,
                provenance_json TEXT NOT NULL,
                verification    TEXT NOT NULL,
                status          TEXT NOT NULL,
                superseded_by   TEXT,
                created_at      TEXT NOT NULL
            );
             CREATE UNIQUE INDEX IF NOT EXISTS uq_client_facts_active
                ON client_facts(matter_id, subject, kind)
                WHERE status = 'active';
             CREATE INDEX IF NOT EXISTS idx_client_facts_matter
                ON client_facts(matter_id);",
        )?;
        Ok(Self {
            conn: std::sync::Mutex::new(conn),
            workspace_root: workspace_root.to_path_buf(),
        })
    }

    pub fn open(workspace_root: &Path) -> Result<Self> {
        let key = intake_master_key()?;
        Self::open_with_key(workspace_root, &key)
    }

    pub fn upsert_fact(
        &self,
        input: IntakeFactInput,
        audit: &dyn IntakeAuditSink,
    ) -> Result<MaskedClientFact> {
        let fact_id = input.fact_id.clone().unwrap_or_else(new_fact_id);
        let pair_id = format!("fact_{fact_id}");
        audit.append(audit_entry(
            "intake_fact_upsert",
            "Intake item received; filing to local facts store.",
            &input.matter_id,
            Some(&fact_id),
            "intent",
            &pair_id,
        ))?;

        let mut conn = lock_unpoison(&self.conn);
        let tx = conn.transaction()?;
        let existing_same: Option<ClientFactRow> = tx
            .query_row(
                "SELECT fact_id, matter_id, subject, kind, value_json, sensitivity, provenance_json,
                        verification, status, superseded_by, created_at
                 FROM client_facts WHERE fact_id = ?1",
                params![fact_id],
                row_to_fact,
            )
            .optional()?;
        if let Some(row) = existing_same {
            audit.append(audit_entry(
                "intake_fact_upsert",
                "Intake fact already filed locally.",
                &row.matter_id,
                Some(&row.fact_id),
                "outcome",
                &pair_id,
            ))?;
            tx.commit()?;
            return masked(&row);
        }

        let active_old: Option<String> = tx
            .query_row(
                "SELECT fact_id FROM client_facts
                 WHERE matter_id = ?1 AND subject = ?2 AND kind = ?3 AND status = 'active'",
                params![input.matter_id, input.subject, input.kind],
                |row| row.get(0),
            )
            .optional()?;
        if let Some(old_id) = active_old {
            tx.execute(
                "UPDATE client_facts
                 SET status = 'superseded', superseded_by = ?1
                 WHERE fact_id = ?2",
                params![fact_id, old_id],
            )?;
        }

        let value_json = serde_json::to_string(&input.value)?;
        let provenance_json = serde_json::to_string(&input.provenance)?;
        let created_at = now_iso();
        tx.execute(
            "INSERT INTO client_facts
                (fact_id, matter_id, subject, kind, value_json, sensitivity, provenance_json,
                 verification, status, superseded_by, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'active', NULL, ?9)",
            params![
                fact_id,
                input.matter_id,
                input.subject,
                input.kind,
                value_json,
                input.sensitivity,
                provenance_json,
                input.verification,
                created_at,
            ],
        )?;
        audit.append(audit_entry(
            "intake_fact_upsert",
            "Intake fact filed locally.",
            &input.matter_id,
            Some(&fact_id),
            "outcome",
            &pair_id,
        ))?;
        tx.commit()?;
        drop(conn);
        self.get_masked(&fact_id)
    }

    fn get_row(&self, fact_id: &str) -> Result<ClientFactRow> {
        let conn = lock_unpoison(&self.conn);
        conn.query_row(
            "SELECT fact_id, matter_id, subject, kind, value_json, sensitivity, provenance_json,
                    verification, status, superseded_by, created_at
             FROM client_facts WHERE fact_id = ?1",
            params![fact_id],
            row_to_fact,
        )
        .optional()?
        .ok_or_else(|| anyhow::anyhow!("fact not found"))
    }

    fn get_row_for_matter(&self, matter_id: &str, fact_id: &str) -> Result<ClientFactRow> {
        let conn = lock_unpoison(&self.conn);
        conn.query_row(
            "SELECT fact_id, matter_id, subject, kind, value_json, sensitivity, provenance_json,
                    verification, status, superseded_by, created_at
             FROM client_facts WHERE matter_id = ?1 AND fact_id = ?2",
            params![matter_id, fact_id],
            row_to_fact,
        )
        .optional()?
        .ok_or_else(|| anyhow::anyhow!("fact not found"))
    }

    pub fn get_masked(&self, fact_id: &str) -> Result<MaskedClientFact> {
        masked(&self.get_row(fact_id)?)
    }

    pub fn list_masked(&self, matter_id: &str) -> Result<Vec<MaskedClientFact>> {
        let conn = lock_unpoison(&self.conn);
        let mut stmt = conn.prepare(
            "SELECT fact_id, matter_id, subject, kind, value_json, sensitivity, provenance_json,
                    verification, status, superseded_by, created_at
             FROM client_facts
             WHERE matter_id = ?1 AND status = 'active'
             ORDER BY created_at ASC",
        )?;
        let rows = stmt
            .query_map(params![matter_id], row_to_fact)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        rows.iter().map(masked).collect()
    }

    pub fn reveal_fact(
        &self,
        matter_id: &str,
        fact_id: &str,
        audit: &dyn IntakeAuditSink,
    ) -> Result<RevealedClientFact> {
        let row = self.get_row_for_matter(matter_id, fact_id)?;
        audit.append(audit_entry(
            "intake_fact_reveal",
            "Restricted intake fact revealed.",
            &row.matter_id,
            Some(&row.fact_id),
            "outcome",
            &format!("reveal_{}", row.fact_id),
        ))?;
        let base = masked(&row)?;
        let value: Value = serde_json::from_str(&row.value_json)?;
        Ok(RevealedClientFact {
            fact_id: base.fact_id,
            matter_id: base.matter_id,
            subject: base.subject,
            kind: base.kind,
            sensitivity: base.sensitivity,
            display_value: base.display_value,
            provenance: base.provenance,
            verification: base.verification,
            status: base.status,
            superseded_by: base.superseded_by,
            value,
        })
    }

    pub fn purge(&self, matter_id: &str, fact_id: &str, audit: &dyn IntakeAuditSink) -> Result<Vec<String>> {
        let row = self.get_row_for_matter(matter_id, fact_id)?;
        let pair_id = format!("purge_{fact_id}");
        audit.append(audit_entry(
            "intake_fact_purge",
            "Intake fact purged locally.",
            &row.matter_id,
            Some(&row.fact_id),
            "outcome",
            &pair_id,
        ))?;
        let mut conn = lock_unpoison(&self.conn);
        let tx = conn.transaction()?;
        tx.execute(
            "DELETE FROM client_facts WHERE matter_id = ?1 AND fact_id = ?2",
            params![matter_id, fact_id],
        )?;
        tx.commit()?;
        Ok(vec![row.fact_id])
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};

    #[derive(Default)]
    struct VecAudit {
        entries: Arc<Mutex<Vec<AuditEntryRecord>>>,
        fail_first: bool,
    }

    impl IntakeAuditSink for VecAudit {
        fn append(&self, entry: AuditEntryRecord) -> Result<()> {
            let mut entries = self.entries.lock().unwrap();
            if self.fail_first && entries.is_empty() {
                bail!("audit failed");
            }
            entries.push(entry);
            Ok(())
        }
    }

    fn store() -> (tempfile::TempDir, IntakeFactsStore) {
        let dir = tempfile::tempdir().unwrap();
        let store = IntakeFactsStore::open_with_key(dir.path(), &[7u8; 32]).unwrap();
        (dir, store)
    }

    fn input(fact_id: &str, value: &str) -> IntakeFactInput {
        input_for_subject(fact_id, "primary", value)
    }

    fn input_for_subject(fact_id: &str, subject: &str, value: &str) -> IntakeFactInput {
        IntakeFactInput {
            fact_id: Some(fact_id.to_string()),
            matter_id: "matter-1".into(),
            subject: subject.into(),
            kind: "ssn".into(),
            value: json!({ "t": "string", "v": value }),
            sensitivity: "restricted".into(),
            provenance: json!({
                "channel": "manual",
                "entered_by": "advisor-1",
                "at": "2026-07-10T00:00:00.000Z"
            }),
            verification: "advisor_confirmed".into(),
        }
    }

    #[test]
    fn supersede_chain_keeps_one_active_fact_per_key() {
        let (_dir, store) = store();
        let audit = VecAudit::default();
        store.upsert_fact(input("fact-1", "123-45-6789"), &audit).unwrap();
        store.upsert_fact(input("fact-2", "987-65-4321"), &audit).unwrap();

        let active = store.list_masked("matter-1").unwrap();
        assert_eq!(active.len(), 1);
        assert_eq!(active[0].fact_id, "fact-2");
        let old = store.get_masked("fact-1").unwrap();
        assert_eq!(old.status, "superseded");
        assert_eq!(old.superseded_by.as_deref(), Some("fact-2"));
    }

    #[test]
    fn masking_uses_restricted_display_without_returning_full_value() {
        let (_dir, store) = store();
        let audit = VecAudit::default();
        store.upsert_fact(input("fact-1", "123-45-6789"), &audit).unwrap();

        let masked = store.list_masked("matter-1").unwrap();
        assert_eq!(masked[0].display_value, "•••-••-6789");
        let serialized = serde_json::to_string(&masked).unwrap();
        assert!(!serialized.contains("123-45-6789"));
    }

    #[test]
    fn reveal_writes_an_audit_row() {
        let (_dir, store) = store();
        let audit = VecAudit::default();
        store.upsert_fact(input("fact-1", "123-45-6789"), &audit).unwrap();
        let before = audit.entries.lock().unwrap().len();

        let revealed = store.reveal_fact("matter-1", "fact-1", &audit).unwrap();

        assert_eq!(revealed.value, json!({ "t": "string", "v": "123-45-6789" }));
        assert_eq!(audit.entries.lock().unwrap().len(), before + 1);
    }

    #[test]
    fn audit_append_failure_refuses_the_write() {
        let (_dir, store) = store();
        let audit = VecAudit {
            fail_first: true,
            ..VecAudit::default()
        };

        let err = store.upsert_fact(input("fact-1", "123-45-6789"), &audit);

        assert!(err.is_err());
        assert!(store.list_masked("matter-1").unwrap().is_empty());
    }

    #[test]
    fn purge_deletes_and_audits_one_fact() {
        let (_dir, store) = store();
        let audit = VecAudit::default();
        store.upsert_fact(input("fact-1", "123-45-6789"), &audit).unwrap();
        let before = audit.entries.lock().unwrap().len();

        let purged = store.purge("matter-1", "fact-1", &audit).unwrap();

        assert_eq!(purged, vec!["fact-1".to_string()]);
        assert!(store.list_masked("matter-1").unwrap().is_empty());
        assert_eq!(audit.entries.lock().unwrap().len(), before + 1);
    }

    #[test]
    fn purge_deletes_only_the_selected_household_fact_and_audits_once() {
        let (_dir, store) = store();
        let audit = VecAudit::default();
        store.upsert_fact(input("fact-1", "123-45-6789"), &audit).unwrap();
        store
            .upsert_fact(input_for_subject("fact-2", "spouse", "987-65-4321"), &audit)
            .unwrap();
        let before = audit.entries.lock().unwrap().len();

        let purged = store.purge("matter-1", "fact-1", &audit).unwrap();

        assert_eq!(purged, vec!["fact-1".to_string()]);
        let remaining = store.list_masked("matter-1").unwrap();
        assert_eq!(remaining.len(), 1);
        assert_eq!(remaining[0].fact_id, "fact-2");
        assert_eq!(remaining[0].subject, "spouse");
        assert_eq!(audit.entries.lock().unwrap().len(), before + 1);
    }

    #[test]
    fn wrong_matter_cannot_reveal_or_purge_a_fact() {
        let (_dir, store) = store();
        let audit = VecAudit::default();
        store.upsert_fact(input("fact-1", "123-45-6789"), &audit).unwrap();
        let before = audit.entries.lock().unwrap().len();

        assert!(store.reveal_fact("matter-2", "fact-1", &audit).is_err());
        assert!(store.purge("matter-2", "fact-1", &audit).is_err());

        assert_eq!(audit.entries.lock().unwrap().len(), before);
        assert_eq!(store.list_masked("matter-1").unwrap().len(), 1);
        assert_eq!(
            store
                .reveal_fact("matter-1", "fact-1", &audit)
                .unwrap()
                .value,
            json!({ "t": "string", "v": "123-45-6789" })
        );
    }
}
