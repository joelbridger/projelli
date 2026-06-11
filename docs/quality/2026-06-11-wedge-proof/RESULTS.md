# VG-1 Wedge Proof — RESULTS (executed 2026-06-11)

Ledger for the leg-3 attended pass (+ leg-1/leg-2 findings folded in, since
this file owns the F-5xx register). Procedure: [RUNBOOK.md](RUNBOOK.md).
Verdict vocabulary: **PASS** (claim observed as promised), **PASS-with-finding**
(observed, with a logged defect adjacent), **FAIL→F-5xx** (claim not delivered;
defect logged). Prime directive held: nothing was fixed in product code; the
only fixes were harness-script bugs (noted below).

## A. Claim ledger

| # | Claim | Verdict | Evidence |
|---|-------|---------|----------|
| 1 | Index populates on a real machine, fresh profile, headless keychain (closes F-415's observation) | **PASS** | `run-02c-indexing-3files.png` ("Memory ready, indexed 3 files."); `chunks.lance` data fragments on disk (assert: 15→20 across the session); zero `vectors key:` errors in `logs/app.log`; gnome-keyring probe `keyring OK` every launch. Banner count is 3 (not the plan's 4) because huge-notes.md is excluded — see F-501. |
| 2 | Local chat on Ollama with green egress + matter-scope controls | **PASS** | `run-03-local-chat.png` (llama3.2:3b header, "On your machine. Nothing leaves", status-bar "Memory: ready"), `run-04-toggles.png` (Ask-my-workspace ON ⇒ Include-privileged appears, F-121 surface). |
| 3 | Ask a question, get a **grounded** answer from real retrieval | **PASS** | Both attempts grounded and two-sided on the planted C2 facts (Oct 17 vs Oct 10; attempt 2 adds transcript-verbatim "October 15" detail). 8 real store hits attached from BOTH documents, scores .809–.853 (`output/local-chat-1.aichat.json`); scope chip rendered (`chat-message-*-scope`, "Scoped to all matters"). |
| 4 | Cited answer renders ≥1 citation chip (F-117 closure shot) | **PASS-with-finding (F-503)** | Attempt 1: no citation grammar emitted → no chips (`run-05a`). Attempt 2: chip rendered (`run-05c-attempt2.png`) but number-keyed (`[1 paragraph 3]` → testid `chat-citation-1-3`). The chip RENDER machinery works; the local 3B model muddles the two citation grammars it is shown (numbered context headers vs `[filename paragraph N]` instruction). |
| 5 | Citation verifies live (`data-verified="true"`) | **FAIL→F-503** | Live verification runs only over citations parsed from the answer text (`workspaceCommand.ts:240-275`); a number-keyed basename resolves to no source, so `ragVerifyCitation` never ran — every `verified` flag in the persisted chat is `undefined` (disk truth in `output/local-chat-1.aichat.json`). The verify CODE PATH is real on native; the local model never feeds it a resolvable citation. |
| 6 | Citation click-through opens the cited source | **PASS-with-finding (F-503, F-504)** | The number-keyed chip click fails honestly ("Source file not found: 1. Retrieval may be stale. Re-indexing…", `run-05d-chip-click.png`) — F-503. The sources-accordion row (same `onOpen` handler, first-class UI) opens the REAL deposition from disk (`run-06-clickthrough.png`) — but **at the top of the file**; the cited passage (fixture line ~108) is never scrolled to — F-504, corroborating leg 2 on the native build. |
| 7 | Deposition Contradiction Finder full run completes to a real .docx | **PASS-with-finding (F-502 to start it; F-507 on the rubric)** | Start dialog "$0 / runs on your local AI model" (`run-07-start-dialog.png`); interview renders + echoes the exact leg-1 inputs (`run-08o`–`run-08u`); run completes with verification banner + "Word deliverable ready … Flagged 3" (`run-09-run-complete.png`); real OOXML docx on disk both attempts (`output/attempt*.docx`). |
| 8 | Rubric: all 3 planted contradictions in ONE run's .docx | **FAIL→F-507 (two attempts used)** | Attempt 1: C1 MISS, C2 ✓✓, C3 ✓✓ (4/5 clusters). Attempt 2: C1 ✓, C2 ✓✓, C3 MISS both sides (3/5). `assert` exit 4 both times; extractions in `output/attempt*-extracted.txt`. Union = 3/3 with **verbatim planted quotes on both sides** (e.g. att-2 finding 0 = "I forwarded them to my personal email for safekeeping" vs "all relevant documents remained on company servers only"). |
| 9 | Per-contradiction verdicts (union across the two allowed attempts) | C1 **found** (att 2, verbatim both sides) · C2 **found** (both attempts, verbatim both sides) · C3 **found** (att 1: "four-week severance" + "eight (8) weeks of base salary continuation") | run records `output/attempt*-run-record.workflow.json` (findings arrays). |
| 10 | Engine verification of finder citations | **FAIL→F-507(b)** | Both runs: "0 verified; 3 flagged unverified" — llama3.1:8b returned `sourceNumber: None` on every finding, so the engine could not recover citation ids. The honest-by-design half WORKS: attempt 1's fabricated quote ("You didn't save any documents at all." — in neither fixture) was flagged unverified; but real quotes land unverified too, so the signal can't separate fabrication from missing attribution. |
| 11 | Isolation | **PASS (controls observed; truth = leg 1)** | Leg 3 observed the scope surfaces live (All-matters selector, per-message scope chip, "Privileged matter: outside connections are blocked" status chip). The isolation TRUTH claim (Acme never bleeds into Johnson queries and vice versa) is leg 1's, green at commit `2667297` (`rag_deposition_contradictions.rs` isolation tests). No matters were configured in the leg-3 workspace, so cross-matter scoping was not separately exercisable here. |
| 12 | Option B ready handoff (deferred verification item) | **PASS** | `run-10-download-card.png` (card, "about 465 MB … 0 MB so far"), `run-10b-progress.png` (BONUS: interrupted state + "Resume download" — the resumable surface, live), `run-10c-resumed.png` (card gone at Ready, `rag-progress-banner` indexing 1/6 — deferred indexing kicked, no dead gap), `run-11-handoff.png` (complete). Disk truth: 465 MB downloaded into the profile's writable cache; `down` restored the stashed bundle. |
| 13 | Memory profile | **Recorded (F-501, F-416 superseded-extended)** | Successful 3-file pass: whole-scope cgroup peak **3.70 GiB**, keepance-main RSS peak **3.34 GiB** (`logs/cgroup-mem.csv`, `logs/rss.csv`) — already above the campaign's 3G calibration. With huge-notes.md included: OOM-killed at 3G ×2, 6G, 12G (peaks = the cap each time; 188 MB → 6 GiB in ~5 s, → 12 GiB in ~8 s, monotonic, no inter-batch release). |

**Out of scope, restated:** live TLS mail import (F-419) and live audit-event
capture (F-425) stay on the Windows spot check. Bonus observed here: with the
headless keyring up, `<ws>/.keepance/audit-enc.db` was created by the live app
(the audit store initializes; at-rest encryption already proven verbatim in
F-425).

**Model source for the positive pass (stated honestly):** no network was ever
consulted for the embedder — no download card rendered and indexing began
immediately (Option B gate honored). Two local copies existed: the exe-adjacent
bundle (`target/debug/resources/embeddings/…`, 465 MB, all required files) and
the profile pre-seed. `resolve_cache_dir()` (embedder.rs:43-69) prefers the
populated bundle, so the embedder loaded from the **bundle**; atime forensics
are inconclusive under relatime (the bundle's atime predates the session and
cannot bump again; the profile copy shows one mid-session read at 00:31:46 —
consistent with a presence-probe, not a model load). The Option B run is the
inverse: bundle stashed + profile emptied → the 465 MB came from Hugging Face
over the network into the profile cache, observed live.

**Fixture-annotation caveat:** the `[CONTRADICTION-N]` annotation blocks are
part of the indexed fixture text. Chat attempt 1 quoted one back verbatim —
direct evidence the annotations leak into answers and lower the bar for the
LLM. A marker-free fixture variant is a follow-up item, not built here.

## B. Findings register (F-5xx)

| ID | Sev | Leg | Finding | Evidence / cites |
|----|-----|-----|---------|------------------|
| **F-501** | **P1** | 3 | **Embedding a large text file exhausts memory without bound — first index of a 2 MB .md needs >12 GB and OOM-kills the app.** `index_one_file` embeds ALL of a file's chunks through one `embed_documents` call (`src-tauri/src/commands/rag/mod.rs:343`, `batch_size: None`); fastembed 4.9.1 then runs internal batches of 256 (`text_embedding/impl.rs:292` DEFAULT_BATCH_SIZE) over ~384-token chunks (`chunker.rs:15`); huge-notes.md (2,097,878 B ≈ 1,400 chunks) drove the whole-app cgroup 188 MB → cap in seconds, killed at 3G ×2, 6G, 12G — monotonic growth, no release between internal batches. Any single file ≥ ~400 KB of text fills a 256-sequence batch; an 8–16 GB user laptop will swap-storm or die on first index of a modest workspace. Fix direction for the fix wave (NOT applied): bounded `batch_size` (16–32) on `model.embed`, or chunk-batch the `embed_documents` call. Campaign F-416 measured only the no-embed plateau (1.4 GB / 2.05 GB peak) because its model never downloaded — this supersedes that calibration. Evidence: `logs/cgroup-mem.csv` (1 s curves, all four kills), journal `Failed with result 'oom-kill'`, RUNBOOK §2. |
| **F-502** | **P1** | 3 | **Local-only mode workflow runs silently no-op unless the user discovers a per-template model pin.** The start dialog advertises "$0 / runs on your local AI model" (`WorkflowPanel.tsx:383-386` checks `confidentialityMode`), but `handleStartWorkflow`'s resolution chain never consults the mode: `resolveTemplateModel` falls back to a cloud global default (claude) when the template has no `defaultProvider` and no override (`App.tsx:2306-2329`), `resolveWorkflowProvider` then returns `needs-provider` (no cloud key), and the handler `return`s BEFORE creating the workflow folder/tab — so the `needs-provider` banner, which renders inside `WorkflowExecutionTab` (`:318`), has no surface. Net UX: click "Run workflow" → dialog closes → nothing. **This is the root cause of campaign F-422's "interview form did not render" — it was never HMR.** With an Ollama pin set (Settings → Templates), the same click renders the interview and the run completes (`run-08a/b` vs `run-08o`). Sub-finding: the override UI's Ollama model list is hardcoded to `llama3.1:8b`/`qwen2.5:7b` (`TemplateModelSettings.tsx:54`) instead of detecting installed models like the chat surface does — `llama3.2:3b` (the rig's model, the chat default) cannot be selected for workflows; the stale "free-text Other" comment (:33) matches no rendered control. |
| **F-503** | P2 | 3 | **Local models miss the chat citation grammar, so chips don't verify or click through on the local tier.** The system prompt shows numbered source headers (`[N] path paragraph M`) but asks for `[filename paragraph N]` citations (`workspaceCommand.ts:114-138`); llama3.2:3b attempt 1 emitted no citation at all, attempt 2 emitted `[1 paragraph 3]` (number-keyed). Render machinery is fine (chip appears, `run-05c`); resolution by basename fails → live verify never runs (all `verified: undefined` on disk) and the click lands on "Source file not found: 1. Retrieval may be stale. Re-indexing…" (`run-05d`) — which also spuriously triggers a re-index. The sources accordion remains a working click-through path. Fix direction: one citation grammar across context+instruction, or resolve numeric cites to the numbered source. |
| **F-504** | P2 | 2+3 | **Citation click-through opens the source file at the TOP — the cited passage is never brought on screen.** `App.tsx:3518-3536` dispatches `keepance:scroll-to-paragraph`; no editor listens (grep: dispatch site is the only occurrence in src/). Leg 2 proved it in-browser (expected-fail test `wedge-proof.spec.ts:238`, flips the suite red when a listener lands); leg 3 corroborates on the native build (`run-06-clickthrough.png`: deposition opens at line 1; passage at ~line 108). The wedge promise "click-through opens the source passage" currently delivers "opens the source file". |
| **F-505** | P3 | 2 | **Duplicated citation testid:** the sources-accordion rows REUSE the inline chip testid `chat-citation-{basename}-{paragraphIndex}` (`AIChatViewer.tsx:409` vs `:300`), so a bare `getByTestId` resolves to 2 elements once the accordion is open. Leg 2 works around by scoping on the `data-verified` attribute only inline chips carry. |
| **F-506** | **P1** | 2 | **xlsx: SheetJS (production read options, no `sheetStubs`) drops openpyxl-style formula cells with empty cached values — totals render EMPTY and an edit+autosave silently destroys the formulas.** The real damages-model.xlsx stores `<f>SUM(B2:B7)</f><v></v>`; `XLSX.read` (spreadsheet-io.ts:584-589) drops the cell (`ws['B10']===undefined`), `hasFormulas` stays false (:378), no engine attaches, B10/B11 paint empty; on any edit `serializeXlsx` skips null model cells (`if (!cell) continue`, **spreadsheet-io.ts:432**) so the saved artifact omits the formula cells entirely. Recorded at full assertion strength as the expected-fail test in `wedge-proof.spec.ts:322` (tripwire: passes-unexpectedly when fixed). **Reviewer nuances:** a first-edit-per-session `.backup-*` sibling mitigation EXISTS (`fileBackupStore.ts` — backup written on the first user edit of the session), but it is silent (no UI mention at the moment of loss) and a LATER session's first edit snapshots the already-stripped file, so the safety net decays to nothing exactly when the user trusts it most. Same pure-JS path runs in the Tauri webview. Fix direction: `sheetStubs: true` surfaces `{t:'z', f:…}` for the existing engine overlay. |
| **F-507** | P2 | 3 | **Finder rubric not met in a single run after the two allowed attempts — local-model selection floor, not the retrieval feed.** (a) Attempt 1: 4/5 clusters (C1 missed); attempt 2, identical inputs: 3/5 (C3 missed). Each run emits exactly 3 findings and swaps one planted pair for a weaker unplanted one. The feed is exonerated twice over: leg 1 proves the finder's own query at topK 12 deterministically contains both sides of all three (commit `2667297`), and each "missing" side that WAS flagged came back as VERBATIM summary text that exists only in the retrieved store context (e.g. "eight (8) weeks of base salary continuation", att 1; "all relevant documents remained on company servers only", att 2). (b) Both runs: `sourceNumber` absent on every finding → "0 verified; 3 flagged unverified" — the verification chain honestly refuses (it correctly flagged att-1's fabricated quote) but the local tier never produces a verifiable citation. The vision's local-model wedge claim is real but soft at 8B: contradictions surface with verbatim quotes, yet neither completeness-per-run nor verified-citations holds. Honesty over green. |
| **F-508** | P3 | 3 | **AI artifacts feed back into matter memory.** `.aichat` and `.workflow` files are indexable (`extractor.rs:19`) and live in the workspace, so chat answers and run records join the semantic store and compete with primary sources at retrieval (observed: banner counts grew 3→4→6 as artifacts accrued; chat attempt 2 retrieved the chat's own first turn). Possibly intended ("chats are matter record") but it lets derived/AI text outrank source documents and creates feedback loops. Related harness bug (fixed in `wedge-proof-native.sh`): `assert` wrote the docx extraction INTO the workspace, where it would have been indexed. |
| **F-509** | P3 | 3 | **Workflow execution tab hides the sidebar and Ctrl+B (documented "Toggle sidebar") does not restore it while the tab is open**; closing the tab (Ctrl+W) restores the layout. Headless screenshots `run-08o`→`run-09h`. |

## C. Harness-script fixes made during the run (allowed; product untouched)

1. `MemoryMax` recalibrated 3G→12G with the full justification inline
   (the 3G bound was calibrated on a run that never embedded — F-415/F-416).
2. `up` excludes `huge-notes.md` (F-501) — expected fresh-workspace count is 3.
3. `seed-localstorage` also seeds `keepance:settings`
   (confidentialityMode=local-only + featuresTourCompleted, mirroring
   onboarding) and the finder's Ollama template pin (mirroring Settings →
   Templates; required because of F-502 + GTK select-popup input isolation).
4. `assert` extraction no longer lands inside the workspace (contamination);
   rubric now targets the NEWEST docx (two-attempt reruns leave siblings).

## D. What this closes / what stays open

- **F-415** (index never populated on a real machine): CLOSED by claim 1
  (with the headless-Secret-Service requirement now part of the environment).
- **F-117** (cited answer + chips over a populated index): the render+retrieval
  halves are observed live (claims 3, 4); the verified-chip half is blocked by
  F-503 on the local tier — re-verify after the citation-grammar fix.
- **F-422** (finder never completed): the full run now completes to a real
  .docx on the real binary with a local model (claim 7); the launch-time
  silence is root-caused as F-502; output completeness/verification gated by
  F-507. VG-3a's "planted contradictions in a real run" is demonstrated at
  union-level, not yet at single-run rubric level.
- Option B's deferred ready-handoff item: CLOSED (claim 12).
- Attorney-grade output quality: stays VG-7 item 3 (cannot be coded).
