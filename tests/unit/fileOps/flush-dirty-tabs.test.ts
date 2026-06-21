/**
 * BUG-046 — flushDirtyTabs forces unsaved tab content to disk before a
 * transition (workspace switch / app close) that would otherwise drop it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { flushAllDirtyTabs, flushTab, setActiveWorkspaceService } from '@/app/fileOps/flushDirtyTabs';
import { useEditorStore, setBeforeTabClose, tabHasUnsavedEdits } from '@/platform/state/editorStore';
import type { WorkspaceService } from '@/platform/fs/WorkspaceService';

const nextTick = () => new Promise((r) => setTimeout(r, 0));

function mockService() {
  return {
    writeFile: vi.fn(async () => {}),
    writeFileBinary: vi.fn(async () => {}),
  } as unknown as WorkspaceService & {
    writeFile: ReturnType<typeof vi.fn>;
    writeFileBinary: ReturnType<typeof vi.fn>;
  };
}

const tab = (p: string) => useEditorStore.getState().openTabs.find((t) => t.path === p);

describe('flushDirtyTabs (BUG-046)', () => {
  beforeEach(() => {
    useEditorStore.getState().clearTabState();
  });

  it('writes every dirty tab and marks them clean', async () => {
    const svc = mockService();
    useEditorStore.getState().openFile('/ws/a.md', 'a.md', 'a0');
    useEditorStore.getState().openFile('/ws/b.md', 'b.md', 'b0');
    useEditorStore.getState().updateContent('/ws/a.md', 'a1');
    useEditorStore.getState().updateContent('/ws/b.md', 'b1');

    await flushAllDirtyTabs(svc);

    expect(svc.writeFile).toHaveBeenCalledWith('/ws/a.md', 'a1');
    expect(svc.writeFile).toHaveBeenCalledWith('/ws/b.md', 'b1');
    expect(tab('/ws/a.md')?.isDirty).toBe(false);
    expect(tab('/ws/b.md')?.isDirty).toBe(false);
  });

  it('does NOT write a clean tab', async () => {
    const svc = mockService();
    useEditorStore.getState().openFile('/ws/clean.md', 'clean.md', 'x'); // opened, not edited
    await flushAllDirtyTabs(svc);
    expect(svc.writeFile).not.toHaveBeenCalled();
  });

  it('routes a binary (data-URL) tab through the binary writer', async () => {
    const svc = mockService();
    useEditorStore.getState().openFile('/ws/doc.docx', 'doc.docx', '');
    // A data-URL-encoded binary edit (what DocxEditor pushes).
    useEditorStore.getState().updateContent(
      '/ws/doc.docx',
      'data:application/vnd.openxmlformats-officedocument.wordprocessingml.document;base64,UEsDBA==',
    );
    await flushAllDirtyTabs(svc);
    expect(svc.writeFileBinary).toHaveBeenCalledTimes(1);
    expect(svc.writeFileBinary.mock.calls[0][0]).toBe('/ws/doc.docx');
    expect(svc.writeFile).not.toHaveBeenCalled();
    expect(tab('/ws/doc.docx')?.isDirty).toBe(false);
  });

  it('flushTab flushes only the named tab', async () => {
    const svc = mockService();
    useEditorStore.getState().openFile('/ws/a.md', 'a.md', 'a0');
    useEditorStore.getState().openFile('/ws/b.md', 'b.md', 'b0');
    useEditorStore.getState().updateContent('/ws/a.md', 'a1');
    useEditorStore.getState().updateContent('/ws/b.md', 'b1');

    await flushTab('/ws/a.md', svc);

    expect(svc.writeFile).toHaveBeenCalledWith('/ws/a.md', 'a1');
    expect(svc.writeFile).not.toHaveBeenCalledWith('/ws/b.md', 'b1');
    expect(tab('/ws/a.md')?.isDirty).toBe(false);
    expect(tab('/ws/b.md')?.isDirty).toBe(true);
  });

  it('a write failure keeps the tab dirty (best-effort, never throws)', async () => {
    const svc = mockService();
    svc.writeFile.mockRejectedValueOnce(new Error('disk full'));
    useEditorStore.getState().openFile('/ws/a.md', 'a.md', 'a0');
    useEditorStore.getState().updateContent('/ws/a.md', 'a1');

    await expect(flushAllDirtyTabs(svc)).resolves.toBeUndefined();
    expect(tab('/ws/a.md')?.isDirty).toBe(true); // stayed dirty so autosave retries
  });

  it('tabHasUnsavedEdits detects an open dirty tab (BUG-047 guard predicate)', () => {
    const tabs = [
      { path: '/ws/clean.md', isDirty: false },
      { path: '/ws/dirty.md', isDirty: true },
    ];
    expect(tabHasUnsavedEdits('/ws/dirty.md', tabs)).toBe(true);
    expect(tabHasUnsavedEdits('/ws/clean.md', tabs)).toBe(false);
    expect(tabHasUnsavedEdits('/ws/not-open.md', tabs)).toBe(false);
  });

  it('closeTab flushes a dirty tab to disk before removing it (the chokepoint)', async () => {
    const svc = mockService();
    setActiveWorkspaceService(svc);
    setBeforeTabClose((p) => { void flushTab(p); });
    try {
      useEditorStore.getState().openFile('/ws/c.md', 'c.md', 'c0');
      useEditorStore.getState().updateContent('/ws/c.md', 'c-final');
      useEditorStore.getState().closeTab('/ws/c.md');
      // The flush is kicked off synchronously (reads the still-present tab) and
      // completes asynchronously; the tab is removed immediately.
      expect(tab('/ws/c.md')).toBeUndefined();
      await nextTick();
      expect(svc.writeFile).toHaveBeenCalledWith('/ws/c.md', 'c-final');
    } finally {
      setBeforeTabClose(null);
      setActiveWorkspaceService(null);
    }
  });
});
