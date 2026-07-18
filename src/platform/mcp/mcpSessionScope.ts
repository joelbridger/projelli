import type { Matter } from '@/platform/types/matter';
import type { WorkspaceService } from '@/platform/fs/WorkspaceService';
import { workspacePath } from '@/platform/fs/appPath';
export { MCP_SESSION_SCOPE_REL_PATH } from '@/config/identity';
import { MCP_SESSION_SCOPE_REL_PATH } from '@/config/identity';
import type { FollowerStatus, MatterScopeSelection } from '@/platform/client-context';

interface McpSessionMatter {
  id: string;
  name: string;
  client: string;
  folderPaths: string[];
  privileged: boolean;
  archived: boolean;
}

interface McpSessionScopeFile {
  version: 1;
  updatedAt: string;
  activeMatterId: string | null;
  selectionKind: MatterScopeSelection['kind'];
  selectionFollowerStatus: FollowerStatus;
  contextNote: string;
  grantedMatterIds: string[];
  networkLockdown: boolean;
  matters: McpSessionMatter[];
}

export function buildMcpSessionScopeFile(input: {
  selectionScope: MatterScopeSelection;
  selectionFollowerStatus: FollowerStatus;
  matters: Matter[];
  networkLockdown: boolean;
}): McpSessionScopeFile {
  const selectedMatterId =
    input.selectionScope.kind === 'matter' || input.selectionScope.kind === 'matter-only'
      ? input.selectionScope.matterId
      : null;
  const active = input.matters.find((m) => m.id === selectedMatterId && !m.archived) ?? null;
  const grantedMatterIds = input.matters
    .filter((m) => !m.archived && !!m.mcpAccessGranted)
    .map((m) => m.id)
    .sort();
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    activeMatterId: active?.id ?? null,
    selectionKind: input.selectionScope.kind,
    selectionFollowerStatus: input.selectionFollowerStatus,
    contextNote: buildSelectionContextNote(
      input.selectionScope,
      input.selectionFollowerStatus,
      active?.id ?? null,
    ),
    grantedMatterIds,
    networkLockdown: input.networkLockdown,
    matters: input.matters.map((m) => ({
      id: m.id,
      name: m.name,
      client: m.client,
      folderPaths: m.folderPaths,
      privileged: !!m.privileged,
      archived: !!m.archived,
    })),
  };
}

export function buildDenyAllMcpSessionScopeFile(): McpSessionScopeFile {
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    activeMatterId: null,
    selectionKind: 'blocked-unresolved',
    selectionFollowerStatus: 'stale',
    contextNote: 'BLOCKED: the app session is closed. This context does not grant MCP access.',
    grantedMatterIds: [],
    networkLockdown: true,
    matters: [],
  };
}

export async function writeMcpSessionScopeFile(input: {
  service: WorkspaceService;
  workspaceRoot: string;
  selectionScope: MatterScopeSelection;
  selectionFollowerStatus: FollowerStatus;
  matters: Matter[];
  networkLockdown: boolean;
}): Promise<void> {
  const payload = buildMcpSessionScopeFile({
    selectionScope: input.selectionScope,
    selectionFollowerStatus: input.selectionFollowerStatus,
    matters: input.matters,
    networkLockdown: input.networkLockdown,
  });
  await writeMcpScopeFileAtomically(input.service, input.workspaceRoot, payload);
}

function buildSelectionContextNote(
  scope: MatterScopeSelection,
  followerStatus: FollowerStatus,
  activeMatterId: string | null,
): string {
  const stale = followerStatus === 'stale'
    ? ' The legacy UI context may still be catching up.'
    : '';
  switch (scope.kind) {
    case 'matter':
    case 'matter-only':
      return `Active matter context: ${activeMatterId ?? scope.matterId}.${stale} This context does not grant MCP access.`;
    case 'all-matters':
      return `All matters is the current app context.${stale} This context does not grant MCP access.`;
    case 'blocked-unresolved':
      return `BLOCKED: the current app selection is unresolved.${stale} This context does not grant MCP access.`;
  }
}

export async function writeDenyAllMcpSessionScopeFile(input: {
  service: WorkspaceService;
  workspaceRoot: string;
}): Promise<void> {
  await writeMcpScopeFileAtomically(
    input.service,
    input.workspaceRoot,
    buildDenyAllMcpSessionScopeFile(),
  );
}

async function writeMcpScopeFileAtomically(
  service: WorkspaceService,
  workspaceRoot: string,
  payload: McpSessionScopeFile,
): Promise<void> {
  const tempRelPath = `${MCP_SESSION_SCOPE_REL_PATH}.tmp-${String(Date.now())}-${Math.random()
    .toString(36)
    .slice(2)}`;
  const tempPath = workspacePath(workspaceRoot, tempRelPath);
  const finalPath = workspacePath(workspaceRoot, MCP_SESSION_SCOPE_REL_PATH);
  let moved = false;

  await service.writeFile(
    tempPath,
    JSON.stringify(payload, null, 2),
  );
  try {
    try {
      await service.move(tempPath, finalPath);
    } catch {
      await service.delete(finalPath).catch(() => undefined);
      await service.move(tempPath, finalPath);
    }
    moved = true;
  } finally {
    if (!moved) {
      await service.delete(tempPath).catch(() => undefined);
    }
  }
}
