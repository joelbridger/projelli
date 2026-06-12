/**
 * DocxEditor — live co-editing wiring tests (Task 10).
 *
 * Tests that:
 * 1. Remote CRDT changes (session.onChange) re-render the document.
 * 2. Local run edits route to session.editRunText (not docxAuthorRevisions).
 * 3. Comments from the original docx_open are preserved on save in co-edit mode.
 * 4. The solo path is untouched when no coedit prop is provided.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import * as Y from 'yjs';
import {
  documentJsonToYDoc,
  yDocToDocumentJson,
} from '@/modules/coedit/docCrdt';
import type { DocumentJson } from '@/types/docx';
import type { CoeditSession } from '@/modules/coedit/coeditSession';

// --- Tauri mock (same as DocxEditor.test.tsx) ---
const invokeMock = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (cmd: string, args?: unknown) => invokeMock(cmd, args),
  isTauri: () => true,
}));

// --- Mock editRunText so we can spy on it without actually mutating the ydoc ---
const editRunTextMock = vi.fn();
vi.mock('@/modules/coedit/docCrdt', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/modules/coedit/docCrdt')>();
  return {
    ...actual,
    editRunText: (...args: unknown[]) => editRunTextMock(...args),
  };
});

// --- Other required mocks (matches DocxEditor.test.tsx) ---
vi.mock('@/modules/docx/redline', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/modules/docx/redline')>();
  return { ...actual, requestRedlineEdits: vi.fn() };
});
vi.mock('@/modules/models/providerFactory', () => ({
  createProvider: vi.fn(() => ({ structuredOutput: vi.fn() })),
  isLocalProviderId: (provider: string) => provider === 'ollama',
}));
vi.mock('@tauri-apps/plugin-dialog', () => ({ save: vi.fn() }));
vi.mock('@tauri-apps/plugin-fs', () => ({ readFile: vi.fn() }));
vi.mock('@/utils/saveFile', () => ({ saveFile: vi.fn() }));

import { TooltipProvider } from '@/components/ui/tooltip';
import { DocxEditor } from '@/components/media/DocxEditor';

// ---------------------------------------------------------------------------
// Test fixture
// ---------------------------------------------------------------------------

const TEST_DOC: DocumentJson = {
  formatVersion: 1,
  body: [
    {
      kind: 'paragraph',
      inlines: [{ kind: 'run', text: 'original text' }],
    },
  ],
  comments: {
    c1: { id: 'c1', author: 'Alice', date: '2026-01-01T00:00:00Z', text: 'A comment' },
  },
};

// ---------------------------------------------------------------------------
// Mock session factory
// ---------------------------------------------------------------------------

function makeMockSession(ydoc: Y.Doc) {
  let changeCallback: (() => void) | null = null;

  const session: CoeditSession = {
    doc: ydoc,
    getDocumentJson: () => yDocToDocumentJson(ydoc),
    onChange: (cb: () => void) => {
      changeCallback = cb;
      return () => { changeCallback = null; };
    },
    getOtherEditorCount: () => 0,
    onPresenceChange: (_cb: (otherCount: number) => void) => () => {},
    close: vi.fn(),
  };

  return {
    session,
    fireChange: () => { changeCallback?.(); },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setupInvokeMock() {
  invokeMock.mockImplementation((cmd: string) => {
    if (cmd === 'docx_open') return Promise.resolve(TEST_DOC);
    return Promise.resolve(undefined);
  });
}

function renderWithCoedit(session: CoeditSession) {
  return render(
    <TooltipProvider>
      <DocxEditor
        filePath="/ws/test.docx"
        fileName="test.docx"
        coedit={{ session }}
      />
    </TooltipProvider>,
  );
}

function renderSolo() {
  return render(
    <TooltipProvider>
      <DocxEditor filePath="/ws/test.docx" fileName="test.docx" />
    </TooltipProvider>,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DocxEditor — co-editing wiring', () => {
  beforeEach(() => {
    invokeMock.mockReset();
    editRunTextMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('1. remote CRDT change re-renders the document', async () => {
    setupInvokeMock();
    const ydoc = documentJsonToYDoc(TEST_DOC);
    const { session, fireChange } = makeMockSession(ydoc);
    renderWithCoedit(session);

    // Wait for initial load
    await screen.findByText('original text');

    // Mutate the Y.Doc to simulate a remote change
    act(() => {
      const body = ydoc.getArray<Y.Map<unknown>>('body');
      const block = body.toArray()[0]!;
      const runs = block.get('runs') as Y.Array<Y.Map<unknown>>;
      const run = runs.toArray()[0]!;
      const ytext = run.get('text') as Y.Text;
      ytext.insert(0, 'NEW ');
    });

    // Fire the onChange callback (simulates a remote update arriving)
    act(() => { fireChange(); });

    // The editor should re-render with the mutated text
    await screen.findByText('NEW original text');
  });

  it('2. local run edit routes to session.editRunText (not docxAuthorRevisions)', async () => {
    setupInvokeMock();
    const ydoc = documentJsonToYDoc(TEST_DOC);
    const { session } = makeMockSession(ydoc);
    renderWithCoedit(session);

    // Wait for the run to be rendered
    const runEl = await screen.findByTestId('docx-run');

    // Set the element's textContent and simulate blur
    runEl.textContent = 'changed text';
    act(() => {
      fireEvent.blur(runEl);
    });

    // editRunText should have been called (CRDT path)
    await waitFor(() => {
      expect(editRunTextMock).toHaveBeenCalled();
    });

    // docxAuthorRevisions should NOT have been called
    expect(invokeMock).not.toHaveBeenCalledWith('docx_author_revisions', expect.anything());
  });

  it('3. original comments from docx_open are preserved on save in co-edit mode', async () => {
    setupInvokeMock();
    const ydoc = documentJsonToYDoc(TEST_DOC);
    const { session } = makeMockSession(ydoc);
    renderWithCoedit(session);

    // Wait for initial load
    await screen.findByText('original text');

    // Simulate a run edit to trigger scheduleSave
    const runEl = screen.getByTestId('docx-run');
    runEl.textContent = 'changed text';
    act(() => {
      fireEvent.blur(runEl);
    });

    // editRunText (CRDT path) triggers scheduleSave via applyResolvedDocument
    await waitFor(() => {
      expect(editRunTextMock).toHaveBeenCalled();
    });

    // Wait for docx_save to be called with the original comments preserved
    // (debounce fires after ~1200ms; docxSave passes { path, document })
    await waitFor(
      () => {
        expect(invokeMock).toHaveBeenCalledWith(
          'docx_save',
          expect.objectContaining({
            document: expect.objectContaining({
              comments: expect.objectContaining({ c1: expect.anything() }),
            }),
          }),
        );
      },
      { timeout: 3000 },
    );
  });

  it('4. solo path unchanged: run edit calls docxAuthorRevisions, not editRunText', async () => {
    setupInvokeMock();
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'docx_open') return Promise.resolve(TEST_DOC);
      if (cmd === 'docx_author_revisions')
        return Promise.resolve({ document: TEST_DOC, results: [] });
      return Promise.resolve(undefined);
    });

    renderSolo();

    // Wait for the run to be rendered
    const runEl = await screen.findByTestId('docx-run');

    // Simulate a blur with new text (reviewing is ON by default → tracked change path)
    runEl.textContent = 'changed text';
    act(() => {
      fireEvent.blur(runEl);
    });

    // docxAuthorRevisions should have been called (solo tracked-change path)
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('docx_author_revisions', expect.anything());
    });

    // editRunText should NOT have been called
    expect(editRunTextMock).not.toHaveBeenCalled();
  });
});
