use super::*;
use crate::commands::mail::graph::{GraphTokenRefresh, GraphTokenRefreshFuture};
use crate::commands::mail::oauth::{OAuth, TokenOutcome};
use crate::commands::mail::provider::MailProvider;
use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::State;

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
pub(crate) async fn await_redirect_code_or_cancel(
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
    use crate::commands::mail::gmail::oauth::{
        bind_loopback_host, gen_pkce, gen_state, open_browser, store_or_rollback_on_cancel,
    };
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
    let code = await_redirect_code_or_cancel(listener, &state_token, std::time::Duration::from_secs(300), cancel.clone())
        .await
        .map_err(|e| e.to_string())?;
    let tokens = ms_exchange_code(&client_id(), &code, &verifier, &redirect_uri, MS_TOKEN_ENDPOINT)
        .await
        .map_err(|e| e.to_string())?;

    // Cancel can arrive while the token exchange (a network round trip) was in
    // flight — check again before persisting so a canceled flow never leaves a
    // stored credential behind, even though the redirect wait itself already
    // resolved successfully. Mirrors onedrive_connect / gmail_connect.
    let entry = keyring::Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_REFRESH_KEY)
        .map_err(|e| e.to_string())?;
    // Snapshot whatever was there before (if this is a reconnect over an
    // existing connection) so a cancel-after-store rolls back to THAT, rather
    // than always deleting — a canceled reconnect must not disconnect an
    // already-working account.
    let previous_token = entry.get_password().ok();
    store_or_rollback_on_cancel(
        &cancel,
        || entry.set_password(&tokens.refresh).map_err(|e| e.to_string()),
        || match &previous_token {
            Some(prev) => {
                let _ = entry.set_password(prev);
            }
            None => {
                let _ = entry.delete_credential();
            }
        },
    )
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

pub(crate) async fn fresh_access_token() -> Result<String, String> {
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

pub(crate) fn graph_token_refresh() -> GraphTokenRefresh {
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
/// until the user finishes, cancels (see `gmail_connect_cancel`), or a
/// 5-minute timeout elapses.
///
/// Returns `Err("not_configured")` immediately, before ever opening a browser
/// window, when this build has no Google OAuth client credentials baked in
/// (see `gmail_oauth_is_configured`) — the frontend shows a calm "not set up"
/// note instead of letting the user hit Google's raw "Error 400:
/// invalid_request — Missing required parameter: client_id".
#[tauri::command]
pub async fn gmail_connect(state: State<'_, MailState>) -> Result<(), String> {
    use crate::commands::mail::gmail::oauth::{
        await_redirect_code_or_cancel, bind_loopback, build_auth_url, gen_pkce, gen_state,
        open_browser, store_or_rollback_on_cancel, GoogleOAuth,
    };

    if !gmail_oauth_is_configured() {
        return Err("not_configured".to_string());
    }

    // Reset from any prior cancelled/finished attempt before starting a new one.
    state.gmail_oauth_cancel.store(false, Ordering::SeqCst);
    let cancel = state.gmail_oauth_cancel.clone();

    let (verifier, challenge) = gen_pkce();
    let state_token = gen_state();
    let (listener, redirect_uri) = bind_loopback().await.map_err(|e| e.to_string())?;
    let url = build_auth_url(&gmail_client_id(), &redirect_uri, &challenge, &state_token);
    open_browser(&url);
    let code = await_redirect_code_or_cancel(
        listener,
        &state_token,
        std::time::Duration::from_secs(300),
        cancel.clone(),
    )
    .await
    .map_err(|e| e.to_string())?;
    let oauth = GoogleOAuth::new(gmail_client_id(), gmail_client_secret());
    let tokens = oauth
        .exchange_code(&code, &verifier, &redirect_uri)
        .await
        .map_err(|e| e.to_string())?;
    let refresh = tokens
        .refresh
        .ok_or("Google did not return a refresh token; try again")?;

    // Cancel can arrive while the token exchange (a network round trip) was in
    // flight — check again before persisting so a canceled flow never leaves a
    // stored credential behind, even though the redirect wait itself already
    // resolved successfully.
    let entry = keyring::Entry::new(GMAIL_KEYCHAIN_SERVICE, GMAIL_REFRESH_KEY)
        .map_err(|e| e.to_string())?;
    // Snapshot whatever was there before (if this is a reconnect over an
    // existing connection) so a cancel-after-store rolls back to THAT, rather
    // than always deleting — a canceled reconnect must not disconnect an
    // already-working account.
    let previous_token = entry.get_password().ok();
    store_or_rollback_on_cancel(
        &cancel,
        || entry.set_password(&refresh).map_err(|e| e.to_string()),
        || match &previous_token {
            Some(prev) => {
                let _ = entry.set_password(prev);
            }
            None => {
                let _ = entry.delete_credential();
            }
        },
    )
}

/// Abort a pending `gmail_connect` interactive sign-in immediately (e.g. the
/// user clicked Cancel, or closed the browser tab and gave up) instead of
/// leaving them stuck on the 5-minute server-side timeout. A no-op if no
/// sign-in is in flight. Never touches an already-working connection.
#[tauri::command]
pub async fn gmail_connect_cancel(state: State<'_, MailState>) -> Result<(), String> {
    state.gmail_oauth_cancel.store(true, Ordering::SeqCst);
    Ok(())
}

/// Whether this build's Gmail connector has real Google OAuth client
/// credentials baked in. The frontend calls this before offering "Connect
/// Gmail" so a build missing `LANTERN_GMAIL_CLIENT_ID`/`_SECRET` (e.g. a
/// local dev build where the secret was never exported before `cargo build`
/// ran) shows an honest "Gmail isn't set up on this build" note instead of
/// a raw Google OAuth error.
#[tauri::command]
pub async fn gmail_oauth_configured() -> Result<bool, String> {
    Ok(gmail_oauth_is_configured())
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
pub(crate) async fn fresh_gmail_access_token() -> Result<String, String> {
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
