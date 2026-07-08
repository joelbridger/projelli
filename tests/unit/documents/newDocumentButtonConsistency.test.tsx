/**
 * QA-26 (P3) — "New document" affordances must behave consistently.
 *
 * Persona-C's klutz exploration reported that the Files menu's "New document"
 * button (shown once a client has files) created a file INSTANTLY with a
 * generic name (`my-document.docx`) and no naming prompt, while the
 * empty-state "+ New Word document" button (shown when a client has zero
 * files) opened the "Create Word Document" naming dialog first — an
 * inconsistent, confusing affordance (see BUG-DB QA-26).
 *
 * Investigation for this fix found BOTH buttons already route through the
 * exact same `onCreateDefaultDocument` prop in this codebase — the Files menu's
 * `handleCreateDocument` (DocumentsHome.tsx) and the empty-state's wiring
 * (DocumentGridView.tsx's `WorkspaceEmptyState`) both call
 * `onCreateDefaultDocument(parentPath)` first, with the identical
 * `onCreateDocxAtRoot`/`onCreateFile` fallback chain — and
 * `onCreateDefaultDocument` (`useDocumentCreation.ts`'s
 * `handleCreateDefaultDocument`) always resolves to a prompting handler
 * (`handleCreateDocxAtRoot` or `handleCreateTextFileAtRoot`), never an
 * instant, dialog-free create. The literal "Files menu creates instantly, no
 * dialog" behavior does not reproduce against this branch's code — evidence
 * screenshots from the SAME exploration session (06-after-newdoc.jpeg,
 * 11-garcia-newdoc-dialog.jpeg) also show that button opening the
 * naming dialog. This is a regression guard locking in that consistency —
 * both buttons must always resolve to the SAME creation entry point — so a
 * future change can't silently reintroduce the split.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DocumentsHome, type DocumentsHomeProps } from '@/features/documents/DocumentsHome';
import type { TrashStats } from '@/platform/history/TrashService';

// An entirely empty workspace so the grid's zero-files empty state renders
// (see DocumentGridView.tsx: `fileTree.length === 0` shows WorkspaceEmptyState)
// alongside the Files menu, which renders regardless of file count — reproducing
// the exact "both buttons visible at once" scenario from the bug report.
vi.mock('@/platform/fs/workspaceStore', () => ({
  useWorkspaceStore: (selector: (s: object) => unknown) =>
    selector({ fileTree: [], rootPath: '/workspace' }),
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

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const EMPTY_TRASH_STATS: TrashStats = { itemCount: 0, totalSize: 0, oldestItem: undefined };

function buildProps(overrides: Partial<DocumentsHomeProps> = {}): DocumentsHomeProps {
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

async function openFilesCreateMenu() {
  const trigger = screen.getByTestId('documents-files-create-menu');
  fireEvent.pointerDown(trigger, new MouseEvent('pointerdown', { bubbles: true }));
  fireEvent.click(trigger);
  await screen.findByTestId('documents-create-document');
}

describe('QA-26 (P3): Files menu "New document" and empty-state "New Word document" stay consistent', () => {
  it('both creation affordances are visible on a zero-file client, and BOTH call the same onCreateDefaultDocument entry point', async () => {
    const onCreateDefaultDocument = vi.fn();
    const onCreateFile = vi.fn();
    const onCreateDocxAtRoot = vi.fn();
    render(
      <DocumentsHome
        {...buildProps({ onCreateDefaultDocument, onCreateFile, onCreateDocxAtRoot })}
      />,
    );

    expect(screen.getByTestId('grid-empty-state')).toBeTruthy();

    const emptyStateButton = screen.getByRole('button', { name: 'New Word document' });
    await openFilesCreateMenu();
    const filesMenuButton = screen.getByTestId('documents-create-document');
    expect(filesMenuButton).toBeTruthy();
    expect(emptyStateButton).toBeTruthy();

    fireEvent.click(filesMenuButton);
    fireEvent.click(emptyStateButton);

    expect(onCreateDefaultDocument).toHaveBeenCalledTimes(2);
    // The bug's exact symptom would be the Files menu reaching a DIFFERENT,
    // dialog-free handler — neither fallback may ever fire while
    // onCreateDefaultDocument is provided.
    expect(onCreateFile).not.toHaveBeenCalled();
    expect(onCreateDocxAtRoot).not.toHaveBeenCalled();
  });

  it('with no onCreateDefaultDocument wired, both buttons fall back to the SAME onCreateDocxAtRoot (still consistent with each other)', async () => {
    const onCreateFile = vi.fn();
    const onCreateDocxAtRoot = vi.fn();
    render(<DocumentsHome {...buildProps({ onCreateFile, onCreateDocxAtRoot })} />);

    await openFilesCreateMenu();
    fireEvent.click(screen.getByTestId('documents-create-document'));
    fireEvent.click(screen.getByRole('button', { name: 'New Word document' }));

    expect(onCreateDocxAtRoot).toHaveBeenCalledTimes(2);
    expect(onCreateFile).not.toHaveBeenCalled();
  });
});
