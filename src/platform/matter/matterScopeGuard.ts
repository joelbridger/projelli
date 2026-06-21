/**
 * matterScopeGuard — the SHARED predicate for "may this file path be touched
 * under the active matter scope?".
 *
 * The product's core promise is matter-scoped confidentiality: one client's
 * data must never surface inside another matter. RAG retrieval enforces this at
 * the database level, but the AI's file tools (read/list/search/write/move/
 * delete) and the open-file context did NOT — they were bounded only to the
 * workspace root, so a chat scoped to Matter B could reach Matter A's files
 * (BUG-036 / BUG-037). This helper is the single source of truth both call
 * sites use, so they can't drift.
 *
 * Path -> matter uses the same `resolveMatterId` the indexer uses (longest
 * mapped folder wins; files outside every matter resolve to 'unassigned').
 */
import type { Matter } from '@/platform/types/matter';
import { resolveMatterId } from '@/platform/rag/matterResolver';

/**
 * True when `absPath` is allowed under the current scope.
 *
 * - `activeMatterId === null` => all-matters / no active matter: ALWAYS allowed
 *   (matches all-matters RAG retrieval, which is workspace-wide).
 * - otherwise => allowed only if the path resolves to that exact matter.
 *
 * A matter with no mapped folders owns no files, so every file path resolves
 * away from it and is (correctly) disallowed while it is the active scope.
 */
export function pathInMatterScope(
  absPath: string,
  activeMatterId: string | null,
  matters: Matter[],
): boolean {
  // Fail closed on any '..' traversal segment (Codex review #4): the matter
  // check must run on a real in-workspace path, never one that could resolve
  // out of the matter (or the workspace). WorkspaceService's PathValidator also
  // blocks '..', so this is defense-in-depth — but it keeps THIS check honest.
  if (absPath.split(/[\\/]/).some((seg) => seg === '..')) return false;
  if (!activeMatterId) return true;
  return resolveMatterId(absPath, matters) === activeMatterId;
}
