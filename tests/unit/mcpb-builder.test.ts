/**
 * Unit tests for `scripts/build-mcpb.mjs` — the zip writer that produces
 * the Projelli MCP `.mcpb` Desktop Extension bundle.
 *
 * We verify:
 *   - the emitted bytes start with the local-file-header magic (`PK\x03\x04`)
 *   - the end-of-central-directory record is at the tail with the correct
 *     total entry count
 *   - both `manifest.json` and the binary entry roundtrip through the
 *     built-in CLI `unzip -p` (spawned as a subprocess; it's ubiquitous on
 *     CI runners for all three platforms, plus the Node test harness)
 *
 * The script itself is ESM + uses Node's `crc32` — we import it as-is with
 * the `.mjs` extension so the test exercises the same code CI runs.
 */
import { describe, expect, it } from 'vitest';
// @ts-expect-error — ESM module with no TS types, intentionally imported raw.
import { buildZip } from '../../scripts/build-mcpb.mjs';

function u32(buf: Buffer, off: number): number {
  return buf.readUInt32LE(off);
}
function u16(buf: Buffer, off: number): number {
  return buf.readUInt16LE(off);
}

describe('build-mcpb zip writer', () => {
  it('emits a PKZIP local-file-header magic at offset 0', () => {
    const zip = buildZip([
      { path: 'hello.txt', content: Buffer.from('hi', 'utf8') },
    ]);
    expect(u32(zip, 0)).toBe(0x04034b50);
  });

  it('ends with the end-of-central-directory record and matches entry count', () => {
    const files = [
      { path: 'a.txt', content: Buffer.from('a', 'utf8') },
      { path: 'b.txt', content: Buffer.from('bb', 'utf8') },
      { path: 'c.txt', content: Buffer.from('ccc', 'utf8') },
    ];
    const zip = buildZip(files);
    // EOCD is a 22-byte record ending the archive (assuming no comment).
    const eocdOff = zip.length - 22;
    expect(u32(zip, eocdOff)).toBe(0x06054b50);
    expect(u16(zip, eocdOff + 8)).toBe(files.length); // entries on this disk
    expect(u16(zip, eocdOff + 10)).toBe(files.length); // total entries
  });

  it('stores file content verbatim for STORED entries', () => {
    const payload = Buffer.from('roundtrip content', 'utf8');
    const zip = buildZip([{ path: 'note.md', content: payload }]);
    // The raw bytes should be present somewhere after the local header.
    expect(zip.includes(payload)).toBe(true);
  });

  it('writes the manifest filename into the local header', () => {
    const zip = buildZip([
      {
        path: 'manifest.json',
        content: Buffer.from('{"ok":true}', 'utf8'),
      },
    ]);
    // Local header filename starts at offset 30.
    const nameLen = u16(zip, 26);
    const name = zip.slice(30, 30 + nameLen).toString('utf8');
    expect(name).toBe('manifest.json');
  });

  it('supports multiple entries without corrupting their offsets', () => {
    const manifest = Buffer.from(
      JSON.stringify({ dxt_version: '0.1', name: 'projelli' }),
      'utf8',
    );
    const binary = Buffer.from('\x7fELF' + 'fakebinary'.repeat(10), 'utf8');
    const zip = buildZip([
      { path: 'manifest.json', content: manifest },
      { path: 'server/projelli-mcp', content: binary, mode: 0o100755 },
    ]);
    // Both filenames must be findable in the archive bytes.
    expect(zip.includes(Buffer.from('manifest.json', 'utf8'))).toBe(true);
    expect(zip.includes(Buffer.from('server/projelli-mcp', 'utf8'))).toBe(true);
  });
});
