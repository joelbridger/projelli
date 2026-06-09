//! WS-B/C GATE (production): matter-scoped, verified-citation retrieval, run
//! against the SAME LanceDB + fastembed e5-small stack the app ships — promoting
//! the proven spike (`spikes/matter-retrieval/`) into the production `rag` store.
//!
//! These are integration tests over the real engine: they build an on-disk
//! LanceDB `chunks` table in a tempdir via the production store functions
//! (`build_batch` / `build_batch_mail` with the new `matter_id` column), embed a
//! mixed (documents + email) two-matter corpus with a deliberately CONFUSABLE
//! cross-matter "closing date" pair, and assert the three gate properties:
//!
//!   Property 1 — exact-source cited retrieval over a MIXED corpus.
//!   Property 2 — matter ISOLATION (prefilter), incl. the adversarial confusable
//!                term and large-top_k; plus scope-is-required at the type level.
//!   Property 3 — citation VERIFICATION: Verified / NotFound / MatterMismatch /
//!                TextMismatch, plus the prefilter-not-postfilter regression.
//!
//! NOTE: the first run downloads the e5-small ONNX model (~120MB) into the
//! fastembed cache; subsequent runs are offline. Model load + index build happen
//! ONCE per binary via a shared OnceCell.

use keepance_lib::commands::rag::chunker::Chunk;
use keepance_lib::commands::rag::store::{
    self, lookup_by_id, nearest, SourceType, UNASSIGNED_MATTER,
};
use keepance_lib::commands::rag::{RetrievalScope, Verdict};
use std::sync::Arc;
use tokio::sync::OnceCell;

const MATTER_ACME: &str = "matter-acme";
const MATTER_GLOBEX: &str = "matter-globex";
/// Fixed key for the one encrypted (mail) row, so the test never touches the
/// OS keychain. The store layer treats mail text as ciphertext regardless.
const MAIL_KEY: [u8; 32] = [0x5Au8; 32];

/// One source in the test corpus before chunking.
struct Source {
    matter_id: &'static str,
    /// In production `source_id` == `path` (the Chunk.path). For docs this is a
    /// file path; for mail it is "mail:<id>".
    source_id: &'static str,
    source_type: &'static str, // "document" | "mail"
    text: &'static str,
}

/// Two matters, each a couple of documents + one email. The acme-spa /
/// globex-lease pair is the adversarial confusable: near-identical "closing
/// date" legal phrasing, different matter + date + deal type.
fn corpus() -> Vec<Source> {
    vec![
        Source {
            matter_id: MATTER_ACME,
            source_id: "/acme/acme-spa.md",
            source_type: "document",
            text: "ARTICLE 2. CLOSING.\n\n\
                2.1 Closing Date. The closing date of the transactions contemplated by \
                this Share Purchase Agreement shall be March 14, 2026, or such other date \
                as the parties may mutually agree in writing.\n\n\
                2.2 Purchase Price. The aggregate purchase price for the Shares shall be \
                Four Million Two Hundred Thousand Dollars ($4,200,000), payable by wire \
                transfer of immediately available funds at the closing.",
        },
        Source {
            matter_id: MATTER_ACME,
            source_id: "/acme/acme-diligence.md",
            source_type: "document",
            text: "DUE DILIGENCE MEMORANDUM — Project Falcon (Acme Corp).\n\n\
                The indemnification cap is limited to fifteen percent (15%) of the \
                purchase price, with a separate escrow holdback of $630,000 held for \
                eighteen months to satisfy any indemnity claims.",
        },
        Source {
            matter_id: MATTER_ACME,
            source_id: "mail:acme-0001",
            source_type: "mail",
            text: "From: cfo@acmecorp.example\nSubject: Wire instructions for the March 14 closing\n\n\
                Confirming the wire instructions for closing. Please send the $4.2M to our \
                escrow account at First National (routing 021000021, account ending 4477) \
                no later than the morning of March 14.",
        },
        Source {
            matter_id: MATTER_GLOBEX,
            source_id: "/globex/globex-lease.md",
            source_type: "document",
            text: "ARTICLE 9. ASSIGNMENT AND SUBLEASE.\n\n\
                9.3 Closing Date. The closing date of the sublease assignment contemplated \
                by this Commercial Lease shall be September 2, 2026, or such other date as \
                the parties may mutually agree in writing.\n\n\
                9.4 Security Deposit. The assignee shall deposit two months' rent ($48,000) \
                with the landlord at the closing as security for performance.",
        },
        Source {
            matter_id: MATTER_GLOBEX,
            source_id: "/globex/globex-demand.md",
            source_type: "document",
            text: "DEMAND LETTER — Globex Industries v. Landlord.\n\n\
                Our client Globex Industries demands cure of the landlord's material breach \
                of the lease, specifically the systematic overcharging of common area \
                maintenance (CAM) costs totaling $112,400 over three years.",
        },
        Source {
            matter_id: MATTER_GLOBEX,
            source_id: "mail:globex-0001",
            source_type: "mail",
            text: "From: gc@globex.example\nSubject: September closing logistics and keys\n\n\
                For the sublease closing in September, can your office coordinate the keys \
                handover and the final walkthrough? I will have the $48,000 security deposit \
                ready to wire at closing.",
        },
    ]
}

struct Fixture {
    table: lancedb::Table,
    _dir: tempfile::TempDir,
}

static FIXTURE: OnceCell<Arc<Fixture>> = OnceCell::const_new();

/// Build the production `chunks` table once: chunk → embed (e5-small) → write
/// each source's chunks with its matter_id. Documents go through `build_batch`
/// (plaintext); the email sources go through `build_batch_mail` (encrypted text
/// column) — both stamp `matter_id` + `source_id`.
async fn fixture() -> Arc<Fixture> {
    FIXTURE
        .get_or_init(|| async {
            let dir = tempfile::tempdir().expect("tempdir");
            let conn = store::open_connection(dir.path())
                .await
                .expect("open connection");
            let table = store::open_or_create_table(&conn)
                .await
                .expect("create table");

            for src in corpus() {
                let chunks = keepance_lib::commands::rag::chunker::chunk_text(src.source_id, src.text);
                let texts: Vec<String> = chunks.iter().map(|c| c.text.clone()).collect();
                let vectors = keepance_lib::commands::rag::embedder::embed_documents(&texts)
                    .await
                    .expect("embed documents");
                let rows: Vec<(Chunk, Vec<f32>)> = chunks.into_iter().zip(vectors).collect();

                let batch = if src.source_type == "mail" {
                    store::build_batch_mail(&rows, &MAIL_KEY, src.matter_id).expect("build mail batch")
                } else {
                    store::build_batch(&rows, SourceType::Text, src.matter_id).expect("build batch")
                };
                let schema = batch.schema();
                use arrow_array::RecordBatchIterator;
                table
                    .add(Box::new(RecordBatchIterator::new(vec![Ok(batch)], schema)))
                    .execute()
                    .await
                    .expect("add batch");
            }

            Arc::new(Fixture { table, _dir: dir })
        })
        .await
        .clone()
}

async fn embed(query: &str) -> Vec<f32> {
    keepance_lib::commands::rag::embedder::embed_query(query)
        .await
        .expect("embed query")
}

// ===========================================================================
// Property 1 — exact-source cited retrieval over a MIXED corpus.
// ===========================================================================

#[tokio::test]
async fn p1_document_query_returns_exact_source_with_citation() {
    let f = fixture().await;
    let q = embed("what is the purchase price in the share purchase agreement").await;
    // Unscoped here just to confirm recall of the right document; isolation is P2.
    let hits = nearest(&f.table, &q, 5, None).await.expect("retrieve");
    assert!(!hits.is_empty(), "expected at least one hit");
    let top = &hits[0];
    assert_eq!(top.source_id.as_deref(), Some("/acme/acme-spa.md"));
    assert_eq!(top.matter_id.as_deref(), Some(MATTER_ACME));
    assert!(top.text.contains("4,200,000"), "retrieved chunk must contain the cited fact");
    // The citation key is content-addressed and reproducible from (path, para).
    assert_eq!(top.id, store::chunk_id("/acme/acme-spa.md", top.paragraph_index));
}

#[tokio::test]
async fn p1_email_source_is_retrievable_and_carries_matter_scope() {
    let f = fixture().await;
    // Wire/routing content lives only in an email; confirm mail chunks are
    // reachable and carry matter_id + a "mail:" source_id.
    let q = embed("where do we send the wire and what is the routing number").await;
    let hits = nearest(&f.table, &q, 5, None).await.expect("retrieve");
    let top = hits.iter().find(|h| h.source_type.as_deref() == Some("mail"))
        .expect("a mail hit should surface for a wire-instructions query");
    assert_eq!(top.source_id.as_deref(), Some("mail:acme-0001"));
    assert_eq!(top.matter_id.as_deref(), Some(MATTER_ACME));
    // Mail text is stored encrypted — the store returns ciphertext (the Tauri
    // command decrypts in memory; the store layer does not).
    assert!(top.encrypted, "mail chunk must be marked encrypted at the store layer");
}

// ===========================================================================
// Property 2 — matter ISOLATION at the vector-store query level.
// ===========================================================================

#[tokio::test]
async fn p2_scoped_query_returns_only_in_scope_matter() {
    let f = fixture().await;
    let q = embed("deposit and security at closing").await;
    let hits = nearest(&f.table, &q, 8, Some(MATTER_ACME)).await.expect("retrieve");
    assert!(!hits.is_empty(), "scoped query should still return Acme hits");
    for h in &hits {
        assert_eq!(
            h.matter_id.as_deref(),
            Some(MATTER_ACME),
            "LEAK: scoped-to-Acme returned {:?} from {:?}",
            h.source_id,
            h.matter_id
        );
    }
}

#[tokio::test]
async fn p2_adversarial_confusable_term_does_not_leak_across_matters() {
    let f = fixture().await;
    // THE ADVERSARIAL CASE: "closing date" appears in near-identical phrasing in
    // BOTH acme-spa (March 14) and globex-lease (September 2). Pure similarity
    // ranks both highly; scoping must exclude the other matter entirely.
    let q = embed("what is the closing date").await;

    // Precondition: unscoped, the Globex closing IS among the top results
    // (proving the pair is genuinely confusable, not a tautology).
    let unscoped = nearest(&f.table, &q, 8, None).await.unwrap();
    let globex_unscoped = unscoped
        .iter()
        .any(|h| h.source_id.as_deref() == Some("/globex/globex-lease.md"));
    assert!(
        globex_unscoped,
        "precondition: unscoped search should surface the Globex closing; got {:?}",
        unscoped.iter().map(|h| h.source_id.clone()).collect::<Vec<_>>()
    );

    // Scoped to Acme: Globex must NEVER appear; Acme's March date must.
    let scoped = nearest(&f.table, &q, 8, Some(MATTER_ACME)).await.unwrap();
    assert!(!scoped.is_empty());
    for h in &scoped {
        assert_eq!(h.matter_id.as_deref(), Some(MATTER_ACME), "LEAK: {:?}", h.source_id);
        assert_ne!(
            h.source_id.as_deref(),
            Some("/globex/globex-lease.md"),
            "LEAK: Globex closing surfaced under Acme scope"
        );
    }
    let acme = scoped
        .iter()
        .find(|h| h.source_id.as_deref() == Some("/acme/acme-spa.md"))
        .expect("Acme closing should be present under Acme scope");
    assert!(acme.text.contains("March 14, 2026"));

    // Symmetric: scope to Globex → only Globex, September date.
    let scoped_g = nearest(&f.table, &q, 8, Some(MATTER_GLOBEX)).await.unwrap();
    for h in &scoped_g {
        assert_eq!(h.matter_id.as_deref(), Some(MATTER_GLOBEX), "LEAK: {:?}", h.source_id);
        assert_ne!(h.source_id.as_deref(), Some("/acme/acme-spa.md"));
    }
    assert!(scoped_g
        .iter()
        .any(|h| h.source_id.as_deref() == Some("/globex/globex-lease.md")));
}

#[tokio::test]
async fn p2_isolation_holds_with_large_top_k_covering_whole_corpus() {
    let f = fixture().await;
    // Asking for far more rows than the matter contains must never spill into the
    // other matter (the prefilter shrinks the candidate set; it does not pad from
    // out-of-scope rows to reach the limit).
    let q = embed("the").await;
    let hits = nearest(&f.table, &q, 100, Some(MATTER_GLOBEX)).await.unwrap();
    assert!(!hits.is_empty());
    let in_scope = hits.iter().filter(|h| h.matter_id.as_deref() == Some(MATTER_GLOBEX)).count();
    assert_eq!(in_scope, hits.len(), "every returned row must be in scope even with huge top_k");
    // Should have returned all 3 Globex sources, proving prefilter returns ALL
    // in-scope matches, not a truncated/padded subset.
    let distinct: std::collections::HashSet<_> =
        hits.iter().filter_map(|h| h.source_id.clone()).collect();
    assert!(distinct.len() >= 3, "expected all Globex sources, got {:?}", distinct);
}

#[tokio::test]
async fn p2_scope_is_required_at_the_type_level() {
    // Regression guard for "no accidental global search": the wire scope type
    // has no default — an empty/unnamed object cannot decode to a silent
    // all-matters search. A caller MUST name Matter or AllMatters.
    assert!(serde_json::from_str::<RetrievalScope>("{}").is_err());
    let m: RetrievalScope = serde_json::from_str(r#"{"kind":"matter","matterId":"matter-acme"}"#).unwrap();
    assert_eq!(m, RetrievalScope::Matter { matter_id: MATTER_ACME.into() });
    let a: RetrievalScope = serde_json::from_str(r#"{"kind":"allMatters"}"#).unwrap();
    assert_eq!(a, RetrievalScope::AllMatters);
}

// ===========================================================================
// Property 3 — citation VERIFICATION (the four verdicts) + prefilter regression.
// ===========================================================================

/// Mirror of the command's verdict logic at the store layer (the command also
/// decrypts mail + validates input; here we exercise the scoped point-lookup
/// against plaintext document chunks so the test never needs the keychain).
async fn verify(table: &lancedb::Table, id: &str, claimed: &str, quoted: &str) -> Verdict {
    let normalize = |s: &str| s.split_whitespace().collect::<Vec<_>>().join(" ");
    match lookup_by_id(table, id, Some(claimed)).await.unwrap() {
        Some(rec) => {
            if normalize(&rec.text).contains(&normalize(quoted)) && !normalize(quoted).is_empty() {
                Verdict::Verified
            } else {
                Verdict::TextMismatch
            }
        }
        None => match lookup_by_id(table, id, None).await.unwrap() {
            Some(other) => Verdict::MatterMismatch { actual_matter: other.matter_id },
            None => Verdict::NotFound,
        },
    }
}

#[tokio::test]
async fn p3_valid_citation_verifies() {
    let f = fixture().await;
    let q = embed("purchase price share purchase agreement").await;
    let hits = nearest(&f.table, &q, 3, Some(MATTER_ACME)).await.unwrap();
    let h = &hits[0];
    let verdict = verify(
        &f.table,
        &h.id,
        h.matter_id.as_deref().unwrap(),
        "Four Million Two Hundred Thousand Dollars",
    )
    .await;
    assert_eq!(verdict, Verdict::Verified, "a faithful citation must verify");
}

#[tokio::test]
async fn p3_fabricated_chunk_id_is_not_found() {
    let f = fixture().await;
    let verdict = verify(
        &f.table,
        "0000000000000000000000000000000000000000000000000000000000000000",
        MATTER_ACME,
        "anything",
    )
    .await;
    assert_eq!(verdict, Verdict::NotFound);
}

#[tokio::test]
async fn p3_misquoted_text_fails_verification() {
    let f = fixture().await;
    let q = embed("purchase price").await;
    let hits = nearest(&f.table, &q, 3, Some(MATTER_ACME)).await.unwrap();
    let h = &hits[0];
    let verdict = verify(
        &f.table,
        &h.id,
        h.matter_id.as_deref().unwrap(),
        "the purchase price shall be ten billion dollars",
    )
    .await;
    assert_eq!(verdict, Verdict::TextMismatch);
}

#[tokio::test]
async fn p3_citation_against_wrong_matter_is_rejected() {
    let f = fixture().await;
    // A real Globex chunk, but the citation claims it is an Acme chunk. Even if
    // the quote would match, the cross-matter claim must be rejected.
    let q = embed("sublease assignment closing security deposit").await;
    let hits = nearest(&f.table, &q, 5, Some(MATTER_GLOBEX)).await.unwrap();
    let g = hits
        .iter()
        .find(|h| h.source_id.as_deref() == Some("/globex/globex-lease.md"))
        .expect("globex lease chunk");
    let verdict = verify(&f.table, &g.id, MATTER_ACME /* the lie */, "September 2, 2026").await;
    assert_eq!(
        verdict,
        Verdict::MatterMismatch { actual_matter: MATTER_GLOBEX.to_string() },
        "a citation claiming the wrong matter must be MatterMismatch"
    );
}

#[tokio::test]
async fn p3_scoped_lookup_is_prefiltered_not_postfiltered() {
    let f = fixture().await;
    // PREFILTER-NOT-POSTFILTER regression at the lookup layer: a chunk that
    // exists under Globex must be INVISIBLE to a lookup scoped to Acme — i.e. the
    // matter predicate is part of the query, not applied after fetching the row
    // and comparing. (lookup_by_id with the wrong scope returns None; with the
    // right scope returns the row.)
    let q = embed("sublease assignment closing").await;
    let hits = nearest(&f.table, &q, 5, Some(MATTER_GLOBEX)).await.unwrap();
    let g = hits
        .iter()
        .find(|h| h.source_id.as_deref() == Some("/globex/globex-lease.md"))
        .expect("globex lease chunk");

    let wrong_scope = lookup_by_id(&f.table, &g.id, Some(MATTER_ACME)).await.unwrap();
    assert!(wrong_scope.is_none(), "scoped lookup must not return an out-of-scope row");
    let right_scope = lookup_by_id(&f.table, &g.id, Some(MATTER_GLOBEX)).await.unwrap();
    assert!(right_scope.is_some(), "scoped lookup must return the in-scope row");
}

// ===========================================================================
// Standing regression: a scoped nearest() query is built with a PREFILTER.
// LanceDB defaults prefilter=true and we never call .postfilter(); this proves
// the scope predicate is applied BEFORE the vector search (the isolation
// guarantee) rather than as a post-hoc filter that could drop in-scope hits.
// ===========================================================================

#[tokio::test]
async fn scoped_query_uses_prefilter_excludes_out_of_scope_from_candidate_set() {
    let f = fixture().await;
    // Construct a query vector pointed at Globex's closing content, then scope to
    // Acme with a tiny top_k=1. If scoping were a POSTFILTER (search first, then
    // drop out-of-scope rows), the single best candidate would be the Globex
    // chunk and it would be filtered out → ZERO results. With a PREFILTER, the
    // candidate set is Acme-only from the start, so we still get an Acme hit.
    let q = embed("closing date of the sublease assignment September 2 2026").await;

    // Sanity: unscoped top-1 really is the Globex lease (so postfilter top_k=1
    // would yield nothing under Acme scope).
    let unscoped_top = nearest(&f.table, &q, 1, None).await.unwrap();
    assert_eq!(
        unscoped_top[0].source_id.as_deref(),
        Some("/globex/globex-lease.md"),
        "precondition: the single best match is the Globex chunk"
    );

    let scoped = nearest(&f.table, &q, 1, Some(MATTER_ACME)).await.unwrap();
    assert_eq!(
        scoped.len(),
        1,
        "prefilter must return a full in-scope result at top_k=1 (postfilter would return 0)"
    );
    assert_eq!(scoped[0].matter_id.as_deref(), Some(MATTER_ACME));
}

// ===========================================================================
// Migration: version-aware one-time re-index marker.
// ===========================================================================

#[tokio::test]
async fn migration_marker_round_trips_and_gates_reindex() {
    let dir = tempfile::tempdir().unwrap();
    // Fresh workspace, no table → nothing to migrate.
    let conn = store::open_connection(dir.path()).await.unwrap();
    assert!(!store::needs_migration(&conn, dir.path()).await.unwrap());
    assert_eq!(store::read_index_version(dir.path()), 0);

    // Simulate a pre-3.0 table existing (create the table, leave version at 0).
    let _table = store::open_or_create_table(&conn).await.unwrap();
    assert!(
        store::needs_migration(&conn, dir.path()).await.unwrap(),
        "a table with no version marker must require migration"
    );

    // After stamping the current version, migration is satisfied.
    store::write_index_version(dir.path()).unwrap();
    assert_eq!(store::read_index_version(dir.path()), store::INDEX_VERSION);
    assert!(!store::needs_migration(&conn, dir.path()).await.unwrap());
}

#[tokio::test]
async fn unassigned_sentinel_is_scopeable() {
    // Content indexed under the UNASSIGNED sentinel must be findable when scoped
    // to "unassigned" and excluded from a real matter's scope — proving the
    // sentinel behaves like any other matter (never a wildcard).
    let dir = tempfile::tempdir().unwrap();
    let conn = store::open_connection(dir.path()).await.unwrap();
    let table = store::open_or_create_table(&conn).await.unwrap();
    let text = "An uncategorized note about a quarterly tax filing deadline.";
    let chunks = keepance_lib::commands::rag::chunker::chunk_text("/inbox/note.md", text);
    let texts: Vec<String> = chunks.iter().map(|c| c.text.clone()).collect();
    let vectors = keepance_lib::commands::rag::embedder::embed_documents(&texts).await.unwrap();
    let rows: Vec<(Chunk, Vec<f32>)> = chunks.into_iter().zip(vectors).collect();
    let batch = store::build_batch(&rows, SourceType::Text, UNASSIGNED_MATTER).unwrap();
    let schema = batch.schema();
    use arrow_array::RecordBatchIterator;
    table.add(Box::new(RecordBatchIterator::new(vec![Ok(batch)], schema))).execute().await.unwrap();

    let q = embed("tax filing deadline").await;
    let found = nearest(&table, &q, 5, Some(UNASSIGNED_MATTER)).await.unwrap();
    assert!(found.iter().any(|h| h.source_id.as_deref() == Some("/inbox/note.md")));
    let other = nearest(&table, &q, 5, Some("matter-acme")).await.unwrap();
    assert!(other.is_empty(), "unassigned content must not leak into a real matter scope");
}
