# How to rebrand Keepance

This is the plain-language guide to changing the product's name, colors, logo, and
core messaging — across the app, the website, the press kit, and email — from **one
file and one command**. No hunt-and-replace, no touching a hundred files by hand.

If you're handing a new brand to an AI assistant, point it at this file.

---

## The short version

1. **Edit one file:** `brand/brand.config.json`
2. **Drop new images into one folder:** `brand/assets/`
3. **Run one command:** `npm run brand:sync`

That's it for everything a script can safely do. There's a small list of things only
a human can do (own a new domain, rename the payment store) — the command prints
that list for you at the end, and it's also in "The locked layer" below.

---

## 1. The one file: `brand/brand.config.json`

This is the single source of truth for the brand. Open it and change what you want:

- **`name`** — the product name people see (today: "Keepance"). Change this to rename the product.
- **`tagline`, `taglineShort`, `positioning`** — the headline sentences.
- **`descriptions`** — the longer blurbs (app store, website meta).
- **`colors`** — the four brand colors. This is the whole palette:
  - `navy` — the main dark color (text, headings)
  - `accent` — the action blue (buttons, active states)
  - `pink` and `blue` — the two ends of the gradient on the logo/marks
  - Use 6-digit hex, like `#0a2540`. Everything else in the app (every faint
    tint, hover, sidebar shade, shadow) is *derived* from these four, so changing
    one color here updates the whole app consistently.
- **`messaging`** — a few identity strings the app stamps onto things (the author
  name on AI Word edits, the "Prepared with …" line on exported slides, the
  onboarding headline).
- **`urls`** — the website and support email shown to users.

There's a `_readme` note inside most sections explaining what it's for.

## 2. The one folder: `brand/assets/`

Drop replacement images here, keeping the **same file names**:

- `favicon.svg` — the little icon in browser tabs and the app
- `logo.svg` — the full logo (mark + wordmark) used on onboarding
- `wordmark.svg` — just the product name drawn as a shape. **Important:** the
  current logo *draws the word "Keepance" as a shape*, so if you change the
  **name**, you need a new wordmark image here (a designer makes this).
- `icon-source.png` — one square PNG (1024×1024 is ideal). All the app's
  taskbar/installer icon sizes are generated from this.
- `og-image.png` — the preview image when the site is shared on social.

## 3. The one command: `npm run brand:sync`

This reads your config and pushes the values everywhere:

- Regenerates the app's brand file (`src/config/brand.ts`) so all the in-app names
  and taglines update.
- Updates the app's color tokens (in `src/styles/globals.css`) and the website's
  colors (`website/styles/brand.css`).
- Copies your new images to every place they're needed.
- Updates the app's display info (window title, store descriptions, copyright).
- Prints a summary of what changed and a checklist of human-only steps.

**Want to also rename the product across the website and emails?** The product
name appears in lots of plain text on the marketing site and in the email
templates. To swap it there too:

```
npm run brand:sync -- --rename          # shows you exactly what WOULD change (a dry run)
npm run brand:sync -- --rename --apply   # actually makes the change
```

It only swaps the capitalized name as whole words, and it never touches web
addresses or technical identifiers. After a rename, re-read the website hero and
meta copy yourself — swapping the name is automatic, but new *positioning* is a
writing decision, not a find-replace.

**To refresh the app icon sizes** (taskbar/installer): `npm run brand:sync -- --icons`
(this is slower, so it's off by default). The browser-tab icon is an SVG and
updates automatically.

---

## The locked layer — what the system will NOT change (and why)

Some names look like "Keepance" but are actually load-bearing plumbing. If you
change them, existing users break — their app stops auto-updating, their saved
keys and logins vanish, their encrypted data won't open, or their subscription
stops validating. **The sync command never touches these. It only checks that
they're still intact and warns you if something drifted.**

These are listed in the config under `lockedIdentifiers` (for reference, not for
editing):

- The app's identity for the operating system (`com.keepance.app`)
- The auto-update address and its signing key
- The names the app uses to store secrets in your OS keychain (`keepance-*`)
- Where the app saves data on disk (`.keepance/`)
- The license and firm servers (`licenses.keepance.com`, `api.keepance.com`)
- The subscription plan codes (`personal` / `professional` / `practice`)
- The internal engine word `matter` (the user-facing word "client" *is* changeable
  as copy; the internal `matter`/`matter_id` is never renamed)

Changing any of these is a real project with a careful migration so existing
users keep working — it's a founder + engineering decision, not a branding step.

### Human-only steps for a full rebrand

The command reminds you of these at the end:

- **Own the new domain** and set up DNS before pointing anything at it.
- **Rename the payment store** (LemonSqueezy) and update checkout links.
- **Plan a migration release** if you ever do change the locked identifiers above.
- **Get a designer** to redraw the social share images and, for a name change, the
  wordmark.
- **Rewrite the positioning copy** where the new brand says something genuinely new.

---

## How it's wired (for the curious / for engineers)

- **Source of truth:** `brand/brand.config.json` (+ `brand/assets/`, schema in `brand/brand.schema.json`).
- **The sync script:** `scripts/brand-sync.mjs` (run via `npm run brand:sync`). Zero
  required dependencies; image rasterizing uses `sharp` if installed, the Tauri CLI
  for app icons.
- **What it generates** (don't hand-edit these — change the config and re-run):
  - `src/config/brand.ts` — the app's typed `BRAND` object.
  - the `@brand:colors` block inside `src/styles/globals.css` — the app color tokens.
  - `website/styles/brand.css` — the website color variables.
- **Drift guard:** `npm run brand:check` (part of `npm run gate`) fails if the
  generated files no longer match the config, so they can't silently go stale.

### What's fully wired vs. what still has hand-edited copy

Fully config-driven today: all app colors (tokens + the in-component logo),
the app's name in the key spots (About, onboarding headline, the AI-Word author
stamp, the slide watermark), app display metadata, the website's brand colors on
the homepage / nav / press kit, and the website/email name swap via `--rename`.

Still hand-edited (works fine, just not yet pulled through the config — a future
pass): the long tail of in-app copy that mentions the name (mostly workflow
templates and help text), the blog's per-post inline color blocks, the inline-SVG
logo gradient stops on a few web pages (SVG gradient `stop-color` can't read a CSS
variable), the social PNG cards (those are images, so they always need a designer),
and two shadcn tokens — `--color-primary` and `--color-ring` in
`src/styles/globals.css` — which are a near-navy `hsl()` the design system reads as
a literal at build time (so they can't be a CSS variable); on a *colour* rebrand,
update those two lines to the new primary by hand. None of these block a rebrand;
the name swap covers the text, and the colours there are secondary to the four
primitives that drive the rest of the app.
