// Plugin runner — Wave 3 host router.
//
// The bridge accepts a single `dispatch` hook for all `api-call` traffic.
// In production we have many hosts, each owning a small set of methods:
//
//   - CommandsHost  → `commands.invoke`
//   - StorageHost   → `storage.get/set/remove`
//   - SettingsHost  → `settings.get/set`
//   - EditorHost    → `editor.getSelection / getContent / replaceSelection / insertAtCursor`
//   - WorkspaceHost → `workspace.listFiles / readFile / writeFile`
//   - AIHost        → `ai.invoke`
//   - NetworkHost   → `network.fetch`
//
// This router composes them into one dispatcher: each host exposes
// `handlesMethod(method)` + `handle(call)`. The router asks each in
// registration order, returns the first match's result, and throws
// `not-found` if no host claims the method.
//
// The PluginManager (Group VII) constructs the router once (per workspace),
// registers all the hosts, and passes `router.dispatch.bind(router)` as the
// bridge's `dispatch` hook for every plugin's bridge.
//
// Spec: docs/superpowers/specs/2026-04-28-v2.0-mega-release-design.md §6.4
// Plan: docs/superpowers/plans/2026-05-03-stream-c3-plugin-runner.md
//        (router noted in Group VI implementation guidance)

import type {
  PluginApiDispatchCall,
  PluginApiDispatcher,
} from '../PluginAPIBridge';

/**
 * Minimal contract every host must satisfy to be registered with the router.
 * Both methods are intentionally narrow so tests can register lightweight
 * stubs without a full host implementation.
 */
export interface PluginDispatchHost {
  handlesMethod(method: string): boolean;
  handle(call: PluginApiDispatchCall): unknown | Promise<unknown>;
}

export class Wave3RouterError extends Error {
  readonly code: 'not-found';
  constructor(message: string) {
    super(message);
    this.code = 'not-found';
    this.name = 'Wave3RouterError';
  }
}

export class Wave3HostRouter {
  private readonly hosts: PluginDispatchHost[] = [];

  /**
   * Register a host. Hosts are queried in registration order; the first to
   * return true from `handlesMethod` wins. In practice no two hosts claim
   * the same method, but the order is deterministic so collisions are
   * predictable.
   */
  register(host: PluginDispatchHost): void {
    this.hosts.push(host);
  }

  /**
   * Replace the registered hosts in one shot. Useful in tests + when the
   * manager rebuilds the router for a new workspace.
   */
  setHosts(hosts: PluginDispatchHost[]): void {
    this.hosts.length = 0;
    for (const h of hosts) this.hosts.push(h);
  }

  /**
   * The dispatcher to hand to the bridge as `hooks.dispatch`. Bound method
   * not required because we close over `this` via the arrow.
   */
  dispatch: PluginApiDispatcher = (call) => this.route(call);

  private async route(call: PluginApiDispatchCall): Promise<unknown> {
    for (const host of this.hosts) {
      if (host.handlesMethod(call.method)) {
        return await host.handle(call);
      }
    }
    throw new Wave3RouterError(`no host registered for method ${call.method}`);
  }
}
