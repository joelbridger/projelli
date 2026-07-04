/**
 * flushDirtyTabs (BUG-046) — force dirty editor tabs to disk BEFORE a transition
 * that would otherwise drop their unsaved content: a workspace switch (which
 * clears all tabs), closing a tab, or the app closing / reloading. The 2s
 * autosave is not enough — a user who types and immediately closes/switches
 * within that window would lose the last edits.
 *
 * All writes route through the per-path `writeCoordinator` (so a flush can't
 * race the autosave) and use the same revision-checked `markSaved` as autosave,
 * so a tab is only marked clean if it's still at the flushed revision. Failures
 * are best-effort: the tab stays dirty (so autosave retries) and never blocks
 * the transition with a throw.
 */
import { useEditorStore } from '@/platform/state/editorStore';
import { writeCoordinator } from '@/platform/fs/writeCoordinator';
import { isBinaryFile, dataUrlToArrayBuffer } from '@/platform/utils/file-utils';
import type { WorkspaceService } from '@/platform/fs/WorkspaceService';
// The active-workspace-service holder now lives in platform/fs (so features may
// use it too, per the layer DAG). Re-exported here so existing app-layer callers
// that import it from this module keep working unchanged.
import { getActiveWorkspaceService, setActiveWorkspaceService } from '@/platform/fs/activeWorkspaceService';
export { getActiveWorkspaceService, setActiveWorkspaceService };

/**
 * Binary-aware tab writer — the single place that decodes a binary editor's
 * `data:...base64,...` tab content back to bytes before hitting disk (so
 * .docx/.xlsx/.pptx aren't stored as a text blob). Shared by the autosave/
 * manual-save `writeTabContent` and the flush paths so they can't drift.
 */
export async function writeTabContentToDisk(
  service: WorkspaceService,
  path: string,
  content: string,
): Promise<void> {
  if (isBinaryFile(path) && content.startsWith('data:')) {
    await service.writeFileBinary(path, dataUrlToArrayBuffer(content));
  } else {
    await service.writeFile(path, content);
  }
}

/** Flush ONE tab by path if it is currently dirty. Best-effort. Uses the active
 *  workspace service when one isn't passed (so close handlers can call it bare). */
export async function flushTab(path: string, service: WorkspaceService | null = getActiveWorkspaceService()): Promise<void> {
  if (!service) return;
  const tab = useEditorStore.getState().openTabs.find((t) => t.path === path);
  if (!tab || !tab.isDirty) return;
  const rev = tab.rev ?? 0;
  const content = tab.content;
  try {
    await writeCoordinator.enqueue(path, rev, () => writeTabContentToDisk(service, path, content));
    useEditorStore.getState().markSaved(path, rev);
  } catch (err) {
    // Keep the tab dirty so autosave retries; never block the caller.
    console.error('[flushDirtyTabs] flush failed for', path, err);
  }
}

/**
 * Flush a tab that is being CLOSED (Codex review #4). The tab is removed from the
 * store immediately (synchronously, by closeTab), so if this asynchronous write
 * then FAILS the edit would be silently lost — there'd be no dirty tab left for
 * autosave to retry. To prevent that, this captures the tab's full state up
 * front and, on failure, RE-OPENS the tab (dirty) and warns the user instead of
 * dropping their work. On success it's a no-op (the tab is already gone).
 */
export async function flushTabForClose(
  path: string,
  service: WorkspaceService | null = getActiveWorkspaceService(),
): Promise<void> {
  if (!service) return;
  const tab = useEditorStore.getState().openTabs.find((t) => t.path === path);
  if (!tab || !tab.isDirty) return;
  // Capture synchronously — the tab is removed right after this hook returns.
  const { content, name, type } = tab;
  const rev = tab.rev ?? 0;
  try {
    await writeCoordinator.enqueue(path, rev, () => writeTabContentToDisk(service, path, content));
    useEditorStore.getState().markSaved(path, rev);
  } catch (err) {
    console.error('[flushDirtyTabs] close-flush failed; reopening tab', path, err);
    const store = useEditorStore.getState();
    if (!store.openTabs.some((t) => t.path === path)) {
      store.openTab(path, name, content, type);
      store.updateContent(path, content); // re-mark dirty so autosave keeps retrying
    }
    if (typeof window !== 'undefined') {
      window.alert(
        `Couldn't save "${name}" while closing it. I've reopened it so you don't lose your changes.`,
      );
    }
  }
}

/**
 * Flush ALL currently-dirty tabs and wait for every write to land. Call this
 * before a workspace switch or app close. Never throws.
 */
export async function flushAllDirtyTabs(
  service: WorkspaceService | null = getActiveWorkspaceService(),
): Promise<void> {
  if (!service) return;
  const dirty = useEditorStore.getState().openTabs.filter((t) => t.isDirty);
  await Promise.all(dirty.map((t) => flushTab(t.path, service)));
  await writeCoordinator.drain();
}
