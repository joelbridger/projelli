// Plugin runner — Storage host adapter.
//
// Per-plugin key-value store backed by `localStorage`. Keys are namespaced
// `keepance:plugin:<pluginId>:<userKey>` so plugins can never read or
// overwrite each other's data, and so a `clearForPlugin(pluginId)` sweep on
// uninstall can remove every entry deterministically.
//
// The plan caveat (per the bridge wiring) is that `storage.*` is unconditionally
// allowed (no permission gate). This host is reused by `SettingsHost` for the
// per-plugin settings page values via a `:settings:` sub-prefix.
//
// Storage scope notes:
//   - One browser origin → one keyspace. The Tauri webview shares localStorage
//     across workspaces in v2.0, which the spec accepts (deferred to v2.x).
//   - Values are JSON-encoded so plugins can store arrays, plain objects,
//     numbers, booleans, etc. Functions / Symbols / circular refs throw at
//     call time with code `invalid-args`.
//   - `get` returns `null` for missing keys (matches `localStorage.getItem`).
//
// Spec: docs/superpowers/specs/2026-04-28-v2.0-mega-release-design.md §6.4
// Plan: docs/superpowers/plans/2026-05-03-stream-c3-plugin-runner.md (task 4.4)

import type { PluginApiDispatchCall } from '../PluginAPIBridge';

const KEY_PREFIX = 'keepance:plugin:';
const SETTINGS_SUBPREFIX = 'settings:';

/**
 * Coded error to mirror the bridge's protocol error codes. `invalid-args`
 * survives intact through the bridge dispatcher catch.
 */
export class StorageHostError extends Error {
  readonly code: 'invalid-args';
  constructor(message: string) {
    super(message);
    this.code = 'invalid-args';
    this.name = 'StorageHostError';
  }
}

/**
 * Storage backend interface so tests can supply an in-memory map without
 * touching the real `localStorage`. The shape mirrors `Storage` only enough
 * for what the host uses.
 */
export interface PluginStorageBackend {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  /** Keys() iterator. Implementations that lazily snapshot are fine. */
  keys(): string[];
}

function defaultBackend(): PluginStorageBackend {
  return {
    getItem(key) {
      if (typeof localStorage === 'undefined') return null;
      return localStorage.getItem(key);
    },
    setItem(key, value) {
      if (typeof localStorage === 'undefined') return;
      localStorage.setItem(key, value);
    },
    removeItem(key) {
      if (typeof localStorage === 'undefined') return;
      localStorage.removeItem(key);
    },
    keys() {
      if (typeof localStorage === 'undefined') return [];
      const out: string[] = [];
      for (let i = 0; i < localStorage.length; i += 1) {
        const k = localStorage.key(i);
        if (k !== null) out.push(k);
      }
      return out;
    },
  };
}

export interface StorageHostOptions {
  backend?: PluginStorageBackend;
}

export class StorageHost {
  private readonly backend: PluginStorageBackend;

  constructor(options: StorageHostOptions = {}) {
    this.backend = options.backend ?? defaultBackend();
  }

  /** Predicate the dispatch coordinator uses to route methods. */
  handlesMethod(method: string): boolean {
    return method === 'storage.get' || method === 'storage.set' || method === 'storage.remove';
  }

  /**
   * Dispatch handler for `storage.*`. Returns the value (`get`), `undefined`
   * (`set`/`remove`), and throws `StorageHostError` for malformed args.
   */
  handle(call: PluginApiDispatchCall): unknown {
    const { pluginId, method, args } = call;
    switch (method) {
      case 'storage.get':
        return this.get(pluginId, requireKey(args[0]));
      case 'storage.set':
        this.set(pluginId, requireKey(args[0]), args[1]);
        return undefined;
      case 'storage.remove':
        this.remove(pluginId, requireKey(args[0]));
        return undefined;
      default:
        throw new StorageHostError(`StorageHost cannot handle method ${method}`);
    }
  }

  /** Lower-level get for direct callers (SettingsHost). Returns `null` if missing. */
  get(pluginId: string, key: string): unknown {
    const raw = this.backend.getItem(this.fullKey(pluginId, key));
    if (raw === null) return null;
    try {
      return JSON.parse(raw);
    } catch {
      // The previous writer wasn't us, or storage was hand-edited. Surface
      // the raw string so callers get something useful instead of throwing.
      return raw;
    }
  }

  /** Lower-level set for direct callers (SettingsHost). Throws on non-cloneable values. */
  set(pluginId: string, key: string, value: unknown): void {
    let encoded: string;
    try {
      encoded = JSON.stringify(value);
    } catch (err) {
      throw new StorageHostError(
        `storage value not JSON-serializable: ${(err as Error).message}`,
      );
    }
    if (encoded === undefined) {
      // JSON.stringify(undefined) === undefined. Treat as remove.
      this.backend.removeItem(this.fullKey(pluginId, key));
      return;
    }
    this.backend.setItem(this.fullKey(pluginId, key), encoded);
  }

  /** Lower-level remove for direct callers (SettingsHost). */
  remove(pluginId: string, key: string): void {
    this.backend.removeItem(this.fullKey(pluginId, key));
  }

  /**
   * Settings-flavored accessors. SettingsHost uses these to keep its values
   * alongside the plugin's own storage but in a separate sub-namespace, so a
   * `clearForPlugin(pluginId)` sweep removes both kinds at once.
   */
  getSetting(pluginId: string, key: string): unknown {
    return this.get(pluginId, `${SETTINGS_SUBPREFIX}${key}`);
  }
  setSetting(pluginId: string, key: string, value: unknown): void {
    this.set(pluginId, `${SETTINGS_SUBPREFIX}${key}`, value);
  }
  removeSetting(pluginId: string, key: string): void {
    this.remove(pluginId, `${SETTINGS_SUBPREFIX}${key}`);
  }

  /**
   * Remove every storage entry owned by a plugin. Called by the manager on
   * disable / uninstall (and as a precaution during update). Sweeps both
   * the plain storage and the settings sub-namespace because both share
   * the same `pluginId` prefix.
   */
  clearForPlugin(pluginId: string): void {
    const prefix = this.pluginPrefix(pluginId);
    for (const key of this.backend.keys()) {
      if (key.startsWith(prefix)) {
        this.backend.removeItem(key);
      }
    }
  }

  private pluginPrefix(pluginId: string): string {
    return `${KEY_PREFIX}${pluginId}:`;
  }

  private fullKey(pluginId: string, userKey: string): string {
    return `${this.pluginPrefix(pluginId)}${userKey}`;
  }
}

function requireKey(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new StorageHostError('storage key must be a non-empty string');
  }
  return value;
}
