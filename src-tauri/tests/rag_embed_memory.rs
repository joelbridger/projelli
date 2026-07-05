//! F-501 — bounded-memory embedding of a large file.
//!
//! The unbatched path OOM-killed the app at 3G/6G/12G caps on this exact
//! fixture (RESULTS.md F-501). This test embeds all of huge-notes.md's
//! chunks through the production batched path and asserts completion plus
//! (on Linux) a sane process peak RSS.
//!
//! Needs the e5-small cache (this rig: ~/.local/share/lantern/models/
//! e5-small — same prerequisite as rag_matter_scope.rs / leg 1). Heavy:
//! run explicitly with `-- --ignored`.

use lantern_lib::commands::rag::{chunker, embedder};

fn peak_rss_gib() -> Option<f64> {
    let status = std::fs::read_to_string("/proc/self/status").ok()?;
    let line = status.lines().find(|l| l.starts_with("VmHWM:"))?;
    let kb: f64 = line.split_whitespace().nth(1)?.parse().ok()?;
    Some(kb / (1024.0 * 1024.0))
}

#[tokio::test]
#[ignore]
async fn huge_file_embeds_under_bounded_memory() {
    let fixture = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../tests/fixtures/matter-corpus/huge-notes.md"
    );
    let text = std::fs::read_to_string(fixture).expect("huge-notes.md fixture");
    let chunks = chunker::chunk_text("huge-notes.md", &text);
    assert!(
        chunks.len() > 1_000,
        "fixture should chunk to >1000 chunks, got {}",
        chunks.len()
    );
    let texts: Vec<String> = chunks.iter().map(|c| c.text.clone()).collect();

    let vectors = embedder::embed_documents_batched(&texts, None)
        .await
        .expect("batched embed completes")
        .expect("not cancelled");
    assert_eq!(vectors.len(), texts.len());
    assert_eq!(vectors[0].len(), embedder::EMBEDDING_DIM);

    if let Some(peak) = peak_rss_gib() {
        println!("VmHWM peak RSS: {peak:.2} GiB over {} chunks", texts.len());
        // Old behavior blew past 12 GiB on this fixture. Model session +
        // 32-chunk slices should stay far below; 6 GiB is a generous tripwire.
        assert!(peak < 6.0, "peak RSS {peak:.2} GiB >= 6 GiB bound");
    }
}
