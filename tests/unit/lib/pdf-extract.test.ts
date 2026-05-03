/**
 * Stream A2 - Unit tests for extractPdfText.
 *
 * Fixture PDFs are embedded as base64 strings in this file so no
 * external fixture files are required for the unit test suite.
 *
 * Fixtures used:
 *   SIMPLE_PDF_B64  - minimal valid 1-page PDF with "Hello world" text.
 *   ENCRYPTED_PDF_B64 - minimal valid PDF encrypted with an owner password.
 *   SCANNED_PDF_B64 - valid 1-page PDF containing only a drawn rectangle
 *                     (no text layer; extraction returns near-empty).
 *
 * Generated 2026-04-28 using fpdf2 (SIMPLE/SCANNED) and pikepdf (ENCRYPTED).
 */

import { describe, it, expect } from 'vitest';
import { extractPdfText } from '@/lib/pdf-extract';

// 1-page PDF containing text:
// "Hello world this is a simple test PDF for Projelli A2 stream testing extraction capabilities"
// Generated via fpdf2 with Helvetica font.
const SIMPLE_PDF_B64 =
  'JVBERi0xLjMKJenr8b8KMSAwIG9iago8PAovQ291bnQgMQovS2lkcyBbMyAwIFJdCi9NZWRpYUJveCBbMCAwIDU5NS4yOCA4NDEuODldCi9UeXBlIC9QYWdlcwo+PgplbmRvYmoKMiAwIG9iago8PAovT3BlbkFjdGlvbiBbMyAwIFIgL0ZpdEggbnVsbF0KL1BhZ2VMYXlvdXQgL09uZUNvbHVtbgovUGFnZXMgMSAwIFIKL1R5cGUgL0NhdGFsb2cKPj4KZW5kb2JqCjMgMCBvYmoKPDwKL0NvbnRlbnRzIDQgMCBSCi9QYXJlbnQgMSAwIFIKL1Jlc291cmNlcyA2IDAgUgovVHlwZSAvUGFnZQo+PgplbmRvYmoKNCAwIG9iago8PAovRmlsdGVyIC9GbGF0ZURlY29kZQovTGVuZ3RoIDE3OAo+PgpzdHJlYW0KeJxVjbFuAjEQRHu+YkpojH0BDE2kRAQhKqT4B8zdXlhkvMheBJ/PgUQRaaqZ0XsNdiNr5h630XfAdOPgGmMtQo+f8Kw+nHFL+NXceI/QYbyllAQ3KamDHrliSETl8yURlKpiv96gl4J9kdNwZnw1qFoonl875z/QXUtslSWjjZd44MTKVCcIp//ehTez5uX9pVZyh8SZIP1AuitUQLleyyAWjQntMZaKTzhr36gHsMpD5wplbmRzdHJlYW0KZW5kb2JqCjUgMCBvYmoKPDwKL0Jhc2VGb250IC9IZWx2ZXRpY2EKL0VuY29kaW5nIC9XaW5BbnNpRW5jb2RpbmcKL1N1YnR5cGUgL1R5cGUxCi9UeXBlIC9Gb250Cj4+CmVuZG9iago2IDAgb2JqCjw8Ci9Gb250IDw8L0YxIDUgMCBSPj4KL1Byb2NTZXQgWy9QREYgL1RleHQgL0ltYWdlQiAvSW1hZ2VDIC9JbWFnZUldCj4+CmVuZG9iago3IDAgb2JqCjw8Ci9DcmVhdGlvbkRhdGUgKEQ6MjAyNjA0MjkwMDM1NDVaKQo+PgplbmRvYmoKeHJlZgowIDgKMDAwMDAwMDAwMCA2NTUzNSBmIAowMDAwMDAwMDE1IDAwMDAwIG4gCjAwMDAwMDAxMDIgMDAwMDAgbiAKMDAwMDAwMDIwNSAwMDAwMCBuIAowMDAwMDAwMjg1IDAwMDAwIG4gCjAwMDAwMDA1MzUgMDAwMDAgbiAKMDAwMDAwMDYzMiAwMDAwMCBuIAowMDAwMDAwNzE5IDAwMDAwIG4gCnRyYWlsZXIKPDwKL1NpemUgOAovUm9vdCAyIDAgUgovSW5mbyA3IDAgUgovSUQgWzxFNjREMjZFOTBCRDJDN0VBNzI5QzE2Q0RERTBFREZBND48RTY0RDI2RTkwQkQyQzdFQTcyOUMxNkNEREUwRURGQTQ+XQo+PgpzdGFydHhyZWYKNzc0CiUlRU9GCg==';

// Encrypted PDF (user-password "userpass", owner-password "ownerpass") generated via pikepdf.
// PDF.js will throw PasswordException when attempting to open this without a password.
const ENCRYPTED_PDF_B64 =
  'JVBERi0xLjYKJb/3ov4KMSAwIG9iago8PCAvT3BlbkFjdGlvbiBbIDMgMCBSIC9GaXRIIG51bGwgXSAvUGFnZUxheW91dCAvT25lQ29sdW1uIC9QYWdlcyA0IDAgUiAvVHlwZSAvQ2F0YWxvZyA+PgplbmRvYmoKMiAwIG9iago8PCAvQ3JlYXRpb25EYXRlIDxiZGUzYTY4YmZmZjRkZWFjYWQ1MjA1ZTExZjQ5NGZiYjEwYWNkNDNlNzQ3ZDQyYjQyNDVkMzAwNjJjNDQwN2Q4NjNkMWZmYmMzNTI0ZWY4ZGRkMWU0ZjU3ODRhNzE4ZGE+ID4+CmVuZG9iagozIDAgb2JqCjw8IC9Db250ZW50cyA1IDAgUiAvTWVkaWFCb3ggNiAwIFIgL1BhcmVudCA0IDAgUiAvUmVzb3VyY2VzIDcgMCBSIC9UeXBlIC9QYWdlID4+CmVuZG9iago0IDAgb2JqCjw8IC9Db3VudCAxIC9LaWRzIFsgMyAwIFIgXSAvVHlwZSAvUGFnZXMgPj4KZW5kb2JqCjUgMCBvYmoKPDwgL0ZpbHRlciAvRmxhdGVEZWNvZGUgL0xlbmd0aCAyMDggPj4Kc3RyZWFtCjB5kz1QAWWOX7pkK494xDzSgToaXk7/UofO+B0D/JsmuH/DDg+JSr5i07N4gBuQwEMO31VjUYfqEYrhw/kdPx0MIoCTsIvaUmbtPoJqVOyxPNqKwDwBuhzSXYqnnWb3iLS/57PpaqRTj/XVNQPisrOrA3eY1RiS5U19I/5VLMmVzfyetNRjptsei0wyjcczOTqR0m3S1//KN7y6/NDu9ibYXul/7YxzZKOSxEhtx7e+uG+b5CjNTYMmmfKiDIypBez3wIhj/jenNG1aqyK5IZIKZW5kc3RyZWFtCmVuZG9iago2IDAgb2JqClsgMCAwIDU5NS4yOCA4NDEuODkgXQplbmRvYmoKNyAwIG9iago8PCAvRm9udCA8PCAvRjEgOCAwIFIgPj4gL1Byb2NTZXQgWyAvUERGIC9UZXh0IC9JbWFnZUIgL0ltYWdlQyAvSW1hZ2VJIF0gPj4KZW5kb2JqCjggMCBvYmoKPDwgL0Jhc2VGb250IC9IZWx2ZXRpY2EgL0VuY29kaW5nIC9XaW5BbnNpRW5jb2RpbmcgL1N1YnR5cGUgL1R5cGUxIC9UeXBlIC9Gb250ID4+CmVuZG9iago5IDAgb2JqCjw8IC9DRiA8PCAvU3RkQ0YgPDwgL0F1dGhFdmVudCAvRG9jT3BlbiAvQ0ZNIC9BRVNWMiAvTGVuZ3RoIDE2ID4+ID4+IC9GaWx0ZXIgL1N0YW5kYXJkIC9MZW5ndGggMTI4IC9PIDw2OGU1NzA0YWM3NzlhNWYwY2Q4OTcwNDQwNjU4N2E1MmYyNWJmNjFjYWRjNTZhMGY4ZGI2YzRkYjAwNTI1MzRkPiAvT0UgPD4gL1AgLTEwMjggL1IgNCAvU3RtRiAvU3RkQ0YgL1N0ckYgL1N0ZENGIC9VIDwzMjI5ZmQzNDY2ZWM1NzU5ZjZmMzhjMTQxZTc0Yzk4MDAwMjE0NDY5OTBiOWU0MTE0MDcxYTRkOTEwNDk4NGMxPiAvVUUgPD4gL1YgNCA+PgplbmRvYmoKeHJlZgowIDEwCjAwMDAwMDAwMDAgNjU1MzUgZiAKMDAwMDAwMDAxNSAwMDAwMCBuIAowMDAwMDAwMTIwIDAwMDAwIG4gCjAwMDAwMDAyNTQgMDAwMDAgbiAKMDAwMDAwMDM1MCAwMDAwMCBuIAowMDAwMDAwNDA5IDAwMDAwIG4gCjAwMDAwMDA2ODkgMDAwMDAgbiAKMDAwMDAwMDcyNiAwMDAwMCBuIAowMDAwMDAwODE3IDAwMDAwIG4gCjAwMDAwMDA5MTQgMDAwMDAgbiAKdHJhaWxlciA8PCAvSW5mbyAyIDAgUiAvUm9vdCAxIDAgUiAvU2l6ZSAxMCAvSUQgWzxlNjRkMjZlOTBiZDJjN2VhNzI5YzE2Y2RkZTBlZGZhND48YWRhMTU1ZmNmYzYxYjMwY2Q3MmI3MWJkN2QxOTZiOGY+XSAvRW5jcnlwdCA5IDAgUiA+PgpzdGFydHhyZWYKMTIzMAolJUVPRgo=';

// Scanned PDF: 1-page PDF with no text layer, only a filled rectangle drawn.
// Generated via fpdf2 with no text content (total extracted chars < 100).
const SCANNED_PDF_B64 =
  'JVBERi0xLjMKJenr8b8KMSAwIG9iago8PAovQ291bnQgMQovS2lkcyBbMyAwIFJdCi9NZWRpYUJveCBbMCAwIDU5NS4yOCA4NDEuODldCi9UeXBlIC9QYWdlcwo+PgplbmRvYmoKMiAwIG9iago8PAovT3BlbkFjdGlvbiBbMyAwIFIgL0ZpdEggbnVsbF0KL1BhZ2VMYXlvdXQgL09uZUNvbHVtbgovUGFnZXMgMSAwIFIKL1R5cGUgL0NhdGFsb2cKPj4KZW5kb2JqCjMgMCBvYmoKPDwKL0NvbnRlbnRzIDQgMCBSCi9QYXJlbnQgMSAwIFIKL1Jlc291cmNlcyA1IDAgUgovVHlwZSAvUGFnZQo+PgplbmRvYmoKNCAwIG9iago8PAovRmlsdGVyIC9GbGF0ZURlY29kZQovTGVuZ3RoIDYwCj4+CnN0cmVhbQp4nDNS8OIy0DM1VygHUpYmhkYKqFRROpeRhZ6xqYKFobGeqYmCqbGFnqmFgq65mSlItChVIY0LAMd8DZkKZW5kc3RyZWFtCmVuZG9iago1IDAgb2JqCjw8Ci9Qcm9jU2V0IFsvUERGIC9UZXh0IC9JbWFnZUIgL0ltYWdlQyAvSW1hZ2VJXQo+PgplbmRvYmoKNiAwIG9iago8PAovQ3JlYXRpb25EYXRlIChEOjIwMjYwNDI5MDAzNTUzWikKPj4KZW5kb2JqCnhyZWYKMCA3CjAwMDAwMDAwMDAgNjU1MzUgZiAKMDAwMDAwMDAxNSAwMDAwMCBuIAowMDAwMDAwMTAyIDAwMDAwIG4gCjAwMDAwMDAyMDUgMDAwMDAgbiAKMDAwMDAwMDI4NSAwMDAwMCBuIAowMDAwMDAwNDE2IDAwMDAwIG4gCjAwMDAwMDA0ODMgMDAwMDAgbiAKdHJhaWxlcgo8PAovU2l6ZSA3Ci9Sb290IDIgMCBSCi9JbmZvIDYgMCBSCi9JRCBbPEJBQTk5MjI5NDgwNUIwMjlCM0VEREZFQUM4OTBCQkZCPjxCQUE5OTIyOTQ4MDVCMDI5QjNFRERGRUFDODkwQkJGQj5dCj4+CnN0YXJ0eHJlZgo1MzgKJSVFT0YK';

function b64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

describe('extractPdfText - simple PDF', () => {
  it('returns pageCount matching the fixture', async () => {
    const result = await extractPdfText(b64ToBytes(SIMPLE_PDF_B64));
    expect(result.pageCount).toBe(1);
  });

  it('returns one entry in pages array', async () => {
    const result = await extractPdfText(b64ToBytes(SIMPLE_PDF_B64));
    expect(result.pages).toHaveLength(1);
  });

  it('pages[0] contains extracted text', async () => {
    const result = await extractPdfText(b64ToBytes(SIMPLE_PDF_B64));
    // The simple PDF contains text starting with "Hello world"
    expect(result.pages[0].toLowerCase()).toContain('hello world');
  });

  it('encrypted flag is false for plain PDF', async () => {
    const result = await extractPdfText(b64ToBytes(SIMPLE_PDF_B64));
    expect(result.encrypted).toBe(false);
  });

  it('scanned flag is false for text PDF', async () => {
    const result = await extractPdfText(b64ToBytes(SIMPLE_PDF_B64));
    expect(result.scanned).toBe(false);
  });
});

describe('extractPdfText - encrypted PDF', () => {
  it('returns encrypted: true without throwing', async () => {
    const result = await extractPdfText(b64ToBytes(ENCRYPTED_PDF_B64));
    expect(result.encrypted).toBe(true);
  });

  it('returns empty pages array for encrypted PDF', async () => {
    const result = await extractPdfText(b64ToBytes(ENCRYPTED_PDF_B64));
    expect(result.pages).toEqual([]);
  });

  it('returns pageCount of 0 for encrypted PDF', async () => {
    const result = await extractPdfText(b64ToBytes(ENCRYPTED_PDF_B64));
    expect(result.pageCount).toBe(0);
  });
});

describe('extractPdfText - scanned PDF', () => {
  it('returns scanned: true when total text < 100 chars', async () => {
    const result = await extractPdfText(b64ToBytes(SCANNED_PDF_B64));
    expect(result.scanned).toBe(true);
  });

  it('returns pageCount correctly even when scanned', async () => {
    const result = await extractPdfText(b64ToBytes(SCANNED_PDF_B64));
    expect(result.pageCount).toBeGreaterThan(0);
  });
});

describe('extractPdfText - scanned heuristic boundary', () => {
  it('scanned flag is false when total text >= 100 chars', async () => {
    // The simple fixture has > 100 chars of text, so scanned must be false.
    const result = await extractPdfText(b64ToBytes(SIMPLE_PDF_B64));
    const total = result.pages.reduce((s, p) => s + p.length, 0);
    expect(total).toBeGreaterThanOrEqual(100);
    expect(result.scanned).toBe(false);
  });
});
