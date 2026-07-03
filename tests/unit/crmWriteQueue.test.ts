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
    expect(items[0]).toMatchObject({ kind: 'note', matterId: 'm1', title: 'T', body: 'B', status: 'proposed' });
    expect(items[0].id).toBeTruthy();
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
    const id = useCrmWriteQueueStore.getState().items[0].id;
    await s.approve([id], '12345');
    expect(crmCreateNote).toHaveBeenCalledTimes(1);
    expect(crmCreateNote).toHaveBeenCalledWith(expect.objectContaining({ householdKey: '12345', matterId: 'm1', title: 'T', body: 'B' }));
    const item = useCrmWriteQueueStore.getState().items[0];
    expect(item.status).toBe('sent');
    expect(item.remoteId).toBe('555');
  });

  it('routes a task item through crmCreateTask with dueDate', async () => {
    const s = useCrmWriteQueueStore.getState();
    s.enqueue({ kind: 'task', matterId: 'm1', title: 'T', body: 'B', dueDate: '2026-07-15', sourceRef: 'doc:x' });
    const id = useCrmWriteQueueStore.getState().items[0].id;
    await s.approve([id], '12345');
    expect(crmCreateTask).toHaveBeenCalledWith(
      expect.objectContaining({ householdKey: '12345', matterId: 'm1', title: 'T', description: 'B', dueDate: '2026-07-15' })
    );
    expect(useCrmWriteQueueStore.getState().items[0].status).toBe('sent');
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
    const id = useCrmWriteQueueStore.getState().items[0].id;
    await s.approve([id], '12345');
    const item = useCrmWriteQueueStore.getState().items[0];
    expect(item.status).toBe('verify_pending');
  });

  it('maps a hard failure to status "failed" and records the error message', async () => {
    vi.mocked(crmCreateNote).mockRejectedValueOnce(new Error('CRM write failed (HTTP 500)'));
    const s = useCrmWriteQueueStore.getState();
    s.enqueue({ kind: 'note', matterId: 'm1', title: 'T', body: 'B', sourceRef: 'doc:x' });
    const id = useCrmWriteQueueStore.getState().items[0].id;
    await s.approve([id], '12345');
    const item = useCrmWriteQueueStore.getState().items[0];
    expect(item.status).toBe('failed');
    expect(item.error).toContain('500');
  });

  it('sets status "sending" while the request is in flight', async () => {
    let resolveFn!: (v: { remoteId: string; deduped: boolean }) => void;
    vi.mocked(crmCreateNote).mockReturnValueOnce(new Promise((r) => (resolveFn = r)));
    const s = useCrmWriteQueueStore.getState();
    s.enqueue({ kind: 'note', matterId: 'm1', title: 'T', body: 'B', sourceRef: 'doc:x' });
    const id = useCrmWriteQueueStore.getState().items[0].id;
    const p = s.approve([id], '12345');
    await new Promise((r) => setTimeout(r, 0));
    expect(useCrmWriteQueueStore.getState().items[0].status).toBe('sending');
    resolveFn({ remoteId: '555', deduped: false });
    await p;
    expect(useCrmWriteQueueStore.getState().items[0].status).toBe('sent');
  });
});

describe('dismiss', () => {
  it('removes an item without sending anything', () => {
    const s = useCrmWriteQueueStore.getState();
    s.enqueue({ kind: 'note', matterId: 'm1', title: 'T', body: 'B', sourceRef: 'doc:x' });
    const id = useCrmWriteQueueStore.getState().items[0].id;
    s.dismiss(id);
    expect(useCrmWriteQueueStore.getState().items).toHaveLength(0);
    expect(crmCreateNote).not.toHaveBeenCalled();
  });
});
