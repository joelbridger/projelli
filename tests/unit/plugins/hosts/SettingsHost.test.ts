// Tests for SettingsHost.
//
// Coverage:
//  - handleAddPage records the page in pluginRegistryStore.settingsPages with
//    the plugin id attached
//  - handleAddPage is idempotent on `id` (re-adding replaces)
//  - handleAddPage rejects malformed specs with `invalid-args`
//  - handle('settings.get') / handle('settings.set') round-trip via the
//    underlying StorageHost's :settings: sub-namespace
//  - settings.* values are isolated from plain storage.* values for the same key
//  - handle rejects unknown methods + bad keys
//  - handlesMethod is true only for settings.get / settings.set
//  - clearForPlugin (registry-level) removes only the targeted plugin's pages

import { describe, it, expect, beforeEach } from 'vitest';

import { SettingsHost, SettingsHostError } from '@/modules/plugins/hosts/SettingsHost';
import {
  StorageHost,
  type PluginStorageBackend,
} from '@/modules/plugins/hosts/StorageHost';
import { usePluginRegistryStore } from '@/stores/pluginRegistryStore';
import type { SettingsPageSpec } from '@/types/plugin';

class MemoryBackend implements PluginStorageBackend {
  private store = new Map<string, string>();
  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null;
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
  keys(): string[] {
    return Array.from(this.store.keys());
  }
}

let backend: MemoryBackend;
let storageHost: StorageHost;
let host: SettingsHost;

beforeEach(() => {
  backend = new MemoryBackend();
  storageHost = new StorageHost({ backend });
  host = new SettingsHost({ storageHost });
  usePluginRegistryStore.setState({
    commands: new Map(),
    toolbar: [],
    sidebar: [],
    settingsPages: [],
  });
});

const validPage: SettingsPageSpec = {
  id: 'translator',
  title: 'Translator settings',
  schema: {
    targetLang: { type: 'select', label: 'Target language', default: 'es', choices: ['es', 'fr'] },
    autoCopy: { type: 'boolean', label: 'Auto-copy result', default: false },
  },
};

describe('SettingsHost.handleAddPage', () => {
  it('registers the page on the registry store with the plugin id attached', () => {
    host.handleAddPage('translator', validPage);
    const pages = usePluginRegistryStore.getState().settingsPages;
    expect(pages).toHaveLength(1);
    expect(pages[0]?.pluginId).toBe('translator');
    expect(pages[0]?.id).toBe('translator');
    expect(pages[0]?.title).toBe('Translator settings');
  });

  it('is idempotent: re-adding the same id replaces the previous entry', () => {
    host.handleAddPage('translator', validPage);
    host.handleAddPage('translator', { ...validPage, title: 'Renamed' });
    const pages = usePluginRegistryStore.getState().settingsPages;
    expect(pages).toHaveLength(1);
    expect(pages[0]?.title).toBe('Renamed');
  });

  it('throws invalid-args for missing id, title, or schema', () => {
    expect(() => host.handleAddPage('p', { ...validPage, id: '' })).toThrow(SettingsHostError);
    expect(() => host.handleAddPage('p', { ...validPage, title: '' })).toThrow(SettingsHostError);
    expect(() =>
      host.handleAddPage('p', {
        ...validPage,
        schema: undefined as unknown as SettingsPageSpec['schema'],
      }),
    ).toThrow(SettingsHostError);
  });

  it('throws when spec is null or non-object', () => {
    expect(() =>
      host.handleAddPage('p', null as unknown as SettingsPageSpec),
    ).toThrow(SettingsHostError);
  });
});

describe('SettingsHost.handle (settings.get / settings.set dispatch)', () => {
  it('round-trips set + get for a plugin\'s setting value', () => {
    host.handle({ pluginId: 'p', method: 'settings.set', args: ['targetLang', 'fr'] });
    expect(host.handle({ pluginId: 'p', method: 'settings.get', args: ['targetLang'] })).toBe('fr');
  });

  it('returns null for an unset setting', () => {
    expect(host.handle({ pluginId: 'p', method: 'settings.get', args: ['nope'] })).toBeNull();
  });

  it('isolates settings.* values from storage.* values for the same key', () => {
    storageHost.set('p', 'shared', 'plain-storage');
    host.handle({ pluginId: 'p', method: 'settings.set', args: ['shared', 'in-settings'] });
    expect(storageHost.get('p', 'shared')).toBe('plain-storage');
    expect(storageHost.getSetting('p', 'shared')).toBe('in-settings');
    expect(host.handle({ pluginId: 'p', method: 'settings.get', args: ['shared'] })).toBe('in-settings');
  });

  it('isolates one plugin\'s settings from another\'s', () => {
    host.handle({ pluginId: 'plugin-a', method: 'settings.set', args: ['k', 'A'] });
    host.handle({ pluginId: 'plugin-b', method: 'settings.set', args: ['k', 'B'] });
    expect(host.handle({ pluginId: 'plugin-a', method: 'settings.get', args: ['k'] })).toBe('A');
    expect(host.handle({ pluginId: 'plugin-b', method: 'settings.get', args: ['k'] })).toBe('B');
  });

  it('throws invalid-args on empty or non-string keys', () => {
    expect(() =>
      host.handle({ pluginId: 'p', method: 'settings.set', args: ['', 'v'] }),
    ).toThrow(SettingsHostError);
    expect(() =>
      host.handle({ pluginId: 'p', method: 'settings.get', args: [42] }),
    ).toThrow(SettingsHostError);
  });

  it('throws on unknown methods', () => {
    expect(() =>
      host.handle({ pluginId: 'p', method: 'settings.flush', args: [] }),
    ).toThrow(SettingsHostError);
  });
});

describe('SettingsHost.handlesMethod', () => {
  it('returns true only for settings.get / settings.set', () => {
    expect(host.handlesMethod('settings.get')).toBe(true);
    expect(host.handlesMethod('settings.set')).toBe(true);
    expect(host.handlesMethod('settings.addPage')).toBe(false);
    expect(host.handlesMethod('storage.get')).toBe(false);
  });
});

describe('clearForPlugin (registry-level) removes only the targeted plugin\'s settings page', () => {
  it('removes plugin-a\'s page but leaves plugin-b\'s in place', () => {
    host.handleAddPage('plugin-a', { id: 'a-page', title: 'A', schema: {} });
    host.handleAddPage('plugin-b', { id: 'b-page', title: 'B', schema: {} });
    usePluginRegistryStore.getState().clearForPlugin('plugin-a');
    const pages = usePluginRegistryStore.getState().settingsPages;
    expect(pages).toHaveLength(1);
    expect(pages[0]?.pluginId).toBe('plugin-b');
  });
});
