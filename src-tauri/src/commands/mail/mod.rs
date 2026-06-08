pub mod model;
pub mod normalize;
pub mod provider;
pub mod store;
pub mod graph;
pub mod oauth;
pub mod sync;
pub mod crypto;
pub mod fde;
pub mod imap;

use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager, State};
use crate::commands::mail::oauth::{OAuth, TokenOutcome};
use crate::commands::mail::provider::MailProvider;
use crate::commands::mail::store::EncryptedMailStore;

const KEYCHAIN_SERVICE: &str = "keepance-mail-ms";
const KEYCHAIN_REFRESH_KEY: &str = "ms-refresh-token";
/// Account id for the single Microsoft 365 account (one refresh token today).
/// Cursors are scoped by (provider, account, folder); see `sync_folder_provider`.
const M365_ACCOUNT: &str = "default";

const IMAP_KEYCHAIN_SERVICE: &str = "keepance-mail-imap";
const IMAP_CONFIG_KEY: &str = "config"; // JSON {account,host,port,username}
const IMAP_PASSWORD_KEY: &str = "password";
pub const SYNC_PROGRESS_EVENT: &str = "mail-sync-progress";
/// G5: per-message event that carries decrypted text to the renderer for
/// MiniSearch indexing. The text lives only in renderer-process memory.
pub const MAIL_INDEX_CHUNK_EVENT: &str = "mail-index-chunk";

/// G5: payload for the mail-index-chunk Tauri event.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MailIndexChunkPayload {
    pub doc_id: String,
    pub subject: String,
    pub decrypted_text: String,
}

pub struct MailState {
    pub workspace: tokio::sync::Mutex<Option<std::path::PathBuf>>,
    pub cancel: Arc<AtomicBool>,
    pub is_syncing: Arc<AtomicBool>,
}

pub fn manage_state(app: &tauri::App) {
    app.manage(MailState {
        workspace: tokio::sync::Mutex::new(None),
        cancel: Arc::new(AtomicBool::new(false)),
        is_syncing: Arc::new(AtomicBool::new(false)),
    });
}

/// RAII guard: sets `is_syncing` to false when dropped, covering all exit paths.
struct SyncGuard(Arc<AtomicBool>);
impl Drop for SyncGuard {
    fn drop(&mut self) {
        self.0.store(false, Ordering::SeqCst);
    }
}

fn client_id() -> String {
    option_env!("KEEPANCE_MS_CLIENT_ID")
        .unwrap_or("845ddba0-70ab-4f90-88ba-e3522157e37a")
        .to_string()
}

/// Reverse `normalize::yaml_escape` for a double-quoted scalar value: `\n`/`\r`
/// become a space, `\"` a quote, `\\` a backslash. Char-based so an escaped
/// backslash followed by `n` is not mistaken for an escaped newline.
fn yaml_unescape(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut chars = s.chars();
    while let Some(c) = chars.next() {
        if c == '\\' {
            match chars.next() {
                Some('n') | Some('r') => out.push(' '),
                Some('"') => out.push('"'),
                Some('\\') => out.push('\\'),
                Some(other) => {
                    out.push('\\');
                    out.push(other);
                }
                None => out.push('\\'),
            }
        } else {
            out.push(c);
        }
    }
    out
}

/// Extract the `subject` from a normalized mail document's YAML frontmatter.
/// Scans only the fenced frontmatter block, strips the surrounding double
/// quotes, and reverses `yaml_escape`. Returns "" if not present.
fn frontmatter_subject(markdown: &str) -> String {
    let mut in_frontmatter = false;
    for line in markdown.lines() {
        if line.trim() == "---" {
            if in_frontmatter {
                break; // closing fence reached
            }
            in_frontmatter = true;
            continue;
        }
        if !in_frontmatter {
            continue;
        }
        if let Some(rest) = line.strip_prefix("subject:") {
            let v = rest.trim();
            let inner = v
                .strip_prefix('"')
                .and_then(|s| s.strip_suffix('"'))
                .unwrap_or(v);
            return yaml_unescape(inner);
        }
    }
    String::new()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceCodePrompt {
    pub user_code: String,
    pub verification_uri: String,
    pub device_code: String,
    pub interval_secs: u64,
    pub expires_in_secs: u64,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SyncProgress {
    pub status: String,
    pub folder: Option<String>,
    pub written: u32,
    pub removed: u32,
}

/// Stored IMAP account configuration (no password — stored separately).
#[derive(serde::Serialize, serde::Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ImapConfig {
    pub account: String,
    pub host: String,
    pub port: u16,
    pub username: String,
}

/// Load the stored IMAP config + password from the keychain, if configured.
fn load_imap_config() -> Option<(ImapConfig, String)> {
    let cfg_e = keyring::Entry::new(IMAP_KEYCHAIN_SERVICE, IMAP_CONFIG_KEY).ok()?;
    let cfg_json = cfg_e.get_password().ok()?;
    let cfg: ImapConfig = serde_json::from_str(&cfg_json).ok()?;
    let pw_e = keyring::Entry::new(IMAP_KEYCHAIN_SERVICE, IMAP_PASSWORD_KEY).ok()?;
    let pw = pw_e.get_password().ok()?;
    Some((cfg, pw))
}

#[tauri::command]
pub async fn mail_set_workspace(
    state: State<'_, MailState>,
    path: String,
) -> Result<(), String> {
    *state.workspace.lock().await = Some(std::path::PathBuf::from(path));
    Ok(())
}

#[tauri::command]
pub async fn mail_begin_login() -> Result<DeviceCodePrompt, String> {
    let auth = OAuth::new(client_id());
    let dc = auth.request_device_code().await.map_err(|e| e.to_string())?;
    Ok(DeviceCodePrompt {
        user_code: dc.user_code,
        verification_uri: dc.verification_uri,
        device_code: dc.device_code,
        interval_secs: dc.interval_secs,
        expires_in_secs: dc.expires_in_secs,
    })
}

/// Poll once; the frontend calls this on `interval_secs`. Returns a status:
/// - `"authorized"` — signed in; the refresh token is stored in the OS keychain.
/// - `"pending"` — keep polling at the current interval.
/// - `"slow_down"` — poll less often; the caller must lengthen the interval
///   (RFC 8628 §3.5 requires +5s), otherwise Microsoft escalates throttling.
#[tauri::command]
pub async fn mail_poll_login(device_code: String) -> Result<String, String> {
    let auth = OAuth::new(client_id());
    match auth.poll_token(&device_code).await.map_err(|e| e.to_string())? {
        TokenOutcome::Tokens { refresh: Some(rt), .. } => {
            let entry = keyring::Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_REFRESH_KEY)
                .map_err(|e| e.to_string())?;
            entry.set_password(&rt).map_err(|e| e.to_string())?;
            Ok("authorized".into())
        }
        TokenOutcome::Tokens { refresh: None, .. } => Err("no refresh token returned".into()),
        TokenOutcome::Pending => Ok("pending".into()),
        TokenOutcome::SlowDown => Ok("slow_down".into()),
        TokenOutcome::Failed(e) => Err(e),
    }
}

#[tauri::command]
pub async fn mail_is_connected() -> Result<bool, String> {
    let entry = keyring::Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_REFRESH_KEY)
        .map_err(|e| e.to_string())?;
    Ok(entry.get_password().is_ok())
}

async fn fresh_access_token() -> Result<String, String> {
    let entry = keyring::Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_REFRESH_KEY)
        .map_err(|e| e.to_string())?;
    let rt = entry.get_password().map_err(|_| "not connected".to_string())?;
    let auth = OAuth::new(client_id());
    match auth.refresh(&rt).await.map_err(|e| e.to_string())? {
        TokenOutcome::Tokens { access, refresh, .. } => {
            if let Some(new_rt) = refresh {
                let _ = entry.set_password(&new_rt); // refresh-token rotation
            }
            Ok(access)
        }
        TokenOutcome::Failed(e) => Err(format!("refresh failed: {e}")),
        _ => Err("unexpected refresh outcome".into()),
    }
}

#[tauri::command]
pub async fn mail_cancel_sync(state: State<'_, MailState>) -> Result<(), String> {
    state.cancel.store(true, Ordering::SeqCst);
    Ok(())
}

/// Validate IMAP credentials by listing folders, then store them in the OS keychain.
/// account id = the username (email). Never logs the password.
#[tauri::command]
pub async fn mail_imap_connect(
    host: String,
    port: u16,
    username: String,
    password: String,
) -> Result<(), String> {
    use crate::commands::mail::imap::ImapProvider;
    let provider = ImapProvider {
        host: host.clone(),
        port,
        username: username.clone(),
        password: password.clone(),
        account: username.clone(),
    };
    // Validate the connection (also rejects bad host/credentials up front).
    provider.list_folders().await.map_err(|e| format!("Could not connect: {e}"))?;
    let cfg = ImapConfig { account: username.clone(), host, port, username };
    let cfg_json = serde_json::to_string(&cfg).map_err(|e| e.to_string())?;
    keyring::Entry::new(IMAP_KEYCHAIN_SERVICE, IMAP_CONFIG_KEY)
        .map_err(|e| e.to_string())?
        .set_password(&cfg_json)
        .map_err(|e| e.to_string())?;
    keyring::Entry::new(IMAP_KEYCHAIN_SERVICE, IMAP_PASSWORD_KEY)
        .map_err(|e| e.to_string())?
        .set_password(&password)
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn mail_imap_is_connected() -> Result<bool, String> {
    Ok(load_imap_config().is_some())
}

#[tauri::command]
pub async fn mail_imap_disconnect() -> Result<(), String> {
    if let Ok(e) = keyring::Entry::new(IMAP_KEYCHAIN_SERVICE, IMAP_CONFIG_KEY) {
        let _ = e.delete_credential();
    }
    if let Ok(e) = keyring::Entry::new(IMAP_KEYCHAIN_SERVICE, IMAP_PASSWORD_KEY) {
        let _ = e.delete_credential();
    }
    Ok(())
}

/// G4 / N2: Internal mail RAG indexer — takes raw parameters instead of Tauri
/// State, called directly from the sync callback without going through IPC.
/// The former rag_index_mail_text Tauri command (which shipped plaintext over
/// IPC) has been removed (N2); this function is the sole indexing path.
///
/// `path_key` is already formatted as "mail:<doc_id>" by the caller.
/// Encrypts chunk text before storing in LanceDB. Idempotent (deletes stale
/// rows first). Returns Ok(0) if plaintext is empty. Errors are logged by caller.
async fn index_mail_text_internal(
    workspace: &std::path::Path,
    path_key: &str,
    plaintext: &str,
    key: &[u8; 32],
) -> anyhow::Result<u32> {
    use anyhow::Context;
    if plaintext.trim().is_empty() {
        return Ok(0);
    }
    let conn = crate::commands::rag::store::open_connection(workspace)
        .await
        .context("open lancedb for mail indexing")?;
    let table = crate::commands::rag::store::open_or_create_table(&conn)
        .await
        .context("open/create chunks table")?;

    let chunks = crate::commands::rag::chunker::chunk_text(path_key, plaintext);

    // Delete stale rows before inserting (idempotent).
    crate::commands::rag::store::delete_path(&table, path_key)
        .await
        .context("delete stale mail chunks")?;

    if chunks.is_empty() {
        return Ok(0);
    }

    let texts: Vec<String> = chunks.iter().map(|c| c.text.clone()).collect();
    let vectors = crate::commands::rag::embedder::embed_documents(&texts)
        .await
        .context("embed mail chunks")?;
    let rows: Vec<(crate::commands::rag::chunker::Chunk, Vec<f32>)> =
        chunks.into_iter().zip(vectors).collect();

    let batch = crate::commands::rag::store::build_batch_mail(&rows, key)
        .context("build mail batch")?;
    let schema = batch.schema();
    use arrow_array::RecordBatchIterator;
    table
        .add(Box::new(RecordBatchIterator::new(vec![Ok(batch)], schema)))
        .execute()
        .await
        .context("add mail chunks to lancedb")?;

    Ok(rows.len() as u32)
}

/// Enumerate folders then sync each to its deltaLink, emitting progress.
#[tauri::command]
pub async fn mail_sync_all(
    app: AppHandle,
    state: State<'_, MailState>,
) -> Result<(), String> {
    // FIX A: atomically claim the sync slot; reject if already in progress.
    // We do NOT reset `cancel` here if we bail early — an in-flight sync owns it.
    if state.is_syncing
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return Err("a sync is already in progress".into());
    }
    // RAII guard: restores is_syncing=false on every exit path (success, early
    // return from cancel check, or any ? propagation below).
    let _sync_guard = SyncGuard(state.is_syncing.clone());

    // Only reset cancel now that we hold the sync slot.
    state.cancel.store(false, Ordering::SeqCst);

    // Run the sync; on ANY failure emit a terminal "error" progress event so the
    // UI stops showing a spinner (the frontend listens for sync-progress).
    let outcome = mail_sync_all_inner(&app, &state).await;
    if let Err(ref e) = outcome {
        log::warn!("mail sync failed: {}", e);
        let _ = app.emit(
            SYNC_PROGRESS_EVENT,
            SyncProgress { status: "error".into(), folder: None, written: 0, removed: 0 },
        );
    }
    outcome
}

/// Inner worker for `mail_sync_all`. The sync-slot guard and the terminal
/// "error" event are owned by the command wrapper; this fn just does the work.
async fn mail_sync_all_inner(
    app: &AppHandle,
    state: &State<'_, MailState>,
) -> Result<(), String> {
    let workspace = state
        .workspace
        .lock()
        .await
        .clone()
        .ok_or("workspace not set")?;
    let cancel = state.cancel.clone();

    // G7: Remove any plaintext Phase-1 Mail/ directory before the encrypted sync begins.
    // Idempotent: no-op if Mail/ does not exist.
    sync::migrate_plaintext(&workspace);

    let store = EncryptedMailStore::open(&workspace).map_err(|e| e.to_string())?;
    let enc_key = crate::commands::mail::crypto::get_or_create_master_key()
        .map_err(|e| e.to_string())?;

    // Enumerate folders through the provider seam (M365 GraphProvider for now;
    // Gmail/IMAP providers slot in here unchanged).
    let folders = {
        let token = fresh_access_token().await?;
        let provider = crate::commands::mail::graph::GraphProvider::new(token);
        provider.list_folders().await.map_err(|e| e.to_string())?
    };

    // FIX B: refresh the access token before each folder so long backfills
    // never outlive the 3600-second token lifetime.
    for folder in folders {
        if cancel.load(Ordering::SeqCst) {
            let _ = app.emit(
                SYNC_PROGRESS_EVENT,
                SyncProgress {
                    status: "cancelled".into(),
                    folder: None,
                    written: 0,
                    removed: 0,
                },
            );
            return Ok(());
        }
        let token = fresh_access_token().await?;
        let provider = crate::commands::mail::graph::GraphProvider::new(token);
        let app2 = app.clone();
        let fid2 = folder.id.clone();
        let emit = move |w: u32, r: u32| {
            let _ = app2.emit(
                SYNC_PROGRESS_EVENT,
                SyncProgress {
                    status: "syncing".into(),
                    folder: Some(fid2.clone()),
                    written: w,
                    removed: r,
                },
            );
        };
        // G4+G5: index_callback receives (doc_id, plaintext_markdown) for each
        // new message. We:
        //   1. Spawn an async task to call index_mail_text_internal (RAG/LanceDB, G4).
        //   2. Emit a mail-index-chunk Tauri event so the renderer feeds the
        //      decrypted text into MiniSearch in-memory (G5). The plaintext
        //      never touches disk — it lives only in renderer-process memory.
        let workspace_for_index = workspace.clone();
        let enc_key_for_index = enc_key;
        let app3 = app.clone();
        let index_callback = move |id: &str, text: &str| {
            let path_key = format!("mail:{}", id);
            let text_owned = text.to_string();
            let ws = workspace_for_index.clone();
            let key = enc_key_for_index;
            // Fire-and-forget RAG indexing (G4).
            let _ = tokio::task::spawn(async move {
                if let Err(e) = index_mail_text_internal(&ws, &path_key, &text_owned, &key).await {
                    log::warn!("G4 mail index failed for {}: {}", path_key, e);
                }
            });
            // G5: pull the subject from the frontmatter (scoped to the fenced
            // block, unquoted + unescaped) and emit the event for MiniSearch.
            let subject = frontmatter_subject(text);
            let _ = app3.emit(MAIL_INDEX_CHUNK_EVENT, MailIndexChunkPayload {
                doc_id: id.to_string(),
                subject,
                decrypted_text: text.to_string(),
            });
        };
        // S3: tombstone_callback fires for each deleted message. It spawns a
        // fire-and-forget async task to remove the LanceDB RAG chunks keyed
        // "mail:<id>" so deleted email stops surfacing in rag_retrieve.
        let workspace_for_tombstone = workspace.clone();
        let tombstone_callback = move |id: &str| {
            let path_key = format!("mail:{}", id);
            let ws = workspace_for_tombstone.clone();
            let _ = tokio::task::spawn(async move {
                // Reuse the same store::delete_path helper used by rag_delete_path.
                match crate::commands::rag::store::open_connection(&ws).await {
                    Ok(conn) => {
                        let names = conn.table_names().execute().await.unwrap_or_default();
                        if names.iter().any(|n| n == crate::commands::rag::store::TABLE_NAME) {
                            if let Ok(table) = conn
                                .open_table(crate::commands::rag::store::TABLE_NAME)
                                .execute()
                                .await
                            {
                                if let Err(e) = crate::commands::rag::store::delete_path(&table, &path_key).await {
                                    log::warn!("S3 tombstone: delete RAG chunks for {} failed: {}", path_key, e);
                                }
                            }
                        }
                    }
                    Err(e) => {
                        log::warn!("S3 tombstone: open lancedb for {} failed: {}", path_key, e);
                    }
                }
            });
        };
        sync::sync_folder_provider(
            &provider, &store, &workspace, &folder, M365_ACCOUNT, &enc_key, &emit,
            &index_callback, &tombstone_callback,
        )
        .await
        .map_err(|e| e.to_string())?;
    }

    // ── IMAP account (if configured) — runs after M365 ────────────────────
    if let Some((imap_cfg, imap_pw)) = load_imap_config() {
        use crate::commands::mail::imap::ImapProvider;
        let provider = ImapProvider {
            host: imap_cfg.host.clone(),
            port: imap_cfg.port,
            username: imap_cfg.username.clone(),
            password: imap_pw,
            account: imap_cfg.account.clone(),
        };
        let folders = provider.list_folders().await.map_err(|e| e.to_string())?;
        for folder in folders {
            if cancel.load(Ordering::SeqCst) {
                let _ = app.emit(
                    SYNC_PROGRESS_EVENT,
                    SyncProgress {
                        status: "cancelled".into(),
                        folder: None,
                        written: 0,
                        removed: 0,
                    },
                );
                return Ok(());
            }
            let app2 = app.clone();
            let fid2 = folder.id.clone();
            let emit = move |w: u32, r: u32| {
                let _ = app2.emit(
                    SYNC_PROGRESS_EVENT,
                    SyncProgress {
                        status: "syncing".into(),
                        folder: Some(fid2.clone()),
                        written: w,
                        removed: r,
                    },
                );
            };
            let workspace_for_index = workspace.clone();
            let enc_key_for_index = enc_key;
            let app3 = app.clone();
            let index_callback = move |id: &str, text: &str| {
                let path_key = format!("mail:{}", id);
                let text_owned = text.to_string();
                let ws = workspace_for_index.clone();
                let key = enc_key_for_index;
                // Fire-and-forget RAG indexing (G4).
                let _ = tokio::task::spawn(async move {
                    if let Err(e) = index_mail_text_internal(&ws, &path_key, &text_owned, &key).await {
                        log::warn!("G4 mail index failed for {}: {}", path_key, e);
                    }
                });
                // G5: pull the subject from the frontmatter (scoped to the fenced
                // block, unquoted + unescaped) and emit the event for MiniSearch.
                let subject = frontmatter_subject(text);
                let _ = app3.emit(MAIL_INDEX_CHUNK_EVENT, MailIndexChunkPayload {
                    doc_id: id.to_string(),
                    subject,
                    decrypted_text: text.to_string(),
                });
            };
            // S3: tombstone_callback fires for each deleted message. It spawns a
            // fire-and-forget async task to remove the LanceDB RAG chunks keyed
            // "mail:<id>" so deleted email stops surfacing in rag_retrieve.
            let workspace_for_tombstone = workspace.clone();
            let tombstone_callback = move |id: &str| {
                let path_key = format!("mail:{}", id);
                let ws = workspace_for_tombstone.clone();
                let _ = tokio::task::spawn(async move {
                    // Reuse the same store::delete_path helper used by rag_delete_path.
                    match crate::commands::rag::store::open_connection(&ws).await {
                        Ok(conn) => {
                            let names = conn.table_names().execute().await.unwrap_or_default();
                            if names.iter().any(|n| n == crate::commands::rag::store::TABLE_NAME) {
                                if let Ok(table) = conn
                                    .open_table(crate::commands::rag::store::TABLE_NAME)
                                    .execute()
                                    .await
                                {
                                    if let Err(e) = crate::commands::rag::store::delete_path(&table, &path_key).await {
                                        log::warn!("S3 tombstone: delete RAG chunks for {} failed: {}", path_key, e);
                                    }
                                }
                            }
                        }
                        Err(e) => {
                            log::warn!("S3 tombstone: open lancedb for {} failed: {}", path_key, e);
                        }
                    }
                });
            };
            sync::sync_folder_provider(
                &provider, &store, &workspace, &folder, &imap_cfg.account, &enc_key,
                &emit, &index_callback, &tombstone_callback,
            )
            .await
            .map_err(|e| e.to_string())?;
        }
    }

    let _ = app.emit(
        SYNC_PROGRESS_EVENT,
        SyncProgress {
            status: "done".into(),
            folder: None,
            written: 0,
            removed: 0,
        },
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{frontmatter_subject, yaml_unescape};

    #[test]
    fn frontmatter_subject_is_unquoted_and_clean() {
        let md = "---\nmessage_id: \"m1\"\nsubject: \"Closing date\"\nfrom: \"a@b.com\"\n---\n\n# Closing date\n\nbody subject: not this one\n";
        assert_eq!(frontmatter_subject(md), "Closing date");
    }

    #[test]
    fn frontmatter_subject_unescapes_and_ignores_body() {
        // Escaped quote in the subject, plus a body line that also says "subject:".
        let md = "---\nsubject: \"Re: \\\"urgent\\\" matter\"\n---\n\n# x\n\nsubject: decoy\n";
        assert_eq!(frontmatter_subject(md), "Re: \"urgent\" matter");
    }

    #[test]
    fn frontmatter_subject_collapses_escaped_newlines() {
        let md = "---\nsubject: \"line one\\nline two\"\n---\n\n# x\n";
        assert_eq!(frontmatter_subject(md), "line one line two");
    }

    #[test]
    fn yaml_unescape_distinguishes_escaped_backslash_from_newline() {
        // `\\n` (escaped backslash then literal n) must stay backslash+n,
        // while `\n` (escaped newline) becomes a space.
        assert_eq!(yaml_unescape("a\\\\nb"), "a\\nb");
        assert_eq!(yaml_unescape("a\\nb"), "a b");
    }
}
