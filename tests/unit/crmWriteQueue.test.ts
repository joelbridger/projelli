/**
 * crmWriteQueueStore — the approval-gated CRM write proposal queue.
 *
 * Covers:
 *   - enqueue never triggers a send by itself.
 *   - approve() saves/prepares a proposal, then approves it by proposal id.
 *   - a VerifyPending error string maps to 'verify_pending', not 'failed'.
 *   - a hard failure maps to 'failed' and keeps the error message.
 *   - dismiss() removes an item without sending anything.
 *   - hydrateFromBackend restores encrypted backend proposals with honest
 *     reconciliation instead of trusting stale rows blindly.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { LiveCrmRecord } from '@/platform/crm/liveRecords';

const { mockMatterState, mockVisibilityRecords } = vi.hoisted(() => ({
  mockMatterState: { matters: [] as { id: string }[] },
  mockVisibilityRecords: [] as Array<Record<string, unknown> & { id: string; kind: string }>,
}));

vi.mock('@/platform/matter/matterStore', () => ({
  useMatterStore: { getState: () => mockMatterState },
}));
vi.mock('@/platform/crm/liveRecords', () => ({
  loadLiveCrmRecords: vi.fn(() => Promise.resolve(mockVisibilityRecords)),
}));
vi.mock('@/platform/fs/activeWorkspaceService', () => ({
  getActiveWorkspaceService: () => ({ getRootPath: () => '/workspace' }),
}));

vi.mock('@/platform/utils/wealthbox-commands', () => ({
  crmSaveWriteProposal: vi.fn().mockResolvedValue(null),
  crmPrepareWriteProposal: vi.fn().mockResolvedValue(null),
  crmApproveWriteProposal: vi.fn().mockResolvedValue({ remoteId: '555', deduped: false }),
  crmListWriteProposals: vi.fn().mockResolvedValue([]),
  crmDeleteWriteProposal: vi.fn().mockResolvedValue(undefined),
}));

import { projectVisibleCrmWriteQueueItems, useCrmWriteQueueStore } from '@/platform/state/crmWriteQueueStore';
import { useFirmStore } from '@/platform/firm/firmStore';
import {
  crmApproveWriteProposal,
  crmDeleteWriteProposal,
  crmListWriteProposals,
  crmPrepareWriteProposal,
  crmSaveWriteProposal,
  type CrmWriteProposalRecord,
} from '@/platform/utils/wealthbox-commands';

function resetStore() {
  useCrmWriteQueueStore.setState({ items: [] });
}

function signInAs(userId: string) {
  useFirmStore.setState({
    session: {
      userId,
      email: `${userId}@example.com`,
      role: 'member',
      org: null,
      seatId: 'seat-1',
      tier: 'practice',
      packs: [],
      seats: 1,
      lastValidatedAt: null,
      activated: true,
    },
  });
}

function restrictedVisibilityRecords() {
  mockVisibilityRecords.splice(0, mockVisibilityRecords.length,
    {
      id: 'meeting-preferences',
      kind: 'meeting_foundation_preferences',
      visibilityPolicies: [{
        id: 'private-policy',
        mode: 'explicit-review',
        includedMemberIds: [],
        excludedMemberIds: ['advisor-excluded'],
      }],
    },
    {
      id: 'meeting-private',
      kind: 'meeting',
      ownerRef: 'advisor-owner',
      visibilityPolicyId: 'private-policy',
    },
    {
      id: 'artifact-private',
      kind: 'meeting_artifact',
      meetingVisibility: {
        kind: 'meeting-artifact',
        id: 'artifact-private',
        lineage: 'derived',
        ownerRef: 'advisor-owner',
        visibilityPolicyId: 'private-policy',
        parentRef: { kind: 'meeting-note', id: 'meeting-private' },
      },
    },
  );
}

function defaultBackendRecord(overrides: Partial<CrmWriteProposalRecord> = {}): CrmWriteProposalRecord {
  return {
    id: 'p1',
    kind: 'note',
    matterId: 'm1',
    title: 'Persisted note',
    body: 'B',
    sourceRef: 'doc:x',
    status: 'proposed',
    householdKey: '',
    provider: 'wealthbox',
    contentHash: 'hash',
    createdAt: '2026-07-09T00:00:00.000Z',
    updatedAt: '2026-07-09T00:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  resetStore();
  localStorage.clear();
  mockMatterState.matters = [];
  mockVisibilityRecords.splice(0);
  useFirmStore.setState({ session: null });
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

describe('enqueue', () => {
  it('adds a proposed item with status "proposed" and a generated id', () => {
    const { enqueue } = useCrmWriteQueueStore.getState();
    enqueue({ kind: 'note', matterId: 'm1', title: 'T', body: 'B', sourceRef: 'doc:x' });
    const items = useCrmWriteQueueStore.getState().items;
    expect(items).toHaveLength(1);
    expect(items[0]!).toMatchObject({ kind: 'note', matterId: 'm1', title: 'T', body: 'B', status: 'proposed' });
    expect(items[0]!.id).toBeTruthy();
  });

  it('never triggers a send by itself', async () => {
    useCrmWriteQueueStore.getState().enqueue({ kind: 'note', matterId: 'm2', title: 'T2', body: 'B2', sourceRef: 'doc:y' });
    await new Promise((r) => setTimeout(r, 10));
    expect(crmPrepareWriteProposal).not.toHaveBeenCalled();
    expect(crmApproveWriteProposal).not.toHaveBeenCalled();
  });
});

describe('approve', () => {
  it('prepares, approves by proposal id, and marks sent', async () => {
    const s = useCrmWriteQueueStore.getState();
    s.enqueue({ kind: 'note', matterId: 'm1', title: 'T', body: 'B', sourceRef: 'doc:x' });
    const id = useCrmWriteQueueStore.getState().items[0]!.id;
    await s.approve([id], '12345');
    expect(crmPrepareWriteProposal).toHaveBeenCalledWith(
      expect.objectContaining({ proposalId: id, householdKey: '12345' }),
    );
    expect(crmApproveWriteProposal).toHaveBeenCalledTimes(1);
    expect(crmApproveWriteProposal).toHaveBeenCalledWith(id);
    const item = useCrmWriteQueueStore.getState().items[0]!;
    expect(item.status).toBe('sent');
    expect(item.remoteId).toBe('555');
  });

  it('saves a task proposal with dueDate before approving the proposal id', async () => {
    const s = useCrmWriteQueueStore.getState();
    s.enqueue({ kind: 'task', matterId: 'm1', title: 'T', body: 'B', dueDate: '2026-07-15', sourceRef: 'doc:x' });
    const id = useCrmWriteQueueStore.getState().items[0]!.id;
    await s.approve([id], '12345');
    expect(crmSaveWriteProposal).toHaveBeenCalledWith(
      expect.objectContaining({
        id,
        kind: 'task',
        householdKey: '12345',
        matterId: 'm1',
        title: 'T',
        body: 'B',
        dueDate: '2026-07-15',
      }),
    );
    expect(crmApproveWriteProposal).toHaveBeenCalledWith(id);
    expect(useCrmWriteQueueStore.getState().items[0]!.status).toBe('sent');
  });

  it('sends multiple approved items one at a time (sequential, not parallel)', async () => {
    const order: string[] = [];
    vi.mocked(crmApproveWriteProposal).mockImplementation(async (proposalId) => {
      order.push('start:' + proposalId);
      await new Promise((r) => setTimeout(r, 5));
      order.push('end:' + proposalId);
      return { remoteId: 'r-' + proposalId, deduped: false };
    });
    const s = useCrmWriteQueueStore.getState();
    s.enqueue({ kind: 'note', matterId: 'm1', title: 'A', body: 'B', sourceRef: 'doc:a' });
    s.enqueue({ kind: 'note', matterId: 'm1', title: 'B', body: 'B', sourceRef: 'doc:b' });
    const ids = useCrmWriteQueueStore.getState().items.map((i) => i.id);
    await s.approve(ids, '12345');
    expect(order).toEqual([`start:${ids[0]}`, `end:${ids[0]}`, `start:${ids[1]}`, `end:${ids[1]}`]);
  });

  it('maps a VerifyPending error string to status "verify_pending"', async () => {
    vi.mocked(crmApproveWriteProposal).mockRejectedValueOnce(
      new Error('a previous identical write may have been delivered — verification pending, retry shortly')
    );
    const s = useCrmWriteQueueStore.getState();
    s.enqueue({ kind: 'note', matterId: 'm1', title: 'T', body: 'B', sourceRef: 'doc:x' });
    const id = useCrmWriteQueueStore.getState().items[0]!.id;
    await s.approve([id], '12345');
    const item = useCrmWriteQueueStore.getState().items[0]!;
    expect(item.status).toBe('verify_pending');
  });

  it('maps a hard failure to status "failed" and records the error message', async () => {
    vi.mocked(crmApproveWriteProposal).mockRejectedValueOnce(new Error('CRM write failed (HTTP 500)'));
    const s = useCrmWriteQueueStore.getState();
    s.enqueue({ kind: 'note', matterId: 'm1', title: 'T', body: 'B', sourceRef: 'doc:x' });
    const id = useCrmWriteQueueStore.getState().items[0]!.id;
    await s.approve([id], '12345');
    const item = useCrmWriteQueueStore.getState().items[0]!;
    expect(item.status).toBe('failed');
    expect(item.error).toContain('500');
  });

  it('generates a requestedAt (RFC3339) for a fresh approval and passes it through', async () => {
    const s = useCrmWriteQueueStore.getState();
    s.enqueue({ kind: 'note', matterId: 'm1', title: 'T', body: 'B', sourceRef: 'doc:x' });
    const id = useCrmWriteQueueStore.getState().items[0]!.id;
    await s.approve([id], '12345');
    expect(crmPrepareWriteProposal).toHaveBeenCalledWith(
      expect.objectContaining({
        proposalId: id,
        requestedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/),
      }),
    );
    const item = useCrmWriteQueueStore.getState().items[0]!;
    expect(item.requestedAt).toBe(vi.mocked(crmPrepareWriteProposal).mock.calls[0]![0].requestedAt);
  });

  it('routes a task item through proposal approval with a requestedAt too', async () => {
    const s = useCrmWriteQueueStore.getState();
    s.enqueue({ kind: 'task', matterId: 'm1', title: 'T', body: 'B', dueDate: '2026-07-15', sourceRef: 'doc:x' });
    const id = useCrmWriteQueueStore.getState().items[0]!.id;
    await s.approve([id], '12345');
    expect(crmPrepareWriteProposal).toHaveBeenCalledWith(
      expect.objectContaining({
        proposalId: id,
        requestedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/),
      }),
    );
  });

  // The whole point of requested_at: a retry of a FAILED send must reuse the
  // exact same value (so the backend's dedup ledger treats it as the same
  // approval event, not a fresh one) — never regenerate on retry.
  it('reuses the SAME requestedAt when retrying a failed item (approve called again)', async () => {
    vi.mocked(crmApproveWriteProposal).mockRejectedValueOnce(new Error('CRM write failed (HTTP 500)'));
    const s = useCrmWriteQueueStore.getState();
    s.enqueue({ kind: 'note', matterId: 'm1', title: 'T', body: 'B', sourceRef: 'doc:x' });
    const id = useCrmWriteQueueStore.getState().items[0]!.id;

    await s.approve([id], '12345');
    expect(useCrmWriteQueueStore.getState().items[0]!.status).toBe('failed');
    const firstRequestedAt = useCrmWriteQueueStore.getState().items[0]!.requestedAt;
    expect(firstRequestedAt).toBeTruthy();

    // Retry: crmApproveWriteProposal now succeeds.
    await s.approve([id], '12345');
    expect(useCrmWriteQueueStore.getState().items[0]!.status).toBe('sent');
    expect(useCrmWriteQueueStore.getState().items[0]!.requestedAt).toBe(firstRequestedAt);

    expect(crmApproveWriteProposal).toHaveBeenCalledTimes(2);
    const firstCallArgs = vi.mocked(crmPrepareWriteProposal).mock.calls[0]![0];
    const secondCallArgs = vi.mocked(crmPrepareWriteProposal).mock.calls[1]![0];
    expect(secondCallArgs.requestedAt).toBe(firstCallArgs.requestedAt);
  });

  // A DIFFERENT approval action (a fresh item, even with identical content)
  // must get its OWN requestedAt — this is what lets an intentional repeat
  // send (e.g. a recurring "Left voicemail" note) reach the CRM instead of
  // being silently deduped as "the same write, already sent."
  it('gives two separately-enqueued items with identical content different requestedAt values', async () => {
    // Deterministic clock so two real approve() calls can never coincidentally
    // land in the same millisecond and produce an equal (flaky-looking) pass.
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-07-02T14:41:00.000Z'));
      const s = useCrmWriteQueueStore.getState();
      s.enqueue({ kind: 'note', matterId: 'm1', title: 'Left voicemail', body: 'B', sourceRef: 'doc:x' });
      const id1 = useCrmWriteQueueStore.getState().items[0]!.id;
      await s.approve([id1], '12345');
      const firstRequestedAt = useCrmWriteQueueStore.getState().items[0]!.requestedAt;

      vi.setSystemTime(new Date('2026-07-09T09:00:00.000Z'));
      s.enqueue({ kind: 'note', matterId: 'm1', title: 'Left voicemail', body: 'B', sourceRef: 'doc:y' });
      const id2 = useCrmWriteQueueStore.getState().items[1]!.id;
      await s.approve([id2], '12345');
      const secondRequestedAt = useCrmWriteQueueStore.getState().items[1]!.requestedAt;

      expect(secondRequestedAt).not.toBe(firstRequestedAt);
    } finally {
      vi.useRealTimers();
    }
  });

  // Codex adversarial review catch (P2): a bare Date.now()/toISOString() can
  // collide within the same millisecond — two genuinely separate approvals
  // must never end up sharing a requestedAt just because they landed in the
  // same 1ms window, or the second legitimate write would be dropped as a
  // "duplicate" of the first (the backend dedup key doesn't include
  // matterId/sourceRef to break the tie).
  it('never collides even when two fresh approvals land in the exact same millisecond', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-07-02T14:41:00.000Z'));
      const s = useCrmWriteQueueStore.getState();
      s.enqueue({ kind: 'note', matterId: 'm1', title: 'Left voicemail', body: 'B', sourceRef: 'doc:x' });
      const id1 = useCrmWriteQueueStore.getState().items[0]!.id;
      await s.approve([id1], '12345');
      const firstRequestedAt = useCrmWriteQueueStore.getState().items[0]!.requestedAt;

      // Clock deliberately NOT advanced — simulates two approvals firing
      // back to back within the same millisecond.
      s.enqueue({ kind: 'note', matterId: 'm1', title: 'Left voicemail', body: 'B', sourceRef: 'doc:y' });
      const id2 = useCrmWriteQueueStore.getState().items[1]!.id;
      await s.approve([id2], '12345');
      const secondRequestedAt = useCrmWriteQueueStore.getState().items[1]!.requestedAt;

      expect(secondRequestedAt).not.toBe(firstRequestedAt);
      // Still a valid RFC3339 timestamp, just monotonically bumped forward.
      expect(secondRequestedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    } finally {
      vi.useRealTimers();
    }
  });

  it('sets status "sending" while the request is in flight', async () => {
    let resolveFn!: (v: { remoteId: string; deduped: boolean }) => void;
    vi.mocked(crmApproveWriteProposal).mockReturnValueOnce(new Promise((r) => (resolveFn = r)));
    const s = useCrmWriteQueueStore.getState();
    s.enqueue({ kind: 'note', matterId: 'm1', title: 'T', body: 'B', sourceRef: 'doc:x' });
    const id = useCrmWriteQueueStore.getState().items[0]!.id;
    const p = s.approve([id], '12345');
    await new Promise((r) => setTimeout(r, 0));
    expect(useCrmWriteQueueStore.getState().items[0]!.status).toBe('sending');
    resolveFn({ remoteId: '555', deduped: false });
    await p;
    expect(useCrmWriteQueueStore.getState().items[0]!.status).toBe('sent');
  });
});

describe('dismiss', () => {
  it('removes an item without sending anything', async () => {
    const s = useCrmWriteQueueStore.getState();
    s.enqueue({ kind: 'note', matterId: 'm1', title: 'T', body: 'B', sourceRef: 'doc:x' });
    const id = useCrmWriteQueueStore.getState().items[0]!.id;
    await s.dismiss(id);
    expect(useCrmWriteQueueStore.getState().items).toHaveLength(0);
    expect(crmDeleteWriteProposal).toHaveBeenCalledWith(id);
    expect(crmApproveWriteProposal).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Task 9c: field-level blended updates. Field content is saved into the
// encrypted proposal store first; approval sends only the proposal id.
// ─────────────────────────────────────────────────────────────────────────

function fieldItem(overrides: Partial<Parameters<typeof useCrmWriteQueueStore.prototype.enqueue>[0]> = {}) {
  return {
    kind: 'field' as const,
    matterId: 'm1',
    title: 'Background information',
    body: '',
    field: 'background_information',
    existingValue: 'Robert owns a rental property.',
    newValue: 'Retiring spring 2027.',
    finalValue: 'Robert owns a rental property. Retiring spring 2027.',
    sourceRef: 'meeting:2026-06-30',
    ...overrides,
  };
}

describe('field updates (Task 9c)', () => {
  it('enqueue stores field/existingValue/newValue/finalValue on the item', () => {
    useCrmWriteQueueStore.getState().enqueue(fieldItem());
    const item = useCrmWriteQueueStore.getState().items[0]!;
    expect(item.kind).toBe('field');
    expect(item.field).toBe('background_information');
    expect(item.existingValue).toBe('Robert owns a rental property.');
    expect(item.newValue).toBe('Retiring spring 2027.');
    expect(item.finalValue).toBe('Robert owns a rental property. Retiring spring 2027.');
  });

  it('approve() on a field item saves the field proposal and approves by id', async () => {
    vi.mocked(crmApproveWriteProposal).mockResolvedValueOnce({ remoteId: '557', deduped: false });
    const s = useCrmWriteQueueStore.getState();
    s.enqueue(fieldItem());
    const id = useCrmWriteQueueStore.getState().items[0]!.id;
    await s.approve([id], '12345');

    expect(crmApproveWriteProposal).toHaveBeenCalledTimes(1);
    expect(crmApproveWriteProposal).toHaveBeenCalledWith(id);
    expect(crmSaveWriteProposal).toHaveBeenCalledWith(
      expect.objectContaining({
        id,
        kind: 'field',
        matterId: 'm1',
        householdKey: '12345',
        field: 'background_information',
        existingValue: 'Robert owns a rental property.',
        newValue: 'Retiring spring 2027.',
        finalValue: 'Robert owns a rental property. Retiring spring 2027.',
        sourceRef: 'meeting:2026-06-30',
        requestedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/),
      }),
    );
    expect(useCrmWriteQueueStore.getState().items[0]!.status).toBe('sent');
    expect(useCrmWriteQueueStore.getState().items[0]!.remoteId).toBe('557');
  });

  it('a retry of a failed field item reuses the same requestedAt (same idempotency contract as note/task)', async () => {
    vi.mocked(crmApproveWriteProposal).mockRejectedValueOnce(new Error('CRM write failed (HTTP 500)'));
    const s = useCrmWriteQueueStore.getState();
    s.enqueue(fieldItem());
    const id = useCrmWriteQueueStore.getState().items[0]!.id;

    await s.approve([id], '12345');
    expect(useCrmWriteQueueStore.getState().items[0]!.status).toBe('failed');
    const firstRequestedAt = useCrmWriteQueueStore.getState().items[0]!.requestedAt;

    await s.approve([id], '12345');
    expect(useCrmWriteQueueStore.getState().items[0]!.status).toBe('sent');
    expect(useCrmWriteQueueStore.getState().items[0]!.requestedAt).toBe(firstRequestedAt);
    expect(crmApproveWriteProposal).toHaveBeenCalledTimes(2);
    expect(vi.mocked(crmPrepareWriteProposal).mock.calls[1]![0].requestedAt).toBe(firstRequestedAt);
  });

  // The stale-guard: the backend re-fetches the field at approve time and
  // flips to verify_pending (never blind-overwrites) if it drifted since the
  // proposal was drafted. Reuses the SAME verify_pending machinery already
  // built for note/task — sendOne's error-string routing is kind-agnostic.
  it('maps a VerifyPending error on a field item to status "verify_pending"', async () => {
    vi.mocked(crmApproveWriteProposal).mockRejectedValueOnce(
      new Error('a previous identical write may have been delivered — verification pending, retry shortly'),
    );
    const s = useCrmWriteQueueStore.getState();
    s.enqueue(fieldItem());
    const id = useCrmWriteQueueStore.getState().items[0]!.id;
    await s.approve([id], '12345');
    expect(useCrmWriteQueueStore.getState().items[0]!.status).toBe('verify_pending');
  });

  // The real stale-guard: the backend re-fetches the live field at approve
  // time and rejects with CrmWriteError::StaleFieldValue(current) — never
  // blind-overwrites — if it drifted since the proposal was drafted. Exact
  // message shape from src-tauri/src/commands/crm/write.rs's Display impl.
  it('parses a real StaleFieldValue rejection into status "stale", refreshes existingValue, and REBUILDS finalValue', async () => {
    vi.mocked(crmApproveWriteProposal).mockRejectedValueOnce(
      new Error(
        'this field changed in the CRM since the proposal — current value: Robert owns a rental property and a lake house.',
      ),
    );
    const s = useCrmWriteQueueStore.getState();
    s.enqueue(fieldItem());
    const id = useCrmWriteQueueStore.getState().items[0]!.id;
    await s.approve([id], '12345');

    const item = useCrmWriteQueueStore.getState().items[0]!;
    expect(item.status).toBe('stale');
    // Re-rendered with the FRESH live value, not the stale one the proposal
    // was drafted against.
    expect(item.existingValue).toBe('Robert owns a rental property and a lake house.');
    // Coordinator review catch (P2): the OLD blend was computed against the
    // OLD existingValue and never mentions the concurrent edit. Silently
    // keeping it and letting the advisor re-approve with one click would
    // overwrite the concurrent CRM edit the very first time the retry's
    // re-fetched existingValue happens to match the (now stale-again) live
    // value. finalValue must be REBUILT from the fresh existingValue + the
    // meeting's newValue, never left as the stale blend. No provider handle
    // survives a stale rejection (none is persisted on the item), so this is
    // always the deterministic concat, even for a narrative field that was
    // originally AI-blended.
    expect(item.finalValue).toBe('Robert owns a rental property and a lake house.\n\nRetiring spring 2027.');
  });

  // Defense-in-depth: the card is expected to disable Approve while
  // finalValue is blank, but the store must never fire a network call for a
  // field item with nothing to write even if that guard is somehow bypassed.
  it('never prepares or approves a field item whose finalValue is blank', async () => {
    const s = useCrmWriteQueueStore.getState();
    s.enqueue(fieldItem({ finalValue: '   ' }));
    const id = useCrmWriteQueueStore.getState().items[0]!.id;
    await s.approve([id], '12345');
    expect(crmPrepareWriteProposal).not.toHaveBeenCalled();
    expect(crmApproveWriteProposal).not.toHaveBeenCalled();
    expect(useCrmWriteQueueStore.getState().items[0]!.status).not.toBe('sent');
  });
});

// Codex adversarial review catch (P2): composeFieldBlend existed but was
// never called from any production path — a caller enqueuing a field
// proposal with only existingValue/newValue (no precomputed finalValue, per
// the plan's own "the queue store should create that blend") would get a
// permanently-blank finalValue and the item could never send. This is the
// actual fix: the ONLY supported way to enqueue a field item.
describe('enqueueFieldUpdate (Task 9c)', () => {
  // Codex round-3 catch (P2): the backend's validate_field_is_writable
  // rejects everything except background_information — enqueueing an
  // unsupported field must be rejected up front, not shown to the advisor
  // as an approval-ready change that's guaranteed to fail every time.
  it('rejects a field the backend does not accept, before enqueueing anything', async () => {
    const s = useCrmWriteQueueStore.getState();
    await expect(
      s.enqueueFieldUpdate({
        matterId: 'm1',
        title: 'Risk tolerance',
        field: 'risk_tolerance',
        existingValue: 'Moderate',
        newValue: 'Aggressive',
        sourceRef: 'meeting:2026-06-30',
      }),
    ).rejects.toThrow(/risk_tolerance/);
    expect(useCrmWriteQueueStore.getState().items).toHaveLength(0);
  });

  it('computes finalValue via the narrative-merge path with an audited sender', async () => {
    const send = vi.fn().mockResolvedValue('Merged text.');
    const s = useCrmWriteQueueStore.getState();
    await s.enqueueFieldUpdate({
      matterId: 'm1',
      title: 'Background information',
      field: 'background_information',
      existingValue: 'A',
      newValue: 'B',
      sourceRef: 'meeting:2026-06-30',
      send,
    });
    expect(send).toHaveBeenCalledTimes(1);
    expect(useCrmWriteQueueStore.getState().items[0]!.finalValue).toBe('Merged text.');
  });

  it('falls back to the deterministic concatenation when no provider is configured', async () => {
    const s = useCrmWriteQueueStore.getState();
    await s.enqueueFieldUpdate({
      matterId: 'm1',
      title: 'Background information',
      field: 'background_information',
      existingValue: 'A',
      newValue: 'B',
      sourceRef: 'meeting:2026-06-30',
    });
    expect(useCrmWriteQueueStore.getState().items[0]!.finalValue).toBe('A\n\nB');
  });

  it('the enqueued item is immediately approvable end-to-end (no manual finalValue fill-in needed)', async () => {
    const s = useCrmWriteQueueStore.getState();
    await s.enqueueFieldUpdate({
      matterId: 'm1',
      title: 'Background information',
      field: 'background_information',
      existingValue: 'Robert owns a rental property.',
      newValue: 'Retiring spring 2027.',
      sourceRef: 'meeting:2026-06-30',
    });
    const id = useCrmWriteQueueStore.getState().items[0]!.id;
    await s.approve([id], '12345');
    expect(crmSaveWriteProposal).toHaveBeenCalledWith(
      expect.objectContaining({ finalValue: 'Robert owns a rental property.\n\nRetiring spring 2027.' }),
    );
    expect(crmApproveWriteProposal).toHaveBeenCalledWith(id);
    expect(useCrmWriteQueueStore.getState().items[0]!.status).toBe('sent');
  });

  it('ignores a raw provider-shaped object and never calls provider.sendMessage', async () => {
    const sendMessage = vi.fn().mockResolvedValue({ content: 'should never be sent' });
    const s = useCrmWriteQueueStore.getState();
    const bypassed = {
      matterId: 'm1',
      title: 'Background information',
      field: 'background_information',
      existingValue: 'A',
      newValue: 'B',
      sourceRef: 'meeting:2026-06-30',
      provider: { sendMessage },
    };
    await s.enqueueFieldUpdate(bypassed as unknown as Parameters<typeof s.enqueueFieldUpdate>[0]);
    expect(sendMessage).not.toHaveBeenCalled();
    expect(useCrmWriteQueueStore.getState().items[0]!.finalValue).toBe('A\n\nB');
  });
});

describe('hydrateFromBackend', () => {
  it('loads pending encrypted backend proposals into the in-memory queue', async () => {
    mockMatterState.matters = [{ id: 'm1' }];
    vi.mocked(crmListWriteProposals).mockResolvedValueOnce([
      defaultBackendRecord({ id: 'x1', title: 'Persisted note' }),
    ]);

    await useCrmWriteQueueStore.getState().hydrateFromBackend();

    expect(crmListWriteProposals).toHaveBeenCalledTimes(1);
    expect(useCrmWriteQueueStore.getState().items).toHaveLength(1);
    expect(useCrmWriteQueueStore.getState().items[0]).toMatchObject({
      id: 'x1',
      title: 'Persisted note',
      status: 'proposed',
    });
  });

  it('reopens an item stuck mid-send as "proposed" because the old app process died', async () => {
    mockMatterState.matters = [{ id: 'm1' }];
    vi.mocked(crmListWriteProposals).mockResolvedValueOnce([
      defaultBackendRecord({ id: 'x1', status: 'sending' }),
    ]);

    await useCrmWriteQueueStore.getState().hydrateFromBackend();

    expect(useCrmWriteQueueStore.getState().items[0]).toMatchObject({ id: 'x1', status: 'proposed' });
  });

  it('drops sent proposals and proposals for deleted matters during backend hydration', async () => {
    mockMatterState.matters = [{ id: 'm1' }];
    vi.mocked(crmListWriteProposals).mockResolvedValueOnce([
      defaultBackendRecord({ id: 'sent', matterId: 'm1', status: 'sent', remoteId: '9' }),
      defaultBackendRecord({ id: 'orphaned', matterId: 'missing' }),
      defaultBackendRecord({ id: 'kept', matterId: 'm1' }),
    ]);

    await useCrmWriteQueueStore.getState().hydrateFromBackend();

    expect(useCrmWriteQueueStore.getState().items.map((item) => item.id)).toEqual(['kept']);
  });

  it('handles a fresh backend with no saved proposals', async () => {
    vi.mocked(crmListWriteProposals).mockResolvedValueOnce([]);

    await useCrmWriteQueueStore.getState().hydrateFromBackend();

    expect(useCrmWriteQueueStore.getState().items).toEqual([]);
  });

  it('retains structured visibility across failure and restart, then hides it after a viewer switch', async () => {
    mockMatterState.matters = [{ id: 'm1' }];
    restrictedVisibilityRecords();
    signInAs('advisor-owner');
    const meetingVisibility = {
      kind: 'proposal' as const,
      id: 'private-proposal',
      lineage: 'derived' as const,
      ownerRef: 'advisor-owner',
      visibilityPolicyId: 'private-policy',
      parentRef: {
        kind: 'meeting-artifact' as const,
        id: 'artifact-private',
      },
    };
    vi.mocked(crmListWriteProposals).mockResolvedValue([
      defaultBackendRecord({
        id: 'private-proposal',
        meetingVisibility,
      }),
    ]);
    await useCrmWriteQueueStore.getState().hydrateFromBackend();
    expect(useCrmWriteQueueStore.getState().items[0]?.meetingVisibility).toEqual(
      meetingVisibility
    );

    vi.mocked(crmApproveWriteProposal).mockRejectedValueOnce(
      new Error('CRM write failed (HTTP 500)')
    );
    await useCrmWriteQueueStore
      .getState()
      .approve(['private-proposal'], 'household-1');
    expect(crmSaveWriteProposal).toHaveBeenCalledWith(
      expect.objectContaining({ meetingVisibility })
    );
    expect(useCrmWriteQueueStore.getState().items[0]?.status).toBe('failed');

    resetStore();
    vi.mocked(crmListWriteProposals).mockResolvedValue([
      defaultBackendRecord({
        id: 'private-proposal',
        status: 'failed',
        error: 'CRM write failed (HTTP 500)',
        meetingVisibility,
      }),
    ]);
    await useCrmWriteQueueStore.getState().hydrateFromBackend();
    expect(useCrmWriteQueueStore.getState().items[0]?.meetingVisibility).toEqual(
      meetingVisibility
    );
    expect(useCrmWriteQueueStore.getState().items[0]?.status).toBe('failed');

    signInAs('advisor-excluded');
    expect(useCrmWriteQueueStore.getState().items).toEqual([]);
    expect(crmApproveWriteProposal).toHaveBeenCalledTimes(1);
  });

  it('re-projects private text immediately when live policy or lineage changes', async () => {
    mockMatterState.matters = [{ id: 'm1' }];
    restrictedVisibilityRecords();
    const policy = mockVisibilityRecords.find((record) =>
      record.kind === 'meeting_foundation_preferences');
    if (!policy) throw new Error('missing fixture policy');
    policy['visibilityPolicies'] = [{
      id: 'private-policy', mode: 'explicit-review',
      includedMemberIds: ['advisor-member'], excludedMemberIds: [],
    }];
    signInAs('advisor-member');
    const meetingVisibility = {
      kind: 'proposal' as const, id: 'private-proposal', lineage: 'derived' as const,
      ownerRef: 'advisor-owner', visibilityPolicyId: 'private-policy',
      parentRef: { kind: 'meeting-artifact' as const, id: 'artifact-private' },
    };
    vi.mocked(crmListWriteProposals).mockResolvedValue([
      defaultBackendRecord({ id: 'private-proposal', title: 'Private title',
        body: 'Private body', meetingVisibility }),
    ]);
    await useCrmWriteQueueStore.getState().hydrateFromBackend();
    const items = useCrmWriteQueueStore.getState().items;
    expect(projectVisibleCrmWriteQueueItems(
      items, mockVisibilityRecords as LiveCrmRecord[], 'advisor-member'
    )).toHaveLength(1);

    policy['visibilityPolicies'] = [{
      id: 'private-policy', mode: 'explicit-review',
      includedMemberIds: [], excludedMemberIds: ['advisor-member'],
    }];
    expect(projectVisibleCrmWriteQueueItems(
      items, mockVisibilityRecords as LiveCrmRecord[], 'advisor-member'
    )).toEqual([]);
    policy['visibilityPolicies'] = [{
      id: 'private-policy', mode: 'explicit-review',
      includedMemberIds: [], excludedMemberIds: [],
    }];
    mockVisibilityRecords.splice(
      mockVisibilityRecords.findIndex((record) => record.id === 'artifact-private'), 1
    );
    expect(projectVisibleCrmWriteQueueItems(
      items, mockVisibilityRecords as LiveCrmRecord[], 'advisor-member'
    )).toEqual([]);
  });

  it('reloads current policy before a queue mutation', async () => {
    mockMatterState.matters = [{ id: 'm1' }];
    restrictedVisibilityRecords();
    const policy = mockVisibilityRecords.find((record) =>
      record.kind === 'meeting_foundation_preferences');
    if (!policy) throw new Error('missing fixture policy');
    policy['visibilityPolicies'] = [{
      id: 'private-policy', mode: 'explicit-review',
      includedMemberIds: ['advisor-member'], excludedMemberIds: [],
    }];
    signInAs('advisor-member');
    const meetingVisibility = {
      kind: 'proposal' as const, id: 'private-proposal', lineage: 'derived' as const,
      ownerRef: 'advisor-owner', visibilityPolicyId: 'private-policy',
      parentRef: { kind: 'meeting-artifact' as const, id: 'artifact-private' },
    };
    vi.mocked(crmListWriteProposals).mockResolvedValue([
      defaultBackendRecord({ id: 'private-proposal', meetingVisibility }),
    ]);
    await useCrmWriteQueueStore.getState().hydrateFromBackend();
    policy['visibilityPolicies'] = [{
      id: 'private-policy', mode: 'explicit-review',
      includedMemberIds: [], excludedMemberIds: ['advisor-member'],
    }];
    await useCrmWriteQueueStore.getState().dismiss('private-proposal');
    expect(crmDeleteWriteProposal).not.toHaveBeenCalled();
    expect(useCrmWriteQueueStore.getState().items).toHaveLength(1);
  });
});
