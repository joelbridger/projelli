//! Retention policy enforcement (Wave 4 Track D). See sweep.rs for the engine
//! and the mandatory location-enumeration test.
pub mod redact;
pub mod sweep;

use sweep::{sweep_matter_folder, SweepOutcome};

const RETENTION_MODES: [&str; 3] = ["keep-everything", "delete-audio-after-days", "summary-only"];

/// Open the audit store AND verify its hash chain, refusing to proceed if
/// EITHER fails — before any deletion/redaction is attempted. `open()`
/// alone only opens/migrates the database; a chain that was ALTERED after
/// the fact (the exact thing this chain exists to detect) is only
/// discovered lazily inside `append()`, by which point a preflight that
/// merely opened the store would already have let the caller mutate files.
/// Shared by `retention_sweep` and `redact_meeting_segments` — both are
/// data-loss-critical operations that must never happen if their own audit
/// trail cannot be trusted.
pub(crate) fn preflight_audit_store(
    ws: &std::path::Path,
) -> Result<crate::commands::audit::store::EncryptedAuditStore, String> {
    let store = crate::commands::audit::store::EncryptedAuditStore::open(ws).map_err(|e| format!("open audit store: {e}"))?;
    reject_if_chain_altered(store)
}

/// The decision logic split out from `preflight_audit_store` so it's
/// unit-testable against a store opened with `open_with_key` (an in-memory
/// test key) instead of the real OS keychain `open()` goes through — tests
/// in this sandboxed environment hang against the real keychain (see the
/// PARK-HANDOFF gotcha this codebase already documents for `retention_sweep`).
fn reject_if_chain_altered(
    store: crate::commands::audit::store::EncryptedAuditStore,
) -> Result<crate::commands::audit::store::EncryptedAuditStore, String> {
    match store.verify_chain() {
        Ok(crate::commands::audit::store::AuditChainVerification::Verified { .. }) => Ok(store),
        Ok(crate::commands::audit::store::AuditChainVerification::Altered { seq, id, reason, .. }) => Err(format!(
            "audit chain is altered (entry {id} at seq {seq}: {reason}) — refusing to proceed without a trustworthy audit trail"
        )),
        Ok(crate::commands::audit::store::AuditChainVerification::SealMissing { surviving_rows, .. }) => Err(format!(
            "audit chain integrity seal is missing ({surviving_rows} surviving entries; prior completeness cannot be verified) — refusing to proceed without a trustworthy audit trail"
        )),
        Err(e) => Err(format!("verify audit chain: {e}")),
    }
}

/// Where RAG-cleanup ids land the INSTANT a transcript deletion or
/// redaction happens — durably, synchronously, inside the same blocking
/// Rust call that did the delete/redact, before the command even returns to
/// the renderer. This closes a real crash window: the renderer's OWN
/// persistence (`retentionRunner.ts`'s `setPendingRagCleanup`) only runs
/// after the full Tauri IPC round-trip completes, so a process crash
/// between the Rust-side write and that JS line executing would otherwise
/// lose these ids forever (once the source text is gone, they can never be
/// recomputed). This file is the PRIMARY durable record, not just a
/// one-shot recovery backstop: an id is removed from it only once
/// `retention_clear_pending_rag_cleanup_id` confirms it was actually
/// flushed (`rag_delete_path` succeeded) — `retention_read_pending_rag_cleanup`
/// is a plain, non-destructive read, so there is no window where a crash
/// between "Rust returns the ids" and "the renderer finishes acting on
/// them" can lose anything: the file still has them until they're
/// individually cleared.
const PENDING_RAG_CLEANUP_FILE: &str = ".lantern/pending-rag-cleanup.json";

pub(crate) fn new_audit_id() -> String {
    format!(
        "audit_{}_{:06}",
        chrono::Utc::now().timestamp_millis(),
        rand::random::<u32>() % 1_000_000
    )
}

/// A directory symlink can smuggle a write anywhere: `.lantern` (or a
/// meeting folder) being a symlink means every path built by joining onto
/// it resolves through that symlink, no matter how careful the file name
/// itself is. Refuse outright rather than silently writing through it.
fn refuse_symlink_parent(path: &std::path::Path) -> Result<(), String> {
    let Some(parent) = path.parent() else { return Ok(()) };
    match parent.symlink_metadata() {
        Ok(m) if m.file_type().is_symlink() => Err(format!("refused (symlink parent): {}", parent.display())),
        _ => Ok(()),
    }
}

/// Phase 1 of a two-phase atomic write: write `bytes` to a fresh, unique temp
/// file next to `path` and return its path. Nothing about `path` itself
/// changes yet — a failure here (disk full, interrupted write, permissions)
/// leaves the real file completely untouched, which is exactly the property
/// [`redact_segments_inner`] needs to stage BOTH transcript.json and
/// notes.docx before committing either: if staging either one fails, NEITHER
/// real file is touched, rather than one already being renamed into place.
///
/// The temp path is DETERMINISTIC (`<name>.retention-tmp`), so a stale
/// leftover from a prior crashed attempt — or a symlink an attacker planted
/// at that exact path — must never be silently written through.
/// `create_new` (`O_EXCL`) refuses to open if ANYTHING already exists there,
/// including a symlink (even a dangling one). A best-effort `remove_file`
/// first (itself symlink-safe: unlinking a symlink never touches its
/// target) clears a genuine stale leftover before the `create_new`; a
/// TOCTOU recreation between the two is still caught by `create_new`'s own
/// atomicity. `refuse_symlink_parent` additionally refuses if the
/// CONTAINING directory itself is a symlink (e.g. a symlinked `.lantern`),
/// which neither `create_new` nor `rename` would otherwise catch.
pub(crate) fn stage_atomically(path: &std::path::Path, bytes: &[u8]) -> Result<std::path::PathBuf, String> {
    use std::io::Write;
    refuse_symlink_parent(path)?;
    let file_name = path.file_name().and_then(|n| n.to_str()).unwrap_or("artifact");
    let tmp = path.with_file_name(format!("{file_name}.retention-tmp"));
    let _ = std::fs::remove_file(&tmp);
    let mut f = std::fs::File::options()
        .write(true)
        .create_new(true)
        .open(&tmp)
        .map_err(|e| format!("create {}: {e}", tmp.display()))?;
    f.write_all(bytes).map_err(|e| format!("write {}: {e}", tmp.display()))?;
    Ok(tmp)
}

/// Phase 2: atomically replace `path` with the already-staged `tmp`. This is
/// a single filesystem metadata operation (not a data copy), so once every
/// artifact in a multi-file update has been staged (phase 1, for every file,
/// all succeeded), the window where a commit failure could leave the update
/// half-applied shrinks from "however long a whole write takes" down to
/// "however long a `rename` syscall takes" — as close to atomic as this
/// engine gets without a full write-ahead log.
pub(crate) fn commit_atomically(tmp: &std::path::Path, path: &std::path::Path) -> Result<(), String> {
    std::fs::rename(tmp, path).map_err(|e| format!("rename {} -> {}: {e}", tmp.display(), path.display()))
}

/// Single-file convenience: stage then immediately commit.
pub(crate) fn write_atomically(path: &std::path::Path, bytes: &[u8]) -> Result<(), String> {
    let tmp = stage_atomically(path, bytes)?;
    commit_atomically(&tmp, path)
}

/// Guards every read-modify-write of `PENDING_RAG_CLEANUP_FILE`.
/// `write_atomically`'s rename makes any SINGLE write atomic, but
/// `append_pending_rag_cleanup` and `retention_clear_pending_rag_cleanup_id`
/// both READ the file, compute a new list, and write it back — two such
/// calls racing (e.g. a sweep's `on_delete` appending a fresh id while the
/// renderer is concurrently clearing an unrelated one already flushed) could
/// each read the same starting state and the second write to land would
/// silently clobber the first's change, dropping whichever id it added or
/// removed. All access to this file within the process goes through this
/// lock. (Retention operations are infrequent and never hot-path, so a
/// single global mutex — not per-workspace — is a fine, simple tradeoff.)
static PENDING_RAG_CLEANUP_LOCK: std::sync::LazyLock<std::sync::Mutex<()>> =
    std::sync::LazyLock::new(|| std::sync::Mutex::new(()));

fn read_pending_rag_cleanup_ids(path: &std::path::Path) -> Vec<String> {
    std::fs::read(path)
        .ok()
        .and_then(|raw| serde_json::from_slice::<serde_json::Value>(&raw).ok())
        .and_then(|v| v.get("ids").and_then(|i| i.as_array().cloned()))
        .map(|arr| arr.into_iter().filter_map(|x| x.as_str().map(str::to_string)).collect())
        .unwrap_or_default()
}

fn write_pending_rag_cleanup_ids(path: &std::path::Path, ids: &[String]) -> Result<(), String> {
    if ids.is_empty() {
        // The non-empty path below goes through write_atomically, which
        // refuses a symlinked PARENT directory (refuse_symlink_parent) —
        // this remove-on-empty branch bypassed that guard entirely: if
        // `.lantern` were a symlink, `remove_file` would resolve through it
        // and delete whatever sits at that path outside the workspace.
        if refuse_symlink_parent(path).is_ok() {
            let _ = std::fs::remove_file(path);
        }
        return Ok(());
    }
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("create .lantern dir: {e}"))?;
    }
    let payload = serde_json::json!({ "ids": ids });
    write_atomically(path, &serde_json::to_vec(&payload).map_err(|e| e.to_string())?)
}

/// Read-modify-write union (never drops ids already pending). Best effort: a
/// failure here is reported as a sweep error but never blocks or undoes the
/// deletion that already happened — the audit entry (which also carries
/// these same ids, see the `on_delete` closure below) is the fallback record
/// if this file write itself fails.
pub(crate) fn append_pending_rag_cleanup(ws: &std::path::Path, ids: &[String]) -> Result<(), String> {
    if ids.is_empty() {
        return Ok(());
    }
    let _guard = PENDING_RAG_CLEANUP_LOCK.lock().unwrap_or_else(|p| p.into_inner());
    let path = ws.join(PENDING_RAG_CLEANUP_FILE);
    let mut existing = read_pending_rag_cleanup_ids(&path);
    for id in ids {
        if !existing.contains(id) {
            existing.push(id.clone());
        }
    }
    write_pending_rag_cleanup_ids(&path, &existing)
}

/// Non-destructive read of the durable pending-RAG-cleanup file. Called once
/// at workspace-open time (`runRetentionSweep` in retentionRunner.ts) so ids
/// that survived a crash are merged into the renderer's own pending-cleanup
/// state. Deliberately does NOT clear the file — an id is only removed once
/// `retention_clear_pending_rag_cleanup_id` confirms it was actually
/// flushed, so there's no window between "Rust hands back the ids" and "the
/// renderer finishes acting on them" where a crash could lose anything.
#[tauri::command]
pub async fn retention_read_pending_rag_cleanup(workspace: String) -> Result<Vec<String>, String> {
    tokio::task::spawn_blocking(move || {
        let path = std::path::Path::new(&workspace).join(PENDING_RAG_CLEANUP_FILE);
        Ok(read_pending_rag_cleanup_ids(&path))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Remove exactly one id from the durable pending-RAG-cleanup file, once the
/// caller has confirmed it's genuinely been cleaned up (`rag_delete_path`
/// succeeded) — the counterpart to `retention_read_pending_rag_cleanup`.
#[tauri::command]
pub async fn retention_clear_pending_rag_cleanup_id(workspace: String, id: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        let _guard = PENDING_RAG_CLEANUP_LOCK.lock().unwrap_or_else(|p| p.into_inner());
        let path = std::path::Path::new(&workspace).join(PENDING_RAG_CLEANUP_FILE);
        let remaining: Vec<String> = read_pending_rag_cleanup_ids(&path).into_iter().filter(|x| x != &id).collect();
        write_pending_rag_cleanup_ids(&path, &remaining)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Sweep every given matter folder under `workspace_root` according to the
/// per-workspace retention policy, then append a hash-chained audit entry per
/// deletion plus one run summary. Deletion code: absolute or escaping matter
/// folders are refused outright, never best-effort swept.
#[tauri::command]
pub async fn retention_sweep(
    workspace_root: String,
    matter_folders: Vec<String>,
    mode: String,
    audio_retention_days: u32,
) -> Result<SweepOutcome, String> {
    tokio::task::spawn_blocking(move || {
        // Reject an unrecognized mode before touching disk at all. `sweep_matter_folder`
        // also reports unknown modes in `errors`, but only AFTER removing the
        // every-mode chunk-cache/progress-file artifacts for finalized meetings —
        // this is the deletion boundary, so a malformed mode must refuse outright,
        // never partially sweep.
        if !RETENTION_MODES.contains(&mode.as_str()) {
            return Err(format!("unknown retention mode: {mode}"));
        }
        let ws = std::path::Path::new(&workspace_root);
        let now_ms = chrono::Utc::now().timestamp_millis() as u64;
        let mut out = SweepOutcome::default();
        // Path safety (mirrors src-tauri/src/commands/vault/mod.rs:254): the sweep
        // deletes files, so it accepts ONLY workspace-relative folders and verifies
        // canonical containment before touching anything. An absolute input is a
        // caller bug — refuse it rather than "helpfully" sweeping it.
        let canon_ws = ws
            .canonicalize()
            .map_err(|e| format!("cannot canonicalize workspace: {e}"))?;
        // Validate every folder BEFORE opening the audit store (which can be a
        // slow OS-keychain round trip) or touching disk: a caller bug like an
        // absolute or escaping path must fail fast, not wait on the store first.
        let mut valid_folders: Vec<std::path::PathBuf> = Vec::with_capacity(matter_folders.len());
        for folder in &matter_folders {
            match sweep::canonicalize_workspace_relative(&canon_ws, folder)? {
                Some(abs) => valid_folders.push(abs),
                None => continue, // vanished since enumeration — nothing to sweep
            }
        }
        // Preflight the audit store BEFORE any deletion: this is data-loss-critical
        // code, so a deletion that cannot be durably recorded must never happen.
        // preflight_audit_store both opens AND verifies the hash chain — an
        // altered chain is only otherwise caught lazily inside append(), by
        // which point files would already be gone.
        let store = preflight_audit_store(ws)?;
        // Audit EVERY individual deletion the instant it happens — never
        // batched per-meeting, per-folder, or per-run. A process crash
        // anywhere in the sweep can then lose at most the ONE deletion that
        // was in flight, never a whole folder or run's worth of
        // already-deleted, not-yet-audited files. `rag_ids` (only non-empty
        // for a summary-only transcript.json delete) rides along in the SAME
        // audit entry, so those ids are durable the moment the file is gone —
        // not only inside the Tauri IPC response the renderer might crash
        // before finishing to process.
        let mode_for_audit = mode.clone();
        let mut on_delete = |d: &sweep::SweepDeletion, rag_ids: &[String]| -> Result<(), String> {
            // Durable side-file FIRST — the cheapest, most likely-to-succeed
            // write, and the primary safety net for the renderer-crash
            // window described on PENDING_RAG_CLEANUP_FILE above. A failure
            // here is folded into this call's returned error (still handled
            // as a non-fatal sweep error by remove_file/remove_dir), not
            // swallowed — but it never blocks the audit entry below, which
            // durably carries the same ids as a second, independent record.
            let mut pending_write_error = None;
            if let Err(e) = append_pending_rag_cleanup(&canon_ws, rag_ids) {
                pending_write_error = Some(e);
            }
            let entry_id = new_audit_id();
            let entry_ts = chrono::Utc::now().to_rfc3339();
            let entry = crate::commands::audit::store::AuditEntryRecord {
                id: entry_id.clone(),
                timestamp: entry_ts.clone(),
                action: "retention_delete".to_string(),
                description: format!("Retention policy removed {}: {}", d.kind, d.path),
                // FULL AuditEntry shape — the frontend reconstructs entries with
                // `JSON.parse(payloadJson) as AuditEntry`; a thin payload with no
                // `metadata` key white-screens the Activity Log (see the warning on
                // `crm_audit_payload_json`, src-tauri/src/commands/crm/commands.rs).
                payload_json: serde_json::json!({
                    "id": entry_id,
                    "timestamp": entry_ts,
                    "action": "retention_delete",
                    "description": format!("Retention policy removed {}: {}", d.kind, d.path),
                    "model": serde_json::Value::Null,
                    "inputs": { "mode": mode_for_audit, "kind": d.kind, "path": d.path, "ragCleanupSourceIds": rag_ids },
                    "outputs": {},
                    "userDecision": serde_json::Value::Null,
                    "metadata": {
                        "auditEventType": "retention_delete",
                        "source": "retention-backend",
                        "scope": { "kind": "allMatters" },
                    },
                }).to_string(),
            };
            // A failed audit append (e.g. a corrupted chain head) must NEVER
            // erase what the caller already knows: the file is ALREADY gone
            // by this point, so propagating Err out of the whole command
            // would drop `out` entirely — including every RAG-cleanup id
            // already collected — and the renderer would never learn a
            // deletion happened at all. Report the failure as a regular
            // sweep error (handled by remove_file/remove_dir, which push
            // whatever this returns into out.errors) and keep sweeping.
            let audit_result = store
                .append(&entry)
                .map(|_| ())
                .map_err(|e| format!("audit append for {}: {e}", d.path));
            match (pending_write_error, audit_result) {
                (Some(pe), Err(ae)) => Err(format!("{pe}; {ae}")),
                (Some(pe), Ok(())) => Err(pe),
                (None, res) => res,
            }
        };
        for abs in &valid_folders {
            sweep_matter_folder(abs, &canon_ws, &mode, audio_retention_days, now_ms, &mut out, &mut on_delete);
        }
        let summary_id = new_audit_id();
        let summary_ts = chrono::Utc::now().to_rfc3339();
        let summary_desc = format!(
            "Retention sweep ({mode}): removed {} items, kept {} meetings, skipped {} in flight, {} errors",
            out.deleted.len(), out.kept_meetings, out.skipped_in_flight, out.errors.len()
        );
        let summary = crate::commands::audit::store::AuditEntryRecord {
            id: summary_id.clone(),
            timestamp: summary_ts.clone(),
            action: "retention_swept".to_string(),
            description: summary_desc.clone(),
            // Same full-AuditEntry rule as above — metadata is mandatory.
            payload_json: serde_json::json!({
                "id": summary_id,
                "timestamp": summary_ts,
                "action": "retention_swept",
                "description": summary_desc,
                "model": serde_json::Value::Null,
                "inputs": { "mode": mode },
                "outputs": {
                    "deleted": out.deleted.len(),
                    "errors": out.errors,
                    "ragCleanupSourceIds": out.rag_cleanup_source_ids.len(),
                },
                "userDecision": serde_json::Value::Null,
                "metadata": {
                    "auditEventType": "retention_swept",
                    "source": "retention-backend",
                    "scope": { "kind": "allMatters" },
                },
            }).to_string(),
        };
        // Same reasoning as above: the summary is a convenience rollup, not
        // the record of truth for what was deleted — a failure to write it
        // must not hide the per-deletion outcome (and per-deletion audit
        // entries, where they succeeded) already gathered in `out`.
        if let Err(e) = store.append(&summary) {
            out.errors.push(format!("audit summary append: {e}"));
        }
        Ok(out)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn audit_entry_ids_are_unique_and_prefixed() {
        let a = new_audit_id();
        let b = new_audit_id();
        assert!(a.starts_with("audit_"));
        assert_ne!(a, b);
    }

    /// Uses `open_with_key` (in-memory test key), not `open`/`preflight_audit_store`
    /// itself, so this stays fast and doesn't touch the real OS keychain — this
    /// covers the DECISION logic `reject_if_chain_altered` makes, which is what
    /// `preflight_audit_store` delegates to after opening for real.
    #[test]
    fn reject_if_chain_altered_passes_a_healthy_chain_and_refuses_a_tampered_one() {
        use crate::commands::audit::store::{AuditEntryRecord, EncryptedAuditStore};
        let dir = tempfile::tempdir().unwrap();
        let key = [0x99u8; 32];

        // A brand-new store (zero entries) must pass — the schema-init step
        // seeds a valid genesis chain head even with nothing appended yet,
        // so this must NOT be mistaken for "chain head missing".
        let fresh = EncryptedAuditStore::open_with_key(dir.path(), &key).unwrap();
        assert!(reject_if_chain_altered(fresh).is_ok());

        // A healthy chain with real entries also passes.
        let s = EncryptedAuditStore::open_with_key(dir.path(), &key).unwrap();
        s.append(&AuditEntryRecord {
            id: "e1".into(),
            timestamp: "2026-01-01T00:00:00Z".into(),
            action: "retention_delete".into(),
            description: "d1".into(),
            payload_json: "{}".into(),
        })
        .unwrap();
        let s = EncryptedAuditStore::open_with_key(dir.path(), &key).unwrap();
        assert!(reject_if_chain_altered(s).is_ok());

        // Tamper with the row directly (bypassing append's own checks) —
        // the preflight must now refuse, BEFORE anything else runs.
        let dir2 = tempfile::tempdir().unwrap();
        let s2 = EncryptedAuditStore::open_with_key(dir2.path(), &key).unwrap();
        s2.append(&AuditEntryRecord {
            id: "e1".into(),
            timestamp: "2026-01-01T00:00:00Z".into(),
            action: "retention_delete".into(),
            description: "d1".into(),
            payload_json: "{}".into(),
        })
        .unwrap();
        s2.tamper_payload_for_test("e1", "{\"tampered\":true}");
        let err = match reject_if_chain_altered(s2) {
            Err(e) => e,
            Ok(_) => panic!("expected a tampered chain to be rejected"),
        };
        assert!(err.contains("altered"), "got: {err}");
    }

    /// A data-loss-critical op (sweep/redact) must ALSO refuse to proceed when
    /// the audit log is in the seal-missing state — a silently-truncated log
    /// whose seal was deleted is exactly the trust failure this preflight
    /// guards against. Mirrors the store-level fix at the retention boundary.
    #[test]
    fn reject_if_chain_altered_refuses_a_seal_missing_store() {
        use crate::commands::audit::store::{AuditEntryRecord, EncryptedAuditStore};
        let dir = tempfile::tempdir().unwrap();
        let key = [0xA1u8; 32];
        {
            let s = EncryptedAuditStore::open_with_key(dir.path(), &key).unwrap();
            for (i, id) in ["r1", "r2", "r3"].iter().enumerate() {
                s.append(&AuditEntryRecord {
                    id: (*id).into(),
                    timestamp: format!("2026-01-0{}T00:00:00Z", i + 1),
                    action: "retention_delete".into(),
                    description: "d".into(),
                    payload_json: "{}".into(),
                })
                .unwrap();
            }
        }
        // Simulate a silent truncation: delete the tail row AND the chain-head seal.
        {
            let conn =
                rusqlite::Connection::open(EncryptedAuditStore::db_path(dir.path())).unwrap();
            conn.execute_batch(&format!("PRAGMA key = \"x'{}'\";", hex::encode(key)))
                .unwrap();
            conn.execute("DELETE FROM entries WHERE id = 'r3'", [])
                .unwrap();
            conn.execute("DELETE FROM audit_metadata", []).unwrap();
        }
        let s = EncryptedAuditStore::open_with_key(dir.path(), &key).unwrap();
        let err = match reject_if_chain_altered(s) {
            Err(e) => e,
            Ok(_) => panic!("a seal-missing audit log must be refused for data-loss ops"),
        };
        assert!(err.contains("integrity seal is missing"), "got: {err}");
    }

    #[test]
    fn pending_rag_cleanup_persists_across_appends_and_survives_a_plain_read() {
        let ws = tempfile::tempdir().unwrap();
        append_pending_rag_cleanup(ws.path(), &["meeting:/a#0".to_string()]).unwrap();
        append_pending_rag_cleanup(ws.path(), &["meeting:/a#1".to_string(), "meeting:/a#0".to_string()]).unwrap();
        let path = ws.path().join(PENDING_RAG_CLEANUP_FILE);
        let ids = read_pending_rag_cleanup_ids(&path);
        // Union, deduplicated — the second append repeats one id already present.
        assert_eq!(ids, vec!["meeting:/a#0".to_string(), "meeting:/a#1".to_string()]);

        // The file survives an empty append (no-op) untouched...
        append_pending_rag_cleanup(ws.path(), &[]).unwrap();
        assert_eq!(read_pending_rag_cleanup_ids(&path).len(), 2);
        // ...and a plain read (what retention_read_pending_rag_cleanup does)
        // is non-destructive: reading twice returns the same ids both times,
        // so a crash between "Rust hands back the ids" and "the renderer
        // finishes acting on them" can't lose anything — only a confirmed
        // per-id clear (see the next test) removes an id.
        assert_eq!(read_pending_rag_cleanup_ids(&path).len(), 2);
    }

    #[test]
    fn pending_rag_cleanup_clear_removes_only_the_confirmed_id() {
        let ws = tempfile::tempdir().unwrap();
        append_pending_rag_cleanup(ws.path(), &["meeting:/a#0".to_string(), "meeting:/a#1".to_string()]).unwrap();
        let path = ws.path().join(PENDING_RAG_CLEANUP_FILE);

        let remaining: Vec<String> =
            read_pending_rag_cleanup_ids(&path).into_iter().filter(|x| x != "meeting:/a#0").collect();
        write_pending_rag_cleanup_ids(&path, &remaining).unwrap();
        assert_eq!(read_pending_rag_cleanup_ids(&path), vec!["meeting:/a#1".to_string()]);

        // Clearing the LAST remaining id removes the file entirely (an empty
        // ids list is just noise to keep around).
        write_pending_rag_cleanup_ids(&path, &[]).unwrap();
        assert!(!path.exists());
        assert!(read_pending_rag_cleanup_ids(&path).is_empty());
    }

    /// The empty-ids "clear" branch of write_pending_rag_cleanup_ids used to
    /// call remove_file directly, bypassing the symlinked-parent guard the
    /// non-empty (write_atomically) path already had. If `.lantern` is a
    /// symlink to somewhere outside the workspace, clearing the last pending
    /// id must NOT delete a same-named file at that external location.
    #[test]
    #[cfg(unix)]
    fn write_pending_rag_cleanup_ids_empty_branch_refuses_a_symlinked_parent() {
        let ws = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let victim = outside.path().join("pending-rag-cleanup.json");
        std::fs::write(&victim, b"not yours to delete").unwrap();
        std::os::unix::fs::symlink(outside.path(), ws.path().join(".lantern")).unwrap();

        let path = ws.path().join(PENDING_RAG_CLEANUP_FILE);
        write_pending_rag_cleanup_ids(&path, &[]).unwrap();

        assert!(victim.exists(), "must never delete through a symlinked parent directory");
    }

    /// If the deterministic temp path (`<name>.retention-tmp`) is already a
    /// symlink pointing outside the workspace — a stale leftover, or a
    /// planted attack — `write_atomically` must refuse to follow it, not
    /// silently write attacker-chosen content to the external target.
    #[test]
    #[cfg(unix)]
    fn write_atomically_refuses_to_follow_a_symlinked_temp_path() {
        let ws = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let victim = outside.path().join("victim.json");
        std::fs::write(&victim, b"untouched").unwrap();

        let target = ws.path().join("real.json");
        let tmp = ws.path().join("real.json.retention-tmp");
        std::os::unix::fs::symlink(&victim, &tmp).unwrap();

        write_atomically(&target, b"new content").unwrap();

        assert_eq!(std::fs::read(&victim).unwrap(), b"untouched", "the symlink target must never be written through");
        assert_eq!(std::fs::read(&target).unwrap(), b"new content", "the real write must still succeed (tmp is replaced, not followed)");
    }

    /// A symlinked CONTAINING directory (e.g. `.lantern` itself pointing
    /// outside the workspace) resolves every path built by joining onto it —
    /// neither the temp-path `create_new` guard nor `rename` would catch
    /// this on their own, since both operate on the FINAL path component,
    /// not the parent chain.
    #[test]
    #[cfg(unix)]
    fn write_atomically_refuses_a_symlinked_parent_directory() {
        let ws = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        std::os::unix::fs::symlink(outside.path(), ws.path().join(".lantern")).unwrap();

        let target = ws.path().join(".lantern/pending-rag-cleanup.json");
        let err = write_atomically(&target, b"payload").unwrap_err();
        assert!(err.contains("symlink"), "got: {err}");
        assert!(!outside.path().join("pending-rag-cleanup.json").exists(), "must never write through the symlinked parent");
    }

    /// append_pending_rag_cleanup and retention_clear_pending_rag_cleanup_id
    /// both do read-modify-write on the same file; without the global lock,
    /// concurrent calls racing could each read the same starting state and
    /// the second write to land would silently clobber the first's change.
    /// Spawn many threads each appending a DIFFERENT id concurrently and
    /// confirm every single one survives — a lost update would show up as
    /// fewer than N ids in the final file.
    #[test]
    fn concurrent_pending_rag_cleanup_appends_lose_no_ids() {
        let ws = tempfile::tempdir().unwrap();
        let ws_path = ws.path().to_path_buf();
        const N: usize = 24;
        let handles: Vec<_> = (0..N)
            .map(|i| {
                let ws_path = ws_path.clone();
                std::thread::spawn(move || {
                    append_pending_rag_cleanup(&ws_path, &[format!("meeting:/concurrent#{i}")]).unwrap();
                })
            })
            .collect();
        for h in handles {
            h.join().unwrap();
        }
        let path = ws_path.join(PENDING_RAG_CLEANUP_FILE);
        let ids = read_pending_rag_cleanup_ids(&path);
        assert_eq!(ids.len(), N, "a lost update would drop one or more concurrently-appended ids; got: {ids:?}");
        for i in 0..N {
            assert!(ids.contains(&format!("meeting:/concurrent#{i}")), "missing id {i}");
        }
    }

    #[tokio::test]
    async fn retention_sweep_rejects_absolute_matter_folders() {
        let ws = tempfile::tempdir().unwrap();
        let err = retention_sweep(
            ws.path().to_string_lossy().into_owned(),
            vec!["/etc".into()],
            "keep-everything".into(),
            30,
        )
        .await
        .unwrap_err();
        assert!(err.contains("workspace-relative"), "got: {err}");
    }

    /// A matter folder that is itself a symlink to a DIFFERENT, real
    /// in-workspace client folder must be refused outright — a plain
    /// canonicalize()+starts_with() check would follow the symlink (the
    /// target really is inside the workspace) and let the sweep
    /// mutate/delete a DIFFERENT client's files while the caller's own
    /// matter-folder string still names the alias.
    #[cfg(unix)]
    #[tokio::test]
    async fn retention_sweep_rejects_a_symlinked_matter_folder() {
        let ws = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(ws.path().join("Clients/RealClient/Meetings")).unwrap();
        std::os::unix::fs::symlink(
            ws.path().join("Clients/RealClient"),
            ws.path().join("Clients/Alias"),
        )
        .unwrap();

        let err = retention_sweep(
            ws.path().to_string_lossy().into_owned(),
            vec!["Clients/Alias".into()],
            "keep-everything".into(),
            30,
        )
        .await
        .unwrap_err();
        assert!(err.contains("symlink"), "got: {err}");
    }

    #[tokio::test]
    async fn retention_sweep_rejects_unknown_mode_before_touching_disk() {
        let ws = tempfile::tempdir().unwrap();
        let matter = ws.path().join("Clients/H");
        std::fs::create_dir_all(matter.join("Meetings/2026-01-01-x/.capture")).unwrap();
        std::fs::write(matter.join("Meetings/2026-01-01-x/transcript.json"), br#"{"segments":[],"meta":{}}"#).unwrap();
        std::fs::write(matter.join("Meetings/2026-01-01-x/.capture/mic.wav"), b"x").unwrap();

        let err = retention_sweep(
            ws.path().to_string_lossy().into_owned(),
            vec!["Clients/H".into()],
            "nuke-it-all".into(),
            30,
        )
        .await
        .unwrap_err();
        assert!(err.contains("unknown retention mode"), "got: {err}");
        // Nothing touched — not even the always-cleared chunk cache.
        assert!(matter.join("Meetings/2026-01-01-x/.capture").exists());
    }
}
