/**
 * UX-35: DOCX round-trip -- serialize, encode as data URL, decode, reparse.
 *
 * The root cause of the corruption was that the save path used writeFile
 * (text) instead of writeFileBinary for binary format tabs whose content is
 * a data URL. This test verifies the docx-io utility layer itself is
 * lossless: serializeDocx, docxBytesToDataUrl, dataUrlToArrayBuffer produce
 * bytes that JSZip (and therefore any downstream consumer) accepts.
 *
 * We intentionally skip mammoth re-extraction here because mammoth's Node
 * entry point expects `{ buffer }` while the browser build expects
 * `{ arrayBuffer }`, and jsdom mixes the two.
 */

import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import {
  serializeDocx,
  docxBytesToDataUrl,
} from '../../src/platform/utils/docx-io';
import { dataUrlToArrayBuffer } from '../../src/platform/utils/spreadsheet-io';

describe('DOCX round-trip (UX-35)', () => {
  it('produces byte-identical bytes after data URL encode then decode', async () => {
    const html = '<h1>Hello</h1><p>This is a <strong>bold</strong> test.</p>';
    const bytes = await serializeDocx(html, 'test.docx');

    // Sanity: the raw bytes start with the PK zip magic number.
    expect(bytes[0]).toBe(0x50); // 'P'
    expect(bytes[1]).toBe(0x4b); // 'K'
    expect(bytes.length).toBeGreaterThan(100);

    // Encode to data URL (mimics DocxEditor -> tab.content)
    const dataUrl = docxBytesToDataUrl(bytes);
    expect(
      dataUrl.startsWith(
        'data:application/vnd.openxmlformats-officedocument.wordprocessingml.document;base64,'
      )
    ).toBe(true);

    // Decode back (mimics the fixed save path: dataUrlToArrayBuffer)
    const decoded = new Uint8Array(dataUrlToArrayBuffer(dataUrl));
    expect(decoded.length).toBe(bytes.length);
    for (let i = 0; i < bytes.length; i++) {
      expect(decoded[i]).toBe(bytes[i]);
    }
  });

  it('re-serialized bytes are a valid zip with expected OOXML parts', async () => {
    const bytes = await serializeDocx('<p>Round trip check</p>', 'rt.docx');
    const dataUrl = docxBytesToDataUrl(bytes);
    const decoded = dataUrlToArrayBuffer(dataUrl);

    // JSZip.loadAsync will throw if the bytes aren't a valid zip.
    const zip = await JSZip.loadAsync(decoded);
    // A valid .docx contains [Content_Types].xml and at least one slide or
    // document part.
    expect(zip.file('[Content_Types].xml')).toBeTruthy();
  });
});
