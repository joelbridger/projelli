//! The GATE: prove properties 1, 2, 3 of confidential matter-scoped retrieval.
//!
//! These are integration tests that exercise the SAME LanceDB + fastembed
//! e5-small path the Keepance app uses, with the added `matter_id` column +
//! `only_if` store-level filter. They build a real on-disk LanceDB table in a
//! tempdir, embed a small mixed (documents + emails) two-matter corpus, and
//! assert:
//!
//!   Property 1 — exact-source cited retrieval over a MIXED corpus.
//!   Property 2 — matter isolation, including the adversarial confusable-term case.
//!   Property 3 — citation verification (exists + matter + text match).
//!
//! NOTE: the first run downloads the e5-small ONNX model (~120MB) from Hugging
//! Face into the fastembed cache; subsequent runs are offline. Model load +
//! indexing happens ONCE per test binary via a shared OnceCell.

use matter_retrieval as mr;
use mr::corpus::{MATTER_ACME, MATTER_GLOBEX};
use mr::{Citation, VerifyResult};
use std::sync::Arc;
use tokio::sync::OnceCell;

/// Shared, indexed corpus: one model load + one index build for the whole
/// binary. The TempDir is kept alive for the process lifetime so the on-disk
/// LanceDB table stays valid across tests.
struct Fixture {
    table: lancedb::Table,
    model: fastembed::TextEmbedding,
    _dir: tempfile::TempDir,
}

static FIXTURE: OnceCell<Arc<Fixture>> = OnceCell::const_new();

async fn fixture() -> Arc<Fixture> {
    FIXTURE
        .get_or_init(|| async {
            let dir = tempfile::tempdir().expect("tempdir");
            let model = mr::new_embedder().expect("init e5-small embedder");
            let table = mr::index_corpus(dir.path(), &model)
                .await
                .expect("index corpus");
            Arc::new(Fixture {
                table,
                model,
                _dir: dir,
            })
        })
        .await
        .clone()
}

// ===========================================================================
// Property 1 — Exact-source cited retrieval over a MIXED corpus.
// A natural-language query returns the right chunk with a citation that
// resolves back to the precise source (document path or mail id + paragraph/
// page), across a corpus containing BOTH documents and emails.
// ===========================================================================

#[tokio::test]
async fn p1_document_query_returns_exact_source_with_citation() {
    let f = fixture().await;
    // Ask about something only the Acme SPA document says (the $4.2M price).
    let hits = mr::retrieve(&f.table, &f.model, "what is the purchase price in the share purchase agreement", 5, None)
        .await
        .expect("retrieve");
    assert!(!hits.is_empty(), "expected at least one hit");
    let top = &hits[0];
    // The citation resolves to the exact source: the SPA document, a page.
    assert_eq!(top.source_id, "doc:acme-spa", "top hit should be the SPA document, got {}", top.source_id);
    assert_eq!(top.source_type.as_deref(), Some("document"));
    assert_eq!(top.page_number, Some(7), "document citation must carry the page number");
    assert!(top.text.contains("4,200,000"), "retrieved chunk must contain the cited fact");
    // Citation key is content-addressed and reproducible from (source_id, paragraph_index).
    assert_eq!(top.id, mr::chunk_id(&top.source_id, top.paragraph_index));
}

#[tokio::test]
async fn p1_email_query_returns_exact_email_source_with_citation() {
    let f = fixture().await;
    // Ask about wire instructions — that content lives ONLY in an email.
    let hits = mr::retrieve(&f.table, &f.model, "where do we send the wire and what is the routing number", 5, None)
        .await
        .expect("retrieve");
    assert!(!hits.is_empty());
    let top = &hits[0];
    assert_eq!(top.source_id, "mail:acme-0001", "top hit should be the wire-instructions email, got {}", top.source_id);
    assert_eq!(top.source_type.as_deref(), Some("email"));
    // Email has no page number (it's not paginated) — the citation resolves by id.
    assert_eq!(top.page_number, None);
    assert!(top.text.to_lowercase().contains("routing"));
    assert_eq!(top.id, mr::chunk_id(&top.source_id, top.paragraph_index));
}

#[tokio::test]
async fn p1_mixed_corpus_both_documents_and_emails_are_retrievable() {
    let f = fixture().await;
    // Confirm the corpus genuinely mixes types and BOTH are reachable by NL query.
    let doc_hits = mr::retrieve(&f.table, &f.model, "indemnification cap and escrow holdback", 3, None)
        .await
        .unwrap();
    assert_eq!(doc_hits[0].source_type.as_deref(), Some("document"));
    assert_eq!(doc_hits[0].source_id, "doc:acme-diligence");

    let mail_hits = mr::retrieve(&f.table, &f.model, "board approval signing call schedule", 3, None)
        .await
        .unwrap();
    assert_eq!(mail_hits[0].source_type.as_deref(), Some("email"));
    assert_eq!(mail_hits[0].source_id, "mail:acme-0002");
}

// ===========================================================================
// Property 2 — Matter isolation (enforced at the vector-store query level).
// A query scoped to Matter A returns ONLY Matter-A sources; Matter-B content
// is never returned, and it cannot be bypassed by similarity alone.
// ===========================================================================

#[tokio::test]
async fn p2_scoped_query_returns_only_in_scope_matter() {
    let f = fixture().await;
    // Generic legal query that matches content in BOTH matters; scope to Acme.
    let hits = mr::retrieve(&f.table, &f.model, "deposit and security at closing", 8, Some(MATTER_ACME))
        .await
        .expect("retrieve");
    assert!(!hits.is_empty(), "scoped query should still return Acme hits");
    for h in &hits {
        assert_eq!(h.matter_id, MATTER_ACME, "leaked a non-Acme source: {} ({})", h.source_id, h.matter_id);
    }
}

#[tokio::test]
async fn p2_adversarial_confusable_term_does_not_leak_across_matters() {
    let f = fixture().await;
    // THE ADVERSARIAL CASE. "closing date" appears in near-identical phrasing in
    // BOTH doc:acme-spa (March 14) and doc:globex-lease (September 2). A pure
    // similarity search ranks both highly. Scoped to Acme, Globex must NEVER appear.
    let query = "what is the closing date";

    // First, prove the confusable really IS confusable: unscoped, Globex's
    // closing surfaces among the top results.
    let unscoped = mr::retrieve(&f.table, &f.model, query, 8, None).await.unwrap();
    let globex_unscoped = unscoped.iter().any(|h| h.source_id == "doc:globex-lease");
    assert!(
        globex_unscoped,
        "precondition: unscoped search should surface the Globex closing (confusable); top sources: {:?}",
        unscoped.iter().map(|h| &h.source_id).collect::<Vec<_>>()
    );

    // Now scope to Acme. Globex's closing date must NOT appear, and the Acme
    // closing (March 14) must.
    let scoped = mr::retrieve(&f.table, &f.model, query, 8, Some(MATTER_ACME)).await.unwrap();
    assert!(!scoped.is_empty());
    for h in &scoped {
        assert_eq!(h.matter_id, MATTER_ACME, "LEAK: scoped-to-Acme returned {} from {}", h.source_id, h.matter_id);
        assert_ne!(h.source_id, "doc:globex-lease", "LEAK: Globex closing date surfaced under Acme scope");
    }
    let acme_closing = scoped.iter().find(|h| h.source_id == "doc:acme-spa").expect("Acme closing should be present");
    assert!(acme_closing.text.contains("March 14, 2026"), "Acme scope must return Acme's date");

    // Symmetric check: scope to Globex -> only Globex, with the September date.
    let scoped_g = mr::retrieve(&f.table, &f.model, query, 8, Some(MATTER_GLOBEX)).await.unwrap();
    for h in &scoped_g {
        assert_eq!(h.matter_id, MATTER_GLOBEX, "LEAK: scoped-to-Globex returned {} from {}", h.source_id, h.matter_id);
        assert_ne!(h.source_id, "doc:acme-spa");
    }
    assert!(scoped_g.iter().any(|h| h.source_id == "doc:globex-lease"));
}

#[tokio::test]
async fn p2_isolation_holds_with_large_top_k_covering_whole_corpus() {
    let f = fixture().await;
    // Even asking for far more rows than the matter contains, the filter must
    // never spill into the other matter (prefilter shrinks the candidate set;
    // it does not pad from out-of-scope rows).
    let hits = mr::retrieve(&f.table, &f.model, "the", 100, Some(MATTER_GLOBEX)).await.unwrap();
    assert!(!hits.is_empty());
    let n_globex = hits.iter().filter(|h| h.matter_id == MATTER_GLOBEX).count();
    assert_eq!(n_globex, hits.len(), "every returned row must be in scope even with huge top_k");
    // And it should have returned roughly the whole Globex side (>= its 4 sources),
    // proving the prefilter returns ALL in-scope matches, not a truncated subset.
    let distinct_globex_sources: std::collections::HashSet<_> =
        hits.iter().map(|h| h.source_id.as_str()).collect();
    assert!(
        distinct_globex_sources.len() >= 4,
        "expected all 4 Globex sources, got {:?}",
        distinct_globex_sources
    );
}

// ===========================================================================
// Property 3 — Citation verification.
// Given a citation an answer relies on, verify the cited chunk exists and its
// text matches what was cited, so the app can refuse an answer whose citation
// does not verify.
// ===========================================================================

#[tokio::test]
async fn p3_valid_citation_verifies() {
    let f = fixture().await;
    // Retrieve a real chunk, then build a citation from it as the answer would.
    let hits = mr::retrieve(&f.table, &f.model, "purchase price share purchase agreement", 3, Some(MATTER_ACME))
        .await
        .unwrap();
    let h = &hits[0];
    let citation = Citation {
        id: h.id.clone(),
        matter_id: h.matter_id.clone(),
        source_id: h.source_id.clone(),
        paragraph_index: h.paragraph_index,
        page_number: h.page_number,
        // Quote an exact substring of the retrieved chunk.
        quoted_text: "Four Million Two Hundred Thousand Dollars".to_string(),
    };
    let result = mr::verify_citation(&f.table, &citation).await.unwrap();
    assert_eq!(result, VerifyResult::Verified, "a faithful citation must verify");
}

#[tokio::test]
async fn p3_fabricated_chunk_id_is_not_found() {
    let f = fixture().await;
    let citation = Citation {
        id: "0000000000000000000000000000000000000000000000000000000000000000".to_string(),
        matter_id: MATTER_ACME.to_string(),
        source_id: "doc:acme-spa".to_string(),
        paragraph_index: 999,
        page_number: Some(7),
        quoted_text: "anything".to_string(),
    };
    let result = mr::verify_citation(&f.table, &citation).await.unwrap();
    assert_eq!(result, VerifyResult::NotFound, "a fabricated chunk id must fail verification");
}

#[tokio::test]
async fn p3_misquoted_text_fails_verification() {
    let f = fixture().await;
    // Real chunk id, but the answer claims it says something it does not.
    let hits = mr::retrieve(&f.table, &f.model, "purchase price", 3, Some(MATTER_ACME)).await.unwrap();
    let h = &hits[0];
    let citation = Citation {
        id: h.id.clone(),
        matter_id: h.matter_id.clone(),
        source_id: h.source_id.clone(),
        paragraph_index: h.paragraph_index,
        page_number: h.page_number,
        quoted_text: "the purchase price shall be ten billion dollars".to_string(),
    };
    let result = mr::verify_citation(&f.table, &citation).await.unwrap();
    assert_eq!(result, VerifyResult::TextMismatch, "a misquoted citation must fail as TextMismatch");
}

#[tokio::test]
async fn p3_citation_against_wrong_matter_is_rejected() {
    let f = fixture().await;
    // Take a real Globex chunk but claim in the citation that it's an Acme chunk.
    // Verification must refuse it (a cross-matter citation is a confidentiality
    // lie even if the text would otherwise match).
    let hits = mr::retrieve(&f.table, &f.model, "sublease assignment closing", 3, Some(MATTER_GLOBEX)).await.unwrap();
    let g = hits.iter().find(|h| h.source_id == "doc:globex-lease").expect("globex lease chunk");
    let lying_citation = Citation {
        id: g.id.clone(),
        matter_id: MATTER_ACME.to_string(), // <-- the lie
        source_id: g.source_id.clone(),
        paragraph_index: g.paragraph_index,
        page_number: g.page_number,
        quoted_text: "September 2, 2026".to_string(),
    };
    let result = mr::verify_citation(&f.table, &lying_citation).await.unwrap();
    assert_eq!(
        result,
        VerifyResult::MatterMismatch { actual_matter: MATTER_GLOBEX.to_string() },
        "a citation claiming the wrong matter must be rejected as MatterMismatch"
    );
}
