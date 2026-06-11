# Wave 2 — Ingest Everything — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. One subagent per task; tasks are ordered (the order is load-bearing — see the INDEX_VERSION ladder in rule 8) and are independent unless a step says otherwise.

**Goal:** Close the Wave 2 workstreams of the vision gap closure plan — VG-2b (office documents into the semantic index), VG-2 (local OCR for scanned PDFs), VG-3c (transcript page:line citations), VG-3d (issue-spotter template), VG-4c (firm letterhead), VG-6b (Assured exercised live), VG-6e (vector-store residual hardening) — plus the two Wave-2-directed items from the Wave 1 re-run: **F-510** (finder retrieval precision) and the **Rust verifier normalization** residual. Finish with full gates, a leg-1/leg-3 harness extension run, a RESULTS §F addendum, and CHANGELOG.

**Branch:** work directly on `keepance-3.0` (same convention as Wave 1).

**Inputs (provenance):**
- `docs/strategy/2026-06-10-vision-gap-closure-plan.md` — the VG-2/2b/3c/3d/4c/6b/6e workstream definitions (§3) and Wave 2 sequencing (§4).
- `docs/quality/2026-06-11-wedge-proof/RESULTS.md` §E — the Wave 1 re-run verdicts: F-510 (finder feed dilution, rubric 0/5 with huge-notes.md indexed; directions = matter-scoped finder corpus, per-source diversity caps, possibly a source-type filter) and follow-up (f) (Rust verifier normalization: 14 statement-sides stranded at `textMismatch` on case/curly-quote drift).
- `docs/superpowers/plans/2026-06-11-wave1-fix-wave.md` — the format and rules exemplar; its F-501/F-502/F-503/F-507b fixes are in the tree and several Wave-1 line cites have drifted accordingly (corrections below).
- `src-tauri/tests/rag_deposition_contradictions.rs`, `tests/fixtures/matter-corpus/`, `scripts/wedge-proof-native.sh` — the VG-1 harness assets this wave extends.
- `docs/operations/2026-06-10-firm-provisioning.md` — backend/org state for the VG-6b live exercise (plus the live-DB peek recorded in the corrections table: the orgs table is EMPTY — there is no pre-existing test org; the exercise creates one via the documented loopback route).

## Rules (read before any task)

1. **NEVER weaken verification.** The verifier normalization (Task 5) is symmetric canonicalization ONLY: the exact same transform applied to BOTH the stored text and the quoted text, containment direction unchanged (`stored.contains(quoted)`), empty-after-normalization still fails. No fuzzy matching, no subsequence matching, no stripping of content characters beyond the named quote classes. Every existing verify test must stay green untouched; new tests ADD cases.
2. **OCR is fully local. No cloud OCR, ever** — it is the privacy product. The engine candidates are a Tesseract sidecar (the repo already ships the `piper` sidecar pattern) or tesseract-wasm in the renderer. Both run entirely on the user's machine; the data map gains an OCR line saying exactly that.
3. **The leg-1 finder-feed test is a tripwire: extend it, never retune it.** `finder_retrieval_query_at_top_k_12_feeds_both_sides_of_all_three_contradictions` (rag_deposition_contradictions.rs:393) keeps its corpus, its query, its topK, and its assertions byte-for-byte. F-510 work adds a SECOND fixture (with the huge-notes.md filler) and NEW tests against it. A failure of the original test after the office-corpus extension is a product finding, never a test to tune.
4. **Assured live exercise: test org only, credentials off-repo.** api.keepance.com is production infrastructure. The exercise creates/uses one clearly-named internal test org (the live orgs table is empty as of 2026-06-11 — verified, corrections table). Credentials and the managed provider key live in `~/.local/share/jameworld/keepance-assured-test.env` (mode 600), are never committed, never echoed into logs or artifacts, and never pasted into this repo. Banked artifacts are redacted (no tokens, no keys, last4 only).
5. **Voice + locale rules for every user-facing string:** NO em dashes (`tests/unit/i18n/en-json-snapshot.test.ts:126` enforces this on en.json), plain language, no "leverage/seamless/empower". New locale strings go into `en.json` AND hand-translated `es.json`/`de.json`, then locked: `node scripts/lock-translation.mjs <es|de> "<key>"`. Files that follow the hardcoded-copy convention (`DataMapDialog.tsx`, `ConfidentialityModeSettings.tsx`, `src/settings/schema.ts`, workflow template strings) stay hardcoded per their own file conventions — match what is there.
6. **TDD where a pure function is in play** (extractors, transcript detection/chunking, diversity cap, normalization, token derivation, letterhead merge): failing test first, then implementation. UI mounting and script work can be implement-then-verify.
7. Each task ends with `npx tsc --noEmit` (TS tasks) and/or `cargo test --lib` (Rust tasks) plus its own named tests, then a commit. Full gates (`npm run test`, `cargo test`, playwright, the heavy `--ignored` tests) run once in Task 14.
8. **INDEX_VERSION ladder (order is load-bearing):** three tasks change the on-disk chunk schema and each bumps `store.rs INDEX_VERSION` with a comment line: Task 8 (OCR columns) 7→8, Task 9 (locator column) 8→9, Task 10 (path tokenization + `path_enc`) 9→10. **LADDER RENUMBERED post-Task-3:** Task 3 consumed 7 (office formats join the index; clean drop). A Task 8 executor finding INDEX_VERSION already at 7 must NOT conclude the bump is done — Task 8 adds schema columns and REQUIRES its own bump to 8 or live tables never migrate to the new schema. Never rely on LanceDB auto-evolving a live table to a new schema — the bump forces the existing drop-and-re-index migration so every table is uniform. End users see exactly ONE re-index at update (the migration is `read_index_version < INDEX_VERSION`, not per-step); say so once in the Task 14 CHANGELOG entry.
9. **Scope guards:** F-507(a) single-run rubric completeness at 8B remains a model-capability floor — observed in the Task 14 re-run, never gated, never chased. The finder source-type filter from F-510's "candidate directions" is deliberately NOT built (the diversity cap + matter scoping are the fix; record the filter as considered-and-deferred in the RESULTS addendum). The audit `contentLength` nit from follow-up (f) stays out of scope.
10. **No deploys.** Website/scaffold copy edits (none planned) and the app release both ride later releases; Keepance is commercial — any go-live needs Jameson's explicit go. The VG-6b exercise READS the live backend and writes only its own test org rows.

## Verified code-site corrections vs the inputs

Every line cite below was re-verified against the tree on 2026-06-11 (post-Wave-1 HEAD `5ce5a17`). Material drift found and corrected:

| Input cite | Verified location |
|---|---|
| Strategy VG-2 "scanned-page detection exists at `src/lib/pdf-extract.ts:23`" | The detection contract is the `scanned` field doc + threshold at `pdf-extract.ts:21-29` (`SCANNED_THRESHOLD = 100` at `:29`), computed at `:119-120`. The actual "detected and then ignored" site is **`src/modules/memory/MemoryService.ts:324-326`** (`if (result.scanned) return { indexed: false, …, reason: 'scanned' }`) — that early-return is what Task 8 replaces. |
| Strategy VG-2b "`extractor.rs:19`: md/txt/…; docx/xlsx/pptx/rtf are an explicit M1-followup TODO" | Wave 1 (F-508) moved the list: `TEXT_EXTENSIONS` is now `extractor.rs:23-26`; the TODO is `extractor.rs:28-31` (`_DOCUMENT_EXTENSIONS_TODO`). The module header `:1-11` still says "frontend extractors … would be a near-duplicate" — superseded by the board-approved VG-2b approach (Rust-side, keepance-docx). |
| Brief: "`rag_verify_citation`'s normalized-containment, `src-tauri/src/commands/rag/mod.rs` ~772-790" | Exact: the containment call is `mod.rs:772`; the helper `text_contains_normalized` is `mod.rs:783-790` (whitespace-collapse only — no case folding, no curly-quote folding; that is precisely the residual). The leg-1 test carries a byte-identical mirror at `rag_deposition_contradictions.rs:150-173` (`verify()` helper, normalize closure `:152`) which MUST be updated in lockstep (Task 5). |
| RESULTS F-510 "topK 12 … DepositionContradictionFinder.ts:128" | Exact (`topK: 12,` at `:128`). The finder's retrieve is injected at `App.tsx:2588-2620` (`analyzeDeps.retrieve` → `MemoryService.retrieve(query, topK, scope)` → `ragRetrieve`, `tauri-commands.ts:309-319`); the engine consumes it in `WorkflowEngine.executeAnalyzeStep` (`:380+`, scope from `analyzeDeps.getScope()` at `:392`). |
| Strategy VG-2b "the `keepance-docx` crate already parses OOXML" | `parse_docx_bytes` at `src-tauri/crates/keepance-docx/src/lib.rs:113`; model: `Document { body: Vec<BlockContent>, comments }` (`model.rs:192-199`), `BlockContent::Paragraph | Raw{xml}` (`:129-134`), `Paragraph.inlines: Vec<Inline>` (`:146`), `Run.text` (`:60`), `Inline::{Run, Insertion{runs}, Deletion{runs}, …, Raw{xml}}` (`:103-122`). Tables arrive as `BlockContent::Raw` — Task 1 extracts their `<w:t>` text via quick-xml (already a crate dep, `crates/keepance-docx/Cargo.toml:21-24`: zip 4 + quick-xml 0.38). |
| Strategy VG-6e "encrypt the remaining plaintext `path`/`source_id` columns the way chunk_text already is" | The documented residual is `store.rs:35-37`; schema fields `:222-230`. **Constraint the strategy wording glosses over:** `path` is an EQUALITY-PREDICATE column — `upsert_chunks_for_path` delete (`store.rs:525`), `delete_path` (`:549-556`), `retag_privilege_for_path` (`:578`), `retag_matter_for_path` (`:610`), `pdf_indexer.rs`'s own delete (`:120`), and `list_indexed_mail_paths` (`:945`, `path LIKE 'mail:%'`). Straight AES-GCM (non-deterministic) breaks them, so Task 10 uses a deterministic keyed token for the queryable columns + a separate encrypted column for recovery. `matter_id`/`privilege` stay plaintext ON PURPOSE (prefilter isolation, `store.rs:28-32`) — out of scope, documented honestly. |
| Strategy VG-6b "remove the stale Coming soon comment" | Three sites: the stale doc comment `ConfidentialityModeSettings.tsx:12-13` (the card itself already gates on managed keys and shows "Needs admin key", `:88` + `:112` + `:150`; the literal `'Coming soon'` at `:150` is an unreachable fallback for non-assured cards, none of which set `comingSoon`), and the stale USER-FACING copy at `src/settings/schema.ts:184` ("Assured is coming soon.") + `:190` (`'Assured (coming soon)'`). Also the stale helper name `modeIsComingSoon` (`src/modules/privacy/egress.ts:225-230`). |
| Provisioning doc "the existing test org" (brief wording) | **There is no existing org.** Live-DB peek 2026-06-11 (read-only copy of `/home/jameson/services/keepance-firm-backend/data/keepance-firm.sqlite` + WAL): `orgs` = 0 rows, `users` = 0 rows. No customer data exists to endanger; Task 11 CREATES the internal test org via the documented loopback route (`POST 127.0.0.1:5194/admin/org`, runbook §5; service env `/etc/keepance-firm-backend.env`, PORT=5194). |
| Wave 1 plan rule 4 "en-json-snapshot.test.ts:125 enforces no em dashes" | Drifted by one: the test is now `:126` (`it('contains no em dashes (rule: NO em dashes anywhere)')`). |
| RESULTS §A claim 1 / harness "expected fresh-workspace count 4" | Still true pre-wave (`wedge-proof-native.sh:33,42-43`). Office indexing changes it: the seeded workspace (rsync excludes only `generators` + `README.md`, `:181-182`) will contain **13** Rust-walk-indexable files after this wave (4 text + certified transcript + 5 docx incl. zero-byte `empty.docx` which counts in the walk total but stores 0 chunks + 2 xlsx + 1 pptx). PDFs stay on the TS path (not in the walk count). Task 14 recomputes and updates the script's count comments. |
| Leg-1 isolation invariant vs the office corpus | Verified safe to extend: `intake-memo-acme.docx` extracted text contains NO "Johnson"/"Nexus"/"Marchetti" (probed 2026-06-11), so the existing leak assertions stay valid over the extended corpus. Tracked-change fixture strings for Task 1's TDD (probed verbatim from `engagement-letter-tracked.docx`): insertions "[INSERTED BY MARCHETTI] Additionally, we will provide monthly status updates." / "[INSERTED BY THORNTON] Hourly rate subject to annual review."; deletions "[TO BE REMOVED: placeholder text from template]" / "[DELETED BY THORNTON: duplicated clause — see section 4]". |
| Sidecar precedent for the OCR spike | `tauri.conf.json:81-83` (`externalBin: ["binaries/piper"]`), dev fetch `scripts/fetch-piper-sidecar.sh`, CI per-target download `.github/workflows/release.yml:146-158`, resolution helper `src-tauri/src/commands/tts.rs:49` (`resolve_piper_binary`). Tesseract is NOT preinstalled on this rig (apt candidate 5.3.4-1build5). |

---

## File map

| File | Action | Task | Responsibility |
|---|---|---|---|
| `src-tauri/crates/keepance-docx/src/text.rs` | Create | 1 | plain-text extraction from the Document tree (paragraphs + table text, revision-aware) |
| `src-tauri/crates/keepance-docx/src/lib.rs` | Modify | 1 | `pub mod text` + re-exports |
| `src-tauri/src/commands/rag/office.rs` | Create | 2 | xlsx/pptx section extraction + rtf text (zip + quick-xml) |
| `src-tauri/Cargo.toml` | Modify | 2, 10 | `zip = "4"`, `quick-xml = "0.38"` (T2); `hmac = "0.12"` (T10) |
| `src-tauri/src/commands/rag/extractor.rs` | Modify | 3 | `OFFICE_EXTENSIONS`, `classify()`, `read_bytes`, `~$` lock-file skip |
| `src-tauri/src/commands/rag/store.rs` | Modify | 3, 8, 9, 10 | SourceType variants (T3); extraction columns + V7 (T8); locator column + V8 (T9); path token + `path_enc` + V9 (T10) |
| `src-tauri/src/commands/rag/mod.rs` | Modify | 3, 4, 5, 8, 9, 10 | office dispatch in `index_one_file`; `per_source_cap` on `rag_retrieve`; verifier normalization; Hit fields; decrypt path on read |
| `src-tauri/src/commands/rag/pdf_indexer.rs` | Modify | 3, 8 | grouped-insert generalized for sectioned sources (T3); per-page OCR confidence (T8) |
| `src-tauri/src/commands/rag/chunker.rs` | Modify | 9 | `Chunk.locator: Option<String>` |
| `src-tauri/src/commands/rag/transcript.rs` | Create | 9 | line-numbered transcript detection + page:line chunking |
| `src-tauri/src/commands/rag/crypto.rs` | Modify | 10 | derived path-token key + `path_token()` |
| `src-tauri/src/commands/ocr.rs` | Create | 7 | OCR engine command(s) per the spike decision |
| `src-tauri/src/commands/mail/mod.rs` | Modify | 10 | mail callers of the tokenized store helpers |
| `src-tauri/tests/rag_deposition_contradictions.rs` | Modify | 3, 4, 5 | office corpus members + cited-office assertions; F-510 filler fixture + capped-feed proof; verify-mirror normalization |
| `tests/fixtures/matter-corpus/generators/generate-fixtures.py` | Modify | 8, 9, 12 | scanned-filing fixtures; certified transcript; letterhead template |
| `tests/fixtures/matter-corpus/*` (new fixtures) | Create | 8, 9, 12 | `scanned-filing-stamped.pdf`, `scanned-fax-noisy.pdf`, `deposition-transcript-weston-certified.txt`, `letterhead-template.docx` |
| `src/utils/tauri-commands.ts` | Modify | 3, 4, 8, 9, 12 | RagHit widening (`sourceType` union, `extraction`, `extractionConfidence`, `locator`); `perSourceCap`; ocr + letterhead command wrappers |
| `src/modules/workflow/legalAnalysis.ts` | Modify | 3, 4, 9 | `sourceLocator` labels (sheet/slide/p./Tr.); `perSourceCap` pass-through |
| `src/components/ai/AIChatViewer.tsx` | Modify | 3, 8, 9 | chip + accordion labels for office/pdf/ocr/transcript sources; low-confidence disclosure |
| `src/types/workflow.ts` | Modify | 4 | `AnalyzeStepConfig.perSourceCap` |
| `src/modules/workflow/templates/legal/DepositionContradictionFinder.ts` | Modify | 4 | `perSourceCap: 4` |
| `src/modules/memory/MemoryService.ts` | Modify | 4, 8 | retrieve options pass-through; scanned→OCR routing |
| `src/App.tsx` | Modify | 4, 12 | analyzeDeps retrieve forwards the cap; letterhead-aware new-document |
| `src/lib/pdf-extract.ts` | Modify | 8 | per-page render-to-PNG for OCR |
| `src/modules/ocr/ocrEngine.ts` | Create | 7, 8 | `ocrPageImage()` — single seam over sidecar/wasm |
| `src/modules/memory/ocrProgressStore.ts` | Create | 8 | per-page OCR progress for the indexing banner |
| `src/components/...` (rag progress banner — grep `rag-progress-banner`) | Modify | 8 | honest OCR progress line |
| `src/components/privacy/DataMapDialog.tsx` | Modify | 8, 10 | OCR row; embedding-vector residual row |
| `src/settings/schema.ts` | Modify | 8, 11, 12 | `ocrScannedPdfs` toggle; Assured copy fix; `letterheadTemplatePath` |
| `src/components/settings/ConfidentialityModeSettings.tsx` | Modify | 11 | stale Coming-soon comment rewrite |
| `src/modules/privacy/egress.ts` | Modify | 11 | `modeIsComingSoon` → `modeNeedsManagedKey` (semantics unchanged) |
| `scripts/assured-live-exercise.sh` | Create | 11 | scripted live VG-6b proof (org, key, infer, sentinel, zero-retention) |
| `src-tauri/src/commands/docx.rs` | Modify | 12 | `docx_apply_letterhead` command |
| `src-tauri/crates/keepance-docx/src/...` (merge helper) | Modify | 12 | `merge_into_template` (body swap, sectPr-safe) |
| `src/modules/workflow/WorkflowEngine.ts` | Modify | 12 | letterhead post-process at both deliverable write sites |
| `src/utils/docx-io.ts` | Modify | 12 | `applyLetterheadIfConfigured` helper |
| `src/components/workspace/FileTree.tsx` | Modify | 12 | "Use as letterhead template" context action for .docx |
| `src/modules/workflow/templates/legal/IssueSpotter.ts` | Create | 13 | VG-3d issue-spotter template |
| `src/modules/workflow/templates/legal/index.ts` | Modify | 13 | register IssueSpotter |
| `spikes/ocr-engine/DECISION.md` | Create | 6 | OCR engine decision with evidence |
| `scripts/wedge-proof-native.sh` | Modify | 14 | count updates + new-fixture notes |
| `docs/quality/2026-06-11-wedge-proof/{RESULTS,RUNBOOK}.md` | Modify | 14 | §F addendum + Wave 2 extension runbook |
| `CHANGELOG.md` | Modify | 14 | consolidated `[Unreleased]` entries |
| `docs/strategy/2026-06-10-vision-gap-closure-plan.md` | Modify | 14 | STATUS ticks for VG-2/2b/3c/3d/4c/6b/6e |
| `src/locales/{en,es,de}.json` | Modify | 8, 9, 12 | new strings (no em dashes; lock translations) |

---

### Task 1: VG-2b (part 1) — plain-text extraction inside keepance-docx

**Why this lives in the crate:** the Document tree, the revision model, and quick-xml all live there; extraction is a pure model walk. The host (Task 3) calls it.

**Files:** create `src-tauri/crates/keepance-docx/src/text.rs`; modify `src-tauri/crates/keepance-docx/src/lib.rs`.

- [ ] **Step 1: Failing tests first.** In `text.rs`'s `#[cfg(test)] mod tests` (the crate convention — read `scrub.rs` for the test style), against the REAL fixtures (`concat!(env!("CARGO_MANIFEST_DIR"), "/../../../tests/fixtures/matter-corpus/...")` — verify the relative depth from the crate dir; the crate's own `tests/campaign_fixtures.rs` already resolves this corpus, copy its path helper):
  - `contract-services-agreement.docx` → extracted paragraphs contain `"blended hourly rate of $375 per hour"` and `"the laws of the State of New York"`.
  - `engagement-letter-tracked.docx` → the CURRENT READING: contains `"[INSERTED BY MARCHETTI] Additionally, we will provide monthly status updates."` (tracked insertion KEPT) and does NOT contain `"[TO BE REMOVED: placeholder text from template]"` (tracked deletion EXCLUDED). (Strings probed verbatim from the fixture — corrections table.)
  - A synthetic `Document` built with `Paragraph::from_inlines` covering: plain runs concatenate; comment markers contribute nothing; an `Inline::Raw` hyperlink's `<w:t>` text IS recovered; empty paragraphs are dropped.
  - A `BlockContent::Raw` table block (`<w:tbl>…<w:t>Cell text</w:t>…`) → `"Cell text"` recovered; a Raw block containing `<w:del><w:r><w:delText>gone</w:delText></w:r></w:del>` → `"gone"` NOT recovered; no raw XML markup ever appears in the output.

- [ ] **Step 2: Implement `text.rs`:**

```rust
//! VG-2b — plain-text extraction from the parsed Document tree, for the
//! semantic index. Produces the document's CURRENT READING: tracked
//! insertions included, tracked deletions excluded (the same semantics as
//! resolve_all(Accept), without mutating). Comments are not included.
//! Unmodeled Raw blocks/inlines (tables, hyperlinks, sdt, …) contribute
//! their visible `<w:t>` text via a guarded XML walk — raw markup must
//! never leak into the search index.

use crate::model::{BlockContent, Document, Inline, Run};

/// One trimmed plain-text string per non-empty paragraph/table-block,
/// in document order.
pub fn extract_paragraph_texts(doc: &Document) -> Vec<String> {
    let mut out = Vec::new();
    for block in &doc.body {
        let text = match block {
            BlockContent::Paragraph(p) => paragraph_text(p),
            // Tables (and other unmodeled blocks) arrive as Raw — recover
            // their visible text so contracts with tabular clauses index.
            BlockContent::Raw { xml } => raw_visible_text(xml),
        };
        let t = text.trim().to_string();
        if !t.is_empty() {
            out.push(t);
        }
    }
    out
}

fn runs_text(runs: &[Run], s: &mut String) {
    for r in runs {
        s.push_str(&r.text);
    }
}

fn paragraph_text(p: &crate::model::Paragraph) -> String {
    let mut s = String::new();
    for inline in &p.inlines {
        match inline {
            Inline::Run(r) => s.push_str(&r.text),
            Inline::Insertion { runs, .. } => runs_text(runs, &mut s),
            Inline::Deletion { .. } => {} // deleted text is not the current reading
            Inline::Raw { xml } => s.push_str(&raw_visible_text(xml)),
            _ => {} // comment markers carry no text
        }
    }
    s
}

/// Visible text inside an unmodeled XML fragment: the character content of
/// `<w:t>` elements, EXCLUDING anything inside `<w:del>` (deleted text) —
/// `<w:delText>` is a distinct element and is skipped by construction.
fn raw_visible_text(xml: &str) -> String { /* quick-xml Reader event walk:
    track depth-inside-`w:del`; collect Event::Text only while the open
    element stack top is `w:t` and del-depth == 0; join runs with a space
    between block-level boundaries (`w:p`, `w:tr` ends). ~40 lines. */ }
```

Write `raw_visible_text` for real with `quick_xml::Reader` (the crate already depends on it; mirror `parse.rs`'s reader configuration). Add `pub mod text;` to `lib.rs` and re-export `extract_paragraph_texts`.

- [ ] **Step 3: Run + commit**

```bash
cd ~/keepance/src-tauri && cargo test -p keepance-docx 2>&1 | tail -5
git add crates/keepance-docx/src/text.rs crates/keepance-docx/src/lib.rs
git commit -m "feat(docx): VG-2b plain-text extraction from the OOXML tree (revision-aware, table text recovered, no raw markup leakage)"
```

---

### Task 2: VG-2b (part 2) — xlsx/pptx/rtf extraction in the host crate

**Decision (locked here):** hand-rolled with `zip` + `quick-xml` at the SAME versions keepance-docx already pins (`zip = "4"`, `quick-xml = "0.38"` — zero new lockfile entries), not calamine (new dependency tree, divergent zip version). This matches the in-house OOXML philosophy ("only generic XML/ZIP/serde crates").

**Files:** create `src-tauri/src/commands/rag/office.rs`; modify `src-tauri/Cargo.toml` (add the two deps with a comment pointing at keepance-docx's pins).

- [ ] **Step 1: Failing tests first** (in `office.rs`'s tests module, against the real fixtures):
  - `extract_xlsx_sections(damages-model.xlsx)` → ≥1 section; section 0 label contains the sheet name; its text contains `"Punitive damages (if awarded)"` (fixture row, `generate-fixtures.py:745`) and the numeric `500000` cached value; formula cells with EMPTY cached values (`<f>SUM(B2:B7)</f><v></v>`, the F-506 fixture shape) contribute nothing (no `"SUM("` in the output — formulas are not search text).
  - `extract_xlsx_sections(matter-b-acme/acme-damages-summary.xlsx)` → non-empty (second real fixture).
  - `extract_pptx_sections(exhibit-deck.pptx)` → exactly 2 sections in slide order; section 2's text contains `"Key Events Timeline"` (fixture, `generate-fixtures.py:769`).
  - `extract_rtf_text` over an inline minimal RTF byte string (`{\rtf1\ansi{\fonttbl{\f0 Arial;}}\f0 First line.\par Second {\b bold} line.\par}`) → `"First line.\nSecond bold line."` (font table skipped, `\par` → newline, control words dropped); a `\'e9` escape decodes to `é`; an unknown `{\*\destination …}` group is skipped whole.
  - Zero-byte input (`empty.docx`-class) → `Err`, never a panic.

- [ ] **Step 2: Implement.** API shape (used by Task 3):

```rust
/// One indexable section of a sectioned office document: a worksheet or a
/// slide. `number` is 1-based (sheet/slide number) for citation labels.
pub struct OfficeSection {
    pub number: u32,
    pub label: String, // sheet name / "Slide N"
    pub text: String,
}

pub fn extract_xlsx_sections(bytes: &[u8]) -> anyhow::Result<Vec<OfficeSection>>;
pub fn extract_pptx_sections(bytes: &[u8]) -> anyhow::Result<Vec<OfficeSection>>;
pub fn extract_rtf_text(bytes: &[u8]) -> anyhow::Result<String>;
```

Implementation notes (decided):
- **xlsx:** read `xl/workbook.xml` for sheet order + names and `xl/_rels/workbook.xml.rels` for r:id → worksheet part; fall back to lexically-sorted `xl/worksheets/sheet*.xml` when either part is missing. Load `xl/sharedStrings.xml` (`<si>` → concatenated `<t>` including rich-run `<r><t>`). Per row: resolve each `<c>` by its `t` attribute (`s` = shared index, `inlineStr` = `<is><t>`, `str` or absent = the `<v>` literal); skip cells with no `<v>` content. Row line = cell values joined `" | "`; sheet text = lines joined `"\n"`. Defensive cap: stop a sheet at 50,000 cells (log + truncate honestly).
- **pptx:** iterate `ppt/slides/slide<N>.xml` sorted numerically by N; collect `<a:t>` character content; close of `</a:p>` emits a newline.
- **rtf:** group-depth tracker over the byte stream: skip known destination groups whole (`\fonttbl`, `\colortbl`, `\stylesheet`, `\info`, `\pict`, and any `{\*…}`), map `\par`/`\line` → `\n`, `\tab` → tab, `\'hh` → cp1252 byte, `\uN` → char (consuming the fallback char), drop all other control words, pass plain characters through.

- [ ] **Step 3: Run + commit**

```bash
cd ~/keepance/src-tauri && cargo test --lib office 2>&1 | tail -5
git add Cargo.toml Cargo.lock src/commands/rag/office.rs
git commit -m "feat(rag): VG-2b office extractors in Rust — xlsx/pptx sections + rtf text via zip + quick-xml (no new dependency tree)"
```

---

### Task 3: VG-2b (part 3) — office documents join the index; typed source labels; leg-1 office citations

**Verified wiring (why Rust-side covers everything):** the initial walk is `rag_index_workspace` (Rust, filters on `extractor::is_indexable`), and the watcher path is Rust `watcher.rs` → `workspace-file-changed` → `useMemoryWiring.ts:283-297` → `MemoryService.indexFile` → `rag_index_file` (which silently no-ops on non-indexable, `mod.rs:269-273`). Making the extensions indexable Rust-side therefore lights up BOTH paths with no TS routing change.

**Files:** `src-tauri/src/commands/rag/extractor.rs`, `mod.rs`, `store.rs`, `pdf_indexer.rs`, `src/utils/tauri-commands.ts`, `src/modules/workflow/legalAnalysis.ts`, `src/components/ai/AIChatViewer.tsx`, `src-tauri/tests/rag_deposition_contradictions.rs`.

- [ ] **Step 1 (Rust, failing tests):** in `extractor.rs` tests: flip `document_formats_skipped_in_m1` (`extractor.rs:104-111`) to assert docx/xlsx/pptx/rtf ARE indexable and rename it `office_formats_are_indexable`; add: `~$contract.docx` (Word lock file) is NOT indexable; `.pdf` stays not-indexable (TS path). In `store.rs` tests: `build_batch` with the new SourceType variants writes the expected `source_type`/`page_number` values.

- [ ] **Step 2 (extractor.rs):**

```rust
/// VG-2b — office formats the Rust indexer extracts natively (docx via the
/// keepance-docx tree walk; xlsx/pptx/rtf via office.rs). The M1 "text
/// formats only" scope decision is closed by the vision gap closure plan.
pub const OFFICE_EXTENSIONS: &[&str] = &["docx", "xlsx", "pptx", "rtf"];

pub enum IndexKind { Text, Docx, Xlsx, Pptx, Rtf }
pub fn classify(path: &Path) -> Option<IndexKind> { /* extension match over
    TEXT_EXTENSIONS / OFFICE_EXTENSIONS; None otherwise. A basename starting
    with "~$" (a Word/Excel/PowerPoint lock file) is ALWAYS None — lock files
    are transient junk that would churn the watcher. */ }
```

`is_indexable` becomes `classify(path).is_some()` (delete the duplicated logic, keep the public name — call sites at `mod.rs:269` and the walk filter `mod.rs:469` compile unchanged). Update the stale module header (`:1-11`) and remove `_DOCUMENT_EXTENSIONS_TODO` (`:28-31`). Add `read_bytes(path) -> Option<Vec<u8>>` with its own cap (`MAX_OFFICE_FILE_BYTES: u64 = 50 * 1024 * 1024` — office packages carry media; the text parts stay small).

- [ ] **Step 3 (store.rs SourceType + mod.rs dispatch):** extend the enum (`store.rs:76-83`):

```rust
pub enum SourceType {
    Text,
    Pdf { page_number: u32 },
    Mail,
    // VG-2b — office documents. Word-processing formats chunk like text
    // (page_number 0); sectioned formats band like PDF pages so citations
    // can say "sheet 2" / "slide 3".
    Docx,
    Rtf,
    Xlsx { sheet_number: u32 },
    Pptx { slide_number: u32 },
}
```

Map them in `build_batch`'s match (`store.rs:370-377`): `("docx", 0)`, `("rtf", 0)`, `("xlsx", sheet)`, `("pptx", slide)`. In `mod.rs`, rework `index_one_file` (`:328-367`) into a `classify` dispatch:
- `Text` → existing path unchanged.
- `Docx`/`Rtf` → `extractor::read_bytes` → `keepance_docx::text::extract_paragraph_texts(&parse_docx_bytes(..)?)` joined with `"\n\n"` (rtf: `office::extract_rtf_text`) → existing `chunk_text` → upsert with the new SourceType. Extraction `Err` (corrupt file, zero-byte `empty.docx`) → `store::delete_path` + `log::warn!` + `Ok(())` — mirror the `read_text` None arm (`:337-341`); a bad office file must never abort the walk.
- `Xlsx`/`Pptx` → `office::extract_*_sections` → per-section banding. Generalize `pdf_indexer.rs`'s grouped insert (single up-front delete `:119-125`, per-group `build_batch`, one `table.add`, `:127-156`) into a shared helper `store::upsert_grouped(table, path, groups: Vec<(SourceType, Vec<(Chunk, Vec<f32>)>)>, matter, privilege, key)`; `pdf_indexer` routes through it (behavior identical — keep its tests green untouched); xlsx/pptx build groups with `paragraph_index = section_idx * pdf_indexer::MAX_CHUNKS_PER_PAGE + sub_idx` (reuse the banding constant — same "no section produces 100 chunks" argument). Embedding goes through `embed_documents_batched` with the SAME cancel pass-through `index_one_file` already has (F-501 discipline).

- [ ] **Step 4 (TS labels):** widen `RagHit.sourceType` (`tauri-commands.ts:113`) to `'text' | 'pdf' | 'mail' | 'docx' | 'xlsx' | 'pptx' | 'rtf'` and `RetrievedChunk.sourceType` (`legalAnalysis.ts:39`) to match. Label work:
  - `legalAnalysis.ts sourceLocator` (`:163-172`): add `xlsx` → `` `${base} sheet ${pageNumber}` ``, `pptx` → `` `${base} slide ${pageNumber}` `` (docx/rtf fall through to the existing paragraph branch).
  - `AIChatViewer.tsx` chip label (`:309`) + accordion row label (`:450`): when the matched source's `sourceType` is `'pdf'` render `` `${basename} p. ${pageNumber}` `` (this closes the follow-up (f) nit "the PDF chip label says paragraph for page-keyed sources"), `'xlsx'` → `sheet N`, `'pptx'` → `slide N`; default stays `§{paragraphIndex}`. The chip's RESOLUTION key (`chat-citation-{basename}-{paragraphIndex}` testid, exact path+paragraph match `:320`) is untouched — labels only, never the verify/click machinery. Grep `tests/` for assertions on the old `§` labels for pdf sources and update them.

- [ ] **Step 5 (leg-1 corpus extension — extend, don't retune):** in `rag_deposition_contradictions.rs`:
  - Delete the stale "Corpus note" header lines (`:28-31`).
  - Teach the loader office files: give `Source` an extraction discriminant or branch on extension in `fixture()` (`:108-134`): `.docx` members load via `keepance_lib`'s office path (`keepance_docx::text::extract_paragraph_texts` + join, exactly like production) instead of `read_to_string`. Add corpus members: `contract-services-agreement.docx` under `MATTER_JOHNSON` (source_id `/matter-corpus/contract-services-agreement.docx`) and `matter-b-acme/intake-memo-acme.docx` under `MATTER_ACME_B`.
  - New test `office_docx_clause_retrieves_and_verifies`: `assert_cited_passage(&f, "what hourly rate does the services agreement set for the firm's work", MATTER_JOHNSON, "/matter-corpus/contract-services-agreement.docx", "blended hourly rate of $375 per hour")` — retrieval + source + content-addressed id + **verifying citation** over office-extracted content, end to end.
  - New test `acme_intake_memo_never_leaks_into_johnson_scope`: the contract-rate query scoped to `MATTER_JOHNSON` never returns the intake memo's source_id; and extend the existing Acme-scope leak loop's query list with `"what supply shipments did Road Runner fail to deliver"` scoped to MATTER_JOHNSON expecting zero Acme sources (the existing forbidden-token loop keeps running unchanged over the BIGGER corpus — that is the extension; its needles and the FINDER_QUERY test stay byte-identical, rule 3).

- [ ] **Step 6: Run + commit**

```bash
cd ~/keepance/src-tauri && cargo test --lib 2>&1 | tail -5
cargo test --test rag_deposition_contradictions 2>&1 | tail -8   # needs the e5-small cache (present on this rig)
cd ~/keepance && npx tsc --noEmit
git add src-tauri/src/commands/rag src-tauri/tests/rag_deposition_contradictions.rs src/utils/tauri-commands.ts src/modules/workflow/legalAnalysis.ts src/components/ai/AIChatViewer.tsx
git commit -m "feat(rag): VG-2b office documents join the semantic index — walk + watcher, typed citation labels, leg-1 cited-office proof"
```

If the ORIGINAL finder-feed test goes red here (office chunks diluting topK 12): that is a real product finding — record it in the task notes for Task 4 (whose diversity cap is the fix) and re-run it at Task 4's end; do NOT touch the test.

---

### Task 4: F-510 — per-source diversity cap in finder retrieval

**Diagnosis (verified, RESULTS §E F-510):** with huge-notes.md (1,659 chunks of litigation-notes filler) indexed, the finder's single broad query at topK 12 fed a diluted context (attempt 1 anchored all four findings on huge-notes content) and the planted rubric went 0/5 twice. Leg 1's truth was established with huge-notes EXCLUDED. The deposition chunks WERE in the feed (17 of 28 sides grounded) — selection precision, not absence. Fix: a per-source cap applied at retrieval for the finder's feed; chat retrieval unchanged.

**Design (locked here):**
- The cap lives RUST-side as an optional `rag_retrieve` parameter, so leg 1 can prove it with the exact production function and no cross-language reimplementation. `None` (and every existing caller) = behavior unchanged.
- When `Some(cap)`: overfetch `top_k * 4` from `store::nearest`, then apply a pure `cap_per_source` in score order, truncate to `top_k`.
- Only the finder passes a cap (`AnalyzeStepConfig.perSourceCap`, template value 4). The matter-scope half of F-510's directions is already the engine's design (`analyzeDeps.getScope()` passes the ACTIVE matter; the leg-3 gap was a workspace with no matters configured — the Task 14 re-run configures matters to exercise it). The source-type filter direction is deliberately deferred (rule 9).

**Files:** `src-tauri/src/commands/rag/mod.rs`, `src/utils/tauri-commands.ts`, `src/modules/memory/MemoryService.ts`, `src/modules/workflow/legalAnalysis.ts`, `src/types/workflow.ts`, `src/modules/workflow/templates/legal/DepositionContradictionFinder.ts`, `src/App.tsx`, `src-tauri/tests/rag_deposition_contradictions.rs`.

- [ ] **Step 1 (Rust, failing unit tests first)** in `mod.rs`'s tests module:

```rust
fn mini_hit(source: &str, score: f32) -> Hit { /* path/source_id = source, rest minimal */ }

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
```

- [ ] **Step 2 (Rust, implement).** Pure helper near `rag_retrieve`:

```rust
/// F-510 — per-source diversity cap. A single large low-signal file can
/// dominate a broad retrieval feed (huge-notes.md fed all four of finder
/// attempt 1's findings; rubric 0/5). Keep hits in descending-score order,
/// admit at most `cap` per source (source_id, falling back to path), stop
/// at `top_k`. `cap == 0` means "no cap" so a default-constructed call can
/// never silently empty the feed.
fn cap_per_source(hits: Vec<Hit>, cap: usize, top_k: usize) -> Vec<Hit> { … }
```

`rag_retrieve` (`mod.rs:571-578`) gains `per_source_cap: Option<u32>` (serde camelCase `perSourceCap`; absent = None — existing invoke sites need no change). When `Some(cap > 0)`: call `store::nearest` with `top_k * 4` (cap the overfetch at 200 defensively), then `cap_per_source(hits, cap, top_k)` AFTER the existing decrypt/sort. Doc-comment the privilege/matter prefilter is untouched (the cap runs over already-scoped hits — it can only narrow, never widen; this is why it cannot weaken isolation).

- [ ] **Step 3 (TS plumb):** `ragRetrieve` (`tauri-commands.ts:309-319`) gains optional `perSourceCap?: number` passed in the invoke payload. `MemoryService.retrieve` (`MemoryService.ts:284-293`) gains the same optional last arg. `RetrieveFn` (`legalAnalysis.ts:46-50`) gains optional `perSourceCap`; `runContradictionAnalysis` passes `config.perSourceCap` into `retrieve(retrievalQuery, topK, scope, config.perSourceCap)` (`:306`). `AnalyzeStepConfig` (`types/workflow.ts:104+`) gains:

```ts
  /** F-510 — max retrieved chunks admitted per source document. Keeps one
   *  large low-signal file from drowning the feed. Omitted = no cap. */
  perSourceCap?: number;
```

`DepositionContradictionFinder.ts` config gains `perSourceCap: 4,` (next to `topK: 12`, `:128`). `App.tsx` `analyzeDeps.retrieve` (`:2590`) forwards the new arg into `MemoryService.retrieve` and records it in the `retrieval_executed` audit payload. Extend an existing legalAnalysis unit test (`tests/unit/legal-analysis-grounding.test.ts`) asserting the mock `retrieve` receives `4` from a config carrying `perSourceCap: 4`.

- [ ] **Step 4 (leg-1 filler proof — the F-510 re-proof RESULTS asks for).** In `rag_deposition_contradictions.rs`, a SECOND `OnceCell` fixture `fixture_with_filler()` (own tempdir): the Task 3 corpus PLUS `huge-notes.md` loaded under `MATTER_JOHNSON` (worst case: in-scope dilution; ~1,659 chunks embed, so the tests are `#[ignore]`d like `rag_embed_memory.rs` and run explicitly in Task 14):
  - `#[ignore] f510_raw_finder_feed_composition_with_filler_is_recorded`: run `FINDER_QUERY` at raw `nearest(.., 12, ..)`; PRINT the per-source composition (`--nocapture`); assert nothing — this is the honest observation of the dilution, not a gate.
  - `#[ignore] f510_capped_finder_feed_contains_both_sides_of_all_three`: mirror the production cap exactly — `nearest(.., 48, ..)` then the production `cap_per_source` (make it `pub(crate)` or expose via a test-visible path) with cap 4 → truncate 12 → assert the SAME six needles as the original finder-feed test (reuse its needle list verbatim) plus the scope-hygiene loop. This is the gate: with the cap, the planted sides survive the filler.
- Re-run the ORIGINAL (non-ignored) finder-feed test — still green, untouched (rule 3).

- [ ] **Step 5: Run + commit**

```bash
cd ~/keepance/src-tauri && cargo test --lib 2>&1 | tail -4
cargo test --test rag_deposition_contradictions 2>&1 | tail -6
cd ~/keepance && npx vitest run tests/unit/legal-analysis-grounding.test.ts 2>&1 | tail -4 && npx tsc --noEmit
git add src-tauri/src/commands/rag/mod.rs src-tauri/tests/rag_deposition_contradictions.rs src/utils/tauri-commands.ts src/modules/memory/MemoryService.ts src/modules/workflow/legalAnalysis.ts src/types/workflow.ts src/modules/workflow/templates/legal/DepositionContradictionFinder.ts src/App.tsx tests/unit/legal-analysis-grounding.test.ts
git commit -m "feat(finder): F-510 per-source diversity cap — the finder feed survives a large low-signal file; leg-1 capped-feed proof added"
```

---

### Task 5: Rust verifier normalization — case + curly quotes, direction-safe

**Diagnosis (verified):** `text_contains_normalized` (`mod.rs:783-790`) collapses whitespace only; the TS grounding side (`legalAnalysis.ts normalizeQuote`, `:182-189`) also lowercases and straightens curly quotes. Re-run attempt 2 stranded 14 statement-sides at `textMismatch` on exactly that drift. Align the Rust side with the TS canonicalization. **This must not weaken what verification asserts** (rule 1): the transform is applied identically to both haystack and needle; containment direction and the empty-quote refusal are unchanged; a misquote that differs in CONTENT still fails.

**Files:** `src-tauri/src/commands/rag/mod.rs`, `src-tauri/tests/rag_deposition_contradictions.rs`.

- [ ] **Step 1 (failing tests):** extend `text_contains_normalized_matches_across_whitespace` (`mod.rs:1270-1279`) with a sibling test:

```rust
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
    // Empty/whitespace quote still refuses.
    assert!(!text_contains_normalized(stored, " \u{201C}\u{201D} "));
}
```

(The last case matters: a quote that normalizes to only straightened quote characters must still be non-empty to verify — quote characters are content, only the empty string refuses. Adjust the assertion to the chosen semantics and document it: we do NOT strip quote characters, we canonicalize them.)

- [ ] **Step 2 (implement):** replace the closure in `text_contains_normalized` (`:783-790`):

```rust
/// Canonicalized containment for citation verification. The SAME transform
/// is applied to both sides (direction-safe): Unicode-lowercase, curly
/// quotes straightened (\u{2018}\u{2019} -> ' ; \u{201C}\u{201D} -> "),
/// whitespace runs collapsed. Mirrors the TS grounding normalization
/// (legalAnalysis.ts normalizeQuote) so a quote that grounds also verifies.
/// NOT fuzzy: no other characters are altered or removed; containment
/// direction is unchanged; an empty normalized quote never verifies.
fn text_contains_normalized(stored: &str, quoted: &str) -> bool {
    fn canon(s: &str) -> String {
        let lowered = s.to_lowercase();
        let straightened: String = lowered
            .chars()
            .map(|c| match c {
                '\u{2018}' | '\u{2019}' => '\'',
                '\u{201C}' | '\u{201D}' => '"',
                other => other,
            })
            .collect();
        straightened.split_whitespace().collect::<Vec<_>>().join(" ")
    }
    let q = canon(quoted);
    if q.is_empty() {
        return false;
    }
    canon(stored).contains(&q)
}
```

- [ ] **Step 3 (mirror):** update the leg-1 `verify()` helper's normalize closure (`rag_deposition_contradictions.rs:152`) to the identical canon (it documents itself as a mirror of the production verdict logic — keep that true; also check `rag_matter_scope.rs` for the same helper pattern and update it too if present: `grep -rn "split_whitespace" src-tauri/tests/`).

- [ ] **Step 4: Run + commit**

```bash
cd ~/keepance/src-tauri && cargo test --lib text_contains 2>&1 | tail -4
cargo test --test rag_deposition_contradictions 2>&1 | tail -4
git add src-tauri/src/commands/rag/mod.rs src-tauri/tests/
git commit -m "fix(rag): verifier normalization aligned with the TS side (case + curly quotes), symmetric and direction-safe — drifted verbatim quotes verify, misquotes still fail"
```

---

### Task 6: VG-2 OCR spike — engine decision (SHORT, timeboxed)

**Question to settle:** Tesseract **sidecar** (roadmap WS-B preference: fast, proven, ~20 MB/platform with eng traineddata) vs **tesseract-wasm** in the renderer (slower, zero packaging risk). The repo already ships a sidecar end to end (`piper`: `tauri.conf.json:81-83`, `scripts/fetch-piper-sidecar.sh`, per-target CI download `release.yml:146-158`, resolver `tts.rs:49`) — packaging is NOT novel here; the open question is **binary acquisition**: piper publishes static single-file releases per platform; Tesseract does not officially.

- [ ] **Step 1: Probe, timeboxed (do not gold-plate).**
  - Linux invocation truth: `sudo apt-get install -y tesseract-ocr` on this rig (candidate 5.3.4); verify the headless pipe contract on a synthetic image: `tesseract <png> stdout --psm 3 tsv` → TSV rows carrying `conf` per word + reconstructable text. Record exact flags + mean-confidence math.
  - Static-binary sources for the three ship targets (x86_64 Linux, x86_64 Windows, aarch64+x86_64 macOS): check (a) AppImage releases (extractable), (b) UB-Mannheim Windows builds (portable extraction), (c) conda-forge / vcpkg static artifacts, (d) building static in CI (leptonica + tesseract — heavy; estimate honestly). ~15 min of WebSearch + release-page reading, not a build attempt.
  - tesseract-wasm fallback sanity: confirm the `tesseract-wasm` npm package (robertknight) API (`OCRClient`, image bitmap in, text + word confidences out), its wasm + traineddata sizes, and that it runs in a plain browser context (our renderer has real `Worker` + canvas — `pdf-extract.ts:38-45`).
- [ ] **Step 2: Decide + record** in `spikes/ocr-engine/DECISION.md`: the decision rule is **"sidecar IF a maintainable per-target binary source exists for all three platforms; ELSE wasm"** — with the evidence, the chosen invocation contract, and the consequence either way: Task 7 implements behind ONE seam (`src/modules/ocr/ocrEngine.ts` exporting `ocrPageImage(png: Uint8Array): Promise<{ text: string; confidence: number }>`), so a later engine swap never touches the pipeline. Note the licensing line (Tesseract is Apache-2.0 — compatible). NO cloud OCR is ever a candidate (rule 2).
- [ ] **Step 3: Commit**

```bash
cd ~/keepance && git add spikes/ocr-engine/DECISION.md && git commit -m "docs(spike): VG-2 OCR engine decision recorded with invocation + acquisition evidence"
```

---

### Task 7: VG-2 — the OCR engine behind `ocrPageImage`

Implement EXACTLY what `spikes/ocr-engine/DECISION.md` chose. Both shapes below are pre-designed so this task is mechanical either way; delete the branch not taken.

**Shape A — sidecar (mirror piper end to end):**
- `src-tauri/src/commands/ocr.rs`: `resolve_tesseract_binary(app)` mirroring `tts.rs resolve_piper_binary` (`:49-80`: resource_dir/binaries in release, `binaries/tesseract-<target-triple>` in dev) + traineddata resolution (ship `eng.traineddata` under `resources/ocr/`, point `TESSDATA_PREFIX` at it); command `ocr_page_png(png_base64: String) -> Result<OcrPageResult, String>` where `OcrPageResult { text: String, mean_confidence: f32 }` — write the PNG to a temp file, run `tesseract <tmp> stdout --psm 3 tsv` (the spike's verified flags), parse TSV (text from word rows in reading order; mean of `conf >= 0` values), clean the temp file on every path. Register the command in `lib.rs` next to the existing rag/tts registrations (grep `rag_retrieve` in `lib.rs` for the invoke_handler list).
- `scripts/fetch-tesseract-sidecar.sh` cloned from `fetch-piper-sidecar.sh` using the spike's per-target acquisition sources; run it for Linux so dev works; extend `.github/workflows/release.yml` with the per-target fetch step next to piper's (`:146-158`) and `tauri.conf.json externalBin` gains `"binaries/tesseract"`; bundle `resources/ocr/eng.traineddata`.
- `src/modules/ocr/ocrEngine.ts`: `ocrPageImage` = base64 + `invoke('ocr_page_png', …)`; throws a typed `OcrUnavailableError` outside Tauri or when the binary is missing (callers surface honestly, Task 8).
- Tests: Rust unit test for the TSV parse (fixture TSV string → text + mean conf); an `#[ignore]` integration test that OCRs a generated test PNG when the binary resolves (skips with a message otherwise).

**Shape B — tesseract-wasm:**
- `npm i tesseract-wasm`; vendor the `.wasm` + `eng.traineddata` into `public/ocr/` via the prebuild step (mirror how `pdf.worker.min.mjs` gets there — grep `prebuild` in `package.json`); NO network fetch at runtime, ever (rule 2 + the Option B precedent: assets ship or download visibly, never silently).
- `src/modules/ocr/ocrEngine.ts`: lazy-init a module-level `OCRClient` worker on first call, `loadModel('/ocr/eng.traineddata')`; `ocrPageImage` converts PNG bytes → `ImageBitmap` → `loadImage` → `getText()` + word confidences → `{ text, confidence }`; a `destroyOcrClient()` for teardown after a batch.
- Tests: vitest unit with the client mocked (init-once semantics, confidence math); real-OCR proof rides Task 8's pipeline test + the Task 14 native run.

- [ ] **Step 1:** implement the chosen shape (TDD on the parse/confidence math).
- [ ] **Step 2:** run + commit

```bash
cd ~/keepance/src-tauri && cargo test --lib 2>&1 | tail -4   # shape A
cd ~/keepance && npx tsc --noEmit && npx vitest run tests/unit/ocr 2>&1 | tail -4
git add -A src-tauri src/modules/ocr scripts .github package.json package-lock.json public
git commit -m "feat(ocr): VG-2 local OCR engine behind ocrPageImage (per spike decision; nothing leaves the machine)"
```

---

### Task 8: VG-2 — the OCR pipeline: scanned pages become searchable, honestly

**The replace site (verified):** `MemoryService.ts:324-326` returns `reason: 'scanned'` and drops the file. Per the strategy: OCR text feeds the SAME chunk/index path with an ocr flag on chunks, page citations preserved, low confidence marked, data map line, honest progress.

**Files:** `src/lib/pdf-extract.ts`, `src/modules/memory/MemoryService.ts`, `src/modules/memory/ocrProgressStore.ts` (create), the rag progress banner component (grep `rag-progress-banner` testid), `src-tauri/src/commands/rag/{store.rs,pdf_indexer.rs,mod.rs}`, `src/utils/tauri-commands.ts`, `src/components/ai/AIChatViewer.tsx`, `src/components/privacy/DataMapDialog.tsx`, `src/settings/schema.ts`, `tests/fixtures/matter-corpus/generators/generate-fixtures.py`, locales.

- [ ] **Step 1: Scanned fixtures (real, generated).** Extend `generate-fixtures.py` (mirror its skip-gracefully-on-missing-dep pattern, `:728-732`) with a PIL-based section (check `python3 -c "import PIL"`; document `pip3 install pillow` in the script header):
  - `scanned-filing-stamped.pdf` — 2 pages: a motion-style filing text rendered onto a white image (clean, 200 dpi) with a "FILED — CLERK OF COURT" stamp box overlay; saved as an IMAGE-ONLY PDF (`Image.save(..., format='PDF')` multi-page). Body must contain a unique quotable sentence, e.g. `"Defendant's motion to compel production of the September audit file is DENIED."` — write the exact sentence into the script as a constant so tests cite it.
  - `scanned-fax-noisy.pdf` — 1 page: smaller text, salt-and-pepper noise + slight rotate (2-3°) + a fax header line — engineered to land BELOW the confidence threshold.
  - Regenerate; commit the two PDFs. `extractPdfText` over them must report `scanned: true` (they are image-only) — add that assertion to the pipeline test below.
- [ ] **Step 2: Page rendering for OCR.** In `pdf-extract.ts` add `renderPdfPageToPng(bytes, pageIndex, scale = 2): Promise<Uint8Array>` using the already-loaded pdfjs document (`page.render({ canvasContext, viewport })` on an `OffscreenCanvas`/canvas → PNG blob → bytes; reuse `ensureWorkerConfigured`). Per-page scanned-ness: export `pageNeedsOcr(pageText: string): boolean` (`pageText.trim().length < 25` — a PER-PAGE threshold so mixed native/scanned filings OCR only the scanned pages; keep `SCANNED_THRESHOLD` for the whole-file flag untouched).
- [ ] **Step 3: Storage columns + command (Rust).** `store.rs build_schema` (`:220-260`) gains two trailing nullable columns: `extraction` (Utf8 — `"ocr"` on OCR-extracted chunks, null otherwise) and `extraction_confidence` (Float32 — mean word confidence 0-100, null on native chunks). `build_batch` gains `extraction: Option<(&str, f32)>` (threaded through `upsert_grouped`; Text/Mail/office callers pass `None`). **Bump `INDEX_VERSION` 7→8** with a comment line (`8: VG-2 — OCR extraction/confidence columns`) — ladder renumbered post-Task-3, see rule 8. `rag_index_pdf_chunks` (`mod.rs:853-881`) + `pdf_indexer::index_pdf_chunks` gain `page_confidences: Option<Vec<f32>>` aligned with `pages`; a page with `Some(conf)` writes its chunks with `extraction = Some(("ocr", conf))`. `Hit` (`mod.rs:58-85`) + read path (`store::nearest` + `StoredHit`) + `RagHit` gain `extraction?: 'ocr'` and `extractionConfidence?: number`. Rust unit tests: build_batch writes the columns; pdf_indexer per-page confidence mapping.
- [ ] **Step 4: The pipeline.** In `MemoryService.indexPdfFile`, replace the `:324-326` early-return: when scanned pages exist AND the `ocrScannedPdfs` setting is on (new schema.ts toggle, category near the existing PDF-indexing toggle, `defaultValue: true`, description: `"Read scanned PDFs with local OCR so they show up in search and AI answers. Runs entirely on your machine."` — no em dashes) AND the OCR engine is available: for each page where `pageNeedsOcr`, render → `ocrPageImage` → page text + confidence, updating `ocrProgressStore` (`{ path, page, totalPages }`); native pages keep their extracted text with `undefined` confidence; then ONE `ragIndexPdfChunks(path, pages, pageCount, matter, privilege, pageConfidences)` call. Engine unavailable or toggle off → the previous honest skip (`reason: 'scanned'`). Catch per-page OCR errors: log, leave that page empty, continue (never lose the native pages). The banner component (grep `rag-progress-banner`) renders the OCR line while the store is active: locale `memory.ocr-progress`: `"Reading scanned pages with local OCR: page {{page}} of {{total}}. Nothing leaves your machine."` (en + es/de + lock).
- [ ] **Step 5: Disclosure.** `OCR_LOW_CONFIDENCE = 60` (one shared const in `tauri-commands.ts` next to RagHit). AIChatViewer chip + accordion labels (the Task 3 label sites): an `extraction === 'ocr'` source appends the locale string `citation.scanned` (`"scanned"`); below the threshold appends `citation.scanned-low` (`"low-confidence scan"`), and the chip `title` carries the fuller sentence `citation.scanned-low-title`: `"This passage was read from a scanned page by local OCR with low confidence. Open the source and verify before relying on it."` `legalAnalysis.ts sourceLocator` appends `" (scanned)"`/`" (scanned, low-confidence)"` so finder deliverable locators disclose it too (propose-don't-decide extends to OCR quality). DataMapDialog `DATA_MAP_ROWS` (`:65+`) gains the OCR row (hardcoded-copy convention, emerald/local tone): title `"Scanned documents are read on your machine"`, body naming local OCR, that page images and recognized text never leave the device, and that low-confidence passages are labeled in citations.
- [ ] **Step 6: Tests.** Vitest pipeline test (`tests/unit/ocr-pipeline.test.ts`): mock `ocrPageImage` + the tauri command; a 2-page extraction result with one empty page → exactly one OCR call, `ragIndexPdfChunks` receives `pageConfidences` `[undefined, 87]`-shaped; toggle off → skip with `reason: 'scanned'`; OCR throw → native pages still index. Locale + i18n suites. The REAL end-to-end (fixture PDFs through the live engine into retrieval with a verifying citation) lands in Task 14's native run (and, if the engine is wasm, also as a playwright spec extension — decide there).
- [ ] **Step 7: Run + commit**

```bash
cd ~/keepance/src-tauri && cargo test --lib 2>&1 | tail -4
cd ~/keepance && npx vitest run tests/unit/ocr-pipeline.test.ts tests/unit/i18n 2>&1 | tail -5 && npx tsc --noEmit
git add -A src src-tauri tests/fixtures/matter-corpus src/locales
git commit -m "feat(ocr): VG-2 scanned PDFs become searchable — local OCR pipeline, per-page confidence, low-confidence disclosure in citations, data map line, honest progress"
```

---

### Task 9: VG-3c — transcript-aware ingest: citations read "Tr. 45:12"

**Scope (per the strategy):** detect the standard line-numbered deposition format at ingest and carry page:line into chunk metadata. Generic chunking remains for everything else — including the EXISTING johnson fixture, which is deliberately NOT line-numbered (`Q./A.` + `PAGE N` headers) and must keep indexing byte-identically (leg-1 depends on its chunk ids).

**Files:** create `src-tauri/src/commands/rag/transcript.rs`; modify `chunker.rs` (Chunk field), `store.rs` (locator column + V8), `mod.rs` (dispatch + Hit), `tauri-commands.ts`, `legalAnalysis.ts`, `AIChatViewer.tsx`, `generate-fixtures.py` + new fixture, locales if any.

- [ ] **Step 1: The certified fixture.** Extend `generate-fixtures.py` with `deposition-transcript-weston-certified.txt` (deterministic inline text): DEPOSITION OF THOMAS WESTON in the same Johnson v. Nexus Dynamics caption, 3-4 pages in the STANDARD certified format — every content line prefixed with its line number 1-25 (right-aligned two-digit), page boundaries as a centered `Page N` header line. Content: document-retention and litigation-hold procedure testimony (TOPICALLY NEUTRAL — it must not corroborate or contradict any of the three planted pairs, so the finder rubric dynamics stay clean). Include one uniquely quotable line at a known page:line, e.g. page 2 lines 14-16: `"The litigation hold notice went out to the cloud infrastructure team on September 12, 2025."` Record the page:line of that sentence as a python constant; commit the generated file.
- [ ] **Step 2 (failing tests):** `transcript.rs` tests: `detect_transcript` is TRUE for the certified fixture text and FALSE for the existing johnson transcript (load both real fixtures), false for incident-summary-johnson.md and a code file; `chunk_transcript` over the certified fixture yields chunks whose locators are well-formed (`^\d+:\d+-\d+:\d+$`), strictly ordered, and the litigation-hold sentence's chunk locator covers page 2 + the known line numbers; chunk text preserves the spoken words but NOT the line-number gutter (the gutter would pollute embeddings and quote verification).
- [ ] **Step 3: Implement `transcript.rs`.**

```rust
/// VG-3c — certified-transcript detection + page:line chunking.
///
/// Detection (deliberately conservative — false negatives fall back to the
/// generic chunker, which is always correct): a .txt qualifies when, over
/// the non-blank lines, at least 60% begin with a 1-25 line number
/// (^\s{0,8}(\d{1,2})\s+\S), the numbers form ascending runs that reset
/// near 25 -> 1 at least once (the page rhythm), and a page marker line
/// (^\s*(-\s*)?(Page|PAGE)\s+\d+|\f) appears at least once.
pub fn detect_transcript(text: &str) -> bool { … }

/// Chunks carry the SPOKEN text (gutter stripped) and a locator
/// "startPage:startLine-endPage:endLine". paragraph_index stays the
/// sequential chunk index (the citation/content-address contract is
/// unchanged); page:line is metadata ON TOP.
pub fn chunk_transcript(path: &str, text: &str) -> Vec<crate::commands::rag::chunker::Chunk> { … }
```

Parsing: walk lines tracking `current_page` (from page markers; default 1) and per-line numbers; strip the gutter; group consecutive testimony lines into chunks under the chunker's `TARGET_BYTES` budget, breaking preferentially at Q./A. boundaries; stamp `locator = format!("{sp}:{sl}-{ep}:{el}")`.

- [ ] **Step 4: Metadata plumbing.** `chunker.rs Chunk` gains `pub locator: Option<String>` (update the few construction sites: `chunker.rs` flush, `pdf_indexer.rs`, tests — grep `Chunk {`). `store.rs`: trailing nullable Utf8 `locator` column written from the chunk; **bump `INDEX_VERSION` 8→9** (`9: VG-3c — transcript page:line locator column`) — ladder renumbered, see rule 8. `SourceType` gains `Transcript` → `("transcript", start_page)` (derive start page from the locator's first number). `mod.rs index_one_file` Text arm: when the extension is `txt`/`text` AND `transcript::detect_transcript(&text)` → `chunk_transcript` + `SourceType::Transcript`; else the existing generic path (assert in a test that the JOHNSON fixture takes the generic path — the detection-false test from Step 2 plus an integration assertion in leg-1 that its chunk ids are unchanged… the existing c1/c2/c3 tests ARE that assertion; leave them be). `Hit`/`StoredHit`/`RagHit`/`RetrievedChunk` gain `locator?: string`.
- [ ] **Step 5: Labels.** `legalAnalysis.ts sourceLocator`: `sourceType === 'transcript' && locator` → `` `${base} Tr. ${locator}` `` (this is what flows into the finder's .docx FindingSource locators — the vision's "Tr. 45:12-46:3"). AIChatViewer chip + accordion (Task 3 sites): transcript → `` `Tr. ${locator}` `` label (basename stays in the title attr). Resolution grammar untouched (labels only).
- [ ] **Step 6: Retrieval proof.** Leg-1 (`rag_deposition_contradictions.rs`): add the certified fixture to the MAIN corpus under `MATTER_JOHNSON` loading through the PRODUCTION transcript path (call `transcript::chunk_transcript` exactly as `index_one_file` does); new test `certified_transcript_chunks_carry_page_line_locators`: query `"when did the litigation hold notice go out to the infrastructure team"` → the hit from the certified transcript has `locator` matching the known page:line and the quote VERIFIES. (Corpus grew again: re-run the untouched finder-feed test — rule 3.)
- [ ] **Step 7: Run + commit**

```bash
cd ~/keepance/src-tauri && cargo test --lib 2>&1 | tail -4 && cargo test --test rag_deposition_contradictions 2>&1 | tail -6
cd ~/keepance && npx tsc --noEmit && npx vitest run tests/unit 2>&1 | tail -4
git add -A src-tauri src tests/fixtures/matter-corpus
git commit -m "feat(rag): VG-3c transcript-aware ingest — certified line-numbered format detected, chunks carry page:line, citations read Tr. 45:12"
```

---

### Task 10: VG-6e — vector-store residual hardening: `path`/`source_id` tokenized + encrypted

**Design (locked here — the corrections table explains why straight encryption breaks the store):**
- The queryable `path` and `source_id` columns stop holding plaintext. They hold a **deterministic keyed token**: `hex(HMAC-SHA256(token_key, path))` where `token_key = HMAC-SHA256(master_key, "keepance-path-token-v1")` (domain-separated derivation from the existing vector-store master key — `crypto.rs`; add `hmac = "0.12"` next to the existing `sha2`). Determinism preserves every equality predicate (delete/upsert/retag) verbatim in shape: `path = '<token>'`.
- A new NOT-NULL `path_enc` column holds `hex(AES-256-GCM(path))` under the same master key (the exact `chunk_text` pattern) — decrypted on read so `Hit.path`/`Hit.source_id` still hand the frontend real paths for open/click-through.
- `list_indexed_mail_paths` (`store.rs:941-970`) loses its `path LIKE 'mail:%'` prefix scan (tokens kill prefixes): filter on the EXISTING `source_type = 'mail'` column instead, select `path_enc`, decrypt with the key (new `key: &[u8; 32]` parameter; the caller in `mail/mod.rs` already holds the key — grep `list_indexed_mail_paths`).
- `chunk_id` stays computed from the PLAINTEXT path (`store.rs:192-199`) — the content-addressed citation contract and every leg-1 `chunk_id` assertion are unchanged.
- `matter_id`/`privilege` stay plaintext (prefilter isolation, `store.rs:28-32`); the data map says so honestly, plus the embedding-vector residual line the strategy asks for.
- **Bump `INDEX_VERSION` 9→10** (`10: VG-6e — path/source_id tokenized + path_enc encrypted at rest`) — ladder renumbered, see rule 8; the migration re-indexes once, leaving no plaintext paths behind.

**Files:** `src-tauri/Cargo.toml` (hmac), `crypto.rs`, `store.rs`, `mod.rs`, `pdf_indexer.rs` (its own delete predicate `:120` must tokenize), `mail/mod.rs` callers, `src-tauri/tests/` (leg-1 + grep `rag_matter_scope.rs` for direct `nearest`/`source_id` assertions — they now decrypt via a tiny shared test helper), `DataMapDialog.tsx`.

- [ ] **Step 1 (failing tests):** `crypto.rs`: `path_token` is deterministic, key-dependent, 64 hex chars, and distinct for distinct paths. `store.rs`: after `upsert_chunks_for_path`, (a) `delete_path`/`retag_*_for_path` still hit the rows (round-trip through the tokenized predicate), (b) a raw scan of the batch's `path` column never contains the plaintext path bytes, (c) `path_enc` decrypts back to the plaintext path.
- [ ] **Step 2 (implement):** thread the changes through `build_batch`/`build_batch_mail` (token into `path`/`source_id` arrays, ciphertext into `path_enc`), the predicate helpers (each takes the plaintext path + `key`, computes the token internally — signatures change; fix all callers: `mod.rs`, `pdf_indexer.rs:119-125`, `mail/mod.rs`, watcher delete path), `StoredHit`/`ChunkRecord` gain `path_enc`, and the command-layer reads (`rag_retrieve` map at `mod.rs:639-677`, `rag_verify_citation` record use) decrypt `path_enc` → plaintext for `Hit.path`/`Hit.source_id` (fail-closed placeholder `"[path unavailable]"` mirroring the chunk-text pattern when the keychain is locked; legacy pre-9 rows — `path_enc` null — pass the raw column through, and the migration removes them anyway).
- [ ] **Step 3 (the raw-disk inspection assertion the strategy names):** a store test writes a chunk for `/ws/clients/very-identifiable-client-name.md`, flushes, then scans every file under the LanceDB dataset dir for the bytes `very-identifiable-client-name` → ABSENT; decrypted retrieval still returns the real path. (Grep `src-tauri/tests/` for an existing WS-VEC plaintext-scan precedent and mirror its file-walk.)
- [ ] **Step 4 (data map):** `DATA_MAP_ROWS` gains the residual row (hardcoded-copy convention, amber tone): title `"What the search index itself stores"`, body: chunk text and file paths are encrypted at rest; the matter label and privilege tag stay readable on disk because search isolation filters on them before anything is searched; embedding vectors are stored as plain numbers — they are not meaningfully reversible to your text, but they exist, and this row exists so you know that. (Wording to taste at implementation; no em dashes; match the row register at `DataMapDialog.tsx:65-110`.)
- [ ] **Step 5: Run + commit**

```bash
cd ~/keepance/src-tauri && cargo test --lib 2>&1 | tail -5 && cargo test --test rag_deposition_contradictions --test rag_matter_scope 2>&1 | tail -6
cd ~/keepance && npx tsc --noEmit
git add -A src-tauri src/components/privacy/DataMapDialog.tsx
git commit -m "feat(trust): VG-6e vector-store residual hardening — path/source_id tokenized (HMAC) + encrypted (path_enc); raw-disk scan proves no plaintext paths; data map documents the vector residual"
```

---

### Task 11: VG-6b — Assured exercised live against api.keepance.com; stale "coming soon" removed

**State (verified):** the Assured stack is real end to end in code and unit/backend tests (`backend/src/routes/assured.ts` — `/assured/infer` + `/assured/keys/*`; client `assuredInference.ts` header contract; sentinel/OpaqueBody proof `backend/test/assured-proxy.test.ts`; provisioning doc §9: "No end-to-end browser UI run of the Assured path was performed"). The live DB has ZERO orgs (corrections table) — the exercise creates the internal test org. Backend host = THIS host (`systemd: keepance-backend`, loopback :5194, DB `/home/jameson/services/keepance-firm-backend/data/keepance-firm.sqlite`).

- [ ] **Step 1: Stale-copy removal (product change, do first).**
  - `ConfidentialityModeSettings.tsx:12-13`: rewrite the header comment line to the truth (`Assured — selectable once the firm admin sets a managed key; routed through the zero-retention proxy`).
  - `src/settings/schema.ts:184`: description's last sentence becomes `"Assured routes through your firm's zero-retention proxy once your firm admin sets a managed key."`; `:190` label becomes `'Assured (firm managed key)'`.
  - `egress.ts:225-230`: rename `modeIsComingSoon` → `modeNeedsManagedKey` (semantics byte-identical); grep + update the call sites (`ConfidentialityModeSettings.tsx:111` + tests) and the `:150` ternary fallback string (`'Coming soon'` → reuse the existing `'Needs admin key'` for the only reachable case; delete the dead branch).
  - `grep -rin "coming soon" src/ tests/` — fix any remaining ASSURED mention (leave unrelated features alone). Run the settings/egress unit suites.
- [ ] **Step 2: The scripted live exercise.** Create `scripts/assured-live-exercise.sh` (set -euo pipefail; every artifact REDACTED — no tokens, no keys, last4 only; rule 4):
  1. **Env:** source `~/.local/share/jameworld/keepance-assured-test.env` (`ASSURED_TEST_EMAIL`, `ASSURED_TEST_PASSWORD`, `ASSURED_ANTHROPIC_KEY`); if missing, print creation instructions (off-repo, mode 600; the Anthropic key comes from a server-side key Jameson already holds — NEVER from this repo) and exit 1.
  2. **Org:** read-only DB peek (python sqlite3 over a /tmp copy + WAL, the probe pattern from plan-writing) for an org named `Keepance Internal Test Firm (DO NOT BILL)`; if absent, `POST 127.0.0.1:5194/admin/org` (runbook §5) with that exact name, plan `practice`, `seat_limit: 3`, the env admin email/password; capture `org_id` + `license_key` into the env file's directory (NOT the repo).
  3. **Auth + seat:** sign in and activate a seat via the firm API — read `src/modules/firm/contract.ts` `FIRM_ENDPOINTS` for the exact login/seat routes and payload shapes (the desktop client is the reference implementation; `assuredInfer: '/assured/infer'` at `contract.ts:444`). Hold `access_token` + seat token in shell vars only.
  4. **Managed key:** `POST https://api.keepance.com/assured/keys/set` `{provider: "anthropic", api_key: $ASSURED_ANTHROPIC_KEY}` → assert `key_last4` echoes; then `/assured/keys/list` shows anthropic.
  5. **Inference with sentinel:** `SENTINEL="KEEPANCE-ASSURED-SENTINEL-$(date +%s)"`; POST the provider-NATIVE Anthropic body (model = the app's own cheap default, `claude-haiku-4-5-20251001` per `ClaudeProvider.ts:180` — re-grep at execution time; one user message embedding the sentinel, `max_tokens: 64`) to `https://api.keepance.com/assured/infer` with the `assuredInference.ts` header contract (`Authorization: Bearer`, `X-Seat-Token`, `X-Provider: anthropic`, `X-Model`, `X-Stream: 0`); assert HTTP 200 + a completion. This is a real ~$0.001 call on the managed key.
  6. **Zero-retention truth:** fresh read-only DB peek: the sentinel string appears NOWHERE in any table; a usage/billing row EXISTS for the call with a `body_hash` (metadata only — the OpaqueBody design observed live); `journalctl -u keepance-backend --since "-15 min" | grep -c "$SENTINEL"` → 0.
  7. **Bank** a redacted transcript of steps 2-6 to `docs/quality/2026-06-11-wedge-proof/wave2-rerun/assured/exercise.txt`.
- [ ] **Step 3: Run it.** Execute the script for real. Expected: all assertions green on the first complete run (fix script bugs freely; any PRODUCT failure is a finding for the RESULTS addendum, not something to patch silently).
- [ ] **Step 4: The egress-indicator half (attended, on the rig).** Using the wedge harness environment (Task 14 shares it): launch the app, Settings → Firm → sign in as the test admin, confirm the managed key lists in the admin console (`firm-managed-key-list` testid, `FirmAdminConsole.tsx:759`), select **Assured** in Settings → AI (the card must now be selectable — `assuredAvailable` true), send one chat message, and screenshot: the selected Assured card, the status-bar Assured egress badge during/after the send (StatusBar `:398-404` renders it), and the answer. Bank screenshots to `wave2-rerun/assured/`. (If model-picker friction blocks the chat on this headless rig, the screenshots of mode + badge + the SCRIPTED inference together still close VG-6b's "exercised live" — record exactly what was observed; never claim more.)
- [ ] **Step 5: Verify + commit**

```bash
cd ~/keepance && npx vitest run tests/unit 2>&1 | tail -4 && npx tsc --noEmit
git add src/components/settings/ConfidentialityModeSettings.tsx src/settings/schema.ts src/modules/privacy/egress.ts src tests scripts/assured-live-exercise.sh docs/quality/2026-06-11-wedge-proof/wave2-rerun/assured
git commit -m "feat(trust): VG-6b Assured exercised live — managed key + zero-retention proxy + sentinel guard proven against api.keepance.com; stale coming-soon copy removed"
```

(Audit the staged artifacts one more time for secrets before committing — rule 4.)

---

### Task 12: VG-4c — firm letterhead: new documents and workflow deliverables start from the template

**Design (locked here):**
- One setting: `letterheadTemplatePath` (schema.ts, category `files`, type `text`, default `''`, description: `"Path to a Word document whose letterhead (headers, footers, styles) new documents and workflow deliverables start from. Pick one with the file tree's right-click menu."`).
- Picker affordance: FileTree context menu gains `"Use as letterhead template"` on `.docx` files (writes the setting; toast confirms). Read `FileTree.tsx`'s existing per-file menu items for the pattern.
- **New documents** = a straight byte copy of the template (trivially correct; headers/footers/styles/body all come along): `App.tsx handleCreateDocxAtRoot` (`:1882-1906`) reads the setting; when set and readable via `workspaceServiceRef.current.readFileBinary`, write THOSE bytes instead of `createBlankDocx()`; on read failure, toast + fall back to blank (never block creation).
- **Workflow deliverables** = post-process generated bytes through a new Rust command `docx_apply_letterhead(generated_b64, template_b64) -> b64` (match the existing `commands/docx.rs` arg conventions — grep how `docx_*` commands pass bytes). The merge, in keepance-docx (where the model lives):

```rust
/// VG-4c — re-house a generated document's content in a letterhead
/// template's package. The template contributes every package part
/// (headers, footers, styles, media, numbering) plus its body-level
/// sectPr (which is what binds headers/footers to pages); the generated
/// document contributes the content blocks. The generated document's own
/// body-level sectPr (the `docx` JS Packer always emits one — see
/// docx-io.ts createBlankDocx's comment) is dropped in favor of the
/// template's.
pub fn merge_into_template(generated: &Document, template: OpenedDocument) -> OpenedDocument {
    let mut body: Vec<BlockContent> = generated.body.iter()
        .filter(|b| !matches!(b, BlockContent::Raw { xml } if xml.contains("<w:sectPr")))
        .cloned().collect();
    if let Some(sect) = template.document.body.iter().rev()
        .find(|b| matches!(b, BlockContent::Raw { xml } if xml.contains("<w:sectPr"))) {
        body.push(sect.clone());
    }
    let mut doc = template.document.clone();
    doc.body = body;
    doc.comments = generated.comments.clone();
    template.with_document(doc)
}
```

- TS choke point: `applyLetterheadIfConfigured(bytes: Uint8Array): Promise<Uint8Array>` in `docx-io.ts` — reads the setting; outside Tauri or unset → pass-through; on command error → pass-through with a `console.warn` (a deliverable must never fail because the letterhead did). Wire it at BOTH WorkflowEngine write sites: `writeDeliverable` (`WorkflowEngine.ts:304-309`, the markdown→docx path) and the analyze step's docx write (grep `serializeContradictionsDocx` in WorkflowEngine for the exact line).

- [ ] **Step 1 (fixture):** `generate-fixtures.py` gains `letterhead-template.docx` (python-docx: a section header with `MARCHETTI & ASSOCIATES LLP — 1200 Commerce Drive, New York` + a footer page-number placeholder + an empty body paragraph). Commit the generated file.
- [ ] **Step 2 (Rust, failing test first):** keepance-docx test: `merge_into_template(parse(contract-services-agreement.docx), open(letterhead-template.docx))` → saved bytes re-parse cleanly; the package contains the template's `word/header*.xml` part; exactly ONE body-level sectPr (the template's — assert the generated one is gone by counting `<w:sectPr` in `word/document.xml`); body text contains `"blended hourly rate of $375 per hour"`. Then implement + the `docx_apply_letterhead` host command (register in `lib.rs`).
- [ ] **Step 3 (TS):** the setting, the FileTree action, the `handleCreateDocxAtRoot` branch, the `applyLetterheadIfConfigured` helper + both engine wire-ins. Unit tests: helper pass-through (no setting / not tauri / command throws) and the apply path with a mocked invoke; a FileTree test that the menu action writes the setting (mirror an existing FileTree menu test if present — grep).
- [ ] **Step 4: Manual sanity** (dev, this rig): set the fixture template via the menu, create a new Word document → it opens with the letterhead; run any generate-to-docx workflow → output carries the header (open in the app; the Task 14 native pass re-checks one of these on the real binary).
- [ ] **Step 5: Verify + commit**

```bash
cd ~/keepance/src-tauri && cargo test -p keepance-docx 2>&1 | tail -4 && cargo test --lib docx 2>&1 | tail -4
cd ~/keepance && npx vitest run tests/unit 2>&1 | tail -4 && npx tsc --noEmit
git add -A src-tauri src tests/fixtures/matter-corpus src/locales
git commit -m "feat(docx): VG-4c firm letterhead — pick a template .docx; new documents and workflow deliverables start from it (sectPr-safe package merge)"
```

---

### Task 13: VG-3d — the issue-spotter template

**Decision (locked here):** a `generate`-style template with a `.docx` deliverable — adoption level 1 from the legal pack's own doc (`templates/legal/index.ts:13-19`: "Office output (zero logic)…"). The vision calls this "mostly configuration"; the grounded `analyze`-step upgrade is a later, separate decision (out of scope, rule 9). Mirror `LegalResearchMemo.ts` structurally (interview → generate), keep the pack's rules: `@draft`-class header comment, `requiresVerification: true`, a verification banner, no-legal-advice framing in the prompt.

- [ ] **Step 1:** create `src/modules/workflow/templates/legal/IssueSpotter.ts`: id `legal-issue-spotter`, name `Issue Spotter`, interview (matterName; matterType/practice area; jurisdiction; factPattern textarea — "paste the facts as you have them"; clientObjectives; knownDeadlines optional), generate step prompting: identify the legal issues the facts raise, organized by area, each with the facts that raise it, what is missing to evaluate it, and suggested next questions; explicit rules — flag, do not conclude; missing facts are findings, not gaps to invent; an empty area is an honest answer. Output `Issue Spotter Analysis.docx`; `verificationNote` per the pack's register. Voice rules on every user-facing string (no em dashes).
- [ ] **Step 2:** register in `templates/legal/index.ts` (import + array). Grep `tests/` for the template-registry/count assertions (`grep -rn "legal-" tests/unit | grep -il template`) and extend them; if `legal-template-docx-deliverables.test.ts` snapshots template configs, add the new one.
- [ ] **Step 3: Verify + commit**

```bash
cd ~/keepance && npx vitest run tests/unit 2>&1 | tail -4 && npx tsc --noEmit
git add src/modules/workflow/templates/legal tests
git commit -m "feat(workflow): VG-3d issue-spotter template — legal pack, draft framing, verification banner, Word deliverable"
```

---

### Task 14: Wave verification — full gates, harness extension run, RESULTS §F, CHANGELOG, doc ticks

- [ ] **Step 1: Full gates**

```bash
cd ~/keepance && npx tsc --noEmit && npm run test 2>&1 | tail -6
cd ~/keepance/src-tauri && cargo test 2>&1 | tail -8
cd ~/keepance && npx playwright test tests/e2e/wedge-proof.spec.ts --project=chromium 2>&1 | tail -6
```

Expected: all green (the wedge-proof spec stayed zero-expected-fails after Wave 1; office/locator label changes must not regress it — fix forward if they do).

- [ ] **Step 2: Heavy ignored tests, once**

```bash
cd ~/keepance/src-tauri && cargo test --release --test rag_embed_memory -- --ignored --nocapture 2>&1 | tail -4
cargo test --release --test rag_deposition_contradictions -- --ignored --nocapture 2>&1 | tail -10
```

Expected: bounded-memory still green; `f510_capped_finder_feed_contains_both_sides_of_all_three` green; the raw-feed composition printout banked into the RESULTS addendum.

- [ ] **Step 3: Harness extension (leg-3-style attended pass on this rig).** Update `scripts/wedge-proof-native.sh` first: header notes (office formats + certified transcript + scanned fixtures now in scope; the indexable walk count — recompute it: 4 text + 1 certified transcript + 5 docx (incl. zero-byte empty.docx, which counts in the total and stores 0 chunks) + 2 xlsx + 1 pptx = **13**; verify against the live banner and correct the script comment to what is OBSERVED). Append a "Wave 2 extension" section to `RUNBOOK.md` with these attended items, then run them (`up` → `launch` → drive):
  1. **Office citation (VG-2b):** ask `"What hourly rate does the services agreement set?"` → grounded answer with a chip from `contract-services-agreement.docx`, `verified: true` on disk in the persisted chat, click-through opens the document.
  2. **OCR retrieval (VG-2):** with the scanned fixtures in the workspace and the OCR toggle on: the OCR progress line appears during indexing; ask about the planted motion sentence → cited hit from `scanned-filing-stamped.pdf` with the scanned disclosure; the noisy fax fixture's chunks carry the low-confidence label.
  3. **Transcript citation (VG-3c):** ask the litigation-hold question → chip labeled `Tr. <page:line>`; click-through opens the certified transcript.
  4. **Finder precision (F-510, observed):** configure a Johnson matter mapping the fixture files (so the run is matter-scoped — the leg-3 gap), run the finder once with the §A interview inputs: the run record's retrieved feed shows ≤4 chunks per source (the cap live) with both fixture documents present; rubric scored via the existing `assert` verb and recorded HONESTLY (F-507a stays a model floor — observed, not gated; the claim this wave makes is feed precision, proven in Step 2's capped-feed test + the live feed composition).
  5. **Letterhead on the real binary (VG-4c):** set the template, create a new Word doc, confirm the header renders.
  6. Bank screenshots/output to `docs/quality/2026-06-11-wedge-proof/wave2-rerun/` (the Assured artifacts from Task 11 already live in `wave2-rerun/assured/`).
- [ ] **Step 4: RESULTS §F addendum.** Append `## F. Wave 2 extension run, <date>` to `docs/quality/2026-06-11-wedge-proof/RESULTS.md`: per-item verdicts for office citations, OCR retrieval + low-confidence marking, transcript page:line citations, the capped finder feed (with the raw-vs-capped composition from Step 2), the Assured live exercise (link the redacted artifacts), the verifier-normalization re-verify (how many previously-`textMismatch` shapes now verify — cite the new unit cases), and an honest residuals list (at minimum: F-507a model floor unchanged; finder source-type filter considered-and-deferred; OCR engine decision + anything the spike left open; xlsx formula cells are not search text by design).
- [ ] **Step 5: CHANGELOG** under `## [Unreleased]`, following the existing entry style (consolidated, plain language, file lists; the one-time re-index note appears ONCE):

```markdown
### Added
- **Word, Excel, PowerPoint, and RTF files now show up in AI answers with verifiable citations.** The indexer reads them natively on your machine; citations say "sheet 2" or "slide 3" where that is the honest locator. Files: `src-tauri/crates/keepance-docx/src/text.rs`, `src-tauri/src/commands/rag/office.rs`, `src-tauri/src/commands/rag/extractor.rs`, `src-tauri/src/commands/rag/mod.rs`.
- **Scanned PDFs are no longer invisible.** Court-stamped filings, faxes, and other image-only PDFs are read with local OCR (nothing leaves your machine), join search and AI answers with page citations, and low-confidence passages say so right on the citation. One thing to know: the first index after this update rebuilds your search index once. Files: `src/modules/ocr/`, `src/lib/pdf-extract.ts`, `src/modules/memory/MemoryService.ts`, `src-tauri/src/commands/rag/pdf_indexer.rs`.
- **Deposition transcripts cite like lawyers cite.** Certified line-numbered transcripts are detected at import and citations read "Tr. 45:12-46:3" instead of a bare paragraph number. Files: `src-tauri/src/commands/rag/transcript.rs`.
- **Firm letterhead.** Right-click any Word file to make it your letterhead template; new documents and workflow deliverables start from it. Files: `src/components/workspace/FileTree.tsx`, `src-tauri/src/commands/docx.rs`.
- **Issue Spotter** joins the legal pack: paste the facts, get a draft issue analysis organized by area, with what is missing flagged rather than invented. File: `src/modules/workflow/templates/legal/IssueSpotter.ts`.

### Fixed
- **The contradiction finder's retrieval feed no longer drowns in one big file.** Retrieval admits at most a few passages per source document, so the planted record stays in the feed even next to a 2 MB notes file. Files: `src-tauri/src/commands/rag/mod.rs`, `src/modules/workflow/legalAnalysis.ts`.
- **Quotes that differ only in capitalization or curly quotes now verify** instead of being marked unverifiable; misquotes still fail. File: `src-tauri/src/commands/rag/mod.rs`.

### Changed
- **Assured mode was exercised end to end against the live backend** (managed key, zero-retention proxy, sentinel never stored), and the last "coming soon" wording is gone from the app. Files: `src/components/settings/ConfidentialityModeSettings.tsx`, `src/settings/schema.ts`.
- **The search index stores less about you at rest:** file paths inside it are now tokenized and encrypted like the text already was, and the printable Data Map documents what remains (matter labels, privilege tags, embedding vectors). Files: `src-tauri/src/commands/rag/store.rs`, `src/components/privacy/DataMapDialog.tsx`.
```

- [ ] **Step 6: Strategy doc ticks.** In `docs/strategy/2026-06-10-vision-gap-closure-plan.md`, add STATUS lines (matching the existing STATUS style) to VG-2, VG-2b, VG-3 (c and d now done), VG-4 (c done; b remains open as the written evaluation), VG-6 (b and e done; c SSO and d-v2 vault stay Wave 3), each referencing this plan + the §F artifacts.
- [ ] **Step 7: Commit + push**

```bash
cd ~/keepance && git add CHANGELOG.md docs scripts/wedge-proof-native.sh
git commit -m "docs: Wave 2 verified — gates green, harness extension run banked, RESULTS §F, changelog, strategy ticks"
git push origin keepance-3.0
```

---

## Self-review notes

- **Coverage vs the brief:** VG-2b → Tasks 1-3; F-510 → Task 4; verifier normalization → Task 5; VG-2 OCR → Tasks 6-8 (spike → engine → pipeline); VG-3c → Task 9; VG-6e → Task 10; VG-6b → Task 11; VG-4c → Task 12; VG-3d → Task 13; finale → Task 14. The decided ordering is preserved exactly; every Wave-2 item from the strategy §4 block is owned by a task.
- **Known judgment calls, decided here:** office extraction is Rust-side for both walk and watcher (verified: the watcher funnels into `rag_index_file`, so Rust `is_indexable` lights up both paths); xlsx/pptx hand-rolled on the crate-pinned zip/quick-xml rather than calamine; the F-510 cap is a Rust-side optional `rag_retrieve` parameter so leg 1 proves the production function (no cross-language reimplementation), finder-only via `perSourceCap: 4`; the verifier normalization is symmetric canonicalization with explicit not-fuzzy tests; OCR storage is `extraction`/`extraction_confidence` nullable columns with `source_type` staying `"pdf"`; transcript locator is metadata ON TOP of the unchanged sequential `paragraph_index` (content-address contract intact); VG-6e uses deterministic HMAC tokens for the equality-predicate columns + a separate `path_enc` AES-GCM column (straight encryption would break five verified predicate sites); `chunk_id` stays plaintext-derived; the letterhead merge drops the generated body-level sectPr in favor of the template's (the `docx` JS Packer always emits one — documented in `createBlankDocx`); the issue spotter is a generate template per the pack's own adoption-level-1 doc; three INDEX_VERSION bumps (8/9/10 after the post-Task-3 renumber; Task 3 took 7) with one user-visible re-index.
- **Known judgment calls left to the implementer (flagged in-step):** the keepance-docx fixture-path helper and reader configuration; exact `FIRM_ENDPOINTS` login/seat routes for the Assured script; the rag-progress-banner component name; `docx_*` command byte conventions; whether the wedge-proof e2e gains an OCR spec (wasm shape only); per-file menu pattern in FileTree; the OCR engine choice itself (Task 6's decision rule).
- **Cross-task interactions:** Tasks 3/4/5/8/9/10 all touch `rag/mod.rs` and Tasks 3/8/9/10 touch `store.rs` — strictly sequential execution (the task order) keeps them conflict-free; the INDEX_VERSION ladder (rule 8) encodes the required order. Tasks 3/8/9 each grow the corpus the leg-1 suite indexes — after each, the untouched finder-feed test re-runs (rule 3); a red there is a product finding routed to Task 4's cap or the RESULTS addendum, never a retune.
- **What this wave deliberately does NOT do:** VG-6c SSO and VG-6d-v2 vault (Wave 3); VG-8 co-editing (Wave 4); VG-9 connectors (Wave 5); VG-4b bundling evaluation (open, separate write-up); chat-side prompt-grammar changes; a finder source-type filter; F-507a model-quality chasing; the audit `contentLength` nit; any website deploy or app release (commercial — Jameson's go).
- **Honesty checks baked in:** the F-510 raw-feed observation is recorded un-gated next to the capped-feed gate; OCR low-confidence is disclosed at the citation, in the finder deliverable, and in the data map; the Assured exercise banks only redacted artifacts and claims only what was observed; RESULTS §F carries a residuals list.
