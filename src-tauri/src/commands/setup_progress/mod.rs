// Setup / import progress aggregator.
//
// One unified, queryable answer to "how far along is first-run setup?" for the
// onboarding progress screen AND a future in-app setup/import-status view.
//
// This module does NOT invent new tracking. It AGGREGATES the real per-source
// signals that already exist elsewhere in the backend + frontend:
//
//   1. AI / models   — cloud provider key in the OS keychain (= ready), the
//                       local LLM GGUF download (status + live % from the
//                       `.part` file vs `MODEL_SIZE_BYTES`), and the e5 search
//                       model download (`rag::model_download::model_status`).
//   2. Email          — `mail_connected_accounts()` + `MailState.is_syncing`,
//                       plus a live "messages imported" count fed by the
//                       existing `mail-sync-progress` event.
//   3. Wealthbox CRM  — `crm_is_connected()` + `CrmState` (live households,
//                       final records, syncing flag).
//   4. File indexing  — `RagState.indexing`, plus live processed/total fed by
//                       the existing `rag-indexing-progress` event.
//   5. Client Map     — the only source whose truth lives entirely in the
//                       frontend stores; the renderer pushes its counts down
//                       via `setup_report_client_map`.
//
// Design: `get_setup_progress` reads every source on demand (authoritative for
// the static "ready/connected" facts). A small in-memory cache holds the
// event-only live numbers (mail/file-index/client-map). Lightweight listeners
// on the five existing per-source events update that cache and emit a single
// `setup-progress-changed` "come refetch" notification, which the frontend hook
// debounces. This keeps the aggregator decoupled from the five source modules
// (zero edits to them) while reflecting their real signals.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::atomic::Ordering;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Listener, Manager, State};

use crate::commands::crm::commands::CrmState;
use crate::commands::mail::{MailState, store::{EncryptedMailStore, MailStore}};
use crate::commands::rag::RagState;

/// Event emitted whenever any source updates, telling the frontend to refetch a
/// fresh `SetupProgress` snapshot. Mirrored in `setup-progress-commands.ts`.
pub const CHANGED_EVENT: &str = "setup-progress-changed";

// ---------------------------------------------------------------------------
// Wire types — all camelCase to match the TypeScript `SetupProgress` contract.
// ---------------------------------------------------------------------------

/// Download/readiness state of a single model (chat or search).
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ModelState {
    /// Not present and not downloading.
    None,
    /// Currently downloading.
    Downloading,
    /// A download was attempted and failed; retry should resume/restart it.
    Failed,
    /// Present and usable.
    Ready,
}

/// A single model's state + optional download percent (0..=100).
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ModelSlot {
    pub state: ModelState,
    /// Whole-number percent 0..=100 when known; `None` when indeterminate.
    pub percent: Option<f64>,
}

/// Which "brain" the user is set up to use.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum AiMode {
    /// A cloud provider key is present (BYOK).
    Cloud,
    /// No cloud key, but the local model is present or downloading.
    Local,
    /// Neither configured.
    None,
}

/// AI / model readiness. The headline `state`/`percent` describe the CHAT brain
/// (cloud key or local LLM); `local_llm` and `search_model` expose the two
/// downloadable models individually.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AiProgress {
    pub mode: AiMode,
    pub state: ModelState,
    pub percent: Option<f64>,
    pub cloud_key_present: bool,
    pub local_llm: ModelSlot,
    pub search_model: ModelSlot,
}

/// A connected email account (provider + human label).
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct EmailAccount {
    pub provider: String,
    pub label: String,
}

/// Email import / sync progress.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EmailProgress {
    /// True only when this workspace has both usable credentials and imported
    /// email data. A saved machine-wide sign-in alone is not a connection to
    /// this workspace.
    pub connected: bool,
    /// A saved sign-in is available on this computer, but may not yet have
    /// been used to import anything into the active workspace.
    pub credentials_available: bool,
    pub accounts: Vec<EmailAccount>,
    pub syncing: bool,
    /// Cumulative messages imported this session (sum across providers from the
    /// `mail-sync-progress` event). `None` until the first sync event arrives.
    pub messages_imported: Option<u32>,
}

/// Wealthbox CRM sync progress.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CrmProgress {
    /// True only when this workspace has both a usable CRM credential and
    /// imported CRM data. A machine-wide token alone is not enough.
    pub connected: bool,
    /// A CRM credential is available on this computer, but may not yet have
    /// been used in the active workspace.
    pub credentials_available: bool,
    pub syncing: bool,
    pub households_processed: u32,
    pub records_indexed: u32,
}

/// Workspace file-indexing (RAG backfill) progress.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FileIndexProgress {
    pub indexing: bool,
    /// Files processed so far this run. `None` outside an active run.
    pub processed: Option<u32>,
    pub total: Option<u32>,
    pub percent: Option<f64>,
}

/// Client Map build progress (truth lives in the frontend; reported down).
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct ClientMapProgress {
    pub total: u32,
    pub built: u32,
    pub building: u32,
    pub pending: u32,
}

/// Coarse headline for the whole setup.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum OverallState {
    /// Nothing configured at all and nothing in flight.
    Empty,
    /// At least one source is actively working (download/sync/index/build).
    InProgress,
    /// Some setup has been done (a source connected, clients added, or a model
    /// present) but the AI brain isn't ready yet and nothing is mid-flight.
    Partial,
    /// An AI brain is ready and nothing is mid-flight.
    Ready,
}

/// The unified snapshot returned by `get_setup_progress` and carried (implicitly
/// via refetch) by the `setup-progress-changed` event.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SetupProgress {
    pub ai: AiProgress,
    pub email: EmailProgress,
    pub crm: CrmProgress,
    pub file_index: FileIndexProgress,
    pub client_map: ClientMapProgress,
    pub overall: OverallState,
}

/// Raw, already-read inputs for the pure assembler. Keeping the I/O out of
/// `assemble` makes the aggregation logic fully unit-testable.
#[derive(Clone, Debug)]
pub(crate) struct RawInputs {
    pub cloud_key_present: bool,
    pub local_status: String,
    pub local_part_bytes: Option<u64>,
    pub local_total_bytes: u64,
    pub search_status: String,
    pub email_credentials_available: bool,
    pub email_workspace_connected: bool,
    pub email_accounts: Vec<EmailAccount>,
    pub email_syncing: bool,
    pub email_messages_imported: Option<u32>,
    pub crm_credentials_available: bool,
    pub crm_workspace_connected: bool,
    pub crm_syncing: bool,
    pub crm_households: u32,
    pub crm_records: u32,
    pub file_indexing: bool,
    pub file_processed: Option<u32>,
    pub file_total: Option<u32>,
    pub client_map: ClientMapProgress,
}

// ---------------------------------------------------------------------------
// Pure aggregation logic (no I/O) — fully unit-tested.
// ---------------------------------------------------------------------------

/// Whole-number percent 0..=100. `None` when `total == 0`.
pub(crate) fn compute_percent(done: u64, total: u64) -> Option<f64> {
    if total == 0 {
        return None;
    }
    let pct = (done as f64 / total as f64) * 100.0;
    Some(pct.clamp(0.0, 100.0).round())
}

/// Map a model-status string (`"ready"|"absent"|"downloading"|"error"`) plus
/// optional live download bytes into a `ModelSlot`. `"error"` -> `Failed`;
/// unknown/`"absent"` -> `None`.
pub(crate) fn model_slot_from_status(
    status: &str,
    downloaded: Option<u64>,
    total: u64,
) -> ModelSlot {
    match status {
        "ready" => ModelSlot { state: ModelState::Ready, percent: Some(100.0) },
        "downloading" => ModelSlot {
            state: ModelState::Downloading,
            percent: downloaded.and_then(|d| compute_percent(d, total)),
        },
        "error" => ModelSlot { state: ModelState::Failed, percent: None },
        _ => ModelSlot { state: ModelState::None, percent: None },
    }
}

/// Compose the AI headline from cloud-key presence and the two model slots.
/// A cloud key makes the chat brain ready immediately; otherwise the local LLM
/// drives the headline.
pub(crate) fn ai_progress(
    cloud_key_present: bool,
    local: ModelSlot,
    search: ModelSlot,
) -> AiProgress {
    let mode = if cloud_key_present {
        AiMode::Cloud
    } else if local.state != ModelState::None {
        AiMode::Local
    } else {
        AiMode::None
    };

    let (state, percent) = if cloud_key_present || local.state == ModelState::Ready {
        (ModelState::Ready, None)
    } else if local.state == ModelState::Downloading {
        (ModelState::Downloading, local.percent)
    } else if local.state == ModelState::Failed {
        (ModelState::Failed, None)
    } else {
        (ModelState::None, None)
    };

    AiProgress {
        mode,
        state,
        percent,
        cloud_key_present,
        local_llm: local,
        search_model: search,
    }
}

/// Clamp Client Map counts so `built + building + pending == total` and no
/// bucket exceeds what's actually available.
pub(crate) fn client_map_progress(total: u32, built: u32, building: u32) -> ClientMapProgress {
    let built = built.min(total);
    let building = building.min(total - built);
    let pending = total - built - building;
    ClientMapProgress { total, built, building, pending }
}

/// Build `FileIndexProgress`, deriving percent from processed/total when both
/// are known.
pub(crate) fn file_index_progress(
    indexing: bool,
    processed: Option<u32>,
    total: Option<u32>,
) -> FileIndexProgress {
    let percent = match (processed, total) {
        (Some(p), Some(t)) => compute_percent(p as u64, t as u64),
        _ => None,
    };
    FileIndexProgress { indexing, processed, total, percent }
}

/// Compute the coarse overall headline. Precedence: anything actively working is
/// "in progress"; else a ready AI brain (idle) is "ready"; else any configured
/// source (idle) is "partial"; else "empty".
pub(crate) fn compute_overall(s: &SetupProgress) -> OverallState {
    let in_progress = s.ai.state == ModelState::Downloading
        // A cloud key makes `ai.state` "ready", so a still-downloading local
        // model must be checked explicitly or it would be hidden behind "ready".
        || s.ai.local_llm.state == ModelState::Downloading
        || s.ai.search_model.state == ModelState::Downloading
        || s.email.syncing
        || s.crm.syncing
        || s.file_index.indexing
        || s.client_map.building > 0;

    // Any persistent sign the user has started setup, short of a ready AI brain.
    // (A ready/downloading chat brain is already caught by the branches above.)
    let any_configured = s.ai.cloud_key_present
        || s.ai.local_llm.state != ModelState::None
        || s.ai.search_model.state != ModelState::None
        || s.email.connected
        || s.crm.connected
        || s.client_map.total > 0
        // A finished indexing run leaves processed/total > 0 (the run flag is off
        // but files were indexed) — that is real setup.
        || s.file_index.processed.unwrap_or(0) > 0
        || s.file_index.total.unwrap_or(0) > 0;

    if in_progress {
        OverallState::InProgress
    } else if s.ai.state == ModelState::Ready {
        OverallState::Ready
    } else if any_configured {
        OverallState::Partial
    } else {
        OverallState::Empty
    }
}

/// Assemble the full snapshot from already-read raw inputs (pure).
pub(crate) fn assemble(raw: RawInputs) -> SetupProgress {
    let local = model_slot_from_status(&raw.local_status, raw.local_part_bytes, raw.local_total_bytes);
    // The e5 search model exposes status only (no pollable byte count), so it
    // never carries a download percent.
    let search = model_slot_from_status(&raw.search_status, None, 0);
    let ai = ai_progress(raw.cloud_key_present, local, search);

    // Credentials are stored in the OS keychain and deliberately shared by
    // workspaces. Import data is stored inside a workspace. The setup screen
    // must require BOTH before it calls a connector done; otherwise a brand-new
    // workspace can inherit a false "Done" from an older workspace.
    let email_connected = raw.email_credentials_available && raw.email_workspace_connected;
    let email = EmailProgress {
        connected: email_connected,
        credentials_available: raw.email_credentials_available,
        accounts: if email_connected { raw.email_accounts } else { vec![] },
        syncing: raw.email_syncing,
        messages_imported: raw.email_messages_imported,
    };

    let crm = CrmProgress {
        connected: raw.crm_credentials_available && raw.crm_workspace_connected,
        credentials_available: raw.crm_credentials_available,
        syncing: raw.crm_syncing,
        households_processed: raw.crm_households,
        records_indexed: raw.crm_records,
    };

    let file_index = file_index_progress(raw.file_indexing, raw.file_processed, raw.file_total);

    let mut snapshot = SetupProgress {
        ai,
        email,
        crm,
        file_index,
        client_map: raw.client_map,
        overall: OverallState::Empty,
    };
    snapshot.overall = compute_overall(&snapshot);
    snapshot
}

// ---------------------------------------------------------------------------
// Event payload parsers (pure) — fully unit-tested.
// ---------------------------------------------------------------------------

/// Latest mail-sync numbers for one provider.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub(crate) struct MailLive {
    pub status: String,
    pub written: u32,
    pub removed: u32,
}

/// Latest file-indexing numbers.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub(crate) struct FileIndexLive {
    pub status: String,
    pub processed: u32,
    pub total: u32,
}

/// Wire shape of `SyncProgress` (mail/mod.rs), permissive for forward-compat.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct MailEventPayload {
    #[serde(default)]
    status: String,
    #[serde(default)]
    provider: String,
    #[serde(default)]
    written: u32,
    #[serde(default)]
    removed: u32,
}

/// Wire shape of `IndexingProgress` (rag/mod.rs), permissive for forward-compat.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RagIndexPayload {
    #[serde(default)]
    status: String,
    #[serde(default)]
    processed: u32,
    #[serde(default)]
    total: u32,
}

/// Parse a `mail-sync-progress` payload into `(provider, MailLive)`.
/// Returns `None` for malformed payloads or a missing provider.
pub(crate) fn parse_mail_event(payload: &str) -> Option<(String, MailLive)> {
    let p: MailEventPayload = serde_json::from_str(payload).ok()?;
    if p.provider.is_empty() {
        return None;
    }
    Some((
        p.provider,
        MailLive { status: p.status, written: p.written, removed: p.removed },
    ))
}

/// Parse a `rag-indexing-progress` payload into `FileIndexLive`.
pub(crate) fn parse_rag_index_event(payload: &str) -> Option<FileIndexLive> {
    let p: RagIndexPayload = serde_json::from_str(payload).ok()?;
    Some(FileIndexLive { status: p.status, processed: p.processed, total: p.total })
}

// ---------------------------------------------------------------------------
// Live cache (event-only numbers) + managed state.
// ---------------------------------------------------------------------------

/// In-memory cache of the live, event-only numbers: mail import counts,
/// file-indexing counts, and the frontend-reported Client Map counts. The static
/// "ready/connected" facts are always read fresh in `get_setup_progress`, so
/// this cache holds only what would otherwise be transient.
#[derive(Default)]
struct LiveCache {
    /// Per-provider latest mail-sync numbers (keyed by provider id).
    mail: HashMap<String, MailLive>,
    /// Latest workspace file-indexing numbers.
    file_index: Option<FileIndexLive>,
    /// Latest Client Map counts pushed down from the renderer.
    client_map: Option<ClientMapProgress>,
}

/// Tauri-managed state for the setup-progress aggregator.
pub struct SetupProgressState {
    cache: Mutex<LiveCache>,
}

// OS keychain coordinates for cloud provider keys. The service mirrors
// `DEFAULT_SERVICE` in commands/keychain.rs; the `bos_key_<provider>` keys are
// written by the renderer's KeychainService (prefix `bos_key_`).
const KEYCHAIN_SERVICE: &str = crate::identity::DEFAULT_KEYCHAIN_SERVICE;
const CLOUD_KEY_NAMES: [&str; 3] = ["bos_key_anthropic", "bos_key_openai", "bos_key_google"];

/// True if any cloud provider key is present (OS keychain, with an env-var
/// fallback for parity with the renderer's dev `EnvBackend`).
fn cloud_key_present() -> bool {
    for key in CLOUD_KEY_NAMES {
        if let Ok(entry) = keyring::Entry::new(KEYCHAIN_SERVICE, key) {
            if entry.get_password().is_ok() {
                return true;
            }
        }
    }
    std::env::var("ANTHROPIC_API_KEY").is_ok()
        || std::env::var("OPENAI_API_KEY").is_ok()
        || std::env::var("GOOGLE_AI_API_KEY").is_ok()
}

/// Canonical partial-download path for the local LLM GGUF. Stat'ing this file
/// yields a live byte count for the download percent without touching the
/// download code. Mirrors `part_file_path` in local_llm/model_download.rs
/// (`<filename>.part`).
fn local_llm_part_path() -> std::path::PathBuf {
    crate::commands::local_llm::model_download::writable_model_dir().join(format!(
        "{}.part",
        crate::commands::local_llm::model_download::MODEL_FILENAME
    ))
}

/// True only when this workspace already contains imported email. The mail
/// credential itself intentionally lives in the OS keychain and is shared by
/// every workspace, so it cannot answer the onboarding question on its own.
///
/// Never open a missing database here: a progress read must not create an
/// empty connector store in a brand-new workspace.
fn workspace_has_imported_mail(workspace: Option<&std::path::Path>) -> bool {
    let Some(workspace) = workspace else {
        return false;
    };
    if !EncryptedMailStore::db_path(workspace).is_file() {
        return false;
    }
    EncryptedMailStore::open(workspace)
        .and_then(|store| store.count())
        .map(|count| count > 0)
        .unwrap_or(false)
}

/// True only when this workspace already contains imported CRM objects. As
/// with email, the CRM token is machine-wide while the imported records belong
/// to one workspace, so the latter is what establishes this connection here.
fn workspace_has_imported_crm(workspace: Option<&std::path::Path>) -> bool {
    let Some(workspace) = workspace else {
        return false;
    };
    if !crate::commands::crm::store::CrmStore::db_path(workspace).is_file() {
        return false;
    }
    crate::commands::crm::store::CrmStore::open(workspace)
        .and_then(|store| store.has_any_objects_including_deleted())
        .unwrap_or(false)
}

/// One unified, on-demand snapshot of first-run setup progress across all five
/// sources. Static "ready/connected" facts are read fresh here; the event-only
/// live numbers come from the cache fed by `register_listeners`.
#[tauri::command]
pub async fn get_setup_progress(
    mail_state: State<'_, MailState>,
    crm_state: State<'_, CrmState>,
    rag_state: State<'_, RagState>,
    setup_state: State<'_, SetupProgressState>,
) -> Result<SetupProgress, String> {
    // ---- AI / models (read fresh) ----
    let cloud_key_present = cloud_key_present();
    let local_status = crate::commands::local_llm::model_download::local_llm_model_status_value()
        .await
        .unwrap_or_else(|_| "absent".to_string());
    let local_part_bytes = std::fs::metadata(local_llm_part_path()).ok().map(|m| m.len());
    let local_total_bytes = crate::commands::local_llm::model_download::MODEL_SIZE_BYTES;
    let search_status = crate::commands::rag::model_download::model_status()
        .await
        .unwrap_or_else(|_| "absent".to_string());

    // ---- Email (connected + syncing fresh; counts from cache) ----
    let email_accounts: Vec<EmailAccount> = crate::commands::mail::mail_connected_accounts()
        .await
        .unwrap_or_default()
        .into_iter()
        .map(|a| EmailAccount { provider: a.provider, label: a.label })
        .collect();
    let email_credentials_available = !email_accounts.is_empty();
    let mail_workspace = mail_state.workspace.lock().await.clone();
    let email_workspace_connected = workspace_has_imported_mail(mail_workspace.as_deref());
    let email_syncing = mail_state.is_syncing.load(Ordering::SeqCst);

    // ---- Wealthbox CRM (credential availability + workspace data are distinct) ----
    let crm_credentials_available = crate::commands::crm::commands::crm_is_connected(None)
        .await
        .unwrap_or(false);
    let crm_workspace = crm_state.workspace.lock().await.clone();
    let crm_workspace_connected = workspace_has_imported_crm(crm_workspace.as_deref());
    let crm_syncing = crm_state.is_syncing.load(Ordering::SeqCst);
    let last_report = crm_state.last_report.lock().await;
    let crm_records = if crm_workspace_connected && !crm_syncing {
        last_report.as_ref().map(|r| r.records_indexed).unwrap_or(0)
    } else {
        0
    };
    // While syncing, the atomic carries the live household count; idle, the final
    // report total is authoritative (falling back to the atomic if no report).
    let crm_households = if crm_syncing {
        crm_state.progress_households.load(Ordering::SeqCst)
    } else {
        last_report
            .as_ref()
            .map(|r| r.households_processed)
            .unwrap_or_else(|| crm_state.progress_households.load(Ordering::SeqCst))
    };
    drop(last_report);

    // ---- File indexing (running flag fresh; counts from cache) ----
    let file_indexing = rag_state.indexing.load(Ordering::SeqCst);

    // ---- Live, event-only numbers from the cache ----
    let (email_messages_imported, file_processed, file_total, client_map) = {
        let cache = setup_state.cache.lock().map_err(|e| e.to_string())?;
        let email_messages_imported = if cache.mail.is_empty() {
            None
        } else {
            Some(cache.mail.values().map(|m| m.written).sum())
        };
        let (file_processed, file_total) = match &cache.file_index {
            Some(fi) => (Some(fi.processed), Some(fi.total)),
            None => (None, None),
        };
        let client_map = cache.client_map.clone().unwrap_or_default();
        (email_messages_imported, file_processed, file_total, client_map)
    };

    Ok(assemble(RawInputs {
        cloud_key_present,
        local_status,
        local_part_bytes,
        local_total_bytes,
        search_status,
        email_credentials_available,
        email_workspace_connected,
        email_accounts,
        email_syncing,
        email_messages_imported,
        crm_credentials_available,
        crm_workspace_connected,
        crm_syncing,
        crm_households,
        crm_records,
        file_indexing,
        file_processed,
        file_total,
        client_map,
    }))
}

/// The renderer reports Client Map build counts — the only source whose truth
/// lives entirely in the frontend stores. Updates the cache and notifies
/// listeners so a `get_setup_progress` snapshot reflects all five sources.
#[tauri::command]
pub fn setup_report_client_map(
    app: AppHandle,
    state: State<'_, SetupProgressState>,
    total: u32,
    built: u32,
    building: u32,
) -> Result<(), String> {
    let cm = client_map_progress(total, built, building);
    {
        let mut cache = state.cache.lock().map_err(|e| e.to_string())?;
        cache.client_map = Some(cm);
    }
    let _ = app.emit(CHANGED_EVENT, ());
    Ok(())
}

/// Register the managed state and the listeners that bridge the five existing
/// per-source events into one `setup-progress-changed` notification. Call once
/// from the Tauri `setup` hook.
pub fn manage_state(app: &tauri::App) {
    app.manage(SetupProgressState { cache: Mutex::new(LiveCache::default()) });
    register_listeners(app.handle());
}

/// Listen to the five existing per-source events. The mail/file-index events
/// also carry live counts we cache; all five emit a lightweight
/// `setup-progress-changed` so the frontend hook refetches a fresh snapshot.
fn register_listeners(app: &AppHandle) {
    // mail-sync-progress -> update the per-provider mail cache, then notify.
    let a = app.clone();
    app.listen_any("mail-sync-progress", move |event| {
        if let Some((provider, live)) = parse_mail_event(event.payload()) {
            if let Some(state) = a.try_state::<SetupProgressState>() {
                if let Ok(mut cache) = state.cache.lock() {
                    cache.mail.insert(provider, live);
                }
            }
            let _ = a.emit(CHANGED_EVENT, ());
        }
    });

    // rag-indexing-progress -> update the file-index cache, then notify.
    let a = app.clone();
    app.listen_any("rag-indexing-progress", move |event| {
        if let Some(live) = parse_rag_index_event(event.payload()) {
            if let Some(state) = a.try_state::<SetupProgressState>() {
                if let Ok(mut cache) = state.cache.lock() {
                    cache.file_index = Some(live);
                }
            }
            let _ = a.emit(CHANGED_EVENT, ());
        }
    });

    // The remaining three sources are read fresh in `get_setup_progress`, so
    // their events only need to nudge the frontend to refetch.
    for source_event in [
        "local-llm-model-download-progress",
        "model-download-progress",
        "crm-sync-progress",
    ] {
        let a = app.clone();
        app.listen_any(source_event, move |_event| {
            let _ = a.emit(CHANGED_EVENT, ());
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // --- compute_percent ---

    #[test]
    fn percent_is_none_when_total_is_zero() {
        assert_eq!(compute_percent(0, 0), None);
        assert_eq!(compute_percent(50, 0), None);
    }

    #[test]
    fn percent_is_rounded_whole_number() {
        assert_eq!(compute_percent(50, 100), Some(50.0));
        assert_eq!(compute_percent(1, 3), Some(33.0)); // 33.33 -> 33
        assert_eq!(compute_percent(2, 3), Some(67.0)); // 66.66 -> 67
    }

    #[test]
    fn percent_clamps_to_100() {
        assert_eq!(compute_percent(200, 100), Some(100.0));
    }

    // --- model_slot_from_status ---

    #[test]
    fn ready_status_is_full() {
        assert_eq!(
            model_slot_from_status("ready", None, 0),
            ModelSlot { state: ModelState::Ready, percent: Some(100.0) }
        );
    }

    #[test]
    fn absent_and_unknown_status_is_none() {
        assert_eq!(
            model_slot_from_status("absent", None, 0),
            ModelSlot { state: ModelState::None, percent: None }
        );
        assert_eq!(
            model_slot_from_status("something-else", Some(5), 10),
            ModelSlot { state: ModelState::None, percent: None }
        );
    }

    #[test]
    fn downloading_status_uses_live_bytes_for_percent() {
        assert_eq!(
            model_slot_from_status("downloading", Some(25), 100),
            ModelSlot { state: ModelState::Downloading, percent: Some(25.0) }
        );
    }

    #[test]
    fn downloading_without_bytes_has_no_percent() {
        assert_eq!(
            model_slot_from_status("downloading", None, 100),
            ModelSlot { state: ModelState::Downloading, percent: None }
        );
    }

    // --- ai_progress ---

    fn slot(state: ModelState, percent: Option<f64>) -> ModelSlot {
        ModelSlot { state, percent }
    }

    #[test]
    fn cloud_key_means_ready_cloud_mode() {
        let ai = ai_progress(true, slot(ModelState::None, None), slot(ModelState::None, None));
        assert_eq!(ai.mode, AiMode::Cloud);
        assert_eq!(ai.state, ModelState::Ready);
        assert_eq!(ai.percent, None);
        assert!(ai.cloud_key_present);
    }

    #[test]
    fn local_ready_means_ready_local_mode() {
        let ai = ai_progress(false, slot(ModelState::Ready, Some(100.0)), slot(ModelState::None, None));
        assert_eq!(ai.mode, AiMode::Local);
        assert_eq!(ai.state, ModelState::Ready);
    }

    #[test]
    fn local_downloading_surfaces_percent() {
        let ai = ai_progress(false, slot(ModelState::Downloading, Some(40.0)), slot(ModelState::None, None));
        assert_eq!(ai.mode, AiMode::Local);
        assert_eq!(ai.state, ModelState::Downloading);
        assert_eq!(ai.percent, Some(40.0));
    }

    #[test]
    fn nothing_configured_is_none() {
        let ai = ai_progress(false, slot(ModelState::None, None), slot(ModelState::None, None));
        assert_eq!(ai.mode, AiMode::None);
        assert_eq!(ai.state, ModelState::None);
    }

    #[test]
    fn cloud_key_with_local_downloading_still_ready_cloud() {
        let ai = ai_progress(true, slot(ModelState::Downloading, Some(10.0)), slot(ModelState::None, None));
        assert_eq!(ai.mode, AiMode::Cloud);
        assert_eq!(ai.state, ModelState::Ready);
    }

    // --- client_map_progress ---

    #[test]
    fn client_map_computes_pending() {
        assert_eq!(
            client_map_progress(10, 3, 2),
            ClientMapProgress { total: 10, built: 3, building: 2, pending: 5 }
        );
    }

    #[test]
    fn client_map_all_built_has_no_pending() {
        assert_eq!(
            client_map_progress(5, 5, 0),
            ClientMapProgress { total: 5, built: 5, building: 0, pending: 0 }
        );
    }

    #[test]
    fn client_map_empty() {
        assert_eq!(client_map_progress(0, 0, 0), ClientMapProgress::default());
    }

    #[test]
    fn client_map_clamps_overcounts() {
        // built exceeds total -> built clamped to total, nothing left pending.
        assert_eq!(
            client_map_progress(3, 9, 0),
            ClientMapProgress { total: 3, built: 3, building: 0, pending: 0 }
        );
        // building exceeds remaining -> clamped.
        assert_eq!(
            client_map_progress(10, 4, 99),
            ClientMapProgress { total: 10, built: 4, building: 6, pending: 0 }
        );
    }

    // --- file_index_progress ---

    #[test]
    fn file_index_derives_percent() {
        let f = file_index_progress(true, Some(47), Some(312));
        assert_eq!(f.indexing, true);
        assert_eq!(f.processed, Some(47));
        assert_eq!(f.total, Some(312));
        assert_eq!(f.percent, Some(15.0)); // 47/312 = 15.06 -> 15
    }

    #[test]
    fn file_index_no_numbers_no_percent() {
        let f = file_index_progress(false, None, None);
        assert_eq!(f.percent, None);
        assert_eq!(f.processed, None);
    }

    // --- compute_overall / assemble ---

    fn empty_raw() -> RawInputs {
        RawInputs {
            cloud_key_present: false,
            local_status: "absent".into(),
            local_part_bytes: None,
            local_total_bytes: 100,
            search_status: "absent".into(),
            email_credentials_available: false,
            email_workspace_connected: false,
            email_accounts: vec![],
            email_syncing: false,
            email_messages_imported: None,
            crm_credentials_available: false,
            crm_workspace_connected: false,
            crm_syncing: false,
            crm_households: 0,
            crm_records: 0,
            file_indexing: false,
            file_processed: None,
            file_total: None,
            client_map: ClientMapProgress::default(),
        }
    }

    #[test]
    fn overall_empty_when_nothing() {
        let s = assemble(empty_raw());
        assert_eq!(s.overall, OverallState::Empty);
        assert_eq!(s.ai.mode, AiMode::None);
        assert_eq!(s.email.connected, false);
    }

    #[test]
    fn overall_partial_when_source_connected_without_ai() {
        // Email connected but no AI brain and nothing in flight: this is real
        // setup, so it must NOT report "empty" (Codex P2).
        let mut raw = empty_raw();
        raw.email_credentials_available = true;
        raw.email_workspace_connected = true;
        raw.email_accounts =
            vec![EmailAccount { provider: "m365".into(), label: "Microsoft 365".into() }];
        let s = assemble(raw);
        assert_eq!(s.overall, OverallState::Partial);
    }

    #[test]
    fn global_credentials_do_not_connect_a_brand_new_workspace() {
        // OS-keychain credentials deliberately survive workspace changes. A
        // new workspace has no imported connector data yet, so neither row
        // may report Done just because this computer was connected before.
        let mut raw = empty_raw();
        raw.email_credentials_available = true;
        raw.email_accounts =
            vec![EmailAccount { provider: "m365".into(), label: "Microsoft 365".into() }];
        raw.crm_credentials_available = true;

        let s = assemble(raw);

        assert!(s.email.credentials_available);
        assert!(!s.email.connected);
        assert!(s.email.accounts.is_empty());
        assert!(s.crm.credentials_available);
        assert!(!s.crm.connected);
    }

    #[test]
    fn overall_partial_when_clients_exist_without_ai() {
        let mut raw = empty_raw();
        raw.client_map = client_map_progress(5, 0, 0); // 5 clients, none built
        let s = assemble(raw);
        assert_eq!(s.overall, OverallState::Partial);
    }

    #[test]
    fn overall_partial_when_search_model_ready_without_chat_brain() {
        let mut raw = empty_raw();
        raw.search_status = "ready".into(); // e5 downloaded, but no cloud key / local LLM
        let s = assemble(raw);
        assert_eq!(s.overall, OverallState::Partial);
    }

    #[test]
    fn overall_ready_with_cloud_key_idle() {
        let mut raw = empty_raw();
        raw.cloud_key_present = true;
        let s = assemble(raw);
        assert_eq!(s.overall, OverallState::Ready);
        assert_eq!(s.ai.state, ModelState::Ready);
    }

    #[test]
    fn overall_in_progress_during_email_sync() {
        let mut raw = empty_raw();
        raw.cloud_key_present = true; // would otherwise be ready
        raw.email_credentials_available = true;
        raw.email_workspace_connected = true;
        raw.email_accounts = vec![EmailAccount { provider: "m365".into(), label: "Microsoft 365".into() }];
        raw.email_syncing = true;
        let s = assemble(raw);
        assert_eq!(s.overall, OverallState::InProgress);
        assert_eq!(s.email.connected, true);
    }

    #[test]
    fn overall_in_progress_during_file_index() {
        let mut raw = empty_raw();
        raw.cloud_key_present = true;
        raw.file_indexing = true;
        raw.file_processed = Some(5);
        raw.file_total = Some(20);
        let s = assemble(raw);
        assert_eq!(s.overall, OverallState::InProgress);
    }

    #[test]
    fn overall_in_progress_when_cloud_key_and_local_downloading() {
        // HIGH (Codex): a cloud key makes the chat brain ready, but the local
        // model still downloading must keep overall = inProgress, not ready.
        let mut raw = empty_raw();
        raw.cloud_key_present = true;
        raw.local_status = "downloading".into();
        raw.local_part_bytes = Some(50);
        raw.local_total_bytes = 100;
        let s = assemble(raw);
        assert_eq!(s.ai.state, ModelState::Ready); // headline brain is usable (cloud)
        assert_eq!(s.ai.local_llm.state, ModelState::Downloading);
        assert_eq!(s.overall, OverallState::InProgress); // ...but a download is running
    }

    #[test]
    fn overall_partial_after_file_indexing_finishes() {
        // MEDIUM (Codex): files indexed (run finished) with nothing else must be
        // "partial", not "empty".
        let mut raw = empty_raw();
        raw.file_indexing = false;
        raw.file_processed = Some(312);
        raw.file_total = Some(312);
        let s = assemble(raw);
        assert_eq!(s.overall, OverallState::Partial);
    }

    #[test]
    fn overall_in_progress_while_local_model_downloads() {
        let mut raw = empty_raw();
        raw.local_status = "downloading".into();
        raw.local_part_bytes = Some(50);
        raw.local_total_bytes = 100;
        let s = assemble(raw);
        assert_eq!(s.ai.state, ModelState::Downloading);
        assert_eq!(s.ai.percent, Some(50.0));
        assert_eq!(s.overall, OverallState::InProgress);
    }

    #[test]
    fn assemble_reads_all_sources() {
        let mut raw = empty_raw();
        raw.cloud_key_present = true;
        raw.search_status = "ready".into();
        raw.crm_credentials_available = true;
        raw.crm_workspace_connected = true;
        raw.crm_households = 40;
        raw.crm_records = 1200;
        raw.client_map = client_map_progress(10, 4, 0);
        raw.email_messages_imported = Some(0);
        let s = assemble(raw);
        assert_eq!(s.ai.search_model.state, ModelState::Ready);
        assert_eq!(s.crm.connected, true);
        assert_eq!(s.crm.households_processed, 40);
        assert_eq!(s.crm.records_indexed, 1200);
        assert_eq!(s.client_map.built, 4);
        assert_eq!(s.client_map.pending, 6);
        // cloud ready + nothing in flight (client maps built, not building).
        assert_eq!(s.overall, OverallState::Ready);
    }

    // --- event parsers ---

    #[test]
    fn parse_mail_event_reads_real_payload() {
        // Shape of `SyncProgress` from mail/mod.rs (camelCase wire form).
        let payload = r#"{"status":"syncing","provider":"m365","folder":null,"written":340,"removed":2}"#;
        let parsed = parse_mail_event(payload);
        assert_eq!(
            parsed,
            Some((
                "m365".to_string(),
                MailLive { status: "syncing".into(), written: 340, removed: 2 }
            ))
        );
    }

    #[test]
    fn parse_mail_event_rejects_missing_provider_and_garbage() {
        assert_eq!(parse_mail_event(r#"{"status":"done","written":5}"#), None);
        assert_eq!(parse_mail_event("not json"), None);
    }

    #[test]
    fn parse_rag_index_event_reads_real_payload() {
        // Shape of `IndexingProgress` from rag/mod.rs (camelCase wire form).
        let payload = r#"{"status":"indexing","processed":47,"total":312,"currentPath":"/w/a.md"}"#;
        assert_eq!(
            parse_rag_index_event(payload),
            Some(FileIndexLive { status: "indexing".into(), processed: 47, total: 312 })
        );
    }

    #[test]
    fn parse_rag_index_event_rejects_garbage() {
        assert_eq!(parse_rag_index_event("{"), None);
    }

    // --- wire-format contract locks (camelCase strings the TS union expects) ---

    #[test]
    fn enum_wire_strings_are_stable() {
        assert_eq!(serde_json::to_string(&ModelState::None).unwrap(), r#""none""#);
        assert_eq!(serde_json::to_string(&ModelState::Downloading).unwrap(), r#""downloading""#);
        assert_eq!(serde_json::to_string(&ModelState::Ready).unwrap(), r#""ready""#);
        assert_eq!(serde_json::to_string(&AiMode::Cloud).unwrap(), r#""cloud""#);
        assert_eq!(serde_json::to_string(&OverallState::InProgress).unwrap(), r#""inProgress""#);
        assert_eq!(serde_json::to_string(&OverallState::Partial).unwrap(), r#""partial""#);
        assert_eq!(serde_json::to_string(&OverallState::Empty).unwrap(), r#""empty""#);
        assert_eq!(serde_json::to_string(&OverallState::Ready).unwrap(), r#""ready""#);
    }
}
