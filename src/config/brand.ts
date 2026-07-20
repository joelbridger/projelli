/**
 * brand.ts — the app's typed view of the brand.
 *
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║  GENERATED FILE — do not edit by hand.                                ║
 * ║  Source of truth:  brand/brand.config.json                           ║
 * ║  Regenerate with:  npm run brand:sync   (verify with brand:check)    ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 *
 * Every user-facing place the app names itself, states its tagline, or paints a
 * brand colour reads from `BRAND` here — so a rebrand is one edit to the config
 * plus one command, never a hunt-and-replace.
 *
 * Intentionally absent: the LOAD-BEARING identifiers (bundle id, keychain
 * service names, update/license URLs, tier codes, storage-key prefix). Those
 * live in brand/brand.config.json → lockedIdentifiers and must never be rebranded
 * automatically — changing one breaks updates, saved keys, or payments for
 * existing users. They stay as literal constants where they're used.
 */

export const BRAND = {
  "name": "Advisor Prep Hero",
  "nameShort": "Advisor Prep Hero",
  "legalName": "Advisor Prep Hero",
  "possessive": "Advisor Prep Hero's",
  "tagline": "The private intelligence layer for a financial advisory practice.",
  "taglineShort": "Local-first workspace for confidential client work.",
  "positioning": "the private place your whole practice lives, and it answers you back",
  "descriptions": {
    "store": "Advisor Prep Hero is a local-first AI workspace for financial advisors who handle confidential client work. Your files stay on your machine. Bring your own API key or run AI models locally with Ollama. Supports RIAs, advisors, CPAs, and consultants where client confidentiality is non-negotiable.",
    "shortStore": "Local-first AI workspace for confidential client work",
    "meta": "Find anything you have ever emailed or filed, with cited answers. Redline in real Word. Your client files never leave your machine. Built for financial advisors and RIAs."
  },
  "colors": {
    "navy": "#2b2d42",
    "pink": "#ef233c",
    "blue": "#8d99ae",
    "accent": "#ef233c"
  },
  "assets": {
    "favicon": "/favicon.svg",
    "logo": "/logo.svg",
    "logoDark": "/logo-dark.svg",
    "logoWhite": "/logo-white.svg"
  },
  "messaging": {
    "onboardingHeadline": "Your private intelligence layer",
    "redlineAuthor": "Advisor Prep Hero AI",
    "exportWatermark": "Prepared with Advisor Prep Hero"
  },
  "urls": {
    "domain": "advisorprephero.com",
    "site": "https://advisorprephero.com",
    "repository": "https://github.com/advisor-prep-hero/advisor-prep-hero",
    "docsBase": "https://advisorprephero.com/docs",
    "supportEmail": "support@advisorprephero.com",
    "developersEmail": "developers@advisorprephero.com",
    "pricing": "https://advisorprephero.com/#pricing",
    "licenseUrl": "https://advisorprephero.com/#pricing",
    "supportUrl": "https://advisorprephero.com/support/",
    "download": "https://advisorprephero.com/download/",
    "privacy": "https://advisorprephero.com/legal/privacy/",
    "terms": "https://advisorprephero.com/legal/terms/",
    "gettingStarted": "https://advisorprephero.com/docs/getting-started",
    "mobileDocsBase": "https://advisorprephero.com/docs/mobile-access",
    "voices": "https://advisorprephero.com/voices",
    "formsBugReport": "https://forms.lanternplatform.app/api/forms/lantern/bug-report",
    "formsAiSetupHelp": "https://forms.lanternplatform.app/api/forms/lantern/ai-setup-help",
    "formsTelemetry": "https://forms.lanternplatform.app/api/forms/lantern/app-event",
    "formsDiagnostics": "https://forms.lanternplatform.app/api/forms/lantern/design-partner-event",
    "licenseApi": "https://licenses.lanternplatform.app",
    "firmApi": "https://api.lanternplatform.app"
  }
} as const;

export type Brand = typeof BRAND;

/** The four primitive brand colours, as a convenience for inline SVG fills etc. */
export const BRAND_COLORS = BRAND.colors;
