// fileAccessGuards — the matter-scope + open-editor guards that gate every AI
// file-access tool path in useChatSending.
//
// Extracted VERBATIM from useChatSending.ts so the client-matter ISOLATION
// guards live in one small, testable place. The hook recreates thin closures
// over `pathInActiveMatter` / `assertInActiveMatter` (binding the per-send
// matter scope) and calls `assertNotOpenWithUnsavedEdits` / `assertNoOpenDescendant`
// directly, so every tool-executor call site stays byte-identical.
//
// ⚠️ These are CLIENT-MATTER ISOLATION guards: a behaviour change here is a
// confidentiality leak (a chat scoped to Matter B reaching Matter A's files —
// BUG-036/BUG-037 — or clobbering a user's open, unsaved work — BUG-047/BUG-063).
// The bodies are copied byte-for-byte from the previous revision. Do not
// "improve" them.

import type { Matter } from '@/platform/types/matter';
import { pathInMatterScope } from '@/platform/matter/matterScopeGuard';
import {
  useEditorStore,
  tabHasUnsavedEdits,
  isFileOpenInEditor,
  hasOpenDescendant,
} from '@/platform/state/editorStore';
import { getEntityLabel } from '@/platform/hooks/useEntityLabel';

/**
 * BUG-036 — true when `absPath` is allowed under the active matter scope.
 * Path -> matter uses the same resolveMatterId() the indexer uses (longest
 * mapped folder wins; files outside every matter -> 'unassigned').
 */
export function pathInActiveMatter(
  absPath: string,
  toolActiveMatterId: string | null,
  toolMatters: Matter[],
): boolean {
  return pathInMatterScope(absPath, toolActiveMatterId, toolMatters);
}

/** The per-send matter scope the assert guards close over. */
export interface ActiveMatterScope {
  toolActiveMatterId: string | null;
  toolMatters: Matter[];
  activeMatterName: string | null;
}

/**
 * BUG-036 — in a matter-scoped chat the file tools must respect the SAME
 * boundary as retrieval: the model may only touch files that belong to the
 * active matter. Throws on a cross-matter access (or a '..' traversal).
 */
export function assertInActiveMatter(
  absPath: string,
  relativePath: string,
  scope: ActiveMatterScope,
): void {
  const { toolActiveMatterId, toolMatters, activeMatterName } = scope;
  if (pathInActiveMatter(absPath, toolActiveMatterId, toolMatters)) return;
  // Distinguish a '..' traversal (rejected in any scope) from a genuine
  // cross-matter access (only blocked when a specific matter is active).
  if (relativePath.split(/[\\/]/).some((seg) => seg === '..')) {
    throw new Error(`Access denied: path "${relativePath}" must not contain "..".`);
  }
  throw new Error(
    `Access denied: "${relativePath}" is outside the active ${getEntityLabel().one} (${activeMatterName ?? 'none'}). ` +
      `Switch the chat scope to "All ${getEntityLabel().other}" to work across ${getEntityLabel().other}.`,
  );
}

/**
 * BUG-047: refuse to write/move/delete a file the user has OPEN with UNSAVED
 * edits — otherwise the AI's write clobbers their unsaved work (or the next
 * autosave clobbers the AI's write). Fail closed with a clear message so the
 * model asks the user to save/close it first.
 */
export function assertNotOpenWithUnsavedEdits(absPath: string, relativePath: string): void {
  const tabs = useEditorStore.getState().openTabs;
  if (!isFileOpenInEditor(absPath, tabs)) return;
  if (tabHasUnsavedEdits(absPath, tabs)) {
    throw new Error(
      `Cannot modify "${relativePath}": it's open in the editor with UNSAVED changes. ` +
        `To avoid overwriting the user's work, ask them to save or close it first, then try again.`,
    );
  }
  // BUG-047 #7: even a CLEAN open file is refused — the editor would show
  // stale content after the write, and the user could then clobber it.
  throw new Error(
    `Cannot modify "${relativePath}": it's open in the editor. Ask the user to close it first ` +
      `(or use the in-editor AI to edit an open document) so the editor doesn't show stale content.`,
  );
}

/**
 * BUG-063 sibling: moving/deleting a FOLDER whose child file is open would
 * leave that child tab on a now-invalid path, and the autosave could re-write
 * its stale content back — resurrecting a deleted file or duplicating after a
 * move. Refuse if any descendant is open.
 */
export function assertNoOpenDescendant(absPath: string, relativePath: string): void {
  if (hasOpenDescendant(absPath, useEditorStore.getState().openTabs)) {
    throw new Error(
      `Cannot modify "${relativePath}": a file inside it is open in the editor. Ask the user to ` +
        `close open files under this folder first, so the editor doesn't show (and can't re-save) stale content.`,
    );
  }
}
