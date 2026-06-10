# Option B: Robust Visible Embedder-Model Download — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace today's silent, fragile first-use download of the e5-small embedding model (~465 MB) with a visible, resumable, retryable first-run download that the user can watch, while search and indexing degrade to an honest "not ready yet" state until the model is present.

**Architecture:** A new `model_download` Rust module owns the ONLY network path for model files: `model_ensure` downloads the 5 files fastembed needs via hf-hub (which resumes partial files via HTTP Range), emitting throttled `model-download-progress` Tauri events. `get_embedder()` and `rag_index_workspace` gain a cheap "are the files cached?" gate and return a typed `model-not-ready` error instead of downloading implicitly. The frontend adds a `useModelStatus` hook (auto-kicks `model_ensure` at app start), a non-modal `ModelDownloadCard` with progress + resume button, a deferred-until-ready workspace index, and a specific honest refusal in AI chat.

**Tech Stack:** Rust (Tauri 2, hf-hub 0.4.3 sync API with `Progress` trait, fastembed 4.9.1, reqwest for a HEAD size prepass), React + TypeScript, i18next (en/es/de + `scripts/lock-translation.mjs`), Vitest, cargo test.

**Branch:** work directly on `keepance-3.0` (the live 3.0 branch; v3.1.0 tag is already cut, so these commits land in the next release).

**Decision context (locked by Jameson 2026-06-10):** do NOT bundle the model into installers. `release.yml` prefetch stays OFF. Groundwork already committed and reused here: `src-tauri/src/bin/prefetch_model.rs` (documents the hf-hub cache layout), `resolve_cache_dir()` in `embedder.rs`.

**Verified API facts (checked against vendored sources, do not re-derive):**
- fastembed 4.9.1 `MultilingualE5Small`: `model_code = "intfloat/multilingual-e5-small"`, `model_file = "onnx/model.onnx"`, `additional_files = []`. Tokenizer loading fetches `config.json`, `tokenizer.json`, `special_tokens_map.json`, `tokenizer_config.json` (see `fastembed-4.9.1/src/common.rs`).
- hf-hub 0.4.3 sync API: `ApiBuilder::new().with_progress(bool).with_cache_dir(PathBuf).build()` → `Api::model(String)` → `ApiRepo::download_with_progress<P: Progress>(&str, P)`. The `Progress` trait lives at `hf_hub::api::Progress` with `init(size, filename)` / `update(delta_bytes)` / `finish()`. Downloads go to a temp file and RESUME via HTTP Range on retry.
- hf-hub cache lookup: `hf_hub::Cache::new(PathBuf).repo(Repo::model(String)).get(&str) -> Option<PathBuf>` (pure filesystem check, no network).
- fastembed's default features enable hf-hub with `ureq` + `native-tls`, so depending on `hf-hub = { version = "0.4.3", default-features = false, features = ["ureq", "native-tls"] }` adds ZERO new compiled deps.
- `tempfile = "3"` is already in `[dev-dependencies]` of `src-tauri/Cargo.toml`.

---

## File map

| File | Action | Responsibility |
|---|---|---|
| `src-tauri/Cargo.toml` | Modify | add direct `hf-hub` dep |
| `src-tauri/src/commands/rag/model_download.rs` | Create | presence check, download job, progress events, `model_status` + `model_ensure` commands |
| `src-tauri/src/commands/rag/mod.rs` | Modify | declare module; model gate in `rag_index_workspace` |
| `src-tauri/src/commands/rag/embedder.rs` | Modify | `MODEL_NOT_READY` gate in `get_embedder`, `warm_init()` |
| `src-tauri/src/lib.rs` | Modify | register the two new commands |
| `src/utils/tauri-commands.ts` | Modify | event const, payload type, `modelStatus()` / `modelEnsure()` wrappers, `MODEL_NOT_READY` marker |
| `src/hooks/useModelStatus.ts` | Create | subscribe to progress events, auto-kick ensure, expose retry |
| `src/components/memory/ModelDownloadCard.tsx` | Create | non-modal download banner with progress + resume |
| `src/App.tsx` | Modify | mount card next to `RagProgressBanner` (line ~3366) |
| `src/hooks/useMemoryWiring.ts` | Modify | defer full index until model ready (line ~300) |
| `src/components/ai/AIChatViewer.tsx` | Modify | model-not-ready refusal variant (line ~999) |
| `src/locales/{en,es,de}.json` | Modify | `model-download` section + `ai.chat.model-not-ready-refuse` |
| `tests/unit/model-status-hook.test.tsx` | Create | hook behavior (mirror `tests/unit/rag-status-hook.test.tsx`) |
| `tests/unit/model-download-card.test.tsx` | Create | card render states via the `status` prop override pattern |
| `CHANGELOG.md` | Modify | `[Unreleased]` entry |

---

### Task 1: Rust foundation — module, presence check, payload types

**Files:**
- Modify: `src-tauri/Cargo.toml` (after the `fastembed = "4"` line, ~line 94)
- Create: `src-tauri/src/commands/rag/model_download.rs`
- Modify: `src-tauri/src/commands/rag/mod.rs` (module declaration block, lines 25–30)

- [x] **Step 1: Add the hf-hub dependency**

In `src-tauri/Cargo.toml`, directly under `fastembed = "4"`:

```toml
# Direct dep on the SAME hf-hub fastembed uses (same version + features, so
# nothing new compiles). Gives us download_with_progress + the Cache lookup
# for the visible first-run model download (Option B).
hf-hub = { version = "0.4.3", default-features = false, features = ["ureq", "native-tls"] }
```

- [x] **Step 2: Declare the module**

In `src-tauri/src/commands/rag/mod.rs`, add to the module block (alphabetical, after `extractor`):

```rust
pub mod model_download;
```

- [x] **Step 3: Write the module skeleton with failing tests**

Create `src-tauri/src/commands/rag/model_download.rs`:

```rust
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

/// True while a download job is running (single-flight guard).
static DOWNLOADING: AtomicBool = AtomicBool::new(false);

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
```

- [x] **Step 4: Run the tests**

```bash
cd ~/keepance/src-tauri && cargo test --lib model_download 2>&1 | tail -15
```

Expected: first compile pulls nothing new (hf-hub already in tree); all 5 tests PASS. If `hf_hub::Repo::model` or `Cache::repo` names differ, check `~/.cargo/registry/src/*/hf-hub-0.4.3/src/lib.rs` lines 30–145 and adjust.

Note: `DOWNLOADING` is `#[allow(dead_code)]`-free but unused until Task 2 — if the compiler warns, add `#[allow(dead_code)]` on it temporarily and remove in Task 2.

- [x] **Step 5: Commit**

```bash
cd ~/keepance && git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/commands/rag/model_download.rs src-tauri/src/commands/rag/mod.rs
git commit -m "feat(rag): model_download module — presence check, progress payload (Option B groundwork)"
```

---

### Task 2: Rust download engine + commands

**Files:**
- Modify: `src-tauri/src/commands/rag/model_download.rs`
- Modify: `src-tauri/src/commands/rag/embedder.rs` (`resolve_cache_dir` convergence + `warm_init`)
- Modify: `src-tauri/src/lib.rs` (invoke_handler list, lines ~53–66)

- [x] **Step 0: CRITICAL (amendment from Task 1 quality review) — converge the two cache-dir functions**

Why: every CI build bundles `resources/embeddings/.gitkeep` (tauri.conf.json bundles `resources/**/*`), so `<exe_dir>/resources/embeddings/` EXISTS in every production install while containing no model (the bundle-prefetch is deliberately off). `resolve_cache_dir()`'s `cand.is_dir()` check therefore returns that empty, read-only install dir in production. Without this fix the Task 2/3 wiring loops forever: `model_ensure` downloads into the writable dir, the readiness gate re-checks the empty bundled dir, verification "fails", the error arm wipes the good download, Resume repeats. (The same ghost dir pointing fastembed's cache at a read-only install dir is the likely root cause of the original fragile first-run download.)

In `src-tauri/src/commands/rag/embedder.rs`, replace the entire body of `resolve_cache_dir()` with:

```rust
pub fn resolve_cache_dir() -> PathBuf {
    // 1. Bundled copy adjacent to the executable (production). Tauri puts
    //    `bundle.resources` next to the binary — check `<exe_dir>/resources/embeddings`
    //    and `<exe_dir>/../Resources/embeddings` (macOS .app layout).
    //
    //    IMPORTANT: existence is NOT enough. Every CI build ships
    //    `resources/embeddings/.gitkeep`, so this dir exists in all installs
    //    while the model ships in none (the bundle-prefetch is deliberately
    //    off). Only treat the bundle as the cache when it actually CONTAINS
    //    the model files; otherwise fall through to the user-writable dir
    //    that `model_download::model_ensure` downloads into.
    if let Ok(exe) = std::env::current_exe() {
        if let Some(exe_dir) = exe.parent() {
            let candidates = [
                exe_dir.join("resources").join("embeddings"),
                exe_dir.join("..").join("Resources").join("embeddings"),
            ];
            for cand in candidates {
                if super::model_download::model_files_cached(&cand) {
                    return cand;
                }
            }
        }
    }

    // 2./3. The single user-writable location, defined once in model_download.
    super::model_download::writable_cache_dir()
}
```

In `model_download.rs`, promote the test fixture helper out of the private `tests` module to module level so embedder's tests can reuse it (tests keep working via `use super::*`):

```rust
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
```

Fix the now-misleading doc comment on `writable_cache_dir()` to:

```rust
/// Where downloads land: ALWAYS the user-writable data dir. The bundled
/// resources dir can exist in every install while holding only a .gitkeep
/// (the bundle-prefetch is deliberately off), so it is never a download
/// target; `resolve_cache_dir()` selects it only when it actually contains
/// the model.
```

Add the variant-naming guard on the enum's serde attribute:

```rust
#[serde(rename_all = "lowercase")] // single-word variants only; switch to kebab-case before adding multi-word ones
```

In `embedder.rs` tests: (a) update `resolve_cache_dir_prefers_bundled_path_when_present` to POPULATE the bundled dir via `super::model_download::write_fake_layout(&bundled, &super::model_download::REQUIRED_FILES)` instead of just creating the empty dir (empty no longer wins); (b) update `resolve_cache_dir_falls_back_when_no_bundled_dir`'s skip-guard from `bundled.is_dir()` to `super::model_download::model_files_cached(&bundled)`; (c) add the agreement invariant:

```rust
    /// The agreement invariant that kills the drift risk: with no populated
    /// bundle next to the exe, the read path and the download path are the
    /// SAME directory.
    #[test]
    fn resolve_cache_dir_agrees_with_writable_cache_dir_without_bundle() {
        let exe = std::env::current_exe().expect("current_exe");
        let exe_dir = exe.parent().expect("exe has parent");
        let bundled = exe_dir.join("resources").join("embeddings");
        if super::model_download::model_files_cached(&bundled) {
            return; // a real populated bundle is adjacent; invariant doesn't apply
        }
        assert_eq!(
            resolve_cache_dir(),
            super::model_download::writable_cache_dir()
        );
    }
```

Run: `cd ~/keepance/src-tauri && cargo test --lib 2>&1 | tail -5` → green before moving on.

- [x] **Step 1: Add the download engine to `model_download.rs`**

Append after `writable_cache_dir` (before the tests module):

```rust
/// Emit one progress event, ignoring failures (a closed webview must not
/// break the download).
fn emit(app: &AppHandle, p: ModelDownloadProgress) {
    let _ = app.emit(MODEL_EVENT, p);
}

/// Best-effort exact grand total via HEAD on each file's resolve URL.
/// HF redirects to its CDN; reqwest follows redirects by default and the
/// final response carries the real content-length. Any failure → None and
/// the UI falls back to a byte counter.
async fn head_total_size() -> Option<u64> {
    let client = reqwest::Client::new();
    let mut sum: u64 = 0;
    for file in REQUIRED_FILES {
        let url = format!("https://huggingface.co/{MODEL_REPO}/resolve/main/{file}");
        let resp = client.head(&url).send().await.ok()?;
        if !resp.status().is_success() {
            return None;
        }
        let len = resp.content_length().or_else(|| {
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
    let p = cache.repo(hf_hub::Repo::model(MODEL_REPO.to_string())).get(file)?;
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
    let api = hf_hub::api::sync::ApiBuilder::new()
        .with_progress(false) // no terminal bar; we emit our own events
        .with_cache_dir(cache_dir.to_path_buf())
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
    let dir = embedder::resolve_cache_dir();
    let ready = tokio::task::spawn_blocking(move || model_files_cached(&dir))
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
    {
        let dir = embedder::resolve_cache_dir();
        let ready = tokio::task::spawn_blocking(move || model_files_cached(&dir))
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

    let result = run_download(&app).await;
    DOWNLOADING.store(false, Ordering::SeqCst);

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
```

Note: `warm_init` does not exist yet — Task 3 adds it. To keep THIS task compiling, add it now as part of this step (it is two lines, see Task 3 Step 1 for the final embedder.rs shape):

In `src-tauri/src/commands/rag/embedder.rs`, after `get_embedder`:

```rust
/// Initialize (or reuse) the embedder without embedding anything. Used by
/// `model_ensure` as the post-download verification step.
pub async fn warm_init() -> Result<()> {
    get_embedder().await.map(|_| ())
}
```

- [x] **Step 2: Add the ignored real-download integration test**

Append inside the `tests` module of `model_download.rs`:

```rust
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
```

- [x] **Step 3: Register the commands**

In `src-tauri/src/lib.rs`, in the `invoke_handler` list right after `commands::rag::rag_retag_matter` (line ~66):

```rust
            commands::rag::model_download::model_status,
            commands::rag::model_download::model_ensure,
```

- [x] **Step 4: Build + run unit tests**

```bash
cd ~/keepance/src-tauri && cargo test --lib model_download 2>&1 | tail -10
```

Expected: PASS (5 unit tests; the ignored one is skipped). Fix any signature drift against the vendored hf-hub source noted in the plan header.

- [x] **Step 5: Commit**

```bash
cd ~/keepance && git add src-tauri/src/commands/rag/model_download.rs src-tauri/src/commands/rag/embedder.rs src-tauri/src/lib.rs
git commit -m "feat(rag): visible resumable model download — model_ensure/model_status commands + progress events"
```

---

### Task 3: Rust gates — no implicit download, indexing defers honestly

**Files:**
- Modify: `src-tauri/src/commands/rag/model_download.rs` (Step 0 fixes from the Task 2 quality review)
- Modify: `src-tauri/src/commands/rag/embedder.rs` (`get_embedder`, lines 59–81)
- Modify: `src-tauri/src/commands/rag/mod.rs` (`rag_index_workspace`, starts line ~360)

- [x] **Step 0: Small fixes from the Task 2 quality review (all in `model_download.rs`)**

(i) `head_total_size()` currently uses `reqwest::Client::new()`, which has NO timeouts — on a DROP-style firewall each of the 5 sequential HEADs can hang for minutes while the UI sits on "Checking" and the single-flight guard blocks retry. Replace the client construction with:

```rust
    let client = match reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(10))
        .timeout(std::time::Duration::from_secs(20))
        .build()
    {
        Ok(c) => c,
        // Builder failure is exotic; the prepass is best-effort anyway.
        Err(_) => return None,
    };
```

(ii) `SinkProgress::init` must reset per-file counters (hf-hub's `Progress` contract: `init` may be called again on an internal retry, followed by `update(offset)` to re-seed position; without the reset a future `.with_retries(N)` would silently double-count and push the bar past 100%):

```rust
    fn init(&mut self, _size: usize, _filename: &str) {
        // hf-hub may call init again on an internal retry, then re-seed the
        // position via update(offset) — reset so a retry can't double-count.
        self.file_done = 0;
        self.last_emit = 0;
        self.emit_now();
    }
```

(iii) In `model_ensure`, check the single-flight guard BEFORE the cached fast-path (matches `model_status`'s order; removes a window where a concurrent caller emits Ready while another job is still in Verifying and could yet fail-and-wipe): move the `if DOWNLOADING.compare_exchange(...)` block above the fast-path block... NOT exactly — the CAS must stay where it is (it CLAIMS the slot). Correct minimal change: add a plain load check at the very top of `model_ensure`:

```rust
    if DOWNLOADING.load(Ordering::SeqCst) {
        return Ok("downloading".into());
    }
```

(iv) In `download_all`, build the API from the cache to avoid capturing a stale user-level HF token (`~/.cache/huggingface/token`) that could 401 where anonymous succeeds:

```rust
    let api = hf_hub::api::sync::ApiBuilder::from_cache(hf_hub::Cache::new(cache_dir.to_path_buf()))
        .with_progress(false)
        .build()
        .context("hf-hub api init")?;
```

(If `ApiBuilder::from_cache` does not exist in the vendored 0.4.3, check `~/.cargo/registry/src/*/hf-hub-0.4.3/src/api/sync.rs` for the equivalent constructor; if none exists, keep `new().with_cache_dir(...)` and add a comment noting the stale-token caveat instead.)

Run: `cd ~/keepance/src-tauri && cargo test --lib model_download 2>&1 | tail -5` → green.

- [x] **Step 1: Gate `get_embedder` behind the presence check**

In `embedder.rs`, add the marker constant near `EMBEDDING_DIM` (line ~21):

```rust
/// Typed marker for "the model files aren't downloaded yet". Embedded in
/// error strings crossing IPC; matched by the frontend
/// (`MODEL_NOT_READY` in `src/utils/tauri-commands.ts`) and never shown raw.
pub const MODEL_NOT_READY: &str = "model-not-ready";
```

Replace the body of the `get_or_try_init` closure in `get_embedder` (lines 62–78) with:

```rust
        .get_or_try_init(|| async {
            let cache_dir = resolve_cache_dir();
            // Option B: embed paths NEVER download implicitly. The only
            // network path for model files is `model_ensure`, which shows
            // real progress and supports resume/retry. Without this gate a
            // first search would silently stall for a ~465 MB download.
            let check_dir = cache_dir.clone();
            let cached = tokio::task::spawn_blocking(move || {
                super::model_download::model_files_cached(&check_dir)
            })
            .await
            .context("model presence check join failed")?;
            if !cached {
                anyhow::bail!(
                    "{MODEL_NOT_READY}: the search model is not downloaded yet"
                );
            }
            std::fs::create_dir_all(&cache_dir).ok();
            // Model load is CPU-bound and blocks the executor for a few
            // hundred ms. Hop to a dedicated blocking task so the Tauri
            // runtime stays responsive.
            let model = tokio::task::spawn_blocking(move || -> Result<TextEmbedding> {
                let opts = InitOptions::new(EmbeddingModel::MultilingualE5Small)
                    .with_cache_dir(cache_dir)
                    .with_show_download_progress(false);
                TextEmbedding::try_new(opts)
                    .context("failed to initialize fastembed e5-small model")
            })
            .await
            .context("embedder init join failed")??;
            Ok::<_, anyhow::Error>(Arc::new(model))
        })
```

(`OnceCell::get_or_try_init` does not cache failures, so a `MODEL_NOT_READY` error retries cleanly on the next call after the download completes. `warm_init` from Task 2 stays as-is.)

- [x] **Step 2: Gate `rag_index_workspace` WITHOUT consuming the activation latch**

In `mod.rs`, at the very top of `pub async fn rag_index_workspace` (immediately after the function signature's opening brace, BEFORE any latch/flag logic):

```rust
    // Option B: without the embedding model there is nothing to index. Bail
    // with the typed marker BEFORE consuming the once-per-activation latch
    // (F-301) so the frontend can simply re-call after `model_ensure`
    // reports ready and still get the full walk.
    {
        let dir = embedder::resolve_cache_dir();
        let cached = tokio::task::spawn_blocking(move || {
            model_download::model_files_cached(&dir)
        })
        .await
        .map_err(|e| e.to_string())?;
        if !cached {
            return Err(format!(
                "{}: indexing deferred until the model downloads",
                embedder::MODEL_NOT_READY
            ));
        }
    }
```

If `mod.rs` does not already have `use` access to `model_download` (it will via `pub mod model_download;` + the `model_download::` path), no extra import is needed; `embedder::` is already a sibling module path used in the file.

- [x] **Step 3: Full Rust test suite**

```bash
cd ~/keepance/src-tauri && cargo test 2>&1 | tail -15
```

Expected: all suites PASS (was 7/7 binaries green at v3.1.0 handoff). The embedder's own `#[test]`s do not call `get_embedder`, so the gate breaks nothing.

- [x] **Step 4: Commit**

```bash
cd ~/keepance && git add src-tauri/src/commands/rag/embedder.rs src-tauri/src/commands/rag/mod.rs
git commit -m "feat(rag): embed/index paths fail fast with model-not-ready instead of silently downloading"
```

---

### Task 4: Frontend plumbing — wrappers + useModelStatus hook

**Files:**
- Modify: `src/utils/tauri-commands.ts` (near the rag section, ~line 220)
- Create: `src/hooks/useModelStatus.ts`
- Create: `tests/unit/model-status-hook.test.tsx` (mirror the mocking style of `tests/unit/rag-status-hook.test.tsx` — read it first)

- [x] **Step 1: Add types + wrappers to `tauri-commands.ts`**

Place next to the existing RAG exports (match the file's local doc-comment style):

```ts
/** Tauri event for the one-time embedding-model download. Mirrors MODEL_EVENT in src-tauri/src/commands/rag/model_download.rs. */
export const MODEL_DOWNLOAD_EVENT = 'model-download-progress';

/** Marker substring in Rust errors meaning "model files not downloaded yet". Mirrors MODEL_NOT_READY in embedder.rs. */
export const MODEL_NOT_READY = 'model-not-ready';

export type ModelDownloadState =
  | 'checking'
  | 'downloading'
  | 'verifying'
  | 'ready'
  | 'error';

export interface ModelDownloadProgress {
  state: ModelDownloadState;
  file: string | null;
  bytesDone: number;
  bytesTotal: number | null;
  message: string | null;
}

/** Cheap model presence probe: 'ready' | 'absent' | 'downloading'. */
export async function modelStatus(): Promise<string> {
  return invoke<string>('model_status');
}

/** Idempotent: kicks off the visible model download when files are missing. */
export async function modelEnsure(): Promise<string> {
  return invoke<string>('model_ensure');
}
```

- [x] **Step 2: Read the existing hook test for the mock pattern**

```bash
sed -n '1,60p' ~/keepance/tests/unit/rag-status-hook.test.tsx
```

Mirror exactly how it mocks `@tauri-apps/api/core` (`isTauri`) and `@tauri-apps/api/event` (`listen`).

- [x] **Step 3: Write the failing hook test**

Create `tests/unit/model-status-hook.test.tsx` (adapt mock plumbing to what Step 2 showed; the assertions below are the contract):

```tsx
/**
 * useModelStatus — drives the one-time embedding-model download UI.
 * Contract under test:
 *  - outside Tauri: stays 'idle', never invokes anything
 *  - in Tauri with status 'absent': kicks modelEnsure once
 *  - progress events update the snapshot
 *  - retry() re-invokes modelEnsure
 */
import { renderHook, act, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

const listeners: Array<(e: { payload: unknown }) => void> = [];
const invokeMock = vi.fn();

vi.mock('@tauri-apps/api/core', () => ({
  isTauri: () => true,
  invoke: (...args: unknown[]) => invokeMock(...args),
}));
vi.mock('@tauri-apps/api/event', () => ({
  listen: async (_name: string, cb: (e: { payload: unknown }) => void) => {
    listeners.push(cb);
    return () => {};
  },
}));

import { useModelStatus } from '@/hooks/useModelStatus';

describe('useModelStatus', () => {
  beforeEach(() => {
    listeners.length = 0;
    invokeMock.mockReset();
  });

  it('kicks model_ensure when status is absent and tracks progress events', async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'model_status') return 'absent';
      if (cmd === 'model_ensure') return 'ready';
      return undefined;
    });

    const { result } = renderHook(() => useModelStatus());

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith('model_ensure'),
    );

    act(() => {
      for (const cb of listeners) {
        cb({
          payload: {
            state: 'downloading',
            file: 'onnx/model.onnx',
            bytesDone: 100 * 1024 * 1024,
            bytesTotal: 465 * 1024 * 1024,
            message: null,
          },
        });
      }
    });

    expect(result.current.state).toBe('downloading');
    expect(result.current.bytesDone).toBe(100 * 1024 * 1024);
    expect(result.current.bytesTotal).toBe(465 * 1024 * 1024);
  });

  it('reports ready without ensure when already cached', async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'model_status') return 'ready';
      return undefined;
    });
    const { result } = renderHook(() => useModelStatus());
    await waitFor(() => expect(result.current.state).toBe('ready'));
    expect(invokeMock).not.toHaveBeenCalledWith('model_ensure');
  });

  it('retry() re-invokes model_ensure', async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'model_status') return 'absent';
      if (cmd === 'model_ensure') return 'ready';
      return undefined;
    });
    const { result } = renderHook(() => useModelStatus());
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith('model_ensure'),
    );
    invokeMock.mockClear();
    act(() => result.current.retry());
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith('model_ensure'),
    );
  });
});
```

- [x] **Step 4: Run it — must FAIL (hook doesn't exist)**

```bash
cd ~/keepance && npx vitest run tests/unit/model-status-hook.test.tsx 2>&1 | tail -5
```

Expected: FAIL resolving `@/hooks/useModelStatus`.

- [x] **Step 5: Implement the hook**

Create `src/hooks/useModelStatus.ts`:

```ts
/**
 * useModelStatus — drive the one-time embedding-model download (Option B).
 *
 * On Tauri mount: probe `model_status`; when files are absent, kick
 * `model_ensure` (idempotent and single-flight on the Rust side) and stream
 * `model-download-progress` events into a snapshot the ModelDownloadCard
 * renders. Outside Tauri (browser/tests) the hook stays at 'idle' and the
 * card renders nothing — same convention as useRagStatus.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  MODEL_DOWNLOAD_EVENT,
  modelEnsure,
  modelStatus,
  type ModelDownloadProgress,
  type ModelDownloadState,
} from '@/utils/tauri-commands';

export interface ModelStatusSnapshot {
  state: 'idle' | ModelDownloadState;
  bytesDone: number;
  bytesTotal: number | null;
  message: string | null;
  retry: () => void;
}

interface SnapshotState {
  state: 'idle' | ModelDownloadState;
  bytesDone: number;
  bytesTotal: number | null;
  message: string | null;
}

const INITIAL: SnapshotState = {
  state: 'idle',
  bytesDone: 0,
  bytesTotal: null,
  message: null,
};

export function useModelStatus(): ModelStatusSnapshot {
  const [snap, setSnap] = useState<SnapshotState>(INITIAL);

  const retry = useCallback(() => {
    setSnap((s) => ({ ...s, state: 'checking', message: null }));
    void modelEnsure().catch(() => {
      /* the Error event carries the detail */
    });
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let cancelled = false;

    (async () => {
      try {
        const core = await import('@tauri-apps/api/core');
        if (!core.isTauri()) return;
        const { listen } = await import('@tauri-apps/api/event');
        const stop = await listen<ModelDownloadProgress>(
          MODEL_DOWNLOAD_EVENT,
          (event) => {
            const p = event.payload;
            setSnap({
              state: p.state,
              bytesDone: p.bytesDone,
              bytesTotal: p.bytesTotal,
              message: p.message ?? null,
            });
          },
        );
        if (cancelled) {
          stop();
          return;
        }
        unlisten = stop;

        const status = await modelStatus();
        if (cancelled) return;
        if (status === 'ready') {
          setSnap((s) => ({ ...s, state: 'ready' }));
        } else if (status === 'absent') {
          setSnap((s) => ({ ...s, state: 'checking' }));
          void modelEnsure().catch(() => {
            /* the Error event carries the detail */
          });
        }
        // status === 'downloading' → progress events stream in by themselves
      } catch {
        // Tauri APIs unavailable (browser / test) — stay idle.
      }
    })();

    return () => {
      cancelled = true;
      if (unlisten) unlisten();
    };
  }, []);

  return { ...snap, retry };
}
```

- [x] **Step 5b: Amendments from the Task 2 quality review (apply to the hook before running tests)**

(i) **Immediate `downloading` state on mount.** The engine throttles progress events to ~4 MB; on a slow link the first event after mount can be tens of seconds away, and on a stalled transfer it never comes. When the mount-time probe returns `'downloading'`, reflect it immediately instead of waiting for an event — in the `(async () => { ... })()` block, extend the status handling:

```ts
        } else if (status === 'downloading') {
          setSnap((s) => ({ ...s, state: 'downloading' }));
        }
```

(ii) **Stall watchdog.** A mid-transfer TCP stall (NAT timeout without RST) freezes hf-hub's read forever with no error event; the engine cannot detect it (hf-hub exposes no read-timeout), so the frontend must. Add `stalled: boolean` to `ModelStatusSnapshot` (initial `false`). In the hook: keep a `lastEventAtRef = useRef(Date.now())`; update it (and clear `stalled`) on every received event AND on the mount-time probe; add one interval (15 s) that sets `stalled: true` when state is `'checking' | 'downloading' | 'verifying'` and more than 90 s have passed since `lastEventAtRef`. Clear the interval in the effect cleanup. (Restarting the app fully recovers: the single-flight flag resets and hf-hub resumes the partial file via Range, so the stalled-state copy in Task 5 says exactly that.)

Add one test to `tests/unit/model-status-hook.test.tsx` (use `vi.useFakeTimers()` for this test only):

```tsx
  it('flags a stall when no progress event arrives for 90s while downloading', async () => {
    vi.useFakeTimers();
    try {
      invokeMock.mockImplementation(async (cmd: string) => {
        if (cmd === 'model_status') return 'downloading';
        return undefined;
      });
      const { result } = renderHook(() => useModelStatus());
      await act(async () => { await vi.advanceTimersByTimeAsync(50); });
      expect(result.current.state).toBe('downloading');
      expect(result.current.stalled).toBe(false);
      await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });
      expect(result.current.stalled).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
```

- [x] **Step 6: Run the test — must PASS**

```bash
cd ~/keepance && npx vitest run tests/unit/model-status-hook.test.tsx 2>&1 | tail -5
```

Note: the test mocks `invoke` via `@tauri-apps/api/core`; `tauri-commands.ts` imports `invoke` from there, so the mock intercepts it. If the suite shows the hook never calling `model_status`, check that the dynamic `import('@tauri-apps/api/core')` inside the hook resolves the mock (it does under Vitest module mocking).

- [x] **Step 7: Typecheck + commit**

```bash
cd ~/keepance && npx tsc --noEmit && git add src/utils/tauri-commands.ts src/hooks/useModelStatus.ts tests/unit/model-status-hook.test.tsx
git commit -m "feat(ui): useModelStatus hook + model download command wrappers"
```

---

### Task 5: ModelDownloadCard + locales + App mount

**Files:**
- Create: `src/components/memory/ModelDownloadCard.tsx`
- Create: `tests/unit/model-download-card.test.tsx`
- Modify: `src/App.tsx` (import block ~line 43; render next to `<RagProgressBanner />` at ~line 3366)
- Modify: `src/locales/en.json`, `src/locales/es.json`, `src/locales/de.json`

- [ ] **Step 1: Add locale strings**

In `src/locales/en.json`, add a sibling section near the rag/memory strings (find the `"memory"` or `"ai"` top-level section and place `"model-download"` at the same level):

```json
"model-download": {
  "title": "Setting up private search",
  "body": "Keepance is downloading its private search engine (about 465 MB), one time, from Hugging Face. You can keep working. Search and AI answers from your files switch on when it finishes.",
  "verifying": "Checking the downloaded files",
  "progress": "{{done}} MB of {{total}} MB",
  "progress-unknown": "{{done}} MB so far",
  "error-title": "The search engine download was interrupted",
  "error-body": "Nothing is lost. The download resumes where it stopped.",
  "retry": "Resume download"
}
```

Hand-translate the same keys into `es.json` and `de.json` (match the file's existing tone; these files are hand-maintained). Then lock each hand translation so `translate-i18n.mjs` won't overwrite it:

```bash
cd ~/keepance
for key in title body verifying progress progress-unknown error-title error-body retry; do
  node scripts/lock-translation.mjs es "model-download.$key"
  node scripts/lock-translation.mjs de "model-download.$key"
done
```

(If `lock-translation.mjs` expects a different key form, run it with no args to see usage and adapt. VOICE RULES: no em dashes anywhere in these strings; plain language.)

- [ ] **Step 2: Write the failing card test**

Create `tests/unit/model-download-card.test.tsx`:

```tsx
/**
 * ModelDownloadCard render contract:
 *  - idle / ready → renders nothing
 *  - downloading with a known total → title, MB-of-MB text, progressbar
 *  - downloading with unknown total → MB-so-far text
 *  - error → error title + Resume button wired to retry()
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ModelDownloadCard } from '@/components/memory/ModelDownloadCard';

const MB = 1024 * 1024;

function snap(over: Record<string, unknown>) {
  return {
    state: 'idle',
    bytesDone: 0,
    bytesTotal: null,
    message: null,
    retry: vi.fn(),
    ...over,
  } as never;
}

describe('ModelDownloadCard', () => {
  it('renders nothing when idle or ready', () => {
    const { container, rerender } = render(
      <ModelDownloadCard status={snap({ state: 'idle' })} />,
    );
    expect(container.firstChild).toBeNull();
    rerender(<ModelDownloadCard status={snap({ state: 'ready' })} />);
    expect(container.firstChild).toBeNull();
  });

  it('shows progress with a known total', () => {
    render(
      <ModelDownloadCard
        status={snap({
          state: 'downloading',
          bytesDone: 100 * MB,
          bytesTotal: 465 * MB,
        })}
      />,
    );
    expect(screen.getByTestId('model-download-card')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
    expect(screen.getByText(/100 MB/)).toBeInTheDocument();
    expect(screen.getByText(/465 MB/)).toBeInTheDocument();
  });

  it('shows MB-so-far when total is unknown', () => {
    render(
      <ModelDownloadCard
        status={snap({ state: 'downloading', bytesDone: 42 * MB })}
      />,
    );
    expect(screen.getByText(/42 MB/)).toBeInTheDocument();
  });

  it('shows a resume button on error that calls retry', () => {
    const retry = vi.fn();
    render(
      <ModelDownloadCard
        status={snap({ state: 'error', message: 'network unreachable', retry })}
      />,
    );
    const btn = screen.getByRole('button', { name: /resume/i });
    fireEvent.click(btn);
    expect(retry).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 3: Run it — must FAIL**

```bash
cd ~/keepance && npx vitest run tests/unit/model-download-card.test.tsx 2>&1 | tail -5
```

- [ ] **Step 4: Implement the card**

Create `src/components/memory/ModelDownloadCard.tsx` (mirrors `RagProgressBanner`'s conventions: non-modal slim banner, `status` prop override for tests, light theme via the existing token classes):

```tsx
/**
 * ModelDownloadCard — slim non-modal banner for the one-time embedding
 * model download (Option B). Sits next to RagProgressBanner in the
 * workspace shell.
 *
 * Visibility rule:
 *   - checking / downloading / verifying → progress banner
 *   - error → error banner with a Resume button (hf-hub resumes the
 *     partial file via HTTP Range, so "Resume" is honest)
 *   - idle / ready → renders nothing
 */

import { useTranslation } from 'react-i18next';
import { useModelStatus } from '@/hooks/useModelStatus';

export interface ModelDownloadCardProps {
  /** Override the live hook for tests. */
  status?: ReturnType<typeof useModelStatus>;
}

const MB = 1024 * 1024;

export function ModelDownloadCard({ status }: ModelDownloadCardProps) {
  const { t } = useTranslation();
  const live = useModelStatus();
  const snap = status ?? live;

  if (
    snap.state === 'idle' ||
    snap.state === 'ready'
  ) {
    return null;
  }

  if (snap.state === 'error') {
    return (
      <div
        data-testid="model-download-card"
        role="status"
        aria-live="polite"
        className="flex items-center gap-3 px-4 py-2 border-b bg-destructive/10 text-xs"
      >
        <div className="flex-1 min-w-0">
          <div className="font-medium text-foreground">
            {t('model-download.error-title')}
          </div>
          <div className="text-muted-foreground truncate">
            {t('model-download.error-body')}
            {snap.message ? ` (${snap.message})` : ''}
          </div>
        </div>
        <button
          type="button"
          onClick={snap.retry}
          className="shrink-0 rounded border px-2 py-1 font-medium text-foreground hover:bg-muted"
        >
          {t('model-download.retry')}
        </button>
      </div>
    );
  }

  const doneMb = Math.floor(snap.bytesDone / MB);
  const totalMb = snap.bytesTotal ? Math.ceil(snap.bytesTotal / MB) : null;
  const pct =
    snap.bytesTotal && snap.bytesTotal > 0
      ? Math.min(100, Math.round((snap.bytesDone / snap.bytesTotal) * 100))
      : null;

  return (
    <div
      data-testid="model-download-card"
      role="status"
      aria-live="polite"
      className="flex items-center gap-3 px-4 py-2 border-b bg-muted/40 text-xs"
    >
      <div className="flex-1 min-w-0">
        <div className="font-medium text-foreground">
          {t('model-download.title')}
          {pct !== null ? ` (${pct}%)` : ''}
        </div>
        <div className="text-muted-foreground">
          {snap.state === 'verifying'
            ? t('model-download.verifying')
            : t('model-download.body')}
        </div>
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          {...(pct !== null ? { 'aria-valuenow': pct } : {})}
          className="mt-1 h-1.5 w-full overflow-hidden rounded bg-muted"
        >
          <div
            className="h-full rounded bg-primary transition-[width]"
            style={{ width: pct !== null ? `${pct}%` : '100%' }}
          />
        </div>
        <div className="mt-0.5 text-muted-foreground">
          {totalMb !== null
            ? t('model-download.progress', { done: doneMb, total: totalMb })
            : t('model-download.progress-unknown', { done: doneMb })}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Run the card test — must PASS**

```bash
cd ~/keepance && npx vitest run tests/unit/model-download-card.test.tsx 2>&1 | tail -5
```

- [ ] **Step 5c: Stalled-state banner (amendments from the Task 2 + Task 4 quality reviews)**

When `snap.stalled` is true (and state is checking/downloading/verifying), the card shows a distinct line instead of the normal body text: locale key `model-download.stalled` = "The download looks stuck. Restarting Keepance resumes it where it stopped." (hand-translate es/de + lock, same as the other keys). Keep the progress bar visible. **Do NOT render a Resume/retry button in the stalled state** — on a true TCP hang, `model_ensure` returns "downloading" via the single-flight guard without emitting events, so Resume would just reset the stall window and re-flag; restarting the app is the only honest remedy (the Rust flag resets and hf-hub Range-resumes the partial file). The Resume button belongs to the `error` state only. Add render tests: stalled snapshot shows the stalled text AND no resume button.

- [ ] **Step 5d: Two cheap hook tests (from the Task 4 quality review; add to `tests/unit/model-status-hook.test.tsx`)**
1. Error-then-retry: fire an `error` event carrying a message, call `retry()`, assert `state === 'checking'`, `message === null`, `stalled === false` (the error card's Resume depends on that clearing).
2. Unmount cleanup: mirror the sibling `rag-status-hook.test.tsx` "unsubscribes on unmount" pattern (track the returned unlisten fn being called; with fake timers, also assert no watchdog tick fires after unmount).

- [ ] **Step 6: Mount in App.tsx**

Import next to the RagProgressBanner import (~line 43):

```tsx
import { ModelDownloadCard } from '@/components/memory/ModelDownloadCard';
```

Render directly above `<RagProgressBanner />` (~line 3366):

```tsx
      <ModelDownloadCard />
      <RagProgressBanner />
```

- [ ] **Step 7: Typecheck + full new-test pass + commit**

```bash
cd ~/keepance && npx tsc --noEmit \
  && npx vitest run tests/unit/model-download-card.test.tsx tests/unit/model-status-hook.test.tsx 2>&1 | tail -5
git add src/components/memory/ModelDownloadCard.tsx tests/unit/model-download-card.test.tsx src/App.tsx src/locales/en.json src/locales/es.json src/locales/de.json
git commit -m "feat(ui): first-run model download banner with live progress and resume"
```

---

### Task 6: Defer indexing until ready + honest AI refusal

**Files:**
- Modify: `src/hooks/useMemoryWiring.ts` (the full-index kick at lines ~298–308)
- Modify: `src/components/ai/AIChatViewer.tsx` (refusal site, lines ~986–1015)
- Modify: `src/locales/{en,es,de}.json` (`ai.chat.model-not-ready-refuse`)
- Test: extend the existing refusal coverage (find it: `grep -rln "retrieval-failed-refuse" tests/` — if no test exists, the new pure helper below gets its own small test file `tests/unit/refusal-key.test.ts`)

- [ ] **Step 1: Defer the full workspace index until the model is ready**

In `useMemoryWiring.ts`, replace the block at ~lines 298–308:

```ts
        // Background full-workspace index. Resolves when complete; the
        // banner / badge UI follow progress events independently.
        void MemoryService.indexWorkspace().catch(() => {
          /* errors are surfaced via the progress event with status: error */
        });

        // A3: if PDF indexing is enabled, also index PDF files in the workspace.
        if (isPdfIndexingEnabled() && workspaceService) {
          void indexWorkspacePdfs(workspaceService).catch(() => {});
        }
```

with:

```ts
        // Background full-workspace index. Resolves when complete; the
        // banner / badge UI follow progress events independently.
        //
        // Option B: the index needs the embedding model. When it is still
        // downloading (first run), wait for the model-download ready event
        // and start then — the Rust side also refuses without consuming
        // the once-per-activation latch, so this re-call gets a full walk.
        const startFullIndex = () => {
          void MemoryService.indexWorkspace().catch(() => {
            /* errors are surfaced via the progress event with status: error */
          });
          // A3: if PDF indexing is enabled, also index PDF files in the workspace.
          if (isPdfIndexingEnabled() && workspaceService) {
            void indexWorkspacePdfs(workspaceService).catch(() => {});
          }
        };
        const status = await modelStatus().catch(() => 'ready');
        if (status === 'ready') {
          startFullIndex();
        } else {
          const stopModelListen = await listen<ModelDownloadProgress>(
            MODEL_DOWNLOAD_EVENT,
            (event) => {
              if (event.payload.state === 'ready') {
                stopModelListen();
                startFullIndex();
              }
            },
          );
          if (cancelled) stopModelListen();
          else stopModelListeners.push(stopModelListen);
        }
```

Wiring notes for the implementer (read the surrounding effect first):
- `listen` is already dynamically imported in this effect's scope (it listens for file-watcher events); reuse that import. If the local name differs, adapt.
- Add `const stopModelListeners: Array<() => void> = [];` next to the effect's existing `unlisten` declaration, and call `stopModelListeners.forEach((s) => s());` in the effect's cleanup alongside the existing unlisten.
- Import at top of file: `import { MODEL_DOWNLOAD_EVENT, modelStatus, type ModelDownloadProgress } from '@/utils/tauri-commands';` (merge into the existing tauri-commands import if present).
- The `.catch(() => 'ready')` default keeps browser mode behavior identical to today (indexWorkspace already no-ops gracefully outside Tauri).
- A second `rag_set_workspace` for the SAME workspace does not re-arm the latch, so the deferred `startFullIndex` firing once per activation is preserved.

- [ ] **Step 1b: Mail RAG backfill on model-ready (amendment from the Task 3 quality review — closes a silent permanent gap)**

Why: `mailSyncAll` fires right after OAuth connect (`src/components/settings/MailConnect.tsx:50`). On a fresh install that is exactly the window when the model is absent, and each message's `index_mail_text_internal` failure is fire-and-forget (warn log only, `src-tauri/src/commands/mail/mod.rs:756/855/953`); delta sync never re-delivers those messages. Pre-gate, the implicit download made this eventually consistent; post-gate, mail imported before model-ready would NEVER get semantic recall. The canonical encrypted bodies are local, so healing needs no network.

Rust (`src-tauri/src/commands/mail/mod.rs` + `src-tauri/src/lib.rs` registration):
- When `index_mail_text_internal` fails AND the error contains `embedder::MODEL_NOT_READY`, set a persistent one-row marker in the mail meta store (key `rag_backfill_needed` = `'1'`; use whatever key-value/meta table the mail SQLCipher db already has — read the schema first; add a tiny meta table only if none exists).
- New `#[tauri::command] pub async fn mail_backfill_rag(...) -> Result<u32, String>`: if the marker is absent → return Ok(0) immediately (one row read; safe to call on every boot). If set → iterate all stored messages across accounts, re-run the same indexing path used during sync for each, clear the marker only after a fully successful pass, return the count. The pass must not produce duplicate chunks: verify whether the rag store's mail indexing replaces by `source_id` (delete-then-insert) — if it appends, delete that source's chunks first. If a per-message "chunks already exist" probe is cheap in the store, prefer skip-already-indexed; otherwise reindex-all-under-flag is acceptable (bounded by the marker).
- Unit-test what is cheaply testable (marker set/clear mechanics, the contains-MODEL_NOT_READY routing); the full path is exercised in the VG-1 harness later.

Frontend (same file as Step 1, `useMemoryWiring.ts`):
- In the model-ready transition added in Step 1, after `startFullIndex()`, also `void mailBackfillRag().catch(() => {})` (add the thin wrapper in `tauri-commands.ts`: `export async function mailBackfillRag(): Promise<number> { return invoke<number>('mail_backfill_rag'); }`).
- Also call it once on plain boot when the mount-time status is already `'ready'` (covers: user imported mail during download, then restarted before the backfill ran). The marker makes this a no-op in the common case.

- [ ] **Step 1c: Small Rust hardening bundled here (from the same review)**
- Use `{e:#}` (anyhow alternate = full chain) instead of `{e}` in the IPC `map_err` sites in `mod.rs` that wrap embed errors (grep for `format!("embed query: {e}")`, `"index_file failed: {e}"`, `"index_pdf_chunks: {e}"` — line refs ~287/597/853) and in the three mail warn-logs above, so the `model-not-ready` marker survives any future `.context()` wrapping and the logs show causes.
- Remove the now-dead `std::fs::create_dir_all(&cache_dir).ok();` in `embedder.rs::get_embedder` (the gate guarantees the dir exists).
- Fix the stale header NOTE in `src-tauri/tests/rag_matter_scope.rs` (it still says the first run downloads the model; under the gate the model must be pre-provisioned — say so and how: run the app once so `model_ensure` downloads, or populate `dirs::data_dir()/keepance/models/e5-small`).
- Update Task 6's commit to include the touched Rust files (`src-tauri/src/commands/mail/mod.rs`, `src-tauri/src/commands/rag/mod.rs`, `src-tauri/src/commands/rag/embedder.rs`, `src-tauri/src/lib.rs`, `src-tauri/tests/rag_matter_scope.rs`).

- [ ] **Step 2: Add the refusal helper + use it**

In `AIChatViewer.tsx`, add a small exported pure helper near the top of the file (module scope, after imports):

```ts
/**
 * Pick the refusal i18n key for a failed workspace retrieval. The
 * model-not-ready case gets its own honest message (the model is still
 * downloading) instead of the generic search-failed text with a raw
 * error string in it.
 */
export function refusalKeyForReason(
  reason: unknown,
): 'ai.chat.model-not-ready-refuse' | 'ai.chat.retrieval-failed-refuse' {
  return String(reason ?? '').includes(MODEL_NOT_READY)
    ? 'ai.chat.model-not-ready-refuse'
    : 'ai.chat.retrieval-failed-refuse';
}
```

Add `MODEL_NOT_READY` to the existing `@/utils/tauri-commands` import in this file.

At the refusal site (~line 999), replace:

```ts
          const refuseText = t('ai.chat.retrieval-failed-refuse', { reason });
```

with:

```ts
          const refusalKey = refusalKeyForReason(reason);
          const refuseText =
            refusalKey === 'ai.chat.model-not-ready-refuse'
              ? t(refusalKey)
              : t(refusalKey, { reason });
```

- [ ] **Step 3: Locale strings**

In `src/locales/en.json`, inside `ai.chat` next to `"retrieval-failed-refuse"` (~line 483):

```json
"model-not-ready-refuse": "Your private search engine is still downloading, so I can't search your workspace yet and won't answer from your matter. Watch the setup banner for progress, or turn off \"Ask my workspace\" to send this without workspace grounding.",
```

Hand-translate into `es.json` and `de.json` and lock:

```bash
cd ~/keepance && node scripts/lock-translation.mjs es "ai.chat.model-not-ready-refuse" && node scripts/lock-translation.mjs de "ai.chat.model-not-ready-refuse"
```

- [ ] **Step 4: Write the failing helper test**

Check for existing refusal tests first: `grep -rln "retrieval-failed-refuse" tests/`. Extend that file if it exists; otherwise create `tests/unit/refusal-key.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { refusalKeyForReason } from '@/components/ai/AIChatViewer';

describe('refusalKeyForReason', () => {
  it('routes model-not-ready errors to the download-specific refusal', () => {
    expect(
      refusalKeyForReason('model-not-ready: indexing deferred until the model downloads'),
    ).toBe('ai.chat.model-not-ready-refuse');
  });

  it('routes other failures to the generic refusal', () => {
    expect(refusalKeyForReason('lance dataset panic')).toBe(
      'ai.chat.retrieval-failed-refuse',
    );
    expect(refusalKeyForReason(undefined)).toBe(
      'ai.chat.retrieval-failed-refuse',
    );
  });
});
```

(If importing `AIChatViewer.tsx` into a unit test drags in heavy dependencies that break Vitest, move `refusalKeyForReason` to `src/utils/refusal.ts` instead, import it from AIChatViewer, and point the test there. Prefer the in-file export if it just works.)

- [ ] **Step 5: Run tests — PASS**

```bash
cd ~/keepance && npx vitest run tests/unit/refusal-key.test.ts 2>&1 | tail -5
```

(Adjust the path if Step 4 extended an existing file instead.)

- [ ] **Step 6: Typecheck + commit**

```bash
cd ~/keepance && npx tsc --noEmit
git add src/hooks/useMemoryWiring.ts src/components/ai/AIChatViewer.tsx src/locales/en.json src/locales/es.json src/locales/de.json tests/unit/
git commit -m "feat(rag): defer first index until the model is ready; honest AI refusal while downloading"
```

---

### Task 7: Full verification + real-download proof + CHANGELOG

**Files:**
- Modify: `CHANGELOG.md` (`[Unreleased]` section at the top)
- Optionally modify: `src-tauri/src/commands/rag/model_download.rs` (hardening below)

- [ ] **Step 0 (optional hardening from the Task 2 quality review; do if quick, skip without guilt):** (a) wrap the `DOWNLOADING` clear in `model_ensure` in a small RAII Drop guard (mirrors `IndexingGuard` in `mod.rs`) so a panic between the CAS and the store can never wedge status at "downloading"; (b) move the `resolve_cache_dir()` calls inside the existing `spawn_blocking` closures in `model_status`/`model_ensure` (it does a dozen fs syscalls; cosmetic). Neither blocks anything.

- [ ] **Step 0b (verification note from the Task 5 quality review):** in the dev-build sanity pass, confirm the ready handoff has no dead gap: the moment the download card vanishes (Ready), the deferred index kicks and the rag indexing banner appears — the rag banner provides the visible closure, which is why the card has no "done" flash of its own. Also confirm the card renders on BOTH the workspace-selector screen and the main shell (the first-run mount fix).

- [ ] **Step 1: Full gates**

```bash
cd ~/keepance && npx tsc --noEmit && npm run test 2>&1 | tail -6
cd ~/keepance/src-tauri && cargo test 2>&1 | tail -8
```

Expected: tsc clean; vitest fully green (2747+ tests at handoff plus the new ones); cargo green.

- [ ] **Step 2: Run the REAL download integration test once (network, ~465 MB)**

```bash
cd ~/keepance/src-tauri && cargo test --release real_model_download -- --ignored --nocapture 2>&1 | tail -15
```

Expected: progress lines streaming, then `test ... ok`. This proves the exact production code path (our file list → hf-hub download → cache layout → offline fastembed init) end to end on real infrastructure. If the rig lacks bandwidth right now, note it and flag in the final report instead of skipping silently.

- [ ] **Step 3: CHANGELOG entry**

Under `## [Unreleased]` in `CHANGELOG.md`:

```markdown
### Added
- **The one-time search engine download is now visible, resumable, and honest.** On first run Keepance shows a "Setting up private search" banner with live progress while it downloads its embedding model (about 465 MB, one time, from Hugging Face) instead of silently stalling the first search or index. A dropped connection shows a clear message with a Resume button that continues where it stopped (HTTP range resume). Until the model is present, workspace indexing defers itself and the AI says plainly that search isn't ready yet rather than failing cryptically; both start automatically the moment the download completes. Files: `src-tauri/src/commands/rag/model_download.rs`, `src-tauri/src/commands/rag/embedder.rs`, `src/hooks/useModelStatus.ts`, `src/components/memory/ModelDownloadCard.tsx`, `src/hooks/useMemoryWiring.ts`, `src/components/ai/AIChatViewer.tsx`.
```

- [ ] **Step 4: Commit + push**

```bash
cd ~/keepance && git add CHANGELOG.md && git commit -m "docs: changelog for the visible resumable model download" && git push origin keepance-3.0
```

---

## Self-review notes

- **Spec coverage:** visible progress screen (Task 5), retry/resume (hf-hub Range resume + Resume button, Tasks 2+5), offline/failure handling with clear message (Tasks 2+5), honest "search isn't ready yet" (Task 6 refusal + Task 3 typed errors), no silent download ever again (Task 3 gate), download starts automatically first run (Task 4 hook auto-ensure), ~465 MB copy (Task 5 locales), release.yml prefetch stays off (no task touches it), groundwork reused not redone (presence check built on `resolve_cache_dir` + hf-hub cache layout from `prefetch_model.rs`).
- **Out of scope (deliberate):** Option C (quantized e5-small) is a named follow-up, not here. No StatusBar chip (the banner persists until ready — YAGNI). No FirstRunWizard step (the banner is app-level and covers first run plus every later failure case with one surface).
- **Type consistency check:** `ModelDownloadState` lowercase serde ↔ TS union matches; `bytesDone`/`bytesTotal` camelCase ↔ `#[serde(rename_all = "camelCase")]`; `MODEL_NOT_READY` string identical in `embedder.rs` and `tauri-commands.ts`; `warm_init` introduced in Task 2 Step 1 and referenced by Task 2's `run_download`.
- **Known judgment calls for the implementer:** exact placement of locale sections (match file structure), the `listen` import reuse in `useMemoryWiring.ts` (read the effect first), and `lock-translation.mjs` invocation shape (check usage output).
