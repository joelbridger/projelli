import type { ContactSource, ContactSourceCatalog } from './contract';

export const CONTACT_SOURCES_STORAGE_KEY = 'lantern:crm:contact-sources:v1';

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

export interface ContactSourceCatalogStore {
  load(): ContactSourceCatalog;
  add(label: string, now?: string): ContactSourceCatalog;
  rename(id: string, label: string, now?: string): ContactSourceCatalog;
  setActive(id: string, active: boolean, now?: string): ContactSourceCatalog;
  reorder(ids: readonly string[], now?: string): ContactSourceCatalog;
  retire(id: string, now?: string): ContactSourceCatalog;
}

const INITIAL_TIMESTAMP = new Date(0).toISOString();

export const DEFAULT_CONTACT_SOURCE_CATALOG: ContactSourceCatalog = {
  version: 1,
  sources: [
    {
      id: 'referral',
      label: 'Referral',
      historicalLabels: ['Referral'],
      status: 'active',
      createdAt: INITIAL_TIMESTAMP,
      updatedAt: INITIAL_TIMESTAMP,
    },
  ],
};

function copyCatalog(catalog: ContactSourceCatalog): ContactSourceCatalog {
  return {
    version: 1,
    sources: catalog.sources.map((source) => ({
      ...source,
      historicalLabels: [...source.historicalLabels],
    })),
  };
}

function cleanLabel(value: string): string {
  const label = value.trim().replace(/\s+/g, ' ');
  if (!label) throw new Error('A contact source needs a name.');
  if (label.length > 80)
    throw new Error('A contact source name must be 80 characters or fewer.');
  return label;
}

function labelKey(value: string): string {
  return value.toLowerCase();
}

function identifier(label: string): string {
  const value = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
  return value || 'source';
}

function timestamp(value?: string): string {
  return value ?? new Date().toISOString();
}

function hasUniqueValues(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

function isTimestamp(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

function isStatus(value: unknown): value is ContactSource['status'] {
  return value === 'active' || value === 'inactive' || value === 'retired';
}

function isSource(value: unknown): value is ContactSource {
  if (!value || typeof value !== 'object') return false;
  const source = value as Partial<ContactSource>;
  return (
    typeof source.id === 'string' &&
    source.id.length > 0 &&
    typeof source.label === 'string' &&
    source.label === cleanLabel(source.label) &&
    Array.isArray(source.historicalLabels) &&
    source.historicalLabels.every(
      (label) => typeof label === 'string' && label === cleanLabel(label)
    ) &&
    source.historicalLabels.length > 0 &&
    source.historicalLabels[source.historicalLabels.length - 1] ===
      source.label &&
    isStatus(source.status) &&
    isTimestamp(source.createdAt) &&
    isTimestamp(source.updatedAt) &&
    (source.retiredAt === undefined || isTimestamp(source.retiredAt)) &&
    (source.status === 'retired'
      ? source.retiredAt !== undefined
      : source.retiredAt === undefined)
  );
}

/** Returns an empty-safe default if persisted browser data is malformed. */
export function parseContactSourceCatalog(
  raw: string | null
): ContactSourceCatalog {
  if (!raw) return copyCatalog(DEFAULT_CONTACT_SOURCE_CATALOG);
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object')
      return copyCatalog(DEFAULT_CONTACT_SOURCE_CATALOG);
    const catalog = parsed as Partial<ContactSourceCatalog>;
    if (
      catalog.version !== 1 ||
      !Array.isArray(catalog.sources) ||
      !catalog.sources.every(isSource)
    ) {
      return copyCatalog(DEFAULT_CONTACT_SOURCE_CATALOG);
    }
    const ids = catalog.sources.map((source) => source.id);
    const labels = catalog.sources.map((source) => labelKey(source.label));
    if (!hasUniqueValues(ids) || !hasUniqueValues(labels))
      return copyCatalog(DEFAULT_CONTACT_SOURCE_CATALOG);
    return copyCatalog(catalog as ContactSourceCatalog);
  } catch {
    return copyCatalog(DEFAULT_CONTACT_SOURCE_CATALOG);
  }
}

function sourceAt(catalog: ContactSourceCatalog, id: string): ContactSource {
  const source = catalog.sources.find((item) => item.id === id);
  if (!source) throw new Error('This contact source no longer exists.');
  return source;
}

function requireAvailableLabel(
  catalog: ContactSourceCatalog,
  label: string,
  exceptId?: string
): void {
  const duplicate = catalog.sources.some(
    (source) =>
      source.id !== exceptId && labelKey(source.label) === labelKey(label)
  );
  if (duplicate) throw new Error('This contact source name is already in use.');
}

function replaceSource(
  catalog: ContactSourceCatalog,
  replacement: ContactSource
): ContactSourceCatalog {
  return {
    version: 1,
    sources: catalog.sources.map((source) =>
      source.id === replacement.id ? replacement : source
    ),
  };
}

function save(
  storage: StorageLike | undefined,
  catalog: ContactSourceCatalog
): void {
  if (storage)
    storage.setItem(CONTACT_SOURCES_STORAGE_KEY, JSON.stringify(catalog));
}

/**
 * Browser-profile persistence is the sanctioned TS-only adapter for this
 * Wave-1 catalog. Its methods only write the catalog key; contact records are
 * deliberately outside this adapter so rename and retire cannot rewrite them.
 */
export function createContactSourceCatalogStore(
  storage: StorageLike | undefined = typeof localStorage === 'undefined'
    ? undefined
    : localStorage
): ContactSourceCatalogStore {
  const update = (
    mutate: (current: ContactSourceCatalog, at: string) => ContactSourceCatalog,
    now?: string
  ) => {
    const next = mutate(load(), timestamp(now));
    save(storage, next);
    return next;
  };
  const load = () => {
    try {
      return parseContactSourceCatalog(
        storage?.getItem(CONTACT_SOURCES_STORAGE_KEY) ?? null
      );
    } catch {
      return copyCatalog(DEFAULT_CONTACT_SOURCE_CATALOG);
    }
  };

  return {
    load,
    add: (rawLabel, now) =>
      update((current, at) => {
        const label = cleanLabel(rawLabel);
        requireAvailableLabel(current, label);
        const baseId = identifier(label);
        const ids = new Set(current.sources.map((source) => source.id));
        let id = baseId;
        let sequence = 2;
        while (ids.has(id)) id = `${baseId}-${String(sequence++)}`;
        return {
          version: 1,
          sources: [
            ...current.sources,
            {
              id,
              label,
              historicalLabels: [label],
              status: 'active',
              createdAt: at,
              updatedAt: at,
            },
          ],
        };
      }, now),
    rename: (id, rawLabel, now) =>
      update((current, at) => {
        const source = sourceAt(current, id);
        const label = cleanLabel(rawLabel);
        requireAvailableLabel(current, label, id);
        if (label === source.label) return current;
        return replaceSource(current, {
          ...source,
          label,
          historicalLabels: [...source.historicalLabels, label],
          updatedAt: at,
        });
      }, now),
    setActive: (id, active, now) =>
      update((current, at) => {
        const source = sourceAt(current, id);
        if (source.status === 'retired')
          throw new Error('A retired contact source cannot be reactivated.');
        const status = active ? 'active' : 'inactive';
        if (source.status === status) return current;
        return replaceSource(current, { ...source, status, updatedAt: at });
      }, now),
    reorder: (ids, now) =>
      update((current) => {
        if (
          ids.length !== current.sources.length ||
          !hasUniqueValues(ids) ||
          ids.some((id) => !current.sources.some((source) => source.id === id))
        ) {
          throw new Error(
            'The source order must include every source exactly once.'
          );
        }
        return {
          version: 1,
          sources: ids.map((id) => sourceAt(current, id)),
        };
      }, now),
    retire: (id, now) =>
      update((current, at) => {
        const source = sourceAt(current, id);
        if (source.status === 'retired') return current;
        return replaceSource(current, {
          ...source,
          status: 'retired',
          updatedAt: at,
          retiredAt: at,
        });
      }, now),
  };
}
