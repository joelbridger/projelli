//! Retention policy enforcement (Wave 4 Track D). See sweep.rs for the engine
//! and the mandatory location-enumeration test.
pub mod sweep;

use sweep::{sweep_matter_folder, SweepOutcome};

const RETENTION_MODES: [&str; 3] = ["keep-everything", "delete-audio-after-days", "summary-only"];

pub(crate) fn new_audit_id() -> String {
    format!(
        "audit_{}_{:06}",
        chrono::Utc::now().timestamp_millis(),
        rand::random::<u32>() % 1_000_000
    )
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
            store.append(&entry).map(|_| ()).map_err(|e| format!("audit append for {}: {e}", d.path))
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
