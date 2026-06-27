/**
 * SettingsGearButton — the top-right gear in the newNav (3-tab IA) shell.
 *
 * Jameson's decision (2026-06-27): the gear is a single direct action that
 * OPENS THE SETTINGS SCREEN. It is no longer a dropdown of separate items.
 * Privacy Center + Activity Log are nested as SECTIONS inside the Settings
 * screen (see SettingsContent `extraSections` + AppSurfaceRouter); Email +
 * Documents stay reachable from the Client Map's per-client quick actions.
 *
 * The always-on egress/privacy badge stays in the TrustBar — it never moved.
 *
 * Keeps the stable `settings-gear` testid (used by the feature tour and the
 * test suite) and the same icon-button styling the gear has always had.
 */
import { Settings } from 'lucide-react';

export interface SettingsGearButtonProps {
  /** Open the full-page Settings screen (Privacy Center + Activity Log nest there). */
  onOpenSettings: () => void;
  /**
   * True when the Settings screen is the active surface. Gives the gear a
   * "you are here" pressed state + aria-current, since Settings is not a rail
   * tab in the 3-tab IA and would otherwise leave no active-nav cue.
   */
  active?: boolean;
}

export function SettingsGearButton({ onOpenSettings, active = false }: SettingsGearButtonProps) {
  const label = 'Settings';
  return (
    <button
      type="button"
      data-testid="settings-gear"
      title={`${label} (Ctrl+,)`}
      aria-label={label}
      aria-current={active ? 'page' : undefined}
      onClick={onOpenSettings}
      className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
      style={{ border: 0, background: active ? 'var(--kp-side-active-bg)' : 'transparent', cursor: 'pointer' }}
    >
      <Settings className="h-4 w-4" />
    </button>
  );
}
