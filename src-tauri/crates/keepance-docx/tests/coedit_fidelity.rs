//! Task 12 — fidelity gate + w:id single-writer allocation
//!
//! Two complementary tests:
//!
//!   **TEST W_ID** — when a `Document` contains tracked revisions whose
//!   `RevisionMeta.id` is the empty string `""` (the placeholder `yDocToDocumentJson`
//!   emits for revisions authored by the CRDT so serialize is the single w:id
//!   allocator), `serialize` must replace every empty id with a DISTINCT, non-empty,
//!   numeric id.  If ids are already non-empty they must be left untouched.
//!
//!   **TEST FIDELITY** — a full co-edit simulation:
//!     1. Start from a document that has a tracked change, a comment, and an
//!        unmodeled part (hyperlink as Raw inline, table as Raw block).
//!     2. Parse it.
//!     3. Simulate a CRDT-sourced co-edit: add two tracked insertions with EMPTY
//!        meta.id (what `yDocToDocumentJson` emits).
//!     4. Serialize (single-writer) → re-parse.
//!     5. Assert:
//!        a. The co-edit insertions are present.
//!        b. The COMMENT is still present (not dropped).
//!        c. Unmodeled parts preserved (hyperlink Raw inline + Raw block table).
//!        d. Every tracked revision has a UNIQUE non-empty `w:id`.
//!        e. The package is structurally valid.
//!
//!   The real-Microsoft-Word open-without-repair check is Jameson's native item
//!   (cannot be automated here).

use keepance_docx::model::{BlockContent, Inline, Paragraph, RevisionMeta, Run};
use keepance_docx::package::Package;
use keepance_docx::validate::validate_package;
use keepance_docx::{open_docx_bytes, parse_docx_bytes, serialize_docx_bytes, Document};
use std::collections::BTreeMap;

// ---------------------------------------------------------------------------
// Helpers — build a rich fixture with tracked change + comment + unmodeled parts
// ---------------------------------------------------------------------------

/// Build a .docx package that contains:
///   - A paragraph with a tracked insertion (id "1") and a comment anchor
///   - A `<w:hyperlink>` preserved as a Raw inline (unmodeled element)
///   - A `<w:tbl>` preserved as a Raw block  (unmodeled block)
///   - A comment in comments.xml
/// This is the starting document for the co-edit simulation.
fn rich_coedited_package_bytes() -> Vec<u8> {
    let document_xml = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<w:body>
<w:p>
  <w:ins w:id="1" w:author="Attorney A" w:date="2026-06-12T00:00:00Z">
    <w:r><w:t>original tracked insertion</w:t></w:r>
  </w:ins>
  <w:commentRangeStart w:id="1"/>
  <w:r><w:t>commented text</w:t></w:r>
  <w:commentRangeEnd w:id="1"/>
  <w:r><w:rPr><w:rStyle w:val="CommentReference"/></w:rPr><w:commentReference w:id="1"/></w:r>
  <w:hyperlink r:id="rId99"><w:r><w:t>link text</w:t></w:r></w:hyperlink>
</w:p>
<w:tbl><w:tblPr/><w:tr><w:tc><w:p><w:r><w:t>table cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
<w:sectPr/>
</w:body>
</w:document>"#;

    let comments_xml = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:comments xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:comment w:id="1" w:author="Attorney A" w:date="2026-06-12T00:00:00Z" w:initials="AA">
<w:p><w:r><w:t>Please review this clause carefully.</w:t></w:r></w:p>
</w:comment>
</w:comments>"#;

    let content_types = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/>
</Types>"#;

    let root_rels = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>"#;

    let doc_rels = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="comments.xml"/>
</Relationships>"#;

    let mut pkg = Package::new();
    pkg.insert("[Content_Types].xml", content_types.as_bytes().to_vec());
    pkg.insert("_rels/.rels", root_rels.as_bytes().to_vec());
    pkg.insert("word/_rels/document.xml.rels", doc_rels.as_bytes().to_vec());
    pkg.insert("word/document.xml", document_xml.as_bytes().to_vec());
    pkg.insert("word/comments.xml", comments_xml.as_bytes().to_vec());
    pkg.write_to_bytes().expect("zip rich co-edit fixture")
}

// ---------------------------------------------------------------------------
// TEST W_ID — empty meta.id gets a fresh distinct non-empty id at serialize
// ---------------------------------------------------------------------------

/// Build a Document with two tracked insertions and one deletion, all with
/// EMPTY meta.id — the placeholder yDocToDocumentJson emits.
fn doc_with_empty_ids() -> Document {
    let para = Paragraph::from_inlines(vec![
        Inline::Run(Run::new("plain text ")),
        Inline::Insertion {
            meta: RevisionMeta {
                id: "".into(),           // EMPTY — CRDT placeholder
                author: "attorney-a".into(),
                date: "2026-06-12T00:00:00Z".into(),
            },
            runs: vec![Run::new("first co-edit insertion")],
        },
        Inline::Deletion {
            meta: RevisionMeta {
                id: "".into(),           // EMPTY — CRDT placeholder
                author: "attorney-b".into(),
                date: "2026-06-12T00:01:00Z".into(),
            },
            runs: vec![Run::new("deleted text")],
        },
        Inline::Insertion {
            meta: RevisionMeta {
                id: "".into(),           // EMPTY — third empty id
                author: "attorney-a".into(),
                date: "2026-06-12T00:02:00Z".into(),
            },
            runs: vec![Run::new("second co-edit insertion")],
        },
    ]);
    Document {
        format_version: keepance_docx::model::DOM_FORMAT_VERSION,
        body: vec![BlockContent::Paragraph(para)],
        comments: BTreeMap::new(),
    }
}

#[test]
fn test_wid_empty_ids_become_distinct_nonempty_after_serialize() {
    let doc = doc_with_empty_ids();

    // All ids are empty before serialize.
    let revs_before = doc.revisions();
    assert!(
        revs_before.iter().all(|(m, _, _)| m.id.is_empty()),
        "precondition: all ids must be empty before serialize"
    );
    assert_eq!(revs_before.len(), 3, "expected 3 revisions");

    // Serialize to .docx and re-parse.
    let bytes = serialize_docx_bytes(&doc).expect("serialize doc with empty ids");
    let reparsed = parse_docx_bytes(&bytes).expect("reparse after serialize");

    let revs_after = reparsed.revisions();
    assert_eq!(revs_after.len(), 3, "all three revisions must survive serialize");

    // Every id must be NON-EMPTY after serialize.
    for (meta, kind, _) in &revs_after {
        assert!(
            !meta.id.is_empty(),
            "revision {:?} still has empty id after serialize — allocator not running",
            kind
        );
    }

    // Every id must be DISTINCT (Word groups accept/reject by id; collisions would merge
    // unrelated edits).
    let mut ids: Vec<_> = revs_after.iter().map(|(m, _, _)| m.id.clone()).collect();
    ids.sort();
    ids.dedup();
    assert_eq!(
        ids.len(),
        3,
        "ids are not distinct after serialize — allocator produced collisions: {:?}",
        revs_after.iter().map(|(m, _, _)| &m.id).collect::<Vec<_>>()
    );

    // All ids must be valid positive integers (w:id is xsd:integer in OOXML).
    for (meta, _, _) in &revs_after {
        let n: u64 = meta.id.parse().unwrap_or_else(|_| {
            panic!("id {:?} is not a valid non-negative integer", meta.id)
        });
        assert!(n > 0, "id must be > 0 (OOXML w:id is 1-based), got {n}");
    }

    // The serialized document.xml must NOT contain w:id="" (would make Word treat
    // the file as corrupt).
    let pkg = Package::read_from_bytes(&bytes).unwrap();
    let doc_xml = pkg.get_str("word/document.xml").unwrap();
    assert!(
        !doc_xml.contains("w:id=\"\""),
        "serialized XML still contains empty w:id attribute — allocator did not run"
    );
}

/// Revision ids that are ALREADY non-empty must pass through UNCHANGED (the
/// allocator must only replace empty/placeholder ids, not reassign existing ones).
#[test]
fn test_wid_nonempty_ids_are_preserved_unchanged() {
    let para = Paragraph::from_inlines(vec![
        Inline::Insertion {
            meta: RevisionMeta {
                id: "42".into(),   // already assigned
                author: "c".into(),
                date: "2026-06-12T00:00:00Z".into(),
            },
            runs: vec![Run::new("existing")],
        },
        Inline::Deletion {
            meta: RevisionMeta {
                id: "".into(),     // empty — should be assigned a fresh id != "42"
                author: "c".into(),
                date: "2026-06-12T00:00:00Z".into(),
            },
            runs: vec![Run::new("deleted")],
        },
    ]);
    let doc = Document {
        format_version: keepance_docx::model::DOM_FORMAT_VERSION,
        body: vec![BlockContent::Paragraph(para)],
        comments: BTreeMap::new(),
    };

    let bytes = serialize_docx_bytes(&doc).expect("serialize");
    let reparsed = parse_docx_bytes(&bytes).expect("reparse");
    let revs = reparsed.revisions();
    assert_eq!(revs.len(), 2);

    // The insertion that had id "42" must still be "42".
    let ins = revs
        .iter()
        .find(|(_, k, runs)| *k == keepance_docx::model::RevisionKind::Insertion && runs.iter().any(|r| r.text == "existing"))
        .expect("insertion present");
    assert_eq!(ins.0.id, "42", "pre-assigned id must not be overwritten");

    // The deletion that had empty id must get a fresh id that is != "42" and != "".
    let del = revs
        .iter()
        .find(|(_, k, runs)| *k == keepance_docx::model::RevisionKind::Deletion && runs.iter().any(|r| r.text == "deleted"))
        .expect("deletion present");
    assert!(!del.0.id.is_empty(), "empty id must be filled in");
    assert_ne!(del.0.id, "42", "fresh id must not collide with existing id 42");
}

// ---------------------------------------------------------------------------
// TEST FIDELITY — full co-edit round-trip
// ---------------------------------------------------------------------------

#[test]
fn test_fidelity_coedit_roundtrip() {
    // Step 1+2: open the rich fixture (tracked change + comment + unmodeled parts).
    let original = rich_coedited_package_bytes();
    let mut opened = open_docx_bytes(&original).expect("open rich co-edit fixture");

    // Confirm the fixture parsed: should have the original insertion (id "1") and
    // the comment (id "1").
    let revs_before = opened.document.revisions();
    assert_eq!(revs_before.len(), 1, "fixture should have 1 tracked revision");
    assert_eq!(revs_before[0].0.id, "1");
    assert!(
        opened.document.comments.contains_key("1"),
        "fixture comment must be present after parse"
    );

    // Verify the unmodeled parts parsed to Raw nodes.
    let has_hyperlink = opened.document.body.iter().any(|b| match b {
        BlockContent::Paragraph(p) => p.inlines.iter().any(|i| {
            matches!(i, Inline::Raw { xml } if xml.contains("hyperlink"))
        }),
        _ => false,
    });
    assert!(has_hyperlink, "hyperlink must be captured as Raw inline");

    let has_table = opened.document.body.iter().any(|b| {
        matches!(b, BlockContent::Raw { xml } if xml.contains("<w:tbl"))
    });
    assert!(has_table, "table must be captured as Raw block");

    // Step 3: simulate co-edit — add TWO tracked insertions from the CRDT with
    // EMPTY meta.id (what yDocToDocumentJson emits; serialize is the allocator).
    // We add them to the first paragraph.
    let first_para_idx = opened
        .document
        .body
        .iter()
        .position(|b| matches!(b, BlockContent::Paragraph(_)))
        .expect("at least one paragraph");

    if let BlockContent::Paragraph(p) = &mut opened.document.body[first_para_idx] {
        p.inlines.push(Inline::Insertion {
            meta: RevisionMeta {
                id: "".into(),       // CRDT placeholder — empty
                author: "attorney-b".into(),
                date: "2026-06-12T10:00:00Z".into(),
            },
            runs: vec![Run::new(" co-edit A")],
        });
        p.inlines.push(Inline::Insertion {
            meta: RevisionMeta {
                id: "".into(),       // CRDT placeholder — empty
                author: "attorney-c".into(),
                date: "2026-06-12T10:01:00Z".into(),
            },
            runs: vec![Run::new(" co-edit B")],
        });
    }

    // Step 4: serialize (single-writer; w:id allocator runs here).
    let saved = opened.save_bytes().expect("save after co-edit");

    // Validate the package is structurally well-formed.
    let saved_pkg = Package::read_from_bytes(&saved).unwrap();
    let report = validate_package(&saved_pkg);
    assert!(
        report.ok(),
        "saved co-edit package is structurally invalid: {:?}",
        report.errors
    );

    // Re-parse.
    let reparsed = parse_docx_bytes(&saved).expect("reparse saved co-edit");

    // Step 5a: co-edit insertions are present.
    let reparsed_revs = reparsed.revisions();
    assert_eq!(
        reparsed_revs.len(),
        3,
        "expected 3 revisions after co-edit (1 original + 2 CRDT): got {} — {:?}",
        reparsed_revs.len(),
        reparsed_revs.iter().map(|(m, k, _)| (m.id.as_str(), k)).collect::<Vec<_>>()
    );
    assert!(
        reparsed_revs.iter().any(|(_, _, runs)| runs.iter().any(|r| r.text.contains("co-edit A"))),
        "co-edit A insertion missing after round-trip"
    );
    assert!(
        reparsed_revs.iter().any(|(_, _, runs)| runs.iter().any(|r| r.text.contains("co-edit B"))),
        "co-edit B insertion missing after round-trip"
    );

    // Step 5b: COMMENT is still present (critical — CRDT does not model comments
    // but serialize must preserve them; the original package's comments.xml is
    // passed through since the comment set was not changed).
    assert!(
        reparsed.comments.contains_key("1"),
        "COMMENT WAS DROPPED after co-edit serialize — comments must be preserved"
    );
    let c = &reparsed.comments["1"];
    assert_eq!(c.author, "Attorney A");
    assert!(c.text.contains("Please review"), "comment text changed");

    // Also check that comments.xml is present in the saved package.
    let doc_xml = saved_pkg.get_str("word/document.xml").unwrap();
    // Comment range markers must still be in the body.
    assert!(
        doc_xml.contains("commentRangeStart"),
        "commentRangeStart dropped from body after co-edit"
    );
    assert!(
        doc_xml.contains("commentRangeEnd"),
        "commentRangeEnd dropped from body after co-edit"
    );

    // Step 5c: unmodeled parts preserved.
    assert!(
        doc_xml.contains("<w:hyperlink"),
        "hyperlink Raw inline dropped after co-edit serialize"
    );
    assert!(
        doc_xml.contains("<w:tbl"),
        "table Raw block dropped after co-edit serialize"
    );

    // Step 5d: every tracked revision has a UNIQUE non-empty w:id.
    // First: no empty w:id in the raw XML.
    assert!(
        !doc_xml.contains("w:id=\"\""),
        "serialized XML still contains empty w:id — allocator did not run"
    );

    // Second: check the parsed model ids are distinct and non-empty.
    let mut ids: Vec<_> = reparsed_revs.iter().map(|(m, _, _)| m.id.clone()).collect();
    for id in &ids {
        assert!(!id.is_empty(), "revision has empty id after round-trip");
        id.parse::<u64>().unwrap_or_else(|_| panic!("id {id:?} is not a valid integer"));
    }
    ids.sort();
    ids.dedup();
    assert_eq!(
        ids.len(),
        3,
        "revision ids are not all distinct after co-edit: {:?}",
        reparsed_revs.iter().map(|(m, _, _)| m.id.as_str()).collect::<Vec<_>>()
    );

    // Step 5e (note): real-Microsoft-Word open-without-repair is Jameson's
    // native check — cannot be automated here. The structural validity check
    // above (validate_package) is the machine-verifiable proxy.
}

/// Regression: a document with NO empty ids (all already assigned) must
/// serialize idempotently — the allocator must be a no-op and must not
/// change the existing ids or produce duplicate allocations.
#[test]
fn test_wid_allocator_noop_on_all_assigned_ids() {
    use keepance_docx::fixture::build_fixture_model;
    use keepance_docx::serialize_docx_bytes;

    let doc = build_fixture_model();
    // Fixture has ids "101" and "102" — both non-empty.
    let bytes1 = serialize_docx_bytes(&doc).expect("serialize 1");
    let bytes2 = serialize_docx_bytes(&doc).expect("serialize 2");
    // Idempotent — same bytes both times.
    assert_eq!(bytes1, bytes2, "serialize is not idempotent with all-assigned ids");

    let reparsed = parse_docx_bytes(&bytes1).unwrap();
    let revs = reparsed.revisions();
    let ids: Vec<_> = revs.iter().map(|(m, _, _)| m.id.as_str()).collect();
    // Ids 101 and 102 must be preserved, not renumbered.
    assert!(
        ids.contains(&"101"),
        "pre-assigned id 101 was altered by allocator: {ids:?}"
    );
    assert!(
        ids.contains(&"102"),
        "pre-assigned id 102 was altered by allocator: {ids:?}"
    );
}
