/**
 * Task 5 — createBlankDocx contract test.
 *
 * A blank Word document created for "New Document" must produce OOXML that the
 * in-house Rust engine classifies as editable content, not a preserved
 * placeholder.  Specifically word/document.xml must contain:
 *
 *   - Exactly one real <w:p> paragraph element
 *   - No table elements (<w:tbl>)
 *   - No section-properties block (<w:sectPr>) inside <w:body>
 *
 * The absence of a body-level <w:sectPr> is key: the Rust parser captures every
 * non-paragraph block in <w:body> as a BlockContent::Raw, which the editor
 * renders as a read-only "[preserved content]" placeholder.  A sectPr in the
 * body makes the blank doc appear un-editable to the user.
 *
 * Side effect: this test writes the fixture file that the Rust blank_doc test
 * reads, so it must run BEFORE `cargo test -p keepance-docx --test blank_doc`.
 */

import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBlankDocx } from '../../src/utils/docx-io';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = resolve(
  __dirname,
  '../../src-tauri/crates/keepance-docx/tests/fixtures/blank-from-frontend.docx'
);

describe('createBlankDocx', () => {
  it('produces a document.xml with exactly one empty editable paragraph and no body-level sectPr', async () => {
    const bytes = await createBlankDocx();

    // Sanity: ZIP magic bytes.
    expect(bytes[0]).toBe(0x50); // 'P'
    expect(bytes[1]).toBe(0x4b); // 'K'
    expect(bytes.length).toBeGreaterThan(100);

    // Open the zip and read word/document.xml.
    const zip = await JSZip.loadAsync(bytes);
    const docXmlFile = zip.file('word/document.xml');
    expect(docXmlFile).not.toBeNull();
    const docXml = await docXmlFile!.async('string');

    // --- paragraph count ---
    // Match any opening <w:p> tag (both <w:p> and <w:p ... > and <w:p/>).
    // Strip namespace declarations first to simplify the regex.
    const pMatches = docXml.match(/<w:p[\s/>]/g) ?? [];
    expect(pMatches.length).toBe(1);

    // --- no tables ---
    expect(docXml).not.toMatch(/<w:tbl[\s/>]/);

    // --- no body-level sectPr ---
    // The Rust parse.rs captures every non-<w:p> element inside <w:body> as
    // a BlockContent::Raw, which the editor renders as a placeholder.  A
    // minimal blank doc must not contain a <w:sectPr> inside <w:body>.
    //
    // We scan the <w:body> region specifically to avoid false positives from
    // paragraph-level <w:sectPr> inside a <w:pPr> (a different OOXML pattern).
    const bodyMatch = docXml.match(/<w:body>([\s\S]*?)<\/w:body>/);
    const bodyContent = bodyMatch ? bodyMatch[1] : '';
    expect(bodyContent).not.toMatch(/<w:sectPr[\s/>]/);

    // --- write/guard fixture for the Rust blank_doc test ---
    // Bootstrap: if the fixture is missing, write it and let the test pass so
    // `cargo test -p keepance-docx blank_doc` can run immediately after.
    // Guard: if the fixture already exists but its document.xml content differs
    // from the current createBlankDocx output, the committed fixture is stale
    // and the test FAILS — delete the file and re-run this test to regenerate.
    //
    // We compare the PARSED document.xml content (not raw zip bytes) so the
    // check is stable across JS environments: JSZip's CRC32 for stored strings
    // can vary by one byte between Node and jsdom due to internal encoding
    // differences, but the actual file contents are always identical.
    mkdirSync(dirname(FIXTURE_PATH), { recursive: true });
    if (existsSync(FIXTURE_PATH)) {
      const existingBytes = readFileSync(FIXTURE_PATH);
      const existingZip = await JSZip.loadAsync(existingBytes);
      const existingDocXml = await existingZip.file('word/document.xml')!.async('string');

      // The current bytes were already parsed above into `docXml`.
      if (existingDocXml !== docXml) {
        throw new Error(
          'fixture stale: regenerate src-tauri/crates/keepance-docx/tests/fixtures/blank-from-frontend.docx ' +
          'by deleting it and re-running this test'
        );
      }
      // Fixture present and content-identical — nothing to do.
    } else {
      // Bootstrap: fixture missing — write it for the first time.
      writeFileSync(FIXTURE_PATH, Buffer.from(bytes));
    }
  });
});
