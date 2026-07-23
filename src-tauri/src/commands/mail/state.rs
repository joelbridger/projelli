use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::Manager;

pub(crate) const KEYCHAIN_SERVICE: &str = crate::identity::MAIL_MS_SERVICE;
pub(crate) const KEYCHAIN_REFRESH_KEY: &str = "ms-refresh-token";
/// Account id for the single Microsoft 365 account (one refresh token today).
/// Cursors are scoped by (provider, account, folder); see `sync_folder_provider`.
pub(crate) const M365_ACCOUNT: &str = "default";

pub(crate) const IMAP_KEYCHAIN_SERVICE: &str = crate::identity::MAIL_IMAP_SERVICE;
pub(crate) const IMAP_CONFIG_KEY: &str = "config"; // JSON {account,host,port,username}
pub(crate) const IMAP_PASSWORD_KEY: &str = "password";

pub(crate) const GMAIL_KEYCHAIN_SERVICE: &str = crate::identity::MAIL_GMAIL_SERVICE;
pub(crate) const GMAIL_REFRESH_KEY: &str = "refresh-token";
pub(crate) const GMAIL_ACCOUNT: &str = "default"; // single Gmail account today; cursors are (provider,account,folder)-scoped

pub(crate) fn gmail_client_id() -> String {
    // Injected at build time from the LANTERN_GMAIL_CLIENT_ID secret (CI job
    // env in .github/workflows/release.yml). Kept out of source so it is never
    // committed; set the env locally for `tauri dev` Gmail testing.
    option_env!("LANTERN_GMAIL_CLIENT_ID").unwrap_or("").to_string()
}

pub(crate) fn gmail_client_secret() -> String {
    // Google requires the client_secret at its token endpoint for Desktop-type
    // OAuth clients (even with PKCE). Injected at build time from the
    // LANTERN_GMAIL_CLIENT_SECRET secret; never committed to source.
    option_env!("LANTERN_GMAIL_CLIENT_SECRET").unwrap_or("").to_string()
}

/// True when this build has real Google OAuth client credentials baked in
/// (both `LANTERN_GMAIL_CLIENT_ID` and `_SECRET` were set when `cargo build`
/// ran — `option_env!` is compile-time, so this is fixed for the lifetime of
/// the running binary). `gmail_connect` checks this before ever opening a
/// browser window, so a build missing the secrets fails with an honest
/// "not_configured" instead of Google's raw "Error 400: invalid_request —
/// Missing required parameter: client_id".
pub(crate) fn gmail_oauth_is_configured() -> bool {
    !gmail_client_id().is_empty() && !gmail_client_secret().is_empty()
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
pub struct MailState {
    pub workspace: tokio::sync::Mutex<Option<std::path::PathBuf>>,
    /// M4's separate native owner. Legacy mail paths never populate it.
    #[cfg(not(test))]
    m4_workspace_owner:
        tokio::sync::Mutex<super::verified_workspace_lifecycle::NativeWorkspaceLifecycle>,
    /// Serializes each durable manual filing with its matching RAG mirror.
    pub retag_lock: tokio::sync::Mutex<()>,
    pub cancel: Arc<AtomicBool>,
    pub is_syncing: Arc<AtomicBool>,
    /// Separate from `cancel` (which cancels an in-flight mail *sync*): this
    /// flag lets the frontend abort a pending interactive OAuth sign-in
    /// (`outlook_connect`'s wait for the browser redirect) without touching
    /// sync state. See `outlook_connect_cancel`.
    pub oauth_cancel: Arc<AtomicBool>,
    /// Same idea as `oauth_cancel`, but for `gmail_connect`'s own pending
    /// sign-in. Kept separate so cancelling one provider's in-flight OAuth
    /// (e.g. the user backs out of Gmail) can never also cancel an unrelated
    /// M365 sign-in that happens to be pending at the same time. See
    /// `gmail_connect_cancel`.
    pub gmail_oauth_cancel: Arc<AtomicBool>,
}

pub fn manage_state(app: &tauri::App) {
    app.manage(MailState {
        workspace: tokio::sync::Mutex::new(None),
        #[cfg(not(test))]
        m4_workspace_owner: tokio::sync::Mutex::new(
            super::verified_workspace_lifecycle::NativeWorkspaceLifecycle::default(),
        ),
        retag_lock: tokio::sync::Mutex::new(()),
        cancel: Arc::new(AtomicBool::new(false)),
        is_syncing: Arc::new(AtomicBool::new(false)),
        oauth_cancel: Arc::new(AtomicBool::new(false)),
        gmail_oauth_cancel: Arc::new(AtomicBool::new(false)),
    });
}

impl MailState {
    /// Production commands always use the owner held by this app state. The
    /// test-only fallback keeps long-standing mail test fixtures source-stable;
    /// it is not compiled into the desktop app and cannot persist authority.
    pub(crate) async fn open_m4_workspace_selected(
        &self,
        selected_root: &std::path::Path,
    ) -> anyhow::Result<()> {
        #[cfg(not(test))]
        {
            return self
                .m4_workspace_owner
                .lock()
                .await
                .open_selected(selected_root);
        }

        #[cfg(test)]
        {
            test_only_m4_owner()
                .lock()
                .await
                .open_selected(selected_root)
        }
    }

    /// Revoke the M4-only generation during a non-M4 workspace transition.
    /// This takes no renderer workspace data and cannot mint authority.
    pub(crate) async fn revoke_m4_workspace(&self) {
        #[cfg(not(test))]
        {
            self.m4_workspace_owner.lock().await.revoke_current();
        }

        #[cfg(test)]
        {
            test_only_m4_owner().lock().await.revoke_current();
        }
    }
}

#[cfg(test)]
fn test_only_m4_owner(
) -> &'static tokio::sync::Mutex<super::verified_workspace_lifecycle::NativeWorkspaceLifecycle> {
    use std::sync::OnceLock;

    static TEST_ONLY_OWNER: OnceLock<
        tokio::sync::Mutex<super::verified_workspace_lifecycle::NativeWorkspaceLifecycle>,
    > = OnceLock::new();
    TEST_ONLY_OWNER.get_or_init(|| {
        tokio::sync::Mutex::new(
            super::verified_workspace_lifecycle::NativeWorkspaceLifecycle::default(),
        )
    })
}

/// RAII guard: sets `is_syncing` to false when dropped, covering all exit paths.
pub(crate) struct SyncGuard(pub(crate) Arc<AtomicBool>);
impl Drop for SyncGuard {
    fn drop(&mut self) {
        self.0.store(false, Ordering::SeqCst);
    }
}

pub(crate) fn client_id() -> String {
    option_env!("LANTERN_MS_CLIENT_ID")
        .unwrap_or("845ddba0-70ab-4f90-88ba-e3522157e37a")
        .to_string()
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
pub(crate) fn load_imap_config() -> Option<(ImapConfig, String)> {
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
pub(crate) fn load_imap_config_checked() -> Result<Option<(ImapConfig, String)>, String> {
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
/// Process-level flag: set when saving a freshly-rotated Microsoft 365 refresh
/// token to the OS keychain FAILS during a sync. The rotation write failing is
/// non-fatal right now (the access token from this refresh still works), but the
/// new refresh token was not persisted — so a future launch may be unable to
/// refresh and the user will need to reconnect. Surfaced (not swallowed) on the
/// M365 sync's terminal `done` event as a "you may need to reconnect later"
/// heads-up. Reset at the start of each `mail_sync_all` so it reflects only the
/// current run.
pub(crate) static M365_TOKEN_ROTATION_FAILED: AtomicBool = AtomicBool::new(false);
