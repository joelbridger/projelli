// Component tests for the new Word document editor (WS-A / A3).
//
// Strategy: mock `@tauri-apps/api/core` so `docx_open` returns a known DOM, the
// resolve commands return a transformed DOM, and `docx_save` is observable.
// Then assert: faithful rendering of runs / insertions / deletions / comments
// with the Word styling, and that the accept/reject flow swaps in the returned
// DOM and persists via docx_save.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StrictMode } from 'react';
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react';
import { BRAND } from '@/config/brand';

// --- Tauri mock: a programmable invoke that dispatches by command name. ----
const invokeMock = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (cmd: string, args?: unknown) => invokeMock(cmd, args),
  isTauri: () => true,
}));

// --- AI redline mocks: deterministic edit list + a no-op provider factory.
// We mock the provider/network boundary so the test is hermetic; the engine
// call (docx_author_revisions) still flows through the real invokeMock so we
// assert the editor translates edits -> engine call correctly and renders the
// resulting tracked changes.
const requestRedlineEditsMock = vi.fn();
const selectionState = vi.hoisted(() => ({
  decision: { kind: 'all-matters', client: null } as
    | { kind: 'all-matters'; client: null }
    | {
        kind: 'matter';
        sourceKind: 'matter-only';
        matter: {
          id: string;
          name: string;
          client: string;
          folderPaths: string[];
          createdAt: string;
        };
        client: null;
      }
    | { kind: 'refused'; reason: 'blocked-unresolved' | 'follower-disagreement'; message: string },
}));
vi.mock('@/platform/client-context', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/platform/client-context')>();
  return {
    ...actual,
    readSelectionOperationDecision: () => selectionState.decision,
  };
});
vi.mock('@/features/documents/docx/redline', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/documents/docx/redline')>();
  return {
    ...actual,
    requestRedlineEdits: (...args: unknown[]) => requestRedlineEditsMock(...args),
    requestRedlineEditsWithAudit: (...args: unknown[]) => requestRedlineEditsMock(...args),
  };
});
vi.mock('@/platform/providers/providerFactory', () => ({
  createProvider: vi.fn(() => ({ structuredOutput: vi.fn(), getMetadata: () => ({ model: 'gpt-4o' }) })),
  // WS-C honesty — DocxEditor now imports this to decide if the redline is
  // local (Ollama, keyless) vs cloud. These tests use the default cloud
  // provider, so it returns false; keep the real semantics (only 'ollama').
  isLocalProviderId: (provider: string) => provider === 'ollama',
}));

// --- A6 export mocks: the save dialog, the fs reader (for PDF), and the
// cross-platform saveFile helper. The DocxEditor export handlers dynamically
// import these; the mocks let us assert the right engine/conversion commands
// are called with a chosen destination, without a real OS dialog or filesystem.
const saveDialogMock = vi.fn();
vi.mock('@tauri-apps/plugin-dialog', () => ({
  save: (...args: unknown[]) => saveDialogMock(...args),
}));
const readFileMock = vi.fn();
vi.mock('@/platform/fs/tauriFsPlugin', () => ({
  readTauriFile: (...args: unknown[]) => readFileMock(...args),
}));
const saveFileMock = vi.fn();
vi.mock('@/platform/utils/saveFile', () => ({
  saveFile: (...args: unknown[]) => saveFileMock(...args),
}));

// The personal-install choice gate (Task 1.3) is added to DocxEditor.runRedline.
// Stub assertCloudGenerationAllowed as a no-op here — these tests focus on the
// AI redline flow (edit application + tracked changes), not the privacy gate.
vi.mock('@/platform/privacy/localOnlyGuard', async (orig) => {
  const real = await orig<typeof import('@/platform/privacy/localOnlyGuard')>();
  return {
    ...real,
    assertCloudGenerationAllowed: vi.fn(),
  };
});

import { TooltipProvider } from '@/ui/tooltip';
import { DocxEditor } from '@/features/documents/media/DocxEditor';
import { DocumentBody } from '@/features/documents/media/DocxDocumentView';
import type { DocumentJson, DocxAiEdit } from '@/platform/types/docx';
import { useEditorStore } from '@/platform/state/editorStore';
import { __resetDocxSaveSessions } from '@/platform/fs/docxSaveSession';
import {
  __resetDocxSaveRegistry,
  isDocxRegistered,
  isDocxUnsaved,
  flushDocx,
} from '@/platform/fs/docxSaveRegistry';

// Cleanup batch 4 (task #24): DocxEditor's solo save path now keeps a
// per-path DocxSession alive across unmounts while it's dirty/failing (the
// QA-34 keep-alive fix) instead of always tearing it down. Every test in this
// file reuses the SAME `/ws/agreement.docx` path (see `renderEditor()`), so a
// test that intentionally leaves a save failing (the QA-34 resilience suite)
// would otherwise leak that dirty/escalated session into the NEXT test's
// fresh `renderEditor()` — which then silently resumes the stale session
// instead of exercising its own `docx_open`/`docx_save` mocks. Reset before
// every test so each one gets a clean session for the path it opens.
// Resetting the registry too (belt-and-suspenders) guarantees no residual
// entry can linger even if a session's own unregister races with this reset.
beforeEach(() => {
  __resetDocxSaveSessions();
  __resetDocxSaveRegistry();
  useEditorStore.getState().clearTabState();
  selectionState.decision = { kind: 'all-matters', client: null };
});

function docWithRevisions(): DocumentJson {
  return {
    formatVersion: 1,
    body: [
      {
        kind: 'paragraph',
        propertiesXml: '<w:pPr><w:pStyle w:val="Heading1"/></w:pPr>',
        inlines: [{ kind: 'run', text: 'Agreement' }],
      },
      {
        kind: 'paragraph',
        inlines: [
          { kind: 'run', text: 'The party ', propertiesXml: '<w:rPr><w:b/></w:rPr>' },
          {
            kind: 'insertion',
            meta: { id: '100', author: 'Alice Counsel', date: '2026-01-02T10:00:00Z' },
            runs: [{ text: 'hereby ' }],
          },
          { kind: 'run', text: 'agrees ' },
          {
            kind: 'deletion',
            meta: { id: '101', author: 'Bob Partner', date: '2026-01-03T09:00:00Z' },
            runs: [{ text: 'reluctantly ' }],
          },
          { kind: 'run', text: 'to the terms.' },
          { kind: 'commentRangeStart', id: '7' },
          { kind: 'run', text: 'See exhibit A' },
          { kind: 'commentRangeEnd', id: '7' },
          { kind: 'commentReference', id: '7' },
        ],
      },
      { kind: 'raw', xml: '<w:tbl/>' },
    ],
    comments: {
      '7': {
        id: '7',
        author: 'Carol Reviewer',
        date: '2026-01-04T12:00:00Z',
        text: 'Is exhibit A attached?',
        initials: 'CR',
      },
    },
  };
}

function blankDocWithEmptyRun(): DocumentJson {
  return {
    formatVersion: 1,
    body: [
      {
        kind: 'paragraph',
        inlines: [{ kind: 'run', text: '' }],
      },
    ],
    comments: {},
  };
}

function docWithRawInline(): DocumentJson {
  return {
    formatVersion: 1,
    body: [
      {
        kind: 'paragraph',
        inlines: [
          { kind: 'run', text: 'Editable before ' },
          { kind: 'raw', xml: '<w:r><w:t>Preserved inline</w:t></w:r>' },
          { kind: 'run', text: ' editable after' },
        ],
      },
    ],
    comments: {},
  };
}

// The DOM the editor renders comes from the mocked `docx_open`, so renderEditor
// just mounts the component; callers set up invokeMock to return their DOM.
function renderEditor(filePath = '/ws/agreement.docx') {
  return render(
    <TooltipProvider>
      <DocxEditor filePath={filePath} fileName={filePath.split('/').pop() ?? filePath} />
    </TooltipProvider>,
  );
}

async function openDocxActionsMenu() {
  const trigger = await screen.findByTestId('docx-document-actions-menu');
  fireEvent.pointerDown(
    trigger,
    new MouseEvent('pointerdown', { bubbles: true }),
  );
  fireEvent.click(trigger);
  await screen.findByTestId('docx-export-word');
}

describe('DocxEditor — rendering', () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  // Task 5 — blank doc must open as an editable surface, not as a preserved-content
  // placeholder.  A blank document body contains exactly one empty paragraph with no
  // raw blocks, so the editor must not render any `docx-raw-block` element.
  it('blank doc (one empty paragraph, no raw blocks) renders no preserved-content placeholder', async () => {
    // No `comments` field: proves the defensive fix in commentList()
    // (doc.comments ?? {}) so it no longer crashes when undefined.
    const blankDoc = {
      formatVersion: 1,
      body: [
        {
          kind: 'paragraph',
          inlines: [],
        },
      ],
    } as unknown as DocumentJson;

    invokeMock.mockImplementation((cmd: string) =>
      cmd === 'docx_open' ? Promise.resolve(blankDoc) : Promise.resolve(undefined),
    );

    renderEditor();

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith('docx_open', {
        path: '/ws/agreement.docx',
      }),
    );

    // The editor must be present and in edit mode (not message/error mode).
    const editorRoot = await screen.findByTestId('docx-editor');
    expect(editorRoot).toBeInTheDocument();
    expect(editorRoot).not.toHaveAttribute('data-mode', 'message');

    // No raw/preserved blocks: the "[preserved content]" placeholder must be absent.
    expect(screen.queryByTestId('docx-raw-block')).not.toBeInTheDocument();
  });

  it('blank docx renders an editable, visible first run target', () => {
    render(
      <DocumentBody
        doc={blankDocWithEmptyRun()}
        reviewing={false}
        editable
        activeCommentId={null}
        onRunEdit={vi.fn()}
        onActiveRunChange={vi.fn()}
        onActiveRunInput={vi.fn()}
        onCommentAnchorClick={vi.fn()}
      />,
    );

    const run = screen.getByTestId('docx-run');
    expect(run).toHaveAttribute('contenteditable', 'true');
    expect(run).toHaveStyle({ minWidth: '1ch' });
    run.focus();
    expect(document.activeElement).toBe(run);
  });

  it('clicking the blank page focuses the first editable run', async () => {
    invokeMock.mockImplementation((cmd: string) =>
      cmd === 'docx_open' ? Promise.resolve(blankDocWithEmptyRun()) : Promise.resolve(undefined),
    );

    renderEditor();

    const run = await screen.findByTestId('docx-run');
    fireEvent.click(screen.getByTestId('docx-page'));

    await waitFor(() => {
      expect(document.activeElement).toBe(run);
    });
  });

  it('puts document actions in one clean header menu instead of separate header buttons', async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'docx_open') return Promise.resolve(blankDocWithEmptyRun());
      if (cmd === 'docx_save') return Promise.resolve(undefined);
      if (cmd === 'crm_is_connected') return Promise.resolve(true);
      return Promise.resolve(undefined);
    });

    const onDraftFollowUp = vi.fn();
    const onSendToWealthbox = vi.fn().mockReturnValue(true);
    const onDownload = vi.fn();
    const onToggleHistory = vi.fn();
    const onSplitHorizontal = vi.fn();
    const onToggleOutline = vi.fn();

    render(
      <TooltipProvider>
        <DocxEditor
          filePath="/ws/agreement.docx"
          fileName="agreement.docx"
          onDraftFollowUp={onDraftFollowUp}
          onSendToWealthbox={onSendToWealthbox}
          onDownload={onDownload}
          onToggleHistory={onToggleHistory}
          onSplitHorizontal={onSplitHorizontal}
          onToggleOutline={onToggleOutline}
          versionHistoryLabel="History (2)"
        />
      </TooltipProvider>,
    );

    const header = await screen.findByTestId('docx-editor-topbar');
    expect(header.textContent).toContain('agreement.docx');
    expect(screen.queryByTestId('docx-draft-follow-up')).not.toBeInTheDocument();
    expect(screen.queryByTestId('docx-send-to-wealthbox')).not.toBeInTheDocument();
    expect(screen.queryByTestId('docx-revise-with-ai')).not.toBeInTheDocument();

    const trigger = screen.getByTestId('docx-document-actions-menu');
    fireEvent.pointerDown(trigger, new MouseEvent('pointerdown', { bubbles: true }));
    fireEvent.click(trigger);

    fireEvent.click(await screen.findByTestId('toolbar-download'));
    expect(onDownload).toHaveBeenCalledTimes(1);

    fireEvent.pointerDown(trigger, new MouseEvent('pointerdown', { bubbles: true }));
    fireEvent.click(trigger);
    fireEvent.click(await screen.findByTestId('toolbar-history'));
    expect(onToggleHistory).toHaveBeenCalledTimes(1);

    fireEvent.pointerDown(trigger, new MouseEvent('pointerdown', { bubbles: true }));
    fireEvent.click(trigger);
    fireEvent.click(await screen.findByTestId('toolbar-overflow-split-h'));
    expect(onSplitHorizontal).toHaveBeenCalledTimes(1);

    fireEvent.pointerDown(trigger, new MouseEvent('pointerdown', { bubbles: true }));
    fireEvent.click(trigger);
    fireEvent.click(await screen.findByTestId('toolbar-overflow-outline'));
    expect(onToggleOutline).toHaveBeenCalledTimes(1);

    fireEvent.pointerDown(trigger, new MouseEvent('pointerdown', { bubbles: true }));
    fireEvent.click(trigger);
    fireEvent.click(await screen.findByTestId('docx-draft-follow-up'));
    await waitFor(() => expect(onDraftFollowUp).toHaveBeenCalledTimes(1));
  });

  it('keeps the .docx extension when renaming a dotted file name', async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'docx_open') return Promise.resolve(blankDocWithEmptyRun());
      if (cmd === 'docx_save') return Promise.resolve(undefined);
      return Promise.resolve(undefined);
    });
    const onRenameFile = vi.fn();

    render(
      <TooltipProvider>
        <DocxEditor
          filePath="/ws/client.v2.docx"
          fileName="client.v2.docx"
          onRenameFile={onRenameFile}
        />
      </TooltipProvider>,
    );

    await screen.findByTestId('docx-editor-topbar');
    const openRenameInput = async () => {
      const trigger = screen.getByTestId('docx-document-actions-menu');
      fireEvent.pointerDown(trigger, new MouseEvent('pointerdown', { bubbles: true }));
      fireEvent.click(trigger);
      fireEvent.click(await screen.findByTestId('docx-rename-file'));
      return screen.findByDisplayValue('client.v2');
    };

    const input = await openRenameInput();
    fireEvent.blur(input);
    await waitFor(() => expect(onRenameFile).not.toHaveBeenCalled());

    const nextInput = await openRenameInput();
    fireEvent.change(nextInput, { target: { value: 'client.v3' } });
    await screen.findByDisplayValue('client.v3');
    fireEvent.keyDown(nextInput, { key: 'Enter' });
    await waitFor(() => expect(onRenameFile).toHaveBeenCalledWith('client.v3.docx'));
  });

  it('clicking a preserved raw block does not move the caret into the nearest run', async () => {
    invokeMock.mockImplementation((cmd: string) =>
      cmd === 'docx_open' ? Promise.resolve(docWithRevisions()) : Promise.resolve(undefined),
    );

    renderEditor();

    const run = (await screen.findAllByTestId('docx-run'))[0];
    const rawBlock = screen.getByTestId('docx-raw-block');
    fireEvent.click(rawBlock);

    expect(document.activeElement).not.toBe(run);
  });

  it('clicking a preserved raw inline does not move the caret into the nearest run', async () => {
    invokeMock.mockImplementation((cmd: string) =>
      cmd === 'docx_open' ? Promise.resolve(docWithRawInline()) : Promise.resolve(undefined),
    );

    renderEditor();

    const run = (await screen.findAllByTestId('docx-run'))[0];
    const rawInline = screen.getByTestId('docx-raw-inline');
    fireEvent.click(rawInline);

    expect(document.activeElement).not.toBe(run);
  });

  it('clicking preserved image and table elements does not move the caret into the nearest run', async () => {
    invokeMock.mockImplementation((cmd: string) =>
      cmd === 'docx_open' ? Promise.resolve(blankDocWithEmptyRun()) : Promise.resolve(undefined),
    );

    renderEditor();

    const run = await screen.findByTestId('docx-run');
    const page = screen.getByTestId('docx-page');
    const table = document.createElement('table');
    const img = document.createElement('img');
    page.append(table, img);

    fireEvent.click(table);
    expect(document.activeElement).not.toBe(run);

    fireEvent.click(img);
    expect(document.activeElement).not.toBe(run);
  });

  it('a freshly created document focuses its first run once', async () => {
    useEditorStore.getState().setPendingDocxFocusPath('/ws/new.docx');
    invokeMock.mockImplementation((cmd: string) =>
      cmd === 'docx_open' ? Promise.resolve(blankDocWithEmptyRun()) : Promise.resolve(undefined),
    );

    renderEditor('/ws/new.docx');

    const run = await screen.findByTestId('docx-run');
    await waitFor(() => {
      expect(document.activeElement).toBe(run);
    });
    expect(useEditorStore.getState().pendingDocxFocusPath).toBeNull();
  });

  it('opens via docx_open and renders runs, insertions, deletions, comments', async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'docx_open') return Promise.resolve(docWithRevisions());
      return Promise.resolve(undefined);
    });

    renderEditor();

    // Loads via the engine with the file path.
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith('docx_open', {
        path: '/ws/agreement.docx',
      }),
    );

    // Plain run text rendered.
    expect(await screen.findByText(/The party/)).toBeInTheDocument();
    expect(screen.getByText(/to the terms\./)).toBeInTheDocument();

    // Insertion: green + underline styling, author attribution available.
    const ins = screen.getByTestId('docx-insertion');
    expect(ins).toHaveTextContent('hereby');
    expect(ins).toHaveAttribute('data-author', 'Alice Counsel');
    expect(ins.style.textDecorationLine).toBe('underline');

    // Deletion: red + strikethrough.
    const del = screen.getByTestId('docx-deletion');
    expect(del).toHaveTextContent('reluctantly');
    expect(del).toHaveAttribute('data-author', 'Bob Partner');
    expect(del.style.textDecorationLine).toBe('line-through');

    // Heading paragraph mapped from pStyle Heading1.
    const heading = screen.getByText('Agreement').closest('[data-heading]');
    expect(heading).toHaveAttribute('data-heading', '1');

    // Comment marker + comment card with author/text.
    expect(screen.getByTestId('docx-comment-marker')).toHaveTextContent('7');
    const commentCard = screen.getByTestId('docx-comment-card');
    expect(commentCard).toHaveTextContent('Carol Reviewer');
    expect(commentCard).toHaveTextContent('Is exhibit A attached?');

    // Raw block rendered as a read-only preserved placeholder.
    expect(screen.getByTestId('docx-raw-block')).toBeInTheDocument();
  });

  it('lists revisions grouped in the review pane with author + snippet', async () => {
    invokeMock.mockImplementation((cmd: string) =>
      cmd === 'docx_open'
        ? Promise.resolve(docWithRevisions())
        : Promise.resolve(undefined),
    );
    renderEditor();

    const list = await screen.findByTestId('docx-revision-list');
    const rows = within(list).getAllByTestId('docx-revision-row');
    expect(rows).toHaveLength(2);

    const insRow = rows.find(
      (r) => r.getAttribute('data-revision-id') === '100',
    )!;
    expect(insRow).toHaveAttribute('data-revision-kind', 'insertion');
    expect(insRow).toHaveTextContent('Alice Counsel');
    expect(insRow).toHaveTextContent('hereby');
  });

  it('renders the read-only fallback in browser mode (no engine)', async () => {
    // Re-import with isTauri false by remocking the module.
    vi.resetModules();
    vi.doMock('@tauri-apps/api/core', () => ({
      invoke: vi.fn(),
      isTauri: () => false,
    }));
    const { DocxEditor: BrowserEditor } = await import(
      '@/features/documents/media/DocxEditor'
    );
    render(
      <TooltipProvider>
        <BrowserEditor fileName="x.docx" />
      </TooltipProvider>,
    );
    // No filePath + no engine => message mode (no src to preview).
    const root = await screen.findByTestId('docx-editor');
    expect(root).toHaveAttribute('data-mode', 'message');
    vi.doUnmock('@tauri-apps/api/core');
  });
});

describe('DocxEditor — accept / reject flow', () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it('accepting one revision calls docx_resolve_revision and swaps in the returned DOM, then saves', async () => {
    // After accepting revision 100, the engine returns a DOM where the
    // insertion became a normal run ("hereby ") and the revision is gone.
    const resolved: DocumentJson = {
      formatVersion: 1,
      body: [
        {
          kind: 'paragraph',
          inlines: [
            { kind: 'run', text: 'The party ' },
            { kind: 'run', text: 'hereby ' },
            { kind: 'run', text: 'agrees ' },
            {
              kind: 'deletion',
              meta: { id: '101', author: 'Bob Partner', date: '2026-01-03T09:00:00Z' },
              runs: [{ text: 'reluctantly ' }],
            },
            { kind: 'run', text: 'to the terms.' },
          ],
        },
      ],
      comments: {},
    };

    invokeMock.mockImplementation((cmd: string, args?: Record<string, unknown>) => {
      if (cmd === 'docx_open') return Promise.resolve(docWithRevisions());
      if (cmd === 'docx_resolve_revision') {
        expect(args?.['revisionId']).toBe('100');
        expect(args?.['action']).toBe('accept');
        return Promise.resolve(resolved);
      }
      if (cmd === 'docx_save') return Promise.resolve(undefined);
      return Promise.resolve(undefined);
    });

    renderEditor();

    // Two revisions to start.
    const list = await screen.findByTestId('docx-revision-list');
    expect(within(list).getAllByTestId('docx-revision-row')).toHaveLength(2);

    // Click Accept on the insertion row (id 100).
    const insRow = within(list)
      .getAllByTestId('docx-revision-row')
      .find((r) => r.getAttribute('data-revision-id') === '100')!;
    fireEvent.click(within(insRow).getByTestId('docx-accept-one'));

    // Engine called.
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith(
        'docx_resolve_revision',
        expect.objectContaining({ revisionId: '100', action: 'accept' }),
      ),
    );

    // Returned DOM replaced state: only the deletion (101) remains in the list.
    await waitFor(() => {
      const rows = within(
        screen.getByTestId('docx-revision-list'),
      ).getAllByTestId('docx-revision-row');
      expect(rows).toHaveLength(1);
      expect(rows[0]).toHaveAttribute('data-revision-id', '101');
    });

    // The accepted text now reads as a normal run (no longer an insertion node).
    expect(screen.queryByTestId('docx-insertion')).toBeNull();
    expect(screen.getByText(/hereby/)).toBeInTheDocument();

    // Debounced save eventually fires with the resolved DOM.
    await waitFor(
      () =>
        expect(invokeMock).toHaveBeenCalledWith('docx_save', {
          path: '/ws/agreement.docx',
          document: resolved,
        }),
      { timeout: 3000 },
    );
  });

  it('flushes the pending save when unmounted before the debounce — no lost edit (B1)', async () => {
    const resolved: DocumentJson = {
      formatVersion: 1,
      body: [
        {
          kind: 'paragraph',
          inlines: [
            { kind: 'run', text: 'The party ' },
            { kind: 'run', text: 'hereby ' },
            { kind: 'run', text: 'agrees ' },
            {
              kind: 'deletion',
              meta: { id: '101', author: 'Bob Partner', date: '2026-01-03T09:00:00Z' },
              runs: [{ text: 'reluctantly ' }],
            },
            { kind: 'run', text: 'to the terms.' },
          ],
        },
      ],
      comments: {},
    };
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'docx_open') return Promise.resolve(docWithRevisions());
      if (cmd === 'docx_resolve_revision') return Promise.resolve(resolved);
      if (cmd === 'docx_save') return Promise.resolve(undefined);
      return Promise.resolve(undefined);
    });

    const { unmount } = renderEditor();
    const list = await screen.findByTestId('docx-revision-list');
    const insRow = within(list)
      .getAllByTestId('docx-revision-row')
      .find((r) => r.getAttribute('data-revision-id') === '100')!;
    fireEvent.click(within(insRow).getByTestId('docx-accept-one'));

    // Wait until the edit is applied (so a save is scheduled/debounced) but do
    // NOT wait for the 1200ms debounce to fire.
    await waitFor(() => {
      const rows = within(screen.getByTestId('docx-revision-list')).getAllByTestId('docx-revision-row');
      expect(rows).toHaveLength(1);
    });
    expect(invokeMock).not.toHaveBeenCalledWith('docx_save', expect.anything());

    // Unmount before the debounce — the flush must still persist the latest doc.
    unmount();
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith(
        'docx_save',
        expect.objectContaining({ path: '/ws/agreement.docx', document: resolved }),
      ),
    );
  });

  // CLUSTER-C1 (data loss): a keystroke that's still sitting in the
  // contentEditable DOM — focused, never blurred — must not be silently
  // dropped just because the tab closed before the user clicked away.
  it('CLUSTER-C1: commits an in-progress (focused, un-blurred) edit on unmount', async () => {
    const oneRunDoc: DocumentJson = {
      formatVersion: 1,
      body: [{ kind: 'paragraph', inlines: [{ kind: 'run', text: 'original text' }] }],
      comments: {},
    };
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'docx_open') return Promise.resolve(oneRunDoc);
      if (cmd === 'docx_save') return Promise.resolve(undefined);
      return Promise.resolve(undefined);
    });

    const { unmount } = renderEditor();
    const run = await screen.findByTestId('docx-run');

    // Reviewing OFF: a direct, synchronous plain-text replacement — isolates
    // this test to the focus/blur commit mechanism itself, not the async
    // tracked-changes diff path (covered separately).
    fireEvent.click(screen.getByTestId('docx-reviewing-toggle'));

    // The user types (focus fires, DOM text changes) but never clicks away —
    // no blur event, ever.
    fireEvent.focus(run);
    run.textContent = 'original text EDITED';

    // No save should be scheduled yet — nothing committed the edit.
    expect(invokeMock).not.toHaveBeenCalledWith('docx_save', expect.anything());

    // Close the tab. The unmount cleanup must read the live DOM text of the
    // still-focused run and fold it in, exactly as a blur would, then flush it.
    unmount();

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith(
        'docx_save',
        expect.objectContaining({
          document: expect.objectContaining({
            body: [
              expect.objectContaining({
                inlines: [expect.objectContaining({ kind: 'run', text: 'original text EDITED' })],
              }),
            ],
          }),
        }),
      ),
    );
  });

  // CLUSTER-C1: the same in-progress edit must also survive hitting Export
  // without clicking away first (the brief explicitly calls out export as a
  // second trigger point, alongside tab-close).
  it('CLUSTER-C1: commits an in-progress (focused, un-blurred) edit before export', async () => {
    const oneRunDoc: DocumentJson = {
      formatVersion: 1,
      body: [{ kind: 'paragraph', inlines: [{ kind: 'run', text: 'original text' }] }],
      comments: {},
    };
    saveDialogMock.mockReset();
    saveDialogMock.mockResolvedValue('/out/x.docx');

    invokeMock.mockImplementation((cmd: string, args?: Record<string, unknown>) => {
      if (cmd === 'docx_open') return Promise.resolve(oneRunDoc);
      if (cmd === 'docx_save') return Promise.resolve(undefined);
      if (cmd === 'docx_export_copy') {
        expect(args?.['srcPath']).toBe('/ws/agreement.docx');
        return Promise.resolve(undefined);
      }
      return Promise.resolve(undefined);
    });

    renderEditor();
    const run = await screen.findByTestId('docx-run');
    fireEvent.click(screen.getByTestId('docx-reviewing-toggle'));

    fireEvent.focus(run);
    run.textContent = 'original text EDITED';
    // No blur — go straight to Export.

    await openDocxActionsMenu();
    fireEvent.click(await screen.findByTestId('docx-export-word'));

    // The save that precedes export must carry the in-progress edit, not the
    // stale pre-edit text.
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith(
        'docx_save',
        expect.objectContaining({
          document: expect.objectContaining({
            body: [
              expect.objectContaining({
                inlines: [expect.objectContaining({ text: 'original text EDITED' })],
              }),
            ],
          }),
        }),
      ),
    );
  });

  // Coordinator review finding: Draft-follow-up must not build the email from
  // a stale snapshot missing an in-progress (focused, un-blurred) edit — the
  // same flush pattern Export already uses.
  it('coordinator review: commits an in-progress edit before Draft follow-up reads the document', async () => {
    const oneRunDoc: DocumentJson = {
      formatVersion: 1,
      body: [{ kind: 'paragraph', inlines: [{ kind: 'run', text: 'original text' }] }],
      comments: {},
    };

    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'docx_open') return Promise.resolve(oneRunDoc);
      if (cmd === 'docx_save') return Promise.resolve(undefined);
      return Promise.resolve(undefined);
    });

    const onDraftFollowUp = vi.fn();
    render(
      <TooltipProvider>
        <DocxEditor
          filePath="/ws/agreement.docx"
          fileName="agreement.docx"
          onDraftFollowUp={onDraftFollowUp}
        />
      </TooltipProvider>,
    );
    const run = await screen.findByTestId('docx-run');
    fireEvent.click(screen.getByTestId('docx-reviewing-toggle'));

    fireEvent.focus(run);
    run.textContent = 'original text EDITED';
    // No blur — go straight to Draft follow-up.
    await openDocxActionsMenu();
    fireEvent.click(await screen.findByTestId('docx-draft-follow-up'));

    await waitFor(() => expect(onDraftFollowUp).toHaveBeenCalled());
    expect(onDraftFollowUp.mock.calls[0]![0] as string).toContain('original text EDITED');
  });

  // Smoke P0 #5: normal Word notes had no discoverable "Send to Wealthbox"
  // action at all — the only enqueue button lived in the shared-matter-only
  // MatterNotesEditor. This adds the fold into the toolbar every other docx
  // note already uses (beside Draft follow-up / Export).
  describe('Send to Wealthbox (smoke P0 #5)', () => {
    const oneRunDoc: DocumentJson = {
      formatVersion: 1,
      body: [{ kind: 'paragraph', inlines: [{ kind: 'run', text: 'Client wants a Roth conversion review.' }] }],
      comments: {},
    };

    beforeEach(() => {
      invokeMock.mockImplementation((cmd: string) => {
        if (cmd === 'docx_open') return Promise.resolve(oneRunDoc);
        if (cmd === 'docx_save') return Promise.resolve(undefined);
        if (cmd === 'crm_is_connected') return Promise.resolve(true);
        return Promise.resolve(undefined);
      });
    });

    it('is hidden when there is no current matter (no onSendToWealthbox handler passed)', async () => {
      render(
        <TooltipProvider>
          <DocxEditor filePath="/ws/agreement.docx" fileName="agreement.docx" />
        </TooltipProvider>,
      );
      await screen.findByTestId('docx-run');
      expect(screen.queryByTestId('docx-send-to-wealthbox')).not.toBeInTheDocument();
    });

    it('queues the note for CRM review when Wealthbox is connected, and shows a confirmation', async () => {
      const onSendToWealthbox = vi.fn().mockReturnValue(true);
      render(
        <TooltipProvider>
          <DocxEditor
            filePath="/ws/agreement.docx"
            fileName="agreement.docx"
            onSendToWealthbox={onSendToWealthbox}
          />
        </TooltipProvider>,
      );
      await screen.findByTestId('docx-run');
      await openDocxActionsMenu();
      const button = await screen.findByTestId('docx-send-to-wealthbox');
      await waitFor(() => expect(button).not.toHaveAttribute('data-disabled'));
      fireEvent.click(button);
      await waitFor(() => expect(onSendToWealthbox).toHaveBeenCalled());
      expect(onSendToWealthbox.mock.calls[0]![0] as string).toContain('Client wants a Roth conversion review.');
      await screen.findByTestId('docx-send-to-wealthbox-confirmation');
    });

    // E3 (Tier B trust guard): an unresolved meeting note is structurally
    // unsendable — both outbound actions are disabled and the honest reason is
    // shown; a click never queues or drafts anything.
    it('disables both outbound actions with an explanation when outboundBlockedReason is set', async () => {
      const onSendToWealthbox = vi.fn().mockReturnValue(true);
      const onDraftFollowUp = vi.fn();
      render(
        <TooltipProvider>
          <DocxEditor
            filePath="/ws/agreement.docx"
            fileName="agreement.docx"
            onSendToWealthbox={onSendToWealthbox}
            onDraftFollowUp={onDraftFollowUp}
            outboundBlockedReason="Review this note first — it hasn't been checked."
          />
        </TooltipProvider>,
      );
      await screen.findByTestId('docx-run');
      await openDocxActionsMenu();
      const send = await screen.findByTestId('docx-send-to-wealthbox');
      const draft = await screen.findByTestId('docx-draft-follow-up');
      expect(send).toHaveAttribute('data-disabled');
      expect(draft).toHaveAttribute('data-disabled');
      // The honest explanation is visible, not just a tooltip.
      expect(screen.getByTestId('docx-outbound-blocked').textContent).toContain('Review this note first');
      // Forcing a click does nothing — the note cannot leave.
      fireEvent.click(send);
      fireEvent.click(draft);
      await new Promise((r) => setTimeout(r, 10));
      expect(onSendToWealthbox).not.toHaveBeenCalled();
      expect(onDraftFollowUp).not.toHaveBeenCalled();
    });

    // resolved (no reason) → the outbound actions work as normal.
    it('leaves the outbound actions enabled when no block reason is set', async () => {
      const onSendToWealthbox = vi.fn().mockReturnValue(true);
      render(
        <TooltipProvider>
          <DocxEditor
            filePath="/ws/agreement.docx"
            fileName="agreement.docx"
            onSendToWealthbox={onSendToWealthbox}
          />
        </TooltipProvider>,
      );
      await screen.findByTestId('docx-run');
      await openDocxActionsMenu();
      const button = await screen.findByTestId('docx-send-to-wealthbox');
      await waitFor(() => expect(button).not.toHaveAttribute('data-disabled'));
      expect(screen.queryByTestId('docx-outbound-blocked')).not.toBeInTheDocument();
    });

    // codex-review: a blank/table-only document has no extractable title, so
    // the enqueue callback reports back "nothing queued" — the toolbar must
    // not claim success for a no-op enqueue.
    it('does not show a confirmation when the callback reports nothing was queued', async () => {
      const onSendToWealthbox = vi.fn().mockReturnValue(false);
      render(
        <TooltipProvider>
          <DocxEditor
            filePath="/ws/agreement.docx"
            fileName="agreement.docx"
            onSendToWealthbox={onSendToWealthbox}
          />
        </TooltipProvider>,
      );
      await screen.findByTestId('docx-run');
      await openDocxActionsMenu();
      const button = await screen.findByTestId('docx-send-to-wealthbox');
      await waitFor(() => expect(button).not.toHaveAttribute('data-disabled'));
      fireEvent.click(button);
      await waitFor(() => expect(onSendToWealthbox).toHaveBeenCalled());
      expect(screen.queryByTestId('docx-send-to-wealthbox-confirmation')).not.toBeInTheDocument();
    });

    // QA finding (P3): the confirmation needs a real, actionable "Review now"
    // jump alongside the plain copy, not just a toast that auto-clears.
    it('shows a "Review now" action next to the confirmation that calls onReviewWealthboxQueue', async () => {
      const onSendToWealthbox = vi.fn().mockReturnValue(true);
      const onReviewWealthboxQueue = vi.fn();
      render(
        <TooltipProvider>
          <DocxEditor
            filePath="/ws/agreement.docx"
            fileName="agreement.docx"
            onSendToWealthbox={onSendToWealthbox}
            onReviewWealthboxQueue={onReviewWealthboxQueue}
          />
        </TooltipProvider>,
      );
      await screen.findByTestId('docx-run');
      await openDocxActionsMenu();
      const button = await screen.findByTestId('docx-send-to-wealthbox');
      await waitFor(() => expect(button).not.toHaveAttribute('data-disabled'));
      fireEvent.click(button);
      await screen.findByTestId('docx-send-to-wealthbox-confirmation');

      fireEvent.click(screen.getByTestId('docx-send-to-wealthbox-review-now'));
      expect(onReviewWealthboxQueue).toHaveBeenCalledTimes(1);
    });

    it('disables the action with an explanation when Wealthbox is not connected', async () => {
      invokeMock.mockImplementation((cmd: string) => {
        if (cmd === 'docx_open') return Promise.resolve(oneRunDoc);
        if (cmd === 'crm_is_connected') return Promise.resolve(false);
        return Promise.resolve(undefined);
      });
      const onSendToWealthbox = vi.fn();
      render(
        <TooltipProvider>
          <DocxEditor
            filePath="/ws/agreement.docx"
            fileName="agreement.docx"
            onSendToWealthbox={onSendToWealthbox}
          />
        </TooltipProvider>,
      );
      await screen.findByTestId('docx-run');
      await openDocxActionsMenu();
      const button = await screen.findByTestId('docx-send-to-wealthbox');
      await waitFor(() => expect(button).toHaveAttribute('data-disabled'));
      expect(button.title.toLowerCase()).toContain('connect');
      fireEvent.click(button);
      expect(onSendToWealthbox).not.toHaveBeenCalled();
    });
  });

  // CLUSTER-C1 (data loss, coordinator review): a run that blurs JUST before
  // the tab closes has already cleared activeRunRef (nothing left for
  // commitActiveRunEdit to commit), but its blur already enqueued an ASYNC
  // tracked-changes op (Reviewing ON -> docx_author_revisions) that hasn't
  // resolved yet. The unmount flush must wait for that already-queued op to
  // finish and land, not just check for an active run.
  it('CLUSTER-C1: a run that blurs immediately before unmount still gets saved (queued-edit race)', async () => {
    const oneRunDoc: DocumentJson = {
      formatVersion: 1,
      body: [{ kind: 'paragraph', inlines: [{ kind: 'run', text: 'governed by Delaware law' }] }],
      comments: {},
    };
    const authored: DocumentJson = {
      formatVersion: 1,
      body: [
        {
          kind: 'paragraph',
          inlines: [
            { kind: 'run', text: 'governed by ' },
            {
              kind: 'insertion',
              meta: { id: '1', author: 'You', date: '2026-06-09T00:00:00Z' },
              runs: [{ text: 'Nevada' }],
            },
            {
              kind: 'deletion',
              meta: { id: '1', author: 'You', date: '2026-06-09T00:00:00Z' },
              runs: [{ text: 'Delaware' }],
            },
            { kind: 'run', text: ' law' },
          ],
        },
      ],
      comments: {},
    };

    // The engine call stays pending until we resolve it manually, so the
    // test can unmount WHILE the blur-triggered edit is still in flight.
    let resolveAuthor: ((doc: unknown) => void) | undefined;
    const authorPromise = new Promise((resolve) => {
      resolveAuthor = resolve;
    });

    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'docx_open') return Promise.resolve(oneRunDoc);
      if (cmd === 'docx_author_revisions') return authorPromise;
      if (cmd === 'docx_save') return Promise.resolve(undefined);
      return Promise.resolve(undefined);
    });

    const { unmount } = render(
      <TooltipProvider>
        <DocxEditor filePath="/ws/x.docx" fileName="x.docx" authorName="You" />
      </TooltipProvider>,
    );
    const run = await screen.findByTestId('docx-run');

    // Reviewing is ON by default: blurring with changed text enqueues the
    // ASYNC docx_author_revisions op (not a synchronous plain-text write).
    run.textContent = 'governed by Nevada law';
    fireEvent.blur(run);

    // The engine call was dispatched (queued op started running)...
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith(
      'docx_author_revisions',
      expect.anything(),
    ));

    // ...but close the tab BEFORE it resolves — activeRunRef is already null
    // (blur cleared it), so this is exactly the race commitActiveRunEdit()
    // alone can't catch; only draining docOpQueueRef.current can.
    unmount();

    // Now let the engine call land.
    resolveAuthor?.({
      document: authored,
      results: [{ index: 0, applied: true, revisionId: '1', error: null }],
    });

    // The save that the queued op eventually schedules must still fire and
    // carry the authored (tracked-change) document — not be silently dropped
    // just because nothing was "actively focused" at unmount time.
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith(
        'docx_save',
        expect.objectContaining({ path: '/ws/x.docx', document: authored }),
      ),
    );
  });

  // Cleanup batch 4 — Codex review catch (post-merge, P2): if a solo view
  // unmounts while it STILL has a queued op pending (e.g. a blur that
  // triggered an in-flight engine call), the DELAYED teardown that only runs
  // once that op finishes must not blindly strip/dispose a session a NEWER
  // view has ALREADY reused in the meantime — i.e. the SAME path reopened
  // (tab switched back to) before the old view's teardown got a chance to
  // run. Without an identity guard, the old view's belated cleanup can strip
  // the NEW view's live-flush hook (so a later close/quit on the new view
  // never folds in its own focused, un-blurred edit — silent data loss for
  // the very last keystrokes) and/or wrongly dispose the session out from
  // under the new view entirely.
  it('a delayed teardown from a view that unmounted mid-op does not strip or dispose a session a NEWER view has since reused', async () => {
    const baseDoc: DocumentJson = {
      formatVersion: 1,
      body: [{ kind: 'paragraph', inlines: [{ kind: 'run', text: 'original text' }] }],
      comments: {},
    };

    // View A's blur-triggered engine call stays pending until the test
    // resolves it manually — long enough for View B to reopen the SAME path
    // in the meantime. It ultimately REJECTS (a benign engine hiccup) so it
    // never mutates the document — isolating this test to the identity-
    // guarding bug rather than any content-merge behavior.
    let rejectAuthor: ((err: Error) => void) | undefined;
    const authorPromise = new Promise((_resolve, reject) => {
      rejectAuthor = reject;
    });
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'docx_open') return Promise.resolve(baseDoc);
      if (cmd === 'docx_author_revisions') return authorPromise;
      if (cmd === 'docx_save') return Promise.resolve(undefined);
      return Promise.resolve(undefined);
    });

    const { unmount: unmountA } = render(
      <TooltipProvider>
        <DocxEditor filePath="/ws/reuse.docx" fileName="reuse.docx" authorName="You" />
      </TooltipProvider>,
    );
    const runA = await screen.findByTestId('docx-run');
    // Reviewing is ON by default: blurring with changed text enqueues the
    // ASYNC docx_author_revisions op (not a synchronous plain-text write).
    runA.textContent = 'original TEXT CHANGED';
    fireEvent.blur(runA);
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith('docx_author_revisions', expect.anything()),
    );

    // Switch tabs away WHILE that op is still pending.
    unmountA();

    // The registry must still see this path as an open (reuse-eligible)
    // .docx the whole time — View A's teardown can't have run yet (it's
    // still awaiting the pending op).
    expect(isDocxRegistered('/ws/reuse.docx')).toBe(true);

    // Switch back to the SAME path — a genuinely fresh DocxEditor instance
    // that resumes the SAME (not-yet-disposed) session.
    const openCallsBefore = invokeMock.mock.calls.filter((c) => c[0] === 'docx_open').length;
    render(
      <TooltipProvider>
        <DocxEditor filePath="/ws/reuse.docx" fileName="reuse.docx" authorName="You" />
      </TooltipProvider>,
    );
    await screen.findByTestId('docx-editor');
    const openCallsAfter = invokeMock.mock.calls.filter((c) => c[0] === 'docx_open').length;
    expect(openCallsAfter).toBe(openCallsBefore); // reused — no fresh disk read

    // View B has its own focused, un-blurred edit in progress.
    const runB = await screen.findByTestId('docx-run');
    fireEvent.click(screen.getByTestId('docx-reviewing-toggle')); // plain replacement — simpler to assert
    fireEvent.focus(runB);
    runB.textContent = 'original text edited by VIEW B';

    const saveCallsBeforeAResolves = invokeMock.mock.calls.filter((c) => c[0] === 'docx_save').length;

    // NOW let View A's stale, long-pending op land — it fails harmlessly (the
    // document is never touched by it), but View A's delayed teardown still
    // runs its "detach the live-flush hook, maybe dispose" sequence against
    // the REUSED session object.
    rejectAuthor?.(new Error('transient engine hiccup'));
    // Give the whole promise chain (catch handler -> queue settles -> the
    // cleanup's own .then()) time to fully run before asserting anything —
    // a `waitFor` checking a condition that's ALREADY true would return
    // immediately without proving a later async disposal didn't happen.
    await new Promise((resolve) => setTimeout(resolve, 50));

    // The session must still be registered — View A's belated teardown must
    // not have disposed a session View B is actively attached to.
    expect(isDocxRegistered('/ws/reuse.docx')).toBe(true);

    // View B's own close/quit flush must still fold in its focused edit —
    // the live-flush hook View B installed must not have been stripped by
    // View A's belated teardown.
    const flushed = await flushDocx('/ws/reuse.docx');
    expect(flushed).toBe(true);
    const saveCallsAfter = invokeMock.mock.calls.filter((c) => c[0] === 'docx_save').length;
    expect(saveCallsAfter).toBeGreaterThan(saveCallsBeforeAResolves);
  });

  // CLUSTER-C2 (data loss): two document-mutating ops started close together
  // must never let a slower earlier op land AFTER a faster later one and
  // clobber it — the second op must always build on the first op's result.
  it('CLUSTER-C2: a second op started while the first is still in flight builds on the first result, not a stale snapshot', async () => {
    const afterAccept: DocumentJson = {
      formatVersion: 1,
      body: [
        {
          kind: 'paragraph',
          inlines: [
            { kind: 'run', text: 'The party ' },
            { kind: 'run', text: 'hereby ' },
            { kind: 'run', text: 'agrees ' },
            {
              kind: 'deletion',
              meta: { id: '101', author: 'Bob Partner', date: '2026-01-03T09:00:00Z' },
              runs: [{ text: 'reluctantly ' }],
            },
            { kind: 'run', text: 'to the terms.' },
          ],
        },
      ],
      comments: {},
    };
    const afterRejectAll: DocumentJson = {
      formatVersion: 1,
      body: [
        {
          kind: 'paragraph',
          inlines: [{ kind: 'run', text: 'The party agrees to the terms.' }],
        },
      ],
      comments: {},
    };

    let resolveAccept: ((doc: DocumentJson) => void) | undefined;
    const acceptPromise = new Promise<DocumentJson>((resolve) => {
      resolveAccept = resolve;
    });

    invokeMock.mockImplementation((cmd: string, args?: Record<string, unknown>) => {
      if (cmd === 'docx_open') return Promise.resolve(docWithRevisions());
      if (cmd === 'docx_resolve_revision') return acceptPromise;
      if (cmd === 'docx_resolve_all') {
        // The KEY assertion: reject-all must run against the RESULT of the
        // already-landed accept, not the doc that was current when the user
        // clicked Reject All (which was still the original, un-accepted doc).
        expect(args?.['document']).toEqual(afterAccept);
        return Promise.resolve(afterRejectAll);
      }
      if (cmd === 'docx_save') return Promise.resolve(undefined);
      return Promise.resolve(undefined);
    });

    renderEditor();
    const list = await screen.findByTestId('docx-revision-list');
    const insRow = within(list)
      .getAllByTestId('docx-revision-row')
      .find((r) => r.getAttribute('data-revision-id') === '100')!;
    fireEvent.click(within(insRow).getByTestId('docx-accept-one')); // op1: kicked off, stays pending

    // While op1 is still unresolved, fire op2.
    fireEvent.click(screen.getByTestId('docx-reject-all'));

    // op2 must NOT have reached the engine yet — it's queued behind op1.
    await new Promise((r) => setTimeout(r, 20));
    expect(invokeMock).not.toHaveBeenCalledWith('docx_resolve_all', expect.anything());

    // Now let op1 land.
    resolveAccept?.(afterAccept);

    // op2 now runs (the mock's assertion above verifies its base doc).
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith('docx_resolve_all', expect.anything()),
    );

    // Final state reflects op2's result — nothing was silently lost or
    // overwritten out of order.
    await waitFor(() => expect(screen.getByTestId('docx-no-changes')).toBeInTheDocument());
  });

  it('Reject all calls docx_resolve_all with action=reject', async () => {
    const cleared: DocumentJson = {
      formatVersion: 1,
      body: [
        { kind: 'paragraph', inlines: [{ kind: 'run', text: 'The party agrees to the terms.' }] },
      ],
      comments: {},
    };
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'docx_open') return Promise.resolve(docWithRevisions());
      if (cmd === 'docx_resolve_all') return Promise.resolve(cleared);
      return Promise.resolve(undefined);
    });

    renderEditor();
    await screen.findByTestId('docx-revision-list');

    fireEvent.click(screen.getByTestId('docx-reject-all'));

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith('docx_resolve_all', {
        document: expect.any(Object),
        action: 'reject',
      }),
    );

    // No changes remain.
    await waitFor(() =>
      expect(screen.getByTestId('docx-no-changes')).toBeInTheDocument(),
    );
  });

  // CLUSTER-C3 P2 (Codex review): a document whose ONLY tracked changes live
  // inside a table (raw block) must still let the user click Accept All —
  // countRevisions() previously only saw paragraph revisions, so this
  // document showed "0 changes" and the button was disabled, even though the
  // engine's resolve_all now genuinely resolves table content too.
  it('Accept all is enabled and works for a document whose only tracked changes are inside a table', async () => {
    const tableOnlyDoc: DocumentJson = {
      formatVersion: 1,
      body: [
        { kind: 'paragraph', inlines: [{ kind: 'run', text: 'No paragraph-level changes here.' }] },
        {
          kind: 'raw',
          xml: '<w:tbl><w:tr><w:tc><w:p><w:del w:id="1" w:author="A" w:date="2026-01-01T00:00:00Z"><w:r><w:delText>client name</w:delText></w:r></w:del></w:p></w:tc></w:tr></w:tbl>',
        },
      ],
      comments: {},
    };
    const cleared: DocumentJson = {
      formatVersion: 1,
      body: [
        { kind: 'paragraph', inlines: [{ kind: 'run', text: 'No paragraph-level changes here.' }] },
        { kind: 'raw', xml: '<w:tbl><w:tr><w:tc><w:p/></w:tc></w:tr></w:tbl>' },
      ],
      comments: {},
    };
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'docx_open') return Promise.resolve(tableOnlyDoc);
      if (cmd === 'docx_resolve_all') return Promise.resolve(cleared);
      return Promise.resolve(undefined);
    });

    renderEditor();
    await screen.findByTestId('docx-document-body');

    const acceptAll = await screen.findByTestId('docx-accept-all');
    expect(acceptAll).not.toBeDisabled();

    fireEvent.click(acceptAll);

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith('docx_resolve_all', {
        document: expect.any(Object),
        action: 'accept',
      }),
    );
  });
});

// QA-81 (P0 silent data loss): a brand-new .docx being ACTIVELY TYPED lost all
// in-progress text on a crash/power-loss, while the toolbar showed "Saved" the
// whole time. The steady-state periodic autosave only ever persisted content
// that had already been COMMITTED (a run blur). Live, focused, un-blurred
// keystrokes were folded in ONLY by the navigate-away / close / quit / unmount
// flush — so the documented ~2s autosave wrote a doc that was MISSING whatever
// the user was currently typing. This suite pins the fix: the periodic autosave
// must persist the live keystroke to disk on its own cadence, with no
// navigate-away, close, export, or unmount required.
describe('DocxEditor — QA-81: live typing is persisted by the periodic autosave', () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it('persists a focused, un-blurred keystroke on the periodic autosave (no navigate-away needed)', async () => {
    const oneRunDoc: DocumentJson = {
      formatVersion: 1,
      body: [{ kind: 'paragraph', inlines: [{ kind: 'run', text: 'original text' }] }],
      comments: {},
    };
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'docx_open') return Promise.resolve(oneRunDoc);
      if (cmd === 'docx_save') return Promise.resolve(undefined);
      return Promise.resolve(undefined);
    });

    renderEditor();
    const run = await screen.findByTestId('docx-run');

    // Reviewing OFF: a plain-text edit — isolates this to the periodic-save
    // mechanism, not the tracked-changes diff path.
    fireEvent.click(screen.getByTestId('docx-reviewing-toggle'));

    // The user types (focus fires, DOM text changes) and KEEPS typing — they
    // never blur, never switch tabs, never close, never export.
    fireEvent.focus(run);
    run.textContent = 'original text TYPED LIVE';

    // The periodic autosave (no navigate-away) must fold in the live DOM text
    // and write it to disk on its own — this is what "Saved" must truthfully
    // mean while typing.
    await waitFor(
      () =>
        expect(invokeMock).toHaveBeenCalledWith(
          'docx_save',
          expect.objectContaining({
            path: '/ws/agreement.docx',
            document: expect.objectContaining({
              body: [
                expect.objectContaining({
                  inlines: [
                    expect.objectContaining({ kind: 'run', text: 'original text TYPED LIVE' }),
                  ],
                }),
              ],
            }),
          }),
        ),
      { timeout: 6000 },
    );
  }, 15000);

  it('keeps persisting later keystrokes typed into the SAME still-focused run', async () => {
    const oneRunDoc: DocumentJson = {
      formatVersion: 1,
      body: [{ kind: 'paragraph', inlines: [{ kind: 'run', text: 'seed' }] }],
      comments: {},
    };
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'docx_open') return Promise.resolve(oneRunDoc);
      if (cmd === 'docx_save') return Promise.resolve(undefined);
      return Promise.resolve(undefined);
    });

    renderEditor();
    const run = await screen.findByTestId('docx-run');
    fireEvent.click(screen.getByTestId('docx-reviewing-toggle'));

    fireEvent.focus(run);
    run.textContent = 'seed first';
    await waitFor(
      () =>
        expect(invokeMock).toHaveBeenCalledWith(
          'docx_save',
          expect.objectContaining({
            document: expect.objectContaining({
              body: [expect.objectContaining({ inlines: [expect.objectContaining({ text: 'seed first' })] })],
            }),
          }),
        ),
      { timeout: 6000 },
    );

    // Still focused, still no blur — type MORE. The next autosave cycle must
    // pick up the newer text (the active run must not stop being tracked after
    // the first periodic save).
    run.textContent = 'seed first second';
    await waitFor(
      () =>
        expect(invokeMock).toHaveBeenCalledWith(
          'docx_save',
          expect.objectContaining({
            document: expect.objectContaining({
              body: [expect.objectContaining({ inlines: [expect.objectContaining({ text: 'seed first second' })] })],
            }),
          }),
        ),
      { timeout: 6000 },
    );
  }, 15000);

  // QA-81 (fidelity, review catch): the shadow save must persist the live text
  // EXACTLY — leading/trailing spaces, runs of multiple spaces, and line breaks
  // intact. If it collapsed whitespace, a crash would restore garbled spacing
  // (wrong, not just lost). It reads via `textContent` (verbatim), the SAME
  // extraction the authoritative blur commit uses, so the shadow can't diverge
  // from what a blur would save.
  it('persists live text with whitespace and line breaks intact (no collapsing)', async () => {
    const oneRunDoc: DocumentJson = {
      formatVersion: 1,
      body: [{ kind: 'paragraph', inlines: [{ kind: 'run', text: 'x' }] }],
      comments: {},
    };
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'docx_open') return Promise.resolve(oneRunDoc);
      if (cmd === 'docx_save') return Promise.resolve(undefined);
      return Promise.resolve(undefined);
    });

    renderEditor();
    const run = await screen.findByTestId('docx-run');
    fireEvent.click(screen.getByTestId('docx-reviewing-toggle'));

    // Deliberately awkward spacing: leading + trailing spaces, a double space,
    // and a newline. This must round-trip byte-for-byte.
    const typed = '  lead   spaces  and\nsecond line ';
    fireEvent.focus(run);
    run.textContent = typed;

    await waitFor(
      () =>
        expect(invokeMock).toHaveBeenCalledWith(
          'docx_save',
          expect.objectContaining({
            document: expect.objectContaining({
              body: [
                expect.objectContaining({
                  inlines: [expect.objectContaining({ kind: 'run', text: typed })],
                }),
              ],
            }),
          }),
        ),
      { timeout: 6000 },
    );
  }, 15000);

  // QA-81 (IME, review catch): a 2s shadow save landing DURING an IME
  // composition (CJK) may persist a half-composed run — that's acceptable
  // (persist-then-heal-on-commit), but it must NOT corrupt the document
  // structure. Because the shadow save only assigns a string to one run's text
  // in a clone (never re-renders / never touches the live composing element),
  // the structure stays a single paragraph with a single run, and the eventual
  // composition-end blur commits the final text.
  it('persisting a half-composed (IME) run keeps the document structure intact and heals on blur commit', async () => {
    const oneRunDoc: DocumentJson = {
      formatVersion: 1,
      body: [{ kind: 'paragraph', inlines: [{ kind: 'run', text: '' }] }],
      comments: {},
    };
    const saved: DocumentJson[] = [];
    invokeMock.mockImplementation((cmd: string, args?: Record<string, unknown>) => {
      if (cmd === 'docx_open') return Promise.resolve(oneRunDoc);
      if (cmd === 'docx_save') {
        saved.push(args?.['document'] as DocumentJson);
        return Promise.resolve(undefined);
      }
      return Promise.resolve(undefined);
    });

    renderEditor();
    const run = await screen.findByTestId('docx-run');
    fireEvent.click(screen.getByTestId('docx-reviewing-toggle'));

    // Mid-composition: the DOM holds a half-composed romaji/pinyin buffer.
    fireEvent.focus(run);
    run.textContent = 'nih';

    // The shadow save persists the half-composed text WITHOUT corrupting the
    // run structure (still exactly one paragraph with one run).
    await waitFor(
      () => {
        const half = saved.find(
          (d) =>
            d.body.length === 1 &&
            d.body[0]?.kind === 'paragraph' &&
            (d.body[0] as { inlines: { kind: string; text?: string }[] }).inlines.length === 1 &&
            (d.body[0] as { inlines: { kind: string; text?: string }[] }).inlines[0]?.text === 'nih',
        );
        expect(half).toBeTruthy();
      },
      { timeout: 6000 },
    );

    // Composition ends → the run commits the final text on blur, which heals it.
    run.textContent = '你好';
    fireEvent.blur(run);
    await waitFor(
      () =>
        expect(saved.some((d) => (d.body[0] as { inlines: { text?: string }[] }).inlines[0]?.text === '你好')).toBe(true),
      { timeout: 6000 },
    );
  }, 15000);

  // QA-81 (P1, review round 4): the LAST silent-loss window — BEFORE the first
  // autosave tick. A focused run is only tracked on focus/blur, so between the
  // first keystroke and the first periodic save nothing marked the session
  // dirty: the toolbar/registry read a false "Saved" while the new characters
  // lived only in the DOM, and a crash in that window lost them. Typing must
  // flip the doc to UNSAVED immediately — no timers required.
  it('marks the doc UNSAVED the instant the user types — no "Saved" lie before the first autosave tick', async () => {
    const oneRunDoc: DocumentJson = {
      formatVersion: 1,
      body: [{ kind: 'paragraph', inlines: [{ kind: 'run', text: 'original text' }] }],
      comments: {},
    };
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'docx_open') return Promise.resolve(oneRunDoc);
      if (cmd === 'docx_save') return Promise.resolve(undefined);
      return Promise.resolve(undefined);
    });

    renderEditor();
    const run = await screen.findByTestId('docx-run');
    fireEvent.click(screen.getByTestId('docx-reviewing-toggle'));

    fireEvent.focus(run);
    // Just focusing (no typing) does not make it dirty — the toolbar honestly
    // still reads "Saved".
    expect(isDocxUnsaved('/ws/agreement.docx')).toBe(false);

    // The user types — a real browser fires an input event on the contentEditable.
    run.textContent = 'original text TYPED';
    fireEvent.input(run);

    // Advance NO timers. The registry must ALREADY read unsaved — never a false
    // "Saved" while the typed characters live only in the DOM.
    expect(isDocxUnsaved('/ws/agreement.docx')).toBe(true);

    // And the crash-recovery path (the close/quit flush) captures the typed text.
    const flushed = await flushDocx('/ws/agreement.docx');
    expect(flushed).toBe(true);
    expect(invokeMock).toHaveBeenCalledWith(
      'docx_save',
      expect.objectContaining({
        document: expect.objectContaining({
          body: [
            expect.objectContaining({
              inlines: [expect.objectContaining({ kind: 'run', text: 'original text TYPED' })],
            }),
          ],
        }),
      }),
    );
  }, 15000);

  // QA-81 (P2, review round 4): after a shadow save has mirrored the focused
  // run's live text into session.doc, a tab-switch/close BEFORE blur used to see
  // a "clean" session (the outgoing fold finds no diff) and dispose it without
  // the leaving-checkpoint snapshot — so the finished edit vanished from version
  // history even though it was on disk. The leaving checkpoint must still record
  // it in version history.
  it('a tab-switch after a shadow save still records the finished edit in version history', async () => {
    const oneRunDoc: DocumentJson = {
      formatVersion: 1,
      body: [{ kind: 'paragraph', inlines: [{ kind: 'run', text: 'original text' }] }],
      comments: {},
    };
    const onAfterSave = vi.fn();
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'docx_open') return Promise.resolve(oneRunDoc);
      if (cmd === 'docx_save') return Promise.resolve(undefined);
      return Promise.resolve(undefined);
    });

    const { unmount } = render(
      <TooltipProvider>
        <DocxEditor filePath="/ws/agreement.docx" fileName="agreement.docx" onAfterSave={onAfterSave} />
      </TooltipProvider>,
    );
    const run = await screen.findByTestId('docx-run');
    fireEvent.click(screen.getByTestId('docx-reviewing-toggle'));

    fireEvent.focus(run);
    run.textContent = 'original text SHADOW SAVED';
    fireEvent.input(run);

    // The live shadow save mirrors the text to disk WITHOUT a version snapshot.
    await waitFor(
      () =>
        expect(invokeMock).toHaveBeenCalledWith(
          'docx_save',
          expect.objectContaining({
            document: expect.objectContaining({
              body: [
                expect.objectContaining({
                  inlines: [expect.objectContaining({ text: 'original text SHADOW SAVED' })],
                }),
              ],
            }),
          }),
        ),
      { timeout: 6000 },
    );
    expect(onAfterSave).not.toHaveBeenCalled();

    // Switch tabs (unmount) WITHOUT blurring — the leaving checkpoint must
    // record the finished edit in version history, not silently drop it.
    unmount();
    await waitFor(() => expect(onAfterSave).toHaveBeenCalled(), { timeout: 6000 });
  }, 15000);
});

describe('DocxEditor — AI redline (A4)', () => {
  const VALID_KEYS = [
    { provider: 'anthropic', key: 'sk-test', isValid: true },
  ];

  // A plain doc the AI will redline: one paragraph with two distinct phrases so
  // we can land TWO edits in the SAME paragraph (the drift-safety case).
  function plainDoc(): DocumentJson {
    return {
      formatVersion: 1,
      body: [
        {
          kind: 'paragraph',
          inlines: [
            { kind: 'run', text: 'The Company shall indemnify the Client for all losses.' },
          ],
        },
      ],
      comments: {},
    };
  }

  // The DOM the engine returns after applying the two edits: "Company"→"Vendor"
  // (replace = del+ins sharing id 1) and "for all losses" deleted (id 2). This
  // is what docx_author_revisions resolves to; the editor renders it + lists the
  // tracked changes for accept/reject.
  function redlinedDoc(): DocumentJson {
    return {
      formatVersion: 1,
      body: [
        {
          kind: 'paragraph',
          inlines: [
            { kind: 'run', text: 'The ' },
            {
              kind: 'insertion',
              meta: { id: '1', author: BRAND.messaging.redlineAuthor, date: '2026-06-09T00:00:00Z' },
              runs: [{ text: 'Vendor' }],
            },
            {
              kind: 'deletion',
              meta: { id: '1', author: BRAND.messaging.redlineAuthor, date: '2026-06-09T00:00:00Z' },
              runs: [{ text: 'Company' }],
            },
            { kind: 'run', text: ' shall indemnify the Client ' },
            {
              kind: 'deletion',
              meta: { id: '2', author: BRAND.messaging.redlineAuthor, date: '2026-06-09T00:00:00Z' },
              runs: [{ text: 'for all losses' }],
            },
            { kind: 'run', text: '.' },
          ],
        },
      ],
      comments: {},
    };
  }

  const TWO_EDITS: DocxAiEdit[] = [
    { op: 'replace', paragraphIndex: 0, anchorText: 'Company', newText: 'Vendor', reason: 'Use the defined term "Vendor".' },
    { op: 'delete', paragraphIndex: 0, anchorText: 'for all losses', reason: 'Narrow the indemnity scope.' },
  ];

  beforeEach(() => {
    invokeMock.mockReset();
    requestRedlineEditsMock.mockReset();
  });

  function renderWithKeys() {
    return render(
      <TooltipProvider>
        <DocxEditor
          filePath="/ws/agreement.docx"
          fileName="agreement.docx"
          apiKeys={VALID_KEYS}
          aiProvider="anthropic"
        />
      </TooltipProvider>,
    );
  }

  it('applies AI edits as tracked changes via the batch engine command and surfaces them for accept/reject', async () => {
    selectionState.decision = {
      kind: 'matter',
      sourceKind: 'matter-only',
      matter: {
        id: 'matter-a',
        name: 'Alpha',
        client: 'Alpha',
        folderPaths: ['/ws'],
        createdAt: '2026-07-18T00:00:00.000Z',
      },
      client: null,
    };
    requestRedlineEditsMock.mockResolvedValue(TWO_EDITS);

    invokeMock.mockImplementation((cmd: string, args?: Record<string, unknown>) => {
      if (cmd === 'docx_open') return Promise.resolve(plainDoc());
      if (cmd === 'docx_author_revisions') {
        // Drift-safe contract: the editor applies BOTH edits against the
        // ORIGINAL doc in ONE engine call, attributed to the branded AI author.
        expect(args?.['document']).toEqual(plainDoc());
        expect(args?.['edits']).toEqual(TWO_EDITS);
        expect(args?.['author']).toBe(BRAND.messaging.redlineAuthor);
        return Promise.resolve({
          document: redlinedDoc(),
          results: [
            { index: 0, applied: true, revisionId: '1', error: null },
            { index: 1, applied: true, revisionId: '2', error: null },
          ],
        });
      }
      if (cmd === 'docx_save') return Promise.resolve(undefined);
      return Promise.resolve(undefined);
    });

    renderWithKeys();
    await screen.findByTestId('docx-document-body');

    // Open the composer and submit an instruction.
    await openDocxActionsMenu();
    fireEvent.click(screen.getByTestId('docx-revise-with-ai'));
    const input = await screen.findByTestId('docx-redline-input');
    fireEvent.change(input, { target: { value: 'tighten the indemnity clause' } });
    fireEvent.click(screen.getByTestId('docx-redline-submit'));

    // The model boundary was called with the instruction + current doc.
    await waitFor(() => expect(requestRedlineEditsMock).toHaveBeenCalledTimes(1));
    expect(requestRedlineEditsMock.mock.calls[0]?.[1]).toBe('tighten the indemnity clause');

    // The engine batch command was invoked (assertions inside the mock).
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith(
        'docx_author_revisions',
        expect.objectContaining({ author: BRAND.messaging.redlineAuthor }),
      ),
    );

    // The returned tracked changes now render + appear in the review pane for
    // accept/reject (2 grouped revisions: id 1 = the replace, id 2 = delete).
    await waitFor(() => {
      const rows = within(
        screen.getByTestId('docx-revision-list'),
      ).getAllByTestId('docx-revision-row');
      const ids = rows.map((r) => r.getAttribute('data-revision-id'));
      expect(ids).toEqual(expect.arrayContaining(['1', '2']));
    });
    // The AI's insertion + deletions are attributed to the branded AI author.
    expect(screen.getByTestId('docx-insertion')).toHaveAttribute('data-author', BRAND.messaging.redlineAuthor);
    const dels = screen.getAllByTestId('docx-deletion');
    expect(dels.length).toBeGreaterThanOrEqual(2);

    // The results summary shows WHY (the reasons), so the lawyer sees rationale.
    const summary = await screen.findByTestId('docx-redline-summary');
    expect(summary).toHaveTextContent('Use the defined term "Vendor".');
    expect(summary).toHaveTextContent('Narrow the indemnity scope.');

    // Accept/reject still works: rejecting id 2 calls the resolve command.
    invokeMock.mockImplementationOnce(() => Promise.resolve(plainDoc())); // for docx_resolve_revision
    const row2 = within(screen.getByTestId('docx-revision-list'))
      .getAllByTestId('docx-revision-row')
      .find((r) => r.getAttribute('data-revision-id') === '2')!;
    fireEvent.click(within(row2).getByTestId('docx-reject-one'));
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith(
        'docx_resolve_revision',
        expect.objectContaining({ revisionId: '2', action: 'reject' }),
      ),
    );
  });

  it('shows a no-changes summary and does NOT call the engine when the AI proposes nothing', async () => {
    requestRedlineEditsMock.mockResolvedValue([]);
    invokeMock.mockImplementation((cmd: string) =>
      cmd === 'docx_open' ? Promise.resolve(plainDoc()) : Promise.resolve(undefined),
    );

    renderWithKeys();
    await screen.findByTestId('docx-document-body');
    await openDocxActionsMenu();
    fireEvent.click(screen.getByTestId('docx-revise-with-ai'));
    fireEvent.change(await screen.findByTestId('docx-redline-input'), {
      target: { value: 'no change needed' },
    });
    fireEvent.click(screen.getByTestId('docx-redline-submit'));

    await waitFor(() => expect(requestRedlineEditsMock).toHaveBeenCalled());
    // Engine batch command never fired (no edits to apply).
    expect(
      invokeMock.mock.calls.some((c) => c[0] === 'docx_author_revisions'),
    ).toBe(false);
    // The summary communicates "no changes".
    expect(await screen.findByTestId('docx-redline-summary')).toBeInTheDocument();
  });

  it('disables the submit + shows a key hint when no provider key is configured', async () => {
    invokeMock.mockImplementation((cmd: string) =>
      cmd === 'docx_open' ? Promise.resolve(plainDoc()) : Promise.resolve(undefined),
    );
    render(
      <TooltipProvider>
        <DocxEditor filePath="/ws/agreement.docx" fileName="agreement.docx" apiKeys={[]} />
      </TooltipProvider>,
    );
    await screen.findByTestId('docx-document-body');
    await openDocxActionsMenu();
    fireEvent.click(screen.getByTestId('docx-revise-with-ai'));
    fireEvent.change(await screen.findByTestId('docx-redline-input'), {
      target: { value: 'do something' },
    });
    // Key hint visible; submit disabled.
    expect(screen.getByTestId('docx-redline-need-key')).toBeInTheDocument();
    expect(screen.getByTestId('docx-redline-submit')).toBeDisabled();
  });

  it.each([
    ['blocked-unresolved', 'The selected client is still unresolved.'],
    ['follower-disagreement', 'The client selection is still catching up.'],
  ] as const)('refuses and surfaces %s before asking AI or changing the document', async (reason, message) => {
    selectionState.decision = {
      kind: 'refused',
      reason,
      message,
    };
    invokeMock.mockImplementation((cmd: string) =>
      cmd === 'docx_open' ? Promise.resolve(plainDoc()) : Promise.resolve(undefined),
    );

    renderWithKeys();
    await screen.findByTestId('docx-document-body');
    await openDocxActionsMenu();
    fireEvent.click(screen.getByTestId('docx-revise-with-ai'));
    fireEvent.change(await screen.findByTestId('docx-redline-input'), {
      target: { value: 'change this document' },
    });
    fireEvent.click(screen.getByTestId('docx-redline-submit'));

    expect(await screen.findByTestId('docx-redline-error')).toHaveTextContent(
      message,
    );
    expect(requestRedlineEditsMock).not.toHaveBeenCalled();
    expect(
      invokeMock.mock.calls.some((call) => call[0] === 'docx_author_revisions'),
    ).toBe(false);
  });
});

describe('DocxEditor — user edits become tracked changes when Reviewing (A4 secondary)', () => {
  beforeEach(() => invokeMock.mockReset());

  function oneRunDoc(): DocumentJson {
    return {
      formatVersion: 1,
      body: [
        { kind: 'paragraph', inlines: [{ kind: 'run', text: 'governed by Delaware law' }] },
      ],
      comments: {},
    };
  }

  it('diffs the edit and authors it as a tracked change attributed to the user', async () => {
    const authored: DocumentJson = {
      formatVersion: 1,
      body: [
        {
          kind: 'paragraph',
          inlines: [
            { kind: 'run', text: 'governed by ' },
            {
              kind: 'insertion',
              meta: { id: '1', author: 'You', date: '2026-06-09T00:00:00Z' },
              runs: [{ text: 'Nevada' }],
            },
            {
              kind: 'deletion',
              meta: { id: '1', author: 'You', date: '2026-06-09T00:00:00Z' },
              runs: [{ text: 'Delaware' }],
            },
            { kind: 'run', text: ' law' },
          ],
        },
      ],
      comments: {},
    };

    invokeMock.mockImplementation((cmd: string, args?: Record<string, unknown>) => {
      if (cmd === 'docx_open') return Promise.resolve(oneRunDoc());
      if (cmd === 'docx_author_revisions') {
        // Reviewing is ON by default → user edit becomes tracked change(s)
        // authored as "You", applied via the same drift-safe batch command.
        expect(args?.['author']).toBe('You');
        const edits = args?.['edits'] as DocxAiEdit[];
        // Delaware -> Nevada is a single replace.
        expect(edits).toEqual([
          expect.objectContaining({ op: 'replace', anchorText: 'Delaware', newText: 'Nevada' }),
        ]);
        return Promise.resolve({
          document: authored,
          results: [{ index: 0, applied: true, revisionId: '1', error: null }],
        });
      }
      if (cmd === 'docx_save') return Promise.resolve(undefined);
      return Promise.resolve(undefined);
    });

    render(
      <TooltipProvider>
        <DocxEditor filePath="/ws/x.docx" fileName="x.docx" authorName="You" />
      </TooltipProvider>,
    );

    // Editing a run fires onBlur with the new text. Find the editable run and
    // simulate the user changing "Delaware" -> "Nevada".
    const run = await screen.findByTestId('docx-run');
    run.textContent = 'governed by Nevada law';
    fireEvent.blur(run);

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith(
        'docx_author_revisions',
        expect.objectContaining({ author: 'You' }),
      ),
    );
    // The authored tracked change renders + is attributed to the user.
    await waitFor(() =>
      expect(screen.getByTestId('docx-insertion')).toHaveAttribute('data-author', 'You'),
    );
  });
});

describe('DocxEditor — reviewing toggle', () => {
  beforeEach(() => invokeMock.mockReset());

  it('hides deletions and shows insertions as normal text in final view', async () => {
    invokeMock.mockImplementation((cmd: string) =>
      cmd === 'docx_open'
        ? Promise.resolve(docWithRevisions())
        : Promise.resolve(undefined),
    );
    renderEditor();

    // Reviewing on by default: both insertion + deletion nodes present.
    expect(await screen.findByTestId('docx-insertion')).toBeInTheDocument();
    expect(screen.getByTestId('docx-deletion')).toBeInTheDocument();

    // Toggle Reviewing off.
    fireEvent.click(screen.getByTestId('docx-reviewing-toggle'));

    await waitFor(() => {
      // Deletion gone, no marked-up insertion node.
      expect(screen.queryByTestId('docx-deletion')).toBeNull();
      expect(screen.queryByTestId('docx-insertion')).toBeNull();
    });

    // Scope text assertions to the document body — the review pane still lists
    // the revisions (toggling Reviewing only changes the document rendering,
    // not the underlying DOM or the change list), so "hereby"/"reluctantly"
    // also appear in pane snippets.
    const body = within(screen.getByTestId('docx-document-body'));
    // Inserted text still present as plain text in the document.
    expect(body.getByText(/hereby/)).toBeInTheDocument();
    // Deleted text no longer present in the document.
    expect(body.queryByText(/reluctantly/)).toBeNull();
  });
});

describe('DocxEditor — Export (A6)', () => {
  beforeEach(() => {
    invokeMock.mockReset();
    saveDialogMock.mockReset();
    readFileMock.mockReset();
    saveFileMock.mockReset();
  });

  // Base invoke behavior: open returns a doc, save is observable, and the export
  // commands resolve. Individual tests assert which command fired. LibreOffice
  // is "installed" by default (VG-4a probes it before any PDF conversion).
  function wireInvoke() {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'docx_open') return Promise.resolve(docWithRevisions());
      if (cmd === 'docx_save') return Promise.resolve(undefined);
      if (cmd === 'docx_export_copy') return Promise.resolve(undefined);
      if (cmd === 'docx_export_clean_copy') return Promise.resolve(undefined);
      if (cmd === 'detect_libreoffice') return Promise.resolve('/usr/bin/soffice');
      if (cmd === 'convert_docx_to_pdf') return Promise.resolve('/tmp/agreement.pdf');
      return Promise.resolve(undefined);
    });
  }

  async function openExportMenu() {
    await openDocxActionsMenu();
    // Both format options + the privilege-safe clean copies are present.
    await screen.findByTestId('docx-export-word');
  }

  it('renders the Export control with Word, PDF, and clean-copy options', async () => {
    wireInvoke();
    renderEditor();
    await openExportMenu();

    expect(screen.getByTestId('docx-export-word')).toBeInTheDocument();
    expect(screen.getByTestId('docx-export-pdf')).toBeInTheDocument();
    expect(screen.getByTestId('docx-export-clean')).toBeInTheDocument();
    expect(screen.getByTestId('docx-export-clean-final')).toBeInTheDocument();
  });

  it('Word export saves a copy to the chosen path via docx_export_copy', async () => {
    wireInvoke();
    saveDialogMock.mockResolvedValue('/out/agreement.docx');
    renderEditor();
    await openExportMenu();

    fireEvent.click(screen.getByTestId('docx-export-word'));

    // Flushes the current DOM to disk first, then writes the faithful copy.
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith('docx_export_copy', {
        srcPath: '/ws/agreement.docx',
        destPath: '/out/agreement.docx',
      }),
    );
    // The PDF/clean paths were NOT taken.
    expect(invokeMock).not.toHaveBeenCalledWith(
      'convert_docx_to_pdf',
      expect.anything(),
    );
  });

  it('PDF export converts the saved .docx then saves the PDF bytes', async () => {
    wireInvoke();
    readFileMock.mockResolvedValue(new Uint8Array([1, 2, 3]));
    saveFileMock.mockResolvedValue('/out/agreement.pdf');
    renderEditor();
    await openExportMenu();

    fireEvent.click(screen.getByTestId('docx-export-pdf'));

    // Conversion command called with the saved source path.
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith('convert_docx_to_pdf', {
        inputPath: '/ws/agreement.docx',
      }),
    );
    // The produced PDF was read and offered to the user via saveFile.
    await waitFor(() => expect(readFileMock).toHaveBeenCalledWith('/tmp/agreement.pdf'));
    await waitFor(() => expect(saveFileMock).toHaveBeenCalledTimes(1));
  });

  it('VG-4a: explains with the help notice when LibreOffice is not installed, never attempting the conversion', async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'docx_open') return Promise.resolve(docWithRevisions());
      if (cmd === 'docx_save') return Promise.resolve(undefined);
      if (cmd === 'detect_libreoffice') return Promise.resolve(null);
      return Promise.resolve(undefined);
    });
    renderEditor();
    await openExportMenu();

    fireEvent.click(screen.getByTestId('docx-export-pdf'));

    // The dedicated explanation panel appears (plain language + install link).
    const notice = await screen.findByTestId('libreoffice-help-notice');
    expect(notice).toHaveTextContent('PDF export needs LibreOffice');
    expect(notice).toHaveTextContent('Nothing leaves your machine.');
    expect(notice).toHaveTextContent('libreoffice.org');

    // The conversion was never attempted and nothing was saved.
    expect(invokeMock).not.toHaveBeenCalledWith(
      'convert_docx_to_pdf',
      expect.anything(),
    );
    expect(saveFileMock).not.toHaveBeenCalled();

    // Dismiss removes the panel.
    fireEvent.click(within(notice).getByLabelText('Dismiss'));
    expect(screen.queryByTestId('libreoffice-help-notice')).not.toBeInTheDocument();
  });

  it('still shows the friendly error notice when LibreOffice is present but the conversion fails', async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'docx_open') return Promise.resolve(docWithRevisions());
      if (cmd === 'docx_save') return Promise.resolve(undefined);
      if (cmd === 'detect_libreoffice') return Promise.resolve('/usr/bin/soffice');
      if (cmd === 'convert_docx_to_pdf') {
        return Promise.reject(new Error('PDF conversion failed (soffice exited 1)'));
      }
      return Promise.resolve(undefined);
    });
    renderEditor();
    await openExportMenu();

    fireEvent.click(screen.getByTestId('docx-export-pdf'));

    const notice = await screen.findByTestId('docx-export-notice');
    expect(notice).toHaveAttribute('data-kind', 'error');
    expect(notice).toHaveTextContent(/conversion failed/i);
    // The detect-and-explain panel is NOT for generic failures.
    expect(screen.queryByTestId('libreoffice-help-notice')).not.toBeInTheDocument();
    // saveFile never reached (nothing to save).
    expect(saveFileMock).not.toHaveBeenCalled();
  });

  it('Clean copy export calls docx_export_clean_copy with acceptAllChanges=false', async () => {
    wireInvoke();
    saveDialogMock.mockResolvedValue('/out/agreement-clean.docx');
    renderEditor();
    await openExportMenu();

    fireEvent.click(screen.getByTestId('docx-export-clean'));

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith('docx_export_clean_copy', {
        srcPath: '/ws/agreement.docx',
        destPath: '/out/agreement-clean.docx',
        acceptAllChanges: false,
      }),
    );
  });

  it('Clean final copy export passes acceptAllChanges=true', async () => {
    wireInvoke();
    saveDialogMock.mockResolvedValue('/out/agreement-final.docx');
    renderEditor();
    await openExportMenu();

    fireEvent.click(screen.getByTestId('docx-export-clean-final'));

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith('docx_export_clean_copy', {
        srcPath: '/ws/agreement.docx',
        destPath: '/out/agreement-final.docx',
        acceptAllChanges: true,
      }),
    );
  });

  it('cancelling the save dialog does not call the export command', async () => {
    wireInvoke();
    saveDialogMock.mockResolvedValue(null); // user cancelled
    renderEditor();
    await openExportMenu();

    fireEvent.click(screen.getByTestId('docx-export-word'));

    // Give the handler a tick; docx_export_copy must NOT have been invoked.
    await waitFor(() => expect(saveDialogMock).toHaveBeenCalled());
    expect(invokeMock).not.toHaveBeenCalledWith(
      'docx_export_copy',
      expect.anything(),
    );
  });
});

// ── QA-34 (P0): silent data loss when a .docx autosave write fails ──────────
//
// Repro (bench-2): an antivirus/backup process briefly holds an exclusive OS
// lock on the file. The app's save write fails ONCE and then never retries and
// never writes again for that document — while the UI keeps saying "Saved."
// These tests pin the robust behaviour: a failed save is TRUTHFUL (error state,
// never "Saved"), self-heals with automatic retry once the lock clears, and a
// PERSISTENT failure escalates to a non-timeout-dismissable warning with a
// "Save a copy elsewhere" escape hatch — the user's typing is never lost.
describe('DocxEditor — QA-34 save resilience', () => {
  beforeEach(() => {
    invokeMock.mockReset();
    saveDialogMock.mockReset();
  });

  // A doc with exactly one insertion revision (id 100). Accepting it schedules a
  // save, which is the observable seam we drive these tests through.
  function oneRevisionDoc(): DocumentJson {
    return {
      formatVersion: 1,
      body: [
        {
          kind: 'paragraph',
          inlines: [
            { kind: 'run', text: 'The party ' },
            {
              kind: 'insertion',
              meta: { id: '100', author: 'Alice', date: '2026-01-02T09:00:00Z' },
              runs: [{ text: 'hereby ' }],
            },
            { kind: 'run', text: 'agrees.' },
          ],
        },
      ],
      comments: {},
    };
  }
  const resolvedDoc: DocumentJson = {
    formatVersion: 1,
    body: [{ kind: 'paragraph', inlines: [{ kind: 'run', text: 'The party hereby agrees.' }] }],
    comments: {},
  };

  async function triggerSaveViaAccept() {
    const list = await screen.findByTestId('docx-revision-list');
    const insRow = within(list)
      .getAllByTestId('docx-revision-row')
      .find((r) => r.getAttribute('data-revision-id') === '100')!;
    fireEvent.click(within(insRow).getByTestId('docx-accept-one'));
  }

  it('a failed save is shown as an error (never "Saved") and self-heals via automatic retry', async () => {
    let saveAttempts = 0;
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'docx_open') return Promise.resolve(oneRevisionDoc());
      if (cmd === 'docx_resolve_revision') return Promise.resolve(resolvedDoc);
      if (cmd === 'docx_save') {
        saveAttempts += 1;
        // Fail the FIRST write (lock held), then succeed (lock released).
        return saveAttempts === 1
          ? Promise.reject(new Error('The process cannot access the file (locked)'))
          : Promise.resolve(undefined);
      }
      return Promise.resolve(undefined);
    });

    renderEditor();
    await triggerSaveViaAccept();

    // The failed write must surface as an error — NOT a false "Saved".
    await waitFor(
      () => expect(screen.getByTestId('auto-save-indicator')).toHaveAttribute('data-state', 'error'),
      { timeout: 4000 },
    );

    // With NO further user action, the retry lands after the lock clears and the
    // indicator returns to a truthful saved state — and the content is persisted.
    await waitFor(
      () => expect(screen.getByTestId('auto-save-indicator')).toHaveAttribute('data-state', 'saved-recent'),
      { timeout: 8000 },
    );
    expect(saveAttempts).toBeGreaterThanOrEqual(2);
  }, 15000);

  it('a persistent save failure escalates to a non-dismissable warning and never shows "Saved"', async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'docx_open') return Promise.resolve(oneRevisionDoc());
      if (cmd === 'docx_resolve_revision') return Promise.resolve(resolvedDoc);
      if (cmd === 'docx_save') return Promise.reject(new Error('locked — persistent'));
      return Promise.resolve(undefined);
    });

    renderEditor();
    await triggerSaveViaAccept();

    // After sustained failure, a visible warning appears with the escape hatch.
    await waitFor(
      () => expect(screen.getByTestId('docx-save-escalation')).toBeInTheDocument(),
      { timeout: 12000 },
    );
    expect(screen.getByTestId('docx-save-copy-elsewhere')).toBeInTheDocument();
    // The save indicator must still read as an error — never "Saved".
    expect(screen.getByTestId('auto-save-indicator')).toHaveAttribute('data-state', 'error');
  }, 20000);

  it('"Save a copy elsewhere" writes the current document to a user-chosen path', async () => {
    saveDialogMock.mockResolvedValue('/backup/agreement-rescued.docx');
    invokeMock.mockImplementation((cmd: string, args?: Record<string, unknown>) => {
      if (cmd === 'docx_open') return Promise.resolve(oneRevisionDoc());
      if (cmd === 'docx_resolve_revision') return Promise.resolve(resolvedDoc);
      if (cmd === 'docx_save') {
        // The ORIGINAL path stays locked; the rescue copy goes elsewhere and works.
        return args?.['path'] === '/ws/agreement.docx'
          ? Promise.reject(new Error('locked'))
          : Promise.resolve(undefined);
      }
      return Promise.resolve(undefined);
    });

    renderEditor();
    await triggerSaveViaAccept();

    const rescue = await screen.findByTestId('docx-save-copy-elsewhere', undefined, { timeout: 12000 });
    fireEvent.click(rescue);

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith(
        'docx_save',
        expect.objectContaining({ path: '/backup/agreement-rescued.docx' }),
      ),
    );
  }, 20000);

  // Coordinator P2 #1: the mounted-tracking effect must set the ref true in
  // SETUP, not only false in cleanup — else React 18 StrictMode's dev
  // setup→cleanup→setup flips it to false on the first remount and never
  // restores it, silently DISABLING all save retries in dev/QA. Under StrictMode,
  // a fail-once save must still self-heal via retry.
  it('retries still work under React 18 StrictMode (mountedRef restored on setup)', async () => {
    let saveAttempts = 0;
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'docx_open') return Promise.resolve(oneRevisionDoc());
      if (cmd === 'docx_resolve_revision') return Promise.resolve(resolvedDoc);
      if (cmd === 'docx_save') {
        saveAttempts += 1;
        return saveAttempts === 1
          ? Promise.reject(new Error('locked once'))
          : Promise.resolve(undefined);
      }
      return Promise.resolve(undefined);
    });

    render(
      <StrictMode>
        <TooltipProvider>
          <DocxEditor filePath="/ws/agreement.docx" fileName="agreement.docx" />
        </TooltipProvider>
      </StrictMode>,
    );
    await triggerSaveViaAccept();

    // The retry must fire despite StrictMode's dev double-mount and recover.
    await waitFor(
      () => expect(screen.getByTestId('auto-save-indicator')).toHaveAttribute('data-state', 'saved-recent'),
      { timeout: 8000 },
    );
    expect(saveAttempts).toBeGreaterThanOrEqual(2);
  }, 15000);

  // Coordinator P2 #2: the "Save a copy elsewhere" rescue must commit a focused,
  // un-blurred edit (and drain the op queue) BEFORE reading the doc, exactly like
  // the export path — the rescue copy is the one that must never omit the newest
  // text. Without the fix, the rescue writes the pre-edit doc.
  it('the rescue "Save a copy" commits an in-progress un-blurred edit before writing', async () => {
    const oneRunDoc: DocumentJson = {
      formatVersion: 1,
      body: [{ kind: 'paragraph', inlines: [{ kind: 'run', text: 'original text' }] }],
      comments: {},
    };
    saveDialogMock.mockReset();
    saveDialogMock.mockResolvedValue('/backup/rescued.docx');
    invokeMock.mockImplementation((cmd: string, args?: Record<string, unknown>) => {
      if (cmd === 'docx_open') return Promise.resolve(oneRunDoc);
      if (cmd === 'docx_save') {
        // Original stays locked (drives escalation); the rescue copy elsewhere works.
        return args?.['path'] === '/ws/agreement.docx'
          ? Promise.reject(new Error('locked'))
          : Promise.resolve(undefined);
      }
      return Promise.resolve(undefined);
    });

    renderEditor();
    const run = await screen.findByTestId('docx-run');
    fireEvent.click(screen.getByTestId('docx-reviewing-toggle'));

    // First edit + blur → commits → schedules a save that FAILS repeatedly → escalation.
    fireEvent.focus(run);
    run.textContent = 'original text EDIT1';
    fireEvent.blur(run);

    const rescue = await screen.findByTestId('docx-save-copy-elsewhere', undefined, { timeout: 12000 });

    // Second edit — focused, NOT blurred — must be folded in by the rescue's commit.
    fireEvent.focus(run);
    run.textContent = 'original text EDIT1 EDIT2';
    fireEvent.click(rescue);

    await waitFor(
      () =>
        expect(invokeMock).toHaveBeenCalledWith(
          'docx_save',
          expect.objectContaining({
            path: '/backup/rescued.docx',
            document: expect.objectContaining({
              body: [
                expect.objectContaining({
                  inlines: [expect.objectContaining({ text: expect.stringContaining('EDIT2') })],
                }),
              ],
            }),
          }),
        ),
      { timeout: 5000 },
    );
  }, 25000);

  // Cleanup batch 4 (task #24): the QA-34 fix covered a save that fails while
  // the user STAYS on the tab. This is the residual race it left open —
  // switching tabs away from a still-FAILING save used to unmount the editor
  // (killing its retry loop and its not-yet-persisted document), and
  // switching back re-read the file from disk, silently reloading stale
  // content over the unsaved edit. The fix: the save/retry state now lives in
  // a DocxSession keyed by path (docxSaveSession.ts) that outlives the
  // component, so a tab switch away no longer drops anything.
  it('switching tabs away from a FAILING save keeps it retrying and the doc intact — switching back resumes it without rereading disk', async () => {
    let saveAttempts = 0;
    let openCalls = 0;
    let saveShouldSucceed = false;
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'docx_open') {
        openCalls += 1;
        return Promise.resolve(oneRevisionDoc());
      }
      if (cmd === 'docx_resolve_revision') return Promise.resolve(resolvedDoc);
      if (cmd === 'docx_save') {
        saveAttempts += 1;
        return saveShouldSucceed
          ? Promise.resolve(undefined)
          : Promise.reject(new Error('The process cannot access the file (locked)'));
      }
      return Promise.resolve(undefined);
    });

    const { unmount } = renderEditor();
    await triggerSaveViaAccept();

    // The debounce (SAVE_DEBOUNCE_MS) delays the first save attempt, so this
    // needs a generous timeout — mirrors the other QA-34 tests above.
    await waitFor(
      () => expect(screen.getByTestId('auto-save-indicator')).toHaveAttribute('data-state', 'error'),
      { timeout: 4000 },
    );
    expect(openCalls).toBe(1);
    const attemptsBeforeSwitch = saveAttempts;
    expect(attemptsBeforeSwitch).toBeGreaterThanOrEqual(1);

    // Simulate switching tabs away: MainPanel stops rendering this DocxEditor
    // instance while the save is still failing.
    unmount();

    // The retry loop is owned by the session now, not the component — it
    // must keep firing in the background with no view mounted at all.
    await waitFor(() => expect(saveAttempts).toBeGreaterThan(attemptsBeforeSwitch), {
      timeout: 6000,
    });
    const attemptsWhileHidden = saveAttempts;

    // Switch back to the tab: a brand-new DocxEditor instance mounts for the
    // SAME path while the save is STILL failing/retrying.
    const { unmount: unmountResumed } = renderEditor();
    await screen.findByTestId('docx-editor');

    // Must resume the SAME in-memory (post-accept) document, not re-read the
    // file from disk — docx_open is never called a second time.
    expect(openCalls).toBe(1);
    // ...and it must show the truth immediately: still an error, never a
    // false "Saved", and never a "loading" reload-from-disk flash.
    await waitFor(() =>
      expect(screen.getByTestId('auto-save-indicator')).toHaveAttribute('data-state', 'error'),
    );
    expect(screen.queryByTestId('docx-editor-loading')).toBeNull();

    // The retry must still be live post-remount (it never stopped).
    await waitFor(() => expect(saveAttempts).toBeGreaterThan(attemptsWhileHidden), {
      timeout: 6000,
    });

    // Let the lock clear — the doc that survived the whole round trip finally
    // saves successfully, proving nothing was lost along the way.
    saveShouldSucceed = true;
    await waitFor(
      () => expect(screen.getByTestId('auto-save-indicator')).toHaveAttribute('data-state', 'saved-recent'),
      { timeout: 8000 },
    );

    // Explicitly unmount (rather than relying on RTL's implicit end-of-test
    // cleanup) and WAIT for its fire-and-forget disposal chain to settle
    // before this test ends — the disposal touches the MODULE-LEVEL session
    // registry, so leaving it racing in the background could otherwise bleed
    // into the next test's fresh session for the same path.
    unmountResumed();
    await waitFor(() => expect(isDocxRegistered('/ws/agreement.docx')).toBe(false));
  }, 20000);

  // Codex review catch (P2): a PARENT can reuse the SAME DocxEditor instance
  // for a DIFFERENT file without remounting it — no `key` tied to the path
  // (e.g. MeetingEntry swapping which meeting's notes.docx it shows via a
  // Client Map source-link click, with no key={meetingDir} upstream). Without
  // detaching from the old path's session on this transition, its later
  // background state changes would keep updating THIS view's save indicator
  // even though it's now displaying a completely different document.
  it('a filePath change WITHOUT unmount detaches from the old path — its state never bleeds into the new view', async () => {
    let bOpenCalls = 0;
    invokeMock.mockImplementation((cmd: string, args?: Record<string, unknown>) => {
      if (cmd === 'docx_open') {
        if (args?.['path'] === '/ws/b.docx') {
          bOpenCalls += 1;
          return Promise.resolve(resolvedDoc);
        }
        return Promise.resolve(oneRevisionDoc());
      }
      if (cmd === 'docx_resolve_revision') return Promise.resolve(resolvedDoc);
      if (cmd === 'docx_save') return Promise.reject(new Error('locked'));
      return Promise.resolve(undefined);
    });

    const { rerender } = render(
      <TooltipProvider>
        <DocxEditor filePath="/ws/a.docx" fileName="a.docx" />
      </TooltipProvider>,
    );
    await triggerSaveViaAccept();
    await waitFor(
      () => expect(screen.getByTestId('auto-save-indicator')).toHaveAttribute('data-state', 'error'),
      { timeout: 4000 },
    );

    await waitFor(() => expect(isDocxUnsaved('/ws/a.docx')).toBe(true));

    // The parent swaps to a DIFFERENT path on the SAME component instance —
    // no unmount, no new `renderEditor()`/`render()` call.
    rerender(
      <TooltipProvider>
        <DocxEditor filePath="/ws/b.docx" fileName="b.docx" />
      </TooltipProvider>,
    );

    // The view must settle on B's (clean) state — never show A's error.
    await waitFor(
      () => expect(screen.getByTestId('auto-save-indicator')).not.toHaveAttribute('data-state', 'error'),
      { timeout: 4000 },
    );
    // A's session is untouched by the transition — still retrying
    // independently in the background (the keep-alive contract holds); it
    // just no longer has a live view attached to report through.
    await waitFor(() => expect(isDocxUnsaved('/ws/a.docx')).toBe(true));

    // A's eventual background state changes must NOT reach this view, which
    // is now showing B. Give any wrongly-still-attached subscription a
    // window to misfire before asserting B's indicator is still untouched.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.getByTestId('auto-save-indicator')).not.toHaveAttribute('data-state', 'error');

    // Codex review catch (P1): B's session must still be the SAME one the
    // view attached to — never disposed out from under it by the old
    // cleanup's async chain racing the new load and reading stale refs
    // (which would show up here as a second, unexpected `docx_open` for B,
    // or B's registration disappearing).
    expect(bOpenCalls).toBe(1);
    expect(isDocxRegistered('/ws/b.docx')).toBe(true);
  }, 15000);

  // The explicit-discard behavior (closeDocxTabSafely's "close and lose
  // changes" path force-stopping the session's retry loop) is covered as a
  // focused unit test of the session module itself —
  // tests/unit/fileOps/docxSaveSession.test.ts — rather than here, since it
  // doesn't need a real DOM/React render to verify and a full-file run of
  // this suite's many multi-second real-timer tests made a React-level
  // version of it flaky in ways unrelated to the behavior under test.
});
