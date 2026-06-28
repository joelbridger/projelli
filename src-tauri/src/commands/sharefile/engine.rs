//! ShareFile sync engine.
//!
//! The engine is network-agnostic: it depends on `DocumentSource`, so tests can
//! drive folder trees and downloads completely offline.

use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};

use sha2::{Digest, Sha256};

use crate::commands::rag::store::{self as rag_store, PRIVILEGE_NONE, UNASSIGNED_MATTER};
use crate::commands::rag::{
    index_downloaded_document_bytes_as_source_type, DownloadedDocumentIndexOutcome,
};
use crate::commands::sharefile::model::{
    child_path, parse_folder_key, SharefileItem, SharefileMatterMapEntry, DEFAULT_ACCOUNT,
};
use crate::commands::sharefile::source::DocumentSource;
use crate::commands::sharefile::store::SharefileStore;

#[derive(Debug, Default, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SharefileSyncReport {
    pub seen: u32,
    pub downloaded: u32,
    pub indexed: u32,
    pub skipped_unchanged: u32,
    pub removed: u32,
    pub pending_pdf: u32,
    pub unsupported: u32,
    pub repaired: u32,
    pub cancelled: bool,
}

pub fn content_hash(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

#[derive(Debug, Clone, PartialEq)]
struct LocatedFile {
    item: SharefileItem,
    parent_id: Option<String>,
    parent_path: String,
}

pub fn resolve_matter_for_path(path: &str, matter_map: &[SharefileMatterMapEntry]) -> String {
    let mut best: Option<(&str, usize)> = None;
    for entry in matter_map {
        let Some(parts) = parse_folder_key(&entry.folder_key) else {
            continue;
        };
        if parts.account != DEFAULT_ACCOUNT {
            continue;
        }
        if path_prefix_matches(path, &parts.path) {
            let len = parts.path.len();
            if best.map(|(_, best_len)| len > best_len).unwrap_or(true) {
                best = Some((entry.matter_id.as_str(), len));
            }
        }
    }
    best.map(|(matter_id, _)| matter_id.to_string())
        .unwrap_or_else(|| UNASSIGNED_MATTER.to_string())
}

fn path_prefix_matches(path: &str, folder: &str) -> bool {
    let path = crate::commands::sharefile::model::normalize_sharefile_path(path);
    let folder = crate::commands::sharefile::model::normalize_sharefile_path(folder);
    path == folder || path.starts_with(&format!("{}/", folder.trim_end_matches('/')))
}

async fn collect_files(
    source: &dyn DocumentSource,
    cancel: &AtomicBool,
    progress: &AtomicU32,
) -> anyhow::Result<(Vec<LocatedFile>, Vec<(SharefileItem, String)>, bool)> {
    let mut files = Vec::new();
    let mut folders = Vec::new();
    let mut stack: Vec<(SharefileItem, String)> = Vec::new();
    let mut cancelled = false;

    for item in source.list_root_children().await? {
        if cancel.load(Ordering::SeqCst) {
            cancelled = true;
            break;
        }
        progress.fetch_add(1, Ordering::SeqCst);
        if item.is_file() {
            files.push(LocatedFile {
                item,
                parent_id: None,
                parent_path: "/".to_string(),
            });
        } else if item.is_folder() {
            let path = child_path("/", &item.name);
            folders.push((item.clone(), path.clone()));
            stack.push((item, path));
        }
    }

    while let Some((folder, folder_path)) = stack.pop() {
        if cancel.load(Ordering::SeqCst) {
            cancelled = true;
            break;
        }
        let children = source.list_children(&folder.id).await?;
        for child in children {
            if cancel.load(Ordering::SeqCst) {
                cancelled = true;
                break;
            }
            progress.fetch_add(1, Ordering::SeqCst);
            if child.is_file() {
                files.push(LocatedFile {
                    item: child,
                    parent_id: Some(folder.id.clone()),
                    parent_path: folder_path.clone(),
                });
            } else if child.is_folder() {
                let path = child_path(&folder_path, &child.name);
                folders.push((child.clone(), path.clone()));
                stack.push((child, path));
            }
        }
    }

    Ok((files, folders, cancelled))
}

pub async fn sync_documents(
    source: &dyn DocumentSource,
    store: &SharefileStore,
    workspace: &Path,
    matter_map: &[SharefileMatterMapEntry],
    cancel: &AtomicBool,
    rag_key: &[u8; 32],
    progress: &AtomicU32,
) -> anyhow::Result<SharefileSyncReport> {
    let mut report = SharefileSyncReport::default();
    let conn = rag_store::open_connection(workspace).await?;
    let table = rag_store::open_or_create_table(&conn).await?;
    progress.store(0, Ordering::SeqCst);

    let (files, _folders, cancelled_during_scan) = collect_files(source, cancel, progress).await?;
    if cancelled_during_scan {
        report.cancelled = true;
    }
    report.seen = progress.load(Ordering::SeqCst);

    let mut seen_source_ids = HashSet::new();
    for located in files {
        if cancel.load(Ordering::SeqCst) {
            report.cancelled = true;
            break;
        }

        let key = located.item.source_key();
        seen_source_ids.insert(key.source_id.clone());
        let name = located.item.display_name();
        let matter_id = resolve_matter_for_path(&located.parent_path, matter_map);
        let remote_signature = located.item.remote_signature();
        let existing = store.get_item(&key.source_id)?;

        let needs_repair = existing
            .as_ref()
            .map(|row| !row.indexed && !row.pending_pdf)
            .unwrap_or(false);
        if existing
            .as_ref()
            .map(|row| {
                row.remote_signature == remote_signature
                    && row.indexed
                    && row.matter_id == matter_id
                    && row.parent_path == located.parent_path
            })
            .unwrap_or(false)
        {
            report.skipped_unchanged += 1;
            continue;
        }

        if !crate::commands::sharefile::model::is_supported_office_or_text(&name)
            && !crate::commands::sharefile::model::is_pending_pdf(&name)
        {
            store.upsert_item(
                &key.source_id,
                &key.item_id,
                &name,
                located.parent_id.as_deref(),
                &located.parent_path,
                located.item.url.as_deref(),
                &remote_signature,
                "",
                &matter_id,
                false,
                false,
            )?;
            report.unsupported += 1;
            continue;
        }

        let bytes = source.download_content(&key.item_id).await?;
        report.downloaded += 1;
        if needs_repair {
            report.repaired += 1;
        }
        let hash = content_hash(&bytes);
        let outcome = index_downloaded_document_bytes_as_source_type(
            &table,
            &key.source_id,
            &name,
            &bytes,
            &matter_id,
            PRIVILEGE_NONE,
            rag_key,
            Some(cancel),
            "sharefile",
        )
        .await?;

        match outcome {
            DownloadedDocumentIndexOutcome::Indexed(n) => {
                store.upsert_item(
                    &key.source_id,
                    &key.item_id,
                    &name,
                    located.parent_id.as_deref(),
                    &located.parent_path,
                    located.item.url.as_deref(),
                    &remote_signature,
                    &hash,
                    &matter_id,
                    true,
                    false,
                )?;
                report.indexed += n;
            }
            DownloadedDocumentIndexOutcome::PendingPdf => {
                store.upsert_item(
                    &key.source_id,
                    &key.item_id,
                    &name,
                    located.parent_id.as_deref(),
                    &located.parent_path,
                    located.item.url.as_deref(),
                    &remote_signature,
                    &hash,
                    &matter_id,
                    false,
                    true,
                )?;
                report.pending_pdf += 1;
            }
            DownloadedDocumentIndexOutcome::Unsupported => {
                store.upsert_item(
                    &key.source_id,
                    &key.item_id,
                    &name,
                    located.parent_id.as_deref(),
                    &located.parent_path,
                    located.item.url.as_deref(),
                    &remote_signature,
                    &hash,
                    &matter_id,
                    false,
                    false,
                )?;
                report.unsupported += 1;
            }
            DownloadedDocumentIndexOutcome::Cancelled => {
                if existing.is_some() {
                    store.mark_needs_index(&key.source_id)?;
                }
                report.cancelled = true;
                break;
            }
        }
    }

    if !report.cancelled {
        for source_id in store.list_active_source_ids()? {
            if seen_source_ids.contains(&source_id) {
                continue;
            }
            store.mark_deleted(&source_id)?;
            rag_store::delete_path(&table, &source_id, rag_key).await?;
            report.removed += 1;
        }
    }

    Ok(report)
}

#[allow(dead_code)]
pub fn matter_map_to_hashmap(entries: &[SharefileMatterMapEntry]) -> HashMap<String, String> {
    entries
        .iter()
        .map(|e| (e.folder_key.clone(), e.matter_id.clone()))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::mail::crypto::decrypt_with_key;
    use crate::commands::rag::embedder::EMBEDDING_DIM;
    use crate::commands::sharefile::model::folder_key;
    use async_trait::async_trait;
    use tempfile::TempDir;

    struct FakeSource {
        root: Vec<SharefileItem>,
        children: HashMap<String, Vec<SharefileItem>>,
        downloads: tokio::sync::Mutex<HashMap<String, Vec<u8>>>,
        download_count: AtomicU32,
    }

    impl FakeSource {
        fn new(root: Vec<SharefileItem>) -> Self {
            Self {
                root,
                children: HashMap::new(),
                downloads: tokio::sync::Mutex::new(HashMap::new()),
                download_count: AtomicU32::new(0),
            }
        }

        fn with_children(mut self, folder_id: &str, children: Vec<SharefileItem>) -> Self {
            self.children.insert(folder_id.to_string(), children);
            self
        }

        async fn with_download(self, item_id: &str, bytes: &[u8]) -> Self {
            self.downloads
                .lock()
                .await
                .insert(item_id.to_string(), bytes.to_vec());
            self
        }
    }

    #[async_trait]
    impl DocumentSource for FakeSource {
        async fn list_root_children(&self) -> anyhow::Result<Vec<SharefileItem>> {
            Ok(self.root.clone())
        }

        async fn list_children(&self, item_id: &str) -> anyhow::Result<Vec<SharefileItem>> {
            Ok(self.children.get(item_id).cloned().unwrap_or_default())
        }

        async fn download_content(&self, item_id: &str) -> anyhow::Result<Vec<u8>> {
            self.download_count.fetch_add(1, Ordering::SeqCst);
            self.downloads
                .lock()
                .await
                .get(item_id)
                .cloned()
                .ok_or_else(|| anyhow::anyhow!("missing download"))
        }
    }

    fn folder(id: &str, name: &str) -> SharefileItem {
        SharefileItem {
            id: id.to_string(),
            name: name.to_string(),
            file_count: Some(1),
            odata_metadata: Some("ShareFile.Api.Models.Folder".to_string()),
            ..Default::default()
        }
    }

    fn file(id: &str, name: &str, sig: &str) -> SharefileItem {
        SharefileItem {
            id: id.to_string(),
            name: name.to_string(),
            file_name: Some(name.to_string()),
            client_modified_date: Some(sig.to_string()),
            file_size_bytes: Some(128),
            odata_metadata: Some("ShareFile.Api.Models.File".to_string()),
            ..Default::default()
        }
    }

    fn decrypt_hit_text(hit: &rag_store::StoredHit, key: &[u8; 32]) -> String {
        let blob = hex::decode(&hit.text).expect("external text is hex");
        String::from_utf8(decrypt_with_key(&blob, key).expect("decrypt text"))
            .expect("text is utf8")
    }

    #[test]
    fn longest_prefix_matter_match_is_path_aware() {
        let map = vec![
            SharefileMatterMapEntry {
                folder_key: folder_key(DEFAULT_ACCOUNT, "fo-parent", "/clients/acme"),
                matter_id: "matter-parent".into(),
            },
            SharefileMatterMapEntry {
                folder_key: folder_key(DEFAULT_ACCOUNT, "fo-child", "/clients/acme/pleadings"),
                matter_id: "matter-child".into(),
            },
        ];
        assert_eq!(
            resolve_matter_for_path("/Clients/Acme/Pleadings", &map),
            "matter-child"
        );
        assert_eq!(
            resolve_matter_for_path("/Clients/Acme/Billing", &map),
            "matter-parent"
        );
        assert_eq!(
            resolve_matter_for_path("/Clients/Beta", &map),
            UNASSIGNED_MATTER
        );
    }

    #[tokio::test]
    async fn sync_indexes_sharefile_documents_under_mapped_folder() {
        let dir = TempDir::new().unwrap();
        let store = SharefileStore::open_with_key(dir.path(), &[0x34; 32]).unwrap();
        let source = FakeSource::new(vec![folder("fo-acme", "Acme")])
            .with_children("fo-acme", vec![file("fi-memo", "memo.txt", "sig-a")])
            .with_download("fi-memo", b"ShareFile agreement text for Acme.")
            .await;
        let matter_map = vec![SharefileMatterMapEntry {
            folder_key: folder_key(DEFAULT_ACCOUNT, "fo-acme", "/acme"),
            matter_id: "matter-acme".into(),
        }];
        let rag_key = [0x35; 32];

        let report = sync_documents(
            &source,
            &store,
            dir.path(),
            &matter_map,
            &AtomicBool::new(false),
            &rag_key,
            &AtomicU32::new(0),
        )
        .await
        .unwrap();

        assert_eq!(report.downloaded, 1);
        assert_eq!(report.indexed, 1);
        let verify_conn = rag_store::open_connection(dir.path()).await.unwrap();
        let verify_table = rag_store::open_or_create_table(&verify_conn).await.unwrap();
        let hits = rag_store::nearest(
            &verify_table,
            &vec![0.2f32; EMBEDDING_DIM],
            5,
            Some("matter-acme"),
            false,
            &[],
        )
        .await
        .unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].source_type.as_deref(), Some("sharefile"));
        assert!(decrypt_hit_text(&hits[0], &rag_key).contains("ShareFile agreement"));
    }

    #[tokio::test]
    async fn unchanged_indexed_item_skips_download() {
        let dir = TempDir::new().unwrap();
        let store = SharefileStore::open_with_key(dir.path(), &[0x36; 32]).unwrap();
        store
            .upsert_item(
                "sharefile:fi-memo",
                "fi-memo",
                "memo.txt",
                Some("fo-acme"),
                "/acme",
                None,
                "sig-a|||128",
                "hash",
                "matter-acme",
                true,
                false,
            )
            .unwrap();
        let source = FakeSource::new(vec![folder("fo-acme", "Acme")])
            .with_children("fo-acme", vec![file("fi-memo", "memo.txt", "sig-a")]);
        let matter_map = vec![SharefileMatterMapEntry {
            folder_key: folder_key(DEFAULT_ACCOUNT, "fo-acme", "/acme"),
            matter_id: "matter-acme".into(),
        }];
        let report = sync_documents(
            &source,
            &store,
            dir.path(),
            &matter_map,
            &AtomicBool::new(false),
            &[0x37; 32],
            &AtomicU32::new(0),
        )
        .await
        .unwrap();

        assert_eq!(report.skipped_unchanged, 1);
        assert_eq!(source.download_count.load(Ordering::SeqCst), 0);
    }

}
