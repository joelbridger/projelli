/**
 * Settings marketplace hiding (Feedback batch 2).
 *
 * Marketplace is not ready for this launch, so Settings must not show a
 * marketplace badge even if the underlying template store reports updates.
 * The legacy `initialCategory="marketplace"` deep-link still lands in Advanced.
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

  it('keeps the badge hidden when templates have updates', () => {
    act(() => {
      useTemplatesMarketplaceStore.getState().setUpdateCount(3);
    });
    render(
      // Legacy alias "marketplace" resolves to "advanced"
      <SettingsModal open onOpenChange={() => {}} initialCategory="marketplace" />,
    );
    expect(screen.getByTestId('section-advanced')).toBeInTheDocument();
    expect(
      screen.queryByTestId('settings-marketplace-update-badge'),
    ).not.toBeInTheDocument();
  });

  it('stays hidden when count drops to 0', () => {
    act(() => {
      useTemplatesMarketplaceStore.getState().setUpdateCount(2);
    });
    render(
      <SettingsModal open onOpenChange={() => {}} initialCategory="advanced" />,
    );
    expect(
      screen.queryByTestId('settings-marketplace-update-badge'),
    ).not.toBeInTheDocument();

    act(() => {
      useTemplatesMarketplaceStore.getState().setUpdateCount(0);
    });
    expect(
      screen.queryByTestId('settings-marketplace-update-badge'),
    ).not.toBeInTheDocument();
  });

  it('does not reappear when the templates count changes', () => {
    act(() => {
      useTemplatesMarketplaceStore.getState().setUpdateCount(2);
    });
    render(
      <SettingsModal open onOpenChange={() => {}} initialCategory="advanced" />,
    );
    expect(
      screen.queryByTestId('settings-marketplace-update-badge'),
    ).not.toBeInTheDocument();

    act(() => {
      useTemplatesMarketplaceStore.getState().setUpdateCount(5);
    });
    expect(
      screen.queryByTestId('settings-marketplace-update-badge'),
    ).not.toBeInTheDocument();
  });

  it('still resolves the old marketplace deep-link to Advanced without showing a Marketplace row', () => {
    act(() => {
      useTemplatesMarketplaceStore.getState().setUpdateCount(5);
    });
    render(
      <SettingsModal open onOpenChange={() => {}} initialCategory="marketplace" />,
    );
    expect(screen.getByTestId('section-advanced')).toBeInTheDocument();
    expect(screen.queryByTestId('settings-category-marketplace')).toBeNull();
    expect(
      screen.queryByTestId('settings-marketplace-update-badge'),
    ).not.toBeInTheDocument();
  });
});
