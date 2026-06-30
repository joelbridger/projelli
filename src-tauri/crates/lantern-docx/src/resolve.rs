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

use crate::model::{BlockContent, Document, Inline, Run};

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
/// Returns `true` if at least one matching revision inline was found and
/// resolved, `false` if `revision_id` matched nothing (the document is then
/// unchanged) — the command layer turns the latter into an error.
pub fn resolve_revision(doc: &mut Document, revision_id: &str, action: ResolveAction) -> bool {
    // Note whether the id exists *before* mutating, since resolving consumes the
    // matching inlines (so we can't observe them afterward).
    let found = doc.body.iter().any(|block| match block {
        BlockContent::Paragraph(p) => p.inlines.iter().any(|i| match i {
            Inline::Insertion { meta, .. } | Inline::Deletion { meta, .. } => meta.id == revision_id,
            _ => false,
        }),
        BlockContent::Raw { .. } => false,
    });
    if !found {
        return false;
    }

    let pred = |id: &str| id == revision_id;
    for block in &mut doc.body {
        if let BlockContent::Paragraph(p) = block {
            resolve_inlines(&mut p.inlines, action, &pred);
        }
    }
    true
}

/// Resolve **every** revision in the document with the same action (accept-all
/// or reject-all) — what the review pane's bulk buttons call. Comments and
/// preserved content are untouched. Returns the number of revision inlines that
/// were resolved (0 when the document had no tracked changes).
pub fn resolve_all(doc: &mut Document, action: ResolveAction) -> usize {
    let resolved = doc
        .body
        .iter()
        .filter_map(|b| match b {
            BlockContent::Paragraph(p) => Some(p),
            BlockContent::Raw { .. } => None,
        })
        .flat_map(|p| p.inlines.iter())
        .filter(|i| matches!(i, Inline::Insertion { .. } | Inline::Deletion { .. }))
        .count();

    if resolved == 0 {
        return 0;
    }

    // Predicate matches any id → resolve all insertions/deletions.
    let pred = |_id: &str| true;
    for block in &mut doc.body {
        if let BlockContent::Paragraph(p) = block {
            resolve_inlines(&mut p.inlines, action, &pred);
        }
    }
    resolved
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
}
