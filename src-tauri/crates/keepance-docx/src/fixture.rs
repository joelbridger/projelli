//! Programmatic construction of a minimal-but-realistic `.docx` fixture used by
//! the test suite. It already contains EXISTING tracked changes (an insertion +
//! a deletion), a comment, AND preserved properties (`pPr`/`rPr`) so the
//! round-trip tests can prove preserve-by-default at the document.xml level.
//!
//! Scenario ("opposing counsel sent us a redline"):
//!   A styled paragraph: "The parties agree to <ins>promptly </ins>resolve all
//!   <del>minor </del>disputes." with a comment anchored over "disputes", and a
//!   bold run to prove run-properties survive.

use std::collections::BTreeMap;

use crate::model::{BlockContent, Comment, Document, Inline, Paragraph, RevisionMeta, Run};

pub const OPPOSING_COUNSEL: &str = "Opposing Counsel";
pub const OPPOSING_DATE: &str = "2026-01-15T10:00:00Z";
pub const FIXTURE_COMMENT_ID: &str = "1";

/// Build the in-memory model for the fixture.
pub fn build_fixture_model() -> Document {
    let para = Paragraph {
        // Preserved paragraph properties (a named style) — must survive.
        properties_xml: Some(
            "<w:pPr><w:pStyle w:val=\"BodyText\"/></w:pPr>".to_string(),
        ),
        inlines: vec![
            // A run WITH preserved run-properties (bold) — must survive.
            Inline::Run(Run {
                text: "The parties agree to ".into(),
                preserve_space: true,
                properties_xml: Some("<w:rPr><w:b/></w:rPr>".into()),
            }),
            // tracked insertion: "promptly "
            Inline::Insertion {
                meta: RevisionMeta {
                    id: "101".into(),
                    author: OPPOSING_COUNSEL.into(),
                    date: OPPOSING_DATE.into(),
                },
                runs: vec![Run {
                    text: "promptly ".into(),
                    preserve_space: true,
                    properties_xml: None,
                }],
            },
            // "resolve all "
            Inline::Run(Run {
                text: "resolve all ".into(),
                preserve_space: true,
                properties_xml: None,
            }),
            // tracked deletion: "minor "
            Inline::Deletion {
                meta: RevisionMeta {
                    id: "102".into(),
                    author: OPPOSING_COUNSEL.into(),
                    date: OPPOSING_DATE.into(),
                },
                runs: vec![Run {
                    text: "minor ".into(),
                    preserve_space: true,
                    properties_xml: None,
                }],
            },
            // comment anchored over "disputes"
            Inline::CommentRangeStart {
                id: FIXTURE_COMMENT_ID.into(),
            },
            Inline::Run(Run::new("disputes")),
            Inline::CommentRangeEnd {
                id: FIXTURE_COMMENT_ID.into(),
            },
            Inline::CommentReference {
                id: FIXTURE_COMMENT_ID.into(),
            },
            Inline::Run(Run::new(".")),
        ],
    };

    let mut comments = BTreeMap::new();
    comments.insert(
        FIXTURE_COMMENT_ID.into(),
        Comment {
            id: FIXTURE_COMMENT_ID.into(),
            author: OPPOSING_COUNSEL.into(),
            date: OPPOSING_DATE.into(),
            initials: Some("OC".into()),
            text: "Define the scope of disputes covered.".into(),
            body_xml: None,
        },
    );

    Document {
        format_version: crate::model::DOM_FORMAT_VERSION,
        body: vec![BlockContent::Paragraph(para)],
        comments,
    }
}
