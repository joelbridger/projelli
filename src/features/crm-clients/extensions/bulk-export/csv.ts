import type { HouseholdDirectoryEntry } from '@/features/crm-clients';
import { csvCell, csvDocument } from '@/platform/export/csvSafe';

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

/*
 * This file used to carry its own `spreadsheetSafe` + `quoteCsvCell` pair.
 * They were correct AND they were a second, independently-maintained opinion
 * about which leading characters Excel treats as a formula — the audit
 * exporter's copy guarded TAB and CR, this one did not. Two copies of a guard
 * are two chances to drift. Both now call `@/platform/export/csvSafe`.
 *
 * `alwaysQuote` preserves this exporter's every-field-quoted output so the
 * file diffs stay stable for firms that track exports in version control.
 */
const QUOTED = { alwaysQuote: true } as const;

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
    ].map((value) => csvCell(value, QUOTED)));
  const header = options.includeHeader
    ? [BULK_EXPORT_COLUMNS.map((value) => csvCell(value, QUOTED))]
    : [];
  return csvDocument([...header, ...rows]);
}
