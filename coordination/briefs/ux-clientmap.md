# Lane L3 — CLIENT MAP (worktree /home/jameson/lp-ux-clientmap, branch lp/ux-clientmap)

Audit file: `clientmap.md` (25 items). Implement all HIGH+MED per common rules. Notes:

- Do NOT edit `src/features/ask/SourcePanel.tsx` internals (the Ask lane owns that file — items 1's pane-collapse behavior is yours via the ClientMapPanel host props/state; item 6's card flattening happens in Ask's lane). If you need a SourcePanel prop that doesn't exist, add the minimal prop and note it in your done file for the coordinator to reconcile.
- Item 3 (Edit/Remove → hover `...` row menu) + finding F3: this kills six always-visible red Remove links per screen — the single biggest visual calm-down in the app. Keyboard access required (menu reachable by focus).
- Item 4: section-level history block goes; `View section history` filters the existing History slide panel.
- Item 7 (collapsed `+ Add fact` row) and 5 (Before-you-meet one-line collapse) are high-visibility — match the audit's exact copy.
- The Client Map header egress pill removal is L0's job — skip that element.
- Item 11 (last-updated quiet): normal timestamp goes into the actions menu; only failure/updating states show in the header (use QuietStatus).
