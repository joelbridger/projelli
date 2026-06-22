// Encrypted audit store — Tauri command surface for Keepance 3.0.
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

use store::{AuditChainVerification, AuditEntryRecord, EncryptedAuditStore};
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
pub async fn audit_set_workspace(state: State<'_, AuditState>, path: String) -> Result<(), String> {
    *state.workspace.lock().await = Some(std::path::PathBuf::from(path));
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
