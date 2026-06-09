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
pub mod gmail;
pub mod view;

use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager, State};
use crate::commands::mail::oauth::{OAuth, TokenOutcome};
use crate::commands::mail::provider::MailProvider;
use crate::commands::mail::store::{EncryptedMailStore, MailStore};

const KEYCHAIN_SERVICE: &str = "keepance-mail-ms";
const KEYCHAIN_REFRESH_KEY: &str = "ms-refresh-token";
/// Account id for the single Microsoft 365 account (one refresh token today).
/// Cursors are scoped by (provider, account, folder); see `sync_folder_provider`.
const M365_ACCOUNT: &str = "default";

const IMAP_KEYCHAIN_SERVICE: &str = "keepance-mail-imap";
const IMAP_CONFIG_KEY: &str = "config"; // JSON {account,host,port,username}
const IMAP_PASSWORD_KEY: &str = "password";

const GMAIL_KEYCHAIN_SERVICE: &str = "keepance-mail-gmail";
const GMAIL_REFRESH_KEY: &str = "refresh-token";
const GMAIL_ACCOUNT: &str = "default"; // single Gmail account today; cursors are (provider,account,folder)-scoped

fn gmail_client_id() -> String {
    option_env!("KEEPANCE_GMAIL_CLIENT_ID")
        // Desktop OAuth client for the "Keepance Mail" Google Cloud project
        // (registered under jamesondaines4@gmail.com, 2026-06-08). A public-client
        // id is not a secret; the loopback+PKCE flow needs no client secret.
        .unwrap_or("194900913942-1ubo8rmfe3mfh1o0gaauv60vktllpl7t.apps.googleusercontent.com")
        .to_string()
}
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

/// WS-B/C: one (provider, account, folder) -> matter mapping entry, supplied by
/// the frontend matter store. An empty `folder_id` means an account-level
/// mapping (every folder in that account). The most specific match wins (a
/// folder-level entry beats an account-level one), so a sub-folder filed under
/// a different matter than its account is respected.
#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct MailMatterMapEntry {
    pub provider: String,
    pub account: String,
    #[serde(default)]
    pub folder_id: String,
    pub matter_id: String,
}

/// Resolve the matter id for a folder from the supplied mapping. Folder-level
/// entries (matching provider+account+folder) take precedence over account-level
/// entries (matching provider+account with an empty folder). Falls back to
/// `UNASSIGNED_MATTER` when nothing matches — mail is never silently filed into a
/// matter it was not mapped to.
fn resolve_mail_matter(
    map: &[MailMatterMapEntry],
    provider: &str,
    account: &str,
    folder_id: &str,
) -> String {
    let mut account_level: Option<&str> = None;
    for e in map {
        if e.provider != provider || e.account != account {
            continue;
        }
        if !e.folder_id.is_empty() && e.folder_id == folder_id {
            return e.matter_id.clone(); // most specific wins
        }
        if e.folder_id.is_empty() {
            account_level = Some(&e.matter_id);
        }
    }
    account_level
        .map(|s| s.to_string())
        .unwrap_or_else(|| crate::commands::rag::store::UNASSIGNED_MATTER.to_string())
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

/// Fetch + decrypt ONE stored message by id and return it as a structured view
/// for the read-only mail viewer.
///
/// `id` is the provider message id — the part after `mail:` in a citation
/// source. A leading `mail:` prefix is tolerated so the viewer can pass the raw
/// citation source id straight through.
///
/// The plaintext (decrypted Markdown) lives only in this process's memory and
/// the returned struct; it is never written back to disk.
///
/// Pure core (`get_message_with_key`) takes the workspace + key so it is unit-
/// testable without the OS keychain.
fn get_message_with_key(
    workspace: &std::path::Path,
    id: &str,
    key: &[u8; 32],
) -> anyhow::Result<Option<view::MailView>> {
    use anyhow::Context;
    // Tolerate a "mail:" prefix so callers can pass the citation source id.
    let id = id.strip_prefix("mail:").unwrap_or(id);
    let store = EncryptedMailStore::open_with_key(workspace, key)
        .context("open encrypted mail store")?;
    let rec = match store.get_record(id)? {
        Some(r) => r,
        None => return Ok(None),
    };
    let bytes = store
        .read_blob_with_key(&rec.relative_path, workspace, key)
        .with_context(|| format!("read+decrypt mail blob for {id}"))?;
    let markdown = String::from_utf8(bytes).context("decrypted mail blob is not UTF-8")?;
    Ok(Some(view::MailView::from_markdown(id, &markdown)))
}

#[tauri::command]
pub async fn mail_get_message(
    state: State<'_, MailState>,
    id: String,
) -> Result<view::MailView, String> {
    let workspace = state
        .workspace
        .lock()
        .await
        .clone()
        .ok_or("workspace not set")?;
    let key = crate::commands::mail::crypto::get_or_create_master_key()
        .map_err(|e| e.to_string())?;
    // Decrypt + DB read are blocking fs/sqlite work; run off the async runtime.
    let view = tokio::task::spawn_blocking(move || get_message_with_key(&workspace, &id, &key))
        .await
        .map_err(|e| format!("join: {e}"))?
        .map_err(|e| e.to_string())?;
    view.ok_or_else(|| "message not found".to_string())
}

/// WS-B/C: re-tag every message stored under a (provider, account, folder) to a
/// matter, IN PLACE in the RAG store (no re-embedding) — the same re-tag path
/// files use. Called by the frontend when a mail folder's matter mapping
/// changes, so already-indexed mail picks up the new scope immediately. An empty
/// `folder_id` re-tags every folder in the account (an account-level mapping).
/// Returns the number of messages re-tagged. No-op (Ok(0)) when memory/index has
/// nothing for those messages yet.
#[tauri::command]
pub async fn mail_retag_folder_matter(
    state: State<'_, MailState>,
    provider: String,
    account: String,
    folder_id: String,
    matter_id: String,
) -> Result<u32, String> {
    // Validate the matter id up front (defence-in-depth before any SQL update).
    crate::commands::rag::store::validate_matter_id(&matter_id)
        .map_err(|e| format!("invalid matter id: {e}"))?;
    let workspace = state
        .workspace
        .lock()
        .await
        .clone()
        .ok_or("workspace not set")?;

    // List the message ids for this folder from the encrypted metadata store.
    let ws_for_ids = workspace.clone();
    let (provider2, account2, folder2) = (provider.clone(), account.clone(), folder_id.clone());
    let ids: Vec<String> = tokio::task::spawn_blocking(move || -> anyhow::Result<Vec<String>> {
        let store = EncryptedMailStore::open(&ws_for_ids)?;
        store.ids_in_folder(&provider2, &account2, &folder2)
    })
    .await
    .map_err(|e| format!("join: {e}"))?
    .map_err(|e| e.to_string())?;

    if ids.is_empty() {
        return Ok(0);
    }

    // Re-tag each message's RAG chunks in place via the shared LanceDB helper
    // (the same `retag_matter_for_path` files use).
    let conn = crate::commands::rag::store::open_connection(&workspace)
        .await
        .map_err(|e| format!("open lancedb: {e}"))?;
    let names = conn
        .table_names()
        .execute()
        .await
        .map_err(|e| format!("list tables: {e}"))?;
    if !names.iter().any(|n| n == crate::commands::rag::store::TABLE_NAME) {
        return Ok(0); // nothing indexed yet
    }
    let table = conn
        .open_table(crate::commands::rag::store::TABLE_NAME)
        .execute()
        .await
        .map_err(|e| format!("open table: {e}"))?;

    let mut retagged = 0u32;
    for id in ids {
        let path_key = format!("mail:{}", id);
        match crate::commands::rag::store::retag_matter_for_path(&table, &path_key, &matter_id).await
        {
            Ok(rows) if rows > 0 => retagged += 1,
            Ok(_) => {}
            Err(e) => log::warn!("retag matter for {path_key} failed: {e}"),
        }
    }
    Ok(retagged)
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
    let cfg_entry =
        keyring::Entry::new(IMAP_KEYCHAIN_SERVICE, IMAP_CONFIG_KEY).map_err(|e| e.to_string())?;
    cfg_entry.set_password(&cfg_json).map_err(|e| e.to_string())?;
    let pw_entry =
        keyring::Entry::new(IMAP_KEYCHAIN_SERVICE, IMAP_PASSWORD_KEY).map_err(|e| e.to_string())?;
    if let Err(e) = pw_entry.set_password(&password) {
        // Don't leave a config without its password: load_imap_config requires
        // both, so a half-write would surface as a confusing "not connected"
        // after an apparently-successful connect. Roll back the config entry.
        let _ = cfg_entry.delete_credential();
        return Err(e.to_string());
    }
    Ok(())
}

#[tauri::command]
pub async fn mail_imap_is_connected() -> Result<bool, String> {
    Ok(load_imap_config().is_some())
}

/// One connected mail account, surfaced to the matter-mapping UI so a matter can
/// be mapped to it. `account` is the stable key used in mail-folder mapping
/// (provider/account[/folder]); `label` is for display.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ConnectedAccount {
    pub provider: String,
    pub account: String,
    pub label: String,
}

/// List the mail accounts currently connected, so the matter manager can offer
/// an account-level mail->matter mapping for each. M365 + Gmail use the single
/// "default" account id; IMAP uses its configured username.
#[tauri::command]
pub async fn mail_connected_accounts() -> Result<Vec<ConnectedAccount>, String> {
    let mut out = Vec::new();
    if mail_is_connected().await.unwrap_or(false) {
        out.push(ConnectedAccount {
            provider: "m365".into(),
            account: M365_ACCOUNT.into(),
            label: "Microsoft 365".into(),
        });
    }
    if let Some((cfg, _pw)) = load_imap_config() {
        out.push(ConnectedAccount {
            provider: "imap".into(),
            account: cfg.account.clone(),
            label: format!("IMAP ({})", cfg.username),
        });
    }
    if gmail_is_connected().await.unwrap_or(false) {
        out.push(ConnectedAccount {
            provider: "gmail".into(),
            account: GMAIL_ACCOUNT.into(),
            label: "Gmail".into(),
        });
    }
    Ok(out)
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

/// Run the Gmail loopback+PKCE sign-in: open the browser, catch the redirect,
/// exchange the code, and store the refresh token in the OS keychain. Blocks
/// until the user finishes in the browser (or a 5-minute timeout).
#[tauri::command]
pub async fn gmail_connect() -> Result<(), String> {
    use crate::commands::mail::gmail::oauth::{bind_loopback, build_auth_url, gen_pkce, gen_state, open_browser, await_redirect_code, GoogleOAuth};
    let (verifier, challenge) = gen_pkce();
    let state = gen_state();
    let (listener, redirect_uri) = bind_loopback().await.map_err(|e| e.to_string())?;
    let url = build_auth_url(&gmail_client_id(), &redirect_uri, &challenge, &state);
    open_browser(&url);
    let code = await_redirect_code(listener, &state, std::time::Duration::from_secs(300)).await.map_err(|e| e.to_string())?;
    let oauth = GoogleOAuth::new(gmail_client_id());
    let tokens = oauth.exchange_code(&code, &verifier, &redirect_uri).await.map_err(|e| e.to_string())?;
    let refresh = tokens.refresh.ok_or("Google did not return a refresh token; try again")?;
    keyring::Entry::new(GMAIL_KEYCHAIN_SERVICE, GMAIL_REFRESH_KEY).map_err(|e| e.to_string())?
        .set_password(&refresh).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn gmail_is_connected() -> Result<bool, String> {
    Ok(keyring::Entry::new(GMAIL_KEYCHAIN_SERVICE, GMAIL_REFRESH_KEY).map_err(|e| e.to_string())?.get_password().is_ok())
}

#[tauri::command]
pub async fn gmail_disconnect() -> Result<(), String> {
    if let Ok(e) = keyring::Entry::new(GMAIL_KEYCHAIN_SERVICE, GMAIL_REFRESH_KEY) { let _ = e.delete_credential(); }
    Ok(())
}

/// Read the Gmail refresh token from the keychain and exchange it for a fresh
/// access token. Returns `Err("not connected")` if no refresh token is stored.
async fn fresh_gmail_access_token() -> Result<String, String> {
    let entry = keyring::Entry::new(GMAIL_KEYCHAIN_SERVICE, GMAIL_REFRESH_KEY)
        .map_err(|e| e.to_string())?;
    let rt = entry.get_password().map_err(|_| "not connected".to_string())?;
    let oauth = crate::commands::mail::gmail::oauth::GoogleOAuth::new(gmail_client_id());
    let tokens = oauth.refresh(&rt).await.map_err(|e| e.to_string())?;
    Ok(tokens.access)
}

/// G4 / N2: Internal mail RAG indexer — takes raw parameters instead of Tauri
/// State, called directly from the sync callback without going through IPC.
/// The former rag_index_mail_text Tauri command (which shipped plaintext over
/// IPC) has been removed (N2); this function is the sole indexing path.
///
/// `path_key` is already formatted as "mail:<doc_id>" by the caller.
/// Encrypts chunk text before storing in LanceDB. Idempotent (deletes stale
/// rows first). Returns Ok(0) if plaintext is empty. Errors are logged by caller.
///
/// WS-B/C: `matter_id` is the confidentiality scope this email is filed under.
/// The matter model / assignment UI is a separate upcoming task; until an email
/// is assigned to a matter, callers pass `store::UNASSIGNED_MATTER` so the chunk
/// is scopeable and never silently leaks into a real matter.
async fn index_mail_text_internal(
    workspace: &std::path::Path,
    path_key: &str,
    plaintext: &str,
    matter_id: &str,
) -> anyhow::Result<u32> {
    use anyhow::Context;
    if plaintext.trim().is_empty() {
        return Ok(0);
    }
    // WS-VEC: the RAG-index copy of the mail text is encrypted at rest under the
    // dedicated VECTOR-STORE key (not the mail-body key), so the whole `chunks`
    // table decrypts under one key. The canonical encrypted mail body lives in
    // the mail store under the mail key; this is a derived copy.
    let key = crate::commands::rag::crypto::get_or_create_master_key()
        .context("vectors master key for mail RAG index")?;
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

    // WS-PRIV: mail is indexed at PRIVILEGE_NONE (the default). Mail sync runs
    // from the server and has no privilege signal of its own; the user marks a
    // message privileged in the UI, which writes the privilege store and re-tags
    // these chunks in place via `rag_retag_privilege` (parallel to how a mail's
    // matter is assigned after indexing, not at sync time).
    let batch = crate::commands::rag::store::build_batch_mail(
        &rows,
        &key,
        matter_id,
        crate::commands::rag::store::PRIVILEGE_NONE,
    )
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
///
/// `matter_map` is the frontend's (provider, account, folder) -> matter mapping
/// (from the matter store). Each folder's mail is indexed under the resolved
/// matter at index time, falling back to `UNASSIGNED_MATTER` when unmapped. The
/// argument is optional (defaults to empty) so callers that don't scope mail yet
/// keep working.
#[tauri::command]
pub async fn mail_sync_all(
    app: AppHandle,
    state: State<'_, MailState>,
    matter_map: Option<Vec<MailMatterMapEntry>>,
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

    let matter_map = matter_map.unwrap_or_default();

    // Run the sync; on ANY failure emit a terminal "error" progress event so the
    // UI stops showing a spinner (the frontend listens for sync-progress).
    let outcome = mail_sync_all_inner(&app, &state, &matter_map).await;
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
    matter_map: &[MailMatterMapEntry],
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
        let app3 = app.clone();
        let index_callback = move |id: &str, text: &str, matter_id: &str| {
            let path_key = format!("mail:{}", id);
            let text_owned = text.to_string();
            let ws = workspace_for_index.clone();
            // WS-B/C: the matter resolved for this folder is tagged on the chunk
            // at index time (UNASSIGNED_MATTER when the folder is not mapped).
            // WS-VEC: index_mail_text_internal fetches the vector-store key itself
            // (the RAG copy is encrypted at rest under that key, not the mail key).
            let matter = matter_id.to_string();
            // Fire-and-forget RAG indexing.
            let _ = tokio::task::spawn(async move {
                if let Err(e) = index_mail_text_internal(&ws, &path_key, &text_owned, &matter).await {
                    log::warn!("mail RAG index failed for {}: {}", path_key, e);
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
        let folder_matter = resolve_mail_matter(matter_map, "m365", M365_ACCOUNT, &folder.id);
        sync::sync_folder_provider(
            &provider, &store, &workspace, &folder, M365_ACCOUNT, &folder_matter, &enc_key, &emit,
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
            let app3 = app.clone();
            let index_callback = move |id: &str, text: &str, matter_id: &str| {
                let path_key = format!("mail:{}", id);
                let text_owned = text.to_string();
                let ws = workspace_for_index.clone();
                // WS-VEC: index_mail_text_internal fetches the vector-store key.
                let matter = matter_id.to_string();
                // Fire-and-forget RAG indexing.
                let _ = tokio::task::spawn(async move {
                    if let Err(e) = index_mail_text_internal(&ws, &path_key, &text_owned, &matter).await {
                        log::warn!("mail RAG index failed for {}: {}", path_key, e);
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
            let folder_matter = resolve_mail_matter(matter_map, "imap", &imap_cfg.account, &folder.id);
            sync::sync_folder_provider(
                &provider, &store, &workspace, &folder, &imap_cfg.account, &folder_matter, &enc_key,
                &emit, &index_callback, &tombstone_callback,
            )
            .await
            .map_err(|e| e.to_string())?;
        }
    }

    // ── Gmail account (if connected) — runs after IMAP ────────────────────
    if gmail_is_connected().await.unwrap_or(false) {
        use crate::commands::mail::gmail::GmailProvider;
        let folders = {
            let token = fresh_gmail_access_token().await?;
            GmailProvider::new(token, GMAIL_ACCOUNT.to_string()).list_folders().await.map_err(|e| e.to_string())?
        };
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
            let token = fresh_gmail_access_token().await?;
            let provider = GmailProvider::new(token, GMAIL_ACCOUNT.to_string());
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
            let app3 = app.clone();
            let index_callback = move |id: &str, text: &str, matter_id: &str| {
                let path_key = format!("mail:{}", id);
                let text_owned = text.to_string();
                let ws = workspace_for_index.clone();
                // WS-VEC: index_mail_text_internal fetches the vector-store key.
                let matter = matter_id.to_string();
                // Fire-and-forget RAG indexing.
                let _ = tokio::task::spawn(async move {
                    if let Err(e) = index_mail_text_internal(&ws, &path_key, &text_owned, &matter).await {
                        log::warn!("mail RAG index failed for {}: {}", path_key, e);
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
            let folder_matter = resolve_mail_matter(matter_map, "gmail", GMAIL_ACCOUNT, &folder.id);
            sync::sync_folder_provider(
                &provider, &store, &workspace, &folder, GMAIL_ACCOUNT, &folder_matter, &enc_key,
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
    use super::{frontmatter_subject, get_message_with_key, resolve_mail_matter, yaml_unescape, MailMatterMapEntry};
    use crate::commands::mail::store::EncryptedMailStore;
    use crate::commands::rag::store::UNASSIGNED_MATTER;

    fn entry(provider: &str, account: &str, folder: &str, matter: &str) -> MailMatterMapEntry {
        MailMatterMapEntry {
            provider: provider.into(),
            account: account.into(),
            folder_id: folder.into(),
            matter_id: matter.into(),
        }
    }

    #[test]
    fn resolve_mail_matter_falls_back_to_unassigned_when_unmapped() {
        let map = vec![entry("m365", "default", "inbox", "matter_a")];
        assert_eq!(
            resolve_mail_matter(&map, "m365", "default", "sent"),
            UNASSIGNED_MATTER
        );
        assert_eq!(resolve_mail_matter(&[], "m365", "default", "inbox"), UNASSIGNED_MATTER);
    }

    #[test]
    fn resolve_mail_matter_matches_exact_folder() {
        let map = vec![entry("m365", "default", "inbox", "matter_a")];
        assert_eq!(resolve_mail_matter(&map, "m365", "default", "inbox"), "matter_a");
    }

    #[test]
    fn resolve_mail_matter_account_level_matches_any_folder() {
        // Empty folder_id == account-level mapping for every folder in the account.
        let map = vec![entry("gmail", "default", "", "matter_g")];
        assert_eq!(resolve_mail_matter(&map, "gmail", "default", "INBOX"), "matter_g");
        assert_eq!(resolve_mail_matter(&map, "gmail", "default", "Label_42"), "matter_g");
        // Different account is not covered.
        assert_eq!(resolve_mail_matter(&map, "gmail", "other", "INBOX"), UNASSIGNED_MATTER);
    }

    #[test]
    fn resolve_mail_matter_folder_level_wins_over_account_level() {
        let map = vec![
            entry("m365", "default", "", "matter_account"),
            entry("m365", "default", "litigation", "matter_litigation"),
        ];
        // The more specific folder-level mapping takes precedence.
        assert_eq!(
            resolve_mail_matter(&map, "m365", "default", "litigation"),
            "matter_litigation"
        );
        // Other folders fall back to the account-level mapping.
        assert_eq!(resolve_mail_matter(&map, "m365", "default", "inbox"), "matter_account");
    }

    #[test]
    fn get_message_with_key_decrypts_and_parses_fields() {
        use crate::commands::mail::model::{BodyContentType, MailMessage, Recipient};
        use crate::commands::mail::normalize::to_markdown;
        use crate::commands::mail::store::{MailRecord, MailStore};

        let dir = tempfile::TempDir::new().unwrap();
        let key = [0x42u8; 32];
        let store = EncryptedMailStore::open_with_key(dir.path(), &key).unwrap();

        let msg = MailMessage {
            id: "AAMk-xyz".into(),
            conversation_id: Some("c1".into()),
            internet_message_id: Some("<m@x>".into()),
            subject: "Closing date".into(),
            received_date_time: Some("2026-05-01T14:30:00Z".into()),
            from_name: Some("Pat H".into()),
            from_address: Some("pat@hender.com".into()),
            to: vec![Recipient { name: Some("Me".into()), address: Some("me@firm.com".into()) }],
            cc: vec![],
            folders: vec![],
            thread_id: Some("c1".into()),
            provider: "m365".into(),
            account: "default".into(),
            has_attachments: false,
            body_content_type: BodyContentType::Text,
            body_text: "Confirming May 14.".into(),
        };
        let markdown = to_markdown(&msg);
        // Write the encrypted blob + register the record (mirrors apply_messages_enc).
        let rel = store.write_blob_with_key("AAMk-xyz", markdown.as_bytes(), &key).unwrap();
        store
            .upsert(&MailRecord {
                id: "AAMk-xyz".into(),
                folder_id: "inbox".into(),
                internet_message_id: Some("<m@x>".into()),
                relative_path: rel,
                received_date_time: Some("2026-05-01T14:30:00Z".into()),
                provider: "m365".into(),
                account: "default".into(),
            })
            .unwrap();

        // Fetch by raw id and by "mail:" prefixed citation id — both must work.
        for query in ["AAMk-xyz", "mail:AAMk-xyz"] {
            let v = get_message_with_key(dir.path(), query, &key)
                .unwrap()
                .expect("message present");
            assert_eq!(v.id, "AAMk-xyz");
            assert_eq!(v.subject, "Closing date");
            assert_eq!(v.from, "Pat H <pat@hender.com>");
            assert_eq!(v.to, vec!["Me <me@firm.com>"]);
            assert_eq!(v.date.as_deref(), Some("2026-05-01T14:30:00Z"));
            assert_eq!(v.body, "Confirming May 14.");
        }
    }

    #[test]
    fn get_message_with_key_returns_none_for_unknown_id() {
        let dir = tempfile::TempDir::new().unwrap();
        let key = [0x42u8; 32];
        // Create an (empty) store so the DB exists.
        let _ = EncryptedMailStore::open_with_key(dir.path(), &key).unwrap();
        let got = get_message_with_key(dir.path(), "does-not-exist", &key).unwrap();
        assert!(got.is_none());
    }

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
