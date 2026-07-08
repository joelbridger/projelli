# Brand Swap Guide

This folder is the source of truth for the product identity.

## What to edit

1. Update `brand/brand.config.json`.
   - `name`, `nameShort`, `legalName`, and `possessive` control the visible product name.
   - `messaging.redlineAuthor` controls the author name used in Word redlines.
   - `messaging.exportWatermark` controls exported document watermark text.
   - `colors` control the app and website brand colors through generated tokens.
2. Replace source logo files in `brand/assets/`.
   - `logo.svg` is the full-color logo.
   - `logo-white.svg` is the light-on-dark logo.
   - `favicon.svg` is the browser icon source.
   - `icon-source.png` is the app icon source.
   - `og-image.png` is the social preview image.
3. Run `npm run brand:sync`.
4. Run `npm run brand:check`.

## App text

Visible app text should not hard-code the product name. Use these placeholders in
`src/locales/*.json`:

- `{{productName}}`
- `{{productNameShort}}`
- `{{productNamePossessive}}`
- `{{productAiName}}`
- `{{localAiName}}`

The placeholders are filled from `BRAND` in `src/i18n.ts`, so a future name swap is
one config edit plus `npm run brand:sync`.

## Static prose

For website, README, and marketing prose that still contains the old display name,
use:

```bash
node scripts/brand-sync.mjs --rename
node scripts/brand-sync.mjs --rename --apply
```

The first command previews the rename. The second applies it.

## Do not change

Do not edit `lockedIdentifiers` during a normal brand swap. Those values are the
behind-the-scenes plumbing for updates, saved keys, app data, license checks, and
firm services. Changing them needs a migration plan, not a normal rebrand.
