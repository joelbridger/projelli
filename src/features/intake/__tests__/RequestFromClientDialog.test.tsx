import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RequestFromClientDialog } from '../RequestFromClientDialog';
import { useBlueprintStore } from '@/platform/intake/blueprintStore';
import { intakeFactMatchList } from '@/platform/intake/factsStore';
import type { RequestBlueprint } from '@/platform/intake/blueprintTypes';

vi.mock('@/platform/intake/factsStore', () => ({
  intakeFactMatchList: vi.fn(),
}));

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

  it('blocks PDF and signature items in context before the issuer is called', async () => {
    vi.mocked(intakeFactMatchList).mockResolvedValue([]);
    const issueRequest = vi.fn();
    const unsupportedBlueprint: RequestBlueprint = {
      blueprintId: 'pdf-update', schemaVersion: 1, label: 'PDF update', source: 'firm_saved', defaultKind: 'standing',
      items: [{
        t: 'pdf_fill', item_id: 'form', label: 'Custodian form', help_text: '', required: true, subject: 'primary',
        pdf_ref: 'template.pdf', field_map: {}, prefill: [],
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
