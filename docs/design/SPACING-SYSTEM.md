# Advisor Prep Hero Spacing & Layout System

> The single source of truth for spacing in the app. Before this existed, spacing was ad-hoc inline pixels (7px, 9px, 11px, 13px, 24px... no rhythm), which is why elements felt cramped and inconsistent. Every spacing value in the UI should now come from a token here, never a raw number.

## Principles

1. **8-point grid, 4px base.** All spacing is a multiple of 4, and layout spacing is a multiple of 8. This is the proven standard (Material, Apple HIG, Carbon, Polaris) — it scales cleanly and keeps a visual rhythm.
2. **Room to breathe.** Advisor Prep Hero leans *generous*. Pages get a 32px gutter, content sits a full 24px off its header, cards have comfortable internal padding. When unsure, go one step larger.
3. **Internal ≤ external.** The space *inside* a container is less than or equal to the space *around* it. A card never welds to the line above it; related things sit closer than unrelated things. (This is the rule the old Matters empty-state broke — the card had 0px above it but plenty inside.)
4. **Tokens, not numbers.** Components reference semantic tokens (`var(--kp-gutter)`), so the whole app's rhythm can be tuned from one file (`src/styles/globals.css`).

## The scale (tokens in `src/styles/globals.css` `@theme`)

| Token | Value | Use |
|---|---|---|
| `--kp-space-2xs` | 4px | hairline gaps, icon-to-text |
| `--kp-space-xs` | 8px | tight inline gap |
| `--kp-space-sm` | 12px | small gap |
| `--kp-space-md` | 16px | default gap / compact padding |
| `--kp-space-lg` | 24px | comfortable padding / content gap |
| `--kp-space-xl` | 32px | generous padding / page gutter |
| `--kp-space-2xl` | 48px | large section break |
| `--kp-space-3xl` | 64px | hero / empty-state |
| `--kp-space-4xl` | 80px | extra-large |

## Semantic tokens (use these in layout — they encode the rules)

| Token | Resolves to | Meaning |
|---|---|---|
| `--kp-gutter` | 32px | left/right padding of every full-page surface |
| `--kp-surface-header-pad` | 24px 32px 16px | the `[icon] Title + description` header block |
| `--kp-surface-gap` | 24px | space between a surface's header divider and its content (**never 0**) |
| `--kp-card-pad` | 24px | padding inside cards / panels |
| `--kp-section-gap` | 32px | vertical space between major sections |
| `--kp-stack-gap` | 16px | vertical space between stacked, related items |

## The standard full-page surface layout

Every surface (Matters, Search, Documents, Email, Workflows, Activity Log, Settings) should follow this skeleton, so switching tabs feels identical:

```
<surface root: column, fills height, scrolls>
  <header: padding var(--kp-surface-header-pad); border-bottom hairline>
     <SurfaceHeader icon + title + description + actions />
  </header>
  <content: starts var(--kp-surface-gap) below the divider; horizontal padding var(--kp-gutter)>
     ...cards/tables/panels, each with var(--kp-card-pad) inside, var(--kp-section-gap) between...
  </content>
```

Cards use `var(--kp-card-pad)` inside and sit `var(--kp-gutter)` from the page edge and `var(--kp-surface-gap)`/`var(--kp-section-gap)` from each other.

## Rollout status

- ✅ **Tokens defined** (`globals.css`).
- ✅ **All surfaces migrated** to the tokens: Matters (reference), Search, Documents (+ grid/tree), Email, Workflows, Activity Log, Settings, and the MatterHub. Each uses `--kp-surface-header-pad` for its header, `--kp-gutter` (32px) for horizontal padding, `--kp-surface-gap` (24px) below the header divider, and `--kp-card-pad` inside cards. Stray raw-px layout values were replaced with the nearest scale token; load-bearing control internals (pill/button padding, icon gaps) were left as-is on purpose.
- ⬜ **Future:** the navy left rail and the trust bar are intentionally denser and were left out of this pass; revisit if they should pick up the scale too.

## Type rhythm (companion rule)

Line-heights should be multiples of 4 (20/24/28/32px) so text aligns to the same grid. Titles are 22px/700, descriptions 13px muted (already standardized via `SurfaceHeader`).

## Sources / references
- [The 8-Point Grid System in UI Design (WP Dean)](https://wpdean.com/what-is-the-8-point-grid-system/)
- [Spacing best practices — 8pt grid, internal ≤ external (Cieden)](https://cieden.com/book/sub-atomic/spacing/spacing-best-practices)
- [Spacing systems & scales in UI design (Designary)](https://blog.designary.com/p/spacing-systems-and-scales-ui-design)
- [Spacing — Carbon Design System (IBM)](https://carbondesignsystem.com/elements/spacing/overview/)
- [Spacing, grids, and layouts (DesignSystems.com)](https://www.designsystems.com/space-grids-and-layouts/)
