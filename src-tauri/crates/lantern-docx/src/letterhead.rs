//! VG-4c — firm letterhead merge.
//!
//! Re-houses a generated document's content inside a letterhead template's
//! package, so workflow deliverables (and new documents, via a plain byte copy
//! handled on the TS side) come out on the firm's letterhead.
//!
//! # What the template contributes vs the generated document
//!
//! The template package contributes EVERY package part the generated document
//! lacks: `word/header*.xml`, `word/footer*.xml`, `word/styles.xml`,
//! `word/numbering.xml`, theme, fonts, media, and the relationship files that
//! tie them together. Crucially it also contributes the body-level `<w:sectPr>`
//! — the section-properties element that carries the `headerReference` /
//! `footerReference` that BIND the header/footer parts to the printed pages.
//! Drop the template's sectPr and the headers/footers stop rendering even
//! though their parts are present.
//!
//! The generated document contributes only its CONTENT blocks (paragraphs and
//! tables). Its own body-level sectPr — the `docx` JS Packer always emits one;
//! see `createBlankDocx`'s comment in `docx-io.ts` — is dropped in favor of the
//! template's.
//!
//! # Reconciling the generated content's OWN references (the subtle part)
//!
//! The generated content blocks are not self-contained text: a markdown
//! deliverable carries **hyperlinks** (`<w:hyperlink r:id="rIdN">`, a
//! relationship in the GENERATED `word/_rels/document.xml.rels`), **list
//! numbering** (`<w:numId w:val="N">`, a definition in the GENERATED
//! `word/numbering.xml`), and possibly **images** (`<a:blip r:embed="rIdN">`, a
//! media part + relationship). If we only swap the body into the template
//! package, those references resolve against the TEMPLATE's parts instead:
//!   * a hyperlink `r:id` that the template's rels never defined → a dangling
//!     relationship (Word may prompt to repair, and the link is dead);
//!   * a `numId` that ALSO exists in the template's numbering (it usually does —
//!     both documents start numbering at 1) → the generated list silently
//!     renders with the TEMPLATE's unrelated list style;
//!   * an image `r:embed` → a missing part (broken image / repair prompt).
//!
//! So the merge copies every body-referenced relationship (and any media part it
//! points to) and the body's numbering definitions INTO the template package,
//! allocating collision-free ids, and rewrites the body's `r:id` / `r:embed` /
//! `numId` references to the new ids. Numbering definitions are renumbered above
//! the template's existing ids and merged into the template's `numbering.xml`
//! (preserving the OOXML rule that every `<w:abstractNum>` precedes every
//! `<w:num>`).
//!
//! # Why a package merge (not a byte copy) for deliverables
//!
//! New blank documents can be a straight byte copy of the template (trivially
//! correct: header, footer, styles, and an empty body all come along). A
//! workflow deliverable already HAS generated content, so its content blocks
//! must be transplanted into the template package. This is that transplant.

use std::collections::BTreeSet;

use crate::model::{BlockContent, Inline};
use crate::package::{CONTENT_TYPES_PART, DOCUMENT_RELS_PART};
use crate::{OpenedDocument, Package};

const NUMBERING_PART: &str = "word/numbering.xml";
const NUMBERING_REL_TYPE: &str =
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering";
const NUMBERING_CONTENT_TYPE: &str =
    "application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml";

/// True when a body block is the body-level section-properties element
/// (`<w:sectPr>…`). The parser captures it as [`BlockContent::Raw`] (see
/// `parse.rs` — "PRESERVE: any other block element (tbl, sdt, sectPr, …)").
/// Paragraph-level sectPr (`<w:pPr><w:sectPr/>` marking a section break inside
/// a paragraph) lives inside a [`BlockContent::Paragraph`]'s `properties_xml`,
/// not as its own block, so it is unaffected by this body-block filter.
fn is_body_sect_pr(block: &BlockContent) -> bool {
    matches!(block, BlockContent::Raw { xml } if xml.contains("<w:sectPr"))
}

/// Re-house a generated document's content in a letterhead template's package.
///
/// The result is the template's [`OpenedDocument`] (every package part intact)
/// with its body replaced by: the generated document's content blocks (its own
/// body-level sectPr removed, and its hyperlink / image / numbering references
/// rewritten to template-package-local ids) followed by the template's
/// body-level sectPr (so the template's header/footer bindings survive). The
/// generated document's comments are carried over so AI redline comments in a
/// deliverable are not lost.
///
/// `generated` is the full [`OpenedDocument`] (DOM + its original package) — the
/// package is needed to copy across the relationships, media parts, and
/// numbering definitions the body content references.
///
/// If the template has no body-level sectPr (unusual but possible for a
/// hand-built minimal package), the merged body simply omits one and the
/// serializer synthesizes its own on save — the same fallback the engine
/// already relies on for brand-new documents.
pub fn merge_into_template(generated: &OpenedDocument, template: OpenedDocument) -> OpenedDocument {
    // Generated content blocks, minus the generated body-level sectPr.
    let mut body: Vec<BlockContent> = generated
        .document
        .body
        .iter()
        .filter(|b| !is_body_sect_pr(b))
        .cloned()
        .collect();

    // The template package is mutated as we copy in the generated content's
    // referenced parts; start from a clone so the input is not disturbed.
    let mut package = template.package.clone();

    // 1. Reconcile relationships (hyperlinks + embedded media) the body
    //    references, allocating collision-free ids in the template's rels.
    let rel_remap = reconcile_relationships(&body, generated, &mut package);

    // 2. Reconcile numbering definitions the body references, renumbered above
    //    the template's existing numbering ids.
    let num_remap = reconcile_numbering(&body, generated, &mut package);

    // 3. Rewrite the body's references to the new ids.
    if !rel_remap.is_empty() || !num_remap.is_empty() {
        for block in body.iter_mut() {
            rewrite_block_refs(block, &rel_remap, &num_remap);
        }
    }

    // 4. Append the template's body-level sectPr (the last one, the way Word
    //    places the final section). This is what binds the letterhead's
    //    header/footer parts to the pages.
    if let Some(sect) = template
        .document
        .body
        .iter()
        .rev()
        .find(|b| is_body_sect_pr(b))
    {
        body.push(sect.clone());
    }

    let mut doc = template.document.clone();
    doc.body = body;
    doc.comments = generated.document.comments.clone();

    OpenedDocument {
        document: doc,
        package,
    }
}

// ---------------------------------------------------------------------------
// Relationship reconciliation (hyperlinks + embedded media)
// ---------------------------------------------------------------------------

/// A relationship parsed out of a `.rels` part.
struct Relationship {
    id: String,
    rel_type: String,
    target: String,
    external: bool,
}

/// Copy every relationship the body references from the generated package's
/// `word/_rels/document.xml.rels` into the template's, allocating fresh
/// (collision-free) ids and copying any internal media part the relationship
/// points to. Returns the `old id -> new id` remap to apply to the body.
fn reconcile_relationships(
    body: &[BlockContent],
    generated: &OpenedDocument,
    package: &mut Package,
) -> Vec<(String, String)> {
    let referenced = collect_referenced_rel_ids(body);
    if referenced.is_empty() {
        return Vec::new();
    }

    let Some(gen_rels_xml) = generated.package.get_str(DOCUMENT_RELS_PART) else {
        return Vec::new();
    };
    let gen_rels = parse_relationships(&gen_rels_xml);

    // The template's rels (synthesize a minimal manifest if it had none).
    let mut tmpl_rels_xml = package.get_str(DOCUMENT_RELS_PART).unwrap_or_else(|| {
        "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n\
         <Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"></Relationships>".to_string()
    });

    let mut next_rel = max_rel_id_num(&tmpl_rels_xml) + 1;
    let mut next_media = max_media_index(package) + 1;
    let mut remap = Vec::new();

    for old_id in referenced {
        let Some(rel) = gen_rels.iter().find(|r| r.id == old_id) else {
            // Referenced id with no matching generated relationship — leave it
            // as-is (nothing we can do; it was already broken in the source).
            continue;
        };

        let new_id = format!("rId{next_rel}");
        next_rel += 1;

        let target = if rel.external {
            // External targets (hyperlinks) carry no part — just the URL.
            rel.target.clone()
        } else {
            // Internal target → copy the part it points to (typically media)
            // into the template package under a non-colliding name, and ensure
            // its content-type default exists.
            let gen_part = resolve_internal_part(&rel.target);
            match generated.package.get(&gen_part).map(|b| b.to_vec()) {
                Some(bytes) => {
                    let ext = extension_of(&gen_part);
                    let new_part = format!("word/media/image{next_media}.{ext}");
                    next_media += 1;
                    package.insert(new_part.clone(), bytes);
                    ensure_media_content_type(package, &ext);
                    // rels Target is relative to word/.
                    new_part.trim_start_matches("word/").to_string()
                }
                None => {
                    // Missing part in the source — skip (do not emit a dangling
                    // relationship into the template).
                    continue;
                }
            }
        };

        let mode_attr = if rel.external {
            " TargetMode=\"External\""
        } else {
            ""
        };
        let entry = format!(
            "<Relationship Id=\"{new_id}\" Type=\"{}\" Target=\"{target}\"{mode_attr}/>",
            rel.rel_type
        );
        tmpl_rels_xml = insert_before(&tmpl_rels_xml, "</Relationships>", &entry);
        remap.push((old_id, new_id));
    }

    package.insert(DOCUMENT_RELS_PART, tmpl_rels_xml.into_bytes());
    remap
}

/// Collect the distinct `r:id` / `r:embed` values referenced anywhere in the
/// body's verbatim XML spans (inline-level `Inline::Raw` such as hyperlinks and
/// drawings, and block-level `BlockContent::Raw` such as tables, whose cells can
/// themselves contain hyperlinks or images).
fn collect_referenced_rel_ids(body: &[BlockContent]) -> BTreeSet<String> {
    let mut ids = BTreeSet::new();
    for block in body {
        match block {
            BlockContent::Paragraph(p) => {
                for inline in &p.inlines {
                    if let Inline::Raw { xml } = inline {
                        scan_attr_values(xml, "r:id", &mut ids);
                        scan_attr_values(xml, "r:embed", &mut ids);
                    }
                }
            }
            BlockContent::Raw { xml } => {
                scan_attr_values(xml, "r:id", &mut ids);
                scan_attr_values(xml, "r:embed", &mut ids);
            }
        }
    }
    ids
}

// ---------------------------------------------------------------------------
// Numbering reconciliation
// ---------------------------------------------------------------------------

/// Copy the numbering definitions the body references from the generated
/// package's `word/numbering.xml` into the template's, renumbered above the
/// template's existing ids. Returns the `old numId -> new numId` remap.
fn reconcile_numbering(
    body: &[BlockContent],
    generated: &OpenedDocument,
    package: &mut Package,
) -> Vec<(u32, u32)> {
    let referenced = collect_referenced_num_ids(body);
    if referenced.is_empty() {
        return Vec::new();
    }

    let Some(gen_num_xml) = generated.package.get_str(NUMBERING_PART) else {
        return Vec::new();
    };

    // Existing template numbering (or none yet).
    let tmpl_num_xml = package.get_str(NUMBERING_PART);
    // A single shared counter above everything the template already uses keeps
    // both abstractNumId and numId assignments collision-free (they are disjoint
    // id spaces, but a shared high base is the simplest correct allocator).
    let base = tmpl_num_xml.as_deref().map(max_numbering_id).unwrap_or(0) + 1;

    // Pull the referenced <w:num> blocks (and the <w:abstractNum> blocks they
    // transitively reference) out of the generated numbering, renumbered.
    let mut next_id = base;
    let mut abstract_remap: Vec<(u32, u32)> = Vec::new(); // old absId -> new
    let mut num_remap: Vec<(u32, u32)> = Vec::new(); // old numId -> new
    let mut new_abstract_blocks: Vec<String> = Vec::new();
    let mut new_num_blocks: Vec<String> = Vec::new();

    let gen_num_blocks = extract_elements(&gen_num_xml, "w:num");
    let gen_abstract_blocks = extract_elements(&gen_num_xml, "w:abstractNum");

    for old_num_id in &referenced {
        let Some(block) = gen_num_blocks.iter().find(|b| {
            attr_u32(b, "w:num", "w:numId") == Some(*old_num_id)
        }) else {
            continue;
        };
        let old_abs = match inner_abstract_num_id(block) {
            Some(a) => a,
            None => continue,
        };

        // Allocate (or reuse) the new abstractNumId for this old one.
        let new_abs = match abstract_remap.iter().find(|(o, _)| *o == old_abs) {
            Some((_, n)) => *n,
            None => {
                let new_abs = next_id;
                next_id += 1;
                // Find and renumber the abstractNum definition.
                if let Some(abs_block) = gen_abstract_blocks.iter().find(|b| {
                    attr_u32(b, "w:abstractNum", "w:abstractNumId") == Some(old_abs)
                }) {
                    let renumbered = abs_block.replace(
                        &format!("w:abstractNumId=\"{old_abs}\""),
                        &format!("w:abstractNumId=\"{new_abs}\""),
                    );
                    new_abstract_blocks.push(renumbered);
                }
                abstract_remap.push((old_abs, new_abs));
                new_abs
            }
        };

        let new_num_id = next_id;
        next_id += 1;
        // Renumber the num block: its own numId, and the abstractNumId it points
        // to (the child `<w:abstractNumId w:val="..">`).
        let renumbered = block
            .replace(
                &format!("w:numId=\"{old_num_id}\""),
                &format!("w:numId=\"{new_num_id}\""),
            )
            .replace(
                &format!("<w:abstractNumId w:val=\"{old_abs}\""),
                &format!("<w:abstractNumId w:val=\"{new_abs}\""),
            );
        new_num_blocks.push(renumbered);
        num_remap.push((*old_num_id, new_num_id));
    }

    if new_num_blocks.is_empty() {
        return Vec::new();
    }

    let abstract_joined = new_abstract_blocks.join("");
    let num_joined = new_num_blocks.join("");

    match tmpl_num_xml {
        Some(existing) => {
            // Insert nums before the close tag, then abstractNums before the
            // first existing num (or before the close if the template had none),
            // preserving the all-abstractNum-then-all-num ordering OOXML wants.
            let with_nums = insert_before(&existing, "</w:numbering>", &num_joined);
            let merged = if with_nums.contains("<w:num ") {
                with_nums.replacen("<w:num ", &format!("{abstract_joined}<w:num "), 1)
            } else {
                insert_before(&with_nums, "</w:numbering>", &abstract_joined)
            };
            package.insert(NUMBERING_PART, merged.into_bytes());
        }
        None => {
            // The template had no numbering part — synthesize one and wire it up.
            let numbering = format!(
                "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n\
                 <w:numbering xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\">\
                 {abstract_joined}{num_joined}</w:numbering>"
            );
            package.insert(NUMBERING_PART, numbering.into_bytes());
            ensure_numbering_content_type(package);
            ensure_numbering_relationship(package);
        }
    }

    num_remap
}

/// Collect the distinct `numId` values the body references (in paragraph
/// `<w:pPr>` numbering, and inside table-block raw XML cell paragraphs).
fn collect_referenced_num_ids(body: &[BlockContent]) -> BTreeSet<u32> {
    let mut ids = BTreeSet::new();
    for block in body {
        match block {
            BlockContent::Paragraph(p) => {
                if let Some(ppr) = &p.properties_xml {
                    scan_num_id_vals(ppr, &mut ids);
                }
            }
            BlockContent::Raw { xml } => {
                scan_num_id_vals(xml, &mut ids);
            }
        }
    }
    ids
}

// ---------------------------------------------------------------------------
// Body reference rewriting
// ---------------------------------------------------------------------------

/// Rewrite a body block's hyperlink/media ids and numbering ids in place.
fn rewrite_block_refs(
    block: &mut BlockContent,
    rel_remap: &[(String, String)],
    num_remap: &[(u32, u32)],
) {
    match block {
        BlockContent::Paragraph(p) => {
            if let Some(ppr) = &mut p.properties_xml {
                *ppr = rewrite_num_ids(ppr, num_remap);
            }
            for inline in &mut p.inlines {
                if let Inline::Raw { xml } = inline {
                    *xml = rewrite_rel_ids(xml, rel_remap);
                }
            }
        }
        BlockContent::Raw { xml } => {
            // Tables can carry BOTH hyperlinks/images and numbered cell text.
            let rewritten = rewrite_rel_ids(xml, rel_remap);
            *xml = rewrite_num_ids(&rewritten, num_remap);
        }
    }
}

/// Rewrite `r:id="old"` and `r:embed="old"` to their remapped ids.
fn rewrite_rel_ids(xml: &str, remap: &[(String, String)]) -> String {
    let mut out = xml.to_string();
    for (old, new) in remap {
        out = out.replace(&format!("r:id=\"{old}\""), &format!("r:id=\"{new}\""));
        out = out.replace(&format!("r:embed=\"{old}\""), &format!("r:embed=\"{new}\""));
    }
    out
}

/// Rewrite `<w:numId w:val="old"` to its remapped id. The `<w:numId ` prefix is
/// matched explicitly so this never touches `<w:abstractNumId w:val="..">`.
fn rewrite_num_ids(xml: &str, remap: &[(u32, u32)]) -> String {
    let mut out = xml.to_string();
    for (old, new) in remap {
        out = out.replace(
            &format!("<w:numId w:val=\"{old}\""),
            &format!("<w:numId w:val=\"{new}\""),
        );
    }
    out
}

// ---------------------------------------------------------------------------
// Small XML/string helpers (targeted, structure-aware — see scan/extract docs)
// ---------------------------------------------------------------------------

/// Insert `insertion` immediately before the first occurrence of `marker`. If
/// `marker` is absent, append `insertion` at the end (best-effort; the callers
/// only pass markers known to exist).
fn insert_before(haystack: &str, marker: &str, insertion: &str) -> String {
    match haystack.find(marker) {
        Some(idx) => {
            let mut out = String::with_capacity(haystack.len() + insertion.len());
            out.push_str(&haystack[..idx]);
            out.push_str(insertion);
            out.push_str(&haystack[idx..]);
            out
        }
        None => format!("{haystack}{insertion}"),
    }
}

/// Collect every value of attribute `attr` (e.g. `r:id`) appearing as
/// `attr="value"` in `xml`. Ids are opaque tokens, so a direct attribute scan is
/// exact here.
fn scan_attr_values(xml: &str, attr: &str, out: &mut BTreeSet<String>) {
    let needle = format!("{attr}=\"");
    let mut rest = xml;
    while let Some(pos) = rest.find(&needle) {
        let after = &rest[pos + needle.len()..];
        if let Some(end) = after.find('"') {
            let val = &after[..end];
            if !val.is_empty() {
                out.insert(val.to_string());
            }
            rest = &after[end + 1..];
        } else {
            break;
        }
    }
}

/// Collect every numeric value of `<w:numId w:val="N"`. The `<w:numId ` prefix
/// is required so `<w:abstractNumId w:val="N"` is never picked up.
fn scan_num_id_vals(xml: &str, out: &mut BTreeSet<u32>) {
    let needle = "<w:numId w:val=\"";
    let mut rest = xml;
    while let Some(pos) = rest.find(needle) {
        let after = &rest[pos + needle.len()..];
        if let Some(end) = after.find('"') {
            if let Ok(n) = after[..end].parse::<u32>() {
                out.insert(n);
            }
            rest = &after[end + 1..];
        } else {
            break;
        }
    }
}

/// Highest `rIdN` numeric suffix used in a `.rels` manifest (0 if none).
fn max_rel_id_num(rels_xml: &str) -> u32 {
    let mut max = 0;
    let needle = "Id=\"rId";
    let mut rest = rels_xml;
    while let Some(pos) = rest.find(needle) {
        let after = &rest[pos + needle.len()..];
        let digits: String = after.chars().take_while(|c| c.is_ascii_digit()).collect();
        if let Ok(n) = digits.parse::<u32>() {
            max = max.max(n);
        }
        rest = &after[digits.len()..];
    }
    max
}

/// Highest `word/media/imageN.*` index already in the package (0 if none).
fn max_media_index(package: &Package) -> u32 {
    let mut max = 0;
    for name in package.part_names() {
        if let Some(rest) = name.strip_prefix("word/media/image") {
            let digits: String = rest.chars().take_while(|c| c.is_ascii_digit()).collect();
            if let Ok(n) = digits.parse::<u32>() {
                max = max.max(n);
            }
        }
    }
    max
}

/// Highest numbering id used anywhere in a `numbering.xml` (covers abstractNum
/// ids, num ids, and `w:val` references — a single ceiling for the shared
/// allocator). 0 if none.
fn max_numbering_id(num_xml: &str) -> u32 {
    let mut max = 0;
    for needle in [
        "w:abstractNumId=\"",
        "w:numId=\"",
        "<w:abstractNumId w:val=\"",
    ] {
        let mut rest = num_xml;
        while let Some(pos) = rest.find(needle) {
            let after = &rest[pos + needle.len()..];
            let digits: String = after.chars().take_while(|c| c.is_ascii_digit()).collect();
            if let Ok(n) = digits.parse::<u32>() {
                max = max.max(n);
            }
            rest = &after[digits.len().max(1)..];
        }
    }
    max
}

/// Resolve a `word/_rels/document.xml.rels` Target (relative to `word/`) to a
/// package part name.
fn resolve_internal_part(target: &str) -> String {
    let t = target.trim_start_matches("./");
    if let Some(rest) = t.strip_prefix("../") {
        rest.to_string()
    } else {
        format!("word/{t}")
    }
}

/// Lowercased file extension of a part name (empty if none).
fn extension_of(part: &str) -> String {
    part.rsplit('.')
        .next()
        .filter(|e| !e.contains('/'))
        .map(|e| e.to_ascii_lowercase())
        .unwrap_or_default()
}

/// MIME type for a media extension (best-effort; octet-stream fallback).
fn media_mime(ext: &str) -> &'static str {
    match ext {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "bmp" => "image/bmp",
        "tif" | "tiff" => "image/tiff",
        "emf" => "image/x-emf",
        "wmf" => "image/x-wmf",
        "svg" => "image/svg+xml",
        _ => "application/octet-stream",
    }
}

/// Ensure `[Content_Types].xml` declares a `<Default>` for `ext`.
fn ensure_media_content_type(package: &mut Package, ext: &str) {
    if ext.is_empty() {
        return;
    }
    let Some(ct) = package.get_str(CONTENT_TYPES_PART) else {
        return;
    };
    let probe = format!("Extension=\"{ext}\"");
    if ct.contains(&probe) {
        return;
    }
    let entry = format!(
        "<Default Extension=\"{ext}\" ContentType=\"{}\"/>",
        media_mime(ext)
    );
    let patched = insert_before(&ct, "</Types>", &entry);
    package.insert(CONTENT_TYPES_PART, patched.into_bytes());
}

/// Ensure `[Content_Types].xml` declares the numbering part override.
fn ensure_numbering_content_type(package: &mut Package) {
    let Some(ct) = package.get_str(CONTENT_TYPES_PART) else {
        return;
    };
    if ct.contains("/word/numbering.xml") {
        return;
    }
    let entry = format!(
        "<Override PartName=\"/word/numbering.xml\" ContentType=\"{NUMBERING_CONTENT_TYPE}\"/>"
    );
    let patched = insert_before(&ct, "</Types>", &entry);
    package.insert(CONTENT_TYPES_PART, patched.into_bytes());
}

/// Ensure `word/_rels/document.xml.rels` relates the document to numbering.xml.
fn ensure_numbering_relationship(package: &mut Package) {
    let rels = package.get_str(DOCUMENT_RELS_PART).unwrap_or_else(|| {
        "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n\
         <Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"></Relationships>".to_string()
    });
    if rels.contains(NUMBERING_REL_TYPE) {
        return;
    }
    let id = format!("rId{}", max_rel_id_num(&rels) + 1);
    let entry = format!(
        "<Relationship Id=\"{id}\" Type=\"{NUMBERING_REL_TYPE}\" Target=\"numbering.xml\"/>"
    );
    let patched = insert_before(&rels, "</Relationships>", &entry);
    package.insert(DOCUMENT_RELS_PART, patched.into_bytes());
}

/// Parse `<Relationship>` entries out of a `.rels` manifest.
fn parse_relationships(rels_xml: &str) -> Vec<Relationship> {
    use quick_xml::events::Event;
    use quick_xml::reader::Reader;
    let mut reader = Reader::from_str(rels_xml);
    reader.config_mut().trim_text(false);
    let mut out = Vec::new();
    loop {
        match reader.read_event() {
            Ok(Event::Empty(e)) | Ok(Event::Start(e))
                if local_name(e.name().as_ref()) == "Relationship" =>
            {
                let id = rels_attr(&e, "Id");
                let rel_type = rels_attr(&e, "Type");
                let target = rels_attr(&e, "Target");
                let mode = rels_attr(&e, "TargetMode");
                if let (Some(id), Some(rel_type), Some(target)) = (id, rel_type, target) {
                    out.push(Relationship {
                        id,
                        rel_type,
                        target,
                        external: mode.as_deref() == Some("External"),
                    });
                }
            }
            Ok(Event::Eof) => break,
            Ok(_) => {}
            Err(_) => break,
        }
    }
    out
}

fn local_name(b: &[u8]) -> &str {
    let l = match b.iter().position(|&c| c == b':') {
        Some(i) => &b[i + 1..],
        None => b,
    };
    std::str::from_utf8(l).unwrap_or("")
}

fn rels_attr(e: &quick_xml::events::BytesStart, want: &str) -> Option<String> {
    e.attributes().with_checks(false).flatten().find_map(|a| {
        if local_name(a.key.as_ref()) == want {
            Some(String::from_utf8_lossy(&a.value).into_owned())
        } else {
            None
        }
    })
}

/// Extract each top-level `<{tag} ...>…</{tag}>` element's full text from `xml`.
/// Relies on the fact that, in `numbering.xml`, neither `w:abstractNum` nor
/// `w:num` nests inside another element of the same name, so the next matching
/// close tag is the element's own. `w:num` is matched as `<w:num ` / `<w:num>`
/// so it never captures `<w:numbering` or `<w:numPr`.
fn extract_elements(xml: &str, tag: &str) -> Vec<String> {
    let open_space = format!("<{tag} ");
    let open_close = format!("<{tag}>");
    let close = format!("</{tag}>");
    let mut out = Vec::new();
    let mut rest = xml;
    loop {
        let pos_space = rest.find(&open_space);
        let pos_close = rest.find(&open_close);
        let start = match (pos_space, pos_close) {
            (Some(a), Some(b)) => a.min(b),
            (Some(a), None) => a,
            (None, Some(b)) => b,
            (None, None) => break,
        };
        let after_start = &rest[start..];
        let Some(end_rel) = after_start.find(&close) else {
            break;
        };
        let end = end_rel + close.len();
        out.push(after_start[..end].to_string());
        rest = &after_start[end..];
    }
    out
}

/// Read a numeric attribute `attr` from a `<{tag} ...>` element's start tag.
fn attr_u32(element: &str, tag: &str, attr: &str) -> Option<u32> {
    let start_end = element.find('>')?;
    let start_tag = &element[..start_end];
    if local_name_of_open(start_tag) != tag.trim_start_matches("w:") {
        // Tolerate either qualified or local; fall through to a direct scan.
    }
    let needle = format!("{attr}=\"");
    let pos = start_tag.find(&needle)?;
    let after = &start_tag[pos + needle.len()..];
    let digits: String = after.chars().take_while(|c| c.is_ascii_digit()).collect();
    digits.parse::<u32>().ok()
}

fn local_name_of_open(start_tag: &str) -> &str {
    let name = start_tag.trim_start_matches('<');
    let name = name.split([' ', '\t', '\n', '\r', '>']).next().unwrap_or("");
    match name.split_once(':') {
        Some((_, l)) => l,
        None => name,
    }
}

/// The `<w:abstractNumId w:val="N"/>` child value of a `<w:num>` block.
fn inner_abstract_num_id(num_block: &str) -> Option<u32> {
    let needle = "<w:abstractNumId w:val=\"";
    let pos = num_block.find(needle)?;
    let after = &num_block[pos + needle.len()..];
    let digits: String = after.chars().take_while(|c| c.is_ascii_digit()).collect();
    digits.parse::<u32>().ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{Comment, Document, Inline, Paragraph, Run};
    use crate::{open_docx_bytes, serialize_docx_bytes, Package};

    /// Absolute path to a matter-corpus fixture. `CARGO_MANIFEST_DIR` points to
    /// `src-tauri/crates/lantern-docx/` (same helper as `text.rs` /
    /// `tests/campaign_fixtures.rs`).
    fn corpus_path(filename: &str) -> std::path::PathBuf {
        let manifest = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
        let repo_root = manifest
            .parent() // crates/
            .and_then(|p| p.parent()) // src-tauri/
            .and_then(|p| p.parent()) // repo root
            .expect("unexpected crate layout");
        repo_root
            .join("tests")
            .join("fixtures")
            .join("matter-corpus")
            .join(filename)
    }

    fn read_fixture(filename: &str) -> Vec<u8> {
        let path = corpus_path(filename);
        assert!(
            path.exists(),
            "fixture missing: {:?} — run generators/generate-fixtures.py",
            path
        );
        std::fs::read(&path).expect("read fixture")
    }

    fn template() -> OpenedDocument {
        open_docx_bytes(&read_fixture("letterhead-template.docx")).expect("open template")
    }

    /// Count body-level `<w:sectPr>` occurrences in a package's
    /// `word/document.xml`.
    fn body_sect_pr_count(bytes: &[u8]) -> usize {
        let pkg = Package::read_from_bytes(bytes).expect("valid package");
        let doc_xml = pkg
            .get_str("word/document.xml")
            .expect("document.xml present");
        doc_xml.matches("<w:sectPr").count()
    }

    /// Round-trip a synthetic `Document` into an `OpenedDocument` with a real
    /// minimal package (the way a generated deliverable arrives).
    fn opened_from_doc(doc: &Document) -> OpenedDocument {
        let bytes = serialize_docx_bytes(doc).expect("serialize synthetic generated doc");
        open_docx_bytes(&bytes).expect("reopen synthetic generated doc")
    }

    /// A small synthetic "generated" document: one content paragraph plus a
    /// trailing body-level sectPr Raw block (the shape the `docx` JS Packer
    /// emits — the thing the merge must drop).
    fn generated_with_own_sectpr(body_text: &str) -> OpenedDocument {
        let doc = Document {
            body: vec![
                BlockContent::Paragraph(Paragraph::from_inlines(vec![Inline::Run(Run::new(
                    body_text,
                ))])),
                BlockContent::Raw {
                    xml: r#"<w:sectPr w:rsidR="GENERATEDSTUB"><w:pgSz w:w="12240" w:h="15840"/></w:sectPr>"#.into(),
                },
            ],
            ..Default::default()
        };
        opened_from_doc(&doc)
    }

    /// Build a generated `OpenedDocument` by hand whose body carries a hyperlink
    /// (backed by a rel in its package) and a numbered + bulleted paragraph
    /// (backed by its own numbering.xml). `numId` 1 and 2 deliberately COLLIDE
    /// with the letterhead template's own numbering (which defines numId 1-9).
    fn generated_with_links_and_numbering() -> OpenedDocument {
        let document_xml = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<w:body>
<w:p><w:r><w:t>Intro paragraph.</w:t></w:r></w:p>
<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="2"/></w:numPr></w:pPr><w:r><w:t>First numbered</w:t></w:r></w:p>
<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>A bullet</w:t></w:r></w:p>
<w:p><w:hyperlink r:id="rIdGENLINK" w:history="1"><w:r><w:t>see the ruling</w:t></w:r></w:hyperlink></w:p>
<w:sectPr w:rsidR="GENERATEDSTUB"><w:pgSz w:w="12240" w:h="15840"/></w:sectPr>
</w:body>
</w:document>"#;
        let document_rels = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rIdGENLINK" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.com/ruling" TargetMode="External"/>
</Relationships>"#;
        // Two abstractNums (0 = decimal/ordered, 1 = bullet) and two nums (numId
        // 2 -> abs 0, numId 1 -> abs 1) — same id shape the docx JS Packer emits.
        let numbering_xml = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl></w:abstractNum>
<w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/></w:lvl></w:abstractNum>
<w:num w:numId="2"><w:abstractNumId w:val="0"/></w:num>
<w:num w:numId="1"><w:abstractNumId w:val="1"/></w:num>
</w:numbering>"#;
        let content_types = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>
</Types>"#;
        let root_rels = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>"#;

        let mut pkg = Package::new();
        pkg.insert("[Content_Types].xml", content_types.as_bytes().to_vec());
        pkg.insert("_rels/.rels", root_rels.as_bytes().to_vec());
        pkg.insert("word/document.xml", document_xml.as_bytes().to_vec());
        pkg.insert(
            "word/_rels/document.xml.rels",
            document_rels.as_bytes().to_vec(),
        );
        pkg.insert("word/numbering.xml", numbering_xml.as_bytes().to_vec());

        let document =
            crate::parse::parse_document(document_xml, None).expect("parse synthetic generated");
        OpenedDocument {
            document,
            package: pkg,
        }
    }

    #[test]
    fn merge_keeps_template_header_part_and_one_sectpr_with_generated_body() {
        // Generated document: open a real fixture so the body is realistic.
        let generated =
            open_docx_bytes(&read_fixture("contract-services-agreement.docx")).expect("open gen");
        let generated_sectpr = generated
            .document
            .body
            .iter()
            .filter(|b| is_body_sect_pr(b))
            .count();
        assert!(
            generated_sectpr >= 1,
            "test premise: the source doc should have a body-level sectPr"
        );

        let template = template();
        assert!(
            template.package.contains("word/header1.xml"),
            "template should carry a header part"
        );

        let merged = merge_into_template(&generated, template);
        let bytes = merged.save_bytes().expect("serialize merged");

        let reopened = open_docx_bytes(&bytes).expect("merged doc re-opens cleanly");
        assert!(
            reopened.package.contains("word/header1.xml"),
            "merged package must keep the template header part"
        );
        assert!(
            reopened.package.contains("word/footer1.xml"),
            "merged package must keep the template footer part"
        );
        assert_eq!(
            body_sect_pr_count(&bytes),
            1,
            "merged document must have exactly one body-level sectPr (the template's)"
        );

        let texts = crate::text::extract_paragraph_texts(&reopened.document);
        let joined = texts.join("\n\n");
        assert!(
            joined.contains("blended hourly rate of $375 per hour"),
            "generated body content must be present in the merged document:\n{joined}"
        );
    }

    #[test]
    fn merge_carries_generated_comments_and_drops_only_sectpr_blocks() {
        let mut generated = generated_with_own_sectpr("Deliverable body.");
        generated.document.comments.insert(
            "7".into(),
            Comment {
                id: "7".into(),
                author: "Lantern AI".into(),
                date: "2026-06-11T00:00:00Z".into(),
                initials: None,
                text: "Verify this clause.".into(),
                body_xml: None,
            },
        );

        let merged = merge_into_template(&generated, template());

        assert!(
            merged.document.comments.contains_key("7"),
            "generated comments must survive the merge"
        );
        let para_blocks = merged
            .document
            .body
            .iter()
            .filter(|b| matches!(b, BlockContent::Paragraph(_)))
            .count();
        assert!(para_blocks >= 1, "generated content paragraph must survive");
        let sect_blocks = merged
            .document
            .body
            .iter()
            .filter(|b| is_body_sect_pr(b))
            .count();
        assert_eq!(
            sect_blocks, 1,
            "exactly one body-level sectPr (the template's) after merge"
        );
        let has_generated_stub = merged
            .document
            .body
            .iter()
            .any(|b| matches!(b, BlockContent::Raw { xml } if xml.contains("GENERATEDSTUB")));
        assert!(
            !has_generated_stub,
            "the generated document's own sectPr stub must be dropped"
        );
    }

    #[test]
    fn merge_with_template_lacking_sectpr_omits_one() {
        let minimal_doc_xml = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t></w:t></w:r></w:p></w:body></w:document>"#;
        let mut pkg = Package::new();
        pkg.insert("word/document.xml", minimal_doc_xml.as_bytes().to_vec());
        let template = OpenedDocument {
            document: crate::parse::parse_document(minimal_doc_xml, None).expect("parse minimal"),
            package: pkg,
        };

        let generated = generated_with_own_sectpr("Body only.");
        let merged = merge_into_template(&generated, template);

        let sect_blocks = merged
            .document
            .body
            .iter()
            .filter(|b| is_body_sect_pr(b))
            .count();
        assert_eq!(sect_blocks, 0, "no template sectPr to carry, so none is added");
        assert!(
            merged
                .document
                .body
                .iter()
                .any(|b| matches!(b, BlockContent::Paragraph(_))),
            "generated content must be present"
        );
    }

    // ---- Reference reconciliation (the VG-4c fidelity fix) -----------------

    /// Helper: the merged `word/_rels/document.xml.rels` as a string.
    fn merged_rels(bytes: &[u8]) -> String {
        Package::read_from_bytes(bytes)
            .unwrap()
            .get_str("word/_rels/document.xml.rels")
            .unwrap_or_default()
    }
    fn merged_numbering(bytes: &[u8]) -> String {
        Package::read_from_bytes(bytes)
            .unwrap()
            .get_str("word/numbering.xml")
            .unwrap_or_default()
    }
    fn merged_document(bytes: &[u8]) -> String {
        Package::read_from_bytes(bytes)
            .unwrap()
            .get_str("word/document.xml")
            .unwrap()
    }

    #[test]
    fn merge_reconciles_generated_hyperlink_into_the_template_package() {
        let generated = generated_with_links_and_numbering();
        let bytes = merge_into_template(&generated, template())
            .save_bytes()
            .expect("serialize");

        let rels = merged_rels(&bytes);
        let doc = merged_document(&bytes);

        // The hyperlink's external target made it into the template's rels.
        assert!(
            rels.contains("Target=\"https://example.com/ruling\""),
            "hyperlink target must be copied into the template rels:\n{rels}"
        );
        assert!(
            rels.contains("TargetMode=\"External\""),
            "copied hyperlink must stay external"
        );

        // The body no longer references the OLD generated id, and the id it now
        // references actually exists in the merged rels (no dangling link).
        assert!(
            !doc.contains("r:id=\"rIdGENLINK\""),
            "the body must not keep the generated-package-local hyperlink id"
        );
        let body_id = extract_first(&doc, "r:id=\"", "\"")
            .expect("body still has a hyperlink r:id after merge");
        assert!(
            rels.contains(&format!("Id=\"{body_id}\"")),
            "the body's hyperlink id {body_id} must resolve in the merged rels"
        );
    }

    #[test]
    fn merge_reconciles_generated_numbering_without_colliding_with_template() {
        let generated = generated_with_links_and_numbering();
        let bytes = merge_into_template(&generated, template())
            .save_bytes()
            .expect("serialize");

        let numbering = merged_numbering(&bytes);
        let doc = merged_document(&bytes);

        // The template's own numbering (numId 1-9) is still present and intact.
        assert!(
            numbering.contains("<w:num w:numId=\"9\""),
            "template numbering must survive the merge"
        );

        // The generated body's numId references were remapped ABOVE the
        // template's range (the template defines 1-9; collisions 1 and 2 must be
        // gone from the BODY's references).
        let body_num_ids = all_num_id_vals(&doc);
        assert!(
            !body_num_ids.is_empty(),
            "the generated body should still carry numbered paragraphs"
        );
        for id in &body_num_ids {
            assert!(
                *id > 9,
                "generated body numId {id} must be remapped above the template's max (9), not collide"
            );
            // ...and each remapped numId must be defined in the merged numbering.
            assert!(
                numbering.contains(&format!("<w:num w:numId=\"{id}\"")),
                "remapped numId {id} must have a definition in the merged numbering.xml"
            );
        }

        // The decimal (ordered) abstractNum from the generated doc came across,
        // so the ordered list keeps its ordered format (not the template's).
        assert!(
            numbering.contains("<w:numFmt w:val=\"decimal\"/>"),
            "the generated ordered-list format must be carried into the merged numbering"
        );

        // OOXML ordering invariant: every abstractNum precedes every num.
        let last_abstract = numbering.rfind("</w:abstractNum>").unwrap_or(0);
        let first_num = numbering.find("<w:num ").unwrap_or(usize::MAX);
        assert!(
            last_abstract < first_num,
            "all abstractNum elements must precede all num elements in merged numbering"
        );
    }

    #[test]
    fn merged_doc_with_links_and_numbering_reopens_cleanly() {
        let generated = generated_with_links_and_numbering();
        let bytes = merge_into_template(&generated, template())
            .save_bytes()
            .expect("serialize");
        // Full open path (package read + parse) succeeds — no malformed parts.
        let reopened = open_docx_bytes(&bytes).expect("merged doc re-opens cleanly");
        let texts = crate::text::extract_paragraph_texts(&reopened.document);
        let joined = texts.join("\n");
        assert!(joined.contains("First numbered"), "ordered item present");
        assert!(joined.contains("see the ruling"), "hyperlink text present");
        // Exactly one body sectPr (the template's).
        assert_eq!(body_sect_pr_count(&bytes), 1);
    }

    // -- tiny test helpers --

    fn extract_first(s: &str, start: &str, end: &str) -> Option<String> {
        let pos = s.find(start)? + start.len();
        let rest = &s[pos..];
        let e = rest.find(end)?;
        Some(rest[..e].to_string())
    }

    fn all_num_id_vals(doc: &str) -> Vec<u32> {
        let mut out = BTreeSet::new();
        scan_num_id_vals(doc, &mut out);
        out.into_iter().collect()
    }
}
