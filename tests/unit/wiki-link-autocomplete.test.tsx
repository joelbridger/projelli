/**
 * Q14 (Wave 1.6) — wiki-link autocomplete source.
 *
 * Exercises `createWikiLinkCompletionSource` and its helpers with a
 * minimal CodeMirror state. We don't render the full editor — we just
 * construct an `EditorState` and a handcrafted `CompletionContext`,
 * which is enough to verify the source's output (which is the unit
 * under test).
 */

import { describe, it, expect } from 'vitest';
import { EditorState } from '@codemirror/state';
import { CompletionContext } from '@codemirror/autocomplete';
import {
  createWikiLinkCompletionSource,
  flattenFilesForWikiLinks,
  normalizeWikiLinkTarget,
  scoreWikiLinkCandidate,
  type WikiLinkFileInfo,
} from '@/modules/editor/wikiLinkAutocomplete';
import type { FileNode } from '@/types/workspace';

const sampleFiles: WikiLinkFileInfo[] = [
  { path: '/ws/Quarterly Review.md', name: 'Quarterly Review.md' },
  { path: '/ws/Pricing Strategy.md', name: 'Pricing Strategy.md' },
  { path: '/ws/Projects/Launch Plan.md', name: 'Launch Plan.md' },
  { path: '/ws/Questions.md', name: 'Questions.md' },
  { path: '/ws/notes.txt', name: 'notes.txt' },
];

function contextAt(doc: string, pos: number): CompletionContext {
  const state = EditorState.create({ doc });
  return new CompletionContext(state, pos, /* explicit */ true);
}

describe('normalizeWikiLinkTarget', () => {
  it('strips the extension from a file name', () => {
    expect(normalizeWikiLinkTarget('Quarterly Review.md')).toBe('Quarterly Review');
    expect(normalizeWikiLinkTarget('notes.txt')).toBe('notes');
  });
  it('leaves extension-less names alone', () => {
    expect(normalizeWikiLinkTarget('Makefile')).toBe('Makefile');
  });
  it('leaves dotfiles alone (no real extension)', () => {
    expect(normalizeWikiLinkTarget('.gitignore')).toBe('.gitignore');
  });
});

describe('scoreWikiLinkCandidate', () => {
  it('prefers prefix over substring over initials', () => {
    const prefix = scoreWikiLinkCandidate('qu', 'Quarterly Review.md') ?? 0;
    const substring = scoreWikiLinkCandidate('rev', 'Quarterly Review.md') ?? 0;
    const initials = scoreWikiLinkCandidate('qr', 'Quarterly Review.md') ?? 0;
    expect(prefix).toBeGreaterThan(substring);
    expect(substring).toBeGreaterThan(initials);
  });
  it('returns null when the query does not match', () => {
    expect(scoreWikiLinkCandidate('zzz', 'Quarterly Review.md')).toBeNull();
  });
  it('matches everything on empty query', () => {
    expect(scoreWikiLinkCandidate('', 'anything.md')).not.toBeNull();
  });
});

describe('flattenFilesForWikiLinks', () => {
  it('recurses into folders and skips folder entries', () => {
    const tree: FileNode[] = [
      { id: '1', name: 'root.md', path: '/ws/root.md', type: 'file' },
      {
        id: '2',
        name: 'sub',
        path: '/ws/sub',
        type: 'folder',
        children: [
          { id: '3', name: 'nested.md', path: '/ws/sub/nested.md', type: 'file' },
        ],
      },
    ];
    const flat = flattenFilesForWikiLinks(tree);
    expect(flat.map((f) => f.name)).toEqual(['root.md', 'nested.md']);
  });
});

describe('createWikiLinkCompletionSource', () => {
  const source = createWikiLinkCompletionSource(() => sampleFiles);

  it('does nothing when the cursor is not inside an open `[[`', () => {
    const ctx = contextAt('hello world', 5);
    expect(source(ctx)).toBeNull();
  });

  it('fires when the cursor is immediately after `[[`', () => {
    const doc = 'See [[';
    const ctx = contextAt(doc, doc.length);
    const result = source(ctx);
    expect(result).not.toBeNull();
    expect(result!.from).toBe(doc.length); // query is empty -> from == pos
    // All files appear in alphabetical order when there is no query.
    expect(result!.options.length).toBe(sampleFiles.length);
  });

  it('filters and scores options given a partial query (`[[q`)', () => {
    const doc = 'See [[q';
    const ctx = contextAt(doc, doc.length);
    const result = source(ctx);
    expect(result).not.toBeNull();
    // Options should include Quarterly Review and Questions; Pricing Strategy
    // should NOT match because 'q' isn't in its normalized name.
    const labels = result!.options.map((o) => o.label).sort();
    expect(labels).toContain('Quarterly Review');
    expect(labels).toContain('Questions');
    expect(labels).not.toContain('Pricing Strategy');
    // The `from` position should point at the character AFTER `[[`.
    expect(result!.from).toBe(doc.length - 1);
  });

  it('ranks exact-prefix matches above substring matches', () => {
    const doc = '[[pr';
    const ctx = contextAt(doc, doc.length);
    const result = source(ctx);
    expect(result).not.toBeNull();
    const firstLabel = result!.options[0]?.label;
    expect(firstLabel).toBe('Pricing Strategy');
  });

  it('normalizes the inserted label (strips extension)', () => {
    const doc = '[[not';
    const ctx = contextAt(doc, doc.length);
    const result = source(ctx);
    expect(result).not.toBeNull();
    const labels = result!.options.map((o) => o.label);
    // `notes.txt` should show up as `notes`.
    expect(labels).toContain('notes');
    expect(labels).not.toContain('notes.txt');
  });

  it('does not fire when the line already contains a closing `]]` before the cursor', () => {
    // If the cursor is AFTER a closed `[[foo]]`, there is no open bracket.
    const doc = 'See [[done]] more text';
    const ctx = contextAt(doc, doc.length);
    expect(source(ctx)).toBeNull();
  });
});
