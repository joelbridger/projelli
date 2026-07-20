import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import * as XLSX from 'xlsx';

import { Cell } from '@/features/documents/media/SheetGrid';
import { UNTRUSTED_PDFJS_OPTIONS } from '@/lib/pdf-extract';
import { parseSpreadsheet } from '@/platform/utils/spreadsheet-io';

describe('untrusted PDF extraction configuration', () => {
  it('disables PDF.js evaluation at every general extraction load site', () => {
    expect(UNTRUSTED_PDFJS_OPTIONS).toEqual({
      isEvalSupported: false,
      enableXfa: false,
    });

    const source = readFileSync(join(process.cwd(), 'src/lib/pdf-extract.ts'), 'utf8');
    const documentLoads = source.match(/pdfjsLib\.getDocument\s*\(\s*\{/g) ?? [];
    const protectedLoads = source.match(/\.\.\.UNTRUSTED_PDFJS_OPTIONS/g) ?? [];

    expect(documentLoads).toHaveLength(2);
    expect(protectedLoads).toHaveLength(documentLoads.length);
  });
});

describe('SheetJS generated cell HTML residual', () => {
  it('renders an attacker-controlled spreadsheet cell only as React text', async () => {
    const payload = '<img src=x onerror="window.__SHEET_XSS__=1"><script>window.__SHEET_XSS__=2</script>';
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([[payload]]), 'Client import');
    const bytes = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;

    // SheetJS creates its optional HTML representation for this untrusted cell.
    // The production model intentionally keeps only raw/display/formula values.
    const sheetJsWorkbook = XLSX.read(bytes, { type: 'array', cellHTML: true });
    expect(sheetJsWorkbook.Sheets['Client import']?.['A1']?.h).toBeTruthy();

    const model = await parseSpreadsheet(bytes, 'xlsx');
    const cell = model.sheets[0]?.rows[0]?.[0] ?? null;
    expect(cell?.display).toBe(payload);
    expect(cell).not.toHaveProperty('h');

    const { container } = render(
      <Cell
        rowIndex={0}
        colIndex={0}
        width={500}
        height={28}
        cell={cell}
        isMerged={false}
        editable={false}
        isSelected={false}
        isEditing={false}
        editingValue={null}
        onSelect={() => undefined}
        onStartEdit={() => undefined}
        onCommitEdit={() => undefined}
        onCancelEdit={() => undefined}
      />
    );

    expect(screen.getByTestId('spreadsheet-cell-0-0')).toHaveTextContent(payload);
    expect(container.querySelector('img, script')).toBeNull();
  });
});

describe('office archive path handling', () => {
  it('sanitizes traversal entry names before an office parser can select them', async () => {
    const crafted = new JSZip();
    crafted.file('../../etc/passwd', 'sentinel');
    crafted.file('ppt/slides/slide1.xml', '<a:t>expected</a:t>');

    const bytes = await crafted.generateAsync({ type: 'uint8array' });
    const loaded = await JSZip.loadAsync(bytes);

    expect(loaded.file('../../etc/passwd')).toBeNull();
    expect(loaded.file('etc/passwd')?.unsafeOriginalName).toBe('../../etc/passwd');
    expect(loaded.file('ppt/slides/slide1.xml')).not.toBeNull();
  });
});
