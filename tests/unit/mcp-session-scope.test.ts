import { describe, expect, it, vi } from 'vitest';
import {
  MCP_SESSION_SCOPE_REL_PATH,
  buildMcpSessionScopeFile,
  buildDenyAllMcpSessionScopeFile,
  writeDenyAllMcpSessionScopeFile,
  writeMcpSessionScopeFile,
} from '@/platform/mcp/mcpSessionScope';
import type { WorkspaceService } from '@/platform/fs/WorkspaceService';
import type { Matter } from '@/platform/types/matter';

function createMockWorkspaceService() {
  const files = new Map<string, string>();
  const service = {
    writeFile: vi.fn(async (path: string, content: string) => {
      files.set(path, content);
    }),
    move: vi.fn(async (from: string, to: string) => {
      const content = files.get(from);
      if (content === undefined) {
        throw new Error(`missing temp file: ${from}`);
      }
      files.set(to, content);
      files.delete(from);
    }),
    delete: vi.fn(async (path: string) => {
      files.delete(path);
    }),
  };
  return { service: service as unknown as WorkspaceService, files, raw: service };
}

const matterA: Matter = {
  id: 'matter-a',
  name: 'Matter A',
  client: 'Client A',
  folderPaths: ['/workspace/Matter A'],
  privileged: false,
  archived: false,
  createdAt: '2026-06-22T00:00:00.000Z',
};

const matterB: Matter = {
  id: 'matter-b',
  name: 'Matter B',
  client: 'Client B',
  folderPaths: ['/workspace/Matter B'],
  privileged: false,
  archived: false,
  mcpAccessGranted: true,
  createdAt: '2026-06-22T00:00:00.000Z',
};

describe('MCP session scope file', () => {
  it('writes the live scope by temp file then final rename', async () => {
    const { service, files, raw } = createMockWorkspaceService();

    await writeMcpSessionScopeFile({
      service,
      workspaceRoot: '/workspace',
      selectionScope: { kind: 'matter-only', matterId: 'matter-a' },
      selectionFollowerStatus: 'converged',
      matters: [matterA],
      networkLockdown: false,
    });

    const finalPath = `/workspace/${MCP_SESSION_SCOPE_REL_PATH}`;
    const payload = JSON.parse(files.get(finalPath) ?? '{}') as {
      activeMatterId?: string;
      selectionKind?: string;
      contextNote?: string;
      networkLockdown?: boolean;
      matters?: unknown[];
    };

    expect(raw.writeFile).toHaveBeenCalledTimes(1);
    expect(raw.writeFile.mock.calls[0]?.[0]).toContain(`${MCP_SESSION_SCOPE_REL_PATH}.tmp-`);
    expect(raw.move).toHaveBeenCalledTimes(1);
    expect(raw.move.mock.calls[0]?.[1]).toBe(finalPath);
    expect(payload.activeMatterId).toBe('matter-a');
    expect(payload.selectionKind).toBe('matter-only');
    expect(payload.contextNote).toContain('does not grant MCP access');
    expect(payload.networkLockdown).toBe(false);
    expect(payload.matters).toHaveLength(1);
  });

  it('writes only explicitly granted matters, not the active matter', async () => {
    const { service, files } = createMockWorkspaceService();

    await writeMcpSessionScopeFile({
      service,
      workspaceRoot: '/workspace',
      selectionScope: { kind: 'matter-only', matterId: 'matter-a' },
      selectionFollowerStatus: 'converged',
      matters: [matterA, matterB],
      networkLockdown: false,
    });

    const finalPath = `/workspace/${MCP_SESSION_SCOPE_REL_PATH}`;
    const payload = JSON.parse(files.get(finalPath) ?? '{}') as {
      activeMatterId?: string;
      grantedMatterIds?: string[];
    };

    expect(payload.activeMatterId).toBe('matter-a');
    expect(payload.grantedMatterIds).toEqual(['matter-b']);
  });

  it('keeps the granted scope stable when the active matter changes', () => {
    const activeA = buildMcpSessionScopeFile({
      selectionScope: { kind: 'matter-only', matterId: 'matter-a' },
      selectionFollowerStatus: 'converged',
      matters: [matterA, matterB],
      networkLockdown: false,
    });
    const activeB = buildMcpSessionScopeFile({
      selectionScope: { kind: 'matter-only', matterId: 'matter-b' },
      selectionFollowerStatus: 'converged',
      matters: [matterA, matterB],
      networkLockdown: false,
    });

    expect(activeA.activeMatterId).toBe('matter-a');
    expect(activeB.activeMatterId).toBe('matter-b');
    expect(activeA.grantedMatterIds).toEqual(['matter-b']);
    expect(activeB.grantedMatterIds).toEqual(['matter-b']);
  });

  it('writes an empty grant list when no matter is explicitly granted', async () => {
    const { service, files } = createMockWorkspaceService();

    await writeMcpSessionScopeFile({
      service,
      workspaceRoot: '/workspace',
      selectionScope: { kind: 'matter-only', matterId: 'matter-a' },
      selectionFollowerStatus: 'converged',
      matters: [matterA],
      networkLockdown: false,
    });

    const finalPath = `/workspace/${MCP_SESSION_SCOPE_REL_PATH}`;
    const payload = JSON.parse(files.get(finalPath) ?? '{}') as {
      grantedMatterIds?: string[];
    };

    expect(payload.grantedMatterIds).toEqual([]);
  });

  it('distinguishes all-matters, blocked, and stale context without changing grants', () => {
    const all = buildMcpSessionScopeFile({
      selectionScope: { kind: 'all-matters' },
      selectionFollowerStatus: 'converged',
      matters: [matterA, matterB],
      networkLockdown: false,
    });
    const blocked = buildMcpSessionScopeFile({
      selectionScope: { kind: 'blocked-unresolved' },
      selectionFollowerStatus: 'stale',
      matters: [matterA, matterB],
      networkLockdown: false,
    });

    expect(all.activeMatterId).toBeNull();
    expect(all.selectionKind).toBe('all-matters');
    expect(all.contextNote).toContain('All matters');
    expect(all.contextNote).not.toContain('BLOCKED');
    expect(blocked.activeMatterId).toBeNull();
    expect(blocked.selectionKind).toBe('blocked-unresolved');
    expect(blocked.contextNote).toContain('BLOCKED');
    expect(blocked.contextNote).toContain('catching up');
    expect(all.grantedMatterIds).toEqual(['matter-b']);
    expect(blocked.grantedMatterIds).toEqual(['matter-b']);
  });

  it('writes a deny-all scope for cleanup', async () => {
    const { service, files } = createMockWorkspaceService();

    await writeDenyAllMcpSessionScopeFile({
      service,
      workspaceRoot: '/workspace',
    });

    const finalPath = `/workspace/${MCP_SESSION_SCOPE_REL_PATH}`;
    const payload = JSON.parse(files.get(finalPath) ?? '{}') as ReturnType<
      typeof buildDenyAllMcpSessionScopeFile
    >;

    expect(payload.activeMatterId).toBeNull();
    expect(payload.grantedMatterIds).toEqual([]);
    expect(payload.networkLockdown).toBe(true);
    expect(payload.matters).toEqual([]);
  });

  it('fails closed while replacing an existing scope file when direct rename cannot overwrite', async () => {
    const { service, files, raw } = createMockWorkspaceService();
    const finalPath = `/workspace/${MCP_SESSION_SCOPE_REL_PATH}`;
    files.set(finalPath, JSON.stringify({ activeMatterId: 'old-matter' }));
    raw.move.mockImplementationOnce(async () => {
      throw new Error('destination exists');
    });

    await writeDenyAllMcpSessionScopeFile({
      service,
      workspaceRoot: '/workspace',
    });

    const payload = JSON.parse(files.get(finalPath) ?? '{}') as ReturnType<
      typeof buildDenyAllMcpSessionScopeFile
    >;

    expect(raw.delete).toHaveBeenCalledWith(finalPath);
    expect(raw.move).toHaveBeenCalledTimes(2);
    expect(payload.activeMatterId).toBeNull();
    expect(payload.networkLockdown).toBe(true);
  });
});
