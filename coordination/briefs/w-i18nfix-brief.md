# Build brief — i18n fixes: gate warnings + core surfaces that ignore the language switch (QA-14 P1)

**Lane:** cc-lantern-i18nfix · dir `~/lp-i18nfix` (own worktree, branch `lp/i18n-fixes`). **Model:** Sonnet 5 · high.
**Rules:** stay in your lane (i18n keys, locale JSONs, and the named components only). TDD where a behavior is fixable red-first. Self-converge via `codex-review --base origin/lantern-plus` to a clean round before handoff. No interactive menus — blocking decisions as plain text `COORDINATOR:` lines.

## Scope (two items, one domain)
1. **`npm run i18n:check` is red on the tip — 19 warnings.** Pre-existing; get it to zero honestly (add missing keys / remove dead ones / fix whatever each warning actually is — no suppressions unless a warning is genuinely false, stated case-by-case).
2. **QA-14 (P1): switching to Deutsch/Español translates Settings but NOT the surfaces advisors live in.** Root-caused already: literal strings instead of `t()` in `src/app/shell/layout/Spine.tsx:73-75` (primary nav), `src/features/matters/MatterHub.tsx:87-89` (per-client hub tabs), `src/features/matters/MattersHome.tsx:272` (row "Ask" action). The de/es files are complete (de.json 1524 keys). Fix those components to use the translation system, AND sweep the same neighborhoods for siblings with the same disease (other hardcoded user-facing labels in Spine/MatterHub/MattersHome and their direct children) — fix what you find, list what you fixed. Repro evidence: `coordination/qa-campaign/evidence/qa3-20260704/` + BUG-DB QA-14.

## Gate + handoff
`npx tsc --noEmit` clean · `npm run i18n:check` ZERO warnings (this is the point) · full `npx vitest run` green · eslint-gate clean. Verify visually once: dev server on a UNIQUE port (`--port NNNNN --strictPort`, never bare :5173), switch to de, screenshot the left nav + a client hub translated. Handoff with HEAD SHA, gate counts, self-review rounds, screenshot path. Push your branch (NOT self-merged), then the last line exactly: `WORKER-DONE: lp/i18n-fixes`
