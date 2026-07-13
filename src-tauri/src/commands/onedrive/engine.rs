//! OneDrive / SharePoint sync engine.
//!
//! The engine is network-agnostic: it depends on `DocumentSource`, so tests can
//! drive delta pages and downloads completely offline.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};

use sha2::{Digest, Sha256};

use crate::commands::onedrive::model::{
    parent_folder_path, parse_folder_key, sanitize_path_segment, subpath_below_matched, DriveItem,
    OneDriveMatterMapEntry, DEFAULT_ACCOUNT,
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
    /// Files written into a client's workspace folder on disk. These show in the
    /// client's Documents tab and are indexed by the normal local-file pipeline.
    pub imported: u32,
    pub indexed: u32,
    pub skipped_unchanged: u32,
    pub removed: u32,
    pub pending_pdf: u32,
    pub unsupported: u32,
    pub repaired: u32,
    pub delta_reset: bool,
    pub cancelled: bool,
    /// Per-file safety errors that should be shown as retry/action-needed
    /// details, without failing the whole sync.
    pub errors: Vec<String>,
}

impl OneDriveSyncReport {
    pub fn merge_from(&mut self, other: OneDriveSyncReport) {
        self.seen += other.seen;
        self.downloaded += other.downloaded;
        self.imported += other.imported;
        self.indexed += other.indexed;
        self.skipped_unchanged += other.skipped_unchanged;
        self.removed += other.removed;
        self.pending_pdf += other.pending_pdf;
        self.unsupported += other.unsupported;
        self.repaired += other.repaired;
        self.delta_reset |= other.delta_reset;
        self.cancelled |= other.cancelled;
        self.errors.extend(other.errors);
    }
}

pub fn content_hash(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

/// Where a mapped item should be materialized on disk: the matter's workspace
/// folder plus the normalized OneDrive path of the folder that matched (so the
/// sub-structure below it can be mirrored).
#[derive(Debug, Clone)]
pub struct MatchedDest {
    pub dest_folder: String,
    pub matched_path: String,
}

pub fn resolve_matter_for_item(item: &DriveItem, matter_map: &[OneDriveMatterMapEntry]) -> String {
    resolve_matter_and_dest_for_item(item, matter_map).0
}

/// Resolve the matter id for an item AND, when the winning mapping declares a
/// disk destination (`dest_folder`), where to materialize the file. The longest
/// matching folder wins, mirroring `resolve_matter_for_item`.
pub fn resolve_matter_and_dest_for_item(
    item: &DriveItem,
    matter_map: &[OneDriveMatterMapEntry],
) -> (String, Option<MatchedDest>) {
    let drive_id = item.drive_id();
    let site_id = item.site_id();
    let folder_path = parent_folder_path(item);
    let mut best: Option<(&OneDriveMatterMapEntry, String, usize)> = None;
    for entry in matter_map {
        let Some(parts) = parse_folder_key(&entry.folder_key) else {
            continue;
        };
        if parts.account != DEFAULT_ACCOUNT
            || parts.drive_id != drive_id
            || !site_ids_match_for_item(site_id.as_deref(), parts.site_id.as_deref())
        {
            continue;
        }
        if path_prefix_matches(&folder_path, &parts.path) {
            let len = parts.path.len();
            if best.as_ref().map(|(_, _, bl)| len > *bl).unwrap_or(true) {
                best = Some((entry, parts.path, len));
            }
        }
    }
    match best {
        Some((entry, matched_path, _)) => {
            let dest = if entry.dest_folder.trim().is_empty() {
                None
            } else {
                Some(MatchedDest {
                    dest_folder: entry.dest_folder.clone(),
                    matched_path,
                })
            };
            (entry.matter_id.clone(), dest)
        }
        None => (UNASSIGNED_MATTER.to_string(), None),
    }
}

/// The subfolder under a client's folder where imported OneDrive/SharePoint files
/// are materialized. Namespacing them keeps the connector's mirror from ever
/// overwriting the client's own same-named local documents, and makes the
/// provenance obvious in the Documents tree.
const ONEDRIVE_IMPORT_SUBFOLDER: &str = "OneDrive";

/// Build the absolute on-disk path a downloaded item is materialized to, keeping
/// it strictly under `workspace/<dest_folder>/OneDrive`. Every path segment is
/// sanitized, so a hostile folder or file name cannot traverse out of the
/// destination. Returns `None` when any segment is unsafe (the caller then falls
/// back to RAG-only indexing).
fn safe_workspace_path(
    workspace: &Path,
    dest_folder: &str,
    subpath: &[String],
    name: &str,
) -> Option<PathBuf> {
    let mut p = workspace.to_path_buf();
    for seg in dest_folder
        .replace('\\', "/")
        .split('/')
        .filter(|s| !s.is_empty())
    {
        p.push(sanitize_path_segment(seg)?);
    }
    // Namespace the connector's files so they never clobber the client's own
    // local documents that happen to share a name.
    p.push(ONEDRIVE_IMPORT_SUBFOLDER);
    for seg in subpath {
        p.push(sanitize_path_segment(seg)?);
    }
    p.push(sanitize_path_segment(name)?);
    Some(p)
}

/// When the connector wants to write to `target` but a file it does NOT own is
/// already sitting there (a user's kept-and-edited copy after a keep-files
/// disconnect, or another item's same-named file), it diverts here so nothing
/// the user has is ever overwritten. Produces a sibling `name (OneDrive).ext`,
/// then `name (OneDrive 2).ext`, … until a free path is found.
fn conflict_copy_path(target: &Path) -> anyhow::Result<PathBuf> {
    let parent = target.parent();
    let stem = target
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default();
    let ext = target.extension().map(|e| e.to_string_lossy().to_string());
    let build = |suffix: &str| -> PathBuf {
        let filename = match &ext {
            Some(e) => format!("{stem} ({suffix}).{e}"),
            None => format!("{stem} ({suffix})"),
        };
        match parent {
            Some(p) => p.join(filename),
            None => PathBuf::from(filename),
        }
    };
    let first = build("OneDrive");
    if !first.exists() {
        return Ok(first);
    }
    for n in 2..1000 {
        let candidate = build(&format!("OneDrive {n}"));
        if !candidate.exists() {
            return Ok(candidate);
        }
    }
    anyhow::bail!(
        "all OneDrive conflict-copy names are already occupied for {}",
        target.display()
    )
}

fn report_stored_path_error(
    report: &mut OneDriveSyncReport,
    source_id: &str,
    rel: &str,
    action: &str,
    error: impl std::fmt::Display,
) {
    report.errors.push(format!(
        "OneDrive skipped {action} for {source_id}: stored path {rel:?} is unsafe ({error})."
    ));
}

fn resolve_stored_path_for_write(canon_workspace: &Path, rel: &str) -> Result<PathBuf, String> {
    crate::commands::pathguard::resolve_creatable(canon_workspace, rel, canon_workspace)
}

fn remove_stored_file_best_effort(
    report: &mut OneDriveSyncReport,
    canon_workspace: &Path,
    source_id: &str,
    rel: &str,
    action: &str,
) {
    match crate::commands::pathguard::canonicalize_workspace_relative(canon_workspace, rel) {
        Ok(Some(abs)) => {
            let _ = std::fs::remove_file(abs);
        }
        Ok(None) => {}
        Err(e) => report_stored_path_error(report, source_id, rel, action, e),
    }
}

fn site_ids_match_for_item(item_site_id: Option<&str>, folder_site_id: Option<&str>) -> bool {
    match item_site_id {
        Some(site_id) => folder_site_id == Some(site_id),
        None => true,
    }
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
    let canon_workspace = workspace.canonicalize()?;
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
            // Remove the materialized on-disk copy first (best-effort). The
            // workspace watcher then drops its RAG chunks; we also delete any
            // remaining external chunks for items that were RAG-only.
            if let Some(local) = store.get_local_path(&key.source_id)? {
                remove_stored_file_best_effort(
                    &mut report,
                    &canon_workspace,
                    &key.source_id,
                    &local,
                    "remote-delete cleanup",
                );
            }
            store.mark_deleted(&key.source_id)?;
            rag_store::delete_path(&table, &key.source_id, rag_key).await?;
            report.removed += 1;
            continue;
        }
        if !item.is_file() {
            continue;
        }

        let (matter_id, dest) = resolve_matter_and_dest_for_item(item, matter_map);
        let parent_path = parent_folder_path(item);
        let remote_signature = item.remote_signature();
        let existing = store.get_item(&key.source_id)?;

        // For a mapped item, the on-disk path it should be materialized to. `None`
        // means "index bytes into RAG only" (unmapped, or a name we cannot safely
        // place on disk).
        let local_target: Option<PathBuf> = dest.as_ref().and_then(|d| {
            let sub = subpath_below_matched(item, &d.matched_path);
            safe_workspace_path(workspace, &d.dest_folder, &sub, &item.name)
        });

        let needs_repair = existing
            .as_ref()
            .map(|row| !row.indexed && !row.pending_pdf)
            .unwrap_or(false);
        // Unchanged fast-path. A materialized item is only truly unchanged if its
        // on-disk copy still exists — otherwise we must re-download it so a file
        // the user (or a failed prior sync) removed comes back.
        let disk_still_present = match &local_target {
            Some(target) => target.exists(),
            None => true,
        };
        if disk_still_present
            && existing
                .as_ref()
                .map(|row| {
                    row.remote_signature == remote_signature
                        && row.indexed
                        && row.matter_id == matter_id
                        && row.parent_path == parent_path
                        && row.drive_id == key.drive_id
                        && row.site_id == key.site_id
                })
                .unwrap_or(false)
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

        // MAPPED to a client with an on-disk destination: materialize the file
        // into the client's workspace folder. It then shows in the client's
        // Documents tab and is indexed for search by the normal local-file
        // watcher — exactly like a file the user dropped in themselves. This
        // covers PDFs too (visible immediately; text indexed by the PDF path).
        if let Some(target) = &local_target {
            // Honour a Stop pressed DURING this file's download (the top-of-loop
            // check already passed): don't commit the write, mark the row for
            // retry, and stop before the cursor is advanced.
            if cancel.load(Ordering::SeqCst) {
                if existing.is_some() {
                    store.mark_needs_index(&key.source_id)?;
                }
                report.cancelled = true;
                break;
            }
            let target_rel = target
                .strip_prefix(workspace)
                .ok()
                .map(|p| p.to_string_lossy().replace('\\', "/"));
            // The path THIS item was last materialized to, if any. After a
            // keep-files disconnect the tracking DB is gone, so this is `None`
            // even though the user's kept copy still sits on disk.
            let owned = store.get_local_path(&key.source_id)?;

            // F2: never overwrite a file this item does not already own. Writing
            // remote bytes straight onto a user's kept-and-edited copy (owned is
            // None after a keep-files disconnect, yet the file exists at `target`)
            // would silently lose their edits. Resolve the real write path:
            //   - we already own the target        → in-place update (overwrite)
            //   - target free                       → normal write (first import / rename)
            //   - target occupied, we own elsewhere → keep updating OUR copy in place
            //   - target occupied, we own nothing   → divert to a conflict copy
            let (write_path, write_rel): (PathBuf, Option<String>) = if owned.as_deref()
                == target_rel.as_deref()
                || !target.exists()
            {
                (target.clone(), target_rel.clone())
            } else if let Some(other) = &owned {
                match resolve_stored_path_for_write(&canon_workspace, other) {
                    Ok(abs) => (abs, Some(other.clone())),
                    Err(e) => {
                        report_stored_path_error(
                            &mut report,
                            &key.source_id,
                            other,
                            "reconnect write",
                            e,
                        );
                        continue;
                    }
                }
            } else {
                let cp = match conflict_copy_path(target) {
                    Ok(cp) => cp,
                    Err(e) => {
                        report.errors.push(format!(
                                "OneDrive could not import {} because every conflict-copy name beside {} is already in use: {e}",
                                key.source_id,
                                target.display()
                            ));
                        continue;
                    }
                };
                let Some(rel) = cp
                    .strip_prefix(workspace)
                    .ok()
                    .map(|p| p.to_string_lossy().replace('\\', "/"))
                else {
                    report.errors.push(format!(
                            "OneDrive could not import {} because the conflict-copy path escaped the workspace.",
                            key.source_id
                        ));
                    continue;
                };
                (cp, Some(rel))
            };

            if let Some(parent) = write_path.parent() {
                std::fs::create_dir_all(parent).map_err(|e| {
                    anyhow::anyhow!("create client folder {}: {e}", parent.display())
                })?;
            }
            // If this item was previously materialized at a DIFFERENT path (a
            // remote rename or move keeps the same source_id), remove the old copy
            // so it can't linger as stale content in the client's Documents.
            if let Some(old) = &owned {
                if write_rel.as_deref() != Some(old.as_str()) {
                    remove_stored_file_best_effort(
                        &mut report,
                        &canon_workspace,
                        &key.source_id,
                        old,
                        "stale-copy cleanup",
                    );
                }
            }
            std::fs::write(&write_path, &bytes)
                .map_err(|e| anyhow::anyhow!("write {}: {e}", write_path.display()))?;
            // If this item was previously indexed RAG-only (unmapped), drop those
            // chunks so the on-disk copy (indexed by the watcher under its disk
            // path) is not duplicated by stale `onedrive:` chunks.
            rag_store::delete_path(&table, &key.source_id, rag_key).await?;
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
            if let Some(rel) = write_rel {
                store.set_local_path(&key.source_id, &rel)?;
            }
            report.imported += 1;
            continue;
        }

        // UNMAPPED (or a name we can't safely place on disk): keep the legacy
        // behaviour of indexing the bytes into the encrypted RAG store, so the
        // content is still searchable in the All-clients scope.
        //
        // If this item WAS previously materialized to a client's folder (its
        // folder has since been unlinked or remapped away from a disk
        // destination), remove the stale on-disk copy and forget it — otherwise
        // it keeps showing under the old client's Documents and a later tombstone
        // would act on an obsolete path.
        if let Some(old) = store.get_local_path(&key.source_id)? {
            remove_stored_file_best_effort(
                &mut report,
                &canon_workspace,
                &key.source_id,
                &old,
                "unmapped-file cleanup",
            );
            store.clear_local_path(&key.source_id)?;
        }
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
                dest_folder: String::new(),
            },
            OneDriveMatterMapEntry {
                folder_key: folder_key(DEFAULT_ACCOUNT, None, "drive-a", "/clients/acme/pleadings"),
                matter_id: "matter-child".into(),
                dest_folder: String::new(),
            },
            OneDriveMatterMapEntry {
                folder_key: folder_key(DEFAULT_ACCOUNT, None, "drive-b", "/clients/acme/pleadings"),
                matter_id: "wrong-drive".into(),
                dest_folder: String::new(),
            },
        ];
        assert_eq!(resolve_matter_for_item(&item, &map), "matter-child");
    }

    #[test]
    fn sharepoint_child_delta_without_site_id_matches_by_drive_and_path_only() {
        let item = file_item(
            "sp-child",
            "memo.txt",
            "drive-sp",
            "/drive/root:/Clients/Acme/Pleadings",
            "a",
        );
        assert_eq!(item.site_id(), None);

        let map = vec![OneDriveMatterMapEntry {
            folder_key: folder_key(
                DEFAULT_ACCOUNT,
                Some("site-123"),
                "drive-sp",
                "/clients/acme",
            ),
            matter_id: "matter-sharepoint".into(),
            dest_folder: String::new(),
        }];

        assert_eq!(resolve_matter_for_item(&item, &map), "matter-sharepoint");

        let different_drive_item = file_item(
            "sp-other-child",
            "memo.txt",
            "drive-other",
            "/drive/root:/Clients/Acme/Pleadings",
            "a",
        );
        assert_eq!(
            resolve_matter_for_item(&different_drive_item, &map),
            UNASSIGNED_MATTER
        );
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
            dest_folder: String::new(),
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
    #[ignore = "requires fastembed model — pre-existing, unrelated to rename"]
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
    #[ignore = "requires fastembed model — pre-existing, unrelated to rename"]
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
            dest_folder: String::new(),
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
    #[ignore = "requires fastembed model — pre-existing, unrelated to rename"]
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
            dest_folder: String::new(),
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
            dest_folder: String::new(),
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
    #[ignore = "requires fastembed model — pre-existing, unrelated to rename"]
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
            dest_folder: String::new(),
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
            dest_folder: String::new(),
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

    // A mapping whose `dest_folder` is set materializes the file into the
    // client's workspace folder on disk (so it appears in the Documents tab and
    // is indexed by the normal local-file watcher). This is the core OneDrive
    // real-file-import fix: before it, a matched file was never written to disk.
    #[tokio::test]
    async fn mapped_file_is_written_into_client_workspace_folder() {
        let dir = TempDir::new().unwrap();
        let store = OneDriveStore::open_with_key(dir.path(), &[0x44; 32]).unwrap();
        let page = DeltaPage {
            value: vec![file_item(
                "item-1",
                "Risk Assessment.docx",
                "drive-a",
                "/drive/root:/Clients/Webb, Marcus & Tanya",
                "v1",
            )],
            delta_link: Some("delta-next".into()),
            ..Default::default()
        };
        let source = FakeSource::new(page)
            .with_download("item-1", b"real client document bytes")
            .await;
        let matter_map = vec![OneDriveMatterMapEntry {
            folder_key: folder_key(
                DEFAULT_ACCOUNT,
                None,
                "drive-a",
                "/clients/webb, marcus & tanya",
            ),
            matter_id: "matter-webb".into(),
            dest_folder: "Clients/Webb, Marcus & Tanya".into(),
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

        assert_eq!(report.imported, 1, "the mapped file must be imported");
        assert_eq!(report.downloaded, 1);
        // Materialized under an `OneDrive` subfolder of the client folder so it can
        // never clobber the client's own same-named local document.
        let written = dir
            .path()
            .join("Clients/Webb, Marcus & Tanya/OneDrive/Risk Assessment.docx");
        assert!(
            written.exists(),
            "mapped OneDrive file must be written into the client's workspace folder"
        );
        assert_eq!(
            std::fs::read(&written).unwrap(),
            b"real client document bytes"
        );
        // The store remembers where it landed so a later remote-delete can remove
        // the local copy.
        assert_eq!(
            store.get_local_path("onedrive:drive-a:item-1").unwrap(),
            Some("Clients/Webb, Marcus & Tanya/OneDrive/Risk Assessment.docx".to_string())
        );
    }

    // BUG-11's exact Windows-bench shape: a client-named folder at the drive
    // root (not below a generic `Clients` folder) containing one real PDF.
    // The pre-fix connector downloaded this into its private search store but
    // never materialized it into the client's Documents area.
    #[tokio::test]
    async fn bug_11_exact_top_level_pdf_import_reaches_client_documents() {
        let dir = TempDir::new().unwrap();
        let store = OneDriveStore::open_with_key(dir.path(), &[0x44; 32]).unwrap();
        let page = DeltaPage {
            value: vec![file_item(
                "risk-assessment",
                "Risk Assessment.pdf",
                "drive-a",
                "/drive/root:/Webb, Marcus & Tanya",
                "v1",
            )],
            delta_link: Some("delta-next".into()),
            ..Default::default()
        };
        let source = FakeSource::new(page)
            .with_download("risk-assessment", b"real PDF bytes")
            .await;
        let matter_map = vec![OneDriveMatterMapEntry {
            folder_key: folder_key(DEFAULT_ACCOUNT, None, "drive-a", "/webb, marcus & tanya"),
            matter_id: "matter-webb".into(),
            dest_folder: "Clients/Webb, Marcus & Tanya".into(),
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

        let written = dir
            .path()
            .join("Clients/Webb, Marcus & Tanya/OneDrive/Risk Assessment.pdf");
        assert_eq!(report.imported, 1);
        assert_eq!(report.downloaded, 1);
        assert!(
            written.exists(),
            "a PDF inside an exact-name top-level OneDrive folder must appear in the client's Documents area"
        );
        assert_eq!(std::fs::read(&written).unwrap(), b"real PDF bytes");
        assert_eq!(
            store
                .get_local_path("onedrive:drive-a:risk-assessment")
                .unwrap(),
            Some("Clients/Webb, Marcus & Tanya/OneDrive/Risk Assessment.pdf".to_string())
        );
    }

    // The connector must never overwrite the client's OWN same-named local file:
    // its imports land under the `OneDrive` subfolder, leaving local files intact.
    #[tokio::test]
    async fn mapped_file_does_not_clobber_existing_client_file() {
        let dir = TempDir::new().unwrap();
        let store = OneDriveStore::open_with_key(dir.path(), &[0x44; 32]).unwrap();
        // A pre-existing local file the user owns.
        let user_file = dir.path().join("Clients/Acme/memo.docx");
        std::fs::create_dir_all(user_file.parent().unwrap()).unwrap();
        std::fs::write(&user_file, b"USER'S OWN EDITS").unwrap();

        let page = DeltaPage {
            value: vec![file_item(
                "item-1",
                "memo.docx",
                "drive-a",
                "/drive/root:/Clients/Acme",
                "v1",
            )],
            delta_link: Some("d".into()),
            ..Default::default()
        };
        let source = FakeSource::new(page)
            .with_download("item-1", b"cloud copy")
            .await;
        let matter_map = vec![OneDriveMatterMapEntry {
            folder_key: folder_key(DEFAULT_ACCOUNT, None, "drive-a", "/clients/acme"),
            matter_id: "matter-acme".into(),
            dest_folder: "Clients/Acme".into(),
        }];
        sync_documents(
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

        assert_eq!(
            std::fs::read(&user_file).unwrap(),
            b"USER'S OWN EDITS",
            "the user's own local file must not be overwritten"
        );
        assert!(dir.path().join("Clients/Acme/OneDrive/memo.docx").exists());
    }

    // A remote rename keeps the same source_id; the stale old on-disk copy must be
    // removed so it can't linger as duplicate content.
    #[tokio::test]
    async fn remote_rename_removes_stale_disk_copy() {
        let dir = TempDir::new().unwrap();
        let store = OneDriveStore::open_with_key(dir.path(), &[0x44; 32]).unwrap();
        let matter_map = vec![OneDriveMatterMapEntry {
            folder_key: folder_key(DEFAULT_ACCOUNT, None, "drive-a", "/clients/acme"),
            matter_id: "matter-acme".into(),
            dest_folder: "Clients/Acme".into(),
        }];
        let first = FakeSource::new(DeltaPage {
            value: vec![file_item(
                "item-1",
                "old.docx",
                "drive-a",
                "/drive/root:/Clients/Acme",
                "v1",
            )],
            delta_link: Some("d1".into()),
            ..Default::default()
        })
        .with_download("item-1", b"bytes")
        .await;
        sync_documents(
            &first,
            &store,
            dir.path(),
            &matter_map,
            &AtomicBool::new(false),
            &[0x55; 32],
            &AtomicU32::new(0),
        )
        .await
        .unwrap();
        assert!(dir.path().join("Clients/Acme/OneDrive/old.docx").exists());

        // Same item id, new name + signature (a rename).
        let second = FakeSource::new(DeltaPage {
            value: vec![file_item(
                "item-1",
                "new.docx",
                "drive-a",
                "/drive/root:/Clients/Acme",
                "v2",
            )],
            delta_link: Some("d2".into()),
            ..Default::default()
        })
        .with_download("item-1", b"bytes")
        .await;
        sync_documents(
            &second,
            &store,
            dir.path(),
            &matter_map,
            &AtomicBool::new(false),
            &[0x55; 32],
            &AtomicU32::new(0),
        )
        .await
        .unwrap();
        assert!(dir.path().join("Clients/Acme/OneDrive/new.docx").exists());
        assert!(
            !dir.path().join("Clients/Acme/OneDrive/old.docx").exists(),
            "the pre-rename copy must be removed"
        );
    }

    // Unlinking a folder (the item no longer maps to a client with a disk
    // destination) removes the stale materialized copy and forgets its path, so it
    // stops showing under the old client. Uses an empty .txt so the RAG fallback
    // needs no embedding model.
    #[tokio::test]
    async fn unmapping_removes_stale_materialized_file() {
        let dir = TempDir::new().unwrap();
        let store = OneDriveStore::open_with_key(dir.path(), &[0x44; 32]).unwrap();
        let mapped = vec![OneDriveMatterMapEntry {
            folder_key: folder_key(DEFAULT_ACCOUNT, None, "drive-a", "/clients/acme"),
            matter_id: "matter-acme".into(),
            dest_folder: "Clients/Acme".into(),
        }];
        let page = || DeltaPage {
            value: vec![file_item(
                "item-1",
                "memo.txt",
                "drive-a",
                "/drive/root:/Clients/Acme",
                "v1",
            )],
            delta_link: Some("d".into()),
            ..Default::default()
        };
        // First sync: materialized to disk under the client.
        let first = FakeSource::new(page()).with_download("item-1", b"").await;
        sync_documents(
            &first,
            &store,
            dir.path(),
            &mapped,
            &AtomicBool::new(false),
            &[0x55; 32],
            &AtomicU32::new(0),
        )
        .await
        .unwrap();
        let on_disk = dir.path().join("Clients/Acme/OneDrive/memo.txt");
        assert!(on_disk.exists());

        // Second sync with the folder UNLINKED (empty map) → no disk destination.
        let second = FakeSource::new(page()).with_download("item-1", b"").await;
        sync_documents(
            &second,
            &store,
            dir.path(),
            &[],
            &AtomicBool::new(false),
            &[0x55; 32],
            &AtomicU32::new(0),
        )
        .await
        .unwrap();
        assert!(
            !on_disk.exists(),
            "unlinking must remove the stale materialized copy"
        );
        assert_eq!(
            store.get_local_path("onedrive:drive-a:item-1").unwrap(),
            None,
            "the forgotten path must be cleared"
        );
    }

    // Stop pressed while a MAPPED file is downloading must not commit the write,
    // mark it indexed, or advance the cursor.
    #[tokio::test]
    async fn cancel_during_materialize_does_not_write_or_advance() {
        let dir = TempDir::new().unwrap();
        let store = OneDriveStore::open_with_key(dir.path(), &[0x44; 32]).unwrap();
        let cancel = Arc::new(AtomicBool::new(false));
        let page = DeltaPage {
            value: vec![file_item(
                "item-1",
                "big.docx",
                "drive-a",
                "/drive/root:/Clients/Acme",
                "v1",
            )],
            delta_link: Some("new-delta".into()),
            ..Default::default()
        };
        let source = FakeSource::new(page)
            .with_cancel_on_download(cancel.clone())
            .with_download("item-1", b"partial")
            .await;
        let matter_map = vec![OneDriveMatterMapEntry {
            folder_key: folder_key(DEFAULT_ACCOUNT, None, "drive-a", "/clients/acme"),
            matter_id: "matter-acme".into(),
            dest_folder: "Clients/Acme".into(),
        }];

        let report = sync_documents(
            &source,
            &store,
            dir.path(),
            &matter_map,
            &cancel,
            &[0x55; 32],
            &AtomicU32::new(0),
        )
        .await
        .unwrap();

        assert!(report.cancelled);
        assert_eq!(report.imported, 0);
        assert!(
            !dir.path().join("Clients/Acme/OneDrive/big.docx").exists(),
            "a cancelled mapped download must not write the file"
        );
        assert!(
            store.get_cursor("m365/default/me").unwrap().is_none(),
            "the cursor must not advance on cancel"
        );
    }

    // A mapped nested file mirrors its OneDrive sub-folder structure under the
    // client's workspace folder.
    #[tokio::test]
    async fn mapped_nested_file_mirrors_subfolder_structure() {
        let dir = TempDir::new().unwrap();
        let store = OneDriveStore::open_with_key(dir.path(), &[0x44; 32]).unwrap();
        let page = DeltaPage {
            value: vec![file_item(
                "item-2",
                "2023.pdf",
                "drive-a",
                "/drive/root:/Clients/Acme/Tax",
                "v1",
            )],
            delta_link: Some("d".into()),
            ..Default::default()
        };
        let source = FakeSource::new(page)
            .with_download("item-2", b"pdf bytes")
            .await;
        let matter_map = vec![OneDriveMatterMapEntry {
            folder_key: folder_key(DEFAULT_ACCOUNT, None, "drive-a", "/clients/acme"),
            matter_id: "matter-acme".into(),
            dest_folder: "Clients/Acme".into(),
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

        assert_eq!(report.imported, 1);
        assert!(dir
            .path()
            .join("Clients/Acme/OneDrive/Tax/2023.pdf")
            .exists());
    }

    // An empty delta (no matching files) reports zero imports and zero seen, so
    // the UI can honestly say "no files found" instead of a false "imported".
    #[tokio::test]
    async fn empty_delta_reports_zero_imported() {
        let dir = TempDir::new().unwrap();
        let store = OneDriveStore::open_with_key(dir.path(), &[0x44; 32]).unwrap();
        let page = DeltaPage {
            value: vec![],
            delta_link: Some("d".into()),
            ..Default::default()
        };
        let source = FakeSource::new(page);
        let report = sync_documents(
            &source,
            &store,
            dir.path(),
            &[],
            &AtomicBool::new(false),
            &[0x55; 32],
            &AtomicU32::new(0),
        )
        .await
        .unwrap();
        assert_eq!(report.imported, 0);
        assert_eq!(report.seen, 0);
        assert_eq!(report.downloaded, 0);
    }

    // A delta error is surfaced to the caller (never a silent success).
    #[tokio::test]
    async fn delta_error_is_surfaced_not_silent() {
        let dir = TempDir::new().unwrap();
        let store = OneDriveStore::open_with_key(dir.path(), &[0x44; 32]).unwrap();
        let source = FakeSource::with_pages(vec![Err(anyhow::anyhow!("graph 500 while listing"))]);
        let result = sync_documents(
            &source,
            &store,
            dir.path(),
            &[],
            &AtomicBool::new(false),
            &[0x55; 32],
            &AtomicU32::new(0),
        )
        .await;
        assert!(
            result.is_err(),
            "a delta failure must not be a silent no-op"
        );
    }

    // A remote delete removes the materialized on-disk copy too.
    #[tokio::test]
    async fn tombstone_removes_materialized_disk_file() {
        let dir = TempDir::new().unwrap();
        let store = OneDriveStore::open_with_key(dir.path(), &[0x44; 32]).unwrap();
        let matter_map = vec![OneDriveMatterMapEntry {
            folder_key: folder_key(DEFAULT_ACCOUNT, None, "drive-a", "/clients/acme"),
            matter_id: "matter-acme".into(),
            dest_folder: "Clients/Acme".into(),
        }];
        let first = FakeSource::new(DeltaPage {
            value: vec![file_item(
                "item-1",
                "memo.docx",
                "drive-a",
                "/drive/root:/Clients/Acme",
                "v1",
            )],
            delta_link: Some("d1".into()),
            ..Default::default()
        })
        .with_download("item-1", b"bytes")
        .await;
        sync_documents(
            &first,
            &store,
            dir.path(),
            &matter_map,
            &AtomicBool::new(false),
            &[0x55; 32],
            &AtomicU32::new(0),
        )
        .await
        .unwrap();
        let on_disk = dir.path().join("Clients/Acme/OneDrive/memo.docx");
        assert!(on_disk.exists());

        let second = FakeSource::new(DeltaPage {
            value: vec![deleted_item(
                "item-1",
                "memo.docx",
                "drive-a",
                "/drive/root:/Clients/Acme",
            )],
            delta_link: Some("d2".into()),
            ..Default::default()
        });
        let report = sync_documents(
            &second,
            &store,
            dir.path(),
            &matter_map,
            &AtomicBool::new(false),
            &[0x55; 32],
            &AtomicU32::new(0),
        )
        .await
        .unwrap();
        assert_eq!(report.removed, 1);
        assert!(
            !on_disk.exists(),
            "remote delete must remove the local copy"
        );
    }

    // F2: after a keep-files disconnect the tracking DB is gone; on reconnect the
    // engine must NOT overwrite a kept-and-edited file with remote bytes. It
    // diverts the remote copy to a conflict copy, so the user's edits survive.
    #[tokio::test]
    async fn reconnect_does_not_overwrite_a_kept_and_edited_file() {
        let dir = TempDir::new().unwrap();
        let matter_map = vec![OneDriveMatterMapEntry {
            folder_key: folder_key(DEFAULT_ACCOUNT, None, "drive-a", "/clients/acme"),
            matter_id: "matter-acme".into(),
            dest_folder: "Clients/Acme".into(),
        }];
        let page = || DeltaPage {
            value: vec![file_item(
                "item-1",
                "memo.docx",
                "drive-a",
                "/drive/root:/Clients/Acme",
                "v1",
            )],
            delta_link: Some("d".into()),
            ..Default::default()
        };

        // First import writes the cloud copy and tracks it.
        {
            let store = OneDriveStore::open_with_key(dir.path(), &[0x44; 32]).unwrap();
            let source = FakeSource::new(page())
                .with_download("item-1", b"cloud v1")
                .await;
            sync_documents(
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
        }
        let target = dir.path().join("Clients/Acme/OneDrive/memo.docx");
        assert_eq!(std::fs::read(&target).unwrap(), b"cloud v1");

        // Keep-files disconnect: the tracking DB is purged; the file STAYS.
        OneDriveStore::purge(dir.path()).unwrap();
        // The user then edits their kept file.
        std::fs::write(&target, b"USER EDITS I MUST KEEP").unwrap();

        // Reconnect: a fresh store (no tracking) syncs the same item again.
        let store2 = OneDriveStore::open_with_key(dir.path(), &[0x44; 32]).unwrap();
        let source2 = FakeSource::new(page())
            .with_download("item-1", b"cloud v1")
            .await;
        let report = sync_documents(
            &source2,
            &store2,
            dir.path(),
            &matter_map,
            &AtomicBool::new(false),
            &[0x55; 32],
            &AtomicU32::new(0),
        )
        .await
        .unwrap();

        assert_eq!(report.imported, 1);
        assert_eq!(
            std::fs::read(&target).unwrap(),
            b"USER EDITS I MUST KEEP",
            "reconnect must not overwrite the user's kept edits"
        );
        let conflict = dir
            .path()
            .join("Clients/Acme/OneDrive/memo (OneDrive).docx");
        assert!(
            conflict.exists(),
            "remote bytes must land as a conflict copy, not over the user's file"
        );
        assert_eq!(std::fs::read(&conflict).unwrap(), b"cloud v1");
        assert_eq!(
            store2.get_local_path("onedrive:drive-a:item-1").unwrap(),
            Some("Clients/Acme/OneDrive/memo (OneDrive).docx".to_string()),
            "the store must track the conflict copy as this item's path"
        );
    }

    // A stored local_path is DB state, not truth. On reconnect, validate it
    // before using it as a write target; an unsafe path is reported and ignored.
    #[tokio::test]
    async fn reconnect_ignores_unsafe_stored_local_path_before_write() {
        let dir = TempDir::new().unwrap();
        let store = OneDriveStore::open_with_key(dir.path(), &[0x44; 32]).unwrap();
        let matter_map = vec![OneDriveMatterMapEntry {
            folder_key: folder_key(DEFAULT_ACCOUNT, None, "drive-a", "/clients/acme"),
            matter_id: "matter-acme".into(),
            dest_folder: "Clients/Acme".into(),
        }];
        let source_id = "onedrive:drive-a:item-1";
        store
            .upsert_item(
                source_id,
                "drive-a",
                None,
                "item-1",
                "memo.docx",
                "/clients/acme",
                None,
                "old",
                "old-hash",
                "matter-acme",
                true,
                false,
            )
            .unwrap();

        let outside = tempfile::NamedTempFile::new_in(dir.path().parent().unwrap()).unwrap();
        std::fs::write(outside.path(), b"OUTSIDE ORIGINAL").unwrap();
        let escape_rel = format!(
            "../{}",
            outside.path().file_name().unwrap().to_string_lossy()
        );
        store.set_local_path(source_id, &escape_rel).unwrap();

        let target = dir.path().join("Clients/Acme/OneDrive/memo.docx");
        std::fs::create_dir_all(target.parent().unwrap()).unwrap();
        std::fs::write(&target, b"USER FILE").unwrap();

        let source = FakeSource::new(DeltaPage {
            value: vec![file_item(
                "item-1",
                "memo.docx",
                "drive-a",
                "/drive/root:/Clients/Acme",
                "new",
            )],
            delta_link: Some("d".into()),
            ..Default::default()
        })
        .with_download("item-1", b"CLOUD BYTES")
        .await;

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

        assert_eq!(report.downloaded, 1);
        assert_eq!(
            report.imported, 0,
            "an unsafe stored path must not be used as a write target"
        );
        assert!(
            report
                .errors
                .iter()
                .any(|e| e.contains("reconnect write") && e.contains("unsafe")),
            "the report must explain the unsafe stored path; got {:?}",
            report.errors
        );
        assert_eq!(
            std::fs::read(&target).unwrap(),
            b"USER FILE",
            "the occupied user file must not be overwritten"
        );
        assert_eq!(
            std::fs::read(outside.path()).unwrap(),
            b"OUTSIDE ORIGINAL",
            "the unsafe outside path must never be written"
        );
    }

    // F2: once a conflict copy exists, a later remote update rewrites THAT copy in
    // place — it never multiplies conflict copies and never touches the user's file.
    #[tokio::test]
    async fn conflict_copy_is_updated_in_place_never_multiplied() {
        let dir = TempDir::new().unwrap();
        let store = OneDriveStore::open_with_key(dir.path(), &[0x44; 32]).unwrap();
        let matter_map = vec![OneDriveMatterMapEntry {
            folder_key: folder_key(DEFAULT_ACCOUNT, None, "drive-a", "/clients/acme"),
            matter_id: "matter-acme".into(),
            dest_folder: "Clients/Acme".into(),
        }];
        // A user file already occupies the deterministic target.
        let target = dir.path().join("Clients/Acme/OneDrive/memo.docx");
        std::fs::create_dir_all(target.parent().unwrap()).unwrap();
        std::fs::write(&target, b"USER FILE").unwrap();

        let first = FakeSource::new(DeltaPage {
            value: vec![file_item(
                "item-1",
                "memo.docx",
                "drive-a",
                "/drive/root:/Clients/Acme",
                "v1",
            )],
            delta_link: Some("d1".into()),
            ..Default::default()
        })
        .with_download("item-1", b"cloud v1")
        .await;
        sync_documents(
            &first,
            &store,
            dir.path(),
            &matter_map,
            &AtomicBool::new(false),
            &[0x55; 32],
            &AtomicU32::new(0),
        )
        .await
        .unwrap();

        let second = FakeSource::new(DeltaPage {
            value: vec![file_item(
                "item-1",
                "memo.docx",
                "drive-a",
                "/drive/root:/Clients/Acme",
                "v2",
            )],
            delta_link: Some("d2".into()),
            ..Default::default()
        })
        .with_download("item-1", b"cloud v2")
        .await;
        sync_documents(
            &second,
            &store,
            dir.path(),
            &matter_map,
            &AtomicBool::new(false),
            &[0x55; 32],
            &AtomicU32::new(0),
        )
        .await
        .unwrap();

        assert_eq!(
            std::fs::read(&target).unwrap(),
            b"USER FILE",
            "the user's file must never be touched"
        );
        let conflict = dir
            .path()
            .join("Clients/Acme/OneDrive/memo (OneDrive).docx");
        assert_eq!(
            std::fs::read(&conflict).unwrap(),
            b"cloud v2",
            "the conflict copy is updated in place"
        );
        assert!(
            !dir.path()
                .join("Clients/Acme/OneDrive/memo (OneDrive 2).docx")
                .exists(),
            "a remote update must not spawn a second conflict copy"
        );
    }

    // If every conflict-copy filename is already occupied, fail this file in the
    // sync report instead of falling back to the first occupied name.
    #[tokio::test]
    async fn saturated_conflict_copy_names_report_error_without_overwrite() {
        let dir = TempDir::new().unwrap();
        let store = OneDriveStore::open_with_key(dir.path(), &[0x44; 32]).unwrap();
        let matter_map = vec![OneDriveMatterMapEntry {
            folder_key: folder_key(DEFAULT_ACCOUNT, None, "drive-a", "/clients/acme"),
            matter_id: "matter-acme".into(),
            dest_folder: "Clients/Acme".into(),
        }];
        let folder = dir.path().join("Clients/Acme/OneDrive");
        std::fs::create_dir_all(&folder).unwrap();
        let target = folder.join("memo.docx");
        std::fs::write(&target, b"USER FILE").unwrap();
        std::fs::write(folder.join("memo (OneDrive).docx"), b"occupied first").unwrap();
        for n in 2..1000 {
            std::fs::write(
                folder.join(format!("memo (OneDrive {n}).docx")),
                format!("occupied {n}"),
            )
            .unwrap();
        }

        let source = FakeSource::new(DeltaPage {
            value: vec![file_item(
                "item-1",
                "memo.docx",
                "drive-a",
                "/drive/root:/Clients/Acme",
                "v1",
            )],
            delta_link: Some("d".into()),
            ..Default::default()
        })
        .with_download("item-1", b"CLOUD BYTES")
        .await;

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

        assert_eq!(report.downloaded, 1);
        assert_eq!(report.imported, 0);
        assert!(
            report.errors.iter().any(|e| e.contains("conflict-copy")),
            "the saturated conflict-copy failure must be reported; got {:?}",
            report.errors
        );
        assert_eq!(std::fs::read(&target).unwrap(), b"USER FILE");
        assert_eq!(
            std::fs::read(folder.join("memo (OneDrive).docx")).unwrap(),
            b"occupied first",
            "the first conflict-copy name is known occupied and must not be overwritten"
        );
        assert_eq!(
            store.get_local_path("onedrive:drive-a:item-1").unwrap(),
            None,
            "the failed file must not claim ownership of any occupied path"
        );
    }
}
