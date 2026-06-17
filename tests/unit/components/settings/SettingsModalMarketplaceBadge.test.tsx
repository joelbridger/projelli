/**
 * Settings nav update badge (Stream C1, Group VIII).
 *
 * v3.1: Marketplace is now part of the "Advanced" section (id: advanced).
 * The badge appears on the Advanced nav row when the templates update count
 * is greater than zero. The legacy `initialCategory="marketplace"`
 * deep-link alias resolves to advanced.
 *
 * What this guards:
 *   - Badge appears when count is > 0.
 *   - Badge is absent when count is 0.
 *   - Updating the store mid-render re-shows the badge (subscription is live).
 *   - Badge renders on the Advanced nav row (settings-category-advanced).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { SettingsModal } from '@/features/settings/SettingsModal';
import { useTemplatesMarketplaceStore } from '@/features/workflows/templatesMarketplaceStore';

beforeEach(() => {
  useTemplatesMarketplaceStore.getState().clearMarketplace();
});

afterEach(() => {
  cleanup();
  useTemplatesMarketplaceStore.getState().clearMarketplace();
});

describe('SettingsModal — Marketplace nav update badge', () => {
  it('does not render the badge when count is 0', () => {
    render(
      <SettingsModal open onOpenChange={() => {}} initialCategory="advanced" />,
    );
    expect(
      screen.queryByTestId('settings-marketplace-update-badge'),
    ).not.toBeInTheDocument();
  });

  it('renders the badge with the templates count when templates have updates', () => {
    act(() => {
      useTemplatesMarketplaceStore.getState().setUpdateCount(3);
    });
    render(
      // Legacy alias "marketplace" resolves to "advanced"
      <SettingsModal open onOpenChange={() => {}} initialCategory="marketplace" />,
    );
    const badge = screen.getByTestId('settings-marketplace-update-badge');
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveTextContent('3');
    expect(badge.getAttribute('data-count')).toBe('3');
    expect(badge.getAttribute('aria-label')).toBe(
      '3 marketplace updates available',
    );
  });

  it('hides the badge again when count drops to 0', () => {
    act(() => {
      useTemplatesMarketplaceStore.getState().setUpdateCount(2);
    });
    render(
      <SettingsModal open onOpenChange={() => {}} initialCategory="advanced" />,
    );
    expect(
      screen.getByTestId('settings-marketplace-update-badge'),
    ).toBeInTheDocument();

    act(() => {
      useTemplatesMarketplaceStore.getState().setUpdateCount(0);
    });
    expect(
      screen.queryByTestId('settings-marketplace-update-badge'),
    ).not.toBeInTheDocument();
  });

  it('badge updates when the templates count changes', () => {
    act(() => {
      useTemplatesMarketplaceStore.getState().setUpdateCount(2);
    });
    render(
      <SettingsModal open onOpenChange={() => {}} initialCategory="advanced" />,
    );
    expect(
      screen.getByTestId('settings-marketplace-update-badge'),
    ).toHaveTextContent('2');

    act(() => {
      useTemplatesMarketplaceStore.getState().setUpdateCount(5);
    });
    expect(
      screen.getByTestId('settings-marketplace-update-badge'),
    ).toHaveTextContent('5');
  });

  it('badge renders on the Advanced nav row (not a separate Marketplace row)', () => {
    act(() => {
      useTemplatesMarketplaceStore.getState().setUpdateCount(5);
    });
    render(
      <SettingsModal open onOpenChange={() => {}} initialCategory="advanced" />,
    );
    const badges = screen.getAllByTestId('settings-marketplace-update-badge');
    expect(badges).toHaveLength(1);
    // Badge lives on the Advanced nav button (the canonical row)
    const advancedBtn = screen.getByTestId('settings-category-advanced');
    expect(advancedBtn.contains(badges[0]!)).toBe(true);
  });
});
