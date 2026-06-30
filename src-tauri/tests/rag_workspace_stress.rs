//! Large-workspace stress — pre-Windows test plan item #5.
//!
//! Simulates indexing a many-file practice workspace through the PRODUCTION
//! chunk + batched-embed path, file by file (the embedding model session is
//! reused across files, exactly as real indexing does), and asserts the whole
//! pass completes with a BOUNDED process peak RSS. This is the realistic
//! "a lawyer with a big practice opens a large workspace" scenario that this
//! server (which has OOM history) cares about: does per-file indexing keep
//! memory flat, or does it grow unbounded across hundreds of files?
//!
//! It complements rag_embed_memory.rs (one huge file) with the many-file
//! dimension. The LanceDB upsert (I/O, separate path) is not exercised here;
//! the embedder is the dominant compute + memory consumer.
//!
//! Needs the e5-small cache (same prerequisite as rag_embed_memory.rs /
//! rag_matter_scope.rs). Heavy — run explicitly:
//!   cargo test --test rag_workspace_stress -- --ignored --nocapture
//! Tunable via env: KP_STRESS_FILES (default 300), KP_STRESS_PARAS (default 8).

use lantern_lib::commands::rag::{chunker, embedder};
use std::time::Instant;

fn peak_rss_gib() -> Option<f64> {
    let status = std::fs::read_to_string("/proc/self/status").ok()?;
    let line = status.lines().find(|l| l.starts_with("VmHWM:"))?;
    let kb: f64 = line.split_whitespace().nth(1)?.parse().ok()?;
    Some(kb / (1024.0 * 1024.0))
}

/// Procedurally generate distinct, realistic-ish legal-memo text for file `i`,
/// so every file embeds real, NON-identical content (no dedup/caching shortcut).
fn synth_file(i: usize, paras: usize) -> String {
    let kinds = ["purchase", "operating", "settlement", "licensing", "employment"];
    let mut s = format!("# Matter memo {i}\n\nClient file {i}. Internal work product.\n\n");
    for p in 0..paras {
        s.push_str(&format!(
            "Paragraph {p} of memo {i}. The parties dispute the allocation of liability under \
             section {}. Counsel reviewed the {} agreement dated {}, the deposition of witness \
             {}, and the indemnification cap of ${}. Recommended next steps include a conflict \
             check, a demand letter, and preservation of records relevant to claim {}.\n\n",
            (i * 7 + p) % 99 + 1,
            kinds[(i + p) % kinds.len()],
            2020 + ((i + p) % 6),
            (i * 13 + p) % 50,
            ((i + p) % 9 + 1) * 25_000,
            (i * 3 + p) % 40,
        ));
    }
    s
}

#[tokio::test]
#[ignore]
async fn large_workspace_indexes_under_bounded_memory() {
    let n_files: usize = std::env::var("KP_STRESS_FILES")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(300);
    let paras: usize = std::env::var("KP_STRESS_PARAS")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(8);

    eprintln!("===STRESS=== indexing {n_files} synthetic files ({paras} paragraphs each)");
    let start = Instant::now();
    let mut total_chunks = 0usize;

    for i in 0..n_files {
        let text = synth_file(i, paras);
        let path = format!("Matters/Client{i}/memo-{i}.md");
        let chunks = chunker::chunk_text(&path, &text);
        let texts: Vec<String> = chunks.iter().map(|c| c.text.clone()).collect();
        let vectors = embedder::embed_documents_batched(&texts, None)
            .await
            .expect("batched embed completes")
            .expect("not cancelled");
        assert_eq!(vectors.len(), texts.len(), "every chunk must embed");
        total_chunks += texts.len();
        if i % 50 == 0 || i + 1 == n_files {
            let peak = peak_rss_gib().unwrap_or(0.0);
            eprintln!(
                "===STRESS=== {}/{} files · {total_chunks} chunks · peak RSS {peak:.2} GiB",
                i + 1,
                n_files
            );
        }
    }

    let elapsed = start.elapsed().as_secs_f64();
    let cps = total_chunks as f64 / elapsed.max(0.001);
    let peak = peak_rss_gib().unwrap_or(0.0);
    eprintln!(
        "===STRESS=== DONE: {n_files} files, {total_chunks} chunks embedded in {elapsed:.1}s \
         ({cps:.1} chunks/s), peak RSS {peak:.2} GiB"
    );

    assert!(total_chunks > 0, "expected to chunk + embed something");
    if peak > 0.0 {
        // The batched path holds the model session + 32-chunk slices; memory
        // must stay flat across files, not grow with the file count. The same
        // 6 GiB tripwire rag_embed_memory.rs uses for one huge file.
        assert!(
            peak < 6.0,
            "peak RSS {peak:.2} GiB >= 6 GiB — workspace indexing memory regressed (grows with file count?)"
        );
    }
}
