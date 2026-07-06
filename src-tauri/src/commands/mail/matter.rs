use super::*;
use crate::commands::mail::store::{EncryptedMailStore, MailListPage, MailListQuery, MailStore};
use tauri::State;

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

/// WS-B/C: re-tag every message stored under a (provider, account, folder) to a
/// matter, IN PLACE in the RAG store (no re-embedding) — the same re-tag path
/// files use. Called by the frontend when a mail folder's matter mapping
/// changes, so already-indexed mail picks up the new scope immediately. An empty
/// `folder_id` re-tags every folder in the account (an account-level mapping).
/// Returns the number of messages re-tagged. No-op (Ok(0)) when memory/index has
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

    let mut results: Vec<Result<u64, String>> = Vec::with_capacity(ids_and_overrides.len());
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
        let outcome = crate::commands::rag::store::retag_matter_for_path(
            &table, &path_key, &effective_matter, &vec_key,
        )
        .await;
        if let Err(e) = &outcome {
            log::warn!("retag matter for {path_key} failed: {e}");
        }
        // QA-44 (R7-2): a per-message Err means that message may STILL carry the
        // OLD (wrong-client) matter tag. Collect every outcome and fail the whole
        // command if any errored — a swallowed failure here would let the frontend
        // discharge the durable fail-closed hold on a false success.
        results.push(outcome.map_err(|e| e.to_string()));
    }
    summarize_mail_retag(&results)
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

#[cfg(test)]
mod tests {
    use super::*;

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
}
