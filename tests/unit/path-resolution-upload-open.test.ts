/**
 * Task 6 — resolveWorkspacePath contract tests.
 *
 * When an uploaded file's path is constructed as `${uploadPath}/${fileName}`,
 * the `uploadPath` may be a workspace-relative folder (e.g. "docs") when the
 * upload targets a subfolder.  The resulting path ("docs/The Supreme Court.docx")
 * is then passed to the native `docx_open` Tauri command via invoke(), which
 * calls `std::fs::read(path)` — a relative path resolves against the Rust
 * process CWD, not the workspace root, causing "os error 3" on Windows.
 *
 * `resolveWorkspacePath(rootPath, maybeRelative)` converts workspace-relative
 * paths to absolute ones and passes absolute paths through unchanged.
 */

import { describe, it, expect } from 'vitest';
import { resolveWorkspacePath } from '../../src/modules/workspace/pathResolve';

describe('resolveWorkspacePath', () => {
  // --- relative inputs are resolved against rootPath ---

  it('joins a simple relative path to the workspace root (POSIX root)', () => {
    expect(
      resolveWorkspacePath('/home/user/Keepance', 'docs/contract.docx')
    ).toBe('/home/user/Keepance/docs/contract.docx');
  });

  it('joins a relative path with spaces to the workspace root (Windows)', () => {
    expect(
      resolveWorkspacePath('C:/Users/j/Keepance 1', 'docs/The Supreme Court.docx')
    ).toBe('C:/Users/j/Keepance 1/docs/The Supreme Court.docx');
  });

  it('handles a bare file name with no subfolder', () => {
    expect(
      resolveWorkspacePath('C:/Users/j/Keepance', 'contract.docx')
    ).toBe('C:/Users/j/Keepance/contract.docx');
  });

  it('avoids double slashes when root has a trailing slash', () => {
    expect(
      resolveWorkspacePath('/home/user/Keepance/', 'docs/a.docx')
    ).toBe('/home/user/Keepance/docs/a.docx');
  });

  it('preserves unicode in paths unchanged', () => {
    expect(
      resolveWorkspacePath('/home/user/Keepance', 'docs/合同.docx')
    ).toBe('/home/user/Keepance/docs/合同.docx');
  });

  // --- absolute inputs pass through unchanged ---

  it('passes through an already-absolute POSIX path', () => {
    expect(
      resolveWorkspacePath('/home/user/Keepance', '/elsewhere/a.docx')
    ).toBe('/elsewhere/a.docx');
  });

  it('passes through an already-absolute Windows path (forward-slash C:/)', () => {
    expect(
      resolveWorkspacePath('C:/Users/j/Keepance 1', 'C:/elsewhere/a.docx')
    ).toBe('C:/elsewhere/a.docx');
  });

  it('passes through a Windows path with backslash root', () => {
    expect(
      resolveWorkspacePath('C:/Users/j/Keepance', 'C:\\Users\\j\\other\\a.docx')
    ).toBe('C:\\Users\\j\\other\\a.docx');
  });

  it('passes through a POSIX absolute path with spaces', () => {
    expect(
      resolveWorkspacePath('/home/user/My Keepance', '/opt/docs/The Supreme Court.docx')
    ).toBe('/opt/docs/The Supreme Court.docx');
  });
});
