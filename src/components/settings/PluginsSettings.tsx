/**
 * PluginsSettings — placeholder page.
 *
 * Stream C will populate this with the installed-plugins management UI.
 * For now it's a shell so the nav item resolves.
 */

export function PluginsSettings() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">Plugins</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Installed plugins. Stream C will populate this page.
        </p>
      </div>
    </div>
  );
}
