//! Calendar connector Tauri commands: connect (3 providers), status,
//! disconnect. Sync commands are added by the engine task.

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};

use super::store::CalendarStore;

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
    option_env!("LANTERN_MS_CLIENT_ID")
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
/// `gmail_connect` (mail/connect.rs) with the calendar auth URL, and — like
/// `calendar_connect_outlook` above — the cancel-rollback semantics from
/// `onedrive_connect` (onedrive/commands.rs:147-203), so closing the sign-in
/// tab actually aborts the wait instead of leaving the card stuck until the
/// 300s timeout (wave-1c review finding, P2).
#[tauri::command]
pub async fn calendar_connect_google(state: State<'_, CalendarState>) -> Result<(), String> {
    use crate::commands::mail::gmail::oauth::{
        await_redirect_code_or_cancel, bind_loopback, gen_pkce, gen_state, open_browser,
        store_or_rollback_on_cancel, GoogleOAuth,
    };
    use crate::commands::mail::{gmail_client_id, gmail_client_secret};
    use super::oauth::build_google_auth_url;

    state.oauth_cancel.store(false, Ordering::SeqCst);
    let cancel = state.oauth_cancel.clone();

    let (verifier, challenge) = gen_pkce();
    let state_token = gen_state();
    let (listener, redirect_uri) = bind_loopback().await.map_err(|e| e.to_string())?;
    let url = build_google_auth_url(&gmail_client_id(), &redirect_uri, &challenge, &state_token);
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
    let entry = keyring::Entry::new(&provider_service("google")?, KEYCHAIN_REFRESH_KEY)
        .map_err(|e| e.to_string())?;
    let previous = entry.get_password().ok();
    store_or_rollback_on_cancel(
        &cancel,
        || entry.set_password(&refresh).map_err(|e| e.to_string()),
        || match &previous {
            Some(prev) => {
                let _ = entry.set_password(prev);
            }
            None => {
                let _ = entry.delete_credential();
            }
        },
    )
}

#[tauri::command]
pub async fn calendar_connect_google_cancel(
    state: State<'_, CalendarState>,
) -> Result<(), String> {
    state.oauth_cancel.store(true, Ordering::SeqCst);
    Ok(())
}

/// True for a bare-HTTP URL whose ACTUAL host (per URL syntax, not a naive
/// string split) is loopback (dev/test only). ICS feed URLs commonly embed
/// a secret access token as a query parameter, so plaintext HTTP anywhere
/// else would send that secret over the open network — only localhost is
/// exempt from the HTTPS requirement.
///
/// Wave-1 review finding (P2): a hand-rolled `split(['/', ':', '?'])` reads
/// everything before the first of those chars as "the host", but a URL like
/// `http://localhost:80@evil.example/feed.ics` puts "localhost:80" in the
/// USERINFO component (before '@') — the real host, and where reqwest
/// actually connects, is "evil.example". Parsing with the `url` crate
/// (re-exported as `reqwest::Url`, already used elsewhere in this codebase
/// — see `connector::assert_same_origin`) and reading `host_str()` reflects
/// what the HTTP client will really connect to.
fn is_localhost_http(url: &str) -> bool {
    let Ok(parsed) = reqwest::Url::parse(url) else { return false };
    if parsed.scheme() != "http" {
        return false;
    }
    matches!(parsed.host_str(), Some("localhost") | Some("127.0.0.1") | Some("::1"))
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

/// Takes `&CalendarState` directly (not `&State<'_, CalendarState>`) —
/// matching the crm_disconnect_logic precedent — so tests can construct a
/// plain `CalendarState` over a temp workspace and call this exact code path
/// without standing up a Tauri app. `State<T>` derefs to `&T`, so the call
/// site above needs no change beyond auto-deref.
pub async fn calendar_disconnect_inner(
    state: &CalendarState,
    provider: &str,
    service: &str,
) -> Result<(), String> {
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
    //    disk, with the UI now showing nothing wrong.
    //
    //    RAG chunk deletion is likewise now REQUIRED, not best-effort
    //    (polish-1 item 3, 2026-07-03): a swallowed `let _ = ...` here used
    //    to let a LanceDB outage or a master-key read failure silently
    //    leave this provider's synced content sitting in the vector store
    //    forever with no retry path, while the disconnect still reported
    //    success and deleted the very credential that would let a future
    //    reconnect re-identify and re-purge that content. Every step below
    //    now aborts the WHOLE disconnect on failure, before the credential
    //    or local rows are touched, so a retry re-attempts the identical
    //    purge from an unchanged, consistent state — the same "keep state
    //    consistent, let the user retry" answer the calendly/CRM connector
    //    disconnects use (there via a `data_remains` result flag; here via
    //    Err, since this command's signature is Result<(), String>).
    {
        let store = CalendarStore::open(ws).map_err(|e| {
            format!("Could not open the calendar store to remove this connection's data: {e}")
        })?;
        let source_ids = store.list_indexed_rag_source_ids().map_err(|e| {
            format!(
                "Could not check the search index for this connection's data: {e}. \
                 Nothing was changed; try disconnecting again."
            )
        })?;
        let prefix = format!("calendar:{provider}:");
        let matching: Vec<&String> =
            source_ids.iter().filter(|s| s.starts_with(&prefix)).collect();
        if !matching.is_empty() {
            let key = crate::commands::rag::crypto::get_or_create_master_key().map_err(|e| {
                format!(
                    "Could not access the local search index to remove this connection's \
                     data: {e}. Nothing was changed; try disconnecting again."
                )
            })?;
            for sid in &matching {
                crate::commands::connector::delete_external_source_with_key_internal(
                    ws, sid, &key,
                )
                .await
                .map_err(|e| {
                    format!(
                        "Could not remove this connection's content from the search index: \
                         {e}. Nothing else was changed; try disconnecting again."
                    )
                })?;
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
    // 3. If no provider remains connected, purge the whole store + master
    //    key. codex-review P2 (round 6): a real keychain read error for
    //    ANOTHER provider (locked, permission denied, ...) must NOT be
    //    treated the same as "not connected" — that could wipe the shared
    //    local DB/master key while that other provider is actually still
    //    connected, just temporarily unreadable. Only a confirmed absence
    //    (`NoEntry`) counts against `any_left`; any other error fails safe
    //    by assuming the provider IS still connected.
    let mut any_left = false;
    for p in ["outlook", "google", "ics"] {
        if p == provider {
            continue;
        }
        match keyring::Entry::new(&provider_service(p)?, secret_key_for(p))
            .and_then(|e| e.get_password())
        {
            Ok(_) => any_left = true,
            Err(keyring::Error::NoEntry) => {}
            Err(_) => any_left = true,
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

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CalendarMatterMapEntry {
    pub key: String,
    pub matter_id: String,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CalendarSyncStatusDto {
    pub syncing: bool,
    pub events_indexed: u32,
    pub last_report: Option<CalendarSyncReportDto>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CalendarEventDto {
    pub id: String,
    pub provider: String,
    pub title: String,
    pub start_utc: String,
    pub end_utc: String,
    pub attendees: Vec<CalendarAttendeeDto>,
    pub organizer_email: String,
    /// The event's online-meeting join URL, when one is known. Omitted from
    /// the JSON when absent (`skip_serializing_if`) so the DTO stays lean and
    /// the frontend reads `joinUrl` as optional.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub join_url: Option<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CalendarAttendeeDto {
    pub email: String,
    pub name: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct CalendarProgressPayload {
    status: String,
    events_indexed: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

pub(crate) fn build_matter_map(
    entries: &[CalendarMatterMapEntry],
) -> std::collections::HashMap<String, String> {
    let mut map = std::collections::HashMap::new();
    for entry in entries {
        let key = super::engine::normalize_key(&entry.key);
        if key.is_empty() {
            continue;
        }
        map.entry(key).or_insert_with(|| entry.matter_id.clone());
    }
    map
}

fn emit_progress(app: &AppHandle, status: &str, events_indexed: u32, error: Option<String>) {
    use tauri::Emitter;
    let _ = app.emit(
        CALENDAR_SYNC_PROGRESS_EVENT,
        CalendarProgressPayload { status: status.into(), events_indexed, error },
    );
}

/// Sync every CONNECTED provider over the rolling window (past 7 days,
/// next 14). Single-flight; cancellable; progress via the Tauri event.
#[tauri::command]
pub async fn calendar_sync_all(
    app: AppHandle,
    state: State<'_, CalendarState>,
    matter_map: Vec<CalendarMatterMapEntry>,
) -> Result<CalendarSyncReportDto, String> {
    if state
        .is_syncing
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return Err("A calendar sync is already running.".into());
    }
    state.cancel.store(false, Ordering::SeqCst);
    state.progress_events.store(0, Ordering::SeqCst);

    let result = calendar_sync_all_inner(&app, &state, &matter_map).await;
    state.is_syncing.store(false, Ordering::SeqCst);
    match &result {
        Ok(report) if report.cancelled => {
            emit_progress(&app, "cancelled", report.events_indexed, None)
        }
        Ok(report) => emit_progress(&app, "done", report.events_indexed, None),
        Err(e) => emit_progress(&app, "error", 0, Some(e.clone())),
    }
    result
}

async fn calendar_sync_all_inner(
    app: &AppHandle,
    state: &State<'_, CalendarState>,
    matter_map: &[CalendarMatterMapEntry],
) -> Result<CalendarSyncReportDto, String> {
    use super::engine::sync_source;
    use super::graph_source::{CalendarSource, GraphCalendarSource};
    use super::google_source::GoogleCalendarSource;
    use super::ics_source::IcsCalendarSource;

    let workspace = state
        .workspace
        .lock()
        .await
        .clone()
        .ok_or("No workspace set. Open a workspace first.")?;
    let map = build_matter_map(matter_map);
    let store = CalendarStore::open(&workspace).map_err(|e| e.to_string())?;
    let rag_key = crate::commands::rag::crypto::get_or_create_master_key()
        .map_err(|e| e.to_string())?;
    let (from_utc, to_utc) = super::model::sync_window_utc(chrono::Utc::now());

    // codex-review P2 (wave-1b review round 2): a real keychain error
    // (locked, permission denied, ...) must not be treated the same as
    // "not connected" — unwrap_or(false) silently skipped that provider,
    // which in a multi-provider sync could report success while leaving
    // one calendar stale, or (single-provider) surface a confusing "No
    // calendar is connected" instead of the actual keychain problem.
    let mut sources: Vec<Box<dyn CalendarSource>> = Vec::new();
    if calendar_is_connected("outlook".into()).await? {
        sources.push(Box::new(GraphCalendarSource::new()));
    }
    if calendar_is_connected("google".into()).await? {
        sources.push(Box::new(GoogleCalendarSource::new()));
    }
    if calendar_is_connected("ics".into()).await? {
        sources.push(Box::new(IcsCalendarSource::new()));
    }
    if sources.is_empty() {
        return Err("No calendar is connected.".into());
    }

    let mut report = CalendarSyncReportDto::default();
    let progress_counter = state.progress_events.clone();
    let app_for_progress = app.clone();
    for source in &sources {
        if state.cancel.load(Ordering::SeqCst) {
            report.cancelled = true;
            break;
        }
        emit_progress(&app_for_progress, "syncing", progress_counter.load(Ordering::SeqCst), None);
        let base = report.events_indexed;
        let this_provider_counter = progress_counter.clone();
        let counts = sync_source(
            &store,
            source.as_ref(),
            &map,
            &workspace,
            &rag_key,
            &from_utc,
            &to_utc,
            &state.cancel,
            &move |n| {
                this_provider_counter.store(base + n, Ordering::SeqCst);
            },
        )
        .await
        .map_err(|e| e.to_string())?;
        report.events_fetched += counts.fetched;
        report.events_changed += counts.changed;
        report.events_indexed += counts.indexed;
        report.records_indexed += counts.records;
    }
    report.cancelled = report.cancelled || state.cancel.load(Ordering::SeqCst);
    *state.last_report.lock().await = Some(report.clone());
    Ok(report)
}

#[tauri::command]
pub async fn calendar_sync_status(
    state: State<'_, CalendarState>,
) -> Result<CalendarSyncStatusDto, String> {
    Ok(CalendarSyncStatusDto {
        syncing: state.is_syncing.load(Ordering::SeqCst),
        events_indexed: state.progress_events.load(Ordering::SeqCst),
        last_report: state.last_report.lock().await.clone(),
    })
}

#[tauri::command]
pub async fn calendar_cancel_sync(state: State<'_, CalendarState>) -> Result<(), String> {
    state.cancel.store(true, Ordering::SeqCst);
    Ok(())
}

/// Events overlapping [from_utc, to_utc) from the local encrypted store —
/// powers the Today's meetings strip. Matter matching happens in TS at
/// render time so newly taught mappings apply instantly without a re-sync.
#[tauri::command]
pub async fn calendar_list_events(
    state: State<'_, CalendarState>,
    from_utc: String,
    to_utc: String,
) -> Result<Vec<CalendarEventDto>, String> {
    let workspace = state
        .workspace
        .lock()
        .await
        .clone()
        .ok_or("No workspace set.")?;
    let db = CalendarStore::db_path(&workspace);
    if !db.exists() {
        return Ok(vec![]); // connected-but-never-synced or not connected
    }
    let store = CalendarStore::open(&workspace).map_err(|e| e.to_string())?;
    let events = store
        .list_in_window(&from_utc, &to_utc)
        .map_err(|e| e.to_string())?;
    Ok(events
        .into_iter()
        .map(|e| CalendarEventDto {
            id: e.id,
            provider: e.provider.as_str().to_string(),
            title: e.title,
            start_utc: e.start_utc,
            end_utc: e.end_utc,
            attendees: e
                .attendees
                .into_iter()
                .map(|a| CalendarAttendeeDto { email: a.email, name: a.name })
                .collect(),
            organizer_email: e.organizer_email,
            join_url: e.join_url,
        })
        .collect())
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

    #[test]
    fn is_localhost_http_rejects_userinfo_host_spoofing() {
        // Wave-1 review finding (P2): the naive split(['/', ':', '?']) hits
        // the ':' in "localhost:80" first and never sees the '@', so it
        // reads "localhost" as the host — but per URL syntax, everything
        // before '@' is userinfo and "evil.example" is the REAL host that
        // reqwest actually connects to, over plain HTTP, leaking the
        // secret token in the ICS URL's query string.
        assert!(
            !is_localhost_http("http://localhost:80@evil.example/feed.ics?token=secret"),
            "userinfo-prefixed host must not be treated as loopback"
        );
        assert!(
            !is_localhost_http("http://localhost@evil.example/feed.ics"),
            "bare userinfo spoof must not be treated as loopback"
        );
        assert!(
            !is_localhost_http("http://127.0.0.1@evil.example/feed.ics"),
            "IPv4-literal userinfo spoof must not be treated as loopback"
        );
        // Genuine loopback URLs (with or without a port) still pass.
        assert!(is_localhost_http("http://localhost/feed.ics"));
        assert!(is_localhost_http("http://localhost:8080/feed.ics"));
        assert!(is_localhost_http("http://127.0.0.1:8080/feed.ics"));
    }

    #[test]
    fn build_matter_map_normalizes_skips_blanks_first_writer_wins() {
        let entries = vec![
            CalendarMatterMapEntry { key: "  Kim@Henderson.COM ".into(), matter_id: "m-1".into() },
            CalendarMatterMapEntry { key: "R  Ortiz".into(), matter_id: "m-2".into() },
            CalendarMatterMapEntry { key: "".into(), matter_id: "m-3".into() },
            CalendarMatterMapEntry { key: "kim@henderson.com".into(), matter_id: "m-9".into() },
        ];
        let map = build_matter_map(&entries);
        assert_eq!(map.get("kim@henderson.com"), Some(&"m-1".to_string()), "first wins");
        assert_eq!(map.get("r ortiz"), Some(&"m-2".to_string()), "whitespace collapsed");
        assert_eq!(map.len(), 2, "blank keys skipped");
    }
}
