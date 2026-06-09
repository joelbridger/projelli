//! Engine-level tests for keepance-docx — the production OOXML engine.
//!
//! These are written against the public crate API and run FAST in isolation
//! (`cargo test -p keepance-docx`) — no Tauri, no lancedb, no fastembed in the
//! graph. They are the contract for the engine:
//!
//!   * existing revisions + comments survive a round-trip with author/date/text
//!     intact (TEST A),
//!   * PRESERVE-BY-DEFAULT: an unknown PART and an unknown ELEMENT both survive
//!     a round-trip (TEST P1 + P2) — the key production hardening,
//!   * the AI can author NEW well-formed revisions alongside originals (TEST B),
//!   * DOM <-> JSON is stable (TEST J),
//!   * properties (pPr/rPr) survive a round-trip (TEST PROPS).

use keepance_docx::author::{delete_run_containing, insert_at_paragraph_end, AI_AUTHOR};
use keepance_docx::fixture::{
    build_fixture_model, FIXTURE_COMMENT_ID, OPPOSING_COUNSEL, OPPOSING_DATE,
};
use keepance_docx::model::{BlockContent, Inline, RevisionKind};
use keepance_docx::package::Package;
use keepance_docx::validate::validate_package;
use keepance_docx::{
    document_from_json, document_to_json, open_docx_bytes, parse_docx_bytes, roundtrip_bytes,
    serialize_docx_bytes, Document,
};

/// Build fixture .docx bytes from the model (single source of truth).
fn fixture_bytes() -> Vec<u8> {
    serialize_docx_bytes(&build_fixture_model()).expect("serialize fixture")
}

fn count_inline(doc: &Document, pred: impl Fn(&Inline) -> bool) -> usize {
    doc.body
        .iter()
        .filter_map(|b| match b {
            BlockContent::Paragraph(p) => Some(p),
            _ => None,
        })
        .flat_map(|p| p.inlines.iter())
        .filter(|i| pred(i))
        .count()
}

// ---------------------------------------------------------------------------
// Fixture sanity
// ---------------------------------------------------------------------------

#[test]
fn fixture_is_a_structurally_valid_docx() {
    let bytes = fixture_bytes();
    let pkg = Package::read_from_bytes(&bytes).expect("fixture is a valid zip");
    let report = validate_package(&pkg);
    assert!(report.ok(), "fixture invalid: {:?}", report.errors);
}

#[test]
fn fixture_contains_existing_revisions_and_comment() {
    let doc = parse_docx_bytes(&fixture_bytes()).expect("parse fixture");
    let revs = doc.revisions();
    let ins: Vec<_> = revs
        .iter()
        .filter(|(_, k, _)| *k == RevisionKind::Insertion)
        .collect();
    let del: Vec<_> = revs
        .iter()
        .filter(|(_, k, _)| *k == RevisionKind::Deletion)
        .collect();
    assert_eq!(ins.len(), 1);
    assert_eq!(del.len(), 1);
    assert_eq!(ins[0].0.author, OPPOSING_COUNSEL);
    assert_eq!(del[0].0.author, OPPOSING_COUNSEL);
    let c = doc.comments.get(FIXTURE_COMMENT_ID).expect("comment present");
    assert_eq!(c.author, OPPOSING_COUNSEL);
    assert!(c.text.contains("disputes"));
}

// ---------------------------------------------------------------------------
// TEST A — existing revisions + comments survive round-trip (author/date/text)
// ---------------------------------------------------------------------------

#[test]
fn test_a_roundtrip_preserves_revisions_and_comment() {
    let original = fixture_bytes();
    let round1 = roundtrip_bytes(&original).expect("roundtrip 1");

    let pkg = Package::read_from_bytes(&round1).expect("round1 valid zip");
    assert!(
        validate_package(&pkg).ok(),
        "round-trip output invalid: {:?}",
        validate_package(&pkg).errors
    );

    let doc = parse_docx_bytes(&round1).expect("parse round1");
    let revs = doc.revisions();

    let ins = revs
        .iter()
        .find(|(_, k, _)| *k == RevisionKind::Insertion)
        .expect("insertion survived");
    assert_eq!(ins.0.author, OPPOSING_COUNSEL);
    assert_eq!(ins.0.date, OPPOSING_DATE);
    assert_eq!(
        ins.2.iter().map(|r| r.text.as_str()).collect::<String>(),
        "promptly "
    );

    let del = revs
        .iter()
        .find(|(_, k, _)| *k == RevisionKind::Deletion)
        .expect("deletion survived");
    assert_eq!(del.0.author, OPPOSING_COUNSEL);
    assert_eq!(del.0.date, OPPOSING_DATE);
    assert_eq!(
        del.2.iter().map(|r| r.text.as_str()).collect::<String>(),
        "minor "
    );

    let c = doc.comments.get(FIXTURE_COMMENT_ID).expect("comment survived");
    assert_eq!(c.author, OPPOSING_COUNSEL);
    assert_eq!(c.date, OPPOSING_DATE);
    assert_eq!(c.text, "Define the scope of disputes covered.");
    assert_eq!(c.initials.as_deref(), Some("OC"));

    // Idempotence: second round-trip is byte-identical (stable diffs / version
    // history).
    let round2 = roundtrip_bytes(&round1).expect("roundtrip 2");
    assert_eq!(round1, round2, "serialization not idempotent");

    // Balanced comment anchor.
    assert_eq!(
        count_inline(&doc, |i| matches!(i, Inline::CommentRangeStart { .. })),
        1
    );
    assert_eq!(
        count_inline(&doc, |i| matches!(i, Inline::CommentRangeEnd { .. })),
        1
    );
    assert_eq!(
        count_inline(&doc, |i| matches!(i, Inline::CommentReference { .. })),
        1
    );
}

// ---------------------------------------------------------------------------
// TEST PROPS — paragraph + run properties survive a round-trip
// ---------------------------------------------------------------------------

#[test]
fn test_props_paragraph_and_run_properties_survive() {
    let doc = parse_docx_bytes(&roundtrip_bytes(&fixture_bytes()).unwrap()).unwrap();
    let para = match &doc.body[0] {
        BlockContent::Paragraph(p) => p,
        _ => panic!("expected paragraph"),
    };
    // Paragraph style preserved.
    assert!(
        para.properties_xml
            .as_deref()
            .unwrap_or("")
            .contains("BodyText"),
        "paragraph pStyle lost: {:?}",
        para.properties_xml
    );
    // The first run's bold rPr preserved.
    let first_run_rpr = para.inlines.iter().find_map(|i| match i {
        Inline::Run(r) => r.properties_xml.clone(),
        _ => None,
    });
    assert!(
        first_run_rpr.as_deref().unwrap_or("").contains("<w:b"),
        "run bold rPr lost: {first_run_rpr:?}"
    );
}

// ---------------------------------------------------------------------------
// PRESERVE-BY-DEFAULT — the key production hardening.
// Build a real .docx that has (1) parts we do NOT model and (2) elements inside
// document.xml we do NOT model, then prove both survive a full round-trip.
// ---------------------------------------------------------------------------

/// Hand-build a package with: a normal modeled paragraph, an UNKNOWN inline
/// element (a hyperlink with a nested run), an UNKNOWN block element (a table),
/// preserved pPr/rPr, AND unknown parts (styles.xml, numbering.xml, a customXml
/// part, theme, media bytes).
fn build_rich_package_bytes() -> Vec<u8> {
    // NOTE: namespaces use the `w` prefix the engine matches on local names for.
    let document_xml = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="3"/></w:numPr></w:pPr><w:r><w:rPr><w:b/><w:color w:val="FF0000"/></w:rPr><w:t xml:space="preserve">Lead text </w:t></w:r><w:hyperlink r:id="rId99" w:history="1"><w:r><w:rPr><w:rStyle w:val="Hyperlink"/></w:rPr><w:t>click here</w:t></w:r></w:hyperlink><w:bookmarkStart w:id="7" w:name="mark"/><w:r><w:t xml:space="preserve"> tail.</w:t></w:r><w:bookmarkEnd w:id="7"/></w:p><w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/></w:tblPr><w:tr><w:tc><w:p><w:r><w:t>cell A</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>cell B</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr></w:body></w:document>"#;

    let content_types = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/></Types>"#;

    let root_rels = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>"#;

    let doc_rels = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/></Relationships>"#;

    // UNKNOWN parts the engine does not model — must survive byte-for-byte.
    let styles_xml = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style></w:styles>"#;
    let numbering_xml = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:num w:numId="3"><w:abstractNumId w:val="0"/></w:num></w:numbering>"#;
    let custom_xml = r#"<?xml version="1.0"?><customData><secret>do-not-lose-me</secret></customData>"#;
    let theme_xml = r#"<?xml version="1.0"?><a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="X"/>"#;
    // A binary media part — must survive byte-identical (proves we don't mangle
    // non-XML parts).
    let png_bytes: Vec<u8> = vec![0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x01, 0x02, 0x03];

    let mut pkg = Package::new();
    pkg.insert("[Content_Types].xml", content_types.as_bytes().to_vec());
    pkg.insert("_rels/.rels", root_rels.as_bytes().to_vec());
    pkg.insert("word/_rels/document.xml.rels", doc_rels.as_bytes().to_vec());
    pkg.insert("word/document.xml", document_xml.as_bytes().to_vec());
    pkg.insert("word/styles.xml", styles_xml.as_bytes().to_vec());
    pkg.insert("word/numbering.xml", numbering_xml.as_bytes().to_vec());
    pkg.insert("customXml/item1.xml", custom_xml.as_bytes().to_vec());
    pkg.insert("word/theme/theme1.xml", theme_xml.as_bytes().to_vec());
    pkg.insert("word/media/image1.png", png_bytes);

    pkg.write_to_bytes().expect("zip rich package")
}

#[test]
fn test_p1_unknown_parts_survive_roundtrip_byte_for_byte() {
    let original = build_rich_package_bytes();
    let original_pkg = Package::read_from_bytes(&original).unwrap();

    // Round-trip through the engine (open -> save), which re-serializes
    // document.xml but must pass every other part through untouched.
    let round = roundtrip_bytes(&original).expect("roundtrip rich");
    let round_pkg = Package::read_from_bytes(&round).expect("round is valid zip");

    // Every unknown part is present and byte-identical.
    for part in [
        "word/styles.xml",
        "word/numbering.xml",
        "customXml/item1.xml",
        "word/theme/theme1.xml",
        "word/media/image1.png",
        "_rels/.rels",
        "word/_rels/document.xml.rels",
        "[Content_Types].xml",
    ] {
        let before = original_pkg.get(part).unwrap_or_else(|| panic!("setup missing {part}"));
        let after = round_pkg
            .get(part)
            .unwrap_or_else(|| panic!("PART LOST on round-trip: {part}"));
        assert_eq!(
            before, after,
            "part {part} changed on round-trip (preserve-by-default violated)"
        );
    }
    // The custom secret is still in there.
    assert!(
        round_pkg
            .get_str("customXml/item1.xml")
            .unwrap()
            .contains("do-not-lose-me"),
        "custom XML content lost"
    );
}

#[test]
fn test_p2_unknown_elements_survive_roundtrip() {
    let original = build_rich_package_bytes();

    // Parse: the hyperlink, bookmark markers, and table are unmodeled and must
    // be captured as Raw nodes.
    let doc = parse_docx_bytes(&original).expect("parse rich");

    // The body has the modeled paragraph + the unmodeled table (Raw block) +
    // the sectPr (Raw block).
    let has_raw_block = doc
        .body
        .iter()
        .any(|b| matches!(b, BlockContent::Raw { xml } if xml.contains("<w:tbl")));
    assert!(has_raw_block, "table block was not preserved as Raw");

    // The paragraph kept its unknown inline elements as Raw.
    let para = doc
        .body
        .iter()
        .find_map(|b| match b {
            BlockContent::Paragraph(p) => Some(p),
            _ => None,
        })
        .expect("a paragraph");
    let has_hyperlink = para
        .inlines
        .iter()
        .any(|i| matches!(i, Inline::Raw { xml } if xml.contains("<w:hyperlink")));
    assert!(has_hyperlink, "hyperlink inline was not preserved as Raw");
    let has_bookmark = para
        .inlines
        .iter()
        .any(|i| matches!(i, Inline::Raw { xml } if xml.contains("bookmark")));
    assert!(has_bookmark, "bookmark markers were not preserved");

    // Now round-trip and assert the SERIALIZED document.xml still contains the
    // unknown markup with its content intact.
    let round = roundtrip_bytes(&original).expect("roundtrip rich");
    let round_pkg = Package::read_from_bytes(&round).unwrap();
    let doc_xml = round_pkg.get_str("word/document.xml").unwrap();

    for needle in [
        "<w:hyperlink",
        "r:id=\"rId99\"",          // hyperlink relationship id preserved
        "click here",               // hyperlink inner text preserved
        "<w:tbl>",                  // table preserved
        "cell A",                   // table cell text preserved
        "cell B",
        "bookmarkStart",            // bookmark markers preserved
        "bookmarkEnd",
        "w:name=\"mark\"",          // bookmark name preserved
        "<w:numPr>",                // paragraph numbering preserved
        "w:numId w:val=\"3\"",      // numbering id preserved
        "Heading1",                 // paragraph style preserved
        "FF0000",                   // run color preserved
        "<w:sectPr>",               // section properties preserved
        "Lead text ",               // modeled run text preserved with space
        " tail.",
    ] {
        assert!(
            doc_xml.contains(needle),
            "preserve-by-default lost {needle:?} from document.xml on round-trip"
        );
    }

    // And the output is still a structurally valid, well-formed package.
    assert!(
        validate_package(&round_pkg).ok(),
        "round-tripped rich doc invalid: {:?}",
        validate_package(&round_pkg).errors
    );
}

// ---------------------------------------------------------------------------
// TEST B — authoring: AI adds NEW revisions alongside the originals
// ---------------------------------------------------------------------------

#[test]
fn test_b_ai_authored_revisions_appear_alongside_originals() {
    const AI_DATE: &str = "2026-06-09T12:00:00Z";

    let mut doc = build_fixture_model();
    assert_eq!(doc.revisions().len(), 2);

    let ins_id = insert_at_paragraph_end(&mut doc, 0, " Time is of the essence.", AI_AUTHOR, AI_DATE)
        .expect("paragraph exists");
    let del_id = delete_run_containing(&mut doc, 0, "resolve all ", AI_AUTHOR, AI_DATE)
        .expect("found a run to delete");
    assert_ne!(ins_id, del_id, "new revisions must get distinct ids");

    // Serialize from scratch, validate, re-parse.
    let bytes = serialize_docx_bytes(&doc).expect("serialize authored");
    let pkg = Package::read_from_bytes(&bytes).unwrap();
    assert!(
        validate_package(&pkg).ok(),
        "authored doc invalid: {:?}",
        validate_package(&pkg).errors
    );

    let reparsed = parse_docx_bytes(&bytes).expect("reparse authored");
    let revs = reparsed.revisions();
    assert_eq!(revs.len(), 4, "expected originals + new revisions");

    assert!(revs.iter().any(|(m, k, runs)| *k == RevisionKind::Insertion
        && m.author == OPPOSING_COUNSEL
        && runs.iter().any(|r| r.text == "promptly ")));
    assert!(revs.iter().any(|(m, k, runs)| *k == RevisionKind::Deletion
        && m.author == OPPOSING_COUNSEL
        && runs.iter().any(|r| r.text == "minor ")));

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

    // Original comment untouched.
    assert!(reparsed.comments.contains_key(FIXTURE_COMMENT_ID));

    // All four ids unique (Word groups accept/reject by id).
    let mut ids: Vec<_> = revs.iter().map(|(m, _, _)| m.id.clone()).collect();
    ids.sort();
    ids.dedup();
    assert_eq!(ids.len(), 4, "revision ids collided: {ids:?}");
}

#[test]
fn test_b2_authoring_preserves_unknown_parts() {
    // Authoring on a rich imported doc must not drop its unknown parts: open ->
    // edit DOM -> save through OpenedDocument (the production save path).
    const AI_DATE: &str = "2026-06-09T12:00:00Z";
    let original = build_rich_package_bytes();
    let mut opened = open_docx_bytes(&original).expect("open rich");

    // Add a tracked insertion to the first paragraph.
    let id = insert_at_paragraph_end(&mut opened.document, 0, " inserted by AI", AI_AUTHOR, AI_DATE)
        .expect("first paragraph exists");
    assert!(!id.is_empty());

    let saved = opened.save_bytes().expect("save rich");
    let saved_pkg = Package::read_from_bytes(&saved).unwrap();

    // Unknown parts still present + identical.
    let orig_pkg = Package::read_from_bytes(&original).unwrap();
    for part in ["word/styles.xml", "word/numbering.xml", "customXml/item1.xml", "word/media/image1.png"] {
        assert_eq!(
            orig_pkg.get(part),
            saved_pkg.get(part),
            "authoring lost/changed unknown part {part}"
        );
    }
    // New revision is in the serialized document.
    let doc_xml = saved_pkg.get_str("word/document.xml").unwrap();
    assert!(doc_xml.contains("inserted by AI"));
    assert!(doc_xml.contains(&format!("w:author=\"{AI_AUTHOR}\"")));
    // And the table + hyperlink are still there.
    assert!(doc_xml.contains("<w:tbl>"));
    assert!(doc_xml.contains("<w:hyperlink"));
}

// ---------------------------------------------------------------------------
// TEST J — DOM <-> JSON stability (the React editor bridge)
// ---------------------------------------------------------------------------

#[test]
fn test_j_dom_json_dom_is_stable() {
    // Build a document covering EVERY node variant the editor must render:
    // start from the rich doc (Paragraph + Raw block + Run-with-rPr + Raw
    // inline), then author an insertion AND a deletion so insertion/deletion
    // variants are present too.
    let mut doc = parse_docx_bytes(&build_rich_package_bytes()).expect("parse rich");
    insert_at_paragraph_end(&mut doc, 0, " added", AI_AUTHOR, "2026-06-09T00:00:00Z")
        .expect("paragraph 0 exists");
    delete_run_containing(&mut doc, 0, "Lead text ", AI_AUTHOR, "2026-06-09T00:00:00Z")
        .expect("a run to delete");

    let json = document_to_json(&doc).expect("to json");
    let back = document_from_json(&json).expect("from json");
    assert_eq!(doc, back, "DOM -> JSON -> DOM was not stable");

    // Round-trip the JSON twice: serializing the re-parsed DOM yields identical
    // JSON (stable encoding).
    let json2 = document_to_json(&back).expect("to json 2");
    assert_eq!(json, json2, "JSON encoding not stable across round-trip");

    // Spot-check the wire shape the editor will consume: tagged inline variants.
    assert!(json.contains("\"kind\":\"run\""), "missing run tag");
    assert!(json.contains("\"kind\":\"insertion\""), "missing insertion tag");
    assert!(json.contains("\"kind\":\"deletion\""), "missing deletion tag");
    assert!(json.contains("\"kind\":\"raw\""), "missing raw tag");
    assert!(
        json.contains("\"formatVersion\":1") || json.contains("\"format_version\":1"),
        "missing format version"
    );
}

/// Real Word documents are frequently pretty-printed (newlines + indentation
/// between elements). Our span-capture parser must handle that: unmodeled
/// elements and properties must still be captured correctly, and modeled text
/// must not absorb structural whitespace. This guards the byte-position logic
/// against the spacing variety we'll see in the wild.
#[test]
fn test_indented_document_xml_roundtrips() {
    let document_xml = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n<w:document xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\">\n  <w:body>\n    <w:p>\n      <w:pPr>\n        <w:pStyle w:val=\"Quote\"/>\n      </w:pPr>\n      <w:r>\n        <w:rPr><w:i/></w:rPr>\n        <w:t xml:space=\"preserve\">Indented text </w:t>\n      </w:r>\n      <w:ins w:id=\"5\" w:author=\"Counsel\" w:date=\"2026-02-01T00:00:00Z\">\n        <w:r><w:t>added clause</w:t></w:r>\n      </w:ins>\n      <w:hyperlink r:id=\"rId10\" xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\">\n        <w:r><w:t>link</w:t></w:r>\n      </w:hyperlink>\n    </w:p>\n    <w:sectPr><w:pgSz w:w=\"12240\" w:h=\"15840\"/></w:sectPr>\n  </w:body>\n</w:document>";

    let content_types = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\"><Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/><Default Extension=\"xml\" ContentType=\"application/xml\"/><Override PartName=\"/word/document.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml\"/></Types>";
    let root_rels = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"><Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" Target=\"word/document.xml\"/></Relationships>";

    let mut pkg = Package::new();
    pkg.insert("[Content_Types].xml", content_types.as_bytes().to_vec());
    pkg.insert("_rels/.rels", root_rels.as_bytes().to_vec());
    pkg.insert("word/document.xml", document_xml.as_bytes().to_vec());
    let bytes = pkg.write_to_bytes().unwrap();

    // Parse: insertion modeled; hyperlink preserved as Raw; rPr/pPr preserved.
    let doc = parse_docx_bytes(&bytes).expect("parse indented");
    assert_eq!(doc.revisions().len(), 1, "insertion parsed");
    let para = doc
        .body
        .iter()
        .find_map(|b| match b {
            BlockContent::Paragraph(p) => Some(p),
            _ => None,
        })
        .unwrap();
    assert!(para.properties_xml.as_deref().unwrap_or("").contains("Quote"));
    assert!(para
        .inlines
        .iter()
        .any(|i| matches!(i, Inline::Raw { xml } if xml.contains("hyperlink"))));
    // Modeled text run kept its trailing space exactly.
    assert!(para.inlines.iter().any(|i| matches!(
        i,
        Inline::Run(r) if r.text == "Indented text " && r.properties_xml.as_deref().unwrap_or("").contains("<w:i")
    )));

    // Round-trip stays well-formed + valid and keeps the preserved content.
    let round = roundtrip_bytes(&bytes).expect("roundtrip indented");
    let round_pkg = Package::read_from_bytes(&round).unwrap();
    assert!(
        validate_package(&round_pkg).ok(),
        "indented round-trip invalid: {:?}",
        validate_package(&round_pkg).errors
    );
    let out_xml = round_pkg.get_str("word/document.xml").unwrap();
    for needle in ["<w:hyperlink", "r:id=\"rId10\"", "link", "added clause", "Quote", "Indented text "] {
        assert!(out_xml.contains(needle), "lost {needle:?} from indented doc");
    }
}

#[test]
fn test_j2_fixture_dom_json_dom_stable() {
    // Also cover the fixture DOM (comments + properties) explicitly.
    let doc = build_fixture_model();
    let json = document_to_json(&doc).unwrap();
    let back = document_from_json(&json).unwrap();
    assert_eq!(doc, back);
}

/// A comment with a RICH body (two paragraphs, a formatted run) must survive a
/// round-trip with its inner structure intact, and its plain text must flatten
/// correctly for display. Exercises `body_xml` capture + re-emission.
#[test]
fn test_rich_comment_body_is_preserved() {
    let document_xml = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:commentRangeStart w:id="1"/><w:r><w:t>clause</w:t></w:r><w:commentRangeEnd w:id="1"/><w:r><w:rPr><w:rStyle w:val="CommentReference"/></w:rPr><w:commentReference w:id="1"/></w:r></w:p></w:body></w:document>"#;
    let comments_xml = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:comments xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:comment w:id="1" w:author="Reviewer" w:date="2026-03-01T00:00:00Z" w:initials="RV"><w:p><w:r><w:rPr><w:b/></w:rPr><w:t>First line.</w:t></w:r></w:p><w:p><w:r><w:t xml:space="preserve">Second line with detail.</w:t></w:r></w:p></w:comment></w:comments>"#;
    let content_types = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/></Types>"#;
    let root_rels = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>"#;
    let doc_rels = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="comments.xml"/></Relationships>"#;

    let mut pkg = Package::new();
    pkg.insert("[Content_Types].xml", content_types.as_bytes().to_vec());
    pkg.insert("_rels/.rels", root_rels.as_bytes().to_vec());
    pkg.insert("word/_rels/document.xml.rels", doc_rels.as_bytes().to_vec());
    pkg.insert("word/document.xml", document_xml.as_bytes().to_vec());
    pkg.insert("word/comments.xml", comments_xml.as_bytes().to_vec());
    let bytes = pkg.write_to_bytes().unwrap();

    // Parse: comment metadata + flattened text correct.
    let doc = parse_docx_bytes(&bytes).expect("parse rich comment");
    let c = doc.comments.get("1").expect("comment present");
    assert_eq!(c.author, "Reviewer");
    assert_eq!(c.initials.as_deref(), Some("RV"));
    assert!(c.text.contains("First line."));
    assert!(c.text.contains("Second line with detail."));

    // Round-trip: the rich body (two paragraphs, the bold run) survives.
    let round = roundtrip_bytes(&bytes).expect("roundtrip rich comment");
    let round_pkg = Package::read_from_bytes(&round).unwrap();
    assert!(
        validate_package(&round_pkg).ok(),
        "rich-comment round-trip invalid: {:?}",
        validate_package(&round_pkg).errors
    );
    let out_comments = round_pkg.get_str("word/comments.xml").unwrap();
    for needle in ["First line.", "Second line with detail.", "<w:b", "w:author=\"Reviewer\"", "w:initials=\"RV\""] {
        assert!(out_comments.contains(needle), "rich comment lost {needle:?}");
    }
    // Two paragraphs preserved in the body.
    assert_eq!(out_comments.matches("<w:p>").count(), 2, "comment paragraphs lost");

    // Idempotent.
    let round2 = roundtrip_bytes(&round).unwrap();
    assert_eq!(round, round2, "rich-comment round-trip not idempotent");
}

/// A run that wraps content we don't model (a `w:drawing` with a nested
/// `w:t`-like inline image label, plus a `w:br`) must be preserved whole as a
/// Raw inline so the image/break and any text survive. Exercises the
/// "unmodeled child inside a plain run" reconstruction path specifically.
#[test]
fn test_run_with_unmodeled_child_is_preserved() {
    let document_xml = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:rPr><w:b/></w:rPr><w:t>before</w:t></w:r><w:r><w:rPr><w:noProof/></w:rPr><w:drawing><inline embed="rId8"/></w:drawing></w:r><w:r><w:br/><w:t>after</w:t></w:r></w:p></w:body></w:document>"#;
    let content_types = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>"#;
    let root_rels = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>"#;

    let mut pkg = Package::new();
    pkg.insert("[Content_Types].xml", content_types.as_bytes().to_vec());
    pkg.insert("_rels/.rels", root_rels.as_bytes().to_vec());
    pkg.insert("word/document.xml", document_xml.as_bytes().to_vec());
    let bytes = pkg.write_to_bytes().unwrap();

    let round = roundtrip_bytes(&bytes).expect("roundtrip drawing run");
    let round_pkg = Package::read_from_bytes(&round).unwrap();
    assert!(
        validate_package(&round_pkg).ok(),
        "drawing-run round-trip invalid: {:?}",
        validate_package(&round_pkg).errors
    );
    let out = round_pkg.get_str("word/document.xml").unwrap();
    // The drawing, its embed id, the break, and BOTH the modeled and the
    // adjacent text all survive.
    for needle in ["<w:drawing>", "embed=\"rId8\"", "<w:br", "before", "after", "<w:noProof"] {
        assert!(out.contains(needle), "lost {needle:?} from drawing run");
    }
    // ORDER is preserved within the run that mixes a break and text: the run was
    // `<w:br/><w:t>after</w:t>`, so the break must come BEFORE "after" (verbatim
    // whole-run preservation, not part-reconstruction which could reorder).
    let br_idx = out.find("<w:br").unwrap();
    let after_idx = out.find("after").unwrap();
    assert!(br_idx < after_idx, "run child order not preserved (<w:br> after text)");
}
