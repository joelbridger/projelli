/// prefetch_model — download (or verify) the e5-small ONNX model into
/// `src-tauri/resources/embeddings/` so the Tauri installer can bundle it.
///
/// Run once before `tauri build` on each CI platform:
///
///   cd src-tauri
///   cargo run --bin prefetch_model --release
///
/// The binary writes to `resources/embeddings/` relative to the current working
/// directory (i.e. `src-tauri/resources/embeddings/`). That is the directory
/// checked in under version control (gitignored contents, .gitkeep committed).
/// After this runs, `tauri.conf.json` `bundle.resources` `"resources/**/*"`
/// picks up the entire populated subtree and ships it next to the binary.
///
/// fastembed cache layout (resolved, symlink-free — see SYMLINKS note):
///   resources/embeddings/
///     models--intfloat--multilingual-e5-small/
///       blobs/
///         <sha256-hash>                  (~448 MB ONNX model)
///         <sha256-hash>                  (~16 MB tokenizer.json)
///         <sha-hash>                     (config.json, special_tokens_map, etc.)
///         *.lock                         (empty lock files, safe to bundle)
///       refs/
///         main                           (contains the commit hash)
///       snapshots/
///         <commit-hash>/
///           config.json                  (real file, resolved from blobs/)
///           onnx/
///             model.onnx                 (real file, resolved from blobs/)
///           special_tokens_map.json      (real file, resolved from blobs/)
///           tokenizer.json               (real file, resolved from blobs/)
///           tokenizer_config.json        (real file, resolved from blobs/)
///
/// SYMLINKS: fastembed downloads with relative symlinks in snapshots/ → blobs/.
/// Tauri's bundler (WalkDir, follow_links:false) copies symlinks as-is, which
/// breaks on Windows (NSIS can't create relative symlinks). This binary resolves
/// ALL symlinks in-place — replacing each symlink with a real copy of its target.
/// Result: the bundled resources/ tree is symlink-free and works on all platforms.
///
/// When the Tauri app starts, `resolve_cache_dir()` in embedder.rs detects
/// `<exe_dir>/resources/embeddings` (Tauri places bundle.resources there) and
/// passes it as the fastembed cache_dir. fastembed finds the populated directory
/// and skips the network download entirely.
///
/// Total size: ~465 MB (ONNX + tokenizer + config files). Not committed to git.
/// The .gitignore excludes the populated directory; only .gitkeep is committed.

use fastembed::{EmbeddingModel, InitOptions, TextEmbedding};
use std::path::PathBuf;

fn main() -> anyhow::Result<()> {
    // Derive the resources/embeddings path relative to the CWD so this binary
    // works when `cargo run --bin prefetch_model` is invoked from `src-tauri/`.
    let cwd = std::env::current_dir()
        .expect("could not read current directory");
    let cache_dir = cwd.join("resources").join("embeddings");
    std::fs::create_dir_all(&cache_dir)?;

    println!("prefetch_model: target cache dir = {}", cache_dir.display());

    // Load (or download) the model into the cache dir.
    let opts = InitOptions::new(EmbeddingModel::MultilingualE5Small)
        .with_cache_dir(cache_dir.clone())
        .with_show_download_progress(true);

    println!("prefetch_model: initializing TextEmbedding (will download if not cached)...");
    let model = TextEmbedding::try_new(opts)?;

    // Smoke-test: embed one query to confirm the ONNX session is healthy.
    let test_text = vec!["query: prefetch smoke test".to_string()];
    let vecs = model.embed(test_text, None)?;
    assert_eq!(vecs.len(), 1, "expected exactly 1 embedding vector");
    assert_eq!(vecs[0].len(), 384, "expected 384-dim e5-small vector");
    println!("prefetch_model: smoke test OK — got 384-dim vector");

    // Resolve all symlinks in the cache dir to real files.
    // fastembed creates relative symlinks in snapshots/ → blobs/. Tauri's
    // bundler (WalkDir default follow_links:false) copies symlinks as-is,
    // which breaks Windows installers. Replace every symlink with a real copy.
    println!("prefetch_model: resolving symlinks in cache dir...");
    let resolved = resolve_symlinks(&cache_dir)?;
    println!("prefetch_model: resolved {} symlink(s)", resolved);

    // Report the populated layout + total size.
    println!("\nprefetch_model: cache layout (symlink-free):");
    print_tree(&cache_dir, 0);

    let total_bytes = dir_size(&cache_dir);
    println!(
        "\nprefetch_model: total size = {:.1} MB ({} bytes)",
        total_bytes as f64 / 1_048_576.0,
        total_bytes
    );
    println!("prefetch_model: DONE — resources/embeddings/ is ready to bundle.");
    Ok(())
}

/// Recursively walk `dir` and replace every symlink with a real copy of its
/// resolved target. Returns the number of symlinks resolved.
fn resolve_symlinks(dir: &PathBuf) -> anyhow::Result<usize> {
    let mut count = 0;
    let entries: Vec<_> = std::fs::read_dir(dir)?.flatten().collect();
    for entry in entries {
        let path = entry.path();
        if path.is_symlink() {
            // Resolve the symlink to its canonical target.
            let target = std::fs::canonicalize(&path)?;
            if !target.exists() {
                eprintln!("warn: symlink target does not exist: {}", target.display());
                continue;
            }
            // Remove the symlink and replace with a real copy.
            std::fs::remove_file(&path)?;
            std::fs::copy(&target, &path)?;
            count += 1;
        } else if path.is_dir() {
            count += resolve_symlinks(&path)?;
        }
    }
    Ok(count)
}

fn print_tree(dir: &PathBuf, depth: usize) {
    let indent = "  ".repeat(depth);
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    let mut entries: Vec<_> = entries.flatten().collect();
    entries.sort_by_key(|e| e.path());
    for entry in entries {
        let path = entry.path();
        let name = path.file_name().unwrap_or_default().to_string_lossy();
        if path.is_symlink() {
            let target = std::fs::read_link(&path).map(|t| t.display().to_string()).unwrap_or("?".into());
            println!("{indent}{name}  -> {target}  [SYMLINK — will be resolved]");
        } else if path.is_dir() {
            println!("{indent}{name}/");
            print_tree(&path, depth + 1);
        } else {
            let size = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
            println!("{indent}{name}  ({} bytes)", size);
        }
    }
}

fn dir_size(dir: &PathBuf) -> u64 {
    let Ok(entries) = std::fs::read_dir(dir) else { return 0 };
    entries.flatten().map(|e| {
        let p = e.path();
        if p.is_symlink() {
            // Should not happen after resolve_symlinks(), but handle gracefully.
            0
        } else if p.is_dir() {
            dir_size(&p)
        } else {
            std::fs::metadata(&p).map(|m| m.len()).unwrap_or(0)
        }
    }).sum()
}
