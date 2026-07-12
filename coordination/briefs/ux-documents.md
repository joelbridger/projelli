# Lane L4 — DOCUMENTS (worktree /home/jameson/lp-ux-documents, branch lp/ux-documents)

Audit file: `documents.md` (28 items). Implement all HIGH+MED per common rules. Notes:

- Items 1+2 restructure navigation: Trash becomes a pinned rail item (count badge moves with it), the Files/Trash segmented control dies, the `+` create menu moves from the rail to the content toolbar. Keep `docs-files-toggle`-style handles alive on the new controls (guard!).
- Item 4 (unbox file grid) + 7 (unbox Trash) + 9 (kill trash stats bar) + 8 (Trash `...` menu with Settings + Empty trash) are the visual core.
- Item 11 (quiet saved state) uses QuietStatus from foundation; save FAILURES stay loud (protected).
- Item 5: count label only during search. Item 6: one-CTA empty state with the audit's exact copy (F: the current screen shows BOTH "No documents yet" and "Your workspace is ready" — that double empty state dies).
- Item 28 (legacy DocumentBrowser): investigate cheaply; remove only if no live route/import uses it AND tests pass; otherwise skip with a note.
- Correction C2 applies to item 13's search field if you touch rail search anywhere: icon-expand pattern, no thresholds.
