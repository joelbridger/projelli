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
    vi.resetModules();
    vi.doUnmock('./settingsModuleRegistry');
  });

  it('shows, searches, and renders a newly augmented section without a SettingsContent list edit', async () => {
    vi.doMock('./settingsModuleRegistry', () => ({
      getVisibleSettingsSectionDescriptors: () => [personalSection],
      getSettingsSectionSearchTerms: () => personalSection.searchTerms ?? [],
      getSettingsGroupDescriptors: () => [],
      getSettingsPanelDescriptors: () => [personalPanel],
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
  });
});
