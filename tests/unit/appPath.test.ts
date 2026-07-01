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
  workspacePath,
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

  it('folds ONLY the drive letter, NOT directory segments', () => {
    // Drive letter is case-insensitive on Windows.
    expect(pathsEqual('C:\\WS\\Acme', 'c:\\WS\\Acme')).toBe(true);
    // Directory-segment case is significant (client boundary) → fail closed.
    expect(pathsEqual('C:\\WS\\Acme', 'C:\\WS\\acme')).toBe(false);
    expect(pathsEqual('C:\\WS\\Acme', 'c:/ws/acme')).toBe(false);
    // POSIX stays fully case-sensitive
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

  it('matches across separator + DRIVE case, but NOT across segment case', () => {
    // Separator + drive-letter case differences are bridged (same physical path).
    expect(sameOrInside('C:\\WS', 'c:/WS/Acme/secret.docx')).toBe(true);
    expect(sameOrInside('C:\\WS\\Acme', 'c:\\WS\\Acme\\sub\\secret.docx')).toBe(true);
    // A case-only SEGMENT difference is a DIFFERENT client → fail closed.
    expect(sameOrInside('C:\\WS\\Acme', 'C:/WS/acme/sub/secret.docx')).toBe(false);
    // boundary still respected
    expect(sameOrInside('C:\\WS\\Acme', 'C:/WS/Acme Corp/doc.docx')).toBe(false);
    // a different drive is never inside
    expect(sameOrInside('C:\\WS', 'D:/WS/Acme/doc.docx')).toBe(false);
  });

  it('handles UNC roots (host+share folded, segments case-sensitive)', () => {
    expect(
      sameOrInside('\\\\Server\\Share\\WS', '//server/share/WS/Acme/doc.docx'),
    ).toBe(true);
    // a case-only difference in a directory segment under the share fails closed
    expect(
      sameOrInside('\\\\server\\share\\WS\\Acme', '//server/share/WS/acme/doc.docx'),
    ).toBe(false);
  });

  it('rejects empty inputs', () => {
    expect(sameOrInside('', ROOT)).toBe(false);
    expect(sameOrInside(ROOT, '')).toBe(false);
  });
});

describe('relativeInside', () => {
  it('returns the original-case relative path or null', () => {
    // drive + separator differences are bridged; segment case preserved
    expect(relativeInside('C:\\WS', 'c:/WS/Acme/Sub/Doc.docx')).toBe('Acme/Sub/Doc.docx');
    expect(relativeInside('C:\\WS', 'C:/WS')).toBe('');
    expect(relativeInside('C:\\WS', 'D:/Other/x')).toBeNull();
    // a case-only segment difference in the root path is NOT inside (fail closed)
    expect(relativeInside('C:\\WS\\Acme', 'C:/WS/acme/x')).toBeNull();
  });
});

describe('topLevelSegment', () => {
  const ROOT = '/home/jane/WS';

  it('returns the first folder below the root (original case)', () => {
    expect(topLevelSegment(ROOT, `${ROOT}/Acme/m1/doc.md`)).toBe('Acme');
    // drive + separator bridged, segment case preserved
    expect(topLevelSegment('C:\\WS', 'c:/WS/Acme/doc.docx')).toBe('Acme');
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

describe('workspacePath', () => {
  it('joins a relative segment onto root exactly like joinWorkspacePath', () => {
    expect(workspacePath('C:\\WS\\', 'Acme/doc.docx')).toBe('C:/WS/Acme/doc.docx');
    expect(workspacePath('/home/jane/WS', 'Acme')).toBe('/home/jane/WS/Acme');
    expect(workspacePath('/home/jane/WS/', 'Acme')).toBe('/home/jane/WS/Acme');
  });

  it('passes an already-absolute rel through UNCHANGED instead of doubling it', () => {
    // The bug this guards against: `p.startsWith(rootPath) ? p : \`${rootPath}/${p}\``
    // fails to recognize an absolute path whose drive-letter case or separator
    // style differs from rootPath, producing a doubled/garbage join.
    expect(workspacePath('C:/WS', 'c:\\WS\\Acme\\doc.docx')).toBe('c:/WS/Acme/doc.docx');
    expect(workspacePath('/home/jane/WS', '/home/jane/WS/Acme/doc.docx')).toBe(
      '/home/jane/WS/Acme/doc.docx',
    );
    expect(workspacePath('/home/jane/WS', '/elsewhere/doc.docx')).toBe('/elsewhere/doc.docx');
  });

  it('handles UNC roots and mixed separators without doubling', () => {
    expect(workspacePath('\\\\Server\\Share\\WS', 'Acme/doc.docx')).toBe(
      '//Server/Share/WS/Acme/doc.docx',
    );
    expect(workspacePath('//server/share/WS', '\\\\server\\share\\WS\\Acme\\doc.docx')).toBe(
      '//server/share/WS/Acme/doc.docx',
    );
  });

  it('collapses trailing/duplicate separators on the root before joining', () => {
    expect(workspacePath('C:/WS///', 'Acme/doc.docx')).toBe('C:/WS/Acme/doc.docx');
    expect(workspacePath('C:/WS/', 'Acme')).toBe('C:/WS/Acme');
  });

  it('throws loudly instead of stringifying a non-string argument', () => {
    // The concrete bug this guards against: a folder-picker object leaking in
    // and silently becoming the literal "[object Object]" in a create path.
    expect(() => workspacePath({ path: 'C:/WS' } as unknown as string, 'Acme')).toThrow(TypeError);
    expect(() => workspacePath('C:/WS', { path: 'Acme' } as unknown as string)).toThrow(TypeError);
    expect(() => workspacePath('C:/WS', null as unknown as string)).toThrow(TypeError);
    expect(() => workspacePath('C:/WS', undefined as unknown as string)).toThrow(TypeError);
  });
});
