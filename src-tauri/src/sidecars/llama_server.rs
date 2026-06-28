// LlamaServerSidecar -- local chat generation via bundled llama.cpp server.
//
// Lifecycle shape: long-lived daemon, but strictly lazy.
// The process is not started during app setup. Callers start it only after the
// user chooses Keepance Local AI and the GGUF model is present on disk.
//
// Binary contract:
//   llama-server --host 127.0.0.1 --port <port>
//                --model <gguf-path> --ctx-size 16384 --parallel 1
//
// Health contract:
//   GET http://127.0.0.1:<port>/health returns 2xx when ready.

use super::Sidecar;
use anyhow::{anyhow, Context, Result};
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;
use tauri::{AppHandle, Manager};
use tokio::process::Child;
use tokio::time::{sleep, timeout, Instant};

pub const LLAMA_SERVER_HOST: &str = "127.0.0.1";
pub const LLAMA_SERVER_PORT: u16 = 18089;
pub const LLAMA_CONTEXT_SIZE: u32 = 16_384;
pub const LLAMA_PARALLEL: u32 = 1;
// Model load on first start memory-maps a multi-GB GGUF and warms up; on a
// modest laptop that can take well over half a minute. Give it real headroom
// (readiness is still gated by the /health probe, so a fast machine returns
// immediately).
pub const HEALTH_TIMEOUT_SECS: u64 = 120;
const HEALTH_POLL_MS: u64 = 200;
const MAX_LOG_LINES: usize = 200;

#[derive(Clone, Debug)]
pub struct LlamaServerLog {
    pub stream: &'static str,
    pub line: String,
}

pub struct LlamaServerSidecar {
    binary: PathBuf,
    model: PathBuf,
    host: String,
    port: u16,
    process: Option<Child>,
    log_path: PathBuf,
    client: reqwest::Client,
}

impl LlamaServerSidecar {
    pub fn new(binary: PathBuf, model: PathBuf) -> Self {
        Self::new_with_port(binary, model, LLAMA_SERVER_PORT)
    }

    pub fn new_with_port(binary: PathBuf, model: PathBuf, port: u16) -> Self {
        Self {
            binary,
            model,
            host: LLAMA_SERVER_HOST.to_string(),
            port,
            process: None,
            log_path: default_log_path(),
            client: reqwest::Client::new(),
        }
    }

    pub fn endpoint(&self) -> String {
        format!("http://{}:{}", self.host, self.port)
    }

    pub fn health_url(&self) -> String {
        format!("{}/health", self.endpoint())
    }

    pub fn model_path(&self) -> PathBuf {
        self.model.clone()
    }

    /// Recent llama-server output, read back from the on-disk log file. The
    /// child's stdout+stderr are redirected to a file (not in-process pipes) so
    /// a chatty multi-GB model load can never fill a pipe buffer and stall the
    /// engine; readiness is judged solely by the HTTP /health probe.
    pub fn logs(&self) -> Vec<LlamaServerLog> {
        read_log_tail(&self.log_path, MAX_LOG_LINES)
            .into_iter()
            .map(|line| LlamaServerLog {
                stream: "llama-server",
                line,
            })
            .collect()
    }

    pub fn build_args(&self) -> Vec<String> {
        vec![
            "--host".to_string(),
            self.host.clone(),
            "--port".to_string(),
            self.port.to_string(),
            "--model".to_string(),
            self.model.to_string_lossy().into_owned(),
            "--ctx-size".to_string(),
            LLAMA_CONTEXT_SIZE.to_string(),
            "--parallel".to_string(),
            LLAMA_PARALLEL.to_string(),
        ]
    }

    /// Start llama-server and wait until its health endpoint is ready.
    pub async fn start(&mut self) -> Result<()> {
        if self.health_check().await {
            return Ok(());
        }

        if self
            .process
            .as_mut()
            .and_then(|child| child.try_wait().ok())
            .flatten()
            .is_some()
        {
            self.process = None;
        }

        if self.process.is_none() {
            self.spawn()?;
        }

        self.wait_until_healthy(Duration::from_secs(HEALTH_TIMEOUT_SECS))
            .await
    }

    pub async fn stop(&mut self) -> Result<()> {
        if let Some(mut child) = self.process.take() {
            let _ = child.start_kill();
            let _ = timeout(Duration::from_secs(5), child.wait()).await;
        }
        Ok(())
    }

    pub async fn health_check(&self) -> bool {
        match timeout(
            Duration::from_secs(2),
            self.client.get(self.health_url()).send(),
        )
        .await
        {
            Ok(Ok(resp)) => resp.status().is_success(),
            _ => false,
        }
    }

    pub fn is_running(&mut self) -> bool {
        if let Some(child) = self.process.as_mut() {
            match child.try_wait() {
                Ok(Some(_status)) => {
                    self.process = None;
                    false
                }
                Ok(None) => true,
                Err(_) => {
                    self.process = None;
                    false
                }
            }
        } else {
            false
        }
    }

    fn spawn(&mut self) -> Result<()> {
        if !self.binary.exists() {
            return Err(anyhow!(
                "llama-server binary not found at {}",
                self.binary.display()
            ));
        }
        if !self.model.exists() {
            return Err(anyhow!("GGUF model not found at {}", self.model.display()));
        }

        // Redirect the engine's stdout+stderr to a log FILE rather than
        // in-process pipes. llama.cpp emits a large, carriage-return-heavy
        // stream while it memory-maps and warms up a multi-GB GGUF; if that
        // goes to a pipe nobody drains fast enough, the fixed OS pipe buffer
        // fills and the engine BLOCKS mid-load and never starts listening
        // (observed on the Windows bench). A file has no fixed buffer, so the
        // load always completes; readiness is the /health probe and the file is
        // read back for diagnostics.
        if let Some(parent) = self.log_path.parent() {
            std::fs::create_dir_all(parent)
                .with_context(|| format!("create llama-server log dir {}", parent.display()))?;
        }
        let log_file = std::fs::File::create(&self.log_path)
            .with_context(|| format!("open llama-server log file {}", self.log_path.display()))?;
        let log_clone = log_file
            .try_clone()
            .context("clone llama-server log file handle")?;

        let mut cmd = tokio::process::Command::new(&self.binary);
        cmd.args(self.build_args())
            .stdin(Stdio::null())
            .stdout(Stdio::from(log_file))
            .stderr(Stdio::from(log_clone));
        crate::util::proc::hide_console_tokio(&mut cmd);

        let child = cmd.spawn().with_context(|| {
            format!(
                "spawn llama-server binary {} for model {}",
                self.binary.display(),
                self.model.display()
            )
        })?;

        self.process = Some(child);
        Ok(())
    }

    async fn wait_until_healthy(&mut self, max_wait: Duration) -> Result<()> {
        let deadline = Instant::now() + max_wait;
        while Instant::now() < deadline {
            if self.health_check().await {
                return Ok(());
            }
            // If the child has exited, capture its exit status directly (so the
            // code isn't discarded) — the exit code distinguishes a crash
            // (0xC0000005), a missing-DLL loader failure (0xC0000135), and a
            // clean non-zero exit, which matters a lot for diagnosing the bench.
            let exit_note = match self.process.as_mut() {
                Some(child) => match child.try_wait() {
                    Ok(Some(status)) => {
                        self.process = None;
                        Some(match status.code() {
                            Some(code) => format!("exit code {code} / 0x{:08X}", code as u32),
                            None => format!("{status}"),
                        })
                    }
                    Ok(None) => None,
                    Err(e) => {
                        self.process = None;
                        Some(format!("wait error: {e}"))
                    }
                },
                None => Some("process handle missing".to_string()),
            };
            if let Some(note) = exit_note {
                let recent_logs = self
                    .logs()
                    .into_iter()
                    .rev()
                    .take(12)
                    .map(|entry| format!("{}: {}", entry.stream, entry.line))
                    .collect::<Vec<_>>()
                    .join("\n");
                return Err(anyhow!(
                    "llama-server exited before becoming healthy ({note})\n{recent_logs}"
                ));
            }
            sleep(Duration::from_millis(HEALTH_POLL_MS)).await;
        }

        Err(anyhow!(
            "llama-server did not become healthy within {} seconds",
            max_wait.as_secs()
        ))
    }
}

impl Sidecar for LlamaServerSidecar {
    fn name(&self) -> &str {
        "llama-server"
    }

    fn binary_path(&self) -> PathBuf {
        self.binary.clone()
    }

    /// Trait-level start is intentionally lazy because spawning is async.
    /// Use `LlamaServerSidecar::start().await` for real startup.
    fn start(&mut self) -> Result<()> {
        Ok(())
    }

    fn stop(&mut self) -> Result<()> {
        if let Some(mut child) = self.process.take() {
            let _ = child.start_kill();
        }
        Ok(())
    }

    fn is_running(&self) -> bool {
        self.process.is_some()
    }
}

/// Default path for the llama-server log file:
/// `<data-dir>/keepance/logs/llama-server.log`.
fn default_log_path() -> PathBuf {
    let base = dirs::data_dir().unwrap_or_else(std::env::temp_dir);
    base.join("keepance").join("logs").join("llama-server.log")
}

/// Read up to the last `max_lines` non-empty lines from `path` (best-effort).
/// Only the trailing 64 KiB is read so a long session's log can't blow up
/// memory, and llama.cpp's carriage-return progress is normalized to newlines.
fn read_log_tail(path: &Path, max_lines: usize) -> Vec<String> {
    const TAIL_BYTES: u64 = 64 * 1024;
    let Ok(mut file) = std::fs::File::open(path) else {
        return Vec::new();
    };
    let len = file.metadata().map(|m| m.len()).unwrap_or(0);
    let start = len.saturating_sub(TAIL_BYTES);
    if start > 0 {
        let _ = file.seek(SeekFrom::Start(start));
    }
    let mut bytes = Vec::new();
    if file.read_to_end(&mut bytes).is_err() {
        return Vec::new();
    }
    let text = String::from_utf8_lossy(&bytes).replace('\r', "\n");
    let lines: Vec<String> = text
        .lines()
        .map(|s| s.trim_end().to_string())
        .filter(|l| !l.is_empty())
        .collect();
    let skip = lines.len().saturating_sub(max_lines);
    lines.into_iter().skip(skip).collect()
}

fn with_platform_ext(name: &str) -> String {
    if cfg!(windows) {
        format!("{name}.exe")
    } else {
        name.to_string()
    }
}

fn target_triple() -> String {
    std::env::consts::ARCH.to_string()
        + "-"
        + if cfg!(target_os = "windows") {
            "pc-windows-msvc"
        } else if cfg!(target_os = "macos") {
            "apple-darwin"
        } else {
            "unknown-linux-gnu"
        }
}

fn triple_named_llama_server() -> String {
    format!("llama-server-{}", target_triple())
}

pub fn find_llama_server_in(root: &Path) -> Option<PathBuf> {
    // In packaged installs Tauri's externalBin copy is placed at the install
    // root, but llama.cpp's runtime DLLs/shared libs are bundled under
    // resources/binaries. Prefer the triple-named resource binary there so the
    // executable and its sibling libraries stay in the same directory.
    let candidate = root.join(with_platform_ext(&triple_named_llama_server()));
    if candidate.exists() {
        return Some(candidate);
    }

    let candidate = root.join(with_platform_ext("llama-server"));
    if candidate.exists() {
        return Some(candidate);
    }
    None
}

/// Resolve the bundled llama-server binary. This mirrors the Piper lookup:
/// installed app resources first, dev `src-tauri/binaries` fallback second.
pub fn resolve_llama_server_binary(app: &AppHandle) -> Option<PathBuf> {
    if let Ok(resource_dir) = app.path().resource_dir() {
        if let Some(path) = find_llama_server_in(&resource_dir.join("binaries")) {
            return Some(path);
        }
        if let Some(path) = find_llama_server_in(&resource_dir) {
            return Some(path);
        }
    }

    let dev_candidate = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("binaries")
        .join(with_platform_ext(&triple_named_llama_server()));
    if dev_candidate.exists() {
        return Some(dev_candidate);
    }

    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    fn sidecar(port: u16) -> LlamaServerSidecar {
        LlamaServerSidecar::new_with_port(
            PathBuf::from("/fake/bin/llama-server"),
            PathBuf::from("/fake/model.gguf"),
            port,
        )
    }

    async fn fake_health_server() -> (u16, tokio::task::JoinHandle<()>) {
        let listener = TcpListener::bind((LLAMA_SERVER_HOST, 0)).await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let handle = tokio::spawn(async move {
            loop {
                let Ok((mut socket, _)) = listener.accept().await else {
                    break;
                };
                tokio::spawn(async move {
                    let mut buf = [0_u8; 1024];
                    let _ = socket.read(&mut buf).await;
                    let req = String::from_utf8_lossy(&buf);
                    let response = if req.starts_with("GET /health ") {
                        "HTTP/1.1 200 OK\r\ncontent-length: 2\r\n\r\nOK"
                    } else {
                        "HTTP/1.1 404 Not Found\r\ncontent-length: 0\r\n\r\n"
                    };
                    let _ = socket.write_all(response.as_bytes()).await;
                });
            }
        });
        (port, handle)
    }

    #[test]
    fn name_is_llama_server() {
        assert_eq!(sidecar(LLAMA_SERVER_PORT).name(), "llama-server");
    }

    #[test]
    fn build_args_pin_local_host_model_context_and_parallelism() {
        let s = sidecar(18111);
        let args = s.build_args();
        assert!(args.windows(2).any(|w| w == ["--host", LLAMA_SERVER_HOST]));
        assert!(args.windows(2).any(|w| w == ["--port", "18111"]));
        assert!(args
            .windows(2)
            .any(|w| w == ["--model", "/fake/model.gguf"]));
        assert!(args.windows(2).any(|w| w == ["--ctx-size", "16384"]));
        assert!(args.windows(2).any(|w| w == ["--parallel", "1"]));
    }

    #[test]
    fn sidecar_is_lazy_before_start() {
        let mut s = sidecar(LLAMA_SERVER_PORT);
        assert!(!s.is_running());
        Sidecar::start(&mut s).unwrap();
        assert!(!s.is_running());
    }

    #[test]
    fn find_llama_server_hits_binary_name() {
        let tmp = tempfile::tempdir().unwrap();
        let name = if cfg!(windows) {
            "llama-server.exe"
        } else {
            "llama-server"
        };
        let expected = tmp.path().join(name);
        fs::write(&expected, b"fake binary").unwrap();
        assert_eq!(
            find_llama_server_in(tmp.path()).as_deref(),
            Some(expected.as_path())
        );
    }

    #[test]
    fn find_llama_server_prefers_triple_named_binary() {
        let tmp = tempfile::tempdir().unwrap();
        let expected = tmp
            .path()
            .join(with_platform_ext(&triple_named_llama_server()));
        fs::write(&expected, b"fake binary").unwrap();
        assert_eq!(
            find_llama_server_in(tmp.path()).as_deref(),
            Some(expected.as_path())
        );
    }

    #[test]
    fn find_llama_server_prefers_triple_named_over_plain_binary() {
        let tmp = tempfile::tempdir().unwrap();
        let expected = tmp
            .path()
            .join(with_platform_ext(&triple_named_llama_server()));
        let plain = tmp.path().join(with_platform_ext("llama-server"));
        fs::write(&expected, b"fake triple binary").unwrap();
        fs::write(&plain, b"fake plain binary").unwrap();
        assert_eq!(
            find_llama_server_in(tmp.path()).as_deref(),
            Some(expected.as_path())
        );
    }

    #[test]
    fn find_llama_server_returns_none_when_missing() {
        let tmp = tempfile::tempdir().unwrap();
        assert!(find_llama_server_in(tmp.path()).is_none());
    }

    #[tokio::test]
    async fn health_check_uses_fake_sidecar_endpoint() {
        let (port, server) = fake_health_server().await;
        let s = sidecar(port);
        assert!(s.health_check().await);
        server.abort();
    }

    #[tokio::test]
    async fn start_errors_when_fake_binary_is_missing() {
        let mut s = sidecar(LLAMA_SERVER_PORT);
        let err = s.start().await.unwrap_err().to_string();
        assert!(err.contains("llama-server binary not found"), "{err}");
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn start_uses_fake_sidecar_process_and_health_endpoint() {
        if std::process::Command::new("python3")
            .arg("--version")
            .output()
            .is_err()
        {
            return;
        }

        use std::os::unix::fs::PermissionsExt;

        let tmp = tempfile::tempdir().unwrap();
        let binary = tmp.path().join("llama-server");
        let model = tmp.path().join("tiny.gguf");
        fs::write(&model, b"fake model").unwrap();
        fs::write(
            &binary,
            r#"#!/usr/bin/env sh
host="127.0.0.1"
port="0"
while [ "$#" -gt 0 ]; do
  case "$1" in
    --host) shift; host="$1" ;;
    --port) shift; port="$1" ;;
  esac
  shift
done
python3 - "$host" "$port" <<'PY'
import http.server
import socketserver
import sys

host = sys.argv[1]
port = int(sys.argv[2])

class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/health":
            self.send_response(200)
            self.end_headers()
            self.wfile.write(b"OK")
        else:
            self.send_response(404)
            self.end_headers()
    def log_message(self, format, *args):
        pass

class Server(socketserver.TCPServer):
    allow_reuse_address = True

print("fake llama-server ready", flush=True)
with Server((host, port), Handler) as httpd:
    httpd.serve_forever()
PY
"#,
        )
        .unwrap();
        let mut perms = fs::metadata(&binary).unwrap().permissions();
        perms.set_mode(0o755);
        fs::set_permissions(&binary, perms).unwrap();

        let listener = TcpListener::bind((LLAMA_SERVER_HOST, 0)).await.unwrap();
        let port = listener.local_addr().unwrap().port();
        drop(listener);

        let mut s = LlamaServerSidecar::new_with_port(binary, model, port);
        s.start().await.unwrap();
        assert!(s.is_running());
        assert!(s.health_check().await);
        s.stop().await.unwrap();
        assert!(!s.is_running());
    }
}
