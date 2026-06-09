//! Programmatic construction of a minimal-but-valid .docx fixture that
//! already contains EXISTING tracked changes (an insertion + a deletion) and
//! a comment. We build the model and serialize it, so the fixture is
//! reproducible and lives under `fixtures/` as a committed binary.
//!
//! Scenario modeled (a realistic "opposing counsel sent us a redline"):
//!   Paragraph 1: "The parties agree to <ins>promptly </ins>resolve all
//!                 <del>minor </del>disputes." with a comment anchored over
//!                 the word "disputes".

use std::collections::BTreeMap;

use crate::model::{Comment, Document, Inline, Paragraph, RevisionMeta, Run};

/// Fixed date so the fixture (and tests) are deterministic.
pub const OPPOSING_COUNSEL: &str = "Opposing Counsel";
pub const OPPOSING_DATE: &str = "2026-01-15T10:00:00Z";
pub const FIXTURE_COMMENT_ID: &str = "1";

/// Build the in-memory model for the fixture.
pub fn build_fixture_model() -> Document {
    let para = Paragraph {
        inlines: vec![
            // "The parties agree to "
            Inline::Run(Run { text: "The parties agree to ".into(), preserve_space: true }),
            // tracked insertion: "promptly "
            Inline::Insertion {
                meta: RevisionMeta {
                    id: "101".into(),
                    author: OPPOSING_COUNSEL.into(),
                    date: OPPOSING_DATE.into(),
                },
                runs: vec![Run { text: "promptly ".into(), preserve_space: true }],
            },
            // "resolve all "
            Inline::Run(Run { text: "resolve all ".into(), preserve_space: true }),
            // tracked deletion: "minor "
            Inline::Deletion {
                meta: RevisionMeta {
                    id: "102".into(),
                    author: OPPOSING_COUNSEL.into(),
                    date: OPPOSING_DATE.into(),
                },
                runs: vec![Run { text: "minor ".into(), preserve_space: true }],
            },
            // comment anchored over "disputes"
            Inline::CommentRangeStart { id: FIXTURE_COMMENT_ID.into() },
            Inline::Run(Run::new("disputes")),
            Inline::CommentRangeEnd { id: FIXTURE_COMMENT_ID.into() },
            Inline::CommentReference { id: FIXTURE_COMMENT_ID.into() },
            // "."
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
        },
    );

    Document { body: vec![para], comments }
}
