// Unit tests for the display-only DOM helpers (WS-A / A3).
//
// These cover the load-bearing logic the editor relies on: parsing the common
// formatting subset out of opaque `propertiesXml`, grouping tracked changes by
// revision id, and the text/snippet helpers. Pure functions — no DOM, no Tauri.

import { describe, it, expect } from 'vitest';

import {
  parseRunFormat,
  parseParagraphFormat,
  runFormatToStyle,
  groupRevisions,
  countRevisions,
  commentList,
  anchoredCommentIds,
  documentPlainText,
  snippet,
  runsText,
  authorColor,
} from '@/platform/utils/docx-dom';
import type { DocumentJson } from '@/platform/types/docx';

describe('parseRunFormat', () => {
  it('returns empty object for undefined / empty properties', () => {
    expect(parseRunFormat(undefined)).toEqual({});
    expect(parseRunFormat('')).toEqual({});
    expect(parseRunFormat('<w:rPr></w:rPr>')).toEqual({});
  });

  it('parses bold/italic toggles (present = on)', () => {
    const fmt = parseRunFormat('<w:rPr><w:b/><w:i/></w:rPr>');
    expect(fmt.bold).toBe(true);
    expect(fmt.italic).toBe(true);
  });

  it('honors explicit val="0" as off', () => {
    const fmt = parseRunFormat('<w:rPr><w:b w:val="0"/></w:rPr>');
    expect(fmt.bold).toBe(false);
  });

  it('parses underline unless val="none"', () => {
    expect(parseRunFormat('<w:rPr><w:u w:val="single"/></w:rPr>').underline).toBe(
      true,
    );
    expect(parseRunFormat('<w:rPr><w:u w:val="none"/></w:rPr>').underline).toBe(
      false,
    );
  });

  it('parses strike', () => {
    expect(parseRunFormat('<w:rPr><w:strike/></w:rPr>').strike).toBe(true);
  });

  it('converts w:sz half-points to points', () => {
    expect(parseRunFormat('<w:rPr><w:sz w:val="24"/></w:rPr>').fontSizePt).toBe(
      12,
    );
    expect(parseRunFormat('<w:rPr><w:sz w:val="28"/></w:rPr>').fontSizePt).toBe(
      14,
    );
  });

  it('parses hex color with a leading # and skips auto', () => {
    expect(parseRunFormat('<w:rPr><w:color w:val="1A2B3C"/></w:rPr>').color).toBe(
      '#1A2B3C',
    );
    expect(
      parseRunFormat('<w:rPr><w:color w:val="auto"/></w:rPr>').color,
    ).toBeUndefined();
  });

  it('parses highlight color name', () => {
    expect(
      parseRunFormat('<w:rPr><w:highlight w:val="yellow"/></w:rPr>').highlight,
    ).toBe('yellow');
  });

  it('accepts non-w prefixes and is forgiving of malformed input', () => {
    expect(parseRunFormat('<x:rPr><x:b/></x:rPr>').bold).toBe(true);
    // Garbage in => no throw, empty out.
    expect(() => parseRunFormat('<<<not xml>>>')).not.toThrow();
  });
});

describe('runFormatToStyle', () => {
  it('maps parsed format to CSS + decoration flags', () => {
    const out = runFormatToStyle({
      bold: true,
      italic: true,
      underline: true,
      strike: true,
      fontSizePt: 12,
      color: '#112233',
      highlight: 'yellow',
    });
    expect(out.style.fontWeight).toBe(700);
    expect(out.style.fontStyle).toBe('italic');
    expect(out.style.fontSize).toBe('12pt');
    expect(out.style.color).toBe('#112233');
    expect(out.style.backgroundColor).toBeTruthy();
    expect(out.underline).toBe(true);
    expect(out.strike).toBe(true);
  });
});

describe('parseParagraphFormat', () => {
  it('parses heading level from pStyle (various spellings)', () => {
    expect(
      parseParagraphFormat('<w:pPr><w:pStyle w:val="Heading1"/></w:pPr>')
        .headingLevel,
    ).toBe(1);
    expect(
      parseParagraphFormat('<w:pPr><w:pStyle w:val="Heading 3"/></w:pPr>')
        .headingLevel,
    ).toBe(3);
  });

  it('ignores non-heading styles', () => {
    expect(
      parseParagraphFormat('<w:pPr><w:pStyle w:val="BodyText"/></w:pPr>')
        .headingLevel,
    ).toBeUndefined();
  });

  it('parses alignment from jc', () => {
    expect(
      parseParagraphFormat('<w:pPr><w:jc w:val="center"/></w:pPr>').alignment,
    ).toBe('center');
    expect(
      parseParagraphFormat('<w:pPr><w:jc w:val="both"/></w:pPr>').alignment,
    ).toBe('justify');
    expect(
      parseParagraphFormat('<w:pPr><w:jc w:val="end"/></w:pPr>').alignment,
    ).toBe('right');
  });
});

// A small but representative document with two revisions (one split across two
// w:ins with the same id), a comment + its anchor, and a raw block.
function sampleDoc(): DocumentJson {
  return {
    formatVersion: 1,
    body: [
      {
        kind: 'paragraph',
        inlines: [
          { kind: 'run', text: 'Hello ' },
          {
            kind: 'insertion',
            meta: { id: '10', author: 'Alice', date: '2026-01-02T10:00:00Z' },
            runs: [{ text: 'brave ' }],
          },
          {
            kind: 'insertion',
            meta: { id: '10', author: 'Alice', date: '2026-01-02T10:00:00Z' },
            runs: [{ text: 'new ' }],
          },
          { kind: 'run', text: 'world.' },
        ],
      },
      {
        kind: 'paragraph',
        inlines: [
          { kind: 'commentRangeStart', id: '5' },
          { kind: 'run', text: 'Commented text' },
          { kind: 'commentRangeEnd', id: '5' },
          { kind: 'commentReference', id: '5' },
          {
            kind: 'deletion',
            meta: { id: '11', author: 'Bob', date: '2026-01-03T08:30:00Z' },
            runs: [{ text: 'remove me' }],
          },
        ],
      },
      { kind: 'raw', xml: '<w:tbl><w:tr><w:tc/></w:tr></w:tbl>' },
    ],
    comments: {
      '5': {
        id: '5',
        author: 'Carol',
        date: '2026-01-04T12:00:00Z',
        text: 'Please clarify.',
        initials: 'CW',
      },
    },
  };
}

describe('groupRevisions', () => {
  it('groups same-id insertions and concatenates their text', () => {
    const revs = groupRevisions(sampleDoc());
    expect(revs).toHaveLength(2);

    const ins = revs.find((r) => r.id === '10')!;
    expect(ins.kind).toBe('insertion');
    expect(ins.author).toBe('Alice');
    expect(ins.text).toBe('brave new '); // both runs concatenated
    expect(ins.blockIndex).toBe(0);

    const del = revs.find((r) => r.id === '11')!;
    expect(del.kind).toBe('deletion');
    expect(del.author).toBe('Bob');
    expect(del.text).toBe('remove me');
    expect(del.blockIndex).toBe(1);
  });

  it('counts distinct revisions', () => {
    expect(countRevisions(sampleDoc())).toBe(2);
  });

  it('returns 0 for a document with no tracked changes', () => {
    const doc: DocumentJson = {
      formatVersion: 1,
      body: [{ kind: 'paragraph', inlines: [{ kind: 'run', text: 'plain' }] }],
      comments: {},
    };
    expect(countRevisions(doc)).toBe(0);
  });

  // CLUSTER-C3 P2 (Codex review): a document whose ONLY tracked changes live
  // inside a table (a raw, unparsed block) must not report 0 — that would
  // disable the Accept All / Reject All buttons even though the engine can
  // now genuinely resolve tracked changes inside tables too.
  it('counts a raw block containing tracked-change markup so bulk actions stay enabled', () => {
    const doc: DocumentJson = {
      formatVersion: 1,
      body: [
        { kind: 'paragraph', inlines: [{ kind: 'run', text: 'plain' }] },
        {
          kind: 'raw',
          xml: '<w:tbl><w:tr><w:tc><w:p><w:del w:id="1" w:author="A" w:date="d"><w:r><w:delText>x</w:delText></w:r></w:del></w:p></w:tc></w:tr></w:tbl>',
        },
      ],
      comments: {},
    };
    expect(countRevisions(doc)).toBeGreaterThan(0);
  });

  it('returns 0 for a raw block with no tracked-change markup (e.g. a plain table)', () => {
    const doc: DocumentJson = {
      formatVersion: 1,
      body: [{ kind: 'raw', xml: '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>plain cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl>' }],
      comments: {},
    };
    expect(countRevisions(doc)).toBe(0);
  });
});

describe('comments', () => {
  it('lists comments and detects anchored ids', () => {
    const doc = sampleDoc();
    const list = commentList(doc);
    expect(list).toHaveLength(1);
    expect(list[0]!.author).toBe('Carol');

    const anchored = anchoredCommentIds(doc);
    expect(anchored.has('5')).toBe(true);
    expect(anchored.has('999')).toBe(false);
  });
});

describe('text helpers', () => {
  it('runsText concatenates', () => {
    expect(runsText([{ text: 'a' }, { text: 'b' }])).toBe('ab');
  });

  it('documentPlainText joins paragraphs and skips raw blocks', () => {
    const text = documentPlainText(sampleDoc());
    // Insertions are included in plain text; raw block contributes nothing.
    expect(text).toContain('Hello brave new world.');
    expect(text).toContain('Commented text');
    expect(text).not.toContain('<w:tbl>');
  });

  it('snippet collapses whitespace and caps length', () => {
    expect(snippet('  a   b  ')).toBe('a b');
    const long = 'x'.repeat(200);
    const s = snippet(long, 80);
    expect(s.length).toBe(80);
    expect(s.endsWith('…')).toBe(true);
  });
});

describe('authorColor', () => {
  it('is stable per author and within the palette', () => {
    const a1 = authorColor('Alice');
    const a2 = authorColor('Alice');
    expect(a1).toBe(a2);
    expect(a1).toMatch(/^#[0-9a-f]{6}$/i);
  });
});
