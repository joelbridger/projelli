import { describe, expect, it, beforeEach } from 'vitest';
import { PathValidator } from '@/platform/fs/PathValidator';
import { SecurityError } from '@/platform/fs/types';

describe('PathValidator - Windows-style paths on Linux', () => {
  let validator: PathValidator;
  const rootPath = 'C:\\Users\\Jane\\Keepance';
  const normalizedRoot = 'C:/Users/Jane/Keepance';

  beforeEach(() => {
    validator = new PathValidator(rootPath);
  });

  function expectSecurityReason(path: string, reason: SecurityError['reason']): void {
    try {
      validator.validatePath(path);
      expect.fail(`Expected ${path} to throw`);
    } catch (error) {
      expect(error).toBeInstanceOf(SecurityError);
      expect((error as SecurityError).reason).toBe(reason);
    }
  }

  describe('workspace root and child paths', () => {
    it('normalizes a Windows drive-letter workspace root', () => {
      expect(validator.getRootPath()).toBe(normalizedRoot);
    });

    it('accepts absolute child paths with backslashes', () => {
      expect(
        validator.validatePath('C:\\Users\\Jane\\Keepance\\Matters\\Acme\\brief.docx')
      ).toBe('C:/Users/Jane/Keepance/Matters/Acme/brief.docx');
    });

    it('accepts relative child paths with backslashes and mixed separators', () => {
      expect(validator.validatePath('Matters\\Acme/brief.docx')).toBe(
        'C:/Users/Jane/Keepance/Matters/Acme/brief.docx'
      );
    });

    it('keeps the existing strict rule that any .. segment is rejected', () => {
      expectSecurityReason(
        'Matters\\Acme\\..\\Acme\\brief.docx',
        'PATH_TRAVERSAL'
      );
    });
  });

  describe('Windows traversal attempts', () => {
    it('blocks backslash traversal attempts', () => {
      const attacks = [
        '..\\..\\..\\Windows\\System32',
        'C:\\Users\\Jane\\Keepance\\..\\..\\Secret',
        '..\\../..\\Secret',
        'C:\\Users\\Jane\\Keepance\\Matters\\..\\..\\..\\Secret',
      ];

      for (const path of attacks) {
        expectSecurityReason(path, 'PATH_TRAVERSAL');
      }
    });

    it('rejects a sibling path that only shares the workspace text prefix', () => {
      expectSecurityReason(
        'C:\\Users\\Jane\\Keepance-evil\\secret.docx',
        'ABSOLUTE_PATH_IN_RELATIVE_CONTEXT'
      );
      expect(validator.isWithinWorkspace('C:\\Users\\Jane\\Keepance-evil')).toBe(
        false
      );
    });
  });

  describe('drive letters', () => {
    it('treats drive letters case-insensitively for Windows paths', () => {
      expect(
        validator.validatePath('c:\\Users\\Jane\\Keepance\\Matters\\Acme\\brief.docx')
      ).toBe('c:/Users/Jane/Keepance/Matters/Acme/brief.docx');
      expect(
        validator.getRelativePath('c:\\Users\\Jane\\Keepance\\Matters\\Acme\\brief.docx')
      ).toBe('Matters/Acme/brief.docx');
      expect(validator.isWithinWorkspace('c:\\Users\\Jane\\Keepance')).toBe(true);
    });

    it('rejects a path on a different drive as outside the root', () => {
      expectSecurityReason('D:\\foo\\brief.docx', 'ABSOLUTE_PATH_IN_RELATIVE_CONTEXT');
      expect(validator.isWithinWorkspace('D:\\foo\\brief.docx')).toBe(false);
    });
  });

  describe('Windows filename edge cases', () => {
    it('rejects reserved Windows device names', () => {
      const reservedNames = ['CON', 'NUL', 'PRN', 'AUX', 'COM1', 'LPT1'];

      for (const name of reservedNames) {
        expect(() => validator.validateName(name)).toThrow(SecurityError);
        expect(() => validator.validateName(`${name}.txt`)).toThrow(SecurityError);
      }
    });

    it('rejects names with trailing dots or spaces instead of silently changing them', () => {
      expect(() => validator.validateName('brief.')).toThrow(SecurityError);
      expect(() => validator.validateName('brief ')).toThrow(SecurityError);
    });

    it('allows ordinary names that merely contain reserved-name text', () => {
      expect(validator.validateName('CONTRACT.docx')).toBe('CONTRACT.docx');
      expect(validator.validateName('COM10.docx')).toBe('COM10.docx');
    });
  });

  describe('long and UNC paths', () => {
    it('does not crash on very long Windows-style paths', () => {
      const longPath = `Matters\\${'a'.repeat(270)}\\brief.docx`;

      expect(() => validator.validatePath(longPath)).not.toThrow();
      expect(validator.validatePath(longPath)).toBe(
        `${normalizedRoot}/Matters/${'a'.repeat(270)}/brief.docx`
      );
    });

    it('rejects UNC paths outside a drive-letter workspace', () => {
      expectSecurityReason(
        '\\\\server\\share\\file.docx',
        'ABSOLUTE_PATH_IN_RELATIVE_CONTEXT'
      );
      expect(validator.isAbsolutePath('\\\\server\\share\\file.docx')).toBe(true);
    });
  });

  describe('relative and absolute round trips', () => {
    it('round-trips Windows absolute paths to relative paths', () => {
      const absolutePath = 'C:\\Users\\Jane\\Keepance\\Matters\\Acme\\brief.docx';
      const relativePath = validator.getRelativePath(absolutePath);

      expect(relativePath).toBe('Matters/Acme/brief.docx');
      expect(validator.toAbsolutePath(relativePath)).toBe(
        'C:/Users/Jane/Keepance/Matters/Acme/brief.docx'
      );
    });

    it('rejects relative conversion for paths outside the Windows root', () => {
      expect(() =>
        validator.getRelativePath('C:\\Users\\Jane\\Keepance-evil\\brief.docx')
      ).toThrow(SecurityError);
    });
  });

  // ── Extended Windows-path coverage (Task 12 additions) ──────────────────────
  // Commit 508b5d7 covered COM1 and LPT1. The regex also matches COM2-COM9 and
  // LPT2-LPT9; these tests make that coverage explicit so a future regex edit
  // can't silently drop the higher-numbered ports.

  describe('reserved name - full COM/LPT range', () => {
    it('rejects every COM port name (COM1-COM9) including with an extension', () => {
      const ports = ['COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9'];
      for (const name of ports) {
        expect(() => validator.validateName(name), `bare: ${name}`).toThrow(SecurityError);
        expect(() => validator.validateName(`${name}.docx`), `with ext: ${name}.docx`).toThrow(SecurityError);
      }
    });

    it('rejects every LPT port name (LPT1-LPT9) including with an extension', () => {
      const ports = ['LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9'];
      for (const name of ports) {
        expect(() => validator.validateName(name), `bare: ${name}`).toThrow(SecurityError);
        expect(() => validator.validateName(`${name}.docx`), `with ext: ${name}.docx`).toThrow(SecurityError);
      }
    });

    it('allows COM0 and COM10 which are not reserved', () => {
      // COM0 does not match COM[1-9]; COM10 has a two-digit suffix so the stem
      // is "COM10" which does not match COM[1-9] either.
      expect(validator.validateName('COM0.docx')).toBe('COM0.docx');
      expect(validator.validateName('COM10.docx')).toBe('COM10.docx');
      expect(validator.validateName('LPT0.docx')).toBe('LPT0.docx');
      expect(validator.validateName('LPT10.docx')).toBe('LPT10.docx');
    });
  });

  describe('total path length near the Windows MAX_PATH boundary (260 chars)', () => {
    // Windows MAX_PATH = 260 characters total (including drive + separators).
    // On Linux we don't enforce this limit — the tests document that the validator
    // accepts paths regardless of total length, so long file system limits are
    // never silently hit on the TS layer alone. A path of exactly 261 total chars
    // is accepted by the validator (it normalizes and returns it), exercising the
    // code path without crashing.

    it('accepts a path whose total normalized length is exactly 261 characters', () => {
      // Build a relative path inside the workspace so that the final absolute
      // form is root + '/' + segment = exactly 261 chars total.
      // normalizedRoot = 'C:/Users/Jane/Keepance' (22 chars)
      // separator + filename = 1 + n chars  → n = 261 - 22 - 1 = 238
      const segLen = 261 - normalizedRoot.length - 1; // = 238
      const segment = 'z'.repeat(segLen);
      const result = validator.validatePath(segment);
      expect(result.length).toBe(261);
      expect(result).toBe(`${normalizedRoot}/${segment}`);
    });

    it('accepts a path whose total normalized length is exactly 260 characters', () => {
      const segLen = 260 - normalizedRoot.length - 1; // = 237
      const segment = 'z'.repeat(segLen);
      const result = validator.validatePath(segment);
      expect(result.length).toBe(260);
      expect(result).toBe(`${normalizedRoot}/${segment}`);
    });
  });

  // QA-41: `Path::canonicalize()` on Windows ALWAYS returns the extended-
  // length ("verbatim") form `\\?\C:\...` (or `\\?\UNC\server\share\...` for
  // a UNC target) — see src-tauri/src/commands/pathguard.rs's
  // `canonicalize_symlink_safe_absolute`. The meeting-capture Rust commands
  // (capture_start/capture_stop/transcribe_meeting) run every meeting_dir
  // through that canonicalizer internally (round-8 fix, for INTERNAL
  // Rust-side path comparisons), so the `meetingDir` string hitting the
  // frontend straight from a fresh recording could carry this prefix even
  // after the Rust-side IPC-boundary strip (defense in depth for any path
  // this validator hasn't seen stripped, and for older/other callers). A
  // plain workspace root from a folder-picker dialog never has this prefix,
  // so without handling it, a verbatim meetingDir compares unequal to its
  // own workspace root and every read/write on it wrongly looks like it
  // escapes the workspace — the exact bug that made `tryGenerateNotes`
  // silently and permanently treat a completed transcript as "still queued"
  // (meetingStore.ts).
  describe('Windows verbatim (\\\\?\\) extended-length prefix', () => {
    it('treats a \\\\?\\-prefixed absolute path the same as its plain equivalent', () => {
      const verbatim =
        '\\\\?\\C:\\Users\\Jane\\Keepance\\Matters\\Acme\\brief.docx';
      expect(validator.validatePath(verbatim)).toBe(
        'C:/Users/Jane/Keepance/Matters/Acme/brief.docx'
      );
      expect(validator.isWithinWorkspace(verbatim)).toBe(true);
      expect(validator.getRelativePath(verbatim)).toBe(
        'Matters/Acme/brief.docx'
      );
    });

    it('treats a \\\\?\\-prefixed workspace root the same as the plain root', () => {
      const verbatimValidator = new PathValidator(
        '\\\\?\\C:\\Users\\Jane\\Keepance'
      );
      expect(verbatimValidator.getRootPath()).toBe(normalizedRoot);
      expect(
        verbatimValidator.validatePath(
          'C:\\Users\\Jane\\Keepance\\Matters\\Acme\\brief.docx'
        )
      ).toBe('C:/Users/Jane/Keepance/Matters/Acme/brief.docx');
    });

    it('rejects a \\\\?\\-prefixed path that genuinely escapes the workspace', () => {
      expectSecurityReason(
        '\\\\?\\C:\\Users\\Jane\\Keepance-evil\\secret.docx',
        'ABSOLUTE_PATH_IN_RELATIVE_CONTEXT'
      );
    });

    it('treats a \\\\?\\UNC\\ verbatim path the same as its plain UNC equivalent for containment purposes', () => {
      // Scoped to isWithinWorkspace/getRelativePath — NOT a full validatePath()
      // round trip. `resolvePath`'s `..`-segment walk has a separate,
      // pre-existing gap for double-slash (UNC) roots (it collapses `//` to
      // a single `/`, losing the UNC marker) that predates this fix and is
      // out of scope here: this app's real workspaces are local drive-letter
      // paths (see pathguard.rs's "no network/OneDrive" framing), so a UNC
      // workspace root isn't the QA-41 trigger — only documented so it isn't
      // mistaken for something this change was meant to fix.
      const uncValidator = new PathValidator('\\\\server\\share\\Keepance');
      const verbatim =
        '\\\\?\\UNC\\server\\share\\Keepance\\Matters\\Acme\\brief.docx';
      expect(uncValidator.isWithinWorkspace(verbatim)).toBe(true);
      expect(uncValidator.getRelativePath(verbatim)).toBe(
        'Matters/Acme/brief.docx'
      );
    });
  });

  describe('reserved name as a path component (not just a filename)', () => {
    // A directory named NUL or CON in the middle of a path is equally forbidden
    // on Windows. validatePath delegates to validateName for each segment only
    // implicitly (it normalizes separators and checks boundaries); the directory
    // component itself is not individually validated by validatePath, which is
    // the INTENDED behavior — the TS layer catches these in validateName before
    // a path is ever assembled. These tests document that contract explicitly.

    it('accepts a path segment whose parent directory is named after a reserved word ' +
       '(validatePath does not validate individual components)', () => {
      // A path like "NUL\brief.docx" as a relative path becomes a valid absolute
      // path inside the workspace once the separator is normalized. validatePath
      // does not reject it — callers must call validateName on each component
      // separately before assembling the path.
      const result = validator.validatePath('NUL\\brief.docx');
      expect(result).toBe(`${normalizedRoot}/NUL/brief.docx`);
    });

    it('validateName rejects NUL as a directory component name', () => {
      // Callers building a path segment-by-segment must call validateName on
      // each component; this test confirms the guard fires correctly.
      expect(() => validator.validateName('NUL')).toThrow(SecurityError);
      expect(() => validator.validateName('CON')).toThrow(SecurityError);
    });
  });
});
