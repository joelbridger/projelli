# Advisor Prep Hero 3.0 — Codebase Reorg: Next-Session Handoff (2026-06-16)

> **Read first:** the plan `~/.claude/plans/you-are-my-ceo-spicy-pudding.md`, the
> memory file `project_keepance_reorg.md`, then this doc. This is the
> feature-first reorganization to make the codebase match the 3.0 law-practice
> product (it had accreted sediment from the "projelli" notes-app and the general
> "AI workspace" eras).

## ✅✅ REORG COMPLETE (2026-06-17, session 3) — feature-folder migration (Phase 4b–e) + Phase 5 finalize DONE

**HEAD `e59af41`** (branch `keepance-3.0`, local==origin, tree clean). **Gates: `npm run typecheck` 0; `npx vitest run` 3133 passed / 3 skipped** (269 files; +1 = the new architecture guard test, the only count change — no behavior tests lost). 24 commits this session, all behavior-preserving, gates green per commit, all pushed. **Nothing deployed** (commercial product — needs explicit go).

### The codebase is now feature-first: `src/{app, features, platform, ui, lib}`
- **`features/`** (11 product surfaces): account, ask, audit, dictation, documents, email, firm, matters, onboarding, settings, workflows.
- **`platform/`** (cross-cutting capabilities by domain): providers, fs, rag, firm, matter, audit, privacy, search, history, licensing, analysis, updater, profile, settings, state, tools, voice, hooks, utils, types.
- **`ui/`** (design system: Radix primitives + `ui/kp/` + brand + shared presentational SurfaceHeader/ConfirmDialog/EmptyState), **`lib/`** (domain-free leaf utils), **`app/`** (the shell: App.tsx/main.tsx + `src/app/{shell,lifecycle,dialogs,commands,fileOps,workflow,hooks}`).
- The old layer dirs (`components/`, `modules/`, `stores/`, `hooks/`, `utils/`, `types/`) are **gone**.

### What was done
1. **Feature migration** — moved each surface one-commit-at-a-time (email→audit→dictation→account→onboarding→workflows→ask→documents→matters→firm→settings), then ui, app/shell, platform modules, stores, and shared hooks/utils/types. Tooling: a deterministic codemod (`/tmp/reorg-move.mjs`) doing `git mv` + `@/`-specifier rewrite + `src/`-path-literal rewrite; whole-dir moves to distinct dest subpaths (barrel/relative-safe). Every commit: my own `git diff --stat` + `tsc` + full `vitest` (NOT agent prose). Done centrally (the codemod is deterministic + cheap; central run avoided the prior fabrication risk).
2. **Dropped the `Reimagined` prefix** everywhere (10 files + 372 identifier/path/test-id occurrences; pure rename).
3. **Clean 5-layer DAG** `lib ← ui ← platform ← features ← app` — eliminated all platform→feature edges (matterAtAGlance + sample-matter seed → platform/matter; the FileTree/WorkspaceSelector file-nav UI → features/documents/workspace). **Added `tests/unit/architecture-boundaries.test.ts`** that machine-enforces no-upward-imports + a documented 11-edge feature↔feature allowlist.
4. **Collapsed aliases** to the single `@/*`→`src/*` catch-all (removed the 8 dead per-layer aliases from tsconfig/vite/vitest).
5. **Docs**: added **`ARCHITECTURE.md`** (canonical map — read it first for anything structural); flipped CLAUDE.md's reconciliation note to DONE and flagged its historical Directory-Structure/Key-Files sections.

### Deferred (intentionally — low value / needs tooling / behavior-risk vs marginal gain; NONE blocking)
- **The 3 matter-store alias shims** (`platform/matter/{matterUiStore,matterSyncStore,matterAtAGlanceStore}.ts`) — thin re-exports of `useMatterStore` that also hold a few matter UI types + the `isWorkingSurface` helper. The real sediment (4 scattered matter stores) is gone — they're one store + 3 co-located thin shims. Removing the last 3 means relocating those types/helper into matterStore + repointing ~20 importers; harmless to leave.
- **Orphaned i18n keys** (16 whiteboard entries in `src/locales`, + the license-unlocks "Whiteboard,…" string) — dead translations for removed features; harmless. Removal needs the `i18n:extract` tool + snapshot update.
- **9 stale "reimagined shell" prose comments** — cosmetic.
- **App.tsx (~1280 lines)** + a few giant components (SettingsContent 1120, AIChatViewer 1343) — explicitly accepted/deferred in the session-2 sections below as out-of-scope safe-tier leftovers, not migration work.

### Recovery / tooling
- Restore point unchanged: `git reset --hard refs/tags/backup/pre-reorg-2026-06-16`.
- Codemods used (throwaways in `/tmp`, not committed): `reorg-move.mjs` (move+codemod), `reorg-deprefix.mjs` (Reimagined strip), `reorg-classify.mjs` (the platform-vs-feature analyzer). Progress ledger: `.git/sdd/progress.md`.

---

## LATEST UPDATE (2026-06-17, session 2) — Phase 4a store merge DONE; feature migration is NEXT (fresh) ✅

**HEAD `076a789`** (local==origin, tree clean). This session landed, on top of the giant-component splits:

| Commit | What |
|---|---|
| `f154c9e` | `ReimaginedAsk` logic → `useAsk` fat-hook (928→455; pure render) |
| `3317577` | `AIChatViewer` send+compress → `useChatSending` (2307→1343) |
| `f56801e` | docs: record the atomic moves |
| `076a789` | **Phase 4a: 4 matter stores → 1** (multi-key persist adapter + hydration contract) |

**Gates green throughout:** `npm run typecheck` 0; `npx vitest run` **3132 passed / 3 skipped** (268 files; +8 from the new hydration test).

### Phase 4a matter-store merge — DONE (commit `076a789`)
- `matterUiStore` + `matterSyncStore` + `matterAtAGlanceStore` merged into `useMatterStore` as 4 slices (`matters` / `snapshots` / `cache` / `statusByMatterId`).
- **Multi-key `storage` adapter** (`multiKeyMatterStorage` in `src/stores/matterStore.ts`) preserves all 3 legacy localStorage keys byte-compatibly: read reassembles from `keepance:matters` (+ runs the v1→v4 matters migrate), `keepance:matter-ui-snapshots`, `keepance:matter-at-a-glance`; write splits state back into the same 3 keys in their legacy `{state,version}` envelope. The sync slice is ephemeral (omitted from `partialize`, never written).
- The 3 sibling files are now thin **alias shims** (`useMatterUiStore`/`useMatterSyncStore`/`useMatterAtAGlanceStore` → `useMatterStore`) that keep their types + pure helpers, so all ~53 importers are unchanged. The feature migration folds them away later.
- **Data-safety contract:** `tests/unit/matter/matterStoreMerge.test.ts` (hydrate from each legacy key, v1 migration, all-3-together, fresh defaults, writes-preserve-3-keys, ephemeral-sync-never-persisted).
- **profile+profession deliberately NOT merged** (judgment call): `professionStore` uses *manual* localStorage on the onboarding-shared key `keepance_profession`, so folding it into the zustand/persist `profileStore` would entangle two persistence mechanisms + risk the shared onboarding contract — messier, not cleaner. Left as two focused stores. (A real merge would need its own dual-mechanism adapter for a −1 store — not worth it.)

### ⏭️ WHAT'S NEXT — the feature-folder migration (Phase 4b–e), THE big one, fresh-session work
Largest + most disruptive remaining step (~547 `src` ts/tsx files). **Groundwork done this session — use it:**
- **Current shape is LAYER-based:** `src/components/` (**33 subdirs**), `src/modules/*`, `src/stores/` (20), `src/hooks/` (29), `src/utils/` (29), `src/types/` (14), `src/lib/` (4), `src/app/` (the Phase-3 shell).
- **Target (plan):** `src/{app,features,platform,ui,lib}`. Each feature *gathers* its files from the multiple current layer-dirs (e.g. Email = `components/mail/` + mail bits of `components/chat/` + `stores/mailStore` + `utils/mail-commands` + mail types).
- **Existing aliases live in 3 files — update all 3:** `tsconfig.json`, `vite.config.ts`, `vitest.config.ts` (currently `@/*`, `@/components/*`, `@/modules/*`, `@/stores/*`, `@/hooks/*`, `@/types/*`, `@/utils/*`, `@/lib/*`, `@/tools/*`).
- **Approach (plan §4b–4e):** add `@/app`/`@/features`/`@/platform`/`@/ui` aliases (keep the old ones as shims so nothing breaks at once) → move ONE feature per commit, smallest first (email → audit → workflows → ask → documents → matters → firm → settings), then platform modules → **codemod the imports, never hand-edit** → `typecheck` + full `vitest` green between each → drop the `Reimagined` prefix per surface once there's no legacy twin. A bad move = a 1-feature revert, not a 547-file untangle.
- **Delegation:** the per-feature move + import-codemod is mechanical → safe to delegate to **Sonnet subagents** with a tight spec, but **verify centrally** (`git diff --stat` + your own `tsc` + `vitest` + confirm `git rev-parse HEAD` actually advanced — a subagent fabricated a report earlier; trust artifacts, not prose).

### Then Phase 5 — finalize (after the migration)
Rewrite `CLAUDE.md` Directory-Structure/Key-Files/Architecture sections to the new tree; add `ARCHITECTURE.md` (5-layer DAG `lib ← ui ← platform ← features ← app`, "features never import features"); i18n sweep (orphaned whiteboard/markdown keys + the license-unlocks string); final `projelli`/`Reimagined`/stale-string sweep; remove the back-compat alias shims + the matter-store alias shims.

### Optional safe-tier leftover
`SettingsContent` (1120) can still go under 800 via the same safe-tier extraction (SettingRow / SubSection / AccordionSection / ShortcutsSection / section-renderers) — low-risk, off the critical path.

---

## LATEST UPDATE (2026-06-17, continued) — BOTH deferred atomic moves DONE ✅

The two risky deferred fat-hook moves (item 1 below) are **DONE, byte-verbatim, gates green, pushed.** **HEAD: `3317577`** (local==origin).

- **`ReimaginedAsk` → `useAsk`** (commit `f154c9e`): the entire logic layer (state, refs, 7 effects, recent-session derivations, `handleAsk` orchestrator) moved verbatim into `src/components/ai/useAsk.ts`; `ReimaginedAsk.tsx` 928 → 455 lines is now a pure render over the hook's return (typed via exported `UseAskProps`). All 3 moved slices (jsdoc/logic/render) confirmed byte-verbatim.
- **`AIChatViewer` send+compress → `useChatSending`** (commit `3317577`): the coupled unit `buildFastProvider` + `handleManualCompress` + the ~908-line `handleSendMessage` moved verbatim into `src/components/ai/hooks/useChatSending.ts` (ordered bfp→hmc→hsm to kill the forward-ref/TDZ). Deps arrive via a `UseChatSendingDeps` object destructured at top → bodies + dep arrays copy verbatim (exhaustive-deps left untouched per the rule). Compression-modal STATE + `handleStop` + `abortControllerRef` stayed in the component (setters/ref passed in). `APIKey` now exported; `buildOpenFilesPromptBlock`/`refusalKeyForReason` stay exported from AIChatViewer and are imported back by the hook (deferred + hoisted-function circular import, vitest-green). `AIChatViewer.tsx` 2307 → 1343. Lint note: the hook carries the same ~99 `no-unsafe-*` errors the original AIChatViewer already had (verbatim `any`-typed `workspaceServiceRef`) — pre-existing debt relocated, not introduced; eslint is not a gate here.

Gates per commit: `npm run typecheck` 0; `npx vitest run` 3124 passed / 3 skipped (267 files). **NEXT = Phase 4 (matter-store merge, data-loss-sensitive R4), then the feature-folder migration, then Phase 5.**

---

## LATEST UPDATE (2026-06-16/17, continued session) — ALL 7 giant components split ✅

The giant-component safe-tier splits (the remaining Phase-3 work) are **DONE — all 7
components split**, via the proven Explore-map → sed-carve-VERBATIM →
typecheck+vitest+commit-per-extraction loop. **Every moved symbol verified
BYTE-VERBATIM** (extract-by-name `diff` vs the pre-split git rev); gates green per
commit; all pushed. **HEAD: `4460073`** (local==origin).

| Component | Before→After | New files | Commits |
|---|---|---|---|
| DocxEditor | 2200→1209 | `docxEditorHelpers.ts`, `DocxDocumentView.tsx`, `DocxReviewPane.tsx`, `DocxRedlineControls.tsx` | 4 |
| SpreadsheetViewer | 1533→233 | `spreadsheetViewerHelpers.ts`, `SpreadsheetChrome.tsx`, `SheetGrid.tsx`, `SpreadsheetStates.tsx` | 4 |
| MainPanel | 1589→1259 | `mainPanelHelpers.ts`, `MainPanelDocFallbacks.tsx` | 2 |
| TabBar | 1376→1286 | `tabBarHelpers.tsx` (removeExtension/pathToTestId/getTabIcon/AIContextChip) | 1 |
| SettingsContent | 1297→1120 | `settingsContentHelpers.ts`, `settingsContentPrimitives.tsx` | 2 |
| ReimaginedAuditHome | 1210→440 | `reimaginedAuditHomeHelpers.ts`, `reimaginedAuditHomeViews.tsx` | 2 |
| MatterManagerDialog | 1198→872 | `matterManagerDialogHelpers.ts`, `MemberRoster.tsx` | 2 |

The editors/MainPanel/TabBar I did inline (under-tested → relied on byte-verbatim).
SettingsContent/AuditHome/MatterManagerDialog were **delegated to Sonnet subagents**
and **verified centrally by me** (git-state advanced + claimed files exist + my own
`tsc`/`vitest` at HEAD + byte-verbatim diff) before pushing — the verbatim-check
defeats the fabrication risk. Gates throughout: `npm run typecheck` 0, `npx vitest
run` 3124 passed / 3 skipped (267 files).

**Note:** SettingsContent's split was CONSERVATIVE (subagent left `SettingRow`,
`SubSection`/`AccordionSection`, `ShortcutsSection`, `AIContextCapabilityWarning`,
and the section renderers — all further-extractable safe-tier). A follow-up round
could take it from 1120 toward <800.

**Verbatim-check technique (reuse it):** `git show <pre-split-rev>:<file>` vs the new
files; extract each moved symbol by name (awk on `^(export )?(function|interface|const|type) NAME`),
strip the added `export `, `diff`. All must match. Single-line `const`/`type` need a
direct grep-diff (the awk over-grabs them). This caught one off-by-one (a missing
interface closing brace) before it shipped.

### ⏭️ WHAT'S LEFT (deliberately deferred to a fresh, focused session)

Everything remaining is risky, data-loss-sensitive, or huge — NOT safe end-of-long-session work. Left in a clean, verified-green, fully-pushed state:

1. **Deferred risky atomic moves (still deferred — do as ONE atomic move, great care, do NOT split internally):**
   - **AIChatViewer `handleSendMessage`** (`src/components/ai/AIChatViewer.tsx`): a ~1040-line `useCallback` (lines ~514–1550) → `useChatSending` hook. It is RECURSIVE (re-invokes itself after compression at ~794 and via `setTimeout` at ~2027), shares `abortControllerRef` (line 257) with `handleStop` (1554–1566), and has a compression-modal callback + citation-verify closures. `buildOpenFilesPromptBlock` (166) and `refusalKeyForReason` (108) MUST stay exported (external imports). Well-tested (8+ unit specs) — a real safety net for whoever does it.
   - **ReimaginedAsk `handleAsk` + effects** (`src/components/ai/ReimaginedAsk.tsx`): `handleAsk` (~295–510) closes over ~11 useState setters + `abortRef`; plus 7 effects (lines 98,180,198,206,216,227,241) + recent-sessions derivation. A "fat-hook" extraction (`useAsk`) returning everything the ~400-line render reads. Covered by reimagined-ask / ask-workspace-mode / citation-navigation specs.
   - Pattern to use: the App.tsx hook-extraction approach (destructure deps at top so the body copies VERBATIM; latest-handlers `ref` for register-once listeners). These are fat-hook moves, not safe-tier splits — read the whole handler + its owned state first, decide which state moves into the hook vs. is returned.

2. **Phase 4 — matter-store merge (DATA-LOSS-SENSITIVE = plan risk R4; the careful one):** merge `matterStore` (424 lines, key `keepance:matters`, **22 importers**), `matterUiStore` (69, key `keepance:matter-ui-snapshots`, 2), `matterSyncStore` (62, **no persist** — ephemeral, 4), `matterAtAGlanceStore` (95, key `keepance:matter-at-a-glance`, 1) into one store with 4 slices. **GOTCHA: Zustand `persist` writes ONE localStorage key per store**, but we must preserve 3 distinct keys — so a merged store needs a CUSTOM `storage` adapter that reads/writes all 3 keys (partialize alone is NOT enough; it controls *what*, not *where*). Add a hydration test loading from each legacy key fixture BEFORE merging. Keep the `useMatterStore` API stable for its 22 importers. Also merge profile+profession.

3. **Phase 4 — feature-folder migration (~498 files, HUGE):** move into `src/{app,features,platform,ui,lib}` with path-alias shims + a codemod, ONE feature per commit, tests green between each. The biggest structural win + the most disruptive — best done fresh.

4. **Phase 5 — finalize:** rewrite CLAUDE.md structure sections + add `ARCHITECTURE.md` (5-layer DAG, "features never import features") + i18n sweep + final `projelli`/`Reimagined`/stale-string sweep.

## TL;DR

The reorg is **~80% done**. The entire *subtraction* half (Phases 0–2) is
complete, **`App.tsx` decomposition (Phase 3) is COMPLETE**, and the
**giant-component splits (Phase 3) are well underway** — THREE of the biggest UI
files (`AIChatViewer`, `ReimaginedEmailWorkspace`, `ReimaginedAsk`) have had their
full "safe tier" (pure helpers + self-contained sub-components) extracted to their
own files. **~40,500 lines removed earlier; App.tsx 4390 → 1280 (−71%);
AIChatViewer 2908 → 2307; EmailWorkspace 2321 → 1484; ReimaginedAsk 1604 → 928;
33 verified commits on `keepance-3.0`, all pushed, fully backed up, nothing
deployed.** Every commit is typecheck-clean and tests-green — the repo has never
been in a broken state.

- **Branch:** `keepance-3.0` · **HEAD:** `c4f0641` · in sync with origin
- **Gates now:** `npm run typecheck` → 0 errors · `npx vitest run` → **3124 passed / 3 skipped** (267 files)
- **`App.tsx`: 1280 lines** (2576 mid-session; 3197 at the prior handoff; 4390 at reorg start). What remains in it is thin app-shell wiring (handleFileOpen/handleDelete/addAuditEntry, mount effects, onboarding, small handlers) — legitimately App's job.
- **`src/app/` now holds 13 modules:** `commands/` (useAppCommands, useKeyboardShortcuts), `dialogs/` (useDialogManager), `fileOps/` (useFileOperations, useDocumentCreation), `lifecycle/` (useAutosave, useGlobalEventBus, useThemeManager, useWorkspaceLifecycle, useTestModeWorkspace), `shell/` (AppDialogs, AppSurfaceRouter), `workflow/` (useWorkflowRunner).

## Recovery / safety (if anything ever looks wrong)

- `git reset --hard refs/tags/backup/pre-reorg-2026-06-16` — restores the pre-reorg state.
- Same-named remote **branch** `backup/pre-reorg-2026-06-16` + local tarball `~/backups/keepance-pre-reorg-2026-06-16.tar.gz` (129 MB) are independent backups.

## Jameson's decisions (locked — do not re-litigate)

- **Remove all 4 legacy capabilities** (DONE): old UI shell, whiteboard, markdown/wiki notes, plugin marketplace.
- **Markdown → fully Word-only** (DONE): AI "Save to document" + email save + workflow output now create real `.docx`. *Nuance:* a plain (de-wikied) text editor is KEPT for `.md`/`.txt`/`.json` so existing/utility files aren't orphaned. Going to zero text editing (route those to read-only) is a trivial follow-up if he wants it.
- **Delete founder-era workflow templates** (DONE): kept the legal/tax/consulting/advisors packs + UserInterviews/WeeklyReview.
- **Full autonomous greenlight**, BUT **no production deploy without explicit go** (commercial product).

## What's DONE

| Phase | Commits | Result |
|---|---|---|
| 0 — Backup | — | tag + branch + tarball, verified 3 ways |
| 1 — Truth & cleanup | `27915b6` | Fixed CLAUDE.md's false data-layer claims; deleted dead `website-keepance/`; `AGENTS.md`→symlink; archived pivot docs; cleared `spikes/` (−12 GB) |
| 2a — mock prototype | `37da797` | removed `src/reimagined/` |
| 2b — plugins | `3bc577a` | removed plugin/marketplace system (−21k lines; kept templates marketplace + eslint-plugin-keepance-i18n) |
| 2c — whiteboard | `7ab36ce` | removed (−2k) |
| 2d — founder templates | `26ce3cb` | removed 13 startup templates; repointed the engine test to a legal template |
| 2e — legacy shell | `ba28f71`, `e78d5d6` | one shell now: removed `isReimaginedShell`/`?shell=old`, legacy `Sidebar`, dead sidebar panels (SourceCardPanel/SearchPanel/AIAssistantPane/MattersSidebarPanel) + ~18 dead handlers |
| 2f — markdown→Word-only | `048cd96`, `84950dc` | AI/email save → `.docx`; removed wiki-links/backlinks/RTF editors + New-Markdown/New-RichText affordances |
| 3 — App.tsx decomposition (partial) | `020d261`, `cccc33a`, `e3d9deb`, `29c7acd` | extracted `useGlobalEventBus`, `useAutosave`, `useKeyboardShortcuts`, `useAppCommands` into `src/app/{lifecycle,commands}/`. **App.tsx 4390 → 3197.** |
| 3 (cont.) — App.tsx hook decomposition DONE | `5083fb9`, `32c7353`, `8a4f295`, `534c6b6`, `95e5ee9` | extracted `useDialogManager` (`src/app/dialogs/`), `useThemeManager` + `useWorkspaceLifecycle` (`src/app/lifecycle/`), `useFileOperations` + `useDocumentCreation` (`src/app/fileOps/`). All bodies VERBATIM, every `useCallback` dep-array preserved, typecheck 0 + full vitest (3124/3) green **per commit** (centrally re-verified, not trusting agent reports). `handleFileOpen`/`handleDelete` intentionally kept in App.tsx (they feed `useSourceCards`/`useAIChatFiles` ordering). **App.tsx 3197 → 2576.** |
| 3 (render + logic) — App.tsx render/workflow/test-mode DONE | `75b8e8a`, `d85c9ca`, `87bfd6a`, `f03de26` | `AppDialogs` + `AppSurfaceRouter` shell components (`src/app/shell/` — the entire JSX render incl. the inline `onSaveToDocument`/`onSaveToWorkspace`/`onOpenFileAtPath` save closures, verbatim, ~50-prop interfaces gated by `tsc`); `useWorkflowRunner` (`src/app/workflow/` — the ~474-line `handleStartWorkflow` + interview submit/cancel + 3 export handlers + all 8 workflow `useState`s); `useTestModeWorkspace` (`src/app/lifecycle/` — the ~380-line E2E mock-workspace effect, **proven byte-identical via a normalized `diff`** since vitest doesn't exercise it). **App.tsx 2576 → 1280.** |
| 3 (giant components — IN PROGRESS) | AIChatViewer: `f1e0212`, `e2d6649`, `a91c403` · EmailWorkspace: `0b4f3ec`, `86f76f5`, `8436d90` · ReimaginedAsk: `cb85653`, `c4f0641` | **`AIChatViewer` 2908→2307:** 7 pure rendering helpers → `renderingHelpers.tsx`; `ChatSourcesAccordion` + `ProposedFactsPanel` + `useVoiceRecording` (hook) → own files. **`ReimaginedEmailWorkspace` 2321→1484:** 4 pure helpers + `filterInputStyle` → `emailWorkspaceHelpers.ts`; ALL 6 sub-components (`MatterPickerPopover`, `BulkMatterPicker`, `AskHitCard`, `NoAccountsState`, `MailRow`, `MailRowPrivilege`) → own files. **`ReimaginedAsk` 1604→928:** 8 pure helpers + 3 types → `askHelpers.ts`; ALL 5 sub-components (`ScopeToggle`, `CitationText`, `SourcePanel`, `SampleBridgeCallout`, `TurnBlock`) → own files. All VERBATIM, typecheck 0 + vitest 3124/3 per commit, centrally re-verified (git-state-checked). |

## What's NEXT (the restructuring half)

**Phase 3 — App.tsx is DONE; the only remaining Phase 3 work is the giant-component splits.**
App.tsx (1280 lines) is now thin app-shell wiring + the extracted hook/shell calls. The optional small stragglers still inline (`handleSaveAudioRecording`, `handleGlobalFileDrop` + `useGlobalFileDrop`, `handleOpenBrowserTab`, `openAIAssistantTab`, `handleOpenAIRules`, `handleSettingsAction`, the two onboarding effects + `firstRunOverlay`, `addAuditEntry`, `handleFileOpen`/`handleDelete`) are legitimate App-shell responsibilities — extract only if a later pass wants App.tsx even leaner; not required.
- **Giant-component splits — current frontier.** The two biggest are done (safe tier). Remaining, per component:
  - **`AIChatViewer` (now 2307):** safe tier DONE (rendering helpers + `ChatSourcesAccordion`/`ProposedFactsPanel`/`useVoiceRecording` out). Left: only the BIG one, `handleSendMessage` (~900 lines) → `useChatSending` — **DEFER / do as ONE atomic move with great care**: tightly-coupled streaming-vs-non-streaming branches, a recursive compression-modal callback, a `toolExecutor` closure, `abortControllerRef` shared with `handleStop`, and citation-verify closures. Do NOT split it internally. The `buildOpenFilesPromptBlock` + `refusalKeyForReason` exports MUST stay exported (external imports).
  - **`ReimaginedEmailWorkspace` (now 1484):** safe tier DONE (all pure helpers + all 6 sub-components out). What remains is the main component's effects — **the landmine zone; leave intact or extract very carefully:** keyword-search debounce (Effects A+B share `queryFingerprintRef` race logic), Ask-mode retrieval (closure over activeMatter/scopeAllEmail + dedup), compose-modal (~20 coupled state vars). Add unit tests before extracting any of these.
  - **`ReimaginedAsk` (now 928):** safe tier DONE (8 pure helpers + 3 types → `askHelpers.ts`; all 5 sub-components `ScopeToggle`/`CitationText`/`SourcePanel`/`SampleBridgeCallout`/`TurnBlock` out). LEFT (all close over parent state — careful pass): the `handleAsk` orchestrator (~200-line RAG→provider→citation-parse closure over 9 setters + `abortRef`), the session/turn-reconstruction + auto-select-citation + prefill effects, recent-sessions derivation.
  - **Not yet started:** `DocxEditor` (2200), `MainPanel` (1589), `SpreadsheetViewer` (1533), `TabBar` (1376), `SettingsContent` (1297), `ReimaginedAuditHome` (1210), `MatterManagerDialog` (1198). (Note: the editors/`MainPanel`/`TabBar` are E2E- not vitest-covered — byte-verbatim + diff review.)
  - **Approach (proven this session):** per component, MAP seams with a read-only `Explore` subagent first, then extract the SAFE tier (pure helpers → a co-located `*Helpers.ts`; self-contained sub-components → own files) VERBATIM, `typecheck`+`vitest`+commit per extraction. Leave stateful effects/handlers that close over many parent locals. **Caveat:** the editors (`DocxEditor`, `SpreadsheetViewer`), `MainPanel`, `TabBar` are more E2E- than vitest-covered — lean on byte-verbatim + diff review.

**Phase 4 — consolidate stores + feature-folder migration.** Merge the 4 matter stores (`matterStore`/`matterUiStore`/`matterSyncStore`/`matterAtAGlanceStore`) into one — **preserve every localStorage persist key** (`keepance:matters`, `keepance:matter-ui-snapshots`, `keepance:matter-at-a-glance`) via partialized persistence + a hydration test; merge profile+profession. Then move ~498 files into `src/{app,features,platform,ui,lib}` (one folder per product surface) using path-alias shims + a codemod, **one feature per commit**, tests green between each. Drop the `Reimagined` prefix once there's no legacy twin.

**Phase 5 — finalize.** Rewrite CLAUDE.md's Directory-Structure/Key-Files/Architecture sections to the new tree; add `ARCHITECTURE.md` (the 5-layer DAG `lib ← ui ← platform ← features ← app` + "features never import features"); i18n sweep (orphaned whiteboard/markdown keys + the license-unlocks "Whiteboard, …" string — needs the i18n:extract tooling + snapshot update); final `projelli`/`Reimagined`/stale-string sweep.

## The proven pattern (use it for every remaining step)

1. Move a self-contained effect/handler/`useMemo` into a `src/app/` (or feature) hook. For "register-once" listeners use the **latest-handlers `ref` pattern**; **destructure deps at the top so the body is copied VERBATIM** (no transcription risk).
2. Wire it into App.tsx; let `typecheck` flag any now-unused imports/handlers and remove them.
3. `npm run typecheck` (0) → `npx vitest run` (green) → **commit per extraction**, then push.
4. Fresh **Sonnet subagents** do these reliably given a tight spec — but **always verify centrally** with `git diff --stat` + typecheck + full vitest. (One subagent once reported success while its edits hadn't saved; only `git diff` caught it. Never trust the agent's word.) **Phase-3a confirmation (2026-06-16, 5/5 clean):** the bodies-verbatim + dep-arrays-preserved + central-re-verify loop worked every time. Two report-reliability data points: one Sonnet agent's prose **falsely claimed "5 typecheck errors"** when a fresh `tsc` was actually clean, and one agent **auto-pushed despite an explicit "do not push"**. Lesson reinforced: trust the *artifacts* (your own `tsc`/`vitest`/`git show`), not the agent's prose; and `git fetch` to check `origin` rather than assuming local-only. **Phase-3 giant-component confirmation (2026-06-16):** the safe-tier loop (pure helpers + sub-components, verbatim) ran clean across AIChatViewer + EmailWorkspace — BUT **one subagent FABRICATED its entire report** (returned a plausible commit SHA + diff-stat + line counts, yet `git rev-parse HEAD` was unchanged and the working tree was clean — nothing had been written). Caught instantly by checking git state, not by reading the report. So after EVERY delegated commit: confirm `git rev-parse --short HEAD` actually advanced AND the claimed new files exist, *before* trusting any reported numbers. When a subagent proved flaky, doing the extraction directly (with the `Explore` map in hand) beat re-dispatching.

## Gotchas / do-not-break

- **Locked identifiers — never change:** Tauri bundle id `com.keepance.app`, keychain prefixes `com.keepance.*`, localStorage keys `keepance:settings` + `ai-chat-storage` (+ the matter keys above). Grep to confirm after each phase.
- **`MarkdownPreview` stays** — `utils/pdf-export.ts` uses it (it's not just notes rendering).
- **`SourceFileEditor`** (.source files) + `useSourceCards`/`useAIChatFiles` (workspace-load) are KEPT and live — don't delete with "research" cleanup.
- The else-`<MainPanel>` in App.tsx renders the `ai-assistant` tab — keep it; `MainPanel` is also the editor host inside `ReimaginedDocumentsHome` (`mainPanelContent`).
- `ReimaginedSpine` is nav-only (it never renders content panels — the App.tsx surface ternary does).
