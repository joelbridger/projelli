// Plugin runner — Workspace host adapter (Wave 3).
//
// Plugins call `api.workspace.listFiles / readFile / writeFile`. Those flow
// as `api-call` messages, so the bridge enforces `workspace:read` (list/read)
// or `workspace:write` (write). This host translates the call to the
// existing `WorkspaceService` which itself validates every path through
// `PathValidator` (see `WorkspaceService.readFile` / `writeFile` / `list` —
// all four routes call `pathValidator.validatePath(path)`).
//
// We don't add an extra PathValidator pass here because the WorkspaceService
// is already the canonical security boundary for path traversal — adding a
// second pass would duplicate the (already correct) check and risk drifting
// out of sync. The host's contract is: hand the path through; the service
// throws SecurityError on traversal; we surface it as `invalid-args`.
//
// The workspace context is per-window/per-workspace (the user can open a
// different workspace at runtime). Like EditorHost, we accept a `getWorkspace`
// accessor instead of holding a stale reference.
//
// Spec: docs/superpowers/specs/2026-04-28-v2.0-mega-release-design.md §6.4
// Plan: docs/superpowers/plans/2026-05-03-stream-c3-plugin-runner.md (task 6.2)

import type { WorkspaceService } from '@/modules/workspace/WorkspaceService';
import type { FileNode } from '@/types/workspace';

import type { PluginApiDispatchCall } from '../PluginAPIBridge';

export type WorkspaceServiceAccessor = () => WorkspaceService | null;

export class WorkspaceHostError extends Error {
  readonly code: 'invalid-args' | 'not-found';
  constructor(code: 'invalid-args' | 'not-found', message: string) {
    super(message);
    this.code = code;
    this.name = 'WorkspaceHostError';
  }
}

export interface WorkspaceHostOptions {
  /**
   * Returns the active WorkspaceService, or null when no workspace is open.
   * Defaults to a stub that always returns null so the host is safe to
   * construct before the manager wires the real accessor.
   */
  getWorkspace?: WorkspaceServiceAccessor;
}

export class WorkspaceHost {
  private getWorkspace: WorkspaceServiceAccessor;

  constructor(options: WorkspaceHostOptions = {}) {
    this.getWorkspace = options.getWorkspace ?? (() => null);
  }

  setWorkspaceAccessor(accessor: WorkspaceServiceAccessor): void {
    this.getWorkspace = accessor;
  }

  handlesMethod(method: string): boolean {
    return (
      method === 'workspace.listFiles' ||
      method === 'workspace.readFile' ||
      method === 'workspace.writeFile'
    );
  }

  async handle(call: PluginApiDispatchCall): Promise<unknown> {
    const workspace = this.getWorkspace();
    if (!workspace) {
      throw new WorkspaceHostError('not-found', 'no active workspace');
    }
    switch (call.method) {
      case 'workspace.listFiles': {
        const path = optionalPath(call.args[0]) ?? '/';
        return this.callOrSurface(() => workspace.list(path)) as Promise<FileNode[]>;
      }
      case 'workspace.readFile': {
        const path = requirePath(call.args[0], 'workspace.readFile path');
        return this.callOrSurface(() => workspace.readFile(path)) as Promise<string>;
      }
      case 'workspace.writeFile': {
        const path = requirePath(call.args[0], 'workspace.writeFile path');
        const content = call.args[1];
        if (typeof content !== 'string') {
          throw new WorkspaceHostError(
            'invalid-args',
            'workspace.writeFile content must be a string',
          );
        }
        return this.callOrSurface(() => workspace.writeFile(path, content));
      }
      default:
        throw new WorkspaceHostError(
          'invalid-args',
          `WorkspaceHost cannot handle method ${call.method}`,
        );
    }
  }

  /**
   * Translate WorkspaceService errors into the host's coded error variants.
   * SecurityError (path traversal) and FileOperationError both surface as
   * `invalid-args` to the plugin since the plugin can fix the call shape.
   */
  private async callOrSurface<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      const e = err as { name?: string; message?: string } | null;
      const message = typeof e?.message === 'string' ? e.message : 'workspace operation failed';
      throw new WorkspaceHostError('invalid-args', message);
    }
  }
}

function requirePath(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new WorkspaceHostError('invalid-args', `${label} must be a non-empty string`);
  }
  return value;
}

function optionalPath(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') {
    throw new WorkspaceHostError('invalid-args', 'workspace.listFiles path must be a string when provided');
  }
  return value;
}
