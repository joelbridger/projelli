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

const CRM_KEYCHAIN_SERVICE: &str = crate::identity::CRM_ENC_SERVICE;
const CRM_KEYCHAIN_KEY: &str = "master-key-v1";
const KEY_LEN: usize = 32;

/// Get (or generate + store) the 32-byte CRM master key from the OS keychain.
/// Mirrors `mail::crypto::get_or_create_master_key` exactly — same algorithm,
/// separate keychain entry so this DB has its own independent key.
fn crm_master_key() -> Result<[u8; KEY_LEN]> {
    if let Ok(hex) = std::env::var("KEEPANCE_HEADLESS_TEST_CRM_MASTER_KEY_HEX") {
        let bytes = hex::decode(hex.trim()).context("decode headless test crm master key hex")?;
        if bytes.len() != KEY_LEN {
            anyhow::bail!(
                "headless test crm master key has wrong length: {}",
                bytes.len()
            );
        }
        let mut k = [0u8; KEY_LEN];
        k.copy_from_slice(&bytes);
        return Ok(k);
    }

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

/// One CRM object to upsert, collected during `ingest` so a whole sync's writes
/// commit in a single transaction (`apply_ingest_batch`). Mirrors the args of
/// `upsert_object` one-for-one.
pub struct CrmUpsert {
    pub id: String,
    pub kind: String,
    pub household_id: String,
    pub updated_at: String,
    pub content_hash: String,
    pub json: String,
}

/// The one INSERT-or-update statement `upsert_object` and `apply_ingest_batch`
/// share, so the single-row and batched paths can never drift. Runs against a
/// `Connection` or a `Transaction` (both deref to `Connection`).
fn upsert_crm_object_row(
    conn: &Connection,
    id: &str,
    kind: &str,
    household_id: &str,
    updated_at: &str,
    content_hash: &str,
    json: &str,
) -> Result<()> {
    conn.execute(
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

pub struct CrmStore {
    conn: std::sync::Mutex<Connection>,
    #[allow(dead_code)]
    workspace_root: PathBuf,
}

impl CrmStore {
    /// Canonical path for the encrypted CRM DB inside a workspace.
    pub fn db_path(workspace_root: &Path) -> PathBuf {
        crate::commands::data_dir::workspace_data_dir(workspace_root).join("crm-enc.db")
    }

    /// Open (or create) the SQLCipher database keyed with `key`.
    /// PRAGMA key MUST be the very first statement on the connection.
    pub fn open_with_key(workspace_root: &Path, key: &[u8; KEY_LEN]) -> Result<Self> {
        let p = Self::db_path(workspace_root);
        if let Some(parent) = p.parent() {
            std::fs::create_dir_all(parent).ok();
        }
        let conn =
            Connection::open(&p).with_context(|| format!("open crm enc db {}", p.display()))?;

        // SQLCipher: key must be set before any DDL.
        // Raw-hex form bypasses passphrase KDF overhead.
        let hex_key = hex::encode(key);
        conn.execute_batch(&format!("PRAGMA key = \"x'{}'\";", hex_key))?;

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
        upsert_crm_object_row(&c, id, kind, household_id, updated_at, content_hash, json)
    }

    /// Apply a whole ingest's writes in ONE transaction: every upsert (each
    /// resets `deleted = 0`) then every tombstone. Autocommit fsyncs once per
    /// statement, so a sync of thousands of objects costs thousands of fsyncs;
    /// a single transaction cuts that to one commit. Upserts run before
    /// tombstones — the exact order `ingest` used when it wrote them inline, so
    /// the result is identical. Empty input is a no-op. P2.3 row 7.
    pub fn apply_ingest_batch(
        &self,
        upserts: &[CrmUpsert],
        tombstone_ids: &[String],
    ) -> Result<()> {
        if upserts.is_empty() && tombstone_ids.is_empty() {
            return Ok(());
        }
        let mut c = self.conn.lock().unwrap();
        let tx = c.transaction()?;
        for u in upserts {
            upsert_crm_object_row(
                &tx,
                &u.id,
                &u.kind,
                &u.household_id,
                &u.updated_at,
                &u.content_hash,
                &u.json,
            )?;
        }
        for id in tombstone_ids {
            tx.execute("UPDATE crm_objects SET deleted = 1 WHERE id = ?1", [id])?;
        }
        tx.commit()?;
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

    /// P2.3 row 8: the cheap change-detection digest for a household — its
    /// non-deleted objects as `(id, kind, content_hash)`, in the SAME order (same
    /// WHERE, no ORDER BY) `list_objects_by_household` returns them. This lets the
    /// sync engine decide "did this household's plan change?" WITHOUT reading or
    /// deserialising the (large) `json` column or running any render function.
    /// `content_hash` is a strong hash of the JSON, so identical digests mean
    /// identical rendered output (barring a hash collision).
    #[allow(dead_code)]
    pub fn list_object_digests_by_household(
        &self,
        household_id: &str,
    ) -> Result<Vec<(String, String, String)>> {
        let c = self.conn.lock().unwrap();
        let mut stmt = c.prepare(
            "SELECT id, kind, content_hash
             FROM crm_objects
             WHERE household_id = ?1 AND deleted = 0",
        )?;
        let rows = stmt
            .query_map([household_id], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                ))
            })?
            .collect::<rusqlite::Result<Vec<(String, String, String)>>>()?;
        Ok(rows)
    }

    /// Return all non-deleted object ids for a given kind.
    /// Used for snapshot-diff deletion detection: anything in the previous
    /// snapshot but absent from the new API response should be tombstoned.
    #[allow(dead_code)]
    pub fn list_object_ids(&self, kind: &str) -> Result<Vec<String>> {
        let c = self.conn.lock().unwrap();
        let mut stmt = c.prepare("SELECT id FROM crm_objects WHERE kind = ?1 AND deleted = 0")?;
        let rows = stmt
            .query_map([kind], |r| r.get::<_, String>(0))?
            .collect::<rusqlite::Result<Vec<String>>>()?;
        Ok(rows)
    }

    /// Return every non-deleted object id across all kinds. Used for snapshot-diff
    /// deletion detection: ids present here but absent from the latest full API
    /// response have been removed in Wealthbox and should be tombstoned.
    #[allow(dead_code)]
    pub fn list_all_object_ids(&self) -> Result<Vec<String>> {
        let c = self.conn.lock().unwrap();
        let mut stmt = c.prepare("SELECT id FROM crm_objects WHERE deleted = 0")?;
        let rows = stmt
            .query_map([], |r| r.get::<_, String>(0))?
            .collect::<rusqlite::Result<Vec<String>>>()?;
        Ok(rows)
    }

    /// Return every non-deleted object whose store id carries a provider marker in the
    /// id payload, e.g. `contact:sfdc:003...`. This is used for provider-scoped
    /// disconnect so removing Salesforce cannot remove Wealthbox rows.
    #[allow(dead_code)]
    pub fn list_objects_by_provider_marker(&self, marker: &str) -> Result<Vec<CrmObjectRow>> {
        self.list_objects_by_provider_marker_inner(marker, false)
    }

    /// Return every object whose store id carries a provider marker, including
    /// tombstoned rows. Disconnect uses this path so stale RAG chunks from rows
    /// that disappeared in an earlier sync are purged before the DB rows are
    /// hard-deleted.
    #[allow(dead_code)]
    pub fn list_objects_by_provider_marker_including_deleted(
        &self,
        marker: &str,
    ) -> Result<Vec<CrmObjectRow>> {
        self.list_objects_by_provider_marker_inner(marker, true)
    }

    fn list_objects_by_provider_marker_inner(
        &self,
        marker: &str,
        include_deleted: bool,
    ) -> Result<Vec<CrmObjectRow>> {
        let marker = marker.trim();
        if marker.is_empty() || marker.contains('%') || marker.contains('_') {
            anyhow::bail!("invalid CRM provider marker");
        }
        let c = self.conn.lock().unwrap();
        let like = format!("{marker}%");
        let sql = if include_deleted {
            "SELECT id, kind, household_id, updated_at, content_hash, json, deleted
             FROM crm_objects
             WHERE substr(id, instr(id, ':') + 1) LIKE ?1"
        } else {
            "SELECT id, kind, household_id, updated_at, content_hash, json, deleted
             FROM crm_objects
             WHERE substr(id, instr(id, ':') + 1) LIKE ?1 AND deleted = 0"
        };
        let mut stmt = c.prepare(sql)?;
        let rows = stmt
            .query_map([like], row_to_crm_object)?
            .collect::<rusqlite::Result<Vec<CrmObjectRow>>>()?;
        Ok(rows)
    }

    /// Return every legacy Wealthbox row, including tombstoned rows. Wealthbox
    /// owns the original unprefixed id space (`contact:10002`, `note:456`).
    #[allow(dead_code)]
    pub fn list_legacy_wealthbox_objects_including_deleted(&self) -> Result<Vec<CrmObjectRow>> {
        let c = self.conn.lock().unwrap();
        let mut stmt = c.prepare(
            "SELECT id, kind, household_id, updated_at, content_hash, json, deleted
             FROM crm_objects
             WHERE instr(id, ':') = 0
                OR (
                    substr(id, instr(id, ':') + 1) NOT LIKE 'sfdc:%'
                    AND substr(id, instr(id, ':') + 1) NOT LIKE 'redtail:%'
                )",
        )?;
        let rows = stmt
            .query_map([], row_to_crm_object)?
            .collect::<rusqlite::Result<Vec<CrmObjectRow>>>()?;
        Ok(rows)
    }

    /// Hard-delete every CRM object whose store id carries the given provider
    /// marker. Render-state rows for affected households are also removed so a
    /// later sync recomputes the matter plan from the remaining provider rows.
    #[allow(dead_code)]
    pub fn purge_objects_by_provider_marker(&self, marker: &str) -> Result<usize> {
        let marker = marker.trim();
        if marker.is_empty() || marker.contains('%') || marker.contains('_') {
            anyhow::bail!("invalid CRM provider marker");
        }
        let c = self.conn.lock().unwrap();
        let like = format!("{marker}%");

        let mut stmt = c.prepare(
            "SELECT DISTINCT household_id FROM crm_objects
             WHERE substr(id, instr(id, ':') + 1) LIKE ?1 AND household_id != ''",
        )?;
        let household_ids = stmt
            .query_map([like.as_str()], |r| r.get::<_, String>(0))?
            .collect::<rusqlite::Result<Vec<String>>>()?;
        drop(stmt);

        for household_id in household_ids {
            c.execute(
                "DELETE FROM crm_render_state WHERE household_id = ?1",
                [household_id],
            )?;
        }

        let deleted = c.execute(
            "DELETE FROM crm_objects WHERE substr(id, instr(id, ':') + 1) LIKE ?1",
            [like],
        )?;
        Ok(deleted)
    }

    /// Hard-delete every legacy Wealthbox object while preserving provider-prefixed
    /// rows such as Salesforce (`sfdc:`) and Redtail (`redtail:`).
    #[allow(dead_code)]
    pub fn purge_legacy_wealthbox_objects(&self) -> Result<usize> {
        let c = self.conn.lock().unwrap();
        let legacy_predicate = "instr(id, ':') = 0
            OR (
                substr(id, instr(id, ':') + 1) NOT LIKE 'sfdc:%'
                AND substr(id, instr(id, ':') + 1) NOT LIKE 'redtail:%'
            )";

        let mut stmt = c.prepare(&format!(
            "SELECT DISTINCT household_id FROM crm_objects
             WHERE ({legacy_predicate}) AND household_id != ''"
        ))?;
        let household_ids = stmt
            .query_map([], |r| r.get::<_, String>(0))?
            .collect::<rusqlite::Result<Vec<String>>>()?;
        drop(stmt);

        for household_id in household_ids {
            c.execute(
                "DELETE FROM crm_render_state WHERE household_id = ?1",
                [household_id],
            )?;
        }

        let deleted = c.execute(
            &format!("DELETE FROM crm_objects WHERE {legacy_predicate}"),
            [],
        )?;
        Ok(deleted)
    }

    #[allow(dead_code)]
    pub fn has_any_objects_including_deleted(&self) -> Result<bool> {
        let c = self.conn.lock().unwrap();
        let count = c.query_row("SELECT COUNT(*) FROM crm_objects", [], |r| {
            r.get::<_, i64>(0)
        })?;
        Ok(count > 0)
    }

    /// Soft-delete an object (sets `deleted = 1`).
    #[allow(dead_code)]
    pub fn tombstone_object(&self, id: &str) -> Result<()> {
        let c = self.conn.lock().unwrap();
        c.execute("UPDATE crm_objects SET deleted = 1 WHERE id = ?1", [id])?;
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
    pub fn get_render_state(&self, household_id: &str) -> Result<Option<(String, bool)>> {
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
        Ok(
            c.query_row("SELECT value FROM meta WHERE key = ?1", [key], |r| r.get(0))
                .optional()?,
        )
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

    /// Delete every locally-imported Wealthbox object by removing the encrypted
    /// CRM database file. The file is recreated empty the next time `open` is
    /// called. Invoked by `crm_disconnect` so a disconnected workspace retains no
    /// residual CRM data on disk.
    #[allow(dead_code)]
    pub fn purge(workspace_root: &Path) -> Result<()> {
        // Remove the main DB file AND its SQLite sidecars. WAL/SHM hold
        // un-checkpointed pages and the rollback journal holds pre-images; leaving
        // any of them behind would strand decryptable CRM data after a disconnect.
        let base = Self::db_path(workspace_root);
        for suffix in ["", "-wal", "-shm", "-journal"] {
            let p = if suffix.is_empty() {
                base.clone()
            } else {
                let mut s = base.clone().into_os_string();
                s.push(suffix);
                PathBuf::from(s)
            };
            if p.exists() {
                std::fs::remove_file(&p)
                    .with_context(|| format!("failed to remove crm db file {}", p.display()))?;
            }
        }
        Ok(())
    }

    /// Delete the CRM database's encryption key from the OS keychain. Called only
    /// AFTER a confirmed DB + vector purge (by `crm_disconnect_logic`), so a
    /// disconnect leaves neither decryptable CRM data NOR an orphaned key behind.
    /// A missing entry is treated as success (idempotent).
    pub fn delete_master_key() -> Result<()> {
        match keyring::Entry::new(CRM_KEYCHAIN_SERVICE, CRM_KEYCHAIN_KEY)
            .context("crm keychain entry")?
            .delete_credential()
        {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(anyhow::anyhow!("crm keychain key delete: {e}")),
        }
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

    /// P2.3 row 8: the cheap digest list MUST match `list_objects_by_household`
    /// in order and in (id, kind, content_hash) values — the sync engine's
    /// change-detection depends on it reflecting the exact rows plan rendering
    /// reads. Verifies parity including after an update (content_hash changes)
    /// and a tombstone (deleted rows drop from both).
    #[test]
    fn object_digests_match_list_objects_by_household() {
        let (_d, s) = crm_store();
        s.upsert_object("household:1", "household", "1", "", "h-hh", r#"{"a":1}"#).unwrap();
        s.upsert_object("contact:10", "person", "1", "", "h-c10", r#"{"a":2}"#).unwrap();
        s.upsert_object("note:5", "note", "1", "", "h-n5", r#"{"a":3}"#).unwrap();
        // A different household must not leak in.
        s.upsert_object("contact:99", "person", "2", "", "h-c99", r#"{"a":4}"#).unwrap();

        let expect = |s: &CrmStore| -> Vec<(String, String, String)> {
            s.list_objects_by_household("1")
                .unwrap()
                .into_iter()
                .map(|r| (r.id, r.kind, r.content_hash))
                .collect()
        };
        assert_eq!(s.list_object_digests_by_household("1").unwrap(), expect(&s));

        // Update one object's content_hash → digest reflects it.
        s.upsert_object("contact:10", "person", "1", "", "h-c10-v2", r#"{"a":22}"#).unwrap();
        assert_eq!(s.list_object_digests_by_household("1").unwrap(), expect(&s));

        // Tombstone one → drops from both, still in parity.
        s.tombstone_object("note:5").unwrap();
        let digests = s.list_object_digests_by_household("1").unwrap();
        assert_eq!(digests, expect(&s));
        assert!(!digests.iter().any(|(id, _, _)| id == "note:5"));
    }

    /// P2.3 row 7: `apply_ingest_batch` is behaviourally identical to per-object
    /// `upsert_object` + `tombstone_object`, just committed in one transaction.
    #[test]
    fn apply_ingest_batch_matches_per_object_writes() {
        let per_row = crm_store();
        let batched = crm_store();

        let ups = vec![
            CrmUpsert { id: "household:1".into(), kind: "household".into(), household_id: "1".into(), updated_at: "".into(), content_hash: "h1".into(), json: r#"{"a":1}"#.into() },
            CrmUpsert { id: "contact:10".into(), kind: "person".into(), household_id: "1".into(), updated_at: "".into(), content_hash: "h2".into(), json: r#"{"a":2}"#.into() },
        ];
        // Seed a row that both will tombstone.
        per_row.1.upsert_object("stale:9", "note", "1", "", "hs", r#"{"a":9}"#).unwrap();
        batched.1.upsert_object("stale:9", "note", "1", "", "hs", r#"{"a":9}"#).unwrap();

        // Per-object path.
        for u in &ups {
            per_row.1.upsert_object(&u.id, &u.kind, &u.household_id, &u.updated_at, &u.content_hash, &u.json).unwrap();
        }
        per_row.1.tombstone_object("stale:9").unwrap();

        // Batched path.
        batched.1.apply_ingest_batch(&ups, &["stale:9".to_string()]).unwrap();

        assert_eq!(
            per_row.1.list_objects_by_household("1").unwrap().into_iter().map(|r| (r.id, r.kind, r.content_hash, r.json)).collect::<Vec<_>>(),
            batched.1.list_objects_by_household("1").unwrap().into_iter().map(|r| (r.id, r.kind, r.content_hash, r.json)).collect::<Vec<_>>(),
        );
        assert!(per_row.1.get_object("stale:9").unwrap().unwrap().deleted);
        assert!(batched.1.get_object("stale:9").unwrap().unwrap().deleted);
    }

    /// Build the path for a CRM DB SQLite sidecar suffix (e.g. "-wal").
    fn sidecar(base: &std::path::Path, suffix: &str) -> std::path::PathBuf {
        let mut s = base.to_path_buf().into_os_string();
        s.push(suffix);
        std::path::PathBuf::from(s)
    }

    /// PURGE P4: `purge` must remove the main DB AND every SQLite sidecar (-wal, -shm,
    /// -journal), or a disconnect would leave decryptable CRM pages on disk.
    #[test]
    fn purge_removes_db_and_all_sqlite_sidecars() {
        let dir = TempDir::new().unwrap();
        // Create the real DB, then fabricate its sidecars.
        let _ = CrmStore::open_with_key(dir.path(), &[0x33u8; 32]).expect("open");
        let base = CrmStore::db_path(dir.path());
        for suffix in ["-wal", "-shm", "-journal"] {
            std::fs::write(sidecar(&base, suffix), b"residue").unwrap();
        }
        assert!(base.exists(), "db file should exist before purge");
        for suffix in ["-wal", "-shm", "-journal"] {
            assert!(
                sidecar(&base, suffix).exists(),
                "sidecar {suffix} should exist before purge"
            );
        }

        CrmStore::purge(dir.path()).expect("purge");

        assert!(!base.exists(), "crm-enc.db must be gone after purge");
        for suffix in ["-wal", "-shm", "-journal"] {
            assert!(
                !sidecar(&base, suffix).exists(),
                "crm-enc.db{suffix} must be gone after purge"
            );
        }
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

    #[test]
    fn provider_marker_purge_removes_only_salesforce_rows() {
        let (_d, s) = crm_store();

        s.upsert_object(
            "contact:10002",
            "person",
            "10001",
            "",
            "hash-wb",
            r#"{"id":10002}"#,
        )
        .unwrap();
        s.upsert_object(
            "contact:sfdc:003CC0000000002AAA:acct:001HH0000000001AAA",
            "person",
            "sfdc:001HH0000000001AAA",
            "",
            "hash-sf-contact",
            r#"{"external_id":"sfdc:003CC0000000002AAA:acct:001HH0000000001AAA"}"#,
        )
        .unwrap();
        s.upsert_object(
            "contact:sfdc:001HH0000000001AAA",
            "household",
            "sfdc:001HH0000000001AAA",
            "",
            "hash-sf-household",
            r#"{"external_id":"sfdc:001HH0000000001AAA"}"#,
        )
        .unwrap();
        s.set_render_state("sfdc:001HH0000000001AAA", "stale", true)
            .unwrap();

        let salesforce_rows = s.list_objects_by_provider_marker("sfdc:").unwrap();
        assert_eq!(salesforce_rows.len(), 2);

        let deleted = s.purge_objects_by_provider_marker("sfdc:").unwrap();
        assert_eq!(deleted, 2);

        assert!(
            s.get_object("contact:10002").unwrap().is_some(),
            "Wealthbox row must survive Salesforce purge"
        );
        assert!(
            s.get_object("contact:sfdc:001HH0000000001AAA")
                .unwrap()
                .is_none(),
            "Salesforce household row must be gone"
        );
        assert_eq!(
            s.get_render_state("sfdc:001HH0000000001AAA").unwrap(),
            None,
            "provider purge must clear stale render state for that household"
        );
    }

    #[test]
    fn legacy_wealthbox_purge_removes_live_and_tombstoned_rows_only() {
        let (_d, s) = crm_store();

        s.upsert_object(
            "contact:10002",
            "person",
            "10001",
            "",
            "hash-wb-live",
            r#"{"id":10002}"#,
        )
        .unwrap();
        s.upsert_object(
            "note:20002",
            "note",
            "10001",
            "",
            "hash-wb-tombstoned",
            r#"{"id":20002}"#,
        )
        .unwrap();
        s.tombstone_object("note:20002").unwrap();
        s.upsert_object(
            "contact:sfdc:001HH0000000001AAA",
            "household",
            "sfdc:001HH0000000001AAA",
            "",
            "hash-sf",
            r#"{"external_id":"sfdc:001HH0000000001AAA"}"#,
        )
        .unwrap();
        s.upsert_object(
            "contact:redtail:family:7",
            "household",
            "redtail:family:7",
            "",
            "hash-redtail-family",
            r#"{"external_id":"redtail:family:7"}"#,
        )
        .unwrap();
        s.upsert_object(
            "note:redtail:note:2",
            "note",
            "redtail:family:7",
            "",
            "hash-redtail-note",
            r#"{"external_id":"redtail:note:2"}"#,
        )
        .unwrap();
        s.set_render_state("10001", "stale", true).unwrap();

        let wealthbox_rows = s.list_legacy_wealthbox_objects_including_deleted().unwrap();
        assert_eq!(wealthbox_rows.len(), 2);

        let deleted = s.purge_legacy_wealthbox_objects().unwrap();
        assert_eq!(deleted, 2);

        assert!(s.get_object("contact:10002").unwrap().is_none());
        assert!(s.get_object("note:20002").unwrap().is_none());
        assert!(
            s.get_object("contact:sfdc:001HH0000000001AAA")
                .unwrap()
                .is_some(),
            "Salesforce row must survive Wealthbox purge"
        );
        assert!(
            s.get_object("contact:redtail:family:7").unwrap().is_some(),
            "Redtail row must survive Wealthbox purge"
        );
        assert_eq!(
            s.get_render_state("10001").unwrap(),
            None,
            "legacy Wealthbox purge must clear stale render state for that household"
        );
        assert!(s.has_any_objects_including_deleted().unwrap());
    }

    #[test]
    fn provider_marker_purge_removes_only_redtail_rows() {
        let (_d, s) = crm_store();

        s.upsert_object(
            "contact:10002",
            "person",
            "10001",
            "",
            "hash-wb",
            r#"{"id":10002}"#,
        )
        .unwrap();
        s.upsert_object(
            "contact:sfdc:001HH0000000001AAA",
            "household",
            "sfdc:001HH0000000001AAA",
            "",
            "hash-sf",
            r#"{"external_id":"sfdc:001HH0000000001AAA"}"#,
        )
        .unwrap();
        s.upsert_object(
            "contact:redtail:family:7",
            "household",
            "redtail:family:7",
            "",
            "hash-redtail-family",
            r#"{"external_id":"redtail:family:7"}"#,
        )
        .unwrap();
        s.upsert_object(
            "note:redtail:note:2",
            "note",
            "redtail:family:7",
            "",
            "hash-redtail-note",
            r#"{"external_id":"redtail:note:2"}"#,
        )
        .unwrap();
        s.set_render_state("redtail:family:7", "stale", true)
            .unwrap();

        let redtail_rows = s.list_objects_by_provider_marker("redtail:").unwrap();
        assert_eq!(redtail_rows.len(), 2);

        let deleted = s.purge_objects_by_provider_marker("redtail:").unwrap();
        assert_eq!(deleted, 2);

        assert!(
            s.get_object("contact:10002").unwrap().is_some(),
            "Wealthbox row must survive Redtail purge"
        );
        assert!(
            s.get_object("contact:sfdc:001HH0000000001AAA")
                .unwrap()
                .is_some(),
            "Salesforce row must survive Redtail purge"
        );
        assert!(
            s.get_object("contact:redtail:family:7").unwrap().is_none(),
            "Redtail household row must be gone"
        );
        assert_eq!(
            s.get_render_state("redtail:family:7").unwrap(),
            None,
            "provider purge must clear stale render state for that household"
        );
    }

    #[test]
    fn provider_marker_list_including_deleted_returns_tombstoned_salesforce_rows() {
        let (_d, s) = crm_store();

        s.upsert_object(
            "contact:sfdc:003CC0000000002AAA:acct:001HH0000000001AAA",
            "person",
            "sfdc:001HH0000000001AAA",
            "",
            "hash-sf-contact",
            r#"{"external_id":"sfdc:003CC0000000002AAA:acct:001HH0000000001AAA"}"#,
        )
        .unwrap();
        s.tombstone_object("contact:sfdc:003CC0000000002AAA:acct:001HH0000000001AAA")
            .unwrap();

        assert!(
            s.list_objects_by_provider_marker("sfdc:")
                .unwrap()
                .is_empty(),
            "the live provider-marker list should still hide tombstoned rows"
        );

        let all = s
            .list_objects_by_provider_marker_including_deleted("sfdc:")
            .unwrap();
        assert_eq!(all.len(), 1);
        assert!(
            all[0].deleted,
            "disconnect needs tombstoned provider rows so their stale RAG chunks can be deleted"
        );
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
        assert_eq!(s.get_meta("sync_state").unwrap().as_deref(), Some("idle"));
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
        let result = raw.query_row("SELECT count(*) FROM crm_objects", [], |r| {
            r.get::<_, i64>(0)
        });
        assert!(
            result.is_err(),
            "plain rusqlite connection must not be able to read SQLCipher DB"
        );
    }
}
