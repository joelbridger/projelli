//! AI authoring helpers: programmatically add NEW tracked changes to the DOM,
//! the way the Keepance AI redliner (task A4) will. These are simple,
//! content-addressed edits over the typed model — the ergonomic win of a DOM
//! over raw XML string-poking.
//!
//! A4 calls into this module (via the `docx_author_revision` Tauri command).
//! Each new revision gets a fresh `w:id` from [`Document::max_revision_id`] so
//! Word's accept/reject grouping never collides with existing or sibling edits.

use crate::model::{BlockContent, Document, Inline, Paragraph, RevisionMeta, Run};

/// The author string stamped on AI-authored revisions by default. Word groups
/// accept/reject by author + id, so a recipient can filter to review only the
/// machine edits. Callers may override with their own author string.
pub const AI_AUTHOR: &str = "Keepance AI";

/// Current UTC timestamp formatted as an OOXML `w:date` value
/// (`YYYY-MM-DDThh:mm:ssZ`). Convenience for callers (e.g. the Tauri command
/// layer) that want to stamp a revision with "now" without taking their own
/// `chrono` dependency.
pub fn now_iso() -> String {
    chrono::Utc::now().format("%Y-%m-%dT%H:%M:%SZ").to_string()
}

/// Allocate the next fresh revision id for `doc`.
fn next_id(doc: &Document) -> String {
    (doc.max_revision_id() + 1).to_string()
}

/// Resolve the Nth paragraph (skipping raw blocks) to its index in `body`.
fn nth_paragraph_body_index(doc: &Document, para_idx: usize) -> Option<usize> {
    let mut seen = 0usize;
    for (i, block) in doc.body.iter().enumerate() {
        if let BlockContent::Paragraph(_) = block {
            if seen == para_idx {
                return Some(i);
            }
            seen += 1;
        }
    }
    None
}

/// Insert a NEW tracked insertion (`w:ins`) at the end of paragraph `para_idx`
/// (counting only paragraphs, not raw blocks), authored by `author` with the
/// given date. Returns the revision id used, or `None` if the paragraph index
/// is out of range.
pub fn insert_at_paragraph_end(
    doc: &mut Document,
    para_idx: usize,
    text: &str,
    author: &str,
    date: &str,
) -> Option<String> {
    let id = next_id(doc);
    let body_idx = nth_paragraph_body_index(doc, para_idx)?;
    let ins = Inline::Insertion {
        meta: RevisionMeta {
            id: id.clone(),
            author: author.into(),
            date: date.into(),
        },
        runs: vec![Run {
            text: text.into(),
            preserve_space: text != text.trim(),
            properties_xml: None,
        }],
    };
    if let BlockContent::Paragraph(p) = &mut doc.body[body_idx] {
        p.inlines.push(ins);
        return Some(id);
    }
    None
}

/// Mark the first plain `Inline::Run` whose text contains `needle` in paragraph
/// `para_idx` as a tracked deletion (`w:del`), authored by `author`. Preserves
/// the run's own properties on the deleted run. Returns the revision id, or
/// `None` if no matching run was found.
///
/// This mirrors how the AI redlines: locate text in the typed model, swap the
/// plain run for a tracked deletion. Accept/reject works in Word because each
/// deletion is its own `w:del` with a unique id.
pub fn delete_run_containing(
    doc: &mut Document,
    para_idx: usize,
    needle: &str,
    author: &str,
    date: &str,
) -> Option<String> {
    let id = next_id(doc);
    let body_idx = nth_paragraph_body_index(doc, para_idx)?;
    let para = match &mut doc.body[body_idx] {
        BlockContent::Paragraph(p) => p,
        BlockContent::Raw { .. } => return None,
    };
    for inline in para.inlines.iter_mut() {
        if let Inline::Run(run) = inline {
            if run.text.contains(needle) {
                let runs = vec![run.clone()];
                *inline = Inline::Deletion {
                    meta: RevisionMeta {
                        id: id.clone(),
                        author: author.into(),
                        date: date.into(),
                    },
                    runs,
                };
                return Some(id);
            }
        }
    }
    None
}

/// Insert a brand-new paragraph consisting entirely of a tracked insertion,
/// after paragraph `para_idx` (or at the end if out of range). Returns the
/// revision id. Useful for the AI proposing a whole new clause.
pub fn insert_paragraph_after(
    doc: &mut Document,
    para_idx: usize,
    text: &str,
    author: &str,
    date: &str,
) -> String {
    let id = next_id(doc);
    let ins = Inline::Insertion {
        meta: RevisionMeta {
            id: id.clone(),
            author: author.into(),
            date: date.into(),
        },
        runs: vec![Run {
            text: text.into(),
            preserve_space: text != text.trim(),
            properties_xml: None,
        }],
    };
    let new_para = BlockContent::Paragraph(Paragraph::from_inlines(vec![ins]));
    match nth_paragraph_body_index(doc, para_idx) {
        Some(body_idx) => doc.body.insert(body_idx + 1, new_para),
        None => doc.body.push(new_para),
    }
    id
}

// ===========================================================================
// Batch AI redline (A4) — drift-safe multi-edit application
// ===========================================================================

/// One edit the AI redliner proposes against the ORIGINAL document. This is the
/// Rust mirror of the structured-output schema the model returns (see
/// `src/modules/docx/redline.ts`); the Tauri command deserializes the JSON edit
/// list into a `Vec<Edit>` and hands it to [`apply_edits`].
///
/// * `Insert` — insert `new_text` as a tracked insertion. When `anchor_text` is
///   given, the insertion is placed immediately AFTER the first occurrence of
///   `anchor_text` in the paragraph. When `at_paragraph_start` is true, it is
///   placed at the literal beginning of the paragraph (offset 0) — distinct
///   from the "no anchor" default, which appends at the paragraph END (matching
///   [`insert_at_paragraph_end`]). A caller must not set both; `at_paragraph_start`
///   takes precedence if it does (see [`apply_edits`]).
/// * `Delete` — mark the first occurrence of `anchor_text` in the paragraph as a
///   tracked deletion (splitting the surrounding run so only the matched span is
///   struck, preserving the rest as normal runs + run properties).
/// * `Replace` — a paired deletion + insertion: the first occurrence of
///   `anchor_text` is struck and `new_text` is inserted in its place, both as
///   tracked changes sharing the SAME revision id so Word groups them as one
///   accept/reject (a true "replace").
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Edit {
    Insert {
        paragraph_index: usize,
        anchor_text: Option<String>,
        new_text: String,
        /// Insert at the literal start of the paragraph (offset 0) rather than
        /// appending at the end. See the variant doc above — this is how a
        /// caller represents "this text belongs BEFORE everything else in the
        /// paragraph" (e.g. a user typing at the very front of a paragraph in
        /// Track Changes mode), which an omitted `anchor_text` alone cannot
        /// express (that means "append at end").
        at_paragraph_start: bool,
    },
    Delete {
        paragraph_index: usize,
        anchor_text: String,
    },
    Replace {
        paragraph_index: usize,
        anchor_text: String,
        new_text: String,
    },
}

impl Edit {
    fn paragraph_index(&self) -> usize {
        match self {
            Edit::Insert {
                paragraph_index, ..
            }
            | Edit::Delete {
                paragraph_index, ..
            }
            | Edit::Replace {
                paragraph_index, ..
            } => *paragraph_index,
        }
    }
}

/// The outcome of applying a single [`Edit`] in a batch. Returned in input order
/// so the caller (and the UI) can report exactly which edits anchored and which
/// did not, without aborting the whole batch on one bad anchor.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EditResult {
    /// Index of the edit in the input list.
    pub index: usize,
    /// `true` if the edit was applied; `false` if its anchor/paragraph could not
    /// be resolved (the edit was skipped).
    pub applied: bool,
    /// The revision id assigned (when applied), else `None`.
    pub revision_id: Option<String>,
    /// A short human reason when skipped (e.g. "anchor not found"), else `None`.
    pub error: Option<String>,
}

/// Apply a batch of AI-proposed [`Edit`]s to `doc` as tracked changes, DRIFT-SAFE.
///
/// Drift-safety contract (the whole point of the batch path):
///   1. **All paragraph indices address the ORIGINAL document.** We snapshot the
///      original Nth-paragraph -> body-index mapping ONCE up front, so inserting
///      a whole new paragraph for one edit never shifts the paragraph another
///      edit targets.
///   2. **All anchors resolve against the ORIGINAL run text**, never against a
///      partially-mutated paragraph. We apply edits within a paragraph
///      right-to-left (by anchor offset) so earlier splits don't invalidate the
///      offsets of later, earlier-in-the-text edits.
///   3. **Fresh, non-colliding revision ids.** We allocate ids from
///      `max_revision_id()+1` up front and hand out a distinct id per edit, so
///      Word's accept/reject grouping never merges unrelated AI edits (or
///      collides with existing human revisions).
///
/// Returns one [`EditResult`] per input edit, in order. Edits whose anchor can't
/// be found are skipped (not fatal) and reported with `applied: false`.
pub fn apply_edits(
    doc: &mut Document,
    edits: &[Edit],
    author: &str,
    date: &str,
) -> Vec<EditResult> {
    // (1) Snapshot original paragraph -> body-index map ONCE. Edits that insert
    // a new paragraph push onto a deferred list applied AFTER in-paragraph edits,
    // so this mapping stays valid for the whole in-paragraph pass.
    let mut para_body_idx: Vec<usize> = Vec::new();
    for (i, block) in doc.body.iter().enumerate() {
        if let BlockContent::Paragraph(_) = block {
            para_body_idx.push(i);
        }
    }

    // (3) Allocate fresh ids up front: one per edit. Replace consumes one id for
    // the paired del+ins (they share it); insert/delete consume one each.
    let mut next = doc.max_revision_id() + 1;
    let mut alloc_id = || {
        let id = next.to_string();
        next += 1;
        id
    };

    // Bucket edits by their (original) paragraph index, preserving input index.
    // Within a paragraph we sort by anchor START OFFSET DESCENDING so we mutate
    // right-to-left and never disturb the offsets of not-yet-applied edits.
    struct Pending {
        input_index: usize,
        edit: Edit,
        id: String,
        // Resolved anchor start offset within the paragraph's concatenated plain
        // text (None for an anchor-less append, which we treat as "end").
        anchor_offset: Option<usize>,
    }

    let mut results: Vec<EditResult> = (0..edits.len())
        .map(|i| EditResult {
            index: i,
            applied: false,
            revision_id: None,
            error: Some("not processed".into()),
        })
        .collect();

    // Group pending edits per body paragraph index.
    use std::collections::BTreeMap;
    let mut by_para: BTreeMap<usize, Vec<Pending>> = BTreeMap::new();
    // New-paragraph inserts are deferred so paragraph indices stay stable.
    // (Reserved for a future "whole new paragraph" insert mode; empty today.)
    let deferred_new_paras: Vec<(usize, Edit, String)> = Vec::new();

    // Occurrence-aware anchor matching: when several edits in the SAME paragraph
    // quote the SAME anchor text, map them to the 1st, 2nd, ... occurrence in
    // INPUT order (which is document order for the model's edit list). Without
    // this, N identical anchors would all resolve to the first occurrence and
    // stomp each other. `consumed[(body_idx, anchor)]` = byte offset to search
    // from for the next occurrence of that anchor in that paragraph.
    let mut consumed: std::collections::HashMap<(usize, String), usize> =
        std::collections::HashMap::new();

    for (i, edit) in edits.iter().enumerate() {
        let id = alloc_id();
        let para_idx = edit.paragraph_index();
        let Some(&body_idx) = para_body_idx.get(para_idx) else {
            results[i] = EditResult {
                index: i,
                applied: false,
                revision_id: None,
                error: Some(format!("paragraph index {para_idx} out of range")),
            };
            continue;
        };
        let BlockContent::Paragraph(para) = &doc.body[body_idx] else {
            results[i] = EditResult {
                index: i,
                applied: false,
                revision_id: None,
                error: Some(format!("block {para_idx} is not a paragraph")),
            };
            continue;
        };
        let plain = paragraph_plain_text(para);

        // Find the next unconsumed occurrence of `anchor` in this paragraph.
        let mut next_occurrence = |anchor: &str| -> Option<usize> {
            let key = (body_idx, anchor.to_string());
            let from = consumed.get(&key).copied().unwrap_or(0);
            if from > plain.len() {
                return None;
            }
            let rel = plain.get(from..)?.find(anchor)?;
            let abs = from + rel;
            consumed.insert(key, abs + anchor.len().max(1));
            Some(abs)
        };

        // Resolve the anchor offset against the ORIGINAL paragraph text.
        let anchor_offset = match edit {
            Edit::Insert { at_paragraph_start: true, .. } => {
                // Explicit "insert at offset 0" — distinct from the anchor-less
                // "append at end" case below. Takes precedence over any
                // anchor_text a caller mistakenly also set.
                Some(0)
            }
            Edit::Insert { anchor_text, .. } => match anchor_text {
                Some(a) if !a.is_empty() => match next_occurrence(a) {
                    Some(off) => Some(off),
                    None => {
                        results[i] = EditResult {
                            index: i,
                            applied: false,
                            revision_id: None,
                            error: Some(format!("anchor {a:?} not found in paragraph {para_idx}")),
                        };
                        continue;
                    }
                },
                // No anchor: append at end. Sort last (offset = len).
                _ => None,
            },
            Edit::Delete { anchor_text, .. } | Edit::Replace { anchor_text, .. } => {
                match next_occurrence(anchor_text.as_str()) {
                    Some(off) => Some(off),
                    None => {
                        results[i] = EditResult {
                            index: i,
                            applied: false,
                            revision_id: None,
                            error: Some(format!(
                                "anchor {anchor_text:?} not found in paragraph {para_idx}"
                            )),
                        };
                        continue;
                    }
                }
            }
        };

        by_para.entry(body_idx).or_default().push(Pending {
            input_index: i,
            edit: edit.clone(),
            id,
            anchor_offset,
        });
    }

    // Apply per paragraph, right-to-left within the paragraph.
    for (body_idx, mut pendings) in by_para {
        // Sort by offset DESC; anchor-less appends (None) go FIRST so the
        // trailing append happens before earlier-in-text splits shift nothing
        // (append targets the very end which is stable under left-side splits).
        pendings.sort_by(|a, b| {
            let ao = a.anchor_offset.unwrap_or(usize::MAX);
            let bo = b.anchor_offset.unwrap_or(usize::MAX);
            bo.cmp(&ao)
        });

        let BlockContent::Paragraph(para) = &mut doc.body[body_idx] else {
            continue;
        };

        for p in pendings {
            // Apply at the EXACT resolved start offset (computed against the
            // original text up front), NOT a fresh first-occurrence search.
            // This is what makes a repeated-substring anchor target the right
            // occurrence, and right-to-left ordering keeps each leftward edit's
            // offset valid because rightward edits never shift left-side text.
            let applied = match &p.edit {
                Edit::Insert {
                    anchor_text,
                    new_text,
                    at_paragraph_start,
                    ..
                } => apply_insert_in_para(
                    para,
                    anchor_text.as_deref(),
                    p.anchor_offset,
                    *at_paragraph_start,
                    new_text,
                    author,
                    date,
                    &p.id,
                ),
                Edit::Delete { anchor_text, .. } => apply_delete_in_para(
                    para,
                    anchor_text,
                    p.anchor_offset,
                    author,
                    date,
                    &p.id,
                ),
                Edit::Replace {
                    anchor_text,
                    new_text,
                    ..
                } => apply_replace_in_para(
                    para,
                    anchor_text,
                    p.anchor_offset,
                    new_text,
                    author,
                    date,
                    &p.id,
                ),
            };
            results[p.input_index] = if applied {
                EditResult {
                    index: p.input_index,
                    applied: true,
                    revision_id: Some(p.id),
                    error: None,
                }
            } else {
                EditResult {
                    index: p.input_index,
                    applied: false,
                    revision_id: None,
                    error: Some("anchor disappeared during apply".into()),
                }
            };
        }
    }

    // Finally apply deferred new-paragraph inserts (none today, but keeps the
    // structure honest if Insert gains a "whole paragraph" mode later).
    for (para_idx, edit, id) in deferred_new_paras {
        if let Edit::Insert { new_text, .. } = edit {
            // Reuse the existing helper but with our pre-allocated id by inlining.
            let ins = Inline::Insertion {
                meta: RevisionMeta {
                    id: id.clone(),
                    author: author.into(),
                    date: date.into(),
                },
                runs: vec![Run {
                    text: new_text.clone(),
                    preserve_space: new_text != new_text.trim(),
                    properties_xml: None,
                }],
            };
            let new_para = BlockContent::Paragraph(Paragraph::from_inlines(vec![ins]));
            match para_body_idx.get(para_idx) {
                Some(&b) => doc.body.insert(b + 1, new_para),
                None => doc.body.push(new_para),
            }
        }
    }

    results
}

/// Concatenate the visible text of a paragraph's PLAIN runs only. Anchors index
/// into this string. We deliberately count only `Inline::Run` text (not text
/// already inside an existing `w:ins`/`w:del`) so the AI edits the *clean* text
/// it was shown — matching the "final" text the redline prompt feeds the model.
fn paragraph_plain_text(p: &Paragraph) -> String {
    let mut out = String::new();
    for inline in &p.inlines {
        if let Inline::Run(r) = inline {
            out.push_str(&r.text);
        }
    }
    out
}

/// Locate the plain run + intra-run offset for a global offset into the
/// paragraph's concatenated plain-run text. Returns (inline_index, offset_in_run).
fn locate_plain_offset(p: &Paragraph, global_off: usize) -> Option<(usize, usize)> {
    let mut acc = 0usize;
    for (idx, inline) in p.inlines.iter().enumerate() {
        if let Inline::Run(r) = inline {
            let len = r.text.len();
            if global_off < acc + len || (global_off == acc + len && len > 0) {
                // Prefer to land inside this run; for an offset exactly at the
                // boundary we still attribute it to the end of this run.
                return Some((idx, global_off - acc));
            }
            acc += len;
        }
    }
    // Offset at the very end of the last plain run.
    if global_off == acc {
        // Find the last plain run.
        for (idx, inline) in p.inlines.iter().enumerate().rev() {
            if let Inline::Run(r) = inline {
                return Some((idx, r.text.len()));
            }
        }
    }
    None
}

/// Split the plain run at `inline_index` at byte `at` into up to two plain runs,
/// preserving run properties on BOTH halves. Returns the index where the right
/// half lives (== inline_index if `at == 0`, i.e. no left half created). The
/// caller then inserts new inlines around that boundary. No-op-safe for at==0
/// and at==len.
fn split_plain_run_at(para: &mut Paragraph, inline_index: usize, at: usize) -> usize {
    let (text, preserve, props) = match &para.inlines[inline_index] {
        Inline::Run(r) => (r.text.clone(), r.preserve_space, r.properties_xml.clone()),
        _ => return inline_index,
    };
    if at == 0 {
        return inline_index;
    }
    if at >= text.len() {
        return inline_index + 1;
    }
    let (left, right) = text.split_at(at);
    para.inlines[inline_index] = Inline::Run(Run {
        text: left.to_string(),
        preserve_space: preserve || left != left.trim(),
        properties_xml: props.clone(),
    });
    para.inlines.insert(
        inline_index + 1,
        Inline::Run(Run {
            text: right.to_string(),
            preserve_space: preserve || right != right.trim(),
            properties_xml: props,
        }),
    );
    inline_index + 1
}

/// Insert `new_text` as a tracked insertion. With an anchor, splits the plain
/// run so the insertion lands immediately after the anchor's end (at the EXACT
/// `anchor_start` resolved up front, so a repeated anchor targets the right
/// occurrence). With `at_paragraph_start`, it lands at the literal beginning of
/// the paragraph (before the first plain run), NOT appended at the end — see
/// the `Edit::Insert` doc comment for why this needs to be a distinct mode from
/// "no anchor" (CLUSTER-C4: an unanchored start-of-paragraph insert used to
/// fall through to the paragraph-end append below, putting new text in the
/// wrong place). Otherwise (no anchor, not at-start), appends at the paragraph
/// end.
fn apply_insert_in_para(
    para: &mut Paragraph,
    anchor: Option<&str>,
    anchor_start: Option<usize>,
    at_paragraph_start: bool,
    new_text: &str,
    author: &str,
    date: &str,
    id: &str,
) -> bool {
    let ins = Inline::Insertion {
        meta: RevisionMeta {
            id: id.into(),
            author: author.into(),
            date: date.into(),
        },
        runs: vec![Run {
            text: new_text.into(),
            preserve_space: new_text != new_text.trim(),
            properties_xml: None,
        }],
    };

    if at_paragraph_start {
        // Locate the first plain run (global offset 0); split is a no-op at
        // offset 0, so this just resolves to "the index of the first plain
        // run" and we insert immediately before it. A paragraph with no plain
        // runs at all (e.g. entirely revisions/raw content) has nowhere
        // meaningful to anchor "before the text", so fall back to the very
        // front of the paragraph's inline list.
        return match locate_plain_offset(para, 0) {
            Some((inline_idx, off)) => {
                let right_idx = split_plain_run_at(para, inline_idx, off);
                para.inlines.insert(right_idx, ins);
                true
            }
            None => {
                para.inlines.insert(0, ins);
                true
            }
        };
    }

    match anchor {
        Some(a) if !a.is_empty() => {
            // Prefer the resolved offset; fall back to first-occurrence search
            // only when none was provided (single-edit callers).
            let start = match anchor_start {
                Some(s) => s,
                None => match paragraph_plain_text(para).find(a) {
                    Some(s) => s,
                    None => return false,
                },
            };
            let end = start + a.len();
            // Find the plain run + offset for the anchor END, split there, insert.
            let Some((inline_idx, off)) = locate_plain_offset(para, end) else {
                return false;
            };
            let right_idx = split_plain_run_at(para, inline_idx, off);
            para.inlines.insert(right_idx, ins);
            true
        }
        _ => {
            para.inlines.push(ins);
            true
        }
    }
}

/// Mark the occurrence of `anchor` at `anchor_start` (which may span PART of a
/// run, or multiple consecutive plain runs) as a tracked deletion, splitting the
/// surrounding plain runs so only the matched span is struck. Returns false if
/// the anchor can't be resolved.
fn apply_delete_in_para(
    para: &mut Paragraph,
    anchor: &str,
    anchor_start: Option<usize>,
    author: &str,
    date: &str,
    id: &str,
) -> bool {
    delete_or_replace(para, anchor, anchor_start, None, author, date, id)
}

/// Replace = paired deletion + insertion sharing one id: strike the anchor at
/// `anchor_start` and insert `new_text` exactly where the anchor was.
fn apply_replace_in_para(
    para: &mut Paragraph,
    anchor: &str,
    anchor_start: Option<usize>,
    new_text: &str,
    author: &str,
    date: &str,
    id: &str,
) -> bool {
    delete_or_replace(para, anchor, anchor_start, Some(new_text), author, date, id)
}

/// Shared core for delete and replace. Splits plain runs at the anchor's start
/// and end, collects the plain runs fully inside [start,end) into a single
/// `w:del`, and (for replace) inserts a `w:ins` with `new_text` at the same
/// spot. Both share `id` so accept/reject treats a replace as one change. Uses
/// the resolved `anchor_start` when given (so a repeated anchor hits the right
/// occurrence), else falls back to first-occurrence search.
fn delete_or_replace(
    para: &mut Paragraph,
    anchor: &str,
    anchor_start: Option<usize>,
    replacement: Option<&str>,
    author: &str,
    date: &str,
    id: &str,
) -> bool {
    let start = match anchor_start {
        Some(s) => s,
        None => match paragraph_plain_text(para).find(anchor) {
            Some(s) => s,
            None => return false,
        },
    };
    // Sanity: the resolved span must still match the anchor in the current
    // plain text (guards against an offset invalidated by an overlapping edit).
    let plain = paragraph_plain_text(para);
    if start + anchor.len() > plain.len() || &plain[start..start + anchor.len()] != anchor {
        return false;
    }
    let end = start + anchor.len();

    // Split at END first (so the START offset/inline stays valid), then START.
    if let Some((end_inline, end_off)) = locate_plain_offset(para, end) {
        split_plain_run_at(para, end_inline, end_off);
    } else {
        return false;
    }
    let Some((start_inline, start_off)) = locate_plain_offset(para, start) else {
        return false;
    };
    let del_start = split_plain_run_at(para, start_inline, start_off);

    // Collect contiguous plain runs starting at `del_start` whose cumulative
    // text equals the anchor. After the two splits, the anchor is exactly a
    // sequence of whole plain runs beginning at `del_start`.
    let mut deleted_runs: Vec<Run> = Vec::new();
    let mut consumed = 0usize;
    let mut take_to = del_start;
    while take_to < para.inlines.len() {
        match &para.inlines[take_to] {
            Inline::Run(r) => {
                consumed += r.text.len();
                deleted_runs.push(r.clone());
                take_to += 1;
                if consumed >= anchor.len() {
                    break;
                }
            }
            // A non-plain inline inside the span means the anchor straddled an
            // existing revision/comment — bail rather than corrupt structure.
            _ => return false,
        }
    }
    if consumed != anchor.len() || deleted_runs.is_empty() {
        return false;
    }

    // Remove the consumed plain runs and splice in del (+ ins for replace).
    para.inlines.drain(del_start..take_to);
    let mut replacement_inlines: Vec<Inline> = Vec::new();
    if let Some(new_text) = replacement {
        // Insertion comes first so the "final" text reads new-then-(struck-old),
        // matching how Word shows a replace inline.
        replacement_inlines.push(Inline::Insertion {
            meta: RevisionMeta {
                id: id.into(),
                author: author.into(),
                date: date.into(),
            },
            runs: vec![Run {
                text: new_text.into(),
                preserve_space: new_text != new_text.trim(),
                properties_xml: None,
            }],
        });
    }
    replacement_inlines.push(Inline::Deletion {
        meta: RevisionMeta {
            id: id.into(),
            author: author.into(),
            date: date.into(),
        },
        runs: deleted_runs,
    });
    // Insert in order at del_start.
    for (k, inl) in replacement_inlines.into_iter().enumerate() {
        para.inlines.insert(del_start + k, inl);
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{BlockContent, Document, Inline, Paragraph, Run, RevisionKind};

    const AUTH: &str = "Keepance AI";
    const DATE: &str = "2026-06-09T00:00:00Z";

    /// A doc with two paragraphs of plain runs. Paragraph 0 has a bold-tagged
    /// run + a plain run so split tests prove run-properties survive.
    fn doc_two_paras() -> Document {
        let p0 = Paragraph {
            properties_xml: None,
            inlines: vec![
                Inline::Run(Run {
                    text: "The Company shall ".into(),
                    preserve_space: true,
                    properties_xml: Some("<w:rPr><w:b/></w:rPr>".into()),
                }),
                Inline::Run(Run::new("indemnify the Client for all losses.")),
            ],
        };
        let p1 = Paragraph::from_inlines(vec![Inline::Run(Run::new(
            "This Agreement is governed by Delaware law.",
        ))]);
        Document {
            format_version: crate::model::DOM_FORMAT_VERSION,
            body: vec![BlockContent::Paragraph(p0), BlockContent::Paragraph(p1)],
            comments: Default::default(),
        }
    }

    fn plain(doc: &Document, body_idx: usize) -> String {
        match &doc.body[body_idx] {
            BlockContent::Paragraph(p) => paragraph_plain_text(p),
            _ => String::new(),
        }
    }

    #[test]
    fn batch_insert_after_anchor_lands_in_the_right_place() {
        let mut doc = doc_two_paras();
        let edits = vec![Edit::Insert {
            paragraph_index: 0,
            anchor_text: Some("indemnify the Client".into()),
            new_text: " and its affiliates".into(),
            at_paragraph_start: false,
        }];
        let res = apply_edits(&mut doc, &edits, AUTH, DATE);
        assert!(res[0].applied);
        // One insertion authored by Keepance AI containing the new text.
        let revs = doc.revisions();
        assert_eq!(revs.len(), 1);
        assert_eq!(revs[0].0.author, AUTH);
        assert_eq!(revs[0].1, RevisionKind::Insertion);
        assert!(revs[0].2.iter().any(|r| r.text.contains("and its affiliates")));
        // Plain text (clean runs only) unchanged; the new text is inside w:ins.
        assert_eq!(plain(&doc, 0), "The Company shall indemnify the Client for all losses.");
    }

    #[test]
    fn batch_delete_splits_run_and_preserves_surrounding_text() {
        let mut doc = doc_two_paras();
        let edits = vec![Edit::Delete {
            paragraph_index: 0,
            anchor_text: "for all losses".into(),
        }];
        let res = apply_edits(&mut doc, &edits, AUTH, DATE);
        assert!(res[0].applied, "{:?}", res[0].error);
        let revs = doc.revisions();
        assert_eq!(revs.len(), 1);
        assert_eq!(revs[0].1, RevisionKind::Deletion);
        // The struck text is exactly the anchor.
        let del_text: String = revs[0].2.iter().map(|r| r.text.as_str()).collect();
        assert_eq!(del_text, "for all losses");
        // Remaining plain text is the original minus the struck span.
        assert_eq!(plain(&doc, 0), "The Company shall indemnify the Client .");
    }

    #[test]
    fn batch_replace_pairs_del_and_ins_with_same_id() {
        let mut doc = doc_two_paras();
        let edits = vec![Edit::Replace {
            paragraph_index: 1,
            anchor_text: "Delaware".into(),
            new_text: "New York".into(),
        }];
        let res = apply_edits(&mut doc, &edits, AUTH, DATE);
        assert!(res[0].applied);
        let revs = doc.revisions();
        // One deletion + one insertion, SHARING an id (one logical change).
        assert_eq!(revs.len(), 2);
        let ids: std::collections::HashSet<_> = revs.iter().map(|(m, _, _)| m.id.clone()).collect();
        assert_eq!(ids.len(), 1, "replace's del+ins must share one revision id");
        assert!(revs.iter().any(|(_, k, runs)| *k == RevisionKind::Insertion
            && runs.iter().any(|r| r.text.contains("New York"))));
        assert!(revs.iter().any(|(_, k, runs)| *k == RevisionKind::Deletion
            && runs.iter().any(|r| r.text.contains("Delaware"))));
    }

    /// THE drift-safety case: two edits in the SAME paragraph, where the first
    /// (in input order) targets text that appears BEFORE the second. Anchors
    /// must resolve against the ORIGINAL text and both must apply correctly,
    /// regardless of input order, with DISTINCT ids.
    #[test]
    fn batch_two_edits_same_paragraph_are_drift_safe() {
        let mut doc = doc_two_paras();
        let edits = vec![
            // Edit A: replace "Company" (early in the paragraph).
            Edit::Replace {
                paragraph_index: 0,
                anchor_text: "Company".into(),
                new_text: "Vendor".into(),
            },
            // Edit B: delete "for all losses" (late in the paragraph).
            Edit::Delete {
                paragraph_index: 0,
                anchor_text: "for all losses".into(),
            },
        ];
        let res = apply_edits(&mut doc, &edits, AUTH, DATE);
        assert!(res[0].applied, "edit A: {:?}", res[0].error);
        assert!(res[1].applied, "edit B: {:?}", res[1].error);
        // Distinct ids across the two edits (replace's del+ins share A's id).
        assert_ne!(res[0].revision_id, res[1].revision_id);

        let revs = doc.revisions();
        // A = del+ins (2 runs, 1 id), B = del (1). 3 revision elements total.
        assert_eq!(revs.len(), 3);
        assert!(revs.iter().any(|(_, k, r)| *k == RevisionKind::Insertion
            && r.iter().any(|x| x.text.contains("Vendor"))));
        assert!(revs.iter().any(|(_, k, r)| *k == RevisionKind::Deletion
            && r.iter().any(|x| x.text == "Company")));
        assert!(revs.iter().any(|(_, k, r)| *k == RevisionKind::Deletion
            && r.iter().any(|x| x.text == "for all losses")));
        // Clean plain text reflects BOTH originals struck: "Company" (replaced)
        // and "for all losses" (deleted) are now tracked-change nodes, so the
        // un-revised plain runs are what's left between them. (Final text after
        // accept/reject is computed by the resolve layer, not here.)
        assert_eq!(plain(&doc, 0), "The  shall indemnify the Client .");
    }

    #[test]
    fn batch_skips_unfound_anchor_but_applies_the_rest() {
        let mut doc = doc_two_paras();
        let edits = vec![
            Edit::Delete {
                paragraph_index: 0,
                anchor_text: "this text does not exist".into(),
            },
            Edit::Insert {
                paragraph_index: 1,
                anchor_text: Some("Delaware law".into()),
                new_text: " (as amended)".into(),
                at_paragraph_start: false,
            },
        ];
        let res = apply_edits(&mut doc, &edits, AUTH, DATE);
        assert!(!res[0].applied);
        assert!(res[0].error.as_deref().unwrap().contains("not found"));
        assert!(res[1].applied);
        // Only the successful insertion authored a revision.
        assert_eq!(doc.revisions().len(), 1);
    }

    #[test]
    fn batch_out_of_range_paragraph_is_reported_not_panicked() {
        let mut doc = doc_two_paras();
        let edits = vec![Edit::Insert {
            paragraph_index: 99,
            anchor_text: None,
            new_text: "x".into(),
            at_paragraph_start: false,
        }];
        let res = apply_edits(&mut doc, &edits, AUTH, DATE);
        assert!(!res[0].applied);
        assert!(res[0].error.as_deref().unwrap().contains("out of range"));
        assert!(doc.revisions().is_empty());
    }

    /// Repeated-substring anchoring: the same anchor text appears TWICE in the
    /// paragraph. Two delete edits at offsets pointing to DIFFERENT occurrences
    /// must each strike the intended one (not both hit the first). This exercises
    /// the resolved-offset application (not a fresh first-occurrence search).
    #[test]
    fn batch_repeated_anchor_targets_correct_occurrence() {
        let doc = Document {
            format_version: crate::model::DOM_FORMAT_VERSION,
            body: vec![BlockContent::Paragraph(Paragraph::from_inlines(vec![
                Inline::Run(Run::new("delete foo here and keep foo there")),
            ]))],
            comments: Default::default(),
        };
        // "delete foo here and keep foo there"
        //         ^7 (first foo)            ^25 (second foo)
        let first = "delete foo here and keep foo there".find("foo").unwrap();
        let second = "delete foo here and keep foo there"
            .rfind("foo")
            .unwrap();
        assert_ne!(first, second);

        // Two replaces: first foo -> "AAA", second foo -> "BBB". We build edits
        // such that input order would, under a naive first-find, collide.
        let mut d = doc.clone();
        let edits = vec![
            Edit::Replace {
                paragraph_index: 0,
                anchor_text: "foo".into(),
                new_text: "AAA".into(),
            },
            Edit::Replace {
                paragraph_index: 0,
                anchor_text: "foo".into(),
                new_text: "BBB".into(),
            },
        ];
        let res = apply_edits(&mut d, &edits, AUTH, DATE);
        assert!(res.iter().all(|r| r.applied), "both should apply");

        // Both insertions present (AAA and BBB), two deletions of "foo".
        let revs = d.revisions();
        let ins_texts: Vec<String> = revs
            .iter()
            .filter(|(_, k, _)| *k == RevisionKind::Insertion)
            .map(|(_, _, r)| r.iter().map(|x| x.text.as_str()).collect())
            .collect();
        assert!(ins_texts.iter().any(|t| t == "AAA"), "first foo replaced");
        assert!(ins_texts.iter().any(|t| t == "BBB"), "second foo replaced");
        let del_count = revs
            .iter()
            .filter(|(_, k, runs)| {
                *k == RevisionKind::Deletion && runs.iter().any(|x| x.text == "foo")
            })
            .count();
        assert_eq!(del_count, 2, "exactly two distinct 'foo' deletions");
        // Plain text between the two changes is preserved verbatim.
        assert_eq!(plain(&d, 0), "delete  here and keep  there");
    }

    #[test]
    fn batch_ids_do_not_collide_with_existing_revisions() {
        // Fixture already uses ids 101/102; new edits must exceed those.
        let mut doc = crate::fixture::build_fixture_model();
        let edits = vec![Edit::Insert {
            paragraph_index: 0,
            anchor_text: None,
            new_text: " More.".into(),
            at_paragraph_start: false,
        }];
        let res = apply_edits(&mut doc, &edits, AUTH, DATE);
        assert!(res[0].applied);
        let new_id: u64 = res[0].revision_id.as_ref().unwrap().parse().unwrap();
        assert!(new_id > 102, "new id {new_id} must not collide with 101/102");
    }

    // =======================================================================
    // CLUSTER-C4: insertion at the literal start of a paragraph.
    // =======================================================================

    /// Flatten a paragraph's text INCLUDING tracked-insertion runs (but not
    /// deletions), in document order — the "All Markup" reading. Unlike
    /// `plain()`/`paragraph_plain_text` above (which deliberately excludes
    /// revision text, see its doc comment), this is what these tests need:
    /// proof of WHERE a brand-new insertion landed relative to the existing
    /// text, not just that it exists somewhere in the revision list.
    fn visible_text_with_insertions(p: &Paragraph) -> String {
        let mut out = String::new();
        for inline in &p.inlines {
            match inline {
                Inline::Run(r) => out.push_str(&r.text),
                Inline::Insertion { runs, .. } => {
                    for r in runs {
                        out.push_str(&r.text);
                    }
                }
                _ => {}
            }
        }
        out
    }

    fn visible(doc: &Document, body_idx: usize) -> String {
        match &doc.body[body_idx] {
            BlockContent::Paragraph(p) => visible_text_with_insertions(p),
            _ => String::new(),
        }
    }

    #[test]
    fn batch_insert_at_paragraph_start_lands_before_existing_text_not_after() {
        let mut doc = doc_two_paras();
        let edits = vec![Edit::Insert {
            paragraph_index: 0,
            anchor_text: None,
            new_text: "PREAMBLE: ".into(),
            at_paragraph_start: true,
        }];
        let res = apply_edits(&mut doc, &edits, AUTH, DATE);
        assert!(res[0].applied);
        assert_eq!(
            visible(&doc, 0),
            "PREAMBLE: The Company shall indemnify the Client for all losses.",
            "start-of-paragraph insert must land BEFORE the existing text, not appended at the end"
        );
        // It's a genuine tracked insertion (not a silent plain-text splice) —
        // the existing plain runs are untouched by plain()'s definition.
        assert_eq!(
            plain(&doc, 0),
            "The Company shall indemnify the Client for all losses.",
        );
        let revs = doc.revisions();
        assert_eq!(revs.len(), 1);
        assert_eq!(revs[0].1, RevisionKind::Insertion);
        assert!(revs[0].2.iter().any(|r| r.text == "PREAMBLE: "));
    }

    #[test]
    fn at_paragraph_start_takes_precedence_over_a_stray_anchor_text() {
        // Defensive: if a caller sets both, at_paragraph_start wins rather than
        // silently anchoring elsewhere.
        let mut doc = doc_two_paras();
        let edits = vec![Edit::Insert {
            paragraph_index: 0,
            anchor_text: Some("indemnify".into()),
            new_text: "X".into(),
            at_paragraph_start: true,
        }];
        let res = apply_edits(&mut doc, &edits, AUTH, DATE);
        assert!(res[0].applied);
        assert!(visible(&doc, 0).starts_with("XThe Company"));
    }

    #[test]
    fn insert_at_paragraph_start_in_empty_paragraph_does_not_panic() {
        let para = Paragraph::from_inlines(vec![]);
        let mut doc = Document {
            format_version: crate::model::DOM_FORMAT_VERSION,
            body: vec![BlockContent::Paragraph(para)],
            comments: Default::default(),
        };
        let edits = vec![Edit::Insert {
            paragraph_index: 0,
            anchor_text: None,
            new_text: "Only text.".into(),
            at_paragraph_start: true,
        }];
        let res = apply_edits(&mut doc, &edits, AUTH, DATE);
        assert!(res[0].applied);
        assert_eq!(visible(&doc, 0), "Only text.");
    }

    #[test]
    fn anchorless_insert_without_at_paragraph_start_still_appends_at_end() {
        // Guards the OTHER half of the contract: an AI redline that legitimately
        // wants "append at the end" (the pre-existing, still-supported meaning of
        // an omitted anchor) must be unaffected by the new flag.
        let mut doc = doc_two_paras();
        let edits = vec![Edit::Insert {
            paragraph_index: 0,
            anchor_text: None,
            new_text: " Appended.".into(),
            at_paragraph_start: false,
        }];
        let res = apply_edits(&mut doc, &edits, AUTH, DATE);
        assert!(res[0].applied);
        assert!(visible(&doc, 0).ends_with("for all losses. Appended."));
    }
}
