// SQLite-backed metadata store for the M365 mail-import feature.
//
// Tracks:
//   - messages   : id (Graph message id) → folder_id, internet_message_id,
//                  relative on-disk path, received timestamp
//   - folder_cursors : folder_id → MS Graph delta-link cursor
//
// The `MailStore` trait is the public seam.  SqliteMailStore is the Phase 1
// implementation.  A future encrypted store (e.g. using SQLCipher) can
// implement the same trait and drop in without touching the sync engine.

use anyhow::{Context, Result};
use rusqlite::Connection;
use std::path::{Path, PathBuf};

// ---------------------------------------------------------------------------
// Data model
// ---------------------------------------------------------------------------

#[derive(Debug, Clone)]
pub struct MailRecord {
    pub id: String,
    pub folder_id: String,
    pub internet_message_id: Option<String>,
    pub relative_path: String,
    pub received_date_time: Option<String>,
}

// ---------------------------------------------------------------------------
// Trait — storage seam
// ---------------------------------------------------------------------------

/// Storage abstraction for imported mail metadata.
///
/// `SqliteMailStore` is the Phase 1 implementation.  An encrypted store can
/// implement this trait later so the sync engine stays storage-agnostic.
pub trait MailStore: Send + Sync {
    /// Insert or update a record keyed by `rec.id`.  Idempotent.
    fn upsert(&self, rec: &MailRecord) -> Result<()>;
    /// Remove a record by id.  Returns the `relative_path` if the record
    /// existed, or `None` if it was already absent.
    fn tombstone(&self, id: &str) -> Result<Option<String>>;
    /// Returns true if a record with this id is present.
    fn contains(&self, id: &str) -> Result<bool>;
    /// Total number of tracked messages (useful for tests + diagnostics).
    fn count(&self) -> Result<i64>;
    /// Retrieve the per-folder MS Graph delta-link cursor, or `None` if not yet set.
    fn get_cursor(&self, folder_id: &str) -> Result<Option<String>>;
    /// Persist a per-folder cursor (upserts on conflict).
    fn set_cursor(&self, folder_id: &str, cursor: &str) -> Result<()>;
}

// ---------------------------------------------------------------------------
// SQLite implementation
// ---------------------------------------------------------------------------

pub struct SqliteMailStore {
    conn: std::sync::Mutex<Connection>,
}

impl SqliteMailStore {
    /// Canonical path for the mail DB inside a workspace.
    pub fn db_path(workspace_root: &Path) -> PathBuf {
        workspace_root.join(".keepance").join("mail.db")
    }

    /// Open (or create) the database at `<workspace_root>/.keepance/mail.db`.
    /// Creates all required tables if they don't exist.
    pub fn open(workspace_root: &Path) -> Result<Self> {
        let p = Self::db_path(workspace_root);
        if let Some(parent) = p.parent() {
            std::fs::create_dir_all(parent).ok();
        }
        let conn =
            Connection::open(&p).with_context(|| format!("open {}", p.display()))?;
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS messages (
                id                   TEXT PRIMARY KEY,
                folder_id            TEXT NOT NULL,
                internet_message_id  TEXT,
                relative_path        TEXT NOT NULL,
                received_date_time   TEXT
            );
             CREATE TABLE IF NOT EXISTS folder_cursors (
                folder_id  TEXT PRIMARY KEY,
                cursor     TEXT NOT NULL
            );",
        )?;
        Ok(Self {
            conn: std::sync::Mutex::new(conn),
        })
    }
}

impl MailStore for SqliteMailStore {
    fn upsert(&self, rec: &MailRecord) -> Result<()> {
        let c = self.conn.lock().unwrap();
        c.execute(
            "INSERT INTO messages
                (id, folder_id, internet_message_id, relative_path, received_date_time)
             VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(id) DO UPDATE SET
                folder_id           = ?2,
                internet_message_id = ?3,
                relative_path       = ?4,
                received_date_time  = ?5",
            rusqlite::params![
                rec.id,
                rec.folder_id,
                rec.internet_message_id,
                rec.relative_path,
                rec.received_date_time
            ],
        )?;
        Ok(())
    }

    fn tombstone(&self, id: &str) -> Result<Option<String>> {
        let c = self.conn.lock().unwrap();
        let path: Option<String> = c
            .query_row(
                "SELECT relative_path FROM messages WHERE id = ?1",
                [id],
                |r| r.get(0),
            )
            .ok();
        if path.is_some() {
            c.execute("DELETE FROM messages WHERE id = ?1", [id])?;
        }
        Ok(path)
    }

    fn contains(&self, id: &str) -> Result<bool> {
        let c = self.conn.lock().unwrap();
        Ok(c.query_row(
            "SELECT 1 FROM messages WHERE id = ?1",
            [id],
            |_| Ok(()),
        )
        .is_ok())
    }

    fn count(&self) -> Result<i64> {
        let c = self.conn.lock().unwrap();
        Ok(c.query_row("SELECT COUNT(*) FROM messages", [], |r| r.get(0))?)
    }

    fn get_cursor(&self, folder_id: &str) -> Result<Option<String>> {
        let c = self.conn.lock().unwrap();
        Ok(c.query_row(
            "SELECT cursor FROM folder_cursors WHERE folder_id = ?1",
            [folder_id],
            |r| r.get(0),
        )
        .ok())
    }

    fn set_cursor(&self, folder_id: &str, cursor: &str) -> Result<()> {
        let c = self.conn.lock().unwrap();
        c.execute(
            "INSERT INTO folder_cursors (folder_id, cursor)
             VALUES (?1, ?2)
             ON CONFLICT(folder_id) DO UPDATE SET cursor = ?2",
            rusqlite::params![folder_id, cursor],
        )?;
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn store() -> (TempDir, SqliteMailStore) {
        let dir = TempDir::new().unwrap();
        let s = SqliteMailStore::open(dir.path()).expect("open");
        (dir, s)
    }

    #[test]
    fn upsert_is_idempotent_by_id() {
        let (_d, s) = store();
        let rec = MailRecord {
            id: "m1".into(),
            folder_id: "inbox".into(),
            internet_message_id: Some("<x@y>".into()),
            relative_path: "Mail/inbox/m1.md".into(),
            received_date_time: Some("2026-05-01T00:00:00Z".into()),
        };
        s.upsert(&rec).unwrap();
        s.upsert(&rec).unwrap(); // replay must not duplicate
        assert_eq!(s.count().unwrap(), 1);
        assert!(s.contains("m1").unwrap());
    }

    #[test]
    fn tombstone_removes_record_and_reports_path() {
        let (_d, s) = store();
        let rec = MailRecord {
            id: "m1".into(),
            folder_id: "inbox".into(),
            internet_message_id: None,
            relative_path: "Mail/inbox/m1.md".into(),
            received_date_time: None,
        };
        s.upsert(&rec).unwrap();
        let removed = s.tombstone("m1").unwrap();
        assert_eq!(removed.as_deref(), Some("Mail/inbox/m1.md"));
        assert_eq!(s.count().unwrap(), 0);
        assert_eq!(s.tombstone("m1").unwrap(), None); // already gone
    }

    #[test]
    fn cursor_roundtrips_per_folder() {
        let (_d, s) = store();
        assert_eq!(s.get_cursor("inbox").unwrap(), None);
        s.set_cursor("inbox", "https://graph/delta?$deltatoken=abc")
            .unwrap();
        s.set_cursor("sent", "https://graph/delta?$deltatoken=def")
            .unwrap();
        assert_eq!(
            s.get_cursor("inbox").unwrap().as_deref(),
            Some("https://graph/delta?$deltatoken=abc")
        );
        assert_eq!(
            s.get_cursor("sent").unwrap().as_deref(),
            Some("https://graph/delta?$deltatoken=def")
        );
    }
}
