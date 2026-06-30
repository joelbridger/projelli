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
use serde::{Deserialize, Serialize};
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
    /// WS-B/C: provider this message came from ("m365" | "gmail" | "imap").
    /// Together with `account` + `folder_id` this is the mail-folder key a
    /// matter maps to. Defaults to "" on pre-mapping rows (a fresh sync fills it).
    pub provider: String,
    /// WS-B/C: account id within the provider (the mailbox). Part of the
    /// mail-folder key. Defaults to "" on pre-mapping rows.
    pub account: String,
    /// Searchable metadata columns — populated at sync time from the decrypted
    /// MailMessage. Already-synced messages keep empty defaults until the next
    /// sync; the list path never touches a blob.
    pub subject: String,
    pub from_addr: String,
    pub from_name: String,
    pub snippet: String,
    pub has_attachments: bool,
}

/// Map a `messages` row (in the canonical column order used by `get_record`)
/// to a `MailRecord`. Shared by both store implementations.
fn row_to_mail_record(r: &rusqlite::Row<'_>) -> rusqlite::Result<MailRecord> {
    let has_attachments_int: i64 = r.get(11)?;
    Ok(MailRecord {
        id: r.get(0)?,
        folder_id: r.get(1)?,
        internet_message_id: r.get(2)?,
        relative_path: r.get(3)?,
        received_date_time: r.get(4)?,
        provider: r.get(5)?,
        account: r.get(6)?,
        subject: r.get(7)?,
        from_addr: r.get(8)?,
        from_name: r.get(9)?,
        snippet: r.get(10)?,
        has_attachments: has_attachments_int != 0,
    })
}

// ---------------------------------------------------------------------------
// List query / result types
// ---------------------------------------------------------------------------

/// Query parameters for browsing / keyword-searching email metadata.
/// All user-supplied strings are FULLY PARAMETERIZED — never interpolated into SQL.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MailListQuery {
    /// Optional keyword to search across subject, from_addr, and from_name.
    pub keyword: Option<String>,
    pub folder_id: Option<String>,
    pub provider: Option<String>,
    pub account: Option<String>,
    /// ISO 8601 lower bound (inclusive) on received_date_time.
    pub date_from: Option<String>,
    /// ISO 8601 upper bound (inclusive) on received_date_time.
    pub date_to: Option<String>,
    pub has_attachments: Option<bool>,
    /// Column to sort by: "date" | "subject" | "from" (default: "date").
    pub sort_by: String,
    /// true = descending order.
    pub sort_desc: bool,
    pub limit: i64,
    pub offset: i64,
}

/// One row in a mail list response. Contains only metadata — no blob is ever
/// decrypted on the list path.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MailListItem {
    pub id: String,
    pub subject: String,
    pub from_addr: String,
    pub from_name: String,
    pub snippet: String,
    pub received_date_time: Option<String>,
    pub provider: String,
    pub account: String,
    pub folder_id: String,
    pub has_attachments: bool,
}

/// Paginated result of a `list_messages` call.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MailListPage {
    pub items: Vec<MailListItem>,
    /// Total matching rows (ignoring limit/offset) — for pagination UI.
    pub total: i64,
}

/// List message ids for a (provider, account, folder). An empty filter value
/// matches any value for that column (so an account-level mapping with an empty
/// `folder_id` returns every message in the account). Shared by both stores.
fn query_ids_in_folder(
    conn: &Connection,
    provider: &str,
    account: &str,
    folder_id: &str,
) -> Result<Vec<String>> {
    // `(?1 = '' OR provider = ?1)` makes an empty filter a wildcard without
    // needing dynamic SQL. Same for account + folder.
    let mut stmt = conn.prepare(
        "SELECT id FROM messages
         WHERE (?1 = '' OR provider = ?1)
           AND (?2 = '' OR account = ?2)
           AND (?3 = '' OR folder_id = ?3)",
    )?;
    let rows = stmt
        .query_map(rusqlite::params![provider, account, folder_id], |r| {
            r.get::<_, String>(0)
        })?
        .collect::<rusqlite::Result<Vec<String>>>()?;
    Ok(rows)
}

/// Escape LIKE special characters (`%`, `_`, `\`) in a user-supplied keyword
/// so it matches literally, not as a wildcard or escape prefix.
fn escape_like(kw: &str) -> String {
    let mut out = String::with_capacity(kw.len() + 4);
    for c in kw.chars() {
        match c {
            '\\' => out.push_str("\\\\"),
            '%' => out.push_str("\\%"),
            '_' => out.push_str("\\_"),
            other => out.push(other),
        }
    }
    out
}

/// Shared list/search implementation used by both store impls.
/// Builds a fully-parameterized query — user text is NEVER interpolated into SQL.
/// The list path NEVER touches an encrypted blob.
fn query_list_messages(conn: &Connection, q: &MailListQuery) -> Result<MailListPage> {
    let limit = q.limit.clamp(1, 200);
    let offset = q.offset.max(0);

    // Map sort_by to a whitelisted column name; default to received_date_time.
    let order_col = match q.sort_by.as_str() {
        "subject" => "subject",
        "from"    => "from_name",
        _         => "received_date_time",
    };
    let dir = if q.sort_desc { "DESC" } else { "ASC" };

    // Build WHERE clause fragments and a parallel params vec.
    // We use positional params (?1, ?2, …) but rusqlite's execute_named /
    // params! with Vec requires boxing; easiest is rusqlite::params_from_iter
    // with a Vec<Box<dyn ToSql>>.  We track the next param index manually.
    let mut conditions: Vec<String> = Vec::new();
    let mut params: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();
    let mut idx: usize = 1;

    // Keyword: case-insensitive LIKE against subject / from_addr / from_name.
    // The ESCAPE clause is mandatory when matching literal %, _, \.
    if let Some(ref kw) = q.keyword {
        if !kw.is_empty() {
            let pattern = format!("%{}%", escape_like(kw));
            conditions.push(format!(
                "(subject LIKE ?{idx} ESCAPE '\\' \
                  OR from_addr LIKE ?{idx} ESCAPE '\\' \
                  OR from_name LIKE ?{idx} ESCAPE '\\')"
            ));
            params.push(Box::new(pattern));
            idx += 1;
        }
    }
    if let Some(ref v) = q.folder_id {
        conditions.push(format!("folder_id = ?{idx}"));
        params.push(Box::new(v.clone()));
        idx += 1;
    }
    if let Some(ref v) = q.provider {
        conditions.push(format!("provider = ?{idx}"));
        params.push(Box::new(v.clone()));
        idx += 1;
    }
    if let Some(ref v) = q.account {
        conditions.push(format!("account = ?{idx}"));
        params.push(Box::new(v.clone()));
        idx += 1;
    }
    if let Some(ref v) = q.date_from {
        conditions.push(format!("received_date_time >= ?{idx}"));
        params.push(Box::new(v.clone()));
        idx += 1;
    }
    if let Some(ref v) = q.date_to {
        conditions.push(format!("received_date_time <= ?{idx}"));
        params.push(Box::new(v.clone()));
        idx += 1;
    }
    if let Some(att) = q.has_attachments {
        let att_val: i64 = if att { 1 } else { 0 };
        conditions.push(format!("has_attachments = ?{idx}"));
        params.push(Box::new(att_val));
        idx += 1;
    }

    let where_clause = if conditions.is_empty() {
        String::new()
    } else {
        format!("WHERE {}", conditions.join(" AND "))
    };

    // COUNT query — same WHERE, no LIMIT/OFFSET.
    let count_sql = format!("SELECT COUNT(*) FROM messages {where_clause}");
    let total: i64 = conn.query_row(
        &count_sql,
        rusqlite::params_from_iter(params.iter().map(|p| p.as_ref())),
        |r| r.get(0),
    )?;

    // Item query — ORDER BY whitelisted column, LIMIT/OFFSET are parameterized.
    let limit_idx = idx;
    let offset_idx = idx + 1;
    let items_sql = format!(
        "SELECT id, folder_id, internet_message_id, relative_path, received_date_time,
                provider, account, subject, from_addr, from_name, snippet, has_attachments
         FROM messages
         {where_clause}
         ORDER BY {order_col} {dir}
         LIMIT ?{limit_idx} OFFSET ?{offset_idx}"
    );
    params.push(Box::new(limit));
    params.push(Box::new(offset));

    let mut stmt = conn.prepare(&items_sql)?;
    let items = stmt
        .query_map(
            rusqlite::params_from_iter(params.iter().map(|p| p.as_ref())),
            |r| {
                let has_att: i64 = r.get(11)?;
                Ok(MailListItem {
                    id: r.get(0)?,
                    folder_id: r.get(1)?,
                    received_date_time: r.get(4)?,
                    provider: r.get(5)?,
                    account: r.get(6)?,
                    subject: r.get(7)?,
                    from_addr: r.get(8)?,
                    from_name: r.get(9)?,
                    snippet: r.get(10)?,
                    has_attachments: has_att != 0,
                })
            },
        )?
        .collect::<rusqlite::Result<Vec<MailListItem>>>()?;

    Ok(MailListPage { items, total })
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
    /// Fetch the full record for `id`, or `None` if absent. Used by the mail
    /// viewer to locate (and then decrypt) one stored message.
    fn get_record(&self, id: &str) -> Result<Option<MailRecord>>;
    /// List the message ids stored under a given (provider, account, folder).
    /// Used to re-tag a folder's mail to a matter in place. An empty `account`
    /// or `provider` filter matches any value for that column, so an
    /// account-level mapping (provider/account, empty folder) can re-tag every
    /// folder in that account.
    fn ids_in_folder(
        &self,
        provider: &str,
        account: &str,
        folder_id: &str,
    ) -> Result<Vec<String>>;
    /// Total number of tracked messages (useful for tests + diagnostics).
    fn count(&self) -> Result<i64>;
    /// Retrieve the per-folder MS Graph delta-link cursor, or `None` if not yet set.
    fn get_cursor(&self, folder_id: &str) -> Result<Option<String>>;
    /// Persist a per-folder cursor (upserts on conflict).
    fn set_cursor(&self, folder_id: &str, cursor: &str) -> Result<()>;
    /// Browse / keyword-search email metadata. NEVER decrypts a blob — all
    /// matching is done against the plaintext columns stored in the SQLCipher DB.
    fn list_messages(&self, q: &MailListQuery) -> Result<MailListPage>;
    /// BUG-013: the DURABLE per-message matter override (a manual "file to
    /// matter"), or `None` when the message has no manual filing. This is the
    /// source of truth that survives re-sync/re-index — unlike the RAG index,
    /// which a re-sync re-stamps from the folder mapping. Sync resolves this
    /// BEFORE indexing so a manual filing wins over the folder default.
    /// Default: no override store (the legacy plaintext store never holds one);
    /// `EncryptedMailStore` persists it in the `meta` table.
    fn get_message_matter(&self, _id: &str) -> Result<Option<String>> {
        Ok(None)
    }
}

/// `meta`-table key under which a message's durable matter override is stored.
/// Keyed by the provider message id (the part after `mail:`), so sync's
/// `messages` upsert never touches it. (BUG-013.)
pub fn message_matter_key(message_id: &str) -> String {
    format!("matter:{message_id}")
}

fn legacy_imap_message_id(current_id: &str) -> Option<String> {
    let (prefix_and_folder, uid) = current_id.rsplit_once(':')?;
    let (prefix, uidvalidity) = prefix_and_folder.rsplit_once(':')?;
    let (provider_and_account, _folder_key) = prefix.rsplit_once(':')?;
    if !provider_and_account.starts_with("imap:") {
        return None;
    }
    Some(format!("{provider_and_account}:{uidvalidity}:{uid}"))
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
        workspace_root.join(crate::identity::WORKSPACE_DATA_DIR).join("mail.db")
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
                received_date_time   TEXT,
                provider             TEXT NOT NULL DEFAULT '',
                account              TEXT NOT NULL DEFAULT '',
                subject              TEXT NOT NULL DEFAULT '',
                from_addr            TEXT NOT NULL DEFAULT '',
                from_name            TEXT NOT NULL DEFAULT '',
                snippet              TEXT NOT NULL DEFAULT '',
                has_attachments      INTEGER NOT NULL DEFAULT 0
            );
             CREATE TABLE IF NOT EXISTS folder_cursors (
                folder_id  TEXT PRIMARY KEY,
                cursor     TEXT NOT NULL
            );
             CREATE INDEX IF NOT EXISTS idx_messages_date
                ON messages(received_date_time);",
        )?;
        migrate_message_columns(&conn);
        Ok(Self {
            conn: std::sync::Mutex::new(conn),
        })
    }
}

/// Idempotent migration: add new columns to the `messages` table.
/// `ALTER TABLE ADD COLUMN` errors when the column already exists, so we
/// silently ignore each error (SQLite has no `ADD COLUMN IF NOT EXISTS`).
fn migrate_message_columns(conn: &Connection) {
    let _ = conn.execute(
        "ALTER TABLE messages ADD COLUMN provider TEXT NOT NULL DEFAULT ''",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE messages ADD COLUMN account TEXT NOT NULL DEFAULT ''",
        [],
    );
    // Searchable metadata columns (mail-browse surface). Already-synced rows
    // keep empty defaults until the next sync touches them.
    let _ = conn.execute(
        "ALTER TABLE messages ADD COLUMN subject TEXT NOT NULL DEFAULT ''",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE messages ADD COLUMN from_addr TEXT NOT NULL DEFAULT ''",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE messages ADD COLUMN from_name TEXT NOT NULL DEFAULT ''",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE messages ADD COLUMN snippet TEXT NOT NULL DEFAULT ''",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE messages ADD COLUMN has_attachments INTEGER NOT NULL DEFAULT 0",
        [],
    );
}

impl MailStore for SqliteMailStore {
    fn upsert(&self, rec: &MailRecord) -> Result<()> {
        let c = self.conn.lock().unwrap();
        c.execute(
            "INSERT INTO messages
                (id, folder_id, internet_message_id, relative_path, received_date_time,
                 provider, account, subject, from_addr, from_name, snippet, has_attachments)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
             ON CONFLICT(id) DO UPDATE SET
                folder_id           = ?2,
                internet_message_id = ?3,
                relative_path       = ?4,
                received_date_time  = ?5,
                provider            = ?6,
                account             = ?7,
                subject             = ?8,
                from_addr           = ?9,
                from_name           = ?10,
                snippet             = ?11,
                has_attachments     = ?12",
            rusqlite::params![
                rec.id,
                rec.folder_id,
                rec.internet_message_id,
                rec.relative_path,
                rec.received_date_time,
                rec.provider,
                rec.account,
                rec.subject,
                rec.from_addr,
                rec.from_name,
                rec.snippet,
                rec.has_attachments as i64,
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

    fn get_record(&self, id: &str) -> Result<Option<MailRecord>> {
        let c = self.conn.lock().unwrap();
        let rec = c
            .query_row(
                "SELECT id, folder_id, internet_message_id, relative_path, received_date_time,
                        provider, account, subject, from_addr, from_name, snippet, has_attachments
                 FROM messages WHERE id = ?1",
                [id],
                row_to_mail_record,
            )
            .ok();
        Ok(rec)
    }

    fn ids_in_folder(
        &self,
        provider: &str,
        account: &str,
        folder_id: &str,
    ) -> Result<Vec<String>> {
        let c = self.conn.lock().unwrap();
        query_ids_in_folder(&c, provider, account, folder_id)
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

    fn list_messages(&self, q: &MailListQuery) -> Result<MailListPage> {
        let c = self.conn.lock().unwrap();
        query_list_messages(&c, q)
    }
}

// ---------------------------------------------------------------------------
// EncryptedMailStore — SQLCipher metadata + encrypted blob helpers (Group G2)
// ---------------------------------------------------------------------------

use crate::commands::mail::crypto::{decrypt_with_key, encrypt_with_key};
use sha2::{Digest, Sha256};

pub struct EncryptedMailStore {
    conn: std::sync::Mutex<Connection>,
    workspace_root: PathBuf,
}

/// Collision-safe encrypted body filename. The original provider id stays in
/// SQL; the filesystem only sees this fixed-width digest.
pub(crate) fn encrypted_blob_filename(provider: &str, account: &str, id: &str) -> String {
    let mut h = Sha256::new();
    h.update(provider.as_bytes());
    h.update([0]);
    h.update(account.as_bytes());
    h.update([0]);
    h.update(id.as_bytes());
    format!("{}.enc", hex::encode(h.finalize()))
}

pub(crate) fn encrypted_blob_relative_path(provider: &str, account: &str, id: &str) -> String {
    format!(
        "{}/mail/blobs/{}",
        crate::identity::WORKSPACE_DATA_DIR,
        encrypted_blob_filename(provider, account, id)
    )
}

impl EncryptedMailStore {
    /// Canonical path for the encrypted mail DB.
    pub fn db_path(workspace_root: &Path) -> PathBuf {
        workspace_root.join(crate::identity::WORKSPACE_DATA_DIR).join("mail-enc.db")
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

        // Two connections can now write concurrently (the sync loop upserts
        // records while a spawned index task sets the `rag_backfill_needed`
        // meta marker). Without a busy timeout the second writer fails
        // immediately with "database is locked"; wait briefly instead.
        conn.busy_timeout(std::time::Duration::from_secs(5))?;

        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS messages (
                id                   TEXT PRIMARY KEY,
                folder_id            TEXT NOT NULL,
                internet_message_id  TEXT,
                relative_path        TEXT NOT NULL,
                received_date_time   TEXT,
                provider             TEXT NOT NULL DEFAULT '',
                account              TEXT NOT NULL DEFAULT '',
                subject              TEXT NOT NULL DEFAULT '',
                from_addr            TEXT NOT NULL DEFAULT '',
                from_name            TEXT NOT NULL DEFAULT '',
                snippet              TEXT NOT NULL DEFAULT '',
                has_attachments      INTEGER NOT NULL DEFAULT 0
            );
             CREATE TABLE IF NOT EXISTS folder_cursors (
                folder_id  TEXT PRIMARY KEY,
                cursor     TEXT NOT NULL
            );
             CREATE TABLE IF NOT EXISTS meta (
                key    TEXT PRIMARY KEY,
                value  TEXT NOT NULL
            );
             CREATE INDEX IF NOT EXISTS idx_messages_date
                ON messages(received_date_time);",
        )?;
        migrate_message_columns(&conn);
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

    /// Encrypt `plaintext` and write to `.keepance/mail/blobs/<sha256>.enc`
    /// (relative to `workspace_root`). Returns the relative path.
    pub fn write_blob_with_key(
        &self,
        id: &str,
        plaintext: &[u8],
        key: &[u8; 32],
    ) -> Result<String> {
        let rel = encrypted_blob_relative_path("", "", id);
        let abs = self.workspace_root.join(&rel);
        if let Some(parent) = abs.parent() {
            std::fs::create_dir_all(parent).context("create blobs dir")?;
        }
        let encrypted = encrypt_with_key(plaintext, key)?;
        std::fs::write(&abs, &encrypted)
            .with_context(|| format!("write blob {}", abs.display()))?;
        Ok(rel)
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

    // -- meta: tiny key-value table for persistent per-workspace flags --------
    // (e.g. the `rag_backfill_needed` marker set when mail is imported while
    // the embedding model is still downloading; see mail_backfill_rag.)

    /// Read one meta value, or `None` if the key is not set.
    ///
    /// Absence vs failure: a missing row is `Ok(None)`; a real DB error (e.g.
    /// SQLITE_BUSY surviving the busy timeout) is `Err`. Callers must never
    /// read "the DB is broken" as "the marker is absent" — the backfill probe
    /// skips its pass on Err instead of wrongly concluding there is no work.
    pub fn get_meta(&self, key: &str) -> Result<Option<String>> {
        use rusqlite::OptionalExtension;
        let c = self.conn.lock().unwrap();
        Ok(c.query_row("SELECT value FROM meta WHERE key = ?1", [key], |r| {
            r.get(0)
        })
        .optional()?)
    }

    /// Set (upsert) one meta value. Idempotent.
    pub fn set_meta(&self, key: &str, value: &str) -> Result<()> {
        let c = self.conn.lock().unwrap();
        c.execute(
            "INSERT INTO meta (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = ?2",
            rusqlite::params![key, value],
        )?;
        Ok(())
    }

    /// Remove one meta value. No-op when absent.
    pub fn delete_meta(&self, key: &str) -> Result<()> {
        let c = self.conn.lock().unwrap();
        c.execute("DELETE FROM meta WHERE key = ?1", [key])?;
        Ok(())
    }

    // -- per-message matter override (BUG-013) --------------------------------
    // Durable manual "file to matter", stored in `meta` (keyed by message id) so
    // sync's `messages` upsert never overwrites it. This is the source of truth
    // the viewer reads and sync/backfill honour over the folder mapping.

    /// Persist (upsert) a message's manual matter filing. Idempotent.
    pub fn set_message_matter(&self, message_id: &str, matter_id: &str) -> Result<()> {
        self.set_meta(&message_matter_key(message_id), matter_id)
    }

    /// Clear a message's manual matter filing (unfile). No-op when absent.
    pub fn clear_message_matter(&self, message_id: &str) -> Result<()> {
        self.delete_meta(&message_matter_key(message_id))
    }

    /// Re-file EVERY message that was manually filed to a now-deleted matter as
    /// `UNASSIGNED_MATTER` (BUG-042). Returns how many filings were changed.
    ///
    /// Why a tombstone (set to "unassigned") and NOT a plain delete: deleting the
    /// override would make the next sync fall back to the message's FOLDER matter
    /// — so an email filed to deleted matter A, but living in a folder mapped to
    /// a different live matter B, would silently move into B. For a legal tool
    /// that must never happen. Writing an explicit "unassigned" tombstone (which
    /// `resolve_effective_matter` honors and does NOT re-absorb into the folder)
    /// guarantees a deleted matter's emails become unassigned, never another
    /// matter's. (A later manual re-file overwrites the tombstone normally.)
    ///
    /// Scoped precisely: only the `matter:<message_id>` override family
    /// (`message_matter_key`) whose value is this matter id — never any other
    /// `meta` row.
    pub fn clear_message_matter_for_matter(&self, matter_id: &str) -> Result<usize> {
        let c = self.conn.lock().unwrap();
        let changed = c.execute(
            "UPDATE meta SET value = ?2 WHERE key LIKE 'matter:%' AND value = ?1",
            rusqlite::params![matter_id, crate::commands::rag::store::UNASSIGNED_MATTER],
        )?;
        Ok(changed)
    }
}

impl MailStore for EncryptedMailStore {
    /// BUG-013: read the durable per-message matter override from `meta`.
    fn get_message_matter(&self, id: &str) -> Result<Option<String>> {
        if let Some(matter) = self.get_meta(&message_matter_key(id))? {
            return Ok(Some(matter));
        }
        if let Some(legacy_id) = legacy_imap_message_id(id) {
            return self.get_meta(&message_matter_key(&legacy_id));
        }
        Ok(None)
    }

    fn upsert(&self, rec: &MailRecord) -> Result<()> {
        let c = self.conn.lock().unwrap();
        c.execute(
            "INSERT INTO messages
                (id, folder_id, internet_message_id, relative_path, received_date_time,
                 provider, account, subject, from_addr, from_name, snippet, has_attachments)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
             ON CONFLICT(id) DO UPDATE SET
                folder_id           = ?2,
                internet_message_id = ?3,
                relative_path       = ?4,
                received_date_time  = ?5,
                provider            = ?6,
                account             = ?7,
                subject             = ?8,
                from_addr           = ?9,
                from_name           = ?10,
                snippet             = ?11,
                has_attachments     = ?12",
            rusqlite::params![
                rec.id, rec.folder_id, rec.internet_message_id,
                rec.relative_path, rec.received_date_time, rec.provider, rec.account,
                rec.subject, rec.from_addr, rec.from_name, rec.snippet,
                rec.has_attachments as i64,
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

    fn get_record(&self, id: &str) -> Result<Option<MailRecord>> {
        let c = self.conn.lock().unwrap();
        let rec = c
            .query_row(
                "SELECT id, folder_id, internet_message_id, relative_path, received_date_time,
                        provider, account, subject, from_addr, from_name, snippet, has_attachments
                 FROM messages WHERE id = ?1",
                [id],
                row_to_mail_record,
            )
            .ok();
        Ok(rec)
    }

    fn ids_in_folder(
        &self,
        provider: &str,
        account: &str,
        folder_id: &str,
    ) -> Result<Vec<String>> {
        let c = self.conn.lock().unwrap();
        query_ids_in_folder(&c, provider, account, folder_id)
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

    fn list_messages(&self, q: &MailListQuery) -> Result<MailListPage> {
        let c = self.conn.lock().unwrap();
        query_list_messages(&c, q)
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

    fn enc_store() -> (TempDir, EncryptedMailStore) {
        let dir = TempDir::new().unwrap();
        let key = [0x42u8; 32]; // deterministic test key, bypasses keychain
        let s = EncryptedMailStore::open_with_key(dir.path(), &key).expect("enc open");
        (dir, s)
    }

    /// Minimal `MailRecord` with all new fields defaulted — mirrors how
    /// pre-backfill rows look after `migrate_message_columns` fills defaults.
    fn mk_rec(id: &str, folder: &str, provider: &str, account: &str) -> MailRecord {
        MailRecord {
            id: id.into(),
            folder_id: folder.into(),
            internet_message_id: None,
            relative_path: format!("{}/mail/blobs/{}.enc", crate::identity::WORKSPACE_DATA_DIR, id),
            received_date_time: None,
            provider: provider.into(),
            account: account.into(),
            subject: String::new(),
            from_addr: String::new(),
            from_name: String::new(),
            snippet: String::new(),
            has_attachments: false,
        }
    }

    /// `MailRecord` with all searchable columns populated.
    fn mk_full(
        id: &str,
        folder: &str,
        provider: &str,
        account: &str,
        subject: &str,
        from_addr: &str,
        from_name: &str,
        snippet: &str,
        date: &str,
        has_att: bool,
    ) -> MailRecord {
        MailRecord {
            id: id.into(),
            folder_id: folder.into(),
            internet_message_id: None,
            relative_path: format!("{}/mail/blobs/{}.enc", crate::identity::WORKSPACE_DATA_DIR, id),
            received_date_time: Some(date.into()),
            provider: provider.into(),
            account: account.into(),
            subject: subject.into(),
            from_addr: from_addr.into(),
            from_name: from_name.into(),
            snippet: snippet.into(),
            has_attachments: has_att,
        }
    }

    fn default_query() -> MailListQuery {
        MailListQuery {
            keyword: None,
            folder_id: None,
            provider: None,
            account: None,
            date_from: None,
            date_to: None,
            has_attachments: None,
            sort_by: "date".into(),
            sort_desc: true,
            limit: 50,
            offset: 0,
        }
    }

    // -----------------------------------------------------------------------
    // Existing tests — updated for new MailRecord fields
    // -----------------------------------------------------------------------

    #[test]
    fn upsert_is_idempotent_by_id() {
        let (_d, s) = store();
        let rec = MailRecord {
            id: "m1".into(),
            folder_id: "inbox".into(),
            internet_message_id: Some("<x@y>".into()),
            relative_path: "Mail/inbox/m1.md".into(),
            received_date_time: Some("2026-05-01T00:00:00Z".into()),
            provider: "m365".into(),
            account: "default".into(),
            subject: "Hello".into(),
            from_addr: "alice@example.com".into(),
            from_name: "Alice".into(),
            snippet: "How are you?".into(),
            has_attachments: false,
        };
        s.upsert(&rec).unwrap();
        s.upsert(&rec).unwrap(); // replay must not duplicate
        assert_eq!(s.count().unwrap(), 1);
        assert!(s.contains("m1").unwrap());
        // get_record round-trips the new provider/account columns.
        let got = s.get_record("m1").unwrap().expect("record present");
        assert_eq!(got.provider, "m365");
        assert_eq!(got.account, "default");
        assert_eq!(got.folder_id, "inbox");
        // Also verify the new searchable columns round-trip.
        assert_eq!(got.subject, "Hello");
        assert_eq!(got.from_addr, "alice@example.com");
        assert_eq!(got.from_name, "Alice");
        assert_eq!(got.snippet, "How are you?");
        assert!(!got.has_attachments);
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
            provider: "m365".into(),
            account: "default".into(),
            subject: String::new(),
            from_addr: String::new(),
            from_name: String::new(),
            snippet: String::new(),
            has_attachments: false,
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

    #[test]
    fn enc_upsert_is_idempotent_by_id() {
        let (_d, s) = enc_store();
        let rec = MailRecord {
            id: "m1".into(), folder_id: "inbox".into(),
            internet_message_id: Some("<x@y>".into()),
            relative_path: format!("{}/mail/blobs/m1.enc", crate::identity::WORKSPACE_DATA_DIR),
            received_date_time: Some("2026-05-01T00:00:00Z".into()),
            provider: "m365".into(), account: "default".into(),
            subject: String::new(), from_addr: String::new(),
            from_name: String::new(), snippet: String::new(),
            has_attachments: false,
        };
        s.upsert(&rec).unwrap();
        s.upsert(&rec).unwrap();
        assert_eq!(s.count().unwrap(), 1);
        assert!(s.contains("m1").unwrap());
        // get_record round-trips through the SQLCipher store too.
        let got = s.get_record("m1").unwrap().expect("record present");
        assert_eq!(got.provider, "m365");
        assert_eq!(got.account, "default");
    }

    #[test]
    fn enc_ids_in_folder_filters_by_provider_account_folder() {
        let (_d, s) = enc_store();
        s.upsert(&mk_rec("a", "inbox", "m365", "default")).unwrap();
        s.upsert(&mk_rec("b", "inbox", "m365", "default")).unwrap();
        s.upsert(&mk_rec("c", "sent", "m365", "default")).unwrap();
        s.upsert(&mk_rec("d", "INBOX", "gmail", "default")).unwrap();

        // Exact (provider, account, folder).
        let mut inbox = s.ids_in_folder("m365", "default", "inbox").unwrap();
        inbox.sort();
        assert_eq!(inbox, vec!["a", "b"]);

        // Account-level (empty folder) returns every folder in that account.
        let mut acct = s.ids_in_folder("m365", "default", "").unwrap();
        acct.sort();
        assert_eq!(acct, vec!["a", "b", "c"]);

        // Different provider is isolated.
        assert_eq!(s.ids_in_folder("gmail", "default", "INBOX").unwrap(), vec!["d"]);
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
            provider: "m365".into(), account: "default".into(),
            subject: String::new(), from_addr: String::new(),
            from_name: String::new(), snippet: String::new(),
            has_attachments: false,
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
    fn enc_meta_roundtrips_and_deletes() {
        let (_d, s) = enc_store();
        // Absent key reads as None.
        assert_eq!(s.get_meta("rag_backfill_needed").unwrap(), None);
        // Set + read back.
        s.set_meta("rag_backfill_needed", "1").unwrap();
        assert_eq!(
            s.get_meta("rag_backfill_needed").unwrap().as_deref(),
            Some("1")
        );
        // Upsert is idempotent and last-writer-wins.
        s.set_meta("rag_backfill_needed", "1").unwrap();
        s.set_meta("rag_backfill_needed", "2").unwrap();
        assert_eq!(
            s.get_meta("rag_backfill_needed").unwrap().as_deref(),
            Some("2")
        );
        // Delete clears it; deleting again is a no-op.
        s.delete_meta("rag_backfill_needed").unwrap();
        assert_eq!(s.get_meta("rag_backfill_needed").unwrap(), None);
        s.delete_meta("rag_backfill_needed").unwrap();
    }

    #[test]
    fn enc_message_matter_override_roundtrips_and_survives_upsert_and_reopen() {
        // BUG-013: the durable per-message matter filing must (a) round-trip,
        // (b) be UNAFFECTED by a sync `upsert` of the same message (it lives in
        // `meta`, not `messages`), and (c) survive close + reopen.
        let dir = TempDir::new().unwrap();
        let key = [0x33u8; 32];
        {
            let s = EncryptedMailStore::open_with_key(dir.path(), &key).unwrap();
            // Absent => None (not filed).
            assert_eq!(s.get_message_matter("AAMk-1").unwrap(), None);
            // Set + read back; re-file overwrites.
            s.set_message_matter("AAMk-1", "matter-acme").unwrap();
            assert_eq!(s.get_message_matter("AAMk-1").unwrap().as_deref(), Some("matter-acme"));
            s.set_message_matter("AAMk-1", "matter-globex").unwrap();
            assert_eq!(s.get_message_matter("AAMk-1").unwrap().as_deref(), Some("matter-globex"));

            // The clobber guard: a sync upsert of the SAME message must NOT touch
            // the override (this is what makes a manual filing survive re-sync).
            s.upsert(&MailRecord {
                id: "AAMk-1".into(),
                folder_id: "inbox".into(),
                internet_message_id: None,
                relative_path: "x.enc".into(),
                received_date_time: None,
                provider: "m365".into(),
                account: "default".into(),
                subject: "s".into(),
                from_addr: "a@b.c".into(),
                from_name: "A".into(),
                snippet: String::new(),
                has_attachments: false,
            })
            .unwrap();
            assert_eq!(s.get_message_matter("AAMk-1").unwrap().as_deref(), Some("matter-globex"));

            // Clear (unfile) is idempotent.
            s.clear_message_matter("AAMk-1").unwrap();
            assert_eq!(s.get_message_matter("AAMk-1").unwrap(), None);
            s.clear_message_matter("AAMk-1").unwrap();

            // Persist a different message for the reopen check below.
            s.set_message_matter("AAMk-2", "matter-acme").unwrap();
        }
        // Survives close + reopen with the same key (durable across restarts).
        let s2 = EncryptedMailStore::open_with_key(dir.path(), &key).unwrap();
        assert_eq!(s2.get_message_matter("AAMk-2").unwrap().as_deref(), Some("matter-acme"));
    }

    #[test]
    fn enc_message_matter_reads_legacy_imap_override_after_folder_scoped_id_change() {
        let (_dir, s) = enc_store();
        s.set_message_matter("imap:lawyer@example.com:123:42", "matter-acme").unwrap();

        let current_id = "imap:lawyer@example.com:494e424f58:123:42";
        assert_eq!(
            s.get_message_matter(current_id).unwrap().as_deref(),
            Some("matter-acme"),
            "new folder-scoped IMAP ids must still see old per-message matter overrides"
        );
    }

    #[test]
    fn enc_clear_message_matter_for_matter_tombstones_only_that_matters_filings() {
        // BUG-042: deleting a matter must re-file EVERY message filed to it as
        // "unassigned" (a tombstone), so the next sync can't (a) resurface them
        // tagged with a matter that no longer exists, nor (b) silently absorb
        // them into their folder's matter. It must NOT touch filings for OTHER
        // matters, nor any unrelated `meta` row (e.g. the rag-backfill marker).
        let unassigned = crate::commands::rag::store::UNASSIGNED_MATTER;
        let (_dir, s) = enc_store();
        s.set_message_matter("MSG-1", "matter-acme").unwrap();
        s.set_message_matter("MSG-2", "matter-acme").unwrap();
        s.set_message_matter("MSG-3", "matter-globex").unwrap();
        s.set_meta("rag_backfill_needed", "1").unwrap();

        let changed = s.clear_message_matter_for_matter("matter-acme").unwrap();
        assert_eq!(changed, 2, "both acme filings tombstoned");

        // The two acme filings are now explicit "unassigned" tombstones (NOT
        // deleted — a plain delete would let them fall back to the folder matter).
        assert_eq!(s.get_message_matter("MSG-1").unwrap().as_deref(), Some(unassigned));
        assert_eq!(s.get_message_matter("MSG-2").unwrap().as_deref(), Some(unassigned));
        // ...the other matter's filing is untouched...
        assert_eq!(s.get_message_matter("MSG-3").unwrap().as_deref(), Some("matter-globex"));
        // ...and an unrelated meta row is untouched.
        assert_eq!(s.get_meta("rag_backfill_needed").unwrap().as_deref(), Some("1"));

        // Idempotent: the now-"unassigned" rows no longer match this matter id.
        assert_eq!(s.clear_message_matter_for_matter("matter-acme").unwrap(), 0);
    }

    #[test]
    fn enc_meta_survives_close_and_reopen() {
        // The marker must be persistent: set it, close, reopen with the same
        // key, and it must still be there (this is what makes the backfill
        // heal across app restarts).
        let dir = TempDir::new().unwrap();
        let key = [0x77u8; 32];
        {
            let s = EncryptedMailStore::open_with_key(dir.path(), &key).unwrap();
            s.set_meta("rag_backfill_needed", "1").unwrap();
        }
        let s2 = EncryptedMailStore::open_with_key(dir.path(), &key).unwrap();
        assert_eq!(
            s2.get_meta("rag_backfill_needed").unwrap().as_deref(),
            Some("1")
        );
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
        assert!(rel.starts_with(&format!("{}/mail/blobs/", crate::identity::WORKSPACE_DATA_DIR)));
        assert!(!rel.contains(".."));
    }

    #[test]
    fn write_blob_paths_are_collision_safe_for_punctuation_ids() {
        let (_d, s) = enc_store();
        let key = [0x42u8; 32];
        let ids = ["a/b", "a_b", "a:b", "a@b"];
        let mut rels = std::collections::HashSet::new();

        for id in ids {
            let rel = s.write_blob_with_key(id, id.as_bytes(), &key).unwrap();
            assert!(rels.insert(rel.clone()), "{id} reused blob path {rel}");
        }

        assert_eq!(rels.len(), ids.len());
    }

    #[test]
    fn encrypted_blob_path_includes_provider_and_account_in_digest() {
        let same_id = "same-remote-id";
        let gmail = encrypted_blob_relative_path("gmail", "acct-a", same_id);
        let m365 = encrypted_blob_relative_path("m365", "acct-a", same_id);
        let other_account = encrypted_blob_relative_path("gmail", "acct-b", same_id);

        assert_ne!(gmail, m365);
        assert_ne!(gmail, other_account);
        assert!(gmail.starts_with(".keepance/mail/blobs/"));
        assert!(gmail.ends_with(".enc"));
    }

    #[test]
    fn sqlcipher_db_not_readable_as_plain_sqlite() {
        // Verify the DB file is NOT plain SQLite — the header must not match.
        let (dir, s) = enc_store();
        // Write something to ensure the DB is non-empty.
        s.upsert(&mk_rec("hdr-check", "f", "m365", "default")).unwrap();
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
                relative_path: format!("{}/mail/blobs/persisted.enc", crate::identity::WORKSPACE_DATA_DIR),
                received_date_time: Some("2026-06-06T00:00:00Z".into()),
                provider: "m365".into(), account: "default".into(),
                subject: String::new(), from_addr: String::new(),
                from_name: String::new(), snippet: String::new(),
                has_attachments: false,
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
        let rec = mk_rec("regression-check", "f1", "", "");
        s.upsert(&rec).unwrap();
        assert!(s.contains("regression-check").unwrap());
        assert_eq!(s.count().unwrap(), 1);
    }

    // -----------------------------------------------------------------------
    // list_messages tests (SqliteMailStore)
    // -----------------------------------------------------------------------

    #[test]
    fn list_sort_by_date_asc_and_desc() {
        let (_d, s) = store();
        s.upsert(&mk_full("a", "inbox", "m365", "def", "Alpha", "a@x", "Alice",
            "snip", "2026-01-01T00:00:00Z", false)).unwrap();
        s.upsert(&mk_full("b", "inbox", "m365", "def", "Beta", "b@x", "Bob",
            "snip", "2026-03-01T00:00:00Z", false)).unwrap();
        s.upsert(&mk_full("c", "inbox", "m365", "def", "Gamma", "c@x", "Carol",
            "snip", "2026-02-01T00:00:00Z", false)).unwrap();

        // Ascending by date.
        let page = s.list_messages(&MailListQuery { sort_desc: false, ..default_query() }).unwrap();
        let ids: Vec<&str> = page.items.iter().map(|i| i.id.as_str()).collect();
        assert_eq!(ids, vec!["a", "c", "b"]);
        assert_eq!(page.total, 3);

        // Descending by date (newest first).
        let page2 = s.list_messages(&MailListQuery { sort_desc: true, ..default_query() }).unwrap();
        let ids2: Vec<&str> = page2.items.iter().map(|i| i.id.as_str()).collect();
        assert_eq!(ids2, vec!["b", "c", "a"]);
    }

    #[test]
    fn list_sort_by_subject_asc_and_desc() {
        let (_d, s) = store();
        s.upsert(&mk_full("a", "inbox", "m365", "def", "Zebra", "a@x", "Alice",
            "", "2026-01-01T00:00:00Z", false)).unwrap();
        s.upsert(&mk_full("b", "inbox", "m365", "def", "Apple", "b@x", "Bob",
            "", "2026-02-01T00:00:00Z", false)).unwrap();
        s.upsert(&mk_full("c", "inbox", "m365", "def", "Mango", "c@x", "Carol",
            "", "2026-03-01T00:00:00Z", false)).unwrap();

        let q_asc = MailListQuery { sort_by: "subject".into(), sort_desc: false, ..default_query() };
        let page = s.list_messages(&q_asc).unwrap();
        let ids: Vec<&str> = page.items.iter().map(|i| i.id.as_str()).collect();
        assert_eq!(ids, vec!["b", "c", "a"]); // Apple, Mango, Zebra

        let q_desc = MailListQuery { sort_by: "subject".into(), sort_desc: true, ..default_query() };
        let page2 = s.list_messages(&q_desc).unwrap();
        let ids2: Vec<&str> = page2.items.iter().map(|i| i.id.as_str()).collect();
        assert_eq!(ids2, vec!["a", "c", "b"]); // Zebra, Mango, Apple
    }

    #[test]
    fn list_sort_by_from_asc_and_desc() {
        let (_d, s) = store();
        s.upsert(&mk_full("a", "inbox", "m365", "def", "S1", "a@x", "Zelda",
            "", "2026-01-01T00:00:00Z", false)).unwrap();
        s.upsert(&mk_full("b", "inbox", "m365", "def", "S2", "b@x", "Aaron",
            "", "2026-02-01T00:00:00Z", false)).unwrap();
        s.upsert(&mk_full("c", "inbox", "m365", "def", "S3", "c@x", "Mike",
            "", "2026-03-01T00:00:00Z", false)).unwrap();

        let q = MailListQuery { sort_by: "from".into(), sort_desc: false, ..default_query() };
        let page = s.list_messages(&q).unwrap();
        let names: Vec<&str> = page.items.iter().map(|i| i.from_name.as_str()).collect();
        assert_eq!(names, vec!["Aaron", "Mike", "Zelda"]);

        let q2 = MailListQuery { sort_by: "from".into(), sort_desc: true, ..default_query() };
        let page2 = s.list_messages(&q2).unwrap();
        let names2: Vec<&str> = page2.items.iter().map(|i| i.from_name.as_str()).collect();
        assert_eq!(names2, vec!["Zelda", "Mike", "Aaron"]);
    }

    #[test]
    fn list_keyword_case_insensitive_and_matches_subject_addr_name() {
        let (_d, s) = store();
        s.upsert(&mk_full("a", "inbox", "m365", "def", "Contract Review", "bob@firm.com",
            "Bob Smith", "see attachment", "2026-01-01T00:00:00Z", false)).unwrap();
        s.upsert(&mk_full("b", "inbox", "m365", "def", "Weekly Update", "carol@firm.com",
            "Carol Jones", "agenda attached", "2026-02-01T00:00:00Z", false)).unwrap();

        // Keyword hits the subject (case-insensitive).
        let q = MailListQuery { keyword: Some("contract".into()), ..default_query() };
        let page = s.list_messages(&q).unwrap();
        assert_eq!(page.total, 1);
        assert_eq!(page.items[0].id, "a");

        // Keyword hits from_addr.
        let q2 = MailListQuery { keyword: Some("CAROL@FIRM".into()), ..default_query() };
        let page2 = s.list_messages(&q2).unwrap();
        assert_eq!(page2.total, 1);
        assert_eq!(page2.items[0].id, "b");

        // Keyword hits from_name.
        let q3 = MailListQuery { keyword: Some("smith".into()), ..default_query() };
        let page3 = s.list_messages(&q3).unwrap();
        assert_eq!(page3.total, 1);
        assert_eq!(page3.items[0].id, "a");

        // Keyword that matches nothing.
        let q4 = MailListQuery { keyword: Some("zzz".into()), ..default_query() };
        let page4 = s.list_messages(&q4).unwrap();
        assert_eq!(page4.total, 0);
    }

    #[test]
    fn list_keyword_percent_literal_not_wildcard() {
        // A literal % in the keyword must match a literal % in subject, not everything.
        let (_d, s) = store();
        s.upsert(&mk_full("a", "inbox", "m365", "def", "100% done", "a@x", "A",
            "", "2026-01-01T00:00:00Z", false)).unwrap();
        s.upsert(&mk_full("b", "inbox", "m365", "def", "Half done", "b@x", "B",
            "", "2026-02-01T00:00:00Z", false)).unwrap();

        // Searching for the literal "%" must find "100% done" and not match everything.
        let q = MailListQuery { keyword: Some("%".into()), ..default_query() };
        let page = s.list_messages(&q).unwrap();
        assert_eq!(page.total, 1, "literal %% must not act as a SQL wildcard");
        assert_eq!(page.items[0].id, "a");
    }

    #[test]
    fn list_keyword_underscore_literal_not_wildcard() {
        // A literal _ in the keyword must match literally, not any single char.
        let (_d, s) = store();
        s.upsert(&mk_full("a", "inbox", "m365", "def", "snake_case note", "a@x", "A",
            "", "2026-01-01T00:00:00Z", false)).unwrap();
        s.upsert(&mk_full("b", "inbox", "m365", "def", "No underscore", "b@x", "B",
            "", "2026-02-01T00:00:00Z", false)).unwrap();

        let q = MailListQuery { keyword: Some("snake_case".into()), ..default_query() };
        let page = s.list_messages(&q).unwrap();
        assert_eq!(page.total, 1, "literal _ must not act as a SQL wildcard");
        assert_eq!(page.items[0].id, "a");
    }

    #[test]
    fn list_filter_by_folder() {
        let (_d, s) = store();
        s.upsert(&mk_full("a", "inbox", "m365", "def", "S1", "a@x", "A",
            "", "2026-01-01T00:00:00Z", false)).unwrap();
        s.upsert(&mk_full("b", "sent", "m365", "def", "S2", "b@x", "B",
            "", "2026-02-01T00:00:00Z", false)).unwrap();

        let q = MailListQuery { folder_id: Some("inbox".into()), ..default_query() };
        let page = s.list_messages(&q).unwrap();
        assert_eq!(page.total, 1);
        assert_eq!(page.items[0].id, "a");
    }

    #[test]
    fn list_filter_by_provider() {
        let (_d, s) = store();
        s.upsert(&mk_full("a", "inbox", "m365", "def", "S1", "a@x", "A",
            "", "2026-01-01T00:00:00Z", false)).unwrap();
        s.upsert(&mk_full("b", "INBOX", "gmail", "def", "S2", "b@x", "B",
            "", "2026-02-01T00:00:00Z", false)).unwrap();

        let q = MailListQuery { provider: Some("gmail".into()), ..default_query() };
        let page = s.list_messages(&q).unwrap();
        assert_eq!(page.total, 1);
        assert_eq!(page.items[0].id, "b");
    }

    #[test]
    fn list_filter_by_account() {
        let (_d, s) = store();
        s.upsert(&mk_full("a", "inbox", "m365", "acct1", "S1", "a@x", "A",
            "", "2026-01-01T00:00:00Z", false)).unwrap();
        s.upsert(&mk_full("b", "inbox", "m365", "acct2", "S2", "b@x", "B",
            "", "2026-02-01T00:00:00Z", false)).unwrap();

        let q = MailListQuery { account: Some("acct1".into()), ..default_query() };
        let page = s.list_messages(&q).unwrap();
        assert_eq!(page.total, 1);
        assert_eq!(page.items[0].id, "a");
    }

    #[test]
    fn list_filter_date_range() {
        let (_d, s) = store();
        s.upsert(&mk_full("old",  "inbox", "m365", "def", "Old", "a@x", "A",
            "", "2025-12-01T00:00:00Z", false)).unwrap();
        s.upsert(&mk_full("mid",  "inbox", "m365", "def", "Mid", "b@x", "B",
            "", "2026-03-15T00:00:00Z", false)).unwrap();
        s.upsert(&mk_full("new",  "inbox", "m365", "def", "New", "c@x", "C",
            "", "2026-06-01T00:00:00Z", false)).unwrap();

        let q = MailListQuery {
            date_from: Some("2026-01-01T00:00:00Z".into()),
            date_to:   Some("2026-05-01T00:00:00Z".into()),
            ..default_query()
        };
        let page = s.list_messages(&q).unwrap();
        assert_eq!(page.total, 1);
        assert_eq!(page.items[0].id, "mid");
    }

    #[test]
    fn list_filter_has_attachments() {
        let (_d, s) = store();
        s.upsert(&mk_full("plain", "inbox", "m365", "def", "No Attach", "a@x", "A",
            "", "2026-01-01T00:00:00Z", false)).unwrap();
        s.upsert(&mk_full("att",   "inbox", "m365", "def", "Has Attach", "b@x", "B",
            "", "2026-02-01T00:00:00Z", true)).unwrap();

        let q_att = MailListQuery { has_attachments: Some(true), ..default_query() };
        let page_att = s.list_messages(&q_att).unwrap();
        assert_eq!(page_att.total, 1);
        assert_eq!(page_att.items[0].id, "att");

        let q_no_att = MailListQuery { has_attachments: Some(false), ..default_query() };
        let page_no_att = s.list_messages(&q_no_att).unwrap();
        assert_eq!(page_no_att.total, 1);
        assert_eq!(page_no_att.items[0].id, "plain");
    }

    #[test]
    fn list_pagination_and_total() {
        let (_d, s) = store();
        for i in 0..10u32 {
            s.upsert(&mk_full(
                &format!("m{i}"), "inbox", "m365", "def",
                &format!("Subject {i}"), "a@x", "A", "",
                &format!("2026-{:02}-01T00:00:00Z", i + 1),
                false,
            )).unwrap();
        }

        // First page (limit=4, offset=0).
        let q1 = MailListQuery { limit: 4, offset: 0, sort_desc: false, ..default_query() };
        let page1 = s.list_messages(&q1).unwrap();
        assert_eq!(page1.total, 10, "total must count all matching rows");
        assert_eq!(page1.items.len(), 4);

        // Second page.
        let q2 = MailListQuery { limit: 4, offset: 4, sort_desc: false, ..default_query() };
        let page2 = s.list_messages(&q2).unwrap();
        assert_eq!(page2.total, 10);
        assert_eq!(page2.items.len(), 4);

        // Third page (partial).
        let q3 = MailListQuery { limit: 4, offset: 8, sort_desc: false, ..default_query() };
        let page3 = s.list_messages(&q3).unwrap();
        assert_eq!(page3.total, 10);
        assert_eq!(page3.items.len(), 2);

        // No overlap between pages.
        let ids1: std::collections::HashSet<_> = page1.items.iter().map(|i| &i.id).collect();
        let ids2: std::collections::HashSet<_> = page2.items.iter().map(|i| &i.id).collect();
        assert!(ids1.is_disjoint(&ids2));
    }

    #[test]
    fn list_negative_limit_is_clamped_not_unbounded() {
        let (_d, s) = store();
        for i in 0..250u32 {
            s.upsert(&mk_full(
                &format!("m{i:03}"),
                "inbox",
                "m365",
                "def",
                &format!("Subject {i}"),
                "a@x",
                "A",
                "",
                &format!("2026-01-{:02}T00:00:00Z", (i % 28) + 1),
                false,
            ))
            .unwrap();
        }

        let page = s
            .list_messages(&MailListQuery {
                limit: -1,
                offset: -10,
                sort_desc: false,
                ..default_query()
            })
            .unwrap();

        assert_eq!(page.total, 250);
        assert_eq!(page.items.len(), 1, "negative limit must clamp, not become unbounded");
        assert_eq!(page.items[0].id, "m000", "negative offset must clamp to zero");
    }

    #[test]
    fn list_backfilled_empty_rows_still_returned() {
        // Rows with empty subject/from (the default after migrate_message_columns)
        // must be returned by list with no filters.
        let (_d, s) = store();
        s.upsert(&mk_rec("legacy", "inbox", "m365", "def")).unwrap();

        let page = s.list_messages(&default_query()).unwrap();
        assert_eq!(page.total, 1);
        assert_eq!(page.items[0].id, "legacy");
        assert_eq!(page.items[0].subject, "");
        assert_eq!(page.items[0].from_addr, "");
    }

    // -----------------------------------------------------------------------
    // list_messages parity: SqliteMailStore vs EncryptedMailStore
    // -----------------------------------------------------------------------

    fn seed_parity_data(s: &dyn MailStore) {
        s.upsert(&mk_full("p1", "inbox", "m365", "default", "Alpha", "a@x", "Alice",
            "hello", "2026-01-01T00:00:00Z", false)).unwrap();
        s.upsert(&mk_full("p2", "sent", "m365", "default", "Beta 100%", "b@x", "Bob",
            "world", "2026-02-01T00:00:00Z", true)).unwrap();
        s.upsert(&mk_full("p3", "inbox", "gmail", "default", "Gamma", "c@x", "Carol",
            "test", "2026-03-01T00:00:00Z", false)).unwrap();
    }

    #[test]
    fn list_parity_plain_vs_encrypted_no_filter() {
        let (_d, s_plain) = store();
        let (_d2, s_enc) = enc_store();
        seed_parity_data(&s_plain);
        seed_parity_data(&s_enc);

        let q = MailListQuery { sort_by: "date".into(), sort_desc: false, ..default_query() };
        let plain_page = s_plain.list_messages(&q).unwrap();
        let enc_page = s_enc.list_messages(&q).unwrap();

        assert_eq!(plain_page.total, enc_page.total);
        let plain_ids: Vec<_> = plain_page.items.iter().map(|i| &i.id).collect();
        let enc_ids: Vec<_> = enc_page.items.iter().map(|i| &i.id).collect();
        assert_eq!(plain_ids, enc_ids);
    }

    #[test]
    fn list_parity_keyword_search() {
        let (_d, s_plain) = store();
        let (_d2, s_enc) = enc_store();
        seed_parity_data(&s_plain);
        seed_parity_data(&s_enc);

        let q = MailListQuery {
            keyword: Some("alpha".into()),
            sort_by: "date".into(),
            sort_desc: false,
            ..default_query()
        };
        let plain = s_plain.list_messages(&q).unwrap();
        let enc = s_enc.list_messages(&q).unwrap();
        assert_eq!(plain.total, enc.total);
        assert_eq!(plain.total, 1);
    }

    #[test]
    fn list_parity_literal_percent_escape() {
        let (_d, s_plain) = store();
        let (_d2, s_enc) = enc_store();
        seed_parity_data(&s_plain);
        seed_parity_data(&s_enc);

        // "Beta 100%" has a literal percent — should match with keyword "100%"
        // but NOT match every row.
        let q = MailListQuery { keyword: Some("100%".into()), ..default_query() };
        let plain = s_plain.list_messages(&q).unwrap();
        let enc = s_enc.list_messages(&q).unwrap();
        assert_eq!(plain.total, 1, "SqliteMailStore: literal % must not act as wildcard");
        assert_eq!(enc.total,   1, "EncryptedMailStore: literal % must not act as wildcard");
        assert_eq!(plain.items[0].id, "p2");
        assert_eq!(enc.items[0].id,   "p2");
    }

    #[test]
    fn list_parity_has_attachments_filter() {
        let (_d, s_plain) = store();
        let (_d2, s_enc) = enc_store();
        seed_parity_data(&s_plain);
        seed_parity_data(&s_enc);

        let q = MailListQuery { has_attachments: Some(true), ..default_query() };
        let plain = s_plain.list_messages(&q).unwrap();
        let enc = s_enc.list_messages(&q).unwrap();
        assert_eq!(plain.total, enc.total);
        assert_eq!(plain.total, 1);
        assert_eq!(plain.items[0].id, "p2");
        assert_eq!(enc.items[0].id,   "p2");
    }
}
