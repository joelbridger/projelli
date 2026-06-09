//! Human-runnable demonstration of the three gate properties. Builds the
//! corpus in a tempdir, then prints: (1) a mixed-corpus cited answer, (2) the
//! adversarial "closing date" query unscoped vs scoped, and (3) a citation
//! verification of a real vs a tampered citation.
//!
//!   cargo run --bin demo
//!
//! This is for eyeballing the behaviour; the actual proof is `cargo test`.

use matter_retrieval as mr;
use mr::corpus::{MATTER_ACME, MATTER_GLOBEX};
use mr::{Citation, VerifyResult};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let dir = tempfile::tempdir()?;
    let model = mr::new_embedder()?;
    println!("Indexing corpus (2 matters x [2 docs + 2 emails]) ...");
    let table = mr::index_corpus(dir.path(), &model).await?;

    println!("\n=== Property 1: exact-source cited retrieval over MIXED corpus ===");
    for (q, label) in [
        ("what is the purchase price in the share purchase agreement", "document fact"),
        ("where do I send the wire and what is the routing number", "email fact"),
    ] {
        let hits = mr::retrieve(&table, &model, q, 3, None).await?;
        let h = &hits[0];
        println!(
            "Q ({label}): {q}\n  -> source_id={} type={:?} page={:?} score={:.3}\n     cite_id={}\n     chunk: {}\n",
            h.source_id,
            h.source_type,
            h.page_number,
            h.score,
            h.id,
            first_line(&h.text),
        );
    }

    println!("=== Property 2: matter isolation on the confusable \"closing date\" ===");
    let q = "what is the closing date";
    let unscoped = mr::retrieve(&table, &model, q, 6, None).await?;
    println!("UNSCOPED top sources for {q:?}:");
    for h in &unscoped {
        println!("  [{}] {} score={:.3}", h.matter_id, h.source_id, h.score);
    }
    for matter in [MATTER_ACME, MATTER_GLOBEX] {
        let scoped = mr::retrieve(&table, &model, q, 6, Some(matter)).await?;
        println!("SCOPED to {matter}:");
        for h in &scoped {
            println!("  [{}] {} score={:.3}", h.matter_id, h.source_id, h.score);
        }
        let leaked = scoped.iter().any(|h| h.matter_id != matter);
        println!("  -> cross-matter leak: {}\n", if leaked { "YES (FAIL)" } else { "none (PASS)" });
    }

    println!("=== Property 3: citation verification ===");
    let hits = mr::retrieve(&table, &model, "purchase price share purchase agreement", 1, Some(MATTER_ACME)).await?;
    let h = &hits[0];
    let good = Citation {
        id: h.id.clone(),
        matter_id: h.matter_id.clone(),
        source_id: h.source_id.clone(),
        paragraph_index: h.paragraph_index,
        page_number: h.page_number,
        quoted_text: "Four Million Two Hundred Thousand Dollars".to_string(),
    };
    println!("faithful citation -> {:?}", mr::verify_citation(&table, &good).await?);
    let mut tampered = good.clone();
    tampered.quoted_text = "ten billion dollars".to_string();
    let r = mr::verify_citation(&table, &tampered).await?;
    println!("misquoted citation -> {r:?}");
    assert_eq!(r, VerifyResult::TextMismatch);

    println!("\nDone. The proof is `cargo test`.");
    Ok(())
}

fn first_line(s: &str) -> String {
    s.lines().next().unwrap_or("").chars().take(80).collect()
}
