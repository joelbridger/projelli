/**
 * appPath — cross-platform path comparison helper.
 *
 * These are the primitives every client-scope / matter-isolation check relies
 * on. The Windows cases (backslashes, drive-letter case, UNC, trailing
 * separators) are the whole reason the module exists: a POSIX `startsWith` gets
 * them wrong and can put a file in — or keep it out of — the wrong client.
 */

import { describe, it, expect } from 'vitest';
import {
  isWindowsStylePath,
  pathsEqual,
  sameOrInside,
  relativeInside,
  topLevelSegment,
  joinWorkspacePath,
} from '@/platform/fs/appPath';

describe('isWindowsStylePath', () => {
  it('detects drive-letter and UNC paths, rejects POSIX', () => {
    expect(isWindowsStylePath('C:\\WS')).toBe(true);
    expect(isWindowsStylePath('c:/ws')).toBe(true);
    expect(isWindowsStylePath('\\\\server\\share\\WS')).toBe(true);
    expect(isWindowsStylePath('//server/share/WS')).toBe(true);
    expect(isWindowsStylePath('/home/jane/WS')).toBe(false);
    expect(isWindowsStylePath('relative/path')).toBe(false);
  });
});

describe('pathsEqual', () => {
  it('treats separator and trailing-separator variants as equal', () => {
    expect(pathsEqual('C:\\WS', 'C:/WS')).toBe(true);
    expect(pathsEqual('C:\\WS\\', 'C:/WS')).toBe(true);
    expect(pathsEqual('/home/jane/WS/', '/home/jane/WS')).toBe(true);
  });

  it('is case-insensitive for Windows paths only', () => {
    expect(pathsEqual('C:\\WS\\Acme', 'c:/ws/acme')).toBe(true);
    // POSIX stays case-sensitive
    expect(pathsEqual('/home/jane/Acme', '/home/jane/acme')).toBe(false);
  });
});

describe('sameOrInside', () => {
  const ROOT = '/home/jane/WS';

  it('matches the root itself and descendants, respecting boundaries', () => {
    expect(sameOrInside(ROOT, ROOT)).toBe(true);
    expect(sameOrInside(ROOT, `${ROOT}/Acme/doc.md`)).toBe(true);
    // "Acme" must not match a sibling that merely shares the prefix
    expect(sameOrInside(`${ROOT}/Acme`, `${ROOT}/Acme Corp/doc.md`)).toBe(false);
    expect(sameOrInside(ROOT, '/home/jane/Other/doc.md')).toBe(false);
  });

  it('handles Windows mixed slashes + case', () => {
    expect(sameOrInside('C:\\WS', 'c:/ws/Acme/secret.docx')).toBe(true);
    expect(sameOrInside('C:\\WS\\Acme', 'C:/WS/acme/sub/secret.docx')).toBe(true);
    // boundary still respected under Windows folding
    expect(sameOrInside('C:\\WS\\Acme', 'C:/WS/Acme Corp/doc.docx')).toBe(false);
    // a different drive is never inside
    expect(sameOrInside('C:\\WS', 'D:/WS/Acme/doc.docx')).toBe(false);
  });

  it('handles UNC roots', () => {
    expect(
      sameOrInside('\\\\server\\share\\WS', '//server/share/WS/Acme/doc.docx'),
    ).toBe(true);
  });

  it('rejects empty inputs', () => {
    expect(sameOrInside('', ROOT)).toBe(false);
    expect(sameOrInside(ROOT, '')).toBe(false);
  });
});

describe('relativeInside', () => {
  it('returns the original-case relative path or null', () => {
    expect(relativeInside('C:\\WS', 'c:/ws/Acme/Sub/Doc.docx')).toBe('Acme/Sub/Doc.docx');
    expect(relativeInside('C:\\WS', 'C:/WS')).toBe('');
    expect(relativeInside('C:\\WS', 'D:/Other/x')).toBeNull();
  });
});

describe('topLevelSegment', () => {
  const ROOT = '/home/jane/WS';

  it('returns the first folder below the root (original case)', () => {
    expect(topLevelSegment(ROOT, `${ROOT}/Acme/m1/doc.md`)).toBe('Acme');
    expect(topLevelSegment('C:\\WS', 'c:/ws/Acme/doc.docx')).toBe('Acme');
  });

  it('returns "" for a file directly in the root or the root itself', () => {
    expect(topLevelSegment(ROOT, `${ROOT}/notes.md`)).toBe('');
    expect(topLevelSegment(ROOT, ROOT)).toBe('');
  });

  it('returns null for a path outside the root', () => {
    expect(topLevelSegment(ROOT, '/elsewhere/doc.md')).toBeNull();
  });
});

describe('joinWorkspacePath', () => {
  it('joins with a single separator regardless of trailing/leading slashes', () => {
    expect(joinWorkspacePath('C:\\WS\\', 'Acme')).toBe('C:/WS/Acme');
    expect(joinWorkspacePath('/home/jane/WS', '/Acme')).toBe('/home/jane/WS/Acme');
  });
});
