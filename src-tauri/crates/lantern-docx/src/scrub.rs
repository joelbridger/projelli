//! Privilege-safe "clean copy" export: strip hidden / identifying metadata from
//! a `.docx` package before it leaves the user's machine.
//!
//! # Why this exists (the legal risk)
//!
//! A `.docx` carries far more than its visible text. Word records authorship and
//! editing history in two metadata parts that travel with the file and that most
//! users never see:
//!
//!   * `docProps/core.xml` — Dublin-Core "core properties": `dc:creator`
//!     (original author), `cp:lastModifiedBy` (who last saved), `cp:revision`
//!     (save count), `dcterms:created` / `dcterms:modified` (timestamps), plus
//!     `cp:category` / `cp:keywords` / `dc:description` and the like.
//!   * `docProps/app.xml` — "extended properties": `Company`, `Manager`,
//!     `Template`, the `TitlesOfParts` outline, total edit time, etc.
//!   * `docProps/custom.xml` and `customXml/**` — custom document properties
//!     and embedded XML data stores frequently used by templates, DMS systems,
//!     and add-ins to carry matter ids, client names, and workflow state.
//!
//! For a firm sending a document to opposing counsel, leaving these in place can
//! disclose who drafted a clause, which client template it came from, how many
//! revisions it went through, and the name of a partner who never appears in the
//! body. That is exactly the kind of *inadvertent metadata disclosure* the bar
//! warns about. The "clean copy" export removes it before writing.
//!
//! # What it does NOT touch
//!
//! Scrubbing operates ONLY on the metadata parts (and, optionally, comments). It
//! never rewrites `document.xml`, so the visible content — and crucially the
//! **tracked-change author attribution** the user deliberately kept — is left
//! exactly as-is in the default mode. The stronger [`ScrubOptions::accept_all_changes`]
//! mode is a DOM-level operation handled by the caller ([`clean_copy_bytes`])
//! before this package-level scrub runs; it accepts every tracked change and
//! drops comments so the recipient sees a flat final document with no review
//! history at all.
//!
//! # Preserve-by-default still holds
//!
//! We rewrite the two standard `docProps` parts (replacing them with a minimal,
//! still-valid skeleton rather than deleting them) and drop known hidden
//! metadata stores that are safe to remove for an external clean copy. Visible
//! document content and formatting parts — styles, numbering, theme, media,
//! `document.xml` — still pass through unless an explicit final-clean transform
//! applies.

use std::collections::BTreeSet;

use crate::error::{DocxError, Result};
use crate::model::Document;
use crate::package::{Package, COMMENTS_PART, CONTENT_TYPES_PART, DOCUMENT_PART};
use crate::OpenedDocument;

/// The two metadata parts a `.docx` uses to carry authorship / origin info.
pub const CORE_PROPS_PART: &str = "docProps/core.xml";
pub const APP_PROPS_PART: &str = "docProps/app.xml";
pub const CUSTOM_PROPS_PART: &str = "docProps/custom.xml";

/// What a "clean copy" export removes. Defaults ([`ScrubOptions::default`]) are
/// the safe baseline: strip the identifying document metadata
/// (`docProps/core.xml` + `docProps/app.xml`) but keep the visible content,
/// tracked changes, and comments untouched.
#[derive(Debug, Clone, Copy)]
pub struct ScrubOptions {
    /// Strip identifying fields from `docProps/core.xml` and `docProps/app.xml`
    /// (author, lastModifiedBy, company, manager, revision count, timestamps,
    /// etc.). On by default — this is the core of the privilege-safe story.
    pub strip_document_metadata: bool,
    /// STRONGER MODE: accept every tracked change and remove all comments, so
    /// the recipient gets a flat final document with no review history or
    /// reviewer names. When `false`, tracked changes and comments are preserved
    /// (the author attribution the user chose to keep survives). This is a
    /// DOM-level transform applied by [`clean_copy_bytes`] before the
    /// package-level metadata scrub.
    pub accept_all_changes: bool,
}

impl Default for ScrubOptions {
    fn default() -> Self {
        ScrubOptions {
            strip_document_metadata: true,
            accept_all_changes: false,
        }
    }
}

impl ScrubOptions {
    /// The default privilege-safe clean copy: strip identifying metadata, keep
    /// tracked changes + comments (their author attribution is intentional).
    pub fn metadata_only() -> Self {
        ScrubOptions {
            strip_document_metadata: true,
            accept_all_changes: false,
        }
    }

    /// The strongest production mode: also accept all tracked changes and remove
    /// every comment, leaving a flat final document with no review history.
    pub fn final_clean() -> Self {
        ScrubOptions {
            strip_document_metadata: true,
            accept_all_changes: true,
        }
    }
}

/// A minimal, spec-valid `docProps/core.xml` with every identifying field
/// removed. We keep the part (rather than dropping it) so the package's
/// content-type override and relationship still resolve and Word treats the
/// document as well-formed; it simply carries no author / timestamps / revision
/// count any more.
const SCRUBBED_CORE_XML: &str = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n<cp:coreProperties xmlns:cp=\"http://schemas.openxmlformats.org/package/2006/metadata/core-properties\" xmlns:dc=\"http://purl.org/dc/elements/1.1/\" xmlns:dcterms=\"http://purl.org/dc/terms/\" xmlns:dcmitype=\"http://purl.org/dc/dcmitype/\" xmlns:xsi=\"http://www.w3.org/2001/XMLSchema-instance\"></cp:coreProperties>";

/// A minimal, spec-valid `docProps/app.xml` with identifying fields removed. We
/// keep `Application` (it identifies the producing app, not the user) so the
/// file still looks like a normal Office document, and drop `Company`,
/// `Manager`, `Template`, edit-time, the title-of-parts outline, etc.
fn scrubbed_app_xml() -> String {
    format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n<Properties xmlns=\"http://schemas.openxmlformats.org/officeDocument/2006/extended-properties\" xmlns:vt=\"http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes\"><Application>{}</Application></Properties>",
        crate::generated_brand::PRODUCT_NAME,
    )
}

/// Strip identifying metadata from a package IN PLACE: replace
/// `docProps/core.xml` and `docProps/app.xml` with scrubbed skeletons, remove
/// custom properties / custom XML data stores, and clean manifest references to
/// the removed parts. Only rewrites standard metadata parts that already exist
/// (a package with no standard metadata parts is left alone — there is nothing
/// to scrub), so we never *add* a metadata part the producer chose not to
/// include.
///
/// This is the package-level half of a clean-copy export; the DOM-level half
/// (accept-all / drop-comments) lives in [`clean_copy_bytes`].
pub fn scrub_package_metadata(pkg: &mut Package) {
    if pkg.contains(CORE_PROPS_PART) {
        pkg.insert(CORE_PROPS_PART, SCRUBBED_CORE_XML.as_bytes().to_vec());
    }
    if pkg.contains(APP_PROPS_PART) {
        pkg.insert(APP_PROPS_PART, scrubbed_app_xml().into_bytes());
    }

    let removed = remove_residual_metadata_parts(pkg);
    if !removed.is_empty() {
        remove_content_type_overrides(pkg, &removed);
        remove_relationships_to_removed_metadata(pkg, &removed);
    }
}

fn remove_residual_metadata_parts(pkg: &mut Package) -> BTreeSet<String> {
    let to_remove: Vec<String> = pkg
        .part_names()
        .filter(|name| is_residual_metadata_part(name))
        .cloned()
        .collect();
    for name in &to_remove {
        pkg.parts.remove(name);
    }
    to_remove.into_iter().collect()
}

fn is_residual_metadata_part(name: &str) -> bool {
    name == CUSTOM_PROPS_PART
        || name.starts_with("customXml/")
        || matches!(
            name,
            "word/commentsExtended.xml"
                | "word/commentsExtensible.xml"
                | "word/commentsIds.xml"
                | "word/people.xml"
                | "word/person.xml"
        )
}

fn remove_content_type_overrides(pkg: &mut Package, removed: &BTreeSet<String>) {
    let Some(xml) = pkg.get_str(CONTENT_TYPES_PART) else {
        return;
    };
    let Ok(cleaned) = filter_xml_elements(&xml, |e| {
        if local_name(e.name().as_ref()) != "Override" {
            return false;
        }
        attr_value(e, "PartName")
            .map(|part| part.trim_start_matches('/').to_string())
            .is_some_and(|part| removed.contains(&part) || is_residual_metadata_part(&part))
    }) else {
        return;
    };
    pkg.insert(CONTENT_TYPES_PART, cleaned.into_bytes());
}

fn remove_relationships_to_removed_metadata(pkg: &mut Package, removed: &BTreeSet<String>) {
    let rel_parts: Vec<String> = pkg
        .part_names()
        .filter(|name| name.ends_with(".rels"))
        .cloned()
        .collect();

    for rel_part in rel_parts {
        let Some(xml) = pkg.get_str(&rel_part) else {
            continue;
        };
        let Ok(cleaned) = filter_xml_elements(&xml, |e| {
            if local_name(e.name().as_ref()) != "Relationship" {
                return false;
            }
            let rel_type = attr_value(e, "Type").unwrap_or_default();
            if is_residual_metadata_relationship_type(&rel_type) {
                return true;
            }
            attr_value(e, "Target")
                .map(|target| resolve_relationship_target(&rel_part, &target))
                .is_some_and(|target| {
                    removed.contains(&target) || is_residual_metadata_part(&target)
                })
        }) else {
            continue;
        };
        pkg.insert(rel_part, cleaned.into_bytes());
    }
}

fn is_residual_metadata_relationship_type(rel_type: &str) -> bool {
    rel_type.ends_with("/custom-properties")
        || rel_type.ends_with("/customXml")
        || rel_type.ends_with("/customXmlProps")
        || rel_type.ends_with("/commentsExtended")
        || rel_type.ends_with("/commentsExtensible")
        || rel_type.ends_with("/commentsIds")
        || rel_type.ends_with("/people")
        || rel_type.ends_with("/person")
}

fn filter_xml_elements(
    xml: &str,
    should_remove: impl Fn(&quick_xml::events::BytesStart<'_>) -> bool,
) -> Result<String> {
    use quick_xml::events::Event;
    use quick_xml::reader::Reader;
    use quick_xml::writer::Writer;

    let mut reader = Reader::from_str(xml);
    reader.config_mut().trim_text(false);
    let mut writer = Writer::new(Vec::with_capacity(xml.len()));
    let mut skip_depth = 0usize;

    loop {
        let event = reader
            .read_event()
            .map_err(|e| DocxError::Xml(format!("parse OOXML manifest for metadata scrub: {e}")))?;

        match event {
            Event::Start(e) => {
                if skip_depth > 0 {
                    skip_depth += 1;
                    continue;
                }
                if should_remove(&e) {
                    skip_depth = 1;
                } else {
                    write_xml_event(&mut writer, Event::Start(e.borrow()))?;
                }
            }
            Event::Empty(e) => {
                if skip_depth == 0 && !should_remove(&e) {
                    write_xml_event(&mut writer, Event::Empty(e.borrow()))?;
                }
            }
            Event::End(e) => {
                if skip_depth > 0 {
                    skip_depth -= 1;
                } else {
                    write_xml_event(&mut writer, Event::End(e.borrow()))?;
                }
            }
            Event::Eof => break,
            other => {
                if skip_depth == 0 {
                    write_xml_event(&mut writer, other.borrow())?;
                }
            }
        }
    }

    String::from_utf8(writer.into_inner())
        .map_err(|e| DocxError::Xml(format!("scrubbed OOXML manifest was not UTF-8: {e}")))
}

fn attr_value(e: &quick_xml::events::BytesStart<'_>, want_local: &str) -> Option<String> {
    e.attributes().with_checks(false).flatten().find_map(|a| {
        if local_name(a.key.as_ref()) == want_local {
            Some(String::from_utf8_lossy(&a.value).into_owned())
        } else {
            None
        }
    })
}

fn resolve_relationship_target(rels_part: &str, target: &str) -> String {
    if target.contains("://") || target.starts_with('#') {
        return target.to_string();
    }
    if let Some(stripped) = target.strip_prefix('/') {
        return normalize_part_name(stripped);
    }

    let base = relationship_source_base_dir(rels_part);
    if base.is_empty() {
        normalize_part_name(target)
    } else {
        normalize_part_name(&format!("{base}/{target}"))
    }
}

fn relationship_source_base_dir(rels_part: &str) -> String {
    if rels_part == "_rels/.rels" {
        return String::new();
    }
    let Some((prefix, rels_name)) = rels_part.rsplit_once("/_rels/") else {
        return String::new();
    };
    let Some(source_name) = rels_name.strip_suffix(".rels") else {
        return String::new();
    };
    let source_part = if prefix.is_empty() {
        source_name.to_string()
    } else {
        format!("{prefix}/{source_name}")
    };
    source_part
        .rsplit_once('/')
        .map(|(dir, _)| dir.to_string())
        .unwrap_or_default()
}

fn normalize_part_name(path: &str) -> String {
    let mut parts: Vec<&str> = Vec::new();
    for segment in path.split('/') {
        match segment {
            "" | "." => {}
            ".." => {
                parts.pop();
            }
            _ => parts.push(segment),
        }
    }
    parts.join("/")
}

/// Remove every comment from the DOM and the comment anchors that reference them
/// from the body. Leaves all other inline content (runs, tracked changes,
/// preserved raw inlines) intact. After this the document has no comment graph,
/// so the serializer's dangling-reference invariant is trivially satisfied.
fn strip_all_comments(doc: &mut Document) {
    use crate::model::{BlockContent, Inline};
    doc.comments.clear();
    for block in &mut doc.body {
        if let BlockContent::Paragraph(p) = block {
            p.inlines.retain(|i| {
                !matches!(
                    i,
                    Inline::CommentRangeStart { .. }
                        | Inline::CommentRangeEnd { .. }
                        | Inline::CommentReference { .. }
                )
            });
        }
    }
}

/// Accept tracked changes directly in raw Word XML. This is the final-clean
/// backstop for tables and other OOXML blocks we preserve as raw XML rather
/// than modeling as paragraphs — delegates to the same stream-level resolver
/// the interactive Accept All / Reject All path uses ([`crate::resolve::resolve_raw_xml`],
/// CLUSTER-C3), so the two paths can never drift apart on what "accept" means
/// for a `w:ins`/`w:del` living inside a table. `treat_missing_id_as_match:
/// true` is load-bearing here: this is the "send a clean copy to opposing
/// counsel" path, so a malformed or third-party-authored `<w:del>` with no
/// `w:id` at all must still be stripped — the previous implementation did
/// this unconditionally as a fail-closed safety net, and a review found the
/// initial version of this delegation regressed that guarantee.
fn accept_tracked_changes_in_raw_word_xml(xml: &str) -> Result<String> {
    crate::resolve::resolve_raw_xml(xml, crate::resolve::ResolveAction::Accept, &|_| true, true)
        .map(|(new_xml, _changed)| new_xml)
}

fn write_xml_event<'a>(
    writer: &mut quick_xml::writer::Writer<Vec<u8>>,
    event: quick_xml::events::Event<'a>,
) -> Result<()> {
    writer
        .write_event(event)
        .map_err(|e| DocxError::Xml(format!("write final-clean OOXML: {e}")))
}

fn local_name(bytes: &[u8]) -> &str {
    let local = match bytes.iter().position(|&b| b == b':') {
        Some(i) => &bytes[i + 1..],
        None => bytes,
    };
    std::str::from_utf8(local).unwrap_or("")
}

/// Produce the bytes of a privilege-safe "clean copy" of an opened document.
///
/// Pipeline (only the requested steps run):
///   1. If [`ScrubOptions::accept_all_changes`]: accept every tracked change and
///      remove all comments at the DOM level (a flat final document).
///   2. Serialize the (possibly transformed) DOM back into the original package,
///      preserving every unmodeled part byte-for-byte (the normal save path).
///   3. If [`ScrubOptions::strip_document_metadata`]: scrub `docProps/core.xml`
///      and `docProps/app.xml` in the resulting package.
///
/// The input [`OpenedDocument`] is not mutated. Returns ready-to-write `.docx`
/// bytes.
pub fn clean_copy_bytes(opened: &OpenedDocument, options: ScrubOptions) -> Result<Vec<u8>> {
    // Work on a clone so the caller's document is untouched.
    let mut document = opened.document.clone();

    let stripped_comments = options.accept_all_changes;
    if options.accept_all_changes {
        crate::resolve::resolve_all(&mut document, crate::resolve::ResolveAction::Accept);
        strip_all_comments(&mut document);
    }

    // Serialize into the original package (preserve-by-default for every
    // unmodeled part), then scrub the metadata parts on the way out.
    let mut pkg = crate::serialize::serialize_into_package(&document, &opened.package)?;

    // The DOM resolver handles modeled paragraphs. Tables and other unmodeled
    // body blocks are preserved as raw OOXML, so final-clean needs this package
    // pass too or deleted table text can leak.
    if options.accept_all_changes {
        if let Some(document_xml) = pkg.get_str(DOCUMENT_PART) {
            let cleaned_xml = accept_tracked_changes_in_raw_word_xml(&document_xml)?;
            pkg.insert(DOCUMENT_PART, cleaned_xml.into_bytes());
        }
    }

    // When we stripped comments, the general save path deliberately LEAVES any
    // pre-existing `comments.xml` in place (it never removes parts). For a clean
    // copy that is the opposite of what we want — the recipient must not get the
    // reviewers' comments. So if the source carried a comments part, overwrite it
    // with an empty (but still spec-valid) `<w:comments>` document. This drops
    // every comment without touching the part's content-type override / rel
    // (keeping the package well-formed), and re-parses to zero comments.
    if stripped_comments && pkg.contains(COMMENTS_PART) {
        pkg.insert(COMMENTS_PART, EMPTY_COMMENTS_XML.as_bytes().to_vec());
    }

    if options.strip_document_metadata {
        scrub_package_metadata(&mut pkg);
    }

    pkg.write_to_bytes()
}

/// A valid but empty `word/comments.xml` (no `<w:comment>` children). Used by
/// the clean copy when comments were stripped, so the comments part is emptied
/// rather than left carrying the reviewers' notes.
const EMPTY_COMMENTS_XML: &str = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n<w:comments xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\"></w:comments>";

/// True when the given `docProps/core.xml` content carries no identifying
/// fields (no `dc:creator`, `cp:lastModifiedBy`, `cp:revision`,
/// `dcterms:created`, or `dcterms:modified`). Used by tests to assert the scrub
/// actually removed authorship metadata; also handy as a guard elsewhere.
pub fn core_props_are_clean(core_xml: &str) -> bool {
    !IDENTIFYING_CORE_TAGS
        .iter()
        .any(|tag| core_xml.contains(tag))
}

/// True when `docProps/app.xml` carries no identifying fields (`Company`,
/// `Manager`). `Application`/`AppVersion` are allowed (they identify the
/// producing app, not the user).
pub fn app_props_are_clean(app_xml: &str) -> bool {
    !app_xml.contains("<Company") && !app_xml.contains("<Manager")
}

/// The identifying element names a non-scrubbed `core.xml` would contain. Kept
/// as a const so the scrub and its test agree on what "clean" means.
const IDENTIFYING_CORE_TAGS: [&str; 5] = [
    "<dc:creator",
    "<cp:lastModifiedBy",
    "<cp:revision",
    "<dcterms:created",
    "<dcterms:modified",
];
