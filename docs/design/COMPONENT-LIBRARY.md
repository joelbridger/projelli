# Keepance Component Library

> The **component layer** of the design system. The token layer (color, spacing, type, elevation, sizing, motion in `globals.css`) is the vocabulary; this is the finished sentences. Every shared control — buttons, inputs, filters, badges, cards — is built once here, so two buttons that do the same job are the same size *by construction*, now and as the app grows.
>
> Built after a six-pass UX + visual-consistency audit of the whole app (2026-06-15). Components live in `src/components/ui/kp/`; their look lives in `src/styles/globals.css` under `@layer components`. Import from `@/components/ui/kp`.

## Why this exists (the two things that were wrong)

The token layer existed, but there was no component layer, so every button and filter was hand-styled inline. The audit quantified the damage:

- **Buttons:** the primary "do the main thing" button had **5 different paddings and 2 different font sizes** across the app. "New matter" was `8px 14px` / 13px; "New email" was `5px 12px` / 12px — visibly different sizes for the same role. (This is exactly what Jameson flagged.)
- **Filters:** the Activity Log filter toggle was 32px tall; Email's was ~22px. Activity Log expanded a full-width elevated **panel**; Email expanded an inline **row** with no elevation. The count badge was 18px on one, 15px on the other. Three unrelated-looking implementations of the same control — the "clash" Jameson saw.
- Plus: 7 different border-radii for the same pill, 4 different close-button treatments, empty states with 4 different icon sizes, eyebrow labels with 8 different letter-spacings, and Settings written in a different styling system than every other surface.

The fix is structural: **surfaces stop styling controls and start using components.** A button is `<Button variant="primary" size="md">`, not 6 lines of inline CSS. Change a button everywhere by editing one CSS rule.

## How it works

Each component is a thin React wrapper that maps props → a CSS class. The CSS (in `@layer components`) references only design tokens and handles `:hover` / `:active` / `:focus-visible` / `:disabled` natively (which inline styles can't). So:

- **One source of truth.** The look of every primary button is one `.kp-btn--primary` rule.
- **Token-driven.** Sizes come from `--kp-control-*`, fonts from `--kp-font-*`, etc. Retune the whole system from `globals.css`.
- **Real states.** Hover, press, focus ring, disabled, loading are built in and uniform.
- **Icons sized by the system.** Components take an icon *component* (e.g. lucide `Plus`) and size it themselves — no more ad-hoc `size={11}`.

---

## The components

### `<Button>` — the primary action control
Resolves: 5 paddings → 3 sizes; 2 font sizes → 1 per size; the "New matter vs New email" mismatch.

| Prop | Values | Default |
|---|---|---|
| `variant` | `primary` · `secondary` · `ghost` · `danger` · `link` | `primary` |
| `size` | `sm` · `md` · `lg` | `md` |
| `iconLeft` / `iconRight` | a lucide icon component | — |
| `loading` | shows a spinner, disables the button | `false` |
| `fullWidth` | stretches to container | `false` |

**Sizes** (height from `--kp-control-*`, all `radius-md`):

| size | height | padding | font | icon |
|---|---|---|---|---|
| `sm` | 28px | `0 10px` | `--kp-font-xs` (12) | 14 |
| `md` | 32px | `0 14px` | `--kp-font-sm` (13) | 16 |
| `lg` | 40px | `0 18px` | `--kp-font-md` (14) | 16 |

**Variants:** `primary` = navy fill; `secondary` = white + border + navy text; `ghost` = transparent, tints on hover; `danger` = red fill; `link` = underlined text, no box. **States:** hover (navy lightens / 5% tint), active (darker), focus (app focus ring), disabled (`--kp-opacity-disabled`), loading (spinner).

Header primaries ("New matter", "New email", "New Word document", "Connect your email") → `primary` / `md`. In-context submits (Ask "Search", a card's "Run") → `primary` / `sm`. Export / Set up / Try again → `secondary`. Sort headers, breadcrumbs, collapse → `ghost`. Inline text links → `link`.

### `<IconButton>` — icon-only buttons
Resolves: 4 different close-X treatments; 12px vs 14px clear icons. Requires an accessible `label` (icon-only buttons must be announced).

| size | box | icon |
|---|---|---|
| `xs` | 20×20 | 12 |
| `sm` | 28×28 | 14 |
| `md` | 32×32 | 16 |

Variants `ghost` / `secondary` / `primary`. Inline dismiss (tab close, search clear, card dismiss) → `ghost` / `xs`. Panel / dialog close → `secondary` / `sm`.

### `<SearchField>` — the one search input
Resolves: 3 different field heights, 3 focus behaviors (one had none), `--radius-lg` vs `--radius-md` vs raw 4px. One field, navy border on focus, optional clear button. Sizes `sm` (28px) / `md` (32px).

### `<SegmentedToggle>` — pick-one switches
Resolves: 3 separate scope/view-toggle implementations. `variant="pill"` (white card active — scope toggles) or `variant="filled"` (solid navy active — Tree/Grid view). Generic over the option value; renders accessible `aria-pressed` buttons.

### `<FilterToggle>` + `<FilterPanel>` — the unified filter pattern
Resolves: the headline "filters clash." `FilterToggle` is the one Filters button — 32px tall, `--kp-control-md`, with a `<CountBadge>` (18px) and a chevron that rotates when open. `FilterPanel` is the one expanded surface — full width, `--kp-shadow-2`, labeled sections via `kp-filter-panel__label`. Every surface (Search, Email, Activity Log) uses the same two pieces; only the *contents* of the panel differ.

### `<Badge>` — status / label pills
Resolves: 7 radii, 3 paddings, hardcoded greens. One radius (`--radius-sm`), two sizes (`sm`/`md`), variants keyed to meaning: `neutral` · `privilege` · `sample` · `local` · `direct` · `assured` · `success` · `warning` · `danger` · `featured`. `mono` for model names / matter numbers; `uppercase` for eyebrow-style tags. The privilege/sample/egress states now use the real `--kp-local/direct/assured` tokens instead of one-off hex.

### `<Chip>` — interactive filter / selection
Pill-shaped, navy fill when `active`. Replaces practice-area chips, recent-session chips, audit category chips, example questions. Sizes `sm` / `md`.

### `<CountBadge>` — numeric indicator
18×18 navy circle. One size everywhere (was 15 vs 18).

### `<Eyebrow>` — uppercase section / column label
One size (`--kp-font-2xs`), one weight (semibold), one tracking (`--kp-tracking-eyebrow` = 0.07em). `primary` for navy section leads. Replaces 8 different letter-spacings and the bold/semibold split.

### `<Card>` — containers
`flat` (list/table wrapper, no shadow/pad), `raised` (info panel, `--kp-shadow-1` + `--kp-card-pad`), `interactive` (clickable result, lifts to `--kp-shadow-2` on hover). `featured` = navy 1.5px border + tint. Fixes the unstyled MatterHub right panel, the 1px-vs-2px border split, and the `#fff`-vs-token background drift.

### `<EmptyState>` — empty / no-results states
One layout: icon (32, decorative stroke) → title (`--kp-font-lg`/semibold/navy) → body (`--kp-font-sm`/muted, max 340px) → optional actions. `compact` for in-card states. Replaces 4 icon sizes, 2 title sizes, 5 padding values.

### `<Callout>` — info / warning / error banners
`info` (secondary bg), `warning` (`--kp-warning` tokens), `error` (`--kp-danger` tokens). Optional dismiss. One radius (`--radius-lg`), one padding. Replaces GetStartedCard / SampleBridge / trial / provider-error banners' four different treatments.

---

## New tokens added for this layer

`--kp-success` / `--kp-warning` (+ `-bg` / `-line`) — the green "done/verified" and amber "warning" semantics that were hardcoded. `--kp-icon-2xs` (10px) and `--kp-icon-2xl` (32px) — the micro-icons and empty-state heroes that had no token. `--kp-icon-stroke` (1.75) / `--kp-icon-stroke-decorative` (1.5) — the two icon stroke weights. `--kp-tracking-eyebrow` (0.07em) — the one eyebrow letter-spacing.

## The tail (next, lower-visibility)

The **floating elements** (modals, popovers, dropdowns, the audit slide-in, tooltip) still use ad-hoc z-index and shadows — the `--kp-z-*` and `--kp-shadow-3` tokens exist but aren't wired in, the scrims disagree (8% navy vs 80% black), and only one modal animates. These don't read as "inconsistent" the way buttons and filters did, so they're the next pass: a `<Modal>` / `<Dropdown>` / `<SlidePanel>` set that wires the existing z-index + shadow tokens and one shared scrim. Tracked, not urgent.

Two surface-skeleton items also remain: MatterHub builds its header inline instead of using `<SurfaceHeader>`, and Settings is written in Tailwind utility classes rather than the inline-token system — both work and look right today, but should converge for full token-propagation.

## Sources
- [Design system anatomy / component checklist (Nielsen Norman Group)](https://www.nngroup.com/articles/design-systems-101/) · [Component API design (Brad Frost, Atomic Design)](https://atomicdesign.bradfrost.com/chapter-2/)
- [Button anatomy — variants, sizes, states (Material 3)](https://m3.material.io/components/buttons/specs) · [Buttons (Carbon)](https://carbondesignsystem.com/components/button/usage/) · [Buttons (Polaris)](https://polaris.shopify.com/components/actions/button)
- [Forms / text fields (Polaris)](https://polaris.shopify.com/components/selection-and-input/text-field) · [Filtering patterns (Carbon)](https://carbondesignsystem.com/patterns/filtering/) · [Tag / badge (Atlassian)](https://atlassian.design/components/badge/examples)
- [Empty states (Pencil & Paper UX patterns)](https://www.pencilandpaper.io/articles/ux-pattern-analysis-empty-states) · [Elevation + z-index layering (Material)](https://m3.material.io/styles/elevation/overview)
