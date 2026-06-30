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

  it('matches across drive-letter case + separators (segments keep their case)', () => {
    // Drive case + separator style are bridged; the directory segments carry the
    // same on-disk casing on both sides, so the client folder still resolves.
    expect(getTopLevelFolder('c:/Users/Jane/Advisor/Acme/doc.docx', ROOT)).toBe('Acme');
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

  it('keeps files inside the scoped client folder across SEPARATOR + root-case differences', () => {
    const paths = [
      'C:\\WS\\Acme\\matter\\doc.docx', // backslashes
      'C:/WS/Acme/other.docx', // forward slashes, same client folder "Acme"
      'c:\\ws\\Acme\\third.docx', // differing ROOT case (root is not a client boundary)
      'C:\\WS\\Beta\\secret.docx', // different client — excluded
    ];
    expect(filterByScope(paths, ROOT, 'Acme')).toEqual([
      'C:\\WS\\Acme\\matter\\doc.docx',
      'C:/WS/Acme/other.docx',
      'c:\\ws\\Acme\\third.docx',
    ]);
  });

  it('does not leak a sibling that shares a name prefix', () => {
    const paths = ['C:\\WS\\Acme Corp\\doc.docx'];
    expect(filterByScope(paths, ROOT, 'Acme')).toEqual([]);
  });

  // Coordinator P1 (2026-06-30): FAIL CLOSED on a case-only CLIENT-folder
  // collision. On a case-sensitive Windows-shaped volume `Acme` and `acme` are
  // two DIFFERENT clients; scoping to "Acme" must NEVER pull in "acme"'s files.
  it('FAILS CLOSED — never mixes a case-only-different sibling client', () => {
    const paths = [
      'C:\\WS\\Acme\\own.docx', // the scoped client
      'C:\\WS\\acme\\OTHER-CLIENT-secret.docx', // a DIFFERENT client (case-only diff)
      'C:/WS/acme/another.docx', // same other client, forward slashes
    ];
    expect(filterByScope(paths, ROOT, 'Acme')).toEqual(['C:\\WS\\Acme\\own.docx']);
    // …and the reverse: scoping to "acme" must not pull in "Acme"'s file.
    expect(filterByScope(paths, ROOT, 'acme')).toEqual([
      'C:\\WS\\acme\\OTHER-CLIENT-secret.docx',
      'C:/WS/acme/another.docx',
    ]);
  });
});
