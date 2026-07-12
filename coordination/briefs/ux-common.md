# UX Simplification — COMMON WORKER RULES (read fully before your lane brief)

You are one of nine workers on the Lantern UX simplification preview. A coordinator (Fable 5) merges, gates, and reviews; you build ONE lane.

## Your specs, in priority order
1. `/home/jameson/lantern-plus/coordination/reports/ux-simplification-2026-07-08/FABLE-ENHANCED.md` — corrections C1–C4 and findings F1–F9 OVERRIDE the per-screen audit where they conflict.
2. Your lane's audit file in the same folder (named in your lane brief) — implement its recommendations item by item.
3. `SYNTHESIS.md` (same folder) — the cross-screen themes and the "Deliberately kept" protected list. NEVER weaken a protected item.

## Hard rules
- Work ONLY inside your assigned worktree. Never cd into `/home/jameson/lantern-plus`. Never touch another lane's branch. Never push to `lantern-plus` or `lp/ux-simplify-v1`.
- Light theme only. Never rename `matter`/`matter_id` internals; user-facing copy says client/household. No dark theme, no new dependencies.
- FOLD, don't remove: every recommendation relocates or collapses functionality. If implementing an item would delete a capability, skip it and note it in your done file.
- `data-testid` handles: NEVER remove or rename an existing handle (a guard test enforces this). When you move an element, the handle moves with it. New interactive elements get new kebab-case handles.
- All visible strings go through i18n (`en.json` + `t()`); apply the audit's EXACT copy rewrites where given. Sentence case, no ellipses, no em dashes in UI strings. Counts use proper plural forms (F7).
- Reuse existing primitives in `src/ui/kp/` (menus, segmented, Card variants, SlidePanel) before writing anything new. The `...` row-menu pattern already exists in the codebase — find and reuse it.
- Foundation dependency: run `git fetch origin 'refs/heads/lp/ux-found:refs/remotes/origin/lp/ux-found'` before starting. If `origin/lp/ux-found` exists, merge it into your branch FIRST and use its TrustNote/QuietStatus primitives for your trust-copy and status items. If it doesn't exist yet, do those specific items LAST and re-fetch before starting them; if still absent, implement with plain markup matching the audit copy and note it.

## Definition of done (all required)
1. Every HIGH item from your audit file implemented (or explicitly skipped with a one-line reason). MED items: implement unless risky. LOW items: implement if cheap.
2. Affected component tests updated. If `tests/unit/i18n/en-json-snapshot.test.ts` fails ONLY on the leaf count, set the true count with an honest comment.
3. Scoped checks pass in your worktree and you PASTE their real output in your done file:
   - `npm run typecheck`
   - `npx vitest run <your feature folders' tests>`
   - `node scripts/eslint-gate.mjs`
   Do NOT run the full gate, cargo, or Playwright (coordinator's job).
4. Conventional commits, small and readable. Then push YOUR branch: `git push origin <your-branch>`.
5. Write `/home/jameson/lantern-plus/coordination/briefs/done/<lane>.done.md`: what shipped (item numbers), what was skipped + why, test output, files touched count, anything the coordinator must know for merge.
6. STOP after writing the done file. Do not start extra work.

## Style of judgment
When an audit item is ambiguous, pick the quieter option that keeps the capability one click away. When two items conflict, the trust ladder wins: always-visible tiny status → one short line at action time → full details on demand.
