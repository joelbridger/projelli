/**
 * Phase 5.1 — frictionless free-trial packaging.
 *
 * The trial must read as: no credit card, no account, full features, and the
 * personal no-egress default (nothing leaves the user's computer unless they
 * turn on cloud AI). These tests pin the trial COPY in the banner + status chip
 * to that framing, prove the price is read from the canonical pricing config
 * (not hardcoded), and lock the generous 30-day length. Voice rule: no em dash
 * in any user-facing string.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TIER_BY_CODE, TRIAL } from '@/config/pricing';

const EM_DASH = '—';

const state = vi.hoisted(() => ({
  trial: {
    firstLaunchAt: new Date('2026-06-01T00:00:00Z'),
    daysElapsed: 0,
    daysRemaining: 30,
    isExpired: false,
    trialDays: 30,
  },
  license: { isActivated: false, tier: 'free' as string },
}));

vi.mock('@/platform/hooks/useTrial', () => ({
  useTrial: () => state.trial,
}));
vi.mock('@/platform/hooks/useLicense', () => ({
  useLicense: () => state.license,
}));

import { TrialBanner } from '@/features/account/trial/TrialBanner';
import { TrialStatusChip } from '@/features/account/trial/TrialStatusChip';

function resetState() {
  state.trial = {
    firstLaunchAt: new Date('2026-06-01T00:00:00Z'),
    daysElapsed: 0,
    daysRemaining: 30,
    isExpired: false,
    trialDays: 30,
  };
  state.license = { isActivated: false, tier: 'free' };
}

describe('Trial packaging copy (Phase 5.1)', () => {
  beforeEach(() => {
    sessionStorage.clear();
    resetState();
  });

  it('is a generous 30 days with no credit card', () => {
    expect(TRIAL.days).toBe(30);
    expect(TRIAL.blurb).toMatch(/no credit card/i);
    expect(TRIAL.blurb).not.toContain(EM_DASH);
  });

  it('frames the final-week banner as frictionless: no account, full features, no egress, price from config', () => {
    state.trial = { ...state.trial, daysRemaining: 5, daysElapsed: 25, isExpired: false };
    render(<TrialBanner onActivate={() => {}} />);

    const banner = screen.getByTestId('trial-banner');
    const text = banner.textContent ?? '';

    // Accurate no-egress framing: scoped to the user's own files, not "nothing
    // ever leaves" (the app still checks for updates / validates a license).
    expect(text).toMatch(/files stay on your computer/i);
    expect(text).toMatch(/unless you turn on cloud AI/i);
    expect(text).toMatch(/no account/i);
    expect(text).toMatch(/billed yearly/i);
    // Price must come from the canonical pricing config, not a hardcoded number.
    expect(text).toContain(`$${String(TIER_BY_CODE.personal.annualPerMonth)}/mo`);
    expect(text).not.toContain(EM_DASH);
  });

  it('expired banner reassures the user keeps their files and needs no account', () => {
    state.trial = { ...state.trial, daysRemaining: 0, daysElapsed: 30, isExpired: true };
    render(<TrialBanner onActivate={() => {}} />);

    const banner = screen.getByTestId('trial-banner');
    const text = banner.textContent ?? '';

    expect(text).toMatch(/files? stay readable/i);
    expect(text).toMatch(/no account/i);
    expect(text).not.toContain(EM_DASH);
  });

  it('status chip tooltip carries the frictionless framing during the trial', () => {
    state.trial = { ...state.trial, daysRemaining: 20, daysElapsed: 10, isExpired: false };
    render(<TrialStatusChip onClick={() => {}} />);

    const chip = screen.getByTestId('status-bar-trial-chip');
    const title = chip.getAttribute('title') ?? '';

    expect(title).toMatch(/files stay on your computer/i);
    expect(title).toMatch(/unless you turn on cloud AI/i);
    expect(title).toMatch(/no account/i);
    expect(title).not.toContain(EM_DASH);
    // The visible label stays compact and shows the day countdown.
    expect(chip.textContent ?? '').toMatch(/free trial/i);
    expect(chip.textContent ?? '').not.toContain(EM_DASH);
  });
});
