//! Accept / reject tracked changes over the typed [`Document`] DOM — the
//! inverse of [`crate::author`], which *adds* revisions. The Keepance editor
//! (task A3) wires its accept/reject buttons and the review pane's
//! "accept all" / "reject all" straight to these functions: this is
//! document-model logic, so it lives in the engine, not the UI.
//!
//! # Word semantics
//!
//! A tracked change is a *proposed* edit; resolving it makes the proposal
//! either real (Accept) or undone (Reject):
//!
//! | element        | Accept                                   | Reject                                  |
//! |----------------|------------------------------------------|-----------------------------------------|
//! | `w:ins` (insertion) | keep the text: the inserted runs become plain runs | discard: remove the inserted runs entirely |
//! | `w:del` (deletion)  | apply the delete: remove the deleted runs entirely | restore: the deleted runs become plain runs again |
//!
//! In OOXML one logical revision is grouped by its `w:id` and can span several
//! runs / several `w:ins`|`w:del` elements (Word splits a revision at run-
//! property boundaries), so [`resolve_revision`] applies the action to **every**
//! inline whose [`RevisionMeta::id`] matches — not just the first.
//!
//! # Fidelity
//!
//! These functions only ever turn a revision inline into zero-or-more plain
//! [`Inline::Run`]s, or drop it. They never touch:
//!   * unrelated revisions (a different `w:id` is left exactly as-is),
//!   * comments or comment anchors ([`Inline::CommentRangeStart`] /
//!     `End` / `Reference` and the `comments` map are untouched), so no
//!     dangling comment reference can be introduced, and
//!   * preserved spans ([`Inline::Raw`], paragraph/run `properties_xml`) — a
//!     restored/unwrapped run keeps its own `properties_xml`.
//!
//! The result therefore still satisfies the serializer's invariants and
//! round-trips through serialize → parse like any other DOM.

use quick_xml::events::{BytesEnd, BytesStart, Event};
use quick_xml::reader::Reader;
use quick_xml::writer::Writer;

use crate::error::{DocxError, Result as DocxResult};
use crate::model::{BlockContent, Document, Inline, Run};
use crate::parse::local_of;

/// What to do with a tracked change. Serialized in camelCase (`"accept"` /
/// `"reject"`) so the React editor can pass a plain string; also constructible
/// from a free-form string via [`ResolveAction::from_str_action`] for the Tauri
/// command layer.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ResolveAction {
    /// Make the proposed change real (keep insertions, apply deletions).
    Accept,
    /// Undo the proposed change (drop insertions, restore deletions).
    Reject,
}

impl ResolveAction {
    /// Parse the action from the loose string the JS side sends. Case-
    /// insensitive; accepts `"accept"` / `"reject"`. Returns `None` for anything
    /// else so the caller can produce a precise error.
    pub fn from_str_action(s: &str) -> Option<Self> {
        match s.trim().to_ascii_lowercase().as_str() {
            "accept" => Some(ResolveAction::Accept),
            "reject" => Some(ResolveAction::Reject),
            _ => None,
        }
    }
}

/// Turn a revision's runs into plain [`Inline::Run`]s (used when Accept keeps an
/// insertion, or Reject restores a deletion). The runs' own `properties_xml`
/// (bold/italic/run-style) and `preserve_space` ride along unchanged, so
/// formatting on a kept/restored span survives. Note a deletion's runs were
/// modeled identically to insertion runs (the `w:delText` body is stored as
/// plain `Run::text`), so the same conversion restores them as normal text.
fn runs_to_inlines(runs: &[Run]) -> Vec<Inline> {
    runs.iter().cloned().map(Inline::Run).collect()
}

/// Apply `action` to a single paragraph's inline list, but only to the
/// revisions matching `pred` (which sees each candidate's id). Rebuilds the
/// inline vector because one revision inline expands to zero-or-more plain runs.
fn resolve_inlines(inlines: &mut Vec<Inline>, action: ResolveAction, pred: &impl Fn(&str) -> bool) {
    let mut out: Vec<Inline> = Vec::with_capacity(inlines.len());
    for inline in inlines.drain(..) {
        match inline {
            Inline::Insertion { meta, runs } if pred(&meta.id) => match action {
                // Accept an insertion: the inserted text stays, as normal runs.
                ResolveAction::Accept => out.extend(runs_to_inlines(&runs)),
                // Reject an insertion: drop the inserted runs entirely.
                ResolveAction::Reject => {}
            },
            Inline::Deletion { meta, runs } if pred(&meta.id) => match action {
                // Accept a deletion: the delete applies — remove the runs.
                ResolveAction::Accept => {}
                // Reject a deletion: restore the deleted text as normal runs.
                ResolveAction::Reject => out.extend(runs_to_inlines(&runs)),
            },
            // Not a matching revision (different id, or a comment / run / raw
            // span): carry it through untouched.
            other => out.push(other),
        }
    }
    *inlines = out;
}

/// Resolve **one** revision: apply Word's accept/reject semantics to every
/// inline in the document whose revision id equals `revision_id`. Unrelated
/// revisions, comments, and preserved content are left untouched.
///
/// Tables and other unmodeled body blocks are stored as raw XML
/// ([`BlockContent::Raw`]) rather than parsed paragraphs, so a tracked change
/// living inside one is invisible to the paragraph walk above. We additionally
/// scan/transform those raw blocks via [`resolve_raw_xml`] so a revision id
/// that only exists inside a table is still found and resolved (never silently
/// left in place — see CLUSTER-C3).
///
/// Returns `true` if at least one matching revision was found and resolved,
/// `false` if `revision_id` matched nothing (the document is then unchanged) —
/// the command layer turns the latter into an error.
pub fn resolve_revision(doc: &mut Document, revision_id: &str, action: ResolveAction) -> bool {
    // Note whether the id exists *before* mutating, since resolving consumes the
    // matching inlines (so we can't observe them afterward).
    let found = doc.body.iter().any(|block| match block {
        BlockContent::Paragraph(p) => p.inlines.iter().any(|i| match i {
            Inline::Insertion { meta, .. } | Inline::Deletion { meta, .. } => meta.id == revision_id,
            _ => false,
        }),
        BlockContent::Raw { xml } => raw_xml_revision_ids(xml)
            .iter()
            .any(|id| id.as_deref() == Some(revision_id)),
    });
    if !found {
        return false;
    }

    let pred = |id: &str| id == revision_id;
    for block in &mut doc.body {
        match block {
            BlockContent::Paragraph(p) => resolve_inlines(&mut p.inlines, action, &pred),
            BlockContent::Raw { xml } => {
                // `treat_missing_id_as_match: false` — a single targeted
                // resolve can't safely claim a malformed, id-less element as
                // "the one revision being resolved"; leave it untouched
                // rather than guess (see `resolve_raw_xml`'s doc comment).
                if let Ok((new_xml, changed)) = resolve_raw_xml(xml, action, &pred, false) {
                    if changed {
                        *xml = new_xml;
                    }
                }
            }
        }
    }
    true
}

/// Resolve **every** revision in the document with the same action (accept-all
/// or reject-all) — what the review pane's bulk buttons call. Comments and
/// preserved content are untouched. Also resolves tracked changes embedded in
/// raw (table / unmodeled) blocks via [`resolve_raw_xml`] — see
/// [`resolve_revision`]'s doc comment for why that pass exists. Returns the
/// number of revisions that were resolved (0 when the document had no tracked
/// changes anywhere, paragraphs or raw blocks).
pub fn resolve_all(doc: &mut Document, action: ResolveAction) -> usize {
    let paragraph_revisions = doc
        .body
        .iter()
        .filter_map(|b| match b {
            BlockContent::Paragraph(p) => Some(p),
            BlockContent::Raw { .. } => None,
        })
        .flat_map(|p| p.inlines.iter())
        .filter(|i| matches!(i, Inline::Insertion { .. } | Inline::Deletion { .. }))
        .count();
    let raw_revisions: usize = doc
        .body
        .iter()
        .filter_map(|b| match b {
            BlockContent::Raw { xml } => Some(xml.as_str()),
            BlockContent::Paragraph(_) => None,
        })
        .map(|xml| raw_xml_revision_ids(xml).len())
        .sum();
    let resolved = paragraph_revisions + raw_revisions;

    if resolved == 0 {
        return 0;
    }

    // Predicate matches any id → resolve all insertions/deletions.
    let pred = |_id: &str| true;
    for block in &mut doc.body {
        match block {
            BlockContent::Paragraph(p) => resolve_inlines(&mut p.inlines, action, &pred),
            BlockContent::Raw { xml } => {
                // `treat_missing_id_as_match: true` — accept-all/reject-all is
                // "resolve everything," so a malformed, id-less deletion must
                // not survive it either (fail-closed for confidentiality; see
                // `resolve_raw_xml`'s doc comment — this is the Codex-review fix).
                if let Ok((new_xml, changed)) = resolve_raw_xml(xml, action, &pred, true) {
                    if changed {
                        *xml = new_xml;
                    }
                }
            }
        }
    }
    resolved
}

// ===========================================================================
// Raw-XML tracked-change resolution (CLUSTER-C3)
//
// Tables and other unmodeled body blocks round-trip as exact source XML
// (`BlockContent::Raw`) rather than a parsed paragraph tree, so the
// `resolve_inlines` walk above can never see a `w:ins`/`w:del` living inside
// one — accept/reject (single or "all") would otherwise silently leave
// deleted text sitting in the saved `.docx` (a confidentiality bug: a deleted
// client name inside a table survives "Accept All"). This is a stream-level
// transform over the raw XML that applies the SAME Word semantics
// (`resolve_inlines`'s table above) without needing to parse the block
// structurally.
// ===========================================================================

/// Read a `w:*` attribute by local name (e.g. `"id"`) from a raw start tag.
fn raw_attr(e: &BytesStart<'_>, want_local: &str) -> Option<String> {
    e.attributes().with_checks(false).flatten().find_map(|a| {
        if local_of(a.key) == want_local {
            Some(String::from_utf8_lossy(&a.value).into_owned())
        } else {
            None
        }
    })
}

/// Collect the `w:id` of every `w:ins`/`w:del` in a raw XML fragment (`None`
/// for one missing an `id` attribute — malformed, but still a real revision
/// that must be counted, not silently dropped from the total), PLUS a `None`
/// entry for every stray `w:delText` with no enclosing `w:del` at all (also
/// malformed, also a real "deleted content" marker `resolve_raw_xml`'s
/// `treat_missing_id_as_match` fail-closed path will strip — Codex review).
/// Used by [`resolve_revision`]'s "does this id exist anywhere" check and by
/// [`resolve_all`]'s revision count — the count MUST include every id-less /
/// wrapper-less entry so a raw block whose only tracked change is malformed
/// doesn't make `resolve_all` early-exit as if there were nothing to resolve.
/// Malformed XML is treated as having no revisions (preserve-don't-crash; the
/// normal save/serialize path is the one responsible for XML validity, not
/// this best-effort scan).
fn raw_xml_revision_ids(xml: &str) -> Vec<Option<String>> {
    let mut reader = Reader::from_str(xml);
    reader.config_mut().trim_text(false);
    let mut ids = Vec::new();
    // Depth of `w:del` nesting — a `delText` inside one is already counted
    // via the `del` itself, so only a depth-0 `delText` is "stray".
    let mut del_depth: usize = 0;
    loop {
        let event = match reader.read_event() {
            Ok(ev) => ev,
            Err(_) => break,
        };
        match event {
            Event::Start(e) => {
                let ln = local_of(e.name());
                if ln == "ins" || ln == "del" {
                    ids.push(raw_attr(&e, "id"));
                    if ln == "del" {
                        del_depth += 1;
                    }
                } else if ln == "delText" && del_depth == 0 {
                    ids.push(None);
                }
            }
            Event::Empty(e) => {
                let ln = local_of(e.name());
                if ln == "ins" || ln == "del" {
                    ids.push(raw_attr(&e, "id"));
                } else if ln == "delText" && del_depth == 0 {
                    ids.push(None);
                }
            }
            Event::End(e) => {
                if local_of(e.name()) == "del" && del_depth > 0 {
                    del_depth -= 1;
                }
            }
            Event::Eof => break,
            _ => {}
        }
    }
    ids
}

/// `xmlns` / `xmlns:*` attribute (name, value) pairs captured off a wrapper
/// element that's about to have its own start/end tags suppressed
/// ("unwrapped") — see [`RawFrame::Unwrap`] / [`RawFrame::UnwrapRestoreText`].
type NsDecls = Vec<(Vec<u8>, Vec<u8>)>;

/// What an open element in [`resolve_raw_xml`]'s stream walk should do with its
/// own start/end tags and (transitively, via the ambient-mode scan) its
/// children.
#[derive(Clone, PartialEq, Eq)]
enum RawFrame {
    /// Pass the element through unchanged.
    Keep,
    /// Suppress only this element's own start/end tags; children pass through
    /// normally (accepting an insertion: unwrap `w:ins`, keep its runs). Any
    /// `xmlns`/`xmlns:*` the wrapper itself declared is carried here so it can
    /// be hoisted onto direct children (Codex review: dropping the wrapper
    /// must not silently unbind a namespace prefix its children still use —
    /// real Word documents never locally scope `xmlns:w` on a `w:ins`/`w:del`
    /// itself, but a third-party producer could, and preserve-by-default
    /// means never emitting invalid XML for content we didn't originate).
    Unwrap(NsDecls),
    /// Suppress this element AND everything inside it (rejecting an insertion,
    /// or accepting a deletion: the content must not survive at all).
    Drop,
    /// Suppress this element's own tags; any `w:delText` descendant (at any
    /// depth) gets rewritten to a plain `w:t` (rejecting a deletion: the
    /// struck text comes back as normal visible text). Carries the wrapper's
    /// own namespace declarations for hoisting, same as [`RawFrame::Unwrap`].
    UnwrapRestoreText(NsDecls),
    /// This element IS a `w:delText` being rewritten to `w:t` because an
    /// ancestor frame is [`RawFrame::UnwrapRestoreText`].
    RenameToPlainText,
}

/// The `xmlns` / `xmlns:*` attributes declared directly on `e` (empty if none) —
/// what needs to be hoisted onto direct children if `e`'s own tags get dropped.
fn ns_decls_of(e: &BytesStart<'_>) -> NsDecls {
    e.attributes()
        .with_checks(false)
        .flatten()
        .filter(|a| {
            let k = a.key.as_ref();
            k == b"xmlns" || k.starts_with(b"xmlns:")
        })
        .map(|a| (a.key.as_ref().to_vec(), a.value.to_vec()))
        .collect()
}

/// If the immediate parent frame is an [`RawFrame::Unwrap`] /
/// [`RawFrame::UnwrapRestoreText`] carrying pending namespace declarations,
/// inject any of them `e` doesn't already declare itself onto `e` — so a
/// namespace prefix bound only on a now-suppressed wrapper stays bound for
/// this direct child (and, by ordinary XML scoping, everything nested inside
/// it). A no-op (returns `e` unchanged) when there's nothing pending.
fn hoist_pending_ns<'a>(mut e: BytesStart<'a>, stack: &[RawFrame]) -> BytesStart<'a> {
    let pending: &[(Vec<u8>, Vec<u8>)] = match stack.last() {
        Some(RawFrame::Unwrap(ns)) | Some(RawFrame::UnwrapRestoreText(ns)) => ns.as_slice(),
        _ => return e,
    };
    if pending.is_empty() {
        return e;
    }
    let already: Vec<Vec<u8>> = e
        .attributes()
        .with_checks(false)
        .flatten()
        .map(|a| a.key.as_ref().to_vec())
        .collect();
    for (k, v) in pending {
        if !already.iter().any(|ek| ek == k) {
            e.push_attribute((k.as_slice(), v.as_slice()));
        }
    }
    e
}

/// Build a renamed tag name (`w:delText` -> `w:t`) preserving whatever
/// namespace prefix the original element used.
fn renamed_qname(original: quick_xml::name::QName<'_>, new_local: &str) -> String {
    let bytes = original.as_ref();
    match bytes.iter().position(|&b| b == b':') {
        Some(idx) => {
            let prefix = std::str::from_utf8(&bytes[..idx]).unwrap_or("w");
            format!("{prefix}:{new_local}")
        }
        None => new_local.to_string(),
    }
}

fn xml_write_err(e: impl std::fmt::Display) -> DocxError {
    DocxError::Xml(format!("write raw OOXML during resolve: {e}"))
}

/// Resolve tracked changes (`w:ins` / `w:del`) embedded in a raw (unmodeled)
/// Word XML fragment — the table/content-control/etc. blocks the typed DOM
/// preserves verbatim as [`BlockContent::Raw`]. `pred` matches a candidate's
/// `w:id` attribute (pass `|_| true` to resolve every revision in the
/// fragment, as accept-all/reject-all do). Mirrors [`resolve_inlines`]'s
/// semantics exactly:
///
/// | element | Accept | Reject |
/// |---|---|---|
/// | `w:ins` | unwrap — keep the inserted text as plain runs | drop entirely |
/// | `w:del` | drop entirely | unwrap — restore as plain text (`w:delText` -> `w:t`) |
///
/// An element whose id doesn't match `pred` is re-emitted byte-for-byte, as is
/// any element outside one, so unrelated revisions and all other markup
/// (table grid, cell properties, run properties, …) round-trip untouched.
///
/// `treat_missing_id_as_match` decides what happens to a MALFORMED `w:ins`/
/// `w:del` with no `w:id` at all — `pred` can't be evaluated against a string
/// that doesn't exist, so this is the explicit fallback instead of silently
/// skipping it. Bulk callers (accept-all/reject-all, and the final-clean
/// export path) pass `true`: a fail-closed guarantee that a malformed or
/// third-party-authored deletion can never survive "accept every change"
/// just because it lacks an id — a deleted client name is exactly the
/// confidentiality risk CLUSTER-C3 exists to close (Codex review). A single
/// targeted [`resolve_revision`] passes `false`: it can't safely claim an
/// id-less element as "the one revision the caller asked for" — leaving it
/// untouched (rather than guessing) is the conservative, correct choice there.
///
/// Returns the (possibly unchanged) XML and whether anything was resolved.
pub(crate) fn resolve_raw_xml(
    xml: &str,
    action: ResolveAction,
    pred: &impl Fn(&str) -> bool,
    treat_missing_id_as_match: bool,
) -> DocxResult<(String, bool)> {
    let mut reader = Reader::from_str(xml);
    reader.config_mut().trim_text(false);
    let mut writer = Writer::new(Vec::with_capacity(xml.len()));
    let mut stack: Vec<RawFrame> = Vec::new();
    let mut changed = false;

    // Whether a candidate `w:ins`/`w:del` should be treated as a match: a
    // present id defers to `pred`; a MISSING id (malformed markup) defers to
    // `treat_missing_id_as_match` instead of silently never matching (see the
    // doc comment above — this is the fail-closed guarantee for bulk callers).
    let id_matches = |id: &Option<String>| match id.as_deref() {
        Some(id_str) => pred(id_str),
        None => treat_missing_id_as_match,
    };

    loop {
        let event = reader.read_event().map_err(xml_write_err)?;
        let in_drop = stack.iter().any(|f| matches!(f, RawFrame::Drop));
        let in_restore = !in_drop && stack.iter().any(|f| matches!(f, RawFrame::UnwrapRestoreText(_)));

        match event {
            Event::Start(e) => {
                if in_drop {
                    stack.push(RawFrame::Drop);
                    continue;
                }
                let ln = local_of(e.name());
                let id = raw_attr(&e, "id");
                if !in_restore && ln == "ins" && id_matches(&id) {
                    changed = true;
                    match action {
                        ResolveAction::Accept => stack.push(RawFrame::Unwrap(ns_decls_of(&e))),
                        ResolveAction::Reject => stack.push(RawFrame::Drop),
                    }
                } else if !in_restore && ln == "del" && id_matches(&id) {
                    changed = true;
                    match action {
                        ResolveAction::Accept => stack.push(RawFrame::Drop),
                        ResolveAction::Reject => {
                            stack.push(RawFrame::UnwrapRestoreText(ns_decls_of(&e)));
                        }
                    }
                } else if in_restore && ln == "delText" {
                    let new_name = renamed_qname(e.name(), "t");
                    let mut new_e = BytesStart::new(new_name);
                    for a in e.attributes().with_checks(false).flatten() {
                        new_e.push_attribute(a);
                    }
                    let new_e = hoist_pending_ns(new_e, &stack);
                    writer.write_event(Event::Start(new_e)).map_err(xml_write_err)?;
                    stack.push(RawFrame::RenameToPlainText);
                } else if !in_restore && ln == "delText" && treat_missing_id_as_match {
                    // Stray `w:delText` with NO enclosing `w:del` at all
                    // (malformed/third-party markup) — a bulk caller
                    // (accept-all / final-clean) must not let deleted-tagged
                    // text survive just because its wrapper is missing.
                    // Codex review: the original scrubber stripped ANY
                    // `delText` unconditionally as a fail-closed net; mirror
                    // that here for both actions (Accept drops it, Reject
                    // restores it as plain text — same as a matched `w:del`'s
                    // delText would be treated).
                    changed = true;
                    match action {
                        ResolveAction::Accept => stack.push(RawFrame::Drop),
                        ResolveAction::Reject => {
                            let new_name = renamed_qname(e.name(), "t");
                            let mut new_e = BytesStart::new(new_name);
                            for a in e.attributes().with_checks(false).flatten() {
                                new_e.push_attribute(a);
                            }
                            let new_e = hoist_pending_ns(new_e, &stack);
                            writer.write_event(Event::Start(new_e)).map_err(xml_write_err)?;
                            stack.push(RawFrame::RenameToPlainText);
                        }
                    }
                } else {
                    let e = hoist_pending_ns(e, &stack);
                    writer.write_event(Event::Start(e.borrow())).map_err(xml_write_err)?;
                    stack.push(RawFrame::Keep);
                }
            }
            Event::Empty(e) => {
                if in_drop {
                    continue;
                }
                let ln = local_of(e.name());
                let id = raw_attr(&e, "id");
                if !in_restore && ln == "ins" && id_matches(&id) {
                    // Empty insertion: nothing to keep on accept, nothing to
                    // drop further on reject — either way, write nothing.
                    changed = true;
                } else if !in_restore && ln == "del" && id_matches(&id) {
                    // Empty deletion: no text to restore or remove.
                    changed = true;
                } else if in_restore && ln == "delText" {
                    let new_name = renamed_qname(e.name(), "t");
                    let mut new_e = BytesStart::new(new_name);
                    for a in e.attributes().with_checks(false).flatten() {
                        new_e.push_attribute(a);
                    }
                    let new_e = hoist_pending_ns(new_e, &stack);
                    writer.write_event(Event::Empty(new_e)).map_err(xml_write_err)?;
                } else if !in_restore && ln == "delText" && treat_missing_id_as_match {
                    // Stray, empty delText: same fail-closed handling as above.
                    changed = true;
                    match action {
                        ResolveAction::Accept => {}
                        ResolveAction::Reject => {
                            let new_name = renamed_qname(e.name(), "t");
                            let mut new_e = BytesStart::new(new_name);
                            for a in e.attributes().with_checks(false).flatten() {
                                new_e.push_attribute(a);
                            }
                            let new_e = hoist_pending_ns(new_e, &stack);
                            writer.write_event(Event::Empty(new_e)).map_err(xml_write_err)?;
                        }
                    }
                } else {
                    let e = hoist_pending_ns(e, &stack);
                    writer.write_event(Event::Empty(e.borrow())).map_err(xml_write_err)?;
                }
            }
            Event::End(e) => match stack.pop() {
                Some(RawFrame::Keep) => {
                    writer.write_event(Event::End(e.borrow())).map_err(xml_write_err)?;
                }
                Some(RawFrame::RenameToPlainText) => {
                    let new_name = renamed_qname(e.name(), "t");
                    writer
                        .write_event(Event::End(BytesEnd::new(new_name)))
                        .map_err(xml_write_err)?;
                }
                // Unwrap / Drop / UnwrapRestoreText: the wrapper's own end tag
                // (or the whole dropped subtree) is suppressed. Any namespace
                // declarations it carried have already been hoisted onto its
                // direct children as they were written.
                Some(RawFrame::Unwrap(_) | RawFrame::Drop | RawFrame::UnwrapRestoreText(_)) => {}
                // Defensive: an End with no matching pushed frame (shouldn't
                // happen for well-formed XML) — pass it through rather than
                // silently eating it.
                None => {
                    writer.write_event(Event::End(e.borrow())).map_err(xml_write_err)?;
                }
            },
            Event::Eof => break,
            other => {
                if !in_drop {
                    writer.write_event(other.borrow()).map_err(xml_write_err)?;
                }
            }
        }
    }

    let bytes = writer.into_inner();
    let new_xml = String::from_utf8(bytes)
        .map_err(|e| DocxError::Xml(format!("resolved raw OOXML was not UTF-8: {e}")))?;
    Ok((new_xml, changed))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::fixture::{build_fixture_model, FIXTURE_COMMENT_ID};
    use crate::model::{Inline, RevisionKind};

    /// Flatten all plain-run text in the document body in order (ignores
    /// revisions still present, comments, raw). Lets a test assert what the
    /// "normal" text reads as after a resolve.
    fn plain_text(doc: &Document) -> String {
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

    fn revision_ids(doc: &Document) -> Vec<String> {
        doc.revisions()
            .iter()
            .map(|(m, _, _)| m.id.clone())
            .collect()
    }

    #[test]
    fn action_parses_from_string_case_insensitively() {
        assert_eq!(
            ResolveAction::from_str_action("accept"),
            Some(ResolveAction::Accept)
        );
        assert_eq!(
            ResolveAction::from_str_action(" Reject "),
            Some(ResolveAction::Reject)
        );
        assert_eq!(ResolveAction::from_str_action("ACCEPT"), Some(ResolveAction::Accept));
        assert_eq!(ResolveAction::from_str_action("maybe"), None);
    }

    // The fixture: "The parties agree to <ins id=101>promptly </ins>resolve all
    // <del id=102>minor </del>" + comment-anchored "disputes" + ".".

    #[test]
    fn accept_insertion_keeps_text_as_normal_run() {
        let mut doc = build_fixture_model();
        assert!(resolve_revision(&mut doc, "101", ResolveAction::Accept));
        // No insertion remains for id 101...
        assert!(!revision_ids(&doc).contains(&"101".to_string()));
        // ...and "promptly " is now part of the normal text flow.
        assert!(plain_text(&doc).contains("promptly "));
        // The deletion (102) is untouched.
        assert!(revision_ids(&doc).contains(&"102".to_string()));
    }

    #[test]
    fn reject_insertion_removes_text_entirely() {
        let mut doc = build_fixture_model();
        assert!(resolve_revision(&mut doc, "101", ResolveAction::Reject));
        assert!(!revision_ids(&doc).contains(&"101".to_string()));
        // The inserted text is gone from the document entirely.
        assert!(!plain_text(&doc).contains("promptly"));
        assert!(revision_ids(&doc).contains(&"102".to_string()));
    }

    #[test]
    fn accept_deletion_removes_text_entirely() {
        let mut doc = build_fixture_model();
        assert!(resolve_revision(&mut doc, "102", ResolveAction::Accept));
        assert!(!revision_ids(&doc).contains(&"102".to_string()));
        // The deleted text "minor " is gone (the delete applied).
        assert!(!plain_text(&doc).contains("minor"));
        // The insertion (101) is untouched.
        assert!(revision_ids(&doc).contains(&"101".to_string()));
    }

    #[test]
    fn reject_deletion_restores_text_as_normal_run() {
        let mut doc = build_fixture_model();
        assert!(resolve_revision(&mut doc, "102", ResolveAction::Reject));
        assert!(!revision_ids(&doc).contains(&"102".to_string()));
        // The deleted text "minor " is restored as normal text.
        assert!(plain_text(&doc).contains("minor "));
        assert!(revision_ids(&doc).contains(&"101".to_string()));
    }

    #[test]
    fn resolving_one_revision_leaves_others_and_comments_intact() {
        let mut doc = build_fixture_model();
        let comment_before = doc.comments.clone();
        assert!(resolve_revision(&mut doc, "101", ResolveAction::Accept));

        // Other revision survived.
        let remaining = doc.revisions();
        assert_eq!(remaining.len(), 1);
        assert_eq!(remaining[0].0.id, "102");
        assert_eq!(remaining[0].1, RevisionKind::Deletion);

        // Comments map untouched.
        assert_eq!(doc.comments, comment_before);
        assert!(doc.comments.contains_key(FIXTURE_COMMENT_ID));

        // Comment anchors still present in the body (no dangling refs created).
        let has_start = doc.body.iter().any(|b| match b {
            BlockContent::Paragraph(p) => p
                .inlines
                .iter()
                .any(|i| matches!(i, Inline::CommentRangeStart { id } if id == FIXTURE_COMMENT_ID)),
            _ => false,
        });
        let has_ref = doc.body.iter().any(|b| match b {
            BlockContent::Paragraph(p) => p
                .inlines
                .iter()
                .any(|i| matches!(i, Inline::CommentReference { id } if id == FIXTURE_COMMENT_ID)),
            _ => false,
        });
        assert!(has_start && has_ref, "comment anchors must survive");
    }

    #[test]
    fn resolve_revision_unknown_id_is_noop_and_reports_false() {
        let mut doc = build_fixture_model();
        let before = doc.clone();
        assert!(!resolve_revision(&mut doc, "does-not-exist", ResolveAction::Accept));
        assert_eq!(doc, before, "unknown id must not mutate the document");
    }

    #[test]
    fn accept_all_keeps_insertions_and_applies_deletions() {
        let mut doc = build_fixture_model();
        let n = resolve_all(&mut doc, ResolveAction::Accept);
        assert_eq!(n, 2, "fixture has 1 insertion + 1 deletion");
        assert!(doc.revisions().is_empty(), "no revisions remain");
        let text = plain_text(&doc);
        // Insertion kept...
        assert!(text.contains("promptly "));
        // ...deletion applied.
        assert!(!text.contains("minor"));
        // Final accepted text reads cleanly.
        assert_eq!(text, "The parties agree to promptly resolve all disputes.");
    }

    #[test]
    fn reject_all_drops_insertions_and_restores_deletions() {
        let mut doc = build_fixture_model();
        let n = resolve_all(&mut doc, ResolveAction::Reject);
        assert_eq!(n, 2);
        assert!(doc.revisions().is_empty());
        let text = plain_text(&doc);
        // Insertion dropped...
        assert!(!text.contains("promptly"));
        // ...deletion restored.
        assert!(text.contains("minor "));
        // Back to the original (pre-redline) text.
        assert_eq!(text, "The parties agree to resolve all minor disputes.");
    }

    #[test]
    fn resolve_all_on_clean_document_is_noop() {
        let mut doc = build_fixture_model();
        // Accept everything first → now clean.
        resolve_all(&mut doc, ResolveAction::Accept);
        let clean = doc.clone();
        assert_eq!(resolve_all(&mut doc, ResolveAction::Accept), 0);
        assert_eq!(doc, clean);
    }

    #[test]
    fn revision_spanning_multiple_inlines_is_fully_resolved() {
        use crate::model::{Paragraph, RevisionMeta};
        // Two separate w:ins elements sharing the SAME w:id (Word splits a
        // revision at run-property boundaries) — accept must resolve BOTH.
        let meta = |id: &str| RevisionMeta {
            id: id.into(),
            author: "A".into(),
            date: "2026-01-01T00:00:00Z".into(),
        };
        let para = Paragraph::from_inlines(vec![
            Inline::Insertion {
                meta: meta("7"),
                runs: vec![Run::new("foo ")],
            },
            Inline::Run(Run::new("middle ")),
            Inline::Insertion {
                meta: meta("7"),
                runs: vec![Run::new("bar")],
            },
        ]);
        let mut doc = Document {
            body: vec![BlockContent::Paragraph(para)],
            ..Default::default()
        };
        assert!(resolve_revision(&mut doc, "7", ResolveAction::Accept));
        assert!(doc.revisions().is_empty(), "both id=7 inlines resolved");
        assert_eq!(plain_text(&doc), "foo middle bar");
    }

    #[test]
    fn restored_run_keeps_its_properties() {
        use crate::model::{Paragraph, RevisionMeta};
        // A deletion whose run carries rPr (bold). Rejecting it must restore the
        // run WITH its properties_xml intact.
        let para = Paragraph::from_inlines(vec![Inline::Deletion {
            meta: RevisionMeta {
                id: "9".into(),
                author: "A".into(),
                date: "2026-01-01T00:00:00Z".into(),
            },
            runs: vec![Run {
                text: "bold text".into(),
                preserve_space: false,
                properties_xml: Some("<w:rPr><w:b/></w:rPr>".into()),
            }],
        }]);
        let mut doc = Document {
            body: vec![BlockContent::Paragraph(para)],
            ..Default::default()
        };
        assert!(resolve_revision(&mut doc, "9", ResolveAction::Reject));
        let restored = match &doc.body[0] {
            BlockContent::Paragraph(p) => match &p.inlines[0] {
                Inline::Run(r) => r.clone(),
                other => panic!("expected restored Run, got {other:?}"),
            },
            _ => panic!("expected paragraph"),
        };
        assert_eq!(restored.text, "bold text");
        assert_eq!(
            restored.properties_xml.as_deref(),
            Some("<w:rPr><w:b/></w:rPr>"),
            "restored run must keep its formatting"
        );
    }

    // =======================================================================
    // CLUSTER-C3: tracked changes embedded in raw (table) blocks.
    // =======================================================================

    /// A single-cell table fragment (as the parser would capture it into
    /// `BlockContent::Raw`) with a tracked insertion ("added ", id 201) and a
    /// tracked deletion ("removed ", id 202) sitting either side of plain text.
    fn table_raw_xml() -> String {
        "<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Keep </w:t></w:r>\
<w:ins w:id=\"201\" w:author=\"A\" w:date=\"2026-01-01T00:00:00Z\"><w:r><w:t>added </w:t></w:r></w:ins>\
<w:del w:id=\"202\" w:author=\"A\" w:date=\"2026-01-01T00:00:00Z\"><w:r><w:delText>removed </w:delText></w:r></w:del>\
<w:r><w:t>tail</w:t></w:r></w:p></w:tc></w:tr></w:tbl>"
            .to_string()
    }

    fn doc_with_table_and_paragraph() -> Document {
        // A normal paragraph revision (id 101) alongside the raw table block,
        // so tests can assert the table pass never disturbs paragraph resolve.
        let mut doc = build_fixture_model();
        doc.body.push(BlockContent::Raw { xml: table_raw_xml() });
        doc
    }

    #[test]
    fn accept_all_resolves_tracked_changes_inside_a_raw_table_block() {
        let mut doc = doc_with_table_and_paragraph();
        // fixture: 1 insertion + 1 deletion; table: 1 insertion + 1 deletion.
        let n = resolve_all(&mut doc, ResolveAction::Accept);
        assert_eq!(n, 4);

        let BlockContent::Raw { xml } = &doc.body[doc.body.len() - 1] else {
            panic!("expected the raw table block to remain a Raw block");
        };
        assert!(
            !xml.contains("w:ins") && !xml.contains("w:del"),
            "accept-all must resolve every tracked change in the table, got: {xml}"
        );
        // Insertion text kept...
        assert!(xml.contains("added "), "kept insertion text missing: {xml}");
        // ...deletion text gone (the confidentiality-critical assertion: a
        // deleted run inside a table must NOT survive accept-all).
        assert!(
            !xml.contains("removed"),
            "deleted text leaked into the saved table after accept-all: {xml}"
        );
        assert!(xml.contains("Keep ") && xml.contains("tail"));
    }

    #[test]
    fn reject_all_resolves_tracked_changes_inside_a_raw_table_block() {
        let mut doc = doc_with_table_and_paragraph();
        let n = resolve_all(&mut doc, ResolveAction::Reject);
        assert_eq!(n, 4);

        let BlockContent::Raw { xml } = &doc.body[doc.body.len() - 1] else {
            panic!("expected the raw table block to remain a Raw block");
        };
        assert!(!xml.contains("w:ins") && !xml.contains("w:del") && !xml.contains("delText"));
        // Insertion dropped...
        assert!(!xml.contains("added"), "rejected insertion text leaked: {xml}");
        // ...deletion restored as plain text.
        assert!(xml.contains("removed "), "rejected deletion was not restored: {xml}");
        assert!(xml.contains("<w:t>removed </w:t>"), "restored text must use w:t, not w:delText: {xml}");
    }

    #[test]
    fn resolve_all_on_table_only_document_reports_correct_count_and_is_idempotent() {
        let mut doc = Document {
            body: vec![BlockContent::Raw { xml: table_raw_xml() }],
            ..Default::default()
        };
        assert_eq!(resolve_all(&mut doc, ResolveAction::Accept), 2);
        // Second pass: nothing left to resolve.
        assert_eq!(resolve_all(&mut doc, ResolveAction::Accept), 0);
    }

    #[test]
    fn resolve_revision_finds_and_resolves_an_id_that_only_exists_in_a_table() {
        let mut doc = doc_with_table_and_paragraph();
        // id 202 (the deletion) lives ONLY inside the raw table block.
        assert!(resolve_revision(&mut doc, "202", ResolveAction::Accept));

        let BlockContent::Raw { xml } = &doc.body[doc.body.len() - 1] else {
            panic!("expected the raw table block to remain a Raw block");
        };
        // The targeted deletion (202) was accepted (applied -> text gone)...
        assert!(!xml.contains("removed"), "targeted deletion in table not resolved: {xml}");
        // ...but the UNRELATED insertion (201) in the same table is untouched.
        assert!(xml.contains("w:ins") && xml.contains("added "));

        // The paragraph-level fixture revisions (101/102) must be completely
        // unaffected by resolving a table-only id.
        let remaining_ids: Vec<String> = doc.revisions().iter().map(|(m, _, _)| m.id.clone()).collect();
        assert!(remaining_ids.contains(&"101".to_string()));
        assert!(remaining_ids.contains(&"102".to_string()));
    }

    #[test]
    fn resolve_revision_unknown_id_against_table_document_is_noop_and_reports_false() {
        let mut doc = doc_with_table_and_paragraph();
        let before = doc.clone();
        assert!(!resolve_revision(&mut doc, "does-not-exist", ResolveAction::Accept));
        assert_eq!(doc, before, "unknown id must not mutate paragraphs or the raw table");
    }

    #[test]
    fn resolve_raw_xml_preserves_unrelated_markup_and_nested_table_structure() {
        // A two-row table where only row 2's revisions match the predicate; row
        // 1's tracked changes (different ids) and the grid/cell properties must
        // round-trip byte-for-byte.
        let xml = "<w:tbl><w:tblGrid><w:gridCol w:w=\"1000\"/></w:tblGrid>\
<w:tr><w:tc><w:p><w:ins w:id=\"1\" w:author=\"A\" w:date=\"d\"><w:r><w:t>row1</w:t></w:r></w:ins></w:p></w:tc></w:tr>\
<w:tr><w:tc><w:p><w:ins w:id=\"2\" w:author=\"A\" w:date=\"d\"><w:r><w:t>row2</w:t></w:r></w:ins></w:p></w:tc></w:tr>\
</w:tbl>";
        let (resolved, changed) =
            resolve_raw_xml(xml, ResolveAction::Accept, &|id| id == "2", true).unwrap();
        assert!(changed);
        assert!(resolved.contains("w:tblGrid") && resolved.contains("gridCol"));
        // Row 1 (id 1) untouched — still a tracked insertion.
        assert!(resolved.contains("w:id=\"1\""));
        assert!(resolved.contains("<w:ins w:id=\"1\""));
        // Row 2 (id 2) resolved — unwrapped, no ins wrapper, text kept.
        assert!(!resolved.contains("w:id=\"2\""));
        assert!(resolved.contains("row2"));
    }

    // Codex review on CLUSTER-C3: a malformed/third-party `w:del` with NO
    // `w:id` attribute must still be stripped by a bulk (accept-all /
    // final-clean) resolve — the original scrubber did this unconditionally
    // as a fail-closed safety net, and the refactor to share logic with
    // `resolve_revision` initially regressed it (an id-less element could
    // never satisfy `pred`, so it silently survived "accept everything").

    #[test]
    fn resolve_raw_xml_with_missing_id_true_strips_malformed_ids_less_deletion() {
        let xml = "<w:tbl><w:tr><w:tc><w:p><w:del><w:r><w:delText>client name</w:delText></w:r></w:del></w:p></w:tc></w:tr></w:tbl>";
        let (resolved, changed) =
            resolve_raw_xml(xml, ResolveAction::Accept, &|_| true, true).unwrap();
        assert!(changed);
        assert!(
            !resolved.contains("client name"),
            "an id-less deletion must not survive a bulk accept: {resolved}"
        );
        assert!(!resolved.contains("w:del"));
    }

    #[test]
    fn resolve_raw_xml_with_missing_id_false_leaves_malformed_element_untouched() {
        // A targeted single-revision resolve can't safely claim an id-less
        // element as the one it was asked to resolve.
        let xml = "<w:tbl><w:tr><w:tc><w:p><w:del><w:r><w:delText>client name</w:delText></w:r></w:del></w:p></w:tc></w:tr></w:tbl>";
        let (resolved, changed) =
            resolve_raw_xml(xml, ResolveAction::Accept, &|id| id == "999", false).unwrap();
        assert!(!changed);
        assert_eq!(resolved, xml, "id-less element must round-trip byte-for-byte when not treated as a match");
    }

    #[test]
    fn resolve_all_strips_a_malformed_ids_less_deletion_inside_a_table() {
        let xml = "<w:tbl><w:tr><w:tc><w:p><w:del><w:r><w:delText>client name</w:delText></w:r></w:del></w:p></w:tc></w:tr></w:tbl>";
        let mut doc = Document {
            body: vec![BlockContent::Raw { xml: xml.to_string() }],
            ..Default::default()
        };
        // Must not early-exit as "nothing to resolve" just because the id-less
        // element isn't counted by id.
        let n = resolve_all(&mut doc, ResolveAction::Accept);
        assert_eq!(n, 1, "the malformed id-less deletion must still count as one revision");
        let BlockContent::Raw { xml } = &doc.body[0] else {
            panic!("expected raw block");
        };
        assert!(
            !xml.contains("client name"),
            "accept-all must strip an id-less deletion inside a table too: {xml}"
        );
    }

    // Codex review round 2 on CLUSTER-C3: a STRAY `w:delText` with no
    // enclosing `w:del` at all (malformed) must also be stripped by a bulk
    // accept/final-clean, and must not make `resolve_all` early-exit as if
    // there were nothing to resolve.

    #[test]
    fn resolve_raw_xml_accept_strips_a_stray_del_text_with_no_del_wrapper() {
        let xml = "<w:tbl><w:tr><w:tc><w:p><w:r><w:delText>client name</w:delText></w:r></w:p></w:tc></w:tr></w:tbl>";
        let (resolved, changed) =
            resolve_raw_xml(xml, ResolveAction::Accept, &|_| true, true).unwrap();
        assert!(changed);
        assert!(
            !resolved.contains("client name") && !resolved.contains("delText"),
            "a stray delText must not survive a bulk accept: {resolved}"
        );
    }

    #[test]
    fn resolve_raw_xml_reject_restores_a_stray_del_text_with_no_del_wrapper() {
        let xml = "<w:tbl><w:tr><w:tc><w:p><w:r><w:delText>client name</w:delText></w:r></w:p></w:tc></w:tr></w:tbl>";
        let (resolved, changed) =
            resolve_raw_xml(xml, ResolveAction::Reject, &|_| true, true).unwrap();
        assert!(changed);
        assert!(resolved.contains("client name"));
        assert!(!resolved.contains("delText"), "must be renamed to w:t, not left as delText: {resolved}");
        assert!(resolved.contains("<w:t>client name</w:t>"));
    }

    #[test]
    fn resolve_raw_xml_with_missing_id_false_leaves_stray_del_text_untouched() {
        let xml = "<w:tbl><w:tr><w:tc><w:p><w:r><w:delText>client name</w:delText></w:r></w:p></w:tc></w:tr></w:tbl>";
        let (resolved, changed) =
            resolve_raw_xml(xml, ResolveAction::Accept, &|id| id == "999", false).unwrap();
        assert!(!changed);
        assert_eq!(resolved, xml);
    }

    #[test]
    fn resolve_all_strips_a_stray_del_text_and_does_not_early_exit() {
        // A raw block whose ONLY content is an orphaned delText — no w:ins/
        // w:del at all — must still count as a revision, or resolve_all's
        // `resolved == 0` early exit would skip the block entirely.
        let xml = "<w:tbl><w:tr><w:tc><w:p><w:r><w:delText>client name</w:delText></w:r></w:p></w:tc></w:tr></w:tbl>";
        let mut doc = Document {
            body: vec![BlockContent::Raw { xml: xml.to_string() }],
            ..Default::default()
        };
        let n = resolve_all(&mut doc, ResolveAction::Accept);
        assert_eq!(n, 1, "the stray delText must count as one revision");
        let BlockContent::Raw { xml } = &doc.body[0] else {
            panic!("expected raw block");
        };
        assert!(!xml.contains("client name"), "accept-all must strip it: {xml}");
    }

    #[test]
    fn resolve_all_does_not_double_count_del_text_nested_inside_a_matched_del() {
        // Sanity check for the del_depth tracking in raw_xml_revision_ids:
        // a delText INSIDE a w:del must count once (via the del), not twice.
        let xml = "<w:tbl><w:tr><w:tc><w:p><w:del w:id=\"1\" w:author=\"A\" w:date=\"d\"><w:r><w:delText>x</w:delText></w:r></w:del></w:p></w:tc></w:tr></w:tbl>";
        let mut doc = Document {
            body: vec![BlockContent::Raw { xml: xml.to_string() }],
            ..Default::default()
        };
        assert_eq!(resolve_all(&mut doc, ResolveAction::Accept), 1);
    }

    // Codex review round 3: unwrapping a matched `w:ins`/`w:del` must not
    // silently unbind a namespace prefix its children rely on if the wrapper
    // itself was the element that locally declared it (unusual for real Word
    // output — the `xmlns:w` declaration almost always lives on the document
    // root — but not disallowed by OOXML, and preserve-by-default means never
    // turning valid third-party markup into invalid XML).

    const WML_NS: &str = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

    #[test]
    fn accepting_an_insertion_hoists_a_locally_declared_namespace_onto_its_child() {
        let xml = format!(
            "<w:tbl><w:tr><w:tc><w:p><x:ins xmlns:x=\"{WML_NS}\" x:id=\"1\" x:author=\"A\" x:date=\"d\"><x:r><x:t>hello</x:t></x:r></x:ins></w:p></w:tc></w:tr></w:tbl>"
        );
        let (resolved, changed) = resolve_raw_xml(&xml, ResolveAction::Accept, &|_| true, true).unwrap();
        assert!(changed);
        assert!(!resolved.contains("x:ins"), "the wrapper must be unwrapped: {resolved}");
        assert!(resolved.contains("hello"));
        // The x: prefix must still be BOUND somewhere the surviving x:r/x:t
        // elements can reach — the declaration must have migrated, not
        // vanished with the dropped wrapper.
        assert!(
            resolved.contains(&format!("xmlns:x=\"{WML_NS}\"")),
            "namespace declaration must be hoisted onto the surviving child, not lost: {resolved}"
        );
        // Sanity: the result is well-formed XML (round-trips through a parse).
        let mut reader = quick_xml::reader::Reader::from_str(&resolved);
        loop {
            match reader.read_event() {
                Ok(Event::Eof) => break,
                Ok(_) => {}
                Err(e) => panic!("hoisted output is not well-formed XML: {e}\n{resolved}"),
            }
        }
    }

    #[test]
    fn rejecting_a_deletion_hoists_a_locally_declared_namespace_onto_the_restored_text() {
        let xml = format!(
            "<w:tbl><w:tr><w:tc><w:p><x:del xmlns:x=\"{WML_NS}\" x:id=\"1\" x:author=\"A\" x:date=\"d\"><x:r><x:delText>client name</x:delText></x:r></x:del></w:p></w:tc></w:tr></w:tbl>"
        );
        let (resolved, changed) = resolve_raw_xml(&xml, ResolveAction::Reject, &|_| true, true).unwrap();
        assert!(changed);
        assert!(!resolved.contains("x:del"));
        assert!(resolved.contains("client name"), "reject must restore the text: {resolved}");
        assert!(
            resolved.contains(&format!("xmlns:x=\"{WML_NS}\"")),
            "namespace declaration must be hoisted: {resolved}"
        );
    }

    #[test]
    fn namespace_hoist_applies_to_every_direct_child_not_just_the_first() {
        // Two SIBLING runs inside the unwrapped ins — XML namespace scoping is
        // subtree-based, so hoisting onto only the first sibling would leave
        // the second one's x: prefix unbound.
        let xml = format!(
            "<w:tbl><w:tr><w:tc><w:p><x:ins xmlns:x=\"{WML_NS}\" x:id=\"1\" x:author=\"A\" x:date=\"d\"><x:r><x:t>foo</x:t></x:r><x:r><x:t>bar</x:t></x:r></x:ins></w:p></w:tc></w:tr></w:tbl>"
        );
        let (resolved, _) = resolve_raw_xml(&xml, ResolveAction::Accept, &|_| true, true).unwrap();
        let hoist_count = resolved.matches(&format!("xmlns:x=\"{WML_NS}\"")).count();
        assert_eq!(hoist_count, 2, "both sibling runs need their own hoisted declaration: {resolved}");
        assert!(resolved.contains("foo") && resolved.contains("bar"));
    }

    #[test]
    fn namespace_hoist_is_a_noop_when_the_wrapper_declares_nothing_locally() {
        // The overwhelmingly common real case: xmlns:w lives on the document
        // root, not on the w:ins/w:del itself — nothing to hoist, output
        // unchanged in shape.
        let xml = "<w:tbl><w:tr><w:tc><w:p><w:ins w:id=\"1\" w:author=\"A\" w:date=\"d\"><w:r><w:t>hello</w:t></w:r></w:ins></w:p></w:tc></w:tr></w:tbl>";
        let (resolved, changed) = resolve_raw_xml(xml, ResolveAction::Accept, &|_| true, true).unwrap();
        assert!(changed);
        assert!(!resolved.contains("xmlns"), "nothing to hoist when the wrapper declared no namespace: {resolved}");
        assert!(resolved.contains("hello"));
    }
}
