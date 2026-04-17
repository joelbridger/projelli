import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * Q10 (v1.5) — Template preview gallery content lint.
 *
 * Validates every example Markdown file under website/templates/examples/:
 *   1. File exists for each of the 15 founder templates (plus UserInterviewsSynthesis).
 *   2. Word count is between 150 and 800 (inclusive).
 *   3. No em dash characters (— U+2014) or HTML entity `&mdash;`.
 *   4. No banned marketing-voice words.
 */

const EXAMPLES_DIR = resolve(__dirname, '../../website/templates/examples');

const EXPECTED_SLUGS = [
  'new-business-kickoff',
  'competitor-analysis',
  'customer-persona',
  'pricing-strategy',
  'go-to-market-plan',
  'pitch-deck',
  'content-strategy',
  'user-interviews',
  'mvp-scope',
  'financial-model',
  'landing-page',
  'weekly-review',
  'investor-update',
  'board-meeting-prep',
  'first-hire-playbook',
  'user-interviews-synthesis',
];

const BANNED_WORDS = [
  'leverage',
  'seamless',
  'seamlessly',
  'empower',
  'empowers',
  'empowering',
  'unlock',
  'unlocks',
  'unlocking',
  'transform your',
  'elevate',
  'elevates',
  'delve',
  'delves',
  'tapestry',
];

function wordCount(text: string): number {
  return text
    .replace(/[#*_`>|\-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean).length;
}

describe('Q10 — template example files', () => {
  it('has an example .md file for every expected template', () => {
    const files = readdirSync(EXAMPLES_DIR)
      .filter((name) => name.endsWith('.md'))
      .map((name) => name.replace(/\.md$/, ''))
      .sort();
    for (const slug of EXPECTED_SLUGS) {
      expect(files).toContain(slug);
    }
  });

  for (const slug of EXPECTED_SLUGS) {
    describe(slug, () => {
      const filePath = join(EXAMPLES_DIR, `${slug}.md`);

      it('exists', () => {
        expect(existsSync(filePath)).toBe(true);
      });

      it('word count is between 150 and 800', () => {
        const content = readFileSync(filePath, 'utf-8');
        const words = wordCount(content);
        expect(words).toBeGreaterThanOrEqual(150);
        expect(words).toBeLessThanOrEqual(800);
      });

      it('contains no em dash character or HTML entity', () => {
        const content = readFileSync(filePath, 'utf-8');
        expect(content.includes('\u2014')).toBe(false);
        expect(content.includes('&mdash;')).toBe(false);
      });

      it('contains no banned marketing-voice words', () => {
        const content = readFileSync(filePath, 'utf-8').toLowerCase();
        for (const banned of BANNED_WORDS) {
          expect(content.includes(banned)).toBe(false);
        }
      });
    });
  }
});
