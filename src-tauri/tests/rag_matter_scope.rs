//! WS-B/C GATE (production): matter-scoped, verified-citation retrieval, run
//! against the SAME LanceDB + fastembed e5-small stack the app ships — promoting
//! the proven spike (`spikes/matter-retrieval/`) into the production `rag` store.
//!
//! These are integration tests over the real engine: they build an on-disk
//! LanceDB `chunks` table in a tempdir via the production store functions
//! (`build_batch` / `build_batch_mail` with the `matter_id` column), embed a
//! mixed (documents + email) two-matter corpus with a deliberately CONFUSABLE
//! cross-matter "closing date" pair, and assert the gate properties below.
//!
//! WS-VEC: the `text` column is encrypted at rest for EVERY source type (the
//! store returns the raw hex-encoded ciphertext; the Tauri command decrypts in
//! memory — these tests mirror that by decrypting via `decrypt_hit` before any
//! content assertion). So a sensitive chunk string never appears in the on-disk
//! LanceDB files (see `vec_chunk_text_is_encrypted_on_disk`).
//!
//!   Property 1 — exact-source cited retrieval over a MIXED corpus.
//!   Property 2 — matter ISOLATION (prefilter), incl. the adversarial confusable
//!                term and large-top_k; plus scope-is-required at the type level.
//!   Property 3 — citation VERIFICATION: Verified / NotFound / MatterMismatch /
//!                TextMismatch, plus the prefilter-not-postfilter regression.
//!   Property 4 (WS-PRIV) — PRIVILEGE exclusion: privileged (attorney-client /
//!                work-product) content is EXCLUDED from retrieval by default,
//!                composes with the matter scope as a single prefilter, returns
//!                only on an explicit include_privileged opt-in, and re-tagging a
//!                source flips its exclusion in place. Includes the adversarial
//!                case (a privileged doc that is the top hit is NOT returned).
//!
//! NOTE: under the Option B gate the embedder NEVER downloads implicitly, so
//! the e5-small model must be pre-provisioned before running this binary:
//! either run the app once so `model_ensure` downloads it, or populate
//! `dirs::data_dir()/keepance/models/e5-small` (the `writable_cache_dir()`
//! layout) by hand. With the files absent, `embed_documents`/`embed_query`
//! fail fast with the `model-not-ready` marker and these tests error out.
//! Model load + index build happen ONCE per binary via a shared OnceCell.

use keepance_lib::commands::rag::chunker::Chunk;
use keepance_lib::commands::rag::store::{
    self, lookup_by_id, nearest, SourceType, PRIVILEGE_ATTORNEY_CLIENT, PRIVILEGE_NONE,
    PRIVILEGE_WORK_PRODUCT, UNASSIGNED_MATTER,
};
use keepance_lib::commands::rag::{RetrievalScope, Verdict};
use std::sync::Arc;
use tokio::sync::OnceCell;

const MATTER_ACME: &str = "matter-acme";
const MATTER_GLOBEX: &str = "matter-globex";
/// Fixed vector-store key for ALL rows (documents + mail), so the tests never
/// touch the OS keychain. WS-VEC: every chunk's `text` column is AES-256-GCM
/// ciphertext under this key; the store returns it raw, callers decrypt.
const VEC_KEY: [u8; 32] = [0x5Au8; 32];

/// Decrypt a `StoredHit`'s `text` (hex-encoded AES-256-GCM ciphertext) back to
/// plaintext, mirroring what the `rag_retrieve` command does on read. Every
/// content assertion in these tests goes through this — the store layer itself
/// returns ciphertext (it never persists or returns plaintext at rest).
fn decrypt_hit(h: &store::StoredHit) -> String {
    use keepance_lib::commands::mail::crypto::decrypt_with_key;
    let blob = hex::decode(&h.text).expect("hit text must be hex ciphertext (WS-VEC)");
    String::from_utf8(decrypt_with_key(&blob, &VEC_KEY).expect("decrypt hit text"))
        .expect("utf8 plaintext")
}

/// One source in the test corpus before chunking.
struct Source {
    matter_id: &'static str,
    /// In production `source_id` == `path` (the Chunk.path). For docs this is a
    /// file path; for mail it is "mail:<id>".
    source_id: &'static str,
    source_type: &'static str, // "document" | "mail"
    /// WS-PRIV: privilege status for this source.
    privilege: &'static str,
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
            privilege: PRIVILEGE_NONE,
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
            privilege: PRIVILEGE_NONE,
            text: "DUE DILIGENCE MEMORANDUM — Project Falcon (Acme Corp).\n\n\
                The indemnification cap is limited to fifteen percent (15%) of the \
                purchase price, with a separate escrow holdback of $630,000 held for \
                eighteen months to satisfy any indemnity claims.",
        },
        Source {
            matter_id: MATTER_ACME,
            source_id: "mail:acme-0001",
            source_type: "mail",
            privilege: PRIVILEGE_NONE,
            text: "From: cfo@acmecorp.example\nSubject: Wire instructions for the March 14 closing\n\n\
                Confirming the wire instructions for closing. Please send the $4.2M to our \
                escrow account at First National (routing 021000021, account ending 4477) \
                no later than the morning of March 14.",
        },
        // WS-PRIV — THE ADVERSARIAL PRIVILEGED DOC. An attorney-client privileged
        // strategy memo about the SAME Acme closing/purchase price. For a privilege-
        // laden query ("our litigation strategy and risk on the purchase price") this
        // is the single most semantically-relevant Acme row — yet default retrieval
        // (privilege-excluded) must NEVER return it, even scoped to Acme.
        Source {
            matter_id: MATTER_ACME,
            source_id: "/acme/acme-strategy-memo.md",
            source_type: "document",
            privilege: PRIVILEGE_ATTORNEY_CLIENT,
            text: "PRIVILEGED & CONFIDENTIAL — ATTORNEY-CLIENT COMMUNICATION.\n\n\
                Litigation strategy memo re: the Acme share purchase. Our candid assessment \
                of legal risk on the $4,200,000 purchase price and our negotiating posture, \
                including the weaknesses in our indemnification position and the settlement \
                range we would privately accept if the closing dispute escalates.",
        },
        // WS-PRIV — a work-product privileged doc in Globex.
        Source {
            matter_id: MATTER_GLOBEX,
            source_id: "/globex/globex-workproduct.md",
            source_type: "document",
            privilege: PRIVILEGE_WORK_PRODUCT,
            text: "ATTORNEY WORK PRODUCT — prepared in anticipation of litigation.\n\n\
                Internal analysis of the Globex sublease assignment dispute and the \
                security deposit. Our mental impressions of the landlord's likely defenses \
                and the litigation theory we intend to pursue on the CAM overcharges.",
        },
        Source {
            matter_id: MATTER_GLOBEX,
            source_id: "/globex/globex-lease.md",
            source_type: "document",
            privilege: PRIVILEGE_NONE,
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
            privilege: PRIVILEGE_NONE,
            text: "DEMAND LETTER — Globex Industries v. Landlord.\n\n\
                Our client Globex Industries demands cure of the landlord's material breach \
                of the lease, specifically the systematic overcharging of common area \
                maintenance (CAM) costs totaling $112,400 over three years.",
        },
        Source {
            matter_id: MATTER_GLOBEX,
            source_id: "mail:globex-0001",
            source_type: "mail",
            privilege: PRIVILEGE_NONE,
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
/// each source's chunks with its matter_id. WS-VEC: documents go through
/// `build_batch` and email through `build_batch_mail`; BOTH encrypt the text
/// column under `VEC_KEY` and stamp `matter_id` + `source_id`.
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
                    store::build_batch_mail(&rows, &VEC_KEY, src.matter_id, src.privilege)
                        .expect("build mail batch")
                } else {
                    store::build_batch(&rows, SourceType::Text, src.matter_id, src.privilege, &VEC_KEY)
                        .expect("build batch")
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
    let hits = nearest(&f.table, &q, 5, None, false).await.expect("retrieve");
    assert!(!hits.is_empty(), "expected at least one hit");
    let top = &hits[0];
    assert_eq!(top.source_id.as_deref(), Some("/acme/acme-spa.md"));
    assert_eq!(top.matter_id.as_deref(), Some(MATTER_ACME));
    // WS-VEC: the store returns ciphertext; decrypt (as the command does) to read the fact.
    assert!(decrypt_hit(top).contains("4,200,000"), "retrieved chunk must contain the cited fact");
    // The citation key is content-addressed and reproducible from (path, para).
    assert_eq!(top.id, store::chunk_id("/acme/acme-spa.md", top.paragraph_index));
}

#[tokio::test]
async fn p1_email_source_is_retrievable_and_carries_matter_scope() {
    let f = fixture().await;
    // Wire/routing content lives only in an email; confirm mail chunks are
    // reachable and carry matter_id + a "mail:" source_id.
    let q = embed("where do we send the wire and what is the routing number").await;
    let hits = nearest(&f.table, &q, 5, None, false).await.expect("retrieve");
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
    let hits = nearest(&f.table, &q, 8, Some(MATTER_ACME), false).await.expect("retrieve");
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
    let unscoped = nearest(&f.table, &q, 8, None, false).await.unwrap();
    let globex_unscoped = unscoped
        .iter()
        .any(|h| h.source_id.as_deref() == Some("/globex/globex-lease.md"));
    assert!(
        globex_unscoped,
        "precondition: unscoped search should surface the Globex closing; got {:?}",
        unscoped.iter().map(|h| h.source_id.clone()).collect::<Vec<_>>()
    );

    // Scoped to Acme: Globex must NEVER appear; Acme's March date must.
    let scoped = nearest(&f.table, &q, 8, Some(MATTER_ACME), false).await.unwrap();
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
    assert!(decrypt_hit(acme).contains("March 14, 2026"));

    // Symmetric: scope to Globex → only Globex, September date.
    let scoped_g = nearest(&f.table, &q, 8, Some(MATTER_GLOBEX), false).await.unwrap();
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
    let hits = nearest(&f.table, &q, 100, Some(MATTER_GLOBEX), false).await.unwrap();
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
/// validates input). WS-VEC: the stored chunk text is encrypted at rest, so we
/// decrypt the looked-up record's text (exactly as `rag_verify_citation` does)
/// before the whitespace-normalized containment check, using `VEC_KEY`.
async fn verify(table: &lancedb::Table, id: &str, claimed: &str, quoted: &str) -> Verdict {
    use keepance_lib::commands::mail::crypto::decrypt_with_key;
    let normalize = |s: &str| s.split_whitespace().collect::<Vec<_>>().join(" ");
    let decrypt = |hex_text: &str| -> String {
        let blob = hex::decode(hex_text).expect("record text must be hex ciphertext (WS-VEC)");
        String::from_utf8(decrypt_with_key(&blob, &VEC_KEY).expect("decrypt record text")).expect("utf8")
    };
    match lookup_by_id(table, id, Some(claimed)).await.unwrap() {
        Some(rec) => {
            let plaintext = decrypt(&rec.text);
            if normalize(&plaintext).contains(&normalize(quoted)) && !normalize(quoted).is_empty() {
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
    let hits = nearest(&f.table, &q, 3, Some(MATTER_ACME), false).await.unwrap();
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
    let hits = nearest(&f.table, &q, 3, Some(MATTER_ACME), false).await.unwrap();
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
    let hits = nearest(&f.table, &q, 5, Some(MATTER_GLOBEX), false).await.unwrap();
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
    let hits = nearest(&f.table, &q, 5, Some(MATTER_GLOBEX), false).await.unwrap();
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
    let unscoped_top = nearest(&f.table, &q, 1, None, false).await.unwrap();
    assert_eq!(
        unscoped_top[0].source_id.as_deref(),
        Some("/globex/globex-lease.md"),
        "precondition: the single best match is the Globex chunk"
    );

    let scoped = nearest(&f.table, &q, 1, Some(MATTER_ACME), false).await.unwrap();
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
    let batch = store::build_batch(&rows, SourceType::Text, UNASSIGNED_MATTER, PRIVILEGE_NONE, &VEC_KEY).unwrap();
    let schema = batch.schema();
    use arrow_array::RecordBatchIterator;
    table.add(Box::new(RecordBatchIterator::new(vec![Ok(batch)], schema))).execute().await.unwrap();

    let q = embed("tax filing deadline").await;
    let found = nearest(&table, &q, 5, Some(UNASSIGNED_MATTER), false).await.unwrap();
    assert!(found.iter().any(|h| h.source_id.as_deref() == Some("/inbox/note.md")));
    let other = nearest(&table, &q, 5, Some("matter-acme"), false).await.unwrap();
    assert!(other.is_empty(), "unassigned content must not leak into a real matter scope");
}

// ===========================================================================
// Property 4 (WS-PRIV) — privileged content is EXCLUDED from retrieval by
// default and composes with matter scope. This is the litigation-safety core:
// a privileged document that would otherwise be the TOP hit must not surface
// unless the caller deliberately opts in with include_privileged = true.
// ===========================================================================

#[tokio::test]
async fn priv_privileged_doc_is_not_returned_by_default_even_when_top_hit() {
    let f = fixture().await;
    // ADVERSARIAL: this query targets the attorney-client privileged strategy memo
    // far more directly than any non-privileged Acme doc.
    let q = embed(
        "our candid litigation strategy, legal risk, and private settlement range on the purchase price",
    )
    .await;

    // Precondition: with privilege INCLUDED, the privileged memo IS the top hit
    // under Acme scope — proving it is genuinely the most relevant row, so its
    // absence by default is exclusion, not a recall miss.
    let included = nearest(&f.table, &q, 8, Some(MATTER_ACME), true).await.unwrap();
    assert_eq!(
        included[0].source_id.as_deref(),
        Some("/acme/acme-strategy-memo.md"),
        "precondition: the privileged memo should be the single best Acme match; got {:?}",
        included.iter().map(|h| h.source_id.clone()).collect::<Vec<_>>()
    );

    // DEFAULT (include_privileged = false), scoped to Acme: the privileged memo
    // must NEVER appear, and every returned row must be privilege = "none".
    let default_hits = nearest(&f.table, &q, 8, Some(MATTER_ACME), false).await.unwrap();
    for h in &default_hits {
        assert_ne!(
            h.source_id.as_deref(),
            Some("/acme/acme-strategy-memo.md"),
            "LEAK: privileged memo surfaced in default retrieval"
        );
        assert_eq!(
            h.privilege.as_deref(),
            Some(PRIVILEGE_NONE),
            "default retrieval must only return non-privileged rows; got {:?} for {:?}",
            h.privilege,
            h.source_id
        );
    }
}

#[tokio::test]
async fn priv_include_privileged_true_returns_privileged_content() {
    let f = fixture().await;
    let q = embed("attorney-client privileged litigation strategy memo settlement range").await;
    // Opt-in: the privileged memo is retrievable and correctly labelled.
    let hits = nearest(&f.table, &q, 8, Some(MATTER_ACME), true).await.unwrap();
    let memo = hits
        .iter()
        .find(|h| h.source_id.as_deref() == Some("/acme/acme-strategy-memo.md"))
        .expect("privileged memo must be returned when include_privileged = true");
    assert_eq!(memo.privilege.as_deref(), Some(PRIVILEGE_ATTORNEY_CLIENT));
    assert_eq!(memo.matter_id.as_deref(), Some(MATTER_ACME));
}

#[tokio::test]
async fn priv_work_product_excluded_by_default_included_on_opt_in() {
    let f = fixture().await;
    let q = embed("attorney work product mental impressions litigation theory CAM overcharges").await;

    // Default scoped to Globex: the work-product doc is excluded.
    let default_hits = nearest(&f.table, &q, 8, Some(MATTER_GLOBEX), false).await.unwrap();
    assert!(
        default_hits
            .iter()
            .all(|h| h.source_id.as_deref() != Some("/globex/globex-workproduct.md")),
        "LEAK: work-product doc surfaced in default retrieval"
    );
    assert!(
        default_hits.iter().all(|h| h.privilege.as_deref() == Some(PRIVILEGE_NONE)),
        "default retrieval must only return non-privileged rows"
    );

    // Opt-in: it is retrievable.
    let included = nearest(&f.table, &q, 8, Some(MATTER_GLOBEX), true).await.unwrap();
    assert!(
        included
            .iter()
            .any(|h| h.source_id.as_deref() == Some("/globex/globex-workproduct.md")),
        "work-product doc must be returned when include_privileged = true"
    );
}

#[tokio::test]
async fn priv_exclusion_holds_with_large_top_k() {
    let f = fixture().await;
    // Even asking for the whole corpus, default retrieval never pads with a
    // privileged row to reach the limit.
    let q = embed("the").await;
    let hits = nearest(&f.table, &q, 100, Some(MATTER_ACME), false).await.unwrap();
    assert!(!hits.is_empty());
    assert!(
        hits.iter().all(|h| h.privilege.as_deref() == Some(PRIVILEGE_NONE)),
        "huge top_k must not spill privileged rows into default retrieval"
    );
    // Sanity: the privileged memo IS in the Acme corpus (so its absence is exclusion).
    let included = nearest(&f.table, &q, 100, Some(MATTER_ACME), true).await.unwrap();
    assert!(
        included
            .iter()
            .any(|h| h.source_id.as_deref() == Some("/acme/acme-strategy-memo.md")),
        "the privileged memo must exist in the Acme corpus"
    );
}

#[tokio::test]
async fn priv_default_excludes_privileged_even_cross_matter() {
    let f = fixture().await;
    // Cross-matter (AllMatters → scope None) is still privilege-excluded by default:
    // a conflicts-style search across every matter must not surface privileged docs.
    let q = embed("privileged litigation strategy and attorney work product").await;
    let hits = nearest(&f.table, &q, 20, None, false).await.unwrap();
    assert!(
        hits.iter().all(|h| h.privilege.as_deref() == Some(PRIVILEGE_NONE)),
        "cross-matter default retrieval must still exclude privileged content; got {:?}",
        hits.iter()
            .map(|h| (h.source_id.clone(), h.privilege.clone()))
            .collect::<Vec<_>>()
    );
}

#[tokio::test]
async fn priv_composed_prefilter_is_matter_and_privilege() {
    // REGRESSION: the retrieval predicate is the composition of matter AND
    // privilege, built by build_retrieval_predicate. This is the standing guard
    // that the two boundaries are AND-ed into a single prefilter (not applied as
    // two separate post-hoc filters), mirroring the matter prefilter regression.
    let p = store::build_retrieval_predicate(Some(MATTER_ACME), false)
        .expect("predicate")
        .expect("some predicate");
    assert_eq!(p, "matter_id = 'matter-acme' AND privilege = 'none'");

    // And the prefilter is genuinely applied BEFORE the vector search: point a
    // query straight at the privileged memo, scope to Acme, top_k = 1. If the
    // privilege clause were a postfilter, the single best candidate would be the
    // privileged memo and it would be dropped → ZERO results. With a prefilter,
    // the candidate set excludes privileged rows from the start, so we still get
    // a non-privileged Acme hit.
    let f = fixture().await;
    let q = embed(
        "candid litigation strategy and private settlement range on the $4,200,000 purchase price",
    )
    .await;
    let included_top = nearest(&f.table, &q, 1, Some(MATTER_ACME), true).await.unwrap();
    assert_eq!(
        included_top[0].source_id.as_deref(),
        Some("/acme/acme-strategy-memo.md"),
        "precondition: the single best Acme match is the privileged memo"
    );
    let default_top = nearest(&f.table, &q, 1, Some(MATTER_ACME), false).await.unwrap();
    assert_eq!(
        default_top.len(),
        1,
        "prefilter must return a full non-privileged result at top_k=1 (postfilter would return 0)"
    );
    assert_eq!(default_top[0].privilege.as_deref(), Some(PRIVILEGE_NONE));
    assert_ne!(
        default_top[0].source_id.as_deref(),
        Some("/acme/acme-strategy-memo.md")
    );
}

#[tokio::test]
async fn priv_retag_flips_exclusion_in_place() {
    // WS-PRIV: retag_privilege_for_path flips a source from non-privileged to
    // privileged in place (no re-embed), and that immediately changes whether it
    // is returned by default retrieval.
    let dir = tempfile::tempdir().unwrap();
    let conn = store::open_connection(dir.path()).await.unwrap();
    let table = store::open_or_create_table(&conn).await.unwrap();

    let path = "/m/contract.md";
    let text = "Settlement terms: the parties agree to a confidential payment schedule.";
    let chunks = keepance_lib::commands::rag::chunker::chunk_text(path, text);
    let texts: Vec<String> = chunks.iter().map(|c| c.text.clone()).collect();
    let vectors = keepance_lib::commands::rag::embedder::embed_documents(&texts).await.unwrap();
    let rows: Vec<(Chunk, Vec<f32>)> = chunks.into_iter().zip(vectors).collect();
    // Index initially as non-privileged.
    let batch = store::build_batch(&rows, SourceType::Text, MATTER_ACME, PRIVILEGE_NONE, &VEC_KEY).unwrap();
    let schema = batch.schema();
    use arrow_array::RecordBatchIterator;
    table.add(Box::new(RecordBatchIterator::new(vec![Ok(batch)], schema))).execute().await.unwrap();

    let q = embed("confidential settlement payment schedule").await;

    // Before re-tag: returned by default retrieval.
    let before = nearest(&table, &q, 5, Some(MATTER_ACME), false).await.unwrap();
    assert!(
        before.iter().any(|h| h.source_id.as_deref() == Some(path)),
        "non-privileged doc should be returned by default before re-tag"
    );

    // Re-tag as attorney-client privileged (in place, no re-embed).
    let updated = store::retag_privilege_for_path(&table, path, PRIVILEGE_ATTORNEY_CLIENT)
        .await
        .unwrap();
    assert!(updated >= 1, "expected at least one chunk re-tagged, got {updated}");

    // After re-tag: EXCLUDED from default retrieval, but present with opt-in.
    let after_default = nearest(&table, &q, 5, Some(MATTER_ACME), false).await.unwrap();
    assert!(
        after_default.iter().all(|h| h.source_id.as_deref() != Some(path)),
        "doc must be excluded from default retrieval after being marked privileged"
    );
    let after_included = nearest(&table, &q, 5, Some(MATTER_ACME), true).await.unwrap();
    let hit = after_included
        .iter()
        .find(|h| h.source_id.as_deref() == Some(path))
        .expect("re-tagged doc must be retrievable with include_privileged = true");
    assert_eq!(hit.privilege.as_deref(), Some(PRIVILEGE_ATTORNEY_CLIENT));
}

// ===========================================================================
// WS-VEC — chunk-text encryption at rest.
// ===========================================================================

/// THE on-disk confidentiality test (mirrors the audit store's
/// `payload_plaintext_does_not_appear_on_disk`): a sensitive DOCUMENT chunk
/// string must NOT be readable in the raw LanceDB files on disk. Documents were
/// plaintext before WS-VEC; this is the regression guard that they are now
/// encrypted at rest. We scan EVERY file under the dataset dir (LanceDB writes
/// data into .lance fragment files), recursively, for the secret bytes.
#[tokio::test]
async fn vec_chunk_text_is_encrypted_on_disk() {
    let dir = tempfile::tempdir().unwrap();
    let conn = store::open_connection(dir.path()).await.unwrap();
    let table = store::open_or_create_table(&conn).await.unwrap();

    // A distinctive sensitive string that does not occur elsewhere in the schema.
    let secret = "CONFIDENTIAL_SETTLEMENT_FIGURE_8675309_acme_merger";
    let doc = format!(
        "Privileged deal terms. The agreed settlement figure is {secret}, payable at closing."
    );
    let path = "/acme/secret-terms.md";
    let chunks = keepance_lib::commands::rag::chunker::chunk_text(path, &doc);
    let texts: Vec<String> = chunks.iter().map(|c| c.text.clone()).collect();
    let vectors = keepance_lib::commands::rag::embedder::embed_documents(&texts).await.unwrap();
    let rows: Vec<(Chunk, Vec<f32>)> = chunks.into_iter().zip(vectors).collect();
    // DOCUMENT path (build_batch) — the formerly-plaintext path.
    let batch = store::build_batch(&rows, SourceType::Text, MATTER_ACME, PRIVILEGE_NONE, &VEC_KEY).unwrap();
    let schema = batch.schema();
    use arrow_array::RecordBatchIterator;
    table.add(Box::new(RecordBatchIterator::new(vec![Ok(batch)], schema))).execute().await.unwrap();
    drop(table);
    drop(conn);

    // Recursively read every file under the vectors dataset dir and assert the
    // secret bytes appear in NONE of them (it lives only inside the AES-GCM blob).
    let dataset_dir = store::dataset_path(dir.path());
    let mut files_scanned = 0usize;
    for entry in walkdir::WalkDir::new(&dataset_dir).into_iter().filter_map(|e| e.ok()) {
        if entry.file_type().is_file() {
            let bytes = std::fs::read(entry.path()).unwrap_or_default();
            files_scanned += 1;
            assert!(
                !bytes.windows(secret.len()).any(|w| w == secret.as_bytes()),
                "WS-VEC LEAK: plaintext chunk text found in {:?}",
                entry.path()
            );
        }
    }
    assert!(files_scanned > 0, "expected to scan at least one on-disk LanceDB file");
}

/// Retrieval returns the correct DECRYPTED chunk text for a DOCUMENT chunk:
/// the store returns ciphertext (asserted), and decrypting it (as the command
/// does) yields the exact original plaintext fact.
#[tokio::test]
async fn vec_retrieval_returns_correct_decrypted_text() {
    let f = fixture().await;
    let q = embed("what is the purchase price in the share purchase agreement").await;
    let hits = nearest(&f.table, &q, 5, Some(MATTER_ACME), false).await.unwrap();
    let top = hits
        .iter()
        .find(|h| h.source_id.as_deref() == Some("/acme/acme-spa.md"))
        .expect("acme spa chunk");
    // Store layer: the raw text is encrypted (hex ciphertext, not the plaintext).
    assert!(top.encrypted, "WS-VEC: every chunk must be marked encrypted at the store layer");
    assert!(
        !top.text.contains("4,200,000") && !top.text.contains("Closing Date"),
        "WS-VEC: the store must return ciphertext, never plaintext"
    );
    // Decrypting (as rag_retrieve does) recovers the exact fact verbatim.
    let plaintext = decrypt_hit(top);
    assert!(plaintext.contains("Four Million Two Hundred Thousand Dollars ($4,200,000)"));
    assert!(plaintext.contains("closing date of the transactions"));
}
