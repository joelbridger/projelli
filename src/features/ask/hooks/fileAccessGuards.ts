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
import { sameOrInside } from '@/platform/fs/appPath';
import {
  useEditorStore,
  tabHasUnsavedEdits,
  isFileOpenInEditor,
  hasOpenDescendant,
} from '@/platform/state/editorStore';
import { getEntityLabelEnglish } from '@/platform/hooks/useEntityLabel';
import { readSelectionOperationDecision } from '@/platform/client-context';

function readFileToolSelection(scope: ActiveMatterScope) {
  return readSelectionOperationDecision({
    operationClass: 'matter-scoped',
    allowAllMatters: true,
    expectedScope: scope.toolActiveMatterId
      ? { kind: 'matter', matterId: scope.toolActiveMatterId }
      : { kind: 'all-matters' },
    requireFollowerAgreement: true,
  });
}

function assertFileToolSelection(scope: ActiveMatterScope): void {
  const decision = readFileToolSelection(scope);
  if (decision.kind === 'refused') throw new Error(decision.message);
}

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
  const decision = readSelectionOperationDecision({
    operationClass: 'matter-scoped',
    allowAllMatters: true,
    expectedScope: toolActiveMatterId
      ? { kind: 'matter', matterId: toolActiveMatterId }
      : { kind: 'all-matters' },
    requireFollowerAgreement: true,
  });
  if (decision.kind === 'refused') return false;
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
  assertFileToolSelection(scope);
  const { toolActiveMatterId, toolMatters, activeMatterName } = scope;
  if (pathInActiveMatter(absPath, toolActiveMatterId, toolMatters)) return;
  // Distinguish a '..' traversal (rejected in any scope) from a genuine
  // cross-matter access (only blocked when a specific matter is active).
  if (relativePath.split(/[\\/]/).some((seg) => seg === '..')) {
    throw new Error(`Access denied: path "${relativePath}" must not contain "..".`);
  }
  throw new Error(
    `Access denied: "${relativePath}" is outside the active ${getEntityLabelEnglish().one} (${activeMatterName ?? 'none'}). ` +
      `Switch the chat scope to "All ${getEntityLabelEnglish().other}" to work across ${getEntityLabelEnglish().other}.`,
  );
}

/**
 * F2.5 — fail-closed pre-check for `list_files` BEFORE it touches the
 * filesystem. `read_file` / `write_file` / etc. call `assertInActiveMatter` on a
 * FILE path (always meant to be inside the matter). A directory listing is
 * different: the model may legitimately list an ANCESTOR of the matter's folder
 * to navigate DOWN into it (see the `visibleInScope` post-filter, Codex review
 * #5). So a plain `assertInActiveMatter(dir)` would wrongly reject that
 * navigation.
 *
 * This guard gives `list_files` the SAME protection the other tools get —
 * rejecting `..` traversal and cross-matter access BEFORE the FS call (the eval
 * finding: the old code only did `startsWith(rootPath)`, which a `..` segment
 * slips past, and it touched the FS before filtering) — while still permitting
 * ancestor navigation. The result set is still narrowed by `visibleInScope`
 * afterwards (defense-in-depth).
 */
export function assertDirInActiveMatter(
  absDir: string,
  relativePath: string,
  scope: ActiveMatterScope,
  activeMatterFolders: string[],
): void {
  // Fail closed on any '..' traversal segment BEFORE the FS is touched — this is
  // the core fix (the old startsWith check could not catch it). Rejected in any
  // scope, exactly like assertInActiveMatter.
  if (relativePath.split(/[\\/]/).some((seg) => seg === '..')) {
    throw new Error(`Access denied: path "${relativePath}" must not contain "..".`);
  }
  assertFileToolSelection(scope);
  const { toolActiveMatterId, toolMatters, activeMatterName } = scope;
  // All-clients scope is workspace-wide, matching all-matters retrieval.
  if (!toolActiveMatterId) return;
  // Inside the active matter → allowed.
  if (pathInActiveMatter(absDir, toolActiveMatterId, toolMatters)) return;
  // An ANCESTOR of one of the matter's folders → allowed so the model can walk
  // DOWN into a nested matter (e.g. list "/ws" to reach "/ws/Clients/Acme").
  // Use the shared cross-platform containment predicate (handles `\` vs `/`,
  // drive/UNC roots, trailing separators, segment boundaries) rather than a raw
  // string prefix — a raw prefix breaks on Windows where the workspace root can
  // carry backslashes while `Matter.folderPaths` are forward-slash normalized
  // (Codex review). `sameOrInside(absDir, f)` is true when folder `f` is `absDir`
  // itself or lives inside it — i.e. `absDir` is that folder or an ancestor of it.
  if (activeMatterFolders.some((f) => sameOrInside(absDir, f))) return;
  // Otherwise it's a sibling / other-matter directory — refuse before listing it.
  throw new Error(
    `Access denied: "${relativePath}" is outside the active ${getEntityLabelEnglish().one} (${activeMatterName ?? 'none'}). ` +
      `Switch the chat scope to "All ${getEntityLabelEnglish().other}" to work across ${getEntityLabelEnglish().other}.`,
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
