import { afterEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  renderRegisteredSettingsPanels,
  settingsModuleRegistry,
  type SettingsSectionRenderProps,
} from '@/features/settings';
import {
  outsideModuleSettingsPanel,
  registerOutsideModuleSettingsPanel,
} from '@/foundation-contracts/settings/settingsModule.import';

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

describe('Settings public module doorway', () => {
  let unregister: (() => void) | undefined;

  afterEach(() => {
    unregister?.();
    unregister = undefined;
  });

  it('lets an outside module register a third contribution the real Settings renderer lists', () => {
    unregister = registerOutsideModuleSettingsPanel();

    expect(settingsModuleRegistry.descriptors).toContain(
      outsideModuleSettingsPanel
    );
    render(<>{renderRegisteredSettingsPanels('workspace', props)}</>);

    expect(
      screen.getByTestId('outside-module-settings-fixture')
    ).toBeInTheDocument();
  });
});
