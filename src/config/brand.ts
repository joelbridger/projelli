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
  "name": "Keepance",
  "nameShort": "Keepance",
  "legalName": "Keepance",
  "possessive": "Keepance's",
  "tagline": "The private intelligence layer for a financial advisory practice.",
  "taglineShort": "Local-first workspace for confidential client work.",
  "positioning": "the private place your whole practice lives, and it answers you back",
  "descriptions": {
    "store": "Keepance is a local-first AI workspace for professionals who handle confidential client work. Your files stay on your machine. Bring your own API key or run AI models locally with Ollama. Supports attorneys, CPAs, consultants, and other professionals where client confidentiality is non-negotiable.",
    "shortStore": "Local-first AI workspace for confidential client work",
    "meta": "Find anything you have ever emailed or filed, with cited answers. Redline in real Word. Your client files never leave your machine. Built for financial advisors and RIAs."
  },
  "colors": {
    "navy": "#0a2540",
    "pink": "#ff3ce8",
    "blue": "#5dc6ff",
    "accent": "#1f74c4"
  },
  "messaging": {
    "onboardingHeadline": "Your private intelligence layer",
    "redlineAuthor": "Keepance AI",
    "exportWatermark": "Prepared with Keepance"
  },
  "urls": {
    "site": "https://keepance.com",
    "docsBase": "https://keepance.com/docs",
    "supportEmail": "support@keepance.com",
    "developersEmail": "developers@keepance.com"
  }
} as const;

export type Brand = typeof BRAND;

/** The four primitive brand colours, as a convenience for inline SVG fills etc. */
export const BRAND_COLORS = BRAND.colors;
