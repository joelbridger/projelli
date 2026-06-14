/**
 * ReimaginedDocumentsHome — unit tests
 *
 * Covers:
 *  1. Browser view renders file rows from the workspace store
 *  2. Clicking a file row calls onFileOpen with the correct path + name
 *  3. Clicking a folder row drills into the folder (does NOT call onFileOpen)
 *  4. Trash toggle shows trashed items (delegates to TrashPanel)
 *  5. Search filters file rows by name
 *  6. "← Documents" back button appears in editor view
 *
 * All stores and heavy sub-components are mocked so the test suite is fast
 * and does not touch the filesystem or database.
 */

import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ReimaginedDocumentsHome, type ReimaginedDocumentsHomeProps } from '@/components/documents/ReimaginedDocumentsHome';
import type { FileNode } from '@/types/workspace';
import type { TrashedItem, TrashStats } from '@/modules/history/TrashService';

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
vi.mock('@/stores/workspaceStore', () => ({
  useWorkspaceStore: (selector: (s: object) => unknown) =>
    selector({
      fileTree: mockFileTree,
      rootPath: '/workspace',
    }),
}));

// Editor store mock — default: no active tab (browser view)
let mockActiveTabPath: string | null = null;
let mockOpenTabs: Array<{ path: string; name: string; type?: string }> = [];

vi.mock('@/stores/editorStore', () => ({
  useEditorStore: (selector: (s: object) => unknown) =>
    selector({
      activeTabPath: mockActiveTabPath,
      openTabs: mockOpenTabs,
    }),
}));

// TrashPanel mock — renders trash items as a list so we can assert on them
vi.mock('@/components/common/TrashPanel', () => ({
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

function buildDefaultProps(overrides: Partial<ReimaginedDocumentsHomeProps> = {}): ReimaginedDocumentsHomeProps {
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

describe('ReimaginedDocumentsHome — browser view (default)', () => {
  beforeEach(() => {
    // Reset to browser view (no active file tab)
    mockActiveTabPath = null;
    mockOpenTabs = [];
  });

  it('renders the Documents eyebrow and heading', () => {
    render(<ReimaginedDocumentsHome {...buildDefaultProps()} />);
    // The eyebrow text is "Documents" styled uppercase via CSS; jsdom returns the raw text
    // Both the eyebrow div and the h1 contain "Documents"
    const allDocuments = screen.getAllByText('Documents');
    // Should have at least one match (eyebrow or heading)
    expect(allDocuments.length).toBeGreaterThanOrEqual(1);
  });

  it('renders a row for each root-level file and folder', () => {
    render(<ReimaginedDocumentsHome {...buildDefaultProps()} />);
    // mockFileTree has 1 folder + 2 files at root level
    expect(screen.getByText('Contracts')).toBeTruthy();
    expect(screen.getByText('Brief.md')).toBeTruthy();
    expect(screen.getByText('Evidence.pdf')).toBeTruthy();
  });

  it('clicking a file row calls onFileOpen with the correct path and name', async () => {
    const onFileOpen = vi.fn().mockResolvedValue(undefined);
    render(<ReimaginedDocumentsHome {...buildDefaultProps({ onFileOpen })} />);
    const briefRow = screen.getByText('Brief.md').closest('button');
    expect(briefRow).not.toBeNull();
    fireEvent.click(briefRow!);
    await waitFor(() => {
      expect(onFileOpen).toHaveBeenCalledOnce();
      expect(onFileOpen).toHaveBeenCalledWith('/workspace/Brief.md', 'Brief.md');
    });
  });

  it('clicking a folder row does NOT call onFileOpen', async () => {
    const onFileOpen = vi.fn().mockResolvedValue(undefined);
    render(<ReimaginedDocumentsHome {...buildDefaultProps({ onFileOpen })} />);
    const folderRow = screen.getByText('Contracts').closest('button');
    expect(folderRow).not.toBeNull();
    fireEvent.click(folderRow!);
    // Wait a tick to catch any async calls
    await waitFor(() => {
      expect(onFileOpen).not.toHaveBeenCalled();
    });
  });

  it('shows the table header columns: Name, Type, Modified, Size', () => {
    render(<ReimaginedDocumentsHome {...buildDefaultProps()} />);
    expect(screen.getByText('Name')).toBeTruthy();
    expect(screen.getByText('Type')).toBeTruthy();
    expect(screen.getByText('Modified')).toBeTruthy();
    expect(screen.getByText('Size')).toBeTruthy();
  });

  it('shows "New Word document" and "New folder" action buttons', () => {
    render(<ReimaginedDocumentsHome {...buildDefaultProps()} />);
    const newDocBtn = screen.getByRole('button', { name: /new word document/i });
    expect(newDocBtn).toBeTruthy();
    const newFolderBtn = screen.getByRole('button', { name: /new folder/i });
    expect(newFolderBtn).toBeTruthy();
  });
});

// ── Trash toggle ───────────────────────────────────────────────────────────

describe('ReimaginedDocumentsHome — trash toggle', () => {
  beforeEach(() => {
    mockActiveTabPath = null;
    mockOpenTabs = [];
  });

  it('shows the Files toggle button in the header', () => {
    render(<ReimaginedDocumentsHome {...buildDefaultProps()} />);
    const filesBtn = screen.getByRole('button', { name: /^files$/i });
    expect(filesBtn).toBeTruthy();
  });

  it('shows the Trash toggle button in the header', () => {
    render(<ReimaginedDocumentsHome {...buildDefaultProps()} />);
    const trashBtn = screen.getByRole('button', { name: /^trash/i });
    expect(trashBtn).toBeTruthy();
  });

  it('clicking the Trash toggle renders the TrashPanel', () => {
    render(<ReimaginedDocumentsHome {...buildDefaultProps({ trashItems: SAMPLE_TRASH_ITEMS })} />);
    // Initially trash panel is not visible
    expect(screen.queryByTestId('trash-panel')).toBeNull();
    // Click the Trash button
    const trashBtn = screen.getByRole('button', { name: /^trash/i });
    fireEvent.click(trashBtn);
    // TrashPanel should now be rendered
    expect(screen.getByTestId('trash-panel')).toBeTruthy();
  });

  it('TrashPanel receives and renders trashed items', () => {
    render(<ReimaginedDocumentsHome {...buildDefaultProps({ trashItems: SAMPLE_TRASH_ITEMS })} />);
    const trashBtn = screen.getByRole('button', { name: /^trash/i });
    fireEvent.click(trashBtn);
    // The mocked TrashPanel renders each item by name
    expect(screen.getByTestId('trash-item-trash-1')).toBeTruthy();
    expect(screen.getByText('OldDraft.md')).toBeTruthy();
  });

  it('clicking Files toggle returns to file browser view', () => {
    render(<ReimaginedDocumentsHome {...buildDefaultProps()} />);
    // Switch to Trash
    fireEvent.click(screen.getByRole('button', { name: /^trash/i }));
    expect(screen.getByTestId('trash-panel')).toBeTruthy();
    // Switch back to Files
    fireEvent.click(screen.getByRole('button', { name: /^files$/i }));
    expect(screen.queryByTestId('trash-panel')).toBeNull();
    // File rows should be visible again
    expect(screen.getByText('Brief.md')).toBeTruthy();
  });
});

// ── Search ─────────────────────────────────────────────────────────────────

describe('ReimaginedDocumentsHome — search', () => {
  beforeEach(() => {
    mockActiveTabPath = null;
    mockOpenTabs = [];
  });

  it('renders a search input', () => {
    render(<ReimaginedDocumentsHome {...buildDefaultProps()} />);
    const searchInput = screen.getByRole('textbox');
    expect(searchInput).toBeTruthy();
  });

  it('typing in the search input filters rows by name', () => {
    render(<ReimaginedDocumentsHome {...buildDefaultProps()} />);
    const searchInput = screen.getByRole('textbox');
    fireEvent.change(searchInput, { target: { value: 'brief' } });
    // Brief.md should match
    expect(screen.getByText('Brief.md')).toBeTruthy();
    // Evidence.pdf and Contracts should not be visible
    expect(screen.queryByText('Evidence.pdf')).toBeNull();
    expect(screen.queryByText('Contracts')).toBeNull();
  });

  it('shows empty search state when no files match the query', () => {
    render(<ReimaginedDocumentsHome {...buildDefaultProps()} />);
    const searchInput = screen.getByRole('textbox');
    fireEvent.change(searchInput, { target: { value: 'zzznomatch' } });
    expect(screen.getByText(/no files match your search/i)).toBeTruthy();
  });
});

// ── Editor view ────────────────────────────────────────────────────────────

describe('ReimaginedDocumentsHome — editor view', () => {
  it('renders mainPanelContent when viewMode is editor (back button clicked)', async () => {
    // Start in browser view
    mockActiveTabPath = null;
    mockOpenTabs = [];
    const { rerender } = render(<ReimaginedDocumentsHome {...buildDefaultProps()} />);

    // Simulate opening a file: set activeTabPath to a real file tab
    mockActiveTabPath = '/workspace/Brief.md';
    mockOpenTabs = [{ path: '/workspace/Brief.md', name: 'Brief.md', type: 'file' }];

    // Re-render with the updated store state
    rerender(<ReimaginedDocumentsHome {...buildDefaultProps()} />);

    // The setTimeout in the effect means we need to wait a tick
    await waitFor(() => {
      expect(screen.getByTestId('main-panel')).toBeTruthy();
    });
  });

  it('shows a back button ("Documents") in the editor view', async () => {
    mockActiveTabPath = '/workspace/Brief.md';
    mockOpenTabs = [{ path: '/workspace/Brief.md', name: 'Brief.md', type: 'file' }];
    render(<ReimaginedDocumentsHome {...buildDefaultProps()} />);

    await waitFor(() => {
      // The breadcrumb/back button should say "Documents"
      const backButton = screen.queryByRole('button', { name: /documents/i });
      expect(backButton).toBeTruthy();
    });
  });

  it('clicking the back button returns to browser view', async () => {
    mockActiveTabPath = '/workspace/Brief.md';
    mockOpenTabs = [{ path: '/workspace/Brief.md', name: 'Brief.md', type: 'file' }];
    render(<ReimaginedDocumentsHome {...buildDefaultProps()} />);

    // Wait for editor view
    await waitFor(() => {
      expect(screen.getByTestId('main-panel')).toBeTruthy();
    });

    // Click back
    const backBtn = screen.getByRole('button', { name: /documents/i });
    fireEvent.click(backBtn);

    // Should return to browser — file rows visible
    await waitFor(() => {
      expect(screen.queryByTestId('main-panel')).toBeNull();
      expect(screen.getByText('Brief.md')).toBeTruthy();
    });
  });
});
