//! VG-1 LEG 1 — WEDGE RETRIEVAL TRUTH over the REAL campaign fixtures.
//!
//! Indexes the actual Johnson v. Nexus Dynamics fixture files
//! (`tests/fixtures/matter-corpus/`) into a temp LanceDB through the SAME
//! production chunker → e5-small embedder → encrypted store the app ships,
//! and asserts the wedge's retrieval layer tells the truth:
//!
//!   C1/C2/C3 — for each planted contradiction (README.md:37-47), BOTH
//!       conflicting passages are retrievable by natural-language queries,
//!       carry the right source, and their citations VERIFY against the
//!       store (a contradiction needs both sides retrievable).
//!   ISOLATION — the same Johnson queries scoped to Matter B (Acme) never
//!       return Johnson content, and vice versa (README distinctness
//!       invariant: Acme files contain no "Johnson"/"Nexus Dynamics").
//!   FINDER FEED — the Deposition Contradiction Finder's OWN retrieval
//!       query (retrievalQueryTemplate interpolated with the proof-run
//!       interview inputs, DepositionContradictionFinder.ts:64) at its own
//!       topK = 12 surfaces both sides of all three contradictions.
//!   OFFICE (VG-2b) — the corpus's .docx members index through the SAME
//!       extraction production uses (lantern-docx parse + plain-text walk),
//!       a contract clause retrieves with a VERIFYING citation, and the
//!       matter-isolation invariants hold over the bigger corpus.
//!   TRANSCRIPT (VG-3c) — the certified line-numbered Weston transcript
//!       indexes through the PRODUCTION transcript path
//!       (transcript::chunk_transcript, grouped by locator start page
//!       exactly as index_one_file does); its hits carry a page:line
//!       locator covering the planted sentence and the citation VERIFIES.
//!       The Johnson transcript stays byte-untouched on the GENERIC path —
//!       the c1/c2/c3 chunk-id assertions are that regression lock.
//!
//! HONESTY BOUNDARY: this binary proves RETRIEVAL truth only. The actual
//! contradiction-finding judgment is an LLM analyze step (legalAnalysis.ts)
//! and is proven by the leg-3 real-machine pass, never here.
//!
//! NOTE: under the Option B gate the embedder NEVER downloads implicitly —
//! pre-provision the e5-small cache exactly as rag_matter_scope.rs documents
//! (this rig: ~/.local/share/lantern/models/e5-small is populated).

use lantern_lib::commands::rag::chunker::Chunk;
use lantern_lib::commands::rag::store::{self, lookup_by_id, SourceType, PRIVILEGE_NONE};
use lantern_lib::commands::rag::Verdict;
use std::sync::Arc;
use tokio::sync::OnceCell;

/// Returns true when the e5-small model cache is provisioned and the embedder
/// can initialize. Uses the same path resolution as the production embedder so
/// the check is identical to what the app sees at runtime.
fn model_is_provisioned() -> bool {
    use lantern_lib::commands::rag::embedder::resolve_cache_dir;
    use lantern_lib::commands::rag::model_download::model_files_cached;
    model_files_cached(&resolve_cache_dir())
}

/// Skip a model-dependent test when the e5-small cache is absent.
/// CI runners do not have the model; local dev and the nightly server job do.
///
/// When REQUIRE_RAG_MODEL is set (non-empty) AND the model is not provisioned,
/// panics loudly so the nightly run fails visibly rather than silently skipping.
/// When REQUIRE_RAG_MODEL is unset (the default, used in CI), keeps the skip
/// behaviour so model-absent CI jobs still pass.
macro_rules! skip_without_model {
    () => {
        if !model_is_provisioned() {
            if std::env::var("REQUIRE_RAG_MODEL").ok().filter(|v| !v.is_empty()).is_some() {
                panic!(
                    "REQUIRE_RAG_MODEL set but e5-small cache missing — \
                     refusing to silently skip RAG tests"
                );
            }
            eprintln!(
                "SKIP {}: e5-small model cache not provisioned \
                 (expected on CI; runs locally/nightly)",
                module_path!()
            );
            return;
        }
    };
}

const MATTER_JOHNSON: &str = "matter-johnson";
const MATTER_ACME_B: &str = "matter-acme-b";

/// Fixed vector-store key so the tests never touch the OS keychain
/// (same pattern as rag_matter_scope.rs).
const VEC_KEY: [u8; 32] = [0x6Bu8; 32];

const FIXTURE_DIR: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../tests/fixtures/matter-corpus"
);

/// Decrypt a `StoredHit`'s text (hex AES-256-GCM) exactly as the
/// `rag_retrieve` command does.
fn decrypt_hit(h: &store::StoredHit) -> String {
    use lantern_lib::commands::mail::crypto::decrypt_with_key;
    let blob = hex::decode(&h.text).expect("hit text must be hex ciphertext");
    String::from_utf8(decrypt_with_key(&blob, &VEC_KEY).expect("decrypt hit text"))
        .expect("utf8 plaintext")
}

/// VG-6e — the store's `path`/`source_id` columns hold opaque keyed tokens at
/// rest; the real path rides the encrypted `path_enc` column and is decrypted
/// on read (exactly what `rag_retrieve` does after `store::nearest`). This
/// wrapper mirrors that production read path — same signature as
/// `store::nearest`, so every retrieval call site and assertion below is
/// unchanged and keeps reading REAL plaintext paths.
async fn nearest(
    table: &lancedb::Table,
    query_vec: &[f32],
    top_k: usize,
    scope: Option<&str>,
    include_privileged: bool,
) -> anyhow::Result<Vec<store::StoredHit>> {
    use lantern_lib::commands::mail::crypto::decrypt_with_key;
    let mut hits = store::nearest(table, query_vec, top_k, scope, include_privileged, &[]).await?;
    for h in &mut hits {
        let enc = h.path_enc.as_deref().expect("V10 rows must carry path_enc");
        let blob = hex::decode(enc).expect("path_enc must be hex ciphertext");
        let plain = String::from_utf8(
            decrypt_with_key(&blob, &VEC_KEY).expect("decrypt path_enc"),
        )
        .expect("utf8 path");
        h.path = plain.clone();
        h.source_id = Some(plain);
    }
    Ok(hits)
}

struct Source {
    matter_id: &'static str,
    /// Stable test path; basename matches the real fixture file so citation
    /// labels look exactly like production.
    source_id: &'static str,
    /// Fixture filename to load from FIXTURE_DIR.
    file: &'static str,
}

/// The corpus: the REAL fixture files (read at test time, never inlined, so
/// fixture edits keep the proof honest). Johnson = the contradiction pair
/// plus the services contract (VG-2b office member); Acme = the isolation
/// matter (supply agreement + the intake memo, its .docx member).
/// VG-3c — the certified line-numbered Weston transcript. Loaded through the
/// PRODUCTION transcript path (detect + page:line chunking); the generator's
/// planted-sentence constants (generate-fixtures.py WESTON_HOLD_*) are
/// mirrored in the locator test below.
const WESTON_FILE: &str = "deposition-transcript-weston-certified.txt";
const WESTON_SOURCE_ID: &str = "/matter-corpus/deposition-transcript-weston-certified.txt";

fn corpus() -> Vec<Source> {
    vec![
        Source {
            matter_id: MATTER_JOHNSON,
            source_id: "/matter-corpus/deposition-transcript-johnson.txt",
            file: "deposition-transcript-johnson.txt",
        },
        Source {
            matter_id: MATTER_JOHNSON,
            source_id: WESTON_SOURCE_ID,
            file: WESTON_FILE,
        },
        Source {
            matter_id: MATTER_JOHNSON,
            source_id: "/matter-corpus/incident-summary-johnson.md",
            file: "incident-summary-johnson.md",
        },
        Source {
            matter_id: MATTER_JOHNSON,
            source_id: "/matter-corpus/contract-services-agreement.docx",
            file: "contract-services-agreement.docx",
        },
        Source {
            matter_id: MATTER_ACME_B,
            source_id: "/matter-corpus/matter-b-acme/acme-supply-agreement.txt",
            file: "matter-b-acme/acme-supply-agreement.txt",
        },
        Source {
            matter_id: MATTER_ACME_B,
            source_id: "/matter-corpus/matter-b-acme/intake-memo-acme.docx",
            file: "matter-b-acme/intake-memo-acme.docx",
        },
    ]
}

/// Load a corpus member's plain text + its store-level SourceType, branching
/// on extension EXACTLY the way production's `index_one_file` dispatch does:
/// `.docx` goes through lantern-docx's parse + plain-text tree walk joined
/// with "\n\n" (VG-2b); everything else is raw UTF-8.
fn load_source(src: &Source) -> (String, SourceType) {
    let path = format!("{FIXTURE_DIR}/{}", src.file);
    if src.file.ends_with(".docx") {
        let bytes =
            std::fs::read(&path).unwrap_or_else(|e| panic!("read fixture {path}: {e}"));
        let doc = lantern_docx::parse_docx_bytes(&bytes)
            .unwrap_or_else(|e| panic!("parse fixture {path}: {e}"));
        (
            lantern_docx::extract_paragraph_texts(&doc).join("\n\n"),
            SourceType::Docx,
        )
    } else {
        (
            std::fs::read_to_string(&path)
                .unwrap_or_else(|e| panic!("read fixture {path}: {e}")),
            SourceType::Text,
        )
    }
}

/// VG-3c — chunk groups for one corpus member, through the SAME dispatch
/// production's `index_one_file` uses. The certified Weston transcript goes
/// through `transcript::detect_transcript` + `transcript::chunk_transcript`
/// (page:line locators, grouped by the locator's START PAGE exactly as
/// `index_transcript` groups them); everything else is one generic-chunker
/// group under its `load_source` SourceType — so the Johnson transcript and
/// every other member keep their byte-identical chunk ids.
fn load_groups(src: &Source) -> Vec<(SourceType, Vec<Chunk>)> {
    use lantern_lib::commands::rag::transcript;
    if src.file == WESTON_FILE {
        let path = format!("{FIXTURE_DIR}/{}", src.file);
        let text = std::fs::read_to_string(&path)
            .unwrap_or_else(|e| panic!("read fixture {path}: {e}"));
        assert!(
            transcript::detect_transcript(&text),
            "the certified Weston fixture must detect as a transcript"
        );
        let chunks = transcript::chunk_transcript(src.source_id, &text);
        let mut grouped: std::collections::BTreeMap<u32, Vec<Chunk>> =
            std::collections::BTreeMap::new();
        for c in chunks {
            let page = transcript::locator_start_page(c.locator.as_deref()).unwrap_or(1);
            grouped.entry(page).or_default().push(c);
        }
        grouped
            .into_iter()
            .map(|(page, chunks)| (SourceType::Transcript { start_page: page }, chunks))
            .collect()
    } else {
        let (text, source_type) = load_source(src);
        vec![(
            source_type,
            lantern_lib::commands::rag::chunker::chunk_text(src.source_id, &text),
        )]
    }
}

struct Fixture {
    table: lancedb::Table,
    _dir: tempfile::TempDir,
}

static FIXTURE: OnceCell<Arc<Fixture>> = OnceCell::const_new();

async fn fixture() -> Arc<Fixture> {
    FIXTURE
        .get_or_init(|| async {
            let dir = tempfile::tempdir().expect("tempdir");
            let conn = store::open_connection(dir.path()).await.expect("open connection");
            let table = store::open_or_create_table(&conn).await.expect("create table");

            for src in corpus() {
                for (source_type, chunks) in load_groups(&src) {
                    if chunks.is_empty() {
                        continue;
                    }
                    let texts: Vec<String> = chunks.iter().map(|c| c.text.clone()).collect();
                    let vectors = lantern_lib::commands::rag::embedder::embed_documents(&texts)
                        .await
                        .expect("embed documents (is the e5-small cache provisioned?)");
                    let rows: Vec<(Chunk, Vec<f32>)> = chunks.into_iter().zip(vectors).collect();
                    let batch = store::build_batch(
                        &rows,
                        source_type,
                        src.matter_id,
                        PRIVILEGE_NONE,
                        None,
                        &VEC_KEY,
                    )
                    .expect("build batch");
                    let schema = batch.schema();
                    use arrow_array::RecordBatchIterator;
                    table
                        .add(Box::new(RecordBatchIterator::new(vec![Ok(batch)], schema)))
                        .execute()
                        .await
                        .expect("add batch");
                }
            }

            Arc::new(Fixture { table, _dir: dir })
        })
        .await
        .clone()
}

async fn embed(query: &str) -> Vec<f32> {
    lantern_lib::commands::rag::embedder::embed_query(query)
        .await
        .expect("embed query")
}

/// Mirror of `rag_verify_citation`'s verdict logic at the store layer
/// (identical to rag_matter_scope.rs's helper). The normalize closure mirrors
/// `text_contains_normalized`'s canon (Task 5): lowercase + curly quotes
/// straightened + whitespace collapsed — symmetric on both sides, not fuzzy.
async fn verify(table: &lancedb::Table, id: &str, claimed: &str, quoted: &str) -> Verdict {
    use lantern_lib::commands::mail::crypto::decrypt_with_key;
    let normalize = |s: &str| {
        let lowered = s.to_lowercase();
        let straightened: String = lowered
            .chars()
            .map(|c| match c {
                '\u{2018}' | '\u{2019}' => '\'',
                '\u{201C}' | '\u{201D}' => '"',
                other => other,
            })
            .collect();
        straightened.split_whitespace().collect::<Vec<_>>().join(" ")
    };
    let decrypt = |hex_text: &str| -> String {
        let blob = hex::decode(hex_text).expect("record text must be hex ciphertext");
        String::from_utf8(decrypt_with_key(&blob, &VEC_KEY).expect("decrypt record text"))
            .expect("utf8")
    };
    match lookup_by_id(table, id, Some(claimed)).await.unwrap() {
        Some(rec) => {
            let plaintext = decrypt(&rec.text);
            if normalize(&plaintext).contains(&normalize(quoted)) && !normalize(quoted).is_empty()
            {
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

/// Find the first hit (scoped retrieval result) whose DECRYPTED text contains
/// `needle`; panics with the result set listing when absent — the panic
/// message is the finding.
fn hit_containing<'a>(
    hits: &'a [store::StoredHit],
    needle: &str,
) -> &'a store::StoredHit {
    hits.iter()
        .find(|h| decrypt_hit(h).contains(needle))
        .unwrap_or_else(|| {
            panic!(
                "FINDING: no retrieved chunk contains {needle:?}; got sources {:?}",
                hits.iter().map(|h| h.source_id.clone()).collect::<Vec<_>>()
            )
        })
}

/// Retrieve + assert a passage containing `needle` comes back from `source`,
/// with a reproducible chunk id and a citation that VERIFIES.
async fn assert_cited_passage(
    f: &Fixture,
    query: &str,
    matter: &str,
    source: &str,
    needle: &str,
) {
    let q = embed(query).await;
    let hits = nearest(&f.table, &q, 8, Some(matter), false).await.expect("retrieve");
    assert!(!hits.is_empty(), "no hits for {query:?}");
    let hit = hit_containing(&hits, needle);
    assert_eq!(hit.source_id.as_deref(), Some(source), "wrong source for {needle:?}");
    assert_eq!(hit.matter_id.as_deref(), Some(matter));
    // Citation key is content-addressed + reproducible.
    assert_eq!(hit.id, store::chunk_id(source, hit.paragraph_index));
    // And the citation VERIFIES (quote is a verbatim substring of the chunk).
    let verdict = verify(&f.table, &hit.id, matter, needle).await;
    assert_eq!(verdict, Verdict::Verified, "citation for {needle:?} must verify");
}

// ===========================================================================
// CONTRADICTION-1 — personal-email forwarding vs nothing-left-company-systems
// ===========================================================================

#[tokio::test]
async fn c1_transcript_side_personal_email_retrieves_and_verifies() {
    skip_without_model!();
    let f = fixture().await;
    assert_cited_passage(
        &f,
        "did Johnson forward any documents to his personal email",
        MATTER_JOHNSON,
        "/matter-corpus/deposition-transcript-johnson.txt",
        "I forwarded them to my personal email for safekeeping",
    )
    .await;
}

#[tokio::test]
async fn c1_summary_side_company_servers_only_retrieves_and_verifies() {
    skip_without_model!();
    let f = fixture().await;
    // Needle matches the fixture's EXACT words incl. its hard line wrap
    // (incident-summary-johnson.md:29-30 — "…**all relevant documents\n
    // remained on company servers only**…"); chunks preserve paragraph text
    // verbatim, so a space there would be a false mismatch.
    assert_cited_passage(
        &f,
        "did any of Johnson's documents leave company systems",
        MATTER_JOHNSON,
        "/matter-corpus/incident-summary-johnson.md",
        "all relevant documents\nremained on company servers only",
    )
    .await;
}

// ===========================================================================
// CONTRADICTION-2 — deadline October 17 (transcript) vs October 10 (summary).
// ONE query, both sides in the result set: the passages are semantically
// near-identical, the corpus is small, and nearest() is an exact scan here,
// so this is deterministic. Both sides retrievable = the contradiction is
// FINDABLE by the layer above.
// ===========================================================================

#[tokio::test]
async fn c2_deadline_both_sides_retrievable_each_with_verifying_citation() {
    skip_without_model!();
    let f = fixture().await;
    let q = embed("what deadline was Johnson given to submit his written response about the expense review").await;
    let hits = nearest(&f.table, &q, 8, Some(MATTER_JOHNSON), false).await.unwrap();

    let transcript = hit_containing(&hits, "until October 17, 2025 to submit my written response");
    assert_eq!(
        transcript.source_id.as_deref(),
        Some("/matter-corpus/deposition-transcript-johnson.txt")
    );
    let v1 = verify(&f.table, &transcript.id, MATTER_JOHNSON, "October 17, 2025").await;
    assert_eq!(v1, Verdict::Verified);

    // Needle is the summary's fixture-exact phrase incl. its ** bold markers
    // (incident-summary-johnson.md:41). The bare date "October 10, 2025" is
    // NOT unique to the summary: the transcript's inline [CONTRADICTION-2]
    // annotation (deposition-transcript-johnson.txt:110) quotes the same date
    // inside the SAME chunk as the Oct-17 answer, so a first-match on the
    // bare date mis-attributes the source.
    let summary = hit_containing(&hits, "a deadline of **October 10, 2025**");
    assert_eq!(
        summary.source_id.as_deref(),
        Some("/matter-corpus/incident-summary-johnson.md")
    );
    let v2 = verify(&f.table, &summary.id, MATTER_JOHNSON, "October 10, 2025").await;
    assert_eq!(v2, Verdict::Verified);
}

// ===========================================================================
// CONTRADICTION-3 — four-week severance (transcript) vs eight weeks (summary).
// ===========================================================================

#[tokio::test]
async fn c3_severance_both_sides_retrievable_each_with_verifying_citation() {
    skip_without_model!();
    let f = fixture().await;
    let q = embed("how many weeks of severance was Johnson offered when he was terminated").await;
    let hits = nearest(&f.table, &q, 8, Some(MATTER_JOHNSON), false).await.unwrap();

    let transcript = hit_containing(&hits, "a document describing a four-week severance");
    assert_eq!(
        transcript.source_id.as_deref(),
        Some("/matter-corpus/deposition-transcript-johnson.txt")
    );
    let v1 = verify(&f.table, &transcript.id, MATTER_JOHNSON, "four-week severance").await;
    assert_eq!(v1, Verdict::Verified);

    let summary = hit_containing(&hits, "eight (8) weeks of base salary continuation");
    assert_eq!(
        summary.source_id.as_deref(),
        Some("/matter-corpus/incident-summary-johnson.md")
    );
    let v2 = verify(
        &f.table,
        &summary.id,
        MATTER_JOHNSON,
        "eight (8) weeks of base salary continuation",
    )
    .await;
    assert_eq!(v2, Verdict::Verified);
}

// ===========================================================================
// ISOLATION — Matter B (Acme) never bleeds into Johnson queries or vice
// versa. README invariant: Acme files contain no "Johnson"/"Nexus Dynamics"/
// "Marchetti" — re-asserted here over the DECRYPTED retrieved text so a
// future fixture edit cannot silently break the isolation proof.
// ===========================================================================

#[tokio::test]
async fn johnson_contradiction_queries_scoped_to_acme_return_no_johnson_content() {
    skip_without_model!();
    let f = fixture().await;
    for query in [
        "did Johnson forward any documents to his personal email",
        "what deadline was Johnson given to submit his written response about the expense review",
        "how many weeks of severance was Johnson offered when he was terminated",
    ] {
        let q = embed(query).await;
        let hits = nearest(&f.table, &q, 8, Some(MATTER_ACME_B), false).await.unwrap();
        for h in &hits {
            assert_eq!(
                h.matter_id.as_deref(),
                Some(MATTER_ACME_B),
                "LEAK: {:?} returned under Acme scope for {query:?}",
                h.source_id
            );
            let text = decrypt_hit(h);
            for forbidden in ["Johnson", "Nexus Dynamics", "Marchetti"] {
                assert!(
                    !text.contains(forbidden),
                    "LEAK: Acme-scoped hit {:?} contains {forbidden:?}",
                    h.source_id
                );
            }
        }
    }
}

#[tokio::test]
async fn acme_query_scoped_to_johnson_returns_no_acme_content() {
    skip_without_model!();
    let f = fixture().await;
    // Acme-flavored queries (the second targets the intake memo's shipment
    // narrative — the VG-2b .docx member) scoped to JOHNSON: zero Acme
    // sources may surface, ever.
    for query in [
        "how many units of Widget Model X must the supplier deliver each month",
        "what supply shipments did Road Runner fail to deliver",
    ] {
        let q = embed(query).await;
        let hits = nearest(&f.table, &q, 8, Some(MATTER_JOHNSON), false).await.unwrap();
        for h in &hits {
            assert_eq!(
                h.matter_id.as_deref(),
                Some(MATTER_JOHNSON),
                "LEAK: {:?} returned under Johnson scope for {query:?}",
                h.source_id
            );
            for acme_source in [
                "/matter-corpus/matter-b-acme/acme-supply-agreement.txt",
                "/matter-corpus/matter-b-acme/intake-memo-acme.docx",
            ] {
                assert_ne!(
                    h.source_id.as_deref(),
                    Some(acme_source),
                    "LEAK: {acme_source} surfaced under Johnson scope for {query:?}"
                );
            }
        }
    }
}

// ===========================================================================
// OFFICE (VG-2b) — Word documents are in the index through the production
// extraction (lantern-docx plain-text walk): a contract clause retrieves
// from the .docx with the right source, a content-addressed id, and a
// citation that VERIFIES — and the office members obey matter isolation.
// ===========================================================================

#[tokio::test]
async fn office_docx_clause_retrieves_and_verifies() {
    skip_without_model!();
    let f = fixture().await;
    assert_cited_passage(
        &f,
        "what hourly rate does the services agreement set for the firm's work",
        MATTER_JOHNSON,
        "/matter-corpus/contract-services-agreement.docx",
        "blended hourly rate of $375 per hour",
    )
    .await;
}

#[tokio::test]
async fn acme_intake_memo_never_leaks_into_johnson_scope() {
    skip_without_model!();
    let f = fixture().await;
    // The contract-rate query under JOHNSON scope: the Acme intake memo (a
    // .docx in ANOTHER matter, contract-flavored content) must never appear.
    let q = embed("what hourly rate does the services agreement set for the firm's work").await;
    let hits = nearest(&f.table, &q, 8, Some(MATTER_JOHNSON), false).await.unwrap();
    assert!(!hits.is_empty());
    for h in &hits {
        assert_eq!(h.matter_id.as_deref(), Some(MATTER_JOHNSON), "LEAK: {:?}", h.source_id);
        assert_ne!(
            h.source_id.as_deref(),
            Some("/matter-corpus/matter-b-acme/intake-memo-acme.docx"),
            "LEAK: Acme intake memo surfaced under Johnson scope"
        );
    }
}

// ===========================================================================
// TRANSCRIPT (VG-3c) — the certified Weston transcript, indexed through the
// PRODUCTION page:line path, retrieves with a locator covering the planted
// litigation-hold sentence (generator constants: WESTON_HOLD_PAGE = 2,
// WESTON_HOLD_LINES = 14-16) and the citation VERIFIES across the
// transcript's line wraps. paragraph_index stays the sequential chunk index
// — the content-addressed citation contract is unchanged, page:line is
// metadata ON TOP.
// ===========================================================================

/// Parse "sp:sl-ep:el" into ((sp, sl), (ep, el)); panics with the raw string
/// on malformation — well-formedness is part of what this proves.
fn parse_locator(loc: &str) -> ((u32, u32), (u32, u32)) {
    let parse_pair = |s: &str| -> (u32, u32) {
        let (p, l) = s
            .split_once(':')
            .unwrap_or_else(|| panic!("malformed locator {loc:?}"));
        (
            p.parse().unwrap_or_else(|_| panic!("malformed locator {loc:?}")),
            l.parse().unwrap_or_else(|_| panic!("malformed locator {loc:?}")),
        )
    };
    let (start, end) = loc
        .split_once('-')
        .unwrap_or_else(|| panic!("malformed locator {loc:?}"));
    (parse_pair(start), parse_pair(end))
}

#[tokio::test]
async fn certified_transcript_chunks_carry_page_line_locators() {
    skip_without_model!();
    let f = fixture().await;
    let q = embed("when did the litigation hold notice go out to the infrastructure team").await;
    let hits = nearest(&f.table, &q, 8, Some(MATTER_JOHNSON), false).await.unwrap();

    // The planted sentence's chunk comes back from the CERTIFIED transcript
    // (needle = the contiguous spoken words of fixture page 2 line 14).
    let hit = hit_containing(&hits, "The litigation hold notice went out to");
    assert_eq!(hit.source_id.as_deref(), Some(WESTON_SOURCE_ID));
    assert_eq!(hit.matter_id.as_deref(), Some(MATTER_JOHNSON));
    assert_eq!(hit.source_type.as_deref(), Some("transcript"));

    // The locator is well-formed page:line-page:line and covers the planted
    // sentence at page 2 lines 14-16.
    let locator = hit
        .locator
        .as_deref()
        .expect("a certified-transcript hit must carry a page:line locator");
    let ((sp, sl), (ep, el)) = parse_locator(locator);
    assert!(
        (sp, sl) <= (2, 14) && (2, 16) <= (ep, el),
        "locator Tr. {locator} must cover the planted sentence at 2:14-2:16"
    );

    // page_number carries the chunk group's start page (how the store bands
    // transcript groups), matching the locator's first number.
    assert_eq!(hit.page_number, Some(sp));

    // The citation key is content-addressed exactly as ever — the locator is
    // metadata ON TOP of the unchanged sequential paragraph_index.
    assert_eq!(hit.id, store::chunk_id(WESTON_SOURCE_ID, hit.paragraph_index));

    // And the quote VERIFIES with the full spoken sentence, whitespace-
    // normalized across the transcript's line wraps (the gutter is stripped,
    // so the certified line numbers never pollute verification).
    let verdict = verify(
        &f.table,
        &hit.id,
        MATTER_JOHNSON,
        "The litigation hold notice went out to the cloud infrastructure team on September 12, 2025.",
    )
    .await;
    assert_eq!(verdict, Verdict::Verified, "the Tr. {locator} citation must verify");
}

#[tokio::test]
async fn certified_transcript_stays_out_of_acme_scope() {
    skip_without_model!();
    // The new corpus member obeys the same isolation invariant as everything
    // else: Weston content never surfaces under the Acme matter.
    let f = fixture().await;
    let q = embed("when did the litigation hold notice go out to the infrastructure team").await;
    let hits = nearest(&f.table, &q, 8, Some(MATTER_ACME_B), false).await.unwrap();
    for h in &hits {
        assert_eq!(
            h.matter_id.as_deref(),
            Some(MATTER_ACME_B),
            "LEAK: {:?} under Acme scope",
            h.source_id
        );
        assert_ne!(h.source_id.as_deref(), Some(WESTON_SOURCE_ID));
    }
}

// ===========================================================================
// FINDER FEED — the DepositionContradictionFinder's own retrieval query, at
// its own topK = 12, surfaces both sides of all three contradictions. The
// query string below is retrievalQueryTemplate
// (DepositionContradictionFinder.ts:64) interpolated with the EXACT interview
// inputs the leg-3 runbook uses (keep the two in sync — the runbook cites
// this test). Failure here is a PRODUCT finding (the finder's retrieval feed
// is insufficient), never a test to tune.
// ===========================================================================

/// Mirrors the leg-3 interview answers. Excerpts are the clean Q/A lines
/// (the [CONTRADICTION-N] fixture annotations are NOT pasted — the LLM must
/// not be handed the answer through the interview; the indexed files still
/// contain them, which is a documented fixture caveat).
const FINDER_QUERY: &str = "Testimony and statements by Marcus Johnson relevant to: \
Whether Johnson forwarded documents to his personal email or all materials stayed on company servers. \
The deadline he was given for his written response to the compliance review. \
How many weeks of severance he was offered.. \
Deposition excerpts: Q. Did you preserve those documents? A. I believe I did. I forwarded them to my personal email for safekeeping. \
Q. Did Mr. Weston tell you a deadline for submitting the explanation? A. He said I had until October 17, 2025 to submit my written response. \
Q. At the time of your termination, did anyone at Nexus Dynamics explain the severance package being offered? A. Sandra Liu gave me a document describing a four-week severance.. \
Prior statements: ";

#[tokio::test]
async fn finder_retrieval_query_at_top_k_12_feeds_both_sides_of_all_three_contradictions() {
    skip_without_model!();
    let f = fixture().await;
    let q = embed(FINDER_QUERY).await;
    // topK 12 = the template's own setting (DepositionContradictionFinder.ts:128).
    let hits = nearest(&f.table, &q, 12, Some(MATTER_JOHNSON), false).await.unwrap();
    assert!(!hits.is_empty());

    // Scope hygiene inside the feed.
    for h in &hits {
        assert_eq!(h.matter_id.as_deref(), Some(MATTER_JOHNSON), "LEAK: {:?}", h.source_id);
    }

    // Both source documents are present in the feed…
    let sources: std::collections::HashSet<_> =
        hits.iter().filter_map(|h| h.source_id.clone()).collect();
    assert!(
        sources.contains("/matter-corpus/deposition-transcript-johnson.txt"),
        "finder feed missing the deposition; got {sources:?}"
    );
    assert!(
        sources.contains("/matter-corpus/incident-summary-johnson.md"),
        "finder feed missing the incident summary; got {sources:?}"
    );

    // …and the union of retrieved text covers BOTH sides of ALL THREE
    // contradictions — the necessary condition for the LLM step to be able
    // to flag them with real citations.
    let joined = hits.iter().map(|h| decrypt_hit(h)).collect::<Vec<_>>().join("\n---\n");
    for needle in [
        "I forwarded them to my personal email for safekeeping", // C1 transcript
        // C1 summary — fixture-exact incl. the hard line wrap
        // (incident-summary-johnson.md:29-30; same correction as the C1 test).
        "all relevant documents\nremained on company servers only",
        "October 17, 2025",  // C2 transcript
        "October 10, 2025",  // C2 summary
        "four-week severance", // C3 transcript
        "eight (8) weeks",   // C3 summary
    ] {
        assert!(
            joined.contains(needle),
            "FINDING: finder feed (topK 12) does not contain {needle:?} — \
             the finder cannot cite this side of the contradiction"
        );
    }
}

// ===========================================================================
// F-510 — FINDER FEED PRECISION under a large low-signal file.
//
// RESULTS §E F-510: with huge-notes.md (~1,659 chunks of litigation-notes
// filler) legitimately indexed (the F-501 fix), the finder's single broad
// query at topK 12 fed a DILUTED context — attempt 1 anchored all four
// findings on huge-notes content and the planted-fact rubric went 0/5. The
// deposition/summary chunks WERE retrievable (selection precision, not
// absence). The fix is rag_retrieve's optional per-source diversity cap
// (overfetch top_k*4, cap_per_source, truncate), finder-only via
// perSourceCap: 4.
//
// These tests build a SECOND fixture: the full corpus PLUS huge-notes.md
// indexed under MATTER_JOHNSON — the worst case, IN-SCOPE dilution that no
// matter scoping can filter. Embedding ~1,659 filler chunks is heavy, so
// both tests are #[ignore]d (same convention as rag_embed_memory.rs) and run
// explicitly with `-- --ignored`.
// ===========================================================================

/// The filler corpus: everything `corpus()` indexes plus huge-notes.md in the
/// Johnson matter.
fn corpus_with_filler() -> Vec<Source> {
    let mut sources = corpus();
    sources.push(Source {
        matter_id: MATTER_JOHNSON,
        source_id: "/matter-corpus/huge-notes.md",
        file: "huge-notes.md",
    });
    sources
}

static FIXTURE_FILLER: OnceCell<Arc<Fixture>> = OnceCell::const_new();

/// Like `fixture()` but over `corpus_with_filler()`, in its own tempdir, and
/// embedding through the production BATCHED path — pushing all of
/// huge-notes.md through one unbatched `embed_documents` call is exactly the
/// F-501 OOM shape this rig already proved out in rag_embed_memory.rs.
async fn fixture_with_filler() -> Arc<Fixture> {
    FIXTURE_FILLER
        .get_or_init(|| async {
            let dir = tempfile::tempdir().expect("tempdir");
            let conn = store::open_connection(dir.path()).await.expect("open connection");
            let table = store::open_or_create_table(&conn).await.expect("create table");

            for src in corpus_with_filler() {
                for (source_type, chunks) in load_groups(&src) {
                    if chunks.is_empty() {
                        continue;
                    }
                    let texts: Vec<String> = chunks.iter().map(|c| c.text.clone()).collect();
                    let vectors =
                        lantern_lib::commands::rag::embedder::embed_documents_batched(&texts, None)
                            .await
                            .expect("embed documents (is the e5-small cache provisioned?)")
                            .expect("not cancelled");
                    let rows: Vec<(Chunk, Vec<f32>)> = chunks.into_iter().zip(vectors).collect();
                    let batch = store::build_batch(
                        &rows,
                        source_type,
                        src.matter_id,
                        PRIVILEGE_NONE,
                        None,
                        &VEC_KEY,
                    )
                    .expect("build batch");
                    let schema = batch.schema();
                    use arrow_array::RecordBatchIterator;
                    table
                        .add(Box::new(RecordBatchIterator::new(vec![Ok(batch)], schema)))
                        .execute()
                        .await
                        .expect("add batch");
                }
            }

            Arc::new(Fixture { table, _dir: dir })
        })
        .await
        .clone()
}

/// OBSERVATION, not a gate: the finder's own query at its own topK 12 against
/// the filler corpus, RAW (no cap). Prints the per-source composition so the
/// dilution RESULTS §E describes is recorded honestly (run with --nocapture).
/// Asserts nothing — the capped test below is the gate.
#[tokio::test]
#[ignore]
async fn f510_raw_finder_feed_composition_with_filler_is_recorded() {
    let f = fixture_with_filler().await;
    let q = embed(FINDER_QUERY).await;
    let hits = nearest(&f.table, &q, 12, Some(MATTER_JOHNSON), false).await.unwrap();

    let mut counts: std::collections::BTreeMap<String, usize> = std::collections::BTreeMap::new();
    for h in &hits {
        let key = h.source_id.clone().unwrap_or_else(|| h.path.clone());
        *counts.entry(key).or_insert(0) += 1;
    }
    println!("F-510 raw finder feed (topK 12, huge-notes.md indexed in-matter), per-source:");
    for (src, n) in &counts {
        println!("  {n:>2}  {src}");
    }
}

/// THE GATE: the production cap arithmetic — rag_retrieve's own overfetch
/// (top_k 12 * 4 = 48) followed by the PRODUCTION `cap_per_source` (cap 4,
/// truncate to 12) — recovers BOTH sides of ALL THREE contradictions even
/// with huge-notes.md indexed in the same matter. Hits are built exactly as
/// rag_retrieve builds them (decrypt + distance→score + defensive sort), so
/// this proves the shipped function, not a reimplementation.
///
/// The six needles are duplicated VERBATIM from
/// `finder_retrieval_query_at_top_k_12_feeds_both_sides_of_all_three_contradictions`
/// (that test is a tripwire and stays byte-untouched — keep the lists in sync).
#[tokio::test]
#[ignore]
async fn f510_capped_finder_feed_contains_both_sides_of_all_three() {
    use lantern_lib::commands::rag::embedder::cosine_distance_to_score;
    use lantern_lib::commands::rag::{cap_per_source, Hit};

    let f = fixture_with_filler().await;
    let q = embed(FINDER_QUERY).await;
    // Production overfetch: top_k 12 * 4 = 48 (rag_retrieve's own arithmetic).
    let raw = nearest(&f.table, &q, 48, Some(MATTER_JOHNSON), false).await.unwrap();

    // Build Hits the way rag_retrieve does, then apply the PRODUCTION cap.
    let mut hits: Vec<Hit> = raw
        .iter()
        .map(|h| Hit {
            path: h.path.clone(),
            chunk_text: decrypt_hit(h),
            score: cosine_distance_to_score(h.distance),
            paragraph_index: h.paragraph_index,
            id: Some(h.id.clone()),
            matter_id: h.matter_id.clone(),
            source_id: h.source_id.clone(),
            source_type: h.source_type.clone(),
            page_number: h.page_number,
            privilege: h.privilege.clone(),
            extraction: h.extraction.clone(),
            extraction_confidence: h.extraction_confidence,
            locator: h.locator.clone(),
            // This fixture is built directly from vector-store rows, which do
            // not carry authoritative source-date or fact metadata. Production
            // retrieval attaches source dates from the local source afterward.
            source_date: None,
            dated_fact: None,
            date_conflict: None,
        })
        .collect();
    hits.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal));
    let hits = cap_per_source(hits, 4, 12);

    assert!(!hits.is_empty());
    assert!(hits.len() <= 12, "cap must truncate to the finder's topK");

    // Scope hygiene inside the capped feed (the cap may only NARROW the
    // already-scoped feed — never widen it).
    for h in &hits {
        assert_eq!(h.matter_id.as_deref(), Some(MATTER_JOHNSON), "LEAK: {:?}", h.source_id);
    }

    // With the cap, the planted sides survive the filler: both sides of all
    // three contradictions are in the capped feed.
    let joined = hits.iter().map(|h| h.chunk_text.clone()).collect::<Vec<_>>().join("\n---\n");
    for needle in [
        "I forwarded them to my personal email for safekeeping", // C1 transcript
        // C1 summary — fixture-exact incl. the hard line wrap
        // (incident-summary-johnson.md:29-30; same correction as the C1 test).
        "all relevant documents\nremained on company servers only",
        "October 17, 2025",  // C2 transcript
        "October 10, 2025",  // C2 summary
        "four-week severance", // C3 transcript
        "eight (8) weeks",   // C3 summary
    ] {
        assert!(
            joined.contains(needle),
            "FINDING: CAPPED finder feed (overfetch 48, cap 4, topK 12) does not \
             contain {needle:?} — the diversity cap did not recover this side"
        );
    }
}
