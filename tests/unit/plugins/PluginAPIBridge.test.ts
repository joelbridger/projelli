// Tests for PluginAPIBridge.
//
// Coverage:
//  - sendInit posts the canonical init message with the manifest's permissions
//  - invokeCommand round-trips command-result back to the caller
//  - api-call dispatch via hooks.dispatch on permission grant
//  - api-call permission denial when permission missing, with onPermissionDenied
//  - api-call returns 'not-found' when no dispatcher is registered
//  - api-call internal error when dispatcher throws
//  - UI registration variants (toolbar/sidebar/settings/notify) fire hooks
//    directly without permission gating
//  - register-command emits onRegisterCommand and tracks the id
//  - terminate cancels pending invokes with `unloaded` and is idempotent
//  - second sendInit post-terminate throws

import { describe, it, expect, vi } from 'vitest';

import {
  PluginAPIBridge,
  type PluginBridgeHooks,
  type PluginWorkerLike,
} from '@/modules/plugins/PluginAPIBridge';
import { decode, encode, type PluginMessage } from '@/modules/plugins/PluginMessageProtocol';
import {
  fakeManifest,
  inlinePluginLoader,
  makePairedBridge,
} from '../../helpers/pluginMockFactory';

/** Build a stand-alone mock worker so we can drive bridge messages directly. */
function makeStandaloneWorker(): {
  worker: PluginWorkerLike;
  posted: PluginMessage[];
  dispatchToBridge: (msg: PluginMessage) => void;
  fireError: (msg: string) => void;
} {
  const posted: PluginMessage[] = [];
  let messageListener: ((event: { data?: unknown }) => void) | null = null;
  let errorListener: ((event: { message?: string }) => void) | null = null;

  const worker: PluginWorkerLike = {
    postMessage(data) {
      try {
        posted.push(decode(data));
      } catch {
        // Skip malformed (shouldn't happen in tests)
      }
    },
    terminate() {
      // no-op for the tests that don't care; cancellation tests use real terminate().
    },
    addEventListener(type, listener) {
      if (type === 'message') messageListener = listener as (event: { data?: unknown }) => void;
      if (type === 'error' || type === 'messageerror') {
        errorListener = listener as (event: { message?: string }) => void;
      }
    },
    removeEventListener(type) {
      if (type === 'message') messageListener = null;
      if (type === 'error' || type === 'messageerror') errorListener = null;
    },
  };

  return {
    worker,
    posted,
    dispatchToBridge(msg) {
      messageListener?.({ data: encode(msg) });
    },
    fireError(message) {
      errorListener?.({ message });
    },
  };
}

describe('PluginAPIBridge.sendInit', () => {
  it('posts an init message carrying pluginId, version, code, and granted permissions', () => {
    const { worker, posted } = makeStandaloneWorker();
    const manifest = fakeManifest({
      id: 'translator',
      version: '1.2.3',
      permissions: ['workspace:read', 'ai:invoke'],
    });

    const bridge = new PluginAPIBridge(manifest, {}, () => worker);
    bridge.sendInit({ code: 'export default { activate(){} }' });

    expect(posted).toHaveLength(1);
    const init = posted[0];
    expect(init?.type).toBe('init');
    if (init?.type === 'init') {
      expect(init.pluginId).toBe('translator');
      expect(init.version).toBe('1.2.3');
      expect(init.permissions).toEqual(['workspace:read', 'ai:invoke']);
      expect(init.pluginCode).toContain('activate');
    }
  });
});

describe('PluginAPIBridge.invokeCommand', () => {
  it('resolves with command-result payload when worker responds', async () => {
    const { worker, posted, dispatchToBridge } = makeStandaloneWorker();
    const manifest = fakeManifest({ permissions: [] });
    const bridge = new PluginAPIBridge(manifest, {}, () => worker);

    const promise = bridge.invokeCommand('say.hello', { who: 'world' });
    expect(posted).toHaveLength(1);
    const invoke = posted[0];
    expect(invoke?.type).toBe('invoke-command');
    if (invoke?.type !== 'invoke-command') return;

    dispatchToBridge({
      id: 'r-1',
      type: 'command-result',
      inResponseTo: invoke.id,
      result: { greeting: 'hello world' },
    });

    await expect(promise).resolves.toEqual({ greeting: 'hello world' });
  });

  it('rejects with structured error when worker posts an error response', async () => {
    const { worker, posted, dispatchToBridge } = makeStandaloneWorker();
    const bridge = new PluginAPIBridge(fakeManifest(), {}, () => worker);

    const promise = bridge.invokeCommand('boom');
    const invoke = posted[0];
    if (invoke?.type !== 'invoke-command') throw new Error('expected invoke-command');

    dispatchToBridge({
      id: 'r-2',
      type: 'error',
      inResponseTo: invoke.id,
      error: { code: 'plugin-threw', message: 'kaboom' },
    });

    await expect(promise).rejects.toMatchObject({ message: 'kaboom' });
  });

  it('rejects pending invokes with unloaded code when worker errors out', async () => {
    const { worker, fireError } = makeStandaloneWorker();
    const bridge = new PluginAPIBridge(fakeManifest(), {}, () => worker);

    const promise = bridge.invokeCommand('whatever');
    fireError('worker died');

    await expect(promise).rejects.toMatchObject({ code: 'plugin-threw', message: 'worker died' });
  });
});

describe('PluginAPIBridge.handleApiCall — permission gating', () => {
  it('denies a gated method when permission is missing and fires onPermissionDenied', async () => {
    const { worker, posted } = makeStandaloneWorker();
    const onPermissionDenied = vi.fn();
    const dispatch = vi.fn();
    const hooks: PluginBridgeHooks = {
      onPermissionDenied,
      dispatch,
    };
    const bridge = new PluginAPIBridge(fakeManifest({ permissions: [] }), hooks, () => worker);

    await bridge.handleApiCall({
      id: 'b-call-1',
      type: 'api-call',
      method: 'workspace.readFile',
      args: ['/secret.txt'],
    });

    expect(dispatch).not.toHaveBeenCalled();
    expect(onPermissionDenied).toHaveBeenCalledWith({
      permission: 'workspace:read',
      method: 'workspace.readFile',
    });
    const errMsg = posted.find((m) => m.type === 'error');
    expect(errMsg).toBeDefined();
    if (errMsg?.type === 'error') {
      expect(errMsg.error.code).toBe('permission-denied');
      expect(errMsg.inResponseTo).toBe('b-call-1');
    }
  });

  it('grants and dispatches when permission is present', async () => {
    const { worker, posted } = makeStandaloneWorker();
    const dispatch = vi.fn(async () => 'file contents');
    const bridge = new PluginAPIBridge(
      fakeManifest({ permissions: ['workspace:read'] }),
      { dispatch },
      () => worker,
    );

    await bridge.handleApiCall({
      id: 'b-2',
      type: 'api-call',
      method: 'workspace.readFile',
      args: ['/notes.md'],
    });

    expect(dispatch).toHaveBeenCalledWith({
      pluginId: expect.any(String),
      method: 'workspace.readFile',
      args: ['/notes.md'],
    });
    const result = posted.find((m) => m.type === 'api-result');
    expect(result).toBeDefined();
    if (result?.type === 'api-result') {
      expect(result.inResponseTo).toBe('b-2');
      expect(result.result).toBe('file contents');
    }
  });

  it('allows ungated methods (storage.set) without consulting permissions', async () => {
    const { worker, posted } = makeStandaloneWorker();
    const dispatch = vi.fn(async () => undefined);
    const bridge = new PluginAPIBridge(
      fakeManifest({ permissions: [] }),
      { dispatch },
      () => worker,
    );

    await bridge.handleApiCall({
      id: 'b-3',
      type: 'api-call',
      method: 'storage.set',
      args: ['lastRun', 42],
    });

    expect(dispatch).toHaveBeenCalledOnce();
    expect(posted.some((m) => m.type === 'api-result')).toBe(true);
  });

  it('replies with not-found code when no dispatcher is registered', async () => {
    const { worker, posted } = makeStandaloneWorker();
    const bridge = new PluginAPIBridge(
      fakeManifest({ permissions: [] }),
      {},
      () => worker,
    );

    await bridge.handleApiCall({
      id: 'b-4',
      type: 'api-call',
      method: 'storage.get',
      args: ['x'],
    });

    const errMsg = posted.find((m) => m.type === 'error');
    expect(errMsg).toBeDefined();
    if (errMsg?.type === 'error') {
      expect(errMsg.error.code).toBe('not-found');
    }
  });

  it('reports internal error code when dispatcher throws a non-coded error', async () => {
    const { worker, posted } = makeStandaloneWorker();
    const dispatch = vi.fn(async () => {
      throw new Error('database is down');
    });
    const bridge = new PluginAPIBridge(
      fakeManifest({ permissions: [] }),
      { dispatch },
      () => worker,
    );

    await bridge.handleApiCall({
      id: 'b-5',
      type: 'api-call',
      method: 'storage.get',
      args: ['k'],
    });

    const errMsg = posted.find((m) => m.type === 'error');
    expect(errMsg).toBeDefined();
    if (errMsg?.type === 'error') {
      expect(errMsg.error.code).toBe('internal');
      expect(errMsg.error.message).toBe('database is down');
    }
  });

  it('preserves dispatcher-supplied code on thrown errors (e.g. invalid-args)', async () => {
    const { worker, posted } = makeStandaloneWorker();
    const dispatch = vi.fn(async () => {
      throw Object.assign(new Error('bad path'), { code: 'invalid-args' });
    });
    const bridge = new PluginAPIBridge(
      fakeManifest({ permissions: ['workspace:read'] }),
      { dispatch },
      () => worker,
    );

    await bridge.handleApiCall({
      id: 'b-6',
      type: 'api-call',
      method: 'workspace.readFile',
      args: ['../escape'],
    });

    const errMsg = posted.find((m) => m.type === 'error');
    expect(errMsg?.type === 'error' && errMsg.error.code).toBe('invalid-args');
  });
});

describe('PluginAPIBridge UI-registration variants — direct hooks, no gating', () => {
  it('routes toolbar-add to onToolbarAdd without permission check', () => {
    const { worker, dispatchToBridge } = makeStandaloneWorker();
    const onToolbarAdd = vi.fn();
    const bridge = new PluginAPIBridge(
      fakeManifest({ permissions: [] }),
      { onToolbarAdd },
      () => worker,
    );

    dispatchToBridge({
      id: 'r-1',
      type: 'toolbar-add',
      spec: { id: 'btn', icon: 'plus', tooltip: 'Add', command: 'cmd' },
    });

    expect(onToolbarAdd).toHaveBeenCalledWith({
      id: 'btn',
      icon: 'plus',
      tooltip: 'Add',
      command: 'cmd',
    });
    expect(bridge.isTerminated()).toBe(false);
  });

  it('routes sidebar-add-panel + sidebar-remove-panel + settings-add-page + notify to their hooks', () => {
    const { worker, dispatchToBridge } = makeStandaloneWorker();
    const onSidebarAddPanel = vi.fn();
    const onSidebarRemovePanel = vi.fn();
    const onSettingsAddPage = vi.fn();
    const onNotify = vi.fn();
    const onToolbarRemove = vi.fn();
    const bridge = new PluginAPIBridge(
      fakeManifest({ permissions: [] }),
      {
        onSidebarAddPanel,
        onSidebarRemovePanel,
        onSettingsAddPage,
        onNotify,
        onToolbarRemove,
      },
      () => worker,
    );

    dispatchToBridge({
      id: 'r-1',
      type: 'sidebar-add-panel',
      spec: { id: 'p', title: 'Panel' },
    });
    dispatchToBridge({ id: 'r-2', type: 'sidebar-remove-panel', panelId: 'p' });
    dispatchToBridge({
      id: 'r-3',
      type: 'settings-add-page',
      spec: { id: 's', title: 'Settings', schema: {} },
    });
    dispatchToBridge({ id: 'r-4', type: 'notify', level: 'warn', message: 'hey' });
    dispatchToBridge({ id: 'r-5', type: 'toolbar-remove', buttonId: 'btn' });

    expect(onSidebarAddPanel).toHaveBeenCalledWith({ id: 'p', title: 'Panel' });
    expect(onSidebarRemovePanel).toHaveBeenCalledWith('p');
    expect(onSettingsAddPage).toHaveBeenCalledWith({ id: 's', title: 'Settings', schema: {} });
    expect(onNotify).toHaveBeenCalledWith('warn', 'hey');
    expect(onToolbarRemove).toHaveBeenCalledWith('btn');
    expect(bridge.isTerminated()).toBe(false);
  });

  it('records register-command and surfaces optional title/category via hook', () => {
    const { worker, dispatchToBridge } = makeStandaloneWorker();
    const onRegisterCommand = vi.fn();
    const bridge = new PluginAPIBridge(
      fakeManifest({ permissions: [] }),
      { onRegisterCommand },
      () => worker,
    );

    dispatchToBridge({
      id: 'r-1',
      type: 'register-command',
      commandId: 'word-counter.count',
      title: 'Count words',
      category: 'Editing',
    });

    expect(onRegisterCommand).toHaveBeenCalledWith('word-counter.count', {
      title: 'Count words',
      category: 'Editing',
    });
    expect(bridge.getRegisteredCommands()).toEqual(['word-counter.count']);
  });

  it('absorbs hook errors silently so a buggy hook cannot crash the bridge', () => {
    const { worker, dispatchToBridge } = makeStandaloneWorker();
    const onNotify = vi.fn(() => {
      throw new Error('listener exploded');
    });
    const bridge = new PluginAPIBridge(
      fakeManifest({ permissions: [] }),
      { onNotify },
      () => worker,
    );

    expect(() => {
      dispatchToBridge({ id: 'r-1', type: 'notify', level: 'info', message: 'x' });
    }).not.toThrow();
    expect(bridge.isTerminated()).toBe(false);
  });
});

describe('PluginAPIBridge.terminate', () => {
  it('cancels pending invokes with unloaded rejection and fires onUnload', async () => {
    const { worker } = makeStandaloneWorker();
    const onUnload = vi.fn();
    const bridge = new PluginAPIBridge(fakeManifest(), { onUnload }, () => worker);

    const pending = bridge.invokeCommand('forever');
    bridge.terminate();

    await expect(pending).rejects.toMatchObject({ code: 'unloaded' });
    expect(onUnload).toHaveBeenCalledOnce();
    expect(bridge.isTerminated()).toBe(true);
  });

  it('is idempotent: second terminate is a no-op and does not refire onUnload', () => {
    const { worker } = makeStandaloneWorker();
    const onUnload = vi.fn();
    const bridge = new PluginAPIBridge(fakeManifest(), { onUnload }, () => worker);
    bridge.terminate();
    bridge.terminate();
    expect(onUnload).toHaveBeenCalledOnce();
  });

  it('sendInit and invokeCommand throw on a terminated bridge', () => {
    const { worker } = makeStandaloneWorker();
    const bridge = new PluginAPIBridge(fakeManifest(), {}, () => worker);
    bridge.terminate();
    expect(() => bridge.sendInit({ code: '' })).toThrow(/terminated/);
    expect(() => bridge.invokeCommand('any')).toThrow(/terminated/);
  });

  it('hot reload pattern: terminate + recreate yields a fresh, working bridge', async () => {
    const manifest = fakeManifest({ permissions: [] });
    const dispatch = vi.fn(async () => 'ok');

    const first = makePairedBridge(manifest, { dispatch }, {
      loader: inlinePluginLoader({
        'export default { activate(){} }': {
          activate: () => {
            // no-op
          },
        },
      }),
    });
    first.bridge.sendInit({ code: 'export default { activate(){} }' });
    first.bridge.terminate();
    expect(first.bridge.isTerminated()).toBe(true);

    const second = makePairedBridge(manifest, { dispatch }, {
      loader: inlinePluginLoader({
        'export default { activate(){} }': {
          activate: () => {
            // no-op
          },
        },
      }),
    });
    second.bridge.sendInit({ code: 'export default { activate(){} }' });
    expect(second.bridge.isTerminated()).toBe(false);
    second.bridge.terminate();
  });
});
