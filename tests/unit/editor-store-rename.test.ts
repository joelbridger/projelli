import { describe, it, expect, beforeEach } from 'vitest';
import { useEditorStore } from '@/platform/state/editorStore';

describe('editorStore.renameOpenTab', () => {
  beforeEach(() => {
    useEditorStore.getState().clearTabState();
  });

  it('updates an open tab label and path in place after a file-tree rename', () => {
    useEditorStore.getState().openFile('/workspace/docs/notes.md', 'notes.md', 'draft');
    useEditorStore.getState().openFile('/workspace/other.txt', 'other.txt', 'other');
    useEditorStore.setState({
      activeTabPath: '/workspace/docs/notes.md',
      secondaryTabPath: '/workspace/docs/notes.md',
      isSplit: true,
      tabGroups: [{ id: 'group_1', name: 'Matter', collapsed: false }],
      openTabs: useEditorStore.getState().openTabs.map((tab) =>
        tab.path === '/workspace/docs/notes.md'
          ? { ...tab, groupId: 'group_1', isDirty: true }
          : tab,
      ),
    });

    useEditorStore
      .getState()
      .renameOpenTab('/workspace/docs/notes.md', '/workspace/docs/renamed-notes.md', 'renamed-notes.md');

    const state = useEditorStore.getState();
    const renamedTab = state.openTabs.find((tab) => tab.path === '/workspace/docs/renamed-notes.md');
    expect(renamedTab).toMatchObject({
      name: 'renamed-notes.md',
      content: 'draft',
      isDirty: true,
      groupId: 'group_1',
    });
    expect(state.openTabs.some((tab) => tab.path === '/workspace/docs/notes.md')).toBe(false);
    expect(state.activeTabPath).toBe('/workspace/docs/renamed-notes.md');
    expect(state.secondaryTabPath).toBe('/workspace/docs/renamed-notes.md');
    expect(state.tabGroups).toEqual([{ id: 'group_1', name: 'Matter', collapsed: false }]);
  });
});
