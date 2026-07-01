import type { Matter } from '@/platform/types/matter';
import type { WorkspaceService } from '@/platform/fs/WorkspaceService';
import { workspacePath } from '@/platform/fs/appPath';
export { MCP_SESSION_SCOPE_REL_PATH } from '@/config/identity';
import { MCP_SESSION_SCOPE_REL_PATH } from '@/config/identity';

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
  grantedMatterIds: string[];
  networkLockdown: boolean;
  matters: McpSessionMatter[];
}

export function buildMcpSessionScopeFile(input: {
  activeMatterId: string | null;
  matters: Matter[];
  networkLockdown: boolean;
}): McpSessionScopeFile {
  const active = input.matters.find((m) => m.id === input.activeMatterId && !m.archived) ?? null;
  const grantedMatterIds = input.matters
    .filter((m) => !m.archived && !!m.mcpAccessGranted)
    .map((m) => m.id)
    .sort();
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    activeMatterId: active?.id ?? null,
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
    grantedMatterIds: [],
    networkLockdown: true,
    matters: [],
  };
}

export async function writeMcpSessionScopeFile(input: {
  service: WorkspaceService;
  workspaceRoot: string;
  activeMatterId: string | null;
  matters: Matter[];
  networkLockdown: boolean;
}): Promise<void> {
  const payload = buildMcpSessionScopeFile({
    activeMatterId: input.activeMatterId,
    matters: input.matters,
    networkLockdown: input.networkLockdown,
  });
  await writeMcpScopeFileAtomically(input.service, input.workspaceRoot, payload);
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
