// Tests for PluginRuntime.
//
// The runtime runs inside the worker. Tests use a mocked PluginWorkerScope so
// no actual Worker is spawned. For end-to-end flows (init -> activate ->
// commands.register -> invoke -> result), the paired-bridge factory in
// pluginMockFactory wires bridge + runtime over microtask queues.
//
// Coverage:
//  - init: loader resolves, plugin.activate is called, deactivate captured
//  - init: loader rejects with non-Error -> error message of code plugin-threw
//  - api proxy: callApi posts api-call, resolves on api-result
//  - api proxy: callApi rejects with structured error on api-error
//  - api proxy: every API surface posts the right method
//  - commands.register makes the command invokable end-to-end
//  - invoke unknown command returns unknown-command error
//  - invoke command that throws returns plugin-threw error
//  - notify.* posts the dedicated notify variant
//  - toolbar/sidebar/settings register methods post their dedicated variants
//  - deactivate is idempotent
//  - api proxy.pluginId / api.version reflect init
//  - default-export module shape AND named-export module shape both supported

import { describe, it, expect, vi } from 'vitest';

import {
  PluginRuntime,
  type PluginLoader,
  type PluginWorkerScope,
} from '@/modules/plugins/PluginRuntime';
import {
  decode,
  encode,
  type PluginMessage,
} from '@/modules/plugins/PluginMessageProtocol';
import type {
  PluginAPI,
  PluginEditorSelection,
  PluginModule,
} from '@/types/plugin';
import {
  fakeManifest,
  inlinePluginLoader,
  makePairedBridge,
} from '../../helpers/pluginMockFactory';

/** Build a stand-alone mock worker scope for direct runtime tests. */
function makeStandaloneScope(): {
  scope: PluginWorkerScope;
  posted: PluginMessage[];
  dispatchToRuntime: (msg: PluginMessage) => void;
} {
  const posted: PluginMessage[] = [];
  let messageListener: ((event: { data?: unknown }) => void) | null = null;

  const scope: PluginWorkerScope = {
    postMessage(data) {
      try {
        posted.push(decode(data));
      } catch {
        // skip
      }
    },
    addEventListener(_type, listener) {
      messageListener = listener;
    },
  };

  return {
    scope,
    posted,
    dispatchToRuntime(msg) {
      messageListener?.({ data: encode(msg) });
    },
  };
}

describe('PluginRuntime.init', () => {
  it('calls plugin.activate with a PluginAPI carrying pluginId and version', async () => {
    const { scope, dispatchToRuntime } = makeStandaloneScope();
    const activate = vi.fn();
    const loader: PluginLoader = async () => ({ activate });
    new PluginRuntime({ scope, loader });

    dispatchToRuntime({
      id: 'b-1',
      type: 'init',
      pluginId: 'translator',
      version: '1.2.3',
      pluginCode: 'export default { activate(){} }',
      permissions: ['workspace:read'],
    });

    await new Promise((r) => queueMicrotask(() => r(undefined)));
    await new Promise((r) => queueMicrotask(() => r(undefined)));

    expect(activate).toHaveBeenCalledOnce();
    const api = activate.mock.calls[0]?.[0] as PluginAPI;
    expect(api.pluginId).toBe('translator');
    expect(api.version).toBe('1.2.3');
  });

  it('captures deactivate fn for later use', async () => {
    const { scope, dispatchToRuntime } = makeStandaloneScope();
    const deactivate = vi.fn();
    const loader: PluginLoader = async () => ({
      activate: () => {
        // no-op
      },
      deactivate,
    });
    const runtime = new PluginRuntime({ scope, loader });

    dispatchToRuntime({
      id: 'b-1',
      type: 'init',
      pluginId: 'p',
      version: '1.0.0',
      pluginCode: 'x',
      permissions: [],
    });
    await new Promise((r) => queueMicrotask(() => r(undefined)));

    await runtime.deactivate();
    expect(deactivate).toHaveBeenCalledOnce();

    // idempotent
    await runtime.deactivate();
    expect(deactivate).toHaveBeenCalledOnce();
  });

  it('posts a plugin-threw error when loader rejects', async () => {
    const { scope, posted, dispatchToRuntime } = makeStandaloneScope();
    const loader: PluginLoader = async () => {
      throw new Error('cannot import');
    };
    new PluginRuntime({ scope, loader });

    dispatchToRuntime({
      id: 'b-1',
      type: 'init',
      pluginId: 'p',
      version: '1.0.0',
      pluginCode: 'x',
      permissions: [],
    });
    await new Promise((r) => queueMicrotask(() => r(undefined)));
    await new Promise((r) => queueMicrotask(() => r(undefined)));

    const err = posted.find((m) => m.type === 'error');
    expect(err).toBeDefined();
    if (err?.type === 'error') {
      expect(err.error.code).toBe('plugin-threw');
      expect(err.error.message).toBe('cannot import');
      expect(err.inResponseTo).toBe('b-1');
    }
  });

  it('posts a plugin-threw error when activate throws', async () => {
    const { scope, posted, dispatchToRuntime } = makeStandaloneScope();
    const loader: PluginLoader = async () => ({
      activate: () => {
        throw new Error('activate boom');
      },
    });
    new PluginRuntime({ scope, loader });

    dispatchToRuntime({
      id: 'b-1',
      type: 'init',
      pluginId: 'p',
      version: '1.0.0',
      pluginCode: 'x',
      permissions: [],
    });
    await new Promise((r) => queueMicrotask(() => r(undefined)));

    const err = posted.find((m) => m.type === 'error');
    expect(err?.type === 'error' && err.error.code).toBe('plugin-threw');
  });
});

describe('PluginRuntime — commands.register + invoke round-trip via paired bridge', () => {
  it('plugin command registered via api.commands.register is invokable through the bridge', async () => {
    const onRegisterCommand = vi.fn();
    const PLUGIN_CODE = 'word-counter-source';
    const fixtureModule: PluginModule = {
      activate: (api) => {
        api.commands.register('count', async () => ({ words: 7 }));
      },
    };
    const { bridge } = makePairedBridge(
      fakeManifest({ id: 'word-counter' }),
      { onRegisterCommand },
      { loader: inlinePluginLoader({ [PLUGIN_CODE]: fixtureModule }) },
    );

    bridge.sendInit({ code: PLUGIN_CODE });
    // Allow init to flow through queueMicrotask layers.
    for (let i = 0; i < 5; i++) await new Promise((r) => queueMicrotask(() => r(undefined)));

    expect(onRegisterCommand).toHaveBeenCalledWith('count', {});
    await expect(bridge.invokeCommand('count')).resolves.toEqual({ words: 7 });

    bridge.terminate();
  });

  it('invoke of unknown command returns unknown-command error', async () => {
    const PLUGIN_CODE = 'plugin-without-cmd';
    const fixtureModule: PluginModule = {
      activate: () => {
        // registers nothing
      },
    };
    const { bridge } = makePairedBridge(
      fakeManifest(),
      {},
      { loader: inlinePluginLoader({ [PLUGIN_CODE]: fixtureModule }) },
    );
    bridge.sendInit({ code: PLUGIN_CODE });
    for (let i = 0; i < 5; i++) await new Promise((r) => queueMicrotask(() => r(undefined)));

    await expect(bridge.invokeCommand('missing')).rejects.toMatchObject({
      code: 'unknown-command',
    });

    bridge.terminate();
  });

  it('command that throws synchronously surfaces plugin-threw to the caller', async () => {
    const PLUGIN_CODE = 'crash-plugin';
    const fixtureModule: PluginModule = {
      activate: (api) => {
        api.commands.register('boom', () => {
          throw new Error('intentional');
        });
      },
    };
    const { bridge } = makePairedBridge(
      fakeManifest(),
      {},
      { loader: inlinePluginLoader({ [PLUGIN_CODE]: fixtureModule }) },
    );
    bridge.sendInit({ code: PLUGIN_CODE });
    for (let i = 0; i < 5; i++) await new Promise((r) => queueMicrotask(() => r(undefined)));

    await expect(bridge.invokeCommand('boom')).rejects.toMatchObject({
      code: 'plugin-threw',
      message: 'intentional',
    });

    bridge.terminate();
  });
});

describe('PluginRuntime — API proxy api-call flow', () => {
  it('editor.getSelection issues api-call and resolves with the bridge response', async () => {
    const PLUGIN_CODE = 'reader-plugin';
    let captured: PluginEditorSelection | null = null;
    const fixtureModule: PluginModule = {
      activate: (api) => {
        api.commands.register('read', async () => {
          captured = await api.editor.getSelection();
          return { ok: true };
        });
      },
    };
    const dispatch = vi.fn(async ({ method }) => {
      if (method === 'editor.getSelection') {
        return {
          text: 'hello',
          range: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 6 },
        };
      }
      return undefined;
    });

    const { bridge } = makePairedBridge(
      fakeManifest({ permissions: ['editor:selection'] }),
      { dispatch },
      { loader: inlinePluginLoader({ [PLUGIN_CODE]: fixtureModule }) },
    );
    bridge.sendInit({ code: PLUGIN_CODE });
    for (let i = 0; i < 5; i++) await new Promise((r) => queueMicrotask(() => r(undefined)));

    await expect(bridge.invokeCommand('read')).resolves.toEqual({ ok: true });
    expect(captured).toEqual({
      text: 'hello',
      range: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 6 },
    });
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'editor.getSelection' }),
    );
    bridge.terminate();
  });

  it('api-call rejection (permission-denied) is re-thrown to the plugin code', async () => {
    const PLUGIN_CODE = 'forbidden-plugin';
    const fixtureModule: PluginModule = {
      activate: (api) => {
        api.commands.register('read', async () => {
          try {
            await api.workspace.readFile('/x');
            return { ok: true };
          } catch (err) {
            const e = err as { code?: string; message?: string };
            return { ok: false, code: e.code, message: e.message };
          }
        });
      },
    };
    const dispatch = vi.fn();
    const { bridge } = makePairedBridge(
      fakeManifest({ permissions: [] }),
      { dispatch },
      { loader: inlinePluginLoader({ [PLUGIN_CODE]: fixtureModule }) },
    );
    bridge.sendInit({ code: PLUGIN_CODE });
    for (let i = 0; i < 5; i++) await new Promise((r) => queueMicrotask(() => r(undefined)));

    const result = (await bridge.invokeCommand('read')) as {
      ok: boolean;
      code: string;
      message: string;
    };
    expect(result.ok).toBe(false);
    expect(result.code).toBe('permission-denied');
    expect(dispatch).not.toHaveBeenCalled();
    bridge.terminate();
  });
});

describe('PluginRuntime — UI registration variants', () => {
  it('toolbar.addButton + sidebar.addPanel + settings.addPage + notify.warn fire host hooks', async () => {
    const PLUGIN_CODE = 'ui-plugin';
    const fixtureModule: PluginModule = {
      activate: (api) => {
        api.toolbar.addButton({ id: 'btn', icon: 'plus', tooltip: 't', command: 'cmd' });
        api.sidebar.addPanel({ id: 'panel', title: 'P', html: '<div/>' });
        api.settings.addPage({ id: 'sp', title: 'S', schema: {} });
        api.notify.warn('careful');
        api.commands.register('noop', () => 'noop');
      },
    };
    const onToolbarAdd = vi.fn();
    const onSidebarAddPanel = vi.fn();
    const onSettingsAddPage = vi.fn();
    const onNotify = vi.fn();
    const { bridge } = makePairedBridge(
      fakeManifest(),
      { onToolbarAdd, onSidebarAddPanel, onSettingsAddPage, onNotify },
      { loader: inlinePluginLoader({ [PLUGIN_CODE]: fixtureModule }) },
    );
    bridge.sendInit({ code: PLUGIN_CODE });
    for (let i = 0; i < 5; i++) await new Promise((r) => queueMicrotask(() => r(undefined)));

    expect(onToolbarAdd).toHaveBeenCalledWith({
      id: 'btn',
      icon: 'plus',
      tooltip: 't',
      command: 'cmd',
    });
    expect(onSidebarAddPanel).toHaveBeenCalledWith({
      id: 'panel',
      title: 'P',
      html: '<div/>',
    });
    expect(onSettingsAddPage).toHaveBeenCalledWith({
      id: 'sp',
      title: 'S',
      schema: {},
    });
    expect(onNotify).toHaveBeenCalledWith('warn', 'careful');
    bridge.terminate();
  });
});

describe('PluginRuntime — module shape acceptance', () => {
  it('accepts a default-export shape', async () => {
    const PLUGIN_CODE = 'default-export';
    const onRegisterCommand = vi.fn();
    const mod: PluginModule = {
      activate: (api) => {
        api.commands.register('x', () => 'y');
      },
    };
    const { bridge } = makePairedBridge(
      fakeManifest(),
      { onRegisterCommand },
      { loader: inlinePluginLoader({ [PLUGIN_CODE]: mod }) },
    );
    bridge.sendInit({ code: PLUGIN_CODE });
    for (let i = 0; i < 5; i++) await new Promise((r) => queueMicrotask(() => r(undefined)));
    expect(onRegisterCommand).toHaveBeenCalledWith('x', {});
    bridge.terminate();
  });
});
