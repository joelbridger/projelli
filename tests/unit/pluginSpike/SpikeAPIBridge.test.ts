// Plugin Spike — bridge tests.
//
// Web Workers are not available in Vitest's jsdom environment. We instead
// provide a `SpikeWorkerLike` mock that speaks the same JSON message protocol
// the bridge expects. The mock captures every postMessage from the bridge
// and exposes a helper to push messages "from the worker" into the bridge's
// listener. This mirrors the contract a real Worker satisfies.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  SpikeApiCallMessage,
  SpikeApiResultMessage,
  SpikeCommandResultMessage,
  SpikeErrorMessage,
  SpikeMessage,
  SpikePanelRenderMessage,
} from '@/types/pluginSpike';
import { SpikeAPIBridge, type SpikeWorkerLike } from '@/modules/pluginSpike/SpikeAPIBridge';
import { decode, encode } from '@/modules/pluginSpike/SpikeMessageProtocol';

interface MockWorker extends SpikeWorkerLike {
  posted: string[];
  emit(msg: SpikeMessage): void;
  emitError(message: string): void;
  terminated: boolean;
}

function makeMockWorker(): MockWorker {
  const listeners = {
    message: new Set<(event: { data?: unknown }) => void>(),
    error: new Set<(event: { message?: string }) => void>(),
    messageerror: new Set<(event: { data?: unknown }) => void>(),
  };
  const mock: MockWorker = {
    posted: [],
    terminated: false,
    postMessage(data: unknown): void {
      mock.posted.push(String(data));
    },
    terminate(): void {
      mock.terminated = true;
    },
    addEventListener(type, listener): void {
      (listeners[type] as Set<(event: unknown) => void>).add(listener as (event: unknown) => void);
    },
    removeEventListener(type, listener): void {
      (listeners[type] as Set<(event: unknown) => void>).delete(listener as (event: unknown) => void);
    },
    emit(msg: SpikeMessage): void {
      const wire = encode(msg);
      for (const l of listeners.message) l({ data: wire });
    },
    emitError(message: string): void {
      for (const l of listeners.error) l({ message });
    },
  };
  return mock;
}

function lastPosted(mock: MockWorker): SpikeMessage {
  if (mock.posted.length === 0) throw new Error('no messages posted');
  return decode(mock.posted[mock.posted.length - 1]);
}

describe('SpikeAPIBridge', () => {
  let mock: MockWorker;
  let bridge: SpikeAPIBridge;

  beforeEach(() => {
    mock = makeMockWorker();
  });

  afterEach(() => {
    bridge?.terminate();
  });

  describe('sendInit', () => {
    it('posts an init message with plugin code and permissions', () => {
      bridge = new SpikeAPIBridge({
        manifest: { permissions: ['editor:selection'] },
        workerFactory: () => mock,
      });
      bridge.sendInit({ code: 'export const activate = () => {};' });
      const posted = lastPosted(mock);
      expect(posted.type).toBe('init');
      if (posted.type !== 'init') return;
      expect(posted.pluginCode).toContain('activate');
      expect(posted.permissions).toEqual(['editor:selection']);
    });
  });

  describe('invokeCommand', () => {
    it('round-trips a successful result', async () => {
      bridge = new SpikeAPIBridge({
        manifest: { permissions: [] },
        workerFactory: () => mock,
      });
      const promise = bridge.invokeCommand('criterion-2');
      const sent = lastPosted(mock);
      expect(sent.type).toBe('invoke-command');
      if (sent.type !== 'invoke-command') return;
      const reply: SpikeCommandResultMessage = {
        id: 'r-1',
        type: 'command-result',
        inResponseTo: sent.id,
        result: { ok: true },
      };
      mock.emit(reply);
      await expect(promise).resolves.toEqual({ ok: true });
    });

    it('rejects with structured error on error response', async () => {
      bridge = new SpikeAPIBridge({
        manifest: { permissions: [] },
        workerFactory: () => mock,
      });
      const promise = bridge.invokeCommand('criterion-7');
      const sent = lastPosted(mock);
      const reply: SpikeErrorMessage = {
        id: 'r-2',
        type: 'error',
        inResponseTo: sent.id,
        error: { code: 'plugin-threw', message: 'boom' },
      };
      mock.emit(reply);
      await expect(promise).rejects.toMatchObject({ message: 'boom' });
    });

    it('throws if invoked after terminate', () => {
      bridge = new SpikeAPIBridge({
        manifest: { permissions: [] },
        workerFactory: () => mock,
      });
      bridge.terminate();
      expect(() => bridge.invokeCommand('x')).toThrow(/terminated/);
    });
  });

  describe('handleApiCall (permission enforcement)', () => {
    it('allows editor.getSelection when permission granted', async () => {
      bridge = new SpikeAPIBridge({
        manifest: { permissions: ['editor:selection'] },
        workerFactory: () => mock,
        getSelection: () => 'hello',
      });
      const call: SpikeApiCallMessage = {
        id: 'a-1',
        type: 'api-call',
        method: 'editor.getSelection',
        args: [],
      };
      await bridge.handleApiCall(call);
      const reply = lastPosted(mock) as SpikeApiResultMessage;
      expect(reply.type).toBe('api-result');
      expect(reply.inResponseTo).toBe('a-1');
      expect(reply.result).toBe('hello');
    });

    it('denies editor.getSelection when permission missing', async () => {
      bridge = new SpikeAPIBridge({
        manifest: { permissions: [] },
        workerFactory: () => mock,
      });
      const call: SpikeApiCallMessage = {
        id: 'a-2',
        type: 'api-call',
        method: 'editor.getSelection',
        args: [],
      };
      await bridge.handleApiCall(call);
      const reply = lastPosted(mock) as SpikeErrorMessage;
      expect(reply.type).toBe('error');
      expect(reply.error.code).toBe('permission-denied');
      expect(reply.inResponseTo).toBe('a-2');
    });

    it('always denies workspace.readFile regardless of permissions', async () => {
      bridge = new SpikeAPIBridge({
        manifest: { permissions: ['editor:selection'] },
        workerFactory: () => mock,
      });
      const call: SpikeApiCallMessage = {
        id: 'a-3',
        type: 'api-call',
        method: 'workspace.readFile',
        args: ['/etc/passwd'],
      };
      await bridge.handleApiCall(call);
      const reply = lastPosted(mock) as SpikeErrorMessage;
      expect(reply.type).toBe('error');
      expect(reply.error.code).toBe('permission-denied');
    });

    it('routes incoming api-call messages from the worker through enforcement', async () => {
      bridge = new SpikeAPIBridge({
        manifest: { permissions: [] },
        workerFactory: () => mock,
      });
      mock.emit({
        id: 'a-4',
        type: 'api-call',
        method: 'workspace.readFile',
        args: ['/x'],
      });
      // handleApiCall is async; flush microtasks.
      await Promise.resolve();
      await Promise.resolve();
      const reply = decode(mock.posted[mock.posted.length - 1]) as SpikeErrorMessage;
      expect(reply.type).toBe('error');
      expect(reply.error.code).toBe('permission-denied');
    });
  });

  describe('handlePanelRender', () => {
    it('emits a panel-render event to subscribers', () => {
      bridge = new SpikeAPIBridge({
        manifest: { permissions: [] },
        workerFactory: () => mock,
      });
      const listener = vi.fn();
      bridge.onPanelRender(listener);
      const msg: SpikePanelRenderMessage = {
        id: 'p-1',
        type: 'panel-render',
        spec: { id: 'spike-panel', title: 'Spike', html: '<p>hello</p>' },
      };
      mock.emit(msg);
      expect(listener).toHaveBeenCalledWith({ spec: msg.spec });
    });

    it('unsubscribe stops further events', () => {
      bridge = new SpikeAPIBridge({
        manifest: { permissions: [] },
        workerFactory: () => mock,
      });
      const listener = vi.fn();
      const unsub = bridge.onPanelRender(listener);
      unsub();
      mock.emit({
        id: 'p-2',
        type: 'panel-render',
        spec: { id: 'x', title: 'x', html: '' },
      });
      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe('register-command tracking', () => {
    it('records commands and surfaces them via getRegisteredCommands', () => {
      const onRegister = vi.fn();
      bridge = new SpikeAPIBridge({
        manifest: { permissions: [] },
        workerFactory: () => mock,
        onRegisterCommand: onRegister,
      });
      mock.emit({ id: 'rc-1', type: 'register-command', commandId: 'criterion-1' });
      mock.emit({ id: 'rc-2', type: 'register-command', commandId: 'criterion-2' });
      expect(bridge.getRegisteredCommands()).toEqual(['criterion-1', 'criterion-2']);
      expect(onRegister).toHaveBeenCalledTimes(2);
    });
  });

  describe('terminate', () => {
    it('calls worker.terminate and rejects pending invokes with unloaded', async () => {
      bridge = new SpikeAPIBridge({
        manifest: { permissions: [] },
        workerFactory: () => mock,
      });
      const pending = bridge.invokeCommand('criterion-2');
      bridge.terminate();
      expect(mock.terminated).toBe(true);
      await expect(pending).rejects.toMatchObject({ message: /unloaded/ });
      expect(bridge.isTerminated()).toBe(true);
    });

    it('is idempotent', () => {
      bridge = new SpikeAPIBridge({
        manifest: { permissions: [] },
        workerFactory: () => mock,
      });
      bridge.terminate();
      expect(() => bridge.terminate()).not.toThrow();
    });
  });

  describe('worker error handling', () => {
    it('rejects pending invokes when the worker emits an error event', async () => {
      bridge = new SpikeAPIBridge({
        manifest: { permissions: [] },
        workerFactory: () => mock,
      });
      const pending = bridge.invokeCommand('criterion-7');
      mock.emitError('worker exploded');
      await expect(pending).rejects.toMatchObject({ message: 'worker exploded' });
    });
  });
});
