// SQLCipher-encrypted, append-only audit store for Advisor Prep Hero 3.0.
//
// The audit log is the user's "defense file": an append-only record of every
// AI action (what was searched, which matter it was confined to, whether
// privileged material was excluded, whether each citation checks out, and where
// each request went). On the desktop app it lives ENCRYPTED AT REST in a
// SQLCipher database at `<workspace>/.lantern/audit-enc.db`, keyed by a master
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
use crate::util::sync::lock_unpoison;
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
#[serde(tag = "status", rename_all = "camelCase", rename_all_fields = "camelCase")]
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
    /// FAIL-CLOSED tamper evidence. The surviving rows still form a valid
    /// per-row hash chain, but the `chain_head_v1` seal that vouched for the
    /// chain's COMPLETENESS is gone. We cannot distinguish a benign lost seal
    /// from a silent tail-truncation-then-reseal attempt, so we refuse to call
    /// the log `Verified`: history up to `last_timestamp` can no longer be
    /// cryptographically proven complete. Appends are refused until an explicit
    /// `repair` re-seals the surviving prefix AND records the anomaly.
    SealMissing {
        /// Number of surviving rows whose per-row hashes still chain cleanly.
        surviving_rows: i64,
        /// Timestamp of the last surviving row — the boundary of verifiable
        /// history for honest UI copy. `None` only if the table is unreadable.
        last_timestamp: Option<String>,
    },
}

/// Result of an explicit, acknowledged `repair` of a seal-missing audit log.
/// Returned to the caller so the UI can report exactly what was re-sealed.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditChainRepairReport {
    /// Rows that survived and were re-sealed (excludes the anomaly record).
    pub surviving_rows: i64,
    /// Id of the permanent anomaly record now embedded in the new chain.
    pub anomaly_id: String,
    /// Total entries in the chain after repair (`surviving_rows` + 1).
    pub total_entries: i64,
    /// Boundary of previously-verifiable history, echoed back for the record.
    pub last_verifiable_timestamp: Option<String>,
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

/// Highest `seq` ever assigned to an `entries` row — the AUTOINCREMENT
/// high-water mark SQLite keeps in `sqlite_sequence`. Crucially, it SURVIVES row
/// deletion (that is the whole point of AUTOINCREMENT vs a plain rowid). It lets
/// us tell a genuinely-fresh empty store (`0`, no row ever inserted) apart from
/// one whose rows were ALL deleted (`> 0`) — the all-rows form of the silent
/// truncation this module guards against. Returns `0` when nothing was ever
/// inserted (or the sequence table does not exist yet). A determined attacker
/// with raw DB write access could also reset this counter, so it is
/// defense-in-depth against the naive-delete / buggy-truncation threat class,
/// not a cryptographic guarantee.
fn max_ever_seq(c: &Connection) -> Result<i64> {
    let has_seq_table: bool = c
        .query_row(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='sqlite_sequence'",
            [],
            |_| Ok(true),
        )
        .optional()?
        .unwrap_or(false);
    if !has_seq_table {
        return Ok(0);
    }
    let seq: Option<i64> = c
        .query_row(
            "SELECT seq FROM sqlite_sequence WHERE name = 'entries'",
            [],
            |r| r.get(0),
        )
        .optional()?;
    Ok(seq.unwrap_or(0))
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

/// Human-readable refusal used when an append is attempted against a
/// seal-missing (tamper-evident-degraded) audit log. Surfaced verbatim to the
/// renderer through `audit_append`'s `Result<_, String>`.
const SEAL_MISSING_APPEND_MSG: &str =
    "audit log integrity seal is missing — appends are refused until the log is \
     repaired (run audit_repair_seal). Prior history can no longer be \
     cryptographically verified as complete.";

fn ensure_chain_head_matches_current_rows(c: &Connection) -> Result<()> {
    let rows = read_chain_rows(c)?;
    let actual = match verify_rows_and_build_head(&rows) {
        Ok(head) => head,
        Err(altered) => bail!("audit chain altered: {altered:?}"),
    };
    let stored = match read_chain_head(c)? {
        Some(head) => head,
        None => {
            // No head recorded. Only a genuinely fresh store (no row ever
            // inserted) may proceed with a genesis append. If rows survive
            // (partial truncation) OR every row was deleted after entries once
            // existed (full wipe: high-water > 0), this is the seal-missing
            // state — refuse the append fail-closed.
            if rows.is_empty() && max_ever_seq(c)? == 0 {
                return Ok(());
            }
            bail!(SEAL_MISSING_APPEND_MSG);
        }
    };
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
        if max_ever_seq(c)? == 0 {
            // Genuinely fresh store (no row was ever inserted): seed the zero
            // head so a first append has a valid genesis to build on.
            upsert_chain_head(
                c,
                &ChainHeadRecord {
                    entry_count: 0,
                    last_seq: 0,
                    last_hash: hex::encode(GENESIS_PREV_HASH),
                },
            )?;
        }
        // Otherwise every row was deleted after entries once existed (a full
        // wipe). Do NOT paper it over with a benign zero head — leave the seal
        // absent so the store opens in the fail-closed SealMissing state
        // (surviving_rows = 0), exactly like a partial truncation.
        return Ok(());
    }

    if added_hash_columns {
        // Migration note: this seals the existing log from now on. It does not
        // prove that legacy rows were untouched before the upgrade because no
        // chain existed yet to check against.
        backfill_hash_chain(c)?;
    }
    // FAIL-CLOSED: deliberately NO auto-seal for a pre-existing chain whose head
    // metadata is absent. Re-deriving a head over whatever rows survive would
    // silently reseal a truncated prefix as "valid" and erase the tamper
    // evidence this chain exists to provide (an attacker who deletes tail rows
    // AND the `chain_head_v1` seal would otherwise get a clean bill of health on
    // next open). A seal-missing store is instead surfaced as
    // `AuditChainVerification::SealMissing` and only re-sealed by an explicit,
    // anomaly-recording `repair`.

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

/// Build the permanent anomaly record written into the chain by `repair`. The
/// backend mints the id and timestamp (never the renderer) so a compromised
/// frontend cannot skip or forge the record. The entry documents WHEN the
/// missing seal was detected, HOW MANY rows survived, and that history before
/// this point can no longer be proven complete.
fn build_anomaly_record(surviving_rows: i64, last_verifiable_ts: Option<&str>) -> AuditEntryRecord {
    let now = chrono::Utc::now();
    let detected_at = now.to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    let id = format!(
        "audit_reseal_{}_{:06}",
        now.timestamp_millis(),
        rand::random::<u32>() % 1_000_000
    );
    let payload = serde_json::json!({
        "auditEventType": "audit_integrity_reseal",
        "detectedAt": detected_at,
        "survivingRows": surviving_rows,
        "lastVerifiableTimestamp": last_verifiable_ts,
        "note": "The audit log's integrity seal was missing on open. The surviving \
                 entries were re-sealed by an explicit, acknowledged repair. Entries \
                 recorded before this record can no longer be cryptographically \
                 verified as complete — the log may have been truncated.",
    });
    AuditEntryRecord {
        id,
        timestamp: detected_at,
        action: "audit_integrity_reseal".into(),
        description: format!(
            "Audit integrity seal was missing; {surviving_rows} surviving entr{} re-sealed by explicit repair. Prior completeness can no longer be cryptographically verified.",
            if surviving_rows == 1 { "y" } else { "ies" }
        ),
        payload_json: payload.to_string(),
    }
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
        crate::commands::data_dir::workspace_data_dir(workspace_root).join("audit-enc.db")
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
        let mut c = lock_unpoison(&self.conn);
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
        let c = lock_unpoison(&self.conn);
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
        let c = lock_unpoison(&self.conn);
        Ok(c.query_row("SELECT COUNT(*) FROM entries", [], |r| r.get(0))?)
    }

    /// Recompute the hash-chain from the genesis value through rows in `seq`
    /// order. The first mismatch pinpoints the earliest row whose contents or
    /// link no longer match the trusted Rust-computed seal.
    pub fn verify_chain(&self) -> Result<AuditChainVerification> {
        let c = lock_unpoison(&self.conn);
        let rows = read_chain_rows(&c)?;
        let actual = match verify_rows_and_build_head(&rows) {
            Ok(head) => head,
            Err(altered) => return Ok(altered),
        };
        let stored = match read_chain_head(&c) {
            Ok(Some(head)) => head,
            // The seal metadata is present but undecodable — the seal itself is
            // corrupt. That is tampering WITH the seal, not a clean missing
            // seal, and it is not recoverable by re-sealing the survivors, so
            // report it as Altered (loud), NOT the repairable SealMissing state.
            Err(_) => {
                return Ok(AuditChainVerification::Altered {
                    seq: 0,
                    id: "__chain_head__".into(),
                    reason: "chain head seal is corrupt".into(),
                    checked: actual.entry_count,
                });
            }
            // The seal is genuinely absent. The surviving rows (if any) already
            // verified as a valid per-row chain above, so we can prove internal
            // consistency but NOT completeness. Distinguish a fresh store from a
            // truncated one via the AUTOINCREMENT high-water mark, which
            // survives row deletion.
            Ok(None) => {
                if rows.is_empty() && max_ever_seq(&c)? == 0 {
                    // No row was ever inserted and there is no seal: a genuinely
                    // fresh/empty store.
                    return Ok(AuditChainVerification::Verified { checked: 0 });
                }
                // Rows survive (partial truncation) OR every row was deleted
                // after entries existed (full wipe: high-water > 0). Either way
                // the seal is gone over a log that once held entries.
                return Ok(AuditChainVerification::SealMissing {
                    surviving_rows: actual.entry_count,
                    last_timestamp: rows.last().map(|row| row.rec.timestamp.clone()),
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

    /// Explicit, acknowledged repair of a seal-missing audit log.
    ///
    /// Only valid from the `SealMissing` state (rows survive, the `chain_head_v1`
    /// seal is gone, and the surviving prefix still forms a valid per-row chain).
    /// It does NOT recover truncated rows — they are gone — but it makes the loss
    /// permanent and honest:
    ///   1. It FIRST writes a permanent anomaly record, chained onto the surviving
    ///      prefix, stating that the seal was missing and that prior completeness
    ///      can no longer be verified.
    ///   2. It THEN re-seals: the new `chain_head_v1` covers the surviving rows
    ///      AND the anomaly record, so the anomaly is itself part of the chain and
    ///      cannot later be silently dropped without detection.
    ///
    /// Refuses (returns `Err`) if the store is not in the seal-missing state, or
    /// if the surviving rows are not themselves a valid chain (that is a
    /// different, already-loud failure that this repair must not paper over).
    pub fn repair(&self) -> Result<AuditChainRepairReport> {
        let mut c = lock_unpoison(&self.conn);
        let tx = c.transaction()?;

        if read_chain_head(&tx)?.is_some() {
            bail!("audit store is not in a seal-missing state (chain head present) — nothing to repair");
        }
        let rows = read_chain_rows(&tx)?;
        if rows.is_empty() && max_ever_seq(&tx)? == 0 {
            bail!("audit store is empty and untampered — nothing to repair");
        }

        // Determine what the anomaly record chains onto. For a partial
        // truncation the surviving rows must themselves be a valid chain (we
        // re-seal over them). For a full wipe (no surviving rows, but the
        // high-water mark proves rows once existed) there is no prefix, so the
        // anomaly chains onto genesis and the re-sealed log records the loss.
        let (prev_hash_hex, surviving_rows, last_verifiable_timestamp) = if rows.is_empty() {
            (hex::encode(GENESIS_PREV_HASH), 0i64, None)
        } else {
            let prefix_head = match verify_rows_and_build_head(&rows) {
                Ok(head) => head,
                Err(altered) => bail!(
                    "surviving audit rows are not a valid chain, refusing to repair: {altered:?}"
                ),
            };
            let ts = rows.last().map(|row| row.rec.timestamp.clone());
            (prefix_head.last_hash, prefix_head.entry_count, ts)
        };

        // 1) Mint + insert the anomaly record, chained onto the surviving prefix
        //    (or onto genesis for a full wipe).
        let prev_hash =
            hex::decode(&prev_hash_hex).context("decode surviving prefix head hash")?;
        if !is_hash32(&prev_hash) {
            bail!("surviving prefix head hash is not a 32-byte digest");
        }
        let anomaly = build_anomaly_record(surviving_rows, last_verifiable_timestamp.as_deref());
        let changed = tx.execute(
            "INSERT OR IGNORE INTO entries
                (id, timestamp, action, description, payload_json, prev_hash, entry_hash)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, X'')",
            rusqlite::params![
                anomaly.id,
                anomaly.timestamp,
                anomaly.action,
                anomaly.description,
                anomaly.payload_json,
                prev_hash,
            ],
        )?;
        if changed == 0 {
            bail!("anomaly record id collided with an existing row; repair aborted");
        }
        let seq = tx.last_insert_rowid();
        let entry_hash = compute_entry_hash(&prev_hash, seq, &anomaly);
        tx.execute(
            "UPDATE entries SET entry_hash = ?1 WHERE seq = ?2",
            rusqlite::params![entry_hash.to_vec(), seq],
        )?;

        // 2) Re-seal over the surviving prefix AND the anomaly record.
        let total_entries: i64 = tx.query_row("SELECT COUNT(*) FROM entries", [], |r| r.get(0))?;
        upsert_chain_head(
            &tx,
            &ChainHeadRecord {
                entry_count: total_entries,
                last_seq: seq,
                last_hash: hex::encode(entry_hash),
            },
        )?;
        tx.commit()?;

        Ok(AuditChainRepairReport {
            surviving_rows,
            anomaly_id: anomaly.id,
            total_entries,
            last_verifiable_timestamp,
        })
    }

    /// Test-only: directly overwrite one row's payload, bypassing every
    /// append-time check, so callers OUTSIDE this module (e.g.
    /// `retention::reject_if_chain_altered`'s own tests) can exercise the
    /// "chain is genuinely altered" path without reaching into private
    /// fields. Never compiled into a non-test build.
    #[cfg(test)]
    pub(crate) fn tamper_payload_for_test(&self, id: &str, payload_json: &str) {
        let c = lock_unpoison(&self.conn);
        c.execute("UPDATE entries SET payload_json = ?1 WHERE id = ?2", rusqlite::params![payload_json, id])
            .unwrap();
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

    /// REPRODUCES THE GAP (red first). An attacker (or a bug) that deletes tail
    /// rows AND the `chain_head_v1` seal metadata must NOT get the store to
    /// silently re-derive a fresh head over the surviving prefix on next open —
    /// that would reseal a truncated log as "valid" and erase the tamper
    /// evidence the whole chain exists to provide.
    #[test]
    fn open_does_not_silently_reseal_truncated_prefix_when_head_deleted() {
        let dir = TempDir::new().unwrap();
        let key = [0x66u8; 32];

        // 1) A healthy three-entry chain, verified.
        {
            let s = EncryptedAuditStore::open_with_key(dir.path(), &key).unwrap();
            s.append(&rec("keep-1", "model_call")).unwrap();
            s.append(&rec("keep-2", "egress")).unwrap();
            s.append(&rec("gone-3", "file_update")).unwrap();
            assert_eq!(
                s.verify_chain().unwrap(),
                AuditChainVerification::Verified { checked: 3 }
            );
        }

        // 2) Tamper directly on disk: delete the tail row AND the chain-head seal.
        {
            let conn = Connection::open(EncryptedAuditStore::db_path(dir.path())).unwrap();
            conn.execute_batch(&format!("PRAGMA key = \"x'{}'\";", hex::encode(key)))
                .unwrap();
            conn.execute("DELETE FROM entries WHERE id = 'gone-3'", [])
                .unwrap();
            conn.execute(
                "DELETE FROM audit_metadata WHERE key = ?1",
                [CHAIN_HEAD_METADATA_KEY],
            )
            .unwrap();
        }

        // 3) Reopen. The surviving prefix must NOT be resealed as a valid chain;
        //    it must be surfaced as the fail-closed SealMissing state instead.
        let s = EncryptedAuditStore::open_with_key(dir.path(), &key).unwrap();
        assert_ne!(
            s.verify_chain().unwrap(),
            AuditChainVerification::Verified { checked: 2 },
            "SILENT RESEAL: a truncated prefix (tail row + chain-head seal both \
             deleted) must not be resealed as a valid 2-entry chain on reopen"
        );
        assert_eq!(
            s.verify_chain().unwrap(),
            AuditChainVerification::SealMissing {
                surviving_rows: 2,
                last_timestamp: Some("2026-06-09T00:00:00Z".into()),
            }
        );
        // Existing rows stay readable in the degraded state.
        assert_eq!(s.count().unwrap(), 2);
        assert_eq!(s.list(None, None).unwrap()[0].id, "keep-1");
    }

    #[test]
    fn fresh_store_appends_and_verifies_normally() {
        // A brand-new store (empty → carries a zero head) must still append and
        // verify cleanly — removing the silent reseal must not disturb the happy
        // path. This is the "fresh-store-still-works" guarantee.
        let (_d, s) = enc_store();
        assert_eq!(
            s.verify_chain().unwrap(),
            AuditChainVerification::Verified { checked: 0 }
        );
        s.append(&rec("f1", "model_call")).unwrap();
        s.append(&rec("f2", "egress")).unwrap();
        assert_eq!(s.count().unwrap(), 2);
        assert_eq!(
            s.verify_chain().unwrap(),
            AuditChainVerification::Verified { checked: 2 }
        );
    }

    /// Given a healthy chain, delete the tail row AND the seal metadata to force
    /// the seal-missing state. Returns the reopened store plus its temp dir/key.
    fn seal_missing_store() -> (TempDir, [u8; 32], EncryptedAuditStore) {
        let dir = TempDir::new().unwrap();
        let key = [0x77u8; 32];
        {
            let s = EncryptedAuditStore::open_with_key(dir.path(), &key).unwrap();
            s.append(&rec("keep-1", "model_call")).unwrap();
            s.append(&rec("keep-2", "egress")).unwrap();
            s.append(&rec("gone-3", "file_update")).unwrap();
        }
        {
            let conn = Connection::open(EncryptedAuditStore::db_path(dir.path())).unwrap();
            conn.execute_batch(&format!("PRAGMA key = \"x'{}'\";", hex::encode(key)))
                .unwrap();
            conn.execute("DELETE FROM entries WHERE id = 'gone-3'", [])
                .unwrap();
            conn.execute(
                "DELETE FROM audit_metadata WHERE key = ?1",
                [CHAIN_HEAD_METADATA_KEY],
            )
            .unwrap();
        }
        let s = EncryptedAuditStore::open_with_key(dir.path(), &key).unwrap();
        (dir, key, s)
    }

    #[test]
    fn degraded_seal_missing_store_refuses_appends() {
        let (_d, _k, s) = seal_missing_store();
        // Sanity: we're in the degraded state.
        assert!(matches!(
            s.verify_chain().unwrap(),
            AuditChainVerification::SealMissing { .. }
        ));
        // Appends are refused fail-closed until repair.
        let err = s.append(&rec("new-after-tamper", "model_call")).unwrap_err();
        assert!(
            err.to_string().contains("integrity seal is missing"),
            "append must refuse with an honest seal-missing message, got: {err}"
        );
        // Refusal left the store unchanged — no partial write.
        assert_eq!(s.count().unwrap(), 2);
    }

    #[test]
    fn repair_records_anomaly_then_restores_appends() {
        let (_d, _k, s) = seal_missing_store();

        // Repair re-seals the surviving prefix AND embeds the anomaly record.
        let report = s.repair().unwrap();
        assert_eq!(report.surviving_rows, 2);
        assert_eq!(report.total_entries, 3); // 2 surviving + 1 anomaly
        assert_eq!(
            report.last_verifiable_timestamp.as_deref(),
            Some("2026-06-09T00:00:00Z")
        );

        // The chain now verifies (3 entries: the 2 survivors + the anomaly).
        assert_eq!(
            s.verify_chain().unwrap(),
            AuditChainVerification::Verified { checked: 3 }
        );

        // The anomaly record is a permanent, readable part of the new chain.
        let entries = s.list(None, None).unwrap();
        assert_eq!(entries.len(), 3);
        let anomaly = entries.last().unwrap();
        assert_eq!(anomaly.id, report.anomaly_id);
        assert_eq!(anomaly.action, "audit_integrity_reseal");
        assert!(anomaly.payload_json.contains("survivingRows"));
        assert!(anomaly
            .payload_json
            .contains("can no longer be cryptographically"));

        // Appends work again after an acknowledged repair.
        assert!(s.append(&rec("post-repair", "egress")).unwrap());
        assert_eq!(
            s.verify_chain().unwrap(),
            AuditChainVerification::Verified { checked: 4 }
        );
    }

    #[test]
    fn repair_refuses_when_not_seal_missing() {
        // A healthy store (head present) has nothing to repair.
        let (_d, s) = enc_store();
        s.append(&rec("ok-1", "model_call")).unwrap();
        let err = s.repair().unwrap_err();
        assert!(
            err.to_string().contains("not in a seal-missing state"),
            "repair on a healthy store must refuse, got: {err}"
        );
        // And it did not mutate the chain.
        assert_eq!(s.count().unwrap(), 1);
        assert_eq!(
            s.verify_chain().unwrap(),
            AuditChainVerification::Verified { checked: 1 }
        );
    }

    #[test]
    fn full_wipe_all_rows_and_seal_deleted_is_seal_missing_and_repairable() {
        // The all-rows form of silent truncation: delete EVERY entry plus the
        // seal. A brand-new store would verify clean, so the fix must tell them
        // apart via the AUTOINCREMENT high-water mark (which survives deletion).
        let dir = TempDir::new().unwrap();
        let key = [0x88u8; 32];
        {
            let s = EncryptedAuditStore::open_with_key(dir.path(), &key).unwrap();
            s.append(&rec("w1", "model_call")).unwrap();
            s.append(&rec("w2", "egress")).unwrap();
            s.append(&rec("w3", "file_update")).unwrap();
        }
        {
            let conn = Connection::open(EncryptedAuditStore::db_path(dir.path())).unwrap();
            conn.execute_batch(&format!("PRAGMA key = \"x'{}'\";", hex::encode(key)))
                .unwrap();
            conn.execute("DELETE FROM entries", []).unwrap();
            conn.execute("DELETE FROM audit_metadata", []).unwrap();
        }
        let s = EncryptedAuditStore::open_with_key(dir.path(), &key).unwrap();
        assert_eq!(
            s.verify_chain().unwrap(),
            AuditChainVerification::SealMissing {
                surviving_rows: 0,
                last_timestamp: None,
            },
            "a wiped store must NOT be indistinguishable from a fresh one"
        );
        assert!(s
            .append(&rec("post-wipe", "model_call"))
            .unwrap_err()
            .to_string()
            .contains("integrity seal is missing"));

        // Repair chains the anomaly onto genesis and restores appends.
        let report = s.repair().unwrap();
        assert_eq!(report.surviving_rows, 0);
        assert_eq!(report.total_entries, 1);
        assert_eq!(
            s.verify_chain().unwrap(),
            AuditChainVerification::Verified { checked: 1 }
        );
        let entries = s.list(None, None).unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].action, "audit_integrity_reseal");
        assert!(s.append(&rec("after-repair", "egress")).unwrap());
        assert_eq!(
            s.verify_chain().unwrap(),
            AuditChainVerification::Verified { checked: 2 }
        );
    }

    #[test]
    fn corrupt_chain_head_seal_reports_altered_not_seal_missing() {
        // A seal that is PRESENT but undecodable is tampering with the seal
        // itself, not a clean missing seal. It must be reported Altered (loud),
        // NOT the repairable SealMissing state — otherwise verify would call it
        // repairable while repair() cannot handle it.
        let dir = TempDir::new().unwrap();
        let key = [0xC0u8; 32];
        {
            let s = EncryptedAuditStore::open_with_key(dir.path(), &key).unwrap();
            s.append(&rec("c1", "model_call")).unwrap();
            s.append(&rec("c2", "egress")).unwrap();
        }
        {
            let conn = Connection::open(EncryptedAuditStore::db_path(dir.path())).unwrap();
            conn.execute_batch(&format!("PRAGMA key = \"x'{}'\";", hex::encode(key)))
                .unwrap();
            conn.execute(
                "UPDATE audit_metadata SET value_json = ?1 WHERE key = ?2",
                rusqlite::params!["not-a-valid-chain-head", CHAIN_HEAD_METADATA_KEY],
            )
            .unwrap();
        }
        let s = EncryptedAuditStore::open_with_key(dir.path(), &key).unwrap();
        assert_eq!(
            s.verify_chain().unwrap(),
            AuditChainVerification::Altered {
                seq: 0,
                id: "__chain_head__".into(),
                reason: "chain head seal is corrupt".into(),
                checked: 2,
            }
        );
        // A corrupt seal is not the repairable SealMissing state.
        assert!(s.repair().is_err());
    }

    #[test]
    fn seal_missing_serializes_to_camel_case_wire_shape() {
        // The renderer's AuditIntegrityVerdict union expects exactly these keys.
        let v = AuditChainVerification::SealMissing {
            surviving_rows: 2,
            last_timestamp: Some("2026-06-09T00:00:00Z".into()),
        };
        let json: serde_json::Value = serde_json::to_value(&v).unwrap();
        assert_eq!(json["status"], "sealMissing");
        assert_eq!(json["survivingRows"], 2);
        assert_eq!(json["lastTimestamp"], "2026-06-09T00:00:00Z");
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
