import { createMigrationExport } from '@/platform/crm/migration';

export interface MigrationArchiveReceipt {
  readonly id: string;
  readonly kind: 'migration_export';
  readonly exportKind: 'archive';
  readonly status: 'exported';
  readonly exportedAt: string;
  readonly manifestId: string;
  readonly reconciliationReportId: string;
  readonly filePath: string;
  readonly byteLength: number;
  readonly sha256: string;
}

export class UninspectableMigrationArchiveError extends Error {
  constructor() {
    super('uninspectable-migration-archive');
    this.name = 'UninspectableMigrationArchiveError';
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isMigrationArchiveReceipt(
  value: unknown
): value is MigrationArchiveReceipt {
  if (value === null || typeof value !== 'object') return false;
  const receipt = value as Record<string, unknown>;
  return (
    isNonEmptyString(receipt['id']) &&
    receipt['kind'] === 'migration_export' &&
    receipt['exportKind'] === 'archive' &&
    receipt['status'] === 'exported' &&
    isNonEmptyString(receipt['exportedAt']) &&
    isNonEmptyString(receipt['manifestId']) &&
    isNonEmptyString(receipt['reconciliationReportId']) &&
    isNonEmptyString(receipt['filePath']) &&
    Number.isSafeInteger(receipt['byteLength']) &&
    (receipt['byteLength'] as number) > 0 &&
    typeof receipt['sha256'] === 'string' &&
    /^[a-f0-9]{64}$/u.test(receipt['sha256'])
  );
}

/**
 * Uses the existing migration exporter and rejects any result that cannot be
 * inspected as the archive receipt promised by its native contract.
 */
export async function createVerifiedMigrationArchive(
  workspaceRoot: string
): Promise<MigrationArchiveReceipt> {
  const result = await createMigrationExport(workspaceRoot, 'archive');
  if (!isMigrationArchiveReceipt(result)) {
    throw new UninspectableMigrationArchiveError();
  }
  return result;
}
