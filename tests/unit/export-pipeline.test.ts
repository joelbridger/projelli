/**
 * Unit tests for the export pipeline utilities introduced in Workstream C.
 *
 * Covers:
 *   1. availableExportFormats — maps file extension to export format list
 *   2. replaceExtension       — swaps file extension for output naming
 *   3. titleFromFileName      — derives a clean page title from a file name
 */

import { describe, it, expect } from 'vitest';
import { availableExportFormats, replaceExtension } from '../../src/utils/export-formats';
import { titleFromFileName } from '../../src/utils/pdf-export';

// ---------------------------------------------------------------------------
// availableExportFormats
// ---------------------------------------------------------------------------

describe('availableExportFormats', () => {
  const MARKDOWN_FORMATS = ['markdown', 'docx', 'pdf', 'pptx'];

  it('returns all four formats for a .md file', () => {
    const options = availableExportFormats('report.md');
    expect(options.map((o) => o.format)).toEqual(MARKDOWN_FORMATS);
  });

  it('returns all four formats for a .markdown file', () => {
    const options = availableExportFormats('notes.markdown');
    expect(options.map((o) => o.format)).toEqual(MARKDOWN_FORMATS);
  });

  it('returns all four formats for a .txt file', () => {
    const options = availableExportFormats('draft.txt');
    expect(options.map((o) => o.format)).toEqual(MARKDOWN_FORMATS);
  });

  it('returns empty array for .docx (not a markdown source)', () => {
    expect(availableExportFormats('contract.docx')).toHaveLength(0);
  });

  it('returns empty array for .xlsx', () => {
    expect(availableExportFormats('budget.xlsx')).toHaveLength(0);
  });

  it('returns empty array for .pptx', () => {
    expect(availableExportFormats('deck.pptx')).toHaveLength(0);
  });

  it('returns empty array for .pdf', () => {
    expect(availableExportFormats('document.pdf')).toHaveLength(0);
  });

  it('returns empty array for a file with no extension', () => {
    expect(availableExportFormats('README')).toHaveLength(0);
  });

  it('is case-insensitive for .MD', () => {
    const options = availableExportFormats('NOTES.MD');
    expect(options.map((o) => o.format)).toEqual(MARKDOWN_FORMATS);
  });

  it('each returned option has the expected shape', () => {
    const options = availableExportFormats('notes.md');
    for (const option of options) {
      expect(option).toHaveProperty('format');
      expect(option).toHaveProperty('label');
      expect(option).toHaveProperty('extension');
      expect(option).toHaveProperty('mimeType');
      expect(typeof option.label).toBe('string');
      expect(option.label.length).toBeGreaterThan(0);
    }
  });

  it('markdown option has the correct extension and mimeType', () => {
    const [md] = availableExportFormats('notes.md');
    expect(md?.extension).toBe('md');
    expect(md?.mimeType).toBe('text/markdown');
  });

  it('docx option has the correct extension', () => {
    const docx = availableExportFormats('notes.md').find((o) => o.format === 'docx');
    expect(docx?.extension).toBe('docx');
  });

  it('pdf option has the correct mimeType', () => {
    const pdf = availableExportFormats('notes.md').find((o) => o.format === 'pdf');
    expect(pdf?.mimeType).toBe('application/pdf');
  });

  it('pptx option has the correct extension', () => {
    const pptx = availableExportFormats('notes.md').find((o) => o.format === 'pptx');
    expect(pptx?.extension).toBe('pptx');
  });

  it('labels contain no em dashes', () => {
    const options = availableExportFormats('notes.md');
    for (const option of options) {
      expect(option.label).not.toContain('—');
    }
  });
});

// ---------------------------------------------------------------------------
// replaceExtension
// ---------------------------------------------------------------------------

describe('replaceExtension', () => {
  it('replaces an existing extension', () => {
    expect(replaceExtension('report.md', 'docx')).toBe('report.docx');
  });

  it('replaces a different extension', () => {
    expect(replaceExtension('notes.txt', 'pdf')).toBe('notes.pdf');
  });

  it('handles files with multiple dots in the name', () => {
    expect(replaceExtension('my.notes.v2.md', 'docx')).toBe('my.notes.v2.docx');
  });

  it('appends extension when there is no existing extension', () => {
    expect(replaceExtension('README', 'pdf')).toBe('README.pdf');
  });

  it('handles an already-.docx file being renamed to .pdf', () => {
    expect(replaceExtension('document.docx', 'pdf')).toBe('document.pdf');
  });
});

// ---------------------------------------------------------------------------
// titleFromFileName
// ---------------------------------------------------------------------------

describe('titleFromFileName', () => {
  it('strips the file extension', () => {
    expect(titleFromFileName('report.md')).toBe('report');
  });

  it('converts hyphens to spaces', () => {
    expect(titleFromFileName('investor-update-q4.md')).toBe('investor update q4');
  });

  it('converts underscores to spaces', () => {
    expect(titleFromFileName('tax_return_2025.txt')).toBe('tax return 2025');
  });

  it('handles a file with no extension', () => {
    expect(titleFromFileName('README')).toBe('README');
  });

  it('converts mixed hyphens and underscores to spaces', () => {
    // Both - and _ are treated as word separators, so all runs become spaces.
    expect(titleFromFileName('client_brief-final.md')).toBe('client brief final');
  });
});
