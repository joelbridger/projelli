// Plugin runner — main-thread bridge.
//
// Owns one Worker per plugin instance. Routes messages between the main
// thread and the worker, enforces permissions on every `api-call`, dispatches
// gated calls to a host-adapter callback (`hooks.dispatch`, registered by
// Groups IV-VI), and translates the dedicated UI-registration variants
// (`toolbar-add`, `sidebar-add-panel`, etc.) directly to UI-registry hooks
// without any permission check.
//
// The bridge does NOT instantiate the worker itself when a `workerFactory`
// is supplied (the production path uses Vite's `?worker` import; tests inject
// a mock paired with an in-process `PluginRuntime`). Either way, the contract
// is identical: post a string-encoded message in, get a string-encoded
// message out.
//
// Spec: docs/superpowers/specs/2026-04-28-v2.0-mega-release-design.md §6.4 + §6.5
// Plan: docs/superpowers/plans/2026-05-03-stream-c3-plugin-runner.md (tasks 2.1-2.4)

import type {
  PluginManifest,
  PluginPermission,
  SettingsPageSpec,
  SidebarPanelSpec,
  ToolbarButtonSpec,
} from '@/types/plugin';

import {
  decode,
  encode,
  type PluginApiCallMessage,
  type PluginCommandResultMessage,
  type PluginErrorMessage,
  type PluginErrorPayload,
  type PluginMessage,
  type PluginNotifyMessage,
  type PluginPanelRenderMessage,
  type PluginRegisterCommandMessage,
  type PluginSettingsAddPageMessage,
  type PluginSidebarAddPanelMessage,
  type PluginSidebarRemovePanelMessage,
  type PluginToolbarAddMessage,
  type PluginToolbarRemoveMessage,
} from './PluginMessageProtocol';
import { requiredPermissionFor } from './permissionMap';

/**
 * Subset of the Worker DOM interface the bridge actually needs. Defined here
 * so tests can supply a minimal mock without pulling in the global Worker
 * constructor (web workers do not run reliably in jsdom).
 */
export interface PluginWorkerLike {
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

/** Factory used to construct the worker. Production: Vite `?worker` import. Tests: paired mock. */
export type PluginWorkerFactory = () => PluginWorkerLike;

/**
 * Dispatch contract between bridge and host adapters. Groups IV-VI register
 * one of these per `PluginAPIBridge` instance. The bridge calls it after
 * permission checks pass.
 *
 * Returning `undefined` from the dispatcher is a valid result; the bridge
 * relays it to the worker as the `api-result` payload.
 *
 * If the dispatcher throws, the bridge surfaces the error to the worker as
 * an `error` message with code `internal` (or `not-found`/`invalid-args` if
 * the thrown value carries one of those codes via `error.code`).
 */
export interface PluginApiDispatchCall {
  pluginId: string;
  method: PluginApiCallMessage['method'];
  args: unknown[];
}
export type PluginApiDispatcher = (call: PluginApiDispatchCall) => unknown;

/**
 * Hooks the bridge fires for events plugins emit. UI-registration variants
 * have dedicated hooks so the registry stores can mutate without going
 * through the gated dispatch path. None of these are required; the bridge
 * silently drops events for which no hook is registered.
 */
export interface PluginBridgeHooks {
  /** Worker terminated (idempotent). */
  onUnload?: () => void;
  /** Plugin registered a command handler. */
  onRegisterCommand?: (commandId: string, meta: { title?: string; category?: string }) => void;
  /** Plugin asked to render a sidebar panel inline (legacy `panel-render` variant). */
  onPanelRender?: (panelId: string, html: string) => void;
  /** Plugin contributed a toolbar button. */
  onToolbarAdd?: (spec: ToolbarButtonSpec) => void;
  /** Plugin removed a toolbar button. */
  onToolbarRemove?: (buttonId: string) => void;
  /** Plugin contributed a sidebar panel. */
  onSidebarAddPanel?: (spec: SidebarPanelSpec) => void;
  /** Plugin removed a sidebar panel. */
  onSidebarRemovePanel?: (panelId: string) => void;
  /** Plugin contributed a settings page. */
  onSettingsAddPage?: (spec: SettingsPageSpec) => void;
  /** Plugin emitted a user-facing notification. */
  onNotify?: (level: 'info' | 'warn' | 'error', message: string) => void;
  /**
   * Permission denial hook. Bridge fires this every time a gated `api-call`
   * is rejected because the plugin's manifest doesn't declare the required
   * permission. Group III's `PluginPermissions` audits via this callback.
   */
  onPermissionDenied?: (info: { permission: PluginPermission; method: string }) => void;
  /** Worker-side error surfaced. */
  onError?: (error: PluginErrorPayload, inResponseTo?: string) => void;
  /**
   * Adapter callback for gated API methods. Groups IV-VI register the real
   * dispatcher here. If absent or returns `not-found`, the bridge replies to
   * the plugin with code `not-found`.
   */
  dispatch?: PluginApiDispatcher;
}

type PendingResolver = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

/**
 * Default factory throws to force the caller (PluginManager in Group VII or
 * tests via the mock factory) to wire up worker construction explicitly.
 * Keeping the bridge agnostic of how the worker is spawned makes it usable
 * from either Vite's `?worker` import path or the paired-mock test path.
 */
const defaultWorkerFactory: PluginWorkerFactory = () => {
  throw new Error(
    'PluginAPIBridge: no workerFactory supplied. Production callers must inject ' +
      "the Vite-bundled worker via `import PluginWorker from './plugin-worker.ts?worker'`; " +
      'tests must use the paired-mock factory from tests/helpers/pluginMockFactory.',
  );
};

export class PluginAPIBridge {
  private readonly worker: PluginWorkerLike;
  private readonly manifest: PluginManifest;
  private readonly hooks: PluginBridgeHooks;
  private readonly grantedPermissions: ReadonlySet<PluginPermission>;

  /** Outstanding `invoke-command` calls awaiting `command-result` or `error`. */
  private readonly pendingInvokes = new Map<string, PendingResolver>();
  /** Commands the worker has registered. */
  private readonly registeredCommands = new Set<string>();

  /** Blob URL the worker may have used to import plugin code (revoked on terminate). */
  private blobUrl: string | null = null;

  private nextId = 1;
  private terminated = false;

  /**
   * Construct a bridge for one plugin. The constructor does NOT post the
   * `init` message; callers must call `sendInit({ code })` once they have
   * the plugin source. This separation lets the manager defer init until
   * after the worker is wired up to all its host adapters.
   */
  constructor(
    manifest: PluginManifest,
    hooks: PluginBridgeHooks = {},
    workerFactory: PluginWorkerFactory = defaultWorkerFactory,
  ) {
    this.manifest = manifest;
    this.hooks = hooks;
    this.grantedPermissions = new Set(manifest.permissions);
    this.worker = workerFactory();
    this.worker.addEventListener('message', this.handleWorkerMessage);
    this.worker.addEventListener('error', this.handleWorkerError);
    this.worker.addEventListener('messageerror', this.handleWorkerError);
  }

  /** Plugin id for log context. */
  get pluginId(): string {
    return this.manifest.id;
  }

  /** Whether the bridge has been terminated. */
  isTerminated(): boolean {
    return this.terminated;
  }

  /** Commands the worker has registered so far. */
  getRegisteredCommands(): string[] {
    return Array.from(this.registeredCommands);
  }

  /**
   * Hand the plugin source to the worker. Can be called once. Subsequent
   * calls are ignored after termination.
   */
  sendInit(plugin: { code: string; blobUrl?: string }): void {
    this.assertAlive();
    if (plugin.blobUrl) {
      this.blobUrl = plugin.blobUrl;
    }
    const msg: PluginMessage = {
      id: this.allocId(),
      type: 'init',
      pluginId: this.manifest.id,
      version: this.manifest.version,
      pluginCode: plugin.code,
      permissions: Array.from(this.grantedPermissions),
    };
    this.worker.postMessage(encode(msg));
  }

  /**
   * Invoke a plugin-registered command by id. Resolves with the command's
   * return value or rejects with a structured Error carrying `code` and
   * (when known) `stack` properties from the worker.
   */
  invokeCommand(commandId: string, payload?: unknown): Promise<unknown> {
    this.assertAlive();
    return new Promise<unknown>((resolve, reject) => {
      const id = this.allocId();
      this.pendingInvokes.set(id, { resolve, reject });
      const msg: PluginMessage = {
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
   * Terminate the worker, cancel all pending calls with an `unloaded`
   * rejection, revoke any blob URL, and fire `hooks.onUnload`. Idempotent.
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
      // Best-effort: mock workers may not implement terminate.
    }
    if (this.blobUrl) {
      try {
        URL.revokeObjectURL(this.blobUrl);
      } catch {
        // Browsers without URL.revokeObjectURL (jsdom in some configs) — ignore.
      }
      this.blobUrl = null;
    }
    const unloadedError = Object.assign(new Error('plugin worker unloaded'), {
      code: 'unloaded' as const,
    });
    for (const [, pending] of this.pendingInvokes) {
      pending.reject(unloadedError);
    }
    this.pendingInvokes.clear();
    try {
      this.hooks.onUnload?.();
    } catch {
      // Hook errors must not break termination.
    }
  }

  // ----- Internals ---------------------------------------------------------

  private allocId(): string {
    const id = `b-${String(this.nextId)}`;
    this.nextId += 1;
    return id;
  }

  private assertAlive(): void {
    if (this.terminated) {
      throw new Error(`PluginAPIBridge[${this.manifest.id}]: cannot use a terminated bridge`);
    }
  }

  private readonly handleWorkerMessage = (event: { data?: unknown }): void => {
    if (this.terminated) return;
    let msg: PluginMessage;
    try {
      msg = decode(event.data);
    } catch {
      // Drop malformed messages. Anything we receive that doesn't speak the
      // protocol is either a programmer bug or a hostile worker; either way,
      // the safe behavior is to ignore.
      return;
    }
    switch (msg.type) {
      case 'register-command':
        this.handleRegisterCommand(msg);
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
      case 'toolbar-add':
        this.handleToolbarAdd(msg);
        return;
      case 'toolbar-remove':
        this.handleToolbarRemove(msg);
        return;
      case 'sidebar-add-panel':
        this.handleSidebarAddPanel(msg);
        return;
      case 'sidebar-remove-panel':
        this.handleSidebarRemovePanel(msg);
        return;
      case 'settings-add-page':
        this.handleSettingsAddPage(msg);
        return;
      case 'notify':
        this.handleNotify(msg);
        return;
      case 'error':
        this.handleError(msg);
        return;
      default:
        // Variants only sent main->worker; ignore.
        return;
    }
  };

  private readonly handleWorkerError = (event: { message?: string }): void => {
    if (this.terminated) return;
    const error: PluginErrorPayload = {
      code: 'plugin-threw',
      message: event.message ?? 'worker error',
    };
    try {
      this.hooks.onError?.(error);
    } catch {
      // Hook errors must not affect bridge state.
    }
    // Worker-level errors don't carry an inResponseTo; any pending call must
    // not hang forever. Reject all and let the manager decide whether to
    // terminate / mark crashed.
    for (const [, pending] of this.pendingInvokes) {
      pending.reject(Object.assign(new Error(error.message), { code: error.code }));
    }
    this.pendingInvokes.clear();
  };

  private handleRegisterCommand(msg: PluginRegisterCommandMessage): void {
    this.registeredCommands.add(msg.commandId);
    const meta: { title?: string; category?: string } = {};
    if (msg.title !== undefined) meta.title = msg.title;
    if (msg.category !== undefined) meta.category = msg.category;
    try {
      this.hooks.onRegisterCommand?.(msg.commandId, meta);
    } catch {
      // Hook failure must not break the bridge.
    }
  }

  private handlePanelRender(msg: PluginPanelRenderMessage): void {
    try {
      this.hooks.onPanelRender?.(msg.panelId, msg.html);
    } catch {
      // ignore
    }
  }

  private handleToolbarAdd(msg: PluginToolbarAddMessage): void {
    try {
      this.hooks.onToolbarAdd?.(msg.spec);
    } catch {
      // ignore
    }
  }

  private handleToolbarRemove(msg: PluginToolbarRemoveMessage): void {
    try {
      this.hooks.onToolbarRemove?.(msg.buttonId);
    } catch {
      // ignore
    }
  }

  private handleSidebarAddPanel(msg: PluginSidebarAddPanelMessage): void {
    try {
      this.hooks.onSidebarAddPanel?.(msg.spec);
    } catch {
      // ignore
    }
  }

  private handleSidebarRemovePanel(msg: PluginSidebarRemovePanelMessage): void {
    try {
      this.hooks.onSidebarRemovePanel?.(msg.panelId);
    } catch {
      // ignore
    }
  }

  private handleSettingsAddPage(msg: PluginSettingsAddPageMessage): void {
    try {
      this.hooks.onSettingsAddPage?.(msg.spec);
    } catch {
      // ignore
    }
  }

  private handleNotify(msg: PluginNotifyMessage): void {
    try {
      this.hooks.onNotify?.(msg.level, msg.message);
    } catch {
      // ignore
    }
  }

  private resolveInvoke(msg: PluginCommandResultMessage): void {
    const pending = this.pendingInvokes.get(msg.inResponseTo);
    if (!pending) return;
    this.pendingInvokes.delete(msg.inResponseTo);
    pending.resolve(msg.result);
  }

  private handleError(msg: PluginErrorMessage): void {
    try {
      this.hooks.onError?.(msg.error, msg.inResponseTo);
    } catch {
      // ignore
    }
    if (msg.inResponseTo) {
      const pending = this.pendingInvokes.get(msg.inResponseTo);
      if (pending) {
        this.pendingInvokes.delete(msg.inResponseTo);
        const errorObj: Error & { code?: string; stack?: string } = Object.assign(
          new Error(msg.error.message),
          { code: msg.error.code },
        );
        if (msg.error.stack) errorObj.stack = msg.error.stack;
        pending.reject(errorObj);
      }
    }
  }

  /**
   * Handle an `api-call` from the worker. Enforces permissions and dispatches
   * to the registered host adapter. Public so tests can drive it directly
   * without round-tripping through postMessage.
   */
  async handleApiCall(msg: PluginApiCallMessage): Promise<void> {
    if (this.terminated) return;
    const required = requiredPermissionFor(msg.method);
    if (required !== null && !this.grantedPermissions.has(required)) {
      try {
        this.hooks.onPermissionDenied?.({ permission: required, method: msg.method });
      } catch {
        // ignore hook failure
      }
      this.postError(msg.id, {
        code: 'permission-denied',
        message: `plugin '${this.manifest.id}' lacks permission '${required}' required by ${msg.method}`,
      });
      return;
    }
    if (!this.hooks.dispatch) {
      this.postError(msg.id, {
        code: 'not-found',
        message: `no host adapter registered for ${msg.method}`,
      });
      return;
    }
    try {
      const result = await this.hooks.dispatch({
        pluginId: this.manifest.id,
        method: msg.method,
        args: msg.args,
      });
      const response: PluginMessage = {
        id: this.allocId(),
        type: 'api-result',
        inResponseTo: msg.id,
        result,
      };
      this.worker.postMessage(encode(response));
    } catch (err) {
      // Cast through unknown so a JS-thrown value with no `.code` doesn't
      // silently produce `undefined` and confuse the protocol layer.
      const e = err as { code?: unknown; message?: unknown; stack?: unknown } | null;
      const code = typeof e?.code === 'string' ? e.code : 'internal';
      const message = typeof e?.message === 'string' ? e.message : 'internal error';
      const payload: PluginErrorPayload = {
        code: code as PluginErrorPayload['code'],
        message,
      };
      if (typeof e?.stack === 'string') payload.stack = e.stack;
      this.postError(msg.id, payload);
    }
  }

  private postError(inResponseTo: string, error: PluginErrorPayload): void {
    if (this.terminated) return;
    const msg: PluginMessage = {
      id: this.allocId(),
      type: 'error',
      inResponseTo,
      error,
    };
    try {
      this.worker.postMessage(encode(msg));
    } catch {
      // If we can't post the error back, the worker is gone; nothing to do.
    }
  }
}
