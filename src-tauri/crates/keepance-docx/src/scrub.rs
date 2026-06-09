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
//! We only rewrite the two `docProps` parts (replacing them with a minimal,
//! still-valid skeleton rather than deleting them, so Word does not consider the
//! package malformed). Every other part — styles, numbering, theme, media,
//! `document.xml`, the manifests — passes through byte-for-byte, exactly like a
//! normal round-trip.

use crate::error::Result;
use crate::model::Document;
use crate::package::{Package, COMMENTS_PART};
use crate::OpenedDocument;

/// The two metadata parts a `.docx` uses to carry authorship / origin info.
pub const CORE_PROPS_PART: &str = "docProps/core.xml";
pub const APP_PROPS_PART: &str = "docProps/app.xml";

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
const SCRUBBED_APP_XML: &str = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n<Properties xmlns=\"http://schemas.openxmlformats.org/officeDocument/2006/extended-properties\" xmlns:vt=\"http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes\"><Application>Keepance</Application></Properties>";

/// Strip identifying metadata from a package IN PLACE: replace
/// `docProps/core.xml` and `docProps/app.xml` with scrubbed skeletons. Only
/// rewrites parts that already exist (a package with no metadata parts is left
/// alone — there is nothing to leak), so we never *add* a metadata part the
/// producer chose not to include.
///
/// Everything else in the package is untouched. This is the package-level half
/// of a clean-copy export; the DOM-level half (accept-all / drop-comments) lives
/// in [`clean_copy_bytes`].
pub fn scrub_package_metadata(pkg: &mut Package) {
    if pkg.contains(CORE_PROPS_PART) {
        pkg.insert(CORE_PROPS_PART, SCRUBBED_CORE_XML.as_bytes().to_vec());
    }
    if pkg.contains(APP_PROPS_PART) {
        pkg.insert(APP_PROPS_PART, SCRUBBED_APP_XML.as_bytes().to_vec());
    }
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
