// Tests for ToolbarHost.
//
// Coverage:
//  - handleAdd records the button on pluginRegistryStore.toolbar with the
//    plugin id attached
//  - handleAdd is idempotent on `id` (re-adding replaces)
//  - handleAdd rejects malformed specs with `invalid-args`
//  - handleRemove removes by id (no-op if missing)
//  - handleRemove rejects empty / non-string ids
//  - clearForPlugin (registry-level) removes only the targeted plugin's buttons
//  - audit event fires on every add and remove

import { describe, it, expect, vi, beforeEach } from 'vitest';

import { AuditService } from '@/modules/audit/AuditService';
import { ToolbarHost, ToolbarHostError } from '@/modules/plugins/hosts/ToolbarHost';
import { usePluginRegistryStore } from '@/stores/pluginRegistryStore';
import type { ToolbarButtonSpec } from '@/types/plugin';

let host: ToolbarHost;
let audit: AuditService;

beforeEach(() => {
  globalThis.localStorage.clear();
  audit = new AuditService('test-plugins');
  host = new ToolbarHost({ auditService: audit });
  usePluginRegistryStore.setState({
    commands: new Map(),
    toolbar: [],
    sidebar: [],
    settingsPages: [],
  });
});

const validSpec: ToolbarButtonSpec = {
  id: 'count-words',
  icon: 'hash',
  tooltip: 'Count words',
  command: 'word-counter.count',
};

describe('ToolbarHost.handleAdd', () => {
  it('registers the button on the registry store with the plugin id attached', () => {
    host.handleAdd('word-counter', validSpec);
    const toolbar = usePluginRegistryStore.getState().toolbar;
    expect(toolbar).toHaveLength(1);
    expect(toolbar[0]?.pluginId).toBe('word-counter');
    expect(toolbar[0]?.id).toBe('count-words');
    expect(toolbar[0]?.icon).toBe('hash');
    expect(toolbar[0]?.tooltip).toBe('Count words');
    expect(toolbar[0]?.command).toBe('word-counter.count');
  });

  it('is idempotent: re-adding the same id replaces the previous entry', () => {
    host.handleAdd('word-counter', validSpec);
    host.handleAdd('word-counter', { ...validSpec, tooltip: 'Recount' });
    const toolbar = usePluginRegistryStore.getState().toolbar;
    expect(toolbar).toHaveLength(1);
    expect(toolbar[0]?.tooltip).toBe('Recount');
  });

  it('throws invalid-args for missing id, icon, tooltip, or command', () => {
    expect(() => host.handleAdd('p', { ...validSpec, id: '' })).toThrow(ToolbarHostError);
    expect(() => host.handleAdd('p', { ...validSpec, icon: '' })).toThrow(ToolbarHostError);
    expect(() => host.handleAdd('p', { ...validSpec, tooltip: '' })).toThrow(ToolbarHostError);
    expect(() => host.handleAdd('p', { ...validSpec, command: '' })).toThrow(ToolbarHostError);
  });

  it('throws when spec is null or non-object', () => {
    expect(() =>
      host.handleAdd('p', null as unknown as ToolbarButtonSpec),
    ).toThrow(ToolbarHostError);
  });

  it('emits a plugin_executed audit event with command toolbar.add', () => {
    const appendSpy = vi.spyOn(audit, 'append');
    host.handleAdd('word-counter', validSpec);
    expect(appendSpy).toHaveBeenCalledTimes(1);
    const event = appendSpy.mock.calls[0]?.[0];
    expect(event?.type).toBe('plugin_executed');
    if (event?.type === 'plugin_executed') {
      expect(event.payload.id).toBe('word-counter');
      expect(event.payload.command).toBe('toolbar.add');
    }
  });
});

describe('ToolbarHost.handleRemove', () => {
  it('removes the button by id', () => {
    host.handleAdd('word-counter', validSpec);
    host.handleRemove('word-counter', 'count-words');
    expect(usePluginRegistryStore.getState().toolbar).toHaveLength(0);
  });

  it('is a no-op when the id is not registered', () => {
    expect(() => host.handleRemove('word-counter', 'missing')).not.toThrow();
  });

  it('throws on empty / non-string buttonId', () => {
    expect(() => host.handleRemove('p', '')).toThrow(ToolbarHostError);
    expect(() =>
      host.handleRemove('p', 42 as unknown as string),
    ).toThrow(ToolbarHostError);
  });

  it('emits a plugin_executed audit event with command toolbar.remove', () => {
    host.handleAdd('p', validSpec);
    const appendSpy = vi.spyOn(audit, 'append');
    host.handleRemove('p', validSpec.id);
    const event = appendSpy.mock.calls[0]?.[0];
    expect(event?.type).toBe('plugin_executed');
    if (event?.type === 'plugin_executed') {
      expect(event.payload.command).toBe('toolbar.remove');
    }
  });
});

describe('clearForPlugin (registry-level) removes only the targeted plugin\'s toolbar buttons', () => {
  it('removes plugin-a\'s buttons but leaves plugin-b\'s in place', () => {
    host.handleAdd('plugin-a', { ...validSpec, id: 'a-button' });
    host.handleAdd('plugin-b', { ...validSpec, id: 'b-button' });
    usePluginRegistryStore.getState().clearForPlugin('plugin-a');
    const toolbar = usePluginRegistryStore.getState().toolbar;
    expect(toolbar).toHaveLength(1);
    expect(toolbar[0]?.pluginId).toBe('plugin-b');
  });
});
