// Plugin Spike — worker-side runtime.
//
// Receives `init` from the main-thread bridge, dynamic-imports the plugin
// code via a Blob URL, and hands the plugin a SpikeAPI proxy. Each method
// on the proxy posts an `api-call` and awaits an `api-result` or `error`,
// re-throwing structured errors as plain Error objects on the plugin side.
//
// Spec: docs/superpowers/specs/2026-04-28-v2.0-mega-release-design.md §6.3
// Plan: docs/superpowers/plans/2026-05-03-stream-c2-plugin-spike.md

import type {
  SpikeAPI,
  SpikeApiResultMessage,
  SpikeError,
  SpikeErrorMessage,
  SpikeInitMessage,
  SpikeInvokeCommandMessage,
  SpikeMessage,
  SpikePanelSpec,
  SpikePermission,
} from '@/types/pluginSpike';

import { decode, encode, isSpikeMessage } from './SpikeMessageProtocol';

/**
 * Subset of the `DedicatedWorkerGlobalScope` the runtime needs. Defined here
 * so tests can pass a mock object instead of the real worker scope.
 */
export interface SpikeWorkerScope {
  postMessage(data: unknown): void;
  addEventListener(
    type: 'message',
    listener: (event: { data?: unknown }) => void,
  ): void;
}

/** Shape exported by a plugin module. Spike requires only `activate`. */
export interface SpikePluginModule {
  activate(api: SpikeAPI, ctx: { permissions: SpikePermission[] }): void | Promise<void>;
  deactivate?(): void | Promise<void>;
}

/**
 * Loader contract for turning plugin source into a module. The default uses
 * `URL.createObjectURL` + dynamic `import()`. Tests can supply an in-process
 * loader to avoid relying on Blob URLs in jsdom.
 */
export type SpikePluginLoader = (code: string) => Promise<SpikePluginModule>;

/**
 * Build a `plugin-threw` SpikeError from a thrown value, only including the
 * `stack` property when it actually exists (TS exactOptionalPropertyTypes).
 */
function makePluginThrewError(err: unknown, fallback: string): SpikeError {
  const e = err as { message?: string; stack?: string } | null;
  const out: SpikeError = {
    code: 'plugin-threw',
    message: e?.message ?? fallback,
  };
  if (e?.stack) out.stack = e.stack;
  return out;
}

const defaultLoader: SpikePluginLoader = async (code) => {
  const blob = new Blob([code], { type: 'text/javascript' });
  const url = URL.createObjectURL(blob);
  try {
    // Vite leaves `import(url)` alone when the URL is dynamic and not a
    // literal; this is what we want here.
    const mod = (await import(/* @vite-ignore */ url)) as SpikePluginModule;
    return mod;
  } finally {
    URL.revokeObjectURL(url);
  }
};

type PendingApiCall = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

export interface SpikePluginRuntimeOptions {
  scope: SpikeWorkerScope;
  loader?: SpikePluginLoader;
}

export class SpikePluginRuntime {
  private readonly scope: SpikeWorkerScope;
  private readonly loader: SpikePluginLoader;
  private readonly commands = new Map<string, (payload?: unknown) => unknown | Promise<unknown>>();
  private readonly pendingApiCalls = new Map<string, PendingApiCall>();
  private nextId = 1;
  private permissions: SpikePermission[] = [];

  constructor(options: SpikePluginRuntimeOptions) {
    this.scope = options.scope;
    this.loader = options.loader ?? defaultLoader;
    this.scope.addEventListener('message', this.handleMessage);
  }

  private allocId(): string {
    const id = `r-${this.nextId}`;
    this.nextId += 1;
    return id;
  }

  private readonly handleMessage = (event: { data?: unknown }): void => {
    let msg: SpikeMessage;
    try {
      msg = decode(event.data);
    } catch {
      return;
    }
    switch (msg.type) {
      case 'init':
        void this.handleInit(msg);
        return;
      case 'invoke-command':
        void this.handleInvoke(msg);
        return;
      case 'api-result':
        this.resolveApiCall(msg);
        return;
      case 'error':
        this.rejectApiCall(msg);
        return;
      default:
        return;
    }
  };

  private async handleInit(msg: SpikeInitMessage): Promise<void> {
    this.permissions = msg.permissions;
    try {
      const mod = await this.loader(msg.pluginCode);
      const api = this.buildApi();
      await mod.activate(api, { permissions: this.permissions });
    } catch (err) {
      this.postError(makePluginThrewError(err, 'plugin failed to activate'), msg.id);
    }
  }

  private async handleInvoke(msg: SpikeInvokeCommandMessage): Promise<void> {
    const handler = this.commands.get(msg.commandId);
    if (!handler) {
      this.postError(
        {
          code: 'unknown-command',
          message: `no command registered for ${msg.commandId}`,
        },
        msg.id,
      );
      return;
    }
    try {
      const result = await handler(msg.payload);
      const response: SpikeMessage = {
        id: this.allocId(),
        type: 'command-result',
        inResponseTo: msg.id,
        result,
      };
      this.scope.postMessage(encode(response));
    } catch (err) {
      this.postError(makePluginThrewError(err, 'command threw'), msg.id);
    }
  }

  private resolveApiCall(msg: SpikeApiResultMessage): void {
    const pending = this.pendingApiCalls.get(msg.inResponseTo);
    if (!pending) return;
    this.pendingApiCalls.delete(msg.inResponseTo);
    pending.resolve(msg.result);
  }

  private rejectApiCall(msg: SpikeErrorMessage): void {
    if (!msg.inResponseTo) return;
    const pending = this.pendingApiCalls.get(msg.inResponseTo);
    if (!pending) return;
    this.pendingApiCalls.delete(msg.inResponseTo);
    pending.reject(
      Object.assign(new Error(msg.error.message), {
        code: msg.error.code,
        stack: msg.error.stack,
      }),
    );
  }

  private postError(error: SpikeError, inResponseTo?: string): void {
    const msg: SpikeMessage = {
      id: this.allocId(),
      type: 'error',
      ...(inResponseTo ? { inResponseTo } : {}),
      error,
    };
    this.scope.postMessage(encode(msg));
  }

  private callApi(method: SpikeAPIMethodName, args: unknown[]): Promise<unknown> {
    return new Promise<unknown>((resolve, reject) => {
      const id = this.allocId();
      this.pendingApiCalls.set(id, { resolve, reject });
      const msg: SpikeMessage = {
        id,
        type: 'api-call',
        method,
        args,
      };
      try {
        this.scope.postMessage(encode(msg));
      } catch (err) {
        this.pendingApiCalls.delete(id);
        reject(err as Error);
      }
    });
  }

  private buildApi(): SpikeAPI {
    return {
      commands: {
        register: (commandId, handler) => {
          this.commands.set(commandId, handler);
          // Inform main thread for criterion-2 routing.
          const msg: SpikeMessage = {
            id: this.allocId(),
            type: 'register-command',
            commandId,
          };
          this.scope.postMessage(encode(msg));
        },
      },
      editor: {
        getSelection: () => this.callApi('editor.getSelection', []) as Promise<string>,
      },
      workspace: {
        readFile: (path) => this.callApi('workspace.readFile', [path]) as Promise<string>,
      },
      notify: {
        info: (message) => {
          // Send the dedicated notify message (one-way, fire-and-forget).
          const out: SpikeMessage = {
            id: this.allocId(),
            type: 'notify',
            level: 'info',
            message,
          };
          this.scope.postMessage(encode(out));
          return Promise.resolve();
        },
      },
      sidebar: {
        addPanel: (spec: SpikePanelSpec) => {
          const out: SpikeMessage = {
            id: this.allocId(),
            type: 'panel-render',
            spec,
          };
          this.scope.postMessage(encode(out));
          return Promise.resolve();
        },
      },
    };
  }
}

type SpikeAPIMethodName =
  | 'editor.getSelection'
  | 'workspace.readFile'
  | 'notify.info'
  | 'sidebar.addPanel'
  | 'commands.register';

// Re-export for convenience; tests import the unused guard through this module.
export { isSpikeMessage };
