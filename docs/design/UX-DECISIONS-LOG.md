# UX Decisions Log

## 2026-07-03 — Jameson APPROVED reimagine Waves A + B (branch `ui/reimagine`)
Jameson reviewed both waves live in a browser (web-demo, before/after side by side) and approved ALL changes: "I like all the changes. They all make it a better user experience. Please lock these in and plan to implement them at the proper time and in a safe way."

**Approved bundle (branch `ui/reimagine`, tip `3e07fb99`):**
- Wave A (7 surgical fixes): onboarding CTA fold + duplicate-icon fix, inline consent prompt on Client Map + docx redline (reusing the Ask consent component), blank-map → needs-you state, sidebar duplicate-subtitle removal, local-AI onboarding copy branch, combined indexing count, precise trust-chip copy, Reset-to-Defaults demotion.
- Wave B (5 structural): single client-list model (icon-rail sidebar + hover row actions), Ask segmented scope control + Sources popover, merged single header, flattened anchor-nav Settings, three-state audit fixing 6 surfaces (Client Map retry, Workflows AI-unreachable→Settings + Recent-runs empty state, Ask conversations rail, GuidedInterview blank). All approved incl. the smaller three-state items.

**STATUS: APPROVED + SHELVED. Do NOT merge to keepance-3.0 yet.**

### Implementation plan (Jameson's timing call, 2026-07-03)
1. Branch stays parked, untouched, fully tested (5,327 vitest green, 4 codex rounds, Playwright-verified).
2. WAIT for Lantern-Plus to finish + integrate its new features (meetings/capture, calendar, CRM write-back) — they touch overlapping surfaces (App.tsx, sidebar, Ask, Settings, headers). Merging the redesign before that = double work + conflict risk.
3. THEN one holistic redesign pass over the COMPLETE app (approved A+B changes + the new features + the Wave C "invisible mode" bet, which remains discussion-first) → Jameson reviews the unified result → merge together.
4. Rebase `ui/reimagine` onto the post-integration tip at that time (expect conflicts in the shared surfaces; resolve preserving both intents).

### Open for the next round (not yet built)
- Wave C "invisible mode" (app opens into Ask; Workflows-as-suggestions) — evaluation §4 Wave C — DISCUSS before building.
- 3 lower-priority three-state stragglers deferred by the worker: DocxViewer misleading button · Documents loading/empty ambiguity · Email empty-state actions.
- Insert-link in the Word engine (table-stakes editor affordance; engine work).
- Real-desktop daily-use validation of A+B (browser demo ≠ full desktop).
