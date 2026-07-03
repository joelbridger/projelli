/**
 * crmWriteQueueStore — the approval-gated CRM write proposal queue.
 *
 * Covers:
 *   - enqueue never triggers a send by itself.
 *   - approve() sends sequentially, marks items sent, dedupes on the receipt.
 *   - approve() maps a note vs task kind to the right wrapper.
 *   - a VerifyPending error string maps to 'verify_pending', not 'failed'.
 *   - a hard failure maps to 'failed' and keeps the error message.
 *   - dismiss() removes an item without sending anything.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/platform/utils/wealthbox-commands', () => ({
  crmCreateNote: vi.fn().mockResolvedValue({ remoteId: '555', deduped: false }),
  crmCreateTask: vi.fn().mockResolvedValue({ remoteId: '556', deduped: false }),
}));

import { useCrmWriteQueueStore } from '@/platform/state/crmWriteQueueStore';
import { crmCreateNote, crmCreateTask } from '@/platform/utils/wealthbox-commands';

function resetStore() {
  useCrmWriteQueueStore.setState({ items: [] });
}

beforeEach(() => {
  resetStore();
  vi.mocked(crmCreateNote).mockClear();
  vi.mocked(crmCreateTask).mockClear();
  vi.mocked(crmCreateNote).mockResolvedValue({ remoteId: '555', deduped: false });
  vi.mocked(crmCreateTask).mockResolvedValue({ remoteId: '556', deduped: false });
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
    expect(crmCreateNote).not.toHaveBeenCalled();
    expect(crmCreateTask).not.toHaveBeenCalled();
  });
});

describe('approve', () => {
  it('sends sequentially and marks sent', async () => {
    const s = useCrmWriteQueueStore.getState();
    s.enqueue({ kind: 'note', matterId: 'm1', title: 'T', body: 'B', sourceRef: 'doc:x' });
    const id = useCrmWriteQueueStore.getState().items[0]!.id;
    await s.approve([id], '12345');
    expect(crmCreateNote).toHaveBeenCalledTimes(1);
    expect(crmCreateNote).toHaveBeenCalledWith(expect.objectContaining({ householdKey: '12345', matterId: 'm1', title: 'T', body: 'B' }));
    const item = useCrmWriteQueueStore.getState().items[0]!;
    expect(item.status).toBe('sent');
    expect(item.remoteId).toBe('555');
  });

  it('routes a task item through crmCreateTask with dueDate', async () => {
    const s = useCrmWriteQueueStore.getState();
    s.enqueue({ kind: 'task', matterId: 'm1', title: 'T', body: 'B', dueDate: '2026-07-15', sourceRef: 'doc:x' });
    const id = useCrmWriteQueueStore.getState().items[0]!.id;
    await s.approve([id], '12345');
    expect(crmCreateTask).toHaveBeenCalledWith(
      expect.objectContaining({ householdKey: '12345', matterId: 'm1', title: 'T', description: 'B', dueDate: '2026-07-15' })
    );
    expect(useCrmWriteQueueStore.getState().items[0]!.status).toBe('sent');
  });

  it('sends multiple approved items one at a time (sequential, not parallel)', async () => {
    const order: string[] = [];
    vi.mocked(crmCreateNote).mockImplementation(async (args) => {
      order.push('start:' + args.title);
      await new Promise((r) => setTimeout(r, 5));
      order.push('end:' + args.title);
      return { remoteId: 'r-' + args.title, deduped: false };
    });
    const s = useCrmWriteQueueStore.getState();
    s.enqueue({ kind: 'note', matterId: 'm1', title: 'A', body: 'B', sourceRef: 'doc:a' });
    s.enqueue({ kind: 'note', matterId: 'm1', title: 'B', body: 'B', sourceRef: 'doc:b' });
    const ids = useCrmWriteQueueStore.getState().items.map((i) => i.id);
    await s.approve(ids, '12345');
    expect(order).toEqual(['start:A', 'end:A', 'start:B', 'end:B']);
  });

  it('maps a VerifyPending error string to status "verify_pending"', async () => {
    vi.mocked(crmCreateNote).mockRejectedValueOnce(
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
    vi.mocked(crmCreateNote).mockRejectedValueOnce(new Error('CRM write failed (HTTP 500)'));
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
    expect(crmCreateNote).toHaveBeenCalledWith(
      expect.objectContaining({ requestedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/) }),
    );
    const item = useCrmWriteQueueStore.getState().items[0]!;
    expect(item.requestedAt).toBe(vi.mocked(crmCreateNote).mock.calls[0]![0].requestedAt);
  });

  it('routes a task item through crmCreateTask with a requestedAt too', async () => {
    const s = useCrmWriteQueueStore.getState();
    s.enqueue({ kind: 'task', matterId: 'm1', title: 'T', body: 'B', dueDate: '2026-07-15', sourceRef: 'doc:x' });
    const id = useCrmWriteQueueStore.getState().items[0]!.id;
    await s.approve([id], '12345');
    expect(crmCreateTask).toHaveBeenCalledWith(
      expect.objectContaining({ requestedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/) }),
    );
  });

  // The whole point of requested_at: a retry of a FAILED send must reuse the
  // exact same value (so the backend's dedup ledger treats it as the same
  // approval event, not a fresh one) — never regenerate on retry.
  it('reuses the SAME requestedAt when retrying a failed item (approve called again)', async () => {
    vi.mocked(crmCreateNote).mockRejectedValueOnce(new Error('CRM write failed (HTTP 500)'));
    const s = useCrmWriteQueueStore.getState();
    s.enqueue({ kind: 'note', matterId: 'm1', title: 'T', body: 'B', sourceRef: 'doc:x' });
    const id = useCrmWriteQueueStore.getState().items[0]!.id;

    await s.approve([id], '12345');
    expect(useCrmWriteQueueStore.getState().items[0]!.status).toBe('failed');
    const firstRequestedAt = useCrmWriteQueueStore.getState().items[0]!.requestedAt;
    expect(firstRequestedAt).toBeTruthy();

    // Retry: crmCreateNote now succeeds.
    await s.approve([id], '12345');
    expect(useCrmWriteQueueStore.getState().items[0]!.status).toBe('sent');
    expect(useCrmWriteQueueStore.getState().items[0]!.requestedAt).toBe(firstRequestedAt);

    expect(crmCreateNote).toHaveBeenCalledTimes(2);
    const firstCallArgs = vi.mocked(crmCreateNote).mock.calls[0]![0];
    const secondCallArgs = vi.mocked(crmCreateNote).mock.calls[1]![0];
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

  it('sets status "sending" while the request is in flight', async () => {
    let resolveFn!: (v: { remoteId: string; deduped: boolean }) => void;
    vi.mocked(crmCreateNote).mockReturnValueOnce(new Promise((r) => (resolveFn = r)));
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
  it('removes an item without sending anything', () => {
    const s = useCrmWriteQueueStore.getState();
    s.enqueue({ kind: 'note', matterId: 'm1', title: 'T', body: 'B', sourceRef: 'doc:x' });
    const id = useCrmWriteQueueStore.getState().items[0]!.id;
    s.dismiss(id);
    expect(useCrmWriteQueueStore.getState().items).toHaveLength(0);
    expect(crmCreateNote).not.toHaveBeenCalled();
  });
});
