# Advisor Prep Hero Component Library

**Updated:** 2026-07-09
**Scope:** post-2026-07 UI overhaul
**Code source of truth:** [`src/ui/kp/`](../../src/ui/kp/) and [`src/ui/SurfaceHeader.tsx`](../../src/ui/SurfaceHeader.tsx)

This is the reference for the shared UI pieces future features should reuse. The broader rules, tokens, and screen patterns live in [`DESIGN-SYSTEM-EXPANSION.md`](DESIGN-SYSTEM-EXPANSION.md).

Use this rule of thumb: if a thing looks like a common control, import the shared component instead of styling it again.

```ts
import { Button, RailShell, RailShellHeader, TrustNote } from '@/ui/kp';
import { SurfaceHeader } from '@/ui/SurfaceHeader';
```

## Current Rules

- Import shared primitives from `@/ui/kp`. Import the page header from `@/ui/SurfaceHeader`.
- Keep business logic out of these primitives. They own layout, state styling, keyboard basics, and consistent sizing.
- Use one visible primary action per surface. Put secondary, rare, and destructive actions in a vertical-dot menu.
- Use `MoreVertical` for menus everywhere. Do not invent a different menu icon.
- Use `TrustNote` for one short trust line at action time. Use `QuietStatus` for normal-good states. Use `Callout` only when a message deserves a framed banner.
- Prefer flat rows, dividers, and whitespace. Use cards only for repeated items, framed tools, modals, or intentionally raised panels.

## Layout Components

### `RailShell`

**Purpose:** The standard master-detail rail: a fixed left list plus a main content area. It owns active row styling, keyboard movement, scroll-to-active behavior, collapsed rail support, and optional row virtualization.

**Key props:**

| Prop | Purpose |
|---|---|
| `header` | Usually a `RailShellHeader`. |
| `listAriaLabel` | Required accessible name for the list. |
| `items` | Rows with `id`, `label`, optional `supportingText`, `leading`, `trailing`, or full custom `content`. |
| `activeId` / `onSelect` | Current row and selection handler. |
| `emptyState` | Optional rail empty message. |
| `railWidth` | Defaults to `var(--kp-rail-width)` (`252px`). |
| `collapsed`, `collapsedRail`, `collapsedRailWidth` | Narrow rail mode. |
| `virtualization` | Opt-in virtual list for long rails. Defaults off. |

**Modes:** normal, collapsed, and virtualized.

**Use it for:** conversations, clients, documents, email, meetings, workflow lists, and any screen that behaves like "pick an item on the left, work on it on the right."

**Do not use it for:** simple full-page content with no left list, or one-off sidebars that do not need selection and keyboard list behavior.

### `RailShellHeader`

**Purpose:** The unified rail header used across surfaces. It gives every rail the same title row and action order.

**Key props:**

| Prop | Purpose |
|---|---|
| `title` | Rail title. |
| `search` | Icon-first search config. Search opens on click and closes on empty blur. |
| `createAction` | Primary create action, usually `+` or a compact create menu. |
| `menuAction` | Vertical-dot menu. |
| `collapseAction` | Rail collapse control. |
| `actions` | Extra actions only when a surface truly needs them. |

**Use it for:** every `RailShell` header.

**Do not use it for:** full-page surface headers; use `SurfaceHeader` there.

### `RailShellActionMenu`

**Purpose:** The standard vertical-dot rail menu wrapper. It defaults to `MoreVertical` and Radix dropdown behavior.

**Key props:** `label`, `children`, optional `icon`, `align`, `className`, and `contentClassName`.

**Use it for:** rail-level actions such as import, export, archive, settings, or destructive actions.

### `SurfaceHeader`

**Purpose:** The one full-page surface header. It gives Ask, Client Map, Workflows, Documents, Activity, Settings, and similar screens the same icon + title row height.

**Key props:**

| Prop | Purpose |
|---|---|
| `Icon` | Lucide icon matching the nav item. |
| `iconColor` | Defaults to navy. Use `var(--kp-blue)` only when the surface intentionally leads with the softer accent icon. |
| `title` | Surface title. |
| `titleActions` | Small controls beside the title. |
| `description` | One short line under the title. |
| `leading` | A quiet item before the icon, usually back navigation. |
| `actions` | Right-aligned primary action or menu. |
| `testId` | Optional test handle. |

**Use it for:** full-size page/surface headers.

**Do not use it for:** rail headers or nested card headings.

### `SurfaceToolbar` and `ToolbarSpacer`

**Purpose:** The standard tools row directly under `SurfaceHeader`.

**Key props:** `children`, `className`, `style`, and `data-testid`. `ToolbarSpacer` pushes later tools to the right.

**Use it for:** search, filters, toggles, and view controls that belong to the whole surface.

**Do not use it for:** primary page titles or one-off card controls.

### `SlidePanel`

**Purpose:** Right-edge detail drawer over the shared dimmed scrim.

**Key props:** `open`, `onClose`, optional `title`, `width` defaulting to `420`, `closeLabel`, `children`, and `data-testid`.

**Use it for:** secondary detail views that should not replace the main surface, such as a preview or settings detail.

**Do not use it for:** confirmation gates. Use a dialog pattern for decisions the user must explicitly approve.

### `Dropdown`

**Purpose:** Styled anchored menu/popover box. The caller owns open state, outside-click dismissal, and positioning.

**Key props:** normal `div` props plus optional `className`.

**Use it for:** custom positioned pickers and simple popovers that need the standard border, radius, shadow, and z-index.

**Do not use it for:** Radix dropdown menus that already come from `DropdownMenuContent`, or rail action menus where `RailShellActionMenu` is a better fit.

## Action Components

### `Button`

**Purpose:** The one text button primitive.

**Key props:**

| Prop | Values |
|---|---|
| `variant` | `primary`, `secondary`, `ghost`, `danger`, `link` |
| `size` | `sm`, `md`, `lg` |
| `iconLeft`, `iconRight` | Lucide icon component; size is derived from button size. |
| `loading` | Shows spinner and disables the button. |
| `fullWidth` | Stretches to the container. |

**Current look:** `primary` is a light accent-tinted action with a clear accent border, not a dark navy fill. `danger` is the only red filled button.

**Use it for:** visible user actions with text, especially the one primary action on a surface.

**Do not use it for:** icon-only utility actions; use `IconButton`.

### `IconButton`

**Purpose:** Icon-only button with required accessible label.

**Key props:**

| Prop | Values |
|---|---|
| `icon` | Required Lucide icon component. |
| `label` | Required accessible label and title. |
| `variant` | `ghost`, `secondary`, `primary` |
| `size` | `xs` (`20x20`), `sm` (`28x28`), `md` (`32x32`) |
| `iconClassName` | Optional icon class. |

**Use it for:** close, clear, collapse, search-open, refresh, and other familiar utility actions.

**Do not use it for:** risky or primary actions that need words, such as Send, Run, Stop, Mark reviewed, Delete, or Archive.

## Input, Filter, and Choice Components

### `SearchField`

**Purpose:** The one search input.

**Key props:** controlled `value`, `onChange`, `size`, optional `icon`, optional `onClear`, `placeholder`, and input DOM props.

**Sizes:** `sm`, `md`, and `lg`. The `lg` size is the larger composer-style field with accent focus styling.

**Use it for:** surface search, popover search, and composer-like search/input rows.

**Rail search rule:** inside rails, use the `search` prop on `RailShellHeader` so search starts as an icon and expands only when clicked or populated.

### `FilterToggle` and `FilterPanel`

**Purpose:** The shared filter pattern: one compact Filters button plus one expanded filter surface.

**Key props:**

| Component | Props |
|---|---|
| `FilterToggle` | `open`, `onToggle`, optional `count`, `label`, `className`, `data-testid` |
| `FilterPanel` | `children`, optional `className`, `style`, `data-testid` |

**Use it for:** full-surface filters on Activity, Email, Search-like views, and any screen with more than one filter.

**Do not use it for:** always-visible walls of chips. Show the panel only when opened, and show active filter count/chips only when they help.

### `SegmentedToggle`

**Purpose:** Pick-one control for compact modes and view switches.

**Key props:** `options`, `value`, `onChange`, `size`, `variant`, `ariaLabel`, optional `data-testid`.

**Current variants:** `pill` and `filled` are accepted by the API, but current CSS gives both the same bordered-track / accent-active treatment.

**Use it for:** view mode, search mode, scope, and other one-of-a-small-set choices.

**Do not use it for:** multi-select filters; use chips or a filter panel.

### `Chip`

**Purpose:** Interactive filter or selection pill.

**Key props:** `active`, `size`, optional `icon`, button DOM props.

**Sizes:** `sm`, `md`, and `pill`.

**Use it for:** selected scopes, active filters, compact category choices, and "pick this" controls.

**Do not use it for:** read-only status labels; use `Badge`.

## Status, Trust, and Label Components

### `TrustNote`

**Purpose:** Trust ladder rung 2: one short line at the moment of action.

**Key props:**

| Prop | Values |
|---|---|
| `variant` | `default`, `warning`, `blocker` |
| `icon` | Optional icon override. |
| `details` | Longer explanation exposed as the native tooltip. |
| `children` | The short visible sentence. |

**Use it for:** "Review first", "Sends by your email", "Uses your own key", and similar action-adjacent trust lines.

**Do not use it for:** permanent egress status pills or full paragraphs. Egress is single-sourced in the top bar; long details belong in Privacy Center, dialogs, or on-demand disclosures.

### `QuietStatus`

**Purpose:** Normal-good states said quietly.

**Key props:** `state` (`ok`, `pending`, `failure`), optional `icon`, optional `children`.

**Important behavior:** `state="ok"` with no children renders nothing. `failure` uses `role="alert"` and red styling.

**Use it for:** Saved, ready, reviewed, installed, connected, indexing, and other normal status notes.

**Do not use it for:** failures that need a full explanation or recovery path; use `Callout` or a dialog where needed.

### `Badge`

**Purpose:** Non-interactive status or label pill.

**Key props:**

| Prop | Values |
|---|---|
| `variant` | `neutral`, `privilege`, `sample`, `local`, `direct`, `assured`, `success`, `warning`, `danger`, `featured` |
| `size` | `sm`, `md` |
| `icon` | Optional icon. |
| `uppercase` | Uppercase label style. |
| `mono` | Monospace lighter label for model names, matter numbers, or record IDs. |

**Use it for:** read-only labels, trust states, sample data flags, and compact status metadata.

**Do not use it for:** clickable filters or selections; use `Chip`.

### `CountBadge`

**Purpose:** Tiny numeric counter. Current style is an `18x18` navy circle.

**Key props:** `count`, optional `className`.

**Use it for:** active filter count, unread count, selected count, and other compact numeric signals.

**Do not use it for:** counts that do not change the user's next action.

### `CiteChip`

**Purpose:** Inline citation chip that proves where a claim came from.

**Key props:** optional `index`, `children`, required `docLabel`, required `quote`, optional `sourceLabel`, optional `icon`, and `popoverPosition` (`above` or `below`).

**Use it for:** cited answers and reviewable generated text where the exact source line matters.

**Do not use it for:** decorative source badges without a real quote. The `quote` is load-bearing.

### `Eyebrow`

**Purpose:** Uppercase section or column label.

**Key props:** `primary`, `children`, optional `className`, optional `style`.

**Use it for:** compact section labels and table/list group labels.

**Do not use it for:** page titles or card titles.

## Container and Message Components

### `Card`

**Purpose:** The one card container.

**Key props:**

| Prop | Values |
|---|---|
| `variant` | `flat`, `raised`, `interactive` |
| `featured` | Stronger border and subtle tint. |

**Use it for:** repeated items, framed tools, selected/featured choices, and real panels.

**Do not use it for:** wrapping a whole page section, or putting a card inside another card only for decoration.

### `EmptyState`

**Purpose:** One empty/no-results layout: icon, title, body, optional actions.

**Key props:** `icon`, `title`, optional `body`, optional `actions`, `compact`, `iconSize`, `className`, and `data-testid`.

**Use it for:** empty rails, empty result panes, and no-results states.

**Do not use it for:** normal-good states that can disappear. If there is nothing useful to say, show nothing.

### `Callout`

**Purpose:** Framed informational, warning, or error banner.

**Key props:** `variant` (`info`, `warning`, `error`), optional `icon`, optional `onDismiss`, `children`, and `className`.

**Use it for:** real blockers, warnings, errors, and important contextual notes that need a box.

**Do not use it for:** routine privacy reassurance or saved/ready states. Use `TrustNote` or `QuietStatus` instead.

## Known Ambiguity

`SegmentedToggle` still accepts `variant="pill"` and `variant="filled"`, and the TypeScript comment describes different visuals. The current CSS intentionally or accidentally renders them the same. Treat the current visual behavior as source of truth until Fable reviews whether the variants should diverge again.
