// Encrypted audit store — Tauri command surface for Advisor Prep Hero 3.0.
//
// The renderer's `AuditService` persists to this SQLCipher-encrypted,
// append-only store on the desktop (and falls back to localStorage, clearly
// labelled unencrypted, in the browser). The store itself lives in `store.rs`;
// its master key lives in the OS keychain (`crypto.rs`). This module wires the
// store to Tauri:
//
//   - `audit_set_workspace(path)` — point the store at a workspace (mirrors
//     `mail_set_workspace`). Must be called before append/list.
//   - `audit_append(entry)`       — append one entry (append-only).
//   - `audit_list(limit, offset)` — read entries back in insertion order.
//   - `audit_count()`             — entry count (diagnostics).
//   - `audit_verify_integrity()`  — recompute the hash-chain and report the
//                                   first broken row, if any.
//
// All DB/keychain work is blocking (sqlite + keyring), so each command hops to
// `spawn_blocking` off the async runtime, exactly like the mail commands.

pub mod crypto;
pub mod store;

use store::{
    AuditChainRepairReport, AuditChainVerification, AuditEntryRecord, EncryptedAuditStore,
};
use tauri::{Manager, State};

/// Shared state: the active workspace root the audit store opens under. `None`
/// until `audit_set_workspace` is called (mirrors `MailState`).
pub struct AuditState {
    pub workspace: tokio::sync::Mutex<Option<std::path::PathBuf>>,
}

/// Register `AuditState` on the app (called from `lib.rs` setup).
pub fn manage_state(app: &tauri::App) {
    app.manage(AuditState {
        workspace: tokio::sync::Mutex::new(None),
    });
}

#[tauri::command]
pub async fn audit_set_workspace(
    state: State<'_, AuditState>,
    policy: State<'_, crate::network_policy::NetworkPolicy>,
    path: String,
) -> Result<(), String> {
    let workspace = std::path::PathBuf::from(path);
    policy.set_audit_workspace(workspace.clone());
    *state.workspace.lock().await = Some(workspace);
    Ok(())
}

/// Append one audit entry to the encrypted store. Append-only: a duplicate id is
/// ignored, never overwritten. No-op-safe to call repeatedly.
#[tauri::command]
pub async fn audit_append(
    state: State<'_, AuditState>,
    entry: AuditEntryRecord,
) -> Result<(), String> {
    let workspace = state
        .workspace
        .lock()
        .await
        .clone()
        .ok_or("audit workspace not set")?;
    tokio::task::spawn_blocking(move || -> anyhow::Result<()> {
        let store = EncryptedAuditStore::open(&workspace)?;
        store.append(&entry)?;
        Ok(())
    })
    .await
    .map_err(|e| format!("join: {e}"))?
    .map_err(|e| e.to_string())
}

/// List audit entries in insertion order (oldest first). `limit`/`offset` are
/// optional; omitting both returns every entry.
#[tauri::command]
pub async fn audit_list(
    state: State<'_, AuditState>,
    limit: Option<i64>,
    offset: Option<i64>,
) -> Result<Vec<AuditEntryRecord>, String> {
    let workspace = state
        .workspace
        .lock()
        .await
        .clone()
        .ok_or("audit workspace not set")?;
    tokio::task::spawn_blocking(move || -> anyhow::Result<Vec<AuditEntryRecord>> {
        let store = EncryptedAuditStore::open(&workspace)?;
        store.list(limit, offset)
    })
    .await
    .map_err(|e| format!("join: {e}"))?
    .map_err(|e| e.to_string())
}

/// Total number of audit entries in the encrypted store.
#[tauri::command]
pub async fn audit_count(state: State<'_, AuditState>) -> Result<i64, String> {
    let workspace = state
        .workspace
        .lock()
        .await
        .clone()
        .ok_or("audit workspace not set")?;
    tokio::task::spawn_blocking(move || -> anyhow::Result<i64> {
        let store = EncryptedAuditStore::open(&workspace)?;
        store.count()
    })
    .await
    .map_err(|e| format!("join: {e}"))?
    .map_err(|e| e.to_string())
}

/// Verify the encrypted audit log hash-chain.
#[tauri::command]
pub async fn audit_verify_integrity(
    state: State<'_, AuditState>,
) -> Result<AuditChainVerification, String> {
    let workspace = state
        .workspace
        .lock()
        .await
        .clone()
        .ok_or("audit workspace not set")?;
    tokio::task::spawn_blocking(move || -> anyhow::Result<AuditChainVerification> {
        let store = EncryptedAuditStore::open(&workspace)?;
        store.verify_chain()
    })
    .await
    .map_err(|e| format!("join: {e}"))?
    .map_err(|e| e.to_string())
}

/// Repair a seal-missing (tamper-evident-degraded) audit log. Explicit and
/// acknowledged: it re-seals the surviving prefix but FIRST writes a permanent
/// anomaly record into the new chain, so the loss is recorded honestly rather
/// than silently papered over. Returns what was re-sealed. Errors (surfaced to
/// the renderer) if the store is not in the seal-missing state.
#[tauri::command]
pub async fn audit_repair_seal(
    state: State<'_, AuditState>,
) -> Result<AuditChainRepairReport, String> {
    let workspace = state
        .workspace
        .lock()
        .await
        .clone()
        .ok_or("audit workspace not set")?;
    tokio::task::spawn_blocking(move || -> anyhow::Result<AuditChainRepairReport> {
        let store = EncryptedAuditStore::open(&workspace)?;
        store.repair()
    })
    .await
    .map_err(|e| format!("join: {e}"))?
    .map_err(|e| e.to_string())
}
