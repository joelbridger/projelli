//! Box sync engine.
//!
//! The engine is network-agnostic: it depends on `BoxSource`, so tests can
//! drive folder trees and downloads completely offline.

use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};

use sha2::{Digest, Sha256};

use crate::commands::boxc::model::{
    child_path, parse_folder_key, BoxFileItem, BoxMatterMapEntry, DEFAULT_ACCOUNT, ROOT_FOLDER_ID,
};
use crate::commands::boxc::source::BoxSource;
use crate::commands::boxc::store::BoxStore;
use crate::commands::rag::store::{self as rag_store, PRIVILEGE_NONE, UNASSIGNED_MATTER};
use crate::commands::rag::{
    index_downloaded_document_bytes_as_source_type, DownloadedDocumentIndexOutcome,
};

const DOWNLOAD_BATCH_SIZE: usize = 4;

#[derive(Debug, Default, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BoxSyncReport {
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

#[derive(Debug, Default, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BoxFolderDto {
    pub key: String,
    pub folder_id: String,
    pub name: String,
    pub path: String,
}

#[derive(Debug, Clone)]
struct CrawlFolder {
    id: String,
    name: String,
    path: String,
    ancestors: Vec<String>,
}

pub fn content_hash(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

pub fn resolve_matter_for_file(file: &BoxFileItem, matter_map: &[BoxMatterMapEntry]) -> String {
    let mut best: Option<(&str, usize)> = None;
    for entry in matter_map {
        let Some(parts) = parse_folder_key(&entry.folder_key) else {
            continue;
        };
        if parts.account != DEFAULT_ACCOUNT {
            continue;
        }
        let id_match = file
            .ancestor_folder_ids
            .iter()
            .any(|folder_id| folder_id == &parts.folder_id);
        if !id_match && !path_prefix_matches(&file.parent_path, &parts.path) {
            continue;
        }
        let len = parts.path.len().max(parts.folder_id.len());
        if best.map(|(_, best_len)| len > best_len).unwrap_or(true) {
            best = Some((entry.matter_id.as_str(), len));
        }
    }
    best.map(|(matter_id, _)| matter_id.to_string())
        .unwrap_or_else(|| UNASSIGNED_MATTER.to_string())
}

fn path_prefix_matches(path: &str, folder: &str) -> bool {
    let path = crate::commands::boxc::model::normalize_box_path(path);
    let folder = crate::commands::boxc::model::normalize_box_path(folder);
    path == folder || path.starts_with(&format!("{}/", folder.trim_end_matches('/')))
}

pub async fn list_folders(source: &dyn BoxSource) -> anyhow::Result<Vec<BoxFolderDto>> {
    let (folders, _) = crawl(source, &AtomicBool::new(false), &AtomicU32::new(0)).await?;
    Ok(folders
        .into_iter()
        .filter(|f| f.id != ROOT_FOLDER_ID)
        .map(|f| BoxFolderDto {
            key: crate::commands::boxc::model::folder_key(DEFAULT_ACCOUNT, &f.id, &f.path),
            folder_id: f.id,
            name: f.name,
            path: f.path,
        })
        .collect())
}

pub async fn sync_documents(
    source: &dyn BoxSource,
    store: &BoxStore,
    workspace: &Path,
    matter_map: &[BoxMatterMapEntry],
    cancel: &AtomicBool,
    rag_key: &[u8; 32],
    progress: &AtomicU32,
) -> anyhow::Result<BoxSyncReport> {
    let mut report = BoxSyncReport::default();
    let conn = rag_store::open_connection(workspace).await?;
    let table = rag_store::open_or_create_table(&conn).await?;

    let (_, files) = crawl(source, cancel, progress).await?;
    let mut seen_source_ids = HashSet::new();
    let mut pending_downloads = Vec::new();

    for file in files {
        if cancel.load(Ordering::SeqCst) {
            report.cancelled = true;
            break;
        }
        report.seen += 1;
        progress.store(report.seen, Ordering::SeqCst);
        let source_id = file.source_id();
        seen_source_ids.insert(source_id.clone());
        let matter_id = resolve_matter_for_file(&file, matter_map);
        let remote_signature = file.remote_signature();
        let existing = store.get_item(&source_id)?;
        let needs_repair = existing
            .as_ref()
            .map(|row| !row.indexed && !row.pending_pdf)
            .unwrap_or(false);
        if existing
            .as_ref()
            .map(|row| {
                row.remote_signature == remote_signature
                    // Skip rows we already handled to a terminal state for these
                    // bytes: either indexed, OR a pending PDF (no Rust-side PDF
                    // text extractor exists yet, so re-downloading the identical
                    // bytes would just re-defer it). A row that is neither indexed
                    // nor pending fell through an interrupted sync and is left to
                    // the needs_repair path below.
                    && (row.indexed || row.pending_pdf)
                    && row.matter_id == matter_id
                    && row.parent_path == file.parent_path
                    && row.parent_folder_id == file.parent_folder_id
            })
            .unwrap_or(false)
        {
            report.skipped_unchanged += 1;
            continue;
        }

        if !crate::commands::boxc::model::is_supported_office_or_text(&file.name)
            && !crate::commands::boxc::model::is_pending_pdf(&file.name)
        {
            // P2-D: if this file was previously indexed and has now changed to an
            // unsupported type, its old chunks must be deleted, or stale text
            // stays searchable under the prior matter. delete_path is a no-op when
            // there are no chunks, so this is safe to call unconditionally.
            rag_store::delete_path(&table, &source_id, rag_key).await?;
            store.upsert_item(
                &source_id,
                &file.id,
                &file.name,
                &file.parent_folder_id,
                &file.parent_path,
                file.web_url.as_deref(),
                &remote_signature,
                "",
                &matter_id,
                false,
                false,
            )?;
            report.unsupported += 1;
            continue;
        }

        pending_downloads.push((file, matter_id, remote_signature, existing.is_some(), needs_repair));
    }

    for batch in pending_downloads.chunks(DOWNLOAD_BATCH_SIZE) {
        if cancel.load(Ordering::SeqCst) {
            report.cancelled = true;
            break;
        }
        let downloads = futures_util::future::join_all(batch.iter().map(|(file, _, _, _, _)| async {
            source
                .download_content(&file.id)
                .await
                .map(|bytes| (file.id.clone(), bytes))
        }))
        .await;
        let mut bytes_by_file_id = HashMap::new();
        for result in downloads {
            let (file_id, bytes) = result?;
            bytes_by_file_id.insert(file_id, bytes);
        }

        for (file, matter_id, remote_signature, existed, needs_repair) in batch {
            if cancel.load(Ordering::SeqCst) {
                report.cancelled = true;
                break;
            }
            let source_id = file.source_id();
            let bytes = bytes_by_file_id
                .remove(&file.id)
                .ok_or_else(|| anyhow::anyhow!("missing Box download for {}", file.id))?;
            report.downloaded += 1;
            if *needs_repair {
                report.repaired += 1;
            }
            let hash = content_hash(&bytes);
            let outcome = index_downloaded_document_bytes_as_source_type(
                &table,
                &source_id,
                &file.name,
                &bytes,
                matter_id,
                PRIVILEGE_NONE,
                rag_key,
                Some(cancel),
                "box",
            )
            .await?;

            match outcome {
                DownloadedDocumentIndexOutcome::Indexed(n) => {
                    store.upsert_item(
                        &source_id,
                        &file.id,
                        &file.name,
                        &file.parent_folder_id,
                        &file.parent_path,
                        file.web_url.as_deref(),
                        remote_signature,
                        &hash,
                        matter_id,
                        true,
                        false,
                    )?;
                    report.indexed += n;
                }
                DownloadedDocumentIndexOutcome::PendingPdf => {
                    store.upsert_item(
                        &source_id,
                        &file.id,
                        &file.name,
                        &file.parent_folder_id,
                        &file.parent_path,
                        file.web_url.as_deref(),
                        remote_signature,
                        &hash,
                        matter_id,
                        false,
                        true,
                    )?;
                    report.pending_pdf += 1;
                }
                DownloadedDocumentIndexOutcome::Unsupported => {
                    store.upsert_item(
                        &source_id,
                        &file.id,
                        &file.name,
                        &file.parent_folder_id,
                        &file.parent_path,
                        file.web_url.as_deref(),
                        remote_signature,
                        &hash,
                        matter_id,
                        false,
                        false,
                    )?;
                    report.unsupported += 1;
                }
                DownloadedDocumentIndexOutcome::Cancelled => {
                    if *existed {
                        store.mark_needs_index(&source_id)?;
                    }
                    report.cancelled = true;
                    break;
                }
            }
        }
    }

    if !report.cancelled {
        for source_id in store.list_active_source_ids()? {
            if !seen_source_ids.contains(&source_id) {
                store.mark_deleted(&source_id)?;
                rag_store::delete_path(&table, &source_id, rag_key).await?;
                report.removed += 1;
            }
        }
    }

    Ok(report)
}

async fn crawl(
    source: &dyn BoxSource,
    cancel: &AtomicBool,
    progress: &AtomicU32,
) -> anyhow::Result<(Vec<CrawlFolder>, Vec<BoxFileItem>)> {
    let mut folders = Vec::new();
    let mut files = Vec::new();
    let root = CrawlFolder {
        id: ROOT_FOLDER_ID.to_string(),
        name: "All files".to_string(),
        path: "/".to_string(),
        ancestors: vec![ROOT_FOLDER_ID.to_string()],
    };
    let mut stack = vec![root];
    while let Some(folder) = stack.pop() {
        if cancel.load(Ordering::SeqCst) {
            break;
        }
        progress.fetch_add(1, Ordering::SeqCst);
        let items = source.list_folder_items(&folder.id).await?;
        folders.push(folder.clone());
        for item in items {
            if item.is_folder() {
                let path = child_path(&folder.path, &item.name);
                let mut ancestors = folder.ancestors.clone();
                ancestors.push(item.id.clone());
                stack.push(CrawlFolder {
                    id: item.id,
                    name: item.name,
                    path,
                    ancestors,
                });
            } else if item.is_file() {
                files.push(item.into_file_item(
                    folder.id.clone(),
                    folder.path.clone(),
                    folder.ancestors.clone(),
                ));
            }
        }
    }
    Ok((folders, files))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::boxc::model::{folder_key, BoxFolder, BoxItem};
    use crate::commands::boxc::source::BoxSource;
    use crate::commands::mail::crypto::decrypt_with_key;
    use crate::commands::rag::embedder::{self, EMBEDDING_DIM};
    use crate::commands::rag::model_download;
    use async_trait::async_trait;
    use tempfile::TempDir;

    struct FakeBoxSource {
        folders: HashMap<String, Vec<BoxItem>>,
        downloads: HashMap<String, Vec<u8>>,
    }

    #[async_trait]
    impl BoxSource for FakeBoxSource {
        async fn get_folder(&self, folder_id: &str) -> anyhow::Result<BoxFolder> {
            Ok(BoxFolder {
                id: folder_id.to_string(),
                name: folder_id.to_string(),
                item_type: "folder".to_string(),
                ..Default::default()
            })
        }

        async fn get_file(&self, file_id: &str) -> anyhow::Result<crate::commands::boxc::model::BoxFile> {
            Ok(crate::commands::boxc::model::BoxFile {
                id: file_id.to_string(),
                name: file_id.to_string(),
                item_type: "file".to_string(),
                ..Default::default()
            })
        }

        async fn list_folder_items(&self, folder_id: &str) -> anyhow::Result<Vec<BoxItem>> {
            Ok(self.folders.get(folder_id).cloned().unwrap_or_default())
        }

        async fn download_content(&self, file_id: &str) -> anyhow::Result<Vec<u8>> {
            self.downloads
                .get(file_id)
                .cloned()
                .ok_or_else(|| anyhow::anyhow!("missing download {file_id}"))
        }
    }

    fn folder(id: &str, name: &str) -> BoxItem {
        BoxItem {
            id: id.to_string(),
            name: name.to_string(),
            item_type: "folder".to_string(),
            ..Default::default()
        }
    }

    fn file(id: &str, name: &str, etag: &str) -> BoxItem {
        BoxItem {
            id: id.to_string(),
            name: name.to_string(),
            item_type: "file".to_string(),
            etag: Some(etag.to_string()),
            size: Some(100),
            ..Default::default()
        }
    }

    fn model_is_provisioned() -> bool {
        model_download::model_files_cached(&embedder::resolve_cache_dir())
    }

    #[test]
    fn resolves_file_to_most_specific_box_folder_mapping() {
        let file = BoxFileItem {
            id: "file-1".into(),
            name: "memo.txt".into(),
            parent_folder_id: "tax".into(),
            parent_path: "/clients/acme/tax".into(),
            ancestor_folder_ids: vec!["0".into(), "clients".into(), "acme".into(), "tax".into()],
            etag: None,
            sha1: None,
            size: None,
            modified_at: None,
            web_url: None,
        };
        let map = vec![
            BoxMatterMapEntry {
                folder_key: folder_key(DEFAULT_ACCOUNT, "acme", "/clients/acme"),
                matter_id: "parent".into(),
            },
            BoxMatterMapEntry {
                folder_key: folder_key(DEFAULT_ACCOUNT, "tax", "/clients/acme/tax"),
                matter_id: "child".into(),
            },
        ];
        assert_eq!(resolve_matter_for_file(&file, &map), "child");
    }

    #[test]
    fn unresolved_file_uses_unassigned_sentinel() {
        let file = BoxFileItem {
            id: "file-1".into(),
            name: "memo.txt".into(),
            parent_folder_id: "folder".into(),
            parent_path: "/loose".into(),
            ancestor_folder_ids: vec!["folder".into()],
            etag: None,
            sha1: None,
            size: None,
            modified_at: None,
            web_url: None,
        };
        assert_eq!(resolve_matter_for_file(&file, &[]), UNASSIGNED_MATTER);
    }

    #[tokio::test]
    async fn fake_source_indexes_fixture_text_under_mapped_matter() {
        if !model_is_provisioned() {
            eprintln!("SKIP box fake sync index test: e5-small model cache not provisioned");
            return;
        }

        let mut folders = HashMap::new();
        folders.insert(ROOT_FOLDER_ID.to_string(), vec![folder("clients", "Clients")]);
        folders.insert("clients".to_string(), vec![folder("acme", "Acme")]);
        folders.insert("acme".to_string(), vec![file("file-1", "memo.txt", "v1")]);
        let mut downloads = HashMap::new();
        downloads.insert(
            "file-1".to_string(),
            b"Box memo for Acme about household billing and review notes.".to_vec(),
        );
        let source = FakeBoxSource { folders, downloads };
        let workspace = TempDir::new().expect("temp workspace");
        let store = BoxStore::open_with_key(workspace.path(), &[0x33u8; 32]).expect("box store");
        let rag_key = [0x66u8; 32];
        let map = vec![BoxMatterMapEntry {
            folder_key: folder_key(DEFAULT_ACCOUNT, "acme", "/clients/acme"),
            matter_id: "matter-acme".into(),
        }];

        let report = sync_documents(
            &source,
            &store,
            workspace.path(),
            &map,
            &AtomicBool::new(false),
            &rag_key,
            &AtomicU32::new(0),
        )
        .await
        .expect("sync documents");

        assert_eq!(report.downloaded, 1);
        assert!(report.indexed > 0);
        let conn = rag_store::open_connection(workspace.path()).await.unwrap();
        let table = rag_store::open_or_create_table(&conn).await.unwrap();
        let hits = rag_store::nearest(
            &table,
            &vec![0.1f32; EMBEDDING_DIM],
            10,
            Some("matter-acme"),
            false,
            &[],
        )
        .await
        .unwrap();
        let hit = hits
            .iter()
            .find(|hit| hit.source_type.as_deref() == Some("box"))
            .expect("Box chunk should be retrievable");
        assert_eq!(hit.matter_id.as_deref(), Some("matter-acme"));
        assert!(hit.encrypted);
        let path_enc = hit.path_enc.as_deref().expect("path_enc");
        let path = String::from_utf8(decrypt_with_key(&hex::decode(path_enc).unwrap(), &rag_key).unwrap())
            .unwrap();
        assert_eq!(path, "box:file-1");
    }

    async fn box_chunk_exists(workspace: &std::path::Path, matter_id: &str) -> bool {
        let conn = rag_store::open_connection(workspace).await.unwrap();
        let table = rag_store::open_or_create_table(&conn).await.unwrap();
        let hits = rag_store::nearest(
            &table,
            &vec![0.1f32; EMBEDDING_DIM],
            10,
            Some(matter_id),
            false,
            &[],
        )
        .await
        .unwrap();
        hits.iter().any(|h| h.source_type.as_deref() == Some("box"))
    }

    #[tokio::test]
    async fn file_changing_to_unsupported_type_deletes_its_chunks() {
        // P2-D: a previously-indexed file that changes to an unsupported
        // extension must have its old chunks deleted, not left searchable.
        if !model_is_provisioned() {
            eprintln!("SKIP box unsupported-rename test: e5-small model cache not provisioned");
            return;
        }
        let workspace = TempDir::new().expect("temp workspace");
        let store = BoxStore::open_with_key(workspace.path(), &[0x34u8; 32]).expect("box store");
        let rag_key = [0x67u8; 32];
        let map = vec![BoxMatterMapEntry {
            folder_key: folder_key(DEFAULT_ACCOUNT, "acme", "/clients/acme"),
            matter_id: "matter-acme".into(),
        }];

        // First sync: a supported .txt file is indexed under the matter.
        let mut folders = HashMap::new();
        folders.insert(ROOT_FOLDER_ID.to_string(), vec![folder("clients", "Clients")]);
        folders.insert("clients".to_string(), vec![folder("acme", "Acme")]);
        folders.insert("acme".to_string(), vec![file("file-1", "memo.txt", "v1")]);
        let mut downloads = HashMap::new();
        downloads.insert(
            "file-1".to_string(),
            b"Box memo for Acme about household billing.".to_vec(),
        );
        let report1 = sync_documents(
            &FakeBoxSource { folders, downloads },
            &store,
            workspace.path(),
            &map,
            &AtomicBool::new(false),
            &rag_key,
            &AtomicU32::new(0),
        )
        .await
        .expect("first sync");
        assert!(report1.indexed > 0);
        assert!(box_chunk_exists(workspace.path(), "matter-acme").await);

        // Second sync: the SAME file id now carries an unsupported extension.
        let mut folders2 = HashMap::new();
        folders2.insert(ROOT_FOLDER_ID.to_string(), vec![folder("clients", "Clients")]);
        folders2.insert("clients".to_string(), vec![folder("acme", "Acme")]);
        folders2.insert("acme".to_string(), vec![file("file-1", "memo.xyz", "v2")]);
        let report2 = sync_documents(
            &FakeBoxSource {
                folders: folders2,
                downloads: HashMap::new(),
            },
            &store,
            workspace.path(),
            &map,
            &AtomicBool::new(false),
            &rag_key,
            &AtomicU32::new(0),
        )
        .await
        .expect("second sync");
        assert_eq!(report2.unsupported, 1);
        assert!(!box_chunk_exists(workspace.path(), "matter-acme").await);
    }
}
