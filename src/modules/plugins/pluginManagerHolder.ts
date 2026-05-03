// Plugin runner — global singleton holder for the active PluginManager.
//
// The PluginManager is constructed inside App.tsx (one per workspace open;
// disposed on workspace close). UI components like the toolbar, sidebar
// panel renderer, command palette, and settings page need to invoke commands
// on the same manager instance without prop-drilling. Rather than threading
// the instance through every component tree, we expose a tiny holder.
//
// Why a module-level singleton instead of React context: the hosts (and the
// audit/registry stores) are already global; the manager is the binding glue
// for those globals and naturally shares their scope. Tests construct a
// manager directly and either pass it to the holder or skip it.
//
// Plan: docs/superpowers/plans/2026-05-03-stream-c3-plugin-runner.md (task 8.5)

import type { PluginManager } from './PluginManager';

let activeManager: PluginManager | null = null;

/** Set the currently-active manager. Pass `null` to clear (workspace close). */
export function setActivePluginManager(manager: PluginManager | null): void {
  activeManager = manager;
}

/** Read the currently-active manager, or `null` if none has been set. */
export function getActivePluginManager(): PluginManager | null {
  return activeManager;
}
