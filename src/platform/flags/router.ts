import { useSyncExternalStore } from 'react';
import { flagRegistry, type FlagDescriptor, type FlagId } from './registry';

/**
 * The only feature-flag decision point.
 *
 * Business logic must never read `import.meta.env`, `localStorage`, or a flag
 * name directly. Use `isEnabled()` outside React and `useFlag()` in React so
 * production configuration, development overrides, and the safe-off fallback
 * remain identical everywhere.
 */

export const DEV_OVERRIDE_STORAGE_KEY = 'lantern:feature-flags';

type Environment = Readonly<Record<string, unknown>>;

export interface FlagRouterOptions<Id extends string = string> {
  registry?: readonly (FlagDescriptor & { id: Id })[];
  environment?: Environment;
  isDevelopment?: boolean;
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | undefined;
}

export interface FlagRouter<Id extends string = string> {
  isEnabled(id: Id): boolean;
  getOverride(id: Id): boolean | undefined;
  setDevOverride(id: Id, enabled: boolean | undefined): void;
  subscribe(listener: () => void): () => void;
}

function environmentKey(id: string) {
  return `VITE_FLAG_${id.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;
}

function isEnabledValue(value: unknown): boolean | undefined {
  if (typeof value !== 'string') return undefined;
  if (['1', 'true', 'on'].includes(value.toLowerCase())) return true;
  if (['0', 'false', 'off'].includes(value.toLowerCase())) return false;
  return undefined;
}

function readOverrides(
  storage: FlagRouterOptions['storage']
): Record<string, boolean> {
  if (!storage) return {};
  try {
    const raw = storage.getItem(DEV_OVERRIDE_STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, boolean] => typeof entry[1] === 'boolean'
      )
    );
  } catch {
    return {};
  }
}

function browserStorage(): FlagRouterOptions['storage'] {
  return typeof localStorage === 'undefined' ? undefined : localStorage;
}

/** Builds an isolated router for tests or other renderer entry points. */
export function createFlagRouter<Id extends string>(
  options: FlagRouterOptions<Id> = {}
): FlagRouter<Id> {
  const registry =
    options.registry ??
    (flagRegistry as unknown as readonly (FlagDescriptor & { id: Id })[]);
  const descriptors = new Map(registry.map((flag) => [flag.id, flag]));
  const environment = options.environment ?? (import.meta.env as Environment);
  const isDevelopment = options.isDevelopment ?? import.meta.env.DEV;
  const storage = options.storage ?? browserStorage();
  const listeners = new Set<() => void>();

  const getOverride = (id: Id) => {
    if (!isDevelopment || !descriptors.has(id)) return undefined;
    return readOverrides(storage)[id];
  };

  const isEnabled = (id: Id) => {
    const descriptor = descriptors.get(id);
    if (!descriptor) return false;
    const override = getOverride(id);
    if (override !== undefined) return override;
    return (
      isEnabledValue(environment[environmentKey(id)]) ??
      descriptor.defaultEnabled
    );
  };

  const setDevOverride = (id: Id, enabled: boolean | undefined) => {
    if (!isDevelopment || !storage || !descriptors.has(id)) return;
    const overrides = readOverrides(storage);
    if (enabled === undefined) Reflect.deleteProperty(overrides, id);
    else overrides[id] = enabled;
    if (Object.keys(overrides).length === 0)
      storage.removeItem(DEV_OVERRIDE_STORAGE_KEY);
    else storage.setItem(DEV_OVERRIDE_STORAGE_KEY, JSON.stringify(overrides));
    listeners.forEach((listener) => {
      listener();
    });
  };

  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };

  return {
    isEnabled,
    getOverride,
    setDevOverride,
    subscribe,
  };
}

const defaultRouter = createFlagRouter<FlagId>();
const subscribeToDefaultRouter = (listener: () => void) =>
  defaultRouter.subscribe(listener);

/** Returns whether a flag is enabled for non-React code. */
export function isEnabled(id: FlagId): boolean {
  return defaultRouter.isEnabled(id);
}

/** React-safe flag access that updates after a development override changes. */
export function useFlag(id: FlagId): boolean {
  return useSyncExternalStore(
    subscribeToDefaultRouter,
    () => defaultRouter.isEnabled(id),
    () => defaultRouter.isEnabled(id)
  );
}

/** Development-only override surface; production calls are harmless no-ops. */
export function setDevFlagOverride(
  id: FlagId,
  enabled: boolean | undefined
): void {
  defaultRouter.setDevOverride(id, enabled);
}
