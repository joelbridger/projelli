/**
 * AI-redline tables — a Markdown pipe table proposed by the redliner must become
 * a REAL Word table (<w:tbl>), never literal pipe text in a paragraph run.
 *
 * The end-to-end "saved .docx contains <w:tbl> and no pipes" guarantee is split:
 *   - the FRONTEND (here) converts a Markdown fragment into typed blocks (tables
 *     as real <w:tbl> XML, prose as editable text) and rewrites the edit into
 *     insertBlock/insertParagraph wire ops (and rejects, never leaks, on failure);
 *   - the RUST engine (lantern-docx author.rs + commands/docx/mod.rs tests)
 *     inserts those blocks and serializes the table verbatim as a real table with
 *     no pipe text, and the prose as a tracked, editable paragraph.
 */

import { describe, it, expect } from 'vitest';

import {
  containsMarkdownTable,
  isStandaloneMarkdownTable,
  markdownToRedlineBlocks,
  type RedlineBlock,
} from '@/platform/utils/docx-io';
import {
  expandRedlineEditsForTables,
  collapseRedlineResults,
  TABLE_CONVERT_REJECT_MESSAGE,
  TABLE_REPLACE_REJECT_MESSAGE,
  TABLE_MIXED_REJECT_MESSAGE,
  TABLE_POSITION_REJECT_MESSAGE,
  type RedlineEditPlan,
} from '@/platform/utils/docx-commands';
import type { DocxAiEdit, DocxAiEditOutcome } from '@/platform/types/docx';

const TABLE_MD = ['| Name | Value |', '| --- | --- |', '| Alpha | 42 |'].join('\n');

describe('containsMarkdownTable', () => {
  it('detects a GFM pipe table (header + separator)', () => {
    expect(containsMarkdownTable(TABLE_MD)).toBe(true);
  });

  it('detects a no-outer-pipe table', () => {
    expect(containsMarkdownTable('Name | Value\n---|---\nAlpha | 42')).toBe(true);
  });

  it('does NOT treat prose with a stray pipe as a table', () => {
    expect(containsMarkdownTable('The salary is $50k | year, roughly.')).toBe(false);
  });

  it('does NOT treat a plain sentence as a table', () => {
    expect(containsMarkdownTable('Please tighten the indemnity clause.')).toBe(false);
  });
});

describe('isStandaloneMarkdownTable', () => {
  it('accepts a clean standalone table (with surrounding blank lines)', () => {
    expect(isStandaloneMarkdownTable(TABLE_MD)).toBe(true);
    expect(isStandaloneMarkdownTable(`\n\n${TABLE_MD}\n\n`)).toBe(true);
    expect(isStandaloneMarkdownTable('Name | Value\n---|---\nAlpha | 42')).toBe(true);
  });

  it('rejects a table with prose separated by a blank line', () => {
    expect(isStandaloneMarkdownTable(`Here is the summary:\n\n${TABLE_MD}`)).toBe(false);
    expect(isStandaloneMarkdownTable(`${TABLE_MD}\n\nReview it.`)).toBe(false);
  });

  it('rejects prose-with-a-pipe directly above a table (would fold in / drop it)', () => {
    // The lenient converter would treat "Note A | B" as the header row and drop
    // "| Name | Value |"; the strict input check must reject this.
    expect(isStandaloneMarkdownTable(`Note A | B\n${TABLE_MD}`)).toBe(false);
  });

  it('rejects two tables (internal blank line)', () => {
    expect(isStandaloneMarkdownTable(`${TABLE_MD}\n\n${TABLE_MD}`)).toBe(false);
  });

  it('rejects a lone pipe line with no separator', () => {
    expect(isStandaloneMarkdownTable('Just a | pipe')).toBe(false);
  });
});

describe('markdownToRedlineBlocks', () => {
  it('converts a pipe table into a real <w:tbl> block with no literal pipes', async () => {
    const blocks = await markdownToRedlineBlocks(TABLE_MD);
    const tables = blocks.filter((b) => b.kind === 'table');
    expect(tables.length).toBe(1);
    const xml = tables.map((b) => (b.kind === 'table' ? b.xml : '')).join('');
    expect(/<w:tbl[\s>]/.test(xml)).toBe(true);
    expect(xml).toContain('Name');
    expect(xml).toContain('Alpha');
    expect(xml).toContain('42');
    // No literal Markdown pipe/separator text survives.
    expect(xml).not.toContain('|');
    expect(xml).not.toContain('---');
  });

  it('preserves order for mixed text + table (prose stays as paragraph text)', async () => {
    const md = ['Here is the summary:', '', TABLE_MD, '', 'Review before filing.'].join('\n');
    const blocks = await markdownToRedlineBlocks(md);
    expect(blocks.map((b) => b.kind)).toEqual(['paragraph', 'table', 'paragraph']);
    expect(blocks[0]).toEqual({ kind: 'paragraph', text: 'Here is the summary:' });
    expect(blocks[2]).toEqual({ kind: 'paragraph', text: 'Review before filing.' });
    const table = blocks[1];
    expect(table?.kind === 'table' && !table.xml.includes('|')).toBe(true);
  });
});

describe('expandRedlineEditsForTables', () => {
  it('passes a plain-text insert through unchanged (no table path)', async () => {
    const edits: DocxAiEdit[] = [
      { op: 'insert', paragraphIndex: 2, newText: ' and its affiliates', reason: 'scope' },
    ];
    const { wireEdits, plan } = await expandRedlineEditsForTables(edits);
    expect(wireEdits).toEqual(edits);
    expect(plan).toEqual([{ kind: 'passthrough', wireIndex: 0 }]);
  });

  it('rewrites a table insert into an insertBlock op carrying real <w:tbl>, no pipes', async () => {
    const edits: DocxAiEdit[] = [
      { op: 'insert', paragraphIndex: 0, newText: TABLE_MD, reason: 'add table' },
    ];
    const { wireEdits, plan } = await expandRedlineEditsForTables(edits);
    expect(wireEdits.every((w) => !(w.newText ?? '').includes('|'))).toBe(true);
    const blockOps = wireEdits.filter((w) => w.op === 'insertBlock');
    expect(blockOps.length).toBe(1);
    expect(/<w:tbl[\s>]/.test(blockOps[0]?.xml ?? '')).toBe(true);
    expect(blockOps[0]?.paragraphIndex).toBe(0);
    expect(plan[0]!.kind).toBe('expanded');
  });

  it('REJECTS a table mixed with prose (prose cannot be a clean tracked change)', async () => {
    const md = ['Intro line.', '', TABLE_MD, '', 'Outro line.'].join('\n');
    const edits: DocxAiEdit[] = [{ op: 'insert', paragraphIndex: 1, newText: md }];
    const { wireEdits, plan } = await expandRedlineEditsForTables(edits);
    expect(wireEdits).toEqual([]);
    expect(plan).toEqual([{ kind: 'rejected', error: TABLE_MIXED_REJECT_MESSAGE }]);
  });

  it('REJECTS prose-with-a-pipe adjacent to a table (no silent text loss)', async () => {
    // Guards the round-5 case: "Note A | B" would be folded into the table by the
    // lenient converter, silently losing the note — must be rejected on the input.
    const md = `Note A | B\n${TABLE_MD}`;
    const edits: DocxAiEdit[] = [{ op: 'insert', paragraphIndex: 0, newText: md }];
    const { wireEdits, plan } = await expandRedlineEditsForTables(edits);
    expect(wireEdits).toEqual([]);
    expect(plan).toEqual([{ kind: 'rejected', error: TABLE_MIXED_REJECT_MESSAGE }]);
  });

  it('carries the original insert anchor onto every table block (drift safety)', async () => {
    const edits: DocxAiEdit[] = [
      { op: 'insert', paragraphIndex: 3, anchorText: 'as follows:', newText: TABLE_MD },
    ];
    const { wireEdits } = await expandRedlineEditsForTables(edits);
    expect(wireEdits.length).toBeGreaterThan(0);
    expect(wireEdits.every((w) => w.op === 'insertBlock' && w.anchorText === 'as follows:')).toBe(
      true,
    );
  });

  it('omits anchorText when the original insert had none', async () => {
    const edits: DocxAiEdit[] = [{ op: 'insert', paragraphIndex: 0, newText: TABLE_MD }];
    const { wireEdits } = await expandRedlineEditsForTables(edits);
    expect(wireEdits.every((w) => w.anchorText === undefined)).toBe(true);
  });

  it('REJECTS a start-of-paragraph table (a block can only go after a paragraph)', async () => {
    const edits: DocxAiEdit[] = [
      { op: 'insert', paragraphIndex: 0, newText: TABLE_MD, atParagraphStart: true },
    ];
    const { wireEdits, plan } = await expandRedlineEditsForTables(edits);
    expect(wireEdits).toEqual([]);
    expect(plan).toEqual([{ kind: 'rejected', error: TABLE_POSITION_REJECT_MESSAGE }]);
  });

  it('REJECTS a table-bearing replace (not representable as one reversible change)', async () => {
    const edits: DocxAiEdit[] = [
      { op: 'replace', paragraphIndex: 1, anchorText: 'TBD', newText: TABLE_MD },
    ];
    const { wireEdits, plan } = await expandRedlineEditsForTables(edits);
    expect(wireEdits).toEqual([]);
    expect(plan).toEqual([{ kind: 'rejected', error: TABLE_REPLACE_REJECT_MESSAGE }]);
  });

  it('REJECTS a table it cannot convert — inserts NOTHING (hard invariant)', async () => {
    const throwingConvert = async (): Promise<RedlineBlock[]> => {
      throw new Error('boom');
    };
    const edits: DocxAiEdit[] = [
      { op: 'insert', paragraphIndex: 0, newText: TABLE_MD, reason: 'add table' },
    ];
    const { wireEdits, plan } = await expandRedlineEditsForTables(edits, throwingConvert);
    expect(wireEdits).toEqual([]); // nothing goes on the wire
    expect(plan).toEqual([{ kind: 'rejected', error: TABLE_CONVERT_REJECT_MESSAGE }]);
  });

  it('REJECTS when conversion yields blocks but no real table', async () => {
    const noTableConvert = async (): Promise<RedlineBlock[]> => [
      { kind: 'paragraph', text: 'x' },
    ];
    const edits: DocxAiEdit[] = [{ op: 'insert', paragraphIndex: 0, newText: TABLE_MD }];
    const { wireEdits, plan } = await expandRedlineEditsForTables(edits, noTableConvert);
    expect(wireEdits).toEqual([]);
    expect(plan[0]).toEqual({ kind: 'rejected', error: TABLE_CONVERT_REJECT_MESSAGE });
  });
});

describe('collapseRedlineResults', () => {
  it('passthrough keeps the engine outcome; expanded needs ALL parts; rejected surfaces the message', () => {
    const plan: RedlineEditPlan[] = [
      { kind: 'passthrough', wireIndex: 0 },
      { kind: 'expanded', wireIndices: [1, 2] },
      { kind: 'rejected', error: TABLE_CONVERT_REJECT_MESSAGE },
    ];
    const wireResults: DocxAiEditOutcome[] = [
      { index: 0, applied: true, revisionId: '3', error: null },
      { index: 1, applied: true, revisionId: null, error: null },
      { index: 2, applied: true, revisionId: null, error: null },
    ];
    const out = collapseRedlineResults(plan, wireResults);
    expect(out[0]).toEqual({ index: 0, applied: true, revisionId: '3', error: null });
    expect(out[1]).toEqual({ index: 1, applied: true, revisionId: null, error: null });
    expect(out[2]).toEqual({
      index: 2,
      applied: false,
      revisionId: null,
      error: TABLE_CONVERT_REJECT_MESSAGE,
    });
  });

  it('an expanded edit is NOT applied if any part failed', () => {
    const plan: RedlineEditPlan[] = [{ kind: 'expanded', wireIndices: [0, 1] }];
    const wireResults: DocxAiEditOutcome[] = [
      { index: 0, applied: true, revisionId: null, error: null },
      { index: 1, applied: false, revisionId: null, error: 'paragraph index out of range' },
    ];
    const out = collapseRedlineResults(plan, wireResults);
    expect(out[0]!.applied).toBe(false);
    expect(out[0]!.error).toBe('paragraph index out of range');
  });
});
