// Tests for SidebarHost.
//
// Coverage:
//  - handleAdd records the panel on pluginRegistryStore.sidebar with the
//    plugin id attached
//  - handleAdd is idempotent on `id` (re-adding replaces)
//  - handleAdd accepts html-only specs, componentTree-only specs, and both
//  - handleAdd rejects malformed specs (missing id/title, html non-string,
//    neither html nor componentTree present)
//  - handleRemove removes by id (no-op if missing)
//  - handleRemove rejects empty / non-string ids
//  - clearForPlugin (registry-level) removes only the targeted plugin's panels
//  - audit event fires on every add and remove

import { describe, it, expect, vi, beforeEach } from 'vitest';

import { AuditService } from '@/modules/audit/AuditService';
import { SidebarHost, SidebarHostError } from '@/modules/plugins/hosts/SidebarHost';
import { usePluginRegistryStore } from '@/stores/pluginRegistryStore';
import type { SidebarPanelSpec } from '@/types/plugin';

let host: SidebarHost;
let audit: AuditService;

beforeEach(() => {
  globalThis.localStorage.clear();
  audit = new AuditService('test-plugins');
  host = new SidebarHost({ auditService: audit });
  usePluginRegistryStore.setState({
    commands: new Map(),
    toolbar: [],
    sidebar: [],
    settingsPages: [],
  });
});

const htmlSpec: SidebarPanelSpec = {
  id: 'word-count-panel',
  title: 'Word count',
  html: '<div>0 words</div>',
};

describe('SidebarHost.handleAdd', () => {
  it('registers an html-only panel on the registry store with the plugin id attached', () => {
    host.handleAdd('word-counter', htmlSpec);
    const sidebar = usePluginRegistryStore.getState().sidebar;
    expect(sidebar).toHaveLength(1);
    expect(sidebar[0]?.pluginId).toBe('word-counter');
    expect(sidebar[0]?.id).toBe('word-count-panel');
    expect(sidebar[0]?.title).toBe('Word count');
    expect(sidebar[0]?.html).toBe('<div>0 words</div>');
  });

  it('accepts a componentTree-only panel (reserved, validated but not rendered)', () => {
    const treeSpec: SidebarPanelSpec = {
      id: 'tree-panel',
      title: 'Tree panel',
      componentTree: { type: 'view', children: [] },
    };
    host.handleAdd('p', treeSpec);
    const sidebar = usePluginRegistryStore.getState().sidebar;
    expect(sidebar).toHaveLength(1);
    expect(sidebar[0]?.componentTree).toEqual({ type: 'view', children: [] });
  });

  it('is idempotent: re-adding the same id replaces the previous entry', () => {
    host.handleAdd('p', htmlSpec);
    host.handleAdd('p', { ...htmlSpec, title: 'Renamed' });
    const sidebar = usePluginRegistryStore.getState().sidebar;
    expect(sidebar).toHaveLength(1);
    expect(sidebar[0]?.title).toBe('Renamed');
  });

  it('throws invalid-args for missing id or title', () => {
    expect(() => host.handleAdd('p', { ...htmlSpec, id: '' })).toThrow(SidebarHostError);
    expect(() => host.handleAdd('p', { ...htmlSpec, title: '' })).toThrow(SidebarHostError);
  });

  it('throws when neither html nor componentTree is present', () => {
    expect(() =>
      host.handleAdd('p', { id: 'x', title: 'X' } as SidebarPanelSpec),
    ).toThrow(SidebarHostError);
  });

  it('throws when html is provided but not a string', () => {
    expect(() =>
      host.handleAdd('p', {
        id: 'x',
        title: 'X',
        html: 42 as unknown as string,
      }),
    ).toThrow(SidebarHostError);
  });

  it('throws when spec is null or non-object', () => {
    expect(() =>
      host.handleAdd('p', null as unknown as SidebarPanelSpec),
    ).toThrow(SidebarHostError);
  });

  it('emits a plugin_executed audit event with command sidebar.addPanel', () => {
    const appendSpy = vi.spyOn(audit, 'append');
    host.handleAdd('p', htmlSpec);
    const event = appendSpy.mock.calls[0]?.[0];
    expect(event?.type).toBe('plugin_executed');
    if (event?.type === 'plugin_executed') {
      expect(event.payload.id).toBe('p');
      expect(event.payload.command).toBe('sidebar.addPanel');
    }
  });
});

describe('SidebarHost.handleRemove', () => {
  it('removes the panel by id', () => {
    host.handleAdd('p', htmlSpec);
    host.handleRemove('p', htmlSpec.id);
    expect(usePluginRegistryStore.getState().sidebar).toHaveLength(0);
  });

  it('is a no-op when the id is not registered', () => {
    expect(() => host.handleRemove('p', 'missing')).not.toThrow();
  });

  it('throws on empty / non-string panelId', () => {
    expect(() => host.handleRemove('p', '')).toThrow(SidebarHostError);
    expect(() =>
      host.handleRemove('p', 42 as unknown as string),
    ).toThrow(SidebarHostError);
  });

  it('emits a plugin_executed audit event with command sidebar.removePanel', () => {
    host.handleAdd('p', htmlSpec);
    const appendSpy = vi.spyOn(audit, 'append');
    host.handleRemove('p', htmlSpec.id);
    const event = appendSpy.mock.calls[0]?.[0];
    expect(event?.type).toBe('plugin_executed');
    if (event?.type === 'plugin_executed') {
      expect(event.payload.command).toBe('sidebar.removePanel');
    }
  });
});

describe('clearForPlugin (registry-level) removes only the targeted plugin\'s sidebar panels', () => {
  it('removes plugin-a\'s panels but leaves plugin-b\'s in place', () => {
    host.handleAdd('plugin-a', { id: 'a-panel', title: 'A', html: '<div/>' });
    host.handleAdd('plugin-b', { id: 'b-panel', title: 'B', html: '<div/>' });
    usePluginRegistryStore.getState().clearForPlugin('plugin-a');
    const sidebar = usePluginRegistryStore.getState().sidebar;
    expect(sidebar).toHaveLength(1);
    expect(sidebar[0]?.pluginId).toBe('plugin-b');
  });
});
