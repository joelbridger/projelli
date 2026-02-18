import { describe, it, expect, beforeEach } from 'vitest';
import { PathValidator } from '@/modules/workspace/PathValidator';
import { SecurityError } from '@/modules/workspace/types';

describe('PathValidator', () => {
  let validator: PathValidator;
  const rootPath = '/home/user/workspace';

  beforeEach(() => {
    validator = new PathValidator(rootPath);
  });

  describe('normalizePath', () => {
    it('normalizes forward slashes', () => {
      expect(validator.normalizePath('/home/user/file')).toBe('/home/user/file');
    });

    it('converts backslashes to forward slashes', () => {
      expect(validator.normalizePath('\\home\\user\\file')).toBe('/home/user/file');
    });

    it('removes trailing slash', () => {
      expect(validator.normalizePath('/home/user/')).toBe('/home/user');
    });

    it('keeps single slash for root', () => {
      expect(validator.normalizePath('/')).toBe('/');
    });
  });

  describe('validatePath - basic operations', () => {
    it('accepts valid relative paths', () => {
      const result = validator.validatePath('docs/file.md');
      expect(result).toBe('/home/user/workspace/docs/file.md');
    });

    it('accepts valid nested paths', () => {
      const result = validator.validatePath('docs/nested/deep/file.md');
      expect(result).toBe('/home/user/workspace/docs/nested/deep/file.md');
    });

    it('accepts paths already within workspace', () => {
      const result = validator.validatePath('/home/user/workspace/docs/file.md');
      expect(result).toBe('/home/user/workspace/docs/file.md');
    });
  });

  describe('validatePath - path traversal prevention', () => {
    it('rejects simple ../ traversal', () => {
      expect(() => validator.validatePath('../etc/passwd')).toThrow(SecurityError);
    });

    it('rejects nested ../ traversal', () => {
      expect(() => validator.validatePath('docs/../../etc/passwd')).toThrow(
        SecurityError
      );
    });

    it('rejects deep nested traversal', () => {
      expect(() =>
        validator.validatePath('a/b/c/d/../../../../etc/passwd')
      ).toThrow(SecurityError);
    });

    it('rejects ../ at end of path', () => {
      expect(() => validator.validatePath('docs/..')).toThrow(SecurityError);
    });

    it('rejects backslash traversal', () => {
      expect(() => validator.validatePath('..\\etc\\passwd')).toThrow(
        SecurityError
      );
    });

    it('rejects URL-encoded traversal', () => {
      expect(() => validator.validatePath('%2e%2e/etc/passwd')).toThrow(
        SecurityError
      );
    });

    it('rejects double URL-encoded traversal', () => {
      expect(() => validator.validatePath('%252e%252e/etc/passwd')).toThrow(
        SecurityError
      );
    });

    it('reports correct error reason for traversal', () => {
      try {
        validator.validatePath('../etc/passwd');
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(SecurityError);
        expect((error as SecurityError).reason).toBe('PATH_TRAVERSAL');
      }
    });
  });

  describe('validatePath - outside workspace', () => {
    it('rejects absolute paths outside workspace', () => {
      expect(() => validator.validatePath('/etc/passwd')).toThrow(SecurityError);
    });

    it('rejects paths to different user directories', () => {
      expect(() => validator.validatePath('/home/other/file.md')).toThrow(
        SecurityError
      );
    });

    it('reports correct error reason for outside workspace', () => {
      try {
        validator.validatePath('/etc/passwd');
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(SecurityError);
        expect((error as SecurityError).reason).toBe(
          'ABSOLUTE_PATH_IN_RELATIVE_CONTEXT'
        );
      }
    });
  });

  describe('validateName', () => {
    it('accepts valid file names', () => {
      expect(validator.validateName('file.md')).toBe('file.md');
    });

    it('accepts names with spaces', () => {
      expect(validator.validateName('my file.md')).toBe('my file.md');
    });

    it('accepts names with dots', () => {
      expect(validator.validateName('file.test.md')).toBe('file.test.md');
    });

    it('rejects empty names', () => {
      expect(() => validator.validateName('')).toThrow(SecurityError);
    });

    it('rejects whitespace-only names', () => {
      expect(() => validator.validateName('   ')).toThrow(SecurityError);
    });

    it('rejects names with forward slash', () => {
      expect(() => validator.validateName('dir/file')).toThrow(SecurityError);
    });

    it('rejects names with backslash', () => {
      expect(() => validator.validateName('dir\\file')).toThrow(SecurityError);
    });

    it('rejects . as name', () => {
      expect(() => validator.validateName('.')).toThrow(SecurityError);
    });

    it('rejects .. as name', () => {
      expect(() => validator.validateName('..')).toThrow(SecurityError);
    });

    it('rejects names with null bytes', () => {
      expect(() => validator.validateName('file\0.md')).toThrow(SecurityError);
    });

    it('rejects names with control characters', () => {
      expect(() => validator.validateName('file\nname')).toThrow(SecurityError);
    });
  });

  describe('validateSymlinkTarget', () => {
    it('accepts symlinks within workspace', () => {
      const result = validator.validateSymlinkTarget(
        '/home/user/workspace/link',
        '/home/user/workspace/target'
      );
      expect(result).toBe('/home/user/workspace/target');
    });

    it('rejects symlinks escaping workspace', () => {
      expect(() =>
        validator.validateSymlinkTarget(
          '/home/user/workspace/link',
          '/etc/passwd'
        )
      ).toThrow(SecurityError);
    });

    it('reports correct error reason for symlink escape', () => {
      try {
        validator.validateSymlinkTarget(
          '/home/user/workspace/link',
          '/home/other/file'
        );
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(SecurityError);
        expect((error as SecurityError).reason).toBe('SYMLINK_ESCAPE');
      }
    });
  });

  describe('isWithinWorkspace', () => {
    it('returns true for paths in workspace', () => {
      expect(validator.isWithinWorkspace('/home/user/workspace/file.md')).toBe(
        true
      );
    });

    it('returns true for workspace root', () => {
      expect(validator.isWithinWorkspace('/home/user/workspace')).toBe(true);
    });

    it('returns false for paths outside workspace', () => {
      expect(validator.isWithinWorkspace('/home/user/other/file.md')).toBe(
        false
      );
    });

    it('returns false for prefix-matching paths', () => {
      // Ensure /workspace-evil doesn't match /workspace
      expect(validator.isWithinWorkspace('/home/user/workspace-evil')).toBe(
        false
      );
    });
  });

  describe('path utilities', () => {
    it('gets parent path', () => {
      expect(validator.getParentPath('/home/user/workspace/docs/file.md')).toBe(
        '/home/user/workspace/docs'
      );
    });

    it('gets file name', () => {
      expect(validator.getFileName('/home/user/workspace/docs/file.md')).toBe(
        'file.md'
      );
    });

    it('gets file extension', () => {
      expect(validator.getExtension('/home/user/workspace/docs/file.md')).toBe(
        'md'
      );
    });

    it('gets relative path', () => {
      expect(
        validator.getRelativePath('/home/user/workspace/docs/file.md')
      ).toBe('docs/file.md');
    });

    it('joins paths', () => {
      expect(validator.joinPath('/home/user', 'workspace', 'file.md')).toBe(
        '/home/user/workspace/file.md'
      );
    });
  });
});
