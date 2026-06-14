/**
 * ReimaginedDocumentsHome — unit tests
 *
 * Covers:
 *  1. Split layout renders file list and editor pane together (not a toggle)
 *  2. When no file is open the right pane shows the placeholder
 *  3. When a file/email tab is active the editor pane renders mainPanelContent
 *     with the file list (left panel) still visible — the list does not disappear
 *  4. Trash toggle in the left panel shows trashed items (delegates to TrashPanel)
 *  5. Search filters file rows by name
 *  6. "Add files" import button exists in the left panel header
 *  7. Trust banner shows the first time a file is imported, not again after dismissal
 *  8. Email open (email-type tab) shows mainPanelContent in the right pane
 *
 * All stores and heavy sub-components are mocked so the test suite is fast
 * and does not touch the filesystem or database.
 */

import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
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

// Editor store mock — default: no active tab (no file open)
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

// ── Split layout ───────────────────────────────────────────────────────────

describe('ReimaginedDocumentsHome — persistent split layout', () => {
  beforeEach(() => {
    mockActiveTabPath = null;
    mockOpenTabs = [];
  });

  it('renders the split container (reimagined-documents-split)', () => {
    render(<ReimaginedDocumentsHome {...buildDefaultProps()} />);
    expect(screen.getByTestId('reimagined-documents-split')).toBeTruthy();
  });

  it('renders both left panel and right panel simultaneously (not a toggle)', () => {
    render(<ReimaginedDocumentsHome {...buildDefaultProps()} />);
    expect(screen.getByTestId('documents-left-panel')).toBeTruthy();
    expect(screen.getByTestId('documents-right-panel')).toBeTruthy();
  });

  it('shows the placeholder in the right panel when no file is open', () => {
    render(<ReimaginedDocumentsHome {...buildDefaultProps()} />);
    expect(screen.getByTestId('right-panel-placeholder')).toBeTruthy();
    // main panel should NOT render
    expect(screen.queryByTestId('main-panel')).toBeNull();
  });

  it('renders file rows in the left panel when no file is open', () => {
    render(<ReimaginedDocumentsHome {...buildDefaultProps()} />);
    expect(screen.getByText('Contracts')).toBeTruthy();
    expect(screen.getByText('Brief.md')).toBeTruthy();
    expect(screen.getByText('Evidence.pdf')).toBeTruthy();
  });

  it('opening a file shows it on the right with the left panel still visible', async () => {
    mockActiveTabPath = null;
    mockOpenTabs = [];
    const { rerender } = render(<ReimaginedDocumentsHome {...buildDefaultProps()} />);

    // Simulate opening a file tab
    mockActiveTabPath = '/workspace/Brief.md';
    mockOpenTabs = [{ path: '/workspace/Brief.md', name: 'Brief.md', type: 'file' }];
    rerender(<ReimaginedDocumentsHome {...buildDefaultProps()} />);

    await waitFor(() => {
      // Editor pane appears on the right
      expect(screen.getByTestId('documents-editor-pane')).toBeTruthy();
      expect(screen.getByTestId('main-panel')).toBeTruthy();
    });

    // Left panel remains visible — file list should still be in the DOM
    expect(screen.getByTestId('documents-left-panel')).toBeTruthy();
    // And file rows should still be rendered
    expect(screen.getByText('Brief.md')).toBeTruthy();
    expect(screen.getByText('Contracts')).toBeTruthy();
  });

  it('left panel can be collapsed and expanded', () => {
    render(<ReimaginedDocumentsHome {...buildDefaultProps()} />);
    // Collapse
    const collapseBtn = screen.getByRole('button', { name: /collapse file list/i });
    fireEvent.click(collapseBtn);
    expect(screen.queryByTestId('documents-left-panel')).toBeNull();
    // Expand
    const expandBtn = screen.getByRole('button', { name: /expand file list/i });
    fireEvent.click(expandBtn);
    expect(screen.getByTestId('documents-left-panel')).toBeTruthy();
  });
});

// ── Email open ─────────────────────────────────────────────────────────────

describe('ReimaginedDocumentsHome — email-open flow', () => {
  it('opening an email tab shows mainPanelContent in the right pane with list still present', async () => {
    mockActiveTabPath = null;
    mockOpenTabs = [];
    const { rerender } = render(<ReimaginedDocumentsHome {...buildDefaultProps()} />);

    // Simulate the keepance:open-email -> editorStore update
    mockActiveTabPath = 'email://inbox/msg-001';
    mockOpenTabs = [{ path: 'email://inbox/msg-001', name: 'Re: Contract Review', type: 'email' }];
    rerender(<ReimaginedDocumentsHome {...buildDefaultProps()} />);

    await waitFor(() => {
      expect(screen.getByTestId('documents-editor-pane')).toBeTruthy();
      expect(screen.getByTestId('main-panel')).toBeTruthy();
    });

    // Left panel must remain visible for the email-open flow
    expect(screen.getByTestId('documents-left-panel')).toBeTruthy();
  });
});

// ── Add files / import affordance ─────────────────────────────────────────

describe('ReimaginedDocumentsHome — Add files button', () => {
  beforeEach(() => {
    mockActiveTabPath = null;
    mockOpenTabs = [];
  });

  it('renders an "Add files" button in the left panel header', () => {
    render(<ReimaginedDocumentsHome {...buildDefaultProps()} />);
    const btn = screen.getByTestId('add-files-btn');
    expect(btn).toBeTruthy();
  });

  it('clicking "Add files" calls onCreateDefaultDocument when provided', () => {
    const onCreateDefaultDocument = vi.fn();
    render(<ReimaginedDocumentsHome {...buildDefaultProps({ onCreateDefaultDocument })} />);
    const btn = screen.getByTestId('add-files-btn');
    fireEvent.click(btn);
    expect(onCreateDefaultDocument).toHaveBeenCalledOnce();
  });

  it('clicking "Add files" falls back to onCreateFile when no shortcut is provided', () => {
    const onCreateFile = vi.fn();
    render(<ReimaginedDocumentsHome {...buildDefaultProps({ onCreateFile })} />);
    const btn = screen.getByTestId('add-files-btn');
    fireEvent.click(btn);
    expect(onCreateFile).toHaveBeenCalledOnce();
  });

  it('right-panel placeholder also has an "Add files" button', () => {
    render(<ReimaginedDocumentsHome {...buildDefaultProps()} />);
    // The placeholder renders an "Add files" button
    const addBtns = screen.getAllByRole('button', { name: /add files/i });
    // At least two: one in the left panel header, one in the placeholder
    expect(addBtns.length).toBeGreaterThanOrEqual(2);
  });
});

// ── Trust banner ───────────────────────────────────────────────────────────

describe('ReimaginedDocumentsHome — trust banner', () => {
  beforeEach(() => {
    mockActiveTabPath = null;
    mockOpenTabs = [];
    // Clear the trust flag before each test
    localStorage.removeItem('keepance:first-file-trust-shown');
  });

  afterEach(() => {
    localStorage.removeItem('keepance:first-file-trust-shown');
  });

  it('trust banner does NOT show before any file is imported', () => {
    render(<ReimaginedDocumentsHome {...buildDefaultProps()} />);
    expect(screen.queryByTestId('trust-banner')).toBeNull();
  });

  it('trust banner shows the first time "Add files" is clicked', () => {
    render(<ReimaginedDocumentsHome {...buildDefaultProps()} />);
    const btn = screen.getByTestId('add-files-btn');
    fireEvent.click(btn);
    expect(screen.getByTestId('trust-banner')).toBeTruthy();
    expect(screen.getByText(/indexed on your machine/i)).toBeTruthy();
  });

  it('trust banner can be dismissed', () => {
    render(<ReimaginedDocumentsHome {...buildDefaultProps()} />);
    fireEvent.click(screen.getByTestId('add-files-btn'));
    expect(screen.getByTestId('trust-banner')).toBeTruthy();
    const dismissBtn = screen.getByRole('button', { name: /dismiss/i });
    fireEvent.click(dismissBtn);
    expect(screen.queryByTestId('trust-banner')).toBeNull();
  });

  it('trust banner does not show again once the localStorage flag is set', () => {
    // Pre-set the flag as if a previous session already showed the banner
    localStorage.setItem('keepance:first-file-trust-shown', '1');
    render(<ReimaginedDocumentsHome {...buildDefaultProps()} />);
    const btn = screen.getByTestId('add-files-btn');
    fireEvent.click(btn);
    expect(screen.queryByTestId('trust-banner')).toBeNull();
  });

  it('clicking "Add files" sets the localStorage flag', () => {
    render(<ReimaginedDocumentsHome {...buildDefaultProps()} />);
    expect(localStorage.getItem('keepance:first-file-trust-shown')).toBeNull();
    fireEvent.click(screen.getByTestId('add-files-btn'));
    expect(localStorage.getItem('keepance:first-file-trust-shown')).toBe('1');
  });
});

// ── Trash (left panel) ─────────────────────────────────────────────────────

describe('ReimaginedDocumentsHome — trash toggle', () => {
  beforeEach(() => {
    mockActiveTabPath = null;
    mockOpenTabs = [];
  });

  it('shows the Files toggle button', () => {
    render(<ReimaginedDocumentsHome {...buildDefaultProps()} />);
    const filesBtn = screen.getByRole('button', { name: /^files$/i });
    expect(filesBtn).toBeTruthy();
  });

  it('shows the Trash toggle button', () => {
    render(<ReimaginedDocumentsHome {...buildDefaultProps()} />);
    const trashBtn = screen.getByRole('button', { name: /^trash/i });
    expect(trashBtn).toBeTruthy();
  });

  it('clicking the Trash toggle renders the TrashPanel', () => {
    render(<ReimaginedDocumentsHome {...buildDefaultProps({ trashItems: SAMPLE_TRASH_ITEMS })} />);
    expect(screen.queryByTestId('trash-panel')).toBeNull();
    const trashBtn = screen.getByRole('button', { name: /^trash/i });
    fireEvent.click(trashBtn);
    expect(screen.getByTestId('trash-panel')).toBeTruthy();
  });

  it('TrashPanel receives and renders trashed items', () => {
    render(<ReimaginedDocumentsHome {...buildDefaultProps({ trashItems: SAMPLE_TRASH_ITEMS })} />);
    fireEvent.click(screen.getByRole('button', { name: /^trash/i }));
    expect(screen.getByTestId('trash-item-trash-1')).toBeTruthy();
    expect(screen.getByText('OldDraft.md')).toBeTruthy();
  });

  it('clicking Files toggle returns to file browser view', () => {
    render(<ReimaginedDocumentsHome {...buildDefaultProps()} />);
    fireEvent.click(screen.getByRole('button', { name: /^trash/i }));
    expect(screen.getByTestId('trash-panel')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^files$/i }));
    expect(screen.queryByTestId('trash-panel')).toBeNull();
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
    expect(screen.getByText('Brief.md')).toBeTruthy();
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

// ── File open ──────────────────────────────────────────────────────────────

describe('ReimaginedDocumentsHome — file interactions', () => {
  beforeEach(() => {
    mockActiveTabPath = null;
    mockOpenTabs = [];
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
    await waitFor(() => {
      expect(onFileOpen).not.toHaveBeenCalled();
    });
  });
});
