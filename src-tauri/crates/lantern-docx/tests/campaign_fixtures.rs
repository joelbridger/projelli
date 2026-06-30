//! Campaign fixture validation — Keepance 3.0 quality campaign.
//!
//! Validates that the committed corpus fixtures at
//! `tests/fixtures/matter-corpus/` can be parsed by the production Rust
//! engine without panic or error, and that their key structural properties
//! (tracked changes, comments, valid package structure) are as expected.
//!
//! Run: cargo test -p lantern-docx campaign_fixtures
//!
//! These tests complement the Python generator scripts in
//! `tests/fixtures/matter-corpus/generators/`; they are the contractual
//! assertion that a regenerated fixture still meets the engine's requirements.

use lantern_docx::{open_docx_bytes, parse_docx_bytes};
use lantern_docx::model::RevisionKind;
use lantern_docx::package::Package;
use lantern_docx::validate::validate_package;

/// Absolute path to the matter-corpus fixture directory.
/// `CARGO_MANIFEST_DIR` points to `src-tauri/crates/lantern-docx/`.
fn corpus_path(filename: &str) -> std::path::PathBuf {
    // Walk up from the crate manifest to the repo root, then into tests/fixtures/matter-corpus/
    let manifest = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
    // src-tauri/crates/lantern-docx → repo root = ../../..
    let repo_root = manifest
        .parent()         // crates/
        .and_then(|p| p.parent())  // src-tauri/
        .and_then(|p| p.parent())  // repo root
        .expect("unexpected crate layout");
    repo_root
        .join("tests")
        .join("fixtures")
        .join("matter-corpus")
        .join(filename)
}

// ---------------------------------------------------------------------------
// engagement-letter-tracked.docx
// Must parse cleanly and have >= 4 revisions (2 ins + 2 del).
// ---------------------------------------------------------------------------

#[test]
fn engagement_letter_tracked_has_at_least_4_revisions() {
    let path = corpus_path("engagement-letter-tracked.docx");
    assert!(
        path.exists(),
        "fixture missing: {:?}  — run generators/generate-fixtures.py",
        path
    );

    let bytes = std::fs::read(&path).expect("read engagement-letter-tracked.docx");

    // Package must be structurally valid (valid zip + content-types).
    let pkg = Package::read_from_bytes(&bytes).expect("engagement letter is a valid zip");
    let report = validate_package(&pkg);
    assert!(
        report.ok(),
        "engagement-letter-tracked.docx failed validation: {:?}",
        report.errors
    );

    // Parse and count revisions.
    let doc = parse_docx_bytes(&bytes).expect("parse engagement-letter-tracked.docx");
    let revs = doc.revisions();
    let ins_count = revs.iter().filter(|(_, k, _)| *k == RevisionKind::Insertion).count();
    let del_count = revs.iter().filter(|(_, k, _)| *k == RevisionKind::Deletion).count();

    assert!(
        ins_count >= 2,
        "expected >= 2 tracked insertions in engagement-letter-tracked.docx, got {ins_count}"
    );
    assert!(
        del_count >= 2,
        "expected >= 2 tracked deletions in engagement-letter-tracked.docx, got {del_count}"
    );

    let total = ins_count + del_count;
    assert!(
        total >= 4,
        "expected >= 4 total tracked revisions in engagement-letter-tracked.docx, got {total}"
    );
}

// ---------------------------------------------------------------------------
// contract-services-agreement.docx
// Must be a valid package with at least one editable paragraph.
// ---------------------------------------------------------------------------

#[test]
fn services_agreement_is_valid_docx_with_content() {
    let path = corpus_path("contract-services-agreement.docx");
    assert!(path.exists(), "fixture missing: {:?}", path);

    let bytes = std::fs::read(&path).expect("read contract-services-agreement.docx");
    let pkg = Package::read_from_bytes(&bytes).expect("services agreement is a valid zip");
    let report = validate_package(&pkg);
    assert!(
        report.ok(),
        "contract-services-agreement.docx failed validation: {:?}",
        report.errors
    );

    let opened = open_docx_bytes(&bytes).expect("open services agreement");
    let para_count = opened
        .document
        .body
        .iter()
        .filter(|b| matches!(b, lantern_docx::BlockContent::Paragraph(_)))
        .count();
    assert!(
        para_count >= 5,
        "expected >= 5 paragraphs (one per clause) in services-agreement.docx, got {para_count}"
    );
}

// ---------------------------------------------------------------------------
// Müller — Schäfer engagement (draft 2).docx
// Unicode filename + spaces + parens: must parse without error.
// ---------------------------------------------------------------------------

#[test]
fn unicode_filename_docx_parses_cleanly() {
    let path = corpus_path("Müller — Schäfer engagement (draft 2).docx");
    assert!(path.exists(), "fixture missing: {:?}", path);

    let bytes = std::fs::read(&path).expect("read unicode-filename docx");
    let pkg = Package::read_from_bytes(&bytes).expect("unicode docx is a valid zip");
    let report = validate_package(&pkg);
    assert!(
        report.ok(),
        "unicode engagement letter failed validation: {:?}",
        report.errors
    );

    let opened = open_docx_bytes(&bytes).expect("open unicode docx");
    let para_count = opened
        .document
        .body
        .iter()
        .filter(|b| matches!(b, lantern_docx::BlockContent::Paragraph(_)))
        .count();
    assert!(para_count >= 1, "unicode docx must have at least one paragraph");
}

// ---------------------------------------------------------------------------
// empty.docx — zero-byte file.
// Must fail to parse (not panic — the engine must return Err, not crash).
// ---------------------------------------------------------------------------

#[test]
fn empty_docx_fails_gracefully_not_panic() {
    let path = corpus_path("empty.docx");
    assert!(path.exists(), "fixture missing: {:?}", path);

    let bytes = std::fs::read(&path).expect("read empty.docx");
    assert_eq!(bytes.len(), 0, "empty.docx must be zero bytes");

    // Engine must return an error, not panic.
    let result = parse_docx_bytes(&bytes);
    assert!(
        result.is_err(),
        "parse_docx_bytes should return Err for a zero-byte file, got Ok"
    );
}

// ---------------------------------------------------------------------------
// matter-b-acme/intake-memo-acme.docx
// Must be distinct from Johnson matter (content check).
// ---------------------------------------------------------------------------

#[test]
fn matter_b_acme_intake_memo_is_distinct_from_johnson() {
    let path = corpus_path("matter-b-acme/intake-memo-acme.docx");
    assert!(path.exists(), "fixture missing: {:?}", path);

    let bytes = std::fs::read(&path).expect("read intake-memo-acme.docx");
    let pkg = Package::read_from_bytes(&bytes).expect("acme intake memo is a valid zip");
    let report = validate_package(&pkg);
    assert!(report.ok(), "acme intake memo failed validation: {:?}", report.errors);

    // Verify the document.xml contains "Acme" but NOT "Johnson" (distinct matter)
    let doc_xml = pkg.get_str("word/document.xml").expect("document.xml present");
    assert!(
        doc_xml.contains("Acme"),
        "matter-b intake memo must contain 'Acme'"
    );
    assert!(
        !doc_xml.contains("Johnson"),
        "matter-b intake memo must NOT contain 'Johnson' (cross-matter isolation)"
    );
}
