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
  // Task 9c: field-level blended updates. Not implemented yet — this mock
  // exists so the RED-phase tests below fail for the right reason (the
  // store doesn't route kind:'field' to it), not a module-resolution error.
  crmUpdateField: vi.fn().mockResolvedValue({ remoteId: '557', deduped: false }),
}));

import { useCrmWriteQueueStore } from '@/platform/state/crmWriteQueueStore';
import { crmCreateNote, crmCreateTask, crmUpdateField } from '@/platform/utils/wealthbox-commands';
import type { Provider } from '@/platform/providers/Provider';

function resetStore() {
  useCrmWriteQueueStore.setState({ items: [] });
}

beforeEach(() => {
  resetStore();
  vi.mocked(crmCreateNote).mockClear();
  vi.mocked(crmCreateTask).mockClear();
  vi.mocked(crmUpdateField).mockClear();
  vi.mocked(crmCreateNote).mockResolvedValue({ remoteId: '555', deduped: false });
  vi.mocked(crmCreateTask).mockResolvedValue({ remoteId: '556', deduped: false });
  vi.mocked(crmUpdateField).mockResolvedValue({ remoteId: '557', deduped: false });
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

// ─────────────────────────────────────────────────────────────────────────
// Task 9c: field-level blended updates (RED phase — no implementation yet).
// The Rust `crm_update_field` command doesn't exist on this branch; these
// tests assert the TS contract the store MUST satisfy once it does. They
// fail today because the store has no `kind: 'field'` branch and
// `crmUpdateField` isn't a real export — both true failures, not
// module-resolution noise (the mock above supplies a fake export so vitest
// can at least import the module and hit the real assertion).
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

  it('approve() on a field item calls crmUpdateField (never crmCreateNote/crmCreateTask)', async () => {
    const s = useCrmWriteQueueStore.getState();
    s.enqueue(fieldItem());
    const id = useCrmWriteQueueStore.getState().items[0]!.id;
    await s.approve([id], '12345');

    expect(crmUpdateField).toHaveBeenCalledTimes(1);
    expect(crmCreateNote).not.toHaveBeenCalled();
    expect(crmCreateTask).not.toHaveBeenCalled();
    expect(crmUpdateField).toHaveBeenCalledWith(
      expect.objectContaining({
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
    vi.mocked(crmUpdateField).mockRejectedValueOnce(new Error('CRM write failed (HTTP 500)'));
    const s = useCrmWriteQueueStore.getState();
    s.enqueue(fieldItem());
    const id = useCrmWriteQueueStore.getState().items[0]!.id;

    await s.approve([id], '12345');
    expect(useCrmWriteQueueStore.getState().items[0]!.status).toBe('failed');
    const firstRequestedAt = useCrmWriteQueueStore.getState().items[0]!.requestedAt;

    await s.approve([id], '12345');
    expect(useCrmWriteQueueStore.getState().items[0]!.status).toBe('sent');
    expect(useCrmWriteQueueStore.getState().items[0]!.requestedAt).toBe(firstRequestedAt);
    expect(crmUpdateField).toHaveBeenCalledTimes(2);
    expect(vi.mocked(crmUpdateField).mock.calls[1]![0].requestedAt).toBe(firstRequestedAt);
  });

  // The stale-guard: the backend re-fetches the field at approve time and
  // flips to verify_pending (never blind-overwrites) if it drifted since the
  // proposal was drafted. Reuses the SAME verify_pending machinery already
  // built for note/task — sendOne's error-string routing is kind-agnostic.
  it('maps a VerifyPending error on a field item to status "verify_pending"', async () => {
    vi.mocked(crmUpdateField).mockRejectedValueOnce(
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
  it('parses a real StaleFieldValue rejection into status "stale" and refreshes existingValue', async () => {
    vi.mocked(crmUpdateField).mockRejectedValueOnce(
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
    // The user's edited blend is left alone — theirs to keep, adjust, or
    // replace once they see what changed, never silently discarded.
    expect(item.finalValue).toBe('Robert owns a rental property. Retiring spring 2027.');
  });

  // Defense-in-depth: the card is expected to disable Approve while
  // finalValue is blank, but the store must never fire a network call for a
  // field item with nothing to write even if that guard is somehow bypassed.
  it('never calls crmUpdateField for a field item whose finalValue is blank', async () => {
    const s = useCrmWriteQueueStore.getState();
    s.enqueue(fieldItem({ finalValue: '   ' }));
    const id = useCrmWriteQueueStore.getState().items[0]!.id;
    await s.approve([id], '12345');
    expect(crmUpdateField).not.toHaveBeenCalled();
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
  it('computes finalValue via the scalar-replace path and lands a sendable item', async () => {
    const s = useCrmWriteQueueStore.getState();
    await s.enqueueFieldUpdate({
      matterId: 'm1',
      title: 'Risk tolerance',
      field: 'risk_tolerance',
      existingValue: 'Moderate',
      newValue: 'Aggressive',
      sourceRef: 'meeting:2026-06-30',
    });
    const item = useCrmWriteQueueStore.getState().items[0]!;
    expect(item.kind).toBe('field');
    expect(item.finalValue).toBe('Aggressive');
    expect(item.status).toBe('proposed');
  });

  it('computes finalValue via the narrative-merge path with a provider', async () => {
    const sendMessage = vi.fn().mockResolvedValue({ content: 'Merged text.' });
    const provider = { sendMessage } as unknown as Provider;
    const s = useCrmWriteQueueStore.getState();
    await s.enqueueFieldUpdate({
      matterId: 'm1',
      title: 'Background information',
      field: 'background_information',
      existingValue: 'A',
      newValue: 'B',
      sourceRef: 'meeting:2026-06-30',
      provider,
    });
    expect(sendMessage).toHaveBeenCalledTimes(1);
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
      title: 'Risk tolerance',
      field: 'risk_tolerance',
      existingValue: 'Moderate',
      newValue: 'Aggressive',
      sourceRef: 'meeting:2026-06-30',
    });
    const id = useCrmWriteQueueStore.getState().items[0]!.id;
    await s.approve([id], '12345');
    expect(crmUpdateField).toHaveBeenCalledWith(expect.objectContaining({ finalValue: 'Aggressive' }));
    expect(useCrmWriteQueueStore.getState().items[0]!.status).toBe('sent');
  });
});
