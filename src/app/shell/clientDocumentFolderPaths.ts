import { deriveNewClientFolderPath } from '@/features/matters/matterManagerDialogHelpers';
import { pathsEqual, workspacePath } from '@/platform/fs/appPath';
import type { Matter } from '@/platform/types/matter';
import type { FileNode } from '@/platform/types/workspace';

function usableFolderPaths(matter: Matter): string[] {
  return matter.folderPaths.filter((path) => typeof path === 'string' && path.trim().length > 0);
}

export function resolveClientDocumentFolderPaths({
  matter,
  matters,
  workspaceRoot,
}: {
  matter: Matter | null | undefined;
  matters: Matter[];
  workspaceRoot: string | null | undefined;
}): string[] {
  if (!matter) return [];

  const existing = usableFolderPaths(matter);
  if (existing.length > 0) return existing;

  const takenFolderPaths = matters
    .filter((candidate) => candidate.id !== matter.id)
    .flatMap(usableFolderPaths);
  const derived = deriveNewClientFolderPath(
    matter.client,
    matter.name,
    workspaceRoot ?? null,
    takenFolderPaths,
  );

  return derived ? [derived] : [];
}

export function shouldBackfillClientDocumentFolder(
  matter: Matter | null | undefined,
  resolvedFolderPaths: string[],
): matter is Matter {
  return Boolean(matter && usableFolderPaths(matter).length === 0 && resolvedFolderPaths.length > 0);
}

function treeContainsFolderPath(
  nodes: FileNode[],
  folderPath: string,
  workspaceRoot: string | null | undefined,
): boolean {
  const target = workspaceRoot ? workspacePath(workspaceRoot, folderPath) : folderPath;
  for (const node of nodes) {
    if (node.type === 'folder') {
      const nodePath = workspaceRoot ? workspacePath(workspaceRoot, node.path) : node.path;
      if (pathsEqual(nodePath, target)) return true;
      if (node.children && treeContainsFolderPath(node.children, folderPath, workspaceRoot)) {
        return true;
      }
    }
  }
  return false;
}

export function shouldPersistExistingClientDocumentFolder(
  matter: Matter | null | undefined,
  resolvedFolderPaths: string[],
  fileTree: FileNode[],
  workspaceRoot: string | null | undefined,
): matter is Matter {
  return Boolean(
    shouldBackfillClientDocumentFolder(matter, resolvedFolderPaths) &&
      resolvedFolderPaths.every((folderPath) =>
        treeContainsFolderPath(fileTree, folderPath, workspaceRoot),
      ),
  );
}
