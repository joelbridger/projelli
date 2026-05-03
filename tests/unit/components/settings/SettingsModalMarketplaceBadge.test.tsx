/**
 * Settings nav update badge (Stream C1, Group VIII).
 *
 * The badge is rendered inside `SettingsModal` next to the Marketplace nav
 * row when `useTemplateUpdateCount()` is greater than zero. Rather than spin
 * up the entire SettingsModal (which pulls in dozens of feature components
 * and stores), this test mounts SettingsModal in a minimal harness and
 * toggles the count via the marketplace store.
 *
 * What this guards:
 *   - Badge appears when count > 0 and shows that count.
 *   - Badge is absent when count is 0.
 *   - Updating the store mid-render re-shows the badge (subscription is live).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { SettingsModal } from '@/components/settings/SettingsModal';
import { useTemplatesMarketplaceStore } from '@/stores/templatesMarketplaceStore';

beforeEach(() => {
  useTemplatesMarketplaceStore.getState().clearMarketplace();
});

afterEach(() => {
  cleanup();
  useTemplatesMarketplaceStore.getState().clearMarketplace();
});

describe('SettingsModal — Marketplace nav update badge', () => {
  it('does not render the badge when updateCount is 0', () => {
    render(
      <SettingsModal open onOpenChange={() => {}} initialCategory="marketplace" />,
    );
    expect(
      screen.queryByTestId('settings-marketplace-update-badge'),
    ).not.toBeInTheDocument();
  });

  it('renders the badge with the count when updateCount > 0', () => {
    act(() => {
      useTemplatesMarketplaceStore.getState().setUpdateCount(3);
    });
    render(
      <SettingsModal open onOpenChange={() => {}} initialCategory="marketplace" />,
    );
    const badge = screen.getByTestId('settings-marketplace-update-badge');
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveTextContent('3');
    expect(badge.getAttribute('data-count')).toBe('3');
    expect(badge.getAttribute('aria-label')).toBe('3 template updates available');
  });

  it('hides the badge again when updateCount drops to 0', () => {
    act(() => {
      useTemplatesMarketplaceStore.getState().setUpdateCount(2);
    });
    render(
      <SettingsModal open onOpenChange={() => {}} initialCategory="marketplace" />,
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

  it('only renders the badge on the Marketplace row, not on other categories', () => {
    act(() => {
      useTemplatesMarketplaceStore.getState().setUpdateCount(5);
    });
    render(
      <SettingsModal open onOpenChange={() => {}} initialCategory="marketplace" />,
    );
    // The badge is a single element on the Marketplace row; no other category
    // button should contain a badge with the same testid.
    const badges = screen.getAllByTestId('settings-marketplace-update-badge');
    expect(badges).toHaveLength(1);
    // And it lives inside the Marketplace nav button.
    const marketplaceBtn = screen.getByTestId('settings-category-marketplace');
    expect(marketplaceBtn.contains(badges[0]!)).toBe(true);
  });
});
