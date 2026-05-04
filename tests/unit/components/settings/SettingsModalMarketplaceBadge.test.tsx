/**
 * Settings nav update badge (Stream C1, Group VIII + Stream C4, Group VI).
 *
 * The badge is rendered inside `SettingsModal` next to the Marketplace nav row
 * when the SUM of templates and plugins updates is greater than zero. C4 Group
 * VI changed the badge from a templates-only count to the combined sum so a
 * single pill conveys "stuff to update in the marketplace."
 *
 * What this guards:
 *   - Badge appears when EITHER count is > 0 and shows the sum.
 *   - Badge is absent when both counts are 0.
 *   - Updating either store mid-render re-shows the badge (subscription is live).
 *   - Sum behavior: 0+0 hidden, 0+3=3, 2+1=3, 4+5=9.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { SettingsModal } from '@/components/settings/SettingsModal';
import { useTemplatesMarketplaceStore } from '@/stores/templatesMarketplaceStore';
import { usePluginsMarketplaceStore } from '@/stores/pluginsMarketplaceStore';

beforeEach(() => {
  useTemplatesMarketplaceStore.getState().clearMarketplace();
  usePluginsMarketplaceStore.getState().clear();
});

afterEach(() => {
  cleanup();
  useTemplatesMarketplaceStore.getState().clearMarketplace();
  usePluginsMarketplaceStore.getState().clear();
});

describe('SettingsModal — Marketplace nav update badge', () => {
  it('does not render the badge when both counts are 0', () => {
    render(
      <SettingsModal open onOpenChange={() => {}} initialCategory="marketplace" />,
    );
    expect(
      screen.queryByTestId('settings-marketplace-update-badge'),
    ).not.toBeInTheDocument();
  });

  it('renders the badge with the templates count when only templates have updates', () => {
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
    expect(badge.getAttribute('aria-label')).toBe(
      '3 marketplace updates available',
    );
  });

  it('renders the badge with the plugins count when only plugins have updates', () => {
    act(() => {
      usePluginsMarketplaceStore.getState().setUpdateCount(3);
    });
    render(
      <SettingsModal open onOpenChange={() => {}} initialCategory="marketplace" />,
    );
    const badge = screen.getByTestId('settings-marketplace-update-badge');
    expect(badge).toHaveTextContent('3');
    expect(badge.getAttribute('data-count')).toBe('3');
  });

  it('sums templates + plugins counts (2 + 1 = 3)', () => {
    act(() => {
      useTemplatesMarketplaceStore.getState().setUpdateCount(2);
      usePluginsMarketplaceStore.getState().setUpdateCount(1);
    });
    render(
      <SettingsModal open onOpenChange={() => {}} initialCategory="marketplace" />,
    );
    const badge = screen.getByTestId('settings-marketplace-update-badge');
    expect(badge).toHaveTextContent('3');
    expect(badge.getAttribute('data-count')).toBe('3');
  });

  it('sums templates + plugins counts (4 + 5 = 9)', () => {
    act(() => {
      useTemplatesMarketplaceStore.getState().setUpdateCount(4);
      usePluginsMarketplaceStore.getState().setUpdateCount(5);
    });
    render(
      <SettingsModal open onOpenChange={() => {}} initialCategory="marketplace" />,
    );
    const badge = screen.getByTestId('settings-marketplace-update-badge');
    expect(badge).toHaveTextContent('9');
  });

  it('hides the badge again when both counts drop to 0', () => {
    act(() => {
      useTemplatesMarketplaceStore.getState().setUpdateCount(2);
      usePluginsMarketplaceStore.getState().setUpdateCount(1);
    });
    render(
      <SettingsModal open onOpenChange={() => {}} initialCategory="marketplace" />,
    );
    expect(
      screen.getByTestId('settings-marketplace-update-badge'),
    ).toBeInTheDocument();

    act(() => {
      useTemplatesMarketplaceStore.getState().setUpdateCount(0);
      usePluginsMarketplaceStore.getState().setUpdateCount(0);
    });
    expect(
      screen.queryByTestId('settings-marketplace-update-badge'),
    ).not.toBeInTheDocument();
  });

  it('updates the badge when only one of the two counts changes', () => {
    act(() => {
      useTemplatesMarketplaceStore.getState().setUpdateCount(2);
    });
    render(
      <SettingsModal open onOpenChange={() => {}} initialCategory="marketplace" />,
    );
    expect(
      screen.getByTestId('settings-marketplace-update-badge'),
    ).toHaveTextContent('2');

    act(() => {
      usePluginsMarketplaceStore.getState().setUpdateCount(3);
    });
    expect(
      screen.getByTestId('settings-marketplace-update-badge'),
    ).toHaveTextContent('5');
  });

  it('only renders the badge on the Marketplace row, not on other categories', () => {
    act(() => {
      useTemplatesMarketplaceStore.getState().setUpdateCount(5);
    });
    render(
      <SettingsModal open onOpenChange={() => {}} initialCategory="marketplace" />,
    );
    const badges = screen.getAllByTestId('settings-marketplace-update-badge');
    expect(badges).toHaveLength(1);
    const marketplaceBtn = screen.getByTestId('settings-category-marketplace');
    expect(marketplaceBtn.contains(badges[0]!)).toBe(true);
  });
});
