//! Calendar connector Tauri commands: connect (3 providers), status,
//! disconnect. Sync commands are added by the engine task.

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::{Manager, State};

pub const CALENDAR_SYNC_PROGRESS_EVENT: &str = "calendar-sync-progress";

const KEYCHAIN_REFRESH_KEY: &str = "refresh-token";
const KEYCHAIN_ICS_URL_KEY: &str = "ics-url";

pub struct CalendarState {
    pub workspace: tokio::sync::Mutex<Option<PathBuf>>,
    pub is_syncing: Arc<AtomicBool>,
    pub cancel: Arc<AtomicBool>,
    pub oauth_cancel: Arc<AtomicBool>,
    pub last_report: tokio::sync::Mutex<Option<CalendarSyncReportDto>>,
    pub progress_events: Arc<AtomicU32>,
}

pub fn manage_state(app: &tauri::App) {
    app.manage(CalendarState {
        workspace: tokio::sync::Mutex::new(None),
        is_syncing: Arc::new(AtomicBool::new(false)),
        cancel: Arc::new(AtomicBool::new(false)),
        oauth_cancel: Arc::new(AtomicBool::new(false)),
        last_report: tokio::sync::Mutex::new(None),
        progress_events: Arc::new(AtomicU32::new(0)),
    });
}

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct CalendarSyncReportDto {
    pub events_fetched: u32,
    pub events_changed: u32,
    pub events_indexed: u32,
    pub records_indexed: u32,
    pub cancelled: bool,
}

fn provider_service(provider: &str) -> Result<String, String> {
    match provider {
        "outlook" => Ok(crate::identity::calendar_keychain_service("ms")),
        "google" => Ok(crate::identity::calendar_keychain_service("google")),
        "ics" => Ok(crate::identity::calendar_keychain_service("ics")),
        other => Err(format!("unknown calendar provider: {other}")),
    }
}

fn secret_key_for(provider: &str) -> &'static str {
    if provider == "ics" { KEYCHAIN_ICS_URL_KEY } else { KEYCHAIN_REFRESH_KEY }
}

fn ms_client_id() -> String {
    // Same public app registration as the OneDrive connector
    // (onedrive/commands.rs:55-59); calendar is a new delegated scope on it.
    option_env!("KEEPANCE_MS_CLIENT_ID")
        .unwrap_or("845ddba0-70ab-4f90-88ba-e3522157e37a")
        .to_string()
}

#[tauri::command]
pub async fn calendar_set_workspace(
    state: State<'_, CalendarState>,
    path: String,
) -> Result<(), String> {
    let mut ws = state.workspace.lock().await;
    *ws = Some(PathBuf::from(path));
    Ok(())
}

/// Microsoft loopback+PKCE sign-in with Calendars.Read. Mirrors
/// `onedrive_connect` (onedrive/commands.rs:147-203) including the
/// cancel-rollback semantics.
#[tauri::command]
pub async fn calendar_connect_outlook(state: State<'_, CalendarState>) -> Result<(), String> {
    use crate::commands::mail::gmail::oauth::{
        await_redirect_code_or_cancel, bind_loopback_host, gen_pkce, gen_state, open_browser,
        store_or_rollback_on_cancel,
    };
    use super::oauth::{build_ms_auth_url, ms_exchange_code, MS_TOKEN_ENDPOINT};

    state.oauth_cancel.store(false, Ordering::SeqCst);
    let cancel = state.oauth_cancel.clone();

    let (verifier, challenge) = gen_pkce();
    let state_token = gen_state();
    // "localhost" host is required for MS personal accounts (BUG-010,
    // documented at mail/gmail/oauth.rs:270-282).
    let (listener, redirect_uri) = bind_loopback_host("localhost")
        .await
        .map_err(|e| e.to_string())?;
    let url = build_ms_auth_url(&ms_client_id(), &redirect_uri, &challenge, &state_token);
    open_browser(&url);
    let code = await_redirect_code_or_cancel(
        listener,
        &state_token,
        std::time::Duration::from_secs(300),
        cancel.clone(),
    )
    .await
    .map_err(|e| e.to_string())?;
    let tokens = ms_exchange_code(&ms_client_id(), &code, &verifier, &redirect_uri, MS_TOKEN_ENDPOINT)
        .await
        .map_err(|e| e.to_string())?;

    let entry = keyring::Entry::new(&provider_service("outlook")?, KEYCHAIN_REFRESH_KEY)
        .map_err(|e| e.to_string())?;
    let previous = entry.get_password().ok();
    store_or_rollback_on_cancel(
        &cancel,
        || entry.set_password(&tokens.refresh).map_err(|e| e.to_string()),
        || match &previous {
            Some(prev) => { let _ = entry.set_password(prev); }
            None => { let _ = entry.delete_credential(); }
        },
    )
}

#[tauri::command]
pub async fn calendar_connect_outlook_cancel(
    state: State<'_, CalendarState>,
) -> Result<(), String> {
    state.oauth_cancel.store(true, Ordering::SeqCst);
    Ok(())
}

/// Google loopback+PKCE sign-in with calendar.readonly. Mirrors
/// `gmail_connect` (mail/connect.rs) with the calendar auth URL.
#[tauri::command]
pub async fn calendar_connect_google() -> Result<(), String> {
    use crate::commands::mail::gmail::oauth::{
        await_redirect_code, bind_loopback, gen_pkce, gen_state, open_browser, GoogleOAuth,
    };
    use crate::commands::mail::{gmail_client_id, gmail_client_secret};
    use super::oauth::build_google_auth_url;

    let (verifier, challenge) = gen_pkce();
    let state = gen_state();
    let (listener, redirect_uri) = bind_loopback().await.map_err(|e| e.to_string())?;
    let url = build_google_auth_url(&gmail_client_id(), &redirect_uri, &challenge, &state);
    open_browser(&url);
    let code = await_redirect_code(listener, &state, std::time::Duration::from_secs(300))
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
    keyring::Entry::new(&provider_service("google")?, KEYCHAIN_REFRESH_KEY)
        .map_err(|e| e.to_string())?
        .set_password(&refresh)
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// True for a bare-HTTP URL whose host is loopback (dev/test only). ICS
/// feed URLs commonly embed a secret access token as a query parameter, so
/// plaintext HTTP anywhere else would send that secret over the open
/// network — only localhost is exempt from the HTTPS requirement.
fn is_localhost_http(url: &str) -> bool {
    let Some(rest) = url.strip_prefix("http://") else { return false };
    let host = rest.split(['/', ':', '?']).next().unwrap_or("");
    host == "localhost" || host == "127.0.0.1" || host == "::1"
}

/// ICS fallback: validate the URL shape, fetch it once to prove it parses,
/// then store the URL in the keychain (secret ICS URLs embed a token).
#[tauri::command]
pub async fn calendar_connect_ics(url: String) -> Result<(), String> {
    let trimmed = url.trim().to_string();
    if !trimmed.starts_with("https://") && !is_localhost_http(&trimmed) {
        return Err("Enter the calendar's ICS address (starts with https://).".into());
    }
    let body = super::ics_source::fetch_ics_text(&trimmed)
        .await
        .map_err(|e| format!("Could not read that calendar address: {e}"))?;
    if !body.contains("BEGIN:VCALENDAR") {
        return Err("That address did not return a calendar (ICS) feed.".into());
    }
    keyring::Entry::new(&provider_service("ics")?, KEYCHAIN_ICS_URL_KEY)
        .map_err(|e| e.to_string())?
        .set_password(&trimmed)
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Careful is_connected: NoEntry = false, real keychain error = Err
/// (the mail/mod.rs is_connected pattern, not OneDrive's is_ok()).
#[tauri::command]
pub async fn calendar_is_connected(provider: String) -> Result<bool, String> {
    let entry = keyring::Entry::new(&provider_service(&provider)?, secret_key_for(&provider))
        .map_err(|e| e.to_string())?;
    match entry.get_password() {
        Ok(_) => Ok(true),
        Err(keyring::Error::NoEntry) => Ok(false),
        Err(e) => Err(e.to_string()),
    }
}

/// Disconnect ONE provider. When it was the last connected provider, purge
/// the encrypted store, its RAG rows, and the DB master key (the
/// calendly_disconnect ordering: purge RAG chunks -> purge db -> secrets).
#[tauri::command]
pub async fn calendar_disconnect(
    state: State<'_, CalendarState>,
    provider: String,
) -> Result<(), String> {
    let service = provider_service(&provider)?;
    if state
        .is_syncing
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return Err("A calendar sync is running. Stop it first.".into());
    }
    let result = calendar_disconnect_inner(&state, &provider, &service).await;
    state.is_syncing.store(false, Ordering::SeqCst);
    result
}

async fn calendar_disconnect_inner(
    state: &State<'_, CalendarState>,
    provider: &str,
    service: &str,
) -> Result<(), String> {
    use super::store::CalendarStore;
    let workspace = state.workspace.lock().await.clone();
    // 0. A workspace must be known before we can locate (and purge) any
    //    previously synced data. codex-review P2 (round 5), matching the
    //    established calendly precedent (calendly_disconnect_logic returns
    //    early with `data_remains: true` for exactly this case, never
    //    deleting the credential): silently treating "workspace unset" as
    //    "nothing to purge" and still forgetting the credential would leave
    //    a PRIOR session's synced calendar data on disk (the local DB file
    //    persists across process restarts independently of this in-memory
    //    state) while reporting the provider disconnected.
    let Some(ws) = workspace.as_ref() else {
        return Err(
            "No workspace is open, so this connection's data could not be located. \
             Open the workspace and try disconnecting again."
                .to_string(),
        );
    };
    // 1. Purge this provider's RAG rows, then its store rows + cursors. Row
    //    deletion runs even when other providers remain connected —
    //    codex-review P2: without it, a disconnected provider's events
    //    silently persisted in the shared encrypted store and could
    //    resurface via list_in_window / a later indexing pass.
    //
    //    The local store purge (open + delete_provider_rows) MUST succeed
    //    before step 2 forgets the credential — codex-review P2 (round 2):
    //    forgetting the credential while the purge silently failed would
    //    report "disconnected" while private calendar data is still on
    //    disk, with the UI now showing nothing wrong. RAG chunk deletion
    //    stays best-effort (matches the calendly precedent): a flaky
    //    embedding-store delete on one stale chunk shouldn't block the
    //    whole disconnect, and those chunks are already orphaned (their
    //    source rows are gone) rather than silently resurfacing.
    {
        let store = CalendarStore::open(ws).map_err(|e| {
            format!("Could not open the calendar store to remove this connection's data: {e}")
        })?;
        if let Ok(source_ids) = store.list_indexed_rag_source_ids() {
            let prefix = format!("calendar:{provider}:");
            if let Ok(key) = crate::commands::rag::crypto::get_or_create_master_key() {
                for sid in source_ids.iter().filter(|s| s.starts_with(&prefix)) {
                    let _ = crate::commands::connector::delete_external_source_with_key_internal(
                        ws, sid, &key,
                    )
                    .await;
                }
            }
        }
        store.delete_provider_rows(provider).map_err(|e| {
            format!("Could not remove this connection's stored events: {e}")
        })?;
    }
    // 2. Forget the credential (only reached once step 1's required purge
    //    has succeeded). A real keychain error (locked, permission denied,
    //    ...) must abort the disconnect rather than being swallowed —
    //    codex-review P2 (round 5): silently ignoring it would report
    //    "disconnected" while the refresh token is still usable, and could
    //    let step 3 purge the shared local DB/master key even though this
    //    provider's own credential never actually left the OS keychain.
    //    `NoEntry` alone is fine (already gone; e.g. a second disconnect
    //    call after the first partially succeeded).
    let entry = keyring::Entry::new(service, secret_key_for(provider)).map_err(|e| e.to_string())?;
    match entry.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => {}
        Err(e) => return Err(format!("Could not remove the saved sign-in: {e}")),
    }
    // 3. If no provider remains connected, purge the whole store + master key.
    let mut any_left = false;
    for p in ["outlook", "google", "ics"] {
        if p == provider {
            continue;
        }
        if let Ok(e) = keyring::Entry::new(&provider_service(p)?, secret_key_for(p)) {
            if e.get_password().is_ok() {
                any_left = true;
            }
        }
    }
    if !any_left {
        // codex-review P1 (round 4): the file-removal purge must succeed
        // before the DB master key is forgotten. Discarding a `remove_file`
        // failure here (e.g. a Windows sharing violation) previously still
        // deleted the key and reported success, leaving an now-unreadable
        // encrypted DB on disk that breaks a later reconnect.
        CalendarStore::purge(ws)
            .map_err(|e| format!("Could not remove the local calendar database: {e}"))?;
        let _ = CalendarStore::delete_master_key();
    }
    Ok(())
}

/// Fresh MS access token from the stored refresh token (rotation-aware;
/// the onedrive/commands.rs shape).
pub(crate) async fn fresh_ms_access_token() -> Result<String, String> {
    let entry = keyring::Entry::new(
        &crate::identity::calendar_keychain_service("ms"),
        KEYCHAIN_REFRESH_KEY,
    )
    .map_err(|e| e.to_string())?;
    let rt = entry.get_password().map_err(|_| "not connected".to_string())?;
    let auth = super::oauth::OAuth::new(ms_client_id());
    match auth.refresh(&rt).await.map_err(|e| e.to_string())? {
        super::oauth::TokenOutcome::Tokens { access, refresh, .. } => {
            if let Some(new_rt) = refresh {
                if let Err(e) = entry.set_password(&new_rt) {
                    log::warn!("calendar MS refresh-token rotation not saved: {e}");
                }
            }
            Ok(access)
        }
        super::oauth::TokenOutcome::Failed(e) if e == "invalid_grant" || e == "invalid_scope" => {
            Err("scope_upgrade_required".to_string())
        }
        super::oauth::TokenOutcome::Failed(e) => Err(format!("refresh failed: {e}")),
        _ => Err("unexpected refresh outcome".into()),
    }
}

/// Fresh Google access token (the mail gmail refresh shape).
pub(crate) async fn fresh_google_access_token() -> Result<String, String> {
    use crate::commands::mail::{gmail_client_id, gmail_client_secret};
    let entry = keyring::Entry::new(
        &crate::identity::calendar_keychain_service("google"),
        KEYCHAIN_REFRESH_KEY,
    )
    .map_err(|e| e.to_string())?;
    let rt = entry.get_password().map_err(|_| "not connected".to_string())?;
    let oauth = crate::commands::mail::gmail::oauth::GoogleOAuth::new(
        gmail_client_id(),
        gmail_client_secret(),
    );
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

pub(crate) fn ics_url() -> Result<String, String> {
    keyring::Entry::new(
        &crate::identity::calendar_keychain_service("ics"),
        KEYCHAIN_ICS_URL_KEY,
    )
    .map_err(|e| e.to_string())?
    .get_password()
    .map_err(|_| "not connected".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ics_url_scheme_only_accepts_https_or_loopback_http() {
        // (url, expected accepted, why)
        let table = [
            ("https://calendar.example.com/feed.ics?token=secret", true, "https always ok"),
            ("http://calendar.example.com/feed.ics?token=secret", false, "plaintext http leaks the token param"),
            ("http://localhost:8080/feed.ics", true, "loopback dev exception"),
            ("http://127.0.0.1:8080/feed.ics", true, "loopback dev exception (IPv4 literal)"),
            ("ftp://calendar.example.com/feed.ics", false, "non-http(s) scheme rejected"),
            ("not a url", false, "garbage rejected"),
        ];
        for (url, expected, why) in table {
            let accepted = url.starts_with("https://") || is_localhost_http(url);
            assert_eq!(accepted, expected, "{why}");
        }
    }
}
