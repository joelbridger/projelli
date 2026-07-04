// Lazy-initialized text embedder backed by fastembed-rs / e5-small.
//
// One process-wide instance, hidden behind `embed_query` / `embed_documents`
// helpers. The first call instantiates the model from the local cache —
// never downloading: when the files aren't cached it fails fast with the
// `MODEL_NOT_READY` marker and `model_download::model_ensure` is the only
// network path. Subsequent calls reuse the loaded session. fastembed's
// `embed` is `&self` + thread-safe, so a plain `Arc<TextEmbedding>` is
// enough; no Mutex required.
//
// e5-small expects "passage: " / "query: " prefixes — see the fastembed
// docstring. We add them transparently inside `embed_*` so callers don't
// have to remember.

use anyhow::{Context, Result};
use fastembed::{EmbeddingModel, InitOptions, TextEmbedding};
use std::num::NonZeroUsize;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tokio::sync::OnceCell;

// Pulled in at module level so `mod tests` below can reach the sibling
// module's shared fixtures as `super::model_download::*`.
#[cfg(test)]
use super::model_download;

/// Output dimension of the e5-small embedder. Hard-coded so the LanceDB
/// schema can declare a `FixedSizeList<Float32, EMBEDDING_DIM>` column.
pub const EMBEDDING_DIM: usize = 384;

/// Typed marker for "the model files aren't downloaded yet". Embedded in
/// error strings crossing IPC; matched by the frontend
/// (`MODEL_NOT_READY` in `src/utils/tauri-commands.ts`) and never shown raw.
pub const MODEL_NOT_READY: &str = "model-not-ready";

/// Singleton handle. `OnceCell::get_or_try_init` makes the constructor run
/// at most once even under concurrent first-time access.
static EMBEDDER: OnceCell<Arc<TextEmbedding>> = OnceCell::const_new();

/// P2.1 (Finding 5) — bounded LRU cache mapping a query string to its
/// already-computed 384-dim embedding. Embedding the query is a CPU-bound ONNX
/// forward pass (tens to ~150 ms warm). The Ask/chat surfaces re-embed the SAME
/// text constantly — a retry, a "regenerate", the exact same question asked in
/// two matters, the privilege-exclusion demo re-running its probe — so a small
/// cache turns those repeats into a HashMap hit.
///
/// SAFETY / correctness notes:
///   * The embedding of a fixed string under a fixed model is deterministic, so a
///     cache hit is byte-for-byte what re-embedding would produce. The model is a
///     process-wide singleton that never swaps at runtime, so no versioning key is
///     needed. (`EMBEDDER_VERSION` is bumped in lockstep with any model change,
///     and the process restarts, clearing this cache.)
///   * Keyed on the EXACT raw query string, NOT a normalized form. e5-small is
///     case- and whitespace-sensitive, so `"IRA rollover"` and `"ira rollover"`
///     embed to DIFFERENT vectors; keying on a normalized form would let the
///     second reuse the first's vector and run retrieval with the wrong query
///     vector. The exact-string key guarantees a hit returns byte-for-byte what
///     re-embedding that raw query would produce. (This caches EXACT repeats — a
///     retry, a regenerate, the same question asked twice — which is the common
///     case; near-duplicates that differ only in spacing simply miss, which is
///     correct.)
///   * This is a PERFORMANCE cache only. It holds query text + vectors, never
///     chunk content, and lives only in memory — it is not a persistence or
///     confidentiality surface. Query strings are the user's own input.
const QUERY_CACHE_CAP: usize = 256;
static QUERY_CACHE: std::sync::OnceLock<Mutex<lru::LruCache<String, Arc<Vec<f32>>>>> =
    std::sync::OnceLock::new();

fn query_cache() -> &'static Mutex<lru::LruCache<String, Arc<Vec<f32>>>> {
    QUERY_CACHE.get_or_init(|| {
        Mutex::new(lru::LruCache::new(
            NonZeroUsize::new(QUERY_CACHE_CAP).expect("QUERY_CACHE_CAP > 0"),
        ))
    })
}

/// Resolve the cache directory used by fastembed. If a bundled copy of the
/// model exists under `src-tauri/resources/embeddings/` (Phase 4 prefetch
/// goal), we point fastembed at it so first-launch is offline-friendly.
/// Otherwise we fall back to the system data dir under `lantern/models`.
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

/// Get the singleton embedder, initializing on first use.
async fn get_embedder() -> Result<Arc<TextEmbedding>> {
    EMBEDDER
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
            // (No create_dir_all here: the presence gate above guarantees the
            // cache dir exists and is fully populated.)
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
        .await
        .cloned()
}

/// Initialize (or reuse) the embedder without embedding anything. Used by
/// `model_ensure` as the post-download verification step.
pub async fn warm_init() -> Result<()> {
    get_embedder().await.map(|_| ())
}

/// Embed a single query string. Prepends the "query: " prefix expected by
/// the e5 model family. Returns a 384-dim float vector.
pub async fn embed_query(query: &str) -> Result<Vec<f32>> {
    // P2.1 (Finding 5): serve a repeat query from the LRU cache instead of
    // re-running the ONNX forward pass. Keyed on the EXACT raw query so a hit is
    // byte-for-byte what re-embedding would produce. The cache holds an
    // `Arc<Vec<f32>>` so a hit is a cheap refcount bump + clone-out of 384 floats.
    let key = query.to_string();
    if let Some(hit) = query_cache().lock().unwrap().get(&key).cloned() {
        return Ok((*hit).clone());
    }

    let prefixed = format!("query: {}", query);
    let model = get_embedder().await?;
    let mut out = tokio::task::spawn_blocking(move || -> Result<Vec<Vec<f32>>> {
        model
            .embed(vec![prefixed], None)
            .context("e5-small embed_query failed")
    })
    .await
    .context("embed_query join failed")??;
    let vec = out
        .pop()
        .context("embed_query: model returned no vectors")?;
    debug_assert_eq!(vec.len(), EMBEDDING_DIM);

    // Populate the cache. `put` evicts the least-recently-used entry once the
    // capacity is reached, keeping the footprint bounded (~256 * 1.5 KB).
    let shared = Arc::new(vec);
    query_cache().lock().unwrap().put(key, Arc::clone(&shared));
    Ok((*shared).clone())
}

/// Embed a batch of document chunks. Prepends the "passage: " prefix.
/// Returns one 384-dim vector per input.
pub async fn embed_documents(docs: &[String]) -> Result<Vec<Vec<f32>>> {
    if docs.is_empty() {
        return Ok(Vec::new());
    }
    let prefixed: Vec<String> = docs.iter().map(|d| format!("passage: {}", d)).collect();
    let model = get_embedder().await?;
    let vecs = tokio::task::spawn_blocking(move || -> Result<Vec<Vec<f32>>> {
        model
            .embed(prefixed, None)
            .context("e5-small embed_documents failed")
    })
    .await
    .context("embed_documents join failed")??;
    Ok(vecs)
}

/// F-501 — bounded batch size for document embedding. One `embed_documents`
/// call materializes every output vector for its input at once (and
/// fastembed itself batches 256 sequences internally), so a single large
/// file could balloon past 12 GiB. 32 chunks ≈ 48 KiB of text per call
/// keeps the peak flat regardless of file size.
pub const EMBED_BATCH_SIZE: usize = 32;

/// Embed a (possibly large) chunk list in `EMBED_BATCH_SIZE` slices,
/// checking `cancel` between slices. Returns `Ok(None)` when cancelled so
/// the caller can skip the upsert cleanly (nothing partial is written; the
/// file simply re-indexes on the next pass).
pub async fn embed_documents_batched(
    docs: &[String],
    cancel: Option<&std::sync::atomic::AtomicBool>,
) -> Result<Option<Vec<Vec<f32>>>> {
    let mut out: Vec<Vec<f32>> = Vec::with_capacity(docs.len());
    for slice in docs.chunks(EMBED_BATCH_SIZE) {
        if let Some(flag) = cancel {
            if flag.load(std::sync::atomic::Ordering::SeqCst) {
                return Ok(None);
            }
        }
        out.extend(embed_documents(slice).await?);
    }
    Ok(Some(out))
}

/// Convert LanceDB cosine distance to a `[0, 1]` similarity score where
/// higher = better. LanceDB returns cosine distance in `[0, 2]`.
///
/// We map `distance -> max(0, 1 - distance / 2)` so:
///   - identical vectors (distance 0)  -> score 1.0
///   - orthogonal vectors (distance 1) -> score 0.5
///   - opposite vectors (distance 2)   -> score 0.0
///
/// Capped to the closed unit interval so the frontend can render a
/// percentage without bounds-checking.
pub fn cosine_distance_to_score(distance: f32) -> f32 {
    let score = 1.0 - (distance / 2.0);
    score.clamp(0.0, 1.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn score_at_distance_zero_is_one() {
        assert!((cosine_distance_to_score(0.0) - 1.0).abs() < 1e-6);
    }

    #[test]
    fn score_at_distance_one_is_half() {
        assert!((cosine_distance_to_score(1.0) - 0.5).abs() < 1e-6);
    }

    #[test]
    fn score_at_distance_two_is_zero() {
        assert!(cosine_distance_to_score(2.0).abs() < 1e-6);
    }

    #[test]
    fn score_clamps_negative_distance_to_one() {
        // Pathological negative distance from fp jitter.
        assert!((cosine_distance_to_score(-0.001) - 1.0).abs() < 1e-6);
    }

    #[test]
    fn score_clamps_overflow_distance_to_zero() {
        assert_eq!(cosine_distance_to_score(5.0), 0.0);
    }

    #[test]
    fn embedding_dim_is_384() {
        assert_eq!(EMBEDDING_DIM, 384);
    }

    #[tokio::test]
    async fn batched_embed_short_circuits_on_preset_cancel() {
        let cancel = std::sync::atomic::AtomicBool::new(true);
        let docs = vec!["never embedded".to_string()];
        let out = embed_documents_batched(&docs, Some(&cancel))
            .await
            .expect("no error path");
        assert!(out.is_none(), "cancelled embed must return None");
    }

    #[test]
    fn cache_dir_is_absolute() {
        let p = resolve_cache_dir();
        assert!(p.is_absolute(), "got {p:?}");
    }

    /// Verify that `resolve_cache_dir` returns the bundled path when the
    /// `resources/embeddings` directory adjacent to the test binary actually
    /// CONTAINS the model files (a bare directory no longer wins — every CI
    /// build ships an empty `resources/embeddings/.gitkeep`).
    ///
    /// This simulates the production layout where Tauri places
    /// `bundle.resources` next to the executable so `resolve_cache_dir()`
    /// finds it and skips the HuggingFace download.
    ///
    /// Strategy: build a full fake hf-hub layout in `resources/embeddings`
    /// next to the current test executable, call `resolve_cache_dir()`,
    /// assert we get that path, then clean up. Because
    /// `std::env::current_exe()` returns the real test binary path, this
    /// exercises the same code path as the production app.
    #[test]
    fn resolve_cache_dir_prefers_bundled_path_when_present() {
        let exe = std::env::current_exe().expect("current_exe");
        let exe_dir = exe.parent().expect("exe has parent");
        let bundled = exe_dir.join("resources").join("embeddings");

        // Populate a complete model layout: existence alone must not win.
        super::model_download::write_fake_layout(
            &bundled,
            &super::model_download::REQUIRED_FILES,
        );

        let result = resolve_cache_dir();

        // Clean up before asserting so a test failure doesn't leave the dir
        // behind and pollute later runs.
        let _ = std::fs::remove_dir_all(&bundled);

        assert_eq!(
            result.canonicalize().unwrap_or(result.clone()),
            bundled.canonicalize().unwrap_or(bundled.clone()),
            "expected bundled path {:?}, got {:?}",
            bundled,
            result,
        );
    }

    /// Verify that when no populated bundle exists, `resolve_cache_dir()`
    /// falls back to a path under the system data dir (or temp dir) — NOT
    /// the bundled location — so first-run downloads land somewhere
    /// writable in dev builds and production installs alike.
    #[test]
    fn resolve_cache_dir_falls_back_when_no_bundled_dir() {
        // Ensure no stray populated `resources/embeddings` layout is
        // adjacent to this binary (the previous test cleans up, but be
        // defensive).
        let exe = std::env::current_exe().expect("current_exe");
        let exe_dir = exe.parent().expect("exe has parent");
        let bundled = exe_dir.join("resources").join("embeddings");

        // Only run the assertion if the bundled dir truly holds no model.
        if super::model_download::model_files_cached(&bundled) {
            // Another test (or a real build) left it populated; skip rather
            // than fail misleadingly.
            return;
        }

        let result = resolve_cache_dir();
        assert!(
            result.is_absolute(),
            "fallback path must be absolute, got {result:?}"
        );
        assert!(
            !result.starts_with(&bundled),
            "fallback should NOT be the bundled path when it doesn't exist"
        );
    }

    /// The agreement invariant that kills the drift risk: with no populated
    /// bundle next to the exe, the read path and the download path are the
    /// SAME directory.
    #[test]
    fn resolve_cache_dir_agrees_with_writable_cache_dir_without_bundle() {
        let exe = std::env::current_exe().expect("current_exe");
        let exe_dir = exe.parent().expect("exe has parent");
        // Mirror BOTH candidate paths that resolve_cache_dir() checks so the
        // skip guard stays in sync with the production logic.  On Windows the
        // exe lives one level deeper (deps/), so the ".." candidate can be
        // populated even when the first one isn't — without checking both we'd
        // run the assert on a machine where resolve_cache_dir correctly returns
        // the second candidate, causing a spurious failure.
        let candidates = [
            exe_dir.join("resources").join("embeddings"),
            exe_dir.join("..").join("Resources").join("embeddings"),
        ];
        for cand in &candidates {
            if super::model_download::model_files_cached(cand) {
                return; // a real populated bundle is adjacent; invariant doesn't apply
            }
        }
        assert_eq!(
            resolve_cache_dir(),
            super::model_download::writable_cache_dir()
        );
    }
}
