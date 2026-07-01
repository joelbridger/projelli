/**
 * Documents "Grid" view empty bug (2026-07-01, QA real-Windows finding).
 *
 * The store's live file tree uses workspace-RELATIVE node paths (from the FS
 * backend's `list()`), while a matter's `folderPaths` (and this embedded
 * surface's `scopeFolderPaths` prop) are ABSOLUTE. `DocumentsHome` used to
 * seed `currentFolderPath` directly from the absolute path, and
 * `DocumentGridView` does a strict `node.path === currentFolderPath` lookup
 * — relative vs absolute never matched, so Grid view rendered the EMPTY
 * state even though the scoped tree had files. Tree view worked because it
 * renders the (already-scoped) tree directly instead of looking up
 * `currentFolderPath`.
 *
 * This suite uses a REALISTIC relative-path fileTree (unlike the absolute-
 * shaped fixture in reimagined-documents-home.test.tsx) so it actually
 * exercises the bug.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { DocumentsHome, type DocumentsHomeProps } from '@/features/documents/DocumentsHome';
import type { FileNode } from '@/platform/types/workspace';
import type { TrashStats } from '@/platform/history/TrashService';

const ROOT = '/workspace';

// Realistic relative-path tree, exactly what WorkspaceService.getFileTree()
// returns in production (node.path is relative to the workspace root).
const mockFileTree: FileNode[] = [
  {
    id: 'clients',
    name: 'Clients',
    path: 'Clients',
    type: 'folder',
    children: [
      {
        id: 'acme',
        name: 'Acme',
        path: 'Clients/Acme',
        type: 'folder',
        children: [
          {
            id: 'acme-deal',
            name: 'deal.docx',
            path: 'Clients/Acme/deal.docx',
            type: 'file',
            extension: 'docx',
          },
        ],
      },
    ],
  },
];

// Mutable so a test can simulate the tree loading AFTER this component mounts
// (e.g. landing directly on a client's Documents tab before the workspace has
// finished its initial load) — see the "tree loads after mount" test below.
let mockStoreFileTree: FileNode[] = mockFileTree;
vi.mock('@/platform/fs/workspaceStore', () => ({
  useWorkspaceStore: (selector: (s: object) => unknown) =>
    selector({ fileTree: mockStoreFileTree, rootPath: ROOT }),
}));

// A matter mapped to the Acme folder, so ownership-aware pruning (when
// scopeMatterId is passed) resolves the folder to ITS OWN matter instead of
// UNASSIGNED (which would otherwise drop it — a different concern from the
// path-shape bug this suite targets).
vi.mock('@/platform/matter/matterStore', () => ({
  useMatterStore: (selector: (s: object) => unknown) =>
    selector({
      matters: [
        { id: 'acme', name: 'Acme', client: 'Acme', folderPaths: [`${ROOT}/Clients/Acme`], createdAt: '2026-01-01T00:00:00.000Z' },
        { id: 'sample', name: 'Sample', client: 'Sample', folderPaths: [ROOT], createdAt: '2026-01-01T00:00:00.000Z' },
      ],
    }),
}));

vi.mock('@/platform/state/editorStore', () => ({
  useEditorStore: (selector: (s: object) => unknown) =>
    selector({ activeTabPath: null, openTabs: [], setActiveTab: vi.fn(), closeTab: vi.fn() }),
}));

vi.mock('@/features/documents/TrashPanel', () => ({
  TrashPanel: () => <div data-testid="trash-panel" />,
}));

vi.mock('@/features/documents/workspace/FileTree', () => ({
  FileTree: () => <div data-testid="file-tree" />,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const EMPTY_TRASH_STATS: TrashStats = { itemCount: 0, totalSize: 0, oldestItem: undefined };

function buildProps(overrides: Partial<DocumentsHomeProps> = {}): DocumentsHomeProps {
  return {
    mainPanelContent: <div data-testid="main-panel" />,
    trashItems: [],
    trashStats: EMPTY_TRASH_STATS,
    onRestore: vi.fn().mockResolvedValue(undefined),
    onPermanentDelete: vi.fn().mockResolvedValue(undefined),
    onEmptyTrash: vi.fn().mockResolvedValue(undefined),
    onFileOpen: vi.fn().mockResolvedValue(undefined),
    onCreateFile: vi.fn(),
    onCreateFolder: vi.fn(),
    onRename: vi.fn(),
    onDelete: vi.fn(),
    onMove: vi.fn().mockResolvedValue(undefined),
    onDownload: vi.fn(),
    ...overrides,
  };
}

describe('DocumentsHome — Grid view with relative tree paths (real bug shape)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStoreFileTree = mockFileTree;
  });

  it('global (non-embedded) Grid view lists root-level files/folders', () => {
    render(<DocumentsHome {...buildProps()} />);
    expect(screen.getByTestId('document-grid-view')).toBeTruthy();
    expect(screen.getByText('Clients')).toBeTruthy();
  });

  it('embedded scope mapped to an absolute folder path shows that folder\'s files, not the empty state', () => {
    render(
      <DocumentsHome
        {...buildProps()}
        embedded
        scopeFolderPaths={[`${ROOT}/Clients/Acme`]}
        scopeMatterId="acme"
      />,
    );
    // Was empty before the fix: currentFolderPath stayed absolute
    // ("/workspace/Clients/Acme") while the tree node path is relative
    // ("Clients/Acme"), so the lookup found nothing.
    expect(screen.getByText('deal.docx')).toBeTruthy();
    expect(screen.queryByText(/workspace is ready/i)).toBeNull();
  });

  it('search finds a file inside the scoped folder (was "No results" before the fix)', () => {
    render(
      <DocumentsHome
        {...buildProps()}
        embedded
        scopeFolderPaths={[`${ROOT}/Clients/Acme`]}
        scopeMatterId="acme"
      />,
    );
    const search = screen.getByTestId('documents-search-field');
    fireEvent.change(search, { target: { value: 'deal' } });
    expect(screen.getByText('deal.docx')).toBeTruthy();
  });

  it('"Add files" targets the ABSOLUTE folder path, not the tree-relative lookup shape (Codex review)', () => {
    // currentFolderPath is now seeded tree-relative ("Clients/Acme") so the
    // grid lookup can find it. That value must NOT leak into the import
    // target: onImportFiles's explicit index call sends the path straight to
    // the Rust indexer with no workspace-root joining, so a relative target
    // would copy the file but silently fail to index it (no search/citations).
    const onImportFiles = vi.fn();
    render(
      <DocumentsHome
        {...buildProps({ onImportFiles })}
        embedded
        scopeFolderPaths={[`${ROOT}/Clients/Acme`]}
        scopeMatterId="acme"
      />,
    );
    fireEvent.click(screen.getByTestId('add-files-btn'));
    expect(onImportFiles).toHaveBeenCalledWith(`${ROOT}/Clients/Acme`);
  });

  it('resolves into the client folder once the tree loads AFTER mount (Codex review round 2)', async () => {
    // Landing directly on a client's Documents tab before the workspace's
    // initial file-tree load has completed: the tree is empty at mount, so
    // the useState initializer can't find the Acme folder and lands on the
    // scoped root. Once the tree arrives, it should drill into Acme WITHOUT
    // requiring the user to navigate manually.
    mockStoreFileTree = [];
    const { rerender } = render(
      <DocumentsHome
        {...buildProps()}
        embedded
        scopeFolderPaths={[`${ROOT}/Clients/Acme`]}
        scopeMatterId="acme"
      />,
    );
    expect(screen.queryByText('deal.docx')).toBeNull();

    mockStoreFileTree = mockFileTree;
    rerender(
      <DocumentsHome
        {...buildProps()}
        embedded
        scopeFolderPaths={[`${ROOT}/Clients/Acme`]}
        scopeMatterId="acme"
      />,
    );

    await waitFor(() => {
      expect(screen.getByText('deal.docx')).toBeTruthy();
    });
  });

  it('a scope mapped to the workspace root lists everything (root-scope special case)', () => {
    render(
      <DocumentsHome
        {...buildProps()}
        embedded
        scopeFolderPaths={[ROOT]}
        scopeMatterId="sample"
      />,
    );
    expect(screen.getByText('Clients')).toBeTruthy();
  });
});
