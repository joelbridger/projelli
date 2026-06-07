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
// EncryptedMailStore — SQLCipher metadata + encrypted blob helpers (Group G2)
// ---------------------------------------------------------------------------

use crate::commands::mail::crypto::{decrypt_with_key, encrypt_with_key};

pub struct EncryptedMailStore {
    conn: std::sync::Mutex<Connection>,
    workspace_root: PathBuf,
}

/// Sanitize an arbitrary message id into a filesystem-safe filename component.
/// Only alphanumerics and hyphens are preserved; anything else becomes '_'.
/// This prevents path-traversal attacks (e.g. ids containing '/' or '..').
fn safe_id(id: &str) -> String {
    id.chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '-' { c } else { '_' })
        .collect()
}

impl EncryptedMailStore {
    /// Canonical path for the encrypted mail DB.
    pub fn db_path(workspace_root: &Path) -> PathBuf {
        workspace_root.join(".keepance").join("mail-enc.db")
    }

    /// Open (or create) the SQLCipher database keyed with `key`.
    /// The `PRAGMA key` must be the very first statement on the connection.
    pub fn open_with_key(workspace_root: &Path, key: &[u8; 32]) -> Result<Self> {
        let p = Self::db_path(workspace_root);
        if let Some(parent) = p.parent() {
            std::fs::create_dir_all(parent).ok();
        }
        let conn = Connection::open(&p)
            .with_context(|| format!("open enc db {}", p.display()))?;

        // SQLCipher requires the key to be set before any DDL.
        // Use hex-encoded raw key via `PRAGMA key = "x'<hex>'"` — the raw-hex
        // form that SQLCipher accepts, bypassing passphrase KDF overhead.
        let hex_key = hex::encode(key);
        conn.execute_batch(&format!("PRAGMA key = \"x'{}'\";", hex_key))?;

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
            workspace_root: workspace_root.to_path_buf(),
        })
    }

    /// Open with the master key from the OS keychain.
    pub fn open(workspace_root: &Path) -> Result<Self> {
        let key = crate::commands::mail::crypto::get_or_create_master_key()?;
        Self::open_with_key(workspace_root, &key)
    }

    /// Encrypt `plaintext` and write to `.keepance/mail/blobs/<safe-id>.enc`
    /// (relative to `workspace_root`). Returns the relative path.
    pub fn write_blob_with_key(
        &self,
        id: &str,
        plaintext: &[u8],
        key: &[u8; 32],
    ) -> Result<String> {
        let blob_dir = self.workspace_root.join(".keepance").join("mail").join("blobs");
        std::fs::create_dir_all(&blob_dir).context("create blobs dir")?;
        let filename = format!("{}.enc", safe_id(id));
        let abs = blob_dir.join(&filename);
        let encrypted = encrypt_with_key(plaintext, key)?;
        std::fs::write(&abs, &encrypted)
            .with_context(|| format!("write blob {}", abs.display()))?;
        Ok(format!(".keepance/mail/blobs/{}", filename))
    }

    /// Decrypt and return the contents of an encrypted blob at `rel`
    /// (relative to `root`).
    pub fn read_blob_with_key(
        &self,
        rel: &str,
        root: &Path,
        key: &[u8; 32],
    ) -> Result<Vec<u8>> {
        let abs = root.join(rel);
        let encrypted = std::fs::read(&abs)
            .with_context(|| format!("read blob {}", abs.display()))?;
        decrypt_with_key(&encrypted, key)
    }

    /// Convenience: write blob using the OS keychain master key.
    pub fn write_blob(&self, id: &str, plaintext: &[u8]) -> Result<String> {
        let key = crate::commands::mail::crypto::get_or_create_master_key()?;
        self.write_blob_with_key(id, plaintext, &key)
    }

    /// Convenience: read blob using the OS keychain master key.
    pub fn read_blob(&self, rel: &str) -> Result<Vec<u8>> {
        let key = crate::commands::mail::crypto::get_or_create_master_key()?;
        self.read_blob_with_key(rel, &self.workspace_root, &key)
    }
}

impl MailStore for EncryptedMailStore {
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
                rec.id, rec.folder_id, rec.internet_message_id,
                rec.relative_path, rec.received_date_time
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
        if let Some(ref rel) = path {
            // Delete the encrypted blob from disk before removing the DB row.
            let abs = self.workspace_root.join(rel);
            let _ = std::fs::remove_file(&abs); // best-effort; ignore if already gone
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
            "INSERT INTO folder_cursors (folder_id, cursor) VALUES (?1, ?2)
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

    // -----------------------------------------------------------------------
    // EncryptedMailStore tests (Group G2)
    // -----------------------------------------------------------------------

    fn enc_store() -> (TempDir, EncryptedMailStore) {
        let dir = TempDir::new().unwrap();
        let key = [0x42u8; 32]; // deterministic test key, bypasses keychain
        let s = EncryptedMailStore::open_with_key(dir.path(), &key).expect("enc open");
        (dir, s)
    }

    #[test]
    fn enc_upsert_is_idempotent_by_id() {
        let (_d, s) = enc_store();
        let rec = MailRecord {
            id: "m1".into(), folder_id: "inbox".into(),
            internet_message_id: Some("<x@y>".into()),
            relative_path: ".keepance/mail/blobs/m1.enc".into(),
            received_date_time: Some("2026-05-01T00:00:00Z".into()),
        };
        s.upsert(&rec).unwrap();
        s.upsert(&rec).unwrap();
        assert_eq!(s.count().unwrap(), 1);
        assert!(s.contains("m1").unwrap());
    }

    #[test]
    fn enc_tombstone_removes_record_and_deletes_blob() {
        let (dir, s) = enc_store();
        let key = [0x42u8; 32];
        // Write a real blob to disk first.
        let rel = s.write_blob_with_key("m1", b"hello world", &key).unwrap();
        let blob_abs = dir.path().join(&rel);
        assert!(blob_abs.exists(), "blob must exist after write");

        let rec = MailRecord {
            id: "m1".into(), folder_id: "inbox".into(),
            internet_message_id: None,
            relative_path: rel.clone(),
            received_date_time: None,
        };
        s.upsert(&rec).unwrap();

        let removed = s.tombstone("m1").unwrap();
        assert_eq!(removed.as_deref(), Some(rel.as_str()));
        assert_eq!(s.count().unwrap(), 0);
        // The .enc blob must be gone from disk.
        assert!(!blob_abs.exists(), "blob must be deleted by tombstone");
        // Idempotent: second tombstone returns None.
        assert_eq!(s.tombstone("m1").unwrap(), None);
    }

    #[test]
    fn enc_cursor_roundtrips_per_folder() {
        let (_d, s) = enc_store();
        assert_eq!(s.get_cursor("inbox").unwrap(), None);
        s.set_cursor("inbox", "https://graph/delta?$deltatoken=abc").unwrap();
        assert_eq!(
            s.get_cursor("inbox").unwrap().as_deref(),
            Some("https://graph/delta?$deltatoken=abc")
        );
    }

    #[test]
    fn write_blob_and_read_blob_round_trip() {
        let (dir, s) = enc_store();
        let key = [0x42u8; 32];
        let plaintext = b"Subject: Re: closing\n\nPlease confirm 10am.";
        let rel = s.write_blob_with_key("AAMk-abc", plaintext, &key).unwrap();

        // The file must exist on disk.
        let abs = dir.path().join(&rel);
        assert!(abs.exists());

        // The raw bytes on disk must NOT be the plaintext.
        let raw = std::fs::read(&abs).unwrap();
        assert!(!raw.windows(plaintext.len()).any(|w| w == plaintext),
            "plaintext must not appear in the .enc blob");

        // read_blob must decrypt to the original.
        let recovered = s.read_blob_with_key(&rel, dir.path(), &key).unwrap();
        assert_eq!(recovered, plaintext);
    }

    #[test]
    fn write_blob_path_uses_safe_id() {
        let (_d, s) = enc_store();
        let key = [0x42u8; 32];
        let rel = s.write_blob_with_key("AAMk-123/../../etc", b"x", &key).unwrap();
        // Path-traversal chars must be sanitized; blob must land under blobs/.
        assert!(rel.starts_with(".keepance/mail/blobs/"));
        assert!(!rel.contains(".."));
    }

    #[test]
    fn sqlcipher_db_not_readable_as_plain_sqlite() {
        // Verify the DB file is NOT plain SQLite — the header must not match.
        let (dir, s) = enc_store();
        // Write something to ensure the DB is non-empty.
        s.upsert(&MailRecord {
            id: "hdr-check".into(), folder_id: "f".into(),
            internet_message_id: None,
            relative_path: "x".into(),
            received_date_time: None,
        }).unwrap();
        drop(s); // close the connection so file is flushed

        let db_path = EncryptedMailStore::db_path(dir.path());
        let raw = std::fs::read(&db_path).expect("read db file");
        // Plain SQLite header starts with "SQLite format 3\0"
        let plain_header = b"SQLite format 3\x00";
        assert!(!raw.starts_with(plain_header),
            "SQLCipher DB must NOT start with the plain SQLite header");
    }

    #[test]
    fn sqlcipher_roundtrip_across_open_close() {
        // SQLCipher round-trip: open, write, reopen with SAME key, read back.
        let dir = TempDir::new().unwrap();
        let key = [0x99u8; 32];
        {
            let s = EncryptedMailStore::open_with_key(dir.path(), &key).expect("first open");
            s.upsert(&MailRecord {
                id: "persisted".into(), folder_id: "inbox".into(),
                internet_message_id: Some("<persisted@test>".into()),
                relative_path: ".keepance/mail/blobs/persisted.enc".into(),
                received_date_time: Some("2026-06-06T00:00:00Z".into()),
            }).unwrap();
        } // connection dropped / closed

        // Reopen with the same key — record must survive.
        let s2 = EncryptedMailStore::open_with_key(dir.path(), &key).expect("second open");
        assert!(s2.contains("persisted").unwrap(), "record must survive close+reopen");
        assert_eq!(s2.count().unwrap(), 1);
    }

    #[test]
    fn sqlite_mail_store_tests_still_pass_after_sqlcipher_migration() {
        // Regression: the Phase 1 SqliteMailStore must still compile and work.
        // (This test re-runs the same assertions as the Phase 1 tests to confirm
        // the dep change did not break the plain impl.)
        let (_d, s) = store(); // uses SqliteMailStore, defined above
        let rec = MailRecord {
            id: "regression-check".into(), folder_id: "f1".into(),
            internet_message_id: None,
            relative_path: "Mail/f1/r.md".into(),
            received_date_time: None,
        };
        s.upsert(&rec).unwrap();
        assert!(s.contains("regression-check").unwrap());
        assert_eq!(s.count().unwrap(), 1);
    }
}
