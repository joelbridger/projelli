/**
 * ui-simplification round 2 (F2) — the per-card InfoHelp trigger used to be a
 * focusable role="button" span rendered INSIDE the mode card's <button>:
 * invalid interactive-inside-interactive nesting. Keyboard/screen-reader
 * behavior broke, and on a disabled card (Assured without a managed key) the
 * disabled parent button made the help unreachable entirely.
 *
 * These tests pin the fixed structure: the help trigger is a real control
 * OUTSIDE any button, focusable and activatable on its own (including on a
 * disabled card), while the card still selects through its own control.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import { ConfidentialityModeSettings } from '@/features/settings/ConfidentialityModeSettings';
import { CONFIDENTIALITY_MODE_SETTING_KEY } from '@/platform/privacy/egress';
import { useSettingsStore } from '@/platform/settings/settingsStore';
import { useFirmStore } from '@/platform/firm/firmStore';

const FIRM_SESSION_STUB = {
  activated: true,
  email: 'admin@firm.example',
  role: 'admin' as const,
  org: null,
  seatId: null,
  seatExpiresAt: null,
  userId: 'user-1',
  tier: null,
  packs: [],
  seats: 1,
  lastValidatedAt: null,
};

beforeEach(() => {
  useSettingsStore.setState({ values: {} });
  useFirmStore.setState({ assuredProviders: [], session: null });
});

describe('ConfidentialityModeSettings — card help trigger a11y (F2)', () => {
  it('renders the per-card help trigger structurally outside any button', () => {
    render(<ConfidentialityModeSettings />);
    const help = screen.getByLabelText('About On this computer only');
    // The trigger itself may be a button, but it must not sit inside another
    // interactive element (no interactive-inside-interactive nesting).
    expect(help.parentElement?.closest('button')).toBeNull();
  });

  it('help trigger is focusable and activatable without selecting the card', () => {
    render(<ConfidentialityModeSettings />);
    const help = screen.getByLabelText('About On this computer only');
    help.focus();
    expect(document.activeElement).toBe(help);
    fireEvent.click(help);
    expect(useSettingsStore.getState().getSetting(CONFIDENTIALITY_MODE_SETTING_KEY)).not.toBe(
      'local-only',
    );
  });

  it('the card still selects through its select control, with pressed semantics', () => {
    render(<ConfidentialityModeSettings />);
    const select = screen.getByTestId('confidentiality-mode-local-only');
    expect(select).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(select);
    expect(useSettingsStore.getState().getSetting(CONFIDENTIALITY_MODE_SETTING_KEY)).toBe(
      'local-only',
    );
    expect(screen.getByTestId('confidentiality-mode-card-local-only')).toHaveAttribute(
      'data-selected',
      'true',
    );
    expect(screen.getByTestId('confidentiality-mode-local-only')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('keeps the help trigger reachable on a disabled card', () => {
    // Firm user without a managed key: the Assured card renders disabled.
    useFirmStore.setState({ assuredProviders: [], session: FIRM_SESSION_STUB });
    render(<ConfidentialityModeSettings />);
    expect(screen.getByTestId('confidentiality-mode-assured')).toBeDisabled();
    const help = screen.getByLabelText('About Assured');
    help.focus();
    expect(document.activeElement).toBe(help);
    // Activating help on a disabled card must not select the mode.
    fireEvent.click(help);
    expect(useSettingsStore.getState().getSetting(CONFIDENTIALITY_MODE_SETTING_KEY)).not.toBe(
      'assured',
    );
  });
});
