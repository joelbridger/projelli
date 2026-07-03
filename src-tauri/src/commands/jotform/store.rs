//! Durable encrypted store for Jotform submissions.

use anyhow::{Context, Result};
use rusqlite::{Connection, OptionalExtension};
use std::path::{Path, PathBuf};

const JOTFORM_DB_KEYCHAIN_SERVICE: &str = crate::identity::JOTFORM_ENC_SERVICE;
const JOTFORM_DB_KEYCHAIN_KEY: &str = "master-key-v1";
const KEY_LEN: usize = 32;

fn jotform_master_key() -> Result<[u8; KEY_LEN]> {
    let entry = keyring::Entry::new(JOTFORM_DB_KEYCHAIN_SERVICE, JOTFORM_DB_KEYCHAIN_KEY)
        .context("jotform db keychain entry")?;
    match entry.get_password() {
        Ok(hex) => {
            let bytes = hex::decode(hex.trim()).context("decode jotform db key")?;
            if bytes.len() != KEY_LEN {
                anyhow::bail!("stored jotform db key has wrong length: {}", bytes.len());
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
                .context("store jotform db key")?;
            Ok(out)
        }
        Err(e) => Err(anyhow::anyhow!("jotform db keychain read: {e}")),
    }
}

#[derive(Debug, Clone)]
pub struct JotformSubmissionRow {
    pub source_id: String,
    pub form_id: String,
    pub submission_id: String,
    pub form_title: String,
    pub matter_id: String,
    pub content_hash: String,
    pub json: String,
    pub indexed_hash: String,
    pub deleted: bool,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JotformUnassignedRow {
    pub source_id: String,
    pub form_id: String,
    pub submission_id: String,
    pub submitter: String,
    pub reason: String,
}

pub struct JotformStore {
    conn: std::sync::Mutex<Connection>,
    #[allow(dead_code)]
    workspace_root: PathBuf,
}

impl JotformStore {
    pub fn db_path(workspace_root: &Path) -> PathBuf {
        crate::commands::data_dir::workspace_data_dir(workspace_root).join("jotform-enc.db")
    }

    pub fn open(workspace_root: &Path) -> Result<Self> {
        let key = jotform_master_key()?;
        Self::open_with_key(workspace_root, &key)
    }

    pub fn open_with_key(workspace_root: &Path, key: &[u8; KEY_LEN]) -> Result<Self> {
        let path = Self::db_path(workspace_root);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).ok();
        }
        let conn = Connection::open(&path)
            .with_context(|| format!("open jotform enc db {}", path.display()))?;
        conn.execute_batch(&format!("PRAGMA key = \"x'{}'\";", hex::encode(key)))?;
        conn.busy_timeout(std::time::Duration::from_secs(5))?;
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS jotform_submissions (
                source_id         TEXT PRIMARY KEY,
                form_id           TEXT NOT NULL,
                submission_id     TEXT NOT NULL,
                form_title        TEXT NOT NULL DEFAULT '',
                matter_id         TEXT NOT NULL,
                submitter         TEXT NOT NULL DEFAULT '',
                content_hash      TEXT NOT NULL,
                json              TEXT NOT NULL,
                fetched_at        TEXT NOT NULL,
                indexed_at        TEXT NOT NULL DEFAULT '',
                indexed_hash      TEXT NOT NULL DEFAULT '',
                needs_assignment  INTEGER NOT NULL DEFAULT 0,
                assignment_reason TEXT NOT NULL DEFAULT '',
                deleted           INTEGER NOT NULL DEFAULT 0
            );
             CREATE INDEX IF NOT EXISTS idx_jotform_submissions_form
                ON jotform_submissions(form_id);
             CREATE INDEX IF NOT EXISTS idx_jotform_submissions_indexed
                ON jotform_submissions(indexed_hash, content_hash);
             CREATE TABLE IF NOT EXISTS jotform_cursors (
                key    TEXT PRIMARY KEY,
                cursor TEXT NOT NULL
            );",
        )?;
        Ok(Self {
            conn: std::sync::Mutex::new(conn),
            workspace_root: workspace_root.to_path_buf(),
        })
    }

    #[allow(clippy::too_many_arguments)]
    pub fn upsert_submission(
        &self,
        source_id: &str,
        form_id: &str,
        submission_id: &str,
        form_title: &str,
        matter_id: &str,
        submitter: &str,
        content_hash: &str,
        json: &str,
        needs_assignment: bool,
        assignment_reason: &str,
    ) -> Result<bool> {
        let c = self.conn.lock().unwrap();
        let existing: Option<String> = c
            .query_row(
                "SELECT content_hash FROM jotform_submissions WHERE source_id = ?1 AND deleted = 0",
                [source_id],
                |r| r.get(0),
            )
            .optional()?;
        c.execute(
            "INSERT INTO jotform_submissions
                (source_id, form_id, submission_id, form_title, matter_id, submitter,
                 content_hash, json, fetched_at, needs_assignment, assignment_reason, deleted)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, 0)
             ON CONFLICT(source_id) DO UPDATE SET
                form_id = ?2,
                submission_id = ?3,
                form_title = ?4,
                matter_id = ?5,
                submitter = ?6,
                content_hash = ?7,
                json = ?8,
                fetched_at = ?9,
                indexed_hash = CASE WHEN content_hash = ?7 AND matter_id = ?5 THEN indexed_hash ELSE '' END,
                needs_assignment = ?10,
                assignment_reason = ?11,
                deleted = 0",
            rusqlite::params![
                source_id,
                form_id,
                submission_id,
                form_title,
                matter_id,
                submitter,
                content_hash,
                json,
                chrono::Utc::now().to_rfc3339(),
                needs_assignment as i64,
                assignment_reason,
            ],
        )?;
        Ok(existing.as_deref() != Some(content_hash))
    }

    pub fn list_submissions_to_index(&self) -> Result<Vec<JotformSubmissionRow>> {
        let c = self.conn.lock().unwrap();
        let mut stmt = c.prepare(
            "SELECT source_id, form_id, submission_id, form_title, matter_id,
                    content_hash, json, indexed_hash, deleted
             FROM jotform_submissions
             WHERE deleted = 0 AND indexed_hash != content_hash
             ORDER BY fetched_at ASC, form_id, submission_id",
        )?;
        let rows = stmt
            .query_map([], row_to_submission)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    }

    pub fn mark_indexed(&self, source_id: &str, content_hash: &str, matter_id: &str) -> Result<()> {
        let c = self.conn.lock().unwrap();
        c.execute(
            "UPDATE jotform_submissions
             SET indexed_hash = ?2, indexed_at = ?3, matter_id = ?4
             WHERE source_id = ?1",
            rusqlite::params![source_id, content_hash, chrono::Utc::now().to_rfc3339(), matter_id],
        )?;
        Ok(())
    }

    pub fn list_source_ids(&self) -> Result<Vec<String>> {
        let c = self.conn.lock().unwrap();
        let mut stmt = c.prepare("SELECT source_id FROM jotform_submissions")?;
        let rows = stmt
            .query_map([], |r| r.get::<_, String>(0))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    }

    /// Source ids of submissions that are still active (not soft-deleted). Used to
    /// find submissions that have vanished from Jotform so they can be pruned.
    pub fn list_active_source_ids(&self) -> Result<Vec<String>> {
        let c = self.conn.lock().unwrap();
        let mut stmt =
            c.prepare("SELECT source_id FROM jotform_submissions WHERE deleted = 0")?;
        let rows = stmt
            .query_map([], |r| r.get::<_, String>(0))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    }

    /// Soft-delete a submission row (its RAG chunks are removed separately by the
    /// caller). Idempotent.
    pub fn mark_deleted(&self, source_id: &str) -> Result<()> {
        let c = self.conn.lock().unwrap();
        c.execute(
            "UPDATE jotform_submissions SET deleted = 1 WHERE source_id = ?1",
            [source_id],
        )?;
        Ok(())
    }

    pub fn list_unassigned(&self) -> Result<Vec<JotformUnassignedRow>> {
        let c = self.conn.lock().unwrap();
        let mut stmt = c.prepare(
            "SELECT source_id, form_id, submission_id, submitter, assignment_reason
             FROM jotform_submissions
             WHERE deleted = 0 AND needs_assignment = 1
             ORDER BY fetched_at DESC, form_id, submission_id",
        )?;
        let rows = stmt
            .query_map([], |r| {
                Ok(JotformUnassignedRow {
                    source_id: r.get(0)?,
                    form_id: r.get(1)?,
                    submission_id: r.get(2)?,
                    submitter: r.get(3)?,
                    reason: r.get(4)?,
                })
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    }

    pub fn set_cursor(&self, key: &str, cursor: &str) -> Result<()> {
        let c = self.conn.lock().unwrap();
        c.execute(
            "INSERT INTO jotform_cursors (key, cursor) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET cursor = ?2",
            rusqlite::params![key, cursor],
        )?;
        Ok(())
    }

    #[allow(dead_code)]
    pub fn get_cursor(&self, key: &str) -> Result<Option<String>> {
        let c = self.conn.lock().unwrap();
        c.query_row(
            "SELECT cursor FROM jotform_cursors WHERE key = ?1",
            [key],
            |r| r.get(0),
        )
        .optional()
        .map_err(Into::into)
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
            match std::fs::remove_file(&path) {
                Ok(()) => {}
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                Err(e) => return Err(e.into()),
            }
        }
        Ok(())
    }

    pub fn delete_master_key() -> Result<()> {
        match keyring::Entry::new(JOTFORM_DB_KEYCHAIN_SERVICE, JOTFORM_DB_KEYCHAIN_KEY)
            .context("jotform db keychain entry")?
            .delete_credential()
        {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(e.into()),
        }
    }
}

fn row_to_submission(row: &rusqlite::Row<'_>) -> rusqlite::Result<JotformSubmissionRow> {
    let deleted: i64 = row.get(8)?;
    Ok(JotformSubmissionRow {
        source_id: row.get(0)?,
        form_id: row.get(1)?,
        submission_id: row.get(2)?,
        form_title: row.get(3)?,
        matter_id: row.get(4)?,
        content_hash: row.get(5)?,
        json: row.get(6)?,
        indexed_hash: row.get(7)?,
        deleted: deleted != 0,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn store() -> (TempDir, JotformStore) {
        let dir = TempDir::new().unwrap();
        let store = JotformStore::open_with_key(dir.path(), &[0x4a; 32]).unwrap();
        (dir, store)
    }

    #[test]
    fn unchanged_hash_reports_not_changed() {
        let (_dir, store) = store();
        assert!(store
            .upsert_submission(
                "jotform:f1:s1",
                "f1",
                "s1",
                "Intake",
                "matter-a",
                "Avery Stone",
                "hash-1",
                "{}",
                false,
                "",
            )
            .unwrap());
        store
            .mark_indexed("jotform:f1:s1", "hash-1", "matter-a")
            .unwrap();
        assert!(!store
            .upsert_submission(
                "jotform:f1:s1",
                "f1",
                "s1",
                "Intake",
                "matter-a",
                "Avery Stone",
                "hash-1",
                "{}",
                false,
                "",
            )
            .unwrap());
        assert!(store.list_submissions_to_index().unwrap().is_empty());
    }

    #[test]
    fn unassigned_list_round_trips_reason() {
        let (_dir, store) = store();
        store
            .upsert_submission(
                "jotform:f1:s1",
                "f1",
                "s1",
                "Intake",
                "unassigned",
                "No Match",
                "hash-1",
                "{}",
                true,
                "no matter matched submitter name or email",
            )
            .unwrap();
        let rows = store.list_unassigned().unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].source_id, "jotform:f1:s1");
        assert_eq!(rows[0].reason, "no matter matched submitter name or email");
    }
}
