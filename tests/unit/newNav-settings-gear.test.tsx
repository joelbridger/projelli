/**
 * SettingsGearButton (newNav) — the top-right gear in the 3-tab IA shell.
 *
 * Jameson's decision (2026-06-27): the gear is no longer a dropdown that lists
 * Settings / Privacy Center / Activity Log / Email / Documents as separate
 * items. It is now a plain button that OPENS THE SETTINGS SCREEN directly;
 * Privacy Center + Activity Log live as sections INSIDE that screen, and
 * Email + Documents stay reachable from the Client Map. The always-on
 * egress/privacy badge stays in the TrustBar (not tested here — it never moved).
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';
import { SettingsGearButton } from '@/app/shell/layout/SettingsGearButton';

afterEach(() => { cleanup(); });

describe('SettingsGearButton (newNav)', () => {
  it('renders the gear with the stable settings-gear testid', () => {
    render(<SettingsGearButton onOpenSettings={vi.fn()} />);
    expect(screen.getByTestId('settings-gear')).toBeTruthy();
  });

  it('opens Settings on click (single direct action, not a menu)', () => {
    const onOpenSettings = vi.fn();
    render(<SettingsGearButton onOpenSettings={onOpenSettings} />);
    fireEvent.click(screen.getByTestId('settings-gear'));
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });

  it('does NOT expose Privacy / Activity / Email / Documents as gear items', () => {
    render(<SettingsGearButton onOpenSettings={vi.fn()} />);
    fireEvent.click(screen.getByTestId('settings-gear'));
    // No dropdown opens — those surfaces now live in Settings / the Client Map.
    expect(screen.queryByTestId('spine-nav-privacy')).toBeNull();
    expect(screen.queryByTestId('spine-nav-audit')).toBeNull();
    expect(screen.queryByTestId('spine-nav-email')).toBeNull();
    expect(screen.queryByTestId('spine-nav-files')).toBeNull();
  });

  it('exposes an accessible label so the icon-only button is reachable', () => {
    render(<SettingsGearButton onOpenSettings={vi.fn()} />);
    expect(screen.getByTestId('settings-gear').getAttribute('aria-label')).toBeTruthy();
  });

  it('shows a "you are here" active state (aria-current) when Settings is the active surface', () => {
    const { rerender } = render(<SettingsGearButton onOpenSettings={vi.fn()} />);
    // Not on Settings → no active cue.
    expect(screen.getByTestId('settings-gear').hasAttribute('aria-current')).toBe(false);
    // On Settings → aria-current="page".
    rerender(<SettingsGearButton onOpenSettings={vi.fn()} active />);
    expect(screen.getByTestId('settings-gear').getAttribute('aria-current')).toBe('page');
  });
});
