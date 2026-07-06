# Worker brief — ui-simplification round 2: two verified review findings (small, scoped)

You are **cc-lantern-uisimpfix**. Work in the EXISTING worktree **~/lp-uisimp** (branch `lp/ui-simplification` @f8d617cf — its previous lane ended; the worktree is yours). You do NOT merge. SCOPED tests only. Read `coordination/WORKER-DISCIPLINE.md`. Do NOT redesign anything — Jameson is reviewing screenshots of this branch's look; visual output must stay pixel-identical.

## F1 — stale desktop-gate test id
`tests/desktop/specs/19-global-shell.mjs:319` still waits for `spine-nav-collapsed-files`; the 3-tab sidebar removed that id (Spine.tsx renders the new set). The full desktop gate would fail. Fix the spec to the new ids (`spine-nav-collapsed-matters` is already used at :325 — make the whole spec consistent with the actual 3-tab set; read Spine.tsx's current nav ids rather than guessing).

## F2 — interactive help control nested inside a card <button>
`ConfidentialityModeSettings.tsx` (~136, ~166): each mode card is a `<button>`, and `InfoHelp as="span"` (`src/ui/InfoHelp.tsx:40`) renders a focusable `role="button"` INSIDE it — invalid interactive-inside-interactive; keyboard/screen-reader behavior breaks and the help becomes unreachable on disabled cards. Fix without changing the visual layout: e.g. make the card a non-button container (`role="radio"`/plain div with a single real select control) OR move the InfoHelp trigger structurally outside the button while keeping its rendered position (absolute positioning within a shared wrapper). Preserve: aria-pressed/selected semantics, focus ring, disabled behavior, and the exact visual appearance. Verify with a component test (help trigger focusable + activatable independently, including on a disabled card; card still selects).

## Method
TDD where testable; tsc + scoped vitest green (bare exit codes).

## Done criteria (HARD)
Committed AND pushed (`git push --no-verify`), verify with `git ls-remote`. THEN print exactly: `WORKER-DONE: lp/ui-simplification round2` + 2-line summary.
