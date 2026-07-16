# Design Office Governance

The Design Office stays useful only if it is updated at the same moment the design work happens. An update is part of the ceremony, never an afterthought.

## Update triggers

| When this happens | Update now | What “done” means |
|---|---|---|
| A UI-touching feature is briefed | `specs/` | A named design source exists before build or review: prototype pointer plus differences, or a new derived spec. |
| A journey changes or a new journey appears | `journeys/` and `IA-MAP.md` | The path, intended feeling, and changed connections are visible together. |
| A design review is issued | `reviews/` and `screenshots/` | The verdict includes Craft and Coherence, and screenshots show the states actually reviewed. |
| A change is approved for merge | `reviews/` | The accepted verdict names the reviewed version and any follow-up debt. |
| Jameson blesses, rejects, or redirects a design | `decisions/` and `JAMESON-TASTE.md` | The exact choice, reason, date, and resulting taste lesson are recorded. |
| A design-system rule changes | `DESIGN-SYSTEM.md` and affected specs | The shared rule and the surfaces affected are clear. |
| Navigation or a surface’s home changes | `IA-MAP.md`, relevant `journeys/`, and `specs/` | The map, path, and screen-specific expectation agree. |
| A parity or fresh-eyes finding exposes drift | `reviews/`, `screenshots/`, and possibly `decisions/` | The evidence, impact, and next owner are visible; unresolved drift is not hidden. |

## Ceremony rule

Do not close a design brief, review, blessing, or journey change until its matching office update is present. If the work did not produce the expected evidence, write that honestly in the relevant file. A missing screenshot, verdict, or decision is an open design debt.

## Ownership

The current design owner keeps this office alive and leaves it clear for the next designer. D6 creates the standing design-owner role; until then, the person running the design ceremony owns the update.

## Transfer note

At the gated transfer, `DESIGN-SYSTEM.md` and `IA-MAP.md` move from the prepared source into this same folder. They are referenced here but intentionally not duplicated.
