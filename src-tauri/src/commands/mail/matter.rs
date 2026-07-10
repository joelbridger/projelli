use super::*;
use crate::commands::mail::store::{EncryptedMailStore, MailListPage, MailListQuery, MailStore};
use serde::Serialize;
use std::collections::{BTreeMap, HashSet};
use tauri::State;

const MAX_MAIL_RETAG_MESSAGE_IDS: usize = 1024;

#[cfg(test)]
tokio::task_local! {
    /// Test-only seam that makes the production RAG write path execute a real
    /// LanceDB update with an invalid predicate. It proves the public command's
    /// durable-marker recovery when LanceDB itself rejects a write.
    static FORCE_LANCEDB_RETAG_FAILURE: ();
}

/// Resolve the matter id for a folder from the supplied mapping. Folder-level
/// entries (matching provider+account+folder) take precedence over account-level
/// entries (matching provider+account with an empty folder). Falls back to
/// `UNASSIGNED_MATTER` when nothing matches — mail is never silently filed into a
/// matter it was not mapped to.
pub(crate) fn resolve_mail_matter(
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
/// Best-effort read of the folder-level matter a mail message was indexed under,
/// from the RAG store by its "mail:<id>" path token. Returns `None` on any error,
/// when nothing is indexed yet, or when the scope is the unassigned sentinel —
/// so opening an email never fails on this lookup and "unassigned" reads as "not
/// filed". This is the SOFT fallback; the durable per-message override read in
/// `get_message_with_key` takes precedence. (BUG-013.)
pub(crate) async fn folder_matter_from_rag(workspace: &std::path::Path, id: &str) -> Option<String> {
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
/// A message's EFFECTIVE matter, computed with the SAME shared resolver
/// (`resolve_effective_matter` + `resolve_mail_matter`) that sync, backfill, the
/// folder-remap, and the viewer use — the durable per-message filing taken OVER
/// the folder→matter mapping. This is deliberately NOT a forked SQL copy of that
/// logic (same-ownership-resolver doctrine): browsing must agree with indexing
/// message-for-message, so a manual filing wins over the folder default and a
/// delete-tombstone (`UNASSIGNED_MATTER`) never leaks into another matter.
pub(crate) fn effective_mail_matter(
    matter_map: &[MailMatterMapEntry],
    override_opt: Option<&str>,
    key: &crate::commands::mail::store::MailFolderKey,
) -> String {
    let folder_default =
        resolve_mail_matter(matter_map, &key.provider, &key.account, &key.folder_id);
    resolve_effective_matter(override_opt, &folder_default)
}

/// Browse / keyword-search stored email metadata SCOPED to a single matter.
///
/// Unlike `mail_list_messages` (which browses every message and lets the frontend
/// filter a page), this enforces per-client isolation IN THE ENGINE: within one
/// read transaction it resolves — via the shared per-message/folder resolver — the
/// exact set of messages that belong to `matter_id`, then applies the standard
/// keyword/date/provider/sort/pagination query restricted to that set. Doing both
/// on one snapshot means a concurrent filing/sync can't slip another client's mail
/// in between the two steps. So the embedded per-client Email tab can never surface
/// another client's mail, and its pagination totals are honest. Never decrypts a blob.
#[tauri::command]
pub async fn mail_list_messages_by_matter(
    state: State<'_, MailState>,
    matter_id: String,
    matter_map: Vec<MailMatterMapEntry>,
    query: MailListQuery,
) -> Result<MailListPage, String> {
    // Validate up front (defence-in-depth) — a malformed matter id can never match.
    crate::commands::rag::store::validate_matter_id(&matter_id)
        .map_err(|e| format!("invalid matter id: {e}"))?;
    let workspace = state
        .workspace
        .lock()
        .await
        .clone()
        .ok_or("workspace not set")?;
    let key = crate::commands::mail::crypto::get_or_create_master_key()
        .map_err(|e| e.to_string())?;
    // SQLite + per-message override lookups are blocking; run off the async runtime.
    tokio::task::spawn_blocking(move || -> Result<MailListPage, String> {
        let store =
            EncryptedMailStore::open_with_key(&workspace, &key).map_err(|e| e.to_string())?;
        store
            .list_messages_for_matter(&query, &matter_id, |override_opt, key| {
                effective_mail_matter(&matter_map, override_opt, key)
            })
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| format!("join: {e}"))?
}

/// QA-44 (R7-2) — fold the per-message in-place re-tag results into the command
/// result. This is the SUCCESS CRITERION for a mail folder re-tag, and it is the
/// linchpin of the durable fail-closed hold: the frontend discharges the hold
/// (and clears the persisted pending-retag record) ONLY on `Ok`, so `Ok` must
/// mean a GENUINE success. Therefore ANY per-message failure fails the WHOLE
/// command — the frontend then keeps the folder's mail held out of retrieval and
/// retries, instead of laundering a partial re-tag (99 of 100 messages moved, 1
/// still physically tagged the OLD client) into a "success" that durably drops
/// the hold and re-opens the exact QA-44 wrong-client leak.
///
/// `Ok(0)` (the message has no indexed rows yet — a timing gap; it will pick up
/// the right matter when it is indexed) is a legitimate NO-OP, NOT a failure, and
/// must stay a no-op or every not-yet-indexed folder would be held out forever.
#[cfg(test)]
fn summarize_mail_retag(results: &[Result<u64, String>]) -> Result<u32, String> {
    let mut retagged = 0u32;
    let mut failures = 0u32;
    let mut last_err: Option<&str> = None;
    for r in results {
        match r {
            Ok(rows) if *rows > 0 => retagged += 1,
            Ok(_) => {} // Ok(0): not indexed yet — a legitimate no-op, never a failure
            Err(e) => {
                failures += 1;
                last_err = Some(e.as_str());
            }
        }
    }
    if failures > 0 {
        return Err(format!(
            "mail_retag_folder_matter: {failures} message(s) failed to re-tag (last: {}); \
             folder stays held out of retrieval until a clean re-tag",
            last_err.unwrap_or("")
        ));
    }
    Ok(retagged)
}

fn normalize_mail_message_ids(message_ids: Vec<String>) -> Result<Vec<String>, String> {
    let mut seen = HashSet::new();
    let mut ids = Vec::with_capacity(message_ids.len());
    for message_id in message_ids {
        let id = message_id.strip_prefix("mail:").unwrap_or(&message_id);
        if id.is_empty() {
            return Err("message id must not be empty".to_string());
        }
        if seen.insert(id.to_string()) {
            ids.push(id.to_string());
        }
    }
    if ids.is_empty() {
        return Err("at least one message id is required".to_string());
    }
    if ids.len() > MAX_MAIL_RETAG_MESSAGE_IDS {
        return Err(format!("too many messages (maximum {MAX_MAIL_RETAG_MESSAGE_IDS})"));
    }
    Ok(ids)
}

fn group_mail_retag_paths(
    ids_and_overrides: Vec<(String, Option<String>)>,
    folder_matter: &str,
) -> BTreeMap<String, Vec<String>> {
    let mut grouped = BTreeMap::new();
    for (id, override_matter) in ids_and_overrides {
        grouped
            .entry(resolve_effective_matter(override_matter.as_deref(), folder_matter))
            .or_insert_with(Vec::new)
            .push(format!("mail:{id}"));
    }
    grouped
}

/// A source-level RAG repair marker. `source_id` is ready to use as a retrieval
/// exclusion key; the frontend recovery lane deliberately owns that wiring.
#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PendingMailRagRetag {
    pub message_id: String,
    pub source_id: String,
    pub matter_id: String,
}

#[derive(Default)]
struct PendingRepairOutcome {
    repaired: Vec<(String, Vec<String>)>,
    failures: Vec<(String, Vec<String>, String)>,
}

fn group_pending_rag_retags(
    pending: Vec<(String, String)>,
) -> BTreeMap<String, Vec<String>> {
    let mut grouped = BTreeMap::new();
    for (message_id, matter_id) in pending {
        grouped.entry(matter_id).or_insert_with(Vec::new).push(message_id);
    }
    grouped
}

/// Run each marked group once. Keeping this independent of Tauri lets the same
/// exactly-marked batch logic power normal filing, startup repair, and failure
/// tests without a second write path.
async fn attempt_pending_rag_repairs<F, Fut>(
    grouped: BTreeMap<String, Vec<String>>,
    mut retag: F,
) -> PendingRepairOutcome
where
    F: FnMut(String, Vec<String>) -> Fut,
    Fut: std::future::Future<Output = Result<u64, String>>,
{
    let mut outcome = PendingRepairOutcome::default();
    for (matter_id, message_ids) in grouped {
        match retag(matter_id.clone(), message_ids.clone()).await {
            Ok(_) => outcome.repaired.push((matter_id, message_ids)),
            Err(error) => outcome.failures.push((matter_id, message_ids, error)),
        }
    }
    outcome
}

async fn retag_mail_paths_in_workspace(
    workspace: std::path::PathBuf,
    message_ids: Vec<String>,
    matter_id: String,
) -> Result<u64, String> {
    let paths: Vec<String> = message_ids
        .iter()
        .map(|message_id| format!("mail:{message_id}"))
        .collect();
    let conn = crate::commands::rag::store::open_connection(&workspace)
        .await
        .map_err(|e| format!("open lancedb: {e}"))?;
    if !conn
        .table_names()
        .execute()
        .await
        .map_err(|e| format!("list tables: {e}"))?
        .iter()
        .any(|name| name == crate::commands::rag::store::TABLE_NAME)
    {
        return Ok(0); // no indexed mail yet; the durable filing will stamp it later
    }
    let table = conn
        .open_table(crate::commands::rag::store::TABLE_NAME)
        .execute()
        .await
        .map_err(|e| format!("open table: {e}"))?;
    #[cfg(test)]
    if FORCE_LANCEDB_RETAG_FAILURE.try_with(|_| ()).is_ok() {
        return table
            .update()
            .only_if("this is deliberately invalid LanceDB SQL")
            .column("matter_id", "'forced-failure'")
            .execute()
            .await
            .map(|_| 0)
            .map_err(|e| format!("injected LanceDB update failure: {e}"));
    }
    let key = crate::commands::rag::crypto::get_or_create_master_key()
        .map_err(|e| format!("vectors key: {e}"))?;
    crate::commands::rag::store::retag_matter_for_paths(&table, &paths, &matter_id, &key)
        .await
        .map_err(|e| format!("batched RAG matter re-tag: {e}"))
}

async fn clear_repaired_rag_markers(
    workspace: std::path::PathBuf,
    repaired: Vec<(String, Vec<String>)>,
) -> Result<(), String> {
    if repaired.is_empty() {
        return Ok(());
    }
    tokio::task::spawn_blocking(move || -> anyhow::Result<()> {
        let store = EncryptedMailStore::open(&workspace)?;
        for (matter_id, message_ids) in repaired {
            store.clear_pending_rag_retag_batch_if_current(&message_ids, &matter_id)?;
        }
        Ok(())
    })
    .await
    .map_err(|e| format!("clear pending RAG repair join: {e}"))?
    .map_err(|e| format!("clear pending RAG repair: {e}"))
}

async fn mail_retag_messages_matter_core(
    state: &MailState,
    message_ids: Vec<String>,
    matter_id: String,
    expected_workspace: std::path::PathBuf,
) -> Result<u32, String> {
    crate::commands::rag::store::validate_matter_id(&matter_id)
        .map_err(|e| format!("invalid matter id: {e}"))?;
    // A filing owns its durable update, vector mirror and marker clear from
    // end to end. Without this, late A can overwrite completed B.
    let _retag_guard = state.retag_lock.lock().await;
    let workspace = state.workspace.lock().await.clone().ok_or("workspace not set")?;
    if expected_workspace != workspace {
        return Err("mail_retag_messages_matter: workspace changed; refusing stale batch".to_string());
    }
    let ids = normalize_mail_message_ids(message_ids)?;

    // This one transaction is deliberately before *any* LanceDB operation. A
    // power loss here leaves either neither record or both the filing and its
    // repair marker; it can never leave a filed message silently searchable in
    // its old matter.
    let ws = workspace.clone();
    let persisted_ids = ids.clone();
    let persisted_matter = matter_id.clone();
    tokio::task::spawn_blocking(move || -> anyhow::Result<()> {
        EncryptedMailStore::open(&ws)?.set_message_matter_batch_with_pending_rag_retag(
            &persisted_ids,
            &persisted_matter,
        )
    })
    .await
    .map_err(|e| format!("persist matter filing join: {e}"))?
    .map_err(|e| format!("persist matter filing: {e}"))?;

    // Re-read durable targets immediately before the vector write. This also
    // advances any stale marker to the newest durable matter in one SQL txn.
    let ws_for_targets = workspace.clone();
    let current_targets = tokio::task::spawn_blocking(move || -> anyhow::Result<Vec<(String, String)>> {
        EncryptedMailStore::open(&ws_for_targets)?.pending_rag_retags_at_current_target()
    })
    .await
    .map_err(|e| format!("read current RAG repair targets join: {e}"))?
    .map_err(|e| format!("read current RAG repair targets: {e}"))?;
    let selected: HashSet<&str> = ids.iter().map(String::as_str).collect();
    let grouped = group_pending_rag_retags(
        current_targets.into_iter()
            .filter(|(id, _)| selected.contains(id.as_str()))
            .collect(),
    );
    let workspace_for_retag = workspace.clone();
    let outcome = attempt_pending_rag_repairs(grouped, move |target, repair_ids| {
        retag_mail_paths_in_workspace(workspace_for_retag.clone(), repair_ids, target)
    })
    .await;
    clear_repaired_rag_markers(workspace, outcome.repaired).await?;
    if let Some((target, repair_ids, error)) = outcome.failures.into_iter().next() {
        return Err(format!(
            "mail was filed locally, but RAG scope repair is pending for {} source(s) in {target}: {error}",
            repair_ids.len()
        ));
    }

    // This command's result is intentionally the durable filing count. Folder
    // remaps retain their older, different "messages whose RAG scope changed"
    // count below.
    Ok(ids.len() as u32)
}

/// WS-B/C: re-tag every message stored under a (provider, account, folder) to a
/// matter, IN PLACE in the RAG store (no re-embedding) — the same re-tag path
/// files use. Called by the frontend when a mail folder's matter mapping
/// changes, so already-indexed mail picks up the new scope immediately. An empty
/// `folder_id` re-tags every folder in the account (an account-level mapping).
/// Returns the number of RAG rows actually re-tagged. No-op (Ok(0)) when memory/index has
/// nothing for those messages yet. QA-44 (R7-2): FAILS if ANY message's re-tag
/// errors, so a partial re-tag never reports success (see `summarize_mail_retag`).
///
/// QA-44 (R7-5b): `expected_workspace` (when the caller supplies it) PINS the
/// re-tag to the workspace that was open when the op was scheduled. A scheduled
/// re-tag op can outlive a workspace switch — the frontend scheduler cancels retry
/// TIMERS but cannot reach into an in-flight/queued backend call — and this command
/// otherwise re-tags whatever workspace is current on the Rust side, so an op
/// captured for workspace A could tag workspace B's mail with A's target. When the
/// pin does not match the now-current workspace, the command REFUSES.
#[tauri::command]
pub async fn mail_retag_folder_matter(
    state: State<'_, MailState>,
    provider: String,
    account: String,
    folder_id: String,
    matter_id: String,
    expected_workspace: Option<String>,
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

    // R7-5b: refuse a cross-workspace write. `Path` equality compares components,
    // so a trailing separator difference is not a false mismatch. An empty/omitted
    // pin means the caller did not capture a root (e.g. a live user filing that
    // cannot span a switch) — then we don't pin.
    if let Some(expected) = expected_workspace.as_deref() {
        if !expected.is_empty() && std::path::Path::new(expected) != workspace.as_path() {
            return Err(format!(
                "mail_retag_folder_matter: workspace changed (expected {expected}); \
                 refusing to re-tag a different workspace's mail"
            ));
        }
    }
    // Coordinate with manual filings and repair. A folder re-tag that began
    // before a manual B filing must finish before B's durable/RAG pair, never
    // overwrite B after it has completed.
    let _retag_guard = state.retag_lock.lock().await;

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

    // Preserve manual overrides, but update each effective target once per
    // 512 paths rather than once per message.
    let grouped = group_mail_retag_paths(ids_and_overrides, &matter_id);
    let mut retagged_rows = 0u32;
    for (effective_matter, paths) in grouped {
        retagged_rows += crate::commands::rag::store::retag_matter_for_paths(
            &table, &paths, &effective_matter, &vec_key,
        )
        .await
        .map_err(|e| format!("batched RAG matter re-tag: {e}"))? as u32;
    }
    Ok(retagged_rows)
}

/// File messages to a matter in one durable transaction and bounded vector-table
/// updates. `expected_workspace` is required, so a queued batch cannot act on a
/// different workspace that was opened after the request was created.
#[tauri::command]
pub async fn mail_retag_messages_matter(
    state: State<'_, MailState>,
    message_ids: Vec<String>,
    matter_id: String,
    expected_workspace: Option<String>,
) -> Result<u32, String> {
    let expected_workspace = match expected_workspace.filter(|workspace| !workspace.is_empty()) {
        Some(workspace) => std::path::PathBuf::from(workspace),
        None => state.workspace.lock().await.clone().ok_or("workspace not set")?,
    };
    mail_retag_messages_matter_core(
        state.inner(),
        message_ids,
        matter_id,
        expected_workspace,
    )
    .await
}

/// Compatibility entrypoint for one message. It delegates to the batch core so
/// every filing follows the same durable-marker and RAG-repair path.
#[tauri::command]
pub async fn mail_retag_message_matter(
    state: State<'_, MailState>,
    message_id: String,
    matter_id: String,
) -> Result<(), String> {
    let expected_workspace = state.workspace.lock().await.clone().ok_or("workspace not set")?;
    mail_retag_messages_matter_core(
        state.inner(),
        vec![message_id],
        matter_id,
        expected_workspace,
    )
    .await
    .map(|_| ())

}

/// List the exact source IDs that must stay out of retrieval until their RAG
/// scope update is repaired. This is read-only and safe to call during startup.
#[tauri::command]
pub async fn mail_list_pending_rag_retags(
    state: State<'_, MailState>,
) -> Result<Vec<PendingMailRagRetag>, String> {
    let _retag_guard = state.retag_lock.lock().await;
    let workspace = state.workspace.lock().await.clone().ok_or("workspace not set")?;
    tokio::task::spawn_blocking(move || -> anyhow::Result<Vec<PendingMailRagRetag>> {
        if !EncryptedMailStore::db_path(&workspace).exists() {
            return Ok(Vec::new());
        }
        Ok(EncryptedMailStore::open(&workspace)?
            .pending_rag_retags_at_current_target()?
            .into_iter()
            .map(|(message_id, matter_id)| PendingMailRagRetag {
                source_id: format!("mail:{message_id}"),
                message_id,
                matter_id,
            })
            .collect())
    })
    .await
    .map_err(|e| format!("list pending RAG repairs join: {e}"))?
    .map_err(|e| format!("list pending RAG repairs: {e}"))
}

/// Retry exactly the marked source IDs, grouped only by their recorded target
/// matter. Repeating it is safe: successful groups clear their own markers and
/// a crash after the vector write simply replays the same idempotent update.
#[tauri::command]
pub async fn mail_repair_pending_rag_retags(
    state: State<'_, MailState>,
) -> Result<u32, String> {
    let workspace = state.workspace.lock().await.clone().ok_or("workspace not set")?;
    let ws_for_read = workspace.clone();
    let pending = tokio::task::spawn_blocking(move || -> anyhow::Result<Vec<(String, String)>> {
        if !EncryptedMailStore::db_path(&ws_for_read).exists() {
            return Ok(Vec::new());
        }
        EncryptedMailStore::open(&ws_for_read)?.pending_rag_retags_at_current_target()
    })
    .await
    .map_err(|e| format!("read pending RAG repairs join: {e}"))?
    .map_err(|e| format!("read pending RAG repairs: {e}"))?;
    let marked_count = pending.len() as u32;
    let workspace_for_retag = workspace.clone();
    let outcome = attempt_pending_rag_repairs(group_pending_rag_retags(pending), move |target, ids| {
        retag_mail_paths_in_workspace(workspace_for_retag.clone(), ids, target)
    })
    .await;
    clear_repaired_rag_markers(workspace, outcome.repaired).await?;
    if let Some((target, ids, error)) = outcome.failures.into_iter().next() {
        return Err(format!(
            "RAG scope repair still pending for {} source(s) in {target}: {error}",
            ids.len()
        ));
    }
    Ok(marked_count)
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::mail::store::MailRecord;
    use crate::commands::rag::chunker::Chunk;
    use crate::commands::rag::store::PRIVILEGE_NONE;
    use arrow_array::RecordBatchIterator;
    use std::sync::atomic::AtomicBool;
    use std::sync::{Arc, Once};
    use tauri::Manager;

    static HEADLESS_TEST_KEYS: Once = Once::new();

    fn configure_headless_test_keys() {
        HEADLESS_TEST_KEYS.call_once(|| {
            std::env::set_var("LANTERN_HEADLESS_TEST_MAIL_MASTER_KEY_HEX", "11".repeat(32));
            std::env::set_var("LANTERN_HEADLESS_TEST_VECTORS_MASTER_KEY_HEX", "22".repeat(32));
        });
    }

    async fn test_app_for_workspace(workspace: &std::path::Path) -> tauri::App<tauri::test::MockRuntime> {
        configure_headless_test_keys();
        let app = tauri::test::mock_builder()
            .manage(MailState {
                workspace: tokio::sync::Mutex::new(Some(workspace.to_path_buf())),
                retag_lock: tokio::sync::Mutex::new(()),
                cancel: Arc::new(AtomicBool::new(false)),
                is_syncing: Arc::new(AtomicBool::new(false)),
                oauth_cancel: Arc::new(AtomicBool::new(false)),
                gmail_oauth_cancel: Arc::new(AtomicBool::new(false)),
            })
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .unwrap();
        let store = EncryptedMailStore::open(workspace).unwrap();
        store.upsert(&MailRecord {
            id: "one".to_string(), folder_id: "inbox".to_string(),
            internet_message_id: None, relative_path: ".lantern/mail/blobs/one.enc".to_string(),
            received_date_time: None, provider: "m365".to_string(), account: "default".to_string(),
            subject: String::new(), from_addr: String::new(), from_name: String::new(),
            snippet: String::new(), has_attachments: false,
        }).unwrap();
        let key = crate::commands::rag::crypto::get_or_create_master_key().unwrap();
        let conn = crate::commands::rag::store::open_connection(workspace).await.unwrap();
        let table = crate::commands::rag::store::open_or_create_table(&conn).await.unwrap();
        let rows = vec![(
            Chunk { path: "mail:one".to_string(), paragraph_index: 0, text: "test".to_string(), start_offset: 0, end_offset: 4, locator: None },
            vec![0.0; crate::commands::rag::embedder::EMBEDDING_DIM],
        )];
        let batch = crate::commands::rag::store::build_batch_mail(
            &rows, &key, crate::commands::rag::store::UNASSIGNED_MATTER, PRIVILEGE_NONE,
        ).unwrap();
        let schema = batch.schema();
        table.add(Box::new(RecordBatchIterator::new(vec![Ok(batch)], schema)))
            .execute().await.unwrap();
        app
    }

    // QA-44 (R7-2) — the per-message fold that decides whether a mail folder
    // re-tag SUCCEEDED. `Ok` from the command durably discharges the fail-closed
    // hold, so `Ok` must mean EVERY message re-tagged (or was legitimately not
    // indexed yet). A single failure must fail the command.

    #[test]
    fn all_indexed_messages_retagged_is_ok_with_count() {
        // Three messages, each had rows updated → Ok(3), no failure.
        assert_eq!(summarize_mail_retag(&[Ok(2), Ok(1), Ok(5)]), Ok(3));
    }

    #[test]
    fn zero_rows_is_a_noop_not_a_failure() {
        // Ok(0) = the message is not indexed yet (a timing gap). Holding it out
        // forever would strand every not-yet-indexed folder, so it is NOT a
        // failure — the command still succeeds with 0 re-tagged.
        assert_eq!(summarize_mail_retag(&[Ok(0), Ok(0)]), Ok(0));
    }

    #[test]
    fn mixed_indexed_and_not_indexed_counts_only_the_indexed() {
        assert_eq!(summarize_mail_retag(&[Ok(3), Ok(0), Ok(1)]), Ok(2));
    }

    #[test]
    fn a_single_per_message_failure_fails_the_whole_command() {
        // The R7-2 invariant: 99 messages re-tag, 1 errors (e.g. a LanceDB row
        // update failure). The command MUST fail so the frontend keeps the folder
        // held out + retries, instead of discharging the durable hold on a false
        // success and re-opening the wrong-client leak.
        let mut results: Vec<Result<u64, String>> = (0..99).map(|_| Ok(1u64)).collect();
        results.push(Err("lancedb update failed".to_string()));
        let out = summarize_mail_retag(&results);
        assert!(out.is_err(), "one failed message must fail the command");
        assert!(out.unwrap_err().contains("failed to re-tag"));
    }

    #[test]
    fn a_failure_wins_even_when_the_rest_were_not_indexed() {
        // Not-yet-indexed no-ops must not mask a real failure.
        assert!(summarize_mail_retag(&[Ok(0), Err("boom".to_string()), Ok(2)]).is_err());
    }

    #[test]
    fn batch_ids_normalize_prefixes_and_deduplicate() {
        assert_eq!(
            normalize_mail_message_ids(vec!["mail:a".into(), "a".into(), "mail:b".into()]).unwrap(),
            vec!["a".to_string(), "b".to_string()]
        );
    }

    #[test]
    fn matter_retag_has_only_syntax_validation_until_the_app_has_a_matter_authorization_seam() {
        // Matter-scoped Tauri commands (including mail_list_messages_by_matter)
        // have no caller identity or allowed-matter state. The separate MCP
        // process has its own access state, but it is not available here. This
        // documents the pre-existing boundary instead of inventing a false
        // authorization check that could claim to protect this command.
        assert!(crate::commands::rag::store::validate_matter_id("matter-not-in-any-local-list").is_ok());
    }

    #[tokio::test]
    async fn public_batch_command_keeps_marker_when_real_lancedb_write_fails_then_repairs() {
        let dir = tempfile::TempDir::new().unwrap();
        let app = test_app_for_workspace(dir.path()).await;
        let failure = FORCE_LANCEDB_RETAG_FAILURE.scope((), async {
            mail_retag_messages_matter(
                app.state::<MailState>(), vec!["one".to_string()], "matter-acme".to_string(), None,
            ).await
        }).await;
        assert!(failure.unwrap_err().contains("injected LanceDB update failure"));
        let store = EncryptedMailStore::open(dir.path()).unwrap();
        assert_eq!(store.get_message_matter("one").unwrap().as_deref(), Some("matter-acme"));
        assert_eq!(store.pending_rag_retags().unwrap(), vec![("one".to_string(), "matter-acme".to_string())]);

        assert_eq!(mail_repair_pending_rag_retags(app.state::<MailState>()).await.unwrap(), 1);
        assert!(store.pending_rag_retags().unwrap().is_empty());
    }

    #[tokio::test]
    async fn late_a_retag_rechecks_durable_b_and_cannot_overwrite_completed_b() {
        let dir = tempfile::TempDir::new().unwrap();
        let app = test_app_for_workspace(dir.path()).await;
        let store = EncryptedMailStore::open(dir.path()).unwrap();
        let ids = vec!["one".to_string()];
        // A has committed but has not yet reached LanceDB.
        store.set_message_matter_batch_with_pending_rag_retag(&ids, "matter-a").unwrap();
        // B is filed and completes while A is still in flight.
        store.set_message_matter_batch_with_pending_rag_retag(&ids, "matter-b").unwrap();
        assert_eq!(mail_repair_pending_rag_retags(app.state::<MailState>()).await.unwrap(), 1);
        // The late A attempt re-reads the durable target immediately before any
        // vector write. B's clear means there is no A write left to perform.
        assert!(store.pending_rag_retags_at_current_target().unwrap().is_empty());
        let conn = crate::commands::rag::store::open_connection(dir.path()).await.unwrap();
        let table = conn.open_table(crate::commands::rag::store::TABLE_NAME).execute().await.unwrap();
        let key = crate::commands::rag::crypto::get_or_create_master_key().unwrap();
        assert_eq!(crate::commands::rag::store::matter_for_path(&table, "mail:one", &key).await.unwrap().as_deref(), Some("matter-b"));
        assert!(store.pending_rag_retags().unwrap().is_empty());
    }
}
