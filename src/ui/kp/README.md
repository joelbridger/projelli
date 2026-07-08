# `kp` — the Advisor Prep Hero design-system layer

Surfaces import primitives from `@/ui/kp`; the look lives in
`src/styles/globals.css` (`@layer components`). Spec + rationale:
`docs/design/COMPONENT-LIBRARY.md`.

## Colour rule (finding F3)

**Accent = selection/primary. Red = destructive/error only, and destructive
actions default into row menus.**

The brand accent (red/pink) marks the *selected* tab or the *primary* action, and
nothing else. Red (`--kp-danger`) is reserved for destructive or error states —
never the default colour of a link or a button that merely sits in a list. So:

- A "Remove" / "Delete" action is not a red link in the row. It lives in the
  row's `...` menu, and only turns red inside that menu.
- `Button` defaults to `variant="primary"`; red is the explicit
  `variant="danger"` opt-in. `Button`'s `link` variant is navy, not red.
- `IconButton` offers no red variant at all — it is for calm utility actions.
- `Badge`'s red is the explicit `variant="danger"`.

If you find yourself typing a red colour into a feature screen, stop: either it is
a genuine destructive/error state (use the `danger` variant), or it should not be
red.

## Trust-ladder primitives

The trust ladder (synthesis theme 4) has three rungs; two primitives serve rungs
2 and the quiet end of rung 1:

- **`TrustNote`** — rung 2, "one short line at action time" (e.g. next to Send /
  Run). Quiet muted text by default; `warning` (amber) and `blocker` (red)
  variants for real risk only; the long explanation goes in `details` (revealed
  on hover) so the visible line stays short. Never a framed box — that is
  `Callout`.
- **`QuietStatus`** — normal-good states said quietly (theme 6): a muted tick +
  short text, or *nothing* when there is nothing useful to say. Only gets loud
  when the caller passes `state="failure"`. Use it for saved / reviewed / ready /
  "no new changes".

## Egress status is single-sourced

The always-visible egress indicator (where the next AI request goes) renders
**once**, in the top bar (`TrustBar`). Do not add a second egress pill to a
surface header — the per-surface duplicates were removed in F1 because they could
contradict the top bar on one screen. Trust *at action time* uses a `TrustNote`
line, not another status pill.
