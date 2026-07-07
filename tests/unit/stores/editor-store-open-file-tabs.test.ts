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
});
