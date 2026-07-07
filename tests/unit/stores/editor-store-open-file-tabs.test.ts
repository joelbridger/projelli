import { beforeEach, describe, expect, it } from 'vitest';
import { useEditorStore } from '@/platform/state/editorStore';

describe('editorStore — document tabs', () => {
  beforeEach(() => {
    useEditorStore.getState().clearTabState();
  });

  it('opens different documents in separate tabs, then focuses an already-open document instead of duplicating it', () => {
    const store = useEditorStore.getState();

    store.openFile('/workspace/Clients/Alice/plan.docx', 'plan.docx', 'data:docx-a');
    store.openFile('/workspace/Clients/Alice/notes.md', 'notes.md', '# Notes');

    expect(useEditorStore.getState().openTabs.map((tab) => tab.path)).toEqual([
      '/workspace/Clients/Alice/plan.docx',
      '/workspace/Clients/Alice/notes.md',
    ]);
    expect(useEditorStore.getState().activeTabPath).toBe('/workspace/Clients/Alice/notes.md');

    store.openFile('/workspace/Clients/Alice/plan.docx', 'plan.docx', 'data:docx-a-new');

    expect(useEditorStore.getState().openTabs).toHaveLength(2);
    expect(useEditorStore.getState().activeTabPath).toBe('/workspace/Clients/Alice/plan.docx');
    expect(useEditorStore.getState().openTabs[0]).toMatchObject({
      path: '/workspace/Clients/Alice/plan.docx',
      content: 'data:docx-a-new',
      isDirty: false,
    });
  });

  it('moves one group before another without pulling loose tabs out of their places', () => {
    useEditorStore.setState({
      tabGroups: [
        { id: 'group-1', name: 'Group 1', collapsed: false },
        { id: 'group-2', name: 'Group 2', collapsed: false },
      ],
      openTabs: [
        {
          path: '/workspace/Loose A.md',
          name: 'Loose A.md',
          content: '',
          isDirty: false,
          groupId: null,
          type: 'file',
        },
        {
          path: '/workspace/Group 1.md',
          name: 'Group 1.md',
          content: '',
          isDirty: false,
          groupId: 'group-1',
          type: 'file',
        },
        {
          path: '/workspace/Loose B.md',
          name: 'Loose B.md',
          content: '',
          isDirty: false,
          groupId: null,
          type: 'file',
        },
        {
          path: '/workspace/Group 2.md',
          name: 'Group 2.md',
          content: '',
          isDirty: false,
          groupId: 'group-2',
          type: 'file',
        },
      ],
    });

    useEditorStore.getState().reorderInTabBar(
      { type: 'group', id: 'group-2' },
      { type: 'group', id: 'group-1' },
      'before',
    );

    expect(useEditorStore.getState().openTabs.map((tab) => tab.path)).toEqual([
      '/workspace/Loose A.md',
      '/workspace/Group 2.md',
      '/workspace/Group 1.md',
      '/workspace/Loose B.md',
    ]);
  });
});
