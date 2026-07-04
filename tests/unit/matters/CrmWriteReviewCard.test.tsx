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
    // Task 9c: not a real export yet — see crmWriteQueue.test.ts's RED-phase note.
    crmUpdateField: vi.fn().mockResolvedValue({ remoteId: '557', deduped: false }),
  };
});

import { CrmWriteReviewCard } from '@/features/matters/CrmWriteReviewCard';
import { useCrmWriteQueueStore } from '@/platform/state/crmWriteQueueStore';
import { useMatterStore } from '@/platform/matter/matterStore';
import { crmIsConnected, crmCreateNote, crmUpdateField } from '@/platform/utils/wealthbox-commands';

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
  vi.mocked(crmUpdateField).mockClear();
  vi.mocked(crmUpdateField).mockResolvedValue({ remoteId: '557', deduped: false });
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
    // The queue store (not the card) owns requestedAt generation, but the
    // full click-to-invoke path must still carry it through.
    expect(crmCreateNote).toHaveBeenCalledWith(
      expect.objectContaining({ requestedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/) }),
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
    expect(useCrmWriteQueueStore.getState().items.find((i) => i.id === id)).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Task 9c: field-level blended updates, 3-column review (RED phase — no
// implementation yet). These fail today because CrmWriteRow has no `field`
// kind branch at all; the card renders the note/task two-column layout for
// every item regardless of `kind`. Same-card reuse per the design
// constitution: no new surface, no new card — the existing rows widen for
// this one kind.
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
    await waitFor(() => { expect(crmIsConnected).toHaveBeenCalled(); });

    expect(screen.getByText('1 field update ready for review')).toBeInTheDocument();
  });

  it('renders three labeled columns for a field item: Existing / From this meeting / Blended', async () => {
    const m = useMatterStore.getState().createMatter({
      name: 'Henderson',
      client: 'Henderson',
      crmHouseholdKeys: ['12345'],
    });
    enqueueFieldItem(m.id);

    render(<CrmWriteReviewCard matterId={m.id} />);
    await waitFor(() => { expect(crmIsConnected).toHaveBeenCalled(); });
    fireEvent.click(screen.getByTestId('crm-write-card-collapsed'));

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
    await waitFor(() => { expect(crmIsConnected).toHaveBeenCalled(); });
    fireEvent.click(screen.getByTestId('crm-write-card-collapsed'));

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
    await waitFor(() => { expect(crmIsConnected).toHaveBeenCalled(); });
    fireEvent.click(screen.getByTestId('crm-write-card-collapsed'));

    const item = useCrmWriteQueueStore.getState().items[0]!;
    const blended = screen.getByTestId(`crm-field-blended-${item.id}`);
    fireEvent.change(blended, { target: { value: 'Edited by the advisor.' } });

    expect(useCrmWriteQueueStore.getState().items[0]!.finalValue).toBe('Edited by the advisor.');
  });

  it('Approve is disabled while a selected field item\'s finalValue is blank', async () => {
    const m = useMatterStore.getState().createMatter({
      name: 'Henderson',
      client: 'Henderson',
      crmHouseholdKeys: ['12345'],
    });
    enqueueFieldItem(m.id, { finalValue: '' });

    render(<CrmWriteReviewCard matterId={m.id} />);
    await waitFor(() => { expect(crmIsConnected).toHaveBeenCalled(); });
    fireEvent.click(screen.getByTestId('crm-write-card-collapsed'));

    expect(screen.getByRole('button', { name: /approve 1 change/i })).toBeDisabled();
  });

  it('Approve enables once the Blended column is filled in and sends via crmUpdateField', async () => {
    const m = useMatterStore.getState().createMatter({
      name: 'Henderson',
      client: 'Henderson',
      crmHouseholdKeys: ['12345'],
    });
    enqueueFieldItem(m.id, { finalValue: '' });

    render(<CrmWriteReviewCard matterId={m.id} />);
    await waitFor(() => { expect(crmIsConnected).toHaveBeenCalled(); });
    fireEvent.click(screen.getByTestId('crm-write-card-collapsed'));

    const item = useCrmWriteQueueStore.getState().items[0]!;
    fireEvent.change(screen.getByTestId(`crm-field-blended-${item.id}`), {
      target: { value: 'Robert owns a rental property. Retiring spring 2027.' },
    });

    const approveBtn = screen.getByRole('button', { name: /approve 1 change/i });
    expect(approveBtn).not.toBeDisabled();
    fireEvent.click(approveBtn);

    await waitFor(() => { expect(crmUpdateField).toHaveBeenCalledTimes(1); });
    expect(crmUpdateField).toHaveBeenCalledWith(
      expect.objectContaining({
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
    await waitFor(() => { expect(crmIsConnected).toHaveBeenCalled(); });
    fireEvent.click(screen.getByTestId('crm-write-card-collapsed'));

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
    vi.mocked(crmUpdateField).mockRejectedValueOnce(
      new Error(
        'this field changed in the CRM since the proposal — current value: Robert owns a rental property and a beach condo too.',
      ),
    );

    render(<CrmWriteReviewCard matterId={m.id} />);
    await waitFor(() => { expect(crmIsConnected).toHaveBeenCalled(); });
    fireEvent.click(screen.getByTestId('crm-write-card-collapsed'));

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
    await waitFor(() => { expect(crmIsConnected).toHaveBeenCalled(); });
    fireEvent.click(screen.getByTestId('crm-write-card-collapsed'));

    const id = useCrmWriteQueueStore.getState().items[0]!.id;
    const existing = screen.getByTestId(`crm-field-existing-${id}`);
    expect(existing).toHaveStyle({ whiteSpace: 'pre-wrap' });
  });
});
