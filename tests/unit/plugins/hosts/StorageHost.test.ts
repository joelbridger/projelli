// Tests for StorageHost.
//
// Coverage:
//  - get/set/remove round-trip via dispatch (api-call surface)
//  - Keys are namespaced `projelli:plugin:<pluginId>:<key>` so two plugins
//    using the same user-key do not collide
//  - Lower-level get/set/remove + getSetting/setSetting/removeSetting work
//  - Settings sub-namespace (`:settings:`) does not collide with plain storage
//  - JSON-serializable values round-trip exactly (objects, arrays, numbers,
//    booleans, null)
//  - Non-serializable values throw with code `invalid-args`
//  - Setting `undefined` removes the key (matches JSON.stringify semantics)
//  - Missing keys return null
//  - Empty / non-string keys throw `invalid-args`
//  - clearForPlugin removes only the targeted plugin's keys (both storage +
//    settings sub-namespace)
//  - handle rejects unknown methods
//
// Tests use an in-memory backend so they don't depend on the jsdom
// localStorage implementation.

import { describe, it, expect, beforeEach } from 'vitest';

import {
  StorageHost,
  StorageHostError,
  type PluginStorageBackend,
} from '@/modules/plugins/hosts/StorageHost';

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
  size(): number {
    return this.store.size;
  }
}

let backend: MemoryBackend;
let host: StorageHost;

beforeEach(() => {
  backend = new MemoryBackend();
  host = new StorageHost({ backend });
});

describe('StorageHost.handle (api-call dispatch)', () => {
  it('round-trips set + get for an arbitrary value', () => {
    host.handle({ pluginId: 'p', method: 'storage.set', args: ['cfg', { x: 1 }] });
    const result = host.handle({ pluginId: 'p', method: 'storage.get', args: ['cfg'] });
    expect(result).toEqual({ x: 1 });
  });

  it('returns null for missing keys', () => {
    expect(host.handle({ pluginId: 'p', method: 'storage.get', args: ['nope'] })).toBeNull();
  });

  it('removes a key via storage.remove', () => {
    host.handle({ pluginId: 'p', method: 'storage.set', args: ['k', 'v'] });
    expect(host.handle({ pluginId: 'p', method: 'storage.get', args: ['k'] })).toBe('v');
    host.handle({ pluginId: 'p', method: 'storage.remove', args: ['k'] });
    expect(host.handle({ pluginId: 'p', method: 'storage.get', args: ['k'] })).toBeNull();
  });

  it('throws invalid-args on non-string or empty key', () => {
    expect(() =>
      host.handle({ pluginId: 'p', method: 'storage.get', args: [''] }),
    ).toThrow(StorageHostError);
    expect(() =>
      host.handle({ pluginId: 'p', method: 'storage.set', args: [42, 'x'] }),
    ).toThrow(StorageHostError);
  });

  it('throws on non-JSON-serializable values', () => {
    const circular: Record<string, unknown> = {};
    circular['self'] = circular;
    expect(() =>
      host.handle({ pluginId: 'p', method: 'storage.set', args: ['k', circular] }),
    ).toThrow(StorageHostError);
  });

  it('throws on unknown methods', () => {
    expect(() =>
      host.handle({ pluginId: 'p', method: 'storage.flush', args: [] }),
    ).toThrow(StorageHostError);
  });

  it('treats setting undefined as remove', () => {
    host.handle({ pluginId: 'p', method: 'storage.set', args: ['k', 'v'] });
    host.handle({ pluginId: 'p', method: 'storage.set', args: ['k', undefined] });
    expect(host.handle({ pluginId: 'p', method: 'storage.get', args: ['k'] })).toBeNull();
  });
});

describe('StorageHost — namespacing', () => {
  it('does not let one plugin overwrite another\'s key', () => {
    host.handle({ pluginId: 'plugin-a', method: 'storage.set', args: ['shared', 'A' ] });
    host.handle({ pluginId: 'plugin-b', method: 'storage.set', args: ['shared', 'B'] });
    expect(host.handle({ pluginId: 'plugin-a', method: 'storage.get', args: ['shared'] })).toBe('A');
    expect(host.handle({ pluginId: 'plugin-b', method: 'storage.get', args: ['shared'] })).toBe('B');
  });

  it('uses the canonical projelli:plugin:<id>:<key> key prefix', () => {
    host.set('alpha', 'k', 1);
    expect(backend.getItem('projelli:plugin:alpha:k')).toBe('1');
  });

  it('settings sub-namespace does not collide with plain storage of the same key', () => {
    host.set('p', 'shared', 'plain');
    host.setSetting('p', 'shared', 'in-settings');
    expect(host.get('p', 'shared')).toBe('plain');
    expect(host.getSetting('p', 'shared')).toBe('in-settings');
  });
});

describe('StorageHost — JSON round-trip fidelity', () => {
  it('preserves arrays, objects, numbers, booleans, and null', () => {
    const fixtures: Array<[string, unknown]> = [
      ['arr', [1, 2, 3]],
      ['obj', { a: 'x', b: { c: true } }],
      ['num', 42],
      ['bool', false],
      ['nul', null],
    ];
    for (const [k, v] of fixtures) {
      host.set('p', k, v);
      expect(host.get('p', k)).toEqual(v);
    }
  });

  it('falls back to the raw string when storage was hand-edited to non-JSON', () => {
    backend.setItem('projelli:plugin:p:k', 'not-json');
    expect(host.get('p', 'k')).toBe('not-json');
  });
});

describe('StorageHost.clearForPlugin', () => {
  it('removes every key (storage + settings) for the targeted plugin only', () => {
    host.set('plugin-a', 'k1', 1);
    host.set('plugin-a', 'k2', 2);
    host.setSetting('plugin-a', 's1', 'a-setting');
    host.set('plugin-b', 'k1', 'b-keep');
    host.setSetting('plugin-b', 's1', 'b-setting');

    host.clearForPlugin('plugin-a');

    expect(host.get('plugin-a', 'k1')).toBeNull();
    expect(host.get('plugin-a', 'k2')).toBeNull();
    expect(host.getSetting('plugin-a', 's1')).toBeNull();
    expect(host.get('plugin-b', 'k1')).toBe('b-keep');
    expect(host.getSetting('plugin-b', 's1')).toBe('b-setting');
  });

  it('is a no-op for a plugin id with no entries', () => {
    host.set('plugin-a', 'k', 'v');
    host.clearForPlugin('nobody');
    expect(host.get('plugin-a', 'k')).toBe('v');
  });
});

describe('StorageHost.handlesMethod', () => {
  it('returns true only for storage.* methods', () => {
    expect(host.handlesMethod('storage.get')).toBe(true);
    expect(host.handlesMethod('storage.set')).toBe(true);
    expect(host.handlesMethod('storage.remove')).toBe(true);
    expect(host.handlesMethod('storage.flush')).toBe(false);
    expect(host.handlesMethod('settings.get')).toBe(false);
  });
});
