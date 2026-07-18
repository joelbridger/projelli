import { createElement } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
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
  afterEach(() => {
    localStorage.clear();
    vi.resetModules();
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
  });

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
  });

  it('keeps workspace section headings one level below the Settings page heading', async () => {
    const { SettingsContent } = await import('../SettingsContent');

    render(<SettingsContent variant="page" />);

    expect(screen.getByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument();
    expect(screen.getByTestId('subheader-general-heading').tagName).toBe('H2');
  });
});
