/**
 * Perf (P1.2) — the debounced tab-persist subscription in editorStore.ts
 * only ever writes LAYOUT fields (path/name/groupId/type/metadata — see
 * `saveWorkspaceState`), never `content`/`isDirty`. But it used to detect
 * "did anything change" via `state.openTabs !== prevState.openTabs`, which
 * is true on every keystroke too (`updateContent` replaces the whole array).
 * That scheduled a save (and spammed a console.log) on every character
 * typed, even though the save itself never persisted the new character.
 *
 * These tests drive the real module-level subscription (not a mock) and
 * assert that pure content edits never reach `localStorage.setItem`, while
 * a genuine layout change (a new tab opening) still does.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useEditorStore } from '@/platform/state/editorStore';
import { useWorkspaceStore } from '@/platform/fs/workspaceStore';

const ROOT = '/ws/perf-debounce-test';

describe('editorStore tab-persist debounce — layout-only change detection', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useEditorStore.getState().clearTabState();
    useWorkspaceStore.setState({ rootPath: ROOT });
  });

  afterEach(() => {
    vi.useRealTimers();
    useWorkspaceStore.setState({ rootPath: null });
  });

  it('does not schedule a persisted save for content-only edits, but does for a real layout change', async () => {
    useEditorStore.getState().openFile(`${ROOT}/notes.md`, 'notes.md', 'v0');
    // Let the initial open's debounced save flush before we start counting.
    await vi.advanceTimersByTimeAsync(500);

    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem');

    // Five "keystrokes" — each replaces the whole openTabs array (a new
    // object for the edited tab) but touches no layout field.
    for (let i = 1; i <= 5; i++) {
      useEditorStore.getState().updateContent(`${ROOT}/notes.md`, `v${i}`);
    }
    await vi.advanceTimersByTimeAsync(500);
    expect(setItemSpy).not.toHaveBeenCalled();

    // A genuine layout change — opening a second tab — SHOULD still persist.
    useEditorStore.getState().openFile(`${ROOT}/second.md`, 'second.md', 'hello');
    await vi.advanceTimersByTimeAsync(500);
    expect(setItemSpy).toHaveBeenCalled();

    setItemSpy.mockRestore();
  });
});
