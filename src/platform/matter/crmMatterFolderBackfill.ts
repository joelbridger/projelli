import { useWorkspaceStore } from '@/platform/fs/workspaceStore';
import { useMatterStore } from '@/platform/matter/matterStore';
import {
  canonicalFolderClaimKey,
  normalize as normalizeMatterPath,
  resolveFolderForHousehold,
} from '@/platform/rag/matterResolver';
import type { FileNode } from '@/platform/types/workspace';

export interface CrmHouseholdIdentity {
  id: string;
  name: string;
}

function collectFolderPaths(nodes: FileNode[]): string[] {
  const out: string[] = [];
  const walk = (children: FileNode[]) => {
    for (const node of children) {
      if (node.type !== 'folder') continue;
      out.push(node.path);
      if (node.children) walk(node.children);
    }
  };
  walk(nodes);
  return out.sort();
}

export function buildClaimedCrmFolderSet(): Set<string> {
  const claimed = new Set<string>();
  const { rootPath } = useWorkspaceStore.getState();
  for (const matter of useMatterStore.getState().matters) {
    for (const folderPath of matter.folderPaths) {
      const claimKey = canonicalFolderClaimKey(folderPath, rootPath);
      if (claimKey) claimed.add(claimKey);
    }
  }
  return claimed;
}

/**
 * Attach a household's same-name document folder after a CRM sync creates or
 * links the matter. This wakes the existing folder-path reaction, which
 * re-tags documents that were indexed earlier as "unassigned".
 */
export function attachCrmHouseholdFolderIfUnmapped(
  matterId: string,
  household: CrmHouseholdIdentity,
  claimedFolders: Set<string>
): string | null {
  const store = useMatterStore.getState();
  const matter = store.matters.find((m) => m.id === matterId);
  if (!matter || matter.folderPaths.length > 0) return null;

  const { fileTree, rootPath } = useWorkspaceStore.getState();
  if (!rootPath && claimedFolders.size > 0) return null;
  const folder = resolveFolderForHousehold(
    collectFolderPaths(fileTree),
    household,
    claimedFolders,
    rootPath
  );
  if (!folder) return null;

  store.addFolderPath(matterId, folder);
  const normalized = normalizeMatterPath(folder);
  const claimKey = canonicalFolderClaimKey(normalized, rootPath);
  if (claimKey) claimedFolders.add(claimKey);
  return folder;
}
