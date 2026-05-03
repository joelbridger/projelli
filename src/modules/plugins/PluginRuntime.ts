// Plugin runner — worker-side runtime.
//
// Sits inside the dedicated plugin web worker. Receives `init` from the
// main-thread bridge, dynamic-imports the plugin code via a Blob URL (the
// spike validated this approach), and hands the plugin a `PluginAPI` proxy.
// Each method on the proxy posts an `api-call` and awaits the matching
// `api-result` or `error`. UI-registration methods (commands.register,
// toolbar.add/remove, sidebar.add/remove-panel, settings.addPage, notify.*)
// post their dedicated message variants without round-tripping for a result.
//
// Spec: docs/superpowers/specs/2026-04-28-v2.0-mega-release-design.md §6.4 + §6.5
// Plan: docs/superpowers/plans/2026-05-03-stream-c3-plugin-runner.md (tasks 2.5-2.6)

import type { FileNode } from '@/types/workspace';

import type {
  PluginAIInvokeOptions,
  PluginAPI,
  PluginEditorSelection,
  PluginModule,
  PluginNetworkResponse,
  PluginPermission,
  SettingsPageSpec,
  SidebarPanelSpec,
  ToolbarButtonSpec,
} from '@/types/plugin';

import {
  decode,
  encode,
  isPluginMessage,
  type PluginAPIMethod,
  type PluginApiResultMessage,
  type PluginErrorMessage,
  type PluginErrorPayload,
  type PluginInitMessage,
  type PluginInvokeCommandMessage,
  type PluginMessage,
} from './PluginMessageProtocol';

/**
 * Minimal subset of `DedicatedWorkerGlobalScope` the runtime needs. Defined
 * here so tests can pass a mock object instead of the real worker global.
 */
export interface PluginWorkerScope {
  postMessage(data: unknown): void;
  addEventListener(
    type: 'message',
    listener: (event: { data?: unknown }) => void,
  ): void;
}

/**
 * Loader contract for turning plugin source into a module. The default uses
 * `URL.createObjectURL` + dynamic `import()`. Tests can supply an in-process
 * loader to avoid relying on Blob URLs in jsdom.
 */
export type PluginLoader = (code: string) => Promise<PluginModule>;

const defaultLoader: PluginLoader = async (code) => {
  const blob = new Blob([code], { type: 'text/javascript' });
  const url = URL.createObjectURL(blob);
  try {
    // Vite leaves `import(url)` alone when the URL is dynamic; this is what
    // we want here. The plugin module's default export must be a PluginModule.
    const mod = (await import(/* @vite-ignore */ url)) as { default?: PluginModule } & PluginModule;
    // Plugins may export `activate` either as a default-export object or as
    // a top-level named export. Accept both shapes; bind functions to their
    // module so the plugin author's `this` references stay correct.
    if (mod.default && typeof mod.default.activate === 'function') return mod.default;
    if (typeof mod.activate === 'function') {
      const activate = mod.activate.bind(mod);
      const out: PluginModule = { activate };
      if (typeof mod.deactivate === 'function') out.deactivate = mod.deactivate.bind(mod);
      return out;
    }
    throw new Error('plugin module exports neither default.activate nor named activate');
  } finally {
    URL.revokeObjectURL(url);
  }
};

type PendingApiCall = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

export interface PluginRuntimeOptions {
  scope: PluginWorkerScope;
  loader?: PluginLoader;
}

/**
 * Build a `plugin-threw` error payload from a thrown value. Only includes
 * `stack` when it actually exists (TS exactOptionalPropertyTypes).
 */
function makePluginThrewError(err: unknown, fallback: string): PluginErrorPayload {
  const e = err as { message?: unknown; stack?: unknown } | null;
  const out: PluginErrorPayload = {
    code: 'plugin-threw',
    message: typeof e?.message === 'string' ? e.message : fallback,
  };
  if (typeof e?.stack === 'string') out.stack = e.stack;
  return out;
}

export class PluginRuntime {
  private readonly scope: PluginWorkerScope;
  private readonly loader: PluginLoader;
  private readonly commands = new Map<string, (payload?: unknown) => unknown>();
  private readonly pendingApiCalls = new Map<string, PendingApiCall>();
  private nextId = 1;
  /** Permissions granted to this plugin. Stored for introspection by future hosts; not used for gating (the bridge enforces). */
  private permissions: ReadonlyArray<PluginPermission> = [];
  private pluginId: string = '';
  private pluginVersion: string = '';
  private deactivated = false;
  private deactivateFn: (() => void | Promise<void>) | null = null;

  constructor(options: PluginRuntimeOptions) {
    this.scope = options.scope;
    this.loader = options.loader ?? defaultLoader;
    this.scope.addEventListener('message', this.handleMessage);
  }

  /** Plugin id (set after `init`). Empty string until then. */
  getPluginId(): string {
    return this.pluginId;
  }

  /** Permissions granted to this plugin (set after `init`). */
  getPermissions(): ReadonlyArray<PluginPermission> {
    return this.permissions;
  }

  private allocId(): string {
    const id = `r-${String(this.nextId)}`;
    this.nextId += 1;
    return id;
  }

  private readonly handleMessage = (event: { data?: unknown }): void => {
    let msg: PluginMessage;
    try {
      msg = decode(event.data);
    } catch {
      // Drop malformed messages silently: same rationale as the bridge.
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
        // Worker-side runtime never receives the worker-->main variants.
        return;
    }
  };

  private async handleInit(msg: PluginInitMessage): Promise<void> {
    this.permissions = msg.permissions;
    this.pluginId = msg.pluginId;
    this.pluginVersion = msg.version;
    try {
      const mod = await this.loader(msg.pluginCode);
      if (typeof mod.deactivate === 'function') {
        this.deactivateFn = mod.deactivate.bind(mod);
      }
      const api = this.buildApi();
      await mod.activate(api);
    } catch (err) {
      this.postError(makePluginThrewError(err, 'plugin failed to activate'), msg.id);
    }
  }

  private async handleInvoke(msg: PluginInvokeCommandMessage): Promise<void> {
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
      const response: PluginMessage = {
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

  private resolveApiCall(msg: PluginApiResultMessage): void {
    const pending = this.pendingApiCalls.get(msg.inResponseTo);
    if (!pending) return;
    this.pendingApiCalls.delete(msg.inResponseTo);
    pending.resolve(msg.result);
  }

  private rejectApiCall(msg: PluginErrorMessage): void {
    if (!msg.inResponseTo) return;
    const pending = this.pendingApiCalls.get(msg.inResponseTo);
    if (!pending) return;
    this.pendingApiCalls.delete(msg.inResponseTo);
    const err: Error & { code?: string; stack?: string } = Object.assign(
      new Error(msg.error.message),
      { code: msg.error.code },
    );
    if (msg.error.stack) err.stack = msg.error.stack;
    pending.reject(err);
  }

  private postError(error: PluginErrorPayload, inResponseTo?: string): void {
    const msg: PluginMessage = {
      id: this.allocId(),
      type: 'error',
      ...(inResponseTo ? { inResponseTo } : {}),
      error,
    };
    try {
      this.scope.postMessage(encode(msg));
    } catch {
      // If posting fails, the worker host has likely already detached.
    }
  }

  private callApi(method: PluginAPIMethod, args: unknown[]): Promise<unknown> {
    return new Promise<unknown>((resolve, reject) => {
      const id = this.allocId();
      this.pendingApiCalls.set(id, { resolve, reject });
      const msg: PluginMessage = {
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

  /** Run the plugin's `deactivate` if present. Idempotent. */
  async deactivate(): Promise<void> {
    if (this.deactivated) return;
    this.deactivated = true;
    if (!this.deactivateFn) return;
    try {
      await this.deactivateFn();
    } catch (err) {
      this.postError(makePluginThrewError(err, 'deactivate threw'));
    }
  }

  private buildApi(): PluginAPI {
    return {
      pluginId: this.pluginId,
      version: this.pluginVersion,

      commands: {
        register: (commandId, handler) => {
          this.commands.set(commandId, handler);
          const msg: PluginMessage = {
            id: this.allocId(),
            type: 'register-command',
            commandId,
          };
          this.scope.postMessage(encode(msg));
        },
        invoke: (commandId, payload) => {
          // commands.invoke is dispatched via the host so cross-plugin
          // command invocation goes through the registry. The bridge maps
          // this to its dispatch callback (Group IV's CommandsHost).
          return this.callApi('commands.invoke', [commandId, payload]);
        },
      },

      toolbar: {
        addButton: (spec: ToolbarButtonSpec) => {
          const msg: PluginMessage = {
            id: this.allocId(),
            type: 'toolbar-add',
            spec,
          };
          this.scope.postMessage(encode(msg));
        },
        removeButton: (buttonId: string) => {
          const msg: PluginMessage = {
            id: this.allocId(),
            type: 'toolbar-remove',
            buttonId,
          };
          this.scope.postMessage(encode(msg));
        },
      },

      sidebar: {
        addPanel: (spec: SidebarPanelSpec) => {
          const msg: PluginMessage = {
            id: this.allocId(),
            type: 'sidebar-add-panel',
            spec,
          };
          this.scope.postMessage(encode(msg));
        },
        removePanel: (panelId: string) => {
          const msg: PluginMessage = {
            id: this.allocId(),
            type: 'sidebar-remove-panel',
            panelId,
          };
          this.scope.postMessage(encode(msg));
        },
      },

      editor: {
        getSelection: () =>
          this.callApi('editor.getSelection', []) as Promise<PluginEditorSelection | null>,
        getContent: () => this.callApi('editor.getContent', []) as Promise<string>,
        replaceSelection: (text: string) =>
          this.callApi('editor.replaceSelection', [text]) as Promise<void>,
        insertAtCursor: (text: string) =>
          this.callApi('editor.insertAtCursor', [text]) as Promise<void>,
      },

      workspace: {
        listFiles: (path?: string) => this.callApi('workspace.listFiles', [path]) as Promise<FileNode[]>,
        readFile: (path: string) => this.callApi('workspace.readFile', [path]) as Promise<string>,
        writeFile: (path: string, content: string) =>
          this.callApi('workspace.writeFile', [path, content]) as Promise<void>,
      },

      ai: {
        invoke: (opts: PluginAIInvokeOptions) => this.callApi('ai.invoke', [opts]) as Promise<string>,
      },

      storage: {
        get: (key: string) => this.callApi('storage.get', [key]),
        set: (key: string, value: unknown) =>
          this.callApi('storage.set', [key, value]) as Promise<void>,
        remove: (key: string) => this.callApi('storage.remove', [key]) as Promise<void>,
      },

      network: {
        fetch: (url: string, opts?: RequestInit) =>
          this.callApi('network.fetch', [url, opts]) as Promise<PluginNetworkResponse>,
      },

      settings: {
        addPage: (spec: SettingsPageSpec) => {
          const msg: PluginMessage = {
            id: this.allocId(),
            type: 'settings-add-page',
            spec,
          };
          this.scope.postMessage(encode(msg));
        },
        get: (key: string) => this.callApi('settings.get', [key]),
        set: (key: string, value: unknown) =>
          this.callApi('settings.set', [key, value]) as Promise<void>,
      },

      notify: {
        info: (message: string) => {
          this.postNotify('info', message);
        },
        warn: (message: string) => {
          this.postNotify('warn', message);
        },
        error: (message: string) => {
          this.postNotify('error', message);
        },
      },
    };
  }

  private postNotify(level: 'info' | 'warn' | 'error', message: string): void {
    const msg: PluginMessage = {
      id: this.allocId(),
      type: 'notify',
      level,
      message,
    };
    this.scope.postMessage(encode(msg));
  }
}

// Re-export so the worker entry can import a single symbol (`PluginRuntime`)
// alongside the type guard for any caller that needs it.
export { isPluginMessage };
