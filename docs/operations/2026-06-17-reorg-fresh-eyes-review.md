# Keepance 3.0 Reorg — Fresh-Eyes Review (2026-06-17)

> **What this is:** an independent, CEO-level review of the feature-first
> reorganization, requested after the reorg was declared complete. Every
> High/Medium finding below was **verified firsthand against artifacts**
> (the codebase, real command output) — not taken on an agent's word.
> Method: four parallel deep-dive audits (architecture, documentation,
> dead-code, code-quality) + central re-verification of every load-bearing claim.
>
> **Branch:** `keepance-3.0` · **HEAD:** `5c54ab4` · tree clean, local == origin.

---

## Verdict: the reorg itself is sound. The findings are mostly *stale docs* and *pre-existing debt the reorg surfaced* — not damage the reorg caused.

The structural work is genuinely high quality and behavior-preserving. Independently verified:

| Gate / invariant | Result |
|---|---|
| `tsc --noEmit` (typecheck) | **0 errors** |
| `vitest run` | **3133 passed / 3 skipped, 269 files** |
| `vite build` (production bundle) | **exit 0** — the bundler resolves every `@/` import, not just `tsc` |
| `src/` structure vs `ARCHITECTURE.md` | **exact match** (app 33 · features 279 · platform 179 · ui 34 · lib 4) |
| Old layer dirs (`components/ modules/ stores/ hooks/ utils/ types/`) | **all gone** |
| Locked identifiers (Tauri bundle id + 6 localStorage keys) | **preserved** |
| Matter multi-key persist adapter (highest data-loss risk) | **correct & unit-tested** |
| Layering: platform→features / ui→platform / lib→internal | **zero violations** |
| All 11 cross-feature allowlist edges | **all live** (no dead entries) |
| Rust/Tauri backend touched by reorg | **no** (frontend-only; desktop wiring intact) |
| Committed merge-conflict markers | **zero** |
| Recovery (tag + local branch + remote branch + 129 MB tarball) | **all present** |

The reorg removed ~37.5k net lines (1061 files), one commit per surface, gates green per commit, fully recoverable. This is careful work.

**The rest of this doc is the punch list of what's *not* clean.** None of it is a structural failure of the reorg; it's the residue and pre-existing debt a reorg of this size naturally exposes.

---

## P0 — Customer-facing bug (fix before the next release)

### 1. Paying users are shown a removed feature ("Whiteboard") in their license unlocks
- **Evidence:** `src/features/settings/LicenseSettings.tsx:173` renders `t('settings.license.unlocks.whiteboard-audio-research')`; `src/locales/en.json:159` = `"Whiteboard, audio recording, research citations"`. Whiteboard was removed in 3.0.
- **Why it matters:** a paying customer opening Settings sees a feature advertised that they don't have. Small, but it's a trust/accuracy defect in the paid surface.
- **Fix:** reword the string (drop "Whiteboard") and rename the i18n key. ~5 minutes.

---

## P1 — Documentation that actively misleads (public + contributor-facing)

### 2. The public `README.md` is two major versions behind — wrong on price, version, product, and stack
- **Evidence (all verified):** `package.json` is `3.2.0` / Vite `^6.0.5`, but README says:
  - pricing `$49 / $129 / $399 one-time` (line 131–133) — live model is **$468 / $948 / $1,548 per-seat/yr**;
  - "**v1.5** is the latest stable release, v1.6 in RC" (line 27) — actual is **v3.2.0**, all four platforms signed + auto-update;
  - "A **Markdown editor** with wiki-links, backlinks…" (line 16) — those were removed; the product is Word/.docx-native;
  - "CodeMirror 6 for the editor" / "Vite 5" (lines 68–71) — stack is OOXML+TipTap primary, Vite 6;
  - links to `docs/reference/ARCHITECTURE.md` for architecture, which is a stale **"# Business OS - Architecture Document"** (pre-pivot, unrelated to the current app).
- **Why it matters:** this is the file journalists, partners, and new contributors read first. It describes a product that no longer exists, at prices that no longer apply.
- **Fix:** rewrite README for v3.2.0 (status, subscription pricing, Word-native positioning, correct stack), and repoint the architecture link to the root `./ARCHITECTURE.md`.

### 3. `CLAUDE.md` carries internal contradictions, dead paths, and a broken test workflow
- **Evidence (verified):**
  - "**NO sql.js**" in the tech table (line 149) vs a "**sql.js WASM must be loaded**" troubleshooting block (lines 551–553) referencing a nonexistent `src/lib/sqlite.ts`.
  - Documents `npm run test:unit` / `test:integration` / `test:security` (lines 366–368) — **none exist** in `package.json` (only `test`, `test:watch`, `test:coverage`); running them errors.
  - Autosave attributed to "App.tsx lines 1875–1890" and "MainPanel.tsx 554–558" — App.tsx is **1280 lines**; the logic moved to `src/app/lifecycle/useautosave.ts` and the indicator to `StatusBar.tsx:342`.
  - "Key Files" / "Directory Structure" tables list **31 dead `src/modules|components|stores/...` paths**; three (`WikiLinkParser`, `EditorService`, `BacklinkIndex`) were *deleted*, not moved, but are presented as if current.
  - CodeMirror & Mermaid mislabeled "legacy / being removed" though both are live; `@/modules/workspace` shown as the alias example; `spikes/firm-sync/DECISION.md` and the `docs/marketing/channels|action-packs/` paths are dead; the "Current Phase" section is frozen at v3.0.x; the "Sub-agent routing" footer claims a LiteLLM gateway the body explicitly says isn't wired.
- **Why it matters:** `CLAUDE.md` is the first thing every future session (human or AI) reads. The contradictions waste time and the missing test scripts break the documented workflow. The "historical, trust the code" caveat helps, but contradictions and dead commands still actively mislead.
- **Fix:** delete/condense the historical tables and point to `ARCHITECTURE.md`; remove the sql.js block and the three phantom test scripts; correct the autosave/CodeMirror/Mermaid/alias/phase lines.

---

## P1 — Latent correctness debt (relocated by the reorg, not created by it)

### 4. ESLint is not a CI gate, and it's hiding real async-failure risks
- **Evidence (verified):** `npm run lint` → **1,980 problems (1,660 errors, 320 warnings)**. Among them **47 `no-floating-promises`** and **116 `no-misused-promises`**. CI gates are only `typecheck` + `vitest`; lint blocks nothing.
- **Why it matters:** a "floating promise" is a fire-and-forget async operation (a file save, an API call, an audit-log write) whose failure is never caught — it can fail silently with no error surfaced to the user. "Misused promises" are async `onClick`-style handlers that swallow rejections. In a local-first legal app where the promise to never lose work is core, silent save/audit failures are the worst kind. These are the highest-value items in the lint backlog.
- **Fix:** triage the 47 + 116 promise findings specifically (ignore the ~600 style-only ones for now); add `lint` as a non-blocking CI report first, then ratchet.

### 5. A single `any`-typed ref poisons type-safety *and* breaks React Compiler optimization in ~5 core hooks
- **Evidence (verified):** `workspaceServiceRef: MutableRefObject<any>` is threaded through `useChatSending.ts`, `useFileOperations.ts`, `useWorkspaceLifecycle.ts`, `useAppCommands.ts`, `App.tsx`. It produces **43 "Compilation Skipped: existing memoization could not be preserved"** React-Compiler errors — the compiler can't tell the `any` is a ref, so it silently de-optimizes those hooks — plus most of the ~238 `no-unsafe-*` lint errors.
- **Why it matters:** typing it as `MutableRefObject<WorkspaceService | null>` would collapse most of the `no-unsafe` debt and restore compiler optimization in one change — and would catch real bugs if the `WorkspaceService` interface ever changes.
- **Fix:** one focused typing change to the ref + its prop interfaces.

### 5b. The test suite itself has no type-safety net
- **Evidence (verified):** `tsconfig.json` includes `src` only, so `tsc` never type-checks `tests/`. ESLint applies its strict type-aware preset to `src/**` but only the loose `recommended` preset (no `parserOptions.project`) to `tests/**`. So across **269 test files**, a mock built to the wrong shape or an un-awaited promise is caught *only if a given vitest run happens to execute that path* — nothing checks test types statically.
- **Why it matters:** this is the safety net behind every other gate. A test that silently asserts against a stale type gives false confidence — exactly the risk a behavior-preserving reorg leans on tests to rule out.
- **Fix:** add a `tsconfig.test.json` (or widen `include`) and give `tests/**` a `project` in the ESLint config. Low effort, high leverage.

---

## P2 — Architecture hygiene (the layering is clean; these are refinements)

### 6. The architecture guard test only catches `@/`-aliased imports
- **Evidence (verified):** `tests/unit/architecture-boundaries.test.ts:65` — the regex matches only `@/...` specifiers. Relative cross-layer or cross-feature imports (`../../platform/...`, `../email/...`) pass silently. **Not exploited today** (only 2 benign relative cross-layer imports exist, both from unlayered roots), but the guard is the thing keeping the new structure honest, and it has a hole.
- **Fix:** add a second sweep that resolves `../` specifiers and reapplies the layer check.

### 7. Circular type dependency in the matter-store shims
- **Evidence (verified):** `matterStore.ts:48–50` imports types *from* `matterUiStore`/`matterSyncStore`/`matterAtAGlanceStore`, each of which imports `useMatterStore` back from `matterStore.ts` — three import cycles. Works today via TS type-elision, but it's backwards ("the store depends on its own shims") and fragile.
- **Fix:** co-locate the three types in `matterStore.ts` (or `platform/types/matter.ts`); have the shims re-export them. This also clears the way to finally delete the shims.

### 8. A few surfaces sit in the wrong layer/feature
- **Evidence (verified):**
  - `settings→email` allowlist edge is inverted: `MailConnect/MailGmailConnect/MailImapConnect` live in `features/settings/` but import `useMailSync`/`mailStore` from `features/email/`, and are consumed by account + onboarding. They belong in `features/email/`.
  - `platform/tools/filesystem.ts` is an **orphan — 0 importers anywhere** (the dead-code sweep missed it; I confirmed).
  - `platform/voice/` and `platform/tools/fileAccessTools.ts` are single-feature utilities masquerading as cross-cutting platform capabilities.
- **Fix:** move `Mail*Connect` → `features/email/` (update allowlist); delete the orphan; relocate the single-feature platform bits into their feature.

---

## P2 — Dead code & reorg residue

### 9. Dead keyboard shortcut advertised in Settings
- **Evidence (verified):** `src/platform/utils/shortcuts.ts:66–70` defines `toggle-backlinks` (Ctrl+Shift+B, "Toggle Backlinks Panel"), shown in the Settings shortcuts table — but **nothing handles it** (backlinks were removed). Pressing it does nothing.
- **Fix:** delete the entry.

### 10. Orphaned translations + stale comments
- **Evidence:** ~13 orphaned i18n leaf keys (`whiteboard.*`, `plugins.*`, `marketplace.plugin-*`) × 3 locales; `professionStore.ts:6–7` JSDoc still claims it gates a removed "Whiteboard"; `AppShellNav.tsx` accepts two dead props (`researchContent`, `onOpenGridView`) it silently voids; 9 stale "reimagined shell" code comments.
- **Fix:** one i18n cleanup pass + comment/prop trim. Low risk.

### 11. The production bundle ships the Mermaid diagram engine eagerly
- **Evidence (verified via build):** `MarkdownPreview.tsx:21` does a **static** `import mermaid from 'mermaid'`, which drags ~1.4 MB of `cytoscape`/`wardley`/architecture-diagram renderer chunks into the build — for a product that pivoted to Word-native and removed its diagram/whiteboard features. Main JS chunk is 5.7 MB (1.73 MB gzip). (It's a desktop app, so this hits binary size + startup parse, not download time.)
- **Fix:** lazy-`import()` mermaid inside the render path so it loads only when a `mermaid` block is actually encountered — or decide diagrams-in-markdown is a dead concept and remove it. **Product call.**

---

## P3 — Repo hygiene & cosmetics

### 12. Branch / worktree sprawl — and a fresh clone lands on the wrong branch
- **Evidence (verified):** there is a stale `master` while `keepance-3.0` is the de-facto live trunk, and `origin/HEAD` is unset — so `git clone` checks out `master` (stale), not the live branch. ~30 local branches incl. **9 `worktree-agent-*`** leftovers; **13 registered git worktrees** (9 `agent-*`, 3 `prunable` ones still named **"projelli"**, 1 `keepance-3.0-work`).
- **Fix (within autonomous GitHub remit):** set the default branch / `origin/HEAD`, `git worktree prune`, delete merged/dead branches and the agent worktrees. (Per policy, raw force-push / remote-branch deletion stay gated — I'll list those, not run them.)

### 13. Test-tree naming drift
- **Evidence (verified):** 7 test files keep the `reimagined` prefix in their filenames and there's a stale `tests/unit/mail/` dir, even though their *contents* were de-prefixed (0 `Reimagined` identifiers inside). The de-prefix sweep renamed source files + test internals but not test filenames.
- **Fix:** `git mv` the 7 files + the `mail/`→`email/` dir.

### 14. Minor smells
- Non-script files marked executable (`CLAUDE.md`, `CHANGELOG.md`, `package.json`, `vite.config.ts` are `-rwxr-xr-x`) → `chmod 644`.
- Ambiguous ref: a **tag and a branch** both named `backup/pre-reorg-2026-06-16` (git warns on every use) → drop one.
- `CURRENT-STATE.md` test count (3058) and `coedit` path (`src/modules/coedit/`) are stale vs reality (3133; `src/platform/firm/coedit/`).

---

## Recommended sequencing

1. **P0 #1** (license string) — ship in the next release.
2. **P1 #2–#3** (README + CLAUDE.md) — the cheapest high-impact win; pure docs, zero code risk.
3. **P1 #4–#5** (promise triage + the `any` ref) — the only items with real runtime stakes.
4. **P2/P3** — fold into a single cleanup commit when convenient.

**Two genuine judgment calls** (not mine to make unilaterally): whether to keep Mermaid/markdown-diagrams at all (#11), and whether to finally delete the matter-store shims now that #7 clears the path.

---

*Reviewed by Claude (Opus 4.8) on 2026-06-17. All High/Medium findings verified against artifacts; agent-reported claims that failed verification (e.g. "EmailWorkspace.tsx is new and untested" — it is a behavior-preserving move with a 387-line unit test) were corrected out.*
