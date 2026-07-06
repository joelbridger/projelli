# Worker brief — UI Simplification Pass (BUILD-ONLY during demo freeze)

You are **cc-lantern-uisimp**, worktree **~/lp-uisimp**, branch **lp/ui-simplification** (off tip edde3e89). Large but fully-specified UI lane. You do NOT merge. 🧊 **TIP FREEZE IS ON: your branch will NOT merge until after the demo rehearsal — build it complete, keep it clean, push, and stop. Never touch the main checkout.**

## Spec = `coordination/UI-SIMPLIFICATION-PASS.md` — read it fully; the audit is DONE with a concrete work-list.
Summary of the work (the spec is authoritative):
1. Build a tiny **InfoHelp** primitive: an "i" icon + the EXISTING Radix tooltip (`src/ui/tooltip.tsx`). Nothing shows until hover.
2. Sweep the audited gray-subtext locations (Settings incl. AI & Privacy cards; Onboarding scenes; ALL connector cards — the spec lists files/lines): delete the default gray explanatory paragraph, put its text behind an InfoHelp next to the title. **Keep WARNING/STATUS text visible** — only passive explanations move behind the "i".
3. Client list in `src/app/shell/layout/Spine.tsx`: delete the redundant repeated light-gray client-name subtext (~line 178 in the audit; NOTE: Spine changed recently — re-locate by content, the audit's line numbers may have drifted); make the client list a collapsible auto-collapsing "Clients" section instead of filling the whole sidebar.
4. LIGHT theme, existing design system, consistent InfoHelp placement.

## Method
- Batches with tests: InfoHelp primitive first (unit test), then sweeps in reviewable chunks (one commit per area: settings / onboarding / connectors / spine).
- tsc + SCOPED vitest per batch (never the full suite — coordinator gate handles that at merge); `node scripts/eslint-gate.mjs` if quick.
- Rebase onto origin/lantern-plus before your final push if it moved.

## Done criteria (HARD)
All spec items built, committed AND pushed (`git push --no-verify -u origin lp/ui-simplification`). THEN print exactly: `WORKER-DONE: lp/ui-simplification` + a per-area summary (what moved behind InfoHelp where, what stayed visible and why). Your branch then WAITS for the post-demo merge window.
