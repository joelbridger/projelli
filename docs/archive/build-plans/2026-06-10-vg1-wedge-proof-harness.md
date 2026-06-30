# VG-1: Wedge-Proof Harness — Implementation Plan (three legs)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove the wedge end to end — ask a natural-language question over an indexed legal corpus, get a cited answer, the citation verifies, click-through opens the source passage, and the flagship Deposition Contradiction Finder completes a full run producing its planted contradictions in a real `.docx` — observed on a real machine, captured as repeatable harness artifacts. This closes the vision-coverage audit's top gap (F-117, F-415, F-422: the positive cited-answer path and the contradiction-finder full run, never observed on a real machine).

**Architecture:** three legs, cheapest-first, each carrying a DIFFERENT truth claim — the boundaries below are load-bearing and every leg's file header restates its own:

1. **Leg 1 — Rust retrieval truth** (`src-tauri/tests/rag_deposition_contradictions.rs`): extends the `rag_matter_scope.rs` patterns. Indexes the REAL Johnson fixture corpus (`tests/fixtures/matter-corpus/`) into a temp LanceDB with real e5-small embeddings (the rig's cached model, offline) and asserts: each planted contradiction's source passages are retrievable by natural-language queries with citations that VERIFY; BOTH sides of each contradiction are retrievable (a contradiction needs both sides); Matter B (Acme) isolation holds; and the contradiction finder's own retrieval query at its own `topK: 12` feeds both sides of all three contradictions. **Honesty boundary: this leg proves RETRIEVAL truth, not LLM analysis. The contradiction-finding judgment is an LLM step and belongs to leg 3.**
2. **Leg 2 — browser UI wiring** (`tests/e2e/wedge-proof.spec.ts`): Playwright against the Vite dev build with `?testMode=true`. **Honesty boundary: browser mode has no Rust rag (`ragRetrieve` throws "RAG is only available in the desktop app", `src/utils/tauri-commands.ts:315-317`), so this leg proves UI GLUE only — citation chips (verified + unverified states), sources accordion, click-through, scope chip, refusal-not-fabrication, plus the xlsx open→edit→save→reopen formula round-trip and the pptx fixture render. It never proves retrieval.** Zero product-code changes: every seam it needs already exists (`__openTestFile`, `__mockWorkspaceFs`, `__editorStore`, the `.aichat`-file message format).
3. **Leg 3 — real-machine positive pass** (`scripts/wedge-proof-native.sh` + `docs/quality/2026-06-11-wedge-proof/RUNBOOK.md`): the real Tauri debug binary under Xvfb :99 on this rig, model cache PRE-SEEDED from `~/.local/share/keepance/models/e5-small` (no network), Ollama `llama3.2:3b` as the local model, fixture workspace seeded directly on disk (never the GTK chooser — it is keyboard-isolated headless), a headless Secret Service (see the keychain discovery below), and a quiesced frontend (`vite preview` of a production build — no HMR reload storms). One full positive pass with screenshots + logs + the output `.docx` banked into `docs/quality/2026-06-11-wedge-proof/` as the verification artifacts, plus the deferred Option B ready-handoff check (download card → rag banner) in a second run with the model cache removed and network allowed.

**Tech Stack:** Rust (tokio, LanceDB, fastembed e5-small via the production `rag` store/chunker/embedder, the existing `VEC_KEY` no-keychain test pattern), Playwright + the repo's data-testid discipline, bash + python3 (sqlite3/zipfile/re stdlib) + Xvfb/xdotool/scrot/systemd-run/dbus-run-session/gnome-keyring for leg 3.

**Branch:** work directly on `keepance-3.0` (same as Option B).

**Prime directive — the harness PROVES; it does not FIX.** Any product bug a leg surfaces gets logged as a finding (an F-5xx row in `docs/quality/2026-06-11-wedge-proof/RESULTS.md`, cross-referenced into the coverage ledger) for a fix wave. It is NEVER patched inside a harness task, and an assertion is NEVER weakened to make a leg pass. The only exception: an assertion that was factually wrong about the fixtures/UI (e.g. a wording mismatch) may be corrected to match reality, with a note.

**Decision context:** Option B (visible model download) is COMPLETE — commit `f104cae` ("Option B COMPLETE — all 7 tasks done, real-download proof green"), so VG-1 is unblocked. The gap-closure plan (`docs/strategy/2026-06-10-vision-gap-closure-plan.md` §VG-1) names this harness the audit's top ask; VG-3a (the full planted-contradiction run) explicitly rides this harness's leg 3.

**Verified repo facts (checked against the tree 2026-06-10; do not re-derive, and note the scouting corrections):**

- **Fixtures:** `tests/fixtures/matter-corpus/README.md:37-47` documents the 3 planted contradictions. Exact in-file wording (verified): transcript `deposition-transcript-johnson.txt:77` "I forwarded them to my personal email for safekeeping." / summary `incident-summary-johnson.md` "**all relevant documents remained on company servers only**"; transcript `:108` "He said I had until October 17, 2025 to submit my written response." / summary "a deadline of **October 10, 2025**"; transcript `:168` "Sandra Liu gave me a document describing a four-week severance." / summary "offering **eight (8) weeks of base salary continuation**". **Fixture caveat (state it in artifacts):** both files carry inline `[CONTRADICTION-N: …]` annotation blocks; they are part of the indexed text and make the LLM's leg-3 job easier. Acceptable for v1 of the proof (annotations are themselves matter-record text); a marker-free fixture variant is flagged as a follow-up, not built here.
- **`rag_matter_scope.rs` patterns to reuse verbatim** (`src-tauri/tests/rag_matter_scope.rs`): fixed `VEC_KEY: [u8; 32]` so tests never touch the OS keychain (line 51); `decrypt_hit` via `keepance_lib::commands::mail::crypto::decrypt_with_key` (lines 57-62); OnceCell fixture building the production `chunks` table via `store::open_connection` → `store::open_or_create_table` → `chunker::chunk_text` → `embedder::embed_documents` → `store::build_batch(.., SourceType::Text, matter, privilege, &VEC_KEY)` → `table.add(RecordBatchIterator…)` (lines 187-226); `nearest(&table, &q, top_k, Some(matter), include_privileged)`; the four-verdict `verify()` mirror of `rag_verify_citation` (lines 377-398); `store::chunk_id(path, paragraph_index)` reproducibility (line 251). Header NOTE (lines 29-35): the model must be pre-provisioned (Option B gate — no implicit download); this rig's cache at `~/.local/share/keepance/models/e5-small` (465 MB, hf-hub layout, verified present) satisfies it for `cargo test`.
- **The Rust rag extractor indexes ONLY text formats** — `src-tauri/src/commands/rag/extractor.rs:19` allows `md, markdown, txt, text, aichat, workflow, json, csv`; `.docx/.xlsx/.pptx` are an explicit TODO (`extractor.rs:23-26`). So leg 1's corpus is the fixture set's text members, and leg 3's expected index over the fixture workspace is exactly **4 files** (deposition `.txt`, incident summary `.md`, `huge-notes.md`, `acme-supply-agreement.txt`) — matching the campaign's observed "Memory: 4 files" (`native-findings.md` F-407). The intake-memo-acme.docx not being indexed is a KNOWN TODO, not a new finding.
- **Chunker:** paragraphs = double-newline blocks, greedily grouped (`src-tauri/src/commands/rag/chunker.rs:4,40`). Both fixture files use blank-line paragraph breaks, so the contradiction passages land in distinct retrievable chunks. The corpus is small enough that `nearest` is an exact scan — results are deterministic.
- **SCOUTING CORRECTION — testids.** `matters-panel` and `workflow-run-{runId}` do NOT exist. Real hooks (verified by grep): `matters-sidebar-panel` (`src/components/matter/MattersSidebarPanel.tsx`); workflow run surfaces are `workflow-execution-tab`, `workflow-analyze-summary`, `workflow-file-link-{name}`, `workflow-verification-banner` (`src/components/workflow/WorkflowExecutionTab.tsx`). Confirmed real: `chat-sources-accordion` (`AIChatViewer.tsx:388`), `chat-sources-toggle` (`:393`), `chat-citation-{basename}-{paragraphIndex}` (`:300`), chips carry `data-verified="true"|"false"|"unknown"` (`:312-318`), `ask-workspace-toggle` (`:2245`), `include-privileged-toggle` (`:2271`), `chat-message-{idx}-scope` with `data-scope-kind` (`:2411-2413`), `chat-input` (`:2709`), `chat-send-button` (`:2735`), `spreadsheet-viewer` / `spreadsheet-cell-{r}-{c}` / `spreadsheet-cell-input-{r}-{c}` / `spreadsheet-formula-bar-content` (`SpreadsheetViewer.tsx`), `presentation-viewer` / `presentation-fallback-banner` / `fallback-slide-{n}` (`PresentationViewer.tsx`), `model-download-card`, `rag-progress-banner`, `rag-status-badge` (`src/components/memory/`).
- **Chat message shapes for seeding (leg 2):** `.aichat` file = JSON `{provider, model, messages, createdAt}` (precedent: `tests/campaign/sweep/viewers.spec.ts:158-166` seeds `provider:'mock'`). `ChatMessage.sources?: WorkspaceSource[]` (`src/types/ai.ts:51`), `WorkspaceSource` (`:104`) with `path/chunkText/score/paragraphIndex/id/matterId/sourceId/verified`, `ChatMessage.scope?: TurnScope` (`:64`) shaped `{kind:'matter', matterId, matterName}`. Citation regex: `[filename paragraph N]` or `[filename §N]` (`src/modules/memory/workspaceCommand.ts:156-158`). In browser, `verifyCitations` catches the Tauri-only throw and leaves `verified` untouched (`workspaceCommand.ts:269-271`) — so leg 2 exercises chip verified-states via SEEDED `verified` flags, honestly labeled as render-state proof.
- **Refusal path order (leg 2 live-send):** retrieval + the F-116 refusal happen BEFORE any provider/API-key check (`AIChatViewer.tsx:933-1056` runs and `return`s before the provider switch at `:1393`), so the browser refusal test needs no key and no provider seam. Refusal copy: `"I couldn't search your workspace just now, so I won't answer from your matter."` (`src/locales/en.json:484`). The path logs `console.error('Workspace retrieval failed:', …)` (`AIChatViewer.tsx:1005`) — the spec must allow exactly that one expected error.
- **xlsx fixture layout** (`generators/generate-fixtures.py:726-749`): sheet "Damages"; row 1 headers; rows 2-8 data (row 4 = "Lost bonus (2025)" 22000); row 9 blank; row 10 "TOTAL (base)" B10=`=SUM(B2:B7)`; row 11 "TOTAL (with punitive)" B11=`=SUM(B2:B8)`. The viewer's `spreadsheet-cell-{r}-{c}` is 0-based including the header row (existing spec: C3 ↔ `cell-2-2`), so: Lost-bonus B4 ↔ `cell-3-1`, TOTAL(base) B10 ↔ `cell-9-1`. Base total 355,250; after editing 22000→30000 it recomputes to 363,250. Editing pushes a re-serialized data URL upstream via `onContentChange` into the editor store tab content (`SpreadsheetViewer.tsx:126-143`) — the round-trip reopen reads THAT artifact back.
- **SCOUTING/SPEC CORRECTION — there is NO pptx editing in the product.** `PresentationViewer.tsx` is view-only (Tauri+LibreOffice → PDF; otherwise a pure-JS extracted-text outline via `extractSlides`, `:92-127`); `pptx-io` is build-from-JSON + extract-text; the build→extract round-trip is already unit-tested (`tests/unit/pptx-export.test.ts:71-72`). The "pptx edit-persists" idea is not implementable. The honest pptx assertions here: leg 2 proves the REAL fixture parses and renders its actual slide text through the fallback outline in the browser; leg 3 observes the same on the native binary (the rig has no LibreOffice — `soffice` absent — so native also takes the honest fallback, which is itself the VG-4 detect-and-explain story, out of scope here).
- **KEYCHAIN DISCOVERY (new, not in the scouting — leg 3 design driver):** the LIVE app's indexing path hard-requires the OS keychain. `rag/crypto.rs::get_or_create_master_key` (keychain service `keepance-vectors-enc`) is called before any embedding in `rag_index_workspace` / `rag_index_file` / `rag_index_pdf_chunks` (`src-tauri/src/commands/rag/mod.rs:283,446,854`), and `Cargo.toml:92` pins keyring features `["apple-native","windows-native","sync-secret-service"]` — Secret Service ONLY on Linux, no keyutils fallback. Headless with no Secret Service daemon, indexing fails with `"vectors key: …"`. **Leg 3 therefore brings up a headless Secret Service** (gnome-keyring inside `dbus-run-session`, the standard CI pattern). `gnome-keyring` is NOT currently installed (apt candidate 46.1-2ubuntu0.2); `dbus-run-session` and `secret-tool` are. The campaign treated "no keychain" as blocking only mail/audit; on the current tree it also blocks the vector store — this plan closes that hole. Mail + live-audit paths STILL stay out of leg 3 scope (below).
- **Leg 3 out-of-scope, stated plainly:** live mail import (the IMAP client correctly mandates TLS, `native-findings.md` F-419; greenmail is plaintext-only) and the live-audit-capture micro-item (assigned by the gap-closure plan to the Windows spot check, F-425). With the headless keyring up, audit events MAY incidentally capture on this rig — if observed, bank it as bonus evidence, but the Windows spot check remains the closure of record for that item.
- **Leg 3 mechanics from the campaign** (`native-findings.md` attempt-4 header): debug binary `src-tauri/target/debug/keepance`; `systemd-run --user --scope -p MemoryMax=3G -p MemorySwapMax=0`; Xvfb :99 1366x768x24; fresh XDG profile (`dirs::data_dir()` honors `XDG_DATA_HOME`, so the model pre-seed target is `$XDG_DATA_HOME/keepance/models/e5-small` — F-415/F-416 confirmed `<profile>/data/keepance/models/e5-small`); embedder RSS plateau ~1.4 GB, transient peak ~2.05 GB (F-416) → keep the 3 GB cap and check `free -h` first (box is memory-tight). GTK file-chooser is keyboard-isolated headless → workspace opens via a SEEDED recent entry: localStorage key `keepance_recent_workspaces` (shape `{path,name,lastOpened}`, `src/stores/workspaceStore.ts:155`, `src/types/workspace.ts:30-34`) written as UTF-16-LE BLOBs into the WebKit localStorage sqlite (the leak-investigation did exactly this, `leak-investigation.md:54`), plus `keepance_onboarding_complete` = `'true'` (FirstRunWizard) and `keepance_onboarding_completed_at` (useOnboarding). Vite-HMR reload storms wrecked campaign sessions (F-422 noise) → leg 3 serves a PRODUCTION build via `npx vite preview --port 5173 --strictPort` (the debug binary loads `devUrl: http://localhost:5173`, `src-tauri/tauri.conf.json:8`; vite's dev proxies are cloud-provider/firm-only, irrelevant — Ollama is called directly at `http://127.0.0.1:11434`, allowed by the Tauri CSP, `OllamaProvider.ts:7,38`).
- **Contradiction finder runtime facts (leg 3):** template `src/modules/workflow/templates/legal/DepositionContradictionFinder.ts` — interview questions `matterName/witnessName/depositionDate/keyClaimsToScrutinize/depositionExcerpts` (required) + `priorStatements` (optional), `retrievalQueryTemplate` at line 64, `topK: 12`, `outputFile: 'Deposition Contradiction Analysis.docx'`. Engine path `WorkflowEngine.ts` `executeAnalyzeStep` → `runContradictionAnalysis` (retrieve → structured findings → per-finding verification → `serializeContradictions` → `writeFileBinary`). Output lands at `<workspace>/<template name> - <timestamp>/Deposition Contradiction Analysis.docx` (`App.tsx:2276-2277,2480`). The run record's analyze tool-call params carry `retrievedChunks` + verified/unverified counts (`WorkflowEngine.ts:432-446`) — use them to diagnose a rubric failure (retrieval feed vs LLM quality). `OllamaProvider.structuredOutput` exists (`OllamaProvider.ts:363`), and the campaign confirmed the start dialog resolves to the local model (F-422).
- **Playwright config:** main config `playwright.config.ts` — testDir `tests/e2e`, baseURL `http://localhost:5173`, `webServer: npm run dev` with `reuseExistingServer` locally, projects `chromium/en/es/de`. Leg 2 joins `tests/e2e/` and runs under `--project=chromium`. Campaign helpers: `snap`/`collectConsoleErrors` in `tests/campaign/helpers/campaign.ts` — `snap` hardcodes the 2026-06-10 campaign screenshots dir, so leg 2 defines its own 10-line `keep()` writing to `docs/quality/2026-06-11-wedge-proof/screenshots/browser/` and imports only `collectConsoleErrors`.
- **Rig inventory (verified):** model cache 465 MB at `~/.local/share/keepance/models/e5-small/models--intfloat--multilingual-e5-small`; `ollama list` → `llama3.2:3b`; `Xvfb`, `xdotool`, `scrot`, `import`, `unzip`, `python3`, `secret-tool`, `dbus-run-session` present; `gnome-keyring` NOT installed; `soffice` NOT installed; `free -h` ≈ 19 Gi available (watch it before launches).

---

## File map

| File | Action | Responsibility |
|---|---|---|
| `src-tauri/tests/rag_deposition_contradictions.rs` | Create | Leg 1: retrieval truth over the real fixtures (contradictions retrievable + verifiable, isolation, finder-feed) |
| `tests/e2e/wedge-proof.spec.ts` | Create | Leg 2: citation UI glue, refusal, xlsx round-trip, pptx render |
| `scripts/wedge-proof-native.sh` | Create | Leg 3: environment orchestration (Xvfb, keyring, profile/model/workspace seed, launch, localStorage seed, assertions, artifacts) |
| `docs/quality/2026-06-11-wedge-proof/RUNBOOK.md` | Create | Leg 3: the attended click-by-click pass + contingencies |
| `docs/quality/2026-06-11-wedge-proof/RESULTS.md` | Create (Task 7) | The run's pass/fail ledger + findings (F-5xx) |
| `docs/quality/2026-06-11-wedge-proof/{screenshots,logs,output}/` | Create (Tasks 6-7) | Banked verification artifacts |
| `docs/quality/2026-06-10-v3-usability-campaign/coverage-ledger.md` | Modify (Task 8) | New "W. Wedge proof (VG-1)" rows; F-117/F-415/F-422 closure pointers |
| `docs/strategy/2026-06-10-vision-gap-closure-plan.md` | Modify (Task 8) | VG-1 status note with evidence link |
| `CHANGELOG.md` | Modify (Task 8) | `[Unreleased]` entry |

No product source file is modified by any task. If executing a task appears to require a product change, STOP — that is a finding, not a task.

---

### Task 1: Leg 1 scaffold — fixture corpus, cited retrieval + verification for CONTRADICTION-1

**Files:**
- Create: `src-tauri/tests/rag_deposition_contradictions.rs`

- [x] **Step 1: Read the pattern source first**

```bash
sed -n '1,120p' ~/keepance/src-tauri/tests/rag_matter_scope.rs
sed -n '370,400p' ~/keepance/src-tauri/tests/rag_matter_scope.rs
```

Mirror its imports, fixture OnceCell, `decrypt_hit`, and `verify` exactly — do not invent new plumbing.

- [x] **Step 2: Create the test file**

Create `src-tauri/tests/rag_deposition_contradictions.rs`:

```rust
//! VG-1 LEG 1 — WEDGE RETRIEVAL TRUTH over the REAL campaign fixtures.
//!
//! Indexes the actual Johnson v. Nexus Dynamics fixture files
//! (`tests/fixtures/matter-corpus/`) into a temp LanceDB through the SAME
//! production chunker → e5-small embedder → encrypted store the app ships,
//! and asserts the wedge's retrieval layer tells the truth:
//!
//!   C1/C2/C3 — for each planted contradiction (README.md:37-47), BOTH
//!       conflicting passages are retrievable by natural-language queries,
//!       carry the right source, and their citations VERIFY against the
//!       store (a contradiction needs both sides retrievable).
//!   ISOLATION — the same Johnson queries scoped to Matter B (Acme) never
//!       return Johnson content, and vice versa (README distinctness
//!       invariant: Acme files contain no "Johnson"/"Nexus Dynamics").
//!   FINDER FEED — the Deposition Contradiction Finder's OWN retrieval
//!       query (retrievalQueryTemplate interpolated with the proof-run
//!       interview inputs, DepositionContradictionFinder.ts:64) at its own
//!       topK = 12 surfaces both sides of all three contradictions.
//!
//! HONESTY BOUNDARY: this binary proves RETRIEVAL truth only. The actual
//! contradiction-finding judgment is an LLM analyze step (legalAnalysis.ts)
//! and is proven by the leg-3 real-machine pass, never here.
//!
//! NOTE: under the Option B gate the embedder NEVER downloads implicitly —
//! pre-provision the e5-small cache exactly as rag_matter_scope.rs documents
//! (this rig: ~/.local/share/keepance/models/e5-small is populated).
//!
//! Corpus note: only text formats are rag-indexable today (extractor.rs:19);
//! the corpus here is the fixtures' text members. intake-memo-acme.docx is
//! NOT indexed — that is the documented extractor TODO, not a gap this
//! harness owns.

use keepance_lib::commands::rag::chunker::Chunk;
use keepance_lib::commands::rag::store::{
    self, lookup_by_id, nearest, SourceType, PRIVILEGE_NONE,
};
use keepance_lib::commands::rag::Verdict;
use std::sync::Arc;
use tokio::sync::OnceCell;

const MATTER_JOHNSON: &str = "matter-johnson";
const MATTER_ACME_B: &str = "matter-acme-b";

/// Fixed vector-store key so the tests never touch the OS keychain
/// (same pattern as rag_matter_scope.rs).
const VEC_KEY: [u8; 32] = [0x6Bu8; 32];

const FIXTURE_DIR: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../tests/fixtures/matter-corpus"
);

/// Decrypt a `StoredHit`'s text (hex AES-256-GCM) exactly as the
/// `rag_retrieve` command does.
fn decrypt_hit(h: &store::StoredHit) -> String {
    use keepance_lib::commands::mail::crypto::decrypt_with_key;
    let blob = hex::decode(&h.text).expect("hit text must be hex ciphertext");
    String::from_utf8(decrypt_with_key(&blob, &VEC_KEY).expect("decrypt hit text"))
        .expect("utf8 plaintext")
}

struct Source {
    matter_id: &'static str,
    /// Stable test path; basename matches the real fixture file so citation
    /// labels look exactly like production.
    source_id: &'static str,
    /// Fixture filename to load from FIXTURE_DIR.
    file: &'static str,
}

/// The corpus: the REAL fixture files (read at test time, never inlined, so
/// fixture edits keep the proof honest). Johnson = the contradiction pair;
/// Acme = the isolation matter (its only rag-indexable file).
fn corpus() -> Vec<Source> {
    vec![
        Source {
            matter_id: MATTER_JOHNSON,
            source_id: "/matter-corpus/deposition-transcript-johnson.txt",
            file: "deposition-transcript-johnson.txt",
        },
        Source {
            matter_id: MATTER_JOHNSON,
            source_id: "/matter-corpus/incident-summary-johnson.md",
            file: "incident-summary-johnson.md",
        },
        Source {
            matter_id: MATTER_ACME_B,
            source_id: "/matter-corpus/matter-b-acme/acme-supply-agreement.txt",
            file: "matter-b-acme/acme-supply-agreement.txt",
        },
    ]
}

struct Fixture {
    table: lancedb::Table,
    _dir: tempfile::TempDir,
}

static FIXTURE: OnceCell<Arc<Fixture>> = OnceCell::const_new();

async fn fixture() -> Arc<Fixture> {
    FIXTURE
        .get_or_init(|| async {
            let dir = tempfile::tempdir().expect("tempdir");
            let conn = store::open_connection(dir.path()).await.expect("open connection");
            let table = store::open_or_create_table(&conn).await.expect("create table");

            for src in corpus() {
                let path = format!("{FIXTURE_DIR}/{}", src.file);
                let text = std::fs::read_to_string(&path)
                    .unwrap_or_else(|e| panic!("read fixture {path}: {e}"));
                let chunks =
                    keepance_lib::commands::rag::chunker::chunk_text(src.source_id, &text);
                let texts: Vec<String> = chunks.iter().map(|c| c.text.clone()).collect();
                let vectors = keepance_lib::commands::rag::embedder::embed_documents(&texts)
                    .await
                    .expect("embed documents (is the e5-small cache provisioned?)");
                let rows: Vec<(Chunk, Vec<f32>)> = chunks.into_iter().zip(vectors).collect();
                let batch = store::build_batch(
                    &rows,
                    SourceType::Text,
                    src.matter_id,
                    PRIVILEGE_NONE,
                    &VEC_KEY,
                )
                .expect("build batch");
                let schema = batch.schema();
                use arrow_array::RecordBatchIterator;
                table
                    .add(Box::new(RecordBatchIterator::new(vec![Ok(batch)], schema)))
                    .execute()
                    .await
                    .expect("add batch");
            }

            Arc::new(Fixture { table, _dir: dir })
        })
        .await
        .clone()
}

async fn embed(query: &str) -> Vec<f32> {
    keepance_lib::commands::rag::embedder::embed_query(query)
        .await
        .expect("embed query")
}

/// Mirror of `rag_verify_citation`'s verdict logic at the store layer
/// (identical to rag_matter_scope.rs's helper).
async fn verify(table: &lancedb::Table, id: &str, claimed: &str, quoted: &str) -> Verdict {
    use keepance_lib::commands::mail::crypto::decrypt_with_key;
    let normalize = |s: &str| s.split_whitespace().collect::<Vec<_>>().join(" ");
    let decrypt = |hex_text: &str| -> String {
        let blob = hex::decode(hex_text).expect("record text must be hex ciphertext");
        String::from_utf8(decrypt_with_key(&blob, &VEC_KEY).expect("decrypt record text"))
            .expect("utf8")
    };
    match lookup_by_id(table, id, Some(claimed)).await.unwrap() {
        Some(rec) => {
            let plaintext = decrypt(&rec.text);
            if normalize(&plaintext).contains(&normalize(quoted)) && !normalize(quoted).is_empty()
            {
                Verdict::Verified
            } else {
                Verdict::TextMismatch
            }
        }
        None => match lookup_by_id(table, id, None).await.unwrap() {
            Some(other) => Verdict::MatterMismatch { actual_matter: other.matter_id },
            None => Verdict::NotFound,
        },
    }
}

/// Find the first hit (scoped retrieval result) whose DECRYPTED text contains
/// `needle`; panics with the result set listing when absent — the panic
/// message is the finding.
fn hit_containing<'a>(
    hits: &'a [store::StoredHit],
    needle: &str,
) -> &'a store::StoredHit {
    hits.iter()
        .find(|h| decrypt_hit(h).contains(needle))
        .unwrap_or_else(|| {
            panic!(
                "FINDING: no retrieved chunk contains {needle:?}; got sources {:?}",
                hits.iter().map(|h| h.source_id.clone()).collect::<Vec<_>>()
            )
        })
}

/// Retrieve + assert a passage containing `needle` comes back from `source`,
/// with a reproducible chunk id and a citation that VERIFIES.
async fn assert_cited_passage(
    f: &Fixture,
    query: &str,
    matter: &str,
    source: &str,
    needle: &str,
) {
    let q = embed(query).await;
    let hits = nearest(&f.table, &q, 8, Some(matter), false).await.expect("retrieve");
    assert!(!hits.is_empty(), "no hits for {query:?}");
    let hit = hit_containing(&hits, needle);
    assert_eq!(hit.source_id.as_deref(), Some(source), "wrong source for {needle:?}");
    assert_eq!(hit.matter_id.as_deref(), Some(matter));
    // Citation key is content-addressed + reproducible.
    assert_eq!(hit.id, store::chunk_id(source, hit.paragraph_index));
    // And the citation VERIFIES (quote is a verbatim substring of the chunk).
    let verdict = verify(&f.table, &hit.id, matter, needle).await;
    assert_eq!(verdict, Verdict::Verified, "citation for {needle:?} must verify");
}

// ===========================================================================
// CONTRADICTION-1 — personal-email forwarding vs nothing-left-company-systems
// ===========================================================================

#[tokio::test]
async fn c1_transcript_side_personal_email_retrieves_and_verifies() {
    let f = fixture().await;
    assert_cited_passage(
        &f,
        "did Johnson forward any documents to his personal email",
        MATTER_JOHNSON,
        "/matter-corpus/deposition-transcript-johnson.txt",
        "I forwarded them to my personal email for safekeeping",
    )
    .await;
}

#[tokio::test]
async fn c1_summary_side_company_servers_only_retrieves_and_verifies() {
    let f = fixture().await;
    assert_cited_passage(
        &f,
        "did any of Johnson's documents leave company systems",
        MATTER_JOHNSON,
        "/matter-corpus/incident-summary-johnson.md",
        "all relevant documents remained on company servers only",
    )
    .await;
}
```

- [x] **Step 3: Run it**

```bash
cd ~/keepance/src-tauri && cargo test --test rag_deposition_contradictions 2>&1 | tail -8
```

Expected: compiles; 2 tests PASS (first run loads the embedder from the rig's cache — slow once, offline). A FAILURE here is a finding: record the panic message verbatim; do not weaken the assertion. If the failure is a wording mismatch with the fixture text, fix the needle to the fixture's exact words (cite the fixture line in the commit message).

- [x] **Step 4: Commit**

```bash
cd ~/keepance && git add src-tauri/tests/rag_deposition_contradictions.rs
git commit -m "test(rag): VG-1 leg 1 scaffold — real-fixture corpus + CONTRADICTION-1 cited retrieval truth"
```

---

### Task 2: Leg 1 complete — C2/C3, isolation, the finder-feed assertion

**Files:**
- Modify: `src-tauri/tests/rag_deposition_contradictions.rs`

- [x] **Step 1: Append the remaining tests**

Append to the file (after the C1 tests):

```rust
// ===========================================================================
// CONTRADICTION-2 — deadline October 17 (transcript) vs October 10 (summary).
// ONE query, both sides in the result set: the passages are semantically
// near-identical, the corpus is small, and nearest() is an exact scan here,
// so this is deterministic. Both sides retrievable = the contradiction is
// FINDABLE by the layer above.
// ===========================================================================

#[tokio::test]
async fn c2_deadline_both_sides_retrievable_each_with_verifying_citation() {
    let f = fixture().await;
    let q = embed("what deadline was Johnson given to submit his written response about the expense review").await;
    let hits = nearest(&f.table, &q, 8, Some(MATTER_JOHNSON), false).await.unwrap();

    let transcript = hit_containing(&hits, "until October 17, 2025 to submit my written response");
    assert_eq!(
        transcript.source_id.as_deref(),
        Some("/matter-corpus/deposition-transcript-johnson.txt")
    );
    let v1 = verify(&f.table, &transcript.id, MATTER_JOHNSON, "October 17, 2025").await;
    assert_eq!(v1, Verdict::Verified);

    let summary = hit_containing(&hits, "October 10, 2025");
    assert_eq!(
        summary.source_id.as_deref(),
        Some("/matter-corpus/incident-summary-johnson.md")
    );
    let v2 = verify(&f.table, &summary.id, MATTER_JOHNSON, "October 10, 2025").await;
    assert_eq!(v2, Verdict::Verified);
}

// ===========================================================================
// CONTRADICTION-3 — four-week severance (transcript) vs eight weeks (summary).
// ===========================================================================

#[tokio::test]
async fn c3_severance_both_sides_retrievable_each_with_verifying_citation() {
    let f = fixture().await;
    let q = embed("how many weeks of severance was Johnson offered when he was terminated").await;
    let hits = nearest(&f.table, &q, 8, Some(MATTER_JOHNSON), false).await.unwrap();

    let transcript = hit_containing(&hits, "a document describing a four-week severance");
    assert_eq!(
        transcript.source_id.as_deref(),
        Some("/matter-corpus/deposition-transcript-johnson.txt")
    );
    let v1 = verify(&f.table, &transcript.id, MATTER_JOHNSON, "four-week severance").await;
    assert_eq!(v1, Verdict::Verified);

    let summary = hit_containing(&hits, "eight (8) weeks of base salary continuation");
    assert_eq!(
        summary.source_id.as_deref(),
        Some("/matter-corpus/incident-summary-johnson.md")
    );
    let v2 = verify(
        &f.table,
        &summary.id,
        MATTER_JOHNSON,
        "eight (8) weeks of base salary continuation",
    )
    .await;
    assert_eq!(v2, Verdict::Verified);
}

// ===========================================================================
// ISOLATION — Matter B (Acme) never bleeds into Johnson queries or vice
// versa. README invariant: Acme files contain no "Johnson"/"Nexus Dynamics"/
// "Marchetti" — re-asserted here over the DECRYPTED retrieved text so a
// future fixture edit cannot silently break the isolation proof.
// ===========================================================================

#[tokio::test]
async fn johnson_contradiction_queries_scoped_to_acme_return_no_johnson_content() {
    let f = fixture().await;
    for query in [
        "did Johnson forward any documents to his personal email",
        "what deadline was Johnson given to submit his written response about the expense review",
        "how many weeks of severance was Johnson offered when he was terminated",
    ] {
        let q = embed(query).await;
        let hits = nearest(&f.table, &q, 8, Some(MATTER_ACME_B), false).await.unwrap();
        for h in &hits {
            assert_eq!(
                h.matter_id.as_deref(),
                Some(MATTER_ACME_B),
                "LEAK: {:?} returned under Acme scope for {query:?}",
                h.source_id
            );
            let text = decrypt_hit(h);
            for forbidden in ["Johnson", "Nexus Dynamics", "Marchetti"] {
                assert!(
                    !text.contains(forbidden),
                    "LEAK: Acme-scoped hit {:?} contains {forbidden:?}",
                    h.source_id
                );
            }
        }
    }
}

#[tokio::test]
async fn acme_query_scoped_to_johnson_returns_no_acme_content() {
    let f = fixture().await;
    let q = embed("how many units of Widget Model X must the supplier deliver each month").await;
    let hits = nearest(&f.table, &q, 8, Some(MATTER_JOHNSON), false).await.unwrap();
    for h in &hits {
        assert_eq!(h.matter_id.as_deref(), Some(MATTER_JOHNSON), "LEAK: {:?}", h.source_id);
        assert_ne!(
            h.source_id.as_deref(),
            Some("/matter-corpus/matter-b-acme/acme-supply-agreement.txt"),
            "LEAK: Acme supply agreement surfaced under Johnson scope"
        );
    }
}

// ===========================================================================
// FINDER FEED — the DepositionContradictionFinder's own retrieval query, at
// its own topK = 12, surfaces both sides of all three contradictions. The
// query string below is retrievalQueryTemplate
// (DepositionContradictionFinder.ts:64) interpolated with the EXACT interview
// inputs the leg-3 runbook uses (keep the two in sync — the runbook cites
// this test). Failure here is a PRODUCT finding (the finder's retrieval feed
// is insufficient), never a test to tune.
// ===========================================================================

/// Mirrors the leg-3 interview answers. Excerpts are the clean Q/A lines
/// (the [CONTRADICTION-N] fixture annotations are NOT pasted — the LLM must
/// not be handed the answer through the interview; the indexed files still
/// contain them, which is a documented fixture caveat).
const FINDER_QUERY: &str = "Testimony and statements by Marcus Johnson relevant to: \
Whether Johnson forwarded documents to his personal email or all materials stayed on company servers. \
The deadline he was given for his written response to the compliance review. \
How many weeks of severance he was offered.. \
Deposition excerpts: Q. Did you preserve those documents? A. I believe I did. I forwarded them to my personal email for safekeeping. \
Q. Did Mr. Weston tell you a deadline for submitting the explanation? A. He said I had until October 17, 2025 to submit my written response. \
Q. At the time of your termination, did anyone at Nexus Dynamics explain the severance package being offered? A. Sandra Liu gave me a document describing a four-week severance.. \
Prior statements: ";

#[tokio::test]
async fn finder_retrieval_query_at_top_k_12_feeds_both_sides_of_all_three_contradictions() {
    let f = fixture().await;
    let q = embed(FINDER_QUERY).await;
    // topK 12 = the template's own setting (DepositionContradictionFinder.ts:129).
    let hits = nearest(&f.table, &q, 12, Some(MATTER_JOHNSON), false).await.unwrap();
    assert!(!hits.is_empty());

    // Scope hygiene inside the feed.
    for h in &hits {
        assert_eq!(h.matter_id.as_deref(), Some(MATTER_JOHNSON), "LEAK: {:?}", h.source_id);
    }

    // Both source documents are present in the feed…
    let sources: std::collections::HashSet<_> =
        hits.iter().filter_map(|h| h.source_id.clone()).collect();
    assert!(
        sources.contains("/matter-corpus/deposition-transcript-johnson.txt"),
        "finder feed missing the deposition; got {sources:?}"
    );
    assert!(
        sources.contains("/matter-corpus/incident-summary-johnson.md"),
        "finder feed missing the incident summary; got {sources:?}"
    );

    // …and the union of retrieved text covers BOTH sides of ALL THREE
    // contradictions — the necessary condition for the LLM step to be able
    // to flag them with real citations.
    let joined = hits.iter().map(|h| decrypt_hit(h)).collect::<Vec<_>>().join("\n---\n");
    for needle in [
        "I forwarded them to my personal email for safekeeping", // C1 transcript
        "all relevant documents remained on company servers only", // C1 summary
        "October 17, 2025",                                       // C2 transcript
        "October 10, 2025",                                       // C2 summary
        "four-week severance",                                    // C3 transcript
        "eight (8) weeks",                                        // C3 summary
    ] {
        assert!(
            joined.contains(needle),
            "FINDING: finder feed (topK 12) does not contain {needle:?} — \
             the finder cannot cite this side of the contradiction"
        );
    }
}
```

- [x] **Step 2: Run the full leg-1 binary**

```bash
cd ~/keepance/src-tauri && cargo test --test rag_deposition_contradictions 2>&1 | tail -8
```

Expected: 7 tests PASS. Any failure → record the panic verbatim as a finding (it goes into `RESULTS.md` in Task 7 / the ledger in Task 8); only needle-vs-fixture wording mismatches may be corrected.

- [x] **Step 3: Confirm the rest of the Rust suite is untouched**

```bash
cd ~/keepance/src-tauri && cargo test 2>&1 | tail -10
```

Expected: all binaries green (this plan adds one binary, modifies none).

- [x] **Step 4: Commit**

```bash
cd ~/keepance && git add src-tauri/tests/rag_deposition_contradictions.rs
git commit -m "test(rag): VG-1 leg 1 complete — C2/C3 both-sides retrieval, Acme isolation, finder-feed truth at topK 12"
```

---

### Task 3: Leg 2 scaffold — citation UI glue, click-through, refusal honesty

**Files:**
- Create: `tests/e2e/wedge-proof.spec.ts`

- [x] **Step 1: Read the seam precedents first**

```bash
sed -n '34,55p' ~/keepance/tests/e2e/spreadsheet-improvements.spec.ts   # __openTestFile pattern
sed -n '157,176p' ~/keepance/tests/campaign/sweep/viewers.spec.ts        # .aichat seeding pattern
sed -n '680,706p' ~/keepance/src/App.tsx                                 # __mockWorkspaceFs.seed
```

- [x] **Step 2: Create the spec with the part-A tests**

Create `tests/e2e/wedge-proof.spec.ts`:

```ts
/**
 * VG-1 LEG 2 — wedge UI WIRING in the browser build (testMode).
 *
 * HONESTY BOUNDARY: browser mode has no Rust rag (`ragRetrieve` throws
 * "RAG is only available in the desktop app", tauri-commands.ts:315). This
 * spec therefore proves UI GLUE only:
 *   1. Citation chips (verified + unverified render states), the sources
 *      accordion, the per-message matter-scope chip, and citation
 *      click-through opening the right passage — over SEEDED messages
 *      carrying real fixture text. (Render truth, not retrieval truth.)
 *   2. The F-116 refusal: "Ask my workspace" ON in a build without rag
 *      REFUSES instead of fabricating (the live send path up to the refusal
 *      runs for real; it returns before any provider/API-key code).
 *   3. The xlsx open → edit → recompute → save-artifact → reopen round-trip
 *      over the campaign's damages-model.xlsx, asserting the FORMULA
 *      survives (=SUM(B2:B7) is not flattened to a number).
 *   4. exhibit-deck.pptx parses and renders its real slide text through the
 *      honest no-LibreOffice fallback outline. (There is NO pptx editing in
 *      the product — the export side is unit-covered in pptx-export.test.ts.)
 *
 * Retrieval truth lives in src-tauri/tests/rag_deposition_contradictions.rs
 * (leg 1); the real-machine pass is scripts/wedge-proof-native.sh (leg 3).
 *
 * Run: npx playwright test tests/e2e/wedge-proof.spec.ts --project=chromium
 * Keep screenshots: WEDGE_KEEP_SHOTS=1 npx playwright test ...
 */

import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { test, expect, type Page, type TestInfo } from '@playwright/test';

import { collectConsoleErrors } from '../campaign/helpers/campaign';
import { hardClick, waitForTestModeLoad } from './helpers/test-utils';

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, '..', 'fixtures', 'matter-corpus');
const KEEP_DIR = join(
  here,
  '..',
  '..',
  'docs',
  'quality',
  '2026-06-11-wedge-proof',
  'screenshots',
  'browser',
);

/** snap()-alike that banks into the wedge-proof artifact dir when
 *  WEDGE_KEEP_SHOTS=1 (the campaign snap() is hardwired to the 2026-06-10
 *  campaign folder, so leg 2 keeps its own). */
async function keep(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  const out = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path: out, fullPage: true });
  await testInfo.attach(name, { path: out, contentType: 'image/png' });
  if (process.env.WEDGE_KEEP_SHOTS === '1') {
    mkdirSync(KEEP_DIR, { recursive: true });
    copyFileSync(out, join(KEEP_DIR, `${name}.png`));
  }
}

async function openTestFile(
  page: Page,
  args: { path: string; name: string; content: string },
) {
  await page.evaluate((a) => {
    const fn = (
      window as unknown as { __openTestFile?: (p: string, n: string, c: string) => void }
    ).__openTestFile;
    if (!fn) throw new Error('window.__openTestFile missing — is testMode=true?');
    fn(a.path, a.name, a.content);
  }, args);
}

/** Seed a text file into the in-memory mock workspace fs WITHOUT opening a
 *  tab (so citation click-through exercises the real open-from-fs path). */
async function seedMockTextFile(page: Page, path: string, content: string) {
  await page.evaluate(
    ({ p, c }) => {
      const fs = (
        window as unknown as {
          __mockWorkspaceFs?: { seed: (p: string, bytes: ArrayBuffer) => void };
        }
      ).__mockWorkspaceFs;
      if (!fs) throw new Error('window.__mockWorkspaceFs missing — is testMode=true?');
      const bytes = new TextEncoder().encode(c);
      const copy = new ArrayBuffer(bytes.byteLength);
      new Uint8Array(copy).set(bytes);
      fs.seed(p, copy);
    },
    { p: path, c: content },
  );
}

const DEPO_PATH = '/test-workspace/matter-corpus/deposition-transcript-johnson.txt';
const SUMMARY_PATH = '/test-workspace/matter-corpus/incident-summary-johnson.md';

const depoText = readFileSync(join(fixturesDir, 'deposition-transcript-johnson.txt'), 'utf8');
const summaryText = readFileSync(join(fixturesDir, 'incident-summary-johnson.md'), 'utf8');

/** A persisted chat whose assistant turn carries citations + sources +
 *  matter scope — the exact shapes AIChatViewer renders (ChatMessage.sources,
 *  ai.ts:51; TurnScope, ai.ts:64; chips parse `[file paragraph N]`,
 *  workspaceCommand.ts:156). One source verified, one NOT verified, so both
 *  chip render states are asserted. */
function citedChatFile(): string {
  return JSON.stringify({
    provider: 'mock',
    model: 'mock-model',
    createdAt: new Date().toISOString(),
    messages: [
      {
        role: 'user',
        content: 'What deadline was Johnson given for his written response?',
        timestamp: new Date().toISOString(),
      },
      {
        role: 'assistant',
        content:
          'The record conflicts. The deposition records October 17, 2025 ' +
          '[deposition-transcript-johnson.txt paragraph 12], while the incident ' +
          'summary records October 10, 2025 [incident-summary-johnson.md paragraph 8].',
        timestamp: new Date().toISOString(),
        scope: {
          kind: 'matter',
          matterId: 'matter-johnson',
          matterName: 'Johnson v. Nexus Dynamics Corp.',
        },
        sources: [
          {
            path: DEPO_PATH,
            chunkText: 'He said I had until October 17, 2025 to submit my written response.',
            score: 0.92,
            paragraphIndex: 12,
            id: 'a'.repeat(64),
            matterId: 'matter-johnson',
            sourceId: DEPO_PATH,
            verified: true,
          },
          {
            path: SUMMARY_PATH,
            chunkText: 'a deadline of October 10, 2025 to submit his written explanation',
            score: 0.9,
            paragraphIndex: 8,
            id: 'b'.repeat(64),
            matterId: 'matter-johnson',
            sourceId: SUMMARY_PATH,
            verified: false,
          },
        ],
      },
    ],
  });
}

test.describe('VG-1 leg 2 — wedge UI wiring (browser, testMode)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?testMode=true');
    await waitForTestModeLoad(page);
  });

  test('cited answer renders chips (verified + unverified), sources accordion, scope chip; chip click opens the cited passage', async ({
    page,
  }, testInfo) => {
    const getErrors = collectConsoleErrors(page);

    await seedMockTextFile(page, DEPO_PATH, depoText);
    await seedMockTextFile(page, SUMMARY_PATH, summaryText);
    await openTestFile(page, {
      path: '/test-workspace/AI Chats/wedge-cited.aichat',
      name: 'wedge-cited.aichat',
      content: citedChatFile(),
    });

    // Chips — one per citation, carrying the verify render state.
    const verifiedChip = page.getByTestId('chat-citation-deposition-transcript-johnson.txt-12');
    const unverifiedChip = page.getByTestId('chat-citation-incident-summary-johnson.md-8');
    await expect(verifiedChip).toBeVisible();
    await expect(verifiedChip).toHaveAttribute('data-verified', 'true');
    await expect(unverifiedChip).toBeVisible();
    await expect(unverifiedChip).toHaveAttribute('data-verified', 'false');

    // Per-message matter-scope chip.
    const scopeChip = page.getByTestId('chat-message-1-scope');
    await expect(scopeChip).toBeVisible();
    await expect(scopeChip).toHaveAttribute('data-scope-kind', 'matter');

    // Sources accordion lists both sources.
    const accordion = page.getByTestId('chat-sources-accordion');
    await expect(accordion).toBeVisible();
    await hardClick(page.getByTestId('chat-sources-toggle'));
    await expect(accordion).toContainText('deposition-transcript-johnson.txt');
    await expect(accordion).toContainText('incident-summary-johnson.md');
    await keep(page, testInfo, 'leg2-01-cited-answer');

    // Click-through: the chip opens the REAL seeded fixture file and the
    // cited passage is on screen.
    await hardClick(verifiedChip);
    await expect(
      page.getByText('until October 17, 2025 to submit my written response').first(),
    ).toBeVisible({ timeout: 10_000 });
    await keep(page, testInfo, 'leg2-02-citation-clickthrough');

    expect(getErrors(), 'console errors').toHaveLength(0);
  });

  test('ask-workspace ON in a build without rag REFUSES instead of fabricating; privilege toggle appears', async ({
    page,
  }, testInfo) => {
    const getErrors = collectConsoleErrors(page);

    await openTestFile(page, {
      path: '/test-workspace/AI Chats/wedge-refusal.aichat',
      name: 'wedge-refusal.aichat',
      content: JSON.stringify({
        provider: 'mock',
        model: 'mock-model',
        messages: [],
        createdAt: new Date().toISOString(),
      }),
    });

    // Turn on "Ask my workspace" — the include-privileged toggle is glued to it.
    await hardClick(page.getByTestId('ask-workspace-toggle'));
    await expect(page.getByTestId('include-privileged-toggle')).toBeVisible();

    const input = page.getByTestId('chat-input');
    await expect(input).toBeVisible();
    await input.fill('What deadline was Johnson given for his written response?');
    await hardClick(page.getByTestId('chat-send-button'));

    // The live refusal path (AIChatViewer.tsx:1025-1056) posts the refusal
    // and returns BEFORE any provider code — exact copy from en.json:484.
    await expect(
      page.getByText(
        "I couldn't search your workspace just now, so I won't answer from your matter.",
        { exact: false },
      ),
    ).toBeVisible({ timeout: 10_000 });
    await keep(page, testInfo, 'leg2-03-refusal');

    // The ONLY expected console error is the retrieval failure log itself
    // (AIChatViewer.tsx:1005). Anything else fails the test.
    const unexpected = getErrors().filter((e) => !e.includes('Workspace retrieval failed'));
    expect(unexpected, 'unexpected console errors').toHaveLength(0);
  });
});
```

- [x] **Step 3: Run part A**

```bash
cd ~/keepance && npx playwright test tests/e2e/wedge-proof.spec.ts --project=chromium 2>&1 | tail -8
```

Expected: 2 passed (webServer auto-starts/reuses the dev server). If a testid or copy assertion fails, verify against the source lines cited in the spec comments before touching anything — a genuine mismatch is a finding.

- [x] **Step 4: Commit**

```bash
cd ~/keepance && git add tests/e2e/wedge-proof.spec.ts
git commit -m "test(e2e): VG-1 leg 2 scaffold — cited-answer UI glue, click-through, refusal honesty (browser proves wiring only)"
```

---

### Task 4: Leg 2 complete — xlsx formula round-trip + pptx fixture render

**Files:**
- Modify: `tests/e2e/wedge-proof.spec.ts`

- [x] **Step 1: Append the part-B tests**

Append inside the same `test.describe` block:

```ts
  const XLSX_MIME =
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  const PPTX_MIME =
    'application/vnd.openxmlformats-officedocument.presentationml.presentation';

  function fixtureAsDataUrl(name: string, mime: string): string {
    const bytes = readFileSync(join(fixturesDir, name));
    return `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`;
  }

  test('xlsx round-trip: damages-model.xlsx opens, edit recomputes the total, the saved artifact reopens with the FORMULA intact', async ({
    page,
  }, testInfo) => {
    const getErrors = collectConsoleErrors(page);
    const xlsxPath = '/test-workspace/matter-corpus/damages-model.xlsx';

    await openTestFile(page, {
      path: xlsxPath,
      name: 'damages-model.xlsx',
      content: fixtureAsDataUrl('damages-model.xlsx', XLSX_MIME),
    });
    await expect(page.getByTestId('spreadsheet-viewer')).toBeVisible({ timeout: 20_000 });

    // Layout (generate-fixtures.py:726-749, 0-based incl. header row):
    // B4 "Lost bonus (2025)" = cell-3-1 (22000); B10 "TOTAL (base)" =
    // cell-9-1 = =SUM(B2:B7) → 355250 computed by the live formula engine.
    const total = page.getByTestId('spreadsheet-cell-9-1');
    await expect(total).toContainText('355250');

    // Edit the input: 22000 → 30000; the total recomputes to 363250.
    const bonus = page.getByTestId('spreadsheet-cell-3-1');
    await bonus.dblclick();
    const editor = page.getByTestId('spreadsheet-cell-input-3-1');
    await expect(editor).toBeVisible();
    await editor.fill('30000');
    await editor.press('Enter');
    await expect(total).toContainText('363250');
    await keep(page, testInfo, 'leg2-04-xlsx-edited');

    // The edit pushed a re-serialized .xlsx data URL into the tab content
    // (SpreadsheetViewer onContentChange → editor store). Read that saved
    // artifact back and REOPEN it — the true serialize→reparse round-trip.
    const savedDataUrl = await page.evaluate((p) => {
      const store = (
        window as unknown as {
          __editorStore?: { getState: () => { openTabs: Array<{ path: string; content: string }> } };
        }
      ).__editorStore;
      if (!store) throw new Error('window.__editorStore missing');
      const tab = store.getState().openTabs.find((t) => t.path === p);
      if (!tab) throw new Error(`tab not found: ${p}`);
      return tab.content;
    }, xlsxPath);
    expect(savedDataUrl.startsWith('data:')).toBe(true);

    await openTestFile(page, {
      path: '/test-workspace/matter-corpus/damages-model-reopened.xlsx',
      name: 'damages-model-reopened.xlsx',
      content: savedDataUrl,
    });
    await expect(page.getByTestId('spreadsheet-viewer')).toBeVisible({ timeout: 20_000 });

    // Edited value persisted AND the total still COMPUTES (not a flattened
    // copy of the old number).
    await expect(page.getByTestId('spreadsheet-cell-3-1')).toContainText('30000');
    const reopenedTotal = page.getByTestId('spreadsheet-cell-9-1');
    await expect(reopenedTotal).toContainText('363250');

    // THE formula assertion: select the total cell; the formula bar shows
    // the live formula, proving =SUM(B2:B7) survived the round-trip.
    await hardClick(reopenedTotal);
    await expect(page.getByTestId('spreadsheet-formula-bar-content')).toContainText('=SUM(B2:B7)');
    await keep(page, testInfo, 'leg2-05-xlsx-reopened-formula');

    expect(getErrors(), 'console errors').toHaveLength(0);
  });

  test('pptx: exhibit-deck.pptx parses and renders its real slide text via the honest fallback outline', async ({
    page,
  }, testInfo) => {
    const getErrors = collectConsoleErrors(page);

    await openTestFile(page, {
      path: '/test-workspace/matter-corpus/exhibit-deck.pptx',
      name: 'exhibit-deck.pptx',
      content: fixtureAsDataUrl('exhibit-deck.pptx', PPTX_MIME),
    });

    await expect(page.getByTestId('presentation-viewer')).toBeVisible({ timeout: 20_000 });
    // Browser mode takes the pure-JS extract fallback (PresentationViewer
    // effect: !inTauri → runFallback). Real fixture text, really parsed:
    await expect(page.getByTestId('presentation-fallback-banner')).toBeVisible();
    await expect(page.getByTestId('fallback-slide-1')).toContainText(
      'Johnson v. Nexus Dynamics Corp.',
    );
    await expect(page.getByTestId('fallback-slide-2')).toContainText('Key Events Timeline');
    await expect(page.getByTestId('fallback-slide-2')).toContainText(
      'November 12, 2025: Termination',
    );
    await keep(page, testInfo, 'leg2-06-pptx-fallback');

    // No pptx editing exists in the product; the export half (build→extract)
    // is unit-proven in tests/unit/pptx-export.test.ts. Nothing more to claim.
    expect(getErrors(), 'console errors').toHaveLength(0);
  });
```

- [x] **Step 2: Run the whole leg-2 spec**

```bash
cd ~/keepance && npx playwright test tests/e2e/wedge-proof.spec.ts --project=chromium 2>&1 | tail -8
```

Expected: 4 passed. Known judgment points: (a) the computed-total text rendering may be locale-formatted (e.g. `355,250` or `355250`) — check what the viewer actually renders and assert THAT (a `toContainText(/355,?250/)` regex is acceptable); (b) `fallback-slide-{n}` numbering is 1-based per `slide.number` — if slide 2's testid differs, read `PresentationViewer.tsx`'s fallback render block and match it.

- [x] **Step 3: Typecheck + commit**

```bash
cd ~/keepance && npx tsc --noEmit && git add tests/e2e/wedge-proof.spec.ts
git commit -m "test(e2e): VG-1 leg 2 complete — xlsx open/edit/save/reopen formula round-trip + pptx fixture render"
```

---

### Task 5: Leg 3 environment — `wedge-proof-native.sh` (preflight, up, launch, down, headless keychain)

**Files:**
- Create: `scripts/wedge-proof-native.sh` (mode 755)

This script owns everything around the attended UI pass: it never drives the UI itself (no scriptable selector layer exists for webkit2gtk on this rig — the campaign's method is xdotool + screenshots, which Task 7's runbook codifies). Subcommands: `preflight | up | launch [--fresh-model] | shot <name> | click <x> <y> | key <keys> | type <text> | seed-localstorage | assert | down` (`seed-localstorage` and `assert` are Task 6).

- [x] **Step 1: Write the script (env + preflight + up + launch + xdotool helpers + down)**

Create `scripts/wedge-proof-native.sh`:

```bash
#!/usr/bin/env bash
# VG-1 LEG 3 — real-machine wedge proof: environment orchestration.
#
# The REAL Tauri debug binary, on this rig, headless:
#   Xvfb :99 1366x768 · production frontend via `vite preview` on :5173 (no
#   HMR reload storms — the campaign's F-422 session killer) · fresh XDG
#   profile with the e5-small model cache PRE-SEEDED (no network; Option B
#   gate satisfied) · fixture workspace seeded on disk (NEVER the GTK file
#   chooser — keyboard-isolated headless) · headless Secret Service
#   (gnome-keyring under dbus-run-session): the live vector store fetches its
#   master key from the OS keychain BEFORE embedding (rag/mod.rs:446), so
#   without this, indexing fails with "vectors key: …" on any headless box.
#   Memory: systemd-run scope, MemoryMax=3G (embedder plateau ~1.4G, transient
#   peak ~2.05G — native-findings.md F-416). Check `free -h` first; this box
#   is memory-tight.
#
# OUT OF SCOPE on this rig (stays on the Windows spot check): live mail
# import (TLS-only IMAP vs the plaintext greenmail fixture, F-419) and the
# live-audit-capture micro-item (F-425 assigns it to a keychain-bearing
# desktop; if events incidentally capture here with the headless keyring up,
# bank them as bonus evidence only).
#
# The UI pass itself is attended (xdotool + screenshots per
# docs/quality/2026-06-11-wedge-proof/RUNBOOK.md); this script provides the
# helpers (`shot`, `click`, `key`, `type`) and the disk-truth `assert`.

set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROFILE="${WEDGE_PROFILE:-/tmp/wedge-profile}"
WS="${WEDGE_WS:-/tmp/wedge-ws}"
ART="$REPO/docs/quality/2026-06-11-wedge-proof"
DISP=":99"
PORT=5173
BIN="$REPO/src-tauri/target/debug/keepance"
MODEL_SRC="$HOME/.local/share/keepance/models/e5-small"
APP_LOG="$ART/logs/app.log"
RSS_CSV="$ART/logs/rss.csv"

say() { printf '\n== %s ==\n' "$*"; }

cmd_preflight() {
  say "preflight"
  free -h | sed -n '1,2p'
  avail_gb=$(free -g | awk '/^Mem:/{print $7}')
  [ "$avail_gb" -ge 4 ] || echo "WARN: <4G available — close something before launch"
  command -v Xvfb xdotool scrot unzip python3 secret-tool dbus-run-session >/dev/null
  curl -sf localhost:11434/api/tags | grep -q 'llama3.2' \
    || { echo "FAIL: ollama llama3.2:3b not available"; exit 1; }
  [ -d "$MODEL_SRC/models--intfloat--multilingual-e5-small" ] \
    || { echo "FAIL: e5-small cache missing at $MODEL_SRC"; exit 1; }
  if ! dpkg -s gnome-keyring >/dev/null 2>&1; then
    echo "gnome-keyring not installed. Run once:  sudo apt-get install -y gnome-keyring"
    exit 1
  fi
  echo "preflight OK"
}

cmd_up() {
  say "build binary (debug) + production frontend"
  (cd "$REPO/src-tauri" && cargo build 2>&1 | tail -2)
  (cd "$REPO" && npm run build 2>&1 | tail -3)

  say "Xvfb $DISP"
  pkill -f "Xvfb $DISP" 2>/dev/null || true
  Xvfb "$DISP" -screen 0 1366x768x24 >/dev/null 2>&1 &
  sleep 1

  say "vite preview :$PORT (quiesced frontend — no HMR)"
  pkill -f "vite preview" 2>/dev/null || true
  mkdir -p "$ART/logs" "$ART/screenshots" "$ART/output"
  (cd "$REPO" && nohup npx vite preview --port "$PORT" --strictPort \
      >"$ART/logs/vite-preview.log" 2>&1 &)
  for _ in $(seq 1 20); do curl -sf "http://localhost:$PORT" >/dev/null && break; sleep 1; done
  curl -sf "http://localhost:$PORT" >/dev/null || { echo "FAIL: preview not up"; exit 1; }

  say "fresh profile + model pre-seed + fixture workspace"
  rm -rf "$PROFILE" "$WS"
  mkdir -p "$PROFILE/data/keepance/models" "$PROFILE/config" "$PROFILE/cache" "$WS"
  cp -r "$MODEL_SRC" "$PROFILE/data/keepance/models/e5-small"
  rsync -a --exclude generators "$REPO/tests/fixtures/matter-corpus/" "$WS/"
  echo "workspace files:"; ls "$WS"
  echo "up OK — next: $0 launch   (run it in the background; it blocks)"
}

# Launch the app inside a private dbus session with an unlocked gnome-keyring
# (the standard headless-CI Secret Service pattern), under a 3G systemd scope.
# --fresh-model: REMOVE the model cache from the profile (and keep network) to
# observe the Option B download-card → rag-banner ready handoff for real.
cmd_launch() {
  local fresh=0
  [ "${1:-}" = "--fresh-model" ] && fresh=1
  if [ "$fresh" = 1 ]; then
    rm -rf "$PROFILE/data/keepance/models/e5-small"
    echo "fresh-model run: model cache removed from profile (network stays on)"
  fi
  mkdir -p "$ART/logs"
  : >"$APP_LOG"
  echo "ts,rss_kb" >"$RSS_CSV"

  dbus-run-session -- bash -c '
    set -e
    eval "$(printf "\n" | gnome-keyring-daemon --unlock --start --components=secrets)"
    export GNOME_KEYRING_CONTROL SSH_AUTH_SOCK 2>/dev/null || true
    # Prove the Secret Service is alive BEFORE launching (otherwise the first
    # index dies with "vectors key: …").
    printf "x" | secret-tool store --label=wedge-probe service wedge key probe
    [ "$(secret-tool lookup service wedge key probe)" = "x" ] || { echo "FAIL: keyring probe"; exit 1; }
    echo "keyring OK"

    ( while :; do
        pid=$(pgrep -x keepance | head -1) || true
        [ -n "${pid:-}" ] && echo "$(date +%s),$(awk "/VmRSS/{print \$2}" /proc/$pid/status 2>/dev/null)" >>"'"$RSS_CSV"'"
        sleep 5
      done ) &
    SAMPLER=$!
    trap "kill $SAMPLER 2>/dev/null" EXIT

    exec systemd-run --user --scope -p MemoryMax=3G -p MemorySwapMax=0 \
      --slice=wedgeproof \
      env DISPLAY="'"$DISP"'" GDK_BACKEND=x11 \
          XDG_DATA_HOME="'"$PROFILE"'/data" \
          XDG_CONFIG_HOME="'"$PROFILE"'/config" \
          XDG_CACHE_HOME="'"$PROFILE"'/cache" \
      "'"$BIN"'" >>"'"$APP_LOG"'" 2>&1
  '
}

cmd_shot()  { mkdir -p "$ART/screenshots"; DISPLAY=$DISP scrot -z -o "$ART/screenshots/$1.png"; echo "$ART/screenshots/$1.png"; }
cmd_click() { DISPLAY=$DISP xdotool mousemove "$1" "$2" click 1; }
cmd_key()   { DISPLAY=$DISP xdotool key "$@"; }
cmd_type()  { DISPLAY=$DISP xdotool type --delay 30 "$1"; }

cmd_down() {
  pkill -x keepance 2>/dev/null || true
  pkill -f "vite preview" 2>/dev/null || true
  pkill -f "Xvfb $DISP" 2>/dev/null || true
  echo "down OK (profile + workspace kept for inspection: $PROFILE, $WS)"
}

case "${1:-}" in
  preflight) cmd_preflight ;;
  up) cmd_up ;;
  launch) shift; cmd_launch "$@" ;;
  shot) cmd_shot "$2" ;;
  click) cmd_click "$2" "$3" ;;
  key) shift; cmd_key "$@" ;;
  type) cmd_type "$2" ;;
  seed-localstorage) cmd_seed_localstorage ;;   # Task 6
  assert) cmd_assert ;;                          # Task 6
  down) cmd_down ;;
  *) echo "usage: $0 preflight|up|launch [--fresh-model]|shot <name>|click <x> <y>|key <keys>|type <text>|seed-localstorage|assert|down"; exit 1 ;;
esac
```

```bash
chmod +x ~/keepance/scripts/wedge-proof-native.sh
```

- [x] **Step 2: Install the headless keychain (one-time, needs sudo)**

```bash
sudo apt-get install -y gnome-keyring
```

Expected: installs 46.1-2ubuntu0.2 (verified apt candidate). If sudo is unavailable in the execution context, STOP and flag — leg 3 cannot index without it (this is the keychain discovery in the plan header).

- [x] **Step 3: Preflight + syntax check**

```bash
cd ~/keepance && bash -n scripts/wedge-proof-native.sh && ./scripts/wedge-proof-native.sh preflight
```

Expected: `preflight OK` (memory line, ollama line, model cache, keyring installed). Do NOT run `up`/`launch` yet — that is Task 6's smoke.

- [x] **Step 4: Commit**

```bash
cd ~/keepance && git add scripts/wedge-proof-native.sh
git commit -m "feat(harness): VG-1 leg 3 environment script — Xvfb, quiesced frontend, model pre-seed, headless Secret Service, 3G scope"
```

---

### Task 6: Leg 3 — localStorage seeding + the disk-truth `assert` + bring-up smoke

**Files:**
- Modify: `scripts/wedge-proof-native.sh`

- [x] **Step 1: Add `cmd_seed_localstorage`**

Insert above the `case` dispatcher. Method proven by the campaign (`leak-investigation.md:54`): write `keepance_recent_workspaces` (+ the two onboarding-complete keys) as UTF-16-LE BLOBs into the WebKit localStorage sqlite for the `http://localhost:5173` origin. The storage file exists only after one boot, so the flow is: `launch` (background) → wait for the window → `down` → `seed-localstorage` → `launch` again.

```bash
# Seed onboarding-complete + the recent-workspace entry into the webview's
# localStorage so the app boots straight to a selector with a clickable
# Recent entry (the GTK chooser is unusable headless). WebKit stores
# localStorage per-origin as an sqlite3 ItemTable with UTF-16-LE values;
# keys verified in src: keepance_recent_workspaces (workspaceStore.ts:155),
# keepance_onboarding_complete (FirstRunWizard), keepance_onboarding_completed_at
# (useOnboarding.ts:9). RecentWorkspace shape: {path,name,lastOpened}
# (types/workspace.ts:30).
cmd_seed_localstorage() {
  local db
  db=$(find "$PROFILE" -name '*localhost*5173*' -name '*.sqlite3' 2>/dev/null | head -1)
  [ -z "$db" ] && db=$(find "$PROFILE" -ipath '*localstorage*' -name '*.sqlite3' 2>/dev/null | head -1)
  if [ -z "$db" ]; then
    echo "FAIL: no localStorage sqlite under $PROFILE — boot the app once first (launch, wait for the window, down)"
    find "$PROFILE" -name '*.sqlite3' 2>/dev/null || true
    exit 1
  fi
  WS="$WS" python3 - "$db" <<'PY'
import json, os, sqlite3, sys
from datetime import datetime, timezone

db = sys.argv[1]
ws = os.environ["WS"]
recent = json.dumps([{
    "path": ws,
    "name": os.path.basename(ws),
    "lastOpened": datetime.now(timezone.utc).isoformat(),
}])
now = datetime.now(timezone.utc).isoformat()

conn = sqlite3.connect(db)
conn.execute(
    "CREATE TABLE IF NOT EXISTS ItemTable "
    "(key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB NOT NULL ON CONFLICT FAIL)"
)
for key, value in [
    ("keepance_recent_workspaces", recent),
    ("keepance_onboarding_complete", "true"),
    ("keepance_onboarding_completed_at", now),
]:
    conn.execute(
        "INSERT OR REPLACE INTO ItemTable (key, value) VALUES (?, ?)",
        (key, value.encode("utf-16-le")),
    )
conn.commit()
print(f"seeded {db}")
for row in conn.execute("SELECT key, length(value) FROM ItemTable"):
    print("  ", row)
PY
}
```

- [x] **Step 2: Add `cmd_assert`**

```bash
# Disk-truth assertions + artifact collection after the attended pass.
# PASS/FAIL rubric for the contradiction .docx (LLM wording varies, so we
# match the planted FACTS, tolerantly — README.md:43-47):
#   C1: /personal\s+e-?mail/i
#   C2: /October\s+17/ AND /October\s+10/
#   C3: /four[-\s]?weeks?/i AND /eight\s*(\(8\)\s*)?[-\s]?weeks?/i
# PASS requires ALL clusters. Up to 2 attended attempts are allowed (LLM
# nondeterminism); two misses = a logged finding (diagnose with the run
# record's retrievedChunks/verified counts: feed problem vs model quality),
# never a weakened rubric.
cmd_assert() {
  say "vector store populated?"
  local frags
  frags=$(find "$WS/.keepance/vectors/chunks.lance" -name '*.lance' -not -path '*_versions*' 2>/dev/null | wc -l)
  echo "data fragments: $frags"
  [ "$frags" -gt 0 ] || { echo "FAIL: chunks.lance has no data fragments (index never populated — F-415 would still be open)"; exit 1; }

  say "app log shows real indexing activity"
  grep -c -i 'commit' "$APP_LOG" || echo "WARN: no commit lines in app log"

  say "contradiction-finder .docx rubric"
  local docx
  docx=$(find "$WS" -name 'Deposition Contradiction Analysis.docx' | head -1)
  [ -n "$docx" ] || { echo "FAIL: no 'Deposition Contradiction Analysis.docx' under $WS"; exit 1; }
  echo "found: $docx"
  cp "$docx" "$ART/output/"
  python3 - "$docx" <<'PY'
import re, sys, zipfile

xml = zipfile.ZipFile(sys.argv[1]).read("word/document.xml").decode("utf-8", "replace")
text = re.sub(r"<[^>]+>", " ", xml)
open(sys.argv[1] + ".extracted.txt", "w").write(text)

clusters = {
    "C1 personal-email forwarding": bool(re.search(r"personal\s+e-?mail", text, re.I)),
    "C2 October 17 side":           bool(re.search(r"October\s+17", text)),
    "C2 October 10 side":           bool(re.search(r"October\s+10", text)),
    "C3 four-week side":            bool(re.search(r"four[-\s]?weeks?", text, re.I)),
    "C3 eight-week side":           bool(re.search(r"eight\s*(\(8\)\s*)?[-\s]?weeks?", text, re.I)),
}
for name, ok in clusters.items():
    print(f"  {'PASS' if ok else 'MISS'}  {name}")
if all(clusters.values()):
    print("RUBRIC: PASS — all three planted contradictions mentioned by fact")
else:
    print("RUBRIC: FAIL — missing clusters above (diagnose: run-record retrievedChunks vs LLM quality)")
    sys.exit(1)
PY
  cp "$docx.extracted.txt" "$ART/output/" 2>/dev/null || true

  say "artifacts banked"
  ls -R "$ART" | head -40
}
```

- [x] **Step 3: Bring-up smoke (no UI driving yet)**

```bash
cd ~/keepance && bash -n scripts/wedge-proof-native.sh
./scripts/wedge-proof-native.sh preflight
./scripts/wedge-proof-native.sh up
./scripts/wedge-proof-native.sh launch   # run in background (it blocks)
sleep 20 && ./scripts/wedge-proof-native.sh shot smoke-boot
```

Expected: `smoke-boot.png` shows the app window (first-run wizard or selector — both fine for the smoke), and `logs/app.log` exists with no `vectors key:` errors yet. Then:

```bash
./scripts/wedge-proof-native.sh down
./scripts/wedge-proof-native.sh seed-localstorage
./scripts/wedge-proof-native.sh launch   # background again
sleep 20 && ./scripts/wedge-proof-native.sh shot smoke-seeded
./scripts/wedge-proof-native.sh down
```

Expected: `smoke-seeded.png` shows the workspace SELECTOR with the seeded `wedge-ws` Recent entry visible (onboarding skipped). If the wizard still shows, the localStorage keys/origin didn't take — inspect with `sqlite3 <db> 'SELECT key FROM ItemTable'` and fix the find-glob, not the app.

- [x] **Step 4: Commit (include the smoke shots)**

```bash
cd ~/keepance && git add scripts/wedge-proof-native.sh docs/quality/2026-06-11-wedge-proof/
git commit -m "feat(harness): VG-1 leg 3 — localStorage seeding, docx fact-rubric assert, bring-up smoke green"
```

---

### Task 7: Leg 3 — THE RUN: attended positive pass, Option B handoff, runbook, artifacts

**Files:**
- Create: `docs/quality/2026-06-11-wedge-proof/RUNBOOK.md`
- Create: `docs/quality/2026-06-11-wedge-proof/RESULTS.md`
- Artifacts into `docs/quality/2026-06-11-wedge-proof/{screenshots,logs,output}/`

This task is executed BY an agent driving xdotool + `shot` between steps (the campaign's proven method), with the script doing everything mechanical. Write `RUNBOOK.md` FIRST (it is the repeatable procedure — the deliverable that makes this "a harness, not a one-off"), then perform it.

- [x] **Step 1: Write `RUNBOOK.md`**

Contents (write it out fully; summary of required sections):

1. **Purpose + honesty boundaries** — leg 3 is the audit's real-machine bar (F-117/F-415/F-422); mail + live-audit stay on the Windows spot check (F-419/F-425); incidental audit captures are bonus evidence only.
2. **Bring-up** — `preflight` → `up` → `launch` (background) → first-boot wait → `down` → `seed-localstorage` → `launch` (background). Every wait is screenshot-verified with `shot`, never timed blind.
3. **The positive pass, step by step** (screenshot name in parentheses; take EVERY one):
   - Selector shows seeded Recent `wedge-ws` (`run-01-selector`). Click it (coordinates from the screenshot).
   - Workspace opens; `rag-progress-banner` appears; wait until the banner reports "Memory ready, indexed 4 files." (en.json `memory.rag-banner.ready_other`; the indexable set is exactly the 4 text files — extractor.rs:19) and the status bar shows the memory state (`run-02-indexed`). **Watch `logs/app.log` for `vectors key:` errors — any occurrence = the keychain bring-up failed; stop and fix the environment, not the app.**
   - Open the AI Assistant; create a local (Ollama llama3.2:3b) chat; egress indicator green (`run-03-local-chat`).
   - Toggle "Ask my workspace" ON; the "Include privileged" toggle appears (`run-04-toggles`).
   - Ask THE question (identical to leg 1's c2 query): `What deadline was Johnson given to submit his written response about the expense review?`
   - Cited answer renders with ≥1 citation chip (`run-05-cited-answer`). This single screenshot is the F-117 closure shot.
   - Click the citation chip → the deposition (or summary) opens at the cited passage (`run-06-clickthrough`). Chip `data-verified` should be `true` — verification runs live against the local store on the native build.
   - Workflows → Deposition Contradiction Finder → Run (`run-07-start-dialog` — expect "runs on your local AI model", $0).
   - Interview answers (EXACTLY the leg-1 `FINDER_QUERY` inputs — the runbook lists them verbatim): Matter name `Johnson v. Nexus Dynamics Corp.`; Witness `Marcus Johnson`; Date `May 28, 2026`; Key claims = the three contradiction topics; Excerpts = the three CLEAN Q/A passages (no `[CONTRADICTION-N]` markers — never hand the LLM the answer through the interview); Prior statements: empty (`run-08-interview`).
   - Run to completion; `workflow-execution-tab` shows `workflow-analyze-summary` + `workflow-file-link-Deposition Contradiction Analysis.docx` + `workflow-verification-banner` (`run-09-run-complete`).
   - `./scripts/wedge-proof-native.sh assert` → rubric PASS (paste its output into RESULTS.md).
4. **Option B ready-handoff run** (the deferred Option B verification item): `down` → `launch --fresh-model` → `model-download-card` visible with live progress (`run-10-download-card`) → card disappears at Ready and the `rag-progress-banner` takes over with no dead gap (`run-11-handoff`) → indexing completes again. Network stays on for this run only.
5. **Contingencies (scope discipline — log, don't fix):**
   - Interview form fails to render in the main pane WITHOUT HMR interference (the quiesced preview rules that out): that re-reproduces campaign F-422's ambiguity as a REAL bug → log it as F-501 in RESULTS.md, stop the finder item, finish the chat half. The harness surfacing it is the harness working.
   - Rubric FAIL twice with healthy retrieval (run record `retrievedChunks` ≥ 6-ish and both sources present): local-model quality finding (llama3.2:3b floor) → log F-502, optionally re-run once with a larger local model (`ollama pull llama3.1:8b`, ~5 GB — check `free -h` first) and record BOTH outcomes. The vision's local-model wedge claim is only as strong as this result; honesty over green.
   - `vectors key:` in the app log: keychain env didn't reach the app — re-run `launch` and check the `keyring OK` probe line; never patch the app.
   - Memory kill (cgroup OOM): check `rss.csv`, re-run with nothing else heavy on the box; the 3G cap stays (it is the campaign-calibrated bound).
6. **Artifact manifest** — what must exist in `screenshots/ logs/ output/` for the run to count, and the RESULTS.md template (per-item PASS/FAIL + finding rows `F-5xx | severity | what | evidence`).

- [x] **Step 2: Execute the runbook** (attended; background `launch`; `shot` at every step; bank everything)

- [x] **Step 3: Write `RESULTS.md`** — per-item table (indexing populated, cited answer, verify+click-through, finder run, rubric output verbatim, Option B handoff), every finding as F-5xx, and the two explicit out-of-scope lines (mail, live-audit) pointing at the Windows spot check.

- [x] **Step 4: Run `assert` one final time and commit everything**

```bash
cd ~/keepance && ./scripts/wedge-proof-native.sh assert
./scripts/wedge-proof-native.sh down
git add docs/quality/2026-06-11-wedge-proof/
git commit -m "docs(quality): VG-1 leg 3 executed — wedge positive pass artifacts, contradiction rubric result, Option B handoff"
```

Expected at the end of this task: `RESULTS.md` shows the rubric verdict, `output/` holds the real `.docx` + extracted text, `screenshots/` holds run-01…run-11. If any item is FAIL, the commit still lands (artifacts are the point); the findings go to Task 8's ledger and the fix wave.

---

### Task 8: Closure bookkeeping — coverage ledger, strategy tick, CHANGELOG

**Files:**
- Modify: `docs/quality/2026-06-10-v3-usability-campaign/coverage-ledger.md`
- Modify: `docs/strategy/2026-06-10-vision-gap-closure-plan.md`
- Modify: `CHANGELOG.md`

- [x] **Step 1: Add the wedge-proof section to the coverage ledger**

Append a new section (match the ledger's column format exactly — `ID | Surface | Where | Covered by | Result | Findings`):

```markdown
## W. Wedge proof (VG-1 harness, 2026-06-11)

| ID | Surface | Where | Covered by | Result | Findings |
|----|---------|-------|------------|--------|----------|
| W-001 | Planted-contradiction passages retrievable + citations verify (both sides, C1-C3) | rag store/embedder/chunker | src-tauri/tests/rag_deposition_contradictions.rs | <result> | |
| W-002 | Matter B (Acme) isolation under the same queries | rag store prefilter | src-tauri/tests/rag_deposition_contradictions.rs | <result> | |
| W-003 | Contradiction-finder retrieval feed sufficient at its own topK 12 | DepositionContradictionFinder.ts:64,129 | src-tauri/tests/rag_deposition_contradictions.rs | <result> | |
| W-004 | Citation chips (verified/unverified), sources accordion, scope chip, click-through (UI glue) | AIChatViewer.tsx | tests/e2e/wedge-proof.spec.ts | <result> | browser = wiring only, never retrieval |
| W-005 | Refusal-not-fabrication with Ask-my-workspace ON, no rag (browser) | AIChatViewer.tsx:1025 | tests/e2e/wedge-proof.spec.ts | <result> | |
| W-006 | xlsx open→edit→save→reopen, =SUM(B2:B7) survives | SpreadsheetViewer + spreadsheet-io | tests/e2e/wedge-proof.spec.ts | <result> | |
| W-007 | exhibit-deck.pptx parses + renders real slide text (fallback outline) | PresentationViewer.tsx | tests/e2e/wedge-proof.spec.ts | <result> | no pptx editing exists; export side = pptx-export.test.ts |
| W-008 | REAL MACHINE: index populates on a fresh profile (closes F-415's observation) | full app, Xvfb | scripts/wedge-proof-native.sh + RESULTS.md | <result> | needed headless Secret Service (vectors key, rag/mod.rs:446) |
| W-009 | REAL MACHINE: cited answer + verify + click-through (closes F-117) | full app | wedge-proof RUNBOOK run-05/06 | <result> | |
| W-010 | REAL MACHINE: contradiction finder full run → .docx mentions all 3 planted facts (closes F-422/F-126 buildable half) | full app + Ollama | wedge-proof assert rubric | <result> | |
| W-011 | Option B ready handoff: download card → rag banner, fresh profile | ModelDownloadCard/RagProgressBanner | wedge-proof RUNBOOK run-10/11 | <result> | |
```

Fill `<result>` cells from the actual Task 2/4/7 outcomes (`pass` or the F-5xx finding id). Also update the three existing ledger/native rows that reference F-117, F-415, F-422 with a pointer: `→ see W. Wedge proof (2026-06-11)`.

- [x] **Step 2: Tick VG-1 in the gap-closure plan**

In `docs/strategy/2026-06-10-vision-gap-closure-plan.md` §2 ("Already closed") add one row:

```markdown
| #1/#5 wedge never observed end to end (F-117/F-415/F-422) | VG-1 three-leg harness executed 2026-06-11: Rust retrieval truth + browser UI glue + real-machine positive pass with artifacts at `docs/quality/2026-06-11-wedge-proof/`. Remaining: Jameson's Windows spot check (VG-7 item 1) |
```

(Adjust wording to the actual result; if leg 3 logged findings, say "executed, N findings open" instead of overclaiming.)

- [x] **Step 3: CHANGELOG**

Under `## [Unreleased]`:

```markdown
### Added
- **Wedge-proof harness (VG-1).** Three repeatable proof legs for the core promise (ask → cited answer → verify → click-through → contradiction finder completes): a Rust retrieval-truth suite over the real Johnson fixtures (`src-tauri/tests/rag_deposition_contradictions.rs`), a browser UI-wiring spec (`tests/e2e/wedge-proof.spec.ts` — wiring only; browser has no rag), and a scripted real-machine pass (`scripts/wedge-proof-native.sh` + `docs/quality/2026-06-11-wedge-proof/RUNBOOK.md`) with banked screenshots, logs, and the contradiction-finder's `.docx` output checked against a fact rubric.
```

- [x] **Step 4: Commit**

```bash
cd ~/keepance && git add docs/quality/2026-06-10-v3-usability-campaign/coverage-ledger.md docs/strategy/2026-06-10-vision-gap-closure-plan.md CHANGELOG.md
git commit -m "docs: VG-1 wedge-proof closure — ledger W-rows, strategy tick, changelog"
```

---

## How this closes F-117 / F-415 / F-422 — and what stays on Jameson

- **F-415 (index never populated on a real machine):** leg 3's first milestone is exactly this observation — fresh profile, pre-seeded model (Option B's gate honored), indexing completes, `chunks.lance` has data fragments, the banner reports "Memory ready, indexed 4 files." The `assert` subcommand makes it a disk-checked fact, not a screenshot impression. The harness also retires the hidden blocker the campaign missed: headless indexing requires a Secret Service (`vectors key`, `rag/mod.rs:446`), now part of the environment bring-up.
- **F-117 (AI-answer citation chips over a populated index, never observed):** leg 2 proves every render/click wire with seeded truth-shaped data (chips, verified/unverified states, accordion, scope chip, click-through); leg 3's run-05/06 screenshots show the SAME surfaces live over the real index with live verification. Leg 1 underwrites the part no screenshot can: the citations the system produces are content-addressed, reproducible, and verify against the store.
- **F-422 (contradiction finder never completed; F-126's buildable half):** leg 1 proves the finder's own retrieval query at its own topK 12 feeds both sides of all three planted contradictions (the necessary condition); leg 3 runs the real workflow on the real binary with the real local model to a real `.docx`, judged by a tolerant FACT rubric (personal email / Oct 17 vs Oct 10 / four vs eight weeks) that survives LLM phrasing variance — with an explicit two-attempt rule and a diagnose-don't-tune contingency. Attorney validation of output QUALITY remains VG-7 item 3 (cannot be coded).
- **The two VG-1 micro-items:** the xlsx open→edit→save→reopen formula assertion and the pptx coverage land in leg 2 (with the honest correction that no pptx editing exists — render + the existing build→extract unit round-trip is the product's actual surface). The deferred Option B ready-handoff is leg 3's `--fresh-model` run.
- **Stays on Jameson's Windows spot check (VG-7 item 1, unchanged):** icons/installer feel, typing in a new Word doc, upload-with-spaces via a real file dialog, "Open on Desktop" (F-305), live TLS mail import on his real mailbox (F-419), live audit-event capture on a keychain-bearing desktop (F-425), and one matter-scoped search returning a clickable citation on real Windows — now meaningful because Option B removed the first-run stall and this harness proves the path he is spot-checking.

## Self-review notes

- **Spec coverage vs the gap-closure plan's VG-1 verify list:** harness green on the rig (Tasks 2/4/7), matter-isolation assertion in the same harness (leg 1 isolation tests + leg 3 scope chip), repeatable-not-one-off (the spec/tests run in any future campaign; the script + runbook re-run on demand), xlsx/pptx round-trip (Task 4, with the honest pptx correction), live-audit-capture left to Windows (stated in three places), Option B handoff verified (Task 7 step 4).
- **Honesty boundaries are stated where they bind:** leg 1 file header (retrieval truth ≠ LLM judgment), leg 2 spec header (wiring ≠ retrieval), leg 3 script header + runbook (out-of-scope mail/audit; fixture-marker caveat; local-model quality contingency).
- **Scope discipline is enforced structurally:** no product file in the file map; the "STOP — that is a finding" rule in the header; rubric failures route to F-5xx rows and the fix wave, with the run-record `retrievedChunks` as the diagnostic fork.
- **Known judgment calls for implementers:** leg 2 numeric formatting of computed cells (assert what renders); `fallback-slide-{n}` numbering; the localStorage sqlite glob (find-based with a verifying SELECT, never a hardcoded path); coordinates for xdotool clicks come from each run's own screenshots (never reused blind); `FINDER_QUERY` and the runbook interview answers must stay character-identical (each cites the other).
- **Corrections this plan makes to its inputs (verified against the tree):** `matters-panel` → `matters-sidebar-panel`; `workflow-run-{runId}` → `workflow-execution-tab`/`workflow-analyze-summary`/`workflow-file-link-{name}`; "pptx edit-persists" → no pptx editing exists (render + unit build→extract instead); plus the new keychain discovery (headless Secret Service required for ANY live indexing on Linux) that the scouting and campaign both missed.
