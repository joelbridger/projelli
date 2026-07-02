# Lantern (Advisor Prep Hero) — Design Tokens & Component Reference

Extracted **verbatim from the code** on branch `lantern-plus` so a prototype builder can
produce HTML visually indistinguishable from the real product. **Light theme** is the
product default and is documented specifically below.

## Critical architecture facts

- **There is NO `tailwind.config.*`.** This app runs **Tailwind CSS v4**
  (`@tailwindcss/postcss ^4.1.18`, `postcss.config.js:3`). The **entire theme is defined in
  CSS** via the `@theme { }` block in **`src/styles/globals.css`** (single source of truth,
  ~531 lines). `@source "../**/*.{ts,tsx}"` (globals.css:3) replaces the v3 `content` array.
  (The repo `CLAUDE.md` says "Tailwind CSS 3" — that is stale.)
- **Two parallel design systems coexist:**
  1. **shadcn/ui primitives** in `src/ui/*.tsx` — Tailwind utility classes bound to `--color-*`
     semantic tokens (`bg-primary`, `border-input`, …).
  2. **The "kp" system** in `src/ui/kp/*.tsx` — thin React wrappers emitting plain class names
     (`kp-btn`, `kp-card`, `kp-chip`…) whose CSS lives in `@layer components` in `globals.css`
     (lines ~230–492), driven by `--kp-*` tokens. **This is the newer/primary system** used by
     feature surfaces. When in doubt, match the **kp** look.
- **Fonts are self-hosted, offline** (no Google Fonts link). UI font = **Satoshi**.

---

## 1. Color palette

### 1a. Brand palette (`--kp-*`) — the real accents (globals.css:63–71)

Palette family "2b2d42 / ef233c / 8d99ae" (Space-Cadet / Imperial-Red / Cool-Gray).

| Token | Hex | Role |
|---|---|---|
| `--kp-navy` | **`#2b2d42`** | Primary **text & icon** color across kp surfaces (RGB 43,45,66) |
| `--kp-pink` | `#ef233c` | brand red |
| `--kp-blue` | `#8d99ae` | cool gray-blue |
| `--kp-accent` | **`#ef233c`** | **THE brand accent** — a warm red/crimson (active states, primary buttons, focus) |
| `--kp-grad` | `linear-gradient(135deg, #ef233c, #8d99ae)` | brand gradient |

> The onboarding welcome (shot 01) uses a *separate* decorative blue→purple→pink glow
> (`GradientGlow.tsx:19`, Tailwind `from-blue-500/[0.06] via-purple-500/[0.06] to-pink-500/[0.06] blur-[100px]`),
> not the `--kp-grad` red→gray. In-app chrome uses the red/navy palette, not the glow.

### 1b. The "ACTION" treatment — how primary emphasis is drawn (globals.css:47–54)

**No dark navy fills for primary buttons / active pills.** Instead: **light red-tint fill +
navy text + a red accent border.** This is the single most distinctive visual rule.

| Token | Value | Use |
|---|---|---|
| `--kp-action-bg` | `rgba(239,35,60,0.14)` | primary-button / active-pill fill |
| `--kp-action-bg-hover` | `rgba(239,35,60,0.22)` | hover |
| `--kp-action-bg-active` | `rgba(239,35,60,0.30)` | pressed |
| `--kp-action-fg` | `#2b2d42` (navy) | label color |
| `--kp-action-border` | `#ef233c` | 1px accent border |
| `--kp-accent-soft` | `rgba(239,35,60,0.11)` | selected-pill / sidebar-active tint |
| `--kp-accent-softer` | `rgba(239,35,60,0.06)` | hover row |

### 1c. shadcn semantic tokens — LIGHT theme (`:root`/`@theme`, globals.css:13–32)

Values are `hsl()` in code; hex conversions given.

| Token | hsl | Hex | Note |
|---|---|---|---|
| `--color-background` | `0 0% 100%` | `#FFFFFF` | page bg |
| `--color-foreground` | `222.2 84% 4.9%` | `#020817` | near-black text |
| `--color-card` | `0 0% 100%` | `#FFFFFF` | |
| `--color-primary` | `210 73% 15%` | **`#0A2540`** | "Brand Navy" — shadcn primary (note: ≠ `--kp-navy` #2b2d42) |
| `--color-primary-foreground` | `0 0% 100%` | `#FFFFFF` | |
| `--color-secondary` / `--color-muted` / `--color-accent` | `210 40% 96.1%` | `#F1F5F9` | pale gray fills/hover |
| `--color-muted-foreground` | `215.4 16.3% 44%` | `≈#5E6D82` | secondary text (darker than stock shadcn) |
| `--color-destructive` | `0 84.2% 48%` | `≈#E11212` | |
| `--color-border` / `--color-input` | `214.3 31.8% 60%` | **`≈#7994B9`** | **strong** mid blue-gray (NOT a 91%-L hairline) — shadcn borders are noticeably visible |
| `--color-ring` | `210 73% 15%` | `#0A2540` | focus ring (navy) |

> Two "navy"s exist: shadcn `--color-primary` **#0A2540** vs brand `--kp-navy` **#2b2d42**.
> kp text/icons use #2b2d42; shadcn `bg-primary` fills use #0A2540. Prefer **#2b2d42** for
> body text to match the primary (kp) surfaces.

### 1d. Sidebar (globals.css:76–85)

`--kp-side-bg: #f3f6fb` · `--kp-side-fg: #2b2d42` · `--kp-side-active-bg: rgba(239,35,60,0.11)`
· `--kp-side-accent: #ef233c`. (Matches the pink-tinted active nav item in shots 03/04.)

### 1e. Status / confidentiality palette (globals.css:86–91)

| State | fg | bg | line |
|---|---|---|---|
| local | `#16654a` | `#e6f0ea` | `#8fbca6` |
| direct (BYOK) | `#8a5410` | `#f6ecd6` | `#d0ad6c` |
| assured | `#1b5e86` | `#e1eef6` | `#8fbedb` |
| danger | `#b02a1f` | `#f6e2df` | — |
| success | `#059669` | `#e6f5ee` | `#8fc9b0` |
| warning | `#b45309` | `#fbf0e2` | `#e3bf8a` |

Soft panel tint: `--kp-bg-soft: #f3f6fb`. Hairlines: `--kp-divider: rgba(43,45,66,0.10)`,
`--kp-divider-strong: rgba(43,45,66,0.16)`. Text dims: `--kp-text-faint/dim: rgba(43,45,66,0.70)`.

### 1f. `.dark` (globals.css:495–531, brief)

bg `#020817`, fg `#F8FAFC`, borders/muted `≈#1E293B`. Primary stays `#0A2540`. Notably
`--kp-accent` flips from **red → `--kp-blue` #8d99ae** in dark, and action tints derive from
blue. (Not the product default — light is.)

---

## 2. Typography

- **Font stack** (globals.css:57–58):
  `--font-sans: 'Satoshi', system-ui, -apple-system, 'Segoe UI', sans-serif;`
  `--font-mono: ui-monospace, 'SF Mono', 'Fira Code', monospace;`
- **Satoshi** self-hosted via `@font-face` (globals.css:6–9) from `/fonts/satoshi/satoshi-{400,500,700,900}.woff2`. Applied to `body` (globals.css:199) with `font-feature-settings: "rlig" 1, "calt" 1`. (A **Sora** family is on disk but **not referenced** — do not use it.)

**Font-size scale** (px, globals.css:117–124):

| Token | px | Role |
|---|---|---|
| `--kp-font-2xs` | 11 | eyebrow / badge |
| `--kp-font-xs` | 12 | caption |
| `--kp-font-sm` | 13 | label |
| `--kp-font-md` | 14 | **body / default UI** |
| `--kp-font-lg` | 16 | subheading |
| `--kp-font-xl` | 18 | heading |
| `--kp-font-2xl` | 22 | **surface title** |
| `--kp-font-3xl` | 28 | display |

**Weights** (globals.css:125–128): 400 / 500 / 600 / 700 (`--kp-weight-regular/medium/semibold/bold`).
**Line-heights** (129–132): tight 1.2 · snug 1.35 · normal 1.45 · relaxed 1.6.
**Eyebrow tracking**: `--kp-tracking-eyebrow: 0.07em` (uppercase labels).
**Semantic roles** (114–116): title = 2xl/bold · heading = xl/semibold · subheading = lg/semibold
· body = md/regular · label = sm/medium · caption = xs/regular · eyebrow = 2xs/semibold-uppercase.

shadcn primitives use Tailwind v4 defaults: `CardTitle` = `text-2xl`, `DialogTitle` = `text-lg`.

---

## 3. Spacing, radii, shadows, sizing, motion

**Spacing — 8pt grid** (globals.css:94–102):
`--kp-space-2xs:4 · xs:8 · sm:12 · md:16 · lg:24 · xl:32 · 2xl:48 · 3xl:64 · 4xl:80` (px).
**Layout** (106–111): `--kp-gutter:32px` · `--kp-surface-header-pad: 24px 32px 16px` ·
`--kp-surface-gap:24px` · `--kp-card-pad:24px` · `--kp-section-gap:32px` · `--kp-stack-gap:16px`.

**Radii** (globals.css:171–175): `--radius: 0.5rem` (8px base) · `--radius-sm` = 4px ·
`--radius-md` = 6px · `--radius-lg` = 8px. **Chips/pills = `border-radius: 999px`** (globals.css:404).
CountBadge = `50%` circle. Cards = `--radius-lg` (8px). Buttons = `--radius-md` (6px).

**Shadows — navy-tinted elevation** (globals.css:136–139):
- `--kp-shadow-1: 0 1px 2px rgba(43,45,66,0.06), 0 1px 3px rgba(43,45,66,0.04)` — resting cards
- `--kp-shadow-2: 0 4px 12px rgba(43,45,66,0.08), 0 2px 4px rgba(43,45,66,0.05)` — popovers/dropdowns
- `--kp-shadow-3: 0 16px 40px rgba(43,45,66,0.16), 0 4px 12px rgba(43,45,66,0.08)` — modals

**Sizing** (141–145): icons `--kp-icon-2xs:10 · xs:12 · sm:14 · md:16 · lg:18 · xl:22 · 2xl:32`;
control heights `--kp-control-sm:28 · md:32 · lg:40`; icon stroke **1.75** (decorative 1.5).
**Borders**: `--kp-border-width:1px`, `--kp-border-width-strong:1.5px`.
**Opacity**: disabled 0.45, muted 0.65.

**Motion** (148–153): fast 120ms / base 200ms / slow 320ms; ease-standard `cubic-bezier(0.2,0,0,1)`.
**Z-index** (156–162): sticky 10 · dropdown 100 · overlay 1000 · modal 1100 · popover 1200 · toast 1300 · tooltip 1400.
**Overlay scrim**: `rgba(43,45,66,0.18)` (kp) / `rgba(10,37,64,0.18)` (shadcn Dialog overlay).
**Focus**: global `:focus-visible` = `outline: 2px solid var(--kp-accent); outline-offset: 2px`;
kp focus ring token `--kp-focus-ring: 0 0 0 2px var(--color-background), 0 0 0 4px var(--kp-navy)`.

---

## 4. Component recipes

### Button — kp (primary system) · `src/ui/kp/Button.tsx`, CSS `globals.css:232–261`
Class: `kp-btn kp-btn--{variant} kp-btn--{size}`. Default `variant=primary`, `size=md`.
Base: `inline-flex; center; font-family:var(--font-sans); font-weight:600; border-radius:6px; border:1px solid transparent; transition 120ms`.
- Sizes: **sm** h28 / pad 0 10px / 12px · **md** h32 / 0 14px / 13px · **lg** h40 / 0 18px / 14px.
- **primary**: `background:rgba(239,35,60,0.14); color:#2b2d42; border-color:#ef233c` → hover .22 / active .30
- **secondary**: `background:#FFF; color:#2b2d42; border-color:#7994B9` → hover `rgba(43,45,66,0.05)`
- **ghost**: `transparent; color:var(--color-muted-foreground); border:transparent` → hover navy text + `rgba(43,45,66,0.05)`
- **danger**: `background:#b02a1f; color:#fff` → hover brightness(1.08)
- **link**: navy underline, no padding. `--full` = width:100%. disabled opacity 0.45.

### Button — shadcn · `src/ui/button.tsx:7–34` (`cva`)
Base: `inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50`.
Variants: default `bg-primary text-primary-foreground hover:bg-primary/90` · outline `border border-input bg-background hover:bg-accent hover:text-accent-foreground` · secondary `bg-secondary … hover:bg-secondary/80` · ghost `hover:bg-accent hover:text-accent-foreground` · link `text-primary underline-offset-4 hover:underline`.
Sizes: default `h-10 px-4 py-2` · sm `h-9 rounded-md px-3` · lg `h-11 rounded-md px-8` · icon `h-10 w-10`.

### Card — kp · `src/ui/kp/Card.tsx`, CSS `globals.css:425–434`
Class: `kp-card kp-card--{variant}` (default `raised`). `.kp-card`: `border:1px solid var(--color-border); border-radius:8px; background:#FFF`.
- `--raised`: `box-shadow:var(--kp-shadow-1); padding:24px`
- `--interactive`: shadow-1, padding `12px 16px`, pointer; hover → shadow-2 + border `rgba(43,45,66,0.2)`
- `--featured`: `border-color:#2b2d42; border-width:1.5px; background:rgba(43,45,66,0.03)`
- `--flat`: no shadow.

### Card — shadcn · `src/ui/card.tsx`
Root (:11) `rounded-lg border bg-card text-card-foreground shadow-sm` · CardHeader `flex flex-col space-y-1.5 p-6` · CardTitle `text-2xl font-semibold leading-none tracking-tight` · CardDescription `text-sm text-muted-foreground` · CardContent `p-6 pt-0` · CardFooter `flex items-center p-6 pt-0`.

### Chip / pill — `src/ui/kp/Chip.tsx`, CSS `globals.css:402–415`
Class: `kp-chip kp-chip--{size}` [+`is-active`] (default `sm`). `.kp-chip`: `border-radius:999px; border:1px solid var(--color-border); background:#FFF; color:var(--color-muted-foreground); font-weight:500; cursor:pointer`.
- `--sm` pad `3px 10px`/11px · `--md` pad `5px 13px`/12px
- hover: border `rgba(43,45,66,0.3)`, color navy
- **`.is-active`**: `background:rgba(239,35,60,0.14); color:#2b2d42; border-color:#ef233c; font-weight:600` (the red-tint action look — see Ask scope pills, shot 13).

### Badge — `src/ui/kp/Badge.tsx`, CSS `globals.css:380–399`
Class: `kp-badge kp-badge--{variant} kp-badge--{size}` (default `neutral`/`sm`). `.kp-badge`: `inline-flex; border:1px solid transparent; border-radius:4px; font-weight:600; letter-spacing:0.03em; line-height:1.4`.
- `--sm` `2px 8px`/11px · `--md` `3px 10px`/12px
- `--neutral`: bg `rgba(43,45,66,0.07)`, color `#2b2d42`, border `rgba(43,45,66,0.18)`
- `--success` (the green "Sample" badge): bg `#e6f5ee`, color `#059669`, border `#8fc9b0`
- `--featured`: action tint (bg `rgba(239,35,60,0.14)`, navy text, red border).

### CountBadge — `src/ui/kp/CountBadge.tsx`, CSS `globals.css:373–377`
`.kp-count-badge`: 18×18px circle, `background:#2b2d42; color:#fff; font-size:11px; font-weight:700; border-radius:50%`.

### Eyebrow — `src/ui/kp/Eyebrow.tsx`, CSS `globals.css:418–422`
`.kp-eyebrow`: 11px / weight 600 / `letter-spacing:0.07em; text-transform:uppercase; color:var(--color-muted-foreground)`. `--primary` → navy. (The red "RUN WORKFLOW" eyebrow in shot 15.)

### Dialog — `src/ui/dialog.tsx`
- Overlay (:22): `fixed inset-0 z-[var(--kp-z-overlay)] bg-[rgba(10,37,64,0.18)]` + fade animations.
- Content (:39): `fixed left-[50%] top-[50%] z-[var(--kp-z-modal)] grid w-full max-w-lg -translate-x/y-1/2 gap-4 border bg-background p-6 shadow-[var(--kp-shadow-3)] rounded-[var(--radius-lg)]` + zoom-in-95.
- **DialogHeader** (:59): `flex flex-col space-y-1.5 text-center sm:text-left`.
- DialogFooter (:73): `flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2`.
- DialogTitle (:88): `text-lg font-semibold leading-none tracking-tight`. DialogDescription (:103): `text-sm text-muted-foreground`.
- Close (×) (:45): `absolute right-4 top-4 rounded-sm opacity-70 hover:opacity-100 focus:ring-2 focus:ring-ring`.

### Input / Textarea — `src/ui/input.tsx:14` / `src/ui/textarea.tsx:12`
Input: `flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50`.
Textarea: same, `min-h-[80px]`.

### Other kp components (in `@layer components`, `globals.css`)
IconButton (:264–280) · SearchField incl. a **large 50px composer variant** used by Ask (:283–309)
· SegmentedToggle (:314–334, the Keyword/AI-search + scope pattern) · SurfaceToolbar (:338–345)
· FilterBar (:348–370) · EmptyState (:437–445) · Callout (:448–456) · Dropdown (:464–469)
· SlidePanel right-edge drawer (:471–491).

### Exports
- `src/ui/kp/index.ts`: Button, IconButton, SearchField, SegmentedToggle, FilterToggle/FilterPanel, Badge, Chip, CountBadge, Eyebrow, Card, EmptyState, Callout, Dropdown, SlidePanel, SurfaceToolbar/ToolbarSpacer (+ types).
- `src/ui/index.ts`: shadcn primitives — Accordion*, Button/buttonVariants, Input, Dialog*, Card*, DropdownMenu*.

---

## 5. Verbatim JSX snippets (representative components)

**1. Card (kp)** — `src/features/matters/GuidedInterview.tsx:35–41`
```jsx
<Card variant="raised">
  <Eyebrow>{LABEL_ALL_CAUGHT_UP}</Eyebrow>
  <p>{LABEL_NO_QUESTIONS}</p>
  <Button variant="secondary" size="sm" onClick={onClose}>
    {LABEL_CLOSE}
  </Button>
</Card>
```

**2. Chip / scope pill** — `src/features/ask/ScopeToggle.tsx:50–61`
```jsx
<Chip
  key={opt.value}
  size="md"
  active={isActive}
  data-testid={`scope-option-${opt.value}`}
  onClick={() => { onChange(opt.value); }}
  // Demo-Ask pill sizing: larger + more spaced.
  style={{
    padding: '8px 16px',
    fontSize: '13.5px',
    fontWeight: 600,
    borderWidth: '1.5px',
```

**3. Primary button** — `src/features/documents/DocumentGridView.tsx:327`
```jsx
<Button variant="primary" size="md" iconLeft={Plus} onClick={onCreateDocument}>
```

**4. Dialog header** — `src/features/settings/ApiKeyManager.tsx:246–253`
```jsx
<DialogHeader className="shrink-0">
  <DialogTitle>Manage AI Account Keys</DialogTitle>
  <DialogDescription>
    The provider keys saved on this computer. Remove one any time, or add another.
  </DialogDescription>
</DialogHeader>
```

**5. Surface header (app-wide page title, inline-styled with tokens)** — `src/ui/SurfaceHeader.tsx:46–61`
```jsx
<Icon
  style={{ width: 'var(--kp-icon-lg)', height: 'var(--kp-icon-lg)', color: iconColor, strokeWidth: 'var(--kp-icon-stroke)', flex: 'none' }}
/>
<h1
  style={{
    margin: 0,
    fontSize: 'var(--kp-font-2xl)',
    fontWeight: 'var(--kp-weight-bold)',
    color: 'var(--kp-navy)',
    letterSpacing: '-0.01em',
    lineHeight: 'var(--kp-leading-tight)',
  }}
>
  {title}
</h1>
```

---

## 6. Everyday palette conventions (grep frequency across `src/**/*.tsx`)

Most-used classes: `text-muted-foreground` (560) ≫ `bg-muted` (186) > `text-slate-700` (100)
≈ `text-foreground` (100) > `border-border` (95) > `bg-background` (85) > `bg-white` (77) >
`text-slate-500` (69) > `bg-primary` (67) > `text-primary` (60) > `text-slate-900` (57) >
`bg-slate-50` (55) > `text-slate-600` (52) > `text-white` (38) > `text-slate-400`/`bg-slate-100` (31).

**Takeaway for the prototype:** white / `bg-background` surfaces; **`#020817` (or navy #2b2d42)
headings**; **`≈#5E6D82` (`text-muted-foreground`) secondary text**; raw Tailwind **`slate-*`**
grays used heavily alongside semantic tokens; `bg-muted`/`bg-slate-50` for tinted panels;
**brand red `#ef233c` reserved for accents + active/selected states**; navy `#2b2d42` for primary
text/icons. shadcn primitive borders (`#7994B9`) are stronger/more visible than a typical shadcn
app; kp components use the softer `--kp-divider` (navy @ 10%) for hairlines.

## 7. Five visual-language rules a prototype builder MUST respect

1. **Emphasis = red-tint fill + navy text + red border, NOT solid fills.** Primary buttons and
   active pills use `rgba(239,35,60,0.14)` bg / `#2b2d42` text / `#ef233c` 1px border. Never a
   solid red or navy button for a primary action in kp surfaces.
2. **Two navies, one accent.** Text/icons = `#2b2d42`; the single accent = red `#ef233c`
   (active/selected/focus only). Use red sparingly — it marks state, not decoration.
3. **Satoshi, 14px body, 22px/bold surface titles, uppercase 11px eyebrows** (0.07em tracking).
   Titles use `letter-spacing:-0.01em`. Match the type scale exactly.
4. **Pills are fully round (999px); cards/inputs/buttons are 6–8px.** Cards carry the soft
   navy-tinted `--kp-shadow-1`; modals use `--kp-shadow-3` over an `rgba(43,45,66,0.18)`
   navy scrim. Everything sits on 8pt spacing with a 32px surface gutter.
5. **The trust chrome is always present and quiet.** A persistent egress strip (scope label +
   info/Data-Map/Privacy icons) sits under the top banner; status/confidentiality colors come
   from a fixed palette (green local, amber direct, blue assured). Green "Sample" success badges,
   plain-English trust copy, and "cited sources" chips are core to the brand — reproduce them.
