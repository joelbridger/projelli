import type { Matter } from '@/platform/types/matter';
import type { WorkspaceService } from '@/platform/fs/WorkspaceService';

export const MCP_SESSION_SCOPE_REL_PATH = '.keepance/mcp-session-scope.json';

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
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    activeMatterId: active?.id ?? null,
    // No broad grant exists yet. The sidecar falls back to this active matter;
    // when product adds explicit MCP grants, write them here.
    grantedMatterIds: [],
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

export async function writeMcpSessionScopeFile(input: {
  service: WorkspaceService;
  workspaceRoot: string;
  activeMatterId: string | null;
  matters: Matter[];
  networkLockdown: boolean;
}): Promise<void> {
  const denyAll: McpSessionScopeFile = {
    version: 1,
    updatedAt: new Date().toISOString(),
    activeMatterId: null,
    grantedMatterIds: [],
    networkLockdown: true,
    matters: [],
  };
  const payload = buildMcpSessionScopeFile({
    activeMatterId: input.activeMatterId,
    matters: input.matters,
    networkLockdown: input.networkLockdown,
  });
  await input.service.writeFile(
    `${input.workspaceRoot}/${MCP_SESSION_SCOPE_REL_PATH}`,
    JSON.stringify(denyAll, null, 2),
  );
  await input.service.writeFile(
    `${input.workspaceRoot}/${MCP_SESSION_SCOPE_REL_PATH}`,
    JSON.stringify(payload, null, 2),
  );
}
