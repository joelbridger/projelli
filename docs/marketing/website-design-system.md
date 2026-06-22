# Keepance Website Design System (tokens + rules)

**Status:** Canonical for the marketing site (`website/`) as of 2026-06-22.
**Scope:** the static marketing pages. (The desktop app has its own design system; see `~/.claude/.../reference_keepance_design_system.md`.)

> Each marketing page currently inlines its own `:root` token block inside a `<style>` tag. Until we extract a shared stylesheet, **keep these values identical on every page.** When you build or edit a page, copy the palette below verbatim.

## Color tokens (`:root`)

| Token | Value | Use |
|---|---|---|
| `--obsidian` | `#1A1C20` | footer / deepest background |
| `--navy` | `#0A2540` | hero + dark sections + nav |
| `--grad-pink` | `#FF3CE8` | gradient start, accents, labels |
| `--grad-blue` | `#5DC6FF` | gradient end, accents, links on dark |
| `--bone` | `#F5F5F0` | page background (light) |
| `--bone-dark` | `#EEEEE8` | subtle light panels |
| `--white` | `#FFFFFF` | cards, pure white |
| `--text-on-dark` | `#E8E8E2` | **readable body/lead text on dark** (near-white) |
| `--text-muted-dark` | `#B6C4D6` | **muted/secondary text on dark** (corrected 2026-06-22) |
| `--text-heading` | `#0A2540` | headings on light |
| `--text-body` | `#3A3A38` | body text on light |
| `--text-muted` | `#6B6B65` | muted text on light |
| `--border` | `#E0E0D8` | hairlines on light |

## The contrast rule (this is the one that bit us)

**No faint secondary text, on any background.** Across the site, low-contrast text was the readability problem (there is no "light" font weight anywhere; all text is already regular/400, so the issue was always COLOR, not weight). Banned faint values and their corrections (applied site-wide 2026-06-22):

Muted text on DARK (navy) backgrounds:
- ❌ `--text-muted-dark: #8A9BB0` / `rgba(255,255,255,0.5)` (too faint)
- ✅ `--text-muted-dark: #B6C4D6` (~8:1 on navy)
- Faint white text on dark was raised: any `color: rgba(255,255,255, <0.5)` is banned; floor is ~0.5, secondary text sits ~0.6 to 0.75.

Muted text on LIGHT (bone/white) backgrounds:
- ❌ `--text-muted: #94A3B8` (the old default on most pages, far too light) / `#64748B` / `#6B6B65`
- ✅ `--text-muted: #475569` (slate-palette pages) or `#555550` (warm-palette pages) — both ~7:1+ on bone. (These two should be unified when pages are rebuilt.)

Rules going forward:
1. **Muted/secondary text must clear ~7:1 contrast on its background.** On dark use `--text-muted-dark` (`#B6C4D6`) or brighter; on light use `--text-muted` at `#475569`/`#555550` or darker. Never reintroduce `#94A3B8`, `#8A9BB0`, or `color: rgba(255,255,255, <0.5)` for text.
2. **The hero subhead / tagline** uses **`--text-on-dark` (near-white) at `font-weight: 400`**, not the muted token: `.hero-sub { color: var(--text-on-dark); font-weight: 400; }`.
3. **Regular (400) is the minimum font weight** for body and lead copy. There is no "light"/thin weight in the type system; never add one. Use 500 for small UI labels if more presence is needed.

## Hero conventions

- H1 uses `.hero h1 em` for the gradient highlight phrase. **`font-style: normal`** (the highlight is color, not italic).
- Force intentional line breaks in the H1 with `<br>` where the wording reads better stacked (e.g. `Private <em>client intelligence</em> for<br>high-trust work.`).
- Hero supporting image uses the `.hero-video` class (rounded corners, hairline border, soft shadow). It can be an `<img>` or `<video>`; keep the class for consistent framing.

## When you touch a page

- Copy the token table above into its `:root` exactly. Do not invent new shades for "muted on dark."
- Run a quick check: `grep -o "\-\-text-muted-dark:[^;]*"` on the file should return `#B6C4D6`.
- Voice rules still apply to all copy (no em dashes, no AI tells, never claim "compliant"). See `MARKETING_VISION.md`.
