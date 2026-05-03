// Plugin Runner Sandbox Spike — types
//
// Spike-only types for the Stream C2 plugin runner sandbox spike. These are
// intentionally narrow: one permission, a small API surface, a discriminated
// union of message variants exchanged between the main thread (bridge) and
// the worker (runtime). Production runner types live elsewhere; nothing here
// is meant to ship.
//
// Spec: docs/superpowers/specs/2026-04-28-v2.0-mega-release-design.md §6.3
// Plan: docs/superpowers/plans/2026-05-03-stream-c2-plugin-spike.md

/**
 * Single permission used by the spike. Sufficient to demonstrate the
 * permission-enforcement flow (criterion #6). The production runner will
 * have a richer permission set.
 */
export type SpikePermission = 'editor:selection';

/**
 * Methods on the SpikeAPI that require a permission check at the bridge.
 * The bridge keys denial decisions off this string. Methods not in this
 * map (e.g. `notify.info`) are always allowed.
 */
export type SpikeAPIMethod =
  | 'commands.register'
  | 'editor.getSelection'
  | 'workspace.readFile'
  | 'notify.info'
  | 'sidebar.addPanel';

/**
 * Structured spec for a sidebar panel emitted by a plugin and rendered by
 * the main-thread harness. Limited to plain HTML for the spike.
 */
export interface SpikePanelSpec {
  id: string;
  title: string;
  html: string;
}

/**
 * The API surface exposed to plugin code inside the worker. Each method
 * marshals across the postMessage boundary as an `api-call` and resolves
 * when the corresponding `api-result` arrives.
 */
export interface SpikeAPI {
  commands: {
    register(commandId: string, handler: (payload?: unknown) => unknown | Promise<unknown>): void;
  };
  editor: {
    getSelection(): Promise<string>;
  };
  workspace: {
    readFile(path: string): Promise<string>;
  };
  notify: {
    info(message: string): Promise<void>;
  };
  sidebar: {
    addPanel(spec: SpikePanelSpec): Promise<void>;
  };
}

/**
 * Structured error shape returned across the boundary. `code` is a stable
 * machine-readable identifier; `message` is human-readable.
 */
export interface SpikeError {
  code: 'permission-denied' | 'unknown-command' | 'plugin-threw' | 'unloaded' | 'invalid-message' | 'internal';
  message: string;
  /** Optional stack trace from the worker side. */
  stack?: string;
}

// ----- Message variants ------------------------------------------------------
//
// Every message carries a correlation `id` so request/response pairs can be
// matched. For one-way messages (e.g. `notify`, `panel-render`) the id still
// uniquely identifies the message for logging.

interface SpikeMessageBase {
  id: string;
}

/** Main → worker. Hand off the plugin script to the runtime. */
export interface SpikeInitMessage extends SpikeMessageBase {
  type: 'init';
  /** Plugin source code as a string. The runtime turns this into a blob URL and dynamic-imports it. */
  pluginCode: string;
  /** Permissions granted to this plugin instance. Surfaced to plugin code if it asks. */
  permissions: SpikePermission[];
}

/** Worker → main. Plugin registered a command. Main records it for invokes. */
export interface SpikeRegisterCommandMessage extends SpikeMessageBase {
  type: 'register-command';
  commandId: string;
}

/** Main → worker. Invoke a previously-registered command. */
export interface SpikeInvokeCommandMessage extends SpikeMessageBase {
  type: 'invoke-command';
  commandId: string;
  payload?: unknown;
}

/** Worker → main. Result of an `invoke-command`. */
export interface SpikeCommandResultMessage extends SpikeMessageBase {
  type: 'command-result';
  /** Correlates back to the originating `invoke-command` id. */
  inResponseTo: string;
  result: unknown;
}

/** Worker → main. Plugin called an API method. Bridge enforces permissions. */
export interface SpikeApiCallMessage extends SpikeMessageBase {
  type: 'api-call';
  method: SpikeAPIMethod;
  args: unknown[];
}

/** Main → worker. Result of an API call. */
export interface SpikeApiResultMessage extends SpikeMessageBase {
  type: 'api-result';
  /** Correlates back to the originating `api-call` id. */
  inResponseTo: string;
  result: unknown;
}

/** Worker → main. Plugin asked the host to render a sidebar panel. */
export interface SpikePanelRenderMessage extends SpikeMessageBase {
  type: 'panel-render';
  spec: SpikePanelSpec;
}

/** Worker → main. Plugin emitted an info-level notification. */
export interface SpikeNotifyMessage extends SpikeMessageBase {
  type: 'notify';
  level: 'info';
  message: string;
}

/** Either direction. Structured failure carrying a SpikeError. */
export interface SpikeErrorMessage extends SpikeMessageBase {
  type: 'error';
  /** Optional correlation to the request that triggered the error. */
  inResponseTo?: string;
  error: SpikeError;
}

/**
 * Discriminated union of every message exchanged between bridge and runtime.
 * The `type` field is the discriminant.
 */
export type SpikeMessage =
  | SpikeInitMessage
  | SpikeRegisterCommandMessage
  | SpikeInvokeCommandMessage
  | SpikeCommandResultMessage
  | SpikeApiCallMessage
  | SpikeApiResultMessage
  | SpikePanelRenderMessage
  | SpikeNotifyMessage
  | SpikeErrorMessage;

export type SpikeMessageType = SpikeMessage['type'];

/**
 * Per-criterion result reported by the harness. Mirrors the spike acceptance
 * criteria table in the plan. Bridge + runtime don't depend on this; it's
 * here so the harness UI and tests share a single shape.
 */
export interface SpikeResult {
  criterionId: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
  status: 'idle' | 'running' | 'pass' | 'fail';
  details: string;
  metrics?: Record<string, number>;
}
