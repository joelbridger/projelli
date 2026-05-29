/**
 * S10 — Document suite
 *
 * Goal: Editor view with 3 tabs visible in the tab strip:
 *   Pricing.md (active, .md icon),  Q1 Forecast.xlsx (emerald Excel icon),
 *   Pitch Deck.pptx (orange PowerPoint icon).
 *
 * The xlsx/pptx tabs have no body content — they sit idle so the tab bar
 * renders the correct document-type icons without the editor trying to
 * display binary content.
 */

import { captureStill } from '../lib/capture-still';

export async function shot10() {
  return captureStill({
    shotKey: 'documentSuite',
    outputName: 'feature-document-suite.png',
    viewport: { width: 1280, height: 800 },
    windowTitle: 'Linterly — Keepance',
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  shot10().then((p) => console.log(`✓ ${p}`));
}
