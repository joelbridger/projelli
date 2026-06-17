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

// --- AI redline mocks: deterministic edit list + a no-op provider factory.
// We mock the provider/network boundary so the test is hermetic; the engine
// call (docx_author_revisions) still flows through the real invokeMock so we
// assert the editor translates edits -> engine call correctly and renders the
// resulting tracked changes.
const requestRedlineEditsMock = vi.fn();
vi.mock('@/features/documents/docx/redline', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/documents/docx/redline')>();
  return {
    ...actual,
    requestRedlineEdits: (...args: unknown[]) => requestRedlineEditsMock(...args),
  };
});
vi.mock('@/platform/providers/providerFactory', () => ({
  createProvider: vi.fn(() => ({ structuredOutput: vi.fn() })),
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
vi.mock('@tauri-apps/plugin-fs', () => ({
  readFile: (...args: unknown[]) => readFileMock(...args),
}));
const saveFileMock = vi.fn();
vi.mock('@/platform/utils/saveFile', () => ({
  saveFile: (...args: unknown[]) => saveFileMock(...args),
}));

import { TooltipProvider } from '@/ui/tooltip';
import { DocxEditor } from '@/features/documents/media/DocxEditor';
import type { DocumentJson, DocxAiEdit } from '@/platform/types/docx';

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
    } as DocumentJson;

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
              meta: { id: '1', author: 'Keepance AI', date: '2026-06-09T00:00:00Z' },
              runs: [{ text: 'Vendor' }],
            },
            {
              kind: 'deletion',
              meta: { id: '1', author: 'Keepance AI', date: '2026-06-09T00:00:00Z' },
              runs: [{ text: 'Company' }],
            },
            { kind: 'run', text: ' shall indemnify the Client ' },
            {
              kind: 'deletion',
              meta: { id: '2', author: 'Keepance AI', date: '2026-06-09T00:00:00Z' },
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
    requestRedlineEditsMock.mockResolvedValue(TWO_EDITS);

    invokeMock.mockImplementation((cmd: string, args?: Record<string, unknown>) => {
      if (cmd === 'docx_open') return Promise.resolve(plainDoc());
      if (cmd === 'docx_author_revisions') {
        // Drift-safe contract: the editor applies BOTH edits against the
        // ORIGINAL doc in ONE engine call, attributed to Keepance AI.
        expect(args?.['document']).toEqual(plainDoc());
        expect(args?.['edits']).toEqual(TWO_EDITS);
        expect(args?.['author']).toBe('Keepance AI');
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
        expect.objectContaining({ author: 'Keepance AI' }),
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
    // The AI's insertion + deletions are attributed to Keepance AI.
    expect(screen.getByTestId('docx-insertion')).toHaveAttribute('data-author', 'Keepance AI');
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
    fireEvent.click(screen.getByTestId('docx-revise-with-ai'));
    fireEvent.change(await screen.findByTestId('docx-redline-input'), {
      target: { value: 'do something' },
    });
    // Key hint visible; submit disabled.
    expect(screen.getByTestId('docx-redline-need-key')).toBeInTheDocument();
    expect(screen.getByTestId('docx-redline-submit')).toBeDisabled();
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
    const trigger = await screen.findByTestId('docx-export');
    fireEvent.pointerDown(
      trigger,
      new MouseEvent('pointerdown', { bubbles: true }),
    );
    fireEvent.click(trigger);
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
