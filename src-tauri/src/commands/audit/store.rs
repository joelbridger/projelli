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

use anyhow::{bail, Context, Result};
use rusqlite::{Connection, OptionalExtension};
use sha2::{Digest, Sha256};
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

/// Fixed previous-hash for the first row in a workspace audit chain.
///
/// A migrated legacy log is backfilled from this value once. That seals the
/// log from the upgrade moment forward; it cannot prove whether someone edited
/// old rows before this feature existed.
const GENESIS_PREV_HASH: [u8; 32] = [0u8; 32];
const CHAIN_HEAD_METADATA_KEY: &str = "chain_head_v1";

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum AuditChainVerification {
    Verified {
        checked: i64,
    },
    Altered {
        seq: i64,
        id: String,
        reason: String,
        checked: i64,
    },
}

#[derive(Debug, Clone)]
struct ChainRow {
    seq: i64,
    rec: AuditEntryRecord,
    prev_hash: Option<Vec<u8>>,
    entry_hash: Option<Vec<u8>>,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
struct ChainHeadRecord {
    entry_count: i64,
    last_seq: i64,
    last_hash: String,
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

fn row_to_chain_row(r: &rusqlite::Row<'_>) -> rusqlite::Result<ChainRow> {
    Ok(ChainRow {
        seq: r.get(0)?,
        rec: AuditEntryRecord {
            id: r.get(1)?,
            timestamp: r.get(2)?,
            action: r.get(3)?,
            description: r.get(4)?,
            payload_json: r.get(5)?,
        },
        prev_hash: r.get(6)?,
        entry_hash: r.get(7)?,
    })
}

fn canonical_entry_bytes(seq: i64, rec: &AuditEntryRecord) -> Vec<u8> {
    fn push_str(out: &mut Vec<u8>, value: &str) {
        let bytes = value.as_bytes();
        out.extend_from_slice(&(bytes.len() as u64).to_be_bytes());
        out.extend_from_slice(bytes);
    }

    let mut out = Vec::new();
    out.extend_from_slice(&seq.to_be_bytes());
    push_str(&mut out, &rec.id);
    push_str(&mut out, &rec.timestamp);
    push_str(&mut out, &rec.action);
    push_str(&mut out, &rec.description);
    push_str(&mut out, &rec.payload_json);
    out
}

fn compute_entry_hash(prev_hash: &[u8], seq: i64, rec: &AuditEntryRecord) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(prev_hash);
    hasher.update(canonical_entry_bytes(seq, rec));
    hasher.finalize().into()
}

fn is_hash32(value: &[u8]) -> bool {
    value.len() == 32
}

fn read_chain_rows(c: &Connection) -> Result<Vec<ChainRow>> {
    let mut stmt = c.prepare(
        "SELECT seq, id, timestamp, action, description, payload_json, prev_hash, entry_hash
         FROM entries ORDER BY seq ASC",
    )?;
    let rows = stmt
        .query_map([], row_to_chain_row)?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

fn read_chain_head(c: &Connection) -> Result<Option<ChainHeadRecord>> {
    let raw: Option<String> = c
        .query_row(
            "SELECT value_json FROM audit_metadata WHERE key = ?1",
            [CHAIN_HEAD_METADATA_KEY],
            |r| r.get(0),
        )
        .optional()?;
    raw.map(|value| serde_json::from_str(&value).context("decode audit chain head"))
        .transpose()
}

fn upsert_chain_head(c: &Connection, head: &ChainHeadRecord) -> Result<()> {
    let value = serde_json::to_string(head).context("encode audit chain head")?;
    c.execute(
        "INSERT INTO audit_metadata (key, value_json)
         VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json",
        rusqlite::params![CHAIN_HEAD_METADATA_KEY, value],
    )?;
    Ok(())
}

fn table_columns(c: &Connection, table: &str) -> Result<std::collections::HashSet<String>> {
    let mut stmt = c.prepare(&format!("PRAGMA table_info({table})"))?;
    let cols = stmt
        .query_map([], |r| r.get::<_, String>(1))?
        .collect::<rusqlite::Result<std::collections::HashSet<_>>>()?;
    Ok(cols)
}

fn ensure_metadata_schema(c: &Connection) -> Result<()> {
    c.execute_batch(
        "CREATE TABLE IF NOT EXISTS audit_metadata (
            key        TEXT PRIMARY KEY,
            value_json TEXT NOT NULL
        );",
    )?;
    Ok(())
}

fn verify_rows_and_build_head(
    rows: &[ChainRow],
) -> std::result::Result<ChainHeadRecord, AuditChainVerification> {
    let mut expected_prev = GENESIS_PREV_HASH.to_vec();
    let mut checked = 0;
    let mut last_seq = 0;
    let mut last_id = String::new();

    for row in rows {
        let prev_hash = match row.prev_hash.as_deref() {
            Some(hash) if is_hash32(hash) => hash,
            _ => {
                return Err(AuditChainVerification::Altered {
                    seq: row.seq,
                    id: row.rec.id.clone(),
                    reason: "previous hash missing or invalid".into(),
                    checked,
                });
            }
        };
        if prev_hash != expected_prev.as_slice() {
            return Err(AuditChainVerification::Altered {
                seq: row.seq,
                id: row.rec.id.clone(),
                reason: "previous hash link mismatch".into(),
                checked,
            });
        }

        let expected_entry_hash = compute_entry_hash(prev_hash, row.seq, &row.rec);
        let entry_hash = match row.entry_hash.as_deref() {
            Some(hash) if is_hash32(hash) => hash,
            _ => {
                return Err(AuditChainVerification::Altered {
                    seq: row.seq,
                    id: row.rec.id.clone(),
                    reason: "entry hash missing or invalid".into(),
                    checked,
                });
            }
        };
        if entry_hash != expected_entry_hash {
            return Err(AuditChainVerification::Altered {
                seq: row.seq,
                id: row.rec.id.clone(),
                reason: "entry hash mismatch".into(),
                checked,
            });
        }

        expected_prev = entry_hash.to_vec();
        checked += 1;
        last_seq = row.seq;
        last_id = row.rec.id.clone();
    }

    let _ = last_id;
    Ok(ChainHeadRecord {
        entry_count: checked,
        last_seq,
        last_hash: hex::encode(expected_prev),
    })
}

fn compare_stored_head(
    actual: &ChainHeadRecord,
    stored: &ChainHeadRecord,
    rows: &[ChainRow],
    checked: i64,
) -> Option<AuditChainVerification> {
    if actual == stored {
        return None;
    }

    let (seq, id) = rows
        .last()
        .map(|row| (row.seq, row.rec.id.clone()))
        .unwrap_or((0, "__chain_head__".into()));
    let reason = if actual.entry_count < stored.entry_count || actual.last_seq < stored.last_seq {
        "tail truncated"
    } else {
        "chain head mismatch"
    };
    Some(AuditChainVerification::Altered {
        seq,
        id,
        reason: reason.into(),
        checked,
    })
}

fn ensure_chain_head_exists_for_valid_chain(c: &Connection) -> Result<()> {
    if read_chain_head(c)?.is_some() {
        return Ok(());
    }
    let rows = read_chain_rows(c)?;
    match verify_rows_and_build_head(&rows) {
        Ok(head) => upsert_chain_head(c, &head),
        Err(_) => Ok(()),
    }
}

fn ensure_chain_head_matches_current_rows(c: &Connection) -> Result<()> {
    let rows = read_chain_rows(c)?;
    let actual = match verify_rows_and_build_head(&rows) {
        Ok(head) => head,
        Err(altered) => bail!("audit chain altered: {altered:?}"),
    };
    let stored = read_chain_head(c)?.context("audit chain head missing")?;
    if let Some(altered) = compare_stored_head(&actual, &stored, &rows, actual.entry_count) {
        bail!("audit chain altered: {altered:?}");
    }
    Ok(())
}

fn ensure_hash_chain_schema(c: &mut Connection) -> Result<()> {
    // New installs get the hash columns immediately. Legacy databases created
    // before BUG-078 are upgraded below and backfilled in seq order.
    c.execute_batch(
        "CREATE TABLE IF NOT EXISTS entries (
            seq          INTEGER PRIMARY KEY AUTOINCREMENT,
            id           TEXT NOT NULL UNIQUE,
            timestamp    TEXT NOT NULL,
            action       TEXT NOT NULL,
            description  TEXT NOT NULL,
            payload_json TEXT NOT NULL,
            prev_hash    BLOB,
            entry_hash   BLOB
        );",
    )?;
    ensure_metadata_schema(c)?;

    let cols = table_columns(c, "entries")?;
    let mut added_hash_columns = false;
    if !cols.contains("prev_hash") {
        c.execute_batch("ALTER TABLE entries ADD COLUMN prev_hash BLOB;")?;
        added_hash_columns = true;
    }
    if !cols.contains("entry_hash") {
        c.execute_batch("ALTER TABLE entries ADD COLUMN entry_hash BLOB;")?;
        added_hash_columns = true;
    }

    let row_count: i64 = c.query_row("SELECT COUNT(*) FROM entries", [], |r| r.get(0))?;
    if row_count == 0 {
        upsert_chain_head(
            c,
            &ChainHeadRecord {
                entry_count: 0,
                last_seq: 0,
                last_hash: hex::encode(GENESIS_PREV_HASH),
            },
        )?;
        return Ok(());
    }

    let missing_hash_count: i64 = c.query_row(
        "SELECT COUNT(*) FROM entries WHERE prev_hash IS NULL OR entry_hash IS NULL",
        [],
        |r| r.get(0),
    )?;

    if added_hash_columns {
        // Migration note: this seals the existing log from now on. It does not
        // prove that legacy rows were untouched before the upgrade because no
        // chain existed yet to check against.
        backfill_hash_chain(c)?;
    } else if missing_hash_count == 0 {
        ensure_chain_head_exists_for_valid_chain(c)?;
    }

    Ok(())
}

fn backfill_hash_chain(c: &mut Connection) -> Result<()> {
    let tx = c.transaction()?;
    let rows = {
        let mut stmt = tx.prepare(
            "SELECT seq, id, timestamp, action, description, payload_json, prev_hash, entry_hash
             FROM entries ORDER BY seq ASC",
        )?;
        let rows = stmt
            .query_map([], row_to_chain_row)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        rows
    };

    let mut prev_hash = GENESIS_PREV_HASH.to_vec();
    let mut entry_count = 0;
    let mut last_seq = 0;
    for row in rows {
        let entry_hash = compute_entry_hash(&prev_hash, row.seq, &row.rec);
        tx.execute(
            "UPDATE entries SET prev_hash = ?1, entry_hash = ?2 WHERE seq = ?3",
            rusqlite::params![prev_hash, entry_hash.to_vec(), row.seq],
        )?;
        prev_hash = entry_hash.to_vec();
        entry_count += 1;
        last_seq = row.seq;
    }
    upsert_chain_head(
        &tx,
        &ChainHeadRecord {
            entry_count,
            last_seq,
            last_hash: hex::encode(prev_hash),
        },
    )?;
    tx.commit()?;
    Ok(())
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
        workspace_root.join(crate::identity::WORKSPACE_DATA_DIR).join("audit-enc.db")
    }

    /// Open (or create) the SQLCipher database keyed with `key`.
    /// `PRAGMA key` MUST be the very first statement on the connection.
    pub fn open_with_key(workspace_root: &Path, key: &[u8; 32]) -> Result<Self> {
        let p = Self::db_path(workspace_root);
        if let Some(parent) = p.parent() {
            std::fs::create_dir_all(parent).ok();
        }
        let mut conn =
            Connection::open(&p).with_context(|| format!("open enc audit db {}", p.display()))?;

        // SQLCipher requires the key before any DDL. Raw-hex form skips the KDF.
        let hex_key = hex::encode(key);
        conn.execute_batch(&format!("PRAGMA key = \"x'{}'\";", hex_key))?;

        // `seq` is an autoincrementing rowid so we can read entries back in the
        // exact order they were appended, independent of the renderer id or the
        // ISO timestamp string. BUG-078 adds per-row hash-chain fields. Existing
        // logs are backfilled on first open so legacy rows are not falsely
        // reported as altered merely because they predate the chain.
        ensure_hash_chain_schema(&mut conn)?;
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
        let mut c = self.conn.lock().unwrap();
        let tx = c.transaction()?;
        ensure_chain_head_matches_current_rows(&tx)?;
        let previous = tx
            .query_row(
                "SELECT seq, entry_hash FROM entries ORDER BY seq DESC LIMIT 1",
                [],
                |r| Ok((r.get::<_, i64>(0)?, r.get::<_, Option<Vec<u8>>>(1)?)),
            )
            .optional()?;
        let prev_hash = match previous {
            None => GENESIS_PREV_HASH.to_vec(),
            Some((seq, Some(hash))) if is_hash32(&hash) => {
                let _ = seq;
                hash
            }
            Some((seq, _)) => bail!("audit chain head at seq {seq} is missing or invalid"),
        };

        let changed = tx.execute(
            "INSERT OR IGNORE INTO entries
                (id, timestamp, action, description, payload_json, prev_hash, entry_hash)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, X'')",
            rusqlite::params![
                rec.id,
                rec.timestamp,
                rec.action,
                rec.description,
                rec.payload_json,
                prev_hash,
            ],
        )?;
        if changed == 0 {
            tx.commit()?;
            return Ok(false);
        }

        let seq = tx.last_insert_rowid();
        let entry_hash = compute_entry_hash(&prev_hash, seq, rec);
        tx.execute(
            "UPDATE entries SET entry_hash = ?1 WHERE seq = ?2",
            rusqlite::params![entry_hash.to_vec(), seq],
        )?;
        let entry_count: i64 = tx.query_row("SELECT COUNT(*) FROM entries", [], |r| r.get(0))?;
        upsert_chain_head(
            &tx,
            &ChainHeadRecord {
                entry_count,
                last_seq: seq,
                last_hash: hex::encode(entry_hash),
            },
        )?;
        tx.commit()?;
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

    /// Recompute the hash-chain from the genesis value through rows in `seq`
    /// order. The first mismatch pinpoints the earliest row whose contents or
    /// link no longer match the trusted Rust-computed seal.
    pub fn verify_chain(&self) -> Result<AuditChainVerification> {
        let c = self.conn.lock().unwrap();
        let rows = read_chain_rows(&c)?;
        let actual = match verify_rows_and_build_head(&rows) {
            Ok(head) => head,
            Err(altered) => return Ok(altered),
        };
        let stored = match read_chain_head(&c) {
            Ok(Some(head)) => head,
            Ok(None) => {
                return Ok(AuditChainVerification::Altered {
                    seq: 0,
                    id: "__chain_head__".into(),
                    reason: "chain head missing".into(),
                    checked: actual.entry_count,
                });
            }
            Err(_) => {
                return Ok(AuditChainVerification::Altered {
                    seq: 0,
                    id: "__chain_head__".into(),
                    reason: "chain head missing or invalid".into(),
                    checked: actual.entry_count,
                });
            }
        };

        if let Some(altered) = compare_stored_head(&actual, &stored, &rows, actual.entry_count) {
            return Ok(altered);
        }

        Ok(AuditChainVerification::Verified {
            checked: actual.entry_count,
        })
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
        assert!(
            s.append(&rec("dup", "model_call")).unwrap(),
            "first insert writes"
        );
        // A second append with the SAME id must NOT mutate the existing row and
        // must NOT add a duplicate. It returns false (ignored).
        let mut mutated = rec("dup", "model_call");
        mutated.description = "TAMPERED".into();
        mutated.payload_json = "{\"tampered\":true}".into();
        assert!(!s.append(&mutated).unwrap(), "duplicate id is ignored");

        assert_eq!(s.count().unwrap(), 1, "no duplicate row");
        let all = s.list(None, None).unwrap();
        assert_eq!(all[0].description, "desc for dup", "original is preserved");
        assert!(
            !all[0].payload_json.contains("tampered"),
            "payload not overwritten"
        );
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
            Err(_) => true,              // open (DDL on the encrypted file) rejected the key
            Ok(s) => s.count().is_err(), // or the first read does
        };
        assert!(
            blocked,
            "a SQLCipher DB must be unreadable with the wrong key"
        );
    }

    #[test]
    fn hash_chain_verifies_after_three_appends() {
        let (_d, s) = enc_store();
        s.append(&rec("h1", "model_call")).unwrap();
        s.append(&rec("h2", "egress")).unwrap();
        s.append(&rec("h3", "file_update")).unwrap();

        assert_eq!(
            s.verify_chain().unwrap(),
            AuditChainVerification::Verified { checked: 3 }
        );
    }

    #[test]
    fn hash_chain_detects_tampered_payload_at_first_changed_seq() {
        let (_d, s) = enc_store();
        s.append(&rec("t1", "model_call")).unwrap();
        s.append(&rec("t2", "egress")).unwrap();
        s.append(&rec("t3", "file_update")).unwrap();

        {
            let c = s.conn.lock().unwrap();
            c.execute(
                "UPDATE entries SET payload_json = ?1 WHERE id = 't2'",
                ["{\"tampered\":true}"],
            )
            .unwrap();
        }

        assert_eq!(
            s.verify_chain().unwrap(),
            AuditChainVerification::Altered {
                seq: 2,
                id: "t2".into(),
                reason: "entry hash mismatch".into(),
                checked: 1,
            }
        );
    }

    #[test]
    fn hash_chain_detects_tail_truncation_against_stored_head() {
        let (_d, s) = enc_store();
        s.append(&rec("tail-1", "model_call")).unwrap();
        s.append(&rec("tail-2", "egress")).unwrap();
        s.append(&rec("tail-3", "file_update")).unwrap();
        assert_eq!(
            s.verify_chain().unwrap(),
            AuditChainVerification::Verified { checked: 3 }
        );

        {
            let c = s.conn.lock().unwrap();
            c.execute("DELETE FROM entries WHERE id = 'tail-3'", [])
                .unwrap();
        }

        assert_eq!(
            s.verify_chain().unwrap(),
            AuditChainVerification::Altered {
                seq: 2,
                id: "tail-2".into(),
                reason: "tail truncated".into(),
                checked: 2,
            }
        );
    }

    #[test]
    fn append_updates_chain_head_after_normal_new_entry() {
        let (_d, s) = enc_store();
        s.append(&rec("head-1", "model_call")).unwrap();
        s.append(&rec("head-2", "egress")).unwrap();
        assert_eq!(
            s.verify_chain().unwrap(),
            AuditChainVerification::Verified { checked: 2 }
        );

        s.append(&rec("head-3", "file_update")).unwrap();

        assert_eq!(
            s.verify_chain().unwrap(),
            AuditChainVerification::Verified { checked: 3 }
        );
    }

    #[test]
    fn migration_backfills_existing_unchained_rows() {
        let dir = TempDir::new().unwrap();
        let key = [0x55u8; 32];
        let db_path = EncryptedAuditStore::db_path(dir.path());
        std::fs::create_dir_all(db_path.parent().unwrap()).unwrap();
        {
            let conn = Connection::open(&db_path).unwrap();
            conn.execute_batch(&format!("PRAGMA key = \"x'{}'\";", hex::encode(key)))
                .unwrap();
            conn.execute_batch(
                "CREATE TABLE entries (
                    seq          INTEGER PRIMARY KEY AUTOINCREMENT,
                    id           TEXT NOT NULL UNIQUE,
                    timestamp    TEXT NOT NULL,
                    action       TEXT NOT NULL,
                    description  TEXT NOT NULL,
                    payload_json TEXT NOT NULL
                );",
            )
            .unwrap();
            conn.execute(
                "INSERT INTO entries (id, timestamp, action, description, payload_json)
                 VALUES (?1, ?2, ?3, ?4, ?5)",
                rusqlite::params![
                    "legacy-1",
                    "2026-06-09T00:00:00Z",
                    "model_call",
                    "old one",
                    "{\"n\":1}"
                ],
            )
            .unwrap();
            conn.execute(
                "INSERT INTO entries (id, timestamp, action, description, payload_json)
                 VALUES (?1, ?2, ?3, ?4, ?5)",
                rusqlite::params![
                    "legacy-2",
                    "2026-06-09T00:01:00Z",
                    "egress",
                    "old two",
                    "{\"n\":2}"
                ],
            )
            .unwrap();
        }

        let s = EncryptedAuditStore::open_with_key(dir.path(), &key).expect("open migrated store");
        assert_eq!(
            s.verify_chain().unwrap(),
            AuditChainVerification::Verified { checked: 2 }
        );
    }

    #[test]
    fn existing_hash_columns_with_all_null_hashes_are_not_resealed() {
        let dir = TempDir::new().unwrap();
        let key = [0x56u8; 32];
        let db_path = EncryptedAuditStore::db_path(dir.path());
        std::fs::create_dir_all(db_path.parent().unwrap()).unwrap();
        {
            let conn = Connection::open(&db_path).unwrap();
            conn.execute_batch(&format!("PRAGMA key = \"x'{}'\";", hex::encode(key)))
                .unwrap();
            conn.execute_batch(
                "CREATE TABLE entries (
                    seq          INTEGER PRIMARY KEY AUTOINCREMENT,
                    id           TEXT NOT NULL UNIQUE,
                    timestamp    TEXT NOT NULL,
                    action       TEXT NOT NULL,
                    description  TEXT NOT NULL,
                    payload_json TEXT NOT NULL,
                    prev_hash    BLOB,
                    entry_hash   BLOB
                );",
            )
            .unwrap();
            conn.execute(
                "INSERT INTO entries
                    (id, timestamp, action, description, payload_json, prev_hash, entry_hash)
                 VALUES (?1, ?2, ?3, ?4, ?5, NULL, NULL)",
                rusqlite::params![
                    "nulled-1",
                    "2026-06-09T00:00:00Z",
                    "model_call",
                    "already had hash columns",
                    "{\"n\":1}"
                ],
            )
            .unwrap();
        }

        let s = EncryptedAuditStore::open_with_key(dir.path(), &key).expect("open store");
        assert_eq!(
            s.verify_chain().unwrap(),
            AuditChainVerification::Altered {
                seq: 1,
                id: "nulled-1".into(),
                reason: "previous hash missing or invalid".into(),
                checked: 0,
            }
        );
    }

    #[test]
    fn first_row_uses_genesis_previous_hash() {
        let (_d, s) = enc_store();
        s.append(&rec("genesis", "model_call")).unwrap();

        let prev_hash: Vec<u8> = {
            let c = s.conn.lock().unwrap();
            c.query_row(
                "SELECT prev_hash FROM entries WHERE id = 'genesis'",
                [],
                |r| r.get(0),
            )
            .unwrap()
        };
        assert_eq!(prev_hash, GENESIS_PREV_HASH);
        assert_eq!(
            s.verify_chain().unwrap(),
            AuditChainVerification::Verified { checked: 1 }
        );
    }
}
