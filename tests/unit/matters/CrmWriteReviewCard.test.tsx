// tests/unit/matters/CrmWriteReviewCard.test.tsx
import '@/i18n';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { BRAND } from '@/config/brand';

// R5 (Tier B): the compliance-note default depends on the license tier — mock
// it so we can exercise both firm (practice) and solo defaults deterministically.
const licenseMock = vi.hoisted(() => ({ tier: 'personal' as string }));
vi.mock('@/platform/hooks/useLicense', () => ({
  useLicense: () => ({ tier: licenseMock.tier }),
}));

vi.mock('@/platform/utils/wealthbox-commands', async () => {
  const actual = await vi.importActual<typeof import('@/platform/utils/wealthbox-commands')>(
    '@/platform/utils/wealthbox-commands',
  );
  return {
    ...actual,
    crmIsConnected: vi.fn().mockResolvedValue(true),
    crmSaveWriteProposal: vi.fn().mockResolvedValue(null),
    crmPrepareWriteProposal: vi.fn().mockResolvedValue(null),
    crmApproveWriteProposal: vi.fn().mockResolvedValue({ remoteId: '555', deduped: false }),
    crmListWriteProposals: vi.fn().mockResolvedValue([]),
    crmDeleteWriteProposal: vi.fn().mockResolvedValue(undefined),
  };
});

import { CrmWriteReviewCard } from '@/features/matters/CrmWriteReviewCard';
import { useCrmWriteQueueStore } from '@/platform/state/crmWriteQueueStore';
import { useMatterStore } from '@/platform/matter/matterStore';
import {
  crmApproveWriteProposal,
  crmDeleteWriteProposal,
  crmIsConnected,
  crmListWriteProposals,
  crmPrepareWriteProposal,
  crmSaveWriteProposal,
} from '@/platform/utils/wealthbox-commands';

function resetStores() {
  useCrmWriteQueueStore.setState({ items: [] });
  useMatterStore.setState({ matters: [], activeMatterId: null });
}

beforeEach(() => {
  resetStores();
  localStorage.clear(); // R5: the solo compliance-note choice persists here — isolate tests
  licenseMock.tier = 'personal'; // default: solo (non-firm)
  vi.mocked(crmIsConnected).mockClear();
  vi.mocked(crmIsConnected).mockResolvedValue(true);
  vi.mocked(crmSaveWriteProposal).mockClear();
  vi.mocked(crmPrepareWriteProposal).mockClear();
  vi.mocked(crmApproveWriteProposal).mockClear();
  vi.mocked(crmListWriteProposals).mockClear();
  vi.mocked(crmDeleteWriteProposal).mockClear();
  vi.mocked(crmSaveWriteProposal).mockResolvedValue(null);
  vi.mocked(crmPrepareWriteProposal).mockResolvedValue(null);
  vi.mocked(crmApproveWriteProposal).mockResolvedValue({ remoteId: '555', deduped: false });
  vi.mocked(crmListWriteProposals).mockResolvedValue([]);
  vi.mocked(crmDeleteWriteProposal).mockResolvedValue(undefined);
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
    // QA-42: wait for the CARD ITSELF to render connected — not just for the
    // `crmIsConnected` mock to have been CALLED (see the other tests' comment
    // for the full race explanation).
    fireEvent.click(await screen.findByTestId('crm-write-card-collapsed'));

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
    const id = useCrmWriteQueueStore.getState().items[0]!.id;

    render(<CrmWriteReviewCard matterId={m.id} />);
    // QA-42: wait for the CARD ITSELF to render connected — not just for the
    // `crmIsConnected` mock to have been CALLED. The mock resolves on its own
    // microtask, so "called" can be observed before the resulting
    // `setConnected(true)` state update has actually landed in the DOM; that
    // race let this click occasionally fire while the card was still in its
    // pre-connected (null-render) state. Waiting for the actual element is
    // what guarantees the state update has already applied.
    fireEvent.click(await screen.findByTestId('crm-write-card-collapsed'));

    fireEvent.click(screen.getByRole('button', { name: /approve 1 change/i }));

    await waitFor(() => {
      expect(crmApproveWriteProposal).toHaveBeenCalledTimes(1);
    });
    expect(crmApproveWriteProposal).toHaveBeenCalledWith(id);
    expect(crmPrepareWriteProposal).toHaveBeenCalledWith(
      expect.objectContaining({ proposalId: id, householdKey: '12345' }),
    );
    expect(crmSaveWriteProposal).toHaveBeenCalledWith(
      expect.objectContaining({ id, matterId: m.id, title: 'Note title', body: 'Note body' }),
    );
    // The queue store (not the card) owns requestedAt generation, but the
    // full click-to-invoke path must still carry it through.
    expect(crmPrepareWriteProposal).toHaveBeenCalledWith(
      expect.objectContaining({ requestedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/) }),
    );
    await waitFor(() => {
      expect(screen.getByTestId('crm-write-approval-receipt').textContent).toContain(
        `Approved 1 change to Wealthbox; sent direct to Wealthbox; nothing to ${BRAND.name}.`,
      );
    });
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
    // QA-42: wait for the CARD ITSELF to render connected — not just for the
    // `crmIsConnected` mock to have been CALLED. The mock resolves on its own
    // microtask, so "called" can be observed before the resulting
    // `setConnected(true)` state update has actually landed in the DOM; that
    // race let this click occasionally fire while the card was still in its
    // pre-connected (null-render) state. Waiting for the actual element is
    // what guarantees the state update has already applied.
    fireEvent.click(await screen.findByTestId('crm-write-card-collapsed'));

    fireEvent.click(screen.getByTestId('file-compliance-note'));
    fireEvent.click(screen.getByRole('button', { name: /approve 1 change/i }));

    await waitFor(() => {
      expect(crmApproveWriteProposal).toHaveBeenCalledTimes(1);
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
    expect(crmApproveWriteProposal).toHaveBeenCalledTimes(1);
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
    // QA-42: wait for the CARD ITSELF to render connected — not just for the
    // `crmIsConnected` mock to have been CALLED. The mock resolves on its own
    // microtask, so "called" can be observed before the resulting
    // `setConnected(true)` state update has actually landed in the DOM; that
    // race let this click occasionally fire while the card was still in its
    // pre-connected (null-render) state. Waiting for the actual element is
    // what guarantees the state update has already applied.
    fireEvent.click(await screen.findByTestId('crm-write-card-collapsed'));

    expect(screen.getByTestId('file-compliance-note')).not.toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: /approve 1 change/i }));

    await waitFor(() => { expect(crmApproveWriteProposal).toHaveBeenCalledTimes(1); });

    const items = useCrmWriteQueueStore.getState().items.filter((i) => i.matterId === m.id);
    expect(items.some((i) => i.title.includes('Compliance summary'))).toBe(false);
  });

  // R5 (Tier B): in a firm the compliance note is supervisory and shouldn't be
  // opt-in — it defaults ON for the practice (firm) tier.
  it('defaults the compliance note ON for the firm (practice) tier', async () => {
    licenseMock.tier = 'practice';
    const m = useMatterStore.getState().createMatter({ name: 'Henderson', client: 'Henderson', crmHouseholdKeys: ['12345'] });
    useCrmWriteQueueStore.getState().enqueue({ kind: 'note', matterId: m.id, title: 'T', body: 'B', sourceRef: 'doc:notes.docx' });
    render(<CrmWriteReviewCard matterId={m.id} />);
    await waitFor(() => { expect(crmIsConnected).toHaveBeenCalled(); });
    fireEvent.click(screen.getByTestId('crm-write-card-collapsed'));
    expect(screen.getByTestId('file-compliance-note')).toBeChecked();
  });

  // R5: solo advisors keep their own choice, and it's remembered across mounts.
  it('remembers a solo advisor\'s compliance-note choice across mounts', async () => {
    const m = useMatterStore.getState().createMatter({ name: 'Henderson', client: 'Henderson', crmHouseholdKeys: ['12345'] });
    useCrmWriteQueueStore.getState().enqueue({ kind: 'note', matterId: m.id, title: 'T', body: 'B', sourceRef: 'doc:notes.docx' });
    const { unmount } = render(<CrmWriteReviewCard matterId={m.id} />);
    await waitFor(() => { expect(crmIsConnected).toHaveBeenCalled(); });
    fireEvent.click(screen.getByTestId('crm-write-card-collapsed'));
    // Off by default for solo, then the advisor turns it on.
    expect(screen.getByTestId('file-compliance-note')).not.toBeChecked();
    fireEvent.click(screen.getByTestId('file-compliance-note'));
    unmount();

    // A fresh mount defaults to the remembered ON choice.
    render(<CrmWriteReviewCard matterId={m.id} />);
    await waitFor(() => { expect(crmIsConnected).toHaveBeenCalled(); });
    fireEvent.click(screen.getByTestId('crm-write-card-collapsed'));
    expect(screen.getByTestId('file-compliance-note')).toBeChecked();
  });

  // E3 (Tier B): a note AI-drafted from a meeting carries an honest provenance
  // line into the CRM write on approve.
  it('attaches an AI provenance line to a meeting-drafted note on approve', async () => {
    const m = useMatterStore.getState().createMatter({ name: 'Henderson', client: 'Henderson', crmHouseholdKeys: ['12345'] });
    useCrmWriteQueueStore.getState().enqueue({
      kind: 'note',
      matterId: m.id,
      title: 'Meeting recap',
      body: 'Discussed the rollover.',
      sourceRef: 'doc:Clients/Henderson/Meetings/2026-07-02-x/notes.docx',
      aiSource: { kind: 'meeting', date: '2026-07-02' },
    });
    render(<CrmWriteReviewCard matterId={m.id} />);
    await waitFor(() => { expect(crmIsConnected).toHaveBeenCalled(); });
    fireEvent.click(screen.getByTestId('crm-write-card-collapsed'));
    fireEvent.click(screen.getByRole('button', { name: /approve 1 change/i }));
    await waitFor(() => { expect(crmApproveWriteProposal).toHaveBeenCalledTimes(1); });
    const arg = vi.mocked(crmPrepareWriteProposal).mock.calls[0]![0] as { provenance?: string };
    expect(arg.provenance).toBeTruthy();
    expect(arg.provenance).toContain(BRAND.messaging.redlineAuthor);
    expect(arg.provenance?.toLowerCase()).toContain('meeting');
  });

  // Codex adversarial review catch (P2): a still-checked toggle must not
  // summarize its OWN compliance note on the next approval — that would
  // recurse indefinitely (a compliance note about a compliance note, forever).
  // R5 (coordinator review): in FIRM tier the compliance toggle re-defaults ON
  // after an approval (so a SECOND update in the same card still files the
  // supervisory note), and approving the just-filed compliance note does NOT
  // recurse into a second one — recursion is prevented by excluding
  // compliance-sourced items from the summary, independent of the toggle.
  it('keeps the compliance default ON for a second firm-tier update, without recursing', async () => {
    licenseMock.tier = 'practice';
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
    // QA-42: wait for the CARD ITSELF to render connected — not just for the
    // `crmIsConnected` mock to have been CALLED. The mock resolves on its own
    // microtask, so "called" can be observed before the resulting
    // `setConnected(true)` state update has actually landed in the DOM; that
    // race let this click occasionally fire while the card was still in its
    // pre-connected (null-render) state. Waiting for the actual element is
    // what guarantees the state update has already applied.
    fireEvent.click(await screen.findByTestId('crm-write-card-collapsed'));

    // Firm tier: the toggle is already ON by default.
    expect(screen.getByTestId('file-compliance-note')).toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: /approve 1 change/i }));

    await waitFor(() => {
      const items = useCrmWriteQueueStore.getState().items.filter((i) => i.matterId === m.id);
      expect(items.some((i) => i.title.includes('Compliance summary'))).toBe(true);
    });

    // Coordinator fix: the toggle stays ON (re-derived from the firm default),
    // so a second real update still gets a supervisory note — it did NOT reset
    // to unchecked.
    expect(screen.getByTestId('file-compliance-note')).toBeChecked();

    // Approving the newly-filed compliance note (toggle still ON) must NOT
    // produce a second compliance note about the first one.
    fireEvent.click(screen.getByRole('button', { name: /approve 1 change/i }));
    await waitFor(() => { expect(crmApproveWriteProposal).toHaveBeenCalledTimes(2); });

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
    // QA-42: wait for the CARD ITSELF to render connected — not just for the
    // `crmIsConnected` mock to have been CALLED. The mock resolves on its own
    // microtask, so "called" can be observed before the resulting
    // `setConnected(true)` state update has actually landed in the DOM; that
    // race let this click occasionally fire while the card was still in its
    // pre-connected (null-render) state. Waiting for the actual element is
    // what guarantees the state update has already applied.
    fireEvent.click(await screen.findByTestId('crm-write-card-collapsed'));

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
    // QA-42: wait for the CARD ITSELF to render connected — not just for the
    // `crmIsConnected` mock to have been CALLED. The mock resolves on its own
    // microtask, so "called" can be observed before the resulting
    // `setConnected(true)` state update has actually landed in the DOM; that
    // race let this click occasionally fire while the card was still in its
    // pre-connected (null-render) state. Waiting for the actual element is
    // what guarantees the state update has already applied.
    fireEvent.click(await screen.findByTestId('crm-write-card-collapsed'));

    const approveBtn = screen.getByRole('button', { name: /approve 1 change/i });
    expect(approveBtn).toBeDisabled();

    fireEvent.click(screen.getByTestId('crm-write-review-household-111'));
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
    const id = useCrmWriteQueueStore.getState().items[0]!.id;

    render(<CrmWriteReviewCard matterId={m.id} />);
    // QA-42: wait for the CARD ITSELF to render connected — not just for the
    // `crmIsConnected` mock to have been CALLED. The mock resolves on its own
    // microtask, so "called" can be observed before the resulting
    // `setConnected(true)` state update has actually landed in the DOM; that
    // race let this click occasionally fire while the card was still in its
    // pre-connected (null-render) state. Waiting for the actual element is
    // what guarantees the state update has already applied.
    fireEvent.click(await screen.findByTestId('crm-write-card-collapsed'));

    // Exactly one (Wealthbox) household remains, so it auto-selects and no
    // picker/empty-state renders.
    expect(screen.queryByText(/link this client to a wealthbox household first/i)).not.toBeInTheDocument();
    expect(screen.queryByTestId('crm-write-review-household-sfdc:001XYZ')).not.toBeInTheDocument();
    expect(screen.queryByTestId('crm-write-review-household-redtail:rt-1')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /approve 1 change/i }));
    await waitFor(() => { expect(crmApproveWriteProposal).toHaveBeenCalledTimes(1); });
    expect(crmApproveWriteProposal).toHaveBeenCalledWith(id);
    expect(crmPrepareWriteProposal).toHaveBeenCalledWith(
      expect.objectContaining({ proposalId: id, householdKey: '12345' }),
    );
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
    const matterBProposalId = useCrmWriteQueueStore.getState().items.find((item) => item.matterId === matterB.id)!.id;

    const { rerender } = render(<CrmWriteReviewCard matterId={matterA.id} />);
    // QA-42: wait for the CARD ITSELF to render connected — not just for the
    // `crmIsConnected` mock to have been CALLED. The mock resolves on its own
    // microtask, so "called" can be observed before the resulting
    // `setConnected(true)` state update has actually landed in the DOM; that
    // race let this click occasionally fire while the card was still in its
    // pre-connected (null-render) state. Waiting for the actual element is
    // what guarantees the state update has already applied.
    fireEvent.click(await screen.findByTestId('crm-write-card-collapsed'));
    fireEvent.click(screen.getByTestId('crm-write-review-household-111'));
    expect(screen.getByRole('button', { name: /approve 1 change/i })).not.toBeDisabled();

    // Same instance, switched to a different client with unrelated households.
    rerender(<CrmWriteReviewCard matterId={matterB.id} />);
    fireEvent.click(screen.getByTestId('crm-write-card-collapsed'));

    // Approve must be disabled again — no household carried over from A.
    expect(screen.getByRole('button', { name: /approve 1 change/i })).toBeDisabled();

    fireEvent.click(screen.getByTestId('crm-write-review-household-333'));
    fireEvent.click(screen.getByRole('button', { name: /approve 1 change/i }));
    await waitFor(() => { expect(crmApproveWriteProposal).toHaveBeenCalledTimes(1); });
    // The write that actually fired must target B's household, never A's.
    expect(crmApproveWriteProposal).toHaveBeenCalledWith(matterBProposalId);
    expect(crmPrepareWriteProposal).toHaveBeenCalledWith(
      expect.objectContaining({ proposalId: matterBProposalId, householdKey: '333' }),
    );
  });

  it('shows a connect-first hint, and no approve/edit controls, when Wealthbox is not connected', async () => {
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
    expect(screen.queryByRole('button', { name: /approve/i })).not.toBeInTheDocument();
  });

  // Codex review catch (P2): now that the queue persists across restarts,
  // an item stuck while Wealthbox is disconnected must not become
  // permanently undismissable — the disconnected view used to render only
  // the static hint, with no way to clear anything until reconnecting.
  it('still offers a Dismiss action per queued item while Wealthbox is disconnected', async () => {
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
    const id = useCrmWriteQueueStore.getState().items[0]!.id;

    render(<CrmWriteReviewCard matterId={m.id} />);
    await waitFor(() => {
      expect(screen.getByText(/connect wealthbox to send/i)).toBeInTheDocument();
    });
    expect(screen.getByText('Note title')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));
    await waitFor(() => {
      expect(useCrmWriteQueueStore.getState().items.find((i) => i.id === id)).toBeUndefined();
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Task 9c: field-level blended updates, 3-column review. Same-card reuse per
// the design constitution: no new surface, no new card — the existing rows
// widen for this one kind.
// ─────────────────────────────────────────────────────────────────────────

function enqueueFieldItem(matterId: string, overrides: Record<string, unknown> = {}) {
  useCrmWriteQueueStore.getState().enqueue({
    kind: 'field',
    matterId,
    title: 'Background information',
    body: '',
    field: 'background_information',
    existingValue: 'Robert owns a rental property.',
    newValue: 'Retiring spring 2027.',
    finalValue: 'Robert owns a rental property. Retiring spring 2027.',
    sourceRef: 'meeting:2026-06-30',
    ...overrides,
  } as never);
}

describe('CrmWriteReviewCard — field updates (Task 9c)', () => {
  // Self-found while converging on Codex's round-2 pass (it flagged
  // summaryLabel as a maybe, not a formal finding): a queue with ONLY field
  // items must not render a blank collapsed summary ("" + " ready for
  // review" reading as a stray leading space).
  it('the collapsed summary counts field updates too (no blank label for a field-only queue)', async () => {
    const m = useMatterStore.getState().createMatter({
      name: 'Henderson',
      client: 'Henderson',
      crmHouseholdKeys: ['12345'],
    });
    enqueueFieldItem(m.id);

    render(<CrmWriteReviewCard matterId={m.id} />);
    // QA-42: wait for the actual summary text, not just for the
    // `crmIsConnected` mock to have been called — same race as the other
    // tests' comment (the mock's resolution and the resulting `setConnected`
    // state update aren't guaranteed to have landed just because it was
    // invoked).
    expect(await screen.findByText('1 field update ready for review')).toBeInTheDocument();
  });

  it('renders three labeled columns for a field item: Existing / From this meeting / Blended', async () => {
    const m = useMatterStore.getState().createMatter({
      name: 'Henderson',
      client: 'Henderson',
      crmHouseholdKeys: ['12345'],
    });
    enqueueFieldItem(m.id);

    render(<CrmWriteReviewCard matterId={m.id} />);
    // QA-42: wait for the CARD ITSELF to render connected — not just for the
    // `crmIsConnected` mock to have been CALLED. The mock resolves on its own
    // microtask, so "called" can be observed before the resulting
    // `setConnected(true)` state update has actually landed in the DOM; that
    // race let this click occasionally fire while the card was still in its
    // pre-connected (null-render) state. Waiting for the actual element is
    // what guarantees the state update has already applied.
    fireEvent.click(await screen.findByTestId('crm-write-card-collapsed'));

    const item = useCrmWriteQueueStore.getState().items[0]!;
    expect(screen.getByText(/existing/i)).toBeInTheDocument();
    expect(screen.getByText(/from this meeting/i)).toBeInTheDocument();
    expect(screen.getByText(/blended/i)).toBeInTheDocument();
    expect(screen.getByTestId(`crm-field-existing-${item.id}`)).toHaveTextContent('Robert owns a rental property.');
    expect(screen.getByTestId(`crm-field-new-${item.id}`)).toHaveTextContent('Retiring spring 2027.');
  });

  it('only the Blended column is editable; Existing/New are read-only reference', async () => {
    const m = useMatterStore.getState().createMatter({
      name: 'Henderson',
      client: 'Henderson',
      crmHouseholdKeys: ['12345'],
    });
    enqueueFieldItem(m.id);

    render(<CrmWriteReviewCard matterId={m.id} />);
    // QA-42: wait for the CARD ITSELF to render connected — not just for the
    // `crmIsConnected` mock to have been CALLED. The mock resolves on its own
    // microtask, so "called" can be observed before the resulting
    // `setConnected(true)` state update has actually landed in the DOM; that
    // race let this click occasionally fire while the card was still in its
    // pre-connected (null-render) state. Waiting for the actual element is
    // what guarantees the state update has already applied.
    fireEvent.click(await screen.findByTestId('crm-write-card-collapsed'));

    const item = useCrmWriteQueueStore.getState().items[0]!;
    const blended = screen.getByTestId(`crm-field-blended-${item.id}`);
    expect(blended.tagName).toMatch(/TEXTAREA|INPUT/);
    expect(blended).not.toHaveAttribute('readonly');
    expect(blended).not.toHaveAttribute('disabled');

    const existing = screen.getByTestId(`crm-field-existing-${item.id}`);
    const fresh = screen.getByTestId(`crm-field-new-${item.id}`);
    // Reference columns are plain text, not form controls at all.
    expect(existing.tagName).not.toMatch(/TEXTAREA|INPUT/);
    expect(fresh.tagName).not.toMatch(/TEXTAREA|INPUT/);
  });

  it('editing the Blended column updates the store\'s finalValue for that item', async () => {
    const m = useMatterStore.getState().createMatter({
      name: 'Henderson',
      client: 'Henderson',
      crmHouseholdKeys: ['12345'],
    });
    enqueueFieldItem(m.id);

    render(<CrmWriteReviewCard matterId={m.id} />);
    // QA-42: wait for the CARD ITSELF to render connected — not just for the
    // `crmIsConnected` mock to have been CALLED. The mock resolves on its own
    // microtask, so "called" can be observed before the resulting
    // `setConnected(true)` state update has actually landed in the DOM; that
    // race let this click occasionally fire while the card was still in its
    // pre-connected (null-render) state. Waiting for the actual element is
    // what guarantees the state update has already applied.
    fireEvent.click(await screen.findByTestId('crm-write-card-collapsed'));

    const item = useCrmWriteQueueStore.getState().items[0]!;
    const blended = screen.getByTestId(`crm-field-blended-${item.id}`);
    fireEvent.change(blended, { target: { value: 'Edited by the advisor.' } });

    await waitFor(() => {
      expect(useCrmWriteQueueStore.getState().items[0]!.finalValue).toBe('Edited by the advisor.');
    });
  });

  it('Approve is disabled while a selected field item\'s finalValue is blank', async () => {
    const m = useMatterStore.getState().createMatter({
      name: 'Henderson',
      client: 'Henderson',
      crmHouseholdKeys: ['12345'],
    });
    enqueueFieldItem(m.id, { finalValue: '' });

    render(<CrmWriteReviewCard matterId={m.id} />);
    // QA-42: wait for the CARD ITSELF to render connected — not just for the
    // `crmIsConnected` mock to have been CALLED. The mock resolves on its own
    // microtask, so "called" can be observed before the resulting
    // `setConnected(true)` state update has actually landed in the DOM; that
    // race let this click occasionally fire while the card was still in its
    // pre-connected (null-render) state. Waiting for the actual element is
    // what guarantees the state update has already applied.
    fireEvent.click(await screen.findByTestId('crm-write-card-collapsed'));

    expect(screen.getByRole('button', { name: /approve 1 change/i })).toBeDisabled();
  });

  it('Approve enables once the Blended column is filled in and approves the saved field proposal', async () => {
    const m = useMatterStore.getState().createMatter({
      name: 'Henderson',
      client: 'Henderson',
      crmHouseholdKeys: ['12345'],
    });
    enqueueFieldItem(m.id, { finalValue: '' });

    render(<CrmWriteReviewCard matterId={m.id} />);
    // QA-42: wait for the CARD ITSELF to render connected — not just for the
    // `crmIsConnected` mock to have been CALLED. The mock resolves on its own
    // microtask, so "called" can be observed before the resulting
    // `setConnected(true)` state update has actually landed in the DOM; that
    // race let this click occasionally fire while the card was still in its
    // pre-connected (null-render) state. Waiting for the actual element is
    // what guarantees the state update has already applied.
    fireEvent.click(await screen.findByTestId('crm-write-card-collapsed'));

    const item = useCrmWriteQueueStore.getState().items[0]!;
    fireEvent.change(screen.getByTestId(`crm-field-blended-${item.id}`), {
      target: { value: 'Robert owns a rental property. Retiring spring 2027.' },
    });

    const approveBtn = screen.getByRole('button', { name: /approve 1 change/i });
    await waitFor(() => { expect(approveBtn).not.toBeDisabled(); });
    fireEvent.click(approveBtn);

    await waitFor(() => { expect(crmApproveWriteProposal).toHaveBeenCalledTimes(1); });
    expect(crmApproveWriteProposal).toHaveBeenCalledWith(item.id);
    expect(crmSaveWriteProposal).toHaveBeenCalledWith(
      expect.objectContaining({
        id: item.id,
        kind: 'field',
        matterId: m.id,
        householdKey: '12345',
        field: 'background_information',
        finalValue: 'Robert owns a rental property. Retiring spring 2027.',
      }),
    );
  });

  // Corrected once the real Rust contract landed: the backend's stale-guard
  // is a DISTINCT error/status ('stale'), not the generic 'verify_pending'
  // ambiguous-delivery case — see CrmWriteError::StaleFieldValue in
  // src-tauri/src/commands/crm/write.rs.
  it('a stale field item shows the re-review message with a Retry button', async () => {
    const m = useMatterStore.getState().createMatter({
      name: 'Henderson',
      client: 'Henderson',
      crmHouseholdKeys: ['12345'],
    });
    enqueueFieldItem(m.id);
    const id = useCrmWriteQueueStore.getState().items[0]!.id;
    // enqueue() always starts an item at 'proposed' (status isn't a caller
    // input) — force the stale-guard state directly, same as the store's own
    // tests reach it via a rejected wrapper call.
    useCrmWriteQueueStore.setState((s) => ({
      items: s.items.map((i) =>
        i.id === id
          ? { ...i, status: 'stale', error: 'this field changed in the CRM since the proposal — current value: Fresh live value.' }
          : i,
      ),
    }));

    render(<CrmWriteReviewCard matterId={m.id} />);
    // QA-42: wait for the CARD ITSELF to render connected — not just for the
    // `crmIsConnected` mock to have been CALLED. The mock resolves on its own
    // microtask, so "called" can be observed before the resulting
    // `setConnected(true)` state update has actually landed in the DOM; that
    // race let this click occasionally fire while the card was still in its
    // pre-connected (null-render) state. Waiting for the actual element is
    // what guarantees the state update has already applied.
    fireEvent.click(await screen.findByTestId('crm-write-card-collapsed'));

    expect(screen.getByText(/review again/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
  });

  // Coordinator review catch (P2): a stale item that stayed checked with its
  // OLD (pre-drift) blend meant one Approve click could silently overwrite
  // the concurrent CRM edit the moment a retry's re-fetched existingValue
  // happened to match the (by-then-stable) live value — the advisor never
  // got a chance to look at what changed. Drives the real approve() → reject
  // → 'stale' transition (not a forced setState) so this exercises the same
  // render-time detection the fix actually relies on.
  it('a field item that goes stale mid-review is deselected and excluded from the next Approve', async () => {
    const m = useMatterStore.getState().createMatter({
      name: 'Henderson',
      client: 'Henderson',
      crmHouseholdKeys: ['12345'],
    });
    enqueueFieldItem(m.id);
    enqueueFieldItem(m.id, { title: 'Unrelated note-ish field', sourceRef: 'meeting:2026-07-01' });
    vi.mocked(crmApproveWriteProposal).mockRejectedValueOnce(
      new Error(
        'this field changed in the CRM since the proposal — current value: Robert owns a rental property and a beach condo too.',
      ),
    );

    render(<CrmWriteReviewCard matterId={m.id} />);
    // QA-42: wait for the CARD ITSELF to render connected — not just for the
    // `crmIsConnected` mock to have been CALLED. The mock resolves on its own
    // microtask, so "called" can be observed before the resulting
    // `setConnected(true)` state update has actually landed in the DOM; that
    // race let this click occasionally fire while the card was still in its
    // pre-connected (null-render) state. Waiting for the actual element is
    // what guarantees the state update has already applied.
    fireEvent.click(await screen.findByTestId('crm-write-card-collapsed'));

    // Both items start selected (default-checked); approving both fires the
    // rejection for the first.
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /approve 2 changes/i }));
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.getByText(/review again/i)).toBeInTheDocument();
    });

    // The stale item's checkbox is unchecked — it is no longer swept into
    // the next bulk Approve without the advisor consciously re-selecting it.
    const checkboxes = screen.getAllByRole('checkbox') as HTMLInputElement[];
    expect(checkboxes.some((c) => !c.checked)).toBe(true);

    // "Approve 2 changes" must not still be on offer — the stale one no
    // longer counts as selected. (The second item sent successfully in the
    // same batch, so it drops out of the selectable count too — 0 remain,
    // and Approve is disabled until the advisor re-checks the stale row.)
    expect(screen.queryByRole('button', { name: /approve 2 changes/i })).not.toBeInTheDocument();
    const approveButton = screen.getByRole('button', { name: /approve 0 changes/i });
    expect(approveButton).toBeDisabled();
  });

  it('renders multi-paragraph Existing/From-this-meeting reference text with line breaks preserved (pre-wrap)', async () => {
    const m = useMatterStore.getState().createMatter({
      name: 'Henderson',
      client: 'Henderson',
      crmHouseholdKeys: ['12345'],
    });
    enqueueFieldItem(m.id, {
      existingValue: 'Robert owns a rental property.\n\nHe is planning to retire early.',
    });

    render(<CrmWriteReviewCard matterId={m.id} />);
    // QA-42: wait for the CARD ITSELF to render connected — not just for the
    // `crmIsConnected` mock to have been CALLED. The mock resolves on its own
    // microtask, so "called" can be observed before the resulting
    // `setConnected(true)` state update has actually landed in the DOM; that
    // race let this click occasionally fire while the card was still in its
    // pre-connected (null-render) state. Waiting for the actual element is
    // what guarantees the state update has already applied.
    fireEvent.click(await screen.findByTestId('crm-write-card-collapsed'));

    const id = useCrmWriteQueueStore.getState().items[0]!.id;
    const existing = screen.getByTestId(`crm-field-existing-${id}`);
    expect(existing).toHaveStyle({ whiteSpace: 'pre-wrap' });
  });
});
