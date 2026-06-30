/**
 * Client-boundary detection on WINDOWS-style paths.
 *
 * The product's confidentiality promise depends on correctly grouping files by
 * top-level (client) folder. On Windows paths use `\`, are case-insensitive, and
 * carry drive letters / UNC roots — a POSIX `startsWith` gets this wrong, which
 * could (a) miss a real cross-client situation, or (b) falsely flag one. These
 * tests pin the Windows behaviour so a regression to POSIX-only logic is caught.
 */

import { describe, it, expect } from 'vitest';
import {
  getTopLevelFolder,
  getDistinctTopLevelFolders,
  detectCrossClientContext,
  filterByScope,
  ROOT_LEVEL_SENTINEL,
} from '@/platform/utils/client-boundary';

describe('getTopLevelFolder — Windows paths', () => {
  const ROOT = 'C:\\Users\\Jane\\Advisor';

  it('extracts the client folder from a backslash path', () => {
    expect(getTopLevelFolder(`${ROOT}\\Acme Corp\\matter1\\doc.docx`, ROOT)).toBe('Acme Corp');
  });

  it('matches across separator style (root `\\`, file `/`)', () => {
    expect(getTopLevelFolder('C:/Users/Jane/Advisor/Acme/doc.docx', ROOT)).toBe('Acme');
  });

  it('matches across drive-letter case and folder case (preserving display case)', () => {
    expect(getTopLevelFolder('c:\\users\\jane\\advisor\\Acme\\doc.docx', ROOT)).toBe('Acme');
  });

  it('returns the sentinel for a root-level file', () => {
    expect(getTopLevelFolder(`${ROOT}\\notes.docx`, ROOT)).toBe(ROOT_LEVEL_SENTINEL);
  });

  it('returns null for a file outside the workspace', () => {
    expect(getTopLevelFolder('D:\\Other\\doc.docx', ROOT)).toBeNull();
  });

  it('respects folder boundaries (Acme vs Acme Corp)', () => {
    // A file under "Acme Corp" must never be attributed to client "Acme".
    const folders = getDistinctTopLevelFolders(
      [`${ROOT}\\Acme\\a.docx`, `${ROOT}\\Acme Corp\\b.docx`],
      ROOT,
    );
    expect(folders).toEqual(new Set(['Acme', 'Acme Corp']));
  });
});

describe('cross-client detection — Windows case-insensitivity', () => {
  const ROOT = 'C:\\WS';

  it('flags case-differing top folders as distinct (fail-SAFE over-warn direction)', () => {
    // The cross-client warning is a confidentiality safety net: we must NEVER
    // MISS a genuine two-client span. So `Acme` and `acme` are treated as
    // distinct here (over-warn) rather than folded (which could hide a real
    // two-client span on a case-sensitive volume).
    const result = detectCrossClientContext(
      ['C:\\WS\\Acme\\a.docx', 'C:/WS/acme/b.docx'],
      ROOT,
    );
    expect(result.isCrossClient).toBe(true);
    expect(result.folders).toEqual(['Acme', 'acme']);
  });

  it('DOES flag genuinely different client folders', () => {
    const result = detectCrossClientContext(
      ['C:\\WS\\Acme\\a.docx', 'C:\\WS\\Beta\\b.docx'],
      ROOT,
    );
    expect(result.isCrossClient).toBe(true);
    expect(result.folders).toEqual(['Acme', 'Beta']);
  });
});

describe('filterByScope — Windows paths', () => {
  const ROOT = 'C:\\WS';

  it('keeps only files inside the scoped client folder, across slash + case', () => {
    const paths = [
      'C:\\WS\\Acme\\matter\\doc.docx',
      'C:/WS/acme/other.docx', // same client, different case + slash
      'C:\\WS\\Beta\\secret.docx', // different client — must be excluded
    ];
    expect(filterByScope(paths, ROOT, 'Acme')).toEqual([
      'C:\\WS\\Acme\\matter\\doc.docx',
      'C:/WS/acme/other.docx',
    ]);
  });

  it('does not leak a sibling that shares a name prefix', () => {
    const paths = ['C:\\WS\\Acme Corp\\doc.docx'];
    expect(filterByScope(paths, ROOT, 'Acme')).toEqual([]);
  });
});
