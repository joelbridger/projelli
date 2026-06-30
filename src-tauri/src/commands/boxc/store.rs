//! Encrypted local store for the Box connector.
//!
//! Stores sync metadata only: Box ids, content hashes, matter assignment, and
//! fetched-vs-indexed status. Raw downloaded file bytes are never stored here.

use anyhow::{Context, Result};
use rusqlite::{Connection, OptionalExtension};
use std::path::{Path, PathBuf};

const BOX_DB_KEYCHAIN_SERVICE: &str = crate::identity::BOX_ENC_SERVICE;
const BOX_DB_KEYCHAIN_KEY: &str = "master-key-v1";
const KEY_LEN: usize = 32;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BoxItemRow {
    pub source_id: String,
    pub file_id: String,
    pub name: String,
    pub parent_folder_id: String,
    pub parent_path: String,
    pub web_url: Option<String>,
    pub remote_signature: String,
    pub content_hash: String,
    pub matter_id: String,
    pub indexed: bool,
    pub pending_pdf: bool,
    pub deleted: bool,
}

pub struct BoxStore {
    conn: std::sync::Mutex<Connection>,
    #[allow(dead_code)]
    workspace_root: PathBuf,
}

fn master_key() -> Result<[u8; KEY_LEN]> {
    let entry = keyring::Entry::new(BOX_DB_KEYCHAIN_SERVICE, BOX_DB_KEYCHAIN_KEY)
        .context("box db keychain entry")?;
    match entry.get_password() {
        Ok(hex) => {
            let bytes = hex::decode(hex.trim()).context("decode box master key hex")?;
            if bytes.len() != KEY_LEN {
                anyhow::bail!("stored box master key has wrong length: {}", bytes.len());
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
                .context("store box master key")?;
            Ok(k)
        }
        Err(e) => Err(anyhow::anyhow!("box keychain read: {e}")),
    }
}

impl BoxStore {
    pub fn db_path(workspace_root: &Path) -> PathBuf {
        workspace_root.join(crate::identity::WORKSPACE_DATA_DIR).join("box-enc.db")
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
        let conn =
            Connection::open(&p).with_context(|| format!("open box enc db {}", p.display()))?;
        conn.execute_batch(&format!("PRAGMA key = \"x'{}'\";", hex::encode(key)))?;
        conn.busy_timeout(std::time::Duration::from_secs(5))?;
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS box_items (
                source_id        TEXT PRIMARY KEY,
                file_id          TEXT NOT NULL,
                name             TEXT NOT NULL,
                parent_folder_id TEXT NOT NULL DEFAULT '',
                parent_path      TEXT NOT NULL DEFAULT '',
                web_url          TEXT,
                remote_signature TEXT NOT NULL DEFAULT '',
                content_hash     TEXT NOT NULL DEFAULT '',
                matter_id        TEXT NOT NULL DEFAULT 'unassigned',
                indexed          INTEGER NOT NULL DEFAULT 0,
                pending_pdf      INTEGER NOT NULL DEFAULT 0,
                deleted          INTEGER NOT NULL DEFAULT 0,
                updated_at       TEXT NOT NULL DEFAULT ''
             );
             CREATE INDEX IF NOT EXISTS idx_box_items_file ON box_items(file_id);
             CREATE INDEX IF NOT EXISTS idx_box_items_indexed ON box_items(indexed, deleted);
             CREATE TABLE IF NOT EXISTS meta (
                key   TEXT PRIMARY KEY,
                value TEXT NOT NULL
             );",
        )?;
        Ok(Self {
            conn: std::sync::Mutex::new(conn),
            workspace_root: workspace_root.to_path_buf(),
        })
    }

    #[allow(clippy::too_many_arguments)]
    pub fn upsert_item(
        &self,
        source_id: &str,
        file_id: &str,
        name: &str,
        parent_folder_id: &str,
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
            "INSERT INTO box_items
                (source_id, file_id, name, parent_folder_id, parent_path, web_url,
                 remote_signature, content_hash, matter_id, indexed, pending_pdf, deleted, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, 0, ?12)
             ON CONFLICT(source_id) DO UPDATE SET
                file_id = ?2,
                name = ?3,
                parent_folder_id = ?4,
                parent_path = ?5,
                web_url = ?6,
                remote_signature = ?7,
                content_hash = ?8,
                matter_id = ?9,
                indexed = ?10,
                pending_pdf = ?11,
                deleted = 0,
                updated_at = ?12",
            rusqlite::params![
                source_id,
                file_id,
                name,
                parent_folder_id,
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

    pub fn get_item(&self, source_id: &str) -> Result<Option<BoxItemRow>> {
        let c = self.conn.lock().unwrap();
        c.query_row(
            "SELECT source_id, file_id, name, parent_folder_id, parent_path, web_url,
                    remote_signature, content_hash, matter_id, indexed, pending_pdf, deleted
             FROM box_items WHERE source_id = ?1",
            [source_id],
            row_to_item,
        )
        .optional()
        .map_err(anyhow::Error::from)
    }

    pub fn list_active_source_ids(&self) -> Result<Vec<String>> {
        let c = self.conn.lock().unwrap();
        let mut stmt = c.prepare("SELECT source_id FROM box_items WHERE deleted = 0")?;
        let ids = stmt
            .query_map([], |row| row.get(0))?
            .collect::<rusqlite::Result<Vec<String>>>()
            .map_err(anyhow::Error::from)?;
        Ok(ids)
    }

    pub fn mark_deleted(&self, source_id: &str) -> Result<()> {
        let c = self.conn.lock().unwrap();
        c.execute(
            "UPDATE box_items SET deleted = 1, indexed = 0 WHERE source_id = ?1",
            [source_id],
        )?;
        Ok(())
    }

    pub fn mark_needs_index(&self, source_id: &str) -> Result<()> {
        let c = self.conn.lock().unwrap();
        c.execute(
            "UPDATE box_items SET indexed = 0 WHERE source_id = ?1",
            [source_id],
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
                std::fs::remove_file(&p)
                    .with_context(|| format!("failed to remove box db file {}", p.display()))?;
            }
        }
        Ok(())
    }

    pub fn delete_master_key() -> Result<()> {
        match keyring::Entry::new(BOX_DB_KEYCHAIN_SERVICE, BOX_DB_KEYCHAIN_KEY)
            .context("box db keychain entry")?
            .delete_credential()
        {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(anyhow::anyhow!("box keychain key delete: {e}")),
        }
    }
}

fn row_to_item(r: &rusqlite::Row<'_>) -> rusqlite::Result<BoxItemRow> {
    Ok(BoxItemRow {
        source_id: r.get(0)?,
        file_id: r.get(1)?,
        name: r.get(2)?,
        parent_folder_id: r.get(3)?,
        parent_path: r.get(4)?,
        web_url: r.get(5)?,
        remote_signature: r.get(6)?,
        content_hash: r.get(7)?,
        matter_id: r.get(8)?,
        indexed: r.get::<_, i64>(9)? != 0,
        pending_pdf: r.get::<_, i64>(10)? != 0,
        deleted: r.get::<_, i64>(11)? != 0,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn store() -> (TempDir, BoxStore) {
        let dir = TempDir::new().unwrap();
        let s = BoxStore::open_with_key(dir.path(), &[0x42u8; 32]).unwrap();
        (dir, s)
    }

    #[test]
    fn fetched_vs_indexed_row_roundtrip() {
        let (_d, s) = store();
        s.upsert_item(
            "box:file-1",
            "file-1",
            "memo.docx",
            "folder-1",
            "/clients/acme",
            None,
            "sig",
            "hash",
            "matter-a",
            false,
            false,
        )
        .unwrap();
        let row = s.get_item("box:file-1").unwrap().expect("row");
        assert_eq!(row.file_id, "file-1");
        assert_eq!(row.matter_id, "matter-a");
        assert!(!row.indexed);
        assert_eq!(s.list_active_source_ids().unwrap(), vec!["box:file-1"]);
    }
}
