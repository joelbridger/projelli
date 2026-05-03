// Tests for PluginPermissions.
//
// Coverage:
//  - check() returns true for granted permissions, false for missing ones
//  - checkMethod() honors the permission map (gated methods need the right
//    permission; ungated methods always return true)
//  - composeHooks() returns a hooks bag that emits an audit event on denial
//  - composeHooks() preserves the caller's existing onPermissionDenied
//  - The audit event payload carries id, permission, and apiCall
//  - The class works end-to-end with a paired bridge: a deliberately gated
//    api-call from the worker fires the audit + bridge denial in concert
//
// Plan: docs/superpowers/plans/2026-05-03-stream-c3-plugin-runner.md (task 3.4)

import { describe, it, expect, vi, beforeEach } from 'vitest';

import { AuditService } from '@/modules/audit/AuditService';
import { PluginPermissions } from '@/modules/plugins/PluginPermissions';
import { REQUIRED_PERMISSION_FOR_METHOD } from '@/modules/plugins/permissionMap';
import type {
  PluginAPIMethod,
  PluginMessage,
} from '@/modules/plugins/PluginMessageProtocol';
import type { PluginPermission, PluginManifest, PluginAPI } from '@/types/plugin';

import {
  fakeManifest,
  inlinePluginLoader,
  makePairedBridge,
} from '../../helpers/pluginMockFactory';

beforeEach(() => {
  // Each test starts with a clean localStorage so the audit log doesn't bleed.
  globalThis.localStorage.clear();
});

const ALL_PERMISSIONS: PluginPermission[] = [
  'workspace:read',
  'workspace:write',
  'editor:selection',
  'editor:write',
  'ai:invoke',
  'network',
];

function manifestWith(permissions: PluginPermission[]): PluginManifest {
  return fakeManifest({ id: `plugin-${permissions.join('-') || 'none'}`, permissions });
}

describe('PluginPermissions.check', () => {
  it('returns true for granted permissions', () => {
    const perms = new PluginPermissions(manifestWith(['workspace:read', 'ai:invoke']));
    expect(perms.check('workspace:read')).toBe(true);
    expect(perms.check('ai:invoke')).toBe(true);
  });

  it('returns false for missing permissions', () => {
    const perms = new PluginPermissions(manifestWith(['workspace:read']));
    expect(perms.check('workspace:write')).toBe(false);
    expect(perms.check('network')).toBe(false);
  });

  it('returns false for every permission when manifest declares none', () => {
    const perms = new PluginPermissions(manifestWith([]));
    for (const p of ALL_PERMISSIONS) {
      expect(perms.check(p)).toBe(false);
    }
  });

  it('returns true for every permission when manifest declares all', () => {
    const perms = new PluginPermissions(manifestWith(ALL_PERMISSIONS));
    for (const p of ALL_PERMISSIONS) {
      expect(perms.check(p)).toBe(true);
    }
  });
});

describe('PluginPermissions.checkMethod', () => {
  it('always allows ungated methods regardless of declared permissions', () => {
    const perms = new PluginPermissions(manifestWith([]));
    const ungatedMethods: PluginAPIMethod[] = [
      'storage.get',
      'storage.set',
      'storage.remove',
      'commands.invoke',
      'settings.get',
      'settings.set',
    ];
    for (const m of ungatedMethods) {
      expect(perms.checkMethod(m)).toBe(true);
    }
  });

  it('matches the permission map for gated methods', () => {
    // For each gated method, build a manifest with exactly that permission;
    // assert checkMethod=true. Then build a manifest without it; assert false.
    for (const [method, required] of Object.entries(REQUIRED_PERMISSION_FOR_METHOD)) {
      if (required === null) continue;
      const granted = new PluginPermissions(manifestWith([required]));
      expect(granted.checkMethod(method as PluginAPIMethod)).toBe(true);

      const denied = new PluginPermissions(manifestWith([]));
      expect(denied.checkMethod(method as PluginAPIMethod)).toBe(false);
    }
  });

  it('grants only the matching permission, not adjacent ones', () => {
    // editor:selection allows reading but not writing
    const perms = new PluginPermissions(manifestWith(['editor:selection']));
    expect(perms.checkMethod('editor.getSelection')).toBe(true);
    expect(perms.checkMethod('editor.getContent')).toBe(true);
    expect(perms.checkMethod('editor.replaceSelection')).toBe(false);
    expect(perms.checkMethod('editor.insertAtCursor')).toBe(false);
  });

  it('workspace:read does not grant write methods', () => {
    const perms = new PluginPermissions(manifestWith(['workspace:read']));
    expect(perms.checkMethod('workspace.listFiles')).toBe(true);
    expect(perms.checkMethod('workspace.readFile')).toBe(true);
    expect(perms.checkMethod('workspace.writeFile')).toBe(false);
  });
});

describe('PluginPermissions.composeHooks audit emission', () => {
  it('emits a plugin_permission_denied audit event when the composed hook fires', () => {
    const audit = new AuditService('test-plugins');
    const appendSpy = vi.spyOn(audit, 'append');

    const perms = new PluginPermissions(manifestWith([]), audit);
    const composed = perms.composeHooks({});
    composed.onPermissionDenied?.({ permission: 'workspace:write', method: 'workspace.writeFile' });

    expect(appendSpy).toHaveBeenCalledTimes(1);
    const arg = appendSpy.mock.calls[0]?.[0];
    expect(arg?.type).toBe('plugin_permission_denied');
    if (arg?.type === 'plugin_permission_denied') {
      expect(arg.payload).toEqual({
        id: expect.any(String),
        permission: 'workspace:write',
        apiCall: 'workspace.writeFile',
      });
      expect(typeof arg.timestamp).toBe('string');
    }
  });

  it('preserves a caller-supplied onPermissionDenied hook', () => {
    const audit = new AuditService('test-plugins');
    const userHook = vi.fn();

    const perms = new PluginPermissions(manifestWith([]), audit);
    const composed = perms.composeHooks({ onPermissionDenied: userHook });
    composed.onPermissionDenied?.({ permission: 'ai:invoke', method: 'ai.invoke' });

    expect(userHook).toHaveBeenCalledTimes(1);
    expect(userHook).toHaveBeenCalledWith({ permission: 'ai:invoke', method: 'ai.invoke' });
  });

  it('still emits the audit event even when the caller hook throws', () => {
    const audit = new AuditService('test-plugins');
    const appendSpy = vi.spyOn(audit, 'append');
    const userHook = vi.fn(() => {
      throw new Error('hook explosion');
    });

    const perms = new PluginPermissions(manifestWith([]), audit);
    const composed = perms.composeHooks({ onPermissionDenied: userHook });

    expect(() =>
      composed.onPermissionDenied?.({ permission: 'network', method: 'network.fetch' }),
    ).not.toThrow();
    expect(appendSpy).toHaveBeenCalledTimes(1);
  });

  it('emitDenied directly produces a payload with id+permission+apiCall', () => {
    const audit = new AuditService('test-plugins');
    const appendSpy = vi.spyOn(audit, 'append');

    const perms = new PluginPermissions(manifestWith([]), audit);
    perms.emitDenied('network', 'network.fetch');

    const arg = appendSpy.mock.calls[0]?.[0];
    if (arg?.type === 'plugin_permission_denied') {
      expect(arg.payload.permission).toBe('network');
      expect(arg.payload.apiCall).toBe('network.fetch');
      expect(arg.payload.id).toMatch(/^plugin-/);
    } else {
      throw new Error('expected plugin_permission_denied event');
    }
  });
});

describe('PluginPermissions end-to-end with a paired bridge', () => {
  it('audit fires when a worker calls a gated method without permission', async () => {
    const audit = new AuditService('test-plugins');
    const appendSpy = vi.spyOn(audit, 'append');

    const manifest = manifestWith([]); // no permissions
    const perms = new PluginPermissions(manifest, audit);

    let apiHandle: PluginAPI | undefined;
    const loader = inlinePluginLoader({
      'plugin-source': {
        async activate(api) {
          apiHandle = api;
        },
      },
    });
    const dispatchSpy = vi.fn();
    const { bridge } = makePairedBridge(
      manifest,
      perms.composeHooks({ dispatch: dispatchSpy }),
      { loader },
    );
    bridge.sendInit({ code: 'plugin-source' });

    // Wait for activate to resolve
    await new Promise((r) => queueMicrotask(() => r(null)));
    await new Promise((r) => queueMicrotask(() => r(null)));
    expect(apiHandle).toBeDefined();

    // Plugin attempts a gated network call; bridge denies, audit fires.
    const fetchPromise = apiHandle!.network.fetch('https://example.test');
    await expect(fetchPromise).rejects.toMatchObject({ code: 'permission-denied' });

    expect(dispatchSpy).not.toHaveBeenCalled();
    const denyEvent = appendSpy.mock.calls
      .map((c) => c[0])
      .find((e) => (e as { type?: string }).type === 'plugin_permission_denied');
    expect(denyEvent).toBeDefined();
    if (denyEvent && denyEvent.type === 'plugin_permission_denied') {
      expect(denyEvent.payload.permission).toBe('network');
      expect(denyEvent.payload.apiCall).toBe('network.fetch');
    }
    bridge.terminate();
  });

  it('does NOT fire audit when the call is permitted (dispatch reaches the host)', async () => {
    const audit = new AuditService('test-plugins');
    const appendSpy = vi.spyOn(audit, 'append');

    const manifest = manifestWith(['workspace:read']);
    const perms = new PluginPermissions(manifest, audit);

    let apiHandle: PluginAPI | undefined;
    const loader = inlinePluginLoader({
      'plugin-source': {
        async activate(api) {
          apiHandle = api;
        },
      },
    });
    const dispatchSpy = vi.fn(() => 'ok');
    const { bridge } = makePairedBridge(
      manifest,
      perms.composeHooks({ dispatch: dispatchSpy }),
      { loader },
    );
    bridge.sendInit({ code: 'plugin-source' });

    await new Promise((r) => queueMicrotask(() => r(null)));
    await new Promise((r) => queueMicrotask(() => r(null)));
    expect(apiHandle).toBeDefined();

    await apiHandle!.workspace.readFile('readme.md');

    expect(dispatchSpy).toHaveBeenCalledTimes(1);
    const denyEvents = appendSpy.mock.calls
      .map((c) => c[0])
      .filter((e) => (e as { type?: string }).type === 'plugin_permission_denied');
    expect(denyEvents).toHaveLength(0);
    bridge.terminate();
  });
});
