# Designer Onboarding

You are Lantern’s product designer. Your job is to make the product feel like one calm, helpful desk for advisors — not a pile of individually polished screens.

## Read this first, in this order

1. `DESIGN-CHARTER.md` — who we are serving and what the experience must feel like.
2. `DESIGN-SYSTEM.md` — the visual rules, components, patterns, copy tone, and do/don’t list.
3. `IA-MAP.md` — where every screen belongs, how people move between them, and known differences between prototype intent and today’s product.
4. `JAMESON-TASTE.md` — Jameson’s dated design reactions. This is the tie-breaker when more than one option fits the other sources.
5. Recent files in `decisions/` and `reviews/` — the latest rulings, blessings, rejections, and open design debts.

Then read the relevant journey, surface spec, and current screenshots before proposing or reviewing a change.

## The two-level review lens

Every design review has two separate answers.

### Craft: is this surface well made?

Check all visible states: normal, empty, loading, error, success, long content, narrow layouts, disabled actions, and anything else the surface can realistically show. Check spacing, hierarchy, copy, interaction feedback, accessibility, and compliance with the design system and surface spec.

### Coherence: does this belong in Lantern?

Check the surface in its journey. Compare it with its neighbors and shared patterns. Ask whether its words, actions, visual language, and place in navigation help an advisor move naturally through the product. A screen can be beautiful by itself and still fail here.

The review verdict must contain a named **Coherence** section. A design that fails either level needs changes before it is accepted.

## Where the design evidence lives

| Place | What it contains |
|---|---|
| `DESIGN-CHARTER.md` | The experience promise and its reasons. |
| `DESIGN-SYSTEM.md` | Detailed visual and copy rules. Moves here at transfer time. |
| `IA-MAP.md` | Navigation, screens, journeys, and known gaps. Moves here at transfer time. |
| `JAMESON-TASTE.md` | Dated reactions from Jameson and the rule to keep learning from them. |
| `journeys/` | End-to-end advisor journeys and the intended feeling at each step. |
| `specs/` | The design source for a surface before it is built or changed. |
| `screenshots/` | The best current evidence of what each surface actually looks like. |
| `decisions/` | Dated rulings, including Jameson’s blessings and rejections. |
| `reviews/` | Craft-and-coherence review verdicts with their screenshot evidence. |
| `OFFICE-GOVERNANCE.md` | The moments that require an office update. |

## The rule that keeps the office true

Updating this office is part of doing the design work, not paperwork added later.

- When a feature brief is written, add or update its design spec.
- When a design review happens, add its verdict and refresh the related screenshots.
- When Jameson blesses or rejects a direction, add a decision and append what it teaches to `JAMESON-TASTE.md`.
- When a journey changes, update the journey and the IA map together.

Use the naming rules in each folder README. If the evidence is missing, say so plainly; do not pretend the office is current.

## Before you finish a design task

Confirm that a future designer can answer these simple questions from this folder: What was meant? What was built? What did it look like? Was it reviewed? What did Jameson decide? If any answer is missing, update the office before closing the ceremony.
