//! Durable encrypted SQLCipher store for DocuSign sync state.
//!
//! `docusign-enc.db` holds fetched envelopes, audit events, content hashes,
//! cursors, fetched-vs-indexed state, tombstones, and the needs-assignment list.

use anyhow::{Context, Result};
use rusqlite::{Connection, OptionalExtension};
use std::path::{Path, PathBuf};

const DOCUSIGN_DB_KEYCHAIN_SERVICE: &str = "keepance-docusign-enc";
const DOCUSIGN_DB_KEYCHAIN_KEY: &str = "master-key-v1";
const KEY_LEN: usize = 32;

fn docusign_master_key() -> Result<[u8; KEY_LEN]> {
    let entry = keyring::Entry::new(DOCUSIGN_DB_KEYCHAIN_SERVICE, DOCUSIGN_DB_KEYCHAIN_KEY)
        .context("docusign db keychain entry")?;
    match entry.get_password() {
        Ok(hex) => {
            let bytes = hex::decode(hex.trim()).context("decode docusign db key")?;
            if bytes.len() != KEY_LEN {
                anyhow::bail!("stored docusign db key has wrong length: {}", bytes.len());
            }
            let mut out = [0u8; KEY_LEN];
            out.copy_from_slice(&bytes);
            Ok(out)
        }
        Err(keyring::Error::NoEntry) => {
            let mut out = [0u8; KEY_LEN];
            rand::RngCore::fill_bytes(&mut rand::thread_rng(), &mut out);
            entry
                .set_password(&hex::encode(out))
                .context("store docusign db key")?;
            Ok(out)
        }
        Err(e) => Err(anyhow::anyhow!("docusign db keychain read: {e}")),
    }
}

#[derive(Debug, Clone)]
pub struct DocusignEnvelopeRow {
    pub source_id: String,
    pub envelope_id: String,
    pub matter_id: String,
    pub content_hash: String,
    pub json: String,
    pub needs_assignment: bool,
    pub deleted: bool,
}

#[derive(Debug, Clone)]
pub struct DocusignAuditRow {
    pub source_id: String,
    pub envelope_id: String,
    pub matter_id: String,
    pub content_hash: String,
    pub json: String,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocusignUnassignedRow {
    pub source_id: String,
    pub envelope_id: String,
    pub subject: String,
    pub reason: String,
}

pub struct DocusignStore {
    conn: std::sync::Mutex<Connection>,
    #[allow(dead_code)]
    workspace_root: PathBuf,
}

impl DocusignStore {
    pub fn db_path(workspace_root: &Path) -> PathBuf {
        workspace_root.join(".keepance").join("docusign-enc.db")
    }

    pub fn open(workspace_root: &Path) -> Result<Self> {
        let key = docusign_master_key()?;
        Self::open_with_key(workspace_root, &key)
    }

    pub fn open_with_key(workspace_root: &Path, key: &[u8; KEY_LEN]) -> Result<Self> {
        let path = Self::db_path(workspace_root);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).ok();
        }
        let conn = Connection::open(&path)
            .with_context(|| format!("open docusign enc db {}", path.display()))?;
        let hex_key = hex::encode(key);
        conn.execute_batch(&format!("PRAGMA key = \"x'{}'\";", hex_key))?;
        conn.busy_timeout(std::time::Duration::from_secs(5))?;
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS docusign_envelopes (
                source_id        TEXT PRIMARY KEY,
                envelope_id      TEXT NOT NULL,
                matter_id        TEXT NOT NULL,
                subject          TEXT NOT NULL DEFAULT '',
                completed_at     TEXT NOT NULL DEFAULT '',
                content_hash     TEXT NOT NULL,
                json             TEXT NOT NULL,
                fetched_at       INTEGER NOT NULL DEFAULT 0,
                indexed          INTEGER NOT NULL DEFAULT 0,
                needs_assignment INTEGER NOT NULL DEFAULT 0,
                assignment_reason TEXT NOT NULL DEFAULT '',
                deleted          INTEGER NOT NULL DEFAULT 0
            );
             CREATE INDEX IF NOT EXISTS idx_docusign_envelopes_matter
                ON docusign_envelopes(matter_id);
             CREATE TABLE IF NOT EXISTS docusign_audit (
                source_id     TEXT PRIMARY KEY,
                envelope_id   TEXT NOT NULL,
                matter_id     TEXT NOT NULL,
                content_hash  TEXT NOT NULL,
                json          TEXT NOT NULL,
                indexed       INTEGER NOT NULL DEFAULT 0
            );
             CREATE INDEX IF NOT EXISTS idx_docusign_audit_envelope
                ON docusign_audit(envelope_id);
             CREATE TABLE IF NOT EXISTS docusign_cursors (
                cursor_key TEXT PRIMARY KEY,
                cursor     TEXT NOT NULL
            );
             CREATE TABLE IF NOT EXISTS docusign_hashes (
                source_id    TEXT PRIMARY KEY,
                content_hash TEXT NOT NULL
            );
             CREATE TABLE IF NOT EXISTS docusign_tombstones (
                source_id  TEXT PRIMARY KEY,
                deleted_at INTEGER NOT NULL
            );
             CREATE TABLE IF NOT EXISTS docusign_meta (
                key   TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );",
        )?;
        Ok(Self {
            conn: std::sync::Mutex::new(conn),
            workspace_root: workspace_root.to_path_buf(),
        })
    }

    pub fn upsert_envelope(
        &self,
        source_id: &str,
        envelope_id: &str,
        matter_id: &str,
        subject: &str,
        completed_at: &str,
        content_hash: &str,
        json: &str,
        needs_assignment: bool,
        assignment_reason: &str,
    ) -> Result<bool> {
        let c = self.conn.lock().unwrap();
        let previous: Option<String> = c
            .query_row(
                "SELECT content_hash FROM docusign_envelopes WHERE source_id = ?1 AND deleted = 0",
                [source_id],
                |r| r.get(0),
            )
            .optional()?;
        let changed = previous.as_deref() != Some(content_hash);
        c.execute(
            "INSERT INTO docusign_envelopes
                (source_id, envelope_id, matter_id, subject, completed_at, content_hash, json,
                 fetched_at, indexed, needs_assignment, assignment_reason, deleted)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, strftime('%s','now'), 0, ?8, ?9, 0)
             ON CONFLICT(source_id) DO UPDATE SET
                envelope_id = ?2,
                matter_id = ?3,
                subject = ?4,
                completed_at = ?5,
                content_hash = ?6,
                json = ?7,
                fetched_at = strftime('%s','now'),
                indexed = CASE WHEN content_hash = ?6 THEN indexed ELSE 0 END,
                needs_assignment = ?8,
                assignment_reason = ?9,
                deleted = 0",
            rusqlite::params![
                source_id,
                envelope_id,
                matter_id,
                subject,
                completed_at,
                content_hash,
                json,
                needs_assignment as i64,
                assignment_reason
            ],
        )?;
        c.execute(
            "INSERT INTO docusign_hashes (source_id, content_hash) VALUES (?1, ?2)
             ON CONFLICT(source_id) DO UPDATE SET content_hash = ?2",
            rusqlite::params![source_id, content_hash],
        )?;
        Ok(changed)
    }

    pub fn upsert_audit(
        &self,
        source_id: &str,
        envelope_id: &str,
        matter_id: &str,
        content_hash: &str,
        json: &str,
    ) -> Result<bool> {
        let c = self.conn.lock().unwrap();
        let previous: Option<String> = c
            .query_row(
                "SELECT content_hash FROM docusign_audit WHERE source_id = ?1",
                [source_id],
                |r| r.get(0),
            )
            .optional()?;
        let changed = previous.as_deref() != Some(content_hash);
        c.execute(
            "INSERT INTO docusign_audit
                (source_id, envelope_id, matter_id, content_hash, json, indexed)
             VALUES (?1, ?2, ?3, ?4, ?5, 0)
             ON CONFLICT(source_id) DO UPDATE SET
                envelope_id = ?2,
                matter_id = ?3,
                content_hash = ?4,
                json = ?5,
                indexed = CASE WHEN content_hash = ?4 THEN indexed ELSE 0 END",
            rusqlite::params![source_id, envelope_id, matter_id, content_hash, json],
        )?;
        c.execute(
            "INSERT INTO docusign_hashes (source_id, content_hash) VALUES (?1, ?2)
             ON CONFLICT(source_id) DO UPDATE SET content_hash = ?2",
            rusqlite::params![source_id, content_hash],
        )?;
        Ok(changed)
    }

    pub fn mark_indexed(&self, source_id: &str) -> Result<()> {
        let c = self.conn.lock().unwrap();
        c.execute(
            "UPDATE docusign_envelopes SET indexed = 1 WHERE source_id = ?1",
            [source_id],
        )?;
        c.execute(
            "UPDATE docusign_audit SET indexed = 1 WHERE source_id = ?1",
            [source_id],
        )?;
        Ok(())
    }

    pub fn get_envelope(&self, source_id: &str) -> Result<Option<DocusignEnvelopeRow>> {
        let c = self.conn.lock().unwrap();
        c.query_row(
            "SELECT source_id, envelope_id, matter_id, content_hash, json,
                    needs_assignment, deleted
             FROM docusign_envelopes WHERE source_id = ?1",
            [source_id],
            row_to_envelope,
        )
        .optional()
        .map_err(Into::into)
    }

    pub fn list_unindexed_envelopes(&self) -> Result<Vec<DocusignEnvelopeRow>> {
        let c = self.conn.lock().unwrap();
        let mut stmt = c.prepare(
            "SELECT source_id, envelope_id, matter_id, content_hash, json,
                    needs_assignment, deleted
             FROM docusign_envelopes
             WHERE deleted = 0 AND indexed = 0
             ORDER BY completed_at, envelope_id",
        )?;
        let rows = stmt.query_map([], row_to_envelope)?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(Into::into);
        rows
    }

    pub fn list_unindexed_audit(&self) -> Result<Vec<DocusignAuditRow>> {
        let c = self.conn.lock().unwrap();
        let mut stmt = c.prepare(
            "SELECT source_id, envelope_id, matter_id, content_hash, json
             FROM docusign_audit
             WHERE indexed = 0
             ORDER BY envelope_id, source_id",
        )?;
        let rows = stmt.query_map([], row_to_audit)?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(Into::into);
        rows
    }

    pub fn set_cursor(&self, key: &str, cursor: &str) -> Result<()> {
        let c = self.conn.lock().unwrap();
        c.execute(
            "INSERT INTO docusign_cursors (cursor_key, cursor) VALUES (?1, ?2)
             ON CONFLICT(cursor_key) DO UPDATE SET cursor = ?2",
            rusqlite::params![key, cursor],
        )?;
        Ok(())
    }

    pub fn get_cursor(&self, key: &str) -> Result<Option<String>> {
        let c = self.conn.lock().unwrap();
        c.query_row(
            "SELECT cursor FROM docusign_cursors WHERE cursor_key = ?1",
            [key],
            |r| r.get(0),
        )
        .optional()
        .map_err(Into::into)
    }

    pub fn set_last_polled(&self, envelope_id: &str, unix_secs: i64) -> Result<()> {
        self.set_meta(&format!("last-polled:{envelope_id}"), &unix_secs.to_string())
    }

    pub fn get_last_polled(&self, envelope_id: &str) -> Result<Option<i64>> {
        Ok(self
            .get_meta(&format!("last-polled:{envelope_id}"))?
            .and_then(|s| s.parse::<i64>().ok()))
    }

    pub fn set_meta(&self, key: &str, value: &str) -> Result<()> {
        let c = self.conn.lock().unwrap();
        c.execute(
            "INSERT INTO docusign_meta (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = ?2",
            rusqlite::params![key, value],
        )?;
        Ok(())
    }

    pub fn get_meta(&self, key: &str) -> Result<Option<String>> {
        let c = self.conn.lock().unwrap();
        c.query_row("SELECT value FROM docusign_meta WHERE key = ?1", [key], |r| {
            r.get(0)
        })
        .optional()
        .map_err(Into::into)
    }

    pub fn list_unassigned(&self) -> Result<Vec<DocusignUnassignedRow>> {
        let c = self.conn.lock().unwrap();
        let mut stmt = c.prepare(
            "SELECT source_id, envelope_id, subject, assignment_reason
             FROM docusign_envelopes
             WHERE deleted = 0 AND needs_assignment = 1
             ORDER BY completed_at DESC, envelope_id",
        )?;
        let rows = stmt.query_map([], |r| {
            Ok(DocusignUnassignedRow {
                source_id: r.get(0)?,
                envelope_id: r.get(1)?,
                subject: r.get(2)?,
                reason: r.get(3)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(Into::into);
        rows
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
                    .with_context(|| format!("remove docusign db file {}", path.display()))?;
            }
        }
        Ok(())
    }

    pub fn delete_master_key() -> Result<()> {
        match keyring::Entry::new(DOCUSIGN_DB_KEYCHAIN_SERVICE, DOCUSIGN_DB_KEYCHAIN_KEY)
            .context("docusign db keychain entry")?
            .delete_credential()
        {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(anyhow::anyhow!("docusign db key delete: {e}")),
        }
    }
}

fn row_to_envelope(row: &rusqlite::Row<'_>) -> rusqlite::Result<DocusignEnvelopeRow> {
    let needs: i64 = row.get(5)?;
    let deleted: i64 = row.get(6)?;
    Ok(DocusignEnvelopeRow {
        source_id: row.get(0)?,
        envelope_id: row.get(1)?,
        matter_id: row.get(2)?,
        content_hash: row.get(3)?,
        json: row.get(4)?,
        needs_assignment: needs != 0,
        deleted: deleted != 0,
    })
}

fn row_to_audit(row: &rusqlite::Row<'_>) -> rusqlite::Result<DocusignAuditRow> {
    Ok(DocusignAuditRow {
        source_id: row.get(0)?,
        envelope_id: row.get(1)?,
        matter_id: row.get(2)?,
        content_hash: row.get(3)?,
        json: row.get(4)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn store() -> (TempDir, DocusignStore) {
        let dir = TempDir::new().unwrap();
        let store = DocusignStore::open_with_key(dir.path(), &[0x44; 32]).unwrap();
        (dir, store)
    }

    #[test]
    fn cursor_persists_round_trip() {
        let (_dir, store) = store();
        assert_eq!(store.get_cursor("completed:2026-01-01").unwrap(), None);
        store.set_cursor("completed:2026-01-01", "1000").unwrap();
        assert_eq!(
            store.get_cursor("completed:2026-01-01").unwrap().as_deref(),
            Some("1000")
        );
    }

    #[test]
    fn unchanged_hash_reports_not_changed() {
        let (_dir, store) = store();
        let changed = store
            .upsert_envelope(
                "docusign:acct:e1",
                "e1",
                "matter-a",
                "Subject",
                "2026-06-01T00:00:00Z",
                "hash-1",
                "{}",
                false,
                "",
            )
            .unwrap();
        assert!(changed);
        store.mark_indexed("docusign:acct:e1").unwrap();
        let changed = store
            .upsert_envelope(
                "docusign:acct:e1",
                "e1",
                "matter-a",
                "Subject",
                "2026-06-01T00:00:00Z",
                "hash-1",
                "{}",
                false,
                "",
            )
            .unwrap();
        assert!(!changed);
        assert!(store.list_unindexed_envelopes().unwrap().is_empty());
    }

    #[test]
    fn unassigned_list_round_trips_reason() {
        let (_dir, store) = store();
        store
            .upsert_envelope(
                "docusign:acct:e1",
                "e1",
                "unassigned",
                "Ambiguous agreement",
                "2026-06-01T00:00:00Z",
                "hash-1",
                "{}",
                true,
                "multiple matter matches",
            )
            .unwrap();
        let rows = store.list_unassigned().unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].envelope_id, "e1");
        assert_eq!(rows[0].reason, "multiple matter matches");
    }
}
