// Generate test fixture documents (.xlsx, .csv, .docx) for the document-viewer
// Playwright suite. Re-run any time the suite needs fresh fixtures:
//   node tests/fixtures/generate.mjs

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import * as XLSX from 'xlsx';
import {
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  TextRun,
} from 'docx';

const here = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// .xlsx — 2 sheets, with a merged title row on Sheet 1
// ---------------------------------------------------------------------------

function buildXlsx() {
  const wb = XLSX.utils.book_new();

  // Sheet 1: "Revenue" — merged title row at A1:C1, then header, then data
  const aoa = [
    ['Q1 2026 Revenue', null, null], // row 1 (will be merged across A:C)
    ['Month', 'Revenue', 'Formula'],   // row 2 (header)
    ['Jan', 10000, null],              // row 3
    ['Feb', 11000, null],              // row 4
    ['Mar', 12100, null],              // row 5
  ];
  const ws1 = XLSX.utils.aoa_to_sheet(aoa);

  // Attach formulas in column C (rows 3-5 = sheet rows 3,4,5; 0-indexed = 2,3,4)
  ws1['C3'] = { t: 'n', v: 11000, f: 'B3*1.1' };
  ws1['C4'] = { t: 'n', v: 12100, f: 'B4*1.1' };
  ws1['C5'] = { t: 'n', v: 13310, f: 'B5*1.1' };

  // Merge A1:C1 as the title row
  ws1['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 2 } }];

  XLSX.utils.book_append_sheet(wb, ws1, 'Revenue');

  // Sheet 2: "Notes"
  const ws2 = XLSX.utils.aoa_to_sheet([['Q1 numbers are preliminary']]);
  XLSX.utils.book_append_sheet(wb, ws2, 'Notes');

  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' });
  writeFileSync(join(here, 'test.xlsx'), buf);
}

// ---------------------------------------------------------------------------
// .csv — sign-ups by week
// ---------------------------------------------------------------------------

function buildCsv() {
  const rows = [
    ['Week', 'Sign-ups', 'Active Users', 'Revenue'],
    ['2026-W01', '12', '8', '49'],
    ['2026-W02', '34', '21', '147'],
    ['2026-W03', '78', '52', '343'],
    ['2026-W04', '156', '110', '637'],
    ['2026-W05', '301', '224', '1225'],
  ];
  const csv = rows.map((r) => r.join(',')).join('\n') + '\n';
  writeFileSync(join(here, 'test.csv'), csv);
}

// ---------------------------------------------------------------------------
// .docx — 2 headings, paragraph, two bulleted lists
// ---------------------------------------------------------------------------

async function buildDocx() {
  const doc = new Document({
    sections: [
      {
        properties: {},
        children: [
          new Paragraph({
            text: 'Investor Update — January',
            heading: HeadingLevel.HEADING_1,
          }),
          new Paragraph({
            children: [
              new TextRun(
                'Strong start to the year. Sign-ups are up 25x week over week and the team shipped two new viewers.'
              ),
            ],
          }),
          new Paragraph({
            text: 'Closed three pilot customers',
            bullet: { level: 0 },
          }),
          new Paragraph({
            text: 'Hired a contract designer for marketing',
            bullet: { level: 0 },
          }),
          new Paragraph({
            text: 'Shipped the document-viewer phase 1',
            bullet: { level: 0 },
          }),
          new Paragraph({
            text: 'Next Steps',
            heading: HeadingLevel.HEADING_1,
          }),
          new Paragraph({
            text: 'Lock in two more pilots by end of February',
            bullet: { level: 0 },
          }),
          new Paragraph({
            text: 'Publish the public docs site',
            bullet: { level: 0 },
          }),
        ],
      },
    ],
  });

  const buf = await Packer.toBuffer(doc);
  writeFileSync(join(here, 'test.docx'), buf);
}

// ---------------------------------------------------------------------------

buildXlsx();
buildCsv();
await buildDocx();

console.log('Wrote test.xlsx, test.csv, test.docx to', here);
