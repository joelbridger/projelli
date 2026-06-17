/**
 * Integration Tests for Workspace Operations
 *
 * Tests the complete workspace lifecycle including:
 * - Workspace initialization
 * - File CRUD operations
 * - Folder operations
 * - Path validation integration
 * - File tree operations
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WorkspaceService } from '@/platform/fs/WorkspaceService';
import type { FSBackend, FileStat } from '@/platform/fs/types';
import type { FileNode } from '@/types/workspace';

/**
 * Create a mock FSBackend for testing
 */
function createMockFSBackend(): FSBackend & {
  files: Map<string, { content: string | ArrayBuffer; stat: FileStat }>;
} {
  const files = new Map<string, { content: string | ArrayBuffer; stat: FileStat }>();
  let rootPath = '';

  return {
    files,

    setRootPath: vi.fn(async (path: string) => {
      rootPath = path;
      // Note: setRootPath doesn't create the folder itself
      // The caller is expected to check exists() and mkdir() if needed
    }),

    getRootPath: vi.fn(() => rootPath),

    exists: vi.fn(async (path: string) => {
      // WorkspaceService.initialize calls exists('') to check the root.
      // Tests seed the root by adding an entry keyed at TEST_ROOT, so we
      // map '' to "is rootPath seeded in files". Symmetric with the
      // stat() shim further down.
      if (path === '' || path === rootPath) {
        return rootPath !== '' && files.has(rootPath);
      }
      return files.has(path);
    }),

    stat: vi.fn(async (path: string): Promise<FileStat> => {
      // WorkspaceService.initialize calls stat('') to verify the root
      // exists and is a directory. Synthesize a folder stat for the
      // empty-string root path (and the literal rootPath for symmetry)
      // so the integration tests don't have to seed a "" entry manually.
      if (path === '' || path === rootPath) {
        return {
          path: '',
          name: rootPath.split('/').pop() || '',
          type: 'folder',
          size: 0,
          createdAt: new Date(),
          modifiedAt: new Date(),
        };
      }
      const file = files.get(path);
      if (!file) {
        throw new Error(`Path not found: ${path}`);
      }
      return file.stat;
    }),

    read: vi.fn(async (path: string): Promise<string> => {
      const file = files.get(path);
      if (!file) {
        throw new Error(`File not found: ${path}`);
      }
      if (typeof file.content !== 'string') {
        throw new Error(`Cannot read binary file as string: ${path}`);
      }
      return file.content;
    }),

    readBinary: vi.fn(async (path: string): Promise<ArrayBuffer> => {
      const file = files.get(path);
      if (!file) {
        throw new Error(`File not found: ${path}`);
      }
      if (typeof file.content === 'string') {
        const encoder = new TextEncoder();
        return encoder.encode(file.content).buffer;
      }
      return file.content;
    }),

    write: vi.fn(async (path: string, content: string) => {
      const name = path.split('/').pop() || 'file';
      files.set(path, {
        content,
        stat: {
          path,
          name,
          type: 'file',
          size: content.length,
          createdAt: files.get(path)?.stat.createdAt || new Date(),
          modifiedAt: new Date(),
        },
      });
    }),

    writeBinary: vi.fn(async (path: string, content: ArrayBuffer) => {
      const name = path.split('/').pop() || 'file';
      files.set(path, {
        content,
        stat: {
          path,
          name,
          type: 'file',
          size: content.byteLength,
          createdAt: files.get(path)?.stat.createdAt || new Date(),
          modifiedAt: new Date(),
        },
      });
    }),

    delete: vi.fn(async (path: string) => {
      // Delete this path and all children
      const keysToDelete: string[] = [];
      for (const key of files.keys()) {
        if (key === path || key.startsWith(path + '/')) {
          keysToDelete.push(key);
        }
      }
      keysToDelete.forEach((key) => files.delete(key));
    }),

    move: vi.fn(async (from: string, to: string) => {
      const file = files.get(from);
      if (!file) {
        throw new Error(`Source not found: ${from}`);
      }
      files.set(to, {
        ...file,
        stat: {
          ...file.stat,
          path: to,
          name: to.split('/').pop() || 'file',
        },
      });
      files.delete(from);
    }),

    copy: vi.fn(async (from: string, to: string) => {
      const file = files.get(from);
      if (!file) {
        throw new Error(`Source not found: ${from}`);
      }
      files.set(to, {
        content: file.content,
        stat: {
          ...file.stat,
          path: to,
          name: to.split('/').pop() || 'file',
          createdAt: new Date(),
          modifiedAt: new Date(),
        },
      });
    }),

    mkdir: vi.fn(async (path: string) => {
      const name = path.split('/').pop() || 'folder';
      files.set(path, {
        content: '',
        stat: {
          path,
          name,
          type: 'folder',
          size: 0,
          createdAt: new Date(),
          modifiedAt: new Date(),
        },
      });
    }),

    list: vi.fn(async (path: string): Promise<FileNode[]> => {
      const result: FileNode[] = [];
      // WorkspaceService writes go through toBackendPath(), which produces
      // paths RELATIVE to the workspace root. So entries land in the map
      // as 'file1.md', 'docs/readme.md' etc. The root itself was seeded
      // with the absolute TEST_ROOT key in beforeEach — skip it.
      // path === '' means "list root level" → entries with no '/'.
      // path === '<sub>' means "list under <sub>/" → entries that start
      // with '<sub>/' and have no further '/' after.
      for (const [key, file] of files.entries()) {
        if (key === rootPath) continue; // Skip seeded absolute root entry

        let relativeFromBase: string | null = null;
        if (path === '') {
          relativeFromBase = key;
        } else {
          const prefix = path.endsWith('/') ? path : path + '/';
          if (key.startsWith(prefix)) {
            relativeFromBase = key.substring(prefix.length);
          }
        }
        if (relativeFromBase === null) continue;
        if (relativeFromBase === '') continue; // The directory itself
        if (relativeFromBase.includes('/')) continue; // Not a direct child

        result.push({
          path: key,
          name: file.stat.name,
          type: file.stat.type,
          children: file.stat.type === 'folder' ? [] : undefined,
        });
      }

      return result;
    }),

    rename: vi.fn(async (path: string, newName: string) => {
      const file = files.get(path);
      if (!file) {
        throw new Error(`File not found: ${path}`);
      }
      // Backend receives relative paths from WorkspaceService.toBackendPath
      // (so 'old-name.md' instead of '/test/workspace/old-name.md'). Compute
      // the new path correctly whether `path` is absolute or relative.
      const lastSlash = path.lastIndexOf('/');
      const parentPath = lastSlash > 0 ? path.substring(0, lastSlash) : '';
      const newPath = parentPath ? `${parentPath}/${newName}` : newName;
      files.set(newPath, {
        ...file,
        stat: {
          ...file.stat,
          path: newPath,
          name: newName,
        },
      });
      files.delete(path);
    }),

    isSymlink: vi.fn(async () => false),

    resolveSymlink: vi.fn(async () => null),

    getSymlinkTarget: vi.fn(async () => null),

    readDir: vi.fn(async (path: string): Promise<FileStat[]> => {
      const result: FileStat[] = [];
      const pathWithSlash = path.endsWith('/') ? path : path + '/';

      for (const [key, file] of files.entries()) {
        if (key.startsWith(pathWithSlash)) {
          const relativePath = key.substring(pathWithSlash.length);
          if (!relativePath.includes('/')) {
            result.push(file.stat);
          }
        }
      }

      return result;
    }),
  };
}

describe('Workspace Integration Tests', () => {
  let workspaceService: WorkspaceService;
  let mockBackend: ReturnType<typeof createMockFSBackend>;
  const TEST_ROOT = '/test/workspace';

  beforeEach(() => {
    workspaceService = new WorkspaceService();
    mockBackend = createMockFSBackend();
    // Pre-create the test root folder for tests that expect it to exist
    mockBackend.files.set(TEST_ROOT, {
      content: '',
      stat: {
        path: TEST_ROOT,
        name: 'workspace',
        type: 'folder',
        size: 0,
        createdAt: new Date(),
        modifiedAt: new Date(),
      },
    });
  });

  describe('Workspace Initialization', () => {
    it('initializes workspace with existing folder', async () => {
      const workspace = await workspaceService.initialize(mockBackend, TEST_ROOT);

      expect(workspace).toBeDefined();
      expect(workspace.rootPath).toBe(TEST_ROOT);
      expect(workspace.name).toBe('workspace');
      expect(workspaceService.isInitialized()).toBe(true);
    });

    it('creates workspace folder if createIfMissing is true', async () => {
      // Use a different path that doesn't exist
      const newRoot = '/new/workspace/path';

      await workspaceService.initialize(mockBackend, newRoot, {
        createIfMissing: true,
      });

      expect(mockBackend.mkdir).toHaveBeenCalledWith(newRoot);
      expect(workspaceService.isInitialized()).toBe(true);
    });

    it('creates default folder structure', async () => {
      await workspaceService.initialize(mockBackend, TEST_ROOT, {
        createDefaultStructure: true,
      });

      // Should have created default folders (documents, research, exports, etc.)
      // The exact folders depend on DEFAULT_WORKSPACE_FOLDERS constant
      expect(mockBackend.mkdir).toHaveBeenCalled();
    });

    it('throws error for non-existent path without createIfMissing', async () => {
      // Use a path that doesn't exist
      const nonExistentPath = '/nonexistent/path';

      await expect(
        workspaceService.initialize(mockBackend, nonExistentPath)
      ).rejects.toThrow('does not exist');
    });
  });

  describe('File Operations', () => {
    beforeEach(async () => {
      await workspaceService.initialize(mockBackend, TEST_ROOT);
    });

    it('reads and writes files correctly', async () => {
      const testPath = `${TEST_ROOT}/test.md`;
      const testContent = '# Test Document\n\nHello, world!';

      await workspaceService.writeFile(testPath, testContent);
      const content = await workspaceService.readFile(testPath);

      expect(content).toBe(testContent);
    });

    it('checks file existence', async () => {
      const testPath = `${TEST_ROOT}/exists.md`;

      expect(await workspaceService.exists(testPath)).toBe(false);

      await workspaceService.writeFile(testPath, 'content');

      expect(await workspaceService.exists(testPath)).toBe(true);
    });

    it('creates parent directories when writing files', async () => {
      const testPath = `${TEST_ROOT}/nested/deep/test.md`;

      await workspaceService.writeFile(testPath, 'content');

      expect(mockBackend.mkdir).toHaveBeenCalled();
    });

    it('deletes files', async () => {
      const testPath = `${TEST_ROOT}/to-delete.md`;
      await workspaceService.writeFile(testPath, 'content');

      expect(await workspaceService.exists(testPath)).toBe(true);

      await workspaceService.delete(testPath);

      expect(await workspaceService.exists(testPath)).toBe(false);
    });
  });

  describe('Folder Operations', () => {
    beforeEach(async () => {
      await workspaceService.initialize(mockBackend, TEST_ROOT);
    });

    it('creates folders', async () => {
      const folderPath = `${TEST_ROOT}/new-folder`;

      await workspaceService.mkdir(folderPath);

      expect(await workspaceService.exists(folderPath)).toBe(true);
    });

    it('deletes folders and contents', async () => {
      const folderPath = `${TEST_ROOT}/folder-to-delete`;
      const filePath = `${folderPath}/file.md`;

      await workspaceService.mkdir(folderPath);
      await workspaceService.writeFile(filePath, 'content');

      await workspaceService.delete(folderPath);

      expect(await workspaceService.exists(folderPath)).toBe(false);
      expect(await workspaceService.exists(filePath)).toBe(false);
    });
  });

  describe('Path Validation', () => {
    beforeEach(async () => {
      await workspaceService.initialize(mockBackend, TEST_ROOT);
    });

    it('blocks path traversal attempts', async () => {
      await expect(
        workspaceService.readFile(`${TEST_ROOT}/../../../etc/passwd`)
      ).rejects.toThrow();
    });

    it('allows valid nested paths', async () => {
      const testPath = `${TEST_ROOT}/folder/test.md`;

      await workspaceService.writeFile(testPath, 'content');

      // Should work with nested path
      const content = await workspaceService.readFile(testPath);
      expect(content).toBe('content');
    });
  });

  describe('File Tree Operations', () => {
    beforeEach(async () => {
      await workspaceService.initialize(mockBackend, TEST_ROOT);
    });

    it('lists directory contents', async () => {
      await workspaceService.writeFile(`${TEST_ROOT}/file1.md`, 'content1');
      await workspaceService.writeFile(`${TEST_ROOT}/file2.md`, 'content2');
      await workspaceService.mkdir(`${TEST_ROOT}/folder`);

      // getFileTree returns FileNode[] (array of root-level items)
      const fileTree = await workspaceService.getFileTree();

      expect(fileTree).toBeDefined();
      expect(Array.isArray(fileTree)).toBe(true);
      expect(fileTree.length).toBeGreaterThanOrEqual(3);
    });

    it('returns hierarchical file tree', async () => {
      await workspaceService.mkdir(`${TEST_ROOT}/docs`);
      await workspaceService.writeFile(`${TEST_ROOT}/docs/readme.md`, 'content');

      // getFileTree returns FileNode[] (array of root-level items)
      const fileTree = await workspaceService.getFileTree();

      // Find the docs folder in the array
      const docsFolder = fileTree.find((c) => c.name === 'docs');
      expect(docsFolder).toBeDefined();
      expect(docsFolder?.type).toBe('folder');
    });
  });

  describe('Move and Rename Operations', () => {
    beforeEach(async () => {
      await workspaceService.initialize(mockBackend, TEST_ROOT);
    });

    it('moves files between folders', async () => {
      const sourcePath = `${TEST_ROOT}/source.md`;
      const destFolder = `${TEST_ROOT}/dest`;
      const destPath = `${destFolder}/moved.md`;

      await workspaceService.writeFile(sourcePath, 'content');
      await workspaceService.mkdir(destFolder);

      await workspaceService.move(sourcePath, destPath);

      expect(await workspaceService.exists(sourcePath)).toBe(false);
      expect(await workspaceService.exists(destPath)).toBe(true);
    });

    it('renames files', async () => {
      const oldPath = `${TEST_ROOT}/old-name.md`;
      const newPath = `${TEST_ROOT}/new-name.md`;

      await workspaceService.writeFile(oldPath, 'content');

      await workspaceService.rename(oldPath, 'new-name.md');

      expect(await workspaceService.exists(oldPath)).toBe(false);
      expect(await workspaceService.exists(newPath)).toBe(true);
    });
  });

  describe('Copy Operations', () => {
    beforeEach(async () => {
      await workspaceService.initialize(mockBackend, TEST_ROOT);
    });

    it('copies files', async () => {
      const sourcePath = `${TEST_ROOT}/source.md`;
      const destPath = `${TEST_ROOT}/copy.md`;

      await workspaceService.writeFile(sourcePath, 'original content');

      await workspaceService.copy(sourcePath, destPath);

      expect(await workspaceService.exists(sourcePath)).toBe(true);
      expect(await workspaceService.exists(destPath)).toBe(true);
      expect(await workspaceService.readFile(destPath)).toBe('original content');
    });
  });

  describe('Workspace Lifecycle', () => {
    it('closes workspace and clears state', async () => {
      await workspaceService.initialize(mockBackend, TEST_ROOT);

      expect(workspaceService.isInitialized()).toBe(true);

      workspaceService.close();

      expect(workspaceService.isInitialized()).toBe(false);
      expect(workspaceService.getWorkspace()).toBeNull();
    });

    it('can reinitialize after closing', async () => {
      await workspaceService.initialize(mockBackend, TEST_ROOT);
      workspaceService.close();

      const workspace = await workspaceService.initialize(mockBackend, TEST_ROOT);

      expect(workspace).toBeDefined();
      expect(workspaceService.isInitialized()).toBe(true);
    });
  });

  describe('Error Handling', () => {
    it('throws when operations attempted before initialization', async () => {
      // Don't initialize

      await expect(
        workspaceService.readFile(`${TEST_ROOT}/file.md`)
      ).rejects.toThrow('not initialized');
    });

    it('wraps backend errors with context', async () => {
      await workspaceService.initialize(mockBackend, TEST_ROOT);

      // Reading non-existent file should throw with context
      await expect(
        workspaceService.readFile(`${TEST_ROOT}/nonexistent.md`)
      ).rejects.toThrow('Failed to read file');
    });
  });
});

describe('Workspace Full Integration Flow', () => {
  it('simulates complete user workspace session', async () => {
    const workspaceService = new WorkspaceService();
    const mockBackend = createMockFSBackend();
    const WORKSPACE_ROOT = '/user/mybusiness';

    // 1. Initialize new workspace
    await workspaceService.initialize(mockBackend, WORKSPACE_ROOT, {
      createIfMissing: true,
      createDefaultStructure: true,
    });

    // 2. Create project documents
    await workspaceService.writeFile(
      `${WORKSPACE_ROOT}/VISION.md`,
      '# Vision\n\nBuilding the future...'
    );
    await workspaceService.writeFile(
      `${WORKSPACE_ROOT}/PRD.md`,
      '# Product Requirements\n\n## Overview'
    );

    // 3. Organize into folders
    await workspaceService.mkdir(`${WORKSPACE_ROOT}/planning`);
    await workspaceService.move(
      `${WORKSPACE_ROOT}/VISION.md`,
      `${WORKSPACE_ROOT}/planning/VISION.md`
    );

    // 4. Verify structure - getFileTree returns FileNode[]
    const fileTree = await workspaceService.getFileTree();
    expect(fileTree.some((c) => c.name === 'planning')).toBe(true);

    // 5. Read and edit file
    const vision = await workspaceService.readFile(
      `${WORKSPACE_ROOT}/planning/VISION.md`
    );
    expect(vision).toContain('Vision');

    await workspaceService.writeFile(
      `${WORKSPACE_ROOT}/planning/VISION.md`,
      vision + '\n\nUpdated content.'
    );

    const updatedVision = await workspaceService.readFile(
      `${WORKSPACE_ROOT}/planning/VISION.md`
    );
    expect(updatedVision).toContain('Updated content');

    // 6. Close workspace
    workspaceService.close();
    expect(workspaceService.isInitialized()).toBe(false);
  });
});
