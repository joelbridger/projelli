import { beforeEach, describe, expect, it } from 'vitest';
import {
  sanitizeNavigationSnapshotForCurrentMatters,
  useAppNavigationStore,
  type AppNavigationSnapshot,
} from '@/platform/state/appNavigationStore';

function snap(
  overrides: Partial<AppNavigationSnapshot> = {}
): AppNavigationSnapshot {
  return {
    sidebarActiveTab: 'search',
    rootPath: '/workspaces/current',
    activeMatterId: 'm1',
    selectionScope: { kind: 'matter-only', matterId: 'm1' },
    selectionFollowerStatus: 'converged',
    clientMapHubId: null,
    clientMapHubTab: null,
    documentsView: 'browser',
    activeTabPath: null,
    mattersSurfaceMode: 'client-map',
    ...overrides,
  };
}

describe('app navigation history stack', () => {
  beforeEach(() => {
    useAppNavigationStore.getState().clear();
  });

  it('starts disabled because there is no previous place to return to', () => {
    expect(useAppNavigationStore.getState().stack).toHaveLength(0);
    expect(useAppNavigationStore.getState().pop()).toBeNull();
  });

  it('does not add authority fields to a legacy flag-off snapshot', () => {
    const legacy = snap();
    delete legacy.selectionScope;
    delete legacy.selectionFollowerStatus;

    const restored = sanitizeNavigationSnapshotForCurrentMatters(
      legacy,
      [{ id: 'm1' }],
      '/workspaces/current'
    );

    expect(restored).toEqual(legacy);
    expect(restored).not.toHaveProperty('selectionScope');
    expect(restored).not.toHaveProperty('selectionFollowerStatus');
  });

  it('pushes and restores the last app snapshot', () => {
    const previous = snap({
      sidebarActiveTab: 'search',
      activeTabPath: 'ask-thread-1',
    });
    useAppNavigationStore.getState().push(previous);

    expect(useAppNavigationStore.getState().stack).toHaveLength(1);
    expect(useAppNavigationStore.getState().pop()).toEqual(previous);
    expect(useAppNavigationStore.getState().stack).toHaveLength(0);
  });

  it('does not add the same snapshot twice in a row', () => {
    const previous = snap({
      sidebarActiveTab: 'files',
      documentsView: 'editor',
      activeTabPath: '/ws/doc.docx',
    });

    useAppNavigationStore.getState().push(previous);
    useAppNavigationStore.getState().push(previous);

    expect(useAppNavigationStore.getState().stack).toHaveLength(1);
  });

  it('caps Back history to the last 50 places', () => {
    for (let i = 0; i < 55; i += 1) {
      useAppNavigationStore
        .getState()
        .push(
          snap({ activeTabPath: `/workspaces/current/doc-${String(i)}.docx` })
        );
    }

    expect(useAppNavigationStore.getState().stack).toHaveLength(50);
    expect(useAppNavigationStore.getState().stack[0]?.activeTabPath).toBe(
      '/workspaces/current/doc-5.docx'
    );
    expect(useAppNavigationStore.getState().stack[49]?.activeTabPath).toBe(
      '/workspaces/current/doc-54.docx'
    );
  });

  it('rejects stale client hub ids before restoring a popped snapshot', () => {
    const restored = sanitizeNavigationSnapshotForCurrentMatters(
      snap({
        activeMatterId: 'm1',
        clientMapHubId: 'deleted-client',
        clientMapHubTab: 'documents',
      }),
      [{ id: 'm1' }],
      '/workspaces/current'
    );

    expect(restored).toMatchObject({
      activeMatterId: 'm1',
      clientMapHubId: null,
      clientMapHubTab: null,
    });
  });

  it('moves Back history for a deleted client to All Clients instead of an empty client canvas', () => {
    const restored = sanitizeNavigationSnapshotForCurrentMatters(
      snap({
        sidebarActiveTab: 'matters',
        activeMatterId: 'deleted-client',
        selectionScope: { kind: 'matter-only', matterId: 'deleted-client' },
        clientMapHubId: 'deleted-client',
        clientMapHubTab: 'overview',
        mattersSurfaceMode: 'client-map',
      }),
      [{ id: 'm1' }],
      '/workspaces/current'
    );

    expect(restored).toMatchObject({
      activeMatterId: null,
      selectionScope: { kind: 'all-matters' },
      clientMapHubId: null,
      clientMapHubTab: null,
      mattersSurfaceMode: 'all-clients',
    });
  });

  it('treats archived clients as dead for Back history restore', () => {
    const restored = sanitizeNavigationSnapshotForCurrentMatters(
      snap({
        sidebarActiveTab: 'matters',
        activeMatterId: 'archived-client',
        selectionScope: { kind: 'matter-only', matterId: 'archived-client' },
        clientMapHubId: 'archived-client',
        clientMapHubTab: 'overview',
        mattersSurfaceMode: 'client-map',
      }),
      [{ id: 'archived-client', archived: true }],
      '/workspaces/current'
    );

    expect(restored).toMatchObject({
      activeMatterId: null,
      selectionScope: { kind: 'all-matters' },
      clientMapHubId: null,
      clientMapHubTab: null,
      mattersSurfaceMode: 'all-clients',
    });
  });

  it('keeps blocked navigation memory distinct from all matters', () => {
    const restored = sanitizeNavigationSnapshotForCurrentMatters(
      snap({
        activeMatterId: null,
        selectionScope: { kind: 'blocked-unresolved' },
        selectionFollowerStatus: 'stale',
        clientMapHubId: null,
        mattersSurfaceMode: 'client-map',
      }),
      [{ id: 'm1' }],
      '/workspaces/current'
    );

    expect(restored).toMatchObject({
      activeMatterId: null,
      selectionScope: { kind: 'blocked-unresolved' },
      selectionFollowerStatus: 'stale',
    });
  });

  it('rejects snapshots from another workspace', () => {
    const restored = sanitizeNavigationSnapshotForCurrentMatters(
      snap({ rootPath: '/workspaces/old', activeMatterId: 'm1' }),
      [{ id: 'm1' }],
      '/workspaces/current'
    );

    expect(restored).toBeNull();
  });
});
