import { invoke } from '@tauri-apps/api/core';
import {
  crmMigrationImport,
  crmSetWorkspace,
} from '@/platform/utils/wealthbox-commands';

export type MigrationImportResult = {
  batchId: string;
  imported: number;
  unchanged: number;
};

/** The migration boundary stays in Rust: the renderer never handles raw CRM data. */
export async function runWealthboxMigration(workspaceRoot: string | null | undefined, baseUrl: string) {
  if (!workspaceRoot) throw new Error('Open a workspace before importing CRM data.');
  if (!/^https?:\/\//.test(baseUrl)) throw new Error('Enter the simulator address, starting with http:// or https://.');
  await crmSetWorkspace(workspaceRoot);
  return crmMigrationImport<MigrationImportResult>({ baseUrl });
}

export async function createMigrationExport(workspaceRoot: string | null | undefined, kind: 'archive' | 'rollback') {
  if (!workspaceRoot) throw new Error('Open a workspace before preparing an export.');
  await crmSetWorkspace(workspaceRoot);
  return invoke('crm_migration_export', { kind });
}
