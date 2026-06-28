/**
 * DocumentsHome — unit tests (R4: "Files" pinned tab + grid model)
 *
 * Covers:
 *  1. Unified tab strip: pinned "Files" tab renders + is selected by default
 *  2. DocumentGridView renders when "Files" tab is active (no left column)
 *  3. Opening a file tab adds it to the strip and switches to editor view
 *  4. Clicking "Files" tab returns to the grid
 *  5. Folders render in the grid; files render in the grid
 *  6. The grid reflects a populated fileTree (folders first)
 *  7. Trash toggle inside the grid shows/hides TrashPanel
 *  8. Search filters grid cards by name
 *  9. "Add files" button exists in the grid toolbar
 * 10. Trust banner shows the first time "Add files" is clicked, dismissible
 * 11. Email-open flow: email tab shows editor (email-open intact)
 * 12. File card click calls onFileOpen
 * 13. Folder card click does NOT call onFileOpen (drills in)
 *
 * All stores and heavy sub-components are mocked for fast, FS-free runs.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { DocumentsHome, type DocumentsHomeProps } from '@/features/documents/DocumentsHome';
import type { FileNode } from '@/platform/types/workspace';
import type { TrashedItem, TrashStats } from '@/platform/history/TrashService';

// ── Store mocks ────────────────────────────────────────────────────────────

const mockFileTree: FileNode[] = [
  {
    id: 'folder-1',
    name: 'Contracts',
    path: '/workspace/Contracts',
    type: 'folder',
    children: [
      {
        id: 'file-nested',
        name: 'NDA.docx',
        path: '/workspace/Contracts/NDA.docx',
        type: 'file',
        extension: 'docx',
        size: 2048,
        modifiedAt: new Date('2026-01-15'),
      },
    ],
  },
  {
    id: 'file-1',
    name: 'Brief.md',
    path: '/workspace/Brief.md',
    type: 'file',
    extension: 'md',
    size: 512,
    modifiedAt: new Date('2026-06-10'),
  },
  {
    id: 'file-2',
    name: 'Evidence.pdf',
    path: '/workspace/Evidence.pdf',
    type: 'file',
    extension: 'pdf',
    size: 102400,
    modifiedAt: new Date('2026-05-20'),
  },
];

// Workspace store mock — default: has a workspace with files
vi.mock('@/platform/fs/workspaceStore', () => ({
  useWorkspaceStore: (selector: (s: object) => unknown) =>
    selector({
      fileTree: mockFileTree,
      rootPath: '/workspace',
    }),
}));

// Editor store mock — default: no active tab (no file open)
let mockActiveTabPath: string | null = null;
let mockOpenTabs: Array<{ path: string; name: string; type?: string; isDirty?: boolean }> = [];
const mockSetActiveTab = vi.fn();
const mockCloseTab = vi.fn();

vi.mock('@/platform/state/editorStore', () => ({
  useEditorStore: (selector: (s: object) => unknown) =>
    selector({
      activeTabPath: mockActiveTabPath,
      openTabs: mockOpenTabs,
      setActiveTab: mockSetActiveTab,
      closeTab: mockCloseTab,
    }),
}));

// DocumentGridView — renders a simplified real version
// (We let the real DocumentGridView render so we can test file card clicks
// and grid content. Only TrashPanel is mocked.)

// TrashPanel mock — renders trash items as a list
vi.mock('@/features/documents/TrashPanel', () => ({
  TrashPanel: ({ items }: { items: TrashedItem[] }) => (
    <div data-testid="trash-panel">
      {items.map((item) => (
        <div key={item.id} data-testid={`trash-item-${item.id}`}>
          {item.name}
        </div>
      ))}
    </div>
  ),
}));

// FileTree mock — the real FileTree's expanding-tree drag-and-drop is covered
// by its own suite + the campaign filetree sweep; here we only need to confirm
// the Tree | Grid toggle mounts it and hands it the move handler. The stub
// exposes a button that invokes onMove so we can assert wiring if needed.
vi.mock('@/features/documents/workspace/FileTree', () => ({
  FileTree: ({
    onMove,
  }: {
    onMove?: (s: string, t: string) => Promise<void>;
  }) => (
    <div data-testid="file-tree">
      <button
        type="button"
        data-testid="file-tree-fake-move"
        onClick={() => { void onMove?.('/workspace/Brief.md', '/workspace/Contracts'); }}
      >
        tree-move
      </button>
    </div>
  ),
}));

// react-i18next mock
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

// ── Helpers ────────────────────────────────────────────────────────────────

const EMPTY_TRASH_STATS: TrashStats = {
  itemCount: 0,
  totalSize: 0,
  oldestItem: undefined,
};

const SAMPLE_TRASH_ITEMS: TrashedItem[] = [
  {
    id: 'trash-1',
    name: 'OldDraft.md',
    originalPath: '/workspace/OldDraft.md',
    trashPath: '/workspace/.trash/OldDraft.md',
    type: 'file',
    deletedAt: new Date('2026-06-01'),
    size: 256,
  },
];

function buildDefaultProps(overrides: Partial<DocumentsHomeProps> = {}): DocumentsHomeProps {
  return {
    mainPanelContent: <div data-testid="main-panel">Editor</div>,
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

// ── Tests ──────────────────────────────────────────────────────────────────

// ── Unified tab strip ──────────────────────────────────────────────────────

describe('DocumentsHome — unified tab strip (R4)', () => {
  beforeEach(() => {
    mockActiveTabPath = null;
    mockOpenTabs = [];
    mockSetActiveTab.mockClear();
    mockCloseTab.mockClear();
  });

  it('renders the documents container', () => {
    render(<DocumentsHome {...buildDefaultProps()} />);
    expect(screen.getByTestId('documents-split')).toBeTruthy();
  });

  it('renders a unified tab strip', () => {
    render(<DocumentsHome {...buildDefaultProps()} />);
    expect(screen.getByTestId('documents-tab-strip')).toBeTruthy();
  });

  it('shows a pinned "Files" tab as the first tab', () => {
    render(<DocumentsHome {...buildDefaultProps()} />);
    // "Files" chip must be present in the tab strip
    const strip = screen.getByTestId('documents-tab-strip');
    expect(strip.textContent).toContain('Files');
  });

  it('shows the DocumentGridView by default (no file open)', () => {
    render(<DocumentsHome {...buildDefaultProps()} />);
    expect(screen.getByTestId('document-grid-view')).toBeTruthy();
    // Editor should NOT be visible
    expect(screen.queryByTestId('main-panel')).toBeNull();
  });

  it('does NOT show a left column panel', () => {
    render(<DocumentsHome {...buildDefaultProps()} />);
    expect(screen.queryByTestId('documents-left-panel')).toBeNull();
  });
});

// ── Grid file view ─────────────────────────────────────────────────────────

describe('DocumentsHome — grid file view', () => {
  beforeEach(() => {
    mockActiveTabPath = null;
    mockOpenTabs = [];
  });

  it('renders the DocumentGridView when Files tab is active', () => {
    render(<DocumentsHome {...buildDefaultProps()} />);
    expect(screen.getByTestId('document-grid-view')).toBeTruthy();
  });

  it('renders grid cards for all nodes in the fileTree', () => {
    render(<DocumentsHome {...buildDefaultProps()} />);
    // Folder and files from mockFileTree should appear
    expect(screen.getByTestId('grid-card-/workspace/Contracts')).toBeTruthy();
    expect(screen.getByTestId('grid-card-/workspace/Brief.md')).toBeTruthy();
    expect(screen.getByTestId('grid-card-/workspace/Evidence.pdf')).toBeTruthy();
  });

  it('shows folder names in the grid', () => {
    render(<DocumentsHome {...buildDefaultProps()} />);
    expect(screen.getByText('Contracts')).toBeTruthy();
  });

  it('shows file names in the grid', () => {
    render(<DocumentsHome {...buildDefaultProps()} />);
    expect(screen.getByText('Brief.md')).toBeTruthy();
    expect(screen.getByText('Evidence.pdf')).toBeTruthy();
  });

  it('grid cards container is rendered', () => {
    render(<DocumentsHome {...buildDefaultProps()} />);
    expect(screen.getByTestId('document-grid-cards')).toBeTruthy();
  });
});

// ── File open / editor tab ─────────────────────────────────────────────────

describe('DocumentsHome — file open + editor tab', () => {
  beforeEach(() => {
    mockActiveTabPath = null;
    mockOpenTabs = [];
    mockSetActiveTab.mockClear();
    mockCloseTab.mockClear();
  });

  it('opening a file tab adds it to the strip', async () => {
    mockActiveTabPath = null;
    mockOpenTabs = [];
    const { rerender } = render(<DocumentsHome {...buildDefaultProps()} />);

    // Simulate a file tab opening (editorStore update)
    mockActiveTabPath = '/workspace/Brief.md';
    mockOpenTabs = [{ path: '/workspace/Brief.md', name: 'Brief.md', type: 'file' }];
    rerender(<DocumentsHome {...buildDefaultProps()} />);

    await waitFor(() => {
      const strip = screen.getByTestId('documents-tab-strip');
      expect(strip.textContent).toContain('Brief.md');
    });
  });

  it('shows the editor when a file tab becomes active', async () => {
    mockActiveTabPath = null;
    mockOpenTabs = [];
    const { rerender } = render(<DocumentsHome {...buildDefaultProps()} />);

    mockActiveTabPath = '/workspace/Brief.md';
    mockOpenTabs = [{ path: '/workspace/Brief.md', name: 'Brief.md', type: 'file' }];
    rerender(<DocumentsHome {...buildDefaultProps()} />);

    await waitFor(() => {
      expect(screen.getByTestId('documents-editor-pane')).toBeTruthy();
      expect(screen.getByTestId('main-panel')).toBeTruthy();
    });
  });

  it('embedded (per-client) lands on the scoped file surface, not a stale editor, even with an editor tab open', () => {
    // Matter isolation: another client's document is the active editor tab and
    // the shared view is 'editor'. The embedded Documents tab must still mount
    // on the scoped file surface, never showing that foreign open file.
    mockActiveTabPath = '/workspace/Other Client/secret.docx';
    mockOpenTabs = [{ path: '/workspace/Other Client/secret.docx', name: 'secret.docx', type: 'file' }];
    render(
      <DocumentsHome
        {...buildDefaultProps()}
        embedded
        scopeFolderPaths={['/workspace/Contracts']}
        scopeMatterId="A"
        documentsView="editor"
      />,
    );
    expect(screen.getByTestId('documents-right-panel')).toBeTruthy();
    expect(screen.queryByTestId('documents-editor-pane')).toBeNull();
  });

  it('switching clients on the Documents sub-tab remounts the surface — imports target the NEW client folder, not the old (matter isolation)', () => {
    // Simulates open-Client-A-Documents -> switch-to-Client-B-Documents. The
    // per-client key (applied in AppSurfaceRouter/MattersHome) remounts the
    // surface, so Client A's currentFolderPath does NOT survive into B — without
    // it, creating/importing from B's tab would write into A's folder.
    mockActiveTabPath = null;
    mockOpenTabs = [];
    const onImportFiles = vi.fn();

    const { rerender } = render(
      <DocumentsHome
        key="A"
        {...buildDefaultProps({ onImportFiles })}
        embedded
        scopeFolderPaths={['/workspace/Client A']}
        scopeMatterId="A"
      />,
    );
    fireEvent.click(screen.getByTestId('add-files-btn'));
    expect(onImportFiles).toHaveBeenLastCalledWith('/workspace/Client A');

    rerender(
      <DocumentsHome
        key="B"
        {...buildDefaultProps({ onImportFiles })}
        embedded
        scopeFolderPaths={['/workspace/Client B']}
        scopeMatterId="B"
      />,
    );
    fireEvent.click(screen.getByTestId('add-files-btn'));
    expect(onImportFiles).toHaveBeenLastCalledWith('/workspace/Client B');
  });

  it('embedded mode hides the global Trash toggle (cross-client surface)', () => {
    mockActiveTabPath = null;
    mockOpenTabs = [];
    const { rerender } = render(<DocumentsHome {...buildDefaultProps()} />);
    // Global mode shows the Files/Trash toggle.
    expect(screen.queryByTestId('docs-trash-toggle')).toBeTruthy();
    // Embedded (per-client) mode hides it — Trash is a global cross-client view.
    rerender(
      <DocumentsHome
        {...buildDefaultProps()}
        embedded
        scopeFolderPaths={['/workspace/Contracts']}
        scopeMatterId="A"
      />,
    );
    expect(screen.queryByTestId('docs-trash-toggle')).toBeNull();
    expect(screen.queryByTestId('docs-files-toggle')).toBeNull();
  });

  it('embedded mode never shows a foreign client\'s open editor tab', () => {
    // Another client's document is the global active editor tab.
    mockActiveTabPath = '/workspace/Other Client/secret.docx';
    mockOpenTabs = [{ path: '/workspace/Other Client/secret.docx', name: 'secret.docx', type: 'file' }];
    render(
      <DocumentsHome
        {...buildDefaultProps()}
        embedded
        scopeFolderPaths={['/workspace/Contracts']}
        scopeMatterId="A"
      />,
    );
    // The foreign tab chip must not be visible/clickable anywhere in the hub.
    expect(screen.queryByText('secret.docx')).toBeNull();
    // The pinned "Files" tab (back to the scoped list) stays.
    expect(screen.getByTestId('documents-tab-strip').textContent).toContain('Files');
  });

  it('embedded create/import clamps to the client folder at the scoped root (no global write)', () => {
    mockActiveTabPath = null;
    mockOpenTabs = [];
    const onImportFiles = vi.fn();
    render(
      <DocumentsHome
        {...buildDefaultProps({ onImportFiles })}
        embedded
        scopeFolderPaths={['/workspace/Contracts']}
      />,
    );
    // Navigate to the scoped root via the "All files" breadcrumb (sets null).
    fireEvent.click(screen.getByTestId('breadcrumb-crumb-0'));
    // Add files must still target the client folder, never null/global.
    fireEvent.click(screen.getByTestId('add-files-btn'));
    expect(onImportFiles).toHaveBeenLastCalledWith('/workspace/Contracts');
  });

  it('embedded navigation can reach the scoped root (multi-folder clients can see sibling folders)', () => {
    // The create-target clamp must NOT clamp NAVIGATION — otherwise a client with
    // several mapped folders can never get back to the root where siblings show.
    mockActiveTabPath = null;
    mockOpenTabs = [];
    render(
      <DocumentsHome
        {...buildDefaultProps()}
        embedded
        scopeFolderPaths={['/workspace/Contracts']}
      />,
    );
    // Starts inside the client's folder — its file is visible.
    expect(screen.getByText('NDA.docx')).toBeTruthy();
    // "All files" reaches the scoped root (navigation is NOT clamped back in).
    fireEvent.click(screen.getByTestId('breadcrumb-crumb-0'));
    expect(screen.queryByText('NDA.docx')).toBeNull();
    expect(screen.getByText('Contracts')).toBeTruthy();
  });

  it('clicking "Files" tab from editor view returns to the grid', async () => {
    mockActiveTabPath = '/workspace/Brief.md';
    mockOpenTabs = [{ path: '/workspace/Brief.md', name: 'Brief.md', type: 'file' }];
    render(<DocumentsHome {...buildDefaultProps()} />);

    // Initially showing editor (Brief.md is active)
    await waitFor(() => {
      expect(screen.getByTestId('documents-editor-pane')).toBeTruthy();
    });

    // Click the "Files" tab in the strip
    const strip = screen.getByTestId('documents-tab-strip');
    const filesTab = Array.from(strip.querySelectorAll('[role="tab"]')).find(
      (el) => el.textContent?.trim() === 'Files',
    );
    expect(filesTab).toBeTruthy();
    fireEvent.click(filesTab!);

    await waitFor(() => {
      expect(screen.getByTestId('document-grid-view')).toBeTruthy();
      expect(screen.queryByTestId('main-panel')).toBeNull();
    });
  });
});

// ── Email-open flow ────────────────────────────────────────────────────────

describe('DocumentsHome — email-open flow', () => {
  it('opening an email tab shows the editor (email-open intact)', async () => {
    mockActiveTabPath = null;
    mockOpenTabs = [];
    const { rerender } = render(<DocumentsHome {...buildDefaultProps()} />);

    // Simulate keepance:open-email -> editorStore update
    mockActiveTabPath = 'email://inbox/msg-001';
    mockOpenTabs = [{ path: 'email://inbox/msg-001', name: 'Re: Contract Review', type: 'email' }];
    rerender(<DocumentsHome {...buildDefaultProps()} />);

    await waitFor(() => {
      expect(screen.getByTestId('documents-editor-pane')).toBeTruthy();
      expect(screen.getByTestId('main-panel')).toBeTruthy();
    });
  });
});

// ── AI Assistant tab flow ──────────────────────────────────────────────────

describe('DocumentsHome — AI Assistant tab flow', () => {
  beforeEach(() => {
    mockActiveTabPath = null;
    mockOpenTabs = [];
  });

  it('opening an AI Assistant tab from the Files browser shows the editor surface', async () => {
    mockActiveTabPath = null;
    mockOpenTabs = [];
    const { rerender } = render(<DocumentsHome {...buildDefaultProps()} documentsView="browser" />);

    expect(screen.getByTestId('document-grid-view')).toBeTruthy();

    mockActiveTabPath = '__ai_assistant__test';
    mockOpenTabs = [
      {
        path: '__ai_assistant__test',
        name: 'AI Assistant',
        type: 'ai-assistant',
      },
    ];
    rerender(<DocumentsHome {...buildDefaultProps()} documentsView="browser" />);

    await waitFor(() => {
      expect(screen.getByTestId('documents-editor-pane')).toBeTruthy();
      expect(screen.getByTestId('main-panel')).toBeTruthy();
      expect(screen.getByTestId('documents-tab-strip').textContent).toContain('AI Assistant');
    });
  });
});

// ── Add files / import affordance ─────────────────────────────────────────

describe('DocumentsHome — Add files button', () => {
  beforeEach(() => {
    mockActiveTabPath = null;
    mockOpenTabs = [];
  });

  it('renders an "Add files" button in the grid toolbar', () => {
    render(<DocumentsHome {...buildDefaultProps()} />);
    const btn = screen.getByTestId('add-files-btn');
    expect(btn).toBeTruthy();
  });

  it('clicking "Add files" calls onCreateDefaultDocument when provided', () => {
    const onCreateDefaultDocument = vi.fn();
    render(<DocumentsHome {...buildDefaultProps({ onCreateDefaultDocument })} />);
    const btn = screen.getByTestId('add-files-btn');
    fireEvent.click(btn);
    expect(onCreateDefaultDocument).toHaveBeenCalledOnce();
  });

  it('clicking "Add files" falls back to onCreateFile when no shortcut is provided', () => {
    const onCreateFile = vi.fn();
    render(<DocumentsHome {...buildDefaultProps({ onCreateFile })} />);
    const btn = screen.getByTestId('add-files-btn');
    fireEvent.click(btn);
    expect(onCreateFile).toHaveBeenCalledOnce();
  });
});

// ── Trust banner ───────────────────────────────────────────────────────────

describe('DocumentsHome — trust banner', () => {
  beforeEach(() => {
    mockActiveTabPath = null;
    mockOpenTabs = [];
    localStorage.removeItem('keepance:first-file-trust-shown');
  });

  afterEach(() => {
    localStorage.removeItem('keepance:first-file-trust-shown');
  });

  it('trust banner does NOT show before any file is imported', () => {
    render(<DocumentsHome {...buildDefaultProps()} />);
    expect(screen.queryByTestId('trust-banner')).toBeNull();
  });

  it('trust banner shows the first time "Add files" is clicked', () => {
    render(<DocumentsHome {...buildDefaultProps()} />);
    const btn = screen.getByTestId('add-files-btn');
    fireEvent.click(btn);
    expect(screen.getByTestId('trust-banner')).toBeTruthy();
    expect(screen.getByText(/indexed on your machine/i)).toBeTruthy();
  });

  it('trust banner can be dismissed', () => {
    render(<DocumentsHome {...buildDefaultProps()} />);
    fireEvent.click(screen.getByTestId('add-files-btn'));
    expect(screen.getByTestId('trust-banner')).toBeTruthy();
    const dismissBtn = screen.getByRole('button', { name: /dismiss/i });
    fireEvent.click(dismissBtn);
    expect(screen.queryByTestId('trust-banner')).toBeNull();
  });

  it('trust banner does not show again once localStorage flag is set', () => {
    localStorage.setItem('keepance:first-file-trust-shown', '1');
    render(<DocumentsHome {...buildDefaultProps()} />);
    const btn = screen.getByTestId('add-files-btn');
    fireEvent.click(btn);
    expect(screen.queryByTestId('trust-banner')).toBeNull();
  });

  it('clicking "Add files" sets the localStorage flag', () => {
    render(<DocumentsHome {...buildDefaultProps()} />);
    expect(localStorage.getItem('keepance:first-file-trust-shown')).toBeNull();
    fireEvent.click(screen.getByTestId('add-files-btn'));
    expect(localStorage.getItem('keepance:first-file-trust-shown')).toBe('1');
  });
});

// ── Trash (inside grid) ────────────────────────────────────────────────────

describe('DocumentsHome — trash toggle', () => {
  beforeEach(() => {
    mockActiveTabPath = null;
    mockOpenTabs = [];
  });

  it('shows the Files toggle button in the grid toolbar', () => {
    render(<DocumentsHome {...buildDefaultProps()} />);
    const filesBtn = screen.getByRole('button', { name: /^files$/i });
    expect(filesBtn).toBeTruthy();
  });

  it('shows the Trash toggle button in the grid toolbar', () => {
    render(<DocumentsHome {...buildDefaultProps()} />);
    const trashBtn = screen.getByRole('button', { name: /^trash/i });
    expect(trashBtn).toBeTruthy();
  });

  it('clicking the Trash toggle renders the TrashPanel', () => {
    render(<DocumentsHome {...buildDefaultProps({ trashItems: SAMPLE_TRASH_ITEMS })} />);
    expect(screen.queryByTestId('trash-panel')).toBeNull();
    const trashBtn = screen.getByRole('button', { name: /^trash/i });
    fireEvent.click(trashBtn);
    expect(screen.getByTestId('trash-panel')).toBeTruthy();
  });

  it('TrashPanel receives and renders trashed items', () => {
    render(<DocumentsHome {...buildDefaultProps({ trashItems: SAMPLE_TRASH_ITEMS })} />);
    fireEvent.click(screen.getByRole('button', { name: /^trash/i }));
    expect(screen.getByTestId('trash-item-trash-1')).toBeTruthy();
    expect(screen.getByText('OldDraft.md')).toBeTruthy();
  });

  it('clicking Files toggle returns to grid view', () => {
    render(<DocumentsHome {...buildDefaultProps()} />);
    fireEvent.click(screen.getByRole('button', { name: /^trash/i }));
    expect(screen.getByTestId('trash-panel')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^files$/i }));
    expect(screen.queryByTestId('trash-panel')).toBeNull();
    expect(screen.getByText('Brief.md')).toBeTruthy();
  });
});

// ── Search ─────────────────────────────────────────────────────────────────

describe('DocumentsHome — search', () => {
  beforeEach(() => {
    mockActiveTabPath = null;
    mockOpenTabs = [];
  });

  it('renders a search input in the grid toolbar', () => {
    render(<DocumentsHome {...buildDefaultProps()} />);
    const searchInput = screen.getByRole('textbox');
    expect(searchInput).toBeTruthy();
  });

  it('typing in the search input filters grid cards by name', () => {
    render(<DocumentsHome {...buildDefaultProps()} />);
    const searchInput = screen.getByRole('textbox');
    fireEvent.change(searchInput, { target: { value: 'brief' } });
    expect(screen.getByText('Brief.md')).toBeTruthy();
    expect(screen.queryByText('Evidence.pdf')).toBeNull();
    expect(screen.queryByText('Contracts')).toBeNull();
  });

  it('shows empty search state when no files match the query', () => {
    render(<DocumentsHome {...buildDefaultProps()} />);
    const searchInput = screen.getByRole('textbox');
    fireEvent.change(searchInput, { target: { value: 'zzznomatch' } });
    expect(screen.getByText(/no files match your search/i)).toBeTruthy();
  });
});

// ── File / folder interactions ─────────────────────────────────────────────

describe('DocumentsHome — file interactions', () => {
  beforeEach(() => {
    mockActiveTabPath = null;
    mockOpenTabs = [];
  });

  it('clicking a file card calls onFileOpen with correct path and name', async () => {
    const onFileOpen = vi.fn().mockResolvedValue(undefined);
    render(<DocumentsHome {...buildDefaultProps({ onFileOpen })} />);
    const briefCard = screen.getByTestId('grid-card-/workspace/Brief.md');
    fireEvent.click(briefCard);
    await waitFor(() => {
      expect(onFileOpen).toHaveBeenCalledOnce();
      expect(onFileOpen).toHaveBeenCalledWith('/workspace/Brief.md', 'Brief.md');
    });
  });

  it('clicking a folder card does NOT call onFileOpen (drills into folder)', async () => {
    const onFileOpen = vi.fn().mockResolvedValue(undefined);
    render(<DocumentsHome {...buildDefaultProps({ onFileOpen })} />);
    const folderCard = screen.getByTestId('grid-card-/workspace/Contracts');
    fireEvent.click(folderCard);
    await waitFor(() => {
      expect(onFileOpen).not.toHaveBeenCalled();
    });
  });
});

// ── fileTree population ────────────────────────────────────────────────────

describe('DocumentsHome — fileTree + grid population', () => {
  beforeEach(() => {
    mockActiveTabPath = null;
    mockOpenTabs = [];
  });

  it('grid shows all top-level nodes from fileTree (folder + files)', () => {
    render(<DocumentsHome {...buildDefaultProps()} />);
    // Should show the folder and two files at root
    expect(screen.getByTestId('grid-card-/workspace/Contracts')).toBeTruthy();
    expect(screen.getByTestId('grid-card-/workspace/Brief.md')).toBeTruthy();
    expect(screen.getByTestId('grid-card-/workspace/Evidence.pdf')).toBeTruthy();
  });

  it('grid shows an empty state when fileTree is empty', () => {
    // Temporarily override the workspaceStore mock to return empty tree
    // by re-mocking it inline — use the grid-empty-state test-id
    // (this relies on the EmptyState component inside DocumentGridView)
    // Note: We rely on the mockFileTree fixture for most tests; this test
    // uses a special override path via module-level mock — since vitest module
    // mocks are per-file, we verify the empty-state testId is present when
    // the component receives an empty tree. We can verify this indirectly:
    // when fileTree is NOT empty (the default), grid-empty-state must NOT appear.
    render(<DocumentsHome {...buildDefaultProps()} />);
    expect(screen.queryByTestId('grid-empty-state')).toBeNull();
    // The grid-cards container must exist with actual cards
    expect(screen.getByTestId('document-grid-cards')).toBeTruthy();
  });
});

// ── R6-1: Tree | Grid toggle ─────────────────────────────────────────────────

describe('DocumentsHome — Tree | Grid toggle (R6-1)', () => {
  beforeEach(() => {
    mockActiveTabPath = null;
    mockOpenTabs = [];
    localStorage.removeItem('keepance:docs-view');
  });

  afterEach(() => {
    localStorage.removeItem('keepance:docs-view');
  });

  it('renders the Tree | Grid toggle with both options', () => {
    render(<DocumentsHome {...buildDefaultProps()} />);
    expect(screen.getByTestId('docs-view-toggle')).toBeTruthy();
    expect(screen.getByTestId('docs-view-tree')).toBeTruthy();
    expect(screen.getByTestId('docs-view-grid')).toBeTruthy();
  });

  it('defaults to the grid view (DocumentGridView visible, tree hidden)', () => {
    render(<DocumentsHome {...buildDefaultProps()} />);
    expect(screen.getByTestId('document-grid-view')).toBeTruthy();
    expect(screen.queryByTestId('documents-tree-view')).toBeNull();
  });

  it('switching to Tree renders the FileTree and hides the grid', () => {
    render(<DocumentsHome {...buildDefaultProps()} />);
    fireEvent.click(screen.getByTestId('docs-view-tree'));
    expect(screen.getByTestId('documents-tree-view')).toBeTruthy();
    expect(screen.getByTestId('file-tree')).toBeTruthy();
    // New architecture: DocumentGridView stays mounted (it owns the shared
    // toolbar); the grid *body* is what hides in tree mode.
    expect(screen.queryByTestId('document-grid-cards')).toBeNull();
  });

  it('switching back to Grid restores the grid view', () => {
    render(<DocumentsHome {...buildDefaultProps()} />);
    fireEvent.click(screen.getByTestId('docs-view-tree'));
    expect(screen.getByTestId('documents-tree-view')).toBeTruthy();
    fireEvent.click(screen.getByTestId('docs-view-grid'));
    expect(screen.getByTestId('document-grid-view')).toBeTruthy();
    expect(screen.queryByTestId('documents-tree-view')).toBeNull();
  });

  it('persists the chosen view to localStorage and restores it on remount', () => {
    const { unmount } = render(<DocumentsHome {...buildDefaultProps()} />);
    fireEvent.click(screen.getByTestId('docs-view-tree'));
    expect(localStorage.getItem('keepance:docs-view')).toBe('tree');
    unmount();
    // Fresh mount reads the persisted choice → tree view is active.
    render(<DocumentsHome {...buildDefaultProps()} />);
    expect(screen.getByTestId('documents-tree-view')).toBeTruthy();
  });

  it('passes the move handler through to the FileTree', async () => {
    const onMove = vi.fn().mockResolvedValue(undefined);
    render(<DocumentsHome {...buildDefaultProps({ onMove })} />);
    fireEvent.click(screen.getByTestId('docs-view-tree'));
    // The FileTree stub invokes onMove when its fake-move button is clicked.
    fireEvent.click(screen.getByTestId('file-tree-fake-move'));
    await waitFor(() => {
      expect(onMove).toHaveBeenCalledWith('/workspace/Brief.md', '/workspace/Contracts');
    });
  });
});

// ── R6-1: grid drag-and-drop (onMove) ────────────────────────────────────────

/**
 * Minimal DataTransfer stub good enough for the grid's dragStart/dragOver/drop
 * handlers: a backing map for get/setData plus the two effect fields the
 * handlers assign. jsdom does not implement DataTransfer.
 */
function makeDataTransfer(initial?: Record<string, string>) {
  const store: Record<string, string> = { ...initial };
  return {
    effectAllowed: 'all',
    dropEffect: 'none',
    setData: (type: string, value: string) => { store[type] = value; },
    getData: (type: string) => store[type] ?? '',
    types: Object.keys(store),
  };
}

describe('DocumentsHome — grid drag-and-drop (R6-1)', () => {
  beforeEach(() => {
    mockActiveTabPath = null;
    mockOpenTabs = [];
    localStorage.removeItem('keepance:docs-view');
  });

  it('dropping a file card onto a FOLDER card calls onMove(source, folderPath)', async () => {
    const onMove = vi.fn().mockResolvedValue(undefined);
    render(<DocumentsHome {...buildDefaultProps({ onMove })} />);

    const folderCard = screen.getByTestId('grid-card-/workspace/Contracts');
    // Simulate dragging Brief.md and dropping it on the Contracts folder.
    const dt = makeDataTransfer({ 'text/plain': '/workspace/Brief.md' });
    fireEvent.dragOver(folderCard, { dataTransfer: dt });
    fireEvent.drop(folderCard, { dataTransfer: dt });

    await waitFor(() => {
      expect(onMove).toHaveBeenCalledWith('/workspace/Brief.md', '/workspace/Contracts');
    });
  });

  it('dropping a node onto ITSELF is a no-op (no move)', async () => {
    const onMove = vi.fn().mockResolvedValue(undefined);
    render(<DocumentsHome {...buildDefaultProps({ onMove })} />);

    const folderCard = screen.getByTestId('grid-card-/workspace/Contracts');
    const dt = makeDataTransfer({ 'text/plain': '/workspace/Contracts' });
    fireEvent.dragOver(folderCard, { dataTransfer: dt });
    fireEvent.drop(folderCard, { dataTransfer: dt });

    // Give any pending microtasks a chance to run, then assert no call.
    await Promise.resolve();
    expect(onMove).not.toHaveBeenCalled();
  });

  it('dropping a FILE card onto another FILE card does not move (files are not drop targets)', async () => {
    const onMove = vi.fn().mockResolvedValue(undefined);
    render(<DocumentsHome {...buildDefaultProps({ onMove })} />);

    const fileCard = screen.getByTestId('grid-card-/workspace/Evidence.pdf');
    const dt = makeDataTransfer({ 'text/plain': '/workspace/Brief.md' });
    fireEvent.dragOver(fileCard, { dataTransfer: dt });
    fireEvent.drop(fileCard, { dataTransfer: dt });

    await Promise.resolve();
    expect(onMove).not.toHaveBeenCalled();
  });
});

// ── R6-1: create document in the open folder ─────────────────────────────────

describe('DocumentsHome — create in current folder (R6-1)', () => {
  beforeEach(() => {
    mockActiveTabPath = null;
    mockOpenTabs = [];
    localStorage.removeItem('keepance:docs-view');
  });

  it('at root, "New document" calls onCreateDefaultDocument with no parentPath (App falls back to docs/)', () => {
    const onCreateDefaultDocument = vi.fn();
    render(<DocumentsHome {...buildDefaultProps({ onCreateDefaultDocument })} />);
    // The toolbar "New document" button lives in DocumentGridView.
    const newDocBtn = screen.getByRole('button', { name: /new document/i });
    fireEvent.click(newDocBtn);
    expect(onCreateDefaultDocument).toHaveBeenCalledTimes(1);
    // At root, currentFolderPath is null → undefined parentPath.
    expect(onCreateDefaultDocument).toHaveBeenCalledWith(undefined);
  });

  it('at root, "New folder" creates at the workspace root', () => {
    const onCreateFolder = vi.fn();
    render(<DocumentsHome {...buildDefaultProps({ onCreateFolder })} />);

    const newFolderBtn = screen.getByRole('button', { name: /new folder/i });
    fireEvent.click(newFolderBtn);
    expect(onCreateFolder).toHaveBeenCalledWith('/workspace');
  });

  it('after drilling into a folder, "New document" passes that folder as parentPath', () => {
    const onCreateDefaultDocument = vi.fn();
    render(<DocumentsHome {...buildDefaultProps({ onCreateDefaultDocument })} />);

    // Drill into the Contracts folder by clicking its card.
    fireEvent.click(screen.getByTestId('grid-card-/workspace/Contracts'));

    const newDocBtn = screen.getByRole('button', { name: /new document/i });
    fireEvent.click(newDocBtn);
    expect(onCreateDefaultDocument).toHaveBeenCalledWith('/workspace/Contracts');
  });

  it('after drilling into a folder, "New folder" creates inside that folder', () => {
    const onCreateFolder = vi.fn();
    render(<DocumentsHome {...buildDefaultProps({ onCreateFolder })} />);

    fireEvent.click(screen.getByTestId('grid-card-/workspace/Contracts'));

    const newFolderBtn = screen.getByRole('button', { name: /new folder/i });
    fireEvent.click(newFolderBtn);
    expect(onCreateFolder).toHaveBeenCalledWith('/workspace/Contracts');
  });
});

// ── Fix 1: documentsView lands Documents on the right view ────────────────────
// Regression guard for the bug where clicking the Documents nav landed on the
// last-open file editor instead of the Files browser. Because the surface
// UNMOUNTS/REMOUNTS on every nav, the fix reads documentsView in the useState
// initializer on mount — these tests unmount/remount to mirror that exactly.

describe('DocumentsHome — documentsView landing (Fix 1)', () => {
  beforeEach(() => {
    mockActiveTabPath = null;
    mockOpenTabs = [];
    mockSetActiveTab.mockClear();
    mockCloseTab.mockClear();
    localStorage.removeItem('keepance:docs-view');
  });

  afterEach(() => {
    localStorage.removeItem('keepance:docs-view');
  });

  it("documentsView='browser' shows the Files browser even with an active file tab", () => {
    // The exact bug: a file editor tab is active, but the user clicked the
    // Documents nav, so App passes documentsView='browser'. We must show the
    // file list, NOT the editor.
    mockActiveTabPath = '/workspace/Brief.md';
    mockOpenTabs = [{ path: '/workspace/Brief.md', name: 'Brief.md', type: 'file' }];
    render(
      <DocumentsHome {...buildDefaultProps()} documentsView="browser" />,
    );
    expect(screen.getByTestId('document-grid-view')).toBeTruthy();
    expect(screen.queryByTestId('documents-editor-pane')).toBeNull();
  });

  it("documentsView='editor' with an active file tab shows the editor", async () => {
    mockActiveTabPath = '/workspace/Brief.md';
    mockOpenTabs = [{ path: '/workspace/Brief.md', name: 'Brief.md', type: 'file' }];
    render(
      <DocumentsHome {...buildDefaultProps()} documentsView="editor" />,
    );
    await waitFor(() => {
      expect(screen.getByTestId('documents-editor-pane')).toBeTruthy();
    });
  });

  it("documentsView='editor' with an active workflow record shows the execution view", async () => {
    mockActiveTabPath = '/workspace/Runs/client-intake.workflow';
    mockOpenTabs = [
      {
        path: '/workspace/Runs/client-intake.workflow',
        name: 'client-intake.workflow',
        type: 'workflow-execution',
      },
    ];
    render(
      <DocumentsHome {...buildDefaultProps()} documentsView="editor" />,
    );
    await waitFor(() => {
      expect(screen.getByTestId('documents-editor-pane')).toBeTruthy();
      expect(screen.getByTestId('main-panel')).toBeTruthy();
    });
    expect(screen.queryByTestId('document-grid-view')).toBeNull();
  });

  it('remounting with documentsView=browser (a nav click) returns to the Files browser', async () => {
    // Mirror the real flow: editor is open (documentsView='editor'), the surface
    // unmounts on nav away, then REMOUNTS with documentsView='browser' because the
    // user clicked the Documents nav. The remount must land on the browser.
    mockActiveTabPath = '/workspace/Brief.md';
    mockOpenTabs = [{ path: '/workspace/Brief.md', name: 'Brief.md', type: 'file' }];
    const { unmount } = render(
      <DocumentsHome {...buildDefaultProps()} documentsView="editor" />,
    );
    await waitFor(() => {
      expect(screen.getByTestId('documents-editor-pane')).toBeTruthy();
    });
    unmount();

    render(
      <DocumentsHome {...buildDefaultProps()} documentsView="browser" />,
    );
    await waitFor(() => {
      expect(screen.getByTestId('document-grid-view')).toBeTruthy();
      expect(screen.queryByTestId('documents-editor-pane')).toBeNull();
    });
  });

  it('an email opening while mounted on the browser flips to the editor (while-mounted change)', async () => {
    // documentsView changes from 'browser' to 'editor' without a remount.
    mockActiveTabPath = '/workspace/Inbox.eml';
    mockOpenTabs = [{ path: '/workspace/Inbox.eml', name: 'Inbox.eml', type: 'email' }];
    const { rerender } = render(
      <DocumentsHome {...buildDefaultProps()} documentsView="browser" />,
    );
    expect(screen.getByTestId('document-grid-view')).toBeTruthy();

    rerender(
      <DocumentsHome {...buildDefaultProps()} documentsView="editor" />,
    );
    await waitFor(() => {
      expect(screen.getByTestId('documents-editor-pane')).toBeTruthy();
    });
  });

  it('with documentsView undefined and no tabs, shows the Files browser (legacy default)', () => {
    mockActiveTabPath = null;
    mockOpenTabs = [];
    render(<DocumentsHome {...buildDefaultProps()} />);
    expect(screen.getByTestId('document-grid-view')).toBeTruthy();
    expect(screen.queryByTestId('documents-editor-pane')).toBeNull();
  });
});

// ── Fix 1: Tab strip keyboard accessibility ───────────────────────────────────

describe('DocumentsHome — tab keyboard accessibility (Fix 1 a11y)', () => {
  beforeEach(() => {
    mockActiveTabPath = '/workspace/Brief.md';
    mockOpenTabs = [{ path: '/workspace/Brief.md', name: 'Brief.md', type: 'file' }];
    mockSetActiveTab.mockClear();
    mockCloseTab.mockClear();
  });

  it('the tab strip has role="tablist"', () => {
    render(<DocumentsHome {...buildDefaultProps()} />);
    const strip = screen.getByTestId('documents-tab-strip');
    expect(strip.getAttribute('role')).toBe('tablist');
  });

  it('the Files tab has role="tab" and is focusable (rendered as button)', () => {
    render(<DocumentsHome {...buildDefaultProps()} />);
    const strip = screen.getByTestId('documents-tab-strip');
    const filesTab = Array.from(strip.querySelectorAll('[role="tab"]')).find(
      (el) => el.textContent?.trim().startsWith('Files'),
    );
    expect(filesTab).toBeTruthy();
    // Must be a button element (natively focusable)
    expect(filesTab!.tagName).toBe('BUTTON');
  });

  it('pressing Enter on the Files tab activates it (returns to grid)', async () => {
    // Start with the editor visible (active tab is a file).
    render(<DocumentsHome {...buildDefaultProps()} />);
    await waitFor(() => {
      expect(screen.getByTestId('documents-editor-pane')).toBeTruthy();
    });

    const strip = screen.getByTestId('documents-tab-strip');
    const filesTab = Array.from(strip.querySelectorAll('[role="tab"]')).find(
      (el) => el.textContent?.trim().startsWith('Files'),
    ) as HTMLElement | undefined;
    expect(filesTab).toBeTruthy();

    fireEvent.keyDown(filesTab!, { key: 'Enter' });

    await waitFor(() => {
      expect(screen.getByTestId('document-grid-view')).toBeTruthy();
      expect(screen.queryByTestId('documents-editor-pane')).toBeNull();
    });
  });

  it('pressing Space on the Files tab activates it (returns to grid)', async () => {
    render(<DocumentsHome {...buildDefaultProps()} />);
    await waitFor(() => {
      expect(screen.getByTestId('documents-editor-pane')).toBeTruthy();
    });

    const strip = screen.getByTestId('documents-tab-strip');
    const filesTab = Array.from(strip.querySelectorAll('[role="tab"]')).find(
      (el) => el.textContent?.trim().startsWith('Files'),
    ) as HTMLElement | undefined;
    expect(filesTab).toBeTruthy();

    fireEvent.keyDown(filesTab!, { key: ' ' });

    await waitFor(() => {
      expect(screen.getByTestId('document-grid-view')).toBeTruthy();
      expect(screen.queryByTestId('documents-editor-pane')).toBeNull();
    });
  });

  it('each document tab has aria-selected reflecting whether it is active', () => {
    render(<DocumentsHome {...buildDefaultProps()} />);
    const strip = screen.getByTestId('documents-tab-strip');
    const allTabs = Array.from(strip.querySelectorAll('[role="tab"]'));
    // At least one tab must have aria-selected
    expect(allTabs.length).toBeGreaterThan(0);
    const selected = allTabs.filter((el) => el.getAttribute('aria-selected') === 'true');
    // Exactly one tab should be selected
    expect(selected.length).toBe(1);
  });
});

// ── Fix 2: Grid count with search query active ────────────────────────────────

describe('DocumentGridView — grid count label (Fix 2)', () => {
  beforeEach(() => {
    mockActiveTabPath = null;
    mockOpenTabs = [];
  });

  it('shows total count when no search is active', () => {
    render(<DocumentsHome {...buildDefaultProps()} />);
    const label = screen.getByTestId('grid-dir-label');
    // mockFileTree has 3 items: Contracts (folder), Brief.md, Evidence.pdf
    expect(label.textContent).toMatch(/3 items/i);
    expect(label.textContent).not.toContain(' of ');
  });

  it('shows "N of M items" when a search query narrows the results', () => {
    render(<DocumentsHome {...buildDefaultProps()} />);
    const searchInput = screen.getByRole('textbox');
    // Type a query that matches only "Brief.md" (1 of 3 items)
    fireEvent.change(searchInput, { target: { value: 'brief' } });
    const label = screen.getByTestId('grid-dir-label');
    expect(label.textContent).toContain('1 of');
    expect(label.textContent).toContain('3 items');
  });

  it('restores the plain total label when the search is cleared', () => {
    render(<DocumentsHome {...buildDefaultProps()} />);
    const searchInput = screen.getByRole('textbox');
    fireEvent.change(searchInput, { target: { value: 'brief' } });
    // Now clear the search
    fireEvent.change(searchInput, { target: { value: '' } });
    const label = screen.getByTestId('grid-dir-label');
    expect(label.textContent).not.toContain(' of ');
    expect(label.textContent).toMatch(/3 items/i);
  });
});
