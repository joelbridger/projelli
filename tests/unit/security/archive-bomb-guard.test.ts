// R-17 — the archive-reading set, and the two strengths of guard it gets.
//
// The finding said "the JSZip renderer paths lack the zip-bomb guard the
// native path has". Deriving the set showed JSZip was two of seven readers:
// SheetJS, mammoth and docx-preview also unzip, inside libraries where the
// word "zip" never appears at the call site.

import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';

import {
  ArchiveBudgetError,
  MAX_ARCHIVE_BYTES,
  MAX_ENTRY_COUNT,
  assertArchiveWithinBudget,
  assertInputBytesWithinCap,
  looksLikeZip,
  readGuardedZip,
} from '@/platform/archive/safeZip';

/** Incompressible bytes, so a fixture can be BIG without looking like a bomb
 *  to the declared-ratio pre-flight. That separation matters: the pre-flight
 *  and the metered read are different guards and each needs a fixture that
 *  reaches it. */
function incompressible(size: number): Uint8Array {
  const out = new Uint8Array(size);
  let x = 0x12345678;
  for (let i = 0; i < size; i++) {
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
    out[i] = x & 0xff;
  }
  return out;
}

async function zipWith(files: Record<string, string | Uint8Array>): Promise<Uint8Array> {
  const zip = new JSZip();
  for (const [name, body] of Object.entries(files)) zip.file(name, body);
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

describe('safeZip — pre-flight (for bytes a third-party unzipper receives)', () => {
  it('accepts an ordinary small archive', async () => {
    const bytes = await zipWith({ 'word/document.xml': '<w:document/>' });
    await expect(assertArchiveWithinBudget(bytes)).resolves.toBeUndefined();
  });

  // FLIP: delete the MAX_ENTRY_COUNT check.
  it('refuses an archive with too many entries', async () => {
    const files: Record<string, string> = {};
    for (let i = 0; i <= MAX_ENTRY_COUNT; i++) files[`e${i}.txt`] = 'x';
    const bytes = await zipWith(files);
    await expect(assertArchiveWithinBudget(bytes)).rejects.toThrow(ArchiveBudgetError);
  }, 60_000);

  // FLIP: delete the MAX_DECLARED_RATIO check. This is the classic bomb
  // shape — a few KiB of input that admits to expanding enormously.
  it('refuses an absurd declared expansion ratio', async () => {
    const bytes = await zipWith({ 'bomb.bin': new Uint8Array(8 * 1024 * 1024) });
    await expect(assertArchiveWithinBudget(bytes)).rejects.toThrow(/ratio/);
  }, 60_000);

  it('refuses bytes that are not an archive at all', async () => {
    await expect(assertArchiveWithinBudget(new Uint8Array([1, 2, 3, 4]))).rejects.toThrow(
      ArchiveBudgetError,
    );
  });

  it('refuses an empty file', async () => {
    await expect(assertArchiveWithinBudget(new Uint8Array(0))).rejects.toThrow(/empty/);
  });
});

describe('safeZip — size cap for formats that are not zips', () => {
  it('bounds what we will read even with no central directory to inspect', () => {
    expect(assertInputBytesWithinCap(new Uint8Array(16))).toBe(16);
    expect(() => assertInputBytesWithinCap(new Uint8Array(0))).toThrow(/empty/);
  });

  it('knows a zip from a BIFF .xls by its signature', async () => {
    expect(looksLikeZip(await zipWith({ 'a.txt': 'x' }))).toBe(true);
    // Legacy .xls starts with the OLE2 compound-file signature.
    expect(looksLikeZip(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0]))).toBe(false);
  });

  it('has a cap that is actually a number, not Infinity', () => {
    expect(Number.isFinite(MAX_ARCHIVE_BYTES)).toBe(true);
  });
});

describe('safeZip — metered read (for entries WE decompress)', () => {
  it('reads a normal entry', async () => {
    const zip = await readGuardedZip(await zipWith({ 'a.txt': 'hello' }));
    expect(await zip.text('a.txt')).toBe('hello');
    expect(zip.names()).toEqual(['a.txt']);
    expect(zip.has('a.txt')).toBe(true);
    expect(await zip.text('missing.txt')).toBeNull();
  });

  // THE PROPERTY THAT MATTERS: the budget is enforced against ACTUAL
  // decompressed bytes as they arrive, so a lying header buys nothing.
  //
  // FLIP: replace meteredRead's stream loop with `entry.async('uint8array')`
  // — that materialises the whole entry before any counting can happen, and
  // this test then either passes for the wrong reason or OOMs.
  it('aborts a read that exceeds its budget mid-stream', async () => {
    // Deliberately NOT a bomb by declaration — it must survive the pre-flight
    // so the METERED read is what stops it. A fixture that trips the earlier
    // guard would let this test pass while proving nothing about the meter.
    const bytes = await zipWith({ 'big.bin': incompressible(256 * 1024) });
    const guarded = await readGuardedZip(bytes, 'test', { maxEntryBytes: 1024 });
    await expect(guarded.bytes('big.bin')).rejects.toThrow(/decompression-bomb guard/);
  }, 60_000);

  it('enforces the RUNNING total across entries, not just per entry', async () => {
    const bytes = await zipWith({ 'a.bin': incompressible(2048), 'b.bin': incompressible(2048) });
    const guarded = await readGuardedZip(bytes, 'test', {
      maxEntryBytes: 4096,
      maxTotalBytes: 3000,
    });
    expect((await guarded.bytes('a.bin'))?.byteLength).toBe(2048);
    // The first read consumed 2048 of the 3000-byte budget, so the second
    // cannot complete even though it is under the per-entry cap.
    await expect(guarded.bytes('b.bin')).rejects.toThrow(/decompression-bomb guard/);
  }, 60_000);
});
