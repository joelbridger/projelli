//! Encrypted local store for the OneDrive / SharePoint connector.
//!
//! Stores sync metadata only: cursors, item metadata, content hashes, and
//! fetched-vs-indexed status. Raw downloaded file bytes are never stored here.

use anyhow::{Context, Result};
use rusqlite::{Connection, OptionalExtension};
use std::path::{Path, PathBuf};

const ONEDRIVE_DB_KEYCHAIN_SERVICE: &str = crate::identity::ONEDRIVE_ENC_SERVICE;
const ONEDRIVE_DB_KEYCHAIN_KEY: &str = "master-key-v1";
const KEY_LEN: usize = 32;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OneDriveItemRow {
    pub source_id: String,
    pub drive_id: String,
    pub site_id: Option<String>,
    pub item_id: String,
    pub name: String,
    pub parent_path: String,
    pub web_url: Option<String>,
    pub remote_signature: String,
    pub content_hash: String,
    pub matter_id: String,
    pub indexed: bool,
    pub pending_pdf: bool,
    pub deleted: bool,
}

pub struct OneDriveStore {
    conn: std::sync::Mutex<Connection>,
    #[allow(dead_code)]
    workspace_root: PathBuf,
}

fn master_key() -> Result<[u8; KEY_LEN]> {
    let entry = keyring::Entry::new(ONEDRIVE_DB_KEYCHAIN_SERVICE, ONEDRIVE_DB_KEYCHAIN_KEY)
        .context("onedrive db keychain entry")?;
    match entry.get_password() {
        Ok(hex) => {
            let bytes = hex::decode(hex.trim()).context("decode onedrive master key hex")?;
            if bytes.len() != KEY_LEN {
                anyhow::bail!(
                    "stored onedrive master key has wrong length: {}",
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
                .context("store onedrive master key")?;
            Ok(k)
        }
        Err(e) => Err(anyhow::anyhow!("onedrive keychain read: {e}")),
    }
}

impl OneDriveStore {
    pub fn db_path(workspace_root: &Path) -> PathBuf {
        crate::commands::data_dir::workspace_data_dir(workspace_root).join("onedrive-enc.db")
    }

    pub fn open(workspace_root: &Path) -> Result<Self> {
        let key = master_key()?;
        Self::open_with_key(workspace_root, &key)
    }

    pub fn open_with_key(workspace_root: &Path, key: &[u8; KEY_LEN]) -> Result<Self> {
        let p = Self::db_path(workspace_root);
        if let Some(parent) = p.parent() {
            std::fs::create_dir_all(parent).ok();
        }
        let conn = Connection::open(&p)
            .with_context(|| format!("open onedrive enc db {}", p.display()))?;
        conn.execute_batch(&format!("PRAGMA key = \"x'{}'\";", hex::encode(key)))?;
        conn.busy_timeout(std::time::Duration::from_secs(5))?;
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS onedrive_items (
                source_id        TEXT PRIMARY KEY,
                drive_id         TEXT NOT NULL,
                site_id          TEXT,
                item_id          TEXT NOT NULL,
                name             TEXT NOT NULL,
                parent_path      TEXT NOT NULL DEFAULT '',
                web_url          TEXT,
                remote_signature TEXT NOT NULL DEFAULT '',
                content_hash     TEXT NOT NULL DEFAULT '',
                matter_id        TEXT NOT NULL DEFAULT 'unassigned',
                indexed          INTEGER NOT NULL DEFAULT 0,
                pending_pdf      INTEGER NOT NULL DEFAULT 0,
                deleted          INTEGER NOT NULL DEFAULT 0,
                updated_at       TEXT NOT NULL DEFAULT '',
                local_path       TEXT
             );
             CREATE INDEX IF NOT EXISTS idx_onedrive_items_drive ON onedrive_items(drive_id);
             CREATE INDEX IF NOT EXISTS idx_onedrive_items_indexed ON onedrive_items(indexed, deleted);
             CREATE TABLE IF NOT EXISTS onedrive_cursors (
                root_key TEXT PRIMARY KEY,
                cursor   TEXT NOT NULL
             );
             CREATE TABLE IF NOT EXISTS meta (
                key   TEXT PRIMARY KEY,
                value TEXT NOT NULL
             );",
        )?;
        // Best-effort migration for stores created before the on-disk materialize
        // path existed. `ALTER TABLE ... ADD COLUMN` errors if the column is
        // already present (fresh DBs created by the CREATE above), so ignore it.
        let _ = conn.execute("ALTER TABLE onedrive_items ADD COLUMN local_path TEXT", []);
        Ok(Self {
            conn: std::sync::Mutex::new(conn),
            workspace_root: workspace_root.to_path_buf(),
        })
    }

    #[allow(clippy::too_many_arguments)]
    pub fn upsert_item(
        &self,
        source_id: &str,
        drive_id: &str,
        site_id: Option<&str>,
        item_id: &str,
        name: &str,
        parent_path: &str,
        web_url: Option<&str>,
        remote_signature: &str,
        content_hash: &str,
        matter_id: &str,
        indexed: bool,
        pending_pdf: bool,
    ) -> Result<()> {
        let c = self.conn.lock().unwrap();
        c.execute(
            "INSERT INTO onedrive_items
                (source_id, drive_id, site_id, item_id, name, parent_path, web_url,
                 remote_signature, content_hash, matter_id, indexed, pending_pdf, deleted, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, 0, ?13)
             ON CONFLICT(source_id) DO UPDATE SET
                drive_id = ?2,
                site_id = ?3,
                item_id = ?4,
                name = ?5,
                parent_path = ?6,
                web_url = ?7,
                remote_signature = ?8,
                content_hash = ?9,
                matter_id = ?10,
                indexed = ?11,
                pending_pdf = ?12,
                deleted = 0,
                updated_at = ?13",
            rusqlite::params![
                source_id,
                drive_id,
                site_id,
                item_id,
                name,
                parent_path,
                web_url,
                remote_signature,
                content_hash,
                matter_id,
                indexed as i64,
                pending_pdf as i64,
                chrono::Utc::now().to_rfc3339(),
            ],
        )?;
        Ok(())
    }

    pub fn get_item(&self, source_id: &str) -> Result<Option<OneDriveItemRow>> {
        let c = self.conn.lock().unwrap();
        c.query_row(
            "SELECT source_id, drive_id, site_id, item_id, name, parent_path, web_url,
                    remote_signature, content_hash, matter_id, indexed, pending_pdf, deleted
             FROM onedrive_items WHERE source_id = ?1",
            [source_id],
            row_to_item,
        )
        .optional()
        .map_err(anyhow::Error::from)
    }

    /// Record the workspace-relative path a downloaded item was materialized to
    /// on disk, so a later remote-delete can remove the local copy too.
    pub fn set_local_path(&self, source_id: &str, local_path: &str) -> Result<()> {
        let c = self.conn.lock().unwrap();
        c.execute(
            "UPDATE onedrive_items SET local_path = ?2 WHERE source_id = ?1",
            rusqlite::params![source_id, local_path],
        )?;
        Ok(())
    }

    /// Forget the recorded on-disk path for an item (after its local copy has been
    /// removed because it no longer maps to a client with a disk destination).
    pub fn clear_local_path(&self, source_id: &str) -> Result<()> {
        let c = self.conn.lock().unwrap();
        c.execute(
            "UPDATE onedrive_items SET local_path = NULL WHERE source_id = ?1",
            [source_id],
        )?;
        Ok(())
    }

    /// The workspace-relative on-disk path a downloaded item was written to, if it
    /// was materialized to disk (mapped-to-a-client files). `None` for RAG-only
    /// items and older rows.
    pub fn get_local_path(&self, source_id: &str) -> Result<Option<String>> {
        let c = self.conn.lock().unwrap();
        c.query_row(
            "SELECT local_path FROM onedrive_items WHERE source_id = ?1",
            [source_id],
            |r| r.get::<_, Option<String>>(0),
        )
        .optional()
        .map(|opt| opt.flatten())
        .map_err(anyhow::Error::from)
    }

    pub fn mark_deleted(&self, source_id: &str) -> Result<()> {
        let c = self.conn.lock().unwrap();
        c.execute(
            "UPDATE onedrive_items SET deleted = 1, indexed = 0 WHERE source_id = ?1",
            [source_id],
        )?;
        Ok(())
    }

    pub fn mark_needs_index(&self, source_id: &str) -> Result<()> {
        let c = self.conn.lock().unwrap();
        c.execute(
            "UPDATE onedrive_items SET indexed = 0 WHERE source_id = ?1",
            [source_id],
        )?;
        Ok(())
    }

    pub fn list_needs_index(&self) -> Result<Vec<OneDriveItemRow>> {
        let c = self.conn.lock().unwrap();
        let mut stmt = c.prepare(
            "SELECT source_id, drive_id, site_id, item_id, name, parent_path, web_url,
                    remote_signature, content_hash, matter_id, indexed, pending_pdf, deleted
             FROM onedrive_items
             WHERE deleted = 0 AND indexed = 0 AND pending_pdf = 0",
        )?;
        let rows = stmt
            .query_map([], row_to_item)?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(anyhow::Error::from)?;
        Ok(rows)
    }

    pub fn get_cursor(&self, root_key: &str) -> Result<Option<String>> {
        let c = self.conn.lock().unwrap();
        c.query_row(
            "SELECT cursor FROM onedrive_cursors WHERE root_key = ?1",
            [root_key],
            |r| r.get(0),
        )
        .optional()
        .map_err(anyhow::Error::from)
    }

    pub fn set_cursor(&self, root_key: &str, cursor: &str) -> Result<()> {
        let c = self.conn.lock().unwrap();
        c.execute(
            "INSERT INTO onedrive_cursors (root_key, cursor) VALUES (?1, ?2)
             ON CONFLICT(root_key) DO UPDATE SET cursor = ?2",
            rusqlite::params![root_key, cursor],
        )?;
        Ok(())
    }

    pub fn clear_cursor(&self, root_key: &str) -> Result<()> {
        let c = self.conn.lock().unwrap();
        c.execute(
            "DELETE FROM onedrive_cursors WHERE root_key = ?1",
            [root_key],
        )?;
        Ok(())
    }

    pub fn purge(workspace_root: &Path) -> Result<()> {
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
                std::fs::remove_file(&p).with_context(|| {
                    format!("failed to remove onedrive db file {}", p.display())
                })?;
            }
        }
        Ok(())
    }

    pub fn delete_master_key() -> Result<()> {
        match keyring::Entry::new(ONEDRIVE_DB_KEYCHAIN_SERVICE, ONEDRIVE_DB_KEYCHAIN_KEY)
            .context("onedrive db keychain entry")?
            .delete_credential()
        {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(anyhow::anyhow!("onedrive keychain key delete: {e}")),
        }
    }
}

fn row_to_item(r: &rusqlite::Row<'_>) -> rusqlite::Result<OneDriveItemRow> {
    Ok(OneDriveItemRow {
        source_id: r.get(0)?,
        drive_id: r.get(1)?,
        site_id: r.get(2)?,
        item_id: r.get(3)?,
        name: r.get(4)?,
        parent_path: r.get(5)?,
        web_url: r.get(6)?,
        remote_signature: r.get(7)?,
        content_hash: r.get(8)?,
        matter_id: r.get(9)?,
        indexed: r.get::<_, i64>(10)? != 0,
        pending_pdf: r.get::<_, i64>(11)? != 0,
        deleted: r.get::<_, i64>(12)? != 0,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn store() -> (TempDir, OneDriveStore) {
        let dir = TempDir::new().unwrap();
        let s = OneDriveStore::open_with_key(dir.path(), &[0x42u8; 32]).unwrap();
        (dir, s)
    }

    #[test]
    fn cursor_roundtrip_and_reset() {
        let (_d, s) = store();
        assert_eq!(s.get_cursor("m365/default/me").unwrap(), None);
        s.set_cursor("m365/default/me", "delta-1").unwrap();
        assert_eq!(
            s.get_cursor("m365/default/me").unwrap().as_deref(),
            Some("delta-1")
        );
        s.clear_cursor("m365/default/me").unwrap();
        assert_eq!(s.get_cursor("m365/default/me").unwrap(), None);
    }

    #[test]
    fn fetched_vs_indexed_repair_rows_are_listed() {
        let (_d, s) = store();
        s.upsert_item(
            "onedrive:d:i",
            "d",
            None,
            "i",
            "memo.docx",
            "/clients/acme",
            None,
            "sig",
            "hash",
            "matter-a",
            false,
            false,
        )
        .unwrap();
        let rows = s.list_needs_index().unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].source_id, "onedrive:d:i");
    }

    #[test]
    fn pending_pdf_is_not_listed_for_repair() {
        let (_d, s) = store();
        s.upsert_item(
            "onedrive:d:pdf",
            "d",
            None,
            "pdf",
            "motion.pdf",
            "/clients/acme",
            None,
            "sig",
            "hash",
            "matter-a",
            false,
            true,
        )
        .unwrap();
        assert!(s.list_needs_index().unwrap().is_empty());
    }
}
