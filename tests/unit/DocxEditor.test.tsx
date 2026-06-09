// Component tests for the new Word document editor (WS-A / A3).
//
// Strategy: mock `@tauri-apps/api/core` so `docx_open` returns a known DOM, the
// resolve commands return a transformed DOM, and `docx_save` is observable.
// Then assert: faithful rendering of runs / insertions / deletions / comments
// with the Word styling, and that the accept/reject flow swaps in the returned
// DOM and persists via docx_save.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react';

// --- Tauri mock: a programmable invoke that dispatches by command name. ----
const invokeMock = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (cmd: string, args?: unknown) => invokeMock(cmd, args),
  isTauri: () => true,
}));

import { TooltipProvider } from '@/components/ui/tooltip';
import { DocxEditor } from '@/components/media/DocxEditor';
import type { DocumentJson } from '@/types/docx';

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

// The DOM the editor renders comes from the mocked `docx_open`, so renderEditor
// just mounts the component; callers set up invokeMock to return their DOM.
function renderEditor() {
  return render(
    <TooltipProvider>
      <DocxEditor filePath="/ws/agreement.docx" fileName="agreement.docx" />
    </TooltipProvider>,
  );
}

describe('DocxEditor — rendering', () => {
  beforeEach(() => {
    invokeMock.mockReset();
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
      '@/components/media/DocxEditor'
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
