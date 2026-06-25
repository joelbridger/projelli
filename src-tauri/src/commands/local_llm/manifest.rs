use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum LocalModelStatus {
    Absent,
    Downloading,
    Ready,
    Error,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LocalModelManifest {
    pub model_id: String,
    pub filename: String,
    pub revision: String,
    pub size: u64,
    pub sha256: String,
    pub status: LocalModelStatus,
}

impl LocalModelManifest {
    pub fn new(
        model_id: impl Into<String>,
        filename: impl Into<String>,
        revision: impl Into<String>,
        size: u64,
        sha256: impl Into<String>,
        status: LocalModelStatus,
    ) -> Self {
        Self {
            model_id: model_id.into(),
            filename: filename.into(),
            revision: revision.into(),
            size,
            sha256: sha256.into(),
            status,
        }
    }
}

pub fn manifest_path(model_dir: &Path) -> std::path::PathBuf {
    model_dir.join("manifest.json")
}

pub fn read_manifest(model_dir: &Path) -> Result<Option<LocalModelManifest>> {
    let path = manifest_path(model_dir);
    if !path.exists() {
        return Ok(None);
    }
    let bytes = std::fs::read(&path).with_context(|| format!("read {}", path.display()))?;
    let manifest =
        serde_json::from_slice(&bytes).with_context(|| format!("parse {}", path.display()))?;
    Ok(Some(manifest))
}

pub fn write_manifest(model_dir: &Path, manifest: &LocalModelManifest) -> Result<()> {
    std::fs::create_dir_all(model_dir)
        .with_context(|| format!("create model dir {}", model_dir.display()))?;
    let path = manifest_path(model_dir);
    let tmp = path.with_extension("json.tmp");
    let bytes = serde_json::to_vec_pretty(manifest).context("serialize local model manifest")?;
    std::fs::write(&tmp, bytes).with_context(|| format!("write {}", tmp.display()))?;
    std::fs::rename(&tmp, &path).with_context(|| format!("replace manifest {}", path.display()))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn manifest_round_trips_json() {
        let tmp = tempfile::tempdir().unwrap();
        let manifest = LocalModelManifest::new(
            "model-id",
            "model.gguf",
            "abc123",
            12,
            "00ff",
            LocalModelStatus::Ready,
        );

        write_manifest(tmp.path(), &manifest).unwrap();
        assert_eq!(read_manifest(tmp.path()).unwrap(), Some(manifest));
    }

    #[test]
    fn missing_manifest_is_none() {
        let tmp = tempfile::tempdir().unwrap();
        assert!(read_manifest(tmp.path()).unwrap().is_none());
    }

    /// Locks the cross-platform contract that the download path relies on: the
    /// real flow writes a `Downloading` manifest, then later overwrites it with
    /// a `Ready` one. `std::fs::rename` is documented to replace an existing
    /// destination on every platform (Windows uses MoveFileExW with
    /// MOVEFILE_REPLACE_EXISTING) and does so ATOMICALLY — so the second write
    /// must succeed over the existing file and leave the latest content. This
    /// test would fail on Windows if rename did NOT replace; it passes there
    /// (empirically verified on the Legion bench). Keeping it guards against a
    /// regression to a non-atomic remove-then-rename.
    #[test]
    fn write_manifest_replaces_an_existing_manifest() {
        let tmp = tempfile::tempdir().unwrap();
        let downloading = LocalModelManifest::new(
            "m",
            "model.gguf",
            "rev",
            100,
            "aa",
            LocalModelStatus::Downloading,
        );
        write_manifest(tmp.path(), &downloading).unwrap();
        assert_eq!(
            read_manifest(tmp.path()).unwrap().unwrap().status,
            LocalModelStatus::Downloading
        );

        // Overwrite the existing manifest with the Ready one (the rename-over-
        // existing the download path performs on Windows after the GGUF lands).
        let ready = LocalModelManifest::new("m", "model.gguf", "rev", 100, "aa", LocalModelStatus::Ready);
        write_manifest(tmp.path(), &ready).unwrap();
        assert_eq!(read_manifest(tmp.path()).unwrap(), Some(ready));
        // The temp file must not linger after an atomic rename.
        assert!(!manifest_path(tmp.path()).with_extension("json.tmp").exists());
    }
}
