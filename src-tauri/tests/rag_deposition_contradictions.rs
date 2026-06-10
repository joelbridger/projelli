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
//!
//! HONESTY BOUNDARY: this binary proves RETRIEVAL truth only. The actual
//! contradiction-finding judgment is an LLM analyze step (legalAnalysis.ts)
//! and is proven by the leg-3 real-machine pass, never here.
//!
//! NOTE: under the Option B gate the embedder NEVER downloads implicitly —
//! pre-provision the e5-small cache exactly as rag_matter_scope.rs documents
//! (this rig: ~/.local/share/keepance/models/e5-small is populated).
//!
//! Corpus note: only text formats are rag-indexable today (extractor.rs:19);
//! the corpus here is the fixtures' text members. intake-memo-acme.docx is
//! NOT indexed — that is the documented extractor TODO, not a gap this
//! harness owns.

use keepance_lib::commands::rag::chunker::Chunk;
use keepance_lib::commands::rag::store::{
    self, lookup_by_id, nearest, SourceType, PRIVILEGE_NONE,
};
use keepance_lib::commands::rag::Verdict;
use std::sync::Arc;
use tokio::sync::OnceCell;

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
    use keepance_lib::commands::mail::crypto::decrypt_with_key;
    let blob = hex::decode(&h.text).expect("hit text must be hex ciphertext");
    String::from_utf8(decrypt_with_key(&blob, &VEC_KEY).expect("decrypt hit text"))
        .expect("utf8 plaintext")
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
/// fixture edits keep the proof honest). Johnson = the contradiction pair;
/// Acme = the isolation matter (its only rag-indexable file).
fn corpus() -> Vec<Source> {
    vec![
        Source {
            matter_id: MATTER_JOHNSON,
            source_id: "/matter-corpus/deposition-transcript-johnson.txt",
            file: "deposition-transcript-johnson.txt",
        },
        Source {
            matter_id: MATTER_JOHNSON,
            source_id: "/matter-corpus/incident-summary-johnson.md",
            file: "incident-summary-johnson.md",
        },
        Source {
            matter_id: MATTER_ACME_B,
            source_id: "/matter-corpus/matter-b-acme/acme-supply-agreement.txt",
            file: "matter-b-acme/acme-supply-agreement.txt",
        },
    ]
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
                let path = format!("{FIXTURE_DIR}/{}", src.file);
                let text = std::fs::read_to_string(&path)
                    .unwrap_or_else(|e| panic!("read fixture {path}: {e}"));
                let chunks =
                    keepance_lib::commands::rag::chunker::chunk_text(src.source_id, &text);
                let texts: Vec<String> = chunks.iter().map(|c| c.text.clone()).collect();
                let vectors = keepance_lib::commands::rag::embedder::embed_documents(&texts)
                    .await
                    .expect("embed documents (is the e5-small cache provisioned?)");
                let rows: Vec<(Chunk, Vec<f32>)> = chunks.into_iter().zip(vectors).collect();
                let batch = store::build_batch(
                    &rows,
                    SourceType::Text,
                    src.matter_id,
                    PRIVILEGE_NONE,
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

/// Mirror of `rag_verify_citation`'s verdict logic at the store layer
/// (identical to rag_matter_scope.rs's helper).
async fn verify(table: &lancedb::Table, id: &str, claimed: &str, quoted: &str) -> Verdict {
    use keepance_lib::commands::mail::crypto::decrypt_with_key;
    let normalize = |s: &str| s.split_whitespace().collect::<Vec<_>>().join(" ");
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
