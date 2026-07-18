import { createDirectoryPreferenceStore } from '../../directoryPreferences';

export interface BulkExportPreference {
  readonly includeHeader: boolean;
}

export const DEFAULT_BULK_EXPORT_PREFERENCE: BulkExportPreference = Object.freeze({
  includeHeader: true,
});

function isBulkExportPreference(value: unknown): value is BulkExportPreference {
  return Boolean(value)
    && typeof value === 'object'
    && !Array.isArray(value)
    && typeof (value as Partial<BulkExportPreference>).includeHeader === 'boolean';
}

/** The feature's one sanctioned saved-preference slot. */
export const bulkExportPreferences = createDirectoryPreferenceStore<BulkExportPreference>(
  'crm-bulk-export',
  isBulkExportPreference,
);

export function readBulkExportPreference(): BulkExportPreference {
  return bulkExportPreferences.load() ?? DEFAULT_BULK_EXPORT_PREFERENCE;
}
