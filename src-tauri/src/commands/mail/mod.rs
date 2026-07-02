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
use crate::commands::mail::graph::{GraphTokenRefresh, GraphTokenRefreshFuture};
use crate::commands::mail::oauth::{OAuth, TokenOutcome};
use crate::commands::mail::provider::MailProvider;
use crate::commands::mail::store::{EncryptedMailStore, MailListPage, MailListQuery, MailStore};

const KEYCHAIN_SERVICE: &str = crate::identity::MAIL_MS_SERVICE;
const KEYCHAIN_REFRESH_KEY: &str = "ms-refresh-token";
/// Account id for the single Microsoft 365 account (one refresh token today).
/// Cursors are scoped by (provider, account, folder); see `sync_folder_provider`.
const M365_ACCOUNT: &str = "default";

const IMAP_KEYCHAIN_SERVICE: &str = crate::identity::MAIL_IMAP_SERVICE;
const IMAP_CONFIG_KEY: &str = "config"; // JSON {account,host,port,username}
const IMAP_PASSWORD_KEY: &str = "password";

const GMAIL_KEYCHAIN_SERVICE: &str = crate::identity::MAIL_GMAIL_SERVICE;
const GMAIL_REFRESH_KEY: &str = "refresh-token";
const GMAIL_ACCOUNT: &str = "default"; // single Gmail account today; cursors are (provider,account,folder)-scoped

fn gmail_client_id() -> String {
    // Injected at build time from the KEEPANCE_GMAIL_CLIENT_ID secret (CI job
    // env in .github/workflows/release.yml). Kept out of source so it is never
    // committed; set the env locally for `tauri dev` Gmail testing.
    option_env!("KEEPANCE_GMAIL_CLIENT_ID").unwrap_or("").to_string()
}

fn gmail_client_secret() -> String {
    // Google requires the client_secret at its token endpoint for Desktop-type
    // OAuth clients (even with PKCE). Injected at build time from the
    // KEEPANCE_GMAIL_CLIENT_SECRET secret; never committed to source.
    option_env!("KEEPANCE_GMAIL_CLIENT_SECRET").unwrap_or("").to_string()
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
    /// Separate from `cancel` (which cancels an in-flight mail *sync*): this
    /// flag lets the frontend abort a pending interactive OAuth sign-in
    /// (`outlook_connect`'s wait for the browser redirect) without touching
    /// sync state. See `outlook_connect_cancel`.
    pub oauth_cancel: Arc<AtomicBool>,
}

pub fn manage_state(app: &tauri::App) {
    app.manage(MailState {
        workspace: tokio::sync::Mutex::new(None),
        cancel: Arc::new(AtomicBool::new(false)),
        is_syncing: Arc::new(AtomicBool::new(false)),
        oauth_cancel: Arc::new(AtomicBool::new(false)),
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

/// One attachment to include in an outgoing email.
/// `content_base64` is standard base64 (not URL-safe) — the frontend reads
/// File objects and encodes with `btoa` / `Buffer.from(...).toString('base64')`.
#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentInput {
    pub name: String,
    pub content_base64: String,
    pub content_type: String,
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
    /// Which provider this progress update belongs to ("m365" | "imap" |
    /// "gmail"). The two connector panels (Microsoft 365 and Gmail) are rendered
    /// together, so without this tag both would react to the same global event —
    /// showing one provider's count/error on the other. Each panel now filters
    /// to its own provider.
    pub provider: String,
    pub folder: Option<String>,
    pub written: u32,
    pub removed: u32,
    /// Present only on a terminal `error` event: the raw failure message, shown
    /// on the owner's own screen so a failure is never silent. It is NEVER
    /// persisted to the append-only audit log as-is — the frontend stores only a
    /// sanitized category (see `sanitizeSyncError`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    /// True on a terminal `done` event when at least one imported message could
    /// not be indexed for search yet and is queued for the RAG backfill (e.g. the
    /// embedding model is still downloading). The durable backfill marker
    /// guarantees a retry on the next launch, so recall is deferred, never lost.
    pub backfill_pending: bool,
    /// True on a terminal `done` event when saving a freshly-rotated Microsoft
    /// 365 refresh token to the keychain failed during this sync. The sync itself
    /// succeeded; this is a heads-up that the user may need to reconnect on a
    /// later launch (the new refresh token wasn't persisted). Never silent.
    pub token_warning: bool,
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

/// Like `load_imap_config`, but distinguishes "IMAP was never configured"
/// (`Ok(None)` — a correct silent skip) from "IMAP IS configured but the
/// settings/password couldn't be read or were corrupted" (`Err`). The sync path
/// uses this so a broken IMAP account surfaces an error outcome instead of being
/// silently skipped as if it were never set up.
fn load_imap_config_checked() -> Result<Option<(ImapConfig, String)>, String> {
    let cfg_e =
        keyring::Entry::new(IMAP_KEYCHAIN_SERVICE, IMAP_CONFIG_KEY).map_err(|e| e.to_string())?;
    let cfg_json = match cfg_e.get_password() {
        Ok(j) => j,
        // No entry at all → IMAP was never connected; nothing to sync.
        Err(keyring::Error::NoEntry) => return Ok(None),
        Err(e) => return Err(format!("read IMAP settings: {e}")),
    };
    let cfg: ImapConfig =
        serde_json::from_str(&cfg_json).map_err(|e| format!("parse IMAP settings: {e}"))?;
    let pw_e =
        keyring::Entry::new(IMAP_KEYCHAIN_SERVICE, IMAP_PASSWORD_KEY).map_err(|e| e.to_string())?;
    let pw = match pw_e.get_password() {
        Ok(p) => p,
        Err(keyring::Error::NoEntry) => {
            return Err("IMAP password is missing; reconnect the account".into())
        }
        Err(e) => return Err(format!("read IMAP password: {e}")),
    };
    Ok(Some((cfg, pw)))
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
    let mut view = view::MailView::from_markdown(id, &markdown);
    // BUG-013: the DURABLE per-message matter override (manual filing) is the
    // source of truth — read it here from the same store open. The RAG-index
    // folder-level fallback is applied by `mail_get_message` only when there is
    // no manual filing. `UNASSIGNED_MATTER`/empty means "not filed".
    if let Some(m) = store.get_message_matter(id)? {
        if is_real_matter(&m) {
            view.matter_id = Some(m);
        }
    }
    Ok(Some(view))
}

/// A matter id that represents an actual filing (not the unassigned sentinel or
/// an empty value). The single predicate every consumer of a per-message matter
/// override uses, so "not filed" is decided identically in the viewer, sync,
/// backfill, and folder-remap. (BUG-013.)
pub(crate) fn is_real_matter(matter_id: &str) -> bool {
    !matter_id.is_empty() && matter_id != crate::commands::rag::store::UNASSIGNED_MATTER
}

/// Resolve a message's effective matter at RAG-index time from its durable
/// per-message override and the folder default. Three states:
///   - a REAL override (a live matter the user filed it to) wins over the folder
///     (BUG-013 — a manual filing survives re-sync / folder remap);
///   - an EXPLICIT `UNASSIGNED_MATTER` override — a *tombstone* left when the
///     matter it had been filed to was DELETED — stays unassigned and is NOT
///     re-absorbed into the folder's matter (BUG-042). This upholds the legal
///     invariant that content filed to one matter can never silently move into
///     another matter just because the first matter was deleted;
///   - no override (or an unreadable one) → the folder default.
///
/// `override_opt` is the raw stored override (`None` when the message was never
/// manually filed). `folder_default` is the matter the folder maps to (already
/// `UNASSIGNED_MATTER` when the folder is unmapped).
pub(crate) fn resolve_effective_matter(override_opt: Option<&str>, folder_default: &str) -> String {
    match override_opt {
        Some(m) if is_real_matter(m) => m.to_string(),
        Some(m) if m == crate::commands::rag::store::UNASSIGNED_MATTER => {
            crate::commands::rag::store::UNASSIGNED_MATTER.to_string()
        }
        _ => folder_default.to_string(),
    }
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
    let ws_for_view = workspace.clone();
    let id_for_lookup = id.clone();
    let view = tokio::task::spawn_blocking(move || get_message_with_key(&ws_for_view, &id, &key))
        .await
        .map_err(|e| format!("join: {e}"))?
        .map_err(|e| e.to_string())?;
    let mut view = view.ok_or_else(|| "message not found".to_string())?;
    // BUG-013: `get_message_with_key` already set `matter_id` from the durable
    // per-message override (the source of truth). When there's no manual filing,
    // fall back to the folder-level matter stamped in the RAG index so the
    // viewer still reflects a folder→matter mapping. Best-effort: a lookup
    // failure leaves it None and never blocks opening the email.
    if view.matter_id.is_none() {
        view.matter_id = folder_matter_from_rag(&workspace, &id_for_lookup).await;
    }
    Ok(view)
}

/// Best-effort read of the folder-level matter a mail message was indexed under,
/// from the RAG store by its "mail:<id>" path token. Returns `None` on any error,
/// when nothing is indexed yet, or when the scope is the unassigned sentinel —
/// so opening an email never fails on this lookup and "unassigned" reads as "not
/// filed". This is the SOFT fallback; the durable per-message override read in
/// `get_message_with_key` takes precedence. (BUG-013.)
async fn folder_matter_from_rag(workspace: &std::path::Path, id: &str) -> Option<String> {
    let raw_id = id.strip_prefix("mail:").unwrap_or(id);
    let path_key = format!("mail:{}", raw_id);
    let conn = crate::commands::rag::store::open_connection(workspace).await.ok()?;
    let names = conn.table_names().execute().await.ok()?;
    if !names.iter().any(|n| n == crate::commands::rag::store::TABLE_NAME) {
        return None;
    }
    let table = conn
        .open_table(crate::commands::rag::store::TABLE_NAME)
        .execute()
        .await
        .ok()?;
    let vec_key = crate::commands::rag::crypto::get_or_create_master_key().ok()?;
    let matter = crate::commands::rag::store::matter_for_path(&table, &path_key, &vec_key)
        .await
        .ok()
        .flatten()?;
    is_real_matter(&matter).then_some(matter)
}

/// Browse / keyword-search stored email metadata without decrypting any blob.
/// All matching is done against the plaintext columns inside the SQLCipher DB.
/// Mirrors `mail_get_message` in its spawn_blocking + workspace-guard pattern.
#[tauri::command]
pub async fn mail_list_messages(
    state: State<'_, MailState>,
    query: MailListQuery,
) -> Result<MailListPage, String> {
    let workspace = state
        .workspace
        .lock()
        .await
        .clone()
        .ok_or("workspace not set")?;
    let key = crate::commands::mail::crypto::get_or_create_master_key()
        .map_err(|e| e.to_string())?;
    // SQLite work is blocking; run off the async runtime.
    tokio::task::spawn_blocking(move || {
        let store =
            EncryptedMailStore::open_with_key(&workspace, &key).map_err(|e| e.to_string())?;
        store.list_messages(&query).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| format!("join: {e}"))?
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

    // List the message ids for this folder + each message's durable per-message
    // matter override, from the encrypted metadata store (one open).
    let ws_for_ids = workspace.clone();
    let (provider2, account2, folder2) = (provider.clone(), account.clone(), folder_id.clone());
    let ids_and_overrides: Vec<(String, Option<String>)> = tokio::task::spawn_blocking(
        move || -> anyhow::Result<Vec<(String, Option<String>)>> {
            let store = EncryptedMailStore::open(&ws_for_ids)?;
            let ids = store.ids_in_folder(&provider2, &account2, &folder2)?;
            let mut out = Vec::with_capacity(ids.len());
            for id in ids {
                let ov = store.get_message_matter(&id)?;
                out.push((id, ov));
            }
            Ok(out)
        },
    )
    .await
    .map_err(|e| format!("join: {e}"))?
    .map_err(|e| e.to_string())?;

    if ids_and_overrides.is_empty() {
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

    // VG-6e: the retag matches the tokenized path column — needs the VECTOR
    // store key (not the mail key) to compute each "mail:<id>" token.
    let vec_key = crate::commands::rag::crypto::get_or_create_master_key()
        .map_err(|e| format!("vectors key: {e}"))?;

    let mut retagged = 0u32;
    for (id, override_matter) in ids_and_overrides {
        let path_key = format!("mail:{}", id);
        // BUG-013: a manually-filed message keeps its DURABLE per-message matter
        // even when the whole folder is remapped — only messages without a
        // manual filing follow the folder's new matter. Without this, a folder
        // remap would silently re-scope a manually-filed email's search results.
        // BUG-042: an "unassigned" tombstone (left when a filed-to matter was
        // deleted) stays unassigned rather than being absorbed into the folder.
        let effective_matter =
            resolve_effective_matter(override_matter.as_deref(), matter_id.as_str());
        match crate::commands::rag::store::retag_matter_for_path(
            &table, &path_key, &effective_matter, &vec_key,
        )
        .await
        {
            Ok(rows) if rows > 0 => retagged += 1,
            Ok(_) => {}
            Err(e) => log::warn!("retag matter for {path_key} failed: {e}"),
        }
    }
    Ok(retagged)
}

/// File a SINGLE message to a matter, durably.
///
/// BUG-013: filing is persisted in the mail DB (the durable source of truth that
/// SURVIVES re-sync/re-index) and ALSO mirrored into the RAG index so search
/// scope updates immediately. `message_id` is the provider message id (the part
/// after `mail:` in a citation source — a leading `mail:` prefix is tolerated).
///
/// The command succeeds once the durable filing is written, so the UI can trust
/// the filing happened. The RAG mirror is best-effort: if the message isn't
/// indexed yet, the no-op is fine — sync/backfill stamp the override at index
/// time (see `effective_mail_matter` / `mail_backfill_rag`).
#[tauri::command]
pub async fn mail_retag_message_matter(
    state: State<'_, MailState>,
    message_id: String,
    matter_id: String,
) -> Result<(), String> {
    crate::commands::rag::store::validate_matter_id(&matter_id)
        .map_err(|e| format!("invalid matter id: {e}"))?;
    let workspace = state.workspace.lock().await.clone().ok_or("workspace not set")?;

    // Tolerate a "mail:" prefix so callers can pass the citation source id directly.
    let raw_id = message_id.strip_prefix("mail:").unwrap_or(&message_id).to_string();

    // 1. Durable source of truth: persist the manual filing in the mail DB. This
    //    is the success criterion — once it's written the email IS filed, even if
    //    its RAG chunks don't exist yet.
    {
        let ws = workspace.clone();
        let raw = raw_id.clone();
        let mid = matter_id.clone();
        let exists = tokio::task::spawn_blocking(move || -> anyhow::Result<bool> {
            let store = EncryptedMailStore::open(&ws)?;
            // Don't create a filing for a message that isn't in the mail DB (a
            // stale list/viewer row, or a race with deletion) — that would
            // report success for a phantom message.
            if store.get_record(&raw)?.is_none() {
                return Ok(false);
            }
            store.set_message_matter(&raw, &mid)?;
            Ok(true)
        })
        .await
        .map_err(|e| format!("join: {e}"))?
        .map_err(|e| format!("persist matter filing: {e}"))?;
        if !exists {
            return Err("message not found".to_string());
        }
    }

    // 2. Mirror into the RAG index so search scope follows immediately. Best-
    //    effort: a missing index/table or no-indexed-chunks-yet is NOT an error
    //    (the durable override above will be applied when the message is indexed).
    let conn = match crate::commands::rag::store::open_connection(&workspace).await {
        Ok(c) => c,
        Err(e) => {
            log::warn!("file-to-matter: RAG mirror skipped (open lancedb: {e})");
            return Ok(());
        }
    };
    let names = conn.table_names().execute().await.unwrap_or_default();
    if !names.iter().any(|n| n == crate::commands::rag::store::TABLE_NAME) {
        return Ok(()); // nothing indexed yet — durable filing already persisted
    }
    let table = match conn.open_table(crate::commands::rag::store::TABLE_NAME).execute().await {
        Ok(t) => t,
        Err(e) => {
            log::warn!("file-to-matter: RAG mirror skipped (open table: {e})");
            return Ok(());
        }
    };
    // VG-6e: retag uses the vector-store key (tokenized path predicate).
    let vec_key = match crate::commands::rag::crypto::get_or_create_master_key() {
        Ok(k) => k,
        Err(e) => {
            log::warn!("file-to-matter: RAG mirror skipped (vectors key: {e})");
            return Ok(());
        }
    };
    let path_key = format!("mail:{}", raw_id);
    if let Err(e) =
        crate::commands::rag::store::retag_matter_for_path(&table, &path_key, &matter_id, &vec_key).await
    {
        log::warn!("file-to-matter: RAG mirror retag for {path_key} failed: {e}");
    }
    Ok(())
}

/// Clear every email's manual "filed to this matter" tag for a matter that is
/// being deleted (BUG-042). Returns how many filings were cleared.
///
/// Why this exists: a matter's per-message filings live durably in the mail DB
/// so they survive re-sync. If a matter is deleted without clearing them, the
/// next sync re-tags those emails with a matter id that no longer exists — a
/// phantom. Clearing them lets the emails re-index under their folder default
/// (or unassigned), which matches what "delete the matter, keep the content"
/// means for files. Best-effort: no mail DB yet → 0, never an error.
#[tauri::command]
pub async fn mail_clear_matter_filings(
    state: State<'_, MailState>,
    matter_id: String,
) -> Result<usize, String> {
    crate::commands::rag::store::validate_matter_id(&matter_id)
        .map_err(|e| format!("invalid matter id: {e}"))?;
    let workspace = match state.workspace.lock().await.clone() {
        Some(w) => w,
        None => return Ok(0), // no workspace set yet — nothing to clear
    };
    let cleared = tokio::task::spawn_blocking(move || -> anyhow::Result<usize> {
        // No mail DB on disk yet → nothing filed → 0. Don't open (which would
        // create an empty DB) just to delete a matter that never had email.
        if EncryptedMailStore::db_path(&workspace).exists() {
            let store = EncryptedMailStore::open(&workspace)?;
            Ok(store.clear_message_matter_for_matter(&matter_id)?)
        } else {
            Ok(0)
        }
    })
    .await
    .map_err(|e| format!("join: {e}"))?
    .map_err(|e| format!("clear matter filings: {e}"))?;
    Ok(cleared)
}

/// On-demand fetched attachment bytes, returned to the frontend for display.
/// The bytes never touch disk — they live only in IPC memory and the
/// renderer-process until the user closes the attachment view.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MailAttachmentData {
    pub bytes_base64: String,
    pub content_type: String,
    pub filename: String,
}

/// Fetch one attachment's bytes on demand from the provider.
///
/// Bytes are returned in memory only — never written to disk — so the
/// encryption boundary is preserved. The caller controls how long the bytes
/// live in the renderer.
///
/// IMAP attachment download is not yet implemented and returns an error.
#[tauri::command]
pub async fn mail_get_attachment(
    provider: String,
    account: String,
    message_id: String,
    attachment_id: String,
) -> Result<MailAttachmentData, String> {
    use base64::Engine;
    match provider.as_str() {
        "m365" => {
            let token = fresh_access_token().await?;
            let client = crate::commands::mail::graph::GraphClient::new_with_refresh(
                token,
                graph_token_refresh(),
            );
            let (bytes, content_type, filename) = client
                .get_attachment(&message_id, &attachment_id)
                .await
                .map_err(|e| e.to_string())?;
            Ok(MailAttachmentData {
                bytes_base64: base64::engine::general_purpose::STANDARD.encode(&bytes),
                content_type,
                filename,
            })
        }
        "gmail" => {
            let token = fresh_gmail_access_token().await?;
            let client = crate::commands::mail::gmail::api::GmailClient::new(token);
            // Gmail attachment id is the part-body `attachmentId` — message_id
            // is the gmail message id (without the "gmail:<account>:" prefix).
            let raw_msg_id = message_id
                .strip_prefix(&format!("gmail:{}:", account))
                .unwrap_or(&message_id);
            let bytes = client
                .get_attachment_raw(raw_msg_id, &attachment_id)
                .await
                .map_err(|e| e.to_string())?;
            // Content-type is not returned by the Gmail attachments endpoint.
            // Return a neutral default; the frontend can infer from the filename.
            Ok(MailAttachmentData {
                bytes_base64: base64::engine::general_purpose::STANDARD.encode(&bytes),
                content_type: "application/octet-stream".to_string(),
                filename: attachment_id.clone(), // best we have without re-parsing the message
            })
        }
        "imap" => Err("IMAP attachment download is not yet supported".to_string()),
        other => Err(format!("unknown provider: {other}")),
    }
}

/// Option B healing: re-index mail that was imported while the embedding model
/// was still downloading. During that window each message's RAG indexing fails
/// fast (model-not-ready) and delta sync never re-delivers it, so without this
/// pass that mail would NEVER gain semantic recall. The canonical encrypted
/// bodies are local, so healing needs no network.
///
/// Cheap by design: when the persistent `rag_backfill_needed` marker is absent
/// (the common case) this returns Ok(0) after a single row read, so the
/// frontend can call it on every boot / model-ready transition. When the marker
/// is set, every stored message is walked; messages that already have chunks
/// are skipped (ONE batched path scan up front, then set membership), the rest
/// are re-run through the SAME indexing path the sync uses
/// (`index_mail_text_internal`, which is delete-then-insert by source id, so no
/// duplicate chunks are possible).
///
/// Marker lifecycle: the marker survives a pass ONLY when the model went
/// missing mid-pass (model-not-ready failures) — those messages WILL succeed
/// once the model is back, so retrying on the next boot is correct. Any other
/// pass is terminal and clears the marker: fully successful, or one whose only
/// failures were non-model ones (logged loudly with their ids and NOT retried
/// automatically — a poison message must not re-walk the mailbox every boot).
/// See `backfill_marker_disposition`.
///
/// `matter_map` is the frontend's (provider, account, folder) -> matter mapping
/// (same shape `mail_sync_all` takes) so each backfilled message is scoped
/// exactly as a sync would have scoped it.
#[tauri::command]
pub async fn mail_backfill_rag(
    state: State<'_, MailState>,
    matter_map: Option<Vec<MailMatterMapEntry>>,
) -> Result<u32, String> {
    let workspace = state
        .workspace
        .lock()
        .await
        .clone()
        .ok_or("workspace not set")?;

    // Fast no-op #1: no encrypted mail DB → mail was never imported in this
    // workspace. Returns before touching the OS keychain so an ordinary boot
    // never creates a mail master key (or prompts for keychain access).
    if !EncryptedMailStore::db_path(&workspace).exists() {
        return Ok(0);
    }

    let enc_key = crate::commands::mail::crypto::get_or_create_master_key()
        .map_err(|e| e.to_string())?;

    // Fast no-op #2: marker absent → nothing to heal (one row read).
    let ws_probe = workspace.clone();
    let key_probe = enc_key;
    let needed = match tokio::task::spawn_blocking(move || -> anyhow::Result<bool> {
        let store = EncryptedMailStore::open_with_key(&ws_probe, &key_probe)?;
        Ok(store.get_meta(RAG_BACKFILL_NEEDED_KEY)?.is_some())
    })
    .await
    .map_err(|e| format!("join: {e}"))?
    {
        Ok(n) => n,
        Err(e) => {
            // A real DB error, NOT "marker absent" (get_meta distinguishes the
            // two). Don't guess in either direction: skip the backfill this
            // boot — the marker (if any) is untouched, so the next boot
            // re-probes and self-corrects.
            log::warn!("mail RAG backfill: marker probe failed; skipping this boot: {e:#}");
            return Err(format!("read backfill marker: {e:#}"));
        }
    };
    if !needed {
        return Ok(0);
    }

    // The embedding model must be present, or every message would just re-fail.
    // Bail with the typed marker; the backfill marker stays set for the next try.
    {
        let dir = crate::commands::rag::embedder::resolve_cache_dir();
        let cached = tokio::task::spawn_blocking(move || {
            crate::commands::rag::model_download::model_files_cached(&dir)
        })
        .await
        .map_err(|e| e.to_string())?;
        if !cached {
            return Err(format!(
                "{}: mail RAG backfill deferred until the model downloads",
                crate::commands::rag::embedder::MODEL_NOT_READY
            ));
        }
    }

    // Mutual exclusion with mail_sync_all: both delete-then-insert the same
    // LanceDB rows, so a concurrent pass over the same message could duplicate
    // chunks. Claim the same sync slot; if a sync is running, bail — the
    // marker stays set and the next boot / model-ready signal retries. Note
    // this excludes a RUNNING sync; in-flight spawned index tasks from a
    // just-finished sync may briefly overlap (bounded: delete-then-insert
    // self-heals on the next index of that message).
    if state
        .is_syncing
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return Err("a sync is already in progress".into());
    }
    let _sync_guard = SyncGuard(state.is_syncing.clone());

    let matter_map = matter_map.unwrap_or_default();

    // Collect every stored message record (empty filters are wildcards, so this
    // spans all providers/accounts/folders).
    let ws_list = workspace.clone();
    let key_list = enc_key;
    let (store, records) = tokio::task::spawn_blocking(
        move || -> anyhow::Result<(EncryptedMailStore, Vec<store::MailRecord>)> {
            let store = EncryptedMailStore::open_with_key(&ws_list, &key_list)?;
            let ids = store.ids_in_folder("", "", "")?;
            let mut records = Vec::with_capacity(ids.len());
            for id in ids {
                if let Some(rec) = store.get_record(&id)? {
                    records.push(rec);
                }
            }
            Ok((store, records))
        },
    )
    .await
    .map_err(|e| format!("join: {e}"))?
    .map_err(|e| format!("list mail records: {e:#}"))?;
    let store = Arc::new(store);

    // Open the RAG table once and batch the already-indexed probe: ONE scan of
    // all mail chunk paths into a set, instead of a count_rows query per
    // message. If the scan itself fails, warn and treat it as empty — the
    // indexing below is delete-then-insert (idempotent), so the worst case is
    // redundant re-index work, never a gap.
    let conn = crate::commands::rag::store::open_connection(&workspace)
        .await
        .map_err(|e| format!("open lancedb: {e}"))?;
    let table = crate::commands::rag::store::open_or_create_table(&conn)
        .await
        .map_err(|e| format!("open table: {e}"))?;
    // VG-6e: the probe decrypts the path_enc column back to plaintext
    // "mail:<id>" keys (the path column holds tokens now), so it needs the
    // VECTOR-store key. Key unavailable degrades exactly like a failed scan:
    // empty set → redundant re-index work, never a gap.
    let indexed_paths = match crate::commands::rag::crypto::get_or_create_master_key() {
        Ok(vec_key) => {
            match crate::commands::rag::store::list_indexed_mail_paths(&table, &vec_key).await {
                Ok(set) => set,
                Err(e) => {
                    log::warn!(
                        "mail RAG backfill: indexed-paths scan failed (re-indexing all): {e:#}"
                    );
                    std::collections::HashSet::new()
                }
            }
        }
        Err(e) => {
            log::warn!(
                "mail RAG backfill: vectors key unavailable for the indexed-paths scan \
                 (re-indexing all): {e:#}"
            );
            std::collections::HashSet::new()
        }
    };

    let total = records.len();
    let mut indexed = 0u32;
    // Failure buckets drive the end-of-pass marker disposition: model-not-ready
    // failures mean "a retry after the model returns heals"; anything else is
    // terminal for automatic-retry purposes.
    let mut model_failures = 0usize;
    let mut other_failures = 0usize;
    let mut failed_ids: Vec<String> = Vec::new();
    for rec in records {
        let path_key = format!("mail:{}", rec.id);

        // Skip messages that already have chunks (indexed before the model
        // went missing, or by an earlier partial pass) — set membership against
        // the one batched scan above. This keeps repeated passes cheap even if
        // one poison message keeps the marker set.
        if indexed_paths.contains(&path_key) {
            continue;
        }

        // Decrypt the canonical body (blocking fs + AES) off the runtime.
        let store_read = store.clone();
        let ws_read = workspace.clone();
        let rel = rec.relative_path.clone();
        let key_read = enc_key;
        let text = match tokio::task::spawn_blocking(move || -> anyhow::Result<String> {
            let bytes = store_read.read_blob_with_key(&rel, &ws_read, &key_read)?;
            Ok(String::from_utf8(bytes)?)
        })
        .await
        {
            Ok(Ok(t)) => t,
            Ok(Err(e)) => {
                log::warn!("mail RAG backfill: read body for {path_key} failed: {e:#}");
                other_failures += 1;
                failed_ids.push(path_key);
                continue;
            }
            Err(e) => {
                log::warn!("mail RAG backfill: join for {path_key} failed: {e}");
                other_failures += 1;
                failed_ids.push(path_key);
                continue;
            }
        };

        // BUG-013: a durable per-message filing wins over the folder mapping, so
        // re-indexing (backfill) preserves a manual "file to matter" instead of
        // reverting it to the folder default. Absent override → folder matter.
        // BUG-042: an "unassigned" tombstone stays unassigned (not re-absorbed
        // into the folder's matter).
        let folder_default =
            resolve_mail_matter(&matter_map, &rec.provider, &rec.account, &rec.folder_id);
        let matter =
            resolve_effective_matter(store.get_message_matter(&rec.id).ok().flatten().as_deref(), &folder_default);

        match index_mail_text_internal(&workspace, &path_key, &text, &matter).await {
            Ok(_) => indexed += 1,
            Err(e) => {
                log::warn!("mail RAG backfill index for {path_key} failed: {e:#}");
                if embed_error_is_model_not_ready(&e) {
                    // Everything after this would fail the same way — stop the
                    // walk; the disposition below keeps the marker so the next
                    // boot / ready signal retries.
                    model_failures += 1;
                    break;
                }
                other_failures += 1;
                failed_ids.push(path_key);
            }
        }
    }

    // End-of-pass marker lifecycle (see `backfill_marker_disposition`).
    if backfill_marker_disposition(model_failures, other_failures)
        == BackfillMarkerDisposition::Retain
    {
        // The model regressed mid-pass: the un-indexed remainder WILL succeed
        // once it is back, so the marker must survive for the next boot.
        return Err(format!(
            "{}: mail RAG backfill aborted (model became unavailable); will retry on the next start",
            crate::commands::rag::embedder::MODEL_NOT_READY
        ));
    }

    // Terminal pass (the model was present throughout): surface any permanent
    // failures loudly, then clear the marker either way — retrying a non-model
    // failure every boot would never fix it, just re-walk the mailbox.
    if !failed_ids.is_empty() {
        log::warn!(
            "mail backfill: {} message(s) permanently failed to index and will NOT be retried automatically: {failed_ids:?}",
            failed_ids.len()
        );
    }
    let store_clear = store.clone();
    tokio::task::spawn_blocking(move || store_clear.delete_meta(RAG_BACKFILL_NEEDED_KEY))
        .await
        .map_err(|e| format!("join: {e}"))?
        .map_err(|e| format!("clear backfill marker: {e:#}"))?;
    // Release the once-per-session mark latch so a LATER incident in this
    // session (e.g. the model is deleted and a new sync fails) can re-mark.
    MARKED_THIS_SESSION.store(false, Ordering::SeqCst);

    if other_failures > 0 {
        return Err(format!(
            "mail RAG backfill: {other_failures} of {total} messages permanently failed; not retrying automatically (ids in the log)"
        ));
    }

    Ok(indexed)
}

/// Race `await_redirect_code` against `cancel` being set, polling every 150ms.
/// Lets a pending interactive OAuth wait be aborted immediately (user clicked
/// Cancel, or closed the browser tab and gave up) instead of sitting on the
/// full `timeout`. Returns `Err("cancelled")` when the cancel flag wins.
///
/// NOTE: there is no reliable cross-platform way to detect the user closing
/// the *browser tab/window* itself — `outlook_connect` opens the system's
/// default browser (a separate OS process we don't control a handle to), not
/// an embedded webview we could hook a close event on. The Cancel button is
/// the escape hatch instead: it flips `cancel` and this loop notices within
/// one poll tick.
async fn await_redirect_code_or_cancel(
    listener: tokio::net::TcpListener,
    expected_state: &str,
    timeout: std::time::Duration,
    cancel: Arc<AtomicBool>,
) -> anyhow::Result<String> {
    use crate::commands::mail::gmail::oauth::await_redirect_code;

    let redirect_fut = await_redirect_code(listener, expected_state, timeout);
    tokio::pin!(redirect_fut);
    loop {
        tokio::select! {
            res = &mut redirect_fut => return res,
            _ = tokio::time::sleep(std::time::Duration::from_millis(150)) => {
                if cancel.load(Ordering::SeqCst) {
                    anyhow::bail!("cancelled");
                }
            }
        }
    }
}

/// Run the Microsoft loopback+PKCE sign-in: open the browser, catch the
/// redirect, exchange the code (no client_secret — MS treats this as a public
/// client), and store the refresh token under the SAME keychain entry the
/// existing `OAuth::refresh` path reads, so `fresh_access_token` keeps working
/// unchanged. Blocks until the user finishes, cancels (see
/// `outlook_connect_cancel`), or a 5-minute timeout elapses.
///
/// NOTE for Azure portal: the app registration must have
/// `http://localhost` listed as a Mobile and desktop redirect URI.
#[tauri::command]
pub async fn outlook_connect(state: State<'_, MailState>) -> Result<(), String> {
    use crate::commands::mail::gmail::oauth::{bind_loopback_host, gen_pkce, gen_state, open_browser};
    use crate::commands::mail::oauth::{build_ms_auth_url, ms_exchange_code, MS_TOKEN_ENDPOINT};

    // Reset from any prior cancelled/finished attempt before starting a new one.
    state.oauth_cancel.store(false, Ordering::SeqCst);
    let cancel = state.oauth_cancel.clone();

    let (verifier, challenge) = gen_pkce();
    let state_token = gen_state();
    // Personal Microsoft accounts reject a numeric 127.0.0.1 loopback redirect;
    // they require the "localhost" redirect that matches the app's registered
    // http://localhost. We BIND to "localhost" too (not 127.0.0.1) so the
    // listener is on whatever address the browser resolves "localhost" to — on
    // Windows that's ::1 (IPv6), and binding 127.0.0.1 there gave the user
    // "localhost refused to connect" and a timeout (BUG-010).
    let (listener, redirect_uri) = bind_loopback_host("localhost").await.map_err(|e| e.to_string())?;
    let url = build_ms_auth_url(&client_id(), &redirect_uri, &challenge, &state_token);
    open_browser(&url);
    let code = await_redirect_code_or_cancel(listener, &state_token, std::time::Duration::from_secs(300), cancel)
        .await
        .map_err(|e| e.to_string())?;
    let tokens = ms_exchange_code(&client_id(), &code, &verifier, &redirect_uri, MS_TOKEN_ENDPOINT)
        .await
        .map_err(|e| e.to_string())?;
    keyring::Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_REFRESH_KEY)
        .map_err(|e| e.to_string())?
        .set_password(&tokens.refresh)
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Abort a pending `outlook_connect` interactive sign-in immediately (e.g. the
/// user clicked Cancel on the "Reconnecting…" spinner, or closed the popup and
/// gave up) instead of leaving them stuck on the 5-minute server-side timeout.
/// A no-op if no sign-in is in flight. Never touches the existing stored
/// refresh token — an already-working connection is left intact.
#[tauri::command]
pub async fn outlook_connect_cancel(state: State<'_, MailState>) -> Result<(), String> {
    state.oauth_cancel.store(true, Ordering::SeqCst);
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
    // Distinguish "no token stored" (truly not connected → Ok(false)) from a real
    // keychain READ failure (→ Err). Collapsing both into `false` would let a sync
    // silently skip a connected-but-unreadable account with no error or audit row.
    match entry.get_password() {
        Ok(_) => Ok(true),
        Err(keyring::Error::NoEntry) => Ok(false),
        Err(e) => Err(e.to_string()),
    }
}

/// Disconnect the Microsoft 365 account: delete its refresh token from the OS
/// keychain. Mirrors `gmail_disconnect`. Idempotent (succeeds if already gone).
/// After this, `mail_is_connected` returns false and the user can connect anew —
/// the BUG-008 follow-up so a stale Microsoft sign-in can be removed, not only
/// re-authenticated. Imported mail in the local DB is left intact.
#[tauri::command]
pub async fn mail_disconnect() -> Result<(), String> {
    let entry = keyring::Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_REFRESH_KEY)
        .map_err(|e| e.to_string())?;
    // Surface a genuine deletion failure instead of swallowing it — otherwise the
    // UI could claim "disconnected" while the token actually remains. Already-gone
    // (NoEntry) is success (idempotent).
    match entry.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

async fn fresh_access_token() -> Result<String, String> {
    let entry = keyring::Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_REFRESH_KEY)
        .map_err(|e| e.to_string())?;
    let rt = entry.get_password().map_err(|_| "not connected".to_string())?;
    let auth = OAuth::new(client_id());
    match auth.refresh(&rt).await.map_err(|e| e.to_string())? {
        TokenOutcome::Tokens { access, refresh, .. } => {
            if let Some(new_rt) = refresh {
                // Refresh-token rotation. If persisting the new token fails, do NOT
                // swallow it: log it and raise the process flag so the sync's
                // terminal event can warn the user a reconnect may be needed later.
                // The current access token still works, so this is a warning, not a
                // failure of this call.
                if let Err(e) = entry.set_password(&new_rt) {
                    log::warn!("M365 refresh-token rotation not saved (reconnect may be needed later): {e}");
                    M365_TOKEN_ROTATION_FAILED.store(true, Ordering::SeqCst);
                }
            }
            Ok(access)
        }
        TokenOutcome::Failed(e) if e == "invalid_grant" || e == "invalid_scope" => {
            Err("scope_upgrade_required".to_string())
        }
        TokenOutcome::Failed(e) => Err(format!("refresh failed: {e}")),
        _ => Err("unexpected refresh outcome".into()),
    }
}

fn graph_token_refresh() -> GraphTokenRefresh {
    Arc::new(|| -> GraphTokenRefreshFuture {
        Box::pin(async {
            fresh_access_token()
                .await
                .map_err(|e| anyhow::anyhow!("{e}"))
        })
    })
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
    let oauth = GoogleOAuth::new(gmail_client_id(), gmail_client_secret());
    let tokens = oauth.exchange_code(&code, &verifier, &redirect_uri).await.map_err(|e| e.to_string())?;
    let refresh = tokens.refresh.ok_or("Google did not return a refresh token; try again")?;
    keyring::Entry::new(GMAIL_KEYCHAIN_SERVICE, GMAIL_REFRESH_KEY).map_err(|e| e.to_string())?
        .set_password(&refresh).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn gmail_is_connected() -> Result<bool, String> {
    let entry = keyring::Entry::new(GMAIL_KEYCHAIN_SERVICE, GMAIL_REFRESH_KEY)
        .map_err(|e| e.to_string())?;
    // NoEntry = truly not connected (Ok(false)); any other read error surfaces so
    // a sync never silently skips a connected-but-unreadable Gmail account.
    match entry.get_password() {
        Ok(_) => Ok(true),
        Err(keyring::Error::NoEntry) => Ok(false),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub async fn gmail_disconnect() -> Result<(), String> {
    if let Ok(e) = keyring::Entry::new(GMAIL_KEYCHAIN_SERVICE, GMAIL_REFRESH_KEY) { let _ = e.delete_credential(); }
    Ok(())
}

/// Read the Gmail refresh token from the keychain and exchange it for a fresh
/// access token. Returns `Err("not connected")` if no refresh token is stored.
/// Returns `Err("scope_upgrade_required")` when the stored token predates
/// the gmail.send scope — the frontend should prompt re-auth.
async fn fresh_gmail_access_token() -> Result<String, String> {
    let entry = keyring::Entry::new(GMAIL_KEYCHAIN_SERVICE, GMAIL_REFRESH_KEY)
        .map_err(|e| e.to_string())?;
    let rt = entry.get_password().map_err(|_| "not connected".to_string())?;
    let oauth = crate::commands::mail::gmail::oauth::GoogleOAuth::new(gmail_client_id(), gmail_client_secret());
    match oauth.refresh(&rt).await {
        Ok(tokens) => Ok(tokens.access),
        Err(e) => {
            let msg = e.to_string();
            if msg.contains("invalid_grant") || msg.contains("invalid_scope") {
                Err("scope_upgrade_required".to_string())
            } else {
                Err(msg)
            }
        }
    }
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

    // Delete stale rows before inserting (idempotent). VG-6e: the delete
    // matches the tokenized path column via the vector key.
    crate::commands::rag::store::delete_path(&table, path_key, &key)
        .await
        .context("delete stale mail chunks")?;

    if chunks.is_empty() {
        return Ok(0);
    }

    let texts: Vec<String> = chunks.iter().map(|c| c.text.clone()).collect();
    // F-501-class hardening: bounded batches even for a pathological multi-MB
    // plaintext body. No cancel flag on the mail path, so Some is guaranteed.
    let vectors = crate::commands::rag::embedder::embed_documents_batched(&texts, None)
        .await
        .context("embed mail chunks")?
        .unwrap_or_default();
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

/// Marker key in the encrypted mail store's `meta` table: set when one or more
/// messages could not be RAG-indexed during sync because the embedding model
/// was not downloaded yet (the Option B gate). Delta sync never re-delivers
/// those messages, so without this marker mail imported before model-ready
/// would NEVER gain semantic recall. `mail_backfill_rag` re-indexes from the
/// local encrypted bodies and clears the marker after a terminal pass (see its
/// marker-lifecycle doc and `backfill_marker_disposition`).
pub const RAG_BACKFILL_NEEDED_KEY: &str = "rag_backfill_needed";

/// True when an indexing error chain means "the embedding model is not
/// downloaded yet". Matches the FULL anyhow chain (`{:#}`) because the typed
/// marker sits at the root cause underneath `.context()` wrappers (e.g.
/// "embed mail chunks: model-not-ready: ..."); plain Display shows only the
/// outermost context and would lose it.
fn embed_error_is_model_not_ready(e: &anyhow::Error) -> bool {
    format!("{e:#}").contains(crate::commands::rag::embedder::MODEL_NOT_READY)
}

/// End-of-pass decision for the persistent backfill marker, given the failure
/// buckets a `mail_backfill_rag` pass observed. Pure so the policy is
/// unit-testable.
#[derive(Debug, PartialEq, Eq)]
enum BackfillMarkerDisposition {
    /// Clear the marker: the pass was terminal. Either everything indexed, or
    /// the only failures were non-model ones that an automatic retry would
    /// never fix (the caller logs those loudly instead).
    Clear,
    /// Keep the marker: the model went missing mid-pass, so the un-indexed
    /// remainder WILL succeed once it returns — the next boot must retry.
    Retain,
}

fn backfill_marker_disposition(
    model_failures: usize,
    other_failures: usize,
) -> BackfillMarkerDisposition {
    match (model_failures, other_failures) {
        // The model regressed mid-pass → a retry after it returns heals; keep
        // the marker.
        (m, _) if m > 0 => BackfillMarkerDisposition::Retain,
        // Model present throughout → anything still failing is terminal;
        // clear (the caller warns loudly with the failed ids).
        _ => BackfillMarkerDisposition::Clear,
    }
}

/// Process-level latch: true once `mark_rag_backfill_needed` has persisted the
/// marker this session. A burst of N messages failing in one sync would
/// otherwise open N SQLCipher connections just to upsert the same row. Reset
/// where the marker is cleared (the terminal end of a `mail_backfill_rag`
/// pass) so a later incident in the same session can re-mark.
static MARKED_THIS_SESSION: AtomicBool = AtomicBool::new(false);

/// Process-level flag: set when saving a freshly-rotated Microsoft 365 refresh
/// token to the OS keychain FAILS during a sync. The rotation write failing is
/// non-fatal right now (the access token from this refresh still works), but the
/// new refresh token was not persisted — so a future launch may be unable to
/// refresh and the user will need to reconnect. Surfaced (not swallowed) on the
/// M365 sync's terminal `done` event as a "you may need to reconnect later"
/// heads-up. Reset at the start of each `mail_sync_all` so it reflects only the
/// current run.
static M365_TOKEN_ROTATION_FAILED: AtomicBool = AtomicBool::new(false);

/// Persist the "mail needs a RAG backfill" marker for `workspace`. Idempotent;
/// one row in the encrypted mail store's meta table, written at most once per
/// session (see `MARKED_THIS_SESSION`).
fn mark_rag_backfill_needed(
    workspace: &std::path::Path,
    key: &[u8; 32],
) -> anyhow::Result<()> {
    // Claim the session latch first so concurrent failures collapse to one
    // write.
    if MARKED_THIS_SESSION.swap(true, Ordering::SeqCst) {
        return Ok(()); // already persisted this session
    }
    let result = EncryptedMailStore::open_with_key(workspace, key)
        .and_then(|store| store.set_meta(RAG_BACKFILL_NEEDED_KEY, "1"));
    if result.is_err() {
        // Nothing was persisted — release the latch so the next failing
        // message retries the write instead of trusting a marker that isn't
        // there.
        MARKED_THIS_SESSION.store(false, Ordering::SeqCst);
    }
    result
}

/// Best-effort check, at the end of a provider's sync, of whether a RAG
/// backfill is pending — i.e. some imported messages are NOT yet searchable and
/// are queued to be indexed on a later pass. Two independent signals, either of
/// which means "pending":
///
/// 1. The durable backfill marker is already set (a fire-and-forget index task
///    failed and recorded it — see `spawn_mail_rag_index`).
/// 2. This section imported messages (`wrote_any`) but the embedding model is
///    not downloaded yet, so none of them could have been indexed. This is the
///    common, deterministic case and does NOT race the async index tasks.
///
/// This surfaces an honest "indexed, some queued" signal in the UI/audit. It is
/// only a hint: correctness (no message is ever silently un-indexed) is
/// guaranteed by the durable marker + the next-launch `mail_backfill_rag`, not
/// by this read. Any error reading the marker is treated as "not pending" here.
async fn rag_backfill_pending(workspace: &std::path::Path, key: &[u8; 32], wrote_any: bool) -> bool {
    let ws = workspace.to_path_buf();
    let k = *key;
    let marker_set = tokio::task::spawn_blocking(move || -> anyhow::Result<bool> {
        let store = EncryptedMailStore::open_with_key(&ws, &k)?;
        Ok(store.get_meta(RAG_BACKFILL_NEEDED_KEY)?.is_some())
    })
    .await
    .ok()
    .and_then(|r| r.ok())
    .unwrap_or(false);
    if marker_set {
        return true;
    }
    if wrote_any {
        let dir = crate::commands::rag::embedder::resolve_cache_dir();
        let cached = tokio::task::spawn_blocking(move || {
            crate::commands::rag::model_download::model_files_cached(&dir)
        })
        .await
        .unwrap_or(false);
        if !cached {
            return true;
        }
    }
    false
}

/// Cap on concurrent mail RAG indexing tasks (BUG-011). Each indexed message
/// runs a CPU-heavy embedding (ONNX, which itself spawns inference threads).
/// `spawn_mail_rag_index` is fire-and-forget per message, so a large mailbox
/// import (thousands of messages arriving faster than embedding completes) used
/// to spawn thousands of simultaneous embedding tasks at once → memory/thread
/// exhaustion → allocation failure → the whole app aborted mid-import (this
/// happened with 22 GB free, i.e. it was unbounded concurrency, not low RAM).
/// Every spawned task now waits on this semaphore before doing heavy work, so at
/// most N embeddings run concurrently; the rest queue cheaply (holding only
/// their text). 4 keeps throughput while staying far from the thousands that
/// crashed; `const_new` lets it be a plain static (no lazy init).
static MAIL_INDEX_SEMAPHORE: tokio::sync::Semaphore = tokio::sync::Semaphore::const_new(4);

/// Fire-and-forget mail RAG indexing, shared by every sync `index_callback`
/// (M365 / IMAP / Gmail). On failure it logs the FULL error chain, and when
/// the failure is the Option B "model not downloaded yet" gate it sets the
/// persistent backfill marker so `mail_backfill_rag` can heal this message
/// later from its local encrypted body.
fn spawn_mail_rag_index(
    workspace: std::path::PathBuf,
    path_key: String,
    text: String,
    matter_id: String,
    enc_key: [u8; 32],
) {
    let _ = tokio::task::spawn(async move {
        // Bound concurrent embedding work (BUG-011). Held for the whole index
        // call; if the semaphore is ever closed (it never is — it's a static)
        // we still proceed rather than silently dropping the message.
        let _permit = MAIL_INDEX_SEMAPHORE.acquire().await.ok();
        if let Err(e) =
            index_mail_text_internal(&workspace, &path_key, &text, &matter_id).await
        {
            // {:#} = full anyhow chain, so the log shows root causes.
            log::warn!("mail RAG index failed for {}: {:#}", path_key, e);
            // Mark the backfill on ANY index failure, not only model-not-ready
            // (the previous behavior silently lost every other kind of failure —
            // a transient LanceDB/IO error meant that message never became
            // searchable and was never retried). `mail_backfill_rag` re-derives
            // the model-vs-other failure split on its next pass, so a truly
            // permanent failure is retried once and then dropped loudly with its
            // id in the log — never silently. A non-model failure whose cause has
            // cleared by the next launch heals automatically.
            let ws = workspace.clone();
            match tokio::task::spawn_blocking(move || mark_rag_backfill_needed(&ws, &enc_key)).await
            {
                Ok(Ok(())) => {}
                Ok(Err(me)) => {
                    log::warn!("mail RAG backfill marker not set: {me:#}");
                }
                Err(join) => {
                    log::warn!("mail RAG backfill marker join failed: {join}");
                }
            }
        }
    });
}

/// Should this provider be synced, given an optional single-provider scope?
/// `None` means "sync every connected provider" (a full refresh); `Some(p)`
/// restricts the sync to provider `p`. A connector panel passes its own provider
/// so connecting one account never touches another account's (possibly stale)
/// credentials — which is what used to make connecting Microsoft 365 fail on a
/// left-over Gmail token.
fn should_sync_provider(only: &Option<String>, provider: &str) -> bool {
    match only {
        Some(p) => p == provider,
        None => true,
    }
}

/// Emit one provider-tagged progress event. Every connector panel filters to its
/// own provider, so the tag is what keeps one account's status/count from
/// appearing on another account's panel.
fn emit_sync_progress(app: &AppHandle, provider: &str, status: &str, written: u32, removed: u32) {
    let _ = app.emit(
        SYNC_PROGRESS_EVENT,
        SyncProgress {
            status: status.to_string(),
            provider: provider.to_string(),
            folder: None,
            written,
            removed,
            error: None,
            backfill_pending: false,
            token_warning: false,
        },
    );
}

/// Build the per-message RAG index callback (identical for every provider): spawn
/// fire-and-forget LanceDB indexing (G4) and emit the decrypted-text event the
/// renderer feeds into MiniSearch (G5). Extracted so all three provider sections
/// share one implementation instead of three copies.
fn make_index_callback(
    workspace: std::path::PathBuf,
    app: AppHandle,
    enc_key: [u8; 32],
) -> impl Fn(&str, &str, &str) + Send + Sync {
    move |id: &str, text: &str, matter_id: &str| {
        let path_key = format!("mail:{}", id);
        spawn_mail_rag_index(
            workspace.clone(),
            path_key,
            text.to_string(),
            matter_id.to_string(),
            enc_key,
        );
        let subject = frontmatter_subject(text);
        let _ = app.emit(
            MAIL_INDEX_CHUNK_EVENT,
            MailIndexChunkPayload {
                doc_id: id.to_string(),
                subject,
                decrypted_text: text.to_string(),
            },
        );
    }
}

/// Build the per-message tombstone callback (identical for every provider):
/// delete the deleted message's LanceDB RAG chunks (keyed "mail:<id>") so it stops
/// surfacing in retrieval (S3). Extracted to share one implementation.
fn make_tombstone_callback(workspace: std::path::PathBuf) -> impl Fn(&str) + Send + Sync {
    move |id: &str| {
        let path_key = format!("mail:{}", id);
        let ws = workspace.clone();
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
                            // VG-6e: the delete matches the tokenized path column — needs the vector key.
                            match crate::commands::rag::crypto::get_or_create_master_key() {
                                Ok(vec_key) => {
                                    if let Err(e) = crate::commands::rag::store::delete_path(
                                        &table, &path_key, &vec_key,
                                    )
                                    .await
                                    {
                                        log::warn!(
                                            "S3 tombstone: delete RAG chunks for {} failed: {}",
                                            path_key,
                                            e
                                        );
                                    }
                                }
                                Err(e) => {
                                    log::warn!(
                                        "S3 tombstone: vectors key unavailable for {}: {}",
                                        path_key,
                                        e
                                    );
                                }
                            }
                        }
                    }
                }
                Err(e) => {
                    log::warn!("S3 tombstone: open lancedb for {} failed: {}", path_key, e);
                }
            }
        });
    }
}

/// Sync one folder, emitting provider-tagged progress whose counts are CUMULATIVE
/// across the provider's folders: `base_written`/`base_removed` are the totals
/// from already-completed folders, so the displayed number only ever grows. (Each
/// folder's own counter resets to 0, which made a multi-folder Gmail backfill look
/// like it kept "starting over".) Returns this folder's own stats so the caller
/// can advance the base.
#[allow(clippy::too_many_arguments)]
async fn sync_one_folder(
    app: &AppHandle,
    event_provider: &str,
    provider: &dyn MailProvider,
    store: &(dyn MailStore + Sync),
    workspace: &std::path::Path,
    folder: &crate::commands::mail::provider::RemoteFolder,
    account: &str,
    matter_id: &str,
    enc_key: &[u8; 32],
    base_written: u32,
    base_removed: u32,
) -> anyhow::Result<sync::PageStats> {
    let app2 = app.clone();
    let ep = event_provider.to_string();
    let emit = move |w: u32, r: u32| {
        let _ = app2.emit(
            SYNC_PROGRESS_EVENT,
            SyncProgress {
                status: "syncing".into(),
                provider: ep.clone(),
                folder: None,
                written: base_written.saturating_add(w),
                removed: base_removed.saturating_add(r),
                error: None,
                backfill_pending: false,
                token_warning: false,
            },
        );
    };
    let index_callback = make_index_callback(workspace.to_path_buf(), app.clone(), *enc_key);
    let tombstone_callback = make_tombstone_callback(workspace.to_path_buf());
    sync::sync_folder_provider(
        provider,
        store,
        workspace,
        folder,
        account,
        matter_id,
        enc_key,
        &emit,
        &index_callback,
        &tombstone_callback,
    )
    .await
}

/// Terminal outcome of one provider's sync section.
enum SectionOutcome {
    /// Completed; carries the provider's cumulative written/removed totals and
    /// whether a RAG backfill is pending (some imported messages could not be
    /// indexed for search yet — e.g. the embedding model is still downloading —
    /// so recall is deferred to the next-launch backfill, never silently lost).
    Done {
        written: u32,
        removed: u32,
        backfill_pending: bool,
        /// Microsoft 365 refresh-token rotation failed to persist during this
        /// section (M365 only; always false for IMAP/Gmail).
        token_warning: bool,
    },
    /// The user cancelled mid-sync.
    Cancelled,
}

/// Translate one provider section's result into its provider-tagged terminal
/// event. Called after the section's own folder loop; a section failure is
/// isolated here (it emits that provider's `error` event and is logged) so it
/// never aborts or error-flags the other providers in a full sync.
fn finish_section(app: &AppHandle, provider: &str, result: Result<SectionOutcome, String>) {
    match result {
        Ok(SectionOutcome::Done {
            written,
            removed,
            backfill_pending,
            token_warning,
        }) => {
            let _ = app.emit(
                SYNC_PROGRESS_EVENT,
                SyncProgress {
                    status: "done".into(),
                    provider: provider.to_string(),
                    folder: None,
                    written,
                    removed,
                    error: None,
                    backfill_pending,
                    token_warning,
                },
            );
        }
        Ok(SectionOutcome::Cancelled) => emit_sync_progress(app, provider, "cancelled", 0, 0),
        Err(e) => {
            // Log the failure (the raw provider text never reaches the audit log —
            // the frontend stores only a sanitized category). Carry the raw
            // message in the event so the owner sees WHY on their own screen,
            // instead of a bare "ran into a problem".
            log::warn!("{provider} mail sync failed: {e}");
            let _ = app.emit(
                SYNC_PROGRESS_EVENT,
                SyncProgress {
                    status: "error".into(),
                    provider: provider.to_string(),
                    folder: None,
                    written: 0,
                    removed: 0,
                    error: Some(e),
                    backfill_pending: false,
                    token_warning: false,
                },
            );
        }
    }
}

/// Sync every folder of the Microsoft 365 account. The access token is refreshed
/// before enumeration AND before each folder, so a long backfill never outlives
/// the ~3600s token lifetime. Counts accumulate across folders.
async fn sync_m365_section(
    app: &AppHandle,
    store: &(dyn MailStore + Sync),
    workspace: &std::path::Path,
    enc_key: &[u8; 32],
    matter_map: &[MailMatterMapEntry],
    cancel: &Arc<AtomicBool>,
) -> Result<SectionOutcome, String> {
    let token = fresh_access_token().await?;
    let refresh = graph_token_refresh();
    let folders = crate::commands::mail::graph::GraphProvider::new_with_refresh(
        token,
        refresh.clone(),
    )
        .list_folders()
        .await
        .map_err(|e| e.to_string())?;
    let mut base = sync::PageStats::default();
    for folder in folders {
        if cancel.load(Ordering::SeqCst) {
            return Ok(SectionOutcome::Cancelled);
        }
        let token = fresh_access_token().await?;
        let provider =
            crate::commands::mail::graph::GraphProvider::new_with_refresh(token, refresh.clone());
        let folder_matter = resolve_mail_matter(matter_map, "m365", M365_ACCOUNT, &folder.id);
        let s = sync_one_folder(
            app, "m365", &provider, store, workspace, &folder, M365_ACCOUNT, &folder_matter,
            enc_key, base.written, base.removed,
        )
        .await
        .map_err(|e| e.to_string())?;
        base.written += s.written;
        base.removed += s.removed;
    }
    let backfill_pending = rag_backfill_pending(workspace, enc_key, base.written > 0).await;
    Ok(SectionOutcome::Done {
        written: base.written,
        removed: base.removed,
        backfill_pending,
        // M365-only: whether a refresh-token rotation failed to persist this run.
        token_warning: M365_TOKEN_ROTATION_FAILED.load(Ordering::SeqCst),
    })
}

/// Sync every folder of the configured IMAP account. One provider instance for
/// all folders; counts accumulate across folders.
async fn sync_imap_section(
    app: &AppHandle,
    store: &(dyn MailStore + Sync),
    workspace: &std::path::Path,
    enc_key: &[u8; 32],
    matter_map: &[MailMatterMapEntry],
    cancel: &Arc<AtomicBool>,
) -> Result<SectionOutcome, String> {
    let (imap_cfg, imap_pw) = match load_imap_config() {
        Some(v) => v,
        None => {
            return Ok(SectionOutcome::Done {
                written: 0,
                removed: 0,
                backfill_pending: false,
                token_warning: false,
            })
        }
    };
    use crate::commands::mail::imap::ImapProvider;
    let provider = ImapProvider {
        host: imap_cfg.host.clone(),
        port: imap_cfg.port,
        username: imap_cfg.username.clone(),
        password: imap_pw,
        account: imap_cfg.account.clone(),
    };
    let folders = provider.list_folders().await.map_err(|e| e.to_string())?;
    let mut base = sync::PageStats::default();
    for folder in folders {
        if cancel.load(Ordering::SeqCst) {
            return Ok(SectionOutcome::Cancelled);
        }
        let folder_matter = resolve_mail_matter(matter_map, "imap", &imap_cfg.account, &folder.id);
        let s = sync_one_folder(
            app, "imap", &provider, store, workspace, &folder, &imap_cfg.account, &folder_matter,
            enc_key, base.written, base.removed,
        )
        .await
        .map_err(|e| e.to_string())?;
        base.written += s.written;
        base.removed += s.removed;
    }
    let backfill_pending = rag_backfill_pending(workspace, enc_key, base.written > 0).await;
    Ok(SectionOutcome::Done {
        written: base.written,
        removed: base.removed,
        backfill_pending,
        token_warning: false, // IMAP has no OAuth refresh-token rotation.
    })
}

/// Sync every folder/label of the Gmail account. The token is refreshed before
/// each folder. Counts accumulate across folders — Gmail exposes many labels, so
/// a per-folder counter visibly reset to 0 each label; now it is monotonic.
async fn sync_gmail_section(
    app: &AppHandle,
    store: &(dyn MailStore + Sync),
    workspace: &std::path::Path,
    enc_key: &[u8; 32],
    matter_map: &[MailMatterMapEntry],
    cancel: &Arc<AtomicBool>,
) -> Result<SectionOutcome, String> {
    use crate::commands::mail::gmail::GmailProvider;
    let token = fresh_gmail_access_token().await?;
    let folders = GmailProvider::new(token, GMAIL_ACCOUNT.to_string())
        .list_folders()
        .await
        .map_err(|e| e.to_string())?;
    let mut base = sync::PageStats::default();
    for folder in folders {
        if cancel.load(Ordering::SeqCst) {
            return Ok(SectionOutcome::Cancelled);
        }
        let token = fresh_gmail_access_token().await?;
        let provider = GmailProvider::new(token, GMAIL_ACCOUNT.to_string());
        let folder_matter = resolve_mail_matter(matter_map, "gmail", GMAIL_ACCOUNT, &folder.id);
        let s = sync_one_folder(
            app, "gmail", &provider, store, workspace, &folder, GMAIL_ACCOUNT, &folder_matter,
            enc_key, base.written, base.removed,
        )
        .await
        .map_err(|e| e.to_string())?;
        base.written += s.written;
        base.removed += s.removed;
    }
    let backfill_pending = rag_backfill_pending(workspace, enc_key, base.written > 0).await;
    Ok(SectionOutcome::Done {
        written: base.written,
        removed: base.removed,
        backfill_pending,
        // Gmail rotation is handled by its own token path; not flagged here.
        token_warning: false,
    })
}

/// Enumerate folders then sync each to its deltaLink, emitting provider-tagged
/// progress.
///
/// `matter_map` is the frontend's (provider, account, folder) -> matter mapping
/// (from the matter store). Each folder's mail is indexed under the resolved
/// matter at index time, falling back to `UNASSIGNED_MATTER` when unmapped.
///
/// `only_provider` optionally restricts the sync to a single provider ("m365" |
/// "imap" | "gmail"); a connector panel passes its own provider so connecting one
/// account never runs (or fails on) another account's credentials. Omit it (null)
/// to refresh every connected provider.
#[tauri::command]
pub async fn mail_sync_all(
    app: AppHandle,
    state: State<'_, MailState>,
    matter_map: Option<Vec<MailMatterMapEntry>>,
    only_provider: Option<String>,
) -> Result<(), String> {
    // Atomically claim the sync slot; reject if a sync is already running.
    // We do NOT reset `cancel` if we bail here — an in-flight sync owns it.
    if state.is_syncing
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return Err("a sync is already in progress".into());
    }
    // RAII guard: restores is_syncing=false on every exit path.
    let _sync_guard = SyncGuard(state.is_syncing.clone());

    // Only reset cancel now that we hold the sync slot.
    state.cancel.store(false, Ordering::SeqCst);
    // Clear the token-rotation warning so it reflects only this run.
    M365_TOKEN_ROTATION_FAILED.store(false, Ordering::SeqCst);

    let matter_map = matter_map.unwrap_or_default();

    // Per-provider terminal events (done/error/cancelled) are emitted INSIDE the
    // inner, per section, so one provider failing no longer error-flags the whole
    // sync (it used to emit a single global "error" that showed on every panel).
    let result = mail_sync_all_inner(&app, &state, &matter_map, &only_provider).await;
    if let Err(e) = &result {
        // A setup failure (workspace/store/key) happens BEFORE any provider section,
        // so no `finish_section` ran and no terminal event/audit row would exist —
        // only a rejected promise (which the all-provider UI can miss). Emit a
        // terminal error event so the outcome is visible AND leaves a durable
        // `mail.sync` audit row (via useMailSyncAudit), honoring the "never
        // silent" contract. A single-provider sync tags that provider (its panel
        // filters to it); a full sync tags every provider row so whichever panel
        // is open shows the failure.
        match &only_provider {
            Some(p) => finish_section(&app, p, Err(e.clone())),
            None => {
                for p in ["m365", "imap", "gmail"] {
                    finish_section(&app, p, Err(e.clone()));
                }
            }
        }
    }
    result
}

/// Inner worker for `mail_sync_all`. Runs each in-scope, connected provider in
/// its OWN fault-isolated section: one provider's failure emits that provider's
/// `error` event and is logged, but never aborts or error-flags the others. Each
/// section emits its own provider-tagged terminal event via `finish_section`.
async fn mail_sync_all_inner(
    app: &AppHandle,
    state: &State<'_, MailState>,
    matter_map: &[MailMatterMapEntry],
    only_provider: &Option<String>,
) -> Result<(), String> {
    let workspace = state
        .workspace
        .lock()
        .await
        .clone()
        .ok_or("workspace not set")?;
    let cancel = state.cancel.clone();

    // G7: Remove any plaintext Phase-1 Mail/ directory before the encrypted sync
    // begins. Idempotent: no-op if Mail/ does not exist.
    sync::migrate_plaintext(&workspace);

    let store = EncryptedMailStore::open(&workspace).map_err(|e| e.to_string())?;
    let enc_key = crate::commands::mail::crypto::get_or_create_master_key()
        .map_err(|e| e.to_string())?;

    // Each provider runs only if it is in scope (see `only_provider`) AND actually
    // connected/configured — so connecting one account never reaches into
    // another's (possibly stale) credentials, which is what made connecting
    // Microsoft 365 fail on a left-over Gmail token. `finish_section` emits the
    // provider-tagged terminal event; a section error is isolated to its own
    // provider and never aborts the others.
    // A connectedness probe returning Err (keychain/IO failure) is NOT the same as
    // "not connected" (Ok(false)): treating it as false would silently skip the
    // section, so a user-triggered sync would end with no terminal event and no
    // audit row. `Ok(false)` is a correct silent skip (the user never connected
    // that provider); `Err(_)` is surfaced as that provider's error outcome.
    if should_sync_provider(only_provider, "m365") {
        match mail_is_connected().await {
            Ok(true) => {
                let r =
                    sync_m365_section(app, &store, &workspace, &enc_key, matter_map, &cancel).await;
                finish_section(app, "m365", r);
            }
            Ok(false) => {}
            Err(e) => finish_section(
                app,
                "m365",
                Err(format!("could not check the Microsoft 365 sign-in: {e}")),
            ),
        }
    }

    if should_sync_provider(only_provider, "imap") {
        match load_imap_config_checked() {
            Ok(Some(_)) => {
                let r =
                    sync_imap_section(app, &store, &workspace, &enc_key, matter_map, &cancel).await;
                finish_section(app, "imap", r);
            }
            Ok(None) => {}
            Err(e) => finish_section(
                app,
                "imap",
                Err(format!("could not read the IMAP settings: {e}")),
            ),
        }
    }

    if should_sync_provider(only_provider, "gmail") {
        match gmail_is_connected().await {
            Ok(true) => {
                let r =
                    sync_gmail_section(app, &store, &workspace, &enc_key, matter_map, &cancel).await;
                finish_section(app, "gmail", r);
            }
            Ok(false) => {}
            Err(e) => finish_section(
                app,
                "gmail",
                Err(format!("could not check the Gmail sign-in: {e}")),
            ),
        }
    }

    Ok(())
}

// ─────────────────────────────────────────────────────────────────────────────
// mail_send — compose and send from any connected provider
// ─────────────────────────────────────────────────────────────────────────────

/// Send an email via the named provider/account.
///
/// Parameters
/// ----------
/// * `provider`       — "m365" | "gmail" | "imap"
/// * `account`        — provider account id (e.g. "default" or the IMAP username)
/// * `to`/`cc`/`bcc`  — recipient address strings (RFC5322 `name <addr>` or bare addr)
/// * `subject`        — email subject
/// * `body`           — plain-text body (no HTML; Advisor Prep Hero is plain-text first)
/// * `in_reply_to_id` — provider message id of the message being replied to
///                      (the part after `mail:` in a citation source; a leading
///                      `mail:` prefix is tolerated). When present the command
///                      fetches the original message's `internet_message_id` and
///                      `references` header for threading.
///
/// Returns
/// -------
/// The sent message id (provider-specific) on success, or an empty string for
/// providers that do not return one (SMTP, Graph sendMail). The front end
/// should treat any non-error return as success.
///
/// Error strings
/// -------------
/// * `"scope_upgrade_required"` — the stored OAuth token predates the Mail.Send
///   scope; the frontend should prompt the user to reconnect (re-run the login
///   flow) to grant send permission.
/// * Any other string — a human-readable error.
#[tauri::command]
pub async fn mail_send(
    state: State<'_, MailState>,
    provider: String,
    account: String,
    to: Vec<String>,
    cc: Vec<String>,
    bcc: Vec<String>,
    subject: String,
    body: String,
    in_reply_to_id: Option<String>,
    attachments: Option<Vec<AttachmentInput>>,
) -> Result<String, String> {
    // Never log the body (may contain privileged content) or addresses (PII).
    // Log only the provider+account+subject-length for diagnostics.
    log::info!(
        "mail_send: provider={provider} account={account} subject_len={} attachments={}",
        subject.len(),
        attachments.as_ref().map(|a| a.len()).unwrap_or(0),
    );

    match provider.as_str() {
        "m365" => send_m365(state, to, cc, bcc, subject, body, in_reply_to_id, attachments.unwrap_or_default()).await,
        "gmail" => send_gmail(state, to, cc, bcc, subject, body, in_reply_to_id, attachments.unwrap_or_default()).await,
        "imap" => send_imap(state, account, to, cc, bcc, subject, body, in_reply_to_id, attachments.unwrap_or_default()).await,
        other => Err(format!("unknown provider: {other}")),
    }
}

/// Resolve the internet_message_id + references from a stored message record.
/// Returns (internet_message_id, references). Both may be None/empty.
/// Reads the encrypted blob, parses the YAML frontmatter for these fields.
/// Errors are non-fatal for threading: if we cannot resolve, we send without
/// threading headers rather than blocking the send.
fn resolve_threading_headers(
    workspace: &std::path::Path,
    msg_id: &str,
    key: &[u8; 32],
) -> (Option<String>, Option<String>) {
    let store = match EncryptedMailStore::open_with_key(workspace, key) {
        Ok(s) => s,
        Err(e) => {
            log::warn!("mail_send: open store for threading: {e}");
            return (None, None);
        }
    };
    let rec = match store.get_record(msg_id) {
        Ok(Some(r)) => r,
        Ok(None) => return (None, None),
        Err(e) => {
            log::warn!("mail_send: get_record {msg_id} for threading: {e}");
            return (None, None);
        }
    };
    let bytes = match store.read_blob_with_key(&rec.relative_path, workspace, key) {
        Ok(b) => b,
        Err(e) => {
            log::warn!("mail_send: read blob {msg_id} for threading: {e}");
            return (None, None);
        }
    };
    let markdown = match String::from_utf8(bytes) {
        Ok(s) => s,
        Err(_) => return (None, None),
    };
    // Parse the YAML frontmatter for internet_message_id and references.
    let mut internet_message_id: Option<String> = None;
    let mut references: Option<String> = None;
    let mut in_fm = false;
    for line in markdown.lines() {
        if line.trim() == "---" {
            if in_fm {
                break;
            }
            in_fm = true;
            continue;
        }
        if !in_fm {
            continue;
        }
        if let Some((key_name, val)) = line.split_once(':') {
            match key_name.trim() {
                "internet_message_id" => {
                    let v = val.trim().trim_matches('"');
                    if !v.is_empty() {
                        internet_message_id = Some(v.to_string());
                    }
                }
                "references" => {
                    let v = val.trim().trim_matches('"');
                    if !v.is_empty() {
                        references = Some(v.to_string());
                    }
                }
                _ => {}
            }
        }
    }
    (internet_message_id, references)
}

async fn send_m365(
    _state: State<'_, MailState>,
    to: Vec<String>,
    cc: Vec<String>,
    bcc: Vec<String>,
    subject: String,
    body: String,
    _in_reply_to_id: Option<String>,
    attachments: Vec<AttachmentInput>,
) -> Result<String, String> {
    let token = fresh_access_token().await?; // returns "scope_upgrade_required" when needed
    let client = crate::commands::mail::graph::GraphClient::new_with_refresh(
        token,
        graph_token_refresh(),
    );

    // conversation_id is not stored in MailRecord; pass None for now.
    // Threading for M365 replies can be added when conversationId is stored.
    client
        .send_message(
            &to,
            &cc,
            &bcc,
            &subject,
            &body,
            None,
            true,
            &attachments,
        )
        .await
        .map_err(|e| e.to_string())
}

async fn send_gmail(
    state: State<'_, MailState>,
    to: Vec<String>,
    cc: Vec<String>,
    bcc: Vec<String>,
    subject: String,
    body: String,
    in_reply_to_id: Option<String>,
    attachments: Vec<AttachmentInput>,
) -> Result<String, String> {
    let token = fresh_gmail_access_token().await?; // returns "scope_upgrade_required" when needed

    // Resolve threading headers from the stored message.
    let (in_reply_to, references) = if let Some(ref orig_id) = in_reply_to_id {
        let raw_id = orig_id.strip_prefix("mail:").unwrap_or(orig_id).to_string();
        let workspace = state.workspace.lock().await.clone();
        if let Some(ws) = workspace {
            let key = crate::commands::mail::crypto::get_or_create_master_key()
                .map_err(|e| e.to_string())?;
            let ws2 = ws.clone();
            let key2 = key;
            let raw_id2 = raw_id.clone();
            tokio::task::spawn_blocking(move || {
                resolve_threading_headers(&ws2, &raw_id2, &key2)
            })
            .await
            .unwrap_or((None, None))
        } else {
            (None, None)
        }
    } else {
        (None, None)
    };

    // Fetch the sender address from the Gmail profile.
    let gmail_client = crate::commands::mail::gmail::api::GmailClient::new(token.clone());
    let from = gmail_client
        .get_sender_address()
        .await
        .map_err(|e| e.to_string())?;

    gmail_client
        .send_message(
            &from,
            &to,
            &cc,
            &bcc,
            &subject,
            &body,
            in_reply_to.as_deref(),
            references.as_deref(),
            &attachments,
        )
        .await
        .map_err(|e| e.to_string())
}

async fn send_imap(
    state: State<'_, MailState>,
    _account: String,
    to: Vec<String>,
    cc: Vec<String>,
    bcc: Vec<String>,
    subject: String,
    body: String,
    in_reply_to_id: Option<String>,
    attachments: Vec<AttachmentInput>,
) -> Result<String, String> {
    let (cfg, password) = load_imap_config().ok_or("IMAP not connected")?;

    // Resolve threading headers.
    let (in_reply_to, references) = if let Some(ref orig_id) = in_reply_to_id {
        let raw_id = orig_id.strip_prefix("mail:").unwrap_or(orig_id).to_string();
        let workspace = state.workspace.lock().await.clone();
        if let Some(ws) = workspace {
            let key = crate::commands::mail::crypto::get_or_create_master_key()
                .map_err(|e| e.to_string())?;
            tokio::task::spawn_blocking(move || {
                resolve_threading_headers(&ws, &raw_id, &key)
            })
            .await
            .unwrap_or((None, None))
        } else {
            (None, None)
        }
    } else {
        (None, None)
    };

    let from = cfg.username.clone(); // username is the email address for IMAP
    let host = cfg.host.clone();
    let smtp_port: u16 = 587;

    crate::commands::mail::imap::send::smtp_send(
        &host,
        smtp_port,
        &cfg.username,
        &password,
        &from,
        &to,
        &cc,
        &bcc,
        &subject,
        &body,
        in_reply_to.as_deref(),
        references.as_deref(),
        &attachments,
    )
    .await
    .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::{await_redirect_code_or_cancel, frontmatter_subject, get_message_with_key, resolve_effective_matter, resolve_mail_matter, should_sync_provider, yaml_unescape, MailMatterMapEntry};
    use crate::commands::mail::store::EncryptedMailStore;
    use crate::commands::rag::store::UNASSIGNED_MATTER;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::Arc;
    use std::time::Duration;

    // ── OAuth cancel — the "Reconnect hangs 5 minutes with no cancel" fix ────

    #[tokio::test]
    async fn await_redirect_code_or_cancel_returns_immediately_when_cancelled() {
        // Nobody ever connects to the listener (simulates the user closing the
        // OAuth popup, or never completing it) and the cancel flag is already
        // set — this must return quickly, NOT sit on the 300s server timeout.
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let cancel = Arc::new(AtomicBool::new(true));

        let started = tokio::time::Instant::now();
        let result = tokio::time::timeout(
            Duration::from_secs(2),
            await_redirect_code_or_cancel(listener, "state", Duration::from_secs(300), cancel),
        )
        .await
        .expect("must not hit the 2s outer test timeout — cancellation should be near-instant");

        assert!(result.is_err(), "a cancelled wait must return an error, not a code");
        assert!(started.elapsed() < Duration::from_secs(1), "cancellation must be detected within one poll tick, not the full timeout");
    }

    #[tokio::test]
    async fn await_redirect_code_or_cancel_returns_the_code_when_not_cancelled() {
        // The happy path must still work unchanged: a real redirect completes
        // normally when cancel is never set.
        use tokio::io::AsyncWriteExt;

        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let cancel = Arc::new(AtomicBool::new(false));

        let task = tokio::spawn(await_redirect_code_or_cancel(
            listener,
            "TEST_STATE",
            Duration::from_secs(5),
            cancel,
        ));

        let mut stream = tokio::net::TcpStream::connect(format!("127.0.0.1:{port}")).await.unwrap();
        let request = "GET /?code=REALCODE&state=TEST_STATE HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n";
        stream.write_all(request.as_bytes()).await.unwrap();
        stream.flush().await.unwrap();

        let code = task.await.unwrap().expect("must succeed when never cancelled");
        assert_eq!(code, "REALCODE");
    }

    #[tokio::test]
    async fn await_redirect_code_or_cancel_notices_a_late_cancel() {
        // Cancel flips AFTER the wait has started (mirrors clicking Cancel
        // mid-wait, not just a pre-set flag) — must still bail out promptly
        // instead of waiting for the full timeout.
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let cancel = Arc::new(AtomicBool::new(false));
        let cancel_setter = cancel.clone();

        let task = tokio::spawn(await_redirect_code_or_cancel(
            listener,
            "state",
            Duration::from_secs(300),
            cancel,
        ));

        tokio::time::sleep(Duration::from_millis(50)).await;
        cancel_setter.store(true, Ordering::SeqCst);

        let result = tokio::time::timeout(Duration::from_secs(2), task)
            .await
            .expect("must not hit the 2s outer test timeout")
            .unwrap();
        assert!(result.is_err(), "a late cancel must still abort the wait");
    }

    #[test]
    fn resolve_effective_matter_real_override_wins_over_folder() {
        // BUG-013: a manual filing to a live matter beats the folder default.
        assert_eq!(
            resolve_effective_matter(Some("matter-acme"), "matter-folderdefault"),
            "matter-acme"
        );
    }

    #[test]
    fn resolve_effective_matter_no_override_uses_folder_default() {
        // Never manually filed → follow the folder mapping.
        assert_eq!(
            resolve_effective_matter(None, "matter-folderdefault"),
            "matter-folderdefault"
        );
    }

    #[test]
    fn resolve_effective_matter_unassigned_tombstone_stays_unassigned() {
        // BUG-042: the tombstone left when a filed-to matter is deleted must NOT
        // be re-absorbed into the folder's (different, live) matter — otherwise a
        // deleted matter's email would silently move into another matter.
        assert_eq!(
            resolve_effective_matter(Some(UNASSIGNED_MATTER), "matter-otherlive"),
            UNASSIGNED_MATTER
        );
    }

    #[test]
    fn should_sync_provider_scopes_to_one_when_set() {
        // A connector panel passes its own provider so connecting Microsoft 365
        // never runs (or fails on) a left-over Gmail token, and vice versa.
        assert!(should_sync_provider(&Some("m365".to_string()), "m365"));
        assert!(!should_sync_provider(&Some("m365".to_string()), "gmail"));
        assert!(!should_sync_provider(&Some("m365".to_string()), "imap"));
        assert!(should_sync_provider(&Some("gmail".to_string()), "gmail"));
    }

    #[test]
    fn should_sync_provider_allows_all_when_unscoped() {
        // None = a full refresh: every connected provider is in scope.
        assert!(should_sync_provider(&None, "m365"));
        assert!(should_sync_provider(&None, "imap"));
        assert!(should_sync_provider(&None, "gmail"));
    }

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
                subject: "Closing date".into(),
                from_addr: "pat@hender.com".into(),
                from_name: "Pat H".into(),
                snippet: "Confirming May 14.".into(),
                has_attachments: false,
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

    // Option B — mail RAG backfill marker mechanics ---------------------------

    #[test]
    fn embed_error_routing_detects_model_not_ready_through_context_chain() {
        use super::embed_error_is_model_not_ready;
        // Mirrors the real failure shape: the gate's bail!() root cause gets
        // wrapped by `.context("embed mail chunks")` in
        // index_mail_text_internal. Plain Display shows only the outermost
        // context and LOSES the marker — that is exactly why the helper
        // matches on the full `{:#}` chain.
        let root = anyhow::anyhow!(
            "{}: the search model is not downloaded yet",
            crate::commands::rag::embedder::MODEL_NOT_READY
        );
        let wrapped = root.context("embed mail chunks");
        assert!(
            !format!("{wrapped}").contains(crate::commands::rag::embedder::MODEL_NOT_READY),
            "Display alone must lose the marker (the premise of using the full chain)"
        );
        assert!(embed_error_is_model_not_ready(&wrapped));

        // Unwrapped root error also routes.
        let bare = anyhow::anyhow!(
            "{}: indexing deferred until the model downloads",
            crate::commands::rag::embedder::MODEL_NOT_READY
        );
        assert!(embed_error_is_model_not_ready(&bare));

        // Other failures never set the backfill marker.
        let other = anyhow::anyhow!("lance dataset panic").context("embed mail chunks");
        assert!(!embed_error_is_model_not_ready(&other));
    }

    #[test]
    fn backfill_marker_set_is_idempotent_and_clearable() {
        use super::{mark_rag_backfill_needed, MARKED_THIS_SESSION, RAG_BACKFILL_NEEDED_KEY};
        use std::sync::atomic::Ordering;
        let dir = tempfile::TempDir::new().unwrap();
        let key = [0x42u8; 32];

        // This is the only test that touches the process-level latch; start
        // from a known state so test order can't matter.
        MARKED_THIS_SESSION.store(false, Ordering::SeqCst);

        // Setting the marker creates the store (meta table included) + the row.
        mark_rag_backfill_needed(dir.path(), &key).unwrap();
        let store = EncryptedMailStore::open_with_key(dir.path(), &key).unwrap();
        assert_eq!(
            store.get_meta(RAG_BACKFILL_NEEDED_KEY).unwrap().as_deref(),
            Some("1")
        );

        // Marking again (every failed message during a sync calls this) is
        // idempotent — and short-circuits on the session latch, so a burst of
        // failures doesn't open one SQLCipher connection per message.
        mark_rag_backfill_needed(dir.path(), &key).unwrap();
        assert_eq!(
            store.get_meta(RAG_BACKFILL_NEEDED_KEY).unwrap().as_deref(),
            Some("1")
        );

        // Proof of the short-circuit: delete the row out from under the latch;
        // a re-mark while the latch is still set must NOT rewrite it...
        store.delete_meta(RAG_BACKFILL_NEEDED_KEY).unwrap();
        mark_rag_backfill_needed(dir.path(), &key).unwrap();
        assert_eq!(store.get_meta(RAG_BACKFILL_NEEDED_KEY).unwrap(), None);

        // ...while after the latch reset that mail_backfill_rag performs when
        // it clears the marker, a later incident in the same session re-marks.
        MARKED_THIS_SESSION.store(false, Ordering::SeqCst);
        mark_rag_backfill_needed(dir.path(), &key).unwrap();
        assert_eq!(
            store.get_meta(RAG_BACKFILL_NEEDED_KEY).unwrap().as_deref(),
            Some("1")
        );

        // mail_backfill_rag clears it after a terminal pass.
        store.delete_meta(RAG_BACKFILL_NEEDED_KEY).unwrap();
        assert_eq!(store.get_meta(RAG_BACKFILL_NEEDED_KEY).unwrap(), None);

        // Leave the latch clean for any future test in this process.
        MARKED_THIS_SESSION.store(false, Ordering::SeqCst);
    }

    /// The pure end-of-pass policy: the marker survives ONLY a model
    /// regression; terminal (non-model) failures never pin it.
    #[test]
    fn backfill_marker_disposition_covers_all_four_buckets() {
        use super::backfill_marker_disposition;
        use super::BackfillMarkerDisposition::{Clear, Retain};
        // Clean pass → clear.
        assert_eq!(backfill_marker_disposition(0, 0), Clear);
        // Terminal (non-model) failures only → clear anyway; retrying every
        // boot would never fix them (they are logged loudly instead).
        assert_eq!(backfill_marker_disposition(0, 3), Clear);
        // Model regressed mid-pass → retain; a retry after the model returns
        // heals the remainder.
        assert_eq!(backfill_marker_disposition(2, 0), Retain);
        // Mixed → the model bucket wins; retain.
        assert_eq!(backfill_marker_disposition(2, 3), Retain);
    }
}

#[cfg(test)]
mod mail_retag_message_tests {
    use super::backfill_marker_disposition;
    use super::BackfillMarkerDisposition;
    use super::SyncProgress;

    #[test]
    fn backfill_marker_disposition_model_failure_retains() {
        assert_eq!(
            backfill_marker_disposition(1, 0),
            BackfillMarkerDisposition::Retain
        );
    }

    #[test]
    fn backfill_marker_disposition_other_failure_clears() {
        assert_eq!(
            backfill_marker_disposition(0, 5),
            BackfillMarkerDisposition::Clear
        );
    }

    #[test]
    fn backfill_marker_disposition_clean_run_clears() {
        assert_eq!(
            backfill_marker_disposition(0, 0),
            BackfillMarkerDisposition::Clear
        );
    }

    // ── Terminal sync-event wire contract ────────────────────────────────────
    // The frontend's honest-outcome UI + the durable `mail.sync` audit row read
    // `backfillPending`, `tokenWarning`, and (on error) `error` off this event.
    // These guard the exact JSON keys (camelCase) and that a raw error message
    // NEVER rides along on a success event.

    #[test]
    fn done_event_serializes_backfill_and_token_flags_as_camelcase() {
        let v = serde_json::to_value(SyncProgress {
            status: "done".into(),
            provider: "m365".into(),
            folder: None,
            written: 42,
            removed: 3,
            error: None,
            backfill_pending: true,
            token_warning: true,
        })
        .unwrap();
        assert_eq!(v["status"], "done");
        assert_eq!(v["written"], 42);
        assert_eq!(v["backfillPending"], true);
        assert_eq!(v["tokenWarning"], true);
        // A success event must never carry an `error` field (skipped when None),
        // so the audit path can't mistake a success for a failure.
        assert!(v.get("error").is_none());
    }

    #[test]
    fn error_event_carries_error_message_for_the_owner() {
        let v = serde_json::to_value(SyncProgress {
            status: "error".into(),
            provider: "gmail".into(),
            folder: None,
            written: 0,
            removed: 0,
            error: Some("graph 500".into()),
            backfill_pending: false,
            token_warning: false,
        })
        .unwrap();
        assert_eq!(v["status"], "error");
        assert_eq!(v["error"], "graph 500");
    }
}
