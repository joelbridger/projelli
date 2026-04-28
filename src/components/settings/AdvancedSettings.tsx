/**
 * AdvancedSettings — placeholder page.
 *
 * Streams populate this with power-user settings and per-feature kill switches
 * as features land. For now it's a shell so the nav item resolves.
 */

export function AdvancedSettings() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">Advanced</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Power-user settings, including per-feature kill switches. Streams populate as features land.
        </p>
      </div>
    </div>
  );
}
