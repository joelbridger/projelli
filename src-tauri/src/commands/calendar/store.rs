//! Encrypted local store for synced calendar events (SQLCipher via PRAGMA key,
//! keychain-held 32-byte master key). Mirrors `calendly/store.rs`.

use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use rusqlite::Connection;

use super::model::CalendarEvent;

const CALENDAR_DB_KEYCHAIN_SERVICE: &str = crate::identity::CALENDAR_ENC_SERVICE;
const CALENDAR_DB_KEYCHAIN_KEY: &str = "master-key-v1";
const KEY_LEN: usize = 32;

#[derive(Debug, Clone)]
pub struct CalendarEventRow {
    pub id: String,
    pub content_hash: String,
    pub json: String,
    pub indexed_hash: String,
    /// Comma-joined matter ids this event was indexed under ('' if none yet).
    pub matter_ids: String,
    pub deleted: bool,
}

fn calendar_master_key() -> Result<[u8; KEY_LEN]> {
    let entry = keyring::Entry::new(CALENDAR_DB_KEYCHAIN_SERVICE, CALENDAR_DB_KEYCHAIN_KEY)
        .context("calendar db keychain entry")?;
    match entry.get_password() {
        Ok(hex) => {
            let bytes = hex::decode(hex.trim()).context("decode calendar master key hex")?;
            if bytes.len() != KEY_LEN {
                anyhow::bail!("stored calendar master key has wrong length: {}", bytes.len());
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
                .context("store calendar master key")?;
            Ok(k)
        }
        Err(e) => Err(anyhow::anyhow!("calendar keychain read: {e}")),
    }
}

pub struct CalendarStore {
    conn: std::sync::Mutex<Connection>,
    #[allow(dead_code)]
    workspace_root: PathBuf,
}

impl CalendarStore {
    pub fn db_path(workspace_root: &Path) -> PathBuf {
        workspace_root
            .join(crate::identity::WORKSPACE_DATA_DIR)
            .join("calendar-enc.db")
    }

    pub fn open(workspace_root: &Path) -> Result<Self> {
        let key = calendar_master_key()?;
        Self::open_with_key(workspace_root, &key)
    }

    pub fn open_with_key(workspace_root: &Path, key: &[u8; KEY_LEN]) -> Result<Self> {
        let path = Self::db_path(workspace_root);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).ok();
        }
        let conn = Connection::open(&path)
            .with_context(|| format!("open calendar enc db {}", path.display()))?;
        conn.execute_batch(&format!("PRAGMA key = \"x'{}'\";", hex::encode(key)))?;
        conn.busy_timeout(std::time::Duration::from_secs(5))?;
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS calendar_events (
                id             TEXT PRIMARY KEY,
                provider       TEXT NOT NULL,
                content_hash   TEXT NOT NULL,
                json           TEXT NOT NULL,
                start_utc      TEXT NOT NULL,
                end_utc        TEXT NOT NULL,
                fetched_at     TEXT NOT NULL,
                indexed_hash   TEXT NOT NULL DEFAULT '',
                matter_ids     TEXT NOT NULL DEFAULT '',
                deleted        INTEGER NOT NULL DEFAULT 0
            );
             CREATE INDEX IF NOT EXISTS idx_calendar_events_start
                ON calendar_events(start_utc);
             CREATE TABLE IF NOT EXISTS calendar_cursors (
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

    /// Insert or update. Returns true when the event needs (re)indexing:
    /// either the content hash changed, or the row was previously marked
    /// `deleted` (its RAG chunks were purged, so a resurrected event with an
    /// otherwise-unchanged hash still needs the index rebuilt — the
    /// `indexed_hash` bookkeeping is reset in that case, below). Times are
    /// normalized RFC3339 UTC.
    pub fn upsert_event(&self, event: &CalendarEvent, content_hash: &str) -> Result<bool> {
        let json = serde_json::to_string(event)?;
        let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true);
        let conn = self.conn.lock().unwrap();
        let existing: Option<(String, bool)> = conn
            .query_row(
                "SELECT content_hash, deleted FROM calendar_events WHERE id = ?1",
                [&event.id],
                |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)? != 0)),
            )
            .ok();
        let changed = match &existing {
            Some((hash, was_deleted)) => hash != content_hash || *was_deleted,
            None => true,
        };
        conn.execute(
            "INSERT INTO calendar_events
                (id, provider, content_hash, json, start_utc, end_utc, fetched_at, deleted)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 0)
             ON CONFLICT(id) DO UPDATE SET
                content_hash = excluded.content_hash,
                json         = excluded.json,
                start_utc    = excluded.start_utc,
                end_utc      = excluded.end_utc,
                fetched_at   = excluded.fetched_at,
                indexed_hash = CASE WHEN calendar_events.deleted = 1
                                    THEN '' ELSE calendar_events.indexed_hash END,
                deleted      = 0",
            rusqlite::params![
                event.id,
                event.provider.as_str(),
                content_hash,
                json,
                event.start_utc,
                event.end_utc,
                now
            ],
        )?;
        Ok(changed)
    }

    pub fn list_to_index(&self) -> Result<Vec<CalendarEventRow>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, content_hash, json, indexed_hash, matter_ids, deleted
             FROM calendar_events WHERE deleted = 0 AND indexed_hash != content_hash",
        )?;
        let rows = stmt
            .query_map([], row_from_sql)?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    pub fn list_in_window(&self, from_utc: &str, to_utc: &str) -> Result<Vec<CalendarEvent>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT json FROM calendar_events
             WHERE deleted = 0 AND start_utc < ?2 AND end_utc > ?1
             ORDER BY start_utc ASC",
        )?;
        let rows = stmt
            .query_map([from_utc, to_utc], |r| r.get::<_, String>(0))?
            .collect::<std::result::Result<Vec<String>, _>>()?;
        rows.into_iter()
            .map(|j| serde_json::from_str(&j).context("decode stored calendar event"))
            .collect()
    }

    pub fn mark_indexed(&self, id: &str, content_hash: &str, matter_ids_csv: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE calendar_events SET indexed_hash = ?2, matter_ids = ?3 WHERE id = ?1",
            rusqlite::params![id, content_hash, matter_ids_csv],
        )?;
        Ok(())
    }

    /// Mark this provider's rows inside the window that were NOT seen in the
    /// latest fetch as deleted; return them so the caller can purge RAG rows.
    pub fn mark_absent_deleted(
        &self,
        provider: &str,
        from_utc: &str,
        to_utc: &str,
        seen_ids: &[String],
    ) -> Result<Vec<CalendarEventRow>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, content_hash, json, indexed_hash, matter_ids, deleted
             FROM calendar_events
             WHERE deleted = 0 AND provider = ?1 AND start_utc < ?3 AND end_utc > ?2",
        )?;
        let candidates = stmt
            .query_map([provider, from_utc, to_utc], row_from_sql)?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        let seen: std::collections::HashSet<&str> =
            seen_ids.iter().map(String::as_str).collect();
        let mut gone = Vec::new();
        for row in candidates {
            if !seen.contains(row.id.as_str()) {
                conn.execute(
                    "UPDATE calendar_events SET deleted = 1 WHERE id = ?1",
                    [&row.id],
                )?;
                gone.push(row);
            }
        }
        Ok(gone)
    }

    pub fn set_cursor(&self, key: &str, cursor: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO calendar_cursors (key, cursor) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET cursor = excluded.cursor",
            [key, cursor],
        )?;
        Ok(())
    }

    pub fn get_cursor(&self, key: &str) -> Result<Option<String>> {
        let conn = self.conn.lock().unwrap();
        Ok(conn
            .query_row("SELECT cursor FROM calendar_cursors WHERE key = ?1", [key], |r| {
                r.get(0)
            })
            .ok())
    }

    /// The comma-joined matter ids this event was last indexed under, if
    /// any row exists. Read BEFORE `mark_indexed` overwrites it, so the
    /// caller can diff old vs. new matters and purge RAG rows for any
    /// matter the event no longer resolves to (a reassignment/re-teaching
    /// must not leave the meeting indexed under its old client forever).
    pub fn get_matter_ids(&self, id: &str) -> Result<Option<String>> {
        let conn = self.conn.lock().unwrap();
        Ok(conn
            .query_row("SELECT matter_ids FROM calendar_events WHERE id = ?1", [id], |r| {
                r.get(0)
            })
            .ok())
    }

    /// Every RAG source id this store has indexed: `calendar:<id>:<matter>`
    /// per matter in the row's csv. Used by disconnect/purge.
    pub fn list_indexed_rag_source_ids(&self) -> Result<Vec<String>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, matter_ids FROM calendar_events WHERE indexed_hash != '' AND matter_ids != ''",
        )?;
        let pairs = stmt
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?
            .collect::<std::result::Result<Vec<(String, String)>, _>>()?;
        let mut out = Vec::new();
        for (id, csv) in pairs {
            for matter in csv.split(',').filter(|m| !m.is_empty()) {
                out.push(format!("calendar:{id}:{matter}"));
            }
        }
        Ok(out)
    }

    /// Delete every row belonging to one provider: event rows and any
    /// delta-sync cursors keyed `"<provider>:..."`. Used when disconnecting
    /// a single provider while others remain connected (a full `purge()` of
    /// the whole store only runs when NO provider is left) — without this,
    /// a disconnected provider's events silently persist in the local store
    /// and can resurface via `list_in_window` / a later indexing pass.
    pub fn delete_provider_rows(&self, provider: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM calendar_events WHERE provider = ?1", [provider])?;
        conn.execute(
            "DELETE FROM calendar_cursors WHERE key = ?1 OR key LIKE ?2",
            [provider.to_string(), format!("{provider}:%")],
        )?;
        Ok(())
    }

    pub fn purge(workspace_root: &Path) -> Result<()> {
        let base = Self::db_path(workspace_root);
        for suffix in ["", "-wal", "-shm", "-journal"] {
            let p = PathBuf::from(format!("{}{}", base.display(), suffix));
            if p.exists() {
                std::fs::remove_file(&p)
                    .with_context(|| format!("remove {}", p.display()))?;
            }
        }
        Ok(())
    }

    pub fn delete_master_key() -> Result<()> {
        if let Ok(entry) =
            keyring::Entry::new(CALENDAR_DB_KEYCHAIN_SERVICE, CALENDAR_DB_KEYCHAIN_KEY)
        {
            let _ = entry.delete_credential();
        }
        Ok(())
    }
}

fn row_from_sql(r: &rusqlite::Row<'_>) -> rusqlite::Result<CalendarEventRow> {
    Ok(CalendarEventRow {
        id: r.get(0)?,
        content_hash: r.get(1)?,
        json: r.get(2)?,
        indexed_hash: r.get(3)?,
        matter_ids: r.get(4)?,
        deleted: r.get::<_, i64>(5)? != 0,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::calendar::model::{CalendarAttendee, CalendarProvider};

    const STORE_KEY: [u8; KEY_LEN] = [0x42; KEY_LEN];

    fn sample(id: &str, start: &str) -> CalendarEvent {
        CalendarEvent {
            id: id.into(),
            provider: CalendarProvider::Outlook,
            title: "Annual review".into(),
            description: "agenda".into(),
            start_utc: start.into(),
            end_utc: "2026-07-02T17:00:00Z".into(),
            attendees: vec![CalendarAttendee { email: "kim@x.com".into(), name: "Kim".into() }],
            organizer_email: "adv@firm.com".into(),
            is_cancelled: false,
            self_declined: false,
        }
    }

    #[test]
    fn upsert_reports_changed_then_unchanged_then_changed_again() {
        let dir = tempfile::tempdir().unwrap();
        let store = CalendarStore::open_with_key(dir.path(), &STORE_KEY).unwrap();
        let e = sample("outlook:e1", "2026-07-02T16:00:00Z");
        assert!(store.upsert_event(&e, "h1").unwrap(), "first insert is a change");
        assert!(!store.upsert_event(&e, "h1").unwrap(), "same hash is not a change");
        assert!(store.upsert_event(&e, "h2").unwrap(), "new hash is a change");
        // Changed rows come back for indexing until marked.
        let to_index = store.list_to_index().unwrap();
        assert_eq!(to_index.len(), 1);
        store.mark_indexed("outlook:e1", "h2", "m-1").unwrap();
        assert!(store.list_to_index().unwrap().is_empty());
    }

    #[test]
    fn get_matter_ids_returns_none_for_unknown_row_and_last_marked_value() {
        let dir = tempfile::tempdir().unwrap();
        let store = CalendarStore::open_with_key(dir.path(), &STORE_KEY).unwrap();
        assert_eq!(store.get_matter_ids("outlook:e1").unwrap(), None, "no row yet");
        let e = sample("outlook:e1", "2026-07-02T16:00:00Z");
        store.upsert_event(&e, "h1").unwrap();
        assert_eq!(store.get_matter_ids("outlook:e1").unwrap(), Some(String::new()), "not indexed yet");
        store.mark_indexed("outlook:e1", "h1", "m-hend").unwrap();
        assert_eq!(store.get_matter_ids("outlook:e1").unwrap(), Some("m-hend".to_string()));
    }

    #[test]
    fn resurrected_event_with_unchanged_hash_still_needs_reindex() {
        // A deleted-then-purged event that reappears with an IDENTICAL
        // content hash must still be reported as changed and re-queued for
        // indexing (codex-review P2: its RAG chunks were purged on delete,
        // so a hash-only check would silently leave them missing forever).
        let dir = tempfile::tempdir().unwrap();
        let store = CalendarStore::open_with_key(dir.path(), &STORE_KEY).unwrap();
        let e = sample("outlook:e1", "2026-07-02T16:00:00Z");
        store.upsert_event(&e, "h1").unwrap();
        store.mark_indexed("outlook:e1", "h1", "m-1").unwrap();
        assert!(store.list_to_index().unwrap().is_empty(), "fully indexed, nothing pending");

        store.mark_absent_deleted(
            "outlook",
            "2026-06-01T00:00:00Z",
            "2026-08-01T00:00:00Z",
            &[],
        ).unwrap();

        // Same event, same content hash, reappears in a later sync.
        assert!(
            store.upsert_event(&e, "h1").unwrap(),
            "resurrection with unchanged hash must still count as a change"
        );
        assert_eq!(store.list_to_index().unwrap().len(), 1, "queued for reindex");
    }

    #[test]
    fn delete_provider_rows_only_purges_that_providers_events_and_cursors() {
        let dir = tempfile::tempdir().unwrap();
        let store = CalendarStore::open_with_key(dir.path(), &STORE_KEY).unwrap();
        store.upsert_event(&sample("outlook:e1", "2026-07-02T16:00:00Z"), "h1").unwrap();
        let google_event = CalendarEvent {
            id: "google:g1".into(),
            provider: CalendarProvider::Google,
            ..sample("google:g1", "2026-07-02T16:00:00Z")
        };
        store.upsert_event(&google_event, "h1").unwrap();
        store.set_cursor("outlook:delta", "cursor-a").unwrap();
        store.set_cursor("google:delta", "cursor-b").unwrap();

        store.delete_provider_rows("outlook").unwrap();

        let remaining = store
            .list_in_window("2026-06-01T00:00:00Z", "2026-08-01T00:00:00Z")
            .unwrap();
        assert_eq!(remaining.len(), 1, "only the google event survives");
        assert_eq!(remaining[0].id, "google:g1");
        assert_eq!(store.get_cursor("outlook:delta").unwrap(), None, "outlook cursor purged");
        assert_eq!(
            store.get_cursor("google:delta").unwrap(),
            Some("cursor-b".into()),
            "google cursor untouched"
        );
    }

    #[test]
    fn window_query_returns_events_and_absent_marking_purges() {
        let dir = tempfile::tempdir().unwrap();
        let store = CalendarStore::open_with_key(dir.path(), &STORE_KEY).unwrap();
        store.upsert_event(&sample("outlook:e1", "2026-07-02T16:00:00Z"), "h1").unwrap();
        store.upsert_event(&sample("outlook:e2", "2026-07-03T16:00:00Z"), "h1").unwrap();
        store.mark_indexed("outlook:e2", "h1", "m-2").unwrap();

        let in_window = store
            .list_in_window("2026-07-01T00:00:00Z", "2026-07-10T00:00:00Z")
            .unwrap();
        assert_eq!(in_window.len(), 2);

        // e2 disappears from the provider's window fetch -> marked deleted and
        // returned (with matter ids) so the engine can purge its RAG rows.
        let gone = store
            .mark_absent_deleted(
                "outlook",
                "2026-07-01T00:00:00Z",
                "2026-07-10T00:00:00Z",
                &["outlook:e1".to_string()],
            )
            .unwrap();
        assert_eq!(gone.len(), 1);
        assert_eq!(gone[0].id, "outlook:e2");
        assert_eq!(gone[0].matter_ids, "m-2");
        assert_eq!(
            store.list_in_window("2026-07-01T00:00:00Z", "2026-07-10T00:00:00Z").unwrap().len(),
            1
        );
    }

    #[test]
    fn cursor_roundtrip_and_rag_source_ids() {
        let dir = tempfile::tempdir().unwrap();
        let store = CalendarStore::open_with_key(dir.path(), &STORE_KEY).unwrap();
        assert_eq!(store.get_cursor("google:delta").unwrap(), None);
        store.set_cursor("google:delta", "abc").unwrap();
        assert_eq!(store.get_cursor("google:delta").unwrap(), Some("abc".into()));

        store.upsert_event(&sample("google:g1", "2026-07-02T16:00:00Z"), "h1").unwrap();
        store.mark_indexed("google:g1", "h1", "m-1,m-2").unwrap();
        let mut ids = store.list_indexed_rag_source_ids().unwrap();
        ids.sort();
        assert_eq!(
            ids,
            vec!["calendar:google:g1:m-1".to_string(), "calendar:google:g1:m-2".to_string()]
        );
    }
}
