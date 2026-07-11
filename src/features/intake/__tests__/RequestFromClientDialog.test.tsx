import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RequestFromClientDialog } from '../RequestFromClientDialog';
import { useBlueprintStore } from '@/platform/intake/blueprintStore';
import { intakeFactMatchList } from '@/platform/intake/factsStore';
import { sha256Hex } from '@/platform/intake/pdfTemplates/receipt';
import type { RequestBlueprint } from '@/platform/intake/blueprintTypes';
import type { PdfTemplateDescriptor } from '@/platform/intake/types';

const pdfTemplateStoreMock = vi.hoisted(() => ({
  getApprovedDescriptors: vi.fn(),
  loadSourceBytes: vi.fn(),
}));

vi.mock('@/platform/intake/factsStore', () => ({
  intakeFactMatchList: vi.fn(),
}));

vi.mock('@/platform/intake/pdfTemplateStore', () => {
  const state = {
    templatesById: {},
    importDraft: vi.fn(),
    updateDraft: vi.fn(),
    approveVersion: vi.fn(),
    getApprovedDescriptors: pdfTemplateStoreMock.getApprovedDescriptors,
    loadDescriptor: vi.fn(),
    loadSourceBytes: pdfTemplateStoreMock.loadSourceBytes,
    resetForTests: vi.fn(),
  };
  return {
    usePdfTemplateStore: <T,>(selector: (store: typeof state) => T): T => selector(state),
  };
});

afterEach(() => {
  useBlueprintStore.getState().resetForTests();
  localStorage.clear();
  vi.clearAllMocks();
});

const annualReview: RequestBlueprint = {
  blueprintId: 'annual-review', schemaVersion: 1, label: 'Annual review', source: 'firm_saved', defaultKind: 'standing',
  items: [
    {
      t: 'guided_question', item_id: 'income', label: 'Annual income', help_text: '', required: true,
      subject: 'household', prompt: 'What is annual income?', response_format: 'money', fact_kind: 'income_annual',
    },
    {
      t: 'doc_upload', item_id: 'statement', label: 'Account statement', help_text: 'Upload a recent statement.', required: true,
      subject: 'household', accepted_mime_types: ['application/pdf'],
    },
  ],
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

async function approvedTemplate(sourceBytes: Uint8Array): Promise<PdfTemplateDescriptor> {
  return {
    templateId: 'template_library_001', version: 1, kind: 'acroform', sourceSha256: await sha256Hex(sourceBytes),
    sourceArtifactRef: 'sealed-artifact:librarysource0001', outputFileStem: 'library-form', maxOutputBytes: 1024 * 1024,
    fields: {
      household_name: { kind: 'acroform', field_id: 'household_name', acroform_field: 'Household.Name', pdf_field_type: 'text' },
    },
  };
}

describe('RequestFromClientDialog', () => {
  it('edits a blueprint, suppresses an on-file fact, and sends a filtered standing request', async () => {
    vi.mocked(intakeFactMatchList).mockResolvedValue([
      { subject: 'household', kind: 'income_annual', status: 'active' },
    ]);
    const issueRequest = vi.fn().mockResolvedValue(undefined);
    const onOpenChange = vi.fn();

    render(
      <RequestFromClientDialog
        open
        onOpenChange={onOpenChange}
        matterId="matter-1"
        clientName="Avery Chen"
        blueprints={[annualReview]}
        issueRequest={issueRequest}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /annual review/i }));
    const labels = screen.getAllByLabelText('Label');
    const statementLabel = labels[1];
    if (!statementLabel) throw new Error('Expected account statement label input.');
    fireEvent.change(statementLabel, { target: { value: 'Most recent account statement' } });
    fireEvent.click(screen.getByRole('button', { name: 'Review request' }));

    expect(await screen.findByText(/Annual income: Already on file/i)).toBeTruthy();
    expect(screen.getByText('Most recent account statement')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Send request' }));

    await waitFor(() => {
      expect(issueRequest).toHaveBeenCalledTimes(1);
    });
    expect(issueRequest).toHaveBeenCalledWith(expect.objectContaining({
      matter_id: 'matter-1', kind: 'standing', blueprint_ref: 'annual-review',
      items: [expect.objectContaining({ item_id: 'statement', label: 'Most recent account statement' })],
    }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('allows an approved PDF item to be reviewed and sent', async () => {
    vi.mocked(intakeFactMatchList).mockResolvedValue([]);
    const issueRequest = vi.fn();
    const unsupportedBlueprint: RequestBlueprint = {
      blueprintId: 'pdf-update', schemaVersion: 1, label: 'PDF update', source: 'firm_saved', defaultKind: 'standing',
      items: [{
        t: 'pdf_fill', item_id: 'form', label: 'Custodian form', help_text: '', required: true, subject: 'primary',
        template: {
          templateId: 'template_dialog_01', version: 1, kind: 'acroform', sourceSha256: 'a'.repeat(64),
          sourceArtifactRef: 'sealed-artifact:dialogtemplate0001', outputFileStem: 'custodian-form', maxOutputBytes: 1024 * 1024,
          fields: {
            client_name: { kind: 'acroform', field_id: 'client_name', acroform_field: 'Client.Name', pdf_field_type: 'text' },
          },
        },
        prefill: [],
      }],
    };

    render(
      <RequestFromClientDialog
        open onOpenChange={vi.fn()} matterId="matter-1" clientName="Avery Chen"
        blueprints={[unsupportedBlueprint]} issueRequest={issueRequest}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /pdf update/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Review request' }));

    expect(await screen.findByText('Custodian form')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Send request' }).hasAttribute('disabled')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Send request' }));
    await waitFor(() => expect(issueRequest).toHaveBeenCalledWith(expect.objectContaining({
      items: [expect.objectContaining({ t: 'pdf_fill', prefill: [] })],
    })));
  });

  it('adds an approved library PDF with its verified source bytes', async () => {
    const sourceBytes = new TextEncoder().encode('dialog-source-pdf');
    const template = await approvedTemplate(sourceBytes);
    pdfTemplateStoreMock.getApprovedDescriptors.mockResolvedValue([template]);
    pdfTemplateStoreMock.loadSourceBytes.mockResolvedValue(sourceBytes);
    vi.mocked(intakeFactMatchList).mockResolvedValue([]);
    const issueRequest = vi.fn();

    render(
      <RequestFromClientDialog
        open onOpenChange={vi.fn()} matterId="matter-1" clientName="Avery Chen"
        blueprints={[annualReview]} issueRequest={issueRequest}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /annual review/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Add approved PDF form' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Add to request' }));
    await waitFor(() => expect(pdfTemplateStoreMock.loadSourceBytes).toHaveBeenCalledWith(template.templateId, template.version));
    fireEvent.click(screen.getByRole('button', { name: 'Review request' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Send request' }));

    await waitFor(() => expect(issueRequest).toHaveBeenCalledWith(expect.objectContaining({
      items: expect.arrayContaining([
        expect.objectContaining({
          t: 'pdf_fill',
          sealed_source_pdf_b64: btoa(String.fromCharCode(...sourceBytes)),
        }),
      ]),
    })));
  });

  it('shows an error and does not add a library PDF when its source bytes are unavailable', async () => {
    const template = await approvedTemplate(new TextEncoder().encode('dialog-source-pdf'));
    pdfTemplateStoreMock.getApprovedDescriptors.mockResolvedValue([template]);
    pdfTemplateStoreMock.loadSourceBytes.mockResolvedValue(null);
    vi.mocked(intakeFactMatchList).mockResolvedValue([]);
    const issueRequest = vi.fn();

    render(
      <RequestFromClientDialog
        open onOpenChange={vi.fn()} matterId="matter-1" clientName="Avery Chen"
        blueprints={[annualReview]} issueRequest={issueRequest}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /annual review/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Add approved PDF form' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Add to request' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('This approved PDF is unavailable on this device. It was not added to the request.');
    fireEvent.click(screen.getByRole('button', { name: 'Review request' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Send request' }));

    await waitFor(() => expect(issueRequest).toHaveBeenCalledWith(expect.objectContaining({
      items: expect.not.arrayContaining([expect.objectContaining({ t: 'pdf_fill' })]),
    })));
  });

  it('keeps signature items blocked in the review screen', async () => {
    vi.mocked(intakeFactMatchList).mockResolvedValue([]);
    const issueRequest = vi.fn();
    const signatureBlueprint: RequestBlueprint = {
      blueprintId: 'signature-request', schemaVersion: 1, label: 'Signature request', source: 'firm_saved', defaultKind: 'standing',
      items: [{ t: 'signature', item_id: 'signature', label: 'Sign form', help_text: '', required: true, subject: 'primary', grade: 'docusign' }],
    };
    render(<RequestFromClientDialog open onOpenChange={vi.fn()} matterId="matter-1" clientName="Avery Chen" blueprints={[signatureBlueprint]} issueRequest={issueRequest} />);
    fireEvent.click(screen.getByRole('button', { name: /signature request/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Review request' }));
    expect(await screen.findByText(/This item type isn.t supported yet/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Send request' }).hasAttribute('disabled')).toBe(true);
    expect(issueRequest).not.toHaveBeenCalled();
  });

  it('does not send a request when ask-once suppresses every item', async () => {
    vi.mocked(intakeFactMatchList).mockResolvedValue([
      { subject: 'household', kind: 'income_annual', status: 'active' },
    ]);
    const issueRequest = vi.fn();
    const [firstItem] = annualReview.items;
    if (!firstItem) throw new Error('Expected the annual review blueprint to have at least one item.');
    const onlyKnownFact: RequestBlueprint = {
      ...annualReview,
      blueprintId: 'income-only',
      label: 'Income only',
      items: [firstItem],
    };

    render(
      <RequestFromClientDialog
        open onOpenChange={vi.fn()} matterId="matter-1" clientName="Avery Chen"
        blueprints={[onlyKnownFact]} issueRequest={issueRequest}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /income only/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Review request' }));

    expect(await screen.findByText('Nothing needs to be requested right now.')).toBeTruthy();
    const sendButton = screen.getByRole('button', { name: 'Send request' });
    expect(sendButton.hasAttribute('disabled')).toBe(true);
    fireEvent.click(sendButton);
    expect(issueRequest).not.toHaveBeenCalled();
  });

  it('ignores an ask-once review that finishes after the advisor changes the draft', async () => {
    const matches = deferred<Awaited<ReturnType<typeof intakeFactMatchList>>>();
    vi.mocked(intakeFactMatchList).mockReturnValue(matches.promise);

    render(
      <RequestFromClientDialog
        open onOpenChange={vi.fn()} matterId="matter-1" clientName="Avery Chen"
        blueprints={[annualReview]} issueRequest={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /annual review/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Review request' }));
    const [firstLabel] = screen.getAllByLabelText('Label');
    if (!firstLabel) throw new Error('Expected at least one editable item label.');
    fireEvent.change(firstLabel, { target: { value: 'Updated annual income' } });
    matches.resolve([{ subject: 'household', kind: 'income_annual', status: 'active' }]);
    await matches.promise;
    await Promise.resolve();

    expect(screen.getByDisplayValue('Updated annual income')).toBeTruthy();
    expect(screen.queryByLabelText('Request review')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Send request' })).toBeNull();
  });
});
