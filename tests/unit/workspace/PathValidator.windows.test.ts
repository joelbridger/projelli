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
});
