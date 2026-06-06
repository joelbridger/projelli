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
