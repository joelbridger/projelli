import type { HouseholdDirectoryEntry } from '@/features/crm-clients';

export const BULK_EXPORT_COLUMNS = [
  'Household ID',
  'Household name',
  'Lifecycle',
  'Primary advisor',
  'Service tier',
  'People count',
] as const;

export interface BulkExportOptions {
  readonly includeHeader: boolean;
}

function spreadsheetSafe(value: string): string {
  let index = 0;
  while (value.charCodeAt(index) <= 0x20) index += 1;
  return /^[=+\-@]/.test(value.slice(index)) ? `'${value}` : value;
}

function quoteCsvCell(value: string | number): string {
  const safe = spreadsheetSafe(String(value));
  return `"${safe.replaceAll('"', '""')}"`;
}

/**
 * Creates a stable RFC 4180-compatible CSV from already-authorized directory
 * entries. The caller supplies only records that are both selected and exposed
 * by the current directory context.
 */
export function createHouseholdCsv(
  households: readonly HouseholdDirectoryEntry[],
  options: BulkExportOptions,
): string {
  const rows = households
    .slice()
    .sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0)
    .map((household) => [
      household.id,
      household.name,
      household.lifecycle,
      household.primaryAdvisor,
      household.serviceTier,
      household.peopleCount,
    ].map(quoteCsvCell).join(','));
  const header = options.includeHeader
    ? [BULK_EXPORT_COLUMNS.map(quoteCsvCell).join(',')]
    : [];
  return [...header, ...rows].join('\r\n');
}
