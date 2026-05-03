// Plugin runner — Settings host adapter.
//
// Two responsibilities:
//
//   1. `settings.addPage` flow (dedicated `settings-add-page` message variant
//      → bridge `onSettingsAddPage` hook). Plugin contributes a settings
//      page schema; host validates the spec and registers it on
//      `pluginRegistryStore.settingsPages` so SettingsModal can render it.
//
//   2. `settings.get` / `settings.set` flow (`api-call` dispatch). Plugin
//      reads / writes a value for a key on its own settings page. Both are
//      ungated per the permission map (no permission required). The host
//      delegates persistence to `StorageHost.getSetting` / `setSetting`,
//      which uses a `:settings:` sub-namespace inside the plugin's
//      localStorage prefix. This means a `StorageHost.clearForPlugin(id)`
//      sweep on uninstall removes both per-plugin storage and per-plugin
//      settings in one pass.
//
// Spec: docs/superpowers/specs/2026-04-28-v2.0-mega-release-design.md §6.4
// Plan: docs/superpowers/plans/2026-05-03-stream-c3-plugin-runner.md (task 4.5)

import {
  usePluginRegistryStore,
} from '@/stores/pluginRegistryStore';
import type { SettingsPageSpec } from '@/types/plugin';

import type { PluginApiDispatchCall } from '../PluginAPIBridge';
import { StorageHost } from './StorageHost';

export class SettingsHostError extends Error {
  readonly code: 'invalid-args';
  constructor(message: string) {
    super(message);
    this.code = 'invalid-args';
    this.name = 'SettingsHostError';
  }
}

export interface SettingsHostOptions {
  /** Inject a storage host (tests) or rely on a default. */
  storageHost?: StorageHost;
}

export class SettingsHost {
  private readonly storageHost: StorageHost;

  constructor(options: SettingsHostOptions = {}) {
    this.storageHost = options.storageHost ?? new StorageHost();
  }

  /**
   * Handler for the bridge `onSettingsAddPage` hook. Validates and registers
   * the page in the registry store.
   */
  handleAddPage(pluginId: string, spec: SettingsPageSpec): void {
    if (!spec || typeof spec !== 'object') {
      throw new SettingsHostError('settings page spec must be an object');
    }
    if (typeof spec.id !== 'string' || spec.id.length === 0) {
      throw new SettingsHostError('settings page id must be a non-empty string');
    }
    if (typeof spec.title !== 'string' || spec.title.length === 0) {
      throw new SettingsHostError('settings page title must be a non-empty string');
    }
    if (!spec.schema || typeof spec.schema !== 'object') {
      throw new SettingsHostError('settings page schema must be an object');
    }
    usePluginRegistryStore.getState().addSettingsPage(pluginId, spec);
  }

  /** Predicate the dispatch coordinator uses to route methods. */
  handlesMethod(method: string): boolean {
    return method === 'settings.get' || method === 'settings.set';
  }

  /**
   * Dispatch handler for `settings.get` / `settings.set`. Returns the value
   * (`get`) or `undefined` (`set`).
   */
  handle(call: PluginApiDispatchCall): unknown {
    const { pluginId, method, args } = call;
    const key = args[0];
    if (typeof key !== 'string' || key.length === 0) {
      throw new SettingsHostError('settings key must be a non-empty string');
    }
    switch (method) {
      case 'settings.get':
        return this.storageHost.getSetting(pluginId, key);
      case 'settings.set':
        this.storageHost.setSetting(pluginId, key, args[1]);
        return undefined;
      default:
        throw new SettingsHostError(`SettingsHost cannot handle method ${method}`);
    }
  }
}
