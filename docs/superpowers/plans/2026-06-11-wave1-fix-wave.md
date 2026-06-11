# Wave 1 Fix Wave — F-5xx Register + Original Wave 1 Items — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. One subagent per task; tasks are ordered by priority and are independent unless a step says otherwise.

**Goal:** Close every finding in the wedge-proof F-5xx register (`docs/quality/2026-06-11-wedge-proof/RESULTS.md` §B) plus the original Wave 1 items from the vision gap closure plan (VG-3b, VG-4a, VG-5a–d, VG-6a, VG-6d-v1), then prove the wave with a leg-3 runbook re-run.

**Branch:** work directly on `keepance-3.0` (same convention as the Option B plan).

**Inputs (provenance):**
- `docs/quality/2026-06-11-wedge-proof/RESULTS.md` — the F-501..F-509 register. Every diagnosis was review-verified; the code sites were re-verified against the tree while writing this plan (corrections table below).
- `docs/strategy/2026-06-10-vision-gap-closure-plan.md` — Wave 1 scope (§4 sequencing). VG-3a (planted-contradiction run) is DONE via VG-1; only VG-3b (honest fallback) remains from VG-3 in this wave.
- `tests/e2e/wedge-proof.spec.ts` — carries the two expected-fail tripwires (`:238` scroll-to-passage, `:322` xlsx round-trip). Flipping them to normal passing assertions is the done-signal for F-504 and F-506.

## Rules (read before any task)

1. **Tripwire flipping is the done-signal for F-504 and F-506.** Their tasks are not complete until the corresponding `test.fail()` is REMOVED from `tests/e2e/wedge-proof.spec.ts` and the test passes as a normal assertion.
2. **The leg-3 runbook re-run is the final wave verification** (Task 14): re-run `docs/quality/2026-06-11-wedge-proof/RUNBOOK.md` with `huge-notes.md` re-enabled and the citation fixes in. Expected deltas are listed in Task 14.
3. **CHANGELOG:** consolidated `[Unreleased]` entries land in Task 14 (one bullet per fix, Keep-a-Changelog categories, file lists — match the existing entry style at the top of `CHANGELOG.md`).
4. **Voice rules for every user-facing string** (locales, website, docx output): NO em dashes (`tests/unit/i18n/en-json-snapshot.test.ts:125` enforces this on en.json), plain language, contractions fine, no "leverage/seamless/empower" words. New locale strings go into `en.json` AND hand-translated `es.json`/`de.json`, then locked: `node scripts/lock-translation.mjs <es|de> "<key>"` (run with no args first if the shape differs).
5. **TDD where a pure function is in play** (resolution logic, citation normalization, quote grounding, fingerprints, diff summaries): failing test first, then implementation. UI mounting steps can be implement-then-test.
6. **Scope guard:** F-507(a) (single-run rubric completeness at 8B) is a model-capability floor, not a code defect; this wave fixes only its (b) half (citation grounding) and observes (a) in the Task 14 re-run. Do not chase model quality.
7. Each task ends with `npx tsc --noEmit` (TS tasks) or `cargo test --lib` (Rust tasks) plus its own named tests, then a commit. Full gates run once in Task 14.

## Verified code-site corrections vs RESULTS.md

All RESULTS.md line cites were checked against the tree on 2026-06-11. Everything material holds; small precision notes:

| RESULTS.md cite | Verified location |
|---|---|
| F-503/claim 5 "workspaceCommand.ts" | `src/modules/memory/workspaceCommand.ts` (not `src/utils/`). `:114-138` (context block + grammar) and `:240-275` (verifyCitations body) are exact. |
| F-501 "`rag/mod.rs:343`, `batch_size: None`" | `mod.rs:343` is exactly `embedder::embed_documents(&texts).await?`. The `None` batch size lives inside `embedder.rs:147` (`model.embed(prefixed, None)`). |
| F-506 "`hasFormulas` stays false (:378)" | `spreadsheet-io.ts:377`. Serialize skip `if (!cell) continue` is `:432` as stated. Read options `:584-589` exact. |
| F-502 "App.tsx:2306-2329" | `resolveTemplateModel` call at `App.tsx:2321-2325`; cloud-only global default at `:2314-2320`; early returns (no folder/tab) at `:2352-2359`. `WorkflowExecutionTab.tsx:318` (needs-provider banner) and `TemplateModelSettings.tsx:54-57` (hardcoded Ollama list) + stale comment `:30-35` all exact. |
| F-504 "App.tsx:3518-3536" | Dispatch at `:3529-3535` inside `onOpenFileAtPath` starting `:3518`. Exact. The `paragraphIndex` is the **chunk index** (sequential, `chunker.rs:44-46`), not a literal paragraph number — the fix design below accounts for this. |
| F-505 "AIChatViewer.tsx:409 vs :300" | Exact. |
| F-508 "extractor.rs:19" | Exact (`TEXT_EXTENSIONS` `:19-22` includes `aichat`, `workflow`). `rag_index_file` already gates on `is_indexable` (`mod.rs:269-273`), so the extension removal covers the watcher path automatically. |
| F-509 | Confirmed: NO plain Ctrl+B handler exists anywhere (App.tsx keydown has only Ctrl+Shift+B = backlinks at `:3125`; the SSOT `useKeyboardShortcuts.ts:254` documents Ctrl+B; CommandPalette's `onToggleSidebar` handler is never passed by App). Sidebar collapse is internal state (`Sidebar.tsx:69`) and the root div (`:149-154`) has `w-64` but **no `shrink-0`**, so a wide non-shrinking workflow tab can crush it to zero width — the most plausible "hides the sidebar" mechanism. Task 6 starts with a reproduce step. |
| VG-5a (F-120) | **Half already shipped:** the persistent static Direct/Assured badge exists (`StatusBar.tsx:166-176`, render `:373`). The remaining gap is only the ACTIVE "sending" signal during real egress. Task 9 scopes to that. |
| VG-3b | Refinement: the engine does NOT refuse on empty retrieval (`legalAnalysis.ts:253` proceeds with an honest empty-context block). The refusal/failure cases are `analyzeDeps` missing (`WorkflowEngine.ts:382`) and `retrieve()` THROWING (propagates, step fails). The fallback work targets the throw + the empty case's missing honesty header. |
| F-507(b) | The sourceNumber→chunk mapping ALREADY exists (`legalAnalysis.ts:182-202` `resolveSource`); the module docstring (`:69-72`) promises a "quote match" recovery that was never implemented. Task 4 implements exactly that missing half. |

---

## File map

| File | Action | Task | Responsibility |
|---|---|---|---|
| `src-tauri/src/commands/rag/embedder.rs` | Modify | 1 | `EMBED_BATCH_SIZE` + `embed_documents_batched` (bounded slices, cancel between slices) |
| `src-tauri/src/commands/rag/mod.rs` | Modify | 1, 6 | `index_one_file` batched embedding + cancel param; callers updated |
| `src-tauri/tests/rag_embed_memory.rs` | Create | 1 | bounded-memory integration test over huge-notes.md (`#[ignore]`) |
| `scripts/wedge-proof-native.sh` | Modify | 1 | re-enable huge-notes.md (remove Task-5 exclusion, expected count 3→4) |
| `src/utils/spreadsheet-io.ts` | Modify | 2 | `sheetStubs: true` + stub-cell handling in `cellToSheetCell` |
| `tests/unit/spreadsheet-io.test.ts` | Modify | 2 | uncached-formula fixture tests |
| `tests/e2e/wedge-proof.spec.ts` | Modify | 2, 5 | flip both tripwires to normal assertions |
| `src/modules/workflow/resolveTemplateModel.ts` | Modify | 3 | `localOnly` + `installedOllamaModels` in `resolveWorkflowProvider` |
| `src/App.tsx` | Modify | 3, 5, 6 | local-only wiring, scroll-event snippet + pending slot, Ctrl+B, controlled sidebar |
| `src/components/workflow/WorkflowPanel.tsx` | Modify | 3 | provider-error banner surface |
| `src/components/settings/TemplateModelSettings.tsx` | Modify | 3 | live Ollama tag list |
| `tests/unit/workflow/workflow-provider-resolution.test.ts` | Modify | 3 | local-only invariants |
| `src/modules/memory/workspaceCommand.ts` | Modify | 4 | `normalizeNumericCitations` |
| `src/components/ai/AIChatViewer.tsx` | Modify | 4, 5, 9 | normalize-before-verify; snippet plumbing; accordion testid; privilege explainer mount |
| `src/modules/workflow/legalAnalysis.ts` | Modify | 4, 7 | quote-grounding fallback; retrieval-unavailable fallback |
| `tests/unit/workspace-command.test.ts` | Modify | 4 | normalization tests |
| `tests/unit/legal-analysis-grounding.test.ts` | Create | 4, 7 | grounding + fallback tests |
| `src/utils/scrollToParagraph.ts` | Create | 5 | pending-scroll slot (mount race) |
| `src/components/editor/MarkdownEditor.tsx` | Modify | 5 | `keepance:scroll-to-paragraph` listener (scroll + highlight) |
| `tests/unit/citation-navigation.test.tsx` | Modify | 5 | snippet plumbing assertions |
| `src-tauri/src/commands/rag/extractor.rs` | Modify | 6 | drop `aichat`/`workflow` from TEXT_EXTENSIONS |
| `src-tauri/src/commands/rag/store.rs` | Modify | 6 | `INDEX_VERSION` 5→6 (one-time clean re-index) |
| `src/components/layout/Sidebar.tsx` | Modify | 6 | `shrink-0` + controlled collapse props |
| `src/types/workflow.ts` | Modify | 7 | `AnalyzeStepConfig.pastedInputIds` |
| `src/modules/workflow/WorkflowEngine.ts` | Modify | 7 | thread retrieval note into docx meta |
| `src/utils/docx-io.ts` | Modify | 7 | `retrievalNote` header line in contradictions docx |
| `src/modules/workflow/templates/legal/DepositionContradictionFinder.ts` | Modify | 7 | declare pasted-input ids |
| `src/components/media/DocxEditor.tsx` | Modify | 8 | PDF export LibreOffice detect-and-explain |
| `src/components/media/LibreOfficeHelpNotice.tsx` | Create | 8 | explanation panel with copyable link |
| `src/modules/privacy/egressActivity.ts` | Create | 9 | egress in-flight store + fetch instrumentation |
| `src/modules/models/fetchUtils.ts` | Modify | 9 | wrap returned fetch with the egress signal |
| `src/components/layout/StatusBar.tsx` | Modify | 9 | "Sending to your AI provider" pulse |
| `src/components/ai/PrivilegeExclusionExplainer.tsx` | Create | 9 | F-121 one-sentence explanation + see-it-work demo |
| `src/components/mail/EmailViewer.tsx` | Modify | 10 | per-message privilege control |
| `website/index.html` | Modify | 11 | Clio copy precision (line 511) |
| `src/modules/firm/matterKeyService.ts` | Modify | 12 | `eligibleDevices` refactor + fingerprint + auto-republish |
| `src/components/firm/FirmAdminConsole.tsx` | Modify | 12 | auto-republish poll |
| `tests/unit/firm/matterKeyDistribution.test.ts` | Modify | 12 | auto-republish tests |
| `src/components/onboarding/DiskEncryptionGuidance.tsx` | Create | 13 | OS-specific disk-encryption check guidance |
| `src/components/onboarding/FirstRunWizard.tsx` | Modify | 13 | mount guidance in the `data` step |
| `src/components/privacy/DataMapDialog.tsx` | Modify | 13 | disk-encryption data map row |
| `src/locales/{en,es,de}.json` | Modify | 3,4,5,8,9,10,12,13 | new strings (no em dashes; lock translations) |
| `CHANGELOG.md` | Modify | 14 | consolidated `[Unreleased]` entries |
| `docs/strategy/2026-06-10-vision-gap-closure-plan.md` | Modify | 14 | STATUS ticks for the wave items |
| `docs/quality/2026-06-11-wedge-proof/RESULTS.md` | Modify | 14 | fix-wave addendum after the re-run |

---

### Task 1: F-501 (P1) — bound embed memory; re-enable huge-notes.md

**Diagnosis (verified):** `index_one_file` (`mod.rs:324-357`) embeds ALL of a file's chunks through one `embed_documents` call (`:343`); `embed_documents` (`embedder.rs:139-153`) passes `None` so fastembed runs internal 256-sequence batches with unbounded per-call vector materialization. huge-notes.md (2,097,878 B ≈ 1,400 chunks) drove the cgroup 188 MB → >12 GiB. Fix: slice the per-file embed into batches of 32 with cancel checks between batches, keeping the once-per-activation latch and per-file progress events untouched (they live in the walk, which this change does not restructure).

**Files:** `src-tauri/src/commands/rag/embedder.rs`, `src-tauri/src/commands/rag/mod.rs`, create `src-tauri/tests/rag_embed_memory.rs`, `scripts/wedge-proof-native.sh`.

- [x] **Step 1: Add the batched embed helper to `embedder.rs`** (after `embed_documents`, before `cosine_distance_to_score`):

```rust
/// F-501 — bounded batch size for document embedding. One `embed_documents`
/// call materializes every output vector for its input at once (and
/// fastembed itself batches 256 sequences internally), so a single large
/// file could balloon past 12 GiB. 32 chunks ≈ 48 KiB of text per call
/// keeps the peak flat regardless of file size.
pub const EMBED_BATCH_SIZE: usize = 32;

/// Embed a (possibly large) chunk list in `EMBED_BATCH_SIZE` slices,
/// checking `cancel` between slices. Returns `Ok(None)` when cancelled so
/// the caller can skip the upsert cleanly (nothing partial is written; the
/// file simply re-indexes on the next pass).
pub async fn embed_documents_batched(
    docs: &[String],
    cancel: Option<&std::sync::atomic::AtomicBool>,
) -> Result<Option<Vec<Vec<f32>>>> {
    let mut out: Vec<Vec<f32>> = Vec::with_capacity(docs.len());
    for slice in docs.chunks(EMBED_BATCH_SIZE) {
        if let Some(flag) = cancel {
            if flag.load(std::sync::atomic::Ordering::SeqCst) {
                return Ok(None);
            }
        }
        out.extend(embed_documents(slice).await?);
    }
    Ok(Some(out))
}
```

- [x] **Step 2: Route `index_one_file` through it.** In `mod.rs`, change the signature (`:324`) to add `cancel: Option<&std::sync::atomic::AtomicBool>` as the last parameter, and replace `:342-345`:

```rust
    let texts: Vec<String> = chunks.iter().map(|c| c.text.clone()).collect();
    // F-501 — bounded slices; cancel honored between slices. `None` means
    // the user cancelled mid-file: write nothing (the walk's per-file cancel
    // check emits the Cancelled event on its next iteration).
    let Some(vectors) = embedder::embed_documents_batched(&texts, cancel).await? else {
        return Ok(());
    };
    let rows: Vec<(chunker::Chunk, Vec<f32>)> =
        chunks.into_iter().zip(vectors).collect();
```

Update the two call sites:
- Walk loop (`:501`): `index_one_file(&table, file, &matter, store::PRIVILEGE_NONE, &key, Some(cancel.as_ref())).await`
- `rag_index_file` (`:287`): pass `None` for cancel. **Do NOT pass the shared cancel flag here** — `rag_cancel_indexing` leaves the flag true until the next walk resets it, and a stale `true` would silently skip every watcher-triggered single-file index.

- [x] **Step 3: The bounded-memory integration test.** Create `src-tauri/tests/rag_embed_memory.rs`:

```rust
//! F-501 — bounded-memory embedding of a large file.
//!
//! The unbatched path OOM-killed the app at 3G/6G/12G caps on this exact
//! fixture (RESULTS.md F-501). This test embeds all of huge-notes.md's
//! chunks through the production batched path and asserts completion plus
//! (on Linux) a sane process peak RSS.
//!
//! Needs the e5-small cache (this rig: ~/.local/share/keepance/models/
//! e5-small — same prerequisite as rag_matter_scope.rs / leg 1). Heavy:
//! run explicitly with `-- --ignored`.

use keepance_lib::commands::rag::{chunker, embedder};

fn peak_rss_gib() -> Option<f64> {
    let status = std::fs::read_to_string("/proc/self/status").ok()?;
    let line = status.lines().find(|l| l.starts_with("VmHWM:"))?;
    let kb: f64 = line.split_whitespace().nth(1)?.parse().ok()?;
    Some(kb / (1024.0 * 1024.0))
}

#[tokio::test]
#[ignore]
async fn huge_file_embeds_under_bounded_memory() {
    let fixture = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../tests/fixtures/matter-corpus/huge-notes.md"
    );
    let text = std::fs::read_to_string(fixture).expect("huge-notes.md fixture");
    let chunks = chunker::chunk_text("huge-notes.md", &text);
    assert!(
        chunks.len() > 1_000,
        "fixture should chunk to >1000 chunks, got {}",
        chunks.len()
    );
    let texts: Vec<String> = chunks.iter().map(|c| c.text.clone()).collect();

    let vectors = embedder::embed_documents_batched(&texts, None)
        .await
        .expect("batched embed completes")
        .expect("not cancelled");
    assert_eq!(vectors.len(), texts.len());
    assert_eq!(vectors[0].len(), embedder::EMBEDDING_DIM);

    if let Some(peak) = peak_rss_gib() {
        // Old behavior blew past 12 GiB on this fixture. Model session +
        // 32-chunk slices should stay far below; 6 GiB is a generous tripwire.
        assert!(peak < 6.0, "peak RSS {peak:.2} GiB >= 6 GiB bound");
    }
}
```

Also add a fast cancel unit test inside `embedder.rs`'s `tests` module (no model needed — a pre-set cancel flag returns before any embed):

```rust
    #[tokio::test]
    async fn batched_embed_short_circuits_on_preset_cancel() {
        let cancel = std::sync::atomic::AtomicBool::new(true);
        let docs = vec!["never embedded".to_string()];
        let out = embed_documents_batched(&docs, Some(&cancel))
            .await
            .expect("no error path");
        assert!(out.is_none(), "cancelled embed must return None");
    }
```

- [x] **Step 4: Run**

```bash
cd ~/keepance/src-tauri && cargo test --lib 2>&1 | tail -5
cargo test --release --test rag_embed_memory -- --ignored --nocapture 2>&1 | tail -8
```

Expected: lib tests green (including the new cancel test); the ignored test prints `test huge_file_embeds_under_bounded_memory ... ok` (it takes a while — ~1,400 chunks embed for real). If it cannot find the model cache, verify `~/.local/share/keepance/models/e5-small` is populated (it is on this rig per leg 1).

- [x] **Step 5: Re-enable huge-notes.md in the native harness.** In `scripts/wedge-proof-native.sh`:
- Remove `--exclude huge-notes.md` from the rsync at `:176`.
- Update the comment block at `:175` and the header notes at `:35-36` (and the F-501 sizing comment near `:223`): huge-notes.md is back IN; the F-501 fix bounds the embed; expected fresh-workspace indexable count returns to **4**.
- Grep the script for any other `3`-file count assertions tied to the exclusion (`grep -n "huge-notes\|indexed 3\|count" scripts/wedge-proof-native.sh`) and restore them to 4 where they exist.

- [x] **Step 6: Commit**

```bash
cd ~/keepance && git add src-tauri/src/commands/rag/embedder.rs src-tauri/src/commands/rag/mod.rs src-tauri/tests/rag_embed_memory.rs scripts/wedge-proof-native.sh
git commit -m "fix(rag): F-501 bound embed memory — 32-chunk slices with cancel checks; huge-notes re-enabled in leg-3 harness"
```

---

### Task 2: F-506 (P1, data loss) — xlsx formula cells with empty cached values

**Diagnosis (verified):** `XLSX.read` options (`spreadsheet-io.ts:584-589`) lack `sheetStubs`, so openpyxl-style `<f>SUM(B2:B7)</f><v></v>` cells are dropped (`ws['B10'] === undefined`), `hasFormulas` (`:377`) never trips, totals paint empty, and `serializeXlsx` (`:432` `if (!cell) continue`) omits them on save — silent formula destruction. With `sheetStubs: true` the cell surfaces as `{t:'z', f:'SUM(B2:B7)'}` (probe-confirmed against the pinned SheetJS 0.20.3).

**Files:** `src/utils/spreadsheet-io.ts`, `tests/unit/spreadsheet-io.test.ts`, `tests/e2e/wedge-proof.spec.ts`.

- [x] **Step 1: Failing unit tests first.** Read `tests/unit/spreadsheet-io.test.ts` for the existing harness/import style, then add a describe block. The fixture is `tests/fixtures/matter-corpus/damages-model.xlsx` (real openpyxl output; B10 = row 9 col 1 = `=SUM(B2:B7)`, B11 = row 10 col 1 = `=SUM(B2:B8)`). Contract:

```ts
describe('F-506 — openpyxl formula cells with empty cached values', () => {
  // Build the same data-URL input the app feeds parseSpreadsheet.
  const fixtureDataUrl = (() => {
    const bytes = readFileSync(
      join(__dirname, '..', 'fixtures', 'matter-corpus', 'damages-model.xlsx'),
    );
    return `data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,${bytes.toString('base64')}`;
  })();

  it('keeps uncached formula cells, attaches the engine, and computes the totals', () => {
    const model = parseSpreadsheet(fixtureDataUrl, 'xlsx');
    const sheet = model.sheets[model.activeSheetIndex]!;
    const b10 = sheet.rows[9]?.[1];
    expect(b10?.formula).toBe('SUM(B2:B7)');
    expect(model.engine).toBeDefined();
    expect(b10?.display).toBe('355250');
  });

  it('round-trips the formulas through serialize -> reparse', () => {
    const model = parseSpreadsheet(fixtureDataUrl, 'xlsx');
    const bytes = serializeSpreadsheet(model, 'xlsx');
    const reparsed = parseSpreadsheet(bytesToDataUrl(bytes), 'xlsx'); // use the module's existing data-url helper if exported; otherwise inline base64
    const sheet = reparsed.sheets[reparsed.activeSheetIndex]!;
    expect(sheet.rows[9]?.[1]?.formula).toBe('SUM(B2:B7)');
    expect(sheet.rows[10]?.[1]?.formula).toBe('SUM(B2:B8)');
  });

  it('still drops genuinely blank stub cells (no formula)', () => {
    const model = parseSpreadsheet(fixtureDataUrl, 'xlsx');
    const sheet = model.sheets[model.activeSheetIndex]!;
    // Row 8 (index 8) is the blank spacer row in the fixture layout
    // (generate-fixtures.py:726-749); with sheetStubs it must STILL parse
    // as null cells, not `{display:''}` bloat.
    expect(sheet.rows[8]?.every((c) => c === null)).toBe(true);
  });
});
```

Adapt exact entry-point names to the module's exports (`parseSpreadsheet` / `serializeSpreadsheet` per `spreadsheet-io.ts:370/408`; check how existing tests build inputs). Run: `npx vitest run tests/unit/spreadsheet-io.test.ts` → the new tests FAIL (B10 undefined).

- [x] **Step 2: The fix.** In `parseXlsx` (`:584-589`) add the option:

```ts
  const workbook = XLSX.read(buffer, {
    type: 'array',
    cellDates: true,
    cellFormula: true,
    cellNF: true, // keep number-format strings so `w` is populated for typed cells
    // F-506: surface formula cells whose cached value is empty (openpyxl-
    // class writers emit `<f>…</f><v></v>`); without this SheetJS drops the
    // cell entirely, the formula never renders, and a save destroys it.
    sheetStubs: true,
  });
```

And in `cellToSheetCell` (`:660`), immediately after the `if (!cell) return null;` guard:

```ts
  // F-506: with `sheetStubs: true`, blank cells arrive as `{t:'z'}` stubs.
  // A stub WITH a formula is a real formula cell whose author cached no
  // value — keep it so `hasFormulas` trips and the engine computes it live.
  // A stub WITHOUT a formula is genuinely blank — drop it so the model and
  // serializeXlsx don't bloat with empty cells.
  if (cell.t === 'z' && !cell.f) return null;
```

No serializer change is needed: `sheetCellToXlsxCell` (`:478-501`) already writes `f` plus the engine-computed `display` as the cached value for formula cells, and the engine overlay (`:376-393`) computes `display` once `hasFormulas` trips.

- [x] **Step 3: Unit tests green**

```bash
cd ~/keepance && npx vitest run tests/unit/spreadsheet-io.test.ts 2>&1 | tail -5
```

- [x] **Step 4: Flip the tripwire.** In `tests/e2e/wedge-proof.spec.ts:322-425`: delete the `test.fail(true, …)` call, rename the test to `'xlsx round-trip: openpyxl formula cells render, recompute, and survive edit + save (F-506 fixed)'`, and rewrite the FINDING comment block to past tense ("Fixed in the Wave 1 fix wave: `sheetStubs: true` + stub handling in spreadsheet-io.ts"). Keep every assertion at full strength.

```bash
npx playwright test tests/e2e/wedge-proof.spec.ts --project=chromium 2>&1 | tail -8
```

Expected: the xlsx test now PASSES as a normal test; the scroll-to-passage tripwire still expected-fails (Task 5 owns it); everything else green.

- [x] **Step 5: Keep the adjacent suite green**

```bash
npx playwright test tests/e2e/spreadsheet-improvements.spec.ts --project=chromium 2>&1 | tail -5
```

(That suite's test.xlsx is SheetJS-authored with cached values; `sheetStubs` must not regress it. If a test there starts seeing extra blank cells, the Step 2 stub-drop guard is wrong — fix the guard, not the test.)

- [x] **Step 6: Typecheck + commit**

```bash
cd ~/keepance && npx tsc --noEmit
git add src/utils/spreadsheet-io.ts tests/unit/spreadsheet-io.test.ts tests/e2e/wedge-proof.spec.ts
git commit -m "fix(spreadsheet): F-506 sheetStubs — uncached formula cells render, compute, and survive saves; xlsx tripwire flipped green"
```

---

### Task 3: F-502 (P1) — local-only workflows resolve to Ollama; blocked runs get a visible surface; live model list

**Diagnosis (verified):** `handleStartWorkflow` never consults `confidentialityMode`: the global default is cloud-only (`App.tsx:2314-2320`, falls back to `'claude'` with no keys), `resolveWorkflowProvider` then returns `needs-provider`, and the handler returns at `:2352-2355` BEFORE creating the workflow folder/tab — so the banner in `WorkflowExecutionTab.tsx:318` has no surface. The override UI's Ollama list is hardcoded (`TemplateModelSettings.tsx:54-57`).

**Design decisions (locked here):**
- Extend `resolveWorkflowProvider` (the v3.1 pure function) — do not fork it. Two new REQUIRED inputs: `localOnly: boolean`, `installedOllamaModels: string[]`. New invariant: `localOnly` NEVER yields `'cloud'` or `'mock'` regardless of keys/testMode.
- The blocked-run surface goes in **WorkflowPanel** (where the user just clicked Run), reusing the existing `workflow.execution.needs-provider-*` / `ollama-unreachable-*` locale keys. This honors the v3.1 "no empty folder litter on blocked runs" decision (the early return stays); the WorkflowExecutionTab banner remains for re-opened tabs.
- "The configured Ollama model" in local-only mode = the template pin/override when it names an ollama model, else the FIRST installed model from `detectOllama()` (mirrors the chat surface, `AIAssistantPane.tsx:161-170`), else `OLLAMA_DEFAULT_MODEL` at construction (already the fallback at `App.tsx:2429`).

- [x] **Step 1: Failing tests.** Extend `tests/unit/workflow/workflow-provider-resolution.test.ts` (read its input-builder pattern first; add `localOnly: false, installedOllamaModels: []` to the existing builder so current cases keep compiling). New cases:

```ts
describe('F-502 — local-only mode', () => {
  it('resolves a cloud-pinned template to ollama in local-only mode (never cloud, even with keys)', () => {
    const r = resolveWorkflowProvider(makeInput({
      pickedProvider: 'claude', pickedModel: 'claude-sonnet-4-6',
      anthropicKey: 'sk-real', localOnly: true,
      ollamaReachable: true, installedOllamaModels: ['llama3.2:3b', 'qwen2.5:7b'],
    }));
    expect(r).toEqual({ kind: 'ollama', model: 'llama3.2:3b' });
  });

  it('keeps an explicit ollama pin in local-only mode', () => {
    const r = resolveWorkflowProvider(makeInput({
      pickedProvider: 'ollama', pickedModel: 'qwen2.5:7b',
      localOnly: true, ollamaReachable: true,
      installedOllamaModels: ['llama3.2:3b', 'qwen2.5:7b'],
    }));
    expect(r).toEqual({ kind: 'ollama', model: 'qwen2.5:7b' });
  });

  it('local-only + ollama unreachable is ollama-unreachable, never needs-provider/cloud/mock', () => {
    const r = resolveWorkflowProvider(makeInput({
      pickedProvider: 'claude', anthropicKey: 'sk-real',
      localOnly: true, ollamaReachable: false, isTestMode: true,
    }));
    expect(r).toEqual({ kind: 'ollama-unreachable' });
  });

  it('local-only with no installed models still resolves to ollama with model undefined (constructor default applies)', () => {
    const r = resolveWorkflowProvider(makeInput({
      pickedProvider: 'claude', localOnly: true,
      ollamaReachable: true, installedOllamaModels: [],
    }));
    expect(r).toEqual({ kind: 'ollama', model: undefined });
  });
});
```

- [x] **Step 2: Implement in `resolveTemplateModel.ts`.** Add the two fields to `ResolveWorkflowProviderInput` (documented), and insert this as the FIRST branch of `resolveWorkflowProvider` (before the existing ollama branch):

```ts
  // F-502 — Local-only confidentiality mode: workflows run on Ollama, full
  // stop. A cloud pin/default is overridden to the first installed local
  // model (the chat surface's behavior); an explicit ollama pin keeps its
  // model. NEVER 'cloud' and NEVER 'mock' in this mode — the mode is a
  // confidentiality promise, not a preference.
  if (localOnly) {
    if (!ollamaReachable) {
      return { kind: 'ollama-unreachable' };
    }
    const model =
      pickedProvider === 'ollama' && pickedModel
        ? pickedModel
        : installedOllamaModels[0];
    return { kind: 'ollama', model };
  }
```

(`installedOllamaModels[0]` is `undefined` for an empty list — matches the declared `model: string | undefined`.) Update the doc comment's invariants list. Run the test file → green.

- [x] **Step 3: Wire `App.tsx` `handleStartWorkflow`.** Around `:2330-2348`:
- `const localOnly = modeRestrictsToLocal(getConfidentialityMode());` (import both from `@/modules/privacy/egress` / `@/hooks/useConfidentialityMode` — `getConfidentialityMode` is the non-reactive read, correct inside a handler).
- Probe condition becomes `if (pickedProvider === 'ollama' || localOnly)`; capture `ollamaStatus.models` too:

```ts
      let ollamaReachable = false;
      let installedOllamaModels: string[] = [];
      if (pickedProvider === 'ollama' || localOnly) {
        const ollamaStatus = await detectOllama();
        ollamaReachable = ollamaStatus.reachable;
        installedOllamaModels = ollamaStatus.models;
      }
```

- Pass `localOnly` and `installedOllamaModels` into `resolveWorkflowProvider`.
- Confirm `setWorkflowProviderError(null)` runs when resolution SUCCEEDS (grep where it is currently cleared; if a successful run never clears a stale error, add the clear right after the two early-return blocks at `:2356-2359`).

- [x] **Step 4: The visible blocked-run surface.** `WorkflowPanel.tsx`: add to `WorkflowPanelProps` (`:62-73`):

```ts
  /** F-502 — when set, the last Run click was blocked before any folder/tab
   *  was created. Rendered as a banner at the top of the panel so the click
   *  never silently does nothing. */
  providerError?: 'needs-provider' | 'ollama-unreachable' | null;
  /** Open Settings > AI (used by the banner action). */
  onOpenSettings?: () => void;
```

Render at the top of the panel's root (read the component's JSX root first; place above the template list):

```tsx
      {providerError && (
        <div
          data-testid="workflow-provider-error-banner"
          className="m-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm"
          role="alert"
        >
          <p className="font-medium">
            {t(
              providerError === 'ollama-unreachable'
                ? 'workflow.execution.ollama-unreachable-title'
                : 'workflow.execution.needs-provider-title',
            )}
          </p>
          <p className="mt-1 text-muted-foreground">
            {t(
              providerError === 'ollama-unreachable'
                ? 'workflow.execution.ollama-unreachable-body'
                : 'workflow.execution.needs-provider-body',
            )}
          </p>
          {onOpenSettings && providerError === 'needs-provider' && (
            <Button size="sm" variant="outline" className="mt-2" onClick={onOpenSettings}>
              {t('workflow.execution.needs-provider-action')}
            </Button>
          )}
        </div>
      )}
```

In `App.tsx` (`:3430-3448`) pass `providerError={workflowProviderError}` and `onOpenSettings={() => openSettings('ai')}` to `<WorkflowPanel>`. No new locale keys needed (reuses `en.json:374-379`).

- [x] **Step 5: Live Ollama list in the override UI.** In `TemplateModelSettings.tsx`: add a detect-on-mount effect (mirror `AIAssistantPane.tsx:161-180`):

```ts
  // F-502 sub-finding — the Ollama dropdown now reflects what is actually
  // installed (detectOllama, same source as the chat picker) instead of a
  // hardcoded pair that may not exist on this machine. Falls back to the
  // static pair when the daemon is unreachable so the control stays usable.
  const [liveOllamaModels, setLiveOllamaModels] = useState<string[]>([]);
  useEffect(() => {
    let cancelled = false;
    void detectOllama().then((res) => {
      if (!cancelled && res.reachable) setLiveOllamaModels(res.models);
    });
    return () => { cancelled = true; };
  }, []);
```

Compute `modelOptions` for the ollama provider from `liveOllamaModels.map((m) => ({ value: m, label: formatOllamaDisplayName(m) }))` when non-empty, else the existing static pair. Import `detectOllama, formatOllamaDisplayName` from `@/modules/models/OllamaProvider`. Fix the stale comment at `:30-35` (there is no free-text "Other" control; say what the code now does). Keep `firstModelFor` consistent (it must use the live list for ollama).

- [x] **Step 6: Verify + commit**

```bash
cd ~/keepance && npx vitest run tests/unit/workflow/workflow-template-model.test.ts tests/unit/workflow/workflow-provider-resolution.test.ts 2>&1 | tail -5
npx tsc --noEmit
git add src/modules/workflow/resolveTemplateModel.ts src/App.tsx src/components/workflow/WorkflowPanel.tsx src/components/settings/TemplateModelSettings.tsx tests/unit/workflow/workflow-provider-resolution.test.ts
git commit -m "fix(workflow): F-502 local-only mode resolves workflows to Ollama; blocked runs surface in the panel; live model list in overrides"
```

(Note: `tests/unit/workflow-template-model.test.ts` lives at the unit root — adjust the path if the glob misses; run `npx vitest run tests/unit 2>&1 | tail -3` if unsure.)

---

### Task 4: F-503 + F-507(b) (P2) — deterministic citation grounding on the local tier

Two halves, both deterministic post-processing (no model dependence, no prompt changes — the cloud tier's working grammar stays untouched).

**Files:** `src/modules/memory/workspaceCommand.ts`, `src/components/ai/AIChatViewer.tsx`, `src/modules/workflow/legalAnalysis.ts`, `tests/unit/workspace-command.test.ts`, create `tests/unit/legal-analysis-grounding.test.ts`.

- [x] **Step 1 (chat, failing tests):** add to `tests/unit/workspace-command.test.ts`:

```ts
describe('normalizeNumericCitations (F-503)', () => {
  const sources = [
    { path: '/ws/matter/deposition-transcript-johnson.txt', paragraphIndex: 12 },
    { path: '/ws/matter/incident-summary-johnson.md', paragraphIndex: 8 },
  ];

  it('rewrites [N paragraph M] to the numbered source basename + its real paragraph', () => {
    expect(normalizeNumericCitations('The date conflicts [1 paragraph 3].', sources)).toBe(
      'The date conflicts [deposition-transcript-johnson.txt paragraph 12].',
    );
  });

  it('rewrites [N §M] and bare [N]', () => {
    expect(normalizeNumericCitations('See [2 §1] and [1].', sources)).toBe(
      'See [incident-summary-johnson.md paragraph 8] and [deposition-transcript-johnson.txt paragraph 12].',
    );
  });

  it('leaves filename citations, out-of-range numbers, and markdown links alone', () => {
    const text = 'Cited [notes.md paragraph 2], [9 paragraph 1], [3], and [1](https://x).';
    expect(normalizeNumericCitations(text, sources)).toBe(
      'Cited [notes.md paragraph 2], [9 paragraph 1], [3], and [1](https://x).',
    );
    // [9 …] and [3] are out of range for 2 sources; [1](…) is a link.
  });

  it('is a no-op with no sources', () => {
    expect(normalizeNumericCitations('See [1 paragraph 2].', [])).toBe('See [1 paragraph 2].');
  });
});
```

- [x] **Step 2 (chat, implement):** in `workspaceCommand.ts`, after `parseCitations`:

```ts
/**
 * F-503 — deterministic repair of number-keyed citations from small local
 * models. The `<workspace_context>` block numbers sources `[1]..[N]`
 * (buildWorkspaceContextBlock above); a 3B model sometimes cites the NUMBER
 * (`[1 paragraph 3]`, `[1 §3]`, or bare `[1]`) instead of the filename, so
 * resolution, live verification, and click-through all fail. Rewrite the
 * number through the message's ordered sources to the real
 * `[<basename> paragraph <paragraphIndex>]`. Pure text -> text; citations
 * that already carry a filename are untouched; bare `[N]` is only rewritten
 * when 1 <= N <= sources.length (markdown links `[1](url)` excluded).
 */
export function normalizeNumericCitations(
  content: string,
  sources: ReadonlyArray<{ path: string; paragraphIndex: number }>,
): string {
  if (sources.length === 0) return content;
  const rewrite = (n: number): string | null => {
    const src = sources[n - 1];
    if (!src) return null;
    return `[${citationBasename(src.path)} paragraph ${src.paragraphIndex}]`;
  };
  let out = content.replace(
    /\[(\d{1,3})\s+(?:paragraph\s+|§\s*)\d+\]/gi,
    (match, nStr: string) => rewrite(Number.parseInt(nStr, 10)) ?? match,
  );
  out = out.replace(/\[(\d{1,3})\](?!\()/g, (match, nStr: string) => {
    const n = Number.parseInt(nStr, 10);
    if (n < 1 || n > sources.length) return match;
    return rewrite(n) ?? match;
  });
  return out;
}
```

Run the test file → green.

- [x] **Step 3 (chat, wire):** in `AIChatViewer.tsx`, at BOTH verify sites, normalize first and persist the normalized content. Streaming site (`:1648-1660`):

```ts
          // F-503 — repair number-keyed local-model citations BEFORE
          // verification so the verify loop and chips see resolvable cites.
          const normalizedAnswer = normalizeNumericCitations(accumulated, retrievedSources);
          const verifiedStreamSources =
            retrievedSources.length > 0
              ? await verifyCitations(normalizedAnswer, retrievedSources, emitCitationVerified)
              : retrievedSources;

          const finalStreamingMessage: ChatMessage = {
            ...streamingMessage,
            content: normalizedAnswer,
            ...
```

Non-streaming site (`:1681-1690`): same pattern over `response.content` (use the normalized string for both `verifyCitations` and `assistantMessage.content`). Import `normalizeNumericCitations` alongside the existing `workspaceCommand` imports (`:69-75`). The numbering is correct by construction: the context block is built from `retrievedSources` in order (`:1534-1543`), so source `[N]` is `retrievedSources[N-1]`.

- [x] **Step 4 (finder, failing tests):** create `tests/unit/legal-analysis-grounding.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import {
  groundQuoteToChunk,
  runContradictionAnalysis,
  type RetrievedChunk,
} from '@/modules/workflow/legalAnalysis';

const chunks: RetrievedChunk[] = [
  {
    path: '/ws/depo.txt', paragraphIndex: 3,
    chunkText: 'Q. What did you do with the files? A. I forwarded them to my personal email for safekeeping.',
    id: 'a'.repeat(64), matterId: 'm1', sourceId: '/ws/depo.txt',
  },
  {
    path: '/ws/policy.md', paragraphIndex: 7,
    chunkText: 'All relevant documents remained on company servers only, per the retention policy.',
    id: 'b'.repeat(64), matterId: 'm1', sourceId: '/ws/policy.md',
  },
];

describe('groundQuoteToChunk (F-507b)', () => {
  it('grounds a verbatim quote to its chunk', () => {
    expect(groundQuoteToChunk('I forwarded them to my personal email for safekeeping', chunks)).toBe(0);
  });
  it('survives curly quotes and whitespace drift', () => {
    expect(groundQuoteToChunk('all relevant documents  remained on company servers only', chunks)).toBe(1);
  });
  it('refuses fabricated quotes and too-short needles', () => {
    expect(groundQuoteToChunk('You didn’t save any documents at all.', chunks)).toBe(-1);
    expect(groundQuoteToChunk('the files', chunks)).toBe(-1);
  });
});

describe('runContradictionAnalysis recovers omitted sourceNumber by quote (F-503/F-507b)', () => {
  it('verifies findings whose quotes are verbatim even when sourceNumber is missing', async () => {
    const provider = {
      structuredOutput: vi.fn().mockResolvedValue({
        findings: [{
          topic: 'Document handling',
          // sourceNumber omitted on both sides — the llama3.1:8b failure shape.
          statementA: { quote: 'I forwarded them to my personal email for safekeeping' } as never,
          statementB: { quote: 'All relevant documents remained on company servers only' } as never,
          conflictRationale: 'Same documents, two locations.',
        }],
      }),
    } as never;
    const verify = vi.fn().mockResolvedValue('verified');
    const { result } = await runContradictionAnalysis({
      provider,
      config: { analyzeKind: 'contradictions', retrievalQueryTemplate: 'q', promptTemplate: 'p', outputFile: 'o.docx' } as never,
      inputs: {},
      scope: { kind: 'matter', matterId: 'm1' } as never,
      retrieve: vi.fn().mockResolvedValue(chunks),
      verify,
      interpolate: (tpl) => tpl,
    });
    expect(verify).toHaveBeenCalledTimes(2);
    expect(verify).toHaveBeenCalledWith('a'.repeat(64), 'm1', expect.any(String));
    expect(result.verifiedCount).toBe(1);
  });
});
```

(Adapt the `config`/`scope` casts to the real `AnalyzeStepConfig`/`RetrievalScope` shapes — read `src/types/workflow.ts` first and prefer real objects over `as never` where cheap.)

- [x] **Step 5 (finder, implement):** in `legalAnalysis.ts`:

```ts
/** Normalize for containment matching: lowercase, straight quotes,
 *  collapsed whitespace. */
function normalizeQuote(s: string): string {
  return s
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Quotes shorter than this can match accidentally; refuse to ground them. */
const MIN_QUOTE_MATCH_CHARS = 20;

/**
 * F-507(b) — recover a missing/invalid sourceNumber by verbatim quote
 * containment against the retrieved chunks (the "quote match" half this
 * module's header always promised). Deterministic: first matching chunk in
 * the numbered-context order wins. A fabricated quote matches nothing and
 * the finding stays honestly unverified.
 */
export function groundQuoteToChunk(quote: string, chunks: RetrievedChunk[]): number {
  const needle = normalizeQuote(quote);
  if (needle.length < MIN_QUOTE_MATCH_CHARS) return -1;
  return chunks.findIndex((c) => normalizeQuote(c.chunkText).includes(needle));
}
```

In `resolveSource` (`:182-202`), replace the chunk lookup:

```ts
  const idx = raw.sourceNumber - 1;
  let chunk = idx >= 0 && idx < chunks.length ? chunks[idx] : undefined;
  // F-507(b): local models routinely omit sourceNumber even when the quote
  // is verbatim from the numbered context (RESULTS.md claim 10 — both runs
  // returned sourceNumber: None on every finding). Recover by quote match.
  if (!chunk) {
    const found = groundQuoteToChunk(raw.quote, chunks);
    if (found >= 0) chunk = chunks[found];
  }
```

(`raw.sourceNumber` may be `undefined` from a sloppy model: `undefined - 1` is `NaN`, `NaN >= 0` is false, so the fallback runs — verify with the Step 4 test.) Run both new test files → green.

- [x] **Step 6: Verify + commit**

```bash
cd ~/keepance && npx vitest run tests/unit/workspace-command.test.ts tests/unit/legal-analysis-grounding.test.ts 2>&1 | tail -5
npx tsc --noEmit
git add src/modules/memory/workspaceCommand.ts src/components/ai/AIChatViewer.tsx src/modules/workflow/legalAnalysis.ts tests/unit/workspace-command.test.ts tests/unit/legal-analysis-grounding.test.ts
git commit -m "fix(citations): F-503/F-507b deterministic grounding — numeric chat cites map to real sources; finder recovers omitted sourceNumber by quote match"
```

System-level verification of `data-verified="true"` chips on the local tier happens in the Task 14 leg-3 re-run (rule 2).

---

### Task 5: F-504 + F-505 (P2/P3) — scroll-to-passage listener; deduped accordion testid

**F-504 design (locked):** `paragraphIndex` is the CHUNK index, so position cannot be derived from "paragraphs" alone. Primary strategy: carry the cited chunk's text (`snippet`) through the click chain and have the editor `indexOf` it in the document (exact, chunker-drift-proof). Fallback: approximate byte-budget walk (chunker mirrors `TARGET_BYTES = 1536`). A module-level pending-slot fixes the dispatch/mount race (the event currently fires in the same tick the tab opens, before any listener could mount).

**Files:** create `src/utils/scrollToParagraph.ts`; modify `src/components/editor/MarkdownEditor.tsx`, `src/components/ai/AIChatViewer.tsx`, `src/App.tsx`, `tests/unit/citation-navigation.test.tsx`, `tests/e2e/wedge-proof.spec.ts`; the component between them (grep `onOpenFileAtPath` — the prop flows App → MainPanel → AIChatViewer).

- [x] **Step 1: The pending-slot util.** Create `src/utils/scrollToParagraph.ts`:

```ts
/**
 * F-504 — citation click-through scroll plumbing.
 *
 * App.tsx dispatches `keepance:scroll-to-paragraph` right after opening the
 * cited file, but the editor for a freshly-opened tab mounts AFTER that
 * dispatch (same-tick state update), so a bare event listener misses it.
 * The slot keeps the most recent request so the editor can consume it on
 * mount; the event stays for already-mounted editors (re-click while open).
 */
export const SCROLL_TO_PARAGRAPH_EVENT = 'keepance:scroll-to-paragraph';

export interface ScrollToParagraphDetail {
  path: string;
  paragraphIndex: number;
  /** The cited chunk's text — located by exact search when present. */
  snippet?: string;
}

let pending: ScrollToParagraphDetail | null = null;

export function requestScrollToParagraph(detail: ScrollToParagraphDetail): void {
  pending = detail;
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(SCROLL_TO_PARAGRAPH_EVENT, { detail }));
  }
}

/** Consume (and clear) the pending request for `path`, if any. */
export function consumePendingScroll(path: string): ScrollToParagraphDetail | null {
  if (pending && pending.path === path) {
    const out = pending;
    pending = null;
    return out;
  }
  return null;
}

/** Mirror of the Rust chunker's per-chunk byte budget (chunker.rs:15-23):
 *  TARGET_TOKENS 384 * BYTES_PER_TOKEN 4. Used only for the no-snippet
 *  fallback, so approximate is fine. */
const CHUNK_TARGET_BYTES = 1536;

/** Approximate the character offset where chunk `paragraphIndex` starts:
 *  walk double-newline blocks accumulating UTF-8 bytes, counting a chunk
 *  per budget fill (overlap ignored — a slight early bias centers fine). */
export function approximateChunkOffset(doc: string, paragraphIndex: number): number {
  if (paragraphIndex <= 0) return 0;
  const enc = new TextEncoder();
  let chunk = 0;
  let bytes = 0;
  const re = /\n\s*\n/g;
  let blockStart = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(doc)) !== null) {
    bytes += enc.encode(doc.slice(blockStart, m.index)).length;
    blockStart = re.lastIndex;
    while (bytes >= CHUNK_TARGET_BYTES) {
      bytes -= CHUNK_TARGET_BYTES;
      chunk += 1;
      if (chunk >= paragraphIndex) return blockStart;
    }
  }
  return Math.min(doc.length, paragraphIndex * CHUNK_TARGET_BYTES);
}
```

- [x] **Step 2: Carry the snippet through the click chain.** Grep `onOpenFileAtPath` across `src/` (three links: `AIChatViewer.tsx` prop + internal handlers, `MainPanel.tsx` pass-through, `App.tsx:3518`). Extend the signature everywhere with a trailing `snippet?: string`:
- `renderMessageWithCitations`'s `onCitationClick` (`AIChatViewer.tsx:268-273`) gains `snippet?: string`; the chip `onClick` (`:325-337`) passes `matchedSource?.chunkText`.
- `ChatSourcesAccordion`'s `onOpen` (`:381`) gains it; the row click (`:417-420`) passes `s.chunkText`.
- The intermediate handler(s) inside AIChatViewer that call the `onOpenFileAtPath` prop forward it (grep `onOpenFileAtPath(` inside the file).
- `App.tsx:3518`: `onOpenFileAtPath={async (p, paragraphIndex, snippet) => { … }}` and replace the raw dispatch (`:3529-3535`) with:

```ts
            // F-504 — editor scroll request. requestScrollToParagraph both
            // dispatches the event (already-mounted editors) and stashes a
            // pending slot the freshly-mounted editor consumes (mount race).
            if (typeof paragraphIndex === 'number') {
              requestScrollToParagraph({
                path: absPath,
                paragraphIndex,
                ...(snippet ? { snippet } : {}),
              });
            }
```

Update the now-stale "no editor listens" comment.

- [x] **Step 3: The editor listener.** In `MarkdownEditor.tsx`: add an optional `filePath?: string` prop (check the render site in `MainPanel.tsx` — pass the tab's `path`; grep `<MarkdownEditor`). Add an effect after the view-creation effect:

```ts
    // F-504 — bring the cited passage on screen. Primary: exact search for
    // the cited chunk's first searchable line. Fallback: approximate chunk
    // offset. Selects the landing line so the user sees WHERE the citation
    // points, not just the right file.
    useEffect(() => {
      if (!filePath) return undefined;
      const apply = (detail: ScrollToParagraphDetail) => {
        const view = viewRef.current;
        if (!view || detail.path !== filePath) return;
        const doc = view.state.doc.toString();
        let pos = -1;
        if (detail.snippet) {
          const firstLine = detail.snippet
            .split('\n')
            .map((l) => l.trim())
            .find((l) => l.length >= 8);
          if (firstLine) pos = doc.indexOf(firstLine);
        }
        if (pos < 0) pos = approximateChunkOffset(doc, detail.paragraphIndex);
        pos = Math.max(0, Math.min(pos, doc.length));
        const line = view.state.doc.lineAt(pos);
        view.dispatch({
          selection: { anchor: line.from, head: line.to },
          effects: EditorView.scrollIntoView(line.from, { y: 'center' }),
        });
      };
      const pendingDetail = consumePendingScroll(filePath);
      if (pendingDetail) apply(pendingDetail);
      const handler = (e: Event) =>
        apply((e as CustomEvent<ScrollToParagraphDetail>).detail);
      window.addEventListener(SCROLL_TO_PARAGRAPH_EVENT, handler);
      return () => window.removeEventListener(SCROLL_TO_PARAGRAPH_EVENT, handler);
    }, [filePath]);
```

Caveat for the implementer: the view-creation effect may run after this one on first mount — if the pending consume finds no `viewRef.current`, move the `consumePendingScroll` call to the END of the view-creation effect instead (after `viewRef.current = view`), keeping the event listener effect as-is. Verify against the real mount order.

- [x] **Step 4: F-505 — dedupe the accordion testid.** `AIChatViewer.tsx:409`: change to `const testId = \`chat-source-${base}-${s.paragraphIndex}\`;`. Grep `chat-citation-` across `tests/` and `src/` for anything that relied on the accordion duplication (the wedge-proof helper comment at `tests/e2e/wedge-proof.spec.ts:166-174` documents the workaround — simplify the comment; the `[data-verified]`-scoped locators keep working unchanged). Update `tests/unit/citation-navigation.test.tsx` if it queries accordion rows by the old id, and extend it with one assertion that `onOpenFileAtPath` now receives the snippet (the seeded source's `chunkText`).

- [x] **Step 5: Flip the tripwire.** `tests/e2e/wedge-proof.spec.ts:238-269`: remove `test.fail(true, …)`, rename to `'citation click-through scrolls the cited passage on screen (F-504 fixed)'`, rewrite the FINDING comment to past tense. The assertion body stays untouched (chip click → `getByText('until October 17, 2025 to submit my written response')` visible — the seeded `chunkText` is verbatim fixture text, so the snippet search lands exactly).

- [x] **Step 6: Verify + commit**

```bash
cd ~/keepance && npx vitest run tests/unit/citation-navigation.test.tsx 2>&1 | tail -5
npx playwright test tests/e2e/wedge-proof.spec.ts --project=chromium 2>&1 | tail -8
npx tsc --noEmit
git add src/utils/scrollToParagraph.ts src/components/editor/MarkdownEditor.tsx src/components/ai/AIChatViewer.tsx src/components/layout/MainPanel.tsx src/App.tsx tests/unit/citation-navigation.test.tsx tests/e2e/wedge-proof.spec.ts
git commit -m "fix(citations): F-504 scroll-to-passage listener (snippet search + chunk fallback); F-505 accordion testid deduped; tripwire flipped green"
```

Expected: the whole wedge-proof spec is now green with ZERO expected-fails.

---

### Task 6: F-508 + F-509 (P3) — AI artifacts out of matter memory; sidebar restore

**Files:** `src-tauri/src/commands/rag/extractor.rs`, `src-tauri/src/commands/rag/store.rs`, `src/components/layout/Sidebar.tsx`, `src/App.tsx`, create `tests/unit/sidebar-collapse.test.tsx`.

- [x] **Step 1 (F-508): extractor exclusion.** In `extractor.rs:19-22` remove `"aichat", "workflow"` from `TEXT_EXTENSIONS` and document why:

```rust
/// Extensions whose contents are read as raw UTF-8 text and indexed.
///
/// F-508: `.aichat` and `.workflow` are deliberately NOT here. They are AI
/// artifacts (chat answers, run records); indexing them feeds derived text
/// back into matter memory where it competes with primary sources and
/// creates retrieval feedback loops (a chat retrieving its own first turn
/// was observed live). Full-text search still sees them via the frontend.
pub const TEXT_EXTENSIONS: &[&str] = &[
    "md", "markdown", "txt", "text", "json", "csv",
    "log", "yml", "yaml", "toml",
];
```

Flip the existing test `aichat_and_workflow_are_indexable` (`extractor.rs:83-87`) to assert NOT indexable and rename it `ai_artifacts_are_not_indexable`. The watcher path is already covered: `rag_index_file` returns early for non-indexable files (`mod.rs:269-273`).

- [x] **Step 2 (F-508): one-time clean re-index.** Existing stores still hold artifact rows (the walker now skips those files, so their rows would never be deleted). Bump `store.rs:151`:

```rust
pub const INDEX_VERSION: u32 = 6; // 6: F-508 — .aichat/.workflow artifacts excluded; bump drops + re-indexes once
```

Confirm `needs_migration` compares the stored version against `INDEX_VERSION` (read `store.rs` around `:977`); the walk's existing migration arm (`mod.rs:431-439`) then drops and rebuilds once per workspace. Note the one-time re-index in the Task 14 CHANGELOG entry.

- [x] **Step 3 (F-509): reproduce first** (REPRODUCE-BEFORE-DIAGNOSING). `npm run dev`, open `/?testMode=true`, open any `.workflow` file (seed via `window.__openTestFile` with a minimal valid workflow JSON, or run a mock workflow). Observe whether the sidebar disappears and confirm the mechanism. Verified hypothesis from plan-writing: `Sidebar.tsx:149-154` has `w-64` but NO `shrink-0`, so a wide non-shrinking workflow tab crushes it (flex-shrink default 1); closing the tab restores width. If reproduction shows a different mechanism, fix THAT and note it in the commit body — but apply Step 4 regardless (both changes are correct independently).

- [x] **Step 4 (F-509): fixes.**
- `Sidebar.tsx:151`: add `shrink-0` to the root `cn(...)` class list (`'flex flex-col shrink-0 border-r bg-card transition-all duration-200'`).
- Controlled collapse (pattern mirrors the existing controlled `activeTab`): add optional props `collapsed?: boolean; onCollapsedChange?: (next: boolean) => void` to `SidebarProps`; `const isCollapsed = collapsed !== undefined ? collapsed : internalCollapsed;` and the chevron button calls `onCollapsedChange?.(!isCollapsed)` (falling back to internal state when uncontrolled).
- `App.tsx`: `const [sidebarCollapsed, setSidebarCollapsed] = useState(false);` near the sidebar state (`:276`); pass `collapsed={sidebarCollapsed}` `onCollapsedChange={setSidebarCollapsed}` to `<Sidebar>` (`:3390`); and add the missing global shortcut in the keydown handler, ABOVE the Ctrl+Shift+B branch (`:3124`):

```ts
      // F-509 — Ctrl+B toggles the sidebar. Documented in the shortcuts SSOT
      // (useKeyboardShortcuts.ts 'toggle-sidebar') but implemented nowhere
      // until now.
      if (isMod && !e.shiftKey && e.key === 'b') {
        e.preventDefault();
        setSidebarCollapsed((v) => !v);
        return;
      }
```

If App renders `CommandPalette` with handlers (grep `onToggleSidebar`), wire `onToggleSidebar: () => setSidebarCollapsed((v) => !v)` there too.

- [x] **Step 5: Tests.** Create `tests/unit/sidebar-collapse.test.tsx` (RTL): (a) controlled `collapsed` renders the `w-12` state and the chevron calls `onCollapsedChange(false→true)`; (b) the root `sidebar` testid carries `shrink-0`. Mirror the mocking style of a nearby layout test if Sidebar's children need stubs (pass empty `fileTreeContent` etc.).

- [x] **Step 6: Verify + commit**

```bash
cd ~/keepance/src-tauri && cargo test --lib extractor 2>&1 | tail -5
cd ~/keepance && npx vitest run tests/unit/sidebar-collapse.test.tsx 2>&1 | tail -5
npx tsc --noEmit
git add src-tauri/src/commands/rag/extractor.rs src-tauri/src/commands/rag/store.rs src/components/layout/Sidebar.tsx src/App.tsx tests/unit/sidebar-collapse.test.tsx
git commit -m "fix: F-508 AI artifacts excluded from matter memory (one-time re-index); F-509 sidebar shrink-proof + Ctrl+B implemented"
```

---

### Task 7: VG-3b — finder honest fallback when retrieval is unavailable

**Verified behavior today:** empty retrieval already proceeds (honest empty-context block, `legalAnalysis.ts:148-160`), but (a) a THROWING `retrieve` fails the whole step even when the attorney pasted excerpts, and (b) neither case says anything in the deliverable. Fix per the vision plan: analyze the pasted material and SAY SO in the output header; refuse only the answer-from-nothing case.

**Files:** `src/types/workflow.ts`, `src/modules/workflow/legalAnalysis.ts`, `src/modules/workflow/WorkflowEngine.ts`, `src/utils/docx-io.ts`, `src/modules/workflow/templates/legal/DepositionContradictionFinder.ts`, `tests/unit/legal-analysis-grounding.test.ts`, plus the docx test file.

- [x] **Step 1: Failing tests** (extend `tests/unit/legal-analysis-grounding.test.ts`): (a) `retrieve` rejects + `inputs.depositionExcerpts` non-empty + `config.pastedInputIds: ['depositionExcerpts','priorStatements']` → resolves with `retrievalUnavailable: true` and findings from the model; (b) `retrieve` rejects + no pasted material → rejects with a message containing `'nothing to analyze from'`; (c) `retrieve` resolves `[]` → `retrievalUnavailable: false` and `chunks.length === 0` (the engine renders the no-documents note for this case).

- [x] **Step 2: Types + template.** `src/types/workflow.ts` — add to `AnalyzeStepConfig`:

```ts
  /** VG-3b — interview input ids that count as attorney-pasted material.
   *  When retrieval is unavailable, the analysis falls back to these (and
   *  says so in the deliverable header) instead of failing; with none of
   *  them filled it refuses. */
  pastedInputIds?: string[];
```

`DepositionContradictionFinder.ts` — add `pastedInputIds: ['depositionExcerpts', 'priorStatements'],` to the analyze step's config (`:120-130` region).

- [x] **Step 3: `legalAnalysis.ts`.** Replace the retrieval line (`:253`):

```ts
  const topK = config.topK ?? 12;
  let chunks: RetrievedChunk[] = [];
  let retrievalUnavailable = false;
  if (retrievalQuery) {
    try {
      chunks = await retrieve(retrievalQuery, topK, scope);
    } catch {
      // VG-3b — retrieval down (no index yet, model missing, store error).
      // Fall back to the attorney's pasted excerpts ONLY, and say so in the
      // deliverable header. Refusal below covers the nothing-at-all case.
      retrievalUnavailable = true;
    }
  }
  if (retrievalUnavailable) {
    const hasPasted = (config.pastedInputIds ?? []).some(
      (id) => typeof inputs[id] === 'string' && (inputs[id] as string).trim().length > 0,
    );
    if (!hasPasted) {
      throw new Error(
        'Workspace retrieval is unavailable and no excerpts were pasted, so there is nothing to analyze from. Paste the transcript excerpts into the interview, or run again once matter memory is ready.',
      );
    }
  }
```

Return `retrievalUnavailable` from `runContradictionAnalysis` (add it to the return object and its type).

- [x] **Step 4: Engine + docx header.** `WorkflowEngine.ts` `executeAnalyzeStep` (`:378+`): destructure `retrievalUnavailable`, and extend `meta`:

```ts
      ...(retrievalUnavailable
        ? { retrievalNote: 'Analyzed only the excerpts you provided; workspace retrieval was unavailable for this run.' }
        : chunks.length === 0
          ? { retrievalNote: 'No matter documents were retrieved; this analysis covers only the excerpts you provided.' }
          : {}),
```

`docx-io.ts` `serializeContradictionsDocx` (`:1062-1071`): add `retrievalNote?: string` to the meta type, and render it right after the verification banner (`:1091`):

```ts
  if (meta.retrievalNote) {
    headerLines.splice(1, 0,
      new Paragraph({
        spacing: { after: 160 },
        children: [new TextRun({ text: meta.retrievalNote, bold: true, size: 22, color: 'B23B00' })],
      }),
    );
  }
```

Also record `retrievalUnavailable` in the analyze tool-call params (`WorkflowEngine.ts` `:434+`) so the run record carries it.

- [x] **Step 5: Docx-level assertion.** Extend `tests/unit/legal-template-docx-deliverables.test.ts` (read its docx-text extraction helper) with one case: `serializeContradictionsDocx(result, { …, retrievalNote: 'Analyzed only the excerpts you provided; workspace retrieval was unavailable for this run.' })` → extracted text contains that sentence.

- [x] **Step 6: Verify + commit**

```bash
cd ~/keepance && npx vitest run tests/unit/legal-analysis-grounding.test.ts tests/unit/legal-template-docx-deliverables.test.ts 2>&1 | tail -5
npx tsc --noEmit
git add src/types/workflow.ts src/modules/workflow/legalAnalysis.ts src/modules/workflow/WorkflowEngine.ts src/utils/docx-io.ts src/modules/workflow/templates/legal/DepositionContradictionFinder.ts tests/unit/legal-analysis-grounding.test.ts tests/unit/legal-template-docx-deliverables.test.ts
git commit -m "feat(workflow): VG-3b honest fallback — finder analyzes pasted excerpts when retrieval is down and says so in the deliverable header"
```

---

### Task 8: VG-4a — PDF export detect-and-explain (no silent LibreOffice failure)

**Verified behavior today:** `handleExportPdf` (`DocxEditor.tsx:434-450`) calls `docxConvertToPdf` directly; a missing LibreOffice surfaces only as a raw error string in the transient `exportNotice`. The fix: probe `detect_libreoffice` FIRST (the Tauri command exists, `fs.rs:210`; frontend wrapper near `tauri-commands.ts:36` — grep its exported name) and show a dedicated explanation with a copyable install link.

**Files:** create `src/components/media/LibreOfficeHelpNotice.tsx`; modify `src/components/media/DocxEditor.tsx`, locales; create `tests/unit/libreoffice-help-notice.test.tsx`.

- [x] **Step 1: The notice component** (light theme, dismissible):

```tsx
/**
 * VG-4a — shown when the user asks for PDF export and LibreOffice is not
 * installed. Explains exactly what to install and why, with a copyable
 * link. No silent failure path remains.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Copy, Check, X } from 'lucide-react';

const DOWNLOAD_URL = 'https://www.libreoffice.org/download/download-libreoffice/';

export function LibreOfficeHelpNotice({ onDismiss }: { onDismiss: () => void }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  return (
    <div
      data-testid="libreoffice-help-notice"
      role="alert"
      className="mx-3 my-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="font-medium">{t('media.docx-editor.pdf-needs-libreoffice-title')}</p>
        <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={onDismiss} aria-label={t('common.actions.dismiss', 'Dismiss')}>
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
      <p className="mt-1">{t('media.docx-editor.pdf-needs-libreoffice-body')}</p>
      <div className="mt-2 flex items-center gap-2">
        <code className="rounded bg-white px-2 py-1 text-xs border border-amber-200">{DOWNLOAD_URL}</code>
        <Button
          data-testid="libreoffice-copy-link"
          variant="outline"
          size="sm"
          onClick={() => {
            void navigator.clipboard.writeText(DOWNLOAD_URL).then(() => setCopied(true));
          }}
        >
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? t('media.docx-editor.pdf-libreoffice-copied') : t('media.docx-editor.pdf-libreoffice-copy')}
        </Button>
      </div>
    </div>
  );
}
```

- [x] **Step 2: Locales** (`en.json` inside `media.docx-editor`, then es/de + lock; NO em dashes):

```json
"pdf-needs-libreoffice-title": "PDF export needs LibreOffice",
"pdf-needs-libreoffice-body": "Keepance converts Word to PDF locally using LibreOffice, a free program. Nothing leaves your machine. Install it, then run the export again.",
"pdf-libreoffice-copy": "Copy link",
"pdf-libreoffice-copied": "Copied"
```

- [x] **Step 3: Gate the export.** In `DocxEditor.tsx`: add `const [libreOfficeHelpOpen, setLibreOfficeHelpOpen] = useState(false);` near the export state (`:228`); at the top of `handleExportPdf`'s `runExport` callback (`:434`):

```ts
      // VG-4a — never fail silently: probe LibreOffice BEFORE converting.
      const soffice = await detectLibreoffice();
      if (!soffice) {
        setLibreOfficeHelpOpen(true);
        return null;
      }
```

(Import the wrapper from `@/utils/tauri-commands` — grep the exact exported name around `:36`.) Render `{libreOfficeHelpOpen && <LibreOfficeHelpNotice onDismiss={() => setLibreOfficeHelpOpen(false)} />}` next to the existing export-notice render (`:943` region).

- [x] **Step 4: Tests.** `tests/unit/libreoffice-help-notice.test.tsx` (RTL): renders title/body, copy button writes the URL to a mocked `navigator.clipboard`, dismiss fires. Manual verification of the gate: in dev, temporarily PATH-mask soffice (or stub `detectLibreoffice` to return null) and confirm Export → PDF shows the notice instead of a raw error; with LibreOffice present the export still produces a PDF.

- [x] **Step 5: Verify + commit**

```bash
cd ~/keepance && npx vitest run tests/unit/libreoffice-help-notice.test.tsx tests/unit/i18n 2>&1 | tail -5
npx tsc --noEmit
git add src/components/media/LibreOfficeHelpNotice.tsx src/components/media/DocxEditor.tsx src/locales tests/unit/libreoffice-help-notice.test.tsx
git commit -m "feat(docx): VG-4a PDF export detects missing LibreOffice and explains the fix with a copyable link"
```

---

### Task 9: VG-5a (F-120) + VG-5b (F-121) — active egress pulse; privilege exclusion explained in-product

**Scope note (verified):** F-120's persistent static badge already shipped (`StatusBar.tsx:166-176`, render `:373`). This task adds only the missing ACTIVE signal: a visible "sending" state while a cloud request is actually in flight. Single instrumentation point: every cloud provider call goes through `getCorsSafeFetch()` (`fetchUtils.ts:65`; call sites in Claude/OpenAI/Gemini providers + ModelListService — verified by grep).

- [x] **Step 1 (F-120): the activity store + wrapper.** Create `src/modules/privacy/egressActivity.ts`:

```ts
/**
 * F-120 — positive cloud-egress signal. Counts provider HTTP requests in
 * flight so the status bar can show a quiet "sending" state when egress is
 * actually happening (loud when safe, visible when not). Instrumented at
 * the single choke point every cloud provider uses (getCorsSafeFetch).
 * Note: fetch resolves at response HEADERS, so a streaming chat shows the
 * pulse for the send + first byte; the StatusBar holds it briefly so it
 * never reads as a flicker.
 */
import { create } from 'zustand';

interface EgressActivityState {
  activeCount: number;
  lastActivityAt: number;
  begin: () => void;
  end: () => void;
}

export const useEgressActivityStore = create<EgressActivityState>((set) => ({
  activeCount: 0,
  lastActivityAt: 0,
  begin: () => set((s) => ({ activeCount: s.activeCount + 1, lastActivityAt: Date.now() })),
  end: () => set((s) => ({ activeCount: Math.max(0, s.activeCount - 1), lastActivityAt: Date.now() })),
}));

/** Wrap a fetch so every call signals begin/end, success or failure. */
export function instrumentEgressFetch(fetchFn: typeof globalThis.fetch): typeof globalThis.fetch {
  const wrapped = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const { begin, end } = useEgressActivityStore.getState();
    begin();
    try {
      return await fetchFn(input as RequestInfo, init);
    } finally {
      end();
    }
  };
  return wrapped as typeof globalThis.fetch;
}
```

In `fetchUtils.ts` `getCorsSafeFetch()`: wrap all three return paths with `instrumentEgressFetch(...)` (import at top; the dynamic-import cache stays, wrap once when assigning `tauriFetchFn`).

- [x] **Step 2 (F-120): StatusBar pulse.** In `StatusBar.tsx`, subscribe + hold:

```ts
  // F-120 — active egress pulse: visible while a provider request is in
  // flight, held ~2.5s after the last one so streamed sends don't flicker.
  const egressActiveCount = useEgressActivityStore((s) => s.activeCount);
  const lastEgressAt = useEgressActivityStore((s) => s.lastActivityAt);
  const [pulseVisible, setPulseVisible] = useState(false);
  useEffect(() => {
    if (egressActiveCount > 0) {
      setPulseVisible(true);
      return undefined;
    }
    if (!pulseVisible) return undefined;
    const id = setTimeout(() => setPulseVisible(false), 2500);
    return () => clearTimeout(id);
  }, [egressActiveCount, lastEgressAt, pulseVisible]);
```

Render next to the egress indicators (`:359-375` region), suppressed in local-only mode (Ollama traffic does not pass getCorsSafeFetch, but belt-and-braces):

```tsx
        {pulseVisible && confidentialityMode !== 'local-only' && (
          <span
            data-testid="egress-activity-pulse"
            className="flex items-center gap-1 text-[11px] text-sky-700"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-sky-500 animate-pulse" aria-hidden />
            {t('privacy.egress.sending')}
          </span>
        )}
```

Locale (en + es/de + lock): `"privacy.egress.sending": "Sending to your AI provider"` (place inside the existing `privacy.egress` section).

- [x] **Step 3 (F-120): tests.** `tests/unit/egress-activity.test.ts`: the wrapper increments during a pending fetch, decrements on resolve AND on reject; the store floor is 0. Use a controllable promise as the fake fetch.

- [x] **Step 4 (F-121): the explainer.** Create `src/components/ai/PrivilegeExclusionExplainer.tsx` — an info button + popover mounted NEXT TO the include-privileged toggle (`AIChatViewer.tsx:2269-2292`, rendered under the same `askWorkspaceMode &&` guard). Check `src/components/ui/popover.tsx` exists (shadcn); if not, use the existing Dialog primitives. Contents:
  - One sentence (locale `ai.privilege-explainer.body`): `"Sources tagged privileged are filtered out of workspace retrieval itself, before anything reaches the AI. It is enforced in the search engine, not just a label."`
  - A "See it work" button (`data-testid="privilege-explainer-demo"`): runs the user's current question (the chat input value, or the last user message when empty; prop in from AIChatViewer) through `ragRetrieve(query, 8, scope, false)` and `ragRetrieve(query, 8, scope, true)` with the chat's same `retrievalScope` (pass as a prop; read how AIChatViewer builds it near `:975`), then renders the diff via the pure helper below. Outside Tauri, `ragRetrieve` throws — catch and render `ai.privilege-explainer.desktop-only`: `"This live check runs in the desktop app."`
  - Pure helper (exported for tests, same file or `src/modules/memory/privilegeDiff.ts`):

```ts
export function summarizePrivilegeDiff(
  excluded: Pick<RagHit, 'id' | 'path'>[],
  included: Pick<RagHit, 'id' | 'path'>[],
): { withheldCount: number; topWithheldBasename: string | null } {
  const excludedIds = new Set(excluded.map((h) => h.id));
  const withheld = included.filter((h) => !excludedIds.has(h.id));
  return {
    withheldCount: withheld.length,
    topWithheldBasename: withheld[0] ? citationBasename(withheld[0].path) : null,
  };
}
```

  - Result strings (en + es/de + lock): `ai.privilege-explainer.withheld`: `"Privilege exclusion is withholding {{count}} source(s) from this question right now. Top withheld source: {{name}}."` and `ai.privilege-explainer.none-withheld`: `"No privileged sources matched this question, so nothing was withheld."` Also `ai.privilege-explainer.title`: `"What does privilege exclusion do?"` and `ai.privilege-explainer.demo`: `"See it work on my own files"`.

- [x] **Step 5 (F-121): tests.** Unit-test `summarizePrivilegeDiff` (withheld count, top basename, empty-diff case) in `tests/unit/egress-activity.test.ts`'s sibling file `tests/unit/privilege-explainer.test.tsx`, plus an RTL render of the popover body strings with a mocked demo runner.

- [x] **Step 6: Verify + commit**

```bash
cd ~/keepance && npx vitest run tests/unit/egress-activity.test.ts tests/unit/privilege-explainer.test.tsx tests/unit/i18n 2>&1 | tail -5
npx tsc --noEmit
git add src/modules/privacy/egressActivity.ts src/modules/models/fetchUtils.ts src/components/layout/StatusBar.tsx src/components/ai/PrivilegeExclusionExplainer.tsx src/components/ai/AIChatViewer.tsx src/modules/memory src/locales tests/unit
git commit -m "feat(trust): F-120 live egress pulse in Direct mode; F-121 privilege exclusion explained in-product with a see-it-work check"
```

---

### Task 10: VG-5c — per-message mail privilege surfaced in the email viewer

**Engine support (verified):** mail indexes at `PRIVILEGE_NONE` and is designed for the user to "mark a message privileged in the UI, which writes the privilege store and re-tags these chunks in place via `rag_retag_privilege`" (`src-tauri/src/commands/mail/mod.rs:864-866`). The frontend path exists: `MemoryService` wraps `ragRetagPrivilege(sourceId, privilege)` (`MemoryService.ts:250`), and `mail:` source-id prefixes are tolerated (`mail/mod.rs:233-235`). The FILE privilege UI to mirror is `src/components/privilege/PrivilegeMenuItems.tsx`.

- [x] **Step 1: Read the file-privilege pattern.** Read `PrivilegeMenuItems.tsx` end to end and whichever store/hook it uses for current-privilege state, the valid privilege values (the store validates three; use exactly those), and any audit event it emits. The mail control must reuse the SAME values, service calls, and audit shape.

- [x] **Step 2: The control.** In `src/components/mail/EmailViewer.tsx`, in the header metadata block (near the attachments row, `:153`): a compact privilege control (`data-testid="email-privilege-control"`) showing the message's current privilege (default none) with actions to mark attorney-client / work-product / clear, calling the same MemoryService/privilege-store path with sourceId `` `mail:${sourceId}` `` (strip a pre-existing `mail:` prefix first to avoid doubling — the viewer's `sourceId` prop may already carry it; check the prop's call site in `MainPanel.tsx:643-646`). Show a one-line consequence string under the control when privileged (locale `mail.viewer.privilege-note`): `"Excluded from AI retrieval by default. The Include privileged toggle in chat is the only way to bring it back in."` Add `mail.viewer.privilege-mark-ac`, `privilege-mark-wp`, `privilege-clear`, `privilege-label` strings (en + es/de + lock; mirror the file UI's wording verbatim where it has equivalents).

- [x] **Step 3: Tests.** `tests/unit/email-privilege-control.test.tsx` (RTL, mock the service layer): marking calls the retag path with the `mail:`-prefixed source id and the exact privilege value; clearing calls it with the none value; the note renders only when privileged. Mirror EmailViewer's existing test mocks if a test exists (grep `EmailViewer` under `tests/`).

- [x] **Step 4: Verify + commit**

```bash
cd ~/keepance && npx vitest run tests/unit/email-privilege-control.test.tsx 2>&1 | tail -5
npx tsc --noEmit
git add src/components/mail/EmailViewer.tsx src/locales tests/unit/email-privilege-control.test.tsx
git commit -m "feat(mail): VG-5c per-message privilege control in the email viewer (retags indexed chunks in place)"
```

---

### Task 11: VG-5d — Clio copy precision on the website

**Verified:** exactly one offending phrase. `website/index.html:511`: `"It fits beside Clio, Outlook, and Word. It sits on top of the tools you already live in."` — "sits on top of" reads as a connector. `:654` ("the private AI layer beside Clio, not a replacement") is the philosophy and STAYS.

- [x] **Step 1: Replace line 511's text** with connector-free copy (keep the `<li>`/svg wrapper byte-identical):

```
It fits beside Clio, Outlook, and Word. Nothing to integrate and nothing to migrate: it works on the files and email you already have.
```

(Voice check: no em dashes, contraction-free is fine here, no "seamless". Matches the homepage's existing list-item register.)

- [x] **Step 2: Self-lint for other connector implications.**

```bash
grep -rn "sits on top of\|integrates with\|connects to\|plugs into\|syncs with" website/ | grep -vi "does not\|no integration\|nothing to integrate"
```

Fix any hit that implies a shipped integration (the /vs/ pages and llms.txt are the likely places); leave honest negations alone. Then run the website lint test:

```bash
npx vitest run tests/unit/website-content-lint.test.ts 2>&1 | tail -5
```

- [x] **Step 3: Commit.** NOTE: repo edit only — the site deploys with the next release deploy, which (Keepance = commercial) needs Jameson's explicit go. Do NOT run `infra/deploy.sh` in this wave.

```bash
cd ~/keepance && git add website/ && git commit -m "fix(website): VG-5d Clio copy precision — no connector implied until one exists"
```

---

### Task 12: VG-6a — firm key-handshake auto-publish on member device registration

**Verified state:** `publishMatterKeyToMembers` (`matterKeyService.ts:74-129`) wraps to every eligible device and is called manually (invite flow `FirmAdminConsole.tsx:236`; "Re-publish keys" button `:263`). The member side already waits honestly and self-resolves once a key appears (`en.json:811` "I'll open it automatically once they do"). The missing piece: the ADMIN client never notices a member's newly registered device, so the wait lasts until a human clicks Re-publish. Approach (per the vision plan): poll on the admin console; auto-republish when the device set changes. The manual button stays as the fallback.

- [x] **Step 1: Failing tests.** Extend `tests/unit/firm/matterKeyDistribution.test.ts` (read its mock-client pattern first):
  - `deviceSetFingerprint` is order-independent and epoch-sensitive.
  - `autoRepublishHeldMatterKeys`: (a) a matter whose device set grew since the recorded fingerprint gets exactly one publish and the fingerprint updates; (b) unchanged device set publishes nothing; (c) a matter with no local key is skipped without touching the network beyond the device listing (or at all — see Step 2's key-first ordering); (d) one matter's publish failure does not abort the others.

- [x] **Step 2: Refactor + implement in `matterKeyService.ts`.**
  - Extract steps 2–4 of `publishMatterKeyToMembers` (`:88-106`) into a shared helper, preserving behavior exactly:

```ts
interface EligibleDevice { user_id: string; device_id: string; pubkey_jwk: <the type fetchOrgUserDevices returns>; }

/** Roster + escrow + device expansion for a matter: non-walled members plus
 *  org admins, with walled users' devices dropped. Shared by the manual
 *  publish and the VG-6a auto-republish poll. */
async function eligibleDevices(
  client: FirmApiClient,
  matterId: string,
): Promise<{ devices: EligibleDevice[]; walledSkipped: number }>
```

  - `publishMatterKeyToMembers` uses it (wrap loop unchanged; same return).
  - New pure fingerprint + poller:

```ts
/** Stable fingerprint of (epoch, device set) — drift means "someone
 *  registered or lost a device since we last wrapped keys". */
export function deviceSetFingerprint(
  devices: Array<{ user_id: string; device_id: string }>,
  epoch: number,
): string {
  return `${epoch}:` + devices.map((d) => `${d.user_id}/${d.device_id}`).sort().join(',');
}

/**
 * VG-6a — auto-republish wrapped matter keys when a member registers a new
 * device. For every matter whose key THIS client holds: compute the current
 * device-set fingerprint; on drift from `lastFingerprints`, re-run the full
 * publish (idempotent server-side) and record the new fingerprint. Errors
 * on one matter never block the rest. The honest member-side waiting state
 * remains the fallback for matters whose key holder is offline.
 */
export async function autoRepublishHeldMatterKeys(
  client: FirmApiClient,
  matters: Array<{ /* use the real FirmMatter id + key_epoch field names — read `interface FirmMatter` in contract.ts */ }>,
  lastFingerprints: Record<string, string>,
): Promise<{ republishedMatterIds: string[]; fingerprints: Record<string, string> }> {
  const fingerprints = { ...lastFingerprints };
  const republishedMatterIds: string[] = [];
  for (const m of matters) {
    try {
      const key = await loadMatterKey(m.<id>);
      if (!key) continue; // not the key holder on this device
      const { devices } = await eligibleDevices(client, m.<id>);
      const fp = deviceSetFingerprint(devices, m.key_epoch);
      if (fingerprints[m.<id>] === fp) continue;
      await publishMatterKeyToMembers(client, m.<id>, m.key_epoch);
      fingerprints[m.<id>] = fp;
      republishedMatterIds.push(m.<id>);
    } catch {
      // Quiet: next poll retries; the manual Re-publish button still exists.
    }
  }
  return { republishedMatterIds, fingerprints };
}
```

(Yes, a drifted matter fetches the roster twice — once for the fingerprint, once inside publish. Accept it: drift is rare, correctness is shared code. Read `interface FirmMatter` in `contract.ts:~137-148` for the real `id`/`matter_id` + `key_epoch` field names before writing.)

- [x] **Step 3: The console poll.** In `FirmAdminConsole.tsx`, after the initial-load effect (`:177-183`):

```ts
  // VG-6a — auto-publish poll: while the admin console is open, newly
  // registered member devices get wrapped keys within a poll interval,
  // so the member's "waiting for your firm admin" state usually resolves
  // without a human dance. Fingerprints persist across sessions so a
  // reopened console doesn't re-wrap an unchanged org.
  const fpRef = useRef<Record<string, string>>(readPublishFingerprints());
  useEffect(() => {
    if (firm.role !== 'admin' || matters.length === 0) return undefined;
    let cancelled = false;
    const tick = async () => {
      const res = await autoRepublishHeldMatterKeys(getClient(), matters, fpRef.current);
      if (cancelled) return;
      fpRef.current = res.fingerprints;
      writePublishFingerprints(res.fingerprints);
      if (res.republishedMatterIds.length > 0) {
        setNotice(t('firm.admin.auto-republish-ok', { count: res.republishedMatterIds.length }));
      }
    };
    void tick();
    const id = setInterval(() => void tick(), 60_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [firm.role, matters, getClient, t]);
```

With tiny localStorage helpers in the same file (key `keepance_firm_key_publish_fp`, JSON, try/catch both ways). Locale (en + es/de + lock): `"firm.admin.auto-republish-ok": "Granted key access to newly registered devices for {{count}} matter(s)."`

- [x] **Step 4: Two-client coverage decision.** Read `tests/e2e/firm-collaboration.spec.ts`: if it drives a mock/local backend, add one case (member registers a second device → admin poll tick → member device can fetch the wrapped key). If it requires the live backend, do NOT fake it — the unit tests in Step 1 are this wave's required coverage, and note the live two-client exercise as a follow-up line in the Task 14 RESULTS addendum.

- [x] **Step 5: Verify + commit**

```bash
cd ~/keepance && npx vitest run tests/unit/firm/matterKeyDistribution.test.ts 2>&1 | tail -5
npx tsc --noEmit
git add src/modules/firm/matterKeyService.ts src/components/firm/FirmAdminConsole.tsx src/locales tests/unit/firm/matterKeyDistribution.test.ts tests/e2e/firm-collaboration.spec.ts
git commit -m "feat(firm): VG-6a key-handshake auto-publish — admin console polls device drift and re-wraps matter keys automatically"
```

---

### Task 13: VG-6d-v1 — unmissable disk-encryption guidance

Until the v2 encrypted vault exists (Wave 3), document files rely on OS full-disk encryption. Make that unmissable: an onboarding callout in the existing `data` step + a Data Map row with OS-specific "check it is on" instructions.

- [x] **Step 1: The guidance component.** Create `src/components/onboarding/DiskEncryptionGuidance.tsx`:

```tsx
/**
 * VG-6d-v1 — disk-encryption guidance. Keepance stores documents as normal
 * files; at-rest protection comes from the OS's full-disk encryption. This
 * callout makes that explicit and tells the user how to CHECK it is on,
 * per platform. The encrypted workspace vault (VG-6d-v2) supersedes the
 * caveat later; the guidance stays true either way.
 */
import { useTranslation } from 'react-i18next';
import { HardDrive } from 'lucide-react';

export type DesktopPlatform = 'windows' | 'macos' | 'linux';

export function detectDesktopPlatform(): DesktopPlatform {
  const ua = (typeof navigator !== 'undefined' ? navigator.userAgent : '').toLowerCase();
  if (ua.includes('mac')) return 'macos';
  if (ua.includes('linux')) return 'linux';
  return 'windows';
}

export function DiskEncryptionGuidance() {
  const { t } = useTranslation();
  const platform = detectDesktopPlatform();
  return (
    <div
      data-testid="disk-encryption-guidance"
      className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900"
    >
      <div className="flex items-center gap-2 font-medium">
        <HardDrive className="h-4 w-4 shrink-0" aria-hidden />
        {t('onboarding.disk-encryption.title')}
      </div>
      <p className="mt-1.5">{t('onboarding.disk-encryption.body')}</p>
      <p className="mt-1.5 font-medium" data-testid={`disk-encryption-check-${platform}`}>
        {t(`onboarding.disk-encryption.check-${platform}`)}
      </p>
    </div>
  );
}
```

- [x] **Step 2: Locales** (en + es/de + lock; no em dashes):

```json
"disk-encryption": {
  "title": "One thing to check: your disk encryption",
  "body": "Keepance keeps your documents as normal files in your workspace folder, on your machine. If the laptop is lost or stolen, your operating system's full-disk encryption is what protects them. It takes a minute to confirm it is on.",
  "check-windows": "Windows: Settings, then Privacy & security, then Device encryption (or search for BitLocker). It should say On.",
  "check-macos": "Mac: System Settings, then Privacy & Security, then FileVault. It should say FileVault is turned on.",
  "check-linux": "Linux: most installers offer LUKS full-disk encryption. Check your distribution's disk settings, or run lsblk and look for a crypt entry."
}
```

- [x] **Step 3: Mount in onboarding.** In `FirstRunWizard.tsx`, inside the `step === 'data'` pane body (read the block ending at `:316-329`; place the component at the END of the body content, above the actions): `<DiskEncryptionGuidance />`. The step is already on the wizard's required path (`welcome → profession → workspace → data → ai-setup → demo`), which satisfies "onboarding step" without adding a seventh circle.

- [x] **Step 4: Data Map row.** In `DataMapDialog.tsx`, append to `DATA_MAP_ROWS` (`:64`) following the file's existing hardcoded-copy + tone conventions (amber = honest caveat; import `HardDrive` from lucide):

```ts
  {
    icon: HardDrive,
    tone: 'text-amber-700 bg-amber-50 dark:text-amber-300 dark:bg-amber-950/40',
    title: 'Document files rely on your disk encryption',
    body: 'Your documents are normal files in your workspace folder. At-rest protection for those files comes from your operating system’s full-disk encryption: BitLocker on Windows, FileVault on macOS, LUKS on Linux. With it on, your whole workspace is protected if the machine is lost or stolen.',
    caveat: 'How to check: Windows: Settings > Privacy & security > Device encryption. macOS: System Settings > Privacy & Security > FileVault. Linux: your distribution’s disk settings (LUKS).',
  },
```

- [x] **Step 5: Tests.** `tests/unit/disk-encryption-guidance.test.tsx`: renders title + the detected platform's check line (mock userAgent per case via `vi.stubGlobal`/property spy). Run the onboarding + data-map adjacent suites to catch copy snapshots:

```bash
npx vitest run tests/unit/disk-encryption-guidance.test.tsx tests/unit/first-run-wizard-flow.test.tsx tests/unit/onboarding-copy-3-0.test.ts tests/unit/i18n 2>&1 | tail -6
```

- [x] **Step 6: Verify + commit**

```bash
cd ~/keepance && npx tsc --noEmit
git add src/components/onboarding/DiskEncryptionGuidance.tsx src/components/onboarding/FirstRunWizard.tsx src/components/privacy/DataMapDialog.tsx src/locales tests/unit/disk-encryption-guidance.test.tsx
git commit -m "feat(trust): VG-6d-v1 unmissable disk-encryption guidance — onboarding callout + data map row with per-OS checks"
```

---

### Task 14: Wave verification — full gates, leg-3 re-run, CHANGELOG, doc ticks

- [x] **Step 1: Full gates**

```bash
cd ~/keepance && npx tsc --noEmit && npm run test 2>&1 | tail -6
cd ~/keepance/src-tauri && cargo test 2>&1 | tail -8
cd ~/keepance && npx playwright test tests/e2e/wedge-proof.spec.ts tests/e2e/spreadsheet-improvements.spec.ts --project=chromium 2>&1 | tail -8
```

Expected: tsc clean; vitest fully green; cargo green; the wedge-proof spec green with ZERO `test.fail` remaining (`grep -c "test.fail" tests/e2e/wedge-proof.spec.ts` → 0).

- [x] **Step 2: The heavy ignored test, once**

```bash
cd ~/keepance/src-tauri && cargo test --release --test rag_embed_memory -- --ignored --nocapture 2>&1 | tail -6
```

- [x] **Step 3: Leg-3 runbook re-run (the wave's system-level verification, rule 2).** Follow `docs/quality/2026-06-11-wedge-proof/RUNBOOK.md` end to end on this rig (fresh profile, headless keyring, MemoryMax per the recalibrated harness), banking artifacts to `docs/quality/2026-06-11-wedge-proof/fix-wave-rerun/`. Expected deltas vs the 2026-06-11 baseline:
  - **Indexing:** 4 files indexed (huge-notes.md back in), no OOM, whole-scope cgroup peak well under the 12G cap (record the curve; F-501 closed at system level).
  - **Chat (F-503):** a number-keyed local-model citation now renders as a filename chip, `data-verified="true"` against the wedge fixtures, and chip click-through opens the deposition WITH the cited passage scrolled on screen (F-504).
  - **Finder (F-502/F-507b):** starts with NO per-template pin seeded in local-only mode (remove the harness's F-502 workaround pin from `seed-localstorage` and note it in the script header — the product now resolves local-only itself); run completes; findings with verbatim quotes report verified > 0 in the run record (engine recovers grounding by quote). Single-run rubric completeness (F-507a) is OBSERVED and recorded, not gated (model floor).
  - **Artifacts (F-508):** banner counts no longer grow as .aichat/.workflow files accrue.
  - Append a dated "Fix-wave re-run" addendum section to `RESULTS.md` with per-finding closure verdicts (CLOSED / improved / still-open with evidence), and add the corresponding W-rows to the campaign coverage ledger.

- [x] **Step 4: CHANGELOG.** Under `## [Unreleased]`, following the existing entry style:

```markdown
### Fixed
- **Indexing a large file can no longer exhaust memory.** Embedding now runs in small bounded batches with cancellation between batches; the 2 MB file that previously drove the app past 12 GB and an OOM kill now indexes flat. One-time note: the first launch after this update re-indexes your workspace once (a version bump that also cleans AI artifacts out of the search index). Files: `src-tauri/src/commands/rag/embedder.rs`, `src-tauri/src/commands/rag/mod.rs`.
- **Spreadsheet formulas from other tools survive opening and saving.** Excel files whose formulas carry no cached value (files from openpyxl-class tools) used to render empty totals, and saving silently deleted the formulas. They now render, recompute live, and round-trip intact. Files: `src/utils/spreadsheet-io.ts`.
- **Local-only mode runs workflows on your local model, and a blocked run is never silent.** In Local-only confidentiality mode, workflows resolve to your installed Ollama model automatically (no hidden per-template pin needed), a blocked run shows exactly what to fix right where you clicked, and the template settings dropdown lists the models actually installed. Files: `src/modules/workflow/resolveTemplateModel.ts`, `src/App.tsx`, `src/components/workflow/WorkflowPanel.tsx`, `src/components/settings/TemplateModelSettings.tsx`.
- **Citations from local models now verify and click through.** Number-style citations are mapped to their real source files before verification, and the contradiction finder recovers a missing source reference when the quote is verbatim from the record (a fabricated quote still flags as unverified). Files: `src/modules/memory/workspaceCommand.ts`, `src/modules/workflow/legalAnalysis.ts`, `src/components/ai/AIChatViewer.tsx`.
- **Clicking a citation scrolls to the cited passage,** not just the top of the file, and the sidebar can no longer be crushed off screen by a wide tab (Ctrl+B now really toggles it). Files: `src/components/editor/MarkdownEditor.tsx`, `src/utils/scrollToParagraph.ts`, `src/components/layout/Sidebar.tsx`, `src/App.tsx`.
- **AI chats and workflow run records no longer feed back into matter memory,** so retrieval competes only over your primary sources. Files: `src-tauri/src/commands/rag/extractor.rs`, `src-tauri/src/commands/rag/store.rs`.

### Added
- **The contradiction finder falls back honestly when retrieval is down:** it analyzes the excerpts you pasted and says so in the Word deliverable's header, refusing only when there is nothing at all to analyze. Files: `src/modules/workflow/legalAnalysis.ts`, `src/utils/docx-io.ts`, `src/modules/workflow/WorkflowEngine.ts`.
- **PDF export explains itself when LibreOffice is missing** (what to install, why it is safe, copyable link) instead of failing with a raw error. Files: `src/components/media/DocxEditor.tsx`, `src/components/media/LibreOfficeHelpNotice.tsx`.
- **Trust polish:** the status bar shows a live "Sending to your AI provider" pulse while cloud egress is actually happening; the privilege toggle explains its enforcement and can demonstrate it against your own index; individual emails can be marked privileged from the email viewer; onboarding and the Data Map now walk you through checking your disk encryption per OS. Files: `src/modules/privacy/egressActivity.ts`, `src/components/layout/StatusBar.tsx`, `src/components/ai/PrivilegeExclusionExplainer.tsx`, `src/components/mail/EmailViewer.tsx`, `src/components/onboarding/DiskEncryptionGuidance.tsx`, `src/components/privacy/DataMapDialog.tsx`.
- **Firm key handshake resolves itself:** while a firm admin has the console open, newly registered member devices get their wrapped matter keys automatically; the honest waiting state remains the fallback. Files: `src/modules/firm/matterKeyService.ts`, `src/components/firm/FirmAdminConsole.tsx`.

### Changed
- Website: the Clio line no longer implies an integration that does not exist yet ("fits beside Clio" stays; "sits on top of the tools" is gone). File: `website/index.html`.
```

- [x] **Step 5: Doc ticks.** In `docs/strategy/2026-06-10-vision-gap-closure-plan.md`, add STATUS lines (matching the VG-1 STATUS style) to VG-3 (b done; c/d stay Wave 2), VG-4 (a done; b/c stay), VG-5 (a-d done), VG-6 (a done, d-v1 done; b/c/e stay) referencing this plan + the re-run artifacts.

- [x] **Step 6: Commit + push**

```bash
cd ~/keepance && git add CHANGELOG.md docs/ scripts/wedge-proof-native.sh
git commit -m "docs: Wave 1 fix wave verified — changelog, leg-3 re-run artifacts, strategy ticks"
git push origin keepance-3.0
```

---

## Self-review notes

- **Coverage vs the brief:** all nine F-5xx findings have tasks (F-501 T1, F-502 T3, F-503 T4, F-504 T5, F-505 T5, F-506 T2, F-507b T4, F-508 T6, F-509 T6; F-507a deliberately observed-not-gated per RESULTS.md's own diagnosis); all original Wave 1 items have tasks (VG-3b T7, VG-4a T8, VG-5a-d T9/T9/T10/T11, VG-6a T12, VG-6d-v1 T13). Tripwire flips are inside the owning tasks (T2 Step 4, T5 Step 5) and re-checked in T14 Step 1. Leg-3 re-run with huge-notes re-enabled + the harness's F-502 pin workaround REMOVED is T14 Step 3.
- **Known judgment calls, decided here:** blocked-run surface lives in WorkflowPanel (preserves the v3.1 no-folder-litter decision; the prompt's "execution tab" banner already exists for reopened tabs); `rag_index_file` passes `None` for cancel (stale-flag hazard); F-508 cleanup via `INDEX_VERSION` bump (one-time re-index, uses existing migration machinery); bare `[N]` rewrites are range-gated and link-excluded; quote grounding requires ≥20 normalized chars; auto-republish is poll-based with persisted fingerprints (the vision plan's own suggested shape).
- **Known judgment calls left to the implementer (each flagged in its step):** exact exported name of the `detect_libreoffice` wrapper; the `onOpenFileAtPath` intermediate hop names; MarkdownEditor mount-order placement of the pending-scroll consume; `FirmMatter` field names; whether `firm-collaboration.spec.ts` is mock-backed; locale section placement.
- **Cross-task interactions:** T1 and T6 both touch `mod.rs`/`store.rs` (disjoint regions); T4 and T5 both touch `AIChatViewer.tsx` (disjoint regions: verify sites vs chip/accordion handlers); T3 and T5 and T6 all touch `App.tsx` (disjoint regions). Execute in order and conflicts cannot arise.
- **Out of scope (deliberate):** prompt-grammar changes for chat citations (cloud tier works; deterministic repair is strictly safer), VG-3c/d, VG-4b/c, VG-6b/c/e, OCR (Wave 2+), marker-free fixture variant (RESULTS.md follow-up note), F-507a model-quality chasing, any website deploy.

---

**Orchestrator addendum (2026-06-11, post-Task-1 review):** the Task 1 reviewer's call-site audit found the F-501 class ALSO lived in `pdf_indexer.rs:99` (whole-PDF embed, NO upstream size cap — worse-exposed than the text path for long legal PDFs) and, as cheap hardening, `mail/mod.rs:857` (per-message, pathological-body case). Both routed through `embed_documents_batched(.., None)` directly by the orchestrator (commit referenced below); lib suite green. F-501 is closed as a CLASS only with these in.
