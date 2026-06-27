//! OneDrive / SharePoint sync engine.
//!
//! The engine is network-agnostic: it depends on `DocumentSource`, so tests can
//! drive delta pages and downloads completely offline.

use std::collections::HashMap;
use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};

use sha2::{Digest, Sha256};

use crate::commands::onedrive::model::{
    parent_folder_path, parse_folder_key, DriveItem, OneDriveMatterMapEntry, DEFAULT_ACCOUNT,
};
use crate::commands::onedrive::source::{is_delta_gone, DocumentSource};
use crate::commands::onedrive::store::OneDriveStore;
use crate::commands::rag::store::{self as rag_store, PRIVILEGE_NONE, UNASSIGNED_MATTER};
use crate::commands::rag::{index_downloaded_document_bytes, DownloadedDocumentIndexOutcome};

#[derive(Debug, Default, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OneDriveSyncReport {
    pub seen: u32,
    pub downloaded: u32,
    pub indexed: u32,
    pub skipped_unchanged: u32,
    pub removed: u32,
    pub pending_pdf: u32,
    pub unsupported: u32,
    pub repaired: u32,
    pub delta_reset: bool,
    pub cancelled: bool,
}

impl OneDriveSyncReport {
    pub fn merge_from(&mut self, other: OneDriveSyncReport) {
        self.seen += other.seen;
        self.downloaded += other.downloaded;
        self.indexed += other.indexed;
        self.skipped_unchanged += other.skipped_unchanged;
        self.removed += other.removed;
        self.pending_pdf += other.pending_pdf;
        self.unsupported += other.unsupported;
        self.repaired += other.repaired;
        self.delta_reset |= other.delta_reset;
        self.cancelled |= other.cancelled;
    }
}

pub fn content_hash(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

pub fn resolve_matter_for_item(item: &DriveItem, matter_map: &[OneDriveMatterMapEntry]) -> String {
    let drive_id = item.drive_id();
    let site_id = item.site_id();
    let folder_path = parent_folder_path(item);
    let mut best: Option<(&str, usize)> = None;
    for entry in matter_map {
        let Some(parts) = parse_folder_key(&entry.folder_key) else {
            continue;
        };
        if parts.account != DEFAULT_ACCOUNT
            || parts.drive_id != drive_id
            || parts.site_id.as_deref() != site_id.as_deref()
        {
            continue;
        }
        if path_prefix_matches(&folder_path, &parts.path) {
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
    let path = crate::commands::onedrive::model::normalize_cloud_path(path);
    let folder = crate::commands::onedrive::model::normalize_cloud_path(folder);
    path == folder || path.starts_with(&format!("{}/", folder.trim_end_matches('/')))
}

pub async fn sync_documents(
    source: &dyn DocumentSource,
    store: &OneDriveStore,
    workspace: &Path,
    matter_map: &[OneDriveMatterMapEntry],
    cancel: &AtomicBool,
    rag_key: &[u8; 32],
    progress: &AtomicU32,
) -> anyhow::Result<OneDriveSyncReport> {
    let mut report = OneDriveSyncReport::default();
    let conn = rag_store::open_connection(workspace).await?;
    let table = rag_store::open_or_create_table(&conn).await?;
    let root_key = source.root_key();

    let mut cursor = store.get_cursor(&root_key)?;
    let delta = match source.delta_root(cursor.as_deref()).await {
        Ok(page) => page,
        Err(e) if is_delta_gone(&e) => {
            store.clear_cursor(&root_key)?;
            cursor = None;
            report.delta_reset = true;
            source.delta_root(cursor.as_deref()).await?
        }
        Err(e) => return Err(e),
    };

    for item in &delta.value {
        if cancel.load(Ordering::SeqCst) {
            report.cancelled = true;
            break;
        }
        report.seen += 1;
        progress.store(report.seen, Ordering::SeqCst);

        let key = item.source_key();
        if item.deleted.is_some() {
            store.mark_deleted(&key.source_id)?;
            rag_store::delete_path(&table, &key.source_id, rag_key).await?;
            report.removed += 1;
            continue;
        }
        if !item.is_file() {
            continue;
        }

        let matter_id = resolve_matter_for_item(item, matter_map);
        let parent_path = parent_folder_path(item);
        let remote_signature = item.remote_signature();
        let existing = store.get_item(&key.source_id)?;

        let needs_repair = existing
            .as_ref()
            .map(|row| !row.indexed && !row.pending_pdf)
            .unwrap_or(false);
        if existing.as_ref().map(|row| {
            row.remote_signature == remote_signature
                && row.indexed
                && row.matter_id == matter_id
                && row.parent_path == parent_path
                && row.drive_id == key.drive_id
                && row.site_id == key.site_id
        }).unwrap_or(false)
        {
            report.skipped_unchanged += 1;
            continue;
        }

        if !crate::commands::onedrive::model::is_supported_office_or_text(&item.name)
            && !crate::commands::onedrive::model::is_pending_pdf(&item.name)
        {
            store.upsert_item(
                &key.source_id,
                &key.drive_id,
                key.site_id.as_deref(),
                &key.item_id,
                &item.name,
                &parent_path,
                item.web_url.as_deref(),
                &remote_signature,
                "",
                &matter_id,
                false,
                false,
            )?;
            report.unsupported += 1;
            continue;
        }

        let bytes = source.download_content(&key.drive_id, &key.item_id).await?;
        report.downloaded += 1;
        if needs_repair {
            report.repaired += 1;
        }
        let hash = content_hash(&bytes);
        let outcome = index_downloaded_document_bytes(
            &table,
            &key.source_id,
            &item.name,
            &bytes,
            &matter_id,
            PRIVILEGE_NONE,
            rag_key,
            Some(cancel),
        )
        .await?;

        match outcome {
            DownloadedDocumentIndexOutcome::Indexed(n) => {
                store.upsert_item(
                    &key.source_id,
                    &key.drive_id,
                    key.site_id.as_deref(),
                    &key.item_id,
                    &item.name,
                    &parent_path,
                    item.web_url.as_deref(),
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
                    &key.drive_id,
                    key.site_id.as_deref(),
                    &key.item_id,
                    &item.name,
                    &parent_path,
                    item.web_url.as_deref(),
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
                    &key.drive_id,
                    key.site_id.as_deref(),
                    &key.item_id,
                    &item.name,
                    &parent_path,
                    item.web_url.as_deref(),
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
        if let Some(delta_link) = delta.delta_link.as_deref() {
            store.set_cursor(&root_key, delta_link)?;
        }
    }

    Ok(report)
}

#[allow(dead_code)]
pub fn matter_map_to_hashmap(entries: &[OneDriveMatterMapEntry]) -> HashMap<String, String> {
    entries
        .iter()
        .map(|e| (e.folder_key.clone(), e.matter_id.clone()))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::mail::crypto::decrypt_with_key;
    use crate::commands::mail::graph::DeltaGone;
    use crate::commands::onedrive::model::{folder_key, DeltaPage, ParentReference};
    use crate::commands::onedrive::source::DocumentSource;
    use crate::commands::rag::embedder::EMBEDDING_DIM;
    use async_trait::async_trait;
    use std::sync::Arc;
    use tempfile::TempDir;

    struct FakeSource {
        root_key: String,
        pages: tokio::sync::Mutex<Vec<anyhow::Result<DeltaPage>>>,
        downloads: tokio::sync::Mutex<HashMap<String, Vec<u8>>>,
        cancel_on_download: Option<Arc<AtomicBool>>,
        download_count: AtomicU32,
    }

    impl FakeSource {
        fn new(page: DeltaPage) -> Self {
            Self {
                root_key: "m365/default/me".to_string(),
                pages: tokio::sync::Mutex::new(vec![Ok(page)]),
                downloads: tokio::sync::Mutex::new(HashMap::new()),
                cancel_on_download: None,
                download_count: AtomicU32::new(0),
            }
        }

        async fn with_download(self, item_id: &str, bytes: &[u8]) -> Self {
            self.downloads
                .lock()
                .await
                .insert(item_id.to_string(), bytes.to_vec());
            self
        }

        fn with_root_key(mut self, root_key: &str) -> Self {
            self.root_key = root_key.to_string();
            self
        }

        fn with_cancel_on_download(mut self, cancel: Arc<AtomicBool>) -> Self {
            self.cancel_on_download = Some(cancel);
            self
        }

        fn with_pages(pages: Vec<anyhow::Result<DeltaPage>>) -> Self {
            Self {
                root_key: "m365/default/me".to_string(),
                pages: tokio::sync::Mutex::new(pages),
                downloads: tokio::sync::Mutex::new(HashMap::new()),
                cancel_on_download: None,
                download_count: AtomicU32::new(0),
            }
        }
    }

    #[async_trait]
    impl DocumentSource for FakeSource {
        fn root_key(&self) -> String {
            self.root_key.clone()
        }
        async fn list_drives(
            &self,
        ) -> anyhow::Result<Vec<crate::commands::onedrive::model::Drive>> {
            Ok(vec![])
        }
        async fn list_root_children(
            &self,
            _drive_id: Option<&str>,
        ) -> anyhow::Result<Vec<DriveItem>> {
            Ok(vec![])
        }
        async fn list_children(
            &self,
            _drive_id: &str,
            _item_id: &str,
        ) -> anyhow::Result<Vec<DriveItem>> {
            Ok(vec![])
        }
        async fn delta_root(&self, _cursor: Option<&str>) -> anyhow::Result<DeltaPage> {
            self.pages.lock().await.remove(0)
        }
        async fn download_content(
            &self,
            _drive_id: &str,
            item_id: &str,
        ) -> anyhow::Result<Vec<u8>> {
            self.download_count.fetch_add(1, Ordering::SeqCst);
            if let Some(cancel) = &self.cancel_on_download {
                cancel.store(true, Ordering::SeqCst);
            }
            self.downloads
                .lock()
                .await
                .get(item_id)
                .cloned()
                .ok_or_else(|| anyhow::anyhow!("missing download"))
        }
    }

    fn file_item(id: &str, name: &str, drive: &str, parent: &str, sig: &str) -> DriveItem {
        DriveItem {
            id: id.to_string(),
            name: name.to_string(),
            parent_reference: Some(ParentReference {
                drive_id: drive.to_string(),
                path: Some(parent.to_string()),
                ..Default::default()
            }),
            file: Some(serde_json::json!({})),
            e_tag: Some(sig.to_string()),
            ..Default::default()
        }
    }

    fn deleted_item(id: &str, name: &str, drive: &str, parent: &str) -> DriveItem {
        DriveItem {
            id: id.to_string(),
            name: name.to_string(),
            parent_reference: Some(ParentReference {
                drive_id: drive.to_string(),
                path: Some(parent.to_string()),
                ..Default::default()
            }),
            deleted: Some(serde_json::json!({})),
            ..Default::default()
        }
    }

    fn decrypt_hit_path(hit: &rag_store::StoredHit, key: &[u8; 32]) -> String {
        let path_enc = hit
            .path_enc
            .as_deref()
            .expect("external hit has encrypted path");
        let blob = hex::decode(path_enc).expect("path_enc is hex");
        String::from_utf8(decrypt_with_key(&blob, key).expect("decrypt path"))
            .expect("path is utf8")
    }

    fn decrypt_hit_text(hit: &rag_store::StoredHit, key: &[u8; 32]) -> String {
        let blob = hex::decode(&hit.text).expect("external text is hex");
        String::from_utf8(decrypt_with_key(&blob, key).expect("decrypt text"))
            .expect("text is utf8")
    }

    #[test]
    fn longest_prefix_matter_match_is_drive_aware() {
        let item = file_item(
            "1",
            "memo.txt",
            "drive-a",
            "/drive/root:/Clients/Acme/Pleadings",
            "a",
        );
        let map = vec![
            OneDriveMatterMapEntry {
                folder_key: folder_key(DEFAULT_ACCOUNT, None, "drive-a", "/clients/acme"),
                matter_id: "matter-parent".into(),
            },
            OneDriveMatterMapEntry {
                folder_key: folder_key(DEFAULT_ACCOUNT, None, "drive-a", "/clients/acme/pleadings"),
                matter_id: "matter-child".into(),
            },
            OneDriveMatterMapEntry {
                folder_key: folder_key(DEFAULT_ACCOUNT, None, "drive-b", "/clients/acme/pleadings"),
                matter_id: "wrong-drive".into(),
            },
        ];
        assert_eq!(resolve_matter_for_item(&item, &map), "matter-child");
    }

    #[tokio::test]
    async fn unchanged_indexed_item_skips_download() {
        let dir = TempDir::new().unwrap();
        let store = OneDriveStore::open_with_key(dir.path(), &[0x44; 32]).unwrap();
        store
            .upsert_item(
                "onedrive:drive-a:item-1",
                "drive-a",
                None,
                "item-1",
                "memo.txt",
                "/clients/acme",
                None,
                "same|||0",
                "hash",
                "matter-a",
                true,
                false,
            )
            .unwrap();
        let page = DeltaPage {
            value: vec![file_item(
                "item-1",
                "memo.txt",
                "drive-a",
                "/drive/root:/Clients/Acme",
                "same",
            )],
            delta_link: Some("delta-next".into()),
            ..Default::default()
        };
        let source = FakeSource::new(page);
        let matter_map = vec![OneDriveMatterMapEntry {
            folder_key: folder_key(DEFAULT_ACCOUNT, None, "drive-a", "/clients/acme"),
            matter_id: "matter-a".into(),
        }];
        let report = sync_documents(
            &source,
            &store,
            dir.path(),
            &matter_map,
            &AtomicBool::new(false),
            &[0x55; 32],
            &AtomicU32::new(0),
        )
        .await
        .unwrap();
        assert_eq!(report.skipped_unchanged, 1);
        assert_eq!(source.download_count.load(Ordering::SeqCst), 0);
        assert_eq!(
            store.get_cursor("m365/default/me").unwrap().as_deref(),
            Some("delta-next")
        );
    }

    #[tokio::test]
    async fn tombstone_removes_indexed_chunks() {
        let dir = TempDir::new().unwrap();
        let store = OneDriveStore::open_with_key(dir.path(), &[0x44; 32]).unwrap();
        let rag_key = [0x56; 32];
        let source_id = "onedrive:drive-a:item-1";
        store
            .upsert_item(
                source_id,
                "drive-a",
                None,
                "item-1",
                "memo.txt",
                "/clients/acme",
                None,
                "sig|||0",
                "hash",
                "matter-a",
                true,
                false,
            )
            .unwrap();

        let conn = rag_store::open_connection(dir.path()).await.unwrap();
        let table = rag_store::open_or_create_table(&conn).await.unwrap();
        let chunks = crate::commands::rag::chunker::chunk_text(
            source_id,
            "OneDrive agreement text for Acme matter.",
        );
        let rows: Vec<_> = chunks
            .into_iter()
            .map(|chunk| (chunk, vec![0.2f32; EMBEDDING_DIM]))
            .collect();
        let batch = rag_store::build_batch_external(
            &rows,
            &rag_key,
            "matter-a",
            PRIVILEGE_NONE,
            "onedrive",
        )
        .unwrap();
        let schema = batch.schema();
        table
            .add(Box::new(arrow_array::RecordBatchIterator::new(
                vec![Ok(batch)],
                schema,
            )))
            .execute()
            .await
            .unwrap();
        let before = rag_store::nearest(
            &table,
            &vec![0.2f32; EMBEDDING_DIM],
            5,
            Some("matter-a"),
            false,
            &[],
        )
        .await
        .unwrap();
        assert_eq!(before.len(), 1);

        let page = DeltaPage {
            value: vec![deleted_item(
                "item-1",
                "memo.txt",
                "drive-a",
                "/drive/root:/Clients/Acme",
            )],
            delta_link: Some("delta-after-delete".into()),
            ..Default::default()
        };
        let source = FakeSource::new(page);
        let report = sync_documents(
            &source,
            &store,
            dir.path(),
            &[],
            &AtomicBool::new(false),
            &rag_key,
            &AtomicU32::new(0),
        )
        .await
        .unwrap();

        assert_eq!(report.removed, 1);
        let table_after_delete = rag_store::open_or_create_table(&conn).await.unwrap();
        let after = rag_store::nearest(
            &table_after_delete,
            &vec![0.2f32; EMBEDDING_DIM],
            5,
            Some("matter-a"),
            false,
            &[],
        )
        .await
        .unwrap();
        assert!(
            after.is_empty(),
            "delta tombstone must remove encrypted chunks"
        );
        assert!(store.get_item(source_id).unwrap().unwrap().deleted);
    }

    #[tokio::test]
    async fn repair_downloads_when_metadata_was_fetched_but_not_indexed() {
        let dir = TempDir::new().unwrap();
        let store = OneDriveStore::open_with_key(dir.path(), &[0x44; 32]).unwrap();
        store
            .upsert_item(
                "onedrive:drive-a:item-1",
                "drive-a",
                None,
                "item-1",
                "memo.txt",
                "/clients/acme",
                None,
                "same|||0",
                "",
                "matter-a",
                false,
                false,
            )
            .unwrap();
        let page = DeltaPage {
            value: vec![file_item(
                "item-1",
                "memo.txt",
                "drive-a",
                "/drive/root:/Clients/Acme",
                "same",
            )],
            delta_link: Some("delta-next".into()),
            ..Default::default()
        };
        let source = FakeSource::new(page)
            .with_download("item-1", b"Repair me from OneDrive text bytes.")
            .await;
        let report = sync_documents(
            &source,
            &store,
            dir.path(),
            &[],
            &AtomicBool::new(false),
            &[0x57; 32],
            &AtomicU32::new(0),
        )
        .await
        .unwrap();

        assert_eq!(report.repaired, 1);
        assert_eq!(report.downloaded, 1);
        assert!(report.indexed > 0);
        let row = store.get_item("onedrive:drive-a:item-1").unwrap().unwrap();
        assert!(row.indexed);
        assert!(!row.content_hash.is_empty());
    }

    #[tokio::test]
    async fn delta_gone_clears_cursor_and_restarts_full_delta() {
        let dir = TempDir::new().unwrap();
        let store = OneDriveStore::open_with_key(dir.path(), &[0x44; 32]).unwrap();
        store.set_cursor("m365/default/me", "stale-delta").unwrap();
        let page = DeltaPage {
            value: vec![],
            delta_link: Some("fresh-delta".into()),
            ..Default::default()
        };
        let source = FakeSource::with_pages(vec![Err(anyhow::Error::new(DeltaGone)), Ok(page)]);
        let report = sync_documents(
            &source,
            &store,
            dir.path(),
            &[],
            &AtomicBool::new(false),
            &[0x58; 32],
            &AtomicU32::new(0),
        )
        .await
        .unwrap();

        assert!(report.delta_reset);
        assert_eq!(
            store.get_cursor("m365/default/me").unwrap().as_deref(),
            Some("fresh-delta")
        );
    }

    #[tokio::test]
    async fn sync_indexes_downloaded_text_into_mapped_matter() {
        let dir = TempDir::new().unwrap();
        let store = OneDriveStore::open_with_key(dir.path(), &[0x44; 32]).unwrap();
        let rag_key = [0x59; 32];
        let page = DeltaPage {
            value: vec![file_item(
                "item-1",
                "memo.txt",
                "drive-a",
                "/drive/root:/Clients/Acme",
                "v1",
            )],
            delta_link: Some("delta-next".into()),
            ..Default::default()
        };
        let source = FakeSource::new(page)
            .with_download("item-1", b"Acme household planning note from OneDrive.")
            .await;
        let matter_map = vec![OneDriveMatterMapEntry {
            folder_key: folder_key(DEFAULT_ACCOUNT, None, "drive-a", "/clients/acme"),
            matter_id: "matter-a".into(),
        }];
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
        assert!(report.indexed > 0);

        let conn = rag_store::open_connection(dir.path()).await.unwrap();
        let table = rag_store::open_or_create_table(&conn).await.unwrap();
        let hits = rag_store::nearest(
            &table,
            &vec![0.1f32; EMBEDDING_DIM],
            5,
            Some("matter-a"),
            false,
            &[],
        )
        .await
        .unwrap();
        let hit = hits
            .iter()
            .find(|h| decrypt_hit_path(h, &rag_key) == "onedrive:drive-a:item-1")
            .expect("indexed OneDrive hit is retrievable by mapped matter");
        assert_eq!(hit.source_type.as_deref(), Some("onedrive"));
        assert_eq!(hit.matter_id.as_deref(), Some("matter-a"));
        assert!(decrypt_hit_text(hit, &rag_key).contains("Acme household"));
    }

    #[tokio::test]
    async fn remapped_unchanged_item_reindexes_chunks_under_new_matter() {
        let dir = TempDir::new().unwrap();
        let store = OneDriveStore::open_with_key(dir.path(), &[0x44; 32]).unwrap();
        let rag_key = [0x5a; 32];
        let first_page = DeltaPage {
            value: vec![file_item(
                "item-1",
                "memo.txt",
                "drive-a",
                "/drive/root:/Clients/Acme",
                "same-sig",
            )],
            delta_link: Some("delta-a".into()),
            ..Default::default()
        };
        let first_source = FakeSource::new(first_page)
            .with_download("item-1", b"Confidential OneDrive planning memo for remap.")
            .await;
        let first_map = vec![OneDriveMatterMapEntry {
            folder_key: folder_key(DEFAULT_ACCOUNT, None, "drive-a", "/clients/acme"),
            matter_id: "matter-a".into(),
        }];
        sync_documents(
            &first_source,
            &store,
            dir.path(),
            &first_map,
            &AtomicBool::new(false),
            &rag_key,
            &AtomicU32::new(0),
        )
        .await
        .unwrap();

        let second_page = DeltaPage {
            value: vec![file_item(
                "item-1",
                "memo.txt",
                "drive-a",
                "/drive/root:/Clients/Acme",
                "same-sig",
            )],
            delta_link: Some("delta-b".into()),
            ..Default::default()
        };
        let second_source = FakeSource::new(second_page)
            .with_download("item-1", b"Confidential OneDrive planning memo for remap.")
            .await;
        let second_map = vec![OneDriveMatterMapEntry {
            folder_key: folder_key(DEFAULT_ACCOUNT, None, "drive-a", "/clients/acme"),
            matter_id: "matter-b".into(),
        }];
        let report = sync_documents(
            &second_source,
            &store,
            dir.path(),
            &second_map,
            &AtomicBool::new(false),
            &rag_key,
            &AtomicU32::new(0),
        )
        .await
        .unwrap();

        assert_eq!(report.skipped_unchanged, 0);
        assert_eq!(report.downloaded, 1);
        assert_eq!(second_source.download_count.load(Ordering::SeqCst), 1);
        let row = store.get_item("onedrive:drive-a:item-1").unwrap().unwrap();
        assert_eq!(row.matter_id, "matter-b");

        let conn = rag_store::open_connection(dir.path()).await.unwrap();
        let table = rag_store::open_or_create_table(&conn).await.unwrap();
        let old_matter_hits = rag_store::nearest(
            &table,
            &vec![0.1f32; EMBEDDING_DIM],
            5,
            Some("matter-a"),
            false,
            &[],
        )
        .await
        .unwrap();
        assert!(
            old_matter_hits
                .iter()
                .all(|h| decrypt_hit_path(h, &rag_key) != "onedrive:drive-a:item-1"),
            "remap must remove the old matter's encrypted OneDrive chunks"
        );
        let new_matter_hits = rag_store::nearest(
            &table,
            &vec![0.1f32; EMBEDDING_DIM],
            5,
            Some("matter-b"),
            false,
            &[],
        )
        .await
        .unwrap();
        assert!(
            new_matter_hits
                .iter()
                .any(|h| decrypt_hit_path(h, &rag_key) == "onedrive:drive-a:item-1"),
            "remapped OneDrive chunks must be retrievable only under the new matter"
        );
    }

    #[tokio::test]
    async fn non_default_drive_source_uses_its_own_cursor_and_indexes_mapping() {
        let dir = TempDir::new().unwrap();
        let store = OneDriveStore::open_with_key(dir.path(), &[0x44; 32]).unwrap();
        let page = DeltaPage {
            value: vec![file_item(
                "item-99",
                "shared.txt",
                "drive-shared",
                "/drive/root:/Clients/Shared",
                "v1",
            )],
            delta_link: Some("delta-shared".into()),
            ..Default::default()
        };
        let source = FakeSource::new(page)
            .with_root_key("m365/default/drive-shared")
            .with_download("item-99", b"Shared drive matter note from OneDrive.")
            .await;
        let matter_map = vec![OneDriveMatterMapEntry {
            folder_key: folder_key(DEFAULT_ACCOUNT, None, "drive-shared", "/clients/shared"),
            matter_id: "matter-shared".into(),
        }];

        let report = sync_documents(
            &source,
            &store,
            dir.path(),
            &matter_map,
            &AtomicBool::new(false),
            &[0x5b; 32],
            &AtomicU32::new(0),
        )
        .await
        .unwrap();

        assert_eq!(report.downloaded, 1);
        assert!(report.indexed > 0);
        assert_eq!(
            store
                .get_cursor("m365/default/drive-shared")
                .unwrap()
                .as_deref(),
            Some("delta-shared")
        );
        assert!(store.get_cursor("m365/default/me").unwrap().is_none());
        assert_eq!(
            store
                .get_item("onedrive:drive-shared:item-99")
                .unwrap()
                .unwrap()
                .matter_id,
            "matter-shared"
        );
    }

    #[tokio::test]
    async fn cancelled_downloaded_index_does_not_mark_item_indexed_or_advance_cursor() {
        let dir = TempDir::new().unwrap();
        let store = OneDriveStore::open_with_key(dir.path(), &[0x44; 32]).unwrap();
        store.set_cursor("m365/default/me", "old-delta").unwrap();
        store
            .upsert_item(
                "onedrive:drive-a:item-1",
                "drive-a",
                None,
                "item-1",
                "memo.txt",
                "/clients/acme",
                None,
                "old-sig|||0",
                "hash",
                "matter-a",
                true,
                false,
            )
            .unwrap();
        let cancel = Arc::new(AtomicBool::new(false));
        let page = DeltaPage {
            value: vec![file_item(
                "item-1",
                "memo.txt",
                "drive-a",
                "/drive/root:/Clients/Acme",
                "new-sig",
            )],
            delta_link: Some("new-delta".into()),
            ..Default::default()
        };
        let source = FakeSource::new(page)
            .with_cancel_on_download(cancel.clone())
            .with_download("item-1", b"Cancelled OneDrive note should retry.")
            .await;
        let matter_map = vec![OneDriveMatterMapEntry {
            folder_key: folder_key(DEFAULT_ACCOUNT, None, "drive-a", "/clients/acme"),
            matter_id: "matter-a".into(),
        }];

        let report = sync_documents(
            &source,
            &store,
            dir.path(),
            &matter_map,
            &cancel,
            &[0x5c; 32],
            &AtomicU32::new(0),
        )
        .await
        .unwrap();

        assert!(report.cancelled);
        assert_eq!(
            store.get_cursor("m365/default/me").unwrap().as_deref(),
            Some("old-delta")
        );
        let row = store.get_item("onedrive:drive-a:item-1").unwrap().unwrap();
        assert!(!row.indexed, "cancelled item must retry on the next sync");
        assert_eq!(row.remote_signature, "old-sig|||0");
    }
}
