// Plugin Spike — main-thread bridge.
//
// Spawns a single web worker, hands a plugin script to the runtime via an
// `init` message, and routes messages between main and worker. Enforces the
// single spike permission `editor:selection` at API-call time. The bridge
// also unconditionally denies `workspace.readFile` to satisfy criterion #3
// of the spike (filesystem access denied regardless of declared permissions).
//
// Spec: docs/superpowers/specs/2026-04-28-v2.0-mega-release-design.md §6.3
// Plan: docs/superpowers/plans/2026-05-03-stream-c2-plugin-spike.md

import type {
  SpikeAPIMethod,
  SpikeApiCallMessage,
  SpikeCommandResultMessage,
  SpikeError,
  SpikeErrorMessage,
  SpikeMessage,
  SpikePanelRenderMessage,
  SpikePermission,
} from '@/types/pluginSpike';

import { decode, encode } from './SpikeMessageProtocol';

/**
 * Subset of the Worker DOM interface the bridge actually needs. Defined here
 * so tests can supply a minimal mock without pulling in the global Worker
 * constructor (web workers do not run reliably in jsdom).
 */
export interface SpikeWorkerLike {
  postMessage(data: unknown): void;
  terminate(): void;
  addEventListener(
    type: 'message' | 'error' | 'messageerror',
    listener: (event: { data?: unknown; message?: string }) => void,
  ): void;
  removeEventListener?(
    type: 'message' | 'error' | 'messageerror',
    listener: (event: { data?: unknown; message?: string }) => void,
  ): void;
}

/** Factory used to construct the worker. Lets tests inject a mock. */
export type SpikeWorkerFactory = () => SpikeWorkerLike;

export interface SpikeBridgeManifest {
  permissions: SpikePermission[];
}

export interface SpikeBridgeOptions {
  manifest: SpikeBridgeManifest;
  /**
   * Factory for the worker. In production / dev this returns a real Worker.
   * In tests this returns a mock that speaks the same message protocol.
   */
  workerFactory: SpikeWorkerFactory;
  /**
   * Optional override for `editor.getSelection`. Defaults to a fixed string,
   * matching the spike contract.
   */
  getSelection?: () => string;
  /** Optional callback fired whenever a worker-side error surfaces. */
  onError?: (error: SpikeError, inResponseTo?: string) => void;
  /** Optional callback fired when the worker emits a notify message. */
  onNotify?: (message: string) => void;
  /** Optional callback fired when the worker registers a command. */
  onRegisterCommand?: (commandId: string) => void;
}

export interface SpikePanelRenderEvent {
  spec: SpikePanelRenderMessage['spec'];
}

type PendingResolver = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

const SPIKE_GET_SELECTION_DEFAULT = 'selected text';

export class SpikeAPIBridge {
  private readonly worker: SpikeWorkerLike;
  private readonly manifest: SpikeBridgeManifest;
  private readonly getSelectionImpl: () => string;
  private readonly onErrorCb: ((error: SpikeError, inResponseTo?: string) => void) | undefined;
  private readonly onNotifyCb: ((message: string) => void) | undefined;
  private readonly onRegisterCommandCb: ((commandId: string) => void) | undefined;

  /** Outstanding `invoke-command` calls awaiting `command-result` or `error`. */
  private readonly pendingInvokes = new Map<string, PendingResolver>();
  /** Registered command ids reported by the worker. */
  private readonly registeredCommands = new Set<string>();
  /** Subscribers to panel-render events. */
  private readonly panelRenderListeners = new Set<(event: SpikePanelRenderEvent) => void>();

  private nextId = 1;
  private terminated = false;

  constructor(options: SpikeBridgeOptions) {
    this.manifest = options.manifest;
    this.getSelectionImpl = options.getSelection ?? (() => SPIKE_GET_SELECTION_DEFAULT);
    this.onErrorCb = options.onError;
    this.onNotifyCb = options.onNotify;
    this.onRegisterCommandCb = options.onRegisterCommand;
    this.worker = options.workerFactory();
    this.worker.addEventListener('message', this.handleWorkerMessage);
    this.worker.addEventListener('error', this.handleWorkerError);
    this.worker.addEventListener('messageerror', this.handleWorkerError);
  }

  /** Subscribe to panel-render events. Returns an unsubscribe function. */
  onPanelRender(listener: (event: SpikePanelRenderEvent) => void): () => void {
    this.panelRenderListeners.add(listener);
    return () => {
      this.panelRenderListeners.delete(listener);
    };
  }

  /** Returns commands the worker has registered so far. */
  getRegisteredCommands(): string[] {
    return Array.from(this.registeredCommands);
  }

  /**
   * Hand the plugin source to the worker. Returns immediately. The worker is
   * expected to dynamic-import via blob URL inside its runtime; the bridge
   * does not need to wait for a confirmation in the spike.
   */
  sendInit(plugin: { code: string }): void {
    this.assertAlive();
    const msg: SpikeMessage = {
      id: this.allocId(),
      type: 'init',
      pluginCode: plugin.code,
      permissions: this.manifest.permissions,
    };
    this.worker.postMessage(encode(msg));
  }

  /**
   * Invoke a plugin-registered command by id. Resolves with the command's
   * return value or rejects with a structured error.
   */
  invokeCommand(commandId: string, payload?: unknown): Promise<unknown> {
    this.assertAlive();
    return new Promise<unknown>((resolve, reject) => {
      const id = this.allocId();
      this.pendingInvokes.set(id, { resolve, reject });
      const msg: SpikeMessage = {
        id,
        type: 'invoke-command',
        commandId,
        payload,
      };
      try {
        this.worker.postMessage(encode(msg));
      } catch (err) {
        this.pendingInvokes.delete(id);
        reject(err as Error);
      }
    });
  }

  /**
   * Terminate the worker, cancel all pending calls with an `unloaded` error,
   * and stop emitting events. Safe to call repeatedly.
   */
  terminate(): void {
    if (this.terminated) return;
    this.terminated = true;
    this.worker.removeEventListener?.('message', this.handleWorkerMessage);
    this.worker.removeEventListener?.('error', this.handleWorkerError);
    this.worker.removeEventListener?.('messageerror', this.handleWorkerError);
    try {
      this.worker.terminate();
    } catch {
      // terminate is best-effort; mock workers may not implement it.
    }
    const unloadedError = new Error('plugin worker unloaded');
    (unloadedError as Error & { code?: string }).code = 'unloaded';
    for (const [, pending] of this.pendingInvokes) {
      pending.reject(unloadedError);
    }
    this.pendingInvokes.clear();
    this.panelRenderListeners.clear();
  }

  /** Whether the bridge has been terminated. */
  isTerminated(): boolean {
    return this.terminated;
  }

  // ----- Internals ---------------------------------------------------------

  private allocId(): string {
    const id = `b-${this.nextId}`;
    this.nextId += 1;
    return id;
  }

  private assertAlive(): void {
    if (this.terminated) {
      throw new Error('SpikeAPIBridge: cannot use a terminated bridge');
    }
  }

  private readonly handleWorkerMessage = (event: { data?: unknown }): void => {
    if (this.terminated) return;
    let msg: SpikeMessage;
    try {
      msg = decode(event.data);
    } catch {
      // Drop malformed messages. The runtime is expected to encode through
      // SpikeMessageProtocol; anything else is a bug, not a security issue
      // for the spike.
      return;
    }
    switch (msg.type) {
      case 'register-command':
        this.registeredCommands.add(msg.commandId);
        this.onRegisterCommandCb?.(msg.commandId);
        return;
      case 'command-result':
        this.resolveInvoke(msg);
        return;
      case 'api-call':
        void this.handleApiCall(msg);
        return;
      case 'panel-render':
        this.handlePanelRender(msg);
        return;
      case 'notify':
        this.onNotifyCb?.(msg.message);
        return;
      case 'error':
        this.handleError(msg);
        return;
      default:
        // Variants only ever sent main->worker; ignore.
        return;
    }
  };

  private readonly handleWorkerError = (event: { message?: string }): void => {
    if (this.terminated) return;
    const error: SpikeError = {
      code: 'plugin-threw',
      message: event.message ?? 'worker error',
    };
    this.onErrorCb?.(error);
    // Worker-level errors don't carry an inResponseTo; any pending call must
    // not hang forever. Reject all of them and let the caller decide whether
    // to terminate.
    for (const [, pending] of this.pendingInvokes) {
      pending.reject(Object.assign(new Error(error.message), { code: error.code }));
    }
    this.pendingInvokes.clear();
  };

  private resolveInvoke(msg: SpikeCommandResultMessage): void {
    const pending = this.pendingInvokes.get(msg.inResponseTo);
    if (!pending) return;
    this.pendingInvokes.delete(msg.inResponseTo);
    pending.resolve(msg.result);
  }

  private handleError(msg: SpikeErrorMessage): void {
    this.onErrorCb?.(msg.error, msg.inResponseTo);
    if (msg.inResponseTo) {
      const pending = this.pendingInvokes.get(msg.inResponseTo);
      if (pending) {
        this.pendingInvokes.delete(msg.inResponseTo);
        pending.reject(
          Object.assign(new Error(msg.error.message), {
            code: msg.error.code,
            stack: msg.error.stack,
          }),
        );
      }
    }
  }

  private handlePanelRender(msg: SpikePanelRenderMessage): void {
    for (const listener of this.panelRenderListeners) {
      try {
        listener({ spec: msg.spec });
      } catch {
        // Listener errors must not break the bridge.
      }
    }
  }

  /**
   * Handle an `api-call` from the worker. Enforces permissions and posts an
   * `api-result` or `error` back. Public for tests; production callers go
   * through the message handler.
   */
  async handleApiCall(msg: SpikeApiCallMessage): Promise<void> {
    if (this.terminated) return;
    const denial = this.checkPermission(msg.method);
    if (denial) {
      this.postError(msg.id, denial);
      return;
    }
    try {
      const result = await this.executeApiMethod(msg.method, msg.args);
      const response: SpikeMessage = {
        id: this.allocId(),
        type: 'api-result',
        inResponseTo: msg.id,
        result,
      };
      this.worker.postMessage(encode(response));
    } catch (err) {
      this.postError(msg.id, {
        code: 'internal',
        message: (err as Error).message ?? 'internal error',
      });
    }
  }

  private checkPermission(method: SpikeAPIMethod): SpikeError | null {
    // Filesystem access is unconditionally denied for the spike. Production
    // C3 will respect the manifest; here we hard-deny so criterion #3 has a
    // deterministic signal.
    if (method === 'workspace.readFile') {
      return {
        code: 'permission-denied',
        message: 'workspace.readFile is denied for the spike',
      };
    }
    if (method === 'editor.getSelection') {
      if (!this.manifest.permissions.includes('editor:selection')) {
        return {
          code: 'permission-denied',
          message: 'plugin lacks editor:selection permission',
        };
      }
    }
    // commands.register, notify.info, sidebar.addPanel are always allowed.
    return null;
  }

  private async executeApiMethod(method: SpikeAPIMethod, _args: unknown[]): Promise<unknown> {
    switch (method) {
      case 'editor.getSelection':
        return this.getSelectionImpl();
      case 'notify.info':
        // Surfaced via the message-level notify variant elsewhere; treat the
        // direct api-call form as a no-op acknowledgement.
        return undefined;
      case 'sidebar.addPanel':
        // Bridge-side acknowledgement; the panel-render message variant is
        // what actually triggers UI rendering.
        return undefined;
      case 'commands.register':
        // Registration normally arrives via the dedicated message variant.
        // If a plugin invokes it as an api-call, treat as ack.
        return undefined;
      case 'workspace.readFile':
        // Should never reach here; checkPermission denies first.
        throw new Error('workspace.readFile invoked despite denial');
      default: {
        const exhaustive: never = method;
        throw new Error(`unknown api method: ${String(exhaustive)}`);
      }
    }
  }

  private postError(inResponseTo: string, error: SpikeError): void {
    const msg: SpikeMessage = {
      id: this.allocId(),
      type: 'error',
      inResponseTo,
      error,
    };
    this.worker.postMessage(encode(msg));
  }
}
