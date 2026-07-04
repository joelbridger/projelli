/**
 * activeWorkspaceService — a tiny module-level holder for the currently-active
 * WorkspaceService.
 *
 * The app keeps this in sync wherever it assigns `workspaceServiceRef.current`
 * (workspace select + test-mode), so any layer that needs to read/write through
 * the open workspace can reach it WITHOUT threading the service through every
 * caller. It lives in `platform/fs` (next to WorkspaceService) rather than in
 * the app layer so `features/*` may use it too, respecting the layer DAG
 * (features → platform is allowed; features → app is not). Null before a
 * workspace is open.
 */
import type { WorkspaceService } from './WorkspaceService';

let activeService: WorkspaceService | null = null;

export function setActiveWorkspaceService(service: WorkspaceService | null): void {
  activeService = service;
}

export function getActiveWorkspaceService(): WorkspaceService | null {
  return activeService;
}
