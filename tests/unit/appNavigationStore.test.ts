import { beforeEach, describe, expect, it } from 'vitest';
import { useAppNavigationStore, type AppNavigationSnapshot } from '@/platform/state/appNavigationStore';

function snap(overrides: Partial<AppNavigationSnapshot> = {}): AppNavigationSnapshot {
  return {
    sidebarActiveTab: 'search',
    activeMatterId: 'm1',
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

  it('pushes and restores the last app snapshot', () => {
    const previous = snap({ sidebarActiveTab: 'search', activeTabPath: 'ask-thread-1' });
    useAppNavigationStore.getState().push(previous);

    expect(useAppNavigationStore.getState().stack).toHaveLength(1);
    expect(useAppNavigationStore.getState().pop()).toEqual(previous);
    expect(useAppNavigationStore.getState().stack).toHaveLength(0);
  });

  it('does not add the same snapshot twice in a row', () => {
    const previous = snap({ sidebarActiveTab: 'files', documentsView: 'editor', activeTabPath: '/ws/doc.docx' });

    useAppNavigationStore.getState().push(previous);
    useAppNavigationStore.getState().push(previous);

    expect(useAppNavigationStore.getState().stack).toHaveLength(1);
  });
});

