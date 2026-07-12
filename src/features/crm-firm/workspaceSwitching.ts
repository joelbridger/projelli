import { createFSBackend } from '@/platform/fs/BackendFactory';
import { createWorkspaceService, type WorkspaceService } from '@/platform/fs/WorkspaceService';
import { normalizeRecentWorkspacePath } from '@/platform/fs/workspaceStore';

type WorkspaceSelected = (service: WorkspaceService) => Promise<boolean>;

let selectWorkspace: WorkspaceSelected | null = null;
let queuedSwitch: Promise<void> = Promise.resolve();

/**
 * The app shell owns the one safe workspace handoff. Firm spaces prepare a
 * workspace and hand it to that doorway rather than changing the visible
 * folder themselves. That makes the CRM store, client list, tabs, and audit
 * history move together.
 */
export function registerFirmWorkspaceSwitcher(handler: WorkspaceSelected): () => void {
  selectWorkspace = handler;
  return () => {
    if (selectWorkspace === handler) selectWorkspace = null;
  };
}

async function prepareAndSelect(path: string, create: boolean): Promise<boolean> {
  if (!selectWorkspace) throw new Error('Firm spaces are still getting ready. Please try again.');
  const workspacePath = normalizeRecentWorkspacePath(path);
  if (!workspacePath) throw new Error('Choose a folder for this firm space.');
  const backend = await createFSBackend(
    workspacePath,
    create ? { createIfMissing: true } : undefined,
  );
  const service = createWorkspaceService();
  await service.initialize(backend, workspacePath, create
    ? { createIfMissing: true, createDefaultStructure: true }
    : undefined);
  return selectWorkspace(service);
}

function queueSwitch(path: string, create: boolean): Promise<boolean> {
  const task = queuedSwitch
    .catch(() => undefined)
    .then(() => prepareAndSelect(path, create));
  queuedSwitch = task.then(() => undefined, () => undefined);
  return task;
}

export function openFirmWorkspace(path: string): Promise<boolean> {
  return queueSwitch(path, false);
}

export function createFirmWorkspace(path: string): Promise<boolean> {
  return queueSwitch(path, true);
}
