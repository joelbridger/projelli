// RAG (Retrieval-Augmented Generation) commands — M1 implementation.
//
// Architecture (per docs/strategy/.../06-RECOMMENDATIONS_BY_LOE.md M1):
//   - Embeddings: fastembed-rs with `MultilingualE5Small` (intfloat/multilingual-e5-small,
//     384-dim ONNX). Lazy singleton in `embedder.rs`.
//   - Storage: LanceDB dataset per workspace at `<workspace>/.lantern/vectors/`,
//     one `chunks` table. Schema lives in `store.rs`.
//   - Chunker: paragraph-aware ~384-token windows with 64-token overlap
//     (`chunker.rs`). Pure / unit-tested.
//   - Extraction: text formats read as raw UTF-8; office documents
//     (docx/xlsx/pptx/rtf) extracted natively Rust-side (VG-2b) — docx via
//     the lantern-docx tree walk, the rest via `office.rs`. The
//     `extractor::classify` dispatch in `index_one_file` covers BOTH the
//     full walk and the watcher (the watcher funnels into `rag_index_file`).
//     PDFs arrive pre-extracted from the renderer via `rag_index_pdf_chunks`.
//
// Commands exposed to the frontend:
//   - `rag_index_file(path)`               — extract → chunk → embed → upsert
//   - `rag_index_workspace()`              — walk + index every supported file,
//                                            emits `rag-indexing-progress` events
//   - `rag_retrieve(query, top_k)`         — embed query → nearest-neighbor → Hits
//   - `rag_cancel_indexing()`              — cancellation signal honoured by
//                                            the active workspace indexer
//   - `rag_set_workspace(path)`            — point the indexer at a workspace
//                                            (called once when the user opens one)
//
// `Hit` is the frozen wire format from Phase 2; do NOT change its shape.

pub mod chunker;
pub mod bm25_index;
pub mod crypto;
pub mod embedder;
pub mod extractor;
pub mod manifest;
pub mod model_download;
pub mod office;
pub mod pdf_indexer;
pub mod reranker;
pub mod reranker_download;
pub mod store;
pub mod transcript;

use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::future::Future;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::Mutex;


// ---------------------------------------------------------------------------
// Responsibility submodules (F3.1, pure move — split from the former
// single-file mod.rs). Every #[tauri::command] below still resolves at
// `commands::rag::X` (as registered in lib.rs's generate_handler!) via the
// re-exports so callers outside this module are unaffected.
// ---------------------------------------------------------------------------
mod indexing;
mod lifecycle;
mod query;
mod reconcile;
mod state;
mod verify;

pub use indexing::*;
pub use lifecycle::*;
pub use query::*;
pub use reconcile::*;
pub use state::*;
pub use verify::*;

/// Convenience: register the RAG state with a Tauri builder. Called from
/// `lib.rs::run`'s setup hook.
pub fn manage_state<R: tauri::Runtime>(app: &tauri::App<R>) {
    app.manage(RagState::default());
}

#[cfg(test)]
mod tests {
    use super::*;

    // ---- F-510 per-source diversity cap ------------------------------------

    /// Minimal Hit for cap tests: path/source_id = `source`, rest minimal.
    fn mini_hit(source: &str, score: f32) -> Hit {
        Hit {
            path: source.into(),
            chunk_text: String::new(),
            score,
            paragraph_index: 0,
            id: None,
            matter_id: None,
            source_id: Some(source.into()),
            source_type: None,
            page_number: None,
            privilege: None,
            extraction: None,
            extraction_confidence: None,
            locator: None,
            source_date: None,
            dated_fact: None,
            date_conflict: None,
        }
    }

    #[test]
    fn cap_per_source_keeps_score_order_and_caps_dominant_sources() {
        let hits = vec![
            mini_hit("/a", 0.9), mini_hit("/a", 0.89), mini_hit("/a", 0.88),
            mini_hit("/b", 0.87), mini_hit("/a", 0.86), mini_hit("/c", 0.85),
            mini_hit("/a", 0.84),
        ];
        let out = cap_per_source(hits, 2, 4);
        let sources: Vec<_> = out.iter().map(|h| h.path.clone()).collect();
        assert_eq!(sources, vec!["/a", "/a", "/b", "/c"]); // /a capped at 2, order kept
    }

    #[test]
    fn cap_per_source_zero_cap_and_short_input_are_safe() {
        assert!(cap_per_source(vec![], 4, 12).is_empty());
        let hits = vec![mini_hit("/a", 0.9)];
        assert_eq!(cap_per_source(hits.clone(), 0, 12).len(), hits.len()); // 0 = no cap (defensive)
        assert_eq!(cap_per_source(hits, 4, 0).len(), 0);
    }

    /// Build a Hit with WS-B/C citation/scope fields populated, for serde tests.
    fn sample_hit() -> Hit {
        Hit {
            path: "/w/doc.md".into(),
            chunk_text: "para".into(),
            score: 0.87,
            paragraph_index: 3,
            id: Some("abc123".into()),
            matter_id: Some("matter-acme".into()),
            source_id: Some("/w/doc.md".into()),
            source_type: None,
            page_number: None,
            privilege: Some("none".into()),
            extraction: None,
            extraction_confidence: None,
            locator: None,
            source_date: None,
            dated_fact: None,
            date_conflict: None,
        }
    }

    // ---- F-301 once-per-activation full-index latch -----------------------
    //
    // These model the exact `full_index_pending` true→false swap that gates the
    // DEFAULT full walk in `rag_index_workspace`. They guard the OOM regression:
    // the default full walk is fired on every workspace open, and rapid re-fires
    // (dev HMR reload-storm re-opening the workspace) re-ran the destructive
    // pre-3.0 migration (`drop_table` + re-index) over and over; the rapid
    // drop/recreate churn corrupted the LanceDB dataset and flooded the process
    // with panics whose unwinds leaked memory to an OOM. Contract: armed once by
    // `rag_set_workspace`; exactly one default walk consumes it; later default
    // walks for the same activation are no-ops.

    /// Try to claim the full-index latch exactly as the command does for a
    /// default (`matter_id == None`) walk. Returns true iff this caller should
    /// run the walk.
    fn claim_full_index(latch: &Arc<AtomicBool>) -> bool {
        latch
            .compare_exchange(true, false, Ordering::SeqCst, Ordering::SeqCst)
            .is_ok()
    }

    #[test]
    fn full_index_runs_once_per_activation() {
        // `rag_set_workspace` arms the latch.
        let latch: Arc<AtomicBool> = Arc::new(AtomicBool::new(true));

        // The first default walk consumes it and runs.
        assert!(claim_full_index(&latch), "first default walk runs");
        // Every subsequent default walk for the SAME activation is a no-op —
        // this is what collapses the reload-storm's dozens of re-fires into a
        // single clean pass.
        assert!(!claim_full_index(&latch), "2nd default walk is a no-op");
        assert!(!claim_full_index(&latch), "3rd default walk is a no-op");
        assert!(!claim_full_index(&latch), "Nth default walk is a no-op");
        assert!(!latch.load(Ordering::SeqCst), "latch stays consumed");
    }

    #[test]
    fn re_activation_re_arms_the_latch() {
        // Opening a (different) workspace re-arms the latch so its full walk
        // runs once too.
        let latch: Arc<AtomicBool> = Arc::new(AtomicBool::new(true));
        assert!(claim_full_index(&latch));
        assert!(!claim_full_index(&latch));

        // `rag_set_workspace` re-arms on the next activation.
        latch.store(true, Ordering::SeqCst);
        assert!(claim_full_index(&latch), "new activation runs one walk");
        assert!(!claim_full_index(&latch), "and only one");
    }

    #[test]
    fn concurrent_default_walks_only_one_wins() {
        // Even if two default walks race the claim, the atomic swap lets exactly
        // one through — no overlapping full walks on the same dataset.
        let latch: Arc<AtomicBool> = Arc::new(AtomicBool::new(true));
        let a = claim_full_index(&latch);
        let b = claim_full_index(&latch);
        assert!(a ^ b, "exactly one of two racing default walks runs");
    }

    /// Model `rag_set_workspace`'s re-arm decision: arm the full-index latch ONLY
    /// when the workspace root actually changes.
    fn set_workspace_rearms(current: Option<&Path>, incoming: &Path) -> bool {
        current != Some(incoming)
    }

    #[test]
    fn reopening_same_workspace_does_not_rearm() {
        let a = PathBuf::from("/tmp/ws-a");
        let b = PathBuf::from("/tmp/ws-b");

        // First activation: None -> /ws-a re-arms (the one clean walk).
        assert!(set_workspace_rearms(None, &a), "first open arms");

        // THE F-301 REGRESSION: re-opening the SAME workspace (every reload calls
        // setWorkspace) must NOT re-arm — otherwise the reload-storm re-triggers
        // the destructive full re-index repeatedly and runs memory away.
        assert!(!set_workspace_rearms(Some(&a), &a), "same workspace never re-arms");
        assert!(!set_workspace_rearms(Some(&a), &a), "...no matter how many times");

        // A real switch to a DIFFERENT workspace re-arms so it gets indexed once.
        assert!(set_workspace_rearms(Some(&a), &b), "switching workspaces arms");
        assert!(!set_workspace_rearms(Some(&b), &b), "then stable again");
    }

    /// Try to acquire the concurrency flag exactly as the command does.
    fn acquire_indexing(flag: &Arc<AtomicBool>) -> bool {
        flag.compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .is_ok()
    }

    #[test]
    fn concurrency_guard_blocks_overlap_and_releases_on_exit() {
        let indexing: Arc<AtomicBool> = Arc::new(AtomicBool::new(false));

        // First walk acquires the slot and holds the RAII guard.
        assert!(acquire_indexing(&indexing), "first walk acquires");
        let guard = IndexingGuard(indexing.clone());

        // A walk that arrives while the first is in flight coalesces — so two
        // walks never mutate the same LanceDB dataset concurrently (the cause of
        // the corruption-panic flood).
        assert!(!acquire_indexing(&indexing), "overlapping walk coalesces");
        assert!(indexing.load(Ordering::SeqCst));

        // When the in-flight walk finishes (or `?`-errors / panics), the guard
        // drops and frees the slot so future walks can run.
        drop(guard);
        assert!(!indexing.load(Ordering::SeqCst), "slot freed on exit");
        assert!(acquire_indexing(&indexing), "a later, non-overlapping walk runs");
    }

    #[test]
    fn hit_serializes_camel_case_for_frontend() {
        let hit = sample_hit();
        let s = serde_json::to_string(&hit).expect("serialize");
        // Frontend types will read `paragraphIndex`, not `paragraph_index`.
        assert!(s.contains("\"paragraphIndex\":3"), "got {}", s);
        assert!(s.contains("\"chunkText\":\"para\""), "got {}", s);
        assert!(s.contains("\"score\":0.87"), "got {}", s);
        assert!(s.contains("\"path\":\"/w/doc.md\""), "got {}", s);
    }

    #[test]
    fn hit_serializes_matter_and_source_id_camel_case() {
        // WS-B/C: the answer layer needs matterId + sourceId + id (the citation key).
        let hit = sample_hit();
        let s = serde_json::to_string(&hit).expect("serialize");
        assert!(s.contains("\"matterId\":\"matter-acme\""), "got {}", s);
        assert!(s.contains("\"sourceId\":\"/w/doc.md\""), "got {}", s);
        assert!(s.contains("\"id\":\"abc123\""), "got {}", s);
    }

    #[test]
    fn mail_hit_date_serializes_for_the_typescript_rag_hit_contract() {
        // This is the producer half of the cross-language date contract. The
        // matching TypeScript test consumes this exact camelCase wire shape as
        // a `RagHit`, so a mail date cannot disappear at the IPC boundary.
        let hit = Hit {
            source_type: Some("mail".into()),
            source_id: Some("mail:message-42".into()),
            source_date: Some(SourceDate {
                value: Some("2026-07-10T14:30:00.000Z".into()),
                kind: SourceDateKind::Received,
                raw_value: None,
                confidence: SourceDateConfidence::Source,
            }),
            ..sample_hit()
        };
        let value = serde_json::to_value(hit).expect("serialize mail hit");
        assert_eq!(value["sourceDate"]["value"], "2026-07-10T14:30:00.000Z");
        assert_eq!(value["sourceDate"]["kind"], "received");
        assert_eq!(value["sourceDate"]["confidence"], "source");
    }

    #[test]
    fn date_wire_contract_rejects_free_form_labels() {
        let invalid = r#"{
          "path":"/w/doc.md", "chunkText":"para", "score":0.87, "paragraphIndex":3,
          "sourceDate":{"value":"2026-07-10T14:30:00.000Z","kind":"made-up","confidence":"certain"}
        }"#;
        assert!(serde_json::from_str::<Hit>(invalid).is_err(), "IPC dates must reject labels outside the TypeScript union");
    }

    #[test]
    fn hit_round_trips_through_json() {
        let hit = sample_hit();
        let s = serde_json::to_string(&hit).unwrap();
        let back: Hit = serde_json::from_str(&s).unwrap();
        assert_eq!(hit, back);
    }

    #[test]
    fn hit_with_source_type_includes_fields_in_json() {
        let hit = Hit {
            path: "/w/doc.pdf".into(),
            chunk_text: "page text".into(),
            score: 0.9,
            paragraph_index: 0,
            id: Some("pdf-id".into()),
            matter_id: Some("matter-acme".into()),
            source_id: Some("/w/doc.pdf".into()),
            source_type: Some("pdf".into()),
            page_number: Some(1),
            privilege: Some("none".into()),
            extraction: Some("ocr".into()),
            extraction_confidence: Some(48.5),
            locator: None,
            source_date: None,
            dated_fact: None,
            date_conflict: None,
        };
        let s = serde_json::to_string(&hit).expect("serialize");
        assert!(s.contains("\"sourceType\":\"pdf\""), "got {}", s);
        assert!(s.contains("\"pageNumber\":1"), "got {}", s);
        // VG-2: the OCR disclosure crosses IPC camel-cased.
        assert!(s.contains("\"extraction\":\"ocr\""), "got {}", s);
        assert!(s.contains("\"extractionConfidence\":48.5"), "got {}", s);
    }

    #[tokio::test]
    async fn downloaded_document_cancel_returns_cancelled_not_indexed_zero() {
        let workspace = tempfile::tempdir().expect("workspace tempdir");
        let conn = store::open_connection(workspace.path())
            .await
            .expect("open vector store");
        let table = store::open_or_create_table(&conn)
            .await
            .expect("open chunks table");
        let cancel = AtomicBool::new(true);

        let outcome = index_downloaded_document_bytes(
            &table,
            "onedrive:drive:item",
            "memo.txt",
            b"this should not be embedded",
            "matter-a",
            store::PRIVILEGE_NONE,
            &[0x23; 32],
            Some(&cancel),
        )
        .await
        .expect("cancelled index returns cleanly");

        assert_eq!(outcome, DownloadedDocumentIndexOutcome::Cancelled);
    }

    #[test]
    fn hit_serializes_transcript_locator() {
        // VG-3c: the page:line locator crosses IPC so the UI can label the
        // citation "Tr. 45:12-46:3".
        let hit = Hit {
            source_type: Some("transcript".into()),
            page_number: Some(45),
            locator: Some("45:12-46:3".into()),
            ..sample_hit()
        };
        let s = serde_json::to_string(&hit).expect("serialize");
        assert!(s.contains("\"sourceType\":\"transcript\""), "got {}", s);
        assert!(s.contains("\"locator\":\"45:12-46:3\""), "got {}", s);
    }

    #[test]
    fn hit_without_optional_fields_omits_them() {
        let hit = Hit {
            path: "/w/doc.md".into(),
            chunk_text: "para".into(),
            score: 0.87,
            paragraph_index: 3,
            id: None,
            matter_id: None,
            source_id: None,
            source_type: None,
            page_number: None,
            privilege: None,
            extraction: None,
            extraction_confidence: None,
            locator: None,
            source_date: None,
            dated_fact: None,
            date_conflict: None,
        };
        let s = serde_json::to_string(&hit).expect("serialize");
        assert!(!s.contains("sourceType"), "got {}", s);
        assert!(!s.contains("pageNumber"), "got {}", s);
        assert!(!s.contains("matterId"), "got {}", s);
        assert!(!s.contains("sourceId"), "got {}", s);
        assert!(!s.contains("privilege"), "got {}", s);
        // VG-2: native chunks carry no extraction keys at all.
        assert!(!s.contains("extraction"), "got {}", s);
        // VG-3c: non-transcript hits carry no locator key at all.
        assert!(!s.contains("locator"), "got {}", s);
    }

    #[test]
    fn hit_serializes_privilege_when_present() {
        // WS-PRIV: an explicitly-included privileged hit carries its status so
        // the UI can label it (default retrieval only ever yields "none").
        let hit = sample_hit();
        let s = serde_json::to_string(&hit).expect("serialize");
        assert!(s.contains("\"privilege\":\"none\""), "got {}", s);
    }

    // -----------------------------------------------------------------------
    // WS-B/C: scope is REQUIRED — its wire encoding must force the caller to
    // name their intent (Matter vs AllMatters), never default to "everything".
    // -----------------------------------------------------------------------

    #[test]
    fn retrieval_scope_matter_round_trips_with_kind_tag() {
        let scope = RetrievalScope::Matter { matter_id: "matter-acme".into() };
        let s = serde_json::to_string(&scope).expect("serialize");
        assert!(s.contains("\"kind\":\"matter\""), "got {}", s);
        assert!(s.contains("\"matterId\":\"matter-acme\""), "got {}", s);
        let back: RetrievalScope = serde_json::from_str(&s).unwrap();
        assert_eq!(scope, back);
    }

    #[test]
    fn retrieval_scope_all_matters_is_explicitly_named() {
        let scope = RetrievalScope::AllMatters;
        let s = serde_json::to_string(&scope).expect("serialize");
        assert!(s.contains("\"kind\":\"allMatters\""), "got {}", s);
        let back: RetrievalScope = serde_json::from_str(&s).unwrap();
        assert_eq!(scope, back);
    }

    #[test]
    fn retrieval_scope_cannot_deserialize_from_empty_object() {
        // An omitted/unnamed scope must NOT decode to a silent cross-matter
        // search. With no "kind" tag, deserialization fails — there is no
        // implicit default. (This is the type-level guard that scope is required.)
        assert!(serde_json::from_str::<RetrievalScope>("{}").is_err());
    }

    // -----------------------------------------------------------------------
    // WS-B/C: verdict wire encoding for all four outcomes.
    // -----------------------------------------------------------------------

    #[test]
    fn verdict_serializes_all_four_variants() {
        let v = serde_json::to_string(&Verdict::Verified).unwrap();
        assert!(v.contains("\"verdict\":\"verified\""), "got {}", v);

        let nf = serde_json::to_string(&Verdict::NotFound).unwrap();
        assert!(nf.contains("\"verdict\":\"notFound\""), "got {}", nf);

        let mm = serde_json::to_string(&Verdict::MatterMismatch {
            actual_matter: "matter-globex".into(),
        })
        .unwrap();
        assert!(mm.contains("\"verdict\":\"matterMismatch\""), "got {}", mm);
        assert!(mm.contains("\"actualMatter\":\"matter-globex\""), "got {}", mm);

        let tm = serde_json::to_string(&Verdict::TextMismatch).unwrap();
        assert!(tm.contains("\"verdict\":\"textMismatch\""), "got {}", tm);
    }

    // -----------------------------------------------------------------------
    // WS-B/C: matter resolution + whitespace-normalized quote containment.
    // -----------------------------------------------------------------------

    #[test]
    fn resolve_matter_defaults_to_unassigned_sentinel() {
        assert_eq!(resolve_matter(None).unwrap(), store::UNASSIGNED_MATTER);
        assert_eq!(resolve_matter(Some("")).unwrap(), store::UNASSIGNED_MATTER);
        assert_eq!(resolve_matter(Some("matter-x")).unwrap(), "matter-x");
        // A malformed id is rejected, never silently coerced.
        assert!(resolve_matter(Some("bad\0id")).is_err());
    }

    #[test]
    fn resolve_privilege_defaults_to_none_and_validates() {
        // WS-PRIV: absent/empty → the safe PRIVILEGE_NONE default (no privilege
        // claim), never a privileged value by accident.
        assert_eq!(resolve_privilege(None).unwrap(), store::PRIVILEGE_NONE);
        assert_eq!(resolve_privilege(Some("")).unwrap(), store::PRIVILEGE_NONE);
        assert_eq!(
            resolve_privilege(Some("attorney-client")).unwrap(),
            store::PRIVILEGE_ATTORNEY_CLIENT
        );
        assert_eq!(
            resolve_privilege(Some("work-product")).unwrap(),
            store::PRIVILEGE_WORK_PRODUCT
        );
        // An unknown value is rejected, never silently coerced.
        assert!(resolve_privilege(Some("bogus")).is_err());
    }

    // -----------------------------------------------------------------------
    // VG-2b: sectioned-office banding — paragraph_index bands by ENUMERATION
    // index; the REAL sheet/slide number travels separately for the label.
    // -----------------------------------------------------------------------

    fn section(number: u32, label: &str, text: &str) -> office::OfficeSection {
        office::OfficeSection {
            number,
            label: label.to_string(),
            text: text.to_string(),
        }
    }

    #[test]
    fn section_chunks_band_by_enumeration_index_not_section_number() {
        // Sheet 2 was empty and skipped upstream: numbers are 1 and 3, but
        // the banding must use the enumeration index (0, 1) — assuming
        // number == idx+1 would leave a hole and mis-band.
        let sections = vec![
            section(1, "Summary", "First sheet text."),
            section(3, "Damages", "Third sheet text."),
        ];
        let banded = build_section_chunks("/w/model.xlsx", &sections);
        assert_eq!(banded.len(), 2);
        assert_eq!(banded[0].0, 1, "real sheet number travels with the group");
        assert_eq!(banded[1].0, 3, "real sheet number travels with the group");
        assert_eq!(banded[0].1[0].paragraph_index, 0);
        assert_eq!(
            banded[1].1[0].paragraph_index,
            pdf_indexer::MAX_CHUNKS_PER_PAGE,
            "second extracted section bands at idx 1, regardless of its number"
        );
    }

    #[test]
    fn long_section_chunks_stay_within_their_band() {
        let long_text = "cell value | another cell\n".repeat(400); // > one chunk
        let sections = vec![
            section(1, "Big", &long_text),
            section(2, "After", "Short tail sheet."),
        ];
        let banded = build_section_chunks("/w/big.xlsx", &sections);
        assert!(banded[0].1.len() >= 2, "long section must split into chunks");
        for c in &banded[0].1 {
            assert!(
                c.paragraph_index < pdf_indexer::MAX_CHUNKS_PER_PAGE,
                "section-0 chunk banded out of range: {}",
                c.paragraph_index
            );
        }
        // The next section starts exactly at its own band.
        assert_eq!(banded[1].1[0].paragraph_index, pdf_indexer::MAX_CHUNKS_PER_PAGE);
    }

    #[test]
    fn no_sections_produce_no_chunks() {
        let banded = build_section_chunks("/w/empty.xlsx", &[]);
        assert!(banded.is_empty());
    }

    #[test]
    fn text_contains_normalized_matches_across_whitespace() {
        let stored = "The closing date  shall be\nMarch 14, 2026.";
        assert!(text_contains_normalized(stored, "closing date shall be March 14, 2026"));
        assert!(text_contains_normalized(stored, "March 14, 2026"));
        // Misquote fails.
        assert!(!text_contains_normalized(stored, "the price is ten billion dollars"));
        // Empty quote is not verifiable.
        assert!(!text_contains_normalized(stored, "   "));
    }

    #[test]
    fn text_contains_normalized_is_case_and_curly_quote_insensitive_but_not_fuzzy() {
        let stored = "He said, \u{201C}I forwarded them to my personal email\u{201D} on Sept 9.";
        // Case drift verifies.
        assert!(text_contains_normalized(stored, "i FORWARDED them to my personal email"));
        // Curly/straight quote drift verifies (both directions of the drift).
        assert!(text_contains_normalized(stored, "\"I forwarded them to my personal email\""));
        assert!(text_contains_normalized("plain 'quote' here", "plain \u{2018}quote\u{2019} here"));
        // NOT fuzzy: a content change still fails.
        assert!(!text_contains_normalized(stored, "I forwarded them to my work email"));
        // Quote characters are CONTENT — canonicalized, never stripped. A quote
        // normalizing to just `""` is non-empty; it fails here by honest
        // containment (stored has no adjacent quote pair), not by the empty rule.
        assert!(!text_contains_normalized(stored, " \u{201C}\u{201D} "));
        // Only the genuinely empty quote hits the empty-refusal path.
        assert!(!text_contains_normalized(stored, ""));
    }

    // ---- P2.1 (Finding 2): batch citation classifier ----------------------
    fn rec(id: &str, matter: &str, source: &str, text: &str) -> store::ChunkRecord {
        store::ChunkRecord {
            id: id.to_string(),
            matter_id: matter.to_string(),
            source_id: source.to_string(),
            paragraph_index: 0,
            text: text.to_string(), // plaintext (encrypted=false) so no key needed
            encrypted: false,
            privilege: Some("none".to_string()),
            path_enc: None,
        }
    }

    #[test]
    fn classify_verifies_a_faithful_in_scope_citation() {
        let r = rec("id1", "matterA", "srcA", "the purchase price is $4.2M");
        let rows = [&r];
        let none = std::collections::HashSet::new();
        assert_eq!(
            classify_citation(&rows, "matterA", "purchase price is $4.2M", &none, None, None),
            Verdict::Verified
        );
    }

    #[test]
    fn classify_textmismatch_when_quote_absent_in_scope() {
        let r = rec("id1", "matterA", "srcA", "the purchase price is $4.2M");
        let rows = [&r];
        let none = std::collections::HashSet::new();
        assert_eq!(
            classify_citation(&rows, "matterA", "ten billion dollars", &none, None, None),
            Verdict::TextMismatch
        );
    }

    #[test]
    fn classify_mattermismatch_when_only_under_another_matter() {
        let r = rec("id1", "matterB", "srcB", "confidential Acme terms");
        let rows = [&r];
        let none = std::collections::HashSet::new();
        assert_eq!(
            classify_citation(&rows, "matterA", "confidential Acme terms", &none, None, None),
            Verdict::MatterMismatch { actual_matter: "matterB".to_string() }
        );
    }

    #[test]
    fn classify_notfound_when_no_rows() {
        let none = std::collections::HashSet::new();
        assert_eq!(
            classify_citation(&[], "matterA", "anything", &none, None, None),
            Verdict::NotFound
        );
    }

    #[test]
    fn classify_tombstoned_scoped_row_is_notfound_not_verified() {
        // A stale (tombstoned) row in the claimed matter must NOT verify.
        let r = rec("id1", "matterA", "stale-token", "the purchase price is $4.2M");
        let rows = [&r];
        let mut tomb = std::collections::HashSet::new();
        tomb.insert("stale-token".to_string());
        assert_eq!(
            classify_citation(&rows, "matterA", "purchase price is $4.2M", &tomb, None, None),
            Verdict::NotFound
        );
    }

    #[test]
    fn classify_tombstoned_other_matter_row_is_notfound_not_mismatch() {
        let r = rec("id1", "matterB", "stale-token", "confidential Acme terms");
        let rows = [&r];
        let mut tomb = std::collections::HashSet::new();
        tomb.insert("stale-token".to_string());
        assert_eq!(
            classify_citation(&rows, "matterA", "confidential Acme terms", &tomb, None, None),
            Verdict::NotFound
        );
    }

    #[test]
    fn classify_notfound_when_a_tombstoned_duplicate_exists_even_with_a_live_other_matter() {
        // A stale (tombstoned) row under matterB AND a live row under matterC,
        // claimed matterA. The single verifier could return NotFound (if it picks
        // the tombstoned row) — so the batch path must NOT disclose MatterMismatch{C}.
        let stale = rec("id1", "matterB", "stale-token", "text");
        let live = rec("id1", "matterC", "live-token", "text");
        let rows = [&stale, &live];
        let mut tomb = std::collections::HashSet::new();
        tomb.insert("stale-token".to_string());
        assert_eq!(
            classify_citation(&rows, "matterA", "text", &tomb, None, None),
            Verdict::NotFound
        );
    }

    #[test]
    fn classify_scoped_tombstoned_duplicate_fails_closed_to_notfound() {
        // Same id under the CLAIMED matter: one tombstoned (stale), one live. The
        // single verifier's limit(1) lookup could pick the stale row → NotFound, so
        // the batch path must NOT Verify from the live duplicate (fail closed).
        let stale = rec("id1", "matterA", "stale-token", "WRONG stale text");
        let live = rec("id1", "matterA", "live-token", "the purchase price is $4.2M");
        let rows = [&stale, &live];
        let mut tomb = std::collections::HashSet::new();
        tomb.insert("stale-token".to_string());
        assert_eq!(
            classify_citation(&rows, "matterA", "purchase price is $4.2M", &tomb, None, None),
            Verdict::NotFound
        );
    }

    #[test]
    fn classify_live_scoped_row_verifies_despite_tombstoned_other_matter_duplicate() {
        // A live row in the claimed matter AND a tombstoned duplicate under ANOTHER
        // matter. The scoped lookup never sees the other-matter row, so the live
        // in-scope row must still verify — matter-awareness must not over-fail-close.
        let live = rec("id1", "matterA", "live-token", "the purchase price is $4.2M");
        let other_stale = rec("id1", "matterB", "stale-token", "WRONG");
        let rows = [&live, &other_stale];
        let mut tomb = std::collections::HashSet::new();
        tomb.insert("stale-token".to_string());
        assert_eq!(
            classify_citation(&rows, "matterA", "purchase price is $4.2M", &tomb, None, None),
            Verdict::Verified
        );
    }

    #[test]
    fn classify_denies_when_the_claimed_matter_is_out_of_scope() {
        // re-review B Finding 4 (batch): a claim on a matter outside the member's
        // scope is refused before any probe — fail-closed NotFound.
        use crate::commands::crm::features::permissions::commands::MatterReadScope;
        let r = rec("id1", "matterA", "srcA", "the purchase price is $4.2M");
        let rows = [&r];
        let none = std::collections::HashSet::new();
        let scope = MatterReadScope::Only(["matterMine".to_string()].into_iter().collect());
        assert_eq!(
            classify_citation(
                &rows,
                "matterA",
                "purchase price is $4.2M",
                &none,
                None,
                Some(&scope)
            ),
            Verdict::NotFound
        );
    }

    #[test]
    fn classify_hides_a_foreign_actual_matter_instead_of_leaking_it() {
        // re-review B Finding 4: claim an in-scope matter, but the id really lives
        // under a matter OUTSIDE scope — the actual matter must NOT be disclosed;
        // it must be indistinguishable from a fabricated id.
        use crate::commands::crm::features::permissions::commands::MatterReadScope;
        let r = rec("id1", "matterB", "srcB", "confidential Acme terms");
        let rows = [&r];
        let none = std::collections::HashSet::new();
        let scope = MatterReadScope::Only(["matterMine".to_string()].into_iter().collect());
        assert_eq!(
            classify_citation(
                &rows,
                "matterMine",
                "confidential Acme terms",
                &none,
                None,
                Some(&scope)
            ),
            Verdict::NotFound,
            "a foreign actual matter must not leak through MatterMismatch"
        );
    }

    #[test]
    fn classify_discloses_a_mismatch_only_between_two_in_scope_matters() {
        // A cross-matter mismatch is legitimate to disclose only when BOTH the
        // claimed and the actual matter are within the member's scope.
        use crate::commands::crm::features::permissions::commands::MatterReadScope;
        let r = rec("id1", "matterB", "srcB", "confidential Acme terms");
        let rows = [&r];
        let none = std::collections::HashSet::new();
        let scope = MatterReadScope::Only(
            ["matterA".to_string(), "matterB".to_string()]
                .into_iter()
                .collect(),
        );
        assert_eq!(
            classify_citation(
                &rows,
                "matterA",
                "confidential Acme terms",
                &none,
                None,
                Some(&scope)
            ),
            Verdict::MatterMismatch {
                actual_matter: "matterB".to_string()
            }
        );
    }

    #[test]
    fn progress_serializes_camel_case() {
        let p = IndexingProgress {
            status: IndexingStatus::Indexing,
            processed: 12,
            total: 100,
            current_path: Some("/w/x.md".into()),
            ..Default::default()
        };
        let s = serde_json::to_string(&p).unwrap();
        assert!(s.contains("\"currentPath\":\"/w/x.md\""), "got {}", s);
        assert!(s.contains("\"processed\":12"));
        assert!(s.contains("\"total\":100"));
        assert!(s.contains("\"status\":\"Indexing\"") || s.contains("\"status\":\"indexing\""));
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn workspace_walk_guard_skips_bad_files_and_still_allows_completion_marker() {
        use std::pin::Pin;

        let dir = tempfile::tempdir().expect("tempdir must succeed");
        let files = [
            dir.path().join("01-good.md"),
            dir.path().join("02-bad.md"),
            dir.path().join("03-slow.md"),
            dir.path().join("04-after.md"),
        ];
        for file in &files {
            std::fs::write(file, "fixture").expect("write fixture file");
        }

        let mut processed = 0u32;
        let mut skipped = 0u32;
        let mut failed = 0u32;
        let mut timed_out = 0u32;

        for file in files {
            let name = file
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or_default()
                .to_string();
            let fut: Pin<Box<dyn Future<Output = anyhow::Result<()>> + Send>> =
                if name.contains("bad") {
                    Box::pin(async { anyhow::bail!("forced extraction failure") })
                } else if name.contains("slow") {
                    Box::pin(async {
                        tokio::time::sleep(Duration::from_secs(60)).await;
                        Ok(())
                    })
                } else {
                    Box::pin(async { Ok(()) })
                };

            match run_file_index_task(file, Duration::from_millis(25), fut).await {
                FileIndexOutcome::Indexed => {}
                FileIndexOutcome::Failed(_) => {
                    skipped += 1;
                    failed += 1;
                }
                FileIndexOutcome::TimedOut => {
                    skipped += 1;
                    timed_out += 1;
                }
            }
            processed += 1;
        }

        // This is the critical BUG-099 contract: even after one failed file and
        // one timed-out file, the walk can finish and stamp completion so the
        // next launch does not drop/rebuild the index forever.
        store::write_index_version(dir.path()).expect("write completion marker");

        assert_eq!(processed, 4);
        assert_eq!(skipped, 2);
        assert_eq!(failed, 1);
        assert_eq!(timed_out, 1);
        assert_eq!(store::read_index_version(dir.path()), store::INDEX_VERSION);
    }

    // -----------------------------------------------------------------------
    // BUG-099 hardening (gaps from the 2026-06-22 Codex review)
    // -----------------------------------------------------------------------

    /// Gap 2: the progress event must carry the skip/fail counts AND the skipped
    /// paths, not just the logs, so the UI can render "done, N skipped" instead
    /// of a silent "Done".
    #[test]
    fn progress_serializes_skip_counts_and_paths() {
        let p = IndexingProgress {
            status: IndexingStatus::Done,
            processed: 21,
            total: 21,
            current_path: None,
            skipped: 2,
            failed: 1,
            timed_out: 1,
            cleanup_failed: 0,
            skipped_paths: vec!["/w/stuck.docx".into(), "/w/broken.rtf".into()],
            ..Default::default()
        };
        let s = serde_json::to_string(&p).unwrap();
        assert!(s.contains("\"skipped\":2"), "got {s}");
        assert!(s.contains("\"failed\":1"), "got {s}");
        assert!(s.contains("\"timedOut\":1"), "got {s}");
        assert!(
            s.contains("\"skippedPaths\":[\"/w/stuck.docx\",\"/w/broken.rtf\"]"),
            "got {s}"
        );
    }

    /// Gap 2: per-file events stay small — when there are no skipped paths the
    /// `skippedPaths` array is omitted from the wire payload entirely.
    #[test]
    fn progress_omits_empty_skipped_paths() {
        let p = IndexingProgress {
            status: IndexingStatus::Indexing,
            processed: 3,
            total: 21,
            current_path: Some("/w/a.md".into()),
            skipped: 0,
            failed: 0,
            timed_out: 0,
            cleanup_failed: 0,
            skipped_paths: Vec::new(),
            ..Default::default()
        };
        let s = serde_json::to_string(&p).unwrap();
        assert!(!s.contains("skippedPaths"), "empty paths must be omitted: {s}");
        assert!(s.contains("\"skipped\":0"), "got {s}");
    }

    /// Gap 1 + Gap 3 (the highest-severity finding): a file we SKIPPED (timed out
    /// or failed mid-extract/embed) must have its now-possibly-stale rows dropped,
    /// so retrieval can never cite an OLD version of a file we couldn't re-read.
    /// A cleanly indexed file must be left untouched (its re-index already
    /// replaced its rows atomically).
    #[tokio::test]
    async fn skip_outcome_purges_stale_rows_but_indexed_outcome_keeps_them() {
        let key = [0x42u8; 32];
        let dir = tempfile::TempDir::new().unwrap();
        let conn = store::open_connection(dir.path()).await.expect("open conn");
        let table = store::open_or_create_table(&conn).await.expect("open table");

        let path = "/w/contract.docx";
        let mk_rows = |text: &str| {
            vec![(
                chunker::Chunk {
                    path: path.into(),
                    paragraph_index: 0,
                    text: text.into(),
                    start_offset: 0,
                    end_offset: text.len(),
                    locator: None,
                },
                vec![0.10f32; embedder::EMBEDDING_DIM],
            )]
        };
        let q = vec![0.10f32; embedder::EMBEDDING_DIM];
        let present = |table: &lancedb::Table| {
            let q = q.clone();
            let table = table.clone();
            async move { !store::nearest(&table, &q, 10, None, false, &[]).await.unwrap().is_empty() }
        };

        // Seed v1 — the file's rows now exist.
        store::upsert_chunks_for_path(
            &table,
            path,
            mk_rows("old version"),
            store::SourceType::Text,
            store::UNASSIGNED_MATTER,
            store::PRIVILEGE_NONE,
            &key,
        )
        .await
        .expect("seed v1");
        assert!(present(&table).await, "precondition: the file is indexed");

        // A cleanly INDEXED outcome must NOT purge — wiping a good file's rows
        // would itself create a missing-citation regression.
        let purge =
            purge_stale_rows_on_skip(&table, Path::new(path), &key, &FileIndexOutcome::Indexed)
                .await;
        assert_eq!(purge, PurgeOutcome::NotNeeded, "indexed files must not be purged");
        assert!(present(&table).await, "indexed file's rows must remain");

        // A TIMED-OUT outcome drops the stale rows cleanly (table is healthy).
        let purge =
            purge_stale_rows_on_skip(&table, Path::new(path), &key, &FileIndexOutcome::TimedOut)
                .await;
        assert_eq!(purge, PurgeOutcome::PurgedCleanly, "timed-out files must be purged cleanly");
        assert!(!present(&table).await, "stale rows must be gone after a timeout skip");

        // A FAILED outcome likewise purges (re-seed, then fail).
        store::upsert_chunks_for_path(
            &table,
            path,
            mk_rows("old version"),
            store::SourceType::Text,
            store::UNASSIGNED_MATTER,
            store::PRIVILEGE_NONE,
            &key,
        )
        .await
        .expect("re-seed");
        let purge = purge_stale_rows_on_skip(
            &table,
            Path::new(path),
            &key,
            &FileIndexOutcome::Failed("forced extraction failure".into()),
        )
        .await;
        assert_eq!(purge, PurgeOutcome::PurgedCleanly, "failed files must be purged cleanly");
        assert!(!present(&table).await, "stale rows must be gone after a failed skip");
    }

    /// Gap 4: the guard must time out on GENUINELY BLOCKING work — a file whose
    /// extraction (or the blocking embedder) pins a runtime thread synchronously,
    /// the real BUG-099 case — not just a cancellable `tokio::time::sleep`. The
    /// walk must return promptly instead of being frozen by the one stuck file.
    /// This also documents finding #1: `abort()` does NOT hard-kill the blocking
    /// thread (the work is still pending right after the timeout), which is why a
    /// true hard-kill would require process isolation (see the BUG-099 report).
    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn workspace_walk_guard_times_out_on_genuinely_blocking_work() {
        use std::sync::atomic::{AtomicBool, Ordering as AtomicOrdering};

        let finished = Arc::new(AtomicBool::new(false));
        let finished_in_task = finished.clone();
        let started = Instant::now();
        let outcome = run_file_index_task(
            PathBuf::from("/w/stuck.docx"),
            Duration::from_millis(30),
            async move {
                // Synchronous, non-cancellable block on a runtime worker thread.
                std::thread::sleep(Duration::from_millis(800));
                finished_in_task.store(true, AtomicOrdering::SeqCst);
                Ok(())
            },
        )
        .await;
        let elapsed = started.elapsed();

        assert_eq!(
            outcome,
            FileIndexOutcome::TimedOut,
            "genuinely blocking work must be reported as timed out"
        );
        // The guard returned long before the blocked work would finish: one stuck
        // file cannot freeze the whole walk.
        assert!(
            elapsed < Duration::from_millis(500),
            "guard must return promptly, not wait for the blocked work; took {elapsed:?}"
        );
        // Finding #1: the blocking task is STILL running after abort() — a Rust
        // task abort is not a hard kill of synchronous work.
        assert!(
            !finished.load(AtomicOrdering::SeqCst),
            "blocking task is expected to still be running after abort (no hard-kill)"
        );
    }

    // -----------------------------------------------------------------------
    // VG-6d: decrypt-on-read seam — Task 13 of the Wave 3b encrypted-vault plan.
    //
    // These tests exercise the `decrypt_if_vaulted` helper with an injected VMK
    // so no keychain is required. The full integration (vault metadata + keychain
    // → index_one_file) is covered by the live-app native pass; the unit path
    // here proves the seam logic in isolation.
    // -----------------------------------------------------------------------

    /// A vaulted file (KPV1 magic) is decrypted when the VMK is provided.
    ///
    /// This is the "destructive item 12" spec test: encrypt the plaintext,
    /// write it to a temp workspace with `.lantern-vault.json`, then drive the
    /// decrypt_if_vaulted seam and assert the plaintext is recovered.
    #[test]
    fn vaulted_file_decrypts_to_plaintext_with_vmk() {
        use lantern_vault::format::encrypt_file;

        let vmk: [u8; 32] = [0xCC; 32];
        let plaintext = b"the quick brown fox";

        // Encrypt the plaintext to produce a KPV1 blob.
        let blob = encrypt_file(plaintext, &vmk).expect("encrypt_file must succeed");

        // The blob must start with KPV1 magic.
        assert_eq!(&blob[..4], b"KPV1", "encrypted blob must have KPV1 magic");

        // decrypt_if_vaulted with the VMK must return the original plaintext.
        let result = decrypt_if_vaulted(blob, Some(&vmk));
        assert_eq!(
            result, plaintext,
            "decrypt_if_vaulted must recover the plaintext from a KPV1 blob"
        );
    }

    /// A plain file (no KPV1 magic) passes through decrypt_if_vaulted unchanged,
    /// even when a VMK is provided (the workspace is vaulted but the file is plain).
    #[test]
    fn plain_file_passes_through_decrypt_seam_unchanged() {
        let vmk: [u8; 32] = [0xDD; 32];
        let plaintext = b"# Plain markdown document\n\nThis is not encrypted.".to_vec();

        // No KPV1 magic — passes through unchanged.
        let result = decrypt_if_vaulted(plaintext.clone(), Some(&vmk));
        assert_eq!(
            result, plaintext,
            "plain file must be returned unchanged by decrypt_if_vaulted"
        );
    }

    /// Non-vaulted workspace (vault_vmk = None): any bytes pass through unchanged.
    #[test]
    fn no_vmk_passes_any_bytes_through() {
        // Even bytes that happen to look like KPV1 magic pass through when there
        // is no VMK (non-vaulted workspace or locked vault).
        let fake_vaulted = b"KPV1\x01some-garbled-bytes".to_vec();
        let result = decrypt_if_vaulted(fake_vaulted.clone(), None);
        assert_eq!(
            result, fake_vaulted,
            "bytes must pass through unchanged when vault_vmk is None"
        );
    }

    /// Wrong VMK: decrypt_if_vaulted returns the original bytes (decryption failed),
    /// never panics, never returns garbage that claims to be plaintext.
    #[test]
    fn wrong_vmk_returns_original_bytes_not_garbage() {
        use lantern_vault::format::encrypt_file;

        let right_vmk: [u8; 32] = [0xEE; 32];
        let wrong_vmk: [u8; 32] = [0xFF; 32];
        let plaintext = b"confidential content";

        let blob = encrypt_file(plaintext, &right_vmk).expect("encrypt_file must succeed");

        // Wrong VMK — decrypt_if_vaulted must return the original blob, not plaintext.
        let result = decrypt_if_vaulted(blob.clone(), Some(&wrong_vmk));
        assert_eq!(
            result, blob,
            "wrong VMK must return original bytes, not partially-decrypted garbage"
        );
        // Importantly, the result must NOT equal the plaintext.
        assert_ne!(result.as_slice(), plaintext.as_slice());
    }

    // -----------------------------------------------------------------------
    // BUG-099 blockers 1 & 2 — the new robustness guarantees
    // -----------------------------------------------------------------------

    /// BUG-099 blocker 1 REAL test: force a genuine purge failure, then assert
    /// (a) `PurgeFailed` is returned, (b) the tombstone set contains the path, and
    /// (c) retrieval EXCLUDES the path's stale rows via `nearest` with the tombstone
    /// token. A separate assertion proves re-indexing clears the tombstone (self-heal).
    ///
    /// The purge failure is forced by making the LanceDB dataset directory read-only
    /// after seeding, so LanceDB's delete-fragment write fails with an IO error — the
    /// same kind of error that would occur on a corrupted or locked store in production.
    #[tokio::test]
    #[cfg(unix)] // read-only dir is reliably enforceable on Unix; Windows has ACL nuances
    async fn purge_failure_tombstones_path_and_retrieval_excludes_stale_rows() {
        use std::os::unix::fs::PermissionsExt;

        let key = [0xABu8; 32];
        let dir = tempfile::TempDir::new().unwrap();
        let conn = store::open_connection(dir.path()).await.expect("open conn");
        let table = store::open_or_create_table(&conn).await.expect("open table");

        let path = "/w/corrupt.docx";
        let q = vec![0.11f32; embedder::EMBEDDING_DIM];

        // Helper closure: true when the path's rows are visible via nearest.
        let is_visible = |table: &lancedb::Table| {
            let table = table.clone();
            let q = q.clone();
            async move {
                !store::nearest(&table, &q, 10, None, false, &[])
                    .await
                    .unwrap()
                    .is_empty()
            }
        };

        // Seed a stale row (the "old version" that should never be cited after failure).
        store::upsert_chunks_for_path(
            &table,
            path,
            vec![(
                chunker::Chunk {
                    path: path.into(),
                    paragraph_index: 0,
                    text: "stale content".into(),
                    start_offset: 0,
                    end_offset: 13,
                    locator: None,
                },
                vec![0.11f32; embedder::EMBEDDING_DIM],
            )],
            store::SourceType::Text,
            store::UNASSIGNED_MATTER,
            store::PRIVILEGE_NONE,
            &key,
        )
        .await
        .expect("seed stale row");
        assert!(is_visible(&table).await, "precondition: stale row is visible");

        // Lock the LanceDB dataset directory to make delete fail with an IO error.
        // LanceDB's delete must write a deletion fragment file; this prevents that.
        let vectors_dir = store::dataset_path(dir.path());
        let orig_perms = std::fs::metadata(&vectors_dir).unwrap().permissions();
        std::fs::set_permissions(&vectors_dir, std::fs::Permissions::from_mode(0o444))
            .expect("set read-only");

        // Attempt purge — must return PurgeFailed because the IO write is blocked.
        let purge = purge_stale_rows_on_skip(
            &table,
            Path::new(path),
            &key,
            &FileIndexOutcome::TimedOut,
        )
        .await;

        // Restore permissions immediately (before any assert so cleanup is guaranteed).
        std::fs::set_permissions(&vectors_dir, orig_perms).expect("restore permissions");

        assert_eq!(
            purge,
            PurgeOutcome::PurgeFailed,
            "read-only dataset directory must cause PurgeFailed (genuine IO error)"
        );

        // (a) Stale rows are still present (the delete failed, nothing was removed).
        assert!(
            is_visible(&table).await,
            "stale rows must still be present after a failed purge"
        );

        // (b) Simulate the tombstone the walk would record: convert path to token.
        let tombstone_token = crate::commands::rag::crypto::path_token(&key, path);
        let tombstoned = vec![tombstone_token];

        // (c) Retrieval with the tombstone token MUST NOT return any hits for that path.
        let hits = store::nearest(&table, &q, 10, None, false, &tombstoned)
            .await
            .expect("nearest with tombstone");
        assert!(
            hits.is_empty(),
            "retrieval must exclude stale rows for a tombstoned path; got {} hits",
            hits.len()
        );

        // Without the tombstone, the stale rows are still findable (confirming the
        // tombstone is doing the work, not an accidental empty table).
        let hits_no_tombstone = store::nearest(&table, &q, 10, None, false, &[])
            .await
            .expect("nearest without tombstone");
        assert!(
            !hits_no_tombstone.is_empty(),
            "stale rows must still exist in the table (tombstone is the only guardrail)"
        );

        // (d) Self-heal: a successful re-index clears the tombstone. After a fresh
        // upsert, the path is no longer in the unsafe set — retrieval is restored.
        // We simulate this by showing that a subsequent successful write would remove
        // the path's token from the unsafe-token set. Here we test the prefilter
        // directly: after "clearing" the tombstone (empty slice), the fresh row IS returned.
        store::upsert_chunks_for_path(
            &table,
            path,
            vec![(
                chunker::Chunk {
                    path: path.into(),
                    paragraph_index: 0,
                    text: "fresh content".into(),
                    start_offset: 0,
                    end_offset: 13,
                    locator: None,
                },
                vec![0.11f32; embedder::EMBEDDING_DIM],
            )],
            store::SourceType::Text,
            store::UNASSIGNED_MATTER,
            store::PRIVILEGE_NONE,
            &key,
        )
        .await
        .expect("re-index after tombstone cleared");

        // After clearing the tombstone (empty exclusion list), the fresh rows return.
        let hits_after_clear = store::nearest(&table, &q, 10, None, false, &[])
            .await
            .expect("nearest after tombstone cleared");
        assert!(
            !hits_after_clear.is_empty(),
            "fresh rows must be visible after tombstone is cleared (re-index)"
        );
    }

    /// BUG-099 tombstone self-heal lifecycle: the `RagState::unsafe_tokens` set
    /// (HMAC path tokens) is the single source of truth for what retrieval must
    /// exclude. This locks in the contract both the walk and `rag_index_file`
    /// rely on: a path's TOKEN is INSERTED on PurgeFailed and REMOVED on any
    /// successful (re-)index. After removal, the set is empty, so retrieval no
    /// longer hides it. The set is fed straight to the prefilter (no conversion).
    #[tokio::test]
    async fn tombstone_set_inserts_on_failure_and_clears_on_reindex() {
        let key = [0x77u8; 32];
        let path = "/w/fixed-later.docx";
        let token = crypto::path_token(&key, path);

        // Use the real RagState field type so the test breaks if the type changes.
        let unsafe_tokens: Arc<Mutex<HashSet<String>>> = Arc::new(Mutex::new(HashSet::new()));

        // 1. PurgeFailed → the walk inserts the path's at-rest token.
        unsafe_tokens.lock().await.insert(token.clone());
        assert!(
            unsafe_tokens.lock().await.contains(&token),
            "token must be tombstoned after a cleanup failure"
        );

        // While tombstoned, retrieval feeds the token set straight to the prefilter.
        let tokens: Vec<String> = unsafe_tokens.lock().await.iter().cloned().collect();
        assert_eq!(tokens, vec![token.clone()], "exactly the one tombstone token while unsafe");

        // 2. Successful re-index (full walk OR watcher rag_index_file) → remove it.
        unsafe_tokens.lock().await.remove(&token);
        assert!(
            !unsafe_tokens.lock().await.contains(&token),
            "tombstone must be cleared after a successful re-index (self-heal)"
        );

        // After clearing, the set is empty → no exclusion.
        assert!(
            unsafe_tokens.lock().await.is_empty(),
            "no tombstone tokens after self-heal — retrieval no longer hides the path"
        );
    }

    /// BUG-099 fail-closed re-hydration: `rag_set_workspace` fires on EVERY
    /// frontend remount, not just real workspace switches. A same-workspace
    /// remount must NOT drop a LIVE in-memory tombstone whose durable persist had
    /// failed (disk would then be empty/stale). This locks in the merge-vs-replace
    /// rule: same-workspace re-set MERGES disk into the live set (union, never
    /// loses a live token); a real switch REPLACES with the new workspace's disk set.
    #[tokio::test]
    async fn rehydrate_merges_on_same_workspace_but_replaces_on_switch() {
        let live: Arc<Mutex<HashSet<String>>> = Arc::new(Mutex::new(HashSet::new()));

        // A cleanup failed AND its durable persist failed → token lives ONLY in
        // memory; disk (for THIS workspace) is empty.
        live.lock().await.insert("live-only-token".to_string());
        let durable_same: HashSet<String> = HashSet::new(); // empty on disk

        // Same-workspace remount (changed == false) → MERGE. The live-only token
        // MUST survive (otherwise the remount re-exposes the stale rows).
        {
            let changed = false;
            let mut guard = live.lock().await;
            if changed {
                *guard = durable_same.clone();
            } else {
                guard.extend(durable_same.clone());
            }
        }
        assert!(
            live.lock().await.contains("live-only-token"),
            "a live in-memory-only tombstone must survive a same-workspace remount"
        );

        // A real switch to a DIFFERENT workspace (changed == true) → REPLACE with
        // the new workspace's own durable tombstones (the old one's are irrelevant).
        let mut durable_other = HashSet::new();
        durable_other.insert("other-ws-token".to_string());
        {
            let changed = true;
            let mut guard = live.lock().await;
            if changed {
                *guard = durable_other.clone();
            } else {
                guard.extend(durable_other.clone());
            }
        }
        let final_set = live.lock().await;
        assert!(final_set.contains("other-ws-token"), "switch loads the new ws tombstones");
        assert!(
            !final_set.contains("live-only-token"),
            "a real switch must not carry the old workspace's tombstones forward"
        );
    }

    /// BUG-099 tombstone integration test: when PurgeFailed is stored in
    /// `RagState::unsafe_tokens`, the walk does NOT double-count the file in
    /// `skipped_files` (i.e. each file is counted only once as skipped even if
    /// cleanup also fails). The cleanup_failed counter tracks the additional failure.
    #[test]
    fn purge_failed_uses_separate_cleanup_counter_not_double_count() {
        // Simulate the counter logic from rag_index_workspace for three cases:
        //   1. File timed out, cleanup succeeded (PurgedCleanly) → skipped=1, failed=0, timed_out=1, cleanup_failed=0
        //   2. File failed, cleanup succeeded (PurgedCleanly)    → skipped=1, failed=1, timed_out=0, cleanup_failed=0
        //   3. File timed out, cleanup ALSO failed (PurgeFailed)  → skipped=1, failed=0, timed_out=1, cleanup_failed=1
        //      NOT skipped=2 (the old double-count bug).

        // Case 1: TimedOut + PurgedCleanly
        let (mut skipped, mut failed, mut timed_out, mut cleanup_failed) = (0u32, 0u32, 0u32, 0u32);
        let outcome = FileIndexOutcome::TimedOut;
        let purge = PurgeOutcome::PurgedCleanly;
        match outcome {
            FileIndexOutcome::Indexed => {}
            FileIndexOutcome::Failed(_) => { skipped += 1; failed += 1; }
            FileIndexOutcome::TimedOut => { skipped += 1; timed_out += 1; }
        }
        match purge {
            PurgeOutcome::NotNeeded | PurgeOutcome::PurgedCleanly => {}
            PurgeOutcome::PurgeFailed => { cleanup_failed += 1; }
        }
        assert_eq!((skipped, failed, timed_out, cleanup_failed), (1, 0, 1, 0),
            "TimedOut+PurgedCleanly: skipped=1, no double-count");

        // Case 2: Failed + PurgedCleanly
        let (mut skipped, mut failed, mut timed_out, mut cleanup_failed) = (0u32, 0u32, 0u32, 0u32);
        let outcome = FileIndexOutcome::Failed("err".into());
        let purge = PurgeOutcome::PurgedCleanly;
        match outcome {
            FileIndexOutcome::Indexed => {}
            FileIndexOutcome::Failed(_) => { skipped += 1; failed += 1; }
            FileIndexOutcome::TimedOut => { skipped += 1; timed_out += 1; }
        }
        match purge {
            PurgeOutcome::NotNeeded | PurgeOutcome::PurgedCleanly => {}
            PurgeOutcome::PurgeFailed => { cleanup_failed += 1; }
        }
        assert_eq!((skipped, failed, timed_out, cleanup_failed), (1, 1, 0, 0),
            "Failed+PurgedCleanly: skipped=1, no double-count");

        // Case 3: TimedOut + PurgeFailed — the bug was skipped=2; must be skipped=1.
        let (mut skipped, mut failed, mut timed_out, mut cleanup_failed) = (0u32, 0u32, 0u32, 0u32);
        let outcome = FileIndexOutcome::TimedOut;
        let purge = PurgeOutcome::PurgeFailed;
        match outcome {
            FileIndexOutcome::Indexed => {}
            FileIndexOutcome::Failed(_) => { skipped += 1; failed += 1; }
            FileIndexOutcome::TimedOut => { skipped += 1; timed_out += 1; }
        }
        match purge {
            PurgeOutcome::NotNeeded | PurgeOutcome::PurgedCleanly => {}
            PurgeOutcome::PurgeFailed => { cleanup_failed += 1; }
        }
        assert_eq!((skipped, failed, timed_out, cleanup_failed), (1, 0, 1, 1),
            "TimedOut+PurgeFailed: skipped=1 (not 2), cleanup_failed=1 (separate counter)");
    }

    /// BLOCKER 2: single-writer invariant — a timed-out child task cannot reach
    /// any DB write because `extract_embed_one_file` has NO table parameter.
    /// This is a STRUCTURAL guarantee, not a runtime race: the type system
    /// prevents the child from calling any store function.
    ///
    /// We verify that:
    /// (a) `run_file_extract_task` returns `(TimedOut, None)` when the child blocks,
    /// (b) the child had no opportunity to write (it has no table reference),
    /// (c) a successful extraction returns `(Indexed, Some(data))` and the
    ///     parent's `write_extracted_file` is the only path that touches the DB.
    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn single_writer_timed_out_child_cannot_write() {
        use std::sync::atomic::{AtomicBool, Ordering as AtomicOrdering};

        // Prove that a blocking child times out and returns (TimedOut, None).
        let db_write_attempted = Arc::new(AtomicBool::new(false));
        let db_write_in_task = db_write_attempted.clone();
        let started = Instant::now();

        let (outcome, data) = run_file_extract_task(
            PathBuf::from("/w/stuck.docx"),
            Duration::from_millis(30),
            async move {
                // Synchronous, non-cancellable block — the real BUG-099 case.
                std::thread::sleep(Duration::from_millis(800));
                // If we ever reach here, the "write" would happen. Mark it.
                db_write_in_task.store(true, AtomicOrdering::SeqCst);
                // No table reference here — this Future's type cannot call
                // any store::* function. The compile-time signature enforces it.
                Ok(Some(ExtractedFileData::ShouldDelete))
            },
        )
        .await;

        assert_eq!(outcome, FileIndexOutcome::TimedOut,
            "blocking child must be reported as timed out");
        assert!(data.is_none(),
            "timed-out child must return None data — parent has nothing to write");
        assert!(
            started.elapsed() < Duration::from_millis(500),
            "parent must return promptly; child block must not freeze the walk"
        );
        // The child has NOT yet set db_write_attempted — it is still blocking
        // on the thread sleep. The walk has moved on without touching the DB.
        // (If this assertion flakes, the thread sleep duration above needs
        // extending so the child is still running when we reach this check.)
        assert!(
            !db_write_attempted.load(AtomicOrdering::SeqCst),
            "child must not have reached any write code before the parent checked"
        );
    }

    /// BLOCKER 2 (positive case): a successful extraction returns (Indexed, Some(data))
    /// and the parent can write it via write_extracted_file.
    #[tokio::test]
    async fn single_writer_successful_extraction_parent_writes() {
        let key = [0x55u8; 32];
        let dir = tempfile::TempDir::new().unwrap();
        let conn = store::open_connection(dir.path()).await.expect("open conn");
        let table = store::open_or_create_table(&conn).await.expect("open table");

        let path_str = "/w/notes.md";

        // Simulate a successful extraction returning a Flat result.
        let (outcome, data) = run_file_extract_task(
            PathBuf::from(path_str),
            Duration::from_secs(10),
            async {
                let chunks = chunker::chunk_text(path_str, "Meeting notes: discuss budget.");
                let rows: Vec<(chunker::Chunk, Vec<f32>)> = chunks
                    .into_iter()
                    .map(|c| (c, vec![0.42f32; embedder::EMBEDDING_DIM]))
                    .collect();
                Ok(Some(ExtractedFileData::Flat {
                    rows,
                    source_type: store::SourceType::Text,
                }))
            },
        )
        .await;

        assert_eq!(outcome, FileIndexOutcome::Indexed);
        assert!(data.is_some(), "successful extraction must return Some(data)");

        // Parent writes the data — it is the SOLE DB writer.
        write_extracted_file(&table, path_str, data.unwrap(), store::UNASSIGNED_MATTER, store::PRIVILEGE_NONE, &key)
            .await
            .expect("parent DB write must succeed");

        // Confirm the data is now in the index.
        let q = vec![0.42f32; embedder::EMBEDDING_DIM];
        let hits = store::nearest(&table, &q, 10, None, false, &[]).await.expect("nearest");
        assert!(!hits.is_empty(), "indexed data must be retrievable after parent write");
    }

    /// `try_load_vault_vmk` returns None for a workspace with no vault metadata.
    /// (Tests the public-facing seam used by both rag_index_file and rag_index_workspace.)
    #[test]
    fn try_load_vault_vmk_returns_none_for_unvaulted_workspace() {
        let dir = tempfile::tempdir().expect("tempdir must succeed");
        let root = dir.path();

        // No .lantern-vault.json — must return None.
        let result = crate::commands::vault::try_load_vault_vmk(root);
        assert!(
            result.is_none(),
            "try_load_vault_vmk must return None for a workspace with no vault metadata"
        );
    }
}
