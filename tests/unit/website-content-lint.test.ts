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
  'vs/index.html',
  'vs/obsidian.html',
  'vs/notion.html',
  'vs/chatgpt.html',
  'blog/index.html',
  'blog/keepance-1-5-announce.html',
  'blog/keepance-v2-announce.html',
  // Added 2026-04-17 night sweep — these were originally outside Phase 6
  // scope but had ~61 em dashes between them. Locking them in.
  'press-kit/index.html',
  'docs/getting-started.html',
  'docs/api-keys.html',
  'docs/faq.html',
  'legal/privacy/index.html',
  'legal/terms/index.html',
  'legal/eula/index.html',
  // Stream D1 (v2.0) — mobile access docs.
  'docs/mobile-access/index.html',
  'docs/mobile-access/icloud.html',
  'docs/mobile-access/dropbox.html',
  'docs/mobile-access/syncthing.html',
  'docs/mobile-access/google-drive.html',
  // Stream C5 (v2.0) — plugin developer experience docs.
  'docs/plugins/index.html',
  'docs/plugins/getting-started.html',
  'docs/plugins/manifest-reference.html',
  'docs/plugins/permissions.html',
  'docs/plugins/api-reference.html',
  'docs/plugins/publishing.html',
  'docs/plugins/examples.html',
  // Stream C6 (v2.0) — marketplace submission docs.
  'docs/marketplace-submissions.html',
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

/**
 * Returns the relative path (from WEBSITE_ROOT) of every *.html file directly
 * inside website/blog/. This is used by the blog em-dash sweep below so that
 * any future blog post is automatically covered without editing TARGETS.
 */
function collectBlogPosts(): string[] {
  const blogDir = join(WEBSITE_ROOT, 'blog');
  let entries: string[] = [];
  try {
    entries = readdirSync(blogDir);
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.endsWith('.html'))
    .map((e) => relative(WEBSITE_ROOT, join(blogDir, e)));
}

function collectTemplateDetailPages(): string[] {
  const templatesDir = join(WEBSITE_ROOT, 'templates');
  const out: string[] = [];
  // The /templates/ founder pages were decommissioned and deleted; tolerate a
  // missing dir so the lint still runs.
  let entries: string[] = [];
  try {
    entries = readdirSync(templatesDir);
  } catch {
    return out;
  }
  for (const entry of entries) {
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

/**
 * T1-A — professional-review claim accuracy.
 *
 * Asserts that no page claims attorney/CPA/consultant review has already
 * happened, because every template still carries a @draft header and the
 * review has not yet taken place. The correct framing is "built with X input".
 */
describe('T1-A — no false attorney/CPA/consultant-review claims', () => {
  const PRACTICE_PAGES: Array<{ label: string; rel: string }> = [
    { label: 'legal', rel: 'legal/index.html' },
    { label: 'tax', rel: 'tax/index.html' },
    { label: 'consulting', rel: 'consulting/index.html' },
  ];

  const FORBIDDEN_PHRASES = [
    'attorney-reviewed and kept current',
    'CPA-reviewed and kept current',
    'reviewed by practicing attorneys',
    'reviewed by practicing consultants',
  ];

  it('does not claim attorney/CPA/consultant review has happened', () => {
    for (const { label, rel } of PRACTICE_PAGES) {
      const content = readFileSync(join(WEBSITE_ROOT, rel), 'utf-8');
      for (const phrase of FORBIDDEN_PHRASES) {
        expect(content, `${label}: "${phrase}"`).not.toContain(phrase);
      }
    }
  });
});

/**
 * T1-B — pricing accuracy: EULA/Terms Practice annual, $129 sweep.
 */
describe('T1-B — EULA/Terms Practice annual subscription', () => {
  const websiteDir = WEBSITE_ROOT;

  it('EULA describes Practice as an annual subscription, not one-time perpetual', () => {
    const eulaHtml = readFileSync(join(websiteDir, 'legal/eula/index.html'), 'utf-8');
    const termsHtml = readFileSync(join(websiteDir, 'legal/terms/index.html'), 'utf-8');

    expect(eulaHtml, 'EULA Practice should not say one-time').not.toMatch(/Practice[^<]{0,80}one-time/i);
    expect(eulaHtml, 'EULA Practice should not say perpetual').not.toMatch(/Practice[^<]{0,80}perpetual/i);
    expect(termsHtml, 'Terms Practice should not say one-time').not.toMatch(/Practice[^<]{0,80}one-time/i);
    expect(eulaHtml, 'EULA Practice should say annual').toMatch(/Practice[^<]{0,120}annual/i);
  });

  it('no stale $129 Professional price in user-facing copy', () => {
    const filesToCheck = [
      'byok-ai/index.html',
      'blog/byok-actual-cost-after-60-days.html',
      'blog/keepance-1-5-announce.html',
      'blog/chat-shouldnt-disappear-when-you-close-the-tab.html',
      'blog/how-i-built-keepance-in-8-weeks.html',
      'local-model-setup/index.html',
      'markdown-for-ai/index.html',
      'api-key-setup-guide/index.html',
      'press-kit/index.html',
      'changelog/index.html',
    ];
    for (const f of filesToCheck) {
      const html = readFileSync(join(websiteDir, f), 'utf-8');
      expect(html, `stale $129 in ${f}`).not.toMatch(/\$129\b/);
    }
  });
});

/**
 * Blog posts — em-dash sweep.
 *
 * Automatically covers every *.html file in website/blog/ via collectBlogPosts()
 * so any future blog post with an em dash fails CI without any changes to TARGETS.
 * Only the em-dash rules are checked here; canonical and banned-word checks for
 * previously-listed blog files are handled in the Phase 6 block above.
 */
describe('Blog posts — em-dash sweep (all blog/*.html)', () => {
  const blogPosts = collectBlogPosts();

  for (const rel of blogPosts) {
    describe(rel, () => {
      const filePath = join(WEBSITE_ROOT, rel);

      it('contains no em dash characters (U+2014)', () => {
        const content = readFileSync(filePath, 'utf-8');
        expect(content.includes('—')).toBe(false);
      });

      it('contains no &mdash; HTML entities', () => {
        const content = readFileSync(filePath, 'utf-8');
        expect(content.includes('&mdash;')).toBe(false);
      });
    });
  }
});
