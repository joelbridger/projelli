// Plugin runner message protocol — encode / decode / type guard.
//
// JSON serialization for messages exchanged between the main-thread bridge
// (`PluginAPIBridge`) and the worker-side runtime (`PluginRuntime`). The
// production runner uses JSON rather than relying on structured-clone
// directly because (a) it forces us to surface non-cloneable values (Functions,
// Symbols, circular refs) at the boundary instead of letting them silently
// drop, (b) it keeps the protocol inspectable for debugging, and (c) it
// matches the spike's contract so audit + test patterns carry forward.
//
// Spec: docs/superpowers/specs/2026-04-28-v2.0-mega-release-design.md §6.4 + §6.5
// Plan: docs/superpowers/plans/2026-05-03-stream-c3-plugin-runner.md (task 1.3)

import type {
  PluginPermission,
  SidebarPanelSpec,
  SettingsPageSpec,
  ToolbarButtonSpec,
} from '@/types/plugin';

// ----- API method registry --------------------------------------------------

/**
 * Set of API method names that flow as `api-call` messages. Bridge consults
 * this string to look up the required permission (if any) and the host
 * adapter that handles the call.
 *
 * Methods omitted here (notably `commands.register`, `toolbar.add/remove`,
 * `sidebar.add/remove-panel`, `settings.addPage`, `notify.*`) flow as their
 * own dedicated message variants below, not as `api-call`.
 */
export type PluginAPIMethod =
  | 'editor.getSelection'
  | 'editor.getContent'
  | 'editor.replaceSelection'
  | 'editor.insertAtCursor'
  | 'workspace.listFiles'
  | 'workspace.readFile'
  | 'workspace.writeFile'
  | 'ai.invoke'
  | 'storage.get'
  | 'storage.set'
  | 'storage.remove'
  | 'network.fetch'
  | 'commands.invoke'
  | 'settings.get'
  | 'settings.set';

/**
 * Structured error shape returned across the boundary. `code` is a stable
 * machine-readable identifier; `message` is human-readable. Same shape as
 * the spike's SpikeError so callers can keep the same handling.
 */
export interface PluginErrorPayload {
  code:
    | 'permission-denied'
    | 'unknown-command'
    | 'unknown-method'
    | 'plugin-threw'
    | 'unloaded'
    | 'invalid-message'
    | 'invalid-args'
    | 'not-found'
    | 'internal';
  message: string;
  /** Optional stack trace from the worker side. */
  stack?: string;
}

// ----- Message variants -----------------------------------------------------
//
// Every message carries a correlation `id` so request/response pairs can be
// matched. For one-way messages (e.g. `notify`, `panel-render`) the id still
// uniquely identifies the message for logging.

interface PluginMessageBase {
  id: string;
}

/** Main → worker. Hand off the plugin script to the runtime. */
export interface PluginInitMessage extends PluginMessageBase {
  type: 'init';
  pluginId: string;
  /** From manifest.version. Surfaced on the api proxy. */
  version: string;
  /** Plugin source code as a string. The runtime turns this into a blob URL and dynamic-imports it. */
  pluginCode: string;
  /** Permissions granted to this plugin instance. Surfaced to the runtime so plugin code can introspect. */
  permissions: PluginPermission[];
}

/** Worker → main. Plugin registered a command. Main records it for invokes. */
export interface PluginRegisterCommandMessage extends PluginMessageBase {
  type: 'register-command';
  commandId: string;
  /** Optional human label for command palette display. */
  title?: string;
  /** Optional category for grouping. */
  category?: string;
}

/** Main → worker. Invoke a previously-registered command. */
export interface PluginInvokeCommandMessage extends PluginMessageBase {
  type: 'invoke-command';
  commandId: string;
  payload?: unknown;
}

/** Worker → main. Result of an `invoke-command`. */
export interface PluginCommandResultMessage extends PluginMessageBase {
  type: 'command-result';
  /** Correlates back to the originating `invoke-command` id. */
  inResponseTo: string;
  result: unknown;
}

/** Worker → main. Plugin called an API method. Bridge enforces permissions. */
export interface PluginApiCallMessage extends PluginMessageBase {
  type: 'api-call';
  method: PluginAPIMethod;
  args: unknown[];
}

/** Main → worker. Result of an API call. */
export interface PluginApiResultMessage extends PluginMessageBase {
  type: 'api-result';
  /** Correlates back to the originating `api-call` id. */
  inResponseTo: string;
  result: unknown;
}

/** Either direction. Structured failure carrying a PluginErrorPayload. */
export interface PluginErrorMessage extends PluginMessageBase {
  type: 'error';
  /** Optional correlation to the request that triggered the error. */
  inResponseTo?: string;
  error: PluginErrorPayload;
}

/** Worker → main. Plugin asked the host to render a sidebar panel inline. */
export interface PluginPanelRenderMessage extends PluginMessageBase {
  type: 'panel-render';
  panelId: string;
  /** HTML body to render inside the sandboxed iframe. */
  html: string;
}

/** Worker → main. Plugin contributes a toolbar button. */
export interface PluginToolbarAddMessage extends PluginMessageBase {
  type: 'toolbar-add';
  spec: ToolbarButtonSpec;
}

/** Worker → main. Plugin removes a previously-contributed toolbar button. */
export interface PluginToolbarRemoveMessage extends PluginMessageBase {
  type: 'toolbar-remove';
  buttonId: string;
}

/** Worker → main. Plugin contributes a sidebar panel. */
export interface PluginSidebarAddPanelMessage extends PluginMessageBase {
  type: 'sidebar-add-panel';
  spec: SidebarPanelSpec;
}

/** Worker → main. Plugin removes a previously-contributed sidebar panel. */
export interface PluginSidebarRemovePanelMessage extends PluginMessageBase {
  type: 'sidebar-remove-panel';
  panelId: string;
}

/** Worker → main. Plugin contributes a settings page. */
export interface PluginSettingsAddPageMessage extends PluginMessageBase {
  type: 'settings-add-page';
  spec: SettingsPageSpec;
}

/** Worker → main. Plugin emitted a user-facing notification. */
export interface PluginNotifyMessage extends PluginMessageBase {
  type: 'notify';
  level: 'info' | 'warn' | 'error';
  message: string;
}

/**
 * Discriminated union of every message exchanged between bridge and runtime.
 * The `type` field is the discriminant.
 */
export type PluginMessage =
  | PluginInitMessage
  | PluginRegisterCommandMessage
  | PluginInvokeCommandMessage
  | PluginCommandResultMessage
  | PluginApiCallMessage
  | PluginApiResultMessage
  | PluginErrorMessage
  | PluginPanelRenderMessage
  | PluginToolbarAddMessage
  | PluginToolbarRemoveMessage
  | PluginSidebarAddPanelMessage
  | PluginSidebarRemovePanelMessage
  | PluginSettingsAddPageMessage
  | PluginNotifyMessage;

export type PluginMessageType = PluginMessage['type'];

const VALID_TYPES: ReadonlySet<PluginMessageType> = new Set<PluginMessageType>([
  'init',
  'register-command',
  'invoke-command',
  'command-result',
  'api-call',
  'api-result',
  'error',
  'panel-render',
  'toolbar-add',
  'toolbar-remove',
  'sidebar-add-panel',
  'sidebar-remove-panel',
  'settings-add-page',
  'notify',
]);

/**
 * Encode a PluginMessage to a wire string. Throws if the message is missing
 * the discriminator, has an unknown type, or has a non-string `id`.
 *
 * JSON.stringify silently drops Functions and Symbols, so we pre-validate
 * the obvious shape before encoding. Anything that survives this gate and
 * still serializes weirdly is a programmer bug, not a runtime concern.
 */
export function encode(msg: PluginMessage): string {
  // Cast to a shape-erased view so the defensive checks survive even when a
  // caller bypasses the static typing (tests, JS plugin code at the runtime
  // boundary, etc.). Without this the strict-typed parameter would mark the
  // null check as "always falsy" at lint time.
  const view = msg as unknown as { id?: unknown; type?: unknown } | null | undefined;
  if (!view || typeof view !== 'object') {
    throw new Error('PluginMessageProtocol.encode: message must be an object');
  }
  if (typeof view.id !== 'string') {
    throw new Error('PluginMessageProtocol.encode: message.id must be a string');
  }
  const type = view.type;
  if (typeof type !== 'string' || !VALID_TYPES.has(type as PluginMessageType)) {
    throw new Error(`PluginMessageProtocol.encode: unknown message type ${typeof type === 'string' ? type : String(type)}`);
  }
  return JSON.stringify(msg);
}

/**
 * Decode a wire string into a PluginMessage. Throws on malformed JSON or
 * unknown message type. Caller can then narrow on `msg.type` because it's a
 * discriminated union.
 */
export function decode(raw: unknown): PluginMessage {
  if (typeof raw !== 'string') {
    throw new Error('PluginMessageProtocol.decode: raw input must be a string');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`PluginMessageProtocol.decode: invalid JSON (${(err as Error).message})`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('PluginMessageProtocol.decode: parsed value must be an object');
  }
  const obj = parsed as Record<string, unknown>;
  const id = obj['id'];
  const type = obj['type'];
  if (typeof id !== 'string') {
    throw new Error('PluginMessageProtocol.decode: message.id must be a string');
  }
  if (typeof type !== 'string' || !VALID_TYPES.has(type as PluginMessageType)) {
    throw new Error(`PluginMessageProtocol.decode: unknown message type ${String(type)}`);
  }
  return parsed as PluginMessage;
}

/**
 * Type guard: cheap runtime check for "this looks like a PluginMessage".
 * Intended for hot paths where throwing in `decode` is too expensive.
 */
export function isPluginMessage(value: unknown): value is PluginMessage {
  if (!value || typeof value !== 'object') return false;
  const obj = value as Record<string, unknown>;
  const id = obj['id'];
  const type = obj['type'];
  return typeof id === 'string' && typeof type === 'string' && VALID_TYPES.has(type as PluginMessageType);
}
