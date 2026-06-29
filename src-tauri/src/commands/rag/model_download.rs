// Robust, visible first-run download of the e5-small embedding model.
//
// This module owns the ONLY network path for model files. The embed paths
// (`get_embedder`, and through it indexing and retrieval) never download
// implicitly: they fail fast with the `MODEL_NOT_READY` marker and the
// frontend shows this module's progress instead. hf-hub downloads to a
// temp file and resumes via HTTP Range, so a retry after a dropped
// connection continues where it stopped instead of starting over.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};

use anyhow::{Context, Result};
use serde::Serialize;
use tauri::{AppHandle, Emitter};

use super::embedder;

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
#[serde(rename_all = "lowercase")] // single-word variants only; switch to kebab-case before adding multi-word ones
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

/// True while a download job is running (single-flight guard).
static DOWNLOADING: AtomicBool = AtomicBool::new(false);

/// RAII guard that clears `DOWNLOADING` on every exit path (normal return,
/// error, panic-unwind) so a panic between the CAS in `model_ensure` and
/// the final store can never wedge status at "downloading". Mirrors
/// `IndexingGuard` in `mod.rs`.
struct DownloadingGuard;

impl Drop for DownloadingGuard {
    fn drop(&mut self) {
        DOWNLOADING.store(false, Ordering::SeqCst);
    }
}

/// True when every file fastembed needs is present in `cache_dir`'s hf-hub
/// cache layout (bundled OR previously downloaded). Pure filesystem check.
pub fn model_files_cached(cache_dir: &Path) -> bool {
    let cache = hf_hub::Cache::new(cache_dir.to_path_buf());
    let repo = cache.repo(hf_hub::Repo::model(MODEL_REPO.to_string()));
    REQUIRED_FILES.iter().all(|f| repo.get(f).is_some())
}

/// Where downloads land: ALWAYS the user-writable data dir. The bundled
/// resources dir can exist in every install while holding only a .gitkeep
/// (the bundle-prefetch is deliberately off), so it is never a download
/// target; `resolve_cache_dir()` selects it only when it actually contains
/// the model.
pub fn writable_cache_dir() -> PathBuf {
    if let Some(data_dir) = dirs::data_dir() {
        return data_dir.join("keepance").join("models").join("e5-small");
    }
    std::env::temp_dir().join("keepance-e5-small")
}

/// Emit one progress event, ignoring failures (a closed webview must not
/// break the download).
fn emit(app: &AppHandle, p: ModelDownloadProgress) {
    let _ = app.emit(MODEL_EVENT, p);
}

/// Best-effort exact grand total via HEAD on each file's resolve URL.
/// HF redirects to its CDN; reqwest follows redirects by default and the
/// final response carries the real content-length. Any failure → None and
/// the UI falls back to a byte counter.
///
/// NB: parse the `content-length` HEADER, not `Response::content_length()`
/// — the latter is the body size hint, which is always 0 for a HEAD
/// response (hyper decodes HEAD bodies as zero-length per RFC 9110).
async fn head_total_size() -> Option<u64> {
    // Timeouts matter: on a DROP-style firewall each of the 5 sequential
    // HEADs would otherwise hang for minutes while the UI sits on
    // "Checking" and the single-flight guard blocks retry.
    let client = match reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(10))
        .timeout(std::time::Duration::from_secs(20))
        .build()
    {
        Ok(c) => c,
        // Builder failure is exotic; the prepass is best-effort anyway.
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

/// hf-hub `Progress` adapter that forwards throttled aggregate progress to
/// a sink (the Tauri event emitter in production, a println in tests).
struct SinkProgress {
    sink: Box<dyn Fn(ModelDownloadProgress) + Send>,
    file: String,
    /// Bytes of files completed BEFORE this one.
    done_before: u64,
    file_done: u64,
    grand_total: Option<u64>,
    /// `file_done` at the last emit, for ~4 MB throttling.
    last_emit: u64,
}

impl hf_hub::api::Progress for SinkProgress {
    fn init(&mut self, _size: usize, _filename: &str) {
        // hf-hub may call init again on an internal retry, then re-seed the
        // position via update(offset) — reset so a retry can't double-count.
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
        (self.sink)(ModelDownloadProgress {
            state: ModelDownloadState::Downloading,
            file: Some(self.file.clone()),
            bytes_done: self.done_before + self.file_done,
            bytes_total: self.grand_total,
            message: None,
        });
    }
}

fn cached_file_len(cache_dir: &Path, file: &str) -> Option<u64> {
    let cache = hf_hub::Cache::new(cache_dir.to_path_buf());
    let p = cache
        .repo(hf_hub::Repo::model(MODEL_REPO.to_string()))
        .get(file)?;
    std::fs::metadata(&p).ok().map(|m| m.len())
}

/// Download every missing required file into `cache_dir` (hf-hub layout),
/// forwarding progress to `sink`. Sync — call from spawn_blocking.
/// Files already complete are skipped (their size still counts toward
/// `bytes_done` so a retry's bar starts where it left off).
fn download_all(
    cache_dir: &Path,
    grand_total: Option<u64>,
    sink: impl Fn(ModelDownloadProgress) + Send + Clone + 'static,
) -> Result<()> {
    // from_cache (not new().with_cache_dir(...)): `new()` reads the token
    // from the DEFAULT ~/.cache/huggingface and with_cache_dir doesn't reset
    // it — a stale user-level HF token could 401 where anonymous succeeds.
    let api =
        hf_hub::api::sync::ApiBuilder::from_cache(hf_hub::Cache::new(cache_dir.to_path_buf()))
            .with_progress(false) // no terminal bar; we emit our own events
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

/// The full download job: size prepass → download missing files →
/// verify by actually initializing the embedder. On verify failure the
/// repo dir is wiped so Retry re-fetches cleanly instead of looping on a
/// corrupt cache.
async fn run_download(app: &AppHandle) -> Result<()> {
    emit(
        app,
        ModelDownloadProgress {
            state: ModelDownloadState::Checking,
            file: None,
            bytes_done: 0,
            bytes_total: None,
            message: None,
        },
    );

    let total = head_total_size().await;

    let dir = writable_cache_dir();
    std::fs::create_dir_all(&dir).context("create model cache dir")?;

    let app_for_sink = app.clone();
    let dir_for_dl = dir.clone();
    tokio::task::spawn_blocking(move || {
        download_all(&dir_for_dl, total, move |p| emit(&app_for_sink, p))
    })
    .await
    .context("download task join failed")??;

    emit(
        app,
        ModelDownloadProgress {
            state: ModelDownloadState::Verifying,
            file: None,
            bytes_done: total.unwrap_or(0),
            bytes_total: total,
            message: None,
        },
    );
    match embedder::warm_init().await {
        Ok(()) => Ok(()),
        Err(e) => {
            let repo_dir = dir.join(format!("models--{}", MODEL_REPO.replace('/', "--")));
            let _ = std::fs::remove_dir_all(&repo_dir);
            Err(e).context("downloaded model failed to load; cache cleared so Retry re-fetches")
        }
    }
}

/// Cheap status probe for the frontend: "ready" | "absent" | "downloading".
#[tauri::command]
pub async fn model_status() -> Result<String, String> {
    if DOWNLOADING.load(Ordering::SeqCst) {
        return Ok("downloading".into());
    }
    // resolve_cache_dir itself probes candidate dirs (a dozen fs syscalls),
    // so it belongs inside the blocking closure too.
    let ready = tokio::task::spawn_blocking(|| model_files_cached(&embedder::resolve_cache_dir()))
        .await
        .map_err(|e| e.to_string())?;
    Ok(if ready { "ready" } else { "absent" }.into())
}

/// Idempotent: returns "ready" immediately when the files are cached
/// (bundled or already downloaded), "downloading" when a job is already
/// in flight, otherwise runs the download job to completion and returns
/// "ready" (or an error after emitting an Error event).
#[tauri::command]
pub async fn model_ensure(app: AppHandle) -> Result<String, String> {
    // Check the single-flight guard BEFORE the cached fast-path (matching
    // model_status's order) so a concurrent caller can't observe "ready"
    // while another job is still in Verifying and could yet fail-and-wipe.
    // The CAS below still CLAIMS the slot; this is only an early report.
    if DOWNLOADING.load(Ordering::SeqCst) {
        return Ok("downloading".into());
    }

    {
        // resolve_cache_dir probes candidate dirs (fs syscalls) — keep it
        // off the async thread alongside the presence check.
        let ready =
            tokio::task::spawn_blocking(|| model_files_cached(&embedder::resolve_cache_dir()))
                .await
                .map_err(|e| e.to_string())?;
        if ready {
            // Make "ready" observable even when nothing was downloaded, so
            // late event subscribers converge.
            emit(
                &app,
                ModelDownloadProgress {
                    state: ModelDownloadState::Ready,
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
    // The CAS above claimed the slot; this guard releases it on every exit
    // path from here on, including panic-unwind inside the download job.
    let _downloading_guard = DownloadingGuard;

    let result = run_download(&app).await;

    match result {
        Ok(()) => {
            emit(
                &app,
                ModelDownloadProgress {
                    state: ModelDownloadState::Ready,
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
                ModelDownloadProgress {
                    state: ModelDownloadState::Error,
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

/// Test support: build a minimal valid hf-hub cache layout containing the
/// given repo-relative files (refs/main + snapshots/<rev>/<file>). Shared
/// with embedder.rs's resolve_cache_dir tests.
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

    /// REAL network download (~465 MB) into a temp dir, then a real
    /// embedder init from that cache. Run manually once per environment:
    ///   cargo test --release -p keepance real_model_download -- --ignored --nocapture
    /// (package name: whatever [package].name is in src-tauri/Cargo.toml)
    #[test]
    #[ignore]
    fn real_model_download_roundtrip() {
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

        // Offline-capable init from the populated cache.
        let opts = fastembed::InitOptions::new(fastembed::EmbeddingModel::MultilingualE5Small)
            .with_cache_dir(dir.clone())
            .with_show_download_progress(false);
        let model = fastembed::TextEmbedding::try_new(opts).expect("init from cache");
        let vecs = model
            .embed(vec!["query: download roundtrip smoke".to_string()], None)
            .expect("embed");
        assert_eq!(vecs[0].len(), 384);
    }
}
