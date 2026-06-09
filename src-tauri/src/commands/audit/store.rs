// SQLCipher-encrypted, append-only audit store for Keepance 3.0.
//
// The audit log is the user's "defense file": an append-only record of every
// AI action (what was searched, which matter it was confined to, whether
// privileged material was excluded, whether each citation checks out, and where
// each request went). On the desktop app it lives ENCRYPTED AT REST in a
// SQLCipher database at `<workspace>/.keepance/audit-enc.db`, keyed by a master
// key held in the OS keychain. This mirrors the encrypted mail store
// (`commands/mail/store.rs::EncryptedMailStore`) so the proven master-key-in-
// keychain pattern is reused rather than reinvented.
//
// APPEND-ONLY CONTRACT: this module exposes `append`, `list`, and `count` only.
// There is deliberately no update or delete method on the public surface — an
// audit record, once written, is never mutated or removed through this API. The
// table has no UPDATE/DELETE path; entries are inserted and read back in
// insertion order.

use anyhow::{Context, Result};
use rusqlite::Connection;
use std::path::{Path, PathBuf};

// ---------------------------------------------------------------------------
// Data model
// ---------------------------------------------------------------------------

/// One audit entry as it crosses the Tauri boundary. The renderer owns the rich
/// shape (`AuditEntry` in `src/types/audit.ts`); here we persist the stable,
/// queryable columns plus the full JSON payload so nothing is lost.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditEntryRecord {
    /// Renderer-generated id (e.g. `audit_<ts>_<rand>`). Primary key.
    pub id: String,
    /// ISO-8601 timestamp the action happened.
    pub timestamp: String,
    /// Action type (e.g. `model_call`, `retrieval_executed`, `egress`).
    pub action: String,
    /// Human-readable one-line description.
    pub description: String,
    /// The full entry serialized as JSON (inputs/outputs/metadata/cost/etc.).
    /// Stored verbatim so the renderer round-trips losslessly.
    pub payload_json: String,
}

/// Map a `entries` row (canonical column order) to an `AuditEntryRecord`.
fn row_to_record(r: &rusqlite::Row<'_>) -> rusqlite::Result<AuditEntryRecord> {
    Ok(AuditEntryRecord {
        id: r.get(0)?,
        timestamp: r.get(1)?,
        action: r.get(2)?,
        description: r.get(3)?,
        payload_json: r.get(4)?,
    })
}

// ---------------------------------------------------------------------------
// Encrypted store
// ---------------------------------------------------------------------------

/// SQLCipher-backed append-only audit store. Encrypted at rest with a 32-byte
/// master key (raw-hex `PRAGMA key`), bypassing the passphrase KDF the same way
/// the mail store does.
pub struct EncryptedAuditStore {
    conn: std::sync::Mutex<Connection>,
}

impl EncryptedAuditStore {
    /// Canonical path for the encrypted audit DB inside a workspace.
    pub fn db_path(workspace_root: &Path) -> PathBuf {
        workspace_root.join(".keepance").join("audit-enc.db")
    }

    /// Open (or create) the SQLCipher database keyed with `key`.
    /// `PRAGMA key` MUST be the very first statement on the connection.
    pub fn open_with_key(workspace_root: &Path, key: &[u8; 32]) -> Result<Self> {
        let p = Self::db_path(workspace_root);
        if let Some(parent) = p.parent() {
            std::fs::create_dir_all(parent).ok();
        }
        let conn = Connection::open(&p)
            .with_context(|| format!("open enc audit db {}", p.display()))?;

        // SQLCipher requires the key before any DDL. Raw-hex form skips the KDF.
        let hex_key = hex::encode(key);
        conn.execute_batch(&format!("PRAGMA key = \"x'{}'\";", hex_key))?;

        // `seq` is an autoincrementing rowid so we can read entries back in the
        // exact order they were appended, independent of the renderer id or the
        // ISO timestamp string. APPEND-ONLY: rows are only ever INSERTed.
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS entries (
                seq          INTEGER PRIMARY KEY AUTOINCREMENT,
                id           TEXT NOT NULL UNIQUE,
                timestamp    TEXT NOT NULL,
                action       TEXT NOT NULL,
                description  TEXT NOT NULL,
                payload_json TEXT NOT NULL
            );",
        )?;
        Ok(Self {
            conn: std::sync::Mutex::new(conn),
        })
    }

    /// Open with the master key from the OS keychain (creating it on first use).
    pub fn open(workspace_root: &Path) -> Result<Self> {
        let key = super::crypto::get_or_create_master_key()?;
        Self::open_with_key(workspace_root, &key)
    }

    /// Append one entry. Append-only: an id that already exists is ignored
    /// (`INSERT OR IGNORE`) rather than overwriting an existing record, so a
    /// retried append can never mutate history. Returns `true` if a new row was
    /// written, `false` if the id already existed.
    pub fn append(&self, rec: &AuditEntryRecord) -> Result<bool> {
        let c = self.conn.lock().unwrap();
        let changed = c.execute(
            "INSERT OR IGNORE INTO entries
                (id, timestamp, action, description, payload_json)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params![
                rec.id,
                rec.timestamp,
                rec.action,
                rec.description,
                rec.payload_json
            ],
        )?;
        Ok(changed > 0)
    }

    /// List entries in insertion order (oldest first). `limit`/`offset` are
    /// optional; with neither set, every entry is returned. The renderer sorts
    /// for display, but persistence order is the append order.
    pub fn list(&self, limit: Option<i64>, offset: Option<i64>) -> Result<Vec<AuditEntryRecord>> {
        let c = self.conn.lock().unwrap();
        let lim = limit.unwrap_or(-1); // SQLite: LIMIT -1 means "no limit".
        let off = offset.unwrap_or(0);
        let mut stmt = c.prepare(
            "SELECT id, timestamp, action, description, payload_json
             FROM entries ORDER BY seq ASC LIMIT ?1 OFFSET ?2",
        )?;
        let rows = stmt
            .query_map(rusqlite::params![lim, off], row_to_record)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    }

    /// Total number of audit entries (diagnostics + tests).
    pub fn count(&self) -> Result<i64> {
        let c = self.conn.lock().unwrap();
        Ok(c.query_row("SELECT COUNT(*) FROM entries", [], |r| r.get(0))?)
    }
}

// ---------------------------------------------------------------------------
// Tests (TDD — written to pin the append-only + round-trip + encryption-at-rest
// guarantees the audit "defense file" depends on).
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn enc_store() -> (TempDir, EncryptedAuditStore) {
        let dir = TempDir::new().unwrap();
        let key = [0x42u8; 32]; // deterministic test key, bypasses keychain
        let s = EncryptedAuditStore::open_with_key(dir.path(), &key).expect("enc open");
        (dir, s)
    }

    fn rec(id: &str, action: &str) -> AuditEntryRecord {
        AuditEntryRecord {
            id: id.into(),
            timestamp: "2026-06-09T00:00:00Z".into(),
            action: action.into(),
            description: format!("desc for {id}"),
            payload_json: format!("{{\"auditEventType\":\"{action}\"}}"),
        }
    }

    #[test]
    fn append_then_list_round_trips_entries() {
        let (_d, s) = enc_store();
        s.append(&rec("a1", "retrieval_executed")).unwrap();
        s.append(&rec("a2", "egress")).unwrap();
        assert_eq!(s.count().unwrap(), 2);

        let all = s.list(None, None).unwrap();
        assert_eq!(all.len(), 2);
        // Insertion order preserved (oldest first).
        assert_eq!(all[0].id, "a1");
        assert_eq!(all[0].action, "retrieval_executed");
        assert_eq!(all[1].id, "a2");
        assert_eq!(all[1].action, "egress");
        // Payload round-trips verbatim.
        assert!(all[1].payload_json.contains("egress"));
    }

    #[test]
    fn append_is_append_only_duplicate_id_does_not_overwrite() {
        let (_d, s) = enc_store();
        assert!(s.append(&rec("dup", "model_call")).unwrap(), "first insert writes");
        // A second append with the SAME id must NOT mutate the existing row and
        // must NOT add a duplicate. It returns false (ignored).
        let mut mutated = rec("dup", "model_call");
        mutated.description = "TAMPERED".into();
        mutated.payload_json = "{\"tampered\":true}".into();
        assert!(!s.append(&mutated).unwrap(), "duplicate id is ignored");

        assert_eq!(s.count().unwrap(), 1, "no duplicate row");
        let all = s.list(None, None).unwrap();
        assert_eq!(all[0].description, "desc for dup", "original is preserved");
        assert!(!all[0].payload_json.contains("tampered"), "payload not overwritten");
    }

    #[test]
    fn list_respects_limit_and_offset() {
        let (_d, s) = enc_store();
        for i in 0..5 {
            s.append(&rec(&format!("e{i}"), "user_action")).unwrap();
        }
        let page = s.list(Some(2), Some(1)).unwrap();
        assert_eq!(page.len(), 2);
        assert_eq!(page[0].id, "e1");
        assert_eq!(page[1].id, "e2");
    }

    #[test]
    fn entries_survive_close_and_reopen_with_same_key() {
        let dir = TempDir::new().unwrap();
        let key = [0x99u8; 32];
        {
            let s = EncryptedAuditStore::open_with_key(dir.path(), &key).expect("first open");
            s.append(&rec("persisted", "scope_active")).unwrap();
        } // connection dropped / closed
        let s2 = EncryptedAuditStore::open_with_key(dir.path(), &key).expect("second open");
        assert_eq!(s2.count().unwrap(), 1, "entry must survive close+reopen");
        assert_eq!(s2.list(None, None).unwrap()[0].id, "persisted");
    }

    #[test]
    fn db_file_is_not_plain_sqlite() {
        // Encryption-at-rest: the DB header must NOT be the plaintext SQLite one.
        let (dir, s) = enc_store();
        s.append(&rec("hdr", "egress")).unwrap();
        drop(s); // flush + close
        let raw = std::fs::read(EncryptedAuditStore::db_path(dir.path())).expect("read db");
        let plain_header = b"SQLite format 3\x00";
        assert!(
            !raw.starts_with(plain_header),
            "SQLCipher audit DB must NOT start with the plain SQLite header"
        );
    }

    #[test]
    fn payload_plaintext_does_not_appear_on_disk() {
        // A sensitive query string in the payload must not be readable in the
        // raw DB file (it is inside the SQLCipher-encrypted pages).
        let dir = TempDir::new().unwrap();
        let key = [0x7u8; 32];
        let secret = "CONFIDENTIAL_MATTER_QUERY_acme_merger";
        {
            let s = EncryptedAuditStore::open_with_key(dir.path(), &key).unwrap();
            s.append(&AuditEntryRecord {
                id: "s1".into(),
                timestamp: "2026-06-09T00:00:00Z".into(),
                action: "retrieval_executed".into(),
                description: secret.into(),
                payload_json: format!("{{\"query\":\"{secret}\"}}"),
            })
            .unwrap();
        }
        let raw = std::fs::read(EncryptedAuditStore::db_path(dir.path())).unwrap();
        assert!(
            !raw.windows(secret.len()).any(|w| w == secret.as_bytes()),
            "plaintext payload must not appear in the encrypted audit DB"
        );
    }

    #[test]
    fn wrong_key_cannot_open_existing_db() {
        // A DB written with one key must not be usable with another. SQLCipher
        // rejects the wrong key as soon as it touches the (encrypted) schema —
        // here at the `CREATE TABLE IF NOT EXISTS` in `open_with_key`, which
        // must read the existing header. Either the open itself errors, or any
        // subsequent read does; both prove the wrong key cannot read the data.
        let dir = TempDir::new().unwrap();
        {
            let s = EncryptedAuditStore::open_with_key(dir.path(), &[0x11u8; 32]).unwrap();
            s.append(&rec("x", "model_call")).unwrap();
        }
        let opened = EncryptedAuditStore::open_with_key(dir.path(), &[0x22u8; 32]);
        let blocked = match opened {
            Err(_) => true,             // open (DDL on the encrypted file) rejected the key
            Ok(s) => s.count().is_err(), // or the first read does
        };
        assert!(blocked, "a SQLCipher DB must be unreadable with the wrong key");
    }
}
