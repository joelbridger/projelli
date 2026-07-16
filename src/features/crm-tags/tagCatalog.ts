import type { LiveCrmRecord } from '@/platform/crm/liveRecords';
import type { Tag } from '@/platform/crm/types';
import type {
  CreateFirmTagInput,
  FirmTag,
  FirmTagCatalog,
  FirmTagColor,
  FirmTagError,
  FirmTagErrorCode,
  FirmTagStore,
} from './contract';
import { FirmTagError as StableFirmTagError } from './contract';

const MAX_TAG_NAME_LENGTH = 80;
const DEFAULT_TAG_COLOR: FirmTagColor = '#475569';

type CanonicalTagRecord = LiveCrmRecord & {
  kind: 'tag';
  name: string;
  color?: string;
  deleted?: boolean;
};

/** The live hook is the sole record path. This adapter never opens storage itself. */
export interface LiveFirmTagPort {
  readonly records: readonly LiveCrmRecord[];
  readonly workspaceRoot: string | null | undefined;
  readonly error: string | null;
  save(record: LiveCrmRecord): Promise<LiveCrmRecord>;
  reload(): Promise<void>;
}

function timestamp(): string {
  return new Date().toISOString();
}

function failure(code: FirmTagErrorCode, message?: string): FirmTagError {
  return new StableFirmTagError(code, message);
}

function cleanName(value: string): string {
  const name = value.trim().replace(/\s+/g, ' ');
  if (!name) throw failure('invalid_name');
  if (name.length > MAX_TAG_NAME_LENGTH) {
    throw failure('invalid_name');
  }
  return name;
}

function cleanColor(value: string): FirmTagColor {
  const color = value.trim().toLowerCase();
  if (!/^#[0-9a-f]{6}$/.test(color)) throw failure('invalid_color');
  return color as FirmTagColor;
}

function nameKey(value: string): string {
  return value.toLocaleLowerCase();
}

function isCanonicalTag(record: LiveCrmRecord): record is CanonicalTagRecord {
  return record.kind === 'tag' && typeof record['name'] === 'string';
}

function toFirmTag(record: CanonicalTagRecord): FirmTag {
  return {
    id: record.id,
    name: record.name,
    // Old records can predate the normalized color contract. Never place an
    // arbitrary stored string into a CSS property.
    color: cleanColorSafely(record.color) ?? DEFAULT_TAG_COLOR,
    status: record.deleted ? 'retired' : 'active',
  };
}

function cleanColorSafely(value: unknown): FirmTagColor | null {
  if (typeof value !== 'string') return null;
  try {
    return cleanColor(value);
  } catch {
    return null;
  }
}

function toCatalog(records: readonly CanonicalTagRecord[]): FirmTagCatalog {
  return {
    version: 1,
    tags: records
      .map(toFirmTag)
      .sort((left, right) => left.name.localeCompare(right.name)),
  };
}

function requireAvailableName(
  records: readonly CanonicalTagRecord[],
  name: string,
  exceptId?: string
): void {
  const existing = records.find(
    (tag) => tag.id !== exceptId && nameKey(tag.name) === nameKey(name)
  );
  if (existing) throw failure('duplicate_name');
}

function activeTagAt(
  records: readonly CanonicalTagRecord[],
  id: string
): CanonicalTagRecord {
  const tag = records.find((record) => record.id === id);
  if (!tag) throw failure('not_found');
  if (tag.deleted) throw failure('retired');
  return tag;
}

function newTagId(): string {
  return `tag:${crypto.randomUUID()}`;
}

function actor() {
  return { userId: 'local-user', display: 'You', kind: 'user' as const };
}

function newCanonicalTag(
  name: string,
  color: FirmTagColor
): LiveCrmRecord & Tag {
  const now = timestamp();
  // Keep this value typed as the canonical CRM entity. Omitting any CrmBase
  // field here is therefore a compile-time failure, not a hidden index-signature
  // escape hatch on LiveCrmRecord.
  const canonical: Tag = {
    id: newTagId(),
    kind: 'tag',
    matterId: 'firm_home',
    name,
    color,
    createdAt: now,
    createdBy: actor(),
    updatedAt: now,
    updatedBy: actor(),
    source: { origin: 'user', sources: [] },
    deleted: false,
    externalRefs: [],
    schemaVersion: 1,
  };
  // `Tag` proves all frozen CRM metadata is present. The intersection adds
  // the permissive transport index signature only at the live-record edge.
  return canonical as LiveCrmRecord & Tag;
}

function availabilityError(port: LiveFirmTagPort):
  | 'workspace_unavailable'
  | 'persistence_failed'
  | null {
  if (!port.workspaceRoot) return 'workspace_unavailable';
  if (port.error) return 'persistence_failed';
  return null;
}

function assertAvailable(port: LiveFirmTagPort): void {
  const code = availabilityError(port);
  if (code) throw failure(code);
}

function persistenceFailure(error: unknown): FirmTagError {
  if (error instanceof StableFirmTagError) return error;
  return failure('persistence_failed');
}

/**
 * Adapts the one canonical CRM `kind: 'tag'` record set for feature lanes.
 * There is no browser catalog: every read and write goes through the same
 * encrypted CRM persistence path used by the existing firm tag screen.
 */
export function createFirmTagStore(port: LiveFirmTagPort): FirmTagStore {
  const tags = port.records.filter(isCanonicalTag);
  const catalog = toCatalog(tags);
  const list = (): Promise<FirmTagCatalog> => {
    try {
      assertAvailable(port);
      return Promise.resolve(catalog);
    } catch (error: unknown) {
      return Promise.reject(
        error instanceof Error ? error : failure('persistence_failed')
      );
    }
  };
  const saveAndReload = async (record: LiveCrmRecord): Promise<void> => {
    try {
      await port.save(record);
      await port.reload();
    } catch (error: unknown) {
      throw persistenceFailure(error);
    }
  };

  return {
    catalog,
    errorCode: availabilityError(port),
    list,
    create: async (input: CreateFirmTagInput) => {
      assertAvailable(port);
      const name = cleanName(input.name);
      const color = cleanColor(input.color);
      requireAvailableName(tags, name);
      const record = newCanonicalTag(name, color);
      await saveAndReload(record);
      return toCatalog([...tags, record]);
    },
    rename: async (id: string, rawName: string) => {
      assertAvailable(port);
      const tag = activeTagAt(tags, id);
      const name = cleanName(rawName);
      requireAvailableName(tags, name, id);
      if (name !== tag.name) {
        await saveAndReload({
          ...tag,
          name,
          updatedAt: timestamp(),
        });
      }
      return toCatalog(tags.map((item) => item.id === id ? { ...item, name } : item));
    },
    setColor: async (id: string, rawColor: FirmTagColor) => {
      assertAvailable(port);
      const tag = activeTagAt(tags, id);
      const color = cleanColor(rawColor);
      if (color !== cleanColorSafely(tag.color)) {
        await saveAndReload({
          ...tag,
          color,
          updatedAt: timestamp(),
        });
      }
      return toCatalog(tags.map((item) => item.id === id ? { ...item, color } : item));
    },
    retire: async (id: string) => {
      assertAvailable(port);
      const tag = tags.find((record) => record.id === id);
      if (!tag) throw failure('not_found');
      if (!tag.deleted) {
        await saveAndReload({
          ...tag,
          deleted: true,
          updatedAt: timestamp(),
        });
      }
      return toCatalog(tags.map((item) => item.id === id ? { ...item, deleted: true } : item));
    },
  };
}
