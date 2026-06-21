/**
 * BUG-045 — revision-checked markSaved. A save that finishes AFTER the user has
 * typed more must NOT mark the tab clean (that would hide unsaved edits and they
 * could be lost on close). The editor store bumps a `rev` on every edit; a save
 * captures the rev it persisted; markSaved(path, rev) clears the dirty flag only
 * if the tab is still at that rev.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useEditorStore } from '@/platform/state/editorStore';

const P = '/ws/memo.md';

describe('editorStore — revision-checked markSaved (BUG-045)', () => {
  beforeEach(() => {
    useEditorStore.getState().clearTabState();
  });

  function tab() {
    return useEditorStore.getState().openTabs.find((t) => t.path === P);
  }

  it('updateContent bumps the revision and marks dirty', () => {
    useEditorStore.getState().openFile(P, 'memo.md', 'v0');
    const r0 = tab()?.rev ?? 0;
    useEditorStore.getState().updateContent(P, 'v1');
    expect(tab()?.isDirty).toBe(true);
    expect(tab()?.rev).toBe(r0 + 1);
    useEditorStore.getState().updateContent(P, 'v2');
    expect(tab()?.rev).toBe(r0 + 2);
  });

  it('keeps the tab DIRTY when a stale save reports completion (the data-loss guard)', () => {
    useEditorStore.getState().openFile(P, 'memo.md', 'v0');
    useEditorStore.getState().updateContent(P, 'v1'); // rev = 1, the save starts for rev 1
    const savingRev = tab()!.rev!;
    // ...user types more WHILE the rev-1 write is in flight...
    useEditorStore.getState().updateContent(P, 'v2'); // rev = 2
    // The rev-1 write finishes and reports done:
    useEditorStore.getState().markSaved(P, savingRev);
    // Must stay dirty — v2 is not on disk yet.
    expect(tab()?.isDirty).toBe(true);
  });

  it('marks clean when the save matches the current revision', () => {
    useEditorStore.getState().openFile(P, 'memo.md', 'v0');
    useEditorStore.getState().updateContent(P, 'v1');
    const rev = tab()!.rev!;
    useEditorStore.getState().markSaved(P, rev);
    expect(tab()?.isDirty).toBe(false);
    expect(tab()?.lastSaved).toBeTypeOf('number');
  });

  it('a no-rev markSaved still clears unconditionally (backward compatible)', () => {
    useEditorStore.getState().openFile(P, 'memo.md', 'v0');
    useEditorStore.getState().updateContent(P, 'v1');
    useEditorStore.getState().markSaved(P); // legacy caller (e.g. workflow writes)
    expect(tab()?.isDirty).toBe(false);
  });
});
