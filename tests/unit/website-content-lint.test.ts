import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

/**
 * Phase 6 (v1.5) — website content lint.
 *
 * Scans every HTML file added/updated for v1.5 (homepage, /templates,
 * /vs, /blog) and fails the build on:
 *   1. Any em dash character (U+2014) or HTML `&mdash;` entity.
 *   2. Any banned marketing-voice word.
 *   3. Missing `<link rel="canonical">` meta tag.
 */

const WEBSITE_ROOT = resolve(__dirname, '../../website');

const TARGETS = [
  'index.html',
  'templates/index.html',
  'templates/_detail_template.html',
  'vs/index.html',
  'vs/obsidian.html',
  'vs/notion.html',
  'vs/chatgpt.html',
  'blog/index.html',
  'blog/projelli-1-5-announce.html',
  // Added 2026-04-17 night sweep — these were originally outside Phase 6
  // scope but had ~61 em dashes between them. Locking them in.
  'press-kit/index.html',
  'docs/getting-started.html',
  'docs/api-keys.html',
  'docs/faq.html',
  'legal/privacy.html',
  'legal/terms.html',
  'legal/eula.html',
  // Stream D1 (v2.0) — mobile access docs.
  'docs/mobile-access/index.html',
  'docs/mobile-access/icloud.html',
  'docs/mobile-access/dropbox.html',
  'docs/mobile-access/syncthing.html',
  'docs/mobile-access/google-drive.html',
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

function collectTemplateDetailPages(): string[] {
  const templatesDir = join(WEBSITE_ROOT, 'templates');
  const out: string[] = [];
  for (const entry of readdirSync(templatesDir)) {
    const abs = join(templatesDir, entry);
    try {
      if (statSync(abs).isDirectory() && entry !== 'examples') {
        const index = join(abs, 'index.html');
        out.push(relative(WEBSITE_ROOT, index));
      }
    } catch {
      // ignore
    }
  }
  return out;
}

describe('Phase 6 — website content lint', () => {
  const allTargets = [...TARGETS, ...collectTemplateDetailPages()];

  for (const rel of allTargets) {
    describe(rel, () => {
      const filePath = join(WEBSITE_ROOT, rel);

      it('contains no em dash characters', () => {
        const content = readFileSync(filePath, 'utf-8');
        expect(content.includes('\u2014')).toBe(false);
      });

      it('contains no &mdash; HTML entities', () => {
        const content = readFileSync(filePath, 'utf-8');
        expect(content.includes('&mdash;')).toBe(false);
      });

      it('contains a <link rel="canonical"> tag', () => {
        const content = readFileSync(filePath, 'utf-8');
        expect(/<link[^>]+rel="canonical"/i.test(content)).toBe(true);
      });

      it('contains no banned marketing-voice words (outside CSS / script)', () => {
        const content = readFileSync(filePath, 'utf-8')
          .replace(/<script[\s\S]*?<\/script>/gi, '')
          .replace(/<style[\s\S]*?<\/style>/gi, '')
          .toLowerCase();
        for (const banned of BANNED_WORDS) {
          expect(content.includes(banned), `found banned word "${banned}" in ${rel}`).toBe(false);
        }
      });
    });
  }
});
