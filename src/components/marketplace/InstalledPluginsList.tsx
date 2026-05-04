/**
 * InstalledPluginsList — STUB. Final implementation lands in Group V of
 * the Stream C4 plan (per-plugin status badges, Disable / Enable /
 * Uninstall / Restart actions, inline error panel for crashed plugins).
 *
 * This stub renders an empty placeholder so the Plugins subtab can mount
 * without errors and the Group III navigation tests pass. Group V replaces
 * the body with the real list backed by `pluginManagerStore`.
 */

export function InstalledPluginsList() {
  return (
    <div
      data-testid="installed-plugins-empty"
      className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground"
    >
      Installed plugins list coming in Group V.
    </div>
  );
}
