# Lane L2 — ASK (worktree /home/jameson/lp-ux-ask, branch lp/ux-ask)

Audit file: `ask.md` (23 items). Implement all HIGH+MED per common rules. Notes:

- You OWN `src/features/ask/SourcePanel.tsx` (items 2, 6: hide empty Sources strip until citations exist; flatten source cards → quiet source rows). The Client Map lane consumes your changes at merge — make SourcePanel changes self-contained and host-agnostic (both Ask and ClientMapPanel mount it).
- Correction C3 overrides item 10: "New question" becomes a compact labeled `+ New` row, NOT icon-only.
- Correction C2 overrides item 11: rail search is ALWAYS a search icon that expands on click — no "8+ conversations" threshold.
- Item 1 (one scope menu replacing pill row + read-only pill): the scope chips row and the thread ScopeStatusPill both go; one `This client ▾` menu button in the composer.
- The Ask-header egress pill removal is L0's job — don't fight merge conflicts over it; skip that element entirely.
- Trust-copy items (4, 5, 8) use TrustNote from `origin/lp/ux-found` per common rules.
