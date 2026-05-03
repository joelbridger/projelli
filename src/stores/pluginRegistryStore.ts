// Plugin registry store.
//
// Holds the per-plugin UI contributions (commands, toolbar buttons, sidebar
// panels, settings pages) so the rest of the app can render them without
// holding a reference to any individual plugin's bridge.
//
// Adapters (`CommandsHost`, `ToolbarHost`, `SidebarHost`, `SettingsHost` in
// Group IV; `ToolbarHost`/`SidebarHost` extended in Group V) call the
// register/add actions in response to bridge hooks. UI components in Group
// VIII subscribe to the slices they need.
//
// Plan: docs/superpowers/plans/2026-05-03-stream-c3-plugin-runner.md (task 4.1)

import { create } from 'zustand';

import type {
  CommandSpec,
  SettingsPageSpec,
  SidebarPanelSpec,
  ToolbarButtonSpec,
} from '@/types/plugin';

/**
 * A registered command. Plugin handlers live inside the worker, not in JS
 * memory on the main thread, so we record only the owning plugin id and
 * descriptive metadata. `PluginManager.invokeCommand(pluginId, commandId)`
 * is the resolution path used by the toolbar / command palette.
 */
export interface RegisteredCommand {
  pluginId: string;
  commandId: string;
  /** Optional human label (defaults to commandId at render time). */
  title?: string;
  /** Optional command-palette grouping. */
  category?: string;
}

/** Toolbar button + the plugin that contributed it. */
export interface RegisteredToolbarButton extends ToolbarButtonSpec {
  pluginId: string;
}

/** Sidebar panel + the plugin that contributed it. */
export interface RegisteredSidebarPanel extends SidebarPanelSpec {
  pluginId: string;
}

/** Settings page + the plugin that contributed it. */
export interface RegisteredSettingsPage extends SettingsPageSpec {
  pluginId: string;
}

export interface PluginRegistryState {
  commands: Map<string, RegisteredCommand>;
  toolbar: RegisteredToolbarButton[];
  sidebar: RegisteredSidebarPanel[];
  settingsPages: RegisteredSettingsPage[];

  // Commands ----------------------------------------------------------------

  /**
   * Register or replace a command. Idempotent: a second call with the same
   * commandId overwrites the previous entry. The expected use is one-per-id
   * per plugin lifetime; cross-plugin id collisions log and the later wins.
   */
  registerCommand: (pluginId: string, spec: CommandSpec) => void;
  /** Remove a command. Idempotent (no-op if missing). */
  unregisterCommand: (commandId: string) => void;

  // Toolbar -----------------------------------------------------------------

  /** Add or replace a toolbar button (idempotent on `id`). */
  addToolbarButton: (pluginId: string, spec: ToolbarButtonSpec) => void;
  /** Remove a toolbar button by id. Idempotent. */
  removeToolbarButton: (buttonId: string) => void;

  // Sidebar -----------------------------------------------------------------

  /** Add or replace a sidebar panel (idempotent on `id`). */
  addSidebarPanel: (pluginId: string, spec: SidebarPanelSpec) => void;
  /** Remove a sidebar panel by id. Idempotent. */
  removeSidebarPanel: (panelId: string) => void;

  // Settings ----------------------------------------------------------------

  /** Add or replace a settings page (idempotent on `id`). */
  addSettingsPage: (pluginId: string, spec: SettingsPageSpec) => void;
  /** Remove a settings page by id. Idempotent. */
  removeSettingsPage: (pageId: string) => void;

  // Per-plugin teardown ----------------------------------------------------

  /**
   * Remove every contribution owned by `pluginId`. Called on disable and
   * uninstall (and as a safety net during update).
   */
  clearForPlugin: (pluginId: string) => void;
}

export const usePluginRegistryStore = create<PluginRegistryState>()((set) => ({
  commands: new Map(),
  toolbar: [],
  sidebar: [],
  settingsPages: [],

  registerCommand: (pluginId, spec) => {
    set((state) => {
      const next = new Map(state.commands);
      const entry: RegisteredCommand = {
        pluginId,
        commandId: spec.id,
        ...(spec.title !== undefined ? { title: spec.title } : {}),
        ...(spec.category !== undefined ? { category: spec.category } : {}),
      };
      next.set(spec.id, entry);
      return { commands: next };
    });
  },

  unregisterCommand: (commandId) => {
    set((state) => {
      if (!state.commands.has(commandId)) return state;
      const next = new Map(state.commands);
      next.delete(commandId);
      return { commands: next };
    });
  },

  addToolbarButton: (pluginId, spec) => {
    set((state) => {
      const filtered = state.toolbar.filter((b) => b.id !== spec.id);
      return { toolbar: [...filtered, { ...spec, pluginId }] };
    });
  },

  removeToolbarButton: (buttonId) => {
    set((state) => ({
      toolbar: state.toolbar.filter((b) => b.id !== buttonId),
    }));
  },

  addSidebarPanel: (pluginId, spec) => {
    set((state) => {
      const filtered = state.sidebar.filter((p) => p.id !== spec.id);
      return { sidebar: [...filtered, { ...spec, pluginId }] };
    });
  },

  removeSidebarPanel: (panelId) => {
    set((state) => ({
      sidebar: state.sidebar.filter((p) => p.id !== panelId),
    }));
  },

  addSettingsPage: (pluginId, spec) => {
    set((state) => {
      const filtered = state.settingsPages.filter((p) => p.id !== spec.id);
      return { settingsPages: [...filtered, { ...spec, pluginId }] };
    });
  },

  removeSettingsPage: (pageId) => {
    set((state) => ({
      settingsPages: state.settingsPages.filter((p) => p.id !== pageId),
    }));
  },

  clearForPlugin: (pluginId) => {
    set((state) => {
      const nextCommands = new Map<string, RegisteredCommand>();
      for (const [id, cmd] of state.commands) {
        if (cmd.pluginId !== pluginId) nextCommands.set(id, cmd);
      }
      return {
        commands: nextCommands,
        toolbar: state.toolbar.filter((b) => b.pluginId !== pluginId),
        sidebar: state.sidebar.filter((p) => p.pluginId !== pluginId),
        settingsPages: state.settingsPages.filter((p) => p.pluginId !== pluginId),
      };
    });
  },
}));
