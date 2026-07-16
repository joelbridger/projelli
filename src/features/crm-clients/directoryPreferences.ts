export type DirectoryPreferenceValue =
  | null
  | boolean
  | number
  | string
  | readonly DirectoryPreferenceValue[]
  | { readonly [key: string]: DirectoryPreferenceValue };

export type DirectoryPreferenceStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export interface DirectoryPreferenceStore<T> {
  load(): T | null;
  save(value: T): void;
  clear(): void;
}

const NAMESPACE_PATTERN = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;

function isSerializablePreference(value: unknown, seen = new Set<object>()): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'object' || seen.has(value)) return false;
  seen.add(value);
  const valid = Array.isArray(value)
    ? value.every((item) => isSerializablePreference(item, seen))
    : Object.getPrototypeOf(value) === Object.prototype
      && Object.values(value).every((item) => isSerializablePreference(item, seen));
  seen.delete(value);
  return valid;
}

/**
 * Creates one feature-owned preference slot. The namespace keeps view, sort,
 * and filter choices out of directory-core records and other features' data.
 */
export function createDirectoryPreferenceStore<T>(
  namespace: string,
  isPreference: (value: unknown) => value is T,
  storage: DirectoryPreferenceStorage | undefined = typeof localStorage === 'undefined'
    ? undefined
    : localStorage
): DirectoryPreferenceStore<T> {
  if (!NAMESPACE_PATTERN.test(namespace)) {
    throw new Error('[directoryPreferences] namespace must use lowercase letters, numbers, dots, or hyphens');
  }
  const key = `lantern:crm:directory:preferences:${namespace}:v1`;
  return {
    load: () => {
      try {
        const raw = storage?.getItem(key);
        if (!raw) return null;
        const parsed: unknown = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') return null;
        const envelope = parsed as { version?: unknown; value?: unknown };
        return envelope.version === 1 && isPreference(envelope.value) ? envelope.value : null;
      } catch {
        return null;
      }
    },
    save: (value) => {
      if (!isPreference(value)) throw new Error('[directoryPreferences] preference failed feature validation');
      if (!isSerializablePreference(value)) throw new Error('[directoryPreferences] preference must be finite JSON data');
      storage?.setItem(key, JSON.stringify({ version: 1, value }));
    },
    clear: () => { storage?.removeItem(key); },
  };
}
