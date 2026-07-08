/**
 * Phase 5.1 — solo license recovery without an account.
 *
 * A solo buyer has no account, so recovery across devices (after a reinstall or
 * a new machine) is "re-enter the license code you kept". The mechanism already
 * exists: useLicense.activate() POSTs { license_key, machine_id } to the
 * validator, no login. These tests pin that the Account window surfaces this as
 * an explicit, discoverable "restore on this computer" recovery affordance, and
 * that re-entering the code drives the existing activate() path. Voice: no em dash.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BRAND } from '@/config/brand';

const EM_DASH = '—';

const lic = vi.hoisted(() => ({
  activate: vi.fn(async () => ({ success: true })),
}));

vi.mock('@/platform/hooks/useLicense', () => ({
  useLicense: () => ({
    tier: 'free',
    packs: [],
    seats: 1,
    isLoading: false,
    isActivated: false,
    expiresAt: null,
    error: null,
    purchasedAt: null,
    isOffline: false,
    lastKnownGoodAt: null,
    activate: lic.activate,
    deactivate: vi.fn(),
    refresh: vi.fn(),
  }),
}));
vi.mock('@/platform/hooks/useTrial', () => ({
  useTrial: () => ({
    firstLaunchAt: new Date('2026-06-01T00:00:00Z'),
    daysElapsed: 5,
    daysRemaining: 25,
    isExpired: false,
    trialDays: 30,
  }),
}));
vi.mock('@/platform/hooks/useEntitlement', () => ({
  useEntitlement: () => ({ state: 'trial', isGrandfathered: false }),
}));
vi.mock('@/platform/licensing', () => ({
  entitlementMessage: () => ({ headline: '', body: '' }),
}));
// Heavy children unrelated to the recovery affordance — stub them out.
vi.mock('@/features/settings/PricingTiers', () => ({ PricingTiers: () => null }));
vi.mock('@/features/ask/CostDashboard', () => ({ CostDashboard: () => null }));

import { LicenseSettings } from '@/features/settings/LicenseSettings';

describe('Solo license recovery (Phase 5.1)', () => {
  beforeEach(() => {
    lic.activate.mockClear();
  });

  it('surfaces a no-account "restore on this computer" recovery affordance', () => {
    render(<LicenseSettings />);

    const recovery = screen.getByTestId('license-recovery');
    const text = recovery.textContent ?? '';

    expect(text).toMatch(new RegExp(`already bought ${BRAND.name}`, 'i'));
    expect(text).not.toContain(EM_DASH);

    const info = screen.getByRole('button', { name: `About Already bought ${BRAND.name}?` });
    fireEvent.mouseEnter(info);
    const help = screen.getByRole('tooltip').textContent ?? '';
    expect(help).toMatch(/restore it on this computer/i);
    expect(help).toMatch(/no account/i);
    expect(help).not.toContain(EM_DASH);
  });

  it('re-entering a recovery code drives the existing activate() path', () => {
    render(<LicenseSettings />);

    const input = screen.getByTestId('license-recovery-input');
    fireEvent.change(input, { target: { value: 'KEEP-1234-5678' } });
    fireEvent.click(screen.getByTestId('license-recovery-submit'));

    expect(lic.activate).toHaveBeenCalledWith('KEEP-1234-5678');
  });
});
