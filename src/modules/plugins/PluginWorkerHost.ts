// Plugin runner — per-plugin worker host.
//
// One PluginWorkerHost wraps one PluginAPIBridge plus its underlying Worker.
// The PluginManager (Group VII) constructs one host per enabled plugin,
// composes the bridge's hooks (per-plugin closures bound to the manifest's
// `id`), spawns the worker via the injected `workerFactory`, and sends the
// `init` message to hand off the plugin source.
//
// This file is a thin lifecycle wrapper around the bridge. The bridge is
// the canonical permission-enforcement + message-routing layer; the host
// adds:
//
//   - Per-plugin hook composition. The manager owns the hosts (CommandsHost,
//     NotifyHost, ToolbarHost, etc.) and registers a single `dispatch`
//     callback (the Wave3HostRouter) plus a handful of bridge-hook callbacks
//     (`onToolbarAdd`, `onSidebarAddPanel`, etc.). The host wraps each hook
//     with the owning `pluginId` so the bridge stays plugin-agnostic.
//
//   - Crash detection. The bridge fires `onError` for any worker-side error;
//     the host marks the plugin status `crashed` in the store, captures the
//     error message, and emits a `plugin_crashed` audit event so the user
//     can see it in the audit log and the UI can surface a Restart button.
//
//   - Init guarding. Tracks whether `init` has been sent so duplicate enable
//     calls are no-ops rather than worker-protocol violations.
//
// Spec: docs/superpowers/specs/2026-04-28-v2.0-mega-release-design.md §6.5
// Plan: docs/superpowers/plans/2026-05-03-stream-c3-plugin-runner.md (task 7.2)

import { AuditService } from '@/modules/audit/AuditService';
import { usePluginManagerStore } from '@/stores/pluginManagerStore';
import type { PluginManifest } from '@/types/plugin';

import {
  PluginAPIBridge,
  type PluginBridgeHooks,
  type PluginWorkerFactory,
} from './PluginAPIBridge';
import type { PluginErrorPayload } from './PluginMessageProtocol';

export interface PluginWorkerHostOptions {
  /** The plugin's validated manifest. */
  manifest: PluginManifest;
  /** Per-plugin hooks the manager has already bound to this manifest's id. */
  hooks: PluginBridgeHooks;
  /** Worker constructor. Production: Vite `?worker` import. Tests: paired mock. */
  workerFactory: PluginWorkerFactory;
  /** Plugin source code as a UTF-8 string. The host posts it via `bridge.sendInit`. */
  pluginCode: string;
  /** Inject an audit service (tests). Defaults to `new AuditService('plugins')`. */
  auditService?: AuditService;
  /**
   * Optional bridge factory (tests). Defaults to constructing a real
   * `PluginAPIBridge`. Lets tests substitute a stub bridge that drives the
   * crash hook directly without a real worker.
   */
  bridgeFactory?: (
    manifest: PluginManifest,
    hooks: PluginBridgeHooks,
    workerFactory: PluginWorkerFactory,
  ) => PluginAPIBridge;
}

/**
 * Lifecycle wrapper around a single plugin's worker. The PluginManager owns
 * one of these per enabled plugin and disposes it on disable / uninstall /
 * crash + restart.
 */
export class PluginWorkerHost {
  readonly manifest: PluginManifest;
  private readonly bridge: PluginAPIBridge;
  private readonly auditService: AuditService;
  private initSent = false;
  private terminated = false;
  /** Last error captured from the bridge's `onError` hook. */
  private lastError: PluginErrorPayload | null = null;

  constructor(options: PluginWorkerHostOptions) {
    this.manifest = options.manifest;
    this.auditService = options.auditService ?? new AuditService('plugins');

    // Compose the hooks bag with our own crash handler so the manager doesn't
    // have to remember to wire it. We chain to the caller's `onError` so any
    // external observer still sees the failure.
    const userOnError = options.hooks.onError;
    const userOnUnload = options.hooks.onUnload;
    const composed: PluginBridgeHooks = {
      ...options.hooks,
      onError: (err, inResponseTo) => {
        this.handleCrash(err);
        if (userOnError) {
          try {
            userOnError(err, inResponseTo);
          } catch {
            // External hook failure must not break our crash bookkeeping.
          }
        }
      },
      onUnload: () => {
        if (userOnUnload) {
          try {
            userOnUnload();
          } catch {
            // ignore
          }
        }
      },
    };

    const factory =
      options.bridgeFactory ??
      ((manifest, hooks, workerFactory) => new PluginAPIBridge(manifest, hooks, workerFactory));
    this.bridge = factory(this.manifest, composed, options.workerFactory);

    // Send init synchronously after construction. A separate `start()` would
    // be marginally more flexible but we'd then need to track an extra
    // intermediate state; simpler to fail fast at construction time.
    this.sendInit(options.pluginCode);
  }

  /** Whether the worker has been terminated. Safe to query post-disposal. */
  isTerminated(): boolean {
    return this.terminated;
  }

  /** Last error captured from the worker. Null when never errored. */
  getLastError(): PluginErrorPayload | null {
    return this.lastError;
  }

  /** Bridge accessor for the manager's command-invoker wiring. */
  getBridge(): PluginAPIBridge {
    return this.bridge;
  }

  /** Convenience for the manager's `commands.invoke` cross-worker dispatch. */
  invokeCommand(commandId: string, payload?: unknown): Promise<unknown> {
    return this.bridge.invokeCommand(commandId, payload);
  }

  /**
   * Terminate the worker. Idempotent. Does NOT mutate the store status; the
   * manager's `disable` / `uninstall` / `restart` paths are responsible for
   * the status transition because the meaning differs (`disabled` vs
   * `uninstalled` vs interim during `crashed` -> `enabled`).
   */
  terminate(): void {
    if (this.terminated) return;
    this.terminated = true;
    try {
      this.bridge.terminate();
    } catch {
      // Bridge.terminate is itself idempotent; defensive catch in case a
      // mock bridge throws.
    }
  }

  // ----- Internals ---------------------------------------------------------

  private sendInit(code: string): void {
    if (this.initSent || this.terminated) return;
    this.initSent = true;
    try {
      this.bridge.sendInit({ code });
    } catch (err) {
      // sendInit can throw if the bridge is already terminated. Surface as a
      // crash so the manager can react.
      this.handleCrash({
        code: 'plugin-threw',
        message: err instanceof Error ? err.message : 'sendInit failed',
      });
    }
  }

  /**
   * Mark the plugin as crashed in the store and emit a `plugin_crashed`
   * audit event. The bridge's `onError` hook is the canonical entry point;
   * we also call this directly when init throws synchronously.
   */
  private handleCrash(err: PluginErrorPayload): void {
    this.lastError = err;
    const store = usePluginManagerStore.getState();
    store.setStatus(this.manifest.id, 'crashed');
    store.setError(this.manifest.id, err.message);
    const payload: { id: string; version: string; error: string; stack?: string } = {
      id: this.manifest.id,
      version: this.manifest.version,
      error: err.message,
    };
    if (err.stack) payload.stack = err.stack;
    this.auditService.append({
      type: 'plugin_crashed',
      timestamp: new Date().toISOString(),
      payload,
    });
  }
}
