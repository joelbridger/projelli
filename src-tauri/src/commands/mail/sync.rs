use crate::commands::mail::crypto::encrypt_with_key;
#[cfg(test)]
use crate::commands::mail::graph::{page_continuation, Continuation, DeltaGone, GraphClient};
use crate::commands::mail::model::{BodyContentType, MailMessage};
use crate::commands::mail::normalize::to_markdown;
#[cfg(test)]
use crate::commands::mail::provider::ChangePage;
use crate::commands::mail::provider::{Cursor, MailProvider, RemoteFolder};
use crate::commands::mail::store::{encrypted_blob_relative_path, MailRecord, MailStore};
use std::path::Path;

#[derive(Debug, Default, PartialEq)]
pub struct PageStats {
    pub written: u32,
    pub removed: u32,
}

/// Run a blocking closure without stalling the async runtime when we can.
///
/// P2.3 row 5: applying a mail page does blocking disk writes + a SQLite
/// transaction. On the multi-threaded runtime Tauri uses in production,
/// `block_in_place` lets the scheduler move sibling tasks to other worker
/// threads for the duration, so a big sync no longer freezes the app. On a
/// current-thread runtime (some `#[tokio::test]`s) `block_in_place` would panic,
/// so we run the closure inline — identical to the pre-P2.3 behaviour. This only
/// affects scheduling; results are unchanged, and the closure may borrow freely
/// (no `'static`/`Send` bound, unlike `spawn_blocking`).
fn run_blocking<T>(f: impl FnOnce() -> T) -> T {
    use tokio::runtime::{Handle, RuntimeFlavor};
    match Handle::try_current().map(|h| h.runtime_flavor()) {
        Ok(RuntimeFlavor::MultiThread) => tokio::task::block_in_place(f),
        _ => f(),
    }
}

/// Max consecutive 410 (delta-token-expired) resets before a folder sync gives
/// up, so a server stuck returning 410 cannot loop indefinitely.
#[cfg(test)]
const MAX_DELTA_RESETS: u32 = 3;

#[cfg(test)]
fn safe_filename(id: &str) -> String {
    id.chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '_' })
        .collect()
}

/// Apply one delta page to the store + disk. Idempotent: replays are harmless
/// because upsert is by id and tombstone is a no-op when absent.
#[cfg(test)]
pub fn apply_page(
    store: &dyn MailStore,
    workspace_root: &Path,
    folder_id: &str,
    page: &serde_json::Value,
) -> anyhow::Result<PageStats> {
    let mut stats = PageStats::default();
    let items = page
        .get("value")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    for item in &items {
        let id = item.get("id").and_then(|s| s.as_str()).unwrap_or("");
        if id.is_empty() {
            continue;
        }
        if MailMessage::is_removed(item) {
            if let Some(rel) = store.tombstone(id)? {
                let _ = std::fs::remove_file(
                    crate::commands::data_dir::resolve_workspace_relative(workspace_root, &rel),
                );
                stats.removed += 1;
            }
            continue;
        }
        if let Some(msg) = MailMessage::from_graph(item) {
            // Sanitize BOTH path segments. folder_id and msg.id both come from
            // Microsoft Graph (untrusted). safe_filename is an allowlist (only
            // ASCII alphanumerics survive), so "../" / path separators can never
            // escape the workspace, regardless of what Graph returns.
            let rel = format!(
                "Mail/{}/{}.md",
                safe_filename(folder_id),
                safe_filename(&msg.id)
            );
            let abs = workspace_root.join(&rel);
            if let Some(p) = abs.parent() {
                std::fs::create_dir_all(p)?;
            }
            std::fs::write(&abs, to_markdown(&msg))?;
            // Legacy Phase-1 import helper. Production sync uses apply_page_enc
            // with EncryptedMailStore; this path remains only for migration/test
            // coverage of old Mail/*.md artifacts.
            let snippet_source = match msg.body_content_type {
                BodyContentType::Html => {
                    crate::commands::mail::normalize::html_to_text(&msg.body_text)
                }
                BodyContentType::Text => msg.body_text.clone(),
            };
            let snippet: String = snippet_source
                .chars()
                .map(|c| if c == '\n' || c == '\r' { ' ' } else { c })
                .take(200)
                .collect();
            store.upsert(&MailRecord {
                id: msg.id.clone(),
                folder_id: folder_id.to_string(),
                internet_message_id: msg.internet_message_id.clone(),
                relative_path: rel,
                received_date_time: msg.received_date_time.clone(),
                provider: String::new(),
                account: String::new(),
                subject: msg.subject.clone(),
                from_addr: msg.from_address.clone().unwrap_or_default(),
                from_name: msg.from_name.clone().unwrap_or_default(),
                snippet,
                has_attachments: msg.has_attachments,
                thread_id: msg.thread_id.clone(),
                auth_result: msg.auth_result.clone(),
                attachment_refs: msg.attachments.clone(),
                attachments_unsupported: msg.attachments_unsupported,
            })?;
            stats.written += 1;
        }
    }
    Ok(stats)
}

/// Apply already-normalized changes to the encrypted store + index. Provider-
/// agnostic core used by `apply_page_enc` (Graph) and future Gmail/IMAP paths.
///
/// `provider` / `account` are persisted on each record so a message can later be
/// mapped back to its mail-folder key (provider/account/folder), which is what a
/// matter maps to. `matter_id` is the confidentiality scope resolved for this
/// folder (the caller resolves the account/folder->matter mapping once per
/// folder; it is `UNASSIGNED_MATTER` when the folder is not mapped) and is
/// forwarded to `index_callback` so the RAG chunk is tagged at index time.
#[allow(clippy::too_many_arguments)]
pub fn apply_messages_enc<F, T>(
    store: &dyn MailStore,
    workspace_root: &Path,
    folder_id: &str,
    provider: &str,
    account: &str,
    matter_id: &str,
    messages: &[MailMessage],
    removed_ids: &[String],
    key: &[u8; 32],
    index_callback: &F,
    tombstone_callback: &T,
) -> anyhow::Result<PageStats>
where
    F: Fn(&str, &str, &str),
    T: Fn(&str),
{
    let mut stats = PageStats::default();
    for id in removed_ids {
        if id.is_empty() {
            continue;
        }
        if let Some(rel) = store.tombstone(id)? {
            let _ = std::fs::remove_file(crate::commands::data_dir::resolve_workspace_relative(
                workspace_root,
                &rel,
            ));
            tombstone_callback(id);
            stats.removed += 1;
        }
    }
    // P2.3 row 5: collect the page's records and upsert them in ONE transaction
    // at the end, instead of one autocommit upsert (= one fsync) per message.
    // Blob writes stay per-message (they touch disk, not the messages table, so
    // their order relative to the DB upsert does not matter; if a blob write
    // fails we return Err before any upsert, exactly as before — the page is
    // idempotent and re-applied on the next sync).
    //
    // index_callback is DEFERRED: it makes the message searchable (RAG chunk +
    // keyword index), so it must never fire before the row it describes is
    // durably committed. Firing it per-message here (as before) would leave
    // earlier messages on the page searchable-but-orphaned if a later blob
    // write or the batch upsert itself failed. Collect the work during the
    // loop and only run it after `upsert_batch` returns Ok.
    let mut records: Vec<MailRecord> = Vec::with_capacity(messages.len());
    let mut pending_index: Vec<(String, String)> = Vec::with_capacity(messages.len());
    for msg in messages {
        let markdown = to_markdown(msg);
        let rel = encrypted_blob_relative_path(provider, account, &msg.id);
        let blob_abs = crate::commands::data_dir::resolve_workspace_relative(workspace_root, &rel);
        if let Some(parent) = blob_abs.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let encrypted = encrypt_with_key(markdown.as_bytes(), key)?;
        std::fs::write(&blob_abs, &encrypted)?;
        // Build a ~200-char plaintext snippet from the body for the list surface.
        // Newlines are collapsed to spaces; HTML bodies are stripped to text first
        // so the snippet shows readable prose rather than raw markup.
        let snippet_source = match msg.body_content_type {
            BodyContentType::Html => crate::commands::mail::normalize::html_to_text(&msg.body_text),
            BodyContentType::Text => msg.body_text.clone(),
        };
        let snippet: String = snippet_source
            .chars()
            .map(|c| if c == '\n' || c == '\r' { ' ' } else { c })
            .take(200)
            .collect();
        records.push(MailRecord {
            id: msg.id.clone(),
            folder_id: folder_id.to_string(),
            internet_message_id: msg.internet_message_id.clone(),
            relative_path: rel,
            received_date_time: msg.received_date_time.clone(),
            provider: provider.to_string(),
            account: account.to_string(),
            subject: msg.subject.clone(),
            from_addr: msg.from_address.clone().unwrap_or_default(),
            from_name: msg.from_name.clone().unwrap_or_default(),
            snippet,
            has_attachments: msg.has_attachments,
            thread_id: msg.thread_id.clone(),
            auth_result: msg.auth_result.clone(),
            attachment_refs: msg.attachments.clone(),
            attachments_unsupported: msg.attachments_unsupported,
        });
        pending_index.push((msg.id.clone(), markdown));
        stats.written += 1;
    }
    store.upsert_batch(&records)?;
    // Only now is every record on this page durably committed — safe to index.
    //
    // BUG-013: a DURABLE per-message filing (manual "file to matter", stored in
    // the mail DB) wins over the folder mapping, so a manual filing survives
    // this re-sync/re-index instead of being re-stamped back to the folder's
    // matter. Absent override → use the folder `matter_id`.
    // BUG-042: an "unassigned" tombstone (left when a filed-to matter was
    // deleted) stays unassigned — it is NOT re-stamped to the folder's matter,
    // so a deleted matter's email can never silently move into another matter.
    //
    // Resolved HERE (immediately before each index_callback call), not while
    // building `records` above: a page can take a while to commit (many blobs
    // + a batched transaction), and resolving eagerly would let a concurrent
    // manual filing that lands mid-page get silently overwritten by a stale
    // folder-matter tag once indexing finally ran. Resolving at call time keeps
    // the override race window as narrow as the underlying store read.
    for (id, markdown) in &pending_index {
        let effective_matter = crate::commands::mail::resolve_effective_matter(
            store.get_message_matter(id).ok().flatten().as_deref(),
            matter_id,
        );
        index_callback(id, markdown, &effective_matter);
    }
    Ok(stats)
}

/// Encrypted variant of apply_page.
///
/// Differences from `apply_page`:
///   - Does NOT write Mail/*.md plaintext files.
///   - Writes each message body as an AES-256-GCM blob under
///     `.lantern/mail/blobs/<sha256(provider,account,id)>.enc` using `key`.
///   - After writing the blob, calls `index_callback(id, markdown_plaintext)`
///     so the caller can feed the decrypted text to the RAG indexer and keyword
///     index in memory without the text ever touching disk.
///   - tombstone: removes the .enc blob from disk (via workspace_root join
///     of relative_path) in addition to the store record, AND calls
///     `tombstone_callback(id)` so the caller can delete the corresponding
///     LanceDB RAG chunks (S3 fix — deleted mail must stop being searchable).
///
/// `store` must be an `EncryptedMailStore` (or any MailStore impl that stores
/// relative_path pointing to .enc files). The trait is used so tests can pass
/// a FakeStore.
#[allow(clippy::too_many_arguments)]
pub fn apply_page_enc<F, T>(
    store: &dyn MailStore,
    workspace_root: &Path,
    folder_id: &str,
    provider: &str,
    account: &str,
    matter_id: &str,
    page: &serde_json::Value,
    key: &[u8; 32],
    index_callback: &F,
    tombstone_callback: &T,
) -> anyhow::Result<PageStats>
where
    F: Fn(&str, &str, &str),
    T: Fn(&str),
{
    let items = page
        .get("value")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    let mut messages: Vec<MailMessage> = Vec::new();
    let mut removed_ids: Vec<String> = Vec::new();
    for item in &items {
        let id = item.get("id").and_then(|s| s.as_str()).unwrap_or("");
        if id.is_empty() {
            continue;
        }
        if MailMessage::is_removed(item) {
            removed_ids.push(id.to_string());
        } else if let Some(m) = MailMessage::from_graph(item) {
            messages.push(m);
        }
    }
    apply_messages_enc(
        store,
        workspace_root,
        folder_id,
        provider,
        account,
        matter_id,
        &messages,
        &removed_ids,
        key,
        index_callback,
        tombstone_callback,
    )
}

/// G7: Migration — remove the plaintext `Mail/` directory written by Phase 1.
///
/// Called once at the start of `mail_sync_all`. If a plaintext `Mail/` directory
/// from Phase 1 exists under `workspace_root`, it is deleted entirely. The next
/// sync will re-download and import all messages as encrypted blobs under
/// `.lantern/mail/blobs/*.enc`. This is safe because:
///   - Phase 1 data was only used on test accounts (no production mail yet).
///   - All data is re-downloadable from Microsoft Graph on the next sync.
///   - `EncryptedMailStore` uses `mail-enc.db`; the old `mail.db` (SqliteMailStore)
///     coexists without schema conflict and is simply ignored.
///   - Only the workspace-relative `Mail/` directory is touched — never anything
///     outside the workspace.
pub fn migrate_plaintext(workspace_root: &Path) {
    let mail_dir = workspace_root.join("Mail");
    if mail_dir.exists() {
        log::info!(
            "G7 migration: removing Phase-1 plaintext Mail/ from {}",
            workspace_root.display()
        );
        let _ = std::fs::remove_dir_all(&mail_dir);
    }
    // S1: Also remove the Phase-1 plaintext SQLite metadata DB.
    // mail.db holds message ids, folder ids, relative paths, and timestamps —
    // all metadata disclosure on a stolen laptop.  Best-effort: ignore errors
    // (file may not exist, or may already be deleted).
    let mail_db = crate::commands::data_dir::workspace_data_dir(workspace_root).join("mail.db");
    let _ = std::fs::remove_file(&mail_db);
}

/// Drive one folder to completion, persisting the cursor after each page.
/// `emit` is a callback so the command layer can fire Tauri progress events
/// and the test can pass a no-op.
#[cfg(test)]
pub async fn sync_folder<F: Fn(u32, u32) + Send>(
    client: &GraphClient,
    store: &(dyn MailStore + Sync),
    workspace_root: &Path,
    folder_id: &str,
    emit: &F,
) -> anyhow::Result<PageStats> {
    let mut url = match store.get_cursor(folder_id)? {
        Some(saved) => saved, // resume (deltaLink or interrupted nextLink)
        None => client.delta_start_url(folder_id), // fresh backfill
    };
    let mut total = PageStats::default();
    let mut delta_gone_count = 0u32;
    loop {
        let page = match client.get_json(&url).await {
            Ok(p) => p,
            Err(e) if e.downcast_ref::<DeltaGone>().is_some() => {
                // Delta token expired (410): discard cursor, restart this folder from scratch.
                // Bound the retries — a server stuck on 410 must not spin forever
                // (this loop also holds the sync slot and blocks cancellation).
                delta_gone_count += 1;
                if delta_gone_count > MAX_DELTA_RESETS {
                    return Err(anyhow::anyhow!(
                        "folder {folder_id}: delta token expired {delta_gone_count}x in a row; giving up"
                    ));
                }
                store.set_cursor(folder_id, &client.delta_start_url(folder_id))?;
                url = client.delta_start_url(folder_id);
                continue;
            }
            Err(e) => return Err(e),
        };
        let s = apply_page(store, workspace_root, folder_id, &page)?;
        total.written += s.written;
        total.removed += s.removed;
        emit(total.written, total.removed);
        match page_continuation(&page) {
            Continuation::Next(next) => {
                store.set_cursor(folder_id, &next)?;
                url = next;
            }
            Continuation::Delta(delta) => {
                store.set_cursor(folder_id, &delta)?;
                break;
            }
            Continuation::End => break,
        }
    }
    Ok(total)
}

/// Provider-agnostic encrypted folder sync. Loops a provider's `fetch_changes`,
/// persisting the resume cursor after each page, applying via `apply_messages_enc`.
///
/// `matter_id` is the confidentiality scope this folder maps to. The caller
/// resolves the account/folder->matter mapping once per folder before calling
/// this (it is `UNASSIGNED_MATTER` when the folder is not mapped) so every chunk
/// indexed from this folder is tagged with the right matter at index time.
#[allow(clippy::too_many_arguments)]
pub async fn sync_folder_provider<F, I, T>(
    provider: &dyn MailProvider,
    store: &(dyn MailStore + Sync),
    workspace_root: &Path,
    folder: &RemoteFolder,
    account: &str,
    matter_id: &str,
    key: &[u8; 32],
    emit: &F,
    index_callback: &I,
    tombstone_callback: &T,
) -> anyhow::Result<PageStats>
where
    F: Fn(u32, u32) + Send,
    I: Fn(&str, &str, &str) + Send + Sync,
    T: Fn(&str) + Send + Sync,
{
    // Scope the resume cursor by provider + account + folder so multiple accounts
    // (even two of the same provider, or an IMAP "INBOX" vs an M365 inbox) never
    // collide on a folder id.
    let cursor_key = format!("{}\u{1}{}\u{1}{}", provider.kind(), account, folder.id);
    let mut cursor = Cursor::from_token(store.get_cursor(&cursor_key)?);
    let mut total = PageStats::default();
    loop {
        let page = provider.fetch_changes(folder, &cursor).await?;

        // Merge in any deletions this page already reported (Graph/Gmail),
        // plus — only once the folder has caught up to present (`page.done`)
        // — a UID-diff reconciliation for providers with no inline deletion
        // signal (IMAP). Doing this only on the final page of a sync run
        // avoids an extra server round-trip on every intermediate backfill
        // page.
        let mut removed_ids = page.removed_ids.clone();
        if page.done {
            if let Some(current) = provider.current_ids(folder).await? {
                let current_set: std::collections::HashSet<&str> =
                    current.iter().map(|s| s.as_str()).collect();
                let local_ids = store.ids_in_folder(provider.kind(), account, &folder.id)?;
                for local_id in local_ids {
                    if !current_set.contains(local_id.as_str()) && !removed_ids.contains(&local_id)
                    {
                        removed_ids.push(local_id);
                    }
                }
            }
        }

        // P2.3 row 5: run the blocking apply (disk writes + SQLite txn) off the
        // async executor on a multi-threaded runtime so a large sync does not
        // stall other tasks; inline on a current-thread runtime (see run_blocking).
        let s = run_blocking(|| {
            apply_messages_enc(
                store,
                workspace_root,
                &folder.id,
                provider.kind(),
                account,
                matter_id,
                &page.messages,
                &removed_ids,
                key,
                index_callback,
                tombstone_callback,
            )
        })?;
        total.written += s.written;
        total.removed += s.removed;
        emit(total.written, total.removed);
        if let Some(tok) = &page.next {
            store.set_cursor(&cursor_key, tok)?;
        }
        if page.done {
            break;
        }
        cursor = Cursor::from_token(page.next);
    }
    Ok(total)
}

/// Refresh one mailbox folder selected by its human-facing name.
///
/// Mail providers store messages under opaque folder ids (for example a
/// Microsoft Graph id), while the Dropbox screen deliberately asks an advisor
/// for the name they see in their mailbox. Resolving that name here keeps the
/// provider boundary in one place: the selected folder is refreshed first and
/// callers receive the stable id they must use for the local encrypted-store
/// query afterwards.
///
/// A name must identify exactly one folder in an account. Quietly choosing one
/// of two same-named folders could file mail from the wrong place, so ambiguity
/// is an error the advisor can correct by selecting a provider/account.
#[allow(clippy::too_many_arguments)]
pub async fn sync_folder_named_provider<F, I, T>(
    provider: &dyn MailProvider,
    store: &(dyn MailStore + Sync),
    workspace_root: &Path,
    folder_name: &str,
    account: &str,
    matter_id: &str,
    key: &[u8; 32],
    emit: &F,
    index_callback: &I,
    tombstone_callback: &T,
) -> anyhow::Result<RemoteFolder>
where
    F: Fn(u32, u32) + Send,
    I: Fn(&str, &str, &str) + Send + Sync,
    T: Fn(&str) + Send + Sync,
{
    let requested = folder_name.trim();
    anyhow::ensure!(!requested.is_empty(), "mailbox folder name is required");

    let matches: Vec<RemoteFolder> = provider
        .list_folders()
        .await?
        .into_iter()
        .filter(|folder| folder.display_name.trim().eq_ignore_ascii_case(requested))
        .collect();

    match matches.as_slice() {
        [] => anyhow::bail!("no mailbox folder or label named \"{requested}\" was found"),
        [folder] => {
            sync_folder_provider(
                provider,
                store,
                workspace_root,
                folder,
                account,
                matter_id,
                key,
                emit,
                index_callback,
                tombstone_callback,
            )
            .await?;
            Ok(folder.clone())
        }
        _ => anyhow::bail!(
            "more than one mailbox folder or label is named \"{requested}\"; choose its provider or account"
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::mail::store::{MailRecord, MailStore};
    use std::collections::HashMap;
    use std::sync::Mutex;

    #[derive(Default)]
    struct FakeStore {
        msgs: Mutex<HashMap<String, MailRecord>>,
        cursors: Mutex<HashMap<String, String>>,
        // Simulates a mid-page transaction failure (e.g. disk full on commit)
        // so tests can assert nothing downstream of the batch commit runs.
        fail_batch: std::sync::atomic::AtomicBool,
        // Records call order so tests can assert get_message_matter runs AFTER
        // upsert_batch, not before (the deferred-resolution regression test).
        call_log: Mutex<Vec<String>>,
    }
    impl MailStore for FakeStore {
        fn upsert(&self, r: &MailRecord) -> anyhow::Result<()> {
            self.msgs.lock().unwrap().insert(r.id.clone(), r.clone());
            Ok(())
        }
        fn upsert_batch(&self, recs: &[MailRecord]) -> anyhow::Result<()> {
            self.call_log
                .lock()
                .unwrap()
                .push("upsert_batch".to_string());
            if self.fail_batch.load(std::sync::atomic::Ordering::SeqCst) {
                return Err(anyhow::anyhow!("simulated batch commit failure"));
            }
            for r in recs {
                self.upsert(r)?;
            }
            Ok(())
        }
        fn tombstone(&self, id: &str) -> anyhow::Result<Option<String>> {
            Ok(self
                .msgs
                .lock()
                .unwrap()
                .remove(id)
                .map(|r| r.relative_path))
        }
        fn contains(&self, id: &str) -> anyhow::Result<bool> {
            Ok(self.msgs.lock().unwrap().contains_key(id))
        }
        fn get_record(&self, id: &str) -> anyhow::Result<Option<MailRecord>> {
            Ok(self.msgs.lock().unwrap().get(id).cloned())
        }
        fn ids_in_folder(
            &self,
            provider: &str,
            account: &str,
            folder_id: &str,
        ) -> anyhow::Result<Vec<String>> {
            Ok(self
                .msgs
                .lock()
                .unwrap()
                .values()
                .filter(|r| {
                    (provider.is_empty() || r.provider == provider)
                        && (account.is_empty() || r.account == account)
                        && (folder_id.is_empty() || r.folder_id == folder_id)
                })
                .map(|r| r.id.clone())
                .collect())
        }
        fn count(&self) -> anyhow::Result<i64> {
            Ok(self.msgs.lock().unwrap().len() as i64)
        }
        fn get_message_matter(&self, id: &str) -> anyhow::Result<Option<String>> {
            self.call_log
                .lock()
                .unwrap()
                .push(format!("get_message_matter:{id}"));
            Ok(None)
        }
        fn get_cursor(&self, f: &str) -> anyhow::Result<Option<String>> {
            Ok(self.cursors.lock().unwrap().get(f).cloned())
        }
        fn set_cursor(&self, f: &str, c: &str) -> anyhow::Result<()> {
            self.cursors.lock().unwrap().insert(f.into(), c.into());
            Ok(())
        }
        fn list_messages(
            &self,
            _q: &crate::commands::mail::store::MailListQuery,
        ) -> anyhow::Result<crate::commands::mail::store::MailListPage> {
            Ok(crate::commands::mail::store::MailListPage {
                items: vec![],
                total: 0,
            })
        }
    }

    #[test]
    fn apply_page_writes_new_and_removes_tombstoned() {
        let store = FakeStore::default();
        let dir = tempfile::TempDir::new().unwrap();
        let page = serde_json::json!({ "value": [
            { "id":"m1","subject":"A","body":{"contentType":"text","content":"hello"} },
            { "id":"m2","@removed":{"reason":"deleted"} }
        ]});
        // pre-seed m2 so the tombstone has something to remove
        store
            .upsert(&MailRecord {
                id: "m2".into(),
                folder_id: "inbox".into(),
                internet_message_id: None,
                relative_path: "Mail/inbox/m2.md".into(),
                received_date_time: None,
                provider: String::new(),
                account: String::new(),
                subject: String::new(),
                from_addr: String::new(),
                from_name: String::new(),
                snippet: String::new(),
                has_attachments: false,
                thread_id: None,
                auth_result: Default::default(),
                attachment_refs: Vec::new(),
                attachments_unsupported: false,
            })
            .unwrap();
        let stats = apply_page(&store, dir.path(), "inbox", &page).unwrap();
        assert_eq!(stats.written, 1);
        assert_eq!(stats.removed, 1);
        assert!(store.contains("m1").unwrap());
        assert!(!store.contains("m2").unwrap());
        // body file exists on disk
        assert!(dir.path().join("Mail/inbox/m1.md").exists());
    }

    #[test]
    fn apply_page_plaintext_original_still_exists_for_sqlitestore() {
        // Legacy Phase 1 behavior: apply_page writes Mail/*.md artifacts so
        // migration coverage can keep proving those old files are cleaned up.
        // Production sync uses apply_page_enc + EncryptedMailStore.
        let store = FakeStore::default();
        let dir = tempfile::TempDir::new().unwrap();
        let page = serde_json::json!({ "value": [
            { "id":"m1","subject":"A","body":{"contentType":"text","content":"hello"} }
        ]});
        let stats = apply_page(&store, dir.path(), "inbox", &page).unwrap();
        assert_eq!(stats.written, 1);
        assert!(dir.path().join("Mail/inbox/m1.md").exists());
    }

    #[test]
    fn apply_page_enc_writes_blob_not_plaintext_md() {
        let store = FakeStore::default();
        let dir = tempfile::TempDir::new().unwrap();
        let key = [0x42u8; 32];
        let page = serde_json::json!({ "value": [
            { "id":"m1","subject":"Closing","body":{"contentType":"text","content":"See you at 10am."} }
        ]});

        let stats = apply_page_enc(
            &store,
            dir.path(),
            "inbox",
            "m365",
            "default",
            crate::commands::rag::store::UNASSIGNED_MATTER,
            &page,
            &key,
            &|_id: &str, _text: &str, _m: &str| {}, // stub index callback
            &|_id: &str| {},                        // stub tombstone callback
        )
        .unwrap();

        assert_eq!(stats.written, 1);
        // NO plaintext .md anywhere under Mail/
        assert!(
            !dir.path().join("Mail").exists(),
            "plaintext Mail/ dir must NOT exist when apply_page_enc is used"
        );
        // An encrypted blob exists under .lantern/mail/blobs/
        let blob_dir = dir.path().join(format!(
            "{}/mail/blobs",
            crate::identity::WORKSPACE_DATA_DIR
        ));
        let blobs: Vec<_> = std::fs::read_dir(&blob_dir)
            .expect("blobs dir must exist")
            .filter_map(|e| e.ok())
            .filter(|e| e.path().extension().map(|x| x == "enc").unwrap_or(false))
            .collect();
        assert_eq!(blobs.len(), 1, "exactly one .enc blob expected");

        // The blob must decrypt to content that includes the email body.
        let blob_path = blobs[0].path();
        let raw = std::fs::read(&blob_path).unwrap();
        let decrypted = crate::commands::mail::crypto::decrypt_with_key(&raw, &key).unwrap();
        let text = String::from_utf8(decrypted).unwrap();
        assert!(
            text.contains("See you at 10am."),
            "decrypted body must contain original text"
        );
    }

    #[test]
    fn apply_page_enc_tombstone_removes_blob() {
        let store = FakeStore::default();
        let dir = tempfile::TempDir::new().unwrap();
        let key = [0x42u8; 32];

        // Pre-seed: write a blob and register it.
        let blob_rel = {
            let blob_dir = dir.path().join(format!(
                "{}/mail/blobs",
                crate::identity::WORKSPACE_DATA_DIR
            ));
            std::fs::create_dir_all(&blob_dir).unwrap();
            let enc = crate::commands::mail::crypto::encrypt_with_key(b"old body", &key).unwrap();
            std::fs::write(blob_dir.join("m2.enc"), &enc).unwrap();
            ".lantern/mail/blobs/m2.enc".to_string()
        };
        store
            .upsert(&crate::commands::mail::store::MailRecord {
                id: "m2".into(),
                folder_id: "inbox".into(),
                internet_message_id: None,
                relative_path: blob_rel.clone(),
                received_date_time: None,
                provider: "m365".into(),
                account: "default".into(),
                subject: String::new(),
                from_addr: String::new(),
                from_name: String::new(),
                snippet: String::new(),
                has_attachments: false,
                thread_id: None,
                auth_result: Default::default(),
                attachment_refs: Vec::new(),
                attachments_unsupported: false,
            })
            .unwrap();

        let page = serde_json::json!({ "value": [
            { "id":"m2", "@removed": { "reason":"deleted" } }
        ]});
        let tombstoned_ids = std::sync::Arc::new(std::sync::Mutex::new(Vec::<String>::new()));
        let tombstoned_ids2 = tombstoned_ids.clone();
        let stats = apply_page_enc(
            &store,
            dir.path(),
            "inbox",
            "m365",
            "default",
            crate::commands::rag::store::UNASSIGNED_MATTER,
            &page,
            &key,
            &|_id, _text, _m| {},
            &|id: &str| {
                tombstoned_ids2.lock().unwrap().push(id.to_string());
            },
        )
        .unwrap();

        assert_eq!(stats.removed, 1);
        assert!(
            !dir.path().join(&blob_rel).exists(),
            ".enc blob must be deleted"
        );
        assert!(!store.contains("m2").unwrap());
        // S3: tombstone_callback must have been called with the deleted id.
        let ids = tombstoned_ids.lock().unwrap();
        assert_eq!(
            ids.as_slice(),
            &["m2"],
            "tombstone_callback must be called for deleted message"
        );
    }

    #[test]
    fn apply_page_enc_calls_index_callback_with_decrypted_text() {
        let store = FakeStore::default();
        let dir = tempfile::TempDir::new().unwrap();
        let key = [0x42u8; 32];
        let page = serde_json::json!({ "value": [
            { "id":"m3","subject":"Test","body":{"contentType":"text","content":"Index me!"} }
        ]});

        // Use Arc<Mutex<Vec>> to collect from the closure.
        let captured =
            std::sync::Arc::new(std::sync::Mutex::new(Vec::<(String, String, String)>::new()));
        let cap2 = captured.clone();
        apply_page_enc(
            &store,
            dir.path(),
            "inbox",
            "m365",
            "default",
            "matter_acme",
            &page,
            &key,
            &|id: &str, text: &str, matter: &str| {
                cap2.lock()
                    .unwrap()
                    .push((id.to_string(), text.to_string(), matter.to_string()));
            },
            &|_id: &str| {}, // stub tombstone callback
        )
        .unwrap();

        let pairs = captured.lock().unwrap();
        assert_eq!(pairs.len(), 1);
        assert_eq!(pairs[0].0, "m3");
        assert!(
            pairs[0].1.contains("Index me!"),
            "callback receives plaintext"
        );
        // The resolved matter id is forwarded to the index callback at index time.
        assert_eq!(
            pairs[0].2, "matter_acme",
            "callback receives the resolved matter id"
        );
    }

    #[test]
    fn apply_messages_enc_writes_blob_and_indexes() {
        let store = FakeStore::default();
        let dir = tempfile::TempDir::new().unwrap();
        let key = [0x11u8; 32];
        let mut m = crate::commands::mail::model::MailMessage::from_graph(&serde_json::json!({
            "id":"mm1","subject":"Hi","body":{"contentType":"text","content":"hello world"}
        }))
        .unwrap();
        m.account = "acct".into();
        let captured = std::sync::Arc::new(std::sync::Mutex::new(Vec::<String>::new()));
        let cap2 = captured.clone();
        let stats = apply_messages_enc(
            &store,
            dir.path(),
            "inbox",
            "imap",
            "acct",
            crate::commands::rag::store::UNASSIGNED_MATTER,
            &[m],
            &[],
            &key,
            &|id: &str, _t: &str, _m: &str| {
                cap2.lock().unwrap().push(id.to_string());
            },
            &|_id: &str| {},
        )
        .unwrap();
        assert_eq!(stats.written, 1);
        assert!(store.contains("mm1").unwrap());
        assert_eq!(captured.lock().unwrap().as_slice(), &["mm1"]);
        // Provider + account are persisted on the record so it can be mapped to a matter.
        let rec = store.get_record("mm1").unwrap().unwrap();
        assert_eq!(rec.provider, "imap");
        assert_eq!(rec.account, "acct");
    }

    /// Root-cause regression test for the orphaned-searchable-mail bug: the
    /// batched upsert defers the DB commit to one transaction at the end of the
    /// page, but index_callback used to fire per-message BEFORE that commit. A
    /// failed transaction (e.g. disk full) left earlier messages in the RAG/
    /// MiniSearch index with no durable mail record backing them. Nothing may
    /// become searchable before it is durably committed.
    #[test]
    fn apply_messages_enc_does_not_index_when_batch_commit_fails() {
        let store = FakeStore::default();
        store
            .fail_batch
            .store(true, std::sync::atomic::Ordering::SeqCst);
        let dir = tempfile::TempDir::new().unwrap();
        let key = [0x33u8; 32];
        let m = crate::commands::mail::model::MailMessage::from_graph(&serde_json::json!({
            "id":"orphan1","subject":"Hi","body":{"contentType":"text","content":"hello"}
        }))
        .unwrap();
        let indexed = std::sync::Arc::new(std::sync::Mutex::new(Vec::<String>::new()));
        let indexed2 = indexed.clone();

        let result = apply_messages_enc(
            &store,
            dir.path(),
            "inbox",
            "imap",
            "acct",
            crate::commands::rag::store::UNASSIGNED_MATTER,
            &[m],
            &[],
            &key,
            &|id: &str, _t: &str, _m: &str| {
                indexed2.lock().unwrap().push(id.to_string());
            },
            &|_id: &str| {},
        );

        assert!(
            result.is_err(),
            "a failed batch commit must propagate as Err"
        );
        assert!(indexed.lock().unwrap().is_empty(),
            "index_callback must not fire for any message on this page when the batch commit fails — no orphaned searchable mail");
        assert!(
            !store.contains("orphan1").unwrap(),
            "message must not be durably stored either"
        );
    }

    /// Adversarial-review follow-up: deferring index_callback to after the
    /// batch commit is only safe if the matter-override lookup (BUG-013/
    /// BUG-042) is ALSO deferred to that point. Resolving it eagerly while
    /// building `records` (before the — possibly slow — batch commit) would
    /// widen the window for a concurrent "file to matter" to land mid-page and
    /// then get silently overwritten by a stale folder-matter tag once
    /// indexing finally runs. Assert get_message_matter is called only after
    /// upsert_batch, proving the resolution happens at (not before) index time.
    #[test]
    fn apply_messages_enc_resolves_matter_override_after_batch_commit_not_before() {
        let store = FakeStore::default();
        let dir = tempfile::TempDir::new().unwrap();
        let key = [0x44u8; 32];
        let m = crate::commands::mail::model::MailMessage::from_graph(&serde_json::json!({
            "id":"m-order","subject":"Hi","body":{"contentType":"text","content":"hello"}
        }))
        .unwrap();

        apply_messages_enc(
            &store,
            dir.path(),
            "inbox",
            "imap",
            "acct",
            "matter-folder",
            &[m],
            &[],
            &key,
            &|_id: &str, _t: &str, _m: &str| {},
            &|_id: &str| {},
        )
        .unwrap();

        let log = store.call_log.lock().unwrap();
        let batch_pos = log
            .iter()
            .position(|e| e == "upsert_batch")
            .expect("upsert_batch must be called");
        let matter_pos = log
            .iter()
            .position(|e| e == "get_message_matter:m-order")
            .expect("get_message_matter must be called");
        assert!(matter_pos > batch_pos,
            "matter override must be resolved AFTER the batch commit, not while building records — \
             call order was {log:?}");
    }

    #[test]
    fn imap_uid_collision_across_folders_stores_distinct_rows() {
        let store = FakeStore::default();
        let dir = tempfile::TempDir::new().unwrap();
        let key = [0x22u8; 32];
        let mut inbox = crate::commands::mail::model::MailMessage::from_graph(&serde_json::json!({
            "id": crate::commands::mail::imap::imap_message_id("lawyer@example.com", "INBOX", 123, 42),
            "subject": "Inbox copy",
            "body": { "contentType": "text", "content": "body from inbox" }
        })).unwrap();
        let mut sent = crate::commands::mail::model::MailMessage::from_graph(&serde_json::json!({
            "id": crate::commands::mail::imap::imap_message_id("lawyer@example.com", "Sent", 123, 42),
            "subject": "Sent copy",
            "body": { "contentType": "text", "content": "body from sent" }
        })).unwrap();
        inbox.account = "lawyer@example.com".into();
        sent.account = "lawyer@example.com".into();

        apply_messages_enc(
            &store,
            dir.path(),
            "INBOX",
            "imap",
            "lawyer@example.com",
            crate::commands::rag::store::UNASSIGNED_MATTER,
            &[inbox],
            &[],
            &key,
            &|_id, _text, _matter| {},
            &|_id| {},
        )
        .unwrap();
        apply_messages_enc(
            &store,
            dir.path(),
            "Sent",
            "imap",
            "lawyer@example.com",
            crate::commands::rag::store::UNASSIGNED_MATTER,
            &[sent],
            &[],
            &key,
            &|_id, _text, _matter| {},
            &|_id| {},
        )
        .unwrap();

        assert_eq!(
            store.count().unwrap(),
            2,
            "same UID in different folders must store two rows"
        );
    }

    // S3 tests ----------------------------------------------------------------

    /// S3: tombstone_callback must be called for every tombstoned message so
    /// the caller can delete the corresponding LanceDB RAG chunks.
    #[test]
    fn apply_page_enc_tombstone_calls_tombstone_callback() {
        let store = FakeStore::default();
        let dir = tempfile::TempDir::new().unwrap();
        let key = [0x42u8; 32];

        // Pre-seed two messages.
        for id in ["del1", "del2", "kept1"] {
            let blob_dir = dir.path().join(format!(
                "{}/mail/blobs",
                crate::identity::WORKSPACE_DATA_DIR
            ));
            std::fs::create_dir_all(&blob_dir).unwrap();
            let enc = crate::commands::mail::crypto::encrypt_with_key(b"body", &key).unwrap();
            std::fs::write(blob_dir.join(format!("{}.enc", id)), &enc).unwrap();
            store
                .upsert(&crate::commands::mail::store::MailRecord {
                    id: id.to_string(),
                    folder_id: "inbox".into(),
                    internet_message_id: None,
                    relative_path: format!(".lantern/mail/blobs/{}.enc", id),
                    received_date_time: None,
                    provider: "m365".into(),
                    account: "default".into(),
                    subject: String::new(),
                    from_addr: String::new(),
                    from_name: String::new(),
                    snippet: String::new(),
                    has_attachments: false,
                    thread_id: None,
                    auth_result: Default::default(),
                    attachment_refs: Vec::new(),
                    attachments_unsupported: false,
                })
                .unwrap();
        }

        let page = serde_json::json!({ "value": [
            { "id":"del1", "@removed": { "reason":"deleted" } },
            { "id":"del2", "@removed": { "reason":"deleted" } },
            // kept1 is NOT deleted in this page
        ]});

        let tombstoned_ids = std::sync::Arc::new(std::sync::Mutex::new(Vec::<String>::new()));
        let tombstoned_ids2 = tombstoned_ids.clone();
        let stats = apply_page_enc(
            &store,
            dir.path(),
            "inbox",
            "m365",
            "default",
            crate::commands::rag::store::UNASSIGNED_MATTER,
            &page,
            &key,
            &|_id, _text, _m| {},
            &|id: &str| {
                tombstoned_ids2.lock().unwrap().push(id.to_string());
            },
        )
        .unwrap();

        assert_eq!(stats.removed, 2);
        let mut ids = tombstoned_ids.lock().unwrap().clone();
        ids.sort();
        assert_eq!(
            ids,
            vec!["del1", "del2"],
            "tombstone_callback must be called exactly once per deleted message"
        );
        // kept1 was not in the page, so it must not be in the tombstoned set.
        assert!(!ids.contains(&"kept1".to_string()));
    }

    /// S3: tombstone_callback is NOT called for tombstoned ids that were never
    /// in the store (e.g. already-deleted messages re-delivered by Graph delta).
    #[test]
    fn apply_page_enc_tombstone_callback_only_for_known_ids() {
        let store = FakeStore::default();
        let dir = tempfile::TempDir::new().unwrap();
        let key = [0x55u8; 32];
        // "unknown" is not in the store — tombstone returns None.
        let page = serde_json::json!({ "value": [
            { "id":"unknown", "@removed": { "reason":"deleted" } }
        ]});

        let tombstoned_ids = std::sync::Arc::new(std::sync::Mutex::new(Vec::<String>::new()));
        let tombstoned_ids2 = tombstoned_ids.clone();
        let stats = apply_page_enc(
            &store,
            dir.path(),
            "inbox",
            "m365",
            "default",
            crate::commands::rag::store::UNASSIGNED_MATTER,
            &page,
            &key,
            &|_id, _text, _m| {},
            &|id: &str| {
                tombstoned_ids2.lock().unwrap().push(id.to_string());
            },
        )
        .unwrap();

        assert_eq!(
            stats.removed, 0,
            "removed count must be 0 when the tombstoned id is not in the store"
        );
        assert!(
            tombstoned_ids.lock().unwrap().is_empty(),
            "tombstone_callback must NOT be called for ids not in the store"
        );
    }

    #[test]
    fn migrate_plaintext_mail_deletes_mail_directory() {
        let dir = tempfile::TempDir::new().unwrap();
        // Simulate a Phase-1 workspace with plaintext mail.
        let mail_dir = dir.path().join("Mail").join("inbox");
        std::fs::create_dir_all(&mail_dir).unwrap();
        std::fs::write(mail_dir.join("m1.md"), "---\nmessage_id: m1\n---\n\nHello").unwrap();
        assert!(dir.path().join("Mail").exists());

        migrate_plaintext(dir.path());

        assert!(
            !dir.path().join("Mail").exists(),
            "Mail/ directory must be deleted by migration"
        );
    }

    #[test]
    fn migrate_plaintext_is_noop_when_mail_dir_absent() {
        let dir = tempfile::TempDir::new().unwrap();
        // No Mail/ directory — should not panic or error.
        assert!(!dir.path().join("Mail").exists());
        migrate_plaintext(dir.path()); // must not panic
        assert!(!dir.path().join("Mail").exists());
    }

    #[test]
    fn migrate_plaintext_does_not_delete_encrypted_blobs() {
        let dir = tempfile::TempDir::new().unwrap();
        // Create Mail/ plaintext dir AND .lantern/mail/blobs/ encrypted dir.
        let mail_dir = dir.path().join("Mail").join("inbox");
        std::fs::create_dir_all(&mail_dir).unwrap();
        std::fs::write(mail_dir.join("m1.md"), "hello").unwrap();
        let enc_dir = dir.path().join(".lantern").join("mail").join("blobs");
        std::fs::create_dir_all(&enc_dir).unwrap();
        std::fs::write(enc_dir.join("m1.enc"), b"fake-encrypted-blob").unwrap();

        migrate_plaintext(dir.path());

        // Mail/ plaintext must be gone.
        assert!(!dir.path().join("Mail").exists(), "Mail/ must be deleted");
        // Encrypted blobs must remain untouched.
        assert!(
            dir.path().join(".lantern/mail/blobs/m1.enc").exists(),
            ".enc blob must not be deleted by migration"
        );
    }

    // S1 tests ----------------------------------------------------------------

    /// S1: migration must also delete the plaintext Phase-1 metadata DB (mail.db).
    #[test]
    fn migrate_plaintext_deletes_mail_db() {
        let dir = tempfile::TempDir::new().unwrap();
        // Simulate Phase-1 workspace: Mail/ dir + plaintext mail.db.
        let mail_dir = dir.path().join("Mail").join("inbox");
        std::fs::create_dir_all(&mail_dir).unwrap();
        std::fs::write(mail_dir.join("m1.md"), "hello").unwrap();
        let lantern_dir = dir.path().join(".lantern");
        std::fs::create_dir_all(&lantern_dir).unwrap();
        std::fs::write(lantern_dir.join("mail.db"), b"SQLite format 3\0...").unwrap();
        assert!(dir.path().join(".lantern/mail.db").exists());

        migrate_plaintext(dir.path());

        // mail.db must be removed.
        assert!(
            !dir.path().join(".lantern/mail.db").exists(),
            "mail.db must be deleted by migration"
        );
    }

    /// S1: migration must remove mail.db even when Mail/ dir is absent.
    #[test]
    fn migrate_plaintext_deletes_mail_db_even_without_mail_dir() {
        let dir = tempfile::TempDir::new().unwrap();
        // No Mail/ dir, but mail.db exists (partial cleanup scenario).
        let lantern_dir = dir.path().join(".lantern");
        std::fs::create_dir_all(&lantern_dir).unwrap();
        std::fs::write(lantern_dir.join("mail.db"), b"SQLite format 3\0...").unwrap();

        migrate_plaintext(dir.path());

        assert!(
            !dir.path().join(".lantern/mail.db").exists(),
            "mail.db must be deleted even when Mail/ is absent"
        );
    }

    /// S1: migration must NOT touch the encrypted database (mail-enc.db) or
    /// encrypted blobs (.lantern/mail/blobs/). Only Mail/ and mail.db are Phase-1
    /// plaintext artifacts.
    #[test]
    fn migrate_plaintext_preserves_encrypted_db_and_blobs() {
        let dir = tempfile::TempDir::new().unwrap();
        // Simulate a fully-migrated workspace: mail-enc.db + blobs present, plus
        // leftover plaintext Mail/ and mail.db from Phase 1.
        let mail_dir = dir.path().join("Mail");
        std::fs::create_dir_all(&mail_dir).unwrap();
        std::fs::write(mail_dir.join("m1.md"), "hello").unwrap();
        let lantern_dir = dir.path().join(".lantern");
        std::fs::create_dir_all(&lantern_dir).unwrap();
        std::fs::write(lantern_dir.join("mail.db"), b"SQLite format 3\0...").unwrap();
        std::fs::write(lantern_dir.join("mail-enc.db"), b"SQLCipher DB").unwrap();
        let blobs_dir = lantern_dir.join("mail").join("blobs");
        std::fs::create_dir_all(&blobs_dir).unwrap();
        std::fs::write(blobs_dir.join("m1.enc"), b"ciphertext").unwrap();

        migrate_plaintext(dir.path());

        // Plaintext artifacts removed.
        assert!(!dir.path().join("Mail").exists(), "Mail/ must be deleted");
        assert!(
            !dir.path().join(".lantern/mail.db").exists(),
            "mail.db must be deleted"
        );
        // Encrypted artifacts preserved.
        assert!(
            dir.path().join(".lantern/mail-enc.db").exists(),
            "mail-enc.db must NOT be deleted"
        );
        assert!(
            dir.path().join(".lantern/mail/blobs/m1.enc").exists(),
            ".enc blobs must NOT be deleted"
        );
    }

    /// S1: migration must NEVER touch anything outside the given workspace_root.
    /// This is enforced by construction (only workspace-relative joins are used)
    /// but we explicitly verify the outer tempdir sibling is untouched.
    #[test]
    fn migrate_plaintext_never_touches_outside_workspace() {
        let outer = tempfile::TempDir::new().unwrap();
        let workspace = outer.path().join("workspace");
        let sibling = outer.path().join("sibling-data");
        std::fs::create_dir_all(&workspace).unwrap();
        std::fs::create_dir_all(&sibling).unwrap();
        // Put a sentinel file in the sibling directory.
        std::fs::write(sibling.join("secret.txt"), b"do not touch").unwrap();
        // Also create the Phase-1 artifacts inside the workspace.
        let mail_dir = workspace.join("Mail");
        std::fs::create_dir_all(&mail_dir).unwrap();
        std::fs::write(mail_dir.join("m1.md"), "hello").unwrap();
        let lantern_dir = workspace.join(".lantern");
        std::fs::create_dir_all(&lantern_dir).unwrap();
        std::fs::write(lantern_dir.join("mail.db"), b"SQLite format 3\0...").unwrap();

        migrate_plaintext(&workspace);

        // Workspace plaintext must be gone.
        assert!(!workspace.join("Mail").exists());
        assert!(!workspace.join(".lantern/mail.db").exists());
        // Sibling data must be completely untouched.
        assert!(
            sibling.join("secret.txt").exists(),
            "migration must never delete files outside the workspace"
        );
    }

    #[test]
    fn malicious_folder_id_cannot_escape_workspace() {
        // folder_id comes from Microsoft Graph (untrusted). A path-traversal
        // attempt must be neutralized by safe_filename, not written outside root.
        let store = FakeStore::default();
        let dir = tempfile::TempDir::new().unwrap();
        let page = serde_json::json!({ "value": [
            { "id":"m1","subject":"A","body":{"contentType":"text","content":"hi"} }
        ]});
        apply_page(&store, dir.path(), "../../etc", &page).unwrap();
        // "../../etc" sanitizes to "______etc" — the file lands INSIDE the workspace.
        assert!(dir.path().join("Mail/______etc/m1.md").exists());
        // The literal traversal path was never created (no escape).
        assert!(!dir.path().join("Mail/../../etc/m1.md").exists());
    }

    #[tokio::test]
    async fn sync_folder_gives_up_after_repeated_410() {
        // A server stuck on 410 must terminate the folder sync (bounded by
        // MAX_DELTA_RESETS), not loop forever.
        use crate::commands::mail::graph::GraphClient;
        use wiremock::matchers::method;
        use wiremock::{Mock, MockServer, ResponseTemplate};

        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .respond_with(ResponseTemplate::new(410).set_body_string("Sync state not found"))
            .mount(&server)
            .await;

        let client = GraphClient::new_with_base("AT".into(), server.uri());
        let store = FakeStore::default();
        let dir = tempfile::TempDir::new().unwrap();
        let res = sync_folder(&client, &store, dir.path(), "inbox", &|_w, _r| {}).await;
        assert!(
            res.is_err(),
            "repeated 410 must error out, not spin forever"
        );
    }

    // ── F1: sync_folder_provider deletion-diff reconciliation ────────────────
    //
    // A fake `MailProvider` whose `fetch_changes` never reports removed_ids
    // (matching IMAP, which has no delta/history token) but whose
    // `current_ids` reports the server-side UID set. `sync_folder_provider`
    // must diff that against locally-known ids (once the page is `done`) and
    // tombstone anything missing, reusing the same path Graph/Gmail use.

    struct FakeProvider {
        kind: &'static str,
        pages: Mutex<std::collections::VecDeque<ChangePage>>,
        current_ids_result: Option<Vec<String>>,
    }

    #[async_trait::async_trait]
    impl MailProvider for FakeProvider {
        fn kind(&self) -> &'static str {
            self.kind
        }
        async fn list_folders(&self) -> anyhow::Result<Vec<RemoteFolder>> {
            Ok(vec![])
        }
        async fn fetch_changes(
            &self,
            _folder: &RemoteFolder,
            _cursor: &Cursor,
        ) -> anyhow::Result<ChangePage> {
            Ok(self
                .pages
                .lock()
                .unwrap()
                .pop_front()
                .expect("FakeProvider: no more pages queued"))
        }
        async fn current_ids(&self, _folder: &RemoteFolder) -> anyhow::Result<Option<Vec<String>>> {
            Ok(self.current_ids_result.clone())
        }
    }

    /// A small mailbox-server double for the Dropbox boundary. It deliberately
    /// exposes a visible folder name and a different opaque provider id — the
    /// exact shape Microsoft Graph returns in production.
    struct DropboxProvider {
        folders: Vec<RemoteFolder>,
        fetched_folder_ids: Mutex<Vec<String>>,
        page: Mutex<Option<ChangePage>>,
    }

    #[async_trait::async_trait]
    impl MailProvider for DropboxProvider {
        fn kind(&self) -> &'static str {
            "m365"
        }
        async fn list_folders(&self) -> anyhow::Result<Vec<RemoteFolder>> {
            Ok(self.folders.clone())
        }
        async fn fetch_changes(
            &self,
            folder: &RemoteFolder,
            _cursor: &Cursor,
        ) -> anyhow::Result<ChangePage> {
            self.fetched_folder_ids
                .lock()
                .unwrap()
                .push(folder.id.clone());
            self.page
                .lock()
                .unwrap()
                .take()
                .ok_or_else(|| anyhow::anyhow!("no page queued"))
        }
    }

    /// Regression for the live Dropbox failure: the advisor typed a visible
    /// name ("Lantern"), but the mail store uses the opaque provider id. The
    /// named-folder seam must resolve that id AND perform a real refresh before
    /// the caller queries local encrypted metadata.
    #[tokio::test]
    async fn dropbox_named_folder_refreshes_the_opaque_provider_folder_id() {
        let store = FakeStore::default();
        let provider = DropboxProvider {
            folders: vec![RemoteFolder {
                id: "AAMkAGVmMDEyLXRlc3QtZm9sZGVy".into(),
                display_name: "Lantern".into(),
            }],
            fetched_folder_ids: Mutex::new(Vec::new()),
            page: Mutex::new(Some(ChangePage {
                messages: vec![MailMessage::from_graph(&serde_json::json!({
                    "id": "real-email-waiting",
                    "subject": "Chen — statement question",
                    "receivedDateTime": "2026-07-13T20:00:00Z",
                    "body": { "contentType": "text", "content": "Please call me." }
                }))
                .unwrap()],
                removed_ids: vec![],
                next: Some("opaque-delta-token".into()),
                done: true,
            })),
        };
        let dir = tempfile::TempDir::new().unwrap();
        let key = [0x61; 32];

        let resolved = sync_folder_named_provider(
            &provider,
            &store,
            dir.path(),
            "Lantern",
            "default",
            crate::commands::rag::store::UNASSIGNED_MATTER,
            &key,
            &|_written, _removed| {},
            &|_id, _text, _matter| {},
            &|_id| {},
        )
        .await
        .expect("visible folder name should refresh its provider folder");

        assert_eq!(resolved.id, "AAMkAGVmMDEyLXRlc3QtZm9sZGVy");
        assert_eq!(
            provider.fetched_folder_ids.lock().unwrap().as_slice(),
            &[resolved.id.clone()]
        );
        let record = store
            .get_record("real-email-waiting")
            .unwrap()
            .expect("refreshed email must be stored");
        assert_eq!(
            record.folder_id, resolved.id,
            "the local query key is the provider id, not the visible name"
        );
    }

    fn seed_record(store: &FakeStore, id: &str, provider: &str, account: &str, folder_id: &str) {
        store
            .upsert(&MailRecord {
                id: id.to_string(),
                folder_id: folder_id.to_string(),
                internet_message_id: None,
                relative_path: format!(".lantern/mail/blobs/{id}.enc"),
                received_date_time: None,
                provider: provider.to_string(),
                account: account.to_string(),
                subject: String::new(),
                from_addr: String::new(),
                from_name: String::new(),
                snippet: String::new(),
                has_attachments: false,
                thread_id: None,
                auth_result: Default::default(),
                attachment_refs: Vec::new(),
                attachments_unsupported: false,
            })
            .unwrap();
    }

    #[tokio::test]
    async fn sync_folder_provider_tombstones_ids_missing_from_current_ids() {
        let store = FakeStore::default();
        seed_record(&store, "imap:acct:id1", "imap", "acct", "INBOX");
        seed_record(&store, "imap:acct:id2", "imap", "acct", "INBOX");

        let provider = FakeProvider {
            kind: "imap",
            pages: Mutex::new(std::collections::VecDeque::from([ChangePage {
                messages: vec![],
                removed_ids: vec![],
                next: Some("42:100".into()),
                done: true,
            }])),
            // Server only reports id1 -> id2 was deleted/expunged server-side.
            current_ids_result: Some(vec!["imap:acct:id1".to_string()]),
        };

        let dir = tempfile::TempDir::new().unwrap();
        let folder = RemoteFolder {
            id: "INBOX".into(),
            display_name: "INBOX".into(),
        };
        let key = [0x77u8; 32];
        let tombstoned = std::sync::Arc::new(Mutex::new(Vec::<String>::new()));
        let tombstoned2 = tombstoned.clone();

        let stats = sync_folder_provider(
            &provider,
            &store,
            dir.path(),
            &folder,
            "acct",
            crate::commands::rag::store::UNASSIGNED_MATTER,
            &key,
            &|_w, _r| {},
            &|_id, _text, _m| {},
            &|id: &str| {
                tombstoned2.lock().unwrap().push(id.to_string());
            },
        )
        .await
        .unwrap();

        assert_eq!(
            stats.removed, 1,
            "id2 must be tombstoned via the UID-diff reconciliation"
        );
        assert!(
            store.contains("imap:acct:id1").unwrap(),
            "id1 (still on server) must survive"
        );
        assert!(
            !store.contains("imap:acct:id2").unwrap(),
            "id2 (missing on server) must be removed"
        );
        assert_eq!(
            tombstoned.lock().unwrap().as_slice(),
            &["imap:acct:id2".to_string()]
        );
    }

    #[tokio::test]
    async fn sync_folder_provider_current_ids_none_does_not_reconcile() {
        // Graph/Gmail-style providers: current_ids defaults to None, so no
        // extra reconciliation happens beyond page.removed_ids.
        let store = FakeStore::default();
        seed_record(&store, "imap:acct:id1", "imap", "acct", "INBOX");
        seed_record(&store, "imap:acct:id2", "imap", "acct", "INBOX");

        let provider = FakeProvider {
            kind: "imap",
            pages: Mutex::new(std::collections::VecDeque::from([ChangePage {
                messages: vec![],
                removed_ids: vec![],
                next: Some("42:100".into()),
                done: true,
            }])),
            current_ids_result: None,
        };

        let dir = tempfile::TempDir::new().unwrap();
        let folder = RemoteFolder {
            id: "INBOX".into(),
            display_name: "INBOX".into(),
        };
        let key = [0x77u8; 32];

        let stats = sync_folder_provider(
            &provider,
            &store,
            dir.path(),
            &folder,
            "acct",
            crate::commands::rag::store::UNASSIGNED_MATTER,
            &key,
            &|_w, _r| {},
            &|_id, _text, _m| {},
            &|_id: &str| {},
        )
        .await
        .unwrap();

        assert_eq!(
            stats.removed, 0,
            "no reconciliation must happen when current_ids returns None"
        );
        assert!(store.contains("imap:acct:id1").unwrap());
        assert!(store.contains("imap:acct:id2").unwrap());
    }
}
