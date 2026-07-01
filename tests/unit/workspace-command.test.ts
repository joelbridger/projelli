/**
 * `@workspace` command parsing — covers the input-side of M2.
 *
 * The parser is the single source of truth for whether a chat message
 * should trigger workspace retrieval and what the retrieval query is.
 * These tests pin every edge case documented in the M2 spec:
 *   - `@workspace` at start, middle, end of message
 *   - `@workspace` alone with nothing else
 *   - false positives (email addresses containing `@workspace.`)
 *   - punctuation immediately after the tag
 *   - multiple tags in one message
 */

import { describe, expect, it } from 'vitest';

import {
  buildWorkspaceContextBlock,
  citationBasename,
  normalizeNumericCitations,
  parseCitations,
  parseWorkspaceCommand,
  resolveCitationPath,
  stripWorkspaceCommand,
} from '@/platform/rag/workspaceCommand';
import type { RagHit } from '@/platform/utils/tauri-commands';

describe('parseWorkspaceCommand', () => {
  it('detects @workspace at the start of a message and strips it', () => {
    const result = parseWorkspaceCommand(
      '@workspace how did we price the premium tier?',
    );
    expect(result.hasCommand).toBe(true);
    expect(result.query).toBe('how did we price the premium tier?');
    expect(result.raw).toBe(
      '@workspace how did we price the premium tier?',
    );
  });

  it('detects @workspace at the end of a message', () => {
    const result = parseWorkspaceCommand(
      "what's the price of the premium tier? @workspace",
    );
    expect(result.hasCommand).toBe(true);
    expect(result.query).toBe("what's the price of the premium tier?");
  });

  it('detects @workspace in the middle of a message', () => {
    const result = parseWorkspaceCommand(
      'remind me — @workspace — what did we decide about pricing?',
    );
    expect(result.hasCommand).toBe(true);
    // Surrounding whitespace collapses, the tag is gone.
    expect(result.query).toContain('remind me');
    expect(result.query).toContain('what did we decide');
    expect(result.query).not.toContain('@workspace');
  });

  it('returns empty query when message is only @workspace', () => {
    const result = parseWorkspaceCommand('@workspace');
    expect(result.hasCommand).toBe(true);
    expect(result.query).toBe('');
  });

  it('returns empty query when message is @workspace + whitespace', () => {
    const result = parseWorkspaceCommand('   @workspace   ');
    expect(result.hasCommand).toBe(true);
    expect(result.query).toBe('');
  });

  it('does NOT match @workspace inside an email address', () => {
    const result = parseWorkspaceCommand('email me at alex@workspace.com');
    expect(result.hasCommand).toBe(false);
    expect(result.query).toBe('email me at alex@workspace.com');
  });

  it('does NOT match when @workspace is part of a larger token', () => {
    const result = parseWorkspaceCommand('the @workspaceissue project');
    expect(result.hasCommand).toBe(false);
  });

  it('matches @workspace followed by punctuation', () => {
    const result = parseWorkspaceCommand('@workspace, what do we know?');
    expect(result.hasCommand).toBe(true);
    expect(result.query).toBe(', what do we know?');
  });

  it('strips multiple occurrences of @workspace', () => {
    const result = parseWorkspaceCommand(
      '@workspace @workspace pricing notes?',
    );
    expect(result.hasCommand).toBe(true);
    expect(result.query).toBe('pricing notes?');
  });

  it('stripWorkspaceCommand returns the same query string', () => {
    expect(stripWorkspaceCommand('@workspace hello')).toBe('hello');
    expect(stripWorkspaceCommand('hello')).toBe('hello');
    expect(stripWorkspaceCommand('@workspace')).toBe('');
  });

  it('handles messages with newlines', () => {
    const result = parseWorkspaceCommand(
      '@workspace\nwhat did we decide about pricing?',
    );
    expect(result.hasCommand).toBe(true);
    expect(result.query).toBe('what did we decide about pricing?');
  });
});

describe('citationBasename', () => {
  it('returns the last path segment', () => {
    expect(citationBasename('notes/pricing.md')).toBe('pricing.md');
    expect(citationBasename('a/b/c/deep.md')).toBe('deep.md');
    expect(citationBasename('single.md')).toBe('single.md');
  });

  it('handles Windows-style separators', () => {
    expect(citationBasename('notes\\pricing.md')).toBe('pricing.md');
  });

  it('falls back to the original path when it ends with a separator', () => {
    expect(citationBasename('a/b/')).toBe('a/b/');
  });
});

describe('parseCitations', () => {
  it('parses [filename paragraph N] citations', () => {
    const content =
      'We priced it at $49 [pricing.md paragraph 3] after testing [research.md paragraph 1].';
    const cites = parseCitations(content);
    expect(cites).toHaveLength(2);
    expect(cites[0]).toMatchObject({
      basename: 'pricing.md',
      paragraphIndex: 3,
    });
    expect(cites[1]).toMatchObject({
      basename: 'research.md',
      paragraphIndex: 1,
    });
  });

  it('parses the legacy § form as well', () => {
    const content = 'See [pricing.md §3] for details.';
    const cites = parseCitations(content);
    expect(cites).toHaveLength(1);
    expect(cites[0]).toMatchObject({
      basename: 'pricing.md',
      paragraphIndex: 3,
    });
  });

  it('parses the [filename page N] form (PDF/scan sources, BUG-016)', () => {
    // PDF/scan sources are labelled "page N" in the context block, so a model
    // that copies that label must still produce a parseable citation.
    const cites = parseCitations('The award was $73,250 [filing.pdf page 2].');
    expect(cites).toHaveLength(1);
    expect(cites[0]).toMatchObject({
      basename: 'filing.pdf',
      paragraphIndex: 2,
    });
  });

  it('returns empty for a message with no citations', () => {
    expect(parseCitations('Just a normal reply.')).toEqual([]);
  });

  it('skips malformed citations (no number)', () => {
    // Neither `paragraph` nor `§` without a digit should match.
    expect(parseCitations('[pricing.md paragraph]')).toEqual([]);
    expect(parseCitations('[pricing.md §]')).toEqual([]);
  });

  it('captures the exact substring match', () => {
    const content = 'Answer [foo.md paragraph 7] here.';
    const cites = parseCitations(content);
    expect(cites).toHaveLength(1);
    expect(cites[0]?.match).toBe('[foo.md paragraph 7]');
    expect(content.slice(cites[0]!.start, cites[0]!.end)).toBe(
      '[foo.md paragraph 7]',
    );
  });
});

describe('buildWorkspaceContextBlock (A3 PDF extensions)', () => {
  it('shows page number for PDF hits', () => {
    const hits: RagHit[] = [
      {
        path: '/w/report.pdf',
        chunkText: 'This quarter revenue grew.',
        score: 0.9,
        paragraphIndex: 0,
        sourceType: 'pdf',
        pageNumber: 3,
      },
    ];
    const block = buildWorkspaceContextBlock(hits);
    expect(block).toContain('report.pdf page 3');
    expect(block).not.toContain('paragraph 0');
  });

  it('shows paragraph index for text hits without sourceType', () => {
    const hits: RagHit[] = [
      {
        path: '/w/notes.md',
        chunkText: 'Some notes.',
        score: 0.8,
        paragraphIndex: 2,
      },
    ];
    const block = buildWorkspaceContextBlock(hits);
    expect(block).toContain('notes.md paragraph 2');
  });

  it('shows paragraph index for text hits with sourceType=text', () => {
    const hits: RagHit[] = [
      {
        path: '/w/readme.txt',
        chunkText: 'Read this.',
        score: 0.7,
        paragraphIndex: 5,
        sourceType: 'text',
      },
    ];
    const block = buildWorkspaceContextBlock(hits);
    expect(block).toContain('readme.txt paragraph 5');
  });

  it('falls back to paragraph for PDF hit without pageNumber', () => {
    const hits: RagHit[] = [
      {
        path: '/w/old.pdf',
        chunkText: 'Old pre-A3 chunk.',
        score: 0.6,
        paragraphIndex: 100,
        sourceType: 'pdf',
        // pageNumber absent (pre-A3 row)
      },
    ];
    const block = buildWorkspaceContextBlock(hits);
    expect(block).toContain('old.pdf paragraph 100');
  });

  it('returns empty string for empty hits', () => {
    expect(buildWorkspaceContextBlock([])).toBe('');
  });
});

describe('resolveCitationPath', () => {
  const hits: RagHit[] = [
    {
      path: 'notes/pricing.md',
      chunkText: 'Premium tier priced at $49',
      score: 0.9,
      paragraphIndex: 3,
    },
    {
      path: 'archive/pricing.md',
      chunkText: 'Old pricing notes',
      score: 0.4,
      paragraphIndex: 7,
    },
    {
      path: 'notes/research.md',
      chunkText: 'Competitor analysis',
      score: 0.8,
      paragraphIndex: 1,
    },
  ];

  it('resolves basename to full path when unambiguous', () => {
    const cite = parseCitations('[research.md paragraph 1]')[0]!;
    expect(resolveCitationPath(cite, hits)).toBe('notes/research.md');
  });

  it('prefers the hit with matching paragraph when basename is ambiguous', () => {
    const cite = parseCitations('[pricing.md paragraph 7]')[0]!;
    expect(resolveCitationPath(cite, hits)).toBe('archive/pricing.md');
  });

  it('returns null when no paragraph matches (BUG-065: no basename fallback — an unretrieved locator is unverifiable)', () => {
    const cite = parseCitations('[pricing.md paragraph 99]')[0]!;
    expect(resolveCitationPath(cite, hits)).toBe(null);
  });

  it('returns null when no hit matches the basename', () => {
    const cite = parseCitations('[nowhere.md paragraph 1]')[0]!;
    expect(resolveCitationPath(cite, hits)).toBe(null);
  });

  it('returns null with empty hits', () => {
    const cite = parseCitations('[pricing.md paragraph 3]')[0]!;
    expect(resolveCitationPath(cite, [])).toBe(null);
  });
});

describe('normalizeNumericCitations (F-503)', () => {
  const sources = [
    { path: '/ws/matter/deposition-transcript-johnson.txt', paragraphIndex: 12 },
    { path: '/ws/matter/incident-summary-johnson.md', paragraphIndex: 8 },
  ];

  it('rewrites [N paragraph M] to the numbered source basename + its real paragraph', () => {
    expect(normalizeNumericCitations('The date conflicts [1 paragraph 3].', sources)).toBe(
      'The date conflicts [deposition-transcript-johnson.txt paragraph 12].',
    );
  });

  it('rewrites [N §M] and bare [N]', () => {
    expect(normalizeNumericCitations('See [2 §1] and [1].', sources)).toBe(
      'See [incident-summary-johnson.md paragraph 8] and [deposition-transcript-johnson.txt paragraph 12].',
    );
  });

  it('captures the PDF [N page M] form and binds it to the exact chunk ordinal', () => {
    // Codex P2: PDF/scan sources are labelled "page N" in the context block, so
    // a local model can emit `[1 page 2]`. It repairs through the source's
    // UNIQUE per-chunk paragraphIndex — so two chunks on the SAME page keep
    // distinct targets (the resolved hit still renders as "page N" to the user).
    const pdfSources = [
      { path: '/ws/matter/filing.pdf', paragraphIndex: 200 }, // page 2, chunk A
      { path: '/ws/matter/filing.pdf', paragraphIndex: 201 }, // page 2, chunk B
    ];
    // `[1 page 2]` and `[2 page 2]` bind to DIFFERENT chunks, not the same page.
    expect(normalizeNumericCitations('First [1 page 2], second [2 page 2].', pdfSources)).toBe(
      'First [filing.pdf paragraph 200], second [filing.pdf paragraph 201].',
    );
    // Bare [2] also resolves to the second source ordinal, not the first same-page chunk.
    expect(normalizeNumericCitations('See [2].', pdfSources)).toBe(
      'See [filing.pdf paragraph 201].',
    );
  });

  it('leaves filename citations, out-of-range numbers, and markdown links alone', () => {
    const text = 'Cited [notes.md paragraph 2], [9 paragraph 1], [3], and [1](https://x).';
    expect(normalizeNumericCitations(text, sources)).toBe(
      'Cited [notes.md paragraph 2], [9 paragraph 1], [3], and [1](https://x).',
    );
    // [9 …] and [3] are out of range for 2 sources; [1](…) is a link.
  });

  it('is a no-op with no sources', () => {
    expect(normalizeNumericCitations('See [1 paragraph 2].', [])).toBe('See [1 paragraph 2].');
  });

  it('never rewrites array indexing, footnote markers in quoted prose, or chained brackets', () => {
    // Task 4 review counterexamples: bare [N] preceded by a word char or `]`
    // is syntax, not a citation — rewriting it corrupts verbatim quotes.
    const code = 'Check items[1] and data[2] before use.';
    expect(normalizeNumericCitations(code, sources)).toBe(code);
    const quoted = 'The witness said "the terms[1] set forth herein control."';
    expect(normalizeNumericCitations(quoted, sources)).toBe(quoted);
    const chained = 'matrix[0][1] stays untouched.';
    expect(normalizeNumericCitations(chained, sources)).toBe(chained);
    // A genuine bare citation after a space still rewrites.
    expect(normalizeNumericCitations('Conflicting dates [1].', sources)).toContain('paragraph');
  });
});
