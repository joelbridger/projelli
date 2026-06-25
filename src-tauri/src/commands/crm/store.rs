// Durable encrypted SQLCipher store for normalised Wealthbox CRM objects.
//
// Holds the local canonical copy that makes deletions, re-rendering, and
// resumable sync correct.  Mirrors `EncryptedMailStore` exactly in structure:
//
//   crm-enc.db        — SQLCipher, key from "keepance-crm-enc" keychain service
//     crm_objects     — raw JSON rows for every synced Wealthbox object
//     crm_cursors     — per-object-type delta high-water cursors
//     crm_render_state — fetched-vs-indexed state per household
//     meta            — key/value flags (general purpose)
//
// The `json` column stores the raw Wealthbox response as-is.  Typed parsing
// comes in a later phase; the store is intentionally generic over object kind.

use anyhow::{Context, Result};
use rusqlite::Connection;
use std::path::{Path, PathBuf};

// ---------------------------------------------------------------------------
// Key management — dedicated keychain entry (NOT shared with mail or vectors)
// ---------------------------------------------------------------------------

const CRM_KEYCHAIN_SERVICE: &str = "keepance-crm-enc";
const CRM_KEYCHAIN_KEY: &str = "master-key-v1";
const KEY_LEN: usize = 32;

/// Get (or generate + store) the 32-byte CRM master key from the OS keychain.
/// Mirrors `mail::crypto::get_or_create_master_key` exactly — same algorithm,
/// separate keychain entry so this DB has its own independent key.
fn crm_master_key() -> Result<[u8; KEY_LEN]> {
    let entry = keyring::Entry::new(CRM_KEYCHAIN_SERVICE, CRM_KEYCHAIN_KEY)
        .context("crm keychain entry")?;
    match entry.get_password() {
        Ok(hex) => {
            let bytes = hex::decode(hex.trim()).context("decode crm master key hex")?;
            if bytes.len() != KEY_LEN {
                anyhow::bail!("stored crm master key has wrong length: {}", bytes.len());
            }
            let mut k = [0u8; KEY_LEN];
            k.copy_from_slice(&bytes);
            Ok(k)
        }
        Err(keyring::Error::NoEntry) => {
            let mut k = [0u8; KEY_LEN];
            rand::RngCore::fill_bytes(&mut rand::thread_rng(), &mut k);
            let hex = hex::encode(k);
            entry.set_password(&hex).context("store crm master key")?;
            Ok(k)
        }
        Err(e) => Err(anyhow::anyhow!("crm keychain read: {e}")),
    }
}

// ---------------------------------------------------------------------------
// Data model
// ---------------------------------------------------------------------------

/// One row from `crm_objects`.  `id` is namespaced, e.g. `contact:123`,
/// `household:789`, `note:456`.  `json` is the raw Wealthbox API response.
#[derive(Debug, Clone)]
pub struct CrmObjectRow {
    pub id: String,
    pub kind: String,
    pub household_id: String,
    pub updated_at: String,
    pub content_hash: String,
    pub json: String,
    pub deleted: bool,
}

// ---------------------------------------------------------------------------
// CrmStore
// ---------------------------------------------------------------------------

pub struct CrmStore {
    conn: std::sync::Mutex<Connection>,
    #[allow(dead_code)]
    workspace_root: PathBuf,
}

impl CrmStore {
    /// Canonical path for the encrypted CRM DB inside a workspace.
    pub fn db_path(workspace_root: &Path) -> PathBuf {
        workspace_root.join(".keepance").join("crm-enc.db")
    }

    /// Open (or create) the SQLCipher database keyed with `key`.
    /// PRAGMA key MUST be the very first statement on the connection.
    pub fn open_with_key(workspace_root: &Path, key: &[u8; KEY_LEN]) -> Result<Self> {
        let p = Self::db_path(workspace_root);
        if let Some(parent) = p.parent() {
            std::fs::create_dir_all(parent).ok();
        }
        let conn = Connection::open(&p)
            .with_context(|| format!("open crm enc db {}", p.display()))?;

        // SQLCipher: key must be set before any DDL.
        // Raw-hex form bypasses passphrase KDF overhead.
        let hex_key = hex::encode(key);
        conn.execute_batch(&format!("PRAGMA key = \"x'{}'\";" , hex_key))?;

        // Two concurrent writers (sync loop + indexer) need a wait instead of
        // an immediate "database is locked" failure.
        conn.busy_timeout(std::time::Duration::from_secs(5))?;

        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS crm_objects (
                id            TEXT PRIMARY KEY,
                kind          TEXT NOT NULL,
                household_id  TEXT NOT NULL DEFAULT '',
                updated_at    TEXT NOT NULL DEFAULT '',
                content_hash  TEXT NOT NULL DEFAULT '',
                json          TEXT NOT NULL DEFAULT '',
                deleted       INTEGER NOT NULL DEFAULT 0
            );
             CREATE INDEX IF NOT EXISTS idx_crm_objects_household
                ON crm_objects(household_id);
             CREATE INDEX IF NOT EXISTS idx_crm_objects_kind
                ON crm_objects(kind);
             CREATE TABLE IF NOT EXISTS crm_cursors (
                object_type  TEXT PRIMARY KEY,
                cursor       TEXT NOT NULL
             );
             CREATE TABLE IF NOT EXISTS crm_render_state (
                household_id  TEXT PRIMARY KEY,
                render_hash   TEXT NOT NULL DEFAULT '',
                indexed       INTEGER NOT NULL DEFAULT 0
             );
             CREATE TABLE IF NOT EXISTS meta (
                key    TEXT PRIMARY KEY,
                value  TEXT NOT NULL
             );",
        )?;
        migrate_crm_columns(&conn);
        Ok(Self {
            conn: std::sync::Mutex::new(conn),
            workspace_root: workspace_root.to_path_buf(),
        })
    }

    /// Open with the master key from the OS keychain.
    pub fn open(workspace_root: &Path) -> Result<Self> {
        let key = crm_master_key()?;
        Self::open_with_key(workspace_root, &key)
    }

    // -----------------------------------------------------------------------
    // crm_objects helpers
    // -----------------------------------------------------------------------

    /// Insert or update a CRM object row.  On conflict, all columns are
    /// overwritten and `deleted` is reset to 0 (a re-synced object is live).
    #[allow(dead_code)]
    pub fn upsert_object(
        &self,
        id: &str,
        kind: &str,
        household_id: &str,
        updated_at: &str,
        content_hash: &str,
        json: &str,
    ) -> Result<()> {
        let c = self.conn.lock().unwrap();
        c.execute(
            "INSERT INTO crm_objects
                (id, kind, household_id, updated_at, content_hash, json, deleted)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0)
             ON CONFLICT(id) DO UPDATE SET
                kind         = ?2,
                household_id = ?3,
                updated_at   = ?4,
                content_hash = ?5,
                json         = ?6,
                deleted      = 0",
            rusqlite::params![id, kind, household_id, updated_at, content_hash, json],
        )?;
        Ok(())
    }

    /// Fetch one object by id, regardless of deleted flag.
    #[allow(dead_code)]
    pub fn get_object(&self, id: &str) -> Result<Option<CrmObjectRow>> {
        let c = self.conn.lock().unwrap();
        Ok(c.query_row(
            "SELECT id, kind, household_id, updated_at, content_hash, json, deleted
             FROM crm_objects WHERE id = ?1",
            [id],
            row_to_crm_object,
        )
        .ok())
    }

    /// Return all non-deleted objects for a given household.
    #[allow(dead_code)]
    pub fn list_objects_by_household(&self, household_id: &str) -> Result<Vec<CrmObjectRow>> {
        let c = self.conn.lock().unwrap();
        let mut stmt = c.prepare(
            "SELECT id, kind, household_id, updated_at, content_hash, json, deleted
             FROM crm_objects
             WHERE household_id = ?1 AND deleted = 0",
        )?;
        let rows = stmt
            .query_map([household_id], row_to_crm_object)?
            .collect::<rusqlite::Result<Vec<CrmObjectRow>>>()?;
        Ok(rows)
    }

    /// Return all non-deleted object ids for a given kind.
    /// Used for snapshot-diff deletion detection: anything in the previous
    /// snapshot but absent from the new API response should be tombstoned.
    #[allow(dead_code)]
    pub fn list_object_ids(&self, kind: &str) -> Result<Vec<String>> {
        let c = self.conn.lock().unwrap();
        let mut stmt = c.prepare(
            "SELECT id FROM crm_objects WHERE kind = ?1 AND deleted = 0",
        )?;
        let rows = stmt
            .query_map([kind], |r| r.get::<_, String>(0))?
            .collect::<rusqlite::Result<Vec<String>>>()?;
        Ok(rows)
    }

    /// Soft-delete an object (sets `deleted = 1`).
    #[allow(dead_code)]
    pub fn tombstone_object(&self, id: &str) -> Result<()> {
        let c = self.conn.lock().unwrap();
        c.execute(
            "UPDATE crm_objects SET deleted = 1 WHERE id = ?1",
            [id],
        )?;
        Ok(())
    }

    /// Return distinct non-empty household ids that have at least one
    /// non-deleted object.  Used by the render/index loop.
    #[allow(dead_code)]
    pub fn list_household_ids(&self) -> Result<Vec<String>> {
        let c = self.conn.lock().unwrap();
        let mut stmt = c.prepare(
            "SELECT DISTINCT household_id FROM crm_objects
             WHERE household_id != '' AND deleted = 0",
        )?;
        let rows = stmt
            .query_map([], |r| r.get::<_, String>(0))?
            .collect::<rusqlite::Result<Vec<String>>>()?;
        Ok(rows)
    }

    // -----------------------------------------------------------------------
    // crm_cursors helpers
    // -----------------------------------------------------------------------

    /// Persist a per-object-type delta cursor (upserts on conflict).
    #[allow(dead_code)]
    pub fn set_cursor(&self, object_type: &str, cursor: &str) -> Result<()> {
        let c = self.conn.lock().unwrap();
        c.execute(
            "INSERT INTO crm_cursors (object_type, cursor) VALUES (?1, ?2)
             ON CONFLICT(object_type) DO UPDATE SET cursor = ?2",
            rusqlite::params![object_type, cursor],
        )?;
        Ok(())
    }

    /// Retrieve a per-object-type cursor, or `None` if not yet set.
    #[allow(dead_code)]
    pub fn get_cursor(&self, object_type: &str) -> Result<Option<String>> {
        let c = self.conn.lock().unwrap();
        Ok(c.query_row(
            "SELECT cursor FROM crm_cursors WHERE object_type = ?1",
            [object_type],
            |r| r.get(0),
        )
        .ok())
    }

    // -----------------------------------------------------------------------
    // crm_render_state helpers
    // -----------------------------------------------------------------------

    /// Upsert the render/index state for a household.
    #[allow(dead_code)]
    pub fn set_render_state(
        &self,
        household_id: &str,
        render_hash: &str,
        indexed: bool,
    ) -> Result<()> {
        let c = self.conn.lock().unwrap();
        c.execute(
            "INSERT INTO crm_render_state (household_id, render_hash, indexed)
             VALUES (?1, ?2, ?3)
             ON CONFLICT(household_id) DO UPDATE SET
                render_hash = ?2,
                indexed     = ?3",
            rusqlite::params![household_id, render_hash, indexed as i64],
        )?;
        Ok(())
    }

    /// Retrieve the render/index state for a household, or `None` if absent.
    #[allow(dead_code)]
    pub fn get_render_state(
        &self,
        household_id: &str,
    ) -> Result<Option<(String, bool)>> {
        let c = self.conn.lock().unwrap();
        Ok(c.query_row(
            "SELECT render_hash, indexed FROM crm_render_state
             WHERE household_id = ?1",
            [household_id],
            |r| {
                let hash: String = r.get(0)?;
                let indexed_int: i64 = r.get(1)?;
                Ok((hash, indexed_int != 0))
            },
        )
        .ok())
    }

    // -----------------------------------------------------------------------
    // meta helpers (mirrors EncryptedMailStore)
    // -----------------------------------------------------------------------

    /// Read one meta value, or `None` if the key is not set.
    #[allow(dead_code)]
    pub fn get_meta(&self, key: &str) -> Result<Option<String>> {
        use rusqlite::OptionalExtension;
        let c = self.conn.lock().unwrap();
        Ok(c.query_row("SELECT value FROM meta WHERE key = ?1", [key], |r| {
            r.get(0)
        })
        .optional()?)
    }

    /// Set (upsert) one meta value.  Idempotent; last-writer-wins.
    #[allow(dead_code)]
    pub fn set_meta(&self, key: &str, value: &str) -> Result<()> {
        let c = self.conn.lock().unwrap();
        c.execute(
            "INSERT INTO meta (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = ?2",
            rusqlite::params![key, value],
        )?;
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/// Map a `crm_objects` row to a `CrmObjectRow`.
fn row_to_crm_object(r: &rusqlite::Row<'_>) -> rusqlite::Result<CrmObjectRow> {
    let deleted_int: i64 = r.get(6)?;
    Ok(CrmObjectRow {
        id: r.get(0)?,
        kind: r.get(1)?,
        household_id: r.get(2)?,
        updated_at: r.get(3)?,
        content_hash: r.get(4)?,
        json: r.get(5)?,
        deleted: deleted_int != 0,
    })
}

/// Idempotent schema migration: add new columns with `ALTER TABLE ADD COLUMN`.
/// SQLite errors when a column already exists so we swallow each error — the
/// same pattern used by `migrate_message_columns` in the mail store.
fn migrate_crm_columns(conn: &Connection) {
    // Placeholder for future column additions; pattern mirrors mail store.
    // Each new column gets one `let _ = conn.execute(...)` line here.
    let _ = conn.execute(
        "ALTER TABLE crm_objects ADD COLUMN kind TEXT NOT NULL DEFAULT ''",
        [],
    );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    /// Open a CrmStore with a deterministic test key — bypasses the OS keychain.
    fn crm_store() -> (TempDir, CrmStore) {
        let dir = TempDir::new().unwrap();
        let key = [0x33u8; 32];
        let s = CrmStore::open_with_key(dir.path(), &key).expect("crm store open");
        (dir, s)
    }

    // -----------------------------------------------------------------------
    // Object upsert + list
    // -----------------------------------------------------------------------

    #[test]
    fn upsert_and_get_and_list_by_household() {
        let (_d, s) = crm_store();

        // Insert a household object and a contact belonging to it.
        s.upsert_object(
            "household:1",
            "household",
            "1",
            "2026-06-01T00:00:00Z",
            "hash-h1",
            r#"{"id":1,"name":"Smith Family"}"#,
        )
        .unwrap();
        s.upsert_object(
            "contact:10",
            "contact",
            "1",
            "2026-06-01T00:00:00Z",
            "hash-c10",
            r#"{"id":10,"first_name":"Alice"}"#,
        )
        .unwrap();

        // get_object round-trips fields.
        let row = s.get_object("household:1").unwrap().expect("household row");
        assert_eq!(row.id, "household:1");
        assert_eq!(row.kind, "household");
        assert_eq!(row.household_id, "1");
        assert_eq!(row.content_hash, "hash-h1");
        assert_eq!(row.json, r#"{"id":1,"name":"Smith Family"}"#);
        assert!(!row.deleted);

        let row2 = s.get_object("contact:10").unwrap().expect("contact row");
        assert_eq!(row2.kind, "contact");
        assert_eq!(row2.household_id, "1");

        // list_objects_by_household returns both, none deleted.
        let list = s.list_objects_by_household("1").unwrap();
        assert_eq!(list.len(), 2);

        // list_household_ids returns the single household id.
        let hids = s.list_household_ids().unwrap();
        assert_eq!(hids, vec!["1".to_string()]);
    }

    // -----------------------------------------------------------------------
    // Upsert overwrites
    // -----------------------------------------------------------------------

    #[test]
    fn upsert_same_id_twice_returns_latest_json() {
        let (_d, s) = crm_store();

        s.upsert_object(
            "contact:10",
            "contact",
            "1",
            "2026-06-01T00:00:00Z",
            "hash-v1",
            r#"{"id":10,"note":"first"}"#,
        )
        .unwrap();
        s.upsert_object(
            "contact:10",
            "contact",
            "1",
            "2026-06-02T00:00:00Z",
            "hash-v2",
            r#"{"id":10,"note":"second"}"#,
        )
        .unwrap();

        let row = s.get_object("contact:10").unwrap().expect("row");
        assert_eq!(row.json, r#"{"id":10,"note":"second"}"#);
        assert_eq!(row.content_hash, "hash-v2");
        assert_eq!(row.updated_at, "2026-06-02T00:00:00Z");
    }

    // -----------------------------------------------------------------------
    // Tombstone
    // -----------------------------------------------------------------------

    #[test]
    fn tombstone_hides_object_from_list_and_list_ids() {
        let (_d, s) = crm_store();

        s.upsert_object(
            "contact:10",
            "contact",
            "1",
            "2026-06-01T00:00:00Z",
            "hash-c10",
            r#"{"id":10}"#,
        )
        .unwrap();

        // Before tombstone: visible in both list paths.
        assert_eq!(s.list_objects_by_household("1").unwrap().len(), 1);
        assert_eq!(s.list_object_ids("contact").unwrap().len(), 1);

        s.tombstone_object("contact:10").unwrap();

        // After tombstone: absent from both list paths.
        assert!(s.list_objects_by_household("1").unwrap().is_empty());
        assert!(s.list_object_ids("contact").unwrap().is_empty());

        // get_object still finds it (deleted flag = true).
        let row = s.get_object("contact:10").unwrap().expect("still findable");
        assert!(row.deleted);
    }

    // -----------------------------------------------------------------------
    // Cursor round-trip
    // -----------------------------------------------------------------------

    #[test]
    fn cursor_roundtrip() {
        let (_d, s) = crm_store();

        assert_eq!(s.get_cursor("contacts").unwrap(), None);
        s.set_cursor("contacts", "2026-06-01T00:00:00Z").unwrap();
        assert_eq!(
            s.get_cursor("contacts").unwrap().as_deref(),
            Some("2026-06-01T00:00:00Z")
        );

        // Two types are independent.
        s.set_cursor("households", "2026-06-02T00:00:00Z").unwrap();
        assert_eq!(
            s.get_cursor("contacts").unwrap().as_deref(),
            Some("2026-06-01T00:00:00Z")
        );
        assert_eq!(
            s.get_cursor("households").unwrap().as_deref(),
            Some("2026-06-02T00:00:00Z")
        );
    }

    // -----------------------------------------------------------------------
    // Render-state round-trip
    // -----------------------------------------------------------------------

    #[test]
    fn render_state_roundtrip() {
        let (_d, s) = crm_store();

        assert_eq!(s.get_render_state("1").unwrap(), None);
        s.set_render_state("1", "abc", true).unwrap();
        assert_eq!(
            s.get_render_state("1").unwrap(),
            Some(("abc".to_string(), true))
        );

        // Overwrite.
        s.set_render_state("1", "def", false).unwrap();
        assert_eq!(
            s.get_render_state("1").unwrap(),
            Some(("def".to_string(), false))
        );
    }

    // -----------------------------------------------------------------------
    // Meta round-trip
    // -----------------------------------------------------------------------

    #[test]
    fn meta_roundtrip() {
        let (_d, s) = crm_store();

        assert_eq!(s.get_meta("sync_state").unwrap(), None);
        s.set_meta("sync_state", "idle").unwrap();
        assert_eq!(
            s.get_meta("sync_state").unwrap().as_deref(),
            Some("idle")
        );
        // Last-writer-wins.
        s.set_meta("sync_state", "running").unwrap();
        assert_eq!(
            s.get_meta("sync_state").unwrap().as_deref(),
            Some("running")
        );
    }

    // -----------------------------------------------------------------------
    // Encryption sanity: reading without the key must fail
    // -----------------------------------------------------------------------

    #[test]
    fn raw_connection_without_key_cannot_read() {
        let dir = TempDir::new().unwrap();
        let key = [0x33u8; 32];

        // Write some data.
        {
            let s = CrmStore::open_with_key(dir.path(), &key).unwrap();
            s.upsert_object(
                "household:1",
                "household",
                "1",
                "2026-06-01T00:00:00Z",
                "hash",
                r#"{"id":1}"#,
            )
            .unwrap();
        }

        // Open the same file without supplying the SQLCipher key.
        let db_path = CrmStore::db_path(dir.path());
        let raw = Connection::open(&db_path).expect("open file");
        // A SELECT without a key should fail (file is encrypted).
        let result =
            raw.query_row("SELECT count(*) FROM crm_objects", [], |r| r.get::<_, i64>(0));
        assert!(
            result.is_err(),
            "plain rusqlite connection must not be able to read SQLCipher DB"
        );
    }
}
