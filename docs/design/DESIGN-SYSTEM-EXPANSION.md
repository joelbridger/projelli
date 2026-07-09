# Advisor Prep Hero Design System

**Updated:** 2026-07-09
**Scope:** post-2026-07 UI overhaul
**Status:** canonical design-system guide. The filename is kept so older links to the former "expansion report" still land here.

This doc explains the patterns, principles, tokens, and brand rules that now govern the app. The component-by-component API reference lives in [`COMPONENT-LIBRARY.md`](COMPONENT-LIBRARY.md).

## Sources of Truth

- Tokens and component CSS: [`src/styles/globals.css`](../../src/styles/globals.css)
- Shared components: [`src/ui/kp/`](../../src/ui/kp/)
- Full-surface header: [`src/ui/SurfaceHeader.tsx`](../../src/ui/SurfaceHeader.tsx)
- Brand config: [`brand/brand.config.json`](../../brand/brand.config.json), generated into [`src/config/brand.ts`](../../src/config/brand.ts)
- Brand swap guide: [`brand/README.md`](../../brand/README.md)
- UX simplification synthesis: [`coordination/reports/ux-simplification-2026-07-08/SYNTHESIS.md`](../../coordination/reports/ux-simplification-2026-07-08/SYNTHESIS.md)
- Fable follow-up: [`coordination/reports/ux-simplification-2026-07-08/FABLE-ENHANCED.md`](../../coordination/reports/ux-simplification-2026-07-08/FABLE-ENHANCED.md)

## Design Principles

### 1. One obvious next action

Each surface should have one clear primary action. Secondary, rare, and destructive actions move into a vertical-dot menu or appear only after hover, focus, selection, or opening a flow.

Primary or risky actions still need words. Do not hide Send, Run, Stop, Mark reviewed, or destructive confirmations behind a bare icon.

### 2. Flat until something needs a frame

Rails, lists, side panels, settings rows, source rows, and metadata should usually be flat rows with light dividers and whitespace. Cards are for repeated items, framed tools, modals, and intentionally raised panels.

Do not stack cards inside cards as decoration.

### 3. One home for each idea

If one part of the page already says something, another part should not repeat it. A citation chip proves a source. The top bar owns egress status. Privacy Center owns deep privacy detail. The rail says where the user is.

Repeating the same meaning makes the app feel less trustworthy, even when each individual line is true.

### 4. Trust gets smaller, not weaker

The trust story stays. It is shown in the right amount at the right moment:

- Always visible: one tiny egress status in the top bar.
- At action time: one short `TrustNote` line beside the risky action.
- On demand: full detail in a tooltip, disclosure, Privacy Center, or dialog.

Do not remove load-bearing trust signals. Move repeated explanations closer to the moment they matter.

### 5. Quiet is the default state

Normal-good states should be small or invisible. Failures, blockers, and risk states stay visible. Helper copy should be short, sentence case, and plain.

Use `QuietStatus` for saved, ready, reviewed, connected, and installed states. Use louder patterns only when the user needs to stop or fix something.

## Protected Trust Rules

The overhaul trims noise, not safety. These must not be removed during future simplification work:

- Citations, citation chips, exact quotes, source verification states, stale export warnings, and verified/unverified review counts.
- Consent and review gates before AI file access, whole-practice sends, email sends, meeting sends, recording, external sharing, destructive actions, and permanent delete.
- Client isolation, sample status, client-scoped wording, and anything that prevents a client-data mix-up.
- The single always-visible AI/data destination signal. It can be tiny, but it cannot disappear or be duplicated by a conflicting surface-level pill.
- Privacy Center, Data Map, privacy reports, and Local-only / BYOK-direct / Assured choices.
- Importing, indexing, provider, Local AI, trial, and blocker states when they explain why work cannot proceed or why an answer may be incomplete.
- Recording consent, spoken notice, strict notice quarantine, Notice Card support, local recording status, biometric consent, and voice-profile deletion confirmation.
- Recoverability: Trash count, restore, permanent delete confirmation, empty-trash confirmation, retention settings, and save-failure escalation.
- Word review, tracked changes, clean-copy export, and hidden-metadata removal.
- Created-file links after workflows, because they prove the workflow made a real document.

## Cross-App Patterns

### Unified rail header

**Components:** `RailShell`, `RailShellHeader`, `RailShellActionMenu`, `SearchField`, `IconButton`

Every rail uses the same header order:

1. Title.
2. Icon-first search.
3. Create action (`+` or a create menu).
4. Vertical-dot menu.
5. Collapse control.

Rail search is always icon-first. It opens on click, stays open while it has text, and collapses on empty blur. There are no count thresholds.

### Full-surface header

**Component:** `SurfaceHeader`

Every full surface uses the same icon + title row height through `--kp-surface-header-row-height`. The icon matches the nav item. The title is full-size. The description is one short line.

Use `SurfaceToolbar` below it when the surface needs search, filters, toggles, or other whole-surface tools.

### Vertical-dot menus everywhere

**Components:** `RailShellActionMenu`, `IconButton`, Radix `DropdownMenu`

Use `MoreVertical` for all app menus. This makes lower-priority actions predictable and keeps calm screens from becoming toolbars.

Destructive actions belong in the menu by default, not as red links sitting in normal rows.

### Trust ladder and single-source egress

**Components:** top-bar egress indicator, `TrustNote`, `Badge`, `CiteChip`

There is one egress source of truth in the top bar. Do not add extra egress pills to surface headers. At action time, use a short `TrustNote`. For source claims, use `CiteChip` with the exact quote.

### Quiet normal states

**Component:** `QuietStatus`

Saved, reviewed, ready, installed, and connected states should be quiet. `QuietStatus state="ok"` with no text renders nothing, which is often the right answer.

Failures use `state="failure"` or a stronger warning/error component when the user needs recovery steps.

### One primary action per surface

**Components:** `Button`, `IconButton`, `RailShellActionMenu`

Use one visible `Button variant="primary"` for the main action. Use `secondary` for helpful but lower-priority actions. Use `ghost` for quiet utility. Use `danger` only inside a clear destructive flow.

### Flat rows and dividers over boxes in boxes

**Components:** `RailShell`, `Card`, `EmptyState`, `Badge`, `Chip`

Use flat rows in rails and side panels. Use light dividers from `--kp-divider`. Use `Card` only when something is a real repeated item, selected object, modal content, or framed tool.

### Compact modes, filters, and scopes

**Components:** `SegmentedToggle`, `FilterToggle`, `FilterPanel`, `Chip`, `CountBadge`

Show one compact mode/scope control. Hide full filter forms behind `FilterToggle`. Show active counts or chips only when they change what the user should do next.

## Tokens

All shared tokens are defined in the `@theme` block of [`src/styles/globals.css`](../../src/styles/globals.css). The app is light-theme first.

### Brand and color

| Token | Current value | Use |
|---|---:|---|
| `--kp-navy` | `#2b2d42` | Main text, headings, stable app identity. |
| `--kp-pink` | `#ef233c` | Brand pink. |
| `--kp-blue` | `#8d99ae` | Brand blue / softer icon accent. |
| `--kp-accent` | `#ef233c` | Selection and primary action accent. |
| `--kp-grad` | pink to blue | Brand gradient where a real brand moment needs it. |
| `--kp-divider` | navy at 10% | Light hairlines for rails, headers, splits. |
| `--kp-divider-strong` | navy at 16% | Stronger outlines for controls/cards. |
| `--kp-accent-soft` | accent at 11% | Active rows and selected pills. |
| `--kp-accent-softer` | accent at 6% | Hover row tint. |
| `--kp-text-faint`, `--kp-text-dim` | navy at 70% | Secondary text that still clears contrast. |
| `--kp-bg-soft` | `#f3f6fb` | Soft panel tint. |

Action colors derive from the accent:

- `--kp-action-bg`
- `--kp-action-bg-hover`
- `--kp-action-bg-active`
- `--kp-action-fg`
- `--kp-action-border`

**Meaning rule:** accent means selection or primary action. Red/danger means destructive or error only.

Trust/status colors:

| Token group | Meaning |
|---|---|
| `--kp-local`, `--kp-local-bg`, `--kp-local-line` | Local-only / sample-local trust state. |
| `--kp-direct`, `--kp-direct-bg`, `--kp-direct-line` | BYOK/direct provider state. |
| `--kp-assured`, `--kp-assured-bg`, `--kp-assured-line` | Assured confidentiality state. |
| `--kp-success`, `--kp-success-bg`, `--kp-success-line` | Success, sparingly. |
| `--kp-warning`, `--kp-warning-bg`, `--kp-warning-line` | Warning. |
| `--kp-danger`, `--kp-danger-bg` | Error or destructive. |

### Sidebar color

The sidebar uses the calm light palette:

- `--kp-side-bg`
- `--kp-side-fg`
- `--kp-side-fg-dim`
- `--kp-side-fg-faint`
- `--kp-side-border`
- `--kp-side-active-bg`
- `--kp-side-accent`
- `--kp-side-edge`
- `--kp-side-avatar-bg`
- `--kp-side-logo`

### Spacing

| Token | Value | Use |
|---|---:|---|
| `--kp-space-2xs` | `4px` | Icon-to-text and tiny gaps. |
| `--kp-space-xs` | `8px` | Tight inline gap. |
| `--kp-space-sm` | `12px` | Small gap. |
| `--kp-space-md` | `16px` | Default gap / compact padding. |
| `--kp-space-lg` | `24px` | Comfortable padding and content gaps. |
| `--kp-space-xl` | `32px` | Page gutter and major gaps. |
| `--kp-space-2xl` | `48px` | Large section break. |
| `--kp-space-3xl` | `64px` | Empty states. |
| `--kp-space-4xl` | `80px` | Extra-large gaps. |

Semantic layout tokens:

| Token | Current role |
|---|---|
| `--kp-gutter` | Full-page left/right padding (`32px`). |
| `--kp-surface-header-pad` | Standard surface header padding. |
| `--kp-surface-header-row-height` | Equal title-row height across surfaces. Currently `var(--kp-control-md)`. |
| `--kp-surface-gap` | Space between header divider and content. |
| `--kp-card-pad` | Padding inside cards and panels. |
| `--kp-section-gap` | Space between major sections. |
| `--kp-stack-gap` | Space between related stacked items. |
| `--kp-tab-strip-height` | Document/editor tab strip height. |
| `--kp-rail-width` | Standard rail width, `252px`. |

### Typography

Typeface is Satoshi, self-hosted for offline use.

| Token | Value | Use |
|---|---:|---|
| `--kp-font-2xs` | `11px` | Eyebrows, tiny badges, rail metadata. |
| `--kp-font-xs` | `12px` | Small controls, captions. |
| `--kp-font-sm` | `13px` | Labels, rail row titles. |
| `--kp-font-md` | `14px` | Default body/UI text. |
| `--kp-font-lg` | `16px` | Card titles and empty-state titles. |
| `--kp-font-xl` | `18px` | Section headings. |
| `--kp-font-2xl` | `22px` | Surface titles. |
| `--kp-font-3xl` | `28px` | Rare display numbers. |
| `--kp-rail-row-title-font-size` | `var(--kp-font-sm)` | Rail row title text. |
| `--kp-rail-row-meta-font-size` | `var(--kp-font-2xs)` | Rail row dates, counts, metadata. |

Weights: `--kp-weight-regular`, `--kp-weight-medium`, `--kp-weight-semibold`, `--kp-weight-bold`.

Line heights: `--kp-leading-tight`, `--kp-leading-snug`, `--kp-leading-normal`, `--kp-leading-relaxed`.

Eyebrow tracking: `--kp-tracking-eyebrow` (`0.07em`).

### Elevation

| Token | Role |
|---|---|
| `--kp-shadow-0` | Flat. |
| `--kp-shadow-1` | Resting cards and panels. |
| `--kp-shadow-2` | Popovers, dropdowns, pickers. |
| `--kp-shadow-3` | Modals, overlays, Data Map, slide panels. |

Use elevation only for things that float or need a real frame.

### Sizing

| Token | Values |
|---|---|
| Icon sizes | `--kp-icon-2xs` `10px`, `--kp-icon-xs` `12px`, `--kp-icon-sm` `14px`, `--kp-icon-md` `16px`, `--kp-icon-lg` `18px`, `--kp-icon-xl` `22px`, `--kp-icon-2xl` `32px` |
| Control heights | `--kp-control-sm` `28px`, `--kp-control-md` `32px`, `--kp-control-lg` `40px` |
| Icon strokes | `--kp-icon-stroke` `1.75`, `--kp-icon-stroke-decorative` `1.5` |

### Motion, z-index, focus, border, opacity, radius

Motion:

- `--kp-duration-fast`: `120ms`
- `--kp-duration-base`: `200ms`
- `--kp-duration-slow`: `320ms`
- `--kp-ease-standard`
- `--kp-ease-decelerate`
- `--kp-ease-accelerate`

Z-index:

- `--kp-z-sticky`: `10`
- `--kp-z-dropdown`: `100`
- `--kp-z-overlay`: `1000`
- `--kp-z-modal`: `1100`
- `--kp-z-popover`: `1200`
- `--kp-z-toast`: `1300`
- `--kp-z-tooltip`: `1400`

Other basics:

- `--kp-focus-ring`
- `--kp-border-width`
- `--kp-border-width-strong`
- `--kp-opacity-disabled`
- `--kp-opacity-muted`
- `--radius`, `--radius-sm`, `--radius-md`, `--radius-lg`

## Brand System

The product identity is swappable from one config:

1. Edit [`brand/brand.config.json`](../../brand/brand.config.json).
2. Replace assets in [`brand/assets/`](../../brand/assets/).
3. Run `npm run brand:sync`.
4. Run `npm run brand:check`.

Generated files include [`src/config/brand.ts`](../../src/config/brand.ts) and CSS brand tokens. Do not edit generated brand files by hand.

Visible app text should use brand placeholders in locale strings:

- `{{productName}}`
- `{{productNameShort}}`
- `{{productNamePossessive}}`
- `{{productAiName}}`
- `{{localAiName}}`

The code fills those from `BRAND`. Do not hard-code the product name in new feature copy.

Do not change `lockedIdentifiers` during a normal brand swap. Those values are behind-the-scenes plumbing for updates, saved keys, app data, licenses, and firm services. Changing them needs a migration plan.

## When Adding a New Feature

1. Start with `SurfaceHeader`.
2. Add `SurfaceToolbar` only if the whole surface needs tools.
3. Use `RailShell` for any pick-left/work-right layout.
4. Pick one primary action.
5. Put secondary and destructive actions in `MoreVertical` menus.
6. Use flat rows first.
7. Add trust with the ladder: top-bar egress, action-time `TrustNote`, full detail on demand.
8. Use the tokens above; do not add raw colors, radii, shadows, or one-off button sizes.

## Known Ambiguity

`SegmentedToggle` accepts `variant="pill"` and `variant="filled"`, but the current CSS renders both the same way. The current visual behavior is documented in [`COMPONENT-LIBRARY.md`](COMPONENT-LIBRARY.md); Fable should decide later whether separate variant visuals should return.
