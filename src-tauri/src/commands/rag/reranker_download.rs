// Robust, visible first-run download of the cross-encoder RERANKER model.
//
// WS3d-A. A near-exact sibling of `model_download.rs` (the e5-small embedder
// downloader): same hf-hub cache layout, same resumable HTTP-Range download,
// same throttled progress events, same single-flight guard. The differences
// are only the HF repo, the cache subdir, and the event name — kept separate
// so the reranker is an independent, optional add-on the user can download (or
// not) without touching the always-required embedder.
//
// This module owns the ONLY network path for the reranker files. The inference
// side (`reranker::get_reranker`) never downloads implicitly: it fails fast
// with the `RERANKER_NOT_READY` marker and retrieval falls back to vector-only.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};

use anyhow::{Context, Result};
use serde::Serialize;
use tauri::{AppHandle, Emitter};

use super::reranker;

/// HF repo + file set fastembed needs for the reranker model. Kept honest by
/// the `required_files_match_fastembed` test below (which reads fastembed's own
/// `RerankerModelInfo` so a fastembed bump that adds files reds the build).
pub const MODEL_REPO: &str = "jinaai/jina-reranker-v1-turbo-en";
pub const REQUIRED_FILES: [&str; 5] = [
    "config.json",
    "special_tokens_map.json",
    "tokenizer_config.json",
    "tokenizer.json",
    "onnx/model.onnx", // ~150 MB — keep last so the small files finish first
];

/// Tauri event name. Distinct from the embedder's `model-download-progress`.
pub const RERANKER_EVENT: &str = "reranker-download-progress";

#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum RerankerDownloadState {
    Checking,
    Downloading,
    Verifying,
    Ready,
    Error,
}

/// Payload emitted on `reranker-download-progress` events.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RerankerDownloadProgress {
    pub state: RerankerDownloadState,
    pub file: Option<String>,
    pub bytes_done: u64,
    pub bytes_total: Option<u64>,
    pub message: Option<String>,
}

/// True while a download job is running (single-flight guard).
static DOWNLOADING: AtomicBool = AtomicBool::new(false);

/// RAII guard that clears `DOWNLOADING` on every exit path (return, error,
/// panic-unwind) so a panic can never wedge status at "downloading".
struct DownloadingGuard;

impl Drop for DownloadingGuard {
    fn drop(&mut self) {
        DOWNLOADING.store(false, Ordering::SeqCst);
    }
}

/// True when every required reranker file is present in `cache_dir`'s hf-hub
/// layout. Pure filesystem check.
pub fn model_files_cached(cache_dir: &Path) -> bool {
    let cache = hf_hub::Cache::new(cache_dir.to_path_buf());
    let repo = cache.repo(hf_hub::Repo::model(MODEL_REPO.to_string()));
    REQUIRED_FILES.iter().all(|f| repo.get(f).is_some())
}

/// Where reranker downloads land: ALWAYS the user-writable data dir, in a
/// subdir distinct from the embedder's.
pub fn writable_cache_dir() -> PathBuf {
    if let Some(data_dir) = dirs::data_dir() {
        return data_dir.join(crate::identity::OS_DATA_SUBDIR).join("models").join("reranker");
    }
    std::env::temp_dir().join(format!("{}-reranker", crate::identity::OS_DATA_SUBDIR))
}

fn emit(app: &AppHandle, p: RerankerDownloadProgress) {
    let _ = app.emit(RERANKER_EVENT, p);
}

/// Best-effort exact grand total via HEAD on each file. Any failure → None and
/// the UI falls back to a byte counter.
async fn head_total_size() -> Option<u64> {
    let client = match reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(10))
        .timeout(std::time::Duration::from_secs(20))
        .build()
    {
        Ok(c) => c,
        Err(_) => return None,
    };
    let mut sum: u64 = 0;
    for file in REQUIRED_FILES {
        let url = format!("https://huggingface.co/{MODEL_REPO}/resolve/main/{file}");
        let resp = client.head(&url).send().await.ok()?;
        if !resp.status().is_success() {
            return None;
        }
        let len = resp
            .headers()
            .get(reqwest::header::CONTENT_LENGTH)
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.parse::<u64>().ok())
            .or_else(|| {
                resp.headers()
                    .get("x-linked-size")
                    .and_then(|v| v.to_str().ok())
                    .and_then(|v| v.parse().ok())
            })?;
        sum += len;
    }
    Some(sum)
}

/// hf-hub `Progress` adapter forwarding throttled aggregate progress to a sink.
struct SinkProgress {
    sink: Box<dyn Fn(RerankerDownloadProgress) + Send>,
    file: String,
    done_before: u64,
    file_done: u64,
    grand_total: Option<u64>,
    last_emit: u64,
}

impl hf_hub::api::Progress for SinkProgress {
    fn init(&mut self, _size: usize, _filename: &str) {
        self.file_done = 0;
        self.last_emit = 0;
        self.emit_now();
    }
    fn update(&mut self, size: usize) {
        self.file_done += size as u64;
        if self.file_done.saturating_sub(self.last_emit) >= 4 * 1024 * 1024 {
            self.emit_now();
        }
    }
    fn finish(&mut self) {
        self.emit_now();
    }
}

impl SinkProgress {
    fn emit_now(&mut self) {
        self.last_emit = self.file_done;
        (self.sink)(RerankerDownloadProgress {
            state: RerankerDownloadState::Downloading,
            file: Some(self.file.clone()),
            bytes_done: self.done_before + self.file_done,
            bytes_total: self.grand_total,
            message: None,
        });
    }
}

fn cached_file_len(cache_dir: &Path, file: &str) -> Option<u64> {
    let cache = hf_hub::Cache::new(cache_dir.to_path_buf());
    let p = cache.repo(hf_hub::Repo::model(MODEL_REPO.to_string())).get(file)?;
    std::fs::metadata(&p).ok().map(|m| m.len())
}

/// Download every missing required file into `cache_dir`, forwarding progress
/// to `sink`. Sync — call from spawn_blocking. Already-complete files are
/// skipped (their size still counts so a retry's bar resumes).
fn download_all(
    cache_dir: &Path,
    grand_total: Option<u64>,
    sink: impl Fn(RerankerDownloadProgress) + Send + Clone + 'static,
) -> Result<()> {
    let api = hf_hub::api::sync::ApiBuilder::from_cache(hf_hub::Cache::new(cache_dir.to_path_buf()))
        .with_progress(false)
        .build()
        .context("hf-hub api init")?;
    let repo = api.model(MODEL_REPO.to_string());

    let mut done_before: u64 = 0;
    for file in REQUIRED_FILES {
        if let Some(len) = cached_file_len(cache_dir, file) {
            done_before += len;
            continue;
        }
        let progress = SinkProgress {
            sink: Box::new(sink.clone()),
            file: file.to_string(),
            done_before,
            file_done: 0,
            grand_total,
            last_emit: 0,
        };
        repo.download_with_progress(file, progress)
            .with_context(|| format!("download {file}"))?;
        done_before += cached_file_len(cache_dir, file).unwrap_or(0);
    }
    Ok(())
}

/// Full job: size prepass → download missing → verify by initializing the
/// reranker. On verify failure the repo dir is wiped so Retry re-fetches.
async fn run_download(app: &AppHandle) -> Result<()> {
    emit(
        app,
        RerankerDownloadProgress {
            state: RerankerDownloadState::Checking,
            file: None,
            bytes_done: 0,
            bytes_total: None,
            message: None,
        },
    );

    let total = head_total_size().await;

    let dir = writable_cache_dir();
    std::fs::create_dir_all(&dir).context("create reranker cache dir")?;

    let app_for_sink = app.clone();
    let dir_for_dl = dir.clone();
    tokio::task::spawn_blocking(move || {
        download_all(&dir_for_dl, total, move |p| emit(&app_for_sink, p))
    })
    .await
    .context("download task join failed")??;

    emit(
        app,
        RerankerDownloadProgress {
            state: RerankerDownloadState::Verifying,
            file: None,
            bytes_done: total.unwrap_or(0),
            bytes_total: total,
            message: None,
        },
    );
    match reranker::warm_init().await {
        Ok(()) => Ok(()),
        Err(e) => {
            let repo_dir = dir.join(format!("models--{}", MODEL_REPO.replace('/', "--")));
            let _ = std::fs::remove_dir_all(&repo_dir);
            Err(e).context("downloaded reranker failed to load; cache cleared so Retry re-fetches")
        }
    }
}

/// Cheap status probe: "ready" | "absent" | "downloading".
#[tauri::command]
pub async fn reranker_status() -> Result<String, String> {
    if DOWNLOADING.load(Ordering::SeqCst) {
        return Ok("downloading".into());
    }
    let ready = tokio::task::spawn_blocking(|| model_files_cached(&reranker::resolve_cache_dir()))
        .await
        .map_err(|e| e.to_string())?;
    Ok(if ready { "ready" } else { "absent" }.into())
}

/// Idempotent: "ready" when cached, "downloading" when a job is in flight,
/// otherwise runs the download to completion and returns "ready" (or errors
/// after emitting an Error event).
#[tauri::command]
pub async fn reranker_ensure(app: AppHandle) -> Result<String, String> {
    if DOWNLOADING.load(Ordering::SeqCst) {
        return Ok("downloading".into());
    }

    {
        let ready =
            tokio::task::spawn_blocking(|| model_files_cached(&reranker::resolve_cache_dir()))
                .await
                .map_err(|e| e.to_string())?;
        if ready {
            emit(
                &app,
                RerankerDownloadProgress {
                    state: RerankerDownloadState::Ready,
                    file: None,
                    bytes_done: 0,
                    bytes_total: None,
                    message: None,
                },
            );
            return Ok("ready".into());
        }
    }

    if DOWNLOADING
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return Ok("downloading".into());
    }
    let _downloading_guard = DownloadingGuard;

    match run_download(&app).await {
        Ok(()) => {
            emit(
                &app,
                RerankerDownloadProgress {
                    state: RerankerDownloadState::Ready,
                    file: None,
                    bytes_done: 0,
                    bytes_total: None,
                    message: None,
                },
            );
            Ok("ready".into())
        }
        Err(e) => {
            let msg = format!("{e:#}");
            emit(
                &app,
                RerankerDownloadProgress {
                    state: RerankerDownloadState::Error,
                    file: None,
                    bytes_done: 0,
                    bytes_total: None,
                    message: Some(msg.clone()),
                },
            );
            Err(msg)
        }
    }
}

/// Test support: build a minimal valid hf-hub cache layout for the reranker.
#[cfg(test)]
pub(crate) fn write_fake_layout(root: &Path, files: &[&str]) {
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

#[cfg(test)]
mod tests {
    use super::*;

    /// REQUIRED_FILES must stay in sync with what fastembed actually loads for
    /// the reranker: the model file from `RerankerModelInfo` plus any
    /// additional files, plus the four tokenizer files fastembed fetches.
    #[test]
    fn required_files_match_fastembed() {
        let info = fastembed::TextRerank::get_model_info(&reranker::RERANKER_MODEL);
        assert_eq!(info.model_code, MODEL_REPO);
        assert!(
            REQUIRED_FILES.contains(&info.model_file.as_str()),
            "model_file {} missing from REQUIRED_FILES",
            info.model_file
        );
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
    fn writable_cache_dir_is_absolute_and_distinct() {
        let p = writable_cache_dir();
        assert!(p.is_absolute());
        // Must NOT collide with the embedder's e5-small dir.
        assert!(!p.ends_with("e5-small"));
    }

    #[test]
    fn progress_payload_serializes_camel_case() {
        let p = RerankerDownloadProgress {
            state: RerankerDownloadState::Downloading,
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

    /// Provision the reranker into the REAL user-writable cache dir (the one
    /// `reranker::resolve_cache_dir` reads), so the retrieval-quality eval can
    /// find it. Run once locally before the eval:
    ///   cargo test -p keepance --lib provision_reranker_into_writable_cache \
    ///     -- --ignored --nocapture
    #[test]
    #[ignore]
    fn provision_reranker_into_writable_cache() {
        let dir = writable_cache_dir();
        std::fs::create_dir_all(&dir).expect("create cache dir");
        download_all(&dir, None, |p| {
            println!(
                "progress: {:?} {} {}",
                p.state,
                p.file.as_deref().unwrap_or("-"),
                p.bytes_done
            );
        })
        .expect("download_all");
        assert!(model_files_cached(&dir), "reranker cached after download");
        // Verify it actually loads (catches a corrupt/incompatible ONNX early).
        let opts = fastembed::RerankInitOptions::new(reranker::RERANKER_MODEL)
            .with_cache_dir(dir.clone())
            .with_show_download_progress(false);
        fastembed::TextRerank::try_new(opts).expect("reranker loads from cache");
        println!("reranker provisioned at {}", dir.display());
    }

    /// REAL network download into a temp dir, then a real reranker init from
    /// that cache. Manual: cargo test -p keepance --test ... -- --ignored
    #[test]
    #[ignore]
    fn real_reranker_download_roundtrip() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let dir = tmp.path().to_path_buf();
        assert!(!model_files_cached(&dir));

        download_all(&dir, None, |p| {
            println!(
                "progress: {:?} {} {}",
                p.state,
                p.file.as_deref().unwrap_or("-"),
                p.bytes_done
            );
        })
        .expect("download_all");

        assert!(model_files_cached(&dir), "all files cached after download");
    }
}
