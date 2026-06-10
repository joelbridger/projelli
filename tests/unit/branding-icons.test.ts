import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

// icon.ico was regenerated 2026-06-10 from the Keepance brand master.
// It must never regress to the stale Projelli icon below.
const STALE_PROJELLI_ICO_SHA256 = '6f3d612509bd8cf122c00b241d40b53a4fdfdbc01c9b2028fe9b82011b8fa4d7';

describe('app icons are Keepance brand', () => {
  it('icon.ico is not the stale Projelli icon', () => {
    const buf = readFileSync('src-tauri/icons/icon.ico');
    expect(createHash('sha256').update(buf).digest('hex')).not.toBe(STALE_PROJELLI_ICO_SHA256);
  });
  it('icon.ico contains the standard Windows sizes', () => {
    const buf = readFileSync('src-tauri/icons/icon.ico');
    expect(buf.readUInt16LE(2)).toBe(1); // ICONDIR type 1 = icon
    expect(buf.readUInt16LE(4)).toBeGreaterThanOrEqual(4); // >= 4 sizes (16/32/48/256)
  });
});
