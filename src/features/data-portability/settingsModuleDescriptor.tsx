import { DataExportBackupSettings } from './DataExportBackupSettings';

/** Workspace panel for the existing, migration-scoped archive contract. */
export const dataPortabilitySettingsPanel = {
  id: 'data-portability',
  section: 'workspace',
  order: 90,
  labelKey: 'data-portability.title',
  flagId: 'data-export-backup',
  searchTerms: [
    'data export',
    'migration archive',
    'backup',
    'wealthbox export',
    'portable copy',
  ],
  render: DataExportBackupSettings,
} as const;
