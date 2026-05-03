// Plugin types for the production sandboxed plugin runner (Stream C3).
//
// Mirrors the JSON manifest shape and the PluginAPI surface documented in
// docs/superpowers/specs/2026-04-28-v2.0-mega-release-design.md §6.4.
//
// These are the canonical runtime + API types. The runner, bridge, manifest
// schema, host adapters, and stores all import from here. Keep this file
// dependency-free (no imports from runtime modules) so it can be safely
// imported from worker code without dragging the main-thread bundle along.

import type { FileNode } from '@/types/workspace';

// ----- Manifest --------------------------------------------------------------

/**
 * The 6 declarable permissions a plugin can request in its manifest. All are
 * surfaced to the user on install via the consent dialog (wired by Stream C4).
 *
 * Permissions intentionally narrow per spec §6.4: capabilities like
 * commands/toolbar/sidebar/settings/notify/storage are unconditional and
 * require no permission. Only access that touches user data, AI providers,
 * or the network is gated.
 */
export type PluginPermission =
  | 'workspace:read'
  | 'workspace:write'
  | 'editor:selection'
  | 'editor:write'
  | 'ai:invoke'
  | 'network';

export interface PluginManifestAuthor {
  name: string;
  githubUser?: string;
  url?: string;
}

/**
 * On-disk plugin manifest format. Lives at `<install-root>/<id>/manifest.json`.
 * Validated by `validatePluginManifest` (PluginManifestSchema.ts) on install
 * and on every load.
 */
export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  apiVersion: string;
  author: PluginManifestAuthor;
  description: string;
  /** Path inside the plugin folder to the JS entry. Per spec §6.4: e.g. "index.js". */
  main: string;
  permissions: PluginPermission[];
  minProjelliVersion: string;
  maxProjelliVersion?: string;
  category: string;
  tags: string[];
  screenshots?: string[];
  homepage?: string;
  license?: string;
}

// ----- UI registration specs (passed by plugins to the API) -----------------

export interface ToolbarButtonSpec {
  id: string;
  /** Lucide icon name. Resolved by the host renderer. */
  icon: string;
  tooltip: string;
  /** Command id to invoke on click. Must be a registered command. */
  command: string;
}

/**
 * Spec for a sidebar panel contributed by a plugin. Either `html` (rendered
 * inside a sandboxed iframe per spike memo) or `componentTree` (a serialized
 * description that the host renders with a constrained component vocabulary).
 *
 * v2.0 ships HTML-only; `componentTree` is reserved for v2.1+ and validated
 * but not rendered.
 */
export interface SidebarPanelSpec {
  id: string;
  title: string;
  /** Inline HTML for the panel body. Rendered inside a sandboxed iframe. */
  html?: string;
  /** Reserved for v2.1+. Currently validated but ignored at render time. */
  componentTree?: unknown;
}

/**
 * Settings page schema. Each key is a setting id; value describes the
 * control type plus default, label, and optional choices.
 */
export interface SettingsPageFieldSpec {
  type: 'string' | 'number' | 'boolean' | 'select';
  default: string | number | boolean;
  label: string;
  /** Required when `type === 'select'`. */
  choices?: string[];
}

export interface SettingsPageSpec {
  id: string;
  title: string;
  schema: Record<string, SettingsPageFieldSpec>;
}

export interface CommandSpec {
  id: string;
  /** Optional human-readable label for the command palette. Defaults to id. */
  title?: string;
  /** Optional category for grouping in the command palette. */
  category?: string;
}

// ----- Editor selection shape (returned from editor.getSelection) ------------

/**
 * Editor selection range as returned across the postMessage boundary. Lines
 * and columns are 1-based. Plain object so it survives structured clone.
 */
export interface PluginEditorRange {
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
}

export interface PluginEditorSelection {
  text: string;
  range: PluginEditorRange;
}

// ----- AI invoke shape -------------------------------------------------------

export interface PluginAIInvokeOptions {
  prompt: string;
  system?: string;
}

// ----- Network response shape -----------------------------------------------

/**
 * Serialized fetch response. Body is always materialized (no streaming in
 * v2.0). Binary bodies are base64-encoded; `bodyEncoding` says which.
 */
export interface PluginNetworkResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  bodyEncoding: 'utf-8' | 'base64';
  url: string;
  ok: boolean;
}

// ----- The PluginAPI surface (exposed to plugin code in the worker) --------

/**
 * The full PluginAPI surface from spec §6.4. Implemented inside the worker
 * by the `PluginAPIProxy`, which marshals every call across postMessage.
 *
 * Methods that touch host data are typed as Promises because they round-trip
 * through the bridge. Methods that just register UI (`commands.register`,
 * `toolbar.addButton`, etc.) are fire-and-forget and return void; the bridge
 * surfaces failures asynchronously via the `error` message variant.
 */
export interface PluginAPI {
  readonly pluginId: string;
  readonly version: string;

  commands: {
    register(id: string, handler: (payload?: unknown) => unknown): void;
    invoke(id: string, payload?: unknown): Promise<unknown>;
  };

  toolbar: {
    addButton(spec: ToolbarButtonSpec): void;
    removeButton(id: string): void;
  };

  sidebar: {
    addPanel(spec: SidebarPanelSpec): void;
    removePanel(id: string): void;
  };

  editor: {
    getSelection(): Promise<PluginEditorSelection | null>;
    getContent(): Promise<string>;
    replaceSelection(text: string): Promise<void>;
    insertAtCursor(text: string): Promise<void>;
  };

  workspace: {
    listFiles(path?: string): Promise<FileNode[]>;
    readFile(path: string): Promise<string>;
    writeFile(path: string, content: string): Promise<void>;
  };

  ai: {
    invoke(opts: PluginAIInvokeOptions): Promise<string>;
  };

  storage: {
    get(key: string): Promise<unknown>;
    set(key: string, value: unknown): Promise<void>;
    remove(key: string): Promise<void>;
  };

  network: {
    fetch(url: string, opts?: RequestInit): Promise<PluginNetworkResponse>;
  };

  settings: {
    addPage(spec: SettingsPageSpec): void;
    get(key: string): Promise<unknown>;
    set(key: string, value: unknown): Promise<void>;
  };

  notify: {
    info(msg: string): void;
    warn(msg: string): void;
    error(msg: string): void;
  };
}

/**
 * Default export shape a plugin's `index.js` must provide. `activate` is
 * called once per worker lifetime. `deactivate` is optional and called
 * before the worker is terminated on disable / uninstall / update.
 */
export interface PluginModule {
  activate(api: PluginAPI): void | Promise<void>;
  deactivate?(): void | Promise<void>;
}

// ----- Runtime / lifecycle types --------------------------------------------

/**
 * Lifecycle status for an installed plugin. Drives status badges in the UI
 * and conditional logic in PluginManager.
 *
 * - `installed`: present on disk, manifest validated, but worker not running.
 * - `enabled`: worker spawned and `activate` resolved. Plugin is live.
 * - `disabled`: explicitly disabled by the user; on-disk install retained.
 * - `crashed`: worker errored; user-visible Restart button surfaces.
 * - `updating`: transient state during `update(...)` flow.
 */
export type PluginStatus =
  | 'installed'
  | 'enabled'
  | 'disabled'
  | 'crashed'
  | 'updating';

/**
 * In-memory record of one installed plugin. The PluginManager owns the
 * canonical list. The `worker` field is present only when status is
 * `enabled` or `crashed` (post-spawn); for `installed`/`disabled` it's
 * undefined.
 */
export interface PluginInstance {
  manifest: PluginManifest;
  status: PluginStatus;
  /** Absolute path to the plugin's install dir on disk. */
  installPath: string;
  /** Last known error message (e.g. crash reason). Null when healthy. */
  lastError: string | null;
  /** ISO timestamp of install. */
  installedAt: string;
  /** ISO timestamp of last enable transition. Null if never enabled. */
  enabledAt: string | null;
}
