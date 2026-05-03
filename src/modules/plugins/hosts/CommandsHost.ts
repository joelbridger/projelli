// Plugin runner — Commands host adapter.
//
// Two responsibilities:
//
//   1. `register-command` flow. The bridge's `onRegisterCommand` hook fires
//      when a plugin's worker posts a `register-command` message. This host
//      records the command in `pluginRegistryStore` so the rest of the app
//      (toolbar, command palette, sidebar buttons) can render it.
//
//   2. `commands.invoke` flow. Plugins can call `api.commands.invoke(id)` to
//      run another registered command (potentially in a different plugin).
//      That request reaches `dispatch({ pluginId, method, args })`. The host
//      looks the command up in the registry, then delegates to a
//      `commandInvoker` callback the PluginManager (Group VII) wires. Until
//      the manager exists, the invoker is left unset and the dispatch returns
//      a `not-found` error code.
//
// The host adapter never directly calls a JS handler because plugin command
// handlers live inside their owning worker. The actual cross-worker invoke
// is `pluginManager.invokeCommand(pluginId, commandId, payload)`.
//
// Spec: docs/superpowers/specs/2026-04-28-v2.0-mega-release-design.md §6.4
// Plan: docs/superpowers/plans/2026-05-03-stream-c3-plugin-runner.md (task 4.2)

import {
  usePluginRegistryStore,
  type RegisteredCommand,
} from '@/stores/pluginRegistryStore';

import type { PluginApiDispatchCall } from '../PluginAPIBridge';

/**
 * Cross-plugin command invoker. The PluginManager (Group VII) supplies one
 * that reaches into the owning plugin's bridge and calls
 * `bridge.invokeCommand(commandId, payload)`. The host is intentionally
 * decoupled so it can be unit-tested without a full PluginManager.
 */
export type PluginCommandInvoker = (
  ownerPluginId: string,
  commandId: string,
  payload: unknown,
) => Promise<unknown>;

/**
 * Coded error thrown by the host when a request can't be served. The bridge
 * surfaces the `code` field on the error message so the calling plugin sees
 * a structured failure (`not-found` / `invalid-args`).
 */
export class CommandsHostError extends Error {
  readonly code: 'not-found' | 'invalid-args';
  constructor(code: 'not-found' | 'invalid-args', message: string) {
    super(message);
    this.code = code;
    this.name = 'CommandsHostError';
  }
}

export interface CommandsHostOptions {
  /**
   * Optional invoker the host calls to dispatch `commands.invoke` requests
   * across worker boundaries. If absent at call time, dispatch returns a
   * `not-found` error so the calling plugin gets a clear failure rather
   * than a hang.
   */
  commandInvoker?: PluginCommandInvoker;
}

/**
 * CommandsHost wires the registry store and `commands.invoke` dispatch.
 * Construct one per workspace; share across all plugin bridges.
 */
export class CommandsHost {
  private commandInvoker: PluginCommandInvoker | undefined;

  constructor(options: CommandsHostOptions = {}) {
    if (options.commandInvoker) {
      this.commandInvoker = options.commandInvoker;
    }
  }

  /**
   * Replace the cross-plugin invoker. Used by PluginManager once its bridge
   * map is populated (the manager constructs the host first, then registers
   * the invoker). Pass `undefined` to clear (test teardown).
   */
  setCommandInvoker(invoker: PluginCommandInvoker | undefined): void {
    this.commandInvoker = invoker;
  }

  /**
   * Handler for the bridge `onRegisterCommand` hook. Records the command in
   * the registry under the owning plugin id.
   */
  handleRegisterCommand(
    pluginId: string,
    commandId: string,
    meta: { title?: string; category?: string },
  ): void {
    if (!commandId) {
      throw new CommandsHostError('invalid-args', 'commandId must be a non-empty string');
    }
    const spec: { id: string; title?: string; category?: string } = { id: commandId };
    if (meta.title !== undefined) spec.title = meta.title;
    if (meta.category !== undefined) spec.category = meta.category;
    usePluginRegistryStore.getState().registerCommand(pluginId, spec);
  }

  /**
   * Predicate the dispatch coordinator uses to know which methods this host
   * owns. Currently only `commands.invoke` (since `commands.register` flows
   * via its own message variant, not as an `api-call`).
   */
  handlesMethod(method: string): boolean {
    return method === 'commands.invoke';
  }

  /**
   * Dispatch handler. Returns whatever the invoked command resolves with.
   * Throws a `CommandsHostError` with code `not-found` when the command
   * isn't registered or the invoker isn't wired yet.
   */
  async handle(call: PluginApiDispatchCall): Promise<unknown> {
    if (call.method !== 'commands.invoke') {
      throw new CommandsHostError('invalid-args', `CommandsHost cannot handle method ${call.method}`);
    }
    const [commandId, payload] = call.args as [unknown, unknown];
    if (typeof commandId !== 'string' || commandId.length === 0) {
      throw new CommandsHostError(
        'invalid-args',
        'commands.invoke requires a non-empty commandId',
      );
    }
    const registered: RegisteredCommand | undefined = usePluginRegistryStore
      .getState()
      .commands.get(commandId);
    if (!registered) {
      throw new CommandsHostError('not-found', `command not registered: ${commandId}`);
    }
    if (!this.commandInvoker) {
      throw new CommandsHostError(
        'not-found',
        `no command invoker wired (cannot dispatch ${commandId} owned by ${registered.pluginId})`,
      );
    }
    return this.commandInvoker(registered.pluginId, commandId, payload);
  }
}
