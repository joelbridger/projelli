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

vi.mock('@/platform/state/editorStore', () => {
  const editorState = {
    activeTabPath: null,
    openTabs: [],
    tabGroups: [],
    pendingRenamePath: null,
    pendingGroupRenameId: null,
    setActiveTab: vi.fn(),
    closeTab: vi.fn(),
    reorderTabs: vi.fn(),
    createTabGroup: vi.fn(() => 'group_1'),
    renameTabGroup: vi.fn(),
    deleteTabGroup: vi.fn(),
    toggleGroupCollapsed: vi.fn(),
    moveTabToGroup: vi.fn(),
    ungroupTab: vi.fn(),
    mergeTabGroups: vi.fn(),
    reorderInTabBar: vi.fn(),
    setPendingRenamePath: vi.fn(),
    setPendingGroupRenameId: vi.fn(),
  };
  const useEditorStore = Object.assign(
    (selector?: (s: typeof editorState) => unknown) =>
      selector ? selector(editorState) : editorState,
    { getState: () => editorState },
  );
  return { useEditorStore };
});

vi.mock('@/features/documents/TrashPanel', () => ({
  TrashPanel: () => <div data-testid="trash-panel" />,
}));

vi.mock('@/features/documents/workspace/FileTree', () => ({
  FileTree: () => <div data-testid="file-tree" />,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { count?: number }) => ({
      'workspace.documents.create-menu': 'New or add',
      'workspace.documents.new-document': 'New document',
      'workspace.documents.new-folder': 'New folder',
      'workspace.documents.add-files': 'Add files',
      'workspace.documents.title': 'Documents',
      'workspace.documents.files': 'Files',
      'workspace.documents.trash': 'Trash',
      'workspace.documents.view-mode': 'View',
      'workspace.documents.tree': 'Tree',
      'workspace.documents.grid': 'Grid',
      'workspace.documents.search-placeholder': 'Search',
      'workspace.documents.more-actions': 'More file actions',
      'workspace.documents.empty-title': 'No files yet',
      'workspace.documents.empty-body': 'Create or add a file to start.',
      'workspace.documents.no-results-title': 'No results',
      'workspace.documents.no-results-body': 'No files match your search. Try a different name.',
      'workspace.documents.all-files': 'All files',
      'workspace.file-tree.open-on-desktop': 'Show on computer',
    }[key] ?? (key === 'workspace.documents.search-results'
      ? `${String(opts?.count ?? 0)} ${opts?.count === 1 ? 'result' : 'results'}`
      : key)),
  }),
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

async function openFilesCreateMenu() {
  const trigger = screen.getByTestId('documents-files-create-menu');
  fireEvent.pointerDown(trigger, new MouseEvent('pointerdown', { bubbles: true }));
  fireEvent.click(trigger);
  await screen.findByTestId('documents-create-document');
}

function openDocumentsSearch(): HTMLElement {
  const existing = screen.queryByTestId('documents-search-field');
  if (existing) return existing;
  fireEvent.click(screen.getByTestId('documents-search-field-toggle'));
  return screen.getByTestId('documents-search-field');
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
    const search = openDocumentsSearch();
    fireEvent.change(search, { target: { value: 'deal' } });
    expect(screen.getByText('deal.docx')).toBeTruthy();
  });

  it('"Add files" targets the ABSOLUTE folder path, not the tree-relative lookup shape (Codex review)', async () => {
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
    await openFilesCreateMenu();
    fireEvent.click(screen.getByTestId('add-files-btn'));
    expect(onImportFiles).toHaveBeenCalledWith(`${ROOT}/Clients/Acme`);
  });

  it('navigating to an ANCESTOR folder (e.g. "Clients") does not let create/import escape the client scope (Codex review round 3, P1)', async () => {
    // The scoped tree deliberately keeps ancestor folders (here "Clients") so
    // the client's own mapped folder is reachable via breadcrumbs. Fixing the
    // Grid-empty bug made that navigation reachable for the first time — this
    // guards against a matter-isolation leak: creating/importing while
    // sitting on the ancestor must fall back to the client's OWN folder, not
    // write into "Clients" (which is outside the matter's scope and would
    // vanish from this client's Documents tab).
    const onImportFiles = vi.fn();
    render(
      <DocumentsHome
        {...buildProps({ onImportFiles })}
        embedded
        scopeFolderPaths={[`${ROOT}/Clients/Acme`]}
        scopeMatterId="acme"
      />,
    );
    // Navigate UP to the "Clients" ancestor breadcrumb (crumb 0 = "All files",
    // crumb 1 = "Clients").
    fireEvent.click(screen.getByTestId('breadcrumb-crumb-1'));
    await openFilesCreateMenu();
    fireEvent.click(screen.getByTestId('add-files-btn'));
    expect(onImportFiles).toHaveBeenCalledWith(`${ROOT}/Clients/Acme`);
    expect(onImportFiles).not.toHaveBeenCalledWith(`${ROOT}/Clients`);
  });

  it('drag-and-drop onto an ANCESTOR breadcrumb is blocked, same as create/import (Codex review round 4, P1)', () => {
    // handleDropOnCrumb -> onMove reaches the SAME ancestor breadcrumb that
    // create/import were clamped against above; a drag must be blocked the
    // same way, or a file can be dragged out of the client's own matter-
    // isolated folder (it then vanishes from this client's Documents tab).
    const onMove = vi.fn().mockResolvedValue(undefined);
    render(
      <DocumentsHome
        {...buildProps({ onMove })}
        embedded
        scopeFolderPaths={[`${ROOT}/Clients/Acme`]}
        scopeMatterId="acme"
      />,
    );
    const crumb = screen.getByTestId('breadcrumb-crumb-1'); // "Clients"
    fireEvent.drop(crumb, {
      dataTransfer: { getData: () => 'Clients/Acme/deal.docx' },
    });
    expect(onMove).not.toHaveBeenCalled();
  });

  it('resets stale currentFolderPath (and its create target) when the viewed folder disappears from the tree (Codex review round 4, P2)', async () => {
    // Establish the baseline target "New document" uses at the TRUE root
    // (never navigated), so we can confirm the post-reset target matches it
    // rather than staying stuck on the deleted folder's path.
    const baselineCreate = vi.fn();
    const { unmount } = render(<DocumentsHome {...buildProps({ onCreateFile: baselineCreate })} />);
    await openFilesCreateMenu();
    fireEvent.click(screen.getByTestId('documents-create-document'));
    const rootTarget = baselineCreate.mock.calls[0]?.[0] as unknown;
    unmount();

    const onCreateFile = vi.fn();
    const { rerender } = render(<DocumentsHome {...buildProps({ onCreateFile })} />);
    fireEvent.click(screen.getByText('Clients'));
    fireEvent.click(screen.getByText('Acme'));
    expect(screen.getByText('deal.docx')).toBeTruthy();

    // Simulate the Acme folder disappearing (deleted/renamed) via a tree
    // refresh, e.g. the file watcher's periodic poll.
    mockStoreFileTree = [{ id: 'clients', name: 'Clients', path: 'Clients', type: 'folder', children: [] }];
    rerender(<DocumentsHome {...buildProps({ onCreateFile })} />);
    await waitFor(() => {
      expect(screen.queryByText('deal.docx')).toBeNull();
    });

    await openFilesCreateMenu();
    fireEvent.click(screen.getByTestId('documents-create-document'));
    // Without the reset this would still target the deleted "Clients/Acme"
    // path — and since writes create missing parents, it would silently
    // RECREATE the folder the user just deleted.
    expect(onCreateFile).toHaveBeenCalledWith(rootTarget);
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

// ── B4b (2026-07-02, bench finding): search only matched the open folder ──
//
// The Documents-tab search box filtered `currentNodes` (the currently open
// folder's direct children only), not the client's whole scoped tree — so a
// match living in a sibling/nested folder, or a folder the user hadn't
// drilled into, silently never surfaced. Fixed in DocumentGridView.tsx to
// recursively flatten the already-scoped `fileTree` when a query is active.
describe('DocumentsHome — B4b: whole-client search scope + matter isolation', () => {
  const twoClientTree: FileNode[] = [
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
            {
              id: 'acme-contracts',
              name: 'Contracts',
              path: 'Clients/Acme/Contracts',
              type: 'folder',
              children: [
                {
                  id: 'acme-nda',
                  name: 'nda.docx',
                  path: 'Clients/Acme/Contracts/nda.docx',
                  type: 'file',
                  extension: 'docx',
                },
              ],
            },
          ],
        },
        {
          id: 'beta',
          name: 'Beta',
          path: 'Clients/Beta',
          type: 'folder',
          children: [
            {
              id: 'beta-secret',
              name: 'beta-secret.docx',
              path: 'Clients/Beta/beta-secret.docx',
              type: 'file',
              extension: 'docx',
            },
          ],
        },
      ],
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    mockStoreFileTree = twoClientTree;
  });

  it('finds a match in a DIFFERENT folder than the one currently open, within the client scope', () => {
    render(
      <DocumentsHome
        {...buildProps()}
        embedded
        scopeFolderPaths={[`${ROOT}/Clients/Acme`]}
        scopeMatterId="acme"
      />,
    );
    // The seeded open folder is Acme itself (deal.docx is visible without
    // searching). Search for a file nested inside the sibling "Contracts"
    // subfolder — a DIFFERENT folder than the one currently open.
    expect(screen.getByText('deal.docx')).toBeTruthy();
    const search = openDocumentsSearch();
    fireEvent.change(search, { target: { value: 'nda' } });
    expect(screen.getByText('nda.docx')).toBeTruthy();
  });

  it("NEVER matches another client's file, even though it lives in the same underlying tree", () => {
    render(
      <DocumentsHome
        {...buildProps()}
        embedded
        scopeFolderPaths={[`${ROOT}/Clients/Acme`]}
        scopeMatterId="acme"
      />,
    );
    const search = openDocumentsSearch();
    // "beta-secret.docx" belongs to a different client (Beta) — it must
    // never surface in Acme's scoped search results. Matter isolation holds
    // because `scopeFileTreeToFolders` already pruned Beta's branch out of
    // the tree DocumentGridView searches; the flattening fix never touches
    // the workspace store's full tree directly.
    fireEvent.change(search, { target: { value: 'beta' } });
    expect(screen.queryByText('beta-secret.docx')).toBeNull();
    expect(screen.getByText(/no files match your search/i)).toBeTruthy();
  });

  it("(Codex review round 2) a search result's path context never shows an ancestor wrapper folder's name, even when that wrapper coincidentally shares a name with the search itself", () => {
    // Pathological but possible layout: this client's own mapped folder
    // ("Acme") happens to sit nested inside a folder that is ITSELF named
    // after something outside the client's scope (here literally "Beta" —
    // scopeFileTreeToFolders keeps such wrapper folders purely so the
    // client's own folder stays reachable via breadcrumbs/navigation). A
    // search result's displayed path context must be trimmed to start at
    // the client's OWN folder, never showing the wrapper ancestor's name.
    const nestedTree: FileNode[] = [
      {
        id: 'clients',
        name: 'Clients',
        path: 'Clients',
        type: 'folder',
        children: [
          {
            id: 'beta-wrapper',
            name: 'Beta',
            path: 'Clients/Beta',
            type: 'folder',
            children: [
              {
                id: 'acme',
                name: 'Acme',
                path: 'Clients/Beta/Acme',
                type: 'folder',
                children: [
                  {
                    id: 'acme-deal',
                    name: 'deal.docx',
                    path: 'Clients/Beta/Acme/deal.docx',
                    type: 'file',
                    extension: 'docx',
                  },
                  {
                    id: 'acme-contracts',
                    name: 'Contracts',
                    path: 'Clients/Beta/Acme/Contracts',
                    type: 'folder',
                    children: [
                      {
                        id: 'acme-nda',
                        name: 'nda.docx',
                        path: 'Clients/Beta/Acme/Contracts/nda.docx',
                        type: 'file',
                        extension: 'docx',
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    ];
    mockStoreFileTree = nestedTree;
    render(
      <DocumentsHome
        {...buildProps()}
        embedded
        scopeFolderPaths={[`${ROOT}/Clients/Beta/Acme`]}
      />,
    );
    const search = openDocumentsSearch();
    fireEvent.change(search, { target: { value: 'nda' } });
    const context = screen.getByTestId('grid-card-context-Clients/Beta/Acme/Contracts/nda.docx');
    // Correct: "Contracts" (relative to the client's own folder). Must NEVER
    // contain "Beta" (the coincidental wrapper ancestor's name) or "Clients".
    expect(context.textContent).toBe('Contracts');
    expect(context.textContent).not.toContain('Beta');
    expect(context.textContent).not.toContain('Clients');
  });

  it('(COORDINATOR review, isolation-class) searching an ancestor WRAPPER folder name never surfaces it as a result — zero results, not a leaked folder card', () => {
    // Same pathological nested layout as above: Acme's own mapped folder
    // sits inside a folder literally named "Beta" (kept only as a
    // navigational wrapper, never owned by this client). A first pass at
    // this fix only trimmed the wrapper's name out of a DESCENDANT result's
    // path context — but flattenForSearch(fileTree) still walked the wrapper
    // NODES themselves, so searching "Beta" surfaced the wrapper folder
    // itself as a search RESULT (clickable, name visible). The fix must be
    // structural: never flatten anything above the client's OWN owned
    // folder(s), so a wrapper can never appear as a result at all — for
    // "Beta" (the coincidental other-identity wrapper) AND "Clients" (the
    // outer wrapper), search inside Acme's scope must return ZERO results.
    const nestedTree: FileNode[] = [
      {
        id: 'clients',
        name: 'Clients',
        path: 'Clients',
        type: 'folder',
        children: [
          {
            id: 'beta-wrapper',
            name: 'Beta',
            path: 'Clients/Beta',
            type: 'folder',
            children: [
              {
                id: 'acme',
                name: 'Acme',
                path: 'Clients/Beta/Acme',
                type: 'folder',
                children: [
                  {
                    id: 'acme-deal',
                    name: 'deal.docx',
                    path: 'Clients/Beta/Acme/deal.docx',
                    type: 'file',
                    extension: 'docx',
                  },
                ],
              },
            ],
          },
        ],
      },
    ];
    mockStoreFileTree = nestedTree;
    render(
      <DocumentsHome
        {...buildProps()}
        embedded
        scopeFolderPaths={[`${ROOT}/Clients/Beta/Acme`]}
      />,
    );
    const search = openDocumentsSearch();

    // Note: the breadcrumb trail (a pre-existing, unrelated navigational
    // affordance) already shows "Beta" as an ancestor crumb regardless of
    // search — that's not what this test guards against. It asserts no
    // SEARCH RESULT card for the wrapper exists, and the grid honestly
    // reports zero matches.
    fireEvent.change(search, { target: { value: 'Beta' } });
    expect(screen.queryByTestId('grid-card-Clients/Beta')).toBeNull();
    expect(screen.queryByTestId('document-grid-cards')).toBeNull();
    expect(screen.getByText(/no files match your search/i)).toBeTruthy();

    fireEvent.change(search, { target: { value: 'Clients' } });
    expect(screen.queryByTestId('grid-card-Clients')).toBeNull();
    expect(screen.getByText(/no files match your search/i)).toBeTruthy();

    // Sanity: the client's own file is still findable — this isn't a
    // regression to "nothing ever matches."
    fireEvent.change(search, { target: { value: 'deal' } });
    expect(screen.getByText('deal.docx')).toBeTruthy();
  });

  it('(Codex delta review, P1) one stale/unresolvable extra mapped folder never reopens the wrapper leak for the client\'s OTHER valid folder', () => {
    // A client can have MULTIPLE mapped folders (`Matter.folderPaths`). The
    // first pass at resolving them bailed on the ENTIRE list the moment ANY
    // single entry failed to resolve (e.g. a stale path to a folder that was
    // deleted/renamed) — discarding every already-resolved VALID root and
    // falling back to flattening the whole tree, which reopens the exact
    // wrapper-leak this fix closes. One bad extra entry must never poison
    // the other, perfectly good, owned folder.
    const nestedTree: FileNode[] = [
      {
        id: 'clients',
        name: 'Clients',
        path: 'Clients',
        type: 'folder',
        children: [
          {
            id: 'beta-wrapper',
            name: 'Beta',
            path: 'Clients/Beta',
            type: 'folder',
            children: [
              {
                id: 'acme',
                name: 'Acme',
                path: 'Clients/Beta/Acme',
                type: 'folder',
                children: [
                  {
                    id: 'acme-deal',
                    name: 'deal.docx',
                    path: 'Clients/Beta/Acme/deal.docx',
                    type: 'file',
                    extension: 'docx',
                  },
                ],
              },
            ],
          },
        ],
      },
    ];
    mockStoreFileTree = nestedTree;
    render(
      <DocumentsHome
        {...buildProps()}
        embedded
        scopeFolderPaths={[
          `${ROOT}/Clients/Beta/Acme`,
          // A folder this client "owns" per its stored Matter.folderPaths,
          // but that no longer exists anywhere in the tree (deleted/renamed).
          `${ROOT}/Clients/Beta/Acme/DeletedSubfolder`,
        ]}
      />,
    );
    const search = openDocumentsSearch();

    // The wrapper leak must still be closed even with the stale extra entry.
    fireEvent.change(search, { target: { value: 'Beta' } });
    expect(screen.queryByTestId('document-grid-cards')).toBeNull();
    expect(screen.getByText(/no files match your search/i)).toBeTruthy();

    // The client's own valid folder must still search correctly.
    fireEvent.change(search, { target: { value: 'deal' } });
    expect(screen.getByText('deal.docx')).toBeTruthy();
  });

  it('(Codex delta review, P2) overlapping/nested mapped folders never produce duplicate result cards', () => {
    // A client can map BOTH a parent folder and one of its own subfolders
    // (e.g. "/Clients/Acme" and "/Clients/Acme/Contracts"). Without
    // deduplication, the nested folder's contents get walked twice — once
    // via the parent root's normal recursion, once again as its own
    // independent root — producing a duplicate card (and duplicate React
    // key) for the same file.
    const nestedTree: FileNode[] = [
      {
        id: 'acme',
        name: 'Acme',
        path: 'Clients/Acme',
        type: 'folder',
        children: [
          {
            id: 'acme-contracts',
            name: 'Contracts',
            path: 'Clients/Acme/Contracts',
            type: 'folder',
            children: [
              {
                id: 'acme-nda',
                name: 'nda.docx',
                path: 'Clients/Acme/Contracts/nda.docx',
                type: 'file',
                extension: 'docx',
              },
            ],
          },
        ],
      },
    ];
    mockStoreFileTree = nestedTree;
    render(
      <DocumentsHome
        {...buildProps()}
        embedded
        scopeFolderPaths={[`${ROOT}/Clients/Acme`, `${ROOT}/Clients/Acme/Contracts`]}
      />,
    );
    const search = openDocumentsSearch();
    fireEvent.change(search, { target: { value: 'nda' } });
    expect(screen.getAllByText('nda.docx')).toHaveLength(1);
    expect(screen.getByTestId('grid-card-context-Clients/Acme/Contracts/nda.docx').textContent).toBe(
      'Contracts',
    );
  });

  it('empty state is honest: a query with no match anywhere in the client scope says so, not a stale prior list', () => {
    render(
      <DocumentsHome
        {...buildProps()}
        embedded
        scopeFolderPaths={[`${ROOT}/Clients/Acme`]}
        scopeMatterId="acme"
      />,
    );
    const search = openDocumentsSearch();
    fireEvent.change(search, { target: { value: 'zzznomatch' } });
    expect(screen.getByText(/no files match your search/i)).toBeTruthy();
    expect(screen.queryByText('deal.docx')).toBeNull();
    expect(screen.queryByText('nda.docx')).toBeNull();
  });
});

describe('DocumentsHome — [object Object] defensive boundary (2026-07-01 re-fix)', () => {
  // A corrupted/legacy matter can pass a NON-STRING scopeFolderPaths entry (an
  // object). Left alone it becomes the create target and stringifies to the
  // literal "[object Object]", creating a real garbage folder at the workspace
  // root — and the scoped Grid/Tree then show empty. DocumentsHome must coerce
  // it so only a real string path can ever reach a create/import handler.
  beforeEach(() => {
    vi.clearAllMocks();
    mockStoreFileTree = mockFileTree;
  });

  it('an object folderPaths entry with a usable .path behaves exactly like the string path', async () => {
    const onImportFiles = vi.fn();
    render(
      <DocumentsHome
        {...buildProps({ onImportFiles })}
        embedded
        // The corrupted shape the bug produced, e.g. a folder-picker {path,name}.
        scopeFolderPaths={[{ path: `${ROOT}/Clients/Acme`, name: 'Acme' } as unknown as string]}
        scopeMatterId="acme"
      />,
    );
    // Grid still shows the client's file (coerced path pruned the tree correctly).
    expect(screen.getByText('deal.docx')).toBeTruthy();
    // And the import target is the real STRING path — never the object / "[object Object]".
    await openFilesCreateMenu();
    fireEvent.click(screen.getByTestId('add-files-btn'));
    expect(onImportFiles).toHaveBeenCalledWith(`${ROOT}/Clients/Acme`);
    const arg = onImportFiles.mock.calls[0]?.[0];
    expect(typeof arg).toBe('string');
    expect(String(arg)).not.toContain('[object Object]');
  });

  it('an unusable object entry never reaches a create handler as "[object Object]"', async () => {
    const onCreateDefaultDocument = vi.fn();
    render(
      <DocumentsHome
        {...buildProps({ onCreateDefaultDocument })}
        embedded
        // No `.path`/`.folderPath` — nothing usable, so it is dropped entirely.
        scopeFolderPaths={[{ nope: true } as unknown as string]}
        scopeMatterId="acme"
      />,
    );
    await openFilesCreateMenu();
    fireEvent.click(screen.getByTestId('documents-create-document'));
    expect(onCreateDefaultDocument).toHaveBeenCalledTimes(1);
    const arg = onCreateDefaultDocument.mock.calls[0]?.[0] as unknown;
    // Falls back to undefined (→ the canonical <root>/docs downstream), NEVER the
    // stringified object.
    expect(arg === undefined || typeof arg === 'string').toBe(true);
    expect(String(arg)).not.toContain('[object Object]');
  });
});
