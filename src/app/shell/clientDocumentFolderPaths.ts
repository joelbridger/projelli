import { deriveNewClientFolderPath } from '@/features/matters/matterManagerDialogHelpers';
import type { Matter } from '@/platform/types/matter';

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
