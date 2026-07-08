/**
 * Codex review fix (High): deleting a client must prune it from every rail group
 * — and the pruning must live in the store's `deleteMatter` (not a single UI
 * call site), so EVERY delete path prunes and only after the delete succeeds.
 */

import { beforeEach, describe, it, expect, vi } from 'vitest';

// deleteMatter's browser-mode (no workspace root) path fires these best-effort
// AI-memory purges; stub them so the test doesn't reach Tauri.
vi.mock('@/platform/utils/tauri-commands', () => ({
  ragDeleteMatter: vi.fn(async () => undefined),
}));
vi.mock('@/platform/utils/mail-commands', () => ({
  mailClearMatterFilings: vi.fn(async () => 0),
}));

import { useMatterStore } from '@/platform/matter/matterStore';
import { useClientGroupStore } from '@/platform/matter/clientGroupStore';
import { setActiveWorkspaceScopeRoot } from '@/platform/state/workspaceScope';

beforeEach(() => {
  setActiveWorkspaceScopeRoot(null);
  localStorage.clear();
  useMatterStore.setState({ matters: [], activeMatterId: null });
  useClientGroupStore.setState({ groups: [] });
});

describe('deleteMatter prunes the client from rail groups', () => {
  it('removes the deleted client id from every group it belonged to', () => {
    const m = useMatterStore.getState().createMatter({ name: 'Doomed', client: '' });
    const other = useMatterStore.getState().createMatter({ name: 'Keep', client: '' });

    const a = useClientGroupStore.getState().createGroup('A')!;
    const b = useClientGroupStore.getState().createGroup('B')!;
    useClientGroupStore.getState().setGroupMembers(a.id, [m.id, other.id]);
    useClientGroupStore.getState().setGroupMembers(b.id, [m.id]);

    useMatterStore.getState().deleteMatter(m.id);

    const groups = useClientGroupStore.getState().groups;
    // Deleted client gone from both groups; the other client's membership stays.
    expect(groups.find((g) => g.id === a.id)!.matterIds).toEqual([other.id]);
    expect(groups.find((g) => g.id === b.id)!.matterIds).toEqual([]);
    // The groups themselves survive (an emptied group is not auto-deleted).
    expect(groups).toHaveLength(2);
  });
});
