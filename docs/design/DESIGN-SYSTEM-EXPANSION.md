# Keepance Design System — Expansion Report

> Where the design system stands today, what a complete one needs, and a prioritized plan to get there. Written after rolling out the spacing system, in response to "how do we expand and improve this further (shadows, font sizes, etc.)."

## ✅ Implementation status (2026-06-15)
**The full token system is now defined in `globals.css` and the visible foundations are applied across every surface:**
- **Typography scale** (`--kp-font-*`, `--kp-weight-*`, `--kp-leading-*`) — defined + applied (all ad-hoc font sizes migrated).
- **Elevation** (`--kp-shadow-1/2/3`) — defined + applied (floating cards/popovers/modals; dense tables stay flat).
- **Sizing** (`--kp-icon-*`, `--kp-control-*`) + **radius** usage — defined + applied.
- **Motion** (`--kp-duration-*`, `--kp-ease-*`), **z-index** (`--kp-z-*`), **focus ring** (`--kp-focus-ring`), **border width**, **opacity** — defined and available; broad application is the ongoing polish tail (adopt as components are touched).
- **Responsive width:** every full-page surface now fills the available width (`flex: 1` on each root) instead of stopping short.

## The mental model (from the research)

A mature design system is a set of **design tokens** organized in layers:

- **Primitives** — raw, context-free values (`--kp-space-lg: 24px`, `--kp-navy: #0a2540`). The palette of options.
- **Semantic** — named by *role*, referencing primitives (`--kp-gutter`, `--kp-surface-gap`). This is where intent lives; you tune the whole app from here.
- **Component** — per-component, referencing semantics (usually optional for an app this size).

A *complete* system covers these categories: **Color · Typography · Spacing · Sizing · Shape (radius) · Border · Elevation (shadow) · Motion · Z-index · Opacity · Focus**. Keepance has a strong start on three of them and is missing or ad-hoc on the rest.

## Where Keepance stands today (audit of `src/styles/globals.css`)

| Category | Status | Notes |
|---|---|---|
| **Color** | ✅ Strong | Full shadcn set + brand (`--kp-navy/pink/blue/grad`) + accessible egress states (`--kp-local/direct/assured/danger`), all WCAG-AA checked. |
| **Spacing** | ✅ Done | 8pt scale + semantic layout tokens (just shipped). |
| **Radius** | ◑ Partial | `--radius` + sm/md/lg exist, but components hardcode `borderRadius: 6/8` inline instead of using them. |
| **Font family** | ✅ | `--font-sans` (Satoshi), `--font-mono`. |
| **Typography scale** | ✗ Missing | Font sizes/line-heights/weights are ad-hoc inline (`fontSize: 11/12/13/14/16/22`...). No type tokens, no defined hierarchy. |
| **Elevation / shadow** | ✗ Missing | The UI is almost entirely flat (1px borders). No shadow scale, so no depth hierarchy for cards vs popovers vs modals. |
| **Sizing (controls/icons)** | ✗ Missing | Button/input heights and icon sizes (14/16/18/22) are ad-hoc per component. |
| **Motion** | ✗ Mostly missing | Only accordion keyframes + one `prefers-reduced-motion` rule. Durations/easings are ad-hoc. |
| **Z-index** | ✗ Missing | Modals/popovers/tooltips use ad-hoc z-values → stacking-order risk. |
| **Border width** | ◑ | Border *color* is tokenized; *width* and the hairline-vs-control distinction aren't. |
| **Opacity** | ✗ | Disabled/hover opacities (0.45/0.55/0.85) are ad-hoc. |
| **Focus ring** | ◑ | Added some in the a11y round, but not a single tokenized ring. |

**Bottom line:** the foundation (color, brand, spacing) is genuinely good. The gaps that would most improve polish and consistency are, in order: **typography, elevation, sizing, motion**.

---

## Proposed additions (specific, tailored to Keepance: light theme, Satoshi, professional/legal)

### 1. Typography scale — highest impact
Anchor a modular scale (~1.2 ratio) at a 14px UI base, with line-heights on the 4px grid. Define **primitive sizes** and **semantic text roles**:

| Role token | Size / line-height | Weight | Use |
|---|---|---|---|
| `--kp-text-display` | 28 / 36 | 700 | rare hero numbers |
| `--kp-text-title` | 22 / 28 | 700 | surface headers (already the de-facto title) |
| `--kp-text-heading` | 18 / 24 | 600 | section headings |
| `--kp-text-subheading` | 16 / 24 | 600 | card titles |
| `--kp-text-body` | 14 / 20 | 400 | default UI text |
| `--kp-text-body-strong` | 14 / 20 | 600 | emphasized body |
| `--kp-text-label` | 13 / 16 | 500 | buttons, labels |
| `--kp-text-caption` | 12 / 16 | 400 | muted/secondary |
| `--kp-text-eyebrow` | 11 / 16 | 600, +0.06em, uppercase | section eyebrows ("GET STARTED") |
| `--kp-text-mono` | 13 / 20 | mono | citations, matter numbers, the record |

Line-height ≥ 1.4 for body (readability, dyslexia/low-vision friendly). This replaces ~6 ad-hoc font sizes with a clear hierarchy.

### 2. Elevation / shadow scale — most visible polish
The app is very flat. A subtle, **navy-tinted** elevation scale (branded depth, not pure black; each level = a sharp "key" + soft "ambient" shadow) adds hierarchy:

| Token | Value (tinted with navy 10,37,64) | Role |
|---|---|---|
| `--kp-shadow-0` | none | flat, border-only (dense tables) |
| `--kp-shadow-1` | `0 1px 2px rgba(10,37,64,.06), 0 1px 3px rgba(10,37,64,.04)` | resting cards/panels |
| `--kp-shadow-2` | `0 4px 12px rgba(10,37,64,.08), 0 2px 4px rgba(10,37,64,.05)` | popovers, dropdowns, the matter picker |
| `--kp-shadow-3` | `0 16px 40px rgba(10,37,64,.16), 0 4px 12px rgba(10,37,64,.08)` | modals, the Data Map |

Recommendation: keep dense tables flat (border only), give floating cards `shadow-1`, and reserve `shadow-2/3` for things that literally float. Test contrast in light mode (shadows are subtle on white — these are tuned for it).

### 3. Sizing — control heights + icon sizes
| Token | Value | Use |
|---|---|---|
| `--kp-control-sm/md/lg` | 28 / 32 / 40px | consistent button + input heights |
| `--kp-icon-sm/md/lg/xl` | 14 / 16 / 18 / 22px | the lucide icon sizes (already the common values, just unsystematized) |

### 4. Motion
| Token | Value | Use |
|---|---|---|
| `--kp-duration-fast/base/slow` | 120 / 200 / 320ms | hover/press · enter-exit · larger transitions |
| `--kp-ease-standard` | `cubic-bezier(.2,0,0,1)` | most transitions |
| `--kp-ease-decelerate` | `cubic-bezier(0,0,0,1)` | elements entering |
| `--kp-ease-accelerate` | `cubic-bezier(.3,0,1,1)` | elements leaving |

Keep it calm and quick — this is a professional tool, not a toy. Everything already honors `prefers-reduced-motion` (from the a11y round); extend that rule to cover new transitions.

### 5. Robustness tokens (lower visual impact, real value)
- **Z-index scale:** `--kp-z-sticky 10 · dropdown 100 · overlay 1000 · modal 1100 · popover 1200 · toast 1300 · tooltip 1400` — ends ad-hoc stacking bugs.
- **Focus ring:** one token, `--kp-focus-ring: 0 0 0 2px var(--color-background), 0 0 0 4px var(--kp-navy)` — consistent, accessible, used everywhere.
- **Border widths:** `--kp-border-hairline 1px` (decorative) vs `--kp-border 1px` (controls, ≥3:1) vs `--kp-border-strong 1.5px` (focus/active).
- **Opacity:** `--kp-opacity-disabled .45 · muted .65 · hover-overlay .05`.
- **Radius:** actually *use* the existing `--radius-*` tokens (components hardcode `borderRadius: 6/8` today).

---

## Recommended rollout (prioritized)

1. **Typography scale** — define the tokens + semantic text roles, then migrate surfaces (same pattern as spacing). Biggest hierarchy + consistency win.
2. **Elevation** — add the shadow scale, apply to floating cards/popovers/modals. Biggest "feels polished" win.
3. **Sizing + radius** — tokenize control heights, icon sizes, and switch hardcoded radii to `--radius-*`.
4. **Motion** — add duration/easing tokens, standardize transitions.
5. **Z-index, focus ring, borders, opacity** — robustness + a11y cleanup.

Each step: define tokens in `globals.css`, document here + in a `TYPOGRAPHY.md`/`ELEVATION.md` companion, then roll across surfaces via parallel per-surface passes (the spacing rollout proved this works cleanly). All of it stays light-theme, Satoshi, navy, no em-dashes.

## A note on scope
This is the difference between "a token file" and "a design system." Keepance already has the hard part (a coherent brand + accessible color + now spacing). Typography and elevation are the two that will most visibly level up the product; the rest is consistency and robustness. None of it requires new dependencies — it's all CSS custom properties on the existing Tailwind v4 `@theme`.

## Sources
- [Typography system design & type scales (Figr)](https://figr.design/blog/typography-system-design) · [Typography tokens with semantic scaling (UX Collective)](https://uxdesign.cc/mastering-typography-in-design-systems-with-semantic-tokens-and-responsive-scaling-6ccd598d9f21) · [Establishing a type scale (Cieden)](https://cieden.com/book/sub-atomic/typography/establishing-a-type-scale)
- [Elevation foundations (Atlassian)](https://atlassian.design/foundations/elevation) · [Elevation (Fluent 2 — key+ambient)](https://fluent2.microsoft.design/elevation) · [Shadow tokens (Polaris)](https://polaris.shopify.com/design/depth/shadow-tokens) · [Shadow tokens (USWDS)](https://designsystem.digital.gov/design-tokens/shadow/)
- [Design token taxonomy (Intuit / Nate Baldwin)](https://medium.com/@NateBaldwin/creating-a-flexible-design-token-taxonomy-for-intuits-design-system-81c8ff55c59b) · [Motion tokens (Material 3)](https://m3.material.io/styles/motion/easing-and-duration/tokens-specs) · [Motion (Carbon)](https://carbondesignsystem.com/elements/motion/overview/) · [Naming design tokens (Smashing Magazine)](https://www.smashingmagazine.com/2024/05/naming-best-practices/)
