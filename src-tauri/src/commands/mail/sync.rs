use crate::commands::mail::crypto::encrypt_with_key;
use crate::commands::mail::graph::{page_continuation, Continuation, DeltaGone, GraphClient};
use crate::commands::mail::model::MailMessage;
use crate::commands::mail::normalize::to_markdown;
use crate::commands::mail::store::{MailRecord, MailStore};
use std::path::Path;

#[derive(Debug, Default, PartialEq)]
pub struct PageStats { pub written: u32, pub removed: u32 }

fn safe_filename(id: &str) -> String {
    id.chars().map(|c| if c.is_ascii_alphanumeric() { c } else { '_' }).collect()
}

/// Apply one delta page to the store + disk. Idempotent: replays are harmless
/// because upsert is by id and tombstone is a no-op when absent.
pub fn apply_page(store: &dyn MailStore, workspace_root: &Path, folder_id: &str,
                  page: &serde_json::Value) -> anyhow::Result<PageStats> {
    let mut stats = PageStats::default();
    let items = page.get("value").and_then(|v| v.as_array()).cloned().unwrap_or_default();
    for item in &items {
        let id = item.get("id").and_then(|s| s.as_str()).unwrap_or("");
        if id.is_empty() { continue; }
        if MailMessage::is_removed(item) {
            if let Some(rel) = store.tombstone(id)? {
                let _ = std::fs::remove_file(workspace_root.join(&rel));
                stats.removed += 1;
            }
            continue;
        }
        if let Some(msg) = MailMessage::from_graph(item) {
            // Sanitize BOTH path segments. folder_id and msg.id both come from
            // Microsoft Graph (untrusted). safe_filename is an allowlist (only
            // ASCII alphanumerics survive), so "../" / path separators can never
            // escape the workspace, regardless of what Graph returns.
            let rel = format!("Mail/{}/{}.md", safe_filename(folder_id), safe_filename(&msg.id));
            let abs = workspace_root.join(&rel);
            if let Some(p) = abs.parent() { std::fs::create_dir_all(p)?; }
            std::fs::write(&abs, to_markdown(&msg))?;
            store.upsert(&MailRecord {
                id: msg.id.clone(), folder_id: folder_id.to_string(),
                internet_message_id: msg.internet_message_id.clone(),
                relative_path: rel, received_date_time: msg.received_date_time.clone(),
            })?;
            stats.written += 1;
        }
    }
    Ok(stats)
}

/// Encrypted variant of apply_page.
///
/// Differences from `apply_page`:
///   - Does NOT write Mail/*.md plaintext files.
///   - Writes each message body as an AES-256-GCM blob under
///     `.keepance/mail/blobs/<safe-id>.enc` using `key`.
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
pub fn apply_page_enc<F, T>(
    store: &dyn MailStore,
    workspace_root: &Path,
    folder_id: &str,
    page: &serde_json::Value,
    key: &[u8; 32],
    index_callback: &F,
    tombstone_callback: &T,
) -> anyhow::Result<PageStats>
where
    F: Fn(&str, &str),
    T: Fn(&str),
{
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
                // Delete the encrypted blob (relative path points to .enc file).
                let _ = std::fs::remove_file(workspace_root.join(&rel));
                // S3: delete the RAG chunks for this mail id so deleted email
                // stops surfacing in rag_retrieve. The callback is fire-and-forget
                // (spawned as a tokio task by the caller).
                tombstone_callback(id);
                stats.removed += 1;
            }
            continue;
        }

        if let Some(msg) = MailMessage::from_graph(item) {
            let markdown = to_markdown(&msg);

            // Encrypt the markdown and write the blob.
            let blob_dir = workspace_root
                .join(".keepance")
                .join("mail")
                .join("blobs");
            std::fs::create_dir_all(&blob_dir)?;
            let safe = safe_filename(&msg.id);
            let blob_filename = format!("{}.enc", safe);
            let blob_abs = blob_dir.join(&blob_filename);
            let encrypted = encrypt_with_key(markdown.as_bytes(), key)?;
            std::fs::write(&blob_abs, &encrypted)?;

            let rel = format!(".keepance/mail/blobs/{}", blob_filename);
            store.upsert(&MailRecord {
                id: msg.id.clone(),
                folder_id: folder_id.to_string(),
                internet_message_id: msg.internet_message_id.clone(),
                relative_path: rel,
                received_date_time: msg.received_date_time.clone(),
            })?;

            // Feed decrypted text to the in-memory indexer (RAG + keyword).
            // This is the ONLY place the plaintext exists — never written to disk.
            index_callback(&msg.id, &markdown);

            stats.written += 1;
        }
    }
    Ok(stats)
}

/// G7: Migration — remove the plaintext `Mail/` directory written by Phase 1.
///
/// Called once at the start of `mail_sync_all`. If a plaintext `Mail/` directory
/// from Phase 1 exists under `workspace_root`, it is deleted entirely. The next
/// sync will re-download and import all messages as encrypted blobs under
/// `.keepance/mail/blobs/*.enc`. This is safe because:
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
    let mail_db = workspace_root.join(".keepance").join("mail.db");
    let _ = std::fs::remove_file(&mail_db);
}

/// Drive one folder to completion, persisting the cursor after each page.
/// `emit` is a callback so the command layer can fire Tauri progress events
/// and the test can pass a no-op.
pub async fn sync_folder<F: Fn(u32, u32) + Send>(
    client: &GraphClient, store: &(dyn MailStore + Sync), workspace_root: &Path,
    folder_id: &str, emit: &F,
) -> anyhow::Result<PageStats> {
    let mut url = match store.get_cursor(folder_id)? {
        Some(saved) => saved,                       // resume (deltaLink or interrupted nextLink)
        None => client.delta_start_url(folder_id),  // fresh backfill
    };
    let mut total = PageStats::default();
    loop {
        let page = match client.get_json(&url).await {
            Ok(p) => p,
            Err(e) if e.downcast_ref::<DeltaGone>().is_some() => {
                // Delta token expired (410): discard cursor, restart this folder from scratch.
                store.set_cursor(folder_id, &client.delta_start_url(folder_id))?;
                url = client.delta_start_url(folder_id);
                continue;
            }
            Err(e) => return Err(e),
        };
        let s = apply_page(store, workspace_root, folder_id, &page)?;
        total.written += s.written; total.removed += s.removed;
        emit(total.written, total.removed);
        match page_continuation(&page) {
            Continuation::Next(next) => { store.set_cursor(folder_id, &next)?; url = next; }
            Continuation::Delta(delta) => { store.set_cursor(folder_id, &delta)?; break; }
            Continuation::End => break,
        }
    }
    Ok(total)
}

/// Encrypted variant of sync_folder. Uses apply_page_enc instead of apply_page.
/// `index_callback` receives (doc_id, plaintext_markdown) for each new message —
/// the caller feeds this to the RAG indexer and MiniSearch without persisting it.
/// `tombstone_callback` receives (doc_id) for each tombstoned message — the
/// caller spawns an async task to delete the corresponding LanceDB RAG chunks (S3).
pub async fn sync_folder_enc<F, I, T>(
    client: &GraphClient,
    store: &(dyn MailStore + Sync),
    workspace_root: &Path,
    folder_id: &str,
    key: &[u8; 32],
    emit: &F,
    index_callback: &I,
    tombstone_callback: &T,
) -> anyhow::Result<PageStats>
where
    F: Fn(u32, u32) + Send,
    I: Fn(&str, &str) + Send + Sync,
    T: Fn(&str) + Send + Sync,
{
    let mut url = match store.get_cursor(folder_id)? {
        Some(saved) => saved,
        None => client.delta_start_url(folder_id),
    };
    let mut total = PageStats::default();
    loop {
        let page = match client.get_json(&url).await {
            Ok(p) => p,
            Err(e) if e.downcast_ref::<DeltaGone>().is_some() => {
                store.set_cursor(folder_id, &client.delta_start_url(folder_id))?;
                url = client.delta_start_url(folder_id);
                continue;
            }
            Err(e) => return Err(e),
        };
        let s = apply_page_enc(store, workspace_root, folder_id, &page, key, index_callback, tombstone_callback)?;
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::mail::store::{MailRecord, MailStore};
    use std::sync::Mutex;
    use std::collections::HashMap;

    #[derive(Default)]
    struct FakeStore { msgs: Mutex<HashMap<String,String>>, cursors: Mutex<HashMap<String,String>> }
    impl MailStore for FakeStore {
        fn upsert(&self, r:&MailRecord)->anyhow::Result<()> { self.msgs.lock().unwrap().insert(r.id.clone(), r.relative_path.clone()); Ok(()) }
        fn tombstone(&self, id:&str)->anyhow::Result<Option<String>> { Ok(self.msgs.lock().unwrap().remove(id)) }
        fn contains(&self, id:&str)->anyhow::Result<bool> { Ok(self.msgs.lock().unwrap().contains_key(id)) }
        fn count(&self)->anyhow::Result<i64> { Ok(self.msgs.lock().unwrap().len() as i64) }
        fn get_cursor(&self, f:&str)->anyhow::Result<Option<String>> { Ok(self.cursors.lock().unwrap().get(f).cloned()) }
        fn set_cursor(&self, f:&str, c:&str)->anyhow::Result<()> { self.cursors.lock().unwrap().insert(f.into(), c.into()); Ok(()) }
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
        store.upsert(&MailRecord{ id:"m2".into(), folder_id:"inbox".into(), internet_message_id:None,
            relative_path:"Mail/inbox/m2.md".into(), received_date_time:None}).unwrap();
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
        // The original Phase 1 behavior: SqliteMailStore + apply_page (not enc)
        // still writes Mail/*.md plaintext. This test guards against accidentally
        // removing the non-encrypted path. The encrypted path (apply_page_enc)
        // is tested separately above.
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
            &page,
            &key,
            &|_id: &str, _text: &str| {}, // stub index callback
            &|_id: &str| {},               // stub tombstone callback
        ).unwrap();

        assert_eq!(stats.written, 1);
        // NO plaintext .md anywhere under Mail/
        assert!(!dir.path().join("Mail").exists(),
            "plaintext Mail/ dir must NOT exist when apply_page_enc is used");
        // An encrypted blob exists under .keepance/mail/blobs/
        let blob_dir = dir.path().join(".keepance/mail/blobs");
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
        assert!(text.contains("See you at 10am."), "decrypted body must contain original text");
    }

    #[test]
    fn apply_page_enc_tombstone_removes_blob() {
        let store = FakeStore::default();
        let dir = tempfile::TempDir::new().unwrap();
        let key = [0x42u8; 32];

        // Pre-seed: write a blob and register it.
        let blob_rel = {
            let blob_dir = dir.path().join(".keepance/mail/blobs");
            std::fs::create_dir_all(&blob_dir).unwrap();
            let enc = crate::commands::mail::crypto::encrypt_with_key(b"old body", &key).unwrap();
            std::fs::write(blob_dir.join("m2.enc"), &enc).unwrap();
            ".keepance/mail/blobs/m2.enc".to_string()
        };
        store.upsert(&crate::commands::mail::store::MailRecord {
            id: "m2".into(), folder_id: "inbox".into(),
            internet_message_id: None,
            relative_path: blob_rel.clone(),
            received_date_time: None,
        }).unwrap();

        let page = serde_json::json!({ "value": [
            { "id":"m2", "@removed": { "reason":"deleted" } }
        ]});
        let tombstoned_ids = std::sync::Arc::new(std::sync::Mutex::new(Vec::<String>::new()));
        let tombstoned_ids2 = tombstoned_ids.clone();
        let stats = apply_page_enc(
            &store, dir.path(), "inbox", &page, &key,
            &|_id, _text| {},
            &|id: &str| { tombstoned_ids2.lock().unwrap().push(id.to_string()); },
        ).unwrap();

        assert_eq!(stats.removed, 1);
        assert!(!dir.path().join(&blob_rel).exists(), ".enc blob must be deleted");
        assert!(!store.contains("m2").unwrap());
        // S3: tombstone_callback must have been called with the deleted id.
        let ids = tombstoned_ids.lock().unwrap();
        assert_eq!(ids.as_slice(), &["m2"], "tombstone_callback must be called for deleted message");
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
        let captured = std::sync::Arc::new(std::sync::Mutex::new(Vec::<(String, String)>::new()));
        let cap2 = captured.clone();
        apply_page_enc(
            &store, dir.path(), "inbox", &page, &key,
            &|id: &str, text: &str| {
                cap2.lock().unwrap().push((id.to_string(), text.to_string()));
            },
            &|_id: &str| {}, // stub tombstone callback
        ).unwrap();

        let pairs = captured.lock().unwrap();
        assert_eq!(pairs.len(), 1);
        assert_eq!(pairs[0].0, "m3");
        assert!(pairs[0].1.contains("Index me!"), "callback receives plaintext");
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
            let blob_dir = dir.path().join(".keepance/mail/blobs");
            std::fs::create_dir_all(&blob_dir).unwrap();
            let enc = crate::commands::mail::crypto::encrypt_with_key(b"body", &key).unwrap();
            std::fs::write(blob_dir.join(format!("{}.enc", id)), &enc).unwrap();
            store.upsert(&crate::commands::mail::store::MailRecord {
                id: id.to_string(), folder_id: "inbox".into(),
                internet_message_id: None,
                relative_path: format!(".keepance/mail/blobs/{}.enc", id),
                received_date_time: None,
            }).unwrap();
        }

        let page = serde_json::json!({ "value": [
            { "id":"del1", "@removed": { "reason":"deleted" } },
            { "id":"del2", "@removed": { "reason":"deleted" } },
            // kept1 is NOT deleted in this page
        ]});

        let tombstoned_ids = std::sync::Arc::new(std::sync::Mutex::new(Vec::<String>::new()));
        let tombstoned_ids2 = tombstoned_ids.clone();
        let stats = apply_page_enc(
            &store, dir.path(), "inbox", &page, &key,
            &|_id, _text| {},
            &|id: &str| { tombstoned_ids2.lock().unwrap().push(id.to_string()); },
        ).unwrap();

        assert_eq!(stats.removed, 2);
        let mut ids = tombstoned_ids.lock().unwrap().clone();
        ids.sort();
        assert_eq!(ids, vec!["del1", "del2"],
            "tombstone_callback must be called exactly once per deleted message");
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
            &store, dir.path(), "inbox", &page, &key,
            &|_id, _text| {},
            &|id: &str| { tombstoned_ids2.lock().unwrap().push(id.to_string()); },
        ).unwrap();

        assert_eq!(stats.removed, 0,
            "removed count must be 0 when the tombstoned id is not in the store");
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
        // Create Mail/ plaintext dir AND .keepance/mail/blobs/ encrypted dir.
        let mail_dir = dir.path().join("Mail").join("inbox");
        std::fs::create_dir_all(&mail_dir).unwrap();
        std::fs::write(mail_dir.join("m1.md"), "hello").unwrap();
        let enc_dir = dir.path().join(".keepance").join("mail").join("blobs");
        std::fs::create_dir_all(&enc_dir).unwrap();
        std::fs::write(enc_dir.join("m1.enc"), b"fake-encrypted-blob").unwrap();

        migrate_plaintext(dir.path());

        // Mail/ plaintext must be gone.
        assert!(!dir.path().join("Mail").exists(), "Mail/ must be deleted");
        // Encrypted blobs must remain untouched.
        assert!(
            dir.path().join(".keepance/mail/blobs/m1.enc").exists(),
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
        let keepance_dir = dir.path().join(".keepance");
        std::fs::create_dir_all(&keepance_dir).unwrap();
        std::fs::write(keepance_dir.join("mail.db"), b"SQLite format 3\0...").unwrap();
        assert!(dir.path().join(".keepance/mail.db").exists());

        migrate_plaintext(dir.path());

        // mail.db must be removed.
        assert!(
            !dir.path().join(".keepance/mail.db").exists(),
            "mail.db must be deleted by migration"
        );
    }

    /// S1: migration must remove mail.db even when Mail/ dir is absent.
    #[test]
    fn migrate_plaintext_deletes_mail_db_even_without_mail_dir() {
        let dir = tempfile::TempDir::new().unwrap();
        // No Mail/ dir, but mail.db exists (partial cleanup scenario).
        let keepance_dir = dir.path().join(".keepance");
        std::fs::create_dir_all(&keepance_dir).unwrap();
        std::fs::write(keepance_dir.join("mail.db"), b"SQLite format 3\0...").unwrap();

        migrate_plaintext(dir.path());

        assert!(
            !dir.path().join(".keepance/mail.db").exists(),
            "mail.db must be deleted even when Mail/ is absent"
        );
    }

    /// S1: migration must NOT touch the encrypted database (mail-enc.db) or
    /// encrypted blobs (.keepance/mail/blobs/). Only Mail/ and mail.db are Phase-1
    /// plaintext artifacts.
    #[test]
    fn migrate_plaintext_preserves_encrypted_db_and_blobs() {
        let dir = tempfile::TempDir::new().unwrap();
        // Simulate a fully-migrated workspace: mail-enc.db + blobs present, plus
        // leftover plaintext Mail/ and mail.db from Phase 1.
        let mail_dir = dir.path().join("Mail");
        std::fs::create_dir_all(&mail_dir).unwrap();
        std::fs::write(mail_dir.join("m1.md"), "hello").unwrap();
        let keepance_dir = dir.path().join(".keepance");
        std::fs::create_dir_all(&keepance_dir).unwrap();
        std::fs::write(keepance_dir.join("mail.db"), b"SQLite format 3\0...").unwrap();
        std::fs::write(keepance_dir.join("mail-enc.db"), b"SQLCipher DB").unwrap();
        let blobs_dir = keepance_dir.join("mail").join("blobs");
        std::fs::create_dir_all(&blobs_dir).unwrap();
        std::fs::write(blobs_dir.join("m1.enc"), b"ciphertext").unwrap();

        migrate_plaintext(dir.path());

        // Plaintext artifacts removed.
        assert!(!dir.path().join("Mail").exists(), "Mail/ must be deleted");
        assert!(!dir.path().join(".keepance/mail.db").exists(), "mail.db must be deleted");
        // Encrypted artifacts preserved.
        assert!(
            dir.path().join(".keepance/mail-enc.db").exists(),
            "mail-enc.db must NOT be deleted"
        );
        assert!(
            dir.path().join(".keepance/mail/blobs/m1.enc").exists(),
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
        let keepance_dir = workspace.join(".keepance");
        std::fs::create_dir_all(&keepance_dir).unwrap();
        std::fs::write(keepance_dir.join("mail.db"), b"SQLite format 3\0...").unwrap();

        migrate_plaintext(&workspace);

        // Workspace plaintext must be gone.
        assert!(!workspace.join("Mail").exists());
        assert!(!workspace.join(".keepance/mail.db").exists());
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
}
