/**
 * QA-34 (P0 silent data loss): the docxSaveRegistry bridge + its integration
 * with flushAllDirtyTabs. A `.docx` never marks its store tab dirty (it saves
 * directly via the engine), so without this bridge the app's save-integrity
 * guards (quit/switch flush, close confirm) see an unsaved `.docx` as CLEAN and
 * silently discard it. These tests pin that the registry mirrors the editor's
 * real state and that flushAllDirtyTabs forces registered `.docx` editors to
 * save on a workspace switch / app close.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  registerDocxSaver,
  updateDocxSaveState,
  getDocxSaveState,
  isDocxUnsaved,
  isDocxRegistered,
  hasAnyUnsavedDocx,
  hasFailingDocxSave,
  closeDocxTabSafely,
  unsavedDocxPaths,
  flushDocx,
  flushAllDocx,
  __resetDocxSaveRegistry,
} from '@/platform/fs/docxSaveRegistry';
import { flushAllDirtyTabs, flushTabForClose, setActiveWorkspaceService } from '@/app/fileOps/flushDirtyTabs';
import { useEditorStore, setBeforeDocxClose } from '@/platform/state/editorStore';
import type { WorkspaceService } from '@/platform/fs/WorkspaceService';

describe('docxSaveRegistry (QA-34)', () => {
  beforeEach(() => {
    __resetDocxSaveRegistry();
  });

  it('mirrors a .docx editor’s live save state and reports it as unsaved', () => {
    registerDocxSaver('/ws/a.docx', async () => true);
    // Freshly registered: clean.
    expect(isDocxUnsaved('/ws/a.docx')).toBe(false);
    expect(hasAnyUnsavedDocx()).toBe(false);

    updateDocxSaveState('/ws/a.docx', { dirty: true, saving: false, error: false });
    expect(isDocxUnsaved('/ws/a.docx')).toBe(true);
    expect(hasAnyUnsavedDocx()).toBe(true);
    expect(unsavedDocxPaths()).toEqual(['/ws/a.docx']);

    // A failing save is ALSO unsaved (never "clean").
    updateDocxSaveState('/ws/a.docx', { dirty: false, saving: false, error: true });
    expect(isDocxUnsaved('/ws/a.docx')).toBe(true);
    expect(getDocxSaveState('/ws/a.docx')).toEqual({ dirty: false, saving: false, error: true });
  });

  it('re-registering the same path PRESERVES live state (no spurious "clean")', () => {
    // Codex review #1: a parent re-render can re-run the editor's register effect
    // without an unmount. Re-registration must NOT wipe a dirty/failing state to
    // clean, or the close/switch/quit guards would miss unsaved work.
    registerDocxSaver('/ws/a.docx', async () => true);
    updateDocxSaveState('/ws/a.docx', { dirty: true, saving: false, error: true });
    expect(isDocxUnsaved('/ws/a.docx')).toBe(true);
    // Re-register with a fresh flush closure (as the editor's effect would).
    registerDocxSaver('/ws/a.docx', async () => false);
    expect(getDocxSaveState('/ws/a.docx')).toEqual({ dirty: true, saving: false, error: true });
    expect(isDocxUnsaved('/ws/a.docx')).toBe(true);
  });

  it('hasFailingDocxSave is true only when a save has actually FAILED', () => {
    registerDocxSaver('/ws/a.docx', async () => true);
    updateDocxSaveState('/ws/a.docx', { dirty: true, saving: true, error: false });
    expect(hasFailingDocxSave()).toBe(false); // dirty/saving is not "failing"
    updateDocxSaveState('/ws/a.docx', { dirty: true, saving: false, error: true });
    expect(hasFailingDocxSave()).toBe(true);
    updateDocxSaveState('/ws/a.docx', { dirty: false, saving: false, error: false });
    expect(hasFailingDocxSave()).toBe(false);
  });

  describe('closeTab .docx interceptor (covers Ctrl+W / command palette / right-click)', () => {
    beforeEach(() => {
      __resetDocxSaveRegistry();
      useEditorStore.getState().clearTabState();
      setBeforeDocxClose(null);
    });

    it('routes a non-discard close of a registered .docx to the interceptor and does NOT remove the tab', () => {
      useEditorStore.getState().openFile('/ws/a.docx', 'a.docx', 'x');
      registerDocxSaver('/ws/a.docx', async () => true);
      const seen: string[] = [];
      setBeforeDocxClose((p) => { seen.push(p); return true; }); // "I took over"

      useEditorStore.getState().closeTab('/ws/a.docx');
      expect(seen).toEqual(['/ws/a.docx']);
      // Interceptor took over → the tab is NOT removed synchronously here.
      expect(useEditorStore.getState().openTabs.some((t) => t.path === '/ws/a.docx')).toBe(true);
    });

    it('a { discard: true } close SKIPS the interceptor and removes the tab', () => {
      useEditorStore.getState().openFile('/ws/a.docx', 'a.docx', 'x');
      registerDocxSaver('/ws/a.docx', async () => true);
      const seen: string[] = [];
      setBeforeDocxClose((p) => { seen.push(p); return true; });

      useEditorStore.getState().closeTab('/ws/a.docx', { discard: true });
      expect(seen).toEqual([]); // interceptor not consulted on a discard close
      expect(useEditorStore.getState().openTabs.some((t) => t.path === '/ws/a.docx')).toBe(false);
    });

    it('a non-.docx close falls through the interceptor and removes the tab normally', () => {
      useEditorStore.getState().openFile('/ws/plain.md', 'plain.md', 'x');
      setBeforeDocxClose(() => false); // not a .docx → not handled
      useEditorStore.getState().closeTab('/ws/plain.md');
      expect(useEditorStore.getState().openTabs.some((t) => t.path === '/ws/plain.md')).toBe(false);
    });
  });

  describe('closeDocxTabSafely (airtight .docx close)', () => {
    it('saves first, then closes with discard (no confirm) when the save succeeds', async () => {
      registerDocxSaver('/ws/a.docx', async () => true);
      updateDocxSaveState('/ws/a.docx', { dirty: true, saving: false, error: false });
      const closeTab = vi.fn();
      const confirmDiscardOnFailure = vi.fn(async () => false);
      const handled = await closeDocxTabSafely('/ws/a.docx', { closeTab, confirmDiscardOnFailure });
      expect(handled).toBe(true);
      expect(closeTab).toHaveBeenCalledWith('/ws/a.docx', { discard: true });
      expect(confirmDiscardOnFailure).not.toHaveBeenCalled();
    });

    it('when the save FAILS and the user keeps the tab, it does NOT close (no data loss)', async () => {
      registerDocxSaver('/ws/a.docx', async () => false); // locked file
      updateDocxSaveState('/ws/a.docx', { dirty: true, saving: false, error: true });
      const closeTab = vi.fn();
      const confirmDiscardOnFailure = vi.fn(async () => false); // "Keep open"
      const handled = await closeDocxTabSafely('/ws/a.docx', { closeTab, confirmDiscardOnFailure });
      expect(handled).toBe(true);
      expect(confirmDiscardOnFailure).toHaveBeenCalledOnce();
      expect(closeTab).not.toHaveBeenCalled(); // stays open — editor keeps the doc safe
    });

    it('when the save FAILS and the user chooses discard, it closes with discard', async () => {
      registerDocxSaver('/ws/a.docx', async () => false);
      updateDocxSaveState('/ws/a.docx', { dirty: true, saving: false, error: true });
      const closeTab = vi.fn();
      const confirmDiscardOnFailure = vi.fn(async () => true); // "Close and lose changes"
      await closeDocxTabSafely('/ws/a.docx', { closeTab, confirmDiscardOnFailure });
      expect(closeTab).toHaveBeenCalledWith('/ws/a.docx', { discard: true });
    });

    it('returns false for a non-.docx (unregistered) path so the caller does the normal close', async () => {
      const closeTab = vi.fn();
      const handled = await closeDocxTabSafely('/ws/plain.md', {
        closeTab,
        confirmDiscardOnFailure: async () => false,
      });
      expect(handled).toBe(false);
      expect(closeTab).not.toHaveBeenCalled();
    });

    // Cleanup batch 4 / QA-43: a successful close must tear the session down
    // (not just remove the tab) — otherwise a session that recovered a save
    // in the BACKGROUND, with its tab never re-opened, is registered forever
    // once docxSaveSession.ts stopped self-disposing on success (that
    // self-dispose was itself the QA-43 root cause, so it's gone for good).
    it('a successful close disposes the session (via its discard hook), not just the tab', async () => {
      const discard = vi.fn();
      registerDocxSaver('/ws/a.docx', async () => true, discard);
      updateDocxSaveState('/ws/a.docx', { dirty: false, saving: false, error: false });
      const closeTab = vi.fn();
      const handled = await closeDocxTabSafely('/ws/a.docx', {
        closeTab,
        confirmDiscardOnFailure: async () => false,
      });
      expect(handled).toBe(true);
      expect(closeTab).toHaveBeenCalledWith('/ws/a.docx', { discard: true });
      expect(discard).toHaveBeenCalledOnce();
      expect(isDocxRegistered('/ws/a.docx')).toBe(false);
    });
  });

  it('unregister removes the entry so a closed editor is no longer "unsaved"', () => {
    const unregister = registerDocxSaver('/ws/a.docx', async () => true);
    updateDocxSaveState('/ws/a.docx', { dirty: true, saving: false, error: false });
    expect(hasAnyUnsavedDocx()).toBe(true);
    unregister();
    expect(getDocxSaveState('/ws/a.docx')).toBeUndefined();
    expect(hasAnyUnsavedDocx()).toBe(false);
  });

  it('flushDocx runs the registered save and reports success/failure', async () => {
    const okFlush = vi.fn(async () => true);
    registerDocxSaver('/ws/ok.docx', okFlush);
    expect(await flushDocx('/ws/ok.docx')).toBe(true);
    expect(okFlush).toHaveBeenCalledOnce();

    registerDocxSaver('/ws/bad.docx', async () => false);
    expect(await flushDocx('/ws/bad.docx')).toBe(false);

    // Unregistered path: nothing to flush → treated as safe.
    expect(await flushDocx('/ws/none.docx')).toBe(true);
  });

  it('flushAllDocx returns the paths that could NOT be saved', async () => {
    registerDocxSaver('/ws/ok.docx', async () => true);
    registerDocxSaver('/ws/locked.docx', async () => false);
    registerDocxSaver('/ws/throws.docx', async () => {
      throw new Error('boom');
    });
    const failed = await flushAllDocx();
    expect(failed.sort()).toEqual(['/ws/locked.docx', '/ws/throws.docx']);
  });

  it('flushTabForClose forces an unsaved .docx to save on close (both tab strips route here)', async () => {
    __resetDocxSaveRegistry();
    useEditorStore.getState().clearTabState();
    const docxFlush = vi.fn(async () => true);
    registerDocxSaver('/ws/brief.docx', docxFlush);
    updateDocxSaveState('/ws/brief.docx', { dirty: true, saving: false, error: true });

    await flushTabForClose('/ws/brief.docx', null);
    // Even with no store service and no dirty store tab, the .docx save runs.
    expect(docxFlush).toHaveBeenCalledOnce();
  });

  it('flushTabForClose routes any registered .docx through its flush (which self-decides clean vs dirty)', async () => {
    // The flush is ALWAYS called for a registered .docx — the real editor's flush
    // internally short-circuits when clean (and checks a pending debounce the
    // registry state can't see). A clean flush returns true → no warning.
    __resetDocxSaveRegistry();
    useEditorStore.getState().clearTabState();
    const docxFlush = vi.fn(async () => true); // models a clean/successful flush
    registerDocxSaver('/ws/clean.docx', docxFlush);
    await flushTabForClose('/ws/clean.docx', null);
    expect(docxFlush).toHaveBeenCalledOnce();
  });

  it('flushTabForClose leaves non-.docx (unregistered) paths to the store-tab flush', async () => {
    __resetDocxSaveRegistry();
    useEditorStore.getState().clearTabState();
    // No registered docx for this path and no dirty store tab → nothing to do,
    // and it must NOT throw or mis-route.
    await expect(flushTabForClose('/ws/plain.md', null)).resolves.toBeUndefined();
  });

  it('flushAllDirtyTabs forces a registered .docx to save (quit/switch data-loss guard)', async () => {
    __resetDocxSaveRegistry();
    useEditorStore.getState().clearTabState();
    const svc = { writeFile: vi.fn(async () => {}), writeFileBinary: vi.fn(async () => {}) } as unknown as WorkspaceService;
    setActiveWorkspaceService(svc);

    const docxFlush = vi.fn(async () => true);
    registerDocxSaver('/ws/brief.docx', docxFlush);
    updateDocxSaveState('/ws/brief.docx', { dirty: true, saving: false, error: false });

    await flushAllDirtyTabs(svc);

    // The .docx editor's own save was invoked even though it is NOT a dirty store tab.
    expect(docxFlush).toHaveBeenCalledOnce();
  });
});
