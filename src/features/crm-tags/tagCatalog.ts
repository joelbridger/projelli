import type {
  CreateFirmTagInput,
  FirmTag,
  FirmTagCatalog,
  FirmTagColor,
  FirmTagStore,
} from './contract';

const STORAGE_KEY = 'lantern:crm:firm-tags:v1';
const MAX_TAG_NAME_LENGTH = 80;

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

interface PersistedFirmTag extends FirmTag {
  createdAt: string;
  updatedAt: string;
  retiredAt?: string;
}

interface PersistedFirmTagCatalog {
  version: 1;
  tags: readonly PersistedFirmTag[];
}

const TAG_COLORS: readonly FirmTagColor[] = [
  'blue',
  'green',
  'amber',
  'red',
  'purple',
  'slate',
];

function timestamp(): string {
  return new Date().toISOString();
}

function cleanName(value: string): string {
  const name = value.trim().replace(/\s+/g, ' ');
  if (!name) throw new Error('A tag needs a name.');
  if (name.length > MAX_TAG_NAME_LENGTH)
    throw new Error(
      `A tag name must be ${String(MAX_TAG_NAME_LENGTH)} characters or fewer.`
    );
  return name;
}

function nameKey(value: string): string {
  return value.toLocaleLowerCase();
}

function idBase(name: string): string {
  const value = name
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
  return value || 'tag';
}

function isColor(value: unknown): value is FirmTagColor {
  return (
    typeof value === 'string' && TAG_COLORS.includes(value as FirmTagColor)
  );
}

function isTimestamp(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

function isPersistedTag(value: unknown): value is PersistedFirmTag {
  if (!value || typeof value !== 'object') return false;
  const tag = value as Partial<PersistedFirmTag>;
  return (
    typeof tag.id === 'string' &&
    tag.id.length > 0 &&
    typeof tag.name === 'string' &&
    tag.name === cleanName(tag.name) &&
    isColor(tag.color) &&
    (tag.status === 'active' || tag.status === 'retired') &&
    isTimestamp(tag.createdAt) &&
    isTimestamp(tag.updatedAt) &&
    (tag.retiredAt === undefined || isTimestamp(tag.retiredAt)) &&
    (tag.status === 'retired'
      ? tag.retiredAt !== undefined
      : tag.retiredAt === undefined)
  );
}

function hasUniqueValues(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

function copyCatalog(
  catalog: PersistedFirmTagCatalog
): PersistedFirmTagCatalog {
  return { version: 1, tags: catalog.tags.map((tag) => ({ ...tag })) };
}

function toPublicCatalog(catalog: PersistedFirmTagCatalog): FirmTagCatalog {
  return {
    version: 1,
    tags: catalog.tags.map(({ id, name, color, status }) => ({
      id,
      name,
      color,
      status,
    })),
  };
}

function parseCatalog(raw: string | null): PersistedFirmTagCatalog {
  if (!raw) return { version: 1, tags: [] };
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return { version: 1, tags: [] };
    const catalog = parsed as Partial<PersistedFirmTagCatalog>;
    if (
      catalog.version !== 1 ||
      !Array.isArray(catalog.tags) ||
      !catalog.tags.every(isPersistedTag)
    ) {
      return { version: 1, tags: [] };
    }
    const ids = catalog.tags.map((tag) => tag.id);
    const names = catalog.tags.map((tag) => nameKey(tag.name));
    if (!hasUniqueValues(ids) || !hasUniqueValues(names))
      return { version: 1, tags: [] };
    return copyCatalog(catalog as PersistedFirmTagCatalog);
  } catch {
    return { version: 1, tags: [] };
  }
}

function tagAt(catalog: PersistedFirmTagCatalog, id: string): PersistedFirmTag {
  const tag = catalog.tags.find((item) => item.id === id);
  if (!tag) throw new Error('This tag no longer exists.');
  return tag;
}

function requireAvailableName(
  catalog: PersistedFirmTagCatalog,
  name: string,
  exceptId?: string
): void {
  const existing = catalog.tags.find(
    (tag) => tag.id !== exceptId && nameKey(tag.name) === nameKey(name)
  );
  if (existing) throw new Error('This tag name is already in use.');
}

function replaceTag(
  catalog: PersistedFirmTagCatalog,
  replacement: PersistedFirmTag
): PersistedFirmTagCatalog {
  return {
    version: 1,
    tags: catalog.tags.map((tag) =>
      tag.id === replacement.id ? replacement : tag
    ),
  };
}

function browserStorage(): StorageLike | undefined {
  return typeof localStorage === 'undefined' ? undefined : localStorage;
}

/**
 * Creates the browser-profile persistence adapter for the firm tag catalog.
 *
 * This adapter writes only the tag catalog. Records owned by later consumers
 * stay outside it, so tag administration cannot rewrite stored references.
 */
export function createFirmTagStore(
  storage: StorageLike | undefined = browserStorage()
): FirmTagStore {
  const loadPersisted = () => {
    try {
      return parseCatalog(storage?.getItem(STORAGE_KEY) ?? null);
    } catch {
      return { version: 1, tags: [] } as PersistedFirmTagCatalog;
    }
  };
  const save = (catalog: PersistedFirmTagCatalog) => {
    if (storage) storage.setItem(STORAGE_KEY, JSON.stringify(catalog));
    return toPublicCatalog(catalog);
  };
  const update = (
    mutate: (current: PersistedFirmTagCatalog) => PersistedFirmTagCatalog
  ) => save(mutate(loadPersisted()));

  return {
    list: () => toPublicCatalog(loadPersisted()),
    create: (input: CreateFirmTagInput) =>
      update((catalog) => {
        const name = cleanName(input.name);
        requireAvailableName(catalog, name);
        if (!isColor(input.color))
          throw new Error('Choose an approved tag color.');
        const existingIds = new Set(catalog.tags.map((tag) => tag.id));
        const base = idBase(name);
        let id = base;
        let sequence = 2;
        while (existingIds.has(id)) id = `${base}-${String(sequence++)}`;
        const at = timestamp();
        return {
          version: 1,
          tags: [
            ...catalog.tags,
            {
              id,
              name,
              color: input.color,
              status: 'active',
              createdAt: at,
              updatedAt: at,
            },
          ],
        };
      }),
    rename: (id, rawName) =>
      update((catalog) => {
        const tag = tagAt(catalog, id);
        if (tag.status === 'retired')
          throw new Error('A retired tag cannot be renamed.');
        const name = cleanName(rawName);
        requireAvailableName(catalog, name, id);
        if (name === tag.name) return catalog;
        return replaceTag(catalog, { ...tag, name, updatedAt: timestamp() });
      }),
    setColor: (id, color) =>
      update((catalog) => {
        const tag = tagAt(catalog, id);
        if (tag.status === 'retired')
          throw new Error('A retired tag cannot be recolored.');
        if (!isColor(color)) throw new Error('Choose an approved tag color.');
        if (color === tag.color) return catalog;
        return replaceTag(catalog, { ...tag, color, updatedAt: timestamp() });
      }),
    retire: (id) =>
      update((catalog) => {
        const tag = tagAt(catalog, id);
        if (tag.status === 'retired') return catalog;
        const at = timestamp();
        return replaceTag(catalog, {
          ...tag,
          status: 'retired',
          updatedAt: at,
          retiredAt: at,
        });
      }),
  };
}
