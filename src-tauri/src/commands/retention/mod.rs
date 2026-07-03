//! Retention policy enforcement (Wave 4 Track D). See sweep.rs for the engine
//! and the mandatory location-enumeration test.
pub mod redact;
pub mod sweep;

use sweep::{sweep_matter_folder, SweepOutcome};

const RETENTION_MODES: [&str; 3] = ["keep-everything", "delete-audio-after-days", "summary-only"];

/// Where RAG-cleanup ids land the INSTANT a transcript deletion happens —
/// durably, synchronously, inside the same blocking Rust call that did the
/// delete, before `retention_sweep` even returns to the renderer. This
/// closes a real crash window: the renderer's OWN persistence
/// (`retentionRunner.ts`'s `setPendingRagCleanup`) only runs after the full
/// Tauri IPC round-trip completes, so a process crash between the Rust-side
/// delete and that JS line executing would otherwise lose these ids forever
/// (once transcript.json is gone, they can never be recomputed). The
/// renderer reads + clears this file once at workspace-open time
/// (`retention_take_pending_rag_cleanup`) and merges it into its own
/// pending-cleanup state, so even a full process kill in that narrow window
/// is recovered on the next launch.
const PENDING_RAG_CLEANUP_FILE: &str = ".lantern/pending-rag-cleanup.json";

pub(crate) fn new_audit_id() -> String {
    format!(
        "audit_{}_{:06}",
        chrono::Utc::now().timestamp_millis(),
        rand::random::<u32>() % 1_000_000
    )
}

fn read_pending_rag_cleanup_ids(path: &std::path::Path) -> Vec<String> {
    std::fs::read(path)
        .ok()
        .and_then(|raw| serde_json::from_slice::<serde_json::Value>(&raw).ok())
        .and_then(|v| v.get("ids").and_then(|i| i.as_array().cloned()))
        .map(|arr| arr.into_iter().filter_map(|x| x.as_str().map(str::to_string)).collect())
        .unwrap_or_default()
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
    let path = ws.join(PENDING_RAG_CLEANUP_FILE);
    let mut existing = read_pending_rag_cleanup_ids(&path);
    for id in ids {
        if !existing.contains(id) {
            existing.push(id.clone());
        }
    }
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("create .lantern dir: {e}"))?;
    }
    let payload = serde_json::json!({ "ids": existing });
    std::fs::write(&path, serde_json::to_vec(&payload).map_err(|e| e.to_string())?)
        .map_err(|e| format!("write pending-rag-cleanup.json: {e}"))
}

/// Read + clear the durable pending-RAG-cleanup file. Called once at
/// workspace-open time (`runRetentionSweep` in retentionRunner.ts) so ids
/// that survived a crash are merged into the renderer's own pending-cleanup
/// state instead of being lost. Clearing is best-effort: if the ids are
/// non-empty, the caller is now responsible for them (via the returned
/// list), so a failed clear just risks re-delivering the same ids next time
/// — which the renderer's own dedup (a Set union) already handles safely.
#[tauri::command]
pub async fn retention_take_pending_rag_cleanup(workspace: String) -> Result<Vec<String>, String> {
    tokio::task::spawn_blocking(move || {
        let path = std::path::Path::new(&workspace).join(PENDING_RAG_CLEANUP_FILE);
        let ids = read_pending_rag_cleanup_ids(&path);
        if !ids.is_empty() {
            let _ = std::fs::remove_file(&path);
        }
        Ok(ids)
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
        // Opening is cheap (no writes yet); a bad key/corrupt store fails here,
        // before a single file is removed.
        let store = crate::commands::audit::store::EncryptedAuditStore::open(ws)
            .map_err(|e| format!("open audit store: {e}"))?;
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

    #[test]
    fn pending_rag_cleanup_persists_across_appends_and_is_cleared_on_read() {
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
        // ...and a real read-and-clear (what retention_take_pending_rag_cleanup
        // does) removes it, so a second read comes back empty.
        std::fs::remove_file(&path).unwrap();
        assert!(read_pending_rag_cleanup_ids(&path).is_empty());
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
