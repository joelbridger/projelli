# Projelli v1.5 — Release Tracking

> Ticket-by-ticket status for the v1.5 aggressive-scope release. Source of truth for what's done, what's in flight, and what's blocked.
>
> **Plan:** `~/.claude/plans/let-s-do-a-zazzy-muffin.md`
> **Scope:** All 20 Quick Wins (Q1–Q20) + all 8 Mediums (M1–M8). Big Bets B1–B6 deferred.
> **Integration branch:** `release/v1.5` (forked from `master` at `2644a9c` after v1.0.8 sync)
> **Created:** 2026-04-16

---

## Phase 0 — Pre-flight (in progress)

| Step | Status | Notes |
|---|---|---|
| Sync local master to v1.0.8 (`2644a9c`) | ✅ | Was stale at `5a7bb0c`; fast-forward pulled 152 files / 23k+ lines |
| Preserve uncommitted work | ✅ | Stashed, popped on `release/v1.5`, committed in 2 commits (`a8835d7` strategy docs, `f7e9783` website prep) |
| Create `release/v1.5` branch | ✅ | Branched from synced master |
| Re-audit against fresh code | 🟡 | Below |
| Baseline test run | 🔲 | Next |
| Create this tracking doc | ✅ | You are here |

---

## Quick Wins status (re-audited against `2644a9c` + website + release/v1.5 HEAD)

| # | Item | Status | Evidence |
|---|---|---|---|
| Q1 | Mermaid rendering | ✅ Done | Commit `5d154f8` — `mermaid@11.14.0` + `MarkdownPreview.tsx` + 4 new unit tests |
| Q2 | KaTeX math rendering | ✅ Done | Commit `5403b04` — `katex@0.16.45` + `MarkdownPreview.tsx` + 7 new unit tests |
| Q3 | Real-time cost meter | ✅ Done | Commit `6f376ab` — `src/stores/aiChatStore.ts` gains per-chat + per-day cost aggregation (`recordCost`, `useChatCost`, `useTodayCost`, 7-day bucket retention). New `ChatCostChip.tsx` renders "$X this chat / $Y today" above the chat input with a tooltip breakdown by provider. `AIChatViewer.tsx` wires `recordCost` + populates Q4 audit fields on both streaming and non-streaming completions. 14 new unit tests (chat-cost-aggregation + audit-cost-fields). |
| Q4 | Monthly cost dashboard | ✅ Done | Commit `8a2c5bb` — `AuditEntry` extended with optional `tokensIn` / `tokensOut` / `costUsd` / `provider` fields. New `src/components/analysis/CostMetrics.tsx` renders a last-30-days inline SVG bar chart (no chart library), per-provider stacked breakdown, and "This month: $X.XX across Y calls" total. New `costs` category in `src/settings/schema.ts` surfaces it in Settings. `audit-export.ts` `readNumeric` key arrays prefer camelCase top-level fields with legacy fallback. 9 new unit tests. |
| Q5 | Audit log export (CSV/JSON) | ✅ Done | Commit `e5d5cd4` — `src/utils/audit-export.ts` + wired buttons in `AuditLog.tsx` + 34 unit tests. CSV is RFC 4180; future-proof `tokens_in`/`tokens_out`/`cost_usd` columns for Q4 |
| Q6 | Audit log filtering | ✅ Done | Commit `9ed4d65` — date-range + model dropdown + reset button added to `AuditLog.tsx` filter row, composes with existing action-type chips. 6 RTL integration tests |
| Q7 | Ollama as 4th provider | ✅ Done | New `src/modules/models/OllamaProvider.ts` implementing the `Provider` interface (sendMessage + sendMessageStreaming via NDJSON + structuredOutput via `format: 'json'`). `detectOllama()` auto-probes `127.0.0.1:11434/api/tags` from the frontend — the CSP already allows the call (Phase 2) so no Rust round-trip. Always `cost = 0`. New `OllamaSettingsSection` under **Settings → Integrations** shows a status pill, a Check Connection button, and an "Install Ollama" link when the daemon isn't running. `ApiKeyWizard` gains an Ollama tile with a no-key flow that swaps step 3 for a connection check. `TemplateProviderId` already had `'ollama'` in its union. 20 new Vitest tests (`tests/unit/ollama-provider.test.ts`) covering the provider interface, NDJSON parsing, detect branches, and the code-fence cleanup path in `structuredOutput`. |
| Q8 | Per-template model assignment | ✅ Done | Commit `35ae3ea` — `WorkflowTemplate` gains optional `defaultProvider` / `defaultModel` / `isUser`; new `resolveTemplateModel` helper with 7 unit tests; new `templates` Settings category renders a per-template provider + model table persisted under `templateModelOverrides` |
| Q9 | Haiku 4.5 free-tier default | ✅ Done | Commit `b827443` — new `src/utils/defaultModel.ts` helper; `AIAssistantPane.tsx` reads tier from `useLicense` and initializes selectedModels via `getDefaultModelsForTier`; `ClaudeProvider.ts` constructor fallback flipped to Haiku 4.5 |
| Q10 | Template preview gallery | 🔲 Not started | No `website/templates/` directory; content generation work |
| Q11 | Sample workspace on first run | ✅ Done | Commit `7611733` — `src/onboarding/samples/` with 3 Markdown files (Pricing Strategy, Pitch Deck, Weekly Review) plus `index.ts` (`SAMPLE_FILES` + `writeSampleFiles`). `FirstRunWizard.tsx` gains `workspace` prop + `first-run-samples-toggle`. 18 new unit tests. |
| Q12 | Smart paste URL → link | ✅ Done | Commit pending — new `src/modules/editor/smartPaste.ts` with `createSmartPasteExtension` + pure helpers (`isSingleUrl`, `isInsideCodeBlock`, `findUrlPlaceholder`, `resolveUrlPasteReplacement`). CodeMirror `domEventHandlers` intercepts paste, inserts `[Fetching title...](url)` placeholder, swaps in `[title](url)` when the Phase 2 `fetch_url_title` command resolves. Falls back to raw URL on empty title. Selection paste linkifies the selection. Fenced-block / inline-backtick suppression. `markdown-editor-paste-target` + `markdown-editor-url-paste-placeholder` testids. 23 new Vitest tests; jsdom Range polyfill added to `tests/setup.ts` so real editor mounts survive measure phase. |
| Q13 | Image paste auto-save | ✅ Done | Commit pending — extends `src/modules/editor/smartPaste.ts` with `processImageFile`, `hashImageBytes`, `mimeToExtension`, `formatYearMonth`, `buildImageMediaPath`, `IMAGE_PASTE_MAX_BYTES`. `createSmartPasteExtension` now handles `image/*` `DataTransferItem`s before falling through to URL paste. `MarkdownEditor` gains `writeImage` / `hasWorkspace` / `showToast` props (all ref-stable) plus a drop-zone that consumes image files while letting non-image drops fall through to `GlobalDropOverlay`. `MainPanel` wires `writeImage` through `WorkspaceService.writeFileBinary` with a `service.exists(path)` dedupe guard and refreshes the file tree after writes. Out of workspace → toast. >20 MB → toast. Unknown MIME → silent fallthrough. New testids `markdown-editor-image-paste` (with `data-paste-count`). 17 new Vitest tests (15 unit + 2 RTL integration). |
| Q14 | Wiki-link autocomplete | ✅ Done | Commit `22bb36f` — new `src/modules/editor/wikiLinkAutocomplete.ts` with `createWikiLinkCompletionSource` + helpers; wired into `MarkdownEditor.tsx` via `autocompletion({ override: [...] })`; fires on `[[`, filters workspace files by prefix/substring/initials, inserts normalized target and closes with `]]`; 13 unit tests |
| Q15 | Run-on-all-3 button | ✅ Done | New `src/components/chat/RunOnAllButton.tsx` — Pro-tier-only button (gated via `tierHasFeature`) that fires one `sendMessage` per configured non-Ollama provider via `Promise.allSettled`, streams all results into the existing `ComparisonView`, shows per-column **Keep {Label}** buttons that promote the chosen output back into the chat through `onKeep(providerId, content)`, renders a failing provider as an "Error: …" column without blocking the others, and surfaces total cost under the comparison view. When an `analysisProvider` is supplied the first two successful outputs are passed through `ContradictionDetector.detect()` to populate agreement score + contradictions. Disabled for free tier, single-provider setups (Ollama alone doesn't count), or an empty prompt. 6 new RTL tests (`run-on-all-3.test.tsx`) cover all five behaviours listed above plus tier gating. |
| Q16 | `?` shortcut overlay | ✅ Done in v1.0.8 | `src/components/ShortcutsOverlay.tsx` (187 lines), `src/utils/shortcuts.ts` (175 lines) |
| Q17 | `/vs-obsidian`, `/vs-notion` pages | 🔲 Not started | No `website/vs/` directory |
| Q18 | In-app changelog on update | ✅ Done in v1.0.8 | `src/components/WhatsNew.tsx` (191 lines), `src/content/changelog.ts` (78 lines) |
| Q19 | Template fork / remix | ✅ Done | Commit `147ead3` — new `src/modules/workflow/userTemplates.ts` with swappable storage adapter (localStorage default, in-memory for tests, filesystem-ready for Tauri); `WorkflowPanel.tsx` gains Duplicate + Delete buttons, Custom badge, and a `TemplateForkModal` that edits name + first-generate-step systemPrompt; 14 unit tests |
| Q20 | API-key onboarding wizard | ✅ Done | Commit `a69e144` — new `ApiKeyWizard.tsx` (3-step modal: open console → illustrated mock → paste + validate + save) with provider selector tabs. `ApiKeySetupCard.tsx` gains optional `onSaveKey` prop; when passed, the CTA launches the wizard. 7 new unit tests. |

**Phase 1 net work: 18 of 20 Quick Wins** (Q16 and Q18 already shipped in v1.0.8).

---

## Mediums status

| # | Item | Status | Evidence |
|---|---|---|---|
| M1 | Local RAG (LanceDB + fastembed-rs + e5-small) | ✅ Done | Commits `550c730` (Rust RAG engine: chunker + embedder + LanceDB store + 6 commands), `889bb36` (TS bindings + MemoryService toggle wrapper + 12 unit tests), `2bb410b` (UI banner + status badge + settings toggle + watcher integration + useRagStatus hook + 7 unit tests). Vector store at `<workspace>/.projelli/vectors/`, 384-dim e5-small via fastembed-rs, paragraph-aware chunker, watcher-driven incremental re-index, `Settings → Memory` opt-out. 56 Rust tests + 19 new TS tests. |
| M2 | `@workspace` + Ask-my-workspace | ✅ Done | Commits `bd6b818` (`@workspace` parser + `<workspace_context>` injection + Ask-my-workspace per-chat toggle + citation chips + Sources accordion + `workspace-command-chip` / `ask-workspace-toggle` / `chat-sources-accordion` / `chat-citation-{path}-{paragraph}` testids + 27 unit tests), `bfc4f1c` (UI mount tests + scrollIntoView jsdom polyfill + 14 more unit tests). Retrieval goes through `MemoryService.retrieve(query, 8)` so the Settings toggle is respected. Provider-agnostic — Claude, OpenAI, Gemini all receive the same `<workspace_context>` block via their existing `systemPrompt` entrypoint. Graceful degrade: memory off / retrieval error surfaces a subtle inline "this message wasn't workspace-aware" hint. Citation clicks fire `onOpenFileAtPath` → App.tsx opens the file and dispatches `projelli:scroll-to-paragraph`. 41 new TS tests (17 command-parser + 10 prompt-injection + 8 Ask-mode + 6 citation-nav). |
| M3 | Memory facts file + extraction | ✅ Done | Commits `5ad53e9` (FactsService + `<memory>` prompt injection + settings schema + 22 unit tests), `d03acaf` (fact extraction state machine + `ProposedFactsPanel` chat UI + auto-accept path + 22 more unit tests). Facts live at `<workspace>/.projelli/memory.json` with atomic tmp-rename writes and defensive parsing. `<memory>` block sits BEFORE `<workspace_context>` in the system prompt so durable facts frame every response. Extraction fires every 10 messages via `Provider.structuredOutput`; proposed facts show Accept / Edit / Reject chips with explicit user approval required by default. 5 consecutive rejects mute a chat for the session. New settings: `factsInjection` (default ON), `factsAutoAccept` (default OFF). 44 new TS tests: CRUD + atomic write + schema version handling; throttling + reject giveup + error-silent-skip; prompt block format + ordering; RTL panel test. |
| M4 | Projelli MCP server + `.mcpb` bundle | ✅ Done | Commits `97ed333` (real MCP server binary: hand-rolled JSON-RPC 2.0 over stdio with the five tools from the M4 spec — `list_workspace_files`, `read_workspace_file`, `search_workspace`, `write_workspace_file`, `get_memory_facts`. Reuses the M1 embedder + LanceDB store read-only so MCP retrieval matches `@workspace` quality bit-for-bit. Path-traversal + symlink-escape blocked. 28 binary unit tests + 5 `tests/mcp_binary.rs` integration tests that spawn the child and drive `initialize` / `tools/list` / `tools/call`), `a8fc382` (`.mcpb` Desktop Extension bundle: dependency-free zip writer in `scripts/build-mcpb.mjs` + manifest matching Anthropic's DXT spec + GitHub Actions build-and-upload step on both Mac/Linux matrix and Windows job; 5 Vitest tests for the PKZIP wire format), `de19163` (Settings → Integrations UX: `McpSettingsSection` with status pill + Download button + install readme, `McpApprovalModal` with inline diff preview + three-action buttons — Approve this write / Approve all this session / Deny. Cross-process approval channel uses a temp-dir file rendezvous so the sidecar works regardless of which MCP client spawned it. Three new host Tauri commands: `mcp_list_pending_approvals`, `mcp_approve_write`, `mcp_bundle_path`. 14 RTL tests). **Crate choice**: hand-rolled, not `rmcp`. Five tools is tractable, the binary stays small (~151 MiB stripped — dominated by LanceDB + fastembed, which we already pay for in the Memory feature), and `rmcp`'s schemars + proc-macro deps stay out of the crate graph. `mod commands` flipped to `pub` in `src-tauri/src/lib.rs` so the binary can share the M1 `store` + `embedder` + `extractor` modules without a workspace refactor. |
| M5 | Side-by-side AI editing | ✅ Done | Commits `230524d` (engine + UI primitives + hook + VersionService attribution + selection-anchor + streaming-diff tests), `6f6433e` (MarkdownEditor wiring + hunk-accept-reject + m5-history-attribution tests), `3028d02` (PlainTextEditor port). New engine under `src/modules/editor/aiEdit/` (types + `streamingDiff.ts` + `editPrompt.ts`). New UI `src/components/editor/InlineChatAnchor.tsx` + `StreamingDiffOverlay.tsx` + `useInlineAiEdit.ts` (pluggable `EditorAdapter` + CodeMirror adapter factory). `FileVersion` gains optional `author` + `aiMetadata` (prompt / model / hunkIndex / hunkRange) with backward-compatible `saveVersion(..., options?)`. Ctrl/Cmd+Shift+E keyboard shortcut. data-testids: `inline-chat-anchor`, `inline-chat-input`, `inline-chat-submit`, `streaming-diff-region`, `hunk-accept-{index}`, `hunk-reject-{index}`, `diff-accept-all`, `diff-reject-all`. 44 new Vitest tests (streaming-diff + selection-anchor + hunk-accept-reject + m5-history-attribution). Editors shipping M5 today: MarkdownEditor + PlainTextEditor. RichTextEditor (TipTap), DocxEditor, RtfEditor are TODO for a follow-up. Diff algorithm: re-uses existing LCS `src/utils/diff.ts` (no new npm dep). |
| M6 | Voice input via Parakeet.cpp | ✅ Done (binary TODO) | New `src-tauri/src/commands/voice.rs` exposes `voice_sidecar_available()` + `transcribe_audio(wav_bytes, model?)` that pipes WAV bytes into a bundled Parakeet/whisper.cpp subprocess, captures stdout, returns `{ text, latencyMs }` with a 30s timeout. `resolve_sidecar_path` looks for `binaries/parakeet[.exe]` or `binaries/whisper[.exe]` under the Tauri resource dir (production) with a dev-build fallback in `src-tauri/binaries/`. 8 new Rust tests (arg-building, binary discovery, spawn-failure). Frontend: `VoiceCapture` wraps `getUserMedia` + `MediaRecorder` + an AudioContext re-encoding pass into 16 kHz mono 16-bit WAV. `usePressToTalk` registers `Ctrl+Shift+Space` (insert into focused input) and `Ctrl+Shift+N` (save transcript to `Inbox/note-<ISO>.md`); `PressToTalkIndicator` renders a pulsing mic badge while recording. `data-testids`: `ollama-settings-section`, `ollama-status`, `ollama-check-connection`, `voice-settings-section`, `voice-status`, `press-to-talk-indicator`, `voice-model-select`. New Voice settings category (schema-driven) surfaces enable toggle, model select (tiny/base/small), read-only hotkey displays, and a status pill that reports "Voice ready / Sidecar missing / Mic permission denied". 14 new Vitest tests (`voice-capture.test.ts` + `press-to-talk.test.tsx`). **Platform coverage:** code paths are cross-platform; the CI `Fetch voice sidecar binary` step ships for Mac/Linux/Windows but is gated on a `VOICE_SIDECAR_URL` repo variable — until a reliable per-platform Parakeet.cpp or whisper.cpp release artifact is pinned, voice features render "Sidecar missing" at runtime and the docs/settings surface both say "binary required". |
| M7 | Template chaining | ✅ Done | Commits `835ec6d` (schema: `namedOutputs` + `namedInputs` on `WorkflowTemplate`; 4 templates annotated — CompetitorAnalysis, PricingStrategy, UserInterviews, CustomerPersona; `Chain` button in `WorkflowPanel`; `ChainBuilderModal` step-by-step UI with Recommended / Manual-mapping optgroups driven by `acceptsOutputFrom`; `ChainSuggestions` callout on completed workflow tabs), `acf7aa9` (`WorkflowChainEngine.runChain` sequential executor with per-step warnings; `extractNamedOutputs` with direct-key / suffix-match / last-generate-step fallback; `workflowChains.ts` JSON persistence adapter — localStorage in the browser, `.projelli/chains/<id>.json`-ready for Tauri; 15 new Vitest tests covering round-trip, save/load, named-output resolution, input mapping, two-step MockProvider pipeline). |
| M8 | Multi-interview synthesis | ✅ Done | Commit `6f3ad53` — new `src/modules/analysis/MultiInterviewSynthesis.ts` (`summarizeTranscript` Phase A + `synthesizeTranscripts` Phase B + `runMultiInterviewSynthesis` orchestrator with `Promise.all`-parallel Phase A + `splitPastedTranscripts` divider parser). New `src/components/analysis/MultiInterviewSynthesisPanel.tsx` with drag-drop `.md` / `.txt` zone, paste-with-`---`-divider import, collapsible themes, amber-highlighted contradictions, JTBD table, urgency-coded priority features, and `renderSynthesisMarkdown` Markdown export. New `UserInterviewsSynthesis` workflow template registered in `src/modules/workflow/index.ts`. Structured output schema covers `themes: [{ name, frequency, quotes }]`, `killer_quotes`, `contradictions: [{ statement_a, statement_b, sources }]`, `jtbd_frameworks: [{ job, current_solution, friction }]`, `priority_ranked_features: [{ feature, frequency, urgency, supporting_quotes }]`. 8 new Vitest tests verify Phase-A-per-transcript, Phase-A parallelism (max-in-flight = 3), Phase-B prompt composition, schema shape, zero-transcript rejection, and paste-divider parsing. |

**8 of 8 Mediums shipped (M1, M2, M3, M4, M5, M6, M7, M8). All Mediums complete for v1.5.**

**Flag 1 (Memory) is complete.** M1 (RAG) + M2 (@workspace / Ask-mode) + M3 (facts) together make "the AI workspace that remembers your stuff" the headline capability of v1.5.

**Flag 2 (MCP server) is complete.** M4 makes "your workspace, available in every AI tool you use" a real ship: install the `.mcpb` into Claude Desktop, Cursor, or Zed and every client can list, read, semantic-search, and (with user approval) write your workspace files.

**Flag 3 (side-by-side AI editing) is complete.** M5 makes "AI edits your doc next to you, you take only what you like" real. Select any text in a Markdown or plain-text editor, ask for a revision, watch a streaming diff land right where the selection was, and Accept / Reject each hunk individually. Every accepted hunk is recorded in version history with `author: 'ai'` + prompt + model + offset range so you can see exactly what the AI changed and roll it back. RichTextEditor (TipTap), DocxEditor, RtfEditor are TODO for a follow-up commit.

**Flag 4 (offline voice + local models) is complete.** Q7 ships the Ollama provider so founders with a laptop and a model pulled locally get free, zero-network inference wired into the same chat surface as Claude/OpenAI/Gemini. M6 ships the voice input stack: press-to-talk inserts transcribed speech into whatever text field is focused; a second hotkey writes the transcript to `Inbox/`. Transcription runs through a bundled Parakeet.cpp (whisper.cpp fallback) sidecar over stdin/stdout with a 30-second timeout. Audio never leaves the machine. The sidecar binary itself is fetched by CI when `VOICE_SIDECAR_URL` is set; until that URL is pinned to a per-platform release, voice UI renders "Sidecar missing" at runtime.

**All 8 Mediums are complete.** M7 (template chaining) and M8 (multi-interview synthesis) close out the set alongside Q15 (run-on-all-3). M7's output annotations on `CompetitorAnalysis`, `PricingStrategy`, `UserInterviews`, and `CustomerPersona` unlock the common chains founders asked for — "Competitor Analysis → Pricing Strategy", "User Interviews → Customer Persona". M8 turns a folder of transcripts into a structured synthesis (themes + contradictions + JTBD + priority features) in one click. Q15 lets Pro-tier users send the same prompt to every configured provider in parallel and keep the best answer with one button.

---

## Rust/Tauri foundation status (Phase 2 prerequisite)

Phase 2 landed in 3 commits on `release/v1.5`. See the "Commit log" table
below for SHAs.

| Item | Status |
|---|---|
| `reqwest` dep | ✅ Done (Phase 2) — 0.12 with `json` + `stream` + rustls-tls |
| `tokio` dep (explicit) | ✅ Done (Phase 2) — 1.x with `full` feature |
| `futures-util` dep (for stream bail-out in `fetch_url_title`) | ✅ Done (Phase 2) |
| `notify` file-watcher dep | ✅ Done (Phase 2) — v6 |
| `lancedb` dep | 🔲 Phase 3 (M1) — deferred per plan, adds ~500MB compile weight |
| `fastembed` dep | 🔲 Phase 3 (M1) — deferred per plan |
| `keyring` dep | ✅ Done (Phase 2) — v3 with apple-native, windows-native, sync-secret-service |
| MCP Rust SDK dep | 🔲 Phase 4 (M4) — crate name pending verification, only the `[[bin]]` stub exists today |
| `src-tauri/src/commands/http.rs` | ✅ Done (Phase 2) — `fetch_url_title` real; Ollama commands stubbed for Phase 4 |
| `src-tauri/src/commands/keychain.rs` | ✅ Done (Phase 2) |
| `src-tauri/src/commands/rag.rs` | ✅ Done (Phase 2) — stubs only; Phase 3 M1 replaces bodies |
| `src-tauri/src/commands/watcher.rs` | ✅ Done (Phase 2) — singleton watcher + 200 ms debouncer |
| `src-tauri/src/bin/mcp.rs` (+`[[bin]]`) | ✅ Done (Phase 2) — stub exits 0; release pipeline cross-compiles per platform |
| `src-tauri/binaries/` staging dir | ✅ Done (Phase 2) — populated by release workflow |
| `src-tauri/resources/embeddings/` staging dir | ✅ Done (Phase 2) — Phase 3 M1 drops e5-small here |
| `tauri.conf.json:bundle.externalBin` | 🟡 Empty array kept; Phase 4 populates once MCP + Parakeet sidecars exist |
| `tauri.conf.json:bundle.resources` for ONNX | ✅ Done (Phase 2) — set to `["resources/**/*"]` |
| `tauri.conf.json:plugins.fs.dragDropEnabled` | ✅ Already wired (v1.0.8 drag-drop upload) — verified |
| CSP allows `http://127.0.0.1:11434` | ✅ Done (Phase 2) — appended to `connect-src` |
| `docs/reference/TAURI_COMMANDS.md` reference doc | ✅ Done (Phase 2) |
| `src/utils/tauri-commands.ts` TS bindings for new commands | ✅ Done (Phase 2) |
| Release workflow builds + stages `projelli-mcp-<target>` | ✅ Done (Phase 2) — Mac/Linux and Windows jobs both build release binary |

**Phase 2 verification (local, release/v1.5):**
- `cargo build` — clean
- `cargo build --bin projelli-mcp` — clean, stub prints marker + exits 0
- `cargo clippy --all-targets -- -D warnings` — clean
- `cargo test -p projelli` — 29 passed, 0 failed (13 http + 7 keychain + 2 rag + 7 watcher)
- `npm run typecheck` — clean
- `npm run test` — 288 passing / 23 failing (unchanged from v1.0.8 baseline; no new regressions)

---

## Things v1.0.8 shipped that weren't on the original plan but benefit v1.5

Discovered during the re-audit — confirmed present in `2644a9c`:

- **Auto-updater** (`updaterStore.ts`, `UpdateBanner.tsx`, `UpdateManager.tsx`, `UpdateReleaseNotesModal.tsx`) — v1.5 delivery to v1.0.8 users is already wired
- **Branded start screen** (`brand/ProjelliLogo.tsx`, `brand/GradientGlow.tsx`) — the v1.5 launch copy can reuse this
- **Schema-driven settings** (`src/settings/schema.ts` 305 lines, `SettingsModal.tsx` 635 lines) — Q8 per-template model config can plug into this schema rather than building a new settings surface
- **Full-text search** (`ContentIndex.ts` 271 lines, MiniSearch) — complements M1 RAG; the two will live side-by-side (keyword + semantic)
- **Quick Open Ctrl+P** (`QuickOpen.tsx` 291 lines, fuse.js)
- **Document suite** (xlsx, csv, docx, pptx, rtf editors/viewers, in-house formula engine) — M1 chunking must handle these extractable types
- **Workflow execution as files** (`WorkflowExecutionTab.tsx`, `workflowFile.ts`) — M7 chaining persists state in this existing format
- **Global drop overlay** (`GlobalDropOverlay.tsx`, `fileDrop.ts`) — Q13 image paste can reuse the drop infrastructure; editor-specific paste still needed

---

## Phase-to-ticket map

| Phase | Items |
|---|---|
| **Phase 1 — Independent QWs** | Q1, Q2, Q3, Q4, Q5, Q6, Q8, Q9, Q11, Q14, Q19, Q20 (12 items). Q16 and Q18 already ✅. Q12, Q13 deferred until Phase 2 infra. Q7, Q10, Q15, Q17 per their respective phases. |
| **Phase 2 — Rust/Tauri foundation** | Cargo deps + new commands + sidecar infra + CSP + MCP bin stub |
| **Phase 3 — Flag 1** | M1 → M2 → M3. Plus Q12 + Q13 (they only need a subset of Phase 2 infra) |
| **Phase 4 — Flags 2+3+4** | M4 (Track A) + M5 (Track B) + M6 + Q7 (Track C) in parallel |
| **Phase 5 — Workflow extensions** | M7 + M8 + Q15 |
| **Phase 6 — Website** | Q10 (gallery) + Q17 (/vs pages) + homepage update + v1.5 launch blog post |
| **Phase 7 — RC + dogfood** | Regression tests + `v1.5-rc.N` iteration |
| **Phase 8 — Ship** | Tag v1.5, publish, deploy |

---

## Commit log on `release/v1.5`

| SHA | Summary |
|---|---|
| `a8835d7` | Add April 2026 market assessment docs (9 files, 3360 lines) |
| `f7e9783` | Preserve pre-v1.5 website prep: favicons, em-dash removal, new blog post |
| `51e8aab` | Add v1.5 release tracking doc with re-audit + baseline results |
| `5d154f8` | Q1 — Add Mermaid diagram rendering to markdown preview |
| `5403b04` | Q2 — Add KaTeX math rendering to markdown preview |
| `e5d5cd4` | Q5 — Implement real audit log export to JSON and CSV |
| `9ed4d65` | Q6 — Audit log filtering by date range and model |
| `b827443` | Q9 — Claude Haiku 4.5 as free-tier default model |
| `7611733` | Q11 — Seed sample workspace files on first run |
| `a69e144` | Q20 — Guided 3-step API-key onboarding wizard |
| `6f376ab` | Q3 — Real-time API cost chip in chat pane |
| `8a2c5bb` | Q4 — Monthly cost dashboard in Settings |
| `35ae3ea` | Q8 — Per-template model assignment |
| `22bb36f` | Q14 — Wiki-link autocomplete in CodeMirror |
| `147ead3` | Q19 — Template fork / remix |
| `550c730` | M1 (1/3) — RAG engine: Cargo deps + chunker + embedder + LanceDB store |
| `889bb36` | M1 (2/3) — RAG frontend bindings + MemoryService toggle wrapper |
| `2bb410b` | M1 (3/3) — UI progress banner + status badge + Memory settings toggle + watcher integration |
| `bd6b818` | M2 (1/3) — `@workspace` command + Ask-my-workspace toggle + citation navigation |
| `bfc4f1c` | M2 (2/3) — Ask-workspace mode + citation navigation UI tests |
| `5ad53e9` | M3 (1/3) — FactsService + `<memory>` prompt block + settings toggles |
| `d03acaf` | M3 (2/3) — Fact extraction + chat UI + settings panel |
| `60413dd` | Q12 — Smart paste URL → Markdown link |
| `b6330ba` | Q13 — Image paste auto-save to workspace/media |
| `97ed333` | M4 (1/3) — Real Projelli MCP server binary (JSON-RPC 2.0 over stdio) |
| `a8fc382` | M4 (2/3) — `.mcpb` Desktop Extension bundle + CI release step |
| `de19163` | M4 (3/3) — Settings → Integrations UX + approval modal + host bridge |
| `230524d` | M5 (1/4) — Inline AI edit engine + selection anchor UI + version attribution |
| `6f6433e` | M5 (2/4) — Wire inline AI edit into MarkdownEditor + hunk accept/reject tests |
| `3028d02` | M5 (3/4) — Port inline AI edit to PlainTextEditor |
| `<pending>` | Q7 — Ollama provider + detect + Settings section + Wizard tile |
| `<pending>` | M6 (1/3) — Voice Rust command + sidecar path resolution + CI hooks |
| `<pending>` | M6 (2/3) — VoiceCapture + press-to-talk hook + indicator |
| `<pending>` | M6 (3/3) — Voice-to-note + Voice settings panel + tests |

---

## Baseline test state (captured 2026-04-16 on `release/v1.5` at `f7e9783`)

**Typecheck:** ✅ Clean (after `npm install` to sync node_modules with v1.0.8 deps)

**Vitest unit + integration:** 155 passing, 23 failing out of 178 total (11 files pass, 3 files fail)

Failing files (treat as v1.0.8 floor; any new failure = regression we introduced):
- `tests/App.test.tsx` — 1 failure (workspace selector dialog title render)
- `tests/integration/workspace.test.ts` — 20 failures (mock backend `Path not found` — looks like mock setup drift from the workspace integration layer, not real workspace regressions)
- `tests/unit/docx-roundtrip.test.ts` — 2 failures (data URL round-trip byte-identity)

**Playwright E2E:** Not run at baseline. 64+ spec files on `release/v1.5` per the pull. Will run during Phase 7 full regression.

**Lint:** Not run at baseline; will add ESLint/Prettier checks to per-phase CI expectations.

**Rule going forward:** a phase wave is not "done" until `npm run test` shows ≤23 failing tests and `npm run typecheck` is clean. New tests added by each wave must pass.

---

## Guardrails reminder

Always consult before any design decision: `docs/strategy/market-assessment-2026-04/08-RISKS_AND_ANTIPATTERNS.md`. Hard NOs:
- No Projelli-managed AI tier
- No cloud sync
- No real-time collaboration
- No autonomous multi-agent orchestration (M7 is user-triggered sequential, not agents)
- No "AI co-founder" / emotional-support positioning
- No plugin/extension marketplace (MCP ≠ plugin API)
- No mobile app
- No scope creep within items
- No em dashes in any Projelli copy (`feedback_no_em_dashes.md`)
