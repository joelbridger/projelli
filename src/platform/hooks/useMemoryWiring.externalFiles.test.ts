/**
 * useMemoryWiring — WS-B/C external-files regression test.
 *
 * Verifies that when a matter's folder mapping changes, files present on disk
 * but NOT in the cached workspace fileTree (e.g. externally-added files the app
 * has not yet seen) are still discovered and re-indexed correctly.
 *
 * Root cause: the original WS-B/C subscriber read files only from the in-memory
 * cached fileTree (`useWorkspaceStore.getState().fileTree`). Files added to a
 * folder from outside the app would be missing from that cache and never indexed.
 * The fix calls `workspaceService.getFileTree()` (a live disk scan) when
 * available, so the index reflects the actual filesystem state.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/platform/utils/mail-commands', () => ({
  mailBackfillRag: vi.fn().mockResolvedValue(undefined),
  mailRetagFolderMatter: vi.fn().mockResolvedValue(undefined),
  mailSetWorkspace: vi.fn().mockResolvedValue(undefined),
}));

import {
  buildWorkspaceAbsolutePath,
  indexWorkspacePdfs,
  reindexFolderPaths,
  startFullIndex,
} from './useMemoryWiring';
import {
  MemoryService,
  resetPdfIndexingEnabledReader,
  setPdfIndexingEnabledReader,
} from '@/platform/rag/MemoryService';
import { useWorkspaceStore } from '@/platform/fs/workspaceStore';
import { useMatterStore } from '@/platform/matter/matterStore';
import { usePdfIndexProgressStore } from '@/platform/rag/pdfIndexProgressStore';
import type { FileNode } from '@/platform/types/workspace';

// ── Mocks ─────────────────────────────────────────────────────────────────────

// Freeze the MemoryService so we can spy on reindexPaths without touching Tauri.
vi.mock('@/platform/rag/MemoryService', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/platform/rag/MemoryService')>();
  return {
    ...original,
    MemoryService: {
      ...original.MemoryService,
      indexPdfFile: vi.fn().mockResolvedValue({ indexed: true, pageCount: 1 }),
      indexWorkspace: vi.fn().mockResolvedValue(undefined),
      reindexPaths: vi.fn().mockResolvedValue(undefined),
    },
  };
});

// ── Helpers ───────────────────────────────────────────────────────────────────

const makeFile = (path: string): FileNode => ({
  id: path,
  name: path.split('/').pop() ?? path,
  path,
  type: 'file',
});

const makeFolder = (path: string, children: FileNode[]): FileNode => ({
  id: path,
  name: path.split('/').pop() ?? path,
  path,
  type: 'folder',
  children,
});

// Minimal Matter fixture (only the fields resolveMatterIdForPath reads).
const makeMatter = (id: string, folderPaths: string[]) => ({
  id,
  name: `Matter ${id}`,
  client: 'Test Client',
  folderPaths,
  mailFolderPaths: [],
  privileged: false,
  mcpAccessGranted: false,
  createdAt: new Date().toISOString(),
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('reindexFolderPaths — disk scan for externally-added files', () => {
  // Typed reference to the mock so assertions use a local variable (avoids
  // the @typescript-eslint/unbound-method rule when passing methods to expect).
  let reindexPaths: ReturnType<typeof vi.fn>;
  let indexPdfFile: ReturnType<typeof vi.fn>;
  let indexWorkspace: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    // eslint-disable-next-line @typescript-eslint/unbound-method
    reindexPaths = vi.mocked(MemoryService.reindexPaths);
    // eslint-disable-next-line @typescript-eslint/unbound-method
    indexPdfFile = vi.mocked(MemoryService.indexPdfFile);
    // eslint-disable-next-line @typescript-eslint/unbound-method
    indexWorkspace = vi.mocked(MemoryService.indexWorkspace);
    resetPdfIndexingEnabledReader();
    // Start with a stale/empty in-memory file tree to simulate the bug scenario.
    useWorkspaceStore.setState({ rootPath: null, fileTree: [] });
    // Clear matters so each test sets its own state.
    useMatterStore.setState({ matters: [], activeMatterId: null });
    usePdfIndexProgressStore.getState().clear();
  });

  it('builds forward-slash absolute paths from workspace-relative paths', () => {
    expect(
      buildWorkspaceAbsolutePath('C:\\ws\\Northcrest', 'Clients/Acme/x.docx'),
    ).toBe('C:/ws/Northcrest/Clients/Acme/x.docx');
    expect(
      buildWorkspaceAbsolutePath('/ws/Northcrest', 'Clients/Acme/x.docx'),
    ).toBe('/ws/Northcrest/Clients/Acme/x.docx');
    expect(
      buildWorkspaceAbsolutePath('/ws/Northcrest', 'Clients\\Acme\\x.docx'),
    ).toBe('/ws/Northcrest/Clients/Acme/x.docx');
  });

  it('indexes files found on disk even when the cached fileTree is empty', async () => {
    const matterId = 'matter-acme';
    const folder = '/workspace/Acme';

    // On-disk state: two files inside the mapped folder.
    const diskFiles = [
      makeFile('/workspace/Acme/contract.docx'),
      makeFile('/workspace/Acme/notes.txt'),
    ];
    const diskTree = [makeFolder('/workspace/Acme', diskFiles)];

    // Matter is mapped to that folder so resolveMatterIdForPath can resolve correctly.
    useMatterStore.setState({
      matters: [makeMatter(matterId, [folder])],
      activeMatterId: null,
    });

    // Workspace service with getFileTree that returns the fresh disk state.
    const ws = {
      readFile: vi.fn(),
      writeFile: vi.fn(),
      exists: vi.fn(),
      getFileTree: vi.fn().mockResolvedValue(diskTree),
    };

    await reindexFolderPaths([folder], ws);

    // reindexPaths must have been called for the disk files.
    expect(reindexPaths).toHaveBeenCalledTimes(1);
    const [calledPaths, calledMatterId] = reindexPaths.mock.calls[0] as [string[], string];
    expect(calledMatterId).toBe(matterId);
    expect(calledPaths).toEqual(
      expect.arrayContaining([
        '/workspace/Acme/contract.docx',
        '/workspace/Acme/notes.txt',
      ]),
    );
    expect(calledPaths).toHaveLength(2);
  });

  it('falls back to the cached fileTree when getFileTree is not available', async () => {
    const matterId = 'matter-beta';
    const folder = '/workspace/Beta';

    // Cached tree has one file.
    const cachedTree = [
      makeFolder('/workspace/Beta', [makeFile('/workspace/Beta/cached.docx')]),
    ];
    useWorkspaceStore.setState({ fileTree: cachedTree });

    useMatterStore.setState({
      matters: [makeMatter(matterId, [folder])],
      activeMatterId: null,
    });

    // No getFileTree — workspace service only has the required methods.
    const ws = {
      readFile: vi.fn(),
      writeFile: vi.fn(),
      exists: vi.fn(),
      // getFileTree intentionally absent
    };

    await reindexFolderPaths([folder], ws);

    expect(reindexPaths).toHaveBeenCalledTimes(1);
    const [calledPaths, calledMatterId] = reindexPaths.mock.calls[0] as [string[], string];
    expect(calledMatterId).toBe(matterId);
    expect(calledPaths).toEqual(['/workspace/Beta/cached.docx']);
  });

  it('falls back to cached fileTree when getFileTree rejects', async () => {
    const matterId = 'matter-gamma';
    const folder = '/workspace/Gamma';

    const cachedTree = [
      makeFolder('/workspace/Gamma', [makeFile('/workspace/Gamma/fallback.docx')]),
    ];
    useWorkspaceStore.setState({ fileTree: cachedTree });

    useMatterStore.setState({
      matters: [makeMatter(matterId, [folder])],
      activeMatterId: null,
    });

    const ws = {
      readFile: vi.fn(),
      writeFile: vi.fn(),
      exists: vi.fn(),
      getFileTree: vi.fn().mockRejectedValue(new Error('disk error')),
    };

    await reindexFolderPaths([folder], ws);

    expect(reindexPaths).toHaveBeenCalledTimes(1);
    const [calledPaths] = reindexPaths.mock.calls[0] as [string[], string];
    expect(calledPaths).toEqual(['/workspace/Gamma/fallback.docx']);
  });

  it('groups files across multiple changed folders by their resolved matter', async () => {
    const matterA = 'matter-alpha';
    const matterB = 'matter-bravo';
    const folderA = '/workspace/Alpha';
    const folderB = '/workspace/Bravo';

    useMatterStore.setState({
      matters: [
        makeMatter(matterA, [folderA]),
        makeMatter(matterB, [folderB]),
      ],
      activeMatterId: null,
    });

    const diskTree = [
      makeFolder('/workspace/Alpha', [makeFile('/workspace/Alpha/a1.docx')]),
      makeFolder('/workspace/Bravo', [makeFile('/workspace/Bravo/b1.docx')]),
    ];

    const ws = {
      readFile: vi.fn(),
      writeFile: vi.fn(),
      exists: vi.fn(),
      getFileTree: vi.fn().mockResolvedValue(diskTree),
    };

    await reindexFolderPaths([folderA, folderB], ws);

    // Two separate reindexPaths calls — one per matter.
    expect(reindexPaths).toHaveBeenCalledTimes(2);
    const calls = reindexPaths.mock.calls as [string[], string][];
    const byMatter = new Map(calls.map(([paths, id]) => [id, paths]));
    expect(byMatter.get(matterA)).toEqual(['/workspace/Alpha/a1.docx']);
    expect(byMatter.get(matterB)).toEqual(['/workspace/Bravo/b1.docx']);
  });

  it('does nothing when no files fall under the changed folders', async () => {
    useMatterStore.setState({ matters: [], activeMatterId: null });

    const ws = {
      readFile: vi.fn(),
      writeFile: vi.fn(),
      exists: vi.fn(),
      getFileTree: vi.fn().mockResolvedValue([makeFile('/workspace/Other/unrelated.docx')]),
    };

    await reindexFolderPaths(['/workspace/Acme'], ws);

    expect(reindexPaths).not.toHaveBeenCalled();
  });

  it('reindexes office/text and PDF files with absolute forward-slash paths', async () => {
    const matterId = 'matter-acme';
    const folder = 'Clients/Acme';

    setPdfIndexingEnabledReader(() => true);
    useWorkspaceStore.setState({
      rootPath: 'C:\\ws\\Northcrest',
      fileTree: [],
    });
    useMatterStore.setState({
      matters: [makeMatter(matterId, [folder])],
      activeMatterId: null,
    });

    const diskTree = [
      makeFolder(folder, [
        makeFile('Clients/Acme/plan.docx'),
        makeFile('Clients/Acme/notes.txt'),
        makeFile('Clients/Acme/statement.pdf'),
      ]),
    ];
    const ws = {
      readFile: vi.fn(),
      writeFile: vi.fn(),
      exists: vi.fn(),
      readFileBinary: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
      getFileTree: vi.fn().mockResolvedValue(diskTree),
    };

    await reindexFolderPaths([folder], ws);

    expect(reindexPaths).toHaveBeenCalledTimes(1);
    const [calledPaths, calledMatterId] = reindexPaths.mock.calls[0] as [string[], string];
    expect(calledMatterId).toBe(matterId);
    expect(calledPaths).toEqual([
      'C:/ws/Northcrest/Clients/Acme/plan.docx',
      'C:/ws/Northcrest/Clients/Acme/notes.txt',
    ]);
    expect(calledPaths).not.toContain('Clients/Acme/statement.pdf');

    expect(indexPdfFile).toHaveBeenCalledTimes(1);
    const [pdfPath, pdfWorkspace] = indexPdfFile.mock.calls[0] as [
      string,
      { readBinary: (path: string) => Promise<ArrayBuffer> },
    ];
    expect(pdfPath).toBe('C:/ws/Northcrest/Clients/Acme/statement.pdf');
    expect(typeof pdfWorkspace.readBinary).toBe('function');
  });

  it('indexes PDFs from a fresh disk scan when the cached tree is empty on workspace open', async () => {
    setPdfIndexingEnabledReader(() => true);
    useWorkspaceStore.setState({
      rootPath: 'C:\\ws\\Northcrest',
      fileTree: [],
    });

    const ws = {
      readFile: vi.fn(),
      writeFile: vi.fn(),
      exists: vi.fn(),
      readFileBinary: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
      getFileTree: vi.fn().mockResolvedValue([
        makeFolder('Clients/Acme', [
          makeFile('Clients/Acme/Email - DAF grant request spring board meeting.pdf'),
        ]),
      ]),
    };

    await indexWorkspacePdfs(ws);

    expect(ws.getFileTree).toHaveBeenCalledTimes(1);
    expect(indexPdfFile).toHaveBeenCalledTimes(1);
    const [pdfPath] = indexPdfFile.mock.calls[0] as [string];
    expect(pdfPath).toBe(
      'C:/ws/Northcrest/Clients/Acme/Email - DAF grant request spring board meeting.pdf',
    );
  });

  it('skips PDFs during folder reindex when PDF indexing is disabled', async () => {
    const matterId = 'matter-acme';
    const folder = 'Clients/Acme';

    useWorkspaceStore.setState({
      rootPath: '/ws/Northcrest',
      fileTree: [],
    });
    useMatterStore.setState({
      matters: [makeMatter(matterId, [folder])],
      activeMatterId: null,
    });

    const ws = {
      readFile: vi.fn(),
      writeFile: vi.fn(),
      exists: vi.fn(),
      readFileBinary: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
      getFileTree: vi.fn().mockResolvedValue([
        makeFolder(folder, [makeFile('Clients/Acme/statement.pdf')]),
      ]),
    };

    await reindexFolderPaths([folder], ws);

    expect(reindexPaths).not.toHaveBeenCalled();
    expect(indexPdfFile).not.toHaveBeenCalled();
  });

  it('retags existing matter folders after the initial full workspace index', async () => {
    const matterId = 'matter-acme';
    const folder = 'Clients/Acme';

    useWorkspaceStore.setState({
      rootPath: '/ws/Northcrest',
      fileTree: [],
    });
    useMatterStore.setState({
      matters: [makeMatter(matterId, [folder])],
      activeMatterId: null,
    });

    const ws = {
      readFile: vi.fn(),
      writeFile: vi.fn(),
      exists: vi.fn(),
      getFileTree: vi.fn().mockResolvedValue([
        makeFolder(folder, [makeFile('Clients/Acme/plan.docx')]),
      ]),
    };
    const indexPromise = Promise.resolve().then(() => {
      expect(reindexPaths).not.toHaveBeenCalled();
    });
    indexWorkspace.mockReturnValue(indexPromise);

    await startFullIndex(ws);

    expect(indexWorkspace).toHaveBeenCalledTimes(1);
    expect(reindexPaths).toHaveBeenCalledTimes(1);
    expect(reindexPaths).toHaveBeenCalledWith(
      ['/ws/Northcrest/Clients/Acme/plan.docx'],
      matterId,
    );
  });

  it('retags an initial import when matter folders are absolute but the fresh tree is relative', async () => {
    const matterId = 'matter-acme';
    const absoluteFolder = 'C:/ws/Northcrest/Clients/Acme';

    useWorkspaceStore.setState({
      rootPath: 'C:\\ws\\Northcrest',
      fileTree: [],
    });
    useMatterStore.setState({
      matters: [makeMatter(matterId, [absoluteFolder])],
      activeMatterId: null,
    });

    const ws = {
      readFile: vi.fn(),
      writeFile: vi.fn(),
      exists: vi.fn(),
      getFileTree: vi.fn().mockResolvedValue([
        makeFolder('Clients/Acme', [makeFile('Clients/Acme/plan.docx')]),
      ]),
    };

    await startFullIndex(ws);

    expect(reindexPaths).toHaveBeenCalledWith(
      ['C:/ws/Northcrest/Clients/Acme/plan.docx'],
      matterId,
    );
  });
});
