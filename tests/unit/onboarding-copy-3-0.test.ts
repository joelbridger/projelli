/**
 * Task 2 — onboarding copy matches 3.0 positioning.
 *
 * Verifies that the first-run onboarding copy (welcome / workspace / demo)
 * no longer sells the v2 product ("Markdown editor", "every chat becomes a
 * real file", "editable Markdown files") and instead matches the v3.0
 * positioning: private intelligence layer, Word documents first-class,
 * cited answers, confidentiality.
 */

import { describe, it, expect } from 'vitest';
import en from '../../src/locales/en.json';

// The old `first-run` i18n subtree was removed (FIX 6) — it was orphaned
// copy from the deleted GuidedOnboarding wizard. The new JourneyHost chapters
// use hard-coded strings in `src/features/onboarding-journey/copy/strings.ts`.
//
// These tests now verify that the `onboarding` namespace as a whole (which
// still contains disk-encryption, api-key-card, etc.) does not regress back
// to v2 markdown-editor copy.

// Stringify the entire onboarding namespace (no first-run subtree exists).
const onboardingCopy = JSON.stringify(en.onboarding);

describe('onboarding copy matches 3.0 positioning', () => {
  it('first-run key is removed (orphaned i18n cleanup)', () => {
    // The 'first-run' subtree was removed; verifying it no longer exists.
    expect('first-run' in en.onboarding).toBe(false);
  });

  it('onboarding namespace copy never mentions markdown', () => {
    expect(onboardingCopy.toLowerCase()).not.toContain('markdown');
  });

  it('onboarding namespace copy does not contain old chat-to-file promise', () => {
    expect(onboardingCopy).not.toContain('every chat becomes a real file');
  });

  it('onboarding namespace copy does not promise markdown outputs', () => {
    expect(onboardingCopy.toLowerCase()).not.toContain('editable markdown');
  });

  it('onboarding namespace copy does not describe a markdown editor', () => {
    expect(onboardingCopy.toLowerCase()).not.toContain('markdown editor');
  });

  it('onboarding namespace copy does not mention "plain markdown files"', () => {
    expect(onboardingCopy.toLowerCase()).not.toContain('plain markdown');
  });
});
