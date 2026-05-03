// Plugin manager store.
//
// Tracks the lifecycle state of every installed plugin so the UI can render
// status badges, "Restart plugin" buttons, and error toasts without holding
// references to the actual `PluginWorkerHost` instances. The PluginManager
// (Group VII) is the only writer; UI components in Group VIII read.
//
// Three slices:
//
//   - `installedPlugins`: canonical list of `PluginInstance` records, kept
//     in install-time order. Replaced wholesale by `setInstalled` to keep
//     the manager's in-memory list and the store in lockstep.
//   - `statusByPluginId`: per-plugin lifecycle status. Driven by the manager's
//     state machine: `installed` → `enabled` → `disabled` → `crashed`
//     → `enabled` (after restart) → ... → `uninstalled` (record removed).
//   - `errorsByPluginId`: last-known error message per plugin (null when
//     healthy). Powers the toast surface and the inline error UI in Group
//     VIII's settings page.
//
// The store NEVER touches the worker or the disk. It's a pure state mirror
// so the manager remains the single owner of side effects and the store
// remains trivially mockable in tests.
//
// Plan: docs/superpowers/plans/2026-05-03-stream-c3-plugin-runner.md (task 7.1)

import { create } from 'zustand';

import type { PluginInstance, PluginStatus } from '@/types/plugin';

export interface PluginManagerState {
  /** Canonical list of installed plugins. Manager is the only writer. */
  installedPlugins: PluginInstance[];
  /** Per-plugin lifecycle status. Driven by the manager's state machine. */
  statusByPluginId: Record<string, PluginStatus>;
  /** Last-known error message per plugin, or null when healthy. */
  errorsByPluginId: Record<string, string | null>;

  // Actions ----------------------------------------------------------------

  /** Replace the whole installed list. Recomputes status + error maps if entries are added or removed. */
  setInstalled: (plugins: PluginInstance[]) => void;
  /** Update one plugin's lifecycle status. */
  setStatus: (pluginId: string, status: PluginStatus) => void;
  /** Set or clear one plugin's last error. Pass null to clear. */
  setError: (pluginId: string, error: string | null) => void;
  /** Convenience: clear one plugin's error. */
  clearError: (pluginId: string) => void;
  /** Remove a plugin entirely from the store (after uninstall). */
  removePlugin: (pluginId: string) => void;
}

export const usePluginManagerStore = create<PluginManagerState>()((set) => ({
  installedPlugins: [],
  statusByPluginId: {},
  errorsByPluginId: {},

  setInstalled: (plugins) => {
    set((state) => {
      const nextStatus: Record<string, PluginStatus> = {};
      const nextErrors: Record<string, string | null> = {};
      for (const p of plugins) {
        nextStatus[p.manifest.id] = state.statusByPluginId[p.manifest.id] ?? p.status;
        nextErrors[p.manifest.id] = state.errorsByPluginId[p.manifest.id] ?? p.lastError;
      }
      return {
        installedPlugins: plugins,
        statusByPluginId: nextStatus,
        errorsByPluginId: nextErrors,
      };
    });
  },

  setStatus: (pluginId, status) => {
    set((state) => ({
      statusByPluginId: { ...state.statusByPluginId, [pluginId]: status },
      installedPlugins: state.installedPlugins.map((p) =>
        p.manifest.id === pluginId ? { ...p, status } : p,
      ),
    }));
  },

  setError: (pluginId, error) => {
    set((state) => ({
      errorsByPluginId: { ...state.errorsByPluginId, [pluginId]: error },
      installedPlugins: state.installedPlugins.map((p) =>
        p.manifest.id === pluginId ? { ...p, lastError: error } : p,
      ),
    }));
  },

  clearError: (pluginId) => {
    set((state) => ({
      errorsByPluginId: { ...state.errorsByPluginId, [pluginId]: null },
      installedPlugins: state.installedPlugins.map((p) =>
        p.manifest.id === pluginId ? { ...p, lastError: null } : p,
      ),
    }));
  },

  removePlugin: (pluginId) => {
    set((state) => {
      const nextStatus = { ...state.statusByPluginId };
      const nextErrors = { ...state.errorsByPluginId };
      delete nextStatus[pluginId];
      delete nextErrors[pluginId];
      return {
        installedPlugins: state.installedPlugins.filter((p) => p.manifest.id !== pluginId),
        statusByPluginId: nextStatus,
        errorsByPluginId: nextErrors,
      };
    });
  },
}));

// ----- Selectors ------------------------------------------------------------

/**
 * Return the lifecycle status for a plugin, or `'installed'` if the plugin
 * is unknown (caller may have raced with uninstall). Selectors are exported
 * as standalone functions so React components can use them with
 * `usePluginManagerStore(selectStatus(id))`.
 */
export const selectStatus = (pluginId: string) => (state: PluginManagerState): PluginStatus =>
  state.statusByPluginId[pluginId] ?? 'installed';

/** Return the last-known error for a plugin, or null when healthy. */
export const selectError = (pluginId: string) => (state: PluginManagerState): string | null =>
  state.errorsByPluginId[pluginId] ?? null;

/** Return one plugin's `PluginInstance` record, or undefined if unknown. */
export const selectPlugin =
  (pluginId: string) =>
  (state: PluginManagerState): PluginInstance | undefined =>
    state.installedPlugins.find((p) => p.manifest.id === pluginId);

/** Return all installed plugins. Stable reference until `setInstalled` is called. */
export const selectAllInstalled = (state: PluginManagerState): PluginInstance[] =>
  state.installedPlugins;
