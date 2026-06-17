/**
 * VG-6b — Assured mode: the egress-indicator half, proven deterministically.
 *
 * The live scripted exercise (scripts/assured-live-exercise.sh) proves the
 * backend proxy + zero-retention path against api.keepance.com. This file
 * proves the CLIENT half the audit cares about: once the firm has a managed
 * key, Assured is a real, SELECTABLE mode (no more "coming soon"), and the
 * egress indicator renders the honest zero-retention story. It also pins the
 * `resolveEgress` assured branch, which had no coverage before this wave.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import {
  resolveEgress,
  modeNeedsManagedKey,
  CONFIDENTIALITY_MODE_SETTING_KEY,
} from '@/modules/privacy/egress';
import { ConfidentialityModeSettings } from '@/features/settings/ConfidentialityModeSettings';
import { EgressIndicator } from '@/components/privacy/EgressIndicator';
import { useSettingsStore } from '@/stores/settingsStore';
import { useFirmStore } from '@/stores/firmStore';

beforeEach(() => {
  useSettingsStore.setState({ values: {} });
  useFirmStore.setState({ assuredProviders: [] });
});

// ---------------------------------------------------------------------------
// 1. resolveEgress — the assured branch (was uncovered before this wave).
// ---------------------------------------------------------------------------
describe('resolveEgress (assured)', () => {
  it('routes through the zero-retention proxy when a managed key exists', () => {
    const info = resolveEgress({ provider: 'anthropic', mode: 'assured', assuredAvailable: true });
    expect(info.destination).toBe('assured-proxy');
    expect(info.severity).toBe('assured');
    expect(info.dataLeaves).toBe(true);
    expect(info.label.toLowerCase()).toContain('zero-retention proxy');
    expect(info.note.toLowerCase()).toContain('retains nothing');
  });

  it('falls back to BYOK-direct (honest) when no managed key is configured', () => {
    const info = resolveEgress({ provider: 'anthropic', mode: 'assured', assuredAvailable: false });
    expect(info.destination).toBe('provider-direct');
    expect(info.severity).toBe('direct');
  });

  it('never routes assured through the proxy in the browser demo build', () => {
    const info = resolveEgress({
      provider: 'anthropic',
      mode: 'assured',
      assuredAvailable: true,
      isDemo: true,
    });
    expect(info.destination).not.toBe('assured-proxy');
  });
});

// ---------------------------------------------------------------------------
// 2. modeNeedsManagedKey — the renamed gate (was modeIsComingSoon).
// ---------------------------------------------------------------------------
describe('modeNeedsManagedKey', () => {
  it('is true only for assured without a managed key', () => {
    expect(modeNeedsManagedKey('assured', false)).toBe(true);
    expect(modeNeedsManagedKey('assured', true)).toBe(false);
    expect(modeNeedsManagedKey('direct', false)).toBe(false);
    expect(modeNeedsManagedKey('local-only', false)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 3. The picker: Assured becomes SELECTABLE once a managed key is set, and is
//    gated (not "coming soon") when it is not.
// ---------------------------------------------------------------------------
// The Assured card is only rendered when the user is in a firm context
// (session.activated is truthy). Tests that check Assured selectability must
// set up a firm session so the card appears at all.
const FIRM_SESSION_STUB = { activated: true, email: 'admin@firm.example', role: 'admin' as const, org: null, seatId: null, seatExpiresAt: null };

describe('ConfidentialityModeSettings — Assured selectability', () => {
  it('gates Assured behind a managed key with a "Needs admin key" hint (never "coming soon")', () => {
    // Firm user with no managed key yet: card should appear but be disabled.
    useFirmStore.setState({ assuredProviders: [], session: FIRM_SESSION_STUB });
    render(<ConfidentialityModeSettings />);
    const card = screen.getByTestId('confidentiality-mode-assured');
    expect(card).toHaveAttribute('data-disabled', 'true');
    expect(card).toBeDisabled();
    expect(card.textContent).toContain('Needs admin key');
    expect(card.textContent).not.toMatch(/coming soon/i);
  });

  it('makes Assured selectable when the firm has a managed key', () => {
    useFirmStore.setState({ assuredProviders: ['anthropic'], session: FIRM_SESSION_STUB });
    render(<ConfidentialityModeSettings />);
    const card = screen.getByTestId('confidentiality-mode-assured');
    expect(card).toHaveAttribute('data-disabled', 'false');
    expect(card).not.toBeDisabled();
    expect(card.textContent).not.toContain('Needs admin key');

    fireEvent.click(card);
    expect(useSettingsStore.getState().getSetting(CONFIDENTIALITY_MODE_SETTING_KEY)).toBe('assured');
  });

  it('does NOT show the Assured card to solo (non-firm) users', () => {
    // No firm session: Assured card must be absent entirely.
    useFirmStore.setState({ assuredProviders: [], session: null });
    render(<ConfidentialityModeSettings />);
    expect(screen.queryByTestId('confidentiality-mode-assured')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 4. The status-bar / composer egress badge renders the assured severity.
// ---------------------------------------------------------------------------
describe('EgressIndicator (assured)', () => {
  it('renders the assured severity + zero-retention label when a managed key exists', () => {
    render(<EgressIndicator provider="anthropic" mode="assured" assuredAvailable />);
    const badge = screen.getByTestId('egress-indicator');
    expect(badge).toHaveAttribute('data-severity', 'assured');
    expect(badge.textContent?.toLowerCase()).toContain('zero-retention proxy');
  });
});
