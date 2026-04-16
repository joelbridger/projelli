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
  citationBasename,
  parseCitations,
  parseWorkspaceCommand,
  resolveCitationPath,
  stripWorkspaceCommand,
} from '@/modules/memory/workspaceCommand';
import type { RagHit } from '@/utils/tauri-commands';

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

  it('falls back to the first basename match when no paragraph matches', () => {
    const cite = parseCitations('[pricing.md paragraph 99]')[0]!;
    expect(resolveCitationPath(cite, hits)).toBe('notes/pricing.md');
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
