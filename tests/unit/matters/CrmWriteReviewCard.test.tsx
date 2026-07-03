// tests/unit/matters/CrmWriteReviewCard.test.tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

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
