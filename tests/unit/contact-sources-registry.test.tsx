import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it } from 'vitest';
import { setDevFlagOverride } from '@/platform/flags';
import { renderRegisteredSettingsPanels } from '@/features/settings';
import type { SettingsSectionRenderProps } from '@/features/settings/registry/types';

const props: SettingsSectionRenderProps = {
  getSetting: () => undefined,
  setSetting: () => undefined,
  onAction: () => undefined,
  filteredKeys: new Set(),
  searchQuery: '',
  searchActive: false,
  onNavigate: () => undefined,
  hasWorkspaceOpen: true,
};

describe('contact sources settings registry mount', () => {
  afterEach(() => {
    setDevFlagOverride('contact-sources', undefined);
  });

  it('renders exactly once through the real registry when the flag is enabled', () => {
    setDevFlagOverride('contact-sources', true);

    render(<>{renderRegisteredSettingsPanels('organization', props)}</>);

    expect(screen.getAllByTestId('contact-sources-settings')).toHaveLength(1);
  });

  it('does not render through the real registry when the flag is disabled', () => {
    setDevFlagOverride('contact-sources', false);

    render(<>{renderRegisteredSettingsPanels('organization', props)}</>);

    expect(
      screen.queryByTestId('contact-sources-settings')
    ).not.toBeInTheDocument();
  });
});
