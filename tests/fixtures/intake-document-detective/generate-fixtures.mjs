import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const fixtureDirectory = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(
  readFileSync(join(fixtureDirectory, 'manifest.json'), 'utf8')
);
const checkOnly = process.argv.includes('--check');

function escapePdfText(value) {
  return value.replace(/([\\()])/gu, '\\$1');
}

function buildPdf(pages) {
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>'];
  const pageObjectIds = pages.map((_, index) => 3 + index * 2);
  objects.push(
    `<< /Type /Pages /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`
  );

  for (let index = 0; index < pages.length; index += 1) {
    const contentObjectId = 4 + index * 2;
    const lines = pages[index].text.split('\n');
    const content = [
      'BT',
      '/F1 11 Tf',
      '72 720 Td',
      ...lines.flatMap((line, lineIndex) => [
        ...(lineIndex === 0 ? [] : ['0 -18 Td']),
        `(${escapePdfText(line)}) Tj`,
      ]),
      'ET',
    ].join('\n');
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >> /Contents ${contentObjectId} 0 R >>`
    );
    objects.push(
      `<< /Length ${Buffer.byteLength(content, 'utf8')} >>\nstream\n${content}\nendstream`
    );
  }

  let pdf = '%PDF-1.4\n% synthetic intake fixture\n';
  const offsets = [0];
  for (let index = 0; index < objects.length; index += 1) {
    offsets.push(Buffer.byteLength(pdf, 'utf8'));
    pdf += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(pdf, 'utf8');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
    .join('');
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf, 'utf8');
}

let mismatches = 0;
for (const fixture of manifest.fixtures) {
  const path = join(fixtureDirectory, fixture.file);
  const bytes = buildPdf(fixture.pages);
  if (checkOnly) {
    try {
      if (!readFileSync(path).equals(bytes)) mismatches += 1;
    } catch {
      mismatches += 1;
    }
    continue;
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, bytes);
}

if (checkOnly && mismatches > 0) {
  throw new Error(
    `${mismatches} generated fixture file(s) are stale. Run node tests/fixtures/intake-document-detective/generate-fixtures.mjs.`
  );
}
