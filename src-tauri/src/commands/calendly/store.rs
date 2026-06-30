//! Durable encrypted store for Calendly meeting records.

use anyhow::{Context, Result};
use rusqlite::{Connection, OptionalExtension};
use std::path::{Path, PathBuf};

const CALENDLY_DB_KEYCHAIN_SERVICE: &str = crate::identity::CALENDLY_ENC_SERVICE;
const CALENDLY_DB_KEYCHAIN_KEY: &str = "master-key-v1";
const KEY_LEN: usize = 32;

fn calendly_master_key() -> Result<[u8; KEY_LEN]> {
    let entry = keyring::Entry::new(CALENDLY_DB_KEYCHAIN_SERVICE, CALENDLY_DB_KEYCHAIN_KEY)
        .context("calendly db keychain entry")?;
    match entry.get_password() {
        Ok(hex) => {
            let bytes = hex::decode(hex.trim()).context("decode calendly master key hex")?;
            if bytes.len() != KEY_LEN {
                anyhow::bail!(
                    "stored calendly master key has wrong length: {}",
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
                .context("store calendly master key")?;
            Ok(k)
        }
        Err(e) => Err(anyhow::anyhow!("calendly keychain read: {e}")),
    }
}

#[derive(Debug, Clone)]
pub struct CalendlyEventRow {
    pub id: String,
    pub uuid: String,
    pub event_uri: String,
    pub content_hash: String,
    pub json: String,
    pub indexed_hash: String,
    pub matter_id: String,
    pub deleted: bool,
}

pub struct CalendlyStore {
    conn: std::sync::Mutex<Connection>,
    #[allow(dead_code)]
    workspace_root: PathBuf,
}

impl CalendlyStore {
    pub fn db_path(workspace_root: &Path) -> PathBuf {
        workspace_root.join(crate::identity::WORKSPACE_DATA_DIR).join("calendly-enc.db")
    }

    pub fn open(workspace_root: &Path) -> Result<Self> {
        let key = calendly_master_key()?;
        Self::open_with_key(workspace_root, &key)
    }

    pub fn open_with_key(workspace_root: &Path, key: &[u8; KEY_LEN]) -> Result<Self> {
        let path = Self::db_path(workspace_root);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).ok();
        }
        let conn = Connection::open(&path)
            .with_context(|| format!("open calendly enc db {}", path.display()))?;
        conn.execute_batch(&format!("PRAGMA key = \"x'{}'\";", hex::encode(key)))?;
        conn.busy_timeout(std::time::Duration::from_secs(5))?;
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS calendly_events (
                id             TEXT PRIMARY KEY,
                uuid           TEXT NOT NULL,
                event_uri      TEXT NOT NULL,
                content_hash   TEXT NOT NULL,
                json           TEXT NOT NULL,
                fetched_at     TEXT NOT NULL,
                indexed_at     TEXT NOT NULL DEFAULT '',
                indexed_hash   TEXT NOT NULL DEFAULT '',
                matter_id      TEXT NOT NULL DEFAULT '',
                deleted        INTEGER NOT NULL DEFAULT 0
            );
             CREATE INDEX IF NOT EXISTS idx_calendly_events_uuid
                ON calendly_events(uuid);
             CREATE INDEX IF NOT EXISTS idx_calendly_events_indexed
                ON calendly_events(indexed_hash, content_hash);
             CREATE TABLE IF NOT EXISTS calendly_cursors (
                key     TEXT PRIMARY KEY,
                cursor  TEXT NOT NULL
            );
             CREATE TABLE IF NOT EXISTS meta (
                key    TEXT PRIMARY KEY,
                value  TEXT NOT NULL
            );",
        )?;
        Ok(Self {
            conn: std::sync::Mutex::new(conn),
            workspace_root: workspace_root.to_path_buf(),
        })
    }

    pub fn upsert_event(
        &self,
        id: &str,
        uuid: &str,
        event_uri: &str,
        content_hash: &str,
        json: &str,
    ) -> Result<bool> {
        let c = self.conn.lock().unwrap();
        let existing: Option<String> = c
            .query_row(
                "SELECT content_hash FROM calendly_events WHERE id = ?1",
                [id],
                |r| r.get(0),
            )
            .optional()?;
        c.execute(
            "INSERT INTO calendly_events
                (id, uuid, event_uri, content_hash, json, fetched_at, deleted)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0)
             ON CONFLICT(id) DO UPDATE SET
                uuid         = ?2,
                event_uri    = ?3,
                content_hash = ?4,
                json         = ?5,
                fetched_at   = ?6,
                deleted      = 0",
            rusqlite::params![
                id,
                uuid,
                event_uri,
                content_hash,
                json,
                chrono::Utc::now().to_rfc3339()
            ],
        )?;
        Ok(existing.as_deref() != Some(content_hash))
    }

    pub fn list_events_to_index(&self) -> Result<Vec<CalendlyEventRow>> {
        let c = self.conn.lock().unwrap();
        let mut stmt = c.prepare(
            "SELECT id, uuid, event_uri, content_hash, json, indexed_hash, matter_id, deleted
             FROM calendly_events
             WHERE deleted = 0 AND indexed_hash != content_hash
             ORDER BY fetched_at ASC",
        )?;
        let rows = stmt
            .query_map([], row_to_event)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    }

    pub fn get_event(&self, id: &str) -> Result<Option<CalendlyEventRow>> {
        let c = self.conn.lock().unwrap();
        c.query_row(
            "SELECT id, uuid, event_uri, content_hash, json, indexed_hash, matter_id, deleted
             FROM calendly_events WHERE id = ?1",
            [id],
            row_to_event,
        )
        .optional()
        .map_err(Into::into)
    }

    pub fn list_source_ids(&self) -> Result<Vec<String>> {
        let c = self.conn.lock().unwrap();
        let mut stmt = c.prepare("SELECT uuid FROM calendly_events")?;
        let uuids = stmt
            .query_map([], |r| r.get::<_, String>(0))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(uuids
            .into_iter()
            .map(|uuid| format!("calendly:event:{uuid}"))
            .collect())
    }

    pub fn mark_indexed(&self, id: &str, content_hash: &str, matter_id: &str) -> Result<()> {
        let c = self.conn.lock().unwrap();
        c.execute(
            "UPDATE calendly_events
             SET indexed_hash = ?2, indexed_at = ?3, matter_id = ?4
             WHERE id = ?1",
            rusqlite::params![id, content_hash, chrono::Utc::now().to_rfc3339(), matter_id],
        )?;
        Ok(())
    }

    pub fn set_cursor(&self, key: &str, cursor: &str) -> Result<()> {
        let c = self.conn.lock().unwrap();
        c.execute(
            "INSERT INTO calendly_cursors (key, cursor) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET cursor = ?2",
            rusqlite::params![key, cursor],
        )?;
        Ok(())
    }

    pub fn get_cursor(&self, key: &str) -> Result<Option<String>> {
        let c = self.conn.lock().unwrap();
        c.query_row(
            "SELECT cursor FROM calendly_cursors WHERE key = ?1",
            [key],
            |r| r.get(0),
        )
        .optional()
        .map_err(Into::into)
    }

    pub fn purge(workspace_root: &Path) -> Result<()> {
        let p = Self::db_path(workspace_root);
        for path in [
            p.clone(),
            p.with_extension("db-shm"),
            p.with_extension("db-wal"),
            p.with_extension("db-journal"),
        ] {
            match std::fs::remove_file(&path) {
                Ok(()) => {}
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                Err(e) => return Err(e.into()),
            }
        }
        Ok(())
    }

    pub fn delete_master_key() -> Result<()> {
        match keyring::Entry::new(CALENDLY_DB_KEYCHAIN_SERVICE, CALENDLY_DB_KEYCHAIN_KEY)
            .context("calendly db keychain entry")?
            .delete_credential()
        {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(e.into()),
        }
    }
}

fn row_to_event(row: &rusqlite::Row<'_>) -> rusqlite::Result<CalendlyEventRow> {
    let deleted_int: i64 = row.get(7)?;
    Ok(CalendlyEventRow {
        id: row.get(0)?,
        uuid: row.get(1)?,
        event_uri: row.get(2)?,
        content_hash: row.get(3)?,
        json: row.get(4)?,
        indexed_hash: row.get(5)?,
        matter_id: row.get(6)?,
        deleted: deleted_int != 0,
    })
}
