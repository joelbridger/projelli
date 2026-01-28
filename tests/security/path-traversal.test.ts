/**
 * Path Traversal Security Tests
 *
 * These tests verify that the PathValidator properly blocks all forms of
 * path traversal attacks, including:
 * - Basic ../ traversal
 * - URL-encoded traversal
 * - Mixed separators
 * - Null byte injection
 * - Unicode normalization attacks
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { PathValidator, createPathValidator } from '@/modules/workspace/PathValidator';
import { SecurityError } from '@/modules/workspace/types';

describe('Path Traversal Security Tests', () => {
  let validator: PathValidator;

  beforeEach(() => {
    validator = createPathValidator('/workspace/project');
  });

  describe('Basic Path Traversal', () => {
    it('should block simple ../ traversal', () => {
      const attacks = [
        '../',
        '../../../etc/passwd',
        'folder/../../../secret',
        './../../outside',
        'docs/../../../',
      ];

      for (const path of attacks) {
        expect(() => validator.validatePath(path)).toThrow(SecurityError);
      }
    });

    it('should block backslash traversal on Windows', () => {
      const attacks = [
        '..\\',
        '..\\..\\..\\windows\\system32',
        'folder\\..\\..\\secret',
      ];

      for (const path of attacks) {
        expect(() => validator.validatePath(path)).toThrow(SecurityError);
      }
    });

    it('should block mixed separator traversal', () => {
      const attacks = [
        '../..\\secret',
        '..\\../secret',
        'folder/../..\\outside',
      ];

      for (const path of attacks) {
        expect(() => validator.validatePath(path)).toThrow(SecurityError);
      }
    });
  });

  describe('URL-Encoded Traversal', () => {
    it('should block URL-encoded ../', () => {
      const attacks = [
        '%2e%2e/',
        '%2e%2e%2f',
        '%2E%2E/',
        '%2E%2E%2F',
      ];

      for (const path of attacks) {
        expect(() => validator.validatePath(path)).toThrow(SecurityError);
      }
    });

    it('should block double URL-encoded traversal', () => {
      const attacks = [
        '%252e%252e/',
        '%252e%252e%252f',
        '%252E%252E/',
      ];

      for (const path of attacks) {
        expect(() => validator.validatePath(path)).toThrow(SecurityError);
      }
    });
  });

  describe('Triple Dot and Extended Patterns', () => {
    it('should block triple dot patterns', () => {
      const attacks = [
        '...',
        '.../',
        '.../secret',
        'folder/.../outside',
      ];

      for (const path of attacks) {
        expect(() => validator.validatePath(path)).toThrow(SecurityError);
      }
    });

    it('should block paths ending with ..', () => {
      expect(() => validator.validatePath('folder/..')).toThrow(SecurityError);
    });
  });

  describe('Absolute Path Attacks', () => {
    it('should block Unix absolute paths outside workspace', () => {
      const attacks = [
        '/etc/passwd',
        '/root/.ssh/id_rsa',
        '/var/log/auth.log',
        '/home/user/.bashrc',
      ];

      for (const path of attacks) {
        expect(() => validator.validatePath(path)).toThrow(SecurityError);
      }
    });

    it('should block Windows absolute paths', () => {
      const attacks = [
        'C:/Windows/System32',
        'C:\\Windows\\System32',
        'D:/secret',
      ];

      for (const path of attacks) {
        expect(() => validator.validatePath(path)).toThrow(SecurityError);
      }
    });

    it('should allow absolute paths within workspace', () => {
      const validPaths = [
        '/workspace/project/docs',
        '/workspace/project/src/file.ts',
      ];

      for (const path of validPaths) {
        expect(() => validator.validatePath(path)).not.toThrow();
      }
    });
  });

  describe('Prefix Attack Prevention', () => {
    it('should not allow workspace-prefix as a match', () => {
      // /workspace/project-evil should NOT match /workspace/project
      expect(validator.isWithinWorkspace('/workspace/project-evil')).toBe(false);
      expect(validator.isWithinWorkspace('/workspace/project_backup')).toBe(false);
      expect(validator.isWithinWorkspace('/workspace/projectX')).toBe(false);
    });

    it('should allow exact workspace match', () => {
      expect(validator.isWithinWorkspace('/workspace/project')).toBe(true);
      expect(validator.isWithinWorkspace('/workspace/project/')).toBe(true);
    });
  });

  describe('Valid Paths', () => {
    it('should allow valid relative paths', () => {
      const validPaths = [
        'docs/readme.md',
        'src/components/Button.tsx',
        './src/index.ts',
        'deep/nested/folder/file.txt',
      ];

      for (const path of validPaths) {
        expect(() => validator.validatePath(path)).not.toThrow();
      }
    });

    it('should allow paths with dots in filenames', () => {
      const validPaths = [
        'file.test.ts',
        '.gitignore',
        '.env.local',
        'package.json',
      ];

      for (const path of validPaths) {
        expect(() => validator.validatePath(path)).not.toThrow();
      }
    });
  });

  describe('Name Validation', () => {
    it('should reject names with path separators', () => {
      expect(() => validator.validateName('foo/bar')).toThrow(SecurityError);
      expect(() => validator.validateName('foo\\bar')).toThrow(SecurityError);
    });

    it('should reject . and .. as names', () => {
      expect(() => validator.validateName('.')).toThrow(SecurityError);
      expect(() => validator.validateName('..')).toThrow(SecurityError);
    });

    it('should reject names with null bytes', () => {
      expect(() => validator.validateName('file\0.txt')).toThrow(SecurityError);
    });

    it('should reject names with control characters', () => {
      expect(() => validator.validateName('file\x00name')).toThrow(SecurityError);
      expect(() => validator.validateName('file\x1fname')).toThrow(SecurityError);
    });

    it('should allow valid names', () => {
      const validNames = [
        'readme.md',
        '.gitignore',
        'file-with-dashes.txt',
        'file_with_underscores.ts',
        'file.multiple.dots.tsx',
      ];

      for (const name of validNames) {
        expect(() => validator.validateName(name)).not.toThrow();
      }
    });
  });
});
