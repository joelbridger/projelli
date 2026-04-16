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
| Q3 | Real-time cost meter | 🔲 Not started | `ProviderMetadata` has pricing fields (v1.0.8+), but chat UI doesn't render cost. Needs aggregation + chip UI |
| Q4 | Monthly cost dashboard | 🔲 Not started | `AuditService` schema has no `tokens_in`/`tokens_out`/`cost_usd` fields. New `CostMetrics.tsx` component needed |
| Q5 | Audit log export (CSV/JSON) | 🔲 Not started | `AuditLog.tsx` has `onExportJSON`/`onExportCSV` callbacks but no serialization |
| Q6 | Audit log filtering | 🔲 Not started | Action-type filter exists; date-range + model filter missing |
| Q7 | Ollama as 4th provider | 🔲 Not started | No `OllamaProvider.ts`; needs Phase 2 Rust HTTP infra first |
| Q8 | Per-template model assignment | 🔲 Not started | `WorkflowTemplate` schema lacks `defaultProvider`/`defaultModel` fields |
| Q9 | Haiku 4.5 free-tier default | 🔲 Not started | Not verified in `settingsStore.ts` defaults — need to check and flip |
| Q10 | Template preview gallery | 🔲 Not started | No `website/templates/` directory; content generation work |
| Q11 | Sample workspace on first run | 🔲 Not started | No `src/onboarding/samples/`; FirstRunWizard has no "populate samples" toggle |
| Q12 | Smart paste URL → link | 🔲 Not started | No clipboard paste handler in MarkdownEditor; needs Phase 2 `fetch_url_title` command |
| Q13 | Image paste auto-save | 🔲 Not started | No clipboard image detection. File drag-drop exists via `GlobalDropOverlay.tsx` + `fileDrop.ts` (v1.0.8) but not per-editor paste |
| Q14 | Wiki-link autocomplete | 🔲 Not started | `WikiLinkParser.ts` has parsing only, no CodeMirror autocompletion extension |
| Q15 | Run-on-all-3 button | 🔲 Not started | `ComparisonView.tsx` scaffolded but not wired from chat input |
| Q16 | `?` shortcut overlay | ✅ Done in v1.0.8 | `src/components/ShortcutsOverlay.tsx` (187 lines), `src/utils/shortcuts.ts` (175 lines) |
| Q17 | `/vs-obsidian`, `/vs-notion` pages | 🔲 Not started | No `website/vs/` directory |
| Q18 | In-app changelog on update | ✅ Done in v1.0.8 | `src/components/WhatsNew.tsx` (191 lines), `src/content/changelog.ts` (78 lines) |
| Q19 | Template fork / remix | 🔲 Not started | No duplicate-template UI; `~/.projelli/user-templates/` path not yet referenced |
| Q20 | API-key onboarding wizard | 🔲 Not started | `ApiKeySetupCard.tsx` exists (v1.0.8) but is a dismissible nudge card, NOT the 3-step guided wizard with screenshots that Q20 specifies |

**Phase 1 net work: 18 of 20 Quick Wins** (Q16 and Q18 already shipped in v1.0.8).

---

## Mediums status

| # | Item | Status | Evidence |
|---|---|---|---|
| M1 | Local RAG (LanceDB + fastembed-rs + e5-small) | 🔲 Not started | No embeddings/vector code anywhere. `src-tauri/Cargo.toml` lacks `lancedb`, `fastembed`. Existing `ContentIndex.ts` is MiniSearch (full-text only) |
| M2 | `@workspace` + Ask-my-workspace | 🔲 Not started | Depends on M1 |
| M3 | Memory facts file + extraction | 🔲 Not started | No memory/facts infrastructure |
| M4 | Projelli MCP server + `.mcpb` bundle | 🔲 Not started | No `src-tauri/src/bin/mcp.rs`, no MCP crate in deps |
| M5 | Side-by-side AI editing | 🔲 Not started | `DiffViewer.tsx` exists (read-only preview, v1.0.x); no inline chat anchor, no per-hunk accept/reject |
| M6 | Voice input via Parakeet.cpp | 🔲 Not started | No sidecar binary, no press-to-talk hotkey. WaveformEditor Web Audio exists (v1.0.x) for reuse |
| M7 | Template chaining | 🔲 Not started | `WorkflowTemplate` schema has no named outputs; no chain config UI |
| M8 | Multi-interview synthesis | 🔲 Not started | `UserInterviews.ts` is single-interview only; no synthesis template |

**All 8 Mediums require work.**

---

## Rust/Tauri foundation status (Phase 2 prerequisite)

| Item | Status |
|---|---|
| `reqwest` dep | 🔲 Not in `Cargo.toml` |
| `tokio` dep (explicit) | 🔲 Not in `Cargo.toml` |
| `notify` file-watcher dep | 🔲 Not in `Cargo.toml` |
| `lancedb` dep | 🔲 Not in `Cargo.toml` |
| `fastembed` dep | 🔲 Not in `Cargo.toml` |
| `keyring` dep | 🔲 Not in `Cargo.toml` |
| MCP Rust SDK dep | 🔲 Not in `Cargo.toml` |
| `src-tauri/src/commands/http.rs` | 🔲 Missing |
| `src-tauri/src/commands/keychain.rs` | 🔲 Missing |
| `src-tauri/src/commands/rag.rs` | 🔲 Missing |
| `src-tauri/src/commands/watcher.rs` | 🔲 Missing |
| `src-tauri/src/bin/mcp.rs` (+`[[bin]]`) | 🔲 Missing |
| `tauri.conf.json:bundle.externalBin` | 🔲 Empty |
| `tauri.conf.json:bundle.resources` for ONNX | 🔲 Empty |
| `tauri.conf.json:plugins.fs.dragDropEnabled` | ✅ Already `true` (v1.0.8 drag-drop upload) — verify |
| CSP allows `http://127.0.0.1:11434` | 🔲 Not in CSP yet |

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
