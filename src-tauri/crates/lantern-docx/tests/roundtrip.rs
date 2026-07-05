//! Engine-level tests for lantern-docx — the production OOXML engine.
//!
//! These are written against the public crate API and run FAST in isolation
//! (`cargo test -p lantern-docx`) — no Tauri, no lancedb, no fastembed in the
//! graph. They are the contract for the engine:
//!
//!   * existing revisions + comments survive a round-trip with author/date/text
//!     intact (TEST A),
//!   * PRESERVE-BY-DEFAULT: an unknown PART and an unknown ELEMENT both survive
//!     a round-trip (TEST P1 + P2) — the key production hardening,
//!   * the AI can author NEW well-formed revisions alongside originals (TEST B),
//!   * DOM <-> JSON is stable (TEST J),
//!   * properties (pPr/rPr) survive a round-trip (TEST PROPS).

use lantern_docx::author::{delete_run_containing, insert_at_paragraph_end, AI_AUTHOR};
use lantern_docx::fixture::{
    build_fixture_model, FIXTURE_COMMENT_ID, OPPOSING_COUNSEL, OPPOSING_DATE,
};
use lantern_docx::model::{BlockContent, Inline, RevisionKind};
use lantern_docx::package::{Limits, Package};
use lantern_docx::validate::validate_package;
use lantern_docx::{
    document_from_json, document_to_json, open_docx_bytes, parse_docx_bytes, resolve_all,
    resolve_revision, roundtrip_bytes, serialize_docx_bytes, Document, ResolveAction,
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

// ===========================================================================
// COMMENT BYTE-STABILITY — an UNEDITED commented doc must pass comments.xml
// through byte-for-byte (preserve-by-default for comments), not regenerate it.
// ===========================================================================

/// Build a commented package whose comments.xml uses a DIFFERENT (but valid)
/// root-element shape than our synthesizer would emit: extra namespace decls,
/// different attribute order, and surrounding whitespace. If the engine
/// regenerated comments.xml it would normalize all of this and the bytes would
/// differ — so this is the precise probe for "preserve, don't regenerate".
fn build_commented_package_with_distinctive_comments() -> Vec<u8> {
    let document_xml = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:commentRangeStart w:id="1"/><w:r><w:t>clause</w:t></w:r><w:commentRangeEnd w:id="1"/><w:r><w:rPr><w:rStyle w:val="CommentReference"/></w:rPr><w:commentReference w:id="1"/></w:r></w:p></w:body></w:document>"#;
    // Note the distinctive root: w15 namespace decl + a leading newline inside.
    let comments_xml = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\r\n<w:comments xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\" xmlns:w15=\"http://schemas.microsoft.com/office/word/2012/wordml\" mc:Ignorable=\"w15\" xmlns:mc=\"http://schemas.openxmlformats.org/markup-compatibility/2006\">\n<w:comment w:author=\"Reviewer\" w:date=\"2026-03-01T00:00:00Z\" w:initials=\"RV\" w:id=\"1\"><w:p><w:r><w:t>A note.</w:t></w:r></w:p></w:comment>\n</w:comments>";
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
    pkg.write_to_bytes().expect("zip commented package")
}

#[test]
fn test_comments_xml_byte_identical_when_unedited() {
    let original = build_commented_package_with_distinctive_comments();
    let orig_pkg = Package::read_from_bytes(&original).unwrap();
    let orig_comments = orig_pkg.get("word/comments.xml").unwrap().to_vec();

    // Open -> save with NO edits to comments. comments.xml must pass through
    // byte-for-byte (the distinctive root + whitespace survive).
    let round = roundtrip_bytes(&original).expect("roundtrip commented");
    let round_pkg = Package::read_from_bytes(&round).unwrap();
    let round_comments = round_pkg.get("word/comments.xml").unwrap().to_vec();

    assert_eq!(
        orig_comments, round_comments,
        "comments.xml was regenerated/normalized on an unedited round-trip \
         (preserve-by-default for comments violated)"
    );
}

#[test]
fn test_roundtrip_idempotent_on_commented_doc() {
    let original = build_commented_package_with_distinctive_comments();
    let round1 = roundtrip_bytes(&original).expect("roundtrip 1");
    let round2 = roundtrip_bytes(&round1).expect("roundtrip 2");
    assert_eq!(round1, round2, "commented-doc round-trip not idempotent");
}

/// Deterministic regression test for the same guarantee as
/// `test_roundtrip_idempotent_on_commented_doc`, but not dependent on the
/// wall clock: that test only failed when two writes happened to land on
/// opposite sides of a 2-second DOS-timestamp boundary, so it could pass or
/// fail depending on scheduling luck. This asserts directly on the zip
/// container's per-entry mtime — every entry must carry the fixed writer
/// timestamp, not real time, regardless of when the test runs.
#[test]
fn test_zip_entry_timestamps_are_fixed_not_wall_clock() {
    use std::io::Cursor;
    use zip::ZipArchive;

    let original = build_commented_package_with_distinctive_comments();
    let round = roundtrip_bytes(&original).expect("roundtrip");

    let mut archive = ZipArchive::new(Cursor::new(round)).expect("read written zip");
    let expected = zip::DateTime::default(); // DOS epoch: 1980-01-01 00:00:00
    assert!(archive.len() > 0, "written zip has no entries");
    for i in 0..archive.len() {
        let entry = archive.by_index(i).expect("read entry");
        assert_eq!(
            entry.last_modified(),
            Some(expected),
            "entry {:?} was stamped with a non-fixed mtime",
            entry.name()
        );
    }
}

#[test]
fn test_edited_comment_is_regenerated() {
    // When the comment set ACTUALLY changes, we regenerate (no stale preserve).
    let original = build_commented_package_with_distinctive_comments();
    let mut opened = open_docx_bytes(&original).expect("open commented");

    // Add a brand-new comment to the model (anchored ids not required for this
    // serialization check; we only assert the comment body is emitted). Use the
    // existing comment id space; add id "2".
    use lantern_docx::model::Comment;
    opened.document.comments.insert(
        "2".to_string(),
        Comment {
            id: "2".to_string(),
            author: "Advisor Prep Hero AI".to_string(),
            date: "2026-06-09T00:00:00Z".to_string(),
            initials: None,
            text: "Newly authored comment.".to_string(),
            body_xml: None,
        },
    );
    // Anchor the new comment so the dangling-ref guard (item 3) is satisfied.
    if let BlockContent::Paragraph(p) = &mut opened.document.body[0] {
        p.inlines.push(Inline::CommentRangeStart { id: "2".into() });
        p.inlines.push(Inline::CommentRangeEnd { id: "2".into() });
        p.inlines.push(Inline::CommentReference { id: "2".into() });
    }

    let saved = opened.save_bytes().expect("save edited comments");
    let saved_pkg = Package::read_from_bytes(&saved).unwrap();
    let comments = saved_pkg.get_str("word/comments.xml").unwrap();
    assert!(
        comments.contains("Newly authored comment."),
        "edited comment set was not regenerated"
    );
    // The original comment is still present too.
    assert!(comments.contains("A note."), "original comment lost on regen");
}

// ===========================================================================
// rPr BYTE-EXACT PRESERVATION — a run's <w:rPr> must round-trip byte-for-byte,
// the same way <w:pPr> does. The fix slices rPr from source rather than
// re-serializing it through the XML writer (which would normalize attribute
// order / whitespace / quoting).
// ===========================================================================

#[test]
fn test_rpr_is_byte_exact_across_roundtrip() {
    // Distinctive rPr spans the XML writer would likely normalize: single-quoted
    // attribute values, multiple attributes, and interior whitespace. We place
    // such rPr in BOTH a plain run and inside an <w:ins> run (the two capture
    // paths the fix unified).
    let document_xml = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n<w:document xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\"><w:body><w:p><w:r><w:rPr><w:rFonts w:ascii='Calibri'  w:hAnsi='Calibri'/><w:b/><w:color w:val='1F497D'/></w:rPr><w:t>plain</w:t></w:r><w:ins w:id=\"3\" w:author=\"C\" w:date=\"2026-01-01T00:00:00Z\"><w:r><w:rPr><w:i/><w:sz w:val='24'/></w:rPr><w:t>added</w:t></w:r></w:ins></w:p><w:sectPr/></w:body></w:document>";
    let content_types = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>"#;
    let root_rels = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>"#;

    let mut pkg = Package::new();
    pkg.insert("[Content_Types].xml", content_types.as_bytes().to_vec());
    pkg.insert("_rels/.rels", root_rels.as_bytes().to_vec());
    pkg.insert("word/document.xml", document_xml.as_bytes().to_vec());
    let bytes = pkg.write_to_bytes().unwrap();

    // Parse and confirm both rPr spans were captured VERBATIM (single quotes and
    // the double space survive — proof they were sliced, not re-serialized).
    let doc = parse_docx_bytes(&bytes).expect("parse");
    let para = doc
        .body
        .iter()
        .find_map(|b| match b {
            BlockContent::Paragraph(p) => Some(p),
            _ => None,
        })
        .unwrap();

    let plain_rpr = para.inlines.iter().find_map(|i| match i {
        Inline::Run(r) => r.properties_xml.clone(),
        _ => None,
    });
    let plain_rpr = plain_rpr.expect("plain run rPr captured");
    assert!(
        plain_rpr.contains("w:ascii='Calibri'  w:hAnsi='Calibri'"),
        "plain rPr was normalized (not byte-exact): {plain_rpr}"
    );

    let ins_rpr = para.inlines.iter().find_map(|i| match i {
        Inline::Insertion { runs, .. } => runs.first().and_then(|r| r.properties_xml.clone()),
        _ => None,
    });
    let ins_rpr = ins_rpr.expect("ins run rPr captured");
    assert!(
        ins_rpr.contains("<w:sz w:val='24'/>"),
        "ins rPr was normalized (not byte-exact): {ins_rpr}"
    );

    // The serialized document.xml must contain the rPr spans verbatim.
    let round = roundtrip_bytes(&bytes).expect("roundtrip");
    let round_pkg = Package::read_from_bytes(&round).unwrap();
    let out_xml = round_pkg.get_str("word/document.xml").unwrap();
    assert!(
        out_xml.contains("w:ascii='Calibri'  w:hAnsi='Calibri'"),
        "plain rPr not byte-exact in output: ...{}",
        &out_xml[..out_xml.len().min(400)]
    );
    assert!(
        out_xml.contains("<w:sz w:val='24'/>"),
        "ins rPr not byte-exact in output"
    );

    // Idempotent round-trip (stable diffs for version history — the reason this
    // matters before the version-history task).
    let round2 = roundtrip_bytes(&round).expect("roundtrip 2");
    assert_eq!(round, round2, "rPr-bearing doc round-trip not idempotent");
}

// ===========================================================================
// MANIFEST HANDLING — content-type + relationship manifests must be parsed
// precisely (anchored PartName, quote/space-tolerant ids, non-rId ids handled),
// not via loose substring scans.
// ===========================================================================

#[test]
fn test_ensure_comments_content_type_anchors_on_partname() {
    // A content-types manifest that mentions the comments content-type ONLY in a
    // Default for a different part (a contrived but legal way the loose substring
    // check would false-positive). With precise anchoring on
    // PartName="/word/comments.xml", we must still add the Override.
    let ct = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>"#;
    let mut pkg = Package::new();
    pkg.insert("[Content_Types].xml", ct.as_bytes().to_vec());
    pkg.ensure_comments_content_type();
    let out = pkg.get_str("[Content_Types].xml").unwrap();
    assert!(
        out.contains("PartName=\"/word/comments.xml\""),
        "comments Override not added (precise PartName anchoring failed): {out}"
    );
    // Idempotent: a second call must not add a duplicate Override.
    pkg.ensure_comments_content_type();
    let out2 = pkg.get_str("[Content_Types].xml").unwrap();
    assert_eq!(
        out2.matches("PartName=\"/word/comments.xml\"").count(),
        1,
        "duplicate comments Override added"
    );
}

#[test]
fn test_ensure_comments_content_type_idempotent_when_present() {
    let ct = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/></Types>"#;
    let mut pkg = Package::new();
    pkg.insert("[Content_Types].xml", ct.as_bytes().to_vec());
    pkg.ensure_comments_content_type();
    let out = pkg.get_str("[Content_Types].xml").unwrap();
    assert_eq!(out, ct, "manifest mutated though comments already declared");
}

#[test]
fn test_next_rel_id_handles_quote_space_and_non_rid_ids() {
    // Relationships with single quotes, extra spaces, and a NON-rId id. The next
    // id must be rId(max+1) over the rId-prefixed numeric ids only (here max=7).
    let rels = "<?xml version=\"1.0\"?><Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"><Relationship Id='rId3' Type='t' Target='a'/><Relationship  Id = \"rId7\"  Type=\"t\" Target=\"b\"/><Relationship Id=\"docRel\" Type=\"t\" Target=\"c\"/></Relationships>";
    let mut pkg = Package::new();
    pkg.insert("[Content_Types].xml", b"<Types/>".to_vec());
    pkg.insert("word/_rels/document.xml.rels", rels.as_bytes().to_vec());
    pkg.ensure_comments_relationship();
    let out = pkg.get_str("word/_rels/document.xml.rels").unwrap();
    // New relationship must use rId8 (max rId was 7; non-rId "docRel" ignored).
    assert!(
        out.contains("Id=\"rId8\""),
        "next_rel_id did not pick rId8 over quote/space/non-rId variants: {out}"
    );
    assert!(out.contains("/relationships/comments"), "comments rel not added");
}

#[test]
fn test_ensure_comments_relationship_idempotent() {
    let rels = r#"<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="comments.xml"/></Relationships>"#;
    let mut pkg = Package::new();
    pkg.insert("word/_rels/document.xml.rels", rels.as_bytes().to_vec());
    pkg.ensure_comments_relationship();
    let out = pkg.get_str("word/_rels/document.xml.rels").unwrap();
    assert_eq!(out, rels, "rels mutated though comments rel already present");
}

// ===========================================================================
// BODY-LEVEL sectPr DETECTION — a paragraph-level <w:sectPr> (inside a pPr), or
// the literal substring "sectPr" elsewhere, must NOT suppress the required
// trailing body-level <w:sectPr>. Detection keys on the last body child being a
// sectPr element, not a substring scan.
// ===========================================================================

/// True if the serialized document.xml ends its body with a body-level sectPr
/// element (the final child before `</w:body>` is a `<w:sectPr>` open or empty
/// tag), which is what makes the body structurally complete.
fn body_ends_with_sectpr(doc_xml: &str) -> bool {
    let body_close = doc_xml.rfind("</w:body>").expect("has </w:body>");
    let before = doc_xml[..body_close].trim_end();
    before.ends_with("<w:sectPr/>") || before.ends_with("</w:sectPr>")
}

#[test]
fn test_paragraph_level_sectpr_does_not_suppress_body_sectpr() {
    use lantern_docx::model::{BlockContent as BC, Inline as IL, Paragraph, Run};
    // A document whose ONLY "sectPr" is paragraph-level: the last paragraph's
    // pPr carries a <w:sectPr> (this is how Word stores per-section breaks). The
    // body itself has NO trailing body-level sectPr block.
    let para = Paragraph {
        properties_xml: Some(
            "<w:pPr><w:sectPr><w:pgSz w:w=\"12240\" w:h=\"15840\"/></w:sectPr></w:pPr>".to_string(),
        ),
        inlines: vec![IL::Run(Run::new("section one"))],
    };
    let doc = Document {
        format_version: lantern_docx::model::DOM_FORMAT_VERSION,
        body: vec![BC::Paragraph(para)],
        comments: Default::default(),
    };

    // Serialize from scratch and read back the document.xml.
    let bytes = serialize_docx_bytes(&doc).expect("serialize");
    let pkg = Package::read_from_bytes(&bytes).unwrap();
    let doc_xml = pkg.get_str("word/document.xml").unwrap();

    // The paragraph-level sectPr is preserved inside the pPr...
    assert!(doc_xml.contains("<w:pPr><w:sectPr>"), "paragraph sectPr lost");
    // ...AND a body-level sectPr is still emitted as the final body child, so the
    // body is structurally complete (the old substring scan would have wrongly
    // suppressed it because "sectPr" appears in the paragraph pPr).
    assert!(
        body_ends_with_sectpr(&doc_xml),
        "body did not end with a body-level sectPr: ...{}",
        &doc_xml[doc_xml.len().saturating_sub(80)..]
    );
}

#[test]
fn test_imported_body_level_sectpr_not_duplicated() {
    // The rich package HAS a real body-level <w:sectPr> block. Round-trip must
    // NOT add a second one.
    let original = build_rich_package_bytes();
    let round = roundtrip_bytes(&original).expect("roundtrip rich");
    let round_pkg = Package::read_from_bytes(&round).unwrap();
    let doc_xml = round_pkg.get_str("word/document.xml").unwrap();
    // Exactly one body-level sectPr (the imported one), not a synthesized extra.
    assert_eq!(
        doc_xml.matches("<w:sectPr>").count(),
        1,
        "body-level sectPr duplicated on round-trip"
    );
}

// ===========================================================================
// DANGLING COMMENT-REFERENCE GUARD — save must reject a document whose body
// references a comment id that has no <w:comment> (or vice-versa), which Word
// treats as corrupt.
// ===========================================================================

#[test]
fn test_save_rejects_dangling_comment_reference() {
    // A body that references comment id "99" with NO matching comment.
    let mut doc = build_fixture_model();
    if let BlockContent::Paragraph(p) = &mut doc.body[0] {
        p.inlines.push(Inline::CommentReference { id: "99".into() });
    }
    // serialize_docx_bytes -> serialize_new_package must reject it.
    let res = serialize_docx_bytes(&doc);
    assert!(res.is_err(), "dangling commentReference was not rejected");
    assert!(
        format!("{}", res.unwrap_err()).contains("dangling comment"),
        "wrong error for dangling reference"
    );
}

#[test]
fn test_save_rejects_dangling_comment_range_start() {
    let mut doc = build_fixture_model();
    if let BlockContent::Paragraph(p) = &mut doc.body[0] {
        p.inlines.push(Inline::CommentRangeStart { id: "77".into() });
    }
    let res = serialize_docx_bytes(&doc);
    assert!(res.is_err(), "dangling commentRangeStart was not rejected");
}

#[test]
fn test_save_rejects_orphaned_comment() {
    // A comment with NO body reference is orphaned and must be rejected.
    use lantern_docx::model::Comment;
    let mut doc = build_fixture_model();
    doc.comments.insert(
        "42".to_string(),
        Comment {
            id: "42".to_string(),
            author: "X".to_string(),
            date: "2026-06-09T00:00:00Z".to_string(),
            initials: None,
            text: "unanchored".to_string(),
            body_xml: None,
        },
    );
    let res = serialize_docx_bytes(&doc);
    assert!(res.is_err(), "orphaned comment was not rejected");
    assert!(format!("{}", res.unwrap_err()).contains("orphaned comment"));
}

#[test]
fn test_save_accepts_balanced_comments() {
    // Sanity: the fixture (balanced comment graph) still saves fine — the guard
    // is not over-eager.
    let doc = build_fixture_model();
    assert!(serialize_docx_bytes(&doc).is_ok(), "balanced doc wrongly rejected");
}

// ===========================================================================
// ADVERSARIAL / NEGATIVE TESTS
//
// The engine reads attacker-controlled `.docx` bytes (a ZIP of XML). These
// tests lock in the security + robustness properties dependent tasks rely on:
//   * decompression-bomb caps fire instead of allocating gigabytes,
//   * malformed input (truncated XML, not-a-zip, missing document.xml) returns
//     Err rather than hanging or panicking,
//   * XML entity expansion (billion-laughs) does NOT occur — quick-xml does not
//     expand general entities; this test would catch a future dep regression.
// ===========================================================================

/// A minimal, well-formed `word/document.xml` for crafted-package tests.
const MINIMAL_DOCUMENT_XML: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>hi</w:t></w:r></w:p></w:body></w:document>"#;

/// Build a ZIP in memory from `(name, bytes)` entries using deflate, with no
/// engine-side sanitization — lets these tests hand the reader genuinely
/// hostile archives (e.g. a highly compressible bomb entry).
fn build_zip(entries: &[(&str, Vec<u8>)]) -> Vec<u8> {
    use std::io::{Cursor, Write};
    use zip::write::SimpleFileOptions;
    use zip::{CompressionMethod, ZipWriter};

    let mut out = Cursor::new(Vec::new());
    {
        let mut zip = ZipWriter::new(&mut out);
        let opts = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
        for (name, data) in entries {
            zip.start_file(*name, opts).expect("start_file");
            zip.write_all(data).expect("write entry");
        }
        zip.finish().expect("finish zip");
    }
    out.into_inner()
}

#[test]
fn test_zip_bomb_total_budget_is_capped() {
    // 4 MiB of zeros compresses to a few KiB but decompresses past a 1 MiB cap.
    // The guard must reject it WITHOUT allocating the full payload (we bound the
    // read at budget+1). Includes a valid document.xml so the failure is the
    // size cap, not the missing-document check.
    let bomb = vec![0u8; 4 * 1024 * 1024];
    let bytes = build_zip(&[
        ("word/document.xml", MINIMAL_DOCUMENT_XML.as_bytes().to_vec()),
        ("word/bomb.bin", bomb),
    ]);
    // Compressed size must be tiny (proves it's a real "bomb": small in, big out).
    assert!(
        bytes.len() < 1024 * 1024,
        "compressed bomb unexpectedly large: {} bytes",
        bytes.len()
    );

    let limits = Limits {
        max_total_decompressed: 1024 * 1024, // 1 MiB total cap
        max_entry_decompressed: 1024 * 1024,
        max_entry_count: 10_000,
    };
    let res = Package::read_from_bytes_with_limits(&bytes, limits);
    assert!(res.is_err(), "decompression bomb was not rejected: {res:?}");
    let msg = format!("{}", res.unwrap_err());
    assert!(
        msg.contains("decompression-bomb") || msg.contains("size limit"),
        "unexpected error for zip bomb: {msg}"
    );
}

#[test]
fn test_zip_bomb_per_entry_cap_fires() {
    // A single entry larger than the per-entry cap (but under the generous total
    // cap) must still be rejected.
    let big = vec![0u8; 3 * 1024 * 1024];
    let bytes = build_zip(&[
        ("word/document.xml", MINIMAL_DOCUMENT_XML.as_bytes().to_vec()),
        ("word/big.bin", big),
    ]);
    let limits = Limits {
        max_total_decompressed: 64 * 1024 * 1024,
        max_entry_decompressed: 1024 * 1024, // 1 MiB per-entry cap
        max_entry_count: 10_000,
    };
    let res = Package::read_from_bytes_with_limits(&bytes, limits);
    assert!(res.is_err(), "oversized entry not rejected: {res:?}");
}

#[test]
fn test_zip_entry_count_cap_fires() {
    let mut entries: Vec<(&str, Vec<u8>)> =
        vec![("word/document.xml", MINIMAL_DOCUMENT_XML.as_bytes().to_vec())];
    // Build many tiny entries. Leak the names so they live for build_zip's &str.
    let names: Vec<String> = (0..50).map(|i| format!("word/n{i}.bin")).collect();
    for n in &names {
        entries.push((n.as_str(), vec![0u8; 4]));
    }
    let limits = Limits {
        max_total_decompressed: 64 * 1024 * 1024,
        max_entry_decompressed: 1024 * 1024,
        max_entry_count: 10, // far below the 51 entries
    };
    let bytes = build_zip(&entries);
    let res = Package::read_from_bytes_with_limits(&bytes, limits);
    assert!(res.is_err(), "entry-count cap not enforced: {res:?}");
    assert!(format!("{}", res.unwrap_err()).contains("too many entries"));
}

#[test]
fn test_within_limits_still_reads() {
    // A legitimate small package must still read fine under default limits — the
    // guard must not be over-eager.
    let bytes = fixture_bytes();
    let pkg = Package::read_from_bytes(&bytes).expect("legit doc reads under default limits");
    assert!(pkg.contains("word/document.xml"));
}

#[test]
fn test_not_a_zip_returns_err() {
    let res = Package::read_from_bytes(b"this is definitely not a zip file");
    assert!(res.is_err(), "non-zip bytes must error");
    // And the higher-level open path also errors (does not panic).
    assert!(parse_docx_bytes(b"\x00\x01\x02not a zip").is_err());
}

#[test]
fn test_zip_missing_document_xml_returns_err() {
    // A valid ZIP that lacks word/document.xml is not a Word document.
    let bytes = build_zip(&[
        ("[Content_Types].xml", b"<Types/>".to_vec()),
        ("word/styles.xml", b"<w:styles/>".to_vec()),
    ]);
    let res = Package::read_from_bytes(&bytes);
    assert!(res.is_err(), "missing document.xml must error");
    assert!(format!("{}", res.unwrap_err()).contains("document.xml"));
    assert!(parse_docx_bytes(&bytes).is_err());
}

#[test]
fn test_truncated_document_xml_returns_err_and_does_not_hang() {
    // document.xml cut off mid-element. The parser must return Err (EOF inside
    // an element), not loop forever. The parse loops are iterative + EOF-guarded,
    // so this completes promptly.
    let truncated = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>unterminated text"#;
    let content_types = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>"#;
    let root_rels = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>"#;

    let bytes = build_zip(&[
        ("[Content_Types].xml", content_types.as_bytes().to_vec()),
        ("_rels/.rels", root_rels.as_bytes().to_vec()),
        ("word/document.xml", truncated.as_bytes().to_vec()),
    ]);
    // Reading the package succeeds (valid zip); parsing the malformed XML errors.
    let res = parse_docx_bytes(&bytes);
    assert!(res.is_err(), "truncated document.xml must error, got {res:?}");
}

#[test]
fn test_doctype_entity_is_not_expanded_billion_laughs() {
    // Billion-laughs: a DOCTYPE defining a recursively-expanding entity. quick-xml
    // does NOT expand general entities, so this must NOT blow up memory. We assert
    // the engine either errors or, if it parses, the bomb entity text is NOT
    // expanded into the document (it stays inert). This locks in billion-laughs
    // immunity so a future quick-xml bump can't silently regress it.
    let lols = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<!DOCTYPE w:document [
  <!ENTITY lol "lol">
  <!ENTITY lol2 "&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;">
  <!ENTITY lol3 "&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;">
  <!ENTITY lol4 "&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;">
]>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>&lol4;</w:t></w:r></w:p></w:body></w:document>"#;
    let content_types = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>"#;
    let root_rels = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>"#;

    let bytes = build_zip(&[
        ("[Content_Types].xml", content_types.as_bytes().to_vec()),
        ("_rels/.rels", root_rels.as_bytes().to_vec()),
        ("word/document.xml", lols.as_bytes().to_vec()),
    ]);

    match parse_docx_bytes(&bytes) {
        Ok(doc) => {
            // If it parsed, the entity must NOT have expanded into thousands of
            // "lol"s. Collect all run text and assert the bomb did not detonate.
            let mut all_text = String::new();
            for block in &doc.body {
                if let BlockContent::Paragraph(p) = block {
                    for inline in &p.inlines {
                        if let Inline::Run(r) = inline {
                            all_text.push_str(&r.text);
                        }
                    }
                }
            }
            assert!(
                all_text.matches("lol").count() < 100,
                "entity expansion detonated (billion-laughs not inert): {} lols",
                all_text.matches("lol").count()
            );
        }
        Err(_) => {
            // Erroring on the DOCTYPE/entity is also acceptable (and inert).
        }
    }
}

// ---------------------------------------------------------------------------
// TEST R — accept/reject tracked changes (resolve) still produces a VALID
// .docx that round-trips. This is the contract for the editor's accept/reject
// + review-pane bulk buttons: resolving must yield a document Word can open,
// with comments and unrelated content intact.
// ---------------------------------------------------------------------------

/// Concatenate every plain-run text in body order (revisions still present are
/// ignored). Mirrors the engine's own helper for asserting resolved text.
fn body_plain_text(doc: &Document) -> String {
    doc.body
        .iter()
        .filter_map(|b| match b {
            BlockContent::Paragraph(p) => Some(p),
            _ => None,
        })
        .flat_map(|p| p.inlines.iter())
        .filter_map(|i| match i {
            Inline::Run(r) => Some(r.text.as_str()),
            _ => None,
        })
        .collect()
}

#[test]
fn test_r_accept_all_serializes_to_valid_roundtripping_docx() {
    let mut doc = build_fixture_model();
    let n = resolve_all(&mut doc, ResolveAction::Accept);
    assert_eq!(n, 2, "fixture has one insertion + one deletion");
    assert!(doc.revisions().is_empty(), "no revisions remain after accept-all");

    // Serialize from scratch, validate the package structurally.
    let bytes = serialize_docx_bytes(&doc).expect("serialize accepted doc");
    let pkg = Package::read_from_bytes(&bytes).expect("valid zip");
    assert!(
        validate_package(&pkg).ok(),
        "accepted doc invalid: {:?}",
        validate_package(&pkg).errors
    );

    // Re-parse and confirm the resolved text + that the comment survived.
    let reparsed = parse_docx_bytes(&bytes).expect("reparse accepted");
    assert!(reparsed.revisions().is_empty());
    assert_eq!(
        body_plain_text(&reparsed),
        "The parties agree to promptly resolve all disputes."
    );
    assert!(
        reparsed.comments.contains_key(FIXTURE_COMMENT_ID),
        "comment must survive accept-all"
    );

    // Idempotent serialization (stable diffs / version history).
    let round2 = roundtrip_bytes(&bytes).expect("roundtrip accepted");
    let round3 = roundtrip_bytes(&round2).expect("roundtrip accepted 2");
    assert_eq!(round2, round3, "resolved doc serialization not idempotent");
}

#[test]
fn test_r_reject_all_serializes_to_valid_roundtripping_docx() {
    let mut doc = build_fixture_model();
    let n = resolve_all(&mut doc, ResolveAction::Reject);
    assert_eq!(n, 2);
    assert!(doc.revisions().is_empty(), "no revisions remain after reject-all");

    let bytes = serialize_docx_bytes(&doc).expect("serialize rejected doc");
    let pkg = Package::read_from_bytes(&bytes).expect("valid zip");
    assert!(
        validate_package(&pkg).ok(),
        "rejected doc invalid: {:?}",
        validate_package(&pkg).errors
    );

    let reparsed = parse_docx_bytes(&bytes).expect("reparse rejected");
    // Reject restores the original (pre-redline) text.
    assert_eq!(
        body_plain_text(&reparsed),
        "The parties agree to resolve all minor disputes."
    );
    assert!(reparsed.comments.contains_key(FIXTURE_COMMENT_ID));
}

#[test]
fn test_r_resolve_one_revision_preserves_comment_graph_through_save() {
    // Resolve just the insertion. The deletion AND the comment anchors must
    // survive serialization — the serializer's dangling-comment-ref guard would
    // reject the save if resolving had orphaned the comment.
    let mut doc = build_fixture_model();
    assert!(resolve_revision(&mut doc, "101", ResolveAction::Accept));

    let bytes = serialize_docx_bytes(&doc).expect("serialize partially-resolved doc");
    let pkg = Package::read_from_bytes(&bytes).expect("valid zip");
    assert!(
        validate_package(&pkg).ok(),
        "partially-resolved doc invalid: {:?}",
        validate_package(&pkg).errors
    );

    let reparsed = parse_docx_bytes(&bytes).expect("reparse");
    // The other revision (the deletion, id 102) is intact and round-tripped.
    let revs = reparsed.revisions();
    assert_eq!(revs.len(), 1);
    assert_eq!(revs[0].0.id, "102");
    assert_eq!(revs[0].1, RevisionKind::Deletion);
    // Comment preserved with no dangling reference.
    assert!(reparsed.comments.contains_key(FIXTURE_COMMENT_ID));
    // Accepted insertion text is now plain text.
    assert!(body_plain_text(&reparsed).contains("promptly "));
}

#[test]
fn test_r_resolve_preserves_unmodeled_parts_via_opened_document() {
    // Resolve through the preserve-by-default save path (OpenedDocument), proving
    // styles/theme/numbering/media survive when the editor accepts a change and
    // saves. The rich fixture has no revisions of its own, so author one first.
    let original = build_rich_package_bytes();
    let opened = open_docx_bytes(&original).expect("open rich");
    let mut doc = opened.document.clone();

    delete_run_containing(&mut doc, 0, "Lead text ", AI_AUTHOR, OPPOSING_DATE)
        .expect("found a run to delete in the rich doc");
    assert_eq!(doc.revisions().len(), 1, "one authored revision present");

    // Accept it (the delete applies). resolve_all reports it resolved.
    let resolved = resolve_all(&mut doc, ResolveAction::Accept);
    assert_eq!(resolved, 1);
    assert!(doc.revisions().is_empty(), "authored revision resolved");

    let out = opened.with_document(doc).save_bytes().expect("save resolved");
    let pkg = Package::read_from_bytes(&out).expect("valid zip");
    assert!(
        validate_package(&pkg).ok(),
        "resolved rich doc invalid: {:?}",
        validate_package(&pkg).errors
    );

    // Unmodeled parts survived byte-for-byte through the resolve+save.
    let original_pkg = Package::read_from_bytes(&original).unwrap();
    for part in [
        "word/styles.xml",
        "word/numbering.xml",
        "customXml/item1.xml",
        "word/theme/theme1.xml",
        "word/media/image1.png",
    ] {
        assert_eq!(
            pkg.get(part),
            original_pkg.get(part),
            "unmodeled part {part} must survive resolve+save byte-for-byte"
        );
    }

    let reparsed = parse_docx_bytes(&out).expect("reparse resolved rich");
    assert!(reparsed.revisions().is_empty(), "all revisions resolved");
    // The accepted deletion removed "Lead text " from the normal flow.
    assert!(!body_plain_text(&reparsed).contains("Lead text"));
}

// ===========================================================================
// CLEAN COPY / SCRUB METADATA (privilege-safe export)
//
// A .docx carries hidden authorship/origin metadata in docProps/core.xml and
// docProps/app.xml that travels with the file. The "clean copy" export strips
// it before the document leaves the user's machine (inadvertent metadata
// disclosure is a real legal risk). These tests lock in:
//   * the metadata-only scrub removes core/app identifying fields,
//   * the scrubbed result still ROUND-TRIPS to a valid .docx, with the visible
//     content + tracked changes + comments intact (author attribution kept),
//   * the stronger "final clean" mode (accept-all + strip-comments) yields a
//     document with NO revisions and NO comments,
//   * preserve-by-default still holds for every non-metadata part.
// ===========================================================================

use lantern_docx::scrub::{
    app_props_are_clean, clean_copy_bytes, core_props_are_clean, scrub_package_metadata,
    ScrubOptions, APP_PROPS_PART, CORE_PROPS_PART,
};

/// A docProps/core.xml carrying identifying authorship metadata (the exact kind
/// a firm must not leak to opposing counsel).
const DIRTY_CORE_XML: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:creator>Jane Partner</dc:creator><cp:lastModifiedBy>Associate Smith</cp:lastModifiedBy><cp:revision>17</cp:revision><dcterms:created xsi:type="dcterms:W3CDTF">2026-01-01T09:00:00Z</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">2026-02-02T17:30:00Z</dcterms:modified><dc:title>Settlement Agreement</dc:title></cp:coreProperties>"#;

/// A docProps/app.xml carrying a company + manager (firm-identifying).
const DIRTY_APP_XML: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>Microsoft Office Word</Application><Company>Big Law LLP</Company><Manager>Managing Partner</Manager><TotalTime>420</TotalTime><Template>FirmLetterhead.dotx</Template></Properties>"#;

/// Build a package that has BOTH metadata parts (dirty) AND a real redlined,
/// commented body (the fixture's), plus an unmodeled part to prove
/// preserve-by-default survives the scrub. Returns ready-to-open .docx bytes.
fn build_package_with_metadata_and_revisions() -> Vec<u8> {
    // Start from the fixture (has an insertion, a deletion, and a comment), then
    // inject docProps parts + an unmodeled styles.xml + the manifests/overrides.
    let doc = build_fixture_model();
    let document_xml = lantern_docx::serialize::serialize_document(&doc).expect("serialize body");
    let comments_xml = lantern_docx::serialize::serialize_comments(&doc).expect("serialize comments");

    let content_types = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>"#;
    let root_rels = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>"#;
    let doc_rels = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="comments.xml"/></Relationships>"#;
    let styles_xml = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:styleId="BodyText"><w:name w:val="Body Text"/></w:style></w:styles>"#;

    let mut pkg = Package::new();
    pkg.insert("[Content_Types].xml", content_types.as_bytes().to_vec());
    pkg.insert("_rels/.rels", root_rels.as_bytes().to_vec());
    pkg.insert("word/_rels/document.xml.rels", doc_rels.as_bytes().to_vec());
    pkg.insert("word/document.xml", document_xml.into_bytes());
    pkg.insert("word/comments.xml", comments_xml.into_bytes());
    pkg.insert("word/styles.xml", styles_xml.as_bytes().to_vec());
    pkg.insert(CORE_PROPS_PART, DIRTY_CORE_XML.as_bytes().to_vec());
    pkg.insert(APP_PROPS_PART, DIRTY_APP_XML.as_bytes().to_vec());
    pkg.write_to_bytes().expect("zip package with metadata")
}

fn build_package_with_residual_metadata_parts() -> Vec<u8> {
    let document_xml = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Visible filing memo</w:t></w:r></w:p><w:sectPr/></w:body></w:document>"#;
    let content_types = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/><Override PartName="/docProps/custom.xml" ContentType="application/vnd.openxmlformats-officedocument.custom-properties+xml"/><Override PartName="/customXml/itemProps1.xml" ContentType="application/vnd.openxmlformats-officedocument.customXmlProperties+xml"/></Types>"#;
    let root_rels = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/><Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/custom-properties" Target="docProps/custom.xml"/></Relationships>"#;
    let doc_rels = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXml" Target="../customXml/item1.xml"/></Relationships>"#;
    let custom_props_xml = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><property fmtid="{D5CDD505-2E9C-101B-9397-08002B2CF9AE}" pid="2" name="Matter"><vt:lpwstr>Globex privileged strategy</vt:lpwstr></property></Properties>"#;
    let custom_xml = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<matterData><name>Globex privileged strategy</name></matterData>"#;
    let item_props = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<ds:datastoreItem ds:itemID="{11111111-1111-1111-1111-111111111111}" xmlns:ds="http://schemas.openxmlformats.org/officeDocument/2006/customXml"><ds:schemaRefs/></ds:datastoreItem>"#;
    let custom_xml_rels = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXmlProps" Target="itemProps1.xml"/></Relationships>"#;

    let mut pkg = Package::new();
    pkg.insert("[Content_Types].xml", content_types.as_bytes().to_vec());
    pkg.insert("_rels/.rels", root_rels.as_bytes().to_vec());
    pkg.insert("word/_rels/document.xml.rels", doc_rels.as_bytes().to_vec());
    pkg.insert("word/document.xml", document_xml.as_bytes().to_vec());
    pkg.insert(CORE_PROPS_PART, DIRTY_CORE_XML.as_bytes().to_vec());
    pkg.insert(APP_PROPS_PART, DIRTY_APP_XML.as_bytes().to_vec());
    pkg.insert("docProps/custom.xml", custom_props_xml.as_bytes().to_vec());
    pkg.insert("customXml/item1.xml", custom_xml.as_bytes().to_vec());
    pkg.insert("customXml/itemProps1.xml", item_props.as_bytes().to_vec());
    pkg.insert("customXml/_rels/item1.xml.rels", custom_xml_rels.as_bytes().to_vec());
    pkg.write_to_bytes()
        .expect("zip package with residual metadata")
}

#[test]
fn test_scrub_package_metadata_removes_core_and_app_fields() {
    // Sanity: the dirty inputs really do carry the identifying fields...
    assert!(!core_props_are_clean(DIRTY_CORE_XML), "fixture core not dirty");
    assert!(!app_props_are_clean(DIRTY_APP_XML), "fixture app not dirty");

    let mut pkg = Package::read_from_bytes(&build_package_with_metadata_and_revisions()).unwrap();
    scrub_package_metadata(&mut pkg);

    let core = pkg.get_str(CORE_PROPS_PART).expect("core part still present");
    let app = pkg.get_str(APP_PROPS_PART).expect("app part still present");

    // No author / lastModifiedBy / revision / timestamps survive.
    assert!(core_props_are_clean(&core), "core.xml still identifying: {core}");
    assert!(!core.contains("Jane Partner"), "author leaked");
    assert!(!core.contains("Associate Smith"), "lastModifiedBy leaked");
    assert!(!core.contains("17"), "revision count leaked");
    assert!(!core.contains("2026-01-01"), "created timestamp leaked");

    // Company + Manager + template removed from app.xml.
    assert!(app_props_are_clean(&app), "app.xml still identifying: {app}");
    assert!(!app.contains("Big Law LLP"), "company leaked");
    assert!(!app.contains("Managing Partner"), "manager leaked");
    assert!(!app.contains("FirmLetterhead"), "template leaked");
}

#[test]
fn test_scrub_only_rewrites_metadata_parts() {
    // The scrub must touch ONLY docProps/core.xml + docProps/app.xml; every
    // other part (document.xml, comments.xml, styles.xml, manifests) stays
    // byte-for-byte identical.
    let original = build_package_with_metadata_and_revisions();
    let orig_pkg = Package::read_from_bytes(&original).unwrap();
    let mut scrubbed = orig_pkg.clone();
    scrub_package_metadata(&mut scrubbed);

    for part in [
        "word/document.xml",
        "word/comments.xml",
        "word/styles.xml",
        "[Content_Types].xml",
        "_rels/.rels",
        "word/_rels/document.xml.rels",
    ] {
        assert_eq!(
            orig_pkg.get(part),
            scrubbed.get(part),
            "scrub changed a non-metadata part: {part}"
        );
    }
    // The two metadata parts DID change.
    assert_ne!(orig_pkg.get(CORE_PROPS_PART), scrubbed.get(CORE_PROPS_PART));
    assert_ne!(orig_pkg.get(APP_PROPS_PART), scrubbed.get(APP_PROPS_PART));
}

#[test]
fn test_scrub_without_standard_docprops_still_removes_custom_xml_metadata() {
    // A package with no core/app docProps must not gain new standard metadata
    // parts, but customXml is still a known hidden metadata store and is removed
    // from clean-copy output.
    let original = build_rich_package_bytes(); // has no docProps
    let orig_pkg = Package::read_from_bytes(&original).unwrap();
    let mut pkg = orig_pkg.clone();
    scrub_package_metadata(&mut pkg);
    assert!(!pkg.contains(CORE_PROPS_PART), "scrub wrongly added core.xml");
    assert!(!pkg.contains(APP_PROPS_PART), "scrub wrongly added app.xml");
    assert!(
        orig_pkg.contains("customXml/item1.xml"),
        "test setup must include customXml"
    );
    assert!(
        !pkg.contains("customXml/item1.xml"),
        "scrub left hidden customXml metadata in place"
    );
    assert_eq!(
        orig_pkg.get("word/document.xml"),
        pkg.get("word/document.xml"),
        "scrub changed visible document content"
    );
}

#[test]
fn test_clean_copy_metadata_only_keeps_revisions_and_comments() {
    // The DEFAULT clean copy strips metadata but keeps the tracked changes
    // (their author attribution is deliberate) and the comment.
    let original = build_package_with_metadata_and_revisions();
    let opened = open_docx_bytes(&original).expect("open");

    let bytes = clean_copy_bytes(&opened, ScrubOptions::metadata_only()).expect("clean copy");

    // Result is a valid, well-formed .docx.
    let pkg = Package::read_from_bytes(&bytes).expect("clean copy is valid zip");
    assert!(
        validate_package(&pkg).ok(),
        "clean copy invalid: {:?}",
        validate_package(&pkg).errors
    );

    // Metadata scrubbed.
    assert!(core_props_are_clean(&pkg.get_str(CORE_PROPS_PART).unwrap()));
    assert!(app_props_are_clean(&pkg.get_str(APP_PROPS_PART).unwrap()));

    // Content + revisions + comment all survived (re-parse and assert).
    let reparsed = parse_docx_bytes(&bytes).expect("reparse clean copy");
    let revs = reparsed.revisions();
    assert_eq!(revs.len(), 2, "tracked changes must be preserved in metadata-only mode");
    assert!(revs.iter().any(|(m, k, _)| *k == RevisionKind::Insertion && m.author == OPPOSING_COUNSEL));
    assert!(reparsed.comments.contains_key(FIXTURE_COMMENT_ID), "comment dropped in metadata-only mode");

    // Original document is untouched (clean copy is non-destructive).
    assert_eq!(opened.document.revisions().len(), 2, "source doc mutated by clean copy");
}

#[test]
fn test_clean_copy_final_mode_has_no_revisions_or_comments() {
    // The STRONGER mode accepts every tracked change and removes every comment:
    // the recipient gets a flat final document with no review history.
    let original = build_package_with_metadata_and_revisions();
    let opened = open_docx_bytes(&original).expect("open");

    let bytes = clean_copy_bytes(&opened, ScrubOptions::final_clean()).expect("final clean copy");

    let pkg = Package::read_from_bytes(&bytes).expect("final clean copy is valid zip");
    assert!(
        validate_package(&pkg).ok(),
        "final clean copy invalid: {:?}",
        validate_package(&pkg).errors
    );

    // Metadata scrubbed.
    assert!(core_props_are_clean(&pkg.get_str(CORE_PROPS_PART).unwrap()));
    assert!(app_props_are_clean(&pkg.get_str(APP_PROPS_PART).unwrap()));

    let reparsed = parse_docx_bytes(&bytes).expect("reparse final clean copy");
    // No revisions left.
    assert!(reparsed.revisions().is_empty(), "tracked changes survived final-clean mode");
    // No comments left, and no comment anchors in the body.
    assert!(reparsed.comments.is_empty(), "comments survived final-clean mode");
    let anchors = count_inline(&reparsed, |i| {
        matches!(
            i,
            Inline::CommentRangeStart { .. }
                | Inline::CommentRangeEnd { .. }
                | Inline::CommentReference { .. }
        )
    });
    assert_eq!(anchors, 0, "comment anchors left dangling after final-clean strip");

    // The visible text of the ACCEPTED changes is present: the insertion
    // "promptly " is kept; the deletion "minor " is gone.
    let plain = body_plain_text(&reparsed);
    assert!(plain.contains("promptly"), "accepted insertion text missing");
    assert!(!plain.contains("minor"), "accepted deletion text not removed");

    // Idempotent: serializing the clean copy again is byte-stable.
    let again = roundtrip_bytes(&bytes).expect("roundtrip clean copy");
    let again2 = roundtrip_bytes(&again).expect("roundtrip 2");
    assert_eq!(again, again2, "clean copy round-trip not idempotent");
}

fn build_package_with_table_revisions() -> Vec<u8> {
    let document_xml = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:tbl><w:tr><w:tc><w:p><w:r><w:t>Before </w:t></w:r><w:del w:id="44" w:author="Opposing Counsel" w:date="2026-06-01T00:00:00Z"><w:r><w:delText>SECRET OTHER MATTER</w:delText></w:r></w:del><w:ins w:id="45" w:author="Opposing Counsel" w:date="2026-06-01T00:00:00Z"><w:r><w:t>public table clause</w:t></w:r></w:ins><w:r><w:t> After</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:sectPr/></w:body></w:document>"#;
    let content_types = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>"#;
    let root_rels = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>"#;

    let mut pkg = Package::new();
    pkg.insert("[Content_Types].xml", content_types.as_bytes().to_vec());
    pkg.insert("_rels/.rels", root_rels.as_bytes().to_vec());
    pkg.insert("word/document.xml", document_xml.as_bytes().to_vec());
    pkg.write_to_bytes().expect("zip package with table revisions")
}

#[test]
fn test_final_clean_accepts_tracked_changes_inside_raw_table_xml() {
    let original = build_package_with_table_revisions();
    let opened = open_docx_bytes(&original).expect("open table revisions");

    let bytes = clean_copy_bytes(&opened, ScrubOptions::final_clean()).expect("final clean copy");
    let pkg = Package::read_from_bytes(&bytes).expect("final clean copy is valid zip");
    assert!(
        validate_package(&pkg).ok(),
        "final clean copy invalid: {:?}",
        validate_package(&pkg).errors
    );

    let document_xml = pkg.get_str("word/document.xml").expect("document part");
    assert!(
        !document_xml.contains("SECRET OTHER MATTER"),
        "deleted table text leaked into final clean copy: {document_xml}"
    );
    assert!(
        !document_xml.contains("<w:del"),
        "deletion markup survived final clean copy: {document_xml}"
    );
    assert!(
        !document_xml.contains("delText"),
        "deleted-text tag survived final clean copy: {document_xml}"
    );
    assert!(
        !document_xml.contains("<w:ins"),
        "insertion wrapper survived final clean copy: {document_xml}"
    );
    assert!(
        document_xml.contains("public table clause"),
        "accepted insertion text inside table was not kept: {document_xml}"
    );
}

/// Codex review on CLUSTER-C3: a malformed/third-party `w:del` with NO
/// `w:id` attribute must still be stripped by the final-clean export — the
/// original scrubber did this unconditionally as a fail-closed safety net,
/// and a refactor sharing logic with the interactive single-revision resolve
/// initially regressed it (an id-less element could never match a `pred`, so
/// it silently survived "accept everything").
fn build_package_with_ids_less_table_deletion() -> Vec<u8> {
    let document_xml = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:tbl><w:tr><w:tc><w:p><w:r><w:t>Before </w:t></w:r><w:del w:author="Opposing Counsel" w:date="2026-06-01T00:00:00Z"><w:r><w:delText>SECRET OTHER MATTER</w:delText></w:r></w:del><w:r><w:t> After</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:sectPr/></w:body></w:document>"#;
    let content_types = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>"#;
    let root_rels = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>"#;

    let mut pkg = Package::new();
    pkg.insert("[Content_Types].xml", content_types.as_bytes().to_vec());
    pkg.insert("_rels/.rels", root_rels.as_bytes().to_vec());
    pkg.insert("word/document.xml", document_xml.as_bytes().to_vec());
    pkg.write_to_bytes().expect("zip package with an id-less table deletion")
}

#[test]
fn test_final_clean_strips_a_malformed_ids_less_deletion_inside_a_raw_table() {
    let original = build_package_with_ids_less_table_deletion();
    let opened = open_docx_bytes(&original).expect("open id-less table deletion");

    let bytes = clean_copy_bytes(&opened, ScrubOptions::final_clean()).expect("final clean copy");
    let pkg = Package::read_from_bytes(&bytes).expect("final clean copy is valid zip");
    assert!(
        validate_package(&pkg).ok(),
        "final clean copy invalid: {:?}",
        validate_package(&pkg).errors
    );

    let document_xml = pkg.get_str("word/document.xml").expect("document part");
    assert!(
        !document_xml.contains("SECRET OTHER MATTER"),
        "an id-less deleted table text leaked into final clean copy: {document_xml}"
    );
    assert!(
        !document_xml.contains("<w:del"),
        "id-less deletion markup survived final clean copy: {document_xml}"
    );
    assert!(
        !document_xml.contains("delText"),
        "id-less deleted-text tag survived final clean copy: {document_xml}"
    );
    assert!(document_xml.contains("Before") && document_xml.contains("After"));
}

/// Codex review round 2: a STRAY `w:delText` with no enclosing `w:del` at all
/// (even more malformed than an id-less `w:del`) must also be stripped by the
/// final-clean export — the original scrubber dropped `del` OR `delText`
/// unconditionally, at any depth.
fn build_package_with_stray_del_text_in_table() -> Vec<u8> {
    let document_xml = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:tbl><w:tr><w:tc><w:p><w:r><w:t>Before </w:t></w:r><w:r><w:delText>SECRET OTHER MATTER</w:delText></w:r><w:r><w:t> After</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:sectPr/></w:body></w:document>"#;
    let content_types = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>"#;
    let root_rels = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>"#;

    let mut pkg = Package::new();
    pkg.insert("[Content_Types].xml", content_types.as_bytes().to_vec());
    pkg.insert("_rels/.rels", root_rels.as_bytes().to_vec());
    pkg.insert("word/document.xml", document_xml.as_bytes().to_vec());
    pkg.write_to_bytes().expect("zip package with a stray delText in a table")
}

#[test]
fn test_final_clean_strips_a_stray_del_text_with_no_del_wrapper_inside_a_raw_table() {
    let original = build_package_with_stray_del_text_in_table();
    let opened = open_docx_bytes(&original).expect("open stray delText table");

    let bytes = clean_copy_bytes(&opened, ScrubOptions::final_clean()).expect("final clean copy");
    let pkg = Package::read_from_bytes(&bytes).expect("final clean copy is valid zip");
    assert!(
        validate_package(&pkg).ok(),
        "final clean copy invalid: {:?}",
        validate_package(&pkg).errors
    );

    let document_xml = pkg.get_str("word/document.xml").expect("document part");
    assert!(
        !document_xml.contains("SECRET OTHER MATTER"),
        "a stray delText's deleted table text leaked into final clean copy: {document_xml}"
    );
    assert!(
        !document_xml.contains("delText"),
        "stray delText tag survived final clean copy: {document_xml}"
    );
    assert!(document_xml.contains("Before") && document_xml.contains("After"));
}

#[test]
fn test_clean_copy_preserves_unmodeled_parts() {
    // Preserve-by-default still holds through a clean copy: the unmodeled
    // styles.xml passes through byte-for-byte (only docProps changed).
    let original = build_package_with_metadata_and_revisions();
    let opened = open_docx_bytes(&original).expect("open");
    let orig_pkg = Package::read_from_bytes(&original).unwrap();

    let bytes = clean_copy_bytes(&opened, ScrubOptions::metadata_only()).expect("clean copy");
    let pkg = Package::read_from_bytes(&bytes).unwrap();

    assert_eq!(
        orig_pkg.get("word/styles.xml"),
        pkg.get("word/styles.xml"),
        "unmodeled styles.xml must survive a clean copy byte-for-byte"
    );
}

#[test]
fn test_final_clean_removes_custom_properties_and_custom_xml_metadata() {
    let original = build_package_with_residual_metadata_parts();
    let opened = open_docx_bytes(&original).expect("open residual metadata docx");

    let bytes = clean_copy_bytes(&opened, ScrubOptions::final_clean()).expect("final clean copy");
    let pkg = Package::read_from_bytes(&bytes).expect("final clean copy is valid zip");
    assert!(
        validate_package(&pkg).ok(),
        "final clean copy invalid: {:?}",
        validate_package(&pkg).errors
    );
    parse_docx_bytes(&bytes).expect("final clean copy still parses");

    assert!(!pkg.contains("docProps/custom.xml"), "custom properties part survived");
    assert!(!pkg.contains("customXml/item1.xml"), "custom XML item survived");
    assert!(
        !pkg.part_names().any(|name| name.starts_with("customXml/")),
        "customXml package parts survived: {:?}",
        pkg.part_names().collect::<Vec<_>>()
    );

    let all_xml = pkg
        .parts
        .values()
        .map(|bytes| String::from_utf8_lossy(bytes))
        .collect::<Vec<_>>()
        .join("\n");
    assert!(
        !all_xml.contains("Globex privileged strategy"),
        "residual metadata payload leaked into final clean copy: {all_xml}"
    );
    assert!(
        !pkg.get_str("[Content_Types].xml")
            .unwrap()
            .contains("docProps/custom.xml"),
        "content-types still points at removed custom properties"
    );
    assert!(
        !pkg.get_str("_rels/.rels")
            .unwrap()
            .contains("custom-properties"),
        "root relationships still point at removed custom properties"
    );
    assert!(
        !pkg.get_str("word/_rels/document.xml.rels")
            .unwrap_or_default()
            .contains("customXml"),
        "document relationships still point at removed custom XML"
    );
}

/// Attribute values must be XML-unescaped on parse (and re-escaped on
/// serialize) so an author like "Smith & Jones LLP" never grows an extra
/// `amp;` per save cycle. Pre-fix, `attr()` read the raw bytes: `&amp;`
/// parsed as the literal string `&amp;`, the serializer re-escaped it to
/// `&amp;amp;`, and every subsequent cycle grew it again — progressive
/// corruption of tracked-change attribution.
#[test]
fn test_ampersand_author_attribute_does_not_grow_across_cycles() {
    let document_xml = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n<w:document xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\"><w:body><w:p><w:ins w:id=\"1\" w:author=\"Smith &amp; Jones LLP\" w:date=\"2026-06-11T00:00:00Z\"><w:r><w:t>inserted text</w:t></w:r></w:ins></w:p><w:sectPr><w:pgSz w:w=\"12240\" w:h=\"15840\"/></w:sectPr></w:body></w:document>";
    let content_types = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\"><Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/><Default Extension=\"xml\" ContentType=\"application/xml\"/><Override PartName=\"/word/document.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml\"/></Types>";
    let root_rels = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"><Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" Target=\"word/document.xml\"/></Relationships>";

    let mut pkg = Package::new();
    pkg.insert("[Content_Types].xml", content_types.as_bytes().to_vec());
    pkg.insert("_rels/.rels", root_rels.as_bytes().to_vec());
    pkg.insert("word/document.xml", document_xml.as_bytes().to_vec());
    let bytes = pkg.write_to_bytes().unwrap();

    // Cycle 1: the model must hold the UNESCAPED author.
    let doc1 = parse_docx_bytes(&bytes).expect("parse cycle 1");
    assert_eq!(doc1.revisions()[0].0.author, "Smith & Jones LLP");

    // Serialize and re-parse: the author must be stable and the on-disk XML
    // must carry exactly one level of escaping, every cycle.
    let bytes2 = serialize_docx_bytes(&doc1).expect("serialize cycle 1");
    let doc2 = parse_docx_bytes(&bytes2).expect("parse cycle 2");
    assert_eq!(doc2.revisions()[0].0.author, "Smith & Jones LLP");

    let bytes3 = serialize_docx_bytes(&doc2).expect("serialize cycle 2");
    let pkg3 = Package::read_from_bytes(&bytes3).unwrap();
    let xml3 = String::from_utf8(pkg3.get("word/document.xml").unwrap().to_vec()).unwrap();
    assert!(xml3.contains("w:author=\"Smith &amp; Jones LLP\""), "single escape level: {xml3}");
    assert!(!xml3.contains("&amp;amp;"), "no escape growth: {xml3}");
}
