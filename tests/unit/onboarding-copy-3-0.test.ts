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
import { enCatalog as en } from '../../src/i18nCatalogs';

// Narrow down to the first-run onboarding subtree
const onboarding = en['onboarding'];
if (
  typeof onboarding !== 'object' ||
  onboarding === null ||
  !('first-run' in onboarding)
) {
  throw new Error('English catalog must include onboarding.first-run');
}
const firstRun = JSON.stringify(onboarding['first-run']);

describe('onboarding copy matches 3.0 positioning', () => {
  it('first-run copy never mentions markdown', () => {
    expect(firstRun.toLowerCase()).not.toContain('markdown');
  });

  it('welcome subtitle is the 3.0 story, not chat-to-file', () => {
    expect(firstRun).not.toContain('every chat becomes a real file');
  });

  it('demo step does not promise markdown outputs', () => {
    expect(firstRun.toLowerCase()).not.toContain('editable markdown');
  });

  it('welcome body does not describe a markdown editor', () => {
    expect(firstRun.toLowerCase()).not.toContain('markdown editor');
  });

  it('workspace body does not mention "plain markdown files"', () => {
    expect(firstRun.toLowerCase()).not.toContain('plain markdown');
  });

  it('demo outcome does not promise markdown files', () => {
    expect(firstRun.toLowerCase()).not.toContain('markdown files');
  });
});
