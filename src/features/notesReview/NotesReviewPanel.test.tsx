import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';
import { NotesReviewPanel } from './NotesReviewPanel';
import { normalizeNotesReviewItems } from './normalizeNotesReviewItems';

describe('normalizeNotesReviewItems', () => {
  it('safely adapts template-shaped input and defaults unknown destinations to internal', () => {
    expect(normalizeNotesReviewItems([
      { itemId: 'follow-up', summary: 'Call the CPA', description: 'Confirm the estimated tax payment.', target: 'TASK', sourceRef: 'Annual review' },
      { id: 'fallback', title: 'Save planning note', output: 'new vendor output' },
      { blockId: 'decisions', label: 'Decisions', body: 'Move the rollover forward.', citations: [12000, 'bad'] },
      null,
      { id: 'missing-title' },
    ])).toEqual([
      { id: 'follow-up', title: 'Call the CPA', detail: 'Confirm the estimated tax payment.', destination: 'task', sourceLabel: 'Annual review' },
      { id: 'fallback', title: 'Save planning note', detail: 'Save planning note', destination: 'internal' },
      { id: 'decisions', title: 'Decisions', detail: 'Move the rollover forward.', destination: 'internal', sourceLabel: '12000' },
    ]);
  });
});

describe('NotesReviewPanel', () => {
  const item = { id: 'follow-up', title: 'Call the CPA', detail: 'Confirm the estimated tax payment.', destination: 'task' };

  it('requires an explicit approve click, sends the selected destination, and shows its receipt', async () => {
    const approve = vi.fn(() => Promise.resolve({ status: 'created' as const, message: 'Task added to the client plan.' }));
    render(<NotesReviewPanel rawItems={[item]} onApprove={approve} />);

    expect(approve).not.toHaveBeenCalled();
    fireEvent.change(screen.getByTestId('notes-review-destination-follow-up'), { target: { value: 'crm' } });
    expect(screen.getByTestId('notes-review-approve-follow-up')).toHaveTextContent('Approve crm update');
    fireEvent.click(screen.getByTestId('notes-review-approve-follow-up'));

    await waitFor(() => { expect(approve).toHaveBeenCalledWith({ ...item, destination: 'crm' }); });
    expect(screen.getByTestId('notes-review-receipt-follow-up')).toHaveTextContent('Task added to the client plan.');
    expect(screen.getByTestId('notes-review-item-follow-up')).toHaveTextContent('Approved');
  });

  it('does not claim delivery when the connected destination returns no receipt', async () => {
    render(<NotesReviewPanel rawItems={[item]} onApprove={() => Promise.resolve(undefined)} />);
    fireEvent.click(screen.getByTestId('notes-review-approve-follow-up'));

    expect(await screen.findByTestId('notes-review-receipt-follow-up')).toHaveTextContent('did not return a delivery receipt');
  });

  it('shows a failure beside the proposal and never turns it into an approval receipt', async () => {
    render(<NotesReviewPanel rawItems={[item]} onApprove={() => Promise.reject(new Error('CRM is unavailable. Nothing was sent.'))} />);
    fireEvent.click(screen.getByTestId('notes-review-approve-follow-up'));

    expect(await screen.findByTestId('notes-review-error-follow-up')).toHaveTextContent('CRM is unavailable. Nothing was sent.');
    expect(screen.queryByTestId('notes-review-receipt-follow-up')).toBeNull();
  });
});
