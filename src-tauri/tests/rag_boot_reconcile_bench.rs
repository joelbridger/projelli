//! P1.1 — end-to-end proof + BEFORE/AFTER measurement of the boot reconcile.
//!
//! This drives the SAME pipeline `run_workspace_index` uses (extract+embed →
//! LanceDB write → manifest signature; then a stat-walk reconcile that skips
//! unchanged files) on a realistic ~300-file workspace, minus the Tauri
//! `app.emit` progress calls (which need a real webview runtime). It asserts the
//! reconcile SKIPS unchanged files (the correctness win) and prints cold-boot vs
//! warm-boot vs one-file-changed timings (the perf win).
//!
//! Heavy: needs the e5-small model cache (downloads on first run into
//! `~/.local/share/lantern/models/e5-small`). Run explicitly:
//!
//!   cargo test --test rag_boot_reconcile_bench -- --ignored --nocapture
//!
//! The `--nocapture` is what surfaces the BEFORE/AFTER table.

use std::path::{Path, PathBuf};
use std::time::Instant;

use lantern_lib::commands::rag::{crypto, embedder, manifest, model_download, store};

/// Fixed key so the test never touches the OS keychain (chunk text is encrypted
/// at rest under this key, exactly as production encrypts under the real one).
const TEST_KEY: [u8; 32] = [0x42u8; 32];

/// Ensure the e5-small model is present, downloading it (once) if not. Mirrors
/// what `model_ensure` does in the app, but without an AppHandle for progress.
fn ensure_model() {
    let dir = model_download::writable_cache_dir();
    if model_download::model_files_cached(&dir) {
        return;
    }
    eprintln!("[bench] e5-small not cached — downloading to {dir:?} (one-time, ~448 MB)…");
    std::fs::create_dir_all(&dir).expect("create model cache dir");
    // fastembed downloads into the hf-hub layout `model_files_cached` recognizes.
    use fastembed::{EmbeddingModel, InitOptions, TextEmbedding};
    let opts = InitOptions::new(EmbeddingModel::MultilingualE5Small)
        .with_cache_dir(dir.clone())
        .with_show_download_progress(true);
    TextEmbedding::try_new(opts).expect("download + init e5-small");
    assert!(
        model_download::model_files_cached(&dir),
        "model still not cached after download"
    );
}

/// Write `n` realistic mixed text/markdown files under `root`, each a few KB of
/// paragraphs, spread across a handful of client folders.
fn generate_workspace(root: &Path, n: usize) -> Vec<PathBuf> {
    let mut files = Vec::with_capacity(n);
    for i in 0..n {
        let client = format!("Clients/Client-{:02}", i % 12);
        let dir = root.join(&client);
        std::fs::create_dir_all(&dir).unwrap();
        let ext = if i % 5 == 0 { "txt" } else { "md" };
        let path = dir.join(format!("note-{i:03}.{ext}"));
        // A few paragraphs so extraction + chunking + embedding do real work.
        let mut body = String::new();
        for p in 0..6 {
            body.push_str(&format!(
                "This is paragraph {p} of note {i}. It discusses the client's \
                 retirement allocation, the Roth conversion timeline, and the \
                 quarterly rebalancing plan agreed in the last review meeting. \
                 Reference figures and account identifiers vary per household so \
                 the passage stays distinct across the corpus for note {i}.\n\n"
            ));
        }
        std::fs::write(&path, body).unwrap();
        files.push(path);
    }
    files
}

#[tokio::test]
#[ignore]
async fn boot_reconcile_skips_unchanged_and_is_fast() {
    ensure_model();

    let tmp = tempfile::TempDir::new().unwrap();
    let root = tmp.path().to_path_buf();
    const N: usize = 300;
    let files = generate_workspace(&root, N);
    assert_eq!(files.len(), N);

    let conn = store::open_connection(&root).await.expect("open lancedb");
    let table = store::open_or_create_table(&conn).await.expect("open table");

    // ── COLD BOOT: extract+embed+write every file, record manifest ──────────
    let mut m = manifest::Manifest::new(store::INDEX_VERSION);
    let cold_started = Instant::now();
    let mut cold_indexed = 0u32;
    for f in &files {
        // The expensive path: extraction + chunking + embedding (public helper).
        let text = std::fs::read_to_string(f).unwrap();
        let chunks = lantern_lib::commands::rag::chunker::chunk_text(&f.to_string_lossy(), &text);
        let texts: Vec<String> = chunks.iter().map(|c| c.text.clone()).collect();
        let vectors = embedder::embed_documents_batched(&texts, None)
            .await
            .expect("embed")
            .expect("not cancelled");
        let rows: Vec<_> = chunks.into_iter().zip(vectors).collect();
        store::upsert_chunks_for_path(
            &table,
            &f.to_string_lossy(),
            rows,
            store::SourceType::Text,
            store::UNASSIGNED_MATTER,
            store::PRIVILEGE_NONE,
            &TEST_KEY,
        )
        .await
        .expect("upsert");
        let (size, mtime_ns) = manifest::stat_signature(f).unwrap();
        m.insert(
            crypto::path_token(&TEST_KEY, &f.to_string_lossy()),
            manifest::SourceSignature {
                size,
                mtime_ns,
                hash: None,
                extractor_version: manifest::EXTRACTOR_VERSION,
                chunker_version: manifest::CHUNKER_VERSION,
                embedder_version: manifest::EMBEDDER_VERSION.to_string(),
                pdf: None,
                matter_id: store::UNASSIGNED_MATTER.to_string(),
                privilege: store::PRIVILEGE_NONE.to_string(),
                row_count: 0,
                indexed_at: 0,
            },
        );
        cold_indexed += 1;
    }
    manifest::save(&root, &m).unwrap();
    let cold = cold_started.elapsed();
    assert_eq!(cold_indexed, N as u32);

    // ── WARM BOOT: stat-walk reconcile — everything must be SKIPPED ──────────
    let warm_started = Instant::now();
    let loaded = manifest::load(&root, store::INDEX_VERSION);
    let mut warm_reused = 0u32;
    let mut warm_reindex = 0u32;
    for f in &files {
        let norm = crypto::path_token(&TEST_KEY, &f.to_string_lossy());
        match manifest::decide_file(loaded.get(&norm), manifest::stat_signature(f), false) {
            manifest::FileDecision::Skip => warm_reused += 1,
            manifest::FileDecision::Reindex { .. } => warm_reindex += 1,
        }
    }
    let warm = warm_started.elapsed();
    assert_eq!(warm_reused, N as u32, "warm boot must skip every unchanged file");
    assert_eq!(warm_reindex, 0, "warm boot must re-index nothing");

    // ── ONE FILE CHANGED: reconcile must touch exactly 1 ────────────────────
    // Rewrite one file with new, larger content so size (and mtime) change.
    std::thread::sleep(std::time::Duration::from_millis(1100)); // ensure mtime tick
    let changed = &files[N / 2];
    std::fs::write(changed, "Completely new content after the client meeting.\n".repeat(20))
        .unwrap();
    let one_started = Instant::now();
    let loaded2 = manifest::load(&root, store::INDEX_VERSION);
    let mut one_reused = 0u32;
    let mut one_reindex = 0u32;
    for f in &files {
        let norm = crypto::path_token(&TEST_KEY, &f.to_string_lossy());
        match manifest::decide_file(loaded2.get(&norm), manifest::stat_signature(f), false) {
            manifest::FileDecision::Skip => one_reused += 1,
            manifest::FileDecision::Reindex { .. } => {
                one_reindex += 1;
                // Do the real re-embed for the one changed file (the actual work).
                let text = std::fs::read_to_string(f).unwrap();
                let chunks =
                    lantern_lib::commands::rag::chunker::chunk_text(&f.to_string_lossy(), &text);
                let texts: Vec<String> = chunks.iter().map(|c| c.text.clone()).collect();
                let vectors = embedder::embed_documents_batched(&texts, None)
                    .await
                    .unwrap()
                    .unwrap();
                let rows: Vec<_> = chunks.into_iter().zip(vectors).collect();
                store::upsert_chunks_for_path(
                    &table,
                    &f.to_string_lossy(),
                    rows,
                    store::SourceType::Text,
                    store::UNASSIGNED_MATTER,
                    store::PRIVILEGE_NONE,
                    &TEST_KEY,
                )
                .await
                .unwrap();
            }
        }
    }
    let one = one_started.elapsed();
    assert_eq!(one_reindex, 1, "exactly one changed file must re-index");
    assert_eq!(one_reused, (N - 1) as u32);

    // ── WARM BOOT WITH MATTER-MAPPED FOLDERS (the real-advisor case) ─────────
    // Every file lives under a client folder mapped to a matter. The OLD boot
    // applied that mapping by RE-EMBEDDING every file after the reconcile (≈ the
    // cold time — the reconcile's win was erased on any mapped workspace). The
    // NEW boot applies it by retagging the rows IN PLACE (a SQL column update,
    // no re-extract/embed). This measures the in-place path.
    let retag_started = Instant::now();
    let all_paths: Vec<String> = files.iter().map(|f| f.to_string_lossy().to_string()).collect();
    let retagged_rows = store::retag_matter_for_paths(&table, &all_paths, "acme", &TEST_KEY)
        .await
        .expect("batched retag matter in place");
    let retag = retag_started.elapsed();
    assert!(
        retagged_rows >= N as u64,
        "every file's rows retagged in place (got {retagged_rows} rows for {N} files)"
    );

    eprintln!("\n================  P1.1 BOOT RECONCILE — BEFORE/AFTER  ================");
    eprintln!("workspace: {N} text files");
    eprintln!("COLD boot (today's every-launch behaviour): {:>8.2?}  ({N} files embedded)", cold);
    eprintln!("WARM boot (reconcile, no changes):           {:>8.2?}  (0 embedded, {warm_reused} reused)", warm);
    eprintln!("ONE-FILE-CHANGED boot (reconcile):           {:>8.2?}  (1 embedded, {one_reused} reused)", one);
    let speedup = cold.as_secs_f64() / warm.as_secs_f64().max(1e-9);
    eprintln!("warm-boot speedup vs cold:                   {speedup:>8.0}x");
    eprintln!("--- with matter-mapped client folders (every real advisor workspace) ---");
    eprintln!("  OLD boot (retag by RE-EMBED all):          ≈ COLD ({:.2?})", cold);
    eprintln!("  NEW boot (retag IN PLACE, no embed):       {:>8.2?}  ({retagged_rows} rows over {N} files)", retag);
    let retag_speedup = cold.as_secs_f64() / retag.as_secs_f64().max(1e-9);
    eprintln!("  mapped-workspace warm-boot speedup:        {retag_speedup:>8.0}x", );
    eprintln!("=====================================================================\n");
}
