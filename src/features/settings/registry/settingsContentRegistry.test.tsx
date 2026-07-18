import { createElement } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SettingsPanelDescriptor, SettingsSectionDescriptor } from './types';

declare module '@/platform/types/settings' {
  interface SettingsSectionMap {
    personalTest: true;
  }
}

const personalSection: SettingsSectionDescriptor = {
  id: 'personalTest',
  order: 90,
  labelKey: 'settings.sections.personal-test',
  legacyLabel: 'My settings',
  searchTerms: ['notices'],
};

const personalPanel: SettingsPanelDescriptor = {
  id: 'personal-test-panel',
  section: 'personalTest',
  order: 10,
  render: () =>
    createElement(
      'div',
      { 'data-testid': 'personal-test-panel' },
      'Personal panel'
    ),
};

describe('SettingsContent registry-derived rail', () => {
  afterEach(async () => {
    cleanup();
    const flags = await import('@/platform/flags');
    flags.setDevFlagOverride('booking-availability', undefined);
    flags.setDevFlagOverride('notification-preferences', undefined);
    localStorage.clear();
    vi.resetModules();
    vi.doUnmock('@/features/booking');
    vi.doUnmock('./legacySettingsSections');
  });

  it('shows, searches, and renders a newly augmented section without a SettingsContent list edit', async () => {
    vi.doMock('./legacySettingsSections', async (importOriginal) => {
      const actual = await importOriginal<typeof import('./legacySettingsSections')>();
      return {
        ...actual,
        legacySettingsSections: [...actual.legacySettingsSections, personalSection],
        legacySettingsPanels: [...actual.legacySettingsPanels, personalPanel],
      };
    });
    vi.doMock('@/features/booking', () => ({
      bookingAvailabilitySettingsPanel: {
        id: 'booking-availability',
        section: 'scheduling',
        order: 10,
        flagId: 'booking-availability',
        render: () => null,
      },
    }));
    const { SettingsContent } = await import('../SettingsContent');

    render(<SettingsContent variant="page" />);
    expect(
      screen.getByTestId('settings-category-personalTest')
    ).toHaveTextContent('My settings');
    fireEvent.click(screen.getByTestId('settings-category-personalTest'));
    expect(screen.getByTestId('personal-test-panel')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('settings-search-toggle'));
    fireEvent.change(screen.getByTestId('settings-search'), {
      target: { value: 'notices' },
    });
    expect(
      screen.getByTestId('settings-category-personalTest')
    ).toBeInTheDocument();
  }, 15_000);

  it('self-serves the real My settings rail, visible panel, and search terms without a SettingsContent edit', async () => {
    const flags = await import('@/platform/flags');
    flags.setDevFlagOverride('notification-preferences', undefined);
    const { SettingsContent } = await import('../SettingsContent');

    const { rerender } = render(<SettingsContent variant="page" />);
    expect(screen.queryByTestId('settings-category-personal')).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('notification-preferences-panel')
    ).not.toBeInTheDocument();

    flags.setDevFlagOverride('notification-preferences', true);
    rerender(<SettingsContent variant="page" />);
    expect(screen.getByTestId('settings-category-personal')).toHaveTextContent(
      'My settings'
    );
    fireEvent.click(screen.getByTestId('settings-category-personal'));
    expect(screen.getByTestId('notification-preferences-panel')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('settings-search-toggle'));
    fireEvent.change(screen.getByTestId('settings-search'), {
      target: { value: 'digest' },
    });
    expect(screen.getByTestId('settings-category-personal')).toBeInTheDocument();
  }, 15_000);

  it('keeps booking availability absent in the real legacy Settings Scheduling host while dark', async () => {
    const flags = await import('@/platform/flags');
    flags.setDevFlagOverride('booking-availability', undefined);
    const { SettingsContent } = await import('../SettingsContent');

    render(
      <SettingsContent initialCategory="scheduling" variant="page" />
    );

    expect(screen.getByTestId('settings-category-scheduling')).toHaveAttribute(
      'aria-current',
      'page'
    );
    expect(
      screen.queryByTestId('booking-availability-settings')
    ).not.toBeInTheDocument();
  }, 15_000);

  it('reaches booking availability through the real legacy Settings Scheduling host only while enabled', async () => {
    const flags = await import('@/platform/flags');
    flags.setDevFlagOverride('booking-availability', true);
    const { SettingsContent } = await import('../SettingsContent');

    render(
      <SettingsContent initialCategory="scheduling" variant="page" />
    );

    expect(screen.getByTestId('settings-category-scheduling')).toHaveAttribute(
      'aria-current',
      'page'
    );
    expect(
      await screen.findByTestId('booking-availability-settings')
    ).toBeInTheDocument();
  }, 15_000);
});
