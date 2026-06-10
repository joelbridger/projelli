// Robust, visible first-run download of the e5-small embedding model.
//
// This module owns the ONLY network path for model files. The embed paths
// (`get_embedder`, and through it indexing and retrieval) never download
// implicitly: they fail fast with the `MODEL_NOT_READY` marker and the
// frontend shows this module's progress instead. hf-hub downloads to a
// temp file and resumes via HTTP Range, so a retry after a dropped
// connection continues where it stopped instead of starting over.

use std::path::{Path, PathBuf};

use serde::Serialize;

/// HF repo + file set fastembed needs for MultilingualE5Small. Kept honest
/// by the `required_files_match_fastembed` test below.
pub const MODEL_REPO: &str = "intfloat/multilingual-e5-small";
pub const REQUIRED_FILES: [&str; 5] = [
    "config.json",
    "special_tokens_map.json",
    "tokenizer_config.json",
    "tokenizer.json",
    "onnx/model.onnx", // ~448 MB — keep last so small files finish first
];

/// Tauri event name. Mirrored in `src/utils/tauri-commands.ts`.
pub const MODEL_EVENT: &str = "model-download-progress";

#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ModelDownloadState {
    Checking,
    Downloading,
    Verifying,
    Ready,
    Error,
}

/// Payload emitted on `model-download-progress` events.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ModelDownloadProgress {
    pub state: ModelDownloadState,
    /// File currently downloading (repo-relative), when applicable.
    pub file: Option<String>,
    /// Bytes finished across ALL files so far this session.
    pub bytes_done: u64,
    /// Exact grand total from the HEAD prepass; None when it failed
    /// (frontend falls back to an indeterminate bar + MB counter).
    pub bytes_total: Option<u64>,
    /// Human-readable error detail when state == Error.
    pub message: Option<String>,
}

/// True when every file fastembed needs is present in `cache_dir`'s hf-hub
/// cache layout (bundled OR previously downloaded). Pure filesystem check.
pub fn model_files_cached(cache_dir: &Path) -> bool {
    let cache = hf_hub::Cache::new(cache_dir.to_path_buf());
    let repo = cache.repo(hf_hub::Repo::model(MODEL_REPO.to_string()));
    REQUIRED_FILES.iter().all(|f| repo.get(f).is_some())
}

/// Where downloads land: ALWAYS the user-writable data dir. (The bundled
/// resources dir `resolve_cache_dir()` can return is read-only inside the
/// install dir; when a bundle exists the cached fast-path means we never
/// download at all.)
pub fn writable_cache_dir() -> PathBuf {
    if let Some(data_dir) = dirs::data_dir() {
        return data_dir.join("keepance").join("models").join("e5-small");
    }
    std::env::temp_dir().join("keepance-e5-small")
}

#[cfg(test)]
mod tests {
    use super::*;

    /// REQUIRED_FILES must stay in sync with what fastembed actually loads:
    /// the model file from ModelInfo plus the four tokenizer files fetched in
    /// fastembed's common.rs. If fastembed adds additional_files, this fails.
    #[test]
    fn required_files_match_fastembed() {
        let info = fastembed::TextEmbedding::get_model_info(
            &fastembed::EmbeddingModel::MultilingualE5Small,
        )
        .expect("fastembed knows MultilingualE5Small");
        assert_eq!(info.model_code, MODEL_REPO);
        assert!(REQUIRED_FILES.contains(&info.model_file.as_str()));
        for extra in &info.additional_files {
            assert!(
                REQUIRED_FILES.contains(&extra.as_str()),
                "fastembed now needs {extra}; add it to REQUIRED_FILES"
            );
        }
        for tok in [
            "config.json",
            "tokenizer.json",
            "special_tokens_map.json",
            "tokenizer_config.json",
        ] {
            assert!(REQUIRED_FILES.contains(&tok));
        }
    }

    #[test]
    fn cached_is_false_on_empty_dir() {
        let tmp = tempfile::tempdir().expect("tempdir");
        assert!(!model_files_cached(tmp.path()));
    }

    #[test]
    fn cached_is_false_when_model_file_missing() {
        let tmp = tempfile::tempdir().expect("tempdir");
        write_fake_layout(tmp.path(), &REQUIRED_FILES[..4]); // no onnx/model.onnx
        assert!(!model_files_cached(tmp.path()));
    }

    #[test]
    fn cached_is_true_with_full_layout() {
        let tmp = tempfile::tempdir().expect("tempdir");
        write_fake_layout(tmp.path(), &REQUIRED_FILES);
        assert!(model_files_cached(tmp.path()));
    }

    #[test]
    fn progress_payload_serializes_camel_case() {
        let p = ModelDownloadProgress {
            state: ModelDownloadState::Downloading,
            file: Some("onnx/model.onnx".into()),
            bytes_done: 5,
            bytes_total: Some(10),
            message: None,
        };
        let json = serde_json::to_string(&p).expect("serialize");
        assert!(json.contains("\"state\":\"downloading\""), "{json}");
        assert!(json.contains("\"bytesDone\":5"), "{json}");
        assert!(json.contains("\"bytesTotal\":10"), "{json}");
    }

    /// Build the hf-hub cache layout by hand:
    ///   models--intfloat--multilingual-e5-small/
    ///     refs/main                      (contains a fake revision)
    ///     snapshots/<rev>/<each file>    (tiny real files)
    fn write_fake_layout(root: &Path, files: &[&str]) {
        let repo_dir = root.join(format!("models--{}", MODEL_REPO.replace('/', "--")));
        let rev = "deadbeef";
        std::fs::create_dir_all(repo_dir.join("refs")).unwrap();
        std::fs::write(repo_dir.join("refs").join("main"), rev).unwrap();
        for f in files {
            let p = repo_dir.join("snapshots").join(rev).join(f);
            std::fs::create_dir_all(p.parent().unwrap()).unwrap();
            std::fs::write(p, b"x").unwrap();
        }
    }
}
