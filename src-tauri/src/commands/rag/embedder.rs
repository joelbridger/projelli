// Lazy-initialized text embedder backed by fastembed-rs / e5-small.
//
// One process-wide instance, hidden behind `embed_query` / `embed_documents`
// helpers. The first call instantiates the model (which may download the
// ONNX file from Hugging Face if it isn't cached); subsequent calls reuse
// the loaded session. fastembed's `embed` is `&self` + thread-safe, so a
// plain `Arc<TextEmbedding>` is enough; no Mutex required.
//
// e5-small expects "passage: " / "query: " prefixes — see the fastembed
// docstring. We add them transparently inside `embed_*` so callers don't
// have to remember.

use anyhow::{Context, Result};
use fastembed::{EmbeddingModel, InitOptions, TextEmbedding};
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::OnceCell;

/// Output dimension of the e5-small embedder. Hard-coded so the LanceDB
/// schema can declare a `FixedSizeList<Float32, EMBEDDING_DIM>` column.
pub const EMBEDDING_DIM: usize = 384;

/// Singleton handle. `OnceCell::get_or_try_init` makes the constructor run
/// at most once even under concurrent first-time access.
static EMBEDDER: OnceCell<Arc<TextEmbedding>> = OnceCell::const_new();

/// Resolve the cache directory used by fastembed. If a bundled copy of the
/// model exists under `src-tauri/resources/embeddings/` (Phase 4 prefetch
/// goal), we point fastembed at it so first-launch is offline-friendly.
/// Otherwise we fall back to the system data dir under `projelli/models`.
pub fn resolve_cache_dir() -> PathBuf {
    // 1. Bundled copy adjacent to the executable (production). Tauri puts
    //    `bundle.resources` next to the binary — check `<exe_dir>/resources/embeddings`
    //    and `<exe_dir>/../Resources/embeddings` (macOS .app layout).
    if let Ok(exe) = std::env::current_exe() {
        if let Some(exe_dir) = exe.parent() {
            let candidates = [
                exe_dir.join("resources").join("embeddings"),
                exe_dir.join("..").join("Resources").join("embeddings"),
            ];
            for cand in candidates {
                if cand.is_dir() {
                    return cand;
                }
            }
        }
    }

    // 2. App data dir under `projelli/models/e5-small`.
    if let Some(data_dir) = dirs::data_dir() {
        let p = data_dir.join("projelli").join("models").join("e5-small");
        return p;
    }

    // 3. Last resort: temp dir.
    std::env::temp_dir().join("projelli-e5-small")
}

/// Get the singleton embedder, initializing on first use.
async fn get_embedder() -> Result<Arc<TextEmbedding>> {
    EMBEDDER
        .get_or_try_init(|| async {
            let cache_dir = resolve_cache_dir();
            std::fs::create_dir_all(&cache_dir).ok();
            // Model load is CPU-bound and blocks the executor for a few
            // hundred ms (cached) to ~30s (cold download). Hop to a
            // dedicated blocking task so the Tauri runtime stays responsive.
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

/// Embed a single query string. Prepends the "query: " prefix expected by
/// the e5 model family. Returns a 384-dim float vector.
pub async fn embed_query(query: &str) -> Result<Vec<f32>> {
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
    Ok(vec)
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

    #[test]
    fn cache_dir_is_absolute() {
        let p = resolve_cache_dir();
        assert!(p.is_absolute(), "got {p:?}");
    }
}
