# Keepance UX — ROUND 3 plan: the matter hub + the "bigger ideas" (2026-06-14)

Jameson greenlit implementing the bigger ideas #1, #3-#6 + all smaller consistency items, with #2 reframed:
**NOT a matter-first nav rewrite — instead an in-Matters-tab HUB**, layout = **Overview command-center**
(his pick). The global nav and tool-first tabs stay (serves tax/consulting users who don't think in matters).
Branch `feature/ux-fixes-round3-2026-06-14`. Backup tag `pre-ux-round3-2026-06-14`. NOT deployed.

## The matter hub (chosen design: Overview command-center)
Matters tab = list of matters -> click one -> a HUB for that matter (a new view in the Matters surface, like
Documents' browser<->editor). The hub is an OVERVIEW that reuses the existing scoped tabs for depth:
- Header: matter name, client, status, key dates, the privacy/**Isolated** badge prominent.
- A matter-scoped **Ask** box (hero) + recent questions for this matter (integrates with the Search tab / ReimaginedAsk scoped to the matter).
- **At a glance**: open issues / deadlines / next actions (AI-generated when a key exists; a simple recent-activity + counts view otherwise; for the sample matter, derive from the demo data).
- Compact panels: **Documents / Email / Workflows / Activity** with previews + counts; a `>` opens that existing tab scoped to this matter (reuses `keepance:matter-launch`).
- "<- All matters" back. Profession-adaptive label (Matters / Clients / Engagements) where the product already knows the profession.
- Absorbs #3 (the matter Ask), #5 (Isolated in the header + celebrate), #6 (at-a-glance = the returning-user payoff). The existing per-row launchpad evolves into the hub.

## Waves (each: parallel disjoint subagents, verify, commit; sequential waves)

### WAVE R3-1 — supporting pieces the hub reuses (parallel, disjoint surfaces)
- **#3 Unified "Ask anything" (ReimaginedAsk + ReimaginedEmailWorkspace).** Add a scope toggle to Search: All matters / This matter / Email / Documents. Fold the email "Ask AI" mode into this (the email tab's Ask AI becomes the unified Ask scoped to email, or a thin redirect). Keep the demo/citation behavior intact. The hub's Ask box is this, matter-scoped.
- **#4 Persistent Documents split + #1 real-file import & trust (ReimaginedDocumentsHome + DocumentBrowser).** Replace the browser<->editor toggle with a persistent file list (left) + document (right) so you never lose your place. Add a clear "Add your files" import affordance (drag-drop / picker) and a one-time "Indexed on your machine. Nothing was uploaded." confirmation the first time a real file is added to a matter. Keep the email-open advance + trash working.
- **#5 Isolated-matter celebration (MatterManagerDialog + ConfidentialityModeSettings).** When network lockdown is enabled on a matter, a clear shield + confirmation moment (not just a quiet status line). Expose the state for the hub header.

### WAVE R3-2 — the matter hub (after R3-1 commits)
- New `MatterHub` component + `ReimaginedMattersHome` list<->hub view + App.tsx wiring. Assembles the header (#5 Isolated), the matter Ask (#3), at-a-glance (#6), and the Documents/Email/Workflows/Activity preview panels (`>` = `keepance:matter-launch`). Sample matter uses demo data for a populated, compelling hub. Graceful no-key + empty states. Keyboard accessible. The existing launchpad quick-actions are subsumed (the row still opens the hub).

### WAVE R3-3 — consistency cleanups + smaller items + momentum extras
- **C2 consistent primary-action placement** across surfaces (one predictable spot for "the thing you do").
- Smaller logged items: matter-name ellipsis at narrow widths; email mode-hint wrap; email-viewer error copy leaking the raw id; email-connect value pitch before the OAuth friction.
- **#6 momentum beyond the hub** (light): a sense of the practice growing on the Matters list (counts/recent), if cheap.
- Sweep the ledger's Round 1/2 open items and close the cheap ones.

## Verification gate (every wave)
typecheck 0 · targeted vitest then full suite at boundaries · cargo only if Rust touched · eslint clean on touched · live dev-server check (the relevant surface renders, `--kp-navy` ok, zero page errors; the hub shows for a matter; citations still survive nav).

## Out of scope / still deferred (unchanged)
The full matter-first nav rewrite (Jameson chose the in-tab hub instead); Settings IA (the ~20-category list) is a separate future pass. Everything else in the ledger is being done this round.

## Resume note
Commits land per wave on `feature/ux-fixes-round3-2026-06-14`. Resume from the first unchecked wave.
Companion: `2026-06-14-ux-program-LEDGER.md` (master idea ledger; update statuses as Round 3 lands).
