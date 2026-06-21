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
import { isBinaryFile } from '@/platform/utils/file-utils';
import { dataUrlToArrayBuffer } from '@/platform/utils/spreadsheet-io';
import type { WorkspaceService } from '@/platform/fs/WorkspaceService';

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

/** Flush ONE tab by path if it is currently dirty. Best-effort. */
export async function flushTab(service: WorkspaceService, path: string): Promise<void> {
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
 * Flush ALL currently-dirty tabs and wait for every write to land. Call this
 * before a workspace switch or app close. Never throws.
 */
export async function flushAllDirtyTabs(service: WorkspaceService): Promise<void> {
  const dirty = useEditorStore.getState().openTabs.filter((t) => t.isDirty);
  await Promise.all(dirty.map((t) => flushTab(service, t.path)));
  await writeCoordinator.drain();
}
