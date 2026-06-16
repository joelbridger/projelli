# Keepance 3.0 — Codebase Reorg: Next-Session Handoff (2026-06-16)

> **Read first:** the plan `~/.claude/plans/you-are-my-ceo-spicy-pudding.md`, the
> memory file `project_keepance_reorg.md`, then this doc. This is the
> feature-first reorganization to make the codebase match the 3.0 law-practice
> product (it had accreted sediment from the "projelli" notes-app and the general
> "AI workspace" eras).

## TL;DR

The reorg is **~60% done**. The entire *subtraction* half (Phases 0–2) is
complete, and `App.tsx` decomposition (Phase 3) is underway. **~40,500 lines
removed across 290 files, 13 verified commits on `keepance-3.0`, all pushed,
fully backed up, nothing deployed.** Every commit is typecheck-clean and
tests-green — the repo has never been in a broken state.

- **Branch:** `keepance-3.0` · **HEAD:** `29c7acd` · in sync with origin
- **Gates now:** `npm run typecheck` → 0 errors · `npx vitest run` → **3124 passed / 3 skipped** (267 files)

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

## What's NEXT (the restructuring half)

**Phase 3 — finish decomposing `App.tsx` (3197 lines) + giant components.** Remaining clean targets:
- file-operation handlers → `useFileOperations` (biggest chunk; interconnected — they're passed as props to `ReimaginedDocumentsHome`/`FileTree`)
- dialog booleans (`showSettingsModal`, `showCommandPalette`, `showQuickOpen`, `showShortcutsOverlay`, `accountWindowOpen`, `matterManagerOpen`, …) → `useDialogManager`
- workspace open/close lifecycle (`handleWorkspaceSelected` etc.) → `useWorkspaceLifecycle`
- the surface-router ternary + the big JSX render → `src/app/shell/`
- then split the giant components: `AIChatViewer` (2908), `ReimaginedEmailWorkspace` (2321), `DocxEditor` (2200), `ReimaginedAsk` (1604), `MainPanel` (1589), `SpreadsheetViewer` (1533), `TabBar` (1376), `SettingsContent` (1297), `ReimaginedAuditHome` (1210), `MatterManagerDialog` (1198)

**Phase 4 — consolidate stores + feature-folder migration.** Merge the 4 matter stores (`matterStore`/`matterUiStore`/`matterSyncStore`/`matterAtAGlanceStore`) into one — **preserve every localStorage persist key** (`keepance:matters`, `keepance:matter-ui-snapshots`, `keepance:matter-at-a-glance`) via partialized persistence + a hydration test; merge profile+profession. Then move ~498 files into `src/{app,features,platform,ui,lib}` (one folder per product surface) using path-alias shims + a codemod, **one feature per commit**, tests green between each. Drop the `Reimagined` prefix once there's no legacy twin.

**Phase 5 — finalize.** Rewrite CLAUDE.md's Directory-Structure/Key-Files/Architecture sections to the new tree; add `ARCHITECTURE.md` (the 5-layer DAG `lib ← ui ← platform ← features ← app` + "features never import features"); i18n sweep (orphaned whiteboard/markdown keys + the license-unlocks "Whiteboard, …" string — needs the i18n:extract tooling + snapshot update); final `projelli`/`Reimagined`/stale-string sweep.

## The proven pattern (use it for every remaining step)

1. Move a self-contained effect/handler/`useMemo` into a `src/app/` (or feature) hook. For "register-once" listeners use the **latest-handlers `ref` pattern**; **destructure deps at the top so the body is copied VERBATIM** (no transcription risk).
2. Wire it into App.tsx; let `typecheck` flag any now-unused imports/handlers and remove them.
3. `npm run typecheck` (0) → `npx vitest run` (green) → **commit per extraction**, then push.
4. Fresh **Sonnet subagents** do these reliably given a tight spec — but **always verify centrally** with `git diff --stat` + typecheck + full vitest. (One subagent once reported success while its edits hadn't saved; only `git diff` caught it. Never trust the agent's word.)

## Gotchas / do-not-break

- **Locked identifiers — never change:** Tauri bundle id `com.keepance.app`, keychain prefixes `com.keepance.*`, localStorage keys `keepance:settings` + `ai-chat-storage` (+ the matter keys above). Grep to confirm after each phase.
- **`MarkdownPreview` stays** — `utils/pdf-export.ts` uses it (it's not just notes rendering).
- **`SourceFileEditor`** (.source files) + `useSourceCards`/`useAIChatFiles` (workspace-load) are KEPT and live — don't delete with "research" cleanup.
- The else-`<MainPanel>` in App.tsx renders the `ai-assistant` tab — keep it; `MainPanel` is also the editor host inside `ReimaginedDocumentsHome` (`mainPanelContent`).
- `ReimaginedSpine` is nav-only (it never renders content panels — the App.tsx surface ternary does).
