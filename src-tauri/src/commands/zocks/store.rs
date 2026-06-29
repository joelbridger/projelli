//! Durable encrypted store for provisional Zocks meeting-note records.

use anyhow::{Context, Result};
use rusqlite::{Connection, OptionalExtension};
use std::path::{Path, PathBuf};

const ZOCKS_DB_KEYCHAIN_SERVICE: &str = "keepance-zocks-enc";
const ZOCKS_DB_KEYCHAIN_KEY: &str = "master-key-v1";
const KEY_LEN: usize = 32;

fn zocks_master_key() -> Result<[u8; KEY_LEN]> {
    let entry = keyring::Entry::new(ZOCKS_DB_KEYCHAIN_SERVICE, ZOCKS_DB_KEYCHAIN_KEY)
        .context("zocks db keychain entry")?;
    match entry.get_password() {
        Ok(hex) => {
            let bytes = hex::decode(hex.trim()).context("decode zocks db key")?;
            if bytes.len() != KEY_LEN {
                anyhow::bail!("stored zocks db key has wrong length: {}", bytes.len());
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
                .context("store zocks db key")?;
            Ok(out)
        }
        Err(e) => Err(anyhow::anyhow!("zocks db keychain read: {e}")),
    }
}

#[derive(Debug, Clone)]
pub struct ZocksSessionRow {
    pub id: String,
    pub session_id: String,
    pub title: String,
    pub content_hash: String,
    pub json: String,
    pub indexed_hash: String,
    pub matter_id: String,
    pub needs_assignment: bool,
    pub assignment_reason: String,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ZocksUnassignedRow {
    pub source_id: String,
    pub session_id: String,
    pub title: String,
    pub reason: String,
}

pub struct ZocksStore {
    conn: std::sync::Mutex<Connection>,
    #[allow(dead_code)]
    workspace_root: PathBuf,
}

impl ZocksStore {
    pub fn db_path(workspace_root: &Path) -> PathBuf {
        workspace_root.join(".keepance").join("zocks-enc.db")
    }

    pub fn open(workspace_root: &Path) -> Result<Self> {
        let key = zocks_master_key()?;
        Self::open_with_key(workspace_root, &key)
    }

    pub fn open_with_key(workspace_root: &Path, key: &[u8; KEY_LEN]) -> Result<Self> {
        let path = Self::db_path(workspace_root);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).ok();
        }
        let conn =
            Connection::open(&path).with_context(|| format!("open zocks db {}", path.display()))?;
        conn.execute_batch(&format!("PRAGMA key = \"x'{}'\";", hex::encode(key)))?;
        conn.busy_timeout(std::time::Duration::from_secs(5))?;
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS zocks_sessions (
                id                 TEXT PRIMARY KEY,
                session_id         TEXT NOT NULL,
                title              TEXT NOT NULL DEFAULT '',
                content_hash       TEXT NOT NULL,
                json               TEXT NOT NULL,
                fetched_at         TEXT NOT NULL,
                indexed_at         TEXT NOT NULL DEFAULT '',
                indexed_hash       TEXT NOT NULL DEFAULT '',
                matter_id          TEXT NOT NULL DEFAULT '',
                needs_assignment   INTEGER NOT NULL DEFAULT 0,
                assignment_reason  TEXT NOT NULL DEFAULT '',
                deleted            INTEGER NOT NULL DEFAULT 0
            );
             CREATE INDEX IF NOT EXISTS idx_zocks_sessions_session_id
                ON zocks_sessions(session_id);
             CREATE INDEX IF NOT EXISTS idx_zocks_sessions_indexed
                ON zocks_sessions(indexed_hash, content_hash);
             CREATE TABLE IF NOT EXISTS zocks_cursors (
                key     TEXT PRIMARY KEY,
                cursor  TEXT NOT NULL
            );",
        )?;
        Ok(Self {
            conn: std::sync::Mutex::new(conn),
            workspace_root: workspace_root.to_path_buf(),
        })
    }

    pub fn upsert_session(
        &self,
        id: &str,
        session_id: &str,
        title: &str,
        content_hash: &str,
        json: &str,
        matter_id: &str,
        needs_assignment: bool,
        assignment_reason: &str,
    ) -> Result<bool> {
        let c = self.conn.lock().unwrap();
        let existing: Option<String> = c
            .query_row(
                "SELECT content_hash FROM zocks_sessions WHERE id = ?1 AND deleted = 0",
                [id],
                |r| r.get(0),
            )
            .optional()?;
        c.execute(
            "INSERT INTO zocks_sessions
                (id, session_id, title, content_hash, json, fetched_at, matter_id,
                 needs_assignment, assignment_reason, deleted)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 0)
             ON CONFLICT(id) DO UPDATE SET
                session_id = ?2,
                title = ?3,
                content_hash = ?4,
                json = ?5,
                fetched_at = ?6,
                -- Reindex when EITHER the content OR the matched matter changes.
                -- `content_hash` / `matter_id` on the right-hand side are the
                -- pre-update (existing) row values; `?4` / `?7` are the new ones.
                -- If only the matter changed (content identical) the old code kept
                -- indexed_hash, so list_sessions_to_index() skipped the row and the
                -- RAG chunks stayed under the OLD matter (matter-isolation bug).
                indexed_hash = CASE
                    WHEN content_hash = ?4 AND matter_id = ?7 THEN indexed_hash
                    ELSE ''
                END,
                matter_id = ?7,
                needs_assignment = ?8,
                assignment_reason = ?9,
                deleted = 0",
            rusqlite::params![
                id,
                session_id,
                title,
                content_hash,
                json,
                chrono::Utc::now().to_rfc3339(),
                matter_id,
                needs_assignment as i64,
                assignment_reason
            ],
        )?;
        Ok(existing.as_deref() != Some(content_hash))
    }

    pub fn list_sessions_to_index(&self) -> Result<Vec<ZocksSessionRow>> {
        let c = self.conn.lock().unwrap();
        let mut stmt = c.prepare(
            "SELECT id, session_id, title, content_hash, json, indexed_hash, matter_id,
                    needs_assignment, assignment_reason
             FROM zocks_sessions
             WHERE deleted = 0 AND indexed_hash != content_hash
             ORDER BY fetched_at ASC",
        )?;
        let rows = stmt
            .query_map([], row_to_session)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    }

    pub fn mark_indexed(&self, id: &str, content_hash: &str, matter_id: &str) -> Result<()> {
        let c = self.conn.lock().unwrap();
        c.execute(
            "UPDATE zocks_sessions
             SET indexed_hash = ?2, indexed_at = ?3, matter_id = ?4
             WHERE id = ?1",
            rusqlite::params![id, content_hash, chrono::Utc::now().to_rfc3339(), matter_id],
        )?;
        Ok(())
    }

    pub fn get_session(&self, id: &str) -> Result<Option<ZocksSessionRow>> {
        let c = self.conn.lock().unwrap();
        c.query_row(
            "SELECT id, session_id, title, content_hash, json, indexed_hash, matter_id,
                    needs_assignment, assignment_reason
             FROM zocks_sessions WHERE id = ?1",
            [id],
            row_to_session,
        )
        .optional()
        .map_err(Into::into)
    }

    pub fn list_source_ids(&self) -> Result<Vec<String>> {
        let c = self.conn.lock().unwrap();
        let mut stmt = c.prepare("SELECT session_id FROM zocks_sessions")?;
        let ids = stmt
            .query_map([], |r| r.get::<_, String>(0))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(ids
            .into_iter()
            .map(|session_id| format!("zocks:{session_id}"))
            .collect())
    }

    /// `(store id, session id)` for every active (non-deleted) session. Used to
    /// find sessions that vanished from Zocks so they can be pruned.
    pub fn list_active(&self) -> Result<Vec<(String, String)>> {
        let c = self.conn.lock().unwrap();
        let mut stmt =
            c.prepare("SELECT id, session_id FROM zocks_sessions WHERE deleted = 0")?;
        let rows = stmt
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    }

    /// Soft-delete a session row by its store id (its RAG chunks are removed
    /// separately by the caller). Idempotent.
    pub fn mark_deleted(&self, id: &str) -> Result<()> {
        let c = self.conn.lock().unwrap();
        c.execute("UPDATE zocks_sessions SET deleted = 1 WHERE id = ?1", [id])?;
        Ok(())
    }

    pub fn list_unassigned(&self) -> Result<Vec<ZocksUnassignedRow>> {
        let c = self.conn.lock().unwrap();
        let mut stmt = c.prepare(
            "SELECT session_id, title, assignment_reason
             FROM zocks_sessions
             WHERE deleted = 0 AND needs_assignment = 1
             ORDER BY fetched_at DESC, session_id",
        )?;
        let rows = stmt
            .query_map([], |r| {
                let session_id: String = r.get(0)?;
                Ok(ZocksUnassignedRow {
                    source_id: format!("zocks:{session_id}"),
                    session_id,
                    title: r.get(1)?,
                    reason: r.get(2)?,
                })
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    }

    pub fn set_cursor(&self, key: &str, cursor: &str) -> Result<()> {
        let c = self.conn.lock().unwrap();
        c.execute(
            "INSERT INTO zocks_cursors (key, cursor) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET cursor = ?2",
            rusqlite::params![key, cursor],
        )?;
        Ok(())
    }

    pub fn get_cursor(&self, key: &str) -> Result<Option<String>> {
        let c = self.conn.lock().unwrap();
        c.query_row("SELECT cursor FROM zocks_cursors WHERE key = ?1", [key], |r| {
            r.get(0)
        })
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
        match keyring::Entry::new(ZOCKS_DB_KEYCHAIN_SERVICE, ZOCKS_DB_KEYCHAIN_KEY)
            .context("zocks db keychain entry")?
            .delete_credential()
        {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(anyhow::anyhow!("zocks db key delete: {e}")),
        }
    }
}

fn row_to_session(row: &rusqlite::Row<'_>) -> rusqlite::Result<ZocksSessionRow> {
    let needs: i64 = row.get(7)?;
    Ok(ZocksSessionRow {
        id: row.get(0)?,
        session_id: row.get(1)?,
        title: row.get(2)?,
        content_hash: row.get(3)?,
        json: row.get(4)?,
        indexed_hash: row.get(5)?,
        matter_id: row.get(6)?,
        needs_assignment: needs != 0,
        assignment_reason: row.get(8)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const KEY: [u8; 32] = [0x61; 32];

    #[test]
    fn unchanged_hash_does_not_require_reindex() {
        let dir = tempfile::tempdir().unwrap();
        let store = ZocksStore::open_with_key(dir.path(), &KEY).unwrap();
        assert!(store
            .upsert_session(
                "session:sess_1",
                "sess_1",
                "Review",
                "hash-1",
                "{}",
                "matter-a",
                false,
                "",
            )
            .unwrap());
        store
            .mark_indexed("session:sess_1", "hash-1", "matter-a")
            .unwrap();
        assert!(!store
            .upsert_session(
                "session:sess_1",
                "sess_1",
                "Review",
                "hash-1",
                "{}",
                "matter-a",
                false,
                "",
            )
            .unwrap());
        assert!(store.list_sessions_to_index().unwrap().is_empty());
    }

    #[test]
    fn matter_change_with_unchanged_content_requires_reindex() {
        // Matter-isolation: when a session's matched matter changes but its JSON
        // is byte-identical, the row must still be re-indexed so its RAG chunks
        // move from the old matter to the new one.
        let dir = tempfile::tempdir().unwrap();
        let store = ZocksStore::open_with_key(dir.path(), &KEY).unwrap();
        store
            .upsert_session(
                "session:sess_1", "sess_1", "Review", "hash-1", "{}", "matter-a", false, "",
            )
            .unwrap();
        store
            .mark_indexed("session:sess_1", "hash-1", "matter-a")
            .unwrap();
        assert!(store.list_sessions_to_index().unwrap().is_empty());

        // Same content_hash, different matter -> must reappear for indexing.
        store
            .upsert_session(
                "session:sess_1", "sess_1", "Review", "hash-1", "{}", "matter-b", false, "",
            )
            .unwrap();
        let to_index = store.list_sessions_to_index().unwrap();
        assert_eq!(to_index.len(), 1);
        assert_eq!(to_index[0].matter_id, "matter-b");
    }

    #[test]
    fn unassigned_list_round_trips_reason() {
        let dir = tempfile::tempdir().unwrap();
        let store = ZocksStore::open_with_key(dir.path(), &KEY).unwrap();
        store
            .upsert_session(
                "session:sess_1",
                "sess_1",
                "Unmatched review",
                "hash-1",
                "{}",
                "unassigned",
                true,
                "no matter matched participants or client name",
            )
            .unwrap();
        let rows = store.list_unassigned().unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].source_id, "zocks:sess_1");
        assert_eq!(rows[0].reason, "no matter matched participants or client name");
    }
}
