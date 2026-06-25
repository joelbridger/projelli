// Robust, visible first-run download for Keepance Local AI's GGUF model.
//
// The model is intentionally not bundled in the installer. This module owns
// the first-use network path and makes it restartable: partial bytes land in a
// `.part` file, the final file appears only after size + SHA-256 verification,
// and `manifest.json` records what is on disk.

use super::manifest::{read_manifest, write_manifest, LocalModelManifest, LocalModelStatus};
use anyhow::{bail, Context, Result};
use futures_util::StreamExt;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, Emitter};
use tokio::io::AsyncWriteExt;

pub const MODEL_ID: &str = "qwen3-4b-instruct-2507-q4-k-m";
pub const MODEL_REPO: &str = "bartowski/Qwen_Qwen3-4B-Instruct-2507-GGUF";
pub const MODEL_REVISION: &str = "ae44f08e1392f39c0e474af10c3ff8355c8b6688";
pub const MODEL_FILENAME: &str = "Qwen3-4B-Instruct-2507-Q4_K_M.gguf";
const REMOTE_FILENAME: &str = "Qwen_Qwen3-4B-Instruct-2507-Q4_K_M.gguf";
pub const MODEL_SIZE_BYTES: u64 = 2_497_280_736;
pub const MODEL_SHA256: &str = "2fde00ce69dd4899c70d020845e2638353015bba0fdf161b3eb965f2bca4464e";
pub const MODEL_EVENT: &str = "local-llm-model-download-progress";
const DISK_SPACE_RESERVE_BYTES: u64 = 256 * 1024 * 1024;

static DOWNLOADING: AtomicBool = AtomicBool::new(false);

struct DownloadingGuard;

impl Drop for DownloadingGuard {
    fn drop(&mut self) {
        DOWNLOADING.store(false, Ordering::SeqCst);
    }
}

#[derive(Clone, Debug)]
pub struct ModelDownloadSpec {
    pub model_id: &'static str,
    pub repo: &'static str,
    pub revision: &'static str,
    pub filename: &'static str,
    pub remote_filename: &'static str,
    pub size: u64,
    pub sha256: &'static str,
    pub source_url: String,
}

impl ModelDownloadSpec {
    pub fn production() -> Self {
        Self {
            model_id: MODEL_ID,
            repo: MODEL_REPO,
            revision: MODEL_REVISION,
            filename: MODEL_FILENAME,
            remote_filename: REMOTE_FILENAME,
            size: MODEL_SIZE_BYTES,
            sha256: MODEL_SHA256,
            source_url: format!(
                "https://huggingface.co/{MODEL_REPO}/resolve/{MODEL_REVISION}/{REMOTE_FILENAME}"
            ),
        }
    }

    fn manifest(&self, status: LocalModelStatus) -> LocalModelManifest {
        LocalModelManifest::new(
            self.model_id,
            self.filename,
            self.revision,
            self.size,
            self.sha256,
            status,
        )
    }
}

#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum LocalModelDownloadState {
    Checking,
    Downloading,
    Verifying,
    Ready,
    Error,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct LocalModelDownloadProgress {
    pub state: LocalModelDownloadState,
    pub model_id: String,
    pub filename: String,
    pub bytes_done: u64,
    pub bytes_total: u64,
    pub message: Option<String>,
}

fn emit(app: &AppHandle, p: LocalModelDownloadProgress) {
    let _ = app.emit(MODEL_EVENT, p);
}

fn progress(
    spec: &ModelDownloadSpec,
    state: LocalModelDownloadState,
    bytes_done: u64,
    message: Option<String>,
) -> LocalModelDownloadProgress {
    LocalModelDownloadProgress {
        state,
        model_id: spec.model_id.to_string(),
        filename: spec.filename.to_string(),
        bytes_done,
        bytes_total: spec.size,
        message,
    }
}

pub fn writable_model_dir() -> PathBuf {
    if let Some(data_dir) = dirs::data_dir() {
        return data_dir
            .join("keepance")
            .join("models")
            .join("qwen3-4b-instruct-2507");
    }
    std::env::temp_dir()
        .join("keepance")
        .join("models")
        .join("qwen3-4b-instruct-2507")
}

pub fn model_file_path() -> PathBuf {
    writable_model_dir().join(MODEL_FILENAME)
}

fn part_file_path(model_dir: &Path, spec: &ModelDownloadSpec) -> PathBuf {
    model_dir.join(format!("{}.part", spec.filename))
}

pub fn model_ready_in(model_dir: &Path, spec: &ModelDownloadSpec) -> bool {
    let path = model_dir.join(spec.filename);
    if !path.exists() {
        return false;
    }
    match std::fs::metadata(&path) {
        Ok(meta) if meta.len() == spec.size => {}
        _ => return false,
    }
    matches!(
        read_manifest(model_dir),
        Ok(Some(manifest))
            if manifest.model_id == spec.model_id
                && manifest.filename == spec.filename
                && manifest.revision == spec.revision
                && manifest.size == spec.size
                && manifest.sha256 == spec.sha256
                && manifest.status == LocalModelStatus::Ready
    )
}

fn free_space_covers_download(available: u64, partial_len: u64, expected_size: u64) -> bool {
    available.saturating_add(partial_len) >= expected_size.saturating_add(DISK_SPACE_RESERVE_BYTES)
}

fn ensure_disk_space(model_dir: &Path, partial_len: u64, expected_size: u64) -> Result<()> {
    std::fs::create_dir_all(model_dir)
        .with_context(|| format!("create model dir {}", model_dir.display()))?;
    let available = fs2::available_space(model_dir)
        .with_context(|| format!("check free disk space for {}", model_dir.display()))?;
    if !free_space_covers_download(available, partial_len, expected_size) {
        bail!(
            "not enough free disk space for local AI model: need {} bytes plus reserve, have {} bytes available and {} bytes already downloaded",
            expected_size,
            available,
            partial_len
        );
    }
    Ok(())
}

fn sha256_file(path: &Path) -> Result<String> {
    let mut file = std::fs::File::open(path).with_context(|| format!("open {}", path.display()))?;
    let mut hasher = Sha256::new();
    let mut buf = [0_u8; 1024 * 1024];
    loop {
        let read = file
            .read(&mut buf)
            .with_context(|| format!("read {}", path.display()))?;
        if read == 0 {
            break;
        }
        hasher.update(&buf[..read]);
    }
    Ok(hex::encode(hasher.finalize()))
}

async fn append_download(
    client: &reqwest::Client,
    spec: &ModelDownloadSpec,
    part_path: &Path,
    already_done: u64,
    sink: &(dyn Fn(LocalModelDownloadProgress) + Send + Sync),
) -> Result<()> {
    let mut req = client.get(&spec.source_url);
    if already_done > 0 {
        req = req.header(reqwest::header::RANGE, format!("bytes={already_done}-"));
    }

    let resp = req
        .send()
        .await
        .with_context(|| format!("download {}", spec.source_url))?;

    if already_done > 0 && resp.status() == reqwest::StatusCode::OK {
        bail!("server ignored resume request for local AI model download");
    }
    if already_done > 0 && resp.status() != reqwest::StatusCode::PARTIAL_CONTENT {
        bail!("resume failed: HTTP {}", resp.status());
    }
    if already_done == 0 && !resp.status().is_success() {
        bail!("download failed: HTTP {}", resp.status());
    }

    let mut file = tokio::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(part_path)
        .await
        .with_context(|| format!("open {}", part_path.display()))?;

    let mut done = already_done;
    let mut last_emit = already_done;
    let mut stream = resp.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.context("read local AI model download chunk")?;
        file.write_all(&chunk)
            .await
            .with_context(|| format!("write {}", part_path.display()))?;
        done += chunk.len() as u64;
        if done.saturating_sub(last_emit) >= 4 * 1024 * 1024 || done == spec.size {
            last_emit = done;
            sink(progress(
                spec,
                LocalModelDownloadState::Downloading,
                done.min(spec.size),
                None,
            ));
        }
    }
    file.flush()
        .await
        .with_context(|| format!("flush {}", part_path.display()))?;
    Ok(())
}

pub async fn download_model_to_dir(
    model_dir: &Path,
    spec: &ModelDownloadSpec,
    sink: impl Fn(LocalModelDownloadProgress) + Send + Sync,
) -> Result<PathBuf> {
    std::fs::create_dir_all(model_dir)
        .with_context(|| format!("create model dir {}", model_dir.display()))?;

    let final_path = model_dir.join(spec.filename);
    if model_ready_in(model_dir, spec) {
        sink(progress(
            spec,
            LocalModelDownloadState::Ready,
            spec.size,
            None,
        ));
        return Ok(final_path);
    }

    sink(progress(spec, LocalModelDownloadState::Checking, 0, None));

    let part_path = part_file_path(model_dir, spec);
    let partial_len = std::fs::metadata(&part_path).map(|m| m.len()).unwrap_or(0);
    if partial_len > spec.size {
        std::fs::remove_file(&part_path)
            .with_context(|| format!("remove oversized partial {}", part_path.display()))?;
    }
    let partial_len = std::fs::metadata(&part_path).map(|m| m.len()).unwrap_or(0);

    ensure_disk_space(model_dir, partial_len, spec.size)?;

    write_manifest(model_dir, &spec.manifest(LocalModelStatus::Downloading))?;
    sink(progress(
        spec,
        LocalModelDownloadState::Downloading,
        partial_len,
        None,
    ));

    let client = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(20))
        .timeout(std::time::Duration::from_secs(60 * 60))
        .build()
        .context("build local AI model download client")?;

    append_download(&client, spec, &part_path, partial_len, &sink).await?;

    let actual_size = std::fs::metadata(&part_path)
        .with_context(|| format!("stat {}", part_path.display()))?
        .len();
    if actual_size != spec.size {
        write_manifest(model_dir, &spec.manifest(LocalModelStatus::Error))?;
        bail!(
            "downloaded local AI model has wrong size: expected {}, got {}",
            spec.size,
            actual_size
        );
    }

    sink(progress(
        spec,
        LocalModelDownloadState::Verifying,
        spec.size,
        None,
    ));
    let actual_sha = sha256_file(&part_path)?;
    if actual_sha != spec.sha256 {
        let _ = std::fs::remove_file(&part_path);
        write_manifest(model_dir, &spec.manifest(LocalModelStatus::Error))?;
        bail!(
            "downloaded local AI model checksum mismatch: expected {}, got {}",
            spec.sha256,
            actual_sha
        );
    }

    std::fs::rename(&part_path, &final_path).with_context(|| {
        format!(
            "atomically move {} to {}",
            part_path.display(),
            final_path.display()
        )
    })?;
    write_manifest(model_dir, &spec.manifest(LocalModelStatus::Ready))?;
    sink(progress(
        spec,
        LocalModelDownloadState::Ready,
        spec.size,
        None,
    ));
    Ok(final_path)
}

pub async fn local_llm_model_status_value() -> Result<String> {
    if DOWNLOADING.load(Ordering::SeqCst) {
        return Ok("downloading".to_string());
    }

    let dir = writable_model_dir();
    let spec = ModelDownloadSpec::production();
    tokio::task::spawn_blocking(move || {
        if model_ready_in(&dir, &spec) {
            Ok("ready".to_string())
        } else {
            Ok("absent".to_string())
        }
    })
    .await
    .context("model status task join failed")?
}

#[tauri::command]
pub async fn local_llm_model_status() -> Result<String, String> {
    local_llm_model_status_value()
        .await
        .map_err(|e| format!("{e:#}"))
}

#[tauri::command]
pub async fn local_llm_model_ensure(app: AppHandle) -> Result<String, String> {
    if DOWNLOADING.load(Ordering::SeqCst) {
        return Ok("downloading".to_string());
    }

    let dir = writable_model_dir();
    let spec = ModelDownloadSpec::production();
    if model_ready_in(&dir, &spec) {
        emit(
            &app,
            progress(&spec, LocalModelDownloadState::Ready, spec.size, None),
        );
        return Ok("ready".to_string());
    }

    if DOWNLOADING
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return Ok("downloading".to_string());
    }
    let _guard = DownloadingGuard;

    let app_for_sink = app.clone();
    let result = download_model_to_dir(&dir, &spec, move |p| emit(&app_for_sink, p)).await;

    match result {
        Ok(_) => Ok("ready".to_string()),
        Err(e) => {
            let msg = format!("{e:#}");
            let _ = write_manifest(&dir, &spec.manifest(LocalModelStatus::Error));
            emit(
                &app,
                progress(&spec, LocalModelDownloadState::Error, 0, Some(msg.clone())),
            );
            Err(msg)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    fn tiny_spec(source_url: String, bytes: &[u8]) -> ModelDownloadSpec {
        let mut hasher = Sha256::new();
        hasher.update(bytes);
        let sha = hex::encode(hasher.finalize());
        ModelDownloadSpec {
            model_id: "tiny-test-model",
            repo: "local/tiny",
            revision: "test-revision",
            filename: "tiny-model.gguf",
            remote_filename: "tiny-model.gguf",
            size: bytes.len() as u64,
            sha256: Box::leak(sha.into_boxed_str()),
            source_url,
        }
    }

    async fn fake_model_server(bytes: Vec<u8>) -> (String, tokio::task::JoinHandle<()>) {
        let listener = TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
        let url = format!("http://{}/model.gguf", listener.local_addr().unwrap());
        let handle = tokio::spawn(async move {
            loop {
                let Ok((mut socket, _)) = listener.accept().await else {
                    break;
                };
                let body = bytes.clone();
                tokio::spawn(async move {
                    let mut buf = vec![0_u8; 4096];
                    let read = socket.read(&mut buf).await.unwrap_or(0);
                    let req = String::from_utf8_lossy(&buf[..read]);
                    let range_start = req.lines().find_map(|line| {
                        let lower = line.to_ascii_lowercase();
                        lower
                            .strip_prefix("range: bytes=")
                            .and_then(|range| range.strip_suffix('-'))
                            .and_then(|n| n.parse::<usize>().ok())
                    });
                    let start = range_start.unwrap_or(0).min(body.len());
                    let slice = &body[start..];
                    let header = if range_start.is_some() {
                        format!(
                            "HTTP/1.1 206 Partial Content\r\ncontent-length: {}\r\ncontent-range: bytes {}-{}/{}\r\n\r\n",
                            slice.len(),
                            start,
                            body.len().saturating_sub(1),
                            body.len()
                        )
                    } else {
                        format!("HTTP/1.1 200 OK\r\ncontent-length: {}\r\n\r\n", slice.len())
                    };
                    let _ = socket.write_all(header.as_bytes()).await;
                    let _ = socket.write_all(slice).await;
                });
            }
        });
        (url, handle)
    }

    #[test]
    fn production_manifest_uses_pinned_hugging_face_revision() {
        let spec = ModelDownloadSpec::production();
        assert_eq!(spec.revision, MODEL_REVISION);
        assert!(
            spec.source_url.contains(MODEL_REVISION),
            "{}",
            spec.source_url
        );
        assert!(
            spec.source_url.contains(REMOTE_FILENAME),
            "{}",
            spec.source_url
        );
        assert_eq!(spec.size, MODEL_SIZE_BYTES);
        assert_eq!(spec.sha256, MODEL_SHA256);
    }

    #[test]
    fn disk_space_check_counts_partial_file_bytes() {
        let expected = 1_000;
        let reserve = DISK_SPACE_RESERVE_BYTES;
        assert!(free_space_covers_download(expected + reserve, 0, expected));
        assert!(free_space_covers_download(100 + reserve, 900, expected));
        assert!(!free_space_covers_download(99 + reserve, 900, expected));
    }

    #[tokio::test]
    async fn downloads_tiny_model_and_writes_ready_manifest() {
        let bytes = b"tiny fake gguf bytes".to_vec();
        let (url, server) = fake_model_server(bytes.clone()).await;
        let spec = tiny_spec(url, &bytes);
        let tmp = tempfile::tempdir().unwrap();
        let events: Arc<Mutex<Vec<LocalModelDownloadState>>> = Arc::new(Mutex::new(Vec::new()));
        let sink_events = Arc::clone(&events);

        let path = download_model_to_dir(tmp.path(), &spec, move |p| {
            sink_events.lock().unwrap().push(p.state);
        })
        .await
        .unwrap();

        assert_eq!(std::fs::read(&path).unwrap(), bytes);
        assert!(model_ready_in(tmp.path(), &spec));
        let manifest = read_manifest(tmp.path()).unwrap().unwrap();
        assert_eq!(manifest.status, LocalModelStatus::Ready);
        let states = events.lock().unwrap().clone();
        assert!(states.contains(&LocalModelDownloadState::Checking));
        assert!(states.contains(&LocalModelDownloadState::Downloading));
        assert!(states.contains(&LocalModelDownloadState::Verifying));
        assert!(states.contains(&LocalModelDownloadState::Ready));
        server.abort();
    }

    #[tokio::test]
    async fn resumes_tiny_partial_download_with_range_request() {
        let bytes = b"0123456789abcdef".to_vec();
        let (url, server) = fake_model_server(bytes.clone()).await;
        let spec = tiny_spec(url, &bytes);
        let tmp = tempfile::tempdir().unwrap();
        let part = part_file_path(tmp.path(), &spec);
        std::fs::write(&part, &bytes[..7]).unwrap();

        let path = download_model_to_dir(tmp.path(), &spec, |_| {})
            .await
            .unwrap();

        assert_eq!(std::fs::read(&path).unwrap(), bytes);
        assert!(!part.exists());
        assert!(model_ready_in(tmp.path(), &spec));
        server.abort();
    }

    #[tokio::test]
    async fn checksum_mismatch_clears_partial_and_marks_error() {
        let bytes = b"actual bytes".to_vec();
        let (url, server) = fake_model_server(bytes.clone()).await;
        let mut spec = tiny_spec(url, &bytes);
        spec.sha256 = "0000000000000000000000000000000000000000000000000000000000000000";
        let tmp = tempfile::tempdir().unwrap();

        let err = download_model_to_dir(tmp.path(), &spec, |_| {})
            .await
            .unwrap_err()
            .to_string();

        assert!(err.contains("checksum mismatch"), "{err}");
        assert!(!part_file_path(tmp.path(), &spec).exists());
        let manifest = read_manifest(tmp.path()).unwrap().unwrap();
        assert_eq!(manifest.status, LocalModelStatus::Error);
        server.abort();
    }

    #[test]
    fn progress_payload_serializes_camel_case() {
        let spec = ModelDownloadSpec::production();
        let json = serde_json::to_string(&progress(
            &spec,
            LocalModelDownloadState::Downloading,
            5,
            None,
        ))
        .unwrap();
        assert!(json.contains("\"modelId\""), "{json}");
        assert!(json.contains("\"bytesDone\":5"), "{json}");
        assert!(json.contains("\"bytesTotal\":2497280736"), "{json}");
    }
}
