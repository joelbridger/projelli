/**
 * BUG-060 — the approval gate that lets the AI tool executor await the user's
 * Approve/Skip decision. Verifies the request→resolve round-trip and the
 * defensive auto-skip when a second request supersedes a pending one.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useAiApprovalStore } from '@/platform/ai/aiApprovalStore';

describe('aiApprovalStore', () => {
  beforeEach(() => {
    // Settle any leftover pending and reset.
    useAiApprovalStore.getState().resolvePending('skip');
    useAiApprovalStore.setState({ pending: null });
  });

  it('request sets a pending approval and resolves with the user decision', async () => {
    const store = useAiApprovalStore.getState();
    const p = store.request({ op: { kind: 'overwrite_file', path: 'a.md' }, binary: false, beforeText: 'old', afterText: 'new' });

    const pending = useAiApprovalStore.getState().pending;
    expect(pending?.op).toEqual({ kind: 'overwrite_file', path: 'a.md' });
    expect(pending?.beforeText).toBe('old');
    expect(pending?.afterText).toBe('new');

    useAiApprovalStore.getState().resolvePending('approve');
    await expect(p).resolves.toBe('approve');
    // pending cleared after resolution
    expect(useAiApprovalStore.getState().pending).toBeNull();
  });

  it('a skip decision resolves the promise with "skip"', async () => {
    const p = useAiApprovalStore.getState().request({ op: { kind: 'delete_file', path: 'x' }, binary: false });
    useAiApprovalStore.getState().resolvePending('skip');
    await expect(p).resolves.toBe('skip');
  });

  it('a second request auto-skips the first so no awaiter hangs', async () => {
    const store = useAiApprovalStore.getState();
    const first = store.request({ op: { kind: 'create_file', path: '1' }, binary: false });
    const second = store.request({ op: { kind: 'create_file', path: '2' }, binary: false });

    // The first is auto-skipped; the second is now pending.
    await expect(first).resolves.toBe('skip');
    expect(useAiApprovalStore.getState().pending?.op).toEqual({ kind: 'create_file', path: '2' });

    useAiApprovalStore.getState().resolvePending('approve');
    await expect(second).resolves.toBe('approve');
  });

  it('resolvePending with nothing pending is a no-op', () => {
    expect(() => useAiApprovalStore.getState().resolvePending('approve')).not.toThrow();
  });
});
