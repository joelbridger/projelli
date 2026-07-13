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

vi.mock('@/platform/utils/onedrive-commands', () => ({
  oneDriveSetWorkspace: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/platform/utils/sharefile-commands', () => ({
  sharefileSetWorkspace: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/platform/utils/addepar-commands', () => ({
  addeparSetWorkspace: vi.fn().mockResolvedValue(undefined),
}));

const { pdfIndexPlan } = vi.hoisted(() => ({
  pdfIndexPlan: vi.fn((paths: string[]) => Promise.resolve(paths)),
}));

vi.mock('@/platform/utils/tauri-commands', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/platform/utils/tauri-commands')>();
  return {
    ...original,
    // Finding #19: the fixed path asks once for the real work list.
    ragPlanPdfIndex: pdfIndexPlan,
  };
});

import {
  buildWorkspaceAbsolutePath,
  changedFolderPaths,
  indexWorkspacePdfs,
  reindexFolderPaths,
  retagExistingMatterFolderPaths,
  startFullIndex,
} from './useMemoryWiring';
import {
  attachCrmHouseholdFolderIfUnmapped,
  buildClaimedCrmFolderSet,
} from '@/platform/matter/crmMatterFolderBackfill';
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
      reindexPaths: vi.fn().mockResolvedValue(0),
      // P1.1: the boot retag now moves rows IN PLACE (batched) instead of re-embedding.
      // QA-92: retagMatterBatch resolves the PER-PATH misses ([] = all retagged).
      retagMatter: vi.fn().mockResolvedValue(1),
      retagMatterBatch: vi.fn().mockResolvedValue([]),
      retagPrivilege: vi.fn().mockResolvedValue(1),
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
  let retagMatter: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    // eslint-disable-next-line @typescript-eslint/unbound-method
    reindexPaths = vi.mocked(MemoryService.reindexPaths);
    // eslint-disable-next-line @typescript-eslint/unbound-method
    indexPdfFile = vi.mocked(MemoryService.indexPdfFile);
    // eslint-disable-next-line @typescript-eslint/unbound-method
    indexWorkspace = vi.mocked(MemoryService.indexWorkspace);
    // eslint-disable-next-line @typescript-eslint/unbound-method
    retagMatter = vi.mocked(MemoryService.retagMatterBatch);
    resetPdfIndexingEnabledReader();
    // Start with a stale/empty in-memory file tree to simulate the bug scenario.
    useWorkspaceStore.setState({ rootPath: null, rootGeneration: 0, fileTree: [] });
    // Clear matters so each test sets its own state.
    useMatterStore.setState({ matters: [], activeMatterId: null });
    usePdfIndexProgressStore.getState().clear();
    pdfIndexPlan.mockReset();
    pdfIndexPlan.mockImplementation((paths: string[]) => Promise.resolve(paths));
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

  it('QA-44: throws when a file fails to re-tag, so the caller keeps folders excluded and retries', async () => {
    const matterId = 'matter-fail';
    const folder = '/workspace/FailFolder';
    const cachedTree = [
      makeFolder('/workspace/FailFolder', [makeFile('/workspace/FailFolder/doc.docx')]),
    ];
    useWorkspaceStore.setState({ fileTree: cachedTree });
    useMatterStore.setState({ matters: [makeMatter(matterId, [folder])], activeMatterId: null });

    // reindexPaths reports 1 file failed to re-tag (it never throws itself).
    reindexPaths.mockResolvedValueOnce(1);

    const ws = { readFile: vi.fn(), writeFile: vi.fn(), exists: vi.fn() };

    await expect(reindexFolderPaths([folder], ws)).rejects.toThrow(/failed to re-tag/);
  });

  it('bails instead of reindexing folder paths when the workspace switches during the fresh file scan', async () => {
    const folder = 'Clients/Acme';
    let resolveTree!: (tree: FileNode[]) => void;

    useWorkspaceStore.getState().setRootPath('/ws/A');
    useMatterStore.setState({
      matters: [makeMatter('matter-acme', [folder])],
      activeMatterId: null,
    });

    const ws = {
      readFile: vi.fn(),
      writeFile: vi.fn(),
      exists: vi.fn(),
      getFileTree: vi.fn().mockImplementation(
        () =>
          new Promise<FileNode[]>((resolve) => {
            resolveTree = resolve;
          }),
      ),
    };

    const reindexPromise = reindexFolderPaths([folder], ws);

    useWorkspaceStore.getState().setRootPath('/ws/B');
    resolveTree([
      makeFolder(folder, [makeFile('Clients/Acme/plan.docx')]),
    ]);
    await reindexPromise;

    expect(reindexPaths).not.toHaveBeenCalled();
    expect(indexPdfFile).not.toHaveBeenCalled();
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

  it('shows no PDF work on restart when every saved PDF is unchanged', async () => {
    setPdfIndexingEnabledReader(() => true);
    pdfIndexPlan.mockResolvedValue([]);
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
          makeFile('Clients/Acme/statement.pdf'),
          makeFile('Clients/Acme/tax-return.pdf'),
        ]),
      ]),
    };

    await indexWorkspacePdfs(ws);

    expect(indexPdfFile).not.toHaveBeenCalled();
    expect(usePdfIndexProgressStore.getState().current).toBeNull();
  });

  it('indexes only changed PDFs and clears their progress when the real work ends', async () => {
    vi.useFakeTimers();
    try {
      setPdfIndexingEnabledReader(() => true);
      useWorkspaceStore.setState({
        rootPath: 'C:\\ws\\Northcrest',
        fileTree: [],
      });
      pdfIndexPlan.mockResolvedValue([
        'C:/ws/Northcrest/Clients/Acme/statement.pdf',
      ]);

      const ws = {
        readFile: vi.fn(),
        writeFile: vi.fn(),
        exists: vi.fn(),
        readFileBinary: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
        getFileTree: vi.fn().mockResolvedValue([
          makeFolder('Clients/Acme', [
            makeFile('Clients/Acme/statement.pdf'),
            makeFile('Clients/Acme/unchanged.pdf'),
          ]),
        ]),
      };

      await indexWorkspacePdfs(ws);

      expect(pdfIndexPlan).toHaveBeenCalledWith(
        [
          'C:/ws/Northcrest/Clients/Acme/statement.pdf',
          'C:/ws/Northcrest/Clients/Acme/unchanged.pdf',
        ],
        true,
      );
      expect(indexPdfFile).toHaveBeenCalledTimes(1);
      const [indexedPath, binaryBackend] = indexPdfFile.mock.calls[0] as [
        string,
        { readBinary: unknown },
      ];
      expect(indexedPath).toBe('C:/ws/Northcrest/Clients/Acme/statement.pdf');
      expect(typeof binaryBackend.readBinary).toBe('function');
      expect(usePdfIndexProgressStore.getState().current).toMatchObject({
        processed: 1,
        total: 1,
      });

      await vi.advanceTimersByTimeAsync(4000);
      expect(usePdfIndexProgressStore.getState().current).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('coalesces two same-workspace startup calls into one PDF pass', async () => {
    setPdfIndexingEnabledReader(() => true);
    useWorkspaceStore.setState({
      rootPath: 'C:\\ws\\Northcrest',
      rootGeneration: 4,
      fileTree: [],
    });
    const ws = {
      readFile: vi.fn(),
      writeFile: vi.fn(),
      exists: vi.fn(),
      readFileBinary: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
      getFileTree: vi.fn().mockResolvedValue([
        makeFolder('Clients/Acme', [makeFile('Clients/Acme/statement.pdf')]),
      ]),
    };

    await Promise.all([indexWorkspacePdfs(ws), indexWorkspacePdfs(ws)]);

    expect(pdfIndexPlan).toHaveBeenCalledTimes(1);
    expect(indexPdfFile).toHaveBeenCalledTimes(1);
  });

  it('retries the fresh disk scan until the workspace is initialized, then indexes PDFs on open', async () => {
    // Regression for the #1 import gap: when the embedding model is already
    // cached, the full index fires the instant the workspace opens — BEFORE the
    // backend finishes initializing — so getFileTree() throws "not initialized"
    // and the empty cached tree yields ZERO PDFs. The retry must wait it out.
    setPdfIndexingEnabledReader(() => true);
    useWorkspaceStore.setState({ rootPath: 'C:\\ws\\Northcrest', fileTree: [] });

    const pdfTree = [makeFolder('Clients/Acme', [makeFile('Clients/Acme/statement.pdf')])];
    const getFileTree = vi
      .fn()
      .mockRejectedValueOnce(new Error('workspace not initialized')) // not ready yet
      .mockResolvedValueOnce([]) // ready, but the tree hasn't loaded
      .mockResolvedValue(pdfTree); // finally populated

    const ws = {
      readFile: vi.fn(),
      writeFile: vi.fn(),
      exists: vi.fn(),
      readFileBinary: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
      getFileTree,
    };

    await indexWorkspacePdfs(ws);

    expect(getFileTree.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(indexPdfFile).toHaveBeenCalledTimes(1);
    const [pdfPath] = indexPdfFile.mock.calls[0] as [string];
    expect(pdfPath).toBe('C:/ws/Northcrest/Clients/Acme/statement.pdf');
  });

  it('clears PDF progress when the workspace switches mid-PDF pass', async () => {
    vi.useFakeTimers();
    try {
      setPdfIndexingEnabledReader(() => true);
      useWorkspaceStore.setState({
        rootPath: 'C:\\ws\\OldNorthcrest',
        rootGeneration: 7,
        fileTree: [],
      });

      const ws = {
        readFile: vi.fn(),
        writeFile: vi.fn(),
        exists: vi.fn(),
        readFileBinary: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
        getFileTree: vi.fn().mockResolvedValue([
          makeFolder('Clients/Acme', [
            makeFile('Clients/Acme/statement.pdf'),
            makeFile('Clients/Acme/tax-return.pdf'),
          ]),
        ]),
      };

      indexPdfFile.mockImplementationOnce(() => {
        useWorkspaceStore.setState({
          rootPath: 'C:\\ws\\NewNorthcrest',
          rootGeneration: 8,
          fileTree: [],
        });
        return { indexed: true, pageCount: 1 };
      });

      await indexWorkspacePdfs(ws);

      expect(indexPdfFile).toHaveBeenCalledTimes(1);
      expect(usePdfIndexProgressStore.getState().current).not.toBeNull();

      await vi.advanceTimersByTimeAsync(4000);

      expect(usePdfIndexProgressStore.getState().current).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not let an old workspace clear the new workspace's live PDF progress", async () => {
    setPdfIndexingEnabledReader(() => true);
    let finishOld!: () => void;
    let finishNew!: () => void;
    const oldWork = new Promise<void>((resolve) => {
      finishOld = resolve;
    });
    const newWork = new Promise<void>((resolve) => {
      finishNew = resolve;
    });
    indexPdfFile
      .mockReturnValueOnce(oldWork.then(() => ({
        indexed: true,
        pageCount: 1,
      })))
      .mockReturnValueOnce(newWork.then(() => ({
        indexed: true,
        pageCount: 1,
      })));

    const workspace = (pdfPath: string) => ({
      readFile: vi.fn(),
      writeFile: vi.fn(),
      exists: vi.fn(),
      readFileBinary: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
      getFileTree: vi.fn().mockResolvedValue([
        makeFolder('Clients/Acme', [makeFile(pdfPath)]),
      ]),
    });

    useWorkspaceStore.setState({
      rootPath: 'C:\\ws\\OldNorthcrest',
      rootGeneration: 7,
      fileTree: [],
    });
    const oldRun = indexWorkspacePdfs(workspace('Clients/Acme/old.pdf'));
    await vi.waitFor(() => {
      expect(indexPdfFile).toHaveBeenCalledTimes(1);
    });

    useWorkspaceStore.setState({
      rootPath: 'C:\\ws\\NewNorthcrest',
      rootGeneration: 8,
      fileTree: [],
    });
    const newRun = indexWorkspacePdfs(workspace('Clients/Acme/new.pdf'));
    await vi.waitFor(() => {
      expect(indexPdfFile).toHaveBeenCalledTimes(2);
    });
    expect(usePdfIndexProgressStore.getState().current?.currentPath).toContain(
      'NewNorthcrest',
    );

    vi.useFakeTimers();
    try {
      finishOld();
      await oldRun;
      await vi.advanceTimersByTimeAsync(4000);
      expect(usePdfIndexProgressStore.getState().current?.currentPath).toContain(
        'NewNorthcrest',
      );

      finishNew();
      await newRun;
      await vi.advanceTimersByTimeAsync(4000);
      expect(usePdfIndexProgressStore.getState().current).toBeNull();
    } finally {
      vi.useRealTimers();
    }
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
      expect(retagMatter).not.toHaveBeenCalled();
    });
    indexWorkspace.mockReturnValue(indexPromise);

    await startFullIndex(ws);

    expect(indexWorkspace).toHaveBeenCalledTimes(1);
    // P1.1: the boot retag applies the folder's matter IN PLACE and BATCHED (no
    // re-embed), so it must call retagMatterBatch — NOT reindexPaths (re-embed).
    expect(reindexPaths).not.toHaveBeenCalled();
    expect(retagMatter).toHaveBeenCalledTimes(1);
    expect(retagMatter).toHaveBeenCalledWith(
      ['/ws/Northcrest/Clients/Acme/plan.docx'],
      matterId,
    );
  });

  it('repairs client search scope before starting any real PDF work', async () => {
    const matterId = 'matter-acme';
    const folder = 'Clients/Acme';
    setPdfIndexingEnabledReader(() => true);
    useWorkspaceStore.setState({ rootPath: '/ws/Northcrest', fileTree: [] });
    useMatterStore.setState({
      matters: [makeMatter(matterId, [folder])],
      activeMatterId: null,
    });
    retagMatter.mockResolvedValueOnce([]);
    indexPdfFile.mockResolvedValueOnce({ indexed: true, pageCount: 1 });

    const ws = {
      readFile: vi.fn(),
      writeFile: vi.fn(),
      exists: vi.fn(),
      readFileBinary: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
      getFileTree: vi.fn().mockResolvedValue([
        makeFolder(folder, [
          makeFile('Clients/Acme/plan.docx'),
          makeFile('Clients/Acme/statement.pdf'),
        ]),
      ]),
    };

    await startFullIndex(ws);

    expect(retagMatter).toHaveBeenCalled();
    expect(indexPdfFile).toHaveBeenCalledTimes(1);
    const [scopeRepairOrder] = retagMatter.mock.invocationCallOrder;
    const [pdfIndexOrder] = indexPdfFile.mock.invocationCallOrder;
    if (scopeRepairOrder === undefined || pdfIndexOrder === undefined) {
      throw new Error('expected both scope repair and PDF work to run');
    }
    expect(scopeRepairOrder).toBeLessThan(pdfIndexOrder);
  });

  it('QA-92: falls back to a real index when the in-place retag matches zero rows', async () => {
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

    // The in-place retag reported the file as a MISS (the QA-92 hole: it never
    // got vector rows to re-tag, or a path-form mismatch) — left as-is it stays
    // UNASSIGNED and is invisible to client-scoped Ask. The fallback must re-index
    // that miss under the target matter so it becomes searchable this session.
    // (Once, so this override doesn't leak into later tests — beforeEach's
    // clearAllMocks resets call history but not the implementation.)
    retagMatter.mockResolvedValueOnce(['/ws/Northcrest/Clients/Acme/plan.docx']);

    await startFullIndex(ws);

    expect(retagMatter).toHaveBeenCalledWith(
      ['/ws/Northcrest/Clients/Acme/plan.docx'],
      matterId,
    );
    expect(reindexPaths).toHaveBeenCalledWith(
      ['/ws/Northcrest/Clients/Acme/plan.docx'],
      matterId,
    );
  });

  it('QA-92 round 2: a MIXED batch re-indexes ONLY the per-path misses, not the retagged sibling', async () => {
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

    const planAbs = '/ws/Northcrest/Clients/Acme/plan.docx';
    const statementAbs = '/ws/Northcrest/Clients/Acme/statement.pdf';

    const ws = {
      readFile: vi.fn(),
      writeFile: vi.fn(),
      exists: vi.fn(),
      getFileTree: vi.fn().mockResolvedValue([
        makeFolder(folder, [
          makeFile('Clients/Acme/plan.docx'),
          makeFile('Clients/Acme/statement.pdf'),
        ]),
      ]),
    };

    // plan.docx retagged fine; statement.pdf had zero rows → reported as the only
    // miss. The aggregate count would have been > 0 and hidden this.
    retagMatter.mockResolvedValueOnce([statementAbs]);

    await retagExistingMatterFolderPaths(ws);

    // One batched retag with BOTH files.
    expect(retagMatter).toHaveBeenCalledWith([planAbs, statementAbs], matterId);
    // Only the miss is re-indexed — never the sibling that retagged fine.
    expect(reindexPaths).toHaveBeenCalledTimes(1);
    expect(reindexPaths).toHaveBeenCalledWith([statementAbs], matterId);
  });

  it('bails instead of retagging folder paths when the workspace switches during the fresh file scan', async () => {
    const folder = 'Clients/Acme';
    let resolveTree!: (tree: FileNode[]) => void;

    useWorkspaceStore.getState().setRootPath('/ws/A');
    useMatterStore.setState({
      matters: [makeMatter('matter-acme', [folder])],
      activeMatterId: null,
    });

    const ws = {
      readFile: vi.fn(),
      writeFile: vi.fn(),
      exists: vi.fn(),
      getFileTree: vi.fn().mockImplementation(
        () =>
          new Promise<FileNode[]>((resolve) => {
            resolveTree = resolve;
          }),
      ),
    };

    const retagPromise = retagExistingMatterFolderPaths(ws);

    useWorkspaceStore.getState().setRootPath('/ws/B');
    resolveTree([
      makeFolder(folder, [makeFile('Clients/Acme/plan.docx')]),
    ]);
    await retagPromise;

    expect(retagMatter).not.toHaveBeenCalled();
    expect(reindexPaths).not.toHaveBeenCalled();
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

    // P1.1: absolute-mapped folder + relative fresh tree still resolves, and the
    // retag is IN PLACE + BATCHED (retagMatterBatch), not a re-embed (reindexPaths).
    expect(reindexPaths).not.toHaveBeenCalled();
    expect(retagMatter).toHaveBeenCalledWith(
      ['C:/ws/Northcrest/Clients/Acme/plan.docx'],
      matterId,
    );
  });

  it('retags an existing unassigned document after CRM backfill adds the matter folder', async () => {
    const matterId = 'matter-ellison';
    const folder = 'Clients/Ellison, Robert & Margaret';
    const docPath = `${folder}/review-plan.docx`;

    useWorkspaceStore.setState({
      rootPath: 'C:/ws/Northcrest',
      fileTree: [
        makeFolder('Clients', [
          makeFolder(folder, [makeFile(docPath)]),
        ]),
      ],
    });
    useMatterStore.setState({
      matters: [
        {
          ...makeMatter(matterId, []),
          name: 'Ellison, Robert & Margaret',
          client: 'Ellison, Robert & Margaret',
          crmHouseholdKeys: ['wb-ellison'],
          createdFromCrm: true,
        },
      ],
      activeMatterId: null,
    });

    const before = useMatterStore.getState().matters.map((matter) => ({
      id: matter.id,
      folderPaths: matter.folderPaths,
    }));
    const attached = attachCrmHouseholdFolderIfUnmapped(
      matterId,
      { id: 'wb-ellison', name: 'Ellison, Robert & Margaret' },
      buildClaimedCrmFolderSet(),
    );
    const after = useMatterStore.getState().matters.map((matter) => ({
      id: matter.id,
      folderPaths: matter.folderPaths,
    }));

    expect(attached).toBe(folder);
    const changed = changedFolderPaths(before, after);
    // The matter store's write-time choke-point (path-shape-discipline fix,
    // F2.3) now canonicalizes a workspace-relative folder to ABSOLUTE using the
    // open workspace root before it lands in `folderPaths` — this is the CRM
    // auto-backfill bug's actual fix, so `changed` now carries the canonical
    // absolute value rather than the raw tree-relative `folder` string.
    const canonicalRoot = useWorkspaceStore.getState().rootPath;
    expect(canonicalRoot).not.toBeNull();
    expect(changed).toEqual([`${canonicalRoot ?? ''}/${folder}`]);

    const ws = {
      readFile: vi.fn(),
      writeFile: vi.fn(),
      exists: vi.fn(),
      getFileTree: vi.fn().mockResolvedValue([
        makeFolder('Clients', [
          makeFolder(folder, [makeFile(docPath)]),
        ]),
      ]),
    };

    await reindexFolderPaths(changed, ws);

    expect(reindexPaths).toHaveBeenCalledTimes(1);
    expect(reindexPaths).toHaveBeenCalledWith(
      ['C:/ws/Northcrest/Clients/Ellison, Robert & Margaret/review-plan.docx'],
      matterId,
    );
  });
});
