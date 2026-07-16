import {
  loadLiveCrmRecords,
  saveLiveCrmRecord,
  type LiveCrmRecord,
} from '@/platform/crm/liveRecords';
import type {
  CreateFirmTagInput,
  FirmTag,
  FirmTagCatalog,
  FirmTagColor,
  FirmTagStore,
} from './contract';

const MAX_TAG_NAME_LENGTH = 80;
const DEFAULT_TAG_COLOR = '#475569';

type CanonicalTagRecord = LiveCrmRecord & {
  kind: 'tag';
  name: string;
  color?: string;
  deleted?: boolean;
};

function timestamp(): string {
  return new Date().toISOString();
}

function cleanName(value: string): string {
  const name = value.trim().replace(/\s+/g, ' ');
  if (!name) throw new Error('A tag needs a name.');
  if (name.length > MAX_TAG_NAME_LENGTH) {
    throw new Error(
      `A tag name must be ${String(MAX_TAG_NAME_LENGTH)} characters or fewer.`
    );
  }
  return name;
}

function cleanColor(value: FirmTagColor): string {
  const color = value.trim();
  if (!color) throw new Error('Choose a tag color.');
  return color;
}

function nameKey(value: string): string {
  return value.toLocaleLowerCase();
}

function isCanonicalTag(record: LiveCrmRecord): record is CanonicalTagRecord {
  return record.kind === 'tag' && typeof record.name === 'string';
}

function toFirmTag(record: CanonicalTagRecord): FirmTag {
  return {
    id: record.id,
    name: record.name,
    color: record.color?.trim() || DEFAULT_TAG_COLOR,
    status: record.deleted ? 'retired' : 'active',
  };
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
  if (existing) throw new Error('This tag name is already in use.');
}

function activeTagAt(
  records: readonly CanonicalTagRecord[],
  id: string
): CanonicalTagRecord {
  const tag = records.find((record) => record.id === id);
  if (!tag) throw new Error('This tag no longer exists.');
  if (tag.deleted) throw new Error('A retired tag cannot be changed.');
  return tag;
}

function newTagId(): string {
  return `tag:${crypto.randomUUID()}`;
}

/**
 * Adapts the one canonical CRM `kind: 'tag'` record set for feature lanes.
 * There is no browser catalog: every read and write goes through the same
 * encrypted CRM persistence path used by the existing firm tag screen.
 */
export function createFirmTagStore(
  workspaceRoot: string | null | undefined
): FirmTagStore {
  const loadTags = async (): Promise<CanonicalTagRecord[]> =>
    (await loadLiveCrmRecords(workspaceRoot)).filter(isCanonicalTag);
  const list = async (): Promise<FirmTagCatalog> => toCatalog(await loadTags());

  return {
    list,
    create: async (input: CreateFirmTagInput) => {
      const records = await loadTags();
      const name = cleanName(input.name);
      const color = cleanColor(input.color);
      requireAvailableName(records, name);
      const now = timestamp();
      await saveLiveCrmRecord(workspaceRoot, {
        id: newTagId(),
        kind: 'tag',
        matterId: 'firm_home',
        name,
        color,
        deleted: false,
        createdAt: now,
        updatedAt: now,
      });
      return list();
    },
    rename: async (id: string, rawName: string) => {
      const records = await loadTags();
      const tag = activeTagAt(records, id);
      const name = cleanName(rawName);
      requireAvailableName(records, name, id);
      if (name !== tag.name) {
        await saveLiveCrmRecord(workspaceRoot, {
          ...tag,
          name,
          updatedAt: timestamp(),
        });
      }
      return list();
    },
    setColor: async (id: string, rawColor: FirmTagColor) => {
      const records = await loadTags();
      const tag = activeTagAt(records, id);
      const color = cleanColor(rawColor);
      if (color !== tag.color) {
        await saveLiveCrmRecord(workspaceRoot, {
          ...tag,
          color,
          updatedAt: timestamp(),
        });
      }
      return list();
    },
    retire: async (id: string) => {
      const records = await loadTags();
      const tag = records.find((record) => record.id === id);
      if (!tag) throw new Error('This tag no longer exists.');
      if (!tag.deleted) {
        await saveLiveCrmRecord(workspaceRoot, {
          ...tag,
          deleted: true,
          updatedAt: timestamp(),
        });
      }
      return list();
    },
  };
}
