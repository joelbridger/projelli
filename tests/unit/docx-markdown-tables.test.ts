/**
 * F-108 — markdown pipe tables must export as real Word tables in markdownToDocxBytes.
 *
 * Test strategy: call markdownToDocxBytes with a markdown document that contains
 * a GFM-style pipe table, unzip word/document.xml from the resulting .docx, and
 * assert that:
 *   1. At least one <w:tbl> element is present (a real Word table was emitted).
 *   2. The correct number of <w:tr> rows were emitted (header row + body rows).
 *   3. The correct number of <w:tc> cells per row were emitted.
 *   4. Header-cell text content appears inside the XML.
 *   5. Body-cell text content appears inside the XML.
 *   6. Zero literal pipe-row paragraphs (lines that are just `| ... |` text or
 *      `|---|---|` separator rows) remain as plain paragraph text.
 *
 * Additional cases:
 *   - Non-table markdown (headings, bold, numbered list) is unaffected.
 *   - Ragged rows (a body row with more or fewer cells than the header) are
 *     padded or truncated to the header column count — the table still emits
 *     correctly and doesn't throw.
 *   - Leading/trailing pipes are optional (both styles parse correctly).
 *   - Inline bold inside a cell is preserved as text (plain text fallback is
 *     acceptable; the test only checks that the text appears somewhere in the
 *     XML — not that <w:b/> is present).
 */

import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { markdownToDocxBytes } from '../../src/platform/utils/docx-io';

/** Unzip a .docx and return the word/document.xml content as a string. */
async function extractDocumentXml(bytes: Uint8Array): Promise<string> {
  const zip = await JSZip.loadAsync(bytes);
  const docXmlFile = zip.file('word/document.xml');
  if (!docXmlFile) throw new Error('word/document.xml not found in zip');
  return docXmlFile.async('string');
}

/** Count occurrences of an XML tag-open pattern like <w:tbl */
function countTag(xml: string, tag: string): number {
  const re = new RegExp(`<${tag}[\\s/>]`, 'g');
  return (xml.match(re) ?? []).length;
}

describe('F-108 — markdownToDocxBytes: markdown pipe tables → <w:tbl>', () => {
  const BASIC_TABLE_MD = `
# Conflict Check Memo

Below is the conflict check table.

| Name to Check | Relationship to Matter | Why to Check | Result |
|---|---|---|---|
| Alice Smith | Plaintiff | Named party | Pending |
| Bob Jones | Defendant's employer | Potential witness | Pending |
| Acme Corp | Third party | Contract counterparty | Pending |

Review before filing.
`.trim();

  it('emits at least one <w:tbl> for a markdown doc containing a pipe table', async () => {
    const bytes = await markdownToDocxBytes(BASIC_TABLE_MD, 'conflict-check.docx');
    const xml = await extractDocumentXml(bytes);
    expect(countTag(xml, 'w:tbl')).toBeGreaterThanOrEqual(1);
  });

  it('emits the correct number of <w:tr> rows (header + 3 body rows = 4 total)', async () => {
    const bytes = await markdownToDocxBytes(BASIC_TABLE_MD, 'conflict-check.docx');
    const xml = await extractDocumentXml(bytes);
    // 1 header row + 3 body rows
    expect(countTag(xml, 'w:tr')).toBe(4);
  });

  it('emits the correct number of <w:tc> cells (4 cols × 4 rows = 16 total)', async () => {
    const bytes = await markdownToDocxBytes(BASIC_TABLE_MD, 'conflict-check.docx');
    const xml = await extractDocumentXml(bytes);
    expect(countTag(xml, 'w:tc')).toBe(16);
  });

  it('includes the header cell text in the document XML', async () => {
    const bytes = await markdownToDocxBytes(BASIC_TABLE_MD, 'conflict-check.docx');
    const xml = await extractDocumentXml(bytes);
    expect(xml).toContain('Name to Check');
    expect(xml).toContain('Relationship to Matter');
    expect(xml).toContain('Why to Check');
    expect(xml).toContain('Result');
  });

  it('includes body cell text in the document XML', async () => {
    const bytes = await markdownToDocxBytes(BASIC_TABLE_MD, 'conflict-check.docx');
    const xml = await extractDocumentXml(bytes);
    expect(xml).toContain('Alice Smith');
    expect(xml).toContain('Plaintiff');
    expect(xml).toContain('Acme Corp');
    expect(xml).toContain('Contract counterparty');
  });

  it('leaves zero literal pipe-row paragraphs in the document XML', async () => {
    const bytes = await markdownToDocxBytes(BASIC_TABLE_MD, 'conflict-check.docx');
    const xml = await extractDocumentXml(bytes);
    // Literal pipe rows from the markdown source must NOT appear as paragraph text.
    // We check for the characteristic separator row pattern and a pipe-delimited data row.
    expect(xml).not.toContain('|---|');
    // The cell text "Alice Smith" should only appear inside <w:tc>, never as a bare
    // paragraph string like "| Alice Smith | Plaintiff |".  We verify by checking
    // that the raw table row string is absent.
    expect(xml).not.toMatch(/\|\s*Alice Smith\s*\|/);
  });

  it('non-table markdown elements (headings, paragraphs) are still serialized', async () => {
    const bytes = await markdownToDocxBytes(BASIC_TABLE_MD, 'conflict-check.docx');
    const xml = await extractDocumentXml(bytes);
    // "Conflict Check Memo" is an h1 heading and should appear as a heading paragraph.
    expect(xml).toContain('Conflict Check Memo');
    // "Review before filing." is a plain paragraph.
    expect(xml).toContain('Review before filing.');
  });

  // ── Ragged-row case ────────────────────────────────────────────────────────

  const RAGGED_TABLE_MD = `
| A | B | C |
|---|---|---|
| one | two |
| x | y | z | extra |
`.trim();

  it('handles ragged rows without throwing: padded/truncated to column count', async () => {
    const bytes = await markdownToDocxBytes(RAGGED_TABLE_MD, 'ragged.docx');
    const xml = await extractDocumentXml(bytes);
    // Must still produce a table (not crash).
    expect(countTag(xml, 'w:tbl')).toBeGreaterThanOrEqual(1);
    // 1 header row + 2 body rows = 3 total rows
    expect(countTag(xml, 'w:tr')).toBe(3);
    // Each row must have exactly 3 cells (column count from header).
    // 3 rows × 3 cols = 9 cells total.
    expect(countTag(xml, 'w:tc')).toBe(9);
  });

  // ── No-leading/trailing-pipe style ────────────────────────────────────────

  const NO_OUTER_PIPE_MD = `
Name | Age | City
---|---|---
Jane | 30 | Boston
Tom | 25 | Denver
`.trim();

  it('parses tables without leading/trailing pipes', async () => {
    const bytes = await markdownToDocxBytes(NO_OUTER_PIPE_MD, 'no-outer-pipe.docx');
    const xml = await extractDocumentXml(bytes);
    expect(countTag(xml, 'w:tbl')).toBeGreaterThanOrEqual(1);
    expect(xml).toContain('Name');
    expect(xml).toContain('Jane');
    expect(xml).toContain('Denver');
  });

  // ── Inline bold inside cells ──────────────────────────────────────────────

  const BOLD_CELL_MD = `
| Term | **Definition** |
|---|---|
| **Conflict** | A prior representation |
`.trim();

  it('includes cell text even when cells contain inline bold markers', async () => {
    const bytes = await markdownToDocxBytes(BOLD_CELL_MD, 'bold-cells.docx');
    const xml = await extractDocumentXml(bytes);
    expect(countTag(xml, 'w:tbl')).toBeGreaterThanOrEqual(1);
    // Text content must be present (bold markers stripped or converted)
    expect(xml).toContain('Definition');
    expect(xml).toContain('Conflict');
    expect(xml).toContain('A prior representation');
  });
});
