import { createElement } from 'react';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  SettingsPanelDescriptor,
  SettingsSectionRenderProps,
} from './types';

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

function panel(
  id: string,
  order: number,
  flagId?: 'teams-roles'
): SettingsPanelDescriptor {
  return {
    id,
    section: 'organization',
    order,
    ...(flagId ? { flagId } : {}),
    render: () => createElement('div', { 'data-testid': `panel-${id}` }, id),
  };
}

describe('renderRegisteredSettingsPanels', () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock('./settingsModuleRegistry');
  });

  it('stacks two independent panels in within-section order and hides flag-gated panels when dark', async () => {
    let flagOn = false;
    const panels = [
      panel('later', 20),
      panel('first', 10),
      panel('gated', 30, 'teams-roles'),
    ];
    vi.doMock('./settingsModuleRegistry', () => ({
      getSettingsPanelDescriptors: (section?: string) =>
        panels
          .filter((item) => section === undefined || item.section === section)
          .filter((item) => item.flagId === undefined || flagOn)
          .sort((a, b) => a.order - b.order),
    }));
    const { renderRegisteredSettingsPanels } =
      await import('./sectionRendererBindings');

    const { rerender } = render(
      <>{renderRegisteredSettingsPanels('organization', props)}</>
    );
    expect(
      screen.getAllByTestId(/panel-/).map((element) => element.textContent)
    ).toEqual(['first', 'later']);
    expect(screen.queryByTestId('panel-gated')).not.toBeInTheDocument();

    flagOn = true;
    rerender(<>{renderRegisteredSettingsPanels('organization', props)}</>);
    expect(
      screen.getAllByTestId(/panel-/).map((element) => element.textContent)
    ).toEqual(['first', 'later', 'gated']);
  });
});
