import { createMigrationExport } from '@/platform/crm/migration';
import { readTauriTextFile } from '@/platform/fs/tauriFsPlugin';

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

export interface VerifiedMigrationArchive extends MigrationArchiveReceipt {
  readonly manifest: {
    readonly recordCount: number;
    readonly recordCounts: Readonly<Record<string, number>>;
  };
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

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function isMigrationArchiveReceipt(
  value: unknown
): value is MigrationArchiveReceipt {
  const receipt = asObject(value);
  if (!receipt) return false;
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

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0')
  ).join('');
}

/**
 * Parses the file shape emitted by the existing native writer. Completeness is
 * accepted only when every archived source type has one reconciled fidelity
 * row. The native writer does not reject source types absent from that matrix,
 * so this renderer boundary must fail closed for that case.
 */
async function inspectArchiveFile(
  text: string,
  receipt: MigrationArchiveReceipt
): Promise<VerifiedMigrationArchive['manifest']> {
  const bytes = new TextEncoder().encode(text);
  if (
    bytes.byteLength !== receipt.byteLength ||
    (await sha256Hex(bytes)) !== receipt.sha256
  ) {
    throw new UninspectableMigrationArchiveError();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    throw new UninspectableMigrationArchiveError();
  }

  const archive = asObject(parsed);
  const manifest = asObject(archive?.['manifest']);
  const records = archive?.['records'];
  const recordCounts = asObject(manifest?.['recordCounts']);
  const fidelityMatrix = manifest?.['fidelityMatrix'];
  if (
    !archive ||
    !manifest ||
    manifest['format'] !== 'lantern-wealthbox-archive-v1' ||
    manifest['batchId'] !== receipt.manifestId ||
    !isNonNegativeInteger(manifest['recordCount']) ||
    !recordCounts ||
    !Array.isArray(fidelityMatrix) ||
    !Array.isArray(records)
  ) {
    throw new UninspectableMigrationArchiveError();
  }

  const declaredCounts = new Map<string, number>();
  for (const [sourceType, count] of Object.entries(recordCounts)) {
    if (!isNonEmptyString(sourceType) || !isNonNegativeInteger(count)) {
      throw new UninspectableMigrationArchiveError();
    }
    declaredCounts.set(sourceType, count);
  }

  const actualCounts = new Map<string, number>();
  for (const value of records) {
    const record = asObject(value);
    if (
      !record ||
      !isNonEmptyString(record['sourceType']) ||
      !isNonEmptyString(record['sourceId']) ||
      !hasOwn(record, 'targetRecordId') ||
      !hasOwn(record, 'payload')
    ) {
      throw new UninspectableMigrationArchiveError();
    }
    actualCounts.set(
      record['sourceType'],
      (actualCounts.get(record['sourceType']) ?? 0) + 1
    );
  }

  if (
    records.length !== manifest['recordCount'] ||
    declaredCounts.size !== actualCounts.size ||
    [...declaredCounts].some(
      ([sourceType, count]) => actualCounts.get(sourceType) !== count
    )
  ) {
    throw new UninspectableMigrationArchiveError();
  }

  const reconciledTypes = new Set<string>();
  for (const value of fidelityMatrix) {
    const row = asObject(value);
    if (!row || !isNonEmptyString(row['sourceType'])) {
      throw new UninspectableMigrationArchiveError();
    }
    const sourceType = row['sourceType'];
    const fetched = row['fetched'];
    const imported = row['imported'];
    const skipped = row['skipped'];
    const rejected = row['rejected'];
    if (
      reconciledTypes.has(sourceType) ||
      !isNonNegativeInteger(fetched) ||
      !isNonNegativeInteger(imported) ||
      !isNonNegativeInteger(skipped) ||
      !isNonNegativeInteger(rejected) ||
      fetched !== imported + skipped + rejected
    ) {
      throw new UninspectableMigrationArchiveError();
    }
    reconciledTypes.add(sourceType);
    if (
      declaredCounts.has(sourceType) &&
      declaredCounts.get(sourceType) !== imported
    ) {
      throw new UninspectableMigrationArchiveError();
    }
  }

  if ([...declaredCounts.keys()].some((type) => !reconciledTypes.has(type))) {
    throw new UninspectableMigrationArchiveError();
  }

  return {
    recordCount: manifest['recordCount'],
    recordCounts: Object.fromEntries(declaredCounts),
  };
}

/**
 * Uses the existing migration exporter, then reads and verifies the file it
 * wrote. A receipt alone cannot prove which records are inside the archive.
 */
export async function createVerifiedMigrationArchive(
  workspaceRoot: string
): Promise<VerifiedMigrationArchive> {
  const result = await createMigrationExport(workspaceRoot, 'archive');
  if (!isMigrationArchiveReceipt(result)) {
    throw new UninspectableMigrationArchiveError();
  }
  try {
    const text = await readTauriTextFile(result.filePath);
    const manifest = await inspectArchiveFile(text, result);
    return { ...result, manifest };
  } catch (error) {
    if (error instanceof UninspectableMigrationArchiveError) throw error;
    throw new UninspectableMigrationArchiveError();
  }
}
