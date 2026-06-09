//! Round-trip tests — the de-risking proof for Keepance 3.0 track changes.
//!
//! TDD note: these were written before the implementation. They drive the
//! whole spike: a fixture with EXISTING tracked changes + a comment must
//! survive a parse->serialize round-trip (TEST A), and the AI must be able to
//! author NEW tracked changes that appear alongside the originals (TEST B).

use std::path::PathBuf;

use docx_roundtrip::author::{ai_delete_run_containing, ai_insert_at_paragraph_end, AI_AUTHOR};
use docx_roundtrip::fixture::{build_fixture_model, FIXTURE_COMMENT_ID, OPPOSING_COUNSEL, OPPOSING_DATE};
use docx_roundtrip::model::{Inline, RevisionKind};
use docx_roundtrip::package::Package;
use docx_roundtrip::validate::validate_package;
use docx_roundtrip::{parse_docx_bytes, roundtrip_bytes, serialize::serialize_package, serialize_docx_bytes};

/// Path to the committed fixture .docx.
fn fixture_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("fixtures/with-tracked-changes.docx")
}

/// Build fixture bytes from the model (single source of truth for the file).
fn fixture_bytes() -> Vec<u8> {
    let model = build_fixture_model();
    serialize_docx_bytes(&model).expect("serialize fixture")
}

// ---------------------------------------------------------------------------
// Fixture: structurally valid .docx with existing tracked changes + comment
// ---------------------------------------------------------------------------

#[test]
fn fixture_is_a_structurally_valid_docx() {
    let bytes = fixture_bytes();
    // It must be a real ZIP we can reopen.
    let pkg = Package::read_from_bytes(&bytes).expect("fixture is a valid zip");
    let report = validate_package(&pkg);
    assert!(
        report.ok(),
        "fixture failed structural validation: {:?}",
        report.errors
    );
}

#[test]
fn fixture_contains_existing_revisions_and_comment() {
    let bytes = fixture_bytes();
    let doc = parse_docx_bytes(&bytes).expect("parse fixture");

    // Exactly one insertion + one deletion, both by opposing counsel.
    let revs = doc.revisions();
    let ins: Vec<_> = revs.iter().filter(|(_, k, _)| *k == RevisionKind::Insertion).collect();
    let del: Vec<_> = revs.iter().filter(|(_, k, _)| *k == RevisionKind::Deletion).collect();
    assert_eq!(ins.len(), 1, "expected one insertion");
    assert_eq!(del.len(), 1, "expected one deletion");
    assert_eq!(ins[0].0.author, OPPOSING_COUNSEL);
    assert_eq!(del[0].0.author, OPPOSING_COUNSEL);

    // The comment exists and is anchored.
    let c = doc.comments.get(FIXTURE_COMMENT_ID).expect("comment present");
    assert_eq!(c.author, OPPOSING_COUNSEL);
    assert!(c.text.contains("disputes"));
}

// ---------------------------------------------------------------------------
// TEST A — preservation: round-trip the fixture, assert nothing is lost
// ---------------------------------------------------------------------------

#[test]
fn test_a_roundtrip_preserves_insertion_deletion_and_comment() {
    let original = fixture_bytes();

    // Round-trip: bytes -> model -> bytes.
    let round1 = roundtrip_bytes(&original).expect("roundtrip 1");

    // The produced bytes must still be a valid, well-formed package.
    let pkg = Package::read_from_bytes(&round1).expect("round1 is valid zip");
    let report = validate_package(&pkg);
    assert!(report.ok(), "round-trip output invalid: {:?}", report.errors);

    // Parse the round-tripped output and assert revisions/comment survived
    // with author, date, AND text intact.
    let doc = parse_docx_bytes(&round1).expect("parse round1");

    let revs = doc.revisions();
    let ins = revs.iter().find(|(_, k, _)| *k == RevisionKind::Insertion).expect("insertion survived");
    assert_eq!(ins.0.author, OPPOSING_COUNSEL);
    assert_eq!(ins.0.date, OPPOSING_DATE);
    assert_eq!(ins.2.iter().map(|r| r.text.as_str()).collect::<String>(), "promptly ");

    let del = revs.iter().find(|(_, k, _)| *k == RevisionKind::Deletion).expect("deletion survived");
    assert_eq!(del.0.author, OPPOSING_COUNSEL);
    assert_eq!(del.0.date, OPPOSING_DATE);
    assert_eq!(del.2.iter().map(|r| r.text.as_str()).collect::<String>(), "minor ");

    let c = doc.comments.get(FIXTURE_COMMENT_ID).expect("comment survived");
    assert_eq!(c.author, OPPOSING_COUNSEL);
    assert_eq!(c.date, OPPOSING_DATE);
    assert_eq!(c.text, "Define the scope of disputes covered.");
    assert_eq!(c.initials.as_deref(), Some("OC"));

    // Idempotence: a second round-trip is byte-identical to the first
    // (deterministic serialization — important for stable diffs / version
    // history in the real app).
    let round2 = roundtrip_bytes(&round1).expect("roundtrip 2");
    assert_eq!(round1, round2, "serialization is not idempotent");

    // The comment anchor markers survived as a balanced pair.
    let starts = count_inline(&doc, |i| matches!(i, Inline::CommentRangeStart { .. }));
    let ends = count_inline(&doc, |i| matches!(i, Inline::CommentRangeEnd { .. }));
    let refs = count_inline(&doc, |i| matches!(i, Inline::CommentReference { .. }));
    assert_eq!(starts, 1);
    assert_eq!(ends, 1);
    assert_eq!(refs, 1);
}

// ---------------------------------------------------------------------------
// TEST B — authoring: AI adds NEW revisions alongside the originals
// ---------------------------------------------------------------------------

#[test]
fn test_b_ai_authored_revisions_appear_alongside_originals() {
    const AI_DATE: &str = "2026-06-09T12:00:00Z";

    // Start from the fixture model (existing opposing-counsel revisions).
    let mut doc = build_fixture_model();
    let original_rev_count = doc.revisions().len();
    assert_eq!(original_rev_count, 2);

    // AI inserts a new sentence (tracked insertion) and deletes an existing
    // plain run (tracked deletion). Both authored "Keepance AI".
    let ins_id = ai_insert_at_paragraph_end(&mut doc, 0, " Time is of the essence.", AI_DATE);
    let del_id = ai_delete_run_containing(&mut doc, 0, "resolve all ", AI_DATE)
        .expect("found a run to delete");
    assert_ne!(ins_id, del_id, "new revisions must get distinct ids");

    // Serialize, then re-parse independently.
    let pkg = serialize_package(&doc).expect("serialize authored doc");
    let report = validate_package(&pkg);
    assert!(report.ok(), "authored doc invalid: {:?}", report.errors);

    let bytes = pkg.write_to_bytes().expect("zip");
    let reparsed = parse_docx_bytes(&bytes).expect("reparse authored doc");

    let revs = reparsed.revisions();
    // 2 originals + 2 new = 4 revisions total.
    assert_eq!(revs.len(), 4, "expected originals + new revisions");

    // Originals still present and attributed to opposing counsel.
    assert!(
        revs.iter().any(|(m, k, runs)| *k == RevisionKind::Insertion
            && m.author == OPPOSING_COUNSEL
            && runs.iter().any(|r| r.text == "promptly ")),
        "original insertion missing"
    );
    assert!(
        revs.iter().any(|(m, k, runs)| *k == RevisionKind::Deletion
            && m.author == OPPOSING_COUNSEL
            && runs.iter().any(|r| r.text == "minor ")),
        "original deletion missing"
    );

    // New AI revisions present, attributed to Keepance AI, with the AI date.
    let ai_ins = revs
        .iter()
        .find(|(m, k, _)| *k == RevisionKind::Insertion && m.author == AI_AUTHOR)
        .expect("AI insertion present");
    assert_eq!(ai_ins.0.date, AI_DATE);
    assert!(ai_ins.2.iter().any(|r| r.text.contains("Time is of the essence")));

    let ai_del = revs
        .iter()
        .find(|(m, k, _)| *k == RevisionKind::Deletion && m.author == AI_AUTHOR)
        .expect("AI deletion present");
    assert_eq!(ai_del.0.date, AI_DATE);
    assert!(ai_del.2.iter().any(|r| r.text.contains("resolve all")));

    // The original comment is untouched by authoring.
    assert!(reparsed.comments.contains_key(FIXTURE_COMMENT_ID));

    // All four revision ids are unique (Word groups accept/reject by id).
    let mut ids: Vec<_> = revs.iter().map(|(m, _, _)| m.id.clone()).collect();
    ids.sort();
    ids.dedup();
    assert_eq!(ids.len(), 4, "revision ids collided: {ids:?}");
}

// ---------------------------------------------------------------------------
// Committed-fixture consistency: the file on disk matches the model.
// ---------------------------------------------------------------------------

#[test]
fn committed_fixture_matches_generator() {
    let path = fixture_path();
    let on_disk = std::fs::read(&path)
        .unwrap_or_else(|_| panic!("committed fixture missing at {path:?}; run the generator"));
    // Parse both and compare models (zip byte equality is brittle across zip
    // crate versions; model equality is the meaningful invariant).
    let disk_doc = parse_docx_bytes(&on_disk).expect("parse committed fixture");
    let gen_doc = build_fixture_model();
    assert_eq!(
        disk_doc, gen_doc,
        "committed fixture drifted from generator; regenerate it"
    );
}

fn count_inline(doc: &docx_roundtrip::model::Document, pred: impl Fn(&Inline) -> bool) -> usize {
    doc.body
        .iter()
        .flat_map(|p| p.inlines.iter())
        .filter(|i| pred(i))
        .count()
}
