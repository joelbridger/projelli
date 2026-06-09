// Unit tests for the paragraph-level text diff that turns a user's plain-text
// edit into tracked-change edits (WS-A / A4, secondary).

import { describe, it, expect } from 'vitest';

import { diffParagraphEdits, diffSpans } from '@/utils/docx-text-diff';

describe('diffSpans', () => {
  it('returns no spans of change for identical text', () => {
    const spans = diffSpans('hello world', 'hello world');
    expect(spans.every((s) => s.type === 'equal')).toBe(true);
  });

  it('detects a word insertion', () => {
    const spans = diffSpans('the cat sat', 'the big cat sat');
    const inserts = spans.filter((s) => s.type === 'insert').map((s) => s.text.trim());
    expect(inserts).toContain('big');
  });

  it('detects a word deletion', () => {
    const spans = diffSpans('the big cat sat', 'the cat sat');
    const deletes = spans.filter((s) => s.type === 'delete').map((s) => s.text.trim());
    expect(deletes).toContain('big');
  });
});

describe('diffParagraphEdits', () => {
  it('returns [] when text is unchanged', () => {
    expect(diffParagraphEdits(0, 'same text', 'same text')).toEqual([]);
  });

  it('emits a delete edit for removed words', () => {
    const edits = diffParagraphEdits(2, 'remove this phrase now', 'remove now');
    expect(edits.length).toBeGreaterThan(0);
    const del = edits.find((e) => e.op === 'delete');
    expect(del).toBeDefined();
    expect(del?.paragraphIndex).toBe(2);
    expect((del?.anchorText ?? '')).toContain('this phrase');
  });

  it('emits an insert edit anchored after preceding text for added words', () => {
    const edits = diffParagraphEdits(0, 'governed by law', 'governed by Delaware law');
    const ins = edits.find((e) => e.op === 'insert');
    expect(ins).toBeDefined();
    expect((ins?.newText ?? '')).toContain('Delaware');
    // The insert is anchored (so it lands in the right place), not appended blind.
    expect(ins?.anchorText).toBeDefined();
  });

  it('emits a single replace when a word is swapped in place', () => {
    const edits = diffParagraphEdits(1, 'governed by Delaware law', 'governed by Nevada law');
    // Should produce one replace (grouped del+ins), not separate del + insert.
    const replaces = edits.filter((e) => e.op === 'replace');
    expect(replaces).toHaveLength(1);
    expect(replaces[0]?.anchorText).toBe('Delaware');
    expect(replaces[0]?.newText).toBe('Nevada');
  });

  it('attributes user edits with a reason for the review pane', () => {
    const edits = diffParagraphEdits(0, 'old', 'new');
    expect(edits.every((e) => e.reason === 'User edit')).toBe(true);
  });
});
