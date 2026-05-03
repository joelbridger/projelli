// Plugin Spike — runtime tests.
//
// Drives the worker-side runtime against a mock worker scope. We supply a
// custom loader so the spike doesn't depend on Blob URL + dynamic import in
// jsdom (which is unreliable). The loader returns a SpikePluginModule object
// directly, mirroring what `await import(blobUrl)` would yield in production.

import { describe, expect, it, vi } from 'vitest';

import type {
  SpikeAPI,
  SpikeApiCallMessage,
  SpikeApiResultMessage,
  SpikeCommandResultMessage,
  SpikeErrorMessage,
  SpikeInitMessage,
  SpikeMessage,
  SpikeNotifyMessage,
  SpikePanelRenderMessage,
  SpikeRegisterCommandMessage,
} from '@/types/pluginSpike';
import {
  SpikePluginRuntime,
  type SpikePluginModule,
  type SpikeWorkerScope,
} from '@/modules/pluginSpike/SpikePluginRuntime';
import { decode, encode } from '@/modules/pluginSpike/SpikeMessageProtocol';

interface MockScope extends SpikeWorkerScope {
  posted: SpikeMessage[];
  emit(msg: SpikeMessage): void;
}

function makeMockScope(): MockScope {
  const listeners = new Set<(event: { data?: unknown }) => void>();
  const mock: MockScope = {
    posted: [],
    postMessage(data: unknown): void {
      mock.posted.push(decode(data));
    },
    addEventListener(_type, listener): void {
      listeners.add(listener);
    },
    emit(msg: SpikeMessage): void {
      const wire = encode(msg);
      for (const l of listeners) l({ data: wire });
    },
  };
  return mock;
}

function makeInit(code: string, permissions: SpikeInitMessage['permissions'] = []): SpikeInitMessage {
  return { id: 'init-1', type: 'init', pluginCode: code, permissions };
}

async function flushMicrotasks(times = 5): Promise<void> {
  for (let i = 0; i < times; i++) await Promise.resolve();
}

describe('SpikePluginRuntime', () => {
  it('activates the plugin and posts register-command for each command registered', async () => {
    const scope = makeMockScope();
    const activate = vi.fn((api: SpikeAPI) => {
      api.commands.register('criterion-1', () => 'one');
      api.commands.register('criterion-2', () => 'two');
    });
    const loader = async (): Promise<SpikePluginModule> => ({ activate });
    new SpikePluginRuntime({ scope, loader });
    scope.emit(makeInit('ignored'));
    await flushMicrotasks();
    expect(activate).toHaveBeenCalledTimes(1);
    const registered = scope.posted.filter((m) => m.type === 'register-command') as SpikeRegisterCommandMessage[];
    expect(registered.map((m) => m.commandId)).toEqual(['criterion-1', 'criterion-2']);
  });

  it('round-trips a successful command invocation', async () => {
    const scope = makeMockScope();
    const loader = async (): Promise<SpikePluginModule> => ({
      activate: (api) => {
        api.commands.register('greet', (payload) => `hello ${(payload as { name: string }).name}`);
      },
    });
    new SpikePluginRuntime({ scope, loader });
    scope.emit(makeInit(''));
    await flushMicrotasks();
    scope.emit({
      id: 'inv-1',
      type: 'invoke-command',
      commandId: 'greet',
      payload: { name: 'world' },
    });
    await flushMicrotasks();
    const result = scope.posted.find((m) => m.type === 'command-result') as SpikeCommandResultMessage | undefined;
    expect(result).toBeDefined();
    expect(result?.inResponseTo).toBe('inv-1');
    expect(result?.result).toBe('hello world');
  });

  it('posts a structured error when the command throws', async () => {
    const scope = makeMockScope();
    const loader = async (): Promise<SpikePluginModule> => ({
      activate: (api) => {
        api.commands.register('boom', () => {
          throw new Error('synchronous boom');
        });
      },
    });
    new SpikePluginRuntime({ scope, loader });
    scope.emit(makeInit(''));
    await flushMicrotasks();
    scope.emit({ id: 'inv-2', type: 'invoke-command', commandId: 'boom' });
    await flushMicrotasks();
    const err = scope.posted.find((m) => m.type === 'error') as SpikeErrorMessage | undefined;
    expect(err?.error.code).toBe('plugin-threw');
    expect(err?.error.message).toBe('synchronous boom');
    expect(err?.inResponseTo).toBe('inv-2');
  });

  it('posts unknown-command error if no handler exists', async () => {
    const scope = makeMockScope();
    const loader = async (): Promise<SpikePluginModule> => ({ activate: () => undefined });
    new SpikePluginRuntime({ scope, loader });
    scope.emit(makeInit(''));
    await flushMicrotasks();
    scope.emit({ id: 'inv-3', type: 'invoke-command', commandId: 'missing' });
    await flushMicrotasks();
    const err = scope.posted.find((m) => m.type === 'error') as SpikeErrorMessage | undefined;
    expect(err?.error.code).toBe('unknown-command');
  });

  it('posts plugin-threw if activate fails', async () => {
    const scope = makeMockScope();
    const loader = async (): Promise<SpikePluginModule> => {
      throw new Error('load failed');
    };
    new SpikePluginRuntime({ scope, loader });
    scope.emit(makeInit('whatever'));
    await flushMicrotasks();
    const err = scope.posted.find((m) => m.type === 'error') as SpikeErrorMessage | undefined;
    expect(err?.error.code).toBe('plugin-threw');
    expect(err?.error.message).toBe('load failed');
  });

  it('marshals editor.getSelection through api-call and resolves on api-result', async () => {
    const scope = makeMockScope();
    let captured: string | null = null;
    const loader = async (): Promise<SpikePluginModule> => ({
      activate: (api) => {
        api.commands.register('read-selection', async () => {
          captured = await api.editor.getSelection();
          return captured;
        });
      },
    });
    new SpikePluginRuntime({ scope, loader });
    scope.emit(makeInit('', ['editor:selection']));
    await flushMicrotasks();
    scope.emit({ id: 'inv-4', type: 'invoke-command', commandId: 'read-selection' });
    await flushMicrotasks();
    const apiCall = scope.posted.find((m) => m.type === 'api-call') as SpikeApiCallMessage | undefined;
    expect(apiCall?.method).toBe('editor.getSelection');
    // Simulate bridge replying.
    const reply: SpikeApiResultMessage = {
      id: 'r-1',
      type: 'api-result',
      inResponseTo: apiCall!.id,
      result: 'selected text',
    };
    scope.emit(reply);
    await flushMicrotasks();
    expect(captured).toBe('selected text');
    const cmdResult = scope.posted.find((m) => m.type === 'command-result') as SpikeCommandResultMessage | undefined;
    expect(cmdResult?.result).toBe('selected text');
  });

  it('rejects api-call promise when bridge sends an error', async () => {
    const scope = makeMockScope();
    let caughtCode: string | null = null;
    const loader = async (): Promise<SpikePluginModule> => ({
      activate: (api) => {
        api.commands.register('try-fs', async () => {
          try {
            await api.workspace.readFile('/x');
            return 'ok';
          } catch (err) {
            caughtCode = (err as { code?: string }).code ?? 'no-code';
            return { rejected: true, code: caughtCode };
          }
        });
      },
    });
    new SpikePluginRuntime({ scope, loader });
    scope.emit(makeInit(''));
    await flushMicrotasks();
    scope.emit({ id: 'inv-5', type: 'invoke-command', commandId: 'try-fs' });
    await flushMicrotasks();
    const apiCall = scope.posted.find((m) => m.type === 'api-call') as SpikeApiCallMessage | undefined;
    expect(apiCall?.method).toBe('workspace.readFile');
    scope.emit({
      id: 'e-1',
      type: 'error',
      inResponseTo: apiCall!.id,
      error: { code: 'permission-denied', message: 'no fs in spike' },
    });
    await flushMicrotasks();
    expect(caughtCode).toBe('permission-denied');
    const cmdResult = scope.posted.find((m) => m.type === 'command-result') as SpikeCommandResultMessage | undefined;
    expect(cmdResult?.result).toEqual({ rejected: true, code: 'permission-denied' });
  });

  it('posts a notify message via api.notify.info', async () => {
    const scope = makeMockScope();
    const loader = async (): Promise<SpikePluginModule> => ({
      activate: async (api) => {
        await api.notify.info('hello');
      },
    });
    new SpikePluginRuntime({ scope, loader });
    scope.emit(makeInit(''));
    await flushMicrotasks();
    const notify = scope.posted.find((m) => m.type === 'notify') as SpikeNotifyMessage | undefined;
    expect(notify?.message).toBe('hello');
  });

  it('posts a panel-render message via api.sidebar.addPanel', async () => {
    const scope = makeMockScope();
    const loader = async (): Promise<SpikePluginModule> => ({
      activate: async (api) => {
        await api.sidebar.addPanel({ id: 'p1', title: 'P1', html: '<p>hi</p>' });
      },
    });
    new SpikePluginRuntime({ scope, loader });
    scope.emit(makeInit(''));
    await flushMicrotasks();
    const panel = scope.posted.find((m) => m.type === 'panel-render') as SpikePanelRenderMessage | undefined;
    expect(panel?.spec.id).toBe('p1');
    expect(panel?.spec.html).toBe('<p>hi</p>');
  });
});
