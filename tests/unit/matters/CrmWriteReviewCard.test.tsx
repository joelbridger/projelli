// tests/unit/matters/CrmWriteReviewCard.test.tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

vi.mock('@/platform/utils/wealthbox-commands', async () => {
  const actual = await vi.importActual<typeof import('@/platform/utils/wealthbox-commands')>(
    '@/platform/utils/wealthbox-commands',
  );
  return {
    ...actual,
    crmIsConnected: vi.fn().mockResolvedValue(true),
    crmCreateNote: vi.fn().mockResolvedValue({ remoteId: '555', deduped: false }),
    crmCreateTask: vi.fn().mockResolvedValue({ remoteId: '556', deduped: false }),
  };
});

import { CrmWriteReviewCard } from '@/features/matters/CrmWriteReviewCard';
import { useCrmWriteQueueStore } from '@/platform/state/crmWriteQueueStore';
import { useMatterStore } from '@/platform/matter/matterStore';
import { crmIsConnected, crmCreateNote } from '@/platform/utils/wealthbox-commands';

function resetStores() {
  useCrmWriteQueueStore.setState({ items: [] });
  useMatterStore.setState({ matters: [], activeMatterId: null });
}

beforeEach(() => {
  resetStores();
  vi.mocked(crmIsConnected).mockClear();
  vi.mocked(crmIsConnected).mockResolvedValue(true);
  vi.mocked(crmCreateNote).mockClear();
  vi.mocked(crmCreateNote).mockResolvedValue({ remoteId: '555', deduped: false });
});

describe('CrmWriteReviewCard', () => {
  it('renders nothing when the matter has no queued items', () => {
    useMatterStore.getState().createMatter({ name: 'Henderson', client: 'Henderson', crmHouseholdKeys: ['12345'] });
    const { container } = render(<CrmWriteReviewCard matterId="m-none" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows both proposed items once connected and expanded', async () => {
    const m = useMatterStore.getState().createMatter({
      name: 'Henderson',
      client: 'Henderson',
      crmHouseholdKeys: ['12345'],
    });
    useCrmWriteQueueStore.getState().enqueue({
      kind: 'note',
      matterId: m.id,
      title: 'Annual review — retirement readiness',
      body: 'Robert plans to retire in spring 2027.',
      sourceRef: 'doc:notes.docx',
    });
    useCrmWriteQueueStore.getState().enqueue({
      kind: 'task',
      matterId: m.id,
      title: 'Send Robert the Roth conversion illustration',
      body: 'Discussed during the meeting.',
      dueDate: '2026-07-07',
      sourceRef: 'transcript:12:04',
    });

    render(<CrmWriteReviewCard matterId={m.id} />);
    await waitFor(() => { expect(crmIsConnected).toHaveBeenCalled(); });

    fireEvent.click(screen.getByTestId('crm-write-card-collapsed'));

    expect(screen.getByText('Annual review — retirement readiness')).toBeInTheDocument();
    expect(screen.getByText('Send Robert the Roth conversion illustration')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /approve 2 changes/i })).toBeInTheDocument();
  });

  it('approve sends all checked items once, with the matter household key', async () => {
    const m = useMatterStore.getState().createMatter({
      name: 'Henderson',
      client: 'Henderson',
      crmHouseholdKeys: ['12345'],
    });
    useCrmWriteQueueStore.getState().enqueue({
      kind: 'note',
      matterId: m.id,
      title: 'Note title',
      body: 'Note body',
      sourceRef: 'doc:notes.docx',
    });

    render(<CrmWriteReviewCard matterId={m.id} />);
    await waitFor(() => { expect(crmIsConnected).toHaveBeenCalled(); });
    fireEvent.click(screen.getByTestId('crm-write-card-collapsed'));

    fireEvent.click(screen.getByRole('button', { name: /approve 1 change/i }));

    await waitFor(() => {
      expect(crmCreateNote).toHaveBeenCalledTimes(1);
    });
    expect(crmCreateNote).toHaveBeenCalledWith(
      expect.objectContaining({ householdKey: '12345', matterId: m.id, title: 'Note title', body: 'Note body' }),
    );
  });

  // Task 9b: optional compliance summary, off by default, riding the same card.
  it('files a compliance note when the toggle is checked at approve time', async () => {
    const m = useMatterStore.getState().createMatter({
      name: 'Henderson',
      client: 'Henderson',
      crmHouseholdKeys: ['12345'],
    });
    useCrmWriteQueueStore.getState().enqueue({
      kind: 'note',
      matterId: m.id,
      title: 'Note title',
      body: 'Note body',
      sourceRef: 'doc:notes.docx',
    });

    render(<CrmWriteReviewCard matterId={m.id} />);
    await waitFor(() => { expect(crmIsConnected).toHaveBeenCalled(); });
    fireEvent.click(screen.getByTestId('crm-write-card-collapsed'));

    fireEvent.click(screen.getByTestId('file-compliance-note'));
    fireEvent.click(screen.getByRole('button', { name: /approve 1 change/i }));

    await waitFor(() => {
      expect(crmCreateNote).toHaveBeenCalledTimes(1);
    });

    // The compliance note lands back in the queue as a new PROPOSED item —
    // it is never sent directly, only enqueued like everything else.
    await waitFor(() => {
      const items = useCrmWriteQueueStore.getState().items.filter((i) => i.matterId === m.id);
      const complianceItem = items.find((i) => i.title.includes('Compliance summary'));
      expect(complianceItem).toBeDefined();
      expect(complianceItem?.status).toBe('proposed');
    });
    // Only the original note was ever sent to Wealthbox — the compliance note
    // itself must NOT have been pushed as part of this same approval.
    expect(crmCreateNote).toHaveBeenCalledTimes(1);
  });

  it('does not file a compliance note when the toggle is left unchecked', async () => {
    const m = useMatterStore.getState().createMatter({
      name: 'Henderson',
      client: 'Henderson',
      crmHouseholdKeys: ['12345'],
    });
    useCrmWriteQueueStore.getState().enqueue({
      kind: 'note',
      matterId: m.id,
      title: 'Note title',
      body: 'Note body',
      sourceRef: 'doc:notes.docx',
    });

    render(<CrmWriteReviewCard matterId={m.id} />);
    await waitFor(() => { expect(crmIsConnected).toHaveBeenCalled(); });
    fireEvent.click(screen.getByTestId('crm-write-card-collapsed'));

    expect(screen.getByTestId('file-compliance-note')).not.toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: /approve 1 change/i }));

    await waitFor(() => { expect(crmCreateNote).toHaveBeenCalledTimes(1); });

    const items = useCrmWriteQueueStore.getState().items.filter((i) => i.matterId === m.id);
    expect(items.some((i) => i.title.includes('Compliance summary'))).toBe(false);
  });

  // Codex adversarial review catch (P2): a still-checked toggle must not
  // summarize its OWN compliance note on the next approval — that would
  // recurse indefinitely (a compliance note about a compliance note, forever).
  it('resets the compliance toggle after filing, so approving the filed note does not recurse', async () => {
    const m = useMatterStore.getState().createMatter({
      name: 'Henderson',
      client: 'Henderson',
      crmHouseholdKeys: ['12345'],
    });
    useCrmWriteQueueStore.getState().enqueue({
      kind: 'note',
      matterId: m.id,
      title: 'Note title',
      body: 'Note body',
      sourceRef: 'doc:notes.docx',
    });

    render(<CrmWriteReviewCard matterId={m.id} />);
    await waitFor(() => { expect(crmIsConnected).toHaveBeenCalled(); });
    fireEvent.click(screen.getByTestId('crm-write-card-collapsed'));

    fireEvent.click(screen.getByTestId('file-compliance-note'));
    fireEvent.click(screen.getByRole('button', { name: /approve 1 change/i }));

    await waitFor(() => {
      const items = useCrmWriteQueueStore.getState().items.filter((i) => i.matterId === m.id);
      expect(items.some((i) => i.title.includes('Compliance summary'))).toBe(true);
    });

    // The toggle must be OFF again — checked automatically right when the
    // enqueue is scheduled, well before the compliance note even lands.
    expect(screen.getByTestId('file-compliance-note')).not.toBeChecked();

    // Approving the newly-filed compliance note (toggle now off) must NOT
    // produce a second compliance note about the first one.
    fireEvent.click(screen.getByRole('button', { name: /approve 1 change/i }));
    await waitFor(() => { expect(crmCreateNote).toHaveBeenCalledTimes(2); });

    const finalItems = useCrmWriteQueueStore.getState().items.filter((i) => i.matterId === m.id);
    const complianceItems = finalItems.filter((i) => i.title.includes('Compliance summary'));
    expect(complianceItems).toHaveLength(1);
  });

  it('shows the link-first empty state and no Approve button when the matter has zero households', async () => {
    const m = useMatterStore.getState().createMatter({ name: 'Ortiz', client: 'Ortiz' });
    useCrmWriteQueueStore.getState().enqueue({
      kind: 'note',
      matterId: m.id,
      title: 'Note title',
      body: 'Note body',
      sourceRef: 'doc:notes.docx',
    });

    render(<CrmWriteReviewCard matterId={m.id} />);
    await waitFor(() => { expect(crmIsConnected).toHaveBeenCalled(); });
    fireEvent.click(screen.getByTestId('crm-write-card-collapsed'));

    expect(screen.getByText(/link this client to a wealthbox household first/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /approve/i })).not.toBeInTheDocument();
  });

  it('shows a household picker and disables Approve until one is chosen when the matter has two households', async () => {
    const m = useMatterStore.getState().createMatter({
      name: 'Henderson',
      client: 'Henderson',
      crmHouseholdKeys: ['111', '222'],
    });
    useCrmWriteQueueStore.getState().enqueue({
      kind: 'note',
      matterId: m.id,
      title: 'Note title',
      body: 'Note body',
      sourceRef: 'doc:notes.docx',
    });

    render(<CrmWriteReviewCard matterId={m.id} />);
    await waitFor(() => { expect(crmIsConnected).toHaveBeenCalled(); });
    fireEvent.click(screen.getByTestId('crm-write-card-collapsed'));

    const approveBtn = screen.getByRole('button', { name: /approve 1 change/i });
    expect(approveBtn).toBeDisabled();

    fireEvent.click(screen.getByTestId('crm-household-111'));
    expect(approveBtn).not.toBeDisabled();
  });

  // Codex adversarial review catch: a client mixed into another CRM's
  // household map (sfdc:/redtail:-prefixed keys) must not offer that
  // provider's id as a Wealthbox write target — this card is Wealthbox-only.
  it('filters out non-Wealthbox household keys (sfdc:/redtail: prefixes)', async () => {
    const m = useMatterStore.getState().createMatter({
      name: 'Henderson',
      client: 'Henderson',
      crmHouseholdKeys: ['12345', 'sfdc:001XYZ', 'redtail:rt-1'],
    });
    useCrmWriteQueueStore.getState().enqueue({
      kind: 'note',
      matterId: m.id,
      title: 'Note title',
      body: 'Note body',
      sourceRef: 'doc:notes.docx',
    });

    render(<CrmWriteReviewCard matterId={m.id} />);
    await waitFor(() => { expect(crmIsConnected).toHaveBeenCalled(); });
    fireEvent.click(screen.getByTestId('crm-write-card-collapsed'));

    // Exactly one (Wealthbox) household remains, so it auto-selects and no
    // picker/empty-state renders.
    expect(screen.queryByText(/link this client to a wealthbox household first/i)).not.toBeInTheDocument();
    expect(screen.queryByTestId('crm-household-sfdc:001XYZ')).not.toBeInTheDocument();
    expect(screen.queryByTestId('crm-household-redtail:rt-1')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /approve 1 change/i }));
    await waitFor(() => { expect(crmCreateNote).toHaveBeenCalledTimes(1); });
    expect(crmCreateNote).toHaveBeenCalledWith(expect.objectContaining({ householdKey: '12345' }));
  });

  // Codex adversarial review catch: a card that queued a write before
  // Wealthbox was connected must eventually notice the connection instead of
  // being stuck on the "Connect" hint until the page reloads.
  it('re-checks the connection while disconnected and recovers once connected', async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(crmIsConnected).mockResolvedValueOnce(false).mockResolvedValueOnce(true);
      const m = useMatterStore.getState().createMatter({
        name: 'Henderson',
        client: 'Henderson',
        crmHouseholdKeys: ['12345'],
      });
      useCrmWriteQueueStore.getState().enqueue({
        kind: 'note',
        matterId: m.id,
        title: 'Note title',
        body: 'Note body',
        sourceRef: 'doc:notes.docx',
      });

      render(<CrmWriteReviewCard matterId={m.id} />);
      // Flush the initial crmIsConnected() microtask + its state update.
      await act(async () => { await Promise.resolve(); });
      expect(crmIsConnected).toHaveBeenCalledTimes(1);
      expect(screen.getByText(/connect wealthbox to send/i)).toBeInTheDocument();

      // Fire the poll's setTimeout (scheduled under these same fake timers).
      await act(async () => { await vi.advanceTimersByTimeAsync(5000); });

      expect(crmIsConnected).toHaveBeenCalledTimes(2);
      expect(screen.queryByText(/connect wealthbox to send/i)).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  // Codex adversarial review catch (P1): reusing the same component instance
  // for a different client (no remount) must not carry over a selected
  // household from the PREVIOUS client — Approve could otherwise send the
  // new client's write into the old client's Wealthbox household.
  it('resets the selected household when matterId switches to a different client', async () => {
    const matterA = useMatterStore.getState().createMatter({
      name: 'Henderson',
      client: 'Henderson',
      crmHouseholdKeys: ['111', '222'],
    });
    const matterB = useMatterStore.getState().createMatter({
      name: 'Ortiz',
      client: 'Ortiz',
      crmHouseholdKeys: ['333', '444'],
    });
    useCrmWriteQueueStore.getState().enqueue({
      kind: 'note', matterId: matterA.id, title: 'A note', body: 'B', sourceRef: 'doc:a',
    });
    useCrmWriteQueueStore.getState().enqueue({
      kind: 'note', matterId: matterB.id, title: 'B note', body: 'B', sourceRef: 'doc:b',
    });

    const { rerender } = render(<CrmWriteReviewCard matterId={matterA.id} />);
    await waitFor(() => { expect(crmIsConnected).toHaveBeenCalled(); });
    fireEvent.click(screen.getByTestId('crm-write-card-collapsed'));
    fireEvent.click(screen.getByTestId('crm-household-111'));
    expect(screen.getByRole('button', { name: /approve 1 change/i })).not.toBeDisabled();

    // Same instance, switched to a different client with unrelated households.
    rerender(<CrmWriteReviewCard matterId={matterB.id} />);
    fireEvent.click(screen.getByTestId('crm-write-card-collapsed'));

    // Approve must be disabled again — no household carried over from A.
    expect(screen.getByRole('button', { name: /approve 1 change/i })).toBeDisabled();

    fireEvent.click(screen.getByTestId('crm-household-333'));
    fireEvent.click(screen.getByRole('button', { name: /approve 1 change/i }));
    await waitFor(() => { expect(crmCreateNote).toHaveBeenCalledTimes(1); });
    // The write that actually fired must target B's household, never A's.
    expect(crmCreateNote).toHaveBeenCalledWith(expect.objectContaining({ householdKey: '333', matterId: matterB.id }));
  });

  it('shows a connect-first hint and no card body when Wealthbox is not connected', async () => {
    vi.mocked(crmIsConnected).mockResolvedValue(false);
    const m = useMatterStore.getState().createMatter({
      name: 'Henderson',
      client: 'Henderson',
      crmHouseholdKeys: ['12345'],
    });
    useCrmWriteQueueStore.getState().enqueue({
      kind: 'note',
      matterId: m.id,
      title: 'Note title',
      body: 'Note body',
      sourceRef: 'doc:notes.docx',
    });

    render(<CrmWriteReviewCard matterId={m.id} />);
    await waitFor(() => {
      expect(screen.getByText(/connect wealthbox to send/i)).toBeInTheDocument();
    });
    expect(screen.queryByText('Note title')).not.toBeInTheDocument();
  });
});
